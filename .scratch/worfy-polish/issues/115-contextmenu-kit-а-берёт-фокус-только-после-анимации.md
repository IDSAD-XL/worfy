# 115 — ContextMenu kit-а берёт фокус только после анимации открытия

Type: bug
Status: done 2026-11-15T02:54Z
PR: #1881
Blocked by: none
Source: flaky e2e в CI-run 43661097233 (PR #1877, renderer не трогает), бриф Orchestrator-а 2026-11-15.

## Что происходит

e2e `test/e2e/focus-sidebar.spec.ts:390` (`expect(await holdsFocus(menu)).toBe(true)` сразу после правого клика по
строке Project-а и `toBeVisible()`) дважды упал в одном job-е macOS CI. Меню видно примерно через 12 ms после клика,
у него `tabindex=-1`, но фокуса в нём ещё нет.

## Root cause

ContextMenu kit-а (`src/renderer/theme/kit/ContextMenu.tsx:183-186` и `:210`, worfy-ui-kit 12, ADR-0106) переводит фокус
на первый пункт только в `onOpenChangeComplete={focusFirst}` — когда Base UI решит, что анимация открытия закончилась.
Base UI ждёт снятия `data-starting-style` (кадр, `requestAnimationFrame`), потом `getAnimations()` и их `finished`;
свой первый фокус Base UI тоже ставит через microtask и `requestAnimationFrame` (`FloatingFocusManager`, `enqueueFocus`).
Пока кадры не идут (окно Electron в CI под нагрузкой или в фоне), меню уже видно, а фокус ещё на строке. Нажатая в это
время клавиша уходит не в меню.

Те же job-ы: `test/e2e/layers-popover.spec.ts` (тесты на строках 175 и 215) упали не на фокусе, а на геометрии: размер и
место Popover-а (`:201`, `archiveBox.y + archiveBox.height` = 1751 при кнопке на 859) и `onTop(history)` (`:226`)
прочитаны один раз сразу после появления, до того как Positioner поставил Popover на место. Тот же приём «прочитать
один раз сразу после `toBeVisible()`» есть и у фокуса Popover-а (`focusInside` на `:190`, `:206`): Popover kit-а
отдаёт первый фокус Base UI (`initialFocus`), а Base UI ставит его через кадр.

## Что делаем

- ContextMenu ставит фокус в меню сам и сразу: в layout effect того commit-а, в котором Base UI отрисовал popup
  (как `Dialog.tsx` kit-а), без ожидания конца анимации. `initialFocus` у `Menu.Popup` в Base UI 1.9 не публичный
  (нет в типах), поэтому его не трогаем: свой первый фокус Base UI ставит через кадр, находит фокус уже внутри меню и
  оставляет его на месте; unit test проверяет это и после паузы. Пункт — тот, что называет
  `focusOnOpen` (по умолчанию первый). Поведение, которое держит `test/unit/kit-context-menu.test.tsx`, не меняется:
  фокус на первом пункте при открытии, Esc возвращает фокус opener-у, фокус, ушедший в другое место окна, там и
  остаётся.
- Popover kit-а не трогаем: он не ждёт конца анимации, его первый фокус — один кадр Base UI (решение принято без
  владельца; причина — Popover-ов много мест, у каждого свой `initialFocus`, а задержка в один кадр пользователю не
  видна).
- e2e ждут условие, а не читают его один раз: `expect.poll(() => holdsFocus(menu)).toBe(true)` в
  `focus-sidebar.spec.ts` (меню Project-а и History), `expect.poll` для фокуса и для места Popover-ов в
  `layers-popover.spec.ts`.

## Готово, когда

- [ ] Сразу после открытия, без конца анимации (анимация, которая не кончается никогда), фокус уже на первом пункте
      меню. Unit test в `test/unit/kit-context-menu.test.tsx`, красный до правки.
  - evidence: test-run pass · `pnpm test test/unit/kit-context-menu.test.tsx` exit 0, exit 1 before the fix · mac - · 1926d69d5aafce4a60299e9ed735cc35de0ade2a
- [ ] Остальные test-ы `test/unit/kit-context-menu.test.tsx` зелёные без правок: первый пункт при открытии, Esc —
      фокус к opener-у, фокус в другом месте остаётся там.
  - evidence: test-run pass · `pnpm test test/unit/kit-context-menu.test.tsx` exit 0, 13 of 13, the 12 earlier tests unchanged · mac - · 1926d69d5aafce4a60299e9ed735cc35de0ade2a
- [ ] e2e `focus-sidebar.spec.ts` и `layers-popover.spec.ts` ждут фокус и место через `expect.poll`. Локально не
      запускаются (правило владельца) — проверяет CI.
  - evidence: ci-check pass · CI green on PR #1881 (macos-e2e 1/2 and 2/2, windows-e2e 1-4/4) · mac - · 240bf0a5d24c79060e0992629689d4a989100180
- [ ] lint, typecheck, unit test-ы kit-а, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 1926d69d5aafce4a60299e9ed735cc35de0ade2a

## Где в коде

- `src/renderer/theme/kit/ContextMenu.tsx` — `focusFirst`, `onOpenChangeComplete`, Popup.
- `test/unit/kit-context-menu.test.tsx`.
- `test/e2e/focus-sidebar.spec.ts` — меню Project-а, History.
- `test/e2e/layers-popover.spec.ts` — Trash, Archive, History Ticket-а.

## Вне скоупа

- `src/renderer/theme/kit/Menu.tsx:103-106`, `:126` — Menu kit-а с кнопкой ждёт конца анимации так же. Отдельный
  ticket, если понадобится.
