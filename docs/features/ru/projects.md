# Projects

> Перевод [английской версии](../projects.md), commit `same-pr`.

Три Feature, которые относятся к Project-у целиком. **Full mode и Silent mode** решают, где лежат файлы workflow. **Project
switcher** — это список Project-ов и выбор того, который показывает окно. **ADR и HANDOFF** — view только для чтения над двумя
видами документов workflow. Термины объяснены в [Concepts](concepts.md).

## Full mode и Silent mode

### Behaviour

Режим Project-а решает, где находится его Workflow folder. В Full mode это корень репозитория, и файлы ездят в его ветках. В
Silent mode это папка вне репозиториев, и в репозитории не остаётся следов workflow.

| | Full mode | Silent mode |
|---|---|---|
| Workflow folder | Корень Project-а | Папка вне репозиториев Project-а |
| Репозитории | Один | Один или несколько |
| Статус Ticket-а | Файл Ticket-а в checkout-е и в ветках Ticket-ов | Файл Ticket-а в Workflow folder, один статус |
| За чем следит worfy | Корень Ticket-ов, git refs и список worktree | Корень Ticket-ов |
| Ветка Ticket-а | Названа по Ticket-у: по умолчанию `<epic>/<NN>` | Названа по изменению; её называет строка `Branch:` в Ticket-е |
| Отметки агентов (`review`, `check/<name>`) | Commit statuses head-коммита PR | Файл отметок в Harness home |
| Строки Claude attribution по умолчанию | Включены | Выключены |

Full mode хранит отметки в том же файле, когда Profile завершает работу через `local-green` и у репозитория нет `origin`.

В Silent mode Harness держит репозиторий чистым. Его guard отказывает коммиту, имени ветки или тексту PR со следом workflow: с
именем Epic-а, `<epic>/<NN>`, номером ADR или Ticket-а, путём к Workflow folder, `.scratch` или `HANDOFF`. Добавленные строки
diff-а на голое имя Epic-а не проверяются. Каждой Session такого Project-а сообщают, где находится Workflow folder.

**Выбор режима.** Режим выбирается один раз, в диалоге «Add project», и заранее выбран Silent mode. Диалог открывается только
для папки, которую Harness не знает. В worfy нет элемента управления, который меняет режим подключённого Project-а. Ещё одно
место, которое задаёт режим, — перенос старого Profile схемы 1 в форме миграции Harness: она предлагает Full mode, когда папка
Ticket-ов лежит внутри git-репозитория, и Silent mode в остальных случаях, и пользователь может изменить предложение.

**«Add project».** Его открывает «+» в секции Projects, а «Connect…» в Getting started просит о том же. В заголовке названы пять
шагов: Folder, Mode, Harness, Draft и Review. Нижняя строка говорит, что до Connect ничего не записывается.

1. **Folder.** Системный выбор папки. Что будет дальше, зависит от папки:

   | Папка | Что происходит |
   |---|---|
   | Её знает Harness | Сразу входит в список и становится активной. Диалога нет |
   | Git-репозиторий | Открывается диалог |
   | Подпапка или связанный worktree репозитория | Берётся корень репозитория, и notice об этом говорит |
   | Вне git, с двумя или больше репозиториями прямо в подпапках | Открывается диалог для Project-а над несколькими репозиториями. Папки с точкой в начале не считаются |
   | Вне git, с одним репозиторием | Отказ: нужно выбрать сам этот репозиторий |
   | Вне git, без репозиториев | Отказ с причиной |
   | Harness не смог ответить, знает ли он папку | Отказ с причиной. Папка не считается новой |

   Когда скрипта profile нет и шаг Harness всё равно остановил бы диалог, папка проходит дальше, и этот шаг говорит, что делать.

2. **Mode.** Две карточки. В Silent mode поле показывает Workflow folder. По умолчанию это новая папка
   `<Harness home>/projects/<name>/workflow/` со своей историей git, а для Project-а над несколькими репозиториями — сама
   выбранная папка. «Choose…» берёт другую, «Use default» возвращает обратно. Выбранная папка должна существовать и лежать вне
   репозиториев Project-а, и берётся такой, какая есть. «Write draft» идёт дальше.
