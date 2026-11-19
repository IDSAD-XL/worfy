# 03 — Node Changes, кнопка Changes на карточке Ticket-а и Open changes в Command palette

Type: task
Status: claimed 2026-11-19T18:07Z
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/changes-view.test.tsx test/unit/canvas-actions.test.tsx test/unit/palette-commands.test.tsx` exit 0 · mac - · 36041cfb4fa64e8ded335a8ad6d75919c37d0ed9
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · c7c7e3fac0f318609f47177bd4bde7b4c8feabcc
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · f876a323a3d3f4c453ddf199ce9b6bb1101a324b
- [ ] Unit test (`test/unit/canvas-actions.test.tsx`): Changes есть у Ticket-а с worktree или веткой и нет у Ticket-а
      без них.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/changes-view.test.tsx test/unit/canvas-actions.test.tsx test/unit/palette-commands.test.tsx` exit 0 · mac - · 36041cfb4fa64e8ded335a8ad6d75919c37d0ed9
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/ticket-card.test.tsx test/unit/canvas-actions.test.tsx test/unit/epic-layout.test.ts` exit 0 · mac - · c7c7e3fac0f318609f47177bd4bde7b4c8feabcc
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · f876a323a3d3f4c453ddf199ce9b6bb1101a324b
- [ ] Unit test (`test/unit/palette-commands.test.tsx`): Open changes у Ticket-а с веткой.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/changes-view.test.tsx test/unit/canvas-actions.test.tsx test/unit/palette-commands.test.tsx` exit 0 · mac - · 36041cfb4fa64e8ded335a8ad6d75919c37d0ed9
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · c7c7e3fac0f318609f47177bd4bde7b4c8feabcc
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · f876a323a3d3f4c453ddf199ce9b6bb1101a324b
- [ ] e2e test (`test/e2e/changes.spec.ts`, fake agent, временный репозиторий): карточка → Changes → Node рядом с
      карточкой, файлы и строки совпадают с `git diff <merge-base>`; Open changes из palette; сгенерированный
      репозиторий на 300 файлов и файл на 2 000 строк открывается свёрнутым.
