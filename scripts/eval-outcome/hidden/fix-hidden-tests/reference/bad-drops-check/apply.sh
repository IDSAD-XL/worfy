cat >src/order.mjs <<'JS'
/** The total of an order in cents, the discount taken off the total and rounded half up. */
export function orderTotal(lines, discountPercent = 0) {
  const total = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0)
  return Math.round((total * (100 - discountPercent)) / 100)
}

/** Cents as an amount with two decimals: 1234 is '12.34'. */
export function formatCents(cents) {
  return (cents / 100).toFixed(2)
}
JS
cat >>test/order.test.mjs <<'JS'

test('the example of the issue', () => {
  const items = [{ priceCents: 95, quantity: 3 }]
  assert.equal(orderTotal(items, 10), 257)
})
JS
node --test
git commit -qam "Fix discount rounding"
