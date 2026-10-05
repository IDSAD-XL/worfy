// The tiling of focus mode: a tree of splits whose leaves are Node ids. Pure functions only; the
// tree is never mutated, every operation returns a new one.
//
// A split lays its children side by side ('row') or one under another ('column'). `sizes` holds
// each child's share of the split's length and sums to 1. A divider sits between child i and
// child i + 1 and is addressed by the path of its split (child indexes from the root) and i.
//
// Every operation returns a normalized tree: no split with a single child, and no split directly
// inside a split of the same direction (its children are merged into the parent, shares
// multiplied), so the same picture has one shape.

export type Direction = 'row' | 'column'

export interface TileLeaf {
  kind: 'leaf'
  /** The Node shown in the tile. */
  id: string
}

export interface TileSplit {
  kind: 'split'
  direction: Direction
  children: TileTree[]
  /** Shares of the split's length, one per child, summing to 1. */
  sizes: number[]
}

export type TileTree = TileLeaf | TileSplit

/** Child indexes from the root to a split. */
export type TilePath = readonly number[]

export type Edge = 'left' | 'right' | 'top' | 'bottom'
/** Where a tile dropped on another one goes: to one of its edges (divides it) or onto it (swaps). */
export type DropZone = Edge | 'center'

export type Preset = 'even' | 'main-side' | 'columns' | 'rows'

export const PRESETS: readonly { value: Preset; label: string }[] = [
  { value: 'even', label: 'Even' },
  { value: 'main-side', label: 'Main + side' },
  { value: 'columns', label: 'Columns' },
  { value: 'rows', label: 'Rows' },
]

/** The smallest share a divider can squeeze a tile to. */
export const MIN_SHARE = 0.1

/** The main tile's share in the Main + side preset. */
export const MAIN_SHARE = 2 / 3

/** How close to an edge of a tile, as a share of its width or height, a drop divides it. */
export const EDGE_ZONE = 0.25

const leaf = (id: string): TileLeaf => ({ kind: 'leaf', id })

const equalSizes = (count: number): number[] => Array.from({ length: count }, () => 1 / count)

function split(direction: Direction, children: TileTree[], sizes: number[] = equalSizes(children.length)): TileTree {
  return normalize({ kind: 'split', direction, children, sizes })
}

/** A tiling of the given Nodes in their order; null when there are none. */
export function buildPreset(preset: Preset, ids: readonly string[]): TileTree | null {
  if (ids.length === 0) return null
  if (ids.length === 1) return leaf(ids[0] as string)
  const leaves = ids.map(leaf)
  switch (preset) {
    case 'columns':
      return split('row', leaves)
    case 'rows':
      return split('column', leaves)
    case 'main-side': {
      const [main, ...side] = leaves as [TileLeaf, ...TileLeaf[]]
      return split('row', [main, split('column', side)], [MAIN_SHARE, 1 - MAIN_SHARE])
    }
    case 'even': {
      // As square a grid as the count allows, filled row by row; a short last row is stretched.
      const columns = Math.ceil(Math.sqrt(ids.length))
      const rows: TileTree[] = []
      for (let start = 0; start < leaves.length; start += columns) rows.push(split('row', leaves.slice(start, start + columns)))
      return split('column', rows)
    }
  }
}

/** The Node ids of the leaves, left to right and top to bottom. */
export function leafIds(tree: TileTree): string[] {
  return tree.kind === 'leaf' ? [tree.id] : tree.children.flatMap(leafIds)
}

/** The same tree in its one canonical shape (see the top of the file); shares are rescaled to sum to 1. */
export function normalize(tree: TileTree): TileTree {
  if (tree.kind === 'leaf') return tree
  const children: TileTree[] = []
  const sizes: number[] = []
  tree.children.forEach((raw, index) => {
    const share = tree.sizes[index] ?? 0
    const child = normalize(raw)
    if (child.kind === 'split' && child.direction === tree.direction) {
      child.children.forEach((grandchild, inner) => {
        children.push(grandchild)
        sizes.push(share * (child.sizes[inner] ?? 0))
      })
    } else {
      children.push(child)
      sizes.push(share)
    }
  })
  if (children.length === 0) throw new Error('a split without children')
  if (children.length === 1) return children[0] as TileTree
  const total = sizes.reduce((sum, size) => sum + size, 0)
  return { kind: 'split', direction: tree.direction, children, sizes: total > 0 ? sizes.map((size) => size / total) : equalSizes(children.length) }
}

function mapLeaves(tree: TileTree, map: (leaf: TileLeaf) => TileTree): TileTree {
  if (tree.kind === 'leaf') return map(tree)
  return { ...tree, children: tree.children.map((child) => mapLeaves(child, map)) }
}

/** The two tiles trade places; unchanged when either is missing. */
export function swapTiles(tree: TileTree, a: string, b: string): TileTree {
  const ids = leafIds(tree)
  if (a === b || !ids.includes(a) || !ids.includes(b)) return tree
  return mapLeaves(tree, (item) => (item.id === a ? leaf(b) : item.id === b ? leaf(a) : item))
}

/**
 * Takes a tile out; the neighbours in its split share its place in proportion to their sizes.
 * Null when it was the last tile.
 */
export function removeTile(tree: TileTree, id: string): TileTree | null {
  if (tree.kind === 'leaf') return tree.id === id ? null : tree
  const children: TileTree[] = []
  const sizes: number[] = []
  tree.children.forEach((child, index) => {
    const kept = removeTile(child, id)
    if (kept === null) return
    children.push(kept)
    sizes.push(tree.sizes[index] ?? 0)
  })
  if (children.length === 0) return null
  return normalize({ kind: 'split', direction: tree.direction, children, sizes })
}

