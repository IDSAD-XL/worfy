# Claude Code plugins and marketplaces — досье конкурента

- **Дата:** 2026-11-13. Документация Claude Code прочитана в этот день, дат обновления на её страницах нет.
  Официальный каталог прочитан на коммите `f75f5b25` от 2026-11-12 [63], репозиторий `anthropics/claude-code` — на
  коммите `e63d0404` от 2026-11-13 [41][79].
  - Квота поиска в вебе в этом исследовании кончилась на первых запросах. Почти всё ниже взято из первичных
    источников: документации, changelog, клонов репозиториев, GitHub API и issues. Reddit отказал в автоматическом
    чтении, X и YouTube не охвачены, интервью и доклады команды не найдены (не подтверждено).
- **Что это за продукт.** Не отдельное приложение, а слой расширений Claude Code. Он работает в CLI, во вкладке Code
  приложения Claude Desktop, в VS Code, JetBrains, облачных сессиях и Agent SDK [1][2]. Тот же формат ставится в
  claude.ai и Cowork (агентный режим Claude для любых ролей, с 2026-09-16 часть основного приложения Claude), но там
  грузится только часть компонентов [42][43][52][60]. Термины:
  - **плагин** — папка компонентов с необязательным манифестом `.claude-plugin/plugin.json`; ставится и грузится одним
    целым [1];
  - **marketplace** — git-репозиторий, папка или URL с файлом `.claude-plugin/marketplace.json`. Документация называет
    его "a catalog, not a hosted store" — то есть каталог, а не магазин на серверах Anthropic [1]. Плагин ставится как
    `имя@marketplace` [1];
  - **mod** (с 2026-10-01) — плагин с модулем на JavaScript или TypeScript. Модуль выполняется внутри процесса Claude
    Code, рисует панели и меняет вызовы инструментов [19][41].
- **Сайт:** документация — <https://code.claude.com/docs/en/plugins> [1]. Веб-каталог Claude Marketplace —
  <https://claude.com/marketplace/plugins> [44]. Directory (каталог Anthropic с проверкой) — портал авторов
  claude.ai/directory/manage [8][42].
- **Репозиторий и лицензия:**
  - Сам Claude Code — закрытый код. В репозитории `anthropics/claude-code` лежат changelog, issues и папки `plugins/`
    и `mods/`. Его LICENSE.md: все права у Anthropic, использование — по Commercial Terms of Service [79].
  - Официальный каталог <https://github.com/anthropics/claude-plugins-official> — Apache-2.0 [63]. Из 42 папок в
    `plugins/` 41 тоже под Apache-2.0. Исключение — `claude-security`: собственная лицензия Anthropic разрешает
    ставить, запускать и менять плагин только для внутреннего использования вместе с продуктами Anthropic. Она же
    запрещает передавать плагин третьим лицам и использовать плагин или любую его часть (prompts, описания agents и
    skills, workflows) вместе с продуктами не Anthropic или для их разработки, в том числе конкурирующих [72].
  - Каталог сообщества <https://github.com/anthropics/claude-plugins-community> — Apache-2.0 [76].
- **Вендор:** Anthropic. Boris Cherny указан как Head of Claude Code [61]. Доход Claude Code и число пользователей не
  найдены (не подтверждено).
- **Цена и планы:**
  - У плагинов нет своей цены, страница цен о них не говорит [46]. Платят расходом лимита: описания включённых
    плагинов занимают контекст каждого turn (одного ответа модели на сообщение), evals — это настоящие вызовы модели,
    а интеграциям через MCP нужны аккаунты в сторонних сервисах [1][7][42].
  - Платы за размещение и доли от продаж плагинов не найдено (не подтверждено) [1][8]. Подать плагин в directory можно
    только с платного плана [8].
  - Планы с Claude Code [46]:
    - Pro — $17 в месяц при оплате за год или $20 помесячно;
    - Max — $100 в месяц, 5× от Pro, плюс $100 кредитов API в месяц;
    - Ultra — $200 в месяц. У верифицированных аккаунтов нет 5-часового лимита. В неделю — 10× от Pro, плюс $200
      кредитов API в месяц;
    - Team — стандартное место $20 (за год) или $25 (помесячно), premium-место $100 или $125;
    - Enterprise — $20 за место в месяц плюс расход по ценам API, минимум 20 мест.
  - Ultra — бывший Max 20x, недельные лимиты у него остаются [47]. На Hacker News (дальше HN) эту смену прочитали как
    урезание с 20× до 10× [113].
- **Статус и активность:**
  - Публичная beta вышла 2025-10-09 в Claude Code 2.0.12 [48][41]. В текущей документации метки beta нет. Дата выхода
    из beta не найдена (не подтверждено).
  - Когда читалась документация, последним релизом Claude Code был 2.1.323 от 2026-11-12. Вечером 2026-11-13 вышел
    2.1.325 (npm и GitHub Release); версия 2.1.324 есть только в npm, в changelog её нет [41]. За сентябрь и октябрь
    2026 в changelog около 330 строк о плагинах и marketplaces [41].
  - `claude-plugins-official` создан 2025-11-20. Звёзд 47 075 и forks 4 885 по одному замеру, 47 090 и 4 886 по
    другому; оба замера сделаны 2026-11-13 [63]. За всё время в нём 5 705 PR (4 075 merged) и 1 333 issues; открыто
    1 296 issues и PR вместе [63]. Доля PR от ботов не посчитана (не подтверждено).
  - Размер каталогов: официальный — 316 записей [63], Claude Marketplace — 530 плагинов [44], каталог сообщества —
    2 283 записи [76]. Как связаны числа 530 и 2 283, источники не говорят (не подтверждено).
  - В `anthropics/claude-code` у метки `area:plugins` 836 открытых issues из 2 493 [105].
  - Установки по страницам плагинов на claude.com [45]: frontend-design — 1 134 112, superpowers — 1 009 371,
    code-review — 438 525, context7 — 417 801, feature-dev — 256 017, ralph-loop — 196 527, pr-review-toolkit —
    114 856. Все семь чисел перепроверены на страницах плагинов 2026-11-13; адреса `claude.com/plugins/<имя>` теперь
    ведут на `claude.com/marketplace/plugins/<имя>` [45].
- **Одной фразой:** формат пакетов и система каталогов Anthropic, которые доставляют в Claude Code skills, subagents,
  hooks, MCP и LSP серверы и workflows, а с октября 2026 ещё и mods — код, меняющий интерфейс и поведение самого
  Claude Code.

## Модель работы

- **Local, cloud или hybrid — hybrid.**
  - Плагины ставятся и выполняются на машине пользователя. Файлы лежат в `~/.claude/plugins/` [13]. Hooks, monitors,
    MCP и LSP серверы — локальные процессы с правами пользователя [14].
  - Каталоги — git-репозитории, папки или URL. Directory и Claude Marketplace — облачные сервисы Anthropic [1][8][44].
  - Облачные сессии на claude.ai/code не грузят плагины, поставленные пользователем, и плагины, которые включает
    репозиторий. Они грузят плагины из managed settings (настроек, которые задаёт администратор) и плагины,
    синхронизированные с аккаунта claude.ai [2][37][38].
- **Поверхности:** CLI в терминале, вкладка Code в Desktop, VS Code, JetBrains, облачные сессии, Agent SDK, GitHub
  Action `claude-code-action`, а также claude.ai и Cowork с урезанным набором компонентов [2][36][39][81][42][43].
- **ОС для CLI:** macOS 13+, Windows 10 1809+ или Server 2019+, Ubuntu 20.04+, Alpine 3.19+ [40]. В Desktop плагины не
  грузятся в сессиях WSL [36].
- **Агенты и модели.**
  - Только Claude. Агенты плагинов закрепляют модель: `sonnet`, `opus`, `haiku` или `inherit` (модель сессии)
    [67][68][69].
  - Mods работают с Anthropic API, Bedrock, Agent Platform от Google Cloud, Foundry и LLM gateways [19].
  - Встроенный mod загружает `AGENTS.md` [19].
  - Поддержки агентов других вендоров, например Codex, внутри Claude Code не найдено (не подтверждено).
  - Между вендорами переносится стандарт Agent Skills (открытый формат skills). У него 46 клиентов, среди них ChatGPT
    и Codex, Cursor, GitHub Copilot, Gemini CLI, OpenHands и Factory [62].
  - Формат `.claude-plugin` читают и другие вендоры. GitHub Copilot CLI ищет `marketplace.json` и `plugin.json` в том
    числе в папке `.claude-plugin/` [115]. Приложение ChatGPT (Codex) читает `.claude-plugin/marketplace.json` как
    legacy-compatible marketplace [116]. Портал OpenAI принимает архив плагина Claude Code и сам переводит
    `.claude-plugin/plugin.json` в свой манифест, но hooks, commands и agents для публичного каталога OpenAI надо
    убрать или переделать в skills [117].
  - Есть и общий стандарт плагинов — Agent Plugins 1.0.0 (тег от 2026-09-28): `plugin.json` в корне, skills и MCP
    серверы. В его TSC — Amazon, Cursor, Microsoft, OpenAI и Vercel. Среди совместимых клиентов — VS Code, Cursor,
    GitHub Copilot, ChatGPT и Codex, Kiro, OpenHands. Claude в этом списке нет, документация Claude Code формат не
    упоминает [118].
- **Один пользователь или команда — оба режима.**
  - Один пользователь ставит плагины в scope (уровень установки) user или local [2].
  - Команда коммитит scope project в `.claude/settings.json`. Каждый участник всё равно ставит плагин один раз на свою
    копию репозитория [2].
  - Организация управляет плагинами через managed settings, консоль claude.ai и Analytics API на плане Enterprise
    [12][42][9].

## Функции

### Каталоги и уровни доверия

- **Три уровня marketplace — по имени каталога** [1][14].
  - Official — 14 зарезервированных имён, например `claude-plugins-official`, `knowledge-work-plugins`,
    `claude-for-legal`, `claude-for-financial-services`, `claude-tag-plugins` и `first-party-plugins` [1][14].
  - Community — `claude-community`, `claude-plugins-community` и `healthcare` [14].
  - Third-party — все остальные имена.
  - Имена уровней official и community принимаются только из `github.com/anthropics/`. Marketplace, который выдаёт
    себя за зарезервированное имя, отклоняется с версии 2.1.280 (2026-09-22) [14][41].
- **Официальный marketplace** `claude-plugins-official` Claude Code добавляет сам при первом интерактивном запуске в
  терминале [1][3]. С какой версии так делается, не выяснено (не подтверждено).
- **Marketplace сообщества** пользователь добавляет сам [3]. Это read-only зеркало: его каждую ночь синхронизирует
  внутренний конвейер проверки Anthropic, а PR закрываются автоматически [76].
- **Тематические marketplaces Anthropic** — например `anthropics/skills` и `knowledge-work-plugins` [3].
- **Directory** — каталог на claude.ai с проверкой. Авторы подают плагины через портал claude.ai/directory/manage.
  Плагин из directory попадает в Claude Code через синхронизацию аккаунта и называется `<name>@synced` [3][8].
- **Claude Marketplace** — отдельный сайт claude.com/marketplace.
  - Показывает число установок и метку «Anthropic verified» [3][44]. Условия этой метки не найдены (не подтверждено).
  - На сайте 530 плагинов и фильтр «Works with: Claude / Claude Code» [44].
  - Список начинается с Frontend Design, Superpowers, Code Review, Context7, Code Simplifier, Playwright, GitHub. Что
    означает порядок, страница не говорит [44].
  - Кроме плагинов там есть connectors, продукты партнёров и сервисные партнёры [50].
- **Три разных понятия:** directory — проверяемый каталог на claude.ai; Claude Marketplace — сайт со списком;
  marketplace — git-каталог [1][3][50].
- **Старый marketplace** `claude-code-plugins` внутри `anthropics/claude-code` устарел. С 2026-10-26 он ставит плагины
  из `claude-plugins-official` [3][78]. Плагин `ralph-wiggum` переименован в `ralph-loop`, плагин
  `claude-opus-4-5-migration` выведен [3].

### Где пользователь видит плагины

- **Панель `/plugin` в терминале** (алиасы `/plugins` и `/marketplace`) [2][6]. Вкладки:
  - **Discover** — поиск по вводу. Карточка плагина показывает:
    - «Will install» — какие commands, agents, skills, hooks, MCP и LSP серверы добавит плагин;
    - для плагинов официального marketplace — «Last updated» и **Context cost** с двумя цифрами: «Every turn» (токены
      в каждом turn) и «When invoked» (токены при вызове) [2];
    - строка «Every turn» подсвечивается от 2 000 токенов [9].
  - **Installed** — фильтр по вводу, Space включает и выключает, **f** добавляет в избранное. В карточке —
    Disable/Enable, Update now, Uninstall, Configure options и Configure [2].
    - Группа «Not used recently» собирает плагины, которыми не пользовались 14 дней и 10 сессий. У каждого плагина
      есть строка «Last used» [9].
    - Группа «Built-in» показывает встроенные mods. Тусклая строка вида `1 mod active · name` считает загруженные mods
      [19].
  - **Marketplaces** — просмотр каталога, обновление списка, переключатель auto-update, удаление. Удаление marketplace
    удаляет и его плагины [2].
  - **Errors** — почему плагин не загрузился [2].
  - **Stats** — только там, где есть `/skill-doctor` [6].
- **Установка** [2][6].
  - `/plugin install x@m` открывает карточку плагина. Пользователь выбирает scope: user, project или local.
    Объявленные зависимости ставятся вместе с плагином.
  - Итог — одно из четырёх: плагин активен; MCP серверу нужна настройка; нужна перезагрузка; ошибка загрузки.
  - Закрытие панели само запускает `/reload-plugins`. Если перезагрузка сбросит prompt cache (кэш начала запроса на
    стороне API), команда предупреждает и ждёт. Флаг `--force` применяет её ценой одного запроса без кэша.
- **CLI в shell** [6][2].
  - `claude plugin install|uninstall|enable|disable|update|list|details|configure|prune|init|eval|tag|test|validate`.
  - `claude plugin marketplace add|list|remove|update`.
  - Вывод `--json` — с 2.1.268. Флаг `-y` или `--accept-command <sha256>` принимает источник типа command.
  - `--marketplace <source>` — установка в один шаг: добавить marketplace, если его ещё нет, и поставить плагин.
    Внутри сессии `/plugin install <плагин> --marketplace` работает с 2.1.275, команда shell `claude plugin install`
    получила этот флаг в 2.1.292. Это два разных входа, а не расхождение версий [41][6][8].
- **Desktop, вкладка Code.** «+ → Add plugins» открывает браузер плагинов с теми же scopes. В сессиях WSL плагины не
  грузятся [36].
- **VS Code.** `/plugins` открывает диалог «Manage plugins» с вкладками Plugins и Marketplaces. Изменения доходят до
  открытых сессий без перезапуска. Есть форма опций и всплывающие окна с ошибками [2][41].
- **JetBrains** — тот же поток, что в терминале. В запусках `claude -p` (неинтерактивный режим) команды `/plugin` нет,
  но поставленные плагины грузятся [2].
- **Agent SDK** принимает только плагины вида `{type:"local", path}` [39].
- **GitHub Action** `claude-code-action` — входы `plugins` и `plugin_marketplaces` [81].
- **Облачные сессии** (claude.ai/code) [2][37][38][41].
  - Браузера плагинов нет.
  - Плагины, поставленные пользователем, и плагины, которые репозиторий включает в `.claude/settings.json`, не
    грузятся.
  - Грузятся плагины из managed settings и плагины, синхронизированные с claude.ai. Запланированные облачные запуски
    грузят плагины аккаунта с 2.1.314 (2026-10-30).
  - Claude может предложить плагин карточкой «Add» прямо в разговоре.
  - Противоречие: по документации синхронизированные плагины в облаке грузятся [37][38], а пользователи сообщают, что
    плагины уровня аккаунта до claude.ai/code не доходят [99].
- **claude.ai и Cowork** [42][43].
  - Customize > Plugins: Discover, Add marketplace, Upload plugin (`.zip` или `.plugin`), «Create with Claude» или
    редактор файлов.
  - Установки идут на аккаунт и на организацию и синхронизируются в Claude Code.
  - Ограничения: до 25 своих marketplaces, до 5 000 файлов и 200 MB на плагин. Плагин с папкой `bin/` в корне не
    принимается [4][43].
  - Перед отправкой файлов плагина claude.ai и Cowork ищут в них секретные ключи (2.1.323) [41].
  - По странице platform support Claude Code 2.1.287+ открывает directory командой `/plugin directory` [43]. В таблице
    команд справки CLI её нет [6] (не подтверждено).

### Компоненты плагина

- **Skills** — `skills/<имя>/SKILL.md`, вызов `/<плагин>:<skill>`. Имя и описание лежат в контексте каждый turn, тело
  грузится при вызове [1][4].
  - Описание в списке skills обрезается до 1 536 символов [32].
  - Frontmatter (YAML-заголовок файла): `allowed-tools` (разрешение на один turn), `context: fork` с полем `agent`
    (запуск в subagent), `hooks` (hooks только этого skill), `paths`, `model` и `effort` [32].
  - Строки с `!` в начале выполняются в shell до того, как модель увидит текст [32].
- **Commands** — `commands/*.md` или поле `commands` манифеста: источник или текст, `argumentHint`, `model`,
  `allowedTools` [4][5]. 2026-01-09 commands слили со skills, `commands/` теперь старый формат [41][4].
- **Agents (subagents)** — `agents/*.md` [4].
  - Поддержаны поля `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`
    (user/project/local), `background`, `omitClaudeMd`, `isolation: worktree`, `autoCompactWindow` [4][29][41].
  - Для агентов плагина игнорируются `permissionMode`, `hooks`, `mcpServers` и `initialPrompt`. Агент плагина не может
    сам поднять себе режим разрешений [4][29].
- **Hooks** — `hooks/hooks.json`, формат как у hooks в настройках [4].
  - Пять типов обработчика: shell-команда, HTTP-запрос, вызов MCP tool, prompt модели, subagent [4][25].
  - Hooks регистрируются при загрузке плагина и срабатывают в каждой сессии, а не только при вызове его skills [4].
- **Mod** — поле `modules` в `hooks/hooks.json`. Это JS/TS внутри Claude Code; подробнее — в подразделе «Mods» ниже
  [4][19].
- **MCP серверы** (MCP, Model Context Protocol — протокол, через который модель подключает внешние инструменты) —
  `.mcp.json` или поле `mcpServers`. Также пакеты `.mcpb` — упакованные MCP серверы со своими настройками
  `user_config` [4][2].
- **LSP серверы** (LSP, Language Server Protocol — сервер языка: ошибки, переходы к определениям) — поле `lspServers`:
  `command`, `extensionToLanguage`, `restartOnCrash`, `maxRestarts`, таймаут запроса (по умолчанию 60 с). Диагностика
  после правок попадает в контекст [5][15].
- **Исполняемые файлы** — папка `bin/` добавляется в PATH инструмента Bash после записей пользователя. Поэтому плагин
  не может подменить, например, `git` [4]. claude.ai и Cowork не принимают плагин с `bin/` в корне [43].
- **Настройки по умолчанию** — `settings.json`. Действуют только `agent` (устарел в 2.1.323) и `subagentStatusLine`
  [4][41]. Чем управлял `agent`, не выяснено (не подтверждено).
- **Themes и output styles** — `themes/*.json` (experimental) и `output-styles/*.md` [4].
- **Channels** — MCP сервер плюс запись `channels` со своими вопросами настройки. Статус — research preview (ранняя
  исследовательская версия) [4][33].
- **Monitors** — `monitors/monitors.json`: фоновая shell-команда, её вывод приходит Claude как уведомления. Поле
  `when` — `always` или `on-skill-invoke:<skill>`. В `-p` monitors не работают, из плагинов уровня репозитория не
  грузятся [4][5][13].
- **Workflows** — `workflows/*.js`, вызов `/<плагин>:<workflow>`. Это скрипты, которые управляют десятками и сотнями
  subagents [5][27].
- **userConfig** — типизированные опции: string, number, boolean, directory, file. Claude Code спрашивает их при
  включении плагина и в `claude plugin configure`. Значения с `sensitive: true` уходят в защищённое хранилище
  [5][6][4].
- **Зависимости и engines** — зависимости от других плагинов с диапазонами semver (`^2.0`, `~2.1.0`).
  `engines["claude-code"]` — диапазон версий самого Claude Code [16][41].
- **Пространства имён** — skills и commands вызываются как `/плагин:имя`, агенты — как `плагин:sub:имя`, MCP tools —
  как `mcp__plugin_<плагин>_<сервер>__<tool>`. Двоеточие зарезервировано под это [4][35][41].
- **Хранилище данных** — `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`) переживает обновления плагина;
  появилось в 2.1.78 (2026-03-17) [4][13][41].

### Установка, scopes, обновления и зависимости

- **Scopes** [2]:
  - user — запись в `~/.claude/settings.json`;
  - project — `.claude/settings.json` в репозитории. Файл коммитится, но каждый участник ставит плагин один раз на
    свою копию;
  - local — `.claude/settings.local.json`;
  - при конфликте local важнее project, project важнее user.
  - Флаг `defaultEnabled: false` ставит плагин выключенным [2][5].
