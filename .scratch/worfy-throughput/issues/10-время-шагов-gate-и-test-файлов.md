# 10 — Время run-а на виду: gate печатает и записывает время шагов, vitest и Playwright — время каждого test-файла

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов», решение Q7
(«замер до любой смены процесса»; ответ владельца — «Да на все семь, начинай с Q7»);
[ADR-0081](../../../docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md) (принят 2026-10-20).

## Что происходит

- gate (`harness/hooks/gate.mjs`) не печатает, сколько шёл каждый скрипт и весь run. В verdict-файле
  (`writeVerdict`, `harness/hooks/gate.mjs:273`) и в логах run-а
  (`<state>/logs/<worktree>/<run>/NN-<скрипт>.log`, `harness/hooks/gate-log.mjs`) времени тоже нет.
  Настоящее время gate fast и gate full на Mac не знает никто.
- vitest (`vitest.config.ts`, запуск — `scripts/vitest-electron.mjs`) и Playwright (`playwright.config.ts`,
  reporter-ы `list` и `./test/e2e/helpers.ts`) не пишут время по файлам. Какие из 435 test-файлов
  самые дорогие, неизвестно.

## Что делаем

1. gate печатает после каждого скрипта строку с его временем и в конце — общее время. Те же числа
   (скрипт, время в ms, код выхода; общее время) идут в verdict-файл и в лог run-а. Новые поля
   verdict-файла не ломают его читателей (`src/main/gate/state.ts`, `src/shared/ipc/checks.ts`).
   Cache hit печатает время записанного зелёного run-а или говорит, что такого run-а не было.
2. vitest и Playwright пишут JSON-отчёт с временем каждого test-файла в путь под `test-results/`
   (каталог уже в `.gitignore`). Playwright очищает свой `outputDir` (`test-results/e2e`) в начале
   каждого run-а — отчёт лежит вне его. Обычный вывод не меняется: `scripts/vitest-electron.mjs` проверяет
   итоговые строки vitest, и reporter с итогом остаётся.
3. Скрипт `scripts/<имя>.mjs` печатает N самых медленных файлов по этим отчётам (`--top N`, по
   умолчанию 20): файл, слой (unit, contract, jsdom, e2e), время.
4. Первый замер — в «Итог»: gate fast и gate full на Mac (`GATE_SCOPE=all`), 20 самых медленных файлов
   каждого слоя.

Платформенный PR (ADR-0056, пункт 2): меняется скрипт Harness (`harness/hooks/gate.mjs`) — до merge нужен
вердикт Windows (ADR-0071).

## Готово, когда

- [ ] gate fast печатает строку с временем на каждый скрипт и общее время; test в
      `harness/hooks/tests/` проверяет строки на stub-скриптах.
- [ ] verdict-файл и лог run-а содержат время каждого скрипта и общее время; test проверяет поля.
- [ ] `pnpm test` пишет JSON с временем по файлам под `test-results/`; `git status` после run-а
      чистый.
- [ ] `pnpm test:e2e <файл>` пишет JSON с временем по файлу под `test-results/`, вне `test-results/e2e`.
- [ ] `node scripts/<имя>.mjs --top 5` печатает 5 файлов по убыванию времени; unit test на фикстуре.
- [ ] «Итог»: время gate fast и gate full на Mac и список самых медленных файлов, с командами и кодами
      выхода.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
      Windows; gate full — шаг Orchestrator-а перед merge.

## Где в коде

- `harness/hooks/gate.mjs` — `runScript` (`:658`), `writeVerdict` (`:273`), итоговые строки `[gate]`.
- `harness/hooks/gate-log.mjs`, `harness/hooks/tests/gate-log.test.sh`
- `vitest.config.ts`, `scripts/vitest-electron.mjs`
- `playwright.config.ts`
- новый скрипт в `scripts/` и его test в `test/unit/`

## Вне скоупа

- Ускорение самих test-ов — Ticket-ы 11–13 и 15.
- Время в CI на GitHub: там оно уже есть по шагам job-а.

## Итог
