/**
 * Order lifecycle workflow.
 *
 * Each order spawns one instance, with the orderId as the instance id.
 * The workflow owns every long-running side-effect that used to live in
 * `ctx.waitUntil()` calls (best-effort, no retries) or in periodic
 * housekeeping passes:
 *
 * 1. Send "payment instructions" email
 * 2. Wait for the `payment-confirmed` event (or expire on timeout)
 * 3. Assign license keys / mint download URLs (atomic, idempotent)
 * 4. Send the delivery email (with retries)
 * 5. Bump per-product sales counters & write the audit log
 *
 * Steps are designed to be safe to re-run: each one re-checks the
 * database state before mutating, so a partial workflow can be
 * restarted without producing duplicate keys, double emails, etc.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { and, eq } from 'drizzle-orm';
import type { AppEnv, OrderWorkflowParams, PaymentConfirmedEvent } from '../env';
import { getDb, schema } from '../db/client';
import { sendEmail, orderCreatedEmail, orderFulfilledEmail } from '../lib/mail';
import { presignDownloadUrl } from '../lib/r2';
import { CRYPTO_DECIMALS, formatCryptoAmount } from '../lib/apirone';
import { randomId, signToken } from '../lib/crypto';

/** Default retry policy reused across most steps. */
const RETRY = {
  retries: { limit: 5, delay: '5 seconds' as const, backoff: 'exponential' as const },
  timeout: '1 minute' as const,
};

/** Mail steps allow more retries because external delivery is flaky. */
const MAIL_RETRY = {
  retries: { limit: 8, delay: '10 seconds' as const, backoff: 'exponential' as const },
  timeout: '30 seconds' as const,
};

interface DeliveredItem {
  name: string;
  key?: string;
  downloadUrl?: string;
}

