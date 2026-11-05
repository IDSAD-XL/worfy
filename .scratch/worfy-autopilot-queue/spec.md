# worfy-autopilot-queue: Autopilot стартует, пока идёт работа, и ведёт очередь Epic-ов

Status: ждёт приёмки владельцем. Решения grilling-а 2026-11-05 (Ticket-ы карты 01–03, раунды 1 и 2) и прототип окна
запуска приняты владельцем; нарезка на Ticket-ы и Wave-ы — нет. До приёмки Ticket-ы 07–20 не раздаются.
Source: слово владельца 2026-11-05: «нельзя запустить автопилот пока идет работа»; «запускать автопилот не только по
одному эпику»; новое требование того же дня — системное окно подтверждения старта заменить окном внутри worfy;
[map.md](map.md) и Ticket-ы карты [01](issues/01-destination-и-масштаб.md), [02](issues/02-старт-при-идущей-работе.md),
[03](issues/03-очередь-epic-ов.md); прототип окна запуска — Card `card-918c77d9` (раздел «Окно запуска»);
[CONTEXT.md](../../CONTEXT.md), термины Autopilot, Run, Run mode, Wait, Orchestrator, Session, Background task, Wave,
Epic, Linked machine, Vendor; ADR [0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0029](../../docs/adr/0029-autopilot-waits-for-background-tasks.md),
[0050](../../docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md),
[0091](../../docs/adr/0091-autopilot-from-chat.md), [0092](../../docs/adr/0092-run-history.md),
[0093](../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md).
Ticket-ы: Epic `worfy-autopilot-queue`, Ticket-ы 07–20 (01–06 — Ticket-ы карты, все `done`). Шапка — `Type:` / `Status:` /
`Blocked by:` / `Source:`, как у worfy-retry. Спутник — spec [worfy-work-track](../worfy-work-track/spec.md) той же
карты: свой Epic, раздаётся параллельно.

**Старт Epic-а — после merge worfy-retry 04, 05 и 14** (14 — Ticket Run-а, умершего с Ticket-ом в `claimed`, перенесён
из worfy-faults 09): все они правят `src/main/autopilot/run.ts`, `cycle.ts` и журнал, как Ticket-ы 07, 08 и 14 этого
Epic-а. Ticket 19 (документация) — после Ticket-а worfy-feature-docs, который делит `docs/features/autopilot.md`.

## Цель

Сегодня Autopilot стартует только с пустого Orchestrator-а:

- **Занятый Orchestrator — отказ.** `Orchestrators.setUnattended` отказывает, пока идёт ход
  (`ORCHESTRATOR_IN_TURN`, `src/main/agent/orchestrator.ts:213`, проверка `:319`), пока живы фоновые задачи
  (`ORCHESTRATOR_HAS_TASKS`, `:219`, проверка `:324`) и пока в очереди сообщения (`ORCHESTRATOR_HAS_QUEUE`, `:216`,
  проверка `:325`). Старт из чата спрашивает то же заранее (`orchestratorRefusal`, `src/main/autopilot/chat-start.ts:47-52`)
  и умеет ждать только конец хода, который сам попросил старт (`ChatStarts.waiting`, `:98`; `startAfterTurn`, `:140`).
  Владелец днём почти всегда работает с Orchestrator-ом: чтобы оставить Autopilot на ночь, ему приходится ждать
  тишины и нажимать снова.
- **Run, остановленный ошибкой при живых задачах, держит Session без человека**, пока задачи не кончатся
  (ADR-0029, п. 5; `linger`, `src/main/autopilot/run.ts:1975-1976`, `:2030`). 2026-11-03 так Session осталась
  unattended после остановки, и владелец не мог ею пользоваться.
- **Один Epic на Run.** `Run.epic` (`run.ts:682`), `CycleState.epic` (`src/shared/autopilot/cycle.ts:81`,
  `initialCycle` `:173`), один Run на Project (`Autopilot.starting`, `run.ts:741`), MCP tool `{epic, tickets?}`
  (`src/shared/canvas/tools.ts:87-90`), команда чата (`src/shared/autopilot/chat-command.ts:5-13`), поле `epic` каждой
  строки журнала (`src/shared/autopilot/journal.ts:416`). Принятых Epic-ов к вечеру обычно несколько; ночью Autopilot
  кончает один и стоит.
- **Подтверждение просьбы агента — системное окно** (`dialog.showMessageBox`, `src/main/autopilot/chat-confirm.ts:127-145`,
  кнопки `confirmationOptions`, `:103-121`): кнопки — только Run mode-ы, прогноз — строками текста, очередь и занятость
  Orchestrator-а показать негде. Кнопка Autopilot на Canvas стартует сразу, без окна
  (`src/renderer/canvas/actions/AutopilotAction.tsx:445`).

## Что видит владелец

1. **Окно запуска внутри worfy.** Кнопка Autopilot на рамке Epic-а и просьба агента (`autopilot_start`) открывают одно
   окно (прототип `card-918c77d9`): Project; Epic или очередь Epic-ов; Ticket-ы и сколько Wave осталось; Vendor
   Orchestrator-а; прогноз (время и токены) против budget; Limits сейчас; Modes (Eco mode, Auto-approval,
   Auto-continue — только чтение, ссылка «change in Modes»); выбор Run mode (Fastest, Budget-aware, Start window;
   по умолчанию — из Settings). У просьбы агента — кто просит («Asked by Session "…" in a chat») и обратный отсчёт
   10 минут; время вышло — Session получает отказ. Фокус — на Cancel, Esc закрывает, ⌘↩ запускает. Команда в чате
   (`/worfy:epic-wave …`) стартует без окна, как сейчас.
