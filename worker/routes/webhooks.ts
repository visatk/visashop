/**
 *  Apirone callbacks land here.
 *
 *  We require a valid `?token=` HMAC signed at order-creation time;
 *  the token binds the callback to a specific orderId and has its own
 *  expiry. Verified callbacks update the order's bookkeeping fields
 *  (received amount, confirmations, tx hash) and — when the threshold
 *  is met — forward a `payment-confirmed` event to the order's
 *  Workflow instance. The workflow owns retries, fulfilment, and the
 *  delivery email.
 *
 *  Apirone expects a `*ok*` (text/plain) response to mark the
 *  notification as delivered.
 *  https://apirone.com/docs/receiving-callbacks/
 */
import { eq } from 'drizzle-orm';
import { Router, badRequest, textResponse } from '../lib/http';
import { verifyToken, randomId } from '../lib/crypto';
import { getDb, schema } from '../db/client';
import { bigStrGte, bigStrGt, bigStrMax } from '../lib/apirone';
import type { PaymentConfirmedEvent, RequestContext } from '../env';

interface ApironeCallbackBody {
  value?: number | string;
  input_address?: string;
  confirmations?: number;
  input_transaction_hash?: string;
  data?: Record<string, unknown>;
  account?: string;
  currency?: string;
  transaction_hash?: string;
  payment?: string;
  destinations?: { address: string; amount: number | string }[];
  /* v1 forwarding flat parameters */
  destination_address?: string;
  value_forwarded?: number | string;
}

async function handleCallback(ctx: RequestContext): Promise<Response> {
  const token = ctx.url.searchParams.get('token') ?? '';
  if (!ctx.env.WEBHOOK_SECRET) {
    console.error('[webhook] WEBHOOK_SECRET missing');
    return textResponse('*ok*');
  }
  const payload = await verifyToken<{ orderId: string; exp: number }>(ctx.env.WEBHOOK_SECRET, token);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    console.warn('[webhook] invalid/expired token');
    return badRequest('invalid token', 401);
  }

  /* Apirone v2 wallet callbacks POST JSON; v1 forwarding callbacks GET. */
  let body: ApironeCallbackBody = {};
  if (ctx.request.method === 'POST') {
    try {
      body = (await ctx.request.json()) as ApironeCallbackBody;
    } catch {
      /* empty body fine */
    }
  } else {
    body = Object.fromEntries(ctx.url.searchParams.entries()) as unknown as ApironeCallbackBody;
  }

  const db = getDb(ctx.env);
  const rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, payload.orderId))
    .limit(1)
    .all();
  const order = rows[0];
  if (!order) {
    console.warn('[webhook] order not found', payload.orderId);
    return textResponse('*ok*');
  }

  /* Sanity: the address must match the address we generated. */
  const reportedAddress = body.input_address ?? '';
  if (reportedAddress && order.cryptoAddress && reportedAddress !== order.cryptoAddress) {
    console.warn('[webhook] address mismatch', { expected: order.cryptoAddress, got: reportedAddress });
    return textResponse('*ok*');
  }

  const valueStr = String(body.value ?? '0').replace(/[^\d-]/g, '') || '0';
  const confirmations = Math.max(0, Math.floor(Number(body.confirmations ?? 0)));
  const required = parseInt(ctx.env.APIRONE_REQUIRED_CONFIRMATIONS ?? '1', 10) || 1;
  const incomingTx = body.transaction_hash || body.input_transaction_hash || null;
  const newReceived = bigStrMax(order.cryptoReceived ?? '0', valueStr);
  const newConfirmations = Math.max(order.paymentConfirmations, confirmations);

  /* Always persist the latest bookkeeping (idempotent). */
  await db
    .update(schema.orders)
    .set({
      cryptoReceived: newReceived,
      paymentConfirmations: newConfirmations,
      paymentTxHash: incomingTx ?? order.paymentTxHash,
      updatedAt: new Date(),
    })
    .where(eq(schema.orders.id, order.id));

  /* Audit every callback for forensic purposes. */
  await db.insert(schema.auditLogs).values({
    id: `al_${randomId(8)}`,
    actorId: null,
    action: 'webhook.apirone',
    entityType: 'order',
    entityId: order.id,
    metadata: JSON.stringify({
      value: valueStr,
      confirmations,
      tx: incomingTx,
      currency: body.currency,
    }),
    ip: ctx.ip,
  });

  const expected = order.cryptoAmount ?? '0';
  const fullyPaid = bigStrGte(newReceived, expected) && BigInt(expected) > 0n;
  const partiallyPaid = bigStrGt(newReceived, '0') && !fullyPaid;

  /* Update partial-payment indicator before deciding whether to dispatch. */
  if (newConfirmations === 0) {
    if (order.status === 'awaiting_payment' && partiallyPaid) {
      await db.update(schema.orders).set({ status: 'partial' }).where(eq(schema.orders.id, order.id));
    }
    return textResponse('*ok*');
  }

  if (fullyPaid && newConfirmations >= required) {
    /* Forward the event to the order's workflow instance. The
       workflow's `waitForEvent` consumer is idempotent — repeated
       deliveries are safe (the wait resolves once and additional
       events are simply discarded). */
    try {
      const instance = await ctx.env.ORDER_WORKFLOW.get(order.id);
      const ev: PaymentConfirmedEvent = {
        txHash: incomingTx,
        confirmations: newConfirmations,
        receivedMinor: newReceived,
      };
      await instance.sendEvent({ type: 'payment-confirmed', payload: ev });
    } catch (err) {
      // No live instance — could be that workflow creation failed at
      // checkout, or the instance has already completed (subsequent
      // confirmations after fulfilment). Try recreating the workflow
      // from scratch so payment is still fulfilled. This is safe
      // because every step re-checks `delivered_key` before doing work.
      console.warn('[webhook] sendEvent failed, attempting recovery', order.id, (err as Error).message);
      try {
        await ctx.env.ORDER_WORKFLOW.create({
          id: order.id,
          params: { orderId: order.id },
        });
      } catch (createErr) {
        // If the instance already exists in a terminal state, create
        // throws — that's fine, the workflow already finished.
        console.warn('[webhook] workflow recovery skipped', order.id, (createErr as Error).message);
      }
    }
    return textResponse('*ok*');
  }

  if (partiallyPaid && order.status === 'awaiting_payment') {
    await db.update(schema.orders).set({ status: 'partial' }).where(eq(schema.orders.id, order.id));
  }
  return textResponse('*ok*');
}

export const webhookRoutes = new Router()
  .post('/api/webhooks/apirone', (ctx) => handleCallback(ctx))
  .get('/api/webhooks/apirone', (ctx) => handleCallback(ctx));
