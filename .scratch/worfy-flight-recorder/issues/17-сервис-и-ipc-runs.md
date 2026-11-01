# 17 — Сервис и IPC `runs`

Type: task
Status: claimed 2026-11-01T05:51Z
Blocked by: 13, 14, 15, 16
Source: [spec.md](../spec.md), «Экран» («Живая шкала», «Link»), «Модель» (шкала вычисляется при открытии), «Ticket-ы» (17), «Риски», п. 3 и 6, «Соглашения для Ticket-ов этого Epic-а» (глубина ревью `high`), «Готово, когда» (живая шкала; «Retry»); решение 01, Q4, Q7 ([01-destination-единица-истории-хранение-id.md](01-destination-единица-истории-хранение-id.md)); решение 07 ([07-живая-шкала-или-после-остановки.md](07-живая-шкала-или-после-остановки.md)); решение 08, Q7 ([08-неполная-история.md](08-неполная-история.md)); [ADR-0006](../../../docs/adr/0006-ipc-contract-by-declaration-merging.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- После Ticket-ов 13–16 есть факты из Journal (`from-journal.ts`), транскриптов (`transcripts.ts`), GitHub
  (`github.ts`) и gate (`gate-logs.ts`, `local-verdicts.ts`), после Ticket-а 12 — модель и итог. Связать их для
  одного Run и отдать экрану некому.
- Список Run-ов Project-а — `listRuns`, `readRun` (`src/main/autopilot/journal.ts:156`, `:184`).
- Дочитывание файла с места остановки — `src/main/claude-home/tail.ts` (`TailCursor`). `PrTracker`
  (`src/main/github/prs.ts:395`) читает GitHub раз в минуту.
- IPC: домен объявляет каналы в `src/shared/ipc/<domain>.ts` declaration merging-ом и обрабатывает в
  `src/main/ipc/<domain>.ts`; `src/main/ipc/index.ts` находит домен сам и при новом канале не меняется (ADR-0006).
  Доступ Linked machine-а — метка канала (`src/shared/ipc/channels.ts`, `CHANNEL_ACCESS`).
- Транскрипты ночного Run — десятки мегабайт (риск 3).

## Что делаем

1. `src/main/flight-recorder/service.ts`:
   - список Run Project-а (новые сверху; фильтр по Epic);
   - шкала одного Run: факты всех источников → модель Ticket-а 12 → дерево и итог; вычисляется при открытии,
     своего индекса нет;
   - живой пересчёт открытого Run: на новое событие Journal или транскрипта, не чаще раза в 5 с; GitHub — не
     чаще раза в минуту; транскрипты дочитываются с места остановки (`tail.ts`), не целиком;
   - «Retry» — новое чтение GitHub вне минутного шага.
2. Домен IPC `runs`: `src/shared/ipc/runs.ts` (каналы списка, шкалы и «Retry», событие `runs.changed`) и
   `src/main/ipc/runs.ts`. Доступ — `project`: окно Linked machine-а читает Run на той Machine, где он шёл
   (решение 01, Q7).
3. Замер пересчёта на fixture ночного Run (риск 3): время полного построения и пересчёта после дописанной строки
   записывается в «Итог» PR.

Глубина ревью — `high` (первый PR сервиса, соглашения spec-а).

## Готово, когда

- [ ] Contract test: Journal-ы трёх Run двух Epic-ов во временной `WORFY_DATA_DIR` — список Run Project-а новые
      сверху, фильтр по Epic оставляет Run одного Epic-а; Run другого Project-а не виден.
- [ ] Contract test: шкала ночного Run из fixture (Journal, транскрипты в `WORFY_CLAUDE_HOME`, `gh` через
      `WORFY_GH`, `timings.json`) — дерево Run → Wave → Ticket → Stage → работа и итог.
- [ ] Contract test живого пересчёта (подменённые часы): десять строк Journal за 5 с — один `runs.changed`;
      GitHub читается не чаще раза в 60 с; транскрипт после дописанной строки читается с места остановки, а не с
      начала.
- [ ] Contract test: `gh` выходит с ошибкой — шкала есть, полосы PR и CI с «GitHub did not answer»; «Retry» зовёт
      `gh` сразу, ответ снимает пометку.
- [ ] Contract test доступа: каналы `runs` — `project`; Linked machine с выключенным доступом к Project-ам их не
      получает.
- [ ] Замер пересчёта на fixture ночного Run записан в «Итог».
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): пути и файлы — до merge нужен вердикт Windows.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Contract `test/contract/runs.test.ts` (новый): сервис и каналы на временных папках, stand-in `gh` через
  `WORFY_GH`, агент — `WORFY_AGENT=fake`.
