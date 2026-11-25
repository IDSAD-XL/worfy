# Code story — worfy-product-session 33: Rework of worfy-product-session 21, item 7

Kind: pr · Epic: worfy-product-session · Ticket: 33 · PR: - · Language: ru

## 1. Что было не так

На приёмке Ticket-а 21 (Mind map как в прототипе) связь «Replaces» в виде Tree была путём около 11 px: принятое Решение
«Mind map 60 / чат 40…» стоит прямо под отклонённым, стрелка шла между сторонами, обращёнными друг к другу (нижней и
верхней), и от неё оставался только красный наконечник, пунктира не было видно.

- Требование: [Что происходит](../issues/33-rework-21-item-7.md#что-происходит)

## 2. Стрелка «Replaces» в Tree огибает колонку справа

Code: `src/renderer/product/mind-map-layout.ts:810-820` · key lines: 811, 812, 815, 816, 817, 818

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
   - Строки: `src/renderer/product/mind-map-layout.ts:810-817`
2. Что получит стрелка между Решениями из разных колонок?
   - Ответ: кривую прототипа — тот же путь, что в Graph.
   - Строки: `src/renderer/product/mind-map-layout.ts:810-811`
