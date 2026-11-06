# 07 — Run принят и ждёт Orchestrator-а: ожидание, Start now и Cancel в main

Type: task
Status: done 2026-11-06T14:51Z
PR: #1499
Blocked by: —
Source: [spec.md](../spec.md), «Что видит владелец», п. 2–3; «Как работает» → «Run принят и ждёт»; «Решения владельца», 1–6, 8; «ADR»; «Решено без владельца», 1–4; [02](02-старт-при-идущей-работе.md), Q1–Q6, Q8

Начинать после merge worfy-retry 05 и 14 (общие run.ts, cycle.ts, журнал; worfy-retry 04 влит 2026-11-06, PR #1468).

## Что происходит

- `Orchestrators.setUnattended(projectId, true)` отказывает при ходе (`ORCHESTRATOR_IN_TURN`,
  `src/main/agent/orchestrator.ts:213`, проверка `:319`), при живых фоновых задачах (`:219`, `:324`) и при сообщениях в
  очереди (`:216`, `:325`). `Autopilot.start` (`src/main/autopilot/run.ts:848`) зовёт его (`:880`) и отдаёт отказ.
- Старт из чата проверяет то же заранее (`orchestratorRefusal`, `src/main/autopilot/chat-start.ts:47-52`) и умеет ждать
  только конец хода Orchestrator-а, который сам попросил старт (`ChatStarts.waiting`, `:98`; `startAfterTurn`, `:140`;
  `afterTurn`, `:171`; `AFTER_TURN_MESSAGE`, `:31`).
- Нет состояния «Run принят, но не начат»: Run появляется в `Autopilot.runs` только после `setUnattended`; `snapshot`
  (`run.ts:2192-2196`) знает ожидания `limits` и границы Wave (`waitingFor`, `src/shared/ipc/autopilot.ts:53`).
- Причины `run-stopped` — `AUTOPILOT_STOP_REASONS` (`src/shared/autopilot/cycle.ts:43-62`); события журнала —
  `JOURNAL_EVENT_KINDS` (`src/shared/autopilot/journal.ts:297`).

## Что делаем

1. **Ожидание в `Autopilot.start`.** Проверки без Orchestrator-а (`ownChecks`, `run.ts:935-944`) и `checkElsewhere`
   (`:982`) — как сейчас, отказ остаётся отказом. Затем Run заводится сразу (id, `run-started`, публикация состояния) и,
   если Orchestrator занят, ждёт: новый метод `Orchestrators.busy(projectId)` → `{ turn, queued, tasks }` или `null`
   (те же три условия, что `orchestrator.ts:319-325`, с учётом `awaitsGiveBack`), подписка на события Session
   (`state`, `background_tasks`, очередь). Журнал: `orchestrator-busy` (`turn`, `queued`, `tasks`) в начале и при каждом
   изменении, `orchestrator-free` в конце. Состояние: `waitingFor: 'orchestrator'`, `busy: { turn, queued, tasks }`,
   `waitingSince`.
2. **Настоящий старт.** Orchestrator свободен — `ownChecks` и `checkElsewhere` заново, `setUnattended(true)`, дальше
   цикл как сейчас. Отказ на этом шаге — `run-stopped` `start-refused` с текстом (новая причина в `cycle.ts`). Start
   window, budget и Limits (`boundaryCheck`, `run.ts:1551`) считают от этого момента: `startedAt` Run-а для них — время
   `orchestrator-free`. keep-awake (`deps.keepAwake()`, `power.ts`) включается тоже здесь (и при Start now), не при
   нажатии: пока Run ждёт, Mac может уснуть (решение владельца 2026-11-06, spec, «Открытые вопросы», 1).
3. **Cancel** (`Autopilot.cancel(projectId)` и канал; IPC `autopilot.stop` на ожидающем Run-е делает то же) —
   `run-stopped` `start-cancelled`; Orchestrator не трогается.
4. **Start now** (`Autopilot.startNow(projectId)`, канал `autopilot.startNow`, `write`): `Session.halt` и новый процесс
   сразу unattended, как `interruptAndGiveBack` (`run.ts:1998-2019`), но без возврата человеку; журнал — `tasks-killed`
   с причиной `start-now` и задачами, затем `orchestrator-free`. Сообщения очереди не отправляются: остаются за
   Session человека, как при возврате (`setUnattended(false)`).
5. **Старт из чата и просьба агента** — тем же путём: `startAfterTurn` и `waiting` удаляются, `orchestratorRefusal`
   больше не отказ; ответ tool-а — `Autopilot waits for the Orchestrator and starts when it is free`; отказ при
   настоящем старте — `lateRefusalNotice` в Session, попросившей старт.
6. **Строка Canvas**: `autopilotStatusLine` (`src/shared/ipc/autopilot.ts:221`) — `waiting for the Orchestrator · 4 min`.
7. **ADR.** Номер — `preflight` при claim. Новый ADR «Run принят и ждёт Orchestrator-а» (решение, Wait
   `orchestrator-busy`, Start now, Cancel; в «Considered Options» — старт без перезапуска, всегда останавливать задачи,
   отдельная Session, и окно подтверждения внутри приложения без защиты от клика агента — решение владельца
   2026-11-05). `## Amendments` в ADR-0029 (п. 5, последний пункт: новый старт не отклоняется, а ждёт) и в ADR-0091
   (отказы старта из чата из-за хода, задач и очереди заменены ожиданием).

## Готово, когда

- [ ] Contract test: Orchestrator в ходе — `start` отвечает состоянием `waitingFor: 'orchestrator'`, журнал
      `run-started`, `orchestrator-busy`; ход кончился — `orchestrator-free`, `wave-started`; Wave-команда ушла один раз.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · 6b6ff67de78b24219801fbe4d6a55345069e1ffd
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] Contract test: очередь из двух сообщений и две задачи — ждёт, пока очередь пуста и задач нет; новое сообщение
      человека во время ожидания продлевает ожидание.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · 6b6ff67de78b24219801fbe4d6a55345069e1ffd
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] Contract test: Cancel — `run-stopped` `start-cancelled`, Session не перезапускалась, сообщения на месте.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · 6b6ff67de78b24219801fbe4d6a55345069e1ffd
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] Contract test: Start now — `tasks-killed` `start-now` с задачами, Session unattended, Wave пошла; сообщения
      очереди не ушли в unattended Session и достались Session человека после остановки Run-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · 6b6ff67de78b24219801fbe4d6a55345069e1ffd
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] Contract test: Run того же Epic-а на другой Machine начался во время ожидания — `run-stopped` `start-refused`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · 6b6ff67de78b24219801fbe4d6a55345069e1ffd
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] Contract test: Run mode Start window — окно считается от `orchestrator-free` (часы test-а).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-wait.test.ts` exit 0 · mac - · 6b6ff67de78b24219801fbe4d6a55345069e1ffd
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] `test/contract/autopilot-start-tool.test.ts:592-654`: вместо «hint while a start waits» и «starts after this
      turn» — ожидание общим путём.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-start-tool.test.ts` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] e2e `test/e2e/autopilot.spec.ts:1161-1196` (toast отказа, worfy-polish 50) берёт за пример отказа Orchestrator в
      ходе: пример меняется на отказ, который остаётся (пустой шаблон «Run wave»), а Orchestrator в ходе даёт строку
      ожидания.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot.spec.ts` exit 0 · mac dev · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] Новый ADR и `## Amendments` в ADR-0029 и ADR-0091.
  - evidence: commit pass · Autopilot: a run started while the Orchestrator is busy waits for it (worfy-autopilot-queue 07) · - - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный. Ревью не ниже `high`.
  - evidence: gate pass · `gate fast` exit 0 · mac - · b4b4fa6e4279723cfb7afde9f53809e3221476a0
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6b6ff67de78b24219801fbe4d6a55345069e1ffd
  - evidence: review pass · PR #1499 · - - · 8f74215d3ba00e88478441ded4aab87818bca9e2
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42233850435 · ci - · 8f74215d3ba00e88478441ded4aab87818bca9e2