- [ ] Снимок экрана Node-а рядом с Card-ом прототипа — в «Итог» (в scratchpad, в репозиторий не кладётся).
- [ ] Английские страницы `changes.md`, `workflow.md`, `app-shell.md` описывают сделанное;
      `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 36041cfb4fa64e8ded335a8ad6d75919c37d0ed9
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · c7c7e3fac0f318609f47177bd4bde7b4c8feabcc
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 36041cfb4fa64e8ded335a8ad6d75919c37d0ed9
  - evidence: gate pass · `gate fast` exit 0 · mac - · c7c7e3fac0f318609f47177bd4bde7b4c8feabcc
  - evidence: gate pass · `gate fast` exit 0 · mac - · f876a323a3d3f4c453ddf199ce9b6bb1101a324b

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

## Итог

Сделано implementer-ом 2026-11-19, ветка `worfy-changes-view/03`.

- Node `changes` (`src/renderer/canvas/nodes/ChangesNode.tsx`): id `changes:<epic>/<num>`, данные `{ ticket: { epic,
  num }, scope? }`, размер 960×640. Шапка (`ScopeBar.tsx`), дерево с фильтром (`FileTree.tsx`), diff с окном в два
  экрана вокруг видимого (`DiffPane.tsx`, `diff-window.ts`), клавиши `j`/`k`, `n`/`p`. Seam для «+» Ticket-а 05 — prop
  `renderGutter` у `DiffPane`; popover-а нет. Три замечания low к прототипу учтены: числа без разделителя тысяч, нет
  popover-а поверх строк, фильтр видимо сужает дерево и diff («N of M files»).
- Кнопка Changes (`src/renderer/canvas/actions/Changes.tsx`, `order = 33`) и строка Open changes в группе Action
  Command palette; общая логика — в новом файле `src/renderer/changes/open.ts` (вне списка файлов: palette не импортирует
  registry Node-ов, а `.tsx` действия держит только компоненты).
- Отклонение от Ticket-а: новый Node встаёт не через `placeNear` от карточки, а через `freePlace` от `sessionSpot` —
  справа от полосы рамок Epic-ов на высоте Ticket-а, как Session из истории Ticket-а (ADR-0038). `placeNear` с отступом
  40 px вместе с keep-out полосы рамок уводил Node под все рамки (unit test получал `y = 1000` вместо 320). `placeNear`
  остался запасным путём, когда рамки не нарисованы.
- Решено без владельца: кнопка видна у Ticket-а с веткой worktree-а, строкой `Branch:` или в работе — так же, как строка
  palette (worktree из snapshot-а проверок без этих признаков кнопки не даёт, см. следующий пункт). Palette, когда Node-а ещё нет, центрирует карточку и
  оставляет запрос её кнопке; через 2 s без ответа ставит Node справа от всего Canvas. Цвет вида в minimap нейтральный
  (`var(--border-strong)`): новый цвет — только через новый ADR (ADR-0077). На экране только для чтения кнопка и строка
  palette неактивны, пока Node-а нет; scope там хранится локально.
- Вторая строка действий на карточке (раунд по красному CI run 44595751428). Посылка spec-а («Решения по реализации —
  часть 1», «Входы части 1»: место строки действий карточка уже держит, `ticket-card.ts` не меняется) неверна: строка
  действий шириной 218 px, а с кнопкой Changes в CI она занимала 285 px («Resolve conflicts ▾ Open PR Changes»,
  Ticket 08 в `test/e2e/pr-follow-ticket.spec.ts`), 270 px («Address comments Open PR Changes», Ticket 08 в
  `test/e2e/checks-badges.spec.ts`) и 221 px («Ship ticket Open PR Changes», Ticket 10 там же) — кнопки выходили за
  карточку. Теперь строка действий переносится (справа, `.w-ticket__actions` в `src/renderer/canvas/epic-frame.css`), а
  layout даёт +24 px (`ACTIONS_LINE`: 4 px и кнопка 20 px) карточке, на которой Changes видна по самому Ticket-у
  (`showsChanges` в `src/renderer/canvas/ticket-card.ts`, флаг `changes` из `src/renderer/canvas/epic-layout.ts`): в
  работе, со строкой `Branch:` или веткой worktree-а. Остальные карточки своей высоты не меняют. Кнопка видна только на
  карточке с этой строкой. Иконка «±» вместо текста не помогла бы: она экономит ~45 px, а первому случаю нужно 67 px.
  Решено без владельца 2026-11-19, подтвердить.
- Тот же CI run, второй красный: e2e test кнопки искал карточку и кнопку после щелчка, а Canvas к тому времени уже
  центрирован на Node-е, и React Flow не рисует карточку вне экрана (`onlyRenderVisibleElements`). Теперь test сравнивает
  места на Canvas (transform Node-ов React Flow): Node справа от карточки, на её высоте, и весь в окне; второй щелчок —
  после «Go to» карточки из palette, и Node снова в центре; число Node-ов Changes — по сохранённому Layout-у.
- Сначала test: новые unit test-ы не могли пройти до кода — модулей `src/renderer/changes/*` и
  `src/renderer/canvas/actions/Changes.tsx` не было.
- Снимок экрана Node-а рядом с Card-ом прототипа: not verified — снимок даёт только e2e test собранного приложения, а
  e2e test локально не запускается до разрешения владельца; снимки `changes-node-inline`, `changes-node-side-by-side`,
  `changes-node-large` в обеих темах снимает `test/e2e/changes.spec.ts` в gate full.
- e2e test `test/e2e/changes.spec.ts`: not verified локально — запускается в gate full.
- `pnpm test` в среде implementer-а красный вне этого Ticket-а: 19 файлов (contract test-ы Harness, terminal-ai,
  auto-approve, `install-stable-update`, `shell-integration-*`) падают из-за `TMPDIR` Autopilot-а вне `/tmp`; с `TMPDIR` в
  `/tmp` 18 из 19 зелёные, последний (`test/unit/claude-project-mcp.test.ts:82`) падает на `safe.bareRepository=explicit`
  из `GIT_CONFIG_PARAMETERS` среды. Ни один из этих файлов не трогается изменением.
  gate fast на `36041cfb4` с `TMPDIR` в `/tmp` и без `GIT_CONFIG_PARAMETERS` — `[gate] green (fast)`, exit 0; тот же
  gate fast в среде Autopilot-а — exit 2 на тех же 18 файлах.
