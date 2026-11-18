# Projects

> Перевод [английской версии](../projects.md), commit `a8f1faef`.

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

**Выбор режима.** Режим выбирается в диалоге «Add project», и заранее выбран Silent mode. Диалог открывается только для
папки, которую Harness не знает. Подключённый Project меняет режим только переносом файлов workflow — действием рядом с `mode`
в «Edit profile» (ниже). Ещё одно место, которое задаёт режим, — перенос старого Profile схемы 1 в форме миграции Harness: она
предлагает Full mode, когда папка Ticket-ов лежит внутри git-репозитория, и Silent mode в остальных случаях, и пользователь
может изменить предложение.

**Перенос между режимами.** «Move to Silent mode…» (или «Move to Full mode…») под режимом в «Edit profile» открывает
подтверждение: что переезжает, с какого пути на какой. Для Silent mode в нём есть поле Workflow folder; пустое — `<папка
Profile-а>/workflow`, которую `git init` создаёт, если её нет. У Silent Project-а над несколькими репозиториями «Move to Full
mode…» нет: форма говорит, что он остаётся в Silent mode. «Move files» передаёт перенос `harness/bin/profile-set --move`. Файлы
workflow — пути, которые Profile называет относительно Workflow folder: корень Ticket-ов (со spec-ами Epic-ов и evidence), папка
шаблонов Ticket-а и spec-а до первой подстановки, если она лежит вне этого корня, файл состояния, папка ADR, glossary и lessons,
которые хранятся в репозитории. Абсолютный путь остаётся на месте. Их отслеживаемые файлы копируются на другую сторону и
коммитятся там, затем удаляются через `git rm` и коммитятся на стороне, откуда ушли. Сообщение каждого commit-а называет, куда
или откуда переехали файлы. Только после этого Profile получает `mode` и `workflow.folder`: Silent mode пишет путь папки, Full
mode — `null`. Изменение коммитится в git папки Harness.
Перенос отклоняется до любой записи, с причиной в нижней строке формы, когда:
- Project уже в этом режиме;
- Project над несколькими репозиториями, а перенос — в Full mode;
- в репозитории или в Workflow folder есть незакоммиченные или неотслеживаемые изменения (что бы ни говорил
  `status.showUntrackedFiles`), это не собственный git-репозиторий или в нём не выбрана ветка (detached HEAD);
- Workflow folder лежит внутри репозитория, в том числе когда туда ведёт ссылка на её пути, или папка, которую перенос создал бы
  (или сделал бы `git init`), лежит внутри другого git-репозитория;
- файл переноса уже лежит на новом месте;
- открыт PR ветки Ticket-а, или gh не может это сказать. Ветка Ticket-а — его строка `Branch:` или шаблон ветки Profile-а для
  его Epic-а. Репозиторий без remote не спрашивают;
- Session Project-а в worfy запускается, занята или ждёт разрешения (это worfy проверяет до вызова скрипта). Session в
  ожидании перенос не останавливает.

Файл, который `.gitignore` принимающей стороны игнорирует, тоже переезжает (`git add -f`), и нижняя строка его называет. Сбой на
середине возвращает обе стороны как было, и Profile остаётся в прежнем режиме. Если откат не смог вернуть всё, нижняя строка
говорит, что перенос не удался, и перечисляет, что осталось поправить руками.

Перед началом перенос пишет marker рядом с `profile.json` (`.move-in-progress.json`). Он удаляется, когда Profile записан или
откат прошёл целиком. Если worfy закрылся или машина выключилась посередине, форма говорит, что перенос остановлен на середине.
Следующий перенос сначала откатывает тот, а потом переносит (или только удаляет marker, если Profile уже был записан). Он
отказывает, оставляет marker и называет найденное, если какая-то сторона с тех пор изменилась: commit, reset, новый файл,
правка перенесённого файла. Откатываются только собственные commit-ы, удаления и копии переноса (с тем содержимым, какое у них
было на старом месте), и копии удаляются по одной, по имени: папка уходит, только когда опустела, поэтому чужой файл в ней
остаётся. Marker, который не читается, даёт отказ с тем, что делать: проверить обе стороны, вернуть руками то, что оставил тот
перенос, затем удалить marker. Сигнал только скрипту не останавливает его между двумя шагами; сигнал всей группе процессов
(Ctrl+C в терминале, приложение, которое при закрытии сигналит группе) останавливает и его git, и тогда перенос откатывается,
как после любого сбоя. worfy даёт переносу до 30 минут.

Watch-и worfy на Project закрываются на время переноса и открываются после — там, где файлы теперь: Ticket-ы, документы (ADR,
`HANDOFF.md`) и закешированный layout Project-а читаются заново. Пока в форме есть несохранённые правки, кнопка ждёт Save или
отмены: после переноса форма читает Profile заново. У Project-а Linked machine переноса нет.

Коллекции qmd `<name>-docs` и `<name>-tickets` продолжают индексировать старое место: нижняя строка называет их после переноса.
`harness/bin/qmd-collections` ничего не меняет, пока Profile называет коллекции, поэтому их пересоздают руками:
1. `qmd collection remove <name>-docs` и `qmd collection remove <name>-tickets`;
2. `harness/bin/profile-set -C <репозиторий> --field qmd --read` печатает fingerprint поля `qmd` Profile-а;
3. `harness/bin/profile-set -C <репозиторий> --field qmd --expect <fingerprint> --reset` убирает поле;
4. `harness/bin/qmd-collections <name>` создаёт коллекции на новом месте и снова называет их в Profile.
   `<name>-memory` сохраняет свой путь, поэтому берётся как есть.

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

