/**
 *  Shared response helpers and a tiny pattern-matching router.
 *
 *  The router supports `:param` path placeholders and pre/post
 *  middlewares. All handlers receive a `RequestContext` so they
 *  can read the resolved user, env, KV cache, etc.
 */
import type { AppEnv, RequestContext } from '../env';
import { getRequestUser } from './auth';

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function textResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=utf-8');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(body, { ...init, headers });
}

export function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(body, { ...init, headers });
}

export function badRequest(message: string, code = 400): Response {
  return jsonResponse({ ok: false, error: message }, { status: code });
}

export function unauthorized(message = 'Unauthorized'): Response {
  return jsonResponse({ ok: false, error: message }, { status: 401 });
}

export function forbidden(message = 'Forbidden'): Response {
  return jsonResponse({ ok: false, error: message }, { status: 403 });
}

export function notFound(message = 'Not found'): Response {
  return jsonResponse({ ok: false, error: message }, { status: 404 });
}

export function ok<T>(data: T): Response {
  return jsonResponse({ ok: true, data });
}

/* ----------------------------- Tiny router -------------------------------- */

export type Handler = (ctx: RequestContext, params: Record<string, string>) => Promise<Response> | Response;

export interface RouteDef {
  method: string;
  pattern: string;
  handler: Handler;
}

interface CompiledRoute {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const trimmed = pattern.length > 1 ? pattern.replace(/\/+$/, '') : pattern;
  // Escape regex meta-chars except ":" (params) and "*" (wildcard).
  const safe = trimmed.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    '^' +
      safe
        .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (m) => {
          keys.push(m.slice(1));
          return '([^/]+)';
        })
        .replace(/\*/g, '.*') +
      '$',
  );
  return { regex, keys };
}

export class Router {
  readonly routes: CompiledRoute[] = [];
  /** Append every route from another router into this one. */
  merge(other: Router): this {
    for (const r of other.routes) this.routes.push(r);
    return this;
  }
  add(method: string, pattern: string, handler: Handler) {
    const { regex, keys } = compile(pattern);
    this.routes.push({ method: method.toUpperCase(), regex, keys, handler });
    return this;
  }
  get(pattern: string, handler: Handler) { return this.add('GET', pattern, handler); }
  post(pattern: string, handler: Handler) { return this.add('POST', pattern, handler); }
  put(pattern: string, handler: Handler) { return this.add('PUT', pattern, handler); }
  patch(pattern: string, handler: Handler) { return this.add('PATCH', pattern, handler); }
  delete(pattern: string, handler: Handler) { return this.add('DELETE', pattern, handler); }

  async handle(ctx: RequestContext): Promise<Response | null> {
    const method = ctx.request.method.toUpperCase();
    let path = ctx.url.pathname;
    if (path.length > 1) path = path.replace(/\/+$/, '');
    for (const r of this.routes) {
      if (r.method !== method && r.method !== 'ANY') continue;
      const m = path.match(r.regex);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      try {
        return await r.handler(ctx, params);
      } catch (err) {
        console.error('route error', err);
        return jsonResponse(
          { ok: false, error: 'Internal server error' },
          { status: 500 },
        );
      }
    }
    return null;
  }
}

export async function buildContext(
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
): Promise<RequestContext> {
  const url = new URL(request.url);
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    '0.0.0.0';
  const user = await getRequestUser(request, env);
  return { env, ctx, request, url, user, ip };
}

export async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function corsPreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': req.headers.get('Origin') ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  });
}
