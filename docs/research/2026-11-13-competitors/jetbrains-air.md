# JetBrains Air — досье конкурента

- **Дата:** 2026-11-13. Все источники прочитаны в этот день, если не сказано другое.
- **Сайт:** <https://www.jetbrains.com/air/> [1]. Прежний адрес air.dev и его пути `/download`, `/docs`, `/changelog`,
  `/pricing`, `/blog` отвечают 301 redirect на этот сайт [1].
- **Репозиторий и лицензия:** закрытый код. Plugin распространяется по бесплатной лицензии JetBrains для plugin-ов
  (JetBrains Free Plugin License) [6].
  - Публичен только код интеграций Air Context с агентами: <https://github.com/JetBrains/context>. Сам CLI `jbcontext`
    закрыт. README называет репозиторий публичной страницей продукта, а не его исходным кодом, а интеграции — «fully
    open» [33:air-context][36]. Файла лицензии в репозитории нет, и GitHub лицензию не определяет, так что условия
    переиспользования этого кода не указаны [36].
  - Реестр skills по умолчанию — публичный репозиторий <https://github.com/JetBrains/skills>
    [33:air-in-ides-extend-agent-capabilities]. Файла лицензии верхнего уровня в нём тоже нет [36].
- **Вендор:** JetBrains s.r.o. [6]. Air делает бывшая команда Fleet [7]. Fleet — лёгкая мультиязычная IDE JetBrains.
  JetBrains всерьёз рассматривала её как второе флагманское семейство IDE рядом с IntelliJ, но отказалась от этого.
  Fleet закрыли в декабре 2025, загрузки прекратились 2025-12-22 [7].
  - Стратегический пост о семействе Air (2026-09-22) написал Kirill Skrygan [17] — CEO JetBrains, назначенный с
    2024-02-01 [50].
  - Другие названные люди: Hadi Hariri, SVP of Operations, рассказывал о пилоте Central внутри JetBrains [10];
    Denis Shiryaev — Head of AI DevTools Ecosystem [8]; Ciara Byrne — Director of Engineering Productivity and AI
    Impact [30].
  - Аккаунт в X — @getsome_air [9][21], слоган — «get some air» [1].
- **Цена и планы:**
  - Air in IDEs (plugin) бесплатен, отдельной лицензии нет [33:air-in-ides-overview]. Для локальных сессий подписка
    JetBrains AI не нужна [2].
  - Подписки JetBrains AI для частных лиц [35]: AI Free — бесплатно, 3 credits за 30 дней; AI Pro — $10, 10 credits;
    AI Ultimate — $30, 35 credits; AI Trial — бесплатно, 10 credits на пробный период.
  - Подписки JetBrains AI для организаций [35]: AI Pro — $20, 20 credits; AI Ultimate — $60, 70 credits;
    AI Enterprise — $60, число credits не раскрыто.
  - Период оплаты в таблицах цен не указан. Credits обновляются раз в 30 дней и совпадают с ценой. Видимо, это цены за
    месяц [35].
  - Air Governance [33:plans-and-pricing][24]: Basic — бесплатно; Business — $20 за место в месяц, trial 30 дней;
    Enterprise — по запросу. Credits покупаются отдельно. Заявлены SOC 2 Type II и GDPR [33:plans-and-pricing].
  - Credit — общая валюта JetBrains. За credits платят за модели, облачные вычисления, индексацию и хранение
    [33:about-air]. 1 credit = 1 USD расходов у провайдера модели по публичным ценам API [33:plans-and-pricing][1].
  - Купленные credits действуют 12 месяцев [35][33:plans-and-pricing]. Запросы через свой ключ провайдера (BYOK,
    bring your own key) credits не тратят. Сервисы в preview — облачные вычисления, запросы к Air Context — могут быть
    бесплатными [33:plans-and-pricing].
  - Desktop-приложение на запуске было бесплатным [9]. Цена за весь период preview — не подтверждено.
- **Статус и активность:**
  - Desktop-приложение Air (код продукта AIR) снято с загрузки 2026-11-11. Последняя сборка — 262.1102.13 [3].
    Установленные копии ещё какое-то время получают обновления. JetBrains называет это временным и советует перейти на
    Air в IDE 2026.3 [3]. Старые страницы документации приложения перенаправлены на страницу браузерного редактора
    Air Teams, где дан тот же совет [33:air-teams-editor].
  - Источники расходятся в деталях. 2026-10-21 сотрудник JetBrains писал: Toolbox (менеджер установки JetBrains)
    приложение больше не ставит, пользователи получат критичные исправления, прямая ссылка на установщик работает
    [40:AIR-7464][40:AIR-6896]. Release note 2026-11-11 говорит, что скачать приложение больше нельзя [3].
  - Plugin «Air» (`com.intellij.air`, раньше «Air Alpha») вышел для всех вместе с IDE 2026.3 2026-11-11 [31]. На
    Marketplace: 400 476 загрузок (это загрузки всех обновлений, а не уникальные пользователи), обновления примерно
    раз в неделю, 69 оценок [6]. Последняя сборка с change notes — 262.8665.532 от 2026-11-05; 2026-11-13 около
    16:30 UTC вышли сборки 262.8665.533 и 263.7307.291 без change notes [6].
  - Зрелость plugin описана по-разному: документация называет его экспериментом [33:air-in-ides-overview], Marketplace —
    public preview [6], блог — выпущенным продуктом [31].
  - Air Governance — GA (general availability, общая доступность) с 2026-10-22 [24]. Air Teams доступен только
    бизнес-клиентам, облачные агенты — в preview [18][21]. Air Mate — early access [33:air-mate]. Мобильное
    приложение — сборки EAP (early access program, ранний доступ) с 2026-10-30 [4].
  - Число пользователей и клиентов не опубликовано ни для приложения, ни для Air Teams. Звёзд GitHub нет: код закрыт.
- **Одной фразой:** JetBrains Air — семейство продуктов JetBrains для coding-агентов разных вендоров: бесплатный plugin
  во всех IDE JetBrains ведёт параллельные сессии Claude, Codex, Junie, Copilot и других агентов локально или во
  временных git worktree, а платные Air Teams и Air Governance дают организациям облачные задачи в отдельных VM,
  automations по событиям и контроль доступа и расходов; исходное отдельное desktop-приложение Air снято с загрузки
  2026-11-11 [17][31][18][24][3].

## Модель работы

**Что сейчас называется Air.** С 2026-09-22 это не одно приложение, а семейство продуктов [17]. Термины ниже:
ACP (Agent Client Protocol) — открытый протокол между редактором и coding-агентом; MCP (Model Context Protocol) —
протокол, через который агент получает инструменты; BYOC (bring your own cloud) — запуск в облачном аккаунте клиента.

| Часть | Что получает пользователь | Где работает | Кому доступно |
|---|---|---|---|
| Air in IDEs | Панель агентных сессий внутри IDE JetBrains, plugin `com.intellij.air` [6] | Машина пользователя; backend при Remote Development; агенты под WSL [31][33:air-in-ides-manage-agents] | Всем, бесплатно [33:air-in-ides-overview] |
| Air Teams | Облачные задачи (cloud tasks), общие окружения, automations, проекты, редактор в браузере [18][33:what-is-air-teams] | Облако JetBrains: Docker-контейнер на новой VM для каждой задачи [21]; или AWS клиента [33:cloud-providers] | Бизнес-клиентам; частным лицам — «позже», дата не подтверждена [18] |
| Air Governance | Консоль администратора JetBrains Console на console.jetbrains.cloud; раньше JetBrains Central [33:air-governance][24] | Сервис JetBrains (SaaS) | Администраторам организаций [24] |
| Air Gateway | CLI `central`: локальный proxy, через который терминальные агенты получают вход JetBrains, credits и политики; раньше JetBrains Central CLI [34][33:cli-about] | Локально | Организациям, по соглашению early access [34] |
| Air Context | Семантический поиск по коду, CLI `jbcontext` [33:air-context] | Индекс в Google Cloud (Ирландия, реплики в США); embeddings считаются на сервере или локально [33:context-security-and-privacy][33:air-context] | С подпиской JetBrains AI [33:air-context] |
| Air Mate | Агент в Slack [33:air-mate] | Облако; окружение сохраняется между запросами [33:air-mate] | Организациям, early access [33:air-mate] |
| Air mobile | Запуск задач и наблюдение за ними с телефона [33:ways-to-reach-air-teams] | iOS и Android, EAP с 2026-10-30 [4] | Не подтверждено |
| Junie | Собственный coding-агент JetBrains; по плану доступен во всех частях семейства [17] | Локально и в облаке [33:supported-agents] | Junie Lite (лёгкий вариант) бесплатен [31] |
| Desktop-приложение Air | Отдельное «Agentic Development Environment» [3] | Локально, в worktree или Docker [3] | Новых загрузок нет с 2026-11-11 [3] |

**Local, cloud или hybrid — hybrid.**

- Plugin работает локально. Run modes (режимы запуска): Local — в рабочей копии проекта; Temporary Worktree — во
  временном git worktree; Cloud — задача Air Teams [33:air-in-ides-start-a-session]. Локального Docker в plugin нет
  [33:air-in-ides-start-a-session][33:air-in-ides-interact-with-the-agent].
- Облако есть только в Air Teams. Своего control plane на серверах клиента нет. «Hybrid deployments» для Enterprise
  помечены «coming soon» [33:plans-and-pricing].
- BYOC: оператор в AWS клиента управляет его EC2 и хранилищем. Google Cloud и Azure помечены «Soon»
  [33:cloud-providers].
- Собственные серверы кода поддерживаются: GitHub Enterprise Server и GitLab Self-Managed [33:set-up-air-teams].
  Выпуск plugin 262.8665.521 добавил корпоративный AI из IDE Services — сервера администрирования JetBrains, который
  компания ставит у себя [6].
- Где пользователь работает с облаком: браузер — полный интерфейс; IDE запускает cloud tasks, но не управляет
  automations, проектами и окружениями; телефон — запуск и наблюдение; Slack — через Air Mate
  [33:ways-to-reach-air-teams][33:air-mate].
- Облачные запуски уже есть у части клиентов, остальным их включают постепенно в ближайшие месяцы [1].

**Агенты и модели.**

- Plugin не является AI-провайдером и ставится без агентов [19]. Он находит агентов, уже установленных на машине, или
  ставит их из реестра агентов JetBrains [1][33:air-in-ides-overview].
- Локально: Codex, Claude Agent (в чате), Claude Code (в терминале), Gemini, GitHub Copilot, DeepSeek, OpenCode,
  Cursor, Pi, Grok, Kimi, Kilo и другие [31]. Любой ACP-агент добавляется через файл `acp.json`
  [33:air-in-ides-manage-agents].
- В облаке — только Claude Agent, OpenAI Codex, GitHub Copilot и Junie. Gemini CLI и другие ACP-агенты работают только
  локально [33:supported-agents]. Источники расходятся: макет на странице продукта показывает Gemini CLI среди облачных
  агентов [1].
- Модели в release notes приложения: GPT-5.4, GPT 5.6 Fast mode, GPT-6 Astra; Opus 4.6 и 4.7, Sonnet 4.6; Gemini 3.1
  Flash Lite, 3.5 Flash, 3.6 Flash, 3.5 Flash Lite [3]. Макет страницы продукта: Claude Agent на Fable 5, Codex на
  GPT 5.4, Gemini CLI на Gemini 3 Flash [1].
- Air Gateway по умолчанию даёт Copilot модель `gpt-5.6-luna` или `claude-opus-5` [34]. Junie Eco mode берёт дешёвую
  модель GPT-6 Luna [26]. Orchestrator в Air Mate построен на Grok и использует модели OpenAI, Google и Anthropic
  [33:air-mate].

**Один пользователь или команда.**

- Бесплатно одному человеку: plugin с локальными агентами, worktree, review и Code Notes (построчные заметки агенту),
  presets, очередь prompt-ов, MCP и skills, Junie Lite [31][33:air-in-ides-overview].
- Нужна подписка JetBrains AI: для Claude Agent в чате (или API key Anthropic вместо неё) [31] и для Air Context
  [33:air-context]. Облачным запускам из IDE нужна ещё и организация; личные лицензии исключены
  [33:air-in-ides-start-a-session].
- Только организациям: Air Teams (проекты, service accounts, общие окружения и секреты, проектные automations и
  connectors), командный Air Mate, Governance (политики, BYOK, BYOC, Session explorer, аудит, аналитика)
  [18][24][33:what-is-air-teams].

**Платформы.**

- Plugin: сборки для macOS, Windows и Linux, на arm64 и x86_64 [6]. Работает во всех IDE JetBrains, кроме Android
  Studio, включая бесплатные редакции [33:air-in-ides-overview][3].
- Desktop-приложение: macOS с декабря 2025, Linux с 2026-06-02, Windows с 2026-06-29 [3][12]. Трекер даёт для Linux
  дату 2026-06-03 [40:AIR-2399].
- Только на macOS: сигнал светодиодом Caps Lock [33:air-in-ides-manage-sessions] и Context from Screen на macOS 14 и
  новее [33:air-in-ides-interact-with-the-agent].
- JetBrains AI недоступен в Китае с 2026-07-13 [35].

## Функции

Функции сгруппированы по частям семейства. «Release 12» и номера вида «262.8665.521» — выпуски plugin на Marketplace
[6].

### Air in IDEs: установка и вид

- **Встроен в IDE 2026.3.** Его можно отключить, но не удалить [33:air-in-ides-disable]. В IDE 2026.2 ставится из
  Marketplace [33:air-in-ides-overview].
- **Не провайдер моделей.** Plugin ставится без агентов. Пока агентов нет, с машины ничего не уходит. С подпиской
  стороннего провайдера данные идут к этому провайдеру, не к JetBrains [19].
- **Как открыть.** Cmd+2 или Alt+2 [25][2]; виджет на toolbar; tool window Agent Sessions
  [33:air-in-ides-start-a-session].
- **Global prompt.** Двойное нажатие Ctrl открывает поле запроса и прикладывает текущий контекст [19]: выделение,
  файлы, символы, результаты тестов, изменения VCS, вывод консоли, скриншоты [6].
- **Раскладка.** Tool window справа или вкладка редактора [31]. Сессия показывается как графический чат или как
  терминал [19]. Можно вынести в отдельное окно [33:air-in-ides-settings].
- **Замена AI Assistant.** Старый AI Assistant остаётся отдельным plugin до начала 2027. AI Chat переехал в сессии
  Junie, старые чаты конвертируются сами [31]. Установка Air из уведомления AI Assistant отключает AI Assistant [19].
- **Видео.** Документация ссылается на два ролика: <https://www.youtube.com/v/yODck3N_lyU> (2 минуты) и
  <https://www.youtube.com/v/l7fRDT5TuyE> (8 минут). Они не просмотрены [33:air-in-ides-overview].

### Air in IDEs: агенты

- **Страница Agents.** Списки Featured и Available. Агента можно установить, принять его условия, удалить, поправить
  аргументы ACP или терминала, выбрать для него Chat или Terminal, включить или выключить
  [33:air-in-ides-manage-agents].
- **Поиск агентов.** Plugin находит агентов на машине. Остальных предлагает реестр агентов JetBrains
  [1][33:air-in-ides-overview].
- **Обновления.** Агенты обновляются сами, а работающая сессия сохраняет свою версию [33:air-in-ides-manage-agents].
  Сам Air агентов не запускает, только по действию пользователя [31].
- **Два вида агентов.** ACP-агенты показывают ход работы по шагам, вызовы инструментов, запросы разрешений и формы.
  CLI-агенты работают в терминале во вкладке редактора [33:air-in-ides-key-concepts].
- **Свои агенты.** Файл `~/.jetbrains/acp.json` с ключами `agent_servers`, `command`, `args`, `use_idea_mcp` (дать
  агенту инструменты IDE) и `use_custom_mcp` (дать свои MCP servers). Агент под WSL задаётся
  `execution_environment {"type":"wsl"}`. Свои агенты работают, даже когда администратор выключил AI
  (`aiEnabled=false`) или Air (`allowAir=false`) [33:air-in-ides-manage-agents].

### Air in IDEs: вход, провайдеры и расход

- **Три источника авторизации:** собственный вход агента, JetBrains AI или сторонний провайдер по API key или base URL
  [33:air-in-ides-quickstart][1]. Подписку можно сменить посреди сессии [1].
- **JetBrains AI** покрывает Claude Agent, Codex и Junie. В рабочем пространстве организации тратятся credits
  организации по её политикам [33:air-in-ides-authorization].
- **API key провайдеров:** Anthropic, OpenAI, Gemini, OpenRouter [33:air-in-ides-authorization]. Вход в OpenRouter через
  браузер — с 2026-10-30 [6].
- **Codex через вход ChatGPT** (OAuth и device code). Change notes впервые упоминают его 2026-10-01, в сборках
  262.8665.481 и 263.6259.32, и как исправление: значит, вход был и раньше. Более ранние сборки вышли без change notes,
  поэтому дата появления не подтверждена [6].
- **GitHub Copilot** — официальный Copilot CLI через ACP, на плане Copilot пользователя [27].
- **Подписка Claude Pro или Max** работает только через Claude Code в терминальной поверхности. Объяснение в
  документации: чат построен на интеграции через SDK, а условия Anthropic не разрешают так использовать подписки
  [33:air-in-ides-claude-subscription]. Claude Agent в чате требует JetBrains AI или API key Anthropic [31]. Пост
  «Getting Started» называет для чата только подписку JetBrains AI [25].
- **Junie Lite** бесплатен: с JetBrains Account и без Eco mode [33:air-in-ides-authorization], в рамках fair use [31],
  «на ограниченное время» [2].
- **Показ расхода.** Стоимость сессии в токенах или деньгах [31]. AI Usage view — квота JetBrains AI, credits и даты
  сброса — с выпуска 262.8665.521 [6]. Расход Claude в status bar — по желанию [33:air-in-ides-claude-subscription].
  Такой же вид для подписок Codex, Claude и Copilot ещё в работе [31].

### Air in IDEs: presets

Preset — сохранённая комбинация агента, модели, effort и режима.

- Для каждого найденного агента создаётся preset по умолчанию, привязанный к этому агенту
  [33:air-in-ides-presets][33:air-in-ides-quickstart].
- Свой preset: имя, агент, модель, effort, mode и флажок Plan mode [33:air-in-ides-presets].
- Поле «Injected instructions» уходит агенту перед первым prompt и не видно в разговоре [33:air-in-ides-presets].
- Настройка выбирает, с какого preset начинаются новые сессии: с последнего использованного или с preset по умолчанию
  [33:air-in-ides-settings].

### Air in IDEs: запуск сессий и worktree

- **Run modes:** Local, Temporary Worktree, Cloud [33:air-in-ides-start-a-session].
- **Temporary worktree.** Создаётся от любой ветки, на новой ветке или в detached HEAD [19]. Имя ветки и базовую ветку
  можно задать [33:air-in-ides-start-a-session].
- **Fork и продолжение.** Сессию можно разветвить (fork) в новый временный worktree или в тот же workspace.
  Существующую сессию можно продолжить [33:air-in-ides-start-a-session].
- **Действия с worktree:** Worktree Changes; Commit; Cherry-pick в ветку, выбранную сейчас в основном проекте;
  «Commit and cherry-pick all»; Push ветки worktree [33:air-in-ides-start-a-session]. Выпуск 262.8665.521 сделал
  Commit, Push и Cherry-pick понятнее [6].
- **Настройки worktree:** корень `~/.air/worktrees/temporary`; лимит на проект и автоудаление после N дней простоя, оба
  выключены по умолчанию [33:air-in-ides-settings]. Release 12 (2026-10-23) дал worktree запоминающиеся имена и
  показал постоянные worktree [6].
- **Ограничения worktree.** Worktree, которые агент создаёт сам, Air пока не отслеживает [31]. Worktree — не
  изолированная security sandbox [2].
- **Cloud из IDE** [33:air-in-ides-start-a-session]:
  - только пользователям организаций с включёнными cloud tasks, не по личной лицензии;
  - нужны remote на GitHub или GitLab, приложение JetBrains Air connection и запушенная ветка;
  - окружение фиксируется при первом запросе;
  - закрытие IDE запуск не останавливает, IDE потом переподключается;
  - запуски с веба или с другой машины тоже видны в IDE.
