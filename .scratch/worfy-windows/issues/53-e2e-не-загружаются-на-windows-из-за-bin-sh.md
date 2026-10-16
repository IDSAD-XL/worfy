# 53 — e2e на Windows не загружаются: `/bin/sh` при загрузке модуля в четырёх файлах `test/e2e`

Type: task
Status: open
Blocked by: —
Source: Session на Windows-ПК «Worfy тесты на ПК», ночь 2026-10-16: Playwright падает при загрузке spec-ов — `spawnSync /bin/sh ENOENT`. Код перечитан на Mac по main `9974e0e0`.

## Что происходит

- **Четыре файла `test/e2e` при загрузке модуля ищут zsh через `/bin/sh`:**
  `execFileSync('/bin/sh', ['-c', 'command -v zsh'])` на верхнем уровне файла.
  - `test/e2e/terminal-ai-helpers.ts:19` — `export const ZSH`;
  - `test/e2e/terminal-ai-settings.spec.ts:25`;
  - `test/e2e/terminal-ai-history.spec.ts:21`;
  - `test/e2e/settings-sessions.spec.ts:21`.

  На Windows `/bin/sh` нет: `execFileSync` бросает `ENOENT` раньше, чем Playwright узнаёт о test-ах
  файла.
- **Файлов, которые не загружаются, больше четырёх.** `test/e2e/wait.ts` импортирует `editedLine`
  из `terminal-ai-helpers.ts` (`:2`) — с PR #356 (2026-10-15). Через `wait.ts` или напрямую
  `terminal-ai-helpers.ts` грузят 12 spec-ов: `done-stack`, `epic-frame-undo`, `epic-frame`,
  `external-session`, `focus`, `session-controls`, `ship-ticket`, `subagent-tree`,
  `terminal-ai-fix`, `terminal-ai-next-command`, `terminal-ai-request`, `terminal-ai-suggest`. С
  тремя spec-ами со своим вызовом — 15 из 75.
