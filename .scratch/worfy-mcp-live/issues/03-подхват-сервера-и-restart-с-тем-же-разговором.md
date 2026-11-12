# 03 — Подхват сервера на ходу, Restart с тем же разговором и Turn off for this Session

Type: task
Status: claimed 2026-11-12T01:27Z
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», строка 03; «Решения владельца» Q3, Q6, Q10; «Решения по реализации»
(Restart, Autopilot); «Решено без владельца» 2 (поправка 2026-11-12), 4, 5; «Риски» (живой подхват невозможен); истории 1, 2, 11; возражение 2
критика ([docs/product/critic/worfy-mcp-live-2026-11-11.md](../../../docs/product/critic/worfy-mcp-live-2026-11-11.md))

## Что происходит

- Новый сервер пользователя, разрешённый списком, в работающую Session не попадает. Каким вызовом его подхватить и
  можно ли вообще, решил spike (Ticket 01, `.scratch/worfy-mcp-live/spike-mcp-live.md`): `reloadPlugins()`
  подхватывает разрешённый сервер на ходу (scope `user`, `local`, `project`); сервер вне списка на ходу не включить.
- `toggleMcpServer` выключает сервер и пишет `disabledMcpServers` в запись Project-а в `.claude.json` пользователя
  (spike, шаг 3, пункт 4). «Turn off for this Session» поэтому делается Restart-ом без сервера (spike, шаг 3,
  пункт 5: сервер убран из `allowedMcpServers` или назван в `deniedMcpServers` — в Session его нет, `.claude.json`
  не изменился; spec, «Решено без владельца» 2).
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
3. `turn-off` и `turn-on` в `agent.mcpAction` — тот же Restart с тем же разговором. Session помнит свой набор
   выключенных серверов (не Profile и не `.claude.json`). Restart строит `managedSettings` новой Session без
   выключенного сервера: имя убрано из `allowedMcpServers`, а если у Profile нет списка — названо в
   `deniedMcpServers`. Свой сервер worfy (`worfy-canvas` и другие) просто не передаётся в `mcpServers`. `turn-on` —
   Restart с сервером обратно. `toggleMcpServer` worfy не зовёт, в `.claude.json` ничего не пишет. Новая Session (не
   Restart) получает все серверы снова. Строка connected даёт `turn-off`, выключенная — `turn-on`.
4. Autopilot: в Session с `unattended: true` подхвата нет, набор серверов фиксируется при старте Session Wave; строки
   без `restart`, `turn-off` и `turn-on`. `reconnect` работает.
5. Connector claude.ai: путь подхвата берётся из итога живой проверки владельца в заметке spike-а. Если итога к claim-у
   нет, connector идёт тем же путём, что сервер в allowlist (подхват или `restart`), а пункт connector-а в «Готово,
   когда» остаётся открытым до итога владельца (spec, «Решено без владельца» 5). Остальное вливается без него.

## Готово, когда

- [ ] Contract test `test/contract/claude-mcp-pickup.test.ts` над fake query: новый разрешённый сервер появляется в
      событии `mcp` без новой Session (или строка получает `restart`, если так решил spike). Красный до правки — в
      «Итог».
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/claude-mcp-pickup.test.ts) · mac - · 918c22243edcc785a06a2d9ff4b288595c56fe12
- [ ] Contract test `restart`: новая Session продолжает тот же разговор (тот же `sdkId`); fake query нового процесса
      стартует только после выхода старого; ошибки «already live» нет; ход, который шёл, прерван.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/claude-mcp-turn-off.test.ts, describe restart) · mac - · 918c22243edcc785a06a2d9ff4b288595c56fe12
- [ ] Contract test `test/contract/claude-mcp-turn-off.test.ts` над fake query: `turn-off` перезапускает Session с
      тем же `sdkId` после выхода старого процесса; в `managedSettings` нового query нет выключенного сервера (или он
      в `deniedMcpServers`), свой сервер worfy не передан в `mcpServers`; `toggleMcpServer` не зовётся; файл
      `.claude.json` во временном HOME test-а побайтно тот же до и после; `turn-on` возвращает сервер; новая Session
      (не Restart) получает выключенный сервер снова. Красный до правки — в «Итог».
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/claude-mcp-turn-off.test.ts, describe turn-off and turn-on) · mac - · 918c22243edcc785a06a2d9ff4b288595c56fe12
- [ ] Contract test: unattended Session не подхватывает сервер посреди Wave и не получает `restart`, `turn-off` и
      `turn-on`.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/claude-mcp-pickup.test.ts, describe an unattended Session) · mac - · 918c22243edcc785a06a2d9ff4b288595c56fe12
