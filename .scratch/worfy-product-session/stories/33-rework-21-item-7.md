# Code story — worfy-product-session 33: Rework of worfy-product-session 21, item 7

Kind: pr · Epic: worfy-product-session · Ticket: 33 · PR: - · Language: ru

## 1. Что было не так

На приёмке Ticket-а 21 (Mind map как в прототипе) связь «Replaces» в виде Tree была путём около 11 px: принятое Решение
«Mind map 60 / чат 40…» стоит прямо под отклонённым, стрелка шла между сторонами, обращёнными друг к другу (нижней и
верхней), и от неё оставался только красный наконечник, пунктира не было видно.

- Требование: [Что происходит](../issues/33-rework-21-item-7.md#что-происходит)

## 2. Стрелка «Replaces» в Tree огибает колонку справа

Code: `src/renderer/product/mind-map-layout.ts:812-822` · key lines: 813, 814, 817, 818, 819, 820

```ts
export function treeReplacesPath(from: ScreenBox, to: ScreenBox): string {
  const sameColumn = from.x < to.x + to.width && to.x < from.x + from.width
  if (!sameColumn) return graphEdgePath('replaces', from, to)
  const [fromMiddle, toMiddle] = [from.y + from.height / 2, to.y + to.height / 2]
  const towards = toMiddle >= fromMiddle ? 1 : -1
  const start = { x: from.x + from.width, y: fromMiddle + (towards * from.height) / 4 }
  const end = { x: to.x + to.width + 5, y: toMiddle - (towards * to.height) / 4 }
  const bow = Math.min(TREE_REPLACES_BOW.most, Math.max(TREE_REPLACES_BOW.least, Math.abs(end.y - start.y) * 0.25))
  const side = Math.max(from.x + from.width, to.x + to.width) + bow
  return `M${point(start)} C${point({ x: side, y: start.y })} ${point({ x: side, y: end.y })} ${point(end)}`
}
```

- Что делает: если два Решения в одной колонке (их рамки перекрываются по горизонтали), путь выходит из правого края
  позднего Решения на четверть его высоты ближе к отклонённому, уходит вправо за колонку на 28–44 px (чем дальше узлы,
  тем дальше) и входит в правый край отклонённого на 5 px правее него, наконечником влево. Узлы в разных колонках
  получают кривую прототипа, как в Graph.
- Почему здесь: Ticket называет `src/renderer/product/` (раскладка дерева и слой рёбер); почему именно правая сторона —
  не записано, это выбор реализации: слева у узла входит стрелка «grew from».
- Без него: путь между сторонами, обращёнными друг к другу, короче наконечника, и пунктира не видно.
- Требование: [Готово, когда](../issues/33-rework-21-item-7.md#готово-когда)
- Риски и пробелы test-ов: вынос не больше 44 px, а следующая колонка Tree в 48 px — если промежуток между колонками
  станет меньше, петля может зайти на узел соседней колонки; test этого не ловит.

## 3. Ребро `replaces` в Tree рисуется от рамки к рамке, а не между handle-ами

Code: `src/renderer/product/MindMap.tsx:480-495` · key lines: 488, 489

```tsx
  // dashed and ends at the Decision it overturned.
  return graph.edges.map((edge) =>
    edge.kind === 'from'
      ? { id: edge.id, source: edge.source, target: edge.target, type: 'default', className: 'w-mind__edge', markerEnd: arrowheadId(flowId, 'from'), focusable: false }
      : ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'box',
          data: { kind: edge.kind, view },
          // No text on the arrow: the legend names the red dashed one.
          className: 'w-mind__edge w-mind__edge--replaces',
          markerEnd: arrowheadId(flowId, 'replaces'),
          focusable: false,
          zIndex: 1,
        } satisfies BoxFlowEdge),
```

- Что делает: ребро `replaces` в Tree получает тип `box` (тот же `BoxEdge`, что рисует все стрелки Graph) и в `data` —
  вид; `BoxEdge` для Tree зовёт `treeReplacesPath` по текущим рамкам узлов. Handle-ы `replaces-out/in-top/bottom` и
  функция `replacesSides`, по которым шло старое ребро, удалены.
- Почему здесь: `flowEdges` строит рёбра обоих видов; рамки узлов берутся там, где они сейчас, так что стрелка идёт
  за узлом и при перетаскивании. Почему handle-ы удалены, а не оставлены — не записано; кроме этого ребра их никто не
  использовал (diff).
- Без него: React Flow рисовал бы bezier между нижним и верхним handle-ом, тот самый путь в 11 px.
- Требование: [Где в коде](../issues/33-rework-21-item-7.md#где-в-коде)
- Риски и пробелы test-ов: unit test окна (`mind-map-view.test.tsx`) берёт раскладку `layoutSync`, e2e — ELK; вид при
  перетаскивании узла с включённым «Move nodes» не проверен автоматически.

## 4. Как проверено

- `test/unit/mind-map-tree-replaces.test.ts` на коде origin/main красный, на ветке — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0, `[gate] green`.
- `pnpm test:e2e test/e2e/product-session.spec.ts` — exit 0, 11 passed; снимки Tree в двух темах в
  `../evidence/33-34-tree-light.png` и `../evidence/33-34-tree-dark.png`.

## Проверить себя

1. Почему стрелка входит в отклонённое Решение справа, а не сверху?
   - Ответ: оба Решения в одной колонке, одно под другим; между верхней и нижней сторонами остаётся несколько px, а
     справа путь можно увести за колонку и сделать длинным.
   - Строки: `src/renderer/product/mind-map-layout.ts:812-819`
2. Что получит стрелка между Решениями из разных колонок?
   - Ответ: кривую прототипа — тот же путь, что в Graph.
   - Строки: `src/renderer/product/mind-map-layout.ts:812-813`

## 5. Что нашёл review и что осталось

> VERIFIED — worfy-product-session 33, 34, 35 (reworks of product-session 21 item 7, 23 item 10, 26 item 6: the Mind map's Tree «Replaces» arrow, node text cut, Graph centre), head 4052e5467c2125baa4ee8943b0d8fe43222c6a9b
>
> Gate (depth medium, two rounds): reviewer (lens: correctness) — MERGE with three lows; the Orchestrator fixed the overclaim (comment and feature pages) and looked at the four screenshots.
>
> - What the user sees: in Tree the «Replaces» arrow between two Decisions of one column goes round the column as a visible dashed curve (it was an 11 px arrowhead); a node widens in 20 px steps, up to +120 px, so text fits four lines and only a really long text keeps «…» (on main five nodes of LONG_MAP were cut); in Graph the topic sits in the middle (0.4–0.6 on both axes, also with Hide rejected and with five branches) and the «Replaces» curve does not cross the topic.
> - Fixed by the Orchestrator: the layout comment and docs/features/product-session.md (en and ru) no longer promise «no arrow over a node» for every map — a 100-node map keeps a few (reviewer: 20 of 102 arrows, 40 on main) and the clearing rounds stop above 500 nodes; the Code story fragments follow.
> - Fixed in round 2 (CI windows-e2e red, deterministic: the Graph topic at 0.334 across with the Windows font): the radial layout pulled the map round the topic only when the topic had two branches, so on a map without Tickets the topic's place hung on the text widths; now whenever the map has two leaves or more (mind-map-layout.ts:577-584). A unit test scales text widths ×0.8–×1.25 on maps with and without Tickets: red before, the topic at 0.45–0.50 after; 60 random maps 60/60 in the middle (was 58/60). Checked by the Orchestrator against the diff 1a720a877..4052e5467.
> - Evidence: new unit tests red on origin/main; the 10 unit files of src/renderer/product 198 passed (implementer), 12 files 250/250 (reviewer); e2e test/e2e/product-session.spec.ts whole 11/11 EXIT=0 (implementer and reviewer, again on b33198b6a after round 2); pnpm lint, typecheck, test and gate fast green on ba1ccadc0 (the last code commit); pnpm lint EXIT=0 on 1a720a877; story-check ok ×3; same layout on seven runs of 100–1000-node maps; layoutRadial 11–18 ms median on 100 nodes, 41 ms on 1000.
> - Debt (low): in Tree a «Replaces» curve between two Decisions of one column clears only the wider of the two ends, so a wider node between them can sit under the dashed line (mind-map-layout.ts:818); the Graph «Replaces» curve is not redrawn when a third node is dragged onto it in «Move nodes» (MindMap.tsx:448, React Flow mutates nodeLookup in place); on the e2e map the Graph «Replaces» curve still crosses «Отдельный экран продуктовой работы…», the node both Decisions grew from (every bend crosses it).
> - Not verified: the three manual items on Mac Stable (after merge and Stable update); a local gate fast on the head (fseventsd overload on this Mac: 22 file-watcher contract tests red in pnpm test, none touching the Mind map; the merge waits for green ci-ok, including windows-e2e).
>
> Decided without the owner (to confirm): a widened node may land on a hand-placed neighbour until «Prettify» (the saved layout keeps only x, y); a deep leaf gets a larger share of the circle than in the prototype.
