# Starting Autopilot from a chat

> Перевод [английской версии](../autopilot-chat.md), commit `same-pr`.

Как run [Autopilot](autopilot.md) запускается из чата Session: командой `/worfy:epic-wave`, которую набирает человек,
или canvas-инструментом `autopilot_start`, который агент вызывает, когда его просят словами. Если термины незнакомы,
начните с [Concepts](concepts.md).

## Запуск Autopilot из чата

### Behaviour

#### Команда, набранная в чате

Команда `/worfy:epic-wave`, набранная в чате Session внутри worfy (в Session view или в Session Node на Canvas), запускает
тот же run, что и кнопка. До агента она не доходит, и подтверждения worfy не спрашивает: её набрал человек. Командами
считаются такие формы:

- `/worfy:epic-wave tickets 05, 06 of epic X` и старая форма `Ticket-ы 05, 06 эпика X`: run только по этим Ticket-ам.
- `/worfy:epic-wave wave N of epic X` (также `run wave N of epic X`) и старая форма `волна N эпика X`: run по тем
  Ticket-ам строки N таблицы Waves в `spec.md` Epic-а, которые ещё не выполнены. В таблице может быть одна строка на
  Ticket (`Ticket | Files | Wave`) или одна строка на Wave (`Wave | Tickets`, со списками и диапазонами вроде `11–19`).
  Таблица, которая не читается или в которой нет Wave N, даёт отказ с просьбой назвать Ticket-ы:
  «name the Tickets: tickets NN, NN of epic X».
- `/worfy:epic-wave epic X`: весь Epic. `/worfy:epic-wave X` тоже, если у Project-а есть Epic X.
- `/worfy:epic-wave epics A, B, C`: один run по очереди Epic-ов в набранном порядке, через запятую, как Ticket-ы у
  `tickets` (от 1 до 10 Epic-ов). Слово, которое не может быть именем Epic-а, Epic, названный дважды, больше 10 Epic-ов и
  Epic, которого у Project-а нет, дают отказ словами. Очередь из одного Epic-а — просто этот Epic.
- `/worfy:epic-wave accepted`: очередь из всех Epic-ов Project-а, чей spec принят владельцем и у которых есть готовый
  Ticket, от самого раннего принятия. Если таких нет или их больше 10 — отказ. `/worfy:epic-wave epic accepted` по-прежнему
  называет Epic с именем `accepted`.