- [ ] Существующие test-ы relaunch-а Orchestrator-а (ADR-0064) зелёные без правок.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/orchestrator-relaunch.test.ts unchanged against origin/main) · mac - · 918c22243edcc785a06a2d9ff4b288595c56fe12
- [ ] `test/contract/sdk-compat.test.ts` держит форму вызова подхвата, который выбрал spike, в SDK 0.3.322.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/sdk-compat.test.ts, reloadPlugins) · mac - · 918c22243edcc785a06a2d9ff4b288595c56fe12
- [ ] (manual) Подхват connector-а claude.ai — по итогу живой проверки владельца в заметке spike-а; путь записан в
      «Итог».
- [ ] Все unit и contract test-ы модулей `src/main/vendors/claude/` и `src/main/agent/` зелёные; lint, typecheck и
      gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 918c22243edcc785a06a2d9ff4b288595c56fe12

## Где в коде

- `src/main/vendors/claude/mcp.ts`
- `src/main/vendors/claude/session.ts`
- `src/main/agent/session/registry.ts`
- `src/main/agent/orchestrator.ts` (только если выносятся общие части relaunch-а)
- `src/main/agent/fake-query.ts`
- обработчик `agent.mcpAction` из Ticket-а 02
- `src/main/vendors/claude/options.ts` (`managedSettings` без выключенных серверов)
- `test/contract/claude-mcp-pickup.test.ts` (новый)
- `test/contract/claude-mcp-turn-off.test.ts` (новый)
- `test/contract/sdk-compat.test.ts`

## Вне скоупа

- UI кнопок Restart, Turn off и Turn on: Ticket 04 рисует их из `actions`.
- Allow и строки «не разрешён»: Ticket 05.
- `restart` у строк Codex: Ticket 06 (путь отсюда годится и для Codex).

## Итог

- Красный до правки (тот же набор test-ов на исходниках `origin/main` 9eb522bae): `vitest run
  test/contract/claude-mcp-pickup.test.ts test/contract/claude-mcp-turn-off.test.ts test/contract/claude-mcp-status.test.ts
  test/contract/sdk-compat.test.ts` — exit 1, 17 из 45 красные: fake query не знает директиву `mcp_added` и
  `reloadPlugins`, `turn-off`, `turn-on` и `restart` отклоняются «not available», строки connected без `turn-off`,
  ответ статуса, спрошенный до Reconnect, ложится поверх нового.
- **Restart — в той же Session, а не новой через `SessionRegistry.start(…, after)`.** Spec и Ticket предлагали закрыть
  старую Session и запустить новую. Но у Session три владельца, которые держат её объект и id (Orchestrator, Session
  Node — `node-sessions.ts`, канал `agent.start`); новая Session получила бы id `pending-…` до своего `init`, и окно,
  Orchestrator и вызвавший `agent.mcpAction` остались бы с закрытой. Поэтому `Session.restartProcess()` закрывает
  процесс и зовёт тот же `begin()`, которым Session уже перезапускает процесс после падения: новый процесс с `resume`
  того же разговора стартует только после выхода старого (`endProcesses`, SIGKILL по `EXIT_WAIT_MS`, ADR-0064). Ошибки
  «already live» быть не может: `registry.start` не зовётся. `orchestrator.ts` и `registry.ts` не правлены. Путь общий
  для Vendor-ов: driver только говорит `restarts: true` (`McpPart`) и стартует без серверов `SessionStart.mcpOff`.
