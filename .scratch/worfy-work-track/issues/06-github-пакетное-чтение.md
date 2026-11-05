# 06 — GitHub: пакетное чтение PR и CI за период

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает» → «Чтение»; «Риски», 2; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), п. 3, «Пробелы», 5

## Что происходит

- Reader Flight Recorder читает GitHub по веткам Ticket-ов: `pr list` + `run list --branch` + `run list --commit` на
  ветку (`src/main/flight-recorder/github.ts:108-116`), ~0.7 с на вызов. За 30 дней у worfy — 1371 PR: ~4100 вызовов,
  ~48 мин, больше половины часового REST-лимита (research 04).
- search GitHub отдаёт не больше 1000 результатов; `actions/runs?created=` — тоже.

## Что делаем

1. `src/main/work-track/github.ts`: PR merged за период — GraphQL search по неделям (`merged:<from>..<to>`, 100 на
   страницу, номер, заголовок, ветка, время merge, последний коммит со `statusCheckRollup`); CI run-ы — REST
   `actions/runs?created=<день>` по дням, 100 на страницу. Через `gh` Project-а (`PrTracker.gh`), как Flight Recorder.
2. Факты `pr` и `ci`; ветка `<epic>/<NN>` даёт Epic и Ticket.
3. Ответ — в памяти на `GITHUB_READ_INTERVAL_MS`; ошибка `gh` — пробел «GitHub did not answer» с причиной.

## Готово, когда

- [ ] Contract test на stub `gh` (`WORFY_GH`): неделя из 150 PR — две страницы; месяц — четыре-пять запросов search, по
      одному на неделю; CI — по дню; повтор в интервале — без вызовов `gh`.
- [ ] Contract test: `gh` упал — пробел с причиной, остальные факты есть.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/work-track-github.test.ts`, fixture-ы ответов `test/fixtures/work-track/gh/**` (новые).
- Сначала падающий: месяц — ожидалось ≤ 5 вызовов search, reader-а нет.

## Где в коде

- `src/main/work-track/github.ts` (новый)
- `test/contract/work-track-github.test.ts`, `test/fixtures/work-track/gh/**` (новые)

Только читать: `src/main/flight-recorder/github.ts`, `src/main/github/prs.ts`, `src/shared/flight-recorder/from-github.ts`.
