# Code story — demo-cart 04: Cart total in cents

Kind: pr · Epic: demo-cart · Ticket: 04 · PR: #212 · Language: en

## 1. What was wrong

The cart added prices as floating-point numbers, so three items at 0.10 came to 0.30000000000000004 and the
receipt showed 0.29 after rounding down. Lines with a quantity of zero were still counted.

- Requirement: [What happens](../issues/04-cart-total.md#what-happens)

## 2. The total is a sum of whole cents

Code: `src/cart.ts:10-17` · key lines: 13, 14

```ts
export function cartTotal(lines: CartLine[]): Cents {
  let total = 0
  for (const line of lines) {
    if (line.quantity <= 0) continue
    total += toCents(line.price) * line.quantity
  }
  return total
}
```

- What it does: turns each price into whole cents first and only then multiplies and adds, so no fraction of a cent
  is ever stored; a line with a zero or negative quantity is skipped.
- Why here: the total is the one place every later sum starts from — the coupon and the receipt read it.
- Without it: not recorded
- Requirement: [What we do, item 1](../issues/04-cart-total.md#what-we-do)
- Risks and test gaps: a price with three decimals ("0.105") throws in `toCents`; no test feeds one.

## 3. Checkout needs a positive quantity

Code: `src/cart.ts:20-22` · key lines: 21

```ts
export function canCheckout(lines: CartLine[]): boolean {
  return lines.some((line) => line.quantity > 0)
}
```

- What it does: lets the cart go to checkout only when at least one line would be charged.
- Without it: a cart of zero-quantity lines would reach checkout with a total of 0.
- Requirement: [What we do, item 2](../issues/04-cart-total.md#what-we-do)
- Risks and test gaps: none known.

## 4. What was deliberately not changed

The receipt still formats the total with `formatCents`; its rounding was right and the ticket did not ask to touch
it.

## 5. How it was checked

`pnpm test test/unit/cart.test.ts` exit 0: three items at 0.10 make 30 cents; a zero-quantity line adds nothing.

## Check yourself

1. Why does the total multiply whole cents and not the typed price?
   - Answer: a typed price is a decimal fraction that a floating-point number cannot hold exactly; cents are whole
     numbers, and whole numbers add without drift.
   - Lines: `src/cart.ts:14`, `src/money.ts:11`
2. What does the cart do with a line whose quantity is 0?
   - Answer: skips it in the total and does not let a cart of such lines reach checkout.
   - Lines: `src/cart.ts:13`, `src/cart.ts:21`
