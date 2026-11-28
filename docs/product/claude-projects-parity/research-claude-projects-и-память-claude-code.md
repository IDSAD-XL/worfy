# Claude Projects и память Claude Code: проверка фактов из PR #2270

- **Дата:** 2026-11-28. Все страницы ниже прочитаны 2026-11-28.
- **Вопрос:** верны ли конкурентная база и факты о памяти в PR #2270 — предложении о паритете worfy с Claude Projects
  и о встроенной памяти Claude (файл `docs/claude-projects-parity-proposal.md` на ветке
  `docs/claude-projects-parity-native-memory`, не влит). Проверка — только по первичным страницам Anthropic.
- **Тема** `claude-projects-parity`, карта — [map.md](map.md).
- **Статус:** исследование, не решение.
- **Как проверено.** Страницы `code.claude.com/docs` скачаны как Markdown: у каждой есть вариант с `.md` на конце.
  Цитаты сверены с этим текстом. Ссылки ниже даны на канонический адрес без `.md`, все отвечают HTTP 200. Даты версий
  взяты со страницы https://code.claude.com/docs/en/changelog: она «generated from the CHANGELOG.md on GitHub», а в
  самом файле на GitHub дат нет. Блог и help center скачаны как HTML. Для поиска слова по всем страницам docs Claude
  Code использован общий дамп https://code.claude.com/docs/llms-full.txt. Код worfy не читался. Опытов с CLI и SDK не
  было.
- **Redirect-ы и 404.** https://claude.com/blog/projects-redesigned отвечает 308 на
  https://claude.com/resources/articles/projects-redesigned. https://docs.claude.com/llms.txt отвечает 301 на
  https://platform.claude.com/llms.txt. Ответов 404 не было.
- **Метки в разделе 2:** «задокументировано» (documented), «частично» (partially), «не найдено» (not found).

## 1. Страница Claude Projects: есть ли она и что это

- Страница есть, HTTP 200. Заголовок — «Let Claude coordinate ongoing work with Projects». Описание: «Hand Claude a
  stream of related tasks in one conversation and let it run them as parallel cloud sessions that share repositories,
  instructions, and memory.» — https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Поверхности: «You create and use projects at claude.ai/code, in the Code tab of the desktop app, or in the Claude
  mobile app for iOS and Android.» — https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Где Projects нет: «not in the terminal CLI, the VS Code extension, or the JetBrains plugin, and not through Amazon
  Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry.» Agent SDK на странице не упомянут. —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Модель — только от Anthropic: thread-ы работают «with Anthropic as the model provider in both cases». —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Тарифы: «Projects are in public beta on Pro, Max, and Ultra plans and rolling out gradually.» И ещё: «Projects aren't
  offered on Team or Enterprise plans yet.» — https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Кому выдают первым: «The rollout started with accounts that have used cloud sessions and don't have existing
  projects in claude.ai chat or Cowork.» — https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Для работы с кодом нужен GitHub: «your code is on github.com rather than GitHub Enterprise Server, GitLab, or
  Bitbucket, your connected GitHub account has push access to it, and the Claude GitHub App is installed on it.» —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Дата запуска на странице docs не указана. Страница ссылается на статью блога как на «the launch announcement». —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- У статьи блога дата «September 17, 2026», в метаданных `article:published_time` — `2026-09-17`. Цитата: «Starting
  today, updated projects are available in beta to select Claude Pro and Max subscribers who use cloud sessions in
  Claude Code and don’t have any existing projects on the web or desktop.» —
  https://claude.com/resources/articles/projects-redesigned (redirect с https://claude.com/blog/projects-redesigned),
  2026-11-28.
- В день запуска thread-ы шли только в облаке: «Threads run in the cloud today; running on your machine alongside your
  local tools and code and behind your network is coming very soon.» —
  https://claude.com/resources/articles/projects-redesigned, 2026-11-28.
- Прежние Projects в claude.ai chat и Cowork — другая функция: «the earlier Projects experience, which groups
  conversations and reference files without threads or a coordinator.» —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28. Help center: «We've started moving existing projects for
  some Pro, Max, and Ultra users to the new version.» — https://support.claude.com/en/articles/9517075-what-are-projects,
  2026-11-28.

Возможности по странице docs.

Источник всех строк этого списка: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Project conversation — координатор: «one long-running session where Claude acts as coordinator».
- Threads — исполнители: «Each is a separate session with its own context window».
- Overview pane: вкладка Threads с группами по состоянию, вкладка Context с файлами, вид Scheduled tasks. Цитата: «Open
  the project's files and scheduled tasks in the pane».
- Постоянный контекст: Project memory, Project instructions «up to 16,000 characters», репозитории, файлы и cloud
  environment.
- Предложения до запуска: Claude показывает thread-ы «in a Suggested threads list».
- Перенос работы в проект: «choose Continue in project».
- Сопровождение PR: thread «watches the pull request with auto-fix turned on».
- Thread на своём компьютере: он «connected through Remote Control».
- Модели раздельно: «Coordinator sets the model for Claude in the project conversation.»
- Notifications в Desktop: «a notification appears by default when Claude posts in the conversation».
- Расход и лимиты: Usage по thread-ам, продолжение после сброса лимита, «500 new threads per day across your projects».
- Управление проектом: Restart Claude («Restarts the project conversation»), Pause, Archive, Delete.
- Ограничения: «A project belongs to one user.» И: «You can't merge two projects into one.»

## 2. Таблица паритета из PR: что из неё есть в Claude Projects

### a) Постоянный координатор, параллельные изолированные thread-ы, прямой доступ к каждому

Источник, если не указан другой: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Постоянный координатор — задокументировано. Project conversation — это «one long-running session where Claude acts
  as coordinator». Он видит отчёты, а не шаги: «It sees what threads report back, not every step they take.» Долго живёт
  так: «the conversation works from recent messages, recent threads, and project memory rather than its full history, so
  it keeps going for as long as the project runs.»
