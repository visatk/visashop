/**
 *  Apirone API client (https://apirone.com/docs).
 *
 *  We use the Wallet v2 API for production (real wallet, real
 *  callback security, fee plans). The v1 simple-forwarding API
 *  is also exposed as a fallback because it is the simplest way
 *  to spin up the shop without first creating a wallet.
 */
import type { AppEnv } from '../env';

export interface ApironeAddress {
  address: string;
  wallet: string;
  type?: string;
  callback?: unknown;
}

export interface CallbackPayload {
  /* v2 wallet/address callback */
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
}

const RETRYABLE_STATUS = [408, 425, 429, 500, 502, 503, 504];

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (!RETRYABLE_STATUS.includes(res.status)) return res;
      last = res;
    } catch (err) {
      if (i === attempts - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 250 * 2 ** i));
  }
  return last ?? new Response(null, { status: 500 });
}

/* ----------------------------- Wallet v2 ---------------------------------- */

/**
 *  Generate a fresh deposit address inside the merchant wallet.
 *  When this address receives a payment Apirone will POST our
 *  webhook URL — see worker/routes/webhooks.ts.
 */
export async function generateAddress(
  env: AppEnv,
  args: { callbackUrl: string; data?: Record<string, unknown>; addrType?: string },
): Promise<ApironeAddress> {
  if (!env.APIRONE_WALLET) throw new Error('APIRONE_WALLET secret missing');
  const url = `${env.APIRONE_BASE_URL}/v2/wallets/${env.APIRONE_WALLET}/addresses`;
  const body: Record<string, unknown> = {
    callback: { method: 'POST', url: args.callbackUrl, data: args.data ?? {} },
  };
  if (args.addrType) body['addr-type'] = args.addrType;

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Apirone generateAddress failed (${res.status}): ${t}`);
  }
  return (await res.json()) as ApironeAddress;
}

/* ------------------------- Forwarding v1 (fallback) ----------------------- */

export async function generateForwardingAddress(
  env: AppEnv,
  args: { destinationAddress: string; currency: string; callbackUrl: string },
): Promise<{ destination: string; input_address: string; callback_url: string }> {
  const u = new URL(`${env.APIRONE_BASE_URL}/v1/receive`);
  u.searchParams.set('method', 'create');
  u.searchParams.set('address', args.destinationAddress);
  u.searchParams.set('currency', args.currency);
  // Per docs the callback parameter must be the LAST query parameter.
  const qs = u.toString() + `&callback=${encodeURIComponent(args.callbackUrl)}`;
  const res = await fetchWithRetry(qs, { method: 'GET' });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Apirone forwarding create failed (${res.status}): ${t}`);
  }
  return (await res.json()) as { destination: string; input_address: string; callback_url: string };
}

/* ------------------------------- Ticker ----------------------------------- */

/**
 *  Returns the unit price of 1 unit of `crypto` in `fiat`,
 *  e.g. tickerRate(env, 'btc', 'usd') -> 67182.42
 *
 *  Cached in KV for `cacheSeconds` (default 60).
 */
