# 07: Документация en и ru

Type: task
Status: open
Blocked by: 03, 04, 05, 06
Source: [spec.md](../spec.md), «Ticket-ы», 07; «Решения по реализации» («Термины в CONTEXT.md», «Тексты UI»); «Решения по test-ам» («Какие e2e запускает PR»); «Волны», Wave 5

Кто: агент.

## Что строить

- Документация по сделанному в Ticket-ах 03–06.
- `docs/features/app-shell.md` и `docs/features/ru/app-shell.md`: вступление (View button-ы в трёх зонах вместо View
  switch; сейчас там пять видов, без Acceptance), новый раздел Footer и раздел View buttons (Behaviour, Windows, On a
  Linked machine, How it works, Implementation), Sidebar (блок на rail).
- Правки страниц `updates`, `harness`, `focus-mode`, `acceptance`, `pr-inbox`, `flight-recorder`, `work-track`,
  `workflow` и их ru.
- Термины View button и Footer в `CONTEXT.md`.
- Тексты тем Guide про toolbar (`src/renderer/guide/topics/harness/`, `sessions/`, `the-window-and-your-data/`, en и
  ru).

## Где в коде

- `docs/features/app-shell.md`, `docs/features/ru/app-shell.md`
- `docs/features/` и `docs/features/ru/` — `updates`, `harness`, `focus-mode`, `acceptance`, `pr-inbox`,
  `flight-recorder`, `work-track`, `workflow`
- `CONTEXT.md`, раздел App
- `src/renderer/guide/topics/harness/`, `src/renderer/guide/topics/sessions/`,
  `src/renderer/guide/topics/the-window-and-your-data/`

## Решения

spec.md, раздел «Решения по реализации», «Термины в CONTEXT.md» и «Тексты UI»:

- **View button** — кнопка, которая переключает main area на один из шести видов (Canvas, Session, Pipeline, Runs,
  Pull requests, Acceptance). Стоит в одной из трёх зон: Header, Sidebar (rail), Footer. Расстановка — в app settings
  этой Machine. _Avoid_: вкладка, tab, View switch (как имя всего набора).
- **Footer** — полоса внизу окна под sidebar и main area: View button-ы зоны Footer и chip версии с popover-ом
  приложения и Harness. _Avoid_: status bar, нижняя панель.
- Header в коде и документах остаётся toolbar (`Toolbar.tsx`, `w-toolbar`); «Header» — имя зоны в меню «Move to» (Q3).
- Тексты UI — английские (ADR-0074), документы — en и ru.

## Test-ы

- Docs PR (Ticket 07 без `src/`) — без e2e (spec.md, «Решения по test-ам», «Какие e2e запускает PR»).

## Готово, когда

- [ ] Страницы en и ru говорят одно и то же; ни одна не называет колонку Harness в header или шесть вкладок.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
