/**
 *  Pure helpers shared by checkout + admin around order pricing.
 *
 *  The actual fulfilment is done by the order-lifecycle workflow
 *  (see `worker/workflows/order-lifecycle.ts`).
 */

export function applyCouponCents(
  subtotalCents: number,
  coupon: {
    type: 'percent' | 'fixed';
    value: number;
    minSubtotalCents: number;
    maxRedemptions: number | null;
    redemptions: number;
    expiresAt: Date | null;
    isActive: boolean;
  },
): { discount: number; total: number; valid: boolean } {
  if (!coupon.isActive) return { discount: 0, total: subtotalCents, valid: false };
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
    return { discount: 0, total: subtotalCents, valid: false };
  }
  // Honour the redemption cap so a coupon with maxRedemptions: 1 is
  // exhausted after the first successful order. The redemption counter
  // itself is bumped by the order workflow on fulfilment.
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) {
    return { discount: 0, total: subtotalCents, valid: false };
  }
  if (subtotalCents < coupon.minSubtotalCents) return { discount: 0, total: subtotalCents, valid: false };
  const discount =
    coupon.type === 'percent'
      ? Math.floor((subtotalCents * Math.min(100, Math.max(0, coupon.value))) / 100)
      : Math.min(subtotalCents, Math.max(0, coupon.value));
  return { discount, total: Math.max(0, subtotalCents - discount), valid: true };
}
