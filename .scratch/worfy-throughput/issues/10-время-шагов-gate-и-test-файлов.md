# 10 — Время run-а на виду: gate печатает и записывает время шагов, vitest и Playwright — время каждого test-файла

Type: task
Status: done 2026-10-21T00:19Z
PR: #620
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

- [x] gate fast печатает строку с временем на каждый скрипт и общее время; test в
      `harness/hooks/tests/` проверяет строки на stub-скриптах.
- [x] verdict-файл и лог run-а содержат время каждого скрипта и общее время; test проверяет поля.
- [x] `pnpm test` пишет JSON с временем по файлам под `test-results/`; `git status` после run-а
      чистый.
- [x] `pnpm test:e2e <файл>` пишет JSON с временем по файлу под `test-results/`, вне `test-results/e2e`.
- [x] `node scripts/<имя>.mjs --top 5` печатает 5 файлов по убыванию времени; unit test на фикстуре.
- [x] «Итог»: время gate fast и gate full на Mac и список самых медленных файлов, с командами и кодами
      выхода.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
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

PR #620, merge `3cd4b15e` (2026-10-21). Review — 2 круга: high (корректность и тесты, 7 правок), medium
(корректность по правкам, открыт только nit про комментарий `gate.mjs:77`). Вердикт Windows — success на
`7f52fa58`. После merge gate ставит владелец: `pnpm install:stable` (ADR-0047), до этого установленный gate
времени не печатает.

**Замер до (2026-10-20, Mac, repo-копия gate, без cache).** `node harness/hooks/gate.mjs fast` — 531,8 s:
lint 9,4 s, typecheck 3,2 s, test 519,0 s (exit 1: один timeout `harness-evals.test.ts` под нагрузкой, отдельно
он green). `pnpm test` (green, exit 0): wall 517,2 s, сумма по файлам 1443,6 s; `test/contract/harness-scripts.test.ts`
— 517,0 s, то есть весь wall. Отсюда Ticket [16](16-shell-test-ы-harness-параллельно.md).

**Замер после 16 (2026-10-21, gate full на `main` `9f9529c9` с #620, green, Session «Worfy продолжение»,
`node scripts/test-timings.mjs` в дереве gate).** Wall 12,9 min (00:04:43 → 00:17:38 UTC); до 16 gate full шёл
около 18,5 min.

| Шаг | Wall | Сумма по файлам | Файлов |
| --- | --- | --- | --- |
| vitest (`pnpm test`) | 133,0 s | unit 95,7 s, contract 880,5 s, jsdom 94,5 s | 351 |
| e2e (Playwright, `workers: 1`) | 565,3 s | 560,7 s | 88 |
| `test:package` | 25,4 s | — | — |
| lint, typecheck, подготовка | около 50 s | — | — |

Самые медленные файлы:
- contract: `harness-scripts` 111,2 s, `harness-evals` 82,7, `e3-sandbox` 81,7, `harness-install` 71,6,
  `terminal-ai-suggest` 57,2, `harness-migrate` 52,5, `workflow-reader` 43,3, `terminal-ai-zle` 43,0;
- unit: `free-place` 27,1 s, `install-stable` 17,8;
- e2e: `browser` 27,1 s, `autopilot` 23,4, `linked-machines` 23,4, `epic-frame` 20,8, `terminal` 20,7,
  `session-controls` 17,5, `canvas-layout` 17,4; длинный хвост ровный, ни один файл не больше 5 %.

Вывод: после 16 узкое место — последовательный e2e, около 73 % gate full. 12,9 min укладываются в бюджет Q2
для PR без UI (15 min), но не оставляют запаса. Рычаги: Ticket 13 (e2e по путям diff, для PR без UI) и Ticket
[17](17-e2e-в-несколько-worker-ов.md) (e2e в несколько worker-ов, для PR с UI).
