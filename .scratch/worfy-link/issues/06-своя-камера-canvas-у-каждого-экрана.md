# 06 — Камера Canvas своя у каждого экрана: viewport уходит из общего Layout

Type: task
Status: open
Blocked by: —
Source: решения владельца 2026-10-07: Q2 (общее состояние живое, у каждого экрана своё — камера, выделение, ⌘Z), Q15 (камера Canvas своя у каждого экрана на каждый Project и уходит из общего Layout); [spec.md](../spec.md); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — несколько экранов на одном Project-е; [ADR-0013](../../../docs/adr/0013-pinned-node-screen-coordinates.md) — закреплённый Node хранит экранные координаты

## Что происходит

- Viewport — камера Canvas: сдвиг `x`, `y` и `zoom`. Сейчас он часть Layout: `viewportSchema`
  (`src/shared/layout/types.ts:60-67`), поле `viewport` в `layoutSchema` (`:73`), операция
  `setViewport` (`:102`). Лежит в `layout.json` Project-а.
- Renderer шлёт `setViewport` в конце каждого pan и zoom (`onMoveEnd`,
  `src/renderer/canvas/Canvas.tsx:397-404`). В историю ⌘Z он не попадает
  (`src/renderer/canvas/history.ts:153`).
- Main применяет его как любую операцию Layout (`src/main/layout/store.ts:87`): ревизия растёт
  (`:200`), весь Layout уходит событием `layout.changed` во все окна
  (`src/main/ipc/layout.ts:10-14`). Каждый pan — рассылка всего Layout всем экранам.
- React Flow берёт камеру из Layout только при монтировании Canvas:
  `defaultViewport={state.layout.viewport}` (`Canvas.tsx:503`). Canvas монтируется заново при
  смене Project-а (`key={projectId}`, `Canvas.tsx:555`). Других мест, где renderer ставит камеру из
  Layout, нет. Отсюда [вывод из кода, с двумя окнами не запускали]: живые камеры двух окон уже
  независимы, общая у них — сохранённая камера. Окно, открытое или перезагруженное, встаёт туда,
  где Canvas сдвинули последним в любом окне. Экран Linked machine-а (Ticket 09) писал бы свою
  камеру в Layout машины Project-а и перетирал сохранённую камеру её экранов.
- Закреплённый Node хранит `x`, `y`, `w`, `h` в пикселях экрана (`types.ts:48-54`). Каждый экран
  ставит его по своей камере и своему размеру Canvas (`placePinned`,
  `src/renderer/canvas/pinning.ts:141`); на меньшем экране сдвигает внутрь (`pinnedScreenPoint`,
  `:106-108`). Закрепление пересчитывает по камере экрана, где закрепили (`pinOp`, `:111-116`).
- В main камеру читает и пишет только `applyOp`. MCP-инструменты Canvas для агентов `setViewport`
  не шлют (`src/main/mcp/canvas-server.ts:124-125`).
- Test-ы, которые читают сохранённую камеру из Layout: e2e `test/e2e/canvas-layout.spec.ts:280-300`,
  `test/e2e/card-drag.spec.ts:180`, `:196`, `:227-229`; contract
  `test/contract/layout-store.test.ts:164-165`, `:238`, `:434-441`; unit
  `test/unit/history.test.ts:152`. Многие e2e кладут `viewport` в `layout.json` до старта
  (например `test/e2e/wheel-over-nodes.spec.ts:76`, `test/e2e/focus.spec.ts:44`) — им нужна прежняя
  камера при первом открытии.
- Второе окно в e2e открыть нечем. `second-instance` и `activate` открывают окно, только когда окон
  нет (`src/main/index.ts:53-62`, `:93-94`); в меню нет «New Window» (`src/main/menu.ts:11-34`).
  Тот же helper нужен Ticket-у 03.

## Что делаем

1. **Своя камера экрана** (Q15, Q2). Новый store в main, `src/main/layout/viewports.ts`, держит
   файл `viewports.json` в папке данных worfy (`dataRoot()`, `src/main/storage/paths.ts:30`):
   `{ [projectId]: Viewport }`. Запись — после паузы, как у Layout (`LAYOUT_SAVE_DELAY_MS`,
   `store.ts:25`), и при выходе из приложения. Project ушёл из списка — его запись удаляется.
   Камера хранится на машине экрана, а не на машине Project-а. Ключ сейчас — `projectId`. Ticket 09
   расширит его до пары Machine + projectId для Project-ов Linked machine-ов.
2. **Новый домен IPC** `viewport`: `src/shared/ipc/viewport.ts` и `src/main/ipc/viewport.ts`
   (ADR-0006 — канал объявляется в своём доменном файле, main находит handler сам):
   - `viewport.get {projectId} → Viewport`: своя камера; если её нет — `layout.viewport` из Layout
     Project-а. Первое открытие после обновления встаёт туда же, где был Canvas;
   - `viewport.set {projectId, viewport} → void`;
   - события нет: другим экранам чужая камера не нужна.
   Оба канала — состояние машины экрана: Linked machine-у они не отдаются. Если Ticket 08 уже влит,
   пометка ставится при объявлении канала; иначе их помечает Ticket 08.
3. **Renderer.** Canvas монтирует React Flow, когда пришли и Layout, и ответ `viewport.get`;
   `defaultViewport` — этот ответ. `onMoveEnd` шлёт `viewport.set` и сравнивает со своей последней
   камерой, а не с Layout.