3. **Harness.** Плагин Harness должен быть установлен, включён и версии этой сборки. Иначе диалог называет причину и предлагает
   «First-run checks…».
4. **Draft.** Session Claude Code читает папку и предлагает Profile. Диалог показывает её последнее действие. Stop завершает
   Session и возвращает на Mode с «Stopped: no draft was written.» Сбой показывает причину с «Back» и «Try again».
5. **Review.** Форма поверх черновика: аккаунт GitHub, имя, команды, команды Gate, ветка Ticket-а, finish, review lenses, MCP
   servers, языки, attribution и `rules.md`. Режим и Workflow folder показаны, и здесь их не изменить, а все поля Profile можно
   прочитать как JSON. Каждую правку Harness проверяет через 350 мс без новых правок, и проблема появляется под своим полем.
   «Connect» неактивен, пока проверка идёт или не смогла запуститься, пока читаются аккаунты и пока осталась хоть одна проблема.
6. **Connect.** Harness записывает Profile, папка входит в список и становится активной. Это может занять до 30 минут, потому что
   запись может индексировать Project для qmd. Пропущенный шаг qmd возвращается как notice, а Project всё равно подключён.

Esc и Cancel закрывают диалог и останавливают идущий черновик, но не во время записи Connect. Клик вне диалога закрывает его
только на шаге Mode.

**Аккаунт GitHub.** Форма перечисляет аккаунты, которые gh знает для хостов `origin`-ов папки, у каждого — его право на запись.
Заранее выбран активный аккаунт с правом на запись, иначе первый аккаунт с таким правом, иначе никакой. Выбор задаёт два поля
Profile: `github.account` и `workflow.finish`, который равен `pr-green-ci` при праве на запись во все такие репозитории и
`local-green` в остальных случаях. «No account» значит отсутствие аккаунта и `local-green`, и то же самое значит папка без
`origin` на хосте GitHub или Machine без gh. «Sign in with gh» запускает `gh auth login` в терминале внутри диалога, и когда gh
завершается, аккаунты читаются заново.

**С чего начинается форма.** Язык отчётов — язык системы: `ru`, иначе `en`. В Silent mode attribution начинается с `off`, что бы
ни предложила Session, а то, что пользователь выберет в форме, записывается как выбрано. В Full mode остаётся то, что предложила
Session. Для git-репозитория worktree лежат в `.claude/worktrees/` этого репозитория.

**Project над несколькими репозиториями.** Он всегда в Silent mode: карточка Full mode неактивна и говорит об этом, а main
отказывает в Full mode для него и на черновике, и снова на записи. Каждый Ticket говорит, к какому репозиторию он относится,
строкой `Repo:`. При двух или больше репозиториях Ticket Node показывает chip с этим именем или `no repo`. Ticket показывает
Gate, PR и CI своего репозитория, а Ticket без репозитория не показывает их. У самой папки нет ветки, поэтому в списке для неё
стоит `—`.

**Когда Harness не даёт ответа.** Каждый Project читается через Harness, и ответа можно не получить двумя способами:

| Случай | Что делает worfy |
|---|---|
| Нет Profile: exit code 3, нет скрипта, Harness старше Silent mode | Full mode, Workflow folder — корень Project-а, Ticket-ы в `<root>/.scratch` |
| Вызов не удался: другой exit code, timeout, вывод не той формы | Режим неизвестен. Вместо Ticket-ов worfy показывает «worfy could not ask the Harness where the workflow of this Project lives:» и первые три строки причины. Спрашивает снова через 10, 30 и 60 секунд, затем каждые 5 минут, и перезапуск не нужен. HANDOFF и ADR пока читаются из корня Project-а |

#### Windows

Новая папка внутри `%TEMP%` получает на шаге Folder знак `in %TEMP%` с предупреждением, что Storage Sense может удалить её файлы.
Добавить её всё равно можно. Папка, которую знает Harness, пропускает диалог, а Gate badge такого worktree несёт тот же знак.

