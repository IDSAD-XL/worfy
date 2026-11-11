# 03 — Подхват сервера на ходу и Restart с тем же разговором

Type: task
Status: open
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», строка 03; «Решения владельца» Q3, Q6, Q10; «Решения по реализации»
(Restart, Autopilot); «Решено без владельца» 4, 5; «Риски» (живой подхват невозможен); истории 1, 2, 11; возражение 2
критика ([docs/product/critic/worfy-mcp-live-2026-11-11.md](../../../docs/product/critic/worfy-mcp-live-2026-11-11.md))

## Что происходит

- Новый сервер пользователя, разрешённый списком, в работающую Session не попадает. Каким вызовом его подхватить и
  можно ли вообще, решил spike (Ticket 01, `.scratch/worfy-mcp-live/spike-mcp-live.md`).
- После Ticket-а 02 у driver-а Claude есть `status` и `act`, событие `mcp` и канал `agent.mcpAction`; действие
  `restart` обработчик пока отклоняет.
- Перезапуск Session с тем же разговором в worfy уже есть — relaunch Orchestrator-а (ADR-0064,
  `src/main/agent/orchestrator.ts:33–35`): новый процесс Claude Code стартует только после выхода старого
  (`Session.exited`, SIGKILL по таймауту), через `SessionRegistry.start(…, after)`
  (`src/main/agent/session/registry.ts:100`). `start` отклоняет resume живой Session ошибкой «Session … is already
  live» и принимает `vendor`.
- Session Autopilot (`unattended: true`, `src/main/vendors/claude/options.ts:299`) сейчас ничего не подхватывает и
  ничего не должна подхватывать посреди Wave.

## Что делаем

1. Подхват: при каждом чтении статуса (и по сигналу, который выбрал spike) driver Claude сверяет набор Session с
   конфигурацией и подхватывает новый разрешённый сервер вызовом из заметки spike-а. Где spike сказал «на ходу
   нельзя», строка получает действие `restart`.
2. `restart` в `agent.mcpAction` — «Restart Session with the same conversation». Путь общий для Vendor-ов, не в
   driver-е: старая Session закрывается; новая стартует `SessionRegistry.start(cwd, resume, …, after, vendor)`, где
   `after` — выход старого процесса, как у relaunch (ADR-0064). Новая Session живая сразу, в `starting`, и держит то,
   что ей отправили. Набор серверов новой Session читается заново, по нынешнему Profile. Если идёт ход, он прерывается
   так же, как другие прерывания Session. Своего пути запуска процесса этот Ticket не пишет; общие части relaunch-а,
   если нужно, выносятся из `orchestrator.ts`, без смены его поведения.
3. Autopilot: в Session с `unattended: true` подхвата нет, набор серверов фиксируется при старте Session Wave; строки
   без `restart`. `reconnect` работает.
4. Connector claude.ai: путь подхвата берётся из итога живой проверки владельца в заметке spike-а. Если итога к claim-у
   нет, connector идёт тем же путём, что сервер в allowlist (подхват или `restart`), а пункт connector-а в «Готово,
   когда» остаётся открытым до итога владельца (spec, «Решено без владельца» 5). Остальное вливается без него.

## Готово, когда

- [ ] Contract test `test/contract/claude-mcp-pickup.test.ts` над fake query: новый разрешённый сервер появляется в
      событии `mcp` без новой Session (или строка получает `restart`, если так решил spike). Красный до правки — в
      «Итог».
- [ ] Contract test `restart`: новая Session продолжает тот же разговор (тот же `sdkId`); fake query нового процесса
      стартует только после выхода старого; ошибки «already live» нет; ход, который шёл, прерван.
- [ ] Contract test: unattended Session не подхватывает сервер посреди Wave и не получает `restart`.
- [ ] Существующие test-ы relaunch-а Orchestrator-а (ADR-0064) зелёные без правок.
- [ ] `test/contract/sdk-compat.test.ts` держит форму вызова подхвата, который выбрал spike, в SDK 0.3.322.
- [ ] (manual) Подхват connector-а claude.ai — по итогу живой проверки владельца в заметке spike-а; путь записан в
      «Итог».
- [ ] Все unit и contract test-ы модулей `src/main/vendors/claude/` и `src/main/agent/` зелёные; lint, typecheck и
      gate fast — exit 0.

## Где в коде

- `src/main/vendors/claude/mcp.ts`
- `src/main/vendors/claude/session.ts`
- `src/main/agent/session/registry.ts`
- `src/main/agent/orchestrator.ts` (только если выносятся общие части relaunch-а)
- `src/main/agent/fake-query.ts`
- обработчик `agent.mcpAction` из Ticket-а 02
- `test/contract/claude-mcp-pickup.test.ts` (новый)
- `test/contract/sdk-compat.test.ts`

## Вне скоупа

- UI кнопки Restart: Ticket 04 рисует её из `actions`.
- Allow и строки «не разрешён»: Ticket 05.
- `restart` у строк Codex: Ticket 06 (путь отсюда годится и для Codex).
