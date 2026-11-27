# worfy

Приложение для одного пользователя на его Machine-ах: бесконечный Canvas, на котором виден и запускается workflow работы с агентами Claude — Epic-и, Ticket-ы, Session-ы агентов и их Subagent-ы, проверки, — а агенты по ходу разговора собирают Card-ы.

Канонические термины — английские, как в интерфейсе; русский текст вокруг них остаётся русским.

## Canvas

**Project**:
Папка одной работы пользователя, над которой идёт workflow — Epic-и, Ticket-ы, HANDOFF, ADR. Это сам git-репозиторий (например, worfy) или папка над несколькими репозиториями (например, клиент, сервер и общая библиотека одного продукта). Файлы workflow лежат в Workflow folder Project-а. У каждого Project ровно один Canvas.
_Avoid_: проект, space, workspace, пространство, репозиторий (как синоним Project)

**Canvas**:
Бесконечная плоскость Project, на которой лежат Node-ы.
_Avoid_: холст, canvas board, доска

**Node**:
Любой объект на Canvas: Ticket, Session, Card, Terminal и т. д.
_Avoid_: узел, элемент, виджет

**Card**:
Мини-приложение (HTML), которое собрал агент; один из типов Node. Принадлежит Project.
_Avoid_: карточка, card app, виджет, приложение

**Layout**:
Положение и размер Node-ов на Canvas. Это собственное состояние worfy, не часть workflow.
_Avoid_: раскладка, canvas.json

**Derived Node**:
Node, место которого считает worfy из workflow: рамка Epic, Ticket, дерево Subagent-ов. Ticket и дерево Subagent-ов руками не двигаются, рамка Epic — только целиком.
_Avoid_: авто-нода, вычисляемый узел

**Edge**:
Линия связи между Node-ами на Canvas одного из трёх видов: Blocked by (Ticket → Ticket), Binding (Session или Subagent → Ticket или Epic), Subagent (Session → Subagent).
_Avoid_: связь, стрелка, линия (как имя Edge)

**Limits**:
Доля использованных окон подписки Vendor-а и время их сброса; набор окон у каждого Vendor-а свой (у Claude — 5 часов и 7 дней, у Codex — primary и secondary по плану).
_Avoid_: лимиты, usage, квота, расход

**Terminal**:
Node с интерактивной shell-сессией пользователя; агент им не пользуется.
_Avoid_: терминал (как имя Node)

**Browser**:
Node со встроенным браузером Chromium: сайт или веб-приложение, открытое под одним Browser profile. Им пользуются и пользователь, и Session-ы Project-а — по просьбе в чате или чтобы проверить Ticket глазами нужной роли. На Canvas одновременно может быть несколько Browser-ов. Browser, который открыла Session, уходит с Canvas вместе с ней; остаётся — уже как Browser пользователя — тот, который пользователь перехватил или в котором остались несохранённые изменения. Browser бывает **Live** — страница работает — или **Asleep** — на его месте последний снимок страницы, а сама страница закрыта до пробуждения; живых Browser-ов одновременно не больше предела из Settings.
_Avoid_: карточка-браузер, браузерная карточка (Card — другое), webview, preview

**Browser profile**:
Сохранённый вход под одной ролью — куки и данные сайтов, например «admin», «moderator», «user». Пользователь входит в аккаунт сам, Session-ы приходят уже со входом и паролей не видят. Session ведёт Browser под ним только по адресам из списка, который задал пользователь, а Autopilot — только если пользователь это разрешил. Принадлежит Project-у и лежит на Machine ([ADR-0078](docs/adr/0078-browser-node.md)).
_Avoid_: профиль (это Profile), профиль браузера, аккаунт, persona

**Done shelf**:
Ряд chip-ов под видимыми рамками Epic-ов: Epic, у которого все Ticket-ы done и рамка свёрнута, стоит здесь chip-ом с именем и счётом, а не рамкой ([ADR-0075](docs/adr/0075-epic-frames-in-columns-and-done-shelf.md), [ADR-0082](docs/adr/0082-done-shelf-under-visible-frames.md)).
_Avoid_: архив Epic-ов, список готовых

**Archive**:
Место законченных Session-ов, которые worfy убрал с Canvas сам: история своего Ticket-а или Epic-а, а без Binding — popover «Archive». Ничего не удаляет и срока не имеет; это не Trash ([ADR-0076](docs/adr/0076-auto-archive-of-finished-sessions.md)).
_Avoid_: корзина, скрытые (как синоним Archive)

**Family**:
Node и всё, что с ним связано Binding-ом и деревом Subagent-ов: Ticket, его Epic frame, его Session-ы, их Subagent-ы и Browser-ы, которые эти Session-ы открыли. Browser, который пользователь перехватил или в котором остались несохранённые изменения, при уходе своей Session с Canvas остаётся на нём как Browser пользователя и из Family выходит. Подсвечивается при наведении и выделении; Node-ы при этом не двигаются.
_Avoid_: кластер, группа (как синоним Family)

**Changes**:
Вид окна с diff-ом Ticket-а против базы — от merge-base с базовой веткой: commit-ы Ticket-а, ещё не закоммиченные правки и новые файлы, прочитанные из git без единой записи в репозиторий ([ADR-0110](docs/adr/0110-changes-reads-git-writes-nothing.md)), — и с комментариями к строкам, которые по Send уходят Session из списка «To» одним сообщением. Открывается во весь размер окна, как вид Pull requests, и показывает тот же экран diff-а, что Review mode PR; его открывают кнопка Changes на карточке Ticket-а, Open changes в Command palette и блок комментария к коду в чате, а «← Canvas» и Esc возвращают на Canvas ([Changes](docs/features/changes.md)). Node-а Changes на Canvas больше нет (worfy-changes-view 08).
_Avoid_: diff view, Review pane, Files changed

## Workflow

**Epic**:
Набор Ticket-ов под одну цель; живёт в папке `.scratch/<epic>/` Workflow folder Project-а.
_Avoid_: эпик, milestone, проект

**Product owner**:
Человек, который ведёт продукт целиком — что строить, для кого и зачем — и строит его с worfy. «Разработчик» — одна из ролей, которые Product owner берёт на себя (решение владельца 2026-11-07, карта [worfy-product](.scratch/worfy-product/map.md)).
_Avoid_: разработчик (как синоним Product owner), владелец продукта, PO

**Feature**:
Возможность продукта, которой пользуется Product owner: Canvas, Terminal, Autopilot. Живёт дольше любого Epic-а; один Feature меняют несколько Epic-ов, поэтому Epic и Feature — разные вещи.
_Avoid_: фича, функция, capability

**Feature page**:
Страница постоянной документации об одном Feature или нескольких близких, каждому — свой раздел: поведение, принципы работы и техническая реализация в их текущем состоянии. История и причины решений остаются в ADR и Ticket-ах, страница на них ссылается.
_Avoid_: спецификация, feature spec, описание Epic-а

