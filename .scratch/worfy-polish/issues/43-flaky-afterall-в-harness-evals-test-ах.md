# 43 — Flaky `afterAll` в `harness-evals` test-ах: уборка временных папок дольше 10 s под нагрузкой

Type: bug
Status: open
Blocked by: —
Source: оркестратор, 2026-10-25: повторяющийся flaky test в gate full. Замеры 2026-10-24/25 на Mac и на ПК
владельца (ниже). Строки — по main `3a6a95d6`.

## Что происходит

- В полном `pnpm test` под нагрузкой на Mac (load average 25–33, параллельно идут Electron e2e других
  worktree) `afterAll` одного из двух файлов — `test/contract/harness-evals.test.ts` или
  `test/contract/harness-evals-outcome.test.ts` — падает с `Hook timed out in 10000ms`. Все test-ы внутри
  файла проходят; по timeout-у падает только hook уборки, и из-за него красный весь файл и весь gate.
- Где видели:
  - прогоны implementer-а `worfy-harness` 71 (дважды) и `worfy-browser` 17;
  - gate full Orchestrator-а для PR #829 (main `3a6a95d6`) — два раза подряд;
  - gate full на Windows на ПК для PR #825: hook timeout 30 s в `harness-evals-outcome.test.ts`.
- Один файл отдельно проходит даже при load average 30: 306 passed, 75,8 s.

## Почему уборка долгая (по коду)

- **hookTimeout.** `vitest.config.ts:42` — `10_000 * timeScale`; `timeScale` — 3 на Windows, 1 иначе
  (`test/time-scale.ts:10`). Отсюда 10 s на Mac и 30 s на ПК.
- **Вся уборка — в одном hook-е в конце файла.** Оба файла собирают временные папки в массив `temps`
  (`tempDir`: `harness-evals.test.ts:70-74`, `harness-evals-outcome.test.ts:95-99`) и удаляют их все разом
  в `afterAll` (`harness-evals.test.ts:67-69`, `harness-evals-outcome.test.ts:89-94`). Удаление после
  каждого test-а нет.
- **Удаление синхронное и обходит каждое дерево не один раз.** `removeTestTree` (`test/remove.ts:16`)
  вызывает `removeTree` (`src/main/storage/remove.ts:381`). Не на Windows она сначала обходит всё дерево
  синхронно (`mountedIn`, `:322`: `lstatSync` каждой записи, `readdirSync` каждой папки — ищет
  смонтированный том), затем `fs.rmSync` с `recursive` (`:396`). На Windows — свой синхронный обход с
  повторами (`:399`). В `harness-evals-outcome.test.ts` перед этим ещё `openUp` (`:83-88`): рекурсивный
  `lstatSync` + `chmodSync(0o700)` + `readdirSync` по каждой папке, чтобы вернуть права папкам kept run
  (0500 и 000). Итого в outcome-файле каждое дерево обходится три раза, всё — на главном потоке воркера
  vitest; под нагрузкой каждый системный вызов дорожает.
- **Test-ы копируют весь `harness/`, хотя многим нужны несколько файлов.** `harness/` без
  `evals/results/` — 179 файлов в 46 папках, 2,6 МБ.
  - `harness-evals.test.ts`:
    - `changedRepo()` (`:1465-1489`, копия — `:1472`) — 24 места вызова; каждый вызов копирует весь
      `harness/` в новый репозиторий и делает `git init`, `git add -A`, `git commit` (`:1484-1487`), то
      есть ещё loose objects git на каждый файл копии;
    - `harnessCopyWith()` (`:1361-1366`, копия — `:1363`) — 2 вызова;
    - `evaluated()` (`:711-724`, копия — `:715`) — одна копия на файл (запоминается в `harnessCopy`).
    - Всего до 27 копий, порядка 4 800 файлов плюс объекты git 24 репозиториев (оценка по коду, не замер).
  - `harness-evals-outcome.test.ts`:
    - `stubRun()` (`:1395-1403`) на каждый вызов берёт новую папку и копирует в неё плагин через
      `pluginForStub` (`:1370-1378`, копия — `:1371`: всё, кроме `evals/results/` и задач `evals-outcome/`).
      Вызовы — `:1450`, `:1464`, `:1471`, `:1478` (`it.each` из 5 случаев), `:1487` (одна, запоминается),
      `:1542`, `:1549`: 11 копий;
    - плюс полная копия `harness/` в test-е «a task folder in the real slot…» (`:1458`);
    - плюс kept run-ы с папками 0500 и 000 (`keptRun`, `:697-723`).
    - Всего 12 копий, порядка 2 100 файлов (оценка по коду, не замер).
