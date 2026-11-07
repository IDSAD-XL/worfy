# Work track

> Перевод [английской версии](../work-track.md), commit `same-pr`.

Work track показывает на одной оси времени всю работу Project-а на этой Machine за Day, Week или Month: run-ы
Autopilot-а и их Wave-ы, Wave-ы, отправленные вручную, turn-ы каждой Session и их Subagent-ов, gate run-ы и смёрженные
PR, а над ними — сколько часов ушло на каждый Epic. Это вторая половина вкладки **Runs**, рядом с Run history, которая
подробно показывает один run Autopilot-а ([Flight Recorder](flight-recorder.md)). Как и Run history, Work track
вычисляется из источников при каждом чтении и ничего своего не хранит. Если термины незнакомы, начните с
[Concepts](concepts.md).

## Work track

### Behaviour

#### Открытие view

**Runs** в переключателе видов на панели инструментов открывает вкладку Runs. Над ней стоит переключатель
`Run history | Work track`. Project показывает Run history, пока для него не выбран Work track; после этого, пока
приложение работает, вкладка и **Open Run history** в Command palette показывают для этого Project-а Work track. Выбор
хранится для каждого Project-а отдельно и только в памяти окна. Вход, который называет run или Epic, показывает Run
history, что бы ни было выбрано: toast остановки, **History** у строки состояния Autopilot, **Run history** в меню «⋯»
Epic-а и **Open Run** панели Span ниже.

**Esc** возвращает на Canvas, как и из Run history, если только его не забирает панель Span, другой диалог, меню или
текстовое поле. Выбор другого Project-а в боковой панели тоже возвращает на Canvas.

View читает Work track каждый раз, когда открывается, и каждый раз, когда меняется период. Пока view открыт, он не
следит за работой: переключатель, вкладка или другой период читают его заново.

#### Элементы управления

Одна строка, слева направо:

- переключатель `Run history | Work track`;
- **Period**: `Day`, `Week` или `Month`, по умолчанию Week. Week — это 7 дней, которые кончаются выбранным днём,
  сначала сегодняшним. Month — календарный месяц, с 1-го числа;
- `‹` и `›` со словами периода (`Thu 5 Nov 2026`, `30 Oct – 5 Nov 2026`, `November 2026`): на Day, Week или Month
  раньше или позже. `›` выключена, пока более поздний период не начался (Day — сегодня, Week кончается сегодня,
  Month — текущий), с tooltip "Nothing later: the period ends today";
- **Lanes**: `by Session` (по умолчанию) или `by Epic`;
- **Density**: `compact` (по умолчанию) или `comfortable`. В comfortable полосы выше, имя написано в каждой полосе,
  достаточно широкой для него, кроме полосы run-а, а в ячейках Month написаны часы. Compact пишет только имена Wave-ов.

Main сразу отвечает тем, что дали быстрые источники. Пока transcript-ы и GitHub ещё читаются, строка в этом ряду
говорит `Reading transcripts, GitHub…`, и view дополняется, когда они приходят. Если всё чтение не удалось, notice
говорит "The Work track could not be read: <reason>" с **Retry**.

#### Сводка

Одна строка над дорожками:

- **Hours by Epic**: полоса и часы каждого Epic-а, самые длинные первыми, до шести в трёх колонках. Остальные — `+N`,
  их часы — в tooltip. Работа без Epic-а — `—`, последней. Период без работы говорит "No work in this period".
- **of work in total**: часы работы в периоде, каждый момент — один раз. Работа, сделанная параллельно, считается один
  раз, поэтому два Subagent-а в один и тот же час дают один час. Часы Epic-а считаются так же внутри этого Epic-а,
  поэтому час, общий для двух Epic-ов, есть в обоих, и сумма Epic-ов может быть больше итога.
- **PRs merged**: PR, чей merge приходится на период.
- **Autopilot Runs**: run-ы, которые пересекаются с периодом.
- **no-data gaps**: части периода, где источник ничего не содержит, по одной на источник там, где они пересекаются или
  соприкасаются. Tooltip называет каждый источник и причину.

