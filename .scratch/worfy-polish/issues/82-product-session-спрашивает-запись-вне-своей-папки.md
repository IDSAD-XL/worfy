# 82 — Product Session спрашивает разрешение на запись вне своей папки

Type: task
Status: claimed 2026-11-09T19:26Z
Branch: worfy-polish/82
Blocked by: —
Source: решение владельца 2026-11-09: тестер дал Product Session папку с документами задачи и попросил положить новые
версии в `context/strong/` своего репозитория. Сессия отказала («может писать только в своей папке») и попросила
скопировать файлы руками. Владелец: «на такой случай спрашиваем permission». Строки перечитаны по main `d551501fd`.

## Что происходит

- Запись Product Session-а вне её папки (`docs/product/` в Full mode, `<Workflow folder>/product/` в Silent mode)
  отклоняет worfy, а не Claude Code: PreToolUse hook `productGuard` (`src/main/vendors/claude/options.ts:640`,
  решение — `src/main/agent/product-guard.ts`). Он закрывает `Edit`, `MultiEdit`, `Write`, `NotebookEdit` (:39–44) с
  текстом «A Product Session writes files only below its Product Session folder» (:69–70), в любом permission mode.
- Правила сессии говорят то же: `harness/hooks/rules/product.md:72` («Files are written only under the topic folder»);
  их вставляет `harness/hooks/inject-rules.mjs` при `WORFY_SESSION_KIND=product`.
- Чтение не ограничено. Запись через shell (`cp`, `>`) hook не ловит: её держит только текст правил
  (`product-guard.ts:72` закрывает git-запись, ticket CLI, pnpm и npm).
- `docs/features/product-session.md:108–121` описывает отказ («This is not a sandbox»).

## Что делаем

- Запись вне папки Product Session-а — не отказ, а вопрос человеку, как обычный permission prompt Session-а:
  «Product Session wants to write <path>. Allow once / Always allow in <folder> / Deny». Вопрос идёт тем же путём, что
  остальные permission-запросы (`src/main/agent/permissions.ts`), и в любом permission mode, `bypassPermissions` тоже.
- «Always allow in <folder>» сохраняет папку (папку файла, не весь репозиторий) в список «Product Session may also
  write here» в собственных настройках worfy для Project-а (`<папка данных Project-а>/settings.json`,
  `src/main/projects/settings.ts`), не в Profile. Список виден и правится в Settings Project-а: строка на папку,
  кнопка удаления.
- Запись внутрь папки из списка проходит без вопроса.
- Без вопроса, отказом, как сейчас, остаются: `.git` любого репозитория, папка данных worfy, папка Harness
  (`~/.claude/worfy-harness`) и `~/.claude` целиком. Отказ называет причину.
- Сессия без человека (unattended) вопрос задать не может: запись вне папки и вне списка — отказ, как сейчас.
- `harness/hooks/rules/product.md`: файлы вне папки темы пишутся только инструментом Write/Edit — тогда worfy спросит
  человека; через shell (`cp`, `mv`, `>`, `tee`) вне папки — никогда. Правило — текст Harness-а: перед merge платный
  `eval --changed` по правилам `rules-merge.md` (предодобрен до 100 USD, сначала `--dry-run`).
- `docs/features/product-session.md` (и перевод `docs/features/ru/product-session.md`, если страница переведена):
  вопрос, список папок, что остаётся отказом.

## Где в коде

- `src/main/agent/product-guard.ts`
- `src/main/vendors/claude/options.ts`
- `src/main/agent/permissions.ts`
- `src/main/projects/settings.ts`
- `src/renderer/shell/ProjectSettings.tsx`
- `harness/hooks/rules/product.md`
- `docs/features/product-session.md`
- `test/unit/product-guard.test.ts`
- test-ы permission-запросов и настроек Project-а, которые затронет правка (`git grep -l "product-guard\|productGuard\|writeProjectSettings" test/`)
- `test/e2e/product-session.spec.ts`
- `test/e2e/product-write-outside.spec.ts` (e2e test этого ticket-а, вынесен из product-session.spec.ts после review round 1)

## Готово, когда

- [ ] Write вне папки Product Session-а и вне списка показывает вопрос с тремя ответами; «Allow once» пишет файл,
  «Deny» — нет, сессия получает причину отказа. Test на каждый ответ.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/agent-options.test.ts test/contract/permissions.test.ts test/unit/agent-query-factory.test.ts` exit 0 · mac - · 6edfbb4df854177e2fcc5e03549d6e20bcdb33ae
- [ ] «Always allow in <folder>» сохраняет папку; следующая запись в неё идёт без вопроса, в соседнюю папку — с
  вопросом; список виден в Settings Project-а и папку оттуда можно убрать. Test.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/agent-options.test.ts test/unit/product-guard.test.ts test/unit/product-write-folders.test.ts test/unit/project-settings-shell.test.tsx` exit 0 · mac - · 6edfbb4df854177e2fcc5e03549d6e20bcdb33ae
- [ ] `.git`, папка данных worfy, `~/.claude` — отказ без вопроса, и «Always allow» их в список не добавляет. Test.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/product-guard.test.ts test/unit/agent-options.test.ts test/unit/agent-query-factory.test.ts` exit 0 · mac - · 6edfbb4df854177e2fcc5e03549d6e20bcdb33ae
- [ ] Unattended Product Session: вне папки и вне списка — отказ без вопроса. Test.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/agent-options.test.ts test/contract/permissions.test.ts test/unit/agent-query-factory.test.ts` exit 0 · mac - · 6edfbb4df854177e2fcc5e03549d6e20bcdb33ae
- [ ] e2e: fake agent пишет файл вне папки, вопрос показан, «Allow once» — файл записан.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac - · 316a829ca55a8d9f08c1fb4340f3640d199dab0e
- [ ] Правила `product.md` и страница `docs/features/product-session.md` описывают вопрос и запрет shell-записи вне
  папки; `eval --changed` по правилам — с ценой в отчёте.
- [ ] gate fast зелёный; все unit и contract test-ы затронутых модулей зелёные.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6edfbb4df854177e2fcc5e03549d6e20bcdb33ae
