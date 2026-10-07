# 05 — Edge-и тонкие и бледные: цепочка Ticket-а — при наведении, Binding — только у живых агентов

Type: task
Status: open
Blocked by: 03
Source: решения владельца 2026-10-07, вопросы 14, 15 и 20 ([spec.md](../spec.md), раздел «Решения владельца по Canvas»); [spec.md](../spec.md), этап 2

## Что происходит

- Все Edge-и видны всегда, наведение и выделение их не меняют.
  - Blocked by (`src/renderer/canvas/edges/blocking.ts:15`): пунктир, пока блокер не done; тонкая
    сплошная линия, когда done (`src/renderer/canvas/epic-frame.css:341`, `:346`).
  - Binding (`src/renderer/canvas/edges/bindings.ts:10`): пунктир `5 4` цвета `--accent`, кривая
    React Flow по умолчанию.
  - Subagent (`src/renderer/canvas/edges/subagents.ts:15`): `smoothstep`.
- На рамке с десятками Ticket-ов Edge-и done и Edge-и Binding всех Session-ов закрывают картину:
  связи одного Ticket-а не разглядеть.
- Ticket 03 даёт маршруты Blocked by по коридорам между колонками, свой тип Edge-а
  (`src/renderer/canvas/edge-types/RoutedEdge.tsx`) и точку расширения `edge-types/`, которой не
  нужна правка `Canvas.tsx`.

## Что делаем

1. **По умолчанию — тонко и бледно** (решение 14). Все Edge-и Blocked by — 1 px, бледный цвет.
   Edge от done Ticket-а (блокер done) по умолчанию не рисуется. Цвета — существующие токены обеих
   тем (`src/renderer/theme/tokens.css`). Если нужен новый токен — исполнитель добавляет файл
   токенов в «Где в коде» и заводит токен в обеих темах.
2. **Цепочка Ticket-а.** Наведение на Ticket или его выделение подсвечивает цепочку — все Edge-и
   Blocked by на путях через этот Ticket: вверх (кто блокирует его и кто блокирует тех, до конца) и
   вниз (кого блокирует он, до конца). Edge-и от done Ticket-ов в цепочке рисуются, пока она
   подсвечена. Остальные Edge-и остаются бледными. Подсвечены сразу цепочки всех выделенных
   Ticket-ов и Ticket-а под курсором.
3. **Binding** (решение 20). Всегда видна линия живого агента: Session, чей процесс Claude Code
   работает сейчас (`claudeHome.live`, `src/shared/ipc/claude-home.ts:84`), и Subagent со статусом
   `running`. Линия остального агента рисуется, пока наведён или выделен Node агента или Node его
   цели (Ticket, рамка Epic). Форма — ортогональная со скруглёнными углами, радиус тот же, что у
   Blocked by. Пунктир и цвет — прежние.
4. **Subagent** — та же ортогональная форма и радиус; видимость прежняя.
5. **Как это устроено.** Overlay в `src/renderer/canvas/overlays/` (Canvas находит его сам, без
   правки `Canvas.tsx`) следит за наведением на Node-ы и за выделением React Flow и кладёт их в
   store. Компоненты Edge-ей читают store и решают сами: бледный, подсвеченный или скрытый. Список
   Edge-ей (`edgesOf`, `Canvas.tsx:161`) от наведения не пересчитывается. Перерисовываются только
   Edge-и, чьё состояние поменялось.

## Готово, когда

- [ ] Unit: на фикстуре Epic-а Edge от done блокера по умолчанию не нарисован; остальные Edge-и Blocked by — 1 px и с бледным классом.
- [ ] Unit: цепочка на фикстуре A→B→C, D→B, C→E, F→G (стрелка — «блокирует»): наведение на B подсвечивает A→B, D→B, B→C, C→E и не трогает F→G. Edge от done блокера в цепочке нарисован, пока цепочка подсвечена. Уход курсора возвращает вид по умолчанию.
- [ ] Unit: выделенный Ticket держит подсветку, пока он выделен; наведение на другой Ticket добавляет его цепочку.
- [ ] Unit: смена наведения перерисовывает только Edge-и, чьё состояние поменялось (счётчик render-ов компонента Edge-а).
- [ ] Binding: линия живой Session видна всегда; линия Session без процесса — только при наведении или выделении её Node-а или Node-а цели; форма ортогональная. Unit-test в `test/unit/binding-canvas.test.tsx` и e2e.
- [ ] e2e `test/e2e/edges.spec.ts`: наведение на Ticket рамки `worfy-mvp` подсвечивает ровно Edge-и его цепочки (по `data-testid`) не позже 100 ms после наведения; уход курсора возвращает вид по умолчанию.
- [ ] Бюджет `test/e2e/epic-frame.spec.ts:779` держится. В нём же — замер: наведение на Ticket самой большой рамки, время до подсветки печатается, с `WORFY_PERF=1` — не больше 100 ms.
- [ ] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`): вид по умолчанию, подсвеченная цепочка, линия живой и неживой Session. Сверены с F-SPEC (линии 1 px, токены обеих тем); ссылка из «Итог» — `../evidence/05-edge-и.png`.
- [ ] (вручную) Stable copy после влития: самая большая рамка Auction — по умолчанию только бледные Edge-и, наведение на Ticket показывает его цепочку, линии Binding видны у работающих Session-ов. Как проверить: окно приложения.

## Тесты

Сначала падающий test — `test/unit/edge-focus.test.tsx`: Edge от done блокера по умолчанию не
нарисован. На нынешнем main `blockingEdges` (`edges/blocking.ts:15`) отдаёт его с классом
`w-edge-blocking--done`, и он виден — test падает. В «Итог» — как он падал.

- `test/unit/edge-focus.test.tsx` — новый: вид по умолчанию, цепочка, выделение, число перерисовок.
- `test/unit/binding-canvas.test.tsx` — линии живых и неживых агентов.
- `test/e2e/edges.spec.ts` — новый: наведение и выделение на собранном приложении.

Test-ы, которые меняются вместе с поведением:

- `test/e2e/epic-frame.spec.ts:206` — по умолчанию нарисованы Edge-и только от блокеров не done;
  Edge от done блокера появляется при наведении на Ticket его цепочки.
- `test/e2e/binding.spec.ts:291` — шесть линий Binding были видны всегда; теперь — только у живых
  агентов, остальные — при наведении.

## Где в коде

- `src/renderer/canvas/edge-focus.ts` — новый: store наведения и выделения, расчёт цепочки
- `src/renderer/canvas/overlays/EdgeFocus.tsx` — новый
- `src/renderer/canvas/edge-types/RoutedEdge.tsx`
- `src/renderer/canvas/edge-types/StepEdge.tsx` — новый: ортогональный Edge Binding и Subagent
- `src/renderer/canvas/edges/blocking.ts`
- `src/renderer/canvas/edges/bindings.ts`
- `src/renderer/canvas/edges/subagents.ts`
- `src/renderer/canvas/sources/workflow-bindings.ts`
- `src/renderer/canvas/epic-frame.css`
- `test/unit/edge-focus.test.tsx` — новый
- `test/unit/binding-canvas.test.tsx`
- `test/e2e/edges.spec.ts` — новый
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/binding.spec.ts`

`workflow-bindings.ts` кладёт в данные anchor-а Binding-а, жив ли агент (он уже читает
`useClaudeHome`). `Canvas.tsx` этот Ticket не меняет. Общих файлов с Ticket-ом 04 нет, он в той же
Wave.