- Параллельные изолированные thread-ы — задокументировано. «Threads run in parallel». Каждый thread — «a separate
  session with its own context window». Cloud thread «works on its own branch and opens a pull request when the work
  calls for one».
- Прямой доступ — задокументировано: «Steer the task by writing in the thread's own message box. A message there goes
  straight to that thread». Там же отвечают на permission prompt и останавливают thread: «Interrupt the thread with
  Stop».

### b) Маршрутизация follow-up, ответы, отчёты о ходе работы, группы по состоянию

Источник, если не указан другой: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Маршрутизация — задокументировано: «New work goes to a new thread or to a thread already working in that area, and
  Claude tells you which.» И: «Several unrelated tasks in one message become separate threads.» Follow-up из общего
  разговора доходит до thread-а, только если Claude его сопоставил: «a follow-up in the project conversation reaches it
  only when Claude matches the follow-up to that thread.»
- Ответы — частично. Ответить конкретному thread-у можно в его собственном поле ввода: «A message there goes straight to
  that thread». Ответа на конкретное сообщение или упоминания thread-а через `@` в project conversation страница не
  описывает. Поиск по словам «reply» и «mention» нашёл только строки о другом.
- Отчёты о ходе работы — задокументировано. Thread «reports back to the conversation when it finishes». Частоту задают
  словами: «Tell Claude in the conversation how many threads to run at once, when to post updates, and when to open
  pull requests.» Каждый шаг не публикуется: «Claude doesn't post each step a thread takes». В Desktop: «a notification
  appears by default when Claude posts in the conversation, a thread hits an error, or a thread needs your input.»
- Группы по состоянию — задокументировано: «The pane's Threads tab groups threads by state». Группы: Ready for review,
  Waiting on you, Working, Landing, Idle, Resolved.

### c) Несколько репозиториев, инструкции, общий контекст проекта

Источник: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Несколько репозиториев — задокументировано: «One goal across many repositories». Там же: «Claude can run a thread per
  repository, each with its own pull request». Thread может добавить репозиторий только себе: «a cloud thread can add
  one to itself when its task needs it.» Ограничение: «Claude can only add repositories from a GitHub owner the project
  already uses».
- Инструкции — задокументировано. Project instructions — это «Text sent to each new thread and to Claude in the project
  conversation, up to 16,000 characters.»
- Общий контекст — задокументировано: «Project memory, project instructions, and the project's repositories, files, and
  environment carry context across threads.» CLAUDE.md, `.claude/CLAUDE.md` и `.claude/rules/` репозитория — «Loaded
  from every repository when the thread starts».
- Изменения доходят только до новых thread-ов: «Changes to instructions, repositories, and environment in Project
  settings reach new threads, not threads already running.»

### d) Библиотека проекта, вложения, созданные артефакты

Источник, если не указан другой: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Библиотека — задокументировано. В docs это вкладка Context: «the files and folders you added and the files that
  threads produced.» Блог называет её library: «projects now include a library that collects the files you add and the
  artifacts produced by Claude.» — https://claude.com/resources/articles/projects-redesigned, 2026-11-28. Help center:
  «the project's Library collects the files you add and the files Claude produces.» —
  https://support.claude.com/en/articles/9517075-what-are-projects, 2026-11-28.
- Вложения — задокументировано, с лимитами: «up to 1,000 files and 2 GB at a time, with a single file up to 480 MB.» И:
  «A project holds up to 10 folders and Google Drive folders combined». Загрузка — копия: «uploads are copies».
- Созданные артефакты — задокументировано: thread-ы «deliver each write-up as a file in the project's Context tab».
  Поиска, предпросмотра и версий файлов страница не описывает.

### e) Локальное и облачное выполнение, доступ с телефона

Источник, если не указан другой: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Облако — задокументировано: «Each thread is usually a cloud session». И: «Cloud threads keep going after you close
  your laptop».
- Свой компьютер — задокументировано. Можно попросить Claude «run the thread for that task on your computer instead of
  in the cloud». Связь идёт через Remote Control. Нужна «Claude Code v2.1.280 or later on that computer». Thread
  работает, пока компьютер не спит: «Runs only while that computer is awake with Remote Control turned on». Такой
  thread берёт настройки этой машины, «including its hooks and permission rules».
- Телефон — задокументировано: «you can check on them and steer them from your phone». Страница mobile: «From your
  phone you reach cloud sessions and projects in the cloud». — https://code.claude.com/docs/en/mobile, 2026-11-28.

### f) Environment и secrets, MCP, Skills, Plugins, модель для каждого агента

Источник: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Environment и secrets — задокументировано. Cloud environment «sets its network access, environment variables, network
  secrets, and installed tools». Блок `env` из `.claude/settings.json` репозитория — «Not applied».
- MCP — задокументировано, но только через connectors claude.ai: «cloud threads get their MCP tools from the connectors
  on your claude.ai account». Файл `.mcp.json` репозитория — «Not loaded». У координатора connectors нет: «The project
  conversation itself has no connectors».
- Skills — задокументировано: «Skills: enable them for your claude.ai account, and cloud threads load the skills you
  enable there». Skills, agents и commands из `.claude/` репозитория тоже грузятся: «Loaded from every repository,
  except in threads that skip them».
- Plugins — задокументировано: «enable them for your claude.ai account at claude.ai/customize/plugins, and the cloud
  threads that Claude starts load them.»
- Модель для агента — задокументировано. «Coordinator sets the model for Claude in the project conversation.» «Threads
  sets the model and effort for new threads.» Для одной задачи: «ask for it in the task; for a thread already running,
  use that thread's model picker.» По умолчанию: «A new project runs Opus everywhere, with medium effort for threads and
  low effort for the conversation».
- Hooks и permission rules из `.claude/settings.json` репозитория в cloud thread-ах не работают: «Not run» и «Not
  applied». Общее правило: «Cloud threads don't pick up anything from the Claude Code setup on your own machine.»

### g) Восстановление после лимитов, параллельность, просмотр расхода

