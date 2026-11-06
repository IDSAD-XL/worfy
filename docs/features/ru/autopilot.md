# Autopilot

> Перевод [английской версии](../autopilot.md), commit `19f1660c`.

Autopilot ведёт Wave-ы одного Epic-а одну за другой, без человека у Orchestrator-а. Он отправляет Wave, ждёт её конца,
отправляет следующую готовую Wave и останавливается, когда готовой Wave нет или что-то пошло не так. Один такой проход
по Epic-у называется **run**. Если термины незнакомы, начните с [Concepts](concepts.md).

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
со ссылкой «change in Modes» на меню Modes Orchestrator-а. Эти факты main читает по каналу `autopilot.prepare`, из тех же
источников и с теми же строками прогноза, что и диалог `autopilot_start`. Ниже человек выбирает Run mode: Fastest,
Budget-aware или Start window; режим по умолчанию из Settings → Autopilot помечен «(default)» и выбран. Фокус стоит на
**Cancel**, Esc — это Cancel, ⌘↩ (Ctrl+Enter на Windows) — главная кнопка. Главная кнопка — **Start Autopilot**, а пока
Orchestrator занят — **Start when free**; окно тогда говорит, чем он занят. Окно закрывается, как только main ответил;
отказ — это toast и tooltip кнопки, как сказано ниже. **Start anyway** стартует сразу, в режиме по умолчанию, без окна.

Старт получает отказ, с причиной на кнопке, в таких случаях:

- У Project-а уже есть run. У Project-а не больше одного run-а одновременно.
- Шаблон «Run wave» пуст или в нём нет `{tickets}`.
- У Project-а нет такого Epic-а, или workflow не читается.
- Project — это собственный репозиторий worfy, а сборка development. Считается любой checkout этого репозитория, worktree
  тоже.
- Тот же Epic того же репозитория идёт или стартует на Linked machine либо в другом Project-е этой Machine. Под кнопкой
  появляется chip «running on <Machine>», а рядом кнопка **Start anyway**.

Старт с отказом не пишет journal и не держит экран включённым. «Start anyway» запускает run, хотя оба run-а будут брать
одни и те же Ticket-ы. Другого пути мимо этого отказа нет. Linked machine, которая не подключена или не ответила за
3 секунды, старт не блокирует: chip «on <Machine>» называет её в своём tooltip. Project без remote `origin` никого не
спрашивает.

**Пока Orchestrator занят** — в turn-е, с живыми background task-ами или с сообщениями в очереди — старт не получает
отказ. Run начинается сразу, его journal открывается строками `run-started` и `orchestrator-busy`, а строка состояния говорит
`waiting for the Orchestrator · 4 min`. Первую Wave run отправляет, когда Orchestrator свободен: turn кончился, очередь
пуста, живых background task-ов нет, и за две минуты после конца последней задачи не начался новый turn. Сообщение,
отправленное во время ожидания, ожидание продлевает. Затем проверки из списка выше идут заново: отказ в этот момент
останавливает run с `start-refused` и причиной — в journal и notice-ом в Session, которая просила старт из чата.
keep-awake включается только при настоящем старте. **Stop** (и Force stop) на ожидающем run-е его отменяет:
`start-cancelled`, Orchestrator не трогается. **Start now** (канал `autopilot.startNow`) не ждёт: останавливает turn и
background task-и Orchestrator-а, пишет их в journal как `tasks-killed` с причиной `start-now` и сразу запускает run.
Проверки из списка выше идут и здесь, так что Start now тоже может закончить run с `start-refused`. Кнопки Start now в
окне пока нет: его вызывает только канал main process.
Сообщения очереди run-у не уходят: они возвращаются в Session человека после run-а, придержанными
([ADR-0099](../../adr/0099-run-waits-for-orchestrator.md)).

Сам по себе run не стартует, и после перезапуска приложения тоже.

#### Запуск run-а из чата

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

Любой другой текст после `/worfy:epic-wave` идёт агенту, как и раньше: например «resume after a session break», слово,
которое не является Epic-ом Project-а, аргумент вроде `depth medium` или сообщение с вложениями. Toast говорит, чем
кончилась команда: «Autopilot started on Epic X» или отказ. Пока у Project-а идёт run, отказ такой: «Autopilot is already
running Epic X. Stop it first.» Команда с отказом не пишет journal, и идущий run не считает её вмешательством человека.
Сообщение, отправленное сразу после команды, ждёт её ответа, поэтому попадает в run, который запустила эта команда, и run
пишет его в journal как вмешательство человека. Если Orchestrator занят, в том числе когда команду набрали в его собственной
Session во время turn-а, run ждёт его, как сказано в «Пока Orchestrator занят», а toast говорит «Autopilot waits for the
Orchestrator and starts when it is free». Wave-ы, которые
Autopilot отправляет Orchestrator-у, никогда не читаются как команда.

**Из чата, через агента.** Когда пользователь словами просит Session запустить на autopilot Epic или часть его Ticket-ов,
агент вызывает canvas-инструмент `autopilot_start` с Epic-ом и, если Ticket-ы названы, их номерами. Тогда worfy спрашивает
пользователя в том же окне **Start Autopilot**, что и кнопка, в его виде «Agent asks»: под заголовком —
`Asked by Session "<первые 8 символов id Session>" in a chat · answer within 9:59` и обратный отсчёт 10 минут;
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
набранная в чате, всегда стартует в режиме по умолчанию. Если Orchestrator занят, в том числе когда спрашивающая Session — сам Orchestrator в своём turn-е,
run ждёт его, как сказано в «Пока Orchestrator занят», а агент получает «Autopilot waits for the Orchestrator and starts
when it is free». Без просьбы в окне инструмент отказывает:

