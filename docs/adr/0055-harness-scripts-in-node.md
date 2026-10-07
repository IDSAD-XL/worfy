# 0055 — Скрипты Harness — на Node; bash остаётся только в test-ах; `.gitattributes` держит LF в скриптах
Дата: 2026-10-07. Статус: принят.

**Контекст.** Harness — plugin `worfy` из `harness/` репозитория (ADR-0019; доставка — ADR-0040).
Его скрипты вызывают три стороны:

- hooks Claude Code — связка `harness/hooks/hooks.json`;
- сам worfy — `epic-status` и `profile` через `execFile` (`src/main/workflow/reader.ts:99`,
  `src/main/workflow/profile.ts:64`);
- агенты — по тексту skills и agents, через `${CLAUDE_PLUGIN_ROOT}` и PATH (spike, ADR-0040).
  Например, Gate skills зовут как `bash "${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast`
  (`skills/epic-wave/SKILL.md:208`, `skills/ship-ticket/SKILL.md:167`), а `epic-status` — по пути
  без интерпретатора (`skills/continuous-audit/SKILL.md:52`).

Сегодня скрипты написаны на трёх языках:

- bash — hooks `inject-rules.sh` (правила Harness в Session и Subagent, ADR-0041),
  `session-start.sh`, `session-end.sh`, `stop.sh`, `gate.sh` (Gate); `bin/epic-status`,
  `bin/preflight`;
- Node — `bin/profile`, `bin/ticket`, `bin/worktree-lock`, `bin/epic-board`, `hooks/guard.mjs`,
  `hooks/gate-resolve.mjs`;
- zsh — обёртки qmd `bin/qmd-mcp`, `bin/qmd-refresh`, `bin/qmd-sync-main` (ADR-0043);
- test-ы — 8 файлов `.sh` в `bin/tests` и 5 в `hooks/tests`.

Полный порт под Windows (ADR-0054) требует, чтобы те же скрипты работали и там. Бриф фактов о порте
(2026-10-07; ссылки перечитаны, на Windows ничего не запускалось) нашёл:

- **Вызов по shebang (строке `#!` в начале файла).** `hooks.json` зовёт скрипт по пути, без
  интерпретатора: `.sh` (строки 9, 18, 27, 47, 58, 69, 80, 100), `bin/worktree-lock` без расширения
  (36, 89, 109), `hooks/guard.mjs` (121). worfy зовёт `epic-status` и `profile` так же. По брифу на
  Windows нужен явный `bash …` или `node …`. Срабатывает ли вызов по shebang, когда hook идёт в Git
  Bash, на живой Windows не проверялось.
- **Git Bash — это GNU coreutils, а не BSD-утилиты macOS.** Те же флаги там значат другое.
  `stat -f%z` (`bin/qmd-mcp:27`) и `stat -f%m` (`bin/qmd-refresh:135`) на macOS печатают размер и
  время изменения файла, а в GNU `stat -f` выводит сведения о файловой системе. `date -v-14d`
  (`skills/continuous-audit/SKILL.md:123`) GNU `date` не знает. `stat -f %m` стоит и в тексте
  skill-а `epic-wave` (`SKILL.md:324`).
- **zsh в Git Bash нет**, а обёртки qmd начинаются с `#!/bin/zsh`.
- **Другие зависимости bash-скриптов:** `jq` (на Windows ставится отдельно, `winget install
  jqlang.jq`); `shasum` (`hooks/gate.sh:113`, `:305`); PATH с `/opt/homebrew` и nvm
  (`gate.sh:96-101`); тайм-аут `with_timeout` в `bin/preflight` (строки 69–83) на perl, с
  `setpgrp` и `kill` группе процессов.
- **Node-скрипты почти переносимы.** Мешают три вещи: `process.env.HOME` без запасного
  `os.homedir()` (`bin/profile:33,177`, `bin/worktree-lock:39`, `hooks/gate-resolve.mjs:28`); вызов
  соседнего скрипта по пути без интерпретатора (`bin/ticket:83,107`, `bin/epic-board:66`); команда
  macOS `open` (`bin/epic-board:355`). `guard.mjs` годится как есть, нужен только вызов через `node`.