2. **Orchestrator занят — Run принят и ждёт.** В окне — уведомление «The Orchestrator is busy: a turn is running · 2
   queued messages · 3 background tasks. Autopilot will wait and start when it is free.», основная кнопка — «Start when
   free». После неё окно закрывается, а строка Autopilot на Canvas показывает «waiting for the Orchestrator · 4 min» с
   кнопками «Start now» и «Cancel». Ожидание без предела. Сообщение человека Orchestrator-у ожидание продлевает
   (новый ход — снова работа); отменяет только Cancel.
3. **Start now.** Маленькое окно «Start now?» перечисляет, что остановится: идущий ход, фоновые задачи по именам; и что
   останется: сообщения в очереди. Красная кнопка «Interrupt and start» прерывает ход и задачи так же, как Stop
   (ADR-0050), и Run стартует сразу.
4. **Очередь Epic-ов.** Run можно начать над списком Epic-ов: командой чата, MCP tool-ом со списком или действием «Run all
   accepted» — все принятые владельцем Epic-и с готовыми Ticket-ами, по дате принятия. В окне запуска очередь до старта
   правится: снять галочку, перетащить. Run идёт по Epic-ам по порядку; строка Autopilot — «Epic 2/3: worfy-retry ·
   Wave 1». Между Wave-ами в очередь можно добавить Epic в конец или убрать ещё не начатый.
5. **Epic, где остались только Ticket-ы владельца** (приёмка, `Waits: owner`, «не в Autopilot»), Run пропускает с
   записью в журнал и идёт дальше; строка Epic-а в очереди — «Ждёт владельца». Красный CI на main и `limits-timeout`
   останавливают весь Run.
6. **Run, остановленный ошибкой, сразу отдаёт Session человеку.** Фоновые задачи не убиваются; строка Autopilot и
   журнал их называют.
7. **Run history.** Одна строка на Run со списком его Epic-ов; ожидание Orchestrator-а — Wait с причиной
   «Orchestrator busy»; границы Epic-ов видны на шкале.

## Решения владельца

Grilling 2026-11-05: раунд 1 — «по остальному все да» (все рекомендации), раунд 2 — «1-10 согласен», прототип окна
запуска — «посмотрел прототип, все устраивает». Полные формулировки — в Ticket-ах карты
[02](issues/02-старт-при-идущей-работе.md) и [03](issues/03-очередь-epic-ов.md), раздел «Решения владельца 2026-11-05».

| № | Вопрос | Решение | Ticket |
| --- | --- | --- | --- |
| 1 | Что Run ждёт | Только ход Orchestrator-а, его очередь сообщений и его фоновые задачи; не другие Session, Terminal, gate | 07 |
| 2 | Очередь сообщений | Run ждёт, пока она опустеет; сообщения не отправляет и не удаляет | 07 |
| 3 | Человек пишет во время ожидания | Ожидание продлевается; отменяет только Cancel | 07 |
| 4 | Start now, Cancel, предел | Start now после подтверждения прерывает как Stop (ADR-0050); Cancel есть; предела нет | 07, 10 |
| 5 | Причина ожидания | Новая причина Wait `orchestrator-busy` | 07, 18 |
| 6 | Start window, budget, Limits | От настоящего старта, не от нажатия | 07 |
| 7 | Остановка ошибкой при живых задачах | Session сразу человеку; задачи живут и названы | 08 |
| 8 | Отказы кнопки Canvas | Четыре отказа — toast-ом; занятый Orchestrator — ожидание | 07, 09 |
| 9 | Просьба из Session без человека | Остаётся отказом | 11 |
| 10 | Окно подтверждения | Окно внутри worfy вместо системного; одно для кнопки и для `autopilot_start`; команда чата — без окна | 09, 11 |
| 11 | Содержимое окна | Как прототип `card-918c77d9` (список — «Что видит владелец», п. 1) | 09, 11 |
| 12 | Ожидание после окна | Строка Autopilot со «Start now» (окно со списком того, что остановится) и «Cancel» | 10 |
| 13 | Клавиатура | Фокус на Cancel, Esc закрывает, ⌘↩ запускает | 09 |
| 14 | Защита от клика агента по окну | Не нужна; вопрос не поднимать | 11 |
| 15 | Выбор прототипа | «Start when free» основная при занятом; «Interrupt and start» красная (нового цвета в F-SPEC ещё нет); Run mode по умолчанию — из Settings | 09, 10 |
| 16 | Как задаётся очередь | Команда чата, MCP tool со списком, «Run all accepted»; принятый = spec принят владельцем + есть готовые Ticket-ы; порядок — владельца или по дате принятия; до старта — снять галочку и перетащить | 13, 15, 16 |
| 17 | Правка во время Run-а | Между Wave-ами — добавить в конец, убрать не начатый; переставлять нельзя | 14, 17 |
| 18 | Переход к следующему Epic-у | Все Ticket-ы `done`; остались только Ticket-ы владельца — пропуск с журналом и «Ждёт владельца» | 12, 14 |
| 19 | Названные Ticket-ы | Только у Run-а из одного Epic-а | 14, 15 |
| 20 | Остановки | Красный CI main и `limits-timeout` — весь Run; конец Epic-а — к следующему | 12, 14 |
| 21 | Журнал и виды | Одна строка Run-а со списком Epic-ов; события `epic-started`, `epic-finished`; строка «Epic 2/3: имя» | 14, 17, 18 |
| 22 | Слово «Run» | Новое определение (раздел «Термины») | этот PR |
| 23 | Codex и budget Wave | Без изменений | — |

