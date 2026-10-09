# 12 — Сборка на Windows: неподписанный NSIS, иконки, Stable copy

Type: task
Status: open
Blocked by: 08, 09
Source: решения владельца 2026-10-07: Q22 (неподписанный NSIS собирает Session на ПК владельца, подпись — E4; если включён Smart App Control — вопрос подписи сразу), Q24 (только x64), Q23 (gate full на ПК владельца перед мержем платформенных PR) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port» (пункт 5; «Последствия» — Stable copy на Windows); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»; [ADR-0008](../../../docs/adr/0008-claude-code-native-binary-path.md) (`claude` вне app.asar); [ADR-0023](../../../docs/adr/0023-separate-data-roots-packaged-and-dev.md) (папки данных dev и упакованной сборки)

## Что происходит

- **Сборка.** `pnpm package` — это `electron-vite build && electron-builder --mac dir`
  (`package.json:12`). `electron-builder.yml` описывает только macOS: шапка «Local macOS build»
  (`:1-2`), секция `mac:` (`:36-43`), секции `win:` нет. `appId: dev.worfy.app` (`:3`).
- `electronDist: node_modules/electron/dist` (`:23`) — Electron, который pnpm поставил для своей
  системы; на Windows-ПК это Electron для Windows. `asarUnpack` (`:32-34`) уже покрывает
  `node_modules/node-pty/**` и `node_modules/@anthropic-ai/claude-agent-sdk-*/**`, то есть
  `claude.exe` и модуль node-pty. node-pty ищет модуль в `build/Release`, `build/Debug`, затем в
  `prebuilds/<platform>-<arch>` (`node_modules/node-pty/lib/utils.js:19`); в
  `prebuilds/win32-x64` есть `conpty.node` и `pty.node`. `npmRebuild: false` (`:27`).
- `supportedArchitectures` не задан ни в `package.json`, ни в `pnpm-workspace.yaml`. На Mac pnpm не
  ставит `claude-agent-sdk-win32-x64`, поэтому сборка под Windows на Mac не положит `claude.exe`
  (ADR-0054). На Windows-ПК pnpm ставит пакет своей системы сам: на ПК владельца —
  `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.289` с `claude.exe` (evidence Ticket-а 01, раздел 14).
- node-pty из `prebuilds/win32-x64` грузится в Electron 44.5.1 без пересборки (evidence, раздел 09):
  `npmRebuild: false` для Windows подходит.
- **Иконки.** `scripts/make-icons.mjs` рисует PNG через `sips` и пакует `icon.icns` через
  `iconutil` — только macOS (`:101`). Пишет `build/icon.icns`, `build/icon.png` (1024 px) и
  `build/icons.json` с sha256 (`:118-124`). 16 и 32 px — из `build/brand/mark.svg`, от 64 px — из
  `build/brand/icon.svg` (`:26-39`, Ticket 31 Epic-а `worfy-mvp`). `.ico` нет.
  `test/contract/make-icons.test.ts:159-174` сверяет закоммиченные файлы на любой системе; `:176` и
  дальше запускает скрипт, только на macOS (один из пяти test-ов `skipIf(platform !== 'darwin')`,
  их разбирает Ticket 14). На ПК этот test красный: sha256 `build/brand/icon.svg` и `mark.svg` в
  рабочем дереве (CRLF, `core.autocrlf=true`) не совпадают с `build/icons.json` (evidence Ticket-а 01,
  разделы 03 и 17). LF для `build/brand/*.svg` задаёт `.gitattributes` Ticket-а 02 (его пункт 1);
  к началу этого Ticket-а случай sha256 зелёный.
- **Stable copy** (собранная копия worfy вне репозитория, из которой Autopilot ведёт Wave-ы самого
  worfy) ставит `scripts/install-stable.sh` — bash, только `.app`:
  - цель по умолчанию — `~/Applications/worfy-stable.app` (`:25`), цель обязана кончаться на `.app`
    (`:29-32`);
  - отказ, пока копия запущена, — по `ps -axo` (`:41-50`);
  - источник — `dist/mac*/worfy.app` (`:62`) или `WORFY_STABLE_PREBUILT` (`:56-58`); копирование —
    `ditto` во временную папку рядом и переименование (`:76-84`); время сборки — `stat -f %m` от
    `Contents/Info.plist` (`:71`);
  - рядом с копией — `<target>.json` с полями `commit`, `dirty`, `builtAt`, `installedAt`, `source`
    (`:91-99`).
