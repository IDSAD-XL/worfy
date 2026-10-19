# 14 — Gate full на Windows: unit- и e2e-test-ы, ручной job «Windows» в CI

Type: task
Status: open
Blocked by: 03, 08, 10, 11, 12
Source: решения владельца 2026-10-07: Q23 (Windows-раннера на PR нет; gate full на ПК владельца перед мержем платформенных PR; ручной job «Windows»), Q20 (Terminal на Windows — PowerShell, Git Bash — в настройках), Q24 (Windows 10 21H2+ и 11, x64); «Готово, когда» Epic-а, пункт 2 (подтверждено 2026-10-08); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»; [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [spec.md](../spec.md); решение владельца 2026-10-19: часть unit/contract (пункт 1 «Что делаем» — main зелёный на Windows) идёт первой, от неё зависит [Ticket 66](66-полный-unit-contract-на-windows-runner.md) (полный `pnpm test` на Windows-runner-е, [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md)); `harness-evals` — [Ticket 65](65-harness-evals-на-windows.md)

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
  на Node Ticket 05: worfy зовёт эти скрипты через `node`. Среди них — два e2e с такой подменой
  `epic-status`: `test/e2e/focus-sidebar.spec.ts:188` и `:552` (stub — `:76-77`; на main `1c1beadd`,
  до PR #308 второй стоял на `:549`). На ПК в обоих список Epic-ов в боковой панели пуст (ответ
  Windows-ПК в PR #297, «Итог» Ticket-а 10 Epic-а `worfy-ui`); причина прочитана по fixture,
  запуском не подтверждена.
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

Ticket идёт срезами, по одному PR на срез; каждый срез дописывает сюда свою часть. Порядок срезов согласован с Session на Mac 2026-10-14: (1) URL окна в contract-test-ах; (2) клавиши `Meta` → `ControlOrMeta` в e2e и пять test-ов только для macOS; (3) подмены `gh`, `claude`, `epic-status` и ожидания POSIX-путей; (4) job `windows` в `ci.yml`; после Ticket-а 03 — (5) `harness-scripts.test.ts` через Git Bash, e2e Terminal и собранного приложения, итоговый gate full.

### Срез 1 — contract-test-ы строят URL окна так же, как приложение

Session на Windows-ПК, 2026-10-14. Windows 11 Pro 10.0.26200; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/14-frame-url` от main `ba8a58c`. **На macOS и Linux с ПК ничего не запускалось.** Правку сделал subagent этой Session; diff прочитан второй раз другим subagent-ом (дефектов не найдено, три замечания low — ниже) и проверен ею: полный прогон, сравнение по именам.

- **Причина.** `appUrlMatcher` (`src/main/ipc/index.ts`) сравнивает URL окна с `pathToFileURL(indexHtml).href`. На Windows это `file:///C:/Applications/…`. Test-ы собирали URL руками — `` `file://${INDEX_HTML}` `` или строкой `file:///Applications/worfy.app/…` — и каждый вызов канала отклонялся: «call rejected, it came from an untrusted frame». Код прав, неправы test-ы.
- **Что сделано.** Один общий файл `test/app-url.ts`: путь `INDEX_HTML` и `APP_URL = pathToFileURL(INDEX_HTML).href`. Им пользуются 28 файлов test-ов и `test/contract/terminal-harness.ts`. В `src/` ничего не менялось. Вне `test/` одна строка: файл добавлен в `tsconfig.test.node.json`, иначе `tsc -p` падает с TS6307.
- **На macOS и Linux значения прежние** — `/Applications/worfy.app/…` и `file:///Applications/worfy.app/…` — во всех файлах, кроме двух. `test/contract/github-prs.test.ts` и два test-а «app URL matcher» в `test/contract/ipc.test.ts` раньше брали свой путь `/app/out/renderer/index.html`; теперь берут путь из общего файла. Проверки те же: принять свой URL, принять его с query и hash, отклонить соседний `other.html`, http-адрес и не-URL.
- **В `ipc.test.ts` добавлена одна проверка** — вид `APP_URL`: `file:///`, необязательная буква диска, путь. При запуске test-ов из сетевой папки Windows (`\\server\share\…`) она упадёт: там `pathToFileURL` даёт `file://server/share/…`. Замечание ревьюера, low, оставлено.

| `pnpm test` на ПК | Test-ов | Прошли | Упали | Пропущены |
|---|---|---|---|---|
| main `6033e14` (эталон; main `ba8a58c` новее на два UI-commit-а) | 4710 | 4026 | 641 | 43 |
| ветка на `3d7d5e7` | 4793 | 4307 | 443 | 43 |

- **Перестали падать 199 test-ов.** 179 — в изменённых файлах: `layout-store` 37, `projects` 28, `docs` 16, `trash` 14, `claude-home-registry` 13, `claude-home-subagents` 10, `autopilot` 9, `shell` 9, `viewport-store` 8, `ipc` 7, `bindings` 5, `main-ipc-wiring` 5, `actions` 4, `card-protocol` 4, `terminal-ai-assist` 4, `limits` 3, `web-policy` 2, `canvas-tools` 1. Ещё 20 — test-ы с пределом по времени в файлах, которые срез не трогал; они плавают от прогона к прогону.
- **По именам на ветке падает и не падает в эталоне один test:** `test/contract/claude-home-subagents.test.ts`, «refuses an answer of the wrong shape instead of passing it on». В эталоне он проходил только потому, что вызов отклоняла проверка окна. Теперь вызов доходит до кода, Session из fixture на Windows не находится, и ответ — `found: false` раньше, чем подставленный reader. Причина та же, что у 17 соседних test-ов файла; это срез 3.
- **В изменённых файлах осталось 93 падения, все с другими причинами:** `github-prs` 31 (подмена `gh`), `claude-home-registry` 23 и `claude-home-subagents` 19 (Session из fixture не находятся; `ps -p … -o lstart=`), `projects` 11 (`C:/` против `C:\`, hash id Project-а), `canvas-tools` 4, `docs` 3, `agent-attachments` 1, `bindings` 1. Ни одно не содержит «untrusted frame».
- **Мутант:** `APP_URL` указывает на `…/other.html` — в одной пачке файлов упало 37 test-ов в пяти файлах (`trash` 14, `shell` 9, `viewport-store` 8, `terminal-ai-assist` 4, `web-policy` 2).
- `pnpm lint`, `pnpm typecheck` — exit 0.

**Не сделано и не проверено в срезе 1:** macOS и Linux — значения проверены только вызовом `pathToFileURL(…, { windows: false })` на ПК. `test/unit/renderer-entry.test.ts:74,81` по-прежнему собирает `file://${indexHtml}` руками из настоящего пути: на Windows это проходит, потому что разбор URL сам приводит `file://C:\…` к `file:///C:/…`; путь с `#`, `?` или `%` его сломает на любой системе — не тронуто.

**Что использовано вместо текста Ticket-а** (расхождения подтверждены Session на Mac, текст она правит своим docs PR): проверка клавиш — `grep -rnE "Meta\+|'Meta'" test/e2e | grep -v ControlOrMeta` ничего не печатает; `Meta` стоит в 66 местах 17 файлов, меняются все; job `windows` в `ci.yml` пишется рядом с существующим `windows-tests.yml`, который остаётся как есть.

### Срез 2 — клавиши `ControlOrMeta` в e2e и пять test-ов только для macOS

Session на Windows-ПК, 2026-10-14. Windows 11 Pro 10.0.26200; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1, Playwright 1.63.0. Ветка `worfy-windows/14-keys-and-mac-tests` от main `88769ca`, четыре commit-а: клавиши, пять test-ов, ещё один spec с `Meta`, который пришёл с main, и этот раздел «Итог». Итоговый head PR #304 — `ea2fd18`; код в нём тот же, что в `bac8781`. Пока срез шёл, main ушёл вперёд три раза (срез 1, worfy-ui Ticket-ы 06 и 10); незапушенная ветка каждый раз переносилась на него без конфликтов, поэтому у прогонов ниже разные head — код среза в них один. Меняются только файлы в `test/`. **На macOS и Linux с ПК ничего не запускалось.** Правку сделал subagent этой Session; diff прочитан вторым subagent-ом (замечаний нет) и проверен ею: полный прогон, e2e на ветке и на main, сравнение по именам.

- **Клавиши (пункт 4).** `Meta` → `ControlOrMeta` в 69 местах 18 файлов `test/e2e/` (`focus-sidebar.spec.ts`, который пришёл с worfy-ui Ticket-ом 10, уже писал `ControlOrMeta`): `canvas-layout` 5, `done-stack` 1, `edges` 2, `epic-frame-undo` 4, `epic-frame` 2, `focus` 8, `no-overlap` 2, `palette-find` 11, `palette-groups` 1, `pin-tags` 4, `settings-health` 1, `settings` 7, `snapping` 2, `terminal` 1, `theme-shadows` 1, `tidy-up` 5, `trash-undo` 8, `wheel-over-nodes` 4. Тип `('Meta' | 'Shift')[]` в `wheel-over-nodes.spec.ts` стал `('ControlOrMeta' | 'Shift')[]`. Playwright на macOS читает `ControlOrMeta` как Meta, так что на Mac клавиши те же. Проверка: `grep -rnE "Meta\+|'Meta'" test/e2e | grep -v ControlOrMeta` ничего не печатает. В Ticket-е стоит 55 мест в 13 файлах — main с тех пор вырос; `settings-health.spec.ts` пришёл с worfy-ui Ticket-ом 06 уже во время работы над срезом.
- **e2e на ПК: 18 изменённых spec-ов, ветка `17eec0a` и main `39f33a6`.** `pnpm build` — exit 0 на обеих; затем `pnpm exec playwright test <18 файлов> --grep-invert @packaged` — exit 1 на обеих.

  | | Test-ов | Прошли | Упали |
  |---|---|---|---|
  | main `39f33a6` | 72 | 15 | 57 |
  | ветка `17eec0a` | 72 | 26 | 46 |

  **11 test-ов перестали падать, ни один не начал:** `trash-undo` 4 (`:85`, `:115`, `:298`, `:334`), `focus` 3 (`:87`, `:203`, `:233`), `settings` 2 (`:45`, `:109`), `canvas-layout` 1 (`:291`), `pin-tags` 1 (`:450`). `settings.spec.ts` и `trash-undo.spec.ts` на ветке проходят целиком. Ещё один test дошёл дальше и упал на другой проверке: `pin-tags.spec.ts:179`.

  После переноса на main `88769ca` (worfy-ui Ticket 10 изменил `focus.spec.ts` и добавил `focus-sidebar.spec.ts`) эти два spec-а запущены ещё раз, на head `bac8781` (код итогового head `ea2fd18`) и на main `88769ca`: `focus.spec.ts` — на main 0 из 4, на ветке 3 из 4 (те же три test-а; четвёртый — Terminal, строка `:340`); `focus-sidebar.spec.ts` — 5 из 7 на обеих, два падения те же (`:188`, `:549`: список Epic-ов в боковой панели пуст; вероятная причина — fixture подменяет `epic-status` скриптом с `#!/bin/sh`, запуском не подтверждена). Остальные 17 изменённых spec-ов на итоговом коде не повторялись: ни main, ни третий commit их не меняли.

  **46 падений ветки падают и на main, по первой ошибке групп пять; ни одна не про клавиши:**

  | Первая ошибка | Сколько и где | Причина |
  |---|---|---|
  | «the window is 1600 px wide»: получено 1586 (так же 1400 → 1386, 1280 → 1266), `helpers.ts:313` | 19: `snapping` 6, `no-overlap` 4, `tidy-up` 3, `done-stack` 2, `canvas-layout` 1, `edges` 1, `palette-find` 1, `palette-groups` 1 | helper `canvasReady` задаёт внешний размер окна и ждёт такую же ширину страницы; рамка окна Windows занимает 14 px |
  | команды POSIX в Terminal, который на Windows — PowerShell | 14: `terminal` 7, `wheel-over-nodes` 6, `focus` 1 (`:312`) | spec набирает `seq 1 200`, `stty size`, `head -c`, `echo "tp=$TERM_PROGRAM"`; это пункт 5 Ticket-а |
  | `toBeVisible()` на рамке Epic-а или её частях | 10: `epic-frame` 7, `epic-frame-undo` 1, `snapping` 1 (`:321`), `theme-shadows` 1 | Epic-ов на Canvas нет. Причина не подтверждена запуском; вероятная — подмена `epic-status` в fixture, скрипт с `#!/bin/sh` (срез 3) |
  | `toBe`: ожидалось 1, получено 0 | 2: `settings-health` `:126`, `:190` | не разбиралось; spec новый, клавиша в нём одна |
  | `toBeCloseTo`: ожидалось 205, получено 197,8 | 1: `pin-tags` `:179` | не разбиралось; на main этот test падает на другой проверке (`toBeLessThan`) |

- **Пять test-ов только для macOS (пункт 2).**

  | Test | Решение | Почему |
  |---|---|---|
  | `test/unit/tail.test.ts`, «rereads from the start when the file was replaced by a new one» | идёт на macOS и Windows, пропуск только на Linux | NTFS отдаёт новому файлу ту же запись, но поднимает её номер последовательности, и `ino` меняется: 5 замен из 5 дали другой `ino` (`fs.statSync(…, { bigint: true })`) |
  | `test/contract/workflow-reader.test.ts`, «waits for 300 ms of quiet: saves closer together than that give exactly one read» | идёт на macOS и Windows, пропуск только на Linux | сохранения с шагом 60 ms дают одно чтение и на Windows |
  | `test/unit/agent-env.test.ts`, 4 случая с настоящим `/bin/zsh` | пропуск на Windows остаётся | на Windows нет login shell: `captureAgentEnv` там читает реестр и `captureLoginShellEnv` не вызывает; это проверяют блок «captureAgentEnv on win32» и два блока только для Windows в том же файле |
  | `test/contract/terminal.test.ts`, «open starts $SHELL -l in the Project root …» | пропуск на Windows остаётся | на Windows нет `$SHELL` и login shell, Terminal запускает PowerShell; то же для него проверяет «open starts Windows PowerShell …» в `terminal-windows.test.ts` |
  | `test/contract/make-icons.test.ts`, запуск `scripts/make-icons.mjs` (8 test-ов) | пропуск на Windows остаётся | скрипт рисует через `sips` и пакует через `iconutil` — программы macOS; его результаты (`icons.json`, `icon.ico`) лежат в репозитории и проверяются на всех системах |

  Комментария «worfy runs on macOS only» в этих файлах больше нет. Оба test-а, которые теперь идут на Windows, прошли в трёх отдельных запусках из трёх и в двух полных прогонах.

- **`pnpm test` на ПК.** Полный прогон шёл на `263c150` — те же два commit-а на main `6030ef3`; до итогового head ветку отделяют два переноса на main (worfy-ui Ticket-ы 06 и 10, документы) и третий commit в один e2e-файл, который `pnpm test` не запускает. На итоговом head полный прогон не повторялся.

  | `pnpm test` на ПК | Test-ов | Прошли | Упали | Пропущены |
  |---|---|---|---|---|
  | срез 1 на `3d7d5e7` (эталон: тот же код, что main `6030ef3`) | 4793 | 4307 | 443 | 43 |
  | ветка на `263c150` | 4793 | 4314 | 438 | 41 |

  - **Из пропущенных в прошедшие — 2 test-а**, те самые из `tail.test.ts` и `workflow-reader.test.ts`.
  - **По именам на ветке падают и не падают в эталоне 2 test-а**, оба в файлах, которые срез не трогал: `contract/harness-evals.test.ts`, «reviewer-simplification builds its fixture…», и `contract/projects-connect.test.ts`, «Full: the form gets what the Session proposed…». Оба файла, запущенные отдельно на ветке: эти два test-а проходят, число упавших в каждом файле то же, что в эталоне (39 и 6).
  - **Перестали падать 7 test-ов**, все в файлах, которые срез не трогал (`e3-sandbox` 3, `startup-failure` 2, `canvas` 1, `shell-discovery` 1): шум между прогонами. `startup-failure.test.ts` в семи сохранённых прогонах даёт от 8 до 12 упавших из 35.
- `pnpm lint`, `pnpm typecheck` на итоговом head — exit 0. `git ls-files --eol` для 23 изменённых файлов — `i/lf`.

**Не сделано и не проверено в срезе 2:** e2e на Mac гонит Session на Mac. Причины трёх групп e2e-падений из таблицы выше (рамки Epic-ов, `settings-health`, `pin-tags:179`) прочитаны по первой ошибке и запуском не подтверждены. `test/contract/terminal.test.ts` в двух запусках из четырёх на ПК закончился раньше времени: 4 test-а прошли, 40 остались без результата, файл при этом считался прошедшим; в двух других и в полных прогонах — 44 прошли, 3 пропущены. Причина не найдена; срез поменял в этом файле только комментарий. Проверка `grep` держится, только пока новый spec не напишет `Meta`: за время среза main дважды принёс новые e2e-файлы, один из них с `Meta+k`. Test-а, который ловил бы это в CI, срез не добавляет.

### Срез 3a — Session-ы fixture находятся на Windows; test-ы отказа называют причину отказа

Session на Windows-ПК, 2026-10-16. Windows 11 Pro 10.0.26200; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/14-session-fixtures-2` от main `20aa1a9`, четыре commit-а. Первые два сделаны 2026-10-14 на ветке `worfy-windows/14-session-fixtures` (`6e3ef19`, от старого main `88769ca`, запушена, PR не было). Она не переносилась rebase-ом — для этого нужен был бы force push; оба commit-а перенесены cherry-pick-ом на новую ветку. Конфликт — одна строка `import` в `test/contract/claude-home-registry.test.ts`: main добавил `utimes` (#369), срез убрал `cp`. Меняются только файлы в `test/`. **На macOS и Linux с ПК ничего не запускалось.**

- **Причина (Part A).** Fixture Claude home называет папки под `projects/` по POSIX-путям (`-Users-test-projects-demo`). Registry разрешает корень Project-а и называет папку по результату. На Windows `/Users/test/projects/demo` — это `C:\Users\test\projects\demo`, папка — `C--Users-test-projects-demo`, и ни одна Session fixture там не находилась. Код прав, неправы test-ы.
- **Что сделано (Part A, `c930328`).** `test/contract/claude-home-fixture.ts`: `copyClaudeHome()` копирует fixture и даёт каждой папке под `projects/` то имя, которое registry ищет на этой системе; `projectDir()` называет такую папку. На macOS и Linux имена — те же, что в fixture. Test-ы `claude-home-registry`, `claude-home-subagents`, `bindings` читают копии и называют папки через `projectDir()`. Test, которому нужно время старта процесса, на Windows спрашивает FILETIME своей командой PowerShell (у `ps` из Git Bash нет `-o`); проверки «нет `ps` в PATH» остаются для macOS и Linux.
- **Что сделано (Part B, `7247e48`).** 13 test-ов отказа проверяли только `ok === false`. На Windows, пока URL окна собирался руками (срез 1), их вызов отклоняла проверка окна, и test проходил не по той причине. Теперь каждый ещё сверяет текст отказа: `actions` 3 («<канал>: invalid input»), `autopilot` 1 («autopilot.state: invalid output from the handler»), `card-protocol` 1 («cards.get: invalid input» и «No Project with id …»), `github-prs` 8 строк `checks.get` («checks.get: invalid input» и отказ обработчика для `main`).
- **`7124f82`.** Test «sees a new, an appended, a rewritten and a removed transcript …» пришёл на main во время среза (#369) и собирал путь к папке fixture руками; на Windows он падал с `ENOENT` на `utime`. Теперь путь — через `projectDir(DEMO)`.

| `pnpm test` на ПК | Test-ов | Прошли | Упали | Пропущены |
|---|---|---|---|---|
| main `20aa1a9` | 5505 | 4954 | 410 | 141 |
| ветка `7247e48` (без `7124f82`) | 5505 | 4984 | 380 | 141 |

| Файл | main: упали | ветка `7247e48`: упали |
|---|---|---|
| `claude-home-registry.test.ts` | 24 | 8 (после `7124f82`, файл отдельно: 7 из 71) |
| `claude-home-subagents.test.ts` | 19 | 0 из 32 |
| `bindings.test.ts` | 1 | 0 из 13 |
| `actions`, `autopilot`, `card-protocol` | 0 | 0 |
| `github-prs.test.ts` | 24 | 24 (подмена `gh` — срез 3b) |

- **Перестали падать 40 test-ов:** `claude-home-registry` 16, `claude-home-subagents` 19, `bindings` 1 и ещё 4 в файлах, которые срез не трогал (`permission-card` 2, `canvas` 1, `canvas-actions` 1) — шум между прогонами.
- **По именам на ветке падают и не падают на main 10 test-ов**, все в четырёх файлах, которые срез не трогал: `startup-failure` 4, `terminal-windows` 4, `critical-path` 1 (timeout 5 с), `terminal` 1. Эти четыре файла, запущенные отдельно на обеих сторонах: новых падений 0, на ветке падает на одно меньше (`startup-failure` 11 против 12). `terminal.test.ts` в этом отдельном запуске на ветке закончился раньше времени (7 прошли, 37 без результата, файл засчитан прошедшим — как дважды в срезе 2); ещё раз отдельно — 44 прошли, 3 пропущены, как на main.
- **Мутант:** `test/app-url.ts` снова собирает URL руками (`` `file://${INDEX_HTML}` ``) — на ветке все 13 закреплённых test-ов падают; без мутанта все 13 проходят. До закрепления (2026-10-14, старое дерево) все 13 проходили и под мутантом.
- **Ревью** — subagent этой Session, линза «корректность test-ов»: серьёзных находок нет; на macOS и Linux имена папок те же, что в fixture; ни одна проверка не ослаблена; путь Windows к времени старта процесса не проходит, если процесса нет или PowerShell упал (PowerShell для несуществующего процесса — exit 1). Две находки low и одна вне diff исправлены в `2e993da`: комментарий у `found(AGENTS, S7, S7)` обещал то, чего эта строка не показывает; пропущенный пробел; два отказа `bindings.signals` теперь тоже сверяют текст («bindings.signals: invalid input»). Этот test под мутантом URL падает раньше — на строке, где ему нужна найденная Session, — так что закрепление делает его только строже.
- После `7124f82` и `2e993da`: `claude-home-registry.test.ts` отдельно — 7 упали, 64 прошли из 71 (все семь — наблюдение за Claude home, ниже); `bindings.test.ts` и `claude-home-subagents.test.ts` отдельно — 45 из 45. `pnpm lint`, `pnpm typecheck` на `2e993da` — exit 0.

**Не сделано и не проверено в срезе 3a:** macOS и Linux — имена папок через `projectDir()` там совпадают с fixture по построению, запуском на Mac не проверено.

**Вне скоупа, найдено попутно:**
- **7 test-ов наблюдения за Claude home в `claude-home-registry.test.ts` падают из-за кода, а не test-а** — кандидат в отдельный Ticket. `src/main/claude-home/registry.ts:701-704`: фильтр `ignored` сравнивает путь с `this.home` строкой (`path === this.home`), а chokidar 5.0.0 на Windows отдаёт ему `C:/…/claude` с `/`. Сравнение ложно, `relative(projectsDir, home)` даёт `..`, и вся Claude home считается игнорируемой. Замер 2026-10-14 (`t14c/sessions/watch-debug.txt` на ПК): первые пути, которые получил `ignored`, — с `/`; изменений за 1,5 с — 0. В жизни это значит: на Windows список Session-ов не обновляется сам, пока его не запросят заново.
- **Подмены #401 (`test/fixtures/harness-stub`, `workflow-stub`, `qmd-stub`, `gh`) на Windows не запускаются** (`workflow-reader`, `github-prs`, `harness-qmd`, `docs`): это bash-скрипты `#!/bin/sh` без расширения, а Node на Windows без shell запускает только `.exe` и `.com` — `spawnSync` даёт `ENOENT` (errno -4058) и по полному пути, и по имени в PATH (проба на ПК 2026-10-16). Кроме того, в рабочей копии они с CRLF (`git ls-files --eol`: `i/lf w/crlf attr/`): `.gitattributes` не задаёт `eol=lf` для `test/fixtures/**`. `symlinkSync` на этом ПК проходит — включён режим разработчика (`AllowDevelopmentWithoutDevLicense = 1`); без него Windows отказала бы с `EPERM`. Это предмет срезов 3b и 3c (подмены через Node: `gh-stub.mjs` уже есть в #401).

### Срез 3b — подмена `gh` идёт через Node

Session на Windows-ПК, 2026-10-17. Windows 11 Pro 10.0.26200; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/14-stand-ins` от main `eb96efe`, три commit-а и этот раздел. **На macOS и Linux с ПК ничего не запускалось.**

- **Подмена `gh` (`326328e`).** Это commit `ead8af1` с ветки `worfy-windows/14-stand-in-launcher` (запушена 2026-10-14, PR не было), перенесённый cherry-pick-ом без конфликтов. `src/main/program.ts` (новый): `programStart(override, usual)`. Подмена, которая кончается на `.mjs`, запускается как скрипт собственного Node worfy: файл — `process.execPath`, скрипт — первый аргумент, `ELECTRON_RUN_AS_NODE=1` — только в окружении этого дочернего процесса. Любая другая подмена запускается как есть. Без подмены `gh` запускается как раньше. Так на всех системах. `ghRunner` (`src/main/github/prs.ts`) запускает `gh` через неё; `GhProgram.command` (`src/main/github/accounts.ts`, `src/main/ipc/projects.ts`) — только подмена. В test-ах на Windows подмена — сам `gh-stub.mjs`, на macOS и Linux — обёртка `gh`, как раньше (`STUB_COMMAND` в `test/contract/gh-world.ts`, `GH_STUB` в `test/e2e/helpers.ts`).
- **`faa0e1c`.**
  - `test/fixtures/gh/gh-account` (`#!/bin/sh`, пришёл с #401) стал `gh-account.mjs` с теми же ответами и строками лога, на всех системах. PATH ему не нужен, как и раньше (test-ы зовут его с `PATH=/usr/bin:/bin`), и он по-прежнему один файл fixture, а не скрипт на test (worfy-polish Ticket 30).
  - `github-accounts`: два test-а на настоящем pseudo-terminal на Windows пропущены. Вход идёт через `/bin/sh`, которого на Windows нет (node-pty: «File not found:»). Это дефект продукта; чинит его и снимает пропуск Ticket [50](50-sign-in-with-gh-на-windows.md).
  - `github-prs`, «drops keys a handler adds beyond the contract»: обработчик приводит корень к абсолютному пути, ожидание — `resolve('/r')`: `/r` на macOS и Linux, `C:\r` на Windows.
  - `github-prs`, «no account (…)»: начало строки лога сверяется как текст. В `RegExp` из корня обратные косые черты пути Windows читались как escape-последовательности.
- **Ревью** — subagent этой Session, линза «корректность»: на macOS и Linux поведение не меняется, ни одна проверка не ослаблена; `gh-account.mjs` отвечает как скрипт `sh` во всех ветках. Одна находка low исправлена в `c89824e`: подмена `.mjs`, которой нет, давала ошибку Node «Cannot find module» вместо «gh not found (<путь>)» — исполняемый файл worfy есть всегда, и система об отсутствии не сообщает. Теперь `ghRunner` проверяет скрипт сам; test в `gh-stand-in.test.ts`.

| `pnpm test` | Exit | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| main `eb96efe` | 1 | 5539 | 4987 | 411 | 141 |
| ветка `c89824e` | 1 | 5556 | 5037 | 376 | 143 |

| Файл | main: упало | ветка: упало |
|---|---|---|
| `github-accounts.test.ts` | 15 из 20 | 0 из 20, 2 пропущены (Ticket 50) |
| `github-prs.test.ts` | 24 из 69 | 12 из 69 |
| `projects-connect.test.ts` | 6 из 31 | 4 из 31 |
| `gh-stand-in.test.ts` (новый) | — | 0 из 5 |
| `program.test.ts` (новый) | — | 0 из 12 |

- **Новых падений по именам нет.** На ветке и не на main упали 2 test-а, оба в файлах, которые срез не трогал: `critical-path` (timeout 5 с) и `terminal-windows` (`EBUSY` при удалении временной папки). Эти два файла отдельно на обеих сторонах: одинаково, 1 упал из 42 — один и тот же test `critical-path` «takes the journals folder … else the macOS data folder».
- **Перестали падать 37 test-ов** (из них 2 теперь пропущены): `github-accounts` 15, `github-prs` 12, `projects-connect` 2 и ещё 8 в файлах, которые срез не трогал (`terminal-windows` 3, `check-handoff`, `critical-path`, `autopilot-background`, `startup-failure`, `terminal` по 1) — шум между прогонами.
- `pnpm lint`, `pnpm typecheck` на `c89824e` — exit 0.

**Что осталось красным и чьё:**
- `github-prs` — 12 test-ов группы «gh with the Project's GitHub account»: им нужен `bin/profile` Claude home — stub `test/fixtures/harness-stub/canned` (`#!/bin/sh`), который worfy запускает напрямую. На Windows он не стартует, учётная запись не читается. Подмены скриптов Harness — Ticket [05](05-скрипты-bin-harness-на-node.md). `gh` в этих test-ах уже запускается: его вызовы видны в логе.
- e2e `silent-project.spec.ts` пишет свой `gh` (`gh.cjs` и обёртку `sh`) и свои скрипты Harness `#!/bin/sh` (`epic-status` и другие). Одна подмена `gh` его на Windows не запустит; срез его не трогает — скрипты Harness, Ticket 05.
- Вход «Sign in with gh» на Windows — Ticket 50.

- **e2e `window.spec.ts`** (в нём два test-а с `GH_STUB`) на ПК, `electron-vite build` и Playwright: main `eb96efe` и ветка `c89824e` одинаково — exit 1, 4 прошли, 2 упали. Оба падения не о `gh`: «traffic lights sit inset» зовёт `getWindowButtonPosition`, которого на Windows нет, а «a moved or resized window is saved at once» падает на `EBUSY` при удалении папки данных. Test-ы с `GH_STUB` прошли на обеих сторонах; ответ `gh` им не нужен, так что запуск подмены они не доказывают — его доказывает `gh-stand-in.test.ts`.

- **Ревью Session на Mac** (глубина high: корректность против main на macOS, безопасность `programStart` и `ELECTRON_RUN_AS_NODE`, мутанты `program.ts`): безопасность чистая — `WORFY_GH` и `command` берутся только из окружения main-процесса; из 25 мутантов выжили 9. Исправлено в `c297b5f`:
  - `ELECTRON_RUN_AS_NODE=1` в дочернем процессе ничто не проверяло: без переменной Electron всё равно запускает `.mjs` — как главный скрипт второго приложения, с тем же ответом. `gh-stub.mjs` пишет в `GH_STUB_RUNTIME`, как его запустили (`runAsNode`, `process.type`), и `gh-stand-in.test.ts` ждёт `{"runAsNode":"1","type":null}`. Неверный комментарий об этом в test-е исправлен.
  - `ghRunner` без `command` ничто не вызывало: test запускает `gh` из PATH (обёртка `test/fixtures/gh/gh`; на Windows пропущен — обёртку там не запустить) и test «gh not found (gh)» без `gh` в PATH (на всех системах).
  - Относительный `.mjs` искался от корня Project-а, где идёт `gh`: `programStart` приводит его к абсолютному от папки worfy; путь, абсолютный в форме POSIX или Windows, не трогает.
  - Значение `gh` по умолчанию у `signInRegistry`: test с подставленным spawn, который только записывает вызов.
  - Мутанты на ПК после правки: без `...start.env` падают 3 test-а, без приведения пути — 2.
  - **Не сделано:** у `appGh` (`src/main/ipc/projects.ts`) нет contract-test-а — кандидат на отдельный Ticket.
**Не проверено:** `packaged.spec.ts` на Windows (собранное приложение — срез 5); на macOS и Linux `GH_STUB` — та же обёртка, что раньше.

### Срез 3c — установщик Harness запускает подмену Claude Code через Node

Session на Windows-ПК, 2026-10-17. Windows 11 Pro 10.0.26200; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/14-claude-stand-in` от ветки среза 3b (`worfy-windows/14-stand-ins`, `3e12843`). **На macOS и Linux с ПК ничего не запускалось.**

- **Установщик (`src/main/harness/install.ts`).** Каждый шаг установки Harness запускает `claude`. Test-ы подставляют вместо него stub через `WORFY_CLAUDE` (или опцию `claude`): скрипт Node с обёрткой `#!/bin/sh`, которую Windows запустить не может. Поэтому на Windows из 46 test-ов `harness-install.test.ts` падали 34. Теперь `claude` запускается через `programStart` из среза 3b: путь на `.mjs` идёт скриптом собственного Node worfy с `ELECTRON_RUN_AS_NODE=1` для этого дочернего процесса; любой другой путь, в том числе `claude` или `claude.exe` из SDK, запускается как есть. `.mjs`, которого нет, — «Claude Code not found at <путь> (ENOENT)», как отсутствующий исполняемый файл.
- **Test-ы (`test/contract/harness-install.test.ts`).**
  - На Windows подмена — сам `claude-stub.mjs`; на macOS и Linux — обёртка, как раньше.
  - Два stub-а «перед stub-ом» стали скриптами Node на всех системах (`frontStub`): отвечают на свой один случай, остальное отдают `claude-stub.mjs` через import.
  - `claudeCommandEnv`: ожидаемые `HOME` и `CLAUDE_CONFIG_DIR` — `resolve('/tmp/…')`: `/tmp/…` на macOS и Linux, `C:\tmp\…` на Windows.
  - Новые test-ы: подмена `.mjs` идёт под Node worfy на всех системах (stub пишет в `STUB_CLAUDE_RUNTIME`: `ELECTRON_RUN_AS_NODE` «1», `process.type` null); `.mjs`, которого нет, — «Claude Code not found».
- **Мутанты на ПК** (`harness-install.test.ts`): без `...start.env` падают 34 test-а, без `programStart` — 34, без проверки существования скрипта — 1.

- **Ревью** — subagent этой Session, линза «корректность»: настоящий `claude` из SDK и `#!/bin/sh`-обёртки e2e запускаются как раньше; окружение и тексты ошибок для путей не `.mjs` не изменились; Node-front-ы отвечают как прежние скрипты `sh` (строка `"$*"`, коды выхода 0 и 4, stdout, stderr, файл-метка); на macOS и Linux ни одна проверка не ослаблена. Одна находка low — комментарий test-а; уточнён в `d06ff45`: проверка `process.type` что-то значит, потому что `pnpm test` идёт в Electron, под голым Node она упасть не может. Вне линзы: для `.mjs` ENOENT от самого `execFile` значил бы, что нет исполняемого файла worfy, а текст назовёт путь `.mjs` — в работающем приложении маловероятно, не правилось.

| `pnpm test` | Exit | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| срез 3b `3e12843` | 1 | 5607 | 5122 | 341 | 144 |
| ветка `d06ff45` | 1 | 5609 | 5164 | 301 | 144 |

| Файл | 3b: упало | ветка: упало |
|---|---|---|
| `harness-install.test.ts` | 34 из 46, 2 пропущены | 0 из 48, 2 пропущены (только macOS) |

- **Новых падений по именам нет.** Перестали падать 40 test-ов: 34 в `harness-install` и 6 в файлах, которые установщик не запускают (`startup-failure` 3, `projects-connect`, `terminal-windows`, `terminal` по 1) — разница между прогонами.
- **Слияние с main `4500799`** (#411 и #408): конфликт add/add в `src/main/program.ts` решён в пользу 3c — файл main совпадает с головой 3b, 3c менял только комментарии. На слитом дереве `aad6600`: `harness-install`, `gh-stand-in`, `program`, `github-accounts` — как до слияния; `link-pairing` (из #408) — 51 прошёл; `github-prs` — те же 12 падений (`bin/profile`, Ticket 05). `pnpm lint`, `pnpm typecheck` — exit 0.

**Что осталось и чьё:**
- На Windows R6 и R10 (ревью Mac среза 3b: `ghRunner` без подмены зовёт настоящий `gh` из PATH) сторожит только test с настоящим `gh`, а он на Windows пропущен (`skipIf(win32)`: обёртку `sh` там не запустить). Test «gh not found (gh)» (`gh-stand-in.test.ts`) проходит и с этими мутантами. Замечание Session на Mac, уровень low.
- `bundledClaudeBinary` в dev-запуске (`pnpm dev`) отдаёт путь `…/claude` без `.exe` и на Windows (`src/main/agent/options.ts:102`); путь собранного приложения (`:87`) `.exe` добавляет. Не проверено, срез его не трогает — собранное приложение и dev-запуск на Windows, срез 5.
- `harness-migrate.test.ts` падает на Windows по своим причинам, не из-за запуска `claude`: пути Windows в JSON без экранирования («Bad escaped character»), ожидания путей POSIX, «no node in PATH». Отдельная область.

### Срез 3d — `workflow-profile`: ожидаемые пути пишутся так же, как их пишет приложение

Session на Windows-ПК, 2026-10-18. Windows 11 Pro 10.0.26200, Git Bash, `gh` вне PATH. Ветка `worfy-windows/wp-paths` от main `62a4c4a`. **На macOS и Linux с ПК ничего не запускалось.**

- **Что падало.** На Windows `test/contract/workflow-profile.test.ts` — 29 падений из 87, все на написании путей в ожидаемых значениях: test ждал `/repo`, `/work/atakama` и `no profile script at /h/bin/profile`, а приложение на Windows пишет `C:\repo`, `C:\work\atakama` и `\h\bin\profile`.
- **Что сделано (только test).** Ожидаемые пути строятся так же, как их строит приложение. Корень Project-а — `resolve(…)` (`src/main/workflow/folder.ts:123`). Путь скрипта — `join('/h', 'bin', 'profile')` (`src/main/workflow/profile.ts:67`). Строки лога `[workflow] <корень>: …` — регулярное выражение из экранированного `resolve(root)` с тем же якорем `^`. На macOS и Linux каждое ожидание даёт ту же строку, что и раньше. Пути, которые Harness напечатал (`workflowFolder`, `ticketsRoot` от `ticket root`, `repos`), сравниваются с литералами как напечатанные — как и раньше.
- **`ticketsRoot` без буквы диска** (`\work\atakama\.scratch`) в трёх случаях «`ticket root` failing» — следствие данных test-а, не ошибка приложения. Приложение берёт `workflowFolder` как его напечатал Harness (`folder.ts:137`) и строит `ticketsRoot` через `join(workflowFolder, '.scratch')` (`:140`). Test подаёт POSIX-путь приложению на Windows; Harness на Windows печатает пути `C:\…`. Разрешать `workflowFolder` в приложении — изменение поведения для удалённых и POSIX-корней; срез его не делает.
- **Ревью** — subagent этой Session, линзы «корректность» и «сила test-ов»: ни одно утверждение не ослаблено, пропусков не добавлено, `escapeRegExp` верен, якорь `workflowLine` тот же. На Windows test стал строже: приложение без `resolve()` или с `path.posix` его уронит. Находок нет.

| `vitest run --project contract test/contract/workflow-profile.test.ts` | Exit | Passed | Failed | Skipped |
|---|---|---|---|---|
| main `62a4c4a` | 1 | 57 | 29 | 1 |
| ветка | 0 | 86 | 0 | 1 |

- Пропуск — прежний `skipIf(win32)` test-а профиля shell-а, не из этого среза. `pnpm lint`, `pnpm typecheck` — exit 0. Полный `pnpm test` на ПК не прогонялся: срез меняет только этот файл.

### Срез 3e — `epic-wave-ship-ticket.test.sh`, раздел 9, на Windows (2026-10-18)

- **Что падало.** На Windows test доходил до раздела 9 (Pipeline, worfy ADR-0067) и останавливался: `REFUSED: node would start nothing for gh (no override variable), not a stand-in` — 262 ok, exit 1, на main и на ветке PR #461 одинаково. За этим guard-ом ждали ещё две вещи: jq для Windows пишет CRLF, и в Git Bash нет zsh.
- **Что сделано (только test, `harness/bin/tests/epic-wave-ship-ticket.test.sh`):**
  - после stub-а `gh` — `refusing_gh_exe "$GHS/gh"` (`gh-stand-in.sh`): на Windows рядом лежит `gh.exe` — копия `false`, поэтому node, который ищет только `gh.com`/`gh.exe`, получает отказ, а не настоящий `gh`; так же сделано в `gh-override.test.sh`;
  - stub `gh` убирает `\r` из вывода `jq -rc` и возвращает код jq (`PIPESTATUS`): настоящий `gh` печатает LF;
  - три цикла `for sh in bash zsh` идут по `SHELLS`: в Git Bash на Windows без zsh — `bash` и одна строка `skip zsh: …`, как в `skill-blocks.test.sh`; на macOS и Linux нет zsh — по-прежнему падение.
- **ПК** (Git Bash, jq 1.8.2 для Windows, внешний `gh` — stand-in, 0 вызовов): main `ee6c253` — exit 1, 262 ok, REFUSED; ветка — **exit 0, 314 ok, 0 FAIL**, одна строка skip zsh.
- **Мутанты** (каждый по одному, файл восстановлен): без `tr -d '\r'` — exit 1, 1 FAIL («a successful Deployment of a commit that contains the merge — deployed»); без `refusing_gh_exe` — exit 1, снова REFUSED; без пропуска zsh — exit 1, 22 FAIL «zsh: …». Каждая из трёх правок нужна.
- На Mac test должен остаться зелёным с zsh-случаями (там `SHELLS=(bash zsh)`, `refusing_gh_exe` ничего не делает, `tr` ничего не меняет).

### Сверка статуса (Session на Mac, 2026-10-18)

- Влиты срезы 1, 2, 3a–3e (#299, #304, #407, #411, #413, #463, #481); ни один из десяти пунктов «Готово, когда» не отмечен, все ждут итоговой проверки — `pnpm test` exit 0 на ПК, пять test-ов macOS и `grep Meta` с `pnpm test:e2e` на Mac (срез 2 сделал правку, отметки нет), e2e `terminal.spec.ts` и `pnpm test:package` на ПК, `harness-scripts.test.ts` через Git Bash, gate full на ПК и на Mac по итогу, `ci.yml` и ручной прогон job `windows` с согласия владельца; статус не меняется.

### Прогон всего набора на ПК и gate fast ПК (Session на Mac, 2026-10-18, вечер)

- **Весь набор на ПК.** `GATE_SCOPE=all gate.sh fast` на main `7ea3fbd`, Windows-ПК, 2026-10-18: exit 2,
  1326 s. lint и typecheck — зелёные. `pnpm test`: упали 30 файлов из 297 и 216 test-ов из 6325;
  5813 passed, 296 skipped. Среди падений: `startup-failure.test.ts:232` (ждёт `ENOTDIR`, исключения
  нет); `workflow-reader`, чтение размера Auction — 648 ms при пределе 300 ms. Для сравнения: первый
  подсчёт этого Ticket-а — 55 файлов из 157 и 662 test-а из 2995.
- **gate fast на ПК — `lint` и `typecheck`, пока не закрыт Ticket 14** (решение владельца в чате ПК; Harness
  home `2bb021e`). `pnpm test` в gate fast ПК вернётся, когда весь набор станет зелёным на Windows.
- **Junction по GUID и `rmdir`.** Замер Ticket-а 45 (PR #499): `cmd /c rmdir /s /q` на junction по GUID
  (цель `\\?\Volume{…}\…`) снимает только сам junction — файлы за ним остаются, как и у `rmdir` без
  ключей. Для ручной чистки `%TEMP%` от папок test-ов на ПК это безопасный способ.

### Срез 3f — gate-state, harness-plugin, harness-qmd, harness-drift (2026-10-19)

- `test/unit/gate-state.test.ts`: 9 failed / 89 passed → 98 passed, exit 0. `gateTag` сверяется с записанными значениями `printf %s <path> | shasum` (без `/bin/sh`); таблица `gateRunDir` и первый test `gateOutputs` с путями macOS идут с `platform` `'darwin'`, две строки с `homedir()` — на платформе машины. `listWorktrees` ждёт путь так, как его печатает git (`git rev-parse --show-toplevel`, `C:/…` на Windows): в `src/` все потребители либо сводят `\` и `/` (`worktreeOfCwd`, `comparable`), либо берут realpath (`onDisk`) или `projectDirName`, где `\` и `/` дают одно имя, — бага нет, `src/main/gate/state.ts` не менялся.
- `test/contract/harness-plugin.test.ts`: 1 failed / 9 passed → 10 passed, exit 0. `listFiles` отдаёт пути с `/`, проверки шаблонов на Windows теперь настоящие.
- `test/contract/harness-qmd.test.ts`: 11 failed / 8 passed → 9 passed / 10 skipped, exit 0. Десять test-ов со stand-in-ами `/bin/sh` пропускаются на win32 с причиной «qmd scripts are zsh/sh until worfy-windows ticket 15» (в `it.for` — только строка с node-stand-in-ом); ключи `snapshot()` с `/`, test «skipping writes skipped» идёт на Windows.
- `test/contract/harness-drift.test.ts`: 2 failed / 13 passed → 15 passed, exit 0. Логирующий git — Node-скрипт `git.mjs`; `src/main/autopilot/harness-drift.ts` запускает подмену git через `programStart` (`src/main/program.ts`). Без правки в `src/` новый test красный на Windows (`spawn EFTYPE`); без подмены (`git` не передан) запуск прежний.

### Срез 3i — пути в ожиданиях unit- и contract-test-ов (2026-10-19)

Только test-ы, `src/` не менялся: ожидания строятся так же, как путь строит приложение (`resolve`, `join`, `posix.join` для runtime darwin, `sep`, текстовая подстановка `${CLAUDE_PLUGIN_ROOT}`). Windows-ПК, `node scripts/vitest-electron.mjs <файл>`, было → стало (failed/passed/skipped, exit code):

- `paths` 6/12/0 → 0/18/0; `terminal-ai-options` 1/9 → 0/10; `agent-options` 1/31 → 0/32; `critical-path` 1/29 → 0/30; `attachments` 3/39 → 0/42; `agent-attachments` (contract) 1/27 → 0/28; `autopilot-journal` (contract) 1/15 → 0/16; `canvas-tools` (contract) 4/38 → 0/42 — все exit 1 → 0.
- `json-file` 1/12/0 → 0/12/1: `chmod 0o000` на NTFS только ставит read-only, файл читается — skip на win32, посылка не держится на Windows.
- `link-caller` 2/6 → 0/8: Windows сворачивает `..` по буквам до перехода по link-у; для win32 ожидание записано явно, и добавлена проверка, что `secret.txt` через `out-link/..` не открывается. Это не дыра: проверка получает тот же путь, что открывает система.
- `node-pty` (contract) 1/0 → 0/1: на win32 `cmd.exe /c echo ok` с `SystemRoot`, escape-последовательности ConPTY срезаются; 5 прогонов подряд — exit 0.
- `epic-layout` 1/31 → 0/32: property test (240 раскладок ELK) — 7,2 s в одиночку на ПК (три замера 7,18–7,24 s), timeout test-а 30 s. В приложении ELK работает в Web Worker, проблемы производительности в `src/` нет.
- Фильтр `.git/` в `agent-attachments.test.ts` — в test-е, не в `src/`; теперь он отбрасывает и `.git\`.
- **Правки после ревью (линза «test-ы»).** `scripts/critical-path.mjs`: папка данных по умолчанию — по тем же правилам, что `dataRoot` (`src/main/storage/paths.ts`): на Windows `%APPDATA%\worfy` (без `APPDATA` — `<home>\AppData\Roaming\worfy`), на macOS как прежде; раньше на Windows скрипт искал журналы в `\Users\…\Library\Application Support`, а test это закреплял. Test проверяет macOS и Windows с `APPDATA` и без. `link-caller`: на win32 test сверяет и ответ `realInsideProjects` для `out-link/../outside/secret.txt` — `null` или путь внутри Project.

### Срез 3j — подмены инструментов первого запуска на Node; Terminal и `epic-status` в `link-access`

- **`first-run-checks.test.ts`: было 22 failed / 20 passed / 11 skipped (53), exit 1; стало 34 passed / 19 skipped, exit 0.** У каждой `#!/bin/sh`-подмены в `test/fixtures/first-run-tools/` есть порт `<tool>.mjs` (общий журнал вызовов — `stand-in.mjs`). На Windows test кладёт в PATH `<tool>.cmd` с `"<node>" "<tool>.mjs" %*`, а installer запускает `claude.mjs` по пути (`programStart`). `checks.ts` находит и запускает `.cmd` верно (`toolStart`): правки в `src` нет. Строки проверок по-прежнему описывают Mac (`system: darwin`), а `probes.run` на Windows — `runTool` этой машины. В `loginEnv` на Windows добавлен `SystemRoot`. На macOS и Linux test идёт по-старому: symlink-и на `/bin/sh`-подмены, без `probes`. Shell-подмены остаются, их используют `terminal.test.ts` и e2e. Расплата — две копии логики (README говорит менять обе).
- **Строка Harness scripts теперь идёт и на Windows: 44 passed / 9 skipped, exit 0.** Раньше этот `describe` (10 test-ов) пропускался без причины. Нужно было одно: настоящий node берётся из `NODE` (`test/harness-node.ts`) и кладётся ссылкой `node.exe`. На Windows `nodeOnPath` берёт для скрипта Harness только `node.exe`, поэтому в окружении экрана папка с ним идёт после подмен. Правка `src` не понадобилась. На Windows остаётся один skip — «script ended by a signal»; снимать его некому: в Windows нет сигналов, `process.kill(pid, 'SIGSEGV')` даёт `ENOSYS`.
- **8 новых skip на win32 (`itWithQmd`), снимет Ticket 15.** `qmd.ts` запускает `npm`/`node` по голому имени без shell и ищет файл `qmd` без расширения. Probe: `spawnSync('node', ['--version'])` с PATH из одной папки с `node.cmd` даёт `ENOENT` и с `SystemRoot`, и без него. Stand-in `qmd-collections` тоже `#!/bin/sh`. Test «write nothing» на Windows не ждёт `qmd --version`, остальное в нём проверяется.
- **`link-access.test.ts`: было 3 failed / 20 passed (23), exit 1; стало 23 passed, exit 0.** Stand-in `epic-status` теперь `nodeScript` на всех системах. Мутант с `#!/bin/sh` снова роняет первый test на `workflow.changed`. В окружении Terminal на win32 добавлены `SystemRoot` и `windir`: без них PowerShell падает с 8009001d. Третье падение (`terminal.input` refused, :471) вызывала та же причина: shell умирал. После этого всплыла четвёртая причина: Enter теперь `\r`, а не `\n`. PSReadLine считает `\n` переносом строки (`>>`). На POSIX pty переводит `\r` в конец строки.

### Срез 4 (src-paths) — три ошибки в `src/` на Windows (2026-10-19)

### Срез 3h — три ошибки в `src/` на Windows (2026-10-19)

- **`claude-home/registry.ts`, `watch()`:** chokidar 5 на Windows отдаёт пути с `/`, поэтому `path === this.home` не совпадал, корень Claude home попадал в `ignored`, и не наблюдалось ничего. Теперь сравнение через `relative(this.home, path) === ''`; остальная часть callback-а и так идёт через `relative()`.
- **`projects/store.ts`:** git пишет корень как `C:/…`. Хранимый и показанный путь теперь `resolve(...)` (`C:\…`), и `projects.json` старого вида при чтении получает тот же `resolve`. Project id по-прежнему считается от корня в написании git: id уже сохранённых Project-ов на Windows не меняются, на macOS и Linux `resolve` ничего не меняет. Новый test в `projects.test.ts` загружает `projects.json` в написании git и проверяет тот же id, путь `C:\…` и отсутствие второй записи.
- **`startup-failure.ts`, `checkDataFolder`:** на Windows `stat` пути под файлом даёт ENOENT, а не ENOTDIR. При ENOENT решает ближайший существующий путь выше: если это файл — ошибка ENOTDIR, как на macOS.
- **Test-ы:** `projects.test.ts` — случай с chmod 0o000 вынесен в отдельный test и пропущен на win32 (NTFS не снимает чтение), «home folder» подменяет и `USERPROFILE`; `projects-connect.test.ts` — `join(repo, '.claude', 'worktrees') + '/'` и `basename` для ключа gate (с `split('/')` ключ был целым путём, и запись отказывалась); `startup-failure.test.ts` — `resolve(DATA_DIR)` и `waitFor` до 10 s: первый start после `registerIpc` холодно импортирует все IPC-модули, около 2 s на ПК, а незавершённый start показывал своё окно в следующем test-е (отсюда «3 раза» у createMainWindow).
- **ПК, до → после (exit):** `claude-home-registry` 7 failed / 55 passed (1) → 62 passed (0); `projects` 10 failed / 33 passed (1) → 44 passed, 1 skipped (0); `projects-connect` 4 failed / 45 passed / 4 skipped (1) → 49 passed / 4 skipped (0); `startup-failure` 11 failed / 24 passed (1) → 35 passed (0).
- **Красный до правки `src/`** (test-ы новые, `src` откатан): `projects` 8 failed, `projects-connect` 2 failed, `startup-failure` 1 failed (:232); `claude-home-registry` — 7 failed на main.
- **Правки после ревью (линзы «корректность» и «test-ы»).** Уведомление «inside the Project … over several repositories» показывает путь после `resolve()`, как и два других уведомления. Test-ы сверяют тексты уведомлений «is inside the repository» и «is a worktree of» точной строкой: без `resolvePath` в `store.ts` краснеют 2 test-а (замер на ПК). Test старого `projects.json` пишет путь с хвостом `/.`, который `resolve()` убирает на любой системе, — проверка идёт и на macOS/Linux. `checkDataFolder` проверен на два уровня: `file/a/b` → ENOTDIR, `root/x/y` — без ошибки.
- **Короткое 8.3-имя или `subst`-диск в TEMP** (как `C:\Users\RUNNER~1\…` на чистом runner-е GitHub): на ПК проверено через `subst W:` и `TEMP=TMP=W:\` — было 26 failed / 189 passed. Ошибка продукта: `store.ts` сравнивал введённый путь с корнем git через `fs.realpathSync`, который сохраняет 8.3-имя, букву `subst`-диска и регистр, поэтому сам корень в другом написании получал уведомление «is inside the repository … the repository root was added instead». Теперь сравнение через `realpathSync.native` (с запасным `realpathSync`); новый test добавляет корень в другом написании (win32 — нижний регистр и `/`; диск без учёта регистра — другой регистр; иначе — symlink) и ждёт без уведомления одну запись; красный на трёх мутантах. Та же ошибка была в своей копии `realpathOrSelf` в `connect.ts` (шаг 1 подключения: корень в другом написании — «inside the repository», папка с несколькими репозиториями — без репозиториев); исправлена так же, новый test в `projects-connect` красный без правки. Test-ы `clients`, `projects`, `projects-connect` строят корни через `realpathSync.native`. После: 217 passed / 5 skipped (exit 0) и в обычном TEMP, и с `TEMP=W:\`.
