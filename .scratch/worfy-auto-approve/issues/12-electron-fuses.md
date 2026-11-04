# 12 — Electron fuses: без Node inspector и run-as-Node в собранном worfy

Type: task
Status: claimed 2026-11-04T17:20Z
Blocked by: —
Source: [spec.md](../spec.md), «Безопасность», п. 5 (известный предел до этого Ticket-а); review PR #1368 (Ticket 06)

Платформенный: меняет сборку приложения на macOS и Windows; вердикт Windows обязателен. Глубина ревью: high.

## Что происходит

- В собранном worfy Electron fuses не настроены: `electron-builder.yml` без `electronFuses`, после упаковки их никто не
  переключает (`src/main/program.ts:23-25`). Значит, `EnableNodeCliInspectArguments` и `RunAsNode` включены.
- Ticket 06 держит Auto-approval в Off, пока открыт debugging port или Node inspector (`debugAccess()` в
  `src/main/settings/store.ts`). Но Bash агента может послать `kill -USR1 <pid worfy>`: main откроет inspector на
  `ws://127.0.0.1:9229`, через `Runtime.evaluate` можно записать On в память store-а и закрыть inspector
  (`inspector.close()`). После этого `inspector.url()` пуст, проверка ничего не видит, `autoApprovalMode()` отвечает On.
- С включённым `RunAsNode` любой процесс Machine запускает бинарь worfy как Node (`ELECTRON_RUN_AS_NODE=1`), с правами и
  подписью worfy.

## Что делаем

1. Сначала найти каждое место, где собранный worfy полагается на run-as-Node или Node inspector, и перечислить их в
   «Итог». Известные на момент записи:
   - `src/main/program.ts:72` — override программы (`WORFY_GH` и др.), который кончается на `.mjs`, стартует как
     `process.execPath` с `ELECTRON_RUN_AS_NODE=1`;
   - `src/main/vendors/codex/launch.ts:56-58` — fake Codex (`WORFY_CODEX=fake`) стартует так же;
   - `scripts/vitest-electron.mjs:80`, `scripts/eval-run-env.mjs:97`, `scripts/terminal-flood-bench.mjs` — dev и test
     (не собранное приложение, но проверить, не запускают ли они собранный бинарь);
   - `test/e2e/launch-env.ts:67-71`, `test/e2e/projects-connect.spec.ts:290`, `test/e2e/packaged.spec.ts`,
     `test/e2e/helpers.ts` — e2e, в том числе запуск СОБРАННОГО приложения;
   - Harness и statusline bridge: запускают ли они бинарь worfy как Node.
   Для каждого — что ломается без fuse и чем заменить (обычный `node` с PATH, `utilityProcess.fork`, только dev).
2. Выключить fuses `EnableNodeCliInspectArguments` и `RunAsNode` в собранном приложении: `electronFuses` в
   `electron-builder.yml` или hook `afterPack` с `@electron/fuses`. Остальные fuses — по итогам п. 1, с причиной в «Итог».
3. Test: у собранного приложения эти fuses выключены — `npx @electron/fuses read --app <app>` в job-е `macos-package`
   (и в сборке Windows), либо contract test конфигурации сборки.
4. Windows — то же: сборка `.exe`, проверка fuses, вердикт Windows.
5. После слияния — в spec «Безопасность», п. 5 предел снять; Ticket 04 и 11 разблокированы этим Ticket-ом.

Не трогать `scripts/install-stable.mjs` и `src/main/update/` без согласования с orchestrator-ом (их держит другая
сессия).

## Готово, когда

- [x] В «Итог» — список мест, где собранный worfy полагался на run-as-Node или inspector, и что с каждым сделано.
  - evidence: commit pass · Turn off the RunAsNode and Node inspector fuses in the packaged app · - - · 97309f78714972fe2445aeb1aa2cf83c0938a128
- [ ] В собранном приложении (macOS и Windows) `EnableNodeCliInspectArguments` и `RunAsNode` выключены; test это
      проверяет в CI.
- [x] `kill -USR1 <pid>` собранного worfy не открывает inspector (ручная проверка или e2e собранного приложения).
  - evidence: test-run pass · `pnpm test:package`: 21 passed, check-fuses both disabled (packaged.spec.ts kill -USR1 test) · mac - · 97309f78714972fe2445aeb1aa2cf83c0938a128
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный, вердикт Windows зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 97309f78714972fe2445aeb1aa2cf83c0938a128

## Где в коде

- `electron-builder.yml`, `package.json`
- `src/main/program.ts`, `src/main/vendors/codex/launch.ts`
- `test/contract/electron-fuses.test.ts` (новый) или шаг job-а `macos-package` в `.github/workflows/ci.yml`
- сверх следа (нужно для test-ов собранного приложения): `test/e2e/fuses.ts` (новый), `scripts/check-fuses.mjs` (новый),
  `test/e2e/packaged.spec.ts`, `test/e2e/terminal.spec.ts`, `test/acceptance/e3.spec.ts`, `scripts/ci-scope.mjs`,
  `test/unit/program.test.ts`, `test/unit/codex-in-build.test.ts`, `test/unit/e2e-gh-stub.test.ts`; страница
  `docs/features/sessions.md`