## Тесты

- Contract `test/contract/autopilot-wait.test.ts` (новый), setup — по образцу `harness()` из
  `test/contract/autopilot-background.test.ts`; fixture-ы `test/fixtures/agent-scripts/autopilot-wait-*.jsonl`.
- Unit `test/unit/autopilot-wait-line.test.ts` (новый) — строка `waiting for the Orchestrator`.
- Правка ожиданий отказов: `test/contract/autopilot.test.ts`, `test/contract/autopilot-wiring.test.ts`,
  `test/unit/autopilot-chat-start.test.ts`.
- Сначала падающий: старт при ходе — ожидалось состояние ожидания, сейчас отказ `ORCHESTRATOR_IN_TURN`.
- Прогнать `test/contract/autopilot*.test.ts`, `test/unit/autopilot-*.test.ts`.

## Где в коде

- `src/main/autopilot/run.ts`
- `src/main/agent/orchestrator.ts` (`busy`, правка отказов `:319-325`)
- `src/main/autopilot/chat-start.ts`
- `src/shared/autopilot/cycle.ts` (причины `start-cancelled`, `start-refused`)
- `src/shared/autopilot/journal.ts` (`orchestrator-busy`, `orchestrator-free`, причина `start-now` у `tasks-killed`)
- `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts` (`waitingFor: 'orchestrator'`, `autopilot.startNow`)
- `test/contract/autopilot-wait.test.ts`, `test/unit/autopilot-wait-line.test.ts`, `test/fixtures/agent-scripts/autopilot-wait-*.jsonl` (новые)
- `test/contract/autopilot.test.ts`, `test/contract/autopilot-wiring.test.ts`, `test/unit/autopilot-chat-start.test.ts`,
  `test/contract/autopilot-start-tool.test.ts`, `test/e2e/autopilot.spec.ts`
- `docs/adr/<номер>-run-waits-for-orchestrator.md` (новый), `docs/adr/0029-autopilot-waits-for-background-tasks.md`,
  `docs/adr/0091-autopilot-from-chat.md`