- Ограничение: `fs.rmSync` с `recursive` в test-ах запрещён (`test/unit/no-rmsync.test.ts`, комментарий
  `test/remove.ts:1-6`): на Windows он отказывает на read-only файлах git и проходит через junction. Любое
  новое удаление должно идти через `removeTree` или её асинхронный вариант с той же защитой.

## Что делаем

Правило владельца (`rules.md`, 2026-10-23): timeout одного test-а не подбирать, лечить причину. `hookTimeout`,
`SETUP_TIMEOUT`, `RUN_TIMEOUT` и прочие пределы не трогаем.

1. **Замер до.** На текущем main: время `afterAll` каждого файла, число временных папок и число файлов в
   них к началу hook-а — один раз без нагрузки и один раз под нагрузкой (полный `pnpm test` параллельно).
   Записать в «Итог».
2. **Лечить причину** — что из этого даёт нужный запас, решает замер:
   - копировать в каждый случай только то, что он читает (например, для `changedRepo()` — скрипты и те
     файлы `harness/`, которые смотрит `eval-harness.mjs --changed`), а не весь `harness/`;
   - одна общая копия только для чтения на все случаи, которым копия не нужна для правки;
   - удалять временные папки после каждого test-а (`afterEach`), а не все в конце;
   - убрать удаление с критического пути hook-а: асинхронное удаление (через `removeTree` или её
     асинхронный вариант, не голый `fs.rm`), которое hook не ждёт дольше, чем нужно следующему test-у;
   - в outcome-файле не обходить дерево ради `chmod` там, где test не закрывал права (вернуть права только
     папкам kept run).
3. **Замер после.** Те же числа, что в шаге 1: время уборки и число скопированных файлов до и после.
4. **Проверка под нагрузкой.** Каждый из двух файлов несколько раз подряд, пока параллельно идёт полный
   `pnpm test`; затем полные прогоны из «Готово, когда».

## Готово, когда

- [ ] Причина и замер до/после (время уборки, число скопированных файлов) записаны в «Итог».
- [ ] 5 полных `pnpm test` подряд при load average ≥ 20 — ни одного hook timeout в
      `harness-evals.test.ts` и `harness-evals-outcome.test.ts`.
- [ ] Ни один timeout не изменён (`vitest.config.ts`, `test/time-scale.ts`, константы в двух файлах).
- [ ] `test/unit/no-rmsync.test.ts` зелёный; на Windows удаление по-прежнему через `removeTree`.
- [ ] gate full на Mac — код 0.

## Где в коде

- `test/contract/harness-evals.test.ts`: `temps` и `afterAll` — `:66-69`, `tempDir` — `:70-74`,
  `evaluated` — `:711-724`, `harnessCopyWith` — `:1361-1366`, `changedRepo` — `:1465-1489`.
- `test/contract/harness-evals-outcome.test.ts`: `temps`, `openUp`, `afterAll` — `:81-94`, `tempDir` —
  `:95-99`, `keptRun` — `:697-723`, `pluginForStub` — `:1370-1378`, `stubRun` — `:1395-1403`, полная копия —
  `:1458`.
- Удаление: `test/remove.ts:16` (`removeTestTree`), `src/main/storage/remove.ts:322` (`mountedIn`), `:381`
  (`removeTree`).
- Пределы: `vitest.config.ts:41-42`, `test/time-scale.ts:10`.