## Итог

Сделано в PR (ветка `worfy-auto-approve/12`). `electron-builder.yml` → `electronFuses: { runAsNode: false,
enableNodeCliInspectArguments: false }`; electron-builder переключает их в `worfy` / `worfy.exe` перед подписью.

**Шаг 1 — где собранный worfy полагался на run-as-Node или Node inspector, и что сделано:**

| Место | Что ломалось без fuse | Что сделано |
|---|---|---|
| `src/main/program.ts` `programStart` — `.mjs` override (`WORFY_GH`, `WORFY_CLAUDE`, override `git` в `harness-drift.ts`) | ставят только test-ы; в собранном приложении `ELECTRON_RUN_AS_NODE=1` запустил бы второй worfy вместо Node (на Windows packaged test-ы дают `gh-stub.mjs`) | новый `scriptRunner`: stock Electron из `node_modules` (`electron`, `electron.exe` — правило `app.isPackaged`) — как раньше, сам в run-as-Node; любой другой файл (собранный `worfy`, `worfy.exe`) — `node` по имени, его находит PATH ребёнка |
| `programStartInPty` | на Windows уже `node.exe` из Path; вне Windows — `programStart` | передаёт `platform` в `programStart` |
| `src/main/vendors/codex/launch.ts` — `WORFY_CODEX=fake` | собранное приложение при старте читает Limits Codex и запускало второй worfy (видно на копии с fuse выкл.: `another worfy already runs over <data>; quitting`) | тот же `scriptRunner`. Fake в `app.asar` не попадает (`test/fixtures` вне `files`), поэтому в собранном приложении он не работал и до Ticket-а; теперь `node` не находит файл — тот же отказ, без второго окна |
| `scripts/vitest-electron.mjs:80`, `scripts/terminal-flood-bench.mjs`, `scripts/eval-run-env.mjs:97` | ничего: запускают Electron из `node_modules` или node скрипта, не собранный бинарь | не тронуто |
| `test/e2e/launch-env.ts:67-71`, `test/e2e/projects-connect.spec.ts:290` | ничего: первое убирает `ELECTRON_RUN_AS_NODE` из env приложения, второе — `process.execPath` процесса test-а (node) | не тронуто |
| Playwright `_electron.launch`: `test/e2e/helpers.ts` (`launchApp` с `executablePath`), `packaged.spec.ts` (9 запусков), `terminal.spec.ts:697`, `test/acceptance/e3.spec.ts` | всегда передаёт `--inspect=0` и ждёт `Debugger listening on ws://` (playwright-core 1.63, `lib/coreBundle.js:44247` и `:44315`), `app.evaluate` идёт через этот inspector; с fuse выкл. запуск виснет | test-ы ведут копию во временной папке с `EnableNodeCliInspectArguments` вкл. (`test/e2e/fuses.ts`, `inspectableCopy` / `enableInspector`) |
| Harness (`~/.claude/worfy-harness/plugin`, только чтение) | ничего: `bin/*` и `hooks/*` зовут `process.execPath` того node, под которым их запустил Claude Code, не бинарь worfy | не тронуто |
| statusline bridge | ничего: `statusline-bridge.sh` зовёт `node` из PATH (или `jq`); на Windows `statusLine` называет `statusline-bridge.mjs`, его запускает node (`src/main/harness/status-line.ts`) | не тронуто |
| `src/main/workflow/profile.ts`, `src/main/update/*`, `src/main/harness/qmd.ts` | ничего: `node` / `node.exe` из PATH | не тронуто |
| `src/main/settings/store.ts` `debugAccess()` | только читает `inspector.url()` и argv | не тронуто |

`--remote-debugging-port` / `--remote-debugging-pipe` (Chromium CDP) — не fuse Node, его fuses не меняют. Сессия,
которая ведёт установленный Stable по CDP, работает как раньше; Auto-approval при таком флаге по-прежнему Off —
это проверка Ticket-а 06 (`debugAccess()`).

**Почему test-ы ведут не тот бинарь, что уходит пользователю.** Playwright `_electron.launch` не умеет вести
Electron без Node inspector (строки выше). Поэтому `test/e2e/fuses.ts` делает копию сборки во временной папке и
включает в копии один fuse — `EnableNodeCliInspectArguments`. Что она отличается только им, проверяет test
`packaged.spec.ts` «the copy the Playwright tests launch differs from it by EnableNodeCliInspectArguments only»:
читает все fuses обеих и сравнивает файлы (на macOS кроме fuse меняется только ad-hoc подпись: `Electron Framework`,
`Contents/MacOS/worfy`, `_CodeSignature/`; на Windows — только `worfy.exe`). Helper пишет только во временную папку,
отказывает для `dist/` и для папки, которую копирует; `dist/` и установленный Stable он не трогает.
`pnpm test:package` последним шагом читает fuses самой `dist/`-сборки (`scripts/check-fuses.mjs`): ошибка helper-а,
записавшая в `dist/`, делает job `macos-package` красным.

