# 12 — ContextMenu kit: 5 context menu в DOM

Type: task
Status: done 2026-11-14T23:34Z
PR: #1848
Branch: worfy-ui-kit/12
Blocked by: 11
Source: [spec.md](../spec.md), «Ticket-ы», строка 12; «Решения по реализации» (kit); истории 3, 8, 10, 13, 15; заметка
темы `docs/product/ui-overhaul/notes/inventory-overlays.md`, раздел 3.1

## Что происходит

Пять context menu в DOM, общего нет. Ни одно не возвращает фокус; стоят `fixed` в точке клика, к краю окна прижато
только меню цитат:

- Canvas — `canvas/overlays/CanvasMenu.tsx`;
- «Remove binding» — `canvas/overlays/BindingDrop.tsx:196-245`: без имени, фокус не получает;
- Project в sidebar — `shell/sidebar/ProjectsSection.tsx:262-322`;
- Machine в sidebar — `shell/sidebar/MachinesSection.tsx:137-181`;
- действия с выделенным текстом ответа — `session/QuoteCommentParts.tsx:168-222`.

## Что делаем

1. `theme/kit/ContextMenu.tsx`: обёртка ContextMenu Base UI поверх Menu kit (Ticket 11) — то же поведение клавиш и
   фокуса, место у точки клика со сдвигом от края окна.
2. Пять context menu переходят на ContextMenu kit. HTML-меню остаются HTML: Playwright не нажимает native menu
   (`CanvasMenu.tsx:12`).
3. E2e `test/e2e/layers-menu.spec.ts` дописывается: context menu Canvas у края окна, «Remove binding» с клавиатуры.

## Готово, когда

- [ ] Unit test `test/unit/kit-context-menu.test.tsx`: роль и имя; стрелки и typeahead; Esc закрывает и отмечен как
      обработанный; фокус возвращается туда, где был; место у края окна сдвигается внутрь.
  - evidence: test-run pass · `pnpm test test/unit/kit-context-menu.test.tsx` exit 0 · mac - · 92d3045701e761986175fbf7c711dd7fc5bf5b55
- [ ] Существующие `canvas-menu`, `machines-section`, `quote-comments-ui` unit test-ы зелёные без правок ролей и
      `data-testid`; дописанный `layers-menu.spec.ts` зелёный на macOS и Windows runner-е.
  - evidence: ci-check pass · CI green on PR #1848 (ci-ok, e2e jobs included) · mac - · 7745dbc3e240f69f390915903bbac269bfdf316a
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
  - evidence: review pass · Look changes named in the body of PR #1848; reviewer VERIFIED · - - · 7745dbc3e240f69f390915903bbac269bfdf316a
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 92d3045701e761986175fbf7c711dd7fc5bf5b55

## Где в коде

- `src/renderer/theme/kit/ContextMenu.tsx` (новый)
- `src/renderer/canvas/overlays/CanvasMenu.tsx`
- `src/renderer/canvas/overlays/BindingDrop.tsx`
- `src/renderer/shell/sidebar/ProjectsSection.tsx`
- `src/renderer/shell/sidebar/MachinesSection.tsx`
- `src/renderer/session/QuoteCommentParts.tsx`
- `src/renderer/session/QuoteComments.tsx`
- `src/renderer/session/quote-comments.css`
- `test/unit/kit-context-menu.test.tsx` (новый)
- `test/unit/canvas-menu.test.tsx`
- `test/unit/machines-section.test.tsx`
- `test/unit/quote-comments-ui.test.tsx`
- `test/e2e/layers-menu.spec.ts` (из Ticket-а 11)

## Вне скоупа

- Native context menu и menu bar приложения.
