# 03 — Stage каждого Ticket-а вычисляется в main по Pipeline его Project-а

Type: task
Status: done 2026-10-18T00:53Z
PR: #457
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

- [x] `pnpm test test/unit/pipeline.test.ts` — exit 0: таблица случаев на каждый вид каталога и на оба
      примера Pipeline spec-а (worfy и Atakama), в том числе: отметка на старом SHA не считается;
      `review failure` → Implementing `rework`; PR влит без отметок → после мержа; `blocked` на CI;
      Check `skipped` пройден; `gate running` и `waiting for gate`; Deploy по предку.
- [x] `pnpm test test/contract/workflow-stages.test.ts` — exit 0: временный репозиторий, stub `gh`
      с PR, check-ами, отметками и Deployment-ом, Silent mode с JSON отметок; Stage приходит событием
      `pipeline.changed` после правки файла Ticket-а и после опроса PR.
- [x] `pnpm test test/contract/github-prs.test.ts` — exit 0: новые поля разобраны; без них (старый `gh`)
      — `null`, не падение.
- [x] `grep -n "verdictOf" src/main/workflow/stages.ts src/shared/workflow/pipeline.ts` — пусто
      (exit 1): Stage не читает комментарии.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.

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
- `test/unit/link-access.test.ts` (дописан при claim: каналы `pipeline.get` и `pipeline.close` — в списке `read`)
- `test/contract/harness-script-wiring.test.ts` (дописан при claim: `src/main/ipc/pipeline.ts` запускает `bin/profile`)

## Итог

Stage считается в main. Чистая функция `stageOf` — `src/shared/workflow/pipeline.ts` (каталог видов,
схема Pipeline с правилами `bin/profile`, подписи, Pipeline по умолчанию). Сбор фактов —
`src/main/workflow/stages.ts` (`StageReader`, `StageHub`): модель workflow, единственный
`sharedPrTracker()`, отметки (`src/main/workflow/marks.ts`), `git for-each-ref` и
`git merge-base --is-ancestor`, Deployment-ы и отметки `deploy` (`src/main/github/deployments.ts`),
замок e2e. Пересчёт — на каждое изменение модели и на каждый тик интервала PR (60 s; gh запускает сам
tracker по своему интервалу). Домен IPC `pipeline`: `pipeline.get`, `pipeline.close`, событие
`pipeline.changed` (весь snapshot), доступ `'project', 'read'`, путь проверяется `insideProjects`.
Хук `src/renderer/pipeline/usePipeline.ts` — для Ticket-ов 04 и 05. worfy ничего не пишет: test
сравнивает дерево репозитория и Harness home до и после.

Спорные места, решены ближе к ADR-0067:

- **Отметки в Full mode** — из `statusCheckRollup` PR по именам context (`review`, `check/<name>`).
  Rollup — это commit status-ы head-коммита, поэтому каждая такая отметка — на head SHA; другой SHA
  сюда не попадает. `skipped` в Full mode — commit status `success` с описанием `skipped`, а
  описания в rollup нет: читается как `success`, Stage пройден, но в `skipped[]` не попадает.
  В Silent mode `skipped` виден (`skipped[]` у результата `stageOf`).
- **CI без check-ов** (workflow.ci `batch`: на PR CI нет) — пройден, если PR есть. Без PR CI не
  пройден: у Atakama после ревью агентом Ticket ждёт PR на CI, а не Human review.
- **Status `none`** (старая шапка, нет строки) — Queued, как `open`: не известно, что работа идёт.
- **Замок занят, `holder.json` пустой или нечитаемый** — подпись `gate busy` («gate идёт, PR
  неизвестен»): ни `gate running`, ни `waiting for gate` не утверждается.
- **`enteredAt`** — самое позднее из известных времён: `statusAt` и время факта каждого пройденного
  Stage (отметка `at`, `startedAt`/`completedAt` check-ов, `mergedAt`, время Deployment-а); у rework —
  время отметки `failure`. Текст не разбирается; дата без времени — 00:00 UTC.
