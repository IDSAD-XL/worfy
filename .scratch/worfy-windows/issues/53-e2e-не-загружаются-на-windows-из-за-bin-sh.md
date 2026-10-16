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

—