**Что flip делает с подписью.** macOS: fuses лежат в `Electron Framework`; изменённый байт ломает ad-hoc подпись
electron-builder, а arm64 Mac такой бинарь не запустит, поэтому `@electron/fuses` подписывает копию ad-hoc заново
(`resetAdHocDarwinSignature`: `codesign --sign - --force --deep`, с сохранением entitlements, requirements, flags,
runtime); `codesign --verify --deep --strict` копии — exit 0, `Identifier=dev.worfy.app`, `Signature=adhoc`.
Windows: fuses лежат в самом `worfy.exe`; сборка не подписана (сертификата нет до E4), подписи ломать нечего.
Packaged test-ы Windows — те же spec-и, тот же helper.

**Windows не проверен в CI — прямо.** Ни один job CI не читает fuses `.exe`: `windows-e2e` идёт с
`--grep-invert @packaged`, а `windows` — это `pnpm test` (там только contract test конфигурации и `check-fuses.mjs` на
stand-in-ах). Ветка `process._debugProcess` test-а SIGUSR1 ни разу не запускалась. Проверка на Windows — gate full на ПК
после Wave: `pnpm test:package` собирает `.exe`, гоняет packaged spec-и и последним шагом `check-fuses.mjs`. Пункт
«Готово, когда» про Windows закрывает этот прогон на ПК, не CI.

**Проверки.**
- `test/contract/electron-fuses.test.ts` (все ОС, CI): `electronFuses` ровно с двумя выключенными fuses;
  `test:package` кончается `node scripts/check-fuses.mjs` после Playwright; `check-fuses.mjs` на stand-in бинарях
  (exit 0 / exit 1 с именем включённого fuse, `.app` через `Electron Framework`, файл без fuse wire) и на stock
  Electron (exit 1, оба включены).
- `test/e2e/packaged.spec.ts` (@packaged, `macos-package`): у копии fuses выкл.; `kill -USR1` (на Windows
  `process._debugProcess`) inspector не открывает — на macOS процесс кончается сигналом SIGUSR1, строки
  `Debugger listening` нет; та же просьба к копии с fuse вкл. inspector открывает (контроль: просьба дошла,
  остановил её fuse); `ELECTRON_RUN_AS_NODE=1 worfy -e …` запускает worfy, а не скрипт, stock Electron — скрипт.
- `test/unit/program.test.ts`, `test/unit/codex-in-build.test.ts`: `scriptRunner` для stock Electron и для собранного.

**Решено без владельца.**
- Test-ы собранного приложения ведут копию с одним включённым fuse (план A; согласован с orchestrator-ом). План B —
  переписать packaged test-ы на CDP без `app.evaluate` в main — много больше.
- `.mjs` stand-in в собранном приложении — `node` из PATH ребёнка, а не `utilityProcess.fork`: stand-in-ам нужны
  stdin/stdout ребёнка (Codex app-server говорит JSON-RPC по stdio), а `utilityProcess` даёт stdin только через
  MessagePort.
- Остальные fuses — по умолчанию Electron, каждый по своей причине (состояние — как его печатает `check-fuses.mjs`):
  - `EnableNodeOptionsEnvironmentVariable` (вкл.): собранный Electron сам отбрасывает почти все `NODE_OPTIONS`.
    Проверено одним запуском временной копии `dist/` с `NODE_OPTIONS=--require <файл, пишущий метку>`: окно открылось,
    метки нет, в stderr — `Most NODE_OPTIONs are not supported in packaged apps`; stock Electron с тем же
    `NODE_OPTIONS` метку пишет. Выключать нечего ради этой угрозы.
  - `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation` (выкл.): закрывают подменённый `app.asar` или
    подложенную `Resources/app/`, а это запись в папку приложения — тот же класс, что правка `app-settings.json` при
    закрытом worfy («Безопасность», п. 5, известный предел). Нужна проверка целостности asar в сборке и в копиях
    `install-stable` — отдельная работа.
  - `EnableCookieEncryption` (выкл.): шифрование cookie через Keychain / DPAPI меняет хранилище Browser profiles
    без обратного пути; к угрозе Ticket-а не относится.
  - `LoadBrowserProcessSpecificV8Snapshot` (выкл.): только скорость старта.
  - `GrantFileProtocolExtraPrivileges` (вкл.): renderer грузится из `file://` (`out/renderer/index.html` в бандле);
    выключение требует проверить загрузку renderer-а, к угрозе Ticket-а не относится.
