# 112 — Два contract test-а красные на Windows-ПК: закрытие Git Bash при ошибке `kill()` и быстрый перезапуск Orchestrator

Type: task
Status: claimed 2026-10-23T15:06Z
Branch: worfy-windows/112
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

## Итог

Ветка `worfy-windows/112` от main `0c4789b7`, ПК владельца (Windows 11, экран 150 %), 2026-10-23.

**До правки** (`node scripts/vitest-electron.mjs` обоих файлов, 3 прогона подряд): код 0, 0, 1.
Красный — `kill() of the pty throws` в прогоне 3: `the launcher 61612: expected true to be false`.
`orchestrator-relaunch` — зелёный во всех трёх.

### 1. `terminal-git-bash-close`: «the launcher …: expected true to be false»

Замер — временной probe-test (в ветку не вошёл) с отметками времени на каждом шаге закрытия, 6
прогонов: `endDescendants` 1,0–1,2 s → `kill()` бросает → `endShell` (PowerShell, конец лаунчера по
pid) отвечает через 840–900 ms → exit от node-pty через 35–45 ms после этого → close разрешается,
лаунчер мёртв. Тот же probe с `endShell`, запущенным на 1,5 s позже: exit от node-pty приходит
через 1005–1010 ms после `kill()`, close разрешается, лаунчер жив (`alive true`), и только потом
`endShell` его убивает.

Причина — в продукте. Когда `kill()` бросает, `release()` (`src/main/terminal/pty.ts`) запускал
`endShell` без ожидания и сразу останавливал поток чтения вывода (`stopOutputWorker` → `dispose()`
conout-соединения node-pty). node-pty закрывает этот сокет через `FLUSH_DATA_INTERVAL` = 1000 ms
(`node_modules/node-pty/lib/windowsConoutConnection.js`, `_drainDataAndClose`) и тогда сообщает exit
— есть лаунчер или нет. `close()` ждал только exit. Запас был ~100 ms: PowerShell `endShell` чуть
медленнее 1 s (нагрузка) — и close отвечал при живом приостановленном лаунчере. Продукт его всё же
убивал, но позже ответа close, вопреки обещанию `close()` «resolves once it has exited».

Правка: `release()` кладёт обещание конца лаунчера в `Terminal.launcherEnd` (ошибка `endShell` —
только предупреждение, как раньше), `close()` после `terminal.exited` ждёт и его. Ожидание ограничено
собственным лимитом `endShell` (`DESCENDANTS_TIMEOUT_MS`, таймаут `execFile`).

Тесты: unit `test/unit/terminal-git-bash-close.test.ts` — два новых («exit сообщён до конца
лаунчера: close ждёт, пока `endShell` ответит / упадёт»), до правки красные оба (`closed` уже
`true`), после — зелёные. Contract — новый test рядом с `:141`: `kill()` бросает, `endShell`
стартует на 1,5 s позже exit-а node-pty; без правки он красный каждый раз, с правкой зелёный.
Мутант «убрать `await terminal.launcherEnd`»: красные 3 test-а (два unit и новый contract,
`the launcher 99644: expected true to be false`).

Вторая ошибка (`expected '\u001b[1t\u001b[?1004h\u001b[?9001h' to match /ready-42\r?\n/`) — не этот
test и не продукт. В журнале `units-wt791.log` (полный `pnpm test`, 1591 s, 12 красных файлов) с
этой ошибкой упали все Git Bash test-ы файла, а строки `[first41]` показывают первую команду каждого
Git Bash test-а 5000–5019 ms (`ok:false`); в `units-wt95main.log` — 4348–5018 ms. Тихо (probe выше)
приглашение bash приходит через 0,85–1,7 s после open. То есть Git Bash под нагрузкой полного
прогона не печатает приглашение за 5 s ожидания `h.run` (`terminal-harness.ts:300`). Ожидание по
правилу владельца не менялось; если этого мало, это общий множитель, и он — решение владельца
(worfy-polish 41).

### 2. `orchestrator-relaunch`: «expected 1782 to be less than 1000»

Тихо не воспроизвелось: 8 прогонов, разложение (временная печать событий stub-а, в ветку не вошла):
SIGTERM старому процессу на 0–1 ms после запроса, exit старого на 19–21 ms, запрос нового процесса
у factory на exit + 0–1 ms, `spawn` нового на exit + 11–13 ms. Под нагрузкой (16 процессов
`node`, крутящих цикл, на 16 логических CPU; 7 прогонов): SIGTERM на 0–1 ms, exit старого на
84–598 ms, factory на exit + 0–1 ms, spawn на exit + 18–21 ms. Единственный журнал с 1782 ms —
полный `pnpm test` (`units-wt791.log`); в `units-wt95main.log` test зелёный.

