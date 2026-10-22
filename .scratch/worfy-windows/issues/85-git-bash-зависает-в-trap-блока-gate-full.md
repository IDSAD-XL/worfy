# 85 — Git Bash зависает в EXIT trap блока gate full из `epic-wave`: `wait $HB` без предела

Type: bug
Status: open
Blocked by: —
Source: Session на ПК владельца, 2026-10-21: зависание на 2 часа в одном прогоне из семи. Номер 84 занят PR #710.

## Что происходит

Блок gate full одного PR в `harness/skills/epic-wave/SKILL.md:933` берёт замок e2e и запускает heartbeat — фоновый
subshell, который раз в 5 минут трогает папку замка (`HB`). EXIT trap блока останавливает его: `kill -STOP $HB`, цикл
ожидания по `ps -o stat=`, `pkill -P $HB`, `kill -KILL $HB`, `kill -CONT $HB`, затем `wait $HB` без предела времени.

Под Git Bash на Windows heartbeat иногда остаётся жив, и `wait $HB` не возвращается. Так повис test
`harness/bin/tests/wave-gate.test.sh:774` («the one-PR gate full block: an abandoned lock is removed with its
holder.json and taken»): 2 часа, 1 из 7 прогонов. В Git Bash нет `pkill`, а `ps` из MSYS не знает `-o stat=`, так что
эта часть trap-а на Windows ничего не делает.

## Что делаем

1. Воспроизвести под Git Bash: прогнать этот случай `wave-gate.test.sh` в цикле и найти, какой шаг оставляет heartbeat жить.
2. Ограничить `wait` по времени: ждать в цикле `kill -0 $HB` с пределом (например, 2 s), потом идти дальше. На
   Windows — запасной `taskkill //F //T //PID <winpid>` (pid Windows — из `/proc/$HB/winpid`), если `kill` не помог.
3. Тот же текст trap-а — в копиях блока (skills и test, который его вырезает), чтобы они не разошлись.

## Готово, когда

- [ ] Случай `wave-gate.test.sh:774` под Git Bash проходит 30 раз подряд, без зависания.
- [ ] Trap на macOS и Linux ведёт себя как прежде: test-ы `wave-gate.test.sh` и `agents-text.test.sh` — exit 0.
- [ ] Gate full на ПК и на Mac — зелёные.

## Где в коде

- `harness/skills/epic-wave/SKILL.md:933` (EXIT trap блока gate full одного PR)
- `harness/bin/tests/wave-gate.test.sh:774`
- `harness/bin/tests/wave-gate-heartbeat.test.sh` (`stop_tree`, случай «40 runs»)

## Риски

- Платформенный PR (ADR-0056, пункт 2): трогает скрипт Harness и ветку для Windows. Нужен gate full на ПК и Mac gate.

## Результат

**Причина.** Зависает `wait $HB`, а держит его `kill -STOP`. В Git Bash `kill -KILL`, отправленный сразу после
`kill -STOP`, иногда оставляет heartbeat живым и глухим ко всем сигналам: ни `kill -CONT`, ни повторный `kill -KILL`,
даже из другого shell, его не завершают. Завершает только `TerminateProcess` Windows (`/usr/bin/kill -f -9 <pid>`).
`ps -o stat=` и `pkill` в Git Bash ничего не делают (у `ps` MSYS нет `-o`, `pkill` нет), но зависания не вызывают.

Замеры на ПК владельца (Windows 11, Git Bash 5.2.26, MSYS 3.4.10): trap блока из `SKILL.md` в цикле, gate заменён на
`true` или `sleep 0.3`, каждый прогон ограничен `timeout 15`:

| Вариант trap-а | Прогонов | Зависло |
| --- | --- | --- |
| старый trap, gate `true` | 5 + 30 | 1 + 2 |
| старый trap, gate `sleep 0.3` | 30 | 6 |
| `kill -STOP; kill -KILL; kill -CONT; wait` | 40 | 16 |
| `kill -KILL; wait`, без STOP | 40 | 0 |
| новый trap, gate `true` | 40 + 30 | 0 |
| новый trap, gate `sleep 0.3` | 30 | 0, ни одного `sleep` heartbeat не осталось |
| новый trap со вставленным STOP (мутант) | 40 | 0: запасной `kill -f` завершил зависший heartbeat, прогон — до 8,5 s |

После зависших прогонов heartbeat-ы были живы и после внешних `kill -CONT` и `kill -KILL`. `kill -f -9` их снял.

**Исправление.** Если у heartbeat есть `/proc/<pid>/winpid` (Cygwin/MSYS), trap не шлёт STOP. Он находит детей
heartbeat через `/proc/*/ppid` и шлёт `kill -KILL` heartbeat-у, а его `sleep` — TERM. Потом ждёт не больше 2 s
(`kill -0` раз в 0,1 s), через 1 s завершает heartbeat через Windows (`/usr/bin/kill -f -9`) и делает `wait`, только
когда процесса уже нет. Уведомление о job в цикле ожидания уходит в `/dev/null`. На macOS и Linux текст trap-а прежний.
Ограничение: `sleep`, который trap застал ещё на старте, может пропустить сигнал и доспать свои 5 минут, вывод — в
`/dev/null`. До правки в Git Bash так оставался каждый `sleep` heartbeat.

**Test-ы.**
- `wave-gate-heartbeat.test.sh`: случай «40 runs» теперь идёт и в Git Bash, раньше пропускался: нет `pkill`. Каждый
  прогон ограничен 15 s, и случай проверяет, что ни один shell heartbeat не пережил свой прогон. На старом trap-е
  (`SKILL_FILE` = копия `SKILL.md` до правки) случай красный: «36 of 40 runs green, 4 cut off after 15 s», файл —
  exit 1. `stop_tree` в Git Bash не шлёт STOP.
- `wave-gate.test.sh`: два прогона блока одного PR ограничены 60 s через `finish`; оставшийся живой heartbeat — FAIL.

Проверки на ПК после rebase на `origin/main` (свежий HOME, GitHub CLI вне PATH): `wave-gate-heartbeat` — exit 0,
6 passed; `wave-gate` — exit 0, 133 passed; `wave-gate-lock` — exit 0, 14 passed; `agents-text` — exit 0, 202 passed;
`skill-blocks` — exit 0, 100 passed.

## Итог

Заполняется при закрытии.
