# 25 — Implementer ничего не ждёт: замок e2e — не дольше 2 min, финиш — PR в очереди merge

Type: task
Status: done 2026-10-29T12:55Z
PR: #982
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 2, решение 8;
аналитика 2026-10-27: $1 457 перезаписи cache у
implementer-ов, которые ждали gate (простой > 5 min, cache subagent-а живёт 5 min).

## Что происходит

- Implementer не гоняет gate full (`harness/agents/implementer.md:200-201`: «The whole e2e suite is not yours to
  run»), но гоняет свои e2e-spec-и под общим замком `/tmp/worfy-e2e.lock` (`:198-204`; команда замка — в
  `rules.md` Profile-а, пункт «e2e и gate full разных агентов — по одному»). Замок держит gate full
  Orchestrator-а около 12 min (`[gate] time (full)`: 732,7 s на #860); implementer ждёт в цикле `until mkdir`,
  его cache за это время умирает.
- С `workflow.ci: "batch"` CI на PR implementer не ждёт (`:211-215`) — это уже так.

## Что делаем

1. Текст implementer-а, шаг 5: замок e2e ждать не дольше 2 min (цикл с пределом в той же команде Bash). Не
   взял — не ждать: в отчёт `e2e: deferred to gate full: <spec-и>` и `not_verified` с этой причиной; отчёт
   не называет e2e зелёным.
2. Финиш implementer-а — PR и зелёный gate fast; дальше он ничего не ждёт и заканчивает работу (ни `gh run
   watch`, ни опроса `mergeable` дольше одной проверки).
3. `rules.md` Profile-а worfy (Orchestrator после merge): та же граница 2 min в команде замка для implementer-а;
   Orchestrator и `wave-gate` ждут замок, как раньше.
4. Verifier в skill-е `epic-wave` видит `deferred` и не принимает это за зелёное — проверка в
   `agents-text.test.sh`, текст skill-а не меняется, если уже говорит «not verified is not green».

Нужен ПК: нет. **Трогает Harness: да** — `harness/agents/implementer.md` и пункт `rules.md` Profile-а о замке
e2e; слово владельца дано 2026-10-28 (решение 1). Вердикт Windows: не платформенный PR (текст агента).

## Готово, когда

- [x] `implementer.md` говорит предел 2 min, строку `e2e: deferred to gate full` и что после PR агент не
      ждёт; `harness/bin/tests/agents-text.test.sh` проверяет все три фразы — exit 0.
- [x] Команда замка с пределом в shell test-е на временной папке: занятый замок — выход через 2 min с
      кодом, который не 0, и строкой `deferred`; свободный — команда идёт (время — через подставной `sleep`).
- [x] Shell test-ы Harness — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full
      Orchestrator-а перед merge.
- [ ] (вручную, после обновления Stable copy) Первая Wave: ни один implementer не ждал замок дольше 2 min
      (журнал Wave); перезапись cache у implementer-ов — по Ticket-у 19, в «Итог».

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): после Ticket-а 35 весь `test:e2e` идёт на macOS-runner-е в `ci-ok`; строка отчёта
`e2e: deferred to gate full` тогда значит «передано `ci-ok`» — точное слово выбрать при claim.

## Где в коде

- `harness/agents/implementer.md` (шаг 5, `:198-204`; шаг 6, `:205-216`)
- `harness/bin/tests/agents-text.test.sh`

Вне репозитория (Orchestrator после merge): `rules.md` Profile-а worfy, пункт о замке e2e.

## Вне скоупа

- Доработка свежим агентом — Ticket 26. 1 h cache — Ticket 31.

## Итог

Влит #982 (`548f8d94`), вёл bridge, ревью medium в три круга. Текст: `implementer-e2e.md` — замок циклом из шести
`sleep 20`, не взял — строка `e2e: deferred to gate full: <файлы>`, код 75, в `not_verified`;
`implementer-finish.md` — PR и gate fast, один взгляд на CI, без `gh run watch`; `implementer-rework-round.md` —
checkout по `git ls-remote`. Круг 2 нашёл удаление: `epic-wave` удалял ветку по режиму финиша, и ветка без push
теряла коммиты; теперь `git branch -D` — только после fetch и `merge-base --is-ancestor`, иначе ветка остаётся
(test «push + локальный коммит → остаётся»). `epic-wave-ship-ticket.test.sh` 532/0, `start-context` зелёный:
implementer на `main` после #982 и #983 — 14 617 при пороге 15 000.

Profile (Orchestrator после merge, 2026-10-29): `workflow.implementer_steps` без «зелёный check ci-ok на head»;
в `rules.md` — предел замка e2e 2 min для implementer-а и такой же предел ожидания разблокировки экрана (четыре
`sleep 30`, строка `e2e: deferred to gate full: screen locked`); Orchestrator и `wave-gate` ждут, как раньше.
Те же строки внесены в предложение Ticket-а 53 (`rules-local-e2e.md`).

Не проверено: пункт «первая Wave» — после обновления Stable copy: установленный plugin старше #974, агент ещё не
читал файлы шагов. Долг [low] (следующий PR в `epic-wave/SKILL.md`): блок ожидания CI берёт `[0]` run-ов на head
любого workflow, не фильтрует по CI workflow, как `land`.
