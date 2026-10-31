# 46 — Клавиши Canvas не действуют под слоем Focus mode, когда фокус ни на чём

Type: task
Status: open
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

- [ ] В Focus mode с фокусом на `document.body` и выделенным Node Delete и Backspace ничего не отправляют в Trash.
- [ ] В том же состоянии ⌘Z и ⇧⌘Z не меняют Layout.
- [ ] В том же состоянии ⌘F не открывает панель поиска.
- [ ] Esc с фокусом на `document.body`, пустым выделением и открытой стопкой готовых выходит из Focus mode, а стопка остаётся открытой.
- [ ] Вне Focus mode все эти клавиши работают как раньше, включая фокус на `document.body`.
- [ ] Страница `docs/features/focus-mode.md` описывает новое поведение.

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
