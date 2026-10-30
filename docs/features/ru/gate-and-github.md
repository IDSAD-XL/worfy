# Gate и GitHub

> Перевод [английской версии](../gate-and-github.md), commit `same-pr`.

Три Feature. **Gate** — проверка, готовы ли изменения в worktree. **Gate full** — полная форма этой проверки и случаи, когда
она нужна. **PR и CI badges** — chip-ы на Ticket-е и Session, которые показывают, что говорят Gate и GitHub. Термины
объяснены в [Concepts](concepts.md).

## Gate

### Behaviour

Gate — одна программа из Harness: `node gate.mjs [<profile>]` в worktree. Она запускает проверки Project-а на том, что
изменилось в этом worktree, и даёт один вердикт. worfy её никогда не запускает и вердикт не пишет: её запускают агенты и
hook-и, а worfy читает результат.

**Кто запускает.** Hook-и `TaskCompleted` и `TeammateIdle` плагина Harness запускают профиль `fast` с пределом 900 секунд.
Skills и агент implementer запускают её вручную с закрытым stdin. Без профиля аргумент — `fast`. Профиль — это `fast`, `full`
или любой другой ключ, который есть у записи registry в `root` или `workspace`. Скрипты за каждым профилем задаются для
Project-а (см. Gate full). `--help` и `-h` печатают usage и завершаются с кодом 0.

**Исходы.** Строку вердикта и exit code нужно читать вместе, потому что код 0 сам по себе не значит green:

| Строка вердикта | Exit code | Исход | Что значит |
|---|---|---|---|
| `[gate] green (<profile>): …` | 0 | `green` | Скрипты прошли, или за них ответил кэш (тогда в строке есть `(cache)`). Это единственный признак green. |
| `[gate] red (<profile>): …` | 2 | `red` | Скрипт упал. Только этот код блокирует hook-и `TaskCompleted` и `TeammateIdle`. |
| `[gate] not verified — environment unavailable:` | 0 | `unverified` | Скрипт упал из-за окружения, а не из-за кода. |
| `[gate] not verified: …` | 3 | `unverified` | Проект не зарегистрирован, registry не читается, упал resolver или сам Gate (в последнем случае worfy нечего читать: вердикта нет). |
| `[gate] nothing ran (<profile>): … This is not green.` | 0 | `none` | Нет изменений, не затронут ни один проверяемый пакет или нет скриптов этого профиля. |

Другие концовки:

- Run, который остановили (SIGHUP, SIGINT, SIGTERM или Ctrl+Break на Windows), завершается с кодом 129, 130, 143 или 149, и
  работа не проверена. Он не пишет ни marker, ни запись кэша, ни вердикт и удаляет вердикт предыдущего run-а. Сигнал в первые
  десятки миллисекунд процесса или во время ожидания stdin завершает процесс с тем же кодом, но прежний вердикт может остаться.
- Неизвестный профиль, в том числе опция вроде `--verbose`, печатает usage и завершается с кодом 2. Ничего не пишет.
- Папка вне git завершается с кодом 0 молча.
- `node gate.mjs`, когда node нет в PATH, падает с кодом 127 до старта Gate. Launcher `gate.sh`, которым пользуются hook-и,
  ищет дальше node версии 18 или новее. Если node нет совсем, он отвечает `[gate] not verified: node not found`. Если каждый найденный
  node старее или не запустился, он отвечает `[gate] not verified: no node 18 or newer: <path> is older or did not start`. Оба случая
  завершаются с кодом 3.

**Red или not verified.** Скрипт с exit code не 0 считается red, если его вывод не показывает отсутствие окружения:
`command not found`, `Cache entry required but missing`, `ENOENT` для пути в `node_modules`, отсутствующий Docker daemon или
container runtime, отказ соединения с портом 5432 или `could not connect to server`. Строка, которая показывает настоящий
run test-ов, важнее этих признаков: `Tests 3 failed`, строка, начинающаяся с `FAIL`, `AssertionError`, `✗` или `Expected … to`,
оставляют такой скрипт red. Скрипт, завершённый сигналом, считается упавшим, и его отчёт называет сигнал. Один red скрипт
делает red весь run, что бы ни сказали остальные. Упавший скрипт не останавливает скрипты после него.