**Ticket**:
Одна единица работы внутри Epic (`issues/NN-slug.md`) со статусом `open`, `claimed`, `blocked` или `done` и списком Ticket-ов, которые его блокируют.
_Avoid_: тикет, issue, задача, task

**Wave**:
Ticket-ы Epic, которые можно брать в работу параллельно прямо сейчас: открыты, все блокеры закрыты, общих файлов нет. Вычисляется, нигде не хранится. В `spec.md` Epic-а Wave-ы заранее планируются и нумеруются таблицей («Wave 3 плана»): это прогноз по `Blocked by` и спискам файлов, а Wave, которую берут в работу, всё равно вычисляется заново в момент запуска.
_Avoid_: волна, batch, спринт

**Stage**:
Место Ticket-а в Pipeline его Project-а, например Implementing, Agent review или Awaiting merge. Вычисляется из статуса Ticket-а, его ветки, PR и отметок проверок, нигде не хранится. Статус Ticket-а — не Stage: один и тот же `claimed` бывает на нескольких Stage подряд; `blocked` — не Stage, а пометка на любом Stage.
_Avoid_: этап (как имя), статус, фаза, step

**Wave brief**:
Короткая сводка Epic-а, которую Orchestrator сохраняет в конце Wave и читает первой в новой Session: что влито, какие Ticket-ы ждут и чего, открытые PR, следующая Wave.
_Avoid_: бриф, handoff (HANDOFF.md — другой документ: состояние всего проекта)

**Pipeline**:
Упорядоченный список Stage, через которые проходит каждый Ticket одного Project-а; свой у каждого Project-а (у одного есть review людьми и ручной merge, у другого — выкатка). Без настройки — Queued, Implementing, CI, Agent review, Gate & merge, Closing, Done. У Project-а над несколькими репозиториями может быть Stage `release`: Ticket стоит на нём, пока не выпущено то, чего ждёт его строка `Release:` — tag в remote репозитория библиотеки или опубликованная версия пакета ([ADR-0104](docs/adr/0104-one-ticket-several-repositories.md)). worfy release не делает, только замечает его.
_Avoid_: воркфлоу (как имя списка), процесс, board

**Autopilot**:
Режим, в котором Wave-ы Epic идут без человека: worfy не даёт Machine уснуть, ждёт сброса Limits и продолжает с того же места; любая точка, где понадобился человек, считается дефектом.
_Avoid_: ночной режим, автономный прогон

**Run**:
Один запуск Autopilot: от старта до остановки ведёт Wave-ы одного Epic-а или очереди Epic-ов по порядку, сколько бы раз он ни ждал занятого Orchestrator-а, Limits или сна Machine. Run начинается со старта — кнопкой Start Autopilot или Start when free в окне запуска, командой в чате, — даже если Orchestrator занят: тогда он сначала ждёт его (Wait `orchestrator-busy`); Start now берёт Orchestrator сразу, останавливая его turn и background tasks (кнопка Start now в строке Autopilot, после окна «Start now?»). Запуск один и тот же, чем бы его ни начали: кнопкой Autopilot, «Run all accepted», командой в чате или просьбой словами («запусти на автопилоте», «работай автономно»). Run ведёт весь Epic, очередь Epic-ов или только названные при запуске Ticket-ы одного Epic-а. У Run свой id и свой журнал событий на той Machine, где он шёл; Wave внутри Run — это раунд раздачи с номером внутри этого Run (в очереди — внутри своего Epic-а, с 1), а не номер Wave из таблицы плана.
_Avoid_: прогон, сессия Autopilot, trace

**Run mode**:
Режим запуска Run-а: правило, по которому Run на границе Wave решает, начинать ли следующую Wave. Режимов три. Fastest — следующая Wave идёт сразу, без budget и без Start window. Budget-aware — Wave начинается, только пока не исчерпан budget: дневная доля недели Limits с reserve. Start window — новые Wave начинаются только внутри Start window; budget тоже действует, если он включён в Settings. Режим выбирается на один Run при запуске, по умолчанию — тот, что стоит в Settings. Действует он только на границе Wave: идущую Wave режим не останавливает, а отказ Limits внутри Wave в любом режиме остаётся жёстким пределом.
_Avoid_: ночной режим, Overnight

**Start window**:
Окно запуска: местное время «с» и «до» (по умолчанию 23:00–07:00, окно может переходить через полночь), внутри которого Run в режиме Start window начинает новые Wave. Новая Wave начинается только внутри окна и только если по p90 своей длительности успеет кончиться до его конца; иначе Run ждёт — это Wait с причиной Start window. Идущая Wave доходит до конца, даже если окно уже закрылось.
_Avoid_: Overnight

**Epic forecast**:
Прогноз Epic-а: диапазон p10–p90 доли 7-дневного окна Limits, которую возьмут оставшиеся Wave Epic-а на этой Machine, по прошлым Wave Project-а (их доле на Ticket); рядом — число оставшихся Wave и Ticket-ов и p90 длительности Wave. Меньше 5 прошлых выборок — «мало данных»: диапазона нет. Это не оценка одной Wave (медиана доли на Ticket, которую tooltip кнопки Autopilot показывает для следующей Wave) и не budget (дневная доля недели с reserve, на которой Run останавливается): Epic forecast ничего не останавливает, он подсказывает при запуске.
_Avoid_: estimate (как имя прогноза на весь Epic: так в коде зовётся оценка одной Wave)

**Span**:
Один отрезок времени на шкале: в Run history — Wave, Ticket, Stage Ticket-а, работа агента, CI run, запуск gate или Wait; в Work track — Run, Wave, turn Session, Subagent, PR, CI run, запуск gate или смена статуса Ticket-а. У Span есть вид, начало, конец (или «не закончен»), исход и, где нужно, причина; Span-ы вкладываются друг в друга. Повтор — новый Span того же вида с номером попытки, а не отдельная сущность.
_Avoid_: этап, шаг (как имя), event

**Wait**:
Span, в котором работа стоит по внешней причине с ожидаемым концом: Limits, Start window (окно запуска), сон Machine, другая Machine, человек, занятый Orchestrator (`orchestrator-busy`), повтор turn-а после временной ошибки API, очередь, background tasks, перезапуск worfy (`restart`: от `run-suspended` или, после падения, от последней строки Journal-а до `run-continued` Run-а, который продолжили после перезапуска; его причина — `quit`, `update`, `shutdown` или `crash`). Wait всегда несёт свою причину. Блокировка Ticket-а — не Wait, а пометка на нём.
_Avoid_: простой, пауза, idle

**Run history**:
Вид одного Run-а Autopilot-а: шкала его Wave-ов, Ticket-ов, агентов, CI и gate, ожиданий и блокировок; считается при открытии из источников. Половина вида Runs рядом с Work track.
_Avoid_: журнал (как имя вида), trace

**Ticket continuation**:
Wave, которой Run продолжает Ticket, оставшийся в работе после хода Wave (`wave-unfinished`) или вернувшийся той же Wave (`no-progress`): Ticket идёт в неё как возобновлённый, а команда Wave несёт строку worfy вида `Continuation 1 of 2 for ticket 05: …`. Не больше двух на Ticket за Run; новый Run считает с нуля.
_Avoid_: Auto-continue (это повтор хода после временной ошибки API или отказа Limits), retry, повтор

