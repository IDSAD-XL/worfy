# 07 — ⌘Z отменяет только свои правки

Type: task
Status: claimed — 2026-10-08
Blocked by: 03
Source: решения владельца 2026-10-07: Q15 (⌘Z — только свои правки; если тот же Node после шага правил другой экран, шаг пропускается с подсказкой); [spec.md](../spec.md); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — несколько экранов на одном Project-е; [ADR-0016](../../../docs/adr/0016-trash-folder-per-entry-undo-in-renderer.md) — корзина как папка, undo в renderer

## Что происходит

- История ⌘Z живёт в renderer: своя у каждого окна и Project-а, 40 шагов (`HISTORY_DEPTH`,
  `src/renderer/canvas/history.ts:25`; `History` — `:41`, `historyOf` — `:122-129`). Она уже «своя
  у экрана».
- Шаг откатывается обратной операцией, посчитанной по локальной копии Layout перед отправкой
  (`applyRecorded`, `:318`; `inverseOf`, `:152-188`). Значения в ней абсолютные: обратный `move` —
  это старые `x` и `y`. Если после шага тот же Node двигал другой экран, ⌘Z вернёт Node туда, где он
  был до шага, и молча сотрёт чужую правку.
- Шаг, чью обратную операцию main отклонил (Node исчез), выбрасывается без подсказки, только
  `console.error` (`:74-79`, `:107-110`).
- Записываются только жесты пользователя на Canvas: `LayoutOps` Canvas-а
  (`src/renderer/canvas/Canvas.tsx:223-245`) и удаление в корзину (`trashRecorded`,
  `history.ts:352`). Автоматические писатели renderer-а шлют без шага, и работают они в каждом
  окне: синхронизация Session Node-ов (`src/renderer/canvas/overlays/SessionNodes.tsx:115-118`),
  рамки Epic-ов (`src/renderer/canvas/sources/epics.ts:166`),
  `src/renderer/canvas/overlays/BindingDrop.tsx:139`,
  `src/renderer/shell/sidebar/SessionsSection.tsx:107`, `src/renderer/palette/commands.ts:72`,
  `src/renderer/session/HistoryPopover.tsx:148-153`.
- Main пишет Layout и сам: Session-ы Node-ов и Orchestrator (`src/main/agent/node-sessions.ts:94`,
  `src/main/agent/orchestrator.ts:533`), MCP-инструменты агентов
  (`src/main/mcp/canvas-server.ts:125`), Node HANDOFF (`src/main/ipc/docs.ts:30-41`), корзина
  (`src/main/layout/trash.ts:157`, `:196`).
- `layout.changed` несёт только `projectId`, `layout` и `revision` (`src/shared/ipc/layout.ts:18`,
  схема — `src/shared/layout/types.ts:132-137`). Операция у main есть (`LayoutChange.op`,
  `src/main/layout/store.ts:29-32`), но в рассылку не попадает (`src/main/ipc/layout.ts:10-14`).
- Кто прислал правку, main не знает: `layout.apply` — `{projectId, op}`
  (`src/shared/ipc/layout.ts:15`), `trash.put` — `{projectId, nodeId}`
  (`src/shared/ipc/trash.ts:52`), `trash.restore` — `{projectId, label}` (`:55`).
- ⌘Z и ⇧⌘Z — `src/renderer/canvas/overlays/SelectionToolbar.tsx:54-57`. Общей всплывающей
  подсказки в renderer нет. Overlay-и Canvas находятся сами по файлам папки overlays
  (`src/renderer/canvas/extensions.ts:84`).
- Ticket 03 переводит рассылку `layout.changed` на реестр клиентов и даёт helper второго окна в
  e2e.

## Что делаем

1. **Id экрана.** Renderer при загрузке делает свой id (`crypto.randomUUID()`) в новом модуле
   `src/renderer/canvas/screen.ts`. Почему не id клиента из реестра Ticket-а 03: реестр различает
   соединения, а все окна Linked machine-а приходят на машину Project-а одним соединением
   (Ticket 09). Id в данных вызова проходит через любую пересылку.
2. **Автор правки.** `layout.apply`, `trash.put` и `trash.restore` принимают необязательный
   `screen`. Его шлют только записываемые жесты и их undo/redo: канал `send` Canvas-а
   (`Canvas.tsx:224-236`) и `ipcTrash` (`history.ts:343-346`). Автоматические писатели и main шлют
   без него. `store.apply` кладёт автора в `LayoutChange`; `layout.changed` несёт `screen` (или
   `null`) и операцию.
