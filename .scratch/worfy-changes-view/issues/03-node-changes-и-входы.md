# 03 — Node Changes, кнопка Changes на карточке Ticket-а и Open changes в Command palette

Type: task
Status: open
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Решение» → «Экран»; «Решения по реализации — часть 1»: «Node `changes`»,
«Focus mode», «Входы части 1», «Kit», «Цвета без подсветки синтаксиса», «Предел размера»; «Решения по test-ам — часть
1», seam 3; «Решено без владельца», 1–4

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium`; снимок экрана Node-а в «Итог».

## Что происходит

- Node-ы — по файлу на вид, registry находит их сам (`src/renderer/canvas/nodes/index.ts:1-13`). Данные Node-а —
  свободный JSON Layout-а (`nodeDataSchema`, `src/shared/layout/types.ts:29`).
- Действия на карточке Ticket-а — слот `src/renderer/canvas/actions/<Name>.tsx` (`src/renderer/canvas/badges/index.ts:5-7`,
  `:44`); образец — `src/renderer/canvas/actions/OpenPr.tsx`. Место строки действий карточка уже держит
  (`SLOTS_HEIGHT`, `src/renderer/canvas/ticket-card.ts:51-56`).
- Место нового Node-а рядом с другим — `placeNear` (`src/shared/canvas/tools.ts:178`).
- Command palette: группы — `src/renderer/palette/commands.ts:94`, контекст с `readOnly` — `:120-130`, сборка — `:770`.
- Плитка focus mode рисует компонент Node-а (`src/renderer/focus/FocusMode.tsx:12-13`); focus mode с выделения
  открывается с preset-ом Even (`docs/features/focus-mode.md:17`).
- Kit: `src/renderer/theme/kit/ToggleGroup.tsx`, `Menu.tsx`, `Tooltip.tsx` (ADR-0106). Цвета строк — `--ready-*` и
  `--blocked-*`, как `src/renderer/harness/MigrationForm.tsx:91-92`.
- Каналы чтения — Ticket 02 (`src/shared/ipc/changes.ts`). Образец вида — Card Ticket-а 01 (id — в его «Итог»).

## Что делаем

1. `src/renderer/canvas/nodes/ChangesNode.tsx` — `kind = 'changes'`; данные — предмет `{ ticket: epic, NN }` и scope.
   Один Node на предмет: повторный щелчок ведёт к открытому.
2. `src/renderer/changes/ScopeBar.tsx` — шапка: меню scope-ов из `changes.scopes`, Compare against, база ← head, число
   файлов, `+/−`, Refresh; Inline | Side by side, Wrap, Hide whitespace.
3. `src/renderer/changes/FileTree.tsx` — дерево с фильтром, статусом A, M, D, R и `+N −M`; репозитории — верхний
   уровень у Ticket-а в нескольких репозиториях; группа Workflow files в конце, свёрнута; больше 300 файлов — папки
   свёрнуты.
4. `src/renderer/changes/DiffPane.tsx` и `src/renderer/changes/diff-window.ts` — hunk-и файла по `changes.file`, Inline и
   Side by side, свёрнутые большие, lock- и binary-файлы («Large diff · N lines · Show», «Binary file · 12 KB → 14 KB»).
   В DOM — только hunk-и на экране и по два экрана вокруг, без новой библиотеки. Клавиши `j`/`k` (файлы), `n`/`p`
   (hunk-и). Gutter «+» и лоток — Ticket 05.
5. `src/renderer/canvas/actions/Changes.tsx` — кнопка Changes на Ticket-е с worktree или веткой, без счётчика; ставит
   Node рядом с карточкой (`placeNear`) или ведёт к открытому.
6. `src/renderer/palette/commands.ts` — Open changes в группе Action для Ticket-а с worktree или веткой.
7. Английские страницы: `docs/features/changes.md` — экран, scope-ы, клавиши, входы; `docs/features/workflow.md` —
   строка Changes в таблице действий Ticket-а (`:103-105`); `docs/features/app-shell.md` — Open changes в разделе
   Command palette (`:125`). Переводы — Ticket 06.

## Готово, когда

- [ ] Unit test (`test/unit/changes-view.test.tsx`): Inline и Side by side, Wrap, Hide whitespace, свёрнутый большой и
      binary-файл, группа Workflow files, меню scope-ов строится из ответа `changes.scopes`.
- [ ] Unit test (`test/unit/canvas-actions.test.tsx`): Changes есть у Ticket-а с worktree или веткой и нет у Ticket-а
      без них.
- [ ] Unit test (`test/unit/palette-commands.test.tsx`): Open changes у Ticket-а с веткой.
- [ ] e2e test (`test/e2e/changes.spec.ts`, fake agent, временный репозиторий): карточка → Changes → Node рядом с
      карточкой, файлы и строки совпадают с `git diff <merge-base>`; Open changes из palette; сгенерированный
      репозиторий на 300 файлов и файл на 2 000 строк открывается свёрнутым.
- [ ] Снимок экрана Node-а рядом с Card-ом прототипа — в «Итог» (в scratchpad, в репозиторий не кладётся).
- [ ] Английские страницы `changes.md`, `workflow.md`, `app-shell.md` описывают сделанное;
      `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/canvas/nodes/ChangesNode.tsx` (новый)
- `src/renderer/changes/ScopeBar.tsx`, `src/renderer/changes/FileTree.tsx`, `src/renderer/changes/DiffPane.tsx`,
  `src/renderer/changes/diff-window.ts`, `src/renderer/changes/changes.css` (новые)
- `src/renderer/canvas/actions/Changes.tsx` (новый, по образцу `src/renderer/canvas/actions/OpenPr.tsx`)
- `src/renderer/palette/commands.ts:94`, `:770`
- `test/unit/changes-view.test.tsx` (новый), `test/unit/canvas-actions.test.tsx`, `test/unit/palette-commands.test.tsx`,
  `test/e2e/changes.spec.ts` (новый)
- `docs/features/changes.md`, `docs/features/workflow.md:103-105`, `docs/features/app-shell.md:125`

Только читать: `src/shared/ipc/changes.ts` и `src/shared/changes/types.ts` (Ticket 02), `src/shared/canvas/tools.ts:178`,
`src/renderer/canvas/ticket-card.ts:51-56`, `src/renderer/focus/FocusMode.tsx`.

## Вне скоупа

- Gutter «+», popover, лоток, «To», Send — Ticket 05. Chip со счётчиком `+N −M`, badge Node-а Session, блок rail,
  preset Main + side, Viewed, Mark seen, живое обновление — часть 2.
