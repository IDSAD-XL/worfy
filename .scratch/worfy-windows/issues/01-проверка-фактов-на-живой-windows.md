# 01 — Проверка фактов порта на живой Windows и правка Ticket-ов Epic-а

Type: task
Status: open
Blocked by: —
Source: решения владельца 2026-10-07: Q1 (полный порт worfy под Windows), Q12 (Epic-и worfy-link и worfy-windows идут параллельно, мерж в main по очереди), Q18 (Git for Windows обязателен), Q21 (qmd на Windows — последним Ticket-ом порта, до того grep), Q22 (неподписанный установщик NSIS до E4 — Epic-а подписи и внешних пользователей; если включён Smart App Control — вопрос подписи сразу), Q24 (Windows 10 21H2+ и 11, только x64), Q25 (Session на Mac и Session на Windows общаются через репозиторий) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»

## Что происходит

- Ticket-ы 02–17 этого Epic-а написаны на Mac. На Windows ничего не запускалось. Ниже — факты, на
  которых они стоят и которые никто не проверял.
- **Имя папки транскриптов.** worfy ищет транскрипты Session-ов в папке
  `<Claude home>/projects/<имя>`. Имя считает `projectDirName`
  (`src/main/claude-home/registry.ts:42-47`): каждый символ, кроме латинских букв и цифр, становится
  `-`. Так ли Claude Code кодирует `C:\a\b`, не известно.
- **node-pty** (библиотека псевдотерминала для Terminal Node). Root `postinstall`
  (`package.json:20`) пересобирает его из исходников: `electron-rebuild --only node-pty`. На Windows
  для этого нужны Visual Studio Build Tools и Python. В пакете node-pty 1.1.0 уже есть сборка под
  Windows: `prebuilds/win32-x64` (`pty.node`, `conpty.node`, `winpty-agent.exe`). node-pty ищет
  сборку сначала в `build/Release`, потом в `prebuilds/<платформа>-<arch>`
  (`node_modules/node-pty/lib/utils.js:18-19`). Модуль собран на N-API (ABI, не зависящий от версии
  Node), поэтому готовая сборка может подойти Electron без пересборки. Не проверено.
- **Скрипты `package.json`.** `test` задаёт переменную префиксом:
  `ELECTRON_RUN_AS_NODE=1 electron …` (`package.json:16`). Это синтаксис POSIX shell. Через какую
  оболочку pnpm исполняет скрипты на Windows, не проверено.
- **Перевод строк.** `.gitattributes` в репозитории нет. В индексе все текстовые файлы с LF
  (`git ls-files --eol`). Что Git for Windows по умолчанию ставит `core.autocrlf=true`, известно
  только из вторичных источников. Тогда скрипты Harness получат в рабочем дереве CRLF.
- **Длина пути.** Лимит Windows — 260 символов (MAX_PATH). Пути вида
  `<клон>\.claude\worktrees\<имя>\node_modules\.pnpm\…` длинные. Упирается ли в лимит
  `pnpm install` в worktree, не проверено.
- **Hooks.** `harness/hooks/hooks.json` зовёт скрипты по shebang (строка `#!` в начале файла):
  `.sh` (`:9`, `:18`, `:27`, `:47`, `:58`, `:69`, `:80`, `:100`), `bin/worktree-lock` (`:36`, `:89`,
  `:109`), `hooks/guard.mjs` (`:121`). По docs hooks Claude Code на Windows команда hook-а идёт в
  Git Bash, а при отсутствии Git Bash — в PowerShell. ADR-0055 переводит команды на вид
  `node "${CLAUDE_PLUGIN_ROOT}/…"`. Работает ли shebang в hooks, в каком виде приходят
  `${CLAUDE_PLUGIN_ROOT}`, `cwd` и `tool_input.file_path` — не проверено.
- **Инструменты Git Bash.** Скрипты и test-ы Harness зовут `jq`, `shasum`
  (`harness/hooks/gate.sh:113`, `:305`; `harness/hooks/stop.sh:73`, `:75`), perl
  (`harness/bin/preflight:71-83`), `realpath`. Скрипты qmd (поиск по документам Project-а, часть
  Harness по ADR-0043) — на zsh: `#!/bin/zsh` в `harness/bin/qmd-mcp`, `qmd-refresh`,
  `qmd-sync-main`. zsh в Git Bash нет.
