// Tags of Nodes (src/renderer/canvas/tags.ts): what the selection toolbar shows and sends.
import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '../../src/shared/layout/types'
import { addTagOps, normalizeTag, removeTagOps, selectionTags } from '../../src/renderer/canvas/tags'

const node = (id: string, tags: string[]): LayoutNode => ({ id, kind: 'note', x: 0, y: 0, w: 220, h: 120, hidden: false, locked: false, pinned: false, tags, data: {} })

describe('normalizeTag', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTag('  needs   review ')).toBe('needs review')
  })

  it('refuses an empty or too long tag', () => {
    expect(normalizeTag('   ')).toBeUndefined()
    expect(normalizeTag('x'.repeat(41))).toBeUndefined()
    expect(normalizeTag('x'.repeat(40))).toBe('x'.repeat(40))
  })
})

describe('selectionTags', () => {
  it('lists every tag of the selection once, sorted, with how many Nodes carry it', () => {
    expect(selectionTags([node('a', ['urgent', 'api']), node('b', ['api']), node('c', [])])).toEqual([
      { tag: 'api', count: 2 },
      { tag: 'urgent', count: 1 },
    ])
  })
})

describe('tag operations for a selection', () => {
  const selection = [node('a', ['api']), node('b', []), node('c', [])]

  it('adds to every Node that does not carry the tag yet, one operation each', () => {
    expect(addTagOps(selection, 'api')).toEqual([
      { op: 'tag', id: 'b', add: ['api'] },
      { op: 'tag', id: 'c', add: ['api'] },
    ])
  })

  it('removes from the Nodes that carry it', () => {
    expect(removeTagOps(selection, 'api')).toEqual([{ op: 'tag', id: 'a', remove: ['api'] }])
    expect(removeTagOps(selection, 'nope')).toEqual([])
  })
})
