# 126 — Toast с кнопками: кнопки под текстом, текст не сжимается

Type: bug
Status: done 2026-11-19T03:55Z
PR: #2028
Blocked by: none
Source: баг-репорт владельца 2026-11-19 — снимок экрана toast-а обновления «worfy 0.… ready» с кнопками
Restart when idle / Restart now / Later: текст разбился по одной-две буквы в строке: «worf / y / 0....».

Кто: агент.

## Что происходит

- Toast — одна flex-строка (`src/renderer/toast/toast.css:29-33`, `.w-toast`): текст, затем кнопки действий, затем
  кнопка закрытия ×.
- Текст (`.w-toast__text`, `toast.css:63`) — `flex: 1; min-width: 0`, а кнопки (`.w-toast__action`, `toast.css:73`) —
  `flex: none`. Ширина области — не больше 360 px, поэтому три кнопки забирают почти всё, и тексту остаются считанные
  пиксели: он переносится по буквам, а clamp в три строки обрезает его до «worf / y / 0…».
- Разметка — `src/renderer/toast/ToastRegion.tsx:85-93`. Toast обновления «ready» с тремя кнопками —
  `src/renderer/update/toasts.ts:154-155`; по три кнопки бывает и у других вызывающих (`showToast` с `actions`).

## Что делаем

1. Toast с кнопками действий — две строки: в первой текст и × справа, во второй — кнопки действий. Текст занимает всю
   ширину первой строки и больше не сжимается кнопками.
2. Toast без кнопок остаётся одной строкой, как сейчас.
3. Clamp текста в три строки сохраняется; порядок фокуса — кнопки действий, затем ×; Esc на toast в фокусе закрывает его,
   как раньше.
4. Размещение стопки (`placement.ts`, измерение высоты в `ToastRegion.tsx`) работает с более высоким toast-ом без правок:
   высота меряется, а не задаётся.
5. Если страница Feature описывает вид toast-а — одна фраза о второй строке (английская страница).

## Где в коде

- `src/renderer/toast/ToastRegion.tsx` — обёртка строки кнопок, только когда `toast.actions` не пуст.
- `src/renderer/toast/toast.css` — сетка toast-а: текст и × в первой строке, строка кнопок под ними.
- `test/unit/toasts-view.test.tsx` — unit test: у toast-а с кнопками они лежат в отдельном элементе-строке, у toast-а без
  кнопок такой строки нет.
- `docs/features/notifications.md` — фраза о двух строках у toast-а с кнопками.

## Готово, когда

- [ ] Toast обновления «worfy … ready» с тремя кнопками показывает текст целиком в первой строке, кнопки — во второй
  (снимки Playwright в светлой и тёмной теме).
  - evidence: review pass · PR #2028 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Toast без кнопок — одна строка, как до правки.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/toasts-view.test.tsx: a toast without actions has no .w-toast__actions row) · mac - · b83f1d806ac542795ca2e1fcd74654934cbf44df
  - evidence: review pass · PR #2028 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test на отдельную строку кнопок и на её отсутствие у toast-а без кнопок зелёный; порядок фокуса и Esc не
  изменились (существующие test-ы `toasts-view` зелёные).
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/toasts-view.test.tsx, 16 tests incl. focus order and Esc) · mac - · b83f1d806ac542795ca2e1fcd74654934cbf44df
  - evidence: review pass · PR #2028 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] gate fast зелёный; CI зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · b83f1d806ac542795ca2e1fcd74654934cbf44df
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44450639370/job/135326020623 · ci - · 6f083403ecfa7599e99464181699378977d8a874
