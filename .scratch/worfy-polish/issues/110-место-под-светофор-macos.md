# 110 — место под traffic lights macOS: 92 px окна вместо 80

Type: bug
Status: done 2026-11-11T22:54Z
PR: #1805
Branch: worfy-polish/110-traffic-lights-room
Blocked by: none
Source: владелец 2026-11-11, после обновления до 0.4.0 на macOS 26: wordmark «worfy» в sidebar упирается в зелёную кнопку
traffic lights.

## Что происходит

Strip над sidebar (`.w-sidebar__titlebar`, `src/renderer/shell/shell.css:32`) оставляет слева
`calc(80px / var(--interface-scale, 1))`. `src/main/window-frame.ts` ставит traffic lights в `trafficLightPosition: { x: 20, y: 19 }`;
на macOS 26 три кнопки кончаются около 80 px, и между ними и wordmark (`span.w-sidebar__wordmark`, `Sidebar.tsx`) места не остаётся.
То же число 80 держат toolbar (`.w-toolbar[data-sidebar='hidden']`) и панель focus mode (`.w-focus__bar[data-sidebar='hidden']`)
при скрытом sidebar.

## Что делаем

1. Token `--traffic-lights-room: 92px` в `src/renderer/theme/tokens.css` (его грузит `main.tsx`, значит его видят и
   `shell.css`, и `focus.css`): 12 px свободного места после кнопок.
2. Все три места берут его: `calc(var(--traffic-lights-room) / var(--interface-scale, 1))` — деление на масштаб остаётся,
   traffic lights с интерфейсом не масштабируются.
3. e2e test-ы, где закреплено 80, и страница focus mode (en + ru) говорят 92.

## Готово, когда

- [ ] Strip над sidebar, toolbar и панель focus mode при скрытом sidebar на macOS оставляют слева 92 px окна при любом масштабе
      интерфейса; число задано в одном месте — `--traffic-lights-room` в `theme/tokens.css`.
  - evidence: commit pass · Room for the macOS traffic lights: 92 px instead of 80 (worfy-polish 110) · - - · ead205391b3f560b191b62d8175707b116c3102f
- [ ] `test/e2e/sidebar-rail.spec.ts`, `test/e2e/focus-sidebar.spec.ts`, `test/e2e/interface-scale.spec.ts` ждут 92 и зелёные в CI
      (локальный e2e не запускается — правило владельца).
  - evidence: ci-check pass · CI e2e (macos-e2e, windows-e2e) green on PR #1805 · mac - · babeaee80c183b25857ef89a8ffff60e06a176e7
- [ ] lint, typecheck, unit test-ы shell/sidebar/toolbar/focus/interface scale и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ead205391b3f560b191b62d8175707b116c3102f
- [ ] вручную: на macOS 26 между зелёной кнопкой и wordmark «worfy» виден зазор.

## Где в коде

- `src/renderer/theme/tokens.css`.
- `src/renderer/shell/shell.css`.
- `src/renderer/focus/focus.css`.
- `test/e2e/sidebar-rail.spec.ts`, `test/e2e/focus-sidebar.spec.ts`, `test/e2e/interface-scale.spec.ts`.
- `docs/features/focus-mode.md`, `docs/features/ru/focus-mode.md`.
