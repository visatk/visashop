import { and, eq } from 'drizzle-orm';
import { Router, badRequest, forbidden, jsonResponse, ok, readJson, unauthorized } from '../lib/http';
import { hashPassword, verifyPassword, randomId, signToken, verifyToken } from '../lib/crypto';
import { createSession, destroySession, readCookie, SESSION_COOKIE } from '../lib/auth';
import { rateLimit } from '../lib/rate-limit';
import { sendEmail, welcomeEmail, passwordResetEmail } from '../lib/mail';
import { getDb, schema } from '../db/client';
import {
  authorizeUrl,
  exchangeAndProfile,
  isOAuthEnabled,
  signState,
  verifyState,
  type OAuthProvider,
} from '../lib/oauth';

const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'github'];

function isOAuthProvider(p: string): p is OAuthProvider {
  return (OAUTH_PROVIDERS as string[]).includes(p);
}

function safeNext(raw: string | null): string {
  // Only allow same-origin paths so an attacker can't hijack the
  // OAuth flow into open-redirecting a victim.
  if (!raw) return '/account';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/account';
  return raw.slice(0, 256);
}

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
    if (!user || !user.passwordHash) {
      // Equalise timing to make user-enumeration harder. Also covers the
      // OAuth-only case where the user has no password set yet.
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
  /* ----------------------- OAuth provider discovery ---------------------- */
  .get('/api/auth/oauth/providers', (ctx) =>
    ok({
      google: isOAuthEnabled(ctx.env, 'google'),
      github: isOAuthEnabled(ctx.env, 'github'),
    }),
  )
  /* ----------------------- OAuth: kick off the dance --------------------- */
  .get('/api/auth/oauth/:provider/start', async (ctx, params) => {
    const provider = params.provider;
    if (!isOAuthProvider(provider)) return badRequest('Unknown provider', 404);
    if (!isOAuthEnabled(ctx.env, provider)) return badRequest(`${provider} sign-in is not configured`, 503);
    if (!ctx.env.SESSION_SECRET) return forbidden('Server not configured');

    const state = await signState(ctx.env, {
      n: randomId(8),
      next: safeNext(ctx.url.searchParams.get('next')),
      exp: Math.floor(Date.now() / 1000) + 60 * 5,
      p: provider,
    });
    return Response.redirect(authorizeUrl(ctx.env, provider, state), 302);
  })
  /* ----------------------- OAuth: provider callback ---------------------- */
  .get('/api/auth/oauth/:provider/callback', async (ctx, params) => {
    const provider = params.provider;
    if (!isOAuthProvider(provider)) return badRequest('Unknown provider', 404);

    const error = ctx.url.searchParams.get('error');
    const errorDesc = ctx.url.searchParams.get('error_description');
    if (error) {
      const msg = encodeURIComponent(errorDesc ?? error);
      return Response.redirect(`${ctx.env.APP_URL.replace(/\/$/, '')}/login?oauth_error=${msg}`, 302);
    }

    const code = ctx.url.searchParams.get('code');
    const stateRaw = ctx.url.searchParams.get('state');
    if (!code || !stateRaw) return badRequest('Missing code or state');

    const state = await verifyState(ctx.env, stateRaw);
    if (!state || state.p !== provider) return badRequest('Invalid or expired state');

    let profile;
    try {
      profile = await exchangeAndProfile(ctx.env, provider, code);
    } catch (err) {
      console.error('[oauth] exchange failed', provider, err);
      const msg = encodeURIComponent('We could not complete the sign-in. Please try again.');
      return Response.redirect(`${ctx.env.APP_URL.replace(/\/$/, '')}/login?oauth_error=${msg}`, 302);
    }

    if (!profile.email) {
      const msg = encodeURIComponent('Your provider did not share a verified email. Add a verified email and try again.');
      return Response.redirect(`${ctx.env.APP_URL.replace(/\/$/, '')}/login?oauth_error=${msg}`, 302);
    }

    const db = getDb(ctx.env);
    const email = profile.email.toLowerCase();

    // 1) Already linked? — same provider + subject lands the same user
    //    every time, even if they later changed their primary email.
    const linked = await db
      .select({ userId: schema.oauthAccounts.userId })
      .from(schema.oauthAccounts)
      .where(
        and(eq(schema.oauthAccounts.provider, provider), eq(schema.oauthAccounts.subject, profile.subject)),
      )
      .limit(1)
      .all();

    let userId: string | null = linked[0]?.userId ?? null;
    let createdAccount = false;

    if (!userId) {
      // 2) Try matching by verified email so existing email/password users
      //    can opt into social sign-in seamlessly.
      if (profile.emailVerified) {
        const existing = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1)
          .all();
        if (existing[0]) userId = existing[0].id;
      }

      // 3) Otherwise create a new user. OAuth-only users have a NULL
      //    password hash; they can set one later via the password reset
      //    flow if they want a fallback login.
      if (!userId) {
        userId = `usr_${randomId(12)}`;
        await db.insert(schema.users).values({
          id: userId,
          email,
          passwordHash: null,
          name: profile.name?.slice(0, 80) ?? null,
          role: 'user',
          emailVerified: profile.emailVerified,
        });
        createdAccount = true;
      }

      // Persist the link so subsequent logins go through path (1).
      try {
        await db.insert(schema.oauthAccounts).values({
          id: `oa_${randomId(8)}`,
          userId,
          provider,
          subject: profile.subject,
          email,
        });
      } catch (err) {
        // Possible UNIQUE conflict from a parallel request — not fatal.
        console.warn('[oauth] account link insert skipped', err);
      }
    }

    // Audit so admins can see the surface area of social logins.
    ctx.ctx.waitUntil(
      db
        .insert(schema.auditLogs)
        .values({
          id: `al_${randomId(8)}`,
          actorId: userId,
          action: createdAccount ? 'auth.oauth.signup' : 'auth.oauth.login',
          entityType: 'user',
          entityId: userId,
          metadata: JSON.stringify({ provider }),
          ip: ctx.ip,
        })
        .then(() => undefined)
        .catch(() => undefined),
    );

    if (createdAccount) {
      ctx.ctx.waitUntil(
        sendEmail(ctx.env, {
          to: email,
          subject: `Welcome to ${ctx.env.APP_NAME}`,
          html: welcomeEmail(ctx.env, profile.name ?? ''),
        }).then(() => undefined),
      );
    }

    const session = await createSession(ctx.env, userId, {
      userAgent: ctx.request.headers.get('user-agent') ?? undefined,
      ip: ctx.ip,
      secure: ctx.url.protocol === 'https:',
    });
    const headers = new Headers();
    headers.append('Set-Cookie', session.cookie);
    headers.set('Location', `${ctx.env.APP_URL.replace(/\/$/, '')}${state.next}`);
    return new Response(null, { status: 302, headers });
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
