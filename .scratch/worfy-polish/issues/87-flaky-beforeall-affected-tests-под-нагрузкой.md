# 87 — Flaky test: `beforeAll` в `affected-tests.test.ts` не укладывается в 30 s под нагрузкой

Type: bug
Status: claimed 2026-11-10T06:54Z
Blocked by: —
Source: находка Orchestrator-а 2026-11-10 в прогонах `pnpm test` на Mac. Строки перечитаны по main `8d08ed9f7`.

## Что происходит

`test/unit/affected-tests.test.ts:616` — `beforeAll` блока describe «scripts/affected-tests.table.json of this
repository» (:608). Он вызывает `generate(REPO)` (:617) из `scripts/affected-tests-table.mjs:217`: строит
generated-строки таблицы по исходникам всех test-ов репозитория. Один такой вызов занимает около 17 s, даже когда
файл запущен один.

Предел hook-а — общий для набора: `hookTimeout: ms(10_000)` в `vitest.config.ts:57`, умноженный на
`DEFAULT_TIMEOUT_SCALE = 3` (`test/time-scale.ts:15`), то есть 30 s. Под нагрузкой полного `pnpm test` на Mac
`generate` идёт дольше 30 s, hook падает по времени, и все test-ы блока краснеют. Один файл проходит.

## Что делаем

- Сначала замерить: сколько `generate(REPO)` идёт один и под нагрузкой полного набора; где уходит время (чтение
  файлов, разбор import-ов, обход папок). Числа — в «Итог».
- Сделать setup дешевле, если замер показывает, где: например, не строить строки, которые test-ам блока не нужны,
  или убрать повторную работу внутри `generate`. Поведение `scripts/affected-tests.mjs` не меняется.
- Если дешевле сделать нельзя — дать этому hook-у свой предел (`beforeAll(fn, ms(N))`) по замеру под нагрузкой с
  запасом; число и замер — в комментарии рядом и в «Итог». Общий `hookTimeout` в `vitest.config.ts` не трогаем.

## Готово, когда

