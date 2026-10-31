# 47 — Flaky test-ы Windows в gate full на ПК: two-windows, linked-browser, subagent-tree, epic-frame

Type: task
Status: open
Blocked by: —
Source: gate full на ПК владельца 2026-10-31, main `0eddc918`, 8 workers (журнал на ПК:
`evidence/throughput-56/gate-0eddc918-w8/`). Правило владельца 2026-10-23: flaky test-ы Windows — одним Ticket-ом
`worfy-polish`; открытого такого Ticket-а нет (41 закрыт #1052). Ticket заведён Orchestrator-ом ночью 2026-10-31.

## Что происходит

- `test/e2e/two-windows.spec.ts:212` («openSecondWindow gives the window it opened…»): красный в обоих прогонах
  шага `test:e2e`, строка 233 — `getAllWindows().length` ждали 3, получили 2. В одиночку зелёный (exit 0, 7 s).
  Возможна зависимость от порядка test-ов, не проверено.
- `test/e2e/linked-browser.spec.ts:90`: красный только в первом прогоне шага, строка 131 («what A typed reached B's
  page»). В одиночку не запускался.
- `test/e2e/subagent-tree.spec.ts:312`: красный только в первом прогоне, строка 353 — 1150 ms при пределе 1000 ms.
  В одиночку не запускался.

- `test/e2e/epic-frame.spec.ts:1104` («an Auction-sized Project is interactive within 3 s»): gate full на ПК, main
  `1b4009c5`, 2026-10-31 — 3394 ms при пределе 3000 ms; в одиночку тот же SHA — exit 0, 1300 ms; в девяти прошлых
  gate full на ПК — 1248–1951 ms. Причина не установлена. Предел не поднимать: исправление или quarantine.

- `test/contract/terminal-windows.test.ts:161` («close leaves no console host behind…; it is done well inside its
  bound»): gate full на ПК, полный vitest run — самое долгое из трёх закрытий 3122.6 ms на main `0be09773` и
  3128 ms на main `fc9279cf` при пределе 3000 ms (строка 177); красный в 2 из 11 сохранённых gate full на ПК, в одиночку
  зелёный. Гипотеза, не установлена: под нагрузкой helper закрытия упирается в свой же execFile timeout
  `DESCENDANTS_TIMEOUT_MS = 3000` (`src/main/terminal/windows-pty.ts:12`, `:231`). ПК замеряет время helper-а и
  срабатывания timeout-а. В quarantine только на win32 до 2026-11-07: запись
  `test/quarantine/terminal-windows-close-no-console-host.json`. Предел не поднимать.
- `test/contract/terminal-git-bash-close.test.ts:33` (закрытие Git Bash сохраняет его history): красный один раз в
  gate full на ПК, main `fc9279cf` — `.bash_history` после закрытия нет; в одиночку зелёный, 5 s. НЕ в quarantine:
  возможен баг продукта. `HANGUP_GRACE_MS` 1000 ms (`src/main/terminal/windows-pty.ts:28`) и собственный предел
  kill.exe 500 ms `HANGUP_SIGNAL_BOUND_MS` (`:52`, применяется на `:125`): под нагрузкой hangup может не дойти до bash
  или bash может выйти поздно, тогда его завершает `Stop-Process` (`:206`), и history Session-а теряется. ПК замеряет
  время от сигнала до выхода, время helper-а и закрытия без `.bash_history`; если подтвердится — отдельный bug
  Ticket в `worfy-windows`.

## Что делаем

1. Каждый — найти причину (порядок test-ов, нагрузка 8 workers, гонка в самом test-е) и исправить test или код.
2. Пределы времени не поднимать; test, который не поддаётся, — по правилу удаления test-ов владельца 2026-10-28.

## Готово, когда

- [ ] Причина каждого записана в «Итог» с доказательством (журнал, повтор `--repeat-each`).
- [ ] Каждый зелёный в одиночку `--repeat-each=5` и в шаге `test:e2e` gate full на ПК.
- [ ] Пределы test-ов не подняты; Windows-job CI зелёный.

## Где в коде

- `test/e2e/two-windows.spec.ts`, `test/e2e/linked-browser.spec.ts`, `test/e2e/subagent-tree.spec.ts`,
  `test/e2e/epic-frame.spec.ts`
- `test/contract/terminal-windows.test.ts`, `test/quarantine/terminal-windows-close-no-console-host.json`
- `test/contract/terminal-git-bash-close.test.ts`, `src/main/terminal/windows-pty.ts` (helper закрытия, hangup)
- код, на который укажет причина

## Итог

Заполняется при закрытии.
