# 17 — e2e в несколько worker-ов Playwright: последовательный e2e больше не 73 % gate full

Type: task
Status: claimed 2026-10-21T02:44Z
Branch: worfy-throughput/17
Blocked by: —
Source: замер Ticket-а [10](10-время-шагов-gate-и-test-файлов.md) после Ticket-а [16](16-shell-test-ы-harness-параллельно.md)
(gate full на `main` `9f9529c9`, 2026-10-21); предложение Session «Worfy продолжение» (очередь gate full на Mac).
Приоритет — за владельцем: gate full 12,9 min — основная часть времени от зелёных проверок до merge (бюджет Q2:
15 / 30 min); выигрыш — пропускная способность очереди gate full на одном Mac и запас бюджета.

## Что происходит

- В gate full 12,9 min e2e идёт 565,3 s wall при сумме по файлам 560,7 s: 88 файлов строго по одному.
  Это около 73 % gate full; vitest после 16 — 133 s.
- `playwright.config.ts`: `workers: 1`, `fullyParallel: false`. 87 из 88 spec-файлов запускают Electron через
  `launchApp` (`test/e2e/helpers.ts`), кроме `linked-autopilot.spec.ts`.
- Длинный хвост ровный: самый медленный файл (`browser`) — 27,1 s, ни один не больше 5 %. Значит,
  выигрыш даст только параллельность, а не ускорение одного файла.
- Ticket 13 (e2e до merge только по путям diff) убирает e2e у PR без UI, но не у PR с UI и не у ночного run-а.

## Что делаем

1. Разбор: почему `workers: 1`. Проверить и назвать каждую причину с `file:line`: single-instance lock
   Electron, общая папка userData, фиксированные порты, общие файлы во временной папке, замок
   `/tmp/worfy-e2e.lock` (`workflow.e2e_lock` в профиле), общие fixture-репозитории, `gh`/сеть.
2. Изоляция на worker: своя userData, свои порты, своя временная папка (через `workerIndex` / `parallelIndex`
   Playwright), замок e2e — один на весь run, а не на worker.
3. Замер на Mac с 2 и 3 worker-ами в слот от Session очереди gate (на Mac один тяжёлый run за раз): wall
   e2e, нагрузка, и 3 run-а подряд без нового flaky test. Число worker-ов — по замеру, а не заранее.

## Готово, когда

- [x] В «Итог» — список причин `workers: 1` с `file:line` и что с каждой сделано.
- [x] `pnpm test:e2e` идёт в N worker-ах (N по замеру, 2 или 3), wall e2e на Mac записан до (565,3 s) и после.
- [x] 3 полных e2e run-а подряд green без повторов и без нового flaky test.
- [x] Ticket 10: JSON-отчёт e2e и `scripts/test-timings.mjs` работают с несколькими worker-ами.
- [x] Вердикт Windows (ADR-0056), если меняется то, что идёт на ПК; иначе — сказано, почему не нужен.

## Где в коде

- `playwright.config.ts` — `workers`, `fullyParallel`.
- `test/e2e/helpers.ts` — `launchApp`, userData, окружение запуска Electron.
- `test/e2e/*.spec.ts` — fixture и общие пути.
- `harness/bin/profile` — `workflow.e2e_lock`; `harness/bin/wave-gate` — кто берёт замок e2e.

## Открытые вопросы

- 2 или 3 worker-а: решает замер (нагрузка Mac при gate full, flaky test-ы).
- Идёт ли e2e на Mac параллельно с другими тяжёлыми run-ами очереди — нет, правило «один тяжёлый run за раз»
  остаётся; этот Ticket ускоряет один run.

## Вне скоупа

- Выбор e2e по путям diff — Ticket 13.
- Ускорение отдельных spec-файлов.

## Итог

Ветка `worfy-throughput/17`. `pnpm test:e2e` на macOS идёт в 3 worker-а Playwright: wall e2e 565,3 s → 202–207 s
(−64 %). На других платформах и в CI — 1 worker, как раньше.

**Почему был `workers: 1` и что сделано с каждой причиной.** Изоляция на каждый запуск в коде уже была;
жёсткого конфликта между spec-ами нет.

1. Single-instance lock Electron (`src/main/index.ts:47`) привязан к userData (`src/main/index.ts:42`), а userData —
   это `WORFY_DATA_DIR`, который `launchApp` создаёт через mkdtemp на каждый запуск (`test/e2e/helpers.ts:131`).
   Lock у каждого запуска свой — правки не нужны.
