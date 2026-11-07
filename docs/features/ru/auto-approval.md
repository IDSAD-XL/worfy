# Auto-approval

> Перевод [английской версии](../auto-approval.md), commit `same-pr`.

Как worfy отвечает на запрос разрешения от агента run-а [Autopilot](autopilot.md): режимы Off, Shadow и On, approval
policy, запрос, который ждёт владельца в park, и где смотреть решения. Если термины незнакомы, начните с
[Concepts](concepts.md).

## Auto-approval

### Behaviour

#### Mode и approval policy

Auto-approval решает, что worfy отвечает, когда агент run-а просит разрешения. Он задаётся для Project-а на Machine
Project-а, в меню Modes Orchestrator-а ([Orchestrator modes](orchestrator-modes.md)), и стоит в Off, пока его не задали. Mode хранится в
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

Где смотреть решения: Run history показывает их в блоке Auto-approval, со счётчиками, а в Shadow — с решениями Shadow
Project-а, накопленными до сих пор ([Flight Recorder](flight-recorder.md#блок-auto-approval)). Когда run окончен, чат
Orchestrator-а получает одну строку: `Auto-approval: allowed 3, denied 1, parked 0` или `Shadow: would allow 2, would
deny 1, would park 0`. Переключить Shadow на On может только владелец: сам worfy mode не меняет.

#### Во время run-а

Пока идёт run:

- Auto-approval mode Project-а меняет судьбу запроса разрешения на обоих Vendor-ах. Mode читается при каждом запросе,
  поэтому переключение действует со следующего. Off: отказ unattended Session, как в
  [Autopilot, Во время run-а](autopilot.md#во-время-run-а). Shadow: approval policy оценивает запрос, journal получает
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
  Когда run окончен, чат Orchestrator-а получает одну строку, которая считает решения run-а. Она приходит при остановке,
  когда ничего не осталось идти, а также когда run отдаёт Orchestrator человеку, пока его turn или background task-и ещё
  идут ([после любой другой остановки](autopilot-faults.md#после-любой-другой-остановки)): их более поздние запросы идут
  к человеку, а не к policy. После Stop autopilot, когда turn или task-и ещё идут, и когда возврат не смог изменить
  Session, строка приходит, как только turn и background task-и run-а закончились и Orchestrator вернулся, приложение
  закрылось или следующий run забрал Session. Запрос этих task-ов после такой остановки оценивает policy run-а, он
  пишется в journal, как во время run-а, и строка его считает; как только следующий run открыл свою policy, запросы
  оценивает она, и они принадлежат следующему run-у. Строка выглядит как `Auto-approval: allowed 3,
  denied 1, parked 0` для On и `Shadow: would allow 2, would deny 1, would park 0` для Shadow, с добавкой `hard-denied N`,
  если был hard deny, и обе, сначала On, если mode переключили во время run-а. Конец park второй раз не считается. Run
  без решений строки не получает. Run history перечисляет решения
  ([Flight Recorder](flight-recorder.md#блок-auto-approval)).
  На Orchestrator-е Codex запрос — это approval Codex-а для команды или изменения файла, а ответ — `accept` или
  `decline`: в ответе Codex-а нет текста, поэтому hint rule доходит только до journal. Команда оценивается в папке,
  которую Codex для неё назвал. Codex оборачивает каждую команду в login shell (`/bin/zsh -lc '<script>'`). Обёртка из
  `zsh`, `bash` или `sh` — по имени или из `/bin`, `/usr/bin`, `/usr/local/bin` или `/opt/homebrew/bin` — с `-lc` или
  `-c` и одним словом скрипта в кавычках, после которого ничего нет (в одинарных кавычках или в двойных, где каждый `$` и
  обратная кавычка экранированы), оценивается как `<shell> -c '<script>'` (login profile принадлежит владельцу и лежит вне
  всех root-ов); любая другая обёртка не одобряется. `shell_environment_policy` Codex-а может не передать переменные в
  shell команды. worfy закрепляет домашнюю папку и переменные run-а (`TMPDIR` и его git-окружение) в shell каждой команды
  thread-а (`shell_environment_policy.set`), но Codex применяет `include_only` владельца после этих закреплений, поэтому
  всё равно может отбросить любую из них. Когда запрос Codex-а оценивается, ни у одной переменной нет известного
  значения: команда, которая использует переменную — в том числе `TMPDIR`, `HOME`, `USERPROFILE` или секрет, — или
  создаёт папку через `mktemp -d` не на macOS, не одобряется, и значение переменной не попадает в journal. `~` в начале
  слова по-прежнему оценивается как `HOME`, с которым стартовал app-server, а bash, zsh и Git Bash без `HOME` берут
  домашнюю папку из базы пользователей системы: считается, что это одна и та же папка (на Windows с собственным `HOME`,
  например `D:\home`, они могут различаться). Git на Codex оценивается как git без git-окружения run-а, поэтому policy
  там не одобряет ни одной команды git и отправляет в park те, которые на Claude Code разрешила бы. Изменение файла
  оценивается по каждому пути, который оно пишет, включая новый путь при rename и его `grantRoot`. Запрос с `grantRoot`
  (запись в папку до конца Session) policy не принимает никогда; ввод в идущую команду и запрос доступа к сети уходят в
  park; ответа «accept for this Session» нет никогда. Запрос Codex-а в park ждёт на card так же, как у Claude Code, с
  Accept, Decline и «Decline and stop the turn»; card показывает и причину Codex-а, а для доступа к сети — host.
  Изменение файла с `grantRoot` в park не предлагает Accept: Codex принял бы его как запись в эту папку до конца Session,
  а агент может спросить снова о каждом файле. Выбор владельца — ответ Codex-у, park без выбора заканчивается
  `decline`. Запрос, который Codex отозвал или который Interrupt отменил, пока его оценивают, на Codex не получает строки
  journal и не уходит в park; на Claude Code строку получает каждый оценённый запрос. Unattended Codex работает в Full
  access, поэтому пока ни о чём не спрашивает. Каждый запрос оценивается в окружении, с которым стартовал процесс
  агента: во всём окружении его shell. Поэтому `CDPATH`, `BASH_ENV`, `ZDOTDIR`, `ENV`, `IFS` или переменная `GIT_` в нём
  делают не одобренной команду, которую они меняют. Git читается заново при каждом запросе, который пишет файл или
  запускает git: в root Project-а и, если у worktree может быть свой config (`git config --worktree`, `includeIf`), в
  checkout-е, где идёт каждая команда git, и в каждом worktree Wave. Так видны hook или программа, которые агент с тех
  пор записал в config git. Если ref-ы хранятся в reftable, ветка по умолчанию тоже читается у git. Если git выдаёт
  config, но не называет папки git (ключ-путь без значения, например `core.excludesFile`), они читаются из папки или
  файла `.git` и его `commondir`, и только когда git выдал config этого репозитория; иначе факты считаются
  неизвестными, и ни запись, ни команда git не одобряются. Запись в config-файл, который называет окружение
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
  папка, которую он создаёт, лежит вне всех root-ов; `mkdir -p "$TMPDIR/<name>"` одобряется (кроме Codex, где ни у
  одной переменной нет известного значения), и hint отказа в домашней папке называет эту форму. В Off агент стартует
  как раньше, без того и другого. Папка удаляется, когда run кончается; у run-а, который не смог запустить свою policy,
  её нет. Session, которую забрал другой run, сохраняет свою папку, как и после падения или выхода из приложения; такие
  папки удаляются при следующем запуске worfy.

### How it works

Policy видит только те запросы, которые агент задаёт. В `bypassPermissions` Claude Code исполняет большинство команд
без вопроса, поэтому Auto-approval не делает run опаснее, чем `bypassPermissions`: он только говорит «да» части того, что
раньше получало «нет». Решение и его причины записаны в [ADR-0098](../../adr/0098-approval-policy.md).

### Implementation

#### Модули

Модули пункта Auto-approval в меню Modes перечислены на странице [Orchestrator modes](orchestrator-modes.md#модули), модули
счётчиков решений run-а — на странице [Flight Recorder](flight-recorder.md#модули).

#### Test-ы

| Test | Что покрывает |
|---|---|
| `test/unit/auto-approve-shell.test.ts` | Разбор shell-команды для Auto-approval: примеры spec-а, каждая конструкция вне грамматики, слова и кавычки, переменные, которые команда точно получает, Git Bash на Windows. |
| `test/contract/auto-approve-shell-sh.test.ts` | Разбор против настоящих shell-ов (sh, bash, dash и zsh, где они есть, Git Bash на Windows): слова, которые он читает, — это слова, которые передаёт shell. |
| `test/unit/auto-approve-policy.test.ts` | Approval policy: hard deny в любом mode, вопросы, команды вне грамматики, каждое allow-rule, атаки из spec-а («удали всё», ссылка на домашнюю папку), config и hooks git, другие worktree и ветка по умолчанию, пути Windows, hint-ы. |
| `test/unit/auto-approve-roots.test.ts` | Root-ы и hard-области: ссылки и glob-ы на диске, папка `mktemp -d`, root-ы, записанные на старте и сдвинутые с тех пор, что приносит с собой копия, формы путей Windows. |
| `test/unit/auto-approve-run.test.ts` | Policy run-а: его git-окружение и что он читает из репозитория, контекст каждого запроса, команда и цели в том виде, в каком их хранит journal, driver Claude по mode, и ни одной записи в Project. |
| `test/unit/auto-approve-park.test.ts` | Park: ожидание на gate, предел 60 минут, остановка run-а (в том числе пока запрос идёт к gate), notification. |
| `test/unit/auto-approve-summary.test.ts` | Решения run-а в его journal, их счётчики для Run history и строка в чате Orchestrator-а в конце run-а. |
| `test/contract/auto-approve-claude.test.ts` | Auto-approval unattended Session Claude Code: Off без изменений байт в байт, Shadow, On, переключение во время run-а, окружение run-а, policy, которая не стартует или бросает исключение, запрос background task-а в park, Stop во время park. |
| `test/contract/auto-approve-codex.test.ts` | То же на Codex поверх fake app-server: Off, Shadow, On, переменные, закреплённые в shell Codex-а, и `include_only` владельца, который может их отбросить, обёртка login shell, запрос, закрытый во время оценки, park и его концы, изменение файла с `grantRoot`. |
| `test/contract/auto-approve-setting.test.ts` | Mode в `app-settings.json`: по Project-ам, мусор читается как Off, запись только через свой канал, правка, сделанная вне worfy, Linked machine, debugging port и inspector. |
| `test/e2e/auto-approve.spec.ts` | Собранное приложение под debugging port Playwright: меню Modes показывает действующий Off с причиной, сохранённый mode читается на старте, ничего не пишется. |
