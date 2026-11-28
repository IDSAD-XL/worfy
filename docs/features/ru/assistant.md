# Assistant

> Перевод [английской версии](../assistant.md), commit `same-pr`.

**Assistant** — собственный агент worfy: по одному на Machine, над всеми Project-ами этой Machine. Он замечает, что
работа стоит или ждёт пользователя, объясняет почему и готовит следующий шаг. Сам он делает только короткий закрытый
список внутренних шагов worfy, например продолжает Session после сброса Limits; всё остальное он предлагает, а решает
пользователь. Он не пишет код, не ставит Epic-и в очередь и ничего не публикует вне worfy. Каждое пробуждение — новая
Session Claude Code вне всех Project-ов, без Node-а на Canvas. Он выключен, пока его не включит пользователь, — у нового
пользователя и у того, кто обновил worfy, одинаково ([ADR-0114](../../adr/0114-assistant-app-session.md)). Это не
Orchestrator, главная Session одного Project-а, и не Terminal AI. Термины объяснены в [Concepts](concepts.md).

## Включение и знакомство

### Behaviour

**Переключатель.** В Settings → Assistant → General есть переключатель «Assistant on this Mac». Его описание называет
состояние:

- выключен: «Off. worfy runs no part of it: no wake, no check of a source.»;
- включён: «On. Only worfy’s own duties work until you turn a source on below.» Рядом с переключателем — «On since
  today, 09:12», «On since yesterday», день недели в пределах последней недели, иначе дата («On since 3 Nov»). У
  Assistant-а, включённого до появления этой строки, её нет, пока его не включат снова.

Пока он выключен, ничего из него не работает и ничего не тратится: ни пробуждений, ни проверок источников, ни Session,
ни карточек, ни системных уведомлений. Его раздел по-прежнему показывает, что ждёт, а поле ввода говорит «Assistant is
off on this machine».

**Предложение.** worfy предлагает Assistant-а один раз на Machine, пока предложение в силе: Assistant выключен, ни разу
не знакомился, и пользователь его не включил и не отказался.