- [ ] `node scripts/vitest-electron.mjs test/unit/affected-tests.test.ts` один — exit 0; время `beforeAll` — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/affected-tests.test.ts` exit 0, 53 passed · mac - · 10e0b2bb5bab104f908db9256994803c72a67721
- [ ] Тот же файл под нагрузкой полного `pnpm test` (параллельно с ним) 10 раз подряд — 0 падений; команда и счёт в
      «Итог»; до исправления — сколько падений из 10.
  - evidence: test-run pass · 10 runs of `node scripts/vitest-electron.mjs test/unit/affected-tests.test.ts` beside a full `pnpm test`: 0 of 10 failed (before the fix 0 of 10), command in the result section · mac - · 1a95c3d48
- [ ] Полный `pnpm test` на нагруженной машине — exit 0, test-ы блока зелёные.
  - evidence: test-run pass · `pnpm test` exit 0, 731 files passed, loadavg 37 to 132 · mac - · 10e0b2bb5bab104f908db9256994803c72a67721
- [ ] Общий `hookTimeout` в `vitest.config.ts` не изменён.
  - evidence: test-run pass · `git diff --exit-code origin/main...HEAD -- vitest.config.ts test/time-scale.ts` exit 0 · mac - · 10e0b2bb5bab104f908db9256994803c72a67721
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `test/unit/affected-tests.test.ts:608` — describe «scripts/affected-tests.table.json of this repository»;
  :615–618 — `beforeAll` с `generate(REPO)`; :22 — import `generate` из генератора.
- `scripts/affected-tests-table.mjs:217` — `generate(root)`.
- `vitest.config.ts:57` — `hookTimeout: ms(10_000)`; `test/time-scale.ts:15` — `DEFAULT_TIMEOUT_SCALE = 3`.

## Вне скоупа

- Общие пределы набора и множитель в `test/time-scale.ts`.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.

## Итог

Код приложения и `scripts/` не менялись: правка только в `beforeAll` блока «scripts/affected-tests.table.json of this
repository» (`test/unit/affected-tests.test.ts`). Общий `hookTimeout` и `test/time-scale.ts` не тронуты.

**Где уходит время.** Сам `generate(REPO)` не медленный: system `node` строит 262 строки за 0,9–1,0 s
(`node <probe> <worktree>`, два вызова подряд, loadavg 2,8). Тот же вызов под Node из Electron
(`ELECTRON_RUN_AS_NODE=1 <electron> <probe>`) — 3,8 и 5,7 s; внутри vitest (`pnpm test` гоняет test-ы под Electron) —
4,8 и 8,3 s. CPU profile под Electron: время размазано по разбору TypeScript (`scan`, `visitNode`, `forEachChild`,
`parse…`) и по обходу `visit`/`evaluate` генератора, без одной горячей точки; повторной работы, которую можно
выкинуть, не видно, а строки нужны блоку все (`names only files that exist`, `selected(...)`). Причина — Node из
Electron, а не алгоритм.

**Что сделано.** `beforeAll` больше не зовёт `generate(REPO)` в процессе test-а, а запускает команду генератора
`scripts/affected-tests-table.mjs` настоящим `node` (`scriptNode()` из `test/script-node.ts`, как остальные скрипты в
этом файле) и читает JSON из stdout; код выхода проверяется. Что команда печатает ровно `generate()`, держит
test «prints the rows as JSON when run as a command, and nothing else» того же файла. CI так же зовёт
`scripts/affected-tests.mjs` через `node`.

**Замеры под нагрузкой.** Одновременно с test-ами шли тяжёлые прогоны других агентов (loadavg 30–153 на 18 ядрах).

Команда (zsh, из worktree): `pnpm test > load.log 2>&1 & sleep 20; for i in {1..10}; do node scripts/vitest-electron.mjs test/unit/affected-tests.test.ts; echo "run $i exit $?"; done`;
полный `pnpm test` запускается снова, если кончился раньше 10 запусков.

- До исправления: 10 запусков подряд
  `node scripts/vitest-electron.mjs test/unit/affected-tests.test.ts` параллельно с полным `pnpm test` того же worktree:
  **0 падений из 10** (20–168 s на запуск, loadavg 29–153); сам `pnpm test` — exit 0. Падение тикета в этих 10
  запусках не воспроизвелось.
- Сколько занял бы старый `beforeAll`: временный probe-test (в репозиторий не попал) в каждом из 10 запусков после
  исправления мерил оба способа подряд рядом с полным `pnpm test`: в процессе vitest — 2,6–26,3 s (медиана ~15 s),
  командой через `node` — 1,3–11,9 s (медиана ~7 s). То есть старый путь подходил к пределу 30 s на 3,7 s, новый
  оставляет больше 18 s.
- После исправления: та же команда, после каждого запуска ещё probe, полный `pnpm test` перезапускался дважды: **0 падений из 10** (17–122 s на запуск, loadavg 34–97). Красные в тех
  полных прогонах — `test/contract/terminal.test.ts:236` и один раз `test/contract/harness-hook-stdin.test.ts:342`
  (известные flaky из `worfy-polish` 66/69), плюс два test-а, которые нашли сам probe-файл; блок этого тикета зелёный
  во всех.
- Один файл: `node scripts/vitest-electron.mjs test/unit/affected-tests.test.ts` — exit 0, 53 passed (16,9 s до
  исправления при loadavg 3,8; 68 s после при loadavg 23–50 от чужих прогонов). Время самого `beforeAll` vitest не
  печатает; его содержимое отдельно — 1,9 s командой против 4,0 s в процессе (probe, loadavg 23).
- Полный `pnpm test` на нагруженной машине (loadavg 37 в начале, 132 в конце) — exit 0, 731 файлов passed,
  `test/unit/affected-tests.test.ts` — passed за 91 s. `pnpm lint`, `pnpm typecheck` — exit 0.
- Mutant-ы в отдельной копии (`git worktree add --detach /tmp/claude-501/p87-mut`, удалена): команда генератора
  печатает `[]` — 3 test-а красные (два блока тикета и test команды); команда печатает строки, но выходит с 1 —
  весь блок красный на `beforeAll`; команда теряет строки `test/contract/` — красный «sends a fixture, a document and
  a Harness script…». Без mutant-а — exit 0.