Источник: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Лимиты — задокументировано. Setting «Continue threads automatically when usage limits reset» в разделе General:
  «Whether a thread or the project conversation that stops at a usage limit continues on its own when the limit resets.
  On by default.»
- Параллельность — задокументировано: «There's no fixed number; Claude starts as many as the work calls for, and a limit
  you ask for is a preference rather than a cap. The enforced limit is 500 new threads per day across your projects.»
- Расход — задокументировано: «Open Usage in Project settings to see token use by thread and how much went to the
  project conversation.»

### h) Сопровождение PR, починка CI, review, архив

Источник: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Сопровождение PR — задокументировано: thread «watches the pull request with auto-fix turned on, whether or not
  auto-fix is on for your other cloud sessions.»
- Починка CI — задокументировано: «It pushes fixes when CI fails, addresses review comments, and replies in the thread
  when checks pass and the pull request is ready for you.»
- Review — частично. Thread отвечает на review comments: «addresses review comments». PR, которые ждут человека, лежат в
  группе Ready for review. Review чужого PR силами Claude страница Projects не описывает.
- Архив — задокументировано: «Archive: hides the project from the sidebar and archives its threads, which stops any
  thread that was running or watching a pull request.» Отдельный thread закрывают так: «Threads marked done: by you from
  the thread's menu».

### i) Работа по расписанию, пауза проекта, предложенные задачи, импорт проекта

Источник, если не указан другой: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- Расписание — задокументировано: «when you ask for scheduled work in a project, Claude creates a cloud scheduled task
  that runs as threads in that project and appears in its Scheduled tasks view.»
- Пауза — задокументировано: «Pause: stops everything at once. Every running thread and the conversation are
  interrupted, no new threads start, scheduled tasks don't run, and the project doesn't accept messages until you resume
  it.»
- Предложенные задачи — задокументировано: «Sometimes Claude proposes threads instead of starting them, in a Suggested
  threads list.» На первом проекте Claude сам предлагает «repositories to add, scheduled tasks to create, and threads it
  could start».
- Импорт проекта — частично. Работу одной cloud session можно перенести: «choose Continue in project, then Continue as
  new project». Обратного пути нет: «You can't move or copy a thread to another project, or move it out to stand
  alone.» Слить проекты нельзя: «You can't merge two projects into one.» Старые проекты claude.ai Anthropic переносит
  сам: «We've started moving existing projects for some Pro, Max, and Ultra users to the new version.» —
  https://support.claude.com/en/articles/9517075-what-are-projects, 2026-11-28. Импорта из другого инструмента не
  найдено.

### j) /btw, /fork, snooze, resolve/reopen, sharing

Источник, если не указан другой: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- `/btw` — не найдено для Projects: на странице Projects его нет. В Claude Code команда есть: «Ask a side question about
  the current session without adding to the conversation.» — https://code.claude.com/docs/en/commands, 2026-11-28. Side
  chat в Desktop ограничен: «Side chats are available in local, SSH, and WSL sessions.» —
  https://code.claude.com/docs/en/desktop, 2026-11-28. Про cloud session и thread проекта не сказано.
- `/fork` — не найдено для Projects. В Claude Code `/fork` делает «Copy the current conversation into a new background
  session and keep working here», а `/branch` — «Create a branch of the current conversation at this point». —
  https://code.claude.com/docs/en/commands, 2026-11-28. Remote Control session можно форкнуть на claude.ai/code: «select
  Fork in the session's menu, or fork from an earlier message in the transcript». Для этого нужна «Claude Code v2.1.277
  or later on your machine». — https://code.claude.com/docs/en/remote-control, 2026-11-28.
- Snooze — не найдено. Слова «snooze» нет ни на одной странице docs Claude Code: 0 совпадений в
  https://code.claude.com/docs/llms-full.txt, 2026-11-28.
- Resolve/reopen — задокументировано. Группа Resolved: «Threads marked done: by you from the thread's menu, by Claude
  once you've taken the last step, such as merging its pull request, or automatically after a week with no activity. You
  can reopen one from the same menu».
- Sharing — задокументировано, что его нет: «A project belongs to one user. You can't share a project with another user.
  There are no organization-level controls for projects during the beta.» Отдельную cloud session или Remote Control
  session можно показать по ссылке только для чтения: «You can share a cloud session or a Remote Control session with a
  link so that other people can read the conversation.» — https://code.claude.com/docs/en/share-sessions, 2026-11-28.
  Работает ли это для thread-а проекта, не сказано.

## 3. Auto memory Claude Code

### 3.1 Где хранится и как называется папка проекта

- Путь: «Each project gets its own memory directory at `~/.claude/projects/<project>/memory/`.» —
  https://code.claude.com/docs/en/memory, 2026-11-28.
- Имя папки берётся от git-репозитория, а не от cwd: «The `<project>` path is derived from the git repository, so all
  worktrees and subdirectories within the same repo share one auto memory directory. Outside a git repo, the project
  root is used instead.» — https://code.claude.com/docs/en/memory, 2026-11-28.
- Worktrees одного репозитория делят одну папку. В таблице сравнения scope памяти — «Per repository, shared across
  worktrees». — https://code.claude.com/docs/en/memory, 2026-11-28. Так с 2.1.63 (February 28, 2026): «Project configs &
  auto memory now shared across git worktrees of the same repository». — https://code.claude.com/docs/en/changelog,
  2026-11-28.
- Разные клоны одного репозитория получают разные папки. Адрес памяти «named for the repository's path on disk, so it
  differs across users, machines, and checkouts.» —
  https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts, 2026-11-28.
- Та же мысль другими словами: «Each project gets its own memory directory keyed by the repository path.» —
  https://code.claude.com/docs/en/claude-directory, 2026-11-28.
- Правило кодирования пути в имя папки описано только для transcript-ов, и там берётся cwd: «`<project>` is your working
  directory path with non-alphanumeric characters replaced by `-`». Длинное имя обрезается до 200 символов, к нему
  добавляется hash полного пути. — https://code.claude.com/docs/en/sessions, 2026-11-28.