- **`bash` в PATH.** Contract test `test/contract/harness-scripts.test.ts` входит в `pnpm test`. Он
  требует в PATH `bash`, `zsh`, `jq`, `git`, `node` (`:40`) и гоняет test-ы Harness командой
  `bash <файл>` (`:63`). На Windows первым в PATH может стоять `C:\Windows\System32\bash.exe` из WSL
  или не стоять ничего.
- **Домашняя папка.** Скрипты Harness берут её из `HOME` (`harness/bin/profile:33`,
  `harness/bin/worktree-lock:39`, `harness/hooks/gate-resolve.mjs:28`). Node `os.homedir()` на
  Windows читает `USERPROFILE`, а не `HOME`. Что видят hook и Git Bash, не проверено.
- **Пути у git.** Gate хеширует путь worktree в том виде, как его печатает
  `git rev-parse --show-toplevel` (`harness/hooks/gate.sh:105`, `:113`), а worfy — путь от
  `realpath.native` (`src/main/gate/state.ts:457`, `:460`). На Mac строки совпадают. Что печатает
  git на Windows (`C:/…`, `C:\…` или `/c/…`), не проверено.
- **qmd на Windows** — ставится ли и работает ли, не известно.
- **Smart App Control** (защита Windows 11, которая не даёт запускать неподписанные программы):
  включён ли на ПК владельца, не известно. От этого зависит, можно ли ждать с подписью установщика до
  E4 — Epic подписи, нотаризации и внешних пользователей (Q22).
- **E3 (worfy-harness — Harness как plugin worfy) ещё идёт.** На 2026-10-08 у него открыты Ticket-ы
  13–26. Они добавляют скрипты, которых сейчас нет: hook `harness/hooks/gh-token-env.sh` (E3 Ticket
  18), `harness/bin/qmd-collections` (E3 Ticket 17), `harness/bin/silent-check` (E3 Ticket 22),
  `harness/bin/project-connect` (E3 Ticket 24). Ticket-ы 03–06 и 15 этого Epic-а описывают скрипты
  по состоянию main на 4f983ef.
- **Эта Session — первая на Windows-ПК владельца.** По Q25 она общается с Session на Mac (Epic
  worfy-link) через репозиторий. Пока скрипты Harness на bash, ей нужен свой порядок работы: какие
  скрипты работают в Git Bash без правок, а какие заменять командами вручную.

## Что делаем

Код worfy и Harness не меняется. Всё, что найдено, пишется в evidence
`.scratch/worfy-windows/evidence/01-факты-windows.md`: на каждый вопрос — раздел `### NN. …` с
командой, её выводом и выводом одной фразой. Вопрос без ответа — «не установлено» и почему.

1. **Машина.** Claude Code на ПК уже стоит: в нём идёт эта Session. С согласия владельца, через
   winget, ставятся Git for Windows (`Git.Git`), node ≥22 (`OpenJS.NodeJS.LTS`), gh (`GitHub.cli`),
   PowerShell 7 (`Microsoft.PowerShell`) и pnpm версии из `packageManager` (`package.json:8`,
   11.22.0). Вход в gh делает владелец сам. Версии `git`, `node`, `gh`, `pnpm`, `pwsh`, `claude` — в
   evidence.
