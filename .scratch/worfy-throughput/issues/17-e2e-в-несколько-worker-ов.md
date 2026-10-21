# 17 — e2e в несколько worker-ов Playwright: последовательный e2e больше не 73 % gate full

Type: task
Status: open
Blocked by: —
Source: замер Ticket-а [10](10-время-шагов-gate-и-test-файлов.md) после Ticket-а [16](16-shell-test-ы-harness-параллельно.md)
(gate full на `main` `9f9529c9`, 2026-10-21); предложение Session «Worfy продолжение» (очередь gate full на Mac).
Приоритет — за владельцем: gate full 12,9 min уже в бюджете Q2 (15 / 30 min), выигрыш — пропускная
способность очереди gate full на одном Mac и запас бюджета.

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

- [ ] В «Итог» — список причин `workers: 1` с `file:line` и что с каждой сделано.
- [ ] `pnpm test:e2e` идёт в N worker-ах (N по замеру, 2 или 3), wall e2e на Mac записан до (565,3 s) и после.
- [ ] 3 полных e2e run-а подряд green без повторов и без нового flaky test.
- [ ] Ticket 10: JSON-отчёт e2e и `scripts/test-timings.mjs` работают с несколькими worker-ами.
- [ ] Вердикт Windows (ADR-0056), если меняется то, что идёт на ПК; иначе — сказано, почему не нужен.

## Где в коде

- `playwright.config.ts` — `workers`, `fullyParallel`.
- `test/e2e/helpers.ts` — `launchApp`, userData, окружение запуска Electron.
- `test/e2e/*.spec.ts` — fixture и общие пути.
- `harness/bin/profile` — `workflow.e2e_lock`; `harness/hooks/gate.mjs` — как gate берёт замок e2e.

## Открытые вопросы

- 2 или 3 worker-а: решает замер (нагрузка Mac при gate full, flaky test-ы).
- Идёт ли e2e на Mac параллельно с другими тяжёлыми run-ами очереди — нет, правило «один тяжёлый run за раз»
  остаётся; этот Ticket ускоряет один run.

## Вне скоупа

- Выбор e2e по путям diff — Ticket 13.
- Ускорение отдельных spec-файлов.

## Итог

(заполняет implementer)
