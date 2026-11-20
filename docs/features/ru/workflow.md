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
- Значки и действия: chip-ы из [Gate and GitHub](gate-and-github.md), chip `Evidence n/m`, число Session в Archive, Ship
  ticket и Open PR.

На карточке ничего не обрезается. Текст переносится, и карточка растёт в высоту, начиная со 138 пикселей при ширине 240. Её
tooltip показывает строку Status с причиной и `(in <branch>)` для статуса, который пришёл из ветки worktree.

**Evidence.** Ticket, в разделе готовности которого есть пункты с checkbox, показывает chip `Evidence n/m`: n пунктов,
подтверждённых их строками Evidence (`- evidence: …` под пунктом, их пишет `ticket evidence` из Harness), из всех m пунктов.
Он зелёный, когда подтверждён каждый пункт, красный, когда какой-то пункт не прошёл, и нейтральный в остальных случаях; его
tooltip пишет `3 verified, 1 not verified, 1 failed`. У Ticket-а без таких пунктов chip-а нет. Только карточка с chip-ом выше
на одну строку chip-ов (18 пикселей): chip-ы проверок занимают свои строки, а chip Evidence начинает следующую. worfy не
сверяет ссылку с её источником, например, зелёный ли CI run. Грамматика строк, кто их пишет, privacy check и картинки описаны
на странице [Evidence](evidence.md).

**Статус.** Он берётся из строки `Status:` файла. Без строки Status или при старой форме шапки читается `no status`. В Full
mode статус ветки worktree Ticket-а идёт поверх статуса из checkout, поэтому Ticket, который взяли в его worktree, сразу
показывает `claimed`. Ветка не меняет Ticket, который в checkout `blocked` или `done`, а ветка со статусом `open` или без
статуса не меняет ничего. В Silent mode ветки не читаются.

**Focus mode.** Двойной клик по карточке открывает Ticket в Focus mode: весь файл как markdown под той же шапкой. Над
текстом Ticket с пунктами-checkbox в разделе готовности показывает матрицу Evidence: `Evidence · n of m verified`, затем
строку на каждый пункт с его номером, началом его текста и состоянием — `Verified`, `Not verified: <reason>` (например,
`needs windows stable, got windows installed`) или `Failed`, — а под ней строки Evidence этого пункта: вид и вердикт,
платформа и копия, короткий SHA, ref. SHA открывает `<repository>/commit/<sha>`, а `PR #N` открывает
`<repository>/pull/<N>` на странице `origin` Project-а, https URL открывается как есть, всё в браузере; без страницы
`origin` SHA и PR остаются текстом. Путь в обратных кавычках разрешается от папки файла Ticket-а и открывается в программе
по умолчанию системы. Строка `screenshot`, файл которой лежит в `<epic>/evidence/`, показывает под собой миниатюру; клик
открывает картинку поверх окна с «Open in default app». Клип строки `video` (webm или mp4) проигрывается на месте, без
звука, со своими элементами управления, а «Contact sheet» рядом открывает лист поверх окна. Файл, который не загрузился,
пишет «File not found», «File over 8 MB» (worfy отдаёт файлы Evidence размером до 8 МБ) или «File cannot be shown»
(отдан, но это не картинка и не клип, которые рисует окно), с «Open in default app»; об отсутствующем contact sheet
говорится рядом с клипом. Окно на Linked machine preview не показывает. Текст и матрица следуют за файлом: в Full mode с
Ticket-ами в git — за файлом в том виде, какой он в главной ветке (см. «Список читается из главной ветки» ниже), поэтому
правка в папке Project-а видна, когда она попала в main; в Silent mode и вне git — за правками файла. «Open in editor»
открывает файл в папке. Файл больше 1 МБ не читается. Когда чтение не удалось, показывается «The Ticket file could not be
read» с причиной, а прочитанный ранее текст остаётся.

**Frame Epic-а.** В шапке — имя Epic-а, H1 его `spec.md`, полоса прогресса из 12 сегментов, счётчик `done/total`, счётчик архивных Session, когда они есть, Run wave и
кнопки [Autopilot](autopilot.md). Колонки внутри идут слева направо:

| Колонка | Ticket-ы |
|---|---|
| `Done` | Завершённые Ticket-ы, сложенные в одну стопку с их номерами, пока её не откроет «Expand» |
| `Level 1`, `Level 2`, … | Остальные, по зависимостям. В Level 1 нет незавершённых blocker-ов, не считая blocker-ов из `Needs attention` |
| `Needs attention` | Ticket-ы, блокировку которых нельзя прочитать: «Blocked by» не список, blocker вне Epic-а, цикл. Строка карточки называет причину |

Стрелка идёт от blocker-а к Ticket-у, который он блокирует. Она пунктирная, пока blocker не завершён, и бледная, пока не лежит
на подсвеченной цепочке Node-а под курсором или выбранного Node-а. Стрелка завершённого blocker-а сплошная и рисуется только
при подсветке. Стрелка рисуется, только когда у обоих Ticket-ов есть карточка на Canvas.