## Окно запуска (прототип)

Прототип принят как есть: Card `card-918c77d9` на Canvas Project-а worfy,
`~/Library/Application Support/worfy/CanvasForAI-a2cd477b/cards/card-918c77d9/index.html` (HTML, 900×760, обе темы).
В репозиторий файл не копируется: `rules.md` держит в `.scratch/<epic>/evidence/` только снимки PNG; снимок окна
кладёт Ticket 09 в своё «Итог». Шесть состояний прототипа (переключатель «State» сверху):

- **Agent asks** — заголовок «Start Autopilot», под ним «Asked by Session "canvasforai-0c" in a chat · answer within
  9:59» (отсчёт; последняя минута — цветом блокировки); время вышло — «time is up — the Session got "declined"».
- **Canvas button** — «From the Autopilot button on the Canvas».
- **Queue** — «Start Autopilot · 3 Epics, 6 Waves»; список Epic-ов с галочкой, номером, числом Wave и датой принятия;
  «Ordered by acceptance date · drag to reorder, untick to drop»; ⌥↑/⌥↓ двигает строку с клавиатуры; прогноз
  пересчитывается по отмеченным.
- **Orchestrator busy** — блок уведомления цветом блокировки (текст — «Что видит владелец», п. 2) и строка «Start now
  (later, from the Autopilot line) interrupts the turn and stops the background tasks.»; кнопка — «Start when free».
- **Start now** — малое окно (460 px): «Start now? Autopilot worfy-faults starts right away. This stops:» — «✕ the
  running turn», «✕ 3 background tasks: impl-04, verify-06, gh run watch …», «✓ 2 queued messages stay in the queue»;
  кнопки Cancel и «Interrupt and start» (красная).
- **Waiting line** — строка Autopilot над Canvas: «Autopilot · worfy-faults · waiting for the Orchestrator 4 min ·
  Start now · Cancel».

Сетка фактов окна (два столбца, подписи слева): Project, Epic, Tickets («07, 09 · 2 Waves left»), Orchestrator («Claude
Code vendor · Session canvasforai-dc»), Forecast («≈ 1 h 40 min · ≈ 2.1 M tokens of 6 M budget» и полоса), Limits now
(«weekly 38 % used»), Modes (три чипа и «change in Modes»). Ниже — Mode: сегменты Fastest / Budget-aware / Start window
с пометкой «(default)» и строкой пояснения под ними. Низ: подсказка клавиш «esc Cancel · tab next · ⌘ ↩ Start», Cancel,
основная кнопка. Цвета, радиусы и тени — токены F-SPEC (те же переменные, что в прототипе); новый — только красный
`--danger` для «Interrupt and start».

## Как работает

### Run принят и ждёт (Ticket 07)

- `Autopilot.start` (`run.ts:848`) больше не отказывает из-за занятого Orchestrator-а. Проверки, которым Orchestrator не
  нужен (`ownChecks`, `run.ts:935-944`: dev-сборка worfy на своём репозитории, пустой шаблон «Run wave», Vendor без
  гарантий Harness-а; Run того же Epic-а на Linked machine — `checkElsewhere`, `:982`), идут как сейчас и остаются
  отказами (toast кнопки уже есть — `refused`, `AutopilotAction.tsx:229-232`, worfy-polish 50).
- Run создаётся при нажатии: свой id, `run-started` в журнале, строка в Run history. Пока Orchestrator занят — ход идёт,
  в очереди сообщения или живы его фоновые задачи (те же три условия, что `orchestrator.ts:319-325`), — Run в фазе
  ожидания: журнал пишет `orchestrator-busy` (`turn`, `queued`, `tasks`) в начале и при каждом изменении, состояние
  Autopilot — `waitingFor: 'orchestrator'`, строка Canvas — «waiting for the Orchestrator · N min».
- Orchestrator свободен (ход кончился, очередь пуста, задач нет) — `orchestrator-free`, проверки `ownChecks` и
  `checkElsewhere` заново, затем `setUnattended(true)` (`run.ts:880`) и первая Wave. Start window, budget и Limits
  (`boundaryCheck`, `run.ts:1551`) считаются от этого момента. Отказ на этом шаге — `run-stopped` с причиной
  `start-refused` и текстом отказа; человеку — toast, Session-у, попросившей старт, — notice (`lateRefusalNotice`
  сегодня).
- Старт из чата и просьба агента идут тем же путём: особый случай «ждать конец своего хода» (`ChatStarts.waiting`,
  `chat-start.ts:98`, `AFTER_TURN_MESSAGE`, `:31`) становится общим ожиданием; ответ tool-а — «Autopilot waits for the
  Orchestrator and starts when it is free».
