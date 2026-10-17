# 02 — Отметки агентов, привязанные к SHA: `bin/ticket mark`, поле `workflow.pipeline`, владелец замка e2e

Type: task
Status: done 2026-10-17T14:07Z
PR: #428
Branch: worfy-pipeline/02
Blocked by: —
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 4, 5, 9 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md);
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2;
[ADR-0065](../../../docs/adr/0065-one-gate-full-per-wave-merge-set.md).

## Что происходит

- **Вердикт ревью — текст.** Full mode: `gh pr comment <N> --body "VERIFIED"`; `local-green`: пустой
  commit `gate: VERIFIED`; Silent mode: строка в конце файла Ticket-а
  (`harness/skills/epic-wave/SKILL.md:328-352`). worfy ищет его регулярным выражением
  (`src/main/github/prs.ts:164-176`). К коммиту вердикт не привязан.
- **CI считает любой commit status.** `ciOf` (`src/main/github/prs.ts:142-160`) и `gh pr checks`
  (`harness/skills/epic-wave/SKILL.md:265`, `harness/skills/ship-ticket/SKILL.md:441`,
  `harness/agents/implementer.md:184`) краснят CI по любому commit status `failure`.
- **Замок e2e — пустая папка.** `wave-gate` берёт его `mkdir`-ом (`harness/bin/wave-gate:153-180`);
  кто держит замок и за какой PR — не записано.
- **Деплой worfy** — `pnpm install:stable` (`package.json:23`, `scripts/install-stable.mjs`); какой
  коммит стоит в Stable copy, на GitHub не видно.
- **Поля `workflow.pipeline` в Profile-е нет.** `bin/profile` проверяет поля `workflow`
  (`harness/bin/profile:308-321`), схема — `harness/profiles/draft.schema.json:99-109`, описание —
  `harness/profiles/README.md:139-154`.

## Что делаем

1. **`bin/ticket mark <epic> <NN> <kind> <verdict> --sha <sha>`.** `kind` — `review` или
   `check/<name>`; `verdict` — `pending`, `success`, `failure`, `skipped`. `--sha` обязателен,
   полный SHA. Режим — из Profile-а (`_resolved.mode`).
   - Full mode: `gh api -X POST repos/<owner>/<repo>/statuses/<sha>` с `context=<kind>`,
     `state` (`skipped` → `success` с описанием `skipped`), описанием без имён Ticket-ов и Epic-ов.
     Репозиторий — `origin` (или `Repo:` Ticket-а, ADR-0045).
   - Silent mode: `~/.claude/worfy-harness/runs/<project>/marks/<epic>-<NN>.json` —
     `{ "epic", "num", "marks": [{ "kind", "verdict", "sha", "at" }] }`; запись атомарная (временный
     файл и rename). На GitHub и в репозиторий — ничего (guard Silent mode,
     `harness/hooks/tests/guard-silent.test.sh`).
   - `bin/ticket mark --contexts` печатает имена context отметок (`review`, `check/*`, `deploy`) —
     для фильтра CI.
2. **CI без отметок.** `ciOf` в `src/main/github/prs.ts` пропускает commit status с context из
   списка отметок. Skills и implementer проверяют CI командой, которая исключает те же имена
   (`gh pr checks <N> --json name,bucket` с фильтром), вместо голого `gh pr checks`.
3. **Skills пишут отметки.** `epic-wave`, раздел 3, и `ship-ticket`: перед ревью — `review pending`
   на head SHA; вердикт — `review success` или `review failure` на том же SHA. Комментарий PR,
   пустой commit и строка в файле Ticket-а остаются: по ним Harness считает круги ревью, люди их
   читают. Check-отметки пишет Ticket 07.
4. **Владелец замка e2e.** `wave-gate` после `mkdir` пишет в папку замка `holder.json` —
   `{ "prs": [<номера набора>], "what": "gate-full", "pid", "since" }`; скрипт мержа по одному
   (`epic-wave`, раздел 4, путь `"each"`) — то же с одним PR. Снятие замка удаляет файл вместе с
   папкой. Семантика замка (возраст 30 min, `touch -c`) не меняется.
5. **Отметка деплоя.** `scripts/install-stable.mjs` после успешной установки ставит commit status
   `deploy: success` на поставленный коммит (`git rev-parse HEAD`, `:568`) — только в Full mode и
   только если `origin` на GitHub; без `gh` — строка «deploy mark skipped» и exit 0: установка важнее
   отметки.
