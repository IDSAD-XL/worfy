# Code story fixtures

The shared cases of the Code story format (`bin/TICKETS.md`, section **Code story**). The Harness's shell
tests and worfy's own tests read these same files: a change of the format changes them, and every reader's
test sees it. The epic `demo-cart`, its tickets, PR numbers and code are invented.

A test builds a temporary git repository from them: the files of `repo/` at its root, committed first, and a
story at the path the format gives it — a story of a PR at `.scratch/demo-cart/stories/<NN>-<slug>.md`
(`04-cart-total.md` for the English one, `05-coupons.md` for the Russian one), the story of the epic at
`.scratch/demo-cart/story.md`. Every fragment of the stories quotes `repo/` as it is here.

| File | What it checks |
| --- | --- |
| `pr-en.md` | A story of a PR in English: the frame steps, two code steps with every field, `not recorded`, a `Check yourself` section — a clean case. |
| `pr-ru.md` | A story of a PR in Russian: the Russian field labels and frame titles, `не записано` in two fields, no `Check yourself` section, and the review step appended last with a fragment of its own — a clean case. |
| `epic-ru.md` | The story of an epic in Russian: the screens, three PR chapters with five code steps, the seams step with three handoffs, one of them dropped (`done: no`), and a `Check yourself` section — a clean case. |
| `bad-fragment.md` | `pr-en.md` with one changed line in the fragment of step 2 (`src/cart.ts:10-17`, line 14): the fragment does not match the code. |
| `missing-field.md` | `pr-en.md` without the `Why here` field of step 3: a step without a field. |
| `repo/src/money.ts` | The code the fragments quote: prices in whole cents. |
| `repo/src/cart.ts` | The code the fragments quote: the cart total. |
| `repo/src/coupon.ts` | The code the fragments quote: the coupon discount. |

## Labels in the two languages

The header keys, the fragment line (`Code:`, `key lines:`) and the handoff field (`done: yes|no`) are the same in
every language. The labels below follow the story's `Language:` line: `ru` takes the second column, any other
language the first.

| English | Russian |
| --- | --- |
| What it does | Что делает |
| Why here | Почему здесь |
| Without it | Без него |
| Requirement | Требование |
| Risks and test gaps | Риски и пробелы test-ов |
| not recorded | не записано |
| What was wrong | Что было не так |
| What was deliberately not changed | Что сознательно не меняли |
| How it was checked | Как проверено |
| What review found and what remains | Что нашёл review и что осталось |
| Start | Начало |
| Seams between tickets | Стыки между Ticket-ами |
| Summary | Итог |
| Check | Проверка |
| Check yourself | Проверить себя |
| Answer | Ответ |
| Lines | Строки |