**Предложение собрать Team reviewer.** После добавления папки, которой ещё нет в списке, через Connect или как папки, которую
Harness уже знает, worfy в фоне запускает `review-history probe` из Harness с аккаунтом GitHub Profile-а и лимитом 2 минуты. Если
ревьюеры команды оставили 30 содержательных комментариев за последние 12 месяцев (`voice: yes`), у Project-а появляется `action`
toast «Build a reviewer in your team's style?» с кнопками «Build» и «Later». «Build» открывает новую [Session](sessions.md) в
корне Project-а на Claude Code, первое сообщение которой — `/worfy:human-review-setup`. «Later» или закрытие toast сохраняет
`humanReview.offer: "later"` в настройках Project-а, и предложение больше не появляется — ни после перезапуска, ни после нового
добавления. `voice: no`, отсутствие `origin` на GitHub, отсутствие gh, сбой или лимит времени ничего не показывают; в log
уходит одна строка. Project, у которого ревьюер уже собран, предложения не получает. Что это за ревьюер, как он собирается и
проверяется и кто его получает — на странице [Team reviewer](human-review.md).

**Напоминание обновить Team reviewer.** Каждый раз, когда окно делает Project активным, оно спрашивает main, пора ли напомнить.
Пора, когда ревьюер собран, его дата (как её показывает «Team reviewer» ниже) старше 30 дней и за последние 30 дней напоминания
не было. Напоминание, которому пора, сначала сохраняется как `humanReview.remindedAt` в настройках Project-а в папке данных
worfy, поэтому оно приходит один раз: в одном окне и снова не раньше чем через 30 дней. Затем у Project-а появляется `action`
toast «Update your team reviewer?» с кнопками «Update» и «Later». «Update» открывает новую Session в корне Project-а на Claude
Code, первое сообщение которой — `/worfy:human-review-setup --refresh`: skill читает только pull request-ы после своего
последнего анализа, показывает правила, которые добавляет, меняет и удаляет, и ничего не заменяет, пока человек не согласится.
«Later» и закрытие toast только закрывают его. Напоминание читает приватную папку и ничего больше: ни скрипта Harness, ни
GitHub, ни модели. Экран Linked machine только для чтения не спрашивает.

Esc и Cancel закрывают диалог и останавливают идущий черновик, но не во время записи Connect. Клик вне диалога закрывает его
только на шаге Mode.

**Аккаунт GitHub.** Форма перечисляет аккаунты, которые gh знает для хостов `origin`-ов папки, у каждого — его право на запись.
Заранее выбран активный аккаунт с правом на запись, иначе первый аккаунт с таким правом, иначе никакой. Выбор задаёт два поля
Profile: `github.account` и `workflow.finish`, который равен `pr-green-ci` при праве на запись во все такие репозитории и
`local-green` в остальных случаях. «No account» значит отсутствие аккаунта и `local-green`, и то же самое значит папка без
`origin` на хосте GitHub или Machine без gh. «Sign in with gh» запускает `gh auth login` в терминале внутри диалога, и когда gh
завершается, аккаунты читаются заново. У gh старше 2.81 нет JSON-вывода для `gh auth status`: тогда аккаунты читаются из его
текстового вывода, а аккаунт, вход которого не удался или истёк по времени, — вместе со своим состоянием. У gh старше 2.40 нет
`gh auth token -u`, поэтому шаг завершается ошибкой с его версией и командой, которая его обновляет (`brew upgrade gh`, на Windows
`winget upgrade GitHub.cli`); так же — текст, в котором нет ни одного аккаунта, когда gh завершился с 0: тогда шаг просит gh 2.81
или новее. Совсем без gh шаг называет `brew install gh`, на Windows `winget install GitHub.cli`.

**С чего начинается форма.** Язык отчётов — язык системы: `ru`, иначе `en`. В Silent mode attribution начинается с `off`, что бы
ни предложила Session, а то, что пользователь выберет в форме, записывается как выбрано. В Full mode остаётся то, что предложила
Session. Для git-репозитория worktree лежат в `.claude/worktrees/` этого репозитория.

**Project над несколькими репозиториями.** Он всегда в Silent mode: карточка Full mode неактивна и говорит об этом, а main
отказывает в Full mode для него и на черновике, и снова на записи. Каждый Ticket говорит, к какому репозиторию он относится,
строкой `Repo:`. При двух или больше репозиториях Ticket Node показывает chip с этим именем или `no repo`. Ticket показывает
Gate, PR и CI своего репозитория, а Ticket без репозитория не показывает их. У самой папки нет ветки, поэтому в списке для неё
стоит `—`.

**Ticket над несколькими репозиториями.** Одна правка может затронуть библиотеку и её потребителя: тогда у Ticket-а по строке
`Repo:` на каждый, одна строка `Branch:` на все и по строке `PR: <repo>#N` на каждый PR. worfy показывает его как один Ticket:

- Chip Ticket Node называет все репозитории в порядке строк `Repo:`: `lib, app`.
- Badge-и Gate, PR и CI идут строкой на каждый репозиторий, который есть у Project-а. Имя репозитория стоит отдельной
  строкой над chip-ами. Ветка запрашивается в каждом репозитории, и каждая строка показывает PR, CI и verdict ревью своего
  репозитория. Репозиторий, которого у Project-а нет, строки не получает.
