// Who gets a wheel over a Node (src/renderer/canvas/wheel-router.ts, worfy-week ticket 16): every
// branch of the rule, over plain objects that stand in for the elements of each Node type.
import { describe, expect, it } from 'vitest'
import { routeWheel, type WheelElement, type WheelInput } from '../../src/renderer/canvas/wheel-router'

interface Spec {
  classes?: string
  /** Content taller than the box: something to scroll. */
  overflowY?: boolean
  /** Content wider than the box. */
  overflowX?: boolean
}

/** A chain of elements, outermost first; answers the innermost, where the wheel lands. */
function chain(...specs: Spec[]): WheelElement {
  let parent: WheelElement | null = null
  for (const spec of specs) {
    const classes = new Set((spec.classes ?? '').split(' ').filter(Boolean))
    parent = {
      classList: { contains: (name: string) => classes.has(name) },
      parentElement: parent,
      clientHeight: 100,
      scrollHeight: spec.overflowY === true ? 400 : 100,
      clientWidth: 100,
      scrollWidth: spec.overflowX === true ? 400 : 100,
      getAttribute: () => null,
    }
  }
  if (parent === null) throw new Error('empty chain')
  return parent
}

const CANVAS: Spec[] = [{ classes: 'w-canvas' }, { classes: 'react-flow' }, { classes: 'react-flow__renderer' }, { classes: 'react-flow__viewport' }]
const NODE: Spec = { classes: 'react-flow__node' }

/** The Nodes whose content is `.nowheel`, as their components draw them. */
const handoff = (overflowY: boolean) => chain(...CANVAS, NODE, { classes: 'w-node-surface' }, { classes: 'nodrag nowheel', overflowY }, { classes: 'w-markdown' }, {})
const note = (overflowY: boolean) => chain(...CANVAS, NODE, { classes: 'w-node-surface w-note' }, { classes: 'w-note__text nodrag nowheel', overflowY })
const session = (overflowY: boolean) => chain(...CANVAS, NODE, { classes: 'w-node-surface' }, { classes: 'w-mono nodrag nowheel', overflowY })
const orchestratorBlock = (overflowY: boolean) =>
  chain(...CANVAS, NODE, { classes: 'w-node-surface' }, { classes: 'w-mono nodrag nowheel', overflowY }, {})
/** xterm.js draws its rows inside the screen; the rows themselves never overflow. */
const terminal = () => chain(...CANVAS, NODE, { classes: 'w-node-surface w-terminal' }, { classes: 'w-terminal__screen nodrag nowheel nopan nokey' }, { classes: 'xterm' }, { classes: 'xterm-rows' })

const wheel = (target: WheelElement | null, keys: Partial<Pick<WheelInput, 'ctrlKey' | 'metaKey'>> = {}): WheelInput => ({
  target,
  ctrlKey: keys.ctrlKey ?? false,
  metaKey: keys.metaKey ?? false,
})
const active = () => true
const inactive = () => false

describe('routeWheel', () => {
  it('leaves a wheel over the plane, outside every Node, to React Flow', () => {
    expect(routeWheel(wheel(chain(...CANVAS, { classes: 'react-flow__pane' })), active)).toBe('pass')
    expect(routeWheel(wheel(chain(...CANVAS, { classes: 'react-flow__pane' }), { ctrlKey: true }), active)).toBe('pass')
  })

  it('leaves a wheel with no target to React Flow', () => {
    expect(routeWheel(wheel(null), active)).toBe('pass')
  })

  it('leaves a wheel over a `.nowheel` overlay, which is not inside a Node, to React Flow', () => {
    expect(routeWheel(wheel(chain(...CANVAS.slice(0, 2), { classes: 'w-session-nodes nowheel', overflowY: true }, {})), inactive)).toBe('pass')
  })

  it('leaves a wheel over a Node part without `.nowheel` (a header, a Ticket) to React Flow, active or not', () => {
    const header = chain(...CANVAS, NODE, { classes: 'w-node-surface' }, { classes: 'w-note__header' })
    expect(routeWheel(wheel(header), inactive)).toBe('pass')
    expect(routeWheel(wheel(header), active)).toBe('pass')
  })

  it('stops looking for `.nowheel` at the Node: one outside the Node does not count', () => {
    const inNowheelWrapper = chain({ classes: 'nowheel', overflowY: true }, ...CANVAS, NODE, { classes: 'w-node-surface' }, {})
    expect(routeWheel(wheel(inNowheelWrapper), active)).toBe('pass')
  })

  describe('before a click: every Node with `.nowheel` content gives the wheel to the Canvas', () => {
    for (const [name, target] of [
      ['HANDOFF', handoff(true)],
      ['Note', note(true)],
      ['Session', session(true)],
      ['Orchestrator', orchestratorBlock(false)],
      ['Terminal', terminal()],
    ] as const) {
      it(name, () => {
        expect(routeWheel(wheel(target), inactive)).toBe('canvas')
      })
    }
  })

  describe('a pinch (ctrlKey) and ⌘ + wheel zoom the Canvas even over an active Node', () => {
    for (const [name, target] of [
      ['HANDOFF', handoff(true)],
      ['Note', note(true)],
      ['Session', session(true)],
      ['Terminal', terminal()],
    ] as const) {
      it(name, () => {
        expect(routeWheel(wheel(target, { ctrlKey: true }), active)).toBe('canvas')
        expect(routeWheel(wheel(target, { metaKey: true }), active)).toBe('canvas')
      })
    }
  })

  describe('an active Node with content to scroll keeps the wheel', () => {
    it('HANDOFF', () => expect(routeWheel(wheel(handoff(true)), active)).toBe('content'))
    it('Note', () => expect(routeWheel(wheel(note(true)), active)).toBe('content'))
    // The Session answer is a `.nowheel` <pre>, the same path as HANDOFF; the e2e test has no Session.
    it('Session', () => expect(routeWheel(wheel(session(true)), active)).toBe('content'))
    it('content wider than its box', () => {
      const wide = chain(...CANVAS, NODE, { classes: 'w-node-surface' }, { classes: 'nowheel', overflowX: true }, {})
      expect(routeWheel(wheel(wide), active)).toBe('content')
    })
  })

  describe('an active Node with nothing to scroll gives the wheel to the Canvas', () => {
    it('Orchestrator status block', () => expect(routeWheel(wheel(orchestratorBlock(false)), active)).toBe('canvas'))
    it('HANDOFF with a short file', () => expect(routeWheel(wheel(handoff(false)), active)).toBe('canvas'))
    it('Session with a short answer', () => expect(routeWheel(wheel(session(false)), active)).toBe('canvas'))
  })

  it('an active Terminal keeps the wheel although its screen does not overflow: xterm.js scrolls or sends keys', () => {
    expect(routeWheel(wheel(terminal()), active)).toBe('content')
  })

  it('reads the nearest `.nowheel`: an inner box with nothing to scroll inside an outer one that overflows goes to the Canvas', () => {
    const nested = chain(...CANVAS, NODE, { classes: 'nowheel', overflowY: true }, { classes: 'nowheel' }, {})
    expect(routeWheel(wheel(nested), active)).toBe('canvas')
  })

  it('asks about the Node element the wheel is over', () => {
    const seen: WheelElement[] = []
    const target = handoff(true)
    routeWheel(wheel(target), (node) => {
      seen.push(node)
      return false
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.classList.contains('react-flow__node')).toBe(true)
  })
})
