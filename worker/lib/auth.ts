/**
 *  Session management.
 *
 *  Sessions are stored server-side in D1 (sessions table) and the
 *  client cookie carries an HMAC-signed `<session_id>` token so it
 *  cannot be forged even if the cookie store is leaked separately
 *  from the secret.
 */
import { eq } from 'drizzle-orm';
import { hmacSign, hmacVerify, randomId } from './crypto';
import { getDb, schema } from '../db/client';
import type { AppEnv } from '../env';

export const SESSION_COOKIE = 'vsp_sid';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

function requireSecret(env: AppEnv): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET is not configured (run `wrangler secret put SESSION_SECRET`)');
  }
  return s;
}

export async function createSession(
  env: AppEnv,
  userId: string,
  meta: { userAgent?: string; ip?: string; secure?: boolean },
): Promise<{ id: string; cookie: string; expiresAt: Date }> {
  const id = randomId(24);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000);
  const db = getDb(env);
  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 256),
    ip: meta.ip,
  });
  const sig = await hmacSign(requireSecret(env), id);
  const value = `${id}.${sig}`;
  const cookie = serializeCookie(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: meta.secure ?? true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return { id, cookie, expiresAt };
}

export async function destroySession(env: AppEnv, sessionId: string, secure = true): Promise<string> {
  const db = getDb(env);
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  return serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });
}

export async function getRequestUser(
  req: Request,
  env: AppEnv,
): Promise<
  | {
      id: string;
      email: string;
      name: string | null;
      role: 'user' | 'admin';
      sessionId: string;
    }
  | null
> {
  if (!env.SESSION_SECRET) return null;
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!(await hmacVerify(env.SESSION_SECRET, id, sig))) return null;

  const db = getDb(env);
  const row = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      expiresAt: schema.sessions.expiresAt,
      sessionId: schema.sessions.id,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, id))
    .limit(1)
    .all();
  const r = row[0];
  if (!r) return null;
  if (new Date(r.expiresAt).getTime() < Date.now()) return null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as 'user' | 'admin',
    sessionId: r.sessionId,
  };
}

/* ------------------------------ cookies ----------------------------------- */

interface CookieOpts {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
  maxAge?: number;
  domain?: string;
}

export function serializeCookie(name: string, value: string, opts: CookieOpts = {}): string {
  const parts = [`${name}=${value}`];
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push('Secure');
  if (opts.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}