- **Передача работы.** Начать локально и передать в удалённое окружение команды. Или забрать запуск automation в IDE и
  продолжить там [33:overview].

### Air in IDEs: запросы и вид сессии

- **Заголовок сессии:** run mode и проект; библиотека prompt-ов; Add; голосовой ввод; preset; модель и effort
  (Ctrl+Shift+M), включая Fast mode; permission mode [33:air-in-ides-interact-with-the-agent].
- **Режимы зависят от агента.** У Codex: Read-only, Workspace access, Auto review, Full access и переключатели Plan и
  Goal [33:air-in-ides-interact-with-the-agent].
- **Индикатор context window** [33:air-in-ides-interact-with-the-agent].
- **Junie Eco mode.** Рутинные шаги уходят дешёвой модели-компаньону. Режим не бесплатен. С моделью Default включается
  сам [33:air-in-ides-interact-with-the-agent].
- **Вложения.** Файлы, папки, загрузки, коммиты, skills; Context from Screen (macOS 14+); «Add to Agent Context» из
  редактора, дерева проекта, консоли, дерева тестов и VCS [33:air-in-ides-interact-with-the-agent]. Ссылки `@file:`,
  `@folder:` и `$` для skills [33:air-in-ides-quickstart]. Упоминания коммитов через `@` — с Release 12 [6].
- **Помощь при вводе.** Диктовка, подсказки prompt-ов, подсказки следующего шага (принимаются клавишей Tab), ответ на
  выделенную часть ответа агента [33:air-in-ides-interact-with-the-agent].
- **Очередь prompt-ов.** Send now, правка, удаление, открыть в новом чате, выключить очередь, перетащить для смены
  порядка, Resume [33:air-in-ides-interact-with-the-agent]. По умолчанию Enter ставит в очередь, а Ctrl+Enter отправляет
  сразу [33:air-in-ides-settings]. С Release 12 сообщение в очереди можно править, а очередь — ставить на паузу [6].
- **Формы вопросов** ставят сессию на паузу до ответа [33:air-in-ides-interact-with-the-agent].
- **История.** Время сообщений и длительность ходов — с Release 12 [6]. Outline Structure по разговору
  [33:air-in-ides-manage-sessions].

### Air in IDEs: review, Code Notes, коммиты, merge

- **Review Code.** Scope — локальные изменения или выбранные коммиты. Открывается вкладка «Review in progress».
  Пользователь оставляет заметки в gutter (поле слева от кода). Потом нажимает «Finish & Attach Comments» или оставляет
  их как Pending Notes. В review может быть одна сессия за раз. Нужен Git. Для терминальных сессий режим не работает
  [33:air-in-ides-review-changes][33:air-in-ides-quickstart].
- **Code Notes** — построчные заметки, которые уходят агенту. Работают и вне review. Узел Code Notes показывает заметки
  Unattached, Attached и Pending [33:air-in-ides-review-changes]. Работают и с терминальными агентами [31]: выпуск
  262.8665.521 (2026-10-30) отправляет комментарии к коду в терминальные сессии [6].
- **Generate Commit Message.** Следует соглашениям репозитория и AGENTS.md. Работает как скрытая служебная сессия, по
  умолчанию на лёгком агенте вроде Junie Lite. Можно задать свой prompt с `$GIT_BRANCH_NAME`
  [33:air-in-ides-review-changes].
- **Resolve with Agent** решает конфликты merge [33:air-in-ides-review-changes].
- **Last Turn** показывает правки subagent-ов — с выпуска 262.8665.521 [6].

### Air in IDEs: много сессий

- **Tool window Agent Sessions** собирает все сессии: начатые в Air, начатые во внешних инструментах вроде приложения
  Codex, облачные [33:air-in-ides-manage-sessions]. По каждой видны активность, непрочитанные обновления, изменённые
  файлы, исходящие коммиты и стоимость, по нескольким проектам сразу [19][1].
- **Поиск** по тексту разговоров, включая архивные [33:air-in-ides-manage-sessions].
- **Фильтры и группировка** [33:air-in-ides-manage-sessions]: Active, Done или All; показ времени, стоимости и
  sub-agent-ов; статусы In Progress, Input Required, Unread, Draft; лимит 5, 10, 15 или все; группировка по дате,
  статусу, непрочитанности, проекту или без группировки.
- **Действия** [33:air-in-ides-manage-sessions]: Mark as Done (в архив), Mark Unread, цветная метка, Pin, Rename, Move
  to Session Folder, Fork, Copy Session Info, Report a Problem.
- **Session folders** — папка на одну единицу работы: задачу, баг, фичу или исследование. Метаданные `issue` и
  `review`. Агент может создать или изменить папку командами «Create with Agent» и «Edit with Agent»
  [33:air-in-ides-manage-sessions].
- **Рестарт IDE.** Сессии его переживают. Состояния Read и Needs input — с выпуска 262.8665.521 [6].
- **Сигналы человеку:**
  - звуки на завершение, ошибку, нужный ввод и диктовку [33:air-in-ides-settings];
  - светодиод Caps Lock на macOS: медленно мигает — агент работает, быстро — нужен ввод, горит — есть непрочитанное
    [33:air-in-ides-manage-sessions];
  - «Prevent System Sleep While Agent is Working» [33:air-in-ides-manage-sessions];
  - счётчики активности в title bar или toolbar [33:air-in-ides-manage-sessions].
- **Прочие настройки** [33:air-in-ides-settings]: показать, какие сессии меняли файл; цветные метки; шрифт, ширина и
  выравнивание чата; «playful status words»; где открывать ссылки.
- **Remote Development** (IDE на удалённой машине, интерфейс локально). Air и агенты работают на backend [31]. Вход
  Copilot и Antigravity (агентная среда Google) под Remote Development — с выпуска 262.8665.521 [6].

### Air in IDEs: инструменты агентов

- **MCP server IDE `jetbrains_air_ide`.** Поиск и анализ кода, inspections, сведения о проекте, операции с файлами и
  редактором, build и run, рефакторинг и отладка. Все вызовы идут через один router — `execute_tool`
  [33:air-in-ides-extend-agent-capabilities].
  - По GA-посту агенты проверяют inspections, запускают builds и run configurations, делают запросы к базам данных,
    применяют рефакторинги IDE и управляют debugger в IntelliJ IDEA и CLion [31].
  - Инструменты IDE под WSL — с Release 12 [6].
- **MCP servers** [33:air-in-ides-extend-agent-capabilities]: файл `~/.jetbrains/mcp/mcp.json` в формате `mcpServers`;
  транспорты stdio и HTTP, SSE не поддерживается; OAuth для удалённых серверов. Серверы также приходят от организации
  (выключены, пока их не включат) и из plugin-ов.
- **Страница Skills («AI | Skills»)** [33:air-in-ides-extend-agent-capabilities]:
  - встроенные skills;
  - куда ставить: хранилище IDE, `.agents/skills` проекта, папки Claude и Codex — на проект или глобально;
  - импорт из `~/.claude/skills` и `~/.codex/skills`; дополнительные папки skills;
  - внешние реестры, по умолчанию <https://github.com/JetBrains/skills>.
  - Выпуск 262.8665.521 добавил skills из plugin-ов Claude Code и skills Codex под WSL [6].
- **Сеть.** Plugin учитывает proxy и сертификаты IDE — с Release 12 [6].

### Air in IDEs: прочие AI-функции IDE

- Code completion не тратит квоту JetBrains AI [31].
- Next-edit suggestions требуют подписку JetBrains AI или вход в GitHub [31].

### Air in IDEs: управление машинами компании

