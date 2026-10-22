# 101 — Кнопка Focus на Windows шире, чем место, которое оставляет ей панель выделения

Type: task
Status: done 2026-10-22T14:54Z
PR: #762
Blocked by: —
Source: направление Session на Mac 2026-10-22, пересчёт красных e2e [Ticket-а 14](14-gate-full-на-windows.md);
замер на ПК 2026-10-22, main `d06d2c2d`, масштаб экрана 150 %.

## Что происходит

`test/e2e/selection-toolbar-frame.spec.ts:150` («the selection toolbar covers neither the Epic frame header nor
the Tickets around it»), оба масштаба Canvas (1 и 0.6), красный на Windows-ПК на проверке `:189`:

```
Error: the Focus button is wider than SelectionToolbar keeps off
expect(received).toBeLessThanOrEqual(expected)
Expected: <= 96
Received:    104.515625
```

Панель выделения (SelectionToolbar) обходит кнопку Focus по постоянной ширине 96 px (`FOCUS_ENTRY_SIZE` в
`src/renderer/canvas/pinning.ts`; test повторяет её как `FOCUS_ENTRY_WIDTH`, `:147`). На Windows кнопка
(`.w-focus-entry`, `src/renderer/canvas/overlays/FocusEntry.tsx`) выходит 104.5 px. Значит, на Windows панель
может закрыть часть кнопки — это видно и пользователю, не только test-у.

Вероятная причина — та же, что у [Ticket-а 94](94-чип-open-на-windows-выше-своей-рамки.md): шрифты `--font-ui`
(`src/renderer/theme/tokens.css`) — шрифты macOS, на Windows Chromium берёт запасной, и текст кнопки шире.
Запуском не подтверждено; какой шрифт подставлен, не измерено.

## Воспроизведение (ПК, 2026-10-22)

```
pnpm build && pnpm exec playwright test test/e2e/selection-toolbar-frame.spec.ts --grep-invert @packaged
```

Оба test-а файла красные в полном прогоне `pnpm test:e2e` и при повторе файла одного (2 из 2 — стойко).

## Что делаем

1. Измерить на ПК, какой шрифт у кнопки и откуда 104.5 px.
2. Решить, где правка: ширина кнопки по содержимому, которую панель меряет, а не берёт постоянной, или кнопка
   постоянной ширины на всех системах. Решение и замеры — в «Итог». Вместе с Ticket-ом 94, если причина — шрифт.

## Готово, когда

- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/selection-toolbar-frame.spec.ts --grep-invert @packaged` — код 0.
- [ ] На Mac тот же spec — код 0; на macOS кнопка Focus и панель выделения выглядят как раньше.

## Где в коде

- `src/renderer/canvas/pinning.ts`
- `src/renderer/canvas/overlays/FocusEntry.tsx`
- `src/renderer/theme/tokens.css`
- `test/e2e/selection-toolbar-frame.spec.ts`

## Итог

Ветка `worfy-windows/101`, коммит «Keep the selection toolbar off the Focus button's measured size» (2026-10-22,
ПК, база `origin/main` `4da135ba`).

**Замер (ПК, масштаб экрана 150 %).** Через CDP `CSS.getPlatformFontsForNode`: у кнопки и у `<kbd>` шрифт —
Arial (`--font-ui` перечисляет шрифты macOS, Chromium берёт `sans-serif` → Arial). Но главное не шрифт, а
надпись: на Windows кнопка читается «Focus Ctrl+Enter», на macOS — «Focus ⌘↩» (`label()` в
`src/renderer/shortcuts/match.ts`). Ширина на ПК: 104.52 px (Canvas zoom 1 и 0.6), 104.98 px (interface scale
0.8), 104.17 px (1.2) на базе `b6f597ad`; на базе `4da135ba` — 103.84–104.17 px. Ширина текста не строго
пропорциональна zoom окна, поэтому от interface scale она плавает примерно на 1 px.

**Решение: панель обходит измеренную ширину, а не постоянную.** `FocusEntry.tsx` меряет кнопку
`ResizeObserver`-ом (border box, округление вверх до целого пикселя) в маленький store
`useFocusEntrySize` (`src/renderer/canvas/pinning.ts`); `SelectionToolbar.tsx` обходит этот размер и ставит
нижнее место под измеренной высотой. 96 × 28 (`FOCUS_ENTRY_SIZE`) остаётся размером до первого замера.
Кнопку постоянной ширины на всех системах не делали: «Ctrl+Enter» не влезает в 96 px без обрезки, а запас
под любой шрифт — та же постоянная. `tokens.css` не тронут: шрифт — дело Ticket-а 94, а с замером панель
верна при любом шрифте.

**macOS (рассуждение).** «Focus ⌘↩» около 80 px, interface scale — zoom `webContents`, он меняет CSS-пиксели
целиком, так что 96 px на Mac не переполнялись ни при каком масштабе. После правки панель обходит ~80 px вместо
96: различие видно только у выделения уже ширины кнопки + 24 px (меньше ~104 px), у обычных Node кнопка не
выходит за края выделения, и место панели то же. На Mac не запускалось.

**Test-ы.** `test/unit/focus-entry-size.test.tsx` (новый, jsdom, `ResizeObserver`-заглушка): замер кнопки с
округлением; узкое выделение — панель справа при кнопке 96 px и под кнопкой при 140 × 40. Красный на main
(нет `useFocusEntrySize`). Мутанты — все красные: постоянная обратно в `SelectionToolbar.tsx`; кнопка не
меряется; без `Math.ceil`; нижний отступ по постоянной высоте. `test/e2e/selection-toolbar-frame.spec.ts`
берёт обходимую ширину из `data-focus-entry-width` панели и идёт ещё при interface scale 0.8 и 1.2 (4 случая);
мутант «постоянная обратно» — 4 из 4 красных («Expected: <= 96, Received: 103.84»).

**Проверки на ПК:** `pnpm build && playwright test test/e2e/selection-toolbar-frame.spec.ts` — 4 passed, 2
прогона, код 0; `interface-scale.spec.ts` — 2 passed, код 0; unit-test-ы, `pnpm lint`, `pnpm typecheck`,
gate fast — код 0. Пункт «Готово, когда» про Mac ждёт прогона на Mac.