Работа — это turn-ы Session-ов, Subagent-ы и Wave-ы. Gate run-ы, CI run-ы и PR — это не часы работы.

#### Дорожки

Над дорожками — ось времени, по местному времени: каждые два часа на Day, по кнопке на день на Week, которая открывает
этот Day. Ромб на оси отмечает каждый PR, смёрженный в периоде, во время его merge. На Day, где для этого есть место,
ромбы несут номер PR. Линия отмечает текущий момент.

**by Session**, сверху вниз:

1. **Autopilot Runs**: каждый run — полоса в рамке, а на ней его Wave-ы — тоже полосы в рамке. Wave, отправленная
   вручную, вне какого-либо run-а, тоже здесь.
2. Дорожка на каждую Session, в порядке её первой работы в периоде: её turn-ы. У Session с Subagent-ами есть `▸` и
   число её Subagent-ов, и она рисует их тонкой полоской под своими turn-ами. `▸` разворачивает их: дорожка на каждое
   имя Subagent-а, а у Subagent-а, который запускал Subagent-ов, их дорожки — под его собственной.
3. **Gate runs**: каждый gate run worktree-ов Project-а.

**by Epic**: дорожка на каждый Epic с его часами, самые длинные первыми, `—` последней, с Wave-ами, turn-ами и
Subagent-ами этого Epic-а; затем **Gate runs**. Полос run-ов на дорожках Epic-ов нет. Переключение дорожек не читает
заново.

Имя дорожки несёт её отметки. `hidden` — Session, чей Node скрыт или в архиве на Canvas. `archived` — Session без Node на
Canvas: её Node удалили или его никогда не было. У Session на Codex есть chip `Codex`.

Полосы одной дорожки, которые пересекаются, идут рядом, до четырёх линий; остальные делят последнюю. Цвета различают
turn-ы Session-ов, implementer-ов, verifier-ов, других Subagent-ов, run-ы и Wave-ы, а также gate run-ы; полоса с
исходом `failed` или `rejected` подчёркнута цветом проблемы. Легенда внизу называет их и говорит "All Sessions of this
Machine, hidden and archived too · titles only · times are local". В tooltip полосы — её имя, её старт и конец, как их
даёт источник (не обрезанные по периоду), её длительность, её исход, когда он не `ok`, `going on` для работы, у которой
ещё нет конца, её Epic и Ticket и её PR.

Работа без конца в своём источнике рисуется до текущего момента. Turn или Subagent без конца, чей transcript был
записан за последние 15 минут, ещё идёт; более старый кончается на своей последней записи, как `cut-off`.

#### Month

Month — это ячейки, а не полосы. На оси — кнопка на каждый день с его датой, буквой дня недели и числом PR, смёрженных в
этот день. У каждой дорожки — ячейка на каждый день, закрашенная по её часам работы в этот день: самая загруженная
ячейка Month — полная заливка, считая от 4 до 14 часов. Дорожка Gate runs вместо этого считает свои run-ы, полная
заливка — при 20, а tooltip говорит, сколько из них упало. Comfortable пишет число в каждой ячейке. Клик по дню, на оси
или в ячейке, открывает этот Day.

#### Нет данных

Там, где источник ничего не содержит, заполняемые им дорожки заштрихованы серым, а источник и причина — в
tooltip. Заштрихованный участок шире 110 пикселей несёт ещё подпись `no data · <source>`:

| Источник | Где штриховка | Причина |
|---|---|---|
| Transcript-ы Claude Code | Дорожки Session-ов на Claude Code | Часть периода до границы `cleanupPeriodDays` Claude Code и до самого старого оставшегося transcript-а Project-а: "Claude Code deletes transcripts after N days (cleanupPeriodDays): none is left from this time". |
| История Codex | Дорожки Session-ов на Codex | "Codex history did not answer"; "Codex did not give this thread" для одного thread-а. Thread-ы Codex в архиве не читаются: дорожка "Codex archived threads", заштрихованная на весь период, стоит вместо них, когда у Project-а есть хоть один thread Codex. |
| gate log-и (`timings.json`) | Gate runs | Часть периода до более поздней из двух дат — 31 день назад и самая старая запись gate Project-а: "Gate logs are kept 31 days: the records of older gate runs are deleted". |
| Journal-ы run-ов, маркеры Wave | Autopilot Runs | Источник не удалось прочитать. |
| GitHub | нет дорожки | "GitHub did not answer: <reason>", от части, которую он не прочитал, до конца периода. |
| git log файлов Ticket-ов | нет дорожки | "git did not answer". |

