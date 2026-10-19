# 71 — `.test.sh` Harness-а, красные на Windows после среза 3k Ticket-а 14

Type: bug
Status: open
Blocked by: —
Source: срез 3k Ticket-а 14 (PR #528, `.test.sh` через Git Bash), 2026-10-19. После него
`test/contract/harness-scripts.test.ts` на ПК — exit 1, 8 failed / 30 passed / 2 skipped; причины восьми
файлов в `harness/` и в checkout-е, вне среза. Правка `harness/` — свой PR с Mac gate (ADR-0056). Строки и
счёт — на main `16931520`, ПК, Git Bash, пустой `HOME`, gh вне PATH.

Приоритет — med: пока эти файлы красные, `gate full` на Windows не зелёный (цель Ticket-а 14).

## Что происходит

Каждый файл запускался напрямую (`"/c/Program Files/Git/bin/bash.exe" harness/…/<file>.test.sh`). Причины
ниже проверены на ПК, кроме помеченных «не установлено».

- **CRLF в `harness/agents/` и `harness/skills/`.** `core.autocrlf=true`, а в `.gitattributes` `eol=lf` есть
  только для `harness/bin/*`, `harness/hooks/**`, `*.sh`, `*.mjs`. 13 файлов этих папок в рабочей копии с CRLF;
  test-ы ищут фразы `grep`-ом, и `\r` в конце строки ломает совпадение. Проверка: те же test-ы после
  `sed -i 's/\r$//'` по этим папкам.

  | Файл | как в checkout-е | с LF |
  |---|---|---|
  | `bin/tests/agents-text.test.sh` | 14 failed / 125 passed | 0 failed / 139 passed |
  | `bin/tests/max-review.test.sh` | 10 failed / 68 passed | 3 failed / 75 passed |
  | `bin/tests/review-depth.test.sh` | 7 failed / 98 passed | 6 failed / 99 passed |

- **`match` реестра в написании MSYS.** Test-ы строят временную папку как `T="$(cd "$(mktemp -d)" && pwd -P)"`
  — в Git Bash это `/tmp/tmp.…` — и пишут её в `match` реестра. `bin/profile` получает корень от git или node
  как `C:\Users\…\Temp\tmp.…` и не находит запись: exit 3 «is not in a registered project». С
  `match` из `pwd -W` (`C:/Users/…/Temp/tmp.…`) — exit 0 (проверено отдельным скриптом на одном репозитории).
  - `bin/tests/review-depth.test.sh` — оставшиеся 6: «profile: review.depth.wave / first_round /
    later_rounds is read» и соседние.
  - `hooks/tests/guard-silent.test.sh` — 28 failed / 27 passed: режим Silent не узнан, guard отвечает `allow`
    вместо `deny` («silent: git commit -m with Ticket 05 -> deny … got: allow»).
- **Ожидаемые строки в написании MSYS.** `bin/tests/project-connect.test.sh`: команды выходят с кодом 0, а
  сравнение stdout падает — test ждёт `$HARNESS_HOME/…` (`/tmp/…`), `bin/profile` печатает `C:\…`
  («the written workflow.folder is the default folder: exit 0 (want 0); stdout: C:\Users\…\projects\sho…»).
  Ещё пять таких же (`--facts`, `--check`, Silent draft, exclude file).
- **`bin/tests/ticket-mark.test.sh`, 1 failed / 42 passed** — «full: no gh: exit 1 ticket mark needs the project
  profile: C:\…\r\shop is not in a registered project». Реестр этот test пишет через `pwd -W`, так что
  написание `match` само этого не объясняет. Причина не установлена; первое, что проверить, — `HARNESS_HOME`,
  переданный как `/tmp/…`.
- **`bin/tests/max-review.test.sh`, оставшиеся 3** — «resume block (Full)»: git отвечает «fatal: ambiguous
  argument 'main..e/07': unknown revision or path not in the working tree». Причина не установлена.
- **`bin/tests/wave-gate.test.sh`** — не укладывается в 300 s (`spawnSync … ETIMEDOUT`); до этого падают:
  - «e2e lock on signal: exit 3, lock gone» и «signal: caffeinate left or not started» — сигнал из Git Bash в
    процесс node;
  - «error while merging: caffeinate left or not started», «locked screen: ioreg calls:», «unlocked screen» —
    `wave-gate` зовёт `ioreg` и `caffeinate`, когда они есть в PATH (`harness/bin/wave-gate:69-78`, `:249`,
    `:278`, `spawn` без shell). Test кладёт в PATH их stub-ы; вероятная причина — stub-ы это скрипты, а node на
    Windows без shell скрипт не запускает (ENOENT), и `wave-gate` считает, что команды нет. Не проверено;
  - случай `resume` до лимита не дошёл.
- **`bin/tests/qmd-collections.test.sh`** (16 failed / 7 passed, «profile -C /tmp/… --json: exit null») — уже в
  «Готово, когда» [Ticket-а 15](15-qmd-на-windows-или-grep.md); здесь не чинится.

## Что делаем

1. `.gitattributes`: `harness/agents/** text=auto eol=lf` и `harness/skills/** text=auto eol=lf` (и проверить,
   нет ли других папок `harness/`, которые test-ы читают `grep`-ом). После — `git add --renormalize` не нужен:
   в индексе файлы уже с LF; рабочую копию на ПК обновить checkout-ом.
2. Test-ы, которые пишут временную папку в реестр или в ожидаемую строку, берут её в написании node:
   `pwd -W` в Git Bash, `pwd -P` на Mac (`ticket-mark.test.sh:57` уже так делает). Одна helper-функция в общем
   файле test-ов, если он есть.
3. `ticket-mark` и `max-review` resume block — найти причину, первым test-ом воспроизвести, поправить.
4. `wave-gate`: сначала подтвердить причину с `caffeinate`/`ioreg`. Потом либо stub-ы, которые node на Windows
   находит и запускает по имени без shell, либо эти проверки пропускаются на win32 с причиной (на Windows
   ни `caffeinate`, ни `ioreg` нет, и `wave-gate` их там законно не зовёт); сигнал — проверить, доходит ли SIGTERM из Git
   Bash до node, и если нет, пропуск на win32 с причиной. Файл укладывается в 300 s.
5. Снять из `test/contract/harness-scripts.test.ts` всё, что этот Ticket сделал ненужным (сейчас там пропуска
   этих файлов нет — они просто красные).

## Готово, когда

- [ ] `test/contract/harness-scripts.test.ts` на ПК — exit 0, без новых пропусков, кроме тех, что названы в
      пункте 4 с причиной; `qmd.test.sh` и `qmd-collections.test.sh` — как решит Ticket 15.
- [x] Каждый из семи файлов выше (кроме `qmd-collections`) — exit 0 в Git Bash на ПК.
- [ ] То же на Mac.
- [ ] Mac gate (ADR-0056) зелёный; Windows runner на `harness-scripts.test.ts` зелёный.

## Тесты

Это сами test-ы Harness-а; новый test нужен только для пункта 3 — сначала красный, потом зелёный.

## Где в коде

- `.gitattributes`
- `harness/bin/tests/agents-text.test.sh`, `max-review.test.sh`, `review-depth.test.sh`, `project-connect.test.sh`,
  `ticket-mark.test.sh`, `wave-gate.test.sh`
- `harness/hooks/tests/guard-silent.test.sh`
- `harness/bin/wave-gate` (если правка в нём, а не в test-е)
- `test/contract/harness-scripts.test.ts`

## Итог

ПК, Git Bash, пустой временный `HOME` (и `USERPROFILE`), «GitHub CLI» убран из PATH; каждый файл запускался
напрямую. Счёт — failed / passed, до (на `0f2f2245`) и после.

| Файл | до | после |
|---|---|---|
| `bin/tests/agents-text.test.sh` | exit 1, 14 / 125 | exit 0, 0 / 139 |
| `bin/tests/max-review.test.sh` | exit 1, 10 / 68 | exit 0, 0 / 79 |
| `bin/tests/review-depth.test.sh` | exit 1, 7 / 98 | exit 0, 0 / 105 |
| `bin/tests/project-connect.test.sh` | exit 1, 21 / 100 | exit 0, 0 / 121 |
| `bin/tests/ticket-mark.test.sh` | exit 1, 1 / 42 | exit 0, 0 / 44 |
| `bin/tests/wave-gate.test.sh` | exit 1, 30 / 126, 451 s | exit 0, 0 / 125, 267 s |
| `hooks/tests/guard-silent.test.sh` | exit 1, 28 / 27 | exit 0, 0 / 55 |

По пунктам:

1. `.gitattributes`: вместо `harness/bin/*` и `harness/hooks/**` — `harness/** text=auto eol=lf`. Test-ы читают
   `grep`-ом не только `agents/` и `skills/`, но и `profiles/README.md` и `.mcp.json`; в рабочей копии с CRLF было
   79 файлов `harness/` (ещё `evals/`, `README.md`, `.claude-plugin/`, `package.json`). Индекс уже LF, правки
   содержимого нет. Рабочая копия обновлена удалением этих файлов и `git checkout` (`git checkout-index -f` файлы,
   которые git считает неизменёнными, не перезаписывает); после — `git ls-files --eol harness`: 0 файлов `w/crlf`,
   `file` — без «CRLF line terminators».
2. Временная папка в написании node (`pwd -W`, иначе `pwd -P`) — `review-depth`, `guard-silent`, `project-connect`,
   по образцу `profile.test.sh` и `preflight.test.sh` (там же своя `printed()`; общего файла для этих строк нет).
   В `project-connect` ожидаемые строки — через `printed()` (`C:\…`) и `jpath()` (тот же путь внутри JSON, `\\`).
   Ещё там же шесть случаев qmd краснели не из-за путей: node на Windows не запускает shell stub `qmd` и
   безрасширенные stub-ы `qmd-collections` («qmd is not installed»). На Windows `qmd` — сам node (как уже в
   случае q5), stub-ы — через `node_stand_in` из `gh-stand-in.sh`; на Mac — те же shell stub-ы.
3. Причины найдены, test-ы сначала красные (проверено мутантом — копией test-а со старым кодом):
   - `ticket-mark` «full: no gh» — не реестр и не `HARNESS_HOME`. `ln -s` в Git Bash копирует программу; копия
     называется `node` без `.exe`. `ticket` запускает `bin/profile` через `process.execPath`, а Windows не
     запускает файл без расширения по пути: ENOENT, и `ticket` считает, что профиля нет. Новый случай «the node of
     the minimal PATH starts itself by process.execPath» (красный на старом коде); на Windows копия — `node.exe`,
     а папка git — в PATH (скопированный `git.exe` не грузит DLL своей папки), и test проверяет, что `gh` в этом
     PATH нет.
   - `max-review` resume block — не Windows: в пустом `HOME` у git нет identity, `commit` отказывает, ветка `e/07`
     не создаётся. Новый случай «the test repository with the branch e/07 is built»; test экспортирует
     `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, как соседние. (`harness-scripts.test.ts` эти переменные задаёт сам, поэтому
     там этот случай не краснел.)
4. `wave-gate`: причина подтверждена — `spawn("ioreg")`/`spawn("caffeinate")` без shell на Windows ищет только
   `.com`/`.exe`, shell stub не стартует (ENOENT), и `wave-gate` законно считает, что команды нет. Пропуски на
   win32, каждый одной строкой `skip …` в выводе; на macOS и Linux всё идёт как раньше:
   - экран: `screenpre`, `screenlock`, `screenno`, `screenmid`, `screenblip`, `screenpkg`, `screenred`,
     `screenloop`, раздел `caffeinate` и проверки caffeinate в `resume` и «error while merging». «no ioreg in PATH»
     на Windows идёт с PATH test-а без папки stub-ов (копии программ в `minbin` там не работают);
   - SIGTERM: проверено отдельным скриптом — `kill` из Git Bash (и `kill -f -W`) завершает node без его
     обработчика `SIGTERM`, так что освободить e2e lock по SIGTERM на Windows `wave-gate` не может; случай `sig`
     пропущен;
   - zsh: в Git Bash его нет (как в `epic-wave-ship-ticket.test.sh`).
   Случай `resume` (SIGKILL) теперь идёт и на Windows: stub gate берёт Windows pid `wave-gate` из
   `STAND_IN_PARENTS` и бьёт его `kill -f -W -KILL` (exit 137, как на Mac). Время: 451 s → 304 s после пропусков →
   267 s: `new_world` пушит main и все PR одним `git push` (локальный push на ПК — около 0,4 s, миров 35), stub
   gate считает и пишет без лишних subshell. Остальное время — сам `wave-gate` (около 150 s на 77 запусков).
5. В `test/contract/harness-scripts.test.ts` снимать нечего: пропусков этих файлов там не было.

`node scripts/vitest-electron.mjs test/contract/harness-scripts.test.ts test/unit/no-rmsync.test.ts` — exit 1:
1 failed (`qmd-collections.test.sh`, Ticket 15) / 52 passed / 2 skipped (zsh и `qmd.test.sh`, как были), 1238 s;
`wave-gate.test.sh` уложился в свои 300 s. `CI=true pnpm lint` — exit 0, `CI=true pnpm typecheck` — exit 0.

Mac (ADR-0056, правка `harness/`) должен проверить: все семь файлов exit 0 под bash и zsh — пропуски на Mac не
срабатывают (`on_windows` ложно), случаи экрана, caffeinate, SIGTERM и zsh идут; `resume` с SIGKILL по `$PPID`;
`new_world` с одним push; `ticket-mark` с симлинками `node`/`git` в `minbin` и новым случаем про `process.execPath`.