- «Open PR» становится меню с пунктом на PR каждого репозитория, например `lib PR #41` и `app PR #118`. Если PR есть только в
  одном репозитории, остаётся одна кнопка.
- На Pipeline board у него одна карточка. В ней строка на каждый репозиторий с его PR и состоянием: `lib #41 · merged`,
  `app #118 · open` или `app · no PR`, пока этого PR нет. Tooltip строки называет стадию, на которой стоит этот репозиторий, а у
  строки с красным CI свой флаг `failing`; другие подписи флага на строке не получают. Когда один PR влит, карточка пишет
  `1/2 merged`.
- Карточка стоит на стадии самого отстающего репозитория. Пока какой-то репозиторий стоит на стадии `release`, карточка пишет
  `waits for release lib-v1.4.0` для каждой невыполненной строки `Release:` или `release lib-v1.4.0 not checked`, если worfy
  не смог спросить. В узкой колонке строка переносится, а не обрезается. Когда release вышел, строка пропадает.
- PR ничего не говорят друг о друге. Их связь видна только на board и в файле Ticket-а.

Ticket одного репозитория выглядит как раньше: один chip, одна строка badge-ей и никаких строк PR на карточке.

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
  запускает агентов, убрано и запрещено. Она читает только внутри выбранной папки, своей рабочей папки и папки плагина
  Harness: Read, Glob или Grep пути в другом месте, в том числе по ссылке, которая ведёт из папки, отклоняется. Shell у неё нет,
  поэтому то, что можно узнать только командой (remotes, ветки), сначала читает скрипт Harness и передаёт ей как данные. Затем
  worfy поверх ответа ставит значения, которыми владеет сам: режим, Workflow folder, корень worktree, язык отчётов, отсутствие
  аккаунта GitHub и имя Profile в каждой записи Gate.
- **Черновик не оставляет после себя Session.** Его запрос выполняется в собственной папке worfy
  `<WORFY_DATA_DIR>/terminal-ai`, читает выбранную папку как дополнительную по абсолютным путям, и Claude Code не хранит его
  transcript. Поэтому, когда папка становится Project-ом, в её списке Session нет Session, которую человек не запускал, а факты
  черновика нигде не остаются на диске.
- **Что записывает Connect**, всё через `harness/bin/project-connect`: `profile.json` и `rules.md`, записи Gate registry, папку
  Workflow folder по умолчанию с `git init` и один коммит в Harness home. Сбой на полпути всё откатывает. В Silent mode
  репозитории получают одно: строку `.claude/worktrees/` в `.git/info/exclude`. Ничего не попадает в рабочее дерево или
  `.gitignore`.
- **Один Ticket — один репозиторий** ([ADR-0045](../../adr/0045-one-ticket-one-repository.md)), поэтому каждый репозиторий отвечает
  за свои проверки. Ticket может назвать несколько репозиториев, с PR в каждом и стадией release между ними
  ([ADR-0104](../../adr/0104-one-ticket-several-repositories.md)). main считает стадию каждого репозитория, и Ticket стоит на
  самой ранней. Стадия несёт `merged`, `release` и `prs` (строку на репозиторий), а board их только рисует. Attribution по умолчанию следует за режимом, а значение в Profile важнее
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
  шаг аккаунта; `src/main/github/auth-text.ts` читает текстовый вывод `gh auth status` для этого шага и для Health check.
  `src/renderer/projects/FolderBrowser.tsx`, `src/main/projects/browse.ts`: папки Linked machine.
  `src/main/projects/temp-folder.ts`: правило `%TEMP%`.
- `src/main/workflow/reader.ts`, `src/main/workflow/watch.ts`: чтение и наблюдение по раскладке; неудавшаяся раскладка
  запрашивается снова по `LAYOUT_RETRY_MS`. `src/main/workflow/marks.ts`, `src/main/workflow/stages.ts`: отметки обоих хранилищ.
- `src/main/ipc/shell.ts`: `workflowPlaces`, места Ticket-а вне корня.
- Ticket над несколькими репозиториями: `stageOf` в `src/shared/workflow/pipeline.ts` даёт `prs`, `merged` и `release`.
  Карточку рисуют `src/renderer/pipeline/PipelineBoard.tsx` и `board.ts`. Репозитории называют `reposOfTicket` и
  `checksSourcesOfTicket` в `src/shared/ipc/checks.ts`. `src/renderer/canvas/badges/ChecksBadges.tsx` и `use-checks.ts`
  (`useChecksOf`, `useTicketChecksOf`) спрашивают каждый из них, а `src/main/ipc/checks.ts` принимает ветку Ticket-а в
  каждом. `src/renderer/canvas/actions/OpenPr.tsx` предлагает каждый PR через `ActionMenu`.
  `src/renderer/canvas/nodes/TicketNode.tsx` рисует chip. `epic-layout.ts` и `ticket-card.ts` (`checkRowsHeight`) дают
  карточке место для него и для строк badge-ей, посчитанных так же, как они рисуются.
- `harness/bin/project-connect`: проверка и запись. `harness/bin/silent-check`, `harness/hooks/guard.mjs`: следы и отказ.
  `harness/hooks/session-start.mjs`: что сообщают Session. `harness/profiles/README.md`: Profile по полям.

**Поток данных «Add project».**

