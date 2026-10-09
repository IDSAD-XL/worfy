# 02 — Репозиторий worfy ставится и запускается на Windows: `.gitattributes`, `pnpm install`, скрипты `package.json`

Type: task
Status: open
Blocked by: 01
Source: решения владельца 2026-10-07: Q1 (полный порт worfy под Windows), Q24 (Windows 10 21H2+ и 11, только x64); `.gitattributes` с LF для скриптов — решение владельца без вопроса ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

- **`.gitattributes` нет.** Все файлы индекса — с LF: на main `76f7ff8` `git ls-files --eol` даёт
  1088 `i/lf`, 191 `i/-text` (двоичные) и 3 `i/none`; на main `08e8256` — 1105 `i/lf`, 207 `i/-text`
  и 3 `i/none`. На ПК владельца `core.autocrlf=true` (в system и в global), и после клона все
  текстовые файлы — `w/crlf`, `git status` пуст (evidence
  Ticket-а 01, раздел 03).
  - bash Git for Windows скрипт с CRLF выполняет без ошибок — и через `bash файл`, и по shebang;
    `epic-status` с CRLF дал EXIT=0 и валидный JSON (evidence, разделы 18 и 21). В других оболочках
    (WSL, Linux, macOS) CRLF не проверялся; по устройству bash строка `#!/usr/bin/env bash\r` ищет
    `bash\r`, а bash спотыкается о `$'\r'` — например, при копировании рабочего дерева Windows.
  - CRLF валит и `test/contract/harness-evals.test.ts`: 16 падений — `frontMatter` ищет `^---\n`
    (`:32`), а `harness/evals/*/prompt.md` и грейдеры в рабочем дереве с CRLF (evidence, раздел 17).
    Это кандидат в список пункта 1 «другие текстовые файлы».
  - CRLF уже валит test на Windows: `test/contract/make-icons.test.ts` — sha256 `build/brand/icon.svg`
    и `mark.svg` в рабочем дереве не совпадают с `build/icons.json` (evidence, раздел 17).

  Скрипты репозитория:
  - Harness: `harness/bin/*` без расширения (`epic-status`, `preflight`, `profile`, `ticket`,
    `worktree-lock`, `epic-board`, `qmd-mcp`, `qmd-refresh`, `qmd-sync-main`), `*.sh` в `harness/hooks`
    и в папках `tests`, `*.mjs` в `harness/hooks`;
  - `scripts`: `install-stable.sh`, `statusline-bridge.sh`, `make-icons.mjs`, `build-version.ts`.
- **node-pty собирается из исходников.** Root `postinstall` — `electron-rebuild --only node-pty`
  (`package.json:21`). Своя установка node-pty (`node scripts/prebuild.js || node-gyp rebuild`) на
  Windows берёт готовую сборку из `prebuilds/win32-x64`, она в пакете есть. node-pty грузит
  `build/Release` раньше `prebuilds` (`node_modules/node-pty/lib/utils.js:18-19`). На ПК владельца
  (evidence Ticket-а 01):
  - `pnpm install --frozen-lockfile` — EXIT=-1 на root `postinstall`, хотя VS Build Tools 2017 и
    2022 и Python стоят. Из Session Claude Code — `'GetCommitHash.bat' is not recognized`: процесс
    Claude Code задаёт `NoDefaultCurrentDirectoryInExePath=1`, и cmd.exe не ищет `.bat` в текущей
    папке (разделы 08 и 20). Без этой переменной — `error MSB8040`: нет библиотек MSVC с защитой от
    Spectre (раздел 08). Так же — в worktree (раздел 11).
  - Готовая сборка `prebuilds/win32-x64` грузится в Electron 44.5.1 без `build/Release`:
    `require('node-pty')` при `ELECTRON_RUN_AS_NODE=1` — EXIT=0, `spawn` через ConPTY работает
    (раздел 09). Пересборка на Windows не нужна.
- **pnpm 11 повторяет install перед скриптом.** Пока root `postinstall` падает, `pnpm lint` и
  `pnpm exec electron …` падают с EXIT=1 в `runDepsStatusCheck`: pnpm снова зовёт `pnpm install`
  (evidence, разделы 09 и 17; `typecheck`, `test` и `dev` без флага не запускались). С
  `--config.verify-deps-before-run=false` `lint` и `typecheck` — EXIT=0, `dev` открывает окно (экран
  First run).
