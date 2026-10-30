# Workflow

> Перевод [английской версии](../workflow.md), commit `same-pr`.

Три близких Feature. **Ticket и Epic на Canvas** показывают работу Project-а так, как её записывают файлы Ticket-ов.
**Pipeline** говорит, на каком Stage стоит каждый Ticket. **Binding** связывает каждого агента с Ticket-ом или Epic-ом, над
которым он работает. Термины объяснены в [Concepts](concepts.md).

## Ticket и Epic на Canvas

### Behaviour

Каждый Epic Project-а — это frame на Canvas, а каждый Ticket — карточка в его frame. Как frame-ы размещаются, двигаются,
сворачиваются и попадают на Done shelf, описано на странице [Canvas](canvas.md). Карточку нельзя перетащить.

**Карточка Ticket-а** показывает сверху вниз:

- Номер, минимум две цифры. В Project-е над несколькими репозиториями — chip со строкой `Repo:` Ticket-а или `no repo`.
- Stepper его Stage (см. [Pipeline](#pipeline)). Пока у main нет Stage для него, вместо stepper-а chip со статусом: `open`,
  `claimed`, `blocked`, `done` или `no status`.
- Chip `Ready`, когда Ticket входит в ready Wave.
- Заголовок: первый H1 файла без начального номера или slug имени файла, если H1 нет.
- Причину у заблокированного Ticket-а, если она есть. Иначе одну строку: `no blockers`, `waiting on 03, 04`,
  `blocked by 03 · done` или почему Ticket требует внимания.
- Значки и действия: chip-ы из [Gate and GitHub](gate-and-github.md), число Session в Archive, Ship ticket и Open PR.

На карточке ничего не обрезается. Текст переносится, и карточка растёт в высоту, начиная со 138 пикселей при ширине 240. Её
tooltip показывает строку Status с причиной и `(in <branch>)` для статуса, который пришёл из ветки worktree.

**Статус.** Он берётся из строки `Status:` файла. Без строки Status или при старой форме шапки читается `no status`. В Full
mode статус ветки worktree Ticket-а идёт поверх статуса из checkout, поэтому Ticket, который взяли в его worktree, сразу
показывает `claimed`. Ветка не меняет Ticket, который в checkout `blocked` или `done`, а ветка со статусом `open` или без
статуса не меняет ничего. В Silent mode ветки не читаются.

**Focus mode.** Двойной клик по карточке открывает Ticket в Focus mode: весь файл как markdown под той же шапкой. Текст
следует за правками файла. «Open in editor» открывает файл. Файл больше 1 МБ не читается. Когда чтение не удалось,
показывается «The Ticket file could not be read» с причиной, а прочитанный ранее текст остаётся.

**Frame Epic-а.** В шапке — имя Epic-а, H1 его `spec.md`, полоса прогресса из 12 сегментов, счётчик `done/total`, Run wave и
кнопки [Autopilot](autopilot.md). Колонки внутри идут слева направо:

| Колонка | Ticket-ы |
|---|---|
| `Done` | Завершённые Ticket-ы, сложенные в одну стопку с их номерами, пока её не откроет «Expand» |
| `Level 1`, `Level 2`, … | Остальные, по зависимостям. В Level 1 нет незавершённых blocker-ов, не считая blocker-ов из `Needs attention` |
| `Needs attention` | Ticket-ы, блокировку которых нельзя прочитать: «Blocked by» не список, blocker вне Epic-а, цикл. Строка карточки называет причину |

Стрелка идёт от blocker-а к Ticket-у, который он блокирует. Она пунктирная, пока blocker не завершён, и бледная, пока не лежит
на подсвеченной цепочке Node-а под курсором или выбранного Node-а. Стрелка завершённого blocker-а сплошная и рисуется только
при подсветке. Стрелка рисуется, только когда у обоих Ticket-ов есть карточка на Canvas.

**Боковая панель и палитра.** Секция Epics перечисляет Epic-и активного Project-а с их прогрессом и `N in work`; клик
центрирует frame. В Command palette есть строка «Go to» для каждого Epic-а и Ticket-а, а для Ticket-а без карточки она
центрирует frame. Каждая неотмеченная ручная проверка Ticket-а (пункт его раздела готовности с ручной пометкой из Profile) —
строка палитры, которая находится только при вводе текста. Выбор строки ведёт к Ticket-у. worfy эти пункты не отмечает.

**Ready Wave** вычисляется для каждого Epic-а и нигде не хранится. Ticket входит в неё, когда:

- Он `open`.
- Его «Blocked by» читается, и у него нет blocker-а вне Epic-а. Цикл, все остальные участники которого завершены, циклом не
  считается.
- Каждый blocker завершён в checkout. Blocker, завершённый только в невлитой ветке worktree, ещё не завершён.
- Ни один файл его раздела со следом не пересекается с занятым файлом. Свои файлы занимают Ticket-ы в работе и Ticket-ы,
  завершённые только в ветке, а также каждый Ticket, уже взятый в эту Wave, по порядку номеров. Запись с `/` на конце занимает
  всю папку.

Ticket без раздела со следом может быть в Wave: он ничего не занимает. У Ticket-ов Wave есть chip `Ready`, а подпись Level 1
показывает `Ready wave · N`.

**Действия.** Ship ticket и Run wave отправляют шаблон действия Project-а, заполненный значениями `{epic}`, `{NN}`, `{wave}`,
`{slug}`, `{branch}` и `{tickets}`. С плагином Harness по умолчанию это `/worfy:ship-ticket {epic} {NN}` и
`/worfy:epic-wave tickets {tickets} of epic {epic}`. Оба действия есть и в строках Command palette. Неактивная кнопка называет
причину в tooltip.

| Действие | Показано | Активно, когда | Что делает |
|---|---|---|---|
| Ship ticket | На Ticket-е, который `open`, `blocked` или без статуса | Он `open`, каждый blocker завершён в checkout, запущенная этой кнопкой Session этого Ticket-а не жива, шаблон задан и заполняется | Новый Session Node с текстом как первым сообщением, справа от полосы frame-ов на высоте Ticket-а. Если их нет на Canvas — там, куда попадает любой новый Node |
| Run wave | На frame, если не все его Ticket-ы завершены | Ready Wave не пуста, шаблон задан и заполняется | Текст уходит Orchestrator-у, в очередь, пока идёт turn. Отказ, пока в Project-е работает Autopilot |
| Open PR | На Ticket-е с PR | Адрес на `https://github.com/` | Открывает PR в браузере и ничего не пишет в GitHub |

Шаблон с неизвестной подстановкой или с подстановкой без значения не заполняется, и ошибка становится причиной на кнопке. При
клике на Ship ticket или Run wave worfy читает workflow заново и принимает то же решение ещё раз, поэтому Ticket, который тем
временем взяли в терминале, не запускается дважды. Запущенный агент сам меняет статус командой `ticket claim`.

**Пусто и ошибка.** Project без Epic-ов показывает панель «No epics yet». «Plan first epic» открывает Orchestrator-а и ничего
ему не отправляет. Frame без Ticket-ов пишет «No tickets in this epic.» Когда workflow нельзя прочитать, на Canvas нет frame-ов,
а секция Epics показывает причину.

#### On a Linked machine

Epic-и и Ticket-ы читаются на Machine Project-а, только для Project-ов из её списка. На экране только для чтения Ship ticket, Run
wave, сворачивание frame и «Plan first epic» неактивны и объясняют почему. С правом записи действия выполняются на Machine
Project-а. Focus mode тоже читает файл там, а «Open in editor» показывает toast «File is on <Machine>».

### How it works

- **worfy читает workflow и никогда его не пишет.** Источник истины — файлы, поэтому никакой код worfy не меняет статус
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Единственный читатель формата Ticket-а — `epic-status
  --json` из Harness, найденного на Machine. worfy добавляет то, чего этот script не несёт: файлы раздела со следом, ручные
  проверки, заголовок Epic-а и hash текста Ticket-а.
- **Где лежит workflow** — это ответ Harness. В Full mode это `.scratch` репозитория (или `tickets.root` из Profile), в Silent
  mode — Workflow folder ([ADR-0042](../../adr/0042-profile-on-machine-full-and-silent-modes.md)). Папка без Profile читается как
  Full mode. Неудачный вызов `profile` не обходится догадкой: модель несёт причину, а вызов повторяется через 10 с, 30 с, 60 с и
  затем каждые 5 минут.
- **Заголовки задаёт Profile.** Их называют `tickets.trail_section`, `tickets.done_section` и `tickets.manual_mark`. Без них по
  умолчанию действуют `## Where in code`, `## Done when` и `manual`, а старые русские названия тоже читаются.
- **Чтения следуют за изменениями.** Событие файла под корнем Ticket-ов ведёт к одному полному `epic-status` после 300 мс тишины
  и не позже чем через 1 с после первого события серии. Чтения не накладываются друг на друга. В Full mode отслеживаются ещё git
  refs и список worktree, и заново читаются только ветки, у которых сдвинулся head, по четыре за раз. Корень Ticket-ов, который
  не является папкой, ищется каждые 2 с. Отслеживаются только файлы, которые читает `epic-status`: папки Epic-ов, `spec.md`,
  `map.md` и `issues/*.md`.
- **Ветка никогда не отменяет checkout.** Поэтому заблокированный Ticket со старой веткой worktree не выглядит открытым
  ([ADR-0033](../../adr/0033-autopilot-names-wave-tickets.md)).
- **Frame-ы и карточки вычисляются, а не сохраняются.** Layout хранит только смещение и сворачивание frame
  ([ADR-0011](../../adr/0011-epic-frames-derived-nodes.md)). ELK выбирает порядок внутри колонок и маршруты стрелок в Web Worker;
  до его первого ответа действует простая раскладка ([ADR-0037](../../adr/0037-epic-frame-layout-by-elk.md)). Высота карточки
  вычисляется из данных Ticket-а, на экране ничего не измеряется.

#### Windows

- Корень Ticket-ов отслеживает watcher, который читает каждую ссылку, прежде чем пройти по ней, а не chokidar. Чтения файлов
  Ticket-ов и spec-ов считают ссылку, которая ведёт на сетевой ресурс или не поддаётся проверке, файлом, который нельзя прочитать.
  Корень Project-а, его настоящий путь и корень Ticket-ов сами могут лежать на сетевом ресурсе.
- Когда папка из отслеживания веток удалена, это отслеживание закрывается и создаётся заново на тех же путях.
- Bash script старого Harness не запускается на Windows: `epic-status` завершается с ошибкой и сообщением обновить Harness
  ([ADR-0055](../../adr/0055-harness-scripts-in-node.md)).

### Implementation

| Что | Где |
|---|---|
| Чтение модели, раздел со следом, статусы веток поверх checkout | `src/main/workflow/reader.ts` |
| Отслеживание и hub, который делит его | `src/main/workflow/watch.ts` |
| Где лежит workflow; Profile | `src/main/workflow/folder.ts`, `src/main/workflow/profile.ts` |
| Модель и её delta | `src/shared/workflow/types.ts` |
| Level-ы, ready Wave, номера Wave | `src/shared/workflow/waves.ts` |
| Заголовки, ручные проверки | `src/shared/workflow/doc-headings.ts`, `src/shared/workflow/manual-checks.ts` |
| IPC модели и текста Ticket-а | `src/shared/ipc/workflow.ts`, `src/main/ipc/workflow.ts`, `src/shared/ipc/tickets.ts`, `src/main/ipc/tickets.ts` |
| Общая копия в renderer | `src/renderer/workflow/useWorkflow.ts` |
| Frame-ы и карточки как Node-ы; колонки; высота карточки | `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/ticket-card.ts` |
| View | `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/nodes/TicketBody.tsx`, `src/renderer/canvas/nodes/ticket-text.ts`, `src/renderer/canvas/nodes/EpicFrameNode.tsx` |
| Стрелки | `src/renderer/canvas/edges/blocking.ts` |
| Боковая панель, палитра, пустая панель | `src/renderer/shell/sidebar/EpicsSection.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/canvas/overlays/FirstEpic.tsx` |
| Кнопки | `src/renderer/canvas/actions/TicketActions.tsx`, `src/renderer/canvas/actions/EpicActions.tsx`, `src/renderer/canvas/actions/OpenPr.tsx`, `src/renderer/canvas/actions/gates.ts` |
| Может ли действие выполниться; шаблоны | `src/shared/actions/render-template.ts`, `src/shared/projects/action-templates.ts` |
| Запуск работы | `src/main/actions/launch.ts`, `src/main/ipc/actions.ts`, `src/shared/ipc/actions.ts` |

**Поток данных.** Первое окно, которому нужен Project, вызывает `workflow.open`. `WorkflowHub` держит один watcher на Project,
запускает `epic-status`, кладёт статусы веток поверх checkout и отвечает моделью. После каждого чтения, которое что-то изменило,
каждый подписчик получает `workflow.changed` только с изменившимися Epic-ами и Ticket-ами. Renderer применяет его к своей общей
копии, а `sources/epics.ts` превращает копию в Node-ы. Тот же hub обслуживает Stage-ы, Autopilot и уведомления об ожиданиях.

**Главные test-ы.**

- `test/e2e/epic-frame.spec.ts`, `test/e2e/ticket-focus.spec.ts`, `test/e2e/ship-ticket.spec.ts`: Feature в приложении.
- `test/contract/workflow-reader.test.ts`, `test/contract/tickets-read.test.ts`, `test/contract/actions.test.ts`: stub
  `epic-status`, запущенный как дочерний процесс, проверка файлов и каналы.
- `test/unit/waves.test.ts`, `test/unit/epic-layout.test.ts`, `test/unit/ticket-card.test.tsx`,
  `test/unit/render-template.test.ts`, `test/unit/launch.test.ts`: чистые правила.
- `test/unit/tickets-watch.test.ts`, `test/contract/workflow-watch-retry.test.ts`: чтения и повторы.
- Windows: `test/unit/workflow-remote-links.test.ts`, `test/contract/workflow-watch-links.test.ts`,
  `test/contract/workflow-branches-gone.test.ts`, `test/contract/workflow-branches-handles.test.ts`.

## Pipeline

### Behaviour

У каждого Project-а есть Pipeline, и каждый Ticket стоит на одном из его Stage. Без настройки Pipeline — это Queued, Implementing,
CI, Agent review, Gate & merge, Closing, Done.

**Где это видно.**

- **Stepper на карточке Ticket-а:** точка на каждый Stage (пройден, текущий, будущий, и пропущенный Check рисуется отдельно), имя
  текущего Stage, его флаги и кого ждёт Ticket. Когда это не помещается в одну строку, когда у Ticket-а есть chip `Ready` или chip
  репозитория, либо на карточке уже 240 пикселей, stepper убирает точки и показывает `N/M`. В tooltip вся картина словами.
- **Board:** пункт «Pipeline» переключателя View на toolbar. Колонка на каждый Stage активного Project-а со счётчиком и карточка на
  каждый Ticket. Done свёрнут в `N done`, пока по нему не кликнуть. Board сам следует за изменениями, а клик по карточке показывает
  этот Ticket на Canvas или его frame, когда карточка свёрнута. Когда фактов не хватает, сообщение пишет «Some Stages may be short
  of facts» с причиной.
- **Секция Pipeline в боковой панели:** Ticket-ы каждого Project-а этой Machine, которые не стоят ни на Queued, ни на Done. Клик
  открывает board этого Project-а. Без таких Ticket-ов она пишет «Nothing in work».

**Правило.** Stage-ы идут в порядке Pipeline, и Ticket стоит на первом непройденном. Статус `done` проходит все Stage-ы, кроме Done,
а влитый PR проходит все Stage-ы до merge включительно. Ticket, который `open` или без статуса, стоит на Queued, что бы ни было ещё:
в GitHub и git смотрят только для Ticket-а `claimed` или `blocked`.

| Stage | Пройден, когда |
|---|---|
| Queued | Статус не `open`, и у Ticket-а есть статус |
| Implementing | У Ticket-а есть открытый PR или отметка на head commit, и ни одна из последних отметок каждого вида там не `failure` |
| CI | Есть открытый PR, и все его CI checks зелёные. Открытый PR без checks проходит |
| Agent review | Последняя отметка `review` на head commit — `success` |
| Human review | Решение GitHub о review на открытом PR — `APPROVED` |
| Check `<name>` | Последняя отметка `check/<name>` на head commit — `success` или `skipped` |
| Gate & merge, Awaiting merge | Только merge или статус `done` |
| Deploy | Merge commit входит в задеплоенный commit: GitHub Deployment окружения этого Stage или, без окружения и только в Full mode, commit со статусом `deploy` |
| Closing | Только статус `done` проходит его |
| Done | Здесь Ticket останавливается |

Отметка считается только на head commit, поэтому новый push отменяет прежние вердикты. Закрытый PR считается как отсутствие PR.

**Флаги и подписи на Ticket-е.**

| Флаг | Когда | На board | На stepper |
|---|---|---|---|
| Blocked | Статус `blocked`, на любом Stage | `Blocked: <reason>` | `!` с причиной в tooltip |
| Rework | На Implementing с отметкой `failure` на head commit | `Rework` | `↺` |
| `failing` | На CI с упавшим check | Подпись | В tooltip |
| `gate running`, `waiting for gate`, `gate busy` | На Gate & merge, пока занята e2e-блокировка из Profile: этим PR, другими или без читаемого владельца | Подпись | В tooltip |
| Waits | Строка `Waits:`, иначе `team` на Human review и Awaiting merge, иначе `agent`. На Done нет | `Waits: <who>` | `<who>` |
| Stuck | Время на Stage достигло порога | Рамка и `stuck: on CI for 3 h` в tooltip | То же |

**Пороги stuck.**

| Ticket | Порог |
|---|---|
| У Stage есть `stuck_after` | Это значение |
| На Human review или Awaiting merge, либо `Waits:` — `owner` или `team` | 24 часа |
| На Implementing, CI, Agent review или Gate & merge | 2 часа |
| Queued, Check, Deploy или Closing | Нет |
| Done | Никогда, в том числе с `stuck_after` |

Время на Stage считается от последнего известного факта: времени статуса или времени отметки, check-а или merge, которые прошли
последний Stage. Без известного времени Ticket не оценивается. Часы на экране обновляются раз в минуту.

**Settings → Pipeline** правит Pipeline активного Project-а в пределах каталога: 11 видов, без собственных условий пользователя.
Queued остаётся первым, Done последним. Stage между ними можно двигать, убирать и добавлять, а Check-и могут повторяться под разными
именами. Поля:

- Label, на каждом Stage.
- Stuck after, на каждом Stage, кроме Done: число от 1 и `h` или `m`.
- Name, на Check: строчные буквы, цифры и дефисы.
- Environment, на Deploy.

Gate & merge и Awaiting merge не могут быть в одном Pipeline. Save активен только при допустимом изменении, а под ним строка говорит,
что каждый Stage будет вычислен заново. Изменение никогда не блокируется Ticket-ами в работе, но эти действия сначала спрашивают:

- Удаление Check, который Ticket-ы в работе прошли или на котором стоят.
- Сохранение такого Check под новым именем.
- «Reset to default», который убирает собственный Pipeline Project-а.

Pipeline, изменённый в другом месте после чтения, ничего не сохраняет и предлагает Reload. Другая идущая запись предлагает «Try
again». Harness без script-а редактора показывает пункт Harness с его Update. Неудавшийся commit в git домашней папки Harness оставляет
запись на месте и показывает предупреждение.

**Уведомление** приходит, когда Ticket начинает ждать человека, то есть его `Waits:` — `owner` или имя Machine. Заголовок —
`<epic> NN is waiting for you`, текст — причина блокировки или `<epic> NN — <title>`, а клик открывает board Project-а. `team` и
`agent` уведомлений не дают, как и другие переходы, например красный CI. Одно ожидание уведомляет один раз. Ожидание, которое уже было
при первом чтении Project-а, уведомления не даёт.

#### On a Linked machine

Stage-ы вычисляются на Machine Project-а и читаются как модель. Settings показывает Pipeline только для чтения и пишет «Edit it in worfy
on <Machine>»: запись отклоняется для каждой Linked machine, в том числе с полным доступом. `Waits: owner` уведомляет Machine Project-а
и каждую Linked machine, которая может видеть его Project-ы и принимает сообщение. `Waits: <Machine name>` уведомляет только эту Machine,
а имя, которого нет ни у одной Machine, не уведомляет никого. Linked machine отбрасывает уведомление о Project-е, который есть в её
собственном списке, потому что уведомила о нём сама. Клик по уведомлению на Linked machine открывает board среди Project-ов той Machine.

### How it works

- **Stage вычисляется и нигде не хранится.** У каждого вида есть предикат в коде, а Profile только включает виды, упорядочивает и
  переименовывает их ([ADR-0067](../../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). Комментарии PR не читаются: вердикт —
  это отметка, привязанная к commit.
- **Факты** берутся из того, что worfy уже читает: модели workflow, трекера PR, git и e2e-блокировки. Deployments запрашиваются только
  для Ticket-а на Deploy. worfy никогда не делает fetch, поэтому задеплоенный commit, которого нет в локальном клоне, оставляет Ticket на
  Deploy.
- **Ветка Ticket-а** — это его строка `Branch:`, иначе `<epic>/<NN>`. Её head — head открытого PR, иначе head локальной ветки.
- **У отметок два хранилища, оба здесь только читаются.** Это commit statuses head commit PR, кроме Silent mode и Full mode с
  `workflow.finish` `local-green` без `origin`, где они лежат в `<Harness home>/runs/<project>/marks/<epic>-<NN>.json`. Сломанный файл
  считается отсутствием отметок, и log один раз называет причину. Чтение commit statuses не несёт описания, поэтому отметка `skipped` там
  читается как `success`, и stepper рисует пропущенный Check отдельно только по файлу.
- **Пересчёт.** Stage-ы вычисляются при каждом изменении полей Ticket-а (правка только текста не считается) и каждые 60 с. Трекер PR
  запускает `gh`, только когда прошёл его интервал: 60 с, с удвоением до 32 минут, пока `gh` падает. Подписчики получают весь snapshot,
  когда в нём что-то изменилось. У Project-а одно вычисление, и оно останавливается, когда уходит последний подписчик.
- **Несколько репозиториев.** Факты Ticket-а берутся из репозитория в его строке `Repo:`
  ([ADR-0045](../../adr/0045-one-ticket-one-repository.md)). Ticket `claimed` без неё не имеет фактов, поэтому остаётся на первом Stage,
  которому они нужны, обычно на Implementing. `gh` никогда не запускается в корне, который является простой папкой.
- **Profile, который нельзя прочитать,** даёт Pipeline по умолчанию и причину в snapshot.
- **Редактор никогда не пишет Profile сам.** Он идёт через `bin/profile-set` из Harness с fingerprint того, что прочитал
  ([ADR-0073](../../adr/0073-profile-set-writes-the-pipeline.md)). Правила Pipeline есть в Harness и в worfy, и contract test даёт обеим
  копиям одни и те же случаи.

#### Windows

Корень, который список Project-ов пишет как `C:/…`, а окно как `C:\…`, — одно вычисление: main использует ключ `path.resolve`, а каждый
клиент получает snapshot-ы с корнем в том написании, в каком прислал его.

### Implementation

| Что | Где |
|---|---|
| Каталог, schema, `stageOf`, stuck | `src/shared/workflow/pipeline.ts` |
| Сбор фактов; `StageReader`, `StageHub` | `src/main/workflow/stages.ts` |
| Чтение отметок | `src/main/workflow/marks.ts` |
| Трекер PR; Deployments | `src/main/github/prs.ts`, `src/main/github/deployments.ts` |
| Pipeline из Profile | `src/main/workflow/profile.ts` |
| Копия правил в Harness | `harness/lib/pipeline.cjs` |
| IPC, чтение и запись редактора | `src/shared/ipc/pipeline.ts`, `src/main/ipc/pipeline.ts` |
| Общая копия в renderer | `src/renderer/pipeline/usePipeline.ts` |
| Board, stepper, общие формулировки | `src/renderer/pipeline/PipelineBoard.tsx`, `src/renderer/pipeline/Stepper.tsx`, `src/renderer/pipeline/board.ts` |
| Секция боковой панели; открытие board | `src/renderer/shell/sidebar/PipelineSection.tsx`, `src/renderer/pipeline/open.ts` |
| Редактор | `src/renderer/settings/PipelineSection.tsx` |
| Уведомления об ожиданиях | `src/main/workflow/waits-notify.ts`, `src/main/notify.ts`, `src/renderer/canvas/overlays/NotificationTarget.tsx` |

**Поток данных.** Первый view Project-а вызывает `pipeline.get`. `StageHub` запускает вычисление, которое подписывается на hub workflow
только ради изменений полей. Для каждого чтения `StageReader` берёт Profile, PR, отметки и head веток Ticket-ов в работе и блокировку, а
затем вызывает чистую `stageOf` для каждого Ticket-а. Изменившийся snapshot уходит по `pipeline.changed`. Уведомления об ожиданиях этим
путём не идут: `installWaitsNotifications` следует только за hub workflow, поэтому для них не запускаются `gh`, git и `profile`, пока
ничего не меняется.

**Главные test-ы.**

- `test/e2e/pipeline.spec.ts`: board, claim, который двигает карточку, и строка боковой панели, в приложении.
- `test/contract/workflow-stages.test.ts`: факты из настоящего git-репозитория в Full и Silent mode, блокировка и каналы.
- `test/unit/pipeline.test.ts`: `stageOf`, каталог и stuck.
- `test/contract/pipeline-rules-agree.test.ts`: две копии правил дают один вердикт.
- `test/unit/pipeline-board.test.tsx`, `test/unit/ticket-stepper.test.tsx`, `test/unit/settings-pipeline.test.tsx`: view.
- `test/unit/notify.test.ts`: уведомления об ожиданиях и кому они приходят.

## Binding

### Behaviour

Binding говорит, над каким одним Ticket-ом или Epic-ом работает Session или Subagent. У агента не больше одного Binding, а у Ticket-а может
быть несколько агентов. worfy выводит Binding из работы агента, и пользователь может задать его вручную.

**Откуда он берётся.** Побеждает самый сильный сигнал, который называет цель:

| # | Сигнал | Цель | Показанная причина |
|---|---|---|---|
| 1 | Пользователь бросил Node агента на Ticket или frame | Эта цель | `manual` |
| 2 | worfy запустил агента: Ship ticket, Run wave | Его Ticket; его Epic | `launched` |
| 3 | Последняя команда `ticket claim`, которую запустил агент | Ticket, который она называет | `ticket claim` |
| 4 | `/epic-wave` — последний вызов агентом из этих двух skill-ов | Последнее слово его аргументов, которое является Epic-ом Project-а | `/epic-wave` |
| 5 | Git-ветка или, если её нет, папка worktree Session | Ticket, который они называют | `branch <name>`, `worktree <folder>` |
| 6 | `/ship-ticket` — последний вызов агентом из этих двух skill-ов | Ticket в его аргументах | `/ship-ticket` |
| 7 | Для Subagent: первый путь к файлу Ticket-а в его задаче | Этот Ticket | `task` |

Поэтому Orchestrator, который ведёт Wave, связан с Epic-ом, а его implementer-ы и reviewer-ы — со своими Ticket-ами. Начиная с третьего
сигнала, сигнал, который называет Ticket или Epic, которого нет в Project-е, пропускается, и решает следующий. Пока workflow нельзя
прочитать, проверить ничего нельзя, поэтому сигналы берутся как есть, а голый номер ни к чему не привязывает.

**На Canvas.** Пунктирная линия идёт от Node-а агента к Ticket-у. Она заканчивается на frame, когда Binding к Epic-у или frame скрывает
Ticket, и на chip, когда Epic на Done shelf. Если такого места на Canvas нет, линии нет. Линия работающего агента (живая Session, запущенный
Subagent) рисуется всегда. Линия другого агента рисуется, только пока его Node или цель под курсором или выбраны либо оба входят в
подсвеченную Family. У закреплённого, скрытого или архивного Node-а линии нет.

**Вручную.** Перетащите один Node Session, Orchestrator-а или Subagent на Ticket или frame: цель обводится с подписью «Bind to …». При
отпускании агент связывается, а его Node возвращается на прежнее место, так что ничего не сдвигается. Ticket важнее frame вокруг него.
Выделение, перетащенное вместе, не связывает. Новая привязка агента заменяет его ручной Binding.

**Удаление.** Кликните правой кнопкой по Node-у, связанному вручную, и выберите «Remove binding» или нажмите одноимённую кнопку в Session
rail. Снова действует автоматический Binding. Binding запуска так не удаляется, и вручную его удалить нельзя.

**Session rail** содержит блок Binding: цель с заголовком и причину. «Show on Canvas» центрирует frame Epic-а. Несвязанная Session пишет «Not
bound. Drop the Session's Node on a Ticket or an Epic frame to bind it.»

**Что ещё читает Binding.** Family Node-а, правило «ticket done» автоматического Archive, «Arrange by Epic» и выбор активных Epic-ов в полосе
frame-ов; см. [Canvas](canvas.md) и [Sessions](sessions.md).

#### On a Linked machine

Ручные Binding и Binding запуска хранятся, а transcript-ы читаются на Machine Project-а. На экране только для чтения Node не перетаскивается,
поэтому ничего не связывается. «Remove binding» в меню Node-а неактивен и объясняет почему. С правом записи Linked machine связывает и удаляет
так же, как здесь.

### How it works

- **Автоматические Binding никогда не хранятся.** Они каждый раз читаются из transcript-ов
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Хранятся только ручные Binding и Binding запуска, в
  `<Project data folder>/bindings.json`, никогда не в репозитории и не в `~/.claude`
  ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). У агента не больше одного каждого вида, поэтому Binding переживает перезапуск.
- **Правила — это чистый список** от сильного к слабому, поэтому main, renderer и test-ы разрешают одинаково. `/epic-wave` стоит раньше ветки,
  потому что в checkout Orchestrator-а часто стоит ветка Ticket-а, который он вливает, а не над которым работает.
- **Какие формы читает сигнал.**
  - Claim — это `ticket claim <epic> <NN>` или `<epic>/<NN>` как слово Bash-команды, с любым путём перед `ticket`.
  - Ветка называет Ticket по его строке `Branch:`, когда такая строка ровно у одного Ticket-а, иначе по `<epic>/<NN>[-<slug>]`.
  - Папка — это `.claude/worktrees/<NN>[-<slug>]` или `<Harness home>/worktrees/<project>/<NN>`. В ней нет Epic-а, поэтому она связывает,
    только когда этот номер есть у одного Epic-а или незавершён только один Ticket с ним.
  - `/ship-ticket` принимает `<epic> <NN>`, `<epic>/<NN>` или такой же голый `<NN>`.
  - Skill считается под голым именем или с префиксом `worfy:`, но не под именем другого плагина.
  - Задача — это первый путь `.scratch/<epic>/issues/<NN>-…` в первом prompt Subagent.
- **У Subagent нет своего cwd и ветки.** Его файл несёт значения его Session, поэтому они убираются из его сигналов, и решает его задача,
  если он не сделал claim.
- **Чтение инкрементальное.** Main сворачивает новые строки каждого transcript в состояние, поэтому повторный запрос стоит только того, что
  дописано. Renderer спрашивает снова, когда transcript меняется, и каждые 3 с для живой Session, потому что файл Subagent не отслеживается.
- **Binding запуска записывается, как только Claude Code сообщает session id,** который называет transcript. Session, которая не сообщила его за
  10 минут, своим запуском не связывается.

#### Windows

Claim, путь к Ticket-у и папка worktree читаются с `\` так же, как с `/`, поэтому те же сигналы связывают.

### Implementation

| Что | Где |
|---|---|
| Правила и цели | `src/shared/binding/resolve.ts` |
| Сигналы из записей transcript | `src/shared/binding/signals.ts` |
| Чтение ветки или папки как Ticket-а | `src/shared/workflow/ticket-ref.ts` |
| Инкрементальное чтение transcript-ов | `src/main/claude-home/binding-signals.ts` |
| Хранилище ручных Binding и Binding запуска | `src/main/layout/bindings.ts` |
| IPC | `src/shared/ipc/bindings.ts`, `src/main/ipc/bindings.ts` |
| Копия в renderer, разрешение | `src/renderer/binding/store.ts` |
| Цели для отпускания; перетаскивание и меню | `src/renderer/binding/drop.ts`, `src/renderer/canvas/overlays/BindingDrop.tsx` |
| Якоря и линии | `src/renderer/canvas/sources/workflow-bindings.ts`, `src/renderer/canvas/edges/bindings.ts` |
| Блок rail | `src/renderer/session/rail/BindingRail.tsx` |
| Читатели в других местах | `src/renderer/canvas/family.ts`, `src/main/layout/archive.ts`, `src/renderer/canvas/arrange-by-epic-command.ts`, `src/renderer/canvas/arrangement-record.ts` |

**Поток данных.** `useSessionSignals` вызывает `bindings.signals` для каждой Session на плоскости, а `BindingSignalReader` отвечает сигналами
Session и каждого Subagent, у которого есть transcript. `useManualBindings` вызывает `bindings.get`, а затем следует за `bindings.changed`.
`resolveAgentBindings` применяет правила к обоим источникам и модели workflow, поэтому изменение любого из трёх видно сразу.
`sources/workflow-bindings.ts` вешает невидимые Node-ы-якоря на агентов и цели, а `edges/bindings.ts` рисует линии между ними.

**Главные test-ы.**

- `test/e2e/binding.spec.ts`: claim, папка worktree, `/epic-wave` и задача в приложении; перетаскивание, которое переживает перезапуск; удаление.
- `test/contract/bindings.test.ts`: reader над синтетическим Claude home, хранилище и каналы.
- `test/unit/binding.test.ts`: сигналы в порядке силы, подписи, чтение записей transcript.
- `test/unit/binding-canvas.test.tsx`, `test/unit/done-shelf-binding.test.tsx`: якоря, какие линии рисуются, цели для отпускания, блок rail.
- `test/unit/ticket-ref.test.ts`, `test/unit/family.test.ts`: формы ветки и папки, Family.
