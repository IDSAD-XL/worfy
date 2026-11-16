import { type Cents, toCents } from './money'

/** The most lines one cart may hold. */
export const MAX_LINES = 50

export interface CartLine {
  title: string
  price: string
  quantity: number
}

/** The total of the cart in whole cents, before any coupon. */
export function cartTotal(lines: CartLine[]): Cents {
  let total = 0
  for (const line of lines) {
    if (line.quantity <= 0) continue
    total += toCents(line.price) * line.quantity
  }
  return total
}

/** True when the cart may go to checkout: at least one line with a positive quantity. */
export function canCheckout(lines: CartLine[]): boolean {
  return lines.some((line) => line.quantity > 0)
}
