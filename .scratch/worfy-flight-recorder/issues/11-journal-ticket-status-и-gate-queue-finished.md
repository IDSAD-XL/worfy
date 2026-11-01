# 11 — Journal: `ticket-status` и `gate-queue-finished`

Type: task
Status: claimed 2026-11-01T01:35Z
Blocked by: 10
Source: [spec.md](../spec.md), «Источники и что меняется в них» («Новое в Journal — только два события», «Хранение»), «Решено без владельца» (ADR Ticket-а 11), «Ticket-ы» (11), «Решения владельца при приёмке», п. 1 (три необязательных поля), «Готово, когда» (пункт про Journal); решение 04, Q1, Q4, Q7, Q8 ([04-дыры-источников.md](04-дыры-источников.md)); решение 01, Q4 ([01-destination-единица-истории-хранение-id.md](01-destination-единица-истории-хранение-id.md))

## Что происходит

- Формат Journal — шапка-комментарий и схема `src/shared/autopilot/journal.ts` (`JOURNAL_EVENT_KINDS`, `:185`;
  `run-started` `:265`, `wave-started` `:267`, `gate-queue` `:279`, `run-stopped` `:280`). Пишет только worfy main,
  Journal не чистится.
- Файл Ticket-а хранит только текущий `Status:`. Истории статусов во время Run нет нигде; у Silent mode и Ticket-ов
  без PR других следов claim, блокировки и `done` нет.
- Autopilot уже подписан на `WorkflowHub` (`src/main/workflow/watch.ts`): `deps.watchWorkflow` в
  `src/main/autopilot/run.ts:671`, подписка — `workflowWatch`, `src/main/ipc/autopilot.ts:109`.
- Конец хода «Process gate queue» в Journal не пишется: есть только `gate-queue` в начале
  (`src/main/autopilot/run.ts:1004`); ход кончает `endGateQueue` (`:1028`).
- Session Orchestrator-а, которой ушла Wave, в Journal не записана: Wave может уйти новой SDK Session
  (`newUnattendedSession`), и найти её транскрипт можно только по тексту и времени (риск 1 spec-а). Кто начал Run и
  был ли это Run по названным Ticket-ам, Journal тоже не знает.

## Что делаем

1. **`ticket-status`** — новый вид: `ticket`, `state` (`claimed`, `blocked`, `done`, `open`), `statusAt?` (время
   строки `Status:`), `reason?` (`Blocked reason:`), `waits?` (`Waits:`). Пишет Autopilot из своего подписчика
   `WorkflowHub`, когда во время Run меняется статус Ticket-а Epic-а этого Run. Вне Run — ничего.
2. **`gate-queue-finished`** — новый вид: конец хода «Process gate queue», пишется в `endGateQueue` перед
   `run-stopped`.
3. **Три необязательных поля** в существующих событиях (приёмка, Q1), новых видов не добавляют:
   `wave-started.session` (id транскрипта Orchestrator-а, которой ушла Wave), `run-started.tickets` (названные
   Ticket-ы), `run-started.by` (`button`, `command`, `tool`). `tickets` — из списка `Autopilot.start` (Ticket 21,
   Wave 1); `by` — из параметра старта, по умолчанию `button`; `command` и `tool` передают Ticket-ы 22 и 23 через
   `startFromChat`. Поля необязательные: старый Journal без них читается как раньше.
4. Шапка-комментарий и схема `journal.ts` описывают оба вида и три поля; `journal-walk.mjs` (Ticket 10) их знает,
   `JOURNAL_KINDS` в ногу с `JOURNAL_EVENT_KINDS`.
5. **ADR** «история Run»: два новых события Journal, пишет только worfy main, Harness в Journal не пишет; шкала
   вычисляется при открытии из источников, своего индекса spans и копий нет (решение 01, Q4; решение 04, Q1, Q8;
   ADR-0002 не нарушен — Journal свой файл в папке данных). Номер — следующий свободный на момент claim
   (`docs/adr/`, открытые PR), заранее не резервируется.

Не входит: Harness и gate не меняются; observer `human-input` остаётся как есть (решение 04, Q5, Q8). Событие сна
Machine — не в этом Epic-е (приёмка, Q3).

## Готово, когда

- [x] Unit test схемы: `ticket-status` со всеми полями и только с обязательными проходит; `state` вне четырёх
      значений — отказ; `gate-queue-finished` проходит; старые строки `wave-started` и `run-started` без новых
      полей читаются как раньше.
- [x] Unit test `autopilot-run`: во время Run смена `Status:` Ticket-а Epic-а Run на `claimed`, `blocked` (с
      `Blocked reason:` и `Waits:`), `done` даёт по строке `ticket-status` с этими полями; Ticket другого Epic-а и
      смена вне Run — ни одной строки.
- [x] Unit test `autopilot-run`: ход «Process gate queue» — `gate-queue`, затем `gate-queue-finished`, затем
      `run-stopped`.
- [x] Unit test `autopilot-run`: `wave-started.session` — id Session, которой ушла Wave, и при новой SDK Session
      тоже; `run-started.by` — `button` для кнопки и значение параметра старта иначе; `run-started.tickets` —
      названные Ticket-ы, без списка поля нет.
- [x] Contract test: Run во временной `WORFY_DATA_DIR` пишет новые строки в `<data dir>/autopilot/<run>.jsonl`,
      `listRuns` и `readRun` их читают.
- [x] `journal-walk.mjs` понимает оба вида; `test/unit/critical-path.test.ts` зелёный, отчёт скрипта на fixture не
      изменился.
