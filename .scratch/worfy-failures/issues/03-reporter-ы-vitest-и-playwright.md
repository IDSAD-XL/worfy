# 03 — Reporter-ы vitest и Playwright пишут записи

Type: task
Status: claimed 2026-11-04T23:30Z
Blocked by: 01
Source: [spec.md](../spec.md), «Источники и что меняется в них» (worfy: reporter-ы; повтор поодиночке), «Модель» (запись о падении), «Windows» (argv без shell); [ADR-0083](../../../docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md) (повторы только в CI)

## Что происходит

- vitest: reporter-ы по умолчанию, `test/timings-reporter.ts` (время файлов) и `test/flaky-reporter.ts`
  (`vitest.config.ts:46`); строка объявления test-а есть благодаря `includeTaskLocation` (`vitest.config.ts:52`).
  Per-test JSON с ошибками нет (`test/timings-reporter.ts:5-8`).
- Playwright: `list`, свой helper-reporter, FLAKY-reporter и `json` (`playwright.config.ts:85`).
- Повторы — только в CI (`test/flaky.ts:20`); локально `attempt` всегда 1.
- `pnpm test` идёт через `scripts/vitest-electron.mjs`, окружение доходит до vitest (`scripts/vitest-electron.mjs:76-80`).
- Как найти test-ы и их имена — уже есть в `flakyTests` обоих FLAKY-reporter-ов (`test/flaky-reporter.ts:11-17`,
  `test/e2e/flaky-reporter.ts:12-23`).

## Что делаем

1. `test/failure-records.ts` — общее для двух раннеров: строка JSON формата 01 (`runner`, `file`, `line`, `name`,
   `ms`, `error`, `attempt`, `rerun`), дописывание в `process.env.GATE_FAILURES_FILE`; без переменной — ничего;
   ошибка записи — одна строка на stderr, run не падает (как `reportFlaky`, `test/flaky.ts:42-53`). `error` — первая
   строка без ANSI; очищает её gate (Ticket 02, `scrubRecord`), reporter личных данных не ищет.
2. `test/failures-reporter.ts` (vitest) — в `onTestRunEnd`: каждый test с `state` `failed` — запись;
   упавший модуль (ошибка импорта, `testModule.errors()`) — запись с `name: null` и `file`; ошибки run-а вне модулей
   (`unhandledErrors`) — одна запись с `file: null`. `rerun` — `["node", "scripts/vitest-electron.mjs", <file>, "-t",
   `^<полное имя, экранированное для RegExp>$`]`: `-t` у vitest ищет regex без якорей, и без `^` и `$` повтор
   test-а «a» запустил бы и «a b».
3. `test/e2e/failures-reporter.ts` (Playwright) — в `onEnd`: каждый test, чей `outcome()` `unexpected`; `attempt` —
   номер последней попытки; `ms` — её `duration`. `rerun` — `["node", <путь CLI Playwright относительно корня>,
   "test", "<file>:<line>"]` (+ `--output test-results/package --grep @packaged --workers=1` для test-а `@packaged`).
   Путь CLI — из `require.resolve`, проверен test-ом на существование.
4. Оба — в списки `reporters` (`vitest.config.ts`, `playwright.config.ts`); комментарии рядом говорят, зачем.

## Готово, когда

- [ ] Unit test (vitest): fake `TestModule` с одним упавшим, одним зелёным и одним flaky test-ом — одна строка;
      `name` через « > », `file` с `/`, `line` есть; `error` — первая строка без ANSI и без пути домашней папки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/failures-reporter.test.ts` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e
- [ ] Unit test (vitest): модуль с ошибкой импорта — запись с `name: null`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/failures-reporter.test.ts` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e
- [ ] Unit test (Playwright): fake `Suite` с `unexpected`, `flaky` и `skipped` — одна строка, `attempt` = номер
      последней попытки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/failures-reporter.test.ts` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e
- [ ] Unit test: без `GATE_FAILURES_FILE` reporter-ы не пишут ничего и не печатают ничего.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/failures-reporter.test.ts` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e
- [ ] Unit test: `rerun` начинается с `node`, второй элемент — существующий файл в репозитории; на `win32` argv тот
      же (shell не нужен).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/failures-reporter.test.ts` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e
- [ ] Contract test: шаблон `-t` из `rerun` упавшего fixture-test-а `a` в файле, где есть и test `a b`, запускает
      ровно `a` (vitest печатает `1 failed`, остальные test-ы файла — skipped).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/failures-reporter-rerun.test.ts` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e
