# 06: Drag

Type: task
Status: claimed 2026-11-27T12:25Z
Branch: worfy-layout/06
Blocked by: 05
Source: [spec.md](../spec.md), «Ticket-ы», 06; «Решения по реализации» («Drag», «Sidebar спрятан»); «Набросок функции» («Во время drag»); «Решения по test-ам», Seam 3 и Seam 4; «Риски»; решения владельца Q3, Q4; «Волны», Wave 4

Кто: агент.

## Что строить

- Native HTML5 DnD между зонами и внутри зоны, подсветка зон, маркер вставки, место «Drop here» в пустой зоне.
- Esc и отпускание вне зоны отменяют; `no-drag` header-а на время drag.
- 06 идёт после 05, потому что drag правит те же `ViewButton.tsx` и `ViewZone.tsx`.

## Где в коде

- `src/renderer/shell/ViewButton.tsx`, `src/renderer/shell/ViewZone.tsx` (Ticket 04)
- `src/renderer/shell/shell.css` — `-webkit-app-region: drag` `:368`
- Только читать: `src/renderer/autopilot/QueueList.tsx` (DnD `:82-131`, `gapAt` `:82-86`),
  `src/shared/layout/view-buttons.ts` (Ticket 02), `test/unit/queue-list.test.tsx`

## Решения

spec.md, раздел «Решения по реализации», «Drag»; «Набросок функции»; решения владельца Q3, Q4, A:

- Native HTML5 DnD, как `QueueList`; библиотеки нет.
- `draggable` на каждой View button. `dataTransfer` несёт тип `application/x-worfy-view-button` с id. Drop
  принимается только в окне, где drag начался (id лежит в модуле окна) — решено без владельца.
- Пока идёт drag, у `.w-shell` стоит `data-view-drag`, и все видимые зоны подсвечены (`data-drop-zone`). Зона под
  курсором ярче. Маркер вставки — вертикальная черта в header и footer, горизонтальная на rail, в промежутке, над
  которым курсор. Промежуток считается по середине кнопки, как `gapAt`.
- Пустая зона во время drag показывает место размером с одну кнопку — «Drop here»; без drag пустая зона ничего не
  рисует.
- Drop — `moveToZone` или `moveWithin` и один `setAppSettings({ viewButtons })`.
- Esc отменяет: Chromium заканчивает native drag с `dropEffect = 'none'`, `dragend` снимает подсветку, расстановка не
  меняется. Отпустить вне зоны — то же самое.
- Header — область перетаскивания окна (`-webkit-app-region: drag`). Такая область не получает `dragover`. Поэтому
  группа видов header всегда `no-drag`, а пока стоит `data-view-drag` — весь header тоже.
- Неактивная кнопка (нужен Project) тоже тянется: расстановка от Project-а не зависит.
- Пока sidebar спрятан, View button-ы rail в конце header — не зона для drop (решение владельца A, 2026-11-25).
- Риски (раздел «Риски»): без `no-drag` на время drag drop в header не сработает — 06 закрывает это e2e-test-ом drop в
  header. Playwright отпускает drag сам и Esc посреди drag нажать не даёт: отмену проверяют unit-test (`dragEnd` без
  drop) и ручной пункт приёмки (Ticket 08).

## Test-ы

- Unit `test/unit/view-zones.test.tsx`: drag — `fireEvent.dragStart`, `dragOver`, `drop`, `dragEnd` с
  DataTransfer-stub, как `test/unit/queue-list.test.tsx`; `dragEnd` без drop ничего не меняет (Esc) (spec.md,
  «Решения по test-ам», Seam 3).
- E2e `test/e2e/view-buttons.spec.ts`: drag Runs из footer в header (Playwright `dragTo`) с подсветкой зон и маркером в
  середине drag (Seam 4).
- Сначала падающий test: красный на старом поведении, это пишется в «Итог».
- `src/renderer/shell/` не описан в `scripts/e2e-specs.table.json`, поэтому PR запускает все spec-файлы e2e.

## Готово, когда

- [ ] Drag Runs из footer в header между Canvas и Session ставит его туда (`view-buttons.spec.ts`); пока он идёт, три
      зоны подсвечены и маркер виден; `dragEnd` без drop ничего не меняет.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/view-zones.test.tsx: drag across zones, within a zone, dragEnd without drop) · mac - · 5b55335ffee7bf7c75ae293a04535f624da88965
  - evidence: test-run pass · `pnpm test` exit 0 (view-zones: drag of the inactive Runs, aria-disabled) · mac - · a0b9ae54a0b8137e4f1b4ae603c3df224f322d28
  - evidence: test-run pass · `pnpm test` exit 0 (view-zones: review round 1 drag cases) · mac - · 115adbacfa17190aef471f00480c00388164ef43
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 5b55335ffee7bf7c75ae293a04535f624da88965
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5b55335ffee7bf7c75ae293a04535f624da88965
  - evidence: gate pass · `gate fast` exit 0 · mac - · a0b9ae54a0b8137e4f1b4ae603c3df224f322d28
  - evidence: gate pass · `gate fast` exit 0 · mac - · 115adbacfa17190aef471f00480c00388164ef43
