# 06 — Долги [low] test-ов: предел строк палитры, `expandMachines`, старые fixture-ы `canvas-tools`

Type: task
Status: claimed — 2026-10-15
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

- [x] Test предела палитры зелёный; с порядком «группировать, потом резать» — красный.
- [x] `expandMachines` и `collapseMachines` без чтения атрибута один раз; e2e `sidebar-sections` зелёный.
- [x] В `canvas-tools.test.ts` нет fixture-ов с `offset:*` и смещением Subagent-а, кроме test-а на их
      снятие; комментарии описывают нынешнее поведение.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (сделано); gate full — exit 0 и строка
      `[gate] зелено (full)` (не проверено: делает оркестратор перед merge); Linux CI зелёный (см. PR).

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

Код приложения не менялся; правки только в трёх файлах test-ов.

**1. Предел строк палитры.** Новый test в `test/unit/palette-groups.test.tsx` («shows 50 rows at most,
cut by rank before grouping…»): 60 команд на запрос `deploy`. В группе Go to — лучшая строка
(`Deploy`, точный префикс) и ещё 54 строки, где `deploy` — слово внутри названия; в группе Action —
5 строк с префиксом `Deploy now N`, второй ранг, построены последними. Ожидание: ровно 50 строк, среди
них `Deploy` и все 5 строк Action, группы Go to (45 строк) и Action, отрезаны последние 10 строк Go to.
Исходные данные ticket-а («55 одной группы и 5 другой с лучшим рангом») мутанта не ловят: группа
стоит там, где её лучшая строка, и если лучший ранг у маленькой группы, она идёт первой при любом
порядке резки. Поэтому лучшая строка вообще — в большой группе (решено без владельца, подтвердить).

Мутант «группировать, потом резать» — в `CommandPalette.tsx` строка `const groups = …` заменена на
`groupRows(rankItems(…без предела…))` с резкой групп по очереди до 50 строк (на копии, восстановлено,
`cmp` совпал): `node scripts/vitest-electron.mjs run test/unit/palette-groups.test.tsx` — exit 1,
`Tests 1 failed | 135 passed (136)`, упал только новый test (`AssertionError: expected [ 'go:best',
'go:1', 'go:2', …(47) ] to deeply equal ArrayContaining{…}`). Без нового test-а все остальные
зелёные и с мутантом — это те же 135 passed. На настоящем коде — exit 0, 136 passed.

**2. `expandMachines` / `collapseMachines`** (`test/e2e/helpers.ts`) — общая функция
`setMachinesExpanded`. Раздел показывает своё значение по умолчанию (свёрнут), пока окно не получило
настройки приложения из main. Функция сначала спрашивает main (`appSettings.get`), что сохранено для
раздела (`sidebar.collapsed[<data-section-id>]`), и ждёт, пока `aria-expanded` заголовка покажет это
значение; если ничего не сохранено, приход настроек значение не меняет. Только после этого она
читает атрибут и решает, кликать ли. Пауз на время нет. Выбран первый вариант ticket-а (дождаться
загрузки), а не «кликать до нужного значения»: повторные клики не закрывают случай, когда атрибут уже
равен нужному, а настройки приходят позже и меняют его (решено без владельца, подтвердить).
e2e под замком: `playwright test test/e2e/sidebar-sections.spec.ts test/e2e/linked-machines.spec.ts`
— exit 0, 12 passed. Других spec-ов, которые зовут эти функции, нет (`grep -rl` по `test/e2e`).
Мутант «клик без ожидания загрузки» — это прежний код; e2e на нём не краснел детерминированно
(main был зелёным), гонку test-ом не воспроизвести.

**3. Fixture-ы `test/contract/canvas-tools.test.ts`.** У Node-а `epic-frame` убран ключ `offset:3`,
остался `collapsed: true`; комментарий описывает Node по ADR-0037 (x/y — смещение рамки, `collapsed`).
У Node-а `subagent-tree` убрано `offset:toolu_1` (`data: {}`); сам Node остался: canvas tools по-прежнему
отказывают Node-у этого вида (`src/main/mcp/canvas-server.ts`), и test проверяет именно это.
Комментарий: такой Node писали старые версии, main снимает его при чтении `layout.json`, здесь он
положен прямо в store как случайно оставшийся. Test-а на снятие старых ключей в этом файле нет —
снятие при чтении `layout.json` проверяет `test/contract/layout-store.test.ts`. `grep -n "offset:"` по файлу — пусто.

Проверка: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (253 файла passed, 6 skipped).
