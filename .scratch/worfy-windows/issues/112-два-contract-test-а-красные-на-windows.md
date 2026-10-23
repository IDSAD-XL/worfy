# 112 — Два contract test-а красные на Windows-ПК: закрытие Git Bash при ошибке `kill()` и быстрый перезапуск Orchestrator

Type: task
Status: open
Blocked by: —
Source: пересчёт unit и contract на ПК владельца 2026-10-23 (main `bc19f2f7`; журналы
`C:/Users/Alexey/worfy-wt/units-wt95main.log` и `units-wt791.log` на ПК), решение владельца 2026-10-23 по
отсечке Epic-а. Строки — по main `cf5adbf2`.

## Что происходит

Оба test-а красные и в полном `pnpm test`, и в двух тихих повторах (без другой нагрузки на ПК). Остальные
красные того дня проходят в тихих повторах — они в
[worfy-polish 41](../../worfy-polish/issues/41-flaky-test-ы-windows-после-пересчёта.md).

1. `test/contract/terminal-git-bash-close.test.ts:141` («closing a Git Bash Terminal on Windows when a step
   fails: the suspended launcher is ended > kill() of the pty throws: the launcher is ended by its pid»).
   Красный во всех трёх прогонах, с двумя разными ошибками:
   ```
   the launcher 64872: expected true to be false          (expectNothingLeft, :105)
   expected '\u001b[1t\u001b[?1004h\u001b[?9001h' to match /ready-42\r?\n/
   ```
   Первая: после `kill()`, который бросает исключение, процесс-лаунчер Git Bash жив, хотя должен быть убит по
   pid. Вторая: shell не успел напечатать `ready-42` — на экране только запросы ConPTY.
2. `test/contract/orchestrator-relaunch.test.ts:131` («Orchestrator relaunch waits for the old Claude Code
   process > a process that exits at once: the new one starts with no wait added — well under the limit»),
   `:141`:
   ```
   expected 1782 to be less than 1000
   ```
   Новый процесс стартовал через 1.8 s после запроса, при пороге в пятую часть предела (1 s). Красный в обоих
   тихих повторах.

## Что делаем

Для каждого — сначала причина (замер на ПК), потом правка. Таймаут или порог одного test-а не подбирать
(правило владельца): если test честно требует больше времени, это один общий множитель, и цена называется
заранее.

1. `terminal-git-bash-close`: проверить, убивает ли продукт лаунчер по pid, когда `kill()` бросает, и успевает
   ли — замер списка процессов до и после. Если лаунчер живёт — править продукт. Для второй ошибки — понять,
   почему `ready-42` не пришёл: shell не стартовал или вывод не дошёл.
2. `orchestrator-relaunch`: разложить 1.8 s по шагам (выход старого процесса, обнаружение выхода, запуск
   нового). Если ожидание добавляет продукт (опрос с шагом, задержка) — править продукт. Если это запуск
   процесса на Windows — сказать в «Итог», какой шаг и сколько он стоит.

## Готово, когда

- [ ] Для каждого test-а в «Итог» — замер и причина.
- [ ] На ПК `node scripts/vitest-electron.mjs test/contract/terminal-git-bash-close.test.ts
      test/contract/orchestrator-relaunch.test.ts` — код 0 в 3 прогонах подряд.
- [ ] Мутант на каждую правку — красный.
- [ ] На Mac те же файлы — код 0 (`terminal-git-bash-close` там пропускается целиком).

## Где в коде

- `test/contract/terminal-git-bash-close.test.ts:141` — test, `:104-105` — `expectNothingLeft`.
- `test/unit/terminal-git-bash-close.test.ts:292` — unit-вариант того же случая.
- `test/contract/orchestrator-relaunch.test.ts:131-143` — test, `:141` — порог `LIMIT_MS / 5`.
