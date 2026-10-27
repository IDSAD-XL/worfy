# 12 — CI на Linux на каждый PR: unit и contract test-ы в 3–4 shard-ах на `ubuntu-latest`

Type: task
Status: open
Blocked by: 10
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов», решение Q4;
[ADR-0081](../../../docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md) (принят 2026-10-20), пункт 1;
заменяет часть [ADR-0068](../../../docs/adr/0068-batch-ci-on-main-once-per-wave.md) «CI на PR нет».

## Что происходит

- `.github/workflows/ci.yml` запускается только вручную (`workflow_dispatch`, input `job`: `check` |
  `full-macos`); триггеров `pull_request` и `push` нет (ADR-0068, пункт 4).
- Job `check` на `main`: медиана 14,4 min, максимум 18,3 min по 37 зелёным CI run-ам. Шаг `pnpm test
  --sequence.shuffle.files` — около 16 из 18 min на стандартном runner-е
  `ubuntu-latest` (для приватного репозитория — 2 vCPU; по логу CI не подтверждено).
- Profile worfy: `workflow.ci: "batch"`, `workflow.ci_batch_run` — команда dispatch. `harness/bin/profile`
  (`:404`) и `harness/bin/wave-gate` (`:726`) знают два значения: `pr` и `batch`.
- `test/contract/ci-workflow.test.ts` проверяет форму `ci.yml`.
- Правка 2026-10-28: репозиторий публичный с 2026-10-27, GitHub-hosted runner-ы бесплатны — минуты Actions
  больше не вопрос цены (spec, раздел «Решения владельца 2026-10-28: процесс», решения 0 и 5); shard-ы на Linux
  на каждый PR делает Ticket 35 — при claim сверить с его PR, что осталось здесь.

## Что делаем

1. `ci.yml`: триггер `pull_request` для job-а unit + contract в 3–4 shard-ах (matrix на `ubuntu-latest`,
   `pnpm test --shard=<i>/<n>`). lint и typecheck — отдельный job или первый shard. Один итоговый check,
   который зелёный, только когда зелены все shard-ы. Job-ов на macOS на PR нет; `full-macos` — только
   вручную, как сейчас. Dispatch для batch на `main` остаётся.
2. Profile: режим «CI на PR и batch на `main`». Harness снова ждёт зелёный CI на head PR перед merge
   (как в режиме `pr`) и запускает batch CI run на `main` после Wave (как в режиме `batch`).
3. Тексты Harness, которые с `batch` пропускают ожидание CI (`implementer.md` шаг 6, `ship-ticket` шаги
   8–9, `epic-wave` — ожидание CI и «Gate before merge»), знают новый режим.
4. В «Итог» — минуты Actions на PR и на день до и после (бюджет Actions уже кончался 2026-10-17).

Платформенный PR (ADR-0056, пункт 2): меняются скрипты Harness (`harness/bin/profile`, `harness/bin/wave-gate`)
— до merge нужен вердикт Windows (ADR-0071). Порядок перехода — как у Ticket-а 08: правка `ci.yml`
действует на все PR в момент merge, поле Profile-а — после обновления Harness.

## Готово, когда

- [ ] PR этого Ticket-а сам получает CI run из 3–4 shard-ов на `ubuntu-latest`; ссылка — в «Итог».
- [ ] Время CI на PR от push до итогового check — в «Итог», рядом с 14,4 min медианы job-а `check`.
- [ ] `test/contract/ci-workflow.test.ts` проверяет: триггер `pull_request`, matrix shard-ов только на
      `ubuntu-latest`, ни одного job-а на macOS на PR, dispatch для batch на месте.
- [ ] `profile --field workflow.ci` принимает новый режим; неизвестное значение — exit 1 с причиной;
      `harness/bin/tests/profile.test.sh` это проверяет.
- [ ] С новым режимом тексты Harness ждут CI на PR и запускают batch на `main`; shell test-ы проверяют.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
      Windows; gate full — шаг Orchestrator-а перед merge.

## Открытые вопросы

Решает владелец по числам Ticket-а 10; исполнитель не выбирает сам.

- **3 или 4 shard-а.** И как делить: `--shard` vitest делит по числу файлов, а contract-файлы в разы
  дороже unit-файлов — возможно, нужен свой раздел по времени файлов из отчёта Ticket-а 10.
- ~~Flaky test на PR: чинить или карантин~~ — решено 2026-10-28: карантин с владельцем и датой выхода, без
  автоматического повтора shard-а (решение 2 раздела «Решения владельца 2026-10-28»), делает Ticket 20.
- **Число shard-ов зависит от runner-а.** Сколько vCPU у `ubuntu-latest` в CI run-ах репозитория (для
  приватного репозитория стандартный runner — 2 vCPU; по логу CI не подтверждено), столько параллельных
  потоков vitest внутри shard-а; от этого зависит, 3 или 4 shard-а.
- **Имя режима Profile-а.** Новое значение `workflow.ci` (например `pr+batch`) или отдельное поле.

## Где в коде

- `.github/workflows/ci.yml`, `test/contract/ci-workflow.test.ts`
- `harness/bin/profile` (`CI_MODES`, `:404`), `harness/bin/tests/profile.test.sh`
- `harness/bin/wave-gate` (`CI_MODES`, `:726`), `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`
- `harness/bin/tests/agents-text.test.sh` — shell test текстов Harness
- `harness/profiles/README.md`, `harness/profiles/draft.schema.json`
- `docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md`

Вне репозитория (шаг Orchestrator-а после merge): live Profile worfy (`workflow.ci`) и его `rules.md`.

## Вне скоупа

- Выбор test-ов по diff — Ticket 11.
- e2e в CI — нет: e2e остаются на Mac (Ticket 13).
- Windows-runner — по ADR-0071, без изменений.

## Итог
