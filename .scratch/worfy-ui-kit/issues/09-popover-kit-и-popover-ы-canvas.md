# 09 — Popover kit; popover-ы Canvas с пометкой «внутри Node»

Type: task
Status: claimed 2026-11-12T14:18Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», строка 09; «Решения по реализации» (kit, пометка «внутри Node»); «Решения по
test-ам» (Seam 1, Seam 2); истории 13, 15, 16, 17, 25; заметка темы
`docs/product/ui-overhaul/notes/inventory-overlays.md`, раздел 2.1

## Что происходит

- Popover-ы Canvas: Trash (`canvas/overlays/TrashPopover.tsx`, своя копия `useDismiss`), Archive
  (`canvas/overlays/ArchivePopover.tsx`), история Session-ов Ticket-а и Epic-а («N sessions»,
  `canvas/session-history.tsx`). Фокус внутрь не переходит; история Session-ов стоит `fixed` под кнопкой без
  переворота и без прижатия к краю окна.
- Общий только hook `useDismiss` (`canvas/use-dismiss.ts`, Esc и mousedown снаружи), его берут 2 файла.
- Фильтр тегов — плашка «Only tag …» в `<Panel>` React Flow (`TagFilterView`, `find/CanvasFind.tsx:146`). Find bar
  остаётся своим.

## Что делаем

1. `theme/kit/Popover.tsx`: обёртка Popover Base UI — роль и имя, фокус в popover и обратно, Esc закрывает только его
   и отмечается `preventDefault`, переворот и сдвиг у края окна, слой из шкалы, общая часть из `theme/kit/layer.ts`
   (закрытие по blur окна и смене вида, пометка «внутри Node»).
2. Trash, Archive и история Session-ов переходят на Popover kit. Своя копия `useDismiss` в Trash удаляется;
   `canvas/use-dismiss.ts` удаляется, если у него не осталось пользователей.
3. Фильтр тегов: если у плашки есть всплывающая часть, она переходит на Popover kit; если нет, плашка остаётся как
   есть, и Ticket записывает это в «Итог».
4. E2e `test/e2e/layers-popover.spec.ts`: popover поверх Canvas, в Node, который тащат, рядом с Terminal и Browser
   (клик внутри `<webview>` закрывает popover), под focus mode, место у края окна.

## Готово, когда

- [ ] Unit test `test/unit/kit-popover.test.tsx`: роль и имя; фокус в popover и обратно на кнопку; Esc закрывает только
      верхний слой и отмечен как обработанный; blur окна закрывает; клик по области toast-ов не закрывает.
  - evidence: test-run pass · `pnpm test test/unit/kit-popover.test.tsx` exit 0 · mac - · 61b1e6a1b
- [ ] Unit test: popover на Canvas не снимает активность Node-а первым кликом.
  - evidence: test-run pass · `pnpm test test/unit/canvas.test.tsx` exit 0 · mac - · 61b1e6a1b
- [ ] E2e `test/e2e/layers-popover.spec.ts` зелёный на macOS и Windows runner-е.
- [ ] Существующие test-ы Trash, Archive и истории Session-ов зелёные без правок ролей и `data-testid`.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · 61b1e6a1b
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 61b1e6a1b

## Где в коде

- `src/renderer/theme/kit/Popover.tsx` (новый)
- `src/renderer/theme/kit/popover.css` (новый)
- `src/renderer/canvas/overlays/TrashPopover.tsx`
- `src/renderer/canvas/overlays/trash.css`
- `src/renderer/canvas/overlays/ArchivePopover.tsx`
- `src/renderer/canvas/overlays/archive.css`
- `src/renderer/canvas/session-history.tsx`
- `src/renderer/canvas/use-dismiss.ts`
- `src/renderer/find/CanvasFind.tsx` (только фильтр тегов, если у него есть всплывающая часть)
- `test/unit/kit-popover.test.tsx` (новый)
- `test/unit/archive-popover.test.tsx`
- `test/unit/session-history-tail.test.tsx`
- `test/unit/trash-mounted.test.ts`
- `test/e2e/layers-popover.spec.ts` (новый)

## Вне скоупа

- Popover-ы sidebar, composer, What's new и комментариев к цитатам: Ticket 10.

## Итог

- Popover kit — `src/renderer/theme/kit/Popover.tsx` и `popover.css`: popup рисуется в `document.body` на слое
  `popover`, `modal={false}`, переворот и сдвиг у края окна (Positioner Base UI, отступ от края 8 px); нажатие по
  области toast-ов (`.w-toasts`) не закрывает popover. С `inNode` клик и двойной клик внутри popover-а не доходят до
  Node-а по дереву React.
- Trash, Archive и история Session-ов Ticket-а и Epic-а — на Popover kit. `canvas/use-dismiss.ts` удалён: у него
  не осталось пользователей. Роли и `data-testid` прежние.
- Фильтр тегов: у плашки «Only tag …» нет всплывающей части (только текст и кнопка «Show all» в `<Panel>`), она
  остаётся как есть.
