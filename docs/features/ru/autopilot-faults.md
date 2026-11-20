# Autopilot faults and recovery

> Перевод [английской версии](../autopilot-faults.md), commit `b82c4d25`.

Как run [Autopilot](autopilot.md) ждёт Limits и повторяет turn после ошибки API, как он останавливается, что бывает
после остановки, и Fault scenario-и, которые проверяют восстановление. Если термины незнакомы, начните с
[Concepts](concepts.md).

## Ожидания, остановки и восстановление

### Behaviour

#### Ожидание Limits

Когда Limits отказывают turn-у Wave, Wave не заканчивается. Run ждёт, пока сбросится отказавшее окно, плюс 2 минуты:
окно, которое назвал отказ, иначе самое позднее отказавшее окно, известное worfy. От 5-часового окна ничего не зависит:
на плане без него run ждёт недельное окно. Если время сброса неизвестно, он пробует снова каждые 30 минут. Если
ожидание превысило бы 24 часа от первого отказа, run останавливается с `limits-timeout`.

С включённым для Project-а Auto-continue известный сброс дальше 24 часов run не останавливает: он ждёт до сброса,
например 3 дня для недельного окна. Пока до продолжения больше 24 часов, не идёт turn и не жив ни один background task,
run отпускает keep-awake ([ADR-0097](../../adr/0097-far-limits-wait-releases-keep-awake.md)): экран может погаснуть, macOS
может его заблокировать, Mac может уснуть. keep-awake возвращается за 24 часа до продолжения и сразу, как начинается
turn или background task. Если Mac проспал сброс, run продолжает при первом пробуждении. Заблокированный экран остаётся
заблокированным: после продолжения агенты, которым нужно окно (e2e, `gate full`), ждут человека. Выключенный во время
такого ожидания Auto-continue останавливает run сразу с `limits-timeout`, а Stop во время него без идущего turn-а или
Stop, пришедший до отказа, — сразу с `user-stop`. После продолжения 24 часа попыток раз в 30 минут без времени сброса
считаются от следующего отказа. Эти попытки сохраняют свой предел в 24 часа при любом положении переключателя.

На Orchestrator-е Codex отказ — это `usageLimitExceeded` от Codex. Когда окно Codex исчерпано и у него есть время сброса,
run ждёт этого сброса, как выше. Когда время приходит, worfy снова читает окна Codex: пока какое-то ещё исчерпано, run
ждёт ещё раз. Когда ни одно окно не исчерпано, Codex нечего сбрасывать: план не включает Codex или кончилась квота. Тогда
run сразу останавливается с `vendor-quota`, а tooltip показывает текст ошибки Codex. Когда в момент отказа worfy не знает
ни одного окна Codex и не может их прочитать, он не считает это квотой: run ждёт, как для окна без времени сброса, и
пробует снова каждые 30 минут.

Когда время приходит, Orchestrator получает одно сообщение: продолжить с места остановки и сначала добавить запись о паузе
в HANDOFF. Сам worfy эту запись не пишет.

#### Повтор после ошибки API

С включённым для Project-а Auto-continue (меню Modes у Orchestrator-а, см. [Orchestrator modes](orchestrator-modes.md)) turn, который
закончился временной ошибкой API, не заканчивает run. Временные — это 500, 502, 503 или 504, 529 (overloaded), соединение,
которое оборвалось или не установилось, timeout и оборванный поток ответа; отказ Limits к ним не относится, он ждёт, как
выше. Run ждёт 1, 5, 15, 30, затем 60 минут, каждый раз с разбросом до 20 % в обе стороны, по wall clock. Затем
Orchestrator получает одно сообщение: прошлый turn закончился временной ошибкой API, продолжить с места остановки, и в нём
названы действия того turn-а, которые вышли за пределы Session (commit, push, PR, Agent). Сообщение никогда не говорит, что
ничего за пределы не вышло: скрипт (`node <file>`, любой скрипт Harness) для worfy выглядит локальным, но может сделать push,
merge или отметить Ticket как done, поэтому сообщение всегда просит модель проверить, что сделала каждая команда того
turn-а, прежде чем её повторить. Команда Wave и исходное сообщение второй раз не уходят. Turn, закончившийся без ошибки,
сбрасывает счёт.

На Orchestrator-е Codex вид ошибки берётся из собственного вида ошибки Codex: `serverOverloaded` ждёт, как 529;
`responseTooManyFailedAttempts` от Codex с HTTP status 429 не временная (Codex уже потратил свои повторы на rate limit).
Ошибку, которую Codex повторяет сам, worfy оставляет Codex: ни `turn-retry`, ни отправки. Вызов Subagent-а Codex
(`collabAgentToolCall`) без результата отказывает в повторе с `in-flight`, как вызов `Agent`.

Run не повторяет и останавливается с `turn-error`, как раньше, после ошибки, которая не временная (`not-transient`), когда у
действия turn-а, выходящего за пределы Session, нет результата (`in-flight`: push или merge мог пройти, а мог и нет), и после
пятого повтора подряд (`cap`; сообщение говорит «gave up after 5 retries»). Journal сначала получает `retry-refused` с
причиной.

Во время ожидания turn background task-а или человека перехватывает повтор: ожидание на этом кончается (`resumed`), строка
состояния показывает, что run идёт, а решает конец этого turn-а. Без ошибки счёт начинается заново, и продолжение не
уходит; со временной ошибкой снова ждёт следующий повтор. Отказ Limits во время ожидания тоже его заканчивает: run ждёт
только Limits. **Stop autopilot** во время ожидания, когда turn не идёт, сразу заканчивает run с `user-stop`, в том числе
когда более ранний Stop уже перевёл run в остановку; Force stop, конец Session и выход из приложения отменяют ожидание;
выход сохраняет его в `run-suspended`.
Auto-continue, выключенный во время ожидания, читается, когда приходит время: ожидание отменяется, и run останавливается с
`turn-error`. С выключенным Auto-continue turn с ошибкой API останавливает run с `turn-error`, как раньше.

