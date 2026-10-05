import { describe, expect, it } from 'vitest'
import {
  buildPreset,
  computeGeometry,
  dropZoneAt,
  equalize,
  leafIds,
  MAIN_SHARE,
  MIN_SHARE,
  moveDivider,
  normalize,
  removeTile,
  splitTile,
  swapTiles,
  tileAt,
  type TileTree,
} from '../../src/renderer/focus/split-tree'

const leaf = (id: string): TileTree => ({ kind: 'leaf', id })
const row = (children: TileTree[], sizes: number[]): TileTree => ({ kind: 'split', direction: 'row', children, sizes })
const column = (children: TileTree[], sizes: number[]): TileTree => ({ kind: 'split', direction: 'column', children, sizes })

/** Rounds every share so float noise does not decide a comparison. */
function rounded(tree: TileTree | null): TileTree | null {
  if (tree === null || tree.kind === 'leaf') return tree
  return { ...tree, children: tree.children.map((child) => rounded(child) as TileTree), sizes: tree.sizes.map((size) => Math.round(size * 1e6) / 1e6) }
}

describe('splitTile', () => {
  it('divides the target tile at the edge the moved tile was dropped on', () => {
    const tree = row([leaf('a'), leaf('b'), leaf('c')], [0.25, 0.5, 0.25])
    expect(splitTile(tree, 'b', 'c', 'bottom')).toEqual(row([leaf('a'), column([leaf('b'), leaf('c')], [0.5, 0.5])], [1 / 3, 2 / 3]))
  })

  it('puts the moved tile first for the left and top edges', () => {
    const tree = row([leaf('a'), leaf('b')], [0.5, 0.5])
    expect(splitTile(tree, 'a', 'b', 'top')).toEqual(column([leaf('b'), leaf('a')], [0.5, 0.5]))
    expect(splitTile(column([leaf('a'), leaf('b')], [0.5, 0.5]), 'a', 'b', 'left')).toEqual(row([leaf('b'), leaf('a')], [0.5, 0.5]))
  })

  it('merges a division along the split it lands in, halving the target share', () => {
    const tree = row([leaf('a'), leaf('b'), column([leaf('c'), leaf('d')], [0.5, 0.5])], [0.5, 0.25, 0.25])
    // d leaves the column (c takes it whole), then b is divided to its right: b and d get half of b's share each.
    expect(rounded(splitTile(tree, 'b', 'd', 'right'))).toEqual(row([leaf('a'), leaf('b'), leaf('d'), leaf('c')], [0.5, 0.125, 0.125, 0.25]))
  })

  it('adds a tile that was not in the tree', () => {
    expect(splitTile(leaf('a'), 'a', 'z', 'right')).toEqual(row([leaf('a'), leaf('z')], [0.5, 0.5]))
  })

  it('leaves the tree alone when the target is missing or is the moved tile', () => {
    const tree = row([leaf('a'), leaf('b')], [0.3, 0.7])
    expect(splitTile(tree, 'x', 'a', 'left')).toBe(tree)
    expect(splitTile(tree, 'a', 'a', 'left')).toBe(tree)
  })
})

describe('buildPreset', () => {
  const ids = ['a', 'b', 'c']

  it('Even fills as square a grid as it can, row by row', () => {
    expect(buildPreset('even', ids)).toEqual(column([row([leaf('a'), leaf('b')], [0.5, 0.5]), leaf('c')], [0.5, 0.5]))
    expect(buildPreset('even', ['a', 'b'])).toEqual(row([leaf('a'), leaf('b')], [0.5, 0.5]))
    const four = buildPreset('even', ['a', 'b', 'c', 'd'])
    expect(four).toEqual(column([row([leaf('a'), leaf('b')], [0.5, 0.5]), row([leaf('c'), leaf('d')], [0.5, 0.5])], [0.5, 0.5]))
  })

  it('Main + side gives the first Node the large share and stacks the rest', () => {
    expect(buildPreset('main-side', ids)).toEqual(row([leaf('a'), column([leaf('b'), leaf('c')], [0.5, 0.5])], [MAIN_SHARE, 1 - MAIN_SHARE]))
    expect(buildPreset('main-side', ['a', 'b'])).toEqual(row([leaf('a'), leaf('b')], [MAIN_SHARE, 1 - MAIN_SHARE]))
  })

  it('Columns and Rows lay every Node out in one line with equal shares', () => {
    expect(buildPreset('columns', ids)).toEqual(row(ids.map(leaf), [1 / 3, 1 / 3, 1 / 3]))
    expect(buildPreset('rows', ids)).toEqual(column(ids.map(leaf), [1 / 3, 1 / 3, 1 / 3]))
  })

  it('one Node is a single tile and none is no tiling', () => {
    expect(buildPreset('columns', ['a'])).toEqual(leaf('a'))
    expect(buildPreset('even', [])).toBeNull()
  })

  it('keeps the order of the ids', () => {
    for (const preset of ['even', 'main-side', 'columns', 'rows'] as const) expect(leafIds(buildPreset(preset, ['c', 'a', 'b']) as TileTree)).toEqual(['c', 'a', 'b'])
  })
})

describe('swapTiles', () => {
  it('trades the places of two tiles and keeps the shares', () => {
    const tree = row([leaf('a'), column([leaf('b'), leaf('c')], [0.3, 0.7])], [0.6, 0.4])
    expect(swapTiles(tree, 'a', 'c')).toEqual(row([leaf('c'), column([leaf('b'), leaf('a')], [0.3, 0.7])], [0.6, 0.4]))
  })

  it('leaves the tree alone when a tile is missing or both are the same', () => {
    const tree = row([leaf('a'), leaf('b')], [0.5, 0.5])
    expect(swapTiles(tree, 'a', 'x')).toBe(tree)
    expect(swapTiles(tree, 'a', 'a')).toBe(tree)
  })
})