1. `projects.connect.inspect` отвечает `added`, `new` или `rejected`. Для `added` он уже вызвал `ProjectStore.add`.
2. `projects.connect.draft` проверяет папку и Harness, запускает `project-connect --facts`, стартует Session со схемой черновика
   как structured output и шлёт `projects.connect.activity`. Session — это один запрос через часть oneShot драйвера Claude Code
   (`vendorDriver('claude').oneShot`); её сбой выглядит как «The draft Session failed: » и причина. Ответ проходит
   `--schema-only`, затем `applyChoices`, затем `--check`.
3. `projects.connect.check` запускает `--check` на каждую правку, более старый ответ отбрасывается.
4. `projects.connect.write` запускает `project-connect` без аргументов. Затем папку должен знать `bin/profile -C`, и только после
   этого она добавляется в список. На факты и проверки у скрипта 120 секунд, на запись 30 минут, и при выходе из приложения он
   завершается принудительно.

**Основные тесты.**

- `test/contract/projects-connect.test.ts`: шаги с заменителями и с настоящими скриптами, инструменты Session черновика, лимиты
  времени, attribution в сверке с `bin/profile`.
- `test/contract/profile-draft-session.test.ts`: после черновика и Connect у Project-а нет ни живой Session, ни Session в
  истории, и transcript черновика не существует.
- `test/e2e/projects-connect.spec.ts`: Silent по умолчанию, черновик, форма, Connect, неустановленный Harness, аккаунт.
- `test/e2e/silent-project.spec.ts`: Silent Project и Project над двумя репозиториями в собранном приложении, ничего не записано
  в Workflow folder или репозитории.
- Ticket над двумя репозиториями: `test/unit/pipeline-board.test.tsx` проверяет карточку, её строки, `1/2 merged`, строку release,
  закрытый PR и флаги, которые не обрезаются. `test/unit/checks-badges.test.tsx` проверяет строки badge-ей, а
  `test/unit/canvas-actions.test.tsx` проверяет «Open PR». `test/unit/ticket-card.test.tsx` и `test/unit/epic-card-repos.test.tsx`
  проверяют chip и место на карточке. `test/contract/github-prs.test.ts` проверяет ветку, принятую в каждом репозитории.
- `test/contract/github-accounts.test.ts`: аккаунты, в том числе от gh без `--json`. `test/unit/gh-auth-text.test.ts`:
  текстовый вывод `gh auth status`. `test/unit/temp-folder.test.ts`: правило `%TEMP%`.
- `test/unit/add-project-machine.test.tsx`, `test/unit/folder-browser.test.tsx`, `test/e2e/linked-add-project.spec.ts`:
  «Add project» на Linked machine.

## Project switcher

### Behaviour

**Список.** «Projects» — первая секция rail-а sidebar. Project switcher sidebar её не фильтрует. Строка показывает значок
папки, имя папки и справа ветку в checkout-е: `HEAD`, когда HEAD detached, `—`, когда git не может её прочитать. Tooltip — полный путь. Project, который показывает окно, подсвечен, и
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

- «Project settings…» содержит шаблоны сообщений «Ship ticket», «Run wave», «Process gate queue», «Draft replies», «Fix
  checks», «Resolve conflicts» и «Address comments» с подстановками `{epic}`, `{NN}`, `{wave}`, `{slug}`, `{branch}`,
  `{tickets}`, `{repo}`, `{pr}` и `{sha}`. Неизвестная подстановка показывает ошибку под полем и выключает Save. «Draft
  replies» (`/worfy:pr-reply {repo}#{pr}` с плагином, пустой со старым Harness) — первое сообщение новой Session на Claude Code
  для одного pull request-а: `{repo}` — его `owner/name`, `{pr}` — его номер; подстановка, для которой нет значения, или пустой
  шаблон дают отказ. «Fix checks», «Resolve conflicts» и «Address comments» передают один pull request пользователя Session
  skill-а pr-fix: `/worfy:pr-fix checks {repo}#{pr} {sha}`, `/worfy:pr-fix conflicts {repo}#{pr} {sha}` и
  `/worfy:pr-fix comments {repo}#{pr} {sha}` с плагином, пустые со старым Harness. `{sha}` — head commit pull request-а, ровно
  40 hex-символов; всё остальное даёт отказ действию. По клику worfy заново читает pull request и берёт head из этого чтения.
  Если аккаунт ждёт свой rate limit GitHub или чтение не удалось (сеть, ошибка GitHub), строка и её head остаются последними
  прочитанными; skill сам проверяет head. Клик отклоняется с причиной, когда шаблон пуст, в Project-е работает Autopilot,
  Orchestrator Project-а занят Binding-ом к Epic-у Ticket-а этого pull request-а (его Wave сама чинит свои pull request-ы),
  pull request не пользователя, пришёл из fork-а или закрыт, его причины больше нет (`CI is no longer failing on 3f2a9c1`)
  или экран только для чтения. Текст уходит в Session Node, привязанный (manual или launch) к Ticket-у pull request-а (по его
  строке `PR:` или по ветке), на Claude Code, не в архиве, у которого последняя запись transcript-а моложе 24 часов: worfy
  продолжает эту Session, если у неё нет процесса, отправляет текст или ставит его в очередь, пока идёт ход, и добавляет
  строку `worfy: Fix checks for owner/web#118 sent to this Session`, которую модель не видит. Иначе запускается новый Session
  Node на Claude Code с текстом как первым сообщением, привязанный через launch к Ticket-у, если он есть. Порядок причин на
  кнопке: конфликт (`DIRTY`), затем красный CI, затем запрошенные изменения или thread-ы, которые ждут ответа пользователя.
  «Reset to default» ставит значения по умолчанию из Harness, который сейчас найден на Machine. На Windows в диалоге есть ещё
  [Terminal shell](terminal.md). «Default vendor» (`defaultVendor` в настройках) — Vendor, который «New session» показывает
  первым и на котором работает [Session](sessions.md), запущенная без выбора: None (Claude Code), Claude Code или Codex.
  «None» стирает сохранённый, и тогда по умолчанию Claude Code. Значение, которого эта сборка не знает, читается как
  отсутствующее. [Orchestrator](sessions.md) Project-а работает на нём со следующего запуска: «New Orchestrator Session» или
  следующий запуск worfy. «Ship ticket» работает на Claude Code, что бы ни было выбрано. Linked machine на сборке без этого поля
  сохраняет без него, и сохранённое значение остаётся.
