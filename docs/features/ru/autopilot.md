# Autopilot

> Перевод [английской версии](../autopilot.md), commit `same-pr`.

Autopilot ведёт Wave-ы одного Epic-а одну за другой, без человека у Orchestrator-а. Он отправляет Wave, ждёт её конца,
отправляет следующую готовую Wave и останавливается, когда готовой Wave нет или что-то пошло не так. Один такой проход
по Epic-у или по очереди Epic-ов, одного за другим, называется **run**. Если термины незнакомы, начните с
[Concepts](concepts.md).

## Autopilot

### Behaviour

#### Запуск run-а

На рамке Epic-а на Canvas есть кнопка **Autopilot**. Кнопки нет, только когда все Ticket-ы Epic-а в `done` и у Epic-а нет
идущего run-а, строки состояния прошлого run-а, остановки в пути и отказа «running on <Machine>». Поэтому после оконченного
run-а она остаётся неактивной, пока приложение не перезапустят или Project не запустит другой Epic. На рамке без кнопки
всё равно есть меню «⋯», только с **Run history**, если у Epic-а есть прошлые run-ы. Кнопка активна, когда мог бы
сработать «Run wave» и шаблон «Run wave» Project-а называет Ticket-ы Wave через `{tickets}`. Её tooltip говорит, что она
делает, что экран останется включённым до конца run-а, в каком Run mode стартует кнопка (режим по умолчанию из Settings →
Autopilot), и Epic forecast для того, что осталось от Epic-а. Эти строки приводит страница [Run planning](run-planning.md).

Клик по кнопке run не запускает: он открывает окно **Start Autopilot** внутри worfy
(`src/renderer/autopilot/StartAutopilotModal.tsx`). Окно показывает Project, Epic, его Ticket-ы и сколько Wave осталось,
Vendor и Session Orchestrator-а, прогноз против бюджета, Limits сейчас и Modes (Eco mode, Auto-approval, Auto-continue)
со ссылкой «change in Modes» на меню Modes Orchestrator-а ([Orchestrator modes](orchestrator-modes.md)). Эти факты main читает по каналу `autopilot.prepare`, из тех же
источников и с теми же строками прогноза, что и диалог `autopilot_start`. Ниже человек выбирает Run mode: Fastest,
Budget-aware или Start window; режим по умолчанию из Settings → Autopilot помечен «(default)» и выбран. Фокус стоит на
**Cancel**, Esc — это Cancel, ⌘↩ (Ctrl+Enter на Windows) — главная кнопка. Главная кнопка — **Start Autopilot**, а пока
Orchestrator занят — **Start when free**; окно тогда говорит, чем он занят. Окно закрывается, как только main ответил;
отказ — это toast и tooltip кнопки, как сказано ниже. **Start anyway** стартует сразу, в режиме по умолчанию, без окна.

**Run all accepted** в Command palette, а также в меню «⋯» рамки Epic-а, пока у Project-а нет run-а, открывает то же окно
над очередью: все Epic-и Project-а, чей spec принят владельцем и у которых есть готовый Ticket, от самого раннего
принятия (не больше 10). Заголовок окна считает отмеченные Epic-и и их Wave-ы, `Start Autopilot · 3 Epics, 6 Waves`, а под
ним стоит `3 Epics are accepted and waiting. Autopilot runs them one after another.` Вместо Epic-а и его Ticket-ов окно
показывает очередь (`src/renderer/autopilot/QueueList.tsx`): у каждого Epic-а — отметка, его место среди отмеченных, имя,
сколько Wave осталось и `accepted <date>`. Снимите отметку, чтобы убрать Epic; перетащите строку или нажмите ⌥↑/⌥↓
(Alt+↑/↓ на Windows) на её grip, чтобы её передвинуть. Каждое изменение заново спрашивает `autopilot.prepare` об
отмеченных Epic-ах в их порядке, поэтому прогноз считается для них. Если ничего не отмечено, прогноз говорит
`No Epic is ticked`, а главная кнопка неактивна. Старт идёт с отмеченными Epic-ами в порядке списка. Если принятого Epic-а
с готовым Ticket-ом нет, toast говорит `No accepted Epic has a ready Ticket`, и окно не открывается. На экране Linked
machine с доступом read-only команда неактивна.

Старт получает отказ в таких случаях. Причина видна в tooltip кнопки и в toast ошибки:

- У Project-а уже есть run. У Project-а не больше одного run-а одновременно.
- Шаблон «Run wave» пуст или в нём нет `{tickets}`.
- У Project-а нет такого Epic-а, или workflow не читается.
- Project — это собственный репозиторий worfy, а сборка development. Считается любой checkout этого репозитория, worktree
  тоже.
- Тот же Epic того же репозитория идёт или стартует на Linked machine либо в другом Project-е этой Machine. Под кнопкой
  появляется chip «running on <Machine>», а рядом кнопка **Start anyway**. Для очереди спрашивают о каждом её Epic-е, и
  один Epic, который идёт в другом месте, даёт отказ всему старту. После **Run all accepted** вместо toast ошибки окно
  остаётся открытым: `Runs elsewhere:` с причиной и красная **Start anyway** рядом со стартом. Она запускает ту же
  очередь, в том же порядке и Run mode, без проверки для каждого её Epic-а. Другая отметка, порядок или режим убирают
  причину и кнопку, и старт спрашивает снова. У `autopilot_start` агента такой кнопки нет: worfy запускает его очередь
  после ответа, и отказ получает Session, которая просила.

Старт с отказом не пишет journal и не держит экран включённым. «Start anyway» запускает run, хотя оба run-а будут брать
одни и те же Ticket-ы. Другого пути мимо этого отказа нет, и он действует на весь run: об Epic-е, который добавили в его
очередь позже, тоже не спрашивают. Linked machine, которая не подключена или не ответила за 3 секунды, старт не
блокирует: chip «on <Machine>» называет её в своём tooltip. Project без remote `origin` никого не спрашивает.

