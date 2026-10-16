# 03 — Stage каждого Ticket-а вычисляется в main по Pipeline его Project-а

Type: task
Status: open
Blocked by: 01, 02
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 3, 4, 5, 7, 9 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md);
[ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md).

## Что происходит

- **Модель workflow** — `epic-status --json` (`src/main/workflow/reader.ts:136-148`), за ней следит
  `WorkflowWatcher` (`src/main/workflow/watch.ts:217`). После Ticket-а 01 в ней есть `statusAt`,
  `blockedReason`, `waits`, `pr`.
- **PR** — `PrTracker`: `gh pr list --json number,headRefName,state,url,statusCheckRollup,comments`
  раз в 60 s (`src/main/github/prs.ts:31`, `:281-340`). Нет `headRefOid`, `reviewDecision`,
  `mergeCommit`, `mergedAt`. Вердикт — из комментариев (`verdictOf`, `:170`).
- **Check-и в renderer** идут отдельным доменом `checks` (`src/main/ipc/checks.ts:38`,
  `src/renderer/canvas/badges/use-checks.ts`). Домен IPC подхватывается по файлу
  (`src/main/ipc/index.ts:5-7`).
- **Profile** worfy читает через `bin/profile --json` (`src/main/workflow/profile.ts:302-333`); после
  Ticket-а 02 там есть `_resolved.pipeline`.
- **Отметки** после Ticket-а 02: Full mode — commit status с context `review`, `check/<name>`,
  `deploy`; Silent mode — `~/.claude/worfy-harness/runs/<project>/marks/<epic>-<NN>.json`. Владелец
  замка e2e — `holder.json` в папке `workflow.e2e_lock`.

## Что делаем

1. **`src/shared/workflow/pipeline.ts` — каталог и вычисление, без ввода-вывода.**
   `stageOf(facts, pipeline) → { stage, index, passed[], blocked?, rework?, waits, enteredAt, sub? }`.
   `facts` — Status, `statusAt`, `blockedReason`, `waits`, ветка и её head SHA, PR (state, head SHA,
   check-и без отметок, `reviewDecision`, `mergedAt`, merge-коммит), отметки на head SHA, деплой
   merge-коммита, владелец замка e2e. Правило — Pipeline по порядку, Stage — первый не пройденный:
   - Queued пройден, когда Status не `open`;
   - Implementing — есть PR или отметка на текущем head SHA, и нет отметки `failure` на нём (иначе
     Implementing с пометкой `rework`);
   - CI — все check-и PR без отметок закончены и зелёные; красные — CI с подписью `failing`;
   - Agent review — `review success` на head SHA; Check «<name>» — `check/<name>` `success` или
     `skipped` на head SHA;
   - Human review — `reviewDecision: APPROVED`;
   - Gate & merge и Awaiting merge — PR влит; у Gate & merge подпись `gate running` (PR в
     `holder.json`) или `waiting for gate` (замок держит другой PR);
   - Deploy — merge-коммит — предок коммита с отметкой деплоя (`git merge-base --is-ancestor`); в
     Silent mode — только GitHub Deployment окружения `environment`;
   - Closing — Status `done`; Done — конечный.

   Необратимые факты засчитывают Stage до себя: влитый PR — все Stage до мержа; Status `done` — Done.
   Отметка на другом SHA не считается. `blocked` — флаг с `blockedReason`, Stage тот же. `waits` —
   строка `Waits:`, иначе по виду Stage (Human review, Awaiting merge — `team`, прочие — `agent`).
   `enteredAt` — из полей: `statusAt`, `at` или `createdAt` отметки, `startedAt` и `completedAt`
   check run-ов, `mergedAt`; текст не разбирается.
2. **Сбор фактов в main.** `src/main/workflow/stages.ts` склеивает модель workflow, `PrTracker`,
   отметки и замок; пересчитывает Stage на каждое изменение модели и каждый опрос PR.
   - `src/main/github/prs.ts`: `FIELDS` += `headRefOid,reviewDecision,mergeCommit,mergedAt`;
     `verdictOf` и `narrowOf` больше не нужны Stage (бейджи — Ticket 05).
   - `src/main/github/deployments.ts`: `gh api repos/<o>/<r>/deployments?environment=<env>` и
     commit status `deploy` — в том же цикле 60 s, только когда в Pipeline есть Deploy и есть
     Ticket-ы на Deploy.
   - `src/main/workflow/marks.ts`: Silent mode — чтение JSON (только чтение; битый файл — отметок
     нет и причина в логе); Full mode — отметки из `statusCheckRollup` по именам context.
   - Замок: `stat` папки `workflow.e2e_lock` и чтение `holder.json`.
3. **Домен IPC `pipeline`** (`src/shared/ipc/pipeline.ts`, `src/main/ipc/pipeline.ts`): `pipeline.get`
   (Pipeline Project-а и Stage каждого Ticket-а) и событие `pipeline.changed`. Доступ — как у
   `workflow` (`'project', 'read'`). Renderer-хук `src/renderer/pipeline/usePipeline.ts` — для
   Ticket-ов 04 и 05.
4. worfy ничего не пишет: ни в файлы Ticket-ов, ни в отметки, ни в замок (ADR-0002).

## Готово, когда

- [ ] `pnpm test test/unit/pipeline.test.ts` — exit 0: таблица случаев на каждый вид каталога и на оба
      примера Pipeline spec-а (worfy и Atakama), в том числе: отметка на старом SHA не считается;
      `review failure` → Implementing `rework`; PR влит без отметок → после мержа; `blocked` на CI;
      Check `skipped` пройден; `gate running` и `waiting for gate`; Deploy по предку.
- [ ] `pnpm test test/contract/workflow-stages.test.ts` — exit 0: временный репозиторий, stub `gh`
      с PR, check-ами, отметками и Deployment-ом, Silent mode с JSON отметок; Stage приходит событием
      `pipeline.changed` после правки файла Ticket-а и после опроса PR.
- [ ] `pnpm test test/contract/github-prs.test.ts` — exit 0: новые поля разобраны; без них (старый `gh`)
      — `null`, не падение.
- [ ] `grep -n "verdictOf" src/main/workflow/stages.ts src/shared/workflow/pipeline.ts` — пусто
      (exit 1): Stage не читает комментарии.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.

## Тесты

Сначала падающий `test/unit/pipeline.test.ts` — чистая функция, без Electron. Контракт — на stub-е
`gh` (как `test/contract/github-prs.test.ts`) и временной папке `HARNESS_HOME`; настоящий GitHub не
вызывается.

## Где в коде

- `src/shared/workflow/pipeline.ts` (новый)
- `src/main/workflow/stages.ts` (новый)
- `src/main/workflow/marks.ts` (новый)
- `src/main/workflow/profile.ts`
- `src/main/github/prs.ts`
- `src/main/github/deployments.ts` (новый)
- `src/shared/ipc/pipeline.ts` (новый)
- `src/main/ipc/pipeline.ts` (новый)
- `src/renderer/pipeline/usePipeline.ts` (новый)
- `test/unit/pipeline.test.ts` (новый)
- `test/contract/workflow-stages.test.ts` (новый)
- `test/contract/github-prs.test.ts`

## Итог

Заполняется при закрытии.