- **Cancel** ожидающего Run-а — `run-stopped` с причиной `start-cancelled`; Orchestrator не трогается.
- **Start now** — то, что делает Force stop с Session (`interruptAndGiveBack`, `run.ts:1998`: `Session.halt`, затем новый
  процесс), но новый процесс сразу unattended: журнал — `tasks-killed` с причиной `start-now` и списком задач, затем
  `orchestrator-free`. Сообщения очереди Run не отправляет: они ждут и переходят к Session человека, когда Run её вернёт
  (как сегодня при возврате, `setUnattended(false)`).
- Закрытие приложения во время ожидания — `run-stopped` `app-quit`, как у идущего Run-а.

### Остановка ошибкой отдаёт Session сразу (Ticket 08)

Сегодня Run, остановленный при живых задачах или идущем ходе, оставляет Session unattended до их конца (`end`,
`run.ts:1975-1978`; `setUnattended(false)` с `wanted = ATTENDED`, `orchestrator.ts:298-312`): перезапуск процесса убил
бы задачи (ADR-0029). Новое: при любой остановке, кроме `user-stop` (человек сам выбрал «доделать Wave и
остановиться»), `user-force-stop` и `app-quit`, Session становится attended **без перезапуска процесса**: Session
меняет `launch` на attended (сейчас `readonly`, `src/main/agent/session.ts:175`) и permission mode на сохранённый для
Node через seam Vendor-а `setPermissionPreset` (`src/main/vendors/session.ts:106`; Claude Code — `setPermissionMode` живого
процесса, `src/main/vendors/claude/session.ts:251-254`; Codex — с следующего `turn/start`,
`src/main/vendors/codex/session.ts:344`). Задачи живут; журнал пишет `orchestrator-returned` с их списком (`tasks`),
строка Autopilot — «stopped: turn error · 3 background tasks still run». Если смена в живом процессе не удалась —
сегодняшнее поведение (ждать задачи), строка говорит почему. Нужна поправка ADR-0029, п. 5.

### Окно запуска (Ticket-ы 09, 11)

- Модуль renderer-а `src/renderer/autopilot/StartAutopilotModal.tsx` по образцу окон Linked machine
  (`MachineDialogFrame`, `src/renderer/machines/ChangeAddressDialog.tsx:30-60`: portal, `role="dialog"`, `aria-modal`,
  Esc) и их хозяина в `AppShell` (`<MachineDialogs />`, `src/renderer/shell/AppShell.tsx:124`).
- Факты окна — новый канал чтения `autopilot.prepare` (`projectId`, `epics`, `tickets?`): Ticket-ы и Wave-ы осталось,
  Vendor, прогноз (`epicForecast` + `dialogLines`, как `forecastLines`, `chat-confirm.ts:217-228`), budget, Limits, Modes,
  Run mode по умолчанию, занятость Orchestrator-а (ход, число сообщений, задачи по именам). Те же источники, что у
  системного окна сегодня (`appAutopilotStarter`, `chat-confirm.ts:271-313`).
- Кнопка Canvas (Ticket 09) открывает окно вместо `start` (`AutopilotAction.tsx:445`); «Start Autopilot» / «Start when
  free» зовёт `autopilot.start` с выбранным Run mode.
- Просьба агента (Ticket 11): seam `confirm` в `appAutopilotStarter` (`chat-confirm.ts:294-297`) вместо
  `confirmAutopilotStart` шлёт событие окну этой Machine (`dialogOwner`, `:157`) и ждёт ответ 10 минут
  (`CONFIRM_WAIT_MS`); ответы — те же (`Confirmation`: Run mode, `cancel`, `timeout`, `no-window`). Нет окна worfy —
  `no-window`, как сейчас. Экран Linked machine окна агента не получает (как сейчас); кнопка Canvas на Linked machine с
  Full access открывает окно у себя (факты — через link).

### Очередь Epic-ов (Ticket-ы 12–17)

- **Правило** (Ticket 12, чистый модуль `src/shared/autopilot/epic-queue.ts`): по причине остановки цикла Epic-а и
  Ticket-ам решает «следующий Epic», «пропустить Epic: ждёт владельца» или «остановить Run». Конец Epic-а сегодня —
  `no-ready-wave` при всех `done` или `tickets-done` у названных (`nothingReady`, `cycle.ts:230-234`). Пропуск —
  `blocked-tickets` / `no-ready-wave`, где каждый открытый Ticket ждёт владельца (`Waits: owner`, приёмка, «не в
  Autopilot»). Любая другая причина — стоп всего Run-а: `limits-timeout`, ошибки, Stop, и красный CI на main (Harness не
  раздаёт Ticket-ы, Run видит `no-progress` или `wave-unfinished`).
- **Run** (Ticket 14): `Run` держит список Epic-ов и номер текущего; цикл (`initialCycle`) заводится заново на каждый
  Epic; `epic` каждой строки журнала — текущий Epic; `run-started` получает `epics`; новые события `epic-started`
  (`index`, `of`) и `epic-finished` (`outcome`: `done` | `waits-owner` | `elsewhere` | `removed`, `tickets?`);
  `queue-changed` (`added`, `removed`) при правке между Wave-ами. Run того же Epic-а на другой Machine
  (`checkElsewhere`) проверяется для каждого Epic-а при его начале; занят — пропуск с `elsewhere`. Названные
  Ticket-ы — только при одном Epic-е. Budget и Run mode — общие на весь Run, прогноз — сумма Wave по Epic-ам.