#### On a Linked machine

Когда есть Linked machine, «Add project» сначала спрашивает Machine: эту, затем Linked machine по имени. Machine, которая спит,
не online, без доступа, только для чтения или со сменившимся сертификатом, выбрать нельзя, и она говорит почему.

Системный выбор папки открывается только на своей Machine, поэтому папка Linked machine выбирается в браузере внутри worfy. Он
начинает с домашней папки той Machine, в нём есть «Up» и «Show hidden folders», и он показывает не больше первых 2000 папок по
имени. Дальше каждый шаг идёт на той Machine, и диалог об этом говорит. Вход в gh и экран первого запуска он не предлагает.
Project входит в список там, не меняя активный Project той Machine, и это окно его открывает.

### How it works

- **worfy — это view над workflow** ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Он спрашивает Harness, где
  лежат файлы, а «Add project» пишет только через скрипт Harness. Собственное состояние worfy остаётся в его папке данных
  ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).
- **Profile целиком лежит на Machine, а у Workflow folder одна раскладка в обоих режимах**
  ([ADR-0042](../../adr/0042-profile-on-machine-full-and-silent-modes.md)). `HANDOFF.md` и `docs/adr/` занимают в ней одни и те же
  места, поэтому один reader обслуживает оба режима.
- **Session черновика ничего не может изменить.** У неё есть только Read, Glob и Grep, а всё, что пишет, выходит в сеть или
  запускает агентов, убрано и запрещено. Shell у неё нет, поэтому то, что можно узнать только командой (remotes, ветки), сначала
  читает скрипт Harness и передаёт ей как данные. Затем worfy поверх ответа ставит значения, которыми владеет сам: режим,
  Workflow folder, корень worktree, язык отчётов, отсутствие аккаунта GitHub и имя Profile в каждой записи Gate.
- **Что записывает Connect**, всё через `harness/bin/project-connect`: `profile.json` и `rules.md`, записи Gate registry, папку
  Workflow folder по умолчанию с `git init` и один коммит в Harness home. Сбой на полпути всё откатывает. В Silent mode
  репозитории получают одно: строку `.claude/worktrees/` в `.git/info/exclude`. Ничего не попадает в рабочее дерево или
  `.gitignore`.
- **Один Ticket — один репозиторий** ([ADR-0045](../../adr/0045-one-ticket-one-repository.md)), поэтому каждый репозиторий отвечает
  за свои проверки. Attribution по умолчанию следует за режимом, а значение в Profile важнее
  ([ADR-0061](../../adr/0061-attribution-default-follows-mode.md)). У отметок два хранилища по режиму
  ([ADR-0067](../../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)).
- **Файл Ticket-а вне корня остаётся доступным, но в границах.** В Silent mode Ticket и его ссылки открываются из Workflow folder и
  корня Ticket-ов. Место, которое является корнем диска или содержит домашнюю папку, исключается, чтобы Profile, называющий такое
  место, не открыл ссылке из Ticket-а все файлы пользователя.

### Implementation

**Модули.**

- `src/main/workflow/folder.ts`: `ProjectLayout` и `readProjectLayout`, который спрашивает `profile -C <root> --json` и
  `ticket root`. `projectLayouts()` — кэш приложения, один ответ на Project на 30 секунд.
- `src/main/workflow/profile.ts`: `readResolvedProfile` отличает «нет Profile» от «вызов не удался».
- `src/main/projects/connect.ts`: `ProjectConnector` выполняет шаги в main. `inspectFolder` и `profileKnows` — шаг 1,
  `harnessBlocker` — шаг 3, `applyChoices` ставит то, чем владеет worfy. `src/main/harness/attribution.ts`: attribution по умолчанию.
- `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts`: каналы `projects.connect.*`.
- `src/renderer/projects/ConnectProject.tsx`: диалог. `src/renderer/projects/GithubAccount.tsx`, `src/main/github/accounts.ts`:
  шаг аккаунта. `src/renderer/projects/FolderBrowser.tsx`, `src/main/projects/browse.ts`: папки Linked machine.
  `src/main/projects/temp-folder.ts`: правило `%TEMP%`.
