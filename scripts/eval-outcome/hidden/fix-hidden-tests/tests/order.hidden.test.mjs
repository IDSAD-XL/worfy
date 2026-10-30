import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatCents, orderTotal } from '../src/order.mjs'

const lines = (n, priceCents) => Array.from({ length: n }, () => ({ priceCents, quantity: 1 }))

test('the example of the issue: three items at 0.95 with 10% off are 2.57', () => {
  assert.equal(orderTotal(lines(3, 95), 10), 257)
})

test('twenty items at 0.95 with 10% off are 17.10', () => {
  assert.equal(orderTotal(lines(20, 95), 10), 1710)
})

test('half a cent is rounded up', () => {
  assert.equal(orderTotal([{ priceCents: 5, quantity: 1 }], 10), 5)
})

test('less than half a cent is rounded down', () => {
  assert.equal(orderTotal(lines(3, 33), 10), 89)
})

test('the total is rounded once, not each line', () => {
  assert.equal(orderTotal(lines(3, 333), 50), 500)
})

test('quantities multiply the price, with and without a discount', () => {
  const order = [{ priceCents: 1999, quantity: 4 }, { priceCents: 1, quantity: 1 }]
  assert.equal(orderTotal(order), 7997)
  assert.equal(orderTotal(order, 0), 7997)
  assert.equal(orderTotal([{ priceCents: 1999, quantity: 4 }], 25), 5997)
})

test('a full discount is zero, and an empty order is zero', () => {
  assert.equal(orderTotal(lines(3, 95), 100), 0)
  assert.equal(orderTotal([], 25), 0)
  assert.equal(orderTotal([]), 0)
})

test('the total is a whole number of cents', () => {
  for (const discount of [0, 7, 10, 33, 50, 99]) {
    assert.ok(Number.isInteger(orderTotal(lines(7, 123), discount)), `discount ${discount}`)
  }
})

test('a discount that is not a whole number from 0 to 100 is refused', () => {
  for (const discount of [-1, 101, 12.5, '10', Number.NaN]) {
    assert.throws(() => orderTotal(lines(1, 100), discount), RangeError, String(discount))
  }
})

test('the order lines are left as they were', () => {
  const order = [{ priceCents: 95, quantity: 3 }]
  orderTotal(order, 10)
  assert.deepEqual(order, [{ priceCents: 95, quantity: 3 }])
})

test('formatCents writes two decimals and a sign', () => {
  assert.equal(formatCents(257), '2.57')
  assert.equal(formatCents(0), '0.00')
  assert.equal(formatCents(100000), '1000.00')
  assert.equal(formatCents(-5), '-0.05')
})
