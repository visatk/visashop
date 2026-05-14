/**
 *  Order fulfilment.
 *
 *  Called once a payment is confirmed. Marks the order paid/fulfilled,
 *  assigns license keys from the available pool, mints presigned R2
 *  download URLs (1 h TTL), and sends the delivery email.
 *
 *  D1 has limited transactional support, so we use atomic UPDATEs
 *  with WHERE-status guards to avoid double-fulfilment under
 *  concurrent webhook + admin actions.
 */
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import type { AppEnv } from '../env';
import { presignDownloadUrl } from './r2';
import { sendEmail, orderFulfilledEmail } from './mail';
import { randomId } from './crypto';

export interface FulfilResult {
  fulfilled: boolean;
  alreadyFulfilled?: boolean;
  insufficientStock?: { productId: string; productName: string }[];
  items?: { name: string; key?: string; downloadUrl?: string }[];
}

export async function fulfilOrder(env: AppEnv, orderId: string): Promise<FulfilResult> {
  const db = getDb(env);

  // Atomically transition pending/paid -> processing using a sentinel.
  const lock = await env.DB.prepare(
    `UPDATE orders SET status = 'fulfilled', fulfilled_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ?1 AND status IN ('paid','partial','awaiting_payment','pending')`,
  )
    .bind(orderId)
    .run();
  if ((lock.meta?.changes ?? 0) === 0) {
    return { fulfilled: false, alreadyFulfilled: true };
  }

  const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1).all();
  const order = orderRows[0];
  if (!order) return { fulfilled: false };

  const itemRows = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all();

  const delivered: { name: string; key?: string; downloadUrl?: string }[] = [];
  const missing: { productId: string; productName: string }[] = [];

  for (const item of itemRows) {
    if (item.deliveredKey || item.licenseKeyId) {
      delivered.push({ name: item.productName, key: item.deliveredKey ?? undefined });
      continue;
    }

    if (item.productType === 'key' || item.productType === 'subscription') {
      // Pop one available key with an atomic update.
      let assignedKey: { id: string; keyValue: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = await db
          .select({ id: schema.licenseKeys.id, keyValue: schema.licenseKeys.keyValue })
          .from(schema.licenseKeys)
          .where(
            and(eq(schema.licenseKeys.productId, item.productId ?? '__none__'), eq(schema.licenseKeys.status, 'available')),
          )
          .limit(1)
          .all();
        if (!candidate[0]) break;
        const upd = await env.DB.prepare(
          `UPDATE license_keys SET status = 'sold', order_item_id = ?1, sold_at = unixepoch()
           WHERE id = ?2 AND status = 'available'`,
        )
          .bind(item.id, candidate[0].id)
          .run();
        if ((upd.meta?.changes ?? 0) === 1) {
          assignedKey = candidate[0];
          break;
        }
      }
      if (!assignedKey) {
        missing.push({ productId: item.productId ?? '', productName: item.productName });
        continue;
      }
      await db
        .update(schema.orderItems)
        .set({ licenseKeyId: assignedKey.id, deliveredKey: assignedKey.keyValue })
        .where(eq(schema.orderItems.id, item.id));
      delivered.push({ name: item.productName, key: assignedKey.keyValue });
    } else if (item.productType === 'file' || item.productType === 'script') {
      // Mint a presigned R2 URL for each file attached to the product.
      const fileRows = await db
        .select()
        .from(schema.productFiles)
        .where(eq(schema.productFiles.productId, item.productId ?? '__none__'))
        .all();
      if (fileRows.length === 0) {
        // Nothing to deliver but mark as delivered (digital placeholder).
        delivered.push({ name: item.productName });
        continue;
      }
      try {
        const url = await presignDownloadUrl(env, fileRows[0].r2Key, 3600, fileRows[0].label);
        delivered.push({ name: item.productName, downloadUrl: url });
      } catch (err) {
        console.error('[fulfil] presign failed', err);
        delivered.push({ name: item.productName });
      }
    } else {
      delivered.push({ name: item.productName });
    }

    if (item.productId) {
      await env.DB.prepare(`UPDATE products SET sales_count = sales_count + ?2, updated_at = unixepoch() WHERE id = ?1`)
        .bind(item.productId, item.quantity)
        .run();
    }
  }

  if (missing.length > 0) {
    // Roll the order back to "paid" so an admin can intervene.
    await env.DB.prepare(`UPDATE orders SET status = 'paid', fulfilled_at = NULL, updated_at = unixepoch() WHERE id = ?1`)
      .bind(orderId)
      .run();
    return { fulfilled: false, insufficientStock: missing };
  }

  // Fire delivery email (best-effort).
  if (order.email) {
    await sendEmail(env, {
      to: order.email,
      subject: `Order ${order.orderNumber} — your products are ready`,
      html: orderFulfilledEmail(env, { orderNumber: order.orderNumber, items: delivered }),
    });
  }

  // Audit
  await db.insert(schema.auditLogs).values({
    id: `al_${randomId(8)}`,
    actorId: null,
    action: 'order.fulfilled',
    entityType: 'order',
    entityId: orderId,
    metadata: JSON.stringify({ items: delivered.length }),
  });

  return { fulfilled: true, items: delivered };
}

export function applyCouponCents(
  subtotalCents: number,
  coupon: { type: 'percent' | 'fixed'; value: number; minSubtotalCents: number; expiresAt: Date | null; isActive: boolean },
): { discount: number; total: number; valid: boolean } {
  if (!coupon.isActive) return { discount: 0, total: subtotalCents, valid: false };
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) return { discount: 0, total: subtotalCents, valid: false };
  if (subtotalCents < coupon.minSubtotalCents) return { discount: 0, total: subtotalCents, valid: false };
  const discount = coupon.type === 'percent'
    ? Math.floor((subtotalCents * Math.min(100, Math.max(0, coupon.value))) / 100)
    : Math.min(subtotalCents, Math.max(0, coupon.value));
  return { discount, total: Math.max(0, subtotalCents - discount), valid: true };
}

export async function expireStaleOrders(env: AppEnv): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE orders SET status = 'expired', updated_at = unixepoch()
     WHERE status IN ('pending','awaiting_payment') AND expires_at IS NOT NULL AND expires_at < unixepoch()`,
  ).run();
  return res.meta?.changes ?? 0;
}
