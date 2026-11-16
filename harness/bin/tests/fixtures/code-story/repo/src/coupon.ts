import { type Cents, percentOf } from './money'

export interface Coupon {
  code: string
  percent: number
  expires: string
}

/** The discount a coupon gives on a cart total, never more than the total itself. */
export function discountFor(total: Cents, coupon: Coupon, today: string): Cents {
  if (coupon.expires < today) return 0
  if (coupon.percent <= 0) return 0
  const discount = percentOf(total, coupon.percent)
  return Math.min(discount, total)
}

/** Normalises a code typed by a person: spaces dropped, letters upper-cased. */
export function normaliseCode(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase()
}