**Что проверяется.** Run, который получил план, печатает строку `[gate] scope` со своим выбором и причиной. Суженный run без изменений отвечает
«nothing ran» без этой строки. Обычно run сужается до файлов, которые отличаются от merge-base с `origin/HEAD` или `origin/main`, включая незакоммиченные и неотслеживаемые файлы.
Переименованный файл считается под обоими путями. Вместо этого run берёт все пакеты в любом из этих случаев:

- Задан `GATE_SCOPE=all`.
- У репозитория нет такой базы или нет merge-base с ней.
- HEAD отсоединён, или не удаётся прочитать, на сколько коммитов ветка впереди и позади.
- Ветка больше чем на 50 коммитов впереди (`GATE_MAX_AHEAD`) или больше чем на 300 позади (`GATE_MAX_BEHIND`).

Суженный run берёт пакеты с изменённым файлом и пакеты, которые от них зависят, транзитивно. Корневые скрипты идут, только
когда `root_if` записи registry совпадает с изменённым путём или когда у записи нет `root_if`. Поэтому при `root_if`, который
не включает документы, изменение одних документов заканчивается как «nothing ran».

**Кэш.** Пакет, у которого прошли все скрипты, запоминается по отпечатку: HEAD, пути пакета и его workspace-зависимостей,
незакоммиченный diff этих путей и содержимое его неотслеживаемых файлов. Тот же отпечаток с теми же скриптами на том же
worktree и профиле получает ответ из кэша, и ничего не запускается. Кэшируется только green, поэтому red скрипт идёт заново всегда.

**Вывод.**

- Когда скрипт заканчивается, Gate печатает `[gate] time (<profile>): <label> <s> s`. Прямо над строкой вердикта он печатает одну
  строку с общим временем, каждым скриптом и скриптами из кэша. Для скрипта из кэша показано время green run-а, который записал
  эту запись.
- Отчёт упавшего скрипта содержит его последние 40 строк под `--- FAILED: <label>`. Для вывода в форме list reporter-а Playwright
  он добавляет блоки падений над этими строками: не больше 60 строк на блок, 200 всего, 500 символов на строку. В конце идёт
  путь к полному log-у.
- Полный вывод каждого скрипта, и green тоже, идёт в файл log-а. Хранятся 10 новейших run-ов каждого worktree, а log-и другого
  worktree, не менявшиеся больше 8 дней, удаляются.
- Файл, который diff переводит с не более чем 1000 строк на больше 1000, печатает
  `[gate] warning: file over 1000 lines: <path> (<before> → <now>)`. Файл, который уже был длиннее, файл, который только
  переместился, бинарный файл, lock-файл и сгенерированный файл предупреждения не получают. Предупреждение больше ни на что не
  влияет, и попадание в кэш печатает его снова.

**Удержание хода.** Hook `Stop` проверок не запускает. Пока последний run в worktree red, он удерживает конец хода и говорит
модели запустить Gate и исправить то, на что тот указывает. Он делает это не больше 2 раз на Session и worktree, и green run
сбрасывает счётчик. После этого он даёт ходу закончиться и один раз говорит, что Gate всё ещё red. Состояние unverified и код 3
ход не удерживают: модель слышит о каждом один раз за Session, о первом — на worktree, о втором — на репозиторий. Сбой внутри
hook-а тоже ничего не удерживает.

#### Windows

На Windows идёт тот же файл. Отличия — в запуске менеджера пакетов:

- Gate ищет программу в Path так же, как cmd.exe, без текущей папки, и запускает её через системный cmd.exe, в отдельной скрытой
  консоли, переключённой на UTF-8.
- Слово, которое нельзя безопасно передать cmd.exe (кавычка, `%`, `!`, `^` или обратный слэш в конце), или worktree в сетевой папке
  в cmd.exe не передаётся. Тогда `.exe` или `.com` запускается напрямую, а `.cmd` или `.bat` не запускается, и это даёт «not verified —
  environment unavailable». Командная строка длиннее 8000 символов не запускается совсем, с тем же результатом.