Любой другой текст после `/worfy:epic-wave` идёт агенту, как и раньше: например «resume after a session break», слово,
которое не является Epic-ом Project-а, аргумент вроде `depth medium` или сообщение с вложениями. Toast говорит, чем
кончилась команда: «Autopilot started on Epic X» («Autopilot started on a queue of 2 Epics: A, B» для очереди) или отказ.
Пока у Project-а идёт run, отказ такой: «Autopilot is already running Epic X. Stop it first, or add Epics to its queue
with "Add to queue…" in the ⋯ menu.»; команда никогда не добавляет Epic в идущую очередь. Команда с отказом не пишет
journal, и идущий run не считает её вмешательством человека. Сообщение, отправленное сразу после команды, ждёт её ответа,
поэтому попадает в run, который запустила эта команда, и run пишет его в journal как вмешательство человека. Если
Orchestrator занят, в том числе когда команду набрали в его собственной Session во время turn-а, run ждёт его, как сказано
в «Пока Orchestrator занят» ([Autopilot, Запуск run-а](autopilot.md#запуск-run-а)), а toast говорит «Autopilot waits for the Orchestrator and starts when it is free». Wave-ы,
которые Autopilot отправляет Orchestrator-у, никогда не читаются как команда.

#### Просьба к агенту

**Из чата, через агента.** Когда пользователь словами просит Session запустить на autopilot Epic или часть его Ticket-ов,
агент вызывает canvas-инструмент `autopilot_start` с Epic-ом и, если Ticket-ы названы, их номерами. Для нескольких Epic-ов
подряд он передаёт `epics` (от 1 до 10, каждый один раз) вместо `epic`; оба поля, ни одного, Epic, названный дважды, или
`tickets` при нескольких Epic-ах — ошибка формы до всякой просьбы. Тогда просьба несёт очередь (`epics` в
`autopilot.confirm.ask`, если в ней больше одного Epic-а). Окно показывает такую очередь в том же списке, что и **Run all
accepted**, в порядке, в котором просила Session, с отметками и grip-ами: человек может снять отметку с Epic-ов и поменять
их порядок, а прогноз следует за отмеченными. Если ничего не отмечено, старт неактивен. Ответ тогда несёт отмеченные
Epic-и в их порядке (`epics` в `autopilot.confirm.answer`), и run стартует ровно по ним. Main принимает этот список,
только когда он — часть очереди, о которой просили: пустой список, Epic, названный дважды, или Epic, о котором Session не
просила, получают отказ, ничего не стартует, и агенту говорят почему. Ответ без списка (просьба об одном Epic-е)
запускает очередь такой, какой о ней просили. worfy спрашивает
пользователя в том же окне **Start Autopilot**, что и кнопка, в его виде «Agent asks»: под заголовком —
`Asked by Session "<first 8 characters of the Session id>" in a chat · answer within 9:59` и обратный отсчёт 10 минут;
последняя минута — цветом блокировки. Факты, Modes и Run mode — как у кнопки, и человек выбирает там Run mode этого
одного run-а. Фокус — на **Cancel**, Esc — Cancel, ⌘↩ (Ctrl+Enter на Windows) — **Start Autopilot**. Строки прогноза
приводит страница [Run planning](run-planning.md). Окно открывается в одном окне Machine Project-а, то есть Machine, на
которой идёт Session: в окне с фокусом, иначе в окне на экране, иначе в свёрнутом или скрытом окне, которое сначала
возвращают. Main шлёт просьбу каналом `autopilot.confirm.ask` и принимает ответ `autopilot.confirm.answer` только от
этого окна (`src/shared/ipc/autopilot-confirm.ts`). Эти каналы закрыты для Linked machine, поэтому её экран просьбы не
получает и подтвердить не может. Если ответа нет 10 минут, окно пишет `time is up — the Session got "declined"`, его
кнопки становятся неактивны, через несколько секунд оно закрывается, а агент получает «No one confirmed …». Cancel, Esc и
«change in Modes» — тоже отказ; окно, закрытое за это время, отвечает, что открытого окна worfy нет. Защиты от клика
агента по окну нет. Системного окна сообщения для этого инструмента main больше не показывает. **Start Autopilot**
запускает тот же run, что и кнопка Autopilot, в выбранном режиме, по названным Ticket-ам, если они есть. Команда,
набранная в чате, всегда стартует в режиме по умолчанию. Если Orchestrator занят, в том числе когда спрашивающая
Session — сам Orchestrator в своём turn-е, run ждёт его, как сказано в «Пока Orchestrator занят» ([Autopilot, Запуск run-а](autopilot.md#запуск-run-а)), а агент получает
«Autopilot waits for the Orchestrator and starts when it is free». Без просьбы в окне инструмент отказывает:

- Session, которая работает unattended, например Orchestrator во время run-а: подтвердить некому. Orchestrator
  остановленного run-а, который ещё ждёт конца своего turn-а или background task-ов, отказа не получает: ему открывается
  окно;
- Session, которую worfy не может найти;
- Project, у которого идёт run: тот же отказ, что у команды, с подсказкой остановить run или взять «Add to queue…»;
  инструмент никогда не добавляет Epic в идущую очередь, и в journal ничего не попадает;
- Epic (в том числе из очереди) или Ticket, которого у Project-а нет, или workflow, который не читается;
- второй вызов, пока ждёт просьба того же Project-а;
- Machine без открытого окна worfy;
- окно Start Autopilot, уже открытое для другого старта: агенту говорят об этом.

### How it works

Run, запущенный из чата, — это тот же run, что запускает кнопка Autopilot. Как он устроен, описано на странице
[Autopilot](autopilot.md#how-it-works).

### Implementation

#### Модули

| Путь | Что там |
|---|---|
| `src/main/autopilot/chat-start.ts` | `ChatStarts.startFromChat`: старт из чата, по Epic-у или по названным Ticket-ам; отказ, пока идёт run, ответ, что run ждёт занятого Orchestrator-а, и notice, если этот run позже получил отказ. Его вызывают команда, набранная в чате, и инструмент `autopilot_start`. |
| `src/shared/autopilot/chat-command.ts` | `parseChatCommand`: какие набранные сообщения являются командой, с каким Epic-ом и Ticket-ами; toast её ответа. |
| `src/shared/workflow/wave-plan.ts` | `parseWavePlan`, `waveTickets`: таблица Waves в `spec.md` Epic-а и ещё не выполненные Ticket-ы Wave N. |
| `src/main/ipc/agent.ts` | `agent.send`: команда не доходит до агента; она запускает run через `startFromChat` и отвечает, чем кончилась. |
| `src/main/autopilot/chat-confirm.ts` | Инструмент `autopilot_start` за canvas server: отказы без просьбы, просьба в окне Start Autopilot этой Machine (`WindowAsks`) и её 10 минут. |
| `src/main/ipc/autopilot-confirm.ts` | Handler `autopilot.confirm.answer`: ответ засчитывается только от окна, которое спросили. |

Модули самого run-а перечислены на странице [Autopilot](autopilot.md#модули).

#### Test-ы

| Test | Что покрывает |
|---|---|
| `test/unit/autopilot-chat-command.test.ts` | Формы команды, набранной в чате, и текст, который командой не является. |
| `test/unit/wave-plan.test.ts` | Обе формы таблицы Waves, диапазоны, выполненные Ticket-ы и отказы. |
| `test/contract/agent-send-autopilot.test.ts` | `agent.send` с командой: старт, отказ, пока идёт run, и то, что всё ещё доходит до агента. |
| `test/e2e/autopilot-chat.spec.ts` | Команда, набранная в Session view и в Session Node: toast-ы и строка состояния. |
| `test/contract/autopilot-start-tool.test.ts` | Инструмент `autopilot_start`: просьба в окне и её ответы, её 10 минут, окно, куда она идёт, отказы без неё, ответ run-а, который ждёт Orchestrator. |
| `test/unit/autopilot-chat-start.test.ts` | `startFromChat` для команды и инструмента: проверки, отказ, пока идёт run, ответ run-а, который ждёт. |
