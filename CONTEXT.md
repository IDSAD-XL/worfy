# worfy

Приложение для одного пользователя на его Machine-ах: бесконечный Canvas, на котором виден и запускается workflow работы с агентами Claude — Epic-и, Ticket-ы, Session-ы агентов и их Subagent-ы, проверки, — а агенты по ходу разговора собирают Card-ы.

Канонические термины — английские, как в интерфейсе; русский текст вокруг них остаётся русским.

## Canvas

**Project**:
Папка одной работы пользователя, над которой идёт workflow — Epic-и, Ticket-ы, HANDOFF, ADR. Это сам git-репозиторий (например, Auction) или папка над несколькими репозиториями (например, Atakama). Файлы workflow лежат в Workflow folder Project-а. У каждого Project ровно один Canvas.
_Avoid_: проект, space, workspace, пространство, репозиторий (как синоним Project)

**Canvas**:
Бесконечная плоскость Project, на которой лежат Node-ы.
_Avoid_: холст, canvas board, доска

**Node**:
Любой объект на Canvas: Ticket, Session, Card, Terminal и т. д.
_Avoid_: узел, элемент, виджет

**Card**:
Мини-приложение (HTML), которое собрал агент; один из типов Node. Принадлежит Project.
_Avoid_: карточка, card app, виджет, приложение

**Layout**:
Положение и размер Node-ов на Canvas. Это собственное состояние worfy, не часть workflow.
_Avoid_: раскладка, canvas.json

**Derived Node**:
Node, место которого считает worfy из workflow: рамка Epic, Ticket, дерево Subagent-ов. Ticket и дерево Subagent-ов руками не двигаются, рамка Epic — только целиком.
_Avoid_: авто-нода, вычисляемый узел

**Edge**:
Линия связи между Node-ами на Canvas одного из трёх видов: Blocked by (Ticket → Ticket), Binding (Session или Subagent → Ticket или Epic), Subagent (Session → Subagent).
_Avoid_: связь, стрелка, линия (как имя Edge)

**Limits**:
Доля использованных окон подписки Claude (5 часов, 7 дней) и время их сброса.
_Avoid_: лимиты, usage, квота, расход

**Terminal**:
Node с интерактивной shell-сессией пользователя; агент им не пользуется.
_Avoid_: терминал (как имя Node)

**Browser**:
Node со встроенным браузером Chromium: сайт или веб-приложение, открытое под одним Browser profile. Им пользуются и пользователь, и Session-ы Project-а — по просьбе в чате или чтобы проверить Ticket глазами нужной роли. На Canvas одновременно может быть несколько Browser-ов. Browser, который открыла Session, уходит с Canvas вместе с ней; остаётся — уже как Browser пользователя — тот, который пользователь перехватил или в котором остались несохранённые изменения. Browser бывает **Live** — страница работает — или **Asleep** — на его месте последний снимок страницы, а сама страница закрыта до пробуждения; живых Browser-ов одновременно не больше предела из Settings.
_Avoid_: карточка-браузер, браузерная карточка (Card — другое), webview, preview

**Browser profile**:
Сохранённый вход под одной ролью — куки и данные сайтов, например «admin», «moderator», «user». Пользователь входит в аккаунт сам, Session-ы приходят уже со входом и паролей не видят. Session ведёт Browser под ним только по адресам из списка, который задал пользователь, а Autopilot — только если пользователь это разрешил. Принадлежит Project-у и лежит на Machine ([ADR-0078](docs/adr/0078-browser-node.md)).
_Avoid_: профиль (это Profile), профиль браузера, аккаунт, persona

**Done shelf**:
Ряд chip-ов под видимыми рамками Epic-ов: Epic, у которого все Ticket-ы done и рамка свёрнута, стоит здесь chip-ом с именем и счётом, а не рамкой ([ADR-0075](docs/adr/0075-epic-frames-in-columns-and-done-shelf.md), [ADR-0082](docs/adr/0082-done-shelf-under-visible-frames.md)).
_Avoid_: архив Epic-ов, список готовых

**Archive**:
Место законченных Session-ов, которые worfy убрал с Canvas сам: история своего Ticket-а или Epic-а, а без Binding — popover «Archive». Ничего не удаляет и срока не имеет; это не Trash ([ADR-0076](docs/adr/0076-auto-archive-of-finished-sessions.md)).
_Avoid_: корзина, скрытые (как синоним Archive)