- `is not recognized as an internal or external command` — ещё один признак отсутствия окружения.
- Сигнал Gate-у завершает cmd.exe и всё под ним через `taskkill /t /f`.
- Файл вердикта, который держит открытым другой процесс, пробуется снова в течение половины секунды. Файл, удержанный дольше, может
  сохранить исход предыдущего run-а.

### How it works

**«Nothing ran» — это не green.** Зелёный badge должен значить, что что-то действительно проверили. Поэтому отсутствие проверки
даёт «nothing ran» и никогда не снимает состояние red. Worktree перестаёт быть red только через run, который что-то проверил, в
том числе через попадание в кэш от green run-а. Правкой документа red не смыть.

**Проект определяется по общему каталогу git.** У всех worktree репозитория один ключ registry, где бы worktree ни лежал. Побеждает
запись с самым длинным префиксом `match`. У каждого worktree есть тег, первые 8 шестнадцатеричных цифр SHA-1 его корня в том
виде, как печатает `git rev-parse --show-toplevel`, поэтому red в одном worktree не удерживает ход в другом.

**Два вида записей.** Marker-ы хранят состояние между run-ами: `red-<key>-<tag>` и `unverified-<key>-<tag>` читают hook `Stop` и worfy,
а `nokey-<kind>-<tag>-<session>` читает hook. Файл вердикта `verdict-<tag>.json` — исход последнего run-а, машинный контракт для worfy,
поля которого не зависят от формулировок строк вердикта: исход, профиль, worktree, ключ, head, exit code, время, причина (одна строка
по-английски для `unverified` и `none`), замеры времени. Run, который дошёл
до того, что знает свой worktree, заменяет файл целиком или удаляет его. Поэтому файл старого run-а остаётся, только когда его
держит открытым другой процесс на Windows или когда run закончился раньше этой точки.

**Launcher.** Команда hook-а, которая называет `node`, упала бы с кодом 127 там, где node нет в PATH, и вердикт прежнего run-а остался
бы. Поэтому hook-и вызывают `gate.sh`, который ищет в PATH, затем в `/opt/homebrew/bin` и `/usr/local/bin`, затем в версиях nvm,
начиная с новейшей: это места, которых не видит hook с голым PATH.

**Остановленный run ничего не пишет.** Gate проверяет, нет ли сигнала ему самому, после каждого дочернего процесса и перед записью
исхода. Пустой ответ убитого `git diff` — не чистое дерево, а скрипт, убитый вместе с Gate, не делает run red. Git или resolver,
которого сигнал завершил в одиночку или чей вывод превысил предел, завершает run как not verified.

### Implementation

| Что | Где |
|---|---|
| Gate: scope, кэш, скрипты, исходы, marker-ы, файл вердикта | `harness/hooks/gate.mjs` |
| Launcher, который находит node | `harness/hooks/gate.sh` |
| Чтение registry: какой проект, какие пакеты и скрипты | `harness/hooks/gate-resolve.mjs` |
| Папки состояния и registry, тег worktree | `harness/hooks/gate-paths.mjs` |
| Log-и, замеры времени, блоки падений Playwright | `harness/hooks/gate-log.mjs` |
| Hook, который удерживает ход | `harness/hooks/stop.mjs` |
| Какой hook что запускает | `harness/hooks/hooks.json` |

**Файлы.** Registry — `<Harness home>/gate/config.json`, где Harness home — это `HARNESS_HOME` или `~/.claude/worfy-harness`. Если там
registry нет, а на старом месте, в `~/.claude/gate/config.json`, есть, читается старый. Папка состояния —
`<Harness home>/gate/state`, в ней marker-ы, файлы вердикта и папки `cache`, `stop-blocks` и `logs/<tag>/<run>`. `CLAUDE_GATE_CONFIG`,
`CLAUDE_GATE_STATE` и `CLAUDE_GATE_RESOLVE` в test-ах направляют Gate в другое место.

**Поток данных.** Gate находит worktree и общий каталог git и спрашивает у resolver-а запись registry. Он вычисляет scope и изменённые
пути и спрашивает у resolver-а план, одну строку JSON на пакет. Для каждого пакета он смотрит в кэш или запускает скрипты по одному.
Затем одним махом записывает исход: записи кэша, log-и, marker-ы, файл вердикта и строку вердикта.

