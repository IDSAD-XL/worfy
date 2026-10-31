# 46 — Клавиши Canvas не действуют под слоем Focus mode, когда фокус ни на чём

Type: task
Status: claimed 2026-10-31T01:01Z
Blocked by: —
Source: слово владельца 2026-10-31 («Только Focus mode»), находка при написании страницы `docs/features/focus-mode.md` (`worfy-feature-docs` 19, `## Итог`). Код прочитан, приложение не запускалось.

## Что происходит

Страница Focus mode обещает, что с фокусом в слое Delete, Backspace и ⌘Z не действуют на Canvas, и это верно. Но фокус может быть
ни на чём: тогда `event.target` равен `document.body`, а обработчики Canvas считают такое нажатие своим.

- `src/renderer/canvas/overlays/SelectionToolbar.tsx:79-85`: `onCanvas` принимает `document.body`. Слой Focus mode он не проверяет.
- Отсюда `:88-104`: Delete и Backspace отправляют выделение в Trash, ⌘Z и ⇧⌘Z меняют Layout. Пользователь этого не видит: всё
  происходит под слоем.
- Отсюда же `:110-113`: Esc при пустом выделении и открытой стопке готовых сворачивает её под слоем с `preventDefault`, поэтому
  Focus mode остаётся, хотя таблица Esc на странице говорит «Leaves» (`docs/features/focus-mode.md:98`).
- `src/renderer/find/CanvasFind.tsx:437-444`: ⌘F открывает панель поиска под слоем. Обработчик проверяет только `dom.offsetParent`,
  а Canvas под слоем остаётся на экране.

Удаление под слоем самое опасное: выделение остаётся на Canvas весь Focus mode, потому что слой открывается на нём.

## Что делаем

1. `onCanvas` в `SelectionToolbar.tsx` возвращает `false`, пока `focusModeActive()` (`src/renderer/focus/focus-state.ts:50`). Это закрывает
   Delete, Backspace, ⌘Z, ⇧⌘Z и Esc стопки одним условием.
2. Обработчик ⌘F в `CanvasFind.tsx` не открывает поиск, пока `focusModeActive()`. Поиск по Canvas под слоем нечего показать.
3. Страница `docs/features/focus-mode.md`, раздел Keys: правило «Pressed with the focus in the layer» охватывает и фокус ни на чём, в
   таблице появляется ⌘F. Перевод — по правилу Epic-а `worfy-feature-docs`, в этом PR только английская страница.

## Готово, когда

- [x] В Focus mode с фокусом на `document.body` и выделенным Node Delete и Backspace ничего не отправляют в Trash.
- [x] В том же состоянии ⌘Z и ⇧⌘Z не меняют Layout.
- [x] В том же состоянии ⌘F не открывает панель поиска.
- [x] Esc с фокусом на `document.body`, пустым выделением и открытой стопкой готовых выходит из Focus mode, а стопка остаётся открытой.
- [x] Вне Focus mode все эти клавиши работают как раньше, включая фокус на `document.body`.
- [x] Страница `docs/features/focus-mode.md` описывает новое поведение.

## Тесты

- `test/e2e/focus.spec.ts` — критерии 1–4 (extend). Каждый test сначала виден красным на текущем коде.
- `test/unit/epics-ui.test.tsx`, `test/e2e/selection-toolbar-frame.spec.ts` — критерий 5, существующие test-ы остаются зелёными.

## Где в коде

- `src/renderer/canvas/overlays/SelectionToolbar.tsx` — `onCanvas`, клавиши и Esc стопки.
- `src/renderer/find/CanvasFind.tsx` — ⌘F.
- `src/renderer/focus/focus-state.ts` — `focusModeActive`, только чтение.
- `docs/features/focus-mode.md` — раздел Keys.
- `test/e2e/focus.spec.ts`.

## Вне scope

- Остальные баги продукта из списков Epic-а `worfy-feature-docs`: владелец 2026-10-31 выбрал только этот.
- Другие клавиши Canvas: на странице они уже описаны как не действующие под слоем, находок о них нет.

## Итог

Все четыре бага подтвердились красным e2e test-ом на коде до правки, каждая клавиша своим test-ом (`test/e2e/focus.spec.ts`, фокус на `document.body` создаётся через `activeElement.blur()` и проверяется перед каждым нажатием):

- Delete и Backspace: плитки исчезли, Node ушли в Trash, Focus mode закончился (ожидалось 2 плитки, стало 0).
- ⌘Z и ⇧⌘Z: Layout изменился под слоем (x Node 592 → 40 и 40 → 592).
- ⌘F: панель поиска открылась под слоем.
- Esc: Focus mode остался (ожидалось 0 слоёв, остался 1), а стопка свернулась под слоем (кнопка стала `Expand done tickets`, ожидалась `Collapse`).

Пустое выделение в Focus mode достижимо: двойной клик с ⌘ по Ticket-у. Первый клик выделяет его, второй снимает выделение, а двойной всё равно открывает Focus mode.

Правка: `onCanvas` (`SelectionToolbar.tsx`) и обработчик ⌘F (`CanvasFind.tsx`) не действуют при `focusModeActive()`. Каждый новый test после этого же нажатия вне Focus mode проверяет, что клавиша снова работает. `onCanvas` в этом файле используют только эти два обработчика; одноимённые функции в `browser-pages.ts` и `navigation.ts` — другие. `openFind` вызывается только из обработчика ⌘F.

В `docs/features/focus-mode.md` кроме раздела Keys убрана фраза «Opening the find bar is not such a request» в разделе Leaving: открыть панель в Focus mode теперь нечем.

**Ревью глубины `high`, первый раунд.** Три агента: корректность, test-ы с мутантами (12 значимых пойманы, один эквивалентный), линза
`documentation`. Находок high в коде нет. Линза нашла одну med и три low на страницах, все правки внесены; поправлены `epic-frames.md`,
`canvas.md`, `focus-mode.md`.

**Оставлено, уровень low, Ticket-ов нет:**

- ⌘Z и ⇧⌘Z с фокусом ни на чём под слоем теперь идут в undo меню Edit и могут отменить набор в поле Note в плитке, то есть буквально
  изменить Layout. Это видно в плитке и совпадает с фокусом в слое, поэтому пункт «Готово, когда» считается выполненным для Layout Canvas;
  страница это называет. Настоящее нажатие меню в e2e не проверено: Playwright идёт через CDP.
- `test/e2e/focus.spec.ts:337`: test Delete ждёт `settled()`. Сейчас этого хватает, но настоящий `await` в `trash.put` сделал бы проверку
  слепой к позднему удалению.
- Вне diff: popover, открытый до ⌘↩ (`src/renderer/canvas/overlays/TrashPopover.tsx:71`), первым Esc закрывается под слоем, Focus mode
  остаётся. Прочитано в коде, не запускалось.
- Панель поиска, открытая до входа в Focus mode, остаётся под слоем и видна снова после выхода.
