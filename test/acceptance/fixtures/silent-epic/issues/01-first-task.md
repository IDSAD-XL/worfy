# 01 — greet(name)

Type: task
Status: open
Blocked by: —

## What happens

`silent-app` has no greeting yet.

## What we do

1. `src/greet.js` exports `greet(name)`: it returns `Hello, <name>!`; with an empty or missing name
   it returns `Hello, world!`.
2. `src/index.js` re-exports `greet`.
3. `test/greet.test.js` covers both cases with `node:test`.

## Done when

- [ ] `npm test` passes with the new test, locally and in CI.

## Where in the code

- `src/greet.js` — new
- `src/index.js`
- `test/greet.test.js` — new

## Result

Filled in when the Ticket closes.
