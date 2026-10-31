# 12 — Модель spans и итог

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Модель» (все пункты), «Ticket-ы» (12), «Соглашения для Ticket-ов этого Epic-а» (глубина ревью `high`); решение 03, Q1–Q9 ([03-модель-spans.md](03-модель-spans.md)); решение 01, Q4, Q8 ([01-destination-единица-истории-хранение-id.md](01-destination-единица-истории-хранение-id.md)); решение 07 ([07-живая-шкала-или-после-остановки.md](07-живая-шкала-или-после-остановки.md)); решение 08, Q5–Q7 ([08-неполная-история.md](08-неполная-история.md)); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md) (Stage вычисляется)

## Что происходит

- Модуля `src/shared/flight-recorder/` нет. Шкала Run нигде не вычисляется; прототип — Card `card-57714d55`
  «Flight Recorder — прототип шкалы Run» (решение 05).
- Stage Ticket-а не хранится, а вычисляется из фактов (ADR-0067); Pipeline Project-а — `workflow.pipeline` Profile-а.
- Ticket-ы 13–16 дают факты из Journal, транскриптов, GitHub и gate; этот Ticket — чистая модель, которая
  собирает из фактов дерево и итог. Источники он не читает.

## Что делаем

Чистый модуль без Node и DOM. Шкала вычисляется при открытии; своего индекса spans нет (решение 01, Q4).

1. **Виды span** (решение 01, Q8): `run`, `wave`, `ticket`, `stage`, `agent` (подвид `implementer`, `verifier`,
   `other` по имени и типу агента), `ci`, `gate`, `script`, `wait`, `orchestrator-turn`. Набор фиксированный.
2. **Поля** (решение 03, Q6): вид; начало; конец или `null`; исход `ok`, `failed`, `rejected`, `blocked`, `stopped`,
   `cut-off`; причина (обязательна у Wait, повтора и неуспеха); номер попытки; ссылка на span-причину повтора;
   ссылки (run, номер Wave, Ticket, session id или agent id, PR, sha, verdict — какие есть у вида); источник начала
   и источник конца.
3. **Дерево** (решение 03, Q1, Q2, Q9): Run → Wave → Ticket → Stage по Pipeline Project-а → работа (агент, CI run,
   gate, script). Ticket в нескольких Wave — одна строка на весь Run: отрезки по Wave и пробел между ними.
   Дорожка Wait — Wait-ы уровня Run; дорожка Orchestrator — его ходы со ссылками на Ticket-ы, не вложенные.
4. **Stage** (решение 03, Q3): граница — событие источника (claim, PR открыт, CI начат и кончен, verdict или
   отметка агента, merge, `done`). Нет события — соседние Stage одним span с именами обоих и пометкой
   «no boundary in sources».
5. **Wait** — span с причиной `limits`, `limits-budget`, `background-tasks`, `gate-queue`, `other-machine`.
   **Блокировка** — не span, а отметка на строке Ticket-а (время, `Blocked reason:`, `Waits:`); дальше строка
   штрихуется до снятия блокировки или конца Run. **Повтор** — новый span того же вида с номером `#N` и ссылкой на
   причину (круг доработки после REJECTED, `narrow-round`, перезапуск после ошибки Session, повторный CI run).
   Wait «человек» и «сон Machine» в v1 нет (решение 03, Q5; приёмка, Q3).
6. **Обрыв** (решение 03, Q7; решение 07): span без конца кончается последним событием о нём в любом источнике,
   исход `cut-off`. Пока Run идёт, незаконченный span тянется до «сейчас» и исхода не имеет.
7. **Потерянный источник** (решение 08): span, о котором знает Journal, без подробностей — пометка с подписью
   «transcript deleted», «gate logs deleted (10 runs or 8 days)», «GitHub did not answer», «branch deleted».
   Молчит и Journal — шага не было.
8. **Собственное время и итог** (`summary.ts`; решение 03, Q8): собственное время = длительность минус объединение
   интервалов вложенных spans. Итог: три самых долгих Stage по собственному времени; Wait-ы по причинам (сумма и
   доля Run); работа внутри Stage по подвидам (сумма, с пометкой «summed; parallel»).

Глубина ревью — `high` (первый PR модели, соглашения spec-а).

## Готово, когда

- [ ] Unit test дерева: факты двух Wave с Ticket-ом в обеих дают одну строку Ticket-а с двумя отрезками; ходы
      Orchestrator-а — на своей дорожке, со ссылками на Ticket-ы, не вложены.
- [ ] Unit test Stage: границы по событиям claim → PR → CI → verdict → merge → `done`; без события PR — один span
      «Implementing + …» с пометкой «no boundary in sources».
- [ ] Unit test повтора: REJECTED и второй span того же агента — `#2` со ссылкой на span-причину; повторный CI run —
      `#2` у `ci`; у Wait, повтора и неуспеха причина есть всегда — test это держит.
- [ ] Unit test блокировки: отметка с `Blocked reason:` и `Waits:`, штриховка до снятия или до конца Run;
      блокировка не создаёт span.
- [ ] Unit test обрыва: остановленный Run — span без конца кончается последним событием о нём, исход `cut-off`;
      живой Run — тянется до «сейчас», исхода нет.
- [ ] Unit test потерянного источника: четыре подписи; span без следа и в Journal не появляется.
- [ ] Unit test итога: собственное время с параллельными детьми (объединение, не сумма); три Stage по
      собственному времени; Wait-ы по причинам с долей Run; работа по подвидам с пометкой «summed; parallel».
- [ ] Модуль не импортирует Node и DOM (lint или test на импорты).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-spans.test.ts` (новый): виды, поля, дерево, Stage, повторы, блокировки, обрыв,
  потерянный источник.
- Unit `test/unit/flight-recorder-summary.test.ts` (новый): собственное время и итог.
- Факты в test-ах — литералы, без источников; без токенов.
- Сначала падающий: собственное время Stage с двумя параллельными агентами — объединение интервалов, а не сумма.

## Где в коде

- `src/shared/flight-recorder/spans.ts` (новый)
- `src/shared/flight-recorder/summary.ts` (новый)
- `test/unit/flight-recorder-spans.test.ts` (новый)
- `test/unit/flight-recorder-summary.test.ts` (новый)

Только читать: Card `card-57714d55` (прототип), `src/shared/autopilot/journal.ts` (имена событий Wait-ов),
`docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md`.