- Память не покидает машину: «Auto memory is machine-local. All worktrees and subdirectories within the same git
  repository share one auto memory directory. Files are not shared across machines or cloud environments.» —
  https://code.claude.com/docs/en/memory, 2026-11-28.
- Автоочистка старых transcript-ов память не трогает: «`MEMORY.md` and topic files stay until you or Claude edits or
  deletes them.» — https://code.claude.com/docs/en/memory, 2026-11-28.

### 3.2 Что грузится в начале session и что читается по требованию

Источник: https://code.claude.com/docs/en/memory, 2026-11-28.

- Устройство папки: «The directory contains a `MEMORY.md` index and one topic file per memory».
- В начале session: «While auto memory is on, the first 200 lines or 25KB of `MEMORY.md`, whichever comes first, load
  at session start.»
- По требованию: «Claude Code doesn't load topic files such as `user_role.md` or `feedback_testing.md` at startup.
  Claude reads them on demand using its standard file tools when it needs the information.»
- Если индекс длиннее лимита: «the write still succeeds, but Claude Code returns an error telling Claude to rewrite the
  index, because everything past the limit is dropped on the next load.»
- Лимит касается только индекса: «This limit applies only to `MEMORY.md`.» Файл CLAUDE.md грузится целиком, «as long as
  the file is 4 MiB or smaller».
- Следы в интерфейсе: «When you see messages like "Saved 2 memories" or "Recalled 2 memories" in the Claude Code
  interface, Claude is actively updating or reading from `~/.claude/projects/<project>/memory/`.»
- Метка свежести: «Claude Code records the write time in a `modified` frontmatter field as an ISO 8601 timestamp.»

### 3.3 Категории user, feedback, project, reference

Источник: https://code.claude.com/docs/en/memory, 2026-11-28.

- Категории записаны в docs, а не только в system prompt: «Claude records the kind as a `type` field in the memory
  file's frontmatter».
- `user`: «your role, expertise, and working preferences».
- `feedback`: «corrections you give Claude and approaches you confirm».
- `project`: «ongoing work, deadlines, and decisions that Claude can't derive from the code or git history».
- `reference`: «where to find information outside the project, such as an issue tracker or dashboard».
- Что не сохраняется: «Claude skips anything it can derive from the codebase, such as architecture, file paths, or
  debugging fixes. It also skips anything your CLAUDE.md files already say.»

### 3.4 Setting-и и env

- `autoMemoryEnabled` — есть. «When `false`, Claude doesn't read from or write to the auto memory directory.» Default —
  `true`, scope — «Any file». Env сильнее setting-а: «`CLAUDE_CODE_DISABLE_AUTO_MEMORY` takes precedence over this key for
  one session, in either direction». Память выключают и другие вещи: «such as `--bare`, safe mode, or
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY`». — https://code.claude.com/docs/en/settings-reference, 2026-11-28. Версия появления
  в docs не указана. В changelog имени нет.
- По умолчанию память включена: «Auto memory is on by default in local sessions.» В self-hosted environment она
  выключена, кроме Claude Tag: «a session in a self-hosted environment runs with auto memory off by default». В
  background session и в session, которую запустил сам Claude Code, её можно только выключить: «The toggle turns auto
  memory off but doesn't turn it back on in these sessions». —
  https://code.claude.com/docs/en/memory, 2026-11-28.
- `autoMemoryDirectory` — есть. «Store auto memory in a directory of your choice instead of the per-project default.»
  Значение — абсолютный путь или путь с `~/`. Из project и local settings ключ работает только в доверенной папке: «Claude
  Code honors this key under the same workspace trust rule as hooks». — https://code.claude.com/docs/en/settings-reference,
  2026-11-28. Появился в 2.1.74 (March 12, 2026): «Added `autoMemoryDirectory` setting to configure a custom directory for
  auto-memory storage». — https://code.claude.com/docs/en/changelog, 2026-11-28.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY` — есть. «Set to `1` to disable auto memory. Set to `0` to force auto memory on even
  when `--bare` mode or `autoMemoryEnabled: false` would otherwise disable it.» —
  https://code.claude.com/docs/en/env-vars, 2026-11-28. Версия появления не указана. В changelog имени нет.
- `CLAUDE_CODE_PROJECT_DIR_NAME` — есть. Он задаёт имя папки в `projects/` «in place of one derived from the working
  directory path», и для transcript-ов, и для auto memory. Работает только с `CLAUDE_CONFIG_DIR` и только из окружения
  запуска: «Claude Code ignores this variable when `CLAUDE_CONFIG_DIR` is unset, and reads it only from the environment
  you start `claude` from, never from a settings file `env` block.» Версия: «Requires Claude Code v2.1.234 or later». —
  https://code.claude.com/docs/en/env-vars, 2026-11-28. Допустимые значения: «Use 1-64 letters, digits, hyphens, or
  underscores». — https://code.claude.com/docs/en/sessions, 2026-11-28. В changelog — 2.1.234 (August 17, 2026): «Added
  the optional `CLAUDE_CODE_PROJECT_DIR_NAME` environment variable». — https://code.claude.com/docs/en/changelog,
  2026-11-28.
- `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` убирает и файлы auto memory: «prevent loading any CLAUDE.md memory files into
  context, including user, project, and auto memory files». — https://code.claude.com/docs/en/env-vars, 2026-11-28.

### 3.5 Память subagent-ов

- Есть поле `memory` во frontmatter: «The `memory` field gives the subagent a persistent directory that survives across
  conversations.» — https://code.claude.com/docs/en/sub-agents, 2026-11-28.
- Три scope: `user` — `~/.claude/agent-memory/<name-of-agent>/`, `project` — `.claude/agent-memory/<name-of-agent>/`,
  `local` — `.claude/agent-memory-local/<name-of-agent>/`. Рекомендация: «`project` is the recommended default scope.» —
  https://code.claude.com/docs/en/sub-agents, 2026-11-28.
