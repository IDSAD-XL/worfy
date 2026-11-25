# Code story — worfy-product-session 35: Rework of worfy-product-session 26, item 6

Kind: pr · Epic: worfy-product-session · Ticket: 35 · PR: - · Language: ru

## 1. Что было не так

На приёмке Ticket-а 26 (радиальный Graph как в прототипе) тема стояла не в центре: на 26 % от верха группы узлов, 7 из
11 узлов ниже неё. Раскладка прототипа давала каждому листу равную долю круга, и глубокая ветка, где больше всего узлов,
ложилась по одну сторону темы. Решение владельца 2026-11-09: Graph радиальный, тема в центре.

- Требование: [Что происходит](../issues/35-rework-26-item-6.md#что-происходит)

## 2. Доля круга у листа — по его глубине

Code: `src/renderer/product/mind-map-layout.ts:539-544` · key lines: 539, 542

```ts
  const share = leaves.map((leaf) => Math.max(1, depth[leaf]!))
  const shares = share.reduce((sum, each) => sum + each, 0)
  let before = 0
  leaves.forEach((leaf, order) => {
    angle[leaf] = -Math.PI * 0.95 + (2 * Math.PI * (before + share[order]! / 2)) / shares
    before += share[order]!
```

- Что делает: начальная раскладка раздаёт листьям доли круга, равные их глубине (не меньше 1), так что глубокая ветка
  получает место для своих колец и обходит тему, а не висит с одной стороны.
- Почему здесь: это начальная раскладка (seed) `layoutRadial`, откуда пружины только уточняют места; Ticket называет
  раскладку Graph в `src/renderer/product/`.
- Без него: при равных долях ветка с цепочкой узлов занимает узкий сектор, и центр масс карты уходит от темы.
- Требование: [Готово, когда](../issues/35-rework-26-item-6.md#готово-когда)
- Риски и пробелы test-ов: на карте из одной ветки доли не меняют порядка; проверено test-ом «a single branch».

## 3. Каждый шаг подтягивает карту к теме

Code: `src/renderer/product/mind-map-layout.ts:584-598` · key lines: 584, 593, 595, 596

```ts
  const centred = leaves.length > 1
  const towardsRoot = (): void => {
    let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity]
    for (let index = 1; index < count; index += 1) {
      left = Math.min(left, x[index]! - width[index]! / 2)
      right = Math.max(right, x[index]! + width[index]! / 2)
      top = Math.min(top, y[index]! - height[index]! / 2)
      bottom = Math.max(bottom, y[index]! + height[index]! / 2)
    }
    const [shiftX, shiftY] = [(RADIAL_PULL * (left + right)) / 2, (RADIAL_PULL * (top + bottom)) / 2]
    for (let index = 1; index < count; index += 1) {
      x[index] = x[index]! - shiftX
      y[index] = y[index]! - shiftY
    }
  }
```

- Что делает: когда у карты два листа и больше (в том числе при одной ветке от темы, как на карте без Ticket-ов), каждый шаг пружин сдвигает все узлы, кроме темы, на 1 % пути от
  середины рамки вокруг них к теме, и карта оседает вокруг темы.
- Почему здесь: тема в раскладке не двигается (корень), поэтому центрировать можно только остальные узлы. Без
  подтягивания у карты с одной веткой от темы место темы зависело от ширины текста: на Windows (шрифт Segoe UI) e2e
  test дал 0,33 по горизонтали (CI run 45523151718). У цепочки (один лист) балансировать нечего, а подтянутая вокруг
  темы цепочка пересекла бы сама себя (комментарий в коде).
- Без него: на 60 случайных картах раскладка до правки ставила тему в середину (0,35–0,65 по обеим осям) на 35 картах,
  с правкой — на 59; вклад одного этого шага отдельно не измерен.
- Требование: [Готово, когда](../issues/35-rework-26-item-6.md#готово-когда)
- Риски и пробелы test-ов: unit test меняет ширину текста от ×0,8 до ×1,25 на карте с Ticket-ами и без них; другие
  шрифты как таковые не проверены. Сила 0,01 подобрана на картах test-ов и 60 случайных картах; карта, где ветки очень неравны,
  может остаться ближе к краю, чем 0,4.

## 4. Последние шаги убирают узлы с пути стрелок

Code: `src/renderer/product/mind-map-layout.ts:602-636` · key lines: 614, 622, 623

```ts
  /** Moves boxes off the "grew from" arrows that run over them (the last rounds, see there); `grid` finds the boxes near an arrow. */
  const clearArrows = (columns: Int32Array, rows: Int32Array, grid: ReadonlyMap<number, number[]>): void => {
    for (let index = 1; index < count; index += 1) {
      const up = parent[index]!
      if (up < 0) continue
      const [fromColumn, toColumn] = [Math.min(columns[index]!, columns[up]!), Math.max(columns[index]!, columns[up]!)]
      const [fromRow, toRow] = [Math.min(rows[index]!, rows[up]!), Math.max(rows[index]!, rows[up]!)]
      for (let column = fromColumn - 1; column <= toColumn + 1; column += 1) {
        for (let row = fromRow - 1; row <= toRow + 1; row += 1) {
          for (const other of grid.get(cellKey(column, row)) ?? []) {
            if (other === index || other === up) continue
            const [halfX, halfY] = [width[other]! / 2 + RADIAL.margin / 2, height[other]! / 2 + RADIAL.margin / 2]
            if (!crosses(x[up]!, y[up]!, x[index]!, y[index]!, x[other]! - halfX, y[other]! - halfY, x[other]! + halfX, y[other]! + halfY)) continue
            const [dx, dy] = [x[index]! - x[up]!, y[index]! - y[up]!]
            const length = Math.hypot(dx, dy) || 1
            // The line's normal towards the box's middle, and how far the box reaches over the line along it.
            let [normalX, normalY] = [-dy / length, dx / length]
            let side = (x[other]! - x[up]!) * normalX + (y[other]! - y[up]!) * normalY
            if (side < 0) [normalX, normalY, side] = [-normalX, -normalY, -side]
            const over = halfX * Math.abs(normalX) + halfY * Math.abs(normalY) - side
            const [boxPart, endPart] = other === 0 ? [0, over] : up === 0 ? [over, 0] : [over / 2, over / 2]
            x[other] = x[other]! + normalX * boxPart
            y[other] = y[other]! + normalY * boxPart
            if (up !== 0) {
              x[up] = x[up]! - normalX * endPart
              y[up] = y[up]! - normalY * endPart
            }
            x[index] = x[index]! - normalX * endPart
            y[index] = y[index]! - normalY * endPart
          }
        }
      }
    }
  }
  const rounds = Math.min(RADIAL.rounds, Math.max(RADIAL_ROUNDS_MIN, Math.floor(RADIAL_BUDGET / count)))
```

- Что делает: в последних 30 шагах (на картах до 500 узлов) для каждой стрелки «grew from» узлы рядом с ней (по сетке
  ячеек) проверяются отрезком против рамки (`crosses`, Liang–Barsky); если стрелка идёт поверх узла, узел отходит от
  линии, а концы стрелки — в другую сторону, каждый на половину. Тема не двигается, поэтому стрелка над темой сдвигается
  целиком; стрелка от темы стоит, и сдвигается узел.
- Почему здесь: подтянутая к теме карта плотнее, и стрелки чаще шли поверх узлов; приёмка Ticket-а 26 требует, чтобы
  узлы не накрывали друг друга, а стрелки — прямые.
- Без него: на 60 случайных картах 89 стрелок шли поверх узлов (с ним — 2).
- Требование: [Готово, когда](../issues/35-rework-26-item-6.md#готово-когда)
- Риски и пробелы test-ов: на картах больше 500 узлов этот проход не работает ради времени раскладки; там стрелка может
  пройти поверх узла. Время: 150 узлов — 42 ms лучшее, 63 ms медиана под нагрузкой около 43 (было 9,6 и 19,7).

## 5. Красная кривая «Replaces» изгибается туда, где меньше узлов

Code: `src/renderer/product/mind-map-layout.ts:789-794` · key lines: 789, 792, 793

```ts
    let [bend, least] = [bends[0]!, others.length === 0 ? 0 : over(bends[0]!)]
    for (const other of bends.slice(1)) {
      if (least === 0) break
      const count = over(other)
      if (count < least) [bend, least] = [other, count]
    }
```

- Что делает: `graphEdgePath` для `replaces` перебирает изгиб прототипа, его зеркало и изгибы на половину и на всю длину
  хорды в обе стороны, и берёт первый, кривая которого (23 точки) проходит над меньшим числом других узлов. `BoxEdge`
  передаёт рамки остальных узлов из `nodeLookup` React Flow только для `replaces` в Graph.
- Почему здесь: с темой в центре изгиб прототипа, всегда в одну сторону, проходил над темой.
- Без него: красная кривая шла поверх рамки темы.
- Требование: [Готово, когда](../issues/35-rework-26-item-6.md#готово-когда)
- Риски и пробелы test-ов: на карте e2e без Ticket-ов все шесть изгибов проходят над узлом «Отдельный экран продуктовой
  работы…», из которого выросли оба Решения; кривая идёт поверх него (видно на снимке `../evidence/35-graph-dark.png`).
  Над темой она не идёт.

## 6. Как проверено

- `test/unit/mind-map-graph-centre.test.ts` на коде origin/main красный (тема на 0,28 по вертикали),
  на ветке — exit 0; прежние test-ы радиальной раскладки в `test/unit/mind-map-layout.test.ts` — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0, `[gate] green`.
- `pnpm test:e2e test/e2e/product-session.spec.ts` — exit 0: в Graph центр темы в пределах 0,4–0,6 по обеим осям,
  кривая «Replaces» не заходит в тему; снимки Graph в двух темах.

## Проверить себя

1. Почему подтягивание к теме выключено только у цепочки, а у темы с одной веткой, но двумя листами работает?
   - Ответ: у цепочки балансировать нечего, и подтянутая вокруг неподвижной темы она пересекла бы сама себя; у ветки с
     несколькими листами без подтягивания место темы зависит от ширины текста.
   - Строки: `src/renderer/product/mind-map-layout.ts:584`
2. Кто сдвигается, когда стрелка от темы идёт поверх узла?
   - Ответ: только узел: тема неподвижна, и концы стрелки от неё остаются на месте.
   - Строки: `src/renderer/product/mind-map-layout.ts:622-630`
3. Когда кривая «Replaces» остаётся изгибом прототипа?
   - Ответ: когда он не проходит ни над одним другим узлом или ни один другой изгиб не даёт меньше пересечений.
   - Строки: `src/renderer/product/mind-map-layout.ts:789-793`