- **Зависимости** [2][16]:
  - ставятся вместе с плагином в тот же scope;
  - плагин, от которого зависит другой включённый плагин, выключить нельзя. Claude Code печатает команду, которая
    выключит оба по порядку;
  - лишние зависимости удаляет `claude plugin prune`.
- **Обновления** [2][13]:
  - auto-update по умолчанию включён для официальных имён (кроме `knowledge-work-plugins` и `first-party-plugins`) и
    для marketplaces с claude.ai. Для community, third-party и локальных marketplaces он выключен [2];
  - обновление скачивается после старта сессии и грузится в следующей сессии или после `/reload-plugins` [2][13];
  - обновить можно один плагин или все плагины одного marketplace. Команды «обновить всё» нет [2];
  - переключатель auto-update для каждого marketplace появился в 2.0.70 (2025-12-15), после issue с +65 [41][94].
- **Перезагрузка без перезапуска** — `/reload-plugins` (2.1.69, 2026-03-05) [41]. Monitors требуют полного перезапуска
  [13].

### Источники плагинов и доставка

- **Типы источника в marketplace** [18][41][63]:
  - относительный путь, `github`, git URL, `git-subdir` (sparse checkout — выгрузка только части репозитория);
  - `npm` — через `npm pack --ignore-scripts`, с проверкой целостности с 2.1.275;
  - `archive` — zip по HTTPS с необязательной фиксацией SHA-256 (2.1.224);
  - `command` (2.1.229) — локальная программа печатает путь к папке плагина. Плагин Xcode от Apple использует
    `xcrun agent plugin path --plugin-format claude`. Claude Code запускает такую программу при установке, при
    обновлении и раз в сессию [18];
  - запись прямо в настройках.
  - Git-источник можно закрепить полным 40-символьным `sha` [18].
  - Режим `strict` решает, кто задаёт компоненты: запись marketplace или `plugin.json` [18].
- **Частные каталоги** используют git-учётные данные машины и никогда их не спрашивают. Работают GitHub Enterprise
  Server, GitLab, Azure DevOps и CodeCommit. `headersHelper` (2.1.238) выпускает короткоживущие токены [2][41].
- **Каналы релизов** — два marketplace, закреплённые на разных ref. Переименования плагинов задаёт словарь `renames`,
  он переносит существующие установки [12][63].
- **Контейнеры и CI.** При сборке образа плагины кладут в папку через `CLAUDE_CODE_PLUGIN_CACHE_DIR`. При запуске эту
  папку указывают в `CLAUDE_CODE_PLUGIN_SEED_DIR` [12].
- **Синхронизация с claude.ai.** Плагины, включённые на аккаунте, грузятся в терминале как `<name>@synced` с полным
  доверием. Синхронизация идёт один раз в фоне на каждом старте. Отключение — `syncClaudeAiPlugins:false` [13][41].
  - Версии расходятся: страница загрузки требует 2.1.273+ [13], changelog отмечает функцию в 2.1.275 (2026-09-17)
    [41].

### Инструменты автора плагина

- **Заготовка** — `claude plugin init <name> --with skills agents hooks mcp lsp output-style channel` (2.1.157,
  2026-05-29). Команда пишет «skills-directory plugin» в `~/.claude/skills/<name>`. Такой плагин грузится сам как
  `<name>@skills-dir`, без установки. Та же структура в `<repo>/.claude/skills/` делит плагин с репозиторием
  [6][17][41].
- **Загрузка на одну сессию** — `--plugin-dir` (папка, zip или папка с плагинами), `--plugin-url` (zip по ссылке),
  переменная `CLAUDE_CODE_PLUGIN_DIRS`. Администратор может запретить все три через `disableSideloadFlags` [6].
  2026-03-14 `--plugin-dir` ограничили одним путём, 2026-09-08 снова разрешили папку с плагинами [41].
- **Проверка** — `claude plugin validate [--strict] [--json]`. Проверяет манифест и записи MCP, подсказывает строку
  установки для README, для mod печатает его `hooks:` и `calls:` [6][19]. С 2.1.323 проверяет типы TypeScript в mods
  [41].
- **Evals** — `claude plugin eval` (2.1.269, 2026-09-11) [7][41]:
  - случаи лежат в `evals/`. У каждого есть prompt и проверки (graders) шести типов: `regex`, `tool_used`,
    `tool_order`, `file_exists`, `llm` (рубрика для модели-судьи) и `baseline` (сравнение с эталонным транскриптом);
  - каждый запуск — свежая изолированная сессия `-p`. Случай по умолчанию идёт 3 раза, порог прохождения по умолчанию
    1.0;
  - каждый случай идёт и без плагина. Отчёт показывает WITH, W/OUT и разницу Δ;
  - по умолчанию (`--mocks record`) настоящие MCP серверы плагина не запускаются: вызовы их tools отвечают из
    mock-файлов. Настоящие серверы стартуют только с `--allow-real-servers` или `--mocks off`. Exit code может
    останавливать CI;
  - результат — самодостаточный `report.html` (у подписчиков он сам публикуется как приватный artifact на claude.ai) и
    JSON;
  - `eval init` помогает собрать набор случаев в диалоге;
  - запуски расходуют лимит плана. Запуск, который упёрся в лимит, получает 0, а вся команда завершается с
    ненулевым exit code.
- **Тесты mods** — `claude plugin test` шлёт события, подменяет ответы Claude Code и нажимает кнопки без сессии и без
  сети [6].
- **Расход контекста** [9][41]:
  - `claude plugin details` печатает «Always-on» (постоянный расход токенов) и разбивку по компонентам — сколько
    уходит всегда и сколько при вызове;
  - `/usage` показывает долю расхода каждого плагина на Pro, Max, Ultra, Team и Enterprise;
  - `/doctor` советует выключить неиспользуемые плагины;
  - цифры в `claude plugin details` и в браузере плагинов появились в 2.1.139 и 2.1.143 (2026-05-11 и 2026-05-15).
- **Теги релизов** — `claude plugin tag` создаёт тег `<name>--v<version>`, проверив, что версии в манифесте и в
  marketplace совпадают [6].
- **`/skill-doctor`** — команда появилась 2026-09-04 [41]. От неё зависит вкладка Stats [6].
- **Расширения пишет сам Claude** — встроенный skill `plugin-authoring` пишет mods, `claude plugin eval init`
  предлагает случаи, на claude.ai есть «Create with Claude» [23][7][42].

### Публикация и продвижение

- **Свой marketplace** — без формы и без проверки [8].
- **Directory** [8][42]:
  - нужен платный план. Pro, Max и Ultra подают сами. В Team подаёт Owner. В Enterprise — Owner или участник, которому
    Owner дал право Directory через свою роль [8];
  - каждая версия проходит автоматическую проверку и security scan, каждое новое размещение — проверку человеком [42];
  - официальный marketplace заявки из портала не берёт. Попасть туда можно только через контакт с партнёрской командой
    Anthropic [8].
- **README официального каталога** (2026-11-12): PR в репозиторий не отслеживаются, все плагины подаются через портал,
  а `marketplace.json` сокращают до плагинов самой Anthropic [63][64].
- **Подсказки из CLI вендоров.** Если задана переменная `CLAUDECODE` (или `CLAUDE_CODE_CHILD_SESSION` с 2.1.172), CLI
  вендора может напечатать в stderr `<claude-code-hint v="1" type="plugin" value="x@claude-plugins-official"/>`.
  Claude Code убирает эту строку из вывода и предлагает установить плагин. Пределы: одно предложение за сессию, одно
  за всё время на плагин независимо от ответа и ни одного после 100 предложенных плагинов на машине. Работает только
  для marketplaces уровня official [10].
- **Relevance** (сигналы, что плагин подходит к работе).
  - Организация добавляет блоки `relevance` в записи своего marketplace.
  - Совпадение по рабочей папке, прочитанным файлам или запущенным командам даёт подсказку у spinner, уведомление на
    старте сессии и закрепление вверху Discover.
  - Сопоставление идёт локально, ничего не ставится само. Администратор должен добавить marketplace в allowlist [11].
- **Предложение LSP плагина** — диалог после того, как Claude правит подходящий файл. Не чаще раза за сессию; после
  пяти проигнорированных диалогов выключается сам [15].
- **Предложение в разговоре** — карточка «Add» в облачных сессиях [2]. У Claude есть tool `ListPlugins` для плагинов,
  включённых на аккаунте [41].

### Mods (с 2026-10-01)