**Unknown side effects**:
Метка Ticket-а, у implementer-а которого после перезапуска worfy остался внешний вызов без результата (`git push`, `gh pr merge`, вызов MCP server-а, Subagent): он мог выполниться, а мог и нет. Такой Ticket в продолженную Wave не идёт и остаётся в `claimed` для человека; метку и toast снимает только его «Checked, include». Метка — строка Journal-а `unknown-side-effects`, снятие — `side-effects-checked`; открытая метка переходит к следующему Run-у того же Epic-а ([ADR-0108](docs/adr/0108-work-continues-after-a-restart-of-worfy.md)).
_Avoid_: неизвестные побочные эффекты, side effects без «unknown», in-flight (это отказ повтора Auto-continue), dirty

**Set-aside Ticket**:
Ticket, который Orchestrator по просьбе Run-а перевёл в `blocked` с `Waits: owner` после двух Ticket continuation-ов. Ждёт владельца, поэтому остальные Ticket-ы Epic-а идут дальше, а очередь Epic-ов переходит к следующему. Статус пишет Orchestrator командой `ticket block`, worfy его не пишет.
_Avoid_: пропущенный Ticket, skipped, отложенный (без `Waits: owner`)

**Quiet turn**:
Ход Session, от агента которой дольше порога нет признаков жизни — ни одного события, в том числе скрытого (hook, thinking); открытый запрос разрешения, идущий hook и меняющийся файл вывода живой background task тишиной не считаются. Порог — 10 минут для чипа `busy · quiet N min` и строки с Interrupt и Restart; ход Orchestrator-а в Run-е, тихий 30 минут, останавливает Run с причиной `turn-hung`. Тишина — пометка, а не статус: Session остаётся `busy`.
_Avoid_: silent (Silent mode — режим Project-а), hung (так зовётся только причина остановки `turn-hung`), idle

**PR inbox**:
Вид «Pull requests» Project-а: открытые PR пользователя и запросы ревью у него по репозиториям Project-а, сгруппированные по тому, чей ход (Needs my review, Needs my answer, Needs a fix, Ready, Waiting on others), нити ревью и черновики ответов. Строка поиска над списком находит и любой другой PR, видимый аккаунту Project-а (This Project, Organizations of this Project, All of GitHub); чужой PR из inbox или из результатов поиска открывается в Review mode, и ревью уходит на GitHub только по Submit review. Читает GitHub из main и публикует только по щелчку пользователя: ответ в нити — по Send ([ADR-0105](docs/adr/0105-pr-reply-only-on-the-users-click.md)), ревью — по Submit review ([ADR-0112](docs/adr/0112-pr-review-submit-only-on-the-users-click.md)). Подпись в UI — «Pull requests». Три действия правки PR пользователя — Fix checks (упавшие checks), Resolve conflicts (конфликт с базовой веткой) и Address comments (замечания ревью) — передают PR Session-и Project-а, а push в ветку PR бывает только после ответа пользователя «Push».
_Avoid_: inbox (без PR), входящие, dashboard; для действий правки — голое Fix (так зовутся действие Terminal AI и кнопка строки Health check), autofix

**Review mode**:
Экран ревью одного PR в виде Pull requests: список сворачивается в узкую колонку, на месте панели PR — дерево файлов с отметками Viewed, diff из Changes, нити ревью GitHub на своих строках, pending comments черновика ревью и полоса Your review с Finish review, который открывает диалог Submit review. Открывается кнопкой Start review; черновик ревью — файл на этой Machine, не pending review на GitHub. На Linked machine — только чтение (View changes).
_Avoid_: review screen, режим ревью, Changes view (тот показывает Ticket)

**Required approvals**:
Сколько действующих одобрений есть у PR и сколько требует правило его базовой ветки (rulesets и classic branch protection), chip `1/2`: в строке Pull requests, в ячейке Approvals и в шапке Review mode, на карточке доски Pipeline на Stage Human review и на карточке Ticket-а на Canvas. Правило, которого аккаунт Project-а не видит, даёт `1/?`; решение GitHub `APPROVED` важнее счёта.
_Avoid_: аппрувы, approvals count

**Agent review**:
Способ ревью чужого PR, в котором черновик ревью — комментарии к строкам, итоговый текст и предложенный вердикт — пишет Session с Team reviewer-ом Project-а или, если его нет, с линзами `/worfy:code-review`; человек правит черновик и сам жмёт Submit review, вердикт агента — только подсказка. Другой способ — кнопка Review myself: ревью пишет сам человек. Оба — пункты меню Start review.
_Avoid_: AI review, LLM review, ревью ллмкой, auto review, human review (как имя способа Review myself: «Human review» — Stage Pipeline-а)

**Acceptance**:
Вид ручных пунктов Ticket-ов всех Project-ов Machine, которые ждут проверки владельца, и Ticket-ов, которые ждут его решения, с их Evidence и Stable copy; решение Pass или Fail уходит Orchestrator-у Project-а, и строку `owner-check` в Ticket пишет skill `owner-check` Harness-а, не worfy. Вкладка Acceptance окна, её tooltip — «Checks that wait for you». Не Human review: та Stage ждёт решения ревью на GitHub до merge, Acceptance читает Evidence ручных пунктов, обычно после merge ([страница Feature](docs/features/acceptance.md)).
_Avoid_: приёмка (как имя вида), review queue, inbox; accepted (так говорят о принятом владельцем spec-е Epic-а)

**Delegated check**:
Строка `owner-check` под ручным пунктом Ticket-а, которую Orchestrator пишет по поручению владельца после своей проверки; в самой строке сказано, что проверку поручил владелец, на какой копии и что именно проверено. Отличает её от проверки владельца только этот текст: вид Acceptance показывает её так же.
_Avoid_: автоприёмка, самоприёмка, auto-accept

**Flight Recorder**:
Часть worfy, которая собирает факты Run-а из журнала Autopilot-а, транскриптов, GitHub и логов gate (у Project-а без PR — из файла отметок и git) и строит Run history; своего хранилища нет.
_Avoid_: бортовой самописец, logger

**Work track**:
Лента всей работы Project-а на этой Machine за выбранный период (Day, Week, Month): Run-ы и их Wave-ы, Wave-ы, запущенные руками, turn-ы всех Session и их Subagent-ы, run-ы gate, PR merged; сверху — часы по Epic-ам без двойного счёта параллельной работы. Считается при открытии из тех же источников, что Run history, и из git; своего хранилища нет; часть периода, где источник ничего не хранит, помечена «no data». Работа Linked machine видна только как её PR в GitHub.
_Avoid_: full work track, таймлайн работы, activity log

