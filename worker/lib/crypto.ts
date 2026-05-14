/**
 *  Web-Crypto helpers usable from the Workers runtime.
 *
 *  - PBKDF2 password hashing (SHA-256, 210k iterations, salted)
 *  - Constant-time string comparison
 *  - HMAC-SHA-256 signing / verification (for sessions, webhook tokens)
 *  - random hex / id generators
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEYLEN = 32; // bytes

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function hexToBuf(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

export function b64UrlEncode(buf: ArrayBuffer): string {
  return bufToB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return b64ToBuf(padded);
}

export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bufToHex(buf.buffer);
}

export function newOrderNumber(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `VSP-${y}${m}${day}-${randomId(3).toUpperCase()}`;
}

/* --------------------------- Password hashing ----------------------------- */

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    PBKDF2_KEYLEN * 8,
  );
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${bufToB64(salt.buffer)}$${bufToB64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[2], 10);
  const salt = b64ToBuf(parts[3]);
  const expected = b64ToBuf(parts[4]);
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    key,
    expected.length * 8,
  );
  const got = new Uint8Array(bits);
  return constantTimeEq(got, expected);
}

export function constantTimeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ------------------------------- HMAC ------------------------------------- */

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(message));
  return b64UrlEncode(sig);
}

export async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const key = await importHmacKey(secret);
  let sig: Uint8Array;
  try {
    sig = b64UrlDecode(signature);
  } catch {
    return false;
  }
  return await crypto.subtle.verify('HMAC', key, sig, ENCODER.encode(message));
}

/* --------------------------- Tiny signed token ---------------------------- */
/* Body is a JSON object, compactly encoded as `<base64url(json)>.<sig>`.    */

export async function signToken(secret: string, payload: object): Promise<string> {
  const body = b64UrlEncode(ENCODER.encode(JSON.stringify(payload)).buffer);
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

export async function verifyToken<T = unknown>(
  secret: string,
  token: string,
): Promise<T | null> {
  const idx = token.indexOf('.');
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!(await hmacVerify(secret, body, sig))) return null;
  try {
    return JSON.parse(DECODER.decode(b64UrlDecode(body))) as T;
  } catch {
    return null;
  }
}

/* ------------------------------- Misc ------------------------------------- */

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