- «Team reviewer» в «Project settings…» показывает ревьюера Project-а голосом его команды: `Not built`,
  `Built <date>, <N> PRs` или `Too little history: <N> of 30`. Его файлы лежат в приватной папке Profile-а,
  `<папка Profile-а>/state/human-review/`. Ревьюер собран, когда там есть его skill, `.claude/skills/human-review/SKILL.md`.
  Дата — `kept_at` из `meta.json`, который пишется, когда человек оставляет результат генератора, иначе `fetched_at`,
  последнее чтение истории, и только без обоих — время записи файла skill-а. `<N> PRs` и короткая история берутся из
  `meta.json` от `review-history`. После обновления, которое человек принял, дата — дата обновления, а к `<N>` добавляются
  прочитанные им pull request-ы (`analysed_pull_requests`), пока полная сборка снова не прочтёт историю. «Build» запускает ту же
  Session, что и предложение, и закрывает диалог. У собранного ревьюера на его месте «Update», которая запускает Session
  напоминания, с `--refresh`. «Delete» сначала спрашивает, затем стирает эту папку и больше ничего. Linked machine только для
  чтения видит состояние без кнопок. Собранный ревьюер доступен как `/human-review` в каждой Session Claude Code Project-а, за
  которой сидит человек: в Orchestrator-е, «New session», «Ship ticket» и Product Session. Каждый запуск читает папку Profile-а
  и добавляет приватную папку как дополнительную после папки Card-ов. `skills.allowed` её не убирает. Session Autopilot-а,
  Session черновика «Add project» и Session Codex его никогда не получают (ADR-0102). Вся Feature — [Team
  reviewer](human-review.md).
- «Code stories for PRs» в «Project settings…» — переключатель поля Profile-а `code_stories.pr`: если он включён, implementer
  должен написать Code story (короткий пошаговый рассказ об изменении) к PR каждого тикета. Поле принадлежит Profile-у, потому
  что Harness читает только Profile. Profile без него читается как включённый. Клик сразу, без Save, пишет `"on"` или `"off"`
  через `harness/bin/profile-set --field code_stories.pr`, и только пока у Profile-а то значение, которое прочёл переключатель.
  Если оно изменилось, ничего не записывается: диалог говорит об этом и показывает Profile, каким он стал. Любой другой отказ
  виден под переключателем. Linked machine только для чтения видит значение с неактивным переключателем. Когда он включён,
  implementer пишет story до PR и проверяет её через `harness/bin/story-check` (`harness/skills/ship-ticket/story-pr.md`), а
  `harness/bin/land` не вливает PR тикета без его story или с красной её проверкой; когда выключен, ни того, ни другого нет. В
  обоих случаях после merge PR документов от `land` добавляет к story тикета шаг «What review found and what remains»:
  сохранённый verdict ревью, процитированный как есть, и строки влитого head-а, которые он называет, без вызова модели
  (`harness/skills/epic-wave/SKILL.md`, «The review step of the Code story»). Когда файл состояния `land` содержит последний PR
  Epic-а с кодом (`land --epic-story`; тикет приёмки владельцем не считается), агент Orchestrator-а собирает story Epic-а, и PR
  документов этого merge несёт её как `<epic>/story.md` (в Silent mode она идёт в Workflow folder;
  `harness/skills/epic-wave/SKILL.md`, «The epic story»).
- «Edit profile…» в «Project settings…» открывает Profile Project-а формой поверх диалога. В ней поля шага Review из «Add
  project» и те, которых там нет: title, команды, путь тикета, spec, раздел файлов, раздел «готово», ветка, finish,
  `parallel`, линзы ревью и тикета, MCP servers, разрешённые skills, GitHub account, папка ADR, метка статуса ADR, feature
  pages, glossary, файл состояния, три языка, attribution и четыре поля worktree. Имя, `mode` и Workflow folder видны текстом:
  mode и папка — «Changed by moving the workflow files», а под ними кнопка переноса («Перенос между режимами» выше). Записей Gate registry и `rules.md` в форме нет. Каждую правку Harness
  проверяет правилами схемы черновика (`harness/profiles/draft.schema.json`); отказ виден под его полем и выключает Save.
  Очищенные `verify` и путь тикета уходят пустым текстом, а не «нет значения», поэтому они отклоняются так же, как путь тикета
  без `NN` и неизвестный finish. Save пишет поля через `harness/bin/profile-set`, с
  commit-ом в git папки Harness, и только пока Profile такой, каким форма его прочла. Если он изменился, Save отказывает с
  «The profile changed since you opened it», и форма показывает Profile, каким он стал. «Change account…» открывает шаг GitHub
  account из «Add project»: аккаунты gh с правом push, аккаунт Profile-а отмечен, пока gh его знает. Загрузка списка ничего не
  меняет: аккаунт и его finish задаёт только выбор в списке, а Save ждёт, пока аккаунты загружаются. Поле-список, которого в
  Profile нет, оставленное пустым, так и остаётся без значения; поле, которое есть, после очистки пишется пустым списком, а для
  MCP servers и разрешённых skills это «ни одного». Под «MCP servers» у каждого имени списка стоит его статус в той Session
  Project-а на этой Machine, его Orchestrator-е или Session Node, чьи строки пришли в это окно последними; у имени, которого в этой Session нет, статуса нет,
  а без такой Session или у Project-а Linked machine не показано ничего. Connector claude.ai, которого popover Session может
  не перечислить, разрешают, вписав его имя в этот список ([MCP servers of a Session](mcp-servers.md)). Project Linked
  machine и Project с доступом только на чтение показывают форму без Save: Profile пишется только на своей машине.