**Пока Orchestrator занят** — в turn-е, с живыми background task-ами или с сообщениями в очереди — старт не получает
отказ. Run начинается сразу, его journal открывается строками `run-started` и `orchestrator-busy`, а строка состояния говорит
`waiting for the Orchestrator · 4 min`. Первую Wave run отправляет, когда Orchestrator свободен: turn кончился, очередь
пуста, живых background task-ов нет, и за две минуты после конца последней задачи не начался новый turn. Сообщение,
отправленное во время ожидания, ожидание продлевает. Затем проверки из списка выше идут заново: отказ в этот момент
останавливает run с `start-refused` и причиной — в journal и notice-ом в Session, которая просила старт из чата.
keep-awake включается только при настоящем старте. **Stop** (и Force stop) на ожидающем run-е его отменяет:
`start-cancelled`, Orchestrator не трогается. **Start now** (канал `autopilot.startNow`) не ждёт: останавливает turn и
background task-и Orchestrator-а, пишет их в journal как `tasks-killed` с причиной `start-now` и сразу запускает run.
Проверки из списка выше идут и здесь, так что Start now тоже может закончить run с `start-refused`.
Сообщения очереди run-у не уходят: они возвращаются в Session человека после run-а, придержанными
([ADR-0099](../../adr/0099-run-waits-for-orchestrator.md)).

На Canvas рядом со строкой состояния ожидающего run-а стоят **Start now** и **Cancel**. **Cancel** отменяет run сразу,
без подтверждения, как Stop, и toast говорит `Autopilot cancelled; the Orchestrator was not touched`. **Start now**
сначала открывает маленькое окно **Start now?** (`src/renderer/autopilot/StartNowModal.tsx`):
`Autopilot <Epic> starts right away. This stops:`, затем `✕ the running turn`, пока идёт turn,
`✕ 3 background tasks: <names>` и `✓ 2 queued messages stay in the queue`. Пока окно открыто, список следует за тем, чем
занят Orchestrator, а когда run перестаёт ждать, окно закрывается само. Фокус — на **Cancel**, Esc — это Cancel: run
ждёт дальше. Красная **Interrupt and start** вызывает `autopilot.startNow`. Toast затем говорит, что остановлено, как это
перечисляло окно: `Turn interrupted, 3 background tasks stopped · Autopilot started`. `start-refused` в этот момент —
toast ошибки с причиной.

Сам по себе run не стартует, и после перезапуска приложения тоже.

#### Запуск run-а из чата

Команда `/worfy:epic-wave`, набранная в чате Session, и просьба словами, после которой агент вызывает canvas-инструмент
`autopilot_start`, запускают тот же run, что и кнопка: [Starting Autopilot from a chat](autopilot-chat.md).

**Что не является run-ом.** «Run wave» на Canvas или в Command palette отправляет Orchestrator-у одну Wave и run не
запускает. Так же и Wave, которую Claude Code ведёт в терминале. У такой Wave нет journal, строки состояния, toast-а
остановки и Run history.

#### Во время run-а

Строка над кнопкой показывает состояние run-а:

