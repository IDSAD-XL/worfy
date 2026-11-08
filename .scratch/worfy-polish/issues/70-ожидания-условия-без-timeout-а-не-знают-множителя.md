# 70 — Ожидания условия без timeout-а не знают множителя

Type: bug
Status: claimed 2026-11-08T01:38Z
Branch: worfy-polish/70
Blocked by: —
Source: находка `worfy-polish` 69 (2026-11-08): в `test/contract` и `test/unit` около 349 вызовов `vi.waitFor(...)` без
своего timeout-а. Строки перечитаны по main `37f099ecb`.

## Что происходит

- Все пределы времени test-ов идут через один множитель `ms()` (`test/time-scale.ts`, `WORFY_TEST_TIMEOUT_SCALE`, по
  умолчанию 3; `worfy-throughput` 57): медленная машина — нагруженный Mac, ПК или runner Windows — получает
  пропорционально больше времени. `test/contract/test-timeout-scale.test.ts` падает на пределе, записанном числом мимо
  `ms()`.
- Но ожидание условия без своего timeout-а этот множитель не видит: `vi.waitFor` и `vi.waitUntil` vitest 5.0.3 сдаются
  через 1 s с проверкой раз в 50 ms (`node_modules/vitest/dist/chunks/index.C4tKZ0yW.js:7139`, `:7187`), и настройки
  vitest для них нет. Так же — `expect.poll` (1 s, если в config-е не задан `expect.poll.timeout`) и `waitFor` / `findBy*`
  Testing Library в jsdom test-ах (`asyncUtilTimeout` 1 s). Сканер `test/timeout-literals.ts` такие вызовы не замечает:
  числа в них нет.
- Под нагрузкой 50–100 условие, которое приходит за 1–2 s, проваливает test по времени, а не по коду: источник flaky
  test-ов. Правило проекта — timeout-ы не подстраивают по одному, принят общий множитель, не зависящий от машины.

## Что делаем

1. Одно место на весь набор: `test/scaled-waits.ts` — обёртки `vi.waitFor` и `vi.waitUntil`, которые вызову без
   timeout-а дают 1 s × множитель; свой timeout вызова и interval остаются как были. Обёртки ставит setup-файл
   `test/setup-waits.ts`, общий для всех project-ов `vitest.config.ts`; повторная установка (vitest грузится один раз
   на worker, setup-файл идёт на каждый файл test-ов) обёртку не удваивает.
2. Там же — `expect.poll`: `expect.poll.timeout` в `vitest.config.ts`; Testing Library — `configure({ asyncUtilTimeout })`
   в `test/setup-dom.ts`. Тот же предел `ms(1_000)`.
3. Вызовы со своим timeout-ом не трогаем. Сканер уже требует для них `ms()`; исключения — пределы, выведенные из
   времени продукта (в «Итог»).
4. Unit test механизма на fake timers: с множителем 2,5 ожидание без timeout-а ждёт 2,5 s, а не 1 s; свой timeout вызова
   остаётся. Плюс проверка, что каждый project (node, contract, jsdom) работает с обёртками.
5. Описать в `test/time-scale.ts`, где описан `ms()`.

## Готово, когда

- [ ] `vi.waitFor` и `vi.waitUntil` без своего timeout-а ждут 1 s × множитель во всех project-ах vitest; свой timeout
      вызова и interval не меняются; обёртка не удваивается.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/scaled-waits.test.ts test/unit/scaled-waits-dom.test.tsx test/contract/test-timeout-scale.test.ts` exit 0 · mac - · 3de0f4d56a306b5682d13274421c14600e24f3a6
- [ ] `expect.poll` и `waitFor` / `findBy*` Testing Library без своего timeout-а ждут 1 s × множитель.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/scaled-waits.test.ts test/unit/scaled-waits-dom.test.tsx` exit 0 (expect.poll and asyncUtilTimeout checks) · mac - · 3de0f4d56a306b5682d13274421c14600e24f3a6
- [ ] Unit test на fake timers: при множителе 2,5 ожидание без timeout-а не кончается к 2499 ms и кончается к 2500 ms;
      при множителе 4 вызов со своим timeout-ом 400 ms кончается к 400 ms.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/scaled-waits.test.ts` exit 0 · mac - · 3de0f4d56a306b5682d13274421c14600e24f3a6
- [ ] `pnpm test` (все unit и contract), `pnpm lint`, `pnpm typecheck`, gate fast — exit 0.
  - evidence: test-run pass · `pnpm test` exit 0 (687 files passed); `pnpm lint` exit 0; `pnpm typecheck` exit 0 · mac - · 3de0f4d56a306b5682d13274421c14600e24f3a6
  - evidence: gate pass · `gate fast` exit 0 · mac - · 3de0f4d56a306b5682d13274421c14600e24f3a6
- [ ] `ci-ok` зелёный на head PR.

## Где в коде

- `test/scaled-waits.ts` (новый) — обёртки и предел по умолчанию.
- `test/setup-waits.ts` (новый) — ставит обёртки на `vi`.
- `vitest.config.ts` — `setupFiles` и `expect.poll.timeout` корня конфигурации.
- `test/setup-dom.ts` — `asyncUtilTimeout` Testing Library.
- `test/time-scale.ts` — описание.
- `test/unit/scaled-waits.test.ts`, `test/unit/scaled-waits-dom.test.tsx` (новые), `test/contract/test-timeout-scale.test.ts` — test-ы.
- `tsconfig.node.json`, `tsconfig.test.node.json`, `tsconfig.test.web.json` — новые файлы в `include`.
- Только чтение: `test/timeout-literals.ts` (сканер чисел-пределов), `node_modules/vitest/dist/chunks/index.C4tKZ0yW.js:7139-7235`.

## Итог

Ожидание условия без своего timeout-а теперь ждёт 1 s × множитель (по умолчанию 3 s): `vi.waitFor` и `vi.waitUntil` —
через обёртки `test/scaled-waits.ts`, которые `test/setup-waits.ts` ставит во всех трёх project-ах (node, contract,
jsdom); `expect.poll` — через `expect.poll.timeout` в `vitest.config.ts`; Testing Library — через `asyncUtilTimeout` в
`test/setup-dom.ts`. Ни один из 1192 вызовов `vi.waitFor` не правился.

Вызовы со своим timeout-ом не тронуты. Сканер `test/timeout-literals.ts` уже не пускает в них число мимо `ms()`; без `ms()`
остались только пределы, выведенные из времени продукта, и это намеренно — test проверяет, что событие пришло раньше
срока продукта:

- `test/unit/epic-arrangement-record.test.tsx:537` — `FIRST_OPENING_WAIT_MS / 3` (`src/renderer/canvas/arrangement-record.ts:193`, 3000 ms).
- `test/contract/terminal-ai-zle-prompt.test.ts:319`, `:331` — `ASK_KEPT_MS / 2` (`src/main/terminal-ai/shell-link.ts:33`, 2000 ms).

Цена: test, который ждёт условие, которое не наступит, без своего timeout-а теперь падает через 3 s, а не через 1 s.
Test-ов, которые ждут такого отказа нарочно, в `test/` нет (поиск `rejects` рядом с `waitFor`, `waitUntil`, `poll`, `findBy`).
