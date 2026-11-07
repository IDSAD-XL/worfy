# 62 — Flight Recorder: Run очереди читает данные Ticket-а по его Epic-у

Type: bug
Status: open
Blocked by: —
Source: review PR [#1535](https://github.com/IDSAD-XL/worfy/pull/1535) ([worfy-autopilot-queue 18](../../worfy-autopilot-queue/issues/18-run-history-ожидание-и-run-очереди.md):
Run history для Run-а над очередью Epic-ов), 2026-11-06. Находка medium, плюс одна low в том же месте. PR влит
(`35fcbacc`). Строки перечитаны по main `fe0ff152`.

## Что происходит

Run над очередью Epic-ов (Autopilot ведёт несколько Epic-ов подряд, `journal.epics`) показывается в Flight Recorder,
но часть данных Ticket-а читается по первому Epic-у Run-а (`journal.epic` / `run.epic`), а не по Epic-у самого
Ticket-а. Пример: очередь `alpha` → `beta`, в обоих Epic-ах есть Ticket 01.

- **Ветки и PR.** `src/main/flight-recorder/service.ts:539` просит ветки Ticket-ов только у `journal.epic`. Ticket
  второго Epic-а со своей строкой `Branch:` не находит свою ветку, и его PR не читается.
- **Локальный вердикт.** `service.ts:571-577` собирает Ticket-ы без PR для чтения marks file с `epic: journal.epic`
  (строка 576): для `beta/01` читается marks file Ticket-а `alpha-01`.
- **Agent-ы из transcript-ов.** `src/main/flight-recorder/transcripts.ts:393` и `:471` передают parser-у
  transcript-а `epic: run.epic`. В `src/shared/flight-recorder/from-transcript.ts`:
  - `:554` — regex ветки и пути `.scratch/<epic>/issues/` строится только для первого Epic-а;
  - `:587` — Wave другого Epic-а (`touch.epic !== input.epic`) отбрасывается;
  - `ticketByNumber` (`:321-326`) ищет Ticket Run-а только по номеру. Agent «ticket 01» в очереди с `alpha/01` и
    `beta/01` всегда попадает в `alpha/01`.
- **low: имена строк Ticket-ов.** `src/renderer/flight-recorder/span-words.ts:53` отрезает префикс Epic-а
  (`span.name.split('/').at(-1)`): в Run-е очереди — две строки «Ticket 01».
- `docs/features/flight-recorder.md` (раздел о дереве Run → Wave → Ticket, Run над очередью Epic-ов) не должен
  обещать больше, чем делает код.

## Что делаем

1. Epic каждого Ticket-а Run-а — из самого Ticket-а (`<epic>/<NN>`), не из `journal.epic`; использовать его во всех трёх
   местах: ветки, marks file, разбор transcript-ов (regex ветки и пути, Wave-ы других Epic-ов, поиск Ticket-а по
   номеру с учётом Epic-а).
2. Номер без Epic-а, который подходит к Ticket-ам двух Epic-ов, не приписывать ни одному молча: выбрать правило и
   записать его в «Итог».
3. Имя строки Ticket-а — с Epic-ом (`Ticket beta/01`) только когда в Run-е больше одного Epic-а; Run одного Epic-а
   выглядит как сейчас.
4. Сверить `docs/features/flight-recorder.md` и его перевод в `docs/features/ru/` с кодом после правки.

Глубина review — `medium`.

## Готово, когда

- [ ] Ветки, marks file и разбор transcript-ов берут Epic Ticket-а, а не `journal.epic` / `run.epic`
      (`service.ts:539`, `service.ts:576`, `transcripts.ts:393`, `:471`, `from-transcript.ts:554`, `:587`, `:321-326`).
  - evidence: commit pass · Flight Recorder: a queue Run reads each Ticket by its own Epic (worfy-polish 62) · - - · 2828f39f192f87b8bdcd6b223c76ec17f5de0420