- **`waits`** — строка `Waits:`, иначе `team` для Human review и Awaiting merge, `agent` для прочих;
  у Done — `null`.
- **`pipeline.close`** — добавлен к `pipeline.get` и `pipeline.changed`, как `workflow.close`: без него
  подписка окна жила бы до закрытия окна.
- **Отметка `deploy` в Full mode** — один GraphQL-запрос `gh api graphql` за 30 последними коммитами
  ветки по умолчанию; Deploy пройден, если merge-коммит — предок одного из них
  (`git merge-base --is-ancestor` в локальном клоне). Deployment окружения — `gh api
  repos/<o>/<r>/deployments?environment=<env>`. Оба — только для Ticket-ов на Deploy и не чаще раза в
  60 s. Пределы помечены `shortcut:` в коде: окно 30 коммитов; статус Deployment-а не читается;
  коммит, которого нет в локальном клоне, — «не задеплоен» до следующего fetch.
- **gh от имени аккаунта Project-а** для Deployment-ов — новый метод `PrTracker.gh(root, args)`: тот
  же `accountAuth`, интервал опроса PR не трогает. Второго PrTracker нет.
- **Файл отметок Silent mode** — `<Harness home>/runs/<_resolved.name>/marks/<epic>-<NN>.json`, номер
  не короче двух цифр, как в имени файла Ticket-а. Битый файл — отметок нет, причина в log один раз.
- **Profile** читается заново при каждом пересчёте (`readPipelineProfile`, `bin/profile --json`):
  правка `workflow.pipeline` видна без перезапуска. Без `_resolved.pipeline` или с неверным —
  Pipeline по умолчанию и причина в `error` snapshot-а.
- **Project из нескольких репозиториев** — PR, ветки и отметки Ticket-а — из репозитория его строки
  `Repo:`; Ticket без такой строки фактов PR не получает.
- `checks.get` по-прежнему отдаёт только поля бейджей: новые поля PR снимает схема ответа (test в
  `test/contract/github-prs.test.ts`).

Ревью и merge (2026-10-18): гейт глубины low — `VERIFIED` с первого круга
([вердикт](https://github.com/IDSAD-XL/worfy/pull/457#issuecomment-6243077016)). Проверяющий подтвердил: новый код
ничего не пишет (ни файлов, ни Harness home, ни замка), вызовы `gh` для деплоя — только чтение, `PrTracker` один;
из 10 мутантов 7 красные. Долги:
- [low] `src/main/github/prs.ts:39` — test «an older gh without the fields» проверяет только JSON без полей; `gh`, не
  знающий одно из четырёх полей, отвергает `--json` целиком, и бейджи показывают «gh unavailable». Исправление —
  переименовать test или повторять запрос со старым `FIELDS` на «Unknown JSON field».
- [low] `src/main/workflow/stages.ts:304,308` — мутанты «`close()` не останавливает таймер» и «не вызывает
  `workflow.close`» выжили: утечку подписки после последнего `pipeline.close` test не ловит.
- [low] `src/main/workflow/stages.ts:218` — лишний `gh api graphql` о деплое в Silent mode без `environment` test не
  ловит (Stage не меняется).
- [low, вопрос] `src/main/workflow/stages.ts:143` — общий `PrTracker.read` склеивает одновременные вызовы: Stage может
  на один тик откатиться, если PR старше последних 100; поведение tracker-а было и раньше, не воспроизведено.
- мёртвая строка `passed.pop()` в `src/shared/workflow/pipeline.ts:271`; `test/contract/github-prs.test.ts` — 1088
  строк (gate warning).

`GATE_SCOPE=all` gate full — зелёный с первого прогона; влит — `8f0f945f`. Batch CI run на main —
зелёный: https://github.com/IDSAD-XL/worfy/actions/runs/39080623515.
