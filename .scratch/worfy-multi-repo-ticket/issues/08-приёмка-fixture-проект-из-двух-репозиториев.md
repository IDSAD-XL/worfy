# 08 — Приёмка: fixture-проект из двух репозиториев со stub `gh` и `npm`; настоящий Ticket в рабочем проекте

Type: task
Status: blocked 2026-11-10T04:34Z
Blocked reason: fixture tests merged in #1767 (100acec94); item 2 waits: the owner runs a real Ticket of two repositories in Mac Stable
Waits: owner
Branch: worfy-multi-repo-ticket/08
Blocked by: 02, 06, 07
Source: [spec.md](../spec.md), «Что видит пользователь», п. 1–7; «Ticket-ы», «Волны» (Wave 5); «Решения владельца
2026-11-09», Q8; [ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), «Последствия»

Платформенный Ticket: нет. Глубина ревью — `low`.

Приёмка по готовому: идёт после Ticket-ов 01–07. Ни один Ticket с несколькими `Repo:` не пишется в настоящем Project-е,
пока не влиты 01–03 (spec, «Волны»).

## Что делаем

1. **Fixture test-ы** (Q8): stub-проект из двух репозиториев (библиотека и потребитель) под
   `harness/bin/tests/fixtures/multi-repo/`, stub `gh` и `npm`. Путь «Что видит пользователь», п. 1–7:
   - Ticket с двумя `Repo:`, библиотека первой; одна ветка в обоих checkout-ах;
   - `ticket pr` на оба PR; `ticket release`; `epic-status` показывает оба PR и «waits for release»;
   - `ticket done` с одним PR — отказ; release замечен (stub tag или stub `npm view`), оба PR влиты — `done`;
   - Ticket с одним `Repo:` в том же fixture — как сегодня.
2. **Один настоящий Ticket в рабочем проекте** (Q8) ведёт владелец: правка через библиотеку и потребителя от claim до
   `done`. Итог — `.scratch/worfy-multi-repo-ticket/evidence/08-*`, без имён репозиториев, хостов и людей рабочего
   проекта.

## Готово, когда

- [ ] Fixture test-ы проходят весь путь из п. 1 — exit 0 на Mac.
  - evidence: test-run pass · `bash harness/bin/tests/multi-repo.test.sh` exit 0, passed 35, failed 0 · mac - · e9ead1b5df286705d14ac20be4b33bdda045516a
  - evidence: gate pass · `gate fast` exit 0 · mac - · e9ead1b5df286705d14ac20be4b33bdda045516a
  - evidence: test-run pass · `bash harness/bin/tests/multi-repo.test.sh` exit 0, passed 35, failed 0, also with a jq that ends lines with CRLF · mac - · c7bfa5117b06be436465310aa6f08209666e8873
  - evidence: gate pass · `gate fast` exit 0 · mac - · c7bfa5117b06be436465310aa6f08209666e8873
- [ ] Владелец провёл настоящий Ticket из двух репозиториев до `done`: одна карточка на Pipeline board, «1/2 merged»,
      «waits for release <version>», PR без ссылок друг на друга.
  - needs: mac stable
- [ ] Evidence в `.scratch/worfy-multi-repo-ticket/evidence/08-*` без данных рабочего проекта.
  - evidence: commit pass · Evidence of the fixture run of a ticket over two repositories · - - · e9ead1b5df286705d14ac20be4b33bdda045516a
- [ ] `ci-ok` на PR зелёный.

## Тесты

- Fixture test-ы Harness-а над `harness/bin/tests/fixtures/multi-repo/` (stub `gh`, `npm`).

## Где в коде

- `harness/bin/tests/fixtures/multi-repo/**`
- `.scratch/worfy-multi-repo-ticket/evidence/08-*`
