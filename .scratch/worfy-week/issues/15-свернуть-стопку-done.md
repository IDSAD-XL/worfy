# 15 — Открытую стопку done видно, как свернуть: кнопка Collapse на месте Expand, Esc

Type: task
Status: done — 2026-10-07, [PR #127](https://github.com/IDSAD-XL/worfy/pull/127)
Blocked by: —
Source: замечание владельца 2026-10-07 («я развернул done ноды, но при этом непонятно как свернуть их обратно»); Ticket [08](08-undo-перетаскивания-и-сворачивания-рамки-epic-а.md) (стопка — не шаг ⌘Z); [spec.md](../spec.md), этап 3

## Что происходит

Стопка done — свёрнутая колонка Done рамки Epic-а: в ней все done Ticket-ы Epic-а.

- **Разворачивают** кликом по большой карточке 204×120 («N done» и номера,
  `src/renderer/canvas/nodes/EpicFrameNode.tsx:99-118`, aria-label «Expand done tickets of <epic>»
  на `:104`). Клик переключает флаг в store `useEpicsUi` (`src/renderer/canvas/sources/epics.ts:81-95`);
  флаг живёт только в памяти renderer-а. При открытой стопке карточки нет совсем, на её месте —
  первый done Ticket. Клик по нему выделяет Ticket и стопку не сворачивает.
- **Свернуть** можно ровно одним способом: текстовой кнопкой «Fold» в строке заголовка колонки Done
  (`EpicFrameNode.tsx:92-96`). Её стиль `.w-epic__link` (`src/renderer/canvas/epic-frame.css:148-157`):
  без рамки, без иконки, без hover, 11 px. При zoom 0.5 она занимает 15.5×7 screen px. Слово «Fold»
  больше нигде в UI не встречается; везде пары Expand/Collapse.
- Единственный шеврон в рамке (`EpicFrameNode.tsx:69-77`) сворачивает всю рамку Epic-а — не то, что
  ищет человек.
- Esc, клик вне стопки и ⌘Z стопку не сворачивают. Canvas-клавиши (`useCanvasKeys`,
  `src/renderer/canvas/overlays/SelectionToolbar.tsx:41-69`) знают только Delete/Backspace, ⌘Z и
  ⇧⌘Z. ⌘Z не сворачивает намеренно: стопка — состояние вида, как viewport (Ticket 08).
- Открытое состояние стопки не описано ни в F-SPEC, ни в макете: `docs/design/F-canvas-light.dc.html`
  рисует только свёрнутую, с шевроном 22×22 «Expand done tickets» в углу (`:219`).

## Что делаем

1. **Один переключатель в заголовке колонки Done**, в обоих состояниях, справа (`margin-left: auto`):
   клик в том же месте открывает и сворачивает.
   - Свёрнуто: шеврон вниз и «Expand», aria-label «Expand done tickets of <epic>»,
     `aria-expanded="false"`. Открыто: шеврон вверх и «Collapse», «Collapse done tickets of <epic>»,
     `aria-expanded="true"`. `data-testid="done-stack-toggle"`. Иконка — тот же SVG, что у
     `chevron()` в `EpicFrameNode.tsx`.
   - Вид — общая кнопка действия `.w-action` (`src/renderer/canvas/actions/actions.css:2-18`,
     F-SPEC «Button»): 20 px, 1 px border, фон `--surface-raised`. Outline `:focus-visible` 2 px
     `--accent` — на собственном классе переключателя, не на `.w-action`: иначе изменится вид кнопок
     Autopilot и Run wave.
   - Карточка свёрнутой стопки остаётся кнопкой, большой цели для открытия не теряем. Но имя у неё
     другое — «<N> done tickets of <epic>», `aria-expanded="false"`: иначе две кнопки с одним именем,
     и `getByRole` в test-ах падает (strict mode).
   - После открытия фокус встаёт на Collapse: карточка, на которой он был, уходит из DOM.
   - «Fold» и правило `.w-epic__link` удаляются.
2. **Открытая стопка видна как группа**: под колонкой Done — подложка `aria-hidden`, пунктир 1 px
   `--border`, радиус `--radius-node`, от заголовка колонки до низа последнего done Ticket-а, по
   образцу ready wave region макета (`F-canvas-light.dc.html:181`). Только токены, в тёмной теме без
   теней.
3. **Esc сворачивает последнюю открытую стопку Project-а**, по одной на нажатие.
   - В store `useEpicsUi` — порядок открытия. Экспорт: `setDoneStack(projectId, epic, open)` и
     `foldLastDoneStack(projectId): boolean`.
   - Ветка Escape в `useCanvasKeys` без модификаторов, с той же охраной, что у ⌘Z, и ещё тремя
     условиями: выделение на Canvas пусто; в документе нет открытого `[role="dialog"]` или
     `[role="menu"]`; что-то свернулось — тогда `preventDefault`.
   - Первое условие: React Flow по Esc снимает выделение с Node-а в фокусе без `preventDefault`
     (`@xyflow/react`, `dist/esm/index.js:2303-2310`). Первый Esc снимает выделение, второй
     сворачивает. Поэтому Escape слушается на window в capture phase — раньше React Flow, пока
     выделение ещё не снято.
   - Второе условие: панель ADR, Focus mode, Trash и меню Canvas и Binding обрабатывают Esc позже
     этого listener-а (например `src/renderer/shell/sidebar/AdrSection.tsx:99-106`,
     `src/renderer/focus/FocusMode.tsx:233-237`) и при фокусе на body получили бы то же нажатие.
   - Overlay-и, которые закрываются по Esc без `preventDefault`, начинают его вызывать в той же
     ветке: меню Binding (`src/renderer/canvas/overlays/BindingDrop.tsx:192-195`), Trash
     (`TrashPopover.tsx:65-67`), меню Canvas (`CanvasMenu.tsx:98`). Тогда слушатели с проверкой
     `!defaultPrevented` — Esc активного Node-а из Ticket-а 16, Focus mode — это нажатие пропускают:
     одно нажатие — одно действие.
   - Сворачивание рамки Epic-а шевроном сбрасывает её стопку: иначе Esc «свернул» бы невидимую
     стопку и съел нажатие.
   - Ticket 16 (Wave раньше) вводит активный Node: Esc снимает активность. Активный Node всегда
     выделен, поэтому условие «выделение пусто» делает Esc этого Ticket-а следующим по очереди.
4. **⌘Z — без изменений**: открытие и сворачивание стопки остаются вне истории, как решил Ticket 08.
   Случайное сворачивание откатывается кнопкой Expand в том же месте. **Подтверждено владельцем
   2026-10-07** — вместе с правилом «Esc сворачивает по одной стопке, последнюю открытую».
5. **F-SPEC**: раздел «Done stack (Epic frame)» в стиле раздела Autopilot — место переключателя,
   надписи и aria-label, вид `.w-action`, подложка, Esc, «не шаг ⌘Z», состояние не сохраняется.

## Готово, когда

- [x] Unit `test/unit/epic-canvas.test.tsx`: открытая стопка даёт кнопку «Collapse done tickets of b» с `aria-expanded="true"`; клик по ней возвращает карточку `done-stack` с именем «<N> done tickets of b» и `aria-expanded="false"`, а переключатель становится «Expand done tickets of b». Кнопки «Fold» нет.
- [x] Unit там же, переделанный test «opening and folding the done stack is no step» (`:499`): открытие, Collapse и `foldLastDoneStack` не меняют `historyOf(id).size`; ⌘Z по-прежнему отменяет перемещение Note-а.
- [x] Unit `test/unit/epics-ui.test.ts`: `foldLastDoneStack` сворачивает стопки двух Epic-ов в обратном порядке открытия; повторное открытие переносит стопку в конец; сворачивание кнопкой убирает её из порядка; без открытых — `false`; сворачивание рамки сбрасывает её стопку. Чистая функция-охрана Esc: `false` при текстовом поле, `defaultPrevented`, модификаторе, непустом выделении, открытом `[role="dialog"]` или `[role="menu"]`.
- [x] e2e `test/e2e/done-stack.spec.ts`, новый test (локально, в gate full), фикстура этого файла, zoom 0.5: после клика по карточке фокус на Collapse (`document.activeElement`); Collapse виден, высота ≥ 9.5 screen px, `borderTopWidth` 1px, внутри `svg`; клик по нему — стопка свёрнута (`done-stack` 1, `ticket-node` 01 — 0). Снова открыть, Escape — свёрнута. Снова открыть, клик по Ticket 01, Escape — снято только выделение, стопка открыта; второй Escape — свёрнута. Снова открыть, открыть меню Canvas правым кликом по пустому месту, Escape — меню закрыто, стопка открыта; второй Escape — свёрнута. Снова открыть, ⌘Z — стопка открыта.
- [x] e2e `test/e2e/epic-frame.spec.ts` зелёный: `:531` открывает стопку кнопкой с новым именем.
- [x] Снимки заголовка колонки Done, стопка открыта и свёрнута, в светлой и тёмной теме (helper `test/e2e/snapshots.ts`); ссылка из «Итог» — `../evidence/15-стопка-done.png`.
- [x] `grep -rnw Fold src/renderer` и `grep -rn w-epic__link src/renderer` ничего не находят (сейчас первый находит `EpicFrameNode.tsx:94`).
- [x] `grep -n "Done stack (Epic frame)" docs/design/F-SPEC.md` находит раздел.
- [x] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0.
- [ ] (вручную) Снимки сверены с разделом F-SPEC «Done stack (Epic frame)»: вид `.w-action`, токены обеих тем. Как проверить: снимки из `test-results`.

## Тесты

Сначала падающие test-ы — `test/unit/epic-canvas.test.tsx` (кнопки «Collapse done tickets of b» нет)
и e2e Escape в `test/e2e/done-stack.spec.ts` (стопка остаётся открытой). В «Итог» — как падали.

- `test/unit/epic-canvas.test.tsx` — переключатель, имя карточки, переделанный test `:499`; `:508`
  и `:519` ищут кнопки по прежним именам.
- `test/unit/epics-ui.test.ts` — новый: функции store и охрана Esc. Само нажатие Esc в jsdom не
  проверить: там `offsetParent` всегда `null`, и `useCanvasKeys` выходит сразу
  (`SelectionToolbar.tsx:51`). Нажатие — в e2e.
- `test/e2e/done-stack.spec.ts` — новый test; прежний не меняется.
- `test/e2e/epic-frame.spec.ts` — `:531`.

## Где в коде

- `src/renderer/canvas/nodes/EpicFrameNode.tsx`
- `src/renderer/canvas/epic-frame.css`
- `src/renderer/canvas/sources/epics.ts`
- `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `src/renderer/canvas/overlays/BindingDrop.tsx`
- `src/renderer/canvas/overlays/TrashPopover.tsx`
- `src/renderer/canvas/overlays/CanvasMenu.tsx`
- `docs/design/F-SPEC.md`
- `test/unit/epic-canvas.test.tsx`
- `test/unit/epics-ui.test.ts` — новый
- `test/e2e/done-stack.spec.ts`
- `test/e2e/epic-frame.spec.ts`

Общие файлы: `EpicFrameNode.tsx` — с Ticket-ом 14, `F-SPEC.md` — с Ticket-ом 17. Поэтому этот Ticket
идёт Wave-ой позже них. С Ticket-ом 16 общих файлов нет, но оба вводят Esc на Canvas; этот идёт
после 16 и учитывает его активный Node (пункт 3).

## Итог

**Влито.** [PR #127](https://github.com/IDSAD-XL/worfy/pull/127), merge ff252d3. Ревью — VERIFIED с
первого круга, без доработки: ни одно нажатие Esc не делает двух действий; Esc в текстовом поле и в
Terminal (textarea xterm) стопку не сворачивает; открытый `[role="dialog"]` или `[role="menu"]` его
блокирует; прежних имён («Fold», `.w-epic__link`, `toggleDoneStack`) в `src/` и `test/` нет; правило
Ticket-а 08 «стопка — не шаг ⌘Z» цело; снимки совпадают с новым разделом F-SPEC в обеих темах. Перед
мержем ветка перебазирована на `origin/main` 4f983ef, head e83be55: `GATE_SCOPE=all gate.sh full` —
exit 0, CI — зелёный.

Ветка `worfy-week/15`. Свернуть открытую стопку теперь можно кнопкой Collapse на месте Expand и
клавишей Esc; ⌘Z стопку по-прежнему не трогает.

- **Переключатель** — `EpicFrameNode.tsx`: одна кнопка `done-stack-toggle` в строке «Done N», справа, в
  обоих состояниях (Expand ⇄ Collapse, шеврон вниз/вверх, `aria-expanded`). Вид — `.w-action` плюс свой
  класс `.w-epic__stack-toggle` (отступы, outline `:focus-visible` 2 px `--accent`). Карточка свёрнутой
  стопки осталась кнопкой с именем «<N> done tickets of <epic>»; после её клика фокус встаёт на
  Collapse. «Fold» и `.w-epic__link` удалены. Подложка открытой стопки — `.w-epic__stack-region`,
  пунктир 1 px `--border`, `aria-hidden`.
- **Store** — `sources/epics.ts`: вместо словаря `doneExpanded` — список открытых стопок в порядке
  открытия; `setDoneStack`, `foldLastDoneStack`, `openDoneStacks`. `foldHiddenDoneStacks` после каждой
  сборки Node-ов сворачивает стопки свёрнутых рамок и рамок без done Ticket-ов (рамку сворачивают и
  ⌘Z, и правило по умолчанию «все Ticket-ы done», не только шеврон). `toggleDoneStack` удалён.
- **Esc** — `SelectionToolbar.tsx`, `useCanvasKeys`: listener на window в capture phase; решает чистая
  функция `escapeFoldsDoneStack` (`sources/epics.ts`) плюс прежние проверки «Canvas на экране, нажатие
  на нём». Сворачивает — `preventDefault`. Меню Binding, Trash и меню Canvas при закрытии по Esc теперь
  вызывают `preventDefault`.
- **Как падали test-ы первыми** (на коде origin/main 4f983ef, отдельный worktree): unit — 16 красных,
  `TypeError: openDoneStacks / setDoneStack / foldLastDoneStack is not a function`; e2e новый test —
  `getByTestId('done-stack-toggle')`: `element(s) not found`. Мутант «Esc в bubble phase вместо capture»
  ловится e2e: первый Esc при выделенном Ticket 01 свернул стопку (`rf__node-ticket:telegram/1` —
  `element(s) not found`).
- Снимки (вырезка колонки Done, zoom 0.5): [открыта, светлая](../evidence/15-стопка-done-open-light.png),
  [открыта, тёмная](../evidence/15-стопка-done-open-dark.png),
  [свёрнута, светлая](../evidence/15-стопка-done-folded-light.png),
  [свёрнута, тёмная](../evidence/15-стопка-done-folded-dark.png).
- **Решено без владельца, подтвердить:**
  - unit-файл назван `test/unit/epics-ui.test.tsx`, а не `.ts`: `.ts` попадает в проект vitest `node`
    и в `tsconfig.test.node.json` без DOM и JSX, а test импортирует модуль renderer-а;
  - функция-охрана Esc живёт в `sources/epics.ts`, а не в `SelectionToolbar.tsx`: lint-правило
    `react-refresh/only-export-components` не даёт экспортировать функцию из файла компонента;
  - снимков четыре, а не один `15-стопка-done.png`: склеить PNG на машине нечем;
  - стопка Epic-а, у которого не осталось done Ticket-ов, тоже сворачивается сама.
- Пункт «(вручную) Снимки сверены с разделом F-SPEC» — владельцем не проверено; ревьюер сверил снимки с
  разделом. Ручная проверка на Stable copy после влития (Collapse на месте Expand, Esc сворачивает
  последнюю открытую стопку, ⌘Z — нет) — не проверено: нужна сборка после мержа.

**Долг** (все low, из вердикта ревью).

- `src/renderer/canvas/sources/epics.ts:525` — `useEffect`, который вызывает `foldHiddenDoneStacks`
  после сборки Node-ов, не покрыт test-ом: мутант, удаляющий его, проходит. Без него после ⌘Z,
  свернувшего рамку, следующий Esc свернул бы невидимую стопку и съел нажатие.
- `src/renderer/canvas/overlays/TrashPopover.tsx:72` — Esc в Trash popover слушается в bubble phase и
  зарегистрирован после listener-а активного Node-а (`Canvas.tsx:463`): одно нажатие Esc закрывает Trash
  и снимает активность с Node-а. Было до этого тикета; лечится переносом в capture phase.
- `src/renderer/canvas/sources/epics.ts:114` — стопка Epic-а, который исчез из модели, остаётся в store
  `useEpicsUi` (список открытых стопок).
