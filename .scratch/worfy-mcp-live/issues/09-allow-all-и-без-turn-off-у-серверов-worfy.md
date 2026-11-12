# 09 — Allow all, серверы worfy без Turn off, chip MCP в строке под полем ввода

Type: task
Status: claimed 2026-11-12T13:29Z
PR: #1827
Branch: worfy-mcp-live/09
Blocked by: none
Source: владелец 2026-11-12 Q2, Q3 («все да»); владелец 2026-11-12 Q9 (а), Q10 («да») — chip из шапки в строку под
полем ввода; низкие замечания ревью #1826 и #1822

## Что происходит

- В popover-е chip-а «MCP n/m» у строк собственных серверов worfy (worfy-canvas, worfy-browser, worfy-mind-map) есть
  «Turn off for this Session»: driver Claude даёт Turn off каждой подключённой строке attended Session
  (`withTurnOff`, `src/main/vendors/claude/mcp.ts`). Без worfy-canvas Session теряет инструменты холста.
- Группа «Not allowed in this Project» даёт Allow по одной строке. Каждое Allow — своя запись Profile и свой Restart с
  тем же разговором; Allow по пяти серверам — пять Restart-ов подряд (очередь записей одного Project-а —
  `allowMcpServer`, `src/main/ipc/profile-edit.ts`, #1826).
- Шапка Session тесная: chip MCP стоит после Model, Effort, Permissions и Cost (`SessionView.tsx`).
- Ревью #1826 оставило низкие замечания без test-ов: отказ записи Allow отпускает очередь; ключ очереди Project-а
  (`src/main/ipc/agent.ts`) на настоящем worktree; ветки Session.allow «процесса нет после ожидания» и «сервер уже
  в процессе — без Restart»; ошибка строки переживает новые строки. Ревью #1822: нет test-а, что два разных
  Project-а запускают два query инвентаря; ключ Project-а кэшируется навсегда, в том числе null после сбоя git
  (`mcp-inventory.ts`).

## Что делаем

1. Q2: строки собственных серверов worfy (worfy-canvas, worfy-browser, worfy-mind-map) — без «Turn off for this
   Session»; остальные их действия (Reconnect, Sign in) остаются. Driver Claude не кладёт `turn-off` в действия таких строк (кнопки — только из действий строки); main отказывает в `turn-off` такого
   сервера и через IPC, даже если его попросили в обход popover-а.
2. Q3: кнопка «Allow all» в заголовке группы «Not allowed in this Project»: одна запись Profile со всеми именами
   (через ту же очередь Project-а в `profile-edit.ts`), затем ОДИН Restart с тем же разговором; в unattended Session —
   только запись Profile. Ошибка остаётся видна в группе, как ошибка строки.
3. Q9/Q10: chip «MCP n/m» уходит из шапки Session в строку под полем ввода, отдельным элементом registry composer-а
   (`src/renderer/session/composer/`), рядом с context meter. Chip сохраняет вид предупреждения и tooltip; popover
   открывается вверх и остаётся в окне (шкала z-index и open layers из ui-kit 02). Какие Session показывают chip — как
   сейчас: Orchestrator и Session Node — да, Product Session — нет.
4. Низкие замечания #1826 и #1822 — test-ы (и правка кэша ключа Project-а в `mcp-inventory.ts`).
5. `docs/features/mcp-servers.md`, `docs/features/sessions.md` и переводы `ru/`: Allow all, правило серверов worfy,
   где теперь chip.

## Готово, когда

- [ ] Unit/contract test: строка источника `worfy` без `turn-off`; `agent.mcpAction` `turn-off` такого сервера —
      отказ, Session не перезапускается.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (claude-mcp-turn-off, claude-mcp-allow worfy over IPC) · mac - · 46a7db01bf77a2adbdcb24c49776e943447902dc
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (round 2: mcp-status-row, claude-mcp-turn-off plugin keeps Turn off) · mac - · 41c125d0949c093b7dd5c9444e1e07f05e948e37
- [ ] Contract test Allow all: N имён — одна запись `profile-set --set`, один Restart, все имена в списке; отказ
      записи — ошибка, Session не меняется; unattended — без Restart.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (claude-mcp-allow: Allow all) · mac - · 46a7db01bf77a2adbdcb24c49776e943447902dc
- [ ] Unit test: кнопка «Allow all» есть только при ≥2 строках с Allow и неактивна, пока идёт действие; ошибка
      остаётся в группе.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (mcp-chip.test.tsx: Allow all) · mac - · 46a7db01bf77a2adbdcb24c49776e943447902dc
- [ ] Unit test элемента composer-а: chip в строке под полем ввода Orchestrator-а и Session Node, нет в Product
      Session и в шапке; popover открывается вверх.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (session-view.test.tsx, mcp-chip.test.tsx) · mac - · 46a7db01bf77a2adbdcb24c49776e943447902dc
- [ ] Test-ы низких замечаний #1826 и #1822; ключ Project-а после сбоя git не кэшируется.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (claude-mcp-allow, claude-mcp-inventory, mcp-chip) · mac - · 46a7db01bf77a2adbdcb24c49776e943447902dc
- [ ] E2e `test/e2e/session-mcp.spec.ts`: у worfy-canvas нет кнопок; chip ищется в строке под полем ввода; снимок —
      строка под полем с открытым popover-ом. Зелёный в CI (локальный e2e не запускается, правило владельца).
- [ ] Страницы Feature en и ru обновлены; каждое утверждение сверено с кодом.
  - evidence: commit pass · worfy-mcp-live 09: Allow all, no Turn off for worfy's own servers, MCP chip under the input field · - - · 46a7db01bf77a2adbdcb24c49776e943447902dc
  - evidence: commit pass · worfy-mcp-live 09 round 2: no Turn off only for worfy's own servers, not for plugins' · - - · 41c125d0949c093b7dd5c9444e1e07f05e948e37
- [ ] lint, typecheck, unit и contract test-ы затронутых модулей, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 46a7db01bf77a2adbdcb24c49776e943447902dc
  - evidence: gate pass · `gate fast` exit 0 (round 2) · mac - · 41c125d0949c093b7dd5c9444e1e07f05e948e37

## Где в коде

- `src/main/vendors/claude/mcp.ts`
- `src/main/vendors/claude/mcp-inventory.ts`
- `src/main/agent/session.ts`
- `src/main/ipc/agent.ts`
- `src/main/ipc/profile-edit.ts`
- `src/shared/ipc/agent.ts`
- `src/renderer/session/McpChip.tsx`, `src/renderer/session/mcp-chip.css`
- `src/renderer/session/composer/McpServers.tsx` (новый)
- `src/renderer/session/SessionView.tsx`
- `src/renderer/session/product-session.ts`
- `test/contract/claude-mcp-allow.test.ts`, `test/contract/claude-mcp-turn-off.test.ts`,
  `test/contract/claude-mcp-inventory.test.ts`, `test/contract/claude-mcp-status.test.ts`,
  `test/contract/claude-mcp-pickup.test.ts`
- `test/unit/mcp-chip.test.tsx`, `test/unit/session-view.test.tsx`, `test/unit/link-access.test.ts`
- `test/e2e/session-mcp.spec.ts`
- `docs/features/mcp-servers.md`, `docs/features/ru/mcp-servers.md`, `docs/features/sessions.md`,
  `docs/features/ru/sessions.md`
- `.scratch/worfy-mcp-live/issues/08-приёмка-владельцем.md` (Blocked by)

## Вне скоупа

- Серверы plugin-ов, которые поставил пользователь: они тоже показаны с источником `worfy`, но правило Q2 их не касается —
  Turn off у них остаётся (раунд 2 ревью #1827).
- Allow all для Codex: у Codex нет строк «не разрешён» (Q8).

## Итог

- **Серверы worfy без Turn off (Q2).** `withTurnOff` (`src/main/vendors/claude/mcp.ts`) не даёт `turn-off` строке
  собственного сервера worfy: `isWorfyOwnServer` (`src/shared/agent/mcp-status.ts`) — источник `worfy` и имя из
  `WORFY_SERVER_NAMES` (worfy-canvas, worfy-browser, worfy-mind-map). Сервер plugin-а, который поставил пользователь
  (Claude Code говорит `plugin`, worfy показывает источник worfy), Turn off сохраняет; сервер qmd Harness-а Claude Code
  отдаёт как `dynamic` — user config, тоже с Turn off. Кнопки по-прежнему только из действий строки; упавший сервер worfy
  предлагает Reconnect, needs-auth — Sign in и Reconnect. Session (`restartFor`, `src/main/agent/session.ts`) отклоняет
  `turn-off` собственного сервера worfy, даже если driver по ошибке его предложил; через IPC это отказ «not available»,
  процесс не перезапускается. Раунд 2 ревью: правило сначала касалось всех строк источника `worfy`, то есть и plugin-ов —
  шире решения владельца; сужено.
- **options.ts.** Проверка `mcpOff` для собственных серверов worfy убрана (их больше нельзя выключить). Для серверов plugin-а
  Harness, которые worfy передаёт в `mcpServers` в обход policy tier, проверка осталась: иначе выключенный `plugin_worfy_qmd`
  всё равно попадал бы в процесс (test в `test/unit/agent-options.test.ts`).
- **Allow all (Q3).** Канал `agent.mcpAllowAll` (`src/shared/ipc/agent.ts`, write) → `Session.mcpAllowAll` →
  `allowMcpServers` (`src/main/ipc/profile-edit.ts`): одна запись `--set` со всеми недостающими именами, в той же очереди
  Project-а, что и Allow; затем один Restart с тем же разговором. Allow одного сервера теперь идёт тем же путём
  (`allowNames`). Unattended Session — только запись. Сервер, которого нет в новом процессе, называется в ошибке
  (`allowAllNotStarted`). Кнопка — `Button` variant `secondary` в заголовке группы, только при ≥2 строках с Allow (решено
  без владельца: при одной строке «Allow all» повторяет её Allow); неактивна, пока идёт любое действие popover-а; ошибка —
  toast и строка под заголовком, которая переживает новые строки.
- **Chip под полем ввода (Q9/Q10).** Элемент composer-а `McpServers` (`src/renderer/session/composer/McpServers.tsx`),
  `line = 'hint'`, `order = 4` — сразу слева от context meter. В brief-е сказано «controls line, рядом с context meter»;
  context meter стоит в строке подсказки, а не в строке controls, и chip поставлен рядом с ним, в строку подсказки: так он
  не отнимает ширину у pickers. Product Session — chip-а нет (`PRODUCT_SESSION_HIDDEN_COMPOSER_ITEMS`), как не было в её
  шапке. Popover открывается вверх (`bottom` над chip-ом), высота — не больше места над chip-ом и не больше 480 px; слой —
  `--z-popover`, `role="dialog"`, то есть open layer ui-kit 02.
- **Найдено по ходу (session.ts).** Allow, который ждал чужой Restart, решал «перезапускать ли ещё раз» по `mcp()`; когда
  чужое чтение строк обгоняло его, `mcp()` отдавал строки старого процесса, и Allow перезапускал Session второй раз зря.
  Теперь решение — по ответу самого процесса (`rowsNow`). Test «no second Restart …» был красным до правки (3 процесса
  вместо 2).
- **Кэш ключа Project-а инвентаря.** `projectOf` (`mcp-inventory.ts`) больше не запоминает «корня нет» (null или сбой git):
  следующий вопрос спрашивает git снова; найденный корень запоминается, как раньше.
