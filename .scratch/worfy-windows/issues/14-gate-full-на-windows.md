# 14 — Gate full на Windows: unit- и e2e-test-ы, ручной job «Windows» в CI

Type: task
Status: open
Blocked by: 03, 08, 10, 11, 12
Source: решения владельца 2026-10-07: Q23 (Windows-раннера на PR нет; gate full на ПК владельца перед мержем платформенных PR; ручной job «Windows»), Q20 (Terminal на Windows — PowerShell, Git Bash — в настройках), Q24 (Windows 10 21H2+ и 11, x64); «Готово, когда» Epic-а, пункт 2 (подтверждено 2026-10-08); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»; [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [spec.md](../spec.md)

## Что происходит

- gate full worfy (запись `worfy` в реестре Gate) — это lint, typecheck, `pnpm test`,
  `pnpm test:e2e` и `pnpm test:package`. Gate на Node и его запуск на Windows делает Ticket 03 (Gate
  на Node). На Windows gate full ещё ни разу не шёл.
- Unit- и contract-test-ы. Что из них падает на Windows, пишет в Итог Ticket 02 (репозиторий
  ставится и запускается на Windows). Ticket-ы 03–12 чинят test-ы своих срезов. Что к началу этого
  Ticket-а ещё красное — его.
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
  Ticket-а 15; `sh` и `bash` есть в PATH, только если там папка `bin` или `usr\bin` Git for Windows (по
  умолчанию установщик Git кладёт в PATH только `cmd`); `bash` из PATH может оказаться
  `C:\Windows\System32\bash.exe` — запуском WSL.
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

## Что делаем

1. **Unit- и contract-test-ы на Windows.** Каждый test из списка Ticket-а 02, который к началу ещё
   красный, — починить (test или код). Если смысл test-а на Windows не держится — пропуск на
   `win32` с комментарием: почему и какой Ticket его снимет. Итоговый список пропусков — в Итог.
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
- [ ] На Mac ни один из пяти test-ов только для macOS не пропущен: `pnpm test --reporter=verbose` показывает их пройденными.
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
код worfy (пункт 7). Остальные файлы из списка Ticket-а 02 исполнитель дописывает сюда до начала
работы: по ним worfy считает пересечения Wave. `playwright.config.ts` и `vitest.config.ts`
меняются, только если без этого test-ы на Windows не идут; тогда они тоже идут в этот список.

Ticket 05 меняет stub-ы скриптов Harness в тех же e2e-файлах, Ticket 13 — `harness-install.test.ts`.
Друг друга они не блокируют; в одну Wave не попадут, второй делает rebase.

## Итог

Заполняется при закрытии.
