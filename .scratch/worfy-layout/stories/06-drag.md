# Code story — worfy-layout 06: Drag

Kind: pr · Epic: worfy-layout · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 05 View button переносили только меню «Move to» и ⌥-стрелки. Решения владельца Q3 и Q4 требуют ещё и
drag мышью: между зонами и внутри зоны, с подсвеченными зонами и маркером места вставки, пока drag идёт. Пустая зона
должна показывать место «Drop here», Esc и отпускание вне зоны — ничего не менять.

- Требование: [Что строить](../issues/06-drag.md#что-строить)

## 2. Drag живёт в модуле окна

Code: `src/renderer/shell/ViewZone.tsx:108-128` · key lines: 109, 117, 121, 126, 127

```tsx
/** The type of the drag's data: the id of the View button. */
const DRAG_TYPE = 'application/x-worfy-view-button'

/** The drag of a View button in this window: which one, and the gap of the zone the pointer is over. */
interface ViewDrag {
  id: ViewButtonId
  over: { zone: Zone; gap: number } | null
}

const useViewDrag = create<{ drag: ViewDrag | null }>(() => ({ drag: null }))

function startDrag(id: ViewButtonId, source: HTMLElement): void {
  useViewDrag.setState({ drag: { id, over: null } })
  source.closest('.w-shell')?.setAttribute('data-view-drag', id)
}

/** Ends the drag, dropped or not: the zones go out and the header is the window's drag area again (shell.css). */
function endDrag(): void {
  if (useViewDrag.getState().drag !== null) useViewDrag.setState({ drag: null })
  for (const shell of document.querySelectorAll('[data-view-drag]')) shell.removeAttribute('data-view-drag')
}
```

- Что делает: одна zustand-store на окно хранит, какую кнопку тянут и над каким промежутком какой зоны курсор.
  `dragstart` кнопки кладёт id в store и ставит `data-view-drag` на `.w-shell`; `dragend` и drop снимают и то, и другое.
- Почему здесь: Ticket называет `ViewZone.tsx` в «Где в коде». Spec: «Drop принимается только в окне, где drag начался
  (id лежит в модуле окна)». Три зоны рисуют разные компоненты (Toolbar, Sidebar, Footer), поэтому состояние общее, а не
  у одной зоны. Атрибут ставится на DOM напрямую: `AppShell.tsx`, где рисуется `.w-shell`, не в «Где в коде».
- Без него: пустая зона не узнала бы, что drag идёт, и не показала бы «Drop here»; зона в другом окне принимала бы
  чужой drag.
- Требование: [Решения](../issues/06-drag.md#решения)
- Риски и пробелы test-ов: drop сам вызывает `endDrag`, потому что кнопка, перенесённая в другую зону, монтируется
  заново, и `dragend` старого элемента может не прийти. Несколько окон в unit-test-е не проверены: store модуля на
  окно — свойство JS-модуля renderer-а.

## 3. Промежуток — по середине кнопки, как gapAt

Code: `src/renderer/shell/ViewZone.tsx:137-150` · key lines: 143, 144, 147, 149

```tsx
/**
 * The gap of `zone` the pointer is over: the place of the first of its buttons whose middle is past the pointer, along
 * the row (the column on the rail), as QueueList's `gapAt` halves a row; past them all, the end. Only the zone's own
 * buttons count: the rail's drawn at the end of the header are not the header's.
 */
function gapAt(group: HTMLElement, zone: Zone, event: DragEvent<HTMLElement>): number {
  const buttons = [...group.querySelectorAll<HTMLElement>(`[data-view-button][data-zone="${zone}"]`)]
  const at = zone === 'rail' ? event.clientY : event.clientX
  const gap = buttons.findIndex((button) => {
    const box = button.getBoundingClientRect()
    return at < (zone === 'rail' ? box.top + box.height / 2 : box.left + box.width / 2)
  })
  return gap === -1 ? buttons.length : gap
}
```

- Что делает: промежуток — номер первой кнопки зоны, середина которой дальше курсора; по x в header и footer, по y на
  rail. Курсор за всеми кнопками — конец зоны. Считаются только кнопки с `data-zone` этой зоны.
- Почему здесь: spec, «Drag»: «Промежуток считается по середине кнопки, как `gapAt`». Фильтр по `data-zone` — решение
  владельца A: пока sidebar спрятан, кнопки rail в конце header не зона для drop.
- Без него: маркер и место drop расходились бы, а курсор над кнопками rail в header ставил бы кнопку в rail.
- Требование: [Решения](../issues/06-drag.md#решения)
- Риски и пробелы test-ов: jsdom ничего не раскладывает, unit-test-ы задают коробки кнопок подменой
  `getBoundingClientRect`. Настоящую раскладку проверяет только e2e.

## 4. Зона: dragover, dragleave, drop

Code: `src/renderer/shell/ViewZone.tsx:202-225` · key lines: 204, 205, 212, 213, 220, 221, 223, 224

```tsx
  // A zone takes only a drag that began in this window: the drag of this module.
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (useViewDrag.getState().drag === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    overGap({ zone, gap: gapAt(event.currentTarget, zone, event) })
  }
  // A leave into a button of the zone is no leave: only a point outside the zone's box puts its marker out.
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const inside = event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom
    if (!inside && useViewDrag.getState().drag?.over?.zone === zone) overGap(null)
  }
  // The gap is counted on the layout drawn, as the marker is; the button goes there among the others of the zone.
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const dragged = useViewDrag.getState().drag
    if (dragged === null) return
    event.preventDefault()
    const at = gapAt(event.currentTarget, zone, event)
    endDrag()
    const from = layout[zone].indexOf(dragged.id)
    const next = moveToZone(layout, dragged.id, zone, from !== -1 && from < at ? at - 1 : at)
    if (!sameViewButtons(next, layout)) place(next, dragged.id)
  }
```

- Что делает: зона разрешает drop (`preventDefault` в `dragover`) только при drag-е из store этого окна и запоминает
  промежуток под курсором. `dragleave` гасит маркер, только когда точка вышла из коробки зоны. Drop переводит промежуток в
  место среди остальных кнопок зоны (кнопка, которую тянут вправо внутри своей зоны, освобождает своё место, отсюда
  `at - 1`) и шлёт один `setAppSettings` через `place`; drop на своё же место ничего не шлёт.
- Почему здесь: spec, «Drag»: «Drop — `moveToZone` или `moveWithin` и один `setAppSettings({ viewButtons })`».
  `moveToZone` (Ticket 02) уже принимает место среди остающихся кнопок и в своей зоне, поэтому хватает одной функции.
  Поправка `at - 1` — та же, что в `QueueList.tsx:93-96`.
- Без него: drop не срабатывал бы вовсе (без `preventDefault` браузер его не шлёт), а drag внутри зоны вправо ставил бы
  кнопку на одно место дальше маркера.
- Требование: [Решения](../issues/06-drag.md#решения)
- Риски и пробелы test-ов: Esc посреди native drag Playwright нажать не даёт: отмену проверяет unit-test (`dragEnd` без
  drop) и ручной пункт приёмки Ticket-а 08.

## 5. Подсветка, маркер и «Drop here»

Code: `src/renderer/shell/ViewZone.tsx:296-302` · key lines: 297, 298, 299

```tsx
        {own.map(button(zone))}
        {own.length === 0 && drag !== null ? (
          <span className="w-view-zone__drop-here" data-drop-marker={gap === null ? undefined : 'here'} aria-hidden="true">
            Drop here
          </span>
        ) : null}
        {own.length > 0 && guests.length > 0 ? <span className="w-view-zone__line" aria-hidden="true" /> : null}
```

- Что делает: пустая зона во время drag рисует место размером с кнопку «Drop here»; без drag пустая зона по-прежнему не
  рисует ничего (`ViewZone.tsx:193`). Сама зона во время drag несёт `data-drop-zone="on"`, под курсором `"over"`
  (`ViewZone.tsx:283`), а кнопка у промежутка — `data-drop-marker="before"` или `"after"` (`ViewZone.tsx:261`). Черту
  маркера рисует `::after` в `shell.css`: она не занимает места, и кнопки под курсором не сдвигаются.
- Почему здесь: spec, «Набросок функции», «Во время drag» и абзац про пустую зону.
- Без него: в пустую зону нельзя было бы бросить кнопку — у неё нет ни одного элемента, над которым идёт `dragover`.
- Требование: [Что строить](../issues/06-drag.md#что-строить)
- Риски и пробелы test-ов: вид подсветки и маркера проверен в e2e только атрибутами и шириной `::after`; снимки обеих тем
  в середине drag пишет e2e (`06-view-buttons-drag`), их смотрит ревьюер.

## 6. Header не область перетаскивания окна, пока идёт drag

Code: `src/renderer/shell/shell.css:957-962` · key lines: 959, 960, 961

```css
/* A drag of a View button (ViewZone.tsx, worfy-layout ticket 06). A drag area of the window gets no `dragover`, so while
   a drag goes the header and the sidebar's top strip are none (the header's group is none always, above). */
.w-shell[data-view-drag] .w-toolbar,
.w-shell[data-view-drag] .w-sidebar__titlebar {
  -webkit-app-region: no-drag;
}
```

- Что делает: пока на `.w-shell` стоит `data-view-drag`, весь header и верхняя полоса sidebar перестают быть областью,
  за которую тянут окно.
- Почему здесь: Ticket называет `shell.css` и `-webkit-app-region: drag` в «Где в коде»; spec, «Риски»: Electron не шлёт
  `dragover` в такую область. Группа видов header была `no-drag` и раньше (`.w-toolbar [role='group']`).
- Без него: drop в header мог не сработать, если курсор над промежутком вне кнопок.
- Требование: [Решения](../issues/06-drag.md#решения)
- Риски и пробелы test-ов: e2e шлёт drag через Playwright (CDP), а не через окно ОС; поведение настоящей мыши у края
  header — ручной пункт приёмки.

## 7. Неактивная кнопка — `aria-disabled`, а не `disabled`

Code: `src/renderer/shell/ViewButton.tsx:98-101` · key lines: 101

```tsx
      // Inactive is `aria-disabled`, not native `disabled`: Chromium starts no drag on a disabled button, and an inactive
      // one is dragged too (worfy-layout ticket 06). It stays a Tab stop; a press opens nothing, as openView (views.tsx)
      // opens no view that needs a Project without one.
      aria-disabled={inactive ? true : undefined}
```

- Что делает: Runs и Pull requests без Project помечены `aria-disabled="true"` вместо native `disabled`. Вид прежний
  (прозрачность 0.5 и курсор «нельзя» — `shell.css` и общее правило `tokens.css`), кнопка остаётся в порядке Tab, нажатие
  ничего не открывает: `openView` без Project для такого вида возвращается сразу.
- Почему здесь: spec, «Drag»: «Неактивная кнопка (нужен Project) тоже тянется». Первый CI run этого PR (46003066639)
  показал, что drag Runs в e2e не начинается: `data-view-drag` не появился на Windows. Тот же отказ повторён локально на
  собранном renderer-е в headless Chromium из кэша Playwright (не Electron): с native `disabled` у Runs `dragstart` не
  приходит, у Pipeline приходит; с `aria-disabled` приходит и у Runs.
- Без него: неактивную кнопку нельзя было бы перетащить, а e2e Ticket-а, где Runs без Project, не прошёл бы.
- Требование: [Решения](../issues/06-drag.md#решения)
- Риски и пробелы test-ов: неактивная кнопка теперь получает фокус, и ⌥-стрелки и меню работают и на ней — расстановка от
  Project-а не зависит. Unit-test-ы Ticket-ов 01 и 04 (`toolbar-runs`, `view-registry`, `pr-inbox-view`, `view-zones`)
  проверяли `.disabled` и переписаны на `aria-disabled`.

## 8. Долг review Ticket-а 05: два ⌥→ до ответа main

Code: `src/renderer/shell/ViewZone.tsx:86-106` · key lines: 91, 94, 99, 101

```tsx
/**
 * The layout the last move asked for, while main has not answered every move yet: a second ⌥→ pressed before the
 * answer steps on from it, not from the layout still drawn. `setAppSettings` takes the answer into the settings before
 * it resolves, so once the last one has, the layout drawn is the one to step from.
 */
let asked: { layout: ViewButtons; waiting: number } | null = null

/** The layout a move starts from: the one the last move asked for while main has not answered, else the one drawn. */
const startOf = (layout: ViewLayout): ViewLayout => asked?.layout ?? layout

/** Asks main for the layout `next` (`null` — Reset layout) and has the button `id` keep the focus once it is drawn. */
function place(next: ViewButtons | null, id: ViewButtonId): void {
  focusAfterMove = id
  asked = { layout: next ?? defaultViewButtons(), waiting: (asked?.waiting ?? 0) + 1 }
  void setAppSettings({ viewButtons: next }).then((error) => {
    if (asked !== null && --asked.waiting === 0) asked = null
    if (error === undefined) return
    if (focusAfterMove === id) focusAfterMove = null
    console.error('Moving a View button failed:', error)
  })
}
```

- Что делает: пока main не ответил на все перемещения, ⌥-стрелки и «Move to» считают шаг от расстановки, которую
  попросило последнее перемещение, а не от ещё нарисованной.
- Почему здесь: бриф Ticket-а называет этот долг review Ticket-а 05 (`ViewZone.tsx:149-154` до правки); Code story 05
  записала его в «Риски»: «Два быстрых ⌥→ до ответа main ... сдвигают кнопку на одно место, а не на два».
- Без него: второй ⌥→ до ответа слал ту же расстановку, что первый.
- Требование: не записано
- Риски и пробелы test-ов: это долг review, не пункт «Готово, когда». Перемещение из другого окна, пришедшее, пока ответы ещё ждут, не учитывается в шаге — последняя
  запись всё равно побеждает в main. Drop считает от нарисованной расстановки: промежуток взят с экрана.

## 9. Долг review Ticket-а 05: «Not saved» после сброса из другого окна

Code: `src/renderer/settings/GeneralSection.tsx:175-181` · key lines: 176, 180, 181

```tsx
function ViewButtonsRow() {
  const layout = useAppSettings((settings) => settings.viewButtons)
  const moved = layout !== undefined && !isDefault(layout)
  // The reason main refused, with the layout it refused to reset: once the layout changes (another window reset or moved
  // it), the reason is of a layout no longer there, and it goes.
  const [refused, setRefused] = useState<{ problem: string; layout: typeof layout }>()
  const problem = refused !== undefined && refused.layout === layout ? refused.problem : undefined
```

- Что делает: причина отказа main хранится вместе с расстановкой, которую не удалось сбросить, и показывается, только
  пока расстановка та же. Любая смена (сброс или перенос из другого окна) убирает «Not saved».
- Почему здесь: бриф называет этот долг review Ticket-а 05 (`GeneralSection.tsx:177,195`).
- Без него: «Not saved: …» оставался под строкой, когда расстановка уже стала по умолчанию.
- Требование: не записано
- Риски и пробелы test-ов: это долг review, не пункт «Готово, когда». Сравнение по ссылке на объект: store настроек заменяет объект при каждом принятом изменении.

## 10. Что сознательно не меняли

Перевод ru и тексты Guide — Ticket 07: правлена только
английская `docs/features/app-shell.md`. `AppShell.tsx` не тронут: атрибут `data-view-drag` ставит модуль drag.
ADR не нужен: в «Готово, когда» его нет. `shell.css` перешёл 1000 строк (956 → 1040), gate предупреждает, но не
краснеет.

## 11. Как проверено

Сначала красный test: на старом коде `test/unit/view-zones.test.tsx` — exit 1 (8 новых test-ов упали),
`test/unit/settings-reset-layout.test.tsx` — exit 1 (1 новый упал). С кодом оба зелёные. `pnpm lint`, `pnpm typecheck`,
`pnpm test` — exit 0; gate fast — exit 0, `[gate] green (fast)`. В e2e `view-buttons.spec.ts` новый случай: drag Runs из
footer над левой половиной Session, в середине drag — `data-view-drag`, три зоны с `data-drop-zone`, маркер перед Session
шириной 2 px, снимки обеих тем; после отпускания header — Canvas, Runs, Session. Playwright шлёт drag-события на ход
мыши позже, поэтому test двигает курсор внутри левой половины Session, пока туда не придёт первый `dragover`. E2e
локально не запускали (правило владельца), его проверит CI; первый run (46003066639) упал на Windows: drag
неактивной Runs не начался — исправлено шагом 7.

## Проверить себя

1. Canvas стоит первой в header из двух кнопок. Её тянут и отпускают над правой половиной Session. Какое место
   получит `moveToZone`, и почему не 2?
   - Ответ: промежуток 2 (после Session), но Canvas сама стоит раньше него в этой же зоне, и место среди остающихся
     кнопок на одно меньше — 1. Header станет Session, Canvas.
   - Строки: `src/renderer/shell/ViewZone.tsx:220-224`
2. Почему зона в другом окне не примет drag кнопки из этого окна, хотя тип данных тот же?
   - Ответ: `dragover` разрешает drop только при drag-е в store своего модуля, а store у каждого окна свой; без
     `preventDefault` drop не приходит.
   - Строки: `src/renderer/shell/ViewZone.tsx:203-205`
3. Sidebar спрятан, кнопку тянут и отпускают над Acceptance в конце header. Куда она встанет?
   - Ответ: в конец собственных кнопок header: `gapAt` считает только кнопки с `data-zone="header"`, а кнопки rail в
     header — не зона для drop.
   - Строки: `src/renderer/shell/ViewZone.tsx:142-150`