**Stable copy**:
Собранная копия worfy вне репозитория (на macOS — `~/Applications/worfy-stable.app`, на Windows — папка `%LOCALAPPDATA%\worfy-stable`), из которой Autopilot ведёт Wave-ы самого worfy; обновляется между прогонами — руками или через **Update**.
_Avoid_: стабильная копия, prod-сборка, релиз

**Update**:
Замена Stable copy новой сборкой из `main` вместе с её Harness ([ADR-0089](docs/adr/0089-update-builds-main-in-own-clone.md)).
_Avoid_: релиз, upgrade, обновление версии

**Available update**:
Commit `main` новее запущенной Stable copy, с зелёным CI, который меняет приложение или Harness.
_Avoid_: новый релиз, новая версия (без уточнения)

**Gate**:
Проверка готовности изменений (`gate.mjs`) с исходом «зелено», «красно» или «не удалось проверить».
_Avoid_: проверка, CI (CI — отдельная проверка на GitHub)

**Gate full**:
Полный Gate на одной Machine: lint, typecheck, все test-ы, e2e и проверка собранного приложения; gate fast — то же без e2e и сборки. По [ADR-0083](docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md), с первого зелёного check `ci-ok` на `main`, gate full — не условие merge, а инструмент implementer-а и разбора сбоя; условие merge — зелёный `ci-ok` CI на GitHub. До этого момента gate full на Mac — условие merge каждого PR с кодом.
_Avoid_: полный гейт, полная проверка, full gate, ci-ok (как синоним)

**Windows verdict**:
Ответ на вопрос, работает ли изменение PR на Windows. С первого зелёного `ci-ok` на `main` (ADR-0083) для каждого PR это job `windows` в составе check `ci-ok` CI на GitHub-hosted runner-е; для платформенного PR, который трогает то, чего runner не проверяет (Terminal, окна, меню, уведомления, e2e, упаковку), — Gate full на Windows-ПК владельца. Какой из двух нужен, решает скрипт scope, а не человек ([ADR-0083](docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md)). С [ADR-0086](docs/adr/0086-pc-gate-full-once-per-wave.md) этот gate full идёт не на head PR, а на `main` после merge: PR со scope `pc` вливается по `ci-ok`.
_Avoid_: проверка Windows, Windows-гейт, `check/windows` (это отметка, в которой Windows verdict записан)

**Push run**:
CI run на GitHub, который запускает push в `main`, то есть merge PR; свой у каждого commit-а `main`. Проверяет `main` целиком после merge — в том числе сочетание PR, которые влиты друг за другом. По [ADR-0103](docs/adr/0103-merge-without-rebase-for-a-fresh-base.md) первый красный push run называет виноватый PR.
_Avoid_: batch CI run (это один run на Wave по ADR-0068), main CI

**Rebase for a fresh base**:
Rebase ветки PR на свежий `main` без конфликта, только чтобы CI прошёл на базе с последними merge-ами. С [ADR-0103](docs/adr/0103-merge-without-rebase-for-a-fresh-base.md) не нужен: PR с зелёным `ci-ok` на своём head вливается и при ушедшей вперёд базе; rebase нужен только при конфликте.
_Avoid_: обновление ветки, update branch (кнопка GitHub делает merge `main` в ветку, а не rebase)

**Harness**:
Набор правил, skills, агентов, скриптов и hooks, по которому агенты Claude ведут работу над Project: Epic-и, Ticket-ы, Wave-ы, Gate, ревью. В Harness входит и qmd — поиск по документам и Ticket-ам Project. worfy ставит и обновляет Harness; остальные личные skills, MCP-серверы и память пользователя в него не входят.
_Avoid_: kit, обвязка, тулинг

**Profile**:
Описание Project для Harness: как проверять изменения, где лежат Ticket-ы, как называются ветки и worktree, по каким линзам ревьюить, какие MCP-серверы доступны агентам Project, от какого аккаунта GitHub работать, в каком режиме — Full mode или Silent mode — идёт работа. Profile целиком лежит на Machine пользователя; в репозитории Project его нет.
_Avoid_: профиль, конфиг проекта, settings (Settings — настройки самого worfy, «Project settings…» — окно одного Project-а в worfy; ни то, ни другое не Profile)

**Team reviewer**:
Частный skill ревью Project-а (`/human-review`), собранный skill-ом `/worfy:human-review-setup` из истории ревью PR команды на GitHub: пишет черновик ревью голосом команды и ничего не отправляет без «да» человека. Лежит только на Machine пользователя, в папке Profile-а (`state/human-review/`), не в репозитории; Session-ы с человеком получают его как дополнительный каталог ([ADR-0102](docs/adr/0102-private-project-skills-in-profile-folder.md)). Не Stage `human-review` Pipeline-а — тот ждёт решения ревью на GitHub.
_Avoid_: human review (как имя skill-а), ревьюер команды, личный ревьюер

**User personalization**:
Собственные настройки пользователя для Harness — вне plugin и вне Profile, одни для всех его Project-ов: язык отчётов (`language.reports` в `~/.claude/worfy-harness/user.json`) и личные правила (`~/.claude/worfy-harness/user/rules.md`, Harness подмешивает их в Session, не зная содержания). Языки команды и документов — не здесь, а в Profile ([ADR-0074](docs/adr/0074-harness-neutral-by-language-and-project.md)).
_Avoid_: пользовательская персонализация, персонализация (без уточнения чья), user settings, настройки пользователя, Profile или Settings (как синоним)

**Full mode**:
Режим Project, в котором файлы workflow — Ticket-ы, spec Epic-а, HANDOFF, ADR, уроки — лежат в репозитории Project вместе с кодом и видны всем, кто с ним работает.
_Avoid_: полный режим, открытый режим, public mode

**Silent mode**:
Режим Project, в котором файлы workflow лежат вне его репозитория, в отдельной Workflow folder, и в репозитории Project от workflow не остаётся следа. След — это не только файлы: ветки, коммиты и PR тоже выглядят как обычная работа, без номеров Ticket-ов и ADR, имён Epic-ов и путей к Workflow folder.
_Avoid_: тихий режим, скрытый режим, private mode, stealth

**Workflow folder**:
Папка, где лежат файлы workflow Project-а: Epic-и с Ticket-ами, HANDOFF, ADR, уроки. В Full mode это корень репозитория; в Silent mode — папка вне репозитория, которую пользователь выбирает при подключении Project.
_Avoid_: папка workflow, папка тикетов, workspace

**HANDOFF**:
Файл в Workflow folder Project-а со снимком текущего состояния работы: что в работе, что дальше, что ждёт владельца.
_Avoid_: статус-файл, notes

**Code story**:
Рассказ о готовом изменении для того, кто отвечает за код: по шагам, с ключевыми фрагментами diff-а — что делает код, зачем он здесь, что сломается без него, какому требованию служит и чего не проверяют test-ы. Бывает PR story, Epic story и story по кнопке: её собирает worfy для PR или Epic-а, у которых story нет, и хранит в своих данных. worfy показывает story в виде Story ([Code stories](docs/features/code-stories.md)).
_Avoid_: история кода, walkthrough, описание PR, рассказ (без уточнения)

