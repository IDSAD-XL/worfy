# 43 — Flaky `afterAll` в `harness-evals` test-ах: уборка временных папок дольше 10 s под нагрузкой

Type: bug
Status: claimed 2026-10-25T01:21Z
Branch: worfy-polish/43
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

- [x] Причина и замер до/после (время уборки, число скопированных файлов) записаны в «Итог».
- [x] 5 полных `pnpm test` подряд при load average ≥ 20 — ни одного hook timeout в
      `harness-evals.test.ts` и `harness-evals-outcome.test.ts`.
- [x] Ни один timeout не изменён (`vitest.config.ts`, `test/time-scale.ts`, константы в двух файлах).
- [x] `test/unit/no-rmsync.test.ts` зелёный; на Windows удаление по-прежнему через `removeTree`.
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

## Итог

**Причина.** Оба файла собирали все временные папки в один массив и удаляли их разом в одном
`afterAll`. К этому hook-у в `harness-evals.test.ts` — 277 папок, 44 300 записей (из них 31 800 —
49 git-репозиториев `changedRepo()`: копия `harness/`, 225 записей, плюс `.git`, около 400 записей
loose objects и hooks); в `harness-evals-outcome.test.ts` — 45 папок, 11 500 записей (6 300 из них —
kept run-ы блока tests-intact: в каждом два git-репозитория, рабочий и `origin`, внутри папок 000).
`removeTree` обходит дерево дважды (`mountedIn`, затем `rmSync`), outcome-файл ещё раз (`openUp`), всё
синхронно на главном потоке воркера. Под нагрузкой каждый системный вызов дорожает в разы, и один
hook на всю уборку файла выходит за 10 s. Повторов и ожиданий внутри `removeTree` вне Windows нет;
дочерних процессов, держащих файлы, не нашлось (все записи удалялись, просто долго).

**Что сделано** (только два test-файла, пределы не тронуты):
- Папка, которую делает test, удаляется сразу после него, в `afterEach`. `tempDir(prefix, 'file')`
  — папка, которую helper держит для следующих test-ов: копия `harness/` у `evaluated()` и stub
  `claude` у `claudeStub()`; она, как и папки, сделанные вне test-а (при сборе файла, в `beforeAll`),
  удаляется в `afterAll` файла.
- В outcome-файле общий setup блока (`beforeBlock`, вместо пяти `beforeAll(() => void setup(), …)`)
  удаляет свои папки в `afterAll` своего блока, а не в конце файла.
- Setup блока tests-intact удаляет kept run-ы (6 300 записей) сам, сразу после двух прогонов scorer-а:
  test-ы блока читают только результаты и маркеры. Эта уборка идёт внутри setup-а с его
  `SETUP_TIMEOUT` (300 s), а не в hook-е на 10 s.
- Число скопированных файлов не менялось: деревья те же, меняется только, когда и сколько удаляет
  один hook. Удаление по-прежнему через `removeTestTree` → `removeTree`.
- Новые test-ы (по три в каждом файле, describe «the temporary folders of this file»): папка test-а
  исчезает после него; папка `'file'` и папка `beforeAll` доживают до конца файла; папка `beforeBlock`
  доживает до конца блока и удаляется после него; папка с правами как у kept run (0500 с папкой 000)
  тоже удаляется. Первый из них был красным до правки. Пять mutant-ов механизма (нет удаления в
  `afterEach` в каждом файле, нет `afterAll` блока, `'file'` не учитывается, всё удаляется после
  каждого test-а) — каждый даёт красный test.

**Замер.** Время hook-а — `performance.now()` вокруг уборки, число записей — `find` по папкам (после
`openUp`, иначе папки 000 не видны), временная инструментовка, в коммит не вошла. Искусственная
нагрузка — 36 процессов, занятых счётом, и 8 процессов, которые пишут и удаляют файлы (18 ядер), под
`/tmp/worfy-e2e.lock`; оба файла одним `pnpm test <два файла>`, раунды «до» и «после» по очереди.

| | load average | `harness-evals` | `harness-evals-outcome` | Hook timeout |
| --- | --- | --- | --- | --- |
| до, без нагрузки | 5–7 | `afterAll` 2 553 ms (44 306 записей) | `afterAll` 894 ms (11 531) | нет |
| до, нагрузка, 3 раунда | 49–70 | `afterAll` 18 465 / 53 851 / 20 318 ms | `afterAll` 6 156 / 6 975 / 6 378 ms | в каждом раунде, `harness-evals.test.ts` |
| после, без нагрузки | 5 | `afterEach` max 92 ms (max 1 335 записей), `afterAll` 30 ms (335) | `afterEach` max 48 ms, `afterAll` блока max 505 ms | нет |
| после, нагрузка, 3 раунда | 49–65 | `afterEach` max 650 / 545 / 352 ms | `afterEach` max 166 / 517 / 133 ms; `afterAll` блока tests-intact 3 208 / 7 780 / 3 275 ms | нет |
| после + уборка kept run-ов в setup, нагрузка | 32–39 | `afterEach` max 307 ms, `afterAll` 70 ms | `afterEach` max 173 ms, `afterAll` блока max 314 ms; уборка kept run-ов в setup — 3 552 ms из 300 s | нет |

7,8 s в `afterAll` блока tests-intact при load average 65 — причина последнего пункта правки: после
него этот hook удаляет 25 записей.

**Полный `pnpm test` под нагрузкой** (24 + 6 процессов нагрузки, load average 44–72), 5 прогонов
подряд: ни одного `Hook timed out`, ни одного падения в двух файлах. Прогоны 2–5 — exit 0 (9017
passed, 183–208 s). Прогон 1 (load average 72) — exit 1 из-за двух чужих timeout-ов: 120 s в
`test/unit/free-place.test.ts` («compares at least 10 times fewer rectangle pairs…») и 5 s в
`test/unit/session-history-tail.test.tsx` («keeps the reader’s row through a time with the log
hidden…»).

**Не сделано здесь.** gate full на Mac — его делает Orchestrator перед мержем.
