# 03 — ADR о Base UI и правилах kit, пакет, lint на import мимо kit, общая часть обёрток

Type: task
Status: done 2026-11-12T16:53Z
PR: #1820
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», строка 03; «Решения по реализации» (библиотека, kit, Base UI импортирует только
kit, helper, Esc); истории 15, 16, 17, 28, 30; [критик](../../../docs/product/critic/worfy-ui-kit-2026-11-11.md),
возражение 2

Ticket берут только после «да» spike-а (Ticket 01, заметка `.scratch/worfy-ui-kit/spike-base-ui.md`).

## Что происходит

- В `package.json` нет ни одной библиотеки UI-компонентов. Лицензию нового пакета записывают в ADR
  (ADR-0037, раскладка рамки Epic-а через ELK).
- Агент-исполнитель без записи в ADR может взять Radix, cmdk или Sonner сам.
- У каждой обёртки kit будет одна и та же общая часть: закрытие по blur окна и при смене вида, пометка «внутри Node»
  для popup-ов Canvas, отметка keep-out для toast-ов.

## Что делаем

1. ADR: Base UI (`@base-ui/react`) — слой поведения под свой CSS; правила kit (обёртки в `theme/kit/`, только kit
   импортирует Base UI, слой из шкалы z-index, Esc отмечается `preventDefault`, вид — свои классы и tokens, правка
   вида — отдельной строкой PR-а); что не берём (Radix, cmdk, Sonner, Vaul, shadcn/ui, Tailwind) и почему; лицензии
   и install scripts Base UI и NumberFlow (`@number-flow/react`, Ticket 17); обновления вручную, версия не моложе
   суток. Номер ADR резервируется при старте Ticket-а.
2. `@base-ui/react` точной версией в `dependencies`.
3. `eslint.config.js`: `no-restricted-imports` — `@base-ui/react` только из `src/renderer/theme/kit/`.
4. `theme/kit/layer.ts`: общая часть обёрток — закрытие по blur окна и при смене вида, классы `nodrag`, `nopan`,
   `nowheel` и пометка «внутри Node», отметка keep-out для toast-ов. `canvas/Canvas.tsx`: обработчик, который
   снимает активность Node-а, пропускает нажатия внутри popup-ов с этой пометкой.
5. `theme/open-layers.ts` (из Ticket-а 02) узнаёт popup Base UI, который ещё в DOM, но уже закрывается.
6. Esc отмечается обработанным в фазе React (spike, заметка `spike-base-ui.md`, шаг 2, пункт 4). Base UI закрывает popup
   и ставит `preventDefault` из своего слушателя на `document`, то есть после всех обработчиков React: React ловит
   события на корне приложения, и portal не разрывает всплытие React. Поэтому:
   - общая часть `theme/kit/layer.ts` вешает на сам popup `onKeyDown`: Esc закрывает popup, вызывает
     `preventDefault()` и `stopPropagation()`. Так предок popup-а по дереву React со своим Esc его не получает (пример
     в `main` — `session/ProductSessionPanel.tsx:289-293`, панель закрылась бы тем же нажатием);
   - поле, в котором фокус остаётся при открытом popup-е, не полагается на `defaultPrevented` в своём `onKeyDown`, а
     спрашивает helper «открытые слои». В `main` так ошибается `session/MessageInput.tsx:347`: при открытом popup-е
     Base UI Esc прервёт ход агента и закроет popup одним нажатием;
   - z-index слоя стоит на позиционированном элементе (portal с `position` или positioner). Иначе backdrop окна с
     меньшим z-index закрывает popup (spike, run 43129431332, Popover над Settings).

## Готово, когда

- [ ] ADR в `docs/adr/` со статусом accepted; в нём Base UI, правила kit, отказ от Radix, cmdk, Sonner и лицензии
      обоих пакетов.
  - evidence: commit pass · Base UI for the kit: ADR-0106 (docs/adr/0106-base-ui-kit.md) · - - · be0d34c94
- [ ] `@base-ui/react` в `dependencies` точной версией; `pnpm install` без новых install scripts.
  - evidence: test-run pass · `pnpm install --frozen-lockfile` exit 0; package.json pins @base-ui/react 1.9.0, no ERR_PNPM_IGNORED_BUILDS · mac - · be0d34c94
- [ ] Lint test: import `@base-ui/react` вне `theme/kit/` даёт ошибку lint, внутри — нет.
  - evidence: test-run pass · `WORFY_TEST_FILES=test/unit/kit-import-lint.test.ts node scripts/vitest-electron.mjs` exit 0 · mac - · be0d34c94
- [ ] Unit test общей части: blur окна и смена вида закрывают открытый popup; popup с пометкой «внутри Node» не
      снимает активность Node-а первым кликом.
  - evidence: test-run pass · `WORFY_TEST_FILES=test/unit/kit-layer.test.tsx node scripts/vitest-electron.mjs` exit 0; canvas.test.tsx exit 0 · mac - · be0d34c94
- [ ] Unit test helper-а: popup Base UI в состоянии закрытия не считается открытым слоем.
  - evidence: test-run pass · `WORFY_TEST_FILES=test/unit/open-layers.test.tsx node scripts/vitest-electron.mjs` exit 0 · mac - · be0d34c94
- [ ] Unit test общей части: Esc в popup-е внутри элемента со своим обработчиком Esc в `onKeyDown` закрывает только
      popup, обработчик элемента не срабатывает; поле с фокусом при открытом popup-е не выполняет своё действие по Esc.
  - evidence: test-run pass · `WORFY_TEST_FILES=test/unit/kit-layer.test.tsx node scripts/vitest-electron.mjs` exit 0 · mac - · be0d34c94
- [ ] E2e test в настоящем Electron: Esc в popup-е внутри элемента со своим Esc — одно нажатие, одно действие. Его
      пишет первый Ticket, у которого такой popup появляется в приложении (10 или 11); здесь — сценарий и unit test.
      Пишут его Ticket 11 (menu «Modes» в composer-е, `test/e2e/layers-menu.spec.ts`, пункт 4) и Ticket 10 (popover-ы
      Queued messages и Effort, `test/e2e/layers-popover.spec.ts`, пункт 4); сценарий — ADR-0106, раздел
      «E2e-сценарий для Ticket-ов 10 и 11».
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0; e2e test бюджета старта зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · be0d34c94
  - evidence: ci-check pass · CI green on PR #1820 (ci-ok, e2e jobs included) · mac - · 39573c95750a9a29c8363963ae38cf4912da581f

## Где в коде

- `docs/adr/NNNN-base-ui-kit.md` (новый; номер резервируется при старте Ticket-а)
- `package.json`
- `pnpm-lock.yaml`
- `eslint.config.js`
- `src/renderer/theme/kit/layer.ts` (новый)
- `src/renderer/theme/open-layers.ts` (из Ticket-а 02)
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/session/MessageInput.tsx` (Esc спрашивает helper «открытые слои»)
- `test/unit/kit-layer.test.tsx` (новый)
- `test/unit/open-layers.test.ts` (из Ticket-а 02)

## Вне скоупа

- Сами обёртки Dialog, Popover, Menu, Tooltip и групп: Ticket-ы 04, 09, 11, 13, 14.