| Строка состояния | Значение |
|---|---|
| `starting` | Run начался, Wave ещё не ушла. |
| `waiting for the Orchestrator · 4 min` | Run начался и ждёт, пока у Orchestrator-а кончатся turn, очередь и background task-и. В первую минуту — без минут. Рядом — **Start now** и **Cancel**. |
| `Wave 2 · running` | Run отправил вторую Wave. Wave считаются внутри run-а с 1 и снова с 1 для каждого Epic-а очереди; это не номер Wave в плане Epic-а. |
| `Wave 2 · 4 background tasks` | То же, и у Orchestrator-а четыре живых background task-а. |
| `waiting for limits · resumes 14:20` | Limits отказали turn-у. Run продолжит в это время. |
| `API error · retry 2/5 · 14:20` | Turn закончился временной ошибкой API, и Auto-continue включён: второй повтор из пяти уходит в это время. |
| `today's share used · resumes 00:00` | Бюджет остановил следующую Wave. |
| `5-hour limits full · resumes 02:12` | Бюджет остановил следующую Wave: доля дня осталась, окно на 5 часов заполнено. |
| `outside start window · resumes 23:00` | Run mode — Start window, и окно не открыто. Run продолжит, когда оно откроется. |
| `wave too long for window · resumes 23:00` | Run mode — Start window: следующая Wave обычно идёт дольше, чем осталось от окна. |
| `stopping · 2 tickets in work` | Пришёл Stop. Два Ticket-а текущей Wave в работе. Если таких нет, строка говорит `stopping`. |
| `stopped: no ready wave` | Run окончен, с причиной (см. [Почему run останавливается](autopilot-faults.md#почему-run-останавливается)). |
| `stopped: turn error · 2 background tasks still run` | Run окончен и сразу отдал Orchestrator человеку; две его фоновые задачи ещё идут там. |
| `Epic 2/3: checkout · Wave 1 · running` | Run над очередью из трёх Epic-ов идёт по второму, `checkout`. Любая строка выше получает такое начало, когда в очереди больше одного Epic-а, и после остановки тоже. |

**Run над очередью Epic-ов** проходит её по порядку, по одному Epic-у за раз, в одном Run mode; названные Ticket-ы
бывают только у очереди из одного Epic-а. Когда у Epic-а не осталось Wave (`no-ready-wave`, `blocked-tickets`,
`tickets-done`), решает свежее чтение. Все Ticket-ы в checkout-е выполнены: начинается следующий Epic. Остались только
Ticket-ы для владельца (`blocked` с `Waits: owner`, без статуса или заблокированные только такими Ticket-ами): Epic
пропускается с `waits-owner`, и начинается следующий. Любая другая остановка или другие оставшиеся Ticket-ы
останавливают весь run. Дойдя до следующего Epic-а, run снова спрашивает Linked machines; Epic, который идёт в другом
месте, пропускается. Когда Epic-ов не осталось, run останавливается с причиной последнего, но сначала отдаёт ход gate
queue ([Почему run останавливается](autopilot-faults.md#почему-run-останавливается)). Исключение одно: в последнем
Epic-е остались только Ticket-ы для владельца. Он получает `epic-finished` `waits-owner`, как пропущенный, и run
останавливается с `waits-owner` (`Epic 3/3: billing · stopped: waits for owner`), так что у одного и того же состояния
Epic-а одна причина, где бы он ни стоял в очереди. Run по одному Epic-у в этом случае, как раньше, останавливается с
`blocked-tickets`.

Строка стоит на рамке Epic-а, по которому идёт run, а её tooltip перечисляет очередь: каждый Epic со своим статусом
(`done`, `running`, `next`, `skipped: waits for the owner`, `skipped: runs on another
Machine`). Пока идёт run, на рамке каждого другого Epic-а очереди под кнопкой стоит chip: `In queue 3/3` — у ещё не
начатого, `Waits for owner` — у того, который run пропустил, потому что остались только Ticket-ы владельца, `Runs
elsewhere` — у того, который он пропустил, потому что его вела другая Machine. У выполненного Epic-а и у Epic-а, по
которому идёт run, chip-а нет. После остановки run-а chip-ы пропадают, кроме остановки с `waits-owner`: у последнего
Epic-а под строкой остаётся `Waits for owner`.

Очередь можно менять, пока идёт run, из меню «⋯» рамки Epic-а: **Add to queue** на Epic-е вне очереди ставит его в
конец, **Remove from queue** на ещё не начатом Epic-е убирает его. Порядок очереди ничто не меняет. Между Wave-ами — пока
run ждёт свой Orchestrator, бюджет или Start window — изменение вносится сразу. Во время Wave оно вносится в конце Wave:
toast говорит `Added search to the queue · applies after this
Wave`, а до тех пор на рамке стоит chip `Joins after this Wave` или `Leaves after this Wave`. **Remove from queue** на
Epic-е, который ждёт входа в очередь, отменяет его добавление. Внесённое изменение пишет в journal `queue-changed`, а
каждый убранный Epic — `epic-finished` с `removed`; такой Epic никогда не стартует. Изменение, которое ещё не внесено,
когда run останавливается, отбрасывается. Этих пунктов нет после того, как попросили Stop, и они неактивны на экране
read-only. Отказ (в очереди уже 10 Epic-ов, Epic не из этого Project-а, run по названным Ticket-ам) — это toast ошибки и
tooltip «⋯». Идущую очередь меняет только человек: команда в чате и инструмент `autopilot_start` получают отказ, пока
идёт run.

Пока идёт run:

- Orchestrator работает **unattended**. Он идёт в режиме `bypassPermissions`, какой бы режим ни был сохранён в Node; на
  Orchestrator-е Codex это preset «Full access» (sandbox `danger-full-access`, approvals `never`). В смене режима
  разрешений отказано. Когда run кончается, Node получает свои настройки обратно. Run ведёт Session Orchestrator-а и
  читает её события одинаково на любом Vendor-е. Codex выключает hook-и Harness после каждой установки или обновления
  Harness, пока вы их не одобрите, а без них gate и guard-ы workflow не действуют. Поэтому перед каждым стартом run-а на
  Orchestrator-е Codex, а также перед каждой следующей Wave и перед turn-ом gate queue worfy спрашивает Codex
  (`hooks/list`), одобрены ли hook-и plugin-а `worfy`: каждый hook, который его `hooks.json` объявляет на событии,
  которое запускает Codex, должен быть в списке, включён и одобрен. Пока это не так или Codex не отвечает, run получает
  отказ «The Harness hooks are not approved in Codex. Approve them in /hooks and start again.»; перед следующей Wave
  новая Session не стартует, и run останавливается с этой причиной в journal (`session-error`). Чтобы их одобрить,
  запустите Codex этой сборки в терминале, наберите `/hooks` и одобрите hook-и plugin-а `worfy`; шаг ниже показывает
  команду для копирования, потому что этого Codex нет в PATH ([Harness, In Codex](harness.md#in-codex)). После установки
  или обновления в Codex toolbar показывает шаг «Approve the Harness hooks in Codex» с этими инструкциями и кнопкой
  «Check again» в окнах, открытых в этот момент (окно, открытое позже, его не показывает). Пока проверка не найдёт их
  одобренными, пункт Harness говорит «Codex: approve hooks», и клик снова открывает шаг. Run на Claude Code не
  проверяется.
- Запрос разрешения, вопрос с вариантами ответа и `session.ask` от Card сразу получают отказ: отвечать некому. Approval,
  о котором Codex всё же спрашивает, получает `decline`. Каждый отказ идёт в journal. Если Claude Code назвал причину
  запроса разрешения, модель получает эту причину и может изменить команду.
- Auto-approval mode Project-а меняет судьбу запроса разрешения на обоих Vendor-ах, а в Shadow и On агент run-а
  стартует с собственной временной папкой run-а и git-окружением:
  [Auto-approval, Во время run-а](auto-approval.md#во-время-run-а).
- «Run wave» и «Process gate queue» вручную и «New conversation» у Orchestrator-а получают отказ.
- Человек по-прежнему может написать Orchestrator-у. То, что человек делает с его Session через worfy, идёт в journal как
  `human-input`: сообщение, сообщение от Card, Interrupt, «Send queued», удаление сообщения из очереди, смена настроек, в
  том числе та, в которой отказано. «Run wave», «Process gate queue» и «New conversation», получившие отказ, строки не
  пишут, и действия в других Session тоже.
- Interrupt turn-а Wave завершает run с причиной `interrupted`.
- Session использует только Browser profile с отметкой «Available to Autopilot», при открытии Browser обязана назвать
  Ticket этого Epic-а и никогда не входит в аккаунт. Подробности — на [странице Browser](browser.md).
- worfy просит систему держать экран включённым от начала run-а до конца, в том числе во время ожиданий ([Autopilot faults and recovery](autopilot-faults.md)).
- Если есть Linked machines, chip «on <Machine>» под кнопкой говорит, какая Machine ведёт run. Linked machine с полным
  доступом может запускать и останавливать run. С доступом read-only она видит состояние, а её кнопки неактивны. Run
  всегда выполняется на Machine Project-а.
- Когда в `main` собственного репозитория worfy в Harness есть изменения, которых нет в этой сборке, под кнопкой стоит
  chip «Harness in main is newer than the Stable copy», с run-ом и без него. Run продолжается как есть.

#### Auto-approval

Что worfy отвечает, когда агент run-а просит разрешения (режимы Off, Shadow и On, approval policy, запрос, который
ждёт владельца в park, и где смотреть решения), описано на странице [Auto-approval](auto-approval.md).

#### Когда Wave окончена

Wave окончена, когда верно всё это:

1. Turn Wave закончился без ошибки и без прерывания.
2. Session простаивает, и у неё нет живых background task-ов.
3. В свежем чтении workflow ни один Ticket Wave не в работе (`claimed`).

Затем run заново вычисляет готовую Wave. Если это тот же набор Ticket-ов, что и у только что оконченной Wave, run
останавливается с `no-progress`. Ticket Wave, который после turn-а остался открытым, Wave не держит.

Если после turn-а Ticket ещё в работе, run ждёт до 10 минут. Каждое изменение workflow проверяет заново, а новый turn
Orchestrator-а ждёт своего результата. После этого run останавливается с `wave-unfinished`.

Живые background task-и заставляют run ждать до одного часа без единого их события. Каждое событие task-а начинает этот
срок заново. Так же действует изменение output file живого task-а — файла, куда Claude Code пишет вывод фоновой команды и
который он называет в tool result, запустившем её: когда час вышел, run смотрит эти файлы ещё раз, и изменившийся за час
файл начинает срок заново. Поэтому gate full одной молчащей фоновой командой, которая пишет строку в конце каждого шага,
run не останавливает, а task, который перестал писать, останавливает его в пределах двух часов от последней строки.
Когда последний task закончился, run ждёт до 2 минут turn, который запускает его task-notification, а затем
оценивает Wave без этого turn-а.

Каждая Wave после первой в run-е идёт в новую SDK session Orchestrator-а, чтобы контекст не рос от Wave к Wave. Её первый
prompt ещё и велит Orchestrator-у выполнить `wave-brief <epic>`. Wave остаётся в текущей session, когда Orchestrator не
свободен (turn, живой task или сообщение в очереди), когда вышло время ожидания последнего turn-а, и со старым Harness, где
нет `wave-brief`.

#### Run mode, Start window и бюджет

Каждый run идёт в одном Run mode, который фиксируется на старте: **Fastest**, **Budget-aware** или **Start window**. Перед
каждой Wave, но никогда внутри неё, режим решает, начать следующую Wave сейчас или ждать: дневного бюджета Limits или
Start window. Отказ Limits внутри Wave в любом режиме остаётся жёстким пределом. Режимы, Start window, бюджет и Epic
forecast описаны на странице [Run planning](run-planning.md#run-mode-and-epic-forecast).

Run на Orchestrator-е Codex взвешивает бюджет по окнам Codex. Самое длинное окно занимает место окна на 7 дней. Каждое
более короткое окно занимает место окна на 5 часов: пока оно заполнено, следующая Wave ждёт его сброса. Оценка Wave и
прогноз в journal берут образцы только из прошлых run-ов на Codex. Codex сообщает только целые проценты, поэтому оценке
нужно 5 таких Wave, а не 3. Tooltip кнопки Autopilot и диалог `autopilot_start` Project-а, чей Orchestrator работает на
Codex, показывают прогноз по тем же образцам Codex и живым окнам Codex и говорят, что диапазон широкий, потому что Codex
сообщает только целые проценты.

#### Ожидания, остановки и восстановление

Как run ждёт Limits и повторяет turn после ошибки API, как он останавливается, что бывает после остановки и почему run
останавливается — на странице [Autopilot faults and recovery](autopilot-faults.md).

#### Journal

Каждый run пишет journal: один текстовый файл, в каждой строке один объект JSON. Это запись того, что произошло: каждая
Wave с отправленным текстом, пропущенные Ticket-ы, изменения статуса Ticket-ов, диалоги с отказом, действия человека с
Session, ожидания, background task-и и причина остановки. Экран [Run history](flight-recorder.md) рисует run по его journal
и другим источникам. Наблюдатель вне worfy может дописать строку `human-input` через `>>` — для действия, которое видно
только на экране, например в системном диалоге.

### How it works

**Run — это view над workflow.** worfy не пишет статус Ticket-а, это делают агенты через скрипт `ticket`
([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Конец Wave не приходит событием, поэтому run вычисляет
его по событиям Session Orchestrator-а и свежим чтениям workflow
([ADR-0024](../../adr/0024-autopilot-wave-end-and-keep-awake.md)). Run отправляет текст того же шаблона, что и «Run wave»,
и не знает протокола skill-а. Сообщение об остановке — просьба, а не протокол.

**Цикл.** Чистая функция получает состояние run-а и одно событие и отвечает следующим состоянием и списком эффектов. Фазы
такие:

| Фаза | Значение |
|---|---|
| `starting` | Ещё ничего не отправлено. |
| `sending` | «Run wave» в пути, или run ждёт бюджет или Start window перед отправкой. |
| `turn` | Wave отправлена, идёт turn. |
| `tasks` | Turn закончился, background task-и живы. |
| `settling` | Turn закончился, Ticket-ы Wave ещё в работе. |
| `stopped` | Run окончен. |

Все шаги run-а идут через одну очередь на run, поэтому события обрабатываются по порядку, а клик по Stop отмечается
раньше, чем его шаг встанет в эту очередь. Идущий шаг читает эту отметку прямо перед отправкой «Run wave», поэтому клик до
этого момента не даёт Wave уйти. Более поздний клик отправку не отменит: цикл отмечает остановку в фазе `sending`, а
сообщение об остановке идёт за Wave.

**Какой turn принадлежит Wave.** Wave может ждать в очереди Session за сообщением человека. Закончить Wave может только
turn, который начался с prompt-а этой Wave, или более поздний. Результат более раннего turn-а не может.

**Background task-и.** Skill `/epic-wave` запускает implementer-ов в фоне и заканчивает turn, пока Ticket-ы ещё открыты,
поэтому конец turn-а сам по себе ничего не значит. Их task-notification запускают новые turn-ы той же Wave
([ADR-0029](../../adr/0029-autopilot-waits-for-background-tasks.md)).

**Wave называет свои Ticket-ы.** Текст run-а называет Ticket-ы из одного чтения workflow, а journal хранит ровно то, что
ушло, потому что номер Wave из плана однажды отправил Orchestrator-а в закрытую Wave
([ADR-0033](../../adr/0033-autopilot-names-wave-tickets.md)).

**Unattended.** В любом режиме, кроме `bypassPermissions`, Claude Code спросил бы перед tool, и никто бы не ответил.
Поэтому смена режима получает отказ, а не применяется, а запуск не сохраняется вместе с Node
([ADR-0022](../../adr/0022-unattended-session-refuses-permission-mode-change.md)). В этом режиме Claude Code всё равно
спрашивает о некоторых своих проверках, поэтому отказы вообще и существуют.

**Остановки, ожидания и отказы.** Почему остановки две, почему ожидание идёт по wall clock и что считается отказом
Limits: [Autopilot faults and recovery](autopilot-faults.md#how-it-works).

**Бюджет, Start window и прогноз.** Как бюджет, Start window и Epic forecast вычисляются по journal-ам run-ов, описано на
странице [Run planning](run-planning.md#how-it-works).

**Один run на Epic и репозиторий.** Один репозиторий на двух Machine — это два Project-а, поэтому ключ run-а — Epic и
нормализованный адрес remote `origin` ([ADR-0053](../../adr/0053-several-screens-on-one-project.md)). Старт считает себя
среди run-ов этой Machine раньше, чем спрашивает. Поэтому, пока обе Machine отвечают, два одновременных старта одного
ключа могут оба получить отказ, но оба не пойдут. Machine, которая не подключена или не ответила за 3 секунды, считается
`unasked`, и тогда оба run-а могут идти. Вопрос идёт независимо от того, включён ли доступ для Linked machines: ответ
несёт только Epic и ключ каждого run-а. Очередь спрашивает обо всех своих Epic-ах на старте и о каждом следующем Epic-е
ещё раз, когда run до него доходит: другой run мог за это время стартовать.

**Очередь в одном run-е.** Run по нескольким Epic-ам — всё равно один run: один journal, один Run mode, один
Orchestrator, взятый один раз. Правило, которое переводит его к следующему Epic-у, — чистая функция причины остановки и
Ticket-ов Epic-а ([ADR-0100](../../adr/0100-run-epic-queue.md)). Очередь, о которой просил агент, в окне можно сократить
или переставить, но не расширить: main отказывает Epic-у, о котором Session не просила.

**worfy над самим собой.** Агенты Wave над worfy пересобирают приложение, поэтому development-сборка там получает отказ.
Harness в работающей сборке не меняется во время run-а. worfy только показывает, что он отстал, а Stable copy
пересобирают между run-ами ([ADR-0047](../../adr/0047-harness-lessons-by-pr-early-owner-switch.md)).

**Экран.** Run просит систему через power save blocker держать включённым не только систему, но и экран: e2e test-ам
агентов нужно окно ([ADR-0034](../../adr/0034-autopilot-keeps-display-awake.md)). Настройки системы worfy не меняет.

**Узкий круг исправления (narrow fix round).** Skill `/epic-wave` пишет свои вердикты комментариями `NARROW: …` в PR
Ticket-а ([ADR-0046](../../adr/0046-autopilot-narrow-round-without-owner.md)). Run только переносит их в journal. Он
читает их через тот же PR tracker, что и PR badges. Tracker ограничивает `gh` для них вместе: один список PR на папку
репозитория в минуту и один поиск за 5 минут для ветки, которой нет в этом списке. Badges опрашивают, только пока окно в
фокусе, поэтому без фокуса `gh` запускает собственное чтение run-а.

### Implementation

#### Модули

| Путь | Что там |
|---|---|
| `src/main/autopilot/run.ts` | Класс `Autopilot` и один `Run`: проверки старта, события Session, эффекты цикла, остановки, возврат Orchestrator-а. |
| `src/shared/autopilot/cycle.ts` | Цикл: фазы, события, эффекты, причины остановки и их сроки. Чистые функции. |
| `src/main/ipc/autopilot.ts` | Обработчики IPC и `sharedAutopilot`, который связывает с run-ом Project-ы, Orchestrator-ы, Session-ы, watch и journal приложения. |
| `src/shared/ipc/autopilot.ts` | Каналы IPC `autopilot`, состояние run-а и текст строки состояния. |
| `src/main/actions/launch.ts` | `autopilotWave`, `autopilotRefusal`, `autopilotGateQueue`: текст из шаблона, отправленный Orchestrator-у. |
| `src/shared/actions/render-template.ts` | `runWaveState`: решение и текст, общие с кнопкой. |
| `src/shared/workflow/waves.ts` | `readyWave`: готовая Wave и пропущенные Ticket-ы. |
| `src/main/agent/orchestrator.ts` | `setUnattended`, `giveBackNow`, `newUnattendedSession` и отказы из-за turn-а, task-ов или очереди. `busy` — чем занят Orchestrator; `takeNow` — Start now. `runsOn` — Vendor, на котором идёт run; `unattendedRefusal` — отказ Vendor-а, на котором Harness не действует. |
| `src/main/agent/app-orchestrators.ts` | Vendor Orchestrator-а, `defaultVendor` Project-а, который читается при старте Orchestrator-а. |
| `src/shared/autopilot/budget-window.ts` | Какое окно Limits читает бюджет run-а: окна Claude Code на 7 дней и на 5 часов или окна Codex по длине. Чистые функции. |
| `src/main/vendors/codex/harness-hooks.ts` | Одобрены ли hook-и Harness в Codex (`hooks/list`), и отказ run-у на Codex, пока они не одобрены. |
| `src/renderer/harness/CodexHooksStep.tsx` | Шаг «Approve the Harness hooks in Codex» с «Check again». |
| `src/main/agent/session-settings.ts` | Запуск Session и принудительный режим разрешений. |
| `src/main/agent/permissions.ts` | `unattendedCanUseTool`: отказ на каждый запрос. |
| `src/main/agent/session.ts` | `halt` для Force stop, `refuseDialog`. |
| `src/shared/autopilot/journal.ts` | Формат journal, описанный в комментарии в начале файла, с разбором и записью строки. Чистые функции. |
| `src/main/autopilot/journal.ts` | Файлы journal: открыть, дописать, перечислить, прочитать. |
| `src/main/autopilot/power.ts` | `KeepAwake` поверх `powerSaveBlocker` из Electron. |
| `src/main/autopilot/origin.ts` | Ключ remote `origin`. |
| `src/main/link/autopilot-runs.ts` | Вопрос о run-ах между Linked machines, два служебных сообщения link. |
| `src/main/autopilot/harness-drift.ts` | Новее ли Harness в `main`, чем в этой сборке. Только чтение, без `git fetch`. Только packaged-сборки. |
| `src/main/mcp/browser-server.ts` | Что Session в Autopilot может делать с Browser. |
| `src/main/ipc/card-api.ts` | Отказ `session.ask` от Card для unattended Session. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | Кнопка, меню «⋯», строка состояния и chip-ы; Start now и Cancel ожидающего run-а. |
| `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/start-modal.ts` | Окно Start Autopilot и его одна открытая просьба: от кнопки, от Run all accepted или от агента; старт очереди, toast её отказа и Start anyway, когда её Epic идёт в другом месте. |
| `src/shared/ipc/autopilot-prepare.ts`, `src/main/ipc/autopilot-prepare.ts`, `src/main/autopilot/prepare.ts` | `autopilot.prepare`: факты окна, только чтение, из источников просьбы `autopilot_start`; Wave-ы и прогноз очереди, один Epic за другим. |
| `src/shared/autopilot/epic-queue.ts` | Правило очереди: следующий Epic, Epic, пропущенный ради владельца, или остановка run-а; не больше 10 Epic-ов. Чистые функции. |
| `src/shared/workflow/accepted-epics.ts` | Принятые Epic-и для Run all accepted и `accepted`: дата принятия из `epic-status --json` и готовый Ticket. |
| `src/renderer/autopilot/StartNowModal.tsx` | Окно «Start now?»: что Start now остановит и что останется. |
| `src/renderer/autopilot/QueueList.tsx` | Очередь Epic-ов в окне Start Autopilot: отметка, перетаскивание, ⌥↑/⌥↓, Wave-ы и дата принятия у каждого Epic-а. |
| `src/renderer/settings/AutopilotSection.tsx` | Settings → Autopilot. |
| `scripts/install-stable.mjs` | `pnpm install:stable`: Stable copy. |

Модули Run mode, бюджета и Epic forecast перечислены на странице [Run planning](run-planning.md#модули).

Модули ожидания Limits и повтора после ошибки API перечислены на странице
[Autopilot faults and recovery](autopilot-faults.md#модули).

Модули старта из чата перечислены на странице
[Starting Autopilot from a chat](autopilot-chat.md#модули).

#### Поток данных

1. Кнопка открывает окно Start Autopilot, которое читает свои факты по `autopilot.prepare`; его старт вызывает
   `autopilot.start`, с `epics` для очереди. `Autopilot.start` выполняет проверки по порядку: у Project-а нет run-а,
   отказ для собственного репозитория и шаблон, workflow и Epic, затем ключ origin и вопрос к Linked machines.
2. Run открывает journal (`run-started`). Пока `Orchestrators.busy` сообщает turn, сообщения в очереди или живые task-и,
   run ждёт (`orchestrator-busy`); освободился — пишет `orchestrator-free` и выполняет проверки заново. `setUnattended`
   заново запускает Session Orchestrator-а как unattended, продолжая её SDK session, или отказывает. Затем run пишет
   `forecast`, включает keep-awake, подписывается на события Session и
   открывает watch workflow, который сообщает только об изменениях полей Ticket-ов.
3. Событие `start` идёт в цикл. Его эффект `send-wave` запускает `sendWave` в run-е: тот спрашивает расход, проверяет Run
   mode (Start window и бюджет), запускает новую SDK session для Wave после первой и вызывает `autopilotWave`. Launcher
   читает workflow один раз и берёт из этого чтения текст, Ticket-ы и пропущенные Ticket-ы. Он отправляет текст через
   Session, которая начинает turn или ставит его в очередь, и привязывает Session к Epic-у.
4. События Session (`prompt`, `result`, `state`, `background_tasks`, `refused_dialog`) и изменения workflow становятся
   событиями цикла, каждое со свежим чтением workflow, где циклу оно нужно. Каждый эффект идёт в journal или в Session.
5. `end` пишет `run-stopped`, убирает сообщения run-а из очереди и возвращает Orchestrator через `setUnattended`. Если turn
   или task живы, остановка по причине самого run-а отдаёт его на ходу (`giveBackAsItRuns`: `Session.becomeAttended`
   переводит живой процесс в настройки Node), сразу пишет `orchestrator-returned`, а `watchReturned` держит keep-awake и
   счёт task-ов в строке состояния до их конца. После Stop autopilot (`waitForWork`) или при отказе в этой смене возврат
   ждёт их конца, а `linger` следит за этим для journal. Force stop идёт вместо этого через `interruptAndGiveBack`.
6. Каждое новое состояние идёт во все окна как `autopilot.changed`. Клиент оставляет состояние с наибольшей revision.

Остальные каналы — `autopilot.stop`, `autopilot.forceStop`, `autopilot.state` и `autopilot.estimate`. Запрос состояния
ещё и заново спрашивает, не чаще раза в минуту, не отстал ли Harness.

#### Файл journal

Файл — `<data folder>/autopilot/<run>.jsonl`, один на run, без ротации. На macOS папка данных packaged-приложения —
`~/Library/Application Support/worfy`, development-сборки — `~/Library/Application Support/worfy-dev`, а
`WORFY_DATA_DIR` заменяет обе. Вне её ничего не пишется ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). Id
run-а — время старта в UTC и шесть шестнадцатеричных цифр, поэтому имена файлов сортируются по времени старта. В каждой
строке есть `at`, `run`, `project`, `epic` (Epic, по которому идёт run) и `kind`. Читатель пропускает и считает строку,
которую не может прочитать.

| Kind | Когда пишется |
|---|---|
| `run-started` | Run начался. Есть `origin`, а также `override` или `unasked`, когда они применимы. `by` говорит, кто его запустил: `button`, `command` или `tool`. `tickets` называет Ticket-ы run-а по названным Ticket-ам. `epics` перечисляет очередь по порядку, только когда в ней больше одного Epic-а. `mode` — Run mode: `fastest`, `budget-aware` или `start-window`. `vendor` — Vendor Orchestrator-а, `claude` или `codex`; строка без него — run на Claude Code. `autoApproval` — Auto-approval mode на старте, `shadow` или `on`, либо `off`, если policy не смогла запуститься и run шёл как при Off; строка без него — run при Off. |
| `orchestrator-busy` | Run ждёт занятый Orchestrator: `turn`, `queued` (сообщения в очереди) и `tasks`, в начале ожидания и при каждом изменении. |
| `orchestrator-free` | Ожидание Orchestrator-а кончилось; run берёт его сейчас. |
| `epic-started` | Run начинает следующий Epic своей очереди: `index` (с 1) и `of`. Эта строка и строки после неё несут этот Epic. У первого Epic-а такой строки нет. |
| `epic-finished` | Epic очереди закончился, и run идёт дальше: `outcome` — `done`, `waits-owner` (с `tickets` владельца), `elsewhere` (не начат) или `removed` (убран, не начат). У Epic-а, на котором run останавливается, такой строки нет, кроме последнего Epic-а, ждущего владельца: `waits-owner`, затем `run-stopped` с `waits-owner`. Run по одному Epic-у таких строк не пишет. |
| `queue-changed` | Очередь изменили: `added`, `removed`. Пишется сразу между Wave-ами, а для изменения, сделанного во время Wave, — после `wave-finished`. |
| `harness-behind` | Harness в `main` новее: после `run-started` и перед `wave-started`, когда счётчик изменился. |
| `forecast` | Epic forecast на старте, один раз, после `run-started` и `harness-behind`, перед первой `wave-started`: Run mode, оставшиеся Wave и Ticket-ы, образцы, `low` и `high` (p10 и p90 доли недели, `null` при числе образцов меньше 5), `fit` (сколько Wave помещается до сброса окна на 7 дней с учётом резерва; только когда у run-а есть рекомендация, в Budget-aware или в Start window с включённым бюджетом, иначе `null`), `week` (число окна на 7 дней на старте), p90 длительности Wave с числом её образцов и `window` в Start window. Journal-ы, которые не читаются, дают `samples: 0`; run продолжается. В run-е на Codex `samples`, `fit` и `week` относятся к самому длинному окну Codex и только к прошлым Wave-ам на Codex. |
| `wave-started`, `wave-finished` | Wave ушла или окончена. В `wave-started` есть отправленный текст, пропущенные Ticket-ы и `session` — id SDK session Orchestrator-а, в которую ушла Wave (имя её transcript-а). В обеих может быть `limits`: `{five_hour, seven_day}` в run-е на Claude Code, `{windows}` с окнами Codex в run-е на Codex. |
| `ticket-status` | `Status:` Ticket-а Epic-а этого run-а изменился во время run-а: это видно по изменению, о котором сообщил watch workflow, или при последнем чтении прямо перед `run-stopped` (не при Force stop). Ticket, чей файл появился во время run-а, получает статус, с которым его увидели впервые. Есть `state` (`claimed`, `blocked`, `done`, `open`), а также `statusAt`, `reason` и `waits`, когда у Ticket-а есть такие строки ([ADR-0092](../../adr/0092-run-history.md)). |
| `narrow-round` | Состояние узкого круга исправления в PR Ticket-а Wave, один раз на Ticket и исход. |
| `start-window` | Start window задержал следующую Wave: `reason` — `outside` или `wave-too-long`. Дальше идёт `waiting-until`. |
| `budget-stop` | Бюджет остановил следующую Wave. Дальше идёт `waiting-until`. |
| `limits-hit` | Limits отказали turn-у. Отказ Codex-а, при котором ни одно окно не израсходовано, имеет `reason: "quota"` и `message`, и дальше идёт `run-stopped` с `vendor-quota`. |
| `waiting-until`, `resumed` | Ожидание началось или кончилось. `resumed` идёт ещё и после `turn-retry`, когда продолжение ушло или когда turn заканчивает ожидание. |
| `turn-retry` | Turn закончился временной ошибкой API, и Auto-continue включён. Есть `attempt` и `of` (1 из 5 …), `error` (`api-500`, `overloaded`, `connection`, …), `message` (первые 300 символов текста ошибки) и `until` — когда уходит продолжение. |
| `retry-refused` | Auto-continue включён, а turn с ошибкой не повторяется. `reason` — `not-transient`, `in-flight` или `cap`; при `in-flight` в `actions` есть каждый вызов без результата (`git push origin main`): команда shell-вызова, как её написала модель, сводка worfy для другого инструмента, секреты заменены на `***`, как в `auto-approval` (`--token ***`). Дальше идут `session-error` и `run-stopped` с `turn-error`. |
| `session-error` | Session упала. |
| `refused-dialog` | Unattended Session отказала запросу. Есть Subagent и причина, если они известны, и никогда нет команды. Домашняя папка пишется как `~`. |
| `auto-approval` | Approval policy оценила запрос разрешения в Shadow или On. Есть Session, Subagent, если он известен, Vendor, `mode`, `outcome`, `rule`, инструмент, `targets` и, для команды shell, `command`, обрезанная до 200 символов, с секретами, заменёнными на `***`: значения переменных, опций и ключей JSON с именем секрета, пароли в URL, после `-u` у curl, `-p` у mysql, docker login и sshpass, `password` из `.netrc`, заголовки с именем секрета и известные формы token-ов. Несколько команд, которые только похожи на них, сохраняют свой текст: `sort --key=2`, сообщение `git commit -m "auth: …"`, слово поиска без кавычек или шаблон grep и rg в кавычках из одних букв (`grep -rn password src/`, `rg "apiKey: string"`) и числовой `docker run -u 1000:1000` до имени образа. В каждом из `targets` секреты заменяются так же (`touch <worktree>/ghp_…` даёт target `<worktree>/***`). Домашняя папка пишется как `~`. |
| `human-input` | Вмешался человек. `source` — `worfy` или `observer`. |
| `background-tasks` | Изменился набор живых background task-ов. |
| `run-stopping` | Graceful Stop пришёл во время turn-а или task-ов. |
| `gate-queue` | Run отправил «Process gate queue». |
| `gate-queue-finished` | Turn «Process gate queue» закончился. Дальше идёт `run-stopped`. |
| `run-stopped` | Run окончен, с причиной. `tickets` — для `blocked-tickets` и `waits-owner`, а также для `user-force-stop` и `session-error` после первой Wave. `lastText` — для остановки из-за отсутствия Wave. `actual` — когда хотя бы одна Wave окончена, в том числе при Force stop и выходе: рост доли окна на 7 дней за Wave run-а (`share`; в run-е на Codex — доли самого длинного окна Codex), оконченные Wave (`waves`) и сколько из них учтено (`counted`; Wave с устаревшим числом или со сбросом недели внутри не учитывается). |
| `orchestrator-returned` | Orchestrator снова Session человека, после остановки, которой пришлось ждать, или после Force stop. Остановка по причине самого run-а, не Stop и не Force stop, отдаёт его сразу, без перезапуска: тогда `tasks` перечисляет фоновые задачи, которые идут дальше в Session человека. |
| `tasks-killed` | Task-и, которых ждал run, закончились вместе с процессом, при выходе или Force stop. С причиной `start-now` — task-и Orchestrator-а, которые остановил Start now. |

#### Windows

В модулях Autopilot нет ветвлений по платформе. Различия лежат в том, на что они опираются:

- `src/main/storage/paths.ts` даёт папку данных `%APPDATA%\worfy`, а для development-сборки `%APPDATA%\worfy-dev`,
  поэтому journal лежит в `autopilot` внутри неё.
- Stable copy — папка `%LOCALAPPDATA%\worfy-stable`, скопированная из `dist\win-unpacked`. Скрипт установки отказывает
  для цели внутри папки установщика `%LOCALAPPDATA%\Programs\worfy`.

На Windows важны две вещи в коде, общем для всех платформ. `refused-dialog` пишет домашнюю папку как `~` в любой форме
пути, включая формы с диском и MSYS. Ключ origin у run-а читает букву диска в пути Windows как хост: `C:/repos/x.git`
даёт `c/repos/x`. Локальным путём диск считает только `remoteHasHost`, его вызывает ключ совпадения Project-а.

#### Test-ы

Эти test-ы не вызывают модель. Contract test-ы используют настоящие Session registry, Orchestrators, launcher, journal и
цикл поверх fake agent, который проигрывает скрипты из `test/fixtures/agent-scripts/`. Test-ы проверяют, что blocker
берётся и освобождается, поверх fake или подменённого `powerSaveBlocker`, но не то, что делает экран.

| Test | Что покрывает |
|---|---|
| `test/unit/autopilot-cycle.test.ts` | Цикл: когда Wave считается оконченной и каждая причина остановки. |
| `test/unit/autopilot-run.test.ts` | Run над скриптованной Session: какой результат заканчивает Wave, обе остановки, узкий круг исправления, gate queue, новая session на Wave, один run на Epic и origin. |
| `test/unit/autopilot-journal.test.ts` | Формат journal. |
| `test/unit/autopilot-origin.test.ts` | Ключ origin. |
| `test/unit/autopilot-power.test.ts` | Keep-awake. |
| `test/unit/canvas-actions.test.tsx` | Кнопка, строка состояния и меню «⋯». |
| `test/unit/settings-autopilot.test.tsx` | Settings → Autopilot. |
| `test/unit/install-stable.test.ts` | Скрипт установки Stable copy. |
| `test/contract/autopilot.test.ts` | Весь run: unattended и обратно, отказы, `human-input`, отказ для собственного репозитория, каналы IPC. |
| `test/contract/autopilot-background.test.ts` | Background task-и и остановки при живых task-ах. |
| `test/contract/codex-orchestrator.test.ts` | Run на Orchestrator-е Codex поверх fake app-server: Full access, отказ, пока hook-и не одобрены, перед следующей Wave и перед gate queue, ожидание окна Codex, `vendor-quota`, бюджет по окнам Codex. |
| `test/unit/autopilot-vendor-limits.test.ts` | Окно бюджета Codex, его образцы и прогноз, обе формы `limits` в journal. |
| `test/contract/autopilot-journal.test.ts` | Файлы journal, строка, дописанная снаружи, отсутствие записи вне папки данных. |
| `test/contract/autopilot-wiring.test.ts` | Связка новой session на Wave в `sharedAutopilot`. |
| `test/e2e/autopilot.spec.ts` | Собранное приложение: run, ожидание Limits, бюджет, background task-и, Force stop, узкий круг исправления. |
| `test/contract/autopilot-wait.test.ts` | Run, принятый, пока Orchestrator занят: ожидание его turn-а, очереди и task-ов, повторные проверки, Start now, Cancel. |
| `test/unit/autopilot-wait-line.test.ts` | Строка ожидающего run-а и остановленного run-а, чьи task-и ещё идут у человека. |
| `test/contract/autopilot-prepare.test.ts` | `autopilot.prepare`: те же строки, что у просьбы, Orchestrator на Codex, занятый Orchestrator, Epic или Ticket, которого у Project-а нет. |
| `test/unit/start-autopilot-modal.test.tsx` | Окно Start Autopilot: факты, Run mode по умолчанию, клавиши и фокус, Start when free, просьба агента и её обратный отсчёт. |
| `test/unit/queue-list.test.tsx` | Очередь в окне: Run all accepted, отметки, перетаскивание, ⌥↑/⌥↓, прогноз отмеченных Epic-ов, Start anyway после отказа из-за run-а в другом месте и её отсутствие у просьбы агента. |
| `test/unit/start-now-modal.test.tsx` | Start now и Cancel в строке ожидающего run-а и окно «Start now?». |
| `test/e2e/autopilot-start-modal.spec.ts` | Собранное приложение: кнопка открывает окно, Start Autopilot и Start when free, когда Orchestrator в turn-е; отказ Run all accepted из-за Epic-а в другом Project-е, затем Start anyway; очередь, остановленная с `waits-owner` на последнем Epic-е. |
| `test/e2e/autopilot-wait.spec.ts` | Собранное приложение: строка ожидания, Start now через его окно и Cancel. |
| `test/unit/epic-queue.test.ts` | Правило очереди: каждый случай следующего Epic-а, Epic-а, пропущенного ради владельца, и остановки. |
| `test/unit/accepted-epics.test.ts` | Какие Epic-и приняты и в каком порядке. |
| `test/contract/autopilot-queue.test.ts` | Run над очередью на fake agent: следующий Epic, пропуски, остановки (`waits-owner` на последнем Epic-е), `epic-started` и `epic-finished`, изменения между Wave-ами, Start anyway очереди. |
| `test/unit/autopilot-queue-line.test.ts` | Строка run-а над очередью (`Epic 2/3: …`), chip каждого статуса Epic-а очереди, очередь в tooltip и какие из Add to queue и Remove from queue предлагает «⋯». |
| `test/e2e/autopilot-queue.spec.ts` | Собранное приложение: Run all accepted из «⋯», run над двумя Epic-ами (`Epic 1/2`), Add to queue во время Wave, внесённое в её конце (`Epic 1/3`), Remove from queue, который оставляет Epic не начатым, с `queue-changed` в journal. |
| `test/e2e/linked-autopilot.spec.ts` | Два связанных приложения: отказ, Start anyway, Stop на двух экранах. |
| `test/e2e/browser-autopilot.spec.ts` | Что Session run-а может делать с Browser. |

Test-ы ожиданий, повтора и Fault scenario-ев — на странице [Autopilot faults and recovery](autopilot-faults.md#test-ы).

Test-ы старта из чата — на странице [Starting Autopilot from a chat](autopilot-chat.md#test-ы), test-ы Auto-approval —
на странице [Auto-approval](auto-approval.md#test-ы).
