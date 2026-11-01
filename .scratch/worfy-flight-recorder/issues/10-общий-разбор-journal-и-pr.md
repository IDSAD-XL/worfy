# 10 — Общий разбор Journal и PR

Type: task
Status: claimed 2026-11-01T00:01Z
Blocked by: —
Source: [spec.md](../spec.md), «Решено без владельца» (общий разбор — ESM JavaScript с `.d.mts`), «Источники и что меняется в них» (строка GitHub), «Ticket-ы» (10), «Риски», п. 5, «Готово, когда» (пункт про `scripts/critical-path.mjs`); решение 01, Q9 ([01-destination-единица-истории-хранение-id.md](01-destination-единица-истории-хранение-id.md)); решение 04, Q3 ([04-дыры-источников.md](04-дыры-источников.md))

## Что происходит

- `scripts/critical-path.mjs` сам читает Journal-ы (`readJournals`, `walkJournals`) и данные PR через `gh`
  (`loadPrs`, `ciMark`, `headCi`, `verdicts`, `firstCommit`) и строит отчёт по Epic-у (Markdown и CSV).
- Скрипт запускается без сборки и не может импортировать TypeScript (`scripts/critical-path.mjs:29-30`), а импорты
  `src/` идут без расширений.
- `test/unit/critical-path.test.ts` гоняет скрипт на fixture `test/fixtures/critical-path/` и держит `JOURNAL_KINDS`
  скрипта в ногу с `JOURNAL_EVENT_KINDS` формата Journal (`src/shared/autopilot/journal.ts:185`).
- Тот же разбор Journal и PR нужен приложению (Ticket-ы 11, 13, 15). Примера импорта `.mjs` из TypeScript в
  `src/` нет (риск 5 spec-а).

## Что делаем

1. Сначала — пустой `src/shared/flight-recorder/journal-walk.mjs` с `journal-walk.d.mts` и импорт из TypeScript:
   typecheck и сборка (`electron-vite build`) на пустом модуле. Не проходит — способ общего модуля меняется до
   переноса кода, а не после.
2. Разбор Journal из скрипта — в `journal-walk.mjs` (`JOURNAL_KINDS` переезжает туда же); разбор PR (поля `gh`, как
   у скрипта, плюс `labels` — метка cross-machine gate для Ticket-а 15, который этот модуль только импортирует) — в
   `pr-facts.mjs`. Объявления типов — `journal-walk.d.mts`, `pr-facts.d.mts`.
3. `scripts/critical-path.mjs` — тонкая обёртка: аргументы, папки, расчёт шагов и бюджета, вывод, запрет `--out`
   внутри данных; разбор импортирует из `src/shared/flight-recorder/`. Отчёт на fixture — тот же байт в байт.

Не входит: новые виды событий Journal (Ticket 11), модель spans (Ticket 12).

## Готово, когда

- [ ] Импорт `.mjs` из `src/shared/flight-recorder/` в TypeScript проходит typecheck и сборку (проверено первым
      шагом на пустом модуле).
- [ ] Отчёт `scripts/critical-path.mjs` на fixture `test/fixtures/critical-path/` — тот же байт в байт, Markdown и
      CSV: test сравнивает со снимком, снятым до переноса.
- [ ] В скрипте нет своего разбора Journal и PR: он импортирует `journal-walk.mjs` и `pr-facts.mjs` и запускается
      без сборки (`node scripts/critical-path.mjs --help` — exit 0).
- [ ] Unit test `flight-recorder-sources`: из TypeScript `journal-walk.mjs` на fixture даёт Run, Wave, Wait-ы и
      остановку, `pr-facts.mjs` — PR, CI runs, verdict-ы, merge и `labels`.