У Session, чей собственный transcript удалён, дорожка остаётся, заштрихованная. Каждый пробел считается в
**no-data gaps** сводки, в том числе те, что ни на какой дорожке. Сбой источника никогда не опустошает view: остальные
всё равно приходят.

#### Панель Span

Клик по полосе или по ромбу PR открывает панель справа:

- имя Span, что это (`Autopilot Run`, `Wave`, `Session turn`, `Subagent · implementer`, `Gate run`, `PR`…) и чьей
  Session;
- **When**, **Duration**, **Epic**, **Ticket**, **PR** и **Outcome**, со временем, как его даёт источник, не обрезанным
  по периоду. Исход PR — `merged`;
- **Open Session**: Session на её Node на Canvas, живая, пока её ведёт worfy; без Node — её transcript только для чтения
  в Session view. Subagent открывает свою Session. Выключена для работы без Session;
- **Open Run**: Run history на run-е, частью которого является Span. Выключена для работы вне run-а, в том числе для
  Wave, отправленной вручную;
- **Open PR**: страница PR в системном браузере, в репозитории, который называет remote `origin` Project-а. Выключена,
  с причиной в tooltip, когда PR неизвестен или remote — не репозиторий на хосте GitHub;
- строка `Source: <source>. Only titles are shown here; the contents of turns never enter Work track.`

**Esc** и `✕` закрывают панель; этот Esc не уводит на Canvas. Другой период или Project тоже её закрывают. Выбранная
полоса не подсвечивается, а панель открывается только указателем.

#### Чего в нём нет

- **Только имена.** Имя Session, имя и описание Subagent-а, Epic, Ticket, номер и заголовок PR, имя CI workflow и gate
  run-а. Текст prompt-ов, ответов и отчётов до view никогда не доходит.
- **Только эта Machine.** Работа Linked machine видна только как её PR, смёрженные на GitHub.
- **Terminal и Terminal AI.** Shell не хранит transcript, а Terminal AI просит Claude Code его не хранить.
- **CI run-ы и смены статуса Ticket-ов** читаются и есть в ответе main, но ни дорожка, ни отметка их не показывает.

#### На Linked machine

Окно на Linked machine открывает Work track Project-а этой Machine, пока включено "Linked machines can work with my
Projects". Он читается на той Machine, где лежит Project, из источников этой Machine. Чтение ничего не меняет, поэтому
доступа только для чтения достаточно.

### How it works

**Это view, а не хранилище.** Work track вычисляется из источников при каждом чтении. worfy не пишет индекса работы и
ничего не копирует на потом ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md),
[ADR-0005](../../adr/0005-worfy-own-state-inventory.md), [ADR-0092](../../adr/0092-run-history.md)). Чтение переживают
только собственные кэши reader-ов в памяти: разбор каждого файла transcript-а, по его пути, времени изменения и
размеру, — на всё время жизни приложения; ответ GitHub — на минуту.

**Источники.**

| Источник | Даёт | Хранится |
|---|---|---|
| Journal-ы Autopilot-а | Run-ы и их Wave-ы. | worfy никогда их не чистит. |
| Маркеры Wave в Harness | Wave-ы, отправленные вручную: первая строка `wave-started` с номерами Ticket-ов, последняя — `wave-finished`. | worfy их не чистит. |
| Transcript-ы Claude Code | Turn-ы каждой Session Project-а и их Subagent-ов. | `cleanupPeriodDays` в настройках Claude Code, по умолчанию 30 дней. Текущий Month уходит назад не больше чем на 31 день, поэтому значение 35 или больше сохраняет его целиком; более ранний Month уходит дальше (октябрь, открытый 7 ноября, начинается 37 дней назад). |
| История Codex | Turn-ы Session-ов на Codex. | Пока Codex хранит thread; thread-ы в архиве в список не попадают. |
| GitHub | Смёрженные PR и CI run-ы. | Не чистится. |
| Gate log-и | Каждый gate run: время, исход, worktree. | Запись run-а (`timings.json`) — 31 день. |
| git log файлов Ticket-ов | Каждая смена `Status:` Ticket-а. | Не чистится. |

