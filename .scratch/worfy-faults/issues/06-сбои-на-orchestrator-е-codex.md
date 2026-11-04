# 06 — Сбои на Orchestrator-е Codex: упавший ход и умерший app-server

Type: task
Status: open
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
- [ ] Contract test: Codex, app-server умер — `session-error`, `checkRecovery` пустой, новый Run стартует.
- [ ] `codex-fake.test.ts`: шаг `exit` — fake выходит с кодом шага; оба новых скрипта проходят проверку схемы.
- [ ] Ни один test не запускает настоящий `codex`; `CODEX_HOME` — временная папка.
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

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
