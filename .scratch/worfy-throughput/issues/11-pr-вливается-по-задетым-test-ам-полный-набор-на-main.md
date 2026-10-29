# 11 — PR вливается по test-ам, которые задевает его diff; полный набор — на каждом push в `main`; красный `main` — исправление вперёд до 1 h, затем revert

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
2. **Шаг перед merge** (заменено решением владельца 2026-10-29 (Q2/Q3)). Зелёный `ci-ok` CI PR: shard-ы
   linux и windows гоняют только unit- и contract-test-ы, которые задевает diff (`scripts/affected-tests.mjs` Ticket-а 21, после его merge — #954).
   Локального gate full перед merge нет — решает CI (ADR-0083, пункт 4, решения о runner-ах 2026-10-28). e2e и
   `test:package` — по правилу Ticket-а 13.
3. **Полный набор — на каждом push в `main`** (заменено решением владельца 2026-10-29 (Q2/Q3)). Весь набор
   идёт в CI run-е каждого push-а в `main`, а не batch-ем `wave-gate ci` после Wave.
4. **Красный `main` — исправление вперёд до 1 h, затем revert** (заменено решением владельца 2026-10-29
   (Q2/Q3); поправка ADR-0083 от 2026-10-29). Красный `ci-ok` на `main` после merge: сначала исправление вперёд, не дольше 1 h от красного run-а; не
   успели — revert виноватого PR. Bisect и немедленного revert-а нет. Пока `main` красный, PR с кодом не
   вливаются; PR только с документами — можно. Ссылка на CI run, виноватый PR и исправление или revert — в
   отчёте Wave.
5. Тексты Harness: implementer гоняет задетые test-ы, Orchestrator перед merge — шаг пункта 2.

Заголовок, пункты 2–4, два пункта «Готово, когда» и три открытых вопроса заменены решением владельца
2026-10-29 (Q2/Q3): `spec.md`, раздел «Ответы владельца 2026-10-29».

Правка 2026-10-29 (spec, раздел «Ответы владельца 2026-10-29, раунд 2»):

- **R2-Q4 — пустой список.** `scripts/affected-tests.mjs` вернул пустой список — job-ы test-ов linux и windows
  проходят без запуска vitest и всё равно отчитываются в `ci-ok` (job зелёный, а не пропущенный). Smoke-набора
  на этот случай нет.
- **R2-Q3 — без сгенерированных файлов в репозитории.** Сгенерированную часть таблицы affected-tests (раздел
  `generated` в `scripts/affected-tests.table.json`, его пишет `node scripts/affected-tests-table.mjs`) CI строит
  во время run-а; в репозиторий она не commit-ится. Рукописные строки `links` остаются в файле. Причина — merge skew 2026-10-29: #954 и #957 зелёные каждый на своей
  базе, вместе красный `main` на `f52dc8bb`; #968 исправил вперёд, перегенерировав таблицу. Правило красного
  `main` (пункт 4) остаётся; «require branch up to date» и merge queue не включаем, пока skew-ов не больше
  одного в неделю.

Платформенный PR (ADR-0056, пункт 2): меняются скрипты Harness — до merge нужен вердикт Windows (ADR-0071).

## Готово, когда

- [ ] Merge PR Wave не требует gate full на Mac: тексты `epic-wave`, `ship-ticket`, `implementer` и
      `wave-gate` говорят шаг пункта 2; shell test-ы проверяют.
- [ ] Тексты `epic-wave` и `ship-ticket` говорят правило красного `main` пункта 4 (исправление вперёд до
      1 h, затем revert; PR с кодом ждут зелёного `main`); shell test текстов проверяет — заменено
      решением владельца 2026-10-29 (Q2/Q3), вместо test-а bisect-а на временном репозитории.
- [ ] Пустой список affected-tests: job-ы test-ов linux и windows зелёные без запуска vitest, `ci-ok` их
      учитывает; раздела `generated` в `scripts/affected-tests.table.json` в репозитории нет — CI строит его в run-е (решение
      владельца 2026-10-29, R2-Q3/R2-Q4).
- [ ] Первые две Wave-ы после merge: время от зелёных проверок до merge (Ticket 14) и число красных
      `main` — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
      Windows; зелёный `ci-ok` на PR — заменено решением владельца 2026-10-29 (Q2/Q3), вместо gate full
      Orchestrator-а перед merge.

## Открытые вопросы

Решает владелец по числам Ticket-а 10; исполнитель не выбирает сам.

- ~~Чем считать задетые test-ы~~ — решено 2026-10-28 (решение 4 раздела «Решения владельца 2026-10-28»),
  делает Ticket 21.
- ~~Где искать виноватый commit~~ — снят 2026-10-29 (Q2): bisect-а нет; весь набор идёт на каждом push-е в
  `main` (Q3), виноватый PR — тот, после чьего push-а `main` покраснел.
- ~~Кто делает revert~~ — решено 2026-10-29 (Q2): revert виноватого PR — не сразу, а когда исправление вперёд
  не успело за 1 h (поправка ADR-0083 от 2026-10-29).
- ~~Flaky test на красном `main`: чинить или карантин~~ — решено 2026-10-28: карантин с владельцем и датой
  выхода, без автоматического повтора (решение 2 раздела «Решения владельца 2026-10-28»), делает Ticket 20.
- ~~Красный Windows run на `main`~~ — решено 2026-10-29 (Q2): то же правило, что для любого красного `ci-ok` на
  `main` — исправление вперёд до 1 h, затем revert виноватого PR.
- **Остаётся ли `wave-gate check`.** Сверка дерева набора с деревом `main` после каждого merge
  (ADR-0065, пункт 4) полезна и без gate full; нужен ли сам набор.

## Где в коде

- `harness/hooks/gate.mjs` — выбор набора (`:795-880`)
- `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md` (раздел 3 «Verification gate», раздел 4 «Merge by policy»),
  `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`
- `harness/bin/tests/agents-text.test.sh` — shell test текстов Harness
- `vitest.config.ts`, `scripts/vitest-electron.mjs`
- `scripts/affected-tests.mjs` — вызов (Ticket 21) и чтение `table.generated` (`:95`), которое по R2-Q3
  строится в run-е, а не берётся из файла
- `scripts/affected-tests-table.mjs` — строит раздел `generated`; по R2-Q3 запускается в CI run-е
- `scripts/affected-tests.table.json` — раздел `generated` уходит из файла, `links` остаются
- `test/unit/affected-tests.test.ts` — test `--check` на закоммиченной таблице (`:452-455`, комментарий
  `:6-7`) уходит вместе с разделом `generated`
- `.github/workflows/ci.yml` — job-ы `linux-tests` (`:137`), `windows` (`:298`), `ci-ok` (`:364`): пустой
  список — зелёный job без vitest (R2-Q4)
- `.github/workflows/windows-tests.yml` — job `full-suite` (`:151`), который зовёт job `windows`
- `scripts/ci-scope.mjs` — выходы для job-ов (как `macos-tests-files`, `:397`)
- `test/contract/ci-workflow.test.ts` (команда `linux-tests` — `:159`),
  `test/contract/windows-tests-workflow.test.ts` (`FULL_JOB` — `:47`)

Вне репозитория (шаг Orchestrator-а после merge): `rules.md` Profile-а worfy, пункт «Gate перед мержем
PR с кодом»; запись worfy в реестре gate.

## Вне скоупа

- CI на PR и shard-ы — Ticket 12.
- Правило e2e и `test:package` — Ticket 13.
- Удаление test-ов — Ticket 15.

## Итог
