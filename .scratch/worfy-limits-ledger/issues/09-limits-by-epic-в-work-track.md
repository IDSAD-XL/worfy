# 09: «Limits by Epic» в Work track

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Ticket-ы», 09; «Решение», «Где это видно», 2; «Как пользователь этим пользуется», шаги
1–3; «Экран»; «Решения по реализации» («Run history и Work track»); «Решения по test-ам», Seam 3; «Риски» («Прошлые
недели по нынешнему `k`»); «Волны», Wave 4

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Work track (кнопка Runs, в footer по умолчанию, `docs/features/work-track.md:15`) показывает «Hours by Epic»
  (`src/renderer/work-track/SummaryRow.tsx:38`) за Day, Week или Month и панель Span-а (`SpanPanel.tsx`). Доли Limits
  там нет.

## Что строить

- `SummaryRow.tsx`: рядом с «Hours by Epic» — «Limits by Epic · estimate from tokens» с полосами `≈N%` и итогом периода
  «≈41% of the week · cache losses ≈6%». Работа без Epic-а — `—`, последней, как у часов.
- Щелчок по итогу открывает панель периода `LimitsPanel.tsx`: заголовок «Where the Limits went · <период> · estimate
  from tokens at this window's rate (week at N%)», вкладки Tickets, Roles, Rounds, Models, Vendors, Cache losses; строка
  «Other Projects on this Machine» без имён (решение владельца 2026-11-28, Q7 (а)). Во вкладке Roles — та же подсказка
  про Eco mode, что в Run history (Q6 (а)).
- Панель Span-а: token-ы, доля чтения из cache и оценка доли.
- Без оценки — token-ы и «not enough data yet» с причиной. Тексты UI — английские (ADR-0074).

## Где в коде

- `src/renderer/work-track/SummaryRow.tsx`
- `src/renderer/work-track/LimitsPanel.tsx` (новый, имя — предложение)
- `src/renderer/work-track/SpanPanel.tsx`
- `src/renderer/work-track/store.ts`, `src/renderer/work-track/work-track.css`
- `test/unit/work-track-panel.test.tsx`, `test/e2e/work-track.spec.ts`

## Test-ы

- Unit test-ы: «Limits by Epic» и итог периода; панель периода с вкладками и Vendors; строка чужих Project-ов без имён;
  панель Span-а с token-ами и долей чтения из cache; без оценки — token-ы.
- e2e: fixture-транскрипты двух Epic-ов и `limits.json` — «Limits by Epic» и панель периода видны.
- Сначала падающий test: красный до изменений, это пишется в «Итог».
- Без моделей и без сети.

## Готово, когда

- [ ] Work track показывает «Limits by Epic» и итог периода рядом с «Hours by Epic».
- [ ] Панель периода — вкладки Tickets, Roles, Rounds, Models, Vendors, Cache losses; панель Span-а — token-ы, доля
      чтения из cache и оценка.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