**Sidebar и Command palette.** Секция Epics перечисляет Epic-и активного Project-а — при «All Projects» в Project switcher
sidebar-а затем Epic-и каждого другого Project-а, у которого они есть, каждый под его именем (см.
[App shell](app-shell.md#sidebar)), — с их прогрессом, `N in work` и тем, сколько прошло с их последней работы («2h»,
«3d»); клик центрирует frame. Последняя работа Epic-а — самая новая смена
статуса среди его Ticket-ов (время строки `Status:`: claim, block, done). Epic, ни один Ticket которого ещё не менял
статус, берёт время последней записи своего `spec.md`. Сначала идут Epic-и с Ticket-ом в работе, потом остальные по
последней работе, новые сверху. Epic без Ticket-а в работе и без работы дольше порога уходит в группу «Older · N» внизу
секции — и закрытый, и с открытыми Ticket-ами. Группа свёрнута, пока её не откроет клик, и складка помнится для каждого
Project-а. Порог — «Fold Epics without work after» в Settings → General: Never, 3, 7 или 30 дней, по умолчанию 7; Never
оставляет все Epic-и в списке. В Command palette есть строка «Go to» для каждого Epic-а и Ticket-а, а для Ticket-а без карточки она
центрирует frame. Каждая неотмеченная ручная проверка Ticket-а (пункт его раздела готовности с ручной пометкой из Profile) —
строка Command palette, которая находится только при вводе текста. Выбор строки ведёт к Ticket-у. worfy эти пункты не отмечает.

**Ready Wave** вычисляется для каждого Epic-а и нигде не хранится. Ticket входит в неё, когда:

- Он `open`.
- Его «Blocked by» читается, и у него нет blocker-а вне Epic-а. Цикл, все остальные участники которого завершены, циклом не
  считается.
- Каждый blocker завершён в checkout. Blocker, завершённый только в невлитой ветке worktree, ещё не завершён.
- Ни один файл его раздела со следом не пересекается с занятым файлом. Свои файлы занимают Ticket-ы в работе и Ticket-ы,
  завершённые только в ветке, а также каждый Ticket, уже взятый в эту Wave, по порядку номеров. Запись с `/` на конце занимает
  всю папку.
- Его ветка worktree, если она есть, прочитана. Открытый Ticket, ветку которого прочитать не удалось, может быть взят
  там: он не входит в Wave и занимает свои файлы, пока чтение ветки не удастся.

Ticket без раздела со следом может быть в Wave: он ничего не занимает. У Ticket-ов Wave есть chip `Ready`, а подпись Level 1
показывает `Ready wave · N`.

**Действия.** Ship ticket и Run wave отправляют шаблон действия Project-а, заполненный значениями `{epic}`, `{NN}`, `{wave}`,
`{slug}`, `{branch}` и `{tickets}`. С плагином Harness по умолчанию это `/worfy:ship-ticket {epic} {NN}` и
`/worfy:epic-wave tickets {tickets} of epic {epic}`. Оба действия есть и в строках Command palette. Неактивная кнопка называет
причину в tooltip.

| Действие | Показано | Активно, когда | Что делает |
|---|---|---|---|
| Ship ticket | На Ticket-е, который `open`, `blocked` или без статуса | Он `open`, каждый blocker завершён в checkout, запущенная этой кнопкой Session этого Ticket-а не жива, шаблон задан и заполняется | Новый Session Node с текстом как первым сообщением, справа от полосы frame-ов на высоте Ticket-а. Если их нет на Canvas — там, куда попадает любой новый Node. Из Command palette место не передаётся: Node попадает туда, куда и любой новый Node |
| Run wave | На frame, если не все его Ticket-ы завершены | Ready Wave не пуста, шаблон задан и заполняется | Текст уходит Orchestrator-у, в очередь, пока идёт turn. Отказ, пока в Project-е работает Autopilot |
| Open PR | На Ticket-е с PR | Адрес на `https://github.com/` | Открывает PR в браузере и ничего не пишет в GitHub |
| Resolve conflicts, Fix checks, Address comments | На Ticket-е, PR которого есть в PR inbox Project-а и требует одного из них: одна кнопка для первой причины в порядке Resolve conflicts (у PR конфликт), Fix checks (его CI падает), Address comments (запрошены изменения или thread ждёт ответа пользователя), а рядом «▾» с остальными причинами. Ticket с PR в нескольких репозиториях получает пункт на каждую пару PR и причины, и каждый называет свой PR. Project с `"prInbox": false` не показывает ни одного | PR принадлежит самому пользователю и не из fork, причина ещё есть, шаблон задан и заполняется. Ещё main отказывает, пока в Project-е работает Autopilot и пока Orchestrator занят Wave Epic-а этого Ticket-а (эта Wave сама чинит свои pull request-ы) | Передаёт PR Session с шаблоном, заполненным значениями `{repo}`, `{pr}` и `{sha}`: Session Claude Code, связанной с Ticket-ом, когда в её transcript писали за последние 24 часа, иначе новому Session Node справа от полосы frame-ов на высоте Ticket-а; из Command palette место не передаётся, и Node попадает туда, куда и любой новый Node. Сначала main заново читает PR; его отказ становится tooltip кнопки или «▾» |

Шаблон с неизвестной подстановкой или с подстановкой без значения не заполняется, и ошибка становится причиной на кнопке. При
клике на Ship ticket или Run wave worfy читает workflow заново и принимает то же решение ещё раз, поэтому Ticket, который тем
временем взяли в терминале, не запускается дважды. Запущенный агент сам меняет статус командой `ticket claim`.

**Пусто и ошибка.** Project без Epic-ов показывает надпись «Plan your first epic →» над Minimap, справа внизу Canvas
(в том же углу, когда Minimap скрыт). Нажатие открывает Orchestrator-а и ничего ему не отправляет. Frame без Ticket-ов пишет «No tickets in this epic.» Когда workflow нельзя прочитать, на Canvas нет frame-ов,
а секция Epics показывает причину.

#### On a Linked machine

Epic-и и Ticket-ы читаются на Machine Project-а, только для Project-ов из её списка. На экране только для чтения Ship ticket, Run
wave, Resolve conflicts, Fix checks, Address comments, сворачивание frame и «Plan your first epic» неактивны и объясняют почему. С правом записи действия выполняются на Machine
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
- **Список читается из главной ветки, а не из папки Project-а**
  ([ADR-0107](../../adr/0107-workflow-read-from-main-branch.md)). В Full mode с Ticket-ами в git Epic-и, Ticket-ы, spec-и,
  текст Ticket-а, `HANDOFF.md` и ADR берутся из одного commit-а: `origin/HEAD` (иначе `origin/<main>`), когда Ticket-ы
  заканчиваются PR, и локальная `<main>` для `local-green`. `<main>` — ветка из `worktree.base` Profile, иначе `main`. В
  `local-green` папка на `<main>` или на ветке Ticket-а читается как есть, потому что Harness пишет статус туда до commit-а.
  Папка, которая отстаёт, стоит на detached HEAD или другой ветке либо содержит неотслеживаемые файлы, список не меняет.
  Пока окно показывает Project, worfy запускает `git fetch --prune origin <main>`, когда окно открывает его, каждые 2
  минуты и когда окно получает фокус (не чаще раза в 30 с); Project, за которым следят только Autopilot или уведомления,
  fetch не получает, а fetch из терминала тоже виден. Fetch ничего не спрашивает: ни запроса пароля, ни окна credentials,
  ssh в batch mode (`-o BatchMode=yes` получает только команда, которая сама запускает ssh, после ведущих слов
  `NAME=value` и `env`; plink, TortoiseGitPlink и другие программы остаются как есть). Неудавшийся fetch оставляет список
  прежним. Когда git не может прочитать главную ветку для `HANDOFF.md` и ADR, они сохраняют последнее чтение; на старте,
  когда чтения ещё не было, Node HANDOFF и секция ADR пишут, что их не удалось прочитать, с ошибкой git, а не что их нет. В
  обоих случаях они читаются снова через 2 с, затем каждый раз через вдвое больший срок, до раза в минуту, и сразу, когда
  ветка сдвигается. Canvas tools Session (`link_card`) и Browser tools сверяют свои цели-Epic-и и Ticket-ы с этим же
  чтением. Статус ветки worktree Ticket-а по-прежнему идёт поверх статуса из main, как и собственная ветка папки, когда
  она называет Ticket. Silent mode и корень Ticket-ов вне git читают папку, как раньше. Когда главная ветка не
  разрешается (нет `origin`), читается папка, а секция Epics показывает «As of <commit>» с причиной; та же строка со
  временем последнего обновления появляется, когда fetch не удаётся 10 минут.
- **Заголовки задаёт Profile.** Их называют `tickets.trail_section`, `tickets.done_section` и `tickets.manual_mark`. Без них по
  умолчанию действуют `## Where in code`, `## Done when` и `manual`, а старые русские названия тоже читаются.
  Метка ручного пункта читается в трёх видах, что бы ни назвал Profile: его собственная, `manual` и старая русская
  `вручную`. Поэтому `(manual)` — ручной пункт в Project-е, чей Profile называет `вручную`, и наоборот.
- **Чтения следуют за изменениями.** Событие файла под корнем Ticket-ов ведёт к одному полному `epic-status` после 300 мс тишины
  и не позже чем через 1 с после первого события серии. Когда список читается из главной ветки, одно событие файла ничего
  заново не читает: список читается снова, когда эта ветка сдвигается (fetch, merge). Чтения не накладываются друг на друга.
  В Full mode отслеживаются ещё git refs и список worktree, и заново читаются только ветки, у которых сдвинулся head, по
  четыре за раз. Ветка, чтение которой не удалось, сохраняет статус из своего последнего удачного чтения и читается снова
  сама по себе через 30 с, затем через 1 мин, 2 мин и каждые 5 минут, пока чтение не удаётся; новый commit на ней
  начинает ожидания заново. Неудавшийся `git worktree list` — такое неудачное чтение сразу для всех веток: ни один worktree
  не считается исчезнувшим, каждая ветка сохраняет статус из своего последнего удачного чтения, а каждый открытый Ticket
  считается Ticket-ом, ветку которого прочитать не удалось (он не входит ни в одну Wave), пока список не прочитается снова
  с теми же ожиданиями. Разовое чтение, у которого нет прежнего чтения, переспрашивает неудавшийся список ещё раз сразу,
  если только список не вышел за время (60 с): зависший git снова задержал бы чтение так же надолго. Собственные чтения
  workflow у Autopilot считают список, который не удался дважды или один раз по timeout, неудачным чтением workflow. На
  старте run-а это отклоняет старт («Cannot read the workflow: …»), а run, который ждал Orchestrator-а, заканчивается с
  `start-refused`. После turn-а Orchestrator-а это останавливает run с `workflow-error`. Чтение, которое отправляет «Run
  wave», вместо этого придерживает открытые Ticket-ы. Список, который не удался именно тогда, отправляет только прерванные
  Ticket-ы, которые первая Wave run-а забирает обратно после Force stop или `session-error`; когда отправлять нечего, run
  останавливается с `send-failed` («No ready wave»). На macOS корень Ticket-ов, который не является папкой, ищется каждые
  2 с. Отслеживаются только файлы, которые читает `epic-status`: папки Epic-ов, `spec.md`, `map.md` и `issues/*.md`; и Code
  story, которые worfy читает сам: `story.md` Epic-а и `stories/*.md`.
- **Epic перечисляет свои Code story.** `story.md` Epic-а и story PR его Ticket-ов, `stories/NN-<slug>.md`, читаются из
  того же места, что его spec и Ticket-ы: из главной ветки или из папки в Silent mode. Модель несёт, где лежит каждая, и
  hash её текста; сама story читается, когда её открывают, и файл, который не подходит под формат
  `harness/bin/TICKETS.md`, тогда называет причину. Код шага берётся из git, когда шаг показывается: фрагмент ищется по
  его коду в commit-е, который добавил story в главную ветку (в Silent mode — в merge commit PR этой story или в её head до
  merge, прочитанном через `gh pr view` один раз на PR: ответ о влитом PR хранится, об открытом — минуту), и показывается
  с номерами строк этого commit-а. Silent story, в шапке которой всё ещё `PR -`, берёт свой PR из строки `PR:` своего
  Ticket-а. Когда в этом commit-е фрагмента в таком виде уже нет или такого commit-а нет (Silent story, у Ticket-а которой
  ещё нет PR, commit, которого нет в этом клоне), показывается собственный код story с пометкой, что это код head PR, и с
  причиной.
- **Code story открывается там, где её Epic или Ticket.** Story view показывает story на всю главную область; Esc
  возвращает к Canvas. Она открывается из **Code story** на frame Epic-а, рядом с его архивными Session, и в **⋯** frame;
  из **Code story** на карточке Ticket-а, рядом с **Open PR**; из **Code story** pull request в
  [Pull requests](pr-inbox.md); из **Open code story** в Command palette — строки на каждый Epic и каждый Ticket со
  story; и из toast «The Code story of Epic <name> is ready» с **Open**. На карточке **Code story** неактивна, с причиной,
  у Ticket-а, который завершён и не называет PR; у Ticket-а без PR и без story кнопки нет. Toast приходит один раз на
  Epic, когда worfy впервые видит его `story.md`, и больше никогда: Epic-и, для которых он показан, хранятся в local
  storage окна в папке данных worfy. При первом чтении Project-а worfy только отмечает story, которые уже есть, поэтому
  Project с завершёнными Epic-ами не приносит пачку toast-ов. Story PR toast не даёт. Когда story нельзя прочитать,
  **Open** показывает причину в toast с ошибкой.
- **Code story можно сделать кнопкой.** Там, где файла story нет, — frame Epic-а до появления `story.md` Epic-а,
  карточка Ticket-а, у `PR:` которой нет `stories/NN-<slug>.md` (её PR читается в репозитории, который называет строка
  `PR: <repo>#N`), и любой pull request в [Pull requests](pr-inbox.md) без неё (обычной Session, коллеги, старый), —
  **Code story** строит story. Сборка невидима: ни Session, ни Session Node, только полоса прогресса с последними
  строками того, что читает агент, и **Stop** — на Canvas панель под кнопкой поверх frame и карточек, в Pull requests на
  месте кнопки; затем на ней открывается Story view. **Stop** работает с момента нажатия, в том числе пока worfy ещё
  читает PR из GitHub. Это один запрос к Vendor Project-а, с Read, Glob и Grep только внутри checkout PR и без плагина
  Harness; Project на Codex показывает причину в полосе и ничего не запускает. Для PR worfy читает его diff, его текст,
  файл его Ticket-а и вердикты review GitHub-аккаунта Project-а через gh (только чтение); для Epic-а — его spec и story
  его влитых PR, каждую с head её PR, прочитанным из GitHub, а Ticket-ы, которые ещё не готовы, отмечаются в конце
  Start. Story хранится в `stories.json` папки данных Project-а: повторное нажатие **Code story** открывает её без
  запроса, а **Rebuild story** в Pull requests строит её заново. Из PR коллеги worfy хранит только текст агента — не текст
  PR, не его комментарии и не его заголовок. Остановленная или неудавшаяся сборка ничего не сохраняет, а уход с экрана во
  время сборки останавливает её.
- **Вопрос о строках story.** Строки, выделенные в коде шага, или весь фрагмент через «Ask a question» открывают после
  себя поле вопроса. Вопрос уходит в разовый запрос к Vendor Project-а — без Session и без Session Node — со story, diff
  PR, его текстом и вердиктами review (последние 20 комментариев `VERIFIED` и `REJECTED` собственного GitHub-аккаунта
  Project-а, прочитанные через `gh`), файлом Ticket-а, выделенными строками и вопросом (не больше 2 000 символов); каждая
  часть обрезается до своего предела, а то, что нельзя прочитать, называется в запросе, и вопрос идёт без него. Запрос
  читает только один checkout: git worktree, где checkout-нут head PR этой story, иначе папку Project-а. Для story,
  сделанной кнопкой, renderer называет ключ, под которым она хранится (`owner/name#N`); тогда checkout — worktree этого
  репозитория на head, иначе его клон, а `gh` читает PR этого репозитория. Пока запрос идёт, на месте поля стоят полоса
  прогресса с последними строками агента и Stop; затем ответ показывается после тех же строк: текст агента, на что он
  опирается (код, story, текст PR, вердикт review или «no support» словами story), и строки, которые он цитирует, как
  `path:line` на HEAD checkout. Ответы хранятся в `stories.json` данных worfy по тому, что называет story, — её файлу или,
  для сделанной кнопкой, её PR или Epic-у — и показываются снова, когда story открывают, в том числе после правки: тогда с
  пометкой, что вопрос задан о более раннем тексте story. Ответ называет шаг по его Ticket-у и его номеру внутри главы
  этого Ticket-а, поэтому глава, которая стала готовой раньше, ничего не сдвигает; ответ о строках или файле, которых шаг
  больше не показывает, перечисляется в конце его карточки кода или шага с той же пометкой. Поле и ответ говорят на языке
  story. Остановленный или неудавшийся вопрос ничего не сохраняет.
- **Story помнит, что прочитано, и может заканчиваться «Check yourself».** Каждый показанный экран отмечается
  прочитанным в полосе сегментов, и при Project-е отметка хранится в `stories.json` данных worfy под тем же именем, что
  ответы story, никогда не в репозитории: после перезапуска story открывается с отмеченными прочитанными экранами.
  Отметка шага называет его Ticket и его номер внутри главы этого Ticket-а, поэтому глава story Epic-а, которая стала
  готовой раньше, не сдвигает ни одной отметки. Story с вопросами заканчивается экраном «Check yourself»: у каждого
  вопроса есть поле для ответа своими словами и «I don't know»; правильный ответ скрыт, пока не дан один из них, затем
  показывается со строками, на которые он опирается, а строка, которую показывает шаг story, открывает этот шаг. Ответы
  хранятся так же, по одному на вопрос. От отметок и ответов ничего не зависит. У story без вопросов такого экрана нет.
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
- Отсутствующий корень Ticket-ов ожидается у ближайшей папки над ним. Неудачный взгляд на корень повторяется каждые 2 с, а после пяти
  неудач подряд — каждые 30 с.
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
| Code story: формат, файл story, код фрагмента, story, сделанные кнопкой | `src/shared/stories/parse.ts`, `src/shared/stories/schema.ts`, `src/main/ipc/stories.ts`, `src/main/stories/code.ts`, `src/main/stories/store.ts` |
| Входы в Story view и toast story Epic-а | `src/renderer/stories/open.ts`, `src/renderer/canvas/actions/EpicStory.tsx`, `src/renderer/canvas/actions/TicketStory.tsx`, `src/renderer/stories/story-toast.ts`, `src/renderer/stories/use-story-toasts.ts` |
| Вопрос о строках Code story | `src/main/stories/ask.ts`, `src/renderer/stories/LineQuestion.tsx`, `src/renderer/stories/story-answers.ts` |
| Отметки прочтения и «Check yourself» Code story | `src/renderer/stories/SelfCheck.tsx`, `src/renderer/stories/story-marks.ts`, `src/main/stories/store.ts` |
| Code story, сделанная кнопкой: её материал, сборка и Stop, кнопка и её полоса прогресса | `src/main/stories/by-button.ts`, `src/main/stories/one-shot.ts`, `src/renderer/stories/StoryBuildButton.tsx`, `src/renderer/stories/story-build.ts` |
| Общая копия в renderer | `src/renderer/workflow/useWorkflow.ts` |
| Frame-ы и карточки как Node-ы; колонки; высота карточки | `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/ticket-card.ts` |
| View | `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/nodes/TicketBody.tsx`, `src/renderer/canvas/nodes/ticket-text.ts`, `src/renderer/canvas/nodes/EpicFrameNode.tsx` |
| Evidence: состояния пунктов, chip, матрица, её снимки и клипы | `src/shared/workflow/evidence.ts`, `src/renderer/canvas/badges/Evidence.tsx`, `src/renderer/canvas/nodes/EvidenceMatrix.tsx`, `src/renderer/canvas/nodes/EvidencePreview.tsx`, `src/main/images/stores.ts`, `src/renderer/canvas/badges/evidence.css` |
| Стрелки | `src/renderer/canvas/edges/blocking.ts` |
| Sidebar, Command palette, надпись первого Epic-а | `src/renderer/shell/sidebar/EpicsSection.tsx`, `src/renderer/shell/sidebar/epics-order.ts`, `src/renderer/palette/commands.ts`, `src/renderer/canvas/overlays/FirstEpic.tsx` |
| Кнопки | `src/renderer/canvas/actions/TicketActions.tsx`, `src/renderer/canvas/actions/EpicActions.tsx`, `src/renderer/canvas/actions/OpenPr.tsx`, `src/renderer/canvas/actions/PrFollow.tsx`, `src/renderer/canvas/actions/pr-follow-choices.ts`, `src/renderer/canvas/actions/gates.ts` |
| Может ли действие выполниться; шаблоны | `src/shared/actions/render-template.ts`, `src/shared/projects/action-templates.ts` |
| Запуск работы | `src/main/actions/launch.ts`, `src/main/ipc/actions.ts`, `src/shared/ipc/actions.ts` |

**Поток данных.** Первый view Project-а в каждом окне вызывает `workflow.open`. `WorkflowHub` держит один watcher на Project,
запускает `epic-status`, кладёт статусы веток поверх checkout и отвечает моделью. После каждого чтения, которое что-то изменило,
каждый подписчик получает `workflow.changed` только с изменившимися Epic-ами и Ticket-ами. Renderer применяет его к своей общей
копии, а `sources/epics.ts` превращает копию в Node-ы. Тот же hub обслуживает Stage-ы, Autopilot и уведомления об ожиданиях.

**Главные test-ы.**

- `test/e2e/epic-frame.spec.ts`, `test/e2e/ticket-focus.spec.ts`, `test/e2e/ship-ticket.spec.ts`, `test/e2e/ticket-evidence.spec.ts`:
  Feature в приложении.
- `test/contract/workflow-reader.test.ts`, `test/contract/tickets-read.test.ts`, `test/contract/actions.test.ts`: stub
  `epic-status`, запущенный как дочерний процесс, проверка файлов и каналы.
- `test/unit/waves.test.ts`, `test/unit/epic-layout.test.ts`, `test/unit/ticket-card.test.tsx`,
  `test/unit/render-template.test.ts`, `test/unit/launch.test.ts`: чистые правила; последний ещё запускает `ActionLauncher` над fake-ами.
- `test/unit/evidence-matrix.test.tsx`: chip Evidence, матрица и куда ведут её ссылки.
- `test/unit/story-entries.test.tsx`, `test/unit/story-toast.test.ts`, `test/e2e/code-story.spec.ts`: входы в Story view,
  toast story Epic-а один раз на Epic, код фрагмента, запрошенный там, где story привязана.
- `test/contract/story-by-button.test.ts`, `test/unit/story-progress.test.tsx`, `test/e2e/code-story.spec.ts`: story,
  сделанная кнопкой, — что содержит запрос, PR коллеги хранится без его слов, Stop ничего не сохраняет, сохранённая story
  открывается без запроса, каждая глава story Epic-а на head своего PR, брошенная сборка останавливается.
- `test/unit/story-parse.test.ts`, `test/contract/story-code.test.ts`, `test/contract/story-store.test.ts`: формат Code
  story на общих fixture из `harness/bin/tests/fixtures/code-story/`, код фрагмента из git, хранилище.
- `test/contract/story-ask.test.ts`, `test/unit/story-ask.test.ts`, `test/unit/line-question.test.tsx`: вопрос о строках
  story — что запрос содержит и читает, schema ответа, Stop, поле и ответ после строк.
- `test/unit/story-self-check.test.tsx`, `test/contract/story-store.test.ts`, `test/contract/stories-handler.test.ts`,
  `test/e2e/code-story.spec.ts`: «Check yourself» и отметки прочтения — ответ скрыт, пока не дан свой, его ссылки на шаги,
  отметки по Ticket-у и шагу, и то и другое сохраняется после перезапуска, а репозиторий не тронут.
- `test/contract/workflow-watch-retry.test.ts`: повторы чтения layout.
- `test/contract/workflow-read-from-main.test.ts`, `test/contract/canvas-workflow-from-main.test.ts`,
  `test/contract/docs-first-read-retry.test.ts`, `test/contract/workflow-fetch-guard.test.ts`: чтение из главной ветки,
  чтение canvas tools, документы после неудачного первого чтения и защита fetch в test-ах (URL после `insteadOf`).
- Windows: `test/unit/tickets-watch.test.ts`, `test/unit/workflow-remote-links.test.ts`, `test/contract/workflow-watch-links.test.ts`,
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
  of facts» с причиной; ветка worktree, которую не удалось прочитать, — одна из причин, по имени, не больше трёх, а
  остальные посчитаны.
- **Секция Pipeline в sidebar:** Ticket-ы каждого Project-а этой Machine, которые не стоят ни на Queued, ни на Done; только
  активного Project-а, пока Project switcher sidebar-а стоит на одном Project-е. На её иконке в rail есть точка, пока один
  из них заблокирован или кого-то ждёт. Клик открывает board этого Project-а. Без таких Ticket-ов она пишет «Nothing in work».

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
| Release | Выполнена каждая строка `Release:` Ticket-а: tag есть в remote репозитория библиотеки или версия опубликована. Ticket без таких строк проходит сразу (см. ниже) |
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
| Waits | Строка `Waits:`, иначе `team` на Human review, Release и Awaiting merge, иначе `agent`. На Done нет | `Waits: <who>` | `<who>` |
| Answers | На Human review review threads его PR ждут ответа пользователя, по данным [PR inbox](pr-inbox.md) (см. [PR и CI badges](gate-and-github.md#pr-и-ci-badges)) | `Waits: 2 answers` | Нет |
| Stuck | Время на Stage достигло порога | Рамка и `stuck: on CI for 3 h` в tooltip | То же |

**Пороги stuck.**

| Ticket | Порог |
|---|---|
| У Stage есть `stuck_after` | Это значение |
| На Human review, Release или Awaiting merge, либо `Waits:` — `owner` или `team` | 24 часа |
| На Implementing, CI, Agent review или Gate & merge | 2 часа |
| Queued, Check, Deploy или Closing | Нет |
| Done | Никогда, в том числе с `stuck_after` |

Время на Stage считается от последнего известного факта: времени статуса или времени отметки, check-а или merge, которые прошли
последний Stage. Без известного времени Ticket не оценивается. Часы на экране обновляются раз в минуту.

**Settings → Pipeline** правит Pipeline активного Project-а в пределах каталога: 12 видов, без собственных условий пользователя.
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

**Уведомление** приходит, когда Ticket начинает ждать человека, то есть его `Waits:` — `owner` или имя Machine, и ни одно окно worfy на Machine, которая его показывает, не в фокусе. Заголовок —
`<epic> NN is waiting for you`, текст — причина блокировки или `<epic> NN — <title>`, а клик открывает board Project-а. `team` и
`agent` уведомлений не дают, как и другие переходы, например красный CI. Одно ожидание уведомляет не больше одного раза: ожидание, начатое при окне worfy в фокусе, позже уведомления не даёт, а другое ожидание того же Ticket-а в пределах 10 с после его последнего уведомления уведомления не даёт. Ожидание, которое уже было
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
  которому они нужны, обычно на Implementing. `gh` никогда не запускается в корне, который является простой папкой. Ticket с
  двумя и более строками `Repo:` ([ADR-0104](../../adr/0104-one-ticket-several-repositories.md)) получает факты каждого
  репозитория, который он называет: head своей ветки там, найденный по паре (repo, branch), и PR этой ветки там. Каждый
  репозиторий оценивается по своим фактам, а Ticket стоит на самом раннем из их Stage. Поэтому отметка `review`
  засчитывается, только когда она стоит на head каждой ветки, новый head любой ветки снимает вердикт со всего Ticket-а,
  красный CI любого PR — красный CI Ticket-а, а при одном влитом PR Ticket стоит там, где стоит другой PR. Его Stage тогда
  несёт `merged`: у скольких из его репозиториев PR влит, из скольких. У Ticket-а одного репозитория `merged` нет.
  Репозиторий, папка которого не является верхним уровнем его собственного git-репозитория, не даёт ни head веток, ни PR,
  поэтому ни git, ни `gh` не сообщают ветки или PR родительского репозитория; snapshot пишет «<folder> is not the top level
  of its repository, its PRs are not read».
- **Release.** Project над несколькими репозиториями может поставить Stage Release в свой Pipeline
  ([ADR-0104](../../adr/0104-one-ticket-several-repositories.md), пункты 5 и 6). worfy не делает release, он только замечает
  его, для каждой строки `Release:` Ticket-а в работе. `Release: <repo> tag <tag>` выполнена, когда `git ls-remote --tags
  origin refs/tags/<tag>` в checkout этого репозитория перечисляет tag. `Release: <repo> package <name>@<version>`
  выполнена, когда `npm view <name>@<version> version` печатает версию; команда запускается в checkout первого другого
  репозитория Ticket-а, потребителя, поэтому действуют `.npmrc` и настройки registry этого checkout. Версия, которую npm не
  находит (пустой вывод или ошибка E404 `No match found for version` с exit code 1, которую даёт npm 11), ждёт. Обе
  команды запускаются с окружением login shell. Remote или registry, который не отвечает, пакет, которого npm не находит
  вовсе (E404 `Not Found - GET …`: нет доступа к registry или опечатка в имени), папка, которая не является верхним
  уровнем своего репозитория, и ref, который не является простым именем tag (буквы, цифры и `._/+-@`, поэтому форма
  changesets `@scope/name@1.4.0` подходит) или `<name>@<version>` с простой версией (`1.4.0`, `1.4.0-rc.1`; не `latest`,
  `v1.4.0` и не `1.4.0+b1`), дают «not checked», никогда не released, и строку в причинах snapshot. Stage-ы никогда не
  ждут этих команд: все строки спрашиваются одновременно в фоне, чтение берёт последний ответ или «not checked» до
  первого, а ответ, который меняет известное, заново вычисляет Stage-ы. Ответ запрашивается снова через 5 минут, а
  однажды замеченный release сохраняется. Каждый репозиторий ждёт только строк других репозиториев, Ticket одного
  репозитория — не своих, поэтому библиотека идёт дальше к своему review и merge, пока потребитель ждёт. Пока репозиторий
  ждёт, его CI не оценивается: красный CI потребителя до release не помечает Ticket `failing`; после release красный CI
  снова красный. Stage Ticket-а несёт `release`, каждую строку с `released`, `waiting` или `not checked`, для board.
  Project без Release в Pipeline не видит такого Stage, его строки `Release:` ничего не меняют, и ничего не спрашивается.
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
| Наступил ли release | `src/main/workflow/release.ts` |
| Чтение отметок | `src/main/workflow/marks.ts` |
| Трекер PR; Deployments | `src/main/github/prs.ts`, `src/main/github/deployments.ts` |
| Pipeline из Profile | `src/main/workflow/profile.ts` |
| Копия правил в Harness | `harness/lib/pipeline.cjs` |
| IPC, чтение и запись редактора | `src/shared/ipc/pipeline.ts`, `src/main/ipc/pipeline.ts` |
| Общая копия в renderer | `src/renderer/pipeline/usePipeline.ts` |
| Board, stepper, общие формулировки | `src/renderer/pipeline/PipelineBoard.tsx`, `src/renderer/pipeline/Stepper.tsx`, `src/renderer/pipeline/board.ts` |
| Секция sidebar; открытие board | `src/renderer/shell/sidebar/PipelineSection.tsx`, `src/renderer/pipeline/open.ts` |
| Редактор | `src/renderer/settings/PipelineSection.tsx` |
| Уведомления об ожиданиях | `src/main/workflow/waits-notify.ts`, `src/main/notify.ts`, `src/renderer/canvas/overlays/NotificationTarget.tsx` |

**Поток данных.** Первый view Project-а вызывает `pipeline.get`. `StageHub` запускает вычисление, которое подписывается на hub workflow
только ради изменений полей. Для каждого чтения `StageReader` берёт Profile, PR, отметки и head веток Ticket-ов в работе и блокировку, а
затем вызывает чистую `stageOf` для каждого Ticket-а. Изменившийся snapshot уходит по `pipeline.changed`. Уведомления об ожиданиях этим
путём не идут: `installWaitsNotifications` следует только за hub workflow, поэтому для них не запускаются `gh`, git и `profile`, пока
ничего не меняется.

**Главные test-ы.**

- `test/e2e/pipeline.spec.ts`: board, claim, который двигает карточку, и строка sidebar, в приложении.
- `test/contract/workflow-stages.test.ts`: факты из настоящего git-репозитория в Full и Silent mode, блокировка и каналы.
- `test/unit/pipeline.test.ts`: `stageOf`, каталог и stuck.
- `test/contract/workflow-release.test.ts`: чтение release на настоящем git и stub `npm`, и Stage Release в main.
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

- **Автоматические Binding никогда не хранятся.** Они каждый раз читаются из transcript-ов или из thread Session Codex
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Хранятся только ручные Binding и Binding запуска, в
  `<Project data folder>/bindings.json`, никогда не в репозитории и не в `~/.claude`
  ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). У агента не больше одного каждого вида. Они лежат в файле, поэтому Binding переживает перезапуск.
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
  если он не сделал claim и не вызвал `/epic-wave` или `/ship-ticket`.
- **Чтение инкрементальное.** Main сворачивает новые строки каждого transcript в состояние, поэтому повторный запрос стоит только того, что
  дописано. Renderer спрашивает снова, когда transcript меняется, и каждые 3 с для живой Session, потому что файл Subagent не отслеживается.
- **Session Codex читается из её thread.** Файла transcript у неё нет. Её команды берутся из её thread Codex через историю
  драйвера Codex тем же разбором, что Bash-команда Claude Code, а ветка — та, что сейчас checkout-нута в папке её последней
  команды. Codex спрашивается снова, только когда список Session Codex Project-а, который запрашивается каждые 30 с,
  показывает, что thread изменился, и сворачиваются только новые события. Её skill-ы и Subagent-ы сигнала не дают. Vendor
  Session — тот, чья история её называет ([Vendors](vendors.md)).
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
| Чтение thread Session Codex | `src/main/vendors/codex/binding.ts` |
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
- `test/contract/codex-binding.test.ts`: Session Codex на fake app-server, связанная по её ветке, чтения только новых
  событий, `bindings.signals` и автоматический Archive.
- `test/unit/binding.test.ts`: сигналы в порядке силы, подписи, чтение записей transcript.
- `test/unit/binding-canvas.test.tsx`, `test/unit/done-shelf-binding.test.tsx`: якоря, какие линии рисуются, цели для отпускания, блок rail.
- `test/unit/ticket-ref.test.ts`, `test/unit/family.test.ts`: формы ветки и папки, Family.