- Что получает subagent: в его system prompt попадают «the first 200 lines or 25KB of `MEMORY.md` in the memory
  directory». И ещё: «Read, Write, and Edit tools are automatically enabled so the subagent can manage its memory
  files.» — https://code.claude.com/docs/en/sub-agents, 2026-11-28.
- Поле зависит от auto memory: «if you turn auto memory off, with the `autoMemoryEnabled` setting or
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, the `memory` field has no effect». — https://code.claude.com/docs/en/sub-agents,
  2026-11-28.
- Память главного разговора в subagent не попадает: «The main conversation's auto memory isn't loaded into subagents;
  the exception is a fork, which inherits the parent conversation and system prompt.» —
  https://code.claude.com/docs/en/memory, 2026-11-28.
- Появилось в 2.1.33 (February 6, 2026): «Added `memory` frontmatter field support for agents, enabling persistent
  memory with `user`, `project`, or `local` scope». — https://code.claude.com/docs/en/changelog, 2026-11-28.

### 3.6 Параллельные записи, размеры, приоритет перед CLAUDE.md

- Параллельные записи в docs не описаны. На странице memory нет слов «concurrent», «same time», «lock» в связи с
  памятью. — https://code.claude.com/docs/en/memory, 2026-11-28. В changelog есть два fix-а. 2.1.77 (March 17, 2026):
  «Fixed `--resume` silently truncating recent conversation history due to a race between memory-extraction writes and
  the main transcript». 2.1.280 (September 22, 2026): «Fixed memory write conflicts in Cowork sessions showing Claude
  only the start and end of a memory file over about 10,800 characters, so the retried write dropped the middle». —
  https://code.claude.com/docs/en/changelog, 2026-11-28.
- Размеры: описан только лимит индекса, «the first 200 lines or 25KB». Лимита на размер topic file не найдено. —
  https://code.claude.com/docs/en/memory, 2026-11-28.
- Правила приоритета памяти перед CLAUDE.md нет. Есть общее: «Claude treats CLAUDE.md files and auto memory as context.
  They aren't enforced configuration.» — https://code.claude.com/docs/en/memory, 2026-11-28.
- Каналы у них разные. CLAUDE.md «is delivered as a user message after the system prompt». —
  https://code.claude.com/docs/en/memory, 2026-11-28. Auto memory — «Loaded into the system prompt at session start». —
  https://code.claude.com/docs/en/agent-sdk/claude-code-features, 2026-11-28. Перед CLAUDE.md Claude Code ставит строку о
  приоритете: «Claude Code introduces your CLAUDE.md files with a line telling Claude that the instructions override
  default behavior.» — https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts, 2026-11-28.

### 3.7 Защита памяти

- С 2.1.284 (September 28, 2026) подделка разметки в памяти обезвреживается: «invisible characters and tags that imitate
  Claude Code's own markup are neutralized in `MEMORY.md` and recalled memory notes before they reach Claude». —
  https://code.claude.com/docs/en/changelog, 2026-11-28.
- Папку, которую выбрали repository settings, Claude Code не использует при `permissions.blockReadsOutsideWorkingDirectories`:
  «Claude Code loads no auto memory from that directory and saves none to it.» —
  https://code.claude.com/docs/en/settings-reference, 2026-11-28.
- При `permissions.blockWritesOutsideWorkingDirectories` память проекта остаётся доступной для записи: «`.md` files in
  this project's auto memory». — https://code.claude.com/docs/en/settings-reference, 2026-11-28.

## 4. Agent SDK

### 4.1 Что грузит settingSources

Источник, если не указан другой: https://code.claude.com/docs/en/agent-sdk/claude-code-features, 2026-11-28.

- Default — все три источника: «Omitting `settingSources` is equivalent to `["user", "project", "local"]`.» В TypeScript
  reference default записан как «CLI defaults (all sources)». — https://code.claude.com/docs/en/agent-sdk/typescript,
  2026-11-28. В v0.1.0 default ненадолго был пустым: «This default was briefly changed in v0.1.0 to load no filesystem
  settings and then reverted». — https://code.claude.com/docs/en/agent-sdk/migration-guide, 2026-11-28.
- `"project"`: «Project `settings.json` and hooks; project CLAUDE.md and `.claude/rules/*.md`; project skills, commands,
  and subagents».
- `"user"`: «User `settings.json`; user CLAUDE.md and `~/.claude/rules/*.md`; user skills, commands, and subagents».
- `"local"`: «CLAUDE.local.md, `.claude/settings.local.json`».
- `settingSources: []` — «limits the agent to what you configure programmatically».
- Читается при любом `settingSources`: managed policy settings, `~/.claude.json`, auto memory, claude.ai MCP connectors и
  записи `sandbox.credentials`. Заголовок этой таблицы — «What settingSources does not control».
- Output styles грузятся с `'user'` или `'project'`: «Output styles are loaded when you include `settingSources:
  ['user']` or `settingSources: ['project']`». — https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts,
  2026-11-28.

### 4.2 Что меняет systemPrompt

Источник, если не указан другой: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts, 2026-11-28.

- Без `systemPrompt` — минимальный prompt: «the SDK uses a minimal prompt that covers tool calling but omits the rest of
  the `claude_code` preset's content, including its security and safety instructions.» В TypeScript reference default —
  «`undefined` (minimal prompt)». — https://code.claude.com/docs/en/agent-sdk/typescript, 2026-11-28.
- Preset `claude_code` — «the system prompt that the Claude Code CLI uses». К нему можно добавить `append`.
- Своя строка: «The SDK sends only what you provide.»
- CLAUDE.md работает при любом варианте: «The SDK injects their content into the conversation and leaves the system
  prompt untouched, so they work with any system prompt configuration.»
