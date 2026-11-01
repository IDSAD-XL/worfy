# Flight Recorder

> Перевод [английской версии](../flight-recorder.md), commit `same-pr`.

Flight Recorder показывает на одной оси времени, что происходило за один run Autopilot-а: его Wave-ы, Ticket-ы, Stage-ы,
агентов, CI run-ы, gate run-ы, повторы, ожидания и блокировки, а над ними — на что ушло больше всего времени. Экран
называется **Run history**. Он читает journal run-а и источники, в которых подробности уже лежат, и ничего своего не
хранит. Сам run описан на странице [Autopilot](autopilot.md). Если термины незнакомы, начните с [Concepts](concepts.md).

## Run history

### Behaviour

#### Открытие экрана

Run history занимает всю главную область окна вместо Canvas. Вкладки для него на панели инструментов нет. Он открывается
из четырёх мест:

- **Toast остановки.** Когда run останавливается, по любой причине, toast говорит `Run stopped: <reason> · N done,
  M blocked · <duration>` с кнопкой **Open history**, которая открывает экран на этом run-е. Toast не исчезает сам.
  Project держит toast только своего последнего остановленного run-а: новая остановка закрывает toast предыдущего
  run-а, а run, который закончился раньше того, чей toast показан, toast не получает. Окно показывает toast run-а один
  раз и не показывает вовсе для run-а, который остановился до открытия окна. Run, запущенный кнопкой, командой в чате
  или инструментом агента, получает такой же toast. Операционная система уведомления не получает.
- **History** справа от строки состояния Autopilot на рамке Epic-а, пока run этого Epic-а остановлен: экран на этом
  run-е. Пункт исчезает, когда стартует следующий run.
- **Run history** в меню «⋯» справа от кнопки Autopilot: экран со списком run-ов, ограниченным этим Epic-ом, на его
  самом новом run-е. Пункт есть всегда, в том числе на экране только для чтения. Epic, у которого все Ticket-ы done,
  не рисует кнопку Autopilot, но всё равно имеет «⋯» с этим единственным пунктом, когда у него есть прошлые run-ы.
- **Open Run history** в Command palette: экран на самом новом run-е активного Project-а.

**Esc** возвращает на Canvas, если только его не забирает диалог, меню или текстовое поле. Выбор другого Project-а в
боковой панели тоже возвращает на Canvas.

#### Заголовок

В заголовке есть выбор run-ов Project-а, самые новые первыми, каждый — как местное время его старта и Epic, с `live` у
run-а, который ещё идёт. При открытии из меню Epic-а в списке только run-ы этого Epic-а, а chip говорит
`Epic filter: <epic>`. Затем идут факты выбранного run-а:

- Epic, старт и конец (`now`, пока run идёт) по местному времени и длительность;
- как он остановился: `running`, `stopped: <reason>` или `no stop in the Journal`, когда journal просто обрывается.
  Остановка из-за блокировки или сбоя показана цветом проблемы;
- число Wave и Ticket-ы `done`, `blocked` и `cut-off`. `blocked` и `cut-off` считаются только после остановки run-а:
  пока он идёт, Ticket, который не `done`, в том числе заблокированный, считается `not done yet`. После остановки
  Ticket-ы, не попавшие ни в одну из этих трёх групп, считаются `stopped`;
- `Retries`: попытки агентов, CI run-ов, gate run-ов и скриптов начиная с `#2`;
- режим Run, `Mode Budget-aware`, и прогноз Epic-а рядом с долей недели, которую run занял на деле:
  `Forecast 18–31% · actual 24%`. Что пишет каждая часть, когда она неизвестна, — на странице
  [Run planning](run-planning.md). В journal, записанном до появления прогноза, нет ни того, ни другого;
- `Started by`: `the Autopilot button`, `a command in a chat` или `a Session (autopilot_start)`. Последнее
  стоит у любого run-а, который запустил инструмент `autopilot_start`, чей бы агент Session его ни вызвал. В journal,
  записанном до того, как это стали записывать, такой строки нет.

#### Сводка

