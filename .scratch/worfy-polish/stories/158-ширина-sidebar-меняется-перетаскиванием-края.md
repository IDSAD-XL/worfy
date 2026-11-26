# Code story — worfy-polish 158: Ширина sidebar меняется перетаскиванием его правого края и сохраняется

Kind: pr · Epic: worfy-polish · Ticket: 158 · PR: - · Language: ru

## 1. Что было не так

Sidebar был всегда 264 px: `--sidebar-width` в `tokens.css`, без способа его изменить. После rail в 48 px панели раздела
оставалось около 210 px, и строки раздела Assistant переносились по два-три слова. Владелец попросил менять ширину
sidebar перетаскиванием.

- Требование: [Что происходит](../issues/158-ширина-sidebar-меняется-перетаскиванием-края.md#что-происходит)

## 2. Ширина в app settings: необязательное поле, приведённое к пределам

Code: `src/main/settings/store.ts:312-316` · key lines: 315, 316

```ts
/** The sidebar's width after a patch: kept when left out, gone for null, else brought into range. */
function sidebarWidthAfter(current: number | undefined, patched: number | null | undefined): number | undefined {
  if (patched === undefined) return current
  return patched === null ? undefined : clampSidebarWidth(patched)
}
```

- Что делает: patch `sidebar.width` оставляет прежнюю ширину, если поля нет; `null` убирает поле (ширина по
  умолчанию, 264); число приводится к 220…640 и к целым пикселям (`clampSidebarWidth`). При чтении файла неверный тип
  ширины отбрасывается один, а не делает весь `app-settings.json` нечитаемым (`.catch(undefined)` в мягкой схеме).
- Почему здесь: Ticket называет `store.ts` (`copy`, `merge`, `same`) и решение Orchestrator-а: `sidebar.width` в px,
  необязательное, нет поля — 264. Почему сброс — `null`, а не запись 264: так старые и сброшенные файлы одинаковы, а
  «нет поля» в Ticket-е и значит «по умолчанию».
- Без него: схема состояния выбросила бы поле при чтении, и ширина не переживала бы перезапуск.
- Требование: [Что строить, п. 2](../issues/158-ширина-sidebar-меняется-перетаскиванием-края.md#что-строить)
- Риски и пробелы test-ов: два окна, которые тянут край одновременно, пишут по очереди — побеждает последняя запись, как
  у остальных app settings; отдельно это не проверено.

## 3. Пределы окна: Canvas оставлено 480 px, но не уже 264

Code: `src/renderer/shell/sidebar-width.ts:21-33` · key lines: 27, 32

```ts
/**
 * The widest the sidebar may be in a window `windowWidth` CSS pixels wide: SIDEBAR_WIDTH_MAX, or what
 * leaves SIDEBAR_CANVAS_ROOM to the rest of the window — but never below the default, which the
 * sidebar had at any window size before its width could change.
 */
export function sidebarWidthMax(windowWidth: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_DEFAULT, Math.floor(windowWidth) - SIDEBAR_CANVAS_ROOM))
}

/** `width` as a window `windowWidth` CSS pixels wide shows it. */
export function sidebarWidthIn(width: number, windowWidth: number): number {
  return Math.min(Math.max(Math.round(width), SIDEBAR_WIDTH_MIN), sidebarWidthMax(windowWidth))
}
```

- Что делает: ширина, которую показывает окно, — сохранённая, но не больше «окно минус 480 px» и 640. Окно читается
  через `useSyncExternalStore` и событие `resize`; узкое окно только показывает sidebar уже, в настройки ничего не
  пишется, и более широкое окно снова показывает сохранённую ширину.
- Почему здесь: 480 px и «приводить при изменении окна без записи» — решения Orchestrator-а в Ticket-е. Нижняя граница
  264 у этого предела добавлена в этом PR: при масштабе интерфейса 150 % и окне 800 px ширина страницы около 533 CSS px,
  и без неё sidebar по умолчанию стал бы 220 px — у тех, кто край не трогал, поменялось бы поведение.
- Без него: широкий sidebar в узком окне закрыл бы Canvas.
- Требование: [Что строить, п. 3](../issues/158-ширина-sidebar-меняется-перетаскиванием-края.md#что-строить)
- Риски и пробелы test-ов: в окне уже 744 CSS px sidebar 264 px оставляет Canvas меньше 480 px — так было и до Ticket-а.

## 4. Одна запись на жест и отмена

Code: `src/renderer/shell/sidebar-width.ts:60-75` · key lines: 64, 69, 71, 74

```ts
  const saved = useAppSettings(sidebarWidthOf)
  const moving = useMoving((state) => state.width)
  const inWindow = useSyncExternalStore(followResize, windowWidth)
  const move = (width: number) => useMoving.setState({ width })
  const commit = (width: number) => {
    useMoving.setState({ width })
    // No main to save it in (a unit test of a component): the width holds in this window only.
    if (!hasPreloadBridge()) return
    const mine = ++writes
    void setAppSettings({ sidebar: { width: width === SIDEBAR_WIDTH_DEFAULT ? null : width } }).then((refused) => {
      if (refused !== undefined) console.error('appSettings.set failed, the sidebar keeps this width in this window only:', refused)
      else if (mine === writes) useMoving.setState({ width: null })
    })
  }
  const cancel = () => useMoving.setState({ width: null })
  return { width: sidebarWidthIn(moving ?? saved, inWindow), max: sidebarWidthMax(inWindow), move, commit, cancel }
```

- Что делает: во время drag ширина живёт в общем store (`useMoving`) — его читают и полоса края, и shell, который
  пишет `--sidebar-width` на `<html>`. Запись в настройки — одна, в `commit`; ширина 264 пишется как `null`. Только
  ответ на последнюю запись отпускает показанную ширину. Отмена возвращает слово настройкам.
- Почему здесь: Ticket велит писать переменную, а не отдельную ширину: её читает и панель ADR (`AdrSection.tsx:66`).
  Образец записи — `sidebar-visibility.ts` и `useSplit` Product Session, названные в Ticket-е.
- Без него: каждое движение мыши писало бы `app-settings.json` и рассылало `appSettings.changed` всем окнам.
- Требование: [Что строить, п. 5](../issues/158-ширина-sidebar-меняется-перетаскиванием-края.md#что-строить)
- Риски и пробелы test-ов: отказ main (файл не пишется) оставляет ширину только в этом окне — путь виден в коде, test-а
  на него нет.

## 5. Общий разделитель: пишется только изменённое, любой обрыв drag — отмена

Code: `src/renderer/theme/kit/Divider.tsx:77-102` · key lines: 79, 87, 88, 95, 99, 100

```tsx
    const onPointerUp = (up: PointerEvent) => {
      if (up.pointerId !== drag.pointerId) return
      if (drag.last === drag.start) cancel()
      else {
        end()
        onCommit(drag.last)
      }
    }
    const cancel = () => {
      end()
      if (onCancel === undefined) onMove(drag.start)
      else onCancel()
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === drag.pointerId) cancel()
    }
    // A press while the drag still runs: its release was missed. Added during the press that starts the
    // drag, this listener does not hear that press.
    const onPointerDownWhileDragging = (): void => cancel()
    // Escape ends the drag where it started; nothing else under the pointer hears it (focus mode would close).
    const onKeyDownWhileDragging = (key: globalThis.KeyboardEvent) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      cancel()
    }
```

- Что делает: логика `SplitDivider` вынесена в `theme/kit/Divider.tsx` и считает в любых единицах: `perPixel` —
  1 для пикселей sidebar, 1 / ширина родителя для доли Product Session; `SplitDivider` стал обёрткой. Жест пишет
  только значение, которое изменил: щелчок без движения и drag, вернувшийся к началу, идут как отмена; клавиша у
  предела ничего не пишет. Отмена — Escape (слушатель на window в фазе capture, дальше Escape не идёт),
  `pointercancel`, следующее нажатие во время drag (отпускание было пропущено), потеря фокуса окном и уход
  разделителя (sidebar спрятали посреди drag). Подсветка во время drag — по `data-dragging` на самом разделителе.
- Почему здесь: Ticket велит не писать второй разделитель, а обобщить `SplitDivider`; Escape — решение 5
  Orchestrator-а. Правило «писать только изменённое» и отмены по нажатию, blur и уходу разделителя — из ревью #2287,
  круг 2: щелчок по краю в узком окне записывал суженные 264 поверх сохранённых 600.
- Без него: щелчок по краю, когда окно сужает sidebar, навсегда терял сохранённую ширину; спрятанный посреди drag
  sidebar возвращался с шириной drag; пропущенное отпускание оставляло drag живым, и следующее движение с нажатой
  кнопкой двигало край и писало его.
- Требование: [Что строить, п. 8](../issues/158-ширина-sidebar-меняется-перетаскиванием-края.md#что-строить)
- Риски и пробелы test-ов: `pointermove` без нажатой кнопки drag не обрывает — Chromium шлёт такие посреди drag
  (`FocusMode.tsx`, `followPointer`); пропущенное отпускание ловится только blur-ом или следующим нажатием. Настоящий
  захват указателя Chromium в unit test-ах не проверяется, это делает e2e.

## 6. Что сознательно не меняли

Toggle sidebar (Cmd/Ctrl+B), focus mode и `SidebarFocusKeeper` не тронуты: полоса края лежит внутри `<nav
class="w-sidebar">`, и хранитель фокуса видит фокус на ней как фокус в sidebar. Ширина одна для обычного вида и focus
mode. `SidebarView` рисует полосу только с `resizable` — его unit test-ы без shell полосы не видят. Масштаб интерфейса
не умножает ширину: main зумит всё окно, а ширина хранится в CSS px, как и прежние 264.

## 7. Как проверено

`pnpm test test/unit/sidebar-resize.test.tsx test/unit/product-session-panel.test.tsx test/contract/app-settings.test.ts`
до правки — красные (4 упавших и файл, который не собирался), после — exit 0. `pnpm lint`, `pnpm typecheck`, `pnpm test`
— exit 0; gate fast — exit 0. E2e `test/e2e/sidebar-resize.spec.ts` локально не запускался (правило владельца): его
гоняет CI.

## Проверить себя

1. Почему узкое окно не пишет новую ширину в настройки?
   - Ответ: окно только ограничивает показ (`sidebarWidthIn`); запись есть лишь в `commit`, который зовёт жест на крае,
     поэтому сохранённая ширина возвращается, когда окно снова шире.
   - Строки: `src/renderer/shell/sidebar-width.ts:60-75`
2. Почему Escape ловится на window в фазе capture и останавливается?
   - Ответ: фокус во время drag может быть где угодно, а Escape без остановки дошёл бы до focus mode и закрыл его;
     capture на window слышит клавишу первым.
   - Строки: `src/renderer/theme/kit/Divider.tsx:96-102`
3. Что получит файл после двойного щелчка по краю и почему?
   - Ответ: patch `{ sidebar: { width: null } }`, и поле исчезает: `null` в `sidebarWidthAfter` даёт `undefined`, а
     нет поля — ширина по умолчанию.
   - Строки: `src/main/settings/store.ts:313-316`