- **Файл политики `jcp.json`** в `%ProgramFiles%\JetBrains\Air\`, `/Library/Application Support/JetBrains/Air/` или
  `/etc/xdg/JetBrains/Air/` [33:air-in-ides-manage-user-machines]:
  - `allowAir:false` выключает Air;
  - `organizationId` закрепляет одну организацию и блокирует личные планы, Junie Lite и другие организации;
  - неверный файл выключает Air;
  - файл распространяют через Intune, Jamf или SCCM.
- **Контроль из консоли.** JetBrains Console или IDE Services задают allowlist агентов. Выключение AI прячет весь
  интерфейс [33:air-in-ides-overview].

### Air Teams: доступ и настройка

- **Кому.** Бизнес-клиентам сейчас, частным лицам позже [18]. Облачные агенты — preview, только для пользователей
  организаций [21].
- **Мастер настройки администратора** [33:set-up-air-teams]: ставит GitHub app; регистрирует GitHub Enterprise Server и
  генерирует для него app; регистрирует GitLab Self-Managed. Каждый разработчик авторизует GitLab сам.
- **По умолчанию** у каждого разработчика есть доступ к AI, все агенты и cloud tasks. Политики задают доступ к AI,
  лимиты credits, агентов, cloud tasks и connectors. Личные аккаунты провайдеров работают только локально
  [33:set-up-air-teams].
- **Начало работы.** Мастер, страница New Task, страница «Settings | VCS Providers» [33:quickstart-with-cloud-agents].

### Air Teams: cloud tasks

Cloud task — задача, которую агент выполняет в облачном окружении.

- **Постановка.** Репозиторий и ветка или окружение. «Select Multiple» выбирает несколько репозиториев
  [33:define-tasks]. Агент фиксируется на старте, модель можно менять по ходу
  [33:define-tasks][33:select-agents-and-models]. MCP connector добавляется, если позволяет политика [33:define-tasks].
- **Permission modes** [33:permission-modes]: у Claude Agent — Plan, Ask Permission, Auto-Edit, Full Access; у Codex —
  Chat, Agent, Full Access. Запрос разрешения приходит карточкой в чат и уведомлением «Task needs your input». Режим
  можно сменить по ходу задачи.
- **Контекст.** `@` ссылается на файлы, папки, ветки и коммиты; `/` запускает команды и skills; «Upload from Computer»
  добавляет файлы [33:define-tasks]. Ещё — локальные изменения, «Add to Task», «Add Terminal Selection to Task»
  [33:task-context].
- **Что агент читает из репозитория:**
  - инструкции — CLAUDE.md, папку `.claude` с `.claude/settings.json`, AGENTS.md [33:project-instructions];
  - команды — встроенные `/init` и `/review` и свои в `.claude/commands/<name>.md` и `.junie/commands/<name>.md`
    [33:commands];
  - skills — `.agents/skills/<name>/SKILL.md`, `.claude/skills`, `.codex/skills`, `.junie/skills` [33:skills].
- **Жизненный цикл** [33:tasks][33:what-is-air-teams]:
  - репозиторий клонируется shallow;
  - состояния: Starting, Done, Suspended, Archived, Problem;
  - 75 минут простоя — Suspended, 24 часа простоя — Archived;
  - после каждого хода агента работа коммитится и пушится в ветку задачи, никогда в main. PR открывает и мержит
    человек.
- **Работа с задачей** [33:run-tasks-in-cloud]:
  - сколько угодно задач одновременно;
  - задача, дважды отправленная на доработку, оставляет три коммита;
  - свои правки надо закоммитить до следующего prompt, иначе их заберёт коммит агента;
  - Suspended-задача возобновляется по запросу.
- **Snapshots** (сохранённое состояние диска окружения) [33:tasks]: возобновление восстанавливает рабочее дерево,
  пакеты и кэши, но не процессы. Новая задача на том же репозитории стартует с подготовленного окружения, а репозиторий
  синхронизируется заново. Snapshots личные и истекают.
- **Несколько репозиториев** [33:run-tasks-in-cloud]:
  - первый — основной; каждый клонируется в `/workspaces/<repo>`;
  - провайдеров можно смешивать; в каждом репозитории ветка задачи с одним и тем же именем;
  - до 10 репозиториев кроме основного;
  - startup scripts всех репозиториев выполняются в неопределённом порядке;
  - серверы из `.mcp.json` и skills объединяются, AGENTS.md и CLAUDE.md — нет;
  - один PR на репозиторий.
- **Очередь prompt-ов** [33:prompt-queue]: отправляется автоматически и переживает перезагрузку страницы. Остановка
  агента ставит очередь на паузу и даёт каждому prompt кнопку «Send Now». Prompt из очереди не отвечает на карточку
  разрешения.
- **Context window** [33:context-window]: предупреждение выше 80%, ошибка выше 99%. Есть `/compact` и `/clear`.
- **Review** [33:review-changes]: diff «All Changes», unified или side by side; F7 переходит к следующему изменению.
  Комментарии копятся в инструменте Comments и уходят агенту вместе. Есть `/review`. Результат пользователь проверяет в
  Terminal или просит проверить агента.
- **Create PR** открывает по PR на каждый репозиторий [33:create-a-pull-request].
- **Диагностика** [33:troubleshoot-cloud-tasks]: `git fetch --unshallow`; смена конфигурации требует новой задачи;
  timeouts старта; остатки от snapshots; Copy ID, Collect Logs (ZIP), Contact Support.
- **Оплата — источники расходятся.** Документация: cloud tasks всегда тратят credits JetBrains AI
  [33:tasks][33:supported-agents]. Пост о Copilot: облачные задачи Copilot идут на план Copilot пользователя [27]. С
  постом согласуется значение по умолчанию «Not set» для Copilot в Governance [33:ai-agents].

### Air Teams: облачные окружения

Cloud environment — Docker-контейнер на VM, собранный по конфигурации окружения [33:configure-environments].

- **Образ.** Только управляемый образ по умолчанию, в нём почти все распространённые инструменты. Свои образы пока не
  поддерживаются [33:configure-environments][33:environment-images].
- **Размеры VM** (своих размеров нет) [33:vm-resources]:

  | Размер | CPU | Память | Диск |
  |---|---|---|---|
  | Small | 2 | 8 GB | 20 GB |
  | Medium | 4 | 16 GB | 30 GB |
  | Large | 8 | 32 GB | 50 GB |
  | Extra Large | 16 | 64 GB | 100 GB |

- **Сеть** [33:environment-network-access]: режимы Off (только обязательные домены), Specified domains, Trusted domains
  (preset примерно из 70 доменов пакетов и систем контроля версий), All domains. Дополнительные домены — с wildcard.
  Исходящий трафик идёт с фиксированного пула примерно из 64 IP-адресов.
- **Открытые порты** [33:exposed-ports]: только HTTP; по умолчанию 3000, 8000 и 8080. У каждого порта публичный URL без
  аутентификации. Полоса общая на все порты. URL лежит в переменной `JBCENTRAL_EXPOSED_PORT_URL_<port>`.
- **Startup script `.air/cloud/startup.sh`** [33:startup-commands]: выполняется при каждом старте окружения, включая
  resume и старт из snapshot. Работает от пользователя с sudo и должен быть идемпотентным. Timeout — 600 секунд по
  умолчанию, настраивается от 1 до 3600. При ненулевом exit code агент всё равно запускается.
- **Переменные и секреты** [33:environment-variables-and-secrets]: обычные переменные, личные секреты, общие секреты.
  Секреты HashiCorp Vault читаются при старте окружения (вход AppRole; Vault должен быть доступен из интернета).
- **Общий доступ** [33:share-an-environment]: окружение делится с пользователями, service accounts или группами с ролями
  Owner, Can edit, Can view. Личные секреты не делятся никогда.
- **Окружение собирает агент.** Кнопка «Start Agent»: агент пишет конфигурацию, проверяет её и коммитит startup script в
  отдельную ветку. Потом окружение сохраняется как snapshot [18][33:create-an-environment][33:quickstart-with-cloud-agents].

### Air Teams: automations

Automation — облачная задача, которую запускает trigger, без человека. Назначение по документации: баги и issues,
события репозитория, плановое обслуживание, упавшие сборки, цепочки из нескольких шагов [33:automations].

- **Создание** [33:create-automation]:
  - scope: личная или проектная;
  - цель: один репозиторий, окружение, несколько репозиториев или ничего. С несколькими — до 10 дополнительных, а
    trigger-ы срабатывают только на события основного. Без репозитория доступны только schedule, interval, Jira,
    цепочка и webhook;
  - поля: Instructions, Use Template, Model; переключатель Agent / Person;
  - trigger необязателен: без него automation запускается только кнопкой «Run Now»;
  - connectors: GitHub включён всегда;
  - credits: личная automation тратит credits автора, проектная — credits проекта или автора.
- **Trigger-ы** [33:automation-triggers]:
  - Schedule — «At time» в выбранные дни; Interval — «Repeat every», например раз в 2 часа.
  - GitHub: PR — Opened, Moved out of draft, Labeled, New changes, Review requested, Review received, Merged; issue —
    Opened, Labeled; workflow — Failed, Job failed. Фильтры, например автор PR и «Ignore drafts». Комментарии
    trigger-ы не запускают.
  - GitLab: merge request — Opened, Marked as ready, Labeled, New changes, Review requested, Approved, Merged; work
    item — Opened, Labeled; pipeline — Failed, Job failed. Air сам добавляет webhook в GitLab; для этого нужна роль
    Maintainer.
  - Jira: задача создана, получила метку, назначена, сменила статус, сменила приоритет, решена, прокомментирована;
    необязательный ключ проекта. Обработка изменений — только «Create a PR» или «No code changes».
  - Automation finished — запускает следующую automation в цепочке.
  - Incoming webhook: endpoint `.../api/v1/events/automations/<id>` с заголовком `Authorization: ApiKey <token>`.
    JSON payload (необязательный) становится контекстом задачи.
  - Обработка изменений (change handling): No code changes; Push to source branch; Push to new branch; Create a PR (в
    GitLab — MR).
- **Цепочки** [33:chained-automations]: настраиваются на принимающей automation и срабатывают только при успехе.
  Следующий запуск получает summary, ссылки, репозиторий, стартовую ветку, запушенную ветку и ссылку на запуск.
  Цепочка останавливается на сбое, паузе или удалении automation. Ничто не мешает цепочке зациклиться на саму себя.
- **Шаги, которые делает человек** [33:person-automations]: без окружения и без credits. Запуск ждёт ответа в Markdown
  без timeout и не шлёт уведомления, пока ждёт. Шаг по расписанию добавляет новый ожидающий запуск при каждом
  срабатывании. Ответ человека становится summary для следующего шага.
- **Уведомления** [33:automation-notifications]:
  - email при сбое — автору и тому, кто запустил;
  - webhook POST с заголовками `X-Air-Webhook-Id` (`evt_<uuid>`, годится как ключ идемпотентности),
    `X-Air-Webhook-Event` (`automation.execution.succeeded` или `automation.execution.failed`) и
    `X-Air-Webhook-Format` (`json` или `slack-workflow`);
  - payload: `statusUrl` на air.jetbrains.cloud; `output.result` при успехе; `error {message, code}` при сбое, например
    «Agent run timed out».
- **Подключение Jira** [33:connect-jira]: один webhook URL на организацию и секрет, который показывают один раз. Ротация
  секрета молча останавливает все trigger-ы Jira, пока Jira не обновят.
- **Управление** [33:manage-automations]: списки Project и Personal с группировкой, сортировкой, фильтром и поиском; Run
  Now с выбором ветки, обработки изменений и дополнительного контекста; Stop, Pause, Resume; перенос в проект;
  Duplicate; Delete. Air сам ставит на паузу проектные automations GitLab, когда их token перестаёт работать.
- **Шаблоны:**
  - шаблоны «By Air» — Code Review, Issue Triage, Generate Release Notes; организации добавляют свои
    [33:automation-templates];
  - параметры `{{parameter_name}}` и флажок «Allow additional instructions»; связанные automations следуют правкам
    шаблона; есть «Save as Template» и архивирование [33:automation-templates];
  - на запуске Air Teams шаблонов было десять [18];
  - макет страницы продукта показывает карточки с ценой в credits: Agents.md updater, Auto-rebaser, Code-reviewer,
    Documentation update, Issue triage, Lint checker [1].
- **Результаты запуска** [33:automation-run-results]: страница summary; «Show full chat» — запись рассуждений и вызовов
  инструментов только для чтения; Create PR; «Continue in New Task» на той же ветке; Rerun с тем же входом и текущей
  конфигурацией.
- **Диагностика** [33:troubleshoot-automations]: запуск заканчивается состоянием Done или Problem. Расписание работает
  от имени автора и молча перестаёт срабатывать, когда сессия автора истекла.
- **Примеры с запуска Air Teams** [18]:
  - code review — комментарии в строках, summary, затем approve или request changes; повтор на каждом коммите со
    сворачиванием старых review;
  - исправление issue — помеченная issue в YouTrack превращается в PR, дальше automation отрабатывает замечания review;
  - обновление зависимостей дважды в неделю — build, тесты, исправление или откат; открыт один PR, предыдущий
    закрывается.

### Air Teams: проекты и connectors

- **Projects** [33:projects][33:project-members][33:project-connectors-and-secrets][18]: роли Admin и Member. Credits
  проекта идут от service account в Console, поэтому automations работают и после ухода автора. Доступ к репозиториям
  — по identity запуска. Проектные connectors используют общий аккаунт и доступны только проектным automations, не
  cloud tasks.
- **MCP connectors** [33:connectors]: Confluence, Figma, GitHub (включён всегда), GitLab, Grafana, Jira, Linear, Sentry,
  TeamCity, YouTrack. Личные действуют от имени пользователя, проектные — от аккаунта проекта. Сервис должен быть
  доступен из интернета. `.mcp.json` в репозитории может ссылаться на `${VARIABLE}`. При совпадении имён побеждает
  connector.

### Air Teams: редактор в браузере

- Лёгкий редактор без анализа кода [33:air-teams-editor].
- Инструменты: Files, Search, Changes, Comments, History, Terminal. Ещё Git-операции, «Go to All» (Ctrl+K) и колокольчик
  уведомлений [33:air-teams-editor].
- Terminal принадлежит пользователю. Команды агента видны в чате [33:air-teams-editor].

### Интеграции

- **Хостинги кода:** GitHub, GitLab, GitHub Enterprise Server, GitLab Self-Managed [33:quickstart-with-cloud-agents].
- **Трекеры задач:** Jira — trigger-ы и connector [33:automation-triggers][33:connectors]; YouTrack — connector и
  пример automation «issue → PR» [18][33:connectors]; Linear — только connector, trigger-ов нет [33:connectors].
- **CI:** падения workflow и job в GitHub и pipeline и job в GitLab запускают automations [33:automation-triggers];
  connector TeamCity [33:connectors]; Air Mate следит за CI [33:air-mate].
- **Slack:** Air Mate и формат webhook для Slack workflow [33:air-mate][33:automation-notifications].
- **Прочие connectors:** Confluence, Figma, Grafana, Sentry [33:connectors].
- **Секреты и управление устройствами:** HashiCorp Vault [33:environment-variables-and-secrets]; Intune, Jamf, SCCM
  [33:air-in-ides-manage-user-machines].

### Air Mate — агент в Slack (early access)

- **Поведение** [33:air-mate]: читает все сообщения в подключённых каналах и сам отвечает, когда у него есть основания.
  Выключить это нельзя. Отвечает на вопросы, чинит баги, делает PR, отрабатывает комментарии review и CI, может мержить
  свои PR. Использует connectors, например YouTrack. Выполняет регулярные проверки и напоминания.
- **Два вида** [33:air-mate]: Team Air Mate принадлежит проекту, тратит credits проекта и работает от service account
  проекта. Personal Air Mate — один на пользователя, в личных сообщениях.
- **Состояние** [33:air-mate]: окружение сохраняется между запросами; состояние разговора сохраняется и сжимается в
  summary.
- **Модели** [33:air-mate]: orchestrator построен на Grok и использует модели OpenAI, Google и Anthropic. В early access
  он игнорирует ограничения моделей из Governance и отдельно не оплачивается.
- **Ограничения** [33:air-mate]: только GitHub; администратор не может выключить его для всей организации; он не
  запускает и не отслеживает cloud tasks и automations.
- **Настройка** [33:air-mate-connect][33:air-mate-work][33:air-mate-configure]: `/invite`, затем «Set Up in Air», затем
  форма New Bot (имя, репозиторий или окружение, Rules, Connectors). `/airmate reset` сбрасывает его. Групповые личные
  сообщения не поддерживаются. Расписания задаются обычным текстом, например «weekdays 9:00 Europe/Berlin», и
  управляются только в Slack. Rules нельзя переопределить запросом. Delete необратим.

### Air Gateway — CLI для терминальных агентов

- Документация всё ещё называется JetBrains Central CLI, команда — `central` [34].
- Локальный proxy, который добавляет аутентификацию JetBrains [34]. Слушает 127.0.0.1, порт по умолчанию в
  документированной конфигурации — 19516 [34:cli-in-depth]. Весь трафик идёт через JetBrains [34:cli-about].
- Агенты: Claude Agent (Claude Code), Codex, Gemini CLI, Junie CLI, Pi, GitHub Copilot [34].
- Команды [34]:
  - `central add <agent>` подключает агента и делает backup его конфигурации, например
    `~/.claude/settings.backup.<ts>.json`;
  - `central run <agent> -- …` и `central remove`;
  - `central limit` — потрачено, осталось, период;
  - `central status` — аутентификация, порт proxy, агенты;
  - `central agents` объясняет, почему агент недоступен; `central agents refresh` обновляет список, который и сам
    обновляется примерно раз в час;
  - `central log` — только метаданные;
  - без аргументов — интерактивное меню.
- Service accounts работают для всех агентов, кроме Junie CLI. BYOK — для всех, кроме Junie CLI и Copilot [34].
- Запуск агентов внутри IDE или desktop-приложения в задачи Gateway не входит [34].

### Air Context — семантический индекс кода

- Семантический поиск по коду. Хранит векторы, а не исходный код [33:air-context]. Индекс строится на сервере или
  локально (MLX или llama.cpp и USearch). Поиск возвращает координаты в файлах, а не сам код
  [33:air-context][33:context-indexing].
- Работает в Air in IDEs через CLI, встроен в Air Teams, управляется из Governance [33:air-context].
- `jbcontext setup-agent` подключает индекс к Claude Code, Codex, Junie CLI или любому агенту. Команда ставит
  инструкции, skill `context-search` (по умолчанию всем агентам, кроме Codex), subagent `context-explorer` только для
  чтения, session hooks, MCP server (только для Claude Code) и правила выполнения для Codex
  [33:context-agent-integrations]. Код интеграций публичен, но файла лицензии в репозитории нет
  [33:context-agent-integrations][36].
- Индексация в CI: `jbcontext --ci index` с credentials service account; примеры для GitHub Actions и TeamCity
  [33:context-ci].
- Данные: индекс хранится 14 дней после последнего поиска; `.jbcontextignore` исключает файлы; `jbcontext remove-index`
  удаляет индекс [33:context-security-and-privacy].
- JetBrains заявляет до 70% меньше ходов агента. Это benchmark самого вендора [28].

### Air Governance — консоль администратора

- GA, раньше JetBrains Central. Покрывает IDE, CLI, web и mobile [24].
- **Возможности** [24]: лимиты credits на пользователя, команду и service account; BYOK с OpenAI, Anthropic, Bedrock и
  Vertex; утверждённый список агентов; MCP servers уровня компании; политики; расходы по пользователю, агенту, модели и
  провайдеру; метрики результата.
- **Политики** [33:ai-policies-configure]: переключатель cloud tasks; месячный лимит credits, где 0 останавливает траты;
  вкладки MCP и Agents наследуют политику по умолчанию. Изменения доходят до IDE, Air Teams и Air Gateway с задержкой.
- **Агенты** [33:ai-agents]: встроены Junie, Claude Agent, OpenAI Codex, Gemini CLI, Pi, GitHub Copilot. Провайдеры: у
  Claude Agent — JetBrains AI, Anthropic или Bedrock; у Codex — JetBrains AI или OpenAI; у Gemini CLI — JetBrains AI
  или Vertex; у Copilot по умолчанию «Not set», то есть пользователи приносят свою подписку Copilot. Свои агенты
  описываются в JSON.
- **Session explorer** [33:session-explorer]: каждая AI-сессия организации — кто начал, агент, модель, длительность,
  токены, credits. Обновляется пачками, не в реальном времени. Экспорт в CSV. Identity можно скрыть.
- **Activity and impact:** доля вклада и доля принятых изменений [33:ai-activity-and-impact].
- **Analytics API** с endpoints о достижении лимитов («limit hits») [33:analytics-api-v2].
- **Audit:** события пользователей, ролей, доступа и лимитов credits, фильтры за 90 дней [33:audit].
- **Лимиты credits** [33:ai-credit-limits]: личный лимит важнее лимита политики, а тот важнее лимита по умолчанию. Лимиты
  месячные и сбрасываются первого числа. Пустой общий пул останавливает всех.
- **Еженедельный changelog** [33:changelog]: 2026-09-20 — автопокупка credits; 2026-10-11 — платные планы и BYOC на
  AWS; 2026-10-18 — Copilot в CLI; 2026-10-25 — интеграция Air Context и скрытие identity в данных сессий.
- **BYOC на AWS** [33:cloud-providers]: оператор ставится через CloudFormation, управляет EC2 и хранилищем в регионе
  клиента и опрашивает Console. В JetBrains регистрируется только публичный ключ.
- **Опыт самой JetBrains:**
  - расходы JetBrains на AI выросли примерно в 10 раз за первую половину 2026; первый отчёт по нескольким вендорам
    собирали 4 дня [24][15];
  - большинство разработчиков JetBrains пользуются 3–5 AI-инструментами в месяц; у JetBrains было 150 мест Claude Code,
    и она перешла на Enterprise-план Anthropic; внутренний router JetBrains AI Platform обработал больше миллиарда
    запросов к LLM с 2023 года [15];
  - Governance сейчас управляет примерно 2 300 сотрудниками JetBrains [24].

### Мобильное приложение

- Сборки EAP для Android и iOS с 2026-10-30, версия 0.3.141 [4].
- Запуск задач и наблюдение за ними [33:ways-to-reach-air-teams]. В данных о продуктах JetBrains описано как
  управление агентными сессиями IDE с телефона [4].
- Air Teams на телефоне анонсирован на 2026-11-15 [2].
- Остальные функции — не подтверждено.

### Desktop-приложение Air (снято с загрузки 2026-11-11)

По release notes [3], если не указано другое.

- **2025-12-01** — первая сборка 261.63.28, только macOS.
- **2026-02-22** — Claude Agent подключается только через Anthropic Console с оплатой по API. Вход с планами Claude Pro,
  Max и Team убран.
- **2026-03-05** — сборка без заметок. Была ли это публичная премьера — не подтверждено.
- **2026-03-09**, launch post [9]: Codex, Claude Agent, Gemini CLI и Junie одновременно; по умолчанию локально или
  изолированно в Docker-контейнерах и git worktree; работа с JetBrains AI или с подписками провайдеров, кроме
  Anthropic.
- **2026-04-02** — Plan mode сохраняет планы в Markdown, план потом выполняется в worktree или Docker; виджет Questions;
  `.air/docker.json` и `.air/worktree.json` задают переменные окружения и setup scripts до старта агента; skills для
  всех агентов через `/`; новое управление MCP.
- **2026-04-17** — очередь prompt-ов; commit message от агента; Codex Fast mode на GPT-5.4 (нужна подписка ChatGPT);
  Shift+Tab переключает режимы.
- **2026-05-12** — «Add Comment» и «Add to Task» в diff; cleanup scripts в `.air/worktree.json`; Auto-commit — правки
  агента ложатся отдельными коммитами в задачах Worktree и Docker; context 1M токенов для Sonnet и Opus.
- **2026-06-02** — Linux через Toolbox; permission mode запоминается для каждого агента; виджет контекста для Codex;
  subagents Claude через `/`.
- **2026-06-18** — открыть проект задачи в IDE JetBrains.
- **2026-06-29** — Windows; Plan mode; параллельный запуск Claude, Codex, Gemini и Junie в git worktree; комментарии
  прямо в diff, в том числе review работы одного агента другим.
- **2026-07-15** — любой ACP-агент через `acp.json`; Docker-задачи на Windows (нужен Docker Desktop); вкладка Proposed
  Change перед выдачей разрешения; context window и расход токенов Claude; macOS не засыпает, пока идут задачи. Пост
  2026-07-21 добавляет локальные модели через Ollama или LM Studio и code intelligence для Java и Kotlin на движке
  IntelliJ [14].
- **Июль–август 2026** — квота JetBrains AI под значком шестерёнки.
- **2026-08-19** — строка о запуске Claude Agent на подписке Claude Pro, Max или Team. В заметках сборки 2026-08-21 её
  уже нет, причина не названа [3][40:AIR-6913].
- **2026-08-21** — окна с несколькими проектами; новый Markdown-редактор; экран Customize; Agent Review с выбором
  агента и модели; IME на Windows [16].
- **2026-09-10** — Git-репозиторий больше не обязателен; закрепление и группировка задач; звуки только когда Air в
  фоне; агенты работают с website Preview (встроенным предпросмотром сайта); Codex `/goal`.
- **2026-10-08 и 2026-10-21** — закреплённые задачи; встроенные и свои subagents Codex, свои subagents Junie; более
  быстрые Git checkpoints; исправлены сбои загрузки облачных задач.
- **2026-11-11** — последняя сборка 262.1102.13 с сообщением о снятии с загрузки.
- Как работали Docker-задачи сверх release notes и трекера — не подтверждено. Устройство Git checkpoints известно из
  разборов в трекере [40:AIR-6469][40:AIR-6724][40:AIR-6840][40:AIR-6953].

## Принципы и подходы

### Тезисы запуска (март 2026)

- **Проблема.** Работа с агентами раздроблена. У каждого агента свой инструмент, своя настройка и свой контекст, и нет
  структурного понимания кода [9].
- **Главная идея.** IDE добавляют инструменты к редактору кода, а Air строит инструменты вокруг агента. Упоминания
  символов и коммитов дают агенту точный контекст. Review идёт в контексте всего кода. Рядом с агентом — терминал,
  git-клиент и preview [9].
- **Признанное ограничение.** Сложные кодовые базы ещё не готовы к чисто агентной разработке. Air оркестрирует агентов,
  остальное делает IDE [9]. К осени это разделение развернули: агенты переехали в IDE [18][19].
- **Смена агента — обычный шаг, а не миграция.** Вендоры постоянно обгоняют друг друга [9].
- **Модель внимания.** На экране одна задача, то есть одна сессия агента. Уведомления зовут к задаче, которой нужен
  человек [9].
- **Совместная работа начинается с постановки задачи.** Команда уточняет и согласует задачу до того, как подключается
  агент [9].

### Почему Fleet стал агентным продуктом (декабрь 2025)

- Работа, отданная агенту, асинхронна и возвращает целые patches. Это другой цикл, чем цикл IDE с мгновенной обратной
  связью, синхронным управлением и одним локальным состоянием [7].
- Агентному циклу нужны структурированная постановка задачи, сборка контекста, несколько асинхронных запусков,
  изолированное выполнение и review в первую очередь. Внутри редактора это смотрелось бы разрозненно [7].
- Ещё один AI-редактор не выделился бы на рынке AI-форков VS Code [7].

### «Система продуктов» (2026-09-22)

- **Масштаб.** JetBrains расширяет фокус с рабочего места одного разработчика на всю систему, где агентную работу
  запускают, выполняют, координируют, проверяют и контролируют. IDE остаётся важной, но разработка больше не помещается
  в одно окно [17].
- **Multi-vendor — базовый принцип.** Ни одна модель или агент не подходит для всего, рейтинги меняются каждые несколько
  месяцев. Ставка на одного AI-вендора — многолетнее обязательство на рынке, который меняется каждый квартал. JetBrains
  делает Junie, но не требует его. Ценность — над моделями: общий контекст, один набор политик, один учёт затрат и
  запись о том, что произошло [17].
- **Узкое место сместилось.** Трудно не написать изменение, а понять, проверить его и отвечать за него. Опаснее всего
  почти правильный код. Работу можно делегировать, ответственность — нет [17].
- **Детерминированный code intelligence.** Он делает агентов дешевле и точнее: им не нужно заново открывать то, что уже
  известно о коде, и это работает для любой модели [17]. Пример, опубликованный JetBrains: Netflix подключил headless
  code intelligence IntelliJ к Claude Code и Codex. Агенты обычно были на 20–30% эффективнее по токенам и времени, в
  лучшем случае — примерно на 65% (оценка июля–августа 2026) [22].
- **Политика выпусков.** Rolling releases с явными метками: «можно пользоваться», «preview», «направление». Будущие
  продукты не называют, пока не подтверждены их scope и доступность [17].
- **Данные, на которые ссылается JetBrains.** Опрос 11 000 разработчиков в январе 2026: 90% используют AI на работе,
  22% — coding-агентов, 66% компаний планируют внедрить агентов за 12 месяцев, не больше 13% используют AI на всём
  цикле разработки [10]. Отчёт Atlassian: 49% разработчиков тратят 4 и больше часов в неделю на review результатов AI
  [31].

### Air in IDEs (октябрь–ноябрь 2026)

- **Урок.** Агентов сначала встроили в чат AI Assistant. Вывод: несколько задач одновременно — принципиально не то же
  самое, что разговор [19].
- **Тезис.** Агентная разработка становится нормой. IDE, которая держит агентов на расстоянии, потеряет значение. При
  этом IDE становится важнее: трудная часть — проверить результат и отвечать за него, а это работа IDE [19].
- **Три принципа** [19]: приносите своих агентов; интеллект IDE — и человеку, и агенту; agentic-first UX, где сессия —
  единица работы и все сессии видны в одном месте.
- **Канал, а не AI-провайдер.** Plugin ставится без агентов, ничего не уходит с машины до входа. При сторонней
  подписке данные идут прямо провайдеру, не через JetBrains [19][33:air-in-ides-overview].
- **Эссе «Why We Still Need an IDE».** Агент и инженер работают с одними инструментами, а за то, что уходит в
  production, отвечает инженер [23].

### Уровень команды (Air Teams)

- **Что показало исследование клиентов** [20]: личный выигрыш реален, но неравномерен; на уровне команды он
  застревает. Три повторяющиеся проблемы: настройки агентов не общие; реализация подешевела, а review — нет;
  самодельная автоматизация (например, webhook-бот в Docker) требует сопровождения.
- **Ответы Air Teams:**
  - окружения, инструкции, инструменты и процессы настраиваются один раз и переиспользуются командой; агент работает
    настолько хорошо, насколько позволяет его окружение [18][33:what-is-air-teams];
  - automations — общие активы команды [18];
  - агенты делают работу, решения остаются за командой: агент коммитит только в свою ветку задачи, PR открывает и
    мержит человек [18][33:what-is-air-teams];
  - полная история чата и вызовов инструментов хранится; шумный вывод агента считается проблемой инструкций, которую
    надо исправить [18][33:what-is-air-teams].
- **Второй урок.** Разработчикам не нужно ещё одно отдельное приложение. Агенты должны жить там, где разработчик уже
  работает [18].

### Контроль и стоимость

- **Агент как новый сотрудник** [11]: автономия выдаётся по шагам, с узкими областями и жёсткими запретами; audit trail
  — кто запустил действие, зачем, что затронуто, что изменилось, нарушена ли политика, сколько стоило; checkpoints и
  оценка риска вместо одобрения всего подряд или подписи под каждым действием; ограниченные credentials. Контроль —
  продуктовое решение, а не надстройка.
- **Свобода инструментов вместо одного стандарта.** JetBrains не ограничила своим разработчикам выбор AI-инструментов,
  потому что лучший набор меняется каждую неделю. Вместо этого весь трафик идёт через один routing layer с бюджетами
  credits [15].
- **Цены.** Прозрачные, без скрытых сборов, без сильно субсидированных пакетов и без proxy-цен, которые потом вырастут
  [13].

### Открытость

- ACP разработан вместе с Zed как открытый протокол между редакторами и агентами, по образцу LSP. Агенты должны быть
  переносимыми. JetBrains поддержит и другие протоколы, если рынок их примет. GitHub AgentHQ JetBrains описывает как
  платформу управления, привязанную к GitHub, а ACP — как открытый протокол [8].
- Copilot работает в Air через свой официальный CLI по ACP [27].

### Ключевые понятия

- **Сессия** — разговор с агентом, приложенный контекст и запущенный процесс агента [33:air-in-ides-key-concepts].
- **Поверхность (surface)** — Chat (структурированный интерфейс ACP-агента) или Terminal (CLI-агент во вкладке
  редактора) [33:air-in-ides-key-concepts].
- **Источник авторизации** — вход агента, JetBrains AI или настроенный провайдер [33:air-in-ides-key-concepts].
- **Preset, Session folder, Code Notes** — сохранённая комбинация агента и модели; папка на единицу работы с
  метаданными; построчные заметки агенту [33:air-in-ides-presets][33:air-in-ides-manage-sessions][33:air-in-ides-review-changes].
- **Cloud task, cloud environment, snapshot, task branch** — задача в облаке; Docker-контейнер на VM; сохранённый диск
  для быстрого старта; ветка, куда агент пушит после каждого хода [33:tasks][33:configure-environments].
- **Automation = инструкции + окружение + инструменты + trigger.** Trigger — условие старта, ветка и правило обработки
  изменений [33:automations][33:automation-triggers].
- **Project** — участники и роли, окружения, connectors, поставщик секретов, service account и credits проекта
  [33:projects].
- **AI credits, AI seats, AI policies.** Одна валюта для моделей, вычислений, индексации и хранения; оплата за
  пользователя; политики над principals — пользователями, группами, service accounts [33:about-air][33:plans-and-pricing].
- **Передача между частями.** Сессию из IDE можно передать в облачное окружение команды, а результат automation —
  забрать в IDE [33:about-air].
- **Словарь desktop-приложения, выведенный из оборота:** Task = сессия агента; задачи Local, Worktree и Docker; Plan
  mode с Markdown-планами; `.air/worktree.json` и `.air/docker.json`; `acp.json`; Proposed Change; Agent Review;
  Auto-commit; Pinned tasks [9][3].

### Позиционирование

- **Против инструментов одного вендора.** Страница Air in IDEs сравнивает Air с Cursor, Claude Code, Codex Desktop,
  GitHub Copilot и VS Code. Заявленные преимущества: агенты разных вендоров рядом; свои подписки без плана JetBrains для
  локальных сессий; review с diff, inspections и построчными комментариями JetBrains; параллельные агенты в сессиях или
  worktree [2].
- **Против AI-first редакторов.** Опыт Fleet показал, что ещё один AI-редактор не выделится [7].
- **Code intelligence для агентов.** Через MCP server IDE и встроенные skills [31]. Есть headless Java language server
  для Air — «IntelliJ Server Air» [4][14].
- **Одна система для человека, команды и организации, включая сторонних агентов.** Air Gateway пропускает Claude Code,
  Codex, Gemini CLI, Junie CLI, Pi и Copilot через аккаунты, credits и политики JetBrains [33:cli-about][33:about-air].
- **Изоляция.** Локальные worktree прямо названы не security sandbox [2]. Облачная задача получает новую недоверенную
  VM [21].

## Как это устроено внутри

Код закрыт. Сведения взяты из документации, release notes, списков библиотек и публичного трекера YouTrack, где есть
логи и разборы сотрудников. Ссылки вида AIR-6842 и IJAI-6125 — номера задач в трекерах desktop-приложения и plugin.

### Компоненты и стек

- **Desktop-приложение** — приложение на Kotlin/JVM на платформе Fleet. Логи показывают launcher `fleet.dock` на
  JetBrains Runtime 21 [40:AIR-4415]. UI — слой `fleet.noria.ui` [40:AIR-6837]. Пакеты в артефактах и логах называются
  `fleet.*` [5][40:AIR-4415].
- **Библиотеки приложения** [5]: ACP Kotlin SDK 0.25; MCP Kotlin SDK 0.15 (client и server); фреймворк агентов Koog
  0.7.2; Ktor server с server-sent events и WebSockets; docker-java; alacritty_terminal; tantivy и ripgrep (поиск);
  kotlin-lsp, pyright/basedpyright, clangd, typescript-language-server; npm-пакеты `@anthropic-ai/claude-code` и
  `@zed-industries/codex-acp`. Между первой и последней сборкой список вырос с 259 до 559 записей. Зачем Air использовал
  Koog — не подтверждено.
- **`fsdaemon`** — нативный вспомогательный процесс приложения. Лежит в
  `~/.cache/JetBrains/Air/downloaded-code-cache/<hash>/fsdaemon` и получает workspaces через stdin. Выполняет git и
  следит за файлами. Один пользователь насчитал у него около 519 тыс. inotify watches [40:AIR-5694]. Через этот процесс
  проходит разбор deadlock в git [40:AIR-6953].
- **ACPServer** жил в процессе «Air Workspace». В августе–сентябре 2026 команда выносила его в отдельный модуль «Agent
  Driver», который не зависит от reactive database (базы, рассылающей изменения подписчикам) [40:AIR-6809]. Отсюда
  вывод, что workspace хранил состояние в такой базе; это вывод, не факт.
- **Air in IDEs** — IntelliJ plugin `com.intellij.air` [6]. Агенты работают на локальной машине или на backend при
  Remote Development [31].
- **Air Teams** — VM на задачу, Docker-контейнер внутри, egress proxy [21][33:configure-environments]. Доступ к
  репозиториям — через GitHub App «JetBrains Air» [33:source-control]. Входящие webhooks приходят на
  `api.jetbrains.cloud/air-automations-gateway/...` [33:automation-triggers].
- **Редактор Air Teams**, по данным трекера, — frontend Fleet, скомпилированный в WebAssembly (сборка
  `fleet-wasm-<v>.zip` внутри «airweb»). Он работает с контейнером из образа «air-workspace», который запускает сервис
  «agent-spawner» [40:AIR-6837][40:AIR-4844]. Верно ли это после августа 2026 — не подтверждено.
- **Air Gateway** — один бинарный файл и локальный reverse proxy [34:cli-in-depth].

### Цикл агента

- Своего агентного цикла и планировщика у Air нет: он запускает чужих агентов. ACP соединяет IDE с полным harness
  агента. Планирование, инструменты, выбор модели и наблюдаемость остаются внутри агента [17].
- Единица выполнения — сессия [33:air-in-ides-key-concepts]. Обновление агента не заменяет процесс работающей сессии
  [33:air-in-ides-manage-agents].
- Смена модели идёт через ACP-метод `session/set_config_option`. До июля 2026 Air слал нестандартный
  `session/set_model`. Агенты, которые следуют спецификации, его отвергали, и сессия на модели с исчерпанным rate limit
  не могла с неё уйти. Исправлено 2026-07-13 [40:AIR-6168].
- По release notes plugin процессы агентов переиспользуются, окружение login shell кэшируется, а ошибку refresh, которая
  порождала сотни процессов агентов, исправили [6].
- Junie Eco mode: выбранная модель планирует, рутинные шаги выполняет дешёвая модель-компаньон. Платятся обе
  [33:air-in-ides-interact-with-the-agent][26].
- Скрытые служебные сессии: commit message пишет фоновая сессия, по умолчанию Junie на модели Lite с низким effort;
  конфликт merge открывает сессию только с конфликтующими файлами; папку сессий может создать агент
  [33:air-in-ides-review-changes][33:air-in-ides-manage-sessions].
- Настоящий orchestrator есть только у Air Mate. Он построен на Grok и выбирает модели OpenAI, Google или Anthropic по
  сложности задачи [33:air-mate].

### Планирование

- Планировщика, разбиения задач и backlog на уровне Air нет. Планирование — режим агента. У Claude есть Plan mode, у
  Codex в Air Teams своего режима планирования нет [33:permission-modes]. Меню режимов plugin показывает режимы агента,
  например Plan или Goal [33:air-in-ides-interact-with-the-agent]. Preset может стартовать в plan mode со скрытыми
  инструкциями [33:air-in-ides-presets].
- Desktop-приложение сохраняло план в `.air/plans/<name>.plan.md`. Кнопка «Implement» запускала новую задачу (например,
  в новом worktree) и применяла файл плана через `git apply` [3][40:AIR-5121].
- Многошаговые конвейеры есть только в облаке — это цепочки automations. Следующий шаг получает summary, ссылки и имя
  запушенной ветки текстом, а не код [33:chained-automations].
- Сессии не могут передавать друг другу сообщения или результаты. В открытой задаче AIR-7175 пользователи пишут, что
  копируют текст между сессиями руками [40:AIR-7175].

### Параллельность и координация

- Локально много сессий идут одновременно, по разным проектам. Дочерние sub-agent сессии вложены в родительскую
  [33:air-in-ides-manage-sessions]. Окно с несколькими проектами в приложении появилось в августе 2026 [16].
- Своя рабочая копия на сессию — по желанию: старт или fork во временный worktree, либо fork в тот же workspace с
  предупреждением о конфликтах правок [33:air-in-ides-start-a-session].
- Слияние параллельной работы — вручную: коммит в worktree, потом cherry-pick в ветку, выбранную в основном проекте
  [33:air-in-ides-start-a-session][31].
- В облаке у каждой задачи своё окружение, задач можно запускать сколько угодно [33:run-tasks-in-cloud].
- Лимит одновременных сессий и scheduler для локальных и облачных сессий не описаны (не подтверждено).

### Изоляция

- **Карта JetBrains** [21]: локальный workspace — без изоляции, агент может выйти за рабочую папку; git worktree —
  частичная изоляция; SSH, Docker и облако — изолированы. Песочница уровня ОС (landrun, sandbox-exec, Sandboxie) —
  забота клиента, который запускает агента.
- **Worktree в plugin.** Удаление worktree теряет незакоммиченные правки и удаляет его ветку
  [33:air-in-ides-settings][6].
- **Локальный Docker был только в desktop-приложении** [3][5]: docker-java; `.air/docker.json` и `.air/worktree.json`
  с переменными и setup scripts до старта агента; cleanup script перед удалением worktree-задачи; на Windows — Docker
  Desktop. Если setup окружения падал, задача помечалась failed [40:AIR-3137]. Пользователь писал, что в контейнере нет
  toolchains, а у пользователя контейнера нет sudo [40:AIR-3189]. Совпадал ли этот образ с облачным «air-workspace» —
  не подтверждено. Облачный образ получил sudo без пароля в октябре 2026 [40:AIR-7190].
- **Облако** [21]: новая VM на каждую задачу, microVM — «coming soon». Агент работает в Docker-контейнере внутри VM. VM
  считается недоверенной и не переиспользуется. Весь трафик идёт через proxy внутри VM. Секреты хранятся зашифрованными
  и передаются как переменные окружения; общие секреты можно использовать, но не видно товарищам по команде. Репозиторий
  — shallow clone [33:tasks]. Задача действует с правами разработчика на репозиторий через GitHub App
  [33:source-control].
- **Противоречие о сети по умолчанию.** Документация (2026-10-23): облачное окружение по умолчанию имеет доступ в
  интернет [33:environment-network-access]. Пост о sandboxing (2026-10-14): proxy по умолчанию пускает только домены
  систем контроля версий и пакетов [21].
- **Противоречие о чистом старте.** Пост о Copilot: в следующую задачу ничего не переносится [27]. Документация:
  snapshots диска переиспользуются следующими задачами на том же репозитории, они личные и истекают [33:tasks].
- **BYOC на AWS.** Оператор опрашивает Console о запланированной работе агентов, управляет EC2 и подписывает
  короткоживущие tokens закрытым ключом, который не покидает аккаунт AWS клиента [33:cloud-providers].

### Состояние и память

- **Cloud tasks** [33:run-tasks-in-cloud][33:tasks][33:prompt-queue]: коммит и push в ветку задачи после каждого хода
  агента; незакоммиченные ручные правки уходят в следующий коммит агента; 75 минут простоя — suspend, 24 часа —
  archive; resume восстанавливает диск, но не процессы; очередь prompt-ов переживает перезагрузку страницы.
- **Plugin:**
  - сессии и состояния Read и Needs input восстанавливаются после рестарта IDE [6];
  - plugin читает историю сессий самих агентов (Claude, Codex, Junie). Историю хранит агент, а у plugin есть свои кэши
    сессий; старые кэши он удаляет, не трогая историю агента [6];
  - какая сессия меняла какой файл, восстанавливается из истории сессий [33:air-in-ides-settings];
  - облачные запуски идут при закрытой IDE и переподключаются при её открытии [33:air-in-ides-start-a-session];
  - есть ли в plugin checkpoints — не подтверждено.
- **Git checkpoints desktop-приложения:**
  - checkpoint снимался в начале каждого запроса агенту, и запрос его ждал [40:AIR-6724];
  - механизм: временный индекс по выводу `git status --untracked-files=all`, затем
    `git update-index --add --remove --stdin` и `write-tree` [40:AIR-6724][40:AIR-6840];
  - refs checkpoints держат объекты в `.git/objects` пользователя, очистки нет [40:AIR-6840];
  - на репозитории в 1,35 млн файлов сохранение стоило 40–130 секунд. Исправление от 2026-08-31 — постоянный кэш-индекс
    на worktree плюс fsmonitor, около 3 секунд. На macOS git работает с приоритетом utility (`taskpolicy -c utility`)
    [40:AIR-6724];
  - сохранение могло зависнуть навсегда: timeout не было, а `Git.exec` писал stdin до чтения stderr [40:AIR-6953];
  - checkpoints выключаются настройкой `local.history.checkpoints.enabled` [40:AIR-6953];
  - восстановление snapshot и undo из prompt работали с ошибками [40:AIR-5079][40:AIR-6538].
- **Инструкции и контекст.** Своего формата инструкций нет: агенты читают CLAUDE.md, `.claude/`, AGENTS.md и похожие
  файлы [33:project-instructions]. Индикатор context window подсвечивается выше 80% и показывает ошибку выше 99%;
  разгрузка — командами агента `/compact` и `/clear` [33:context-window][33:air-in-ides-interact-with-the-agent].
  Меньший контекст тратит меньше credits на перечитывание истории [33:ai-credits].
- **Air Context.** Session hooks обновляют индекс [33:context-agent-integrations]. Отдельные hooks, которые следят за
  вызовами инструментов, по умолчанию не ставятся. Они хранят состояние сессии в
  `/tmp/claude-context-hook-<session>.json` и могут отклонить вызов инструмента, например широкий локальный поиск до
  первого семантического [33:context-agent-integrations][36].
- **Air Mate** хранит постоянный диск и сжатое состояние разговора между запусками [33:air-mate].
- Хранилище памяти между сессиями для plugin не описано (не подтверждено).

### Проверка качества

- **Review человеком** — Code Notes: scope от локальных изменений до запушенных коммитов, построчные заметки, отправка
  агенту. В review одна сессия за раз. Заметки доходят и до терминальных агентов
  [33:air-in-ides-review-changes][31].
- **Review агентом.** В приложении — Agent Review: один агент проверяет работу другого, модель выбирает пользователь
  [3][16]. В Air Teams — команда агента `/review` [33:review-changes] и шаблон automation для code review [18].
- **Инструменты проверки IDE** доступны и человеку, и агенту: inspections, run configurations, debugger, работа с базами
  данных [31].
- **Встроенного шага тестов или проверочного запуска нет.** В облаке пользователь проверяет результат в терминале или
  просит агента запустить тесты [33:review-changes]. CI подключается только как trigger на падение workflow или job
  [33:automation-triggers]. Показ статуса CI нигде не описан (не подтверждено).
- **Merge делают люди.** Правки агента попадают только в ветки задач, PR открывает и мержит человек
  [33:what-is-air-teams].

### Восстановление после сбоев

- **Cloud tasks** [33:troubleshoot-cloud-tasks]: состояние Problem; временные сбои предлагается повторять вручную; логи
  скачиваются в ZIP; упавшая задача сохраняет старую конфигурацию окружения.
- **Automations:** Rerun повторяет исходный вход с текущей конфигурацией [33:automation-run-results]; сбой шага
  останавливает цепочку [33:chained-automations]; webhook сбоя несёт код ошибки, например `timeout`
  [33:automation-notifications].
- **Air Gateway** [34:cli-in-depth]: один повтор после ответа 401 или 403 от upstream с обновлением token; timeout
  запроса — 8 минут; tokens, которые истекают в ближайшие 4 часа, обновляются, проверка раз в 2 часа.
- **Локальные сессии.** Release notes упоминают лучшее восстановление после медленного старта и разрыва соединения, без
  деталей [6].
- **Известные пробелы:**
  - лимит исчерпан во время Review with Agent: сообщение «Agent execution finished with an error» и одна кнопка Retry.
    Нет резервной модели и нет ожидания сброса лимита с продолжением. Задача AIR-6842 открыта с 2026-08-17
    [40:AIR-6842];
  - квота Claude кончилась — индикации нет, spinners продолжают крутиться (AIR-3928, открыта) [40:AIR-3928];
  - ошибка смены модели держала сессии на модели с исчерпанным rate limit; исправлено в июле 2026 [40:AIR-6168];
  - потеря сети: Claude Agent показывает «Reconnecting to Claude, attempt 1 of 10» и остаётся в Running; Codex через 12
    минут всё ещё работал без ошибки; обход — кнопка Stop (IJAI-6125, 2026-11-09) [41:IJAI-6125];
  - сохранение checkpoint могло зависнуть без timeout [40:AIR-6953][40:AIR-6840].

### Лимиты и стоимость

- **Четыре способа оплаты агента** [33:air-in-ides-authorization]: вход самого агента (его подписка); credits JetBrains
  AI; бесплатный Junie Lite; свой ключ (BYOK) Anthropic, OpenAI, Gemini или OpenRouter. На запуске приложение сначала
  тратило ключи пользователя, а остаток добирало подпиской JetBrains [9].
- **Credits JetBrains AI** [33:ai-credit-limits][33:ai-credits]: лимиты месячные на пользователя или service account и
  сбрасываются первого числа; пустой общий пул останавливает всех; BYOK в лимиты не входит. При исчерпании месячного
  лимита функции JetBrains AI стоят до первого числа следующего месяца.
- **Счётчики.** AI Usage view — квота, остаток credits, дата сброса [6]. Claude usage в status bar
  [33:air-in-ides-settings]. Стоимость сессии — точная, примерная или отсутствует, в зависимости от агента или
  провайдера [33:air-in-ides-manage-sessions]. В приложении были виджет квоты и виджет контекста Codex [3]. Такой же вид
  для подписок Codex, Claude и Copilot — «в работе» [31]. Запрос полосы лимита агента открыт [40:AIR-3929]. Балансы
  подписок не складываются [2]. В Gateway — `central limit` [34].
- **Copilot.** Air не видит остаток credits Copilot и не предупреждает: запуски просто начинают падать [27].
- **Ожидания сброса лимита и продолжения нет** ни в документации, ни в трекере, а трекер сам называет это пробелом
  [40:AIR-6842]. Это значит «не найдено», а не доказанное отсутствие.
- **Что есть для работы без человека:** cloud tasks идут при закрытом ноутбуке [18]; облачная очередь prompt-ов сама
  отправляет запросы [33:prompt-queue]; schedule и interval запускают новые запуски [33:automation-triggers]; «Prevent
  System Sleep While Agent is Working» [33:air-in-ides-manage-sessions].
- **Где это рвётся:** простаивающая задача засыпает через 75 минут и просыпается только по запросу [33:tasks];
  расписание молчит, когда истекла сессия автора [33:troubleshoot-automations]; цепочка идёт дальше только при успехе
  [33:chained-automations]; упавший запуск перезапускают вручную [33:automation-run-results].
- **Как тратить меньше:** Junie Eco mode, лёгкие модели для commit messages, Air Context, задачи заметно меньше context
  window [33:air-in-ides-interact-with-the-agent][33:air-in-ides-review-changes][33:context-indexing][33:ai-credits].
- **Организация:** Analytics API с endpoints о достижении лимитов [33:analytics-api-v2]; Session explorer с токенами и
  credits по сессиям [33:session-explorer]; автопокупка credits [33:changelog].

### Права и безопасность

- **Permission modes у каждого агента свои**; режим меняется по ходу задачи [33:permission-modes]. Приложение
  запоминало режим для агента и показывало вкладку Proposed Change перед выдачей разрешения [3]. Единой политики
  auto-approve нет (AIR-4789, открыта) [40:AIR-4789].
- **Политики организации:** allowlists агентов, провайдеров, моделей и MCP servers; переключатели cloud tasks и
  сторонних MCP connectors [33:ai-agents][33:ai-policies-configure]. Файл `jcp.json` на машине (`allowAir`,
  `organizationId`) применяет политику и никогда не откатывается на личный доступ
  [33:air-in-ides-manage-user-machines].
- **Облако:** egress proxy и режимы доменов, шифрованные секреты, права пользователя на репозиторий, service accounts
  проекта для automations [21][33:environment-network-access][33:source-control][33:projects].
- **Исключения Air Mate** [33:air-mate]: командный Air Mate действует от service account проекта, поэтому любой в его
  канале Slack получает этот доступ. В early access он игнорирует ограничения моделей из Governance.
- **Куда идут данные.** При сторонней подписке — прямо провайдеру, не через JetBrains [19][33:air-in-ides-overview].
  Air Gateway пропускает весь трафик через JetBrains [34:cli-about].
- **Где обязательно нужен человек:** авторизация агента [33:air-in-ides-authorization]; карточки разрешений «Task needs
  your input» и одобрение плана [33:permission-modes]; формы вопросов [33:air-in-ides-interact-with-the-agent]; review
  через Code Notes [33:air-in-ides-review-changes]; cherry-pick результатов worktree [33:air-in-ides-start-a-session];
  открытие и merge PR [33:what-is-air-teams]; шаги «Automations done by a person» — без timeout и без уведомления, когда
  они начинают ждать [33:person-automations].

### Наблюдаемость

- **Список сессий:** счётчики статусов, звуки, Caps Lock, запрет сна, поиск, список исходящих коммитов
  [33:air-in-ides-manage-sessions][33:air-in-ides-settings].
- **Запуски automations:** полная запись чата с рассуждениями и каждым вызовом инструмента; webhooks успеха и сбоя,
  есть формат для Slack [33:automation-run-results][33:automation-notifications].
- **Governance:** Session explorer не в реальном времени и Analytics API [33:session-explorer][33:analytics-api-v2].
- **Логи приложения** записывали смену состояния задачи (Launching → UserInputRequired → Finished) с типом запуска,
  агентом, моделью и permission mode [40:AIR-5121].

## Что говорят пользователи

Ограничения: web search был недоступен. Reddit отвечал ошибками 403 и 429; прочитан только текст поста JetBrains, 261
комментарий — нет [49]. X, YouTube и сторонние обзоры не охвачены. Подсчёты по ключевым словам ниже примерные.

### Где и сколько

| Площадка | Что | Объём |
|---|---|---|
| Hacker News | Анонс Air на air.dev, 2025-12-03 | 74 очка, 64 комментария [42] |
| Hacker News | «JetBrains cancels Fleet», 2025-12-09 | 114 очков, около 75 комментариев [43] |
| Hacker News | Пост о public preview, 2026-03-09 | 26 очков, 1 комментарий [44] |
| Hacker News | Пост о семействе Air, 2026-09-22 | 75 очков, 123 комментария; около 19 — от сотрудников JetBrains [46] |
| Hacker News | Выход plugin, 2026-11-11 | 2 очка, 3 комментария [48] |
| Reddit r/Jetbrains | Пост сотрудников JetBrains, 2026-09-22 | 261 комментарий, не прочитаны [49] |
| YouTrack AIR (приложение) | Главный запрос | 94 голоса, 40 комментариев [40:AIR-4152] |
| YouTrack IJAI (plugin) | Главный запрос | 28 голосов [41] |
| JetBrains Marketplace | Plugin «Air» (раньше «Air Alpha») | 400 476 загрузок; 69 оценок: 27×5★, 7×4★, 6×3★, 9×2★, 20×1★ [6] |

- Простое среднее этих 69 оценок — около 3,2. Поле API `meanRating` даёт 4,07; как оно считается, неизвестно [6].
- 100 последних отзывов (2026-09-04 … 2026-11-13): 24×1★, 13×2★, 11×3★, 8×4★, 19×5★ и 25 без звёзд [6].

### Главная жалоба: подписка Claude не работает там, где её ждут

- **Самый популярный запрос в обоих трекерах.** В трекере приложения — вход с аккаунтом Claude Pro или Max вместо API
  key: 94 голоса, 40 комментариев, открыт с 2026-03-09 [40:AIR-4152]. В трекере plugin — 26 голосов [41:IJAI-2501].
  Launch post с самого начала исключал подписки Anthropic [9].
- **Объяснение JetBrains.** Условия Anthropic Agent SDK запрещают третьим сторонам предлагать вход через claude.ai без
  одобрения; JetBrains вела переговоры [40:AIR-4152]. На Hacker News два сотрудника JetBrains написали, что упёрлись в
  жёсткий отказ Anthropic и исключения не получили [46·c49800619][46·c49800655].
- **Реакция на HN 2026-09-22.** Один комментатор, процитировав экран настройки, написал, что Air мёртв при рождении
  [46·c49802503]. Другие: проваливается на первом же шаге [46·c49803240]; скорее всего обречён [46·c49803263]; без
  лимита своего плана — не вариант [46·c49886087]. Тот, кто ждал от Air объединения Claude и OpenAI, не увидел
  преимуществ перед приложением Codex [46·c49799662].
- **Как пользователи объясняют причину.** Air заменил обёртку над CLI Claude Code на ACP-агента на базе Agent SDK, а
  изменение под JetBrains добавило опцию, которая прячет собственный вход Claude Code [40:AIR-4152]. Такое изменение
  есть: PR #350 в claude-agent-acp «Authentication adjustments for JB integration», merged 2026-03-03, с опцией скрыть
  вход Claude Code «for compliance» [37].
- **Куда показывают пользователи.** Инструменты, которые оборачивают официальный CLI и работают с подпиской: cmux,
  emdash, T3 Code, Polyscope, Solo, superset-sh, Zed [40:AIR-4152]. Один комментатор 2026-04-25 перешёл на Polyscope
  [40:AIR-4152].
- **История, которую рассказывают пользователи, а JetBrains не подтвердила.** В декабре 2025 в раннем preview было
  действие «log in to Claude» [40:AIR-3201]. В августе 2026 сборка public preview ненадолго разрешила подписку, потом
  функцию, страницу анонса и пост в X убрали за несколько дней [40:AIR-6913][40:AIR-4152, комментарий 2026-09-19].
  Сотрудники в ответ только повторили политику Anthropic [40:AIR-6913]. Release notes подтверждают, что строка о
  подписке появилась 2026-08-19 и исчезла 2026-08-21 [3].
- **Частичное решение — только в plugin.** С 2026-10-14 Air in IDEs запускает сам Claude Code в полноэкранной вкладке
  терминала, где подписка работает [41:IJAI-2501][19]. Чат Air по-прежнему требует JetBrains AI или API key Anthropic
  [31]. Отзывы на Marketplace всё равно жалуются, что подписка не работает в чате, или пишут, что раз Zed умеет, то
  сможет и JetBrains [6, отзывы 2026-10-14, 2026-10-20, 2026-10-26, 2026-10-29]. Об этом пишут около 11 недавних
  отзывов, все на 3★ и ниже [6].
- **Спорная политика.** Страница поддержки Anthropic говорит, что Agent SDK и `claude -p` по-прежнему считаются в
  лимитах подписки; запланированное изменение биллинга приостановлено 2026-06-15 [38]. Zed решил задачу через «terminal
  threads» — они запускают официальный CLI на подписке [39].
- **Обходы, которыми делятся.** Указать в `acp.json` обёртку claude-code-acp от Zed [46·c49835702][46·c49908910];
  соответствует ли это условиям Anthropic — не подтверждено. 2026-11-02 пользователь написал, что OpenCode выпустил
  поддержку подписки с одобрения Anthropic [41:IJAI-2501][40:AIR-7551]; одобрение не подтверждено.

### Главные запросы в трекере приложения (на 2026-11-13)

- **WSL в Windows: 60 голосов, открыт** [40:AIR-5811]. Во Fleet это было. Без WSL Air для некоторых — просто просмотр
  Markdown. Для сравнения приводят приложение Codex: его агент работает внутри WSL, а клиент подключается из Windows
  [40:AIR-5811, комментарии 2026-07-22, 2026-08-18].
- **AWS Bedrock: 59 голосов, открыт** [40:AIR-4149]. Для компаний это блокер: без него Air нельзя даже попробовать.
  Обход от 2026-09-23 — конфигурация ACP с переменной Bedrock для Claude Code [40:AIR-4149].
- **Свой base URL и заголовки для proxy и шлюзов: 45 голосов, открыт** [40:AIR-4541]. Обход через правку приватного
  `config.toml` Codex перестал работать в сборке 262.132 [40:AIR-4541, комментарий 2026-08-18]. Пользователи
  возражают, что Air вообще требует входа до начала работы [40:AIR-4541, комментарии 2026-05-14, 2026-07-02]. Смежные
  запросы: свой LLM proxy — 27 голосов, локальные LLM — 27, Vertex — 13, ошибка аутентификации proxy с Junie — 25 [40].
- **Падения при старте на Windows: 54 и 48 голосов** [40:AIR-6896][40]. Зависание на шаге сохранения checkpoint: 14
  голосов, открыто; его называют полностью неработоспособным в сборках 262.132–262.834 [40:AIR-6469].
- **Linux: 42 голоса, выпущен 2026-06-03** [40:AIR-2399]. В первый день хвалили вставку картинок в чат, кликабельные
  ссылки на файлы, модель и настройки на задачу, видимый расход context window. Ругали неработающие сочетания клавиш,
  медленную прокрутку и запросы одобрения даже в режиме full access. Другие отметили восемь месяцев ожидания: за это
  время конкуренты обогнали Air [40:AIR-2399].
- **Несколько проектов в одном окне: 27 голосов.** 2026-03-11 сотрудники ответили, что этого нет в roadmap. Пользователи
  сравнивали с T3 Code, менеджером агентов Antigravity, Zed, приложением Codex и Codex monitor. Функцию выпустили в
  августе [40:AIR-4195][16]. Потом жаловались, что окно не видит существующие сессии Junie и Junie CLI [40:AIR-4195].
- **Remote development: 25 голосов, «Planned».** Во Fleet было. Сценарии: GPU, количественные финансы, большие
  биологические данные на Linux-серверах. Один пользователь попросил вернуть Fleet. Другой не хочет запускать агентов
  на своей рабочей машине и не хочет переписывать devcontainers в формат Docker-конфигурации Air [40:AIR-3540,
  комментарий 2026-09-25].
- **Перемещаемые панели: 24 голоса.** Давним пользователям IDE фиксированная раскладка чужда. Один комментатор
  пользуется IDE JetBrains с 2005 года, не открывал их с появления Codex и всё ещё хочет, чтобы Air получился
  [40:AIR-3538].
- **Полоса расхода лимита агента: 12 голосов** [40:AIR-3929]. Вход в несколько аккаунтов Claude ради большего лимита: 5
  голосов [40].
- **Обмен сообщениями и результатами между сессиями: 9 голосов** [40:AIR-7175]. Позже попросили, чтобы Codex работал
  orchestrator-ом и запускал сессии Claude Code и OpenCode, как делегирование задач в T3 Code [40:AIR-7175].
- **Мелкие запросы** [40]: git уровня IntelliJ (4 голоса), Run и Debug (4), удобный доступ к папкам worktree (6),
  удалённое управление локальными задачами (5), Homebrew cask (8), vim keybindings (9).
- **Ранний Docker (декабрь 2025).** В образе не было build tools, например .NET, и не было sudo. Просили devcontainers
  или свой Dockerfile [40:AIR-3189].
- **Вход Gemini** сломался около 2026-07-31: Gemini CLI объявили устаревшим в пользу Antigravity CLI. Исправления шли
  медленно; 2026-10-19 один пользователь всё ещё не мог войти [40:AIR-5394].

### Как приняли plugin (с сентября 2026)

- **Хвалят** [6]:
  - одно место, чтобы запускать и смотреть много сессий по разным проектам;
  - не нужно переключаться между приложением для агентов и редактором (WebStorm, отзыв 2026-10-04);
  - разрешение конфликтов merge (2026-10-28);
  - подписка Codex просто работает (2026-09-23);
  - worktree и review лучше, чем в Claude Code или приложении Codex, по мнению одного рецензента (2026-11-11);
  - быструю реакцию: несколько 5★ поставлены после исправления проблем (2026-10-01, 2026-10-19) и за ответ на отзывы
    в Reddit (2026-10-27).
- **Ругают** (темы 100 последних отзывов) [6]:
  - **Баги и «не работает» — около 26.** Не удалось запустить ни одной сессии; Codex после двух рестартов сообщил, что
    нет credits (2026-09-22). IDE падала примерно при 7 открытых агентах (2026-09-04). Сессии пропали при обновлении с
    2026.2 на 2026.3 (2026-11-08).
  - **Вытеснен AI Assistant — около 19.** Air спрятал AI Assistant и его генерацию commit messages. Задача об этом
    набрала 16 голосов; там же сообщение, что обновление PyCharm молча заменило рабочую настройку Codex [41:IJAI-3764].
    JetBrains держит AI Assistant до начала 2027 [31].
  - **Чаты только во вкладках редактора — около 12.** Главный запрос plugin (28 голосов) исправлен 2026-11-03. GA-пост
    называет tool window самым частым запросом [41:IJAI-2739][31].
  - **Встроен и не удаляется — около 8.** Никто об этом не просил (2026-11-05, 2026-11-12); AI-plugin-ы нельзя удалить
    (2026-11-09). Запрос администраторов исключить Air из корпоративных пакетов IDE — 10 голосов, открыт. Комментаторы
    называют это повтором старого спора о встроенном AI Assistant [41:IJAI-3469][47]. Единого выключателя всего AI нет
    [41:IJAI-4245].
  - **Стоимость.** Изменение в три строки съело больше половины квоты в 10 credits, быстрого отката нет (2026-10-18)
    [6]. Откат правок одного хода агента — открытый запрос [41].
  - **Нет sandbox — около 5.** В plugin есть Local, Worktree и Cloud, но нет Docker. Запрос — 19 голосов, открыт.
    Комментарии: sandbox — не опция; для одного без неё Air мёртв [41:IJAI-2118].
  - **Сессии.** Их нельзя удалить: Mark as Done только прячет (25 голосов) [41:IJAI-2625]. Переключение сессий убивает
    фоновую работу; статус и заголовок не совпадают с реальным состоянием; звуки уведомлений едва слышны (2026-11-11)
    [6]. Поддержка воспроизвела: Air закрывает терминальную сессию Claude Code через 60 секунд после ухода с экрана и
    убивает фоновый процесс; с Copilot то же самое [41:IJAI-6049]. Работающая сессия Claude Code заставила Rider
    запустить около 215 процессов `git worktree list` за 15 секунд; исправлено 2026-09-21 [41:IJAI-1624]. Запросы
    одобрения бывают невидимы после отмены хода агента [41:IJAI-5952].
  - **Слишком много AI-продуктов.** Junie, AI Assistant, AI Chat и Air путают [6]. На HN заметили, что это третий или
    четвёртый продукт JetBrains с именем Air [46·c49801710][46·c49800163]. Пост JetBrains в Reddit признаёт, что разницу
    между Junie и AI Assistant объяснили слишком поздно [49].
  - **«Просто plugin».** Рецензент не хочет десять экземпляров IDE по 2 GB, по одному на worktree. Он хочет отдельное
    приложение с git diff и агентами в вертикальных вкладках (2026-10-08) [6]. На HN ждали большего, чем plugin, и
    считают, что JetBrains опоздала [48]. Пользователи приложения спрашивают, будут ли исправления, откроют ли код и как
    перенести задачи [40:AIR-7488][40:AIR-7640].

### Темы Hacker News

- **Анонс, декабрь 2025** [42]:
  - Главная ветка сомневалась в параллельных агентах. Многим одного агента уже хватает, чтобы занять всё время на
    review; переключение контекста стоит дороже выгоды; нужны инструменты, ускоряющие review
    [42·c46140878][42·c46141428][42·c46141356]. Меньшинство разбивает работу на цепочки plan → implement → review
    [42·c46141149][42·c46141085].
  - Похвала: лучший конкурент Conductor на тот момент [42·c46141200]; лёгкость Fleet плюс агенты Junie [42·c46140823];
    интерес к одному протоколу и одному родительскому orchestrator-у для Claude, Codex и Gemini [42·c46141003].
  - Критика: ещё один интерфейс для параллельного Claude без сильных сторон JetBrains — debugger, test runner, diff и
    поиска по worktree, git IDE, тонкого auto-approve по папкам. Тот же комментатор хвалил действие «выделить и добавить
    в контекст» и доску статусов в стиле kanban [42·c46140912]. Ощущение ада из merge PR [42·c46141143]. Только Mac на
    старте [42·c46140236]. Делает ли JetBrains сам Air с помощью Air [42·c46140627]. Сначала почините IDE
    [42·c46141211].
  - В ветке о Fleet предупреждали, что отдельный агентный продукт повторит ошибку Fleet, и предлагали plugin-ы к IDE
    [43·c46206380]. JetBrains потом пришла именно к этому.
- **Сентябрь 2026** [46]:
  - Лояльные клиенты разделились. Одни почти не открывают IDE и не продлевают подписку [46·c49799747][46·c49799579].
    Другим IDE стала ценнее для review кода агентов в контексте [46·c49800049]. Кто-то держит Ghostty с Claude рядом с
    IntelliJ, по окну на проект [46·c49800116].
  - Боль worktree в IntelliJ: индексация зависает на новых worktree, git не даёт выбрать ветку, которая уже выбрана в
    другом worktree [46·c49799699]. Просят монитор агентов вроде herdr с умной работой с worktree [46·c49800839].
  - Стратегия: делать одну вещь очень хорошо, мультиплексоры — хорошая ставка [46·c49802542]; Air как мультиплексор в
    стиле CMUX/WMUX [46·c49821279]; советуют SoloTerm [46·c49799856]; сомнения в защищённости от Cursor и Antigravity
    [46·c49799974]; жалобы на закрытые экосистемы [46·c49799683].
  - Позитив: ставка на многих вендоров звучит разумно [46·c49800144]; «будущее редакторов кода», но git отстаёт от IDE
    [46·c49800094]; plugin Air Alpha годится, чтобы держать Claude CLI в окне IDE [46·c49808124]; OpenCode сам
    настроился как ACP server для Air [46·c49806338].
  - OpenAI-совместимые endpoints работали только в plugin, не в приложении [46·c49814043]. Один комментатор назвал
    многочисленные ответы сотрудников рекламой [46·c49886860].
- **Март 2026, ветка о Central** [45]: команда с длинными агентными процессами сама сделала event log с replay, чтобы
  отлаживать запуски, и спрашивала, даёт ли продукт такой.

### Почему приходят и почему уходят

- **Приходят:** все агенты и параллельные сессии в одном месте с diff и навигацией уровня JetBrains; свобода провайдеров
  через ACP, включая локальные модели через OpenCode или pi; работают планы Codex, Copilot и JetBrains AI; интерфейс
  приложения — для одного пользователя это любимый AI-интерфейс для кода [40:AIR-4152, комментарий 2026-03-31], для
  другого ничто иное не подходит под его процесс [40:AIR-7488].
- **Уходят:** подписка Claude — главная причина; подключение в компаниях — Bedrock, Vertex, шлюзы, proxy; WSL и remote
  development; стабильность на Windows и в сессиях; нет sandbox в plugin; принуждение к IDE; темп разработки ниже, чем у
  стартапов [40:AIR-4152, комментарий 2026-06-18][40:AIR-2399]; неясное будущее приложения.

### Конкуренты, которых называют пользователи

- **Оборачивают CLI Claude и работают с подпиской:** cmux, emdash, T3 Code, Polyscope, Solo/SoloTerm, superset-sh, Zed
  [40:AIR-4152][46].
- **Оркестраторы, мультиплексоры, менеджеры агентов:** Conductor [42]; herdr [46][6]; vibe-kanban [40:AIR-3540];
  Omnispect [42]; приложение Codex и Codex monitor [40:AIR-4195][46]; менеджер агентов Antigravity [40:AIR-4195]; окна
  агентов VS Code и Cursor [40:AIR-4195][48]; Warp для SSH с AI [40:AIR-3540].

### Как быстро JetBrains реагировала

| Запрос | Создан | Итог |
|---|---|---|
| Linux | 2025-10-07 | Выпущен 2026-06-03 [40:AIR-2399] |
| Свои агенты через ACP | 2026-02-12 | Tech preview 2026-06-15, закрыт 2026-09-11 [40:AIR-3779][14] |
| Несколько проектов в одном окне | 2026-03-10 | Сначала отказ, выпущено в августе [40:AIR-4195] |
| Подписка Claude (приложение) | 2026-03-09 | Открыт, 94 голоса [40:AIR-4152] |
| Bedrock, свой base URL, WSL | Март — июнь 2026 | Все открыты [40:AIR-4149][40:AIR-4541][40:AIR-5811] |
| Plugin: чат в tool window | 2026-09-28 | Исправлено 2026-11-03 [41:IJAI-2739] |
| Plugin: Docker-сессии; удаление сессий | Сентябрь 2026 | Открыты [41:IJAI-2118][41:IJAI-2625] |

## Направление развития

### Хронология за 12 месяцев

| Дата | Событие | Источник |
|---|---|---|
| 2025-10-07 | В трекере уже есть запрос версии для Linux: закрытый ранний preview работал | [40:AIR-2399] |
| 2025-12-01 | Первая сборка desktop-приложения (261.63.28, macOS) | [3] |
| 2025-12-03 | Анонс на air.dev | [42] |
| 2025-12-08 | Fleet закрыт; его команда делает агентную среду на платформе Fleet. В мае 2026 пост дополнили: Fleet превратился в Air | [7] |
| 2025-12-16 | Позиция JetBrains по ACP: не выбирать сторону против GitHub AgentHQ | [8] |
| 2026-02-22 | Вход с подпиской Claude убран, только оплата по API | [3] |
| 2026-03-09 | Public preview, macOS, бесплатно | [9] |
| 2026-03-24 | Анонс JetBrains Central как «control and execution plane»; показан командный продукт «Air Team» | [10] |
| 2026-04-02 | Plan mode, файлы `.air/docker.json` и `.air/worktree.json`, skills для всех агентов | [3] |
| 2026-04-17 | Очередь prompt-ов, commit messages от агента | [3] |
| 2026-05-12 | Auto-commit в задачах Worktree и Docker, cleanup scripts | [3] |
| 2026-06-02 | Linux через Toolbox | [3] |
| 2026-06-18 | Открыть проект задачи в IDE JetBrains | [3] |
| 2026-06-29 | Windows | [3][12] |
| 2026-07-07 | «JetBrains AI for Teams and Organizations»: облачные агенты, automations, JetBrains Context, Central, Central CLI; бизнес-лицензии переходят на credits | [13] |
| 2026-07-15 / 07-21 | Любой ACP-агент через `acp.json` (Copilot CLI, OpenCode, Pi, Cline); локальные модели через Ollama или LM Studio; code intelligence Java и Kotlin на движке IntelliJ | [3][14] |
| 2026-07-29 | Первая EAP-сборка JetBrains Context | [4] |
| 2026-08-10 | Первый выпуск Central CLI (позже Air Gateway), версия 1.6.2 | [4] |
| 2026-08-19 / 08-21 | Окно с несколькими проектами; Agent Review с выбором агента и модели | [3][16] |
| 2026-09-10 | Git-репозиторий больше не обязателен; звуки уведомлений | [3] |
| 2026-09-22 | Перезапуск Air как семейства продуктов | [17] |
| 2026-09-28 | Air Teams для бизнес-клиентов | [18] |
| 2026-10-01 | EAP Air in IDEs | [19] |
| 2026-10-14 | Описание облачной изоляции; облачные агенты в preview | [21] |
| 2026-10-22 | Air Governance GA | [24] |
| 2026-10-30 | EAP-сборки мобильного приложения для Android и iOS | [4] |
| 2026-11-03 | GitHub Copilot как агент Air локально и в облаке | [27] |
| 2026-11-05 | IDE 2026.3 выходят с Air | [29] |
| 2026-11-11 | Air in IDEs выпущен с 2026.3; desktop-приложение снято с загрузки | [31][3] |
| 2026-11-15 | Объявленная дата Air Teams на телефоне | [2] |

Пост 2026-09-22 говорит, что публичные эксперименты с агентными средами разработки начались за полгода до него, то есть
около марта 2026 [17].

### Что добавили

- Версии для Windows и Linux [3].
- Любой ACP-агент и локальные модели; code intelligence Java и Kotlin [14].
- Облачные агенты [21]; Air Teams с automations и цепочками [18][33:automations][33:chained-automations].
- Air Governance GA с платными планами [24][33:changelog].
- Air Context [33:air-context], Air Gateway [33:cli-about], Air Mate в Slack (early access) [33:air-mate], EAP-сборки
  мобильного приложения [4].
- Партнёрство с GitHub по Copilot [27]; бесплатный Junie Lite [31].
- Junie Eco mode: сильная модель планирует, дешёвая (сейчас GPT-6 Luna) реализует. JetBrains сообщает о снижении
  средней стоимости модели на задачу на 48% и 57% на двух внутренних benchmarks; доля решённых задач изменилась меньше
  чем на один пункт [26].

### Что убрали

- Отдельное desktop-приложение — новых загрузок нет с 2026-11-11 [3].
- Fleet [7].
- AI Assistant как главный AI-интерфейс. Он поддерживается отдельным plugin до начала 2027; старые разговоры AI Chat
  конвертируются в сессии Junie [31].
- Локальные Docker-задачи. Они были в приложении [9][3]. В документированных run modes plugin остались только Local,
  Temporary Worktree и Cloud [33:air-in-ides-start-a-session]. Вернётся ли Docker — не подтверждено.

### Что пересмотрели

- **Кто что делает.** На запуске Air вёл работу агентов, а IDE — всё остальное [9]. К осени агенты переехали внутрь IDE
  [18][19]. Само приложение ещё в июне научилось открывать проект задачи в IDE [3].
- **Фокус** — с личной продуктивности на узкие места команды и организации [17][18][20].
- **Имена.** JetBrains Central стал Air Governance [17][24]. Central CLI стал Air Gateway, и документация признаёт, что
  переименование не закончено [33:cli-about]. JetBrains Context стал Air Context [4][33:air-context]. «Air Team» стал
  Air Teams [10][18].
- **Коммерческая модель.** Бизнес-лицензии перешли на credits [13]. Credits теперь платят и за вычисления, индексацию и
  хранение [33:about-air][33:plans-and-pricing].
- **Подписки Claude меняли статус несколько раз.** На запуске подписки Anthropic исключены [9]. В феврале 2026 —
  только оплата по API [3]. В заметках 2026-08-19 вход Claude Pro, Max и Team был, в заметках сборки 2026-08-21 того же
  выпуска его уже нет, причина не названа [3]. В Air in IDEs подписка Claude работает только через Claude Code во
  вкладке терминала; структурированный чат Claude Agent требует JetBrains AI или API key Anthropic
  [33:air-in-ides-overview][33:air-in-ides-authorization].
- **Единица навигации.** В приложении — переход от окон к задачам с окном нескольких проектов [16]. В IDE единицей работы
  стали session folders [33:air-in-ides-manage-sessions].
- **Зрелость описана по-разному:** документация — эксперимент [33:air-in-ides-overview]; Marketplace — public preview с
  обновлениями примерно раз в неделю [6]; блог — выпущенный продукт [31].

### Roadmap

- **Mobile и удалённая работа.** Запускать, наблюдать, проверять и продолжать работу в разных окружениях, не копируя IDE
  на каждую поверхность [17]. Air Teams на телефоне — 2026-11-15 [2].
- **Больше интеллекта JetBrains:** контекст из кода, архитектуры, репозиториев, поведения в runtime и знаний организации;
  распределение работы между разработчиками, моделями, агентами и сервисами [17]. Central анонсировал «semantic layer»
  с выбором модели и инструментов [10].
- **Работа по событиям:** больше запусков от событий репозитория, расписаний и процессов поставки [17].
- **Backlog Governance** [24]: передача MCP-конфигурации в сторонние CLI; Copilot через Air Gateway (уже выпущено на
  неделе 2026-10-18 [33:changelog]); облачные агенты через Air Gateway; расширенная аналитика; лимиты и свои цены для
  моделей BYOK; управление skills по командам.
- **Air in IDEs** [31]: отслеживать worktree, которые создаёт агент; вид остатка квоты и даты сброса для подписок
  Codex, Claude и Copilot, как сейчас для JetBrains AI.
- **Облако:** microVM на задачу [21]; облачные агенты для частных лиц позже [21]; больше провайдеров BYOC — Google Cloud
  и Azure помечены «Soon» [33:cloud-providers]; больше видов trigger-ов [18].

### Рядом с Air

- `jcp-cli` — ACP-драйвер для агентов, развёрнутых в JCP; README относит его к JetBrains Central. Как он связан с Air —
  не подтверждено. Версия 0.8.4 от 2026-11-05 [36].
- `thinkrail` — инкубаторный проект JetBrains, «agentic IDE» вокруг агента Pi. К Air не относится [36].
- Два поста найдены только по заголовкам и не прочитаны: «My journey to agent-first development with Air» (2026-04) и
  «Codex is now the recommended agent in JetBrains AI» (2026-06) [32].
- События: Air Day Seoul 2026-10-28, около 100 участников, вместе с реселлером Dangunsoft [30]; webinar по Air
  Governance 2026-11-18 [24].

## Слабые места и чего нет

- **Продукт меняет форму.** Отдельное приложение снято через 8 месяцев после public preview [9][3]. Имена частей
  менялись: Central → Governance, Central CLI → Gateway, JetBrains Context → Air Context [17][33:cli-about][4].
  Документация, Marketplace и блог по-разному описывают зрелость plugin [33:air-in-ides-overview][6][31]. Пользователи
  путаются между Junie, AI Assistant, AI Chat и Air [6][46·c49801710][49].
- **Подписка Claude — только в терминале.** Там не работает режим Review Code [33:air-in-ides-review-changes].
  Структурированный чат Claude Agent требует JetBrains AI или API key [31]. Главный запрос в трекере — 94 голоса
  [40:AIR-4152].
- **Нет orchestrator-а и планировщика.** Сессии не обмениваются сообщениями [40:AIR-7175]. Нет backlog и разбиения
  задач [33:permission-modes].
- **Нет работы с лимитами подписок.** Нет ожидания сброса лимита и продолжения [40:AIR-6842]. С Copilot запуски падают
  без предупреждения [27]. Кончившаяся квота Claude не показывается [40:AIR-3928]. Остаток подписок Codex, Claude и
  Copilot ещё не показывается [31].
- **Нет единой политики auto-approve** [40:AIR-4789].
- **Нет встроенной проверки.** Нет шага тестов или проверочного запуска [33:review-changes]. CI — только trigger на
  падение [33:automation-triggers]; показ статуса CI не найден.
- **Нет локальной sandbox в plugin.** Docker убран, worktree не являются security sandbox; запрос на Docker-сессии —
  19 голосов [33:air-in-ides-start-a-session][2][41:IJAI-2118].
- **Слияние параллельной работы вручную** через cherry-pick. Worktree, созданные агентом, не отслеживаются
  [33:air-in-ides-start-a-session][31].
- **Облако только для организаций.** Личные лицензии исключены, частным лицам — «позже» [33:air-in-ides-start-a-session][18].
- **Ограничения облака:** только образ по умолчанию; нет своих размеров VM; открытые порты публичны и без
  аутентификации; при падении startup script агент всё равно стартует
  [33:configure-environments][33:vm-resources][33:exposed-ports][33:startup-commands]. Простаивающая задача засыпает
  через 75 минут и просыпается только по запросу [33:tasks].
- **Хрупкие automations:** цепочка идёт дальше только при успехе и не защищена от зацикливания
  [33:chained-automations]; расписание молча перестаёт работать, когда истекла сессия автора
  [33:troubleshoot-automations]; шаг человека ждёт без timeout и без уведомления [33:person-automations]; ротация
  секрета Jira молча останавливает trigger-ы [33:connect-jira]; упавший запуск повторяют вручную
  [33:automation-run-results]. У Linear нет trigger-ов [33:connectors].
- **Подключение в компаниях (приложение):** открыты запросы Bedrock (59 голосов), своего base URL (45) и WSL (60)
  [40:AIR-4149][40:AIR-4541][40:AIR-5811].
- **Стабильность:** падения на Windows при старте (54 и 48 голосов) [40:AIR-6896][40]; зависание checkpoint (14
  голосов) [40:AIR-6469]; терминальные сессии убиваются через 60 секунд вне экрана [41:IJAI-6049]; всплески процессов
  git [41:IJAI-1624]; невидимые запросы одобрения [41:IJAI-5952]; после потери сети сессия висит в Running
  [41:IJAI-6125]. Refs checkpoints копятся без очистки [40:AIR-6840].
- **Жизненный цикл сессий:** сессии нельзя удалить (25 голосов) [41:IJAI-2625]; нет отката одного хода агента [41];
  сессии терялись при обновлении IDE [6].
- **Навязан в IDE:** встроен и не удаляется [33:air-in-ides-disable]; администраторы просят исключить его из пакетов
  [41:IJAI-3469]; нет единого выключателя AI [41:IJAI-4245]; вытеснил AI Assistant [41:IJAI-3764].
- **Air Mate:** отвечает сам, и это не выключить; администратор не может выключить его для организации; командный Air
  Mate даёт каждому в канале доступ service account проекта; игнорирует ограничения моделей Governance; только GitHub
  [33:air-mate].
- **Наблюдаемость:** стоимость сессии бывает примерной или отсутствует [33:air-in-ides-manage-sessions]; Session
  explorer не в реальном времени [33:session-explorer]. Хранилище памяти между сессиями не описано.
- **Нет визуального обзора:** интерфейс — списки, деревья и вкладки; canvas не найден.

## Пересечение с worfy

Термины worfy в этом разделе:

- Canvas — бесконечное полотно, на котором worfy показывает работу агентов.
- Epic — группа связанных Ticket-ов. Ticket — одна задача.
- Orchestrator — session, которая планирует работу и раздаёт Ticket-ы.
- Wave — набор Ticket-ов, которые запускаются вместе. Autopilot — запуск Wave-ов без человека.
- Gate — локальный проверочный запуск перед PR.
- Harness — plugin, который приносит в Claude Code rules, skills, subagents и hooks.
- Flight Recorder — таймлайн запуска без присмотра. Work track — вся работа проекта за день или неделю.
- Cards — карточки, которые агенты строят на Canvas через MCP server.
- Product Session — продуктовый советник с живой Mind map и critic спецификаций.
- Linked machines — машины, связанные по локальной сети.
- Evidence — скриншоты-доказательства с privacy scrub (удалением личных данных).

### Где пересекаются

| worfy | Air | Как соотносятся |
|---|---|---|
| Сессии Claude Code и Codex CLI в одном приложении | Сессии Claude Code (терминал), Claude Agent (чат), Codex и многих других агентов; сессии из приложения Codex тоже видны [31][33:air-in-ides-manage-sessions] | Оба собирают сессии разных агентов в одном месте. Air шире по агентам. Подписка Claude в Air работает только в терминале [33:air-in-ides-claude-subscription] |
| Canvas | Tool window со списком и деревом сессий, вкладки редактора, окно с несколькими проектами [33:air-in-ides-manage-sessions][16] | Обзор многих сессий есть у обоих; canvas у Air нет |
| Worktree на Ticket | Временный worktree на сессию, результат возвращается cherry-pick вручную [33:air-in-ides-start-a-session]; VM на облачную задачу [21] | Один и тот же приём изоляции работы. У Air ещё облако. Worktree, созданные агентом, Air не отслеживает [31] |
| Autopilot: Wave-ы без человека | Automations в облаке по расписанию и событиям, цепочки, шаги человека [33:automations][33:chained-automations][33:person-automations]; облачная очередь prompt-ов [33:prompt-queue] | Оба запускают работу без человека. У Air — в облаке, по событиям, для команды. Ожидания сброса лимита нет [40:AIR-6842]; упавший запуск повторяют вручную [33:automation-run-results] |
| Auto-approve запросов разрешений по политике | Permission modes агента (Full Access, Auto-Edit) [33:permission-modes]; allowlists агентов и MCP в организации [33:ai-agents]; единой политики нет [40:AIR-4789] | У Air одобрения задаются режимом агента и allowlists организации, а не правилами для отдельных запросов |
| Reviewer subagents с review lenses | Agent Review в приложении [3][16]; automation code review [18]; `/review` [33:review-changes]; Code Notes человека [33:air-in-ides-review-changes] | Review агентом есть у обоих; разбиения review на lenses у Air нет |
| Harness: rules, skills, subagents, hooks в Claude Code | Страница Skills с импортом из папок Claude и Codex [33:air-in-ides-extend-agent-capabilities]; Injected instructions в preset [33:air-in-ides-presets]; `jbcontext setup-agent` ставит skill, subagent, hooks и MCP server [33:context-agent-integrations]; `central add` правит конфигурацию агента [34] | Один и тот же приём: продукт сам доставляет расширения в Claude Code и Codex |
| Epics и Tickets | Session folders с `issue` и `review` [33:air-in-ides-manage-sessions]; trigger-ы и connectors Jira, YouTrack, Linear [33:automation-triggers][33:connectors] | Единица работы есть; иерархии Epic → Ticket нет |
| Flight Recorder, Work track | Полная запись чата запуска automation [33:automation-run-results]; Session explorer по организации [33:session-explorer]; логи смены состояний задачи в приложении [40:AIR-5121] | Запись есть; таймлайна запуска без присмотра и сводки работы проекта за день не найдено |
| Уведомления | Звуки, Caps Lock, запрет сна, счётчики; email и webhooks automations [33:air-in-ides-settings][33:air-in-ides-manage-sessions][33:automation-notifications] | Совпадают по назначению |
| Счётчики лимитов и расхода | AI Usage view, Claude usage в status bar, стоимость сессии [6][33:air-in-ides-claude-subscription][31] | Остаток подписок Codex и Copilot Air пока не показывает [31][27] |
| Eco mode | Junie Eco mode: сильная модель планирует, дешёвая выполняет [26] | Совпадает название; устройство не сравнивалось |
| Linked machines | Remote Development backend [31]; телефон управляет сессиями [4]; удалённое управление локальными задачами — открытый запрос [40:AIR-5711] | Разные механизмы удалённой работы |

### Где расходятся

- **Orchestrator.** В worfy session-orchestrator планирует и раздаёт Ticket-ы. В Air orchestrator-а нет: сессии не
  обмениваются сообщениями [40:AIR-7175]. Ближе всего — цепочки automations, которые передают текст summary
  [33:chained-automations]. Настоящий orchestrator есть только у Air Mate в Slack [33:air-mate].
- **Проверка.** В worfy — тесты, локальный Gate, PR с CI badges. В Air продуктового шага проверки нет: проверяет агент или
  человек [33:review-changes]. CI в Air — только trigger на падение [33:automation-triggers]; показ статуса CI не найден
  (не подтверждено).
- **Лимиты подписки.** Autopilot worfy ждёт сброса лимита и повторяет ошибки API. В Air при исчерпанном лимите работа заканчивается
  ошибкой с кнопкой Retry [40:AIR-6842]; с Copilot запуски просто падают [27]; после потери сети сессия висит в Running
  [41:IJAI-6125].
- **Где выполняется работа и кто платит.** worfy — локальное приложение для одного пользователя. Air зарабатывает на
  облаке, командах и организациях: Air Teams, Governance, BYOC [18][24][33:cloud-providers]. Облачные запуски из IDE
  недоступны по личной лицензии [33:air-in-ides-start-a-session].
- **Форма продукта.** worfy — desktop-приложение с Canvas. Air с ноября 2026 живёт внутри IDE JetBrains, отдельное
  приложение снято [3]. Пользователи оценивают это по-разному: одним удобно не переключаться между приложением агентов и
  редактором, другие не хотят десять экземпляров IDE на десять worktree [6].
- **Функции worfy, для которых аналог в Air не найден:** встроенный Browser с профилями (в приложении был только website
  Preview, с которым мог работать агент [3]); Cards через MCP server (у Air наоборот: IDE отдаёт агенту свой MCP server
  с инструментами [33:air-in-ides-extend-agent-capabilities]); Product Session с Mind map и critic; PR inbox (есть только
  trigger-ы на события PR [33:automation-triggers]); Evidence screenshots с privacy scrub (есть только скрытие identity
  в данных сессий Governance [33:changelog]); Terminal с AI-помощником для команд; планирование запусков под лимиты
  подписки.
- **Что есть у Air и нет в описании worfy:**
  - code intelligence IDE для агентов — inspections, рефакторинги, debugger, базы данных [31];
  - облачные VM со snapshots [33:tasks];
  - trigger-ы от событий GitHub, GitLab, Jira, webhooks и расписаний [33:automation-triggers];
  - задачи на несколько репозиториев [33:run-tasks-in-cloud];
  - контроль организации и BYOC [24][33:cloud-providers];
  - многие агенты через ACP [31];
  - семантический индекс кода Air Context [33:air-context];
  - агент в Slack Air Mate [33:air-mate];
  - Windows и Linux [6].

### Спрос пользователей Air в зонах, где работает worfy

- Подписка решает выбор: пользователи уходят к инструментам, которые оборачивают официальный CLI Claude Code
  [40:AIR-4152]. При этом терминальный режим Air закрывает терминальные сессии с фоновыми процессами через 60 секунд
  [41:IJAI-6049].
- Пользователи хотят всё время видеть расход относительно лимитов: просят полосу лимита, закреплённое окно расхода,
  несколько аккаунтов [40:AIR-3929][6][40]. GA-пост обещает такие виды для Claude, Codex и Copilot позже [31].
- Один агент, который направляет других, — запрос не закрыт [40:AIR-7175][42·c46141003].
- Review — узкое место, на которое ссылаются скептики параллельных агентов [42]. То же говорят интервью клиентов
  JetBrains [20].
- Изоляцию требуют, но с переиспользованием существующих devcontainers [41:IJAI-2118][40:AIR-3540][40:AIR-3189].
- Жизненный цикл сессий важен: удалить, перенести, не потерять [41:IJAI-2625][40:AIR-7640][6].
- Нужна запись запусков без присмотра, по которой можно отлаживать [45].
- Одобрения: просят тонкий auto-approve и жалуются на невидимые или бесконечные запросы
  [42·c46140912][41:IJAI-5952][40]. Обсуждений запусков без присмотра, которые ждут сброса лимита, в доступных источниках
  нет.

## Механизмы, которые стоит изучить

1. **Коммит и push после каждого хода агента.**
   - Что это: в облачных задачах Air Teams каждый ход агента сразу становится коммитом в ветке задачи [33:tasks].
   - Как работает: после каждого хода — commit и push в ветку задачи, никогда в main. Две доработки оставляют три
     коммита. Незакоммиченные правки человека попадают в следующий коммит агента. Задача засыпает через 75 минут
     простоя; resume восстанавливает диск из snapshot, но не процессы [33:tasks][33:run-tasks-in-cloud].
   - Чем интересно: состояние задачи всегда лежит в git, поэтому после сна, сбоя или смены машины работа продолжается с
     ветки. Merge остаётся за человеком [33:what-is-air-teams].
2. **Git checkpoint через временный индекс.**
   - Что это: снимок рабочего дерева перед каждым запросом агенту в desktop-приложении [40:AIR-6724].
   - Как работает: временный индекс по выводу `git status --untracked-files=all`, затем
     `git update-index --add --remove --stdin` и `write-tree`. На больших репозиториях помогли постоянный кэш-индекс на
     worktree и fsmonitor (с 40–130 до примерно 3 секунд на 1,35 млн файлов); на macOS git запускается с
     `taskpolicy -c utility` [40:AIR-6724][40:AIR-6840].
   - Чем интересно: снимок пишется во временный индекс и отдельные refs checkpoints, поэтому индекс и ветки
     пользователя, судя по описанию, не меняются (это вывод, прямо в трекере не сказано). Известные ловушки: refs
     checkpoints держат объекты в `.git/objects` без очистки [40:AIR-6840], а запись в stdin до чтения stderr без
     timeout вешала сохранение навсегда [40:AIR-6953].
3. **Automation = trigger + правило обработки изменений.**
   - Что это: запуск агента без человека по расписанию, интервалу, событию GitHub, GitLab или Jira, входящему webhook
     или завершению другой automation [33:automation-triggers].
   - Как работает: у каждой automation есть правило, что делать с правками: No code changes, Push to source branch,
     Push to new branch или Create a PR. Webhook принимает JSON payload, который становится контекстом задачи;
     аутентификация — `Authorization: ApiKey <token>` [33:automation-triggers][33:create-automation].
   - Чем интересно: одна сущность покрывает и плановое обслуживание, и реакцию на упавший CI, а правило правок явно
     ограничивает, куда агент может писать.
4. **Цепочки automations с передачей summary и шаги человека.**
   - Что это: следующая automation стартует, когда предыдущая закончилась успешно [33:chained-automations].
   - Как работает: следующий запуск получает summary, ссылки, репозиторий, стартовую и запушенную ветки и ссылку на
     запуск — текстом, а не кодом. Шаг «Person» ждёт ответа человека в Markdown без timeout, и ответ становится summary
     для следующего шага [33:chained-automations][33:person-automations].
   - Чем интересно: простой протокол передачи между шагами. Видны и слабые места: защиты от зацикливания нет, а
     ожидающий шаг человека не шлёт уведомления [33:chained-automations][33:person-automations].
5. **Webhook-уведомления с ключом идемпотентности.**
   - Что это: POST об успехе или сбое запуска automation [33:automation-notifications].
   - Как работает: заголовок `X-Air-Webhook-Id` (`evt_<uuid>`) служит ключом идемпотентности; `X-Air-Webhook-Event` —
     `automation.execution.succeeded` или `automation.execution.failed`; `X-Air-Webhook-Format` — `json` или
     `slack-workflow`. В payload — `statusUrl`, `output.result` или `error {message, code}` [33:automation-notifications].
   - Чем интересно: получатель может безопасно обработать повторную доставку, а формат для Slack не требует своего
     адаптера.
6. **Очередь prompt-ов с явными правилами.**
   - Что это: запросы, набранные, пока агент работает, отправляются по очереди сами [33:prompt-queue].
   - Как работает: Enter ставит в очередь, Ctrl+Enter отправляет сразу [33:air-in-ides-settings]. Элементы можно
     править, переставлять, отправлять немедленно, очередь — ставить на паузу [33:air-in-ides-interact-with-the-agent][6].
     Остановка агента ставит очередь на паузу; запрос из очереди не отвечает на карточку разрешения; очередь переживает
     перезагрузку страницы [33:prompt-queue].
   - Чем интересно: правило «запрос из очереди не одобряет разрешение» отделяет поток работы от решений о безопасности.
7. **Пакетный review: Code Notes уходят агенту одной пачкой.**
   - Что это: построчные заметки человека к правкам агента [33:air-in-ides-review-changes].
   - Как работает: заметки копятся в gutter, потом «Finish & Attach Comments» отправляет их сессии вместе, либо они
     остаются Pending Notes. В review одна сессия за раз. Для сессий в терминале режим review недоступен, и заметки
     прикладываются из поля ввода. С 2026-10-30 заметки доходят и до терминальных агентов
     [33:air-in-ides-review-changes][6][31].
   - Чем интересно: агент получает весь review разом, а не по одному сообщению, и это работает даже для CLI-агента в
     терминале.
8. **Скрытые служебные сессии на дешёвой модели.**
   - Что это: мелкие задачи выполняют отдельные невидимые сессии [33:air-in-ides-review-changes].
   - Как работает: commit message пишет скрытая фоновая сессия по соглашениям репозитория и AGENTS.md. По умолчанию
     Air выбирает доступного агента с лёгкой моделью и низким effort, например Junie на модели Lite; агента, модель и
     effort можно сменить. Свой prompt может использовать `$GIT_BRANCH_NAME`. Конфликт merge открывает сессию, в
     которой есть только конфликтующие файлы [33:air-in-ides-review-changes].
   - Чем интересно: рутинные шаги не засоряют основную сессию и не тратят дорогую модель.
9. **Чужие сессии в общем списке через файлы истории агентов.**
   - Что это: список Agent Sessions показывает и сессии, начатые во внешних инструментах вроде приложения Codex
     [33:air-in-ides-manage-sessions].
   - Как работает: plugin читает историю сессий Claude, Codex и Junie, которую хранит сам агент. У plugin есть свои
     кэши сессий; старые он удаляет, не трогая историю агента. По этой же истории plugin сопоставляет незакоммиченные
     изменения с сессиями, которые их сделали [6][33:air-in-ides-settings].
   - Чем интересно: главный источник — история самого агента, а кэш plugin вторичен, поэтому сессии из внешних
     инструментов видны в общем списке и переживают рестарт IDE.
10. **Одна команда ставит агенту skill, subagent, hooks и MCP.**
    - Что это: `jbcontext setup-agent` подключает Air Context к Claude Code, Codex, Junie CLI или любому агенту
      [33:context-agent-integrations].
    - Как работает: команда ставит инструкции, skill `context-search` (по умолчанию всем, кроме Codex), subagent
      `context-explorer` только для чтения, session hooks, которые обновляют индекс, MCP server (для Claude Code) и
      правила выполнения Codex. Отдельные hooks, которые следят за вызовами инструментов, по умолчанию не ставятся
      (опция `--hooks`). Они хранят состояние сессии в `/tmp/claude-context-hook-<session>.json` и отклоняют, например,
      широкий локальный поиск до первого семантического [33:context-agent-integrations][36].
    - Чем интересно: публичный пример того, как сторонний продукт встраивает свои возможности в Claude Code и Codex
      теми же средствами, что и Harness. Файла лицензии в репозитории нет, поэтому код можно читать, но условия его
      переиспользования не указаны [36].
11. **Junie Eco mode: планирует сильная модель, выполняет дешёвая.**
    - Что это: режим Junie, в котором рутинные шаги уходят модели-компаньону [33:air-in-ides-interact-with-the-agent].
    - Как работает: выбранная модель планирует, дешёвая (сейчас GPT-6 Luna) реализует; платятся обе. С моделью Default
      режим включается сам [26][33:air-in-ides-interact-with-the-agent].
    - Чем интересно: JetBrains сообщает о снижении средней стоимости модели на задачу на 48% и 57% на двух внутренних
      benchmarks при изменении доли решённых задач меньше чем на один пункт [26]. Это данные вендора.
12. **Агент сам собирает и проверяет окружение.**
    - Что это: кнопка «Start Agent» при создании облачного окружения [33:create-an-environment].
    - Как работает: агент пишет конфигурацию, проверяет её и коммитит startup script `.air/cloud/startup.sh` в отдельную
      ветку; окружение сохраняется как snapshot [18][33:create-an-environment][33:quickstart-with-cloud-agents]. Script
      выполняется при каждом старте, включая resume, должен быть идемпотентным и имеет timeout 600 секунд по
      умолчанию, настраиваемый от 1 до 3600 [33:startup-commands].
    - Чем интересно: настройка окружения становится файлом в репозитории, который проверен запуском. Слабое место —
      при падении script агент всё равно стартует [33:startup-commands].

## Источники

Все источники прочитаны 2026-11-13, если не сказано другое. «Вторичный» — сторонний или пользовательский источник.

Обозначения в тексте:

- [33:имя] — страница `https://www.jetbrains.com/help/air/имя.html`;
- [34:имя] — страница `https://www.jetbrains.com/help/central-cli/имя.html`;
- [40:AIR-N] — задача `https://youtrack.jetbrains.com/issue/AIR-N`; [41:IJAI-N] — задача
  `https://youtrack.jetbrains.com/issue/IJAI-N`;