- Сначала падающий: вызов канала списка Run — домена `runs` нет.
- Прогнать `test/unit/flight-recorder-*.test.ts`, `test/contract/flight-recorder-*.test.ts`, `test/unit/tail.test.ts`,
  `test/contract/autopilot-journal.test.ts`.

## Где в коде

- `src/main/flight-recorder/service.ts` (новый)
- `src/shared/ipc/runs.ts` (новый)
- `src/main/ipc/runs.ts` (новый)
- `src/main/ipc/index.ts` — spec называет его, но домен находится сам (ADR-0006); править, только если без этого
  домен не подхватывается
- `test/contract/runs.test.ts` (новый)

Spec называет и `src/shared/ipc/index.ts` — такого файла нет; реестр — `src/shared/ipc/channels.ts`, он при новом
домене не меняется.

Только читать: `src/main/autopilot/journal.ts` (`listRuns`, `readRun`), `src/main/claude-home/tail.ts`,
`src/main/github/prs.ts` (`PrTracker`), `src/shared/ipc/channels.ts`, `src/main/flight-recorder/*.ts`,
`src/shared/flight-recorder/*`.

## Итог

- `src/main/flight-recorder/service.ts` — класс `FlightRecorder`. `list` (service.ts:240) — Run-ы Project-а из Journal-ов
  `listRuns` новые сверху, фильтр по Epic; Project не из списка — ошибка, Run другого Project-а не находится и по id
  (проверка `run-started.project`, service.ts:445). `compute` (service.ts:451) собирает `RunFacts` из четырёх readers:
  Journal (`journalFacts`), транскрипты (`readRunTranscripts`), GitHub (`GithubReader` + `githubFacts`), gate logs
  (`readGateLogs`) и verdicts Ticket-ов без PR (`readLocalVerdicts`), добавляет `run.live`, `now`, Pipeline Profile-а;
  затем `buildTimeline` и `summarize`. Своего индекса нет: шкала считается при каждом открытии.
- `run.live` (service.ts:378): в Journal нет `run-stopped`, Run — новейший у Project-а, Autopilot сейчас работает над
  его Epic (`Autopilot.state`). `run.ts` не менялся.
- GitHub: только если Ticket-ы кончаются PR (не Silent mode, не `local-green`, service.ts:483), иначе `github.state`
  `unused` и gh не зовётся. Аккаунт — `github.account` Profile-а; без него `githubFacts` получает `account: null`,
  verdict-комментарии ничего не значат, а `github.accountReason` говорит почему — аккаунт не угадывается. gh упал —
  `githubNoAnswer()`: у каждого Ticket-а полоса CI с «GitHub did not answer», `github.state` `no-answer` с причиной.
- Ticket-ы без PR (все в Silent mode и `local-green`; в full mode — те, у чьей ветки нет PR в ответе gh), у которых
  был статус кроме `open`, читаются `readLocalVerdicts` (service.ts:511); без ответа gh таких не считаем и git не
  зовём. Ветка Ticket-а — из модели workflow, которую приложение уже смотрит (`workflowHub.model`, `branchOfTicket`),
  иначе `<epic>/<NN>`.
