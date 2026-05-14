import { desc, eq } from 'drizzle-orm';
import { Router, badRequest, forbidden, ok, readJson, unauthorized } from '../lib/http';
import { getDb, schema } from '../db/client';
import { hashPassword, verifyPassword } from '../lib/crypto';

export const accountRoutes = new Router()
  .get('/api/account/orders', async (ctx) => {
    if (!ctx.user) return unauthorized();
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.orders).where(eq(schema.orders.userId, ctx.user.id)).orderBy(desc(schema.orders.createdAt)).limit(50).all();
    return ok(rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      currency: o.currency,
      totalCents: o.totalCents,
      cryptoCurrency: o.cryptoCurrency,
      createdAt: new Date(o.createdAt).toISOString(),
      fulfilledAt: o.fulfilledAt ? new Date(o.fulfilledAt).toISOString() : null,
    })));
  })
  .patch('/api/account/profile', async (ctx) => {
    if (!ctx.user) return unauthorized();
    const body = await readJson<{ name?: string; password?: string; currentPassword?: string }>(ctx.request);
    if (!body) return badRequest('Body required');
    const db = getDb(ctx.env);
    const updates: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.name === 'string') updates.name = body.name.slice(0, 80);
    if (body.password) {
      if (body.password.length < 8) return badRequest('Password must be at least 8 chars');
      const u = await db.select({ ph: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, ctx.user.id)).limit(1).all();
      if (!u[0]) return forbidden();
      if (!body.currentPassword || !(await verifyPassword(body.currentPassword, u[0].ph))) {
        return badRequest('Current password is incorrect');
      }
      updates.passwordHash = await hashPassword(body.password);
    }
    await db.update(schema.users).set(updates).where(eq(schema.users.id, ctx.user.id));
    return ok({ updated: true });
  });