**Главные test-ы.** Эти shell test-ы идут через `test/harness-scripts-suite.ts`.

- `harness/hooks/tests/gate-verdict.test.sh`, `harness/hooks/tests/gate-verdict-signals.test.sh`,
  `harness/hooks/tests/gate-verdict-inside.test.sh`: файл вердикта, в том числе при сигнале.
- `harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gate-unregistered.test.sh`: код 3 и hook `Stop`.
- `harness/hooks/tests/gate-scope.test.sh`, `harness/hooks/tests/gate-file-size.test.sh`: scope и предупреждение о размере.
- `harness/hooks/tests/gate-log.test.sh`, `harness/hooks/tests/gate-timings.test.sh`, `harness/hooks/tests/gate-shim.test.sh`,
  `harness/hooks/tests/gate-args.test.sh`: log-и, замеры времени, launcher и аргумент профиля.

## Gate full

### Behaviour

Gate full — та же программа с профилем `full`: `node gate.mjs full`. У неё те же исходы, правила scope и кэш, что у любого другого
профиля, поэтому run на ветке по-прежнему сужается по diff-у, если не задан `GATE_SCOPE=all`.

**Что он запускает, задаётся для Project-а.** Запись registry перечисляет скрипты `package.json` в `root` и `workspace` по профилям.
Запускаются только скрипты, которые есть в пакете. «Add project» показывает списки `root` как поля «Gate fast» и «Gate full».

| Project | `fast` | `full` |
|---|---|---|
| Собственный репозиторий worfy | `lint`, `typecheck`, `test` | они же плюс `test:e2e` и `test:package` (упакованное приложение) |
| Demo project | `test:fast` | `test` |

**Когда он обязателен.** Это говорит Profile, а не Gate:

| Profile | Gate full перед merge |
|---|---|
| `workflow.finish` `local-green` | Да. На ветке Ticket-а, силами Orchestrator-а, перед локальным merge. Red run останавливает завершение. |
| `workflow.finish` `pr-green-ci`, `workflow.merge_gate` null или нет | Нет. При `workflow.ci` `pr` условие merge — итоговая проверка CI на head PR и отметка `review` на том же head. |
| `workflow.merge_gate` `each` | Да. Каждый PR делает rebase и получает свой run с `GATE_SCOPE=all`. |
| `workflow.merge_gate` `wave` | Да. Один run на набор готовых PR Wave, влитых squash-ем во временный worktree (`wave-gate`). Red run повторяется один раз на том же дереве; снова red — набор делится пополам по префиксам, не больше 2 + ceil(log2 N) законченных run-ов. |

Собственный репозиторий worfy — на второй строке, итоговая проверка там `ci-ok`. Gate full там остаётся инструментом implementer-а и
разбора сбоя.

**Замок e2e.** Если в Profile-е есть `workflow.e2e_lock`, `wave-gate`, skills и правила Project-а берут эту папку как замок на каждый
локальный run e2e и Gate full. Сам Gate его не берёт, поэтому голый `node gate.mjs full` ничего не держит, и job-ы CI его не используют. Замок
старше 30 минут считается брошенным, и его владелец обновляет его каждые 5 минут. Файл внутри может называть PR этого run-а. Пока замок
занят и Ticket стоит на Stage «Gate & merge», его Stage говорит `gate running`, `waiting for gate` или `gate busy`
([Workflow](workflow.md)).

**Заблокированный экран на Mac.** Заблокированный экран не показывает окон Electron, поэтому каждый e2e test падает на первом окне.
`wave-gate check` спрашивает систему перед каждым run-ом и, пока экран заблокирован, печатает `screen locked: gate full waits` и
опрашивает каждые 30 секунд, не держа замок e2e. Red run, в котором `test:e2e` или `test:package` упали при заблокированном экране,
считается not verified и идёт снова после разблокировки, не больше 3 run-ов. После этого проверка заканчивается как unverified.
`wave-gate check` и `wave-gate merge` также не дают дисплею заснуть, пока работают.

