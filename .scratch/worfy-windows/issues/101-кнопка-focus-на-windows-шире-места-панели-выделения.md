# 101 — Кнопка Focus на Windows шире, чем место, которое оставляет ей панель выделения

Type: task
Status: open
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
