# 09 — Перетаскивание и изменение размера Node-а не зависают над iframe Card

Type: task
Status: done — 2026-10-07, [PR #99](https://github.com/IDSAD-XL/worfy/pull/99)
Blocked by: —
Source: ручные проверки 2026-10-07, второй круг, проверка M23 ([PR #93](https://github.com/IDSAD-XL/worfy/pull/93), a3a2c50) — Ticket [06](06-snapping-при-перетаскивании.md), подраздел [«Ручная проверка 2026-10-07»](06-snapping-при-перетаскивании.md#ручная-проверка-2026-10-07); HANDOFF, «Риски и долги»; [spec.md](../spec.md), этап 3

## Что происходит

- Card рисует свою страницу в iframe с origin `worfy-card://`
  (`src/renderer/canvas/nodes/CardNode.tsx:109-120`). Это другой origin: пока курсор над iframe,
  события мыши получает страница Card, а не окно worfy.
- На время перетаскивания iframe не получает `pointer-events: none`. Card тянут за заголовок
  быстро, курсор обгоняет заголовок и попадает на iframe этой же Card. Окно worfy перестаёт получать
  mousemove и mouseup.
- Перетаскивание React Flow тогда не кончается: после отпускания кнопки Node остаётся `dragging`.
  В проверке M23 (Stable copy из 6df9791) это повторилось дважды при событиях через 14.3 px и 25 ms
  (около 570 px/s). В первый раз auto-pan React Flow увёл viewport по x с 226 на 29731, и
  `onMoveEnd` записал его в `layout.json`; Card в памяти оказалась на x=-29064. Помогает только
  перезагрузка renderer-а. Контроль: те же 172 px событиями через 5.7 px и 8 ms — перетаскивание
  проходит.
- Та же ловушка — у перетаскивания любого Node-а через iframe чужой Card и у изменения размера
  Card: при уменьшении угол под курсором сразу уходит внутрь её iframe. Так ведёт себя любой iframe
  другого origin; на Stable copy эти два случая не проверялись.

## Что делаем

- Пока идёт перетаскивание или изменение размера любого Node-а, iframe-ы на Canvas не принимают
  события мыши (`pointer-events: none`). Жест кончился — iframe снова принимают мышь, и Card
  кликабельна, как раньше.
- Признак перетаскивания — класс `dragging`, который React Flow сам ставит перетаскиваемому
  Node-у. Правило в `src/renderer/canvas/canvas.css` гасит iframe-ы, пока такой Node есть на Canvas.
  Признак изменения размера ставит `NodeResizeClamp` (`src/renderer/canvas/NodeResizeClamp.tsx`; его
  надевает каждый тип Node-а, у которого меняется размер) на время от начала до конца жеста. Конкретный способ выбирает
  исполнитель; требования — в «Готово, когда».
- Сдвиг самого Canvas мышью (pan) над Card исполнитель проверяет тем же e2e. Если pan тоже
  зависает — то же правило и строка в «Итог».
- `Canvas.tsx` этот Ticket не меняет: его меняет Ticket 08. Если без `Canvas.tsx` не обойтись,
  исполнитель добавляет файл в «Где в коде» и заново проверяет пересечения с Ticket-ами Wave.

ADR не нужен.

## Готово, когда

- [x] e2e `test/e2e/card-drag.spec.ts` на собранном приложении: Card тянут за заголовок мышью быстрым рывком (события через 14 px и 25 ms, курсор уходит на iframe этой Card). После отпускания Node не `dragging` и стоит там, куда его бросили (с поправкой snapping и main); viewport не сдвинулся, в `layout.json` нового viewport нет.
- [x] e2e: Note тянут через iframe Card тем же рывком — перетаскивание кончается на отпускании.
- [x] e2e: Card уменьшают за угол так, что курсор уходит на её iframe, — изменение размера кончается на отпускании, новый размер записан в `layout.json`.
- [x] e2e: после каждого жеста щелчок по странице Card доходит до неё.
- [x] Unit: `NodeResizeClamp` ставит признак изменения размера в начале жеста и снимает его в конце.
- [ ] (вручную) Stable copy после влития: быстрый рывок Card за заголовок мышью не зависает, Card после этого кликабельна. Как проверить: окно приложения.
  не проверено: проверка идёт на Stable copy после влития, а влияет оркестратор; до влития Stable copy этого кода не содержит.

## Тесты

Сначала падающий test — `test/e2e/card-drag.spec.ts`, первый пункт «Готово, когда». На нынешнем
main Node остаётся `dragging` после отпускания, как в проверке M23. В «Итог» — как он падал. jsdom
не применяет CSS и не знает iframe другого origin, поэтому дефект доказывает только e2e.

- `test/e2e/card-drag.spec.ts` — новый.
- `test/unit/node-resize-clamp.test.tsx` — новый: признак изменения размера.

## Где в коде

- `src/renderer/canvas/canvas.css`
- `src/renderer/canvas/NodeResizeClamp.tsx`
- `src/renderer/canvas/nodes/CardNode.tsx`
- `test/unit/node-resize-clamp.test.tsx` — новый
- `test/e2e/card-drag.spec.ts` — новый

Общих файлов с Ticket-ами 08, 10–12 нет. Кольцо выделения в `canvas.css:22` чинит Ticket 10, но
правкой токена в `src/renderer/theme/tokens.css`, а не `canvas.css`.

## Итог

Сделано в ветке `worfy-week/09`, база `origin/main` b4a397f. Правки только в файлах следа:
`src/renderer/canvas/canvas.css`, `src/renderer/canvas/NodeResizeClamp.tsx`,
`src/renderer/canvas/nodes/CardNode.tsx`, `test/unit/node-resize-clamp.test.tsx` (новый),
`test/e2e/card-drag.spec.ts` (новый). `Canvas.tsx` не тронут.

**Признак из «Что делаем» не сработал один — решение исполнителя.** Класс `dragging` React Flow
ставит Node-у только на первом mousemove, который увидело окно. Рывок через 14.3 px ставит курсор на
iframe уже первым шагом: окно не видит ни одного mousemove, перетаскивание не начинается, и правило
на `dragging` не успевает включиться. Пошаговая проба на e2e это показала: Note, взятую за правый
край заголовка у самой Card (zoom 0.5), окно не видело 11 шагов из 26, пока курсор шёл над iframe;
Note начала двигаться, только когда курсор вышел на пустую плоскость, и встала на 300 единиц левее
места отпускания. Поэтому iframe-ы гасятся с момента нажатия:
- `CardNode.tsx:90` — `useFramesStepAsideWhilePressed`: pointerdown основной кнопки (`:104`) где
  угодно в корне React Flow ставит на корень `data-pointer-pressed`; pointerup, pointercancel или
  потеря окном фокуса снимает его на следующем шаге event loop (`:98`), чтобы mouseup, которым React
  Flow кончает жест, тоже не попал на iframe. Нажатие внутри страницы Card до документа окна не
  доходит, поэтому щелчки по Card не меняются. Правая кнопка признака не ставит: после неё
  открывается меню, и отпускание может не вернуться в окно.
- `NodeResizeClamp.tsx:19` — `data-node-resizing` на корне от `onResizeStart` до `onResizeEnd`
  (снимается и при размонтировании Node-а посреди жеста), как требует тикет.
- `canvas.css:26-31` — `pointer-events: none` всем iframe-ам Canvas, пока на корне есть любой из
  двух признаков, или есть Node с `dragging`, или плоскость с `dragging` (pan).

**Pan тоже зависал** — решено без владельца, подтвердить. Сдвиг Canvas средней кнопкой над Card на
нынешнем main оставлял `.react-flow__pane` в `dragging`. React Flow ставит этот класс уже на
нажатии, поэтому хватило правила на `.react-flow__pane.dragging`.

**Как падал e2e на базе c539cfd** (`test/e2e/card-drag.spec.ts`, все пять test-ов красные):
- Card за середину заголовка — после отпускания Node остался `dragging`
  (`class="… selected selectable draggable dragging"`), как в проверке M23.
- Card за нижний край заголовка и Note через iframe Card — перетаскивание не шло, пока курсор над
  iframe: Note встала на x=1456 вместо ~1756, main сдвинул её под Card (y=436).
- изменение размера Card за угол — `layout.json` так и остался с w=300 (жест не кончился).
- pan средней кнопкой — `.react-flow__pane` остался `dragging selection`.

**Test-ы.** `test/e2e/card-drag.spec.ts` — рывок через 14.3 px и 25 ms; после каждого жеста Node не
`dragging`, место в `layout.json` — куда бросили (React Flow начинает перетаскивание на первом шаге и
меряет от него, поэтому Node проходит все шаги, кроме первого; допуск — шаг сетки 8), viewport не
сдвинут, щелчок по странице Card доходит до неё (счётчик щелчков в странице). Мутанты: без правила
`data-pointer-pressed` краснеют Card за нижний край и Note; без правила pan — pan. Изменение размера
e2e держат и `data-pointer-pressed`, и `data-node-resizing`; сам признак изменения размера проверяет
`test/unit/node-resize-clamp.test.tsx` (на мутантах без установки, без снятия и без снятия при
размонтировании краснеет).

Снимки: [Card после рывка, щелчок дошёл](../evidence/09-card-drag-dropped-and-clickable.png),
[Note протянута через Card, Card уменьшена, щелчков 2](../evidence/09-note-across-card-and-card-resized.png).

**Влито.** [PR #99](https://github.com/IDSAD-XL/worfy/pull/99), merge 3f52e52. Ревью — VERIFIED с первого
круга, без доработки; отступление от тикета (признак нажатия, а не только класс `dragging` React Flow)
ревью признало обоснованным: без правила признака нажатия краснеют 2 из 5 test-ов `card-drag`.
Перед мержем ветка перебазирована на 309d3ad (влитый Ticket 11), head 3c58f48; `gate full` прошёл со второго прогона,
какой test упал в первом — неизвестно (лог перезаписан повтором).

**Долг** (все low, из вердикта ревью).

- `src/renderer/canvas/nodes/CardNode.tsx:118` — признак нажатия общий для всех Card, а снимает его
  cleanup любой одной Card. С `onlyRenderVisibleElements` Card, размонтированная между нажатием и
  первым mousemove, снимет признак, и быстрый рывок над iframe снова может зависнуть (начатые
  перетаскивание, изменение размера и pan держат свои признаки). Правка — один владелец признака
  (счётчик на корне или один hook в `Canvas.tsx`).
- Снимок `09-card-drag-dropped-and-clickable.png` не показывает места начала и броска.

### Долги из HANDOFF (2026-10-08)

- Урок процесса Wave 5 (закрыт): скрипт мержа Orchestrator-а снимал общий замок e2e `/tmp/worfy-e2e.lock`
  дважды — явно после `gate full` и ещё раз в `trap` при выходе. Второе снятие могло удалить чужой замок:
  исполнитель Ticket-а 11 видел, как замок исчез посреди его прогона. Исправлено: замок снимает только
  тот, кто его держит. Мерж этого Ticket-а прошёл `gate full` со второго прогона; какой test упал в
  первом — неизвестно, лог перезаписан повтором.
