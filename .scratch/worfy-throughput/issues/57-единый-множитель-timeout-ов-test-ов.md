# 57 — Единый множитель timeout-ов test-ов, без привязки к машине

Type: task
Status: claimed 2026-10-29T19:52Z
Blocked by: —
Source: решение владельца 2026-10-29 — «множитель можешь сразу ставить, чтобы не привязываться к конкретной машине»;
отчёты gate full ПК владельца (Windows) на `main` b2b30e07 и 0be09773: 9 из 10 красных vitest-test-ов в каждом
прогоне — timeout под нагрузкой, каждый из них зелёный в одиночку.

**Исключение из правила профиля.** Правило проекта «timeout-ы test-ов не поднимают по одному» (`rules.md`,
подтверждено 2026-10-23) этот Ticket не нарушает: владелец 2026-10-29 разрешил один общий множитель на весь набор
(«множитель можешь сразу ставить, чтобы не привязываться к конкретной машине»). Поднимать предел одного test-а
по-прежнему нельзя.

Платформенный: да (ПК проверяет после merge — gate full `GATE_SCOPE=all` на `main`).

## Что происходит

- `test/time-scale.ts` экспортирует `timeScale = process.platform === 'win32' ? 3 : 1`. Им умножены пределы
  vitest по умолчанию (`vitest.config.ts`: `testTimeout` 5 s, `hookTimeout` 10 s, contract — 15 s) и около 30 мест
  в test-ах, где множитель поставлен руками.
- Остальные пределы не умножены: литералы в объявлениях test-ов (`}, 45_000)`), `{ timeout: N }` у `vi.waitFor`,
  `expect.poll` и у ожиданий Playwright, `timeout` в `playwright.config.ts` (60 s) и
  `playwright.acceptance.config.ts` (15 min).
- Красные на ПК доходят примерно до 1,5× своего предела: 3122 ms при 3000, 1517 при 1500, timeout-ы 45 s
  (уже ×3: `ci-workflow.test.ts:1078`, `harness-migrate`:476, `projects-connect`:1345) и 60 s
  (`harness-evals-outcome`:1670 и :1708 — литерал, не умноженный). ПК под нагрузкой медленнее, чем ×3.

## Что делаем

1. Один источник: переменная окружения `WORFY_TEST_TIMEOUT_SCALE`, читается в `test/time-scale.ts`. Значение по
   умолчанию одно на всех машинах и платформах (не меньше 3, чтобы пределы Windows не стали короче); проверка
   платформы уходит.
2. Центральное применение: `vitest.config.ts` (уже через `timeScale`), `playwright.config.ts` (`timeout` и
   `expect.timeout`), `playwright.acceptance.config.ts`.
3. Один helper `ms(n)` для пределов в самих test-ах; все литеральные пределы test-ов переходят на него.
4. Contract test: новый литеральный предел test-а мимо helper-а краснит набор (mutant с сырым литералом — красный).
5. Временные границы внутри assertion-ов, которые меряют бюджет продукта, не трогаем и перечисляем в «Итог».

## Готово, когда

- [x] `WORFY_TEST_TIMEOUT_SCALE` и значение по умолчанию — в `test/time-scale.ts`; неверное значение — ошибка
      при старте run-а, не молчаливая 1.
- [x] `vitest.config.ts`, `playwright.config.ts`, `playwright.acceptance.config.ts` умножают свои пределы.
- [x] Литеральные пределы test-ов идут через `ms(...)`; contract test это сторожит, mutant с сырым литералом красный.
- [x] «Итог»: значение по умолчанию и довод, цена для CI (насколько позже ловится зависший test), список бюджетов
      продукта, оставленных как есть, follow-up для предела shell test-ов Harness.
- [ ] gate fast — `[gate] green`; один e2e spec под замком e2e показывает, что Playwright берёт множитель.

## Где в коде

- `test/time-scale.ts` — множитель и helper `ms`
- `vitest.config.ts`, `playwright.config.ts`, `playwright.acceptance.config.ts`
- `test/unit/**`, `test/contract/**`, `test/e2e/**`, `test/acceptance/**` — литеральные пределы test-ов
- `test/contract/test-timeout-scale.test.ts` — новый contract test; `test/timeout-literals.ts` — его scanner
- `scripts/ci-scope.mjs` — `test/time-scale.ts` теперь импортируют e2e-файлы, его правка запускает `macos-e2e`
- `tsconfig.test.node.json`, `tsconfig.test.web.json` — новые файлы в списке