- [ ] Test-ы на Run очереди с одним номером Ticket-а в двух Epic-ах (`alpha/01` и `beta/01`), каждый до правки
      красный: Ticket второго Epic-а со своей строкой `Branch:` получает свой PR; Ticket без PR второго Epic-а
      читает свой marks file (`beta-01`); agent «ticket 01» с веткой или путём `beta` приписан `beta/01`, а Wave
      Epic-а `beta` — Ticket-ам `beta`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/flight-recorder-transcript.test.ts test/contract/flight-recorder-service.test.ts` exit 0 (red on origin/main 8c57c8018) · mac - · 2828f39f192f87b8bdcd6b223c76ec17f5de0420
- [ ] Имена строк Ticket-ов: в Run-е очереди — с Epic-ом, в Run-е одного Epic-а — как сейчас; unit test на оба.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/flight-recorder-span-names.test.tsx` exit 0 · mac - · 2828f39f192f87b8bdcd6b223c76ec17f5de0420
- [ ] `docs/features/flight-recorder.md` и перевод не обещают больше, чем делает код.
  - evidence: commit pass · Flight Recorder: a queue Run reads each Ticket by its own Epic (worfy-polish 62) · - - · 2828f39f192f87b8bdcd6b223c76ec17f5de0420
- [ ] Все unit и contract test-ы `src/main/flight-recorder/`, `src/shared/flight-recorder/`,
      `src/renderer/flight-recorder/`, `pnpm typecheck`, `pnpm lint`, gate fast — exit 0.

## Где в коде

- `src/main/flight-recorder/service.ts:539`, `:571-577`
- `src/main/flight-recorder/transcripts.ts:393`, `:471`
- `src/shared/flight-recorder/from-transcript.ts:321-326` (`ticketByNumber`), `:554`, `:587`
- `src/renderer/flight-recorder/span-words.ts:53`
- `docs/features/flight-recorder.md`, `docs/features/ru/flight-recorder.md`

## Итог

Ветка `worfy-polish/62-queue-run-epic`, base `origin/main` `8c57c8018`.

**Epic Ticket-а — из его ключа `<epic>/<NN>` (п. 1).**

- `service.ts`: ветки Ticket-ов читаются у каждого Epic-а Run-а (`journal.epics` и Epic-и ключей Ticket-ов), ветка
  Ticket-а — из карты его Epic-а; Ticket без PR передаёт в чтение marks file свой Epic (`beta-01`, не `alpha-01`).
  Run одного Epic-а, как раньше, спрашивает ветки один раз.
- `from-transcript.ts`: regex ветки и пути `.scratch/<epic>/issues/` строится по всем Epic-ам Ticket-ов Run-а и
  отдаёт Epic совпадения; Wave «tickets NN of epic X» принимается для любого Epic-а Run-а и называет Ticket-ы
  этого Epic-а. `ParseInput.epic` (и `TranscriptRun.epic` в `transcripts.ts`, строки вызова не менялись) теперь
  значит только Epic Run-а, когда Run не называет ни одного Ticket-а; с Ticket-ами Epic берётся из их ключей.

**Правило для номера без Epic-а (п. 2).** Номер из имени agent-а (`impl-01`), из `ticket 01` в описании или prompt
приписывается Ticket-у, только если в Run-е ровно один Ticket с этим номером. Номер, который есть у двух Epic-ов
очереди, не называет ни один Ticket: решает следующая подсказка (ветка или путь в prompt, потом worktree), а без неё
agent остаётся Run-у (`null`). Ветка, путь или строка Wave с Epic-ом выбирают Ticket своего Epic-а. В Run-е одного
Epic-а номера не повторяются, и всё как раньше.

**Имена строк (п. 3).** `displayName(span, epics)`: при `epics.length > 1` (`RunView.epics`, есть только у Run-а
очереди) строка Ticket-а — `Ticket beta/01`, иначе `Ticket 01`. Timeline и detail panel передают `view.epics` во все
вызовы (`Timeline.tsx`, `DetailPanel.tsx` — вне следа тикета, без них имя не изменить).

**Документация (п. 4).** `docs/features/flight-recorder.md`: в дереве Run-а очереди Ticket назван с Epic-ом; в
«Which Ticket a piece of work is» — правило Epic-а ветки и пути и номера, общего для двух Epic-ов. Перевод
`docs/features/ru/flight-recorder.md` о Run-е очереди не пишет ничего (отстаёт целиком) и большего, чем код, не
обещает; не правился (ADR-0088: в PR с поведением правится английская страница).

**Что не закрыто (п. 5).** Все test-ы Flight Recorder (25 файлов), `pnpm lint`, `pnpm typecheck` — exit 0. gate fast на
Mac — exit 2: красные только contract test-ы слежения за файлами (`cards-watch-edits`, `claude-home-registry`,
`docs-watch-root`, `docs`, `workflow-reader`, `harness-script-env`) — перегруженный fseventsd этой ночью, вне правки.
Вердикт п. 5 — по CI.
