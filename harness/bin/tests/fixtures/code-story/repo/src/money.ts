// Prices of the demo shop, kept in whole cents so that sums never drift.

export type Cents = number

/** Parses a price typed by a person ("12.30") into whole cents. */
export function toCents(text: string): Cents {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) throw new Error(`not a price: ${text}`)
  const whole = Number(match[1])
  const part = Number((match[2] ?? '0').padEnd(2, '0'))
  return whole * 100 + part
}

/** Formats whole cents for the receipt: 1230 -> "12.30". */
export function formatCents(value: Cents): string {
  const whole = Math.trunc(value / 100)
  const part = Math.abs(value % 100)
  return `${whole}.${String(part).padStart(2, '0')}`
}

/** A share of an amount, rounded half up to a whole cent. */
export function percentOf(value: Cents, percent: number): Cents {
  return Math.round((value * percent) / 100)
}