**Family**:
Node и всё, что с ним связано Binding-ом и деревом Subagent-ов: Ticket, его Epic frame, его Session-ы, их Subagent-ы и Browser-ы, которые эти Session-ы открыли. Browser, который пользователь перехватил или в котором остались несохранённые изменения, при уходе своей Session с Canvas остаётся на нём как Browser пользователя и из Family выходит. Подсвечивается при наведении и выделении; Node-ы при этом не двигаются.
_Avoid_: кластер, группа (как синоним Family)

## Workflow

**Epic**:
Набор Ticket-ов под одну цель; живёт в папке `.scratch/<epic>/` Workflow folder Project-а.
_Avoid_: эпик, milestone, проект

**Feature**:
Возможность продукта, которой пользуется разработчик: Canvas, Terminal, Autopilot. Живёт дольше любого Epic-а; один Feature меняют несколько Epic-ов, поэтому Epic и Feature — разные вещи.
_Avoid_: фича, функция, capability

**Feature page**:
Страница постоянной документации об одном Feature или нескольких близких, каждому — свой раздел: поведение, принципы работы и техническая реализация в их текущем состоянии. История и причины решений остаются в ADR и Ticket-ах, страница на них ссылается.
_Avoid_: спецификация, feature spec, описание Epic-а

**Ticket**:
Одна единица работы внутри Epic (`issues/NN-slug.md`) со статусом `open`, `claimed`, `blocked` или `done` и списком Ticket-ов, которые его блокируют.
_Avoid_: тикет, issue, задача, task

**Wave**:
Ticket-ы Epic, которые можно брать в работу параллельно прямо сейчас: открыты, все блокеры закрыты, общих файлов нет. Вычисляется, нигде не хранится. В `spec.md` Epic-а Wave-ы заранее планируются и нумеруются таблицей («Wave 3 плана»): это прогноз по `Blocked by` и спискам файлов, а Wave, которую берут в работу, всё равно вычисляется заново в момент запуска.
_Avoid_: волна, batch, спринт

**Stage**:
Место Ticket-а в Pipeline его Project-а, например Implementing, Agent review или Awaiting merge. Вычисляется из статуса Ticket-а, его ветки, PR и отметок проверок, нигде не хранится. Статус Ticket-а — не Stage: один и тот же `claimed` бывает на нескольких Stage подряд; `blocked` — не Stage, а пометка на любом Stage.
_Avoid_: этап (как имя), статус, фаза, step

**Wave brief**:
Короткая сводка Epic-а, которую Orchestrator сохраняет в конце Wave и читает первой в новой Session: что влито, какие Ticket-ы ждут и чего, открытые PR, следующая Wave.
_Avoid_: бриф, handoff (HANDOFF.md — другой документ: состояние всего проекта)

**Pipeline**:
Упорядоченный список Stage, через которые проходит каждый Ticket одного Project-а; свой у каждого Project-а (у одного есть review людьми и ручной merge, у другого — выкатка). Без настройки — Queued, Implementing, CI, Agent review, Gate & merge, Closing, Done.
_Avoid_: воркфлоу (как имя списка), процесс, board

**Autopilot**:
Режим, в котором Wave-ы Epic идут без человека: worfy не даёт Machine уснуть, ждёт сброса Limits и продолжает с того же места; любая точка, где понадобился человек, считается дефектом.
_Avoid_: ночной режим, автономный прогон

**Stable copy**:
Собранная копия worfy вне репозитория (на macOS — `~/Applications/worfy-stable.app`, на Windows — папка `%LOCALAPPDATA%\worfy-stable`), из которой Autopilot ведёт Wave-ы самого worfy; обновляется между прогонами.
_Avoid_: стабильная копия, prod-сборка, релиз

**Gate**:
Проверка готовности изменений (`gate.mjs`) с исходом «зелено», «красно» или «не удалось проверить».
_Avoid_: проверка, CI (CI — отдельная проверка на GitHub)

**Gate full**:
Полный Gate на одной Machine: lint, typecheck, все test-ы, e2e и проверка собранного приложения; gate fast — то же без e2e и сборки. По [ADR-0083](docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md), с первого зелёного check `ci-ok` на `main`, gate full — не условие merge, а инструмент implementer-а и разбора сбоя; условие merge — зелёный `ci-ok` CI на GitHub. До этого момента gate full на Mac — условие merge каждого PR с кодом.
_Avoid_: полный гейт, полная проверка, full gate, ci-ok (как синоним)