- **`allowBuilds`.** `pnpm-workspace.yaml:5-9` разрешает install-скрипты только `electron`,
  `esbuild` и `node-pty` (`electron-winstaller` — запрещён). Пакет со скриптом сборки не из списка
  валит `pnpm install` ошибкой `ERR_PNPM_IGNORED_BUILDS`. Пакеты под win32 в `pnpm-lock.yaml` уже
  есть: `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.289` (`:171`), `@esbuild/win32-x64`
  (`:684`, `:690`). На ПК `ERR_PNPM_IGNORED_BUILDS` не было: install-скрипты `esbuild` и `node-pty`
  прошли, `claude-agent-sdk-win32-x64` поставлен (evidence Ticket-а 01, разделы 08 и 14).
- **Скрипт `test`** — `ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run`
  (`package.json:16`). Префикс `VAR=value` понимает POSIX shell, cmd.exe — нет. На ПК pnpm исполняет
  скрипты через cmd.exe (`script-shell` и `shell-emulator` не заданы): `pnpm test` — `'ELECTRON_RUN_AS_NODE'
  is not recognized`, EXIT=1. С `--config.shell-emulator=true` тот же скрипт запускает vitest
  (evidence, раздел 10). У `dev`, `lint`, `typecheck`, `test:e2e` префиксов нет.
- **Упаковка — не здесь.** `package` собирает только под Mac (`--mac dir`, `package.json:12`), а
  `install:stable` запускает `.sh` напрямую (`:19`). Это Ticket 12 (сборка на Windows).
- **Версия сборки.** `scripts/build-version.ts` дописывает к версии `.dirty`, если
  `git status --porcelain` не пуст (`:2`, `:24`). Рабочее дерево, которое git после клона считает
  изменённым, даёт «грязную» версию каждой сборки.
- **Test Harness в `pnpm test`.** `test/contract/harness-scripts.test.ts` требует в PATH `bash`,
  `zsh`, `jq`, `git`, `node` (`:40`) и гоняет test-ы Harness командой `bash <файл>` (`:63`). zsh в
  Git Bash нет: на Windows этот test упадёт. Его чинит не этот Ticket.
- **Исход `pnpm test` на ПК до этого Ticket-а** (с `shell-emulator=true`, main `08e8256`): 55
  файлов из 157 и 662 test-а из 2995 упали; список из JSON-отчёта vitest с причиной одной строкой —
  evidence Ticket-а 01, раздел 17. Это исходный список для Ticket-ов 03–14.

## Что делаем

1. **`.gitattributes`** — новый файл в корне. LF в рабочем дереве на любой системе для
   `harness/bin/*`, `*.sh`, `*.mjs` и всего в `scripts`. Это решение владельца без вопроса и пункт 3
   «Готово, когда» Epic-а. Индекс уже весь в LF: `git add --renormalize .` не должен изменить ни
   одного файла — проверить и написать в Итог.
   Ещё LF — для `build/brand/*.svg`: их sha256 записан в `build/icons.json`, и с CRLF
   `test/contract/make-icons.test.ts` красный на любом Windows-клоне (evidence Ticket-а 01, раздел 17).
   Это тот же случай, что скрипты: файл, побайтное содержимое которого — контракт.
   Если test-ы на Windows падают из-за CRLF в других текстовых файлах (фикстуры, Markdown правил,
   исходники), LF для всех текстовых файлов (`* text=auto eol=lf`) Ticket сам не включает. Он кладёт
   список таких test-ов в Итог как вопрос владельцу.
2. **node-pty без Build Tools** (Q24 — только x64). Готовая сборка из `prebuilds/win32-x64`
   грузится в Electron 44.5.1 (evidence Ticket-а 01, раздел 09), а пересборка на ПК падает и с
   Build Tools (раздел 08). Поэтому `postinstall` на Windows node-pty не пересобирает. Условие по
   системе живёт в скрипте на Node `scripts/postinstall.mjs`, а не в строке `package.json`: у cmd.exe
   нет ни `uname`, ни `[ … ]`. На Mac пересборка остаётся как сейчас. Visual Studio Build Tools
   требованием к машине разработчика на Windows не становятся.
   - Если на Windows в `node_modules/node-pty/build/Release` остался `.node` от прежней пересборки,
     node-pty возьмёт его раньше `prebuilds`; скрипт его не трогает, но Итог говорит, как его убрать.
3. **`allowBuilds`.** Если `pnpm install` на Windows падает с `ERR_PNPM_IGNORED_BUILDS`, пакет
   добавляется в `pnpm-workspace.yaml` со значением `true` или `false` и причиной в комментарии.
