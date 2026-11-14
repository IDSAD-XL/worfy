# Исследование конкурентов 2026-11-13

Входная страница исследования конкурентов worfy. Досье в этой папке написаны 2026-11-13.
Идеи и черновики Epic-ов сделаны 2026-11-13 и 2026-11-14. Решений владельца здесь нет:
это материал для них.

- [1. Что это](#1-что-это)
- [2. Карта рынка](#2-карта-рынка)
- [3. Продукты без досье](#3-продукты-без-досье)
- [4. Идеи для worfy](#4-идеи-для-worfy)
- [5. Предложенные Epic-и](#5-предложенные-epic-и)
- [6. Что не берём и почему](#6-что-не-берём-и-почему)

## 1. Что это

### Что изучали

Продукты, которые запускают сразу несколько агентов для программирования и доводят их работу до
PR и merge: desktop-приложения, IDE, облачные агенты, CLI и сервисы, которые ведут агентов без
человека.

Поиск собрал список кандидатов, отбор (triage) разделил его на три части:

- **tier A** — 39 продуктов, ближайших к worfy;
- **tier B** — 111 продуктов, о которых стоит знать;
- **87 записей отброшены**: повторы и варианты уже выбранных продуктов, закрытые или неактивные
  продукты и продукты не по теме.

Владелец сам назвал восемь продуктов: OpenHands, Factory Droids, Devin, Vibe Kanban, Gas Town,
Orca, OpenAI Symphony и Division Swarm.

### Досье

В папке 36 досье.

**22 основных досье** — восемь продуктов владельца и 14 крупных продуктов tier A. Каждое собрано
по четырём направлениям исследования:

1. **features** — что продукт умеет: интерфейс, цены, платформы, интеграции.
2. **internals** — как он устроен: цикл агента, разбиение работы, параллельность, изоляция,
   состояние и память, проверка результата, восстановление после сбоев, лимиты, разрешения.
3. **reception** — что о нём говорят: Hacker News, Reddit, X, YouTube, issues и discussions на
   GitHub.
4. **direction** — куда он движется: принципы, roadmap, изменения за последние 6–12 месяцев,
   бизнес-модель.

Потом каждое основное досье прошло проверку фактов. Проверка выбрала 12–20 утверждений, на
которые может опереться решение: лицензия, цена, вендор, метрики, механизмы. Каждое утверждение
заново сверено с первоисточником, ошибки исправлены прямо в досье, а в конце досье появился
раздел «Проверка фактов». Где досье называет итог, исправлений от 5 до 12 на 20 проверенных
утверждений: 12 у GitHub Copilot app, 11 у OpenHands, 10 у Devin и у Gas Town, 5 у Claude Code
Agent View и у Devin Desktop. Утверждения вне этой выборки никто не перепроверял. Их стоит читать
с той же осторожностью.

Разделы основного досье: «Модель работы», «Функции», «Принципы и подходы», «Как это устроено
внутри», «Что говорят пользователи», «Направление развития», «Слабые места и чего нет»,
«Пересечение с worfy», «Механизмы, которые стоит изучить», «Источники», «Проверка фактов». Номер
в квадратных скобках, например `[12]`, ведёт в список «Источники» того же досье. В заметке о
методе нескольких досье сказано, что бюджет веб-поиска кончился раньше времени.

**14 досье поменьше** написаны позже, по заметкам второго исследования — продуктов tier A
поменьше. Проверки фактов у них не было: лимит подписки ушёл на основные досье. Каждое из них
говорит об этом в разделе «Проверка фактов». В досье Nimbalyst нет разделов «Пересечение с
worfy», «Механизмы, которые стоит изучить» и «Источники». Идеи из этих 14 досье в разделы 4–6 не
вошли: отбор идей шёл раньше и только по 22 основным.

### Карта возможностей worfy

Досье сравнивали с картой возможностей worfy. В ней 238 возможностей в десяти областях:

1. Session-ы и Vendor-ы;
2. Orchestrator, Autopilot и Wave-ы;
3. планирование и Limits;
4. проверки: Gate, CI, review, Evidence;
5. Canvas;
6. Terminal и Browser;
7. Harness, skills, memory и Product Session;
8. несколько Machine;
9. уведомления и наблюдаемость;
10. первый запуск, обновления и настройки.

У каждой возможности есть состояние: shipped; shipped, но ждёт проверки владельца; открытый Epic;
planned (в roadmap, в принятом черновике или в более позднем решении); candidate; только spike;
открытый вопрос.

Карту собрали 2026-11-13 на commit `f2b788c4e` только по документам worfy, код при этом не
читали. Источники карты: глоссарий `CONTEXT.md`, 33 английские страницы `docs/features`,
`docs/roadmap.md`, темы Product Session roadmap-worfy, termalin и ui-overhaul, заголовки и разделы
о проблеме в spec 11 открытых Epic-ов. Карта — рабочий файл исследования, в репозиторий она не
вошла.

### Как получились идеи

1. **Извлечение.** По каждому из 22 основных досье агент выписал идеи, которых в worfy нет, и
   сверил их с картой возможностей и roadmap. Идеи, которые карта показывала как уже сделанные,
   отпали на этом шаге.
2. **Кластеры.** Похожие идеи из разных досье свели в кластеры по областям. Получилось 145
   кластеров.
3. **Проверка по коду и планам.** 61 кластер сверили с кодом, ADR и решениями владельца и дали
   каждому статус: new (в worfy этого нет), partial (есть часть), exists (уже есть), planned (уже
   в планах), conflicts (против решения владельца), not-worth (не стоит делать). Оставлены 43
   кластера со статусом new или partial, отклонены 18. Если проверяющий сомневался между exists
   или planned и partial, он ставил partial и называл недостающую часть. Остальные 84 кластера
   средней ценности не проверяли, чтобы сберечь лимит подписки.
4. **Сборка.** Оставленные идеи собрали в 17 кандидатов в Epic и 5 отдельных идей.
5. **Черновики.** Для 8 Epic-ов (это предел одного запуска) написаны черновики spec. Каждый
   прочитал critic — агент, который проверяет план Epic-а до приёмки владельцем. Его вердикт стоит
   строкой `Critic:` в заголовке spec со ссылкой на разбор. Ещё 9 Epic-ов отложены с причиной.

### Ограничения

- Продукты tier B получили по одной строке из данных поиска вместо досье, и эти строки никто не
  проверял. Так решил владелец 2026-11-13, чтобы сберечь лимит подписки.
- 14 досье поменьше написаны без проверки фактов, их идеи не попали в разделы 4–6.
- 11 продуктов tier A остались без досье: исследование продуктов поменьше остановилось, когда
  кончился бюджет. Они перечислены в разделе 3.
- 84 идеи средней ценности не сверены с кодом и планами worfy. Часть из них может уже быть в
  worfy.
- Владелец не принял ни один черновик Epic-а.

### Термины worfy

Слова worfy на этой странице — из глоссария [CONTEXT.md](../../../CONTEXT.md). Самые частые:

- **Project** — репозиторий или несколько репозиториев, подключённые к worfy.
- **Canvas** — бесконечная плоскость Project-а с Node-ами. **Node** — любой объект на Canvas:
  Session, Ticket, Card (мини-приложение на HTML, которое собрал агент), Terminal, Browser.
- **Session** — один разговор с агентом. **Vendor** — производитель агента: Claude Code или Codex.
  **Subagent** — агент, которого Session запустила для части работы.
- **Epic** — набор Ticket-ов под одну цель, со своей spec. **Ticket** — одна единица работы внутри
  Epic-а со статусом `open`, `claimed`, `blocked` или `done`. **Done when** — раздел Ticket-а с
  условиями готовности.
- **Wave** — Ticket-ы Epic-а, которые можно вести параллельно прямо сейчас. **Orchestrator** —
  главная Session Project-а, из которой расходится работа.
- **Autopilot** — режим, в котором Wave-ы идут без человека. **Run** — один такой запуск.
  **Run history** — вид одного Run-а: его Wave-ы, Ticket-ы, агенты, CI и ожидания.
- **Gate** — проверка готовности изменений (`gate.mjs`): зелёно, красно или «не удалось
  проверить». **Evidence** — строки доказательств к пунктам Done when.
- **Pipeline** — упорядоченный список Stage, через которые проходит Ticket, например
  Implementing, Agent review, Human review, Awaiting merge.
- **Harness** — правила, skills, агенты, скрипты и hooks, по которым агенты ведут работу над
  Project-ом. **Profile** — описание Project-а для Harness: команды проверки, папки, ветки, lens-ы
  review.
- **Limits** — доля использованных окон подписки Vendor-а (у Claude — 5 часов и 7 дней) и время
  их сброса.
- **Auto-continue** — продолжение после временной ошибки API или после сброса Limits.
  **Auto-approval** — как worfy отвечает на запрос разрешения агента в Run-е без человека (Off,
  Shadow или On). **Park** — запрос, который Auto-approval оставляет открытым до ответа владельца,
  не дольше 60 минут.
- **PR inbox** — вид Pull requests Project-а, где PR сгруппированы по тому, чей ход: Needs my
  review, Needs my answer, Needs a fix, Ready, Waiting on others.
- **Binding** — связь Session или Subagent-а с Ticket-ом или Epic-ом.
- **Machine** — компьютер с worfy. **Linked machine** — Machine, связанная с этой по коду из 6
  цифр.
- **Work track** — лента всей работы Project-а на Machine за день, неделю или месяц.
  **Flight Recorder** — часть worfy, которая собирает факты Run-а для разбора.
- **Product Session** — Session для продуктовых решений: предлагает идеи и пишет черновики Epic-ов.
- **Eco mode** — меньше агентов на Ticket и роли Subagent-ов на моделях подешевле.
- **Stable copy** — собранная копия worfy вне репозитория, из которой Autopilot ведёт Wave-ы.

## 2. Карта рынка

36 досье по видам продуктов. «Ближайшее в worfy» — функция worfy, с которой продукт стоит
сравнивать в первую очередь. Подробное сравнение — в разделе «Пересечение с worfy» каждого досье.
Пометка «без проверки фактов» стоит у 14 досье поменьше.

### Продукты Anthropic и OpenAI вокруг своих агентов

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| Claude Code desktop app | Anthropic | Вкладка Code в приложении Claude: параллельные сессии Claude Code на своём компьютере, в облаке Anthropic, по SSH или в WSL; diff, PR и CI, встроенные браузер и терминал, работа без присмотра. | Session Node-ы на Canvas, PR inbox, Browser Node | [досье][ccd] |
| Claude Code cloud sessions and Projects | Anthropic | Claude Code на VM Anthropic: работу запускают из браузера, с телефона, из Desktop или терминала, результат приходит веткой и PR. Projects добавляют разговор-координатор, который раздаёт работу параллельным threads и ведёт их PR до merge. | Orchestrator, Autopilot, Auto-continue | [досье][ccc] |
| Claude Code Agent View | Anthropic | Экран `claude agents` в CLI: все фоновые сессии машины одним списком по состояниям; запуск одной строкой, ответ без подключения к сессии, свой worktree перед первой правкой. | Раздел Sessions, состояния Session, Work track | [досье][cav] |
| Claude Code agent teams | Anthropic | Экспериментальная функция CLI: lead запускает teammates, раздаёт им работу через общий список и переписывается с ними через файлы-почтовые ящики; команда живёт внутри одной интерактивной сессии. | Orchestrator и Subagent-ы | [досье][cat] |
| Claude Code plugins and marketplaces | Anthropic | Формат пакетов и каталоги: skills, subagents, hooks, MCP и LSP серверы, workflows, а с октября 2026 — mods, которые меняют сам Claude Code. | Сам Harness: он поставляется plugin-ом этого формата | [досье][ccp] |
| Codex app (Codex in the ChatGPT desktop app) | OpenAI | Режим Codex в desktop-приложении ChatGPT: параллельные чаты локально, в worktree, на другой машине или в облаке; долгие цели, запуски по расписанию, управление с телефона. | Session-ы на Codex, второй Vendor worfy | [досье][cx] |

### Платформа GitHub

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| GitHub Copilot app | GitHub (Microsoft) | Desktop-приложение для macOS, Windows и Linux: агенты Copilot в параллельных сессиях, каждая в своём worktree, ведут работу от issue через PR и CI до merge; облачные automations работают по расписанию и событиям. | Ship ticket (Session, которая ведёт один Ticket до merge), PR inbox, Autopilot | [досье][gca] |
| GitHub Copilot cloud agent and Agent HQ (mission control) | GitHub (Microsoft) | Асинхронный агент: работа приходит из issue, чата, CLI или API и идёт в облачной sandbox или в GitHub Actions, результат — PR. Agent HQ сводит агентов разных вендоров в одно место управления. | PR inbox, Session-ы двух Vendor-ов | [досье][gcc] |

### Агентные IDE и терминалы

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| Cursor (Agents Window, Cloud Agents and Automations) | Anysphere | Закрытая IDE, fork VS Code: Agents Window ведёт агентов локально, в worktree, на облачных VM и на своих машинах; Automations запускают их по расписанию и событиям; Projects дают агента-координатора. | Session Node-ы на Canvas, Orchestrator | [досье][cur] |
| Google Antigravity | Google (команда в Google DeepMind) | Desktop App, CLI `agy`, расширения для шести редакторов, Python SDK и облачные Remote Agents на одном agent harness. | Session-ы и Subagent-ы на Canvas, Browser Node | [досье][ag] |
| JetBrains Air | JetBrains | Бесплатный plugin во всех IDE JetBrains: параллельные сессии Claude, Codex, Junie и Copilot локально или во временных worktree; платные Air Teams и Air Governance. Отдельное приложение Air снято с загрузки 2026-11-11. | Session-ы двух Vendor-ов | [досье][air] |
| Devin Desktop (formerly Windsurf) | Cognition | Бывшая IDE Windsurf. Главный экран — Agent Command Center: Kanban и список сессий локального Devin, облачного Devin и агентов по ACP (Agent Client Protocol — открытый протокол между редактором и агентом), сгруппированных в Spaces. | Pipeline и Stage-и Ticket-ов, Canvas | [досье][dd] |
| Kiro | Amazon Web Services | IDE на Code OSS с разработкой от spec, CLI, веб-приложение с облачными sandbox, мобильные клиенты и Kiro Crew на одном agent harness; оплата месячными кредитами. | Epic со spec и Ticket-ами, Wave, Gate, Auto-approval | [досье][kiro] |
| Warp (Agent Management Panel, Oz cloud agents and Warp Factories) | Warp | Терминал со своим агентом и поддержкой Claude Code и Codex; облачный запуск агентов по событиям и расписанию (бывший Oz); Warp Factories — описанный в коде конвейер агентов от Slack, Linear, Jira или GitHub до PR, merge оставлен человеку. | Terminal Node, Autopilot, Evidence | [досье][warp] |

### Desktop-приложения для параллельных агентов

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| Orca | Stably AI | Бесплатное Electron-приложение под MIT: каждая задача в своём worktree, любой CLI-агент на подписке пользователя, review diff, PR и CI, браузер, удалённые хосты, телефон. | Session Node-ы на Canvas, Browser Node, PR inbox | [досье][orca] |
| Vibe Kanban | Bloop AI | Open-source приложение: CLI-агенты параллельно, каждая задача в своём worktree; review diff, preview приложения, PR. Kanban-доску вывели из работы в апреле 2026 вместе с закрытием компании. | Worktree на Ticket, Pipeline | [досье][vk] |
| OpenHands (Agent Canvas) | All Hands AI | Бесплатное self-hosted приложение (веб-клиент и preview desktop): агент OpenHands на любой модели или Claude Code, Codex и Gemini CLI по ACP; automations по расписанию и событиям. «Canvas» здесь только имя: интерфейс — список разговоров. | Session-ы двух Vendor-ов | [досье][oh] |
| Conductor | Melty (с ноября 2026 — в Meta) | Закрытое приложение для macOS: Claude Code, Codex, Cursor и OpenCode параллельно, каждый в своём worktree и ветке, от prompt до review, CI и merge. | Ship ticket, PR inbox | [досье][conductor], без проверки фактов |
| Paradev (formerly Superset) | Superset Inc. | Electron-приложение для macOS под MIT: около 20 CLI-агентов, каждый в своём worktree; review diff, PR и CI, встроенный браузер; платно — удалённые хосты, automations, облачные workspaces. | PR inbox, Browser Node | [досье][paradev], без проверки фактов |
| Emdash | General Action | Open-source desktop-приложение: каждая задача в своём worktree локально или по SSH; diff, review, PR и CI, задачи из 13 трекеров, cron. | Ship ticket, Evidence | [досье][emdash], без проверки фактов |
| Agent Orchestrator | Orchestrator.inc (Untrivial, Inc.) | Electron, daemon на Go и CLI `ao`: агенты в worktree под агентом-координатором; упавший CI, замечания review и конфликты само возвращает агенту, который ведёт PR. | Orchestrator, состояние PR в PR inbox | [досье][ao], без проверки фактов |
| Maestro | RunMaestro (SMASH Labs) | Open-source Electron: много CLI-агентов рядом; без присмотра проходит markdown-чеклисты, ждёт сброса лимитов подписки, повторяет запросы при сбоях провайдера. | Autopilot, Auto-continue | [досье][maestro], без проверки фактов |
| T3 Code | T3 Tools | Open-source приложение (desktop, web, iOS, Android) над установленными агентами: нити разговоров в worktree, смена агента посреди разговора, передача работы между вендорами. | Session-ы двух Vendor-ов | [досье][t3], без проверки фактов |
| Nimbalyst (formerly Crystal) | Nimbalyst, Inc. | Electron-приложение под MIT с компаньоном для iOS: параллельные сессии на Kanban-доске; правки принимают как красно-зелёный diff в визуальных редакторах. Project Canvas и Mind Map здесь — редакторы файлов, а не вид сессий. | Pipeline и Stage-и Ticket-ов | [досье][nimbalyst], без проверки фактов |

### Canvas как главный экран

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| Agor | Preset | Web-приложение, self-hosted или в облаке: общая бесконечная доска, на которой git-ветки с worktree — карточки с деревом сессий; zones и cron запускают prompt-ы. | Canvas | [досье][agor], без проверки фактов |
| Cate | Cero AI (0-AI UG) | Electron-приложение под MIT: бесконечный Canvas с настоящими терминалами, редакторами и браузерами; worktree — цветная область; метры лимитов Claude Code и Codex. | Canvas, полосы Limits | [досье][cate], без проверки фактов |

### Spec, план и раздача работы

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| Intent | Augment Code (код теперь в организации intent-hq) | Daemon на Rust запускает агентов в изолированных git workspaces; агенты пишут общий Spec, раздают работу, следят за PR и CI. | Orchestrator, Wave, verifier | [досье][intent], без проверки фактов |
| Traycer | Traycer AI | Electron: агенты в одной Task, общие spec и tickets в файлах; skills планируют, раздают tickets, делают review и debate. | Epic: spec, Ticket-ы, Wave | [досье][traycer], без проверки фактов |

### Ведут работу агентов без человека

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| Gas Town | Steve Yegge; код ведёт Gas City, Inc. | Бесплатный CLI на Go: 20–30 агентов (по умолчанию Claude Code) в tmux; координатор раздаёт работу из трекера Beads; агент очереди слияния проверяет и сливает ветки. | Autopilot, Orchestrator, скрипт `land` (проверяет условия merge и сливает PR) | [досье][gt] |
| OpenAI Symphony | OpenAI | Фоновый сервис (SPEC.md и эталонная реализация на Elixir): опрашивает трекер и держит агента Codex на каждой активной задаче, пока её не передадут человеку. | Autopilot над Ticket-ами | [досье][sym] |
| Division Swarm | Division | Self-hosted runtime на Go: LLM-агенты в машине состояний из YAML; каждое событие пишется в log, run можно повторить (replay) или ответвить (fork). Инфраструктура для долгих бизнес-процессов, не для программирования. | Run Autopilot-а и Run history | [досье][swarm] |

### Облачные агенты

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| Devin (managed Devins, бывший MultiDevin) | Cognition | Облачная сессия — своя VM с shell, IDE и браузером, результат — PR; сессия-координатор раздаёт работу дочерним. | Orchestrator и Wave | [досье][dv] |
| Factory Droids | Factory | Закрытый agent harness Droid с моделями разных вендоров (desktop, CLI, веб, IDE, CI); многоагентные Missions; подписка с тремя окнами лимитов. | Epic, Orchestrator, Autopilot, Harness | [досье][fd] |

### Командные платформы агентов

| Продукт | Вендор | Что это | Ближайшее в worfy | Досье |
|---|---|---|---|---|
| HumanLayer | HumanLayer (QueryTale, Inc.) | Командный control plane: daemon запускает Claude Code; общие задачи, документы плана с комментариями, review diff и PR по методу RPI (research, plan, implement). | Skills Harness-а, Linked machine | [досье][humanlayer], без проверки фактов |
| Multica | Index Labs | Командная доска, где исполнитель issue — человек или CLI-агент; daemon запускает агента и пишет результат в issue; Autopilots по cron, история запусков с ценой. | Ticket-ы, Autopilot | [досье][multica], без проверки фактов |
| Paperclip | Paperclip Labs | Self-hosted сервер под MIT: «компания» агентов с org chart, задачами, бюджетами в деньгах, heartbeats и одобрениями человека. | Дневной бюджет Limits, Autopilot | [досье][paperclip], без проверки фактов |

[oh]: openhands.md
[fd]: factory-droids.md
[dv]: devin.md
[vk]: vibe-kanban.md
[gt]: gas-town.md
[orca]: orca.md
[sym]: openai-symphony.md
[swarm]: division-swarm.md
[ccd]: claude-code-desktop-app.md
[ccc]: claude-code-cloud-sessions-and-projects.md
[cav]: claude-code-agent-view.md
[cat]: claude-code-agent-teams.md
[ccp]: claude-code-plugins-and-marketplaces.md
[cx]: codex-app-codex-in-the-chatgpt-desktop-app.md
[gca]: github-copilot-app.md
[gcc]: github-copilot-cloud-agent-and-agent-hq-mission-.md
[cur]: cursor-agents-window-cloud-agents-and-automation.md
[ag]: google-antigravity.md
[air]: jetbrains-air.md
[dd]: devin-desktop-formerly-windsurf.md
[kiro]: kiro.md
[warp]: warp-agent-management-panel-oz-cloud-agents-and-.md
[intent]: intent-augment-code.md
[conductor]: conductor.md
[paradev]: paradev-formerly-superset.md
[nimbalyst]: nimbalyst-formerly-crystal.md
[ao]: agent-orchestrator-orchestrator-inc.md
[emdash]: emdash.md
[traycer]: traycer.md
[maestro]: maestro.md
[t3]: t3-code.md
[agor]: agor.md
[cate]: cate.md
[humanlayer]: humanlayer.md
[multica]: multica.md
[paperclip]: paperclip.md

## 3. Продукты без досье

111 продуктов tier B. Строки взяты из данных поиска и никем не проверялись: так решил владелец 2026-11-13, потому что оставшаяся работа не помещалась в лимит подписки. Ещё 87 записей отброшены при отборе (повторы, закрытые продукты, продукты не по теме) и здесь не перечислены.

Без досье остались и 11 продуктов tier A: исследование продуктов поменьше остановилось, когда кончился бюджет, а заметок по ним не было. Это [Cline Kanban](https://docs.cline.bot/kanban/overview), [GitKraken Kepler](https://www.gitkraken.com/kepler), [Archon](https://archon.diy), [BMad Loop](https://github.com/bmad-code-org/bmad-loop), [GSD / Open GSD](https://opengsd.net), [Superpowers](https://github.com/obra/superpowers), [ECC (Everything Claude Code)](https://ecc.tools), [oh-my-claudecode](https://oh-my-claudecode.dev), [Ruflo (formerly Claude Flow)](https://github.com/ruvnet/ruflo), [herdr](https://herdr.dev), [Zenflow (Zencoder)](https://zencoder.ai/zenflow).

### Менеджеры сессий и desktop-приложения (19)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Claude Squad](https://smtg-ai.github.io/claude-squad/) | TUI, который держит агентов в tmux, каждого в своём worktree. | Базовый инструмент этого класса; режим `--autoyes` сам одобряет запросы агента. |
| [CCManager](https://github.com/kbwo/ccmanager) | Менеджер сессий: запросы агента одобряет Haiku или свой проверяющий скрипт, с ручным запасным путём. | Одобрение моделью стоит сравнить с Approval policy worfy. |
| [Sculptor](https://imbue.com/product/sculptor) (Imbue) | Агенты в контейнерах, несколько агентов делят одно рабочее место. | Контейнеры вместо worktree. |
| [Container Use](https://container-use.com) (Dagger) | Своё контейнерное окружение у каждого агента. | Другая модель изоляции, чем worktree. |
| [Jean](https://jean.build) (coolLabs) | Агент, который обходит issues, сервер jean-server, режимы экономии token-ов. | Режимы экономии близки к Eco mode. |
| [Paseo](https://paseo.sh) | Daemon и relay, UI plugins, голосовой ввод; агенты запускают других агентов. | Архитектура daemon и relay для работы издалека. |
| [cmux](https://cmux.com) (Manaflow) | Терминал с сигналами внимания и статусом PR во вкладках. | Сигналы внимания стоит сравнить с уведомлениями worfy. |
| [Aperant (formerly Auto Claude)](https://aperant.com) | Автономная сборка приложения с циклом QA и памятью. | Цикл QA и то, почему продукт остановился. |
| [Xum (formerly Mux)](https://xum.coder.com) (Coder) | Параллельные агенты с видом расхождения веток git и панелью расходов. | Вид расхождения веток и панель расходов; у того же вендора есть Coder Agents и Agent Relay. |
| [Parallel Code](https://parallelcode.app) | Mind map, связанная с задачами, второе мнение на review, гонка нескольких агентов на одной задаче. | Mind map, связанную с задачами, стоит сравнить с Product Session. |
| [Cezar](https://cezar.run) (Open Mercato) | Best-of-N запуски с живой ценой, режим VPS. | Живой показ цены и best-of-N. |
| [OpenChamber](https://openchamber.dev/) | Интерфейс агентов с Session Goals. | Устройство целей у Session. |
| [Proliferate](https://proliferate.com/docs) | Одна конфигурация на всех агентов. | Общая конфигурация разных Vendor-ов — к переносу Harness на Codex. |
| [Lanes](https://lanes.sh/) | Запускает официальные CLI агентов в настоящих терминалах. | Его утверждение о раздельной оплате и прочтение условий использования Claude Code Viewer надо сверить с первоисточниками и с [исследованием правил входа](../../product/roadmap-worfy/research-правила-входа-для-внешних-пользователей.md). |
| [Pane](https://runpane.com) (Greenfield) | Понимает файл `conductor.json`. | Путь переезда для пользователей Conductor. |
| [bb](https://getbb.app) | IDE, которую меняют её же агенты. | Модель самоизменения инструмента. |
| [Verdent](https://www.verdent.ai) | Параллельные агенты для программирования с режимом Eco Mode. | Имя Eco Mode совпадает с Eco mode worfy. |
| [Poolside Desktop](https://poolside.ai) (Poolside) | Desktop-приложение агента. | Сначала подтвердить, что продукт существует. |
| [opcode (formerly Claudia)](https://opcode.sh) | Desktop GUI для Claude Code. | Ранний образец GUI над Claude Code. |

### Координация агентов и review (5)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Ordewell](https://ordewell.ai) | Модель выбирается под задачу, у работы есть циклы проверки и исправления. | Выбор модели под задачу и циклы исправления. |
| [Agentic Orchestrator (DoorDash)](https://github.com/doordash-oss/agentic-orchestrator) | Открытый pipeline агентов большой компании под надзором людей. | Как крупная компания надзирает за run-ами агентов. |
| [Singular (singular-lite)](https://github.com/xiperinc/singular-lite) | Lease на работу и пакеты доказательств. | Пакеты доказательств стоит сравнить с Evidence. |
| [Foremerge](https://foremerge.com) | Агенты заранее заявляют смысловые части кода, чтобы не конфликтовать. | Механизм заявок для параллельных Ticket-ов. |
| [Pinrail](https://pinrail.dev) (Forgeplane) | Inbox review результатов агентов с типами. | Стоит сравнить с PR inbox. |

### Limits и расход (7)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Offrun](https://offrun.dev/) | Переключение на другой аккаунт на пределе лимита, находки reviewer-а как условие. | К вопросу владельца о поведении на пределе Limits; переключение аккаунтов — риск по условиям подписки. |
| [Claude Code usage reporting (/usage, /insights, analytics, OpenTelemetry)](https://code.claude.com/docs/en/monitoring-usage) (Anthropic) | Расход по skill и subagent с рекомендациями. | Данные для полос Limits и планирования Run-а; заметка Datadog о шаблонах лишнего расхода. |
| [amux](https://amux.io) (Mixpeek) | Держит работу на пределе лимита и продолжает после сброса. | К вопросу владельца о Limits; восстановление после перезагрузки. |
| [ccusage](https://ccusage.com/) | Расход по локальным log-ам Claude Code. | Образец для полос Limits. |
| [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | Скорость расхода в реальном времени и прогноз предела. | Прогноз для планирования Run-а. |
| [CodexBar](https://codexbar.app) (Peter Steinberger) | Лимиты Codex и Claude в строке меню. | Образец для полос Limits. |
| [Splitrail](https://splitrail.dev) (Piebald AI) | Учёт расхода нескольких агентов. | Расход нескольких Vendor-ов. |

### История сессий (5)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Spotify Xirp](https://xirp.spotify.com/) | Документация, собранная из сессий агентов. | Стоит сравнить с Flight Recorder. |
| [Agent Sessions](https://jazzyalex.github.io/agent-sessions/) | Просмотр сессий Claude Code и Codex. | Интерфейс истории сессий. |
| [agentsview](https://agentsview.io) | Просмотр сессий и аналитика. | Стоит сравнить с Flight Recorder. |
| [SpecStory](https://specstory.com/) | Сохраняет сессии агентов в markdown. | Запись сессий. |
| [Entire](https://entire.com) | Сохраняет сессии агентов вместе с commit-ами. | Связь сессии и commit-а. |

### Редакторы, IDE и функции вендоров (8)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [TRAE](https://www.trae.ai) (ByteDance) | IDE с автономным режимом SOLO. | Режим SOLO; вендора стоит подтвердить по первоисточникам. |
| [Amp](https://ampcode.com) | Агент для программирования со Spaces. | Модель Spaces для общей работы агентов. |
| [OpenCode](https://opencode.ai) (Anomaly) | Open-source агент с `/goal` и запуском по расписанию. | Возможный третий Vendor worfy. |
| [Claude Code Channels](https://code.claude.com/docs/en/channels) (Anthropic) | События CI и чатов приходят в идущую сессию. | Подача событий в сессию и передача запросов разрешения. |
| [Codex plugins, skills and marketplaces](https://developers.openai.com/plugins/build/plugins) (OpenAI) | Plugin-ы и skills для Codex. | Путь переноса Harness на Codex; hooks там слабее. |
| [VS Code Agents window](https://code.visualstudio.com/docs/copilot/agents/overview) (Microsoft) | Агенты рядом друг с другом в VS Code. | Параллельные агенты становятся бесплатной общей функцией. |
| [Zed (Parallel Agents and the Agent Client Protocol)](https://zed.dev/docs/ai/parallel-agents) | Параллельные агенты по ACP с архивом и восстановлением worktree. | ACP вместо управления CLI через терминал и что это значит для оплаты. |
| [Qoder (Quest Mode and Quest Remote)](https://qoder.com) (Alibaba) | Quest Mode с проверяемой цепочкой артефактов, Quest Remote. | Цепочку артефактов стоит сравнить с Evidence. |

### Canvas-ы (9)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [nodeterm](https://nodeterm.dev) | Связи между узлами передают контекст, subagent-ы — дочерние узлы. | Передача контекста по связям на Canvas. |
| [Maestri](https://www.themaestri.app/en) | Провода между терминалами, заметки агентов о ходе работы. | Заметки агентов прямо на Canvas. |
| [AgentGrid](https://agentgrid.sh) | Координатор, team lead и workers на Canvas. | Иерархия агентов в пространстве. |
| [Horizon](https://github.com/peters/horizon) | Пресеты, авто-раскладка, minimap, панель VNC. | Механика раскладки Canvas. |
| [CanvasTTY](https://github.com/howdeploy/CanvasTTY) | Пределы глубины и числа делегирования, hooks политики. | Пределы делегирования между агентами. |
| [tldraw offline](https://tldraw.dev/blog/tldraw-offline) | Файлы canvas, которые могут править агенты. | Формат файла Canvas, доступный агентам. |
| [49 Agents (49-IDE)](https://49agents.com) | Canvas, который охватывает много машин. | Стоит сравнить с Linked machine. |
| [Murmell](https://murmell.com/) | Агент заявляет файл перед записью. | Как агенты избегают конфликтов. |
| [Multipeer](https://multipeer.sh/) (Multiplayer Labs) | Canvas агентов для нескольких людей сразу. | Модель совместной работы людей. |

### Kanban и трекеры (11)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Obeya](https://obeya.si) | Одобрение работы по демо-видео с пояснениями. | Видео как доказательство для одобрения. |
| [Kanban Code](https://github.com/langwatch/kanban-code) (LangWatch) | Колонки по состоянию PR, режим keep-awake. | Колонки доски по состоянию PR. |
| [KanBots](https://www.kanbots.dev) | Цикл исправлений после QA и бюджеты. | Бюджеты и цикл исправлений; продукт, возможно, заброшен. |
| [Kandev](https://kandev.ai) | Агент на каждый шаг, workflow в YAML, снимки с вырезанными данными. | Снимки с вырезанными данными стоит сравнить со scrub личных данных в worfy. |
| [Kander](https://quicktui.ai/open-source/kander/) (QuickTUI) | Расписание по предсказанному пересечению файлов, двухступенчатый review. | Расписание с учётом пересечения файлов — для Wave-ов. |
| [Agent Kanban](https://agent-kanban.dev) | Происхождение каждого run-а записано; reviewer не может быть исполнителем. | Правило разделения reviewer-а и исполнителя. |
| [AgentsRoom](https://agentsroom.dev) | Доска «ждёт тебя» по всем Project-ам с одним полем ввода. | Устройство общего списка ожиданий. |
| [Backlog.md](https://backlog.md) | Задачи в markdown с Definition of Done и точкой проверки плана. | Похоже на файлы Ticket-ов worfy. |
| [CCPM](https://automaze.io) (Automaze) | Epic-и и задачи как sub-issues GitHub. | Модель Epic и Ticket поверх GitHub. |
| [Linear (Linear Agent and agent delegation)](https://linear.app/agents) | Трекер, из которого issues передают агентам; сессии идут на Claude Code или Codex. | Альтернатива Ticket-ам worfy со стороны трекера. |
| [Beads](https://beads.gascity.com) | Трекер issues для агентов поверх git. | Стоит сравнить с файлами Ticket-ов. |

### Облачные агенты и платформы (11)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Augment Code Cosmos (Cloud Agents)](https://www.augmentcode.com/product/cloud-agents) | Облачные запуски агентов Augment. | Облачная сторона вендора Intent. |
| [Tembo](https://www.tembo.io/) | Фоновые агенты с режимом MAX и выбором модели под задачу. | Выбор модели под задачу. |
| [Cosine (Genie, Swarm mode)](https://cosine.sh) | Агент Genie с режимом Swarm и тарифом Task Owner. | Тариф Task Owner и swarm. |
| [Kilo Code (Agent Manager, Cloud Agents)](https://kilo.ai) (Anaconda) | Agent Manager и облачные агенты; хостит Gas Town by Kilo. | Gas Town by Kilo и история Roo Code. |
| [Roomote (by the Roo Code team)](https://roomote.dev/) | Удалённый агент от команды Roo Code. | Куда движется Roo Code. |
| [Atlassian Rovo Dev in Jira](https://www.atlassian.com/blog/announcements/rovo-dev-in-jira) | Агент для программирования, которым управляют issues Jira. | Агенты, которых ведёт трекер. |
| [GitLab Duo Agent Platform](https://about.gitlab.com/press/releases/2026-01-15-gitlab-announces-duo-agent-platform-general-availability/) | Платформа агентов внутри GitLab. | Агенты, встроенные в платформу кода. |
| [boxes.dev](https://boxes.dev/) | Удалённые машины для агентов. | Модель удалённого выполнения. |
| [Evergreen (Carta)](https://evergreen.carta.com/blog/introducing-evergreen) | Внутренняя платформа агентов компании Carta. | Как крупная компания строит свою платформу. |
| [Robin (formerly Open SWE)](https://www.langchain.com/blog/open-swe-an-open-source-framework-for-internal-coding-agents) (LangChain) | Учится предпочтениям review и следит за CI. | Обучение на review и наблюдение за CI. |
| [GitHub Agentic Workflows (gh-aw)](https://github.github.com/gh-aw/) | Workflow агентов в GitHub Actions с safe outputs. | Шаблон safe outputs. |

### Swarm-ы и циклы без человека (11)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Gas City](https://gascity.com) | Платформа-преемник от авторов Gas Town. | Досье Gas Town её не покрывает. |
| [Agent Swarm](https://agent-swarm.dev) (desplega.ai) | Swarm агентов для программирования. | Механика координации swarm. |
| [metaswarm](https://github.com/dsifry/metaswarm) | Многоагентный swarm для Claude Code. | Проверки внутри swarm. |
| [Slate](https://randomlabs.ai) (Random Labs) | Thread Weaving между нитями агентов. | Thread Weaving; текущий статус стоит подтвердить. |
| [BAND for Developers](https://band.ai) | Слой совместной работы агентов. | Обмен сообщениями между агентами. |
| [Ralph Orchestrator](https://mikeyobrien.github.io/ralph-orchestrator/) | Управляет циклом Ralph. | Покрывает и snarktank/ralph, и plugin ralph-loop. |
| [ccswarm](https://github.com/nwiizo/ccswarm) | Swarm Claude Code по ролям, каждый агент в своём worktree. | Swarm по ролям. |
| [Claude Code Agent Farm](https://github.com/Dicklesworthstone/claude_code_agent_farm) | Много агентов Claude Code параллельно. | Масштаб и координация через lock-и. |
| [Continuous Claude](https://anandchowdhary.com/open-source/2025/continuous-claude) | Непрерывный цикл PR с CI. | Цикл PR без человека. |
| [Babysitter](https://a5c.ai) (a5c.ai) | Детерминированное управление run-ами агентов. | Детерминированный контроль run-а. |
| [Kiro Crew](https://kiro.dev/crew/) (Amazon Web Services) | Многоагентная команда Kiro. | Роли в команде агентов. |

### Spec-методики (9)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | Agile-методика для агентов. | Основа BMad Loop. |
| [GitHub Spec Kit](https://github.github.io/spec-kit/) | Набор для разработки от spec. | Стандарт формата spec. |
| [OpenSpec](https://openspec.dev/) (Fission AI) | Предложения изменений в виде spec. | Процесс изменения spec. |
| [Hamster (makers of Taskmaster AI)](https://tryhamster.com) | PRD превращается в граф задач. | Разбиение работы на задачи. |
| [Agent OS](https://buildermethods.com/agent-os) (Builder Methods) | Система стандартов и spec для агентов. | Файлы стандартов, похожие на rules.md. |
| [cc-sdd](https://github.com/gotalab/cc-sdd) | Разработка от spec для Claude Code. | Spec в стиле Kiro внутри Claude Code. |
| [Spec Kitty](https://spec-kitty.ai) | Набор для spec с доской Kanban. | Spec вместе с доской. |
| [AI-DLC (AI-Driven Development Life Cycle)](https://awslabs.github.io/aidlc-workflows/) (AWS Labs) | Процессы жизненного цикла разработки с агентами. | Методика вендора. |
| [Tessl](https://tessl.io/) | Разработка от spec и registry skills. | Registry skills. |

### Harness-ы, plugin-ы и skills (7)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [OmO (oh-my-openagent, formerly oh-my-opencode)](https://omo.dev) | Harness для агентов семейства OpenCode. | Harness для третьего Vendor-а. |
| [oh-my-codex](https://oh-my-codex.dev) | Harness для Codex. | Harness на Codex. |
| [Compound Engineering plugin](https://every.to/compound-engineering) (Every) | Цикл plan, work, review и накопление lessons. | Цикл lessons. |
| [wshobson/agents](https://github.com/wshobson/agents) | Большой набор subagents для Claude Code. | Каталог subagents. |
| [claude-mem](https://claude-mem.ai) | Память между сессиями. | Стоит сравнить с qmd и memory. |
| [Planning with Files](https://github.com/OthmanAdi/planning-with-files) | Состояние плана в файлах. | Стоит сравнить с файлом состояния `HANDOFF.md`. |
| [TDD Guard](https://github.com/nizos/tdd-guard) | Hook, который требует писать test первым. | Принуждение через hook. |

### Удалённый доступ (5)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Claude Code Remote Control (with Dispatch)](https://code.claude.com/docs/en/remote-control) (Anthropic) | Управление сессиями с телефона; одобрения в Dispatch истекают через 30 минут. | Присутствие человека, доверенные устройства и срок одобрения. |
| [Happy](https://happy.engineering/) | Мобильный клиент Claude Code и Codex. | Удалённое управление с телефона. |
| [HAPI](https://hapi.run) | Удалённый доступ к сессиям агентов. | Устройство relay. |
| [CloudCLI (Claude Code UI)](https://cloudcli.ai) | Веб- и мобильный интерфейс для Claude Code. | Удалённый интерфейс. |
| [crystl](https://crystl.dev/) | Клиент для сессий агентов. | Удалённый интерфейс. |

### Закрытые, архивные и сменившие курс (4)

| Продукт | Что это | Чем может быть интересен |
|---|---|---|
| [Terragon](https://www.terragonlabs.com/) | Фоновые агенты Claude Code; код открыли после закрытия продукта. | Уроки закрытого продукта. |
| [Charlie (Charlie Labs)](https://charlielabs.ai/) | Агент с форматом файла DAEMON.md. | Формат DAEMON.md. |
| [Overstory (successor Warren)](https://github.com/jayminwest/overstory) | Многоагентная координация; продукт в архиве, преемник — Warren. | Уроки из архива. |
| [Omnara](https://www.omnara.com) | Сменил курс после того, как обёртка над CLI Claude Code не удержалась. | Обёртка над CLI Claude Code оказалась ненадёжной основой. |

## 4. Идеи для worfy

43 идеи прошли проверку по коду и планам worfy и оставлены: в worfy их нет (new) или есть только часть (partial). У partial «Что сделает worfy» описывает недостающую часть. Ценность — высокая или средняя. Объём — S, M, L или XL, от меньшего к большему, по оценке исследования. «Где видели» ведёт на досье, «Пример» — один факт из них. Номера идей сквозные, раздел 5 ссылается на них.

### Надёжность и расход Limits

1. **Детектор зацикливания агента: подсказка, затем blocked.** Ценность высокая, объём M; Epic [worfy-stuck-agents][s-stuck-agents].
   - Что сделает worfy: PostToolUse hook Harness-а записывает последние вызовы каждого агента: инструмент, хэш ввода, exit code. Шаблоны зацикливания: та же команда с тем же ненулевым exit code три раза, правка туда и обратно, ходы без tools, чередование A-B-A-B. На третьем повторе агент получает одну подсказку «смени подход или сообщи blocked», на следующем `guard.mjs` отказывает, и Ticket уходит в `blocked` с причиной loop. Stop hook отпускает агента с blocked по повтору той же записи о сбое. Работает и на Codex, и у фоновых implementer-ов.
   - Где видели: [OpenHands][oh], [Factory Droids][fd], [Codex app][cx], [Cursor][cur].
   - Пример: бот OpenHands ответил «I'm on it» 191 раз примерно за 4 часа на одном issue.
2. **Куда ушли Limits: разбивка расхода по Session, роли, Ticket-у и модели.** Ценность высокая, объём M; Epic [worfy-limits-ledger][s-limits-ledger].
   - Что сделает worfy: Сумма input, output, cache read и cache write из transcript-ов Claude Code и событий Codex. Разрезы: Session, Subagent, роль, Ticket, Epic, круг доработки, Vendor, модель. Доля окна Limits помечена как оценка. Чип на карточке Ticket-а и на Node, блок «Where the Limits went» в Run history, колонка в Work track.
   - Где видели: [OpenHands][oh], [Orca][orca], [Claude Code cloud sessions][ccc], [Claude Code Agent View][cav], [Claude Code agent teams][cat], [Claude Code plugins][ccp], [Codex app][cx], [JetBrains Air][air], [Devin Desktop][dd], [Kiro][kiro].
   - Пример: в cloud sessions Claude Code 8 threads потратили 476M token-ов, и разобрать, на что, невозможно; в Codex опрос ждущих агентов съел 19,8% token-ов.
3. **Потери prompt cache: причина, цена холодного старта, свежий разговор.** Ценность высокая, объём M; Epic [worfy-limits-ledger][s-limits-ledger].
   - Что сделает worfy: Доля cache read у каждой Session и Run-а. Вероятная причина падения: compaction, смена модели, новый список tools после подключения MCP сервера, пауза дольше часа. Оценка до действия: «перечитает ≈N token-ов, ≈X% окна». Правило Autopilot: выше порога начинать нового Orchestrator-а с Wave brief (сводки, которую Orchestrator пишет в конце Wave).
   - Где видели: [Factory Droids][fd], [Claude Code cloud sessions][ccc].
   - Пример: первый запрос после сброса окна съедает 30–40% нового окна (issue #68973 в Claude Code).
4. **Продолжить на другом Vendor-е, когда Limits исчерпаны.** Ценность высокая, объём L; Epic `worfy-limits-out`, черновика пока нет.
   - Что сделает worfy: Флажок в окне Start Autopilot «Use Codex when Claude Code's Limits are out». Переход только на границе Wave (ADR-0093: режимы Run-а действуют только на границе Wave), возврат после сброса. Окна Limits у каждого Vendor-а свои в бюджете и в истории Run-а; Run history называет Vendor-а каждой Wave. Кнопка «Continue on Codex» в ручной Session.
   - Где видели: [Gas Town][gt], [Orca][orca], [Cursor][cur].
   - Пример: в Orca запрос #20512, у пользователей 2–9 аккаунтов. Довод против ротации аккаунтов: знакомого Steve Yegge с 22 планами Max заблокировала защита от мошенничества.
5. **Никогда не переходить на платное использование молча.** Ценность высокая, объём M; Epic `worfy-limits-out`, черновика пока нет.
   - Что сделает worfy: Проверить на живом аккаунте, продолжает ли Run на платном использовании: `limits-wait.ts` не считает overage отказом. Выбор: Wait for reset (по умолчанию), Ask или Continue on paid usage до N USD на Run. Пометка «paid usage» на полосе Limits, строка в Run history, одно уведомление.
   - Где видели: [Devin Desktop][dd].
   - Пример: пользователи Devin Desktop пишут о непонятных списаниях и о пропавших 15 600 USD кредитов.
6. **Auto-continue и состояние «waiting for Limits» у любой Session.** Ценность высокая, объём M; Epic `worfy-limits-out`, черновика пока нет.
   - Что сделает worfy: Продолжение после сброса Limits у Session Ship ticket, ручной Session и Session на Codex, не только у Orchestrator-а. Состояние «waiting for Limits» со временем сброса, Retry now и Cancel. Сообщение, набранное во время ожидания, уходит в момент сброса. Session-ы просыпаются по одной с паузой: сначала Run, потом Orchestrator, потом критический путь. Список ждущих Session-ов в toolbar.
   - Где видели: [Claude Code desktop app][ccd], [Claude Code plugins][ccp], [GitHub Copilot app][gca].
   - Пример: запрос на это в Claude Code desktop app набрал 212 голосов; из примерно 11 сессий после сброса продолжила одна.
7. **Watchdog тишины хода и фонового implementer-а.** Ценность высокая, объём M; Epic [worfy-stuck-agents][s-stuck-agents].
   - Что сделает worfy: Время последнего события у каждого хода и каждого Subagent-а. Не считается тишиной: открытый запрос разрешения, идущий hook, растущий файл вывода, Gate full, ожидание lock-а e2e. Чип «busy · silent N min» с Interrupt и Restart по щелчку человека. В Autopilot Run останавливается с новой причиной `turn-hung` и передаётся человеку; автоматического Interrupt нет, фоновые implementer-ы не останавливаются.
   - Где видели: [OpenAI Symphony][sym], [Division Swarm][swarm], [Claude Code cloud sessions][ccc], [Google Antigravity][ag], [JetBrains Air][air].
   - Пример: в Division Swarm 4 расследования лежали без движения, пока их не закрыли таймеры.
8. **Session-ы и run переживают перезапуск, Update, падение и перезагрузку.** Ценность высокая, объём XL; Epic [worfy-continuity][s-continuity].
   - Что сделает worfy: Checkpoint Run-а на диске и выбор Resume или Discard при старте worfy. Session моложе часа продолжается сообщением «продолжи с состояния worktree». Push или merge, оставшийся без результата, помечается как «unknown side effects». 60 секунд на завершение работы перед выходом или Update. Второй шаг — процессы агентов вне приложения — требует нового ADR.
   - Где видели: [Orca][orca], [OpenAI Symphony][sym], [Claude Code Agent View][cav], [Codex app][cx], [Kiro][kiro].
   - Пример: в Orca (issue #9138) на экране было 8 сессий при примерно 46 живых процессах.
9. **Contract eval Harness на каждой новой версии Claude Code.** Ценность высокая, объём M; Epic [worfy-harness-guarantees][s-harness-guarantees].
   - Что сделает worfy: worfy замечает новую версию Claude Code и запускает короткие проверки: правила приходят на SessionStart, guard отказывает, Stop hook держит ход при красном Gate, skills `worfy:` видны, EnterWorktree есть. Пробный запуск без затрат и предел цены. Строка в Settings → Health. Нижняя граница версии в `engines` файла `harness/.claude-plugin/plugin.json`. Changelog разбирается в черновик Ticket-а для владельца.
   - Где видели: [Claude Code plugins][ccp].
   - Пример: за два месяца в changelog Claude Code около 330 строк о plugin-ах; версию 2.1.215 назвали поломкой совместимости.
10. **Эскалация модели по результату: Sonnet, затем Opus после красного Gate или REJECTED.** Ценность высокая, объём M; Epic [worfy-stuck-agents][s-stuck-agents].
   - Что сделает worfy: Режим «Eco with escalation» в меню Modes. Переход на модель сильнее только по событию: второй одинаковый отпечаток сбоя, исчерпан `MAX_BLOCKS`, REJECTED (вердикт reviewer-а «не принято») или узкий круг доработки; тогда Ticket берёт новый implementer на Opus. Переход виден в Ticket-е, Run history и на Node. Третий одинаковый отпечаток даёт `blocked` с причиной «Loop detected». Выбор владельца и Profile сильнее режима.
   - Где видели: [GitHub Copilot app][gca], [Kiro][kiro].
   - Пример: в Kiro каскад моделей дал 69,37% против 70,57% у сильной модели, и 80% задач закончились на дешёвой; в GitHub Copilot app режим Fusion взял Opus для commit и потратил месячный объём за день.

### Review и качество

11. **Кнопка Fix для PR: красный CI, конфликт, замечания review → Session на ветке PR.** Ценность высокая, объём M; Epic [worfy-pr-follow][s-pr-follow].
   - Что сделает worfy: Шаблоны действий Fix checks, Resolve conflicts и Address comments в группе Needs a fix PR inbox и на карточке Ticket-а. Действие запускает Session на head SHA ветки PR с brief: упавшие проверки, файлы конфликта, нити review, план исправления. Push — только отдельным щелчком пользователя, поэтому подпись кнопки — не голое «Fix».
   - Где видели: [OpenHands][oh], [Devin][dv], [Orca][orca], [OpenAI Symphony][sym], [Claude Code desktop app][ccd], [Claude Code cloud sessions][ccc], [Copilot cloud agent][gcc].
   - Пример: maintainer OpenHands называет конфликты merge и упавшие linter-ы любимыми задачами для агента.
12. **Reviewer на другом Vendor-е: Codex проверяет код Claude Code и наоборот.** Ценность высокая, объём M; Epic `worfy-review-findings`, черновика пока нет.
   - Что сделает worfy: `codex exec` или read-only нить app-server с определением reviewer-а смотрит diff от `worktree.base` и пункты Done when и возвращает находки и вердикт VERIFIED или REJECTED. Поле в Profile, лимиты Codex в планировании Run-а, путь без Codex. Сначала нужно решение владельца о разных Vendor-ах для разных ролей.
   - Где видели: [Factory Droids][fd], [Devin][dv], [Vibe Kanban][vk], [Division Swarm][swarm], [Codex app][cx], [GitHub Copilot app][gca], [Copilot cloud agent][gcc], [Kiro][kiro].
   - Пример: на production-PR Devin Review нашёл то, что пропустил review Claude, но пропустил найденное review Codex.
13. **Ticket или PR не может ослабить проверки, которые его судят.** Ценность высокая, объём M; Epic [worfy-harness-guarantees][s-harness-guarantees].
   - Что сделает worfy: Список verification-путей в Profile: workflow-ы CI, конфиги lint, typecheck, test runner и порогов coverage, `test/quarantine/`, `scripts/windows-verdict-scope.mjs`, определения reviewer-агентов. `guard.mjs` отказывает implementer-у в записи в эти пути, кроме путей, которые называет раздел `## Где в коде` его Ticket-а. Второй механизм идеи в данных обрезан.
   - Где видели: [OpenHands][oh], [Devin][dv], [Devin Desktop][dd], [Claude Code agent teams][cat], [Copilot cloud agent][gcc], [Google Antigravity][ag].
   - Пример: в Claude Code agent teams агенты докладывали об исправленной ошибке, которую только скрыли, и правили проверяющий код.
14. **Свой экран diff с комментариями к строкам, которые уходят агенту одной пачкой.** Ценность высокая, объём L; Epic [worfy-changes-view][s-changes-view].
   - Что сделает worfy: Экран diff для Ticket-а (worktree против merge-base с `worktree.base`), для Session с worktree и для PR. Режимы: вся ветка, по commit-у, Uncommitted, Last turn. Дерево файлов, inline и side-by-side, отметка viewed, которая снимается, когда файл меняется. Комментарии к строкам ложатся в лоток Comments on quotes и уходят Session одной пачкой. Входы — с карточки Ticket-а, Session Node и focus mode.
   - Где видели: [Factory Droids][fd], [Vibe Kanban][vk], [Orca][orca], [Codex app][cx], [Google Antigravity][ag], [JetBrains Air][air].
   - Пример: в Vibe Kanban side-by-side diff назвали лучшей функцией и возмутились, когда редизайн его спрятал (issue #2300).
15. **Находки review — записи со статусом; re-review только по новому diff.** Ценность высокая, объём M; Epic `worfy-review-findings`, черновика пока нет.
   - Что сделает worfy: Скрипт Harness (например, `bin/findings add`) и формат записи находки: lens, серьёзность, файл и строка, сценарий, правка, commit и состояние — open, fixing, fixed, skipped с причиной, no change needed, invalidated, needs owner. Файл лежит рядом с Ticket-ом или PR, в Silent mode — в Workflow folder. Reviewer, verifier и continuous-audit пишут через него на обоих Vendor-ах; повторный круг меняет состояния записей, а не текст.
   - Где видели: [Claude Code desktop app][ccd], [Devin Desktop][dd].
   - Пример: обзор Very Good Ventures хвалит живой мониторинг параллельных reviewer-ов в Claude Code desktop app; формы находки нет ни там, ни в worfy.
16. **Наблюдение за PR без вызова модели: Session будят только на событие.** Ценность высокая, объём M; Epic [worfy-pr-follow][s-pr-follow].
   - Что сделает worfy: Наблюдение за PR до merge на уже существующем читателе GitHub (ответы 304, заголовки X-Ratelimit). Опрос раз в 1–2 минуты, пока идёт CI, и не чаще раза в час, пока PR ждёт review. Событие будит Session, связанную с PR через Binding. Без события модель не вызывается.
   - Где видели: [GitHub Copilot app][gca], [Kiro][kiro], [Claude Code Agent View][cav].
   - Пример: пользователи GitHub Copilot app жалуются, что модель гоняют ради проверок, которые сделал бы один вызов API: ночной опрос 16 мелких PR раз в 10 минут.
17. **Очередь проверок владельца: приёмка в одном месте, human review только по риску, предел очереди.** Ценность высокая, объём M; Epic [worfy-acceptance][s-acceptance].
   - Что сделает worfy: Вид Acceptance: Ticket-ы, которые ждут проверки владельца, с Evidence, ручными пунктами Done when и версией Stable copy. Pass или Fail с комментарием; строку проверки владельца агент пишет через `ticket evidence` (ADR-0002: worfy — вид над файлами workflow). Review человеком по риску — вид Stage с условием в коде (ADR-0067: Pipeline в Profile). Предел очереди — только после нового решения владельца.
   - Где видели: [Claude Code agent teams][cat], [Copilot cloud agent][gcc].
   - Пример: пользователи Claude Code agent teams говорят, что узкое место — проверка, а не раздача работы.
18. **Hook не пускает merge и опасные действия с GitHub мимо условия merge.** Ценность высокая, объём S; Epic [worfy-harness-guarantees][s-harness-guarantees].
   - Что сделает worfy: Hook не пускает `gh pr merge`, включая `--admin`, и merge через `gh api` (REST или GraphQL), пока не выполнено условие merge скрипта `land`. Запись статусов `review`, `check/*` и `deploy` в обход `bin/ticket mark` тоже запрещена. Экстренный merge остаётся за владельцем.
   - Где видели: [Claude Code cloud sessions][ccc].
   - Пример: в cloud sessions Claude Code (issue #97924) агенты слили два PR с красным CI, один — примерно через 4 секунды после выхода из draft; 4 PR пришлось откатить.
19. **Lens-ы test quality и wiring с написанными правилами и Shadow mode для новой lens.** Ценность высокая, объём M; Epic `worfy-review-findings`, черновика пока нет.
   - Что сделает worfy: Раздел «Lens: tests» в `harness/agents/reviewer.md`: каталог ослабления test-ов (удалён test или assert, добавлен skip, расширен допуск, mock вместо реального вызова) и проверка «откатить изменение кода в своей копии — новый test должен упасть», с исключениями владельца. Lens wiring: новый модуль, флаг, endpoint или настройка, до которых не доходит ни один путь. Новая lens сначала идёт в Shadow mode.
   - Где видели: [Gas Town][gt].
   - Пример: в Gas Town агенты правят или удаляют test-ы вместо исправления кода, а worker-ы закрывали задачи без кода (issue #2416).

### Рабочее место и интерфейс

20. **Свой экран Changes: diff с комментариями к строкам, которые уходят агенту.** Ценность высокая, объём L; Epic [worfy-changes-view][s-changes-view].
   - Что сделает worfy: Diff Node или вкладка focus mode; Stage Human review открывает его одной кнопкой. Области: ветка против merge-base (с переключением базы), Uncommitted, последний ход по снимкам, «с прошлого просмотра». Комментарии к строкам уходят агенту.
   - Где видели: [Devin][dv], [Claude Code desktop app][ccd], [Claude Code cloud sessions][ccc], [GitHub Copilot app][gca], [Copilot cloud agent][gcc], [Cursor][cur], [Devin Desktop][dd], [Kiro][kiro], [Warp][warp].
   - Пример: просьбу о diff против других веток, а не только main, в Claude Code desktop app поддержали 143 голосами.
21. **Единый список «Needs you» по всем Project-ам с ответом на месте.** Ценность высокая, объём L; Epic `worfy-needs-you`, черновика пока нет.
   - Что сделает worfy: Один список по всем Project-ам: карточки запросов разрешения и вопросов, Session-ы с ошибкой, park с таймером 60 минут, Ticket-ы, ждущие владельца, PR. Счётчик и ответ прямо из списка.
   - Где видели: [Claude Code Agent View][cav], [Kiro][kiro], [Google Antigravity][ag], [Warp][warp], [Codex app][cx], [Division Swarm][swarm], [OpenAI Symphony][sym].
   - Пример: в Google Antigravity первые тестеры называли inbox решений главной ценностью, но к февралю 2026 его убрали без объяснений.
22. **Pick element и Annotate в Browser Node: человек указывает агенту на элемент страницы.** Ценность высокая, объём M; Epic `worfy-ticket-preview`, черновика пока нет.
   - Что сделает worfy: Pick element и Annotate в Browser Node работают как inspector DevTools через CDP: URL, селектор и ссылка на элемент в формате browser_read. Пометки уходят агенту.
   - Где видели: [Factory Droids][fd], [Devin][dv], [Orca][orca], [Codex app][cx], [Cursor][cur], [Kiro][kiro].
   - Пример: пользователь Hacker News называет Design Mode главной причиной выбрать Orca.
23. **Unread у Session и переход к следующей непрочитанной.** Ценность высокая, объём S; Epic `worfy-needs-you`, черновика пока нет.
   - Что сделает worfy: Пометка Unread у Session, которая закончила ход, пока человек смотрел другую, и переход к следующей непрочитанной. Состояние хранится в data folder, отдельно для каждого экрана (ADR-0053: несколько экранов на один Project). Можно сделать раньше Epic-а отдельным polish Ticket-ом.
   - Где видели: [OpenHands][oh], [Vibe Kanban][vk], [JetBrains Air][air].
   - Пример: в OpenHands запрос unread (#17140) открыт, а issue о том, что «закончил и ждёт» выглядит как «работает», завёл сам CEO.
24. **Прямой канал к одному работающему Subagent-у: написать, прервать, остановить.** Ценность высокая, объём L; отдельная идея, без Epic-а.
   - Что сделает worfy: Поле ввода к одному работающему Subagent-у, кнопки «Stop after this step» и «Stop now». Виден статус доставки сообщения.
   - Где видели: [Claude Code agent teams][cat].
   - Пример: в Claude Code agent teams прерывание lead не останавливает teammates.

### Безопасность

25. **OS sandbox Vendor-а для агентов в Autopilot run.** Ценность высокая, объём L; отдельная идея, без Epic-а.
   - Что сделает worfy: Session-ы Autopilot стартуют в sandbox ОС от самого Vendor-а: у Claude Code опция `sandbox` в Agent SDK с корнями Run-а, у Codex `workspace-write` с сетью. Открытые вопросы: Windows, что делать, если sandbox недоступен, и как показать нарушения в Run history.
   - Где видели: [OpenHands][oh], [Gas Town][gt], [Claude Code desktop app][ccd], [GitHub Copilot app][gca], [Google Antigravity][ag].
   - Пример: в OpenHands старт sandbox на Docker занимал около 15 секунд, и пользователи уходили из-за накладных расходов.
26. **Guard-ы в любом permission mode: hard deny в hook, защищённые файлы правил, проверка при старте.** Ценность высокая, объём M; Epic [worfy-harness-guarantees][s-harness-guarantees].
   - Что сделает worfy: Hard deny Approval policy (ADR-0098: правила, по которым worfy отвечает на запросы агента) переезжает в PreToolUse hook и действует в любом permission mode, включая `bypassPermissions`. Защищённые файлы: настройки Claude Code, `.mcp.json`, `~/.codex`, `hooks.json`, CLAUDE.md, AGENTS.md. Проверка при старте, что guard-ы загружены.
   - Где видели: [Factory Droids][fd], [Codex app][cx], [Kiro][kiro].
   - Пример: в Kiro prompt injection переписала настройки и разрешила любые команды; на форуме Codex агент удалял файлы за пределами папки на Windows.

### Память и контекст

27. **Состояние задачи после compaction: цель, затронутые файлы, ошибки, следующий шаг.** Ценность высокая, объём S; Epic [worfy-continuity][s-continuity].
   - Что сделает worfy: Инструкции для сводки compaction по ролям: цель, затронутые файлы, ошибки, следующий шаг. Ветка SessionStart для источника `compact`, которая возвращает агенту цель и пункты Done when. На Codex — `compact_prompt`.
   - Где видели: [Factory Droids][fd], [Division Swarm][swarm].
   - Пример: в замере Factory после compaction хуже всего сохраняется список затронутых файлов: 2,45 у Factory, 2,33 у Anthropic, 2,19 у OpenAI.
28. **Разбор неудачных и дорогих run-ов: сигналы копятся, по кнопке Session готовит PR с lessons.** Ценность высокая, объём L; Epic `worfy-lessons-loop`, черновика пока нет.
   - Что сделает worfy: Сборщик по всем Run-ам и Session-ам кладёт сигналы трудностей в один локальный log со ссылкой на Run, Ticket, PR и место в transcript-е. Новые сигналы: Interrupt и повтор той же просьбы другими словами; решение без владельца, которое владелец потом отменил; Ticket, у которого Gate или REJECTED повторяются в разных Run-ах. По порогу log виден в worfy, а кнопка запускает Session, которая разбирает его и открывает PR с lessons.
   - Где видели: [Factory Droids][fd], [Devin][dv], [Warp][warp].
   - Пример: в Factory так решено 73% найденных проблем, в среднем меньше чем за 4 часа.

### Окружения и worktree

29. **Подготовка нового worktree из Profile: setup, копия ignored-файлов, деревья заранее.** Ценность высокая, объём L; Epic `worfy-worktree-setup`, черновика пока нет.
   - Что сделает worfy: Шаг setup сразу после `git worktree add` в skill ship-ticket и у implementer-а, с timeout и путём к main checkout. Поле `include`: копия git-ignored файлов (`.env.local`, `.npmrc`, локальные сертификаты) из main checkout с пределом размера и без вывода содержимого в log. Общие папки через symlink. Деревья, созданные заранее. Экран worktree-ов с размерами и уборкой.
   - Где видели: [Factory Droids][fd], [Orca][orca], [Codex app][cx], [Copilot cloud agent][gcc], [Cursor][cur], [JetBrains Air][air].
   - Пример: в Factory Droids есть setup profile и файл `.worktreeinclude`, а token-ы убраны из окружения скриптов.
30. **Dev server Ticket-а под управлением worfy: свой порт на worktree и Browser Node на URL.** Ценность высокая, объём L; Epic `worfy-ticket-preview`, черновика пока нет.
   - Что сделает worfy: Поле `dev_server` или `services` в Profile, номер slot у каждого worktree, переменные `WORFY_PORT` и `WORFY_SLOT`. worfy запускает dev server Ticket-а на своём порту и открывает Browser Node на его URL.
   - Где видели: [Vibe Kanban][vk], [Claude Code desktop app][ccd], [GitHub Copilot app][gca], [Google Antigravity][ag], [Warp][warp].
   - Пример: в Vibe Kanban (issue #3502) один агент убивает dev servers других, а двое спорят за порт 3000.
31. **Свой worktree для ручной Session и видно, где пишет каждая Session.** Ценность высокая, объём M; Epic `worfy-worktree-setup`, черновика пока нет.
   - Что сделает worfy: Выбор места в «New session»: «Project root» или «New worktree», умолчание в настройках Project-а. Дерево создаётся сразу или перед первой правкой; база — default branch, HEAD или любой ref; ветка по шаблону. На Node и в sidebar видно, в какую папку и ветку пишут Session и её Subagent-ы, в том числе после `EnterWorktree`.
   - Где видели: [OpenHands][oh], [Claude Code Agent View][cav].
   - Пример: в OpenHands co-founder пишет, что интерфейс не показывает, где правит агент.

### Раздача работы, Run-ы и события

32. **Triggers: Session по расписанию и событиям GitHub по правилам человека.** Ценность высокая, объём L; Epic `worfy-triggers`, черновика пока нет.
   - Что сделает worfy: Правила запуска Session или Run-а в Project settings, рядом с Profile. Правило срабатывает по расписанию (cron или готовые пресеты) или по событию GitHub (новый PR, красный CI, запрос review) и само называет, что запускать. После нескольких неудач подряд правило встаёт на паузу. Run history показывает, что Run запущен правилом.
   - Где видели: [OpenHands][oh], [Factory Droids][fd], [Vibe Kanban][vk], [Orca][orca], [Claude Code desktop app][ccd], [Claude Code cloud sessions][ccc], [Codex app][cx], [GitHub Copilot app][gca], [Copilot cloud agent][gcc], [Cursor][cur], [Google Antigravity][ag], [JetBrains Air][air], [Kiro][kiro].
   - Пример: собственное исследование рынка worfy 2026-11-08 называет этот пробел; на Hacker News обсуждение Routines в Claude Code набрало 720 points.
33. **Застрявший Ticket не останавливает весь Run: ограниченные повторы, потом пропуск.** Ценность высокая, объём M; Epic [worfy-stuck-agents][s-stuck-agents].
   - Что сделает worfy: Когда Ticket остался в работе после хода, Run не останавливается по `wave-unfinished`, `no-progress` или `background-stalled`, а делает повторную попытку с записью о прошлой. У каждого Ticket-а счётчик попыток; после предела Orchestrator откладывает Ticket через `ticket block`, а остальная Wave и очередь идут дальше. Красный CI main по-прежнему останавливает весь Run.
   - Где видели: [Gas Town][gt], [OpenAI Symphony][sym], [Claude Code plugins][ccp].
   - Пример: пользователи Gas Town уходят, потому что система так и не заработала стабильно без присмотра.
34. **Доводка PR Ticket-а по его событиям: CI, review threads, конфликт.** Ценность высокая, объём L; Epic [worfy-pr-follow][s-pr-follow].
   - Что сделает worfy: Подписка в main-процессе на PR, связанный с Session через Binding. Она будит Session одним сводным сообщением, когда все checks завершились, появилась новая нить review или changes requested, возник конфликт с базой, PR слит или закрыт. На карточке Session виден индикатор Listening. Работает и для ручных Session-ов; ответы и push — отдельными щелчками пользователя.
   - Где видели: [Cursor][cur], [Warp][warp].
   - Пример: в Cursor стартовые правила координатора — подписаться на CI и ответить на каждую нить review.
35. **Goal у любой Session и автопродолжение цели после сброса лимита.** Ценность высокая, объём M; отдельная идея, без Epic-а.
   - Что сделает worfy: Поле Goal у любой Session: Outcome, Constraints, Verification. Строка прогресса цели с паузой, правкой и сбросом, временем и бюджетом token-ов; статусы «активна», «достигнута», «приостановлена», «бюджет исчерпан». На Codex цель передаётся через `thread/goal/set`.
   - Где видели: [Codex app][cx].
   - Пример: в Codex app запросы на автопродолжение цели после сброса лимита набрали 92 голоса (#21073) и 83 голоса (#28931).

### Первый запуск, обновления и готовность Project-а

36. **Ready for Autopilot: проверка, готов ли репозиторий к работе агентов без человека.** Ценность высокая, объём M; Epic `worfy-worktree-setup`, черновика пока нет.
   - Что сделает worfy: Отчёт «Ready for Autopilot?» по Project-у: во временном worktree от свежего `main` запустить команды Profile — install, `prepare_tree`, быстрый и полный verify, gate fast — и записать exit code и время каждой. Отчёт виден после подключения Project-а, строкой в Settings → Health и предупреждением в окне Start Autopilot перед первым Run-ом.
   - Где видели: [Factory Droids][fd], [OpenAI Symphony][sym].
   - Пример: отчёт Factory оценил устаревший worktree на 47,76%, а после fast-forward — на 80,60%.
37. **Аудит пути новичка: агент ставит worfy по одной публичной документации в чистой учётной записи.** Ценность высокая, объём M; отдельная идея, без Epic-а.
   - Что сделает worfy: Агент ставит worfy по одной публичной документации в чистой учётной записи и записывает каждое место, где застрял. Повторяемый аудит пути новичка — рядом с Ticket 10 Epic-а `worfy-harness-standalone` (приёмка в новой учётной записи macOS).
   - Где видели: [Division Swarm][swarm].
   - Пример: в Division Swarm (issue #997) первому запуску мешали около 13 переменных окружения и exit code 127.

### Интеграции и Vendor-ы

38. **ACP-driver: третий Vendor и любой ACP-агент одним driver-ом.** Ценность высокая, объём L; Epic `worfy-acp-vendor`, черновика пока нет.
   - Что сделает worfy: ACP-driver: клиент JSON-RPC по stdio, перевод событий ACP в события и запросы разрешения worfy, MCP worfy через готовый HTTP endpoint. Третий Vendor и список ACP-агентов (Gemini CLI, Copilot CLI и другие, только со входом по подписке). Harness и Autopilot на таком Vendor-е недоступны с причиной, пока его hooks не дают тех же гарантий. Всё, что зависит от Vendor-а, идёт через один интерфейс (ADR-0094: Vendor seam).
   - Где видели: [OpenHands][oh], [Vibe Kanban][vk], [JetBrains Air][air], [Devin Desktop][dd].
   - Пример: в Vibe Kanban среди самых популярных запросов — Kiro (11 голосов) и любой ACP-клиент (8); около 32 заголовков issues только о поломках OpenCode.
39. **Ticket из GitHub issue: Inbox по метке и Run, который ждёт новую работу.** Ценность высокая, объём L; Epic `worfy-issue-intake`, черновика пока нет.
   - Что сделает worfy: Источник работы в Profile: репозиторий и метка или «assigned to me». Список Inbox рядом с видом Pull requests, команда New Ticket from issue и кнопка Make Ticket, которая запускает Session с `/worfy:to-tickets`. Run, который после конца очереди ждёт новые issue с меткой, — только после решения владельца (ADR-0100: очередь Epic-ов Run-а выбирает только человек).
   - Где видели: [Vibe Kanban][vk], [OpenAI Symphony][sym].
   - Пример: в OpenAI Symphony трекер как интерфейс хвалят: двигать карточки вместо prompt.
40. **Свой аккаунт Claude на Project.** Ценность высокая, объём L; отдельная идея, без Epic-а.
   - Что сделает worfy: У Project-а свой аккаунт Claude, как у него уже есть свой аккаунт GitHub. Session-ы Project-а запускаются с отдельным `CLAUDE_CONFIG_DIR`: свой вход, transcripts и plugins. Полосы Limits и дневной бюджет — по аккаунту.
   - Где видели: [Claude Code desktop app][ccd].
   - Пример: issue Claude Code о нескольких аккаунтах (#18435) набрал 1 047 голосов.

### Планирование: spec и Ticket-ы

41. **Epic lint: скрипт проверяет Ticket-ы при создании, перед Wave и при done.** Ценность высокая, объём M; Epic [worfy-plan-lint][s-plan-lint].
   - Что сделает worfy: Скрипт Harness без модели `epic-lint <epic>`: у каждой находки стабильный id, файл, раздел и способ исправить. Проверки: нет раздела Done when или в нём нет пунктов; у пункта не назван вид проверки; `Repo:` называет чужой репозиторий; маркеры TBD; неразобранный `Blocked by:`. Запуск после записи Ticket-ов, перед Wave (exit 1 — Ticket не раздаётся) и при done.
   - Где видели: [OpenAI Symphony][sym], [Division Swarm][swarm], [Claude Code agent teams][cat].
   - Пример: в OpenAI Symphony спрашивают, что будет с размытой задачей и с задачей, где нужно решение человека.
42. **Разбор черновика spec на неоднозначности и пробелы до приёмки и проверка покрытия spec Ticket-ами.** Ценность высокая, объём M; Epic [worfy-plan-lint][s-plan-lint].
   - Что сделает worfy: Шаг перед critic-ом, который не блокирует приёмку: три независимых subagent-а переводят каждый пункт Done when в Given/When/Then с конкретными входами, код сравнивает их ожидания и пишет список неоднозначностей с вопросом и рекомендуемым ответом. Отдельно — проверка, что каждый пункт spec покрыт хотя бы одним Ticket-ом. Critic отмечает, что эта часть возвращает идею, отклонённую 2026-11-07.
   - Где видели: [Kiro][kiro], [Gas Town][gt].
   - Пример: пользователи Kiro называют процесс spec главной причиной брать Kiro.
43. **Ticket из GitHub issue по ссылке, позже из Linear и Jira.** Ценность средняя, объём M; Epic `worfy-issue-intake`, черновика пока нет.
   - Что сделает worfy: Действие «New Ticket from issue» в Command palette и в меню рамки Epic-а. `/worfy:to-tickets` без опроса кладёт один Ticket в выбранный Epic со строкой `Source:` и картинками issue. `Fixes #N` в описании PR такого Ticket-а. Позже — группа Issues в PR inbox и импорт из Linear и Jira только в одну сторону, без синхронизации статусов (иначе спор с ADR-0002: worfy — вид над файлами workflow).
   - Где видели: [Orca][orca].
   - Пример: в Orca запрос своих источников задач (#8376) набрал 29 голосов.

### Кандидаты без проверки

84 идеи средней ценности. Их не сверяли с кодом и планами worfy, чтобы сберечь лимит подписки. Поэтому часть из них может уже быть в worfy, а часть может противоречить решениям владельца. «Что сделает worfy» — первые фразы описания из исследования, иногда сокращённые.

#### Надёжность и расход Limits (11)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Собственные вызовы модели worfy: отдельный счётчик и общий предел | Каждый вызов модели самого worfy пишет токены в счётчик «worfy overhead»: Live summary на Haiku, Terminal AI, черновик Profile, будущие названия. Tooltip Limits показывает долю счётчика в 5-часовом и 7-дневном окне. У каждого вида свой выключатель. Общий предел (например, 1% недели) отключает такие вызовы до сброса окна. | [Claude Code Agent View][cav] |
| Панель исходов: вмешательства человека на слитый Ticket | Панель в Runs за неделю и месяц собирается из journal, transcript-ов и Pipeline. Главные числа: «Touches per merged Ticket» и доля Ticket-ов, дошедших до merge без человека. Касание — это сообщение человека агенту во время run-а, ответ на park, Rework после human review, Stop или Force stop, ручной merge, owner check. | [Vibe Kanban][vk], [Warp][warp] |
| Флаг «заказана одна модель, работала другая» | Node и Run history сравнивают заказанную модель и effort роли с моделью в ответах transcript-а. Заказ берётся из слов владельца, skill-а, Profile или Eco mode; источник уже есть в отчёте. При расхождении появляется чип «asked Opus · ran Sonnet» с причиной (fallback, Eco, allowlist) и строка в Run history. | [Claude Code agent teams][cat] |
| Самоотчёт implementer-а о состоянии и классы зависания | Скрипт `ticket heartbeat <n> --state working\|stuck --note`: implementer вызывает его на шагах `ship-ticket` и когда застрял. Autopilot различает классы, у каждого своё действие: сам сообщил stuck (реакция сразу), Ticket done, а агент работает, claim без агента, грязный worktree без агента, сбой входа на старте. | [Gas Town][gt] |
| Повтор Ticket-а наследует прошлую попытку | После неудачи (падение, Force stop, REJECTED, красный Gate) brief нового implementer-а получает блок «Прошлая попытка». В нём ветка и последний commit, причина (`REJECTED: …` или failure record Gate-а с командой повтора) и изменённые файлы. Перед recovery Harness делает WIP commit грязной работы; при merge он уходит в squash. | [Gas Town][gt] |
| Сон простаивающих Session-ов и опись процессов агентов | Session в idle дольше N минут без фоновых задач, permission и run-а закрывает процесс, Node показывает «asleep». Следующее сообщение поднимает её через resume, очередь не теряется. Orchestrator в run-е и закреплённые Session-ы не засыпают. | [Factory Droids][fd], [Claude Code Agent View][cav], [Codex app][cx], [GitHub Copilot app][gca] |
| Soak test многочасового run-а: память и рост data folder | Nightly CI job на fake agent имитирует 12-часовой run с Session-ами, Subagent-ами, Browser и Card. Проверки: heap main и renderer выходят на плато; число процессов возвращается к исходному без осиротевших; каждое хранилище data folder (journals, Gate logs, screenshots, trash) держится в своём retention. | [Devin Desktop][dd] |
| Известные сбои Codex app-server — в записи и contract test-ы | Добавить в `codex-capture.mjs` и fake app-server случаи с contract test-ами: prompt на кириллице и CJK; отказ модели на каждом ходе даёт `turn-error`, а не 5 повторов; незнакомая форма лимитов даёт unknown, а не «свободно»; отказ политики на `thread/start`; живой app-server после Interrupt; MCP elicitation в unattended run-е. | [OpenAI Symphony][sym] |
| Каждая причина остановки — «можно повторить» и одно действие | У каждой из 21 причины остановки Autopilot и у «not verified» Gate-а — три поля: можно ли повторить, кто действует, одно действие. Примеры: «Sign in» открывает `claude /login`; «Open Ticket NN»; Retry now; «Approve hooks». Toast остановки показывает это действие. | [Division Swarm][swarm] |
| Данные для выбора модели и Vendor-а на роль | Replay-eval: реальные входы ролей с проверяемым итогом из Run history (вердикт verifier-а, находки reviewer-а) запускаются заново на Sonnet, на меньшем effort или на Codex. Мера — согласие с эталоном и token-ы. Track record: journal пишет модель, effort, Vendor и исход каждого агента (rework, REJECTED, red CI). | [Gas Town][gt] |
| Снимок worktree перед каждым ходом: diff и откат хода | Перед каждым ходом worfy пишет снимок через временный индекс в hidden ref `refs/worfy/turns/<session>/<n>`; индекс и ветки пользователя не меняются. Снимок даёт diff «Last turn» и «Undo turn» с подтверждением; если человек правил файлы после хода, откат отказывает. Правки через Bash тоже попадают. | [JetBrains Air][air] |

#### Review и качество (12)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Замер пользы review: исход каждой находки, пропущенные дефекты, цена lens | После merge скрипт Harness даёт каждой находке review исход: исправлена (поздний commit тронул эти строки, verifier подтвердил), отклонена с доказательством, проигнорирована или отозвана. | [OpenHands][oh], [Cursor][cur], [OpenAI Symphony][sym] |
| Ожидаемый результат записывается до действия в acceptance check-ах | Протокол для acceptance checks в Browser и e2e-сценариев для Evidence. Перед каждым шагом implementer пишет строку `expect:` с наблюдаемым признаком, после шага — `saw:` с выдержкой accessibility tree или id screenshot-а и verdict шага. Claim без заранее записанного ожидания идёт в not_verified. | [Devin][dv], [Devin Desktop][dd] |
| Stop hook по Done when: агент не заканчивает ход, пока пункты не доказаны | Расширить Stop hook Harness (`stop.mjs`), который сейчас держит ход только при красном Gate. Когда Session привязана к Ticket-у (Binding), ход держится, пока у какого-то пункта Done when без пометки manual нет pass Evidence line доказывающего вида. | [Google Antigravity][ag] |
| Решение Land или Rework с нуля над пакетом доказательств | Для Ticket-а на Stage Human review — один экран (плитка focus mode или панель PR inbox): пункты Done when с evidence, CI, вердикты reviewer-ов по lens («3/3 VERIFIED») и класс риска low, medium или high из фактов — размер diff, файлы из чувствительных путей Profile (auth, migrations, CI), новые зависимости, изменение числа test-ов, наличие migration. | [OpenAI Symphony][sym] |
| Ablation каждого слоя и skill-а Harness на каждой новой модели | Сравнительный eval получает рукава, в каждом из которых выключен один слой: verifier после implementer-а, scout, несколько lens-ов против одного reviewer-а, fresh context per Wave, Eco mode; отдельно — каждый skill Harness, включая 20 замороженных копий skills Matt Pocock. | [Claude Code agent teams][cat], [Claude Code plugins][ccp] |
| Аудит по пачкам файлов: покрытие каждого файла и повторный скан только изменённого | В `continuous-audit` появляется фаза shard: скрипт без модели делит пути каждой lens на пачки по размеру (по папкам или по графу импортов из code map), на пачку — один read-only scout. В spec.md аудита ведётся ledger покрытия «lens × файл × commit», так видно, что scout не прочёл. | [Devin][dv] |
| Пары screenshot-ов до и после в Evidence: рядом, swipe и onion skin | Helper screenshot-ов Evidence (снимки test build через Playwright в обеих темах) снимает тот же сценарий и до изменения: на базовом commit-е или берёт последний принятый снимок с тем же именем сценария. | [Orca][orca] |
| Бюджет роста кода: PR удаляет больше, чем добавляет, или называет инвариант | Gate или reviewer считают в PR добавленные и удалённые строки production-кода (без test-ов, docs и generated). PR, который добавляет больше N строк без удалений и без строки `Invariant:` в описании, получает finding для lens simplification. Run history и Work track показывают чистый рост кода по Epic-у. | [Division Swarm][swarm] |
| Конкурирующие гипотезы параллельно для red Gate и трудных ошибок | Действие Diagnose у failure record или red Gate. Orchestrator запускает три read-only агента, каждый с одной гипотезой из Phase 3 skill-а `diagnosing-bugs` и общей командой, которая воспроизводит red; если опровержению нужен запуск, у каждого свой worktree, как у sceptic-агентов. Каждый пишет prediction и результат. | [Claude Code agent teams][cat] |
| Повторные проверки после deploy через 20 минут, час, день и три дня | Когда в Profile есть deploy, к production check добавляется расписание повторов: та же проверка (health endpoint, запрос ошибок через CLI сервиса) через 20 минут, 1 час, 1 день и 3 дня после deploy. Проверки выполняет приложение, пока Machine включена; пропущенная идёт при следующем старте. | [Cursor][cur] |
| Ранний поиск конфликтов через `git merge-tree` во время Wave | Hook Harness после вызова инструмента, не чаще раза в 3 минуты на worktree: `git fetch` и `git merge-tree --write-tree --name-only` против `origin/main` и попарно против веток других claimed Ticket-ов той же Wave. Конфликт приходит implementer-у сообщением hook-а: сделать rebase сейчас, до review. | [Cursor][cur] |
| Property-based tests из пунктов-инвариантов Done when и разбор контрпримера | Когда пункт Done when формулирует инвариант (round-trip, идемпотентность, порядок, «Node-ы не пересекаются», «путь вне root отклоняется»), implementer пишет property test библиотекой Project-а (fast-check, Hypothesis — поле Profile) с фиксированным seed и числом случаев. | [Kiro][kiro] |

#### Рабочее место и интерфейс (8)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Fork from here и Rewind с выбранного сообщения, с откатом файлов или без | В transcript-е Session на сообщениях три действия. «Fork from here» — новая Session Node рядом с исходной, со стрелкой к ней и тем же Binding; она продолжает разговор до этого сообщения, оригинал не меняется. Пример: Orchestrator ушёл не туда на 40-м ходу — продолжить с 39-го с поправкой. | [OpenHands][oh], [Vibe Kanban][vk], [Division Swarm][swarm], [Copilot cloud agent][gcc], [Devin Desktop][dd] |
| Ask aside: вопрос к занятой или законченной Session в её read-only копии | Действие «Ask aside» на Session Node и в Session view, а также /btw в поле ввода. worfy делает fork разговора во временную дочернюю Session: у Claude Code — resume с forkSession в Agent SDK, у Codex — thread/fork, если app-server его умеет; иначе действие неактивно с причиной. | [Devin][dv], [Orca][orca], [Claude Code desktop app][ccd], [Cursor][cur] |
| Сообщение занятой Session: Steer в текущий ход или Queue с правкой | У поля ввода busy Session два способа отправки. Return — Queue, как сейчас: сообщение ждёт конца хода, но теперь его можно править и переставлять, а не только удалить. ⌘Return — Steer: сообщение уходит в идущий ход на ближайшей границе вызова инструмента и показывается в transcript там, где агент его взял. | [Codex app][cx], [Devin Desktop][dd] |
| Однострочный статус Session и пересказ «Since you looked» | Одна строка статуса у каждой Session — на Node, в разделе Sessions и в списке Needs you. Во время хода — последний вызов инструмента одной строкой («Bash: pnpm test · 2 min», «Edit src/main/x.ts»), обновление не чаще раза в 15 секунд. | [Claude Code Agent View][cav] |
| «Send to Session…» из Terminal, Browser и записи о падении test-а | Действие «Send to Session…» (пункт меню и shortcut) отправляет выбранной Session или Orchestrator-у кусок контекста: выделение в Terminal Node с cwd, командой и exit code; запись console или network в Browser Node; screenshot viewport-а; запись о падении test-а из Gate с файлом, строкой и командой перезапуска. На Canvas то же делается перетаскиванием Node на Session Node. | [JetBrains Air][air] |
| Функции Card для агента: tools.json и card_call через Canvas MCP | В папке Card лежит tools.json: имена, описания и JSON Schema функций, которые Card открывает агенту. Canvas MCP получает два инструмента, `card_tools` и `card_call`. worfy передаёт вызов в iframe Card через существующий bridge, Card меняет своё состояние и возвращает JSON. | [GitHub Copilot app][gca] |
| Состояние «ждёт фоновую работу» вместо ложного «закончил» | Седьмое состояние Session — waiting: ход закончен, но идут N фоновых задач или назначено пробуждение; tooltip «3 background tasks · next wake 14:20». Уведомление «Finished its turn» не приходит, пока фоновая работа идёт; одно уведомление приходит, когда закончилась последняя задача. | [Warp][warp] |
| Стабильность интерфейса как правило релиза Stable copy | Три правила для Stable copy. Performance budget в e2e test-ах с порогами и красным CI: старт приложения, новая Session Node, Canvas со 100 Node-ами, память с 10 Session-ами. Снимок registry shortcut-ов и видимых действий главных видов в contract test: изменение проходит только с меткой в PR, а What's new показывает такие изменения отдельным блоком. Третье правило — о выключенных функциях (Terminal AI, Live summary): от них не должно оставаться следов. | [Warp][warp] |

#### Безопасность (11)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Режим Assisted в ручной Session: политика Auto-approval отвечает и вне Autopilot | Сегодня ручная Session по умолчанию работает в Bypass permissions, а политика Auto-approval отвечает только в Autopilot run. Между «спрашивать обо всём» и Bypass есть только Accept edits. Предложение: новый пункт в picker-е прав ручной Session — «Assisted (worfy policy)». | [Vibe Kanban][vk], [GitHub Copilot app][gca], [Copilot cloud agent][gcc] |
| Чужой текст с GitHub — данные, а не задание агенту | Один helper в Harness, через который проходит любой чужой текст перед prompt-ом агента: review threads, тела PR и issues, логи CI, текст событий, позже страницы Browser. Helper вырезает zero-width, bidi-управляющие и tag-символы Unicode и HTML-комментарии и пишет в transcript, сколько вырезано. | [Devin][dv], [Claude Code cloud sessions][ccc], [Copilot cloud agent][gcc] |
| Auto-approval: предел серии отказов и сверка политики с ответами человека | В режиме Auto-approval On worfy считает отказы политики на Session, Subagent и Ticket. После K отказов подряд (по умолчанию 3) или M всего (по умолчанию 20) Subagent получает фиксированный ответ: остановиться и отметить Ticket blocked через скрипт `ticket`; владелец получает уведомление. Вторая часть — сверять правила политики с тем, как человек отвечает на park. | [Claude Code Agent View][cav], [Claude Code desktop app][ccd] |
| Секреты Project-а в Keychain: мимо чата и, где можно, мимо агента | Ответ на открытый вопрос о секретах для внешних MCP server-ов, путь B: секрет в Keychain с флагом «Available to Autopilot». Canvas MCP tool `request_secret(name, purpose)` показывает в Session карточку с полем-маской и «Save to Keychain» (на Windows — Credential Manager). Значение хранится под Project-ом и в разговор не попадает. | [OpenHands][oh], [Claude Code cloud sessions][ccc] |
| Свои правила Project-а с примерами, режимом warn и Check a command | У Project-а появляется список своих правил: `{tool: Bash \| Edit \| Write \| apply_patch, match: слова команды или glob пути, where: worktree \| основной checkout \| любое место, action, message}`. Действия deny и warn проверяет `hooks/guard.mjs` в любом режиме; allow и park дополняют политику Auto-approval. | [Factory Droids][fd], [Claude Code plugins][ccp] |
| GitHub-операции агента через worfy: без GH_TOKEN в окружении, в области Project-а | Убрать `GH_TOKEN` из окружения команд агента. Сегодня его кладёт туда hook SessionStart `gh-token-env.mjs` перед каждой Bash-командой Session и её Subagent-ов, а у Codex — окружение процесса. | [OpenAI Symphony][sym] |
| Bash guard против чужих процессов: без kill по имени, тяжёлые сборки по slot-ам | В Bash guard Harness-а (`hooks/guard.mjs`, PreToolUse) — новые правила. Отказ для `pkill`, `killall`, `taskkill /IM`, `kill` по шаблону имени и `lsof -ti :<port> \| xargs kill`. `kill <pid>` разрешён, только если pid лежит в дереве процессов самой Session (проверка по цепочке ppid). | [Vibe Kanban][vk] |
| Проверка опасных шаблонов кода при каждой правке, без модели | В Project-ах с включённой темой безопасности Harness проверяет добавленные строки каждой правки (Edit, Write, apply_patch) по списку шаблонов: `eval(`, `new Function(`, `innerHTML =`, `dangerouslySetInnerHTML`, `exec` с подстановкой строки, `shell: true`, `verify=False`, `rejectUnauthorized: false`, SQL из склейки строк. | [Claude Code plugins][ccp] |
| Шаг Gate: новые зависимости и secrets во всём diff | Шаг Gate `deps-and-secrets`, включённый в Profile по умолчанию. Для изменённых manifests и lock-файлов он перечисляет новые пакеты, их возраст, известные уязвимости (`npm audit`, `pip-audit` или `osv-scanner`, если они есть на Machine) и похожесть имени на популярный пакет. Вторая часть — secret scan всех добавленных строк diff-а по тем же правилам, что `evidence-check`. | [Copilot cloud agent][gcc] |
| Инструкция — не доступ: у каждого запрета агенту есть точка принуждения | Таблица в docs/features: каждое правило вида «агент X никогда не делает Y» → точка принуждения. Варианты: PreToolUse hook (Bash guard по типу агента или роли worktree), список tools агента, required check или branch protection, политика Auto-approval — или пометка «только prompt» с причиной. | [Warp][warp] |
| Автономия merge по классам изменений, заработанная историей | Profile задаёт классы изменений по путям и меткам Ticket-а: только документы, только test-ы, обновление зависимостей, UI, миграции, hooks Harness. У класса есть уровень: «merge без присмотра», «merge после agent review» или «ждёт Human review». | [OpenHands][oh] |

#### Память и контекст (9)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Сводка изменений git за время простоя при возобновлении Session | Stop hook Harness-а в конце каждого хода записывает состояние папки Session — ветку, HEAD SHA и список изменённых файлов — в маленький файл по session id. При возобновлении Session агент получает короткую сводку: какие commit-ы и файлы изменились, пока Session простаивала. | [OpenHands][oh] |
| Lessons и правила папки — в контекст при первом касании её файлов | Lesson и правило Project-а получают необязательную строку `paths:` с glob-ами. Новый PostToolUse hook Harness-а на Read, Edit, Write и apply_patch проверяет путь и при первом касании файлов папки подаёт агенту lessons и правила с подходящим `paths:`. Сейчас PostToolUse в `harness/hooks/hooks.json` нет. | [OpenHands][oh] |
| Log неудачных вызовов скриптов Harness-а и канал «сообщить о дефекте Harness-а, а не чинить» | Новый PostToolUse hook Harness-а на Bash видит вызов скрипта Harness-а (`ticket`, `profile`, gate, `epic-status`, `wave-brief` и других), который кончился ошибкой использования: неизвестная подкоманда, флаг или аргумент. Такие вызовы пишутся в log, а агент сообщает о дефекте Harness-а, а не чинит его скрипты сам. | [Gas Town][gt] |
| Workpad в Ticket-е: актуальный план, заметки и раздел Unclear | В Ticket-е — один раздел `## Workpad` (имя из Profile), который implementer держит актуальным через скрипт Harness-а: Machine и worktree с commit-ом, чек-лист плана, заметки со временем и раздел Unclear — что в Ticket-е или spec было неясно и какое допущение агент принял. | [OpenAI Symphony][sym] |
| Lessons с источником, датой подтверждения, сверкой с кодом и чисткой через PR | Сейчас у lesson-а в `docs/lessons/` уже есть строка `Источник:` (Ticket, Wave или PR) и обязательная `Проверка:` — test или eval-кейс, который краснеет при нарушении lesson-а. Не хватает даты последнего подтверждения, регулярной сверки lesson-а с кодом и удаления устаревших lessons через PR. | [GitHub Copilot app][gca], [Copilot cloud agent][gcc], [Devin Desktop][dd] |
| Вопрос к прошлой Session через fork, без её изменения | Действие Ask this Session на Node и в Session history: worfy делает fork выбранной Session Claude Code (опция `forkSession` Agent SDK) в боковой панели, в режиме Plan only, и задаёт вопрос. Оригинал не меняется; fork после ответа уходит в history как дочерний. | [Gas Town][gt] |
| Ablation runs eval-а: убирать правила Harness-а, без которых исход не хуже, при каждой смене модели | Когда сравнительный eval worfy против Claude Code без plugin-а разблокируют (сейчас его держит Ticket 52 Epic-а `worfy-harness`), добавить ablation runs: те же задачи с выключенным блоком правил, которые приходят в каждую Session и Subagent, или с выключенным шагом skill-а. Блок, без которого исходы не хуже, удаляется PR-ом. | [Claude Code cloud sessions][ccc] |
| Цена стартового контекста Session по источникам, с частотой использования и кнопкой «убрать» | В настройках Project-а, рядом с полем `skills.allowed` (список plugin-ов и skills пользователя для Session-ов Project-а), — таблица стартового контекста. Строки: встроенное Claude Code; Harness (список skills, rules от hooks, agents); каждый plugin и skill пользователя; описания tools каждого MCP сервера; файлы `CLAUDE.md`. | [Claude Code plugins][ccp] |
| Code intelligence для агентов: language server через MCP и семантический поиск по коду | Harness подключает агентам code intelligence по языкам из Profile: language server через MCP — definitions, references, diagnostics, rename. В Claude Code, возможно, хватит LSP через plugins (проверить); в Codex — через его MCP config. Scout и implementer получают в skill правило: сначала искать по символам, потом grep. | [JetBrains Air][air] |

#### Окружения и worktree (7)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Экран Worktrees и безопасная уборка деревьев | Экран «Worktrees» в Settings → Storage или в Health показывает деревья всех Project-ов. Для каждого linked worktree: ветка, Ticket и его Stage, Session по Binding, держатель worktree-lock и живой процесс с cwd внутри. | [Vibe Kanban][vk], [Claude Code Agent View][cav], [GitHub Copilot app][gca], [JetBrains Air][air] |
| Guard: Session в worktree не пишет в main checkout и чужие деревья | Guard действует для Session или Subagent-а, чья рабочая папка — linked worktree Ticket-а. Он отказывает в записи за пределы этого worktree и разрешённых временных папок, например `.scratch` и temp run-а. Edit, Write и NotebookEdit проверяет PreToolUse hook по пути файла. | [Claude Code desktop app][ccd], [Claude Code plugins][ccp] |
| OS sandbox и allowlist сети для Session-ов Autopilot | Session-ы Autopilot стартуют в sandbox ОС, который даёт сам Vendor. Для Claude Code это опция `sandbox` в Agent SDK (`enabled`, `failIfUnavailable`), на macOS — Seatbelt; работу на Windows надо проверить. Близко к идее 25 («OS sandbox Vendor-а для агентов в Autopilot run»). | [Division Swarm][swarm], [Copilot cloud agent][gcc], [JetBrains Air][air], [Devin Desktop][dd] |
| Project внутри WSL distro или devcontainer | Папка Project-а может лежать в дистрибутиве WSL. Тогда worfy на Windows запускает Session-ы этого Project-а внутри дистрибутива: `wsl.exe -d <distro> --cd <path>` и Linux-сборка Claude Code или Codex. Harness ставится в `~/.claude` внутри дистрибутива, Gate и hooks выполняются там же. | [Google Antigravity][ag], [JetBrains Air][air], [Kiro][kiro] |
| Session на удалённом хосте по SSH без worfy на сервере | Новое место запуска — папка на удалённом хосте по SSH, без worfy на сервере. Linked machine, напротив, требует worfy на обеих машинах. Вид Project-а «удалённая папка» — это host из `~/.ssh/config` и путь. | [Claude Code desktop app][ccd], [Codex app][cx] |
| Send to cloud: Ticket в cloud session Claude Code и возврат ветки | На Ticket-е появляется действие «Send to cloud». worfy запускает `claude --cloud` с текстом Ticket-а и коротким brief. На Canvas появляется Node cloud Session со ссылкой и статусом. Follow-up идёт через `claude -p <сообщение> --cloud <id>` с `--output-format json`. Когда появляется ветка или PR, worfy привязывает их к Ticket-у. | [Claude Code cloud sessions][ccc] |
| Pick в Browser Node: элемент страницы и его место в коде уходят в Session | В toolbar Browser Node появляется кнопка «Pick». worfy уже держит Chrome DevTools Protocol к странице, поэтому скрипт в неё внедрять не надо. Человек выбирает элемент, и Session получает его описание и место в коде. Близко к идее 22 («Pick element и Annotate в Browser Node: человек указывает агенту на элемент страницы»). | [Vibe Kanban][vk] |

#### Раздача работы, Run-ы и события (11)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Stacked Tickets: старт на ветке проверенного, но ещё не влитого блокера | Новое правило расчёта готовой Wave. Ticket помечается «ready on stack», если каждый его неслитый блокер уже имеет PR с зелёным Gate и вердиктом VERIFIED и ждёт только CI, review или merge. Implementer создаёт worktree от ветки блокера. PR открывается с base = ветка блокера, и review видит diff только своего слоя. | [Devin][dv], [Orca][orca], [GitHub Copilot app][gca], [Devin Desktop][dd] |
| Claim Ticket-а с держателем, lease и ID попытки; WIP commit перед остановкой | `ticket claim` пишет держателя (Session и Machine), ID попытки и lease. Brief передаёт ID попытки implementer-у. `ticket done`, `ticket block`, `ticket evidence` и отчёт implementer-а обязаны его называть. Вызов с чужим ID отклоняется с exit 1 и именем живой попытки. Так старая копия агента не закроет чужую попытку. | [Orca][orca], [Claude Code cloud sessions][ccc] |
| Остановить один Ticket или Subagent посреди run-а, не трогая остальные | Сейчас Stop и Force stop действуют на весь run. Идея — три действия на уровне одного Ticket-а или Subagent-а. Первое — Hold на карточке Ticket-а: worfy держит список удержанных Ticket-ов как состояние run-а, так же как очередь Epic-ов. | [OpenAI Symphony][sym], [Devin Desktop][dd] |
| Pause all: заморозить агентов и продолжить ту же Wave | Действие Pause all в Command palette и в меню Autopilot — для всей Machine или одного Project-а. Autopilot прекращает новые раздачи. Живые Session-ы и фоновые implementer-ы замораживаются: на macOS сигналами SIGSTOP и SIGCONT процессам агента, на Windows приостановкой процесса. | [Gas Town][gt] |
| Лимит Ticket-ов на Stage и потолок очереди на review человека | В редакторе Pipeline у Stage появляется необязательный лимит Ticket-ов. Autopilot проверяет лимиты между Wave-ами, как Run modes (ADR-0093: режимы run-а действуют только между Wave-ами). Wave, которая переполнит Stage, ждёт. Главный случай — Human review. Когда K PR ждут review человека, run не начинает новую Wave. | [OpenAI Symphony][sym] |
| Второе мнение перед blocked по суждению implementer-а | Бывает, что implementer докладывает: Ticket сделать нельзя. Если причина — его собственное суждение, а не внешний факт (нужен sign-in, вопрос владельцу, красный main), Wave не ставит `ticket block` сразу: сначала второй агент даёт своё мнение. | [Claude Code agent teams][cat] |
| Строка «сколько осталось» в контексте агентов во время Run | Hook UserPromptSubmit уже даёт Orchestrator-у Stage lines (`harness/hooks/stage-lines.mjs`). Он добавляет одну строку из состояния Run-а: минуты до конца Start window, остаток сегодняшней доли budget-а Limits, время текущей Wave против её p90. Implementer получает похожую строку на старте. | [Claude Code agent teams][cat] |
| Fork Session в свой worktree | Пункт Fork в меню Session Node и в selection toolbar. Он создаёт новый Node рядом с оригиналом: тот же Vendor, модель, effort и режим разрешений, необязательное первое сообщение. Оригинал продолжает работать. Своя ветка и worktree — от ветки оригинала или от base, на выбор. | [Claude Code Agent View][cav] |
| Запуск задачи одной строкой с адресацией по PR и Ticket-у | В Command palette — строка `Task: <текст>`, и такое же поле над списком Sessions. Она создаёт новую Session в открытом Project-е. Название даёт Haiku, worktree создаётся при первой правке, модель, effort и режим берутся из значений по умолчанию в Project settings. | [Claude Code Agent View][cav] |
| Rewind на сообщении и новый implementer с переписанным brief вместо третьей поправки | Два места. В ручной Session на каждом сообщении пользователя — действие «Rewind to here»: файлы worktree возвращаются к снимку до этого сообщения, разговор продолжается как fork с этой точки. В Wave — правило skill-а `epic-wave`: вместо третьей поправки implementer-у запускается новый implementer с переписанным brief. | [Cursor][cur] |
| Решения без владельца: уверенность, обратимость, вид Decisions | Каждое «decided without the owner» в Wave записывается структурно. Поля: вопрос, варианты, выбранный вариант, обоснование, уверенность (high, medium, low) и обратимость. Обратимость — правится ли решение следующим commit-ом или нет (миграция данных, публичный API, удаление). | [Copilot cloud agent][gcc] |

#### Первый запуск, обновления и готовность Project-а (7)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Обновление не меняет видимое и выбранное молча | Правило процесса из пяти частей. Первая — метка в PR: PR, который убирает или переносит видимый элемент, меняет значение по умолчанию или текст правил Harness, несёт строку `Behavior change:` или label `behavior-change` — что было, что стало, как вернуть старое. | [Claude Code desktop app][ccd], [Claude Code plugins][ccp], [Codex app][cx], [Cursor][cur] |
| Report a problem: отчёт из приложения со scrub, prefilled issue и правило ответа на каждый issue | Один пункт «Report a problem» (он же «Send feedback») в меню Help, в меню Session и в Command palette. Форма: категория (bug, idea, непонятно), настроение по желанию, текст. Отчёт проходит scrub личных данных и превращается в заполненный issue. | [OpenHands][oh], [GitHub Copilot app][gca], [JetBrains Air][air] |
| Канал обновления Releases: Stable copy берёт только теги v* | Settings → Update: канал «main» (как сейчас, для владельца) или «Releases» — Stable copy (установленная копия, которая сама собирается из репозитория) собирает только commit-ы с тегом `v*`. v0.4.0 поставлен 2026-11-11, следующие minor — раз в 1–2 недели, так что канал Releases обновляется редко и предсказуемо. | [Orca][orca] |
| Доля работы агентов вне самого worfy как метрика roadmap-а и условие объявления | Принцип: worfy доказывает себя на чужих Project-ах. Work track (экран учёта работы агентов) получает разбивку часов агентов и доли Limits (лимитов подписки) по Project-ам с отдельной строкой «сам worfy». Метрика локальная, на Machine пользователя; это не product analytics, которой в worfy нет намеренно. | [Gas Town][gt] |
| Установка готовой сборки одной командой из GitHub Releases с проверкой SHA-256 | GitHub Actions публичного репозитория на тег вида `v0.4.0` собирают артефакты macOS arm64 и x64 и Windows x64 и кладут их в GitHub Releases вместе с manifest SHA-256. Установка — одна команда, которая скачивает сборку и сверяет SHA-256. | [Vibe Kanban][vk] |
| Гарантии и значения по умолчанию в docs ссылаются на код и test; CI ловит расхождение | В docs/features каждая гарантия безопасности получает ссылку на код, который её обеспечивает, и на test, который её доказывает. Примеры: «агент не вводит пароли», «у агентов нет delete tool», «force push запрещён всегда», «Always allow не пишется в правила пользователя». | [Division Swarm][swarm] |
| Предложения функций по контексту работы с общими пределами частоты | Один механизм для всех предложений worfy вместо разрозненных. У предложения есть локальный триггер (файл в Project-е, команда в Session-и, событие вроде «первый PR смёржен»), цель и общие пределы: не чаще раза за Session; раз за всё время на одно предложение; после пяти пропущенных подряд все предложения выключаются. | [Claude Code plugins][ccp] |

#### Интеграции и Vendor-ы (6)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Исходящий webhook или скрипт: Run остановлен, нужен человек | Новый раздел Settings → Notifications → Outgoing hook. Человек вводит URL webhook-ов (ntfy, Slack incoming webhook) или путь к своему скрипту и выбирает события: Run остановился, Wave закончилась, Ticket ждёт владельца, Auto-approval оставила запрос в Park, очередь Gate ждёт другую Machine. | [Gas Town][gt], [JetBrains Air][air] |
| Стабильный JSON состояния Session-ов для программ вне worfy | `worfy status --json` или локальный HTTP endpoint с token-ом на процесс отдают состояние Session-ов программам вне worfy в стабильном формате. Такой канал уже есть для инструментов worfy в Codex. | [Claude Code Agent View][cav] |
| Reviewer на другом Vendor-е: Codex проверяет Wave на Claude Code | Роль в Profile получает Vendor-а, например lens correctness — на Codex. В Wave на Claude Code Orchestrator через инструмент worfy запускает read-only Session Codex с brief-ом reviewer-а на worktree PR-а. Verdict приходит в том же формате (VERIFIED или REJECTED и строки находок) и считается в merge condition как обычный review. Близко к идее 12 («Reviewer на другом Vendor-е: Codex проверяет код Claude Code и наоборот»). | [Claude Code agent teams][cat] |
| Секреты внешних MCP серверов хранит Claude Code, а не worfy | Путь B открытого вопроса о том, как дать агентам внешние MCP серверы, но без своего кода для Keychain: пользователь ставит сервер как plugin Claude Code с `userConfig` и `sensitive: true` или как пакет `.mcpb`, и секрет хранит Claude Code. | [Claude Code plugins][ccp] |
| Запасной режим Session на немодифицированном claude CLI | Держать проверенный запасной режим на случай, если путь Agent SDK по подписке закроют. В нём Session — немодифицированный `claude` CLI в Terminal Node, связанный с Ticket-ом через Binding. worfy читает его transcript так же, как сейчас читает Session-ы, начатые вне worfy. | [JetBrains Air][air] |
| Open in editor через Remote-SSH: Linked machine и worktree Ticket-а | Если Project живёт на Linked machine (Machine, связанная с этой по коду из 6 цифр), Open in editor строит ссылку Remote-SSH: `vscode://vscode-remote/ssh-remote+<user>@<host><path>` и такую же для Cursor. Host — адрес этой Machine или имя MagicDNS из link через Tailscale; пользователь SSH задаётся в настройках Machine. | [Vibe Kanban][vk] |

#### Планирование: spec и Ticket-ы (2)

| Идея | Что сделает worfy | Где видели |
|---|---|---|
| Пункт Done when заранее называет свою проверку: строка `check:` | Рядом со строкой `needs:`, которая задаёт только платформу и копию приложения, появляется строка `check:`. Её автор Ticket-а пишет заранее: команда, имя e2e test-а, `owner-check` или `video`. | [Warp][warp] |
| Bug Ticket в форме Now / Expected / Unchanged с test-ами сохранности, зелёными на base | `to-tickets` и `diagnosing-bugs` пишут bug Ticket в форме: Now — шаги воспроизведения и наблюдаемый результат; Expected; Unchanged — 2–5 соседних поведений, которые не должны поменяться. `ship-ticket` требует два вида test-ов: падающий test на Expected, как сейчас, и test-ы сохранности на Unchanged, зелёные на base. | [Kiro][kiro] |

## 5. Предложенные Epic-и

Из 43 оставленных идей собраны 17 кандидатов в Epic и 5 отдельных идей. Черновики spec написаны для 8 Epic-ов: это предел одного запуска. Черновик лежит в `.scratch/<epic>/spec.md` со статусом «черновик 2026-11-13 из исследования конкурентов, владельцем не принят».

Вердикты critic-а: **Keep** — план годится как есть; **Reorder** — Ticket-ы верные, а порядок или строки `Blocked by:` нет; **Split** — Ticket или весь Epic делает слишком много сразу; **Defer** — плану стоит подождать: нужного ещё нет или сначала есть что-то дешевле. Ни один черновик не получил Keep.

### Черновики

| Epic | Проблема | Ticket-ы | Вердикт critic-а | Spec и разбор |
|---|---|---|---|---|
| **worfy-pr-follow** — PR доводится до merge по событиям: Session просыпается на красный CI, конфликт или замечания; действия Fix checks, Resolve conflicts, Address comments. Идеи 11, 16, 34. | PR inbox показывает, что PR нужна правка (красный CI, конфликт или запрос изменений), но чинить приходится руками: открыть Session, пересказать, что упало, и снова следить за PR. Агент, который сам ждёт CI, тратит на опрос ходы модели и Limits. | 12 Ticket-ов, 9 открытых вопросов | **Split.** Три действия с PR и skill pr-fix не зависят от наблюдения за PR, но Ticket 05 ждёт всю цепочку наблюдения 01 → 02 → 03. Кнопки доходят до пользователя только в пятой Wave. | [spec][s-pr-follow], [разбор][r-pr-follow] |
| **worfy-stuck-agents** — Застрявший агент не останавливает Run: зацикливание, тишина хода и повторный провал замечаются, Ticket откладывается, очередь идёт дальше. Идеи 1, 7, 10, 33. | Ночной Run останавливается целиком из-за одного Ticket-а, который остался в работе или повторился в следующей Wave (пакете Ticket-ов, идущих параллельно). А агент, который раз за разом запускает ту же упавшую команду или молчит посреди хода, часами тратит Limits, и человек узнаёт об этом только утром. | 15 Ticket-ов, 5 открытых вопросов | **Split.** Повторы с пропуском Ticket-а и watchdog тишины опираются на сбои, которые уже случались, и должны выйти отдельно. Детектор зацикливания сверх простой записи вызовов и эскалация модели построены для случаев, которых в worfy не было: собственный разбор насчитал ноль, а Eco mode владелец держит выключенным. Обе части — в следующий шаг. | [spec][s-stuck-agents], [разбор][r-stuck-agents] |
| **worfy-acceptance** — Приёмка владельца в одном виде: Ticket-ы, ждущие его проверки, с Evidence и решением Pass или Fail по одному. Идея 17. | Ticket-ы, которые ждут проверки владельца, разбросаны по Epic-ам: в worfy не видно, что ждёт именно его, какие доказательства уже собраны и есть ли изменение в его Stable copy. Пошаговые гайды приёмок Orchestrator ведёт вручную отдельным markdown-файлом. | 11 Ticket-ов, 6 открытых вопросов | **Defer.** План месяца разрешает один новый Epic за раз, и это место отдано `worfy-harness-standalone`, который ещё не начат. Две дешёвые части стоит сделать сейчас без Epic-а: polish Ticket, чтобы метка `(manual)` читалась как ручная, и PR с документами, который записывает в Ticket-ы решение владельца от 2026-11-06 убрать из его очереди всё, что может сделать агент. | [spec][s-acceptance], [разбор][r-acceptance] |
| **worfy-plan-lint** — План Epic-а проверен до работы: `epic-lint` по Ticket-ам и разбор черновика spec-а на неоднозначности и покрытие. Идеи 41, 42. | Ошибки плана всплывают посреди Wave: у Ticket-а нет раздела Done when, и `ticket evidence` падает; строка `Repo:` называет чужой repository; `Blocked by:` не разобран; пункт spec-а не покрыт ни одним Ticket-ом. Двусмысленный пункт Done when implementer и reviewer читают по-разному, и это видно только по REJECTED (вердикт reviewer-а «не принято»). | 10 Ticket-ов, 3 открытых вопроса | **Split.** Первая часть опирается на дефекты, видные в репозитории. Вторая (Ticket-ы 06–08) возвращает идею, отклонённую 2026-11-07, раньше, чем выполнено условие roadmap. Ticket 04 несёт исправление в одну строку в `waves.ts`, которое Autopilot нужно уже сейчас: он раздаёт Ticket, который Harness отказывается брать, и останавливается с `no-progress`. Новый скрипт этому исправлению не нужен. | [spec][s-plan-lint], [разбор][r-plan-lint] |
| **worfy-continuity** — Работа переживает перезапуск worfy и compaction: Run и Session продолжаются с того же места. Идеи 8, 27. | Update Stable copy, падение или перезагрузка обрывают идущие Session-ы и Run: после старта worfy не знает, какие Ticket-ы были в работе, и их раздают заново вручную. После compaction агент теряет цель, пункты Done when и решения, принятые в начале разговора. | 15 Ticket-ов, 5 открытых вопросов | **Reorder.** Защита от повтора недоделанного `git push` или `gh pr merge` (Ticket 07) приходит на Wave позже автоматического продолжения, которое она защищает (Ticket-ы 05 и 06). А 05 и 06 не называют свою зависимость от spike 01. | [spec][s-continuity], [разбор][r-continuity] |
| **worfy-limits-ledger** — Куда ушли Limits: расход по Session, роли, Ticket-у и модели и потери prompt cache с их ценой. Идеи 2, 3. | Пользователь видит, что неделя Limits быстро кончается, но не видит, что её съело: какой Ticket, какая роль, первый проход или доработка после REJECTED (вердикт reviewer-а «не принято»). Не видно и того, сколько ушло на перечитывание разговора после потери prompt cache, поэтому решать, где включить Eco mode (роли Subagent-ов на моделях подешевле) или начать разговор заново, не на чем. | 14 Ticket-ов, 7 открытых вопросов | **Split.** Учёт token-ов стоит сам по себе, но перевод в долю недели опирается на данные journal Autopilot-а, которых мало, и они старые и грубые. Ticket 12 (новый Orchestrator после ожидания Limits) строит правило для случая, которого на этом Mac ещё не было. | [spec][s-limits-ledger], [разбор][r-limits-ledger] |
| **worfy-harness-guarantees** — Гарантии Harness нельзя обойти: агент не правит проверки, которые его судят, не сливает PR мимо условия merge, guard-ы держатся в любом режиме и на новой версии Claude Code. Идеи 9, 13, 18, 26. | Зелёный gate и вердикт review VERIFIED верны, только пока агент не может их подправить: сегодня implementer может изменить workflow CI, список quarantine или порог coverage в своём же PR, вызвать `gh pr merge --admin` мимо скрипта `land`, а в режиме `bypassPermissions` hard deny Auto-approval не действует. Новая версия Claude Code может молча сломать hooks Harness, и это видно только по странному поведению агентов. | 13 Ticket-ов, 7 открытых вопросов | **Reorder.** Ticket 04 заставляет `land` ждать commit status `owner`, который умеет писать только Ticket 10. Guard читает раздел `## Где в коде` на вершине `origin/main`, а `land` — на merge-base PR. Изменение matcher-а PreToolUse сталкивается с `worfy-stuck-agents`. | [spec][s-harness-guarantees], [разбор][r-harness-guarantees] |
| **worfy-changes-view** — Экран Changes: diff Ticket-а, Session и PR с комментариями к строкам, которые уходят агенту одной пачкой. Идеи 14, 20. | Чтобы увидеть, что агент поменял, пользователь уходит в GitHub или редактор: в worfy нет diff-а ни Ticket-а, ни Session, ни последнего хода. Замечание к строке приходится пересказывать агенту в чате словами. | 12 Ticket-ов, 5 открытых вопросов | **Split.** Ticket 03 держит весь экран и все входы в него. Ticket 04 строит «Since my last look» для PR раньше, чем Ticket 09 добавляет поддержку PR. Оба надо разрезать до того, как назначены Wave-ы. | [spec][s-changes-view], [разбор][r-changes-view] |

Critic-и нашли пересечения между черновиками:

- `worfy-plan-lint` и `worfy-stuck-agents` оба добавляют первый PostToolUse hook Harness-а. Без общего диспетчера на каждый Write и Edit будут стартовать два процесса Node.js.
- `worfy-harness-guarantees` и `worfy-stuck-agents` оба расширяют matcher PreToolUse в `hooks.json` и добавляют отказ в `guard.mjs`. Ни одна из двух spec не упоминает другую.
- `worfy-pr-follow` и `worfy-continuity` оба заставляют main-процесс писать сообщения в обычный Session Node, каждый со своим resume и своей строкой уведомления. `worfy-pr-follow` пишет для этого свой ADR.
- Critic-и `worfy-acceptance` и `worfy-changes-view` ссылаются на правило месяца: не больше одного нового Epic-а за раз. Это место занято Epic-ом `worfy-harness-standalone` («Harness полноценно без приложения», [черновик](../../product/roadmap-worfy/drafts/worfy-harness-standalone.md)), который ещё не начат. Правило записано в [разделе roadmap](../../product/roadmap-worfy/drafts/roadmap-section.md), который владелец принял 2026-11-09. Его пересматривают, когда придут отзывы пользователей, закроются почти законченные Epic-и или наступит 2026-12-08.

### Отложенные Epic-и

Эти 9 Epic-ов собраны из оставленных идей, но черновики для них сейчас не писали.

- **`worfy-limits-out`.** Когда Limits кончились: любая Session ждёт сброса на виду, Run по флажку уходит на Codex, платное — только явно. Идеи: 4 «Продолжить на другом Vendor-е, когда Limits исчерпаны»; 5 «Никогда не переходить на платное использование молча»; 6 «Auto-continue и состояние «waiting for Limits» у любой Session».
  - **Проблема.** Продолжение после сброса Limits есть только у Orchestrator-а: Session Ship ticket, ручная Session и Session на Codex встают молча, а набранное сообщение никуда не уходит. Тот, у кого есть и Codex, не может доработать на нём, а аккаунт с разрешённым extra usage, похоже, продолжает Run на платном без вопроса.
  - **Почему не сейчас.** Сначала worfy-limits-ledger: без фактического расхода по Vendor-у и роли переход на Codex и платное продолжение планируются без данных. Переход на другой Vendor на границе Wave опирается на `worfy-multi-vendor` (Session-ы на Codex), который ещё ждёт приёмки владельца. Исключение — первый шаг идеи 5 («Никогда не переходить на платное использование молча»): проверить, уходит ли Run в платное при полном окне, и по умолчанию ждать сброса. Это возможная трата денег без согласия, её стоит взять сейчас отдельным polish Ticket-ом, не дожидаясь Epic-а.
- **`worfy-review-findings`.** Находки review — записи со статусом: повторный круг смотрит только новый diff, новые lens-ы сначала идут в Shadow mode, одну lens ведёт другой Vendor. Идеи: 12 «Reviewer на другом Vendor-е: Codex проверяет код Claude Code и наоборот»; 15 «Находки review — записи со статусом; re-review только по новому diff»; 19 «Lens-ы test quality и wiring с написанными правилами и Shadow mode для новой lens».
  - **Проблема.** Находки reviewer-а и verifier-а существуют только как текст в отчёте: повторный круг перечитывает весь diff и снова поднимает уже закрытые находки. Код Claude Code проверяет тот же Claude Code, а ослабленный test или новый модуль, до которого не доходит ни один путь, review по правилам не ищет.
  - **Почему не сейчас.** Reviewer на Codex требует решения владельца о разных Vendor-ах для разных ролей, а `worfy-multi-vendor` (Session-ы на Codex) ещё ждёт приёмки: её держит баг зависания хода Codex. Выигрыш от записей находок и повторного круга по новому diff-у стоит сначала измерить: worfy-limits-ledger покажет, какую долю Limits съедают круги доработки. Вернуться после приёмки `worfy-multi-vendor` и первых цифр ledger-а.
- **`worfy-needs-you`.** Needs you: всё, что ждёт человека, в одном списке с ответом на месте, и пометка Unread у Session-ов. Идеи: 21 «Единый список «Needs you» по всем Project-ам с ответом на месте»; 23 «Unread у Session и переход к следующей непрочитанной».
  - **Проблема.** Запрос разрешения, вопрос агента, park Auto-approval (запрос, отложенный до ответа владельца на 60 минут) и PR, который ждёт пользователя, разбросаны по Session-ам, Project-ам и Linked machine-ам. Пропущенный park — до часа простоя Run-а, а какая Session закончила ход, пока человек смотрел другую, не видно.
  - **Почему не сейчас.** Ожидания уже видны поштучно: уведомления ОС, permission cards на Node, уведомления Parked, группы PR inbox. Сводный список нужнее, когда Project-ов и Linked machine-ов много, а в этом месяце пользователей трое. Самый большой источник ожиданий — приёмки владельца — закрывает worfy-acceptance, его стоит сделать первым. Unread (объём S) можно взять раньше отдельным polish Ticket-ом.
- **`worfy-triggers`.** Triggers: Session или Run по расписанию и по событию GitHub по правилу, которое написал человек. Идея: 32 «Triggers: Session по расписанию и событиям GitHub по правилам человека».
  - **Проблема.** Регулярную работу — ночной аудит, обновление зависимостей, починку красного main — человек каждый раз запускает руками. worfy уже видит события GitHub, но ничего по ним не начинает.
  - **Почему не сейчас.** Roadmap прямо исключает советника по расписанию и Epic-и, которые worfy ставит в очередь сам (ADR-0100: очередь Epic-ов Run-а задаёт только человек), — нужен ответ владельца, считается ли правило, написанное человеком, его выбором. Событийная часть строится на детекторе событий PR из worfy-pr-follow, его стоит сделать первым. Расписание на Mac упирается в сон машины: будить Mac можно только с правами администратора, и это уже вынесено за рамки в `worfy-retry` (Epic Auto-continue).
- **`worfy-worktree-setup`.** Новый worktree сразу готов к работе: setup и копия ignored-файлов из Profile, свой worktree у ручной Session, отчёт Ready for Autopilot. Идеи: 29 «Подготовка нового worktree из Profile: setup, копия ignored-файлов, деревья заранее»; 31 «Свой worktree для ручной Session и видно, где пишет каждая Session»; 36 «Ready for Autopilot: проверка, готов ли репозиторий к работе агентов без человека».
  - **Проблема.** В свежем worktree Ticket-а нет `.env.local`, локальных сертификатов и других git-ignored файлов, и первая команда агента падает не по его вине. Ручная Session пишет прямо в рабочую папку Project-а, а новый Project узнаёт, что его install или verify не проходят в чистом дереве, только на первом ночном Run-е.
  - **Почему не сейчас.** На самом worfy свежее дерево уже готовит `commands.prepare_tree` из Profile, а на других Project-ах владельцу «пока ничего не мешает» (решение 01 карты roadmap — для кого worfy в ближайший месяц). Больше всего это нужно новым Project-ам чужих людей — после `worfy-harness-standalone` и решения, объявлять ли его незнакомым людям. Когда начнётся E4 (этап «worfy для других людей»), первым стоит взять отчёт Ready for Autopilot.
- **`worfy-ticket-preview`.** UI Ticket-а виден в worfy: у каждого worktree свой dev server и порт, Browser Node открыт на нём, Pick element показывает агенту элемент. Идеи: 22 «Pick element и Annotate в Browser Node: человек указывает агенту на элемент страницы»; 30 «Dev server Ticket-а под управлением worfy: свой порт на worktree и Browser Node на URL».
  - **Проблема.** Чтобы посмотреть UI, который сделал агент, пользователь сам запускает dev server нужного worktree и следит, чтобы параллельные Ticket-ы не делили порт, Docker и тестовую базу. Указать агенту на кнопку можно только словами или screenshot-ом.
  - **Почему не сейчас.** Нужен Project с web UI, где несколько Ticket-ов идут сразу: у самого worfy один dev server — приложение Electron. `worfy-browser` (Browser Node на Canvas) ещё не закрыт: один Ticket заблокирован, Epic в списке почти законченных в roadmap. Порт и номер slot удобнее строить поверх setup worktree из worfy-worktree-setup.
- **`worfy-lessons-loop`.** Разбор трудных Run-ов: сигналы трудностей копятся, по кнопке Session готовит PR с lessons. Идея: 28 «Разбор неудачных и дорогих run-ов: сигналы копятся, по кнопке Session готовит PR с lessons».
  - **Проблема.** Где агенты спотыкаются, видно только по одному Run-у или после крупного сбоя. Повтор той же просьбы другими словами, решение, которое владелец потом отменил, Ticket, который падает в разных Run-ах, нигде не собираются, и lessons пишутся вручную.
  - **Почему не сейчас.** Главные сигналы ещё не пишутся: зацикливание, тишина хода и отложенный Ticket появятся в worfy-stuck-agents, дорогие Run-ы — в worfy-limits-ledger. Уроки из крупных сбоев уже пишутся (`worfy-reliability`, `worfy-faults`, `worfy-failures`). Вернуться после этих двух Epic-ов.
- **`worfy-issue-intake`.** Ticket из GitHub issue: по ссылке или из списка по метке, со строкой `Source:` и `Fixes #N` в PR. Идеи: 39 «Ticket из GitHub issue: Inbox по метке и Run, который ждёт новую работу»; 43 «Ticket из GitHub issue по ссылке, позже из Linear и Jira».
  - **Проблема.** Работа часто приходит issue на GitHub, а Ticket worfy пишется руками: человек переносит текст и картинки, а связь issue с PR теряется, и issue не закрывается при merge.
  - **Почему не сейчас.** Issue в worfy пока не приходят: от двух пользователей замечаний и идей не было, а свою работу владелец начинает со spec-а в Product Session. Run, который ждёт новые issue с меткой, упирается в ADR-0100 (Epic-и и их очередь выбирает только человек) и требует решения владельца. Вернуться, когда появятся внешние issue или командный Project начнёт приносить работу issue-ами.
- **`worfy-acp-vendor`.** ACP-driver: третий Vendor и любой агент на Agent Client Protocol одним driver-ом. Идея: 38 «ACP-driver: третий Vendor и любой ACP-агент одним driver-ом».
  - **Проблема.** Человек с подпиской на Gemini CLI, Copilot CLI или другой агентский CLI не может вести в worfy Session на нём: для каждого Vendor-а нужен свой driver.
  - **Почему не сейчас.** Нужно решение владельца о третьем Vendor-е, а ни владелец, ни пользователи его не просили. `worfy-multi-vendor` (Session-ы на Codex) ещё ждёт приёмки. На ACP-агенте нет hooks с гарантиями Harness, так что Autopilot и gate на нём недоступны: получится Session без процесса, а отличие worfy от рынка — именно процесс.

### Отдельные идеи

Идеи, которые не стали частью ни одного Epic-а.

- **24. Прямой канал к одному работающему Subagent-у: написать, прервать, остановить.** Позже: сначала spike — умеет ли Agent SDK доставить сообщение одному работающему Subagent-у и остановить только его (сообщение работающему агенту workflow в Claude Code сейчас запускает его вторую копию); кнопки Stop now и Stop after this step — polish Ticket, если spike найдёт остановку по агенту.
- **25. OS sandbox Vendor-а для агентов в Autopilot run.** Не делать сейчас: по правилу владельца 2026-11-07 защита от того, что агент и так может, описывается, а не строится. Вернуться, если unattended Run начнёт работать с чужим вводом (PR незнакомых людей в публичном репозитории, незнакомые страницы) или появятся внешние пользователи (E4, этап «worfy для других людей»).
- **35. Goal у любой Session и автопродолжение цели после сброса лимита.** Позже, без своего Epic-а: продолжение после Limits у любой Session входит в worfy-limits-out, а само поле Goal со статусами и бюджетом есть только в Codex app — вернуться, когда worfy начнёт ставить цели Codex через app-server (`thread/goal/set`).
- **37. Аудит пути новичка: агент ставит worfy по одной публичной документации в чистой учётной записи.** Разовую проверку провести сейчас, в плане limit burn 2026-11-13 (пункт «clean install from README»); повторяемый аудит — Ticket в `worfy-harness-standalone` рядом с его приёмкой в новой учётной записи macOS (Ticket 10), до объявления незнакомым людям.
- **40. Свой аккаунт Claude на Project.** Позже, отдельным Epic-ом и только по просьбе: нужен второй аккаунт Claude у владельца или пользователей, а пример есть в одном продукте (Claude Code desktop); образец — уже существующий свой аккаунт GitHub на Project.

[s-pr-follow]: ../../../.scratch/worfy-pr-follow/spec.md
[r-pr-follow]: ../../product/critic/worfy-pr-follow-2026-11-14.md
[s-stuck-agents]: ../../../.scratch/worfy-stuck-agents/spec.md
[r-stuck-agents]: ../../product/critic/worfy-stuck-agents-2026-11-14.md
[s-acceptance]: ../../../.scratch/worfy-acceptance/spec.md
[r-acceptance]: ../../product/critic/worfy-acceptance-2026-11-13.md
[s-plan-lint]: ../../../.scratch/worfy-plan-lint/spec.md
[r-plan-lint]: ../../product/critic/worfy-plan-lint-2026-11-14.md
[s-continuity]: ../../../.scratch/worfy-continuity/spec.md
[r-continuity]: ../../product/critic/worfy-continuity-2026-11-14.md
[s-limits-ledger]: ../../../.scratch/worfy-limits-ledger/spec.md
[r-limits-ledger]: ../../product/critic/worfy-limits-ledger-2026-11-14.md
[s-harness-guarantees]: ../../../.scratch/worfy-harness-guarantees/spec.md
[r-harness-guarantees]: ../../product/critic/worfy-harness-guarantees-2026-11-14.md
[s-changes-view]: ../../../.scratch/worfy-changes-view/spec.md
[r-changes-view]: ../../product/critic/worfy-changes-view-2026-11-14.md

## 6. Что не берём и почему

Из 61 проверенного кластера отклонены 18.

| Причина | Сколько |
|---|---|
| exists — уже есть в worfy | 0 |
| planned — уже в планах | 0 |
| conflicts — против решения владельца | 10 |
| not-worth — не стоит делать | 8 |

Ноль в exists и planned не значит, что всё найденное у конкурентов для worfy ново. Идеи, которые карта
возможностей показывала как сделанные или запланированные, отпали ещё на шаге извлечения. А когда
проверяющий сомневался между exists или planned и partial, он ставил partial и называл недостающую
часть: такие идеи остались в разделе 4.

Показательные примеры:

1. **Потолок расхода Limits на один Ticket внутри Wave** — conflicts. Жёсткий потолок отказывал бы в
   вызовах посреди работы и отправлял Ticket в `blocked`. Это против ADR-0093 (режим Run-а действует
   только на границе Wave) и ответов владельца на вопросы Q2 и Q11 в spec Epic-а
   `worfy-resource-planner`.
2. **Переживать сбои API: retry watchdog внутри хода и горизонт по времени** — conflicts. Идея меняет
   предел Auto-continue «5 повторов» на горизонт до 24 часов. Владелец 2026-11-04 в spec `worfy-retry`
   выбрал 5 попыток подряд с паузами 1, 5, 15, 30 и 60 минут, а вариант «без предела, общий предел 24
   часа» не выбрал.
3. **Судьба Subagent-а на лимите и после сна: продолжить, а не начать заново** — conflicts. По решению
   владельца 2026-10-28 (план `worfy-throughput`, решение 9) работу продолжает новый implementer с
   коротким brief, а `SendMessage` прежнему разрешён только в узком случае.
4. **Скользящая раздача Ticket-ов без барьера конца Wave** — conflicts. Идея убирает границу между
   Wave-ами. Решение владельца 13 от 2026-10-28: в конце Wave Orchestrator пишет Wave brief и
   останавливается.
5. **Модель-судья для запросов, которые политика отправляет в Park** — conflicts. По ответу на
   вопрос Q3, который владелец принял в spec `worfy-auto-approve`, в Park уходят запросы, которые может решить
   только человек: push, незнакомый tool, git при активных hooks. По той же причине ADR-0098 (Approval
   policy) отклонил вариант одобрять всё без park.
6. **Страница в tailnet: ответы с телефона на park и вопросы** — conflicts. «Управление с телефона»
   стоит в roadmap в списке «Сознательно вне E2–E4», то есть вне ближайших этапов. Владелец оставил
   этот пункт там 2026-11-09.
7. **Скрытые acceptance tests, которые implementer не видит** — not-worth. Единственный источник —
   исследование Factory о следующем поколении Missions. Функция в листе ожидания, отзывов
   пользователей нет, цифры дал сам вендор. По его же данным запуск со схемой стоил в 14 раз больше
   кредитов и шёл в 13 раз дольше.
8. **Сверка фактических tools и MCP server-ов Session-а с ожидаемыми** — not-worth. Это уже покрыто:
   список MCP server-ов из Profile уходит в Claude Code как policy tier, и сервер вне Profile в Session
   не попадает (ADR-0021: allowlist MCP серверов в Profile). Чип «MCP n/m» показывает состояние.
9. **Двусторонний канал между Orchestrator-ом и работающим implementer-ом** — not-worth. Посылка
   неверна: implementer уже сообщает всё, что выходит за его Ticket, в полях `out_of_scope` и
   `not_verified`, а Orchestrator отвечает ему через `SendMessage`.
10. **Цвет ясности и прогноз размера каждого Ticket-а до старта Autopilot** — not-worth.
    Доказательство — один пост вендора (Cognition). В worfy неясность снимается раньше: Autopilot
    берёт только Epic-и с принятой spec.
