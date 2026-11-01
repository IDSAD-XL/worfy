# 12 — Модель spans и итог

Type: task
Status: done 2026-11-01T01:52Z
PR: #1183
Branch: worfy-flight-recorder/12
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

## Итог

- Модуль `src/shared/flight-recorder/` — `spans.ts` и `summary.ts`, без Node и DOM; импортирует только
  `../workflow/pipeline` (`stageOf`, `stageId`, `stageLabel`), `../workflow/types` и `../agent/subagent-type`
  (`harnessName`).
- Вход — `RunFacts`. Над типами в `spans.ts` — таблица «кто что заполняет»: Journal (13), транскрипты (14),
  GitHub (15), gate и отметки без PR (16), сервис (17: `run.live`, `now`, `pipeline`). Каждый reader заполняет свою
  часть из ОДНОГО источника: gate run несёт `sha`/`worktree`, Ticket находит модель (sha событий и работы Ticket-а,
  worktree его агентов; шаг gate — через `parentWork`); `narrow-round` и `session-error` — `RetryCauseFact`
  (Ticket или null, вид, время), модель вешает его на ближайшую следующую попытку; потерянный источник без
  Ticket-а покрывает каждый Ticket Run-а без span этого вида. От `journal-walk.mjs` (Ticket 10) не зависит.
- Stage: события Ticket-а (`status`, `pr-opened`, `push`, `ci-started`/`ci-finished`, `mark`, `approved`, `merge`)
  проигрываются по времени через `stageOf` доски (ADR-0067) — те же правила: `skipped` проходит Check, merge
  проходит все Stage до себя, повторный failure на том же head ничего не добавляет. Переход вперёд через
  несколько Stage — один span «A + B» с `no boundary in sources`; назад — `rejected` (failure на head) или `stopped`
  («back to CI», новый commit), Stage снова — `#N` со ссылкой на span, который вернул. Пока у нового head есть
  CI-события впереди, PR считает одну pending check (иначе `stageOf` проходит CI на PR без checks).
- Ticket в нескольких Wave — одна строка с `segments`; в живом Run Ticket не done — `end: null`, до «сейчас», без
  исхода, и между Wave тоже. Self time Wave вычитает отрезки её Ticket-ов. У Stage и Ticket — `pr` и `sha`.
- Конец Run — граница: события, работа, Wait-ы, ходы и отметки позже конца Run не читаются; блокировка, снятая
  после Run, держится до его конца; done после Run — не done. Блокировка — из `status` `blocked` до следующего
  статуса; одна и та же блокировка дважды — одна отметка.
- Повтор работы: предыдущая попытка — `retryOf` источника (и под другим именем), иначе того же Ticket-а, вида и
  имени, иначе (для причины из Journal) того же вида и подвида. Причина — `retryOf`, иначе последняя failed/rejected
  работа этого же Ticket-а между попытками (работа Run-а без Ticket-а не считается), иначе прошлая попытка.
- Wait несёт Ticket-ы: свои, иначе Wave, открытой при начале, иначе Wave, которая его ждала. Потерянный span в
  остановленном Run кончается вместе с тем, что покрывает.
- `summary.ts`: `selfTime` — длительность минус объединение детей внутри отрезков родителя (у Wave — плюс отрезки
  её Ticket-ов); `summarize` — три Stage по self time (ничья — раньше начавшийся), Wait-ы по причинам с долей Run
  (Run нулевой длины — доля 0), работа внутри Stage по подвидам с `summed; parallel`; потерянные spans, работа вне
  Stage и шаги gate в суммы не входят.
- Test-ы: `test/unit/flight-recorder-spans.test.ts` и `test/unit/flight-recorder-summary.test.ts`. Первым падал
  test self time Stage с двумя параллельными агентами. Импорты держат test «imports neither Node nor the DOM»
  (и `fetch`, `import()`, `require`) и lint `worfy/process-boundary`.
- Ревью 1-го круга (high, REJECTED): исправлено всё; M01 (слияние касающихся интервалов) и M11 (`limit` вместо
  `now` в живом Run) — эквивалентные мутанты: длина объединения и граница в живом Run от них не меняются.
- Ревью 2-го круга (REJECTED, два medium): Ticket без события `status` (Run подхватил его в работе) считается
  claimed с первого другого своего события — «Queued + Implementing» с `no boundary in sources`, а не Queued на весь
  Run; работа, кончившаяся до начала строки своего Ticket-а (или Run-а), не попадает в шкалу — старый gate run из
  того же пути worktree. Readers 14 и 16 передают канонический путь `worktree`. Контракт `RunFacts` вынесен в
  `src/shared/flight-recorder/facts.ts` (spans.ts его реэкспортирует), там же — что reader 14 ставит агенту без
  известного Ticket-а.
- Не проверено: блокировка Ticket-а, поставленная до начала Run-а, в шкале не видна: в Journal нет её события.
- Не проверено: модель на fixture ночного Run (Ticket 10, параллельно) — первым это сделает Ticket 13; отрисовка —
  Ticket-ы 18–19. Deploy-событий во входе нет: Stage Deploy (если он есть в Pipeline) проходится только
  статусом `done`.

**Долг (low, 2026-11-01).** Из ревью #1183 (круг 3), не исправлено; reader-ам 13–15 это нужно знать:
- `spans.ts:335` — claim, выведенный из первого другого события, против первого claim внутри Run.
- `spans.ts:613-620` — работа названного Ticket-а до его строки и открытая работа без `lastSeenAt` отбрасываются.
- Блокировка, поставленная до начала Run, в шкале не видна.
