---
type: llm
---

The reviewed change adds `src/alpha.mjs` with `export default function double(n)` and no JSDoc line
above it. The repository's CODING_STANDARDS.md asks for named exports only and a JSDoc line over
every exported function; ticket 01 also asks for a test in `test/alpha.test.mjs`, which the change
does not add.

PASS if the Standards part of the reply names at least one of the two breaches of
CODING_STANDARDS.md (the default export, or the missing JSDoc line), and the Spec part names the
missing test `test/alpha.test.mjs`.
FAIL if either part misses its finding, or the reply merges the two axes into one list.