3. **Пересечение.** Шаг помнит Node-ы, которые меняет, сторону правки и ревизию Layout после себя.
   Ответ `layout.apply` ревизию уже несёт; для корзины — добавить её в ответ или взять из своего
   `layout.changed`. Стороны правки:
   - место и размер — `move`, `moveMany`, `resize`, `pin`;
   - видимость — `hide`;
   - данные — `patchData` с теми же ключами;
   - теги — `tag`;
   - существование — `create`, `remove`, корзина. Удаление Node-а пересекается с любой стороной.
   `layout.changed` с чужим `screen`, большей ревизией и пересечением по Node-у и стороне помечает
   шаг устаревшим. Правки без `screen` (main, агенты, автоматические писатели) шаг не трогают — как
   сейчас.
4. **⌘Z на устаревшем шаге** (Q15). Шаг выбрасывается, обратная операция не уходит. На Canvas —
   подсказка «Not undone: this Node was changed on another screen» (`role="status"`,
   `data-testid="undo-skipped"`, около 4 s). Нажатие делает только это; следующее отменяет
   предыдущий шаг. Шаг жеста с несколькими Node-ами (`moveMany`, удаление выделения) выбрасывается
   целиком, если устарела хоть одна его часть. ⇧⌘Z — то же для отменённых шагов. Свои шаги без
   чужих правок — как раньше.
   Это толкование Q15 («шаг пропускается с подсказкой»): нажатие не отменяет следующий шаг само.
   Записать в «Итог» как решённое без владельца, подтвердить при ревью.
5. **Подсказка** — overlay `src/renderer/canvas/overlays/UndoSkipped.tsx`; состояние подсказки —
   в `history.ts`.

**Не входит:** проверка базовой ревизии в `apply` Layout (`src/main/layout/store.ts:195-200`,
побеждает последний — так и остаётся); устройство корзины (ADR-0016) — меняется только автор её
правок; защита от правок агентов и main.

## Готово, когда

- [ ] Unit `test/unit/history.test.ts`: шаг `move` Node-а N; `layout.changed` чужого экрана с большей ревизией двигает N — `undo()` ничего не шлёт, отвечает «пропущено», подсказка поднята; следующий `undo()` отменяет предыдущий шаг.
- [ ] Unit: чужая правка тегов N не трогает шаг `move` — он отменяется; правка N без `screen` (main, агент) — шаг отменяется, как сейчас; правка N своим экраном — тоже.
- [ ] Unit: шаг `moveMany` трёх Node-ов, чужой экран сдвинул один — шаг выброшен целиком, ни один Node не сдвинут; чужое удаление N делает устаревшим любой шаг N; то же для `redo()`.
- [ ] Contract `test/contract/layout-store.test.ts`: `apply` со `screen` кладёт его в `LayoutChange`, без него — `null`; `layout.changed` несёт `screen` и операцию; `trash.put` и `trash.restore` со `screen` дают `layout.changed` с ним.
- [ ] e2e `test/e2e/trash-undo.spec.ts`, два окна одного worfy (helper Ticket-а 03): окно A двигает Note n1, окно B двигает n1; ⌘Z в A — n1 там, куда его поставил B, в A видна подсказка `undo-skipped`; ⌘Z в B — n1 там, куда его поставил A. На нынешнем main ⌘Z в A возвращает n1 на исходное место — test красный.
- [ ] Тот же e2e: A двигает n2, B двигает n1; ⌘Z в A отменяет ход n2 без подсказки.
- [ ] Одно окно — как раньше: `test/e2e/trash-undo.spec.ts`, `test/e2e/epic-frame-undo.spec.ts` и прежние проверки `test/unit/history.test.ts` зелёные без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально (команда — `rules.md` Profile-а worfy) — exit 0 (e2e идут в нём).

## Тесты

Сначала падающий unit в `test/unit/history.test.ts`: `History` и `applyRecorded` уже тестируются
там с поддельным каналом. Событие чужого экрана в unit — вызов того же обработчика
`layout.changed`, который подписывает renderer (`src/renderer/canvas/useLayout.ts:28-36`).

В e2e Note двигать мышью, а не через `invoke`: шаг истории пишут только жесты Canvas-а. В «Итог» —
как падал первый test.

## Где в коде

