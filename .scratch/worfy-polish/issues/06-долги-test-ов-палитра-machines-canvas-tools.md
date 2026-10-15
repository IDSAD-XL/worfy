# 06 — Долги [low] test-ов: предел строк палитры, `expandMachines`, старые fixture-ы `canvas-tools`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), кандидат R11; «Итог»
[`worfy-ui` 07](../../worfy-ui/issues/07-группы-в-палитре.md) (долг [low] про `SHOWN`),
[`worfy-ui` 05](../../worfy-ui/issues/05-machines-точка-и-переключатели-в-settings.md) (долг [low] про
`expandMachines`), [`worfy-week` 03](../../worfy-week/issues/03-elk-раскладка-рамок-epic-ов.md) (долг
[low] про fixture-ы `canvas-tools`).

## Что происходит

Три долга ревью уровня [low], у которых нет Ticket-а. Все — в test-ах, код приложения не меняется.

1. **Предел строк палитры без test-а.** Палитра показывает не больше `SHOWN` = 50 строк
   (`src/renderer/palette/CommandPalette.tsx:25`), и предел режет ранжированный список **до**
   группировки (`:234-236`). Если порядок поменять (группировать, потом резать), test-ы не покраснеют.
2. **`expandMachines` читает `aria-expanded` один раз** (`test/e2e/helpers.ts:475`): если состояние
   раздела Machines загрузится между чтением и кликом, клик свернёт раздел, и test упадёт. Тот же шаблон —
   у `collapseMachines` (`:484`).
3. **Fixture-ы `test/contract/canvas-tools.test.ts` описывают то, чего больше нет:** Node `epic-frame` с
   ключом `offset:3` (`:486-490`) и смещение Subagent-а у Node-а `subagent-tree` (комментарий над
   fixture-ой, `:528-533`). После ADR-0037 renderer их не пишет, main снимает при чтении `layout.json`. В долге
   `worfy-week` 03 строки были `:438`, `:481` — с тех пор файл вырос.

Четвёртый долг того же списка — «`blur` кнопки Select не закрывает список» — закрыт Ticket-ом
`worfy-ui` 09: список закрывают Tab, `blur` окна и нажатие мышью снаружи. В этот Ticket он не входит.

## Что делаем

1. Unit test палитры: 60 команд, из них 55 одной группы и 5 другой с лучшим рангом; видно ровно 50
   строк, и 5 лучших среди них — то есть резка шла по рангу до группировки.
2. `expandMachines` и `collapseMachines`: дождаться, пока раздел загрузил своё состояние (атрибут
   `aria-expanded` есть и не меняется), и только потом решать, кликать ли; или кликать до нужного
   значения через `expect.poll`. Без пауз на время.
3. Fixture-ы `canvas-tools`: убрать `offset:*` и смещение Subagent-а там, где test проверяет другое;
   там, где test проверяет, что main **снимает** старые ключи при чтении, — оставить ключ и переписать
   комментарий: «старый файл, main снимает».

## Готово, когда

- [ ] Test предела палитры зелёный; с порядком «группировать, потом резать» — красный.
- [ ] `expandMachines` и `collapseMachines` без чтения атрибута один раз; e2e `sidebar-sections` зелёный.
- [ ] В `canvas-tools.test.ts` нет fixture-ов с `offset:*` и смещением Subagent-а, кроме test-а на их
      снятие; комментарии описывают нынешнее поведение.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/palette-groups.test.tsx` — test предела.
- Сначала красный: мутант «группировать, потом резать» в `CommandPalette.tsx` — новый test красный,
  без нового test-а — все зелёные (вывод обоих прогонов — в «Итог»).
- Мутант для `expandMachines`: клик без ожидания загрузки — e2e не краснеет детерминированно; это
  записать как есть.

## Где в коде

- `test/unit/palette-groups.test.tsx`
- `test/e2e/helpers.ts`
- `test/contract/canvas-tools.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/palette/CommandPalette.tsx`, `test/e2e/sidebar-sections.spec.ts`,
`docs/adr/0037-epic-frame-layout-by-elk.md`.

## Вне скоупа

- Изменение предела `SHOWN` или порядка групп.
- Остальные долги [low] из «Итог» Ticket-ов — разбор при закрытии Epic-ов.

## Итог

—