- `src/main/workflow/reader.ts`, `src/main/workflow/watch.ts`: чтение и наблюдение по раскладке; неудавшаяся раскладка
  запрашивается снова по `LAYOUT_RETRY_MS`. `src/main/workflow/marks.ts`, `src/main/workflow/stages.ts`: отметки обоих хранилищ.
- `src/main/ipc/shell.ts`: `workflowPlaces`, места Ticket-а вне корня.
- `harness/bin/project-connect`: проверка и запись. `harness/bin/silent-check`, `harness/hooks/guard.mjs`: следы и отказ.
  `harness/hooks/session-start.mjs`: что сообщают Session. `harness/profiles/README.md`: Profile по полям.

**Поток данных «Add project».**

1. `projects.connect.inspect` отвечает `added`, `new` или `rejected`. Для `added` он уже вызвал `ProjectStore.add`.
2. `projects.connect.draft` проверяет папку и Harness, запускает `project-connect --facts`, стартует Session со схемой черновика
   как structured output и шлёт `projects.connect.activity`. Ответ проходит `--schema-only`, затем `applyChoices`, затем `--check`.
3. `projects.connect.check` запускает `--check` на каждую правку, более старый ответ отбрасывается.
4. `projects.connect.write` запускает `project-connect` без аргументов. Затем папку должен знать `bin/profile -C`, и только после
   этого она добавляется в список. На факты и проверки у скрипта 120 секунд, на запись 30 минут, и при выходе из приложения он
   завершается принудительно.

**Основные тесты.**

- `test/contract/projects-connect.test.ts`: шаги с заменителями и с настоящими скриптами, инструменты Session черновика, лимиты
  времени, attribution в сверке с `bin/profile`.
- `test/e2e/projects-connect.spec.ts`: Silent по умолчанию, черновик, форма, Connect, неустановленный Harness, аккаунт.
- `test/e2e/silent-project.spec.ts`: Silent Project и Project над двумя репозиториями в собранном приложении, ничего не записано
  в Workflow folder или репозитории.
- `test/contract/github-accounts.test.ts`: аккаунты. `test/unit/temp-folder.test.ts`: правило `%TEMP%`.
- `test/unit/add-project-machine.test.tsx`, `test/unit/folder-browser.test.tsx`, `test/e2e/linked-add-project.spec.ts`:
  «Add project» на Linked machine.

## Project switcher

### Behaviour

**Список.** «Projects» — первая секция sidebar, после Getting started, пока та показана. Строка показывает значок папки, имя папки и справа ветку в checkout-е: `HEAD`,
когда HEAD detached, `—`, когда git не может её прочитать. Tooltip — полный путь. Project, который показывает окно, подсвечен, и
toolbar повторяет его как `<name> · <branch>`. Ветка читается заново, когда окно получает фокус, и при каждом изменении списка.

Без Project-ов секция говорит «No projects yet», toolbar — «No project», а Canvas — «Add a project to see its canvas.»

**Переключение.** Переключает клик по строке, а также `Switch to project <name>` в Command palette, где перечислен каждый другой
Project Machine этого окна. Строка секции Pipeline или notification о Ticket-е, который ждёт владельца, открывает свой Project
тем же способом и показывает его Pipeline board. Переключение действует на Canvas, Session view и Pipeline board.

- Активный Project один на Machine, и все окна этой Machine следуют за ним.
- Список и активный Project переживают перезапуск.
- Открывается Orchestrator нового активного Project-а. Orchestrator-ы других Project-ов из списка не закрываются.
- Переключение ничего не записывает ни в какой репозиторий.

Добавление Project-а, который уже есть в списке и известен Harness, выбирает его и говорит `<name> is already in the list.`

**Контекстное меню строки.**