**Какая работа принадлежит Project-у.** Transcript принадлежит Project-у, когда первая папка, которую называют его
записи, лежит в корне Project-а, в том числе в worktree под ним; файлы, последний раз записанные до периода, не
открываются. Gate run принадлежит Project-у, когда его worktree лежит в корне. GitHub — это репозиторий remote
`origin`; Project без него GitHub не читает. Маркеры Wave читаются из папки с именем Profile-а Project-а в домашней
папке Harness; у Project-а, чей Profile не читается, их нет.

**Какая Session.** Имя Session — заголовок её Node на Canvas. Без Node это `Session` и первые четыре символа её id, с
последней частью её папки. Заголовок, который Claude Code пишет в transcript, — текст модели, поэтому он не
используется.

**Wave run-а и её маркер — одна Wave**, когда у них один Epic, они пересекаются по времени и у них есть общий Ticket или ни одна
не называет Ticket:
остаётся Wave из journal, вместе со своим run-ом. Маркер без `wave-finished` идёт сутки, затем кончается на своей
последней строке как `stopped`. Run идёт, пока в его journal нет остановки, он самый новый у Project-а и Autopilot
работает над его Epic-ом.

**Какой Epic.** Run, Wave, а также PR или CI run на ветке `<epic>/<NN>` называют свой Epic. Turn или Subagent без
собственного Epic-а берёт Epic того, во что он вложен: Subagent — Wave, в которой он работал, Subagent, запущенный
Subagent-ом, — Epic того Subagent-а. Turn или Subagent той Session, в которую ушла Wave run-а, начатый внутри этой Wave,
вложен в неё. Если Epic-а нет нигде вверх по цепочке, это `—`, никогда не догадка.

**Часы** — это объединение интервалов работы в периоде, а не их сумма, как self time в Run history. День Month
считает ту часть работы, которая попадает в этот день.

**Медленные источники.** При первом чтении Month занимает около 12 секунд на transcript-ы и около 50
секунд на GitHub. Main читает их в фоне: его
первый ответ называет их в `loading`, и view спрашивает снова, ожидая их. GitHub читается по неделе (один поиск
смёрженных PR) и по дню (CI run-ы). Первый неудачный вызов останавливает чтение: остаток периода — пробел, а то, что
прочитано до него, остаётся. Сверх 1000 PR за неделю или 1000 CI run-ов за день остальное не читается.

**Смены статуса Ticket-ов.** Два чтения `git log -p` по `.scratch/*/issues/*.md`: главная ветка от начала периода и
remote-ветки, которых в ней нет, ещё с 14 днями до начала. Смена — это переход строки `Status:` в первых 15 строках
файла в другое состояние. Её время берётся из значения, когда оно там есть, иначе из commit-а.

### Implementation

#### Модули

