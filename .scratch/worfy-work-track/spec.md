# worfy-work-track: Work track — лента всей работы Project-а за день, неделю и месяц

Status: принят владельцем 2026-11-06 («со всем согласен»): решения grilling-а 2026-11-05 (Ticket-ы карты 01, 04–06),
прототип Work track, нарезка на Ticket-ы и Wave-ы, «Решено без владельца» и ответы на «Открытые вопросы». Wave 1
этого Epic-а идёт параллельно с Wave 1 [worfy-autopilot-queue](../worfy-autopilot-queue/spec.md), то есть после merge
worfy-retry 05 и 14. Epic принят владельцем 2026-11-07 («принимаю трек»), 13/13 — «Итог»
[Ticket-а 12](issues/12-приёмка-с-владельцем.md#итог).
Source: слово владельца 2026-11-05: «в runs пункт full work track … таймлайн по датам с выбранным периодом (1д, 7д, 2нд,
1 мес) где можно будет отследить всю работу»; карта [worfy-autopilot-queue](../worfy-autopilot-queue/map.md) и её
Ticket-ы [01](../worfy-autopilot-queue/issues/01-destination-и-масштаб.md) (Q4–Q6),
[04](../worfy-autopilot-queue/issues/04-данные-work-track.md) (research: источники за 1–30 дней),
[05](../worfy-autopilot-queue/issues/05-вид-work-track.md) (прототип), [06](../worfy-autopilot-queue/issues/06-объём-и-доступ-work-track.md);
прототип — Card `card-dcf3918a` (раздел «Вид (прототип)»); spec [worfy-flight-recorder](../worfy-flight-recorder/spec.md);
[CONTEXT.md](../../CONTEXT.md), термины Run, Span, Wait, Session, Subagent, Orchestrator, Machine, Linked machine;
ADR [0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md), [0092](../../docs/adr/0092-run-history.md).
Ticket-ы: Epic `worfy-work-track`, 13 Ticket-ов, нумерация с `01` (13 добавлен 2026-11-07). Шапка — `Type:` /
`Status:` / `Blocked by:` / `Source:`, как у worfy-retry. Спутник — spec [worfy-autopilot-queue](../worfy-autopilot-queue/spec.md) той же карты;
код не пересекается, раздаются параллельно; общая только документация (`CONTEXT.md`,
`docs/features/(ru/)flight-recorder.md`): Ticket 11 здесь — после merge autopilot-queue 19.

## Цель

Run history (worfy-flight-recorder) показывает один Run Autopilot-а: его Wave-ы, Ticket-ы, агентов, CI и gate. Работа
вне Run-а там не видна: ручные ходы Orchestrator-а, bridge-Session, другие Session на Canvas, Wave-ы, запущенные
руками, PR и CI вне Run-а. Владелец хочет видеть всю работу Project-а на этой Machine по датам — день, неделю, месяц,
— чтобы понять, куда ушло время и что сделано.

## Что видит владелец

1. Во вкладке Runs (`src/renderer/shell/Toolbar.tsx:63-73`) сверху — переключатель «Run history | Work track».
2. **Work track**: строка управления — Period (Day / Week / Month, по умолчанию Week) и ‹ › для сдвига, Lanes (by Session
   / by Epic), Density (compact / comfortable).
3. **Сводка периода** — одна строка: часы по Epic-ам (полосы, без двойного счёта параллельной работы), всего часов
   работы, PR merged, Autopilot Runs, пробелы «no-data gaps».
4. **Лента**: ось времени; сверху дорожка «Autopilot Runs» (Run и его Wave-ы), под ней дорожки Session: Orchestrator,
   bridge, другие Session, в том числе скрытые и архивные (пометки `hidden`, `archived`), Session на Codex (пометка
   Vendor-а); Subagent-ы свёрнуты под своей Session (▸ разворачивает); своя дорожка «Gate runs»; ромбы PR merged внизу
   дорожки. «by Epic» — те же Span-ы по дорожкам Epic-ов.
5. **Month** — клетки дней, закрашенные по часам работы, с числом merged; щелчок по дню открывает Day.
6. **«no data»** — штриховка там, где источник ничего не хранит; подсказка называет источник и причину («Transcripts
   are deleted after 30 days…», «Gate logs kept 8–13 days…»).
7. **Щелчок по Span-у** — боковая панель: что это, когда, сколько, Epic и Ticket, ссылки, кнопки Open Session, Open Run
   (Run history), Open PR; внизу — источник.
8. Только названия: имя Session, имя и описание Subagent-а, Epic, Ticket, номер PR. Текст ходов в ленту не попадает.
   Только эта Machine; работа Linked machine видна только как её PR и merge в GitHub.

## Решения владельца

Grilling 2026-11-05: раунд 1 — «по остальному все да», раунд 2 — «1-10 согласен», прототип — «прототип глянул,
подходит», вопросы Q1–Q7 к нему — «да». Полные формулировки — в Ticket-ах карты 05 и 06, раздел «Решения владельца
2026-11-05».

| № | Вопрос | Решение | Ticket |
| --- | --- | --- | --- |
| 1 | Имя и место | «Work track»; переключатель «Run history \| Work track» во вкладке Runs | 09 |
| 2 | Что входит | Вся работа Project-а на этой Machine: Run-ы, ходы Orchestrator-а, другие Session (скрытые и архивные тоже), их Subagent-ы, PR / merge / CI, run-ы gate, смены статуса Ticket-ов; Terminal и Terminal AI — нет | 05–08 |
| 3 | Хранилище | Нет (ADR-0092 в силе); пробелы — «данных нет» | 08 |
| 4 | Правки Harness-а | `timings.json` gate — 31 день; `epic-wave` пишет маркер начала и конца каждой Wave | 01, 02 |
| 5 | Срок транскриптов | `cleanupPeriodDays` Claude Code — 35 | 03 |
| 6 | Linked machine | В первой версии нет | — |
| 7 | Приватность | Только названия | 05, 10 |
| 8 | Период | Day / Week / Month, по умолчанию Week; Month — клетки дней, щелчок → Day | 09 |
| 9 | Дорожки | «by Session» по умолчанию, сверху «Autopilot Runs»; Subagent-ы свёрнуты; «by Epic» переключателем; своя «Gate runs» | 04, 09 |
| 10 | Плотность и сводка | compact по умолчанию; сводка — одна строка, часы без двойного счёта | 04, 10 |
| 11 | Щелчок | Боковая панель со ссылками, Open Session / Open Run / Open PR | 10 |

## Вид (прототип)

Прототип принят: Card `card-dcf3918a` на Canvas Project-а worfy,
`~/Library/Application Support/worfy/CanvasForAI-a2cd477b/cards/card-dcf3918a/index.html` (HTML с выдуманными данными
по ответу research 04, обе темы). В репозиторий файл не копируется (`rules.md` держит в `evidence/` только снимки PNG);
снимки вида кладут Ticket-ы 09 и 10. Что в нём:

- Верх: строка вкладок («Canvas», «Runs»), справа «CanvasForAI · this Mac». Под ней — сегменты «Run history | Work
  track», Period «Day | Week | Month» с ‹ › и подписью периода, Lanes «by Session | by Epic», Density «compact |
  comfortable».
- Сводка (62 px): «Hours by Epic» — сетка до трёх столбцов полос с именами и часами; справа KPI: «of work in total»,
  «PRs merged», «Autopilot Runs», «no-data gaps» (подсказка «Parts of the period where a source has no data…»).
- Лента: слева столбец 230 px с именами дорожек (▸ у Session с Subagent-ами, чипы `hidden`, `archived`, `Codex`),
  справа ось с днями (щелчок по дню — Day), линия «now». Run и Wave — полосы со своей рамкой; ходы Session —
  полосы цвета Session; implementer, verifier и прочие Subagent-ы — свои цвета; исход `failed`/`rejected` — полоса снизу
  цветом проблемы; ромб PR (с номером, если хватает места); штриховка «no data · <источник>».
- Month — клетки дней с часами и числом merged, «click a day to zoom».
- Панель справа (300 px): заголовок Span-а, таблица (When, Duration, Epic, Ticket, PR, Outcome), кнопки, строка
  «Source: …».
- Низ — легенда цветов.

## Как работает

### Источники (по ответу research 04)

| Источник | Что даёт | Срок | Чтение за 30 д (Mac владельца) | Ticket |
| --- | --- | --- | --- | --- |
| Журналы Run-ов (`listRuns`, `src/main/autopilot/journal.ts:173-197`) | Run, Wave, `ticket-status`, Wait | без срока | 2 MB, мс | 08 |
| Транскрипты Claude Code (`~/.claude/projects/<dir>`, принадлежность по `cwd`) | ход Session, Subagent, время | `cleanupPeriodDays` (30 → 35) | 4.1 GB, ~12 с; только главные — 0.7 GB, 2 с | 05 |
| Транскрипты Codex (`thread/list`, `src/main/vendors/codex/history.ts`) | ход Session на Codex | без автоудаления | 1.2 MB | 05 |
| GitHub: PR merged, CI run-ы | PR, merge, CI | без срока (логи CI — 90 д) | ~15 GraphQL (~30 очков, ~50 с) + 31–60 REST | 06 |
| gate: `timings.json` (`~/.claude/worfy-harness/gate/state`) | run gate: worktree, head, исход, время | 10 на worktree, 8 д → 31 д (Ticket 01) | 6.4 MB, 0.2 с | 08 |
| Маркер Wave (`runs/<project>/<epic>-wave-<UTC>/decisions.tsv`) | граница Wave, её Ticket-ы — и ручной тоже | без срока | мгновенно | 02, 08 |
| `git log` файлов Ticket-ов (main и remote-ветки) | смена `Status:` с временем | без срока | 0.5 + 0.4 с | 07 |

### Модель (Ticket 04)

Чистый модуль `src/shared/work-track/`: факты источников → Span-ы Work track (вид: `run`, `wave`, `turn`, `subagent`,
`pr`, `ci`, `gate`, `ticket-status`; начало, конец, исход, Session, Epic, Ticket, PR, источник) → дорожки «by Session»
(Autopilot Runs сверху, Session по времени первой работы, Subagent-ы — дети своей Session, Gate runs) и «by Epic»;
сводка: часы — объединение интервалов (`union`), чтобы параллельные Subagent-ы не считались дважды; часы по Epic-ам —
так же внутри Epic-а; merged PR, число Run-ов, пробелы. Пробел — интервал периода, где источник ничего не хранит
(транскрипты старше срока, gate старше срока, Session-файл удалён), с источником и причиной. Epic и Ticket у хода вне
Run-а — эвристика: по worktree Subagent-а (`canonicalWorktree`, `src/main/flight-recorder/worktree-path.ts`), по
маркеру Wave, по имени ветки PR; не определён — «—».

### Чтение (Ticket-ы 05–08)

- **Транскрипты** (05): все файлы Project-а за период по mtime и `cwd`, как `transcripts.ts:7-17` решает принадлежность,
  но без привязки к Wave-ам Run-а; потоковое чтение, только поля времени, типа, имени Subagent-а и его описания (не
  текст); кэш в памяти по (путь, mtime, размер) на время жизни приложения — на диск ничего (ADR-0005, ADR-0092).
  Имя Session — заголовок Node на Canvas, если он есть; иначе «Session <первые 4 знака id>» и имя worktree.
- **GitHub** (06): пакетный reader вместо «три вызова `gh` на ветку» (`src/main/flight-recorder/github.ts:108-116`):
  GraphQL search по PR merged с делением периода на недели (search отдаёт не больше 1000), REST `actions/runs` по дням;
  ответ держится в памяти на интервал, как у Flight Recorder (`GITHUB_READ_INTERVAL_MS`).
- **Статусы Ticket-ов** (07): `git log -p` по `.scratch/*/issues/*.md` на main и remote-ветках за период; время — из
  значения `Status:` с временем, иначе время коммита ветки, иначе коммита main; шесть форм значения — один разбор.
- **Сервис** (08): `work-track.read(projectId, period)` собирает факты всех источников, считает модель, отвечает
  видом; ничего не пишет. Логи gate — новые сроки (31 д для `timings.json`), зеркало констант
  (`src/main/flight-recorder/gate-logs.ts:27-30`).

## Что уже есть (переиспользуем)

- Readers Flight Recorder: транскрипты (`src/main/flight-recorder/transcripts.ts`, разбор —
  `src/shared/flight-recorder/from-transcript.ts`), gate (`gate-logs.ts`, `src/shared/flight-recorder/from-gate.ts`),
  GitHub (`github.ts`, `from-github.ts`), журнал (`from-journal.ts`); сервис — `src/main/flight-recorder/service.ts:1-38`.
- Причина «transcript deleted» (`src/shared/flight-recorder/facts.ts:38`) — та же пометка в ленте.
- Открыть Run в Run history — `openRunHistory` (`src/renderer/flight-recorder/open.ts:12`).
- История Codex — `src/main/vendors/codex/history.ts` (`thread/list`).

## Решено без владельца

Все пункты ниже — подтверждено владельцем 2026-11-06 (приёмка spec-а, «со всем согласен»).

1. **Маркер Wave — строки `decisions.tsv`**, а не новый файл: `epic-wave` заводит папку Wave-ы всегда, первая строка —
   `wave-started` (Ticket-ы), последняя — `wave-finished` (исход). Тот же `bin/decision-log`, без нового скрипта.
2. **Кэш транскриптов в памяти** на время жизни приложения: месяц — ~12 с при первом открытии, дальше — только новые
   файлы. На диск — ничего.
3. **Имя Session без Node** — «Session <id4>» и worktree: заголовок, который Claude Code пишет в транскрипт, —
   текст модели, а решение — «только названия».
4. **Статусы Ticket-ов на Linked machine** не читаются отдельно: видны, когда ветка или merge дошли до GitHub.
5. **Тексты в коде — английские** (ADR-0074), документы — русские.

## ADR

- **Нового ADR нет.** Work track — вид, который считается при открытии из тех же источников; своего хранилища нет, новых
  событий журнала нет: ADR-0092 в силе и не меняется.
- **Сроки Harness-а** (31 день `timings.json`, маркер каждой Wave) — правки Harness-а без нового решения о хранении в
  worfy; пишутся в комментарии `gate-log.mjs` и в `SKILL.md` `epic-wave`. `cleanupPeriodDays` — настройка Claude Code
  владельца, не решение кода.

## Термины

Вносит Ticket 11 (раздел `## Workflow` `CONTEXT.md`, рядом с Run):

- **Run history** — вид одного Run-а Autopilot-а: шкала его Wave-ов, Ticket-ов, агентов, CI и gate, считается при
  открытии из источников. _Avoid_: журнал (как имя вида), trace.
- **Flight Recorder** — часть worfy, которая собирает факты Run-а из журнала, транскриптов, GitHub и логов gate и
  строит Run history; своего хранилища нет. _Avoid_: бортовой самописец, logger.
- **Work track** — лента всей работы Project-а на этой Machine за выбранный период (день, неделя, месяц): Run-ы, ходы
  Session и их Subagent-ы, PR и CI, run-ы gate, смены статуса Ticket-ов; считается при открытии, пробелы источников
  помечены «no data». _Avoid_: full work track, таймлайн работы, activity log.

## Ticket-ы

- **01 — Harness: `timings.json` gate живёт 31 день.** Blocked by: —.
- **02 — Harness: `epic-wave` пишет маркер каждой Wave.** Blocked by: —.
- **03 — Шаг владельца: `cleanupPeriodDays` 35.** Blocked by: —. `Waits: owner`.
- **04 — Модель Work track: Span-ы, дорожки, сводка, пробелы.** Blocked by: —.
- **05 — Транскрипты всех Session Project-а.** Blocked by: 04.
- **06 — GitHub: пакетное чтение PR и CI за период.** Blocked by: 04.
- **07 — Смены статуса Ticket-ов из git.** Blocked by: 04.
- **08 — Сервис Work track и канал `work-track.read`.** Blocked by: 01, 02, 05, 06, 07.
- **09 — Вид Work track: переключатель, период, дорожки, плотность.** Blocked by: 08.
- **10 — Сводка периода и панель Span-а.** Blocked by: 09.
- **11 — Документация.** Blocked by: 09, 10.
- **12 — Приёмка с владельцем.** Blocked by: 01–11, 13.
- **13 — CI run-ы, смены статуса Ticket-ов и пробелы GitHub/git на экране.** Blocked by: 11. Добавлен 2026-11-07:
  найден при написании 11 (PR #1553).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/hooks/gate-log.mjs`, `harness/hooks/tests/gate-log.test.sh` | 1 |
| 02 | `harness/skills/epic-wave/SKILL.md`, `harness/bin/tests/decision-log.test.sh` | 1 |
| 03 | `.scratch/worfy-work-track/issues/03-шаг-владельца-cleanupperioddays-35.md` (владелец) | 1 |
| 04 | `src/shared/work-track/facts.ts`, `src/shared/work-track/lanes.ts`, `src/shared/work-track/summary.ts`, `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-summary.test.ts` | 1 |
| 05 | `src/main/work-track/transcripts.ts`, `test/contract/work-track-transcripts.test.ts`, `test/fixtures/work-track/claude-home/**` | 2 |
| 06 | `src/main/work-track/github.ts`, `test/contract/work-track-github.test.ts`, `test/fixtures/work-track/gh/**` | 2 |
| 07 | `src/main/work-track/ticket-status.ts`, `src/shared/work-track/status-value.ts`, `test/unit/work-track-status-value.test.ts`, `test/contract/work-track-ticket-status.test.ts` | 2 |
| 08 | `src/main/work-track/service.ts`, `src/main/work-track/harness-state.ts`, `src/shared/ipc/work-track.ts`, `src/main/ipc/work-track.ts`, `src/main/flight-recorder/gate-logs.ts`, `test/contract/work-track-service.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts` | 3 |
| 09 | `src/renderer/flight-recorder/RunsView.tsx`, `src/renderer/main.tsx`, `src/renderer/work-track/WorkTrackView.tsx`, `src/renderer/work-track/Lanes.tsx`, `src/renderer/work-track/MonthGrid.tsx`, `src/renderer/work-track/store.ts`, `src/renderer/work-track/work-track.css`, `test/unit/work-track-view.test.tsx`, `test/e2e/work-track.spec.ts` | 4 |
| 10 | `src/renderer/work-track/WorkTrackView.tsx`, `src/renderer/work-track/SummaryRow.tsx`, `src/renderer/work-track/SpanPanel.tsx`, `src/renderer/work-track/work-track.css`, `test/unit/work-track-panel.test.tsx`, `test/e2e/work-track.spec.ts` | 5 |
| 11 | `docs/features/work-track.md`, `docs/features/ru/work-track.md`, `docs/features/flight-recorder.md`, `docs/features/ru/flight-recorder.md`, `CONTEXT.md` | 6 |
| 13 | `src/shared/work-track/lanes.ts`, `src/renderer/work-track/Lanes.tsx`, `src/renderer/work-track/SpanPanel.tsx`, `src/renderer/work-track/work-track.css`, `src/renderer/palette/commands.ts`, `src/renderer/flight-recorder/RunsView.tsx`, `src/renderer/flight-recorder/open.ts`, `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-view.test.tsx`, `test/unit/work-track-panel.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/e2e/work-track.spec.ts`, `docs/features/work-track.md`, `docs/features/ru/work-track.md` | 7 |
| 12 | `.scratch/worfy-work-track/spec.md` | 8 |

- **Wave 1 — 01, 02, 03, 04.** Две правки Harness-а, шаг владельца и чистая модель — без общих файлов. Идёт
  параллельно с Wave 1 worfy-autopilot-queue (07, 12, 13), после merge worfy-retry 05 и 14: общих файлов в «Где в
  коде» нет (решение владельца 2026-11-06).
- **Wave 2 — 05, 06, 07.** Три reader-а над моделью 04, у каждого свои файлы.
- **Wave 3 — 08.** Сервис ждёт reader-ы и новые сроки Harness-а.
- **Wave 4 — 09. Wave 5 — 10** (общий `WorkTrackView.tsx`). **Wave 6 — 11. Wave 7 — 13** (общая с 11 страница
  `docs/features/(ru/)work-track.md`). **Wave 8 — 12**, владелец.

Имена новых файлов — предложение; implementer может назвать иначе, не задевая чужих Ticket-ов своей Wave. С Epic-ом
`worfy-autopilot-queue` код не пересекается (его Ticket 18 правит `RunHistoryView.tsx`, этот Epic — только новый
`RunsView.tsx` вокруг него). Общие файлы — у документации: Ticket 11 и Ticket 19 того Epic-а правят `CONTEXT.md` и
`docs/features/(ru/)flight-recorder.md`; Ticket 11 начинается после merge 19.

## Не в этом Epic-е

- **Работа Linked machine** (ПК) в той же ленте (решение 6): доступ, объём, чей транскрипт читать — отдельный Epic, если
  понадобится.
- **Свой журнал работы** (смена статуса вне Run-а, ручная «Run wave», run-ы gate) — только если Work track с правками
  Harness-а не покажет нужного; это частичная отмена ADR-0092 и новый ADR.
- **Текст ходов и ответов** в ленте (решение 7).
- **Terminal и Terminal AI.**
- **Правило формата `Status: claimed|done <ISO время>`** для всех Ticket-ов (пробел 3 research 04) — не в этом Epic-е
  по решению владельца 2026-11-06; см. «Открытые вопросы», 2.

## Риски

1. **Месяц транскриптов — 4 GB.** Первое открытие Month — ~12 с на Mac владельца, дольше на холодном диске. Ticket 05
   читает потоком, только нужные поля, и показывает ход загрузки; Week (по умолчанию) — ~4 с.
2. **Лимиты GitHub.** search — 30 запросов в минуту и не больше 1000 результатов; деление периода и кэш на интервал.
   Нет сети — лента без PR/CI с пометкой «GitHub did not answer», как во Flight Recorder.
3. **Эвристика Epic-а и Ticket-а вне Run-а ошибается.** Span без уверенной привязки показывает «—», а не угаданное имя.
4. **Граница 30–35 дней.** Пока шаг владельца 03 не сделан, Month упирается в срок удаления: самые старые дни — «no data».

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-work-track/<NN>`, worktree `.claude/worktrees/<NN>`. Конец Ticket-а — `pr-green-ci`: PR, зелёный
  `ci-ok` (Linux, macOS и Windows job-ы), отметка `review`. Глубина ревью — по общему правилу.
- **Сначала падающий test**: показать красный на старом поведении, это пишется в «Итог».
- **Только чтение** чужих данных: test проверяет, что reader-ы ничего не пишут в `~/.claude`, репозиторий Project-а и
  папку Harness-а (ADR-0005). Fixture-ы — во временной папке, `CLAUDE_CONFIG_DIR` и `HARNESS_HOME` — туда же.
- Ticket-ы 01 и 02 правят Harness (`rules-history.md`); их PR ждут Windows (ADR-0056). Test-ы Harness-а — только с
  `HOME` и `HARNESS_HOME` во временном каталоге.
- GitHub в test-ах — stub `gh` (`WORFY_GH`), без сети.
- Скрипты Node, не bash (ADR-0055); всё работает на Windows (ADR-0054). Timeout-ы — через `ms()` (`test/time-scale.ts`).
- Репозиторий публичный: в fixture-ах и снимках нет путей домашней папки, имён машин, id учётных записей.
- Перед локальным `pnpm test:e2e` на Mac — `rules-local-e2e.md`.

## Открытые вопросы — решены владельцем 2026-11-06

Владелец принял все рекомендации при приёмке spec-а 2026-11-06 («со всем согласен»); открытых вопросов нет.

1. **Отдельного периода «2 weeks» нет.** Слово владельца называло 1 д, 7 д, 2 нед, 1 мес; принятый прототип — Day /
   Week / Month, две недели — Week и сдвиг ‹ › (Ticket 09). Добавить сегмент позже — одна строка в Ticket 09.
2. **Время в `Status:` всегда** (`claimed|done <ISO время>`) — правило `bin/ticket` и TICKETS.md — не в этом Epic-е:
   71 % значений уже со временем, остальным хватает времени коммита.
3. **`cleanupPeriodDays` 35 ставит владелец сам** — шаг владельца, Ticket 03: одна строка в `~/.claude/settings.json`;
   worfy не пишет в `~/.claude` (ADR-0005), а Harness не меняет настройки Claude Code владельца без его шага.

## Готово, когда

- [x] Во вкладке Runs — «Run history | Work track»; Work track — Day / Week / Month, by Session / by Epic, compact /
      comfortable, как прототип `card-dcf3918a` (09).
- [x] Лента показывает Run-ы, ходы всех Session Project-а этой Machine (скрытых и архивных тоже), Subagent-ы, PR, CI,
      gate, смены статуса; только названия (05–08).
- [x] Сводка — часы по Epic-ам без двойного счёта, PR merged, Run-ы, пробелы; щелчок по Span-у — панель (10).
- [x] Пробелы источников — «no data» с причиной; Harness хранит `timings.json` 31 день и маркер каждой Wave; срок
      транскриптов — 35 дней (01–03).
- [x] Страница Feature и три термина в `CONTEXT.md` (11). Приёмка владельца (12).

Все пункты закрыты приёмкой 2026-11-07 — «Итог» [Ticket-а 12](issues/12-приёмка-с-владельцем.md#итог).
