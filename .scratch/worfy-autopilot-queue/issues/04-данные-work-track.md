# 04 — Данные для Work track за 1 д … 1 мес

Type: research
Status: done 2026-11-05
Blocked by: 01
Source: [map.md](../map.md); Ticket 01, Q4–Q5

## Question

Что из источников Flight Recorder (`src/main/flight-recorder/service.ts:1-38`) доступно для ленты всей работы Project-а на этой Machine за 1, 7, 14 и 30 дней — без нового хранилища (ADR-0092)?

Для каждого источника — что даёт (какие Span-ы: Run, Wave, Ticket, Session-ход, Subagent, PR, CI, gate), сколько хранится, сколько стоит прочитать 30 дней (объём файлов, время чтения на этом Mac, число запросов GitHub API и их лимит), что теряется:

- журналы Run-ов (`<data dir>/autopilot/*.jsonl`, `src/main/autopilot/journal.ts:173-197`);
- транскрипты всех Session Project-а и их Subagent-ов (`~/.claude/projects`, `cleanupPeriodDays` 30, `src/main/flight-recorder/transcripts.ts`), транскрипты Session на Codex (`thread/list`, worfy-multi-vendor 05);
- GitHub: PR, merge, CI-run-ы за период (`src/main/flight-recorder/github.ts`);
- run-ы gate: логи (10 на worktree, 8 дней после удаления), записи о падениях `gate-failures` (срок хранения?), состояние gate;
- смена статуса Ticket-а: можно ли восстановить из `git log` файлов Ticket-ов (`Status:` в каждом коммите main и веток), с какой точностью по времени;
- ручная «Run wave» без Run-а и Wave-ы из терминала вне worfy (ADR-0092, spec Flight Recorder `:163`).

Итог: таблица «источник × период × полнота × цена», пробелы, и ответ — хватает ли этого без журнала работы, или какой минимальный журнал закрыл бы пробелы.

## Answer

Проверено 2026-11-05 на этом Mac, код — ветка `docs/map-autopilot-queue` (main db7ded110 + карта), Harness — `~/.claude/worfy-harness/plugin` (Stable). Всё измерено только чтением: скрипты на node в `/tmp`, содержимое транскриптов не печаталось, считались только число, размер и время. Окна «1/7/14/30 д» — от 2026-11-05 ~08:00Z назад. Время чтения — с прогретым page cache (повторный запуск), на холодном диске может быть дольше.

**Источники кода.**
- Журналы Run-ов: `src/main/autopilot/journal.ts:39-40` (`<data dir>/autopilot`), `:173-197` (`listRuns` читает все файлы); data dir — `src/main/storage/paths.ts:35-44` (`~/Library/Application Support/worfy`, у dev — `worfy-dev`).
- Транскрипты: `src/main/flight-recorder/transcripts.ts:7-17` (папка `projects/<dir>`, принадлежность по `cwd`, только Subagent-ы из Wave-ов Run-а); срок — `src/main/agent/orchestrator.ts:73` (`cleanupPeriodDays`, 30 по умолчанию; в `~/.claude/settings*.json` не задан). Codex — `.scratch/worfy-multi-vendor/issues/05-codex-транскрипты.md:16,29`.
- GitHub: `src/main/flight-recorder/github.ts:26-29` (`PRS_PER_BRANCH` 10, `RUNS_PER_BRANCH` 50, `RUNS_PER_COMMIT` 20), `:110-115` (три вызова `gh` на ветку Ticket-а).
- Логи gate: `~/.claude/worfy-harness/plugin/hooks/gate-log.mjs:24-25` (`LOG_RUNS_KEPT` 10, `STALE_MS` 8 дней), `:51-73` (`pruneLogs`); `src/main/flight-recorder/gate-logs.ts:27-30`.
- Записи о падениях: `hooks/gate-failures.mjs:37` («Records live 60 days by the `at`»), `:51` (`FAILURES_DAYS` 60), `:497` (`pruneFailures`).
- Журнал решений Wave-ы без человека: `plugin/skills/epic-wave/SKILL.md:288-300`, `hooks/rules/orchestrator.md:161-163` (`runs/<project>/<epic>-wave-<UTC>/decisions.tsv`, не коммитится, `bin/decision-log` только дописывает).
- GitHub: `gh api rate_limit`, `gh api graphql` (search), REST `actions/runs?created=<день>`, `actions/permissions/artifact-and-log-retention`; repo `IDSAD-XL/worfy`.

