# 11 — PR вливается по test-ам, которые задевает его diff; полный набор — на каждом push в `main`; красный `main` — исправление вперёд до 1 h, затем revert

Type: task
Status: done 2026-10-29T10:58Z
PR: #970
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

- [x] Merge PR Wave не требует gate full на Mac: тексты `epic-wave`, `ship-ticket`, `implementer` и
      `wave-gate` говорят шаг пункта 2; shell test-ы проверяют. — заменено решением владельца 2026-10-29
      (Q2/Q3) и ADR-0083, пункт 4: условие merge — `ci-ok` на head PR, gate full перед merge нет
      (`harness/skills/ship-ticket/SKILL.md:678`, `harness/skills/epic-wave/SKILL.md:1037`). Shell test-а
      этой фразы нет; `harness/bin/wave-gate` не менялся.
- [x] Тексты `epic-wave` и `ship-ticket` говорят правило красного `main` пункта 4 (исправление вперёд до
      1 h, затем revert; PR с кодом ждут зелёного `main`); shell test текстов проверяет — заменено
      решением владельца 2026-10-29 (Q2/Q3), вместо test-а bisect-а на временном репозитории.
      `harness/skills/epic-wave/SKILL.md:1249-1257`, `harness/skills/ship-ticket/SKILL.md:681-686`; shell test
      `harness/bin/tests/epic-wave-ship-ticket.test.sh:1090-1109`.
- [x] Пустой список affected-tests: job-ы test-ов linux и windows зелёные без запуска vitest, `ci-ok` их
      учитывает; раздела `generated` в `scripts/affected-tests.table.json` в репозитории нет — CI строит его в run-е (решение
      владельца 2026-10-29, R2-Q3/R2-Q4). — заменено R2-Q3/R2-Q4: `.github/workflows/ci.yml:190-191`,
      `.github/workflows/windows-tests.yml:220-221`, `scripts/ci-ok.mjs:53-54`, `scripts/affected-tests.mjs:111-112`;
      test-ы `test/contract/ci-workflow.test.ts:485-510`, `test/unit/affected-tests.test.ts:423-433`, `:544-547`.
- [ ] Первые две Wave-ы после merge: время от зелёных проверок до merge (Ticket 14) и число красных
      `main` — в «Итог». — не проверено: шаг после merge, наблюдение.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
      Windows; зелёный `ci-ok` на PR — заменено решением владельца 2026-10-29 (Q2/Q3), вместо gate full
      Orchestrator-а перед merge. CI run 40858408423 на head `4e212b0b`: `lint-typecheck`, `linux-tests`,
      `windows` и `ci-ok` — `success`.

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