- Вызов — `pnpm install:stable` (`package.json:19`) запускает `.sh` напрямую. pnpm на ПК исполняет
  скрипты через cmd.exe (evidence Ticket-а 01, раздел 10); `.sh` без bash не запустится.
- `test/e2e/packaged.spec.ts` зовёт скрипт через `bash` (`:18`, `:36-40`, `runScript` `:125-127`).
  Блок «with a stand-in app» (`:507` и дальше) идёт в gate full на Mac, блоки `@packaged` — в
  `pnpm test:package`. Test `:518-528` подменяет `HOME` и ждёт копию в `<HOME>/Applications`.
- **Отказ Autopilot над worfy.** `selfProjectRefusal` (`src/main/autopilot/run.ts:168-180`)
  отказывает только не упакованной сборке (`:174`). Установленный worfy и Stable copy — упакованные,
  им отказа нет. Пути сравниваются после `realpath` (`canonical`, `:154-160`). Общая папка git —
  `git rev-parse --path-format=absolute --git-common-dir` (`gitCommonDir`,
  `src/main/ipc/autopilot.ts:33-38`, не экспортирована); на Windows git печатает путь с `/`: в
  worktree на ПК — `C:/Users/Alexey/worfy/.git` (evidence Ticket-а 01, раздел 06). Как он сравнится с
  `realpath` от пути `C:\…`, не проверялось. `test/contract/autopilot.test.ts:708-730`
  подменяет `gitCommonDir`, настоящий git не зовёт.
- **SmartScreen.** Неподписанный установщик: «Windows protected your PC» → More info → Run anyway.
  Smart App Control на Windows 11 неподписанное блокирует (ADR-0054, пункт 5). На ПК владельца он
  выключен: `VerifiedAndReputablePolicyState = 0` (evidence Ticket-а 01, раздел 02); сверка в окне
  Windows Security — за владельцем.