6. **Поле `workflow.pipeline`** в `bin/profile`, схеме и README: массив
   `{ "kind", "name"?, "label"?, "stuck_after"?, "environment"? }`, виды — каталог ADR-0067
   (`queued`, `implementing`, `ci`, `agent-review`, `human-review`, `check`, `gate-merge`,
   `awaiting-merge`, `deploy`, `closing`, `done`). Проверки: `queued` первым, `done` последним,
   каждый вид не больше раза (`check` — с разными `name`), `gate-merge` и `awaiting-merge` не вместе,
   `stuck_after` — `"<число>h"` или `"<число>m"`. Нарушение — exit 1 с причиной. Нет поля —
   `_resolved.pipeline` с Pipeline по умолчанию.

Не входит: вычисление Stage (03), ожидание Check-отметок в skills (07).

## Готово, когда

- [x] `bash harness/bin/tests/ticket-mark.test.sh` — exit 0: Full mode зовёт stub `gh api … statuses/<sha>`
      с нужными `context` и `state`; Silent mode пишет JSON и ни разу не зовёт `gh`; без `--sha` —
      exit 2; неизвестный `kind` или `verdict` — exit 2.
- [x] `bash harness/bin/tests/profile.test.sh` — exit 0: Pipeline по умолчанию в `_resolved.pipeline`;
      каждое нарушение пункта 6 — exit 1 с причиной.
- [x] `bash harness/bin/tests/wave-gate.test.sh` — exit 0: `holder.json` с номерами набора есть, пока
      идёт stub gate, и пропадает со снятием замка.
- [x] `pnpm test test/contract/github-prs.test.ts` — exit 0: `ciOf` с `review: FAILURE` и зелёными
      check run-ами — `passing`.
- [x] `pnpm test test/unit/install-stable-functions.test.ts` — exit 0: отметка `deploy` ставится после
      установки; без `gh` установка не падает.
- [x] `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` и `bash harness/bin/tests/skill-blocks.test.sh` —
      exit 0 (блоки skills с `bin/ticket mark` и фильтром CI).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] Платформенный PR (ADR-0056, пункт 2): вердикт Windows — gate full на ПК, код 0 и
      `[gate] зелено (full)`. Не проверено: шаг Orchestrator-а (запрос на ПК) перед merge.
- [ ] (вручную, Orchestrator со словом владельца, до установки Harness с этим PR) rules.md:46: `rmdir "$L"` →
      `rm -f "$L/holder.json"; rmdir "$L"`. Не проверено: шаг Orchestrator-а.
- [ ] (вручную, Orchestrator после мержа и `pnpm install:stable`) первый PR следующей Wave показывает
      `review` в списке check-ов GitHub; `profile.json` worfy получает `workflow.pipeline` (Check
      «windows», Deploy); diff — в «Итог». Не проверено: шаг Orchestrator-а после merge.

## Тесты

Сначала падающие test-ы: `ticket-mark.test.sh` (новый) и случай `ciOf` с отметкой. `gh` — stub, как в
`wave-gate.test.sh`; ни одного запроса к настоящему GitHub.

## Где в коде

- `harness/bin/ticket`
- `harness/bin/tests/ticket-mark.test.sh` (новый)
- `harness/bin/profile`
- `harness/bin/tests/profile.test.sh`
- `harness/profiles/draft.schema.json`
- `harness/profiles/README.md`
- `harness/bin/wave-gate`
- `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/agents/implementer.md`
- `src/main/github/prs.ts`
- `test/contract/github-prs.test.ts`
- `scripts/install-stable.mjs`
- `test/unit/install-stable-functions.test.ts`

## Итог

Ветка `worfy-pipeline/02`. Что сделано, по пунктам «Что делаем»:

1. **`bin/ticket mark`** (`harness/bin/ticket`, функции `markUsage`, `mark`, `markGitHub`, `markLocal`).
   `kind` — `review` или `check/<name>` (строчные буквы, цифры, дефис), `verdict` — `pending`, `success`,
   `failure`, `skipped`, `--sha` — полный SHA в нижнем регистре (40 или 64 знака). Ошибка аргументов — exit 2
   до чтения Profile-а; `deploy` как `kind` отвергается: его ставит скрипт деплоя.
   - Full mode: `gh api -X POST repos/<owner>/<repo>/statuses/<sha> -f state=… -f context=<kind>
     -f description=<verdict>` (`skipped` → `state=success`, `description=skipped`). Репозиторий — строка
     `Repo:` Ticket-а (имя из `_resolved.repos`), иначе git-репозиторий, где запущен `ticket`, иначе
     единственный репозиторий Project-а; `origin` не на GitHub, нет `gh`, отказ `gh` — exit 1 с причиной.
     `gh` идёт с окружением Session (GH_TOKEN ставит hook плагина).
   - Silent mode: `<HARNESS_HOME>/runs/<project>/marks/<epic>-<NN>.json`, `num` — цифры из имени файла
     Ticket-а (`"02"`), отметка дописывается в конец `marks`; запись через временный файл и rename под
     замком-папкой `<файл>.lock` (живой замок ждём до 10 s, старше минуты — снимаем). Битый файл
     отметок не перезаписывается: exit 1. `gh` не вызывается.
   - `ticket mark --contexts` печатает `review`, `check/*`, `deploy`.
2. **CI без отметок.** `ciOf` (`src/main/github/prs.ts`) пропускает commit status с context из
   `MARK_CONTEXTS`; контрактный test сверяет список с выводом `ticket mark --contexts`. Если остались
   только отметки — CI `null` (нет CI). В skills (`epic-wave`, раздел 3; `ship-ticket`, шаг 8) и в
   `agents/implementer.md` вместо голого `gh pr checks <N>` — одна команда
   `gh pr checks <N> --json name,bucket,workflow --jq …`, печатает `CI=pass|fail|pending|none`.
   Исключаются только commit status-ы (пустой `workflow`): job GitHub Actions с именем `deploy` или
   `review` — это CI (круг ревью 1, находка о красном job `deploy`, дававшем `CI=pass`).
3. **Отметки ревью в skills.** `epic-wave`, раздел 3, и `ship-ticket`, шаг 7 и «Review of a PR another
   session wrote»: `review pending` на head SHA до ревью, `review success|failure` на том же SHA с
   вердиктом. Комментарий PR, commit `gate:` и строка в файле Ticket-а остались. В Full mode с
   `local-green` отметки нет: коммит не на GitHub.
4. **Владелец замка e2e.** `wave-gate` после `mkdir` пишет `holder.json`
   (`{"prs","what":"gate-full","pid","since"}`), при снятии удаляет только свой файл (по `pid`), брошенный
   замок снимается вместе с чужим `holder.json`. В `epic-wave`, раздел 4, новый блок gate full одного PR
   (путь `"each"`) с тем же `holder.json`; heartbeat в нём не держит вывод команды открытым.
   Цена: one-liner замка из `rules.md` Profile-а worfy (строка 46, файл вне репозитория) снимает
   брошенный замок через `rmdir "$L"`, а папка с `holder.json` не пустая — после убитого (SIGKILL)
   `wave-gate` такой замок не снимается, и очередь ждёт. Правка `rules.md` — ручной пункт «Готово,
   когда» до установки Harness с этим PR. Способа со стороны кода, при котором `holder.json` лежит в
   папке замка и `rmdir` пустой папки срабатывает, нет: `wave-gate` убирает файл сам на выходе и на
   SIGTERM/SIGINT, остаётся только SIGKILL и обрыв машины.
5. **Отметка деплоя.** `scripts/install-stable.mjs`, `markDeploy`: после установки и записи
   `<target>.json` — `deploy: success` на поставленный коммит. Только Full mode (Profile репозитория через
   его `harness/bin/profile`), только сборка здесь из чистого дерева, только `origin` на GitHub; `gh` — как
   `github.account` Profile-а, если в окружении нет GH_TOKEN. Любая причина не ставить отметку, в том числе
   нет `gh`, — строка `deploy mark skipped: …`, установка не падает. С `WORFY_STABLE_PREBUILT` (путь
   test-ов) отметки и строки нет.
6. **`workflow.pipeline`** — проверка в `bin/profile`, схема в `profiles/draft.schema.json`, строка
   таблицы и `_resolved.pipeline` в `profiles/README.md`. Без поля или с `null` —
   `_resolved.pipeline` = `queued, implementing, ci, agent-review, gate-merge, closing, done`.

Проверки (коды выхода — в отчёте implementer-а): `ticket-mark.test.sh`, `profile.test.sh`,
`wave-gate.test.sh`, `skill-blocks.test.sh`, `epic-wave-ship-ticket.test.sh`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, gate fast — exit 0. gate full и вердикт Windows — шаги Orchestrator-а.

Влит на gate full Mac 2026-10-17 (решение владельца: batch CI, ADR-0068).
