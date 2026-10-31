# 02 — `install-stable` ждёт выхода копии, хранит прежнюю как `worfy-stable.previous` и откатывает

Type: task
Status: open
Blocked by:
Source: решения владельца 2026-10-31, пункты 3 (та же сборка, что `pnpm install:stable`), 6 (сбой — текущая копия остаётся), 9 (одна прежняя копия `worfy-stable.previous`, откат); [spec.md](../spec.md), «Решено без владельца», Р7, Р8; [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md), пункт 4; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2

## Что происходит

- `scripts/install-stable.mjs` собирает или берёт готовую сборку (`WORFY_STABLE_PREBUILT`, `:723`),
  копирует её рядом с целью и меняет местами (`swapIn`, `:263`). Прежнюю копию удаляет (`:804-811`).
- Пока копия запущена, скрипт отказывается (`refuseIfRunning`, `:711-720`; список процессов —
  `runningCopies`, `:132`). Ждать выхода он не умеет.
- После замены на macOS копия регистрируется в Launch Services (`registerCommand`, `:291`); итог —
  строка в stdout, сбой — код выхода 1.
- Файл один и без своих import-ов: test копирует его в другой репозиторий (`:34-35`). Функции, которые
  зависят от системы, принимают её параметром (`test/unit/install-stable-functions.test.ts`).
- Отметку `deploy` ставит `markDeploy` (`:322`); с `WORFY_STABLE_PREBUILT` строки нет (`:319`).

## Что делаем

1. Флаг `--wait-pid <pid>`: до проверки `refuseIfRunning` ждать, пока процесса `pid` нет, не дольше
   120 s (опрос раз в 500 ms); не дождался — отказ с кодом 1 и причиной, ничего не тронуто.
2. Флаг `--keep-previous`: прежняя копия после замены не удаляется, а переносится в
   `<папка цели>/worfy-stable.previous` (одно имя на обеих платформах), её `<target>.json` — в
   `worfy-stable.previous.json`. Старая `worfy-stable.previous` удаляется до переноса. Без флага — как
   сейчас (ручной `pnpm install:stable` удаляет прежнюю, Р8).
3. Флаг `--rollback`: `worfy-stable.previous` становится копией, копия, с которой откатились, и её файл
   удаляются (Р8). Нет `worfy-stable.previous` — отказ с кодом 1, ничего не тронуто. Сбой посередине —
   прежнее состояние восстанавливается, как у `swapIn`.
4. Флаг `--relaunch`: после успеха и после отказа запустить то, что стоит в цели: macOS — `open <target>`,
   Windows — `<target>\worfy.exe`, detached. Программа запуска подменяется `WORFY_STABLE_LAUNCH` (как
   `WORFY_STABLE_LSREGISTER` для test-ов).
5. Флаг `--result <file>`: JSON `{ ok, action: 'install' | 'rollback', commit, previous, reason?, notes }`
   пишется последним шагом — и при отказе.
6. С `--keep-previous` и `--rollback` `markDeploy` не зовётся (Р7).
7. Новые функции — с параметрами системы, как остальные; файл по-прежнему без import-ов.

## Готово, когда

- [ ] Unit test: `--wait-pid` живого дочернего процесса — ждёт и ставит после его выхода; процесс не
      выходит — отказ по таймауту (время в test-е подменено), цель не тронута.
- [ ] Unit test: `--keep-previous` — после замены есть новая копия, `worfy-stable.previous` с прежней и
      оба файла `.json`; вторая замена удаляет первую прежнюю.
- [ ] Unit test: `--rollback` — прежняя на месте цели, `worfy-stable.previous` нет; без прежней — код 1.
- [ ] Unit test: сбой переименования посередине отката (подменённый `rename`) — копия и прежняя на своих
      местах.
- [ ] Unit test: `--relaunch` зовёт программу из `WORFY_STABLE_LAUNCH` с путём цели, и после отказа тоже.
- [ ] `--result` пишет JSON при успехе и отказе; без флагов поведение и вывод прежние (существующие test-ы
      `install-stable` зелёные без правок).
- [ ] Все пути — во временной папке; test, который получил бы путь в `~/Applications` или
      `%LOCALAPPDATA%`, падает.
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0086): вердикт Windows по
      `scripts/windows-verdict-scope.mjs` — `runner`: зелёный Windows job `ci-ok`; `pc`: gate full на ПК на
      `main` после Wave.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/install-stable-update.test.ts` (новый): флаги во временной папке, подменённые
  `rename`, список процессов, программа запуска.
- Unit `test/unit/install-stable-functions.test.ts`: новые функции ожидания и имён.
- Сначала падающий: `--keep-previous` — после замены `worfy-stable.previous` нет.

## Где в коде

- `scripts/install-stable.mjs` (`:711-720`, `:723`, `:263`, `:804-811`, `:322`)
- `test/unit/install-stable-functions.test.ts`
- `test/unit/install-stable-update.test.ts` (новый)

Только читать: `test/unit/install-stable.test.ts`, `test/unit/install-stable-harness.ts`.

## Итог

Заполняется при закрытии.
