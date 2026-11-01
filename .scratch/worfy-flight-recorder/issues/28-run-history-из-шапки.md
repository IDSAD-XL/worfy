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

Ждёт: сброса недельных Limits (решение владельца 2026-11-01: новое не раздаём до сброса).