- [ ] `JOURNAL_KINDS` совпадает с `JOURNAL_EVENT_KINDS` (test скрипта по-прежнему держит это).
- [ ] Общий fixture ночного Run лежит в `test/fixtures/flight-recorder/night-run/`: Journal, выдержки транскрипта
      Orchestrator-а и Subagent-ов, ответы `gh`, `timings.json` gate — обезличенный Run `2026-10-17T22-29-32-707Z-58e783`,
      пути домашней папки заменены. Ticket-ы 13–17 его только читают; недостающий кусок Ticket добавляет новым файлом.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/critical-path.test.ts` — все test-ы зелёные без правки ожиданий; новый test — отчёт байт в байт
  со снимком до переноса.
- Unit `test/unit/flight-recorder-sources.test.ts` (новый): импорт общих модулей из TypeScript, факты Journal и PR
  на fixture скрипта; ответы `gh` — подменённые, как в `critical-path.test.ts`.
- Сначала падающий: `flight-recorder-sources.test.ts` импортирует `journal-walk.mjs` — модуля нет.

## Где в коде

- `src/shared/flight-recorder/journal-walk.mjs`, `journal-walk.d.mts` (новые)
- `src/shared/flight-recorder/pr-facts.mjs`, `pr-facts.d.mts` (новые)
- `scripts/critical-path.mjs`
- `test/unit/critical-path.test.ts`
- `test/unit/flight-recorder-sources.test.ts` (новый)
- `test/fixtures/flight-recorder/night-run/` (новый, общий fixture Epic-а)

Только читать: `src/shared/autopilot/journal.ts` (`JOURNAL_EVENT_KINDS`, `:185`), `test/fixtures/critical-path/`.

## Итог

- Первый шаг — на пустом модуле: `journal-walk.mjs` с одной константой и `journal-walk.d.mts`, временный импорт
  из `src/main/index.ts` и `src/renderer/main.tsx`. `pnpm typecheck` — exit 0; vitest — exit 0; `pnpm build`
  (`electron-vite build`) — exit 0, константа есть в `out/main/index.js` и в bundle renderer-а. Подмена типа в
  test-е (`'other'` вместо `'journal-walk'`) даёт `tsc` exit 2 — объявление `.d.mts` действительно читается.
  Временный импорт снят до переноса кода. Способ общего модуля менять не пришлось.
- `src/shared/flight-recorder/journal-walk.mjs`: `JOURNAL_KINDS`, `time`, `parseJournal` (`:53`, текст одного файла
  Journal → события и счётчики пропущенных строк), `walkRun` (`:86`, один Run: начало, Wave-ы, Wait-ы Limits,
  остановки внутри Wave, остановка Run), `walkJournals` (`:141`, по Ticket-ам и Epic-ам, как считал скрипт; теперь
  поверх `walkRun`). Без модулей Node: `src/shared` идёт во все процессы, файлы читает вызывающий.
- `src/shared/flight-recorder/pr-facts.mjs`: поля `gh` скрипта и `GH_FIELDS_WITH_LABELS` (`:11`, плюс `labels`),
  `pick`, `ciMark`, `headCi`, `headMarks` (статусы `review`, `check/windows` на head), `verdictComments`,
  `verdicts`, `firstCommit`, `labelNames` (`:141`), `prFacts` (`:146`, все факты одного PR). Типы —
  `journal-walk.d.mts`, `pr-facts.d.mts`.
- `scripts/critical-path.mjs` импортирует оба модуля (`:40-41`), `JOURNAL_KINDS` реэкспортирует (`:82`); своего
  разбора нет (−251 строка): осталось чтение файлов (`readJournals`, `:160`), `gh`, аргументы, папки, шаги, бюджет,
  вывод и запрет `--out`. `node scripts/critical-path.mjs --help` — exit 0.
- Отчёт тот же байт в байт: снимок до переноса — `test/fixtures/flight-recorder/critical-path-before.json`
  (Markdown и CSV для `demo-epic`, всех Epic-ов fixture скрипта и ночного Run; строки JSON, чтобы checkout с CRLF
  их не менял). Test — `test/unit/critical-path.test.ts:309`; `:292` проверяет, что `JOURNAL_KINDS` скрипта — тот
  же объект, что в `journal-walk.mjs`, а `gh` спрашивается с `GH_FIELDS` из `pr-facts.mjs`. Статические импорты
  модулей в этом test-е нужны и CI: `scripts/affected-tests.mjs` без них не выбирал `critical-path.test.ts` при
  правке `journal-walk.mjs` (проверено на пробном commit-е: до — нет, после — есть, для обоих модулей).
- `test/unit/flight-recorder-sources.test.ts` (17 test-ов): из TypeScript — Run, Wave-ы, Wait-ы и остановка на
  fixture скрипта и ночного Run (две Wave, `blocked-tickets`, 4 ч 48 мин), PR, CI runs, verdict-ы, merge, отметки
  на head и `labels`. Мутанты (конец Wait по `resumed`, Ticket-ы Wait-а, первый `run-started`, `labels`, флаг
  `narrow`, `headMarks`) — test красный на каждом.
- Fixture ночного Run — `test/fixtures/flight-recorder/night-run/`, состав и обезличивание описаны в его
  `README.md`: Journal целиком; выдержки транскрипта Orchestrator-а (468 записей окна Run, тексты обрезаны до 100
  символов) и 12 Subagent-ов (`meta.json` целиком, начало, конец и записи вокруг пауз); ответы `gh pr view` для
  #457, #460, #467, #468 (`labels` пустые) и `gh run list` веток (пустые — CI в ту ночь шёл на `main`) и `main`;
  `prs.json` для `--prs`. Домашняя папка — `/Users/someone`, владелец репозитория — `owner`.
- Не проверено: `timings.json` gate той ночи не сохранились (`gate-log.mjs` держит 10 запусков на worktree и
  удаляет папку через 8 дней), два запуска в fixture — иллюстративные (формат, тег и head-ы настоящие, длительности
  шагов выдуманы), это сказано в `README.md` fixture. Метки cross-machine gate на PR той ночи нет: `labels` проверены
  на литерале PR в test-е.
