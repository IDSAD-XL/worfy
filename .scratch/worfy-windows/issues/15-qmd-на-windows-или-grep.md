# 15 — qmd на Windows или grep как явный запасной путь

Type: task
Status: done 2026-11-01T01:52Z
PR: #1173
Branch: worfy-windows/15
Blocked by: 06, 13, 14
Blocker note: 07 снят Orchestrator-ом 2026-10-31 — код 07 влит (#461), 07 ждёт только первую Wave на ПК (Q31); 15 от неё не зависит.
Source: решения владельца 2026-10-07: Q21 (qmd на Windows — последним Ticket-ом порта, до того агенты ищут grep-ом), Q19 (скрипты, которые зовут hooks и worfy, — на Node; bash только в test-ах); «Готово, когда» Epic-а, пункты 3 и 4 (подтверждено 2026-10-08); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port» (qmd последним Ticket-ом); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md) (qmd — часть Harness, ставится с согласия); [ADR-0048](../../../docs/adr/0048-harness-plugin-spike-results.md) (имя MCP-сервера plugin-а); Ticket-ы E3: [17](../../worfy-harness/issues/17-qmd-модели-и-коллекции-в-harness.md) (qmd, модели и коллекции в Harness), [19](../../worfy-harness/issues/19-экран-первого-запуска.md) (экран первого запуска); [spec.md](../spec.md)

## Что происходит

- qmd — локальный поиск по markdown (ADR, HANDOFF, Ticket-ы, память Claude). Агенты зовут его
  через MCP-сервер. На ПК владельца (node 22.13.0) `npm install -g @tobilu/qmd@2.8.3` во временный
  prefix — EXIT=0, `qmd --version` — `qmd 2.8.3 (facd35e)`; но `qmd status`, `qmd collection add` и
  `qmd search` падают с EXIT=-1073741819 (0xC0000005, access violation) без вывода, и с кешем во
  временной папке тоже. Нативные модули пакета — `better-sqlite3` и `tree-sitter-*` из
  `prebuilds/win32-x64`, `@reflink/reflink-win32-x64-msvc`; какой падает, не установлено (evidence
  Ticket-а 01, раздел 15). Сейчас на Windows qmd не работает: по Q21 Epic идёт на grep.
- Три обёртки qmd — на zsh (`#!/bin/zsh` в первой строке `harness/bin/qmd-mcp`,
  `harness/bin/qmd-refresh`, `harness/bin/qmd-sync-main`). В Git Bash zsh нет. Места, которые
  держат их на macOS (строки на 4f983ef; E3 Ticket 17 эти файлы ещё меняет — перечитать):
  - qmd ищется через nvm: `qmd-mcp:14-17`, `qmd-refresh:84-87`;
  - BSD `stat`: `stat -f%z` (`qmd-mcp:27`), `stat -f%m` (`qmd-refresh:135`);
  - zsh: путь своего файла `${0:A:h}` (`qmd-refresh:36`, `qmd-sync-main:30`), glob `(N)`
    (`qmd-refresh:117`);
  - папки qmd — `$HOME/.cache/qmd` (`qmd-mcp:23`, `qmd-refresh:33`) и `$HOME/.config/qmd/index.yml`
    (`qmd-refresh:34`). На Windows первый `qmd status` создал `%USERPROFILE%\.cache\qmd`, а с
    `XDG_CACHE_HOME` — `<XDG_CACHE_HOME>\qmd` (evidence Ticket-а 01, раздел 15); где qmd держит
    модели, не установлено.
- Test-ы: `harness/bin/tests/qmd.test.sh` зовёт скрипты через `zsh` (`:29`, `:38`, `:75`),
  `harness/bin/tests/harness-home.test.sh` — тоже (`:151`, `:185`, `:190`). Stub-ы в
  `qmd.test.sh` — `#!/bin/sh` (`:25`, `:46`, `:50`). `test/contract/harness-scripts.test.ts:40` требует `zsh` в PATH,
  CI ставит его шагом «Install zsh» (`.github/workflows/ci.yml:39-42`, комментарий называет
  qmd-скрипты). zsh нужен и блокам skills: `harness/bin/tests/skill-blocks.test.sh:42`, `:53` гонят
  их под bash и под zsh. На Windows `qmd.test.sh` пропускает Ticket 14 (gate full на Windows) с
  причиной, которая называет этот Ticket.
- E3 Ticket 17 (на 4f983ef был открыт, на main `76f7ff8` и `8cabc65` влит — evidence Ticket-а 01, разделы 18 и
  24) принёс:
  - `harness/.mcp.json` — сервер `qmd` с командой `${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp`, то есть по
    shebang;
  - Stop-hook `qmd-refresh --quiet` в `harness/hooks/hooks.json`;
  - `harness/bin/qmd-collections` на Node — коллекции по Profile, строка `update:` коллекции зовёт
    `<папка plugin>/bin/qmd-sync-main <project>`; папку памяти Claude строит
    `MATCH.replace(/[^A-Za-z0-9]/g, "-")` (`harness/bin/qmd-collections:270`) — тем же правилом, что
    `projectDirName`;
  - `src/main/harness/qmd.ts` — установка `npm install -g @tobilu/qmd@2.8.3` с согласия, подсказка
    `brew install node`, модели с размером и согласием; без ответа «скачано» `qmd-mcp` не стартует;
  - строку qmd на экране первого запуска (E3 Ticket 19).
