# 11 — PR вливается по test-ам, которые задевает его diff; полный набор — на `main` batch-ем; красный `main` — bisect и revert

Type: task
Status: open
Blocked by: 10, 12, 21
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов», решение Q3;
[ADR-0081](../../../docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md) (принят 2026-10-20), пункты 2 и 4;
частично заменяет [ADR-0065](../../../docs/adr/0065-one-gate-full-per-wave-merge-set.md) и пункт 3
[ADR-0068](../../../docs/adr/0068-batch-ci-on-main-once-per-wave.md). Правка 2026-10-28 (раздел «Решения
владельца 2026-10-28: процесс»): команда выбора test-ов вынесена в Ticket
[21](21-команда-выбора-test-ов-по-diff.md), вопрос о flaky test-е закрывает Ticket
[20](20-карантин-flaky-unit-и-contract-test-ов.md).

## Что происходит

- Перед merge любой PR с кодом проходит `GATE_SCOPE=all` gate full: на наборе Wave (`harness/bin/wave-gate
  check`, ADR-0065) или на каждом PR. gate full — lint, typecheck, весь `pnpm test`, `test:e2e` и
  `test:package` (запись worfy в реестре gate, `~/.claude/worfy-harness/gate/config.json`).
- gate сужает набор только по пакету (`harness/hooks/gate.mjs:795-880`). worfy — один пакет, поэтому
  любая правка `.ts` запускает все скрипты, а `pnpm test` — все 347 unit- и contract-файлов.
- Batch CI на `main` (`harness/bin/wave-gate ci`, ADR-0068) идёт один раз на Wave. Красный batch CI run
  — без revert: Autopilot run останавливается, исправление вперёд (ADR-0068, пункт 3).
- 87 unit- и contract-файлов запускают настоящие процессы (скрипты `harness/bin/*`, `bash`, `git`).
  Граф import-ов их связи со скриптами не видит.

## Что делаем

1. **Выбор test-ов по diff** — команда `scripts/affected-tests.mjs` Ticket-а 21 (правка 2026-10-28: пункт
   вынесен туда вместе с двумя первыми пунктами «Готово, когда»). Здесь её только вызывают.
2. **Шаг перед merge.** Вместо gate full на PR (или на наборе Wave) — CI на Linux (Ticket 12) и задетые
   test-ы на Mac. e2e и `test:package` — по правилу Ticket-а 13.
3. **Полный набор — на `main` batch-ем.** Batch CI run на `main` (`wave-gate ci`) остаётся и идёт на
   полном наборе после Wave.
4. **Красный `main` — bisect и revert.** Красный полный набор на `main`: поиск виноватого commit-а
   делением пополам между последним зелёным `main` и красным, затем revert его PR. Автоматически, без
   ожидания владельца; ссылка на CI run, виноватый PR и revert — в отчёте Wave.
5. Тексты Harness: implementer гоняет задетые test-ы, Orchestrator перед merge — шаг пункта 2.

**Решение владельца 2026-10-29** (Q3, `spec.md`, раздел «Ответы владельца 2026-10-29»): после merge Ticket-а 21
(#954) `scripts/affected-tests.mjs` подключается в CI PR — shard-ы linux и windows гоняют только задетые test-ы;
push в `main` гоняет весь набор. Красный `main` после merge — исправление вперёд не дольше 1 h, затем revert
виноватого PR (поправка ADR-0083 от 2026-10-29); пункт 4 этим уточнён.

Платформенный PR (ADR-0056, пункт 2): меняются скрипты Harness — до merge нужен вердикт Windows (ADR-0071).

## Готово, когда

- [ ] Merge PR Wave не требует gate full на Mac: тексты `epic-wave`, `ship-ticket`, `implementer` и
      `wave-gate` говорят шаг пункта 2; shell test-ы проверяют.
- [ ] Красный полный набор на `main` в test-е на временном репозитории: bisect находит commit,
      revert его PR, запись в state file.
- [ ] Первые две Wave-ы после merge: время от зелёных проверок до merge (Ticket 14) и число красных
      `main` — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
      Windows; gate full — шаг Orchestrator-а перед merge (последний по старой схеме).

## Открытые вопросы

Решает владелец по числам Ticket-а 10; исполнитель не выбирает сам.

- ~~Чем считать задетые test-ы~~ — решено 2026-10-28 (решение 4 раздела «Решения владельца 2026-10-28»),
  делает Ticket 21.
- **Где искать виноватый commit.** dispatch CI на commit-ах (нужна ветка на каждый commit:
  `workflow_dispatch` берёт ref) или локально на Mac.
- **Кто делает revert.** `wave-gate` сам или Orchestrator по его отчёту; ждёт ли revert зелёного CI.
- ~~Flaky test на красном `main`: чинить или карантин~~ — решено 2026-10-28: карантин с владельцем и датой
  выхода, без автоматического повтора (решение 2 раздела «Решения владельца 2026-10-28»), делает Ticket 20.
- **Красный Windows run на `main`.** ADR-0071, пункт 6, опирается на ADR-0068, пункт 3 (красный `main` —
  исправление вперёд), который ADR-0081 заменяет. Bisect и revert и для Windows run-а или прежнее
  исправление вперёд — не решено.
- **Остаётся ли `wave-gate check`.** Сверка дерева набора с деревом `main` после каждого merge
  (ADR-0065, пункт 4) полезна и без gate full; нужен ли сам набор.

## Где в коде

- `harness/hooks/gate.mjs` — выбор набора (`:795-880`)
- `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md` (раздел 3 «Verification gate», раздел 4 «Merge by policy»),
  `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`
- `harness/bin/tests/agents-text.test.sh` — shell test текстов Harness
- `vitest.config.ts`, `scripts/vitest-electron.mjs`
- только вызов `scripts/affected-tests.mjs` (Ticket 21)

Вне репозитория (шаг Orchestrator-а после merge): `rules.md` Profile-а worfy, пункт «Gate перед мержем
PR с кодом»; запись worfy в реестре gate.

## Вне скоупа

- CI на PR и shard-ы — Ticket 12.
- Правило e2e и `test:package` — Ticket 13.
- Удаление test-ов — Ticket 15.

## Итог
