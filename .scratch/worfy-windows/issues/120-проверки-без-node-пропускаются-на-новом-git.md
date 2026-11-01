# 120 — проверки «нет node» в shell-тестах пропускаются на новом Git

Type: task
Status: claimed 2026-11-01T04:26Z
Branch: worfy-windows/120
Blocked by: —
Source: решение Orchestrator-а, 2026-11-01, находка проверяющего подтверждена, medium. Платформенный: делает Session на ПК, проверяет и
вливает Mac (ADR-0056).

## Что происходит

`harness/hooks/tests/gate-verdict.test.sh` (§6), `gate-notverified.test.sh` (§10) и `gate-shim.test.sh` проверяют запуск gate на машине без
node. Для этого они собирают PATH без node, в коде он называется `NONODE`. На Windows он был жёстко задан: `/usr/bin:/mingw64/bin`.

В новом Git for Windows вместо `mingw64` папка `ucrt64`: так на GitHub runner. В `/usr/bin` нет `git`, поэтому проверка `! command -v git` в
этом PATH срабатывает, и test пишет строку skip вместо проверок. Test при этом зелёный. В `gate-shim` так пропускается весь блок «без node».

На macOS есть другой пропуск: §6 и §10 не идут, если есть `/opt/homebrew/bin/node` или `/usr/local/bin/node`, потому что `gate.sh` сам
ищет node в этих папках.

## Что делаем

- При `WIN=1` `NONODE` собирается из папки настоящего `git`: `/usr/bin:$(dirname "$(command -v git)")`.
- При `WIN=1` случай «git is not in NONODE» становится красным, а не пропуском: в Git Bash `git` есть всегда, и пропуск спрячет неверный PATH.
- В §6 и §10 на машине с node в этих двух папках запускается копия `gate.sh`, где названия папок заменены на несуществующие; так уже делает
  `gate-shim`. Каждая папка заменяется отдельно, как в `eval-env.test.sh`. Если в копии осталось название папки, test красный; `gate-shim` в этом
  случае раньше пропускал весь блок, теперь тоже красный.
- `gate-shim` убран из таблицы времени Windows в `test/harness-shell-tests.ts`: 7 с там измерены с пропущенным блоком. Теперь он считается как
  неизмеренный (20 с).

`harness/bin/tests/eval-env.test.sh:282` не меняем: он запускает git через `EVAL_GIT`, а не из PATH.

## Готово, когда

- [x] На Git с `ucrt64` все три файла выполняют блок «без node», число проверок то же, что на `mingw64`.
- [x] Неверный `NONODE` при `WIN=1` даёт красный test.
- [x] На машине с `/opt/homebrew/bin/node` или `/usr/local/bin/node` §6 и §10 идут, а не пропускаются. На ПК ветка проверена принудительно;
  на настоящем macOS её покажет Mac.

## Где в коде

- `harness/hooks/tests/gate-shim.test.sh`, `gate-verdict.test.sh` (§6), `gate-notverified.test.sh` (§10).
- `harness/hooks/gate.sh`: поиск node в `/opt/homebrew/bin` и `/usr/local/bin`.
- `test/harness-shell-tests.ts`: таблица времени shell-тестов на Windows.
- Окружение shell-тестов: `emptyHomeEnv` в `test/harness-scripts-suite.ts`.

## Итог

На Windows `NONODE` теперь берёт папку настоящего `git`, а `git` вне этого PATH даёт красный test. На машине с node в `/opt/homebrew/bin` или
`/usr/local/bin` §6 и §10 запускают копию `gate.sh`, которая туда не смотрит.

Прогоны на ПК (Git 2.45 с `mingw64`), число пройденных проверок в `gate-verdict` / `gate-notverified` / `gate-shim`:

| Вариант | Проверок | `gate-shim`, с |
| --- | --- | --- |
| старый код, `mingw64` | 76 / 34 / 99 | 119 |
| старый код, PATH с `/ucrt64/bin`, папки такой нет | 73 / 30 / 8, по одной строке skip | 10 |
| новый код, `mingw64` | 76 / 34 / 99 | 122 |
| новый код, `ucrt64` через junction на `mingw64` | 76 / 34 / 99 | 105 |
| новый код, неверный `NONODE` | exit 1 во всех трёх | 11 |
| новый код, ветка копии `gate.sh` включена принудительно | 76 / 34 / 99 | 126 |
| то же, в копии осталось название папки | exit 1 во всех трёх | 125 |

Настоящего `ucrt64` на ПК нет. Решающая проверка — Windows CI job этого PR: вывод shell-test-а там не виден, поэтому блок виден по времени
`gate-shim` (без блока около 10 с). Git теперь не может отключить блок молча: это красный test. На Windows пропуск остаётся, только если node лежит
в `/usr/bin` или в одной папке с `git`; строка skip об этом честная, но в CI её не видно.

`eval-env.test.sh` не задет: с `/ucrt64/bin` в его PATH те же 46 проверок и те же 11 строк skip, что и с `/mingw64/bin`.

macOS CI: `macos-tests` запускает эти test-ы, вывода shell-test-а в логе нет. Образ ставит node через `brew link`, поэтому
`/opt/homebrew/bin/node`, вероятно, есть, и §6 и §10 там пропускались. Это вывод из скрипта образа, ни один лог путь не называет. Теперь пропуска
нет при любом ответе, но на настоящем macOS эта ветка ещё не выполнялась: на машине с node в этих папках §6 и §10 раньше не шли.