**1. Журналы Run-ов** (`~/Library/Application Support/worfy/autopilot/*.jsonl`).
- 41 файл, 2.0 MB, самый старый Run — 2026-10-06, новый — 2026-11-04. Срока хранения нет: ничего не удаляется.
- За 1 д — 1 Run (0.2 MB), 7 д и 14 д — 5 Run-ов (0.5 MB, 3 Epic-а), 30 д — 41 Run (1.9 MB, 14 Epic-ов). Два Project-а: `CanvasForAI-a2cd477b` (40 Run-ов) и `fr-demo` (1).
- События: `run-started`, `wave-started`/`wave-finished`, `ticket-status`, `background-tasks`, `human-input`, `orchestrator-returned`, `run-stopping`/`run-stopped`, `narrow-round`, `forecast`, `harness-behind`, `session-error`, `refused-dialog`. За 30 д у worfy — 90 `wave-started` и 118 `ticket-status`.
- Чтение всех файлов — миллисекунды.
- Что теряется: всё, что шло без Autopilot. Ручная Wave, работа bridge-Session, ручная смена статуса Ticket-а в журнал не попадают.

**2. Транскрипты Claude Code** (20 папок `~/.claude/projects/-Users-<user>-Stuff-CanvasForAI*`, главная и worktree-ы; всего 4.6 GB).

| Окно (mtime) | Файлы (главных + Subagent) | Объём | Строк | Разбор всех строк `JSON.parse` |
|---|---|---|---|---|
| 1 д | 129 (6 + 123) | 226 MB | 66 тыс. | 0.6 с |
| 7 д | 1161 (31 + 1130) | 1414 MB | 337 тыс. | 4.0 с |
| 14 д | 1797 (53 + 1744) | 2265 MB | 599 тыс. | 6.4 с |
| 30 д | 3923 (58 + 3865) | 4075 MB | 922 тыс. | 11.6 с |

- Скорость около 350 MB/s, RSS процесса ~240 MB при потоковом чтении.
- Только главные файлы Session за 30 д: 686 MB, 1.9 с. В них 54 Session с записями в окне и 2957 вызовов `Agent`.
- Битых строк 110 из 922 тыс.: это хвост файла, в который ещё пишут.
- Дают: Session-ход (prompt → ответ), каждый Subagent (вызов `Agent`, его файл в `subagents/`), время по `timestamp` записей. Wave-у и Ticket — только эвристикой: по тексту prompt-а и по worktree Subagent-а.
- Срок: `cleanupPeriodDays` 30 по mtime файла. Самый старый файл — mtime 2026-10-04. Длинная Session держит и старые записи, пока в неё пишут: 91 % строк файлов за 30 д лежат в окне.
- Что теряется: окно «1 мес» стоит на самой границе удаления. Файл Session, в которую не писали 30 дней, исчезает целиком, вместе с её Subagent-ами. Работы ПК (Linked machine) на Mac нет.
- Транскрипты Codex (`~/.codex/sessions`): 9 файлов за 30 д, 1.2 MB, из них 3 — с `cwd` в репо. Чтение мгновенное. Автоудаления в разборе 05 нет, но после 7 дней возможно сжатие в `.jsonl.zst`.

**3. GitHub** (`IDSAD-XL/worfy`, public).
- PR, слитые за 1/7/14/30 д: 78 / 446 / 664 / 1371. Открыто за 30 д — 1384.
- CI workflow run-ов за 31 день (по дням `created=<день>`): 2685. Пиково 292 в день (2026-10-29).
- Логи CI хранятся 90 дней (`artifact-and-log-retention` → `{"days":90}`). PR, merge и список run-ов не истекают.
- Лимиты (`gh api rate_limit`): REST core — 5000/ч, GraphQL — 5000 очков/ч, search — 30/мин.
- **Обрезка.** `gh pr list --search "merged:>=2026-10-06" --limit 2000` вернул ровно 1000: search отдаёт не больше 1000 результатов. Фильтр `created` у `actions/runs` тоже режет на 1000. Период нужно делить: PR — по неделям, CI — по дням.
- **Цена пакетного чтения.** GraphQL search на 100 PR с последним коммитом и `statusCheckRollup` (1567 check run-ов) стоит 2 очка и идёт 3.3 с. Значит, 30 д — около 15 запросов, около 30 очков и около 50 с. CI run-ы за 30 д — около 31–60 REST-вызовов (по дню, по 100 на страницу).
- **Цена нынешнего способа** `github.ts`. На каждую ветку Ticket-а идут `pr list` + `run list --branch` + `run list --commit`, около 0.7 с на вызов. На 1371 PR это около 4100 вызовов `gh`, около 48 мин подряд, и больше половины часового REST-лимита. Для 30 дней не годится, нужен пакетный reader.
- Что теряется: только то, чего нет в GitHub, — локальные проверки и Ticket-ы без PR.

