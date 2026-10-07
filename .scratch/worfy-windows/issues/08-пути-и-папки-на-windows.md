# 08 — Пути и папки на Windows: данные worfy, ~/.claude, мост Limits

Type: task
Status: open
Blocked by: 02
Source: решения владельца 2026-10-07: Q1 (полный порт), Q19 (скрипты, которые зовут hooks и worfy, — на Node), Q24 (Windows 10 21H2+ и 11, x64) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0023](../../../docs/adr/0023-separate-data-roots-packaged-and-dev.md) (раздельные папки данных dev и packaged); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние worfy); evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

- **Папка данных worfy.** `dataRoot()` (`src/main/storage/paths.ts:30-34`) отдаёт
  `~/Library/Application Support/worfy` у packaged-сборки и `…/worfy-dev` у dev-запуска (ADR-0023).
  `WORFY_DATA_DIR` её переопределяет. На Windows это путь macOS внутри профиля пользователя.
  - `src/main/index.ts:24` ставит `app.setPath('userData', dataRoot())`: Electron берёт userData у
    worfy, а не наоборот. Брать путь из `app.getPath('userData')` нельзя — это круг. Кроме того,
    имя приложения у dev- и packaged-сборки одно (`worfy`), и их папки слились бы (ADR-0023).
  - Путь macOS назван ещё в комментариях: `paths.ts:21-29`, `src/shared/autopilot/journal.ts:7` и
    пример команды наблюдателя `:77`.
- **Папка Claude Code.** `claudeHome()` (`paths.ts:40-43`) — `join(homedir(), '.claude')`. На
  Windows `os.homedir()` — `%USERPROFILE%`, то есть путь уже `%USERPROFILE%\.claude`, где Claude
  Code держит конфиг (ADR-0054). На Windows это не проверялось.
- **Абсолютный путь — `startsWith('/')`.** Шесть мест из девяти — здесь; ещё три (`state.ts:197`,
  `:229`, `checks.ts:14`) — Ticket 03.
  - `src/shared/ipc/claude-home.ts:13`, `src/shared/ipc/bindings.ts:18` — схема zod «absolute POSIX
    path» для IPC. Путь `C:\…` она отвергает.
  - `src/shared/cards/last-editor.ts:29-30`, `:32`, `:47` — автор правки Card по
    `tool_input.file_path`. Claude Code на Windows отдаёт `file_path` с `\` (бриф фактов, §1):
    `normalizePath` вернёт null, и автор правки не найдётся.
  - `src/renderer/markdown/links.ts:16`, `:18`, `:53` — ссылка `C:\…` в markdown читается как путь
    относительно документа.
- **Другие места, где разделитель — только `/`** (в бриф не попали, найдены grep-ом):
  - id Session из пути транскрипта по `lastIndexOf('/')`: `src/main/claude-home/binding-signals.ts:47`,
    `src/main/claude-home/subagents.ts:261`, `:301`. Путь от файловой системы Windows идёт с `\`,
    id становится всем путём, и Subagent-ы и сигналы Binding этой Session теряются;
  - `src/main/claude-home/registry.ts:68` — `isInside` сравнивает с `${root}/`. Session из подпапки
    Project-а на Windows к нему не относится;
  - Binding по cwd и по пути Ticket-а — регулярные выражения только с `/`:
    `src/shared/binding/resolve.ts:153` (папка worktree в cwd), `src/shared/workflow/ticket-ref.ts:23`
    (`.claude/worktrees/<NN>`), `src/shared/binding/signals.ts:37` (`.scratch/<epic>/issues/<NN>-` в
    задаче Subagent-а);
  - `src/shared/transcript/subagents.ts:180` — имя workflow-скрипта из `scriptPath`.

  Пути `import.meta.glob` (`src/renderer/shell/registry.ts:27`, `src/renderer/canvas/extensions.ts:64`,
  `:183`) всегда с `/` — их не трогаем.
- **Имя папки транскриптов.** `projectDirName()` (`registry.ts:42-47`) заменяет всё вне `[A-Za-z0-9]`
  на `-` (`:44`): `C:\a\b` → `C--a-b`. Так ли кодирует путь Claude Code на Windows, проверяет
  Ticket 01.
- **Живые Session-ы.** `processState()` (`registry.ts:106-126`) сверяет время старта процесса
  командой `ps -p <pid> -o lstart=` (`:116`) с `procStart` из `sessions/<pid>.json`. На Windows такой
  команды нет: ответ `unknown`, `processAlive()` — false, и живые Session-ы не видны. Что Claude Code
  пишет в `procStart` на Windows, не установлено.
- **Мост Limits** — `scripts/statusline-bridge.sh` (`#!/bin/sh`). Он копирует `rate_limits` из JSON
  строки состояния (`statusLine`) Claude Code в `statusline-limits.json` обеих папок данных — путями
  macOS (`:39-40`). Нужен `jq` (`:33`). Команду пользователя он зовёт через `sh -c "$1"` (`:46`).
  - worfy читает файл (`src/main/agent/limits.ts:22-23`). `test/contract/statusline-bridge.test.ts`
    запускает мост через `/bin/sh` (`:41`) и выводит папки из `dataRoot()` (`:48`).
  - После E3 (Ticket-ы 14 и 15 worfy-harness) мост лежит в `.app` как
    `Contents/Resources/statusline-bridge.sh`. Форма переноса E3 с согласия пользователя пишет этот
    путь в его `statusLine`. Обновление `.app` заменяет `Resources`. Если `.sh` пропадёт, команда
    `statusLine` упадёт, и пропадёт своя строка состояния пользователя.

