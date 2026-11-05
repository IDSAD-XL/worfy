# 06 — Сбои на Orchestrator-е Codex: упавший ход и умерший app-server

Type: task
Status: done 2026-11-05T16:53Z
PR: #1440
Blocked by: 02
Source: [spec.md](../spec.md), «Сценарии» (строки «Codex: ход упал», «Codex: app-server умер»), «Вопросы владельцу», Q5; [worfy-multi-vendor 37](../../worfy-multi-vendor/issues/37-orchestrator-и-autopilot-на-codex.md) (Autopilot ведёт Wave через SessionHandle Orchestrator-а любого Vendor-а) — влит до старта Epic-а

## Что происходит

- После worfy-multi-vendor 37 Orchestrator может быть Session Codex; Run пишет `vendor` в `run-started`.
- Fake Codex — `test/fixtures/codex-app-server/fake-app-server.mjs` (`WORFY_CODEX=fake`), скрипты
  `test/fixtures/codex-scripts/`, среди них `turn-failed.jsonl`; каждую строку скрипта сверяет со схемой закреплённой
  версии Codex `test/contract/codex-fake.test.ts`.
- Contract test Run-а на Codex заводит 37 (`test/contract/codex-orchestrator.test.ts`); сбоев там нет.
- Временный `CODEX_HOME` — обязателен; настоящий Codex не запускается.

- Выйти посреди хода fake Codex не умеет: шаги — `expect` / `notify` / `request`
  (`fake-app-server.mjs:7-12`), выход — только когда worfy закрыл stdin (`:45`) или по ошибке скрипта (`fail`,
  `:109-111`).

## Что делаем

1. **Шаг выхода в fake Codex:** `{"exit": <code>}` — app-server выходит с этим кодом, не дожидаясь stdin. Строка
   в шапке `fake-app-server.mjs`; `test/contract/codex-fake.test.ts` принимает шаг (он ничего не шлёт, схеме
   сверять нечего) и проверяет, что fake выходит с кодом.
   Setup — `faultRun({ vendor: 'codex' })` из Ticket-а 02, без правки.
2. **Ход упал:** `autopilot-fault-turn-failed.jsonl` — Wave уходит, `turn/completed` со статусом `failed` и ошибкой.
   Ожидание как у API 500: `turn-error`, текст ошибки в `session-error`, `checkRecovery` пустой, новый старт проходит.
3. **app-server умер:** `autopilot-fault-exit.jsonl` — посреди хода шаг `{"exit": 1}`. Ожидание как у убитого
   процесса Orchestrator-а: `session-error`, `run-stopped`, новый Run в новой Session.

## Готово, когда

- [ ] Contract test: Codex, ход упал — `turn-error`, `checkRecovery` пустой, новый Run шлёт команду Wave один раз.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs --run test/contract/autopilot-faults-codex.test.ts` exit 0 · mac - · 63a8cca0c8887cb03ce1250603de7932ee35f58d
  - evidence: review pass · PR #1440 · - - · 3d47083ce6637236a2356a428ab5f3741e79e4c7
- [ ] Contract test: Codex, app-server умер — `session-error`, `checkRecovery` пустой, новый Run стартует.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs --run test/contract/autopilot-faults-codex.test.ts` exit 0 · mac - · 63a8cca0c8887cb03ce1250603de7932ee35f58d
  - evidence: review pass · PR #1440 · - - · 3d47083ce6637236a2356a428ab5f3741e79e4c7
