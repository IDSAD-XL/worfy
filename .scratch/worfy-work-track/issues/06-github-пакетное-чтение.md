# 06 — GitHub: пакетное чтение PR и CI за период

Type: task
Status: done 2026-11-06T15:39Z
PR: #1505
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/work-track-github.test.ts` exit 0 · mac - · 7c7755a2fdcbb39c14297076784c13f533de47df
  - evidence: review pass · PR #1505 · - - · eb80f6dcb6bacd920c5fc22d4377428c4212e38d
- [ ] Contract test: `gh` упал — пробел с причиной, остальные факты есть.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/work-track-github.test.ts` exit 0 · mac - · 7c7755a2fdcbb39c14297076784c13f533de47df
  - evidence: review pass · PR #1505 · - - · eb80f6dcb6bacd920c5fc22d4377428c4212e38d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 7c7755a2fdcbb39c14297076784c13f533de47df
  - evidence: gate pass · `gate fast` exit 0 · mac - · 7c7755a2fdcbb39c14297076784c13f533de47df
  - evidence: review pass · PR #1505 · - - · eb80f6dcb6bacd920c5fc22d4377428c4212e38d
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42241539244 · ci - · eb80f6dcb6bacd920c5fc22d4377428c4212e38d

## Тесты

- Contract `test/contract/work-track-github.test.ts`, fixture-ы ответов `test/fixtures/work-track/gh/**` (новые).
- Сначала падающий: месяц — ожидалось ≤ 5 вызовов search, reader-а нет.

## Где в коде

- `src/main/work-track/github.ts` (новый)
- `test/contract/work-track-github.test.ts`, `test/fixtures/work-track/gh/**` (новые)

Только читать: `src/main/flight-recorder/github.ts`, `src/main/github/prs.ts`, `src/shared/flight-recorder/from-github.ts`.

## Итог

- Reader — `src/main/work-track/github.ts`, класс `WorkGithubReader`: `read(root, repo, period, { retry })` отдаёт факты
  `pr` и `ci` контракта `src/shared/work-track/facts.ts` и пробелы. gh — через `PrTracker.gh` (учётная запись Project-а),
  как у Flight Recorder; интервал — тот же `GITHUB_READ_INTERVAL_MS`, импорт из `src/main/flight-recorder/github.ts`.
- Чтение: неделя периода → один GraphQL search `repo:<o>/<n> is:pr is:merged merged:<от>..<до>` по 100 на страницу;
  день → один REST `actions/runs?created=<от>..<до>&per_page=100`, страницы по `total_count`. Вызовы идут друг за
  другом: search недели, затем run-ы её дней. Дни, которые ещё не начались, не читаются.
- Сначала падающий test: `test/contract/work-track-github.test.ts` красный на `ceb9435e4` — модуля
  `src/main/work-track/github.ts` нет (vitest не загрузил импорт); после реализации 8 test-ов зелёные.
- Stub `gh` — `test/fixtures/work-track/gh/gh-work-track.mjs`, синтетический репозиторий `example-org/example-repo`;
  PR и run-ы test генерирует сам (150 PR недели в одном fixture-файле были бы 45 КБ шума).

Решено без владельца:

1. **Ошибка gh останавливает чтение.** Первый упавший вызов — конец чтения: дальше gh не запускается (нет сети или
   лимит — один вызов, а не 36), часть периода от начала непрочитанного куска до конца периода — пробел
   `GitHub did not answer: <причина>`; прочитанные до ошибки факты остаются. Ответ с ошибкой держится интервал, как во
   Flight Recorder; `retry` читает сразу.
2. **`statusCheckRollup` не читается.** Факт `ci` — из REST run-ов с их исходом; у merged PR исход — всегда merge (`ok`).
   От последнего коммита берётся только `oid`: по нему и по `mergeCommit.oid` run привязывается к PR, если GitHub не
   дал `pull_requests` у run-а (CI на main после merge).
3. **Epic и Ticket — только по ветке `<epic>/<NN>`** (две-три цифры); ветка run-а без PR — по её имени; другая ветка —
   без Epic-а («—», риск 3).
4. **Заголовок факта `pr`** — `#<номер> <заголовок PR>`; у `ci` — имя workflow.
5. **Репозиторий даёт вызывающий** (`GithubRepo` из `src/main/github/deployments.ts`, как у `DeploymentReader`);
   имя не из `[A-Za-z0-9._-]` — пробел без вызова gh.
6. **Больше 1000 PR за неделю или run-ов за день** — остаток теряется (`shortcut:` в коде): search и `actions/runs`
   дальше 1000 не отдают.
