# 91 — e3-sandbox `lock-run`: trap heartbeat-а может зависнуть в Git Bash

Type: task
Status: open
Blocked by: —
Source: Ticket 85 (trap блока gate full в `harness/skills/epic-wave/SKILL.md`, ветка `worfy-windows/85`, ещё
не влита), его вопрос ревьюеру про `scripts/e3-sandbox.sh:399`, 2026-10-22. Строки — по main `021ac754`.

## Что происходит

`scripts/e3-sandbox.sh lock-run` держит общий замок Electron-прогонов (папка `$LOCK`) и фоновый heartbeat —
subshell, который раз в 5 минут делает `touch -c` замка (`:392`). EXIT trap (`:399`) снимает heartbeat так:
`kill -STOP`, ожидание `ps -o stat=` до 2 с, `pkill -P`, `kill -KILL`, `kill -CONT`, `wait`, `rmdir`.

Комментарий `:397` говорит, что `kill -CONT` после `kill -KILL` не даёт остановленному процессу повесить
`wait`. Ticket 85 опроверг это на ПК: в Git Bash `kill -KILL` сразу после `kill -STOP` иногда оставляет
процесс живым и глухим к любым сигналам, в том числе к `kill -CONT` и `kill -KILL` из другого shell-а;
кончает его только `/usr/bin/kill -f -9` (TerminateProcess Windows). Тогда `wait` не возвращается
никогда. Замер Ticket-а 85: STOP; KILL; CONT; wait — 16 зависаний из 40, KILL; wait без STOP — 0 из 40.

Ещё два дефекта того же места:

- В Git Bash нет `pkill` и `ps -o`: `sleep 300` heartbeat-а переживает каждый прогон `lock-run`.
- Heartbeat кончается, только когда папки замка нет. Если скрипт убит без trap-а (`kill -9`, timeout
  Bash-вызова), замок остаётся, и heartbeat держит брошенный замок свежим вечно: никто его не возьмёт.

## Что делаем

1. Подтвердить зависание настоящим trap-ом `e3-sandbox.sh`, не только моделью Ticket-а 85.
2. Перенести образец Ticket-а 85 (`SKILL.md` ветки `worfy-windows/85`, `:911–936`): только там, где у
   heartbeat-а есть `/proc/<pid>/winpid`, — без STOP; `kill -KILL` heartbeat-а, его дети по
   `/proc/[0-9]*/ppid` — через `/usr/bin/kill -f -9`, ожидание heartbeat-а не дольше 2 с, `kill -f` после
   1 с, `wait` — только когда его нет. Ветка macOS и Linux — без изменений.
3. Heartbeat кончается, когда умер его shell (`kill -0 $$`). Проверка владельца — только если замок
   записывает владельца или это дёшево и согласовано.
4. Исправить комментарий `:397` и `shortcut:` `:398`.
5. Test, красный на старом trap-е и на мутантах: без `kill -0 $$`, со STOP в ветке Windows, без `kill -f`
   для детей.

## Готово, когда

- [x] Зависание воспроизведено настоящим trap-ом `e3-sandbox.sh` на ПК; причина записана в «Итог».
- [x] В Git Bash trap не шлёт STOP, кончает детей heartbeat-а через Windows и ждёт heartbeat не дольше 2 с;
      ветка macOS и Linux — та же последовательность команд, что на main.
- [x] Heartbeat кончается со своим shell-ом: после `kill -9` скрипта замок не держится свежим.
- [x] Test в `test/contract/e3-sandbox.test.ts` идёт и на Windows: 40 прогонов, каждый не дольше 15 с, без
      оставшихся shell-ов и `sleep` heartbeat-а; красный на старом коде и на трёх мутантах.
- [x] `pnpm exec tsc -p tsconfig.test.node.json --noEmit`, eslint файла test-а, `check-cyrillic`,
      `gate fast` — exit 0.
- [ ] manual: те же test-ы на Mac (`## Mac checks` PR).

## Где в коде

- `scripts/e3-sandbox.sh:389–399` (`lock_run`: heartbeat, комментарии, EXIT trap).
- `test/contract/e3-sandbox.test.ts` (верх файла: `sandboxEnv`, `sandbox`, `stubCommand`; describe
  `e3-sandbox.sh lock-run`; новый describe в конце файла).

## Итог

Причина подтверждена настоящим trap-ом `e3-sandbox.sh`: это та же глухота процесса после `kill -STOP` и
`kill -KILL` в Git Bash, что в Ticket-е 85, только реже.