- Session, которая работает unattended, например Orchestrator во время run-а: подтвердить некому;
- Session, которую worfy не может найти;
- Project, у которого идёт run: «Autopilot is already running Epic X. Stop it first.», и в journal ничего не попадает;
- Epic или Ticket, которого у Project-а нет, или workflow, который не читается;
- второй вызов, пока ждёт просьба того же Project-а;
- Machine без открытого окна worfy;
- окно Start Autopilot, уже открытое для другого старта: агенту говорят об этом.

**Что не является run-ом.** «Run wave» на Canvas или в Command palette отправляет Orchestrator-у одну Wave и run не
запускает. Так же и Wave, которую Claude Code ведёт в терминале. У такой Wave нет journal, строки состояния, toast-а
остановки и Run history.

#### Во время run-а

Строка над кнопкой показывает состояние run-а:

| Строка состояния | Значение |
|---|---|
| `starting` | Run начался, Wave ещё не ушла. |
| `waiting for the Orchestrator · 4 min` | Run начался и ждёт, пока у Orchestrator-а кончатся turn, очередь и background task-и. В первую минуту — без минут. |
| `Wave 2 · running` | Run отправил вторую Wave. Wave считаются внутри run-а с 1, это не номер Wave в плане Epic-а. |
| `Wave 2 · 4 background tasks` | То же, и у Orchestrator-а четыре живых background task-а. |
| `waiting for limits · resumes 14:20` | Limits отказали turn-у. Run продолжит в это время. |
| `today's share used · resumes 00:00` | Бюджет остановил следующую Wave. |
| `5-hour limits full · resumes 02:12` | Бюджет остановил следующую Wave: доля дня осталась, окно на 5 часов заполнено. |
| `outside start window · resumes 23:00` | Run mode — Start window, и окно не открыто. Run продолжит, когда оно откроется. |
| `wave too long for window · resumes 23:00` | Run mode — Start window: следующая Wave обычно идёт дольше, чем осталось от окна. |
| `stopping · 2 tickets in work` | Пришёл Stop. Два Ticket-а текущей Wave в работе. Если таких нет, строка говорит `stopping`. |
| `stopped: no ready wave` | Run окончен, с причиной (см. ниже). |
| `stopped: turn error · 2 background tasks still run` | Run окончен и сразу отдал Orchestrator человеку; две его фоновые задачи ещё идут там. |

Пока идёт run:

- Orchestrator работает **unattended**. Он идёт в режиме `bypassPermissions`, какой бы режим ни был сохранён в Node. В
  смене режима разрешений отказано. Когда run кончается, Node получает свои настройки обратно.
- Запрос разрешения, вопрос с вариантами ответа и `session.ask` от Card сразу получают отказ: отвечать некому. Каждый
  отказ идёт в journal. Если Claude Code назвал причину запроса разрешения, модель получает эту причину и может изменить
  команду.
- Auto-approval mode Project-а меняет судьбу запроса разрешения на обоих Vendor-ах. Mode читается при каждом запросе,
  поэтому переключение действует со следующего. Off: как выше. Shadow: approval policy оценивает запрос, journal получает
  строку `auto-approval` с тем, что policy сделала бы (`would-allow`, `would-deny`, `would-park`), и rule, а модель
  по-прежнему получает отказ, как при Off. On: решение policy и есть ответ. Разрешённый запрос выполняется,
  запрещённый получает отказ с hint-ом rule, hard deny получает отказ всегда. Запрос, который может решить только
  человек, уходит в park: он открывается на Session Orchestrator-а как permission card с rule и путями, с Allow и Deny,
  но без Always allow, так что один ответ покрывает один запрос. Во время собственного turn-а Orchestrator-а Session
  показывает, что ей нужно разрешение; запрос в park от background task-а оставляет Session в покое, если она idle.
  Уходит notification «Parked: `<tool>` in `<folder name>`», остальные Subagent-ы продолжают работу. Ответ владельца —
  это ответ агенту. Без ответа за 60 минут, или когда run останавливается, запрос получает отказ с hint-ом. Пока run
  останавливается, запрос не уходит в park, а сразу получает отказ. Запрос в park не даёт считать его background task
  зависшим. Journal получает `park`, когда запрос уходит в park, затем `park-answered` или `park-expired`.

  На Orchestrator-е Codex запрос — это approval Codex-а для команды или изменения файла, а ответ — `accept` или
  `decline`. В ответе Codex-а нет текста, поэтому hint rule доходит только до journal. Команда оценивается в папке, которую
  Codex для неё назвал. Codex оборачивает каждую команду в login shell (`/bin/zsh -lc '<script>'`). Ровно эта форма —
  одно слово скрипта в кавычках и ничего после него — оценивается как `zsh -c '<script>'` (login profile принадлежит
  владельцу и лежит вне всех root-ов); любая другая обёртка не одобряется. `shell_environment_policy` Codex-а может
  не передать переменные в shell команды, поэтому worfy закрепляет домашнюю папку и переменные run-а (`TMPDIR` и его
  git-окружение) в shell каждой команды thread-а (`shell_environment_policy.set`). Только у них есть известное значение,
  когда запрос оценивается: команда, которая использует любую другую переменную, в том числе секрет, не одобряется, и
  значение такой переменной не попадает в journal. Изменение файла оценивается по каждому пути, который оно пишет, включая
  новый путь при rename и его `grantRoot`. Запрос с `grantRoot` (запись в папку до конца Session) policy не принимает
  никогда; ввод в идущую команду и запрос доступа к сети уходят в park; ответа «accept for this Session» нет никогда.
  Запрос Codex-а в park ждёт на card так же, как у Claude Code, с Accept, Decline и «Decline and stop the turn»; card
  показывает и причину Codex-а, а для доступа к сети — host. Изменение файла с `grantRoot` в park не предлагает
  Accept: Codex принял бы его как запись в эту папку до конца Session, а агент может спросить снова о каждом файле.
  Выбор владельца — ответ Codex-у, park без выбора заканчивается `decline`. Запрос, который Codex отозвал или который
  Interrupt отменил, пока его оценивают, на Codex не получает строки journal и не уходит в park; на Claude Code строку
  получает каждый оценённый запрос. Unattended Codex работает в Full access, поэтому пока ни о чём не спрашивает.

  Каждый запрос оценивается в окружении, с которым стартовал процесс агента: во всём окружении его shell. Поэтому
  `CDPATH`, `BASH_ENV`, `ZDOTDIR`, `ENV`, `IFS` или переменная `GIT_` в нём делают не одобренной команду, которую они
  меняют. Git читается заново при каждом запросе, который пишет файл или запускает git: в root Project-а и, если у
  worktree может быть свой config (`git config --worktree`, `includeIf`), в checkout-е, где идёт каждая команда git, и в
  каждом worktree Wave. Так видны hook или программа, которые агент с тех пор записал в config git. Если ref-ы
  хранятся в reftable, ветка по умолчанию тоже читается у git. Если git выдаёт config, но не называет папки git
  (ключ-путь без значения, например `core.excludesFile`), они читаются из папки или файла `.git` и его `commondir`, и
  только когда git выдал config этого репозитория; иначе факты считаются неизвестными, и ни запись, ни команда git не
  одобряются. Запись в config-файл, который называет окружение
  (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `XDG_CONFIG_HOME/git/config`), даже пустой, не одобряется никогда, как
  запись в `.git/config`. Запрос, который только читает и не запускает git, git не читает. Git в worktree, чей файл
  `.git` или `commondir` называет другую папку git, а не папку Project-а, или не читается, оценивается как git с
  неизвестными hook-ами: команда, которую может изменить hook или config, не одобряется. Запись в config-файл, который
  читает git, — в том числе в тот, который называют `include.path` или `includeIf`, и ещё до того, как он появился, —
  не одобряется никогда, как запись в `.git/config`.