#### Очередь cross-machine gate

Для Project-а на двух Machine, одна из которых не может запустить Gate full другой. В Profile-е каждой Machine есть
`cross_machine_gate` с её ролью, `serve` или `request`, меткой GitHub и именем раздела в описании PR. Без этого поля у Project-а нет
очереди. Собственный репозиторий worfy её не использует.

**Какой PR ждёт.** PR ждёт Machine с `serve`, когда он открыт, несёт метку, не из fork-а и не имеет red отчёта новее последнего
коммита. Отчёт — это комментарий GitHub-аккаунта Project-а, первая строка которого начинается с `<section> report: red`. Green отчёт
ожидание не завершает, потому что у PR, открытого после него, не удался merge. Ожидание считается от более позднего из двух: создания
PR и его последнего коммита.

**Что видит пользователь.**

- На Machine с `serve` «Process gate queue» есть в меню Project-а и в Command palette. Строка palette показывает `1 PR waiting, oldest 2
  h`, `queue empty` или `gh failed: <reason>`.
- Действие отправляет шаблон Project-а его Orchestrator-у. С плагином Harness шаблон по умолчанию — `/worfy:gate-queue`. Действие
  отклоняется с причиной, когда в Project-е идёт Autopilot, когда роль этой Machine не `serve` или когда шаблон пуст.
- PR, который ждёт больше часа, получает одно уведомление на PR и последний коммит, на любой из Machine. Пока окно worfy в фокусе,
  уведомление ждёт следующего чтения очереди. Клик поднимает окно и ничего не открывает.
- Autopilot на Machine с `serve` отправляет тот же текст один раз перед остановкой из-за отсутствия Wave.

Очередь читается не чаще раза в 5 минут на Project, а при сбое gh интервал удваивается до 30 минут. Читается не больше 100 PR с меткой.
Работу делает skill в Session: worfy никогда не комментирует, не вливает и не правит метку.

#### On a Linked machine

`gateQueue.get` открыт для Linked machine с доступом только на чтение, а `actions.gateQueue` — только с полным доступом. Очередь читается
и Session работает на Machine Project-а.

#### Windows

У каждой Machine свои registry и Profile. Для собственного репозитория worfy Windows-вердикт PR дают job-ы `windows` в составе `ci-ok`.
После merge PR, для которого `scripts/windows-verdict-scope.mjs` печатает `pc`, Windows-ПК владельца запускает Gate full на `main`
([ADR-0086](../../adr/0086-pc-gate-full-once-per-wave.md)).

### How it works

CI на GitHub запускает те же виды проверок на Linux, macOS и Windows, поэтому в собственном репозитории worfy Gate full не держит merge:
[ADR-0083](../../adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md). Очередь обслуживает Project, в котором одна Machine должна
проверять PR другой: [ADR-0069](../../adr/0069-cross-machine-gate-label-and-roles.md).

### Implementation

| Что | Где |
|---|---|
| Сам run | `harness/hooks/gate.mjs` |
| Один Gate full на набор PR, проверка экрана | `harness/bin/wave-gate` |
| Gate перед merge, замок e2e | `harness/skills/epic-wave/SKILL.md` |
| Локальное завершение | `harness/skills/ship-ticket/step-11-close.md` |
| Проход по очереди | `harness/skills/gate-queue/SKILL.md` |
| Очередь, как её читает worfy: роль, правило ожидания, интервалы | `src/main/github/gate-queue.ts` |
| Её IPC и единственный reader приложения | `src/shared/ipc/gate-queue.ts`, `src/main/ipc/gate-queue.ts` |
| «Process gate queue»: отказы и текст | `src/main/actions/launch.ts` |
| Ход Autopilot для очереди | `src/main/autopilot/run.ts` |
| Уведомления об ожидающем PR | `src/main/notify.ts` |
| Меню, palette и чтение при открытии | `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/projects/useGateQueue.ts` |
| Поля «Gate fast» и «Gate full» | `src/renderer/projects/ConnectProject.tsx` |
| Замок e2e, как его читает Stage | `src/main/workflow/stages.ts`, `src/shared/workflow/pipeline.ts` |
| Запись registry для Demo project | `src/main/getting-started/demo-template.ts` |