- **CRLF.** По вторичным источникам Git for Windows по умолчанию ставит `core.autocrlf=true`, а
  `.gitattributes` в репозитории нет. Значит, на Windows скрипты Harness и test-ы получат окончания
  строк CRLF, а bash на лишнем `\r` падает.

Решение владельца 2026-10-07 по вопросу Q19 Session проектирования «Несколько машин и порт под
Windows». `.gitattributes` решён без отдельного вопроса.

**Решение.**

1. **Все скрипты Harness вне test-ов — на Node.** Это то, что вызывают hooks и worfy (Q19), и то,
   что зовут skills и agents. Bash-hooks (`inject-rules`, `session-start`, `session-end`, `stop`,
   `gate`), `bin/epic-status`, `bin/preflight` и три обёртки qmd переписываются на Node. Одна
   реализация на обе системы. Ветка по платформе появляется только там, где без неё нельзя (пути,
   процессы, открытие файла), и делается API Node (`os.homedir()`, `path`, `child_process`, `fs`,
   `crypto`), а не утилитами shell.
2. **Вызов — явным `node`, не по shebang.** Команды в `hooks.json` имеют вид
   `node "${CLAUDE_PLUGIN_ROOT}/…"`. worfy тоже зовёт скрипт через `node`. Скрипт зовёт соседа
   через `process.execPath` и путь к файлу. Строка `#!/usr/bin/env node` остаётся для вызова по
   имени из PATH на Mac. Если в Git Bash вызов по shebang не работает (это проверяет Ticket 01
   Epic-а `worfy-windows`), skills и agents тоже переходят на явный `node`.
3. **Контракт скриптов не меняется.** Остаются прежними имена команд в PATH (`epic-status`,
   `ticket`, `profile`, `preflight`), аргументы, коды выхода, вывод и файлы, которые пишет скрипт:
   вердикт Gate, маркеры `gate/state`, замки worktree. worfy читает вывод скриптов Harness
   (ADR-0002, ADR-0019), а hooks и skills — их коды выхода. Машинный контракт без языка (ADR-0044)
   тоже прежний. Переписывается реализация, а не интерфейс.
4. **bash — только в test-ах.** 13 нынешних test-ов `.sh` остаются и проверяют Node-скрипты
   снаружи, по контракту из пункта 3. Они используют bash, perl, `jq` и `/tmp`, поэтому на Windows
   идут только в Git Bash.
5. **`.gitattributes` держит LF в скриптах.** В корне репозитория появляется `.gitattributes` с
   `eol=lf` для скриптов и test-ов Harness. Checkout на Windows с `core.autocrlf=true` тогда не
   превращает их в CRLF. Точный список шаблонов задаёт Ticket, который добавляет файл.
6. **Команды в тексте skills.** Их агент выполняет Bash tool-ом, на Windows — в Git Bash. BSD- и
   macOS-команды (`stat -f`, `date -v`, проверка `.app` в `skills/ship-ticket/SKILL.md:186-196`)
   заменяются вызовом скрипта Harness на Node или командой, которая одинаково работает в BSD и GNU.
   Шаг, который на Windows по смыслу другой (проверка собранного приложения), получает свою ветку.
7. **Где и когда.** Переписывают Ticket-ы Epic-а `worfy-windows` после закрытия E3 обычными PR в
   `harness/` (ADR-0047). Такой PR — платформенный и перед мержем проверяется на Windows (ADR-0056).
   Mac при этом не должен сломаться: в «Готово, когда» Epic-а `worfy-windows` стоит зелёный
   gate full на Mac.

**Связь с ADR Epic-а E3 `worfy-harness` (ADR-0040…0048).** Решение меняет реализацию скриптов, а не
устройство Harness.

- ADR-0040 (доставка: копия `harness/` в `~/.claude/worfy-harness/plugin/`, версия
  `<semver>+<SHA>`) — в силе; копируются Node-скрипты.
- ADR-0041 (правила через hooks `SessionStart` и `SubagentStart`, части не длиннее 10 000 символов)
  — в силе. `inject-rules` становится Node-скриптом; тексты правил не меняются.
