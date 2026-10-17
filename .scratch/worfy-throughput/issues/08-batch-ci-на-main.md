# 08 — Batch CI на `main`: один CI run на Wave, переключается полем профиля `workflow.ci`

Type: task
Status: claimed 2026-10-17T09:32Z
Blocked by: —
Source: решение владельца 2026-10-17 (около 09:20 UTC), после остановки GitHub Actions по billing в
05:38 UTC того же дня; [ADR-0068](../../../docs/adr/0068-batch-ci-on-main-once-per-wave.md).

## Что происходит

- Workflow `CI` (`.github/workflows/ci.yml`) запускается на каждый push в pull request и на каждый
  push в `main`; один CI run — около 10 минут на `ubuntu-latest`.
- 2026-10-15 — 112 CI run-ов (около 1 260 минут), 2026-10-16 — 81 (около 960 минут). Ветка PR
  набирает в среднем (медиана) 2 CI run-а и до 8, плюс ещё один на merge.
- В 05:38 UTC 2026-10-17 GitHub перестал запускать job-ы: кончился бюджет. Владелец поднял бюджет и
  принял решение (только для worfy; он называет это плохой практикой, которой нет ни в одном другом
  репозитории, поэтому она включается в каждом Project отдельно):
  - GitHub CI больше не gate перед merge PR. PR вливается по gate на Mac, как уже говорит
    `workflow.merge_gate` (`wave` — один gate full на набор Wave; `each`), плюс вердикт Windows-ПК
    для платформенных PR (ADR-0056 не меняется).
  - CI идёт на `main` **один раз на Wave**, после того как набор Wave влит.
- Branch protection у `main` нет (`gh api repos/IDSAD-XL/worfy/branches/main/protection` — 404
  «Branch not protected», rulesets — `[]`): GitHub не требует checks для merge, и PR без checks
  вливается `gh pr merge` как есть.

## Что делаем

1. Поле профиля `workflow.ci`: `"pr"` (по умолчанию, когда поля нет: сегодняшнее поведение, у других
   Project ничего не меняется) | `"batch"`. Второе поле — `workflow.ci_batch_run`: команда, которая
   запускает CI run на ветке, `$ref` — имя ветки (например
   `gh workflow run ci.yml --ref $ref -f job=check`). Форма — два плоских поля, а не объект
   `workflow.ci: {mode, run}`: так устроены соседние поля `workflow` (`finish`, `merge_gate`,
   `e2e_lock` — скаляры), а команда с подстановкой — как `deploy.ci_run_check` (`$sha`). Строка в
   `workflow.ci` читается `profile --field workflow.ci` без `jq`, и проверка «режим не `batch`»
   остаётся одним сравнением строк в тексте skill-ов.
   `bin/profile` проверяет оба поля: другое значение `workflow.ci` — exit 1 с причиной, как у
   `merge_gate`; `batch` без непустой строки `ci_batch_run` — exit 1; поля `ci` нет (или `null`) —
   `bin/profile` подставляет `pr`.
2. С `batch` везде, где Harness ждёт или требует зелёный CI на head PR, ожидание CI пропускается, и
   текст говорит об этом; с `pr` текст и поведение — как сейчас. Места: `agents/implementer.md`
   (шаг 6), `skills/ship-ticket/SKILL.md` (шаги 8–9), `skills/epic-wave/SKILL.md` (verifier, «Gate
   before merge», набор, ожидание CI), `skills/overnight-fix-loop/SKILL.md`, `skills/max-review`,
   `harness/README.md`, `profiles/README.md`. С `batch` PR вливается, когда `mergeable` —
   `MERGEABLE`, даже если старые checks красные или checks нет. `bin/wave-gate` не смотрит ни на CI,
   ни на `mergeStateStatus` — это закрепляет test.