**Windows verdict**:
Ответ на вопрос, работает ли изменение PR на Windows. С первого зелёного `ci-ok` на `main` (ADR-0083) для каждого PR это job `windows` в составе check `ci-ok` CI на GitHub-hosted runner-е; для платформенного PR, который трогает то, чего runner не проверяет (Terminal, окна, меню, уведомления, e2e, упаковку), — Gate full на Windows-ПК владельца. Какой из двух нужен, решает скрипт scope, а не человек ([ADR-0083](docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md)). С [ADR-0086](docs/adr/0086-pc-gate-full-once-per-wave.md) этот gate full идёт не на head PR, а на `main` после merge: PR со scope `pc` вливается по `ci-ok`.
_Avoid_: проверка Windows, Windows-гейт, `check/windows` (это отметка, в которой Windows verdict записан)

**Harness**:
Набор правил, skills, агентов, скриптов и hooks, по которому агенты Claude ведут работу над Project: Epic-и, Ticket-ы, Wave-ы, Gate, ревью. В Harness входит и qmd — поиск по документам и Ticket-ам Project. worfy ставит и обновляет Harness; остальные личные skills, MCP-серверы и память пользователя в него не входят.
_Avoid_: kit, обвязка, тулинг

**Profile**:
Описание Project для Harness: как проверять изменения, где лежат Ticket-ы, как называются ветки и worktree, по каким линзам ревьюить, какие MCP-серверы доступны агентам Project, от какого аккаунта GitHub работать, в каком режиме — Full mode или Silent mode — идёт работа. Profile целиком лежит на Machine пользователя; в репозитории Project его нет.
_Avoid_: профиль, конфиг проекта, settings (Settings — настройки самого worfy, «Project settings…» — окно одного Project-а в worfy; ни то, ни другое не Profile)

**User personalization**:
Собственные настройки пользователя для Harness — вне plugin и вне Profile, одни для всех его Project-ов: язык отчётов (`language.reports` в `~/.claude/worfy-harness/user.json`) и личные правила (`~/.claude/worfy-harness/user/rules.md`, Harness подмешивает их в Session, не зная содержания). Языки команды и документов — не здесь, а в Profile ([ADR-0074](docs/adr/0074-harness-neutral-by-language-and-project.md)).
_Avoid_: пользовательская персонализация, персонализация (без уточнения чья), user settings, настройки пользователя, Profile или Settings (как синоним)

**Full mode**:
Режим Project, в котором файлы workflow — Ticket-ы, spec Epic-а, HANDOFF, ADR, уроки — лежат в репозитории Project вместе с кодом и видны всем, кто с ним работает.
_Avoid_: полный режим, открытый режим, public mode

**Silent mode**:
Режим Project, в котором файлы workflow лежат вне его репозитория, в отдельной Workflow folder, и в репозитории Project от workflow не остаётся следа. След — это не только файлы: ветки, коммиты и PR тоже выглядят как обычная работа, без номеров Ticket-ов и ADR, имён Epic-ов и путей к Workflow folder.
_Avoid_: тихий режим, скрытый режим, private mode, stealth

**Workflow folder**:
Папка, где лежат файлы workflow Project-а: Epic-и с Ticket-ами, HANDOFF, ADR, уроки. В Full mode это корень репозитория; в Silent mode — папка вне репозитория, которую пользователь выбирает при подключении Project.
_Avoid_: папка workflow, папка тикетов, workspace

**HANDOFF**:
Файл в Workflow folder Project-а со снимком текущего состояния работы: что в работе, что дальше, что ждёт владельца.
_Avoid_: статус-файл, notes

## Agents

**Session**:
Один разговор с Claude Code — один транскрипт, который можно продолжить. На Canvas одна Session — один Node, где бы она ни была запущена (worfy, терминал, Claude desktop).
_Avoid_: сессия, чат, диалог, conversation

**Orchestrator**:
Главная Session Project, из которой расходится работа; закреплена на Canvas.
_Avoid_: оркестратор, composer, главный чат, Morphy

**Subagent**:
Агент, которого Session запустила для части работы (например, scout, implementer, reviewer); у него свой транскрипт и итог, и он принадлежит запустившей его Session.
_Avoid_: субагент, воркер, teammate