- Имя инструментов сервера из plugin — `mcp__plugin_worfy_qmd__*`. Список серверов Session worfy
  по умолчанию — `DEFAULT_MCP_SERVERS` (`src/main/workflow/profile.ts:28`); он уходит в
  `managedSettings.allowedMcpServers` (`src/main/agent/options.ts:142`) и отсекает всё, чего нет в
  списке.
- Запасной путь уже есть в Profile: `qmd.fallback_grep` у worfy — `docs/adr`, `CONTEXT.md`,
  `HANDOFF.md`, `docs/design/F-SPEC.md`, `.scratch/<эпик>/`. Правило «нет qmd — grep по
  `qmd.fallback_grep`» в skills уже есть (E3 Ticket 17).
- Windows:
  - `npm install -g` кладёт в папку npm `qmd.cmd`. Node не запускает `.cmd` через `execFile` и
    `spawn` без `shell: true` (ошибка `EINVAL`, исправление CVE-2024-27980).
  - Сам `npm` worfy тоже запускает без оболочки (`src/main/harness/qmd.ts:183`, `:320`;
    `src/main/first-run/actions.ts:81`), а на Windows это `npm.cmd`. Владелец увидел это на экране
    первого запуска 2026-10-13: `npm install -g @tobilu/qmd@2.8.3 exited null: spawn npm ENOENT`
    ([Ticket 30](30-add-project-на-windows.md), раздел о наблюдениях владельца).
  - Тот же род — CLI, поставленные npm (`claude.cmd`, `npm.cmd`), запускаются без оболочки (добавлено
    2026-10-19, ревью срезов 3g и 3k Ticket-а 14; строки на main `16931520`):
    `scripts/e3-owner-check.sh:230` (`spawnSync("claude", …)`; после PR #528 — `:233`),
    `src/main/harness/migrate/restore.ts:385` (`spawnSync('claude', …)`),
    `src/main/first-run/actions.ts:91-93` (`npmPrefix`, `execFile('npm', ['prefix', '-g'], …)`). На Windows все три
    получают `ENOENT`, когда `claude` или `npm` есть только как `.cmd`.
  - По docs Claude Code локальному MCP-серверу через `npx` на Windows нужна обёртка `cmd /c`.
    Серверу с командой `node` — настоящим `.exe` — она не нужна.
  - Claude Code кодирует путь `C:\a\b` в имя папки `projects` как `C--a-b` — каждый символ вне
    `[A-Za-z0-9]` становится `-`, как `projectDirName` (evidence Ticket-а 01, раздел 12).
    `qmd-collections:270` строит папку памяти тем же правилом, поэтому для `C:\…` она совпадёт с
    папкой Claude Code.
  - Как qmd исполняет строку `update:` коллекции (через оболочку или нет), не установлено.

## Что делаем

**Сначала — исследование на ПК** (решение владельца 2026-10-23, Q3; код репозитория не меняется). Какой нативный
модуль `@tobilu/qmd` падает с 0xC0000005: `better-sqlite3`, `tree-sitter-*` или `@reflink/reflink-win32-x64-msvc`.
Например: загрузить каждый модуль отдельно из установленного qmd (`node -e "require(…)"`) и повторить падающую
команду с подменой по одному. Результат — модуль, версия, команда, которая падает, и есть ли сборка без
падения — в «Итог»; от него зависит путь в шаге 3.

1. **Обёртки на Node** (Q19, ADR-0055). `qmd-mcp`, `qmd-refresh` и `qmd-sync-main` переписаны с zsh на
   Node. Имена — без расширения, первая строка `#!/usr/bin/env node`. CLI, коды выхода, журнал и
   поведение — как после E3 Ticket 17 (согласие на модели, модель по языку Project, `--quiet`,
   `--wait`, `--describe`). Замены:
   - nvm → `qmd` из PATH, потом глобальная папка npm. На Windows скрипт запускает JS-файл qmd через
     `process.execPath`, а не `qmd.cmd`;
   - `stat -f` → `fs.statSync`; `${0:A:h}` → папка `fs.realpathSync(process.argv[1])`;
     `$HOME` → `os.homedir()`; glob `(N)` → `fs.readdirSync` с фильтром;
   - папки индекса и моделей — те, что qmd берёт на этой системе. Где они на Windows, исполнитель
     проверяет и пишет в Итог.
2. **Вызов через `node`.**
   - `harness/.mcp.json`: `"command": "node"`, `"args": ["${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp"]`.
   - Stop-hook в `harness/hooks/hooks.json`: `node "${CLAUDE_PLUGIN_ROOT}/bin/qmd-refresh" --quiet`.
   - `qmd-collections`: строка `update:` — `node "<папка plugin>/bin/qmd-sync-main" <project>`,
     если qmd исполняет её через оболочку. Если нет — исполнитель находит вид, который qmd
     запускает на обеих системах, и пишет в Итог. Уже записанные коллекции с прежним видом
     переписываются так же, как E3 Ticket 17 переписал старые пути `update:`: копия `index.yml`
     рядом, имена и `pattern` не меняются.
   - Путь памяти Project в `qmd-collections` на Windows — та же кодировка, что в
     `src/main/claude-home/registry.ts`: она уже совпадает (`qmd-collections:270`, evidence Ticket-а
     01, раздел 12), правка нужна, только если Ticket 08 её изменит.
3. **Windows: какой путь** (Q21). По evidence Ticket-а 01 (раздел 15) qmd 2.8.3 на ПК падает на
   любой команде с индексом — ожидаемый путь Б. Исполнитель ставит qmd на ПК владельца модулем E3 (с
   согласия) той версией, что тогда будет в `QMD_VERSION`, и проверяет `qmd --version`, `qmd search`
   и ответ `qmd mcp`. Если падение осталось — путь Б; если ушло — путь А. Какой и почему — в Итог.
   - **А. qmd работает.** Установка с экрана первого запуска на Windows: `npm install -g` в
     окружении процесса worfy (Ticket 09), подсказка для node — `winget install OpenJS.NodeJS.LTS`.
     Модели — с размером и согласием, как на Mac. Коллекции — через `qmd-collections`. Session worfy
     на Windows получает инструменты `mcp__plugin_worfy_qmd__*`.
   - **Б. qmd не работает — явный запасной путь.**
     - worfy на Windows не кладёт сервер qmd plugin-а в `allowedMcpServers` Session-а
       (`src/main/workflow/profile.ts`): Session не получает сломанный сервер.
     - `qmd-mcp` на Windows выходит с кодом не 0 и одной строкой в stderr: «qmd is not available on
       Windows: search with grep over qmd.fallback_grep of the Profile». Session из терминала видит
       её в `/mcp`. Убрать сервер и из терминала можно только правкой копии plugin-а, а она
       побайтно равна `harness/` сборки (E3 Ticket 13) — так этот Ticket не делает.
     - Строка qmd на экране первого запуска на Windows — `warn` «qmd is not available on Windows —
       agents search with grep (qmd.fallback_grep)», без действий установки и моделей.
     - `qmd-refresh` на Windows выходит с кодом 0 и ничего не делает: индекса нет.
     - Что нужно, чтобы перейти на путь А (что именно не работает в qmd на Windows), — долг в Итог.
4. **skill `qmd`** (`harness/skills/qmd/SKILL.md`): раздел про Windows — выбранный путь, и что
   делает агент, когда сервера нет. Блок с таблицей коллекций держит
   `harness/bin/tests/skill-blocks.test.sh` зелёным.
5. **Test-ы.** `qmd.test.sh` и строки qmd в `harness-home.test.sh` зовут скрипты через `node`;
   stub-ы — на Node там, где их зовёт Node-скрипт. Пропуск `qmd.test.sh` на Windows, который поставил Ticket 14, снят.
   Комментарий шага «Install zsh» в `ci.yml` называет причиной блоки skills, а не qmd; сам шаг
   остаётся. Проверка `zsh` в `harness-scripts.test.ts:40` на Windows остаётся пропущенной, если
   блоки skills под zsh идут только там, где zsh есть (решение Ticket-а 07).

**Не входит:** экран первого запуска целиком (E3 Ticket 19 и Ticket 13 этого Epic-а); подписи и
тексты остальных skills (Ticket 07); приёмка на чистой машине (Ticket 16).

## Готово, когда

- [x] Исследование: в «Итог» — какой нативный модуль qmd падает на ПК владельца с 0xC0000005 и на какой команде.
- [x] `grep -lE --directories=skip '^#!.*zsh' harness/bin/*` — пусто (код 1).
- [ ] `bash harness/bin/tests/qmd.test.sh` — код 0 на Mac и в Git Bash на ПК владельца; скрипты в нём вызваны через `node`.
- [ ] `bash harness/bin/tests/harness-home.test.sh` и `bash harness/bin/tests/qmd-collections.test.sh` — код 0 на Mac и в Git Bash.
- [ ] Contract `test/contract/harness-qmd.test.ts`: поведение E3 Ticket 17 держится на Node-версии — без ответа «скачано» `qmd-mcp` выходит с кодом не 0 и не запускает `qmd mcp`; при `language.docs` = `ru` задана русская модель расширения запроса; `harness/.mcp.json` и Stop-hook в `harness/hooks/hooks.json` зовут скрипты через `node`. Зелёный на Mac и на ПК владельца.
- [ ] Путь А: на ПК владельца экран первого запуска ставит qmd с согласия, `qmd --version` — код 0; в Session worfy на Windows агент на вопрос об ADR зовёт `mcp__plugin_worfy_qmd__query` и находит файл в `docs/adr`. Снимок — `../evidence/15-qmd-windows.png`.
- [ ] Путь Б: contract `test/contract/workflow-profile.test.ts` — на `win32` в `allowedMcpServers` Session-а нет сервера qmd, на `darwin` — есть; `node harness/bin/qmd-mcp` на ПК владельца — код не 0 и одна строка в stderr; строка qmd на экране первого запуска — `warn` с текстом про grep; в Session worfy на Windows агент находит ADR grep-ом по `docs/adr`. Снимок — `../evidence/15-qmd-windows.png`.
- [ ] `bash harness/bin/tests/skill-blocks.test.sh` — код 0 на Mac и в Git Bash.
- [x] На `win32` в `test/contract/harness-qmd.test.ts` — 0 пропусков: helper `needsShStubs` (`:53`, вызовы
      `:117`, `:128`) больше не нужен и удалён (ревью PR #519, low; добавлено 2026-10-20).
- [x] Подмены `test/fixtures/first-run-tools/npm.mjs` и `qmd.mjs` запускаются хотя бы одним test-ом до того,
      как сняты пропуски qmd на Windows: сейчас их не запускает ни один test ни на одной системе
      (`test/fixtures/first-run-tools/README.md:15`; ревью PR #523, low 2; добавлено 2026-10-20).
- [x] В e2e первого запуска нет веток Windows из-за qmd (тикет 81, ревью Mac PR #673; добавлено 2026-10-21):
      `NO_QMD` и `CHECK_RUN_CALL` в `test/e2e/first-run-sandbox.ts` убраны; `first-run.spec.ts` проходит
      шаги моделей qmd на Windows и кончается сводкой ровно с двумя известными warning-ами: нет bridge для Limits в
      сборке для разработки и нет `pwsh` в PATH песочницы; на других системах — «Everything is ready». Третий warning —
      красный. `settings-health.spec.ts` считает прогоны по `qmd --version` и на Windows, а его сводка на Windows — без
      warning строки qmd (текст пункта уточнён Orchestrator-ом 2026-10-31).
- [x] Сняты пропуски на Windows групп A–C в `harness/bin/tests/qmd-collections.test.sh` (`if [ "$WIN" = 1 ]` с
      причинами `NO_ZSH`, `NO_SH_QMD`, `NO_UPDATE_LINE`, а также ранний `return` в `accepted()`), и на Windows
      эти случаи зелёные: A — `qmd-sync-main` без zsh, B — запуск `qmd` (не по `#!`), C — строка `update:` на
      Windows, плюс пути в `index.yml` не вперемешку `/` и `\` (Ticket [77](77-qmd-collections-красный-на-windows.md);
      решение владельца 2026-10-20; добавлено 2026-10-20).
- [x] `scriptCommand` в `harness/bin/qmd-collections` запускает файл без строки `#!` через node
      (`process.execPath`); это неверно, если такой файл когда-нибудь окажется бинарным. Решить, как запускать
      файл без `#!` (напрямую или с понятной ошибкой), и закрепить test-ом (ревью PR #602 на Mac, low;
      добавлено 2026-10-20).
- [ ] `GATE_SCOPE=all` gate full (команда Gate — какой её оставил Ticket 03) — код 0 на Mac (по правилу needs-mac-gate: проверяет и вливает Session на Mac) и на ПК владельца; на Windows `harness-scripts.test.ts` гоняет `qmd.test.sh`, а не пропускает его.

## Тесты

Сначала падающий test — `harness/bin/tests/qmd.test.sh` с вызовом скриптов через `node`, как их
будут звать `hooks.json` и `.mcp.json`: zsh-версия под node падает с `SyntaxError`, test красный.
В Итог — как он падал.

- `harness/bin/tests/qmd.test.sh` — вызов через `node`, stub `profile` на Node.
- `harness/bin/tests/harness-home.test.sh` — строки qmd через `node`.
- `harness/bin/tests/qmd-collections.test.sh` — путь памяти Project на Windows.
- `test/contract/harness-qmd.test.ts` — поведение обёрток и вызов через `node`.
- `test/contract/workflow-profile.test.ts` — список серверов на `win32` (только путь Б).
- `test/contract/first-run-checks.test.ts` — строка qmd на Windows.
- `test/contract/harness-scripts.test.ts` — пропуск `qmd.test.sh` на Windows снят.

## Где в коде

- `harness/bin/qmd-mcp`
- `harness/bin/qmd-refresh`
- `harness/bin/qmd-sync-main`
- `harness/bin/qmd-collections`
- `harness/lib/qmd-common.cjs` (новый: общее у обёрток), `harness/lib/README.md`
- `harness/hooks/qmd-refresh.mjs` (удалён: Stop-hook зовёт `bin/qmd-refresh` через node)
- `harness/.mcp.json`
- `harness/hooks/hooks.json`
- `harness/skills/qmd/SKILL.md`
- `harness/README.md`
- `harness/bin/tests/qmd.test.sh`
- `harness/bin/tests/harness-home.test.sh`
- `harness/bin/tests/qmd-collections.test.sh`
- `harness/hooks/tests/rules-hooks.test.sh`
- `src/main/harness/qmd.ts`
- `src/main/first-run/checks.ts`
- `src/main/first-run/tools.ts` (новый), `src/main/first-run/actions.ts`
- `docs/design/F-SPEC.md`, `docs/roadmap.md`, `docs/adr/0043-qmd-is-part-of-harness.md` и страницы `docs/features`
- `test/contract/harness-qmd.test.ts`
- `test/contract/first-run-checks.test.ts`
- `test/contract/harness-hooks-qmd-refresh.test.ts` (удалён вместе с `harness/hooks/qmd-refresh.mjs`)
- `test/unit/agent-options.test.ts`
- `test/harness-scripts-suite.ts`, `test/harness-shell-tests.ts`
- `test/fixtures/qmd-stub`, `test/fixtures/first-run-tools`
- `test/e2e/first-run.spec.ts`, `test/e2e/first-run-sandbox.ts`, `test/e2e/settings-health.spec.ts`
- `.github/workflows/ci.yml`

`src/main/workflow/profile.ts` и `test/contract/workflow-profile.test.ts` менялись бы только на пути Б: не тронуты.
`.github/workflows/ci.yml` — только комментарий шага «Install zsh». Пути файлов E3 сверены с main
`76f7ff8` и `8cabc65`: `harness/.mcp.json`, `harness/bin/qmd-collections`, `src/main/harness/qmd.ts` есть
(evidence Ticket-а 01, разделы 18 и 24).

Ticket последний перед приёмкой: Ticket-ы 06, 07, 13 и 14 к нему влиты, общих файлов в одной Wave
нет.

## Итог

### Причина падения (замер ПК, 2026-10-30)

**Ответ.** Падает `better-sqlite3` 13.0.3, файл `prebuilds/win32-x64.node`, уже при загрузке (`process.dlopen`). Дело в
версии node: в `binding.gyp:21` стоит `NAPI_VERSION=10`, а node ниже 22.14 даёт только N-API 9. `engines` пакета при
этом `>=22`. На node 22.14 и новее qmd работает.

**Замер, ПК владельца, Windows 11 Pro 10.0.26300, 2026-10-30, `@tobilu/qmd@2.8.3` (`facd35e`).** Установка во временный
prefix.

`process.dlopen` одного этого файла, без qmd. На установках под 22.13.0 и 24.21.0 SHA256 файла совпадает
(`E21E5EFD…240A`, 1989632 байта):

| node | N-API | exit code |
|---|---|---|
| 22.13.0 | 9 | -1073741819 (0xC0000005), два запуска из двух |
| 22.13.1 | 9 | -1073741819 |
| 22.14.0 | 10 | 0 |
| 22.23.4 | 10 | 0 |
| 24.21.0 | 10 | 0 |

Команды из ticket-а 01, в отдельной домашней папке, поиск только BM25, модели не скачивались:

| node | `status` | `collection add` | `search "Windows port"` | `status` снова |
|---|---|---|---|---|
| 22.13.0 | -1073741819 | -1073741819 | -1073741819 | -1073741819 |
| 22.14.0 | 0 | 0 | 0, файл найден | 0 |
| 22.23.4 | 0 | 0 | 0, файл найден | 0 |
| 24.21.0 | 0 | 0 | 0, файл найден | 0 |

`qmd --version` — 0 на 22.13.0 и 24.21.0: он не открывает базу.

**Что исключено и чем.**
- `sqlite-vec` (`vec0.dll`, 0.1.9), замер: на 22.13.0 процесс падает на `new Database`, до расширения; с переименованным
  `vec0.dll` `qmd status` падает так же. На 24.21.0 `loadExtension`, `vec_version()` = v0.1.9 и таблица `vec0` — exit 0.
- `node-llama-cpp` 3.20.0, замер: `getLlama({ gpu: false })` — exit 0 на 22.13.0 и 24.21.0.
- `tree-sitter-*` и `@reflink`, чтение кода, не замер: qmd грузит tree-sitter как `.wasm` через `web-tree-sitter`
  (`src/ast.ts`), на этом пути нативные `.node` не загружаются; `@reflink` код qmd здесь не вызывает.
- Отсутствующая функция N-API, замер по именам: модуль импортирует только `KERNEL32.dll`, функции ищет через
  `GetProcAddress`; все 60 имён N-API, записанных в нём строками, `node.exe` 22.13.0 экспортирует.
- Smart App Control выключен, значит причина из qmd #1062 здесь не действует.

**Чужие данные, не наш замер.** `WiseLibs/better-sqlite3` #1514 (открыт): та же граница 22.14.0 на macOS, Linux и
win32-x64, стек из gdb на Linux в `napi_module_register_by_symbol`, и там же объяснение через `NAPI_VERSION=10`. Версии
12.x, по словам авторов issue, не падают; мы 12.x не проверяли.

**Предположение.** Механизм — регистрация модуля с N-API 10 на node с N-API 9. Держится на точном совпадении границы и
на стеке из #1514. Стек на Windows не снимали: журнал Windows события сбоя не дал. Какую версию `better-sqlite3`
получил ticket 01, в его записях нет; диапазон `^13.0.3` тот же.

**Не проверено.** Node и система на Mac и в CI. На node 24 npm не выполнил install-скрипты `node-llama-cpp` и
`tree-sitter-*`: `getLlama` на CPU и `embed` это не помешало (замер Wave ниже), про GPU неизвестно. Остальное, что здесь
стояло 2026-10-30 (`embed`, `vsearch`, `query` и модели, `qmd mcp`, индекс на настоящих папках), замерила Wave; обёртки теперь на Node.

**Что это меняет (Orchestrator, 2026-10-30).** Пункт исследования закрыт этим замером. Q21 (на Windows — grep до
ticket-а qmd) опирался на падение под node 22.13.0; node ПК по умолчанию теперь 24.21.0, и BM25 там работает, поэтому
выбор пути (шаг 3) снова открыт — решает владелец, но после того как Wave проверит пункты «Не проверено». Первая работа
Wave — эти команды на node 24; обёрткам — проверка node ≥ 22.14 (ниже процесс умирает без вывода). Перед Wave —
проверить свободное место на C: (2026-10-30 — 19.1 GB; gate full и модели qmd должны поместиться).

### Работа Wave (ПК, 2026-10-31)

**Путь — А** (решение владельца Q4, его передал мост 2026-10-31): qmd остаётся на Windows, обёртки на Node. grep — запасной путь, когда qmd не может
работать; ветки «qmd is not available on Windows» нет, `allowedMcpServers` не менялся.

**Как падал первый test.** `qmd.test.sh` с вызовом через `node` на zsh-скриптах: код 1, passed 8, failed 28,
`SyntaxError: Invalid or unexpected token` на второй строке `qmd-sync-main` и `qmd-mcp`. Сам `node harness/bin/qmd-mcp`
— код 1.

**Обёртки.** `qmd-mcp`, `qmd-refresh`, `qmd-sync-main` на Node, общее — в `harness/lib/qmd-common.cjs`. Когда qmd не
может работать, одна строка в stderr называет причину и grep по `qmd.fallback_grep`. Node ниже 22.14 или 23.0–23.5 (N-API 10
появился в 22.14 и 23.6) — код 3 у `qmd-mcp` и `qmd-refresh`; нет ответа `downloaded` — код 3 только у `qmd-mcp`,
`qmd-refresh` без согласия запускает `update` и пропускает `embed`; нет qmd — 127. `qmd-refresh --quiet` (Stop-hook) молчит
и всегда выходит с 0, ошибка уходит в журнал; строка о запасном пути на grep — в журнал, не чаще раза в сутки. `qmd-collections` записывает коллекции, пишет строку и выходит с 0 (раньше
строка «qmd not found» шла в stdout). `qmd.cmd` не запускается: обёртка читает из него путь к JS-файлу qmd и запускает его
своим node.

**`node` из `.mcp.json` на Mac.** Команда — `node`, как требует Ticket. Если первый `node` на PATH слишком старый, а в nvm
есть `node` не ниже порога и при нём qmd, `qmd-mcp` и `qmd-refresh` запускаются заново на нём, а не выходят с кодом 3; `node`, который не стартует, пропускается. Строка qmd на экране первого запуска в этом случае не говорит про grep. Кнопка «Download…» по-прежнему смотрит только на qmd в PATH.
**Известное ограничение:** если `node` на PATH нет совсем, обёртка не запустится, и этого здесь не решить: Claude Code покажет
`CONNECTION_CLOSED` без строки о причине. Это проверка на Mac (раздел «Осталось»).

**Замер qmd на настоящих папках** (ПК, node 24.21.0, модели Harness, отдельный HOME; прямые команды `qmd`, не через обёртки).
- `worfy-docs` на 85 документов: `embed` — 340 кусков за 1 мин 4 с; `vsearch` отвечает; гибридный `query` с расширением и
  rerank на английском и русском отвечает: первый rerank 90.2 с (23 куска), следующий 8.9 с (21 кусок).
- `qmd mcp` на этом индексе: `initialize` 1721 мс, инструменты `query`, `get`, `multi_get`, `status`, `query` по `lex` 7272 мс,
  по `vec` 4950 мс.
- Все коллекции: `embed` последней партии — 472 куска из 71 документа за 46 с; `status` — 771 документ, 6448 векторов, 0 в
  очереди; `query` — rerank 40 кусков за 11.7 с; `qmd mcp`: `initialize` 1347 мс, `lex` 10064 мс, `vec` 10783 мс.

**Не замерено:** использование GPU; гибридный `query` с моделями через обёртки (через `qmd-mcp` проверен `query` по `lex`).

**Папки на Windows** (замер, отдельный HOME). Домашняя папка qmd — `HOME`, затем `USERPROFILE`. Индекс и модели —
`<дом>\.cache\qmd` (`index.sqlite`, `models`), `XDG_CACHE_HOME` важнее. Конфигурация — `<дом>\.config\qmd\index.yml`,
`QMD_CONFIG_DIR` и `XDG_CONFIG_HOME` важнее. `modelCacheDir` в `src/main/harness/qmd.ts` исправлен: читал только `HOME`.

**Как qmd исполняет `update:`** (код `src/cli/qmd.ts`, замер). `spawn("bash", ["-c", <строка>], { cwd: <папка
коллекции> })`, без оболочки ОС, на всех системах. Код не 0 от строки завершает весь `qmd update` с этим кодом. Значит, на
Windows нужна именно Git Bash. Форма строки на обеих системах: `node "<папка plugin с />/bin/qmd-sync-main" <project>`;
старые строки этого Project переписываются, рядом дата-копия `index.yml`, имена и `pattern` не меняются. Переписывается только
строка, в которой нет ничего, кроме необязательного `node`, пути к скрипту и профиля: составная строка владельца остаётся как есть,
но для `qmd-refresh` она по-прежнему git-копия профиля, чьё имя идёт сразу за первым `qmd-sync-main`. Обёртки ставят в
начало PATH для qmd папку своего node и папку Git Bash. Замер настоящим `qmd update`, PATH начинается с System32 (там
`bash.exe` из WSL): через `qmd-collections` и `qmd-refresh --force --wait` строка отработала, новый коммит нашёлся поиском.
Тот же `qmd update` руками с этим PATH дошёл до bash из WSL и упал (`Cannot find module '/mnt/c/…'`), код 1; без bash на
PATH — код 1. Поэтому в skill написано запускать `qmd-refresh --force --wait`.

**`plugin:worfy:qmd` `CONNECTION_CLOSED`.** Причина на этом ПК — `.mcp.json` установленного plugin-а запускает файл с
первой строкой `#!/bin/zsh`. Журналы MCP самого Claude Code с 2026-10-16: stderr сервера — сообщение cmd.exe, что `zsh`
не команда, затем `Connection failed (CONNECTION_CLOSED)`. Повтор той же команды через cmd.exe — код 1 и то же
сообщение. Установленный plugin не менялся: ошибка уйдёт, когда он обновится на эту версию. Новая форма `node
<plugin>/bin/qmd-mcp`, замер:
- нет ответа о моделях — код 3 и одна строка; нет qmd — код 127 и одна строка. **Предположение, не проверено:** Claude Code
  покажет те же слова `CONNECTION_CLOSED`, а строку с причиной — в `/mcp`. Замерено только, что stderr сервера попадает в его
  журнал MCP. Проверка — в разделе «Осталось»;
- qmd есть и согласие есть — `initialize` отвечает (`qmd` 2.8.3), инструменты `query`, `get`, `multi_get`, `status`,
  `query` по `lex` находит файлы настоящих папок worfy;
- закрыт stdin — код 0 за секунды; обёртка убита и закрыт stdin — ни одного процесса qmd не осталось.

**`scriptCommand`.** Файл без `#!` — программа, а не скрипт: запускается как есть. Бинарный файл работает; текстовый
получает отказ системы, и сообщение называет файл. Строка `#!` с node — текущим node; с другим интерпретатором — как
есть, на Windows через `bash`. Закреплено в `qmd-collections.test.sh`.

**Установка на Windows.** `npm`, `node` и `qmd` в `src/main/harness/qmd.ts` и `npmPrefix` запускаются как все инструменты
первого запуска (`toolStart`, файл `src/main/first-run/tools.ts`): `.cmd` через cmd.exe. Подсказка для node —
`winget install OpenJS.NodeJS.LTS`. Порог qmd — node 22.14, на линии 23 — 23.6 (contract-тест держит одинаковыми порог приложения и обёрток); установленный qmd на node ниже — `warn` с этой командой.

**Проверено на Linux (WSL на ПК, node 24.18.0, без jq):** `qmd.test.sh` — код 0. Случаи, которые идут только вне Windows (SIGTERM во время `--describe` и во время `qmd update`), прошли.
`qmd-collections.test.sh` там не запускался: нужен `jq`. Это не замена прогону на Mac.

**Мутационная проверка** `qmd.test.sh` и `qmd-collections.test.sh`: 40 мутантов обёрток (порог частоты, новая заметка, сдвиг main,
маркер `sync-failed`, ротация журнала, повторный запуск на node из nvm, порог node, блокировка при сигнале, папка фонового
обновления) — убиты все. Первый проход оставил два: случай без `last-index` дополнен коллекцией без заметок, а второй
оказался ошибкой прогона (этот test проверяет скрипты рядом с собой, а не из `BIN_DIR`). На новый код контрольного ревью — ещё
13 (строка `update:`, `node` из nvm, который не стартует, строка в журнале под `--quiet`, Harness home до смены папки, обработчик
сигнала). Убито 11 на Windows. Без проверки `--version` тест падает только на Linux: на Windows такой файл не запускается вовсе, и
его ловит `run.error`; без обеих проверок падает и на Windows. Отдельно `run.error` не убит: после проверки `--version` он сработает
только при гонке.

**Ответ на ревью PR #1173, раунд 1:** фоновое обновление получает найденный qmd аргументом и не ищет его второй раз (на Mac оно запускало
qmd рядом с node); `qmd-refresh` снова считает составную строку git-копией, а `qmd-collections` её не переписывает; тесты не достают
настоящий qmd. Mac смоделирован под WSL с qmd рядом с node: до правки 98 прошло и 5 упало, те же случаи, после правки 106 прошло, qmd рядом с node не запускался.

**Проверено на ПК:** `qmd.test.sh`, `qmd-collections.test.sh`, `harness-home.test.sh`, `skill-blocks.test.sh`,
`rules-hooks.test.sh`, `plugin-neutral.test.sh` — код 0; contract `harness-qmd`, `first-run-checks` — зелёные, в `harness-qmd`
0 пропусков. `grep -lE '^#!.*zsh' harness/bin/*` буквально даёт код 2 из-за папки `harness/bin/tests`; с
`--directories=skip` — пусто, код 1.

**Пропуски на Windows, которые остались, и почему.** Случаи сигналов в `qmd.test.sh` (SIGTERM во время `--describe`) и в
`qmd-collections.test.sh`: сигнал из Git Bash не доходит до node, а worfy завершает процесс через `taskkill /F`; брошенную
блокировку покрывают случаи с мёртвым pid. Проверка `zsh` в PATH: блоки skills под zsh идут только там, где он есть.

**e2e.** `NO_QMD` и `CHECK_RUN_CALL` убраны. `first-run.spec.ts` проходит шаги моделей на Windows, но «Everything is ready»
там недостижимо не из-за qmd: в сборке для разработки нет bridge для Limits, а в PATH песочницы нет `pwsh`. Поэтому сводка на
Windows — `2 warnings`, в `settings-health.spec.ts` — `1 failed · 5 warnings`. Замер на ПК, 2026-10-31, каждый файл целиком,
`--workers=1`: `first-run.spec.ts` — код 0, 8 passed; `settings-health.spec.ts` — код 0, 3 passed.

**Два известных warning-а на Windows.** В сводке первого запуска на Windows ожидаются ровно два warning-а: нет bridge для
Limits в сборке для разработки и нет `pwsh` в PATH песочницы; любой третий красный. Основание Orchestrator-а: решение
владельца 2026-10-31 о приёмке Windows (исправить или Windows exception). `first-run.spec.ts` проверяет их по именам:
строки с `data-status="warn"` — ровно `limits` и `powershell`, и текст причины каждой; другой warning вместо одного из них тоже
красный.

**Третий круг: красный job `windows (harness-scripts 2/2)`.** Ошибка в коде, а не в ожидании test-а: `gitBashDir` знал `git.exe` только
в `mingw64\bin`, а на runner Git новее, там `ucrt64\bin`. Запасной путь через `ProgramFiles` этот job не спасал: запускалка shell-тестов
передаёт короткий список переменных, `ProgramFiles` в нём нет. На ПК Git 2.45 с `mingw64`, поэтому здесь не воспроизводилось. Папка node
в PATH обновления стоит дважды, потому что `qmdEnv` применяется и в `qmd-mcp`, и в задаче обновления: это безвредно и причиной не было.
Запуск на ПК как на runner (тот же список переменных, node первая в PATH, `git.exe` в `ucrt64\bin` через junction): до правки exit 1,
106/1, та же строка, что в CI; после правки exit 0, 109/0. На настоящем runner это покажет CI.

**Осталось.** Все проверки на Mac; снимок владельца `../evidence/15-qmd-windows.png` и
проверка Session worfy (путь А); что показывает `/mcp` при коде 3 и 127 (предположение выше); на Mac — `node` из `.mcp.json`, когда
на PATH приложения нет `node` или он старый; gate full на Mac и ПК. Пункт «Путь Б» не применяется: выбран путь А.

**Merge при красном gate full на ПК.** PR #1173 слит, хотя gate full на ПК на `ba7e09e5` был красным на одном test-е,
`test/unit/docs-watch-root-gone.test.ts:450`. В одиночку на том же коммите он зелёный (по имени 3 из 3, весь файл 18 из
18), и он вне diff-а PR. Это решение самого Orchestrator-а по правилу 2026-10-20 для flaky test-а (перезапускать только
упавший шаг). Это не правило 2026-10-31 «исправить или Windows exception»: оно о приёмке Windows. Владелец может решить
иначе. Проверка этого кода — следующий зелёный gate full на ПК на main.