**Story step**:
Часть Code story: фрагмент кода с главными строками и пятью полями (что делает, почему здесь, без него, требование, риски и пробелы test-ов) или текст под постоянным заголовком — «Что было не так», «Стыки между Ticket-ами». Шаг story — не Card: Card — Node Canvas-а.
_Avoid_: карточка, card, слайд

**PR story**:
Code story одного PR Ticket-а, в русском тексте — story PR. Её пишет implementer этого Ticket-а, пока решения у него в контексте, и она приходит вместе с кодом в том же PR.
_Avoid_: описание PR, отчёт implementer-а

**Epic story**:
Code story всего Epic-а, в русском тексте — story Epic-а: главные шаги из story PR его Ticket-ов по главам-PR и шаг «Стыки между Ticket-ами» — что один Ticket передал другому и сделано ли. Её собирает Orchestrator, когда код Epic-а влит.
_Avoid_: итог Epic-а, сводка Epic-а, Wave brief (другой документ)

## Agents

**Session**:
Один разговор с агентом одного Vendor-а (Claude Code или Codex) — один транскрипт, который можно продолжить. На Canvas одна Session — один Node, где бы она ни была запущена (worfy, терминал, Claude desktop).
_Avoid_: сессия, чат, диалог, conversation

**Vendor**:
Производитель агента, который ведёт Session: Claude Code (Anthropic) или Codex (OpenAI). Vendor выбирается у Session, у Project есть Vendor по умолчанию; вход — только по подписке Vendor-а, API-ключей worfy не принимает. Model — понятие внутри Vendor-а (у Claude Code — Opus, Sonnet; у Codex — модели GPT).
_Avoid_: provider, backend, LLM, «модель» в значении Vendor

**Orchestrator**:
Главная Session Project, из которой расходится работа; закреплена на Canvas.
_Avoid_: оркестратор, composer, главный чат, Morphy

**Product Session**:
Вид Session для продуктового мышления — советник, который предлагает идеи, спорит с планом и пишет черновики Epic-ов. Код не меняет, Ticket-ы не берёт, Autopilot не запускает; решает Product owner (решение владельца 2026-11-07, карта [worfy-product](.scratch/worfy-product/map.md)).
_Avoid_: продуктовый режим, product mode, режим советника (слово «режим» уже занято: Run mode, Full mode, Silent mode, Eco mode, Orchestrator modes, Shadow mode)

**Mind map**:
Живая схема Product Session: узлы Идея, Вопрос, Решение и Возражение и связи «из чего выросло» между ними. Это не «карта» поиска пути (wayfinder) с Ticket-ами-вопросами (решение владельца 2026-11-07, карта [worfy-product](.scratch/worfy-product/map.md)).
_Avoid_: карта, mindmap, диаграмма решений

**Session view**:
Вид, где показан разговор одной Session: сообщения пользователя, ход агента, итоги turn-ов и поле ввода. Тот же разговор
в малом виде показывает Node Session-и на Canvas (решение владельца 2026-11-17).
_Avoid_: чат, окно чата, лента, chat view

**Live summary**:
Короткие строки о том, что Product Session делает сейчас и зачем; их пишет Haiku по ходу turn-а. Видны только пока идёт ответ, под строкой статуса чата, и уходят, когда ответ пришёл. Это не сообщения чата: в транскрипте и истории Session их нет. Включается переключателем «Live summary while the advisor works» в Settings → Sessions (решение владельца 2026-11-09, ticket worfy-product-session 32).
_Avoid_: narrator (имя внутри кода, не в UI и не в docs/features), сводка, статус-сообщения, комментарий Haiku

**Subagent**:
Агент, которого Session запустила для части работы (например, scout, implementer, reviewer); у него свой транскрипт и итог, и он принадлежит запустившей его Session.
_Avoid_: субагент, воркер, teammate

**Interrupted**:
Subagent, процесс Session которого кончился раньше, чем он закончил; это не сбой. Признак: у Subagent-а нет записи о конце, а текущий процесс его Session запущен позже последней записи в его транскрипте (ADR-0085). На Canvas и в rail-е — серый статус «Interrupted».
_Avoid_: оборванный, упавший, stale, error

**Interrupted by restart**:
Chip Session Node-а, которую перезапуск worfy оборвал и которая сама не продолжилась: обрыв был больше часа назад, worfy уже дважды продолжал её за час, у её turn-а есть внешний вызов без результата, её транскрипт не прочитан и последние команды неизвестны, прежний процесс Claude Code ещё жив или Node называет другую session. Причина — в tooltip-е, рядом — Continue. Не путать с Interrupted: тот — о Subagent-е.
_Avoid_: Interrupted (без «by restart»), оборванная Session, crashed

**Background task**:
Работа, которую Session запустила и не ждёт в своём ходе: Subagent или Bash с `run_in_background`, workflow-скрипт (ADR-0029). Живёт, пока жив процесс Claude Code этой Session; о своём конце сообщает task-notification, которая начинает новый ход Session. Это не Ticket: в строке Autopilot «2 background tasks» и в журнале прогона считаются только такие задачи.
_Avoid_: job; «task» и «задача» без «background»

**Binding**:
Связь Session или Subagent с Ticket либо Epic, над которым он работает. Определяется по сигналам из работы агента или задаётся пользователем вручную.
_Avoid_: привязка, assignment, линк

**Eco mode**:
Настройка Project-а: на Ticket работает меньше агентов, а роли Subagent-ов (implementer, reviewer, scout, verifier) идут на модели подешевле. Действует с раздачи следующего Ticket-а, идущие Ticket-ы не меняются. Противоположность — full; дневной бюджет Autopilot — отдельная настройка Machine, Eco mode его не меняет.
_Avoid_: эко-режим, режим экономии, lite, cheap mode

**Orchestrator modes**:
Настройки Project-а, которые меняют то, как работает Orchestrator: Eco mode, Auto-approval и Auto-continue. Это не настройки Autopilot: Auto-continue действует и на ходы Orchestrator-а, которые начал человек, а Eco mode — на любую раздачу Ticket-а.
_Avoid_: режимы Autopilot, настройки Autopilot, режимы оркестратора

**Auto-approval**:
Настройка Project-а на Machine: как worfy отвечает на запрос разрешения агента в Run-е, где человека нет. Off — отказ, как без неё; Shadow — отказ, но worfy записывает в Journal, что разрешил бы; On — ответ по правилам worfy: то, что остаётся внутри Project-а, разрешается, остальное отклоняется с подсказкой агенту или ждёт ответа владельца. Жёсткие запреты действуют при любом положении.
_Avoid_: Auto-approve (в тексте интерфейса), автоодобрение, autoyes

**Approval policy**:
Правила в коде worfy, по которым Auto-approval считает исход запроса разрешения: allow — всё внутри разрешённых корней Run-а (worktree-ы Wave, `.scratch`, папка Run-а для временных файлов, scratchpad Session-а), deny с подсказкой — агент может переписать запрос, Park — решает только владелец, hard deny — отказ, который не снимает ни режим, ни ответ владельца (секреты домашней папки, настройки ОС, force push, чужие worktree-ы и ветки). Чего политика не прочитала, того она не разрешает.
_Avoid_: whitelist, разрешалка, политика одобрения

