/**
 *  Apirone callbacks land here. We require a valid `?token=` HMAC
 *  signed at order-creation time. The token binds the callback to
 *  a specific orderId and has its own expiry.
 *
 *  Apirone expects the response body `*ok*` (text/plain) for the
 *  payment to be marked delivered on their side.
 *  https://apirone.com/docs/receiving-callbacks/
 */
import { eq } from 'drizzle-orm';
import { Router, badRequest, textResponse } from '../lib/http';
import { verifyToken, randomId } from '../lib/crypto';
import { getDb, schema } from '../db/client';
import { fulfilOrder } from '../lib/fulfillment';
import { bigStrGte, bigStrGt, bigStrMax } from '../lib/apirone';

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

async function handleCallback(ctx: import('../env').RequestContext): Promise<Response> {
  const token = ctx.url.searchParams.get('token') ?? '';
  if (!ctx.env.WEBHOOK_SECRET) {
    console.error('[webhook] WEBHOOK_SECRET missing');
    // Still respond *ok* so retries don't pile up while we fix it.
    return textResponse('*ok*');
  }
  const payload = await verifyToken<{ orderId: string; exp: number }>(ctx.env.WEBHOOK_SECRET, token);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    console.warn('[webhook] invalid/expired token');
    return badRequest('invalid token', 401);
  }

  // Body is sent as JSON for v2 wallet callbacks; for v1 forwarding callbacks
  // Apirone uses GET with query parameters.
  let body: ApironeCallbackBody = {};
  if (ctx.request.method === 'POST') {
    try {
      body = (await ctx.request.json()) as ApironeCallbackBody;
    } catch {
      /* ignore */
    }
  } else {
    body = Object.fromEntries(ctx.url.searchParams.entries()) as unknown as ApironeCallbackBody;
  }

  const db = getDb(ctx.env);
  const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, payload.orderId)).limit(1).all();
  const order = rows[0];
  if (!order) {
    console.warn('[webhook] order not found', payload.orderId);
    // Still respond ok so Apirone stops retrying — order probably purged.
    return textResponse('*ok*');
  }

  // Sanity: address in body must match the address we generated.
  // Apirone v2 sends `input_address`; v1 forwarding the same.
  const reportedAddress = body.input_address ?? '';
  if (reportedAddress && order.cryptoAddress && reportedAddress !== order.cryptoAddress) {
    console.warn('[webhook] address mismatch', { expected: order.cryptoAddress, got: reportedAddress });
    // Still respond ok — we don't want Apirone hammering us — but ignore the payload.
    return textResponse('*ok*');
  }

  const valueStr = String(body.value ?? '0').replace(/[^\d-]/g, '') || '0';
  const confirmations = Math.max(0, Math.floor(Number(body.confirmations ?? 0)));
  const required = parseInt(ctx.env.APIRONE_REQUIRED_CONFIRMATIONS ?? '1', 10) || 1;
  const incomingTx = body.transaction_hash || body.input_transaction_hash || null;

  // Idempotency: the same tx may be reported many times as confirmations grow.
  // We always update the latest confirmations / txHash, then act on state.
  const newReceived = bigStrMax(order.cryptoReceived ?? '0', valueStr);
  const newConfirmations = Math.max(order.paymentConfirmations, confirmations);

  await db
    .update(schema.orders)
    .set({
      cryptoReceived: newReceived,
      paymentConfirmations: newConfirmations,
      paymentTxHash: incomingTx ?? order.paymentTxHash,
      updatedAt: new Date(),
    })
    .where(eq(schema.orders.id, order.id));

  // Audit
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

  // Status transitions
  if (newConfirmations === 0) {
    if (order.status === 'awaiting_payment' && partiallyPaid) {
      await db.update(schema.orders).set({ status: 'partial' }).where(eq(schema.orders.id, order.id));
    }
    return textResponse('*ok*');
  }
  if (fullyPaid && newConfirmations >= required) {
    // Atomically transition to 'paid' so concurrent admin or webhook
    // requests don't double-fulfil.
    await ctx.env.DB.prepare(
      `UPDATE orders SET status = 'paid', updated_at = unixepoch()
       WHERE id = ?1 AND status IN ('awaiting_payment','partial','pending')`,
    )
      .bind(order.id)
      .run();
    const result = await fulfilOrder(ctx.env, order.id);
    if (!result.fulfilled && !result.alreadyFulfilled) {
      console.warn('[webhook] fulfilment incomplete', order.id, result.insufficientStock);
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
