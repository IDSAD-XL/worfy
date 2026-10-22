# 85 — Git Bash зависает в EXIT trap блока gate full из `epic-wave`: `wait $HB` без предела

Type: bug
Status: done 2026-10-22T17:53Z
PR: #738
Blocked by: —
Source: Session на ПК владельца, 2026-10-21: зависание на 2 часа в одном прогоне из семи. Номер 84 занят PR #710.

## Что происходит

Блок gate full одного PR в `harness/skills/epic-wave/SKILL.md:936` берёт замок e2e и запускает heartbeat — фоновый
subshell, который раз в 5 минут трогает папку замка (`HB`). EXIT trap блока останавливает его: `kill -STOP $HB`, цикл
ожидания по `ps -o stat=`, `pkill -P $HB`, `kill -KILL $HB`, `kill -CONT $HB`, затем `wait $HB` без предела времени.

Под Git Bash на Windows heartbeat иногда остаётся жив, и `wait $HB` не возвращается. Так повис test
`harness/bin/tests/wave-gate.test.sh:779` («the one-PR gate full block: an abandoned lock is removed with its
holder.json and taken»): 2 часа, 1 из 7 прогонов. В Git Bash нет `pkill`, а `ps` из MSYS не знает `-o stat=`, так что
эта часть trap-а на Windows ничего не делает.

## Что делаем

1. Воспроизвести под Git Bash: прогнать этот случай `wave-gate.test.sh` в цикле и найти, какой шаг оставляет heartbeat жить.
2. Ограничить `wait` по времени: ждать в цикле `kill -0 $HB` с пределом (например, 2 s), потом идти дальше. На
   Windows — запасной `taskkill //F //T //PID <winpid>` (pid Windows — из `/proc/$HB/winpid`), если `kill` не помог.
3. Тот же текст trap-а — в копиях блока (skills и test, который его вырезает), чтобы они не разошлись.

## Готово, когда

- [ ] Случай `wave-gate.test.sh:779` под Git Bash проходит 30 раз подряд, без зависания. (Прогнан 30 раз, 0 FAIL, см.
  «Результат». На этом ПК он не ловил зависание и на старом trap-е; зависание ловит случай «40 runs» файла
  `wave-gate-heartbeat.test.sh`.)
- [ ] Trap на macOS и Linux ведёт себя как прежде: test-ы `wave-gate.test.sh` и `agents-text.test.sh` — exit 0.
- [ ] Gate full на ПК и на Mac — зелёные.

## Где в коде

- `harness/skills/epic-wave/SKILL.md:936` (EXIT trap блока gate full одного PR)
- `harness/bin/tests/wave-gate.test.sh:779`
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
heartbeat через `/proc/*/ppid`, шлёт `kill -KILL` heartbeat-у и завершает его `sleep` через Windows
(`/usr/bin/kill -f -9`). TERM для `sleep` там не годился: на прогонах с gate `true` в живых оставались 28 `sleep` из 30,
с `kill -f` — 4 из 29. Потом trap ждёт heartbeat не больше 2 s (`kill -0` раз в 0,1 s), через 1 s завершает и его
через Windows и делает `wait`, только когда процесса уже нет. Вся ветка Git Bash идёт под `2>/dev/null`: внешний
`kill -f` иначе печатал уведомление о job («Killed») в 40 прогонах из 40. На macOS и Linux текст trap-а прежний.
Ограничение: `sleep`, который ещё стартует, когда trap работает, может быть ещё не виден в `/proc` и доспать свои 5
минут, вывод — в `/dev/null`. До правки в Git Bash так оставался каждый `sleep` heartbeat.

Heartbeat теперь трогает замок, только пока `holder.json` называет pid его shell, и кончается, когда этого shell
нет (`kill -0 $$`). Heartbeat, переживший свой shell (`kill -9`, вызов Bash, оборванный по timeout, не сработавший
`kill -f`), больше не держит живым ни свой брошенный замок, ни новый замок другого агента. Пока shell жив, heartbeat
сам не кончается, даже если замок перехватили: он только перестаёт его трогать. Поэтому pid heartbeat остаётся его
pid-ом до trap-а, и trap не шлёт сигналы освободившемуся pid. Сам trap от этого не менялся ни на одной платформе.
Ограничение: если pid умершего shell за 5 минут займёт другой процесс, heartbeat будет трогать свой брошенный замок,
пока этот процесс жив.