**4. gate** (`~/.claude/worfy-harness/gate/state`).
- Логи: 281 папка worktree, 680 run-ов, 6.4 MB, чтение всех `timings.json` — 0.18 с. Самый старый run — 2026-10-23, хотя Harness старше. За 1/7/14/30 д — 87 / 562 / 680 / 680.
- В `timings.json`: `worktree`, `head`, `outcome`, `exit`, `at`, `total_ms`, `steps[]`.
- Срок: 10 последних run-ов на worktree, папка worktree, которую не трогали 8 дней, удаляется. Сейчас ровно 10 run-ов лежит в 6 папках, то есть у них старые run-ы уже стёрты.
- Практически логи gate покрывают около 8–13 дней. За 30 д gate-история неполная.
- Записи о падениях (`failures/`): 60 дней по `at`, только красные run-ы и их rerun. Сейчас 5 файлов, все от 2026-11-05: запись началась сегодня (worfy-failures). Полные 60 дней будут только к январю, и зелёных run-ов там нет никогда.
- `decisions.tsv`: 56 папок Wave-ов с 2026-10-13, 537 строк, удаления в коде нет. Пишется только Wave-ой без человека (Autopilot), так что ручные Wave-ы сюда не попадают.

**5. Смена статуса Ticket-а из git** (`git log -p` по `.scratch/*/issues/*.md`, 30 д).
- main: 1386 коммитов, из них 1383 с одним родителем, 1369 с `(#N)` в теме, то есть почти всё — squash merge. `git log -p` занял 0.5 с (17 MB diff).
- В main восстанавливается: 730 созданных Ticket-ов и 1182 смены статуса по 754 Ticket-ам. Переходы: claimed→done 465, open→claimed 408, open→done 192, open→blocked 40, blocked→done 31, прочие — по 1–19.
- 192 перехода open→done значат, что claim и done попали в один squash, и шаг «claimed» потерян.
- Ветки: в GitHub 1159 remote-веток, `delete_branch_on_merge: false`. `git log --remotes --not origin/main` (0.4 с) даёт ещё 908 переходов с временем коммита на ветке.
- **Точность времени.**
  - Время есть в самом значении `Status:` у 71 % (claimed 334/473, done 497/700, вида `2026-11-05T07:39Z`). У остальных только дата.
  - Форматов значения не меньше шести: `done 2026-11-05`, `done — 2026-11-05, [PR #N](…)`, `done 2026-11-05 07:39` и другие.
  - Время коммита в main позже значения: claimed — медиана 102 мин, p90 6.5 ч; done — медиана 6 мин, p90 32 мин.
  - Время коммита на ветке позже значения: claimed — медиана 38 мин, done — 1 мин.
  - Значит, лучшее время — значение `Status:` с временем, затем коммит ветки, затем коммит main.
- Что теряется: статусы на неотправленных ветках и в worktree-ах без push; удалённые ветки; точное время у 29 % значений (только дата); статусы на ПК до push.

**6. Ручная «Run wave» без Run-а и Wave-а из терминала вне worfy.**
- Журнала нет, `decisions.tsv` только у unattended Wave-ы.
- В главных транскриптах за 30 д 96 user-prompt-ов с командой Wave-ы (`/worfy:epic-wave`, «Ticket-ы NN», «волну N») в 16 Session-ах. Для сравнения: в журналах worfy 90 `wave-started`, а Autopilot сам шлёт такой prompt. Ручных Wave-ов с явной командой — около полудюжины.
- Работа, которую Orchestrator или bridge раздают без команды Wave-ы (вызовы `Agent` с brief-ом Ticket-а), видна только как Subagent-ы. У неё нет границы Wave-ы, и Ticket берётся эвристикой.
- Session вне worfy (обычный `claude` в терминале) видна так же, если её `cwd` лежит в репо.

