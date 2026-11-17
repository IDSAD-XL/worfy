# 13 — Eval-кейс `compaction-state`: probes о состоянии после compaction, с hook-ом и без

Type: task
Status: open
Blocked by: 10, 11, 12
Source: [spec.md](../spec.md), «Ticket-ы», 13; «Решения по реализации» → «Compaction», пункт «Eval (13)»; «Как это сделано
у конкурентов» (Factory Droids); «Готово, когда», пункт о compaction; «Решено без владельца», 1

Кто: агент.

Не платформенный Ticket (eval-кейс и запуск руками). Глубина ревью — `medium`.

**Цена.** Eval зовёт реальную модель. Сначала `scripts/eval-harness.mjs --dry-run`, затем запуск с `--max-cost-usd`;
цена каждого запуска — в «Итог».

## Что происходит

- Что агент помнит после compaction, сейчас не меряется. Hook Ticket-а 11 и инструкции Ticket-а 10 нужно сравнить с
  тем, что было без них.
- Factory меряет summary probes — контрольными вопросами; хуже всего у всех держится список затронутых файлов.
- По решению без владельца 1 половина compaction этого Epic-а считается сделанной, когда этот eval записал числа.

## Что делаем

1. Кейс `harness/evals/compaction-state`: длинная Session по сценарию, `/compact`, затем probes — цель, Ticket, пункты
   «Готово, когда», затронутые файлы, решения, следующий шаг.
2. Два прогона: без hook-а и инструкций, с ними.
3. Запуск руками, вне CI: `scripts/eval-harness.mjs --dry-run`, затем с `--max-cost-usd`.
4. Числа по каждому probe, модель и цена — в «Итог».

## Готово, когда

- [ ] Кейс `harness/evals/compaction-state` влит; в CI он не запускается.
- [ ] `--dry-run` прошёл, его вывод и оценка цены — в «Итог».
- [ ] «Итог» — числа по каждому probe без hook-а и с ним; с hook-ом probes о Ticket-е, пунктах «Готово, когда» и
      следующем шаге отвечены лучше, или «Итог» называет, почему нет.
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `harness/evals/compaction-state/` (новый)

Только читать: `scripts/eval-harness.mjs`, другие кейсы `harness/evals/`.

## Вне скоупа

- Изменения hook-а и правил по итогам eval-а — новый Ticket, если числа плохие.