- В Shadow и On агент run-а (Claude Code или app-server Codex-а) стартует с собственной временной папкой run-а как
  `TMPDIR` (`<data folder>/autopilot-tmp/<run>`) и с git-окружением. `GIT_CONFIG_PARAMETERS` выключает
  `log.showSignature` и `format.pretty` владельца и не даёт git открыть bare repository выше папки, а
  `GIT_NO_LAZY_FETCH=1` не даёт partial clone скачивать объекты через `core.sshCommand`, пока в репозитории есть hook-и
  или программы в config. Сами hook-и и фильтры это не останавливает: пока они есть, policy одобряет git только для
  чтения ref-ов и объектов. Агент, процесс которого стартовал без этого окружения (в Off или до того, как в
  репозитории появился hook), не получает одобрения ни на один git. На macOS `mktemp -d` не смотрит на `TMPDIR`, и
  папка, которую он создаёт, лежит вне всех root-ов; `mkdir -p "$TMPDIR/<name>"` одобряется, и hint отказа в домашней
  папке называет эту форму. В Off агент стартует как раньше, без того и другого. Папка удаляется, когда run
  кончается; у run-а, который не смог запустить свою policy, её нет. Session, которую забрал другой run, сохраняет
  свою папку, как и после падения или выхода из приложения; такие папки удаляются при следующем запуске worfy.
- «Run wave» и «Process gate queue» вручную и «New conversation» у Orchestrator-а получают отказ.
- Человек по-прежнему может написать Orchestrator-у. То, что человек делает с его Session через worfy, идёт в journal как
  `human-input`: сообщение, сообщение от Card, Interrupt, «Send queued», удаление сообщения из очереди, смена настроек, в
  том числе та, в которой отказано. «Run wave», «Process gate queue» и «New conversation», получившие отказ, строки не
  пишут, и действия в других Session тоже.
- Interrupt turn-а Wave завершает run с причиной `interrupted`.
- Session использует только Browser profile с отметкой «Available to Autopilot», при открытии Browser обязана назвать
  Ticket этого Epic-а и никогда не входит в аккаунт. Подробности — на [странице Browser](browser.md).
- worfy просит систему держать экран включённым от начала run-а до конца, в том числе во время ожиданий, описанных ниже.
- Если есть Linked machines, chip «on <Machine>» под кнопкой говорит, какая Machine ведёт run. Linked machine с полным
  доступом может запускать и останавливать run. С доступом read-only она видит состояние, а её кнопки неактивны. Run
  всегда выполняется на Machine Project-а.
- Когда в `main` собственного репозитория worfy в Harness есть изменения, которых нет в этой сборке, под кнопкой стоит
  chip «Harness in main is newer than the Stable copy», с run-ом и без него. Run продолжается как есть.

#### Auto-approval

Auto-approval решает, что worfy отвечает, когда агент run-а просит разрешения. Он задаётся для Project-а на Machine
Project-а, в меню Modes Orchestrator-а ([Sessions](sessions.md)), и стоит в Off, пока его не задали. Mode хранится в
собственном `app-settings.json` worfy, а не в Profile, который агент мог бы поменять сам. Пока worfy запущен с debugging
port или открытым Node inspector, действует Off, что бы ни было сохранено. Run читает mode при каждом запросе.

| Mode | Что получает агент | Что получает journal |
|---|---|---|
| Off | Отказ unattended Session, как без Auto-approval. Policy не спрашивается. | `refused-dialog` |
| Shadow | Тот же отказ, что при Off: без hint-а и без park. | `auto-approval` с тем, что policy сделала бы: `would-allow`, `would-deny`, `would-park` или `hard-deny`. |
| On | Решение policy (ниже). | `auto-approval` с `allow`, `deny`, `park` или `hard-deny`; у park, когда он кончается, ещё `park-answered` или `park-expired`. |

Approval policy оценивает каждый запрос в заданном порядке и даёт один исход с rule, которое его решило:

- **deny с hint-ом**: агент может переписать запрос. Вопрос с вариантами ответа — всегда этот исход («реши по правилам
  Project-а или запиши вопрос в вопросы владельцу Ticket-а»); он же — для команды, которую policy не может прочитать
  целиком (подстановка команды в цели, `eval`, цикл с целью-переменной, переменная без известного значения), для
  symbolic link на пути, удаления целого root-а и записи в config, hooks или attributes git. Чего policy не прочитала,
  того она не разрешает никогда. Hint — постоянный текст rule, никогда не кусок запроса.