**Главные test-ы.**

- `harness/bin/tests/wave-gate.test.sh`, `harness/bin/tests/wave-gate-screen.test.sh`, `harness/bin/tests/wave-gate-lock.test.sh`:
  run над набором, заблокированный экран и замок.
- `test/contract/gate-queue.test.ts`: какой PR ждёт, и чтение очереди.

## PR и CI badges

### Behaviour

Chip-ы на Node-ах workflow. Ticket показывает их как подробности своей Stage. Session показывает только Gate своего worktree. Рамка Epic-а
не показывает ничего. Chip-ы переносятся на вторую строку и не обрезаются. Цвета — цвета статусов, всегда с подписью.

| Chip | Где | Что значит |
|---|---|---|
| `gate green` | Ticket, Session | Исход Gate — green. |
| `gate red` | Ticket, Session | Исход Gate — red. |
| `gate unverified` | Ticket, Session | Gate не смог проверить. |
| `gate: no data` | Ticket, Session | Неизвестны ни marker, ни вердикт, ни строка Gate, или последний run сказал «nothing ran». Это никогда не green. |
| `PR #31`, `PR #31 merged`, `PR #31 closed` | Ticket | PR его ветки. В tooltip адрес. |
| `CI passing`, `CI failing`, `CI running` | Ticket | Проверки PR. Если их нет, chip-а нет. |
| `VERIFIED`, `REJECTED` | Ticket | Вердикт ревьюера на head-коммите. Если его нет, chip-а нет. |
| `gh unavailable` | Ticket | gh не ответил. В tooltip причина. |
| `in %TEMP%` | Ticket, Session | Worktree лежит во временной папке Windows. В tooltip предупреждение и путь. |

Tooltip chip-а Gate добавляет путь к worktree, а tooltip строки Ticket-а сводит все её chip-ы. У Ticket-а с PR есть ещё действие **Open PR**,
которое открывает адрес в браузере. Адрес, который не является страницей на `https://github.com/`, делает кнопку неактивной, и её
tooltip говорит почему.

**Chip Gate.** Что он показывает, в порядке приоритета:

1. Red marker worktree.
2. Marker unverified.
3. Файл вердикта. Он не берётся, если он о другом worktree или о другом коммите, чем нынешний HEAD worktree, поэтому новый коммит
   отодвигает старый вердикт.
4. Последняя строка Gate в транскриптах Session-й, начатых в этом worktree. Считается только строка из вызова Bash, который запускал Gate
   для этого worktree, или из вывода hook-а. Строка, процитированная в prompt-е или напечатанная другой командой, не считается.

Marker идёт первым, потому что run, который ничего не проверил, его не снимает: после red run-а «nothing ran» оставляет worktree red.

**Какой worktree.**

- Ticket берёт worktree, ветка которого его называет: его строка `Branch:` или `<epic>/<NN>`. Иначе он берёт тот, папка которого несёт
  его номер, а ветка не называет ни одного Ticket-а. Такой не берётся, если у другого Epic-а Project-а есть Ticket с тем же номером,
  потому что папка не называет Epic. Без worktree у Ticket-а нет chip-а Gate.
- Session берёт самый глубокий worktree, содержащий её папку. Основной checkout считается worktree.

**Какой PR.** Сначала открытый PR ветки Ticket-а, затем влитый, затем закрытый, внутри каждого — с большим номером.

**Chip CI.** Проверки head PR сводятся к одному слову:

- `failing`, если упала любая проверка: `FAILURE`, `TIMED_OUT`, `CANCELLED`, `ACTION_REQUIRED`, `STARTUP_FAILURE` или `ERROR`;
- иначе `running`, если любая проверка не закончилась;
- иначе `passing`.

Считаются все проверки на head. Условие merge Project-а может читать одну проверку (`ci-ok` в собственном репозитории worfy), поэтому
chip и это условие могут расходиться. Commit status-ы `review`, `check/<name>` и `deploy` — отметки агентов, а не CI, поэтому
упавшее ревью не делает CI красным.