- [ ] `codex-fake.test.ts`: шаг `exit` — fake выходит с кодом шага; оба новых скрипта проходят проверку схемы.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs --run test/contract/codex-fake.test.ts test/contract/codex-compat.test.ts` exit 0 · mac - · 63a8cca0c8887cb03ce1250603de7932ee35f58d
  - evidence: review pass · PR #1440 · - - · 3d47083ce6637236a2356a428ab5f3741e79e4c7
- [ ] Ни один test не запускает настоящий `codex`; `CODEX_HOME` — временная папка.
  - evidence: test-run pass · `pnpm test` exit 0 (all fake Codex users under WORFY_CODEX=fake from test/setup-contract.ts) · mac - · 63a8cca0c8887cb03ce1250603de7932ee35f58d
  - evidence: review pass · PR #1440 · - - · 3d47083ce6637236a2356a428ab5f3741e79e4c7
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
  - evidence: test-run pass · `zsh -f mutate.zsh` 8 mutants, each run exit 1 (list in Итог) · mac - · 63a8cca0c8887cb03ce1250603de7932ee35f58d
  - evidence: review pass · PR #1440 · - - · 3d47083ce6637236a2356a428ab5f3741e79e4c7
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: review pass · PR #1440 · - - · 3d47083ce6637236a2356a428ab5f3741e79e4c7
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42064938576/job/127390738535 · ci - · 3d47083ce6637236a2356a428ab5f3741e79e4c7

## Тесты

- Contract `test/contract/autopilot-faults-codex.test.ts` (новый).
- Сначала падающий: «ход упал» до скрипта сценария — fake Codex играет удачный ход, ожидание `turn-error` красное.
- Прогнать `test/contract/codex-*.test.ts`, `test/contract/autopilot*.test.ts`.

## Где в коде

- `test/contract/autopilot-faults-codex.test.ts` (новый)
- `test/fixtures/codex-scripts/autopilot-fault-turn-failed.jsonl` (новый)
- `test/fixtures/codex-scripts/autopilot-fault-exit.jsonl` (новый)
- `test/fixtures/codex-app-server/fake-app-server.mjs`
- `test/contract/codex-fake.test.ts`

Только читать: `test/contract/autopilot-faults-setup.ts`, `test/fixtures/codex-scripts/turn-failed.jsonl`,
`test/contract/codex-orchestrator.test.ts`, `src/main/vendors/codex/launch.ts`.

## Итог

- Fake Codex: шаг `{"exit": <code>}` (`fake-app-server.mjs`, шапка и `loadScript`) — процесс выходит с кодом шага сразу,
  не дожидаясь закрытия stdin и без SessionEnd; перед выходом ждёт, пока уйдёт всё, что скрипт отправил раньше (pipe на
  macOS пишет асинхронно). Шаг не «код выхода один» (`"1"`, `256`, `exit` вместе с `notify`) — fake выходит с кодом 2.
  Старые скрипты играют как раньше: `exit` в них нет.
- `autopilot-fault-turn-failed.jsonl` — Wave-ход `autopilot-wave.jsonl` до `turn/started`, затем `error` и
  `turn/completed` со статусом `failed` (`internalServerError`, 500 API модели). `autopilot-fault-exit.jsonl` — тот же
  ход до начала ответа агента, затем `{"exit": 1}`.
- `test/contract/autopilot-faults-codex.test.ts`: оба сценария на `faultRun({ vendor: 'codex', marks: 'none' })`,
  скрипты процессов `turn`, сценарий, `resume` (последний — для всех следующих). Процессы по порядку: 1 attended
  Orchestrator, 2 unattended Session Run-а (сбой), 3 возврат Orchestrator-а на thread Wave, 4 Session нового Run-а
  (`thread/resume` того же thread-а, команда Wave в `turn/start`), 5 возврат после Force stop.
  - Ход упал: `run-stopped` `turn-error`, один `session-error` с текстом ошибки, новый старт шлёт Wave 1 ещё раз, один
    раз; `checkRecovery` пустой.
  - app-server умер: `run-stopped` `session-error`, `session-error` «Codex app-server exited with code 1», новый Run
    стартует в новом процессе; процесс 2 закончился сам с кодом 1; `checkRecovery` пустой.
  - Ни один fake app-server не переживает test: test ловит каждый spawn `fake-app-server.mjs` (mock
    `node:child_process` поверх настоящего) и после `registry.closeAll()` ждёт выхода всех пяти — до `afterEach`
    setup-а, который добил бы оставшиеся.
- `codex-fake.test.ts`: шаг `exit` — fake выходит с кодом 1 посреди хода при открытом stdin, до выхода уходят
  `item/started` и `item/agentMessage/delta`; `{"exit":7}` — код 7; кривые шаги — код 2. Проверка схемы принимает
  только `{"exit": <целое>}` и отказывает `{"exit":"1"}` и `exit` вместе с сообщением; оба новых скрипта есть в папке
  и проходят её.
- Вне следа, с согласия Orchestrator-а (решено без владельца, подтвердить): `test/contract/codex-compat.test.ts` сверяет каждый шаг каждого скрипта с
  записями настоящего Codex, и шаг `exit` (он ничего не шлёт) делал его красным. Теперь из сверки выпадает только шаг
  «код выхода один» (`messageSteps`); шаг с `exit` другой формы остаётся в сверке, и `exitProblems` называет его.
- Время файлов (локально, `test-results/vitest-timings.json`): `autopilot-faults-codex` 1.7 с,
  `codex-fake` 2.2 с, `codex-compat` 0.6 с — в пределе Epic-а 20 с.
- Каждый test краснеет на испорченном ожидании или fixture-е (каждая порча — отдельный запуск, файл возвращён):
  - сценарий «ход упал» играет `autopilot-wave` (удачный ход) — красный test «ход упал» (`reason` не `turn-error`);
  - сценарий «app-server умер» играет `autopilot-wave` — красный test «умер»;
  - fake пропускает шаг `exit` — красные test «умер» и test шага `exit` в `codex-fake`;
  - fake выходит с кодом 0 вместо кода шага — красные те же два;
  - `codex-compat` выбрасывает любой шаг с ключом `exit` — красный test `messageSteps`/`exitProblems`;
  - `{"exit":"1"}` в `autopilot-fault-exit.jsonl` — красные оба test-а `codex-compat` над записями и скриптами,
    test `exitProblems`, проверка схемы и test шага `exit` в `codex-fake`;
  - `waves: 3` вместо 2 в ожидании `checkRecovery` — красные оба сценария;
  - ожидание «одна команда Wave» вместо двух — красные оба сценария.
- `src/` не изменён.