**Interrupted**:
Subagent, процесс Session которого кончился раньше, чем он закончил; это не сбой. Признак: у Subagent-а нет записи о конце, а текущий процесс его Session запущен позже последней записи в его транскрипте (ADR-0085). На Canvas и в rail-е — серый статус «Interrupted».
_Avoid_: оборванный, упавший, stale, error

**Background task**:
Работа, которую Session запустила и не ждёт в своём ходе: Subagent или Bash с `run_in_background`, workflow-скрипт (ADR-0029). Живёт, пока жив процесс Claude Code этой Session; о своём конце сообщает task-notification, которая начинает новый ход Session. Это не Ticket: в строке Autopilot «2 background tasks» и в журнале прогона считаются только такие задачи.
_Avoid_: job; «task» и «задача» без «background»

**Binding**:
Связь Session или Subagent с Ticket либо Epic, над которым он работает. Определяется по сигналам из работы агента или задаётся пользователем вручную.
_Avoid_: привязка, assignment, линк

## App

**Settings**:
Настройки самого worfy на этой Machine — масштаб интерфейса, доступ Linked machine-ов, Terminal AI и другие функции worfy — и окно Settings (Cmd/Ctrl+, или «Settings…» в меню), где они меняются; там же для справки — проверки Health и список сочетаний клавиш. Это собственное состояние worfy на Machine ([ADR-0005](docs/adr/0005-worfy-own-state-inventory.md)): в репозиторий Project-а и в Profile Settings не попадают и действуют во всех Project-ах этой Machine. Это не Profile — описание Project-а для Harness, — и не «Project settings…» — окно одного Project-а в worfy с его шаблонами действий.
_Avoid_: настройки (без уточнения чьи), preferences, конфиг, Profile или Project settings (как синоним)

**Getting started**:
Список из шести шагов для нового пользователя: от проверок First run до Ticket-а Demo project, доведённого через ревью и доработку до merge. Шаги отмечаются сами, когда сделаны; список можно пропустить, и он ничего не блокирует.
_Avoid_: онбординг (как имя в интерфейсе), тур, туториал, wizard

**Demo project**:
Project, который worfy создаёт сам для Getting started: маленький локальный git-репозиторий без GitHub с одним Epic-ом и одним Ticket-ом, в Full mode. Агенты работают в нём по-настоящему; удаляется одной командой вместе со своим Profile.
_Avoid_: песочница, sandbox, пример, учебный проект

## Machines

**Machine**:
Компьютер пользователя, на котором стоит worfy. Точнее, Machine привязана к папке данных worfy: две установки worfy с разными папками данных на одном компьютере — например, dev-сборка и Stable copy — две Machine ([ADR-0023](docs/adr/0023-separate-data-roots-packaged-and-dev.md), [ADR-0052](docs/adr/0052-machines-and-linking.md)). Project живёт на одной Machine: там лежит его папка и работают его Session-ы, worktree и Gate. Одна и та же Machine в разных соединениях бывает и host, и client: это роли соединения, а не виды Machine ([ADR-0052](docs/adr/0052-machines-and-linking.md)).
_Avoid_: инстанс, машина (как термин), host и client (как виды устройств)

**Linked machine**:
Machine, связанная с этой по коду из 6 цифр. Связь двусторонняя, удаляется (Remove) с любой стороны. Если здесь включён доступ «Linked machines can work with my Projects» (по умолчанию выключен), Linked machine видит Project-ы этой Machine и работает с ними: открывает Canvas, пишет в Session, печатает в Terminal, запускает Autopilot. При выключенном доступе Project-ов этой Machine она не видит. Всё это выполняется на Machine Project-а ([ADR-0052](docs/adr/0052-machines-and-linking.md), [ADR-0053](docs/adr/0053-several-screens-on-one-project.md)).
_Avoid_: удалённый инстанс, host, client, remote, отозвать, Revoke

## Terminal AI

**Terminal AI**:
Помощь модели Claude в Terminal-е — Suggestion, Next command, Command request и Fix — и раздел Settings, где они включаются и выключаются. Terminal AI — не Session и не агент: у него нет транскрипта, Node-а и Binding-а, он ничего не запускает и только предлагает текст для строки ввода; команду запускает пользователь. Его запросы расходуют Limits подписки ([ADR-0058](docs/adr/0058-terminal-ai-assist-process.md)).
_Avoid_: AI-ассистент, агент Terminal-а, копилот

