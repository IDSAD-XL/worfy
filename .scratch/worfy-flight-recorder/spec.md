# worfy-flight-recorder: история Run на одной шкале

Status: принят владельцем 2026-11-01 («1-4 все верно» — ответы на открытые вопросы, раздел «Решения владельца при приёмке»).
Source: карта [map.md](map.md) и решения 01–09 этой папки (каждый «## Answer» — решение владельца);
[CONTEXT.md](../../CONTEXT.md), термины Run, Span, Wait, Wave, Stage, Pipeline, Autopilot, Session, Subagent,
Machine, Orchestrator; [ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy читает факт, а
не копирует), [ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние — в папке данных),
[ADR-0067](../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md) (Stage вычисляется); прототип —
Card `card-57714d55` «Flight Recorder — прототип шкалы Run» (решение 05).
Ticket-ы: Epic `worfy-flight-recorder`, 17 Ticket-ов, нумерация с `10` (01–09 — Ticket-ы-решения карты в этой же
папке). Шапка — `Type:` / `Status:` / `Blocked by:` / `Source:`, как у worfy-onboarding.

## Цель и что видит пользователь

Утро после ночного Run. Сейчас, чтобы понять, что было, надо прочитать Journal, пять транскриптов и десяток PR.
С Flight Recorder пользователь видит одну шкалу Run: Wave-ы, Ticket-ы, Stage-ы, агентов, CI, gate, повторы,
ожидания и блокировки, и сверху — где ушло больше всего времени (map.md, Destination).

Как это выглядит:

1. На Canvas висит toast «Run stopped: blocked-tickets · 5 done, 1 blocked · 4 h 48 min · Open history». Он не
   исчезает сам. В строке статуса Autopilot над кнопкой — ссылка «History» (решение 06, Q1).
2. «Open history» открывает экран Run history во весь основной viewport окна вместо Canvas (решение 05, п. 5).
3. Сверху — итог: три самых долгих Stage по собственному времени, Wait-ы по причинам, работа внутри Stage
   (решение 03, Q8; решение 05, п. 1).
4. Ниже — дорожки Wait и Orchestrator, дерево Run → Wave → Ticket → Stage → работа и полосы на общей оси времени
   (решение 03, Q1, Q9; решение 05, п. 2).
5. «Problems only» оставляет только неуспехи, повторы, блокировки, обрывы и Wait-ы (решение 05, п. 4). Клик по
   полосе открывает панель деталей: Overview, Links, Source. Из Links — PR, commit, транскрипт агента.
6. Шкала живая: её можно открыть во время Run (решение 07).
7. Run, начатый командой в чате или просьбой словами, — тот же Run, что с кнопки, с тем же toast и историей
   (решение 09, Q1).

## Модель

Модуль `src/shared/flight-recorder/` (чистый, без Node и DOM). Шкала вычисляется при открытии из источников;
своего индекса spans нет (решение 01, Q4).

**Дерево (решение 03, Q1, Q2, Q9).**

- Run → Wave (`wave-started`…`wave-finished`, номер Wave внутри Run) → Ticket → Stage по Pipeline Project-а
  (`workflow.pipeline` Profile-а) → работа: span агента (Session или Subagent), CI run, запуск gate, merge script.
- Ticket, который шёл в нескольких Wave, — одна строка на весь Run: отрезки по Wave и видимый пробел между ними.
- Дорожка Wait — Wait-ы уровня Run. Дорожка Orchestrator — его ходы, связанные с Ticket-ами ссылками, не вложенные.

**Виды span (решение 01, Q8).** Фиксированный набор: `run`, `wave`, `ticket`, `stage`, `agent` (подвид
`implementer`, `verifier`, `other` по имени и типу агента), `ci`, `gate`, `script`, `wait`, `orchestrator-turn`.

**Поля (решение 03, Q6).** Вид; начало; конец или `null` («не закончен»); исход `ok`, `failed`, `rejected`,
`blocked`, `stopped`, `cut-off`; причина (обязательна у Wait, повтора и неуспеха); номер попытки; ссылка на span-причину
повтора; ссылки (run, номер Wave, Ticket, session id или agent id, PR, sha, verdict — какие есть у вида);
источник начала и источник конца.

**Stage (решение 03, Q3; ADR-0067).** Stage не хранится. Граница Stage-span — событие источника: claim
(`ticket-status`), PR открыт, CI начат и кончен, verdict-комментарий или отметка агента, merge, `done`. Нет события —
нет границы: соседние Stage рисуются одним span с именами обоих и пометкой «no boundary in sources».

**Wait, блокировка, повтор (решение 03, Q5; решение 04, Q7).**

- Wait — span с причиной: `limits` (`limits-hit` → `resumed`), `limits-budget` (`budget-stop` → `resumed`),
  `background-tasks` (из событий `background-tasks`), `gate-queue` (`gate-queue` → его новое событие конца),
  `other-machine` (из GitHub: метка cross-machine gate на PR и время отчёта). Ожидание e2e lock в v1 — часть span
  агента. Wait «человек» внутри Run нет: Autopilot отклоняет диалоги, `refused-dialog` и `human-input` — отметки
  на дорожке Orchestrator. «Сон Machine» в v1 не рисуется (приёмка, Q3).
- Блокировка — не span, а отметка на строке Ticket-а: время, `Blocked reason:`, `Waits:`. После неё строка
  штрихуется серым до снятия блокировки или конца Run.
- Повтор — новый span того же вида с номером `#N` и ссылкой на причину: круг доработки после REJECTED (второй span
  того же агента под вторым Implementing), узкий круг (`narrow-round`), перезапуск implementer-а после ошибки
  Session, повторный CI run.

**Span агента (решение 03, Q4).** Один отрезок активной работы: от вызова `Agent` или `SendMessage` на доработку
до отчёта (`task-notification` или результат вызова), а не вся жизнь Session.

**Обрыв (решение 03, Q7).** Span без конца кончается последним событием о нём в любом источнике, исход `cut-off`,
рисуется с обрывом. Пока Run идёт, незаконченный span тянется до «сейчас» и исхода не имеет (решение 07).

**Собственное время и итог (решение 03, Q8).** Собственное время = длительность минус объединение интервалов
вложенных spans (дети идут параллельно, поэтому объединение, а не сумма). Итог: три самых долгих Stage по
собственному времени; Wait-ы по причинам (сумма и доля Run); работа внутри Stage по подвидам (сумма, с пометкой
«summed; parallel»).

**Неполная история (решение 08, Q5–Q7).** Каркас Run (Run, Wave, Wait, статусы Ticket-ов) задаёт Journal. Span,
о котором Journal знает, а подробностей нет, рисуется серым со штриховкой и подписью потерянного источника:
«transcript deleted», «gate logs deleted (10 runs or 8 days)», «GitHub did not answer», «branch deleted». «Шага
не было» — когда молчит и Journal. Без GitHub шкала строится из локальных источников; полосы PR и CI помечены
«GitHub did not answer» с кнопкой «Retry».

## Источники и что меняется в них

Правило (решение 04, Q1): сначала читаем после факта из источника, который уже хранит событие. В Journal
пишем только то, чего не хранит никто.

**Читается после факта, ничего не меняется:**

| Источник | Что даёт | Где |
|---|---|---|
| Journal | Run, Wave, Wait-ы Limits и budget, background tasks, `gate-queue`, `narrow-round`, `session-error`, `refused-dialog`, `human-input`, остановка | `<data dir>/autopilot/<run>.jsonl`, `src/main/autopilot/journal.ts` (`listRuns`, `readRun`) |
| Транскрипт Orchestrator-а | его ходы; вызовы `Agent` с именем `impl-NN`, `SendMessage`, `task-notification` (решение 04, Q2, Q6) | `<Claude home>/projects/<projectDirName(root)>/<session>.jsonl`, `src/shared/transcript/` |
| Транскрипты Subagent-ов | начало, конец, ошибка агента | `<session>/subagents/agent-<id>.jsonl` и `.meta.json`, `src/shared/transcript/subagents.ts` |
| GitHub | PR открыт, CI runs и их повторы, verdict-комментарии, отметки агентов на head, merge, метка cross-machine gate (решение 04, Q3) | `gh`, поля как у `scripts/critical-path.mjs` плюс `labels`; аккаунт Profile-а через `gh()` из `src/main/github/prs.ts` |
| Логи gate | запуски gate: время, `outcome`, `head`, `worktree`, шаги (решение 04, Q5) | `<Harness home>/gate/state/logs/<tag>/<run>/timings.json`, `harness/hooks/gate-log.mjs` |
| Отметки и verdict без PR | Silent mode и `local-green` | файл отметок `src/main/workflow/marks.ts`; commit-ы `gate: VERIFIED` в ветке |

Ключ связи — run id Journal (решение 01, Q5). PR и commit-ы связываются по ветке Ticket-а и sha; в commit-ы и PR
ничего не штампуется. Запуск gate относится к Ticket-у по `head` (sha commit-а PR), а без PR — по `worktree`.

**Новое в Journal — только два события, пишет только worfy main (решение 04, Q4, Q7, Q8):**

- `ticket-status` — `ticket`, `state` (`claimed`, `blocked`, `done`, `open`), `statusAt?` (время строки `Status:`),
  `reason?` (`Blocked reason:`), `waits?` (`Waits:`). Пишет Autopilot из своего подписчика `WorkflowHub`
  (`src/main/workflow/watch.ts`), когда во время Run меняется статус Ticket-а Epic-а Run. Закрывает историю статусов
  (файл Ticket-а хранит только текущий), Silent mode и Ticket-ы без PR.
- `gate-queue-finished` — конец хода «Process gate queue»: пишется в `endGateQueue` (`src/main/autopilot/run.ts`)
  перед `run-stopped`.

Harness в Journal не пишет. Исключение observer-а (`human-input`) остаётся (решение 04, Q8). Gate не меняется
(решение 04, Q5). Новое хранилище не появляется: ADR-0002 говорит «worfy читает факт, а не копирует», собственный
файл Journal в папке данных этому не противоречит (решение 04, Q1).

**Хранение (решение 08, Q6).** Копий ради долгой памяти нет. Journal не чистят (в `src/main/autopilot/` нет
удаления файлов), каркас Run живёт с ним. Подробности угасают с источниками: запуски gate — 10 последних на
worktree, папка удалённого worktree — через 8 дней (`gate-log.mjs`, `LOG_RUNS_KEPT`, `STALE_MS`); транскрипты —
по `cleanupPeriodDays` Claude Code (30 дней по умолчанию); GitHub не угасает. Экран показывает, что угасло.

## Запуск Autopilot из чата

Решение 09: «из чата» — команда `/worfy:epic-wave …` и просьба словами («запусти на автопилоте», «работай
автономно», «работай автоматически»). Оба пути запускают тот же `Autopilot.start`, что кнопка
(`AutopilotAction.tsx` → `autopilot.start` → `src/main/autopilot/run.ts`): тот же Run, Journal, строка статуса и всё
поведение (Q1).

**Run по названным Ticket-ам (Q4).** `Autopilot.start(projectId, epic, { tickets })`. Cycle
(`src/shared/autopilot/cycle.ts`) берёт в Wave только готовые Ticket-ы из списка. Когда все названные `done`, Run
останавливается с новой причиной `tickets-done` — обычный конец. Заблокированный названный Ticket останавливает Run
как сейчас (`blocked-tickets`). Без списка — весь Epic, как кнопка.

**Команда в чате (Q3).** Перехват — в обработчике `agent.send` (`src/main/ipc/agent.ts`): через него идут только
сообщения, набранные человеком в чате Session внутри worfy (`SessionView.tsx`, `SessionNode.tsx`). Свои Wave
Autopilot шлёт через `session.send` и в перехват не попадает. Разбор — `src/shared/autopilot/chat-command.ts`:

- `/worfy:epic-wave tickets 05, 06 of epic X` (и старая форма «Ticket-ы 05, 06 эпика X») — названные Ticket-ы;
- `/worfy:epic-wave wave N of epic X` (и «волна N эпика X») — Ticket-ы строки N таблицы «Волны» в `spec.md`
  Epic-а, ещё не `done`; разбор таблицы — новый `src/shared/workflow/wave-plan.ts`;
- `/worfy:epic-wave X` или `/worfy:epic-wave epic X` — весь Epic.

Распознанная команда агенту не уходит; worfy запускает Autopilot без подтверждения (пользователь набрал её сам).
Нераспознанный текст после `/worfy:epic-wave` (например, «resume after a session break») уходит агенту как раньше.

**Инструмент `autopilot_start(epic, tickets?)` (Q2, Q6; приёмка, Q2 и Q4).** Новый инструмент сервера `worfy-canvas`: форма и описание — в
`src/shared/canvas/tools.ts`, вызов — в `src/main/mcp/canvas-server.ts`, когда звать — в
`src/main/mcp/agent-instructions.md`. worfy показывает диалог подтверждения, как `session.ask` у Card
(`confirmCardMessage`, `src/main/ipc/card-api.ts`): Epic, Project, названные Ticket-ы, если есть, «Start Autopilot» / «Cancel». Диалог — в окне worfy на Machine
Project-а; ждёт до 10 минут, без ответа — отказ «No one confirmed»; из окна Linked machine-а подтвердить нельзя. После «Start» —
ровно то же, что кнопка. Если инструмент вызвал Orchestrator этого Project-а, Run стартует сразу после конца его
хода (Session idle); инструмент отвечает «Autopilot starts after this turn». Unattended Session получает отказ без
диалога.

**Отказ, пока Run идёт (Q5).** Вторая команда и `autopilot_start` получают отказ с подсказкой «Autopilot is already
running Epic X. Stop it first.», как сейчас «Run wave» (`AUTOPILOT_RUNNING_HINT`, `src/main/actions/launch.ts`).
Отказ ничего не пишет в Journal: до Run он не дошёл.

**Вне Run (Q7).** «Run wave» с Canvas и из Command palette, Wave из Claude в терминале вне worfy — без Run.

Общая точка входа — `src/main/autopilot/chat-start.ts` (`startFromChat`: проверка Epic-а и Ticket-ов, отказ при
живом Run, вызов `Autopilot.start`, ожидание конца хода). Её делает Ticket 21, Ticket-ы 22 и 23 только зовут.

## Экран

**Место (решение 05, п. 5).** Новый вид `history` основного viewport рядом с `canvas`, `session`, `pipeline`
(`ShellView`, `src/renderer/shell/Toolbar.tsx`; `AppShell.tsx`). Код — `src/renderer/flight-recorder/`.

**Вид по прототипу (решение 05).** Сверху вниз:

1. Шапка: выбор Run (новые сверху, только этого Project-а; с фильтром по Epic, если открыт из меню Epic-а —
   решение 06, Q2), Epic, начало → конец, длительность, причина остановки, Wave-ы, Ticket-ы `done` / `blocked` /
   `cut-off`, повторы, кто начал Run (`run-started.by`). Время местное.
2. Итог: карточки трёх самых долгих Stage (клик выбирает span), «Work inside Stages», «Waits by cause».
3. Над деревом: фильтр (Ticket, агент, PR, причина), «Problems only», «Fit», «Zoom out», «Expand all», «Collapse».
4. Ось времени с мини-картой всего Run. Zoom: протянуть по оси или по мини-карте, Ctrl/Cmd + колесо, Shift + колесо —
   сдвиг; «Fit» — весь Run.
5. Дорожки Wait и Orchestrator, затем дерево слева (отступы, ▸/▾, цвет вида, исход словом) и полосы справа.
   Свёрнутая строка показывает детей тонкими полосами внутри своей.
6. Повтор — значок `#N` на полосе и в строке; выбор повтора обводит пунктиром span-причину. Выбор Wait или хода
   Orchestrator-а подсвечивает связанные строки Ticket-ов.
7. Блокировка — красная отметка «!» с причиной и `Waits:`, строка дальше штрихуется серым.
8. Обрыв — зубчатый угасающий конец полосы; потерянный источник — серая штриховка и подпись (решение 08).
9. Панель деталей внизу, вкладки Overview (вид, начало, конец, длительность, собственное время, исход, попытка,
   причина, путь), Links (PR и commit открываются в браузере, транскрипт — там, где worfy его уже показывает:
   Session view или вид Subagent-а), Source (источник начала и конца).

**Подписи (решение 05, п. 6).** Подпись не пересекает полосы: она стоит целиком внутри полосы с отступом или справа
от её конца на фоне строки, а если места нет — не рисуется (остаётся в tooltip). Правило — чистая функция
раскладки с unit test, e2e проверяет, что прямоугольник подписи не пересекает чужие полосы строки.

**Цвета.** Значения прототипа переезжают в токены `--span-*` в `src/renderer/theme/tokens.css` для обеих тем.
Исход всегда пишется словом, не только цветом. Раздел «Run history» в `docs/design/F-SPEC.md` — исключение из
«Kind colours», как у Guide: контраст текста 4.5:1, различимость при дальтонизме (как `kind-tokens.test.ts`).

**Живая шкала (решение 07).** Main пересчитывает шкалу на новое событие Journal или транскрипта, не чаще раза в
5 с; GitHub — не чаще раза в минуту, как PrTracker. Транскрипты дочитываются с места, где остановились
(`src/main/claude-home/tail.ts`), а не целиком. Экран получает `runs.changed`; линия «now» движется.

**Входы (решение 06).**

- При остановке Run по любой причине — action toast (`showToast`, `src/renderer/toast/toasts.ts`):
  «Run stopped: <reason> · N done, M blocked · <duration>» и кнопка «Open history». Не исчезает, пока не закроют;
  один на Run (`key` — run id). Одинаково для Run с кнопки и из чата. Уведомлений ОС нет (Q3).
- Строка статуса Autopilot (`AutopilotAction.tsx`) до следующего Run держит ссылку «History».
- Пункт «Run history» в меню «⋯» Autopilot на рамке Epic (`action-menu.ts`, там же Force stop) — с фильтром по Epic.
- Команда «Open Run history» в Command palette (`src/renderer/palette/commands.ts`).

Для этого `AutopilotState` (`src/shared/ipc/autopilot.ts`) получает `run` (id) и счёт Ticket-ов при остановке.

**Link.** Канал `runs.*` — с областью `project`: окно Linked machine-а читает Run на той Machine, где он шёл
(решение 01, Q7).

## Windows

Разобрано по коду. Отличий в модели нет, есть пути и сравнение путей.

- **Journal.** `%APPDATA%\worfy\autopilot\<run>.jsonl`; без абсолютного `APPDATA` — `<home>\AppData\Roaming`;
  dev-сборка — `worfy-dev` (`dataRoot`, `src/main/storage/paths.ts`). Run виден в той сборке, которая его вела.
- **Транскрипты.** `%USERPROFILE%\.claude\projects\<projectDirName(root)>\` (`claudeHome`;
  `src/main/claude-home/registry.ts`, `projectDirName`: `C:\Users\Ann\repo` → `C--Users-Ann-repo`). Имя папки — не
  доказательство: Project решает `cwd` внутри транскрипта, как уже делает registry.
- **Логи gate.** `%USERPROFILE%\.claude\worfy-harness\gate\state\logs\<tag>\<run>\timings.json`; `tag` — sha1 пути
  worktree в той форме, какую видел gate (`worktreeTag`, `harness/hooks/gate-paths.mjs`). Читатель не вычисляет
  `tag`, а читает все `timings.json` и сопоставляет по `head`; по `worktree` — только без PR, сравнивая пути без
  учёта регистра и с одним разделителем (буква диска, 8.3-имена вроде `RUNNER~1` на runner-е — через `realpath`).
- **Время.** Только время внутри файлов (`at` Journal с `Z` или смещением, `timestamp` транскрипта, `at` в
  `timings.json`, время GitHub), не время изменения файла.
- **Чтение во время записи.** Journal дописывается `appendFile`; Node открывает файлы на чтение с общим доступом,
  чтение не мешает записи. Транскрипты worfy уже дочитывает на Windows.
- **gh.** Через `gh()` из `prs.ts`: правило `WORFY_GH` для Windows (`windowsOverride`) уже там.
- **Observer.** На ПК Bash Session приложения Claude пишет `%APPDATA%` в приватную папку пакета, поэтому строка
  `human-input` observer-а из Git Bash не попадёт в настоящий Journal. Это не меняется; acceptance это записывает.

Неразрешённого по Windows не осталось; приёмка на ПК (Ticket 25) проверяет пути на живом Run.

## Решено без владельца

- Общий разбор (решение 01, Q9) — модули на чистом ESM JavaScript с объявлениями `.d.mts`:
  `src/shared/flight-recorder/journal-walk.mjs` и `pr-facts.mjs`. Скрипт запускается без сборки и не может
  импортировать TypeScript (`scripts/critical-path.mjs:29-30`), а импорты `src/` идут без расширений. Ticket 10
  проверяет typecheck, сборку и сам скрипт.
- Причина остановки названных Ticket-ов — новая `tickets-done` в `AUTOPILOT_STOP_REASONS`.
- Вкладки вида `history` в toolbar нет: входы — решение 06. Вкладки toolbar работают как раньше, Esc возвращает на Canvas.
- Тексты интерфейса — английские (`scripts/check-cyrillic.mjs`): подсказка решения 09, Q5 и подписи решения 08
  переведены, смысл тот же.
- Новые ADR: Ticket 21 — запуск Autopilot из чата; Ticket 11 — `ticket-status` и шкала, вычисляемая при открытии.
  Номер — следующий свободный на момент claim.

## Ticket-ы

UI — нужны снимки в обеих темах в `.scratch/worfy-flight-recorder/evidence/<NN>/`. Test-ы — внутри Ticket-ов.
Платформенный PR (ADR-0056, ADR-0071) — вердикт Windows до merge.

- **10 — Общий разбор Journal и PR.** Перенести разбор Journal и PR из `scripts/critical-path.mjs` в общие модули;
  скрипт — тонкая обёртка, отчёт тот же байт в байт на fixture. Blocked by: —. Files:
  `src/shared/flight-recorder/journal-walk.mjs`, `journal-walk.d.mts`, `pr-facts.mjs`, `pr-facts.d.mts`,
  `scripts/critical-path.mjs`, `test/unit/critical-path.test.ts`, `test/unit/flight-recorder-sources.test.ts`. Не UI.
- **11 — Journal: `ticket-status` и `gate-queue-finished`.** Формат в шапке и схема, запись из подписчика
  `WorkflowHub` во время Run и в `endGateQueue`; виды в `journal-walk.mjs`; ADR. Сюда же — три необязательных поля
  (приёмка, Q1): `wave-started.session`, `run-started.tickets`, `run-started.by`. Blocked by: 10. Files: `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`,
  `src/shared/flight-recorder/journal-walk.mjs`, `docs/adr/<NNNN>-run-history.md`,
  `test/unit/autopilot-journal.test.ts`, `test/contract/autopilot-journal.test.ts`, `test/unit/autopilot-run.test.ts`
  (и прогнать все unit и contract test-ы модуля Autopilot — пути в Ticket-е). Не UI.
- **12 — Модель spans.** Виды, поля, исходы, дерево из фактов, повторы `#N`, отметки блокировок, обрыв, потерянный
  источник, собственное время, итог. Blocked by: —. Files: `src/shared/flight-recorder/spans.ts`, `summary.ts`,
  `test/unit/flight-recorder-spans.test.ts`, `test/unit/flight-recorder-summary.test.ts`. Не UI.
- **13 — Факты из Journal.** Run, Wave, Wait-ы, статусы Ticket-ов, остановка, `refused-dialog` и `human-input` как
  отметки; Journal до этого Epic-а (без `ticket-status`) — claim по `wave-started`. Blocked by: 11, 12. Files:
  `src/shared/flight-recorder/from-journal.ts`, `test/unit/flight-recorder-journal.test.ts`. Не UI.
- **14 — Факты из транскриптов.** Ходы Orchestrator-а, spans агентов, доработка `SendMessage` как второй span,
  перезапуск после `session-error`; поиск транскрипта Orchestrator-а для Run; «transcript deleted».
  Blocked by: 12. Files: `src/shared/flight-recorder/from-transcript.ts`, `src/main/flight-recorder/transcripts.ts`,
  `test/unit/flight-recorder-transcript.test.ts`, `test/contract/flight-recorder-transcripts.test.ts`. Не UI.
  Платформенный.
- **15 — Факты из GitHub.** PR, CI runs и повторы, verdict-ы, отметки агентов, merge, Wait `other-machine` по метке;
  чтение раз в минуту, ответ в памяти, «GitHub did not answer». Blocked by: 10, 12. Files:
  `src/shared/flight-recorder/from-github.ts`, `src/main/flight-recorder/github.ts`,
  `test/unit/flight-recorder-github.test.ts`, `test/contract/flight-recorder-github.test.ts`. Не UI.
- **16 — Факты из gate и без PR.** `timings.json` (по `head`, по `worktree` без PR), файл отметок Silent mode,
  commit-ы `gate: VERIFIED`; «gate logs deleted», «branch deleted». Blocked by: 12. Files:
  `src/shared/flight-recorder/from-gate.ts`, `src/main/flight-recorder/gate-logs.ts`,
  `src/main/flight-recorder/local-verdicts.ts`, `test/unit/flight-recorder-gate.test.ts`,
  `test/contract/flight-recorder-gate-logs.test.ts`. Не UI. Платформенный.
- **17 — Сервис и IPC `runs`.** Список Run Project-а, шкала Run, живой пересчёт (5 с, GitHub — 60 с, дочитывание
  транскриптов), `runs.changed`, «Retry» GitHub. Blocked by: 13, 14, 15, 16. Files:
  `src/main/flight-recorder/service.ts`, `src/shared/ipc/runs.ts`, `src/main/ipc/runs.ts` (домен IPC находится сам,
  ADR-0006), `test/contract/runs.test.ts`. Не UI. Платформенный.
- **18 — Экран: шкала.** Вид `history`, шапка и выбор Run, итог, ось и мини-карта, zoom, дорожки Wait и
  Orchestrator, дерево и полосы, `#N`, блокировки, обрыв, штриховка потерянного, подписи без пересечений, токены,
  раздел F-SPEC; `openRunHistory(projectId, run?, epic?)`. Blocked by: 17. Files: `src/renderer/flight-recorder/RunHistoryView.tsx`,
  `Timeline.tsx`, `SummaryStrip.tsx`, `label-layout.ts`, `store.ts`, `open.ts`, `flight-recorder.css`,
  `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/Toolbar.tsx`, `src/renderer/main.tsx`,
  `src/renderer/theme/tokens.css`, `docs/design/F-SPEC.md`, `test/unit/flight-recorder-label-layout.test.ts`,
  `test/unit/flight-recorder-view.test.tsx`, `test/e2e/flight-recorder.spec.ts`, `scripts/e2e-specs.table.json`. UI.
- **19 — Экран: детали и фильтры.** Панель Overview / Links / Source, открытие PR, commit и транскрипта, фильтр,
  «Problems only», подсветка связанных строк, обводка причины повтора, «Retry». Blocked by: 18. Files:
  `src/renderer/flight-recorder/DetailPanel.tsx`, `filter.ts`, `RunHistoryView.tsx`, `Timeline.tsx`,
  `test/unit/flight-recorder-filter.test.ts`, `test/unit/flight-recorder-detail.test.tsx`,
  `test/e2e/flight-recorder-detail.spec.ts`, `scripts/e2e-specs.table.json`. UI.
- **20 — Входы и toast при остановке.** Action toast, «History» в строке статуса, «Run history» в меню «⋯» Epic-а,
  «Open Run history» в Command palette; `run` и счёт Ticket-ов в `AutopilotState`. Blocked by: 18, 21. Files:
  `src/renderer/flight-recorder/stop-toast.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`,
  `src/renderer/canvas/actions/action-menu.ts`, `src/renderer/palette/commands.ts`, `src/shared/ipc/autopilot.ts`, `src/main/autopilot/run.ts`,
  `test/unit/flight-recorder-stop-toast.test.ts`, `test/unit/palette-commands.test.tsx`,
  `test/e2e/autopilot.spec.ts`. UI.
- **21 — Run по названным Ticket-ам и `startFromChat`.** Список Ticket-ов в cycle и `Autopilot.start`,
  `tickets-done`, общая точка входа с отказом при живом Run и стартом после конца хода; ADR. Blocked by: —. Files:
  `src/shared/autopilot/cycle.ts`, `src/main/autopilot/run.ts`, `src/main/autopilot/chat-start.ts`,
  `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `docs/adr/<NNNN>-autopilot-from-chat.md`,
  `test/unit/autopilot-cycle.test.ts`, `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-chat-start.test.ts`
  (и все test-ы модуля Autopilot, как в 11). Не UI.
- **22 — Команда в чате.** Разбор форм команды и таблицы «Волны», перехват в `agent.send`, ответ пользователю
  (toast «Autopilot started on Epic X» или отказ). Blocked by: 21. Files: `src/shared/autopilot/chat-command.ts`,
  `src/shared/workflow/wave-plan.ts`, `src/main/ipc/agent.ts`, `src/shared/ipc/agent.ts`,
  `src/renderer/session/SessionView.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`,
  `test/unit/autopilot-chat-command.test.ts`, `test/unit/wave-plan.test.ts`, `test/contract/agent-send-autopilot.test.ts`,
  `test/e2e/autopilot-chat.spec.ts`, `scripts/e2e-specs.table.json`. UI.
- **23 — Инструмент `autopilot_start`.** Форма, описание, диалог подтверждения, отказ unattended Session,
  инструкция агенту, когда звать. Blocked by: 21. Files: `src/shared/canvas/tools.ts`,
  `src/main/mcp/canvas-server.ts`, `src/main/mcp/agent-instructions.md`, `src/main/autopilot/chat-confirm.ts`,
  `test/unit/canvas-tools.test.ts`, `test/contract/canvas-tools.test.ts`, `test/contract/autopilot-start-tool.test.ts`.
  UI (диалог).
- **24 — Документация.** `docs/features/flight-recorder.md` и `ru/`, правка `autopilot.md` (запуск из чата, Run по
  Ticket-ам, `tickets-done`), `CONTEXT.md` — только если термины разошлись с кодом. Blocked by: 19, 20, 22, 23.
  Files: `docs/features/flight-recorder.md`, `docs/features/ru/flight-recorder.md`, `docs/features/autopilot.md`,
  `docs/features/ru/autopilot.md`, `docs/features/README.md`. Не UI.
- **25 — Приёмка с владельцем.** Ночной Run на Mac Stable: toast, история, живая шкала, «Problems only», команда
  и просьба словами; Run на Windows-ПК: пути Journal, транскриптов и логов gate. Отметить «Готово, когда».
  Blocked by: 10–24, 26. Files: `.scratch/worfy-flight-recorder/spec.md`. UI (снимки владельцу).
- **26 — Wait `background-tasks` без работы.** В итоге Wait `background-tasks` считается только за время, когда не
  идёт ни один span работы Run (background tasks — сами агенты, gate и scripts Orchestrator-а); другие причины —
  целиком. Решил Orchestrator без владельца, подтверждение — утром. Blocked by: 13. Files:
  `src/shared/flight-recorder/summary.ts`, `test/unit/flight-recorder-summary-waits.test.ts`. Не UI.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов нет. Таблица — план. Wave,
которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 10 | `test/fixtures/flight-recorder/night-run/`, `scripts/critical-path.mjs`, `src/shared/flight-recorder/journal-walk.mjs`, `src/shared/flight-recorder/pr-facts.mjs`, `test/unit/critical-path.test.ts`, `test/unit/flight-recorder-sources.test.ts` | 1 |
| 12 | `src/shared/flight-recorder/spans.ts`, `src/shared/flight-recorder/summary.ts`, `test/unit/flight-recorder-spans.test.ts`, `test/unit/flight-recorder-summary.test.ts` | 1 |
| 21 | `src/shared/autopilot/cycle.ts`, `src/main/autopilot/run.ts`, `src/main/autopilot/chat-start.ts`, `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `test/unit/autopilot-cycle.test.ts`, `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-chat-start.test.ts` | 1 |
| 11 | `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`, `src/shared/flight-recorder/journal-walk.mjs`, `test/unit/autopilot-journal.test.ts`, `test/contract/autopilot-journal.test.ts`, `test/unit/autopilot-run.test.ts` | 2 |
| 14 | `src/shared/flight-recorder/from-transcript.ts`, `src/main/flight-recorder/transcripts.ts`, `test/unit/flight-recorder-transcript.test.ts`, `test/contract/flight-recorder-transcripts.test.ts` | 2 |
| 15 | `src/shared/flight-recorder/from-github.ts`, `src/main/flight-recorder/github.ts`, `test/unit/flight-recorder-github.test.ts`, `test/contract/flight-recorder-github.test.ts` | 2 |
| 16 | `src/shared/flight-recorder/from-gate.ts`, `src/main/flight-recorder/gate-logs.ts`, `src/main/flight-recorder/local-verdicts.ts`, `test/unit/flight-recorder-gate.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts` | 2 |
| 22 | `src/shared/autopilot/chat-command.ts`, `src/shared/workflow/wave-plan.ts`, `src/main/ipc/agent.ts`, `src/shared/ipc/agent.ts`, `src/renderer/session/SessionView.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`, `test/e2e/autopilot-chat.spec.ts`, `scripts/e2e-specs.table.json` | 2 |
| 23 | `src/shared/canvas/tools.ts`, `src/main/mcp/canvas-server.ts`, `src/main/mcp/agent-instructions.md`, `src/main/autopilot/chat-confirm.ts`, `test/unit/canvas-tools.test.ts`, `test/contract/canvas-tools.test.ts` | 2 |
| 13 | `src/shared/flight-recorder/from-journal.ts`, `test/unit/flight-recorder-journal.test.ts` | 3 |
| 17 | `src/main/flight-recorder/service.ts`, `src/shared/ipc/runs.ts`, `src/main/ipc/runs.ts`, `test/contract/runs.test.ts` | 4 |
| 18 | `src/renderer/flight-recorder/RunHistoryView.tsx`, `src/renderer/flight-recorder/Timeline.tsx`, `src/renderer/flight-recorder/SummaryStrip.tsx`, `src/renderer/flight-recorder/label-layout.ts`, `src/renderer/flight-recorder/store.ts`, `src/renderer/flight-recorder/open.ts`, `src/renderer/flight-recorder/flight-recorder.css`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/Toolbar.tsx`, `src/renderer/main.tsx`, `src/renderer/theme/tokens.css`, `docs/design/F-SPEC.md`, `test/e2e/flight-recorder.spec.ts`, `scripts/e2e-specs.table.json` | 5 |
| 19 | `src/renderer/flight-recorder/DetailPanel.tsx`, `src/renderer/flight-recorder/filter.ts`, `src/renderer/flight-recorder/RunHistoryView.tsx`, `src/renderer/flight-recorder/Timeline.tsx`, `test/e2e/flight-recorder-detail.spec.ts`, `scripts/e2e-specs.table.json` | 6 |
| 20 | `src/renderer/flight-recorder/stop-toast.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/renderer/canvas/actions/action-menu.ts`, `src/renderer/palette/commands.ts`, `src/shared/ipc/autopilot.ts`, `src/main/autopilot/run.ts`, `test/unit/palette-commands.test.tsx`, `test/e2e/autopilot.spec.ts` | 6 |
| 24 | `docs/features/flight-recorder.md`, `docs/features/ru/flight-recorder.md`, `docs/features/autopilot.md`, `docs/features/ru/autopilot.md`, `docs/features/README.md` | 7 |
| 25 | `.scratch/worfy-flight-recorder/spec.md` | 8 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры. Если у двух Ticket-ов одной Wave общий файл,
Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 10, 12, 21.** Блокеров нет. 10 — разбор для скрипта, 12 — чистая модель, 21 — cycle и старт Autopilot.
- **Wave 2 — 11, 14, 15, 16, 22, 23.** 11 ждёт 10; 14 и 16 — 12; 15 — 10 и 12; 22 и 23 — 21. Общих файлов нет:
  15 только импортирует `pr-facts.mjs`, а 11 правит `journal-walk.mjs`; `run.ts` 11 и 21 правят в разных Wave;
  22 и 23 зовут `chat-start.ts` и его не правят.
- **Wave 3 — 13.** Ждёт 11 и 12.
- **Wave 4 — 17.** Ждёт 13–16.
- **Wave 5 — 18.** Ждёт 17.
- **Wave 6 — 19, 20.** Оба ждут 18 (20 — ещё 21). Общих файлов нет: 19 — панель и фильтры внутри вида; 20 —
  toast, строка статуса, меню, palette и `AutopilotState`; вид он открывает через `open.ts` из 18, не правя его.
- **Wave 7 — 24.** Ждёт 19, 20, 22, 23.
- **Wave 8 — 25.** Владелец.

## Не в этом Epic-е

- Аналитика по многим Run: медианы, сравнение Run-ов (map.md, Out of scope; решение 01, Q8).
- Run для «Run wave» с Canvas и из Command palette и для Wave из Claude в терминале вне worfy (решение 09, Q7).
- Ручная работа Orchestrator-а над Epic без Autopilot (решение 01, Q2).
- Run другой Machine на этой — только через окно Link (решение 01, Q7).
- Токены на span, текстовая выжимка Run для чата, ожидание e2e lock как отдельный Wait (map.md).
- `decisions.tsv` и `wave-brief.txt` Harness — не читаются: общего ключа с Journal нет, решение 04 их не называет.
- Topic Guide «Autopilot» — отчёт об отставании Guide поймает его сам.

## Риски

1. **Поиск транскрипта Orchestrator-а.** Wave может уйти новой SDK Session (`newUnattendedSession`,
   `src/main/autopilot/run.ts:1113-1125`), а Journal её id не хранит. Для новых Run id есть в `wave-started.session` (приёмка, Q1); для старых
   Ticket 14 ищет Session по тексту `wave-started.text` и времени; Journal до throughput 30 текста не имеет — тогда дорожка
   Orchestrator серая.
2. **Gate из cache не оставляет следа.** `timings.json` пишется, только если хоть один script шёл
   (`harness/hooks/gate.mjs:1059`, `if (logs.length)`); запуск целиком из green cache на шкале не виден. Gate не
   меняется (решение 04, Q5) — это видимое ограничение, Source его называет.
3. **Стоимость живого пересчёта.** Транскрипты ночного Run — десятки мегабайт. Только дочитывание с места
   остановки и пересчёт не чаще раза в 5 с; Ticket 17 мерит пересчёт на fixture ночного Run.
4. **Таблица «Волны» разной формы** (`Тикет | Файлы | Волна` у onboarding, `Волна | Ticket-ы` у guide, диапазоны
   «11–19»). `wave-plan.ts` понимает обе формы; иначе отказ «name the Tickets: tickets NN, NN of epic X».
5. **Общий модуль `.mjs` в `src/shared`.** В `src/` нет примера импорта `.mjs` из TypeScript. Ticket 10 сначала
   проверяет typecheck и сборку на пустом модуле.
6. **Платформенные PR:** 14, 16, 17 — пути и файлы. Вердикт Windows до merge.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-flight-recorder/<NN>`, worktree `.claude/worktrees/<NN>`. Глубина ревью — по общему правилу;
  первый PR модели (12) и сервиса (17) — `high`.
- Сначала падающий test. Без токенов: unit, contract и e2e — с `WORFY_AGENT=fake`, Journal и транскрипты — fixture
  через `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME`, `gh` — stand-in `.mjs` через `WORFY_GH`.
- Fixture ночного Run — обезличенный Run `2026-10-17T22-29-32-707Z-58e783` прототипа (Journal, выдержки транскрипта,
  ответы gh, `timings.json`); пути домашней папки заменены. Кладёт его Ticket 10 в
  `test/fixtures/flight-recorder/night-run/`; Ticket-ы 13–17 только читают, недостающее добавляют новыми файлами.
- Новый e2e spec — строка в `scripts/e2e-specs.table.json`.
- Снимки UI — обе темы, в `.scratch/worfy-flight-recorder/evidence/<NN>/`; сравнения по пикселям нет.

## Готово, когда

- [ ] После остановки Run любой причиной — toast с итогом и «Open history»; «History» в строке статуса до
      следующего Run; «Run history» в меню Epic-а и «Open Run history» в Command palette.
- [ ] Экран во весь основной viewport: итог, дорожки Wait и Orchestrator, дерево и полосы, `#N` с обводкой
      причины, блокировки, обрывы, «Problems only», панель Overview / Links / Source, zoom; подписи не пересекают полосы.
- [ ] Шкала живая во время Run: пересчёт не чаще раза в 5 с, GitHub — раз в минуту.
- [ ] Потерянный источник виден подписью; без GitHub шкала строится, «Retry» работает.
- [ ] В Journal нового — только `ticket-status` и `gate-queue-finished` (и три необязательных поля приёмки, Q1);
      Harness в Journal не пишет; gate не изменён.
- [ ] `scripts/critical-path.mjs` — обёртка над общим разбором, его отчёт не изменился.
- [ ] `/worfy:epic-wave …` в чате и `autopilot_start` с подтверждением запускают тот же Run, что кнопка; Run по
      названным Ticket-ам кончается `tickets-done`; при живом Run — отказ с подсказкой.
- [ ] Приёмка владельца на Mac и пути на Windows-ПК (25).

## Решения владельца при приёмке

1. **Поля в существующих событиях Journal.** Решение 01, Q5 говорит «Session id и agent id попадают в Journal при
   раздаче Ticket-а», решение 04, Q2 — «в Journal не пишем»; spec следует 04. Но id Session Orchestrator-а, которой
   ушла Wave, нигде не записан (риск 1). Предлагаю три необязательных поля, без новых видов событий:
   `wave-started.session` (id транскрипта Orchestrator-а), `run-started.tickets` (названные Ticket-ы),
   `run-started.by` (`button`, `command`, `tool`). **Владелец 2026-11-01: да** — иначе дорожка Orchestrator угадывается по
   тексту, а шапка не знает, Run ли это по Ticket-ам и кто его начал.
2. **Где подтверждать `autopilot_start`.** Card спрашивает на экране, который спросил (ADR-0053). У вызова
   инструмента экрана нет. **Владелец 2026-11-01:** диалог в окне worfy на Machine Project-а; ждёт до 10 минут, как
   `session.ask`; без ответа — отказ «No one confirmed». Из окна Linked machine-а подтвердить нельзя.
3. **«Сон Machine» как Wait.** Решение 03, Q1 его называет, решение 04 источника не даёт: Journal сна не пишет,
   keep-awake его не допускает. **Владелец 2026-11-01:** в v1 не рисовать; разрыв виден как пауза полос. Если ночью сон
   всё же случится — отдельное событие Journal следующим Epic-ом.
4. **`autopilot_start` с Ticket-ами.** Решение 09, Q2 даёт только `epic`. Просьба «прогони 05 и 06 на автопилоте»
   тогда запустит весь Epic. **Владелец 2026-11-01:** необязательный `tickets`, диалог называет их — как команда с
   названными Ticket-ами.