- Живой пересчёт (`tick`, service.ts:331): таймер каждые `RECOMPUTE_INTERVAL_MS` = 5 с (service.ts:50), пока открыт
  live Run, смотрит размер Journal и прочитанных транскриптов; пересчёт — только если что-то выросло или ответ gh
  старше 60 с. Сколько бы строк ни пришло за 5 с — один `runs.changed`. gh — не чаще раза в минуту (интервал
  `GithubReader`), «Retry» (`retry`, service.ts:317) читает gh сразу и шлёт шкалу подписчикам.
- Гонки (rework round 1). `open` (service.ts:266) кладёт запись Run-а и подписчика до первого `await`: `drop` или
  `close`, пришедшие во время первого расчёта, их находят, второе окно того же Run присоединяется к той же записи;
  открытие, которое упало, убирает своего подписчика. Если тот же клиент открыл Run повторно и это открытие упало,
  его первая подписка остаётся (round 2). Пересчёт присоединившегося окна уходит и остальным окнам Run-а
  (round 2): он уже прочитал то, что прочитал бы следующий шаг, и без этого, например, `run-stopped`, пришедший
  до шага, до первого окна не дошёл бы. Пересчёты одного Run идут по очереди (`recompute`,
  service.ts:404); шаг таймера пропускает Run, чей пересчёт ещё идёт («Retry», открытие); два шага одновременно —
  один шаг. Run, который отпустили во время пересчёта (шаг или «Retry»), ничего не получает. Пересчёт, который упал,
  кончает живую шкалу: окна получают последнюю шкалу с `live: false` и `error` с причиной, таймер для Run-а
  останавливается. `FlightRecorder.dispose` вызывается на `will-quit` (src/main/ipc/runs.ts:98).
- Транскрипты live Run дочитываются с места остановки: `TailLines` (service.ts:126) поверх `readNewLines` из
  `tail.ts`. Каждая новая строка разбирается один раз и хранится сжатой: `TranscriptCompactor` (transcripts.ts:116)
  оставляет только то, что читает `from-transcript.ts` (текст сообщений, вызовы агентов и `SendMessage` с полями,
  которые читают факты, отчёты агентов, task-notification), и выбрасывает вывод инструментов, thinking, картинки,
  вложения, кроме queued command. Файл заменён — читается с начала, старые строки не остаются; недописанная последняя
  строка не даёт пересчёта на каждом шаге; файл Subagent-а, которого ещё нет, замечается, когда появится.
  `.meta.json` читается целиком. Законченный Run и Wave без `session` (поиск по тексту обошёл бы все транскрипты
  папки) читаются целиком и не хранятся.
- Граница, которая осталась: факты транскрипта (`transcriptFacts` в `from-transcript.ts`) принимают все строки
  файла, поэтому каждый пересчёт разбирает заново все сжатые строки. Разбирать только новые — значит менять
  `from-transcript.ts`, а бриф его менять запрещает. Инкрементальные факты транскрипта (разбор только новых строк,
  API в `from-transcript.ts`) — отдельный Ticket этого Epic-а. Его пишет orchestrator, и он должен влиться до того,
  как экран (Ticket 18) уйдёт владельцу.
- `src/main/flight-recorder/transcripts.ts`: своя копия правила пути worktree (`canonicalPath`, `comparablePath`)
  удалена, путь даёт `canonicalWorktree` из `worktree-path.ts` (transcripts.ts:283); test-ы ticket-а 14 переведены
  на этот helper. Contract test: агент в worktree через link (junction на Windows) и запуск gate с реальным путём
  того же worktree попадают в один Ticket.
- IPC: `src/shared/ipc/runs.ts` — `runs.list`, `runs.open` (шкала + подписка), `runs.close`, `runs.retry`, событие
  `runs.changed`, все `project` / `read`; схема шкалы повторяет `Timeline` и `Summary`, у `RunView` есть `error`.
  `src/main/ipc/runs.ts` — handlers поверх общего сервиса, клиент держится через `ClientHolders`: окно закрылось или
  у Linked machine выключили доступ — сервис отпускает его Run-ы. `src/main/ipc/index.ts` не менялся: домен
  находится сам. `test/unit/link-access.test.ts` — каналы `runs.*` добавлены в список `read`.