- Новый пользователь встречает его на странице «Meet Assistant» в [First run](onboarding.md#first-run), после страницы
  приветствия, с «Turn on and meet» и «Not now». Любой ответ ведёт дальше, к проверкам First run.
- Пользователь, который обновил worfy, получает одно уведомление в углу: «New: Assistant, worfy’s own agent, tells you
  what waits across your Projects and why. It is off until you turn it on.», с «Meet Assistant» и «Not now». «Not now»
  отказывается от предложения навсегда. «Meet Assistant» открывает раздел Assistant-а. Уведомление, закрытое иначе, не
  возвращается.
- Пока предложение в силе, карточка «Meet Assistant» стоит вверху раздела Assistant-а, над списком, с «Turn on and meet»
  и «Not now».

Предложение перечисляет, что Assistant делает (показывает, что ждёт, с причиной; продолжает Session-ы после сброса
Limits; проверяет Slack и Jira в work hours; отвечает на вопросы о worfy) и чего не делает никогда (не пишет код и не
ставит Epic-и в очередь; не публикует вне worfy; не меняет настройки без Apply пользователя; не запускает Session,
которую пользователь не прочитал). Оно говорит, что Assistant тратит Limits Claude пользователя и что его доля видна
внизу его раздела как оценка. Ни цены, ни числа token-ов оно не называет.

**Знакомство.** Когда Assistant-а включают впервые, через предложение или в Settings, он знакомится в своём Chat, на
языке Guide:

1. кто он: собственный агент worfy на этой Machine, над всеми её Project-ами, Project-ы Linked machine он только читает;
   о чём он сообщает, что делает сам и что отвечает на вопросы о worfy по его страницам описаний;
2. какие из Slack и Jira он видит подключёнными в claude.ai, а для остальных — где их подключить (claude.ai → Settings →
   Connectors). Он читает их только через эти connectors и никогда не просит token. Если connectors прочитать не
   удалось, он так и говорит;
3. вопрос о work hours.

За последним сообщением идёт карточка «было → станет» «Set up Assistant»: work hours с понедельника по пятницу,
09:00–18:00 в часовом поясе этой Machine (если пользователь их ещё не выбрал), и включённая проверка каждого источника,
подключённого в claude.ai. Ничего не меняется до Apply. Знакомство пишет сам worfy, без модели, поэтому оно не тратит
token-ов. Assistant, который был включён до появления знакомства, не знакомится. Если worfy закрылся после включения и
до того, как знакомство записано, оно приходит при следующем запуске.

### How it works

Переключатель запускает и останавливает Assistant-а целиком: решение о пробуждении, закрытый список действий и проверки
источников. Ядро внимания, которое собирает пункты, работает и при выключенном Assistant-е, так что к включению список
уже готов. Выключение закрывает идущую Session и снимает пробуждения в очереди
([ADR-0114](../../adr/0114-assistant-app-session.md)).

### Implementation

| Что | Где |
|---|---|
| Настройка `assistant` (`on`, `onSince`, `dailyWakeLimit`, `inWindow`, `systemNotices`) | `src/shared/assistant/settings.ts`, хранит `src/main/settings/store.ts` |
| Переключатель: запускает и останавливает Assistant-а | `src/main/assistant/session/switch.ts`, `src/main/assistant/session/app.ts` |
| Предложение и знакомство, их состояние в `assistant/intro.json` | `src/main/assistant/intro/`, слова — в `src/main/assistant/intro/words/` |
| Предложение в окне | `src/renderer/assistant/Offer.tsx`, `src/renderer/assistant/offer-notice.ts`, `src/renderer/shell/FirstRun.tsx` |
| Settings → Assistant | `src/renderer/settings/AssistantSection.tsx`, в main — `src/main/assistant/settings/` |

Основные test-ы: `test/unit/assistant-switch.test.ts`, `test/unit/assistant-intro.test.ts`,
`test/contract/assistant-intro.test.ts`, `test/unit/assistant-offer.test.tsx`, `test/unit/settings-assistant.test.tsx`,
e2e `test/e2e/assistant.spec.ts`.

## Раздел Assistant-а

### Behaviour

**Где он.** Assistant — первый раздел rail, своего цвета, над чертой ([App shell](app-shell.md#sidebar)). Окно, где
раздел ни разу не выбирали, открывается на Projects, а не здесь. Заголовок раздела говорит «This machine» или «Off on
this machine». Под ним — строка состояния: «Watching 3 Projects» или «Assistant is off on this machine», и «Work hours»
или «Outside work hours». Дальше четыре вкладки, **Waits**, **Summary**, **Journal** и **Chat**, строка расхода и поле,
чтобы написать Assistant-у. Тексты раздела — на английском; сам Assistant говорит на языке Guide.

**Waits** несёт число пунктов, которые ждут. Сверху вниз:

- баннер «Summary · since 18:00» с «12 came · 3 done on its own · 4 wait for you», он открывает вкладку Summary;
- **Needs you now** — срочные пункты; **Waiting** — остальные; у каждой группы её число, новые сверху;
- **Proposals**: что Assistant предлагает отдельно от пункта, и карточки «было → станет»;
- **Snoozed** — отложенные пункты, у каждого «Wake now»;
- когда нет ничего: «Nothing waits for you. I’ll tell you when something does.»;
- пункты каждой Linked machine (ниже, «On a Linked machine»);
- «3 hidden by your ratings · Show»: пункты, которые скрывают dislike-и пользователя, у каждого его правило и «Show
  again».

**Пункт** показывает свой текст и время, пометку «Urgent», свой Project, Duty, которая его подняла, и источник с
предметом. Сообщение Slack или Jira помечено «data»: текст извне Assistant читает как данные, а не как указания. Если
Assistant что-то предложил по пункту, пункт показывает почему. Пункт срочный, когда Run Autopilot-а остановился не по
воле пользователя или когда проверка Slack или Jira пометила сообщение срочным. Run, остановленный кнопками Stop, Force
stop, Cancel, пока он ждал Orchestrator, или отброшенный пользователем, не срочный.

Кнопки пункта:

| Кнопка | Что делает |
|---|---|
| **Open** | Ведёт к предмету: Session — к её Node, PR — в вид Pull requests, красная основная ветка — к PR, после merge которого она покраснела, Ticket или Run — на доску Pipeline, сообщение — на его страницу в Slack или Jira, строка Health check — в Health check, всё остальное — к его Project-у |
| **Prepare** | Показывает Session, которую для него написал Assistant (или worfy), до того как что-либо стартует |
| **Snooze** | Прячет его до срока: «In 1 hour», «In 3 hours», «Next work hours» или «Until something changes» — до следующего события на его предмете |
| **Dismiss** | Закрывает его; Duty считает его отклонённым |
| Like, dislike | Ниже |

**Prepare** открывает «Prepare a Session»: Project, «New Session on the Canvas», «Claude Code» и «The exact text the
Session starts with». Текст извне в нём процитирован как данные, с источником и автором. Edit позволяет поправить текст.
Ничего не стартует до «Start Session», и Session получает ровно показанный текст. Session стартует только в Project-е
этой Machine.

**Like и dislike** стоят на каждом пункте, Proposal-е, строке журнала, сообщении и сводке. Like пункта говорит «Noted.
I’ll keep showing items like this from Work stands.» Dislike пункта или строки журнала, которую он вызвал, убирает пункт
и говорит об этом: «Removed “…”. I won’t show items like this from Work stands. New rule in my memory: …», с Undo.
Правило скрывает пункты той же Duty, того же источника и вида в этом Project-е; вкладка Memory в Settings → Assistant
показывает правила, у каждого Delete. Снятая оценка снимает то, что она посчитала. Оценки сообщений, Proposal-ов и
сводок хранятся и ни в одной Duty не считаются.

**Карточка «было → станет»** — Proposal, который меняет настройки Assistant-а: заголовок, почему, и по строке на каждую
настройку — её значение сейчас и после. «Nothing changes until you press Apply.», с «Not now» и «Apply». После Apply
карточка говорит «Applied at 14:20.», с Dismiss и Undo. Undo возвращает каждую настройку к значению до Apply, и карточка
снова показывает Apply; в журнал идёт строка «Undid the settings change» от You. Если настройка карточки изменилась
после Apply, Undo ничего не меняет и называет её: «Changed since Apply, so Undo would overwrite it: Slack interval.
Change it in Settings → Assistant». Карточка, применённая до появления Undo, вместо этого говорит «Change it back in
Settings → Assistant.».

Карточка может назвать work hours, каждую проверку (включена ли, её интервал, спит ли она вне work hours), дневной
предел пробуждений, а у Duty — включена ли она, её порог и режим каждого действия. Она не может включить или выключить
Assistant-а, поменять число, после которого Duty встаёт на паузу, или Project-ы Duty: это дело пользователя, в Settings.
Изменение, которое никогда не применится, например режим, которого у действия быть не может, отказывается, когда
Assistant его предлагает, и ещё раз при Apply.

**Summary** считает последние 16 часов по Project-ам этой Machine — сам worfy, без модели: сколько пунктов пришло,
сколько сделано само, сколько Run-ов остановилось, сколько пунктов ждёт. Ниже: утренняя сводка — текст, который
Assistant написал при утреннем пробуждении; «By Project», строка на Project; «What to take first» — первые три пункта, у
каждого Prepare или Open; и «Was this summary useful?» с like и dislike.

**Journal** показывает, что было сделано, новое сверху: время, кто («worfy · no model», «Assistant» или «You»), что, и
«caused by» с пунктом, который это вызвал. Щелчок по пункту показывает его в Waits, пока он ещё ждёт. Фильтры: «All»,
«Done on its own», «Your actions». Вкладка показывает последние 200 строк; журнал хранит 14 дней.

**Chat** — разговор. Пользователь пишет в любой момент в поле внизу («Ask Assistant, or tell it what to change…»); Enter
отправляет, Shift+Enter переносит строку. Ответ приходит, когда Session Assistant-а заканчивается; до тех пор три точки
показывают, что он пишет. Под каждым сообщением — время, когда оно написано, в 24 h (у ответа — время, когда он
пришёл); у сообщения другого дня перед временем стоит дата, полное время — в tooltip-е. То, что Assistant написал при своих пробуждениях (утреннем, пакетном, срочном), тоже встаёт в
разговор. Пользователь может попросить изменить настройку: Assistant предлагает карточку «было → станет», и она стоит
среди Proposals во вкладке Waits. Пользователь может спросить, как работает worfy: Assistant отвечает по страницам
описаний, которые лежат в сборке worfy, со ссылкой на страницу, может назвать тему Guide (Help ▸ worfy Guide) и говорит,
что не знает, если ни одна страница этого не описывает.

**Строка расхода** внизу: «Today 25.8k tokens», доля Assistant-а в 5-часовом окне и в недельном, и пометка «estimate»
(см. «Пробуждения, дневной предел и расход»).

#### On a Linked machine

Окно, которое показывает Project-ы Linked machine, показывает в этом разделе только «Assistant works with the Projects
of its own machine. Open it there.»

Waits этой Machine показывает для каждой Linked machine группу «On PC · read-only»: что сейчас показывает её собственный
Assistant, у каждого пункта текст, время, пометка Urgent, Project, Duty и источник, и пометка «Read-only». Кнопок у этих
пунктов нет: их ведёт Assistant той Machine. Если Machine ничего не отдала, строка говорит почему: она offline, доступ
выключен или её сборка не открывает это Linked machine. Больше эти пункты нигде не считаются: ни в Needs you now, ни в
сводке, ни в числе вкладки, ни в карточках, ни в системных уведомлениях. Linked machine читает пункты с уровнем доступа
Read only так же, как с Full access, а с Off — нет ([Link](link.md)). Она никогда не получает пункты Project-а только
для этой машины, такого как Demo project, и пункты без Project-а, такие как Limits.

### How it works

**Пункты.** Ядро внимания в main превращает события в Attention item-ы: Session-ы (вопрос, разрешение, ошибка,
молчание), Ticket-ы, которые ждут человека или заблокированы, PR, которые ждут пользователя, журнал Run-ов Autopilot-а,
строки Health check, Limits, CI основной ветки, правила Project-ов и проверки Slack и Jira. Повтор события пункт не
добавляет, а события одного предмета за один день склеиваются в один пункт. «Ничего не произошло» — тоже пункт: Session
закончила ход и молчит 15 минут. Пункт закрывается, когда причина ушла (пользователь ответил в Session, Ticket больше не
ждёт, PR ушёл из групп, которые ждут пользователя). Пункты переживают перезапуск worfy и удаляются через 14 дней после
последнего события. Каждый пункт принадлежит Duty, которая его показывает; пункта, который не показывает ни одна Duty, в
списке нет.

**Вид.** main строит весь вид из ядра, Duty, Proposal-ов, журнала и журнала расхода; окно только рисует его и отправляет
каждый щелчок обратно в main. Пункт считается показанным для своей Duty, только когда окно его действительно показало: в
открытом разделе на вкладке Waits или на карточке-реплике, и только пока Assistant включён. Отложенные пункты, оценки и
разговор (его последние 200 сообщений) — в собственном файле раздела. Ничто здесь не запускает модель и ничего не
отправляет вне worfy. Все каналы `assistant.*` — только для этой Machine, кроме `assistant.waiting`, который читает
Linked machine ([ADR-0066](../../adr/0066-read-only-access-for-a-linked-machine.md)).

### Implementation

| Что | Где |
|---|---|
| Ядро внимания: пункты, склейка, «ничего не произошло», состояния, хранение | `src/main/assistant/core/`, типы — `src/shared/assistant/attention.ts` |
| Вид и каждый щелчок | `src/main/assistant/window/view.ts`, `src/main/assistant/window/app.ts`, файл раздела — `src/main/assistant/window/store.ts` |
| Proposal-ы | `src/main/assistant/proposals/book.ts`, `src/shared/assistant/proposals.ts` |
| Изменение «было → станет», его строки, Apply и Undo | `src/shared/assistant/settings-change.ts`, `src/main/assistant/settings/panel.ts` |
| Что ждёт на Linked machine | `src/main/assistant/window/linked.ts`, `src/shared/assistant/linked.ts` |
| Каналы | `src/shared/ipc/assistant.ts`, `src/main/ipc/assistant.ts` |
| Раздел в окне | `src/renderer/shell/sidebar/AssistantSection.tsx`, `src/renderer/assistant/` |
| Ответы о worfy по страницам описаний | `src/main/assistant/help/feature-pages.ts` |

Основные test-ы: `test/unit/assistant-attention-core.test.ts`, `test/unit/assistant-attention-sources.test.ts`,
`test/unit/assistant-window.test.ts`, `test/unit/assistant-window-app.test.ts`, `test/unit/assistant-panel.test.tsx`,
`test/unit/assistant-linked-waits.test.ts`, `test/contract/assistant-two-machines.test.ts`,
`test/contract/feature-pages-in-build.test.ts`.

## Duty и Action mode

### Behaviour

**Duty** решает, что Assistant показывает и что он может с этим сделать. Встроенные Duty:

| Duty | Её пункты | Порог | Действия, режим по умолчанию |
|---|---|---|---|
| **Work stands** | Session молчит, ждёт или упала; Run Autopilot-а остановился, закончился, отложил Ticket, упал на ошибке или на Limits; заблокированный Ticket; Limits | 15 мин | Open the item (Leave to me); Wake the Orchestrator, Continue the Session, Start Autopilot again (Ask me) |
| **CI of the main branch is red** | Основная ветка репозитория Project-а красная | 30 мин | Prepare a Session that fixes the CI (Ask me); Open the item (Leave to me) |
| **Waits for you** | Вопрос или запрос разрешения Session, Ticket ждёт человека, PR ждёт пользователя, строка Health check | 15 мин | Open the item (Leave to me); Fix checks, Resolve conflicts or Address comments (Ask me) |
| **Morning summary** | Сводка за ночь | — | Write the morning summary (On its own) |
| **Slack**, **Jira** | Сообщения, которые приносят их проверки | — | Open the item (Leave to me) |

Порог — сколько Session должна молчать или ждать ответа, или основная ветка оставаться красной, прежде чем пункт
покажется. Процесс одного Project-а — не Duty кода, а правило в настройках этого Project-а: после того как закончилась
background task, в описании которой есть заданный текст, или пришёл пункт заданного источника, вида или текста, тишина
на том же предмете дольше заданного числа минут поднимает пункт («land закончился, а Orchestrator спит»). Экрана,
который правит эти правила, пока нет.

**Action mode.** У каждого действия Duty ровно один режим:

| Режим | В Settings | Что происходит |
|---|---|---|
| `self` | On its own | worfy делает его сам и пишет строку журнала |
| `pre-approved` | Pre-approved | То же: выбор этого режима и есть «да» пользователя, данное заранее |
| `ask` | Ask me | Само ничего не происходит: пункт ждёт пользователя, и Assistant может предложить шаг |
| `hand-over` | Leave to me | Пункт — дело пользователя; ничего не делается и не предлагается |

Fix checks, Resolve conflicts и Address comments запускают Session, которая работает над PR пользователя ([Pull
requests](pr-inbox.md)). У них только Ask me и Leave to me: запускает их всегда пользователь. У остальных действий все
четыре режима.

**Что делают действия закрытого списка.**

- **Continue the Session.** Пока Assistant включён, Session на Canvas, чей ход отказали Limits, — не Orchestrator и не
  Session, которой владеет Run Autopilot-а, — ждёт их сброса, и в её чате строка «worfy: waiting for the Limits, they
  reset at 06:02». Сообщение пользователя снимает ожидание. При On its own или Pre-approved worfy отправляет Session
  фиксированный текст, когда сброс прошёл («Continue from where you stopped: the Limits refused your previous turn, and
  they have reset.»). Orchestrator вместо этого продолжает Auto-continue ([Orchestrator modes](orchestrator-modes.md)).
- **Wake the Orchestrator.** При On its own или Pre-approved Orchestrator, который idle, у которого нет живой background
  task, которым не владеет Run, продолжения которого не ждёт Auto-continue и чьи Limits позволяют работать, получает
  фиксированный текст worfy: Limits сейчас позволяют работать; проверь остановившиеся Subagent-ы и продолжи каждого
  через SendMessage тому же агенту. Так один Orchestrator будят не больше 6 раз за 24 часа. Если он снова стоит, не
  запустив Subagent и без того, чтобы ему кто-то написал, закрытый список не помог, и пункт сразу будит Assistant-а —
  один раз на пункт.
- **Start Autopilot again** только открывает диалог Start Autopilot; пользователь подтверждает его или отменяет.
- **Prepare a Session that fixes the CI** даёт пункту Prepare с текстом, который написал worfy. Session стартует только
  по Start.

**Settings → Assistant → Duties.** У каждой Duty — её переключатель, её источники, порог («After 15 min»), счётчики
(Shown, Accepted, Dismissed, Ignored, Liked, Disliked) и режим каждого действия; предлагаются только режимы, которые
действию разрешены. У Work stands, CI of the main branch is red и Waits for you есть «Projects»: «All Projects» или
кнопка на каждый Project этой Machine. Duty, суженная до части Project-ов, не показывает пункты других Project-ов и
пункты без Project-а; когда все названные ею Project-ы удалены из worfy, она снова охватывает все Project-ы. Снятая
последняя кнопка Project-а возвращает «All Projects».

**Пауза.** После 5 проигнорированных Proposal-ов или dislike-ов подряд («Pause a duty after»: экран предлагает 3, 5, 10
или 20 подряд) Duty встаёт на паузу, и её пункты не показываются: «Paused at 14:20: its suggestions were ignored too
many times in a row. Its items are not shown.», с Resume. Снимает паузу только пользователь. Proposal проигнорирован,
когда его пункт всё ещё открыт через сутки после первого показа и реакции не было. Like, Open, Start или Dismiss
обрывают серию. Dismiss считается отказом.

**Memory.** Settings → Assistant → Memory показывает правила, которые Assistant записал из dislike-ов: «It follows them;
delete one and its items show again.»

### How it works

Закрытый список — код main без модели. Каждый запрос — собственный проход main, Assistant или пользователь — идёт через
одну дверь, которая проверяет по порядку: действие есть в списке; Duty пункта его показывает и предлагает это действие;
режим позволяет этому просящему его сделать (On its own и Pre-approved — кому угодно, Ask me — только пользователю,
Leave to me — никому); Session жива, idle и Run ею не владеет; Limits не отказывают; предел побудок. Отправляет она
только свой текст и никогда — текст Assistant-а. Каждый вызов, который что-то сделал, и каждый отказ, о котором просил
Assistant или пользователь, — строка журнала с пунктом. Собственный проход main смотрит после каждого изменения пунктов,
Limits, ожиданий и пробуждения Mac, и раз в минуту. Правила режимов проверяются там, где режим выбирают, где читается
файл памяти, где изменение предлагается и применяется и где действие запускается
([ADR-0114](../../adr/0114-assistant-app-session.md), пункт 4).

### Implementation

| Что | Где |
|---|---|
| Duty, их действия, режимы и разрешённые режимы | `src/shared/assistant/duties.ts` |
| Duty в main: что каждая показывает и предлагает, счётчики, пауза, оценки, файл памяти `assistant/memory.json` | `src/main/assistant/duties/` |
| Правила Project-а (`assistantRules` его настроек) | `src/main/assistant/duties/rules.ts`, `src/main/projects/settings.ts` |
| Закрытый список, его тексты, его журнал `assistant/journal.json` | `src/shared/assistant/actions.ts`, `src/main/assistant/actions/` |
| Ожидание сброса Limits у Session на Canvas | `src/main/assistant/actions/limits-waits.ts` |

Основные test-ы: `test/unit/assistant-duties.test.ts`, `test/unit/assistant-closed-list.test.ts`,
`test/unit/assistant-settings-panel.test.ts`, `test/contract/assistant-settings.test.ts`.

## Check источников

### Behaviour

**Check** читает источник по расписанию; что он нашёл, становится пунктами. В Settings → Assistant → General → Checks —
строка на каждый источник: интервал (от 5 минут до суток), «Sleeps outside work hours» или «Keeps checking» и
переключатель. «Each source is off until you turn it on. Slack and Jira are read through your claude.ai connectors.»
Выключенный Assistant не проверяет ничего.

| Check | Интервал по умолчанию | Вне work hours |
|---|---|---|
| Slack | 10 мин | спит |
| Jira | 1 час | спит |
| CI of the main branch | 10 мин | проверяет дальше |

- **Slack**, через connector claude.ai «claude.ai Slack»: сообщения с прошлой проверки, которые касаются пользователя, —
  личное или групповое личное сообщение, упоминание пользователя или его группы, ответ в thread-е, который он начал или
  где писал, сообщение, которое называет его Project. Собственные сообщения пользователя не в счёт. Срочно: просьба на
  сегодня, срок в пределах дня, авария, красный deploy, blocker.
- **Jira**, через connector claude.ai, в имени которого есть «Atlassian» или «Jira»: изменения с прошлой проверки в
  задачах, где пользователь исполнитель, автор или наблюдатель, и комментарии, которые его упоминают. Один пункт — одно
  изменение: новая задача, комментарий, смена статуса, исполнителя, приоритета, срока или другого поля. Изменения самого
  пользователя не сообщаются. Срочно: задача блокирует другие или с наивысшим приоритетом, или изменение просит
  пользователя о чём-то сегодня. Open ведёт к задаче.
- **CI of the main branch** — каждого репозитория каждого Project-а на github.com, читается аккаунтом GitHub, которым
  Project читает свои PR. Работает, только пока включены и её переключатель, и Duty «CI of the main branch is red».
  Ветка красная или зелёная по своему самому новому commit-у с итогом; отменённые run-ы и отметки агентов (`review`,
  `check/*`, `deploy`) не считаются. Когда ветка красная дольше порога Duty, приходит пункт; он закрывается, когда
  проверка читает ветку зелёной.

**Work hours.** В General есть «Work days», «Work hours» с и до, по получасам, и «Time zone» («This Mac's zone» или
любой пояс). По умолчанию — с понедельника по пятницу, 09:00–18:00 в поясе Machine. Хранится до четырёх окон; экран
правит первое, остальные показывает текстом. Окно, у которого конец раньше начала, идёт через полночь и принадлежит дню,
в который началось. «Checks that sleep wait outside work hours. Urgent items still reach you.»

**Время.** Только что включённая проверка идёт сразу или, если она спит, в начале work hours. Каждый запуск сдвинут на
±10 % интервала. Пока Mac спит или worfy закрыт, ничего не идёт; потом один запуск покрывает всё время с прошлого
успеха. Первая проверка Slack или Jira смотрит на сутки назад. Один запуск может длиться 10 минут; запуск, который к
этому времени не закончился, считается упавшим.

**Неудачи.** Проверка Slack или Jira падает, когда connector-а нет или он ждёт входа в claude.ai, вызов отказан или
остался без ответа, ответ вне формы, все его записи не прошли форму или он идёт слишком долго. Следующий запуск снова
покрывает то же время. С первой неудачи строка в Settings говорит об этом — «Slack: 1 failure in a row, next check at
14:20», с «Check now». После 3 неудач подряд проверка ждёт дольше: два своих интервала, потом четыре и так далее, до
суток (Slack: 20 минут, 40, 80…; Jira: 2 часа, 4…). Успех обнуляет счёт, как и выключение и включение проверки или смена
её интервала; перезапуск worfy счёт сохраняет. Check now не запускает проверку, пока Assistant выключен, проверка
выключена (кнопка тогда неактивна) или она уже идёт; toast называет причину. У CI основной ветки backoff-а нет: её
чтение — бесплатный запрос к GitHub, а красную основную ветку нужно увидеть вскоре после того, как сеть вернулась.

### How it works

Своего token-а для Slack и Jira у worfy нет. Каждая проверка — одноразовый вызов Claude Code (Haiku), которому даны
только read tools одного connector-а claude.ai: ни другого сервера, ни Bash, ни tools файлов и сети. Перед вызовом
модели worfy проверяет, что подключён только этот connector и что в контексте только его read tools, не больше 20 000
token-ов; иначе закрывает вызов, не вызывая модель. Какие connectors подключены, worfy читает из списка MCP-серверов
Claude Code, без модели. Ответ структурированный и сверяется с формой; не больше 30 записей за вызов. Текст Slack и Jira
— данные, а не указания. Каждый вызов учитывается в расходе Assistant-а. CI основной ветки — один read-only запрос
GitHub GraphQL на репозиторий, по последним 20 commit-ам.

### Implementation

| Что | Где |
|---|---|
| Планировщик: интервалы, сон, догоняющая проверка, неудачи и backoff, метки в `assistant-check-marks.json` | `src/main/assistant/schedule/` |
| Настройки проверок и work hours | `src/shared/assistant/schedule/settings.ts`, `src/shared/assistant/schedule/work-hours.ts` |
| Проверка через connector, форма её ответа | `src/main/vendors/claude/connector-check.ts`, `src/main/assistant/sources/connector-check.ts`, `src/shared/assistant/source-items.ts` |
| Рецепты Slack и Jira | `src/main/assistant/sources/slack.ts`, `src/main/assistant/sources/jira.ts` |
| CI основной ветки | `src/main/github/main-ci.ts`, `src/main/assistant/duties/main-ci-check.ts`, `src/main/assistant/duties/main-ci.ts` |

Основные test-ы: `test/unit/assistant-check-scheduler.test.ts`, `test/unit/assistant-work-hours.test.ts`,
`test/unit/assistant-source-check.test.ts`, `test/unit/connector-check-options.test.ts`,
`test/unit/assistant-slack-recipe.test.ts`, `test/unit/assistant-jira-recipe.test.ts`,
`test/unit/assistant-main-ci-check.test.ts`.

## Пробуждения, дневной предел и расход

### Behaviour

**Когда Assistant просыпается.**

| Пробуждение | Когда |
|---|---|
| Срочное | Сразу, в любой час: Run Autopilot-а остановился не по воле пользователя, или работа стоит, а закрытый список не помог |
| Пакетное | В work hours: ждущие пункты идут вместе через 15 минут после того, как самый старый из них стал ждать, и не раньше чем через час после прошлого пробуждения. Вне work hours они ждут утра |
| Утреннее | Раз в рабочий день, в первый момент work hours, который видит worfy: в их начале или позже, когда Mac проснулся или worfy запустился. Оно идёт и без ждущих пунктов и забирает пункты ночи |
| Сообщение пользователя | Сразу, в любой час |

Пункт уходит Assistant-у один раз; новое событие в нём снова делает его ждущим. Пункты, которые пользователь видел,
отложил или отклонил, его не будят. Сообщение Slack или Jira с пометкой срочности срочное в списке и в уведомлениях, но
ждёт пакета.

**Проверки перед пробуждением.** Перед каждым пробуждением, кроме сообщения пользователя, worfy спрашивает Limits и
дневной предел. Несрочное ждёт, пока 5-часовое окно использовано больше чем на 80 % или какое-то окно предупреждает;
срочное ждёт, только пока Limits отказывают. Автоматических пробуждений — не больше 20 за местный день («Daily limit of
automatic wakes», от 1 до 200), срочные тоже в счёт; сообщения пользователя не считаются. Задержанное пробуждение идёт
само при сбросе окна или в местную полночь. Пробуждение считается, когда оно пошло, и тогда, когда его Session не
стартовала.

**Settings → Assistant → Usage and limits**, за «Today» или «This week»: token-ы, каждый вызов в счёте; доля каждого
окна Limits с пометкой «estimate» и тем, насколько окно использовано; строки проверок каждого источника, пробуждений и
разговора; за сегодня — каждое пробуждение с его временем, «urgent» или «batched» и token-ами; и дневной предел, «Today:
3 of 20. Your own messages do not count.»

### How it works

**Session.** Каждое пробуждение и каждое сообщение пользователя — новая Session Claude Code, по одной за раз:
пробуждение во время Session ждёт её конца. Она идёт на модели `opus`, не больше 40 ходов и 15 минут, в папке вне всех
Project-ов, без `CLAUDE.md` и без настроек Project-а или пользователя, и не хранит transcript. Её единственные tools —
tools MCP-сервера `worfy-app`: чтение того, что ждёт (Project-ы, пункты, workflow, нити PR, хвост Session, Run-ы
Autopilot-а, Limits), поиск и чтение страниц описаний, Proposal-ы, `action_run` для закрытого списка и Start Autopilot,
и заметки в памяти. Её первое сообщение пишет main: причина, пункты по id, память и сообщение пользователя. Память — это
Duty, как их настроил пользователь, правила из dislike-ов, открытые Proposal-ы, обязательства Assistant-а и ответы
пользователя. Из каждого ответа `worfy-app` убраны секреты. Harness даёт этой Session её собственные правила
(`harness/hooks/rules/assistant.md`; [Skills, agents and hooks](skills-agents-and-hooks.md)). Assistant работает только
на Claude Code, не на Codex.

**Оценка.** worfy видит только, насколько использовано окно Limits, и никогда — долю одного вызова. Он записывает
стоимость каждого вызова Assistant-а и оценивает его долю как использование окна, умноженное на часть Assistant-а в
стоимости всех ходов, которые worfy записал с начала окна. Claude вне worfy не виден, поэтому оценка завышена. Ходы
других Session-ов worfy не записывает, так что, если Assistant сделал в окне хоть один вызов, оценка равна всему
использованию окна: читайте её как верхнюю границу.

### Implementation

| Что | Где |
|---|---|
| Решение о пробуждении, его файл `assistant/wake.json` | `src/main/assistant/wake/` |
| Проверка перед пробуждением | `src/main/assistant/budget/wake-gate.ts`, `src/main/agent/limits-gate.ts` |
| Журнал расхода `assistant/usage.json`, оценка | `src/main/assistant/budget/ledger.ts`, `src/shared/assistant/budget.ts` |
| Session Assistant-а | `src/main/vendors/claude/assistant-session.ts`, `src/main/assistant/session/` |
| MCP-сервер `worfy-app` и его правила | `src/main/mcp/app-server.ts`, `src/shared/assistant/app-tools.ts`, `src/main/mcp/agent-instructions-app.md` |

Основные test-ы: `test/unit/assistant-wake-planner.test.ts`, `test/unit/assistant-wake-loop.test.ts`,
`test/unit/assistant-wake-gate.test.ts`, `test/unit/assistant-usage-ledger.test.ts`,
`test/unit/assistant-session.test.ts`, `test/unit/assistant-session-options.test.ts`,
`test/contract/assistant-session-claude.test.ts`, `test/contract/worfy-app-tools.test.ts`.

## Уведомления

### Behaviour

У Assistant-а свои уведомления, отдельно от toast-ов worfy у правого края и от его обычных системных уведомлений
([Notifications](notifications.md)). Оба вида приходят, только пока Assistant включён.

- **В окне** — карточка-реплика у значка Assistant-а в rail, у левого края, его цвета: пункт с Open, Prepare, Snooze,
  like и dislike и Close, который оставляет пункт в списке. Одна карточка за раз; значок показывает, сколько ещё ждёт
  («+2»), а без карточки — сколько пунктов ждёт. Пока раздел на переднем плане, карточек нет. Settings → Assistant →
  General → Notifications → «In the window»: «Urgent and batched» (по умолчанию), «Urgent only» или «None: the list
  only». Число на значке и список остаются при любом выборе.
- **Системные уведомления**, когда worfy не на переднем плане: только о срочном пункте, только в work hours, с
  заголовком «worfy Assistant» и текстом «<Project>: <пункт>». Щелчок поднимает окно worfy и открывает раздел. Одно
  уведомление на пункт; пункт, увиденный, пока worfy был впереди, позже не приходит, а пришедший вне work hours ждёт их
  начала. Переключатель «System notifications» (по умолчанию включён) их выключает; пункт, пришедший, пока они были
  выключены, после включения не сообщается.

Пункты Linked machine никогда не уведомляют.

### How it works

Системные уведомления main решает по тому же виду, который рисует окно; карточки окно решает по виду, выбору
пользователя и тому, впереди ли раздел. Карточка или список на вкладке Waits — то, что считает пункт показанным для его
Duty.

### Implementation

| Что | Где |
|---|---|
| Карточка-реплика и значок в rail | `src/renderer/assistant/AssistantSpeech.tsx`, `src/renderer/assistant/speech.ts` |
| Системные уведомления | `src/main/assistant/window/notices.ts`, `src/main/assistant/window/reveal.ts` |

Основные test-ы: `test/unit/assistant-speech.test.tsx`, `test/unit/assistant-window-app.test.ts`.

## Чего Assistant никогда не делает

### Behaviour

- Не пишет код и не ставит Epic-и в очередь.
- Ничего не публикует вне worfy. Ответ в PR уходит только по Send пользователя
  ([ADR-0105](../../adr/0105-pr-reply-only-on-the-users-click.md)).
- Не запускает Session, которую пользователь не прочитал: Session с его текстом стартует только по Start под Prepare.
- Сам не меняет настроек: меняет только Apply под карточкой «было → станет», и сам себя он не включает и не выключает.
- Никогда не запускает Fix checks, Resolve conflicts и Address comments.
- Ничего не делает с Linked machine: читает, что там ждёт, а действие, Proposal или Prepare там отказываются.
- Никогда не просит token, пароль или API-ключ.
- Не выполняет указаний из текста извне — комментария PR, Ticket-а, строки Session, сообщения Slack или Jira.

### How it works

Шесть границ держатся в коде, а не только в правилах Assistant-а: его единственные tools — tools `worfy-app` (ни Bash,
ни записи файлов, ни сети); текст извне приходит к нему только блоком данных с источником и автором; сам он делает
только закрытый список, текст которого задаёт main; Session с его текстом стартует только по щелчку пользователя, после
того как пользователь увидел текст; наружу — только Send пользователя; Project-ы Linked machine — только для чтения; и
каждое действие — строка журнала с пунктом и с like и dislike пользователя
([ADR-0114](../../adr/0114-assistant-app-session.md), пункт 5).

### Implementation

Границы живут там же, где части, которые они стерегут: настройки Session — в
`src/main/vendors/claude/assistant-session.ts`, tools и их отказы — в `src/main/mcp/app-server.ts`, закрытый список — в
`src/main/assistant/actions/closed-list.ts`, старт подготовленной Session — в `src/main/assistant/window/view.ts`.

Состояние Assistant-а лежит только в папке данных worfy, никогда в репозитории
([ADR-0005](../../adr/0005-worfy-own-state-inventory.md); [Storage and diagnostics](storage-and-diagnostics.md)):

| Файл | Что в нём |
|---|---|
| `assistant/items.json` | Пункты без Project-а, например Limits |
| `assistant-items.json` в папке данных Project-а | Пункты этого Project-а |
| `assistant/memory.json` | Duty, как их настроил пользователь, их счётчики и пауза, правила из dislike-ов, открытые Proposal-ы, обязательства и ответы пользователя |
| `assistant/journal.json` | Журнал действий, 14 дней |
| `assistant/wake.json` | Что решение о пробуждении уже передало Assistant-у |
| `assistant/usage.json` | Журнал расхода, 8 дней |
| `assistant/window.json` | Отложенные пункты, оценки и разговор раздела |
| `assistant/intro.json` | Предложение и знакомство |
| `assistant/session` | Пустая папка, в которой идут его Session-ы |
| `assistant-check-marks.json` | Последний старт, последний успех и неудачи подряд каждой проверки |
| `assistant-sources` | Пустая папка, в которой идут проверки Slack и Jira |
