import { and, eq, sql, desc } from 'drizzle-orm';
import { Router, badRequest, notFound, ok, readJson } from '../lib/http';
import { newOrderNumber, randomId, signToken, verifyToken } from '../lib/crypto';
import { rateLimit } from '../lib/rate-limit';
import { getDb, schema } from '../db/client';
import { applyCouponCents } from '../lib/fulfillment';
import { generateAddress, tickerRate, fiatCentsToCryptoMinor, CRYPTO_DECIMALS } from '../lib/apirone';
import { presignDownloadUrl } from '../lib/r2';

const ORDER_LIFETIME_SECONDS = 60 * 60; // 60-minute payment window

interface CheckoutBody {
  email: string;
  cryptoCurrency: string;
  couponCode?: string;
  items: { slug: string; quantity: number }[];
}

export const checkoutRoutes = new Router()
  /* --------------------------- Quote --------------------------------- */
  .post('/api/checkout/quote', async (ctx) => {
    const body = await readJson<CheckoutBody>(ctx.request);
    if (!body || !Array.isArray(body.items) || body.items.length === 0) return badRequest('Cart is empty');
    const db = getDb(ctx.env);

    let subtotal = 0;
    const lineItems: {
      product: typeof schema.products.$inferSelect;
      quantity: number;
    }[] = [];
    for (const it of body.items) {
      const q = Math.min(20, Math.max(1, Math.round(it.quantity)));
      const rows = await db
        .select()
        .from(schema.products)
        .where(and(eq(schema.products.slug, it.slug), eq(schema.products.isActive, true)))
        .limit(1)
        .all();
      const p = rows[0];
      if (!p) return badRequest(`Product not found: ${it.slug}`);
      lineItems.push({ product: p, quantity: q });
      subtotal += p.priceCents * q;
    }

    let discount = 0;
    let couponValid = false;
    if (body.couponCode) {
      const cp = await db
        .select()
        .from(schema.coupons)
        .where(eq(schema.coupons.code, body.couponCode.trim().toUpperCase()))
        .limit(1)
        .all();
      if (cp[0]) {
        const r = applyCouponCents(subtotal, cp[0]);
        discount = r.discount;
        couponValid = r.valid;
      }
    }
    const total = Math.max(0, subtotal - discount);

    let cryptoQuote: {
      currency: string;
      decimals: number;
      amountStr: string;
      amountDisplay: string;
      fiatPerCrypto: number;
    } | null = null;
    if (body.cryptoCurrency) {
      try {
        const rate = await tickerRate(ctx.env, body.cryptoCurrency, 'usd', 60);
        const conv = fiatCentsToCryptoMinor(total, rate, body.cryptoCurrency);
        cryptoQuote = {
          currency: body.cryptoCurrency,
          decimals: conv.decimals,
          amountStr: conv.amountStr,
          amountDisplay: conv.amountDisplay,
          fiatPerCrypto: rate,
        };
      } catch (err) {
        console.warn('quote: ticker failed', err);
      }
    }

    return ok({
      currency: ctx.env.APP_CURRENCY,
      subtotalCents: subtotal,
      discountCents: discount,
      totalCents: total,
      couponValid,
      lineItems: lineItems.map(({ product, quantity }) => ({
        slug: product.slug,
        name: product.name,
        unitPriceCents: product.priceCents,
        quantity,
        type: product.type,
      })),
      cryptoQuote,
    });
  })

  /* --------------------------- Place order ----------------------------- */
  .post('/api/checkout', async (ctx) => {
    const rl = await rateLimit(ctx.env, `checkout:${ctx.ip}`, 12, 60 * 5);
    if (!rl.allowed) return badRequest('Too many checkouts. Slow down.', 429);

    const body = await readJson<CheckoutBody>(ctx.request);
    if (!body || !Array.isArray(body.items) || body.items.length === 0) return badRequest('Cart is empty');
    const email = (body.email ?? ctx.user?.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest('Valid email is required');
    const cryptoCurrency = (body.cryptoCurrency || ctx.env.APIRONE_TICKER_DEFAULT).toLowerCase();
    if (!CRYPTO_DECIMALS[cryptoCurrency]) return badRequest('Unsupported cryptocurrency');

    const db = getDb(ctx.env);

    /* Build items + lock prices */
    let subtotal = 0;
    const items: {
      productId: string;
      productName: string;
      productSlug: string;
      productType: string;
      unitPriceCents: number;
      quantity: number;
      durationDays: number | null;
    }[] = [];
    for (const it of body.items) {
      const q = Math.min(20, Math.max(1, Math.round(it.quantity)));
      const rows = await db.select().from(schema.products).where(and(eq(schema.products.slug, it.slug), eq(schema.products.isActive, true))).limit(1).all();
      const p = rows[0];
      if (!p) return badRequest(`Product not found: ${it.slug}`);

      // Stock check for keyed products
      if (p.type === 'key' || p.type === 'subscription') {
        const stock = await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.licenseKeys)
          .where(and(eq(schema.licenseKeys.productId, p.id), eq(schema.licenseKeys.status, 'available')))
          .all();
        if (Number(stock[0]?.n ?? 0) < q) return badRequest(`Out of stock: ${p.name}`);
      }
      subtotal += p.priceCents * q;
      items.push({
        productId: p.id,
        productName: p.name,
        productSlug: p.slug,
        productType: p.type,
        unitPriceCents: p.priceCents,
        quantity: q,
        durationDays: p.durationDays ?? null,
      });
    }

    /* Coupon */
    let discount = 0;
    let couponCode: string | null = null;
    if (body.couponCode) {
      const cp = await db
        .select()
        .from(schema.coupons)
        .where(eq(schema.coupons.code, body.couponCode.trim().toUpperCase()))
        .limit(1)
        .all();
      if (cp[0]) {
        const r = applyCouponCents(subtotal, cp[0]);
        if (r.valid) {
          discount = r.discount;
          couponCode = cp[0].code;
        }
      }
    }
    const total = Math.max(0, subtotal - discount);
    if (total <= 0) return badRequest('Order total must be positive');

    /* Crypto rate + amount */
    let rate: number;
    try {
      rate = await tickerRate(ctx.env, cryptoCurrency, 'usd', 60);
    } catch (err) {
      console.error('ticker failed', err);
      return badRequest('Could not fetch exchange rate. Try again in a moment.', 502);
    }
    const cryptoAmount = fiatCentsToCryptoMinor(total, rate, cryptoCurrency);

    /* Create order id + number */
    const orderId = `ord_${randomId(12)}`;
    const orderNumber = newOrderNumber();
    const expiresAt = new Date(Date.now() + ORDER_LIFETIME_SECONDS * 1000);

    /* Generate Apirone deposit address (with HMAC-protected callback URL) */
    if (!ctx.env.WEBHOOK_SECRET) return badRequest('Server is not configured for payments yet (WEBHOOK_SECRET missing)');
    const cbToken = await signToken(ctx.env.WEBHOOK_SECRET, { orderId, exp: Math.floor(expiresAt.getTime() / 1000) + 86400 });
    const callbackUrl = `${ctx.env.APP_URL.replace(/\/$/, '')}/api/webhooks/apirone?token=${encodeURIComponent(cbToken)}`;

    let cryptoAddress = '';
    try {
      const r = await generateAddress(ctx.env, {
        callbackUrl,
        data: { order_id: orderId, order_number: orderNumber },
      });
      cryptoAddress = r.address;
    } catch (err) {
      console.error('apirone address failed', err);
      return badRequest('Could not create payment address. Try again in a moment.', 502);
    }

    /* Persist order + items */
    await db.insert(schema.orders).values({
      id: orderId,
      orderNumber,
      userId: ctx.user?.id ?? null,
      email,
      status: 'awaiting_payment',
      currency: ctx.env.APP_CURRENCY,
      subtotalCents: subtotal,
      discountCents: discount,
      totalCents: total,
      couponCode,
      cryptoCurrency,
      cryptoUnits: minorUnitName(cryptoCurrency),
      cryptoAmount: cryptoAmount.amountStr,
      cryptoAddress,
      cryptoRate: String(rate),
      expiresAt,
      ipAddress: ctx.ip,
      userAgent: ctx.request.headers.get('user-agent')?.slice(0, 256) ?? null,
    });
    for (const it of items) {
      await db.insert(schema.orderItems).values({
        id: `oit_${randomId(12)}`,
        orderId,
        productId: it.productId,
        productName: it.productName,
        productSlug: it.productSlug,
        productType: it.productType,
        unitPriceCents: it.unitPriceCents,
        quantity: it.quantity,
        durationDays: it.durationDays,
      });
    }

    /* Public order token (used by the success page so unauthenticated
       users can poll their order status without leaking IDs). */
    if (!ctx.env.SESSION_SECRET) return badRequest('Server not configured');
    const orderToken = await signToken(ctx.env.SESSION_SECRET, { kind: 'order', oid: orderId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 });
    const payUrl = `${ctx.env.APP_URL.replace(/\/$/, '')}/orders/${orderId}?t=${encodeURIComponent(orderToken)}`;

    /* Spawn the order lifecycle workflow. It owns the payment-instructions
       email, the wait-for-payment timeout, the per-item delivery, and
       the delivery email — all with retries + checkpoints. */
    try {
      await ctx.env.ORDER_WORKFLOW.create({
        id: orderId,
        params: { orderId },
      });
    } catch (err) {
      // Don't fail checkout if the workflow couldn't start — the order
      // is persisted and admin can retry. Log loudly.
      console.error('order workflow create failed', err);
    }

    return ok({
      orderId,
      orderNumber,
      payUrl,
      orderToken,
      total: { cents: total, currency: ctx.env.APP_CURRENCY },
      crypto: {
        currency: cryptoCurrency,
        address: cryptoAddress,
        amountStr: cryptoAmount.amountStr,
        amountDisplay: cryptoAmount.amountDisplay,
        decimals: cryptoAmount.decimals,
        rate,
      },
      expiresAt: expiresAt.toISOString(),
    });
  })
  /* --------------------------- Order status (token) ----------------------- */
  .get('/api/orders/:id', async (ctx, params) => {
    const token = ctx.url.searchParams.get('t') ?? '';
    const db = getDb(ctx.env);
    const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, params.id)).limit(1).all();
    const order = orderRows[0];
    if (!order) return notFound('Order not found');

    // Authorisation: either logged-in owner OR a valid order token.
    let authorised = ctx.user?.id && order.userId === ctx.user.id;
    if (!authorised && ctx.user?.role === 'admin') authorised = true;
    if (!authorised && token && ctx.env.SESSION_SECRET) {
      const payload = await verifyToken<{ kind: string; oid: string; exp: number }>(ctx.env.SESSION_SECRET, token);
      if (payload && payload.kind === 'order' && payload.oid === order.id && payload.exp > Math.floor(Date.now() / 1000)) {
        authorised = true;
      }
    }
    if (!authorised) return notFound('Order not found');

    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id)).all();
    return ok({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      crypto: {
        currency: order.cryptoCurrency,
        address: order.cryptoAddress,
        amountMinor: order.cryptoAmount,
        received: order.cryptoReceived,
        confirmations: order.paymentConfirmations,
        txHash: order.paymentTxHash,
        rate: order.cryptoRate,
      },
      expiresAt: order.expiresAt ? new Date(order.expiresAt).toISOString() : null,
      fulfilledAt: order.fulfilledAt ? new Date(order.fulfilledAt).toISOString() : null,
      createdAt: new Date(order.createdAt).toISOString(),
      items: items.map((it) => ({
        id: it.id,
        productSlug: it.productSlug,
        productName: it.productName,
        productType: it.productType,
        unitPriceCents: it.unitPriceCents,
        quantity: it.quantity,
        deliveredKey: it.deliveredKey,
      })),
    });
  })
  /* ------------------------ Order downloads ------------------------ */
  .get('/api/orders/:id/download/:itemId', async (ctx, params) => {
    const token = ctx.url.searchParams.get('t') ?? '';
    const db = getDb(ctx.env);
    const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, params.id)).limit(1).all();
    const order = orderRows[0];
    if (!order) return notFound('Order not found');

    let authorised = ctx.user?.id && order.userId === ctx.user.id;
    if (!authorised && ctx.user?.role === 'admin') authorised = true;
    if (!authorised && token && ctx.env.SESSION_SECRET) {
      const payload = await verifyToken<{ kind: string; oid: string; exp: number }>(ctx.env.SESSION_SECRET, token);
      if (payload && payload.kind === 'order' && payload.oid === order.id && payload.exp > Math.floor(Date.now() / 1000)) {
        authorised = true;
      }
    }
    if (!authorised) return notFound('Order not found');
    if (order.status !== 'fulfilled') return badRequest('Order is not yet fulfilled');

    const itemRows = await db.select().from(schema.orderItems).where(and(eq(schema.orderItems.id, params.itemId), eq(schema.orderItems.orderId, order.id))).limit(1).all();
    const item = itemRows[0];
    if (!item || !item.productId) return notFound('Item not found');

    const fileRows = await db.select().from(schema.productFiles).where(eq(schema.productFiles.productId, item.productId)).orderBy(desc(schema.productFiles.createdAt)).limit(1).all();
    if (!fileRows[0]) return notFound('Download not available');
    try {
      const url = await presignDownloadUrl(ctx.env, fileRows[0].r2Key, 600, fileRows[0].label);
      return Response.redirect(url, 302);
    } catch (err) {
      console.error('presign failed', err);
      return badRequest('Download temporarily unavailable', 503);
    }
  });

function minorUnitName(crypto: string): string {
  switch (crypto) {
    case 'btc': return 'satoshi';
    case 'ltc': return 'litoshi';
    case 'doge': return 'koinu';
    case 'bch': return 'satoshi';
    default: return 'minor';
  }
}
