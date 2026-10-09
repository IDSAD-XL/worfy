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
    `tool_input.file_path`. Claude Code на Windows отдаёт `file_path` с `\`: на ПК у `Write` —
    `C:\\Users\\…\\probe-written.txt` (evidence Ticket-а 01, раздел 13). `normalizePath` вернёт null, и
    автор правки не найдётся; `test/contract/card-last-editor.test.ts` на ПК — 4 упавших (раздел 17).
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
  на `-` (`:44`): `C:\a\b` → `C--a-b`. Claude Code 2.1.233 на Windows кодирует путь так же: `C:\a\b` →
  `C--a-b`, путь с пробелом и с кириллицей — тоже по этому правилу (evidence Ticket-а 01, раздел 12).
- **Живые Session-ы.** `processState()` (`registry.ts:106-126`) сверяет время старта процесса
  командой `ps -p <pid> -o lstart=` (`:116`) с `procStart` из `sessions/<pid>.json`. На Windows такой
  команды нет: ответ `unknown`, `processAlive()` — false, и живые Session-ы не видны. На Windows Claude
  Code пишет в `procStart` время старта процесса как FILETIME — число 100-нс интервалов от
  1601-01-01, например `134359831229530706`; оно ровно равно `CreationDate` из
  `Get-CimInstance Win32_Process` (evidence, раздел 23).
- **На ПК сейчас** `test/contract/claude-home-registry.test.ts` — 39 упавших,
  `claude-home-subagents.test.ts` — 29, `test/unit/paths.test.ts` — 6 (`'C:\tmp\worfy-data'` вместо
  `'/tmp/worfy-data'`), `statusline-bridge.test.ts` — 8 (evidence, раздел 17).
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
4. **Имя папки транскриптов** (`registry.ts:44`) не меняется: Claude Code на Windows кодирует путь
   тем же правилом (evidence Ticket-а 01, раздел 12). Test-ы фиксируют `C:\a\b` → `C--a-b`.
5. **Живые Session-ы на Windows** (`registry.ts:116`). `procStart` на Windows — FILETIME (evidence
   Ticket-а 01, раздел 23). Время старта процесса без `ps` — `Get-CimInstance Win32_Process`, поле
   `CreationDate`, одним вызовом на все pid; сравнение — в одной единице (FILETIME или миллисекунды).
   Правило прежнее: команда не ответила — `unknown`. Способ — в Итог.
6. **Мост Limits на Node** (Q19). `scripts/statusline-bridge.mjs` (новый) держит прежний контракт:
   - копирует объект `rate_limits` в `statusline-limits.json`: в `WORFY_DATA_DIR` или в те папки
     данных своей системы по умолчанию, что существуют (Windows — `%APPDATA%\worfy` и `worfy-dev`);
   - пишет рядом и переименовывает; `jq` не нужен; строку состояния не роняет;
   - отдаёт stdin команде пользователя из аргумента и пропускает её вывод и код выхода. На Mac
     команда идёт через `sh -c`, как сейчас. На Windows — той же оболочкой, которой Claude Code
     запускает `statusLine`. Команды hooks Claude Code на ПК исполняет в Git Bash (evidence Ticket-а
     01, раздел 13); для `statusLine` не проверено — проверить на ПК;
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

- [x] `test/unit/paths.test.ts`: для `darwin` пути прежние (старые случаи не менялись); для `win32` с `APPDATA=C:\Users\u\AppData\Roaming` — `…\worfy` и `…\worfy-dev`; без `APPDATA` — `<homedir>\AppData\Roaming\…`; `WORFY_DATA_DIR` побеждает.
- [x] `test/unit/platform-paths.test.ts` (новый): абсолютные — `/a`, `C:\a`, `C:/a`, `c:\a`, `\\server\share\a`; не абсолютные — `a/b`, `a\b`, `C:a`, пустая строка; путь с `\0` — отказ. Схема IPC из `src/shared/paths.ts` принимает и отвергает то же.
- [x] `test/contract/card-last-editor.test.ts`: `Write` с `file_path` `C:\p\data\cards\abc\index.html` при `cardsDir` `C:\p\data\cards` — Card `abc`; относительный `cards\abc\x.md` при cwd `C:\p\data` — `abc`; `c:\P\DATA\cards\abc\x.md` — `abc`. Прежние случаи POSIX не менялись.
- [x] `test/unit/markdown.test.tsx`: ссылки `C:\docs\a.md` и `C:/docs/a.md` — файл с абсолютным путём; относительные ссылки — как прежде.
- [x] `test/unit/binding.test.ts` и `test/unit/ticket-ref.test.ts`: cwd `C:\r\.claude\worktrees\05` — Ticket 05 по папке; задача Subagent-а с `.scratch\worfy-windows\issues\05-x.md` — Ticket 05 Epic-а `worfy-windows`. Прежние случаи не менялись.
- [x] `test/contract/claude-home-subagents.test.ts`: id Session из пути транскрипта с `\` — имя файла без `.jsonl`.
- [x] `test/contract/claude-home-registry.test.ts`: `projectDirName` пути Windows — имя из evidence Ticket-а 01, раздел 12 (`C:\a\b` → `C--a-b`); время старта процесса в формате Windows с подменённой командой даёт `alive`, `gone` и `unknown`.
- [x] `test/contract/statusline-bridge.test.ts`: все прежние случаи проходят против `node scripts/statusline-bridge.mjs` и против входа `.sh`, если он остался. Новые: PATH без `jq` — файл всё равно пишется; выбор папок для `win32` — `%APPDATA%\worfy` и `worfy-dev`.
- [ ] `@packaged` test в `test/e2e/packaged.spec.ts` (локально, `test:package` в gate full): в `.app` рядом с `Contents/Resources/statusline-bridge.sh` лежит `statusline-bridge.mjs`. Команда прежнего вида `<.app>/Contents/Resources/statusline-bridge.sh '<cmd>'` с образцом JSON пишет файл и пропускает вывод команды.
- [ ] Windows-ПК, dev-сборка: список Session-ов Project-а worfy показывает транскрипты из `%USERPROFILE%\.claude\projects`. `claude`, запущенный в PowerShell в worktree worfy и в его подпапке, виден как живая Session. Session в `.claude\worktrees\NN` привязана к Ticket-у NN. Снимок — `../evidence/08-session-ы-на-windows.png`.
- [x] Windows-ПК: образец JSON строки состояния, поданный в `node scripts\statusline-bridge.mjs`, пишет `%APPDATA%\worfy-dev\statusline-limits.json`, и dev-сборка показывает полосы Limits. Если владелец сам ставит `statusLine` с мостом — Limits приходят из терминала. Данные dev-сборки лежат в `%APPDATA%\worfy-dev`.
- [ ] Mac: данные на прежнем месте — `test/e2e/packaged.spec.ts:304` и `:418` зелёные; gate full зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

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

Ветка `worfy-windows/08`, от main `f95b7e7`. Сделано на Windows-ПК владельца, Session Claude Code.

- **Папка данных** (`src/main/storage/paths.ts`): `dataRoot(env, kind, platform)`. Windows —
  `%APPDATA%\worfy` и `%APPDATA%\worfy-dev`; без `APPDATA` или с не абсолютным —
  `<homedir>\AppData\Roaming\…`. macOS и прочие системы — прежний `~/Library/Application Support/…`.
  `WORFY_DATA_DIR` побеждает везде. Выбран `%APPDATA%` (Roaming), как `app.getPath('appData')` на
  Windows; `claudeHome()` не менялся. Старые случаи `test/unit/paths.test.ts`, где путь по умолчанию
  зависел от платформы, теперь передают `'darwin'` явно; шесть случаев с литералом `/tmp/…` через
  `resolve` падают на Windows и на main — это Ticket 14.
- **Абсолютный путь — `src/shared/paths.ts`** (`isAbsolutePath`, `absolutePathSchema`,
  `lastPathSegment`): `/…`, `C:\…`, `C:/…`, UNC `\\server\share…`; не абсолютные — `a\b`, `C:a`, `\a`,
  пустая строка; путь с NUL — отказ. Кроме `claude-home.ts` и `bindings.ts` её берут ещё четыре места,
  которых не было в списке тикета, с той же проверкой `startsWith('/')`: `src/shared/ipc/agent.ts`
  (`cwd` у `agent.start` — без этого агент не стартует в `C:\…`), `src/shared/ipc/workflow.ts`,
  `src/shared/agent/attachments.ts`, `src/main/workflow/profile.ts`. `src/shared/ipc/checks.ts`
  оставлен Ticket-у 03. `cards.file` не тронут: там путь из адреса Card, не путь на диске.
- **Автор правки Card** (`last-editor.ts`): путь Windows — `\` и `/` один разделитель, буква диска
  заглавная, сравнение без учёта регистра; путь POSIX — как был.
- **Ссылки markdown** (`links.ts`): `C:\…`, `C:/…`, `\\server\share\…` — файл с абсолютным путём (а не
  схема `c:`); `\` в относительной ссылке — разделитель; корень диска — ничего.
- **`/` и `\` в `~/.claude` и в Binding:** id Session — `transcriptSessionId` (`subagents.ts`, его
  берёт и `binding-signals.ts`); `worktreeFolderOf` и `parseWorktreeFolder` читают путь с `\` как с
  `/`, поэтому `detail` Binding-а одинаков на обеих системах (`.claude/worktrees/05`); путь Ticket-а
  в задаче Subagent-а и `ticket claim` после пути с `\`; имя workflow-скрипта и папка прогона в
  `Transcript dir:` с `\`.
- **Session внутри Project-а** (`registry.ts`): `isInsidePath(path, root, platform)` — правила
  `path.win32` на Windows (разделитель `\`, без учёта регистра), `path.posix` на остальных.
- **Имя папки транскриптов** не менялось; test-ы фиксируют три имени из evidence Ticket-а 01, раздел 12.
- **Живые Session-ы на Windows** (`processState`): время старта — `Get-Process -Id <все pid>`,
  `StartTime.ToFileTimeUtc()`, одним вызовом Windows PowerShell на все pid, спрошенные в пределах
  25 мс (`batchedProcessStarts`). Проверено на ПК (exit 0): для Session 20488 `Get-Process` дал
  `134359927685768597` — ровно `procStart`; `Get-CimInstance Win32_Process` (`CreationDate`) дал
  `…590` — теряет последнюю цифру (100 нс) и вдвое медленнее (1181 мс против 642), поэтому не он.
  Сравнение — строки FILETIME; нет pid в ответе — `gone`, время не прочитать — `unknown`, PowerShell
  упал — `unknown`. Запуск PowerShell — общая `powershellScriptCommand` из `src/main/agent/env.ts`.
- **Мост Limits на Node** — `scripts/statusline-bridge.mjs`: тот же контракт, `jq` не нужен,
  `limitsFolders` и `commandRunner` экспортируются. Команда пользователя — `sh -c` на macOS и Linux;
  на Windows — Git Bash (`CLAUDE_CODE_GIT_BASH_PATH`, рядом с `git.exe`, `%ProgramFiles%\Git`,
  `%LOCALAPPDATA%\Programs\Git`, ничего под `%SystemRoot%`), без него — оболочка Node по умолчанию.
  Оболочку `statusLine` на Windows живым прогоном не проверял: в бинарнике Claude Code 2.1.233 его
  агент настройки строки состояния пишет про Windows «the command is executed through Git Bash»
  (`grep` по `claude.exe`, при найденном Git Bash).
- **Уже записанная команда на Mac:** `statusline-bridge.sh` остался на прежнем пути тонким входом:
  есть `node` и рядом `.mjs` — `exec node …/statusline-bridge.mjs "$@"`; нет — только отдаёт stdin
  команде пользователя (`exec sh -c "$1"`), без Limits. `electron-builder.yml` кладёт `.mjs` в
  `Resources` рядом с `.sh`. Проверено под Git Bash на ПК: код выхода команды доходит (4), файл
  пишется; без `node` команда получает stdin.
- **Как test-ы падали до правки:** `platform-paths.test.ts` — модуля нет (exit 1);
  `paths.test.ts` — оба новых случая `win32` (`dataRoot` не знал платформы);
  `card-last-editor.test.ts` — 3 новых случая Windows (и 4 старых, которые на ПК падали и на main);
  `markdown.test.tsx` — 6; `binding.test.ts` и `ticket-ref.test.ts` — 4; `subagents.test.ts` — 1.
- **Мутанты** (на Windows, по одному, 11 затронутых test-файлов, счёт — новые падения против того же
  набора без мутантов): все 32 красные. Абсолютный путь: `C:` без разделителя, без UNC, без отказа
  на NUL, `lastPathSegment` только по `/`; `dataRoot` без ветки Windows, `APPDATA` без проверки;
  автор правки Card: регистр, разделитель, буква диска; ссылки: без ветки Windows, `\` в
  относительной; Binding: папка worktree, `parseWorktreeFolder`, путь Ticket-а, `claim`; имя
  workflow-скрипта, папка прогона, id Session; `isInsidePath`: регистр, `posix` вместо `win32`;
  `processState`: без ветки Windows, нет pid → `unknown`, `?` → `alive`, без сбора pid в один
  вызов, `ToFileTime` вместо `ToFileTimeUtc`; мост: папки Windows, `USERPROFILE`, WSL-овский
  `bash.exe`, `sh` на Windows, массив вместо объекта `rate_limits`; читатель реестра Ticket-а 09:
  последняя строка CLIXML, `SystemRoot` вида `\Windows`.
- **Проверки на Windows-ПК** (на `56b7a1a` + Итог): `pnpm install --frozen-lockfile` — 0, `pnpm lint` —
  0, `pnpm typecheck` — 0. `pnpm test` — 1: `48 failed | 122 passed (170)` файлов, `591 failed | 2737
  passed | 16 skipped (3344)` test-ов; против main `f95b7e7` (`53 | 116`, `709 | 2560 | 16 (3285)`)
  по именам test-ов — 119 падений ушло (`agent-controls` 37, `agent-attachments` 25,
  `agent-session` 20, `permissions` 15 — их держала проверка `cwd` у `agent.start`; ещё
  `statusline-bridge` 8, `card-last-editor` 4, `claude-home-registry` 3 и другие), одно новое —
  `check-handoff` «passes exactly 15360 bytes», timeout 5000 мс под нагрузкой; отдельно файл —
  exit 0, `11 passed`.
- **Данные dev-сборки на ПК:** прежние запуски писали в `C:\Users\Alexey\Library\Application
  Support\worfy` и `…\worfy-dev` (путь macOS). Новая dev-сборка начинает в `%APPDATA%\worfy-dev` с
  чистого листа; переноса нет — сборок под Windows ещё не выпускали. Старые папки не тронуты.
- **Проверка dev-сборки на ПК** (владелец, `v0.2.0+693f4d7`, снимок
  `../evidence/08-session-ы-на-windows.png`):
  - данные dev-сборки — в `%APPDATA%\worfy-dev` (там `first-run.json`, `Local State` …);
  - «Add project» новой папки на Windows сейчас не пройти: подключение идёт через Harness, а
    dev-сборка его не ставит (Harness на Windows — Ticket-ы 03–07, 12). Для проверки Project worfy
    записан в `%APPDATA%\worfy-dev\projects.json` так, как его пишет `ProjectStore` (`path` из `git
    rev-parse` — `C:/Users/Alexey/worfy`, id `worfy-d5750da7`);
  - Sessions «2 live»: Orchestrator самой worfy и Session `claude`, запущенная владельцем в
    PowerShell в подпапке `C:\Users\Alexey\worfy\src` (pid 47344, `cli` в
    `%USERPROFILE%\.claude\sessions\47344.json`) — «src-05 · terminal · idle». Session из корня, уже
    закрытая, — на холсте как `finished`. Транскрипты из `%USERPROFILE%\.claude\projects` видны;
  - мост: образец JSON строки состояния, поданный в `node scripts\statusline-bridge.mjs` (exit 0),
    записал `%APPDATA%\worfy-dev\statusline-limits.json`; `%APPDATA%\worfy` нет — туда не писал.
    Dev-сборка показала полосы Limits: 5-hour 29 %, 7-day 9 %;
  - не проверено: привязка Session в `.claude\worktrees\NN` к Ticket-у NN в живой сборке — без
    Harness нет модели Epic-ов (панель Epics: «epic-status not found»), так что Binding к Ticket-у
    не из чего строить; покрыто test-ами `binding.test.ts` и `ticket-ref.test.ts`. Живой прогон
    `statusLine` с мостом — тоже нет (`statusLine` ставит владелец).
- **Первый круг ревью PR #200:**
  - вход `statusline-bridge.sh` переписан. Прежний «тонкий вход» гасил строку пользователя при
    `node`, который падает (shim asdf/mise без версии — 126, старый Node — SyntaxError), а без `node`
    переставал писать Limits, хотя старый мост писал их через `/usr/bin/jq` (он есть в macOS 15+). Теперь
    вход читает stdin один раз, байт в байт; пробует `node statusline-bridge.mjs` только для Limits
    (вывод и код не смотрит); без `node` или при его падении пишет Limits прежним путём через `jq`;
    команду пользователя всегда запускает сам и выходит с её кодом. Test-ы входа без `node`, с
    падающим и со «старым» `node`-стабом и на stdin байт в байт идут там, где есть `/bin/sh` (на Mac).
    На ПК тот же сценарий прогнан вручную в Git Bash (`jq` — стаб на Node): новый вход — все три
    случая exit 3, строка пользователя, пустой stderr, Limits записаны; вход из `693f4d7` — без `node`
    Limits нет, с падающим и старым `node` — exit 126 и 1, строки нет;
  - ссылки `C:\…` в markdown не открывались: `urlTransform` `react-markdown` по умолчанию обнулял их,
    а парсер отдаёт `\` закодированным (`C:%5CUsers…`). `Markdown.tsx` пропускает мимо
    `defaultUrlTransform` только абсолютные пути Windows (`isWindowsPathLink`, после раскодирования);
    test-ы через `<Markdown>` (до правки — красные);
  - одно правило `APPDATA` у `dataRoot` и моста — `isWindowsAbsolutePath` (`C:\…`, `C:/…`, UNC; не
    `/x`, `\x`, `C:x`); test сверяет мост с `dataRoot` на восьми значениях;
  - `last-editor`: путь Git Bash `/c/…` против папки Card-ов Windows — диск C:; `\x` — корень диска
    cwd; `C:x` — в cwd на том же диске, иначе null; test-ы POSIX-веток;
  - время старта процесса кэшируется по pid на 30 с (`PROCESS_START_CACHE_MS`): опрос идёт раз в 2 с,
    и PowerShell запускался бы каждый раз. `?`, pid без ответа и упавшее чтение не кэшируются.
    Риск — pid, занятый новым процессом в эти 30 с при оставшемся файле умершей Session;
  - test текста скрипта PowerShell и `SystemRoot` в `readWindowsProcessStarts`;
  - **долги:** `isInsidePath` на Windows сравнивает через `toLowerCase`, шире, чем NTFS (косметика);
    нет test-а, что `inProject` передаёт платформу в `isInsidePath`; `claimIn` не видит формы команды
    в кавычках, как её пишет skill (было и до этого PR).
- **Долги Ticket-а 09** из последнего комментария PR #194 — в Итоге Ticket-а 09.