**Итог: источник × период × полнота × цена (этот Mac, 2026-11-05).**

| Источник | 1 д | 7 д | 14 д | 30 д | Полнота | Цена чтения 30 д |
|---|---|---|---|---|---|---|
| Журналы Run-ов | 1 Run | 5 | 5 | 41 | полная для Autopilot (Run, Wave, `ticket-status`); вне Run — ничего; без срока | 2 MB, мс |
| Транскрипты Claude | 129 файлов | 1161 | 1797 | 3923 | все Session-ходы и Subagent-ы; Wave и Ticket вне Run — эвристика; 30 д — на границе удаления | 4.1 GB, ~12 с (главные — 0.7 GB, 2 с) |
| Транскрипты Codex | 7 | 9 | 9 | 9 | полная; формат меняется | 1.2 MB, мгновенно |
| GitHub PR | 78 | 446 | 664 | 1371 | полная; search режет на 1000 | ~15 GraphQL, ~30 очков, ~50 с (сейчас — ~4100 вызовов `gh`, ~48 мин) |
| GitHub CI | 70 за сегодня (UTC) | ~1080 | ~1640 | 2685 | run-ы полные, логи 90 д | ~31–60 REST |
| Логи gate | 87 | 562 | 680 | 680 | реально ~8–13 д: 10 run-ов на worktree, 8 д после удаления | 6.4 MB, 0.2 с |
| Записи о падениях gate | 5 | 5 | 5 | 5 | только красные, 60 д, с 2026-11-05 | мгновенно |
| `decisions.tsv` | 3 | 18 | 18 | 56 Wave-ов | только unattended Wave | 0.4 MB, мгновенно |
| Статусы Ticket-ов (git) | — | — | — | 1182 смены в main + 908 на ветках | все отправленные; время ±минуты у 71 %, иначе день | 0.5 + 0.4 с |

**Пробелы.**
1. gate старше ~8 дней: зелёные run-ы и красные до 2026-11-05 стёрты. Сами `timings.json` весят мало (6.4 MB на 680 run-ов вместе с логами).
2. Граница ручной Wave-ы и Wave-ы bridge: её нет нигде, есть только эвристика по prompt-у и Subagent-ам.
3. Время claim у 29 % Ticket-ов — только дата; в main шаг claimed теряется в 192 из 657 закрытий.
4. Окно «1 мес» у транскриптов совпадает со сроком удаления: Session, в которую не писали 30 дней, пропадает целиком.
5. GitHub reader `github.ts` устроен «по ветке», для 30 дней нужен пакетный (GraphQL search с делением периода).
6. Linked machine (ПК): ни транскриптов, ни gate-логов на Mac — это вопрос 05–06.

**Рекомендация.** Отдельный журнал работы не нужен: 1/7/14 дней источники покрывают. Пробелы 1 и 2 закрываются двумя маленькими правками в Harness, а не новым хранилищем worfy:
- **(а) Логи gate.** `pruneLogs` (`gate-log.mjs:51`) стирает выводы скриптов как сейчас, но оставляет `timings.json` 31 день. Это около 10 KB на run.
- **(б) Маркер Wave-ы.** Skill `epic-wave` всегда, а не только без человека, пишет в `runs/<project>/<epic>-wave-<UTC>/` строки начала и конца Wave-ы с Ticket-ами. Это тот же `bin/decision-log`: «журнал» Wave-ы, который уже есть, только для каждой Wave-ы.
- Пробел 3 закрывается правилом формата: `Status: claimed|done <ISO время>` всегда с временем. Восстановление из git остаётся.
- Пробел 5 — работа reader-а, не данных.
- Пробел 4 — показывать в ленте «транскрипт удалён», как Flight Recorder уже делает. Если владелец хочет полный месяц, выход один: `cleanupPeriodDays` ≥ 35 в настройках Claude Code. Это решение владельца, оно увеличивает диск (~4 GB в месяц).

Если владелец не захочет трогать Harness, минимальный журнал worfy — один append-only JSONL на Project с тремя видами событий: `wave-started`/`wave-finished` для Wave-ы вне Run-а, `ticket-status` с точным временем, `gate-run` (`worktree`, `head`, `outcome`, `at`, `total_ms`). Это частичная отмена ADR-0092, нужен новый ADR.