- Preset кладёт адрес auto memory в system prompt: «The preset embeds that location in the system prompt ahead of your
  `append` text.» Опция `excludeDynamicSections: true` переносит этот текст в первое сообщение пользователя: «That text
  is at least the auto memory directory's location, and often the whole auto memory section.» Нужен
  `@anthropic-ai/claude-agent-sdk` v0.2.98 или новее.
- Грузится ли auto memory без `systemPrompt` и со своей строкой, docs не говорят.

### 4.3 Auto memory в SDK

- Память работает даже при `settingSources: []`. Строка таблицы «What settingSources does not control»: «Auto memory at
  `~/.claude/projects/<project>/memory/` | Loaded into the system prompt at session start.» —
  https://code.claude.com/docs/en/agent-sdk/claude-code-features, 2026-11-28.
- Пишет обычными tool-ами: «The agent writes new memories there with the standard `Write` and `Edit` tools rather than
  a dedicated memory tool, so those tools must be enabled for the agent to save memories». —
  https://code.claude.com/docs/en/agent-sdk/claude-code-features, 2026-11-28.
- Выключение: «Set `autoMemoryEnabled: false` in settings, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `env`». —
  https://code.claude.com/docs/en/agent-sdk/claude-code-features, 2026-11-28.
- Предупреждение для нескольких клиентов на одной машине: «For multi-tenant deployments, run each tenant in its own
  filesystem and set `settingSources: []` plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `env`.» —
  https://code.claude.com/docs/en/agent-sdk/claude-code-features, 2026-11-28.
- Опция `env` заменяет окружение целиком: «When set, this replaces the subprocess environment instead of merging with
  `process.env`». Опция `settings` «Populates the flag-settings layer». —
  https://code.claude.com/docs/en/agent-sdk/typescript, 2026-11-28. Ключ `autoMemoryDirectory` читается и из
  `--settings`: «user, project, local, policy, or `--settings`». — https://code.claude.com/docs/en/memory, 2026-11-28.
- Обзор SDK: «Skills, commands, and memory | Load automatically from your project's `.claude/` and from `~/.claude/`,
  same as Claude Code». — https://code.claude.com/docs/en/agent-sdk/overview, 2026-11-28.

### 4.4 Опции, сообщения и hook-и для памяти

- Опция памяти есть только у subagent-а: `AgentDefinition.memory?: "user" | "project" | "local"`, описание — «Memory
  source for this agent». Отдельной опции памяти в `Options` нет. — https://code.claude.com/docs/en/agent-sdk/typescript,
  2026-11-28.
- Сообщение: тип `SDKMemoryRecallMessage` есть в union `SDKMessage`, но описания его полей на странице нет. —
  https://code.claude.com/docs/en/agent-sdk/typescript, 2026-11-28. Changelog TypeScript SDK, версия 0.2.105: «Added
  `system/memory_recall` event and `memory_paths` on `system/init` for SDK renderers to surface memory operations». —
  https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md (на него ссылается страница обзора
  SDK), 2026-11-28. Поля `memory_paths` в TypeScript reference нет. Сообщения о записи памяти не найдено.
- Hook-а для памяти нет. В списке `HookEvent` нет события памяти. `InstructionsLoaded` срабатывает, когда грузится «a
  `CLAUDE.md` or `.claude/rules/*.md` file»; про `MEMORY.md` там не сказано. — https://code.claude.com/docs/en/hooks,
  2026-11-28.
- На странице обзора SDK есть правило о входе: «Unless previously approved, Anthropic does not allow third party
  developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent
  SDK.» — https://code.claude.com/docs/en/agent-sdk/overview, 2026-11-28.

## 5. Память проекта в облаке и auto memory Claude Code

Источник, если не указан другой: https://code.claude.com/docs/en/claude-projects, 2026-11-28.

- У Projects своя память в облаке: «Notes Claude keeps about the project, such as requirements, decisions, and pitfalls,
  stored as files. Every cloud thread reads the index file `MEMORY.md` when it starts and opens the other files when it
  needs them».
- Это не auto memory Claude Code: «They're separate from the auto memory Claude Code keeps on your machine, even though
  both use a `MEMORY.md` index.» В интерфейсе эти файлы всё же лежат под заголовком Auto memory: «Project settings >
  Memory lists these files under Auto memory».
- Управлять ею можно только в интерфейсе и просьбами в разговоре: «Ask Claude in the project conversation or any cloud
  thread to remember a requirement, a decision, or a pitfall, or to forget one. Read, edit, and delete the files in
  Project settings > Memory».
- Туда же Claude сам пишет пожелания о ходе работы: «Claude saves preferences like these to project memory on its own
  and follows them in later cloud threads.»
- Thread на своём компьютере эту память не получает: «Starts with the project's instructions, but not with its memory
  files loaded».
- Память проекта зависит от настройки claude.ai: «If memory is off in your claude.ai settings, Claude can't read or save
  project memory.»
- Она удаляется вместе с проектом: «Delete: permanently removes the project along with its threads, its memory, and its
  files».
- Публичного API или интерфейса SDK к памяти проекта не найдено. Ни страница Projects, ни страницы Agent SDK такого не
  описывают.
- В документации платформы есть похожие, но другие API:
  - Memory stores для Managed Agents (beta, header `agent-memory-2026-07-22`): «Memory stores let the agent carry
    information across sessions: user preferences, project conventions, prior mistakes, and domain context.» Слов
    «claude.ai», «Claude Code» и «Cowork» на странице нет. — https://platform.claude.com/docs/en/managed-agents/memory,
    2026-11-28.
  - Memory tool в Claude API: «The memory tool operates client-side: Claude requests file operations, and your
    application runs them.» — https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool, 2026-11-28.
- Память claude.ai chat и Cowork описана в help center: «Each project has its own memory.» Выгрузка есть: «All memory
  data is included in data exports.» Перенос памяти между сервисами пока опытный: «You can now transfer your memory
  between Claude and other AI services.» И: «This feature is experimental and still in active development». Projects в
  Claude Code статья не упоминает. —
  https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context,
  2026-11-28.
