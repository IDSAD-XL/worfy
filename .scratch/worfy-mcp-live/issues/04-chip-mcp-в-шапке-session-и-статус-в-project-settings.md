# 04 — Chip «MCP n/m» в шапке Session и статус в Project settings

Type: task
Status: open
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
- [ ] Unit test `test/unit/edit-profile.test.tsx` дополнен: статус рядом с именем списка MCP.
- [ ] E2e `test/e2e/session-mcp.spec.ts` на fake query: chip в шапке, popover со строками, клик Reconnect уходит в
      `agent.mcpAction`. Зелёный на macOS и Windows runner-е.
- [ ] Существующие test-ы шапки Session и Edit profile зелёные без правок ролей и `data-testid`.
- [ ] lint, typecheck, test-ы модулей `src/renderer/session/` и `src/renderer/projects/`, gate fast — exit 0.

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
