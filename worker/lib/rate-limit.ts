/**
 *  Token-bucket-ish rate limiter backed by Workers KV.
 *
 *  KV has eventual consistency, which is fine for abuse mitigation
 *  but not strict accounting. For hot endpoints (login, checkout)
 *  we treat KV as a soft ceiling — any breach is an audit event.
 */
import type { AppEnv } from '../env';

export async function rateLimit(
  env: AppEnv,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const fullKey = `rl:${key}`;
  const now = Math.floor(Date.now() / 1000);
  const raw = await env.KV.get(fullKey);
  let count = 0;
  let windowStart = now;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { c: number; w: number };
      if (now - parsed.w < windowSeconds) {
        count = parsed.c;
        windowStart = parsed.w;
      }
    } catch { /* ignore */ }
  }
  count += 1;
  await env.KV.put(
    fullKey,
    JSON.stringify({ c: count, w: windowStart }),
    { expirationTtl: windowSeconds + 60 },
  );
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetIn: windowSeconds - (now - windowStart),
  };
}