/**
 * Puts the moved tile next to the target at the given edge: the target's place is divided in
 * half between them. The moved tile leaves its old place first (as removeTile does); a tile not
 * in the tree yet is simply added. Unchanged when the target is missing or is the moved tile.
 */
export function splitTile(tree: TileTree, targetId: string, movedId: string, edge: Edge): TileTree {
  if (targetId === movedId || !leafIds(tree).includes(targetId)) return tree
  const rest = removeTile(tree, movedId)
  if (rest === null) return tree
  const direction: Direction = edge === 'left' || edge === 'right' ? 'row' : 'column'
  const before = edge === 'left' || edge === 'top'
  return normalize(
    mapLeaves(rest, (item) =>
      item.id === targetId ? { kind: 'split', direction, children: before ? [leaf(movedId), item] : [item, leaf(movedId)], sizes: [0.5, 0.5] } : item,
    ),
  )
}

function splitAt(tree: TileTree, path: TilePath): TileSplit | undefined {
  let node: TileTree | undefined = tree
  for (const index of path) node = node?.kind === 'split' ? node.children[index] : undefined
  return node?.kind === 'split' ? node : undefined
}

function replaceAt(tree: TileTree, path: TilePath, replace: (node: TileSplit) => TileSplit): TileTree {
  if (path.length === 0) return tree.kind === 'split' ? replace(tree) : tree
  if (tree.kind === 'leaf') return tree
  const [head, ...tail] = path as [number, ...number[]]
  const child = tree.children[head]
  if (child === undefined) return tree
  const children = tree.children.slice()
  children[head] = replaceAt(child, tail, replace)
  return { ...tree, children }
}

/**
 * Moves the divider between child `index` and `index + 1` of the split at `path` by `delta`, a
 * share of that split's length (positive: right or down). Only those two children change; neither
 * gets smaller than MIN_SHARE (or half of what the two have together, when that is less).
 */
export function moveDivider(tree: TileTree, path: TilePath, index: number, delta: number): TileTree {
  const target = splitAt(tree, path)
  if (target === undefined || !Number.isFinite(delta)) return tree
  const first = target.sizes[index]
  const second = target.sizes[index + 1]
  if (first === undefined || second === undefined) return tree
  const pair = first + second
  const floor = Math.min(MIN_SHARE, pair / 2)
  const moved = Math.min(Math.max(first + delta, floor), pair - floor)
  return replaceAt(tree, path, (node) => {
    const sizes = node.sizes.slice()
    sizes[index] = moved
    sizes[index + 1] = pair - moved
    return { ...node, sizes }
  })
}

/** Gives every child of the split at `path` the same share. */
export function equalize(tree: TileTree, path: TilePath): TileTree {
  if (splitAt(tree, path) === undefined) return tree
  return replaceAt(tree, path, (node) => ({ ...node, sizes: equalSizes(node.children.length) }))
}

/** A rectangle as shares of the whole tiling area. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface TileRect extends Rect {
  id: string
}

export interface DividerRect {
  /** The split the divider belongs to, and the child before it. */
  path: number[]
  index: number
  /** The split's direction: a 'row' split has upright dividers. */
  direction: Direction
  /** Where the divider line is, as shares of the whole area. */
  x: number
  y: number
  /** The line's length across the split. */
  length: number
  /** The split's length along its direction: what `moveDivider`'s delta is a share of. */
  extent: number
}

export interface Geometry {
  tiles: TileRect[]
  dividers: DividerRect[]
}

/** Where every tile and divider is, as shares of the whole tiling area. */
export function computeGeometry(tree: TileTree): Geometry {
  const tiles: TileRect[] = []
  const dividers: DividerRect[] = []
  const visit = (node: TileTree, rect: Rect, path: number[]): void => {
    if (node.kind === 'leaf') {
      tiles.push({ id: node.id, ...rect })
      return
    }
    const row = node.direction === 'row'
    const extent = row ? rect.w : rect.h
    let offset = 0
    node.children.forEach((child, index) => {
      const length = extent * (node.sizes[index] ?? 0)
      const childRect = row ? { x: rect.x + offset, y: rect.y, w: length, h: rect.h } : { x: rect.x, y: rect.y + offset, w: rect.w, h: length }
      visit(child, childRect, [...path, index])
      offset += length
      if (index < node.children.length - 1) {
        dividers.push({
          path,
          index,
          direction: node.direction,
          x: row ? rect.x + offset : rect.x,
          y: row ? rect.y : rect.y + offset,
          length: row ? rect.h : rect.w,
          extent,
        })
      }
    })
  }
  visit(tree, { x: 0, y: 0, w: 1, h: 1 }, [])
  return { tiles, dividers }
}

/** The tile under a point given as shares of the whole area. */
export function tileAt(geometry: Geometry, x: number, y: number): TileRect | undefined {
  return geometry.tiles.find((tile) => x >= tile.x && x < tile.x + tile.w && y >= tile.y && y < tile.y + tile.h)
}

/**
 * Where a tile dropped at (x, y) inside a target of the given size goes: within EDGE_ZONE of an
 * edge it divides the target at the nearest such edge, elsewhere it swaps with it.
 */
export function dropZoneAt(width: number, height: number, x: number, y: number): DropZone {
  if (!(width > 0) || !(height > 0)) return 'center'
  const distances: [Edge, number][] = [
    ['left', x / width],
    ['right', (width - x) / width],
    ['top', y / height],
    ['bottom', (height - y) / height],
  ]
  let nearest: [Edge, number] = ['left', Number.POSITIVE_INFINITY]
  for (const entry of distances) if (entry[1] < nearest[1]) nearest = entry
  return nearest[1] < EDGE_ZONE ? nearest[0] : 'center'
}
