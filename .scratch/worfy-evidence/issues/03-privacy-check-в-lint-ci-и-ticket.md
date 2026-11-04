# 03 — Privacy check в `pnpm lint`, CI и `ticket evidence`

Type: task
Status: open
Blocked by: 01, 02, 07
Source: [spec.md](../spec.md), «Где privacy check бежит», п. 1, 4, «Что есть сейчас» («Где privacy check мог бы бежать»), «Вопросы владельцу», Q2, Q5

## Что происходит

- После 02 есть `harness/bin/evidence-check`, но его никто не зовёт.
- `pnpm lint` — цепочка проверок (`package.json:17`); CI job `lint-typecheck` идёт и на PR только с документами
  (`.github/workflows/ci.yml:8-13`, `:147`; `scripts/ci-scope.mjs:64`). Checkout этого job-а без `fetch-depth`
  (`.github/workflows/ci.yml:133-135`): `HEAD^1` в нём нет.
- После 01 `ticket evidence` пишет строку с `ref` на файл, не глядя в файл.
- Шаг в `pnpm lint` красит каждый PR, который добавляет снимок без отметки `scrub:`. Поэтому Ticket ждёт 07: к его claim agents и
  skills уже пишут отметки (`ticket evidence … --scrub`), и PR-ы других Epic-ов не краснеют от нового правила.

## Что делаем

Ответ Q2 — вариант (а).

1. **`package.json`** — в конец `lint`: `node harness/bin/evidence-check --changed`.
2. **`.github/workflows/ci.yml`** — у checkout job-а `lint-typecheck` `fetch-depth: 2`: на PR `HEAD` — merge-commit, `HEAD^1` —
   база; на push в `main` `HEAD^1` — прошлый commit. Комментарий в шапке workflow — строка про privacy check.
   `test/contract/ci-workflow.test.ts` — проверка, что `fetch-depth: 2` у этого job-а есть.
3. **`ticket evidence`**: если `ref` — путь к файлу в backticks (относительно файла Ticket-а), до записи зовёт
   `evidence-check --root <Tickets root> <файл>`; находки — exit 1, строка не пишется, вывод проверки — в stderr. Tickets root вне
   репозитория (Silent mode) — проверка файла пропускается, строка пишется: публиковать нечего. `screenshot` с путём без `--scrub` —
   exit 2 «a screenshot needs --scrub <date>: check the pixels by eye first» (Ответ Q5).

Не входит: `land` (04), текст skills (07).

## Готово, когда

- [ ] Shell test `ticket-evidence`: `ref` на файл с путём `/Users/<имя>/` — exit 1, Ticket не тронут, в stderr нет полного значения.
- [ ] Shell test: `screenshot` без `--scrub` — exit 2; с `--scrub` и PNG без metadata — строка записана.
- [ ] Shell test: Tickets root вне репозитория — файл с путём `/Users/<имя>/` не проверяется, строка записана.
- [ ] Перед merge: открытые PR-ы других Epic-ов, которые добавляют снимки, — с отметками `scrub:` (или Orchestrator предупреждён).
- [ ] Contract test `ci-workflow`: у checkout `lint-typecheck` `fetch-depth: 2`.
- [ ] `pnpm lint` на ветке, где добавлена строка с путём `/Users/<имя>/` в `.scratch/` (временный commit), — exit не 0; без неё — exit 0.
- [ ] CI PR этого Ticket-а: job `lint-typecheck` печатает `evidence-check: ok (…)`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице: `package.json` гоняет все spec-и).

## Тесты

- Shell `harness/bin/tests/ticket-evidence.test.sh` — новые случаи.
- Contract `test/contract/ci-workflow.test.ts` — новый случай.
- Сначала падающий: случай `ticket-evidence` с грязным файлом — сейчас строка пишется.
- Прогнать все `harness/bin/tests/ticket-*.test.sh`, `test/contract/ci-*.test.ts`.

## Где в коде

- `package.json`
- `.github/workflows/ci.yml`
- `test/contract/ci-workflow.test.ts`
- `harness/bin/ticket`
- `harness/bin/tests/ticket-evidence.test.sh`

Только читать: `harness/bin/evidence-check` (зовётся), `scripts/ci-scope.mjs`.