- **Принятые Epic-и** (Ticket 13): `epic-status --json` (Harness) отдаёт для Epic-а строку `Status:` spec-а и дату
  принятия; принятый — `Status:` начинается с «принят владельцем», «утверждён владельцем» или «по решению владельца»
  и несёт дату; плюс есть хотя бы один готовый Ticket (`readyWave`). worfy не разбирает spec сам (ADR-0002).
- **Точки входа** (Ticket-ы 15, 16): MCP tool `autopilot_start` — `epics: string[]` (1–10) вместо `epic` (старое поле
  остаётся как список из одного); команда чата `/worfy:epic-wave epics A, B, C`; «Run all accepted» — Command palette.
- **Виды** (Ticket-ы 17, 18): строка Autopilot «Epic 2/3: <имя> · Wave 1»; в меню «⋯» — «Add to queue…», «Remove from
  queue», «Run all accepted»; Run history — строка Run-а и заголовок со списком Epic-ов, фильтр Epic-а находит Run,
  в чьей очереди он есть (`RunHistoryView.tsx:23-24`, `:96`, `:109-111`; `listRuns`, `src/main/autopilot/journal.ts:173-197`).

## Что уже есть (переиспользуем)

- Отказ кнопки Canvas — уже toast (`refused`, `AutopilotAction.tsx:222-232`, worfy-polish 50). Из Q2 Ticket-а 01 эта
  часть сделана.
- Ожидание конца своего хода у старта из чата (`ChatStarts`, `chat-start.ts:96-193`, `whenIdle` `:205-222`) —
  основа ожидания Ticket-а 07.
- Прерывание хода и задач по Force stop (`interruptAndGiveBack`, `run.ts:1998-2019`), журнал `tasks-killed`.
- Прогноз и строки окна: `epicForecast`, `remainingWaves`, `dialogLines` (`forecastLines`, `chat-confirm.ts:217-228`).
- Ожидание как Span с причиной (`WAIT_CAUSES`, `src/shared/flight-recorder/facts.ts:29`; разбор журнала —
  `src/shared/flight-recorder/from-journal.ts:296-345`).
- Образец окна в приложении — `MachineDialogFrame` и `RemoveMachineDialog` (`src/renderer/machines/MachineDialogs.tsx:24`).

## Решено без владельца

Отмечено «решено без владельца, подтвердить»; владелец подтверждает при приёмке spec-а.

1. **Run существует с нажатия**: id, `run-started` и строка в Run history появляются сразу; ожидание — первый Wait
   Run-а. Иначе ожидание не видно в Run history (решение Q2 Ticket-а 01).
2. **Новые события журнала**: `orchestrator-busy`, `orchestrator-free`, `epic-started`, `epic-finished`,
   `queue-changed`; новые причины `run-stopped` — `start-cancelled`, `start-refused`; причина `tasks-killed` —
   `start-now`. Хранилище то же (ADR-0092 не меняется: журнал Run-а и так пополняется событиями по Ticket-ам).
3. **Сообщения очереди при Start now** не уходят в unattended Session: ждут и достаются Session человека после Run-а
   (прототип: «2 queued messages stay in the queue»).
4. **Второй старт, пока Run ждёт или идёт**, — отказ, как сейчас (`alreadyRunning`, `run.ts:457`), с подсказкой «Add to
   queue» в меню «⋯»; MCP tool и команда чата Epic в очередь не добавляют.
5. **Какие остановки отдают Session сразу** — все, кроме `user-stop`, `user-force-stop` и `app-quit` (Q7 говорит «ошибкой»;
   нормальный конец Wave живых задач не оставляет — ADR-0029, п. 2).
6. **Epic занят на другой Machine** в середине очереди — пропуск с `epic-finished` `elsewhere`, не стоп Run-а.
7. **Окно на Linked machine**: просьба агента — только на окнах Machine Project-а (как `dialogOwner` сегодня); кнопка —
   там, где нажата.
8. **Предел очереди** — 10 Epic-ов: новая константа рядом с `AUTOPILOT_TICKETS_MAX` (`src/shared/canvas/tools.ts:56`).
9. **Тексты в коде — английские** (ADR-0074), документы — русские.

## ADR

Правила — `rules-adr.md`: один ADR на решение, номер — при claim через `preflight`, принятый текст не переписывается,
изменение — раздел `## Amendments` в конце.

- **Новый ADR «Run принят и ждёт Orchestrator-а»** — пишет Ticket 07. Отменяет «новый старт отклоняется, пока
  Orchestrator не вернулся» (ADR-0029, п. 5, последний пункт) и отказы ADR-0091 из-за хода, задач и очереди; вводит
  Wait `orchestrator-busy`, Start now и Cancel. Тот же Ticket дописывает `## Amendments` в ADR-0029 и ADR-0091 со
  ссылкой на новый ADR.