- ADR-0042 (Profile целиком на машине) — `bin/profile` уже на Node; правка — `os.homedir()` вместо
  `HOME`.
- ADR-0043 (qmd — часть Harness) — обёртки `qmd-mcp`, `qmd-refresh` и `qmd-sync-main` переезжают в
  plugin и переписываются на Node. Работает ли сам qmd на Windows, решает последний Ticket порта
  (ADR-0054, пункт 6).
- ADR-0044 (Harness по-английски, машинный контракт без языка) — сообщения новых скриптов
  по-английски; контракт — по пункту 3.
- ADR-0047 (урок — PR в `harness/`; после мержа — `pnpm install:stable`; `~/.claude` заморожен) —
  переписывание идёт этим путём; в `~/.claude` ничего не правится.
- ADR-0048 (итоги spike) — hook `SessionStart` пишет в `CLAUDE_ENV_FILE` строку
  `export GH_TOKEN="$(gh auth token -u <account>)"`. Она остаётся строкой shell: Claude Code
  исполняет файл перед каждой командой Bash, а на Windows Bash — это Git Bash. Node-hook пишет ту же
  строку.

**Последствия.**

- У скриптов один код на Mac и на Windows. Ветки по платформе лежат внутри Node-файла, и их
  проверяет один набор test-ов.
- Переписать нужно пять bash-hooks, `epic-status`, `preflight` и три обёртки qmd. По брифу это
  самая рискованная часть порта. Центральная из них — Gate. Пока его Node-версии нет, работает ли
  `gate.sh` на Windows в Git Bash, не проверено. До неё вердикт на Windows дают команды проверки
  Project-а с кодами выхода, и отчёт говорит, что Gate не запускался.
- С явным `node …` в `hooks.json` node должен быть в PATH до запуска скрипта. Сегодня `gate.sh` сам
  дописывает в PATH nvm и `/opt/homebrew` (`gate.sh:94-101`: «The hook shell starts with a bare
  PATH»), а `guard.mjs` и `worktree-lock` уже зовутся через `env node`. Как hook находит node на
  обеих системах, решает Ticket переписывания Gate.
- Если имя файла Gate сменится (`gate.sh`), меняются и ссылки на него: определение Gate в
  `CONTEXT.md`, вызовы в skills (`epic-wave/SKILL.md:208`, `ship-ticket/SKILL.md:167`,
  `overnight-fix-loop/SKILL.md:216`) и правило в `hooks/rules/common.md:57`.
- Skills, agents и люди, которые зовут `epic-status`, `ticket` или `profile` по имени, разницы не
  замечают (пункт 3).
- Test-ы остаются на bash: на Windows их гоняют в Git Bash с `jq` и perl, в CI на Linux — как
  сейчас.

## Considered Options

- **Node для всех скриптов Harness, bash только в test-ах** (выбрано, Q19).
- **bash под Git Bash с ветками флагов.** Отвергнуто. В каждом скрипте было бы два диалекта:
  `stat -f` и `stat -c`, `date -v` и `date -d`, PATH macOS и Windows. Каждую ветку пришлось бы
  проверять на своей системе. На Windows добавились бы зависимости — `jq`, `shasum`, perl. Обёртки
  qmd на zsh всё равно пришлось бы переписать, а вызов из hooks — всё равно делать явным
  (`bash …`).
- **Двойники на PowerShell (`.ps1`) для Windows.** Отвергнуто: две реализации каждого скрипта
  расходятся, а worfy читает их вывод (ADR-0019).
- **Скрипты Harness через WSL.** Отвергнуто: Claude Code на Windows запускает hooks в Git Bash, а не
  в WSL; у WSL свои пути и окружение; пользователю пришлось бы ставить WSL ради скриптов.
- **Обёртки qmd оставить на zsh, только для macOS.** Отвергнуто: в «Готово, когда» Epic-а
  `worfy-windows` — скрипты Harness работают на обеих системах, а qmd на Windows — последний Ticket
  порта (ADR-0054), и обёртки ему понадобятся.
- **Test-ы тоже переписать на Node.** Не выбрано: 13 test-ов на bash уже проверяют контракт снаружи.
  Переписать их вместе со скриптами — потерять независимую проверку, что контракт не сдвинулся.
