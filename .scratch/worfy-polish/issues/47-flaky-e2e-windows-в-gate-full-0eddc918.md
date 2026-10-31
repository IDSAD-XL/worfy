# 47 — Flaky e2e Windows в gate full на `0eddc918`: two-windows, linked-browser, subagent-tree

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

## Что делаем

1. Каждый — найти причину (порядок test-ов, нагрузка 8 workers, гонка в самом test-е) и исправить test или код.
2. Пределы времени не поднимать; test, который не поддаётся, — по правилу удаления test-ов владельца 2026-10-28.

## Готово, когда

- [ ] Причина каждого записана в «Итог» с доказательством (журнал, повтор `--repeat-each`).
- [ ] Каждый зелёный в одиночку `--repeat-each=5` и в шаге `test:e2e` gate full на ПК.
- [ ] Пределы test-ов не подняты; Windows-job CI зелёный.

## Где в коде

- `test/e2e/two-windows.spec.ts`, `test/e2e/linked-browser.spec.ts`, `test/e2e/subagent-tree.spec.ts`
- код, на который укажет причина

## Итог

Заполняется при закрытии.