export async function tickerRate(
  env: AppEnv,
  crypto: string,
  fiat = 'usd',
  cacheSeconds = 60,
): Promise<number> {
  const cacheKey = `ticker:${crypto}:${fiat}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    const v = Number(cached);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const u = new URL(`${env.APIRONE_BASE_URL}/v2/ticker`);
  u.searchParams.set('currency', crypto);
  u.searchParams.set('fiat', fiat);
  const res = await fetchWithRetry(u.toString(), { method: 'GET' });
  if (!res.ok) throw new Error(`ticker failed: ${res.status}`);
  const data = (await res.json()) as Record<string, number | Record<string, number>>;
  // Apirone returns either { fiat: number } (single crypto + fiat)
  // or { crypto: { fiat: number } } (multi-crypto). Be defensive.
  let v: number | undefined;
  if (typeof data[fiat] === 'number') v = data[fiat] as number;
  else if (typeof (data[crypto] as Record<string, number> | undefined)?.[fiat] === 'number') {
    v = (data[crypto] as Record<string, number>)[fiat];
  }
  if (!v || !Number.isFinite(v) || v <= 0) throw new Error('ticker missing value');
  await env.KV.put(cacheKey, String(v), { expirationTtl: cacheSeconds });
  return v;
}

/* ---------------------------- BigInt helpers ------------------------------ */

export function bigStrAdd(a: string | null | undefined, b: string | null | undefined): string {
  return ((BigInt(a ?? '0') || 0n) + (BigInt(b ?? '0') || 0n)).toString();
}

export function bigStrMax(a: string | null | undefined, b: string | null | undefined): string {
  const ax = BigInt(a ?? '0');
  const bx = BigInt(b ?? '0');
  return (ax > bx ? ax : bx).toString();
}

export function bigStrGte(a: string | null | undefined, b: string | null | undefined): boolean {
  return BigInt(a ?? '0') >= BigInt(b ?? '0');
}

export function bigStrGt(a: string | null | undefined, b: string | null | undefined): boolean {
  return BigInt(a ?? '0') > BigInt(b ?? '0');
}

/* --------------------------- Unit conversion ------------------------------ */

/**
 *  Decimals per supported currency. We use string<->bigint to avoid
 *  the JS-number precision pitfalls Apirone explicitly warns about
 *  (especially for 18-decimal ETH tokens).
 */
export const CRYPTO_DECIMALS: Record<string, number> = {
  btc: 8,
  ltc: 8,
  bch: 8,
  doge: 8,
  trx: 6,
  'usdt@trx': 6,
  'usdc@trx': 6,
  eth: 18,
  'usdt@eth': 6,
  'usdc@eth': 6,
  bnb: 18,
  'usdt@bnb': 18,
  'usdc@bnb': 18,
};

export const CRYPTO_LABELS: Record<string, string> = {
  btc: 'Bitcoin',
  ltc: 'Litecoin',
  bch: 'Bitcoin Cash',
  doge: 'Dogecoin',
  trx: 'Tron',
  'usdt@trx': 'USDT (Tron)',
  'usdc@trx': 'USDC (Tron)',
  eth: 'Ethereum',
  'usdt@eth': 'USDT (Ethereum)',
  'usdc@eth': 'USDC (Ethereum)',
  bnb: 'BNB',
  'usdt@bnb': 'USDT (BNB)',
  'usdc@bnb': 'USDC (BNB)',
};

/**
 *  USD-cents -> minor crypto units (string, bigint-safe).
 *  Rate is the value of 1 crypto unit in fiat (e.g. BTC->USD).
 *
 *  Math: minor = ceil(cents * 10^decimals / (price * 100))
 *  The price scale (10^9) keeps 9 digits of fiat precision, plenty for
 *  spot rates which never need more than ~6 significant digits.
 */
export function fiatCentsToCryptoMinor(
  fiatCents: number,
  fiatPerCrypto: number,
  crypto: string,
): { amountStr: string; amountDisplay: string; decimals: number } {
  const decimals = CRYPTO_DECIMALS[crypto] ?? 8;
  if (!Number.isFinite(fiatPerCrypto) || fiatPerCrypto <= 0) {
    throw new Error('rate must be a positive finite number');
  }
  if (!Number.isFinite(fiatCents) || fiatCents < 0) {
    throw new Error('fiat amount must be a non-negative finite number');
  }
  const PRICE_SCALE = 1_000_000_000n; // 9-digit precision
  const numerator = BigInt(Math.round(fiatCents)) * 10n ** BigInt(decimals) * PRICE_SCALE;
  const priceScaled = BigInt(Math.round(fiatPerCrypto * Number(PRICE_SCALE)));
  if (priceScaled <= 0n) throw new Error('rate too small');
  const denominator = priceScaled * 100n; // 100 because cents
  // ceil division so we never under-charge
  const minor = (numerator + denominator - 1n) / denominator;
  const amountStr = minor.toString();
  const amountDisplay = formatCryptoAmount(amountStr, decimals);
  return { amountStr, amountDisplay, decimals };
}

export function formatCryptoAmount(minorString: string, decimals: number): string {
  const neg = minorString.startsWith('-');
  const s = neg ? minorString.slice(1) : minorString;
  const padded = s.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + intPart + (fracPart ? '.' + fracPart : '');
}