- В changelog Claude Code 2.1.172 (June 10, 2026) есть переменная для общих хранилищ памяти: «Fixed memory recall not
  finding mounted team memory stores (`CLAUDE_MEMORY_STORES`) in remote sessions». На странице env-vars её нет. —
  https://code.claude.com/docs/en/changelog и https://code.claude.com/docs/en/env-vars, 2026-11-28.

## 6. Версии и даты по changelog

Источник всех строк раздела: https://code.claude.com/docs/en/changelog, 2026-11-28. Страница собрана из
https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md; даты есть только на странице docs.

- `/btw`. Записи «Added» нет. Первое упоминание — 2.1.79, March 18, 2026: «Fixed `/btw` returning the main agent's
  output instead of answering the side question when triggered during streaming».
- Fork и branch session:
  - 2.0.64, December 10, 2025 — первое упоминание: «Improved `/resume` screen with grouped forked sessions».
  - 2.0.73, December 19, 2025 — флаг `--fork-session` уже есть: «Added support for custom session IDs when forking
    sessions with `--session-id` combined with `--resume` or `--continue` and `--fork-session`».
  - 2.1.47, February 18, 2026 — первое упоминание `/fork`: «Fixed crash when using `/fork` on sessions that used web
    search».
  - 2.1.77, March 17, 2026: «Renamed `/fork` to `/branch` (`/fork` still works as an alias)».
  - 2.1.212, July 17, 2026: «`/fork` now copies your conversation into a new background session (its own row in `claude
    agents`) while you keep working; the in-session subagent it used to launch is now `/subtask`».
  - 2.1.273, September 15, 2026: «Added forking a session started with `claude --remote-control` or `/remote-control`
    from the Claude app».
  - 2.1.330, November 20, 2026, VS Code: «Added `/fork` to fork a conversation after its last reply».
- Задачи по расписанию:
  - 2.1.71, March 7, 2026: «Added `/loop` command to run a prompt or slash command on a recurring interval» и «Added
    cron scheduling tools for recurring prompts within a session».
  - Облачные задачи: записи «Added» нет. Первое упоминание их tool-а — 2.1.101, April 10, 2026: «Fixed `RemoteTrigger`
    tool's `run` action sending an empty body». Что это за tool, сказано не в changelog, а в reference SDK: он «Manages
    cloud scheduled tasks, formerly routines» и «This tool backs the `/schedule` command». —
    https://code.claude.com/docs/en/agent-sdk/typescript, 2026-11-28.
  - Первое упоминание `/schedule` — 2.1.139, May 11, 2026: «Remote Control, `/schedule`, claude.ai MCP connectors, and
    notification preferences are now disabled when». Первое упоминание routines — 2.1.211, July 15, 2026: «Fixed
    routines with no schedule reporting a next run time in the year 1».
  - Переименование — 2.1.332, November 25, 2026: «Changed `/schedule`, permission prompts and `/loop`'s cloud offer to
    say "cloud scheduled task" instead of "routine" or "cloud schedule"; `/routines` still works».
  - Scheduled tasks в Desktop: записи о появлении нет. Упоминание есть в 2.1.328, November 19, 2026: «Fixed some Claude
    Desktop sessions on third-party providers, other than scheduled tasks».
- Auto memory:
  - 2.1.32, February 5, 2026: «Claude now automatically records and recalls memories as it works».
  - 2.1.59, February 26, 2026: «Claude automatically saves useful context to auto-memory. Manage with /memory».
  - 2.1.63, February 28, 2026: «Project configs & auto memory now shared across git worktrees of the same repository».
  - 2.1.74, March 12, 2026: «Added `autoMemoryDirectory` setting».
  - 2.1.83, March 25, 2026: «Memory: `MEMORY.md` index now truncates at 25KB as well as 200 lines».
  - 2.1.210, July 14, 2026: «Memory writes that leave a MEMORY.md index over its read limit now produce an explicit
    error instead of silent truncation».
  - 2.1.234, August 17, 2026: «Added the optional `CLAUDE_CODE_PROJECT_DIR_NAME` environment variable».
- Claude Projects — записей нет. Поиск по словам «project conversation», «Continue in project», «coordinator», «Overview
  pane» нашёл только строки о другом. Дата запуска есть только в блоге: «September 17, 2026». —
  https://claude.com/resources/articles/projects-redesigned, 2026-11-28.

## Что это значит для предложения PR #2270

Только факты, без рекомендаций.

- Ссылка PR на Claude Projects рабочая. Это public beta: «Projects are in public beta on Pro, Max, and Ultra plans».
  Projects работают на claude.ai/code, в Code tab Desktop и в мобильном приложении, но «not in the terminal CLI». —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Из десяти строк таблицы паритета шесть задокументированы полностью: координатор и thread-ы, репозитории и контекст,
  библиотека и файлы, облако и телефон, environment/MCP/Skills/Plugins/модели, лимиты и расход. Три — с оговорками: нет
  адресного ответа на сообщение, нет review чужого PR силами Claude, импорт — только из cloud session. В строке про
  `/btw`, `/fork`, snooze, resolve/reopen и sharing задокументирован только resolve/reopen. Sharing проекта прямо
  исключён: «You can't share a project with another user.» — https://code.claude.com/docs/en/claude-projects,
  2026-11-28.
- Cloud thread-ы не исполняют hooks и permission rules из `.claude/settings.json` репозитория, не применяют его `env` и
  не грузят `.mcp.json`. Общее правило: «Cloud threads don't pick up anything from the Claude Code setup on your own
  machine.» Hooks есть только у thread-а на своём компьютере. — https://code.claude.com/docs/en/claude-projects,
  2026-11-28.
- Описание памяти в PR совпадает с docs: индекс `MEMORY.md` и topic files, в начале session грузятся «the first 200 lines
  or 25KB of `MEMORY.md`», остальное читается по требованию. Четыре категории записаны в docs: «Claude records the kind
  as a `type` field». — https://code.claude.com/docs/en/memory, 2026-11-28.