- [ ] FLAKY-строки и `test-results/vitest-timings.json` — как до Ticket-а (`test/unit/flaky-reporter.test.ts`,
      `test/unit/test-timings.test.ts` зелёные).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/flaky-reporter.test.ts test/unit/test-timings.test.ts` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (правка `playwright.config.ts` включит
      полный e2e — это ожидаемо).
  - evidence: gate pass · `gate fast` exit 0 · mac - · 0b27cf0f66b533ba386c86375265197d46b8a33e

## Тесты

- Unit `test/unit/failures-reporter.test.ts` (новый): оба reporter-а на fake-объектах, временный файл как
  `GATE_FAILURES_FILE`.
- Contract `test/contract/failures-reporter-rerun.test.ts` (новый): берёт шаблон `-t` из argv `rerun` и запускает
  vitest на `test/fixtures/failures-reporter/rerun.fixture.test.ts` с `--config
  test/fixtures/failures-reporter/vitest.config.ts`: fixture вне `include` проектов основного конфига, и `pnpm test`
  его не подхватит.
- Сначала падающий: fake `TestModule` с одним упавшим test-ом — файл пуст.

## Где в коде

- `test/failure-records.ts` (новый)
- `test/failures-reporter.ts` (новый)
- `test/e2e/failures-reporter.ts` (новый)
- `vitest.config.ts`
- `playwright.config.ts`
- `test/unit/failures-reporter.test.ts` (новый)
- `test/contract/failures-reporter-rerun.test.ts` (новый)
- `test/fixtures/failures-reporter/` (новый)

Только читать: `test/flaky.ts`, `test/flaky-reporter.ts`, `test/e2e/flaky-reporter.ts`, `test/timings-reporter.ts`,
`scripts/vitest-electron.mjs`, `harness/hooks/gate-failures.mjs` (Ticket 01 — формат строки).

## Итог

- `test/failure-records.ts` — форма строки и дописывание в `GATE_FAILURES_FILE`. В строке, кроме полей из «Что
  делаем», есть и `test` (`<runner> <file> > <name>`, как `testId` Ticket-а 01, или `null`): со `step` от gate строка
  сразу проходит `checkFailure`, unit test проверяет это через `checkRunRecord`. `error` обрезан до 200 символов,
  как `ERROR_CHARS` gate; личные данные не ищутся — их чистит gate.
- vitest: reporter стоит перед `test/flaky-reporter.ts`, а не после: test FLAKY-reporter-а требует, чтобы тот был
  последним в списке. Повтор упавшего модуля (`name: null`) — `node scripts/vitest-electron.mjs <file>` без `-t`.
- Playwright: путь CLI — `require.resolve('@playwright/test/cli')` от корня, у pnpm это
  `node_modules/.pnpm/@playwright+test@<версия>/node_modules/@playwright/test/cli.js`. Повтор проверен вручную на
  временном spec-е: `node <cli> test <file>:<line>` запустил только упавший test.
- Вне следа, без этого красно: `tsconfig.test.node.json` (новые файлы в списке проекта), `scripts/ci-scope.mjs`
  (`test/failure-records.ts` импортирует e2e reporter — PR с его правкой гоняет macos-e2e),
  `test/unit/playwright-json-report.test.ts` (список reporter-ов Playwright).