- [42·cN], [43·cN], [46·cN] — комментарий `https://news.ycombinator.com/item?id=N` в обсуждении 42, 43 или 46;
- [6, отзыв ДАТА] — отзыв на Marketplace от этой даты.

**Сайт, данные и Marketplace JetBrains**

1. Страница JetBrains Air — <https://www.jetbrains.com/air/> — без даты; там же проверен 301 redirect с air.dev.
2. Страница Air in JetBrains IDEs — <https://www.jetbrains.com/air/ides/> — без даты.
3. Release notes desktop-приложения, JetBrains product data service, код AIR, 39 сборок —
   <https://data.services.jetbrains.com/products/releases?code=AIR&type=release,eap,preview,rc,beta&latest=false> —
   сборки 2025-12-01 … 2026-11-11.
4. Список продуктов и сборок JetBrains product data service, коды AIR, AIRGW, AIRMI, AIRMA, JBC, ILSISA, JCP —
   <https://data.services.jetbrains.com/products?fields=code,name,link,description> и
   <https://data.services.jetbrains.com/products/releases?code=AIRGW> (тот же шаблон для остальных кодов).
5. Списки сторонних библиотек desktop-приложения —
   <https://resources.jetbrains.com/storage/third-party-libraries/air/air-262.1102.13-third-party-libraries.json>
   (2026-11-11) и такой же файл для сборки air-261.63.28 (2025-12-01).
