// The items of the Canvas context menu (src/renderer/canvas/overlays/): each comes from a Node
// type file that exports `createLabel`. The menu itself is driven in test/e2e/terminal.spec.ts.
import { describe, expect, it } from 'vitest'
import type { NodeType } from '../../src/renderer/canvas/nodes/index'
import { createItems } from '../../src/renderer/canvas/overlays/create-items'
import { TERMINAL_NODE_KIND } from '../../src/shared/ipc/terminal'

const Dummy = () => null
const type = (kind: string): NodeType => ({ kind, Component: Dummy, defaultWidth: 100, defaultHeight: 50 })
const types = new Map([
  ['note', type('note')],
  ['terminal', type('terminal')],
  ['session', type('session')],
])

describe('createItems', () => {
  it('makes an item for each Node type with a createLabel, sorted by label', () => {
    const items = createItems(
      {
        './NoteNode.tsx': { kind: 'note', default: Dummy },
        './TerminalNode.tsx': { kind: 'terminal', default: Dummy, createLabel: 'New terminal' },
        './SessionNode.tsx': { kind: 'session', default: Dummy, createLabel: 'New session' },
      },
      types,
    )
    expect(items.map(({ label, type: { kind } }) => [label, kind])).toEqual([
      ['New session', 'session'],
      ['New terminal', 'terminal'],
    ])
  })

  it.each([
    ['an empty label', { './TerminalNode.tsx': { kind: 'terminal', createLabel: ' ' } }, /`createLabel` must be a non-empty string/],
    ['a label that is not a string', { './TerminalNode.tsx': { kind: 'terminal', createLabel: 1 } }, /`createLabel` must be a non-empty string/],
    ['a kind that is not registered', { './OtherNode.tsx': { kind: 'other', createLabel: 'New other' } }, /OtherNode.tsx: `createLabel` needs/],
  ])('throws on %s', (_name, modules, message) => {
    expect(() => createItems(modules, types)).toThrow(message)
  })
})

describe('the Terminal Node type', () => {
  it('is registered under the kind main starts shells for, with the "New terminal" item', async () => {
    const terminal = await import('../../src/renderer/canvas/nodes/TerminalNode')
    const { nodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    expect(terminal.kind).toBe(TERMINAL_NODE_KIND)
    expect(nodeTypes.get(TERMINAL_NODE_KIND)?.Component).toBe(terminal.default)
    expect(createItems({ './TerminalNode.tsx': terminal }, nodeTypes).map((item) => item.label)).toEqual(['New terminal'])
  })
})