- Все четыре имени из discovery spike есть в docs: `autoMemoryEnabled`, `autoMemoryDirectory`,
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_PROJECT_DIR_NAME`. Последний работает только вместе с
  `CLAUDE_CONFIG_DIR` и «Requires Claude Code v2.1.234 or later». — https://code.claude.com/docs/en/env-vars, 2026-11-28.
- В SDK `settingSources: []` auto memory не выключает: она стоит в таблице «What settingSources does not control».
  Выключают «`autoMemoryEnabled: false` in settings, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `env`». —
  https://code.claude.com/docs/en/agent-sdk/claude-code-features, 2026-11-28.
- PR предупреждает: «Do not assume SDK exposes dedicated memory events». В TypeScript reference есть тип
  `SDKMemoryRecallMessage`. Changelog TypeScript SDK 0.2.105 называет событие «`system/memory_recall`». Поля события не
  описаны. Сообщения о записи памяти и hook-а памяти не найдено. — https://code.claude.com/docs/en/agent-sdk/typescript и
  https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md, 2026-11-28.
- Третья проверка из discovery spike PR (один репозиторий, worktrees, subagent-ы, Linked Machines) частично уже имеет
  ответ в docs. Worktrees одного репозитория делят папку: «all worktrees and subdirectories within the same repo share
  one auto memory directory». Память главного разговора не попадает в subagent, кроме fork. Между машинами файлы не
  переносятся: «Files are not shared across machines or cloud environments.» — https://code.claude.com/docs/en/memory,
  2026-11-28. Разные клоны получают разные папки: «it differs across users, machines, and checkouts». —
  https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts, 2026-11-28.
- Про четвёртую проверку (параллельные записи) docs молчат. В changelog есть исправленный race «between
  memory-extraction writes and the main transcript» (2.1.77) и конфликты записи памяти в Cowork (2.1.280). —
  https://code.claude.com/docs/en/changelog, 2026-11-28.
- Память проекта Claude Projects и auto memory — разные хранилища: «They're separate from the auto memory Claude Code
  keeps on your machine». Публичного API к памяти проекта не найдено. — https://code.claude.com/docs/en/claude-projects,
  2026-11-28.
- Часть списка P1 из PR (раздел «Session convenience parity» — удобства отдельной Session) в Projects уже есть: Pause,
  Restart Claude, после которого «threads aren't affected», модели Coordinator и Threads, Usage по thread-ам, Continue in
  project, добавление репозитория thread-ом себе, Notifications проекта в Desktop, цель проекта. —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28.

## Не проверено

- Точное имя папки памяти. Docs говорят «derived from the git repository» (https://code.claude.com/docs/en/memory) и
  «keyed by the repository path» (https://code.claude.com/docs/en/claude-directory), 2026-11-28. Правило кодирования
  пути описано только для transcript-ов (https://code.claude.com/docs/en/sessions). Какой путь берётся у linked
  worktree, не сказано. Не хватает опыта на установленной версии Claude Code.
- Версии появления `autoMemoryEnabled` и `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Не хватает строки о версии: на
  https://code.claude.com/docs/en/settings-reference и https://code.claude.com/docs/en/env-vars её нет, в
  https://code.claude.com/docs/en/changelog эти имена не встречаются (2026-11-28).
- Грузится ли auto memory в SDK без `systemPrompt` и со своей строкой. Одна страница: память «Loaded into the system
  prompt at session start» (https://code.claude.com/docs/en/agent-sdk/claude-code-features). Другая: своя строка — «The
  SDK sends only what you provide.» (https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts), 2026-11-28.
  Прямого ответа нет. Не хватает опыта с SDK.
- Поля `SDKMemoryRecallMessage` и `memory_paths`. На https://code.claude.com/docs/en/agent-sdk/typescript есть только
  имя типа, 2026-11-28. Не хватает описания полей.
- Как устроен «memory recall». Docs: topic files читаются «using its standard file tools»
  (https://code.claude.com/docs/en/memory). Changelog: recall ломался «behind gateways that reject structured outputs»
  (2.1.288) и в Claude Tag «in organizations that cannot use the default Sonnet model» (2.1.286)
  (https://code.claude.com/docs/en/changelog), 2026-11-28. Механизм не описан.
- Гарантии при параллельной записи в одну папку памяти, например из двух worktrees одного репозитория. На
  https://code.claude.com/docs/en/memory их нет. Не хватает опыта с двумя одновременными session.
- Работают ли `/btw` и `/fork` в cloud session и в thread-е проекта. На https://code.claude.com/docs/en/claude-projects и
  https://code.claude.com/docs/en/claude-code-on-the-web об этом не сказано.
- Можно ли поделиться ссылкой на отдельный thread проекта через Share cloud session. На
  https://code.claude.com/docs/en/share-sessions и https://code.claude.com/docs/en/claude-projects об этом не сказано.
- Связь памяти проекта Claude Code с памятью claude.ai chat и Cowork. Описан только общий переключатель: «If memory is
  off in your claude.ai settings, Claude can't read or save project memory.» —
  https://code.claude.com/docs/en/claude-projects, 2026-11-28.
- Переменная `CLAUDE_MEMORY_STORES`: есть только в одной строке https://code.claude.com/docs/en/changelog (2.1.172), на
  https://code.claude.com/docs/en/env-vars описания нет.
- Когда появились `/btw`, `/schedule`, routines и scheduled tasks в Desktop. В
  https://code.claude.com/docs/en/changelog записей «Added» для них нет, указаны первые упоминания. Projects там нет
  совсем; дата запуска — только из https://claude.com/resources/articles/projects-redesigned.
- Claude Ship — отдельный продукт из списка статей блога: «Claude can now review pull requests, fix them, and approve the
  ones that a team's policy allows.» Не проверялся. — https://claude.com/resources/articles/projects-redesigned,
  2026-11-28.
- Поведение CLI и SDK, установленных в worfy, не проверялось: опыты вне этой заметки.
