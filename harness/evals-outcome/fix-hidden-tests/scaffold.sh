#!/usr/bin/env bash
# The fixture plus an order module whose discount is rounded per line and down, an issue that
# describes the bug, and tests that pass on the bug.
set -euo pipefail
lib="$(dirname "$0")/../lib"
bash "$lib/fixture.sh"
for state in "$lib"/plugin-state/*.sh; do [ ! -e "$state" ] || bash "$state"; done
export GIT_AUTHOR_DATE=2026-10-02T12:00:00Z GIT_COMMITTER_DATE=2026-10-02T12:00:00Z

cat >src/order.mjs <<'EOF'
/**
 * The total of an order in cents. Each line is { priceCents, quantity }; discountPercent is a whole
 * number from 0 to 100.
 */
export function orderTotal(lines, discountPercent = 0) {
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new RangeError(`discountPercent must be a whole number from 0 to 100, got ${discountPercent}`)
  }
  let total = 0
  for (const { priceCents, quantity } of lines) {
    total += Math.floor((priceCents * quantity * (100 - discountPercent)) / 100)
  }
  return total
}

/** Cents as an amount with two decimals: 1234 is '12.34'. */
export function formatCents(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
EOF
cat >test/order.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatCents, orderTotal } from '../src/order.mjs'

test('orderTotal adds up the lines', () => {
  assert.equal(orderTotal([{ priceCents: 100, quantity: 2 }, { priceCents: 250, quantity: 1 }]), 450)
})

test('orderTotal takes the discount off', () => {
  assert.equal(orderTotal([{ priceCents: 1000, quantity: 1 }], 10), 900)
})

test('formatCents writes two decimals', () => {
  assert.equal(formatCents(1234), '12.34')
  assert.equal(formatCents(5), '0.05')
})
EOF
cat >ISSUE.md <<'EOF'
# Order total with a discount comes out a few cents short

Three items at 0.95 each with a 10% discount: the receipt says 2.55. The order is 2.85, and 10% off
that is 2.565, so it should say 2.57.

Bigger orders lose more: twenty items at 0.95 with 10% off come out 0.10 short.

Expected: the discount is taken off the order total, and the result is rounded to the nearest cent,
half a cent rounded up.
EOF
git add -A
git commit -q -m "Add order totals"
git push -q origin main
