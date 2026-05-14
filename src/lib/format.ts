/** Format US-cents as a currency string. */
export function money(cents: number, currency = 'USD'): string {
  const n = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export const CRYPTO_DECIMALS: Record<string, number> = {
  btc: 8, ltc: 8, bch: 8, doge: 8,
  trx: 6, 'usdt@trx': 6, 'usdc@trx': 6,
  eth: 18, 'usdt@eth': 6, 'usdc@eth': 6,
  bnb: 18, 'usdt@bnb': 18, 'usdc@bnb': 18,
};

export const CRYPTO_LABELS: Record<string, string> = {
  btc: 'Bitcoin (BTC)',
  ltc: 'Litecoin (LTC)',
  bch: 'Bitcoin Cash (BCH)',
  doge: 'Dogecoin (DOGE)',
  trx: 'Tron (TRX)',
  'usdt@trx': 'USDT (Tron)',
  'usdc@trx': 'USDC (Tron)',
  eth: 'Ethereum (ETH)',
  'usdt@eth': 'USDT (Ethereum)',
  'usdc@eth': 'USDC (Ethereum)',
  bnb: 'BNB',
  'usdt@bnb': 'USDT (BNB)',
  'usdc@bnb': 'USDC (BNB)',
};

export function formatMinorCrypto(minor: string | number | bigint | null | undefined, decimals: number): string {
  if (minor === null || minor === undefined) return '0';
  let s = String(minor).trim();
  // Strip any non-digit characters except a leading minus.
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  s = s.replace(/[^\d]/g, '');
  if (s.length === 0) return '0';
  const padded = s.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return (negative ? '-' : '') + intPart + (fracPart ? '.' + fracPart : '');
}

export function formatDate(d: string | number | Date | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d as any);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}
