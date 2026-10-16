# 55 — `test/contract/e3-sandbox.test.ts` на Windows оставляет в `%TEMP%` папки по 340 MB: песочница приёмки macOS там не поддерживается

Type: task
Status: done — 2026-10-16, [PR #390](https://github.com/IDSAD-XL/worfy/pull/390)
Blocked by: —
Source: Session на Windows-ПК «Worfy тесты на ПК», найдено при прогонах `pnpm test` ночью
2026-10-16 (Ticket-ы 51 и 53): на диске C осталось 4.9 GB, в `%TEMP%` — 68 папок
`worfy-e3-sandbox-test-*` на 20 GB. Решение Session на Mac 2026-10-16: вариант (c) — файл
пропускается на `win32`; варианты (a) и (b) не делаем; вопросы про `removeTree` и `spawnSync` — в
«Вне скоупа».

## Что происходит

- **`scripts/e3-sandbox.sh` — песочница приёмки macOS-приложения.** Она берёт per-user temp dir из
  `getconf DARWIN_USER_TEMP_DIR`, ставит ссылку на keychain в `~/Library/Keychains`, запускает
  login shell-ы zsh. На Windows этого нет, и 38–39 из 57 test-ов файла падают по существу.
- **Каждый test делает папку `%TEMP%\worfy-e3-sandbox-test-XXXXXX`** (`beforeEach` верхнего уровня)
  и удаляет её в `afterEach` через `removeTestTree`.
- **Под Git Bash `ln -s` копирует файл** (без `MSYS=winsymlinks`). `init` кладёт в `tools/` копии
  `claude` (248 MB) и `node` (89 MB), поэтому скрипт медленный, а папка test-а весит до 343 MiB.
- **По timeout-у 10 s `spawnSync` убивает только `bash.exe`** (TerminateProcess одного процесса).
  Его дочерние процессы живут дальше с cwd в папке test-а.
- **`removeTree` (`src/main/storage/remove.ts`) на Windows сначала зовёт `rmdir` верхней папки.**
  Занятая папка даёт `EBUSY`; после 5 повторов через 100 ms ошибка бросается, и не удаляется ничего
  — ни копии, ни остальное. `afterEach` падает, но ошибка теряется среди остальных падений файла.

Замеры на Windows-ПК:

| Что | Число |
|---|---|
| Файл один, из Git Bash, main | 39 failed, 18 passed из 57; новых папок 0 |
| Пять полных `pnpm test` ночью 2026-10-16 | 2, 6, 6, 3, 9 папок с `EBUSY … rmdir` в log-е; 19 из 26 до сих пор в `%TEMP%` |
| Папки сейчас | 68 папок, 20 845 MiB, самая большая 343 MiB |

## Что делаем

1. Пять `describe` верхнего уровня файла — `describe.skipIf(NOT_ON_WINDOWS)`, где
   `NOT_ON_WINDOWS = process.platform === 'win32'`. Причина — в комментарии в начале файла. С
   пропущенными test-ами hook-и верхнего уровня не запускаются, и папка не создаётся.
2. На macOS и Linux прогон не меняется.

## Готово, когда

- [ ] На Windows-ПК из Git Bash `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts`
      — exit 0, 57 skipped, новых папок `worfy-e3-sandbox-test-*` нет.
- [ ] На macOS файл идёт как на main: 57 test-ов, те же passed и skipped.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0; gate full на Mac — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- Новых test-ов нет: правка — пропуск файла на одной платформе. Проверка — прогон файла на
  Windows-ПК (число skipped и папки в `%TEMP%`) и прогон на Mac.

## Где в коде

- `test/contract/e3-sandbox.test.ts`

## Вне скоупа

Кандидаты в отдельный Ticket; решать их — отдельно (решение Session на Mac).

- **`removeTree` сдаётся после `EBUSY` на `rmdir` верхней папки и не удаляет ничего.**
  `src/main/storage/remove.ts`: `goesUnlisted` сначала зовёт `rmdir` верхней папки и читает её
  содержимое только на `ENOTEMPTY`; `EBUSY` повторяется `REMOVE_RETRIES = 5` раз через
  `REMOVE_RETRY_MS = 100` и бросается. Занятая верхняя папка (cwd живого процесса) оставляет на диске
  всё дерево, хотя файлы внутри можно было удалить: 342 MB на каждый упавший test e3-sandbox.
- **`spawnSync` по timeout-у убивает только `bash.exe`.** Node на Windows завершает один процесс;
  дети, запущенные скриптом, живут дальше и держат папку. Замеры той же ночи: после прогонов
  оставались по 19 процессов `bash` без живого родителя (test-ы harness) и один `electron`.
  Касается любого test-а, который запускает shell-скрипт с timeout-ом.
- **68 старых папок `worfy-e3-sandbox-test-*` (20 GB) в `%TEMP%` Windows-ПК.** Удаление — слово
  владельца.
- e3-sandbox на Windows вообще — не поддерживается, отдельного плана нет.

## Итог

- **Правка.** `test/contract/e3-sandbox.test.ts`: константа `NOT_ON_WINDOWS` и
  `describe.skipIf(NOT_ON_WINDOWS)` на пяти `describe` верхнего уровня (`init`, `env and run`,
  `tools`, `reset and reset-harness`, `lock-run`). Test-ов вне этих `describe` в файле нет. Причина
  пропуска — в комментарии в начале файла.
- **Проверки на Windows-ПК, Git Bash** (`command -v bash` → `/usr/bin/bash`, не WSL), ветка после
  rebase на main `0aa5fc05`:
  - `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts` — exit 0, 57 skipped из 57;
    список папок `worfy-e3-sandbox-test-*` до и после одинаковый (68 и 68).
  - До правки, на main: 39 failed, 18 passed из 57.
  - `pnpm lint`, `pnpm typecheck` — exit 0.
- **На macOS** прогон не меняется: `NOT_ON_WINDOWS` там `false`. Проверяет Session на Mac.
- **В этом PR же** — Ticket 51 отмечен done (PR #389) и его «Итог» дописан пунктом Merge, по
  просьбе Session на Mac.
- **Merge.** PR #390 влит 2026-10-16, squash `4089c03e`. Проверки Session на Mac:
  - `gate full` на head `7051b9bf` (база `34aee14a`) — exit 0, `[gate] зелено (full)`. Три прогона
    до него были красные только от нагрузки: каждый раз другие contract test-ы и один e2e, все
    зелёные по отдельности; это теперь worfy-polish 30.
  - `e3-sandbox.test.ts` отдельно (локальный прогон 2026-10-16 до merge) — 57 passed, 0 skipped,
    как на main: `skipIf` срабатывает только на Windows.
  - Linux CI — зелёный.