Под заголовком три группы говорят, на что ушло время:

- **Longest Stages by self time**: три карточки. Self time (собственное время) — длительность минус время span-ов
  внутри. Клик по карточке выбирает этот Stage на шкале времени и открывает строки над ним.
- **Work inside Stages (summed; parallel)**: время implementer-ов, verifier-ов, других агентов, CI run-ов, gate run-ов и
  скриптов, каждое просуммировано по его span-ам, с их числом. Параллельная работа складывается, поэтому сумма может
  превысить длину run-а.
- **Waits by cause**: итог каждой причины и его доля в run-е. Причина `background tasks` считает только время, когда
  никакая работа run-а не идёт, и говорит `without work`: её итог короче её полос на дорожке Wait.

#### Шкала времени

Над деревом стоят элементы управления: **Fit** (весь run; следует за концом живого run-а), **Zoom out** (вдвое больший
отрезок на экране), **Expand all**, **Collapse** (открытыми остаются только run и его Wave-ы), поле фильтра и
**Problems only**.

Под ними — ось времени с мини-картой всего run-а. Чтобы приблизить, протяните мышью вдоль оси или вдоль мини-карты либо
используйте Ctrl или Cmd с колесом вокруг указателя. Shift с колесом сдвигает отрезок. Простое колесо прокручивает
строки. Самый узкий отрезок — одна минута. Время на оси местное.

Строки, сверху вниз:

1. Дорожка **Waits**: ожидания run-а, по полосе на каждое, названные по причине: `Limits`, `Limits budget`, `Start window`,
   `Background tasks`, `Gate queue` или `Other Machine`. Tooltip полосы `Start window` называет её причину:
   `outside, until <time>` или `wave-too-long, until <time>`, когда следующая Wave не закончилась бы внутри окна.
2. Дорожка **Orchestrator**: turn-ы Orchestrator-а. Turn связан с Ticket-ами, которых он касался, и не вложен в них.
   Отметка `i` стоит за каждый отклонённый диалог и за каждый раз, когда вмешался человек.
3. Дерево: Run → Wave → Ticket → Stage → работа. Работа — это агент (implementer, verifier или другой), CI run, gate run
   или скрипт. Ticket, который прошёл через несколько Wave, — одна строка под Wave, в которой он начался, с одной частью
   на каждую Wave и промежутком между ними.

Сначала открыты run, его Wave-ы и Ticket-ы и дорожка Waits. У строки есть `▸` или `▾`, точка цвета её вида, её имя и её
исход словами, когда он не `ok`. Свёрнутая строка рисует своих детей тонкими полосами под своей полосой. Подпись полосы
стоит целиком внутри полосы или справа от её конца, но никогда поверх другой полосы строки. Когда места нет ни там, ни
там, подпись не рисуется, и её показывает tooltip полосы.

Что показывают полосы:

| На экране | Значение |
|---|---|
| `#2` на полосе и в её строке | Повтор (retry): implementer, отправленный обратно после REJECTED от verifier-а, узкий круг исправления, агент, запущенный снова после ошибки Session, CI run заново. Выбор повтора обводит пунктиром span, который его вызвал. |
| Красный `!` в строке Ticket-а | Блокировка, с её `Blocked reason:` и `Waits:`. Строка заштрихована серым с этого места, пока блокировку не снимут или run не кончится. |
| Зубчатый, угасающий конец | Оборван (cut off): у span-а нет конца ни в одном источнике, поэтому он кончается на последнем событии о нём. |
| Серая штриховка и подпись | Источника подробностей больше нет: `transcript deleted`, `gate logs deleted (10 runs or 8 days)`, `GitHub did not answer` или `branch deleted`. |
| Одна полоса Stage с несколькими именами | Ни один источник не отмечает границ между этими Stage-ами; в заметке span-а стоит `no boundary in sources`. |

Шаг, о котором не говорит ни journal, ни другой источник, не происходил, и полосы у него нет.

Выбор Wait или turn-а Orchestrator-а подсвечивает строки его Ticket-ов.

#### Фильтр и Problems only