- **Новый ADR «Run ведёт очередь Epic-ов»** — пишет Ticket 14: очередь в одном Run-е, правило перехода и пропуска, стопы
  на весь Run, события журнала, принятый Epic через `epic-status`. Отдельный файл — правило «одно решение на файл».
- **Поправка ADR-0029, п. 5** — Ticket 08: остановка, кроме `user-stop`, отдаёт Session без перезапуска, задачи живут.
- **ADR-0092 не меняется**: своего хранилища нет, новые события пишутся в тот же журнал Run-а.
- **Окно внутри приложения вместо системного — без ADR.** Системное окно было ответом владельца Q2 Ticket-а
  worfy-flight-recorder 23 и записано только в шапке `chat-confirm.ts:13-21`; ADR его не закреплял, и `rules-adr.md` не
  требует ADR на вид подтверждения. Ticket 11 переписывает шапку модуля: окно в приложении, 10 минут, только Machine
  Project-а, защиты от клика агента нет по решению владельца 2026-11-05. Строка об этом идёт и в «Considered Options»
  ADR Ticket-а 07, чтобы причина жила рядом с решением о старте.

## Термины

- **Run** (меняется, в `CONTEXT.md` этим PR): «Один запуск Autopilot: от старта до остановки ведёт Wave-ы одного Epic-а
  или очереди Epic-ов по порядку…»; _Avoid_: сессия Autopilot, прогон, trace.
- **Причина Wait `orchestrator-busy`** — Run принят и ждёт, пока у Orchestrator-а кончатся ход, очередь сообщений и
  фоновые задачи. В `CONTEXT.md` (термин Wait, список причин) — Ticket 19.
- **Очередь Epic-ов** — термина не заводим: это свойство Run-а («Run над очередью Epic-ов»), а не новая сущность.
  _Avoid_ в тексте UI: batch, playlist.

## Ticket-ы