6. JetBrains Marketplace, plugin Air (`com.intellij.air`, id 33314) — <https://plugins.jetbrains.com/plugin/33314-air>;
   API <https://plugins.jetbrains.com/api/plugins/33314> и `/updates` — метаданные, оценки, отзывы 2026-09-04 …
   2026-11-13, change notes сборок 2026-10-08 … 2026-11-05.

**Блог JetBrains** (посты прочитаны через RSS-ленты блога: HTML-страницы закрыты проверкой на ботов)

7. E. Prigara, «The Future of Fleet» — <https://blog.jetbrains.com/fleet/2025/12/the-future-of-fleet/> — 2025-12-08,
   дополнен в мае 2026.
8. D. Shiryaev, «Agents, Protocols, and Why We're Not Playing Favorites» —
   <https://blog.jetbrains.com/ai/2025/12/agents-protocols-and-why-we-re-not-playing-favorites/> — 2025-12-16.
9. N. Tkachev, «Air Launches as Public Preview – A New Wave of Dev Tooling Built on 26 Years of Experience» —
   <https://blog.jetbrains.com/air/2026/03/air-launches-as-public-preview-a-new-wave-of-dev-tooling-built-on-26-years-of-experience/>
   — 2026-03-09.
10. O. Koverznev, «Introducing JetBrains Central: An Open System for Agentic Software Development» —
    <https://blog.jetbrains.com/blog/2026/03/24/introducing-jetbrains-central-an-open-system-for-agentic-software-development/>
    — 2026-03-24.