**Что сделано (PR #970, merge `e5468dab`).** CI PR гоняет на shard-ах linux и windows только unit- и
contract-test-ы, которые задевает diff; push в `main` и ручной запуск (`workflow_dispatch`) — весь набор.

- **Откуда список.** `scripts/ci-scope.mjs` отдаёт output `tests-base` — commit базы PR
  (`scripts/ci-scope.mjs:322-324`, `:417`). Push, ручной запуск, diff, который не прочитать, пустой diff и PR
  только с документами оставляют его пустым (`:29-33`). Job `linux-tests` (shard-ы 1/4–4/4) и Windows
  `full-suite` (1/3–3/3, `harness-scripts 1/2`, `2/2`) берут два commit-а (`fetch-depth: 2`), ставят
  зависимости и в шаге «Pick the test files the pull request touches» запускают
  `node scripts/affected-tests.mjs "$BASE" HEAD --github-output` (`.github/workflows/ci.yml:174-179`,
  `.github/workflows/windows-tests.yml:197-203`). Outputs шага: `run` = `all` / `none` / `some` и `files`
  (`scripts/affected-tests.mjs:229-234`).
- **ALL, push и ручной запуск — весь набор.** Без `tests-base` шаг пропущен, `files` пустой, vitest идёт без
  фильтра; ответ ALL даёт тот же пустой `files`.
- **Пустой список** (`run=none`) — шаг vitest пропущен (`ci.yml:190-191`, `windows-tests.yml:220-221`), job
  заканчивается `success` и остаётся в `ci-ok`: `scripts/ci-ok.mjs:53-54` по-прежнему требует `success` от
  каждого нужного job-а. Smoke-набора нет (решение владельца R2-Q4).
- **Список между shard-ами.** Каждый shard считает тот же список и отдаёт его vitest через `WORFY_TEST_FILES`:
  `scripts/vitest-electron.mjs:43-44` добавляет файлы фильтрами и `--passWithNoTests`, а `--shard` режет уже
  отфильтрованный набор, поэтому каждый файл списка идёт ровно в один shard. Список идёт через переменную, а не
  командную строку: cmd.exe на Windows режет строку на 8191 символе (`:38-42`). Из окружения самих test-ов
  переменная убрана (`:76-77`). На Windows job-ы `harness-scripts i/2` запускают `harness-scripts.test.ts`,
  только когда он в списке (`windows-tests.yml:227`).
- **Строки `generated` строятся в run-е и не commit-ятся** (решение владельца R2-Q3). `affected-tests.mjs`
  строит их из исходников test-ов дерева head при каждом запуске (`generate()`,
  `scripts/affected-tests.mjs:112`). Таблица, в которой есть `generated`, — отказ, exit code 2 (`:111`). Сами
  скрипты выбора и таблица — в `all` (`scripts/affected-tests.table.json:44`): PR, который их меняет, гоняет
  весь набор. Это убирает красные run-ы от устаревшей закоммиченной таблицы: красный `main` на `f52dc8bb`,
  исправленный вперёд PR-ом #968, и ручную перегенерацию таблицы в #977.
- **Ошибки — fail closed.** Неверные аргументы, ошибка git, дерево не равно head, нечитаемая таблица — exit
  code 2 (`scripts/affected-tests.mjs:40-42`, `:236-239`). У шага нет `continue-on-error`, поэтому шаг и job
  красные. Ответ пишется в `$GITHUB_OUTPUT` только в конце (`:225`): при отказе строки `run=` нет, и ошибку
  нельзя прочитать как пустой список.
- **Правило красного `main` в текстах Harness совпадает с Q2.** `harness/skills/epic-wave/SKILL.md:1249-1257`
  («A red push run on the main branch») и `harness/skills/ship-ticket/SKILL.md:681-686`: пока последний push
  run на `main` красный, PR с кодом не вливаются, PR только с документами — можно; исправление вперёд не дольше
  1 h, затем revert виноватого PR; bisect-а нет. Текст Q2 — `spec.md`, раздел «Ответы владельца 2026-10-29».
  Проверяет shell test `harness/bin/tests/epic-wave-ship-ticket.test.sh:1090-1109`. `harness/bin/wave-gate` не
  менялся.

**Test-ы.**

- `test/unit/affected-tests.test.ts`: `--github-output` даёт `some` / `none` / `all` (`:354-367`), `all` для
  имени с пробелом (`:370-376`), отказ без `GITHUB_OUTPUT` (`:380-384`); закоммиченный `generated` — отказ
  (`:423-433`); в таблице репозитория нет `generated` (`:544-547`). Guard test `:389-405`: отказ по каждой из
  трёх причин (нечитаемая таблица, неизвестный commit, дерево не равно head) — exit code 2, и в
  `$GITHUB_OUTPUT` не появляется строка `run=`.
- `test/contract/ci-workflow.test.ts`: `tests-base` из job-а `changes` доходит до `windows` (`:480-483`); шаги
  выбора и запуска в `linux-tests` (`:485-499`) и в `full-suite` (`:501-510`), включая пропуск vitest при
  `run=none`; `tests-base` пуст для push, ручного запуска, документов и пустого diff (`:950`).

**Review: round 1 VERIFIED + guard test (mutant M1).** Reviewer подтвердил fail closed, весь набор на push и
ручном запуске, деление списка по shard-ам и текст правила красного `main`. Guard test добавлен commit-ом
`6f071e6a`; mutant M1 на нём теперь красный.

**CI на head PR `4e212b0b`** (`gh pr view 970 --json statusCheckRollup`, run 40858408423): `lint-typecheck`,
`linux-tests` 1/4–4/4, `macos-tests`, `macos-e2e` 1/2–2/2, `macos-package`, `windows` 1/3–3/3 и
`harness-scripts` 1/2–2/2 (`full-suite`), `windows-e2e` 1/4–4/4 — `success`; `ci-ok` — `success`; отметка
`review` — `success`. Платформенный PR (меняет `harness/bin/tests`): вердикт Windows — job `windows` в `ci-ok`.

**Долг.**

- Ответы `some` и `none` к моменту merge вживую на runner-е не шли: сам #970 меняет скрипты из `all` и получил
  ALL. Лог шага «Pick the test files the pull request touches» на своём PR проверяет bridge (отдельная Session,
  которая ведёт свои Ticket-ы Epic-а) в Ticket-е 54.
- Переименование файла даёт ALL: diff идёт с `--no-renames`, и старое имя модуля — удалённый модуль
  (`scripts/affected-tests.mjs:6`, `:153-155`).
- `test/contract/ci-workflow.test.ts` — 1155 строк, больше 1000.