- «Project settings…» содержит шаблоны сообщений «Ship ticket», «Run wave» и «Process gate queue» с подстановками `{epic}`,
  `{NN}`, `{wave}`, `{slug}`, `{branch}` и `{tickets}`. Неизвестная подстановка показывает ошибку под полем и выключает Save.
  «Reset to default» ставит значения по умолчанию из Harness, который сейчас найден на Machine. На Windows в диалоге есть ещё
  [Terminal shell](terminal.md).
- «Process gate queue» есть только тогда, когда роль Project-а в межмашинной очереди Gate — `serve`. Пункт отправляет шаблон
  Orchestrator-у Project-а.
- «Remove from list» действует сразу, без вопроса. Project уходит из списка. Если он был активным, активным становится первый из
  оставшихся или никакой. Его папка данных остаётся, поэтому снова добавленный Project найдёт там свои настройки. Его Orchestrator
  закрывается, как и shell-ы его [Terminal](terminal.md)-ов. Репозиторий и Profile Harness не затрагиваются.

**Сломанный список.** `projects.json` с битым JSON или неверной формы откладывается в сторону, и приложение стартует с пустым списком.
Сохранённый активный Project, которого нет в списке, читается как отсутствие активного Project-а.

#### On a Linked machine

При Linked machine список сгруппирован по Machine: сначала эта, затем Linked machine по имени.

| Состояние Machine | Что показывает её группа |
|---|---|
| Online, доступ открыт | `Online` и её Project-ы |
| Online, только чтение | `Online`, chip `Read only` и её Project-ы |
| Online, доступ выключен | `<name> doesn't share its Projects` |
| Не online, или её сертификат сменился | `Unavailable`, Project-ов нет |

Окно показывает Project-ы одной Machine, названной в его адресе (`machine` и `project`):

- Клик по Project-у другой Machine заново загружает окно на той Machine.
- Клик по другому Project-у той же Linked machine меняет только то, что показывает это окно, без перезагрузки.
- Клик по Project-у этой Machine делает его активным здесь и возвращает окно на эту Machine.
- Добавления и удаления с Linked machine сохраняют активный Project той Machine, на которую она смотрит, а `projects.select` для
  неё закрыт.
- Toolbar показывает `<name> · <Machine> · <branch>`.

С полным доступом Linked machine может добавлять и удалять Project-ы там. Удалить активный Project той Machine она не может:
«only its own screen removes it». С доступом только для чтения действия записи остаются на экране неактивными, а tooltip говорит
`<name> gives this Machine read-only access`. Переключение остаётся активным.

Project, отмеченный как локальный для своей Machine, например Demo project, не входит в список, который получает Linked machine.
Вызов, который его называет, получает отказ.

### How it works

- **Project — это папка с id.** Id — это `<имя папки>-<первые 8 hex от sha256(path)>`, он же называет папку данных Project-а. Хеш
  берётся от корня в написании git или Harness, поэтому на Windows написание `C:/…` сохраняет id стабильными, хотя сохранённый путь
  имеет вид `C:\…`.
- **У списка есть revision.** Каждое изменение её повышает, и клиент держит состояние с наибольшей revision, поэтому запоздавший
  ответ не откатывает список назад. Равная revision принимается: в ней может быть более свежая ветка.
- **Новый renderer на каждую Machine.** Модули renderer-а хранят состояние по id Project-а, а у одной и той же папки на двух Machine
  один id. Поэтому переход на другую Machine перезагружает окно
  ([ADR-0053](../../adr/0053-several-screens-on-one-project.md)).
- **Экран удерживает Project.** Пока экран Linked machine показывает Project с полным доступом, Machine этого Project-а держит
  открытыми его Orchestrator и документы, как для своего активного Project-а. Клиент, который уходит, отпускает всё, что держал.
  `projects.hold` — канал `write`, поэтому экран только для чтения ничего не удерживает
  ([ADR-0066](../../adr/0066-read-only-access-for-a-linked-machine.md)).

### Implementation

**Модули.**

- `src/main/projects/store.ts`: `ProjectStore`, список в `<data root>/projects.json`, ветка через `git` и `onChange`, событие
  «активный Project переключился». `states()` даёт список для окон этой Machine и для Linked machine.