**Chip вердикта.** Он берётся из отметки `review` на head-коммите PR: `success` — это VERIFIED, `failure` или `error` — REJECTED.
`pending`, отсутствие отметки или отметка на более старом коммите chip-а не дают. Текст комментариев PR не считается, даже если
расходится с отметкой.

**`gh unavailable`.** gh не установлен, в него не выполнен вход или нет сети. Chip показывается на Ticket-е, у которого есть worktree, который
в работе или был взят в ветке, а Ticket без всего этого не показывает ничего. Пока это длится, ни у одного Ticket-а нет chip-ов PR.
Первый успех возвращает их.

**Насколько свежо.** Renderer спрашивает, когда появляется первый badge Project-а, когда меняется набор веток Ticket-ов в работе, когда
окно получает фокус и каждые 10 секунд, пока окно в фокусе. Он прекращает, когда последний badge Project-а исчез. Каждый ответ заново
читает файлы Gate и `git worktree list`, а main перечисляет PR через gh не чаще раза в 60 секунд на спрошенную папку, как бы часто ни
спрашивали. После сбоя интервал удваивается, до 32 минут, а первый успех возвращает его к 60 секундам.

**Старые PR и много PR.** Одно чтение перечисляет 100 последних PR в любом состоянии. Ветка Ticket-а, который в работе или был взят в
ветке, и ветка worktree, которая называет Ticket, ищутся отдельно, если их нет в этом списке: не больше 10 таких поисков на чтение и не
чаще раза в 5 минут на ветку. У любого другого Ticket-а есть chip-ы PR, только пока его PR среди этих 100.

**Project над несколькими репозиториями и Silent mode.** Каждый репозиторий спрашивается отдельно
([ADR-0045](../../adr/0045-one-ticket-one-repository.md)), и Ticket получает chip-ы из репозитория, названного в его строке `Repo:`.
Ticket, не называющий ни одного из них, не имеет chip-ов Gate, PR и CI. Chip Gate у Session в любом случае читается из корня Project-а.
В Silent mode строка `Branch:` Ticket-а связывает его с его веткой.

**GitHub-аккаунт.** Когда Profile называет `github.account`, каждый вызов gh при чтении идёт от этого аккаунта, а глобальный аккаунт gh
никогда не переключается. Без аккаунта или со значением, которое не является логином GitHub, gh работает с аккаунтом login shell-а.
Аккаунт, для которого в gh нет входа, даёт `gh unavailable` с tooltip-ом, называющим его и `gh auth login`, и никогда не откатывается на
другой аккаунт. Изменённый Profile действует со следующего чтения, запускающего gh.

**Ничего не пишется.** Badges только читают. Для них worfy не запускает никаких команд gh, кроме `gh pr list` и
`gh auth token -u <account>`, и ничего не меняет на GitHub, в Project-е и в состоянии Gate.

#### On a Linked machine

`checks.get` и `checks.repos` открыты для Linked machine с доступом только на чтение, и её Canvas показывает те же chip-ы. Всё выполняется
на Machine Project-а: её файлы Gate, её git, её gh и её аккаунт. Корень вне Project-ов этой Machine отклоняется.

#### Windows

`in %TEMP%` появляется только на Windows, включён ли Storage Sense или нет, потому что Storage Sense может удалять файлы из этой папки,
когда на диске мало места.

### How it works

- **Вид поверх того, что пишут другие.** Chip-ы берутся из файлов Gate, транскриптов, git и gh. Своего worfy о них не хранит
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md), [ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).
- **Частота вопросов и частота gh разделены.** Renderer может спрашивать часто, потому что решает, когда запускать gh, tracker. Renderer
  держит одну копию на Project и спрошенную папку, общую для всех badges. У main один tracker, общий с чтениями узких раундов исправления
  у Autopilot и со Stage, поэтому `gh pr list` всего списка запускается не чаще раза за интервал для всех них.