- **07 — Run принят и ждёт Orchestrator-а.** Ожидание, Start now и Cancel в main; журнал; новый ADR. Blocked by: —.
- **08 — Run, остановленный ошибкой, сразу отдаёт Session человеку.** Без перезапуска, задачи живут. Blocked by: 07.
- **09 — Окно запуска Autopilot в приложении: кнопка Canvas.** Окно, канал `autopilot.prepare`, e2e-helper. Blocked by: 07.
- **10 — Строка Autopilot: ожидание, Start now и Cancel.** Малое окно Start now. Blocked by: 07, 09.
- **11 — Просьба агента — в окне приложения вместо системного.** Blocked by: 09.
- **12 — Правило очереди Epic-ов.** Чистая функция: дальше, пропуск или стоп. Blocked by: —.
- **13 — Принятые Epic-и: статус spec-а в `epic-status`.** Harness и чтение в worfy. Blocked by: —.
- **14 — Очередь Epic-ов в Run-е.** Run, журнал, правка между Wave-ами в main; новый ADR. Blocked by: 07, 08, 12.
- **15 — Очередь из чата и из `autopilot_start`.** Blocked by: 11, 13, 14.
- **16 — Очередь в окне запуска и «Run all accepted».** Blocked by: 11, 13, 14.
- **17 — Очередь в строке Autopilot и правка между Wave-ами.** Blocked by: 10, 14, 16.
- **18 — Run history и Flight Recorder: ожидание Orchestrator-а и Run очереди.** Blocked by: 07, 14.
- **19 — Документация.** Blocked by: 07–18.
- **20 — Приёмка с владельцем.** Blocked by: 07–19.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave). Ticket с большим
номером при общем файле уходит дальше (`filesOverlap`, `src/shared/workflow/waves.ts`).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 07 | `src/main/autopilot/run.ts`, `src/main/agent/orchestrator.ts`, `src/main/autopilot/chat-start.ts`, `src/shared/autopilot/cycle.ts`, `src/shared/autopilot/journal.ts`, `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `test/contract/autopilot-wait.test.ts`, `test/unit/autopilot-wait-line.test.ts`, `test/contract/autopilot.test.ts`, `test/contract/autopilot-wiring.test.ts`, `test/unit/autopilot-chat-start.test.ts`, `test/contract/autopilot-start-tool.test.ts`, `test/e2e/autopilot.spec.ts`, `test/fixtures/agent-scripts/autopilot-wait-*.jsonl`, `docs/adr/<номер>-run-waits-for-orchestrator.md`, `docs/adr/0029-autopilot-waits-for-background-tasks.md`, `docs/adr/0091-autopilot-from-chat.md` | 1 |
| 12 | `src/shared/autopilot/epic-queue.ts`, `test/unit/epic-queue.test.ts` | 1 |
| 13 | `harness/bin/epic-status`, `harness/lib/input-words.json`, `harness/bin/tests/epic-status.test.sh`, `src/shared/workflow/types.ts`, `src/shared/workflow/accepted-epics.ts`, `test/unit/accepted-epics.test.ts` | 1 |
| 08 | `src/main/autopilot/run.ts`, `src/main/agent/orchestrator.ts`, `src/main/agent/session.ts`, `src/main/agent/session-settings.ts`, `test/contract/autopilot-background.test.ts`, `test/contract/orchestrator-relaunch.test.ts`, `docs/adr/0029-autopilot-waits-for-background-tasks.md` | 2 |
| 09 | `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/start-modal.ts`, `src/renderer/autopilot/autopilot-modal.css`, `src/shared/ipc/autopilot-prepare.ts`, `src/main/ipc/autopilot-prepare.ts`, `src/main/autopilot/prepare.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/renderer/shell/AppShell.tsx`, `docs/design/F-SPEC.md`, `test/unit/start-autopilot-modal.test.tsx`, `test/contract/autopilot-prepare.test.ts`, `test/e2e/autopilot-start-modal.spec.ts`, `test/e2e/autopilot-start.ts`, `test/e2e/autopilot.spec.ts`, `test/e2e/autopilot-chat.spec.ts`, `test/e2e/autopilot-faults.spec.ts`, `test/e2e/linked-autopilot.spec.ts`, `test/e2e/linked-read-only.spec.ts`, `test/e2e/linked-machines.spec.ts`, `test/e2e/packaged.spec.ts` | 2 |
| 10 | `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/renderer/autopilot/StartNowModal.tsx`, `test/unit/start-now-modal.test.tsx`, `test/e2e/autopilot-wait.spec.ts` | 3 |
| 11 | `src/main/autopilot/chat-confirm.ts`, `src/shared/ipc/autopilot-confirm.ts`, `src/main/ipc/autopilot-confirm.ts`, `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/start-modal.ts`, `src/renderer/autopilot/autopilot-modal.css`, `test/contract/autopilot-start-tool.test.ts`, `test/unit/start-autopilot-modal.test.tsx`, `test/e2e/autopilot-start-modal.spec.ts` | 3 |
| 14 | `src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts`, `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `test/contract/autopilot-queue.test.ts`, `test/fixtures/agent-scripts/autopilot-queue-*.jsonl`, `docs/adr/<номер>-run-epic-queue.md` | 3 |
| 15 | `src/shared/canvas/tools.ts`, `src/main/mcp/canvas-server.ts`, `src/main/mcp/agent-instructions.md`, `src/shared/autopilot/chat-command.ts`, `src/main/autopilot/chat-start.ts`, `src/main/autopilot/chat-confirm.ts`, `src/shared/ipc/autopilot-confirm.ts`, `test/unit/autopilot-chat-command.test.ts`, `test/contract/autopilot-start-tool.test.ts`, `test/contract/agent-send-autopilot.test.ts` | 4 |
| 16 | `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/QueueList.tsx`, `src/renderer/autopilot/start-modal.ts`, `src/shared/ipc/autopilot-prepare.ts`, `src/main/ipc/autopilot-prepare.ts`, `src/main/autopilot/prepare.ts`, `src/renderer/palette/commands.ts`, `test/unit/queue-list.test.tsx`, `test/contract/autopilot-prepare.test.ts`, `test/e2e/autopilot-start-modal.spec.ts` | 4 |
| 18 | `src/shared/flight-recorder/facts.ts`, `src/shared/flight-recorder/from-journal.ts`, `src/renderer/flight-recorder/span-words.ts`, `src/renderer/flight-recorder/RunHistoryView.tsx`, `src/main/autopilot/journal.ts`, `src/shared/ipc/runs.ts`, `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-view.test.tsx`, `test/e2e/flight-recorder.spec.ts` | 4 |
| 17 | `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/shared/ipc/autopilot.ts`, `test/unit/autopilot-queue-line.test.ts`, `test/e2e/autopilot-queue.spec.ts` | 5 |
| 19 | `docs/features/autopilot.md`, `docs/features/ru/autopilot.md`, `docs/features/flight-recorder.md`, `docs/features/ru/flight-recorder.md`, `CONTEXT.md`, `src/renderer/guide/topics/autopilot/en.json`, `src/renderer/guide/topics/autopilot/ru.json` | 6 |
| 20 | `.scratch/worfy-autopilot-queue/spec.md` | 7 |

- **Wave 1 — 07, 12, 13.** 07 — ядро ожидания; 12 и 13 — чистое правило очереди и статус spec-а, без общих файлов.
- **Wave 2 — 08, 09.** 08 делит с 07 `run.ts` и `orchestrator.ts`; 09 ждёт ожидание 07 (основная кнопка «Start when
  free») и `test/e2e/autopilot.spec.ts`.
- **Wave 3 — 10, 11, 14.** 10 и 11 — над окном 09; 14 ждёт `run.ts` после 07 и 08 и правило 12.
- **Wave 4 — 15, 16, 18.** Точки входа очереди, очередь в окне, Run history.
- **Wave 5 — 17.** Делит `AutopilotAction.tsx` с 10 и ждёт «Run all accepted» из 16.
- **Wave 6 — 19.** **Wave 7 — 20**, владелец.

Имена файлов test-ов, которых ещё нет, — предложение; implementer может назвать иначе, не задевая чужих Ticket-ов своей
Wave. Названия файлов test-ов, которые есть, сверены с `main` 2026-11-05 (`16a0932dc`).

С Epic-ом [worfy-work-track](../worfy-work-track/spec.md) общих файлов в «Где в коде» нет: переключатель «Run history |
Work track» живёт в новом `src/renderer/flight-recorder/RunsView.tsx`, а `RunHistoryView.tsx` правит только Ticket 18
этого Epic-а. Оба Epic-а можно раздавать в одно время.

## Не в этом Epic-е