- Ход, который шёл, прерывается как Interrupt: очередь держится, открытые запросы отклоняются, конец хода ждётся
  `HALT_TURN_MS` (общий с `halt()` helper `interruptTurn`). Что отправили во время перезапуска, ждёт новый процесс.
  Старый процесс закрывается до `begin()`, поэтому `begin()` только ждёт его выхода и не шлёт SIGKILL по пределу.
  Если за время ожидания конца хода Session закрыли, остановили (`halt`) или её перезапустил второй Restart, новый
  процесс не стартует (раунд ревью 1: test-ы close, второго Restart и halt, с процессами-stub-ами и без них).
- **Id Session после Restart.** Если ход уже был, id тот же. Restart или Turn off до первого сообщения разговора не
  продолжает: его ещё нет, `sdkSessionId` пуст. Новый процесс начинает новый разговор под новым id, и Session
  получает `renamed`, как после процесса, умершего до первого хода (`newSessionId`). Владельцы `renamed` обрабатывают;
  поведение оставлено и закреплено test-ом.
- **Подхват:** `reloadPlugins()` без опций, затем `mcpServerStatus()`. Зовётся только на `agent.mcp` с
  `pickUp: true` и только когда ход не идёт; его шлёт popover chip-а при открытии (решение Orchestrator-а, раунд ревью 1).
  Простое чтение окна, а также запросы после `init` и `result` подхват не делают. Подтверждение
  из-за prompt cache не спрашивается, `holdOnCacheImpact` не используется: tool-список меняется только когда сервер
  действительно добавлен. Строки с `restart` подхват не даёт: spike показал, что разрешённый сервер подхватывается на
  ходу; `restart` принимается каналом для Ticket-а 05 (Allow).
- **Turn off / Turn on:** Session помнит выключенные серверы (`mcpOff`) со строкой `disabled` и `turn-on`; каждый её
  процесс стартует без них: имя убрано из `allowedMcpServers`, свой сервер worfy не передан в `mcpServers`.
  Без списка Profile (Session вне Project — единственный случай без `managedSettings`, со списком по умолчанию Session в
  Project всегда) — `{ deniedMcpServers: [{ serverName }] }` без `allowManagedMcpServersOnly`. **Эта форма на
  настоящем Claude Code не измерена:** spike слал deny вместе со списком (F:turnoff-restart-denied); contract test
  держит только форму записи и то, что fake сервер не отдаёт. `toggleMcpServer` не зовётся; `.claude.json` во
  временном HOME test-а побайтно тот же. `turn-off` принимается только для строки, где он предложен (connected),
  `turn-on` — только для выключенного.
- Autopilot: unattended Session не подхватывает, строки без `turn-off`, `restart`/`turn-off`/`turn-on` отклоняются
  (`McpActionRefused`), `reconnect` работает.
- Хвосты ревью #1811: ответы статуса упорядочены — driver нумерует свои запросы (ответ события на любой, кроме
  последнего, не уходит), Session берёт ответ `mcp()` только если после него не было другого запроса и события `mcp`,
  и процесс тот же. Четыре test-а в `claude-mcp-status.test.ts`; мутанты, снимающие каждую из четырёх проверок,
  убиты. Fake по умолчанию отвечает `[]` без console.warn.
- Connector claude.ai (пункт manual): итога живой проверки владельца в заметке spike-а нет, connector идёт тем же путём,
  что сервер списка (`reloadPlugins` при чтении статуса); пункт открыт до итога владельца.
- Вне списка «Где в коде» правлены: `src/main/agent/session.ts` (Restart, `mcpOff`, порядок ответов),
  `src/main/agent/session/types.ts` (`reloadPlugins`, `QueryRequest.mcpOff`), `src/main/vendors/session.ts`
  (`SessionStart.mcpOff`), `src/main/vendors/mcp.ts` (`restarts`), `src/main/vendors/claude/query.ts` (передаёт
  `mcpOff`), сценарии `test/fixtures/agent-scripts/mcp-pickup.jsonl`, `mcp-restart.jsonl`, `mcp-restart-long.jsonl`,
  и два test-а, чьи списки событий не ждали события `mcp` с `[]` (`agent-session.test.ts`,
  `auto-approve-claude.test.ts`: события `mcp` отфильтрованы, baseline не тронут). Test-ы relaunch-а Orchestrator-а не
  правлены.
