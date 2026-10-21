# 20 — Без semantic zoom: каждый Node целиком на любом zoom

Type: task
Status: claimed 2026-10-21T11:41Z
Branch: worfy-canvas/20
Blocked by: —
Source: решение владельца 2026-10-21 (цитата ниже); отменяет semantic zoom Ticket-а
[06](06-semantic-zoom.md) (PR [#668](https://github.com/IDSAD-XL/worfy/pull/668), squash `306bf09e`).
Код перечитан по main `cd77f454`.

## Что происходит

Владелец, 2026-10-21, дословно:

> я заметил что ты добавил переход при зуме, т.е своего рода лоады когда отдаляешься от карточек, то
> текст в них пропадает и включается второй режим. давай отключим эту фичу, с ней ux получился хуже

Ticket 06 ввёл три уровня вида Node-а по zoom: `full` (≥ 0.6) — Node как есть; `compact` (0.3–0.6) —
только шапка, тело скрыто; `far` (< 0.3) — блок цвета типа с крупным заголовком, шапка рамки Epic-а
постоянного экранного размера, Ticket-ы без текста. Уровень — атрибут `data-zoom-level` корня React Flow
(`src/renderer/canvas/overlays/ZoomLevel.tsx`, `src/renderer/canvas/zoom-level.ts`), вид — CSS в
`node-chrome.css` и `epic-frame.css`. Card с #668 запускает страницу только на `full`.

## Что делаем

1. **Механизм уровней убрать целиком**, без флага: `zoom-level.ts`, `overlays/ZoomLevel.tsx`, CSS
   уровней в `node-chrome.css` и `epic-frame.css`, цвета far-блока в `kind-icons.tsx`, пометка
   заголовка `NODE_TITLE`, test-ы уровней (`test/unit/zoom-level.test.tsx`,
   `test/e2e/semantic-zoom.spec.ts`).
2. **Шапка рамки Epic-а на far** — часть переключения режима (она прятала тег, подзаголовок, действия,
   подписи колонок и текст Ticket-ов), поэтому уходит вместе с ним.
3. **Card** — снова порог `LIVE_ZOOM_MIN = 0.4`, как до #668 (Ticket `worfy-mvp` 25): ниже него — заголовок
   и рамка без iframe. Закреплённая Card и Card в focus tile запускают страницу на любом zoom.
4. **Пометка шапки `NODE_HEADER` (`data-node-header`) остаётся**: по ней toast-ы обходят шапку Node-а в
   focus tile (`src/renderer/toast/ToastRegion.tsx`, `worfy-ui` 16). Она переезжает в
   `src/renderer/canvas/node-header.ts`.
5. **e2e, которые #668 перевёл на zoom 0.6** (card-drag, card-runtime, linked-machines, linked-read-only,
   session-back, subagent-tree, terminal, wheel-over-nodes), — снова на прежних значениях.
6. **Документы**: F-SPEC — раздел «Zoom levels» заменить правилом «Node на любом zoom целиком»; Ticket 06 —
   отметка об отключении; ADR-0077 — поправка с датой.

## Готово, когда

- [x] Unit: на zoom 0.2 корень React Flow без атрибута уровня и без `--w-zoom`; CSS Canvas ничего не
      прячет по zoom; Card запускает страницу от 0.4, ниже — заглушка, кроме закреплённой и в focus tile.
- [x] e2e: на zoom 0.45 и на нижнем 0.2 видны тело Note, экран Terminal, заголовок и строка meta Ticket-а,
      подпись колонки рамки Epic-а; размер экрана Terminal не меняется; Node масштабируется только
      transform-ом Canvas.
- [x] Мутант красный: вернуть переключение «только шапка» ниже какого-нибудь zoom.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; e2e, которые трогал #668, — зелёные.

## Тесты

- Сначала падающий: e2e `test/e2e/zoom-whole-nodes.spec.ts` (заголовок Ticket-а на zoom 0.2) и unit
  `test/unit/canvas-zoom.test.tsx` (Card на 0.5, корень без уровня).

## Где в коде

- `src/renderer/canvas/zoom-level.ts` (удалить), `src/renderer/canvas/overlays/ZoomLevel.tsx` (удалить)
- `src/renderer/canvas/node-header.ts` (новый)
- `src/renderer/canvas/node-chrome.css`, `src/renderer/canvas/epic-frame.css`, `src/renderer/canvas/kind-icons.tsx`
- `src/renderer/canvas/NodeChrome.tsx`, `src/renderer/canvas/ReadOnlyTerminal.tsx`
- `src/renderer/canvas/nodes/` (CardNode, EpicFrameNode, HandoffNode, NoteNode, OrchestratorNode,
  SessionNode, SubagentNode, TerminalNode, TicketNode)
- `src/renderer/theme/tokens.css` (комментарий к `kind-*`)
- `test/unit/zoom-level.test.tsx` (удалить), `test/unit/canvas-zoom.test.tsx` (новый)
- `test/e2e/semantic-zoom.spec.ts` (удалить), `test/e2e/zoom-whole-nodes.spec.ts` (новый)
- `test/e2e/card-drag.spec.ts`, `card-runtime.spec.ts`, `linked-machines.spec.ts`, `linked-read-only.spec.ts`,
  `session-back.spec.ts`, `subagent-tree.spec.ts`, `terminal.spec.ts`, `wheel-over-nodes.spec.ts`
- `docs/design/F-SPEC.md`, `docs/adr/0077-node-kind-tokens.md`, `.scratch/worfy-canvas/issues/06-semantic-zoom.md`

## Вне скоупа

- Другой способ сделать дальний zoom читаемым (например, крупнее шрифт рамки Epic-а без смены режима) —
  только новым решением владельца.

## Итог

Сделано по «Что делаем».

- **Удалено целиком:** `zoom-level.ts`, `overlays/ZoomLevel.tsx`, CSS уровней `compact` и `far` в
  `node-chrome.css`, раздел far в `epic-frame.css`, цвета far-блока и класс `w-kind-band` в
  `kind-icons.tsx`, пометка `NODE_TITLE`, снятие фокуса со скрытого поля при смене уровня,
  `test/unit/zoom-level.test.tsx`. `test/e2e/semantic-zoom.spec.ts` переименован в
  `test/e2e/zoom-whole-nodes.spec.ts` и переписан: тот же Canvas (Node-ы всех типов, три рамки Epic-а,
  Session с Subagent-ом, Terminal, Card) на 0.6, около 0.5 и на нижнем 0.2 — тело Note, экран Terminal,
  статусы, текст HANDOFF, заголовок и строка meta Ticket-а, подпись колонки, тег и прогресс Epic-а видны;
  размер экрана Terminal тот же; Node меняет экранный размер ровно в отношении zoom.
- **Шапка рамки Epic-а на far удалена:** она была частью переключения режима — включалась атрибутом
  уровня, прятала тег, подзаголовок, действия, подписи колонок и весь текст Ticket-ов, поднимала рамку
  над Ticket-ами. Вместе с ней ушёл `shortcut:` о короткой рамке (пункт Ticket-а 19).
- **Оставлено из #668:** пометка шапки `NODE_HEADER` (`data-node-header`) — по ней toast-ы обходят шапку
  Node-а в focus tile (`src/renderer/toast/ToastRegion.tsx`, `KEEP_OUT`, `worfy-ui` 16); она переехала в
  `src/renderer/canvas/node-header.ts`, unit test перечисляет типы без неё. Card в focus tile и
  закреплённая Card запускают страницу на любом zoom; длинный заголовок Card — в одну строку с «…»,
  целиком в tooltip.
- **Card:** снова порог `LIVE_ZOOM_MIN = 0.4`, как до #668 (Ticket `worfy-mvp` 25); ниже — заголовок в
  рамке. Это не режим уровня: так было до semantic zoom, и владелец о нём не говорил.
- **e2e, которые #668 перевёл на 0.6,** вернулись к прежним значениям (0.5, 0.45, 0.3 у card-runtime,
  положение Terminal в linked-machines, направление ⌘ + wheel в wheel-over-nodes).
- **Документы:** F-SPEC — раздел «Zoom» вместо «Zoom levels», без «far-zoom block» у цветов типа;
  Ticket 06 — отметка об отключении; ADR-0077 — раздел «Amendments» с датой.
- **Мутанты (красные):** overlay, который ниже 0.55 оставляет у Node-а одну шапку (e2e: «noteText at
  zoom 0.50»); правило `[data-zoom-level='far']` в `epic-frame.css` (unit, CSS); `LIVE_ZOOM_MIN = 0.6`
  (unit, Card на 0.5 и 0.4); Note без `NODE_HEADER` (unit, перечень пометок).