Поле фильтра принимает Ticket (`07`, `Ticket 7` или `worfy-pipeline/07`), агента (его имя, например `verify-05`, или
начало его id), PR (`#460`, `PR 460`, `460`) или слово из причины или из причины ожидания (`rejected`, `background`).
Одни цифры совпадают с номером Ticket-а или PR, но никогда с частью sha, id агента или причины.

**Problems only** оставляет сбои (`failed`, `rejected`, `blocked`, `stopped`, `cut-off`), повторы, Ticket-ы с отметкой
блокировки и каждое ожидание. Сам run никогда не считается. Ticket, который run оставил незаконченным, становится
`stopped` только после остановки run-а: пока run идёт, у такого Ticket-а нет исхода, и он не считается проблемой.

Фильтр и Problems only работают вместе. Строки над оставленным span-ом остаются как путь к нему. Под фильтром открыта
каждая строка, а строка, закрытая под ним, открывается снова при следующем фильтре. У каждого run-а свой фильтр.

#### Панель подробностей

Клик по полосе или строке открывает внизу панель с тремя вкладками:

- **Overview**: вид, старт, конец, длительность, self time, исход, попытка (со ссылкой на span, который повтор
  повторяет), причина, путь в дереве, заметка span-а, а для Ticket-а — его блокировки.
- **Links**: PR и commit, transcript, Ticket-ы, вердикт, id агента и id Session — те из них, что есть у span-а. PR и
  commit открываются в системном браузере, на странице репозитория, которую называет remote `origin` Project-а, на
  хосте этого remote. Без такого remote они — простой текст, и их tooltip говорит почему. Transcript открывается там,
  где worfy его уже показывает, только для чтения из файла: transcript агента — в view Subagent-а, transcript
  Orchestrator-а — в Session view. Ticket выбирает свою строку.
- **Source**: откуда взяты старт и конец (journal Autopilot-а, transcript, GitHub, gate log, файл отметок Harness, git)
  и что ограничивает источник, например gate run, на который целиком ответил зелёный кэш и который поэтому не оставляет
  log-а.

#### Живой run

Экран может быть открыт, пока run идёт. Шкала времени следует за ним: она вычисляется заново не чаще раза в 5 секунд,
когда вырос journal или transcript, а GitHub спрашивается не чаще раза в минуту. Линия отмечает текущий момент, span,
который ещё идёт, тянется до неё со словом `running`, а агент, чьего transcript-а ещё нет, говорит
`transcript not found yet`. Когда run на экране останавливается, заголовок и список говорят об этом при следующем
изменении.

Если повторное вычисление не удалось, notice говорит «The timeline stopped following the Run» и называет причину. Шкала
времени на экране остаётся последней вычисленной. Повторное открытие run-а делает новую попытку.

#### GitHub

Для Project-а, чьи Ticket-ы кончаются PR, факты о PR, CI и merge берутся из GitHub с аккаунтом Profile-а. Когда `gh`
падает, над сводкой стоит строка «GitHub did not answer», полосы PR и CI несут ту же подпись, а шкала времени строится
из локальных источников. **Retry** сразу спрашивает GitHub. Project в Silent mode или с `local-green` GitHub не
спрашивает: его вердикты и merge-и берутся из файла отметок и git.

#### Что хранится и сколько

Run history не хранит копий. Run живёт, пока живут его источники:

| Источник | Хранится |
|---|---|
| Journal Autopilot-а | worfy никогда его не чистит, поэтому каркас каждого run-а остаётся: его Wave-ы, ожидания, статусы Ticket-ов и остановка. |
| Transcript-ы | Пока их хранит Claude Code: `cleanupPeriodDays` в его настройках, по умолчанию 30 дней. |
| Gate log-и | Последние 10 run-ов каждого worktree. Более поздний gate run удаляет папку worktree, которого не касались больше 8 дней. |
| GitHub | Не чистится. |

Подробность, чьего источника больше нет, показывается серой штриховкой с подписью этого источника. Строки journal,
которые не являются JSON или имеют неизвестный вид, пропускаются, а сноска их считает.

