# 15 — qmd на Windows или grep как явный запасной путь

Type: task
Status: open
Blocked by: 06, 07, 13, 14
Source: решения владельца 2026-10-07: Q21 (qmd на Windows — последним Ticket-ом порта, до того агенты ищут grep-ом), Q19 (скрипты, которые зовут hooks и worfy, — на Node; bash только в test-ах); «Готово, когда» Epic-а, пункты 3 и 4 (подтверждено 2026-10-08); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port» (qmd последним Ticket-ом); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md) (qmd — часть Harness, ставится с согласия); [ADR-0048](../../../docs/adr/0048-harness-plugin-spike-results.md) (имя MCP-сервера plugin-а); Ticket-ы E3: [17](../../worfy-harness/issues/17-qmd-модели-и-коллекции-в-harness.md) (qmd, модели и коллекции в Harness), [19](../../worfy-harness/issues/19-экран-первого-запуска.md) (экран первого запуска); [spec.md](../spec.md)

## Что происходит

- qmd — локальный поиск по markdown (ADR, HANDOFF, Ticket-ы, память Claude). Агенты зовут его
  через MCP-сервер. Работает ли qmd на Windows, не установлено. Ticket 01 (проверка фактов на живой
  Windows) пробует его поставить и пишет исход в evidence.
- Три обёртки qmd — на zsh (`#!/bin/zsh` в первой строке `harness/bin/qmd-mcp`,
  `harness/bin/qmd-refresh`, `harness/bin/qmd-sync-main`). В Git Bash zsh нет. Места, которые
  держат их на macOS (строки на 4f983ef; E3 Ticket 17 эти файлы ещё меняет — перечитать):
  - qmd ищется через nvm: `qmd-mcp:14-17`, `qmd-refresh:84-87`;
  - BSD `stat`: `stat -f%z` (`qmd-mcp:27`), `stat -f%m` (`qmd-refresh:135`);
  - zsh: путь своего файла `${0:A:h}` (`qmd-refresh:36`, `qmd-sync-main:30`), glob `(N)`
    (`qmd-refresh:117`);
  - папки qmd — `$HOME/.cache/qmd` (`qmd-mcp:23`, `qmd-refresh:33`) и `$HOME/.config/qmd/index.yml`
    (`qmd-refresh:34`). Где qmd держит индекс и модели на Windows, не установлено.
- Test-ы: `harness/bin/tests/qmd.test.sh` зовёт скрипты через `zsh` (`:29`, `:38`, `:75`),
  `harness/bin/tests/harness-home.test.sh` — тоже (`:151`, `:185`, `:190`). Stub-ы в
  `qmd.test.sh` — `#!/bin/sh` (`:25`, `:46`, `:50`). `test/contract/harness-scripts.test.ts:40` требует `zsh` в PATH,
  CI ставит его шагом «Install zsh» (`.github/workflows/ci.yml:39-42`, комментарий называет
  qmd-скрипты). zsh нужен и блокам skills: `harness/bin/tests/skill-blocks.test.sh:42`, `:53` гонят
  их под bash и под zsh. На Windows `qmd.test.sh` пропускает Ticket 14 (gate full на Windows) с
  причиной, которая называет этот Ticket.
- E3 Ticket 17 (на 4f983ef открыт) приносит:
  - `harness/.mcp.json` — сервер `qmd` с командой `${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp`, то есть по
    shebang;
  - Stop-hook `qmd-refresh --quiet` в `harness/hooks/hooks.json`;
  - `harness/bin/qmd-collections` на Node — коллекции по Profile, строка `update:` коллекции зовёт
    `<папка plugin>/bin/qmd-sync-main <project>`; путь памяти Claude кодируется заменой `/` и `.` на
    `-`;
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
  - По docs Claude Code локальному MCP-серверу через `npx` на Windows нужна обёртка `cmd /c`.
    Серверу с командой `node` — настоящим `.exe` — она не нужна.
  - Как Claude Code кодирует путь `C:\a\b` в имя папки `projects`, проверяет Ticket 01; в worfy это
    делает Ticket 08 (`src/main/claude-home/registry.ts:44`). `qmd-collections` строит путь памяти
    Project так же.
  - Как qmd исполняет строку `update:` коллекции (через оболочку или нет), не установлено.

