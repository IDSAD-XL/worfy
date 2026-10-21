// How the minimap paints a Node (src/renderer/canvas/overlays/minimap-paint.ts; worfy-canvas
// ticket 04, ADR-0077): the fill, the outline and the classes of each kind, read from the app's own
// registry of Node types, and the stylesheet rule that keeps an outline visible at any minimap scale.
// test/e2e/minimap-kinds.spec.ts checks the same in the built app; this runs on every CI.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { minimapPaint, NO_COLOR, NODE_COLOR_DEFAULT, OUTLINE_CLASS, PINNED_CLASS } from '../../src/renderer/canvas/overlays/minimap-paint'

// The Node type modules reach main through IPC when they render; nothing renders here.
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: vi.fn(async () => ({ ok: false, error: 'not in this test' })),
  subscribe: () => () => undefined,
}))

const node = (kind: string, pinned = false): Node => ({ id: `${kind}-1`, position: { x: 0, y: 0 }, data: { node: { kind, pinned } } }) as unknown as Node

const paint = minimapPaint()
const drawn = (kind: string, pinned = false) => {
  const target = node(kind, pinned)
  return { fill: paint.fill(target), stroke: paint.stroke(target), className: paint.className(target) }
}

describe('minimap paint by kind, the app registry', () => {
  it('fills Session, Orchestrator and the Epic frame with their kind colour, with no outline', () => {
    expect(drawn('session')).toEqual({ fill: 'var(--kind-session)', stroke: NO_COLOR, className: '' })
    expect(drawn('orchestrator')).toEqual({ fill: 'var(--kind-orchestrator)', stroke: NO_COLOR, className: '' })
    expect(drawn('epic-frame')).toEqual({ fill: 'var(--kind-epic)', stroke: NO_COLOR, className: '' })
  })

  it('draws a Subagent as an outline in its kind colour, with no fill', () => {
    expect(drawn('subagent')).toEqual({ fill: NO_COLOR, stroke: 'var(--kind-subagent)', className: OUTLINE_CLASS })
  })

  it('keeps every other kind neutral: no kind colour, no outline', () => {
    for (const kind of ['ticket', 'note', 'card', 'terminal', 'handoff', 'no-such-kind']) {
      const { fill, stroke, className } = drawn(kind)
      expect(fill, kind).not.toMatch(/--kind-/)
      expect(stroke, kind).toBe(NO_COLOR)
      expect(className, kind).toBe('')
    }
    expect(drawn('note').fill).toBe('var(--border-strong)')
    // A literal, not the constant: a change of the default colour has to show here.
    expect(drawn('no-such-kind').fill).toBe('var(--text-muted)')
    expect(NODE_COLOR_DEFAULT).toBe('var(--text-muted)')
  })

  it('keeps the pinned class, alone or with the outline class', () => {
    expect(drawn('session', true).className).toBe(PINNED_CLASS)
    expect(drawn('subagent', true).className.split(' ').sort()).toEqual([OUTLINE_CLASS, PINNED_CLASS].sort())
  })
})

describe('minimap paint over another registry', () => {
  it('outlines an outlined kind whose type declares no colour in the default colour', () => {
    const own = minimapPaint(new Map([['session', { minimapColor: 'var(--kind-session)' }]]))
    expect(own.fill(node('subagent'))).toBe(NO_COLOR)
    expect(own.stroke(node('subagent'))).toBe('var(--text-muted)')
    expect(own.fill(node('session'))).toBe('var(--kind-session)')
  })
})

describe('minimap.css', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/renderer/canvas/overlays/minimap.css'), 'utf8')
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`minimap.css has no rule "${selector}"`)
    return css.slice(start, css.indexOf('}', start))
  }

  it('gives Nodes no outline but the outlined kind one in screen pixels', () => {
    expect(rule('.w-canvas .react-flow__minimap-node')).toMatch(/stroke-width:\s*0;/)
    const outline = rule(`.w-canvas .react-flow__minimap-node.${OUTLINE_CLASS}`)
    expect(outline).toMatch(/stroke-width:\s*\d+(\.\d+)?px;/)
    expect(outline).toMatch(/vector-effect:\s*non-scaling-stroke;/)
  })
})