11. C. Schwellnus, «Agentic AI Governance: Designing for Accountability and Control» —
    <https://blog.jetbrains.com/ai/2026/06/agentic-ai-governance-designing-for-accountability-and-control/> —
    2026-06-10.
12. «JetBrains Air Lands on Windows» — <https://blog.jetbrains.com/air/2026/06/jetbrains-air-lands-on-windows/> —
    2026-06-29.
13. O. Koverznev, «JetBrains AI for Teams and Organizations: From Fragmented AI Usage to Coordinated Software
    Development» —
    <https://blog.jetbrains.com/blog/2026/07/07/jetbrains-ai-for-teams-and-organizations-from-fragmented-ai-usage-to-coordinated-software-development/>
    — 2026-07-07.
14. V. Gromozdin, «What's New: Air Gets More Agents, Local Models, and Java/Kotlin Code Intelligence» —
    <https://blog.jetbrains.com/air/2026/07/what-s-new-air-gets-more-agents-local-models-and-java-kotlin-code-intelligence/>
    — 2026-07-21.
15. V. Kiselev, «Our First Moves to Get AI Spend Under Control» —
    <https://blog.jetbrains.com/ai/2026/08/our-first-moves-to-get-ai-spend-under-control/> — 2026-08-03.
16. V. Gromozdin, «New in Air: Multiproject View, a New Markdown Editor, and IME on Windows» —
    <https://blog.jetbrains.com/air/2026/08/new-in-air-multiproject-view-and-improved-markdown/> — 2026-08-19.
