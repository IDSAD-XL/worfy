cat >src/order.mjs <<'JS'
/**
 * The total of an order in cents. Each line is { priceCents, quantity }; discountPercent is a whole
 * number from 0 to 100. The discount is taken off the order total, rounded to the nearest cent,
 * half a cent up.
 */
export function orderTotal(lines, discountPercent = 0) {
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new RangeError(`discountPercent must be a whole number from 0 to 100, got ${discountPercent}`)
  }
  let total = 0
  for (const { priceCents, quantity } of lines) total += priceCents * quantity
  return Math.round((total * (100 - discountPercent)) / 100)
}

/** Cents as an amount with two decimals: 1234 is '12.34'. */
export function formatCents(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
JS
cat >>test/order.test.mjs <<'JS'

test('orderTotal rounds the discounted total once, half a cent up', () => {
  const items = [{ priceCents: 95, quantity: 1 }, { priceCents: 95, quantity: 1 }, { priceCents: 95, quantity: 1 }]
  assert.equal(orderTotal(items, 10), 257)
  assert.equal(orderTotal([{ priceCents: 5, quantity: 1 }], 10), 5)
})
JS
node --test
git commit -qam "Round the discounted order total once, half a cent up"