2. **Пробный запуск.** Клон worfy в папку пользователя. Затем `pnpm install --frozen-lockfile`,
   `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. По каждой команде — exit code и последние
   строки вывода. Для `pnpm dev` — снимок окна или текст ошибки. Для `pnpm test` — список упавших
   файлов test-ов с причиной одной строкой. Падения не чиним.
3. **Факты** (Q1, Q24) — по разделу evidence на вопрос:
   1. Windows: редакция, версия, номер build, архитектура (`cmd /c ver`,
      `$env:PROCESSOR_ARCHITECTURE`). Q24 требует 10 21H2+ или 11 и x64; ConPTY (псевдоконсоль Windows, её берёт node-pty) — build ≥
      18309.
   2. Smart App Control: включён, выключен или в режиме оценки (Windows Security → App & browser
      control). Если включён — вопрос о подписи установщика сразу уходит владельцу (Q22), его ответ
      пишется в evidence и в Ticket 12.
   3. Git for Windows: `git config --show-origin --get-all core.autocrlf` и `core.longpaths` сразу
      после установки.
   4. Какие `bash` и `sh` первыми в PATH PowerShell: `where.exe bash`, `where.exe sh`. Git Bash, WSL
      или ничего.
   5. Что есть в Git Bash: `command -v jq perl shasum sha1sum realpath zsh`. Что печатают
      `stat -f %m <файл>` и `date -v-14d` (флаги BSD, на которых стоят тексты skills).
   6. Пути у git и Git Bash: `git rev-parse --show-toplevel` и `git rev-parse --git-common-dir` в
      PowerShell и в Git Bash; `pwd` и `pwd -W` в Git Bash; регистр буквы диска.
   7. Домашняя папка: `HOME` и `USERPROFILE` в PowerShell, в Git Bash и в окружении hook-а;
      `node -p "require('os').homedir()"` там же.
   8. `pnpm install --frozen-lockfile` без Visual Studio Build Tools: проходит ли root `postinstall`
      (`package.json:20`); если нет — с какой ошибкой.
   9. node-pty в Electron без пересборки: без папки `build` у node-pty, с готовой сборкой из
      `prebuilds/win32-x64`, команда `pnpm exec electron -e "require('node-pty')"` при
      `ELECTRON_RUN_AS_NODE=1` — exit code и вывод.
   10. Оболочка скриптов pnpm: `pnpm config get script-shell`, `pnpm config get shell-emulator`;
       исход `pnpm test` на префиксе `ELECTRON_RUN_AS_NODE=1` (`package.json:16`).
   11. Длина пути: значение `LongPathsEnabled`
       (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`); `git worktree add` и
       `pnpm install --frozen-lockfile` в worktree `<клон>\.claude\worktrees\<имя из 40 символов>`;
       длина самого длинного пути в его `node_modules`.
   12. Имя папки транскриптов: Session Claude Code в `C:\a\b`, в папке с пробелом и в папке с
       кириллицей в имени. Имена их папок в `%USERPROFILE%\.claude\projects` сравниваются с
       `projectDirName` для тех же путей (`src/main/claude-home/registry.ts:42-47`).
   13. Hooks. Проверка — в папке-песочнице, через `.claude\settings.local.json` этой папки; hook
       пишет свой stdin и окружение в файл. `%USERPROFILE%\.claude` не меняется. Вопросы: (а)
       срабатывает ли hook, который зовёт скрипт по shebang; (б) срабатывает ли команда вида
       `node "${CLAUDE_PLUGIN_ROOT}/…"` (ADR-0055, пункт 2) и находит ли она node; (в) в каком виде
       приходят `${CLAUDE_PLUGIN_ROOT}` в команде и в окружении, `cwd`, `transcript_path` и
       `tool_input.file_path` — с `\` или с `/`; (г) доходит ли переменная, записанная hook-ом
       `SessionStart` в `CLAUDE_ENV_FILE`, до Bash tool (на этом стоит hook `GH_TOKEN` из E3 Ticket
       18).
   14. `claude.exe` из Agent SDK: путь пакета `@anthropic-ai/claude-agent-sdk-win32-x64` в
       `node_modules` после `pnpm install`; `claude.exe --version`.
   15. qmd: ставится ли `npm install -g @tobilu/qmd` той версии, что ставит E3 Ticket 17; что
       печатают `qmd status` и один поиск (Q21: если qmd не работает, Epic идёт на grep).
4. **Опись скриптов Harness** — на main после закрытия E3. Команда описи — `git ls-files harness/bin
   harness/hooks` без `tests` и первая строка каждого файла. На каждый скрипт: язык (по shebang), кто
   зовёт (hooks.json, skill, agent, worfy), работает ли в Git Bash без правок (команда и исход),
   какой Ticket этого Epic-а переводит его на Node. Hooks идут в Ticket 04, скрипты `bin` — в Ticket
   05 или 06, скрипты qmd — в Ticket 15. Новый скрипт E3, которому нет места, — в Итог как вопрос.
5. **Как ведётся Epic, пока Harness не на Node** (до Ticket-ов 03–06) — раздел evidence с этим
   заголовком:
   - как Harness и Profile worfy попали на ПК (команды установки plugin, запись реестра Gate);
   - какие скрипты Session зовёт как есть, а какие заменяет командами вручную. Например, если Gate в
     Git Bash не работает, проверка — `pnpm lint`, `pnpm typecheck`, `pnpm test` с exit code, и
     отчёт прямо говорит, что Gate не запускался;
   - как перед Wave Session смотрит открытые PR Epic-а worfy-link и их файлы (`gh pr list` и
     `gh pr view --json files`), пока это не делает skill `epic-wave` (Ticket 07). Мерж в main — по
     очереди (Q12, ADR-0056).
6. **Правка Ticket-ов 02–17** по фактам: срез (что входит и что нет), `Blocked by` (только номера
   этого Epic-а), file:line, «Готово, когда». Каждая правка ссылается на раздел evidence. Если факт
   снимает работу Ticket-а целиком, Ticket не удаляется: в «Что происходит» встаёт факт со ссылкой, а
   решение о закрытии уходит владельцу.
7. Один docs-PR: evidence и правки Ticket-ов. В Итог — по Ticket-у одна строка: что изменилось и
   почему.

## Готово, когда

- [x] `.scratch/worfy-windows/evidence/01-факты-windows.md` есть. В нём версии инструментов и номер build Windows. `grep -c '^### ' .scratch/worfy-windows/evidence/01-факты-windows.md` печатает не меньше 15. Каждый раздел — команда, вывод и вывод одной фразой либо «не установлено» с причиной.
- [x] В evidence — исход `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm lint`, `pnpm typecheck` и `pnpm test` на Windows: exit code каждой команды и хвост вывода; для `pnpm dev` — снимок окна или текст ошибки; для `pnpm test` — список упавших файлов с причиной.
- [ ] В evidence — опись скриптов `harness/bin` и `harness/hooks` на main после закрытия E3, с выводом команды описи. Каждый скрипт на bash и zsh приписан ровно к одному из Ticket-ов 03, 04, 05, 06 или 15.
- [x] В evidence — раздел «Как ведётся Epic, пока Harness не на Node»: установка Harness и Profile на ПК, команды для статуса Ticket-а, для epic-status, проверка вместо Gate, просмотр открытых PR worfy-link.
- [x] Smart App Control: состояние в evidence. Если он включён — вопрос о подписи задан владельцу, ответ записан в evidence и в Ticket 12.
- [x] Ticket-ы 02–17 правлены по фактам, каждая правка ссылается на раздел evidence. `bash harness/bin/epic-status --json > "$TMP/es.json"; echo $?` печатает 0. `--json` стоит до имени Epic-а: после имени печатается строка этапа, а не JSON; вывод — Ticket-ы всех Epic-ов репозитория. Отбор — на node, потому что `jq` в Git Bash может не быть (это проверяет этот же Ticket): `node -e "const t=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).tickets.filter(x=>x.epic==='worfy-windows'); console.log(t.length, t.every(x=>x.blockedParsed), t.every(x=>x.blockedNums.every(n=>n>=1&&n<=17)))" "$TMP/es.json"` печатает `17 true true`: 17 Ticket-ов Epic-а `worfy-windows`, у каждого `blockedParsed: true`, в `blockedNums` только номера 1–17.
- [x] `git diff --name-only origin/main...HEAD` в PR печатает только файлы под `.scratch/worfy-windows`.

## Тесты

Код не меняется, test-ов нет. Каждый факт в evidence стоит на выводе команды, снятом на ПК
владельца. Ревьюер сверяет: у каждого раздела есть команда и вывод; каждая правка Ticket-ов 02–17
ссылается на раздел evidence; вывод из факта следует, а не дописан.

## Где в коде

- `.scratch/worfy-windows/evidence/01-факты-windows.md` (новый)

Правятся Ticket-ы 02–17 этого Epic-а в папке .scratch/worfy-windows/issues. Только читаются:
package.json, harness/hooks/hooks.json, скрипты в harness/bin и harness/hooks,
src/main/claude-home/registry.ts, src/main/gate/state.ts, test/contract/harness-scripts.test.ts. С
Ticket-ами других Epic-ов общих файлов нет.

## Итог

Evidence — [`../evidence/01-факты-windows.md`](../evidence/01-факты-windows.md), снят 2026-10-09 на
ПК владельца (Windows 11 Pro 25H2, build 26200, x64), main `76f7ff8`. Пункт описи после закрытия E3
не отмечен: опись сделана на текущем main (раздел 18), повтор — отдельным коммитом после E3.

Правки Ticket-ов:

- 02 — node-pty: выбрана готовая сборка (`prebuilds/win32-x64` грузится в Electron 44.5.1, а
  пересборка падает и с Build Tools: `GetCommitHash.bat` из-за `NoDefaultCurrentDirectoryInExePath`,
  `MSB8040` Spectre), Build Tools не требуются; pnpm 11 повторяет install перед каждым скриптом;
  скрипты идут через cmd.exe; CRLF в Git Bash не ломает скрипты, но валит `make-icons`; числа
  `--eol` и исходный список упавших test-ов (разделы 03, 08, 09, 10, 17, 20, 21).
- 03 — git печатает `C:/…` (заглавная буква, `/`), отсюда правило тега; `shasum` есть, `jq` нет;
  node в hook-е находится; строки `hooks.json` по main (разделы 05, 06, 07, 13, 17, 18).
- 04 — hooks на Windows проверены: shebang и `node "${CLAUDE_PLUGIN_ROOT}/…"` работают, формы путей
  `C:/` и `C:\`, `CLAUDE_ENV_FILE` → Bash tool; `jq` нет — JSON в test-ах через `node -e`;
  `gh-token-env.sh` уже на main, `worktree-create.sh` в PR #150; строки `hooks.json` (разделы 05, 13, 18).
- 05 — `epic-board` падает на ENOENT при вызове соседа; shebang в Git Bash работает, поэтому
  перехода skills на явный `node` нет; `cygpath` есть; symlink — EPERM; PR #150 правит те же файлы
  (разделы 05, 07, 13, 18, 19, 22).
- 06 — perl есть, `jq` нет; исход `preflight` на ПК без Profile; `cygpath` есть; PR #150 правит
  `preflight` (разделы 05, 06, 18).
- 07 — `stat -f %m` и `date -v-14d` на ПК — exit 1; `TMPDIR` задан; `gh --jq` работает без `jq`;
  явный `node` в skills не нужен; `NoDefaultCurrentDirectoryInExePath` в окружении агента (разделы
  05, 13, 19, 20).
- 08 — `projectDirName` совпадает с Claude Code (пункт 4 без правки кода); `procStart` — FILETIME =
  `CreationDate`; `file_path` с `\`; оболочка `statusLine` не проверена; упавшие test-ы среза
  (разделы 12, 13, 17, 23).
- 09 — Claude Code сам нашёл Git Bash при WSL-bash первым в PATH; `claude.exe` в SDK-пакете;
  переменные родительской Session и `NoDefaultCurrentDirectoryInExePath`; `findOnPath` и псевдоним
  MSIX; упавшие test-ы среза (разделы 04, 13, 14, 17, 20, 25).
- 10 — node-pty запускает pwsh (MSIX), powershell и Git Bash через ConPTY; pwsh из winget — псевдоним,
  невидимый `existsSync`, — в поиск и в unit-test; кавычки в аргументах (разделы 01, 09, 16, 17, 25).
- 11 — `pnpm dev` на ПК открывает окно на First run; рамка и клавиши не проверялись (раздел 17).
- 12 — `claude-agent-sdk-win32-x64` ставится сам; prebuild node-pty годится при `npmRebuild: false`;
  Smart App Control выключен; скрипты pnpm — cmd.exe; `make-icons` красный из-за CRLF; E3 13/15/21
  на main (разделы 02, 03, 06, 09, 10, 14, 17, 24).
- 13 — код E3 (первый запуск, установщик, перенос) уже на main, `jq` проверяется и в Git Bash его
  нет; pwsh — MSIX; Git Bash находится; `harness-install` падает на stub без `.exe` (разделы 04, 05,
  13, 16, 17, 24, 25).
- 14 — исходный список 55 упавших файлов и общие причины (symlink, untrusted frame, `/bin/sh`, WSL
  bash); PATH ПК без `sh`; решение по symlink — в Итог с владельцем (разделы 04, 05, 17, 22).
- 15 — qmd 2.8.3 ставится, но падает с 0xC0000005 на любой команде с индексом — ожидаемый путь Б;
  E3 Ticket 17 на main; кодировка имени `projects` (разделы 12, 15, 18, 24).
- 16 — Smart App Control выключен на ПК; `jq` на экране первого запуска против пункта 1 Epic-а;
  CRLF скриптов в Git Bash незаметен (разделы 02, 03, 05, 21, 24).
- 17 — `gh --jq` без `jq`; пункт `pnpm test` на Windows сверяется со списком, пока не влит 14
  (разделы 05, 17, 19).

Работу ни одного Ticket-а факты целиком не сняли.

Вопросы владельцу (заданы в отчёте PR):

- Smart App Control по реестру выключен (`VerifiedAndReputablePolicyState = 0`) — сверить в Windows
  Security → App & browser control.
- `jq` — экран первого запуска (`checks.ts:132`) требует его, а в Git for Windows его нет: добавить
  `jqlang.jq` в требования чистой Windows (пункт 1 «Готово, когда» Epic-а) или убрать `jq` из skills
  и проверки на Windows?
- `harness/hooks/worktree-create.sh` (bash, PR #150, E3 Ticket 22) — если его вольют, переводить на
  Node в Ticket-е 04?
- Symlink в test-ах: на ПК режим разработчика выключен и 7 файлов test-ов падают с EPERM — пропуск на
  `win32` или включить режим разработчика (Ticket 14)?