3. Новая команда `wave-gate ci <state.json>`: после того как Wave влита (`wave-gate merge` набора,
   последний merge `each`, PR, влитые по-старому), с `batch` — один раз запускает
   `workflow.ci_batch_run` для `main`, находит CI run (URL из вывода `gh workflow run`, иначе
   `gh run list --commit <tip> --event workflow_dispatch`) и пишет id и URL в state file.
   Повторный вызов на том же файле не запускает второй CI run. С `pr` — ничего не запускает.
   Orchestrator пишет id и URL в decision log Wave и в отчёт Wave, ждёт результат
   (`gh run watch <id> --exit-status`, Bash timeout 600000, не больше шести вызовов) до отчёта.
   Красный batch CI run: без revert; Autopilot run останавливается после этой Wave, отчёт называет
   ссылку на CI run и упавшие job-ы и test-ы; сбой становится новым Ticket-ом или строкой `blocked`
   — исправление вперёд.
4. `.github/workflows/ci.yml`: убрать триггеры `pull_request` и `push`; оставить
   `workflow_dispatch` с input `job` (`check` по умолчанию | `full-macos`). Job `check` идёт при
   `job == 'check'`, `full-macos` — только при `job == 'full-macos'`: сегодня `full-macos` идёт на
   каждый dispatch, а dispatch из Wave никогда не должен занимать macOS runner. Concurrency: новый
   dispatch на той же ветке и с тем же job отменяет старый, который ещё идёт. `schedule` не
   добавляется (владелец: один CI run на Wave).
5. Live Profile worfy (`~/.claude/worfy-harness/projects/worfy/profile.json`) и его `rules.md` в
   этом PR не меняются: строки для них — в «Итог», их применяет orchestrator после обновления
   Harness (владелец дал слово).
6. ADR-0068 — решение, его цена и отвергнутые варианты.

Платформенный PR (ADR-0056, пункт 2): меняются Harness-скрипты (`harness/bin/profile`,
`harness/bin/wave-gate`) — до merge нужен вердикт Windows-ПК; у PR метка `needs-mac-gate`.

## Готово, когда

- [x] `profile --field workflow.ci`: поля нет — `pr`; `pr`; `batch`; другое значение — exit 1 с
  причиной; `batch` без `ci_batch_run` — exit 1.
- [x] `wave-gate`: PR, у которого `gh pr checks` красный, вливается в наборе; `wave-gate ci` с
  `batch` запускает dispatch один раз (второй вызов — ни одного нового), с `pr` — ни одного.
- [x] Contract test: у `ci.yml` нет триггеров `pull_request` и `push`; `full-macos` идёт только при
  `job == 'full-macos'`, `check` — при `job == 'check'`; input `job` по умолчанию `check`.
- [x] Тексты Harness с `batch` не ждут CI на PR, с `pr` — как были.
- [x] ADR-0068 принят.
- [x] «Итог» содержит строки для live Profile и текст для `rules.md`.
- [ ] Платформенный PR: Harness-скрипт — вердикт Windows-ПК до merge (ADR-0056, пункт 2).

## Тесты

- `harness/bin/tests/profile.test.sh` — четыре значения `workflow.ci` и проверка `ci_batch_run`.
- `harness/bin/tests/wave-gate.test.sh` — набор с красными checks вливается; `wave-gate ci` с
  stub `gh`: один dispatch после набора, ноль с `pr`, ошибка dispatch.
- `test/contract/ci-workflow.test.ts` — триггеры и условия job-ов `ci.yml`, разобранные из текста
  YAML (YAML-парсера в проекте нет, как и в `test/contract/windows-tests-workflow.test.ts`).

## Где в коде

- `harness/bin/profile`, `harness/bin/tests/profile.test.sh`
- `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`
- `harness/profiles/README.md`, `harness/profiles/draft.schema.json`
- `harness/agents/implementer.md`
- `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`,
  `harness/skills/overnight-fix-loop/SKILL.md`, `harness/skills/max-review/SKILL.md`
- `harness/README.md`
- `.github/workflows/ci.yml`, `test/contract/ci-workflow.test.ts`
- `docs/adr/0068-batch-ci-on-main-once-per-wave.md`

## Вне скоупа