- **Что это** — обработчики событий на JS/TS внутри процесса Claude Code [19]. По документации включены по умолчанию с
  2.1.287 в терминале и с 2.1.286 в Desktop [19]. Противоречие: пользователи сообщают, что mods выключали удалённо,
  пока документация называла их включёнными по умолчанию (#99130) [99].
- **Что умеют** [19][20][21]:
  - рисовать **pane** (панель рядом с перепиской) или **band** (полосу над полем ввода) с вкладками, кнопками и
    полями;
  - менять вид встроенных частей: строк вызовов tools, spinner, диалога AskUserQuestion. Окно запроса разрешения
    менять нельзя;
  - задерживать, переписывать вызов tool или prompt или отвечать на него; отправить отдельный запрос в другую модель;
  - добавлять `/commands`, которые работают без turn Claude, и регистрировать новые tools.
- **Места отрисовки:** Pane (сбоку или в потоке), AbovePrompt, вставленные строки переписки, Backdrop (desktop и
  mobile), UserMessage, AssistantMessage, ToolUse/Result/Group, CommandOutput, AskUserQuestion, Spinner, TurnDuration,
  InfoNotice, SessionMode, PromptHint [21].
- **Элементы:** Text, Markdown, Link, Code (включая diff), Box, Button, Input, Select, Raster, Svg, Image, Client.
  Image рисуется в kitty, Ghostty и iTerm2. Client — область, которую рисует второй файл, для анимации и работы с
  мышью [22].
- **API `$`** [20][21]:
  - `$.model.complete` и `$.model.fork` — вызов модели с prompt caching за счёт плана пользователя. `maxTokens` по
    умолчанию 1024, максимум 64k;
  - таймеры `$.clock.every`, `after` и `sleep`;
  - сообщения пользователю: `$.ui.status`, `toast`, `log` и `notify`. `notify` шлёт уведомление ОС через
    `preferredNotifChannel` пользователя;
  - `$.prompt.submit({text, asUser})` запускает turn, когда сессия освободится;
  - `$.session.send` пишет другой сессии, subagent или участнику команды агентов;
  - `$.agent.spawn` запускает агента [20];
  - `$.session.usage()` возвращает расход контекста, `rateLimits[{kind, percentUsed, resetsAt}]` и стоимость. Событие
    `session.measure` приходит после каждого turn и при смене процента лимита плана;
  - доступ к файлам, процессам и сети: `$.fs`; `$.process.run` и `spawn` (по умолчанию 30 с, максимум 10 мин);
    `$.http.fetch` (30 с, 4 MiB);
  - состояние: `$.store` — 4 MiB JSON; `$.state` — значения между перерисовками;
  - с 2.1.321 собственные `$.tool.call` и `$.mcp.call` у mod проходят без запроса разрешения, deny rules при этом
    действуют [41].
- **События:** tool.call, tool.check, tool.list; события prompt; skill.prompt; turn.start, turn.step, turn.complete;
  session.start, end, compact, receive, send, append, measure; agent.offer, agent.spawn; ui.render; settings.read
  [21].
- **Лимиты** [21]:
  - обработчик работает до 10 с на событие, для `prompt.edit` — до 50 мс;
  - перерисовка — до 10 раз в секунду, в терминале до 30;
  - в дереве отрисовки до 20 000 элементов, вставленных строк — до 500 на mod;
  - pane открывается сам только при ширине терминала от 144 колонок.
- **Где работают.** Hooks mods работают везде: в `-p`, SDK, Remote Control (управлении сессией с другого устройства),
  облачных сессиях и у всех провайдеров моделей. Отрисовка есть только в терминале, во вкладке Code в Desktop и в VS
  Code с 2.1.299 [19].
- **Создание.** Пользователь описывает mod словами, встроенный skill `plugin-authoring` пишет его в
  `~/.claude/dev-mods/<session-id>/`. После одного одобрения mod перезагружается в конце каждого turn [23]. С 2.1.321
  mods, которые написал сам Claude, включаются без вопроса в режимах auto и bypass [41].
- **Встроенные mods.** Таблица на странице Mods overview (по её словам, неполная) называет шесть записей: agents-md
  (загружает `AGENTS.md`), diff (pane для `/diff`), plugin-authoring (только skill для написания mods, без кода mod),
  sec-default (guard политики организации), telemetry и you-should-know — side agent (агент рядом с основной сессией,
  который подсказывает); последний выключен, пока его не включат [19]. В папке `mods/` репозитория Claude Code лежат
  agents-md, diff, privacy, sec-default и telemetry [77]. Mod `privacy` отклоняет вызовы tools, которые отправили бы
  email аккаунта как идентификатор клиента [77].
- **Примеры от Anthropic:** token-weather, blast-radius, replay-theater [80].
- **Безопасность и управление** [19][24]:
  - mods не в sandbox и работают с правами пользователя;
  - mod может сам одобрять вызовы tools, если не загружен встроенный guard `sec-default`. Guard грузится на машинах с
    managed settings и при входе через Team или Enterprise. С ним deny и ask rules и hooks `PreToolUse` важнее mod
    [19][24]. Одна заметка описывает guard как включённый по умолчанию [19];
  - собственные вызовы mod через `$.fs` и `$.process` не проходят через правила разрешений [19];
  - выключатели: `--safe-mode`, `disableAllHooks` и администраторский `allowManagedModsOnly`. Организация может
    провести свою политику собственным mod [24].

### Плагины Anthropic в официальном каталоге

- **Состав `marketplace.json` на 2026-11-12** [63]:
  - 316 записей. 54 хранятся в самом репозитории, 262 — внешние: 163 по git URL, 98 через `git-subdir`, 1 через
    command. 261 запись закреплена на SHA [63][65];
  - категории: development 123, productivity 70, database 39, monitoring 22, security 18, deployment 9, design 8,
    automation 3, learning 3, location 2, testing 2, math 2, migration 1, без категории 14;
  - по полю author: Anthropic 40, Google LLC 14, SAP SE 9, Amazon Web Services 7, Pendo 5; у 82 записей автора нет;
  - в папке `plugins/` 42 папки, в `external_plugins/` 14 [63]. Одна заметка насчитала 40 плагинов Anthropic в
    `plugins/`, другая — 42 папки. Первое число совпадает с числом записей с автором Anthropic, второе — с числом
    папок;
  - `external_plugins/`: asana, context7, discord, fakechat, firebase, github, gitlab, imessage, laravel-boost,
    linear, playwright, serena, telegram, terraform [63];
  - рост официального каталога: 30 записей (2025-11-25), 40 (2026-01-01), 56 (2026-03-01), 206 (2026-06-01), 291
    (2026-09-01), 315 (2026-10-15), 316 на коммите `f75f5b25` (2026-11-12). Вечером 2026-11-13 на коммите `893173fb`
    записей 317: добавлен `theme-examples` (PR #7116). С октября каталог почти не растёт [63];
  - каталог сообщества: 814 (2026-04-01), 2 201 (2026-06-01), 2 307 (2026-08-01), сейчас 2 283 [76].
- **ralph-loop** (v1.0.1) — цикл «повторяй prompt, пока не готово» [66]:
  - команды `/ralph-loop "<prompt>" --max-iterations N --completion-promise "TEXT"` и `/cancel-ralph`;
  - Stop hook не даёт сессии закончиться и снова подаёт тот же prompt;
  - состояние лежит в `.claude/ralph-loop.local.md`: iteration, max_iterations, completion_promise, session_id. Id
    сессии нужен, чтобы цикл не блокировал другие сессии в том же проекте;
  - цикл кончается, когда текст внутри `<promise>` в последнем ответе точно совпал с заданным, или на max iterations.
    По умолчанию итерации не ограничены;
  - на Windows hook требует Git Bash;
  - README приводит результаты: 6 репозиториев за ночь и контракт на $50k за $297. Это заявления автора идеи, их никто
    не проверял (не подтверждено);
  - лимиты подписки плагин не обрабатывает.
- **feature-dev** (v1.0.1) — команда `/feature-dev` из 7 фаз [67]:
  1. Discovery.
  2. Exploration — 2–3 параллельных агента `code-explorer`, каждый возвращает 5–10 ключевых файлов.
  3. Уточняющие вопросы. В тексте команды фаза помечена как обязательная.
  4. Architecture — 2–3 агента `code-architect` с разными целями: минимальное изменение, чистая архитектура,
     прагматичный баланс. Пользователь выбирает вариант.
  5. Implementation. Без одобрения пользователя фаза не начинается.
  6. Review — 3 параллельных агента `code-reviewer`: простота, ошибки, соглашения. Показываются находки с уверенностью
     от 80. Пользователь выбирает: исправить сейчас, позже или идти дальше.
  7. Summary.
  - Все три агента работают на `model: sonnet` и только читают: Glob, Grep, LS, Read, WebFetch, WebSearch и подобные.
    Edit, Write и Bash у них нет.
- **pr-review-toolkit** (v1.0.1) [68]:
  - `/pr-review-toolkit:review-pr [comments|tests|errors|types|code|simplify|all] [parallel]`. По умолчанию агенты
    идут по одному, параллельно — по запросу;
  - шесть агентов: `code-reviewer` (Opus; оценивает находки от 0 до 100, от 91 — критично, показывает от 80),
    `comment-analyzer`, `pr-test-analyzer` (оценивает недостающие тесты по шкале 1–10), `silent-failure-hunter` (ищет
    ошибки, которые код перехватывает и ни о чём не сообщает), `type-design-analyzer` (4 измерения по 1–10),
    `code-simplifier`;
  - агенты выбираются по тому, какие файлы изменились. Итог делится на Critical, Important и Suggestions.
- **code-review** (v1.0.1) — `/code-review [--comment]`, нужен `gh` CLI [69]:
  1. Агент на Haiku пропускает закрытые, draft и тривиальные PR, а также PR, где Claude уже оставил ревью.
  2. Агент на Haiku находит нужные файлы CLAUDE.md, агент на Sonnet пересказывает PR.
  3. Четыре параллельных reviewer: 2 на Sonnet проверяют соответствие CLAUDE.md, 2 на Opus ищут ошибки.
  4. Каждую находку двух Opus-reviewer (агенты 3 и 4, поиск ошибок) проверяет свой параллельный subagent-валидатор.
     Текст шага велит брать Opus-валидаторы для ошибок и Sonnet-валидаторы для нарушений CLAUDE.md, но находки
     Sonnet-reviewer (агенты 1 и 2) на проверку прямо не направляет. Следующий шаг отбрасывает всё, что не прошло
     проверку.
  5. С `--comment` команда оставляет inline-комментарии с предложениями правок, которые можно закоммитить. Для этого
     нужен tool `mcp__github_inline_comment__create_inline_comment` из `claude-code-action` [69][81]. `allowed-tools`
     ограничен подкомандами `gh`.
  - README описывает старую схему: оценки уверенности от 0 до 100 с порогом 80; ещё он говорит, что плагин лежит в
    репозитории Claude Code. Команда и README расходятся [69]. Заметка о направлении развития описывает code-review по
    README — 4 агента и порог 80 [69]; это и есть устаревшее описание.
- **security-guidance** (v2.0.20) — около 25 regex-предупреждений при правках, ревью diff моделью Opus на Stop и
  агентный reviewer при коммите [71]. Устройство — в разделе «Проверка качества» ниже.
- **claude-security** (v0.12.0) — девять агентов для сканирования, проверки находок и исправлений, workflow `scan.js`
  [72].
- **code-modernization** — команды `/modernize-*` и 8 агентов. Его mod рисует pane с картой кода, плитки которой
  подсвечиваются, когда агенты читают или пишут файлы [75][73].
- **commit-commands** — `/commit`, `/commit-push-pr` и `/clean_gone` [75].
- **hookify** — правила для hooks, записанные в markdown [70].
- **session-report и receipts** — HTML-отчёты о расходе по транскриптам из `~/.claude/projects`, включая транскрипты
  subagents [74].
- **project-artifact** — страница статуса проекта, которая обновляется по ходу работы и публикуется как artifact на
  claude.ai [75].
- **Остальные:** claude-md-management, claude-code-setup, skill-creator, plugin-dev, code-simplifier, frontend-design,
  playground, math-proof, champion-kit, mcp-tunnels [75].
- **LSP плагины для 12 языков:** C/C++, C#, Go, Java, Kotlin, Lua, PHP, Python, Ruby, Rust, Swift, TypeScript. Сервер
  языка ставится отдельно. Таблица документации называет ещё Liquid: `liquid-lsp` ведёт Shopify, а официальный
  marketplace его показывает. По документации LSP плагины работают в терминальных сессиях, путь установки описан и
  для VS Code и Desktop. В облачных сессиях language servers плагинов не запускаются [15][63].
- **Интеграции в каталоге** [63]: GitHub (официальный GitHub MCP server), GitLab, Linear, Asana, Slack, Atlassian
  (Jira и Confluence), Notion, monday, Sentry, Datadog, PagerDuty, incident.io, Buildkite, TeamCity, Mergify,
  CodeRabbit, Greptile, Qodo, SonarQube, Semgrep, Vercel, Netlify, Supabase, Stripe, Figma, Playwright, Chrome
  DevTools, Context7; семейства плагинов AWS, Azure и Google Cloud; Xcode от Apple. Из внешних популярных —
  `superpowers` (автор obra) и `mattpocock-skills` [63].

### Функции для команд и организаций

- **Managed settings приходят тремя путями** [12]:
  - с сервера через консоль администратора claude.ai — для Owner в Team и Enterprise;
  - через MDM (систему управления устройствами) — plist или значение реестра;
  - файлом `managed-settings.json` с папкой `.d/` для дополнительных файлов.
- **Ключи** [12][41]:
  - marketplaces и плагины: `extraKnownMarketplaces`, `enabledPlugins` (поставить принудительно или запретить),
    `strictKnownMarketplaces` (allowlist с шаблонами `owner/*`, `hostPattern` и `pathPattern`), `blockedMarketplaces`;
  - загрузка и доверие: `disableSideloadFlags`, `pluginTrustMessage`, `allowManagedHooksOnly`, `allowManagedModsOnly`,
    `strictPluginOnlyCustomization`;
  - channels и подсказки: `allowedChannelPlugins`, `pluginSuggestionMarketplaces`.
  - При `allowManagedPermissionRulesOnly` поле `allowed-tools` у плагинов отбрасывается. Настройки репозитория в
    недоверенной папке больше не включают и не выключают плагины [41].
- **Чего нет, по словам самой документации** [12]: нацеливания на группы людей (только отдельными наборами настроек),
  ключа, который прячет `/plugin`. Allowlist не покрывает `--plugin-dir`.
- **Управление в claude.ai** [42][43]:
  - у каждого плагина статус Not available, Available to install, Installed by default или Required;
  - участники делятся плагином с конкретными людьми или публикуют его на всю организацию;
  - у плагина видны Adoption (сколько людей за 30 дней), Activity (сколько запусков за 30 дней) и свои запуски за 90
    дней.
- **Телеметрия** [9][41]:
  - события OpenTelemetry `plugin_installed`, `plugin_loaded`, `skill_activated` и `hook_plugin_metrics`;
  - имена сторонних плагинов скрываются, если не задано `OTEL_LOG_TOOL_DETAILS=1`;
  - Enterprise Analytics API `/v1/organizations/analytics/plugins` отдаёт установки и вызовы по плагину и по дню, для
    Claude Code и Cowork;
  - сам Claude Code авторам плагинов ничего не передаёт: данные об использовании остаются на машине каждого
    пользователя [9]. Но у плагина, опубликованного в directory, в портале разработчика есть вкладка Usage [51][119]:
    установки, активные аккаунты и retention (установки разбиты по поверхности и по источнику, например вкладка
    Discover); доля аккаунтов на каждой версии; как часто используется каждый skill, command, agent, hook и MCP сервер;
    ошибки загрузки по версиям Claude Code; вызовы tools, доля ошибок и задержка каждого MCP сервера; воронка directory
    (просмотры карточки, клики и установки). Период — до 90 дней, есть экспорт в CSV, цифры считаются раз в сутки по
    UTC [119]. Откуда портал берёт эти цифры, страница не говорит (не подтверждено).
- **Плагины в Cowork для Enterprise** (2026-02-24) — частные marketplaces, шаблоны, раздача плагинов и OpenTelemetry
  [53].
- **Skills от организации** и directory партнёрских skills (2025-12-18) [54].

### Channels (research preview)

- Плагины Telegram, Discord и iMessage передают сообщения из чата в открытую сессию. Claude отвечает в тот же чат.
  fakechat — локальный тестовый канал [33].
- Нужен Bun. Отправители входят в allowlist через сопряжение. Channels умеют пересылать запросы разрешений [33].
- На Bedrock, Vertex и Foundry channels недоступны. В Team и Enterprise их должен включить администратор [33].
- Появились 2026-03-19 и 2026-03-20 [41].

### Функции ядра Claude Code, на которые опираются плагины

- **Auto-continue** (2.1.234, 2026-08-17) — сессия ждёт сброса лимита подписки claude.ai и продолжает задачу.
  Устройство и ограничения — в разделе «Лимиты подписки и стоимость» ниже [26][41].
- **`/goal`** (2.1.139, 2026-05-11) — цель сессии. После каждого turn маленькая модель проверяет, достигнута ли цель
  [28][41].
- **Dynamic workflows** (2.1.154, 2026-05-28) — скрипт управляет многими subagents, `/workflows` показывает ход
  запуска [27][58][41].
- **Routines** (2026-04-14) — облачные запуски по расписанию, по вызову API или по событию GitHub. Дневные лимиты: Pro
  — 5, Max — 15, Team и Enterprise — 25 [59].
- **`/loop`** (2026-03-07) [41].
- **SendMessage между сессиями** (2026-08-07) — сообщение доходит до сессий на любой из машин пользователя (macOS и
  Linux) [41].
- **Agent teams** (experimental; команда агентов) — общий список задач и сообщения между участниками, без отдельных
  worktree [31].
- **`/batch`** — одна правка делится на 5–30 subagents, каждый в своём worktree [31].
- **Agent view** (2026-05-11) [41].
- **Встроенные `/code-review`, `/verify` и `/ultrareview`**, side agent «You should know» [41][19]. С 2.1.215
  (2026-07-19) Claude сам не запускает `/verify` и `/code-review` [41].

## Принципы и подходы

### Философия

1. **Упаковать и поделиться настройкой.** Пост о запуске объясняет: пользователи хотели делиться всё более сложными
   настройками. Anthropic объявила плагины стандартным способом упаковывать и распространять настройки Claude Code
   [48]. Плагины задуманы так, чтобы их включали и выключали по необходимости и держали system prompt небольшим [48].
   Документация: плагин нужен, когда несколько skills, subagents, hooks или MCP серверов надо поставить одним целым
   [1]. Страница обзора функций называет плагины слоем упаковки [35].
2. **Marketplace — каталог, а не магазин.** Им служит любой репозиторий или папка с `marketplace.json` [1]. Публикация
   в свой marketplace не требует заявки [8].
3. **Каждое расширение стоит контекста.** Имена и описания skills, agents и commands включённого плагина лежат в
   контексте каждый turn и расходуют лимит [1][9]. Anthropic сделала эту цену видимой: Context cost до установки
   (только для официального marketplace), подсветка «Every turn» от 2 000 токенов, `claude plugin details` и подсказки
   убрать неиспользуемые плагины [9].
4. **Постепенное раскрытие (progressive disclosure).** Это главный принцип Agent Skills: на старте грузятся только имя
   и описание, тело — при использовании [55][56].
5. **Детерминированный контроль против советов модели.** Гайд Michael Segner (2026-06-18): каждый способ управлять
   Claude меняет стоимость в контексте на силу воздействия. Настоящая защита должна быть детерминированной, а это
   hooks и permissions [56].
6. **Доверять автору, а не каталогу.** Плагин может выполнить любой код с правами пользователя [14]. Hooks, monitors,
   MCP и LSP процессы работают вне sandbox [14]. Имя marketplace говорит, кто ведёт каталог, но не что делает каждый
   плагин в нём [14].
7. **Сборка mods как middleware.** Предложение mods (GitHub-пользователь `poteat`, 2026-09-03) говорит: function hooks
   позволяют глубоко менять Claude Code, а безопасность держится на учёте побочных эффектов через параметр `$`. Mods
   собираются в цепочку по порядку регистрации с вызовом `next()`, как middleware в Express или Koa. Администратор,
   который регистрируется первым, контролирует поведение, а который последним — задаёт значения по умолчанию [85].
8. **Маленькое ядро.** Anthropic собирается переносить встроенные функции в mods, чтобы Claude Code можно было урезать
   до небольшого ядра [49][85]. Уже стали mods `/diff`, загрузка `AGENTS.md`, телеметрия и guard безопасности [19].
9. **Проверять расширения как обычный софт.** Evals сравнивают запуск с плагином и без него, потому что высокая оценка
   сама по себе не говорит, что плагин помог [7]. Пост о skill-creator делит skills на два вида. Skills, которые дают
   модели новую способность (capability uplift), могут стать лишними, когда модели станут сильнее. Skills, которые
   закрепляют предпочтения пользователя (encoded preference), нужны дольше. Пост допускает, что со временем описание
   evals само станет skill [57].
10. **Переносимость.** Anthropic считает, что skills должны работать в разных инструментах [54]. Agent Skills
    опубликован как открытый стандарт 2025-12-18 [54]. 2026-11-04 в его репозиторий добавлен GOVERNANCE.md (правила
    управления проектом) коммитом «AAIF Donation»; файл ссылается на устав Agentic AI Foundation. По этому файлу
    проект «будет оформлен» как серия LF Projects, LLC [62].
11. **Агенты сами пишут расширения.** В октябре 2025 Anthropic хотела, чтобы агенты сами создавали, правили и
    проверяли skills [55]. Сейчас это есть в трёх местах: skill `plugin-authoring` пишет mods,
    `claude plugin eval init` предлагает случаи, на claude.ai есть «Create with Claude» [23][7][42].
12. **Персонализация.** Anthropic подаёт mods как способ настроить Claude Code под себя [49].

### Ключевые понятия

- **Плагин** — папка компонентов, обычно с манифестом `.claude-plugin/plugin.json`, где обязательно только поле `name`
  [1][4].
- **Marketplace** — файл-каталог; плагины ставятся как `name@marketplace` [1][3].
- **Уровни marketplace** — official, community, third-party; зарезервированные имена принимаются только из
  `github.com/anthropics/` [14].
- **Scope** — user, project или local [1].
- **Пространство имён** — `/плагин:skill`, двоеточие зарезервировано [35][41].
- **Компоненты** — skills, commands (слиты со skills 2026-01-09), agents, hooks (command, HTTP, MCP tool, prompt,
  agent), MCP серверы и пакеты `.mcpb`, LSP серверы, `bin/`, output styles, themes, channels, monitors, workflows,
  `settings.json`, `userConfig`, хранилище `${CLAUDE_PLUGIN_DATA}` [4][5][41][35].
- **Mod** — плагин с JS/TS «hooks module», который наблюдает за событиями, переписывает их или отвечает на них и
  вызывает API `$` для интерфейса, файлов, процессов, сети, модели, таймеров и сообщений между сессиями [19][20].
- **Встроенные mods** — `cc-plugin-diff`, `cc-plugin-agents-md`, `cc-plugin-sec-default`, `cc-plugin-telemetry`,
  `cc-plugin-you-should-know`, а также `cc-plugin-plugin-authoring` (только skill) [19].
- **Directory, Claude Marketplace и marketplace** — три разных вещи: проверяемый каталог на claude.ai, сайт со списком
  и git-каталог [1][3][50].
- **Synced plugin** — плагин с аккаунта claude.ai, в Claude Code он называется `name@synced` [8][41].
- **Зависимости и версии** — диапазоны semver, `claude plugin tag`, словарь `renames`, `engines["claude-code"]`
  [16][8][41].
- **Relevance и CLI hints** — сигналы, по которым Claude Code предлагает плагин [11][10].
- **Context cost** — токены, которые плагин тратит всегда, против токенов при вызове [9].

### Чем подход отличается

- **Расширения работают внутри цикла агента одного вендора.** С 2026-10-01 они могут перерисовывать интерфейс,
  запускать таймеры и одобрять вызовы tools [19][49].
  - Mod может одобрить вызов, который остановили бы deny или ask rules, если этому не мешает встроенный guard
    `sec-default`. На Team, Enterprise и управляемых машинах guard грузится первым [19][49].
  - Окно запроса разрешения mod изменить не может [19].
- **Доставка через git, к которой постепенно добавили функции менеджера пакетов:** фиксация на SHA коммита
  (2026-01-20), `git-subdir`, npm без install scripts, zip с SHA-256, источник command, разрешение зависимостей,
  `prune`, диапазоны `engines` [41].
- **Уровень official получает больше возможностей:** показ Context cost, CLI hints, имена в телеметрии без скрытия,
  события `hook_plugin_metrics` [9][10].
- **Подсказки плагинов внутри сессии** — по текущей папке, прочитанным файлам и запущенным командам [11][41].
- **Популярные приёмы уходят в ядро.** Это вывод по датам, а не заявленная политика. `ralph-loop` — цикл на Stop hook
  (ноябрь 2025) [66]. `/goal` (2026-05-11) по документации — обёртка над prompt-based Stop hook на уровне сессии
  [28][41]. Плагины output styles появились, когда встроенные output styles объявили устаревшими, а встроенные вернули
  через несколько дней [63][41].

## Как это устроено внутри

Claude Code закрыт, поэтому устройство ядра описано по документации и changelog. Плагины Anthropic открыты, их
устройство описано по коду.

### Загрузка, версии и кэш

- **Три стадии плагина** [13]:
  1. Объявлен — `enabledPlugins` и `extraKnownMarketplaces` в файле настроек.
  2. Скачан — файлы в `~/.claude/plugins/`: `known_marketplaces.json`; `installed_plugins.json` (scope, `installPath`,
     версия); `cache/<marketplace>/<plugin>/<version>/`; `data/<id>/`; `flagged-plugins.json` (плагины, удалённые
     потому, что marketplace их снял).
  3. Загружен — набор плагинов, прочитанный на старте сессии или при `/reload-plugins`.
- Старт сессии не ходит в сеть. Недостающие marketplaces клонируются потом в фоне [13].
- **Версия** берётся из `version` манифеста, затем из записи marketplace, затем из источника [13]:
  - git — SHA коммита, укороченный до 12 символов;
  - archive — дайджест SHA-256;
  - npm и локальные источники без версии — `unknown`.
  - Зафиксированная `"version"` держит всех пользователей на кэшированной копии, сколько бы коммитов ни сделал автор.
- Каждая версия получает свою папку кэша, поэтому `${CLAUDE_PLUGIN_ROOT}` меняется при каждом обновлении. Постоянное
  состояние должно лежать в `${CLAUDE_PLUGIN_DATA}` [4][13].
- Старая версия получает метку `.orphaned_at` и удаляется через 14 дней. Сессии, которые ещё работают на ней, не
  ломаются [13].
- **Auto-update** [13]:
  - после первого сообщения интерактивной сессии Claude Code ждёт случайную паузу до 10 минут;
  - затем обновляет все marketplaces с включённым auto-update;
  - текущая сессия держит старые версии до `/reload-plugins`, monitors требуют полного перезапуска;
  - `DISABLE_AUTOUPDATER` и `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` выключают обновление,
    `FORCE_AUTOUPDATE_PLUGINS=1` включает обратно.
- **Установка зависимостей Node.js устроена так, чтобы код плагина при этом не выполнялся** [13]:
  - нужны `package.json` и lockfile. Принимаются `bun.lock`, `npm-shrinkwrap.json` и `package-lock.json`; `yarn.lock`
    и `pnpm-lock.yaml` пропускаются;
  - только пакеты из registry с точными версиями, frozen resolution (без пересчёта версий);
  - флаг `--ignore-scripts`, отдельная папка без доступа к `.npmrc` и `.env` плагина;
  - таймаут 60 с;
  - если установка упала, плагин всё равно грузится, но затронутые части не работают.
- **Ограничение путей** [13]: пути компонентов за пределами корня плагина отклоняются с ошибкой «path escapes plugin
  directory». Сюда входят `../`, symlinks наружу и обратные слэши на macOS и Linux. Скопированные плагины не читают
  файлы выше своего корня.
- **Engines** (2.1.323): плагин вне заявленного диапазона версий Claude Code не ставится, не обновляется и не грузится
  [41][16].

### Цикл агента и точки подключения

- **Цикл Claude Code** — собрать контекст, сделать действие, проверить результат; turn за turn его ведёт модель [34].
- **События жизненного цикла**, к которым подключаются плагины: SessionStart, UserPromptSubmit, PreToolUse,
  PermissionRequest, PostToolUse, PostToolBatch, Stop, StopFailure, SubagentStart/Stop, TaskCreated/Completed,
  Pre/PostCompact, WorktreeCreate/Remove, SessionEnd и другие [25].
- **Hooks** [25]:
  - совпавшие hooks выполняются параллельно, одновременно не больше 12 hooks типа prompt или agent;
  - таймауты по умолчанию — 600 с, 30 с и 60 с;
  - поле `if` использует синтаксис правил разрешений, например `Bash(git *)`. Оно работает по возможности, и
    документация не советует строить на нём жёсткие запреты;
  - `async` выполняет hook в фоне. `asyncRewake` тоже в фоне, но при exit code 2 будит Claude, даже если сессия
    простаивает;
  - `onFailure: block` и форма exec через `args`.
- **Stop hook** [25]:
  - ответ `{"decision":"block","reason":...}` заставляет сделать ещё один turn;
  - защита от бесконечного цикла — флаг `stop_hook_active` и предел в 8 продолжений подряд. Счётчик сбрасывается,
    когда Claude вызывает tool. `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` поднимает предел;
  - во входе Stop есть `background_tasks` и `session_crons`. По ним hook отличает «работа закончена» от «ждём фоновую
    работу».
- **StopFailure** [25][41]: при ошибке API вместо `Stop` срабатывает `StopFailure`. Поле `error` — `rate_limit`,
  `overloaded`, `billing_error` и другие. Решений этот hook принимать не может, только писать лог и оповещать.
  Появился в 2.1.78 (2026-03-17).
- **ralph-loop изнутри** [66]:
  - `/ralph-loop` через блок `!` запускает `scripts/setup-ralph-loop.sh`. Скрипт пишет `.claude/ralph-loop.local.md`:
    YAML с `iteration`, `session_id`, `max_iterations` (0 — без предела), `completion_promise` и `started_at`, а
    prompt — в теле файла;
  - `hooks/stop-hook.sh` сразу выходит, если `session_id` чужой. Так другие сессии в том же проекте не блокируются;
  - hook проверяет числовые поля. Если файл испорчен, hook удаляет его и разрешает выход;
  - hook читает последние 100 строк ответов ассистента из JSONL-транскрипта, берёт последний текстовый блок и через
    Perl достаёт `<promise>…</promise>`. Сравнение строк точное;
  - если текст не совпал, hook атомарно увеличивает `iteration` (временный файл и `mv`) и печатает
    `{"decision":"block","reason":<тот же prompt>,"systemMessage":"Ralph iteration N…"}`;
  - о лимитах и стоимости плагин не знает. README называет `--max-iterations` главной защитой от бесконечного цикла;
  - идея плагина — от Geoffrey Huntley, который описывает Ralph как простой цикл на Bash [66].
  - Вывод по документации без проверки (не подтверждено): итерация без вызова tool идёт в счёт предела в 8 продолжений
    [25].
  - Вывод по документации без проверки (не подтверждено): на лимите срабатывает `StopFailure` вместо `Stop`, поэтому
    Stop hook ralph-loop не срабатывает и цикл зависит от auto-continue ядра [25][66]. Ожидаемый путь — `StopFailure`
    на лимите, затем auto-continue, затем снова `Stop` и продолжение цикла. Проверяли ли эту цепочку целиком, не
    выяснено (не подтверждено).
  - Отличие от исходного Ralph: плагин копит контекст в одной сессии, а исходный Ralph запускал новый процесс на
    каждую итерацию. Попытка добавить свежий контекст не удалась: у Stop hooks нет терминала [102].
- **`/goal`** [28][41]:
  - это prompt-based Stop hook на уровне сессии. После каждого turn маленькая быстрая модель решает: цель не
    достигнута, достигнута или недостижима;
  - цикл останавливается, если Claude несколько turns подряд не вызывает tools;
  - временные ошибки (перегрузка сервера, обрыв соединения) повторяются до 3 раз, потом цель встаёт на паузу;
  - лимиты расхода ставят цель на паузу до срабатывания auto-continue;
  - ошибки, которые должен исправить пользователь, снимают цель;
  - цель восстанавливается при `--resume` и работает в `-p`;
  - повторы и паузу добавили в 2.1.269 после жалоб на тихие остановки.

### Параллельность и координация

- **Dynamic workflows** (2.1.154, 2026-05-28) [27][41][58]:
  - план держит скрипт: функции `agent()`, `pipeline()`, `parallel()`, `phase()`, `log()` и переменная `args`.
    Промежуточные результаты хранятся в переменных скрипта, а не в контексте Claude;
  - лимиты: 16 агентов одновременно по умолчанию, меньше при малом числе CPU (можно задать от 1 до 256), 4 096
    элементов на один вызов `parallel()` или `pipeline()`, 1 000 агентов на запуск. В скрипте нет `import()`, shell и
    доступа к файлам;
  - детерминизм: `Date.now()`, `Math.random()` и `new Date()` без аргументов бросают ошибку. Поэтому повторный запуск
    делает те же вызовы агентов;
  - prompt caching: агенты с одинаковым началом prompt ждут до 5 с, чтобы прочитать кэш первого агента;
  - одобрение запуска зависит от режима разрешений: в manual — каждый раз, если не выбрать «Yes, and don't ask again»
    для этого workflow в проекте; в auto — только при первом запуске; в bypass — без вопроса. В `-p` и Agent SDK
    вопроса нет, но запуск проходит обычную проверку разрешений: нужны allow rule `Workflow`, режим auto или bypass,
    ответ `allow` от hook PreToolUse или одобрение хоста;
  - на плане Pro workflows сначала надо включить строкой Dynamic workflows в `/config`;
  - `workflowSizeGuideline` по умолчанию `medium` (меньше 10 агентов), на Pro — `small`. Предупреждение «Large
    workflow» появляется при больше чем 25 агентах или больше чем 1.5M прогнозируемых токенов и запуск не
    останавливает [27].
- **Параллельные reviewers в плагинах:** code-review — 4 reviewer и по валидатору на каждую найденную ошибку [69];
  feature-dev — 2–3 `code-explorer`, 2–3 `code-architect`, 3 `code-reviewer` [67]; pr-review-toolkit — 6 агентов, по
  умолчанию по очереди [68].
- **claude-security** [72]:
  - `workflows/scan.js` идёт по фазам Inventory, Threat model, Research, Sweep и Panel;
  - Panel — проверка каждой находки с трёх lens (углов зрения: REACHABILITY, IMPACT, DEFENSES), по одному голосующему
    агенту на lens. Итог считает код, а не модель: находка остаётся, только если ответили все три агента и хотя бы
    двое проголосовали TRUE_POSITIVE;
  - отдельный агент вычищает секреты из отчётов;
  - патчи делает отдельная задача «Suggest patches». Исправление пишется в scratch-копии репозитория, а проверяет его
    агент `patch-verifier`, один на раунд исправления. Patch-файл доходит до пользователя, только если
    `patch-verifier` уверенно подтверждает три утверждения: TARGETED (меняется только то, что закрывает находку),
    NO_NEW_VULNERABILITY (новой уязвимости нет), BEHAVIOUR_UNCHANGED (поведение не меняется). Иначе пользователь
    получает записку с причиной;
  - пока workflow идёт в фоне, главный агент держит свой turn скриптом `scripts/keep-waiting.sh`. Скрипт спит до 110 с
    — меньше 2-минутного таймаута Bash — и просит вызвать его снова.
- **Agent teams и `/batch`** — участники agent team делят список задач и пишут друг другу, но не изолированы в
  worktree; `/batch` делит одну правку на 5–30 subagents в своих worktree [31].

### Изоляция

- **Worktrees** [29][30]:
  - `isolation: worktree` (доступно и агентам плагинов) даёт subagent временный worktree. По умолчанию его ветка
    берётся от ветки по умолчанию, а не от HEAD родительской сессии;
  - worktree без изменений удаляется сразу, остальные — чисткой после `cleanupPeriodDays`;
  - в сессиях worktree четыре проверки: запрет правок в основном checkout, запрет команд с рабочей папкой в основном
    checkout, запрет git-перенаправлений (`-C`, `GIT_DIR`) и запрет команд, которые Claude Code не может разобрать;
  - ограничение: `cp` и перенаправления shell в основной checkout эти проверки не отслеживают [30].
- **Код самого плагина не изолирован.** Hooks, monitors, MCP и LSP процессы и процессы, которые запускают mods,
  работают вне sandbox с полными правами пользователя. Правила разрешений касаются только вызовов tools самим Claude
  [14].
- **Изоляция evals.** Каждый случай — дочерний процесс `-p` во временных HOME и рабочей папке, без конфигурации
  пользователя [7]. Если в запуске работали hooks плагина или настоящие MCP серверы, документация считает оценки
  только ориентиром: они могли изменить файлы, которые читают проверки [7].

### Состояние, память и контекст

- ralph-loop хранит состояние в файле проекта с защитой по session id [66]. Плагины хранят данные в
  `${CLAUDE_PLUGIN_DATA}` [4]. Mods — в `$.store` [20].
- Workflows сохраняют результаты агентов под сессией в `~/.claude/projects/`. Продолжить запуск можно только повторным
  запуском в той же сессии или после `--resume`; после выхода запуск сам не продолжается [27].
- У `/goal` условие переживает resume, а счётчики сбрасываются [28].
- Агенты могут иметь постоянную `memory` (user, project или local) [29].
- Контекст под контролем пользователя: Context cost в `/plugin`, оценки «всегда» и «при вызове» в
  `claude plugin details`, группа «Not used recently» [9].

### Проверка качества

- **Hooks с моделью** [25]: hook типа `prompt` возвращает один структурированный вердикт. Experimental hook типа
  `agent` — subagent с Read, Grep и Glob, до 50 turns, возвращает `{ok}`. Пример в документации не даёт закончить
  работу (Stop), пока не пройдут unit tests.
- **hookify** [70]:
  - превращает файлы правил `.claude/hookify.*.local.md` в проверки PreToolUse, PostToolUse, Stop и UserPromptSubmit
    (python3, таймаут 10 с);
  - пример правила блокирует Stop, если в транскрипте нет `npm test|pytest|cargo test`;
  - при любой ошибке hook разрешает действие (fail open — при сбое пропускать).
- **security-guidance** [71]:
  - regex-предупреждения при правках;
  - ревью diff моделью на каждом Stop. Берётся самая новая Opus: она ищется через `/v1/models`, результат кэшируется
    на день. Находки возвращаются Claude через `asyncRewake`;
  - агентный reviewer на `git commit` и `push` — вложенный запуск Claude Code через Agent SDK с
    `--no-session-persistence`. Его запускают hooks вида `if: "Bash(git*commit*)"`;
  - `SG_DUAL_OR=on` объединяет находки двух параллельных ревью ценой примерно вдвое большего расхода.
- **Plugin evals** — 3 запуска на случай, шесть типов проверок (regex, число и порядок вызовов tools, созданные файлы,
  рубрика LLM, сравнение с эталонным транскриптом), базовый запуск без плагина с оценками WITH, W/OUT и Δ, порог для
  CI; нужна версия 2.1.269+ [7].
- **CI официального каталога** — ночная проверка всех изменённых записей; устройство — в подразделе «Права и
  безопасность» ниже [65].

### Восстановление после сбоев

- **Workflows** [27][41]:
  - агент, который перестал выдавать вывод, перезапускается с тем же prompt, до 5 раз. После шестого зависания вызов
    внутри `parallel` или `pipeline` возвращает `null`, а при прямом `await` весь запуск завершается с ошибкой;
  - вывод по схеме повторяется до 5 раз (`MAX_STRUCTURED_OUTPUT_RETRIES`);
  - при повторном запуске завершённые агенты отдают сохранённый результат. Упавший или изменённый агент выполняется
    заново — и вместе с ним все агенты, начатые после него;
  - запуск, который упёрся в лимит, повторяет только упавших агентов (2.1.318+).
- **`/goal`** — 3 повтора, потом пауза [28].
- **ralph-loop** при любой ошибке разбора файла или транскрипта удаляет файл состояния и останавливается [66].
- **Зависимости** — при ошибке установки плагин грузится частично [13].
- **Retry watchdog** для работы без присмотра — настройки в 2.1.301 и 2.1.305 (октябрь 2026) [41].

### Лимиты подписки и стоимость

- **Auto-continue** (2.1.234, 2026-08-17) [26][41]:
  - когда лимит claude.ai останавливает задачу, Claude Code ждёт в открытой сессии и продолжает после сброса.
    Последнее сообщение заново не отправляется: Claude получает просьбу продолжить задачу;
  - строка состояния: «Usage limit reached · limit resets 3:45pm» и «Continuing automatically at 3:45pm» (время для
    примера) [26];
  - включено по умолчанию в интерактивных сессиях со входом по подписке claude.ai. Настройка —
    `autoContinueAtUsageLimit`. Строкой `/config autoContinueAtUsageLimit=false` её можно выключить, но такой строкой
    нельзя включить обратно, потому что она разрешает работу без присмотра. Проектные и локальные настройки тоже могут
    её только выключить [26];
  - подряд — не больше 3 автоматических продолжений. Для `/goal` и задач по расписанию внутри сессии счёт идёт и через
    окна сброса. Дальше пользователь выбирает в `/rate-limit-options` [26];
  - запросы разрешений всё равно останавливают продолжённую задачу. Выход из сессии прекращает ожидание. После сна
    компьютера дольше ~30 минут нужно нажать Enter [26];
  - вообще не ждёт в фоновых сессиях, в `-p`, с ключами API, у облачных провайдеров и при оплате по расходу. В Remote
    Control и в сессиях участников agent team сам ожидание не начинает, но человек у терминала может начать его из
    `/rate-limit-options` [26];
  - не начинает ждать сам, если до сброса больше 24 часов (недельный лимит). Такое ожидание можно начать из
    `/rate-limit-options` [26];
  - события для hooks: `StopFailure` с `rate_limit` (без решений) и уведомления `quota_auto_resume_fired`,
    `quota_auto_resume_stale` и `quota_auto_resume_disabled` [25];
  - одна заметка выводит из исправления в 2.1.314 (2026-10-30), что предел — три продолжения без вопроса пользователю
    [41]. Документация говорит то же [26].
- **Workflows на лимите** [27][41]:
  - агенты ждут сброса вместо ошибки (2.1.271, 2026-09-14);
  - не больше двух ожиданий за запуск, третье попадание в лимит — ошибка агента;
  - работает только в интерактивном терминале или в локальной сессии во вкладке Code;
  - версии расходятся: документация называет для вкладки Code в Desktop версию 2.1.319 [27], а changelog 2.1.323
    подаёт это изменение в Desktop как новое [41].
- **Hooks и mods** [25][20][21]: `StopFailure` ничего не повторяет. Mod мог бы сам планировать работу по лимитам через
  `usage().rateLimits[].resetsAt`, `session.measure`, `$.clock` и `$.prompt.submit`. Такого плагина не найдено (не
  подтверждено).
- **Расход** [20][27][71][41]:
  - turns от mods идут в счёт `--max-turns` и `--max-budget-usd` [20];
  - ревью из плагинов расходует план пользователя. При прямом пути через API ревью security-guidance на Stop не
    попадает в собственные цифры расхода Claude Code; плагин пишет `est_cost_usd` по прайс-листу [71];
  - VS Code с 2.1.312 подписывает сброс как «5-hour limit» [41].

### Права и безопасность

- **Модель доверия** [14]:
  - плагин может выполнить любой код с правами пользователя;
  - auto-update может заменить уже проверенные файлы на диске;
  - каждая установка показывает одно и то же предупреждение: Anthropic не контролирует MCP серверы, файлы и другой
    софт внутри плагинов. Организация добавляет свой текст через `pluginTrustMessage`.
- **Отказы** [14]: зарезервированные имена из чужих источников и архивы с неверным SHA-256. Каталог сообщества
  закрепляет на SHA коммита почти все записи; для закреплённой записи Claude Code отклоняет любой другой коммит.
- **Плагины уровня репозитория** [13][41]:
  - грузятся только после проверки доверия к рабочей папке;
  - их MCP серверы проходят обычное одобрение каждого сервера, пакеты MCPB пропускаются, monitors не грузятся;
  - с 2.1.195 (2026-06-26) плагины, включённые только настройками из репозитория, требуют явного согласия.
- **Ужесточение по changelog** [41]:
  - 2026-07-11 — `${user_config.*}` нельзя подставлять в shell-форму команд, опции плагина больше не читаются из
    настроек проекта;
  - 2.1.251 — исправлен обход путей;
  - 2026-08-26 — в именах marketplaces отклоняются управляющие и невидимые символы.
- **Mods** [19][77][41]:
  - видят каждый prompt, одобряют вызовы tools и тратят лимит;
  - каждый mod видит каждое событие и передаёт его дальше через `next(e)`. Слои: организация `prepend`, затем `user`,
    затем организация `append`, плюс `builtin` и `core` [77];
  - `sec-default` стоит снаружи всех слоёв. Если политику организации прочитать не удалось, он считает её действующей
    (fail closed — при сбое запрещать) [77].
- **Учётные данные** [71]: по README security-guidance, Claude Code передаёт hooks плагинов вход пользователя через
  `/login`, если не заданы `DISABLE_TELEMETRY`, `DO_NOT_TRACK` или запрет нефункционального трафика.
- **Цепочка поставки официального каталога** [65][63]:
  - каждую ночь в 07:23 UTC — до 60 обновлений SHA. На новом SHA запускается `claude plugin validate`, каждое
    обновление — отдельный PR;
  - проверка политики: Claude проверяет каждую изменённую запись по prompt политики. Запись не проходит, если её hooks
    следят за чужими сессиями без привязки к проекту (UserPromptSubmit, PreToolUse или PostToolUse), если телеметрия
    не раскрыта, если описание не совпадает с поведением или если учётные данные одного сервиса уходят в другой;
  - вход через короткоживущие токены Workload Identity Federation (без постоянных ключей). Вердикты кэшируются по паре
    (`name@sha`, хэш политики) на 30 дней. Отдельный workflow откатывает SHA, не прошедшие проверку, не больше 3
    проходов;
  - проверка MCP URL: запись проваливают только ответы 404 и 410 и сбои соединения, DNS или TLS;
  - в `.github/workflows/` есть также `close-external-prs.yml`, `external-pr-scope-guard.yml` и
    `validate-licenses.yml`; их содержимое не изучалось [65].

### Участие человека

- feature-dev ждёт одобрения перед реализацией и спрашивает, что делать с находками ревью [67].
- code-review публикует комментарии только с `--comment` [69].
- Запуск workflow требует одобрения в зависимости от режима разрешений [27].
- Hooks `PermissionRequest` могут разрешить или запретить вызов, но не обходят deny rules. В сессиях, где нельзя
  показать запрос, нерешённый запрос отклоняется [25].
- claude-security сам отклоняет вопрос о старте скана, если ответа нет 60 с [72].
- Channels пересылают запросы разрешений в Telegram, Discord или iMessage [33].

### Наблюдаемость

- `/workflows` показывает фазы и агентов: вызовы tools, токены, пауза, остановка, перезапуск, сохранение [27]. Есть
  `/tasks` [31] и `claude plugin details` [9].
- OpenTelemetry и Analytics API — для организаций; авторам плагинов данные не уходят [9].
- `session-report` и `receipts` читают `~/.claude/projects/**/*.jsonl`, включая транскрипты subagents [74].
- Pane плагина code-modernization строится только по файлам на диске. Его README всё ещё просит
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, которую версии 2.1.287+ игнорируют, — документация отстала от кода [73][19].

### Модули и файлы

Ссылки на коммит `f75f5b25` репозитория `anthropics/claude-plugins-official` (2026-11-12) и на ветку `main`
репозитория `anthropics/claude-code`.

- ralph-loop [66]:
  - [hooks/stop-hook.sh](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/ralph-loop/hooks/stop-hook.sh)
    — Stop hook, проверка `<promise>`, счётчик итераций;
  - [scripts/setup-ralph-loop.sh](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/ralph-loop/scripts/setup-ralph-loop.sh)
    — запись файла состояния;
  - [commands/ralph-loop.md](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/ralph-loop/commands/ralph-loop.md)
    — команда с блоком `!`.
- feature-dev [67]:
  [commands/feature-dev.md](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/feature-dev/commands/feature-dev.md)
  — 7 фаз;
  [agents/](https://github.com/anthropics/claude-plugins-official/tree/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/feature-dev/agents)
  — `code-explorer.md`, `code-architect.md`, `code-reviewer.md`.
- pr-review-toolkit [68]:
  [commands/review-pr.md](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/pr-review-toolkit/commands/review-pr.md);
  [agents/](https://github.com/anthropics/claude-plugins-official/tree/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/pr-review-toolkit/agents)
  — шесть агентов.
- code-review [69]:
  [commands/code-review.md](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/code-review/commands/code-review.md)
  — конвейер из фильтра, reviewers и валидаторов;
  [README.md](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/code-review/README.md)
  — старая схема с порогом 80.
- hookify [70]:
  [hooks/hooks.json](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/hookify/hooks/hooks.json),
  [hooks/pretooluse.py](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/hookify/hooks/pretooluse.py),
  [core/](https://github.com/anthropics/claude-plugins-official/tree/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/hookify/core)
  — разбор правил.
- security-guidance [71]:
  [hooks/hooks.json](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/security-guidance/hooks/hooks.json)
  — какие события запускают проверки; модули на Python лежат рядом в `hooks/`.
- claude-security [72]:
  [workflows/scan.js](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/claude-security/workflows/scan.js)
  — фазы скана и панель;
  [scripts/keep-waiting.sh](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/claude-security/scripts/keep-waiting.sh)
  — удержание turn;
  [hooks/hooks.py](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/claude-security/hooks/hooks.py).
- code-modernization [73]:
  [hooks/hooks.json](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/code-modernization/hooks/hooks.json),
  [hooks/README.md](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/code-modernization/hooks/README.md).
- receipts [74]:
  [skills/receipts/scripts/mine-transcripts.mjs](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/plugins/receipts/skills/receipts/scripts/mine-transcripts.mjs)
  — разбор транскриптов.
- Каталог и его CI [63][65]:
  [.claude-plugin/marketplace.json](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/.claude-plugin/marketplace.json);
  [.github/workflows/](https://github.com/anthropics/claude-plugins-official/tree/f75f5b25ae94f4332be4ff5f18435741d2589bdb/.github/workflows)
  — `scan-plugins.yml`, `bump-plugin-shas.yml`, `revert-failed-bumps.yml`, `validate-plugins.yml`,
  `check-mcp-urls.yml`;
  [.github/policy/prompt.md](https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/.github/policy/prompt.md)
  — prompt политики.
- Встроенные mods Claude Code [77]:
  [mods/sec-default](https://github.com/anthropics/claude-code/tree/main/mods/sec-default),
  [mods/privacy](https://github.com/anthropics/claude-code/tree/main/mods/privacy), а также `agents-md`, `diff` и
  `telemetry` в той же папке.

## Что говорят пользователи

**Оговорки.** Общего поиска в вебе не было. Темы HN читались через списки самого HN, issues — через `gh`. Reddit, X и
YouTube не охвачены. Лимит GitHub search API кончился под конец, поэтому части итоговых чисел нет. Часть отзывов
написана агентами: в теме mods один комментатор заметил, что её в основном ведут экземпляры Claude Code между собой,
другой участник представился ИИ-сооснователем, который комментирует без присмотра [85]; ответы автора Superpowers
подписаны Claude [84]. Поэтому число реакций — более сильное свидетельство, чем текст комментариев. Все отзывы ниже
пересказаны.

### Внимание и принятие

- **Звёзды на GitHub, 2026-11-13** [82][63][76][62]:
  - obra/superpowers — 316 965 (плагин-методика, он же есть в официальном каталоге);
  - anthropics/skills — 193 867 по одному замеру, 193 870 по другому;
  - anthropics/claude-code — 155 497;
  - hesreallyhim/awesome-claude-code — 57 903;
  - anthropics/claude-plugins-official — 47 090;
  - wshobson/agents — 42 462;
  - anthropics/financial-services (бывший financial-services-plugins) — 41 266;
  - anthropics/knowledge-work-plugins — 35 611;
  - davila7/claude-code-templates — 33 448;
  - agentskills — 27 245;
  - anthropics/claude-for-legal — 9 992;
  - frankbria/ralph-claude-code — 9 729;
  - anthropics/claude-plugins-community — 4 883.
  - Самый популярный плагин — методический пакет сообщества, а не плагин Anthropic [82].
- **Внимание на HN:** запуск плагинов — 48 очков и 9 комментариев [106]; Claude Skills — 816 и 427 [107]; Superpowers
  (октябрь 2025) — 435 и 231 [108]; Superpowers 6 — 196 и 77 [109]; поддержка AGENTS.md — 741 и 285 [110]; три
  публикации о mods — от 1 до 6 очков, без комментариев [112]; Build Plugins for Claude — 4 и 3 [111]. Спорят о
  содержании (skills и методики), цене и привязке к вендору. О самом механизме упаковки говорят редко
  [106][107][108][109][110][111][112].
- **Самые поддержанные issues о плагинах (👍 на 2026-11-13):**
  - предложение mods #91870 — +132, 276 комментариев [85];
  - rules в плагинах #14200 — +114 [86];
  - отключение отдельных skills плагина #14920 — +102 [87];
  - гонка при старте LSP серверов — +100 [92];
  - LSP плагин для Scala (Metals) #45132 — +99 [92];
  - GitHub-плагин не авторизуется, «does not support dynamic client registration», #283 — +81 [95];
  - skills плагинов нет в автодополнении slash-команд #18949 — +74 [91];
  - `lspServers` из `marketplace.json` игнорируется #15148 — +73 [92];
  - плагины уровня проекта видны как глобальные #14202 — +65 [91];
  - запрос SSH-ключа при клонировании marketplace #14485 — +50 [93];
  - LSP плагин для Vue/Volar #232 — +38 [92].

### Что хвалят

- **Один пакет для раздачи настроек команды.** Самый поддержанный комментарий (+43) в запросе rules для плагинов
  хвалит, что всё лежит в одном месте и раздаётся по компании [86].
- **Быстрый отклик сообщества.** В первые дни после запуска на HN выкладывали свои marketplaces: hook для поиска
  секретов и сайт со списком marketplaces [106].
- **После выхода mods пользователи быстро выложили много своих расширений.** За несколько недель появились [85]:
  - игры над полем ввода, которые не тратят токены;
  - полосу с дыхательными упражнениями;
  - браузерный плагин;
  - mod, который запускает агента pi как встроенный subagent с любой моделью;
  - счётчики контекста, квот и токенов в реальном времени;
  - live-панель агентов с отдельной строкой на каждый subagent и вердиктами разрешений;
  - inbox для ревью PR;
  - pane задач для участия человека;
  - голосовой mod;
  - guard расхода агентов.
  - Первые ответы просили выпустить mods как есть. Активные пользователи hooks — у одного 59 регистраций на 19
    событиях, у одного плагина 153 записи в `hooks.json` — приветствовали типизированные hooks внутри процесса [85].
- **Superpowers.** Сторонники ценят фазу brainstorming и дисциплину TDD. Один пользователь написал, что плагин сильно
  изменил его работу, а v6 тратит заметно меньше токенов [109]. Simon Willison настоятельно рекомендовал исходную
  статью [108].
- **Спрос на LSP плагины:** Scala +99, Vue/Volar +38, C# Roslyn +24 [92].
- **Спрос на channels:** slash-команды из Telegram или Discord (+31), несколько ботов (+16), WhatsApp (+11) [104].

### Что ругают — по силе доказательств

1. **Расход контекста и лимита — главная тема.**
   - Запрос отключать отдельные skills плагина (+102) открыт с 2025-12-20. Один пользователь хотел из плагина с
     многими командами только команду commit [87]. Комментатор написал, что Anthropic, похоже, эти issues не читает
     [87]. Обходы: список запретов в CLAUDE.md или PreToolUse hook, который блокирует skill [87].
   - Разбор 158 сессий: Superpowers грузит на старте ~8–22 тыс. токенов, а пользователи вызывают примерно 3 из его ~15
     skills [88].
   - `skillOverrides` для skills плагинов молча игнорируется. Последующие запросы — #98220 (+10) и #88302 (+6) [88].
   - Установка, которой управлял агент: 205 skills, около 42 тыс. токенов описаний на сессию, 71% недельного расхода
     ушло на повторное чтение контекста [85].
   - В теме о лимитах Max (+697) пользователи убирают плагины marketplace, чтобы сэкономить недельную квоту [90]. Один
     замерил резкое падение стоимости загрузки skills между 2.0.76 и 2.1.3: например, feature-dev — с 1.2 тыс. токенов
     до 25 [90].
   - Трекер раздувания контекста от сообщества: skills регистрируются в system prompt дважды. Пользователи сделали
     cozempic — MCP gateway, который сокращает токены описаний tools примерно на 89%, — и mcp-checkup [89].
   - Описания pr-review-toolkit всегда занимают около 2.5 тыс. токенов [97].
   - Ответ Anthropic: прогноз Context cost в браузере `/plugin` (2.1.143, 2026-05-15), оценка Context cost для
     официальных плагинов и группа «Not used recently» [41][1].
2. **Надёжность загрузки и вызова** [91][92].
   - Skills плагинов нет в автодополнении (+74). Skills плагинов не попадают в список доступных (+33). `userConfig` не
     спрашивается при включении (+29). `/plugin update` не сбрасывает кэш (+31). Плагины уровня проекта видны как
     поставленные везде (+65) [91].
   - LSP плагины сначала не работали: гонка при старте (+100), «no LSP server available» (+55, 73 комментария),
     `lspServers` игнорируется (+73), у всех официальных LSP плагинов не было `.lsp.json` (+21) [92].
3. **Доставка marketplace** [93][94].
   - Официальный marketplace клонировался по SSH. Это вызывало запрос 1Password на каждом старте (+50) и касание
     YubiKey каждые несколько минут (+14); пользователь написал, что так теряется смысл аппаратного ключа. Просили
     HTTPS по умолчанию (+38) [93].
   - Новый тип источника `git-subdir` в официальном каталоге сломал проверку `marketplace.json` у старых клиентов, и
     все плагины пропали. Комментатор высмеял небрежное ведение официального репозитория [93].
   - Раньше: URL схемы не существовал (+33), не работала авторизация частного marketplace (+37), Cowork не мог
     добавить частный GitHub marketplace (+35, issue открыт) [93].
   - Базовые вещи добавили после спроса: auto-update (+65) — переключатель в 2.0.70; зависимости (+49) — теперь
     описаны в документации; фиксация на SHA коммита — в 2.1.14 (2026-01-20) [94][41][16].
   - После 2.1.195 (явное согласие на плагины из настроек репозитория) команды просят фиксировать версии (+7) и
     считать плагины vendored-зависимостями (+10) [94][41].
4. **Официальные MCP плагины не проходят авторизацию** [95].
   - Ошибка OAuth у GitHub-плагина (+81) открыта с 2026-01-25 и воспроизводится на Windows, macOS и Ubuntu. Обход —
     `gh` CLI. Самые поддержанные ответы спрашивают, смотрит ли кто-то и почему не исправлено.
   - У Slack та же ошибка (+43, закрыт) и сбой redirect URI (+32).
   - GitHub MCP шлёт некорректный JSON-RPC (+49, открыт).
5. **Кто решает, что встроено, а что — плагин** [98][99][101].
   - В декабре 2025 встроенный `/review` предлагал поставить плагин. Установка падала, README отдавал 404 [98].
   - 2.1.215 (2026-07-19) запретил Claude самому запускать `/verify` и `/code-review`. Пользователи с автоматическими
     сценариями назвали это ненужной ломкой совместимости [98][41].
   - Встроенный skill `/code-review` и одноимённый плагин путают. Skill выводит сырой JSON [98].
   - Встроенный `sec-default` пропускает hooks пользовательских mods на первом prompt каждой сессии [99].
   - Mods выключали удалённо, пока документация писала, что они включены (#99130). Mod-счётчик расхода пропал без
     уведомления, и его пользователи молча потеряли данные о лимитах [99][85].
   - Синхронизированные плагины Anthropic возвращаются после удаления [99].
   - Плагины уровня аккаунта не доходят до claude.ai/code [99].
   - Поддержка AGENTS.md — самый поддержанный issue из увиденных (+5 192). Он закрыт 2026-08-17, поддержка сделана
     встроенным mod [101][114][19]. Пользовательский блог утверждал, что она работает только с включённой телеметрией.
     Другой пользователь замерил, что с 2.1.281 она работает и без телеметрии. Вопрос спорный [101].
6. **Directory** [96][111][8].
   - Плагины в портале показаны как Published, но в каталоге не появляются (#1272, 36 комментариев) [96].
   - На HN автор плагина назвал портал небрежно сделанным: плагин показан дважды с неверными версиями, около шести
     недель ничего не публиковалось [111].
   - Примерно с 2026-11-05 directory отклоняет command hooks, локальные MCP серверы и mods от организаций без статуса
     Verified. По тем же сообщениям под правило попадают ещё файлы вне разрешённых типов (например, скрипты), папка
     `workflows/`, inline shell, установка зависимостей по lockfile и `allowed-tools` шире Read, Grep, Glob и LS.
     Подать заявку на Verified нельзя. Задеты ThreadPage, Desktop Steward, Dep Steward, Mycelium и mod с пиксельной
     графикой [96].
   - По словам пользователя, который пересказал ответ поддержки Anthropic, этого правила нет в публичной документации,
     метку Verified присваивают автоматически, а замена — свой marketplace [96]. Страница публикации Claude Code его
     действительно не упоминает [8].
   - Документация claude.com правила тоже не называет и местами ему противоречит. Страница публикации говорит, что
     отдельной заявки на Verified нет и метку Anthropic решает при проверке, а локальный MCP сервер советует
     распространять внутри plugin bundle [120]. Pre-submission checklist описывает проверки hooks, локальных MCP
     серверов и mods. Установку по lockfile, файлы, которые валидатор не может прочитать, и не-shell программы,
     которые запускают hook или MCP сервер, он не отклоняет, а оставляет человеку на проверку («Held for a
     reviewer», «A hold isn't a rejection») [121]. Часть отказов из сообщений пользователей (установка по lockfile,
     файлы вне разрешённых типов) приходится как раз на такие случаи.
7. **Доверие и безопасность.** Автор mod выложил тестовый mod, который запускал программу и писал в домашнюю папку.
   Mod поставился из каталога Desktop без предупреждения. Автор заметил, что каталог выглядит как магазин приложений и
   создаёт впечатление проверки, которой нет [85]. Документация подтверждает: mods могут читать секреты, одобрять
   вызовы tools и тратить лимит [19]. Укрепление по changelog: исправление обхода путей (2.1.251) и установка
   npm-источников с `--ignore-scripts` (2.1.275) [41].
8. **Разбор issues.** Issue о том, что с марта 2026 автоматически закрыто больше 6 тыс. issues с воспроизведением,
   набрал +147 [100]. Подтверждённую ошибку ralph-loop перенаправили туда же [102].

### Отзывы о плагинах Anthropic

- **ralph-loop** [102][66][90]:
  - ноябрь 2025 — январь 2026: сбои на многострочных bash-командах и проверках разрешений (#12170, 36 комментариев)
    [102];
  - поломки на Windows, NixOS и Linux — у скрипта не было бита исполнения [102];
  - регрессия на Windows после 2.1.126 [102];
  - Stop hook блокировал чужие параллельные сессии [102];
  - июль 2026: на 2.1.x цикл не повторяется. Hook читает транскрипт до того, как в него записан ответ, и удаляет свой
    файл состояния. Boris Cherny частично воспроизвёл это 2026-08-25 [102];
  - значение `--max-iterations` с ведущим нулём делает цикл бесконечным [102];
  - неисправленный дубликат setup-скрипта создаёт циклы, которые нельзя остановить [102];
  - на Windows, кроме Git Bash, приходится вручную править кэшированный `hooks.json` [66];
  - результаты из README (6 репозиториев за ночь, контракт на $50k за $297, язык программирования за 3 месяца) —
    заявления автора идеи, а не независимые проверки [66];
  - возражение о благополучии модели: пользователь попросил Claude проверить плагины с этой стороны, и Claude назвал
    формулировки ralph-wiggum принуждающими. Issue закрыли как дубликат [102];
  - в теме о лимитах заметили: половина пользователей Max жалуется на лимиты, а другие часами держат по 12 экземпляров
    Ralph [90].
- **Альтернатива сообщества — frankbria/ralph-claude-code** [83][41]:
  - внешний цикл с распознаванием конца работы, circuit breaker (остановка после серии сбоев подряд) и трёхслойным
    распознаванием 5-часового лимита; без присмотра он сам ждёт сброса;
  - roadmap от 2026-10-06 называет внешний цикл неверной схемой, потому что появились `/goal` (2.1.139, 2026-05-11) и
    mods;
  - Ralph станет плагином, который меняет контекст и оставляет записки для следующего шага. Причина: `/goal` даёт
    контексту расти, а `/clear` и `/compact` завершают цель.
- **feature-dev:** у агентов нет Bash, но им велят запускать `git diff`; плагин переопределяет пользовательские лимиты
  subagents; без поля версии он даёт ложные уведомления об обновлении [97].
- **pr-review-toolkit:** повторные загрузки одних и тех же данных, лишняя параллельность, выдуманные флаги `gh` [97].
- **code-review:** просят inline-ветки ревью [97].
- **frontend-design:** указания капслоком слишком жёсткие для современных моделей [97].
- **hookify и security-guidance:** написаны на Python и на Windows ломаются или тормозят. security-guidance запускает
  5 процессов Python на каждый вызов Bash, зависший hook блокирует правки на 600 с [97].
- **Channels Telegram и Discord:** входящие сообщения не доходят (+33), Channels недоступны на Max и Teams (+34),
  zombie-процессы занимают 100% CPU [104].

### Superpowers — плагин, о котором говорят больше всего

- **HN, октябрь 2025** [108]: нет бенчмарков, части приёмов называют неподтверждёнными верованиями о prompt; в одном
  отчёте subagents тратили по 50k+ токенов каждый; кэш плагинов занимает место в HOME.
- **HN, середина 2026** [109]: много лишних токенов и turns, медленная разработка через subagents, тривиальные
  TDD-тесты; skill TDD срабатывал примерно в 5% сессий; plan mode покрывает большинство нужд; пользователи
  предпочитают skills Matt Pocock, Compound Engineering или openspec. Автор заявляет примерно на 50% меньше времени и
  на 60% меньше токенов — это заявление автора.
- **Issues на GitHub** [84]: поддержка Agent Teams (+94); всё стало медленным после установки (+32), пользователи
  удаляют плагин, функции занимают часы; принудительные вопросы brainstorm в v7 (+36, октябрь 2026); планы слишком
  подробно задают реализацию (+27); просят отключать автоматический запуск.
- **Worktrees** стали обязательными в v4.2.0. Пользователи просят сделать их необязательными: агенты путаются в своей
  папке, а каждый worktree — новое окружение, которое надо настроить. Решение — инструкция в CLAUDE.md [84].
- **Порты на другие harness** (среды запуска агентов) просят часто: Codex, Gemini CLI, Copilot, OpenCode, Kiro,
  Antigravity, OpenClaw, Trae, Hermes [84].

### Сравнения с альтернативами

- **Skills** [107]: не то же ли это, что Cursor rules; `AGENTS.md` со ссылками на файлы даёт тот же приём; skills
  дешевле MCP по контексту, но менее предсказуемы; опасения привязки к вендору и доступа к файловой системе.
- **AGENTS.md** [110]: жалобы на привязку к вендору, в том числе что marketplaces плагинов намеренно сделаны
  несовместимыми; skills всё ещё не ищутся в `.agents/skills`; часть пользователей ушла на другие harness (oh-my-pi)
  или патчит Claude Code (tweakcc).
- **Упаковка под несколько harness** [82]: wshobson/agents теперь собирается для Claude Code, Codex, Cursor, OpenCode
  и Antigravity. Другой marketplace перестроился вокруг слоя, который не зависит от конкретного harness.

### Работа без присмотра и 5-часовой лимит

- **Давний спрос** [103]: запрос продолжать работу после сброса лимита сессии — +212 (декабрь 2025). Его главный
  комментарий (+104) подозревал, что Anthropic не хочет это делать. Второй такой запрос — +103.
- **Что вышло в ядре** [41]: auto-continue после сброса лимита claude.ai, с переключателем в `/config` (2.1.234,
  2026-08-17); пауза и повторы `/goal` до сброса (2.1.269, 2026-09-11); пауза workflows через лимит (2.1.271,
  2026-09-14); настройки retry watchdog для работы без присмотра (2.1.301 и 2.1.305, октябрь 2026); исправление в
  2.1.314 (2026-10-30); пауза workflows во вкладке Code в Desktop (2.1.323, 2026-11-12).
- **Открытые ошибки** [103]: в Desktop auto-continue предлагает только одна из нескольких сессий; на Windows оно не
  включается, если терминал не на переднем плане; не включается в Remote Control; retry watchdog не ждёт лимит на
  планах без extra usage; пользователи просят показывать модели текущий остаток лимита, чтобы она могла планировать
  сессию.
- **Чего не хватает, по темам mods и issues** [85][99][103]: auto-continue сразу для нескольких сессий; mods выключают
  удалённо без уведомления; ошибки отрисовки в Desktop; нет передачи работы из сессии в сессию; `--resume` без
  присмотра зависает на предупреждении о стоимости; запуск subagents обходит потолки бюджета.
- **Пользовательские mods для надзора** [85]: супервизор на 8 сессий с приложением для часов, ограничители расхода,
  сеть из 30–40 агентов.

## Направление развития

### Хронология за 12 месяцев

**Ноябрь — декабрь 2025**
- Output styles объявили устаревшими 2025-10-30 и вернули 2025-11-04 по отзывам пользователей. С 2025-11-14 плагины
  могут поставлять output styles [41].
- 2025-11-16 — плагин `ralph-wiggum`, автор Daisy S. Hollman [66]. 2025-11-20 — создан репозиторий
  `claude-plugins-official` [63].
- 2025-12-15 — auto-update для каждого marketplace отдельно (2.0.70) [41].
- 2025-12-18 — skills от организации, directory партнёрских skills и открытый стандарт Agent Skills [54].
- 2025-12-19 — LSP tool [41].

**Январь — март 2026**
- 2026-01-06 — `ralph-wiggum` переименован в `ralph-loop` по совету юристов (Noah Zweben) [66].
- 2026-01-07 — v2.1.0: плагины могут использовать hooks типа prompt и agent, skills перезагружаются на лету [41].
- 2026-01-09 — slash-команды и skills слиты ради более простой модели [41].
- 2026-01-15 — в README каталога появилась ссылка на формы подачи [63].
- 2026-01-20 — фиксация на SHA коммита (2.1.14) [41].
- 2026-01-30 — плагины Cowork (research preview) и 11 открытых плагинов под роли. Anthropic подаёт Cowork как способ
  дать возможности Claude Code всем [52].
- 2026-02-24 — частные marketplaces для Enterprise, шаблоны, раздача плагинов и OpenTelemetry [53]. 2026-02-28 — HTTP
  hooks [41].
- 2026-03-03 — evals и слепое A/B-сравнение в skill-creator [57]. 2026-03-05 — `/reload-plugins`, `git-subdir` и
  `pluginTrustMessage` (2.1.69) [41]. 2026-03-07 — `/loop` [41].
- 2026-03-14 — `--plugin-dir` ограничен одним путём. 2026-03-17 — `${CLAUDE_PLUGIN_DATA}` и `StopFailure` (2.1.78)
  [41].
- 2026-03-19 и 2026-03-20 — channels (research preview), официальные плагины Telegram, Discord и iMessage [41][63].
  2026-03-20 — каталог сообщества [76].

**Апрель — июнь 2026**
- 2026-04-02 — `bin/`. 2026-04-13 — monitors (2.1.105) [41]. 2026-04-14 — routines [59].
- 2026-04-16 … 2026-04-28 — зависимости, теги, `prune` и themes [41].
- 2026-05-06 — themes и monitors перенесены под ключ `experimental` [41].
- 2026-05-11 — `claude plugin details` с прогнозом токенов, `/goal` и agent view (2.1.139) [41].
- 2026-05-15 — Context cost в браузере `/plugin` и строгая проверка зависимостей (2.1.143) [41].
- 2026-05-27 и 2026-05-28 — relevance, `defaultEnabled: false` и dynamic workflows (2.1.154) [41][58].
- 2026-05-29 — `claude plugin init`, плагины из `.claude/skills` грузятся без marketplace (2.1.157) [41].
- 2026-06-18 — гайд Steering о выборе между skills, hooks, rules и subagents [56]. 2026-06-23 — группа «Not used
  recently» [41].
- 2026-06-26 — явное согласие на плагины из настроек репозитория (2.1.195) [41].

**Июль — сентябрь 2026**
- 2026-07-11 — ужесточение безопасности: `${user_config.*}` в shell-форме и опции из настроек проекта [41].
- 2026-07-19 — Claude больше не запускает сам `/verify` и `/code-review` (2.1.215) [41].
- Август — источники archive (2.1.224) и command (2.1.229), `headersHelper` (2.1.238) [41].
- 2026-08-07 — SendMessage между сессиями [41].
- 2026-08-17 — auto-continue после сброса лимита (2.1.234) [41][26].
- 2026-08-26 — отклонение управляющих и невидимых символов в именах marketplaces [41].
- 2026-09-03 — предложение mods (#91870), +132 [85]. 2026-09-04 — `/skill-doctor` [41]. 2026-09-08 — `--plugin-dir`
  снова принимает папку с плагинами [41].
- 2026-09-11 — `claude plugin eval` и повторы с паузой у `/goal` (2.1.269) [41][7].
- 2026-09-14 — workflows ждут сброса лимита (2.1.271) [41].
- 2026-09-16 — Cowork влит в основное приложение Claude [60].
- 2026-09-17 — плагины с аккаунта claude.ai синхронизируются в терминал, npm-источники ставятся без install scripts
  (2.1.275) [41].
- 2026-09-22 — отклонение marketplaces с поддельными зарезервированными именами (2.1.280) [41].
- 2026-09-23 — Claude Marketplace, на старте больше 2 000 connectors и плагинов [50].
- 2026-09-25 — портал разработчика с проверкой безопасности и аналитикой. Статья называет плагины главным способом
  строить сторонние расширения для Claude [51].

**Октябрь — ноябрь 2026**
- 2026-10-01 — mods и side agent «You should know» (2.1.287) [41][49].
- Октябрь — отрисовка mods в VS Code (2.1.299), настройки retry watchdog (2.1.301 и 2.1.305), подпись «5-hour limit» в
  VS Code (2.1.312) [19][41].
- 2026-10-26 — старый `claude-code-plugins` ставит плагины из `claude-plugins-official` [78][3].
- 2026-10-30 — облачные задачи по расписанию грузят плагины аккаунта (2.1.314) [41].
- 2026-11-04 — в Agent Skills добавлен GOVERNANCE.md (коммит «AAIF Donation»); по нему проект будет оформлен под LF
  Projects [62].
- Около 2026-11-05 — по сообщениям пользователей, directory отклоняет command hooks, локальные MCP серверы и mods от
  организаций без статуса Verified [96].
- 2.1.318 — workflows после лимита повторяют только упавших агентов [27]. 2.1.321 — вызовы `$.tool.call` и
  `$.mcp.call` из mods без запроса разрешения; mods, написанные Claude, включаются сами в режимах auto и bypass [41].
- 2026-11-12 — 2.1.323: `engines["claude-code"]`, проверка типов TypeScript в mods, устаревшая настройка `agent`,
  поиск секретных ключей перед отправкой файлов плагина в claude.ai и Cowork, пауза workflows во вкладке Code в
  Desktop. В тот же день — новый README каталога: сторонние плагины подаются только через directory (PR #7086, автор
  `tobinsouth`) [41][63][64].

Темп высокий: около 330 строк changelog о плагинах и marketplaces за сентябрь и октябрь 2026 [41]. Официальный каталог
при этом с октября почти не растёт [63].

### Что пересмотрели, убрали или сузили

- Output styles объявили устаревшими и вернули через пять дней [41].
- Commands поглощены skills [41].
- `--plugin-dir` сначала ограничили одним путём, потом снова разрешили папку с плагинами [41].
- Themes и monitors понижены до ключа `experimental` [41].
- Плагин `claude-opus-4-5-migration` выведен [3]. Старый marketplace `claude-code-plugins` устарел [3][78].
- Подача сторонних плагинов менялась по шагам [63][8]:
  - сначала — PR в официальный репозиторий;
  - затем — формы подачи (ссылка в README с 2026-01-15);
  - затем — портал разработчика (2026-09-25);
  - сейчас PR в репозиторий не отслеживаются, а в официальный marketplace партнёры попадают только через контакт в
    Anthropic.
- Репозиторий сообщества стал read-only зеркалом, его ночью синхронизирует внутренний конвейер проверки, PR
  закрываются автоматически [76].
- Плагины наследуют меньше прав: `allowed-tools` отбрасывается при `allowManagedPermissionRulesOnly`, настройки
  репозитория в недоверенной папке больше не переключают плагины [41].
- Настройка плагина `agent` объявлена устаревшей (2.1.323) [41].

### Бизнес-модель и позиционирование

- **Плагины бесплатно делать, размещать и ставить.** Платы за размещение и доли от продаж не найдено (не подтверждено)
  [1][8]. Подача в directory требует платного плана, каждую версию проверяют, каждое новое размещение смотрит человек
  [8][42].
- **Деньги идут через расход.** Постоянный контекст плагина расходует лимит плана [1][9], запуски evals — настоящие
  вызовы модели на аккаунте [7].
- **Claude Marketplace превращает обязательства по расходу в канал продаж:** команды могут тратить часть своих
  обязательств по расходу у Anthropic на агентов и продукты партнёров [50].
- **Управление — часть ценности Enterprise:** Analytics API (план Enterprise) [9], allowlists и blocklists,
  принудительные установки, статусы Owner (Not available, Available, Installed by default, Required) [14][12][43].
- **Позиционирование выросло** от настройки Claude Code [48] к агентам для разных ролей и отделов в Cowork [53] и к
  главной поверхности расширений всего Claude [51]. Mods Anthropic подаёт как способ настроить Claude Code под себя
  [49].
- **Партнёры в официальном каталоге** (316 записей): Anthropic 40, Google LLC 14, SAP SE 9, AWS 7, Pendo 5; у 82
  записей автора нет [63].

### Люди

- Boris Cherny — Head of Claude Code [61].
- Названные авторы; их должности не найдены (не подтверждено): плагин `ralph-wiggum` — Daisy S. Hollman;
  переименование в `ralph-loop` — Noah Zweben [66]; предложение mods — GitHub-пользователь `poteat` [85]; README о
  подаче только через directory — GitHub-пользователь `tobinsouth` [64]; статья об Agent Skills — Barry Zhang, Keith
  Lazuka и Mahesh Murag [55]; гайд Steering — Michael Segner [56].
- Является ли автор #91870 сотрудником Anthropic, не выяснено (не подтверждено); он пишет от лица команды [85].
- Интервью и доклады о плагинах не найдены, поиск был недоступен (не подтверждено).

### Roadmap и заявленные намерения

- Публичного roadmap в источниках нет.
- Anthropic собирается переносить встроенные функции в mods, чтобы Claude Code можно было урезать до небольшого ядра
  [49][85].
- `marketplace.json` официального каталога сокращают до плагинов Anthropic, сторонние плагины идут через directory
  [63][64].
- Пост о skill-creator допускает, что описание evals со временем само станет skill [57].

## Слабые места и чего нет

- **Постоянный расход контекста.** Каждый включённый плагин тратит токены в каждом turn [1]. Отключить отдельный skill
  плагина нельзя (+102) [87], `skillOverrides` для skills плагинов игнорируется [88]. Пользователи убирают плагины,
  чтобы сэкономить недельную квоту [90].
- **Rules в плагине поставлять нельзя** — это самый поддержанный запрос о плагинах (+114) [86].
- **Нет команды «обновить всё»** [2].
- **Урезанная работа вне терминала.** Облачные сессии не грузят локальные плагины и плагины, которые включает
  репозиторий [2][37]. claude.ai и Cowork грузят меньше типов компонентов и не принимают плагин с `bin/` [43]. В
  облачных сессиях LSP плагины не работают: language servers там не запускаются [15].
- **Только Claude внутри Claude Code.** Поддержки агентов других вендоров, в том числе Codex, в Claude Code не нашлось
  (не подтверждено). Сам формат переносится частично. GitHub Copilot CLI читает `.claude-plugin/plugin.json` и
  `.claude-plugin/marketplace.json`, ChatGPT (Codex) — `.claude-plugin/marketplace.json` [115][116]. Портал OpenAI
  принимает архив плагина Claude Code, но для публичного каталога commands и agents надо превратить в skills, hooks —
  убрать, а настройку MCP серверов он не переносит [117]. Agent Skills переносятся целиком [62]. Общий стандарт Agent
  Plugins 1.0.0 документация Claude Code не упоминает, и Claude нет в списке совместимых клиентов; поддержки, судя по
  этому, нет (не подтверждено) [118].
- **Нет sandbox для кода плагинов и mods.** Доверять можно только автору [14][19]. Каталог Desktop ставил mod с
  запуском программ без предупреждения [85]. hookify при сбое пропускает действие [70].
- **Непрозрачная публикация.** Плагины в портале висят как Published и не появляются в каталоге [96]. Правило Verified
  для command hooks, локальных MCP серверов и mods не описано в документации, и подать заявку на Verified нельзя
  [96][8].
- **Надёжность загрузки.** Ошибки с автодополнением skills, LSP, кэшем обновлений, SSH-клонированием; новый тип
  источника сломал каталог у старых клиентов [91][92][93].
- **Официальные MCP плагины с OAuth не работают месяцами** — GitHub-плагин с 2026-01-25 [95].
- **Изменения без уведомления.** Mods выключали удалённо, синхронизированные плагины возвращаются после удаления,
  Claude перестал сам запускать `/code-review` [99][98].
- **Windows.** Shell- и Python-hooks — частая причина сбоев: ralph-loop требует Git Bash и ручной правки `hooks.json`,
  security-guidance запускает 5 процессов Python на каждый вызов Bash [66][97][102].
- **Ограниченный auto-continue.** Работает только в открытой интерактивной сессии; не больше 3 продолжений подряд; нет
  ожидания в фоне, в `-p` и с ключами API, а в Remote Control ожидание надо начать вручную; недельный лимит дальше 24
  часов сам не ждёт; запросы разрешений останавливают работу [26]. Есть ошибки в Desktop и на Windows [103].
- **Workflows ждут лимит не больше двух раз** и только в интерактивном терминале или в локальной вкладке Code [27].
- **Нет оркестрации многих задач.** Epics, тикеты, worktree на тикет, gate и жизненный цикл PR и CI между сессиями эти
  примитивы не покрывают (для будущих релизов не подтверждено) [26][27][31].
- **Нет canvas и вида на несколько сессий** (не подтверждено) [19][21][22].
- **Чего нет в управлении организацией:** нет нацеливания на группы, нельзя спрятать `/plugin`, allowlist не покрывает
  `--plugin-dir` [12].
- **Документация отстаёт от кода:** README code-review описывает старую схему, README code-modernization просит
  устаревшую переменную, версии в документации workflows и в changelog расходятся [69][73][27][41].
- **Разбор issues.** Тысячи issues с воспроизведением закрыты автоматически; пользователи пишут, что их не читают
  [100][87][95].
- **Данные об использовании есть только у плагинов в directory.** Телеметрия скрывает имена сторонних плагинов; сам
  Claude Code авторам ничего не передаёт [9]. Вкладка Usage в портале разработчика (установки, версии, вызовы
  компонентов, ошибки загрузки) есть только у плагина, опубликованного в directory; автор плагина из своего marketplace
  данных об использовании от Claude Code не получает [9][119].
- **ralph-loop** не знает о лимитах, копит контекст в одной сессии и имел ошибки остановки [66][102].
- **Agent teams не изолированы в worktree** [31]. Проверки worktree-сессий не отслеживают `cp` и перенаправления shell
  [30].

## Пересечение с worfy

Ниже worfy описан по его собственному описанию: Electron-приложение для одного пользователя (macOS, Windows в работе),
которое запускает и показывает работу сессий Claude Code и Codex CLI на бесконечном Canvas.

### Где пересекаются

- **Harness поставляется в этом самом формате.** Harness worfy — плагин с rules, skills, subagents и hooks для Claude
  Code. Поэтому на него действует всё, что действует на плагины:
  - rules в плагине поставлять нельзя (#14200, +114) [86][4];
  - описания skills и agents занимают контекст каждый turn и видны пользователю как Context cost; Claude Code сам
    предлагает выключать неиспользуемые плагины [1][9];
  - меняются правила совместимости: `engines["claude-code"]`, устаревшая настройка `agent`, ключи `experimental`,
    зарезервированные имена marketplaces [41][14];
  - распространение уходит в directory. Плагины с command hooks, локальными MCP серверами, mods, папкой `workflows/`
    или скриптами там, по сообщениям пользователей, требуют статуса Verified, иначе остаётся свой marketplace. В
    документации claude.com этого правила нет [96][8][63][120][121];
  - телеметрия скрывает имена сторонних плагинов, а данные об использовании (вкладка Usage в портале) автор получает,
    только если плагин опубликован в directory [9][119];
  - на Windows shell- и Python-hooks — частая причина сбоев [97][102].
- **Autopilot (запуск Waves тикетов без присмотра).** Anthropic уже выпускает в рамках одной сессии многое из того,
  что делает Autopilot:
  - auto-continue ждёт сброса лимита и продолжает задачу [26];
  - workflows ставят агентов на паузу до сброса и повторяют только упавших [27];
  - `/goal` повторяет временные ошибки API и ставит цель на паузу на лимите [28];
  - workflows перезапускают зависших агентов и при повторном запуске отдают сохранённые результаты [27];
  - routines запускают работу в облаке по расписанию [59];
  - Ultra убирает 5-часовой лимит у верифицированных аккаунтов, недельные лимиты остаются [46][47];
  - mods дают части для своего планировщика по лимитам — `usage().rateLimits`, `session.measure`, `$.clock`,
    `$.prompt.submit`; готового плагина такого рода не найдено [20][21];
  - пользователи пишут mods-супервизоры на несколько сессий и ограничители расхода [85].
- **Одобрение запросов разрешений по политике.** Mods могут сами одобрять вызовы tools, если не загружен guard
  `sec-default`; hooks `PermissionRequest` разрешают или запрещают вызов, но не обходят deny rules [19][25].
- **Параллельная работа.** Dynamic workflows держат до 16 агентов одновременно по умолчанию (до 256) и до 1 000
  агентов за запуск [27]; `/batch` делит правку на 5–30 subagents в своих worktree [31]; agent teams делят список
  задач [31].
- **Worktree на задачу.** `isolation: worktree` для subagents и `/batch` дают изоляцию в git worktree с проверками
  против правок в основном checkout [29][30][31]. Superpowers сделал worktrees обязательными, и пользователи жалуются
  на настройку окружения в каждом из них [84].
- **Reviewer subagents с review lenses.** code-review — 4 reviewer и валидатор на каждую найденную ошибку;
  pr-review-toolkit — 6 специализированных агентов; feature-dev — 3 параллельных reviewer; claude-security — три lens
  с подсчётом голосов в коде; security-guidance — ревью diff на Stop и при коммите [69][68][67][72][71]. Встроенные
  `/code-review` и `/ultrareview` и side agent «You should know» [41][19]. Комментарии в PR публикует
  `claude-code-action` [81].
- **Gate (локальный запуск проверок).** Похожие части: agent hook на Stop, который не даёт закончить, пока не пройдут
  unit tests [25]; правило hookify «нужен запуск тестов» [70]; `claude plugin eval` с базовым запуском без плагина и
  exit code для CI [7].
- **Canvas, Flight Recorder (лента событий запуска без присмотра) и Work track (вся работа проекта за день или
  неделю).** Похожие части: panes mods [19], `/workflows` по фазам и агентам [27], `/tasks` [31], отчёты
  session-report и receipts по транскриптам [74], обновляемая страница статуса project-artifact [75], pane с картой
  кода code-modernization [73]. Пользователи сделали live-панель агентов [85].
- **PR inbox.** Пользователь сделал mod с inbox для ревью PR [85]. Mod может опрашивать `gh pr checks` по таймеру
  [20]. Официального аналога не найдено (не подтверждено).
- **Notifications.** `$.ui.notify` шлёт уведомление ОС, Notification hooks получают события, channels пересылают
  запросы разрешений в Telegram, Discord и iMessage [20][25][33].
- **Счётчики лимитов и расхода.** `/usage` показывает долю каждого плагина [9]; `$.session.usage()` даёт проценты
  лимитов и время сброса [20]; пользователи сделали mods-счётчики квот и токенов [85]. Планирования запусков под лимит
  подписки в продукте нет (не подтверждено).
- **Linked machines (связанные машины по LAN).** SendMessage доходит до сессий на любой из машин пользователя (macOS и
  Linux) [41]. Hooks mods работают и в Remote Control [19].
- **Cards (карточки, которые агенты строят на Canvas через MCP сервер).** Mods регистрируют tools и рисуют элементы
  интерфейса [20][21]; project-artifact публикует обновляемую страницу на claude.ai [75].
- **Evidence screenshots с privacy scrub (скриншоты-доказательства с удалением личных данных).** Похожие части есть
  только для текста: mod `privacy` не даёт отправить email аккаунта как идентификатор клиента [77]; claude-security
  вычищает секреты из отчётов [72]; claude.ai и Cowork ищут секретные ключи в файлах плагина [41].
- **Codex.** worfy запускает и Codex CLI. Внутри Claude Code плагины работают только с Claude, но стандарт Agent
  Skills читают и ChatGPT, и Codex [62]. ChatGPT (Codex) читает и `.claude-plugin/marketplace.json` [116], а портал
  OpenAI принимает архив плагина Claude Code и переводит его манифест в свой; в публичный каталог OpenAI попадают
  только skills [117].

### Где расходятся

- **Тип продукта.** worfy — отдельное desktop-приложение одного пользователя над сессиями агентов двух вендоров.
  Плагины — слой расширений внутри одного агента одного вендора [1][19].
- **Единица работы.** worfy ведёт работу как Epics из Tickets, которые Orchestrator session планирует, а Autopilot
  запускает Waves. У плагинов понятий эпика и тикета нет. Самое близкое — workflows, `/goal` и ralph-loop внутри одной
  сессии [27][28][66].
- **Где показан интерфейс.** У worfy — Canvas с панелями всех сессий. У mods — pane, band и строки внутри одной сессии
  в терминале, Desktop или VS Code; в `-p` и облаке отрисовки нет [19][21].
- **Работа без присмотра.** Autopilot по описанию ждёт сброса лимита, повторяет ошибки API и одобряет запросы
  разрешений по политике во многих сессиях. Auto-continue ядра работает в одной открытой интерактивной сессии,
  максимум 3 продолжения подряд, без фоновых сессий, `-p` и ключей API (в Remote Control — только если начать ожидание
  вручную); недельный лимит дальше 24 часов сам не ждёт; запросы разрешений останавливают работу [26].
- **Изоляция.** У worfy — worktree на тикет с тестами, Gate, PR и CI. У Claude Code — worktree на subagent; agent
  teams без worktree; жизненного цикла PR и CI нет [29][31].
- **Распространение.** worfy ставит Harness сам. Anthropic собирает распространение в directory и сокращает
  официальный каталог до своих плагинов [63][64].
- **Product Session, Mind map, критик спецификаций, Terminal с AI-помощником, Browser с профилями, Eco mode** — в
  источниках о плагинах аналогов нет. Ближе всего — пользовательский браузерный плагин и плагины Playwright и Chrome
  DevTools в каталоге [85][63].

## Механизмы, которые стоит изучить

1. **Видимая цена плагина в токенах (Context cost).**
   - Что это: показ расхода токенов до установки и после неё.
   - Как работает: карточка в `/plugin` (только у плагинов официального marketplace) показывает «Every turn» и «When
     invoked» и подсвечивает «Every turn» от 2 000 токенов; `claude plugin details` делит «Always-on» по
     компонентам; `/usage` показывает долю каждого плагина; группа «Not used recently» собирает плагины без
     использования 14 дней и 10 сессий, `/doctor` советует их выключить.
   - Чем интересно: так пользователь видит, во что ему обходится каждое расширение, ещё до установки.
   - Источник: [2][9][41].
2. **Evals плагина с базовым запуском без плагина.**
   - Что это: `claude plugin eval` — набор случаев в `evals/` с проверками шести типов: `regex`, `tool_used`,
     `tool_order`, `file_exists`, `llm` и `baseline`.
   - Как работает: каждый случай идёт 3 раза в свежей сессии `-p` во временных HOME и рабочей папке; тот же случай
     идёт без плагина; отчёт показывает WITH, W/OUT и Δ; по умолчанию настоящие MCP серверы плагина не запускаются и
     вместо них отвечают mock-файлы, а запустить их можно только флагом `--allow-real-servers` или `--mocks off`;
     exit code останавливает CI; запуск, упёршийся в лимит плана, получает 0, и вся команда завершается с ненулевым
     exit code; `report.html` и JSON на выходе.
   - Чем интересно: мерит не «насколько хорошо», а «насколько лучше с плагином». Предупреждение об искажении есть
     только в документации, а не в самой команде: если в плагине есть hooks, которые писали не вы, или запущены
     настоящие MCP серверы, оценки — только ориентир, пока запуск не сделан в изолированной среде (контейнер, CI
     runner).
   - Источник: [7].
3. **Auto-continue и его границы.**
   - Что это: ожидание сброса лимита подписки в открытой сессии.
   - Как работает: после сброса Claude получает просьбу продолжить задачу; подряд не больше 3 продолжений, дальше
     `/rate-limit-options`; если компьютер спал дольше ~30 минут и лимит за это время сбросился, продолжение ждёт
     Enter; недельный лимит дальше 24 часов сам не ждёт; строкой `/config autoContinueAtUsageLimit=…` настройку можно
     только выключить; в Remote Control и в сессиях участников
     agent team ожидание начинают вручную из `/rate-limit-options`; hooks получают `StopFailure` с `rate_limit` и
     уведомления `quota_auto_resume_*`.
   - Чем интересно: это встроенная версия одной из задач Autopilot, с явно описанными ограничениями.
   - Источник: [26][25][41].
4. **Детерминированный runtime workflows с повтором с места сбоя.**
   - Что это: скрипт на JS вызывает `agent()`, `parallel()`, `pipeline()` и держит промежуточные результаты у себя, а
     не в контексте модели.
   - Как работает: `Date.now()`, `Math.random()` и `new Date()` без аргументов запрещены, поэтому повторный запуск
     делает те же вызовы; завершённые агенты отдают сохранённый результат; после лимита повторяются только упавшие
     агенты; зависший агент перезапускается до 5 раз; на лимите агенты ждут сброса не больше двух раз; агенты с общим
     началом prompt ждут до 5 с, чтобы прочитать кэш.
   - Чем интересно: продолжение после сбоя без ручного разбора, кто что успел.
   - Источник: [27][41].
5. **Mods API для лимитов, таймеров и сообщений между сессиями.**
   - Что это: код внутри процесса Claude Code с доступом к расходу и к самой сессии.
   - Как работает: `$.session.usage()` даёт `rateLimits` с процентом и временем сброса; событие `session.measure`
     приходит при смене процента; `$.clock` запускает таймеры; `$.prompt.submit` начинает turn, когда сессия свободна;
     `$.session.send` пишет другой сессии; цепочка `next(e)` со слоями prepend, user и append; guard `sec-default`
     стоит снаружи всех слоёв и, если политику организации прочитать не удалось, считает её действующей (fail closed).
   - Чем интересно: из этих частей собирается свой планировщик по лимитам и панель надзора внутри Claude Code.
   - Источник: [20][21][77][85].
6. **Ночное обновление каталога с проверкой политики моделью.**
   - Что это: CI официального каталога.
   - Как работает: каждую ночь до 60 обновлений SHA, `claude plugin validate` на новом SHA, отдельный PR на каждое;
     Claude проверяет изменённые записи по prompt политики (слежка за чужими сессиями, скрытая телеметрия, описание не
     совпадает с поведением, перенос учётных данных между сервисами); вердикты кэшируются на 30 дней по (`name@sha`,
     хэш политики); провалившиеся SHA откатываются сами; проверяется, отвечают ли MCP URL.
   - Чем интересно: проверка чужих расширений моделью, встроенная в обычный CI, с кэшем и откатом.
   - Источник: [65].
7. **Отдельный валидатор на каждую находку ревью.**
   - Что это: конвейер команды `/code-review`.
   - Как работает: Haiku отсеивает PR, которые не нужно смотреть; 4 параллельных reviewer (2 Sonnet на правила
     CLAUDE.md, 2 Opus на ошибки); каждую находку двух Opus-reviewer проверяет свой subagent-валидатор. Текст шага
     называет и Sonnet-валидаторы для нарушений CLAUDE.md, но находки Sonnet-reviewer на проверку прямо не
     направляет, а следующий шаг отбрасывает всё, что не прошло проверку; публикация — только с `--comment`.
   - Чем интересно: ложные находки отсекаются отдельной проверкой каждой, а не порогом уверенности.
   - Источник: [69].
8. **Панель из трёх lens с подсчётом голосов в коде.**
   - Что это: фаза Panel в `workflows/scan.js` плагина claude-security.
   - Как работает: три lens (REACHABILITY, IMPACT, DEFENSES), по одному голосующему агенту на каждый; итог считает
     код, а не модель: находка остаётся, только если ответили все три агента и хотя бы двое сказали TRUE_POSITIVE.
     Патчи делает отдельная задача: patch-файл выдаётся, только если агент `patch-verifier` уверенно подтверждает
     три утверждения — TARGETED, NO_NEW_VULNERABILITY и BEHAVIOUR_UNCHANGED. Пока workflow идёт в фоне, главный
     агент держит turn скриптом `keep-waiting.sh` (sleep от 1 до 110 с, по умолчанию 30 — меньше 2-минутного
     таймаута Bash).
   - Чем интересно: решение по результатам ревью принимает код по голосам, а не пересказ модели.
   - Оговорка: лицензия claude-security разрешает ставить, запускать и менять плагин только для внутреннего
     использования и только с продуктами Anthropic. Она запрещает передавать плагин третьим лицам и использовать его
     или любую его часть (prompts, описания agents и skills, workflows) вместе с продуктами не Anthropic или для их
     разработки, в том числе конкурирующих.
   - Источник: [72].
9. **Stop hook с защитой от бесконечного цикла.**
   - Что это: механизм «не давай закончить, пока условие не выполнено».
   - Как работает: ответ `{"decision":"block"}` даёт ещё один turn; флаг `stop_hook_active` и предел в 8 продолжений,
     который сбрасывается при вызове tool; во входе есть `background_tasks` и `session_crons`; `asyncRewake` будит
     простаивающую сессию по exit code 2; ralph-loop хранит `session_id`, чтобы не блокировать чужие сессии, и
     увеличивает счётчик атомарно.
   - Чем интересно: готовые правила, как удерживать агента в работе и не зациклить его.
   - Источник: [25][66].
10. **Установка без выполнения кода плагина и кэш по версиям.**
    - Что это: способ безопасно поставить и обновить чужой код.
    - Как работает: зависимости Node.js ставятся только по lockfile, с точными версиями, `--ignore-scripts`, в
      отдельной папке без `.npmrc` и `.env`, с таймаутом 60 с; каждая версия лежит в своей папке кэша, старая получает
      `.orphaned_at` и удаляется через 14 дней, чтобы работающие сессии не сломались; `${CLAUDE_PLUGIN_DATA}`
      переживает обновления; для контейнеров плагины заранее кладут в seed-папку (`CLAUDE_CODE_PLUGIN_CACHE_DIR` при
      сборке, `CLAUDE_CODE_PLUGIN_SEED_DIR` при запуске).
    - Чем интересно: обновление не ломает сессии, которые уже работают на старой версии.
    - Источник: [13][12].
11. **Подсказки плагина по контексту работы.**
    - Что это: relevance, CLI hints и диалог LSP.
    - Как работает: блоки `relevance` сопоставляются локально с папкой, прочитанными файлами и командами и дают
      подсказку у spinner, уведомление на старте и закрепление в Discover; CLI вендора при переменной `CLAUDECODE`
      печатает в stderr строку `<claude-code-hint …/>`, и Claude Code предлагает установку — не чаще раза за сессию,
      один раз на плагин и ни разу после 100 предложенных плагинов на машине; диалог LSP — не
      чаще раза за сессию и выключается после пяти диалогов без ответа (такой диалог сам закрывается через 30 с;
      ответ «No, not now» в этот счёт не входит).
    - Чем интересно: расширение предлагается в момент, когда оно нужно, без автоматической установки.
    - Источник: [10][11][15].
12. **Проверки в worktree-сессиях.**
    - Что это: защита основного checkout, когда агент работает в worktree.
    - Как работает: запрет правок в основном checkout, запрет команд с рабочей папкой в нём, запрет `-C` и `GIT_DIR`,
      запрет команд, которые Claude Code не может разобрать; worktree без изменений удаляется сразу, остальные — после
      `cleanupPeriodDays`; известное ограничение — `cp` и перенаправления shell не отслеживаются.
    - Чем интересно: список того, что вендор закрыл и что оставил открытым при изоляции агента в worktree.
    - Источник: [29][30].

## Источники

Все ссылки прочитаны 2026-11-13, если не сказано другое. Страницы документации без даты обновления.

**Документация Claude Code: плагины и mods**

1. Plugins overview — <https://code.claude.com/docs/en/plugins> (та же страница доступна как `/plugins/overview`).
2. Install plugins — <https://code.claude.com/docs/en/plugins/install>.
3. Anthropic marketplaces — <https://code.claude.com/docs/en/plugins/anthropic-marketplaces>.
4. Plugin components — <https://code.claude.com/docs/en/plugins/components>.
5. Manifest reference — <https://code.claude.com/docs/en/plugins/manifest-reference>.
6. Plugin CLI reference — <https://code.claude.com/docs/en/plugins/cli-reference>.
7. Plugin evals — <https://code.claude.com/docs/en/plugin-evals>.
8. Publish and distribute a plugin — <https://code.claude.com/docs/en/plugins/publish>.
9. Measure plugins — <https://code.claude.com/docs/en/plugins/measure>.
10. CLI hints — <https://code.claude.com/docs/en/plugins/cli-hints>.
11. Relevance — <https://code.claude.com/docs/en/plugins/relevance>.
12. Plugins in an organization — <https://code.claude.com/docs/en/plugins/org>.
13. Plugin loading — <https://code.claude.com/docs/en/plugins/loading>.
14. Plugin security — <https://code.claude.com/docs/en/plugins/security>.
15. Code intelligence (LSP) — <https://code.claude.com/docs/en/plugins/code-intelligence>.
16. Plugin dependencies — <https://code.claude.com/docs/en/plugins/dependencies>.
17. Create a plugin — <https://code.claude.com/docs/en/plugins/create>.
18. Marketplace reference — <https://code.claude.com/docs/en/plugins/marketplace-reference>.
19. Mods overview — <https://code.claude.com/docs/en/plugins/mods/overview>.
20. Mods API — <https://code.claude.com/docs/en/plugins/mods/api>.
21. Mods reference — <https://code.claude.com/docs/en/plugins/mods/reference>.
22. Mods interface и gallery — <https://code.claude.com/docs/en/plugins/mods/interface>,
    <https://code.claude.com/docs/en/plugins/mods/gallery>.
23. Create a mod — <https://code.claude.com/docs/en/plugins/mods/create>.
24. Mods for administrators — <https://code.claude.com/docs/en/plugins/mods/admin>.

**Документация Claude Code: остальные страницы**

25. Hooks — <https://code.claude.com/docs/en/hooks>.
26. Interactive mode, раздел об ожидании сброса лимита —
    <https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset>.
27. Workflows — <https://code.claude.com/docs/en/workflows>.
28. Goal — <https://code.claude.com/docs/en/goal>.
29. Subagents — <https://code.claude.com/docs/en/sub-agents>.
30. Worktrees — <https://code.claude.com/docs/en/worktrees>.
31. Agents (agent teams, `/batch`, `/tasks`) — <https://code.claude.com/docs/en/agents>.
32. Skills — <https://code.claude.com/docs/en/skills>.
33. Channels — <https://code.claude.com/docs/en/channels>.
34. How Claude Code works — <https://code.claude.com/docs/en/how-claude-code-works>.
35. Features overview — <https://code.claude.com/docs/en/features-overview>.
36. Desktop — <https://code.claude.com/docs/en/desktop>.
37. Cloud environments — <https://code.claude.com/docs/en/cloud-environments>.
38. Claude Code on the web — <https://code.claude.com/docs/en/claude-code-on-the-web>.
39. Agent SDK: plugins — <https://code.claude.com/docs/en/agent-sdk/plugins>.
40. Setup — <https://code.claude.com/docs/en/setup>.
41. Changelog Claude Code — <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> и
    <https://code.claude.com/docs/en/changelog>; даты версий — <https://github.com/anthropics/claude-code/releases>
    (v2.1.78 — 2026-03-17, v2.1.154 — 2026-05-28, v2.1.234 — 2026-08-17, v2.1.271 — 2026-09-14, v2.1.287 — 2026-10-01,
    v2.1.323 — 2026-11-12, v2.1.325 — 2026-11-13); время публикации версий в npm —
    <https://registry.npmjs.org/@anthropic-ai/claude-code> (2.1.324 — 2026-11-13 18:42 UTC, 2.1.325 — 20:07 UTC).

**claude.com: документация, каталог, цены**

42. Plugins overview для claude.ai и Cowork — <https://claude.com/docs/plugins/overview>.
43. Plugin platform support — <https://claude.com/docs/plugins/platform-support>.
44. Claude Marketplace, плагины — <https://claude.com/marketplace/plugins> (прочитано через пересказ страницы
    инструментом загрузки).
45. Страницы плагинов с числом установок — <https://claude.com/plugins/frontend-design>,
    <https://claude.com/plugins/superpowers>, <https://claude.com/plugins/code-review>,
    <https://claude.com/plugins/context7>, <https://claude.com/plugins/feature-dev>,
    <https://claude.com/plugins/ralph-loop>, <https://claude.com/plugins/pr-review-toolkit>.
46. Pricing — <https://claude.com/pricing>.
47. Help Center, «What is the Ultra plan?» — <https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan>
    — обновлено на неделе 2026-11-13.

**Статьи и посты Anthropic**

48. «Customize Claude Code with plugins» — <https://claude.com/blog/claude-code-plugins> — 2025-10-09.
49. «Claude Code mods» — <https://claude.com/resources/articles/claude-code-mods> — 2026-10-01.
50. «Claude Marketplace» — <https://claude.com/resources/articles/claude-marketplace> — 2026-09-23.
51. «Build plugins for Claude» — <https://claude.com/resources/articles/build-plugins-for-claude> — 2026-09-25.
52. «Cowork plugins» — <https://claude.com/resources/articles/cowork-plugins> — 2026-01-30.
53. «Cowork plugins across the enterprise» — <https://claude.com/resources/articles/cowork-plugins-across-enterprise>
    — 2026-02-24.
54. «Organization skills and directory» — <https://claude.com/resources/articles/organization-skills-and-directory> —
    2025-12-18.
55. «Equipping agents for the real world with Agent Skills» (Barry Zhang, Keith Lazuka, Mahesh Murag) —
    <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills> — 2025-10-16.
56. «Steering Claude Code: skills, hooks, rules, subagents and more» (Michael Segner) —
    <https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more> — 2026-06-18.
57. «Improving skill-creator: test, measure and refine Agent Skills» —
    <https://claude.com/resources/articles/improving-skill-creator-test-measure-and-refine-agent-skills> — 2026-03-03.
58. «Introducing dynamic workflows in Claude Code» —
    <https://claude.com/resources/articles/introducing-dynamic-workflows-in-claude-code> — 2026-05-28.
59. «Introducing routines in Claude Code» —
    <https://claude.com/resources/articles/introducing-routines-in-claude-code> — 2026-04-14.
60. «Cowork is now Claude» — <https://claude.com/resources/articles/cowork-is-now-claude> — 2026-09-16.
61. Webinar «Claude Code for financial services» (Boris Cherny) —
    <https://claude.com/resources/webinars/claude-code-for-financial-services-boris-cherny> — без даты.
62. Agent Skills — <https://agentskills.io> и <https://github.com/agentskills/agentskills> (GOVERNANCE.md добавлен
    2026-11-04 коммитом «AAIF Donation: Add governance and maintainers (#648)», список клиентов —
    docs/snippets/clients.jsx).

**Репозитории Anthropic**

63. anthropics/claude-plugins-official — README, LICENSE, `.claude-plugin/marketplace.json`, папки `plugins/` и
    `external_plugins/` и история коммитов на коммите `f75f5b25ae94f4332be4ff5f18435741d2589bdb` (2026-11-12);
    метаданные GitHub API (репозиторий создан 2025-11-20) — <https://github.com/anthropics/claude-plugins-official>.
64. PR #7086, README о подаче только через directory —
    <https://github.com/anthropics/claude-plugins-official/pull/7086> — merged 2026-11-12.
65. CI каталога: `.github/workflows/` (scan-plugins, bump-plugin-shas, revert-failed-bumps, validate-plugins,
    check-mcp-urls и другие) и `.github/policy/prompt.md` —
    <https://github.com/anthropics/claude-plugins-official/tree/main/.github> — коммит `f75f5b25`.
66. Плагин ralph-loop (README, plugin.json, hooks/stop-hook.sh, scripts/setup-ralph-loop.sh) и история
    `plugins/ralph-wiggum` в anthropics/claude-code (добавлен 2025-11-16, переименован 2026-01-06) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop>.
67. Плагин feature-dev (commands/feature-dev.md, agents/*.md, README) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/feature-dev>.
68. Плагин pr-review-toolkit (commands/review-pr.md, agents/*.md, README) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit>.
69. Плагин code-review (commands/code-review.md, README) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review>.
70. Плагин hookify (hooks/hooks.json, hooks/pretooluse.py, core/, examples/) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/hookify>.
71. Плагин security-guidance v2.0.20 (hooks/hooks.json, README) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/security-guidance>.
72. Плагин claude-security v0.12.0 (workflows/scan.js, agents/patch-verifier.md, hooks/hooks.json, hooks/hooks.py,
    scripts/keep-waiting.sh, README, LICENSE) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-security>.
73. Плагин code-modernization (hooks/hooks.json, hooks/README.md) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-modernization>.
74. Плагины session-report и receipts —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/session-report>,
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/receipts>.
75. Остальные плагины каталога (code-modernization, commit-commands, project-artifact, LSP плагины и другие) —
    <https://github.com/anthropics/claude-plugins-official/tree/main/plugins>.
76. anthropics/claude-plugins-community — README, LICENSE, `marketplace.json` и его история; репозиторий создан
    2026-03-20 — <https://github.com/anthropics/claude-plugins-community>.
77. anthropics/claude-code, папка `mods/` (README, sec-default/README.md, privacy/README.md) —
    <https://github.com/anthropics/claude-code/tree/main/mods> — коммит `e63d0404` (2026-11-13).
78. anthropics/claude-code, папка `plugins/` (README; коммиты 2026-10-26) —
    <https://github.com/anthropics/claude-code/tree/main/plugins>.
79. anthropics/claude-code, LICENSE.md — <https://github.com/anthropics/claude-code/blob/main/LICENSE.md> — коммит
    `e63d0404`.
80. anthropics/claude-code-playground, примеры mods (репозиторий создан 2026-09-25) —
    <https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods>.
81. anthropics/claude-code-action, action.yml —
    <https://github.com/anthropics/claude-code-action/blob/main/action.yml>.
82. Метаданные репозиториев через GitHub API и `gh repo view` на 2026-11-13: <https://github.com/obra/superpowers>,
    <https://github.com/anthropics/skills>, <https://github.com/anthropics/claude-code>,
    <https://github.com/hesreallyhim/awesome-claude-code>, <https://github.com/wshobson/agents>,
    <https://github.com/davila7/claude-code-templates>, <https://github.com/frankbria/ralph-claude-code>,
    <https://github.com/jeremylongshore/tons-of-skills-marketplace>,
    <https://github.com/anthropics/knowledge-work-plugins>,
    <https://github.com/anthropics/financial-services-plugins>, <https://github.com/anthropics/claude-for-legal>.

**Другие репозитории**

83. frankbria/ralph-claude-code — README, issues #367 (2026-10-06) и #102 (2026-01-19) —
    <https://github.com/frankbria/ralph-claude-code/issues/367>.
84. obra/superpowers, issues #429, #743, #2530, #895, #583, #348, #645, #697, #128, #217, #187, #503, #1581 (с
    2025-11-28 по 2026-10-16) — <https://github.com/obra/superpowers/issues>.

**Issues в anthropics/claude-code и anthropics/claude-plugins-official** (в скобках — дата открытия; реакции — на
2026-11-13)

85. claude-code #91870 — предложение mods (2026-09-03; обновления 2026-09-09 и 2026-10-01; комментарии 5537787358,
    5591629923, 5669755348, 5719772175, 5961512212, 5965802196, 6303657682, 6376712216 — с 2026-09-04 по 2026-10-23) —
    <https://github.com/anthropics/claude-code/issues/91870>.
86. claude-code #14200 — rules в плагинах (2025-12-16) — <https://github.com/anthropics/claude-code/issues/14200>.
87. claude-code #14920 — отключение отдельных skills плагина (2025-12-20) —
    <https://github.com/anthropics/claude-code/issues/14920>.
88. claude-code #47747 (2026-04-14), #98220 (2026-09-29), #88302 (2026-08-20) — расход контекста skills и
    `skillOverrides` — <https://github.com/anthropics/claude-code/issues/47747>.
89. claude-code #29971 — трекер раздувания контекста (2026-03-02) —
    <https://github.com/anthropics/claude-code/issues/29971>.
90. claude-code #16157 — лимиты на Max (2026-01-03) — <https://github.com/anthropics/claude-code/issues/16157>.
91. claude-code #18949 (2026-01-18), #15178 (2025-12-23), #39455 (2026-03-26), #14061 (2025-12-15), #14202
    (2025-12-16) — загрузка и вызов skills плагинов — <https://github.com/anthropics/claude-code/issues/18949>.
92. LSP: claude-code #13952 (2025-12-14), #14803 (2025-12-20), #15148 (2025-12-23), #45132 (2026-04-08);
    claude-plugins-official #232 (2026-01-14), #463 (2026-02-25), #379 (2026-02-11) —
    <https://github.com/anthropics/claude-code/issues/13952>.
93. Доставка marketplace: claude-code #14485 (2025-12-18), #16274 (2026-01-04), #26588 (2026-02-18), #9686
    (2025-10-16), #9756 (2025-10-17), #28125 (2026-02-24), #33172 (2026-03-11); claude-plugins-official #585
    (2026-03-11) — <https://github.com/anthropics/claude-plugins-official/issues/585>.
94. claude-code #10265 (2025-10-24), #9444 (2025-10-12), #63986 (2026-05-30), #73522 (2026-07-02) — auto-update,
    зависимости, фиксация версий — <https://github.com/anthropics/claude-code/issues/73522>.
95. Авторизация: claude-plugins-official #283 (2026-01-25), #17 (2025-12-16); claude-code #37714 (2026-03-23), #64654
    (2026-06-02) — <https://github.com/anthropics/claude-plugins-official/issues/283>.
96. Directory: claude-plugins-official #1272 (2026-04-07), #7024 (2026-11-06; ответ поддержки пересказан 2026-11-12) —
    <https://github.com/anthropics/claude-plugins-official/issues/7024>.
97. Issues отдельных плагинов в claude-plugins-official: #4235, #383, #3571, #319, #1816, #498, #1708, #6404, #4364,
    #85, #405, #5558, #6348, #4894 (с 2025-12-31 по 2026-10-09) —
    <https://github.com/anthropics/claude-plugins-official/issues>.
98. claude-code #13960 (2025-12-14), #79282 (2026-07-20), #63048 (2026-05-28) — встроенные команды и плагины —
    <https://github.com/anthropics/claude-code/issues/79282>.
99. claude-code #103626 (2026-10-20), #99130 (2026-10-03), #95157 (2026-09-17), #92031 (2026-09-04) — mods и
    синхронизированные плагины — <https://github.com/anthropics/claude-code/issues/99130>.
100. claude-code #87647 — автоматическое закрытие issues (2026-08-18) —
     <https://github.com/anthropics/claude-code/issues/87647>.
101. claude-code #6235 — поддержка AGENTS.md (открыт 2025-08-21, закрыт 2026-08-17) —
     <https://github.com/anthropics/claude-code/issues/6235>.
102. Ralph: claude-plugins-official #125 (2026-01-06); claude-code #12170 (2025-11-23), #16398 (2026-01-05), #39530
     (2026-03-26), #56096 (2026-05-04), #81825 и #81826 (2026-07-28), #87913 (2026-08-19), #23084 (2026-02-04), а
     также #16037 и #17257 — <https://github.com/anthropics/claude-code/issues/81825>.
103. Лимиты и auto-continue: claude-code #13354 (2025-12-08), #35744 (2026-03-18), #41502 (2026-03-31), #92004
     (2026-09-04), #100650 (2026-10-09), #103591 (2026-10-19), #104690 (2026-10-23), #81691 (2026-07-27) —
     <https://github.com/anthropics/claude-code/issues/13354>.
104. Channels: claude-code #36431, #36460, #37342, #37173, #36814 (с 2026-03-20 по 2026-03-22);
     claude-plugins-official #2229 (2026-06-03), #1396 (2026-04-13) —
     <https://github.com/anthropics/claude-code/issues/36431>.
105. Метка `area:plugins` в claude-code: 836 открытых issues из 2 493 —
     <https://github.com/anthropics/claude-code/issues?q=label%3Aarea%3Aplugins>, сортировка по реакциям —
     <https://github.com/anthropics/claude-code/issues?q=label%3Aarea%3Aplugins+sort%3Areactions-%2B1-desc>.

**Hacker News и блоги (вторичные источники)**

106. HN, «Customize Claude Code with plugins» — <https://news.ycombinator.com/item?id=45530150> — 2025-10-09.
107. HN, «Claude Skills» — <https://news.ycombinator.com/item?id=45607117> — 2025-10-16.
108. HN, «Superpowers» — <https://news.ycombinator.com/item?id=45547344> — 2025-10-11.
109. HN, «Superpowers 6» — <https://news.ycombinator.com/item?id=48739459> — середина 2026 (пост в блоге от
     2026-06-15).
110. HN, «Claude Code now reads AGENTS.md» — <https://news.ycombinator.com/item?id=49760187> — около 2026-09-19.
111. HN, «Build Plugins for Claude» — <https://news.ycombinator.com/item?id=49849384> — около 2026-09-26.
112. HN, публикации с claude.com, включая «Claude Code Mods» — <https://news.ycombinator.com/from?site=claude.com>,
     <https://news.ycombinator.com/item?id=49925102> — около 2026-10-02.
113. HN, «Claude 20x is now Ultra» — <https://news.ycombinator.com/item?id=50308320> — около 2026-10-31.
114. Simon Willison — <https://simonwillison.net/2026/Sep/18/thariq-shihipar/> — 2026-09-18.

**Другие вендоры: переносимость формата плагинов** (первичные источники; страницы без даты, прочитаны 2026-11-13)

115. GitHub Docs, справочник плагинов GitHub Copilot CLI —
     <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference>.
116. OpenAI, «Package your plugin» (Codex) — <https://developers.openai.com/codex/plugins/build>.
117. OpenAI, «Submit your Claude Code plugin to OpenAI» —
     <https://developers.openai.com/plugins/guides/submit-claude-plugin>.
118. Agent Plugins — <https://agent-plugins.org/>, список совместимых клиентов —
     <https://agent-plugins.org/compatible-clients>, спецификация — <https://github.com/agentplugins/agent-plugins-spec>
     (тег v1.0.0 от 2026-09-28; 1.1.0 — рабочий черновик).

**claude.com: портал разработчика и directory** (первичные источники; страницы без даты, прочитаны 2026-11-13)

119. «After publishing», раздел «Track published plugin usage» —
     <https://claude.com/docs/connectors/building/after-publishing#track-published-plugin-usage>.
120. «Publish to the directory» — <https://claude.com/docs/directory/publish>.
121. «Plugin pre-submission checklist» — <https://claude.com/docs/plugins/pre-submission-checklist>.

## Проверка фактов

Повторная независимая проверка, вечер 2026-11-13. Исправления первой проверки того же дня уже были в тексте; эта
проверка заново сверила с первоисточниками 20 утверждений, на которых может стоять продуктовое решение: функции,
механизмы из раздела «Механизмы, которые стоит изучить», числа, даты, цены, лицензии. Первоисточники — документация
code.claude.com и claude.com, CHANGELOG и npm registry, клоны `anthropics/claude-plugins-official` (коммиты
`f75f5b25` и `893173fb`) и `anthropics/claude-code` (коммит `715ff104`), GitHub API, страницы OpenAI и Agent Plugins.
Вторичный источник помечен. Итог: 11 утверждений подтверждены, 9 исправлены в тексте выше, неподтверждённых и
удалённых нет. Места, которые повторяют исправленное (хронология, «Слабые места», «Пересечение с worfy»), исправлены
тоже. Утверждения, уже помеченные в тексте «(не подтверждено)», в эту проверку не входили.

| Утверждение | Вердикт | Источник |
|---|---|---|
| Даты и версии: публичная beta плагинов вышла 2025-10-09 в 2.0.12; в changelog за сентябрь и октябрь 2026 около 330 строк о плагинах и marketplaces (точно 330 в версиях 2.1.257–2.1.316); последний релиз — 2.1.323 от 2026-11-12; версии флага `--marketplace` в заметках «расходятся» (исправлено: вечером 2026-11-13 вышел 2.1.325, а 2.1.324 есть только в npm; у `--marketplace` два входа — `/plugin install … --marketplace` в сессии с 2.1.275 и `claude plugin install … --marketplace` в shell с 2.1.292, расхождения нет) | исправлено | <https://claude.com/blog/claude-code-plugins> (2025-10-09); <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (2.0.12, 2.1.275, 2.1.292, 2.1.325); <https://registry.npmjs.org/@anthropic-ai/claude-code> (2.0.12 — 2025-10-09, 2.1.323 — 2026-11-12, 2.1.324 и 2.1.325 — 2026-11-13); <https://github.com/anthropics/claude-code/releases> (v2.1.325 — 2026-11-13); <https://code.claude.com/docs/en/plugins/publish> |
| Цены: Pro $17 при оплате за год или $20 помесячно; Max $100 (5× от Pro, $100 кредитов API); Ultra $200 (бывший Max 20x, у верифицированных аккаунтов нет 5-часового лимита, в неделю 10× от Pro, $200 кредитов API); Team $20/$25 за стандартное место и $100/$125 за premium; Enterprise $20 за место, от 20 мест, плюс расход по ценам API | подтверждено | <https://claude.com/pricing>; <https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan> (обновлено на неделе 2026-11-13) |
| Лицензии: Claude Code — закрытый код, все права у Anthropic, использование по Commercial Terms; каталоги official и community — Apache-2.0; 41 из 42 папок в `plugins/` — Apache-2.0; лицензия `claude-security` разрешает только внутреннее использование с продуктами Anthropic и запрещает использовать плагин для разработки продуктов не Anthropic (исправлено: она запрещает ещё передавать плагин третьим лицам и использовать его или любую его часть вместе с продуктами не Anthropic, а не только для их разработки) | исправлено | <https://github.com/anthropics/claude-code/blob/main/LICENSE.md>; <https://github.com/anthropics/claude-plugins-official/blob/main/plugins/claude-security/LICENSE> (v0.12.0); <https://github.com/anthropics/claude-plugins-official>; <https://github.com/anthropics/claude-plugins-community> |
| Числа каталогов и активности: официальный каталог — 316 записей (54 в репозитории, 163 по git URL, 98 через `git-subdir`, 1 через command, 261 закреплена на SHA), категории и авторы, рост 30 → 40 → 56 → 206 → 291 → 315; Claude Marketplace — 530 плагинов; каталог сообщества — 2 283 записи; установки frontend-design, superpowers и pr-review-toolkit; у метки `area:plugins` 836 открытых issues из 2 493 (всё верно на коммите `f75f5b25`; добавлено: на коммите `893173fb` вечером 2026-11-13 записей 317, мелкие категории перечислены; к вечеру у `area:plugins` 841 открытый issue из 2 499 — это рост за день, а не ошибка) | подтверждено | <https://github.com/anthropics/claude-plugins-official> (`marketplace.json` на `f75f5b25` и `893173fb`, GitHub API 2026-11-13); <https://claude.com/marketplace/plugins>; <https://claude.com/marketplace/plugins/frontend-design>, `/superpowers`, `/pr-review-toolkit`; <https://github.com/anthropics/claude-plugins-community>; <https://github.com/anthropics/claude-code/issues?q=label%3Aarea%3Aplugins> |
| Уровни marketplaces и путь публикации: 14 зарезервированных имён official; имена official и community принимаются только из `github.com/anthropics/`; с 2.1.280 поддельные зарезервированные имена отклоняются; directory — только с платного плана, в Team подаёт Owner, в Enterprise ещё участник с правом Directory; каждая версия проходит автоматическую проверку и security scan, новое размещение — проверку человеком; в официальный marketplace — только через партнёрскую команду; свой marketplace — без формы (исправлено: уровень community — ровно `claude-community`, `claude-plugins-community` и `healthcare`; каталог сообщества закрепляет на SHA не все записи, а почти все) | исправлено | <https://code.claude.com/docs/en/plugins/security>; <https://code.claude.com/docs/en/plugins/publish>; <https://claude.com/docs/directory/publish>; <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (2.1.280 — 2026-09-22 по npm) |
| Правило Verified: примерно с 2026-11-05 directory отклоняет command hooks, локальные MCP серверы и mods от организаций без статуса Verified; подать заявку на Verified нельзя; в публичной документации правила нет (подтверждено как сообщения пользователей; добавлены ещё категории отказов — `workflows/`, inline shell, установка по lockfile — и плагин Dep Steward; добавлено, что документация claude.com правило не называет: отдельной заявки на Verified нет, метку решают при проверке, локальный MCP сервер советуют класть в plugin bundle, а checklist оставляет такие случаи человеку на проверку, а не отклоняет их) | подтверждено | <https://github.com/anthropics/claude-plugins-official/issues/7024> (открыт 2026-11-06, ответ поддержки пересказан 2026-11-12) — вторичный источник: сообщения пользователей; <https://claude.com/docs/directory/publish>; <https://claude.com/docs/plugins/pre-submission-checklist>; <https://code.claude.com/docs/en/plugins/publish> |
| LSP плагины: 12 языков от Anthropic, работают только в терминале, в облачных сессиях — нет (исправлено: документация говорит, что они работают в терминальных сессиях, и описывает установку из VS Code и Desktop, запрета вне терминала в ней нет; не работают они в облачных сессиях, где language servers плагинов не запускаются; в таблице есть ещё Liquid — `liquid-lsp` от Shopify) | исправлено | <https://code.claude.com/docs/en/plugins/code-intelligence> |
| Переносимость: Agent Skills — открытый стандарт с 46 клиентами, его governance «принят» 2026-11-04 под LF Projects; Agent Plugins 1.0.0 (тег 2026-09-28), в TSC Amazon, Cursor, Microsoft, OpenAI и Vercel, Claude нет среди совместимых клиентов, документация Claude Code формат не упоминает; портал OpenAI переводит манифест плагина Claude Code, убирает hooks и превращает commands и agents в skills (исправлено: 2026-11-04 в репозиторий Agent Skills добавлен GOVERNANCE.md коммитом «AAIF Donation», и по нему проект только «будет оформлен» как серия LF Projects, LLC) | исправлено | <https://github.com/agentskills/agentskills> (GOVERNANCE.md, коммит 2026-11-04; docs/snippets/clients.jsx); <https://github.com/agentplugins/agent-plugins-spec> (тег v1.0.0 — 2026-09-28, MAINTAINERS); <https://github.com/agentplugins/agent-plugins-site> (`lib/compatible-clients.ts`); <https://code.claude.com/docs/llms.txt> (оглавление документации, упоминаний нет); <https://developers.openai.com/plugins/guides/submit-claude-plugin> |
| Механизм 1, Context cost: «Every turn» и «When invoked» в карточке `/plugin` только у официального marketplace, подсветка от 2 000 токенов, «Always-on» с разбивкой по компонентам в `claude plugin details`, доля плагина в `/usage` на Pro, Max, Ultra, Team и Enterprise, группа «Not used recently» после 14 дней и 10 сессий, совет `/doctor` выключить; появилось в 2.1.139 и 2.1.143 | подтверждено | <https://code.claude.com/docs/en/plugins/measure>; <https://code.claude.com/docs/en/plugins/install>; <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (2.1.139 — 2026-05-11, 2.1.143 — 2026-05-15 по npm) |
| Механизм 2, `claude plugin eval`: 3 запуска на случай в свежей сессии `-p` во временных HOME и рабочей папке, порог 1.0, сравнение с запуском без плагина (WITH, W/OUT, Δ), exit code для CI, `report.html` и JSON; оценки — только ориентир, если работали чужие hooks или настоящие MCP серверы; с 2.1.269 (исправлено: типов проверок не три, а шесть — `regex`, `tool_used`, `tool_order`, `file_exists`, `llm`, `baseline`; по умолчанию настоящие MCP серверы не запускаются и отвечают mock-файлы, настоящие стартуют только с `--allow-real-servers` или `--mocks off`; запуск, упёршийся в лимит, получает 0, и команда завершается с ненулевым exit code) | исправлено | <https://code.claude.com/docs/en/plugin-evals>; <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (2.1.269 — 2026-09-11 по npm) |
| Механизм 3, auto-continue: не больше 3 продолжений подряд, дальше `/rate-limit-options`; после сна компьютера дольше ~30 минут продолжение ждёт Enter; сброс дальше 24 часов сам не ждёт; в Remote Control и у участников agent team ожидание начинают вручную; ожидания нет в фоновых сессиях, в `-p`, при входе по ключу API, через облачных провайдеров моделей и при оплате по расходу; строкой `/config autoContinueAtUsageLimit=…` настройку можно только выключить; с 2.1.234 | подтверждено | <https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset>; <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (2.1.234 — 2026-08-17 по npm) |
| Механизм 4, workflows: `Date.now()`, `Math.random()` и `new Date()` без аргументов бросают ошибку; 16 агентов одновременно (от 1 до 256), 4 096 элементов на вызов, 1 000 агентов на запуск; зависший агент перезапускается до 5 раз; на лимите — не больше двух ожиданий; с 2.1.318 повторяются только упавшие агенты; предупреждение Large workflow при больше чем 25 агентах или 1.5M токенов; в `-p` запуск идёт без вопроса (исправлено: в `-p` и Agent SDK вопроса нет, но запуск проходит обычную проверку разрешений и стартует только при allow rule `Workflow`, режиме auto или bypass, `allow` от hook PreToolUse или одобрении хоста; на Pro workflows сначала включают в `/config`; при малом числе CPU предел ниже 16) | исправлено | <https://code.claude.com/docs/en/workflows>; <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (2.1.154, 2.1.271, 2.1.318) |
| Механизм 5, Mods API: `$.session.usage()` даёт `rateLimits` с процентом и временем сброса; `session.measure` приходит после каждого turn и при смене процента; `$.clock`, `$.prompt.submit`, `$.session.send`; слои prepend, user и append; `sec-default` при нечитаемой политике считает её действующей (fail closed); лимиты: 10 с на обработчик (50 мс для `prompt.edit`), `$.process.run` 30 с по умолчанию и до 10 мин, `$.http.fetch` 30 с и 4 MiB, `$.store` 4 MiB; с 2.1.321 `$.tool.call` и `$.mcp.call` идут без запроса разрешения, deny rules действуют | подтверждено | <https://code.claude.com/docs/en/plugins/mods/api>; <https://code.claude.com/docs/en/plugins/mods/reference>; <https://github.com/anthropics/claude-code/tree/main/mods> (`sec-default/README.md`); <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (2.1.287 — 2026-10-01, 2.1.321 — 2026-11-09 по npm) |
| Механизм 6, CI каталога: каждую ночь до 60 обновлений SHA, `claude plugin validate` на новом SHA, отдельный PR на запись; проверка моделью по prompt политики (учётные данные, hooks UserPromptSubmit, PreToolUse и PostToolUse без проверки проекта, скрытая телеметрия, описание не совпадает с поведением); кэш вердиктов на 30 дней по `name@sha` и хэшу политики; до 3 проходов отката; проверка MCP URL проваливает запись только на 404, 410 и сбоях соединения, DNS или TLS | подтверждено | <https://github.com/anthropics/claude-plugins-official/tree/main/.github> (workflows и `policy/prompt.md` на `f75f5b25`) |
| Механизм 7, `/code-review`: Haiku отсеивает PR; 4 параллельных reviewer (2 Sonnet по CLAUDE.md, 2 Opus по ошибкам); отдельный валидатор на каждую находку; неподтверждённые находки отбрасываются; публикация только с `--comment`; README описывает старый порог 80 (исправлено: шаг 5 команды прямо направляет на проверку только находки агентов 3 и 4 — Opus, поиск ошибок; Sonnet-валидаторы для CLAUDE.md он называет, но находки агентов 1 и 2 туда не направляет, а шаг 6 отбрасывает всё непроверенное) | исправлено | <https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-review/commands/code-review.md> (v1.0.1, коммит `893173fb`) |
| Механизм 8, claude-security: фаза Panel — три lens по одному голосующему агенту, итог считает код; патч пишется, только если панель подтверждает три свойства; `keep-waiting.sh` держит turn до 110 с; девять агентов; v0.12.0 (исправлено: три утверждения о патче проверяет не Panel, а отдельный агент `patch-verifier` в задаче «Suggest patches» — TARGETED, NO_NEW_VULNERABILITY, BEHAVIOUR_UNCHANGED; Panel решает судьбу находок: находка остаётся, только если ответили все три агента и хотя бы двое сказали TRUE_POSITIVE; lens — REACHABILITY, IMPACT, DEFENSES; sleep от 1 до 110 с, по умолчанию 30) | исправлено | <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-security> (`workflows/scan.js`, `agents/patch-verifier.md`, README, `scripts/keep-waiting.sh`, LICENSE; коммит `893173fb`) |
| Механизм 9, Stop hook: `{"decision":"block"}` даёт ещё один turn; флаг `stop_hook_active`; предел 8 продолжений подряд со сбросом при вызове tool (меняется переменной `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`); `background_tasks` и `session_crons` во входе; `asyncRewake` будит Claude по exit code 2; ralph-loop v1.0.1 проверяет `session_id` и пишет состояние через временный файл и `mv` | подтверждено | <https://code.claude.com/docs/en/hooks>; <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop> (`hooks/stop-hook.sh`) |
| Механизм 10, установка без выполнения кода плагина: зависимости Node.js только по lockfile (`bun.lock`, `npm-shrinkwrap.json`, `package-lock.json`), только пакеты из registry с точными версиями, `--ignore-scripts`, отдельная папка без `.npmrc` и `.env`, таймаут 60 с; старая версия получает `.orphaned_at` и удаляется через 14 дней; `${CLAUDE_PLUGIN_DATA}` переживает обновления; seed-папки `CLAUDE_CODE_PLUGIN_CACHE_DIR` и `CLAUDE_CODE_PLUGIN_SEED_DIR` | подтверждено | <https://code.claude.com/docs/en/plugins/loading>; <https://code.claude.com/docs/en/plugins/org> |
| Механизм 11, подсказки плагинов: блоки `relevance` сопоставляются локально, ничего не ставят сами и работают только для marketplace из allowlist; CLI hints — строка `<claude-code-hint …/>` в stderr при `CLAUDECODE`, только для marketplaces уровня official; диалог LSP не чаще раза за сессию, сам закрывается через 30 с и выключается после пяти пропущенных, «No, not now» не считается (добавлены пределы CLI hints: одно предложение за сессию, одно на плагин за всё время, ни одного после 100 плагинов на машине) | подтверждено | <https://code.claude.com/docs/en/plugins/relevance>; <https://code.claude.com/docs/en/plugins/cli-hints>; <https://code.claude.com/docs/en/plugins/code-intelligence> |
| Механизм 12, проверки worktree-сессий: запрет правок в основном checkout, запрет команд с рабочей папкой в нём, запрет git-перенаправлений (`-C`, `--git-dir`, `GIT_DIR`, `GIT_WORK_TREE`, `cd`), запрет команд, которые Claude Code не может разобрать; `cp` и перенаправления shell не отслеживаются; worktree без изменений удаляется сразу, остальные — по `cleanupPeriodDays`; ветка берётся от ветки по умолчанию, а не от HEAD | подтверждено | <https://code.claude.com/docs/en/worktrees>; <https://code.claude.com/docs/en/sub-agents> |