- «Process gate queue» есть только тогда, когда роль Project-а в межмашинной очереди Gate — `serve`. Пункт отправляет шаблон
  Orchestrator-у Project-а.
- «Remove from list» действует сразу, без вопроса. Project уходит из списка. Если он был активным, активным становится первый из
  оставшихся или никакой. Его папка данных остаётся, поэтому снова добавленный Project найдёт там свои настройки. Его Orchestrator
  закрывается, как и shell-ы его [Terminal](terminal.md)-ов. Репозиторий и Profile Harness не затрагиваются, поэтому пути
  Project-а остаются в gate registry: повторное подключение той же папки, отдельно или как одного репозитория папки над
  несколькими, отклоняется с «already in the gate registry».
- «Remove project…» есть только в строках этой Machine. Он ещё и убирает Project из Harness этой Machine, чтобы его папки можно
  было подключить снова. Сначала спрашивает диалог. Он перечисляет, что уходит: Profile и его папка, записи gate registry с их
  путями, отметки агентов в `runs/<profile>/`, коллекции qmd, которые называет Profile (коллекция, которую называет другой
  Profile, остаётся), и пустая Workflow folder по умолчанию. Он перечисляет, что остаётся: репозитории и все файлы в них,
  тикеты, spec, ADR и файл состояния в репозитории Full mode, Workflow folder, которую выбрал человек, и настройки Project-а в
  worfy. «Remove project» закрывает Orchestrator Project-а и его Session, останавливает watch worfy на его тикеты и документы,
  запускает `project-connect --remove <profile>`, затем убирает Project из списка и снова включает watch, каким бы ни был ответ.
  Watch останавливается, потому что Workflow folder Silent mode лежит в папке Profile-а, а Windows не даёт переименовать папку,
  пока watch держит папку внутри неё. «Remove from list» в том же диалоге делает то же, что одноимённый пункт меню. Сам worfy
  ничего не удаляет, а Harness никогда не трогает репозиторий.
- «Remove project…» в строке [Demo project](onboarding.md) из Getting started такого диалога не открывает: он запускает
  собственное удаление демо — то же, что у «Remove the demo project», которое спрашивает системным диалогом, удаляет ещё и папку
  демо и даёт Getting started забыть демо. Секция говорит «The demo project was removed.» или причину, по которой он не удалён.
- «Remove project…» отказывает до того, как что-либо закроется, и ничего не удаляет, когда Workflow folder по умолчанию у
  Profile-а Silent mode содержит файлы или commit-ы (тикеты проекта): диалог говорит об этом и предлагает «Show in Finder» для
  этой папки, чтобы человек сначала вынес всю папку из папки Profile-а. Он также отказывает для папки, у которой в Harness нет
  Profile-а; для Profile-а в старой папке Harness `~/.claude/profiles/`, куда `project-connect --remove` не смотрит (сначала нужен
  перенос старого Harness в плагин); для Profile-а с «no registry entry of this Profile», у которого нет пути, чтобы его
  освободить; и для репозитория, отдельно стоящего в списке, чей Profile покрывает и другие репозитории: удаление этого
  Profile-а забрало бы и их. Отказ или сбой `project-connect` оставляет Project в списке, и диалог показывает слова скрипта.
  Когда Windows не дала переименовать папку Profile-а (EPERM или EBUSY), диалог добавляет, что папка внутри неё держится
  открытой и что Terminal-ы или программы, которые в ней работают, нужно закрыть перед новой попыткой. Его «no profile»
  считается выполненным, только когда не осталось ни одной записи registry этого Profile-а. Другой Project из списка внутри
  папки удаляемого делит с ним Profile: его Orchestrator держится закрытым на время удаления, а сам он остаётся в списке без
  Profile-а, о чём говорят диалог и notice после удаления. Коллекции qmd, которые остаются (qmd не установлен или их называет
  другой Profile), названы в этом notice. Перенос Project-а между Full mode и Silent mode в это не входит.

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
  `src/main/projects/review-offer.ts`: предложение Team reviewer после добавления, напоминание обновить его (`refreshDue`) и
  состояние и «Delete» в «Team reviewer»; `src/renderer/projects/review-offer.ts`: их toast-ы и напоминание, которое
  запрашивается при каждой активации через `followActiveProject` (`src/renderer/projects/useProjects.ts`).
  `ActionLauncher.buildTeamReviewer` (`src/main/actions/launch.ts`) запускает Session генератора. `privateSkillsFolder`
  (`src/main/vendors/claude/query.ts`) даёт Session папку ревьюера, прочитанную через `readProfileFolder`
  (`src/main/workflow/profile.ts`).
  `src/main/projects/holds.ts`: `ProjectHolds`. `src/main/ipc/linked.ts`: `linked.open` превращает выбор окна в удержание.