- **Вердикт привязан к коммиту.** Отметка — это commit status на SHA, а rollup от gh относится только к head-коммиту, поэтому push сам
  убирает старый вердикт ([ADR-0067](../../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). Первая строка комментария
  `NARROW:` по-прежнему читается, для journal-а Autopilot, а не для chip-а ([ADR-0046](../../adr/0046-autopilot-narrow-round-without-owner.md)).
- **Поиски совпадают точно.** `--head <branch>` совпадает с именем точно, а `--search head:<branch>` нашёл бы `demo/18` для `demo/1`.
- **Что принимает main.** `checks.get` принимает корень Project-а или один из его репозиториев и ветки вида `<epic>/<NN>` или названные
  моделью workflow для Ticket-ов этого репозитория. Любая другая отклоняет весь вызов, поэтому renderer отправляет только подходящие ветки.
  В одном вызове — не больше 500 веток длиной не больше 200 символов каждая.
- **Токен.** `GH_TOKEN` берётся из `gh auth token -u <account>`, один раз на чтение. Он живёт только в окружении процессов gh этого чтения и
  не хранится, не пишется в log и не попадает в ответ ([ADR-0020](../../adr/0020-profile-shared-and-personal-parts.md)).

#### Windows

Пути сравниваются с любым разделителем и без учёта регистра, а тег worktree берётся из написания git (`C:/Users/x/worfy`). Чтобы определить
место вызова Gate в транскрипте, понимается `cd` в кавычках к `C:\…`, `cd` к `C:/…`, путь UNC в кавычках или `/c/…` из Git Bash.

### Implementation

| Что | Где |
|---|---|
| Контракт IPC и какой worktree или PR получает Ticket | `src/shared/ipc/checks.ts` |
| Обработчики, что принимает `checks.get`, tracker приложения | `src/main/ipc/checks.ts` |
| Чтение Gate: ключ registry, marker-ы, файл вердикта, транскрипты, worktree | `src/main/gate/state.ts` |
| Где папка Gate | `src/main/harness/locate.ts` |
| Чтение gh: runner, аккаунт, tracker, CI и вердикт | `src/main/github/prs.ts` |
| GitHub-аккаунт Project-а из его Profile-а | `src/main/workflow/profile.ts` |
| Chip-ы | `src/renderer/canvas/badges/ChecksBadges.tsx`, `src/renderer/canvas/badges/checks-badges.css` |
| Копия в renderer-е, опрос, ветки в работе | `src/renderer/canvas/badges/use-checks.ts` |
| Open PR | `src/renderer/canvas/actions/OpenPr.tsx` |
| Временная папка Windows | `src/main/projects/temp-folder.ts`, `src/shared/temp-folder.ts` |

Выбор аккаунта при подключении Project-а — в `src/main/github/accounts.ts` ([Projects](projects.md)). Deployments для Stage «Deploy» — в
`src/main/github/deployments.ts` ([Workflow](workflow.md)).

**Поток данных.** `useChecks` вызывает `checks.get` с папкой, Project-ом и ветками Ticket-ов в работе. Обработчик проверяет их и вызывает
`readChecks`: `git worktree list`, затем `GateReader.read` для каждого worktree и `PrTracker.read` для веток, плюс ветки Ticket-ов из
worktree. Ответ разбирается по схеме, поэтому лишние поля отслеживаемого PR, нужные Stage, до renderer-а не доходят. `ChecksBadges` выбирает
worktree и PR Ticket-а из снимка и рисует chip-ы. Система слотов подхватывает этот файл сама, через `src/renderer/canvas/badges/index.ts`.

**Главные test-ы.**

- `test/e2e/checks-badges.spec.ts`: весь Feature в приложении над stub-ом gh, ничего не записано, и случай без gh.
- `test/unit/checks-badges.test.tsx`: что показывает каждый субъект, опрос, несколько репозиториев, одна папка от двух Project-ов.
- `test/unit/gate-state.test.ts`, `test/unit/gate-key-spelling.test.ts`, `test/contract/gate-key-agreement.test.ts`: чтение Gate и
  согласие ключа registry с resolver-ом Gate.
- `test/contract/github-prs.test.ts`: CI, вердикт, интервалы и поиски tracker-а, аккаунт и токен, что отклоняет `checks.get`.
- `test/contract/link-access.test.ts`: `checks.get` от Linked machine.
- `test/unit/read-checks.test.ts`: отметка `in %TEMP%`.
