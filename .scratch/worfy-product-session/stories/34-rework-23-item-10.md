# Code story — worfy-product-session 34: Rework of worfy-product-session 23, item 10

Kind: pr · Epic: worfy-product-session · Ticket: 34 · PR: - · Language: ru

## 1. Что было не так

На приёмке Ticket-а 23 (размер и текст узла) «…» стояло не только у очень длинного узла: короткие узлы «Отдельный экран
продуктовой работы…» и «Файл в docs/product/ правит tool…» тоже были обрезаны. У обоих есть метка свёртки ветки, она
отнимает у текста часть ширины, и текст не влезал в четыре строки ровно на несколько слов.

- Требование: [Что происходит](../issues/34-rework-23-item-10.md#что-происходит)

## 2. Узел становится шире, прежде чем текст обрежется

Code: `src/renderer/product/mind-map-layout.ts:308-325` · key lines: 315, 317, 318, 319, 323

```ts
export function nodeSize(node: MapNode, view: MindMapView): { width: number; height: number } {
  const big = node.kind === 'topic' || node.kind === 'ticket'
  const size = MIND_MAP_FONT[view] + (big ? 2 : 0)
  const base = WIDTH[view] + (big ? 40 : 0)
  const inset = (NODE_PAD[node.kind].left + ICON_EM[node.kind] + NODE_PAD[node.kind].right) * size + (node.branch === true ? FOLD_PX + 0.52 * size : 0)
  const measure = (text: string) => measureText(text, size, big)
  const linesAt = (width: number, spare: number) => wrappedLines(node.text, Math.max(size, width - inset - spare), measure)
  let width = base
  if (linesAt(base, 2) > MAX_LINES) {
    for (let wider = base + WIDEN.step; wider <= base + WIDEN.most; wider += WIDEN.step) {
      if (linesAt(wider, 6) > MAX_LINES) continue
      width = wider
      break
    }
  }
  const lines = Math.min(MAX_LINES, linesAt(width, 2))
  return { width, height: Math.ceil(lines * size * LINE + NODE_PAD_Y) }
}
```

- Что делает: если текст при обычной ширине вида требует пятой строки, `nodeSize` пробует узлы шире на 20, 40 … 120 px
  (`WIDEN`) и берёт первый, где текст помещается в четыре строки с запасом 6 px; если не помещается ни в одном, узел
  остаётся обычной ширины и текст режется на четырёх строках.
- Почему здесь: `nodeSize` уже считает строки текста по шрифту для высоты узла; Ticket называет `src/renderer/product/`.
  Почему предел 120 px и шаг 20 — не записано.
- Без него: текст, которому не хватает нескольких слов, обрезается «…», как увидела приёмка.
- Требование: [Готово, когда](../issues/34-rework-23-item-10.md#готово-когда)
- Риски и пробелы test-ов: запас 6 px против 2 px у высоты нужен, чтобы браузер, мерящий шрифт чуть шире, не переносил
  текст на пятую строку; unit test-ы меряют шрифт моделью (`fontLike`), реальный шрифт проверяет только e2e на одной
  карте.

## 3. Как проверено

- `test/unit/mind-map-node-width.test.ts` на коде origin/main красный (обрезаны 5 узлов вместо одного), на ветке — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0, `[gate] green`.
- `pnpm test:e2e test/e2e/product-session.spec.ts` — exit 0: в окне «…» только у `very-long`, в Tree и в Graph.

## Проверить себя

1. Какой ширины будет узел, текст которого не влезает в четыре строки даже при +120 px?
   - Ответ: обычной ширины вида: цикл не находит ширины, `width` остаётся `base`, текст режется на четырёх строках.
   - Строки: `src/renderer/product/mind-map-layout.ts:316-323`
2. Почему подходящая ширина проверяется с запасом 6 px, а строки для высоты — с 2 px?
   - Ответ: чтобы узел, расширенный ради четырёх строк, не получил пятую там, где браузер мерит текст чуть шире модели.
   - Строки: `src/renderer/product/mind-map-layout.ts:317-319`