describe('removeTile', () => {
  it('gives the place to the neighbours in proportion to their shares', () => {
    expect(rounded(removeTile(row([leaf('a'), leaf('b'), leaf('c')], [0.2, 0.2, 0.6]), 'a'))).toEqual(row([leaf('b'), leaf('c')], [0.25, 0.75]))
  })

  it('collapses a split left with one child', () => {
    expect(removeTile(row([leaf('a'), column([leaf('b'), leaf('c')], [0.5, 0.5])], [0.5, 0.5]), 'c')).toEqual(row([leaf('a'), leaf('b')], [0.5, 0.5]))
  })

  it('returns null for the last tile and the same tree for a missing one', () => {
    expect(removeTile(leaf('a'), 'a')).toBeNull()
    expect(removeTile(leaf('a'), 'b')).toEqual(leaf('a'))
  })
})

describe('moveDivider and equalize', () => {
  const tree = column([row([leaf('a'), leaf('b'), leaf('c')], [1 / 3, 1 / 3, 1 / 3]), leaf('d')], [0.5, 0.5])

  it('changes only the two shares next to the divider', () => {
    expect(rounded(moveDivider(tree, [0], 0, 0.1))).toEqual(rounded(column([row([leaf('a'), leaf('b'), leaf('c')], [1 / 3 + 0.1, 1 / 3 - 0.1, 1 / 3]), leaf('d')], [0.5, 0.5])))
    expect(rounded(moveDivider(tree, [], 0, -0.2))).toEqual(rounded(column([row([leaf('a'), leaf('b'), leaf('c')], [1 / 3, 1 / 3, 1 / 3]), leaf('d')], [0.3, 0.7])))
  })

  it('never squeezes a tile below the smallest share', () => {
    const squeezed = moveDivider(tree, [0], 1, 5) as Extract<TileTree, { kind: 'split' }>
    const inner = squeezed.children[0] as Extract<TileTree, { kind: 'split' }>
    expect(inner.sizes[2]).toBeCloseTo(MIN_SHARE, 9)
    expect(inner.sizes[1]).toBeCloseTo(2 / 3 - MIN_SHARE, 9)
    expect(inner.sizes[0]).toBeCloseTo(1 / 3, 9)
  })

  it('ignores a path or divider that does not exist, and a delta that is not a number', () => {
    expect(moveDivider(tree, [1], 0, 0.1)).toBe(tree)
    expect(moveDivider(tree, [0], 2, 0.1)).toBe(tree)
    expect(moveDivider(tree, [0], 0, Number.NaN)).toBe(tree)
  })

  it('equalize evens out the split the divider belongs to and nothing else', () => {
    const uneven = moveDivider(moveDivider(tree, [0], 0, 0.2), [], 0, 0.1)
    const evened = equalize(uneven, [0]) as Extract<TileTree, { kind: 'split' }>
    expect((evened.children[0] as Extract<TileTree, { kind: 'split' }>).sizes).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(evened.sizes[0]).toBeCloseTo(0.6, 9)
    expect(equalize(tree, [1])).toBe(tree)
  })
})

describe('normalize', () => {
  it('flattens a split inside a split of the same direction and rescales the shares', () => {
    expect(rounded(normalize(row([leaf('a'), row([leaf('b'), leaf('c')], [1, 1])], [1, 1])))).toEqual(row([leaf('a'), leaf('b'), leaf('c')], [0.5, 0.25, 0.25]))
  })
})

describe('geometry', () => {
  const tree = row([leaf('a'), column([leaf('b'), leaf('c')], [0.25, 0.75])], [0.6, 0.4])
  const geometry = computeGeometry(tree)

  it('places every tile as shares of the whole area', () => {
    expect(geometry.tiles.map(({ id, x, y, w, h }) => ({ id, x, y, w: Math.round(w * 100), h: Math.round(h * 100) }))).toEqual([
      { id: 'a', x: 0, y: 0, w: 60, h: 100 },
      { id: 'b', x: 0.6, y: 0, w: 40, h: 25 },
      { id: 'c', x: 0.6, y: 0.25, w: 40, h: 75 },
    ])
  })

  it('places each divider with its split and the length a drag is measured against', () => {
    expect(geometry.dividers).toEqual([
      { path: [], index: 0, direction: 'row', x: 0.6, y: 0, length: 1, extent: 1 },
      { path: [1], index: 0, direction: 'column', x: 0.6, y: 0.25, length: 0.4, extent: 1 },
    ])
  })

  it('finds the tile under a point', () => {
    expect(tileAt(geometry, 0.1, 0.9)?.id).toBe('a')
    expect(tileAt(geometry, 0.9, 0.1)?.id).toBe('b')
    expect(tileAt(geometry, 0.9, 0.9)?.id).toBe('c')
    expect(tileAt(geometry, 1.2, 0.5)).toBeUndefined()
  })
})

describe('dropZoneAt', () => {
  it('divides at the nearest edge within a quarter of the tile and swaps elsewhere', () => {
    expect(dropZoneAt(400, 200, 200, 100)).toBe('center')
    expect(dropZoneAt(400, 200, 20, 100)).toBe('left')
    expect(dropZoneAt(400, 200, 390, 100)).toBe('right')
    expect(dropZoneAt(400, 200, 200, 10)).toBe('top')
    expect(dropZoneAt(400, 200, 200, 190)).toBe('bottom')
    expect(dropZoneAt(0, 200, 0, 0)).toBe('center')
  })
})