- **Воспроизведение.** `lock-run` в цикле на копии `scripts/e3-sandbox.sh` с main, каждый прогон не дольше
  15 с, команда под замком — `sleep 0.3` (heartbeat уже в своём `sleep 300`): зависли 7 прогонов из 390.
  В одном из них heartbeat пережил внешние `kill -KILL` и `kill -CONT`, а его `/proc/<pid>/cmdline` не
  читался; кончил его только `/usr/bin/kill -f -9`. Три глухих heartbeat-а от прогонов воспроизведения
  жили как `bash.exe` ещё 30–45 минут, пока я не снял их через `kill -f`. Реже, чем 16 из 40 у Ticket-а 85,
  потому что между STOP и KILL в этом trap-е стоят запуски `ps` и `grep` и поиск `pkill` по PATH.
- **Остальное на main.** В Git Bash нет `pkill` и `ps -o`: каждый прогон оставлял `sleep 300` heartbeat-а
  (40 из 40). Heartbeat скрипта, убитого `kill -9`, продолжал трогать оставшийся замок.
- **Правка `scripts/e3-sandbox.sh`, `lock_run`.**
  - Trap: если у heartbeat-а есть `/proc/<pid>/winpid` (Git Bash, Cygwin), — без STOP: дети heartbeat-а
    по `/proc/[0-9]*/ppid`, `kill -KILL` heartbeat-а, дети — через `/usr/bin/kill -f -9`, ожидание до 2 с,
    `kill -f` heartbeat-а после 1 с, `wait` — только когда его нет. Вся ветка в `{ …; } 2>/dev/null || true`,
    так что `set -e` не обрывает trap до `rmdir`.
  - Иначе (macOS, Linux) — та же последовательность команд, что на main, символ в символ; новое только
    обёртка `if … else … fi` вокруг неё.
  - Heartbeat: `kill -0 $$ 2>/dev/null || exit 0` перед проверкой папки — касается всех платформ.
  - Владельца замок не записывает (`holder.json` нет, только `mkdir`), поэтому проверки владельца нет:
    её пришлось бы заводить вместе с форматом замка для всех его пользователей. Это записано в комментарии
    и в `shortcut:`.
  - Комментарии `:397` и `shortcut:` переписаны: что делает каждая ветка и почему, замеры, известные пределы.
- **Test-ы** — новый describe в конце `test/contract/e3-sandbox.test.ts`, он идёт и на Windows (остальной файл
  там по-прежнему пропущен). Процессы смотрит и кончает `bash` (`procs.sh`): pid-ы MSYS не знает
  `process.kill` Node. Лаунчер Git Bash ставит `/usr/bin` первым в PATH, поэтому stand-in-ы снова ставятся
  первыми (`FRONT`). `sandbox()` и `sandboxEnv()` теперь берут `gitBash()` и `path.delimiter`: на macOS это
  те же `bash` и `:`.
  - текстовая проверка: в ветке Git Bash trap-а нет STOP, есть `kill -KILL` и оба `kill -f`;
  - 40 прогонов `lock-run` (команда ждёт старта `sleep` heartbeat-а и работает ещё 0,3 с), каждый не дольше
    15 с: все exit 0, 40 `sleep` heartbeat-а стартовали, не осталось ни shell-а heartbeat-а, ни `sleep`;
  - `kill -9` скрипта: heartbeat кончается за 3 с, хотя замок остался.
- **Красные прогоны.** Старый код: 3 из 3 красные (нет ветки Git Bash; 40 из 40 `sleep` остались, а в первом
  красном запуске файла ещё 2 прогона из 40 зависли; heartbeat пережил скрипт). Мутанты: без `kill -0 $$` — красный
  случай `kill -9`; STOP в ветке Git Bash — красная текстовая проверка (по поведению STOP там не виден:
  ожидание с `kill -f` кончает и глухой heartbeat); без `kill -f` детей — красные текстовая проверка и 40
  прогонов (40 `sleep` осталось).
- **Зелёные прогоны на ПК.** Файл 3 раза подряд (3 passed, 52–61 с); вместе с `no-github-git` и `no-rmsync`
  (22 passed); `tsc -p tsconfig.test.node.json`, eslint файла, `check-cyrillic`, `gate fast` — exit 0.
- Не проверено: Mac и Linux (CI) — новый describe там идёт с той же командой; ветка macOS trap-а там не
  менялась.