17. K. Skrygan, «JetBrains Air: Building a System of Products for Agentic Software Development» —
    <https://blog.jetbrains.com/blog/2026/09/22/introducing-jetbrains-air/> — 2026-09-22.
18. V. Gromozdin, «Air Teams: Bring Your Best Agentic Workflows to the Whole Team – and Automate Repeatable Work» —
    <https://blog.jetbrains.com/air/2026/09/introducing-air-teams/> — 2026-09-28.
19. D. Rolink, «A New Agentic Experience: JetBrains Air in IDEs – EAP Now Open» —
    <https://blog.jetbrains.com/ai/2026/10/air-in-ides-eap/> — 2026-10-01.
20. G. Malkov, «Faster Developers Don't Make a Faster Team» —
    <https://blog.jetbrains.com/air/2026/10/faster-developers-don-t-make-a-faster-team/> — 2026-10-07; слова клиентов
    приводит сам вендор.
21. D. Ushakov, «How Cloud-Based Agent Sandboxing Works in Air» —
    <https://blog.jetbrains.com/air/2026/10/cloud-agent-sandboxing/> — 2026-10-14.
22. A. Kazakova, «How Netflix Made AI Coding Agents More Efficient with JetBrains IDE Intelligence» —
    <https://blog.jetbrains.com/ai/2026/10/how-netflix-made-ai-coding-agents-more-efficient/> — 2026-10-15; case study
    клиента, опубликованный JetBrains.
23. I. Levin, «Why We Still Need an IDE» — <https://blog.jetbrains.com/blog/2026/10/20/why-we-still-need-an-ide/> —
    2026-10-20.
24. V. Kiselev, «Air Governance: Manage AI Agents, Access, and Spend Throughout Your Organization» —
    <https://blog.jetbrains.com/blog/2026/10/22/air-governance-manage-ai-agents-access-and-spend-throughout-your-organization/>
    — 2026-10-22.
25. T. Tams, «Getting Started with Air in JetBrains IDEs – Part 1» —
    <https://blog.jetbrains.com/ai/2026/10/getting-started-with-air-part1/> — 2026-10-28.
26. H. Klause, «Junie Eco Mode» — <https://blog.jetbrains.com/junie/2026/10/junie-eco-mode/> — 2026-10-28.
27. V. Gromozdin, «Use Your GitHub Copilot Plan in JetBrains Air – in Your IDE and in the Cloud» —
    <https://blog.jetbrains.com/air/2026/11/github-copilot-in-air/> — 2026-11-03.
28. «Building a RAG Pipeline for Semantic Code Search: A Developer Diary and Field Notes, Part 2» —
    <https://blog.jetbrains.com/ai/2026/11/building-a-rag-pipeline-for-semantic-code-search-a-developer-diary-and-field-notes-part-2/>
    — 2026-11-05.
29. Лента блога по тегу jetbrains-air, посты о выходе IDE 2026.3 — <https://blog.jetbrains.com/tag/jetbrains-air/feed/>
    — 2026-11-05.
30. JetBrains Korea, итоги Air Day Seoul 2026 (на корейском) —
    <https://blog.jetbrains.com/ko/ai/2026/11/air-day-seoul-2026-recap/> — 2026-11-10.
31. D. Rolink, «JetBrains IDEs Transformed for the Agentic Era of Development – With Air» —
    <https://blog.jetbrains.com/ai/2026/11/air-in-jetbrains-ides-ga/> — 2026-11-11.
32. Sitemap-ы блога, только список постов — <https://blog.jetbrains.com/air-sitemap.xml>,
    <https://blog.jetbrains.com/ai-sitemap.xml>.

**Документация JetBrains**