- После 4f983ef `electron-builder.yml` меняли E3 Ticket 15 (#134, мост Limits в ресурсах сборки) и
  worfy-link Ticket 02 (#158); `scripts/install-stable.sh` не менялся; `package.json` — четыре коммита,
  строки сдвинулись (evidence Ticket-а 01, раздел 24). Строки выше — main 4f983ef. Перед началом
  перечитать оба файла и `package.json` на свежем main.

## Что делаем

1. **NSIS x64** (Q22, Q24). В `electron-builder.yml` — секция `win:`: цель `nsis`, `arch: x64`,
   `icon: build/icon.ico`. Настройки `nsis:` — по умолчанию electron-builder (установка для
   текущего пользователя, без прав администратора). Куда установщик ставит worfy — в Итог. Подписи
   нет: сертификата нет, подпись — E4. Шапка файла говорит про обе системы.
   `electronDist` и `supportedArchitectures` не меняются: установщик собирается на Windows-ПК (Q22).
   Если на ПК в `node_modules` нет `claude-agent-sdk-win32-x64` — сначала выяснить почему;
   `supportedArchitectures` в `pnpm-workspace.yaml` — только по этому факту.
2. **Сборка по системе.** `package` — `electron-vite build && electron-builder` без флага системы:
   electron-builder берёт цели своей системы из yml (`mac.target: dir`, `win.target: nsis`). На Mac
   результат прежний — `dist/mac*/worfy.app`. Если нет — `scripts/package.mjs` выбирает
   `--mac dir` или `--win nsis --x64`.
3. **`.ico`.** `scripts/make-icons.mjs` пишет ещё `build/icon.ico`:
   - размеры 16, 24, 32 — из `mark.svg`, 48, 64, 128, 256 — из `icon.svg` (правило Ticket-а 31:
     мелкие размеры — из `mark.svg`);
   - PNG рисует, как прежде, `sips`; упаковка `.ico` — отдельная функция на чистом Node, её
     unit-test идёт на любой системе;
   - sha256 `icon.ico` и список его размеров — в `build/icons.json`;
   - формат записей внутри `.ico` (PNG или BMP) — на выбор Ticket-а; проверка — значок установщика,
     `worfy.exe` в Проводнике, меню Пуск и панель задач.

   Скрипт работает только на macOS. `pnpm icons` запускается на Mac, `build/icon.ico` коммитится в
   ветку PR-а до сборки установщика на ПК. Это шаг на Mac — тот же заход, что gate full на Mac
   перед мержем.
4. **Stable copy на обеих системах.** `scripts/install-stable.sh` переписан на Node:
   `scripts/install-stable.mjs`, `.sh` удаляется, `install:stable` — `node scripts/install-stable.mjs`.
   - Mac — как сейчас: цель `<…>.app`, по умолчанию `~/Applications/worfy-stable.app`; дом —
     `os.homedir()`, на Mac он читает `HOME` (на это опирается `packaged.spec.ts:518-528`); источник
     `dist/mac*/worfy.app`; копирование `ditto`; время сборки — mtime `Contents/Info.plist`.
   - Windows — цель — папка, по умолчанию `%LOCALAPPDATA%\Programs\worfy-stable`, рядом
     `worfy-stable.json`; источник — `dist\win-unpacked`; копирование — `fs.cp` во временную папку
     рядом и переименование; время сборки — mtime `worfy.exe`. Цель не может совпасть с папкой
     установщика (пункт 1).
   - Отказ, пока копия запущена: Mac — по списку процессов, как сейчас; Windows — по процессам, чей
     исполняемый файл лежит в папке цели (например, `Get-CimInstance Win32_Process` в PowerShell).
   - `pnpm package` скрипт зовёт с `shell: true` на Windows: там `pnpm` — это `pnpm.cmd`, а Node
     без shell `.cmd` не запускает (`EINVAL`).
   - `<target>.json` — прежние поля и формат; `WORFY_STABLE_PREBUILT` работает на обеих системах.
   - Чистые части (цель по умолчанию, проверка цели, поиск запущенной копии в списке процессов)
     — функции с системой параметром, для unit-test-а.

   Путь Stable copy на Windows — в `CONTEXT.md` (термин «Stable copy», сейчас только
   `~/Applications/worfy-stable.app`, `:63-64`) и в разделе «Stable copy» `README.md`. Путь —
   предложение Ticket-а, подтвердить у владельца.
5. **Отказ Autopilot на путях Windows.** `gitCommonDir` экспортируется из
   `src/main/ipc/autopilot.ts`. Новый contract test в `test/contract/autopilot.test.ts` берёт
   настоящий git: временный репозиторий и worktree; dev-сборка отказывает и в checkout, и в
   worktree, упакованная — нет. На Windows-ПК он проверяет пути `C:/…` от git против `realpath`.
   `selfProjectRefusal` правится, только если test покажет расхождение.
6. **Smart App Control.** По evidence Ticket-а 01 (раздел 02) на ПК он выключен. Если к сборке он
   окажется включён и установщик не запустится — Status `blocked`, вопрос подписи уходит владельцу
   сразу (Q22).

**Не входит:** подпись и репутация SmartScreen (E4); arm64 (Q24); первый запуск и установка
Harness (Ticket 13); `@packaged` e2e на Windows (Ticket 14); шаг для Windows в skill `ship-ticket`
(Ticket 07); Terminal на PowerShell (Ticket 10).

## Готово, когда

- [ ] Contract `test/contract/make-icons.test.ts`, на любой системе: `build/icon.ico` — заголовок
  ICO и семь записей 16, 24, 32, 48, 64, 128, 256 px; sha256 файла совпадает с `build/icons.json`.
  На Mac запуск скрипта пишет `icon.icns`, `icon.ico`, `icon.png` и `icons.json` и ничего больше
  (`:192-196`; на Mac — через раздел Mac checks PR, Q33).
- [ ] Unit `test/unit/install-stable.test.ts` (новый): цель по умолчанию и путь `<target>.json` для
  `darwin` и `win32`; Windows-цель, равная папке установщика, отвергается; Mac-цель без `.app`
  отвергается; запущенная копия находится в фикстуре списка процессов обеих систем.
- [ ] Contract `test/contract/autopilot.test.ts`, настоящий git: dev-сборка отказывает в checkout и
  в worktree репозитория, упакованная — нет; зелёный на Mac и на Windows-ПК.
- [ ] Mac: блок «with a stand-in app» в `test/e2e/packaged.spec.ts` (теперь про
  `scripts/install-stable.mjs`) зелёный в gate full; `pnpm test:package` — exit 0;
  `pnpm install:stable "$(mktemp -d)/worfy.app"` — exit 0, `worfy.json` рядом с прежними полями (через раздел Mac checks PR, Q33);
  gate full на Mac зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).
- [ ] Windows-ПК: `pnpm package` — exit 0; в `dist\` есть установщик `.exe` и
  `dist\win-unpacked\worfy.exe`;
  `Test-Path dist\win-unpacked\resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`
  печатает `True`.
- [ ] Windows-ПК: `pnpm test test/unit/install-stable.test.ts test/contract/make-icons.test.ts test/contract/autopilot.test.ts`
  — exit 0.
- [ ] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код выхода
  в отчёт. Пока Gate не на Node (Ticket 03) — `pnpm lint`, `pnpm typecheck`, `pnpm test` с кодами
  выхода и пометка «Gate не запускался». Падения `pnpm test` сверены со списком Ticket-а 02: новых
  нет.
- [ ] (вручную) Windows-ПК: установщик из `dist\` ставит worfy (SmartScreen: More info → Run
  anyway). Значок worfy — у установщика, в меню Пуск и на панели задач, не значок Electron.
  Установленный worfy открывается, новая Session отвечает. Папка установки — в Итог. Как проверить:
  Проводник, меню Пуск, окно worfy.
- [ ] (вручную) Windows-ПК: `pnpm install:stable` ставит Stable copy в
  `%LOCALAPPDATA%\Programs\worfy-stable` и пишет `worfy-stable.json` с `commit`, равным
  `git rev-parse HEAD`; повторный запуск заменяет копию; при запущенной копии — ненулевой код выхода,
  копия на месте. Stable copy открывается, Session в ней отвечает. В `pnpm dev` Autopilot над
  Project-ом worfy отказывает с «Autopilot does not run on worfy itself from a development build».
  Как проверить: PowerShell и окно worfy.
- [ ] `CONTEXT.md` («Stable copy») и раздел «Stable copy» `README.md` называют путь Stable copy на
  Windows.

## Тесты

Сначала падающий test — `test/contract/make-icons.test.ts`: `build/icon.ico` нет. Затем unit
`test/unit/install-stable.test.ts`: цель по умолчанию на `win32` (скрипта на Node ещё нет). Затем
contract `selfProjectRefusal` с настоящим git.

Ветка `win32` скрипта Stable copy проверяется unit-test-ом на Mac и в Linux CI. Настоящие
установщик, копия и SmartScreen — ручные пункты на ПК. `@packaged` e2e на Windows — Ticket 14. В
«Итог» — как test-ы падали до правки, папка установки, путь Stable copy и размер установщика.

## Где в коде

- `electron-builder.yml`
- `package.json`
- `scripts/make-icons.mjs`
- `build/icon.ico` (новый)
- `build/icons.json`
- `scripts/install-stable.sh` (удаляется)
- `scripts/install-stable.mjs` (новый)
- `src/main/ipc/autopilot.ts`
- `test/contract/make-icons.test.ts`
- `test/unit/install-stable.test.ts` (новый)
- `test/contract/autopilot.test.ts`
- `test/e2e/packaged.spec.ts`
- `CONTEXT.md`
- `README.md`

`src/main/autopilot/run.ts` меняется, только если test на Windows покажет расхождение путей; тогда
исполнитель добавляет его в этот список.

## Итог

Заполняется при закрытии.
