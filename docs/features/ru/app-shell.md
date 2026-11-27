# App shell

> Перевод [английской версии](../app-shell.md), commit `same-pr`.

То, что окружает Canvas в каждом окне и на каждом Project-е. Девять Feature: **Sidebar**, **View buttons**, **Footer**,
**Command palette**, **Shortcuts**, **Menu**, **Settings**, **worfy Guide** и **Theme**. У десятой,
[Notifications](notifications.md), своя страница. Термины объяснены в [Concepts](concepts.md).

Окно — это sidebar слева, main area справа с toolbar над ней и footer внизу на всю ширину. В toolbar стоят заголовок
Project-а, View button-ы его зоны, Limits (см. [Transcripts and usage](transcripts-and-usage.md)) и поле «Search or run…»
Command palette. Шесть View button-ов выбирают, что показывает main area, и каждый стоит в одной из трёх зон: toolbar,
rail sidebar или footer (см. [View buttons](#view-buttons)). Каждый вид остаётся смонтированным, пока показан другой,
поэтому при возврате он такой же, каким был.

Часть, которая не смогла отрисоваться, остаётся частью: секция sidebar, tab Assistant-а или вид показывают «This section
failed to render» (или «This tab…», «This view…») с сообщением ошибки и **Reload**, а остальное окно продолжает работать.
Ошибка вне всех них показывает сообщение и **Reload window** вместо пустого окна.

## Sidebar

### Behaviour

Колонка слева в окне, шириной 264 пикселя, пока не потянешь её правый край (worfy-polish ticket 158). Сверху вниз:

- **Полоса** высотой с toolbar. На macOS слева на ней стоят кнопки окна. Дальше идёт надпись «worfy», а у правого края —
  кнопка, которая скрывает sidebar (⌘B, Ctrl+B на Windows). Перетаскивание полосы двигает окно.
- **Project switcher** — отдельная строка под полосой, шириной с sidebar: название того, что показывает sidebar, и шеврон на
  её правом конце. Длинному имени Project-а отдана вся строка.
- **Rail** — колонка иконок, по одной на секцию: первым Assistant, своим цветом и над чертой, затем Projects, Sessions,
  Pull requests, Acceptance, Pipeline, Epics, ADR, а внизу
  Health check, Machines и Settings. Под секциями верхней группы, после тонкой линии, стоят View button-ы зоны Sidebar, по
  умолчанию Pull requests и Acceptance (см. [View buttons](#view-buttons)). У выбранной секции акцентная полоса. На иконке секции есть badge, который виден, пока
  открыта другая секция: число занятых Session-ов в Project-ах, которые показывает switcher, цветом работы; число pull
  request-ов, которым нужны вы (review, ответ или исправление); число проверок в Ready to check вида
  [Acceptance](acceptance.md), цветом работы; точка, пока Ticket в работе заблокирован или кого-то ждёт; и точка Linked machine-ов.
- **Панель** рядом с rail. Она показывает одну секцию: её название, какие Project-ы она показывает, её собственные кнопки и её
  список, который прокручивается сам по себе.

**Ширина.** Правый край sidebar — полоса шириной около 6 пикселей: над ней курсор меняется на курсор изменения размера,
а линия цвета акцента видна, пока на полосе указатель, фокус клавиатуры или drag. Перетаскивание меняет ширину всего
sidebar сразу. Ширина сохраняется один раз, когда кнопку мыши отпустили; Escape во время drag возвращает ширину, с которой
drag начался, и ничего не сохраняет. Полоса — позиция в порядке Tab: ← и → двигают край на 16 пикселей, Home и End — к
пределам, и клавиша, которая сдвинула край, сохраняет. Двойной щелчок возвращает 264 пикселя. Нажатие без движения,
drag, вернувшийся к началу, и клавиша у предела ничего не сохраняют; drag отменяется и когда окно теряет фокус, и при
следующем нажатии, если отпускание было пропущено, и когда sidebar прячут посреди drag. Ширина — от 220 до 640 пикселей и не больше,
чем оставляет остальному окну 480 пикселей; более узкое окно только показывает sidebar уже, но не уже 264 пикселей, а
более широкое снова показывает сохранённую ширину. Ширина одна на Machine, одна для обычного вида и focus mode, и
sidebar, показанный снова после скрытия, возвращается с ней. Она считается в пикселях страницы, поэтому масштаб
интерфейса увеличивает её так же, как остальное окно.

Rail — одна позиция в порядке Tab. ↑ и ↓ ходят по нему и заворачивают по кругу, Home и End ведут к его концам, а секция под
фокусом открывается сразу. Открытая секция запоминается для окна. Окно, в котором секцию ещё не выбирали, открывается на
Projects, а не на Assistant-е над ними.

**[Assistant](assistant.md)** (worfy-assistant, Ticket 14) — отдельная секция: что ждёт во всех Project-ах этой Machine, у каждого пункта
причина, источник и обязанность, и кнопки Open, Prepare, Snooze и Dismiss; like и dislike на каждом его сообщении; журнал
его действий, у каждой строки — пункт, который её вызвал; сводка; разговор; строка расхода, где доля Limits помечена как
оценка. Prepare показывает точный текст Session до старта; ничего не стартует до Start. Пока Assistant включён, его
собственное уведомление — карточка у его иконки в rail, его цветом, одна за раз, остальное — число на иконке; когда worfy
не впереди, системное уведомление с заголовком «worfy Assistant» приходит только о срочном и только в work hours, а щелчок
открывает секцию. Settings → Assistant → Notifications сужает их (worfy-assistant, Ticket 25): карточка в окне сообщает о
срочных пунктах и пунктах, собранных в пачку, только о срочных или ни о каких (число на иконке и список остаются), а
системное уведомление можно выключить. Под применённой карточкой Assistant-а «before → after» Undo возвращает её
настройки, если только одна из них не изменилась после Apply.

Assistant выключен, пока пользователь его не включит (worfy-assistant, Ticket 16). worfy предлагает его один раз: новому
пользователю — на странице «Meet Assistant» в [First run](onboarding.md#first-run), существующему — одним notice в углу,
и вверху секции, пока предложение в силе, — «Turn on and meet» или «Not now», после которого предложения больше не будет.
Когда Assistant включают в первый раз, через предложение или в Settings → Assistant, он представляется в разговоре на
языке Guide: кто он, что делает и что умеет, какие из Slack и Jira он видит подключёнными в claude.ai и где подключить
остальные (claude.ai → Settings → Connectors). Он никогда не просит token. Он спрашивает work hours, а следом идёт
карточка «before → after» с первой настройкой: work hours с понедельника по пятницу, 09:00–18:00 в часовом поясе этой
Machine, если их не выбрали, и проверка каждого подключённого источника. Ничего не меняется до Apply. Представление worfy
пишет сам, без модели, поэтому оно не стоит token-ов; Assistant, который был включён до того, как представление
появилось, не представляется.

**Health check** — кнопка rail прямо над Machines, она есть всегда. Это не секция: в панели она ничего не показывает, а щелчок
открывает Settings → Health (строки описаны в [First run](onboarding.md#first-run)). Как и Settings, она не входит в tab-ы, по
которым ходят ↑ и ↓; Tab доходит до неё после них. Её точка — худший уровень отчёта Health check этой Machine и каждого
открытого на ней Project-а:

| Точка | Когда |
|---|---|
| Красная | Critical-строка не OK: git, вход в Claude Code, Harness, gh, пока Project лежит на GitHub |
| Жёлтая | Не OK только non-critical-строки, например модели qmd или git identity, или строку не удалось проверить |
| Нет | Все строки OK |
| Серое кольцо | На этом старте отчёта ещё нет, или идёт «Check again» |

Строка, которую не удалось проверить (нет сети, timeout), никогда не делает точку красной. Tooltip говорит «Health check» и
почему стоит точка: «critical: Harness plugin», «non-critical: qmd models», «Couldn't check: <reason>», «everything works».
Кнопка читает отчёт, который main уже держит, и сама ничего не проверяет. Toast-а и системного уведомления о новой красной
строке нет: только точка.

**Project switcher** отвечает «All Projects» или одним Project-ом Machine окна:

- **All Projects** смешивает Project-ы в Sessions, Pull requests, Acceptance, Pipeline, Epics и ADR. Каждая из Sessions, Epics и ADR
  сначала показывает список открытого Project-а, затем список каждого другого Project-а, у которого он есть, каждый под его
  именем. Клик по Epic-у другого Project-а открывает этот Project и центрирует Epic на его Canvas. Клик по Session другого
  Project-а открывает этот Project, а затем Session так же, как клик в её собственном списке, когда её Node появится на Canvas
  (в пределах 15 секунд). Клик по ADR другого Project-а открывает этот Project, а затем ADR.
- **Один Project** открывает этот Project, как его строка в секции Projects, и секции показывают только его, когда он открыт.
  Когда Project нельзя открыть, switcher говорит почему и сохраняет свой ответ. Пока switcher стоит на одном Project-е, он
  следует за открытым: открытие другого Project-а показывает его.
- Projects и Machines не фильтруются: в Projects Project-ы открывают, добавляют и удаляют.

**Секция Projects** показывает каждый Project Machine окна карточкой в две строки: имя и ветка, затем его живое состояние,
«N busy · N PR need you · N waits», или «quiet». Длинная ветка остаётся на одной строке, занимает не больше её половины и
обрезается многоточием, так что имени остаётся остальное; в её tooltip вся ветка. Меню switcher-а так же даёт ветке не больше
половины пункта. Busy — цветом работы, две другие части — цветом блокировки. Часть, равная нулю или неизвестная, не
показывается. «PR need you» считает pull request-ы, которым нужны ваш review, ответ или исправление; эта часть неизвестна,
пока PR inbox Project-а выключен. «Waits» считает Ticket-ы в работе, которые заблокированы или ждут человека, а не агента.
Она известна, только пока какое-то окно показывает Pipeline Project-а, а «All Projects» его показывает. Ни одна часть живой
строки не обрезается: часть, которая не помещается, целиком переходит на следующую строку, без « · » перед ней, и карточка
растёт вместе с ней. У каждой части есть tooltip, который говорит, что она считает: busy — Session-ы, у которых идёт turn;
PR need you — pull request-ы, которым нужны ваш review, ответ или исправление; waits — Ticket-ы, которые заблокированы или
ждут человека, а не агента. Те же слова — описание самой карточки, поэтому их дают и фокус клавиатуры на карточке, и
screen reader. Project Linked machine сохраняет одну строку.

**Секция Acceptance** показывает очередь [Acceptance](acceptance.md) по Project-ам: имя каждого Project-а, затем по строке на
каждую группу, в которой есть проверка этого Project-а, — Ready to check, Update first, Waits for you, Failed — с её счётом.
У In work и Older там строки нет. Клик открывает вид Acceptance на первой строке этой группы у этого Project-а; вид — по всем
Project-ам, поэтому клик не открывает Project. Когда ни в одной из этих групп нет строки, секция пишет «Nothing to check».
Badge её rail — число Ready to check в Project-ах, которые показывает switcher: при «All Projects» это число, которое
считает View button Acceptance.

В группе другого Project-а Session показывает имя, которое ей даёт Claude Code, иначе «Session <id>», и «terminal» или
«desktop». Canvas того Project-а не читается, поэтому его Session-ы worfy там не помечены «worfy». «New session», «Product
Session» и History работают с открытым Project-ом.

Ответ запоминается для окна, как и открытая секция. Новое окно и перезапуск начинают с последнего выбора, сделанного в любом
окне. Когда switcher стоит на одном Project-е, а Project не открыт, секции показывают все Project-ы. Без открытого Project-а
Epics, Sessions и ADR сохраняют заголовок и пишут «Open a Project to see its …».

Пока sidebar скрыт, кнопка, которая показывает его снова, стоит слева в toolbar. В focus mode эта кнопка есть в панели focus
mode, а в полосе sidebar её нет. Фокус клавиатуры следует за кнопкой: после скрытия из полосы фокус на кнопке toolbar, после
показа из toolbar — на кнопке в полосе. Заголовок toolbar называет только открытый Project, пока sidebar показывает надпись
worfy («No Project open», если Project не открыт), и «worfy — <Project>», пока sidebar скрыт.

### How it works

Каждая секция — файл `src/renderer/shell/sidebar/<Name>Section.tsx` со своим порядком и своей записью в rail: заголовок, иконка,
стоит ли она внизу и может ли окно, где секцию не выбирали, открыться на ней. Каждая секция остаётся смонтированной, пока показана другая, поэтому сохраняет прочитанное, и её badge
остаётся актуальным; остальные только скрыты. Ответ switcher-а и открытая секция хранятся в local storage окна, в папке данных
worfy. Никакая настройка приложения их не хранит.

Другие Project-ы не стоят ни одного watcher-а на Project в каждом окне. Их Session-ы, число занятых, pull request-ы, которым
нужны вы, и ожидания приходят одним ответом от main, `projectPulse.get`, и одним событием, `projectPulse.changed`. Main держит
одно чтение на все окна. Оно перечисляет папку живых Session-ов в Claude home каждую секунду, пока какое-то окно подписано, и
читает её снова, когда она изменилась. Процесс, который умер, не удалив свой файл, не меняет ни одного файла, поэтому, пока
Session жива, каждый опрос ещё спрашивает систему, работает ли её процесс, и при этом не запускает другого процесса. Вся
папка, с проверкой времени старта, которая отличает повторно использованный номер процесса, читается заново раз в минуту.
Session Project-а внутри открытого перечисляется и считается один раз, под своим Project-ом. Linked machine не получает
Project, который хранится только на этой Machine. Pull request-ы main берёт из PR inbox в том виде, в каком он прочитан
последним, поэтому сам не делает запросов к GitHub. Ожидания он берёт из Stage-ей, которые уже вычисляет для окон. Окно
подписывается один раз и остаётся подписанным, пока не закроется. ADR других Project-ов читаются один раз через `docs.adrs`,
каждый раз, когда секция ADR появляется в панели, без watcher-а. Следят только за документами открытого Project-а.

### Implementation

| Что | Где |
|---|---|
| Полоса, rail и панель | `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/shell.css` |
| Ширина sidebar и его край | `src/renderer/shell/sidebar-width.ts`, `src/renderer/shell/SidebarResizeHandle.tsx`, разделитель `src/renderer/theme/kit/Divider.tsx`, пределы — в `src/shared/settings/app-settings.ts` |
| Секция Assistant-а, его карточка и Prepare | `src/renderer/shell/sidebar/AssistantSection.tsx`, `src/renderer/assistant/`, в main — `src/main/assistant/window/` и `src/main/ipc/assistant.ts`, каналы — в `src/shared/ipc/assistant.ts`, token-ы `--assistant*` в `src/renderer/theme/tokens.css` |
| Предложение Assistant-а и его представление | `src/renderer/assistant/Offer.tsx`, `src/renderer/assistant/offer-notice.ts`, страница — в `src/renderer/shell/FirstRun.tsx`, в main — `src/main/assistant/intro/` (его слова — в `src/main/assistant/intro/words/`), состояние — в `src/shared/assistant/intro.ts` |
| Кнопка Health check и её точка | `HealthRailButton` в `src/renderer/shell/Sidebar.tsx`, `openHealthCheck` в `src/renderer/settings/settings-window.ts`, худший уровень — в `src/shared/health/severity.ts`, token-ы `--health-critical` и `--health-warning` в `src/renderer/theme/tokens.css` |
| Рамка секции | `src/renderer/shell/SidebarSection.tsx`, `src/renderer/shell/sidebar-section.css` |
| Project switcher | `src/renderer/shell/ProjectSwitcher.tsx` |
| Ответ, открытая секция, badge-и | `src/renderer/shell/sidebar-scope.ts` |
| Живое состояние каждого Project-а | `src/shared/ipc/project-pulse.ts`, `src/main/claude-home/pulse.ts`, `src/main/ipc/project-pulse.ts`, `src/renderer/projects/useProjectPulse.ts` |
| Session другого Project-а, открытая после её Project-а | `src/renderer/shell/session-request.ts` |
| Секции | `src/renderer/shell/sidebar/` |
| Что показывает часть, которая не смогла отрисоваться | `src/renderer/shell/ErrorBoundary.tsx`, `src/renderer/shell/error-boundary.css`; стоит в `Sidebar.tsx`, `AppShell.tsx`, `src/renderer/assistant/AssistantPanel.tsx` и `src/renderer/main.tsx` |
| Записи секций в rail | `src/renderer/shell/registry.ts` |

Главные test-ы: `test/unit/sidebar-scope.test.tsx`, `test/unit/error-boundary.test.tsx`, `test/unit/sidebar-resize.test.tsx`, `test/e2e/sidebar-resize.spec.ts`, `test/unit/assistant-window.test.ts`, `test/unit/assistant-panel.test.tsx`, `test/unit/assistant-speech.test.tsx`, `test/unit/assistant-intro.test.ts`, `test/unit/assistant-offer.test.tsx`, `test/e2e/assistant.spec.ts`, `test/unit/sidebar-section.test.tsx`, `test/unit/health-rail-button.test.tsx`, `test/unit/acceptance-section.test.tsx`, `test/e2e/sidebar-rail.spec.ts`,
`test/e2e/sidebar-sections.spec.ts`.

## View buttons

### Behaviour

View button переключает main area на один из шести видов: **Canvas**, **Session**, **Pipeline** (см.
[Workflow](workflow.md)), **Runs** (см. [Flight Recorder](flight-recorder.md) и [Work track](work-track.md)), **Pull
requests** (см. [Pull requests](pr-inbox.md)) и **Acceptance** (см. [Acceptance](acceptance.md)). У Code story и у
Changes Ticket-а кнопки нет: они открываются из своего Ticket-а.

Каждая кнопка стоит в одной из трёх зон, в своём порядке:

| Зона | Где | По умолчанию | Как выглядит |
|---|---|---|---|
| Header | Группа toolbar-а после заголовка Project-а | Canvas, Session | Иконка, подпись и badge |
| Sidebar | Блок rail под тонкой линией, после секций верхней группы и перед Health check | Pull requests, Acceptance | Квадрат 34 пикселя с иконкой 18 пикселей и маленькой отметкой окна в углу; tooltip справа |
| Footer | Левая часть footer-а | Pipeline, Runs | Высота 22 пикселя: иконка, подпись и badge |

Эти страницы называют верхнюю полосу toolbar; «Header» — имя её зоны в меню кнопки. То, где стоят кнопки, — это layout.
Он один на Machine и хранится в настройках приложения этого компьютера; каждое окно этого компьютера показывает его и
сразу следует каждому изменению. Ни одну кнопку нельзя скрыть: каждая из шести всегда стоит ровно в одной зоне. Зона
может быть пустой и тогда ничего не рисует, кроме как во время drag.

**Нажатие, badge-и, tooltip-ы.** Кнопка вида, который сейчас на экране, нажата, в какой бы зоне она ни стояла, и нажатие
на неё снова открывает её вид. Runs открывает Run history на самом новом Run-е и сохраняет выбор Project-а между Run
history и Work track. Tooltip-ы: «Canvas», «Session view», «Pipeline board», «Run history», «Pull requests of the open
Project» и «Checks that wait for you». Badge считает то, что показывает его вид: у Pull requests — pull request-ы
открытого Project-а, которым нужны вы, у Acceptance — проверки Ready to check всех Project-ов, а у Pipeline есть точка,
пока Ticket открытого Project-а заблокирован или ждёт человека. У Canvas, Session и Runs badge-а нет. Screen reader
читает badge как описание кнопки. На rail кнопка не показывает badge, пока там стоит секция с тем же именем со своим
badge-ем, а отметка окна на её иконке говорит, что кнопка открывает вид main area, а не панель sidebar.

**Неактивные кнопки.** Runs и Pull requests показывают открытый Project. Без него они приглушены в каждой зоне, а их
tooltip пишет «Open a Project to see its Runs» или «Open a Project to see its pull requests». Неактивная кнопка остаётся
Tab stop и двигается как любая другая: своим меню, клавишами или drag-ом; нажатие на неё ничего не открывает.

**Клавиатура.** Каждая зона — один Tab stop. ← и → ходят по кнопкам toolbar-а и footer-а, ↑ и ↓ — по кнопкам rail. Блок
rail не входит в секции, по которым ходят ↑ и ↓ над ним: нажатие переключает main area, а не панель sidebar.

**Ширина окна.** В toolbar кнопки показывают иконки и подписи. Когда кнопок четыре или больше, они показывают только
иконки в окне шириной 1400 пикселей и меньше, а при любом числе — в окне 1100 пикселей и меньше. В footer-е подписи
видны в окне шире 1100 пикселей; при 1100 и меньше кнопка показывает иконку и badge, а её tooltip её называет. На rail
кнопка всегда показывает только иконку.

**Скрытый sidebar.** Пока sidebar скрыт (⌘B), rail не рисуется, и его View button-ы стоят в конце группы toolbar-а после
тонкой линии. Layout не меняется. Их меню и клавиши работают как на rail (⌥← и ⌥→ двигают их в порядке rail), но
бросить на них кнопку при drag нельзя.

**Focus mode.** Слой [focus mode](focus-mode.md) закрывает toolbar вместе с main area. View button-ы rail и footer-а не
реагируют, пока он включён: вид под слоем не виден, поэтому переключать нечего. Version chip footer-а продолжает работать.

**Перемещение кнопки.**

- **Меню.** Правый клик по View button, клик двумя пальцами по touchpad или Shift+F10 на кнопке в фокусе открывает её
  меню. Под заголовком «Move to» идут **Header**, **Sidebar** и **Footer** — выбор одного из трёх: зона, где стоит
  кнопка, отмечена и неактивна. «Move to» — заголовок, а не подменю. Дальше идут линия и **Reset layout**, неактивный,
  пока layout по умолчанию. Move to ставит кнопку в конец этой зоны, и фокус переходит за ней туда. Пока sidebar скрыт,
  Sidebar ставит её в конец rail, и она показывается в конце toolbar-а после линии.
- **Клавиши.** ⌥← и ⌥→ в toolbar и footer-е, ⌥↑ и ⌥↓ на rail двигают кнопку в фокусе внутри её зоны, и фокус остаётся
  на ней. У края зоны клавиши ничего не делают: в другую зону кнопку переносят только меню или drag. Клавиша, нажатая
  снова до того, как прошлое перемещение сохранено, шагает дальше от места, которое просило это перемещение.
- **Drag.** View button можно тянуть мышью, неактивный тоже, внутри его зоны или в другую. Пока идёт drag, у каждой зоны
  на экране пунктирная рамка цвета акцента, у зоны под указателем — сплошная, а линия отмечает промежуток, куда встанет
  кнопка: вертикальная в toolbar и footer-е, горизонтальная на rail. Промежуток — перед первой кнопкой, чья середина
  дальше указателя, или после последней. Пустая зона показывает место для одной кнопки, «Drop here», только во время
  drag. Escape или отпускание вне зоны заканчивает drag и ничего не меняет. Зона принимает только drag, который начался в
  её собственном окне. Drag, чья кнопка пропала до его конца (её передвинуло другое окно), сразу заканчивается.
- **Reset layout** возвращает каждую кнопку в её зону и на её место по умолчанию. В Settings → General та же кнопка стоит
  в строке «View buttons», неактивная, пока layout по умолчанию; когда main не сохраняет сброс, строка пишет «Not saved: …»
  с причиной.

#### Windows

Alt+← и Alt+→, а на rail Alt+↑ и Alt+↓ двигают кнопку. Shift+F10 и клавиша меню открывают её меню под кнопкой. Окно там
сохраняет системную рамку и заголовок; зоны и footer такие же, как на macOS.

#### On a Linked machine

Окно на Project-е Linked machine показывает layout этого компьютера, и перемещение в нём меняет layout этого компьютера:
настройки приложения читаются и пишутся здесь, а не на Linked machine. Его badge-и считают то, что показывают его
собственные виды.

### How it works

Один registry хранит восемь видов main area, среди них шесть с кнопкой. Имя каждого вида, tooltip, иконка, badge, нужен
ли ему Project и что открывает нажатие записаны там один раз, и из него же строятся строки View в Command palette. Badge
читает тот источник, который уже читает его вид: каждый вид остаётся смонтированным, поэтому badge ничего нового не
запрашивает ни у main, ни у GitHub.

Layout — это поле `viewButtons` настроек приложения. Его нет, пока человек не передвинул кнопку, и это значит layout по
умолчанию. Main исправляет то, что читает, и то, что присылает окно: неизвестный id отбрасывается, из повторённого id
остаётся первый, недостающий id идёт в конец своей зоны по умолчанию, а всё, кроме трёх списков, считается layout-ом по
умолчанию. Испорченное поле никогда не делает остальные настройки нечитаемыми. Каждое перемещение — одна запись всего
layout, а Reset layout — одна запись, которая удаляет поле. Каждое окно узнаёт о ней через `appSettings.changed`. Каналы
настроек — `local` ([ADR-0053](../../adr/0053-several-screens-on-one-project.md)), поэтому окно Linked machine читает и
пишет настройки приложения этого компьютера. Layout — ещё одна часть собственного состояния worfy
([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)), и своего ADR ему не понадобилось.

Drag — нативный HTML5 drag and drop, без библиотеки, как в очереди Autopilot. Его состояние хранится в собственном модуле
окна, поэтому зона принимает drop только от drag, который начался в её окне и несёт View button. Пока drag идёт, у shell
окна стоит `data-view-drag`, и весь toolbar перестаёт быть областью, за которую двигают окно: такая область не получает
событий drag.

### Implementation

| Что | Где |
|---|---|
| Registry видов: имена, tooltip-ы, иконки, badge-и, что открывает нажатие, строки View в Command palette | `src/renderer/shell/views.tsx` |
| Layout, его значение по умолчанию и его исправление | `src/shared/layout/view-buttons.ts`; поле `viewButtons` в `src/shared/settings/app-settings.ts`, которое читает и сохраняет `src/main/settings/store.ts` |
| Зона: её группа, меню, клавиши и drag | `src/renderer/shell/ViewZone.tsx`, набор компонентов `src/renderer/theme/kit/ToggleGroup.tsx`, `src/renderer/theme/kit/ContextMenu.tsx` и `src/renderer/theme/kit/Menu.tsx` |
| Одна кнопка в облике её зоны | `src/renderer/shell/ViewButton.tsx`, `src/renderer/shell/shell.css` |
| Где рисуются зоны | toolbar — `src/renderer/shell/Toolbar.tsx`, rail — `src/renderer/shell/Sidebar.tsx`, footer — `src/renderer/shell/footer/Footer.tsx` |
| Reset layout в Settings | `src/renderer/settings/GeneralSection.tsx` |

Главные test-ы: `test/unit/view-buttons.test.ts`, `test/unit/view-registry.test.tsx`, `test/unit/view-zones.test.tsx`,
`test/unit/settings-reset-layout.test.tsx`, `test/unit/toolbar-runs.test.tsx`, `test/contract/app-settings.test.ts`,
`test/e2e/view-buttons.spec.ts`, `test/e2e/toolbar.spec.ts`.

## Footer

### Behaviour

Полоса высотой 28 пикселей через всё окно, под sidebar и main area, при масштабе интерфейса 100 %. Она растёт с масштабом
интерфейса, как и остальное окно: под ней нет кнопок окна. В её левой части стоят View button-ы зоны Footer (см.
[View buttons](#view-buttons)), середина остаётся пустой, а version chip стоит у правого края; пустой footer показывает
только chip. За footer окно не перетаскивается, и toast-ы его обходят, поэтому toast у правого края никогда не закрывает
chip. В focus mode footer остаётся на экране, вне слоя focus mode: его View button-ы не реагируют, а chip продолжает
работать.

**Version chip** — это версия приложения, `v<major>.<minor>.<N>`, и одна точка на всё, что предлагает сделать его popover;
худшее идёт первым ([Harness](harness.md), [Updates](updates.md)):

| Точка | Когда |
|---|---|
| Красная | Harness-у нужен пользователь: его последний вызов не удался («Harness unavailable»), он не установлен или сломан, а этот запуск может сделать Install или Retry, или старый Harness ждёт переноса («Move old Harness…») |
| Янтарная | Ждёт обновление: Update worfy, который даёт сигнал (тихий Available update его не даёт), Harness с акцентной «Update Harness», Harness plugin, отключённый в Claude Code («Enable»), или строка Codex с кнопкой или «Codex: approve hooks» |
| Нет | Во всех остальных случаях. «Replace Harness» той же версии точки не даёт, как и development-запуск, который не может установить |

Пока идёт собственная установка Harness, точка ждёт её ответа. Accessible name chip-а и первая строка его tooltip — это
версия и то, ради чего стоит точка, например «worfy v0.4.N — Harness needs Install». Пока собирается Update, chip
показывает его шаг, обрезанный многоточием, а весь шаг есть в tooltip; в окне шириной 1100 пикселей и меньше chip
показывает только версию.

Нажатие на chip открывает над ним popover, в нём до четырёх строк:

1. **worfy**: версия, чего ждёт Update, и его действия: Update worfy, Restart now, Restart when idle и What's new (см.
   [Updates](updates.md)). What's new открывается на месте popover-а.
2. **Harness**: строка Harness с её кнопками Install, Update Harness, Replace Harness, Retry, Enable и Move old Harness…
   (см. [Harness](harness.md)).
3. **Codex**: строка Codex с её кнопкой, пока Harness стоит в Claude Code (см. [Vendors](vendors.md)).
4. **Memory**: собственная память worfy, пока в Settings → General включено «Memory in the version popover».

Esc, нажатие вне popover-а или повторное нажатие на chip его закрывает. Install, Update и Replace сначала называют в
диалоге каждую команду. Форма переноса и шаг «Approve the Harness hooks in Codex» открываются отдельными окнами и
закрывают popover; шаг hook-ов по-прежнему открывается сам, пока popover закрыт.

#### Windows

Окно сохраняет системную рамку и заголовок; footer такой же, как на macOS.

#### On a Linked machine

Chip показывает версию, Update и Harness этого компьютера, а не Linked machine: их каналы — `local`.

### How it works

Окно — колонка: строка из sidebar и main area, а под ней footer. Высота footer-а не уменьшается с масштабом интерфейса,
как у toolbar, потому что у footer-а нет кнопок окна, с которыми надо выравниваться. Chip смонтирован на всю жизнь окна и
держит состояние Harness, поэтому диалоги и шаг hook-ов Codex не зависят от того, открыт ли popover. Точка — одно чистое
правило над Update, состоянием Harness, предложением перенести старый Harness и неудачей последнего вызова Harness. В
полосе 28 пикселей нет места для строк Harness, поэтому chip несёт одну точку, а строки живут в popover-е.

### Implementation

| Что | Где |
|---|---|
| Полоса | `src/renderer/shell/footer/Footer.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/shell.css`, `--footer-height` в `src/renderer/theme/tokens.css` |
| Version chip и его popover | `src/renderer/shell/footer/VersionChip.tsx`, набор компонентов `src/renderer/theme/kit/Popover.tsx`, строка приложения `AppLine` в `src/renderer/update/UpdateChip.tsx` |
| Правило точки | `src/renderer/shell/footer/version-dot.ts` |
| Строки Harness и Codex | `src/renderer/harness/HarnessStatus.tsx`, `src/renderer/harness/harness-lines.ts`, состояние — в `src/renderer/harness/useHarnessStatus.tsx` |
| Строка памяти | `src/renderer/memory/AppMemory.tsx` |

Главные test-ы: `test/unit/version-dot.test.tsx`, `test/unit/update-chip.test.tsx`, `test/unit/view-zones.test.tsx`,
`test/e2e/footer.spec.ts`, `test/e2e/view-buttons.spec.ts`.

## Command palette

### Behaviour

Одно поле над окном, которое находит команды и объекты Project-а. Его открывает поле «Search or run…» в toolbar и ⌘K (Ctrl+K на
Windows). В окне до 1100 px в ширину поле показывает только иконку и сочетание клавиш, чтобы toolbar помещался в самое маленькое
окно с открытым sidebar. Панель шириной 560 пикселей и высотой не больше 440.

Ввод ранжирует строки. ↑ и ↓ ходят по всем строкам через группы и заворачивают по кругу, а указатель над строкой выбирает её.
Enter или клик запускает выбранную строку. Esc или нажатие вне панели закрывает Command palette.

Command palette модальная. Tab и Shift+Tab остаются внутри неё. Пока она открыта, собственные shortcut-ы окна с ⌘ (⌘F, ⌘↩)
ничего не делают; пункты меню приложения по-прежнему работают. При закрытии фокус возвращается туда, где был до открытия
Command palette. Settings, открытые поверх неё по ⌘,, лежат над ней и забирают клавиши; когда Settings закрываются, фокус
возвращается в поле Command palette, и запрос сохраняется.

Команда, которая сработала, закрывает Command palette. Команда, которая не сработала, оставляет её открытой с причиной внизу, до
следующего ввода или выбора. Пока команда выполняется, другой выбор ничего не делает.

**Группы.**

| Группа | Строки |
|---|---|
| Action | New session; New Product Session; «New …» на каждый пункт меню Canvas; Tidy up; Arrange by Epic; Re-pack; Archive finished sessions now; Process gate queue; Run wave `<epic>`; Ship ticket `<epic>/<NN>`; Open changes `<epic>/<NN>`; Resolve conflicts, Fix checks и Address comments `<owner>/<repo>#<N>`; Reconnect machine…; Remove machine…; Update worfy |
| View | Switch to Canvas; Switch to Session; Pipeline board; Open Run history, при открытом Project-е; Pull requests, при открытом Project-е; Acceptance; First-run checks; Health check; Getting started; Settings…; Keyboard shortcuts; worfy Guide; Guide: `<Topic>` на каждый Topic; Show only tag `<tag>`; Show all Nodes |
| Project | Switch to project `<name>` на каждый другой Project |
| Go to | Orchestrator; каждый Epic, Ticket и ADR; каждый Node из Layout, кроме тех, что worfy рисует из workflow, и binding anchor-ов |
| Manual check | Каждая неотмеченная ручная проверка Ticket-а. Эти строки появляются только после ввода |
| In transcripts | Session-ы Project-а, в разговоре которых есть запрос |

«Health check» открывает Settings → Health, как кнопка Health check на rail. «First-run checks» открывает диалог First run —
окно первой настройки Machine; одно имя другое не заменяет.

Некоторые строки есть только в некоторых состояниях:

- Process gate queue: только на Machine, которой Profile даёт роль `serve` в cross-machine gate. В её подробностях число
  ждущих PR и возраст самого старого.
- Run wave и Ship ticket: только там, где у Epic frame или Ticket-а есть эта кнопка.
- Open changes `<epic>/<NN>`: для Ticket-а с веткой worktree, строкой `Branch:` или в работе, с Ticket-ом в подробностях.
  Строка открывает [вид Changes](changes.md#the-changes-view) Ticket-а во всё окно, как кнопка Changes карточки;
  **← Canvas** и Esc возвращают назад. Она только читает git, поэтому на экране только для чтения активна.
- Resolve conflicts, Fix checks и Address comments `<owner>/<repo>#<N>`: по строке на каждое действие, которое предлагают
  кнопка Ticket-а и её «▾», с Ticket-ом в подробностях. Неактивная строка называет ту же причину, что и кнопка. Если действие
  выбрано из Command palette, новый Session Node встаёт туда, куда встаёт любой новый Node.
- Reconnect machine…: только для Linked machine, которая не online или у которой сменился сертификат. Remove machine…: для
  каждой Linked machine. Имя Machine стоит в подробностях строки.
- Show all Nodes: только пока включён фильтр по тегу.
- Guide: `<Topic>`: только после ввода. Открывает [worfy Guide](#worfy-guide) на этом Topic-е.
- Update worfy: только там, где Update включён, с Project-ом и без. Перезапускает в собранный Update, собирает Available
  update или проверяет, есть ли он; подробности строки говорят, что именно: см. [Updates](updates.md).

Строка «Go to» показывает Canvas и центрирует его на Node-е. Архивный или скрытый Node сначала возвращается. Ticket в свёрнутом
frame центрирует этот frame. Строка ADR открывает этот ADR только для чтения и не двигает Canvas. При скрытом sidebar ADR
откроется, когда sidebar покажут. Строка Orchestrator открывает Session view и запускает Orchestrator, если он не работает.
«Acceptance» открывает вид [Acceptance](acceptance.md), с Project-ом и без. Строка Manual check открывает вид Acceptance на
своём пункте, когда пункт есть в его очереди, а иначе ведёт к своему Ticket-у; она ничего не отмечает. Выбор строки «In transcripts» открывает эту Session в Session
view.

**Ранжирование.** Точный ключ бьёт любой заголовок, например номер Ticket-а (`07`, `7`, `worfy-mvp/07`) или номер ADR. Дальше по
порядку: начало заголовка, начало слова в заголовке, любое место заголовка, подробности, все слова запроса и символы запроса по
порядку с пропусками. Показано не больше 50 строк команд, до остальных доводит более длинный запрос. Группа стоит там, где стоит
её лучшая строка. С пустым полем в Project-е группы идут так: Action, View, Project, Go to.

**Неактивные строки.** Run wave или Ship ticket, которые сейчас нельзя запустить, остаются в списке серыми, с причиной рядом с
заголовком и в tooltip. Это та же причина, что показывает кнопка. Клик или Enter на такой строке ничего не делает.

**Длинные заголовки.** На строке без собственного состояния у обрезанного заголовка весь текст есть в tooltip. Строка Manual check
переносит заголовок максимум на 3 строки и затем обрезает. Tooltip строки «In transcripts» — весь её фрагмент.

**In transcripts.** Поиск начинается через 250 мс после последней клавиши, для запроса от 3 до 200 символов. Регистр не важен. Он
охватывает каждую Session, которую Claude Code записал для Project-а, где бы она ни была начата: в worfy, в терминале или в Claude
Desktop. Ещё он охватывает Codex Session-ы Project-а, те, что нашёл последний их список (см. [Sessions](sessions.md)). Читаются
сообщения пользователя и ответы агента, но не вызовы инструментов, их вывод, thinking, hook-и и записи Subagent-ов.

Приходит не больше 20 Session-ов, сначала новые, Claude Code и Codex вместе, у каждой фрагмент до 120 символов вокруг совпадения.
Каждая строка заканчивается логотипом Vendor-а, чей агент вёл Session; её tooltip называет Vendor. Один поиск читает не больше
200 транскриптов и 64 МиБ; thread Codex считается одним транскриптом, а его сообщения входят в 64 МиБ. Когда предел оставляет
часть непрочитанной, группа пишет «Older transcripts were not searched». То же она пишет, когда Codex не может прочитать thread:
до конца этого поиска у Codex не запрашивается ни один другой thread. Ещё она пишет «Searching…» и «Could not search the
transcripts: …». Эти строки идут сверх 50 строк команд, под ними.

**Без Project-а** в Command palette есть строки View, Project и строки машин, а поиска по транскриптам нет.

#### Windows

Внутри Terminal клавиша Ctrl+K принадлежит shell-у, и Command palette не открывается. См. [Shortcuts](#shortcuts).

#### On a Linked machine

На экране только для чтения строки, которые изменили бы Project, неактивны с подсказкой «… gives this Machine read-only access». Это
New session, New Product Session, New …, Tidy up, Arrange by Epic, Re-pack, Archive finished sessions now, Process gate queue, Run
wave, Ship ticket, Fix checks, Resolve conflicts и Address comments, а также строка Go to архивного или скрытого Node-а. Виды, перемещение Canvas и переключение Project-ов остаются
активными. Строка Orchestrator только показывает Orchestrator и не запускает его.

Строки машин остаются активными: они касаются связи этой Machine, а не Project-а. Поиск по транскриптам идёт на Machine Project-а.

### How it works

- **У Command palette нет своего списка.** Команды строятся из того, что окно уже знает: модель workflow, Layout, Session-ы, ADR,
  Project-ы. Тип Node-а, который экспортирует `createLabel`, получает строку «New …» так же, как пункт меню Canvas
  ([ADR-0014](../../adr/0014-canvas-menu-items-from-node-type-files.md)).
- **Команда только просит.** Она идёт теми же запросами к Canvas и теми же вызовами IPC, что и кнопка, которую заменяет. Активны ли
  Run wave и Ship ticket, решает код этих кнопок, и main проверяет снова, прежде чем что-то запустить. Здесь ничто не пишет статус
  Ticket-а или файл Project-а ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **Команды ранжируются в renderer, транскрипты ищутся в main.** Ранжирование — чистая функция, которая работает при каждом нажатии.
  Поиск по транскриптам идёт в main и держит текст транскрипта в памяти по размеру и времени изменения файла. Текст thread-а Codex
  он держит так же, по времени thread-а; thread, у которого время изменилось, читается снова. Ответ на старый запрос
  отбрасывается, когда приходит.

### Implementation

| Что | Где |
|---|---|
| Поле, панель, клавиши, поиск по транскриптам | `src/renderer/palette/CommandPalette.tsx` |
| Модальное окно под панелью: фокус, Esc, слой | `src/renderer/theme/kit/Dialog.tsx`, `src/renderer/theme/layers.ts` |
| Построение команд из состояния окна | `src/renderer/palette/commands.ts` |
| Группировка ранжированных строк | `src/renderer/palette/groups.ts` |
| Ранжирование (`rankItems`), общее с поиском по Canvas | `src/renderer/find/search-index.ts` |
| Что делает Run wave и Ship ticket активными | `src/renderer/canvas/actions/gates.ts`, `src/shared/actions/render-template.ts` |
| Что запускают Run wave, Ship ticket и Process gate queue | `src/main/actions/launch.ts`, `src/main/ipc/actions.ts` |
| Поиск по транскриптам и его пределы | `src/main/claude-home/search.ts`, `src/shared/ipc/claude-home.ts` |
| Thread-ы Codex, которые читает поиск | `src/main/ipc/claude-home.ts`, `src/main/vendors/codex/sessions-on-canvas.ts` |

Главные test-ы: `test/unit/palette-commands.test.tsx`, `test/unit/palette-groups.test.tsx`, `test/unit/palette-dialog.test.tsx`,
`test/unit/palette-transcripts.test.tsx`, `test/unit/palette-manual-check-row.test.tsx`, `test/contract/claude-home-search.test.ts`,
`test/e2e/palette-find.spec.ts`, `test/e2e/palette-groups.spec.ts`.

## Shortcuts

### Behaviour

Каждый shortcut из списка ниже записан в одном registry в коде, и пользователь не может их менять. На Windows основная клавиша — Ctrl,
там, где на macOS ⌘.

| Группа | Действие | macOS | Windows |
|---|---|---|---|
| Window | Search or run a command | ⌘K | Ctrl+K |
| Window | Settings | ⌘, | Ctrl+, |
| Window | Hide or show the sidebar | ⌘B | Ctrl+B |
| Window | Keyboard shortcuts | ⌘/ | Ctrl+/ |
| Window | Keyboard shortcuts, вне текстового поля | ? | ? |
| Window | Bigger, Smaller, Actual size интерфейса | ⌥⌘=, ⌥⌘-, ⌥⌘0 | Ctrl+Alt+=, Ctrl+Alt+-, Ctrl+Alt+0 |
| Canvas | Zoom in, Zoom out | ⌘=, ⌘- | Ctrl+=, Ctrl+- |
| Canvas | Undo, Redo | ⌘Z, ⇧⌘Z | Ctrl+Z, Ctrl+Shift+Z |
| Canvas | Move the selection to the trash | ⌫ или Delete | Backspace или Delete |
| Canvas | Drag without snapping | ⌘ + drag | Ctrl + drag |
| Focus mode | Open the selection in focus mode | ⌘↩ | Ctrl+Enter |
| Focus mode | Leave focus mode | Esc | Esc |
| Find | Find on the Canvas или in the Session | ⌘F | Ctrl+F |
| Find | Next match, Previous match | Enter, ⇧Enter | Enter, Shift+Enter |
| Find | Close the find bar | Esc | Esc |
| Session | Back to what started the Subagent | ⌘[ | Ctrl+[ |
| Session | Send the message, New line | ⏎, ⇧⏎ | Enter, Shift+Enter |
| Session | Interrupt the turn | Esc | Esc |
| Session | Earlier and later messages | ↑↓ | ↑↓ |
| Session | Choose the slash command | ⏎ | Enter |
| Terminal | Command request (zsh с Terminal AI) | ⌘I | нет |

Клавиши zoom отзываются ещё на `+` и `_`.

**Окно Keyboard shortcuts** показывает эти записи в группах выше, с клавишами так, как их пишет эта система. Оно открывается из
Help ▸ Keyboard Shortcuts, по ⌘/, по `?` вне текстового поля и вне Terminal, и из Command palette. Esc, Close или нажатие на фон
закрывает его, и фокус возвращается туда, где был. Пока оно открыто, ни одна клавиша не доходит до приложения за ним, кроме
accelerator-ов меню приложения. Settings → Shortcuts показывает тот же список. При открытых Settings запрос открыть shortcuts
показывает этот раздел, а открытие Settings поверх окна закрывает окно.

**Раскладки клавиатуры.** Латинская буква читается с колпачка клавиши, поэтому shortcut следует за буквой на QWERTZ, AZERTY, Dvorak и
BÉPO. В раскладке другого алфавита буква берётся по месту клавиши: кириллическая буква на клавише K — это K. `[` у Back тоже читается
по месту, когда в раскладке там буква. Для прочей пунктуации Shift не считается, потому что он только выбирает символ: `?` работает
там, куда его ставит раскладка. Нажатие с зажатым другим модификатором не совпадает ни с одной записью: это Ctrl на macOS и клавиша
Windows на Windows.

#### Windows

- Внутри Terminal запись с Ctrl не совпадает, поэтому Ctrl+K и Ctrl+F доходят до shell-а. Исключение — zoom Canvas: Ctrl+= и Ctrl+-
  по-прежнему меняют масштаб, и только Ctrl+\_ остаётся у shell-а. См. [Terminal](terminal.md).
- AltGr вводит символ и никогда не shortcut, хотя приходит как Ctrl+Alt. Ctrl+Alt, нажатые двумя клавишами, — это сочетание.
- Меню показывает Ctrl+/, но не забирает его. Его ловит страница, вне Terminal, где он остаётся у shell-а. При открытых Settings
  клавиша ничего не делает. Ctrl+B остаётся у shell-а сам по себе: xterm.js его отменяет, а меню получает только нажатия, которые
  страница не отменила.
- У ⌘I здесь нет записи, потому что Ctrl+I — это Tab shell-а.

### How it works

- **Один список для всего, что говорит о клавише.** Обработчики renderer-а, подписи рядом с кнопками, accelerator-ы меню приложения и
  окно Keyboard shortcuts читают один registry, поэтому клавиша и написанное о ней не могут разойтись. Запись составлена без системы:
  `primary` — это ⌘ на macOS и Ctrl в остальных.
- **Места не конфликтуют.** У записи есть scope, например `app`, `canvas` или `terminal`. Две записи одного scope никогда не делят
  клавиши, и ни одна запись не делит клавиши с записью `app`. Это проверяет test.
- **Правило Terminal одно.** На Windows клавиши shell-а делят Ctrl с клавишами worfy, поэтому запись с основной клавишей уступает
  нажатие внутри терминала. Запись называет в `shellKeeps` клавиши, которые оставляет за собой shell, остальные остаются за
  записью. Без `shellKeeps` shell оставляет за собой все. На macOS клавиши shell-а на Ctrl, а worfy на ⌘, поэтому там ничего не
  уступается.
- **Система берётся из user agent**, без канала IPC: `src/renderer/main.tsx` пишет её на `<html>` как `data-platform`, и там её читают
  стили и `currentPlatform`.

### Implementation

| Что | Где |
|---|---|
| Registry и accelerator записи | `src/shared/shortcuts.ts` |
| Сопоставление нажатия, подпись, текстовые поля и Terminal Node | `src/renderer/shortcuts/match.ts` |
| Система, основная клавиша, клавиша нажатия, запись сочетания | `src/renderer/platform.ts` |
| Окно и список | `src/renderer/shortcuts/ShortcutsOverlay.tsx`, `src/renderer/settings/ShortcutsSection.tsx` |
| Его состояние | `src/renderer/shortcuts/shortcuts-window.ts` |
| Модальное окно, в котором оно нарисовано, и клавиши приложения, пока оно открыто | `src/renderer/theme/kit/Dialog.tsx` |

Главные test-ы: `test/unit/shortcuts.test.tsx`, `test/unit/shortcuts-overlay.test.tsx`, `test/unit/platform-shortcuts.test.tsx`,
`test/unit/platform-keys.test.ts`, `test/e2e/shortcuts.spec.ts`.

## Menu

### Behaviour

Меню приложения построено на меню Electron по умолчанию, плюс собственные пункты worfy.

| Меню | Пункты |
|---|---|
| Меню приложения, названо по приложению (macOS) | About; Settings…; Services; Hide, Hide Others, Show All; Quit |
| File | macOS: по умолчанию Electron. Windows: Settings…; Quit |
| Edit | По умолчанию Electron |
| View | Reload; Force Reload; Toggle Developer Tools; Actual size; Bigger; Smaller; Toggle Full Screen; Toggle Sidebar; Show Minimap |
| Window | По умолчанию Electron |
| Help | worfy Guide; Keyboard Shortcuts; на macOS ещё системное поле поиска |

- **Settings…** (⌘,) открывает окно [Settings](#settings) того окна, для которого выбран пункт.
- **Bigger и Smaller** меняют масштаб интерфейса Machine на десятую, от 80 % до 150 %, а **Actual size** ставит 100 %, во всех окнах.
  Они стоят там, где пункты zoom у Electron, и не меняют масштаб одного окна. Их клавиши содержат ⌥ (Alt), потому что ⌘= и ⌘- меняют
  масштаб Canvas. Bigger отключён на 150 %, Smaller на 80 %, также когда масштаб изменён в Settings.
- **Toggle Sidebar** (⌘B) скрывает или показывает sidebar, где бы ни был фокус. Единственное исключение — внутри Terminal на Windows,
  см. ниже. У обычного вида и focus mode отдельные ответы, и переключатель меняет ответ того, что сейчас показывает окно, для которого
  выбран пункт. Оба ответа — настройки Machine: все окна в этом режиме следуют за ними, и ответы переживают перезапуск. Кнопка в toolbar
  и в панели focus mode делает то же.
- **worfy Guide** открывает [worfy Guide](#worfy-guide). Клавиши у него нет.
- **Show Minimap** — это флажок, сначала включён. Он действует на все окна и живёт, пока worfy не выйдет.
- Команда, выбранная сразу после появления окна, выполняется, а не теряется. Она ждёт страницу до 10 секунд, и ждать могут до 8 команд
  на окно. Перезагрузка страницы отбрасывает то, что ждало.

#### Windows

Окно с собственной рамкой системы, а меню под её заголовком. Меню приложения нет, поэтому Settings… лежит в File. Внутри Terminal
Ctrl+B остаётся у shell-а: см. [Shortcuts](#shortcuts).

#### On a Linked machine

Меню принадлежит Machine, чей экран его показывает. Его команды никогда не идут на Linked machine, а окно, показывающее Project с Linked
machine, открывает Settings своей Machine.

### How it works

Установка меню заменяет меню по умолчанию целиком, поэтому его роли выписаны явно, а меню приложения и File выписаны по пунктам.
Каждый accelerator берётся из registry [Shortcuts](#shortcuts). Accelerator принадлежит меню, а не обработчику клавиш страницы, поэтому
⌘B работает, где бы ни был фокус.

Пункт, которому нужен renderer окна, посылает ему `menu.command`: окну, для которого выбран пункт, иначе окну в фокусе, иначе никому.
Окно может быть на экране раньше, чем React смонтирован. Поэтому main посылает команду только после того, как страница сказала через
`menu.ready`, что следует за этой командой, а до тех пор держит её. Порядок сохраняется внутри одной команды, но не между командами.

Состояние minimap хранится в памяти main и не является настройкой.

### Implementation

| Что | Где |
|---|---|
| Шаблон и его установка | `src/main/menu.ts` |
| Удержание и доставка `menu.command` | `src/main/ipc/menu.ts`, `src/shared/ipc/menu.ts` |
| Следование за командой на странице | `src/renderer/menu-command.ts` |
| Состояние Show Minimap | `src/main/ipc/view.ts`, `src/shared/ipc/view.ts` |
| Шаги масштаба | `src/main/settings/interface-scale.ts` |
| Toggle Sidebar на странице | `src/renderer/shell/sidebar-visibility.ts` |

Главные test-ы: `test/contract/view-menu.test.ts`, `test/unit/menu-command.test.tsx`, `test/e2e/focus-sidebar.spec.ts`.

## Settings

### Behaviour

Settings — это настройки самого worfy на этой Machine. Окно открывается из «Settings…» меню приложения (⌘,) и из Command palette. Оно
модальное, с разделами в колонке слева, под заголовками четырёх групп: App, Agents, Workflow и Workspace. У каждой строки
перед именем стоит иконка. Колонка прокручивается, когда строки выше окна. Esc или Close закрывает его, и фокус
возвращается туда, где был. ↑ и ↓ ходят по разделам из одной группы в следующую, а Tab идёт по кругу по элементам окна.
Заголовок группы — это подпись: он не принимает ни клика, ни фокуса. Пока оно открыто, ⌘K, ⌘F и ⌘↩ ничего не делают. Нажатие рядом с окном оставляет его открытым,
как и нажатие на toast. Settings, Keyboard shortcuts и Guide — одно модальное окно из собственного набора компонентов приложения:
приложение за ним скрыто от screen reader-а, toast-ы — нет, и они остаются над окном.

| Группа | Раздел | Что в нём |
|---|---|---|
| App | General | Interface scale; Memory in the version popover; Fold Epics without work after (группа «Older» секции Epics, см. [Workflow](workflow.md)); View buttons (Reset layout); Version; Updates там, где Update включён: см. [Updates](updates.md) |
| App | Health | Проверки First run с их действиями и «Check again». Открытие раздела запускает проверку. Нажатая кнопка показывает свою работу спиннером и своими словами («Checking…», «Installing…», «Downloading…»), а её строка пишет «Running…» (пока идёт «Check again», каждая строка пишет «Checking…»); остальные кнопки выключены, и их tooltip говорит, что идёт другая проверка. Долгое действие (npm, модели qmd, коллекции qmd, Harness) называет свой шаг и прошедшее время под своей строкой |
| App | Shortcuts | Список окна Keyboard shortcuts |
| App | Machines | Переключатели связи и уровень доступа каждой Linked machine: см. [Link](link.md) |
| Agents | Assistant | Assistant на этой Machine: его переключатель, work hours, проверки источников и уведомления, его обязанности, расход и пределы, и правила, которые он помнит: см. [Assistant](assistant.md) |
| Agents | Terminal AI | Переключатели и модели Terminal AI: см. [Terminal](terminal.md) |
| Agents | Vendors | По строке на каждый Vendor, которого запускает эта сборка, с его аккаунтом или входом: см. [Vendors](vendors.md) |
| Agents | Sessions | Окно autocompact для Session-ов |
| Workflow | Autopilot | Run mode по умолчанию, Start window и дневной бюджет Limits: см. [Run planning](run-planning.md#settings--autopilot) |
| Workflow | Plan | План, под которым вошёл Claude Code, и для Pro готовый набор с кнопкой Apply |
| Workflow | Pipeline | Pipeline активного Project-а: см. [Workflow](workflow.md) |
| Workflow | Pull requests | Уведомления и утренний дайджест PR inbox, оба по умолчанию включены: см. [Notifications](notifications.md#утренний-дайджест) |
| Workspace | Canvas | Автоматический архив завершённых Session-ов |
| Workspace | Browser | Когда Live Browser засыпает |
| Workspace | Integrations | Все Integration-ы Machine, их состояние и Project-ы, которые их используют, с Sign in, Sign out, Remove и Clean up: см. [Integrations](integrations.md#settings--integrations) |

Изменение сразу доходит до всех окон Machine. Когда main не может его сохранить, раздел говорит об этом с причиной, и настройка остаётся
прежней. Большинство разделов пишет «Not saved: …».

**Значения и значения по умолчанию.**

| Настройка | Значения | По умолчанию |
|---|---|---|
| Interface scale | 80–150 % с шагом 10 % | 100 % |
| Memory in the version popover | вкл., выкл. | вкл. |
| Sessions: Orchestrator | 100K–1M токенов с шагом 10K, или Claude Code default | 400K |
| Sessions: Other Sessions | 100K–1M токенов с шагом 10K, или Claude Code default | 500K |
| Archive finished sessions after | Never, 6 h, 24 h, 3 days, 7 days | 24 h |
| …and when their Ticket is done | вкл., выкл. | вкл. |
| Notify about new review requests and replies | вкл., выкл. | вкл. |
| Morning digest | вкл., выкл. | вкл. |
| Live browsers at once | 1, 2, 3, 4, 5, 6, 8, 10 | 3 |
| Sleep when off screen after | 10 с, 30 с, 1, 2, 5, 10 мин | 30 с |
| Sleep when unused after | 1, 2, 5, 10, 15, 30 мин, 1 ч | 5 мин |
| Readable from zoom | 25, 30, 40, 50, 60, 75 % | 40 % |
| Default run mode | Fastest, Budget-aware, Start window | Budget-aware при включённом бюджете, Fastest при выключенном |
| Start window from | 00:00–23:00 по целым часам | 23:00 |
| Start window to | 00:00–23:00 по целым часам | 07:00 |
| Daily budget of the Limits | вкл., выкл. | выкл. |
| Reserve for your own work | 0, 5, 10, 15, 20, 25, 30, 40, 50 % недели | 15 % |

- **Interface scale.** Масштабируется всё окно: текст, Canvas, Terminal, Card-ы. Пока ползунок тянут, меняется только значение рядом с
  ним. Масштаб применяется, когда ползунок отпущен или клавиша сделала шаг. View ▸ Bigger, Smaller и Actual size меняют ту же настройку.
- **Memory in the version popover** показывает, сколько памяти занимают собственные процессы worfy, в последней строке
  popover-а version chip-а в footer-е. Сессии Terminal не считаются. Main замеряет память, только пока настройка включена и
  какой-то version popover открыт.
- **View buttons** — это Reset layout: Canvas и Session обратно в toolbar, Pull requests и Acceptance на rail, Pipeline и
  Runs в footer, как делает пункт меню View button (см. [View buttons](#view-buttons)). Кнопка неактивна, пока layout по
  умолчанию.
- **Version** — номер сборки, `<major>.<minor>.<N>`, как его показывает version chip в footer-е: N считает commit-ы от начала истории до commit-а, из
  которого собран worfy (`git rev-list --count HEAD`), поэтому у более новой сборки `main` номер больше, а один commit даёт один номер
  на каждой Machine. Рядом, в скобках, стоит версия сборки `<semver>+<short SHA>`, которая называет commit. Сборка с незакоммиченными
  изменениями заканчивается на `.dirty`: она не совпадает со своим commit-ом. У сборки из shallow clone или из папки вне git номера
  нет, и она показывает только версию сборки.
- **Sessions.** Поле принимает тысячи токенов, а введённое значение приводится к диапазону и шагу. Строка под каждой ролью называет,
  откуда окно: Custom, Claude Code default, файл настроек Claude Code или worfy default. Окно применяется после перезапуска Session, и
  worfy сам ни одну не перезапускает. Когда login shell задаёт `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, раздел говорит, что она важнее обеих
  настроек.
- **Canvas.** Завершённая Session уходит с Canvas через это время после последнего сообщения, и ничего не удаляется. Session завершённого
  Ticket-а уходит через час после последнего сообщения, пока включён второй переключатель.
- **Autopilot.** Пока run mode не выбран, значение по умолчанию следует за переключателем бюджета. Start window задаётся в местном
  времени и может переходить через полночь. Два его часа отключены, если run mode по умолчанию не Start window, а час, равный другой
  границе, не сохраняется. Резерв отключён, пока выключен бюджет, если только run mode по умолчанию не Budget-aware.
- **Plan.** Max и планы, которых worfy не знает, предложения не получают. Без клика по Apply ничего не пишется.
- Значение, заданное вручную вне предложенного списка, но в пределах, показывается как есть. Это касается значений Browser и резерва.

У sidebar есть ещё три настройки того же рода и нет строки в этом окне: свёрнуты ли Epic-и «Older» у Project-а, показан ли
sidebar (отдельно для обычного вида и focus mode) и его ширина (тянется за правый край, см. [Sidebar](#sidebar)).

Настроек Project-а, например его Terminal shell, здесь нет. Они в «Project settings…»: см. [Projects](projects.md).

#### On a Linked machine

Окно, показывающее Project с Linked machine, читает и пишет настройки своей Machine, а Linked machine до них никогда не дотягивается.
Pipeline показывает Pipeline той Machine только для чтения и говорит, где его править. Plan говорит, что план и его настройки применяются
в worfy на Machine Project-а.

### How it works

- **Settings — собственное состояние worfy** ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). Они не попадают ни в репозиторий,
  ни в Profile. Два раздела — исключение: Pipeline и набор Plan меняют Profile, и main делает это через `bin/profile-set` из Harness.
- **Большинство разделов делит один файл**, `app-settings.json` в папке данных. Terminal AI хранит `terminal-ai.json`, а Machines хранит
  `link/settings.json`.
- **Чтение прощает, запись строгая.** Без файла действуют значения по умолчанию. Файл, который нельзя разобрать или в котором поле
  неверного типа, откладывается как `app-settings.json.unreadable-<time>`, и действуют значения по умолчанию. Отсутствующее поле получает
  значение по умолчанию, неизвестное отбрасывается, а масштаб или окно autocompact вне диапазона приводятся к нему. Порог архива, которого
  эта версия не знает, или значение Browser или Autopilot вне пределов читаются как не выбранные, а остальной файл остаётся.
- **Выбор переживает значения по умолчанию.** `sessionArchive`, `browserSleep` и `autopilotBudget` хранят только поля, которые выбрал
  человек, поэтому поздняя смена значения по умолчанию их не трогает. Не выбранное окно autocompact уступает `autoCompactWindow` из
  `~/.claude/settings.json`: тогда worfy ничего не передаёт. Иначе worfy передаёт своё значение по умолчанию.
- **Каждое окно держит самое новое состояние.** Настройками владеет main, и изменение, которое ничего не меняет, ничего не пишет. Любое
  другое увеличивает `revision` и идёт во все окна как `appSettings.changed`. Renderer держит состояние с наибольшей revision, потому что
  ответ и событие могут прийти в любом порядке.
- **Настройка читается, когда нужна.** Main читает окно autocompact при каждом старте Claude Code у Session, настройки архива при каждом
  run-е архива, настройки сна при каждой проверке правил, а бюджет перед каждой Wave.
- **Полосы вокруг кнопок окна сохраняют размер.** Масштаб увеличивает всё окно, но кнопки окна macOS остаются на месте в пикселях окна.
  Поэтому `--toolbar-height` равен 52 пикселям окна при любом масштабе, а содержимое внутри всё равно масштабируется. У footer-а нет кнопок окна, поэтому его `--footer-height` масштабируется вместе с
  остальным. Каждая загрузка
  страницы получает масштаб снова, потому что Chromium хранит свой zoom на origin.

### Implementation

| Что | Где |
|---|---|
| Схема, пределы, значения по умолчанию, откуда окно | `src/shared/settings/app-settings.ts` |
| Хранилище и чтение файла | `src/main/settings/store.ts`, `src/main/storage/json-file.ts` |
| Каналы `appSettings`, все `local` | `src/shared/ipc/app-settings.ts`, `src/main/ipc/app-settings.ts` |
| Масштаб как zoom каждого окна | `src/main/settings/interface-scale.ts` |
| Копия настроек в renderer | `src/renderer/settings/useAppSettings.ts` |
| Окно и его состояние | `src/renderer/settings/SettingsDialog.tsx`, `src/renderer/settings/settings-window.ts` |
| Модальное окно, его фокус и клавиши приложения, пока оно открыто | `src/renderer/theme/kit/Dialog.tsx`, `src/renderer/theme/kit/layer.ts` |
| Список разделов, их группы и иконки: каждый `*Section.tsx` экспортирует `order`, `title`, `group` и `icon` | `src/renderer/settings/sections.ts`, `src/renderer/settings/icons.tsx` |
| Масштаб на `<html>` | `src/renderer/settings/interface-scale.ts` |

Раздел — это один файл `src/renderer/settings/<Name>Section.tsx`, который экспортирует компонент по умолчанию, `order` и `title`.
Достаточно добавить файл: окно находит его через `import.meta.glob`, а файл без этих экспортов останавливает renderer с указанием своего
пути. Строки используют `src/renderer/settings/controls.tsx`.

Главные test-ы: `test/contract/app-settings.test.ts`, `test/unit/use-app-settings.test.tsx`, `test/unit/settings-dialog.test.tsx`,
`test/unit/interface-scale.test.tsx`, `test/e2e/settings.spec.ts`, `test/e2e/interface-scale.spec.ts`. У каждого раздела свой test, например
`test/unit/settings-sessions.test.tsx`.

## worfy Guide

### Behaviour

worfy Guide — короткая наглядная справка внутри приложения. Это окно поверх окна приложения: список Topic-ов слева, Topic справа.
Topic — один экран: диаграмма, короткий текст, свёрнутый под ним **Under the hood** (ещё текст, таблица главных файлов, пределы) и
**Full page**.

- **Открытие.** Help ▸ worfy Guide и строка «worfy Guide» в Command palette открывают его там, где он был. У каждого Topic-а есть и
  своя строка в Command palette, «Guide: `<Topic>`», которая открывает Guide на этом Topic-е. Ссылка «worfy Guide» внизу панели
  [Getting started](onboarding.md#getting-started) и под концепциями экрана «Welcome to worfy» в First run тоже открывает его;
  панель и First run остаются за ним такими, какими были. Сам по себе он не открывается.
- **Закрытие.** Esc, Close или клик вне окна закрывает его, и фокус возвращается туда, где был. Пока оно открыто, ни одна клавиша не
  доходит до shortcut-а приложения.
- **Одно модальное окно.** Открытие Guide закрывает Settings и Keyboard shortcuts, а любое из них закрывает Guide.
- **Язык.** EN / RU в заголовке переключает Guide между английским и русским. Остальной worfy остаётся на английском. Пока выбор не
  сделан, Guide на русском, если первый язык системы русский, и на английском в остальных случаях. Выбор — настройка Machine, и он
  переживает перезапуск.
- **Ссылки.** Full page и файлы Under the hood открывают GitHub в браузере системы, на commit-е этой сборки. Сборка, которая не знает
  свой commit, ведёт на `main`.
- **Диаграммы.** По стрелкам диаграммы Topic-а бегут точки. Указатель или фокус клавиатуры на блоке подсвечивает блок, его соседей и
  его связи, показывает подписи этих связей и приглушает остальное. Блок, который называет другой Topic, открывает его по клику или
  Enter. Под диаграммой Play проходит по её шагам, по одному каждые 4 секунды, и останавливается на последнем; кнопка шага показывает
  один шаг и говорит, что в нём происходит, а повторное нажатие показывает всю диаграмму. Точки движутся, только пока Guide открыт и
  диаграмма видна. С Reduce motion в настройках системы они стоят на месте, а подсветка меняется сразу. Screen reader читает описание
  диаграммы и каждую её связь.
- **Ни Project, ни сеть** не нужны.
- Тестовый Topic «How the Guide works» показывается, только когда worfy запущен из неупакованной сборки (`pnpm dev`, e2e test-ы).
  Пока не появились первые настоящие Topic-и, Guide упакованного приложения пишет «No Topics yet.»

### How it works

Окно Guide, его тексты и диаграммы — отдельный chunk. Приложение загружает его, когда Guide открывается в первый раз, поэтому старт
worfy его не загружает. В первом chunk-е лежит только registry Topic-ов: по строке на Topic с его id и английским заголовком,
которые нужны Command palette.

Диаграмма — SVG, который рисует собственный набор компонентов сцены Guide (`src/renderer/guide/scene/`), без библиотеки анимации.
Точки идут по пути, который рисует их линию, кадр за кадром (`requestAnimationFrame`); кадры останавливаются, пока страница скрыта или
диаграмма вне видимости, и заканчиваются, когда Guide закрывается. Цвета блоков следуют группе блока: три группы берут цвета видов
Node-ов, а у Machine, Project и Tools собственные цвета Guide, отделённые от цветов статуса.

Каждый Topic — папка с `topic.json` (страницы `docs/features/`, с которыми он сверен, каждая с commit-ом, и его главные файлы),
`en.json` и `ru.json` (каждый текст, одни и те же ключи в обоих) и его диаграммой. Test падает, когда у строки есть только одна из
двух версий или когда страницы или файла, которые называет Topic, нет в репозитории. `scripts/guide-lag.mjs` сообщает о Topic-ах, у
страницы которых есть commit-ы после того, на котором их сверяли, и о русских текстах старше английских. Он не входит в `pnpm lint`:
отставание не валит PR. Решения записаны в ADR-0090.

### Implementation

| Что | Где |
|---|---|
| Registry Topic-ов, который читает Command palette | `src/renderer/guide/registry.ts` |
| Открыт, закрыт, Topic на экране | `src/renderer/guide/store.ts` |
| Модальное окно, в котором он нарисован | `src/renderer/theme/kit/Dialog.tsx` |
| Загрузка окна при первом открытии | `src/renderer/guide/GuideHost.tsx` |
| Окно | `src/renderer/guide/GuideWindow.tsx`, `src/renderer/guide/guide.css` |
| Тексты и Topic-и | `src/renderer/guide/content.ts`, `src/renderer/guide/strings/en.json`, `src/renderer/guide/topics/skeleton/topic.json` |
| Язык и ссылки | `src/renderer/guide/language.ts`, `src/renderer/guide/links.ts` |
| Отчёт об отстающих Topic-ах | `scripts/guide-lag.mjs` |

Главные test-ы: `test/unit/guide.test.tsx`, `test/unit/guide-content.test.tsx`, `test/unit/guide-window.test.tsx`,
`test/unit/guide-lag.test.ts`, `test/e2e/guide.spec.ts`.

## Theme

### Behaviour

Настройки темы в worfy нет. Окно следует светлому или тёмному оформлению системы и меняется сразу, включая работающий Terminal.

- У светлой палитры бледно-серый фон и синий основной цвет (`#0071e3`). У тёмной, с названием Graphite, тёплый тёмный фон и лаймовый
  основной цвет (`#c8f25a`).
- У Terminal тёмный фон в обеих.
- В светлой мягкие многослойные тени. В тёмной теней нет, только рамки в 1 пиксель.
- У Orchestrator, Session и Epic есть свой цвет для полосы заголовка, иконки вида и minimap. У Subagent цвет его Session, только контуром.
  Эти цвета никогда не используются для текста статуса.
- Элемент, на который действует клик, показывает курсор-указатель, вуаль под указателем и кольцо акцентного цвета при фокусе с клавиатуры.
  Неактивный элемент ничего из этого не показывает, и у него курсор «not allowed».

#### macOS

Заголовка окна нет. Кнопки окна стоят в верхней полосе sidebar, на высоте toolbar, перед надписью worfy, а пока sidebar скрыт — поверх
toolbar. Sidebar полупрозрачный, сквозь него видна vibrancy системы.

#### Windows

Собственная рамка системы с заголовком, непрозрачные страница и sidebar. Пока страница не отрисована, окно показывает цвет фона той темы,
которая была в системе при создании окна.

### How it works

Оформление системы выбирает набор token-ов через `prefers-color-scheme`. Общие блоки берут цвета только из token-ов, поэтому им не нужен код на
каждую тему. Terminal передаёт цвета token-ов в xterm.js как параметры и передаёт их снова при смене схемы. Дизайн — вариант F
([docs/design/F-SPEC.md](../../design/F-SPEC.md)), а цвета по виду Node-а — [ADR-0077](../../adr/0077-node-kind-tokens.md).

Token-ы проверяются test-ами: каждый цвет по таблице спецификации дизайна и каждая пара текста и фона на контраст не меньше 4.5:1, в том числе
на фоне под указателем. Тёмные тени — прозрачная нулевая тень, а не `none`, потому что правила кладут их в списки через запятую, а `none` в
списке заставляет браузер отбросить всё объявление.

### Implementation

| Что | Где |
|---|---|
| Token-ы обеих тем и правила для элементов управления | `src/renderer/theme/tokens.css` |
| Общие блоки | `src/renderer/theme/primitives.tsx`, `src/renderer/theme/primitives.css` |
| Общий список вместо нативного | `src/renderer/theme/Select.tsx`, `src/renderer/theme/select.css` |
| Рамка окна по системе | `src/main/window-frame.ts`, `src/main/window.ts` |
| Непрозрачная страница вне macOS | `src/renderer/shell/shell.css` |
| Цвета Terminal | `src/renderer/canvas/nodes/TerminalNode.tsx` |

Главные test-ы: `test/e2e/theme.spec.ts`, `test/e2e/theme-shadows.spec.ts`, `test/e2e/controls.spec.ts`, `test/unit/contrast.test.ts`,
`test/unit/kind-tokens.test.ts`, `test/unit/shadow-tokens.test.ts`, `test/unit/terminal-theme.test.tsx`, `test/unit/window-options.test.ts`.
