# 02 — Stage-ы Project-а без GitHub: worfy читает файл отметок в Full mode с `local-green`

Type: task
Status: done 2026-10-28T06:22Z
PR: #858
Blocked by: —
Source: решения владельца 2026-10-26, пункты 2 (Pipeline показывает Stage-ы demo) и 5 (Full mode, `local-green`, без GitHub); [spec.md](../spec.md), «Решено без владельца», Р1 (решено без владельца, подтверждено владельцем 2026-10-26); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)

## Что происходит

- Stage Ticket-а считает `stageOf` (`src/shared/workflow/pipeline.ts:213`) из фактов, которые собирает
  `StageReader` (`src/main/workflow/stages.ts:105`).
- Отметки агентов `StageReader` берёт так (`marksOf`, `stages.ts:201-204`): Silent mode — файл
  `<HARNESS_HOME>/runs/<profile>/marks/<epic>-<NN>.json` через `SilentMarks`
  (`src/main/workflow/marks.ts`, создаётся в `stages.ts:143-146`); Full mode — только commit statuses
  открытого PR. Без PR отметок нет.
- Без отметок Stage Implementing не пройден (`pipeline.ts:232-236`: нужен открытый PR или отметка на
  head), Agent review не пройден, `rework` не бывает (`:281`). У Demo project (Full mode, `local-green`,
  без `origin`) Ticket стоял бы на Implementing до `done`.
- Ticket 01 переводит `bin/ticket mark` в этом случае на тот же файл, что в Silent mode. Формат файла
  не меняется; поэтому этот Ticket от 01 не зависит.
- `readPipelineProfile` (`src/main/workflow/profile.ts:754`) читает из Profile `name`, `mode`, `repos`,
  `pipeline` и `workflow.e2e_lock` (`:738-746`), но не `workflow.finish`.

## Что делаем

1. `PipelineProfile` (`profile.ts:725-736`) получает `finish: 'pr-green-ci' | 'local-green' | null`
   из `workflow.finish`.
2. `StageReader` берёт файл отметок в Silent mode **и** в Full mode, когда `finish` — `local-green` и у
   репозитория Ticket-а нет `origin` (`git remote get-url origin` через `GitRunner`, `stages.ts:38-49`).
   Правило — то же, что у `bin/ticket` после Ticket-а 01; одна функция с комментарием-ссылкой на него.
3. Для такого Project-а PR-трекер не нужен: факты PR пустые, `gh` не зовётся ради него.

## Готово, когда

- [ ] Full mode, `local-green`, без `origin`: Ticket `claimed` с веткой и отметкой `review pending` на
      head — Stage Agent review; с `review failure` — Implementing и `rework: true`; с
      `review success` — следующий Stage после Agent review (contract test).
- [ ] Full mode с `origin` — отметки по-прежнему из PR (существующие test-ы зелёные).
- [ ] Full mode, `pr-green-ci`, без `origin` — отметок нет, как сейчас.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Contract `test/contract/workflow-stages.test.ts`: репозиторий без `origin` (helper `git`, `:43`),
  Profile Full mode с `local-green` и Pipeline Demo project (Queued, Implementing, Agent review,
  Gate & merge, Done), файл отметок во временной `HARNESS_HOME`: три случая выше.
- Сначала падающий: случай `review pending` — сейчас Stage Implementing.

## Где в коде

- `src/main/workflow/stages.ts` (`:143-146`, `marksOf` `:201-204`)
- `src/main/workflow/profile.ts` (`PipelineProfile` `:725-736`, схема `:738-746`)
- `test/contract/workflow-stages.test.ts`

Только читать: `src/main/workflow/marks.ts`, `src/shared/workflow/pipeline.ts`, `harness/bin/ticket`.

## Итог

- PR #858, влит 2026-10-27. `src/main/workflow/profile.ts` читает `workflow.finish`; `src/main/workflow/stages.ts`
  (`marksInFile`) берёт отметки из файла отметок Harness home в Silent mode и в Full mode с `local-green` без
  `origin` — то же правило, что у `ticket mark` (Ticket 01). PR tracker для такого репозитория не спрашивается,
  gh не запускается. Full mode с `origin` и Silent mode — как раньше. Test-ы — `test/contract/workflow-stages.test.ts`,
  блок «Stages in Full mode with workflow.finish local-green»; пять mutant-ов правила красные.
- Долг (low, из VERIFIED-комментария): `src/main/workflow/stages.ts:235` — любой ненулевой exit code
  `git remote get-url` (timeout, нет git, не репозиторий) читается как «нет `origin`», хотя «нет remote» — только
  exit 2; так же делает и `harness/bin/ticket`, так что правило согласовано; шапка `src/main/workflow/marks.ts:8-10`
  всё ещё говорит, что файл отметок — только для Silent mode.
