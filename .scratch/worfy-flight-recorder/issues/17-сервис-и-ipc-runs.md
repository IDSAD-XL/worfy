# 17 — Сервис и IPC `runs`

Type: task
Status: open
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