- **allow**: каждая цель внутри root-ов run-а — worktree-ов Ticket-ов текущей Wave, `.scratch` Project-а, собственной
  временной папки run-а и scratchpad Session, — и каждое действие проходит одно из allow-rule: файловые программы внутри
  root-ов без сети, скрипт `sh`/`bash`/`zsh -c`, каждое действие которого проходит другое rule, git в worktree Wave без
  push и без удаления ветки, а также Edit, Write, MultiEdit, NotebookEdit (Claude Code) или изменение файла (Codex)
  внутри root-ов. Push не одобряется никогда.
- **park**: запрос разобран, но решить его может только человек — например, push или tool, которого policy не знает.
  Запрос ждёт на Session Orchestrator-а не дольше 60 минут, как описано в разделе [Во время run-а](#во-время-run-а).
- **hard deny**: отказ в любом mode, его не снимает никакой ответ. Секреты и настройки домашней папки (`~/.claude`,
  `~/.codex`, `~/.ssh`, `~/.gnupg`, `~/.config/gh`, `~/.gitconfig`, `~/.config/git`, `~/.npmrc`, файлы shell rc,
  `~/Library`), `%APPDATA%` и папка данных worfy (кроме временной папки run-а) — на запись, удаление и чтение; запись в
  Harness home, в папки других живых Session и в другие worktree; программы, которые меняют настройки системы или
  приложений (`sudo`, `launchctl`, `security`, `crontab`, `defaults write` и подобные); `chmod` и `chown` вне root-ов;
  force push, push с удалением, push в ветку по умолчанию или в ветку другого worktree, а также удаление, checkout и
  commit в такой ветке; запуск скачанного (`curl … | sh`); отправка наружу файла вне root-ов.

Policy видит только те запросы, которые агент задаёт. В `bypassPermissions` Claude Code исполняет большинство команд
без вопроса, поэтому Auto-approval не делает run опаснее, чем `bypassPermissions`: он только говорит «да» части того, что
раньше получало «нет». Решение и его причины записаны в [ADR-0098](../../adr/0098-approval-policy.md).

Где смотреть решения: Run history показывает их в блоке Auto-approval, со счётчиками, а в Shadow — с решениями Shadow
всех run-ов Project-а ([Flight Recorder](../flight-recorder.md#the-auto-approval-block)). Когда run окончен, чат
Orchestrator-а получает одну строку: `Auto-approval: allowed 3, denied 1, parked 0` или `Shadow: would allow 2, would
deny 1, would park 0`. Переключить Shadow на On может только владелец: сам worfy mode не меняет.

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
срок заново. Когда последний task закончился, run ждёт до 2 минут turn, который запускает его task-notification, а затем
оценивает Wave без этого turn-а.

Каждая Wave после первой в run-е идёт в новую SDK session Orchestrator-а, чтобы контекст не рос от Wave к Wave. Её первый
prompt ещё и велит Orchestrator-у выполнить `wave-brief <epic>`. Wave остаётся в текущей session, когда Orchestrator не
свободен (turn, живой task или сообщение в очереди), когда вышло время ожидания последнего turn-а, и со старым Harness, где
нет `wave-brief`.

#### Ожидание Limits

Когда Limits отказывают turn-у Wave, Wave не заканчивается. Run ждёт, пока сбросится отказавшее окно, плюс 2 минуты. Если
время сброса неизвестно, он пробует снова каждые 30 минут. Если ожидание превысило бы 24 часа от первого отказа, run
останавливается с `limits-timeout`. Окно — то, что назвал отказ, иначе самое позднее отказавшее окно, известное worfy;
от окна `five_hour` ничего не зависит: на плане без него run ждёт недельное окно.

С включённым для Project-а Auto-continue известный сброс дальше 24 часов run не останавливает: он ждёт до сброса,
например 3 дня для недельного окна. Пока до продолжения больше 24 часов, не идёт turn и не жив ни один background task,
run отпускает keep-awake ([ADR-0097](../../adr/0097-far-limits-wait-releases-keep-awake.md)): экран может погаснуть, macOS
может его заблокировать, Mac может уснуть. keep-awake возвращается за 24 часа до продолжения и сразу, как начинается
turn или background task. Если Mac проспал сброс, run продолжает при первом пробуждении. Заблокированный экран остаётся
заблокированным: после продолжения агенты, которым нужно окно (e2e, `gate full`), ждут человека. Выключенный во время
такого ожидания Auto-continue останавливает run сразу с `limits-timeout`, а Stop без идущего turn-а или Stop,
пришедший до отказа, — сразу с `user-stop`. После продолжения 24 часа попыток без времени сброса считаются от следующего отказа; этот предел действует
при любом положении переключателя.

Когда время приходит, Orchestrator получает одно сообщение: продолжить с места остановки и сначала добавить запись о паузе
в HANDOFF. Сам worfy эту запись не пишет.

#### Run mode, Start window и бюджет

Каждый run идёт в одном Run mode, который фиксируется на старте: **Fastest**, **Budget-aware** или **Start window**. Перед
каждой Wave, но никогда внутри неё, режим решает, начать следующую Wave сейчас или ждать: дневного бюджета Limits или
Start window. Отказ Limits внутри Wave в любом режиме остаётся жёстким пределом. Режимы, Start window, бюджет и Epic
forecast описаны на странице [Run planning](run-planning.md#run-mode-and-epic-forecast).

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

**Force stop** стоит в меню «⋯» справа от кнопки, пока идёт run этого Epic-а, в том числе во время graceful Stop. Второй
пункт этого меню — **Run history**. Force stop не ждёт. Он прерывает turn (до 15 секунд), закрывает процесс Claude Code, а
с ним все background task-и, отменяет любое ожидание и возвращает Orchestrator человеку. Worktree и ветки остаются.
Сообщение, которое человек поставил в очередь, остаётся и удерживается в очереди новой Session. Wave и сообщение об
остановке из очереди уходят.

Следующий run того же Epic-а берёт Ticket-ы, прерванные Force stop, в свою первую Wave, если они ещё в работе, даже когда
больше ничего не готово. После graceful Stop он их не берёт. Run, который остановился до своей первой Wave, например во
время ожидания Start window, ни одного из этих Ticket-ов не взял, поэтому их всё ещё получит следующий run. worfy хранит
этот список только в памяти, поэтому перезапуск приложения его стирает.

**Выход из приложения** останавливает каждый run с `app-quit`. Выход ждёт до 3 секунд, пока run запишет свой конец.
Orchestrator заново не запускается, а background task-и заканчиваются вместе с приложением.

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

#### Почему run останавливается

| Причина | Значение |
|---|---|
| `no-ready-wave` | Ничего не готово, и ни у одного Ticket-а в `blocked` или без статуса не закрыты все блокеры. Так заканчивается run, который завершил Epic. |
| `tickets-done` | Run по названным Ticket-ам окончен: каждый из них в `done` в checkout. Такой run берёт в каждую Wave только готовые Ticket-ы своего списка. Кнопка всегда запускает весь Epic, поэтому запущенный ею run так никогда не заканчивается. |
| `blocked-tickets` | Ничего открытого не готово, а у Ticket-ов в `blocked` или без статуса все блокеры закрыты. В run-е по названным Ticket-ам считаются только Ticket-ы списка. |
| `no-progress` | Следующая готовая Wave — тот же набор Ticket-ов, что и только что оконченная. |
| `wave-unfinished` | Ticket Wave остался в работе дольше 10 минут после turn-а. |
| `background-stalled` | Background task-и не дали ни одного события за час. |
| `limits-timeout` | Ожидание Limits превысило бы 24 часа (с включённым Auto-continue — только без времени сброса), или Auto-continue выключили во время ожидания сброса дальше 24 часов. |
| `window-too-short` | Run mode — Start window, и следующая Wave обычно идёт дольше, чем всё окно. Tooltip называет Wave, её обычную длительность и окно. |
| `interrupted` | Turn Wave прервали, или прервали turn человека, и Wave осталась удержанной в очереди. |
| `turn-error` | Turn Wave закончился ошибкой, которая не является отказом Limits. |
| `session-error` | Session Orchestrator-а упала. |
| `session-closed` | Session Orchestrator-а закрылась. |
| `send-failed` | «Run wave» не удалось отправить. |
| `workflow-error` | Workflow не прочитался, когда run должен был оценить Wave. |
| `user-stop` | Stop autopilot. |
| `user-force-stop` | Force stop. |
| `start-cancelled` | Stop или Force stop, пока run ждал Orchestrator. |
| `start-refused` | Проверка отказала, когда Orchestrator освободился. Причина — в `message` journal-а. |
| `app-quit` | Выход из приложения. |

Tooltip строки состояния называет ошибку словами, когда она есть.

После любой остановки toast говорит, чем кончился run, с кнопкой **Open history**, а справа от строки состояния до старта
следующего run-а стоит **History**. Обе открывают run в Run history, которую описывает страница
[Flight Recorder](flight-recorder.md).

На Machine с ролью `serve` межмашинного gate перед остановкой с `no-ready-wave` или `blocked-tickets` run отправляет
Orchestrator-у шаблон «Process gate queue», один раз за run. Он следит за этим turn-ом как за turn-ом Wave, а затем
останавливается с той же причиной, даже если turn сделал какой-то Ticket готовым. Stop до этого момента отменяет шаг.

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

**Бюджет, Start window и прогноз.** Как бюджет, Start window и Epic forecast вычисляются по journal-ам run-ов, описано на
странице [Run planning](run-planning.md#how-it-works).

**Один run на Epic и репозиторий.** Один репозиторий на двух Machine — это два Project-а, поэтому ключ run-а — Epic и
нормализованный адрес remote `origin` ([ADR-0053](../../adr/0053-several-screens-on-one-project.md)). Старт считает себя
среди run-ов этой Machine раньше, чем спрашивает. Поэтому, пока обе Machine отвечают, два одновременных старта одного
ключа могут оба получить отказ, но оба не пойдут. Machine, которая не подключена или не ответила за 3 секунды, считается
`unasked`, и тогда оба run-а могут идти. Вопрос идёт независимо от того, включён ли доступ для Linked machines: ответ
несёт только Epic и ключ каждого run-а.

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
| `src/main/autopilot/chat-start.ts` | `ChatStarts.startFromChat`: старт из чата, по Epic-у или по названным Ticket-ам; отказ, пока идёт run, ответ, что run ждёт занятого Orchestrator-а, и notice, если этот run позже получил отказ. Его вызывают команда, набранная в чате, и инструмент `autopilot_start`. |
| `src/shared/autopilot/chat-command.ts` | `parseChatCommand`: какие набранные сообщения являются командой, с каким Epic-ом и Ticket-ами; toast её ответа. |
| `src/shared/workflow/wave-plan.ts` | `parseWavePlan`, `waveTickets`: таблица Waves в `spec.md` Epic-а и ещё не выполненные Ticket-ы Wave N. |
| `src/main/ipc/agent.ts` | `agent.send`: команда не доходит до агента; она запускает run через `startFromChat` и отвечает, чем кончилась. |
| `src/main/autopilot/chat-confirm.ts` | Инструмент `autopilot_start` за canvas server: отказы без просьбы, просьба в окне Start Autopilot этой Machine (`WindowAsks`) и её 10 минут. |
| `src/main/ipc/autopilot-confirm.ts` | Handler `autopilot.confirm.answer`: ответ засчитывается только от окна, которое спросили. |
| `src/shared/autopilot/cycle.ts` | Цикл: фазы, события, эффекты, причины остановки и их сроки. Чистые функции. |
| `src/main/ipc/autopilot.ts` | Обработчики IPC и `sharedAutopilot`, который связывает с run-ом Project-ы, Orchestrator-ы, Session-ы, watch и journal приложения. |
| `src/shared/ipc/autopilot.ts` | Каналы IPC `autopilot`, состояние run-а и текст строки состояния. |
| `src/main/actions/launch.ts` | `autopilotWave`, `autopilotRefusal`, `autopilotGateQueue`: текст из шаблона, отправленный Orchestrator-у. |
| `src/shared/actions/render-template.ts` | `runWaveState`: решение и текст, общие с кнопкой. |
| `src/shared/workflow/waves.ts` | `readyWave`: готовая Wave и пропущенные Ticket-ы. |
| `src/main/agent/orchestrator.ts` | `setUnattended`, `giveBackNow`, `newUnattendedSession` и отказы из-за turn-а, task-ов или очереди. `busy` — чем занят Orchestrator; `takeNow` — Start now. |
| `src/main/agent/session-settings.ts` | Запуск Session и принудительный режим разрешений. |
| `src/main/agent/permissions.ts` | `unattendedCanUseTool`: отказ на каждый запрос. |
| `src/main/agent/session.ts` | `halt` для Force stop, `refuseDialog`. |
| `src/main/autopilot/limits-wait.ts` | Ожидание Limits, таймер по wall clock, текст продолжения. |
| `src/shared/autopilot/resume-at.ts` | Когда run продолжает после отказа. Чистые функции. |
| `src/shared/autopilot/journal.ts` | Формат journal, описанный в комментарии в начале файла, с разбором и записью строки. Чистые функции. |
| `src/main/autopilot/journal.ts` | Файлы journal: открыть, дописать, перечислить, прочитать. |
| `src/main/autopilot/power.ts` | `KeepAwake` поверх `powerSaveBlocker` из Electron. |
| `src/main/autopilot/origin.ts` | Ключ remote `origin`. |
| `src/main/link/autopilot-runs.ts` | Вопрос о run-ах между Linked machines, два служебных сообщения link. |
| `src/main/autopilot/harness-drift.ts` | Новее ли Harness в `main`, чем в этой сборке. Только чтение, без `git fetch`. Только packaged-сборки. |
| `src/main/mcp/browser-server.ts` | Что Session в Autopilot может делать с Browser. |
| `src/main/ipc/card-api.ts` | Отказ `session.ask` от Card для unattended Session. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | Кнопка, меню «⋯», строка состояния и chip-ы. |
| `src/renderer/settings/AutopilotSection.tsx` | Settings → Autopilot. |
| `scripts/install-stable.mjs` | `pnpm install:stable`: Stable copy. |

Модули Run mode, бюджета и Epic forecast перечислены на странице [Run planning](run-planning.md#модули).

#### Поток данных

1. Кнопка вызывает `autopilot.start`. `Autopilot.start` выполняет проверки по порядку: у Project-а нет run-а, отказ для
   собственного репозитория и шаблон, workflow и Epic, затем ключ origin и вопрос к Linked machines.
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
строке есть `at`, `run`, `project`, `epic` и `kind`. Читатель пропускает и считает строку, которую не может прочитать.

| Kind | Когда пишется |
|---|---|
| `run-started` | Run начался. Есть `origin`, а также `override` или `unasked`, когда они применимы. `by` говорит, кто его запустил: `button`, `command` или `tool`. `tickets` называет Ticket-ы run-а по названным Ticket-ам. `mode` — Run mode: `fastest`, `budget-aware` или `start-window`. `autoApproval` — Auto-approval mode на старте, `shadow` или `on`, либо `off`, если policy не смогла запуститься и run шёл как при Off; строка без него — run при Off. |
| `orchestrator-busy` | Run ждёт занятый Orchestrator: `turn`, `queued` (сообщения в очереди) и `tasks`, в начале ожидания и при каждом изменении. |
| `orchestrator-free` | Ожидание Orchestrator-а кончилось; run берёт его сейчас. |
| `harness-behind` | Harness в `main` новее: после `run-started` и перед `wave-started`, когда счётчик изменился. |
| `forecast` | Epic forecast на старте, один раз, после `run-started` и `harness-behind`, перед первой `wave-started`: Run mode, оставшиеся Wave и Ticket-ы, образцы, `low` и `high` (p10 и p90 доли недели, `null` при числе образцов меньше 5), `fit` (сколько Wave помещается до сброса окна на 7 дней с учётом резерва; только когда у run-а есть рекомендация, в Budget-aware или в Start window с включённым бюджетом, иначе `null`), `week` (число окна на 7 дней на старте), p90 длительности Wave с числом её образцов и `window` в Start window. Journal-ы, которые не читаются, дают `samples: 0`; run продолжается. |
| `wave-started`, `wave-finished` | Wave ушла или окончена. В `wave-started` есть отправленный текст, пропущенные Ticket-ы и `session` — id SDK session Orchestrator-а, в которую ушла Wave (имя её transcript-а). В обеих может быть `limits`. |
| `ticket-status` | `Status:` Ticket-а Epic-а этого run-а изменился во время run-а: это видно по изменению, о котором сообщил watch workflow, или при последнем чтении прямо перед `run-stopped` (не при Force stop). Ticket, чей файл появился во время run-а, получает статус, с которым его увидели впервые. Есть `state` (`claimed`, `blocked`, `done`, `open`), а также `statusAt`, `reason` и `waits`, когда у Ticket-а есть такие строки ([ADR-0092](../../adr/0092-run-history.md)). |
| `narrow-round` | Состояние узкого круга исправления в PR Ticket-а Wave, один раз на Ticket и исход. |
| `start-window` | Start window задержал следующую Wave: `reason` — `outside` или `wave-too-long`. Дальше идёт `waiting-until`. |
| `budget-stop` | Бюджет остановил следующую Wave. Дальше идёт `waiting-until`. |
| `limits-hit` | Limits отказали turn-у. |
| `waiting-until`, `resumed` | Ожидание началось или кончилось. |
| `session-error` | Session упала. |
| `refused-dialog` | Unattended Session отказала запросу. Есть Subagent и причина, если они известны, и никогда нет команды. Домашняя папка пишется как `~`. |
| `auto-approval` | Approval policy оценила запрос разрешения в Shadow или On. Есть Session, Subagent, если он известен, Vendor, `mode`, `outcome`, `rule`, инструмент, `targets` и, для команды shell, `command`, обрезанная до 200 символов, с секретами, заменёнными на `***`: значения переменных, опций и ключей JSON с именем секрета, пароли в URL, после `-u` у curl, `-p` у mysql, docker login и sshpass, `password` из `.netrc`, заголовки с именем секрета и известные формы token-ов. Несколько команд, которые только похожи на них, сохраняют свой текст: `sort --key=2`, сообщение `git commit -m "auth: …"`, слово поиска без кавычек или шаблон grep и rg в кавычках из одних букв (`grep -rn password src/`, `rg "apiKey: string"`) и числовой `docker run -u 1000:1000` до имени образа. В каждом из `targets` секреты заменяются так же (`touch <worktree>/ghp_…` даёт target `<worktree>/***`). Домашняя папка пишется как `~`. |
| `human-input` | Вмешался человек. `source` — `worfy` или `observer`. |
| `background-tasks` | Изменился набор живых background task-ов. |
| `run-stopping` | Graceful Stop пришёл во время turn-а или task-ов. |
| `gate-queue` | Run отправил «Process gate queue». |
| `gate-queue-finished` | Turn «Process gate queue» закончился. Дальше идёт `run-stopped`. |
| `run-stopped` | Run окончен, с причиной. `tickets` — для `blocked-tickets` и `user-force-stop`. `lastText` — для остановки из-за отсутствия Wave. `actual` — когда хотя бы одна Wave окончена, в том числе при Force stop и выходе: рост доли окна на 7 дней за Wave run-а (`share`), оконченные Wave (`waves`) и сколько из них учтено (`counted`; Wave с устаревшим числом или со сбросом недели внутри не учитывается). |
| `orchestrator-returned` | Orchestrator снова Session человека, после остановки, которой пришлось ждать, или после Force stop. Остановка по причине самого Run-а, не Stop и не Force stop, отдаёт его сразу, без перезапуска: тогда `tasks` перечисляет фоновые задачи, которые идут дальше в Session человека. |
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
| `test/unit/autopilot-resume-at.test.ts` | Когда run продолжает после отказа. |
| `test/unit/autopilot-journal.test.ts` | Формат journal. |
| `test/unit/autopilot-origin.test.ts` | Ключ origin. |
| `test/unit/autopilot-power.test.ts` | Keep-awake. |
| `test/unit/canvas-actions.test.tsx` | Кнопка, строка состояния и меню «⋯». |
| `test/unit/settings-autopilot.test.tsx` | Settings → Autopilot. |
| `test/unit/install-stable.test.ts` | Скрипт установки Stable copy. |
| `test/contract/autopilot.test.ts` | Весь run: unattended и обратно, отказы, `human-input`, отказ для собственного репозитория, каналы IPC. |
| `test/unit/autopilot-chat-command.test.ts` | Формы команды, набранной в чате, и текст, который командой не является. |
| `test/unit/wave-plan.test.ts` | Обе формы таблицы Waves, диапазоны, выполненные Ticket-ы и отказы. |
| `test/contract/agent-send-autopilot.test.ts` | `agent.send` с командой: старт, отказ, пока идёт run, и то, что всё ещё доходит до агента. |
| `test/e2e/autopilot-chat.spec.ts` | Команда, набранная в Session view и в Session Node: toast-ы и строка состояния. |
| `test/contract/autopilot-background.test.ts` | Background task-и и остановки при живых task-ах. |
| `test/contract/autopilot-start-tool.test.ts` | Инструмент `autopilot_start`: просьба в окне и её ответы, её 10 минут, окно, куда она идёт, отказы без неё, ответ run-а, который ждёт Orchestrator. |
| `test/contract/autopilot-limits.test.ts` | Ожидание Limits и бюджет, с часами, которые двигает test. |
| `test/unit/auto-approve-shell.test.ts` | Разбор shell-команды для Auto-approval: примеры spec-а, каждая конструкция вне грамматики, слова и кавычки, переменные, которые команда точно получает, Git Bash на Windows. |
| `test/contract/auto-approve-shell-sh.test.ts` | Разбор против настоящих shell-ов (sh, bash, dash и zsh, где они есть, Git Bash на Windows): слова, которые он читает, — это слова, которые передаёт shell. |
| `test/unit/auto-approve-policy.test.ts` | Approval policy: hard deny в любом mode, вопросы, команды вне грамматики, каждое allow-rule, атаки из spec-а («удали всё», ссылка на домашнюю папку), config и hooks git, другие worktree и ветка по умолчанию, пути Windows, hint-ы. |
| `test/unit/auto-approve-roots.test.ts` | Root-ы и hard-области: ссылки и glob-ы на диске, папка `mktemp -d`, root-ы, записанные на старте и сдвинутые с тех пор, что приносит с собой копия, формы путей Windows. |
| `test/unit/auto-approve-run.test.ts` | Policy run-а: его git-окружение и что он читает из репозитория, контекст каждого запроса, команда и цели в том виде, в каком их хранит journal, driver Claude по mode, и ни одной записи в Project. |
| `test/unit/auto-approve-park.test.ts` | Park: ожидание на gate, предел 60 минут, остановка run-а (в том числе пока запрос идёт к gate), notification. |
| `test/unit/auto-approve-summary.test.ts` | Решения run-а в его journal, их счётчики для Run history и строка в чате Orchestrator-а в конце run-а. |
| `test/contract/auto-approve-claude.test.ts` | Auto-approval unattended Session Claude Code: Off без изменений байт в байт, Shadow, On, переключение во время run-а, окружение run-а, policy, которая не стартует или бросает исключение, запрос background task-а в park, Stop во время park. |
| `test/contract/auto-approve-codex.test.ts` | То же на Codex поверх fake app-server: Off, Shadow, On, переменные, закреплённые в shell Codex-а, обёртка login shell, запрос, закрытый во время оценки, park и его концы, изменение файла с `grantRoot`. |
| `test/contract/auto-approve-setting.test.ts` | Mode в `app-settings.json`: по Project-ам, мусор читается как Off, запись только через свой канал, правка, сделанная вне worfy, Linked machine, debugging port и inspector. |
| `test/e2e/auto-approve.spec.ts` | Собранное приложение под debugging port Playwright: меню Modes показывает действующий Off с причиной, сохранённый mode читается на старте, ничего не пишется. |
| `test/contract/autopilot-journal.test.ts` | Файлы journal, строка, дописанная снаружи, отсутствие записи вне папки данных. |
| `test/contract/autopilot-wiring.test.ts` | Связка новой session на Wave в `sharedAutopilot`. |
| `test/e2e/autopilot.spec.ts` | Собранное приложение: run, ожидание Limits, бюджет, background task-и, Force stop, узкий круг исправления. |
| `test/e2e/linked-autopilot.spec.ts` | Два связанных приложения: отказ, Start anyway, Stop на двух экранах. |
| `test/e2e/browser-autopilot.spec.ts` | Что Session run-а может делать с Browser. |
| `test/unit/autopilot-invariants.test.ts` | Правила восстановления на journal-ах из `test/fixtures/autopilot-faults/`: хороший run не нарушает ни одного, а каждое правило ловит испорченную для него копию. |
| `test/contract/autopilot-faults-api.test.ts` | Fault scenario-и API модели: API 500, 529 посреди потокового ответа (не принимается за Limits) и обрыв связи останавливают run с `turn-error`, и новый старт шлёт свою команду Wave один раз; Limits, отказавшие ходу Wave 2, — run ждёт и продолжает после сброса одним продолжением, Wave 1 второй раз не идёт. |
| `test/contract/autopilot-faults-process.test.ts` | Fault scenario-и процессов: Claude Code Orchestrator-а умирает, пока работают оба implementer-а (`session-error`, новый старт идёт в новую Session); implementer падает, и его Ticket остаётся `claimed` (`wave-unfinished`) или возвращается в `open` (следующая Wave — только с этим Ticket-ом). |
| `test/contract/autopilot-faults-github.test.ts` | Fault scenario-и на стороне GitHub: режим `hang` у gh stub; gh висит весь run (Wave-ы идут, остановка ждёт не дольше предела последнего чтения); gh отвечает 502 (следующее чтение — через удвоенный интервал); конфликт merge (run останавливается с `blocked-tickets`, новый run не берёт заблокированный Ticket). |
| `test/contract/autopilot-faults-codex.test.ts` | Fault scenario-и на Orchestrator-е Codex: упавший ход останавливает run с `turn-error`; app-server, вышедший посреди Wave, даёт `session-error`, и новый run стартует в новой Session. |
| `test/e2e/autopilot-faults.spec.ts` | Fault scenario-и в собранном приложении: приложение убито SIGKILL посреди Wave и запущено снова (при старте Orchestrator-у ничего не уходит, Run history показывает прошлый run оборванным, кнопка стартует новый run, и тот шлёт свою Wave один раз); GitHub недоступен весь run (обе Wave-ы проходят, `gh` только читали). |

**Fault scenario-и.** Fault scenario — test, который вносит один сбой в run на fake agent над временным Project-ом — ошибку API
модели, умерший процесс, `gh`, который висит или падает, конфликт merge, приложение, убитое посреди Wave, — и потом проверяет правила
восстановления. `checkRecovery` в `test/autopilot-invariants.ts` берёт то, что run оставил: файлы journal, сообщения, которые получил
Orchestrator, вызовы `gh`, изменения `Status:`, которые test записал за Orchestrator-а, и файлы Project-а до и после. Он возвращает по
строке на каждое нарушение, и каждый сценарий ждёт пустой список. Правила:

- **I1.** У каждой `wave-started` ровно одна команда `/epic-wave` с её Ticket-ами, и Wave-ов столько, сколько ждёт сценарий.
- **I2.** Каждый вызов `gh` — чтение: `pr list`, `auth status`, `auth token` или `api` на репозиторий без опции, которая пишет.
- **I3.** У каждого Ticket-а строки `ticket-status` run-а — это изменения его `Status:` за run, по порядку. После Force stop, выхода из
  приложения или в run-е без `run-stopped` (как после убитого приложения) последних изменений может не быть, более ранних — всегда есть.
- **I4.** У run-а сценария один `run-stopped` с ожидаемой причиной, после строки, которая этой причине нужна (например, `session-error`
  перед `turn-error`). Убитое приложение не оставляет `run-stopped`. У run-а, пережившего сбой, есть строка `resumed`.
- **I5.** Человек не вмешивался: нет строк `human-input` и `refused-dialog`.
- **I6.** Новый старт после остановки не получает отказа и начинает свой journal с `run-started`.
- **I7.** worfy ничего не пишет в Project: каждый файл, который изменился, записал test.
- **I8.** Каждая строка каждого journal читается. Убитое приложение может оставить одну оборванную последнюю строку.

Contract-сценарии собирают run через `faultRun()` из `test/contract/autopilot-faults-setup.ts`: настоящие Session registry,
Orchestrators, launcher, journal, `LimitsTracker`, `PrTracker` и `Autopilot`, часы, которые двигаются, только когда их двигает test, и
gh stub из `test/contract/gh-world.ts`. E2e-сценарии готовят Project, папку данных и gh stub через `test/e2e/autopilot-world.ts`.
