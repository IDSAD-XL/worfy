# 10 — Общий разбор Journal и PR

Type: task
Status: open
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