- Tests: `test/contract/flight-recorder-service.test.ts` — 17 tests и замер под `WORFY_PERF=1`: список, правило
  live, шкала ночного Run, аккаунт (и причина без аккаунта), gh с ошибкой и «Retry» (без git для Ticket-ов без PR),
  живой пересчёт (дописанная строка, недописанная строка, заменённый файл — каждый раз шкала равна полному чтению;
  `run-stopped` при работающем Autopilot), остановка таймера, `drop` и `close` во время открытия, два окна разом,
  упавшее открытие и упавшее повторное открытие того же клиента, окно присоединилось после `run-stopped`,
  упавший пересчёт, Run отпущен во время шага, «Retry» и присоединения, шаг во время «Retry» и два шага разом,
  поздний файл Subagent-а, Wave без `session`, worktree двух readers, `local-green` и Silent mode без gh.
  `test/contract/flight-recorder-transcripts.test.ts` — +2 tests: сжатые строки дают те же факты, что сырые, на
  ночном Run и на синтетическом транскрипте с большим выводом инструментов, thinking, картинками, очередью и
  verifier-ом (сжатый — меньше 1 % сырого). `test/contract/runs-ipc.test.ts` — 4 tests: метки каналов, Linked machine
  с доступом `read`, с выключенным доступом — ни вызова, ни `runs.changed`, подписка отпускается; неверный run id.
  Имена файлов — по брифу, вместо `test/contract/runs.test.ts`. Mutation testing: 45 мутантов сервиса и сжатия
  (round 1) и 5 мутантов round 2 (рассылка при присоединении, повторное открытие) — все убиты.

Замер (Mac, vitest под Node из Electron). Худший случай — `test/contract/flight-recorder-service.test.ts`, «a live
Run with a 160 MB transcript», печатает числа при `WORFY_PERF=1`: live Run, транскрипт Orchestrator-а 160 MB из
`test/big-transcript.ts` (112 тысяч записей), 10 шагов, каждый после одной дописанной строки. Два прогона:
- первое открытие (чтение и сжатие с нуля) — 272 и 284 ms (до rework: 247 ms, замер ревьюера);
- шаг после одной строки — медиана 115 и 118 ms, максимум 122 и 131 ms (до rework: 145–174 ms);
- heap, который держит открытый Run, — 34 MB, без `gc`, то есть верхняя граница (до rework: +167 MB).
Шаг почти целиком — повторный разбор всех сжатых строк в `transcriptFacts` (граница выше). Разовая проверка
scratch-скриптом вне репозитория на реальной Session 163 MB и её 1038 транскриптах Subagent-ов (1.14 GB): сжатие
даёт 39 MB и 57 MB, факты сжатых и сырых строк совпадают (1288 работ, 2137 turns).

Реальные данные (замер ревьюера round 2, scratch test вне репозитория, Mac, main process; реальная Session 164 MB,
окно Run 12 ч, 111 Subagent-ов): шаг живого пересчёта — 200–370 ms, медиана 319 ms; без Subagent-ов, только
транскрипт Orchestrator-а, — 197–261 ms; сжатие при первом открытии — 458–1606 ms. Синтетический файл выше
сжимается лучше реального, поэтому его цифры (шаг 115 ms, открытие 280 ms) ниже. Реальные цифры — то, что даст
экран сейчас; их снимет Ticket инкрементальных фактов транскрипта.

Не проверено:
- Вердикт Windows: платформенный PR, нужен Windows CI. Путей сервис сам не сравнивает; worktree — через
  `canonicalWorktree`, test с junction.
- `runs.changed` приходит с задержкой до 5 с после строки: изменения видны по опросу размера файлов, не по `fs.watch`.
