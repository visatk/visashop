/**
 *  Tiny typed fetch helper.
 *  All API responses follow `{ ok, data, error }` so we can centralise
 *  error handling.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { credentials: 'include', ...init, headers });
  let body: ApiResult<T> | null = null;
  try {
    body = (await res.json()) as ApiResult<T>;
  } catch {
    /* response was not JSON — fall through to the generic network error */
  }
  if (!body) throw new Error(`Network error (${res.status})`);
  if (body.ok === true) return body.data;
  throw new Error(body.error);
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, data?: unknown) =>
    call<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    call<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => call<T>(path, { method: 'DELETE' }),
};
