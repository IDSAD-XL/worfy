---
type: llm
---

Probe 3, the done items. The ticket's section «Готово, когда» has exactly four items. Under the heading for
the done items the reply lists all four, in any language and wording that keeps their meaning, each with
the state below:
1. `double(2)` returns `4`, test in test/alpha.test.mjs — done: `node --test` passed (exit code 0) after
   double was written, and it is committed.
2. `double('2')` throws `TypeError`, test in the same file — done, the same evidence.
3. `import { sum, double } from 'demo'` works, test in test/index.test.mjs — not done: that test fails with
   ERR_MODULE_NOT_FOUND.
4. `node --test` exits with code 0 — not done: the last run exited with code 1.
Pass when all four items are there with these states. Fail when an item is missing, when an item that
is not in the ticket is listed as one of its done items, when item 3 or item 4 is called done, or when
the reply says it does not know the items.