- [x] Других новых видов в Journal нет: `JOURNAL_EVENT_KINDS` дополнен ровно двумя значениями; в `harness/` и
      gate изменений нет.
- [x] ADR о `ticket-status` и шкале, вычисляемой при открытии, в `docs/adr/` с номером, свободным на момент claim.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/autopilot-journal.test.ts`: схема двух видов и трёх полей.
- Contract `test/contract/autopilot-journal.test.ts`: запись и чтение во временной папке данных.
- Unit `test/unit/autopilot-run.test.ts`: запись из подписчика `WorkflowHub` и в `endGateQueue`, поля `session` и
  `by`.
- Сначала падающий: unit test `autopilot-run` — смена `Status:` на `claimed` во время Run не даёт строки
  `ticket-status`.
- Прогнать все unit и contract test-ы модуля Autopilot: `test/unit/autopilot-*.test.ts` (`budget`, `cycle`,
  `journal`, `limits-estimate`, `origin`, `power`, `resume-at`, `run`) и `test/contract/autopilot*.test.ts`
  (`autopilot`, `-background`, `-journal`, `-limits`, `-wiring`), и `test/unit/critical-path.test.ts`.

## Где в коде

- `src/shared/autopilot/journal.ts`
- `src/main/autopilot/run.ts` (`:671` — подписчик `WorkflowHub`; `endGateQueue`, `:1028`)
- `src/shared/flight-recorder/journal-walk.mjs`, `journal-walk.d.mts`
- `docs/adr/<NNNN>-run-history.md` (новый)
- `test/unit/autopilot-journal.test.ts`
- `test/contract/autopilot-journal.test.ts`
- `test/unit/autopilot-run.test.ts`

Только читать: `src/main/workflow/watch.ts` (`WorkflowHub`), `src/main/ipc/autopilot.ts` (`workflowWatch`, `:109`),
`src/main/autopilot/journal.ts` (`listRuns`, `readRun`), `docs/adr/0002-worfy-is-a-view-over-the-workflow.md`,
`docs/adr/0005-worfy-own-state-inventory.md`.

## Итог

- Формат: `src/shared/autopilot/journal.ts` — шапка-комментарий описывает оба вида и три поля; схема: `run-started`
  с `by?` (`button`, `command`, `tool`) и `tickets?` (`:303`), `wave-started.session?` (`:305`), `ticket-status`
  (`:306`, `state` — ровно четыре значения `TICKET_STATUS_STATES`), `gate-queue-finished` (`:319`).
  `JOURNAL_EVENT_KINDS` дополнен ровно двумя значениями.
- `ticket-status` пишет подписчик `WorkflowHub`: callback watch-а читает модель через `readAndFeed(..., true)`
  (`src/main/autopilot/run.ts:1056`), `statusChanges` (`:444`) сравнивает статус каждого Ticket-а Epic-а Run
  (состояние вместе с `statusAt`, `Blocked reason:`, `Waits:`) с прошлым чтением. Первое чтение — при старте (`:755`),
  поэтому статус до Run строки не даёт; после остановки `readAndFeed` ничего не читает. `work` пишется как `claimed`,
  `none` — без строки. Чтения после хода и для бюджета строк не пишут — только watch, как в ticket-е.
- `gate-queue-finished` — первая запись `endGateQueue` (`:1175`), перед `run-stopped`, при любом конце хода
  (и Stop, и Force stop, и пропавшая Session).
- `wave-started.session` — `run.session.sdkId ?? run.session.id` (`:1095`): у Session, возобновлённой из транскрипта,
  id worfy до init Claude Code — `pending-…`, поэтому в `RunSession` добавлено необязательное `sdkId` (`:155`, его
  отдаёт `Session.sdkId`). У новой SDK Session id и есть id транскрипта.
- `run-started.by` и `run-started.tickets` (`:767`) берутся из `Run.by` и `cycle.named` Ticket-а 21. `openRun`
  (`src/main/autopilot/journal.ts:126-127`) пишет их в строку `run-started`: без этой правки файла, которого нет в
  «Где в коде», поля не попали бы в Journal.
- `src/shared/flight-recorder/journal-walk.mjs`: оба вида в `JOURNAL_KINDS` (`:13`), проверка полей `ticket-status`
  (`:46`). `walkRun` новые виды не трогает: отчёт `scripts/critical-path.mjs` на fixture не изменился
  (`test/unit/critical-path.test.ts` зелёный). `.d.mts` правки не потребовал: новых экспортов нет.
- ADR-0092 «История Run» — `docs/adr/0092-run-history.md`. Страница `docs/features/autopilot.md`: таблица видов Journal.
- Test-ы: `test/unit/autopilot-run.test.ts` — блоки `ticket-status` (`:2225`), `gate-queue-finished` (`:2304`),
  `by`/`tickets`/`session` (`:2319`), Session новой SDK Session (`:1562`); прежние ожидания gate queue и Linked
  machines дополнены `gate-queue-finished` и `by: 'button'`, два test-а worfy-week ticket 18 — строками
  `ticket-status` из чтения watch. `test/unit/autopilot-journal.test.ts:79-115`, `test/contract/autopilot-journal.test.ts:223`.
  Mutation testing вручную: 17 мутантов `run.ts`, `journal.ts`, `journal-walk.mjs`, `openRun` — все убиты.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (532 файла test-ов).
- Не проверено: живой Run в приложении (GUI-проверок в ticket-е нет); что watch успевает сообщить о последнем `done`
  до `run-stopped` — при гонке строка теряется, время остаётся в `Status:` файла Ticket-а (ADR-0092, «Цена»).
