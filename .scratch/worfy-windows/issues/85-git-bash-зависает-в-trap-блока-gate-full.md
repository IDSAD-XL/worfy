# 85 — Git Bash зависает в EXIT trap блока gate full из `epic-wave`: `wait $HB` без предела

Type: bug
Status: open
Blocked by: —
Source: Session на ПК владельца, 2026-10-21: зависание на 2 часа в одном прогоне из семи. Номер 84 занят PR #710.

## Что происходит

Блок gate full одного PR в `harness/skills/epic-wave/SKILL.md:926` берёт замок e2e и запускает heartbeat — фоновый
subshell, который раз в 5 минут трогает папку замка (`HB`). EXIT trap блока останавливает его: `kill -STOP $HB`, цикл
ожидания по `ps -o stat=`, `pkill -P $HB`, `kill -KILL $HB`, `kill -CONT $HB`, затем `wait $HB` без предела времени.

Под Git Bash на Windows heartbeat иногда остаётся жив, и `wait $HB` не возвращается. Так повис test
`harness/bin/tests/wave-gate.test.sh:990` («the one-PR gate full block: an abandoned lock is removed with its
holder.json and taken»): 2 часа, 1 из 7 прогонов. В Git Bash нет `pkill`, а `ps` из MSYS не знает `-o stat=`, так что
эта часть trap-а на Windows ничего не делает.

## Что делаем

1. Воспроизвести под Git Bash: прогнать этот случай `wave-gate.test.sh` в цикле и найти, какой шаг оставляет heartbeat жить.
2. Ограничить `wait` по времени: ждать в цикле `kill -0 $HB` с пределом (например, 2 s), потом идти дальше. На
   Windows — запасной `taskkill //F //T //PID <winpid>` (pid Windows — из `/proc/$HB/winpid`), если `kill` не помог.
3. Тот же текст trap-а — в копиях блока (skills и test, который его вырезает), чтобы они не разошлись.

## Готово, когда

- [ ] Случай `wave-gate.test.sh:990` под Git Bash проходит 30 раз подряд, без зависания.
- [ ] Trap на macOS и Linux ведёт себя как прежде: test-ы `wave-gate.test.sh` и `agents-text.test.sh` — exit 0.
- [ ] Gate full на ПК и на Mac — зелёные.

## Где в коде

- `harness/skills/epic-wave/SKILL.md:926` (EXIT trap блока gate full одного PR)
- `harness/bin/tests/wave-gate.test.sh:990`

## Риски

- Платформенный PR (ADR-0056, пункт 2): трогает скрипт Harness и ветку для Windows. Нужен gate full на ПК и Mac gate.

## Итог

Заполняется при закрытии.