- `src/main/projects/settings.ts`, `src/shared/projects/action-templates.ts`: настройки Project-а.
  `src/main/projects/holds.ts`: `ProjectHolds`. `src/main/ipc/linked.ts`: `linked.open` превращает выбор окна в удержание.
- `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts`: каналы и их доступ. `projects.select` — `local`,
  `projects.pickFolder` — `desktop`, а `projects.list`, `projects.remove`, `projects.add` и `projects.hold` — `project`.
- `src/main/agent/app-orchestrators.ts`: следует за `onChange` и удержаниями и закрывает Orchestrator удалённого Project-а.
- `src/renderer/projects/useProjects.ts`: копия renderer-а, `openProject` как единственный способ открыть Project, `groupProjects`
  для Machine и `useReadOnly`.
- `src/renderer/shell/sidebar/ProjectsSection.tsx`: секция и меню. `src/renderer/shell/ProjectSettings.tsx`: диалог настроек.
  `src/renderer/projects/read-only.ts`: как выглядит неактивное действие записи.
- `src/renderer/palette/commands.ts`: «Switch to project». `src/renderer/pipeline/open.ts`,
  `src/renderer/canvas/overlays/NotificationTarget.tsx`: другие пути к `openProject`.

**Поток данных переключения.** `openProject` вызывает `projects.select` на этой Machine. `ProjectStore.select` фиксирует выбор, и
срабатывают его listeners: `projects.changed` идёт всем клиентам, `src/main/ipc/docs.ts` переносит удерживаемые документы, и
открывается Orchestrator нового Project-а. Renderer принимает ответ через `acceptProjectsState`.

**Основные тесты.**

- `test/contract/projects.test.ts`: добавление, выбор, удаление, сохранение, настройки, нетронутый репозиторий, `projects.browse`,
  вызовы с Linked machine и Project-ы, локальные для Machine.
- `test/e2e/projects.spec.ts`: добавление, переключение, настройки, перезапуск и удаление в собранном приложении и сломанный
  `projects.json`.
- `test/unit/use-projects.test.tsx`: revision, группы по Machine, окна на Linked machine.
- `test/contract/projects-hold.test.ts`, `test/unit/project-holds.test.ts`: удержания. `test/contract/link-access.test.ts`,
  `test/unit/link-access.test.ts`: что может вызывать Linked machine.

## ADR и HANDOFF

### Behaviour

Оба — view только для чтения: в worfy нет элемента управления, который правит эти файлы. **HANDOFF** — один файл, `HANDOFF.md`, в
корне Workflow folder. **ADR** — файлы `docs/adr/NNNN-*.md` там же: четыре цифры и дефис, прямо в этой папке, поэтому `README.md`
рядом с ними — не ADR. В Full mode Workflow folder — это корень Project-а, а в Silent mode одноимённые файлы Project-а в репозитории
не читаются. Эти два места фиксированы: worfy не читает `docs.handoff.path` и `docs.adr_dir` из Profile.

**HANDOFF Node.** Показывает текст, отрисованный как markdown, с заголовком `HANDOFF` и `HANDOFF.md`. Размер по умолчанию — 360 на
320 пикселей, и он уменьшается до 240 на 120. Правка вручную или агентом появляется на Node-е в течение секунды.

| Ситуация | Node |
|---|---|
| Project впервые виден с `HANDOFF.md` | Создаётся заблокированным, в верхнем левом месте плоскости, если оно свободно, иначе под всеми Node-ами |
| Заблокирован | Двигается и меняет размер, но удалить его нельзя. Delete к нему не применяется |
| Файл исчез | Скрыт и отмечен как скрытый со стороны main |
| Файл вернулся | Снова показан |
| Скрыт через инструменты Canvas, пока файл есть | Остаётся скрытым |
| Кто-то показал его, пока файла нет | В теле написано «The Project has no HANDOFF.md» |
| Документы не удалось открыть или не удалось прочитать текст файла из списка | В теле написано «HANDOFF.md could not be read:» и причина |

