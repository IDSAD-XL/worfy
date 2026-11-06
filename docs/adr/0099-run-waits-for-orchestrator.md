# 0099 — Run принят и ждёт Orchestrator-а: Wait `orchestrator-busy`, Start now и Cancel
Дата: 2026-11-06. Статус: принят. Epic `worfy-autopilot-queue`, Ticket 07; spec — `.scratch/worfy-autopilot-queue/spec.md`
(«Старт при идущей работе», «Открытые вопросы», 1), Ticket карты 02; слово владельца 2026-11-05: «нельзя запустить
автопилот пока идет работа».

**Контекст.** Run (ADR-0024) берёт Orchestrator Project-а: `setUnattended(true)` перезапускает его Session без человека.
Пока Orchestrator в ходе, у него в очереди сообщения человека или идут background tasks, перезапуск оборвал бы эту работу,
поэтому `Autopilot.start` отказывал (`ORCHESTRATOR_IN_TURN`, `ORCHESTRATOR_HAS_QUEUE`, `ORCHESTRATOR_HAS_TASKS`;
ADR-0029, п. 5). Старт из чата (ADR-0091) обходил отказ за ход Orchestrator-а отдельным ожиданием `startAfterTurn`, а при
задачах и очереди тоже отказывал. Человек, закончив разговор, должен был вернуться и нажать кнопку ещё раз; ночью это
значит, что Run не начнётся совсем.

**Решение.**
1. **Run заводится с нажатия.** Проверки, которым Orchestrator не нужен (свой репозиторий в development-сборке, шаблон
   «Run wave», workflow, Epic и Ticket-ы, Run того же Epic-а и origin на Linked machine), идут, как раньше: отказ остаётся
   отказом, Run не заводится. Затем у Run-а сразу есть id, Journal (`run-started`) и состояние.
2. **Wait `orchestrator-busy`.** Если Orchestrator занят (`Orchestrators.busy(projectId)` → `{ turn, queued, tasks }`, те
   же три условия, что отказы `setUnattended`, с учётом Session, которая ждёт возврата человеку), Run ждёт: состояние
   `status: 'waiting'`, `waitingFor: 'orchestrator'`, `busy`, `waitingSince`; строка Canvas — `waiting for the
   Orchestrator · N min` (в первую минуту без минут). Run следит за событиями Session (`state`, `background_tasks`,
   очередь); Journal пишет `orchestrator-busy` в начале и при каждом изменении `{ turn, queued, tasks }`. Новое сообщение
   человека во время ожидания ожидание продлевает.
3. **Пауза после последней задачи.** Задачи кончились, а Orchestrator ещё не начал ход от `task-notification`: Run ждёт
   ту же паузу, что Run в конце Wave (`TASKS_GRACE_MS`, 2 минуты, ADR-0029, п. 4), и только потом считает его свободным.
   Иначе Run перезапускал бы Session в тот момент, когда она собирается ответить человеку о готовой задаче.
4. **Настоящий старт.** Orchestrator свободен — Journal пишет `orchestrator-free`, проверки п. 1 и проверка Linked machine
   идут заново, `setUnattended(true)`, дальше цикл как раньше. Отказ на этом шаге — `run-stopped` с причиной
   `start-refused` и текстом (`message`); старт из чата показывает его notice-ом в Session, которая просила старт
   (`lateRefusalNotice`, ADR-0091, п. 4). Start window, бюджет и Limits смотрят на часы у Wave, то есть уже после
   `orchestrator-free`; `startedAt` Run-а остаётся временем нажатия. keep-awake включается при настоящем старте
   (решение владельца 2026-11-06, spec, «Открытые вопросы», 1): пока Run ждёт, Mac может уснуть. Политика Auto-approval
   Run-а открывается при нажатии, а действует с момента, когда Run берёт Orchestrator.
5. **Cancel.** `Autopilot.cancel(projectId)`; Stop и Force stop на ожидающем Run-е делают то же (`autopilot.stop`,
   `autopilot.forceStop`). Journal — `run-stopped` с причиной `start-cancelled`. Orchestrator не трогается: ход, очередь и
   задачи человека остаются как были.
6. **Start now** (`Autopilot.startNow(projectId)`, канал `autopilot.startNow`, доступ `write`;
   `Orchestrators.takeNow`). Run не ждёт: Session останавливается (`Session.halt`) и сразу перезапускается без человека,
   как `interruptAndGiveBack`, но без возврата человеку. Journal — `tasks-killed` с причиной `start-now` и списком
   задач, затем `orchestrator-free`. Очередь человека не отправляется в Session без человека: она откладывается и
   возвращается Session человека после Run-а, придержанной (`paused`), как при обычном возврате (`setUnattended(false)`).
7. **Старт из чата идёт тем же путём** (ADR-0091, п. 4): `startAfterTurn`, `orchestratorRefusal` и ожидание в `ChatStarts`
   убраны. Ответ инструмента и команды для ожидающего Run-а — `Autopilot waits for the Orchestrator and starts when it is
   free`; следующий запрос, пока Run ждёт, получает обычный отказ «Autopilot is already running Epic X».
8. **Исходы.** В `AUTOPILOT_STOP_REASONS` две новые причины: `start-cancelled` (исход Flight Recorder — `stopped`) и
   `start-refused` (`failed`).

**Последствия.** Нажатие Autopilot больше не отказывает из-за занятого Orchestrator-а: Run ждёт, и это видно в строке
статуса и в Journal. Orchestrator человека ничего не теряет, пока Run ждёт; терять работу человек решает сам кнопкой
Start now. Run, ждущий долго, держит Project: второй Run того же Project-а получает отказ, пока первый не начался или не
отменён. Отказ при настоящем старте приходит позже нажатия, поэтому у него своя причина и текст в Journal.

## Considered Options

- **Старт без перезапуска: Run берёт Session человека как есть.** Отвергнуто: Session человека запущена с его режимом
  разрешений и без политики Auto-approval Run-а, а Run без человека требует своих; поменять их без нового процесса
  нельзя, поэтому `setUnattended` и перезапускает Session.
- **Всегда останавливать задачи при старте.** Отвергнуто: так нажатие убивает работу implementer-ов молча, ровно то, от
  чего защищает ADR-0029. Остановка задач остаётся явным выбором — Start now.
- **Отдельная Session для Run-а рядом с Session человека.** Отвергнуто: у Project-а один Orchestrator (ADR-0024), два
  агента над одним worktree и одной очередью Ticket-ов мешают друг другу.
- **Защита окна подтверждения от клика агента.** Старт, который просит агент (ADR-0091), подтверждает человек; Ticket 11
  этого Epic-а переносит подтверждение из системного окна в окно внутри worfy (без ADR, spec, «ADR»). Защиту от того,
  что агент сам нажмёт кнопку этого окна, не делаем: решение владельца 2026-11-05. Строка здесь, чтобы причина жила
  рядом с решением о старте.
- **Отказывать, как раньше, и предлагать нажать позже.** Отвергнуто: ночью некому нажать, Run не начнётся совсем.