## Что делаем

1. **Папка данных** (Q1, ADR-0054, ADR-0023). `dataRoot(env, kind, platform = process.platform)`:
   - macOS — прежний путь;
   - Windows — `%APPDATA%\worfy` и `%APPDATA%\worfy-dev` (`env.APPDATA`, без него —
     `<homedir>\AppData\Roaming`). Это та же папка, что `app.getPath('appData')` на Windows. Путь
     собирается `path.win32`, поэтому unit-test идёт на Mac;
   - остальные системы — как сейчас, чтобы CI на Linux не менялся;
   - `WORFY_DATA_DIR` побеждает везде.

   Выбранный путь — в Итог: ADR-0054 оставил выбор этому Ticket-у. `claudeHome()` не меняется.
   Комментарии `paths.ts:21-29` и `journal.ts:7`, `:77` называют обе системы.
2. **Абсолютный путь — одна функция** в `src/shared/paths.ts` (новый, без `node:path`: её берёт и
   renderer).
   - Абсолютные: `/…`, `C:\…`, `C:/…`, `\\server\share\…`. Не абсолютные: `a\b`, `C:a` (от текущей
     папки диска). Путь с `\0` — отказ.
   - Там же — схема zod для IPC. Её берут `claude-home.ts:13` и `bindings.ts:18`.
   - `last-editor.ts`: `\` и `/` — один разделитель. На путях Windows регистр букв не различается:
     файловая система Windows по умолчанию к нему не чувствительна.
   - `links.ts`: ссылка `C:\…` или `C:/…` — абсолютная; `\` в относительной ссылке — разделитель.
   - `src/shared/ipc/checks.ts:14` правит Ticket 03. Если этот Ticket влит раньше, Ticket 03 берёт
     ту же функцию.
3. **`/` и `\` в чтении `~/.claude` и в Binding.**
   - id Session — последний сегмент пути по обоим разделителям (`binding-signals.ts:47`,
     `subagents.ts:261`, `:301`);
   - `registry.ts:68` — сравнение после `resolve` обоих путей, через `path.sep`;
   - регулярные выражения `resolve.ts:153`, `ticket-ref.ts:23`, `signals.ts:37` и
     `transcript/subagents.ts:180` принимают `[\\/]`.
4. **Имя папки транскриптов** (`registry.ts:44`) — по факту Ticket-а 01. Если Claude Code
   кодирует `C:\a\b` не как `C--a-b`, функция повторяет его правило.
5. **Живые Session-ы на Windows** (`registry.ts:116`).
   - Сначала — живой `%USERPROFILE%\.claude\sessions\<pid>.json` на Windows-ПК: есть ли `procStart`
     и в каком виде.
   - Затем — время старта процесса без `ps`. Например, `Get-CimInstance Win32_Process` (поле
     `CreationDate`), одним вызовом на все pid. Правило прежнее: команда не ответила — `unknown`.
   - Если `procStart` на Windows нет, остаётся проверка `process.kill(pid, 0)` — она уже есть
     (`registry.ts:108-113`).
   - Формат и способ — в Итог.
6. **Мост Limits на Node** (Q19). `scripts/statusline-bridge.mjs` (новый) держит прежний контракт:
   - копирует объект `rate_limits` в `statusline-limits.json`: в `WORFY_DATA_DIR` или в те папки
     данных своей системы по умолчанию, что существуют (Windows — `%APPDATA%\worfy` и `worfy-dev`);
   - пишет рядом и переименовывает; `jq` не нужен; строку состояния не роняет;
   - отдаёт stdin команде пользователя из аргумента и пропускает её вывод и код выхода. На Mac
     команда идёт через `sh -c`, как сейчас. На Windows — той же оболочкой, которой Claude Code
     запускает `statusLine` (Git Bash или cmd — не установлено, проверить на ПК);
   - выбор папок — экспортируемая функция; unit-test проверяет её для `win32` на Mac.
7. **Уже записанная команда на Mac** — решает этот Ticket и пишет в Итог. Условие: после обновления
   `.app` команда, которую записал перенос E3 (`<…>/Contents/Resources/statusline-bridge.sh '<cmd>'`),
   работает, а своя строка состояния пользователя не пропадает.
   - Рекомендация: `statusline-bridge.sh` остаётся на прежнем пути тонким входом. Если в PATH есть
     node, он передаёт работу `statusline-bridge.mjs` рядом. Если нет — только отдаёт stdin команде
     пользователя, без Limits, как сейчас без `jq`.
   - Отвергнуто: убрать `.sh` и переписать `statusLine` формой переноса E3. Пока пользователь не
     согласился, `statusLine` указывал бы на файл, которого нет.
   - `electron-builder.yml`: `.mjs` кладётся в `Resources` рядом с `.sh` той же записью
     `extraResources`, что завёл E3 (Ticket 15 worfy-harness). Запись `statusLine` при установке на
     Windows — Ticket 13.

## Готово, когда

- [ ] `test/unit/paths.test.ts`: для `darwin` пути прежние (старые случаи не менялись); для `win32` с `APPDATA=C:\Users\u\AppData\Roaming` — `…\worfy` и `…\worfy-dev`; без `APPDATA` — `<homedir>\AppData\Roaming\…`; `WORFY_DATA_DIR` побеждает.
- [ ] `test/unit/platform-paths.test.ts` (новый): абсолютные — `/a`, `C:\a`, `C:/a`, `c:\a`, `\\server\share\a`; не абсолютные — `a/b`, `a\b`, `C:a`, пустая строка; путь с `\0` — отказ. Схема IPC из `src/shared/paths.ts` принимает и отвергает то же.
- [ ] `test/contract/card-last-editor.test.ts`: `Write` с `file_path` `C:\p\data\cards\abc\index.html` при `cardsDir` `C:\p\data\cards` — Card `abc`; относительный `cards\abc\x.md` при cwd `C:\p\data` — `abc`; `c:\P\DATA\cards\abc\x.md` — `abc`. Прежние случаи POSIX не менялись.
- [ ] `test/unit/markdown.test.tsx`: ссылки `C:\docs\a.md` и `C:/docs/a.md` — файл с абсолютным путём; относительные ссылки — как прежде.
- [ ] `test/unit/binding.test.ts` и `test/unit/ticket-ref.test.ts`: cwd `C:\r\.claude\worktrees\05` — Ticket 05 по папке; задача Subagent-а с `.scratch\worfy-windows\issues\05-x.md` — Ticket 05 Epic-а `worfy-windows`. Прежние случаи не менялись.
- [ ] `test/contract/claude-home-subagents.test.ts`: id Session из пути транскрипта с `\` — имя файла без `.jsonl`.
- [ ] `test/contract/claude-home-registry.test.ts`: `projectDirName` пути Windows — имя из evidence Ticket-а 01; время старта процесса в формате Windows с подменённой командой даёт `alive`, `gone` и `unknown`.
- [ ] `test/contract/statusline-bridge.test.ts`: все прежние случаи проходят против `node scripts/statusline-bridge.mjs` и против входа `.sh`, если он остался. Новые: PATH без `jq` — файл всё равно пишется; выбор папок для `win32` — `%APPDATA%\worfy` и `worfy-dev`.
- [ ] `@packaged` test в `test/e2e/packaged.spec.ts` (локально, `test:package` в gate full): в `.app` рядом с `Contents/Resources/statusline-bridge.sh` лежит `statusline-bridge.mjs`. Команда прежнего вида `<.app>/Contents/Resources/statusline-bridge.sh '<cmd>'` с образцом JSON пишет файл и пропускает вывод команды.
- [ ] Windows-ПК, dev-сборка: список Session-ов Project-а worfy показывает транскрипты из `%USERPROFILE%\.claude\projects`. `claude`, запущенный в PowerShell в worktree worfy и в его подпапке, виден как живая Session. Session в `.claude\worktrees\NN` привязана к Ticket-у NN. Снимок — `../evidence/08-session-ы-на-windows.png`.
- [ ] Windows-ПК: образец JSON строки состояния, поданный в `node scripts\statusline-bridge.mjs`, пишет `%APPDATA%\worfy-dev\statusline-limits.json`, и dev-сборка показывает полосы Limits. Если владелец сам ставит `statusLine` с мостом — Limits приходят из терминала. Данные dev-сборки лежат в `%APPDATA%\worfy-dev`.
- [ ] Mac: данные на прежнем месте — `test/e2e/packaged.spec.ts:304` и `:418` зелёные; gate full зелёный.

## Тесты

Сначала — падающие test-ы. На нынешнем main они красные:

- `test/unit/platform-paths.test.ts` — функции нет;
- случай `C:\…` в `test/contract/card-last-editor.test.ts` — `normalizePath` вернёт null;
- случай `win32` в `test/unit/paths.test.ts` — `dataRoot` не знает платформы.

В Итог — как они падали.

Ветки Windows проверяются на Mac строками с `\` и параметром `platform`. Исключение — сравнение
путей в `registry.ts:68`: его проверяет живой прогон на Windows-ПК (пункт «Готово, когда»). Test-ы
`@packaged` и e2e идут локально, в gate full.

## Где в коде

- `src/main/storage/paths.ts`
- `src/shared/paths.ts` (новый)
- `src/shared/ipc/claude-home.ts`
- `src/shared/ipc/bindings.ts`
- `src/shared/cards/last-editor.ts`
- `src/renderer/markdown/links.ts`
- `src/shared/binding/signals.ts`
- `src/shared/binding/resolve.ts`
- `src/shared/workflow/ticket-ref.ts`
- `src/shared/transcript/subagents.ts`
- `src/main/claude-home/registry.ts`
- `src/main/claude-home/binding-signals.ts`
- `src/main/claude-home/subagents.ts`
- `src/main/agent/limits.ts` — только комментарии
- `src/shared/autopilot/journal.ts` — только комментарии
- `scripts/statusline-bridge.mjs` (новый)
- `scripts/statusline-bridge.sh`
- `electron-builder.yml`
- `test/unit/paths.test.ts`
- `test/unit/platform-paths.test.ts` (новый)
- `test/unit/markdown.test.tsx`
- `test/unit/binding.test.ts`
- `test/unit/ticket-ref.test.ts`
- `test/contract/card-last-editor.test.ts`
- `test/contract/claude-home-registry.test.ts`
- `test/contract/claude-home-subagents.test.ts`
- `test/contract/statusline-bridge.test.ts`
- `test/e2e/packaged.spec.ts`

Не входит: места Gate (`src/main/gate/state.ts`, `src/shared/ipc/checks.ts` — Ticket 03); запись
`statusLine` при установке на Windows (Ticket 13); окружение агента (Ticket 09); упаковка под
Windows (Ticket 12).

## Итог

Заполняется при закрытии.