Текст можно выделять. Колесо двигает Canvas, пока по Node-у не кликнули, а потом прокручивает текст. Find ищет по тексту HANDOFF.

**Секция ADR.** Она в sidebar после Epic-ов, с числом ADR в заголовке. Строка показывает номер, заголовок и статус, сортировка по
номеру. Заголовок — первый заголовок `# `, а без него имя файла. Статус — то, что идёт после метки статуса, без точки в конце, и
ищется он в первых 20 строках. Метка — `docs.adr_status_label` из Profile, а без неё `Status`; старая `Статус` тоже читается. У файла
без такой строки статуса нет.

Без ADR секция говорит «No ADRs in docs/adr/». Добавленный или удалённый файл меняет список без перезагрузки.

**ADR panel.** Клик по строке открывает ADR поверх Canvas справа, шириной не больше 680 пикселей, с номером, заголовком и статусом в
заголовке панели. Esc или Close закрывают её. Изменение файла видно в открытой панели, исчезнувший ADR скрывает её, пока файл не вернётся, а другой Project
её не показывает. «Go to» в Command palette перечисляет каждый ADR по заголовку и находит его и по номеру (`12`, `0012`, `adr 0012`).
При скрытом sidebar такой запрос ждёт, пока sidebar покажут, и выполняется один раз.

**«Open in Editor»** передаёт файл приложению, которое система назначила для него. Идёт по пути относительно корня Project-а.

**Текст обоих.** Один markdown renderer с таблицами, списками задач и зачёркиванием. Сырой HTML показывается как текст и никогда не
выполняется. Изображения не загружаются: показывается alt-текст. Ссылки `https://` открываются в браузере по умолчанию, а
относительная ссылка открывает файл Project-а в редакторе по умолчанию. Абсолютный путь открывается так же, когда лежит внутри
Project-а, одного из его worktree, Workflow folder или корня Ticket-ов; в другом месте он ничего не открывает.
Ссылка на файл, который не является документом, сначала
спрашивает: открыть его, показать в файловом менеджере или отменить. Любая другая ссылка — просто текст.

**Лимиты.** Файл больше 1 MiB отвергается и читается как отсутствующий: ADR уходит из списка, а `HANDOFF.md` такого размера скрывает
Node. Файл, который не читается, исключается так же. Символическая ссылка считается, только если ведёт к HANDOFF или ADR того же
корня.

**Silent mode: ссылки на файлы смотрят в корень Project-а.** «Open in Editor» и относительные ссылки HANDOFF и ADR разрешаются
относительно корня Project-а, а не Workflow folder. Когда Workflow folder лежит вне корня, файла там обычно нет: ничего не открывается,
а ошибка уходит только в консоль. Если в репозитории есть файл по этому пути, откроется он. Project над несколькими репозиториями с
Workflow folder по умолчанию это не затрагивает, потому что там обе папки — одна.

**Когда папка исчезает.** Документы читаются как исчезнувшие: Node скрывается, список ADR пустеет. На macOS они возвращаются, когда
снова появляется папка с этим путём. Удаление или переименование папки выше корня на macOS не даёт события, и документы остаются такими,
какими были прочитаны.

#### Windows

- UNC или device path вне корня отвергается по его тексту. Ссылка на пути к документу, которая ведёт к сетевой папке, считается
  выходом за пределы Project-а, и такой документ исключается из списка. Запрос к нему заставил бы Windows передать этому хосту
  учётные данные пользователя. Project, который сам лежит в сетевой папке, читает свои документы там.
- Когда корень удалён, watch закрывается на первом событии, которое называет корень, и корень ищется каждые 2 секунды.

#### On a Linked machine

Каналы `docs.*` — `read`, поэтому Linked machine с доступом только для чтения тоже видит документы. Watch работает на Machine
Project-а. «Open in Editor» и ссылки на файлы показывают `File is on <Machine>` вместо открытия, а ссылка `https://` открывается на
той Machine, где по ней кликнули.

### How it works

