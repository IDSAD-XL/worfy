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
  it('sets the flag and the position together, and unpinning sets both back', () => {
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: true, x: 300, y: 150 })
    expect(nodeOf()).toMatchObject({ pinned: true, x: 300, y: 150, w: 220, h: 120 })
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: false, x: -40, y: 7.5 })
    expect(nodeOf()).toMatchObject({ pinned: false, x: -40, y: 7.5 })
  })

  it('does not touch `locked`: a pinned Node can still be removed', () => {
    store.apply(PROJECT, { op: 'pin', id: 'n1', pinned: true, x: 1, y: 2 })
    expect(nodeOf()?.locked).toBe(false)
    store.apply(PROJECT, { op: 'remove', id: 'n1' })
    expect(store.get(PROJECT).layout.nodes).toEqual([])
  })

  it.each([
    ['pinned is a string', { op: 'pin', id: 'n1', pinned: 'yes', x: 1, y: 2 }],
    ['no position', { op: 'pin', id: 'n1', pinned: true }],
    ['x is a string', { op: 'pin', id: 'n1', pinned: true, x: '1', y: 2 }],
  ])('refuses an operation where %s, and changes nothing', (_name, op) => {
    const before = store.get(PROJECT)
    expect(() => store.apply(PROJECT, op as unknown as LayoutOpInput)).toThrow(/invalid layout operation/)
    expect(layoutApply.input.safeParse({ projectId: PROJECT, op }).success).toBe(false)
    expect(store.get(PROJECT)).toEqual(before)
  })

  it('drops keys the contract does not declare', () => {
    const op = { op: 'pin', id: 'n1', pinned: true, x: 5, y: 6, locked: true, evil: 1 }
    const parsed = layoutApply.input.parse({ projectId: PROJECT, op, extra: true })
    expect(parsed).toEqual({ projectId: PROJECT, op: { op: 'pin', id: 'n1', pinned: true, x: 5, y: 6 } })
    store.apply(PROJECT, op as unknown as LayoutOpInput)
    const node = nodeOf() as unknown as Record<string, unknown>
    expect(node.locked).toBe(false)
    expect('evil' in node).toBe(false)
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