- **Ошибка загрузки останавливает весь прогон.** Playwright сначала загружает все файлы
  `testDir` (`playwright.config.ts:17-18`). Ошибка загрузки хотя бы одного — и test-ы не
  запускаются. `pnpm test:e2e` и `pnpm test:package` (`package.json:20-21`) идут по всем spec-ам.
  Поэтому в `gate full` на Windows e2e не идёт ни один. Прогон отдельных spec-ов без этих импортов
  работает: так шёл срез 2 [Ticket-а 14](14-gate-full-на-windows.md) (2026-10-14, до PR #356).
- **Чем это не Ticket 14.** Ticket 14 перечисляет `/bin/sh` как подмену `SHELL` при запуске
  приложения и stub-ы `#!/bin/sh` — то, что ломает отдельные test-ы. Вызова `/bin/sh` при загрузке
  модуля, из-за которого не загружается весь набор, в нём нет. Эти четыре файла появились после
  того, как Ticket 14 написан: три — с Epic-ом `worfy-terminal-ai` 2026-10-14 (PR #306, #309,
  #310), `settings-sessions.spec.ts` — с worfy-polish 24 2026-10-16 (PR #376).
- **zsh этим test-ам нужен по смыслу.** Terminal AI работает в zsh: `.zshrc` sandbox-а, prompt
  `e2e% ` (`terminal-ai-helpers.ts:10-23`). PowerShell для Terminal AI — позже, вне Epic-а
  `worfy-terminal-ai` (`.scratch/worfy-terminal-ai/spec.md:178`). На Windows zsh нет, и эти test-ы
  там не идут.

## Что делаем

1. **Поиск zsh — функция, а не значение модуля.** `ZSH` в четырёх файлах заменяется функцией,
   которую зовут test-ы, которым нужен zsh (при запуске приложения, в `beforeAll` или в helper-е
   sandbox-а). Импорт файла ничего не запускает.
2. **Test-ы, которым нужен zsh, на `win32` пропускаются с причиной** («Terminal AI работает в zsh;
   на Windows zsh нет»). Остальные test-ы тех же файлов идут. На macOS и Linux ничего не меняется.
3. **`wait.ts` не тянет `terminal-ai-helpers.ts`**, если `editedLine` можно перенести в `wait.ts`
   или в отдельный файл без побочных действий. Выбор — в «Итог».
4. **Защита от повтора.** Test по тексту (как `test/unit/no-rmsync.test.ts`): ни один файл
   `test/e2e` не зовёт `execFileSync`, `execSync` или `spawnSync` на верхнем уровне модуля.
   Нынешние `const git = (...) => execFileSync(…)` — функции, они проходят.

## Готово, когда

- [ ] На Windows-ПК `pnpm exec playwright test --list` — exit 0: загружаются все spec-и. Вывод (число
      test-ов и файлов) — в «Итог». Это проверяет Session на Windows-ПК.
- [ ] На Windows-ПК `pnpm test:e2e` доходит до запуска test-ов. Сколько прошло и упало — в
      «Итог»; падения по существу — дело Ticket-а 14.
- [ ] На Mac test-ы Terminal AI и `settings-sessions.spec.ts` идут, как раньше: число test-ов в
      `--list` то же, что на main.
- [ ] Test по тексту красный на main (находит четыре вызова) и зелёный после правки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac; `gate full` зелёный на Mac.

## Тесты

- Unit: поиск вызовов на верхнем уровне модулей `test/e2e` — таблица случаев: вызов в теле функции
  проходит, `const X = execFileSync(…)` найден.
- Мутант: вернуть `export const ZSH = execFileSync(…)` в `terminal-ai-helpers.ts` — test по тексту
  красный.

## Где в коде

- `test/e2e/terminal-ai-helpers.ts`
- `test/e2e/terminal-ai-settings.spec.ts`
- `test/e2e/terminal-ai-history.spec.ts`
- `test/e2e/settings-sessions.spec.ts`
- `test/e2e/wait.ts`

## Вне скоупа

- Подмены `SHELL: '/bin/sh'` при запуске приложения (`terminal.spec.ts:40`, `focus.spec.ts:345` и
  другие), команды POSIX в Terminal и stub-ы `#!/bin/sh` — Ticket 14.
- Terminal AI на Windows (PowerShell) — позже, вне Epic-а `worfy-terminal-ai`.

## Итог

Сделано Session на Windows-ПК 2026-10-16, ветка `worfy-windows/53` от main `274c7eb`. Цифры ниже
— с Windows-ПК; пункты «на Mac» проверяет Session на Mac.

- **Поиск zsh — функция `zshPath()` в новом `test/e2e/zsh.ts`.** Она зовёт `/bin/sh` при первом
  вызове и запоминает ответ. Её зовут helper sandbox-а Terminal AI (`terminalAiSandbox`, из
  `beforeEach`) и запуск приложения в трёх spec-ах. `export const ZSH` и три своих `const ZSH`
  убраны. Импорт файла ничего не запускает.
- **Что пропускается на `win32`** (`test.skip(NO_ZSH, …)`, причина — «Terminal AI and the
  login-shell environment of these tests work in zsh; Windows has no zsh»):
  - целиком — `terminal-ai-fix`, `-next-command`, `-request`, `-suggest`, `-history`: каждый их
    test открывает Terminal на zsh;
  - один test — в `settings-sessions.spec.ts` (переменная из login shell) и в
    `terminal-ai-settings.spec.ts` (zsh, который уже идёт).
  Остальные test-ы этих двух файлов идут. `SHELL` на Windows им не задаётся: приложение там
  `SHELL` не читает и берёт PowerShell или Git Bash (`src/main/terminal/pty.ts:193-206`). На macOS
  и Linux `SHELL` тот же, что раньше.
- **`wait.ts` по-прежнему импортирует `editedLine` из `terminal-ai-helpers.ts`.** Выбор: не
  переносить. После правки у `terminal-ai-helpers.ts` нет побочных действий при загрузке, а test
  по тексту ниже держит это для всех файлов `test/e2e` и того, что они грузят. Перенос дал бы
  diff в двенадцати spec-ах без пользы.
- **Test по тексту — `test/unit/e2e-no-spawn-on-load.test.ts`.** Файлы читаются парсером
  TypeScript, а не по строкам: вызов внутри строки (скрипт в `epic-frame.spec.ts`) — не вызов.
  - Ищет `execFileSync`, `execSync`, `spawnSync` из `node:child_process` под своим именем, под
    alias-ом, через объект модуля, через `require`. Ещё ищет функции, которые их зовут, на любой
    глубине — и в `test/e2e`, и в файлах репозитория, которые `test/e2e` импортирует (например
    `scripts/build-version.ts`).
  - «При загрузке» — вне функции. Или в функции, которая идёт сразу: вызвана на месте или отдана
    вызову, который её запускает (`describe`, `[…].map`). Не идут сразу только функции, отданные
    `test`, его hook-ам и `test.step`.
  - Таблица — 30 случаев (19 «найден», 11 «проходит»), плюс случай helper-а из другого файла.
    Чего поиск не видит — в шапке файла.
- **Числа:**

  | Проверка | Main (`274c7eb`) | Ветка |
  |---|---|---|
  | Test по тексту | exit 1: находит четыре вызова — `terminal-ai-helpers.ts:19`, `terminal-ai-settings.spec.ts:25`, `terminal-ai-history.spec.ts:21`, `settings-sessions.spec.ts:21` | exit 0, 32 из 32 |
  | `pnpm exec playwright test --list` | exit 1, `Error: spawnSync /bin/sh ENOENT` | exit 0, «Total: 248 tests in 75 files» |

  - **Мутанты:** `export const ZSH = execFileSync(…)` в `terminal-ai-helpers.ts`, и вызов
    `zshPath()` на верхнем уровне spec-а. Test по тексту — exit 1, оба найдены.
  - **`pnpm test:e2e` на ветке:** exit 1, 86 passed, 137 failed, 8 skipped за 36.4 мин. Набор
    грузится, и test-ы идут. 8 skipped — ровно test-ы zsh выше. Ни одно падение не про `/bin/sh`
    при загрузке. 137 падений — в 53 файлах; это дело [Ticket-а 14](14-gate-full-на-windows.md).
    Пять из них — `Claude Code not found at …\claude (ENOENT)`: stub-а `claude` на Windows нет.
  - **`pnpm test` на ветке:** exit 1, 449 failed, 4908 passed, 84 skipped — падения Windows, как
    на main. Сравнение по имени test-а с прогоном main `524abb3` на том же ПК (444 failed):
    8 test-ов падают только на ветке, все — timeout или `EBUSY` в `e3-sandbox`, `harness-evals`,
    `projects-connect`, `terminal-windows` из `test/contract`. Повтор этих четырёх файлов
    отдельно: 0 падений сверх main. Значит, они падали от нагрузки полного прогона, а не от
    правки.
  - **`pnpm lint` exit 0, `pnpm typecheck` exit 0.**
- **Вне скоупа, найдено попутно.** Шесть файлов `test/contract` ищут zsh так же — при загрузке:
  `terminal-ai-fix`, `-next-command`, `-request`, `-suggest`, `-zle`, `terminal-shell-integration`.
  На Windows-ПК vitest роняет их целиком: `spawnSync /bin/sh ENOENT`, 0 test-ов. Весь прогон
  vitest от этого не останавливается, в отличие от Playwright. Отдельный Ticket — решение
  Session на Mac.