- Live Profile и `rules.md` worfy — их меняет orchestrator по строкам из «Итог».
- `worfy-pipeline` 02 (открытый PR #428: Stage «CI» в Pipeline, agent marks, «CI without marks») —
  файлы #428 этот PR не трогает. Что 02/03 должны сделать для Project с `workflow.ci: "batch"`:
  Stage «CI» — на Wave, а не на Ticket. CI run на head PR не будет, поэтому «CI without marks» для
  Ticket-а такого Project не значит «CI не прошёл»: Stage Ticket-а читает merge и gate Wave, а Stage
  «CI» Wave — batch CI run, записанный `wave-gate ci` (поле `ci_run` state file: `run_id`, `url`,
  `commit`). Красный batch CI run — красная Stage Wave, не Ticket-а.
- `worfy-windows` и workflow «Windows tests» (`windows-tests.yml`) — без изменений.
- Production check проекта с `batch` и `deploy` (overnight-fix-loop, раздел 3, ищет push run на
  main): у worfy `deploy` нет; текст говорит «не проверено», механики нет.

## Итог

PR #433, ветка `worfy-throughput/08`. Платформенный PR (ADR-0056, пункт 2): меняются
`harness/bin/profile` и `harness/bin/wave-gate` — до merge нужен вердикт Windows-ПК, метка
`needs-mac-gate`.

- `bin/profile`: `workflow.ci` — `pr` | `batch` | `null`, поля нет или `null` → `pr` (как
  `attribution`); другое значение — exit 1; `ci_batch_run` не строка — exit 1; `batch` без непустого
  `ci_batch_run` — exit 1. Profile без объекта `workflow` даёт exit 4 на `--field workflow.ci` — это
  читается как `pr`.
- `bin/wave-gate ci <файл>`: свой файл `{repo, branch, ci, ci_batch_run}`; с `pr` — `CI=skipped`,
  ничего не запускает; с `batch` — fetch, один dispatch с `$ref` = ветка, поиск CI run (URL из
  вывода `gh workflow run`, иначе `gh run list --commit <tip> --event workflow_dispatch --workflow
  <имя>`), запись `ci_run` в файл. Повторный вызов, пока `main` на записанном commit, не запускает
  второй dispatch; если `main` сдвинулся (файл следующей Wave, merge после dispatch), — новый
  dispatch для нового tip, старый run уходит в `ci_run.superseded`. Поиск run-а — не больше шести
  вызовов, потом `CI_RUN=not-verified`. Коды: 0 — найден, 3 — запущен, ещё не виден
  (`CI_RUN=not-found`) или не виден после шести вызовов (`CI_RUN=not-verified`), 1 — ошибка или
  упавший dispatch (не записан как запущенный). Файл CI — один на Wave:
  `wave-ci-<эпик>-<номер Wave>.json`.
- `check` и `merge` не смотрят на checks и `mergeStateStatus` — так было и раньше; теперь это
  закреплено test-ом (stub `gh pr checks` красный, набор вливается). Отказ `gh pr merge` теперь тоже
  под test-ом: PR не попадает в `merge.merged`, merge останавливается.
- `ci.yml`: только `workflow_dispatch` с input `job` (`check` | `full-macos`), concurrency
  `${{ github.workflow }}-${{ github.ref }}-${{ inputs.job }}` с `cancel-in-progress: false`: идущий
  batch CI run не отменяется. Ожидающий run GitHub отменяет при новом dispatch; epic-wave считает
  такой `cancelled` вытесненным, если есть более новый run на `main`, и ждёт его.
- Тексты: implementer (шаг 6), ship-ticket (шаги 8–9 и поля в начале), epic-wave (поле в начале,
  verifier, ожидание CI, «Gate before merge», новый раздел «Batch CI on the main branch» с block-ом,
  ожиданием и правилом красного CI run, decision log, отчёт), overnight-fix-loop (1h, раздел 2,
  production check), `harness/README.md`, `profiles/README.md`, `draft.schema.json`.
  `skills/max-review` CI не ждёт и не менялся.

Test-ы: `bash harness/bin/tests/profile.test.sh` — exit 0 (229 проверок);
`bash harness/bin/tests/wave-gate.test.sh` — exit 0 (137), включая block skill-а под bash и zsh;
`pnpm test test/contract/ci-workflow.test.ts` — exit 0. Mutant «dispatch без проверки
`dispatched_at`» — 7 красных проверок `wave-gate.test.sh`; mutant «записанный dispatch без
сравнения commit» — 2 красных.

**Порядок перехода.** Правка `ci.yml` действует на все PR сразу, в момент merge; поле Profile-а —
только когда его прочтёт обновлённый Harness. До шага 3 worfy в режиме `pr` ждал бы CI run на PR,
который больше не придёт.

1. Merge этого PR — только пока не идёт ни один Autopilot run.
2. Сразу после merge — обновить живой Harness (`~/.claude/worfy-harness/plugin`) из `main`.
3. Добавить в live Profile строки ниже (`"ci": "batch"`, `ci_batch_run`) и текст для `rules.md`.
4. Первый batch CI run — вручную: `gh workflow run ci.yml --ref main -f job=check`.

**Строки для live Profile** (`~/.claude/worfy-harness/projects/worfy/profile.json`) — шаг 3 порядка
выше. В объект `workflow`:

```json
"ci": "batch",
"ci_batch_run": "gh workflow run ci.yml --ref $ref -f job=check"
```

И заменить в том же файле:

```json
"implementer_steps": "шаги 1–8: claim → свежий origin/main → номера ADR → красный тест → реализация → голая проверка с кодом выхода → PR (CI на PR нет: workflow.ci batch, ADR-0068)",
```

а в `stack` строку про CI —
`"CI: GitHub Actions на ubuntu-latest (lint, typecheck, unit) — один dispatch на main после Wave (workflow.ci batch, ADR-0068); e2e и .app — локально, gate full перед мержем"`.

**Текст для `rules.md`** (`~/.claude/worfy-harness/projects/worfy/rules.md`, раздел «Команды
существуют только после тикета 01»). Пункт «CI на GitHub — дешёвый job…» заменить на:

```markdown
- CI на GitHub — дешёвый job на `ubuntu-latest`: lint, typecheck, unit и contract test-ы. С
  2026-10-17 (решение владельца, ADR-0068, `workflow.ci: "batch"`) он не gate перед merge PR и не
  запускается на PR и на push: один CI run на `main` на Wave, после того как Wave влита, —
  `wave-gate ci` запускает `gh workflow run ci.yml --ref main -f job=check`
  (`workflow.ci_batch_run`). Orchestrator ждёт результат до отчёта Wave. Красный CI run — без
  revert: Autopilot run останавливается после Wave, сбой — новый Ticket или строка `blocked`,
  исправление вперёд. «НЕТ RUN» и старые красные checks у PR — не красный CI: PR вливается по gate,
  когда `mergeable` — `MERGEABLE`. Комментария «CI skipped: docs-only change» больше не нужно: CI
  нет ни у какого PR, финиш PR только с документами — локальный gate fast с кодом 0.
```

В пункте «Gate перед мержем PR с кодом» последнее предложение заменить на:

```markdown
  e2e и собранный `.app` проверяются только здесь, и это единственный gate перед merge: CI на
  Linux идёт уже после Wave (ADR-0068). Полный прогон на macOS в GitHub — только вручную
  (Actions → CI → Run workflow, job `full-macos`), агенты его не запускают; dispatch Wave — всегда
  `job=check`.
```

Пункт «Единственное исключение из правила о платных прогонах — workflow «Windows tests»» начать
так: «Исключения из правила о платных прогонах — batch CI run Wave (`wave-gate ci`, запускает
только Orchestrator, один раз после merge Wave, ADR-0068) и workflow «Windows tests»…», дальше
без изменений.

После merge этого PR на `main` CI не запустится сам (push-триггера нет): первый batch CI run —
`gh workflow run ci.yml --ref main -f job=check` от orchestrator-а.