## Что делаем

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
     `src/main/claude-home/registry.ts` после Ticket-а 08.
3. **Windows: какой путь** (Q21). Исполнитель ставит qmd на ПК владельца модулем E3 (с согласия) и
   проверяет `qmd --version`, `qmd search` и ответ `qmd mcp`. По этому и по evidence Ticket-а 01 —
   один из двух путей. Какой и почему — в Итог.
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

- [ ] `grep -lE '^#!.*zsh' harness/bin/*` — пусто (код 1).
- [ ] `bash harness/bin/tests/qmd.test.sh` — код 0 на Mac и в Git Bash на ПК владельца; скрипты в нём вызваны через `node`.
- [ ] `bash harness/bin/tests/harness-home.test.sh` и `bash harness/bin/tests/qmd-collections.test.sh` — код 0 на Mac и в Git Bash.
- [ ] Contract `test/contract/harness-qmd.test.ts`: поведение E3 Ticket 17 держится на Node-версии — без ответа «скачано» `qmd-mcp` выходит с кодом не 0 и не запускает `qmd mcp`; при `language.docs` = `ru` задана русская модель расширения запроса; `harness/.mcp.json` и Stop-hook в `harness/hooks/hooks.json` зовут скрипты через `node`. Зелёный на Mac и на ПК владельца.
- [ ] Путь А: на ПК владельца экран первого запуска ставит qmd с согласия, `qmd --version` — код 0; в Session worfy на Windows агент на вопрос об ADR зовёт `mcp__plugin_worfy_qmd__query` и находит файл в `docs/adr`. Снимок — `../evidence/15-qmd-windows.png`.
- [ ] Путь Б: contract `test/contract/workflow-profile.test.ts` — на `win32` в `allowedMcpServers` Session-а нет сервера qmd, на `darwin` — есть; `node harness/bin/qmd-mcp` на ПК владельца — код не 0 и одна строка в stderr; строка qmd на экране первого запуска — `warn` с текстом про grep; в Session worfy на Windows агент находит ADR grep-ом по `docs/adr`. Снимок — `../evidence/15-qmd-windows.png`.
- [ ] `bash harness/bin/tests/skill-blocks.test.sh` — код 0 на Mac и в Git Bash.
- [ ] `GATE_SCOPE=all` gate full (команда Gate — какой её оставил Ticket 03) — код 0 на Mac и на ПК владельца; на Windows `harness-scripts.test.ts` гоняет `qmd.test.sh`, а не пропускает его.

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
- `harness/.mcp.json`
- `harness/hooks/hooks.json`
- `harness/skills/qmd/SKILL.md`
- `harness/bin/tests/qmd.test.sh`
- `harness/bin/tests/harness-home.test.sh`
- `harness/bin/tests/qmd-collections.test.sh`
- `src/main/harness/qmd.ts`
- `src/main/first-run/checks.ts`
- `src/main/workflow/profile.ts`
- `docs/design/F-SPEC.md`
- `test/contract/harness-qmd.test.ts`
- `test/contract/workflow-profile.test.ts`
- `test/contract/first-run-checks.test.ts`
- `test/contract/harness-scripts.test.ts`
- `.github/workflows/ci.yml`

`src/main/workflow/profile.ts` и `test/contract/workflow-profile.test.ts` меняются только на пути Б.
`.github/workflows/ci.yml` — только комментарий шага «Install zsh». Пути файлов E3 — из плана E3
Ticket-а 17; если E3 положил код иначе, Ticket 01 правит этот раздел.

Ticket последний перед приёмкой: Ticket-ы 06, 07, 13 и 14 к нему влиты, общих файлов в одной Wave
нет.

## Итог

Заполняется при закрытии.
