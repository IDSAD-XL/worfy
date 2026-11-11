# 03 — ADR о Base UI и правилах kit, пакет, lint на import мимо kit, общая часть обёрток

Type: task
Status: open
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

## Готово, когда

- [ ] ADR в `docs/adr/` со статусом accepted; в нём Base UI, правила kit, отказ от Radix, cmdk, Sonner и лицензии
      обоих пакетов.
- [ ] `@base-ui/react` в `dependencies` точной версией; `pnpm install` без новых install scripts.
- [ ] Lint test: import `@base-ui/react` вне `theme/kit/` даёт ошибку lint, внутри — нет.
- [ ] Unit test общей части: blur окна и смена вида закрывают открытый popup; popup с пометкой «внутри Node» не
      снимает активность Node-а первым кликом.
- [ ] Unit test helper-а: popup Base UI в состоянии закрытия не считается открытым слоем.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0; e2e test бюджета старта зелёный.

## Где в коде

- `docs/adr/NNNN-base-ui-kit.md` (новый; номер резервируется при старте Ticket-а)
- `package.json`
- `pnpm-lock.yaml`
- `eslint.config.js`
- `src/renderer/theme/kit/layer.ts` (новый)
- `src/renderer/theme/open-layers.ts` (из Ticket-а 02)
- `src/renderer/canvas/Canvas.tsx`
- `test/unit/kit-layer.test.tsx` (новый)
- `test/unit/open-layers.test.ts` (из Ticket-а 02)

## Вне скоупа

- Сами обёртки Dialog, Popover, Menu, Tooltip и групп: Ticket-ы 04, 09, 11, 13, 14.