4. **Layout без камеры.** Операция `setViewport` уходит из `layoutOpSchema`, из `applyOp` и из
   `inverseOf`. Поле `viewport` в `layoutSchema` остаётся для чтения: это запасная камера для
   первого открытия. worfy его больше не меняет, в `layout.json` остаётся прежнее значение. Pan не
   двигает ревизию Layout и не рассылает `layout.changed`.
5. **Что считать экраном для двух окон одной машины** — решение этого Ticket-а: Q15 этот случай не
   разбирает, а ADR-0053 называет экраном окно worfy. Живая камера своя у каждого окна (так уже
   есть). Сохранённая — одна на Machine и Project: её пишет окно, где Canvas сдвинули последним;
   новое окно и перезагрузка встают туда.
   Причина: у окна нет постоянного id между запусками, запись на каждое окно копилась бы без
   хозяина. Если исполнитель решит иначе — причина в «Итог».
6. **Закреплённые Node-ы — проверить, не менять** (ADR-0013). ADR-0053 оставил правило для них этому
   Ticket-у; правило — как сейчас. На каждом экране закреплённый Node стоит в тех же пикселях от
   угла Canvas; на меньшем экране он сдвинут внутрь, за край не уходит; pan одного окна не двигает
   его ни в одном окне.
   Что делать с камерой, уже записанной в `layout.json` (ADR-0053 тоже оставил это Ticket-у камеры):
   она остаётся запасной камерой для первого открытия, пункт 4.
7. **Helper второго окна** в `test/e2e/helpers.ts` — если Ticket 03 ещё не влит; иначе берётся его
   helper. Способ не проверен: `app.evaluate` создаёт `BrowserWindow` с `webPreferences` первого
   окна (`webContents.getLastWebPreferences()`) и грузит его URL. Если preload так не встаёт —
   вопрос владельцу о пункте меню «New Window» до правки меню.

**Не входит:** выделение, Minimap, поиск по Canvas — они уже только в renderer, свои у каждого
окна; активный Project (общий для окон одной машины, `projects.select`) — его для экранов
Linked machine-ов решает Ticket 09.

## Готово, когда

- [ ] Contract `test/contract/viewport-store.test.ts` (новый): `viewport.get` для Project-а без своей камеры отвечает `viewport` из `layout.json`; после `viewport.set` — заданной камерой; `viewports.json` пишется после паузы и при flush; Project удалён из списка — его записи нет; `zoom` вне 0.2–2.5 отклонён.
- [ ] Contract `test/contract/layout-store.test.ts`: `setViewport` отклонён как неверная операция; `layout.json` с `viewport` читается, после другой операции `viewport` в файле прежний. Проверки `:164-165` и `:434-441` переписаны на это.
- [ ] e2e `test/e2e/canvas-layout.spec.ts`, два окна разного размера (1600×1000 и 1000×700): pan в окне 1 не меняет transform `.react-flow__viewport` окна 2 и не меняет ревизию Layout (`layout.get`); `viewports.json` держит камеру окна 1, `viewport` в `layout.json` прежний. На нынешнем main ревизия растёт и `layout.json` меняется — test красный.
- [ ] e2e: перезагрузка окна 2 после pan в окне 1 открывает Canvas в камере окна 1 (одна сохранённая камера на Machine и Project, пункт 5).
- [ ] Project без `viewports.json` открывается в камере из `layout.json`: e2e, которые кладут `viewport` в `layout.json`, зелёные без правки (`test/e2e/wheel-over-nodes.spec.ts`, `test/e2e/focus.spec.ts`, `test/e2e/card-runtime.spec.ts`).
- [ ] e2e: Node, закреплённый у правого края окна 1, виден целиком в меньшем окне 2; pan окна 1 не сдвигает его ни в одном окне (`getBoundingClientRect` до и после).
- [ ] Проверки камеры в `test/e2e/canvas-layout.spec.ts:280-300` и `test/e2e/card-drag.spec.ts:180`, `:196`, `:227-229` читают `viewport.get` или `viewports.json` вместо Layout и зелёные.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально (команда — `rules.md` Profile-а worfy) — exit 0 (e2e идут в нём).

## Тесты

Сначала падающий e2e «pan в окне 1 не меняет Layout»: на нынешнем main `setViewport` двигает
ревизию. Ревизию читать через `invoke('layout.get')` в окне, как `layoutOf` в
`canvas-layout.spec.ts`.

Contract нового store — по образцу `test/contract/layout-store.test.ts`: запись через recorder
(`LayoutStoreOptions.write`, `store.ts:34-38`), пауза — через `delayMs`. В «Итог» — как падал первый
test.

## Где в коде

- `src/shared/layout/types.ts`
- `src/main/layout/store.ts`
- `src/main/layout/viewports.ts` (новый)
- `src/shared/ipc/viewport.ts` (новый)
- `src/main/ipc/viewport.ts` (новый)
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/canvas/history.ts`
- `test/contract/viewport-store.test.ts` (новый)
- `test/contract/layout-store.test.ts`
- `test/unit/history.test.ts`
- `test/e2e/helpers.ts`
- `test/e2e/canvas-layout.spec.ts`
- `test/e2e/card-drag.spec.ts`

С Ticket-ом 07 общие файлы history.ts и store.ts: если они попадут в одну Wave, Ticket-ы идут по
очереди. С Ticket-ом 03 общий файл helpers.ts (helper второго окна).

## Итог

Заполняется при закрытии.