export class OrderLifecycleWorkflow extends WorkflowEntrypoint<AppEnv, OrderWorkflowParams> {
  async run(event: WorkflowEvent<OrderWorkflowParams>, step: WorkflowStep): Promise<{ status: string }> {
    const orderId = event.payload.orderId;
    if (!orderId) throw new NonRetryableError('orderId payload missing');

    /* -------------------------------------------------------------- *
     * 1. Load the order snapshot (so the rest of the steps work from
     * a stable view of the data).
     * -------------------------------------------------------------- */
    const snapshot = await step.do('load-order', RETRY, async () => {
      const db = getDb(this.env);
      const rows = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1)
        .all();
      const order = rows[0];
      if (!order) throw new NonRetryableError(`order ${orderId} not found`);
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        email: order.email,
        currency: order.currency,
        totalCents: order.totalCents,
        cryptoCurrency: order.cryptoCurrency,
        cryptoAddress: order.cryptoAddress,
        cryptoAmount: order.cryptoAmount,
        userId: order.userId,
      };
    });

    /* -------------------------------------------------------------- *
     * 2. Send payment instructions. Includes a public order token so
     * the recipient can poll status without a session.
     * -------------------------------------------------------------- */
    await step.do('send-payment-instructions', MAIL_RETRY, async () => {
      if (!snapshot.cryptoAddress || !snapshot.cryptoCurrency || !snapshot.cryptoAmount) {
        throw new NonRetryableError('order is missing crypto payment metadata');
      }
      const decimals = CRYPTO_DECIMALS[snapshot.cryptoCurrency] ?? 8;
      const amountDisplay = formatCryptoAmount(snapshot.cryptoAmount, decimals);
      if (!this.env.SESSION_SECRET) throw new NonRetryableError('SESSION_SECRET not configured');
      const orderToken = await signToken(this.env.SESSION_SECRET, {
        kind: 'order',
        oid: snapshot.id,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
      });
      const payUrl = `${this.env.APP_URL.replace(/\/$/, '')}/orders/${snapshot.id}?t=${encodeURIComponent(orderToken)}`;
      const result = await sendEmail(this.env, {
        to: snapshot.email,
        subject: `Order ${snapshot.orderNumber} — payment instructions`,
        html: orderCreatedEmail(this.env, {
          orderNumber: snapshot.orderNumber,
          amount: (snapshot.totalCents / 100).toFixed(2),
          currency: snapshot.currency,
          cryptoCurrency: snapshot.cryptoCurrency,
          cryptoAddress: snapshot.cryptoAddress,
          cryptoAmount: amountDisplay,
          payUrl,
        }),
      });
      if (result.error && result.error !== 'mailer-not-configured') {
        // Surface to the retry mechanism for transient errors.
        throw new Error(`mail failed: ${result.error}`);
      }
      return { sent: true, mailId: result.id ?? null };
    });

    /* -------------------------------------------------------------- *
     * 3. Wait for payment. Apirone's webhook calls our worker, which
     * forwards a `payment-confirmed` event into this instance.
     *
     * If the deadline passes we mark the order expired and stop.
     * -------------------------------------------------------------- */
    const timeout = (this.env.ORDER_PAYMENT_TIMEOUT || '1 hour') as "1 hour";
    let payment: PaymentConfirmedEvent | null = null;
    try {
      const evt = await step.waitForEvent<PaymentConfirmedEvent>('wait-for-payment', {
        type: 'payment-confirmed',
        timeout,
      });
      payment = evt?.payload ?? null;
    } catch (err) {
      // step.waitForEvent throws on timeout — that's our expected exit.
      console.warn('[order-workflow] payment wait timed out', orderId, err);
      payment = null;
    }

    if (!payment) {
      await step.do('mark-expired', RETRY, async () => {
        // Only flip to expired if the order is still pending payment.
        const res = await this.env.DB.prepare(
          `UPDATE orders SET status = 'expired', updated_at = unixepoch()
           WHERE id = ?1 AND status IN ('pending','awaiting_payment','partial')`,
        )
          .bind(orderId)
          .run();
        return { expired: (res.meta?.changes ?? 0) > 0 };
      });
      return { status: 'expired' };
    }

    /* -------------------------------------------------------------- *
     * 4. Atomically transition to 'paid' so concurrent webhook deliveries
     * or admin actions do not double-fulfil. We compute the BigInt
     * "max(received, payment.receivedMinor)" in JS rather than in
     * SQL because SQLite's INTEGER caps at 64 bits, which overflows
     * for 18-decimal ERC-20 / ETH amounts.
     * -------------------------------------------------------------- */
    await step.do('mark-paid', RETRY, async () => {
      const db = getDb(this.env);
      const cur = await db
        .select({ cryptoReceived: schema.orders.cryptoReceived })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1)
        .all();
      const before = cur[0]?.cryptoReceived ?? '0';
      let received = before;
      try {
        received = BigInt(before) >= BigInt(payment.receivedMinor) ? before : payment.receivedMinor;
      } catch {
        received = payment.receivedMinor;
      }
      await this.env.DB.prepare(
        `UPDATE orders
            SET status = 'paid',
                payment_confirmations = ?2,
                payment_tx_hash = COALESCE(?3, payment_tx_hash),
                crypto_received = ?4,
                updated_at = unixepoch()
          WHERE id = ?1
            AND status IN ('awaiting_payment','partial','pending')`,
      )
        .bind(orderId, payment.confirmations, payment.txHash, received)
        .run();
      return { ok: true };
    });

    /* -------------------------------------------------------------- *
     * 5. Per-item assignment. Each item is its own step so retries
     * don't redo the parts that already succeeded.
     * -------------------------------------------------------------- */
    const itemIds = await step.do('list-items', RETRY, async () => {
      const db = getDb(this.env);
      const rows = await db
        .select({
          id: schema.orderItems.id,
          productId: schema.orderItems.productId,
          productName: schema.orderItems.productName,
          productType: schema.orderItems.productType,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId))
        .all();
      return rows;
    });

    const delivered: DeliveredItem[] = [];
    const stockMisses: { productId: string; productName: string }[] = [];

    for (const item of itemIds) {
      const result = await step.do(
        `deliver-item-${item.id}`,
        RETRY,
        async (): Promise<{ name: string; key?: string; downloadUrl?: string; missing?: boolean }> => {
          const db = getDb(this.env);
          // Re-check whether this item was already delivered (idempotency).
          const fresh = await db
            .select()
            .from(schema.orderItems)
            .where(eq(schema.orderItems.id, item.id))
            .limit(1)
            .all();
          const it = fresh[0];
          if (!it) throw new NonRetryableError(`order item ${item.id} not found`);
          if (it.deliveredKey) return { name: it.productName, key: it.deliveredKey };

          if (it.productType === 'key' || it.productType === 'subscription') {
            // Atomically claim a key.
            const candidates = await db
              .select({ id: schema.licenseKeys.id, keyValue: schema.licenseKeys.keyValue })
              .from(schema.licenseKeys)
              .where(
                and(
                  eq(schema.licenseKeys.productId, it.productId ?? '__none__'),
                  eq(schema.licenseKeys.status, 'available'),
                ),
              )
              .limit(5)
              .all();
            for (const cand of candidates) {
              const claim = await this.env.DB.prepare(
                `UPDATE license_keys SET status = 'sold', order_item_id = ?1, sold_at = unixepoch()
                 WHERE id = ?2 AND status = 'available'`,
              )
                .bind(it.id, cand.id)
                .run();
              if ((claim.meta?.changes ?? 0) === 1) {
                await db
                  .update(schema.orderItems)
                  .set({ licenseKeyId: cand.id, deliveredKey: cand.keyValue })
                  .where(eq(schema.orderItems.id, it.id));
                return { name: it.productName, key: cand.keyValue };
              }
            }
            // Out of stock — escalate to admin via the audit log; do
            // not throw, otherwise we'd retry forever for a real shortage.
            return { name: it.productName, missing: true };
          }

          if (it.productType === 'file' || it.productType === 'script') {
            const fileRows = await db
              .select()
              .from(schema.productFiles)
              .where(eq(schema.productFiles.productId, it.productId ?? '__none__'))
              .all();
            if (fileRows.length === 0) return { name: it.productName };
            try {
              const url = await presignDownloadUrl(this.env, fileRows[0].r2Key, 3600, fileRows[0].label);
              return { name: it.productName, downloadUrl: url };
            } catch (err) {
              // R2 presign issues are transient — let workflow retry.
              throw new Error(`presign failed: ${(err as Error).message}`);
            }
          }
          return { name: it.productName };
        },
      );
      if (result.missing) {
        stockMisses.push({ productId: item.productId ?? '', productName: result.name });
      } else {
        delivered.push({
          name: result.name,
          key: result.key,
          downloadUrl: result.downloadUrl,
        });
      }
    }

    /* -------------------------------------------------------------- *
     * 6. If any item is back-ordered, mark the order paid (so admin sees
     * it) and bail without sending the delivery email yet.
     * -------------------------------------------------------------- */
    if (stockMisses.length > 0) {
      await step.do('flag-stock-shortage', RETRY, async () => {
        const db = getDb(this.env);
        await db.insert(schema.auditLogs).values({
          id: `al_${randomId(8)}`,
          actorId: null,
          action: 'order.stock_shortage',
          entityType: 'order',
          entityId: orderId,
          metadata: JSON.stringify({ shortages: stockMisses }),
        });
      });
      return { status: 'paid_pending_stock' };
    }

    /* -------------------------------------------------------------- *
     * 7. Mark fulfilled, increment sales counters, audit, then email.
     * -------------------------------------------------------------- */
    const fulfilment = await step.do('mark-fulfilled', RETRY, async () => {
      const res = await this.env.DB.prepare(
        `UPDATE orders SET status = 'fulfilled', fulfilled_at = unixepoch(), updated_at = unixepoch()
         WHERE id = ?1 AND status IN ('paid','partial')`,
      )
        .bind(orderId)
        .run();
      return { firstTime: (res.meta?.changes ?? 0) > 0 };
    });

    await step.do('bump-sales', RETRY, async () => {
      if (!fulfilment.firstTime) return { bumped: 0 };
      let bumped = 0;
      for (const item of itemIds) {
        if (!item.productId) continue;
        await this.env.DB.prepare(
          `UPDATE products SET sales_count = sales_count + ?2, updated_at = unixepoch() WHERE id = ?1`,
        )
          .bind(item.productId, item.quantity)
          .run();
        bumped += 1;
      }
      return { bumped };
    });

    /* Bump the coupon's redemption counter once, the first time this
       order transitions into fulfilled. `firstTime` is only true for
       the run that actually flipped the status, which makes this
       step safe to re-execute on workflow retries. */
    await step.do('bump-coupon-redemptions', RETRY, async () => {
      if (!fulfilment.firstTime) return { bumped: false };
      const row = await this.env.DB.prepare(
        `SELECT coupon_code FROM orders WHERE id = ?1`,
      )
        .bind(orderId)
        .first<{ coupon_code: string | null }>();
      if (!row?.coupon_code) return { bumped: false };
      const res = await this.env.DB.prepare(
        `UPDATE coupons SET redemptions = redemptions + 1 WHERE code = ?1`,
      )
        .bind(row.coupon_code)
        .run();
      return { bumped: (res.meta?.changes ?? 0) > 0 };
    });

    await step.do('audit-fulfilment', RETRY, async () => {
      const db = getDb(this.env);
      await db.insert(schema.auditLogs).values({
        id: `al_${randomId(8)}`,
        actorId: null,
        action: 'order.fulfilled',
        entityType: 'order',
        entityId: orderId,
        metadata: JSON.stringify({ items: delivered.length, txHash: payment?.txHash ?? null }),
      });
    });

    await step.do('send-delivery-email', MAIL_RETRY, async () => {
      const r = await sendEmail(this.env, {
        to: snapshot.email,
        subject: `Order ${snapshot.orderNumber} — your products are ready`,
        html: orderFulfilledEmail(this.env, {
          orderNumber: snapshot.orderNumber,
          items: delivered,
        }),
      });
      if (r.error && r.error !== 'mailer-not-configured') {
        throw new Error(`mail failed: ${r.error}`);
      }
      return { sent: true };
    });

    /* -------------------------------------------------------------- *
     * 8. Catalog cache bust so freshly-decremented stock is reflected
     * on the storefront.
     * -------------------------------------------------------------- */
    await step.do('bust-catalog-cache', { ...RETRY, retries: { limit: 2, delay: '2 seconds' as const, backoff: 'exponential' as const } }, async () => {
      const v = await this.env.KV.get('catalog:version');
      const next = String((Number(v) || 0) + 1);
      await this.env.KV.put('catalog:version', next);
    });

    return { status: 'fulfilled' };
  }
}