Только читать: `src/shared/flight-recorder/facts.ts`, `src/main/autopilot/chat-confirm.ts`.

## Итог

PR #1499. ADR-0099, `## Amendments` в ADR-0029 и ADR-0091. Старт при занятом Orchestrator-е (turn, очередь, живые
background tasks) больше не отказ: Run заводится сразу (`run-started`, `orchestrator-busy`) и ждёт; состояние
`waitingFor: 'orchestrator'` с `busy` и `waitingSince`, строка `waiting for the Orchestrator · N min`. Свободен —
`orchestrator-free`, проверки заново, `setUnattended(true)`; отказ здесь — `run-stopped` `start-refused` с `message`.
Cancel — Stop и Force stop на ожидающем Run-е (`start-cancelled`). Start now — канал `autopilot.startNow` →
`Orchestrators.takeNow` (`tasks-killed` `start-now`, очередь человека откладывается и возвращается придержанной).
Старт из чата — тем же путём: `startAfterTurn`, `whenIdle`, `orchestratorRefusal` удалены.

Сначала падающий: до правки все новые contract test-ы `autopilot-wait.test.ts` падали с
`The Orchestrator is in a turn: wait for it to end, or Interrupt it, before starting Autopilot`, unit
`autopilot-wait-line.test.ts` получал `waiting for limits`.

Решено без владельца:

- `startedAt` Run-а — время нажатия; Start window, budget и Limits смотрят на часы у Wave, то есть после
  `orchestrator-free`.
- Отдельного канала Cancel нет: его делает `autopilot.stop`; Force stop на ожидающем Run-е — тоже `start-cancelled`.
- Ожидание кончается после паузы `TASKS_GRACE_MS` за последней задачей, чтобы не оборвать turn от task-notification.
- В первую минуту строка без минут.
- Исходы Flight Recorder: `start-cancelled` → `stopped`, `start-refused` → `failed`.
- `ChatStartAnswer.kind` остаётся `'after-turn'` (его читает `chat-confirm.ts`, только чтение), текст новый.
- Политика Auto-approval открывается при нажатии, действует с момента, когда Run берёт Orchestrator.

Вне списка файлов: `src/shared/flight-recorder/from-journal.ts` (исходы новых причин, иначе typecheck),
`src/shared/flight-recorder/journal-walk.mjs` (новые виды событий), test-ы `agent-send-autopilot`,
`autopilot-background`, `autopilot-journal` (unit и contract), `flight-recorder-journal`, `link-access`.
Feature pages (`docs/features/autopilot.md`, `docs/features/ru/autopilot.md`) и `CONTEXT.md` (Run, Wait) обновлены в этом
же PR после merge worfy-auto-approve 10 (#1494).

Долг: кнопки Start now и Cancel в окне нет — только канал main; Flight Recorder ещё не показывает Wait
`orchestrator-busy` (`facts.ts` — только чтение в этом Ticket-е).

Раунд 2 (вердикт REJECTED на PR #1499). Шесть новых contract test-ов в `test/contract/autopilot-wait.test.ts`, каждый
падает на своём mutant-е из вердикта и проходит на коде: Start now на Run-е, который не ждёт, ничего не делает (без
guard-а `run.wait === null` — вторая Session, второй keep-awake); Force stop на ожидающем Run-е — `start-cancelled`;
отказ при взятии Orchestrator-а доходит до `onLateRefusal`; Orchestrator свободен, но человек написал до взятия — Run
снова ждёт (`orchestrator-busy`) и стартует после следующего конца turn-а; Run, который ждал, запускает Session под
своей политикой Auto-approval и с её TMPDIR; «Start anyway» на ожидающем Run-е проходит мимо run-а того же Epic-а на
Linked machine. Ещё три поведения раунда, test-ы сначала падали на старом коде: сообщение человека между чтением
`busy()` и ответом `setUnattended` в `start()` — Run ждёт, а не получает отказ; Run, вернувшийся в ожидание, снимает
свою политику (действует прежняя, если её run её не отпустил); `parks()` не считает ожидающий Run своим.
`Autopilot.cancel` удалён: вызывающих в приложении не было, Cancel — это Stop и Force stop (ADR-0099, п. 5 поправлен).
`Autopilot.startCheck` остаётся: приложение его больше не вызывает, но contract test Codex
(`codex-orchestrator.test.ts`, worfy-multi-vendor 39) проверяет им, что Run на Codex стартовал бы, не запуская его.
`agent-instructions.md` — новый ответ инструмента вместо «Autopilot starts after this turn»; feature pages: строка
отказа «старт из чата ждёт конца turn-а» удалена, journal открывается `run-started`, Start now может закончиться
`start-refused`, кнопки Start now в окне пока нет (и в `CONTEXT.md`); устаревшие комментарии в `chat-confirm.ts`,
`orchestrator.ts`, `ipc/agent.ts`, `session.ts`; ADR-0099 п. 3 ссылается на ADR-0029 п. 3.
