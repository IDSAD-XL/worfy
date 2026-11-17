# 12 — Замер `loop-log` через две недели после Ticket-а 07

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Ticket-ы», 12; «Как поймём, что работает»; «Вне Epic-а» → «Отложено»;
[critic 2026-11-17](../../../docs/product/critic/worfy-stuck-agents-2026-11-17.md), возражение 3 и «Alternative»; условие
вернуться к детектору — [разбор 2026-10-15](../../../docs/research/2026-10-15-застрявшие-ticket-ы.md), строка 198

Кто: владелец, руками Orchestrator-а; кода нет. Autopilot этот Ticket не берёт: он датирован. Слово «владелец» первым
нужно и для Code stories: Ticket без кода не должен считаться последним PR Epic-а с кодом, иначе story Epic-а ждала бы
две недели (`TICKETS.md`, «Ticket with code»).

## Что происходит

- Ticket 07 ставит call log Harness в форме записи: повторы упавших вызовов пишутся в `<gate state>/calls/loops.jsonl`
  как `would-hint` и `would-deny`, агент ничего не видит. `harness/bin/loop-log` печатает случаи и строку `cases: N
  (revisit at 3)`.
- Условие разбора 2026-10-15: три и больше случаев без прогресса — тогда вернуться к детектору (подсказка, отказ,
  `blocked: loop`; spec, «Вне Epic-а»).
- Call log лежит на каждой Machine отдельно: Mac и ПК считают свои случаи.

## Что делаем

1. Не раньше чем через 14 дней после merge Ticket-а 07 (дата merge — строка `PR:` Ticket-а 07 и `gh pr view <N> --json
   mergedAt`) запустить на Mac и на ПК (на ПК — через Session на Windows):
   `loop-log --since <дата merge 07>`.
2. Записать в «Итог» этого Ticket-а: дату замера, `cases: N` каждой Machine, сумму, по каждому случаю — шаблон и начало
   команды (без личных данных; `node scripts/check-personal.mjs` — exit 0 перед commit-ом).
3. Отметить, какие случаи — настоящий цикл, а какие — ложное срабатывание (ожидание CI, flaky test и подобное).
4. Сумма настоящих случаев три и больше — записать в spec (раздел «Вне Epic-а») предложение второго Epic-а и вопрос
   владельцу. Меньше трёх — записать число и дату следующего замера.

## Готово, когда

- [ ] (manual) `loop-log` запущен на Mac не раньше 14 дней после merge Ticket-а 07; число записано в «Итог».
- [ ] (manual) `loop-log` запущен на ПК в тот же срок; число записано в «Итог».
- [ ] Случаи разобраны на настоящие и ложные; сумма сравнена с условием «три и больше».
- [ ] Spec, «Вне Epic-а», — строка с итогом замера: предложение второго Epic-а или дата следующего замера.
- [ ] `node scripts/check-personal.mjs` — exit 0.

## Где в коде

- `.scratch/worfy-stuck-agents/issues/12-замер-loop-log-через-две-недели.md`
- `.scratch/worfy-stuck-agents/spec.md`