33. Документация JetBrains Air, сборка 408 от 2026-11-12 — <https://www.jetbrains.com/help/air/>; оглавление —
    <https://www.jetbrains.com/help/air/llms.txt>. В скобках — дата обновления страницы, если она записана.
    - Общее: overview (2026-10-21), about-air (2026-10-21), changelog (недели 2026-08-16 … 2026-11-08).
    - Air in IDEs: air-in-ides-overview (2026-11-06), air-in-ides-quickstart, air-in-ides-key-concepts (2026-10-28),
      air-in-ides-manage-agents (2026-10-30), air-in-ides-authorization (2026-10-30), air-in-ides-presets (2026-10-27),
      air-in-ides-claude-subscription (2026-10-30), air-in-ides-extend-agent-capabilities (2026-11-06),
      air-in-ides-start-a-session (2026-10-30), air-in-ides-interact-with-the-agent (2026-11-06),
      air-in-ides-review-changes (2026-11-06), air-in-ides-manage-sessions (2026-11-06), air-in-ides-disable,
      air-in-ides-manage-user-machines (2026-10-30), air-in-ides-settings (2026-11-04).
    - Air Teams, задачи: what-is-air-teams (2026-11-06), ways-to-reach-air-teams (2026-11-06), supported-agents
      (2026-11-06), ai-credits (2026-11-06), quickstart-with-cloud-agents, set-up-air-teams, tasks (2026-11-06),
      define-tasks, select-agents-and-models, permission-modes (2026-11-06), task-context, project-instructions
      (2026-11-06), commands, skills, run-tasks-in-cloud (2026-11-06), prompt-queue (2026-11-06), context-window
      (2026-11-06), review-changes (2026-11-06), create-a-pull-request, troubleshoot-cloud-tasks (2026-11-06).
    - Air Teams, automations: automations (2026-10-30), create-automation (2026-11-06), automation-triggers
      (2026-11-02), chained-automations (2026-10-30), person-automations (2026-11-06), automation-notifications
      (2026-09-30), connect-jira, manage-automations, automation-templates, automation-run-results (2026-11-06),
      troubleshoot-automations.
    - Air Mate: air-mate (2026-11-04), air-mate-connect, air-mate-work, air-mate-configure.
    - Окружения, проекты, редактор: source-control (2026-11-06), configure-environments (2026-11-06),
      create-an-environment, environment-images (2026-11-06), environment-variables-and-secrets,
      environment-network-access (2026-10-23), exposed-ports, startup-commands (2026-09-30), vm-resources (2026-09-30),
      share-an-environment, projects, project-members, project-connectors-and-secrets, connectors, air-teams-editor
      (2026-11-06).
    - Air Governance: air-governance, plans-and-pricing (2026-11-06), ai-credit-limits (2026-10-08),
      ai-policies-configure (2026-11-06), ai-agents (2026-11-06), ai-activity-and-impact, session-explorer
      (2026-11-03), analytics-api-v2 (2026-10-26), cloud-providers (2026-10-21), audit.
    - Air Gateway и Air Context: cli-about (2026-10-21), air-context (2026-11-12), context-indexing (2026-11-12),
      context-agent-integrations (2026-11-05), context-ci, context-security-and-privacy.
34. Документация Air Gateway (заголовок ещё JetBrains Central CLI) — <https://www.jetbrains.com/help/central-cli/>.
    Страницы: cli-about (2026-11-04), cli-in-depth (2026-11-04), cli-agents (2026-11-04),
    cli-supported-agents-and-features, troubleshooting (2026-10-16), quickstart. [34] без имени — страницы cli-about,
    cli-supported-agents-and-features и cli-agents вместе.
35. JetBrains AI, «Licensing and subscriptions» —
    <https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html> — без даты.

**Код**

36. Организация JetBrains на GitHub, прочитана через `gh`: <https://github.com/JetBrains/context> (создан 2026-03-17;
    коммит b184871 от 2026-11-11 на ветке main; последний push 2026-11-13; файла LICENSE нет, GitHub лицензию не
    определяет; hooks — `hooks/pre-tool-use.sh`, `hooks/post-tool-use.sh`, `hooks/user-prompt-submit.sh`);
    <https://github.com/JetBrains/skills> (создан 2026-02-12; файла лицензии верхнего уровня нет, API лицензии
    отвечает 404);
    <https://github.com/JetBrains/jcp-cli> (создан 2026-02-03; v0.8.4 от 2026-11-05); <https://github.com/JetBrains/junie>;
    <https://github.com/JetBrains/thinkrail>.
37. agentclientprotocol/claude-agent-acp, PR #350 «Authentication adjustments for JB integration» —
    <https://github.com/agentclientprotocol/claude-agent-acp/pull/350> — открыт 2026-02-26, merged 2026-03-03.

**Сторонние источники (вторичные для Air)**

38. Anthropic Help Center, «Use the Claude Agent SDK with your Claude plan» —
    <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan> — обновления
    2026-06-15 и 2026-10-07.
39. Zed, «Anthropic subscription changes» — <https://zed.dev/blog/anthropic-subscription-changes> — 2026-05-14,
    обновлён 2026-06-16.

**Трекеры задач JetBrains** (прочитаны через REST API; тексты задач и ответы сотрудников — материал вендора, комментарии
пользователей — вторичный источник)

40. YouTrack, проект AIR — трекер desktop-приложения — <https://youtrack.jetbrains.com/issues/AIR>. [40] без номера —
    список задач по голосам. Задачи (дата создания; итог, если известен):
    - AIR-2399 — версия для Linux (2025-10-07; выпущена 2026-06-03);
    - AIR-3137 — сбой setup окружения помечает задачу failed (2025-12-02; решена 2026-03-24);
    - AIR-3189 — Docker-контейнер без toolchains и sudo (2025-12-06; открыта; сообщение пользователя);
    - AIR-3201 — действие «log in to Claude» в раннем preview (2025-12-09);
    - AIR-3538 — перемещаемые панели (2026-01-24);
    - AIR-3540 — remote development (2026-01-24);
    - AIR-3779 — свои агенты через ACP (2026-02-12);
    - AIR-3928 — нет индикации кончившейся квоты Claude (2026-02-23; открыта);
    - AIR-3929 — полоса расхода лимита агента (2026-02-23; открыта);
    - AIR-4149 — AWS Bedrock (2026-03-09);
    - AIR-4152 — вход с подпиской Claude (2026-03-09; открыта, 94 голоса);
    - AIR-4195 — несколько проектов в одном окне (2026-03-10);
    - AIR-4415 — логи запуска приложения (2026-03-18);
    - AIR-4541 — свой base URL и заголовки (2026-03-25);
    - AIR-4789 — единая политика auto-approve (2026-04-09; открыта);
    - AIR-4844 — образ air-workspace (2026-04-13);
    - AIR-5079 — восстановление snapshot (2026-04-28);
    - AIR-5121 — планы, кнопка Implement, логи состояний задач (2026-04-30);
    - AIR-5394 — вход Gemini (2026-05-20);
    - AIR-5694 — fsdaemon и inotify watches (2026-06-11; открыта);
    - AIR-5711 — удалённое управление локальными задачами (2026-06-12; открыта);
    - AIR-5811 — WSL (2026-06-18);
    - AIR-6168 — смена модели через ACP (2026-07-06; исправлена 2026-07-13);
    - AIR-6469 — зависание «Stuck in Saving checkpoint» (2026-07-22);
    - AIR-6538 — undo из prompt (2026-07-26);
    - AIR-6724 — скорость git checkpoints (2026-08-09; решена 2026-08-31);
    - AIR-6809 — модуль Agent Driver (2026-08-13; решена 2026-09-22);
    - AIR-6837 — браузерный редактор на WebAssembly (2026-08-17);
    - AIR-6840 — refs checkpoints держат объекты (2026-08-17; открыта);
    - AIR-6842 — исчерпанный лимит в Review with Agent (2026-08-17; открыта);
    - AIR-6896 — падения при старте на Windows (2026-08-20);
    - AIR-6913 — подписка Claude появилась и исчезла (2026-08-21; открыта; ответ сотрудника 2026-08-24);
    - AIR-6953 — зависание сохранения checkpoint (2026-08-24);
    - AIR-7175 — обмен сообщениями между сессиями (2026-09-11; открыта);
    - AIR-7190 — sudo без пароля в образе air-workspace (решена 2026-10-02);
    - AIR-7464 — Toolbox больше не ставит приложение (2026-10-15; ответ сотрудника 2026-10-21);
    - AIR-7488 — будущее приложения (2026-10-21);
    - AIR-7551 — OpenCode и подписка Anthropic (2026-11-02);
    - AIR-7640 — перенос задач приложения (2026-11-13).
41. YouTrack, проект IJAI — трекер Air in IDEs — <https://youtrack.jetbrains.com/issues/IJAI>. [41] без номера —
    список задач по голосам. Задачи:
    - IJAI-1624 — около 215 процессов `git worktree list` (2026-08-27; исправлена 2026-09-21);
    - IJAI-2118 — Docker-сессии (2026-09-15; открыта);
    - IJAI-2501 — подписка Claude в plugin (2026-09-23);
    - IJAI-2625 — удаление сессий (2026-09-25);
    - IJAI-2739 — чат в tool window (2026-09-28; исправлена 2026-11-03);
    - IJAI-3469 — исключить Air из корпоративных пакетов IDE (2026-10-08; открыта);
    - IJAI-3764 — Air вытеснил AI Assistant (2026-10-12);
    - IJAI-4245 — единый выключатель AI (2026-10-19);
    - IJAI-5952 — невидимые запросы одобрения (2026-11-05);
    - IJAI-6049 — закрытие терминальной сессии через 60 секунд (2026-11-08);
    - IJAI-6125 — поведение при потере сети (2026-11-09; воспроизведено автоматической сортировкой задач JetBrains).

**Обсуждения (вторичные)**

42. Hacker News, анонс Air на air.dev — <https://news.ycombinator.com/item?id=46139905> — 2025-12-03.
43. Hacker News, «JetBrains cancels Fleet» — <https://news.ycombinator.com/item?id=46204668> — 2025-12-09.
44. Hacker News, пост о public preview — <https://news.ycombinator.com/item?id=47310076> — 2026-03-09.
45. Hacker News, обсуждение JetBrains Central — <https://news.ycombinator.com/item?id=47502170> — 2026-03-24.
46. Hacker News, пост о семействе Air — <https://news.ycombinator.com/item?id=49799287> — 2026-09-22.
47. Hacker News, обсуждение встроенного AI в IDE — <https://news.ycombinator.com/item?id=50446487> — 2026-11-10.
48. Hacker News, выход plugin — <https://news.ycombinator.com/item?id=50453129> — 2026-11-11.
49. Reddit r/Jetbrains, «JetBrains Air, and where we're heading», пост сотрудников JetBrains —
    <https://www.reddit.com/r/Jetbrains/comments/1wn9enk/jetbrains_air_and_where_were_heading/> — 2026-09-22; прочитан
    только текст поста.

**Добавлено при проверке фактов** (2026-11-13)

50. JetBrains, «JetBrains CEO Transition» — <https://blog.jetbrains.com/blog/2024/01/30/jetbrains-ceo-transition/> —
    2024-01-30; прочитан через RSS-ленту поста (`…/jetbrains-ceo-transition/feed/`), HTML-страница закрыта проверкой
    на ботов.

## Проверка фактов

Проверка 2026-11-13. Каждый источник открыт заново, ссылкам досье на слово не верили. Документация Air прочитана в
markdown-версиях страниц (`<страница>.html.md`, сборка документации 410 от 2026-11-13). Marketplace и product data
service прочитаны через их JSON API, трекер — через REST API YouTrack, GitHub — через `gh`, блог JetBrains — как HTML
или RSS. Все источники в таблице первичные. Строки с вердиктом «исправлено» поправлены в тексте досье. Ложных
утверждений, которые пришлось бы удалить, не нашлось.

| Утверждение | Вердикт | Источник |
|---|---|---|
| Desktop-приложение снято с загрузки 2026-11-11, последняя сборка 262.1102.13, установленные копии временно получают обновления; первая сборка 261.63.28 от 2025-12-01 только для macOS; Linux с 2026-06-02, Windows с 2026-06-29 | подтверждено | Product data service, код AIR, 39 сборок: <https://data.services.jetbrains.com/products/releases?code=AIR&type=release,eap,preview,rc,beta&latest=false> |
| Marketplace: 400 476 загрузок, 69 оценок (27×5★, 7×4★, 6×3★, 9×2★, 20×1★), `meanRating` около 4,07, последняя сборка 262.8665.532 от 2026-11-05 | исправлено: числа совпали, но 2026-11-13 около 16:30 UTC вышли сборки 262.8665.533 и 263.7307.291 без change notes | <https://plugins.jetbrains.com/api/plugins/33314>, `/rating`, `/updates` |
| Plugin бесплатен, распространяется по JetBrains Free Plugin License, отдельной лицензии не требует, работает во всех IDE JetBrains, кроме Android Studio | подтверждено | Marketplace API, поле `licenseUrl`; <https://www.jetbrains.com/help/air/air-in-ides-overview.html> (2026-11-06) |
| Открыт только код интеграций Air Context в JetBrains/context, CLI `jbcontext` закрыт; реестр skills — открытый репозиторий JetBrains/skills | исправлено: оба репозитория публичны, но файла лицензии нет ни в одном, так что условия переиспользования кода не указаны | README <https://github.com/JetBrains/context>; `gh repo view JetBrains/context` (`licenseInfo: null`); `gh api repos/JetBrains/skills/license` (404) |
| Цены JetBrains AI для частных лиц: AI Free — 3 credits за 30 дней, AI Pro — $10 и 10 credits, AI Ultimate — $30 и 35; для организаций: AI Pro — $20 и 20, AI Ultimate — $60 и 70, AI Enterprise — $60; купленные credits действуют 12 месяцев; в Китае сервис недоступен с 2026-07-13. Air Governance: Basic бесплатно, Business — $20 за место в месяц, trial 30 дней, Enterprise по запросу; SOC 2 Type II и GDPR; 1 credit = 1 USD расходов у провайдера; BYOK credits не тратит; GA с 2026-10-22 | подтверждено | <https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html>; <https://www.jetbrains.com/help/air/plans-and-pricing.html> (2026-11-06); блог [24], 2026-10-22 |
| В облаке работают только Claude Agent, Codex, Copilot и Junie, всегда на credits JetBrains AI. Подписка Claude Pro или Max работает только через Claude Code в терминале, чат Claude Agent требует JetBrains AI или API key Anthropic | подтверждено | <https://www.jetbrains.com/help/air/supported-agents.html> (2026-11-06); <https://www.jetbrains.com/help/air/air-in-ides-claude-subscription.html> (2026-10-30); блог [31], 2026-11-11 |
| Вход Codex через ChatGPT — со сборок 263.6259.49 и 263.6259.52 (2026-10-09 и 2026-10-12) | исправлено: впервые в change notes 2026-10-01 (сборки 262.8665.481 и 263.6259.32), и как исправление входа; более ранние сборки без change notes, дата появления не подтверждена | <https://plugins.jetbrains.com/api/updates/1184882> (262.8665.481), `/1185008` (263.6259.32) |
| Fleet — второе семейство IDE JetBrains; загрузки прекращены 2025-12-22 | исправлено: JetBrains только рассматривала Fleet как второе флагманское семейство IDE; дата прекращения загрузок подтверждена | Блог [7], 2025-12-08, дополнен в мае 2026 |
| Должность Kirill Skrygan не подтверждена | исправлено: CEO JetBrains с 2024-02-01 | Блог JetBrains [50], 2024-01-30 |
| Механизм 1: коммит и push в ветку задачи после каждого хода, никогда в main; две доработки — три коммита; ручные правки уходят в следующий коммит агента; 75 минут простоя — Suspended, 24 часа — Archived; resume возвращает диск, но не процессы | подтверждено | <https://www.jetbrains.com/help/air/tasks.html>, `run-tasks-in-cloud.html`, `what-is-air-teams.html` (все 2026-11-06) |
| Механизм 2: checkpoint через временный индекс (`git status --untracked-files=all`, `git update-index --add --remove --stdin`, `write-tree`); 40–130 с → около 3 с на 1,35 млн файлов; refs держат объекты без очистки; deadlock в `Git.exec` без timeout | подтверждено; фраза о том, что индекс и ветки пользователя не меняются, помечена как вывод | YouTrack <https://youtrack.jetbrains.com/issue/AIR-6724> (решена 2026-08-31), `AIR-6840` (открыта), `AIR-6953` (решена 2026-08-24) |
| Механизм 3: правило обработки изменений (No code changes, Push to source branch, Push to new branch, Create a PR); webhook `.../api/v1/events/automations/<id>` с `Authorization: ApiKey <token>`; JSON payload становится контекстом задачи | подтверждено | <https://www.jetbrains.com/help/air/automation-triggers.html> (2026-11-02) |
| Механизм 4: цепочка срабатывает только при успехе и передаёт summary, ссылки и ветки текстом; от зацикливания не защищена; шаг человека ждёт без timeout и без уведомления | подтверждено | <https://www.jetbrains.com/help/air/chained-automations.html> (2026-10-30), `person-automations.html` (2026-11-06) |
| Механизм 5: `X-Air-Webhook-Id` (`evt_<uuid>`, ключ идемпотентности), `X-Air-Webhook-Event`, `X-Air-Webhook-Format`; в payload `statusUrl`, `output.result`, `error {message, code}` | подтверждено | <https://www.jetbrains.com/help/air/automation-notifications.html> (2026-09-30) |
| Механизм 6: Enter ставит в очередь, Ctrl+Enter (⌘+Enter на macOS) отправляет сразу; Send now, правка, перестановка, пауза; запрос из очереди не отвечает на карточку разрешения; облачная очередь переживает перезагрузку страницы | подтверждено | <https://www.jetbrains.com/help/air/air-in-ides-settings.html> (2026-11-04), `air-in-ides-interact-with-the-agent.html`, `prompt-queue.html` (2026-11-06) |
| Механизмы 7 и 8: Code Notes уходят пачкой через «Finish & Attach Comments», в review одна сессия, с 2026-10-30 заметки доходят до терминальных агентов; commit message пишет скрытая сессия на Junie Lite с низким effort | исправлено: режим review недоступен для сессий в терминале, туда заметки прикладываются из поля ввода; для commit message по умолчанию берётся доступный агент с лёгкой моделью, например Junie Lite | <https://www.jetbrains.com/help/air/air-in-ides-review-changes.html> (2026-11-06); change notes 262.8665.521 от 2026-10-30: <https://plugins.jetbrains.com/api/updates/1208163> |
| Механизм 9: plugin читает файлы истории агентов, а не хранит копию | исправлено: историю агентов plugin читает, но держит и свои кэши сессий, которые чистит | Change notes 262.8665.497 (<https://plugins.jetbrains.com/api/updates/1195194>) и 262.8665.521; `air-in-ides-settings.html` |
| Механизм 10: `jbcontext setup-agent` ставит инструкции, skill, subagent, session hooks и MCP server; hooks хранят состояние в `/tmp/claude-context-hook-<session>.json` | исправлено: этот файл ведут hooks, которые следят за вызовами инструментов и по умолчанию не ставятся; skill по умолчанию не ставится для Codex | <https://www.jetbrains.com/help/air/context-agent-integrations.html> (2026-11-05); `hooks/pre-tool-use.sh` в JetBrains/context, коммит b184871 |
| Механизм 11: Junie Eco mode — компаньон GPT-6 Luna, средняя стоимость модели на задачу ниже на 48% и 57%, доля решённых задач изменилась меньше чем на пункт; платятся обе модели; с моделью Default режим включается сам | подтверждено; это внутренние benchmarks вендора | Блог [26], H. Klause, 2026-10-28; `air-in-ides-interact-with-the-agent.html` (2026-11-06) |
| Механизм 12: «Start Agent» пишет и проверяет конфигурацию, коммитит `.air/cloud/startup.sh` в отдельную ветку, окружение сохраняется как snapshot; script выполняется на каждом старте, timeout 600 с (настраивается от 1 до 3600), при ненулевом exit code агент всё равно стартует | подтверждено | <https://www.jetbrains.com/help/air/create-an-environment.html> (2026-11-06), `startup-commands.html` (2026-09-30); блог [18], 2026-09-28 |

Попутно сверены и подтверждены без правок:

- air.dev и его пути отвечают 301 redirect на <https://www.jetbrains.com/air/> (проверено `curl` 2026-11-13).
- Мобильное приложение: EAP 0.3.141 для iOS и Android от 2026-10-30 (product data service, коды AIRMI и AIRMA). Air
  Teams на телефоне обещан на 15 ноября [2].
- AIR-4152: 94 голоса, 40 комментариев, открыт с 2026-03-09 (REST API YouTrack). PR #350 в claude-agent-acp открыт
  2026-02-26 и merged 2026-03-03, добавляет опцию скрыть вход Claude Code (`gh pr view`).
- Netflix: обычно на 20–30% эффективнее, в лучшем случае около 65%, замеры июля–августа 2026 [22]. Air Context: до 70%
  меньше ходов агента [28].
- Air Governance: около 2 300 человек в JetBrains; расходы на AI выросли примерно в 10 раз за первую половину 2026 [24].
- Air Gateway: proxy на 127.0.0.1, порт 19516, timeout запроса 8 минут, один повтор после 401 или 403; Copilot по
  умолчанию на `gpt-5.6-luna` или `claude-opus-5` [34:cli-in-depth][34:cli-agents].
- Противоречие о сети по умолчанию есть в самих источниках: документация пишет о доступе в интернет
  [33:environment-network-access], пост 2026-10-14 — только о доменах систем контроля версий и пакетов [21].
- Air Mate: orchestrator на Grok; может мержить свои PR; авто-ответы в канале выключить нельзя
  [33:air-mate][33:air-mate-work].
