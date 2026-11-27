# Code story — worfy-layout 05: Меню «Move to», Reset layout и клавиши

Kind: pr · Epic: worfy-layout · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 04 View button-ы стояли в трёх зонах по расстановке `viewButtons` из app settings, но переставить их
было нечем: у кнопки не было меню, клавиш и строки в Settings. Расстановку можно было поменять только руками в
`app-settings.json`. Решения владельца Q3 и Q6 требуют «Move to → Header / Sidebar / Footer» по правому клику, клавиатуру
и «Reset layout» в меню и в Settings.

- Требование: [Что строить](../issues/05-меню-move-to-reset-layout-и-клавиши.md#что-строить)

## 2. Одно изменение расстановки — один patch, и фокус идёт за кнопкой

Code: `src/renderer/shell/ViewZone.tsx:72-82` · key lines: 72, 76, 77, 79

```tsx
let focusAfterMove: ViewButtonId | null = null

/** Asks main for the layout `next` (`null` — Reset layout) and has the button `id` keep the focus once it is drawn. */
function place(next: ViewButtons | null, id: ViewButtonId): void {
  focusAfterMove = id
  void setAppSettings({ viewButtons: next }).then((error) => {
    if (error === undefined) return
    if (focusAfterMove === id) focusAfterMove = null
    console.error('Moving a View button failed:', error)
  })
}
```

- Что делает: каждое перемещение и Reset layout — один `setAppSettings` с целой расстановкой или с `null`. Перед этим
  запоминается id кнопки, которой нужно отдать фокус, когда новая расстановка будет нарисована. Если main отказал, id
  забывается, а причина уходит в console.
- Почему здесь: Ticket называет `ViewZone.tsx` в «Где в коде». Одна переменная на окно, а не состояние зоны: после «Move
  to» кнопку рисует другой `ViewZone`, не тот, что открыл меню. Каждый id стоит ровно в одной зоне (Ticket 02), так что
  кнопка в окне одна.
- Без него: после «Move to» фокус остался бы на исчезнувшей кнопке старой зоны и ушёл бы в `body`.
- Требование: [Решения](../issues/05-меню-move-to-reset-layout-и-клавиши.md#решения)
- Риски и пробелы test-ов: отказ main проверен только для строки Settings; для меню и клавиш отказ виден лишь в
  console — spec не говорит, что показывать. Два быстрых ⌥→ до ответа main читают одну и ту же старую расстановку и
  сдвигают кнопку на одно место, а не на два.

## 3. Фокус после перерисовки — по образцу QueueList

Code: `src/renderer/shell/ViewZone.tsx:111-119` · key lines: 113, 115, 117, 118

```tsx
  // The button a move asked for gets the focus once the layout that moved it is drawn, as QueueList's grip does.
  useLayoutEffect(() => {
    const id = focusAfterMove
    if (id === null) return
    const moved = document.querySelector<HTMLElement>(`[data-view-button="${id}"]`)
    if (moved === null) return
    focusAfterMove = null
    if (document.activeElement !== moved) moved.focus()
  }, [layout])
```

- Что делает: в каждой зоне после смены расстановки ищет кнопку, которую просили сфокусировать, и отдаёт ей фокус.
  Первая зона, нашедшая кнопку, сбрасывает запрос.
- Почему здесь: Ticket в «Решениях»: «Фокус остаётся на ней после перерисовки — образец `QueueList`»
  (`QueueList.tsx:65-80`, тот же `useLayoutEffect` по данным списка).
- Без него: ⌥← в header переставлял бы кнопку, но фокус оставался бы на месте или терялся при перемонтировании.
- Требование: [Решения](../issues/05-меню-move-to-reset-layout-и-клавиши.md#решения)
- Риски и пробелы test-ов: hook стоит до `return null` пустой зоны, иначе нарушился бы порядок hook-ов. Unit-test-ы `view-zones`
  проверяют `document.activeElement` после «Move to», Reset layout и ⌥-стрелок.

## 4. Клавиши: Shift+F10 и ⌥-стрелки раньше стрелок ToggleGroup

Code: `src/renderer/shell/ViewZone.tsx:136-155` · key lines: 139, 145, 148, 150, 153

```tsx
  // The item's handler runs before the group's own arrows: ⌥← must not move the focus along the group.
  const onKeyDown = (entry: ViewButtonEntry, entryZone: Zone) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey) return
    if (event.key === 'F10' && event.shiftKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      openMenu(entry, entryZone, event.currentTarget, under(event.currentTarget))
      return
    }
    const step = event.altKey && !event.shiftKey ? STEPS[zone][event.key] : undefined
    if (step === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const buttons = layout[entryZone]
    const from = buttons.findIndex((each) => each === entry.id)
    const id = buttons[from]
    const to = from + step
    if (id === undefined || to < 0 || to >= buttons.length) return
    place(moveWithin(layout, entryZone, from, to), id)
  }
```

- Что делает: Shift+F10 открывает меню под кнопкой. ⌥←/⌥→ в header и footer и ⌥↑/⌥↓ на rail (по виду, в котором кнопка
  нарисована) двигают её на одно место внутри её зоны расстановки. На краю зоны клавиша съедается и ничего не делает.
  Кнопки rail, нарисованные в header при спрятанном sidebar, двигаются ⌥←/⌥→ внутри rail и не переходят черту.
- Почему здесь: Ticket в «Решениях»: «На краю зоны ничего не происходит: в другую зону кнопку переносит только меню. В
  header обработчик стоит раньше стрелок ToggleGroup, чтобы ⌥← не двигал фокус». Обработчик кнопки срабатывает раньше
  обработчика группы, и `stopPropagation` не пускает событие к стрелкам Base UI. Shift+F10 — решение без владельца из
  spec: у Mac нет клавиши меню.
- Без него: ⌥← в header сдвигал бы фокус на соседнюю кнопку вместо перестановки.
- Требование: [Решения](../issues/05-меню-move-to-reset-layout-и-клавиши.md#решения)
- Риски и пробелы test-ов: на Windows Chromium может сам послать `contextmenu` после Shift+F10; меню тогда откроется
  второй раз в той же точке, это не проверено на ПК. Ctrl и Cmd с клавишами пропускаются дальше без перестановки.

## 5. Меню: «Move to» как группа радио-пунктов, черта, Reset layout

Code: `src/renderer/shell/ViewZone.tsx:191-221` · key lines: 194, 200, 207, 209, 217

```tsx
      {menu === null ? null : (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu((open) => (open === null ? null : { ...open, at: null }))}
          label={`${menu.label} View button`}
          opener={menu.opener}
          className="w-view-menu"
          testId="view-button-menu"
        >
          <MenuRadioGroup value={menu.zone} heading="Move to" headingClassName="w-view-menu__heading">
            {VIEW_ZONES.map((target) => (
              <MenuRadioItem
                key={target}
                value={target}
                className="w-row"
                closeOnClick
                disabled={target === menu.zone}
                data-zone={target}
                onClick={() => place(moveToZone(layout, menu.id, target), menu.id)}
              >
                <span className="w-view-menu__check">{target === menu.zone ? check : null}</span>
                {ZONE_NAMES[target]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <ContextMenuSeparator />
          <MenuItem className="w-row" disabled={isDefault(layout)} onClick={() => place(null, menu.id)}>
            Reset layout
          </MenuItem>
        </ContextMenu>
      )}
```

- Что делает: kit ContextMenu с заголовком «Move to» над тремя пунктами Header, Sidebar, Footer. Зона, где стоит кнопка,
  отмечена и неактивна. После черты — Reset layout, неактивный при расстановке по умолчанию. Закрытие оставляет
  последнее меню нарисованным, пока Base UI его убирает, а фокус kit возвращает на кнопку.
- Почему здесь: Ticket в «Решениях» перечисляет пункты меню и называет kit ContextMenu. В kit нет подменю
  (`Menu.tsx` экспортирует только пункты, радио-группу и черту), а Base UI вне `theme/kit` запрещён правилом ESLint.
  Поэтому «Move to ▸» нарисован заголовком группы, а не подменю.
- Без него: перенести кнопку в другую зону было бы нечем, кроме будущего drag (Ticket 06).
- Требование: [Меню View button](../spec.md#решения-по-реализации)
- Риски и пробелы test-ов: вид меню отличается от макета spec (подменю справа). Это нужно подтвердить у владельца. У
  неактивной кнопки (нужен Project) нативный `disabled`: она не берёт фокус, и Shift+F10 на ней невозможен. Откроет ли
  её меню правый клик в Electron, не проверено.

## 6. Settings → General: строка «View buttons»

Code: `src/renderer/settings/GeneralSection.tsx:175-203` · key lines: 176, 193, 195

```tsx
function ViewButtonsRow() {
  const moved = useAppSettings((settings) => settings.viewButtons !== undefined && !isDefault(settings.viewButtons))
  const [problem, setProblem] = useState<string>()
  return (
    <SettingRow
      label="View buttons"
      description={
        problem === undefined ? (
          'Puts Canvas and Session back in the header, Pull requests and Acceptance on the sidebar, Pipeline and Runs in the footer.'
        ) : (
          <span role="alert" data-testid="settings-view-buttons-problem">
            Not saved: {problem}
          </span>
        )
      }
      testId="settings-view-buttons-row"
    >
      <Button
        disabled={!moved}
        onClick={() => {
          void setAppSettings({ viewButtons: null }).then(setProblem)
        }}
        data-testid="settings-reset-layout"
      >
        Reset layout
      </Button>
    </SettingRow>
  )
}
```

- Что делает: кнопка Reset layout неактивна, пока поля нет или расстановка равна расстановке по умолчанию; нажатие
  шлёт `viewButtons: null`. Отказ main показывается под строкой как «Not saved: …», как у других строк General.
- Почему здесь: Ticket называет `GeneralSection.tsx` и строку «View buttons» в «Где в коде».
- Без него: Reset layout был бы только в меню кнопки. Q6 называет и Settings.
- Требование: [Решения](../issues/05-меню-move-to-reset-layout-и-клавиши.md#решения)
- Риски и пробелы test-ов: unit-test `settings-reset-layout` проверяет неактивность при расстановке по умолчанию, patch
  `null` и отказ main через настоящий IPC-клиент renderer-а и подменённый preload.

## 7. Что сознательно не меняли

Drag — Ticket 06. Перевод ru и тексты Guide — Ticket 07: здесь правлена только английская `docs/features/app-shell.md`.
Строки «Reset layout» в Command palette нет (Q6). Kit `ContextMenu.tsx` и `Menu.tsx` не тронуты: первый в Ticket-е
«только читать», второй правит соседний ticket polish 153. Стили меню (заголовок, галочка, тусклый неактивный пункт)
легли в `shell.css` рядом со стилями зон, хотя файла нет в «Где в коде». ADR не нужен: в «Готово, когда» его нет, spec
говорит «ADR не нужен».

## 8. Как проверено

Сначала красный test: `test/unit/view-zones.test.tsx` на старом коде — exit 1 (7 новых test-ов упали),
`test/unit/settings-reset-layout.test.tsx` — exit 1 (3 из 3). С кодом оба зелёные. `pnpm lint`, `pnpm typecheck`,
`pnpm test` — exit 0; gate fast — exit 0, `[gate] green (fast)`. В e2e `view-buttons.spec.ts` новый случай: «Move to» и
Reset из меню, ⌥←, Shift+F10, Reset в Settings, второе окно видит каждую перемену, четыре кнопки header при 1280 px без
подписей (долг review Ticket-а 04). E2e локально не запускали (правило владельца), его проверит CI.

## Проверить себя

1. Sidebar спрятан. Человек выбирает в меню Canvas пункт «Sidebar». Где кнопка Canvas окажется на экране и в
   расстановке?
   - Ответ: в расстановке — в конце зоны rail. На экране — в конце группы header после черты, потому что rail не
     нарисован; фокус на ней.
   - Строки: `src/renderer/shell/ViewZone.tsx:200-209`
2. Почему id кнопки для фокуса лежит в переменной модуля, а не в состоянии зоны?
   - Ответ: после «Move to» кнопку рисует другая зона, а не та, где открыли меню. Фокус должна отдать зона, в которой
     кнопка появилась, и каждая зона проверяет общий запрос после смены расстановки.
   - Строки: `src/renderer/shell/ViewZone.tsx:72-82`
3. Кнопка Session последняя в header. Что сделает ⌥→?
   - Ответ: ничего: событие съедено, patch не уходит, в footer или на rail кнопка клавишей не переходит.
   - Строки: `src/renderer/shell/ViewZone.tsx:145-153`