- `src/renderer/canvas/history.ts`
- `src/renderer/canvas/screen.ts` (новый)
- `src/renderer/canvas/useLayout.ts`
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/canvas/overlays/UndoSkipped.tsx` (новый)
- `src/shared/ipc/layout.ts`
- `src/shared/ipc/trash.ts`
- `src/main/layout/store.ts`
- `src/main/ipc/layout.ts`
- `src/main/layout/trash.ts`
- `src/main/ipc/trash.ts`
- `test/unit/history.test.ts`
- `test/contract/layout-store.test.ts`
- `test/e2e/trash-undo.spec.ts`

С Ticket-ом 06 общие файлы history.ts, store.ts, Canvas.tsx и test-ы истории и Layout: в одной Wave
Ticket-ы идут по очереди. Если Ticket 08 уже влит, новое поле screen в каналах layout и trash
пометки не меняет: это каналы Project-а.

## Итог

- **Id экрана** — `src/renderer/canvas/screen.ts` (`crypto.randomUUID()` при загрузке renderer-а).
  Его шлют только канал `send` Canvas-а (`sendLayoutOp` в `useLayout.ts`) и `ipcTrash`
  (`history.ts`); автоматические писатели, main и агенты — без него.
- **Каналы.** `layout.apply`, `trash.put`, `trash.restore` принимают необязательный `screen`
  (`screenIdSchema`, 1–100 символов). `LayoutStore.apply(projectId, op, screen = null)` кладёт его в
  `LayoutChange`; `layout.changed` несёт `screen` (или `null`) и операцию (`layoutChangeSchema`).
  Корзина передаёт `screen` в свою правку Layout.
- **Ревизия шага.** Ответ `layout.apply` даёт ревизию: тип `Send` теперь отвечает
  `string | { revision } | undefined` (старые поддельные каналы test-ов, отвечающие `undefined`,
  подходят). Для корзины ответ не менялся (contract `trash.test.ts` проверяет ключи ответа):
  ревизия берётся из своего `layout.changed` — main рассылает его до ответа.
- **Устаревание** (`history.ts`): у каждой части шага — отметка (Node-ы, стороны, ревизия).
  `layout.changed` с чужим `screen`, большей ревизией и пересечением помечает её. Последние 200
  правок с `screen` хранятся, чтобы чужая правка, пришедшая раньше ответа main на свой шаг, тоже
  учлась. Удаление и создание Node-а пересекаются с любой стороной. Шаг жеста устаревает целиком.
  Отметки шагов, ушедших из истории, снимаются.
- **⌘Z / ⇧⌘Z на устаревшем шаге** — `undo()`/`redo()` отвечают `'skipped'`, ничего не шлют, шаг
  выброшен; подсказка `UndoSkipped.tsx` (`role="status"`, `data-testid="undo-skipped"`, вверху по
  центру Canvas-а, 4 s — `SKIPPED_NOTICE_MS`). Снимки:
  [светлая](../evidence/07-undo-skipped-light.png), [тёмная](../evidence/07-undo-skipped-dark.png).
- **Как падал первый test.** Unit `test/unit/history.test.ts` сначала падал на отсутствии модуля
  `screen.ts`. После реализации каждая проверка подтверждена мутантом: без проверки устаревания
  в `History.run` падают 9 новых unit-test-ов, без досчёта ранних правок — test гонки, с
  пересечением по любой стороне — test тегов, со своими правками как чужими — 3 test-а. e2e
  `trash-undo.spec.ts` «⌘Z with two windows» на сборке без проверки устаревания красный: в окне A
  нет подсказки `undo-skipped` (на origin/main её нет вовсе).
- **Вне следа:** одна строка в `tsconfig.test.node.json` — `screen.ts` в списке файлов: его
  импортирует `history.ts`, а этот проект перечисляет файлы renderer-а поимённо (иначе TS6307).

Решено без владельца, подтвердить:
- Толкование Q15: нажатие ⌘Z на устаревшем шаге только выбрасывает его и показывает подсказку;
  следующее нажатие отменяет предыдущий шаг.
- Текст для ⇧⌘Z — «Not redone: this Node was changed on another screen» (для ⌘Z — как в тикете).
- Подсказка вверху по центру Canvas-а (низ занят кнопкой Trash), стили — токены `tokens.css`
  инлайном: отдельного CSS-файла в следе нет.
- Шаг корзины считает своей ревизию из своего `layout.changed`, а не из ответа `trash.put`.
