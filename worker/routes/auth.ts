import { eq } from 'drizzle-orm';
import { Router, badRequest, forbidden, jsonResponse, ok, readJson, unauthorized } from '../lib/http';
import { hashPassword, verifyPassword, randomId, signToken, verifyToken } from '../lib/crypto';
import { createSession, destroySession, readCookie, SESSION_COOKIE } from '../lib/auth';
import { rateLimit } from '../lib/rate-limit';
import { sendEmail, welcomeEmail, passwordResetEmail } from '../lib/mail';
import { getDb, schema } from '../db/client';

export const authRoutes = new Router()
  /* ---------------------------- Register --------------------------------- */
  .post('/api/auth/register', async (ctx) => {
    const rl = await rateLimit(ctx.env, `register:${ctx.ip}`, 5, 60 * 10);
    if (!rl.allowed) return badRequest('Too many attempts. Try again later.', 429);

    const body = await readJson<{ email: string; password: string; name?: string }>(ctx.request);
    if (!body || !body.email || !body.password) return badRequest('Email and password are required');
    const email = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest('Invalid email');
    if (body.password.length < 8) return badRequest('Password must be at least 8 characters');

    const db = getDb(ctx.env);
    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).all();
    if (existing.length > 0) return badRequest('An account already exists for this email');

    const id = `usr_${randomId(12)}`;
    const passwordHash = await hashPassword(body.password);
    await db.insert(schema.users).values({
      id,
      email,
      passwordHash,
      name: body.name?.slice(0, 80) ?? null,
      role: 'user',
    });

    const session = await createSession(ctx.env, id, {
      userAgent: ctx.request.headers.get('user-agent') ?? undefined,
      ip: ctx.ip,
      secure: ctx.url.protocol === 'https:',
    });
    const headers = new Headers();
    headers.append('Set-Cookie', session.cookie);

    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        to: email,
        subject: `Welcome to ${ctx.env.APP_NAME}`,
        html: welcomeEmail(ctx.env, body.name ?? ''),
      }).then(() => undefined),
    );
    return jsonResponse({ ok: true, data: { id, email, name: body.name ?? null, role: 'user' } }, { headers });
  })
  /* ----------------------------- Login ----------------------------------- */
  .post('/api/auth/login', async (ctx) => {
    const rl = await rateLimit(ctx.env, `login:${ctx.ip}`, 8, 60 * 5);
    if (!rl.allowed) return badRequest('Too many attempts. Try again later.', 429);

    const body = await readJson<{ email: string; password: string }>(ctx.request);
    if (!body) return badRequest('Email and password required');
    const email = body.email?.trim().toLowerCase() ?? '';
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1).all();
    const user = rows[0];
    if (!user) {
      // Equalise timing to make user-enumeration harder.
      // Use a real-shaped (but never-matching) hash so verify takes
      // approximately the same wall-clock time as a real verification.
      await verifyPassword(
        body.password ?? '',
        'pbkdf2$sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      );
      return unauthorized('Invalid email or password');
    }
    const okPw = await verifyPassword(body.password ?? '', user.passwordHash);
    if (!okPw) return unauthorized('Invalid email or password');

    const session = await createSession(ctx.env, user.id, {
      userAgent: ctx.request.headers.get('user-agent') ?? undefined,
      ip: ctx.ip,
      secure: ctx.url.protocol === 'https:',
    });
    const headers = new Headers();
    headers.append('Set-Cookie', session.cookie);
    return jsonResponse(
      { ok: true, data: { id: user.id, email: user.email, name: user.name, role: user.role } },
      { headers },
    );
  })
  /* ----------------------------- Logout ---------------------------------- */
  .post('/api/auth/logout', async (ctx) => {
    // Read the current session id from the cookie (signed) so we kill
    // exactly this device's session, not all of them.
    const raw = readCookie(ctx.request, SESSION_COOKIE);
    let sid = '__none__';
    if (raw) {
      const dot = raw.indexOf('.');
      if (dot > 0) sid = raw.slice(0, dot);
    }
    const cookie = await destroySession(ctx.env, sid, ctx.url.protocol === 'https:');
    const headers = new Headers();
    headers.append('Set-Cookie', cookie);
    return jsonResponse({ ok: true, data: { loggedOut: true } }, { headers });
  })
  /* ------------------------------ Me ------------------------------------- */
  .get('/api/auth/me', async (ctx) => {
    if (!ctx.user) return jsonResponse({ ok: true, data: null });
    return ok({
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      role: ctx.user.role,
    });
  })
  /* ------------------------ Password reset request ----------------------- */
  .post('/api/auth/password/request', async (ctx) => {
    const rl = await rateLimit(ctx.env, `pwreq:${ctx.ip}`, 5, 60 * 10);
    if (!rl.allowed) return badRequest('Too many attempts. Try again later.', 429);
    const body = await readJson<{ email: string }>(ctx.request);
    if (!body?.email) return badRequest('Email required');
    const email = body.email.trim().toLowerCase();
    const db = getDb(ctx.env);
    const rows = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.email, email)).all();
    if (rows[0] && ctx.env.SESSION_SECRET) {
      const token = await signToken(ctx.env.SESSION_SECRET, {
        kind: 'pwreset',
        uid: rows[0].id,
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      });
      const link = `${ctx.env.APP_URL.replace(/\/$/, '')}/reset?token=${encodeURIComponent(token)}`;
      ctx.ctx.waitUntil(
        sendEmail(ctx.env, {
          to: email,
          subject: 'Reset your password',
          html: passwordResetEmail(ctx.env, link),
        }).then(() => undefined),
      );
    }
    // Always return ok to prevent enumeration.
    return ok({ requested: true });
  })
  /* ------------------------ Password reset confirm ----------------------- */
  .post('/api/auth/password/reset', async (ctx) => {
    const body = await readJson<{ token: string; password: string }>(ctx.request);
    if (!body?.token || !body.password) return badRequest('Token and password required');
    if (body.password.length < 8) return badRequest('Password must be at least 8 characters');
    if (!ctx.env.SESSION_SECRET) return forbidden('Server not configured');
    const payload = await verifyToken<{ kind: string; uid: string; exp: number }>(ctx.env.SESSION_SECRET, body.token);
    if (!payload || payload.kind !== 'pwreset' || payload.exp < Math.floor(Date.now() / 1000)) {
      return badRequest('Invalid or expired token');
    }
    const hash = await hashPassword(body.password);
    const db = getDb(ctx.env);
    await db.update(schema.users).set({ passwordHash: hash }).where(eq(schema.users.id, payload.uid));
    // Invalidate sessions
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, payload.uid));
    return ok({ reset: true });
  });