| Путь | Что в нём |
|---|---|
| `src/shared/work-track/facts.ts` | Контракт между reader-ами и моделью: виды фактов, источники и их имена на экране, Session, пробел, период. |
| `src/shared/work-track/lanes.ts` | Span-ы периода, дорожки `by Session` и `by Epic`, работа вне дорожек. Чистые функции. |
| `src/shared/work-track/summary.ts` | Сводка: часы, часы по Epic-ам, смёрженные PR, run-ы, пробелы, а также часы и merge-и каждого дня. Чистые функции. |
| `src/shared/work-track/status-value.ts` | Разбор значения `Status:`: состояние и его время. Чистые функции. |
| `src/main/work-track/service.ts` | Сервис: каждый источник периода, медленные — в фоне, сводка. Ничего не пишет. |
| `src/main/work-track/transcripts.ts` | Transcript-ы каждой Session Project-а, урезанные до имён при чтении каждой строки, и thread-ы Codex. |
| `src/main/work-track/github.ts` | Смёрженные PR и CI run-ы периода через `gh`. |
| `src/main/work-track/harness-state.ts` | Gate run-ы и маркеры Wave в домашней папке Harness. |
| `src/main/work-track/ticket-status.ts` | Смены статуса Ticket-ов из git. |
| `src/main/ipc/work-track.ts`, `src/shared/ipc/work-track.ts` | Канал `workTrack.read` и форма его ответа. |
| `src/renderer/flight-recorder/RunsView.tsx` | Вкладка Runs: переключатель `Run history \| Work track` и какую половину показывает каждый Project. |
| `src/renderer/work-track/WorkTrackView.tsx` | View: элементы управления, сводка, дорожки, панель, легенда. |
| `src/renderer/work-track/Lanes.tsx` | Ось, имена дорожек и их полосы, пробелы. |
| `src/renderer/work-track/MonthGrid.tsx` | Month: дни и их ячейки. |
| `src/renderer/work-track/SummaryRow.tsx` | Строка сводки. |
| `src/renderer/work-track/SpanPanel.tsx` | Панель Span и её кнопки. |
| `src/renderer/work-track/store.ts` | Состояние view, периоды и чтения. |
| `src/renderer/work-track/work-track.css` | Стили поверх токенов `src/renderer/theme/tokens.css`. |

#### Поток данных

1. View спрашивает `workTrack.read` с Project-ом и периодом.
2. Сервис читает journal-ы, маркеры Wave, gate log-и и git, запускает чтение transcript-ов и GitHub в фоне и отвечает
   фактами, Session-ами, пробелами, сводкой и `loading`.
3. Когда `loading` не пуст, view спрашивает снова с `wait` и показывает ответ, когда пришли все источники.
4. View сам строит дорожки из ответа через `lanesBySession` или `lanesByEpic`: какие Session-ы развёрнуты — это
   состояние view, поэтому переключение дорожек или разворачивание Session ничего не читает.

#### Windows

В модели нет ветвлений по платформе. Пути worktree сравниваются в одной канонической форме
`src/main/flight-recorder/worktree-path.ts`, поэтому gate run worktree внутри Project-а находится на любой системе.
Время работы берётся изнутри файлов и из git. Время изменения файла только выбирает, какие файлы открывать, и говорит,
идёт ли ещё turn без конца.

#### Test-ы

Эти test-ы не вызывают ни модель, ни GitHub: transcript-ы и домашняя папка Harness — fixture-ы во временной папке, а
`gh` — подмена, которую называет `WORFY_GH` (`test/fixtures/work-track/gh/gh-work-track.mjs`).

| Test | Что покрывает |
|---|---|
| `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-summary.test.ts` | Дорожки, Epic вверх по цепочке, пробелы; часы без двойного счёта, merge-и, дни. |
| `test/unit/work-track-status-value.test.ts` | Формы значения `Status:`. |
| `test/contract/work-track-transcripts.test.ts` | Transcript-ы каждой Session, только имена, пробел из-за очистки, Codex. |
| `test/contract/work-track-github.test.ts` | Чтения по неделям и по дням, ответ, хранимый минуту, остановку на первом сбое. |
| `test/contract/work-track-ticket-status.test.ts` | Смены статуса ветки, squash-нутой в главную ветку, и одной главной ветки, их время. |
| `test/contract/work-track-service.test.ts` | Все источники вместе, Wave, отправленную вручную, пробел gate, неответ GitHub и то, что ничего не пишется. |
| `test/unit/work-track-view.test.tsx` | Переключатель вкладки Runs, периоды и `‹ ›`, дорожки, пробелы, Month, медленные источники, Retry. |
| `test/unit/work-track-panel.test.tsx` | Сводку и панель Span с её кнопками и Esc. |
| `test/e2e/work-track.spec.ts` | Собранное приложение: Week, Day, Month, сводку и переход Open Run в Run history. |
