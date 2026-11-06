# 18 — Run history и Flight Recorder: ожидание Orchestrator-а и Run очереди

Type: task
Status: open
Blocked by: 07, 14
Source: [spec.md](../spec.md), «Что видит владелец», п. 7; «Термины» (причина `orchestrator-busy`); «Решения владельца», 5, 21; [02](02-старт-при-идущей-работе.md), Q5; [03](03-очередь-epic-ов.md), Q6

## Что происходит

- Причины Wait — `WAIT_CAUSES` (`src/shared/flight-recorder/facts.ts:29`); Wait-ы из журнала собирает
  `from-journal.ts` (`open`, `:296`; `background-tasks`, `:327-…`; `run-stopped`, `:345`); слова причин —
  `src/renderer/flight-recorder/span-words.ts`.
- Список Run-ов — `listRuns` (`src/main/autopilot/journal.ts:173-197`): `epic` из `run-started`; элемент списка —
  `runListItemSchema` (`src/shared/ipc/runs.ts:27-29`), фильтр по одному Epic-у (`runs.list`, `:156`).
- Run history: пункт списка «время · Epic» (`runOption`, `src/renderer/flight-recorder/RunHistoryView.tsx:23-24`),
  чип фильтра (`:96`, `:109`), «Epic <имя>» в заголовке (`:111`).

## Что делаем

1. `WAIT_CAUSES` + `orchestrator-busy`; `from-journal` — Wait от `run-started`/`orchestrator-busy` до
   `orchestrator-free` (или до `run-stopped` `start-cancelled`/`start-refused`), detail — «turn», «2 queued», имена
   задач; слово причины — «Orchestrator busy».
2. Run очереди: `RunSummary.epics`, `runListItemSchema.epics` (необязательное; старые журналы — один Epic); фильтр Epic-а
   находит Run, в чьей очереди есть Epic; пункт списка и заголовок — «worfy-faults → worfy-retry → …» (длинный — до
   трёх имён и «+N»).
3. Шкала: границы Epic-ов (`epic-started`) — метки на дорожке Run-а с именем Epic-а; Wave-ы — как сейчас, Epic в
   подписи; `epic-finished` `waits-owner`/`elsewhere` — метка с причиной.
4. `start-cancelled`, `start-refused` и `tasks-killed` `start-now` — слова для сводки и панели.

## Готово, когда

- [ ] Unit test `from-journal`: журнал с ожиданием — Wait `orchestrator-busy` с detail; Cancel — Wait до
      `run-stopped`; журнал очереди — метки Epic-ов.
  - evidence: test-run pass · `pnpm test test/unit/flight-recorder-journal.test.ts` exit 0 · mac - · d24e6d6b45af80579547417ca38255e21cc082fa
- [ ] Unit test вида: пункт списка и заголовок Run-а очереди; фильтр по второму Epic-у находит Run.
  - evidence: test-run pass · `pnpm test test/unit/flight-recorder-view.test.tsx test/contract/flight-recorder-service.test.ts` exit 0 · mac - · d24e6d6b45af80579547417ca38255e21cc082fa
- [ ] e2e `test/e2e/flight-recorder.spec.ts`: Run очереди из fixture-журнала — заголовок со списком, Wait «Orchestrator
      busy» на шкале.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/flight-recorder.spec.ts` exit 0 · mac - · d24e6d6b45af80579547417ca38255e21cc082fa
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-view.test.tsx`; e2e
  `test/e2e/flight-recorder.spec.ts`; fixture-журналы — рядом с существующими fixture-ами Flight Recorder.
- Сначала падающий: журнал с `orchestrator-busy` — Wait не строится.

## Где в коде

- `src/shared/flight-recorder/facts.ts`, `src/shared/flight-recorder/from-journal.ts`
- `src/renderer/flight-recorder/span-words.ts`, `src/renderer/flight-recorder/RunHistoryView.tsx`
- `src/main/autopilot/journal.ts`, `src/shared/ipc/runs.ts`
- `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-view.test.tsx`, `test/e2e/flight-recorder.spec.ts`

Только читать: `src/shared/autopilot/journal.ts`, `src/shared/flight-recorder/spans.ts`.