#### На Linked machine

Окно на Linked machine открывает Run history Project-а этой Machine, пока включено «Linked machines can work with my
Projects». Run-ы читаются на той Machine, где они шли. Открытие и Retry только читают, поэтому доступа только для
чтения достаточно.

### How it works

**Это view, а не хранилище.** Шкала времени вычисляется из источников каждый раз, когда run открывают. worfy не пишет
индекса span-ов и ничего не копирует на потом
([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md),
[ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). Id run-а из journal связывает источники между собой. PR и
commit-ы находятся по ветке Ticket-а и по sha; в них ничего не вписывается.

**Что даёт каждый источник.**

| Источник | Даёт |
|---|---|
| Journal Autopilot-а | Run и его Wave-ы, ожидания Limits, budget, background task-ов и gate queue, статусы Ticket-ов (`ticket-status`), узкий круг исправления, ошибки Session, отклонённые диалоги, действия человека, остановку. |
| Transcript Orchestrator-а | Его turn-ы, вызовы `Agent` и вызовы `SendMessage`, которые возобновляют агента, task-notification-ы. |
| Transcript-ы Subagent-ов | Старт, конец и исход каждого агента. |
| GitHub | Открытие PR и его новые head-ы, CI run-ы и их повторы, комментарии с вердиктами, отметки агентов на head, merge и label cross-machine gate (ожидание `Other Machine`). |
| Gate log-и | Каждый gate run: его время, исход, head, worktree и шаги. |
| Файл отметок и git | Для Ticket-ов без PR: отметки, commit-ы `gate:` у `local-green`, новые head-ы и локальный merge. |

Journal — это каркас. Две его строки существуют ради Run history: `ticket-status`, потому что файл Ticket-а хранит
только его текущий статус, и `gate-queue-finished`, конец turn-а «Process gate queue». Три необязательных поля тоже ему
помогают: `wave-started.session` называет transcript Orchestrator-а, в который ушла Wave, а `run-started.by` и
`run-started.tickets` говорят, кто запустил run и по каким Ticket-ам. Страница [Autopilot](autopilot.md#файл-journal)
перечисляет строки. Harness ничего не пишет в journal, и gate ради него не меняется
([ADR-0092](../../adr/0092-run-history.md)).

**Какой transcript принадлежит Wave.** Его называет `wave-started.session`. В journal без этого поля есть текст Wave, и
берётся Session, чей prompt с этим текстом лежит ближе всего к старту Wave. Journal без того и другого или файл,
которого больше нет, дают подпись `transcript deleted`. Transcript принадлежит Project-у, когда папка, которую называют
его записи, лежит в корне Project-а; имя папки самого transcript-а здесь не решает.

**Какому Ticket-у принадлежит работа.** Ticket агента берётся из его имени (`impl-NN`, `verify-NN`), иначе из его
описания, ветки или пути Ticket-а в его prompt. Агент без названного Ticket-а, работающий в worktree агента какого-то
Ticket-а, получает этот Ticket; любой другой принадлежит run-у. Gate run принадлежит Ticket-у по head его PR, а без
PR — по своему worktree.

**Span-ы.** У span-а есть вид, старт, конец или его отсутствие, исход, причина, попытка, ссылки и источники его старта
и конца. Виды фиксированы: run, wave, ticket, stage, agent, ci, gate, script, wait и orchestrator turn. Ожидание,
повтор и каждый исход, кроме `ok`, несут причину. Span агента — один отрезок активной работы, от вызова `Agent` или
возобновляющего `SendMessage` до его отчёта, а не вся жизнь его Session.

**Stage-ы вычисляются.** Stage не хранится
([ADR-0067](../../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). На каждом событии источника Stage
Ticket-а вычисляется по фактам, известным к этому событию, по тем же правилам, что и доска на странице
[Workflow](workflow.md). Событие — это граница: claim, открытие PR, старт и конец CI, вердикт или отметка, merge,
`done`. Без события границы нет.

**Блокировка — отметка, повтор — span.** Блокировка не span: это отметка в строке Ticket-а, которая длится, пока её не
снимут или run не кончится. Повтор — новый span того же вида со следующим номером попытки, связанный со span-ом,
который его вызвал.

**Self time** — длительность минус объединение интервалов span-ов внутри, а не их сумма, потому что дети идут
параллельно. То, что случилось после конца run-а, например merge вручную на следующий день, частью run-а не является.

**Живая шкала времени.** Пока окно держит открытым живой run, main каждые 5 секунд смотрит, вырос ли journal или
прочитанный им transcript, и вычисляет заново только тогда. Transcript-ы дочитываются с места, где остановилось
прошлое чтение, и разбор каждого файла берёт только новые строки. GitHub хранит свой ответ минуту, как это делают
badge-и PR. Оконченный run читается целиком, один раз на вычисление, и нигде не хранится.

### Implementation

#### Модули

| Путь | Что в нём |
|---|---|
| `src/shared/flight-recorder/facts.ts` | Контракт между reader-ами и моделью: факты run-а, виды span-ов, исходы, причины ожиданий, источники и подписи потерянного источника, а также какой reader заполняет каждое поле. |
| `src/shared/flight-recorder/spans.ts` | `buildTimeline`: span-ы, дерево, Stage-ы, отметки блокировок, повторы, оборванные span-ы. Чистые функции. |
| `src/shared/flight-recorder/summary.ts` | Self time и сводка: самые длинные Stage-ы, работа по подвидам, ожидания по причинам. Чистые функции. |
| `src/shared/flight-recorder/from-journal.ts` | Факты journal Autopilot-а. |
| `src/shared/flight-recorder/from-transcript.ts` | Факты transcript-ов: агенты, попытки, turn-ы Orchestrator-а; для живого run-а transcript читается по частям. |
| `src/shared/flight-recorder/from-github.ts` | Факты GitHub: PR, CI run-ы, вердикты, отметки, merge-и, ожидание `other-machine`. |
| `src/shared/flight-recorder/from-gate.ts` | Факты gate log-а и commit-ов `gate:`. |
| `src/shared/flight-recorder/journal-walk.mjs`, `src/shared/flight-recorder/pr-facts.mjs` | Разбор journal и PR, общий со `scripts/critical-path.mjs`; простые модули с объявлениями типов. |
| `src/main/flight-recorder/service.ts` | Сервис: run-ы Project-а, шкала времени одного run-а из всех reader-ов, живое повторное вычисление и Retry. |
| `src/main/flight-recorder/transcripts.ts` | Находит и читает transcript-ы Orchestrator-а и Subagent-ов run-а. |
| `src/main/flight-recorder/github.ts` | Спрашивает `gh`, не чаще раза в минуту, и страницу репозитория по remote `origin`. |
| `src/main/flight-recorder/gate-logs.ts` | Читает gate log-и в домашней папке Harness. |
| `src/main/flight-recorder/local-verdicts.ts` | Файл отметок и git для Ticket-ов без PR. |
| `src/main/flight-recorder/worktree-path.ts` | Единая форма пути worktree, которую передаёт каждый reader. |
| `src/main/ipc/runs.ts`, `src/shared/ipc/runs.ts` | Каналы IPC `runs` и форма view run-а. |
| `src/renderer/flight-recorder/RunHistoryView.tsx` | Экран: заголовок, notice-ы, сводка, шкала времени, панель; Esc. |
| `src/renderer/flight-recorder/Timeline.tsx` | Элементы управления, ось и мини-карта, масштаб, строки и полосы. |
| `src/renderer/flight-recorder/label-layout.ts` | Куда ставится подпись полосы. Чистые функции. |
| `src/renderer/flight-recorder/filter.ts` | Фильтр, Problems only, что подсвечивает выбор. Чистые функции. |
| `src/renderer/flight-recorder/DetailPanel.tsx` | Панель подробностей, notice GitHub и Retry. |
| `src/renderer/flight-recorder/SummaryStrip.tsx` | Сводка. |
| `src/renderer/flight-recorder/store.ts` | Состояние экрана и строки дерева. |
| `src/renderer/flight-recorder/stop-toast.ts` | Toast остановки. |
| `src/renderer/flight-recorder/open.ts` | `openRunHistory`, который вызывает каждый вход. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | «History» у строки состояния и «Run history» в «⋯». |
| `src/renderer/palette/commands.ts` | «Open Run history». |
| `src/renderer/theme/tokens.css` | Цвета `--span-*` обеих тем. |

#### Поток данных

1. Вход вызывает `openRunHistory`. Окно показывает view `history`, спрашивает `runs.list` о run-ах Project-а и
   `runs.open` о выбранном.
2. Сервис читает journal run-а из папки данных, затем transcript-ы, GitHub (только для Project-ов, чьи Ticket-ы
   кончаются PR), gate log-и, а для Ticket-ов без PR — файл отметок и git. Каждый reader передаёт факты;
   `buildTimeline` делает из них span-ы, а `summarize` — сводку.
3. Пока run живой и окно его держит, сервис вычисляет заново при росте его файлов и шлёт `runs.changed`. `runs.close`
   отпускает run, когда окно показывает другой run или уходит из view.
4. `runs.retry` сразу спрашивает GitHub и отвечает новой шкалой времени.
5. Toast остановки приходит из `autopilot.changed`: остановленное состояние несёт id run-а и его счётчики.

#### Windows

В модели нет ветвлений по платформе. Journal лежит в папке данных в `%APPDATA%`, transcript-ы — в домашней папке Claude
в папке профиля пользователя, а gate log-и — в домашней папке Harness. Пути worktree сравниваются после `realpath`, с
`/` вместо `\` и в нижнем регистре на Windows, поэтому агент и gate run одного worktree совпадают. Время берётся только
изнутри файлов, никогда из времени изменения файла.

#### Test-ы

Эти test-ы не вызывают ни модель, ни GitHub: journal и transcript-ы — fixture-ы в `WORFY_DATA_DIR` и
`WORFY_CLAUDE_HOME`, а `gh` — подмена, которую называет `WORFY_GH`. Общая fixture — анонимизированный ночной run в
`test/fixtures/flight-recorder/night-run/`.

| Test | Что покрывает |
|---|---|
| `test/unit/flight-recorder-spans.test.ts` | Модель span-ов: дерево, Stage-ы, блокировки, повторы, оборванные span-ы, потерянные источники. |
| `test/unit/flight-recorder-summary.test.ts`, `test/unit/flight-recorder-summary-waits.test.ts` | Self time и сводку; ожидание background tasks без работы. |
| `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-transcript.test.ts`, `test/unit/flight-recorder-github.test.ts`, `test/unit/flight-recorder-gate.test.ts` | Факты каждого источника. |
| `test/unit/flight-recorder-sources.test.ts` | Разбор, общий со `scripts/critical-path.mjs`. |
| `test/unit/flight-recorder-view.test.tsx`, `test/unit/flight-recorder-detail.test.tsx` | Экран над ночным run-ом: заголовок, сводку, `#N`, блокировки, панель. |
| `test/unit/flight-recorder-filter.test.ts`, `test/unit/flight-recorder-label-layout.test.ts` | Фильтр и Problems only; место подписей. |
| `test/unit/flight-recorder-stop-toast.test.ts` | Toast остановки: один на run, последний на Project. |
| `test/unit/canvas-actions.test.tsx`, `test/unit/palette-commands.test.tsx` | «History», «Run history» в «⋯», «Open Run history». |
| `test/contract/flight-recorder-service.test.ts` | Сервис над всеми reader-ами, живое повторное вычисление, Retry. |
| `test/contract/flight-recorder-transcripts.test.ts`, `test/contract/flight-recorder-github.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts` | Reader-ы в main. |
| `test/contract/runs-ipc.test.ts` | Каналы `runs`. |
| `test/e2e/flight-recorder.spec.ts`, `test/e2e/flight-recorder-detail.spec.ts` | Собранное приложение: экран, подписи, которые не пересекают ни одной полосы, панель, Retry, Problems only. |