Причина — в test-е: он мерил от запроса, то есть вместе со временем, за которое Windows завершает
старый процесс и Node узнаёт о его exit. Продукт этого ждать обязан (ADR-0064), и это время растёт с
нагрузкой; сам перезапуск добавляет 11–21 ms. Опроса, задержки или поиска процесса между exit и
новым spawn нет. Правка — test мерит от exit старого процесса, как его слышит worfy, порог тот же
(`LIMIT_MS / 5`); проверка «spawn не раньше exit» осталась.

Мутант: 1 s ожидания в `Session.exited` после exit (`src/main/agent/session.ts`) — test красный
(`expected 1026 to be less than 1000`; заодно красный `answers at once for a Session without a
process`).

### После правки

- Оба файла, 3 прогона подряд: код 0, 0, 0 (14 passed, 2 skipped).
- Unit: 9 файлов terminal + `no-rmsync` — код 0 (253 passed). Contract: `terminal-windows`,
  `terminal`, `terminal-profile-isolation`, `terminal-cursor`, `terminal-screen` — код 0 (99 passed,
  3 skipped).
- `pnpm lint` 0, `pnpm typecheck` 0, gate fast 0 (`[gate] green (fast)`).
- История PowerShell и `.bash_history` до и после — без изменений (192671 байт `840D3CB4…`, 9730 байт
  `64FF7999…`).

### Ревью, круг 1

1. (блокирующее) Мера «от exit старого процесса» не ловила перезапуск, который ждёт до закрытия
   старой Session (например, SIGTERM на 4,9 s позже). Теперь stub (`test/contract/claude-process-stub.ts`)
   в `close()` своего query пишет момент SIGTERM в отдельное поле `terminated`, не в `events`, —
   `order()` тот же. Test проверяет два отрезка, каждый меньше прежнего `LIMIT_MS / 5`: запрос →
   SIGTERM и exit старого → spawn нового; время SIGTERM → exit (система) не входит ни в один,
   `added >= 0` остался. Замер (временная печать, в ветку не вошла): тихо, 3 прогона — запрос →
   SIGTERM 0–1 ms, exit → spawn 11–12 ms, SIGTERM → exit 17–19 ms; под нагрузкой 16 процессов,
   2 прогона — запрос → SIGTERM 0 ms, exit → spawn 18–24 ms, SIGTERM → exit 116–281 ms. Запрос →
   SIGTERM под нагрузкой далеко от 1 s. Мутант «закрыть старую Session на 1,5 s позже»
   (`src/main/agent/orchestrator.ts`, `relaunch`) — красный (`expected 1503 to be less than 1000`);
   мутант «1 s в `Session.exited` после exit» — по-прежнему красный (`expected 1033 to be less than 1000`).
2. (low) Комментарий у bound в `close()` (`src/main/terminal/pty.ts`) говорил, что после bound никто
   не ждёт; теперь там сказано: close длится не дольше bound плюс `DESCENDANTS_TIMEOUT_MS`, выход из
   приложения обрезает его на `WINDOWS_QUIT_WAIT_MS`. Пределы не менялись.

После круга: `orchestrator-relaunch` 3 прогона — код 0, 0, 0; `terminal-git-bash-close` contract и
unit с `no-rmsync` — код 0 (46 passed); `pnpm lint` 0, `pnpm typecheck` 0, gate fast 0. История
PowerShell и `.bash_history` до и после круга — без изменений.

Попутно: под нагрузкой 16 процессов в `orchestrator-relaunch` краснели и другие test-ы (порядок
`exit 1 SIGTERM` против `SIGKILL`, `spawn 2` раньше `exit 1` в `ignore-term`). Это не test `:131` и
в тихих прогонах не воспроизводится — для worfy-polish 41.

**Ревью, круг 2** (Session на Mac, high, correctness: блокирующих нет). Low: две проверки по отдельности (запрос → SIGTERM и
exit → spawn, каждая < `LIMIT_MS / 5`) пропускали 600 ms до закрытия плюс 600 ms после exit. Теперь с порогом сравнивается их
сумма. Мутант «600 ms до `close()` и 600 ms после exit» в `relaunch` — красный (`expected 1235 to be less than 1000`).
`orchestrator-relaunch` 3 прогона — EXIT 0; lint, typecheck, gate fast — EXIT 0.