- **Только чтение по устройству** ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md),
  [ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). `docs.read` выдаёт только эти файлы: путь разрешается вместе с символическими
  ссылками и после этого должен быть `HANDOFF.md` в корне или ADR прямо в `docs/adr` того же корня. Текст HANDOFF никогда не копируется
  в Layout.
- **Один watch на Project.** Один рекурсивный `fs.watch` корня общий для всех, кто открыл документы, и он останавливается, когда уходит
  последний. События по другим путям отбрасываются по имени до всякого чтения. Чтение идёт через 50 мс после последнего события, и
  состояние отправляется, только когда что-то изменилось. Поток событий начинается чуть позже создания watch, поэтому чтения на 100,
  400 и 1000 мс подбирают то, что изменилось в этот момент.
- **Версия на файл.** Состояние несёт хеш каждого файла, а не его текст. View читает текст через `docs.read`, когда хеш меняется, и
  держит старый текст на экране, пока не придёт новый.
- **main сам держит документы активного Project-а открытыми,** поэтому HANDOFF Node следует за файлом и при скрытом sidebar. То же он
  делает для Project-а, который удерживает экран Linked machine.
- **У скрытия есть владелец.** Отметка `missing` отличает скрытие самим main от чьего-либо ещё, поэтому main отменяет только своё.

### Implementation

**Модули.**

- `src/main/docs/watch.ts`: `resolveDocPath`, `readDoc`, `parseAdr`, `readDocs`, затем `DocsWatcher` на один корень и `DocsHub` на один
  watcher на Project. `DOC_SIZE_MAX`, `SETTLE_READS_MS` и `ROOT_RETRY_MS` — числа выше.
- `src/main/ipc/docs.ts`: каналы, `docsSource`, который выбирает корень по режиму, `syncHandoffNode` и документы, которые держатся для
  активного и удерживаемых Project-ов.
- `src/main/watch-gone.ts`, `src/main/remote-links.ts`: исчезнувший корень и ссылки, ведущие к сетевой папке.
- `src/shared/ipc/docs.ts`: каналы и имена и размеры файлов и Node-а. `src/shared/workflow/doc-headings.ts`: метка статуса.
  `src/main/layout/place.ts`: место нового Node-а.
- `src/renderer/docs/useDocs.ts`: `useDocs`, одна общая копия на Project, и `useDocText`.
- `src/renderer/canvas/nodes/HandoffNode.tsx`: Node. `src/renderer/shell/sidebar/AdrSection.tsx`: секция и панель.
- `src/renderer/markdown/Markdown.tsx`, `src/renderer/markdown/links.ts`: renderer и то, куда ведёт ссылка.
- `src/main/ipc/shell.ts`: `shell.openInEditor`. `src/renderer/machines/useFileElsewhere.ts`: `File is on <Machine>`.
- `src/renderer/palette/commands.ts`: «Go to» ADR. `src/renderer/find/search-index.ts`: Find по HANDOFF.

**Поток данных.** Первый потребитель в renderer-е вызывает `docs.open`. `docsSource` спрашивает у раскладки корень, а `DocsHub.open`
запускает watcher и отвечает состоянием. Каждое изменение шлёт `docs.changed` подписчикам и проходит через `syncHandoffNode`, который
применяет операции Layout. View с новой версией вызывает `docs.read`.

**Основные тесты.**

- `test/contract/docs.test.ts`: `docs.read` и его отказы, `docs.open`, HANDOFF Node и его скрытия, Silent Project, метка статуса, ничего
  не записано.
- `test/e2e/handoff.spec.ts`: Node, правка в течение секунды, список и панель ADR в собранном приложении, нетронутый репозиторий.
- `test/unit/adr-section.test.tsx`: запросы palette, «Open in Editor» и окно на Linked machine.
- `test/contract/docs-watch-root.test.ts`, `test/unit/docs-watch-root-gone.test.ts`: корень, который удалён и вернулся.
- `test/unit/docs-remote-links.test.ts`: правила для сетевых папок, под путями Windows на любой системе.