**Test-ы.**
- `wave-gate-heartbeat.test.sh`, случай «40 runs»: теперь идёт и в Git Bash, раньше пропускался (нет `pkill`). Там
  gate — `sleep 0.3`: heartbeat уже спит, как при настоящем gate full. Каждый прогон ограничен 15 s. Случай требует,
  чтобы все 40 heartbeat-ов стартовали, ни один shell и ни один `sleep` heartbeat не остался и не было уведомлений о
  job. Вне Windows gate по-прежнему `true`.
- Там же новые проверки: ветка Git Bash trap-а без `kill -STOP` (по тексту, на всех платформах); heartbeat трогает
  замок только при своём `holder.json` (по тексту и по поведению: shell блока убит `kill -9`, замок отдан другому
  `holder.json` со старым mtime — heartbeat его не трогает и кончается за 3 s). Pid считается процессом test-а,
  только пока его командная строка — процесс test-а (pid-ы в Git Bash переиспользуются).
- `wave-gate.test.sh`: два прогона блока одного PR ограничены 60 s через `finish`; оставшийся живой heartbeat или
  пустая запись pid heartbeat — FAIL.
- Третий круг, `wave-gate-heartbeat.test.sh`. После `kill -9` shell со своим замком heartbeat кончается за 3 s и
  замок больше не трогает. Heartbeat живого блока трогает свой замок: mtime сдвигается, так что формат `holder.json`
  закреплён поведением. После перехвата замка heartbeat его не трогает, но живёт, пока жив shell. Trap в конце его
  завершает и оставляет чужой замок на месте.
- Мутанты третьего круга, все exit 1:
  - без `kill -0 $$` — 4 FAIL, heartbeat держит свой брошенный замок;
  - `holder.json` с `"pid": %s` — 2 FAIL: heartbeat не тронул свой замок, и 0 из 40 прогонов зелёные;
  - heartbeat кончается при перехвате (код второго круга) — 2 FAIL, heartbeat умер, пока shell жив.
  Новый код — exit 0, 13 passed.

Проверки третьего круга на `origin/main` 021ac754 (свежий HOME, GitHub CLI вне PATH):

| Проверка | Exit | Итог |
| --- | --- | --- |
| `wave-gate-heartbeat` | 0 | 13 passed |
| `wave-gate` | 0 | 133 passed |
| `wave-gate-lock` | 0 | 14 passed |
| `agents-text` | 0 | 202 passed |
| `skill-blocks` | 0 | 100 passed |
| `harness-scripts.test.ts -t "wave-gate\|agents-text\|skill-blocks"` | 0 | 5 passed |
| gate fast | 0 | `[gate] green (fast)`: только lint и typecheck, unit-тесты не шли |

Красный на старом коде (`SKILL_FILE`, свежий HOME): старый `SKILL.md` — exit 1, 4 FAIL (обе проверки текста; heartbeat
тронул чужой замок, mtime 1577829600 → 1792644438; «40 of 40 runs green», но 40 `sleep` из 40 остались). Мутант без
`kill -f` детей — exit 1, 40 `sleep` из 40 остались. Мутант без проверки `holder.json` — exit 1, 2 FAIL. Новый код —
exit 0, 9 passed, ни одного `sleep`.

Случай `wave-gate.test.sh:779` и соседние случаи блока одного PR вырезаны из самого файла и прогнаны 30 раз подряд
(`case774.sh` в scratchpad, по новому миру на повтор; весь файл идёт 500–700 s, 30 прогонов файла не делались): новый
код — 150 passed, 0 failed, 161 s. Старый trap на этом случае тоже прошёл 30 раз из 30 (60 запусков trap-а, 177 s):
на этом ПК случай сам по себе зависание не ловит. Ловит его случай «40 runs» и цикл trap-а из таблицы выше.

## Итог

Заполняется при закрытии.