- `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts`: каналы и их доступ. `projects.select` — `local`,
  `projects.pickFolder` — `desktop`, а `projects.list`, `projects.remove`, `projects.add` и `projects.hold` — `project`.
  `projects.removal.preview`, `projects.removeProject` и `projects.removal.reveal` («Remove project…») — `local`: Linked
  machine никогда не удаляет Project из Harness этой Machine.
- `src/main/projects/remove.ts`: «Remove project…», его предпросмотр, проверки перед ним и порядок его шагов;
  `src/renderer/projects/RemoveProject.tsx`: его диалог.
- `src/main/agent/app-orchestrators.ts`: следует за `onChange` и удержаниями и закрывает Orchestrator удалённого Project-а.
- `src/renderer/projects/useProjects.ts`: копия renderer-а, `openProject` как единственный способ открыть Project, `groupProjects`
  для Machine и `useReadOnly`.
- `src/renderer/shell/sidebar/ProjectsSection.tsx`: секция и меню. `src/renderer/shell/ProjectSettings.tsx`: диалог настроек.
  `src/renderer/projects/read-only.ts`: как выглядит неактивное действие записи.
- `src/renderer/projects/EditProfile.tsx`: «Edit profile». `src/renderer/projects/ProfileFields.tsx` и
  `src/renderer/projects/profile-fields.ts`: поля, общие с шагом Review из «Add project».
  `src/main/ipc/profile-edit.ts`, `src/shared/ipc/profile-edit.ts`: `profileEdit.read`, `profileEdit.check` и
  `profileEdit.write` поверх `bin/profile-set --field`: чтение и проверка — каналы чтения `project`, запись — `local`, как
  `pipeline.write`, поэтому Linked machine читает Profile и никогда его не пишет. `profileEdit.move`, тоже `local`, проверяет
  работающие Session и запускает `bin/profile-set --move`; `src/renderer/projects/MoveWorkflow.tsx` — его кнопка и
  подтверждение. `harness/lib/workflow-move.cjs`: план, проверки, копирование, commit-ы и откат переноса.
- `src/renderer/palette/commands.ts`: «Switch to project». `src/renderer/pipeline/open.ts`,
  `src/renderer/canvas/overlays/NotificationTarget.tsx`: другие пути к `openProject`.

**Поток данных переключения.** `openProject` вызывает `projects.select` на этой Machine. `ProjectStore.select` фиксирует выбор, и
срабатывают его listeners: `projects.changed` идёт всем клиентам, `src/main/ipc/docs.ts` переносит удерживаемые документы, и
открывается Orchestrator нового Project-а. Renderer принимает ответ через `acceptProjectsState`.

**Основные тесты.**

- `test/contract/projects.test.ts`: добавление, выбор, удаление, сохранение, настройки, нетронутый репозиторий, `projects.browse`,
  вызовы с Linked machine, Project-ы, локальные для Machine, и Team reviewer: предложение по ответу probe, `humanReview.offer`,
  состояние и «Delete», а также напоминание обновить его раз в 30 дней с «Update».
- `test/e2e/projects.spec.ts`: добавление, переключение, настройки, перезапуск и удаление в собранном приложении, сломанный
  `projects.json` и предложение Team reviewer с «Later» и «Build».
- `test/unit/use-projects.test.tsx`: revision, группы по Machine, окна на Linked machine.
- `test/unit/edit-profile.test.tsx`: значения формы, отказ под своим полем, отклонённый fingerprint, шаг аккаунта.
  `test/contract/profile-edit.test.ts`: каналы поверх настоящего `bin/profile-set` и поверх его заменителя.
  `test/e2e/edit-profile.spec.ts`: форма в собранном приложении. `harness/bin/tests/profile-set.test.sh`: `--field` любого поля.
  `test/contract/profile-move.test.ts`: `profileEdit.move` поверх настоящего `bin/profile-set --move` в обе стороны, работающая
  Session, отказы и откат. `harness/bin/tests/profile-set-move.test.sh`: сам `--move`, с каждым отказом и сбоем на каждом шаге.
- `test/contract/projects-remove.test.ts`: «Remove project…» поверх настоящих `bin/profile` и `bin/project-connect` во временном
  Harness home: что уходит, что остаётся, отказы и повторное подключение тех же папок; с настоящими hub-ами Ticket-ов и
  документов — удаление Silent Project-а под watch-ем при Harness, который отказывает, как Windows, пока watch держит Workflow
  folder. `test/unit/remove-project.test.tsx`: его диалог. `test/e2e/projects-connect.spec.ts`: подключение, удаление и повторное
  подключение в собранном приложении. `harness/bin/tests/project-connect.test.sh`: `--remove`, затем повторное подключение тех же
  путей.
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

**Секция ADR.** Она в rail-е sidebar после Epic-ов, с числом ADR в заголовке. Она показывает ADR активного Project-а, что бы
ни говорил Project switcher sidebar. Строка показывает номер, заголовок и статус, сортировка по номеру. Заголовок — первый
заголовок `# `, а без него имя файла. Статус — то, что идёт после метки статуса, без точки в конце, и ищется он в первых 20 строках. Метка — `docs.adr_status_label` из Profile, а без неё `Status`; старая `Статус` тоже читается. У файла
без такой строки статуса нет.

