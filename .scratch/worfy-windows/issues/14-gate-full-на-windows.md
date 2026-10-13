# 14 — Gate full на Windows: unit- и e2e-test-ы, ручной job «Windows» в CI

Type: task
Status: open
Blocked by: 03, 08, 10, 11, 12
Source: решения владельца 2026-10-07: Q23 (Windows-раннера на PR нет; gate full на ПК владельца перед мержем платформенных PR; ручной job «Windows»), Q20 (Terminal на Windows — PowerShell, Git Bash — в настройках), Q24 (Windows 10 21H2+ и 11, x64); «Готово, когда» Epic-а, пункт 2 (подтверждено 2026-10-08); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»; [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [spec.md](../spec.md)

## Что происходит

- gate full worfy (запись `worfy` в реестре Gate) — это lint, typecheck, `pnpm test`,
  `pnpm test:e2e` и `pnpm test:package`. Gate на Node и его запуск на Windows делает Ticket 03 (Gate
  на Node). На Windows gate full ещё ни разу не шёл.
- Unit- и contract-test-ы. На ПК владельца до Epic-а (main `08e8256`, `pnpm test` с
  `shell-emulator=true`): 55 файлов из 157 и 662 test-а из 2995 упали; список из JSON-отчёта vitest
  с причиной — evidence Ticket-а 01, раздел 17. Ticket 02 пишет в Итог, что изменилось после него. Ticket-ы 03–12 чинят
  test-ы своих срезов. Что к началу этого Ticket-а ещё красное — его. Общие причины в списке:
  - symlink без режима разработчика — `EPERM` (7 файлов: `first-run-checks`, `shell`, `link-access`,
    `link-caller`, `canvas`, `session-rail-discovery`, `shell-discovery`; evidence, раздел 22).
    2026-10-09 владелец включил режим разработчика (раздел 27): `EPERM … symlink` больше нет,
    `canvas`, `session-rail-discovery` и `shell-discovery` зелёные; в остальных четырёх — 32
    падения других причин, из них 11 — `EPERM` у `rmSync` временной папки по пути `\\?\…`
    (`shell.test.ts:93`, `link-access.test.ts:269`);
  - проверка доверенного frame: `call rejected, it came from an untrusted frame
    (file:///Applications/worfy.app/…)` — `claude-home-subagents`, `docs`, `layout-store`,
    `projects`, `trash`;
  - `/bin/sh` и stub-ы `#!/bin/sh`: `harness-drift`, `gate-state`, `github-prs`, `workflow-reader`,
    `statusline-bridge`, `terminal`, `node-pty`;
  - `harness-evals` — 41 упавший, по причинам: 16 — CRLF во front matter (`frontMatter` ищет
    `^---\n`); 8 — scaffold через `bash` из PATH, а это WSL, который на ПК не стартует; 9 —
    проверки фикстуры, которую строит тот же scaffold; 8 — `pnpm eval:harness` со stub `claude`
    (`spawnSync …\claude ENOENT`) (evidence Ticket-а 01, раздел 17). Решение владельца 2026-10-09
    (раздел 27): CRLF-случай чинит test — `\r?\n` в `frontMatter`, а не LF для `harness/evals/**`:
    test читает файл в том виде, в каком git отдаёт его на машине;
  - прочее: `link-server` (код закрытия WebSocket 1006 вместо 1009), `epic-layout` (тайм-аут 5 s),
    `json-file`, `build-version` (`EPERM … \\?\C:\…`).
- Пять test-ов идут только на macOS (`skipIf(process.platform !== 'darwin')`):
  - `test/unit/agent-env.test.ts:30` — настоящий `/bin/zsh` как login shell;
  - `test/unit/tail.test.ts:69` — APFS даёт новому файлу новый inode, ext4 на Linux берёт
    освобождённый;
  - `test/contract/workflow-reader.test.ts:577` — FSEvents сливает события одного сохранения,
    inotify шлёт больше;
  - `test/contract/terminal.test.ts:163` — `$SHELL -l`, а `/bin/sh` на Linux — dash;
  - `test/contract/make-icons.test.ts:176` — `sips` и `iconutil` есть только на macOS.

  Комментарии `test/unit/tail.test.ts:68` и `test/contract/workflow-reader.test.ts:575` говорят
  «worfy runs on macOS only». После порта это неправда.
- `test/contract/harness-scripts.test.ts` гоняет каждый `harness/{bin,hooks}/tests/*.test.sh` как
  `bash <файл>` (`:63`). Перед этим проверяет `bash`, `zsh`, `jq`, `git` и `node` через
  `sh -c 'command -v …'` (`:40-41`). На Windows: zsh в Git Bash нет, а qmd-скрипты на zsh до
  Ticket-а 15; `sh` и `bash` есть в PATH, только если там папка `bin` или `usr\bin` Git for Windows.
  На ПК владельца в постоянном PATH из Git только `C:\Program Files\Git\cmd`, `sh` не найден, первый
  `bash` — `C:\Windows\System32\bash.exe` (WSL, не стартует). Итог: `harness-scripts.test.ts` — 22
  упавших из 23: 5 проверок PATH (`bash`, `zsh`, `jq`, `git`, `node` — `bash is not installed`:
  `sh` не найден) и 17 прогонов `.test.sh`; `jq` в Git Bash тоже нет (evidence Ticket-а 01,
  разделы 04, 05 и 17).
- e2e, клавиши. `Meta` — 55 мест в 13 файлах: 38 `Meta+…` в `keyboard.press` и 17 `'Meta'` в
  `keyboard.down`, `keyboard.up` и `modifiers` клика. В брифе фактов было 51 в 12 файлах: main с тех
  пор вырос (`test/e2e/wheel-over-nodes.spec.ts`). Playwright понимает `ControlOrMeta`: Meta на
  macOS, Control на Windows и Linux.
- e2e Terminal (`test/e2e/terminal.spec.ts`):
  - подмена `SHELL: '/bin/sh'` и `HOME` (`:40`); та же подмена — в `test/e2e/focus.spec.ts:316` и
    `test/e2e/wheel-over-nodes.spec.ts:105`;
  - дочерние процессы ищет `pgrep` (`:55`, `:64`) — на Windows его нет;
  - команды на POSIX shell: `$(tput cols)` (`:204`), `for … do … done` (`:373`),
    `trap '' HUP; sleep 30` (`:410`), `echo "tp=$TERM_PROGRAM"` (`:229`);
  - собранное приложение — `dist/mac*/worfy.app` (`:501-512`).
- e2e собранного приложения (`test/e2e/packaged.spec.ts`): `builtApp()` ищет `dist/mac*/worfy.app`
  (`:21-34`), `executableOf()` — `Contents/MacOS/worfy` (`:42-44`), скрипт Stable copy запускается
  через `bash` (`:18`, `:36-40`). electron-builder на Windows кладёт распакованное приложение в
  `dist\win-unpacked\worfy.exe`. `builtApp()` повторён в `terminal.spec.ts:501-512`.
- Подменённый `gh`. `test/e2e/helpers.ts:132` ставит `WORFY_GH` на `test/fixtures/gh/gh` — обёртку
  `#!/bin/sh` вокруг `gh-stub.mjs`. worfy зовёт его через `execFile` (`src/main/github/prs.ts:56`).
  `test/contract/github-prs.test.ts:426` пишет свой stub `#!/bin/sh`. На Windows файл с shebang
  `execFile` не запустит, а `.cmd` — только с `shell: true` (исправление CVE-2024-27980 в Node).
  Подменённый `claude` E3 Ticket 13 (установщик Harness) подставляется тем же способом, что `gh`.
- Stub-ы скриптов Harness (`#!/bin/sh` и `cat`, например `test/e2e/card-api.spec.ts:60`) переводит
  на Node Ticket 05: worfy зовёт эти скрипты через `node`.
- CI (`.github/workflows/ci.yml`): job `check` на ubuntu идёт на PR и push (`:24-26`); `full-macos`
  — только на `workflow_dispatch` (`:60-62`). Job-а Windows нет. Каждый ручной запуск гоняет
  `full-macos`, минута macOS — $0.062, Windows — $0.010.
- Зависшие `bash.exe` после `pnpm test` (Session на Windows-ПК, 2026-10-10). После каждого полного
  прогона остаются 7 процессов `bash.exe`. Их запускают `harness/bin/tests/silent-mode.test.sh`,
  `skill-blocks.test.sh` и `tickets-root.test.sh`, а также вызванные ими
  `harness/bin/epic-status --json` и `bin/profile`. vitest снимает test по timeout, дочерние `bash`
  живут дальше: за пять прогонов набралось 35. Почему `epic-status` на Windows не завершается, не
  разбиралось; на Node его переносит Ticket 05.

- Папки в `%TEMP%` после test-ов (Session на Windows-ПК, 2026-10-12). С 2026-10-09 там 9510 папок
  `worfy-*`: `worfy-migrate` 2268, `worfy-canvas` 1134, `worfy-docs` 959, `worfy-projects` 946,
  `worfy-connect` 725, `worfy-eval` 676 и мельче; объём не замерен. Вероятная причина части из
  них — та же, что в Ticket-е 23: `afterEach` чистит через `rmSync`, а под Node 24 он бросает EPERM
  на файле «только для чтения» (объекты git). На main в `harness-migrate.test.ts` больше 20 таких
  падений. Session папки не удаляла; удалять ли и как — решает владелец. Сколько test-файлов
  перестают оставлять папки после общей функции удаления — замер в «Итог» Ticket-а 23.
- `test/contract/trash.test.ts` на Windows падает целиком и на main: «untrusted frame», `INDEX_HTML`
  — путь macOS (Session на Windows-ПК, 2026-10-12).

- `test/unit/shell-resolve.test.ts:297` падает на `windows-latest` (ручной job Ticket-а 25,
  [прогон 38315851244](https://github.com/IDSAD-XL/worfy/actions/runs/38315851244), 2026-10-13):
  временная папка там — `C:\Users\RUNNER~1\…` (короткое имя 8.3), test строит ожидаемый путь от
  неё, а `resolveProjectFile` отвечает длинным именем после `realpath`. На ПК владельца не
  воспроизводится. Починка — в test-е: брать папку через `realpathSync.native`. Остальные 68
  test-ов двух файлов прошли. Какие ещё test-ы строят ожидание от `tmpdir()`, не проверялось.

- **Замер 2026-10-13 — с него Ticket начинает: он новее и шире списков Ticket-ов 01 и 02, на
  которые ссылается шаг 1 «Что делаем»** (Session на Windows-ПК, полный `pnpm test`, main
  `d1ed18c`, Node 24.21.0 из Electron 44.5.1, JSON-отчёт vitest). 4522 test-а: 3862 прошли, 620
  упали, 40 пропущены. Один файл не загрузился (`test/contract/terminal-shell-integration.test.ts`);
  Session считает его за одно падение — всего 621: 593 в `test/contract`, 28 в `test/unit`. Падения
  — в 51 файле; входит ли в это число незагрузившийся файл, отчёт Session не говорит. Скрипты разбора лежат на ПК в `%TEMP%\worfy-01`
  (`p1-groups.cjs`, `p1-classes.cjs`, `p1-families.cjs`), в репозитории их нет.
  - Классы по тексту ошибки (первый подошедший):

    | Класс | Test-ов | Файлов |
    |---|---|---|
    | `call rejected, it came from an untrusted frame` | 118 | 8 |
    | shell-скрипт «did not finish in time» | 38 | 1 (`e3-sandbox`) |
    | shell-скрипт «exited N» | 15 | 1 (`harness-scripts`) |
    | `ENOENT`, `EINVAL` или неудачный spawn в первых трёх строках | 20 | 8 |
    | timeout test-а или hook-а | 4 | 4 |
    | ни один из этих | 426 | 46 |

  - Верхняя граница для file URL macOS: строку `/Applications/worfy.app` содержат 34 test-файла по
    скрипту Session (`git grep -l` на `d1ed18c` находит 35 — расхождение не разобрано), в них 924
    test-а, 242 упали. 117 из них говорят «untrusted frame»; остальные 125 падают на
    assertion-е, который причину не показывает (вероятно, тот же отказ — не доказано).
  - Упало по файлам, первые 20 (упало / всего): `e3-sandbox` 45/57; `harness-evals` 39/55;
    `projects` 39/42; `layout-store` 37/41; `claude-home-registry` 36/67; `harness-install` 34/46;
    `workflow-profile` 32/60; `github-prs` 31/65; `workflow-reader` 29/43; `claude-home-subagents`
    28/32; `harness-migrate` 26/57; `e3-owner-check` 23/23; `first-run-checks` 21/39; `docs` 19/22;
    `harness-scripts` 19/26; `github-accounts` 15/20; `trash` 14/14; `unit/gate-state` 12/63;
    `harness-qmd` 11/17; `startup-failure` 10/35.
  - По семействам файлов (упало / файлов / test-ов): `harness-*` 132/7/225; `e3-*` 68/2/80;
    `claude-*` 64/2/99; `workflow-*` 61/2/103; `github-*` 46/2/85; `projects-*` 45/2/73; `layout-*`
    37/1/41; `first-*` 21/1/39; `docs-*` 19/1/22; `trash-*` 14/1/14; `unit/gate-*` 12/1/63; в
    остальных 25 семействах — 102.
  - По первой строке ошибки — 230 групп. Самые большие: 38 — скрипт не успел (`e3-sandbox`); 32 в
    14 файлах — `expected false to be true`; 30 — `layout.apply`, 29 — `projects.add`, 14 —
    `claudeHome.subagents`, 11 — `docs.open`, 11 — `trash.put` (все пять — «untrusted frame»); 22 в
    3 файлах — `expected N to be N`; 15 — «exited N» (`harness-scripts`).
  - Чтение Session — предположение, не замер. Большую часть дают три причины: file URL macOS в
    IPC-test-ах (118 сказано прямо, до 242); shell-скрипты Harness и E3 через bash на Windows
    (`harness-*` и `e3-*` — 200 падений); ожидание POSIX-пути там, где Windows отвечает своим
    (`gate-state`, `workflow-*`). Ещё 426 падений не подошли ни под один класс по тексту ошибки:
    их причина этим замером не названа.

## Что делаем

1. **Unit- и contract-test-ы на Windows.** Каждый test из списка evidence Ticket-а 01 (раздел 17) и
   Итог-а Ticket-а 02, который к началу ещё красный, — починить (test или код). Если смысл test-а на
   Windows не держится — пропуск на `win32` с комментарием: почему и какой Ticket его снимет. Test-ы
   с symlink на `win32` не пропускаются: владелец включил режим разработчика и выбрал его как
   требование к машине разработчика на Windows (evidence Ticket-а 01, раздел 27); раздел «Development
   on Windows» в `README.md` его называет. Итоговый список пропусков — в Итог.
2. **Пять test-ов только для macOS** — решение по каждому. Где смысл держится (inode на NTFS,
   пауза 300 ms у чтения workflow), test идёт и на Windows. Где нет (`/bin/zsh`, `sips`) — пропуск
   остаётся, комментарий называет причину для Windows. Комментарии «worfy runs on macOS only»
   переписать. Для `terminal.test.ts:163` — такой же случай с PowerShell на Windows, если его не
   добавил Ticket 10.
3. **`harness-scripts.test.ts` на Windows.** `.test.sh` запускает Git Bash, найденный явно (тот же
   helper, что у Ticket-а 09, или `CLAUDE_CODE_GIT_BASH_PATH`), а не `bash` из PATH. Через него же
   идут проверки `command -v`. Проверка `zsh` и `harness/bin/tests/qmd.test.sh` на `win32`
   пропускаются с причиной «qmd-скрипты на zsh до Ticket-а 15»; пропуск снимает Ticket 15. Чего ещё
   не хватает на ПК для `pnpm test` (например, `jq` в Git Bash), — в Итог.
4. **`Meta` → `ControlOrMeta`** во всех 13 файлах, тип `('Meta' | 'Shift')[]` в
   `test/e2e/wheel-over-nodes.spec.ts:132` тоже. На Mac клавиши те же.
5. **e2e Terminal на Windows.** Оболочка по умолчанию — PowerShell (Q20). Команды test-а
   выбираются по оболочке: `echo "tp=$env:TERM_PROGRAM"`,
   `$Host.UI.RawUI.WindowSize.Width`, `1..15 | % { "L$_-row" }`, `Start-Sleep 30` вместо
   `trap '' HUP; sleep 30`. Дочерние процессы на Windows — через
   `Get-CimInstance Win32_Process -Filter "ParentProcessId=<pid>"`, с учётом `conhost.exe` или
   `OpenConsole.exe`, которые запускает ConPTY. Один test идёт и в Git Bash — оболочке из настроек
   (Ticket 10). Подмены `SHELL` и `HOME` на Windows — по системе.
6. **e2e собранного приложения на Windows.** Один helper в `test/e2e/helpers.ts` отдаёт
   распакованную сборку по системе: `dist/mac*/worfy.app` или `dist/win-unpacked/worfy.exe`, и её
   исполняемый файл. Им пользуются `packaged.spec.ts` и `terminal.spec.ts`. Вызов скрипта Stable
   copy — тот, что оставил Ticket 12 на Mac; путь Stable copy на Windows — из `CONTEXT.md`
   (записал Ticket 12).
7. **Подмена `gh` и `claude` на Windows.** Способ выбирает исполнитель и пишет в Итог. Например:
   путь в `WORFY_GH`, который кончается на `.mjs`, worfy запускает как `process.execPath` с
   `ELECTRON_RUN_AS_NODE=1`. С настоящим `gh` поведение не меняется. Тот же способ делает зелёными на
   Windows test-ы E3 с подменённым `claude` (`test/contract/harness-install.test.ts`).
8. **Ручной job «Windows» в CI** (Q23). `runs-on: windows-latest`, шаги — как у `full-macos`:
   install, lint, typecheck, test, test:e2e, test:package, артефакт `test-results/` при сбое.
   `workflow_dispatch` получает выбор `platform` (`macos` или `windows`, по умолчанию `macos`):
   `full-macos` идёт только при `macos`, `windows` — только при `windows`. Так прогон Windows не
   платит за минуты macOS. Job `check` и триггеры PR не меняются: на PR CI только на Linux.
   Комментарий в начале `ci.yml` описывает оба ручных job-а. Если на runner-е GitHub e2e не идут
   (например, нет рабочего стола), job оставляет то, что идёт, а причина — в комментарии и в Итог.
9. **Q23 целиком.** С мержа этого Ticket-а платформенные PR Epic-а влиты только после зелёного
   gate full на ПК владельца. До него хватает проверки своего среза на Windows: падения `pnpm test`
   сверены со списком Ticket-а 02, новых нет (ADR-0056, «Последствия»). В Итог — коммит, с которого
   правило действует. gate full на Mac для PR Session Windows гонит Session на Mac, она же их
   вливает: правило needs-mac-gate (spec.md, «Соглашения»; решение владельца 2026-10-08, Q30).

**Не входит:** код Terminal (Ticket 10); упаковка и Stable copy (Ticket 12); stub-ы скриптов
Harness (Ticket 05); test-ы qmd (Ticket 15); Windows-раннер на PR (Q23 — его нет).

## Готово, когда

- [ ] На ПК владельца `pnpm test` — код 0. Каждый пропуск на `win32` — с комментарием о причине; список — в Итог.
- [ ] На Mac ни один из пяти test-ов только для macOS не пропущен: `pnpm test --reporter=verbose` показывает их пройденными (через раздел Mac checks PR, Q33).
- [ ] `grep -rnE "Meta\+|'Meta'" test/e2e` — пусто (код 1); на Mac `pnpm test:e2e` — код 0.
- [ ] На ПК владельца `pnpm build && pnpm exec playwright test test/e2e/terminal.spec.ts --grep-invert @packaged` — код 0: PowerShell по умолчанию, один случай в Git Bash; после закрытия Node и выхода из worfy у main-процесса worfy нет дочерних оболочек.
- [ ] На ПК владельца `pnpm test:package` — код 0: test-ы `@packaged` запустили `dist/win-unpacked/worfy.exe`, Terminal в собранном приложении работает.
- [ ] `harness-scripts.test.ts` на Windows запускает `.test.sh` через Git Bash, а не через `C:\Windows\System32\bash.exe` (путь bash виден в выводе test-а); `qmd.test.sh` пропущен с причиной, где назван Ticket 15.
- [ ] `GATE_SCOPE=all` gate full (команда Gate — какой её оставил Ticket 03) на ПК владельца — код 0 и вердикт «зелено». Вывод `[gate]` — в Итог.
- [ ] То же на Mac — код 0 и вердикт «зелено» (по правилу needs-mac-gate: проверяет и вливает Session на Mac).
- [ ] `ci.yml`: `git diff origin/main -- .github/workflows/ci.yml` не трогает job `check` и триггеры `pull_request` и `push`; job `windows` и `full-macos` идут только на `workflow_dispatch` со своим значением `platform`.
- [ ] Один ручной прогон `gh workflow run CI -f platform=windows` — только с согласия владельца (минута Windows — $0.010); ссылка на прогон — в Итог. Без согласия пункт — «не проверено», с причиной.

## Тесты

Сначала падающий test — `test/e2e/terminal.spec.ts` на ПК владельца: `pgrep` не найден, команды
`sh` не идут в PowerShell. В Итог — как он падал.

- `test/e2e/terminal.spec.ts` — команды и процессы по системе, случай Git Bash.
- `test/e2e/packaged.spec.ts` — сборка Windows.
- 13 файлов e2e с `ControlOrMeta` — тех же проверок, другие клавиши.
- `test/contract/harness-scripts.test.ts` — Git Bash явно, пропуск qmd до Ticket-а 15.
- Пять test-ов только для macOS — по решению из пункта 2.

## Где в коде

- `test/e2e/canvas-layout.spec.ts`
- `test/e2e/epic-frame-undo.spec.ts`
- `test/e2e/wheel-over-nodes.spec.ts`
- `test/e2e/focus.spec.ts`
- `test/e2e/snapping.spec.ts`
- `test/e2e/trash-undo.spec.ts`
- `test/e2e/pin-tags.spec.ts`
- `test/e2e/edges.spec.ts`
- `test/e2e/theme-shadows.spec.ts`
- `test/e2e/no-overlap.spec.ts`
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/palette-find.spec.ts`
- `test/e2e/tidy-up.spec.ts`
- `test/e2e/terminal.spec.ts`
- `test/e2e/packaged.spec.ts`
- `test/e2e/helpers.ts`
- `test/fixtures/gh/gh`
- `test/fixtures/gh/gh-stub.mjs`
- `test/contract/github-prs.test.ts`
- `test/contract/harness-scripts.test.ts`
- `test/contract/harness-install.test.ts`
- `test/unit/agent-env.test.ts`
- `test/unit/tail.test.ts`
- `test/contract/workflow-reader.test.ts`
- `test/contract/terminal.test.ts`
- `test/contract/make-icons.test.ts`
- `src/main/github/prs.ts`
- `src/main/ipc/checks.ts`
- `.github/workflows/ci.yml`

`src/main/github/prs.ts` и `src/main/ipc/checks.ts` меняются, только если подмена `gh` идёт через
код worfy (пункт 7). Остальные файлы из списка evidence Ticket-а 01 (раздел 17) и Итог-а Ticket-а 02,
которые к началу ещё красные, исполнитель дописывает сюда до начала работы: по ним worfy считает
пересечения Wave. `playwright.config.ts` и `vitest.config.ts`
меняются, только если без этого test-ы на Windows не идут; тогда они тоже идут в этот список.

Ticket 05 меняет stub-ы скриптов Harness в тех же e2e-файлах, Ticket 13 — `harness-install.test.ts`.
Друг друга они не блокируют; в одну Wave не попадут, второй делает rebase.

## Итог

Заполняется при закрытии.
