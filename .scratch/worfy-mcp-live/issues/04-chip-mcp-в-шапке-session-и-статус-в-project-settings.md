# 04 — Chip «MCP n/m» в шапке Session и статус в Project settings

Type: task
Status: claimed 2026-11-12T01:28Z
Blocked by: 02
Source: [spec.md](../spec.md), «Ticket-ы», строка 04; «Решения владельца» Q2, Q10; «Решения по реализации» (строку
строит main); «Решено без владельца» 1; истории 3, 4, 9, 12

## Что происходит

- В шапке Session (`src/renderer/session/SessionView.tsx:337`, факты шапки — `src/renderer/session/header-facts.ts`)
  есть модель и effort, MCP нет.
- Список MCP в Project settings — простой список имён (`src/renderer/projects/EditProfile.tsx:398`, поле «MCP
  servers»), без статуса.
- После Ticket-а 02 renderer получает событие `mcp` и может звать `agent.mcp` и `agent.mcpAction`. Строки с `restart`
  (Ticket 03), `not-allowed`, `allow` и `sign-in` (Ticket 05) приходят позже; схема строки их уже знает.

## Что делаем

1. Chip «MCP n/m» в шапке Session: n — connected, m — все серверы Session без «не разрешён»; предупреждающий вид, если
   есть failed или needs-auth. Без данных chip не показывается.
2. Popover по клику: строка на сервер — имя, статус, число tools, текст ошибки, источник (claude.ai, user config,
   Project, worfy), кнопки из `actions` строки (Reconnect, Turn off for this Session, Turn on, Allow, Sign in,
   Restart Session with the same conversation). Строки «не разрешён» — отдельной группой ниже. Кнопка неактивна, пока
   действие идёт; ошибка действия — toast.
3. В Autopilot Session строка Allow говорит «takes effect from the next Wave».
4. В Edit profile рядом с каждым именем списка `mcp.allowed` — статус из последней Session этого Project-а на этой
   Machine; если Session нет — без статуса.
5. Тексты UI английские. Снимки экрана в PR — с придуманными именами серверов.

## Готово, когда

- [ ] Unit test `test/unit/mcp-chip.test.tsx`: «n/m» по строкам; предупреждающий вид при failed и needs-auth; кнопки
      строго из `actions` (в том числе Allow, Sign in и Restart на строках из fixture-а); группа «не разрешён» под
      остальными. Красный до правки — в «Итог».
  - evidence: test-run pass · `vitest run test/unit/mcp-chip.test.tsx` exit 0 · mac - · cc4b2c4b265794a4a6b7c8c4e5950c8517ac2d28
- [ ] Unit test `test/unit/edit-profile.test.tsx` дополнен: статус рядом с именем списка MCP.
  - evidence: test-run pass · `vitest run test/unit/edit-profile.test.tsx` exit 0 · mac - · cc4b2c4b265794a4a6b7c8c4e5950c8517ac2d28
- [ ] E2e `test/e2e/session-mcp.spec.ts` на fake query: chip в шапке, popover со строками, клик Reconnect уходит в
      `agent.mcpAction`. Зелёный на macOS и Windows runner-е.
- [ ] Существующие test-ы шапки Session и Edit profile зелёные без правок ролей и `data-testid`.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · cc4b2c4b265794a4a6b7c8c4e5950c8517ac2d28
- [ ] lint, typecheck, test-ы модулей `src/renderer/session/` и `src/renderer/projects/`, gate fast — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · cc4b2c4b265794a4a6b7c8c4e5950c8517ac2d28
  - evidence: gate pass · `gate fast` exit 0 · mac - · cc4b2c4b265794a4a6b7c8c4e5950c8517ac2d28

## Где в коде

- `src/renderer/session/SessionView.tsx`
- `src/renderer/session/header-facts.ts`
- `src/renderer/session/McpChip.tsx` (новый)
- `src/renderer/session/mcp-chip.css` (новый)
- `src/renderer/projects/EditProfile.tsx`
- `test/unit/mcp-chip.test.tsx` (новый)
- `test/unit/edit-profile.test.tsx`
- `test/e2e/session-mcp.spec.ts` (новый)

## Вне скоупа

- Что делают Restart (Ticket 03), Allow и Sign in (Ticket 05) в main; строки Codex — Ticket 06. UI рисует их кнопки
  уже здесь.
- Подсказка о ручном вводе имени connector-а (запасной путь Q11): Ticket 05.
- Popover на Base UI: если Epic worfy-ui-kit к этому времени дал Popover kit, chip берёт его; если нет — свой popover
  по образцу соседних, перенос — в worfy-ui-kit.

## Итог

- Красный до правки: `vitest run test/unit/mcp-chip.test.tsx` на старом `src/renderer/session/store.ts` — 2 из 11
  красные: событие `mcp` попадало в список событий Session («expected [ { type: 'mcp', … } ] to deeply equal []»), а
  строки ответа `agent.mcpAction` некуда было положить (`acceptMcpServers is not a function`). До появления
  `McpChip.tsx` тот же файл падал на импорте модуля. `vitest run test/unit/edit-profile.test.tsx` на старом
  `EditProfile.tsx` — 1 из 26 красный: статуса рядом с именем списка MCP нет.
- Chip и popover — `src/renderer/session/McpChip.tsx` и `mcp-chip.css`; числа chip-а — `mcpCount` в `header-facts.ts`.
  Chip стоит в шапке после Cost, у Product Session его нет (у её шапки нет фактов). Вид chip-а — как у chip-а
  Permissions шапки (18 px, радиус 4 px, 11 px), предупреждение — цвета blocked и значок, не цвет один; popover — как
  меню Modes (surface, рамка 1 px, радиус 10 px, тень Node), `role="dialog"`, Esc закрывает его и не прерывает ход.
- Кнопки — строго из `actions` строки; клик всегда уходит в `agent.mcpAction`, других вызовов UI не делает. Allow —
  primary action (таблица Tokens F-SPEC). Строка Allow в Orchestrator-е, пока идёт Autopilot его Project-а
  (`autopilot.state` не `stopped`), говорит «Allow takes effect from the next Wave»; состояние Autopilot UI
  спрашивает только когда у какой-то строки есть `allow`.
- `store.ts` держит последнее событие `mcp` Session-а отдельно от transcript-а (`SessionLog.mcp`) и один раз
  спрашивает `agent.mcp`, когда view нужны строки раньше первого события. «Нет данных» от main убирает chip.
- Edit profile: под полем «MCP servers» — каждое имя списка со статусом из самой новой Session Project-а (Orchestrator
  или Session Node) на этой Machine, по событиям, которые пришли в это окно. Имя, которого нет в этой Session, — без
  статуса; без Session и для Project-а Linked machine — ничего.
- E2e `test/e2e/session-mcp.spec.ts` локально не запускался (правило владельца: без локального e2e); его гоняет CI.
  Снимки шапки с открытым popover-ом в обеих темах он кладёт в test output (`snapshots/session-mcp/`).
- Вне списка «Где в коде» правлены: `src/renderer/session/store.ts` (место для событий `mcp`, назван в брифе),
  `test/fixtures/agent-scripts/session-mcp.jsonl` (сценарий fake agent-а для e2e, придуманные имена серверов),
  `docs/features/sessions.md` (chip в описании шапки Session view; полное описание — Ticket 07).