**Shadow mode**:
Положение Auto-approval, в котором Approval policy считает исход и пишет его в Journal (`would-allow`, `would-deny`, `would-park`), а агент получает прежний отказ. По этому списку владелец решает, переключать ли Project в On.
_Avoid_: тихий режим, dry run, режим наблюдения

**Park**:
Запрос разрешения, который Approval policy в положении On оставляет открытым до ответа владельца: карточка разрешения на Session Orchestrator-а и уведомление «Parked: …». Ответ покрывает один этот запрос; без ответа за 60 минут или при остановке Run-а запрос получает отказ с подсказкой.
_Avoid_: парковка, отложенный запрос, hold

**Auto-continue**:
Настройка Project-а на Machine: после временной ошибки API worfy шлёт Orchestrator-у продолжение с растущей паузой, после отказа Limits ждёт сброса окна и продолжает. Исходное сообщение и команду Wave не повторяет.
_Avoid_: автоповтор, replay, retry loop

**Integration**:
Один подключённый аккаунт одного внешнего сервиса (Jira and Confluence, Linear, Notion, Sentry, GitHub, Figma или свой сервер MCP — Custom server) с меткой, например «Jira — client A». worfy сам добавляет его (Add integration на вкладке Integrations окна «Project settings…»), сам входит (token или страница входа сервиса в окне worfy) и сам хранит вход на Machine. Integration принадлежит Machine и включается в Project галочкой Enabled: другой Project той же Machine берёт её без второго входа («Use in this Project»). Session-ы Project-а, где Integration включена, получают её tools как сервер worfy — в chip-е «MCP n/m» у неё источник «worfy integration», — но входа не видят. Одного сервиса может быть несколько Integration-ов — по одной на аккаунт; Autopilot пользуется Integration только с галочкой «Available to Autopilot». Все Integration-ы Machine — в Settings → Integrations. Это не сервер MCP, который пользователь добавил в Claude Code сам, и не connector claude.ai: они — группа «From Claude Code» той же вкладки, по списку `mcp.allowed` Profile-а ([ADR-0111](docs/adr/0111-integrations-mcp-servers-worfy-runs.md)).
_Avoid_: интеграция как общее слово, connector (это claude.ai), MCP-сервер worfy (это `worfy-canvas` и соседи), аккаунт, подключение

## App

**View button**:
Кнопка, которая переключает main area на один из шести видов (Canvas, Session, Pipeline, Runs, Pull requests, Acceptance). Стоит в одной из трёх зон: Header, Sidebar (rail), Footer. Расстановка — в app settings этой Machine. Header в коде и документах остаётся toolbar (`Toolbar.tsx`, `w-toolbar`); «Header» — имя зоны в меню «Move to».
_Avoid_: вкладка, tab, View switch (как имя всего набора)

**Footer**:
Полоса внизу окна под sidebar и main area: View button-ы зоны Footer и chip версии с popover-ом приложения и Harness.
_Avoid_: status bar, нижняя панель

**Settings**:
Настройки самого worfy на этой Machine — масштаб интерфейса, доступ Linked machine-ов, Terminal AI и другие функции worfy — и окно Settings (Cmd/Ctrl+, или «Settings…» в меню), где они меняются; там же для справки — Health check и список сочетаний клавиш. Это собственное состояние worfy на Machine ([ADR-0005](docs/adr/0005-worfy-own-state-inventory.md)): в репозиторий Project-а и в Profile Settings не попадают и действуют во всех Project-ах этой Machine. Это не Profile — описание Project-а для Harness, — и не «Project settings…» — окно одного Project-а в worfy с его шаблонами действий.
_Avoid_: настройки (без уточнения чьи), preferences, конфиг, Profile или Project settings (как синоним)

**Health check**:
Проверка того, что на этой Machine и в её открытых Project-ах всё работает и правильно настроено: входы (Claude Code, gh, Codex, Browser profile), инструменты (git, node, Harness, qmd) и доступ каждого Project-а к его GitHub. Каждая строка — critical (без неё агенты или GitHub не работают: git, вход в gh, пока у Project-а `origin` на GitHub, доступ Project-а) или non-critical (работа идёт хуже: qmd, git identity, Codex). Состояние строки — `ok`, `fixable`, `needs-user` или `unknown`: строку, которую не удалось проверить (нет сети, timeout), Health check показывает как «Couldn't check», а не как поломку, и она никогда не critical. Строка говорит, что сделать человеку, и, где починка обратима, даёт кнопку Fix (`fixable`). Фича, у которой сбой, сразу меняет свою строку, без запроса в сеть ([ADR-0109](docs/adr/0109-health-check-row-levels-and-feature-reports.md)). Health check видна кнопкой на rail над Machines, она открывает Settings → Health, как и строка «Health check» в Command palette: красная точка — есть сломанная critical-строка, жёлтая — не в порядке только non-critical-строки или строка не проверена, серое кольцо — отчёта ещё нет или идёт «Check again»; toast-ов нет. Это не First run: First run — окно первой настройки Machine (в Command palette — «First-run checks»), Health check — постоянное состояние после неё.
_Avoid_: Health (без check), First-run checks (как имя всего экрана), статус, диагностика, Setup check

**Getting started**:
Список из шести шагов для нового пользователя: от проверок First run до Ticket-а Demo project, доведённого через ревью и доработку до merge. Список живёт в плавающей панели в правом верхнем углу окна; свёрнутая, она остаётся pill с числом сделанных шагов. Шаги отмечаются сами, когда сделаны; элемент, который нажать следующим, подсвечен. Список можно пропустить, и он ничего не блокирует.
_Avoid_: онбординг (как имя в интерфейсе), тур, туториал, wizard

**Demo project**:
Project, который worfy создаёт сам для Getting started: маленький локальный git-репозиторий без GitHub с одним Epic-ом и одним Ticket-ом, в Full mode. Агенты работают в нём по-настоящему; удаляется кнопкой на экране Done вместе со своим Profile.
_Avoid_: песочница, sandbox, пример, учебный проект

**Guide**:
Короткая справка внутри worfy со схемами: Map of worfy — обзор всего приложения — и Topic-и. Открывается только по действию пользователя и работает без Project. Getting started учит делать шаги руками, Guide объясняет, как устроено; полная версия описаний лежит в `docs/features/`.
_Avoid_: справка, help, мануал, встроенная документация

**Topic**:
Один экран Guide об одной функции или группе связанных функций: сверху схема и короткий текст, ниже свёрнутый Under the hood с техническими деталями.
_Avoid_: глава, раздел, статья, страница (страница — файл в `docs/features/`)

## Machines

