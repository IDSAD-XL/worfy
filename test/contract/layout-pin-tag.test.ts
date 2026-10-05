// The `pin` and `tag` Layout operations (ticket 29) at the boundary: the `layout.apply` channel's
// schema and the store in main that applies them. A wrong type is refused and changes nothing;
// keys the contract does not declare are dropped, not stored.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { layoutApply } from '../../src/shared/ipc/layout'
import type { Layout, LayoutOpInput } from '../../src/shared/layout/types'
import { LayoutStore } from '../../src/main/layout/store'

const PROJECT = 'demo-0a1b2c3d'

let dir: string
let written: Layout[]
let store: LayoutStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-pin-tag-'))
  written = []
  store = new LayoutStore(() => dir, { write: (_file, layout) => written.push(layout), delayMs: 0 })
  store.apply(PROJECT, { op: 'create', node: { id: 'n1', kind: 'note', x: 10, y: 20, w: 220, h: 120 } })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const nodeOf = () => store.get(PROJECT).layout.nodes[0]

describe('pin', () => {
  it('sets the flag, the position and the size together, and unpinning sets them back', () => {
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: true, x: 300, y: 150, w: 110, h: 60 })
    expect(nodeOf()).toMatchObject({ pinned: true, x: 300, y: 150, w: 110, h: 60 })
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: false, x: -40, y: 7.5, w: 220, h: 120 })
    expect(nodeOf()).toMatchObject({ pinned: false, x: -40, y: 7.5, w: 220, h: 120 })
  })

  it('does not touch `locked`: a pinned Node can still be removed', () => {
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: true, x: 1, y: 2, w: 220, h: 120 })
    expect(nodeOf()?.locked).toBe(false)
    store.apply(PROJECT, { op: 'remove', id: 'n1' })
    expect(store.get(PROJECT).layout.nodes).toEqual([])
  })

  it.each([
    ['pinned is a string', { op: 'pin', id: 'n1', pinned: 'yes', x: 1, y: 2, w: 220, h: 120 }],
    ['no position', { op: 'pin', id: 'n1', pinned: true, w: 220, h: 120 }],
    ['no size', { op: 'pin', id: 'n1', pinned: true, x: 1, y: 2 }],
    ['x is a string', { op: 'pin', id: 'n1', pinned: true, x: '1', y: 2, w: 220, h: 120 }],
    ['the width is zero', { op: 'pin', id: 'n1', pinned: true, x: 1, y: 2, w: 0, h: 120 }],
  ])('refuses an operation where %s, and changes nothing', (_name, op) => {
    const before = store.get(PROJECT)
    expect(() => store.apply(PROJECT, op as unknown as LayoutOpInput)).toThrow(/invalid layout operation/)
    expect(layoutApply.input.safeParse({ projectId: PROJECT, op }).success).toBe(false)
    expect(store.get(PROJECT)).toEqual(before)
  })

  it('drops keys the contract does not declare', () => {
    const op = { op: 'pin', id: 'n1', pinned: true, x: 5, y: 6, w: 7, h: 8, locked: true, evil: 1 }
    const parsed = layoutApply.input.parse({ projectId: PROJECT, op, extra: true })
    expect(parsed).toEqual({ projectId: PROJECT, op: { op: 'pin', id: 'n1', pinned: true, x: 5, y: 6, w: 7, h: 8 } })
    store.apply(PROJECT, op as unknown as LayoutOpInput)
    const node = nodeOf() as unknown as Record<string, unknown>
    expect(node.locked).toBe(false)
    expect('evil' in node).toBe(false)
  })
})

// While pinned, x, y, w and h are screen pixels (src/shared/layout/types.ts): main refuses the
// operations that would set them as canvas units, whoever sends them (the renderer, the MCP tools).
describe('a pinned Node in main', () => {
  beforeEach(() => {
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: true, x: 300, y: 150, w: 110, h: 60 })
  })

  it.each([
    ['move', { op: 'move', id: 'n1', x: 900, y: 900 }],
    ['resize', { op: 'resize', id: 'n1', w: 500, h: 400 }],
    ['resize from the top-left edge', { op: 'resize', id: 'n1', w: 500, h: 400, x: 0, y: 0 }],
  ])('refuses a %s and changes nothing', (_name, op) => {
    const before = store.get(PROJECT)
    expect(() => store.apply(PROJECT, op as LayoutOpInput)).toThrow(/pinned to the screen/)
    expect(store.get(PROJECT)).toEqual(before)
  })

  it('takes the other operations, and a move again once it is unpinned', () => {
    store.apply(PROJECT, { op: 'tag', id: 'n1', add: ['kept'] })
    store.apply(PROJECT, { op: 'patchData', id: 'n1', data: { text: 'still here' } })
    expect(nodeOf()).toMatchObject({ pinned: true, x: 300, y: 150, w: 110, h: 60, tags: ['kept'], data: { text: 'still here' } })
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: false, x: 10, y: 20, w: 220, h: 120 })
    store.apply(PROJECT, { op: 'move', id: 'n1', x: 900, y: 900 })
    expect(nodeOf()).toMatchObject({ pinned: false, x: 900, y: 900 })
  })
})

describe('tag', () => {
  it('adds without duplicates, keeps the order tags were added in, and removes', () => {
    store.apply(PROJECT, { op: 'tag', id: 'n1', add: ['api', 'urgent'] })
    store.apply(PROJECT, { op: 'tag', id: 'n1', add: ['api', 'later'] })
    expect(nodeOf()?.tags).toEqual(['api', 'urgent', 'later'])
    store.apply(PROJECT, { op: 'tag', id: 'n1', remove: ['urgent', 'absent'] })
    expect(nodeOf()?.tags).toEqual(['api', 'later'])
  })

  it('trims tags, and a tag both added and removed ends up removed', () => {
    store.apply(PROJECT, { op: 'tag', id: 'n1', add: ['  spaced  ', 'gone'], remove: ['gone'] })
    expect(nodeOf()?.tags).toEqual(['spaced'])
  })

  it('reaches the file', () => {
    store.apply(PROJECT, { op: 'tag', id: 'n1', add: ['saved'] })
    store.flush(PROJECT)
    expect(written.at(-1)?.nodes[0]?.tags).toEqual(['saved'])
  })

  it.each([
    ['add is a string', { op: 'tag', id: 'n1', add: 'api' }],
    ['a tag is a number', { op: 'tag', id: 'n1', add: [42] }],
    ['a tag is blank', { op: 'tag', id: 'n1', add: ['   '] }],
    ['a tag is too long', { op: 'tag', id: 'n1', add: ['x'.repeat(41)] }],
    ['the Node is missing', { op: 'tag', id: 'nope', add: ['api'] }],
  ])('refuses an operation where %s, and changes nothing', (_name, op) => {
    const before = store.get(PROJECT)
    expect(() => store.apply(PROJECT, op as unknown as LayoutOpInput)).toThrow()
    expect(store.get(PROJECT)).toEqual(before)
  })

  it('drops keys the contract does not declare', () => {
    const op = { op: 'tag', id: 'n1', add: ['api'], tags: ['replaced'], evil: 1 }
    expect(layoutApply.input.parse({ projectId: PROJECT, op }).op).toEqual({ op: 'tag', id: 'n1', add: ['api'], remove: [] })
    store.apply(PROJECT, op as unknown as LayoutOpInput)
    expect(nodeOf()?.tags).toEqual(['api'])
    expect('evil' in (nodeOf() as unknown as Record<string, unknown>)).toBe(false)
  })
})