4. **Скрипты с переменной-префиксом.** `test` запускается и там, где pnpm исполняет скрипты через
   cmd.exe (так на ПК, evidence Ticket-а 01, раздел 10). Варианты: `shellEmulator: true` в
   `pnpm-workspace.yaml` (pnpm исполняет скрипты своей оболочкой, похожей на bash, на любой системе;
   на ПК `--config.shell-emulator=true` запустил `test`) или переменная задаётся внутри маленького
   скрипта на Node. Выбор и причина — в Итог. На Mac все скрипты работают как прежде.
5. **`README.md`** — короткий раздел «Development on Windows», на английском, как весь README: что
   поставить (Git for Windows, node ≥22, pnpm версии из `packageManager`). Build Tools не нужны
   (пункт 2).
6. **Прогон на Windows-ПК:** `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm lint`,
   `pnpm typecheck`, `pnpm test`. Список упавших файлов `pnpm test` сверяется со списком evidence
   Ticket-а 01, раздел 17 (55 файлов до этого Ticket-а); в Итог — что изменилось, для Ticket-а 14
   (unit- и e2e-test-ы на Windows). Падения test-ов этот Ticket не чинит.

## Готово, когда

- [ ] Windows-ПК, свежий `git clone` с настройками Git for Windows по умолчанию: `git ls-files --eol harness/bin harness/hooks scripts build/brand` — у каждого текстового файла `w/lf`; `git status --porcelain` пуст; случай sha256 в `test/contract/make-icons.test.ts` зелёный.
- [ ] Mac: `git add --renormalize . && git status --porcelain` пуст — `.gitattributes` не меняет ни одного файла индекса (через раздел Mac checks PR, Q33).
- [ ] Windows-ПК: `pnpm install --frozen-lockfile` — exit 0 в Session Claude Code (там `NoDefaultCurrentDirectoryInExePath=1`, evidence Ticket-а 01, раздел 20) и без пересборки node-pty; после него `git status --porcelain` пуст.
- [ ] Windows-ПК: node-pty грузится в Electron — `pnpm exec electron -e "require('node-pty')"` при `ELECTRON_RUN_AS_NODE=1` — exit 0.
- [ ] Windows-ПК: `pnpm dev` открывает окно worfy; снимок — `../evidence/02-pnpm-dev.png`.
- [ ] Windows-ПК: `pnpm lint` и `pnpm typecheck` — exit 0.
- [ ] Windows-ПК: `pnpm test` стартует и печатает итог vitest; exit code и список упавших файлов с причиной — в Итог.
- [ ] Если появился `scripts/postinstall.mjs` — `test/contract/postinstall.test.ts` зелёный: на `darwin` скрипт зовёт `electron-rebuild --only node-pty`, на `win32` — нет.
- [ ] Mac: gate full зелёный (`lint`, `typecheck`, `test`, `test:e2e`, `test:package`) (по правилу needs-mac-gate: проверяет и вливает Session на Mac). Если выбран `shellEmulator` — ещё `pnpm install:stable "$(mktemp -d)/worfy.app"` ставит Stable copy, exit 0 (через раздел Mac checks PR, Q33).
- [ ] CI на PR зелёный (Linux).

## Тесты

Сначала — проверка, которая падает на нынешнем main: на Windows-ПК с `core.autocrlf=true` после
`git clone` команда `git ls-files --eol harness/bin` показывает `w/crlf`. На ПК владельца так и есть
(evidence Ticket-а 01, раздел 03). В Итог — как она падала.

Unit-test-ов Ticket почти не добавляет: он меняет настройки репозитория и установки, их проверяют
команды из «Готово, когда». Исключение — `scripts/postinstall.mjs`, если он появится: contract test
`test/contract/postinstall.test.ts` подменяет платформу параметром и проверяет, какую команду скрипт
запустил бы, без настоящей пересборки.

## Где в коде

- `.gitattributes` (новый)
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `README.md`
- `scripts/postinstall.mjs` (новый, если пункт 2 выбрал готовую сборку)
- `test/contract/postinstall.test.ts` (новый, вместе с ним)

Ticket-ы 03, 08, 09 и 11 ждут этот Ticket. Файлы package.json и pnpm-workspace.yaml потом меняет
Ticket 12 (сборка на Windows), он идёт позже.

## Итог

Заполняется при закрытии.