2. `~/.claude` и Harness: `WORFY_CLAUDE_HOME` — тоже mkdtemp (`test/e2e/helpers.ts:132`, `test/e2e/launch-env.ts:62`);
   Harness home и состояние gate лежат внутри него. HOME разработчика только читается
   (`src/main/harness/locate.ts:113`); spec-и терминала задают свой временный HOME. Правки не нужны.
3. Порты: link server берёт порт, который выдаёт ОС, и хранит его в data dir (`src/main/link/service.ts:13`);
   host — loopback, Bonjour выключен (`test/e2e/launch-env.ts:73`). Сервера spec-ов слушают `listen(0)`
   (`test/e2e/browser-layer.spec.ts:50`, `test/e2e/browser-webview-guard.spec.ts:47`). Правки не нужны.
4. Временные файлы: папки spec-ов — mkdtemp; сокеты terminal и shell-integration — mkdtemp на запуск
   (`src/main/terminal/shell-integration.ts:43`); снимки `test-results/e2e/snapshots/<имя>` не пересекаются
   по именам. Правки не нужны.
5. `gh` и сеть: заглушка gh (`test/e2e/launch-env.ts:65`), `GH_STUB_DIR` и `GH_STUB_LOG` у каждого spec-а свои.
6. Fixture-репозитории только копируются в scratch (`cpSync`); `test/fixtures` не меняется.
7. Global setup и teardown нет; reporter (`test/e2e/helpers.ts:417`) удаляет файлы по пути из attachment.
8. Процессы убиваются только по pid (`test/e2e/end-app.ts`, `test/e2e/terminal.spec.ts:55`), без `pkill` по имени.
9. Замок `/tmp/worfy-e2e.lock` берёт оболочка один раз на весь run (`rules.md`, `harness/bin/wave-gate`),
   внутри Playwright его нет — так и остаётся.
10. Настоящая причина — нагрузка: несколько Electron, запущенных одновременно, не успевали открыть первое окно
    (`docs/lessons/agents.md:46`). Число worker-ов выбрано замером, см. ниже.
11. Риски, которые замер не показал: тесты с бюджетом времени (`test/e2e/edges.spec.ts:227` — 100 ms;
    `external-session.spec.ts:155`, `card-runtime.spec.ts:124`, `linked-cards.spec.ts:258`,
    `epic-frame.spec.ts:335` — 1000 ms; `tidy-up.spec.ts:256` — 2000 ms; `browser-layer.spec.ts:514,530` — отставание
    не больше 1 кадра) и `linked-notify.spec.ts:25` без тихих окон. Все зелёные во всех 5 run-ах.

**Что изменено.** `playwright.config.ts` — `workers: process.platform === 'darwin' && !process.env.CI ? 3 : 1` с комментарием о замере (3 мерили только на Mac
владельца; runner-ы CI, в том числе ручной job `full-macos`, остаются в 1 worker, пока их не измерят);
`fullyParallel: false` остаётся (spec-и держат состояние между своими test-ами). `package.json` — `test:package`
передаёт `--workers=1`: packaged run в несколько worker-ов не мерили. `scripts/test-timings.mjs` — комментарий;
`test/unit/test-timings.test.ts` — test на отчёт двух worker-ов.

**Замер на Mac, 2026-10-21**, `pnpm test:e2e --workers=N`, по одному под замком, Mac без других тяжёлых run-ов;
wall — `stats.duration` JSON-отчёта:

| run | worker-ы | wall | passed / failed / flaky | exit code |
| --- | --- | --- | --- | --- |
| до (Ticket 10) | 1 | 565,3 s | — | — |
| 1 | 2 | 292,4 s | 287 / 0 / 0 | 0 |
| 2 | 3 | 207,2 s | 287 / 0 / 0 | 0 |
| 3 | 3 | 201,9 s | 287 / 0 / 0 | 0 |
| 4 | 3 | 203,1 s | 287 / 0 / 0 | 0 |
| 5 | 3 | 201,6 s | 287 / 0 / 0 | 0 |

retries — 0, поэтому любой нестабильный test был бы красным. После run-ов Electron из worktree не осталось.
Замер шёл с флагом `--workers=N`; значение из конфига без флага первым проверит gate full этого PR.

**Ticket 10.** `node scripts/test-timings.mjs` читает JSON-отчёт run-а в 3 worker-а: «88 files, the run took
201.9 s», сумма файлов 587,2 s — exit code 0.

**Windows (ADR-0056).** Вердикт не нужен: на Windows `workers` остаётся 1, `test:package` с `--workers=1` совпадает
с прежним значением по умолчанию; на ПК ничего не меняется.