**Suggestion**:
Серый текст в строке ввода Terminal-а — продолжение того, что пользователь набирает, из истории его команд или от модели. Пользователь принимает его целиком или по словам либо скрывает; пока не принят, он не часть строки.
_Avoid_: подсказка, автодополнение, autosuggestion, completion (completion — дополнение shell-а по Tab)

**Next command**:
Suggestion на пустой строке после законченной команды: команда, которую модель предлагает следующей.
_Avoid_: следующая команда, next step

**Command request**:
Просьба словами, что нужно сделать в Terminal-е; в ответ Terminal AI ставит в строку ввода команду, не запуская её.
_Avoid_: запрос к AI, промпт, NL-команда

**Fix**:
Действие после команды, которая кончилась ошибкой: Terminal AI ставит в строку ввода исправленную команду, не запуская её.
_Avoid_: исправление, autofix, quick fix

**SSH session**:
Часть жизни Terminal-а от входа по `ssh` до выхода: всё это время команды идут в shell-е на Remote host-е.
_Avoid_: ssh-коннект, удалёнка

**Remote host**:
Компьютер, к которому подключается SSH session. У него есть флаг «Terminal AI включён» и переключатель отправки данных в модель. Это не Linked machine: на Remote host-е нет worfy.
_Avoid_: сервер (как название термина)

## Relationships

- **Project** содержит много **Epic**-ов; **Epic** — много **Ticket**-ов; **Ticket** может блокироваться другими Ticket-ами того же Epic.
- У **Session** или **Subagent** не более одного **Binding** — к Ticket или Epic; у **Ticket** может быть несколько Binding-ов (реализация, ревью, доработка). Binding Orchestrator-а, ведущего **Wave**, — к Epic, а Binding-и его implementer-ов и reviewer-ов — к их Ticket-ам.
- **Session** запускает **Subagent**-ов; **Subagent** может запускать своих.
- У **Project** ровно один **Orchestrator**.
- У **Project** ровно один **Profile**; **Harness** один на **Machine** и ведёт работу каждого Project по его **Profile**.
- **User personalization** одна у пользователя на **Machine** и действует во всех его **Project**-ах; **Profile** задаёт языки команды и документов Project-а, **User personalization** — язык отчётов и личные правила.
- У **Project** ровно одна **Machine**. Один репозиторий, подключённый на двух Machine, — это два разных Project-а, у каждого свой Canvas.
- **Linked machine** видит **Project**-ы другой **Machine** и работает с ними, только если та включила доступ; при выключенном доступе Project-ов не видит. Session-ы, Terminal, Gate и Autopilot такого Project-а всё равно идут на его Machine.
- У **Project** ровно один режим — **Full mode** или **Silent mode**; Project над несколькими репозиториями всегда в **Silent mode**.
- У **Project** ровно одна **Workflow folder**: в **Full mode** это корень репозитория, в **Silent mode** — папка вне репозитория.
- **Card** принадлежит **Project**, а не Session: менять её может любая Session Project.
- **Browser** открыт ровно под одним **Browser profile**; **Browser profile** принадлежит **Project**, а не Session, и им может пользоваться любая Session Project. Один **Browser profile** может быть открыт в нескольких **Browser**-ах сразу.
- **Browser** работает на **Machine** своего **Project**, как Terminal и Session; **Linked machine** только показывает его и передаёт ввод. Поэтому **Browser profile** один, с какого бы экрана ни шла работа.
- Вход в аккаунт и создание **Browser profile** делает только пользователь; **Session** может открыть **Browser** под существующим **Browser profile** и вести его, пока пользователь не перехватит управление.
- **Autopilot** над самим worfy идёт только из **Stable copy**; агенты **Wave** в это время собирают и проверяют dev-сборку worfy в своих worktree.
- **Terminal AI** работает в **Terminal**-е и не делает его агентским: команды в **Terminal**-е по-прежнему запускает только пользователь, а **Terminal AI** лишь предлагает текст строки ввода. Это не **Session**: на **Canvas** у него нет Node-а.
- **SSH session** идёт внутри **Terminal**-а, у неё ровно один **Remote host**. **Terminal AI** работает в ней, только если на этом **Remote host**-е он включён. **Remote host** — не **Machine** и не **Linked machine**.
