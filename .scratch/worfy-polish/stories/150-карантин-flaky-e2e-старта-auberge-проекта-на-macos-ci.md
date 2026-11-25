# Code story — worfy-polish 150: Quarantine of the flaky epic-frame Auberge performance e2e on macOS CI

Kind: pr · Epic: worfy-polish · Ticket: 150 · PR: - · Language: ru

## 1. Что было не так

E2e test старта Project-а из 155 Ticket-ов (`test/e2e/epic-frame.spec.ts`) красил `ci-ok` PR-ов, которые его не
трогают: 4 красные первые попытки из 84 job-ов `macos-e2e` с 2026-11-22, последняя — PR #2218, 9436 ms и 8788 ms на
повторе против предела 7300 ms. Предел на CI — `min(6 × R, 7300)`, и в 58 из 84 job-ов его решает потолок 7300 ms,
то есть скорость runner-а. Правила проекта: такой test — в карантин с владельцем и сроком, предел не поднимают.

- Требование: [Что происходит](../issues/150-карантин-flaky-e2e-старта-auberge-проекта-на-macos-ci.md#что-происходит)

## 2. Запись карантина

Code: `test/quarantine/epic-frame-auberge-start-macos-ci.json:1-13` · key lines: 2, 3, 7, 10, 12

```json
{
  "kind": "quarantine",
  "runner": "playwright",
  "file": "test/e2e/epic-frame.spec.ts",
  "test": "an Auberge-sized Project is interactive within 3 s and pans and zooms smoothly over its biggest Epic",
  "reason": "Flaky on the GitHub macOS runner (macos-e2e), red on PRs that touch neither this file nor src/renderer/canvas. The start of a 155-Ticket Project (N) is held to min(6 x R, 7300) ms, R the median of three one-Ticket starts on the same runner (test/e2e/start-budget.ts). Of the first attempts in 84 macos-e2e jobs 2026-11-22T01:03Z..2026-11-25T17:24Z, 4 were red: run 45263502937 job 138007474540 (worfy-acceptance/01, N 10258 ms, retry 11468 ms), 45598783276 job 139152095369 (worfy-assistant/03, 7716 ms, retry green), 45618805239 job 139221291463 (worfy-product-session/37, 8227 ms, retry green, code without the attention core), 45657771792 job 139359148262 (worfy-assistant/11, PR #2218, 9436 ms, retry 8788 ms), each against 7300 ms. N median 4963 ms; N/R 1.83-5.19, median 3.56, the red ones inside that spread; 6 x R hit the 7300 ms cap in 58 of the 84 jobs, so the runner's speed sets the budget; 12 of the 43 first attempts on 2026-11-25 were above 6200 ms. Not measured yet: since worfy-assistant 03 the attention core writes assistant-items.json about 23 times, synchronously and zod-checked, while a 155-Ticket Project loads (src/main/assistant/core/sources.ts:133-150, attention-core.ts:96-101, src/main/storage/json-file.ts:81-93). Neither the 3 s target nor the 7300 ms cap is raised.",
  "platforms": [
    "darwin"
  ],
  "owner": "worfy-polish 151",
  "since": "2026-11-25",
  "until": "2026-12-09"
}
```

- Что делает: запись `kind` `quarantine` для Playwright-test-а с полным именем, как его сверяет загрузчик
  `test/quarantine.ts`; `platforms` `["darwin"]`, owner `worfy-polish 151`, `since` 2026-11-25, `until` 2026-12-09.
  В `reason` — run-ы, job-ы и числа разбора.
- Почему здесь: Ticket называет этот файл в «Где в коде»; срок 14 дней — предел `MAX_DAYS` для `kind` `quarantine`
  (`test/quarantine.ts`); `darwin` — потому что e2e идут только на macOS.
- Без него: каждый PR рискует красным `ci-ok` из-за скорости runner-а, а ручной повтор job-а правила запрещают.
- Требование: [Что делаем, п. 1](../issues/150-карантин-flaky-e2e-старта-auberge-проекта-на-macos-ci.md#что-делаем)
- Риски и пробелы test-ов: пока запись действует, регресс старта на CI никто не ловит; после 2026-12-09 test снова
  идёт, а `test/unit/quarantine.test.ts` краснеет на просроченной записи — это и есть срок для Ticket-а 151.

## 3. Метка в spec-файле

Code: `test/e2e/epic-frame.spec.ts:1112-1116` · key lines: 1116

```ts
const REFERENCE_STARTS = 3

// Quarantined (test/quarantine/epic-frame-auberge-start-macos-ci.json): flaky on the macOS runner, where the
// 7300 ms cap, not the one-Ticket reference, sets the budget in most jobs; worfy-polish 151 fixes it.
quarantined('epic-frame-auberge-start-macos-ci')('an Auberge-sized Project is interactive within 3 s and pans and zooms smoothly over its biggest Epic', async () => {
```

- Что делает: test объявлен через `quarantined('<id>')` из `test/e2e/quarantine.ts`, а не через `test`. Без
  `WORFY_QUARANTINE` это `test.skip`, с `run` — обычный `test`, с `only` — `test.only`. Тело test-а не тронуто.
- Почему здесь: так объявляет e2e test в карантине `test/e2e/quarantine.ts`; spec сам вызывает возвращённую функцию,
  чтобы Playwright записал место test-а в этом файле.
- Без него: запись без метки — ошибка `test/unit/quarantine.test.ts` («has no mark»), и test не пропускается.
- Требование: [Что делаем, п. 2](../issues/150-карантин-flaky-e2e-старта-auberge-проекта-на-macos-ci.md#что-делаем)
- Риски и пробелы test-ов: пропуск в списке Playwright проверен вручную (`--list --reporter=json`), отдельного test-а
  на это нет.

## 4. Что сознательно не меняли

`START_MS` (3000), `START_RATIO` (6) и `RUNNER_START_CAP_MS` (7300) в `test/e2e/start-budget.ts`, ожидания test-а и
`src/` не тронуты. Замер attention core и предел от замеренной базы — Ticket worfy-polish 151.

## 5. Как проверено

`node scripts/vitest-electron.mjs test/unit/quarantine.test.ts test/unit/quarantine-suggest.test.ts
test/unit/e2e-start-budget.test.ts` — exit 0 (55 passed). `npx playwright test --list --reporter=json
test/e2e/epic-frame.spec.ts` — exit 0, у Auberge-test-а `expectedStatus` `skipped`, с `WORFY_QUARANTINE=run` —
`passed`. `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0, green.

## Проверить себя

1. Почему карантин, а не поднятый потолок 7300 ms?
   - Ответ: правила проекта запрещают поднимать предел одного test-а; потолок и так решает исход в большинстве
     job-ов, подъём только спрятал бы скорость runner-а глубже.
   - Строки: `test/quarantine/epic-frame-auberge-start-macos-ci.json:6-6`
2. Что случится 2026-12-10, если Ticket 151 не сделан?
   - Ответ: запись просрочена: helper больше не пропускает test, он снова идёт в `macos-e2e`, а
     `test/unit/quarantine.test.ts` красный на этой записи.
   - Строки: `test/quarantine/epic-frame-auberge-start-macos-ci.json:12-12`
3. Почему метка стоит прямо в spec-файле, а не в обёртке вокруг `test`?
   - Ответ: Playwright записывает место того вызова, который объявил test; вызов в spec-файле сохраняет
     `epic-frame.spec.ts:1116` в отчётах и для `file:line`.
   - Строки: `test/e2e/epic-frame.spec.ts:1116-1116`