Без ADR секция говорит «No ADRs in docs/adr/». Добавленный или удалённый файл меняет список без перезагрузки.

**ADR panel.** Клик по строке открывает ADR поверх Canvas справа, шириной не больше 680 пикселей, с номером, заголовком и статусом в
заголовке панели. Esc или Close закрывают её. Изменение файла видно в открытой панели, исчезнувший ADR скрывает её, пока файл не вернётся, а другой Project
её не показывает. «Go to» в Command palette перечисляет каждый ADR по заголовку и находит его и по номеру (`12`, `0012`, `adr 0012`).
При скрытом sidebar такой запрос ждёт, пока sidebar покажут, и выполняется один раз.

**«Open in Editor»** передаёт файл приложению, которое система назначила для него. Идёт по пути относительно корня Project-а.

**Текст обоих.** Один markdown renderer с таблицами, списками задач и зачёркиванием. Сырой HTML показывается как текст и никогда не
выполняется. Изображения не загружаются: показывается alt-текст. Ссылки `http://` и `https://` открываются в браузере по
умолчанию, никогда не в окне, а относительная ссылка открывает файл Project-а в редакторе по умолчанию. Абсолютный путь
открывается так же, когда лежит внутри Project-а, одного из его worktree, Workflow folder или корня Ticket-ов; в другом месте он
ничего не открывает. Ссылка на файл, который не является документом, сначала спрашивает: открыть его, показать в файловом
менеджере или отменить. Любая другая ссылка (`javascript:`, `file:`, `data:`, `mailto:`) — просто текст и ничего не открывает.

**Ссылки в тексте.** Голый адрес `http://`, `https://` или `www.` тоже ссылка; знаки препинания и закрывающая кавычка или
ёлочка после него (`).`, `»`, `”`, `…`) остаются вне ссылки, а адрес внутри code span или блока кода ссылкой не становится.
Ссылка выделяется в тексте: цвет ссылки / акцента (`#0062CC` в светлой теме, `#C8F25A` в тёмной), средняя насыщенность шрифта,
тонкое подчёркивание в 45 % этого цвета, которое становится сплошным под указателем и при фокусе с клавиатуры, и общее
акцентное кольцо фокуса. Тот же renderer рисует ответы Claude в Session view и на Canvas, поэтому их ссылки выглядят и
открываются так же.

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
Project-а. «Open in Editor» и ссылки на файлы показывают `File is on <Machine>` вместо открытия, а ссылка `http://` или
`https://` открывается на той Machine, где по ней кликнули.

### How it works

- **Только чтение по устройству** ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md),
  [ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). `docs.read` выдаёт только эти файлы: путь разрешается вместе с символическими
  ссылками и после этого должен быть `HANDOFF.md` в корне или ADR прямо в `docs/adr` того же корня. Текст HANDOFF никогда не копируется
  в Layout.
- **Один watch на Project.** Один рекурсивный `fs.watch` корня общий для всех, кто открыл документы, и он останавливается, когда уходит
  последний. События по другим путям отбрасываются по имени до всякого чтения. Чтение идёт через 50 мс после последнего события, и
  состояние отправляется, только когда что-то изменилось. Поток событий начинается чуть позже создания watch, поэтому чтения на 100,
  400 и 1000 мс подбирают то, что изменилось в этот момент.
- **Тот же watch следит за темами Product Session** ([ADR-0101](../../adr/0101-product-session-folder-and-mind-map.md)):
  `docs/product/<topic>/` в Full mode, `<Workflow folder>/product/<topic>/` в Silent mode. Изменение файлов темы читает эту
  тему через 50 мс после её последнего события и шлёт `product.changed` с темой, какой она читается сейчас, или `null`, если её
  папки нет, тем окнам, у которых открыты документы Project-а. HANDOFF и ADR ради этого заново не читаются, и `docs.changed` не
  уходит. Чтения одной темы идут по одному, поэтому последнее событие несёт последнее содержимое. `product.topic` читает тему по
  запросу в той же очереди. Изменение самой папки Product Session или корня заново читает уже известные темы; `critic/` и имена,
  которые не являются именами тем, отбрасываются.
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
- `src/shared/ipc/product.ts`, `src/main/ipc/product.ts`: `product.topic`, `product.changed` и `product.share` (доля принятых
  советов, [sessions](sessions.md)). `src/renderer/product/useMindMap.ts`: одна тема в актуальном виде; он держит документы
  Project-а открытыми через `useDocs`.
- `src/renderer/canvas/nodes/HandoffNode.tsx`: Node. `src/renderer/shell/sidebar/AdrSection.tsx`: секция и панель.
- `src/renderer/markdown/Markdown.tsx`, `src/renderer/markdown/links.ts`, `src/renderer/markdown/autolink-edges.ts`,
  `src/renderer/markdown/markdown.css`: renderer, то, куда ведёт ссылка, где кончается голый адрес и как выглядит ссылка.
- `src/main/ipc/shell.ts`: `shell.openInEditor` и `shell.openExternal` (только `http:` и `https:`).
  `src/renderer/machines/useFileElsewhere.ts`: `File is on <Machine>`.
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
- `test/contract/product-watch.test.ts`: темы Product Session в обоих режимах, две быстрые записи, папка Product Session,
  удалённая целиком.
- `test/unit/docs-remote-links.test.ts`: правила для сетевых папок, под путями Windows на любой системе.
