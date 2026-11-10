# 01 — Withdrawn lots: the library marks them, the shop hides them

Type: task
Status: open
Blocked by: —

## What to build

The library learns that a lot can be withdrawn (`isWithdrawn`), without changing what `isOpen` returns for the
shop of today. The shop takes the new version of the library and hides withdrawn lots.

## Done when

- [ ] The library exports `isWithdrawn`; `isOpen` answers as before.
- [ ] The shop hides withdrawn lots with the released version of the library.

## Where in code

- `lib/index.mjs`, `lib/package.json`
- `app/index.mjs`, `app/package.json`