Чат Orchestrator-а показывает ожидание строкой над полем ввода, которая отсчитывает время по секундам
([Orchestrator modes](orchestrator-modes.md#обратный-отсчёт)): `API error 529 (overloaded) · retry 2 of 5 in 4:12` с
**Retry now** и **Cancel**, а для ожидания Limits — `Limits: 7-day window · resumes 14:20 (in 2:13:05)` или
`Limits: no reset time reported · next try in 27:40` только с **Cancel**. Retry now сразу отправляет продолжение того же
повтора, в очереди run-а, как это сделал бы его таймер (`resumed` в journal); таймер и второй клик больше ничего не
отправляют. Cancel заканчивает ожидание, ничего не отправив, и run останавливается так, как остановился бы без
Auto-continue: с `turn-error` во время ожидания повтора, с `limits-timeout` во время ожидания Limits. Cancel-у, пришедшему
после того, как продолжение уже ушло, отменять нечего, и run идёт дальше.

#### Остановка

**Stop autopilot** — graceful Stop: run не отправляет новых Wave. Клик до отправки «Run wave» не даёт этой Wave уйти.
Клик, пока «Run wave» в пути, этого не делает: Wave уходит, а за ней сообщение об остановке, если только Wave ещё не ждёт в
очереди Session (первый случай ниже).

- Если Wave не в работе, run сразу заканчивается с `user-stop`. Сюда входят время до первой Wave, Wave, которая ещё ждёт
  в очереди Session (её убирают оттуда), ожидание бюджета и ожидание, пока Ticket-ы выйдут из работы после turn-а.
- Во время turn-а Wave или её background task-ов кнопка говорит **Stopping…** и не принимает клик. Orchestrator получает
  сообщение: новых Ticket-ов не брать, начатые закончить, затем закончить turn. Run заканчивается с первым концом
  turn-а, после которого Session простаивает и живых task-ов нет. Он не ждёт файлов Ticket-ов и не проверяет, послушался
  ли Orchestrator, поэтому Ticket может остаться в `claimed`.
- Во время ожидания Limits то же сообщение уходит вместе с продолжением, в момент сброса. До этого run остаётся в
  `waiting`.
- Во время ожидания повтора после ошибки API, когда turn не идёт, run сразу заканчивается с `user-stop`, и продолжение не
  уходит.

**Force stop** стоит в меню «⋯» справа от кнопки, пока идёт run этого Epic-а, в том числе во время graceful Stop. Второй
пункт этого меню — **Run history**. Force stop не ждёт. Он прерывает turn (до 15 секунд), закрывает процесс Claude Code, а
с ним все background task-и, отменяет любое ожидание и возвращает Orchestrator человеку. Worktree и ветки остаются.
Сообщение, которое человек поставил в очередь, остаётся и удерживается в очереди новой Session. Wave и сообщение об
остановке из очереди уходят.

Следующий run того же Epic-а берёт Ticket-ы, прерванные Force stop, в свою первую Wave, если они ещё в работе
(`claimed` или открыты с веткой worktree, которую не удалось прочитать и которая может держать claim), даже когда
больше ничего не готово. Так же он делает после run-а, который остановился с `session-error` во время Wave: implementer-ы
умерли вместе с процессом Orchestrator-а, и Ticket, который один из них взял, остаётся в `claimed`. Первая команда Wave
следующего run-а называет его вместе с готовыми Ticket-ами, и Orchestrator продолжает его как возобновлённую Wave (skill
`epic-wave`, «How to resume a wave»): по его ветке, PR и результату он доводит работу или отдаёт Ticket заново. worfy не
пишет своего `Status:`. После graceful Stop он их не берёт, в том числе когда Session Orchestrator-а упала после этого Stop.
Run, который остановился до своей первой Wave, например во время ожидания Start window, ни одного из этих Ticket-ов не взял,
поэтому их всё ещё получит следующий run. Старт читает этот список из journal-ов run-ов Project-а, а не из памяти,
поэтому он переживает перезапуск приложения (см. [journal как checkpoint run-а](#journal-как-checkpoint-run-а)).

**Выход из приложения** не останавливает run, а приостанавливает его. Так же действуют Restart now у Update и
выключение системы. Выход идёт в четыре шага:

1. Каждый run приостанавливается: ни Wave, ни продолжение, ни повтор больше не уходят, его таймеры стоят, и ни одна
   Session не начинает новый turn: сообщение, отправленное с этого момента, ждёт в очереди Session.
2. Выход ждёт внешние вызовы, у которых ещё нет результата: `git push` верхнего уровня, `gh pr merge`, вызов MCP
   server-а или Subagent turn-а Session (те же вызовы, которые повтор считает «в пути», см. `in-flight` выше), и такие же
   вызовы Subagent-ов Session-ов. Вызовы Subagent-а читаются из его собственного транскрипта
   (`<session>/subagents/agent-<id>.jsonl`), раз в секунду во время ожидания; файл Subagent-а, в который не писали с
   запуска worfy, принадлежит прежнему процессу и ничего не держит. Ожидание — не больше 60 секунд. В это время каждое
   окно показывает **Quitting worfy** с этими вызовами и оставшимся временем, а **Quit now** сразу заканчивает ожидание.
   Без таких вызовов нет ни ожидания, ни окна.
3. Turn-ы останавливаются: каждая Session получает interrupt, затем её процессу дают 7,5 секунды на выход, затем SIGKILL
   и ещё 2 секунды (ADR-0064, как заканчивается Session). Запись живых Session-ов останавливается первой, поэтому в ней
   остаются Session-ы, которые выход оборвал. Прежде чем закроется любая Session, run, который уже остановился, но ещё
   ждёт background task-и своего Orchestrator-а, пишет `tasks-killed` с task-ами, живыми в этот момент, и отпускает
   keep-awake: эти task-и заканчиваются вместе с остановкой turn-ов.
4. Каждый приостановленный run пишет `run-suspended` с причиной (`quit`, `update` или `shutdown`), своей Wave, Ticket-ами
   Wave, которые ещё в работе, и открытым ожиданием с временем его конца. `run-stopped` с `app-quit` больше не пишется;
   причина остаётся для journal-ов старых сборок.

Выключение системы пропускает ожидание и остановку turn-ов: run приостанавливается и записывается сразу, с причиной
`shutdown`, остановленный run, который ещё ждёт свои background task-и, пишет их `tasks-killed`, а Session-ы
заканчиваются вместе с приложением. Выключение во время ожидания заканчивает ожидание так же. Ни в одном из этих случаев
Orchestrator заново не запускается.

#### Journal как checkpoint run-а

Journal run-а — единственная запись о run-е, которая переживает приложение, поэтому всё, что перезапуску нужно знать о
run-е, читается обратно только из его строк (`src/shared/autopilot/checkpoint.ts`). Reader даёт:

- очередь Epic-ов и Epic, на котором run, названные Ticket-ы, Run mode, Vendor и Auto-approval;
- номер Wave и её Ticket-ы, которые ещё в работе;
- ожидание, в котором run (Limits, Start window, бюджет или повтор), с временем его конца;
- счёт повторов и продолжений застрявших Ticket-ов;
- как run закончился, и Ticket-ы, которые возьмёт следующий run Epic-а (`resumable`).

Run **оборван** (cut off), когда последняя строка его journal-а — `run-suspended` или когда в нём вовсе нет `run-stopped`,
как после убитого приложения. Оборванный run не оставляет ничего `resumable`, пока его не продолжили или не отбросили.

Две строки journal-а — для run-а, который прерывает перезапуск приложения. `run-suspended` (`cause`: `quit`, `update` или
`shutdown`) называет Wave, её Ticket-ы в работе и открытое ожидание с временем его конца. `run-continued` (`after`: одна
из этих причин или `crash`) говорит, что тот же run пошёл дальше в том же journal-е. Имя отличается от `resumed`, которым
кончается ожидание. Выход пишет `run-suspended` (см. «Выход из приложения» выше), а run, который идёт дальше, пишет
`run-continued` (см. [после перезапуска приложения](#после-перезапуска-приложения)). Сборка старше той, что ввела эти
строки, пропускает их и считает нечитаемыми, как любую строку вида, которого она не знает.

**Discard** пишет в journal оборванного run-а `run-stopped` с причиной `discarded` и Ticket-ами его Wave в работе. Эти
Ticket-ы становятся `resumable`, как после Force stop, кроме Ticket-а, удержанного из-за unknown side effects: Discard
сначала читает вызовы оборванной Wave, как это делает продолжение, и помечает такой Ticket до `run-stopped`.

Ещё две строки несут метки unknown side effects. `unknown-side-effects` (`ticket`, `actions`) называет Ticket, который run
оставил человеку, и краткую запись worfy о каждом вызове без результата (`gh pr merge 41`, секреты скрыты, как в
`retry-refused`). `side-effects-checked` (`ticket`) — это **Checked, include** человека. Помеченный Ticket никогда не
`resumable` до своего `side-effects-checked`, что бы ни называл `run-stopped`. Метка, ещё открытая, когда run
заканчивается, переходит к следующему run-у того же Epic-а, и `side-effects-checked` там её снимает.

#### После перезапуска приложения

Когда worfy стартует, самый новый оборванный run каждого Project-а идёт дальше сам, под тем же id и в том же journal-е:

1. Run пишет `run-continued` с `after`: причиной своего `run-suspended` или `crash`, когда в journal-е нет ни
   `run-suspended`, ни `run-stopped`. Он сохраняет свой Epic, очередь, названные Ticket-ы, Run mode и счёт продолжений
   застрявших Ticket-ов.
2. Ожидание, открытое в момент обрыва (Limits, Start window, бюджет или повтор), идёт до своего времени конца. До этого
   Wave не уходит; затем run идёт дальше с `resumed`, как после любого ожидания.
3. Иначе следующая Wave уходит сразу, так, как уходит каждая Wave после первой в run-е: в новую session Orchestrator-а,
   которая сначала читает brief Wave (`wave-brief`), если Harness это умеет и Orchestrator свободен; со старым Harness —
   в Session Orchestrator-а как есть. Команда оборванной Wave снова не уходит. Её Ticket-ы, которые ещё в работе, идут в
   новой Wave как возобновлённые, вместе с готовыми. Номер новой Wave следует за оборванной (Wave 2 после Wave 1),
   поэтому в одном journal-е номера не повторяются.
4. Перед этой Wave run читает транскрипт session Orchestrator-а оборванной Wave и ищет внешние вызовы без результата:
   `git push`, `gh pr merge`, вызов MCP server-а или Subagent, которые могли выполниться, а могли и нет. Ticket, у
   implementer-а которого есть такой вызов, удерживается: его нет в Wave, run его не продолжает, и он остаётся в
   `claimed` для человека, с меткой [unknown side effects](#unknown-side-effects). Вызов самого Orchestrator-а или
   Subagent-а, не привязанного ни к одному Ticket-у, удерживает каждый Ticket Wave. Читаются только транскрипты Claude
   Code: на Orchestrator-е Codex ни один Ticket не удерживается.
5. Сначала идут проверки старта. Занятый Orchestrator ждут (`orchestrator-busy`), как при любом старте. На Codex с
   неодобренными hook-ами Harness run-у отказывают, как отказывают старту, и он остаётся оборванным с этой причиной.

**Правило часа.** Run, оборванный больше часа назад, сам не продолжается. Так же и run, который уже дважды сам
продолжался за последний час (две строки `run-continued`), поэтому продолжение, которое роняет приложение, не
зацикливается. Такой run остаётся оборванным. Его строка состояния говорит `cut off by restart · 14:05`, со временем
обрыва, а рядом стоят **Resume** и **Discard**; toast говорит то же один раз. Пока человек не решил, кнопка Autopilot
этого Epic-а неактивна, и старт любого run-а в Project-е отклоняется. **Resume** продолжает run, как выше. **Discard**
заканчивает его с `run-stopped` `discarded` (см. ниже), и следующий старт начинает новый run.

На Linked machine Resume и Discard требуют Full access, как Start Autopilot: `autopilot.resume` и `autopilot.discard` —
вызовы на запись. С доступом Read only строка видна, а кнопок нет.

**Lock-и.** worfy не снимает ни одного lock-а оборванной Wave. Lock на worktree (`worktree-lock` Harness-а) —
рекомендательный: он никогда не блокирует, а только говорит новой session, что другая отметилась в дереве за последние 60
минут. Его registry лежит под `~/.claude`, куда worfy не пишет (ADR-0005). E2e lock implementer-а, оборванного посреди e2e
run-а, перехватывает следующий запуск, когда lock старше 30 минут. Implementer-ы продолженной Wave находят worktree своих
Ticket-ов такими, какими их оставила оборванная Wave.

#### Unknown side effects

Ticket, который run оставил человеку, потому что у вызова его implementer-а, способного действовать за пределами
машины, нет результата, получает метку **unknown side effects** на своей карточке в рамке Epic-а, строкой под
заголовком. Её tooltip называет вызовы: "gh pr merge 41 may or may not have run". Рамка показывает toast один раз на
метку: "Unknown side effects: `gh pr merge 41` may or may not have run (Ticket 01 of demo)", с **Checked, include**. Клик
по метке показывает toast снова. Карточка рисует метку, только пока Ticket в работе.

Человек проверяет, что сделал вызов (запушена ли ветка, влит ли PR), и выбирает **Checked, include**. Run пишет
`side-effects-checked`, и метка уходит. Run, который идёт дальше, берёт Ticket в свою следующую Wave как возобновлённый,
даже когда больше ни один Ticket не готов. Run, который уже остановился, оставляет Ticket `resumable`, и его берёт
следующий run Epic-а. worfy не проверяет git или GitHub сам, чтобы включить Ticket: это всегда решение человека (Q4 (а)
spec-а continuity). Метки лежат в journal-е, поэтому переживают перезапуск приложения: после перезапуска состояние
последнего run-а снова их несёт. Пока оборванный run ждёт Resume или Discard, он меток не показывает.

На Linked machine Checked, include требует Full access: `autopilot.include` — вызов на запись.

#### После любой другой остановки

Orchestrator сразу возвращается к человеку. Если ничего не идёт, он заново запускается как attended. Если turn или
background task ещё живы, он не перезапускается — это убило бы их: тот же процесс продолжает работу как Session
человека, в permission mode, сохранённом для Node (на Codex — со следующего turn-а). Turn и task-и работают дальше там,
turn-ы их task-notification идут в Session человека, а их запросы разрешений — человеку. Journal сразу получает
`orchestrator-returned` с ещё живыми task-ами. Состояние говорит, например, `stopped: turn error · 2 background tasks
still run`, а экран остаётся включённым, пока turn и task-и не закончатся. Сообщение, которое Start now отложил,
возвращается в очередь человека, удержанным. Новый run в это время ждёт Orchestrator (`orchestrator-busy`), как любой
run, который застал его занятым; Start now останавливает task-и.

После **Stop autopilot**, если turn или background task ещё живы, и после любой остановки, при которой Session не
удалось сменить (агент отказал в смене permission mode), действует прежний порядок: состояние уже говорит `stopped`, но
Orchestrator остаётся unattended, экран остаётся включённым, пока они не закончатся. Task-и в это время могут
продолжать работу. После последнего task-а Orchestrator ждёт 30 секунд turn, который запускает его task-notification, а
затем возвращается.

Новый run может стартовать во время этого ожидания, с кнопки Autopilot или через `autopilot_start`, если turn уже не
идёт. Он забирает тот же unattended Orchestrator как есть. Orchestrator не перезапускается, поэтому его background task-и
продолжают работу. Они становятся task-ами нового run-а, а journal старого run-а больше не получает строк.

#### Ticket, который остаётся в работе

Один застрявший Ticket не останавливает весь run. Две остановки касаются одного Ticket-а: Ticket Wave всё ещё в работе
через 10 минут после turn-а (`wave-unfinished`) и следующая готовая Wave — тот же набор Ticket-ов, что и только что
оконченная (`no-progress`). Перед любой из них run проходит лестницу, с пределом на Ticket и на run:

1. **Продолжение.** Run отправляет следующую Wave с этим Ticket-ом так же, как после Force stop: Ticket-ы, которые ещё в
   работе, входят в Wave как возобновлённые. Команда Wave получает ещё одну строку от самого worfy, после строки команды, так
   что skill по-прежнему раскрывается: `Continuation 1 of 2 for ticket 05: still claimed 10 min after the turn ended.` Для
   `no-progress` в ней `… came back as the same wave.` В строке только факты worfy: номера Ticket-ов, попытка, причина и
   минуты. Последние слова Orchestrator-а в неё никогда не возвращаются. Wave идёт в новую SDK session, как и каждая Wave
   после первой. Пока она идёт, строка состояния показывает `Wave 4 · continuing 05 (1 of 2)`. У Ticket-а не больше 2
   продолжений за один run; новый run считает с 0.
2. **Отложить.** После 2 продолжений run просит Orchestrator отложить Ticket:
   `Ticket 05 stayed claimed after 2 continuations. Run: ticket block epic-a 05 "stuck: claimed after 2 continuations" --waits owner. Run it in the Ticket's own worktree (branch epic-a/05) and commit only the Ticket file on its branch: git -C <worktree> commit -m "<message>" -- <ticket file>. A Ticket with no worktree gets the block on the main branch. Then end the turn.`
   Команда называет `ticket` из Harness по его пути. Сообщение говорит и где её запускать, как skill `epic-wave`: worfy
   читает main branch с веткой каждого Ticket-а поверх, поэтому block, записанный в своём дереве Orchestrator-а, остаётся
   скрыт под claim-ом ветки. Если worfy прочёл claim Ticket-а из ветки worktree, сообщение называет эту ветку; иначе даёт
   правило только словами. worfy сам `Status:` не пишет: команду выполняет только Orchestrator.
   Ticket с `Waits: owner` ждёт владельца, поэтому остальные Ticket-ы Epic-а идут в следующих Wave-ах, а когда больше ничего
   не готово, Epic заканчивается с `waits-owner`, и run над очередью переходит к следующему Epic-у.
3. **Остановка.** Если после этого turn-а Ticket всё ещё в работе, run останавливается с прежней причиной, `wave-unfinished`
   или `no-progress`.

Перед продолжением или просьбой отложить run читает, красный ли main: метку, которую `land` держит в папке состояния gate
(`main-red-<key>.json`), пока CI основной ветки красный. Если метка есть, весь run останавливается с `main-red`, и ничего не
продолжается и не откладывается: застрявший Ticket встретил бы тот же красный main. Метка, которую не удалось прочитать,
считается отсутствующей.

`background-stalled` не называет Ticket и остаётся остановкой. Так же `turn-hung`: turn Orchestrator-а затих, и что с ним
делать, решает человек.

Journal получает `ticket-continued` (Ticket, попытка, потолок, причина) прямо перед `wave-started` продолжения, у которого
есть `continuation`, и `ticket-set-aside` (Ticket, причина, продолжения) до отправки сообщения. Run history показывает
продолжение как следующую попытку работы над Ticket-ом, `#2`, с причиной словами, просьбу отложить — как отметку в строке
run-а, а заблокированный Ticket — как красный `!` с его `Blocked reason` и `Waits`.

#### Почему run останавливается

| Причина | Значение |
|---|---|
| `no-ready-wave` | Ничего не готово, и ни у одного Ticket-а в `blocked` или без статуса не закрыты все блокеры. Так заканчивается run, который завершил Epic. |
| `tickets-done` | Run по названным Ticket-ам окончен: каждый из них в `done` в checkout. Такой run берёт в каждую Wave только готовые Ticket-ы своего списка. Кнопка всегда запускает весь Epic, поэтому запущенный ею run так никогда не заканчивается. |
| `blocked-tickets` | Ничего открытого не готово, а у Ticket-ов в `blocked` или без статуса все блокеры закрыты. В run-е по названным Ticket-ам считаются только Ticket-ы списка. |
| `waits-owner` | Run над очередью Epic-ов дошёл до последнего Epic-а, и в нём остались только Ticket-ы для владельца (`blocked` с `Waits: owner`, без статуса или заблокированные только такими Ticket-ами). Строка говорит `stopped: waits for owner`; `tickets` их называет. Run по одному Epic-у в этом случае останавливается с `blocked-tickets`. |
| `no-progress` | Следующая готовая Wave — тот же набор Ticket-ов, что и только что оконченная, после того как у её Ticket-ов было по 2 продолжения и Orchestrator-а попросили их отложить ([Ticket, который остаётся в работе](#ticket-который-остаётся-в-работе)). |
| `wave-unfinished` | Ticket Wave остался в работе дольше 10 минут после turn-а, после его 2 продолжений и turn-а с просьбой отложить. |
| `main-red` | Main был красным (метка `land`), когда застрявшему Ticket-у полагалось продолжение или просьба отложить. Останавливается весь run, в том числе в очереди Epic-ов. |
| `background-stalled` | Background task-и не дали ни одного события за час, и ни один их output file за это время не изменился. |
| `turn-hung` | Собственный turn Orchestrator-а 30 минут не подавал признаков жизни. Признак жизни — любое событие его агента, включая скрытые, такие как hook или thinking. Открытый запрос разрешения, ещё идущий hook, изменение output file живого background task-а или gate в worktree Session и e2e lock, держатель которого работает, тишиной тоже не считаются. Ничего не прерывается: Session возвращается человеку, как после любой другой остановки, а её turn и background task-и продолжают идти. Тишина одного background task-а — это `background-stalled`, а не эта причина. |
| `limits-timeout` | Ожидание Limits превысило бы 24 часа (с включённым Auto-continue — только без времени сброса), Auto-continue выключили во время ожидания сброса дальше 24 часов, или ожидание отменили кнопкой Cancel в чате Orchestrator-а. |
| `vendor-quota` | Codex отказал turn-у по своим Limits, и ни одно окно не исчерпано, так что сбрасываться нечему. Текст ошибки Codex — это сообщение состояния run-а (tooltip строки состояния) и `message` строки `limits-hit`. |
| `window-too-short` | Run mode — Start window, и следующая Wave обычно идёт дольше, чем всё окно. Tooltip называет Wave, её обычную длительность и окно. |
| `interrupted` | Turn Wave прервали, или прервали turn человека, и Wave осталась удержанной в очереди. |
| `turn-error` | Turn Wave закончился ошибкой, которая не является отказом Limits, и его не повторили (Auto-continue выключен, `retry-refused` или ожидание повтора отменили кнопкой Cancel в чате Orchestrator-а). |
| `session-error` | Session Orchestrator-а упала, или перед следующей Wave или turn-ом очереди gate Codex больше не запускает hook-и Harness. |
| `session-closed` | Session Orchestrator-а закрылась. |
| `send-failed` | «Run wave» не удалось отправить. |
| `workflow-error` | Workflow не прочитался, когда run должен был оценить Wave, в том числе когда `git worktree list` упал дважды подряд или не уложился во время. |
| `user-stop` | Stop autopilot. |
| `user-force-stop` | Force stop. |
| `start-cancelled` | Cancel, Stop или Force stop, пока run ждал Orchestrator. |
| `start-refused` | Проверка отказала, когда Orchestrator освободился. Причина — в `message` journal-а. |
| `app-quit` | Выход из приложения в сборке, где выход ещё не приостанавливал run-ы. Теперь выход вместо этого пишет `run-suspended`. |
| `discarded` | Человек отбросил run, который оборвал перезапуск приложения. `tickets` называет его Wave в работе, и следующий run берёт её с собой. |

Tooltip строки состояния называет ошибку словами, когда она есть.

В run-е над очередью Epic-ов `no-ready-wave`, `blocked-tickets` и `tickets-done` могут закончить только Epic, и run идёт
к следующему ([Autopilot, run над очередью Epic-ов](autopilot.md#во-время-run-а)); таблица называет, чем остановился сам
run.

После любой остановки toast говорит, чем кончился run, с кнопкой **Open history**, а справа от строки состояния до старта
следующего run-а стоит **History**. Обе открывают run в Run history, которую описывает страница
[Flight Recorder](flight-recorder.md).

На Machine с ролью `serve` межмашинного gate перед остановкой с `no-ready-wave`, `blocked-tickets` или `waits-owner` run отправляет
Orchestrator-у шаблон «Process gate queue», один раз за run. Он следит за этим turn-ом как за turn-ом Wave, а затем
останавливается с той же причиной, даже если turn сделал какой-то Ticket готовым. Stop до этого момента отменяет шаг.

### How it works

**Две остановки.** Graceful Stop не бросает implementer-а посреди merge
([ADR-0051](../../adr/0051-autopilot-graceful-stop-force-stop-in-menu.md)). Force stop — крайняя мера: background task-и
заканчивает именно закрытие процесса ([ADR-0050](../../adr/0050-autopilot-user-stop-interrupts-orchestrator.md)). Новый
процесс стартует только после выхода старого, которого после предела убивают, поэтому два процесса никогда не продолжают
одну SDK session ([ADR-0064](../../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)).

**Ожидание идёт по wall clock.** Таймер ожидания сверяет время как минимум раз в минуту вместо одного длинного timeout,
поэтому Machine, которая уснула, не продолжит позже на время сна.

**Что считается отказом.** Turn, закончившийся ошибкой, считается отказом Limits, когда Session сообщила `rejected` во
время этого turn-а или когда текст ошибки говорит о Limits. Claude Code сообщает статус только при его изменении, поэтому
старый `rejected` не превращает более позднюю ошибку другого рода в отказ.

### Implementation

#### Модули

| Путь | Что там |
|---|---|
| `src/main/autopilot/limits-wait.ts` | Ожидание Limits, таймер по wall clock, текст продолжения. |
| `src/main/autopilot/turn-retry.ts` | Повтор после временной ошибки API: счёт, таймер, продолжение. Паузы, отказы и текст — `src/shared/agent/continue-plan.ts`, какая ошибка временная — `src/shared/agent/turn-failure.ts`. |
| `src/shared/autopilot/resume-at.ts` | Когда run продолжает после отказа. Чистые функции. |
| `src/shared/autopilot/continuation.ts` | Тексты лестницы: строка продолжения, сообщение с просьбой отложить, слова строки состояния; потолок `MAX_CONTINUATIONS`. Чистые функции. |
| `src/shared/autopilot/cycle.ts` | Когда застрявший Ticket продолжается, откладывается или останавливает run, и `main-red`. Чистые функции; действия выполняет `src/main/autopilot/run.ts`. |
| `src/shared/autopilot/checkpoint.ts` | Состояние run-а, прочитанное обратно из его journal-а: очередь, Wave и её Ticket-ы в работе, ожидание, повторы, лестница, оборван ли run, и что journal-ы Project-а оставляют `resumable`. Чистые функции. |
| `src/main/autopilot/run.ts` | `continueCutOff` при старте приложения, `resumeCutOff` и `discardCutOff`: продолженный run с его id, journal-ом, ожиданием и нумерацией Wave, и run, оставленный оборванным по правилу часа. Само правило часа — `restartDecision` в `src/shared/autopilot/cycle.ts`. |
| `src/main/autopilot/held-tickets.ts` | Ticket-ы оборванной Wave, удержанные для человека: внешние вызовы без результата в транскрипте session Orchestrator-а и его Subagent-ов, по `unknownSideEffects` из `src/shared/agent/unknown-side-effects.ts`. |
| `src/renderer/autopilot/unknown-side-effects.ts` | Метки unknown side effects из состояния Autopilot по Project-у, тексты tooltip-а метки и toast-а, и Checked, include (`autopilot.include`). Метку рисует `src/renderer/canvas/nodes/TicketNode.tsx`; `src/renderer/canvas/ticket-card.ts` даёт ей строку. |
| `src/main/quit-grace.ts` | Координатор выхода: приостанавливает run-ы, ждёт внешние вызовы без результата, в том числе вызовы Subagent-ов Session-ов, прочитанные из их транскриптов, велит остановленным run-ам записать их background task-и убитыми, останавливает Session-ы и велит run-ам написать `run-suspended`; следит за выключением системы (`powerMonitor` на macOS и Linux, `session-end` окна на Windows). Окно — `src/renderer/shell/QuittingDialog.tsx`. |

#### Test-ы

Эти test-ы не вызывают модель. Contract test-ы используют настоящие Session registry, Orchestrators, launcher, journal и
цикл поверх fake agent, который проигрывает скрипты из `test/fixtures/agent-scripts/`.

| Test | Что покрывает |
|---|---|
| `test/unit/autopilot-resume-at.test.ts` | Когда run продолжает после отказа. |
| `test/unit/turn-failure.test.ts` | Какой упавший turn — временная ошибка API: тексты ошибок Claude Code, виды ошибок Codex с HTTP status и без него (429 не временная), прерванный turn. |
| `test/unit/continue-plan.test.ts` | План повтора: паузы и предел, порядок отказов (`not-transient`, потом `in-flight`, потом `cap`), какие вызовы turn-а выходят за пределы Session, и текст продолжения, в котором никогда нет исходного сообщения и собственных слов модели. |
| `test/unit/limits-wait-still-refused.test.ts` | Окна, прочитанные заново перед продолжением после Limits на Codex: окно, которое ещё исчерпано, ждёт снова, при неудачном чтении решают известные окна, Force stop и выход из приложения чтения не ждут. |
| `test/contract/autopilot-limits.test.ts` | Ожидание Limits и бюджет, с часами, которые двигает test. |
| `test/contract/autopilot-limits-switch.test.ts` | Ожидание Limits с выключенным и включённым Auto-continue: недельное окно без 5-часового, сброс через 3 дня с отпущенным и снова взятым keep-awake, нет времени сброса, переключатель выключен во время ожидания. |
| `test/contract/autopilot-retry.test.ts` | Повтор после ошибки API с выключенным и включённым Auto-continue: 500 и одно продолжение, 529 до `cap` с паузами плана, 400, push без результата и секреты его команды, Limits (и во время ожидания), turn background task-а, Stop (и второй во время остановки), Force stop, выход из приложения и переключатель, выключенный во время ожидания; Retry now обратного отсчёта (одно продолжение, и после двойного клика, и после таймера) и Cancel (`turn-error`, `limits-timeout`, ничего не отправлено; Cancel, вставший в очередь за продолжением, ничего не находит, и run идёт дальше). |
| `test/contract/codex-auto-continue.test.ts` | Auto-continue на Orchestrator-е Codex поверх fake app-server, в run-е и в ручном turn-е: `serverOverloaded` и одно продолжение, ошибка, которую Codex повторяет сам, `vendor-quota`, вызов Subagent-а без результата (`in-flight`) и окна, прочитанные заново при сбросе ручного ожидания Limits. |
| `test/unit/autopilot-invariants.test.ts` | Правила восстановления на journal-ах из `test/fixtures/autopilot-faults/`: хороший run не нарушает ни одного, а каждое правило ловит испорченную для него копию. Run, приостановленный посреди Wave, в ожидании Limits или Start window, run, убитый без конца, отброшенный run и Force stop тоже не нарушают ни одного. |
| `test/unit/autopilot-checkpoint.test.ts` | Checkpoint на этих fixture-ах, у каждой своё состояние и признак, оборван ли run; run над очередью со всеми строками, которые читает checkpoint; что journal-ы Project-а оставляют resumable, run за run-ом; строка вида, который пишет более поздняя сборка, пропускается и считается; помеченный Ticket, который не resumable до `side-effects-checked`, включённые Ticket-ы, пока их не понесёт Wave, и метка, которая переходит к следующему run-у Epic-а. |
| `test/contract/autopilot-checkpoint.test.ts` | Force stop посреди Wave 1, затем перезапуск приложения (новый `Autopilot` над теми же journal-ами): следующий run Epic-а берёт прерванные Ticket-ы из journal-а. Run, оборванный падением, не оставляет ни одного. |
| `test/contract/autopilot-faults-api.test.ts` | Fault scenario-и API модели: API 500, 529 посреди потокового ответа (не принимается за Limits) и обрыв связи останавливают run с `turn-error`, и новый старт шлёт свою команду Wave один раз; Limits, отказавшие turn-у Wave 2, — run ждёт и продолжает после сброса одним продолжением, Wave 1 второй раз не идёт. |
| `test/contract/autopilot-faults-retry.test.ts` | Те же Fault scenario-и API модели с включённым Auto-continue: API 500, 529 посреди потокового ответа и обрыв связи дают `turn-retry`, одно продолжение и `resumed`, и run идёт дальше; пять 529 подряд кончаются `retry-refused` `cap`, а `git push` без результата — `retry-refused` `in-flight`, оба потом `turn-error`; Limits, которые отказывают turn-у Wave 2 по недельному окну без 5-часового, заставляют run ждать этого сброса. Правила I1–I10 ниже выполняются в каждом. |
| `test/contract/autopilot-faults-process.test.ts` | Fault scenario-и процессов: Claude Code Orchestrator-а умирает, пока работают оба implementer-а (`session-error`, и новый старт идёт в новую Session, а его первая Wave называет Ticket, который всё ещё `claimed` умершим implementer-ом, вместе с готовым); implementer падает, и его Ticket остаётся `claimed` (run ждёт время успокоения, затем продолжает его в следующей Wave) или возвращается в `open` (следующая Wave — только с этим Ticket-ом). |
| `test/contract/autopilot-faults-ladder.test.ts` | Fault scenario-и лестницы продолжений: Ticket, оставленный `claimed`, продолжается и доходит до `done`; Ticket, всё ещё `claimed` после 2 продолжений, откладывается, Orchestrator блокирует его с `Waits: owner`, и run переходит к следующему Epic-у очереди; просьба отложить, которую Orchestrator не выполнил, кончается `wave-unfinished`; красный main останавливает run с `main-red` без продолжения; `no-progress` проходит ту же лестницу. |
| `test/contract/autopilot-faults-github.test.ts` | Fault scenario-и на стороне GitHub: режим `hang` у gh stub; gh висит весь run (Wave-ы идут, остановка ждёт не дольше предела последнего чтения); gh отвечает 502 (следующее чтение — через удвоенный интервал); конфликт merge (run останавливается с `blocked-tickets`, новый run не берёт заблокированный Ticket). |
| `test/contract/autopilot-faults-codex.test.ts` | Fault scenario-и на Orchestrator-е Codex: упавший turn останавливает run с `turn-error`; app-server, вышедший посреди Wave, даёт `session-error`, и новый run стартует в новой Session; Ticket, всё ещё `claimed` после 2 продолжений, откладывается, и run переходит к следующему Epic-у. |
| `test/unit/autopilot-continuation.test.ts` | Тексты лестницы слово в слово и то, что последние слова модели в них никогда не попадают. |
| `test/unit/quit-grace.test.ts` | Координатор выхода на часах test-а: порядок его шагов, нет ожидания без внешних вызовов, предел 60 секунд, Quit now, второй выход, выключение до ожидания и во время него, какие вызовы считаются открытыми, и что Session, чей процесс ушёл, теряет свои вызовы; Session-ы держат свои очереди с первого шага, в том числе Session, запущенная позже, и конец turn-а после этого ничего не шлёт из очереди; background task-и остановленного run-а записываются убитыми до остановки turn-ов; остановка ждёт прерванный turn до своего предела, прежде чем закрыть Session, и шлёт SIGKILL процессу, который не слушает interrupt, только через 7,5 секунды, и до этого ничего не пишется; вызовы Subagent-ов, читаемые заново каждую секунду, пока у них нет результата, и какие файлы Subagent-ов считаются. |
| `test/unit/autopilot-unknown-side-effects.test.tsx` | Toast unknown side effects: один на метку, с вызовами и Ticket-ом; Checked, include просит main о Ticket-е, и метка уходит из store, отказ — toast с ошибкой; store следует за самым новым состоянием main. |
| `test/contract/autopilot-faults-quit.test.ts` | Fault scenario-и выхода: посреди Wave (`run-suspended` с Wave и её Ticket-ами, без `run-stopped`); `git push` без результата, который ждут до последней миллисекунды 60 секунд на часах test-а; его результат до предела; Quit now; ожидание Limits (`run-suspended` несёт ожидание и время его конца, и после ничего не продолжается); выключение системы, без ожидания; `gh pr merge` Subagent-а без результата, прочитанный из его транскрипта и ожидаемый до последней миллисекунды 60 секунд. |
| `test/contract/autopilot-background.test.ts` | Среди сценариев background task-ов: выход в его настоящем порядке (приостановка, остановка turn-ов, записи) записывает task-и остановленного run-а, который ещё их ждёт, и Session, которую он вернул, как `tasks-killed`, никогда как `orchestrator-returned`, и отпускает keep-awake. |
| `test/unit/update-quit.test.ts` | Restart now у Update выходит через координатор с причиной `update`, а не собственным выходом Electron. |
| `test/e2e/autopilot-quit.spec.ts` | Выход в собранном приложении, пока у `git push` Wave нет результата: окно Quitting worfy называет команду с оставшимся временем, Quit now выходит сразу, и journal кончается `run-suspended`. Сохраняет окно в светлой и тёмной теме в `test-results/e2e/snapshots/04-quitting-worfy/`. |
| `test/contract/autopilot-faults-restart.test.ts` | Run, продолженный после перезапуска приложения: выход посреди Wave и падение (тот же id и journal, `run-continued`, одна новая Wave с возобновлёнными оборванными Ticket-ами, оборванная Wave снова не отправлена); выход во время ожидания Limits (ожидание идёт до своего времени конца, до него ничего не уходит); третий старт за час (`cut off by restart`, старт отклонён, Resume); Discard (`run-stopped` `discarded`, и следующий run берёт Ticket-ы с собой); implementer, оборванный в `gh pr merge` (его Ticket удержан вне Wave); implementer, оборванный в `git push` (`unknown-side-effects` с Ticket-ом и командой, метка в состоянии, Force stop, который оставляет его вне `resumable`, и Checked, include, который возвращает его); Checked, include, пока продолженный run идёт (следующая Wave берёт Ticket как возобновлённый). |
| `test/unit/autopilot-restart.test.ts` | Правило часа и его cap, первое состояние продолженного run-а, строка `cut off by restart · 14:05` и какие Ticket-ы удерживает транскрипт, каждый с вызовами, которые его держат. |
| `test/unit/autopilot-cut-off-line.test.tsx` | Строка run-а, оборванного по правилу часа: Resume и Discard, toast, неактивная кнопка Autopilot и нет кнопок с доступом Read only на Linked machine. |
| `test/e2e/autopilot-faults.spec.ts` | Fault scenario-и в собранном приложении: приложение убито SIGKILL посреди Wave и запущено снова (тот же run идёт дальше с `run-continued` после `crash` и одной новой командой Wave, 01 возобновлён и 02); то же убийство, пока implementer 01 выполняет `gh pr merge 41 --squash` без результата (run идёт дальше только с 02, в journal-е есть `unknown-side-effects`, у 01 метка с вызовом в tooltip-е и toast, а «Checked, include» пишет `side-effects-checked` и снимает метку); run, оборванный в третий раз за час (строка с Resume и Discard, ничего не отправлено, Resume продолжает его; сохраняет строку в светлой и тёмной теме в `test-results/e2e/snapshots/autopilot-cut-off-by-restart/`); GitHub недоступен весь run (обе Wave-ы проходят, `gh` только читали). |

**Fault scenario-и.** Fault scenario — test, который вносит один сбой в run на fake agent над временным Project-ом — ошибку API
модели, умерший процесс, `gh`, который висит или падает, конфликт merge, приложение, убитое посреди Wave, — и потом проверяет правила
восстановления. `checkRecovery` в `test/autopilot-invariants.ts` берёт то, что run оставил: файлы journal, сообщения, которые получил
Orchestrator, вызовы `gh`, изменения `Status:`, которые test записал за Orchestrator-а, и файлы Project-а до и после. Он возвращает по
строке на каждое нарушение, и каждый сценарий ждёт пустой список. Правила:

- **I1.** У каждой `wave-started` ровно одна команда `/epic-wave` с её Ticket-ами, и Wave-ов столько, сколько ждёт сценарий.
- **I2.** Каждый вызов `gh` — чтение: `pr list`, `auth status`, `auth token` или `api` на репозиторий без опции, которая пишет.
- **I3.** У каждого Ticket-а строки `ticket-status` run-а — это изменения его `Status:` за run, по порядку. После Force stop, выхода из
  приложения, Discard или в run-е без `run-stopped` (как после убитого приложения) последних изменений может не быть, более ранних — всегда есть.
- **I4.** У run-а сценария один `run-stopped` с ожидаемой причиной, после строки, которая этой причине нужна (например, `session-error`
  перед `turn-error`). Убитое приложение не оставляет `run-stopped`. У run-а, пережившего сбой, есть строка `resumed`. Выход
  приостанавливает run: ни у одного run-а нет `run-stopped` с `app-quit`, а run, который сценарий ждёт приостановленным, кончается
  `run-suspended` с ожидаемой причиной. У run-а, который пошёл дальше после перезапуска, есть `run-continued` с ожидаемым `after`,
  сразу после его `run-suspended`, когда его приостановил выход, и никогда после его `run-stopped`.
- **I5.** Человек не вмешивался: нет строк `human-input` и `refused-dialog`.
- **I6.** Новый старт после остановки не получает отказа и начинает свой journal с `run-started`. Journal начинается только после
  того, как в предыдущем есть `run-stopped`: после перезапуска оборванный run идёт дальше в своём journal-е, а новый начинается, только
  когда тот остановился или был отброшен.
- **I7.** worfy ничего не пишет в Project: каждый файл, который изменился, записал test.
- **I8.** Каждая строка каждого journal читается. Убитое приложение может оставить одну оборванную последнюю строку; если run потом
  пошёл дальше, эта строка стоит сразу перед его `run-continued`.
- **I9.** У Ticket-а не больше 2 строк `ticket-continued` за run. После его `ticket-set-aside` он `blocked`, или run
  остановился с причиной просьбы отложить.
- **I10.** Ticket, помеченный строкой `unknown-side-effects`, не входит ни в одну более позднюю `wave-started` — ни своего run-а, ни
  более позднего — до его `side-effects-checked`.

Contract-сценарии собирают run через `faultRun()` из `test/contract/autopilot-faults-setup.ts`: настоящие Session registry,
Orchestrators, launcher, journal, `LimitsTracker`, `PrTracker` и `Autopilot`, часы, которые двигаются, только когда их двигает test, и
gh stub из `test/contract/gh-world.ts`. E2e-сценарии готовят Project, папку данных и gh stub через `test/e2e/autopilot-world.ts`.
