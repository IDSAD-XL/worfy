# 111 — Длинная ветка в карточке Project-а прячет его имя

Type: bug
Status: claimed 2026-11-11T18:00Z
Branch: worfy-polish/111-long-branch-project-card
Blocked by: none
Source: бриф Orchestrator-а 2026-11-11, сообщение tester-а.

## Что происходит

В разделе Projects sidebar-а карточка Project-а на длинной ветке (например, `fix/cv-download-ownership`) теряет имя
целиком. Ветка в `.w-row__trailing > .w-mono` занимает всю строку, `.w-row__label` (`flex: 1`, `min-width: 0`) сжимается
до нуля, а сама ветка переносится на две строки, и фиксированная высота строки 18 px обрезает их сверху и снизу.

Причина: `.w-row__trailing` (`src/renderer/theme/primitives.css`) не сжимается и не обрезает текст, а у span-а ветки нет
`nowrap` и многоточия.

Тот же дефект — в меню Project switcher-а: `.w-project-switcher__label` с `flex: 1` (основа 0) и
`.w-project-switcher__detail` с `flex: 0 1 auto` — длинная ветка сжимает имя до нуля, хотя и обрезается многоточием.

## Что делаем

- Карточка Project-а (`ProjectCard`): имя главнее; ветка в одну строку, обрезается многоточием и занимает не больше
  половины строки; полная ветка — в `title` (tooltip) span-а ветки. Тот же `ProjectCard` рисует карточки и под «All
  Projects» (worfy-polish 99), отдельной строки имени и ветки там нет.
- Общий `.w-row__trailing` не меняем: в нём живут chip-ы (`MachinesSection`, `FolderBrowser`, `LinkMachineDialog`),
  которые обрезать нельзя. Стили — только у карточки.
- Пункт меню Project switcher-а: ветка — не шире половины пункта. `shell.css` правит ticket 110, поэтому предел — inline
  style в `ProjectSwitcher.tsx`; полное имя и ветка уже в `title` пункта.

## Готово, когда

- [ ] Карточка с длинной веткой: span ветки с `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, его
      обёртка не шире 50 % строки и сжимается, в `title` — полная ветка, имя на месте. Unit test
      `test/unit/project-card-long-branch.test.tsx` (jsdom), красный до правки.
  - evidence: test-run pass · `pnpm test test/unit/project-card-long-branch.test.tsx` exit 0, exit 1 before the fix · mac - · ee8dc2592b42c24b24ea28600a876fc038734c01
- [ ] Пункт меню Project switcher-а: ветка не шире 50 % пункта — тот же unit test.
  - evidence: test-run pass · `pnpm test test/unit/project-card-long-branch.test.tsx` exit 0, exit 1 before the fix · mac - · ee8dc2592b42c24b24ea28600a876fc038734c01
- [ ] e2e `test/e2e/sidebar-rail.spec.ts`: у «meadow» длинная ветка; в карточке ширина имени > 0, ветка в одну строку и
      внутри карточки; в меню switcher-а имя «meadow» шире нуля. Локально не запускается (правило владельца) — проверяет CI.
- [ ] lint, typecheck, unit test-ы sidebar-а и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ee8dc2592b42c24b24ea28600a876fc038734c01

## Где в коде

- `src/renderer/shell/sidebar/ProjectsSection.tsx` — `ProjectCard`, стили `styles`.
- `src/renderer/shell/ProjectSwitcher.tsx` — пункт меню.
- `test/unit/project-card-long-branch.test.tsx`.
- `test/e2e/sidebar-rail.spec.ts`.
- `docs/features/app-shell.md` — раздел Projects.

## Вне скоупа

- `shell.css` (ticket 110): там место правилу ширины ветки в меню switcher-а; сейчас — inline style.
