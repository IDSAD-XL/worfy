# 28 — Run history из шапки: вкладка «Runs» рядом с Canvas, Session и Pipeline

Type: task
Status: open
Blocked by: —
Source: приёмка 25 с владельцем 2026-11-01 — «кнопка в троеточии Epic-а как единственный способ неудобно, нужно где-то в шапке ещё».

## Что происходит

- Входы в Run history (Ticket 20): toast при остановке Run, «History» в строке статуса Autopilot (до следующего Run и до
  перезапуска приложения), «⋯ → Run history» на рамке Epic-а, «Open Run history» в Command palette.
- В шапке (`src/renderer/shell/Toolbar.tsx:23`) переключатель видов — Canvas, Session, Pipeline. Вид `history` уже есть в
  `ShellView` (`Toolbar.tsx:15`), но в переключателе его нет: попасть на экран без Epic-а на Canvas и без Run-а только что —
  только через Command palette.

## Что делаем (подтверждено владельцем 2026-11-01)

1. Четвёртая вкладка переключателя — `Runs` (иконка — шкала/часы), значение `history`. Клик — `openRunHistory(<активный
   Project>)`: самый новый Run Project-а, список Run-ов всех Epic-ов.
2. Пока открыт экран Run history, вкладка `Runs` выбрана; Esc и другие вкладки уводят с экрана как сейчас.
3. У Project-а без Run-ов вкладка есть; экран показывает своё пустое состояние (как из Command palette).
4. Без активного Project-а вкладка неактивна с tooltip «Open a Project to see its Runs».
5. Остальные входы остаются.

## Готово, когда

- [ ] Unit: переключатель рисует четыре вкладки; клик `Runs` вызывает `openRunHistory` с активным Project-ом; на
      экране истории выбрана `Runs`; без Project-а — неактивна с tooltip. Mutant «Runs не передаёт Project» — красный.
- [ ] e2e (`test/e2e/flight-recorder.spec.ts` или `autopilot.spec.ts`): Run из fixture, клик `Runs` в шапке — экран
      Run history с этим Run; клик `Canvas` — назад.
- [ ] Снимки шапки обеих тем в `.scratch/worfy-flight-recorder/evidence/28-*.png`; шапка не переполняется на минимальном
      окне 800×520.
- [ ] `docs/features/flight-recorder.md` (+ `ru/`) — вход `Runs` в списке входов; `docs/features/app-shell.md`, если там
      перечислены вкладки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Где в коде

- `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/flight-recorder/open.ts` (только читать)
- test-ы шапки (`test/unit/toolbar*.test.tsx` — найти), `test/e2e/flight-recorder.spec.ts`
- `docs/features/flight-recorder.md`, `docs/features/ru/flight-recorder.md`, `docs/features/app-shell.md`

## Итог

Сделано: четвёртая вкладка `Runs` в переключателе видов шапки (подтверждено владельцем 2026-11-01).

- `src/renderer/shell/Toolbar.tsx`: вкладка `Runs` (значение `history`, иконка — часы) после Pipeline. Клик зовёт
  `openRunHistory(project.id)` и сам вид не переключает: его ставит `openRunHistory`. `ToolbarProject` получил `id`
  (`main.tsx` его передаёт). Пока открыт экран истории, вкладка выбрана (`aria-pressed`). Без Project-а вкладка
  неактивна, tooltip «Open a Project to see its Runs». Остальные входы не тронуты.
- `src/renderer/theme/primitives.tsx` и `.css`: у сегмента `SegmentedControl` появились необязательные `disabled` и
  `title` (приглушённый вид — `opacity: 0.5`).
- Unit `test/unit/toolbar-runs.test.tsx` (6 test-ов): четыре вкладки; клик передаёт id Project-а; другие вкладки
  переключают вид и ничего не открывают; выбрана на экране истории; неактивна с tooltip без Project-а. Mutants: «Runs
  не передаёт Project» (`openRunHistory("")`) — красный; «вкладка не неактивна без Project-а» — красный.
- e2e `test/e2e/flight-recorder.spec.ts`: новый test — клик `Runs` открывает экран на самом новом Run-е fixture
  (`demo-plan`), `Runs` выбрана; клик `Canvas` закрывает экран. В старом test-е утверждение «ни одна вкладка не
  выбрана» стало «выбрана `Runs`». 3 test-а, exit 0.
- `docs/features/flight-recorder.md` и `ru/`: вход `Runs` в списке (теперь пять входов) и строка в таблицах модулей и
  test-ов. `docs/features/app-shell.md` вкладок не перечисляет, не менялся. `check-feature-docs` — exit 0.
- Снимки: `../evidence/28-header-{light,dark}.png` (1600 px), `../evidence/28-header-800x520-{light,dark}.png` и
  `../evidence/28-header-800x520-sidebar-hidden-{light,dark}.png`.
- Не выполнено: «шапка не переполняется на 800×520». С открытой боковой панелью шапка шире окна на 106 px в e2e-среде
  (там «Harness not installed» и «Limits no data yet»); без вкладки `Runs` было 71 px, то есть переполнение уже
  было, вкладка добавила 35 px. Со скрытой боковой панелью шапка помещается. Исправление раскладки шапки вне следа
  тикета, вынесено владельцу.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — exit 0.