- **Wave-ы, смешивающие Ticket-ы разных Epic-ов параллельно** (Q3 (б) Ticket-а 01): нужен `epic-wave` и gate по
  нескольким Epic-ам сразу.
- **Run в отдельной Session Orchestrator-а** рядом с ручной (Q2 (г) Ticket-а 01): ломает «один Orchestrator на Project».
- **Ожидание других Session, Terminal, gate** (Q1): Run ждёт только Orchestrator.
- **Защита окна от клика агента** (решение владельца 2026-11-05).
- **Перестановка очереди во время Run-а** (Q17).
- **Настоящий Claude Code или Codex** в test-ах, сеть, платный eval: только fake agent и fake Codex.

## Риски

1. **Задачи без человека после возврата Session** (Ticket 08): ход от task-notification в attended Session идёт в
   режиме разрешений человека и может встать на запросе разрешения ночью. Цена принята владельцем (Q7); строка
   Autopilot и журнал называют задачи, чтобы человек видел, что работа ещё идёт.
2. **Смена режима в живом процессе** может не дойти до уже идущего хода задачи (Codex берёт её только со следующего
   `turn/start`): Ticket 08 проверяет на fake agent и fake Codex; где смена не удалась — сегодняшнее поведение.
3. **Ожидание без предела** держит Run «живым» сутками: Run history и строка показывают, сколько он ждёт; Cancel всегда
   доступен. keep-awake во время ожидания не включается — Mac может уснуть, как без Run-а (решать при claim 07; см.
   «Открытые вопросы»).
4. **Пересечение с worfy-retry** по `run.ts`, `cycle.ts` и журналу: Epic стартует после merge worfy-retry 04, 05 и 14.
5. **Окно запуска меняет поведение кнопки Autopilot** во всех e2e, которые её нажимают: Ticket 09 заводит один helper и
   правит все spec-и сразу.
6. **Очередь умножает цену ошибки в правиле пропуска**: Epic пропущен, хотя мог идти — Run кончится раньше; Epic не
   пропущен, хотя ждёт владельца, — Run встанет. Ticket 12 покрывает правило таблицей случаев.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-autopilot-queue/<NN>`, worktree `.claude/worktrees/<NN>`. Конец Ticket-а — `pr-green-ci`: PR, зелёный
  `ci-ok` (Linux, macOS и Windows job-ы), отметка `review`. Глубина ревью — по общему правилу (`rules-review-depth.md`);
  Ticket-ы 07, 08 и 14 (Session без человека, прерывание чужой работы, переход между Epic-ами ночью) — не ниже `high`.
- **Сначала падающий test**: показать красный на старом поведении, это пишется в «Итог».
- **Без токенов.** `WORFY_AGENT=fake`, `WORFY_CODEX=fake` с временным `CODEX_HOME`; часы и таймеры — test-а.
- Окно в e2e — через `data-testid`, обе темы — снимки в «Итог» (`.scratch/worfy-autopilot-queue/evidence/NN-что.png`).
- Скрипты Node, не bash (ADR-0055); всё работает на Windows (ADR-0054). Timeout-ы — через `ms()` (`test/time-scale.ts`).
- Ticket 13 правит скрипт Harness-а (`harness/bin/epic-status`): такой PR ждёт Windows (ADR-0056).
- Flaky test — Quarantine со сроком (`test/quarantine.ts`). Low findings не становятся Ticket-ами.
- Репозиторий публичный: в fixture-ах и снимках нет путей домашней папки, имён машин, id учётных записей.
- Перед локальным `pnpm test:e2e` на Mac — `rules-local-e2e.md`.

## Открытые вопросы

Решения ниже приняты по рекомендации, чтобы нарезка была полной; владелец подтверждает или меняет их при приёмке spec-а.

1. **keep-awake во время ожидания.** Рекомендация: включать только с настоящим стартом. Ожидание днём не должно не давать
   Mac уснуть; если Mac уснёт, Run стартует после пробуждения.
2. **Куда ещё «Run all accepted»**, кроме Command palette и меню «⋯» рамки Epic-а. Рекомендация: только эти два места.
3. **Добавить Epic в очередь просьбой агента или командой чата во время Run-а.** Рекомендация: нет (п. 4 «Решено без
   владельца»): правка очереди — только руками человека.

## Готово, когда

- [ ] Кнопка Autopilot и просьба агента открывают окно запуска внутри worfy, как прототип `card-918c77d9`; команда чата
      стартует без окна; системного окна больше нет (09, 11).
- [ ] Orchestrator занят — Run принят, ждёт, виден в строке Autopilot и в Run history с Wait `orchestrator-busy`;
      Start now и Cancel работают; Start window, budget и Limits — от настоящего старта (07, 10, 18).
- [ ] Run, остановленный ошибкой, сразу отдаёт Session; задачи живут и названы (08).
- [ ] Run идёт по очереди Epic-ов: переход, пропуск «Ждёт владельца», стоп всего Run-а; правка между Wave-ами
      (12, 14, 17).
- [ ] Очередь задаётся командой чата, MCP tool-ом, «Run all accepted» и в окне (13, 15, 16).
- [ ] Новые ADR и поправки ADR-0029, ADR-0091 (07, 08, 14). Страницы Feature, термин Wait (19). Приёмка владельца (20).