**Machine**:
Компьютер пользователя, на котором стоит worfy. Точнее, Machine привязана к папке данных worfy: две установки worfy с разными папками данных на одном компьютере — например, dev-сборка и Stable copy — две Machine ([ADR-0023](docs/adr/0023-separate-data-roots-packaged-and-dev.md), [ADR-0052](docs/adr/0052-machines-and-linking.md)). Project живёт на одной Machine: там лежит его папка и работают его Session-ы, worktree и Gate. Одна и та же Machine в разных соединениях бывает и host, и client: это роли соединения, а не виды Machine ([ADR-0052](docs/adr/0052-machines-and-linking.md)).
_Avoid_: инстанс, машина (как термин), host и client (как виды устройств)

**Linked machine**:
Machine, связанная с этой по коду из 6 цифр. Связь двусторонняя, удаляется (Remove) с любой стороны. Каждой Linked machine эта Machine даёт свой уровень доступа к своим Project-ам ([ADR-0066](docs/adr/0066-read-only-access-for-a-linked-machine.md)): Off — Project-ов не видит (так у новой связи); Read only — видит Project-ы, их Session-ы и уведомления, но не вывод Terminal, и ничего не меняет; Full access — работает с ними, как владелец: открывает Canvas, пишет в Session, печатает в Terminal, запускает Autopilot. Общий выключатель «Linked machines can work with my Projects» (по умолчанию выключен) ставит всем Linked machine-ам Off. Всё это выполняется на Machine Project-а ([ADR-0052](docs/adr/0052-machines-and-linking.md), [ADR-0053](docs/adr/0053-several-screens-on-one-project.md)).
_Avoid_: удалённый инстанс, host, client, remote, отозвать, Revoke

## Terminal AI

**Terminal AI**:
Помощь модели Claude в Terminal-е — Suggestion, Next command, Command request и Fix — и раздел Settings, где они включаются и выключаются. Terminal AI — не Session и не агент: у него нет транскрипта, Node-а и Binding-а, он ничего не запускает и только предлагает текст для строки ввода; команду запускает пользователь. Его запросы расходуют Limits подписки ([ADR-0058](docs/adr/0058-terminal-ai-assist-process.md)).
_Avoid_: AI-ассистент, агент Terminal-а, копилот

**Suggestion**:
Серый текст в строке ввода Terminal-а — продолжение того, что пользователь набирает, из истории его команд или от модели. Пользователь принимает его целиком или по словам либо скрывает; пока не принят, он не часть строки.
_Avoid_: подсказка, автодополнение, autosuggestion, completion (completion — дополнение shell-а по Tab)

**Next command**:
Suggestion на пустой строке после законченной команды: команда, которую модель предлагает следующей.
_Avoid_: следующая команда, next step

**Command request**:
Просьба словами, что нужно сделать в Terminal-е; в ответ Terminal AI ставит в строку ввода команду, не запуская её.
_Avoid_: запрос к AI, промпт, NL-команда

**Fix**:
Действие после команды, которая кончилась ошибкой: Terminal AI ставит в строку ввода исправленную команду, не запуская её.
_Avoid_: исправление, autofix, quick fix

**SSH session**:
Часть жизни Terminal-а от входа по `ssh` до выхода: всё это время команды идут в shell-е на Remote host-е.
_Avoid_: ssh-коннект, удалёнка

**Remote host**:
Компьютер, к которому подключается SSH session. У него есть флаг «Terminal AI включён» и переключатель отправки данных в модель. Это не Linked machine: на Remote host-е нет worfy.
_Avoid_: сервер (как название термина)

## Assistant

**Assistant**:
Агент worfy, по одному на Machine, над всеми Project-ами этой Machine. Он замечает, что работа стоит или ждёт пользователя, объясняет почему и готовит следующий шаг; сам делает только внутренние обратимые действия worfy из закрытого списка, остальное предлагает (Proposal). Код не пишет, Epic-и в очередь не ставит, вовне ничего не публикует. Каждое пробуждение — новая Session вне всех Project-ов, без Node-а на Canvas; у пользователя — раздел Assistant-а в rail и свои уведомления Assistant-а, отличные от обычных. Assistant опционален: у нового пользователя и у того, кто обновил worfy, он выключен. Project-ы Linked machine он только читает ([ADR-0114](docs/adr/0114-assistant-app-session.md)).
_Avoid_: агент (в этом глоссарии — Claude Code или Codex, который ведёт любую Session), ассистент, AI-ассистент, бот, Orchestrator (это главная Session одного Project-а), Terminal AI

**Duty**:
Одна обязанность Assistant-а: что поднимает Attention item (trigger — события источников, «ничего не произошло» или утро), какие Project-ы и источники она охватывает, Action mode каждого её действия, её счётчики (показано, принято, отклонено, проигнорировано, like, dislike) и пауза. Встроенные Duty — только общие, на то, что есть у любого Project-а: «Work stands», «CI of the main branch is red», «Waits for you», «Morning summary» и по одной на каждый внешний источник. Процесс одного Project-а — правило в настройках этого Project-а, а не Duty кода. Dislike снимает такие пункты Duty и пишет правило в память Assistant-а; после нескольких проигнорированных предложений или dislike подряд Duty встаёт на паузу.
_Avoid_: обязанность (без «Assistant-а»), rule (правило — часть Duty или настроек Project-а), trigger (это часть Duty), задача, job

**Action mode**:
Режим одного действия одной Duty — то, насколько Assistant может сделать его сам. Их четыре: `self` — Assistant делает действие сам и пишет строку своего журнала; `pre-approved` — делает сам, потому что пользователь, выбрав этот режим, заранее сказал «да»; `ask` — сначала спрашивает: показывает Proposal, и решает пользователь; `hand-over` — отдаёт пункт пользователю и ничего не делает. Режим выбирает пользователь в Settings → Assistant; Assistant меняет его только через Proposal, который пользователь применил кнопкой Apply. Не у каждого действия все четыре режима: у pr-follow — Session, которая работает над PR пользователя (Fix checks, Resolve conflicts, Address comments), — только `ask` и `hand-over`: её всегда запускает пользователь.
_Avoid_: режим (без «Action»: слово уже занято — Run mode, Full mode, Eco mode, Orchestrator modes), permission, уровень доступа (это Linked machine), autonomy level

**Attention item**:
Одна вещь, которая ждёт внимания, в списке Assistant-а: Session задала вопрос или молчит, Run остановился, Ticket ждёт человека, PR ждёт пользователя, CI основной ветки красный, сообщение Slack или Jira касается пользователя. У пункта есть источник, Project, предмет (PR, Ticket, Session, Run, сообщение источника), вид, время начала, состояние (new, seen, snoozed, dismissed, closed, stale) и Duty, которая его подняла. Повтор того же события пункт не множит, события одного предмета за день склеиваются в один пункт. «Ничего не произошло» (Session молчит дольше порога) — тоже пункт. Пункты переживают перезапуск worfy. Linked machine видит пункты Assistant-а этой Machine только для чтения, отдельной группой без кнопок.
_Avoid_: пункт журнала (журнал Assistant-а — строки его действий), notification, alert, событие (событие — то, из чего склеен пункт), счётчик waits