## Вне скоупа

- Предел shell test-а Harness (`FILE_TIMEOUT_MS` в `test/contract/harness-scripts.test.ts`) — файл переделывает
  `worfy-throughput` 56 (#1023); follow-up в «Итог».
- Бюджеты продукта в assertion-ах (`terminal-windows`, `workflow-reader`, `guard-silent.test.sh`) — решение владельца
  отдельно.

## Итог

**Исключение из правила профиля — решение владельца 2026-10-29:** «множитель можешь сразу ставить, чтобы не
привязываться к конкретной машине». Это один общий множитель на весь набор; предел одного test-а по-прежнему не
поднимается.

### Механизм

- `test/time-scale.ts`: `DEFAULT_TIMEOUT_SCALE = 3`, `readTimeoutScale(WORFY_TEST_TIMEOUT_SCALE)`, `timeScale` и
  helper `ms(limit)` (`Math.round(limit * timeScale)`). Проверки платформы нет. Пустая или незаданная переменная —
  значение по умолчанию; число меньше 1, `NaN`, `Infinity`, текст — ошибка при загрузке конфигурации (проверено:
  `WORFY_TEST_TIMEOUT_SCALE=zero npx playwright test --list` — exit 1, «must be a number of at least 1»).
- Центрально: `vitest.config.ts` — `testTimeout` `ms(5_000)`, `hookTimeout` `ms(10_000)`, contract `ms(15_000)`;
  `playwright.config.ts` — `timeout: ms(60_000)` и `expect: { timeout: ms(5_000) }` (5 s — значение Playwright по
  умолчанию, раньше не умножалось); `playwright.acceptance.config.ts` — `ms(15 * 60_000)`.
- Литеральные пределы в test-ах: codemod по AST (TypeScript parser) обернул в `ms(...)` 694 места в 157 файлах —
  последний аргумент `it`/`test`/`describe`/hook-ов, `{ timeout: N }` у `vi.waitFor`, `expect.poll`, matcher-ов и
  действий Playwright, `spawnSync`, `test.setTimeout`; места с `* timeScale` стали `ms(...)`. Руками — именованные
  пределы: `RUN_TIMEOUT`, `SETUP_TIMEOUT`, `SCAFFOLD_TIMEOUT_MS`, `SANDBOX_HOOK_MS`, `SPAWN_TIMEOUT_MS`,
  `SHELL_WAIT_MS`, `SHELL_TEST_MS`, `STUB_LIFETIME_MS`, `STUB_READY_MS`, `START_MS` (Git Bash),
  `FIRST_WINDOW_TIMEOUT_MS`, `QUIT_TIMEOUT_MS`, `PID_TIMEOUT_MS`, `GONE_TIMEOUT_MS`, `SAMPLE_TIMEOUT_MS`,
  `FIRST_IMAGE_MS`, `FIRST_FRAME_MS`, `WAVE_TIMEOUT_MS`, `vi.setConfig({ testTimeout })` в `link-notify`. Пауза
  `chokidar-close.test.ts` (`200 * timeScale`) стала `ms(200)`.
- Самописные ожидания с часами (`Date.now() + N` в цикле): 14 helper-ов с параметром предела (`until`,
  `nextDelta`, `nextSnapshot`, `writeUntil` в `workflow-reader`, `workflow-stages`, `autopilot*`, `e3-sandbox`,
  `link-access`, `login-shell-capture`, `harness-script-env`, `counted-fs`, `tickets-chokidar`, `watch-gone`)
  умножают предел внутри (`const wait = ms(limit)`), их вызовы передают число как было; `SHELL_WAIT_MS`
  (`link-access`) поэтому остаётся без `ms`. Литеральные сроки таких циклов — через `ms(...)`: `install-stable`,
  `link-safe-watch`, `linked-shared-subscriptions`, `e2e-end-app`, `clients`, `workflow-stages`, `workflow-reader`,
  `linked-opening.spec.ts`. Длительность действия, а не предел (`snapping.spec.ts:350`, `:450`,
  `epic-frame.spec.ts:1162` — 2 и 5 s движения мыши), не тронута. Эти ожидания scanner не видит (форма у каждого
  своя): новый такой цикл держится на ревью.
- Два локальных `ms` (переменные времени в `terminal.test.ts` и `terminal-ai-zle.test.ts`) переименованы в `took`.
- `test/contract/test-timeout-scale.test.ts` + scanner `test/timeout-literals.ts` (AST): предел test-а как голое
  число (литерал или арифметика литералов) — красный test с `файл:строка`. Смотрит `test/**` (кроме
  `test/fixtures/`) и три конфигурации. Исключения — строка с `// unscaled: <причина>`, файлы `test/time-scale.ts`
  и `test/unit/quarantine.test.ts` (там `timeout` — данные объявленных test-ов), и `FILE_TIMEOUT_MS` по имени (ниже).
  Mutant-ы: `}, ms(60_000))` → `}, 60_000)` в `chokidar-close-callers.test.ts` — exit 1,
  `test/unit/chokidar-close-callers.test.ts:121: }, 60_000)`; `timeout: ms(60_000)` → `60_000` в
  `playwright.config.ts` — exit 1, `playwright.config.ts:71`. После возврата — exit 0, 6 passed.

### Значение по умолчанию: 3, на всех платформах и в CI

- Не меньше 3: на Windows пределы уже были ×3 (`vitest.config.ts`, около 30 мест руками), и ни один не стал короче.
  Красные ПК (b2b30e07, 0be09773) шли примерно до 1,5× своего предела — 3122 ms при 3000, 1517 при 1500, 45 s
  (уже ×3: `ci-workflow.test.ts:1078`, `harness-migrate`:476, `projects-connect`:1345) и 60 s
  (`harness-evals-outcome`:1670 и :1708 — литерал без множителя, теперь ×3). Значит, на ПК 3 лечит только литералы,
  а пределы, уже умноженные на 3, остаются как были.
- **Значение по умолчанию уточняется по замеру ПК (проход maxWorkers=8: лимит и фактическое время каждого
  timeout-а).** Это одна константа `DEFAULT_TIMEOUT_SCALE`; contract test требует от неё только «не меньше 3».
- CI берёт то же значение: workflow-ы переменную не задают. «Без привязки к машине» значит один множитель и для
  runner-ов; другой множитель для CI — снова пределы, зависящие от места run-а.

### Цена для CI

- Зелёный run не дольше. Полный `pnpm test --maxWorkers=9` на Mac: exit 0, 473 файла, 161,6 s wall, сумма времён
  файлов 1164 s; полный run worktree #1023 на той же машине за 2 минуты до того (множитель 1) — 176,1 s wall, 1259 s.
  Медленнее намеренно только пауза `chokidar-close` (200 → 600 ms).
- Зависший test ловится позже: на (3 − 1) × предел за попытку, а CI повторяет упавший test один раз
  (`CI_RETRIES`). Unit: 5 → 15 s (+20 s с повтором); contract: 15 → 45 s (+60 s); hook: 10 → 30 s; e2e: 60 → 180 s
  на test (+240 s с повтором). На Windows пределы vitest по умолчанию не изменились.
- Худший случай job-а: самые большие пределы — `e3-sandbox.test.ts` «40 runs each end within 15 s» (900 s → 2700 s
  на Linux и macOS; на Windows test пропущен), `harness-evals-outcome` `SETUP_TIMEOUT` (300 → 900 s), пределы 240 s
  (→ 720 s). Такой зависший test теперь останавливает `timeout-minutes` job-а раньше vitest: `linux-tests` — 30 min,
  `macos-tests`, `macos-e2e`, `windows` — 45 min, `windows / full-suite` — 60 min. Job-ы и раньше не могли идти
  дольше этих пределов; меняется то, что в логе такого job-а нет строки FAIL этого test-а, job отменён по времени.

### Оставлены как есть, с причиной

Это не пределы ожидания, а бюджеты продукта или окна, которые test ждёт до конца. Под нагрузкой они краснеют так
же, решение — у владельца отдельно.

- Бюджеты в assertion-ах (bridge): `test/contract/terminal-windows.test.ts:175` (close без console host, < 3000 ms),
  `test/contract/workflow-reader.test.ts:838` (Ticket ≤ 1500 ms после сохранения),
  `harness/hooks/tests/guard-silent.test.sh:180` (попытка `bin/silent-check` 0,5 s, `TRY_MS`).
- Ещё бюджеты того же вида (`expect(<прошедшее время>).toBeLessThan(N)`): `test/contract/terminal-ai-zle.test.ts:421`
  (Esc < 2000), `test/unit/status-block.test.ts:168`, `:185` (1000), `test/unit/terminal-osc.test.ts:233` (1000),
  `test/unit/arrange-by-epic-command.test.tsx:156` (1000), `test/unit/agent-env.test.ts:124` (3000),
  `test/unit/launch.test.ts:303` (5000), `test/contract/terminal-windows.test.ts:213` (8000),
  `test/contract/terminal-git-bash-close.test.ts:122`, `:138`, `:154`, `:177` (10 000),
  `test/contract/agent-controls.test.ts:738` (2000), `test/contract/login-shell-capture.test.ts:124`, `:237` (2000),
  `:169` (10 000), `test/contract/link-server.test.ts:363`, `:531`, `:587` (1000), `:883` (3000),
  `test/contract/projects-connect.test.ts:610`, `:677` (8000), `:801`, `:832`, `:887`, `:933` (3000),
  `test/contract/link-pairing-failures.test.ts:126` (3000), `:400` (2000),
  `test/contract/terminal-ai-next-command.test.ts:253`, `:259` (1000), `test/contract/orchestrator-relaunch.test.ts:345`
  (1000), `test/contract/claude-home-registry.test.ts:515` (≤ 1000), `test/contract/cards-watch-links.test.ts:103`
  (1000), `test/contract/harness-install.test.ts:1201` (10 000), `test/contract/link-reconnect.test.ts:128` (2500),
  `:793` (150), `test/contract/plan-preset.test.ts:278` (1000), `test/contract/statusline-bridge.test.ts:229` (3000),
  `test/contract/claude-home-subagents.test.ts:726` (1000), `test/contract/remote-guards-links.test.ts:197` (1000),
  `test/acceptance/e3.spec.ts:414` (10 000), `test/e2e/card-runtime.spec.ts:125` (≤ 1000),
  `test/e2e/linked-cards.spec.ts:260` (≤ 1000), `test/e2e/edges.spec.ts:372` (≤ 100),
  `test/e2e/epic-frame.spec.ts:346` (≤ 1000), `test/e2e/tidy-up.spec.ts:263` (`BUDGET_MS`), бюджеты старта
  `test/e2e/start-budget.ts` (`START_MS`, `RUNNER_START_CAP_MS`). `harness-scripts.test.ts:447`, `:469`, `:491` уже
  умножены на `timeScale` и теперь ×3 и на Mac.
- Помечены `// unscaled:`: `test/unit/session-history-tail.test.tsx:626` (timeout test-а — бюджет чтения: линейно,
  не квадратично); `test/contract/e3-sandbox.test.ts:1061`, `:1073` (команда должна ещё ждать, когда окно 2,5 s
  кончится; длиннее — только медленнее); `test/e2e/canvas-layout.spec.ts:523` (ожидаемая ошибка называет 1000 ms);
  `test/unit/first-window-shown.test.ts:22` (предел функции под fake timers).
- Параметры продукта, не пределы test-а: `FAR_BOUND_MS` (`terminal-git-bash-close`), `LIMIT_MS`
  (`orchestrator-relaunch`), шаги диагностики старта (`test/e2e/start-diagnosis.ts`), значения в `toEqual`/
  `toMatchObject` (опции, которые продукт передаёт дальше), `msUntil` в `handoff.spec.ts` (замер).
- В заголовках некоторых test-ов «within 5 s» (`workflow-reader.test.ts:1309…1439`) — это их `vi.waitFor`, теперь
  ×3: заголовок говорит о пределе ожидания, assertion бюджета там нет.

### Follow-up

- **Предел shell test-а Harness.** `FILE_TIMEOUT_MS` (900 s на Windows, 120 s в других местах) живёт в
  `test/contract/harness-scripts.test.ts`, который #1023 (`worfy-throughput` 56) разносит по
  `test/harness-scripts-suite.ts` и `harness-scripts-1..4`. После его merge: `FILE_TIMEOUT_MS` → `ms(...)` и убрать
  исключение `OWNED_ELSEWHERE` из `test-timeout-scale.test.ts`. До тех пор shell test-ы Harness не умножены; ждать
  можно — красные ПК не из них.
- **Строка в `scripts/affected-tests.table.json`** (файл #1023): `test/** → test/contract/test-timeout-scale.test.ts`
  (`scan: true`). Без неё PR, который трогает только test-файл, этот contract test в `linux-tests` не запускает;
  его ловит gate fast implementer-а и run на push в `main`.
- **Значение по умолчанию** — по замеру ПК (выше).

### Проверки