**Proposal**:
Следующий шаг, который Assistant предлагает пользователю, с объяснением «почему», обычно в ответ на Attention item. Пользователь отвечает кнопками Dismiss, Snooze, Open и Prepare; у Prepare — точный текст будущей Session, и такая Session стартует только по щелчку пользователя, после того как он увидел текст. Proposal, который меняет настройку Assistant-а, показан карточкой «было → станет»: каждая настройка — как сейчас и как станет, и меняется она только щелчком Apply пользователя; Undo под применённой карточкой возвращает прежние значения, если их с тех пор не меняли.
_Avoid_: suggestion (это Terminal AI), предложение (без «Assistant-а»), recommendation, рекомендация, задача

**Check**:
Проверка источника Assistant-ом по расписанию: Slack, Jira и CI основной ветки каждого Project-а. У каждого вида свой интервал, свой выключатель и свой выбор — спать ли вне work hours пользователя; после нескольких неудач подряд Check Slack или Jira идёт реже. Пока Machine спит или worfy закрыт, проверки не идут, а после запуска догоняют пропущенное. Slack и Jira Check читает через connectors claude.ai пользователя: своих token-ов для них у worfy нет. Что Check нашёл, становится Attention item-ами.
_Avoid_: Health check (проверка Machine и Project-ов), check-и PR (GitHub checks — CI одного PR), poll, sync, Integration (это подключённый аккаунт Project-а)

## Tests

**Quarantine**:
Flaky test, который на время пропускают в блокирующих run-ах (`pnpm test`, Gate, CI): он падает не каждый раз и по причинам вне проверяемого изменения — нагрузка, время, порядок вывода. Платформы любые, у каждой записи свой Ticket-владелец, который чинит test, и короткий срок; число записей ограничено. По истечении срока test снова блокирует, пока его не починят или срок не продлит владелец проекта.
_Avoid_: карантин, skip-лист, disabled test, ignored test, Windows exception (это другая запись)

**Windows exception**:
Test, который краснеет только на Windows: его пропускают только на Windows, только в блокирующих run-ах и только до приёмки Windows с небольшим запасом после неё. В отличие от Quarantine, у всех таких записей один общий Ticket-владелец, свой предел числа записей, отдельный от Quarantine, и срок, привязанный к приёмке Windows, а не к дате записи. На других платформах test идёт как обычно.
_Avoid_: исключение (без «Windows»), windows quarantine, карантин для Windows, known failure, xfail, skip на Windows

**Fault scenario**:
Test, который вносит один сбой (ошибка API, убитый процесс, недоступный GitHub, убитое приложение, конфликт merge) в Run на fake agent над временным fixture-проектом и проверяет Recovery invariants.
_Avoid_: chaos test, fault lab

**Recovery invariant**:
Правило, которое держится после любого Fault scenario (И1–И10): команда Wave одна, статус Ticket-а один раз, Journal называет причину, Run снова стартует.
_Avoid_: «гарантия», health check

## Relationships

- **Project** содержит много **Epic**-ов; **Epic** — много **Ticket**-ов; **Ticket** может блокироваться другими Ticket-ами того же Epic.
- У **Session** или **Subagent** не более одного **Binding** — к Ticket или Epic; у **Ticket** может быть несколько Binding-ов (реализация, ревью, доработка). Binding Orchestrator-а, ведущего **Wave**, — к Epic, а Binding-и его implementer-ов и reviewer-ов — к их Ticket-ам.
- **Session** запускает **Subagent**-ов; **Subagent** может запускать своих.
- **Product Session** пишет только продуктовые документы и черновики **Epic**-ов; черновик становится **Epic**-ом только после того, как **Product owner** принял его spec.
- У **Project** ровно один **Orchestrator**.
- У **Project** ровно один **Profile**; **Harness** один на **Machine** и ведёт работу каждого Project по его **Profile**.
- **User personalization** одна у пользователя на **Machine** и действует во всех его **Project**-ах; **Profile** задаёт языки команды и документов Project-а, **User personalization** — язык отчётов и личные правила.
- У **Project** ровно одна **Machine**. Один репозиторий, подключённый на двух Machine, — это два разных Project-а, у каждого свой Canvas.
- **Linked machine** получает от другой **Machine** один из трёх уровней доступа к её **Project**-ам: Off — не видит их; Read only — видит **Project**-ы, **Session**-ы и уведомления и ничего не меняет; Full access — работает с ними. Session-ы, Terminal, Gate и Autopilot такого Project-а всё равно идут на его Machine.
- У **Project** ровно один режим — **Full mode** или **Silent mode**; Project над несколькими репозиториями всегда в **Silent mode**.
- У **Project** ровно одна **Workflow folder**: в **Full mode** это корень репозитория, в **Silent mode** — папка вне репозитория.
- **Card** принадлежит **Project**, а не Session: менять её может любая Session Project.
- **Browser** открыт ровно под одним **Browser profile**; **Browser profile** принадлежит **Project**, а не Session, и им может пользоваться любая Session Project. Один **Browser profile** может быть открыт в нескольких **Browser**-ах сразу.
- **Browser** работает на **Machine** своего **Project**, как Terminal и Session; **Linked machine** только показывает его и передаёт ввод. Поэтому **Browser profile** один, с какого бы экрана ни шла работа.
- Вход в аккаунт и создание **Browser profile** делает только пользователь; **Session** может открыть **Browser** под существующим **Browser profile** и вести его, пока пользователь не перехватит управление.
- **Autopilot** над самим worfy идёт только из **Stable copy**; агенты **Wave** в это время собирают и проверяют dev-сборку worfy в своих worktree.
- **Run** продолжает застрявший **Ticket** не больше двух раз (**Ticket continuation**), потом просит **Orchestrator** отложить его (**Set-aside Ticket**); красный main вместо этого останавливает Run с `main-red`.
- **Terminal AI** работает в **Terminal**-е и не делает его агентским: команды в **Terminal**-е по-прежнему запускает только пользователь, а **Terminal AI** лишь предлагает текст строки ввода. Это не **Session**: на **Canvas** у него нет Node-а.
- **SSH session** идёт внутри **Terminal**-а, у неё ровно один **Remote host**. **Terminal AI** работает в ней, только если на этом **Remote host**-е он включён. **Remote host** — не **Machine** и не **Linked machine**.
- У каждой **Machine** свой **Assistant**; он ведёт **Duty**-и, **Attention item**-ы и **Check**-и только **Project**-ов своей Machine, а **Linked machine** видит его **Attention item**-ы только для чтения.
- **Duty** поднимает **Attention item**-ы; у каждого действия **Duty** ровно один **Action mode**. **Check** приносит **Attention item**-ы внешних источников и CI основной ветки, у каждого источника своя **Duty**.
- **Assistant** сам делает только то, что разрешает **Action mode**, остальное — **Proposal**; Session с текстом, который написал **Assistant**, стартует только по щелчку пользователя, а настройку Assistant-а меняет только Apply под **Proposal**.
