// The kind band and icon in a Node's header (worfy-canvas ticket 05, ADR-0077): Session,
// Orchestrator, Subagent and the Epic frame carry a 4 px band and an icon in their `kind-*` colour
// (a Subagent's band is dashed, in the Session's colour); Ticket, Card and Note carry neither. The
// status chip never takes a kind colour, and a finished Session is told by its opacity and the word
// in its chip, not by a hue.
import { render, screen, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { SubagentSummary } from '../../src/renderer/canvas/sources/subagents'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import type { Layout } from '../../src/shared/layout/types'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

vi.mock('../../src/renderer/canvas/badges', () => ({ badges: [], actions: [] }))

const ROOT = '/Users/test/projects/demo'
const PROJECT = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }
const SESSION = 'dddddddd-0000-4000-8000-000000000005'

let live: LiveSession[]

beforeEach(() => {
  vi.resetModules()
  live = []
  const bridge = {
    invoke: (channel: string) => {
      const value: unknown =
        channel === 'projects.list'
          ? { projects: [PROJECT], activeId: PROJECT.id, revision: 1 }
          : channel === 'claudeHome.sessions'
            ? { live, history: [] }
            : channel === 'claudeHome.live'
              ? { live }
              : undefined
      // The Orchestrator's view never answers: its header is drawn without it.
      if (channel === 'orchestrator.view') return new Promise(() => undefined)
      return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const inFlow = (element: ReactElement) => render(<ReactFlowProvider>{element}</ReactFlowProvider>)
const propsOf = (id: string, data: unknown, selected = false) => ({ id, data, selected }) as unknown as CanvasNodeProps

/** Every place an element's own paint could name a colour: its inline style and its computed style. */
function paintOf(element: Element): string {
  const computed = getComputedStyle(element)
  const values: string[] = [element.getAttribute('style') ?? '']
  for (let index = 0; index < computed.length; index += 1) {
    const name = computed.item(index)
    values.push(`${name}: ${computed.getPropertyValue(name)}`)
  }
  return values.join('; ')
}

/** The paint of an element and of everything inside it. */
const paintWithin = (element: Element): string[] => [element, ...Array.from(element.querySelectorAll('*'))].map(paintOf)

function expectKind(node: HTMLElement, kind: string, colour: string) {
  const band = within(node).getByTestId('kind-band')
  expect(band.dataset.kind).toBe(kind)
  expect(paintOf(band)).toContain(`var(${colour})`)
  const icon = within(node).getByTestId('kind-icon')
  expect(icon.dataset.kind).toBe(kind)
  expect(icon.getAttribute('aria-hidden')).toBe('true')
  expect(paintOf(icon)).toContain(`var(${colour})`)
}

function expectNoKind(node: HTMLElement) {
  expect(within(node).queryByTestId('kind-band')).toBeNull()
  expect(within(node).queryByTestId('kind-icon')).toBeNull()
  for (const paint of paintWithin(node)) expect(paint).not.toContain('--kind-')
}

/** The read-only Node of SESSION, once its status chip says `status`. */
async function sessionNode(status: string, selected = false): Promise<HTMLElement> {
  const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
  const data = { node: { id: `session-${SESSION}`, kind: 'session', data: { origin: 'external', sessionId: SESSION, source: 'terminal', cwd: ROOT } } }
  inFlow(<SessionNode {...propsOf(`session-${SESSION}`, data, selected)} />)
  const node = await screen.findByTestId('session-node')
  await vi.waitFor(() => expect(node.getAttribute('data-status')).toBe(status))
  return node
}

const opacityOf = (element: Element): number => {
  const value = getComputedStyle(element).opacity
  return value === '' ? 1 : Number(value)
}

describe('Session Node header', () => {
  it('has the band and the icon of kind-session, and is named a Session', async () => {
    live = [{ pid: 100, sessionId: SESSION, cwd: ROOT, status: 'idle', entrypoint: 'cli' }]
    const node = await sessionNode('idle')
    expectKind(node, 'session', '--kind-session')
    expect(node.getAttribute('aria-label')).toMatch(/^Session /)
  })

  it('a status chip without any kind colour', async () => {
    live = [{ pid: 100, sessionId: SESSION, cwd: ROOT, status: 'busy', entrypoint: 'cli' }]
    const node = await sessionNode('busy')
    const status = within(node).getByTestId('session-node-status')
    for (const paint of paintWithin(status)) expect(paint).not.toContain('--kind-')
    expect(opacityOf(node)).toBe(1)
  })

  it('a finished Session: lower opacity and the word «finished» in its chip, no kind colour on the chip', async () => {
    const node = await sessionNode('finished')
    expect(opacityOf(node)).toBeLessThan(1)
    expect(opacityOf(node)).toBeGreaterThan(0.4)
    const status = within(node).getByTestId('session-node-status')
    expect(status.textContent).toBe('finished')
    for (const paint of paintWithin(status)) expect(paint).not.toContain('--kind-')
    expectKind(node, 'session', '--kind-session')
  })

  it('a selected finished Session is back at full opacity', async () => {
    const node = await sessionNode('finished', true)
    expect(opacityOf(node)).toBe(1)
  })
})

describe('Orchestrator Node header', () => {
  it('has the band and the icon of kind-orchestrator, a double border, and is named the Orchestrator', async () => {
    const { default: OrchestratorNode } = await import('../../src/renderer/canvas/nodes/OrchestratorNode')
    inFlow(<OrchestratorNode {...propsOf('orch', { node: { data: {} } })} />)
    const node = screen.getByTestId('orchestrator-node')
    expectKind(node, 'orchestrator', '--kind-orchestrator')
    expect(node.getAttribute('aria-label')).toBe('Orchestrator')
    expect(node.classList.contains('w-node-surface--double')).toBe(true)
    for (const paint of paintWithin(within(node).getByTestId('orchestrator-state'))) expect(paint).not.toContain('--kind-')
  })
})

describe('Subagent Node header', () => {
  it('has a dashed band and the icon in the Session colour, and is named a Subagent', async () => {
    const { default: SubagentNode } = await import('../../src/renderer/canvas/nodes/SubagentNode')
    const agent: SubagentSummary = {
      id: 'toolu_05',
      agentId: 'a05',
      toolUseId: 'toolu_05',
      parentAgentId: null,
      name: 'impl-05',
      subagentType: 'implementer',
      model: 'claude-sonnet-5',
      description: null,
      status: 'running',
      background: true,
      startedAt: 0,
      durationMs: null,
      summary: null,
      verdict: null,
      depth: 1,
      transcript: true,
      childCount: 0,
    }
    const data = { node: { id: 'sub', kind: 'subagent', data: { variant: 'agent', projectId: PROJECT.id, sessionId: SESSION, sessionNodeId: 'session', agent } } }
    inFlow(<SubagentNode {...propsOf('sub', data)} />)
    const node = screen.getByTestId('subagent-node')
    expectKind(node, 'subagent', '--kind-subagent')
    expect(paintOf(within(node).getByTestId('kind-band'))).toContain('dashed')
    expect(node.getAttribute('aria-label')).toBe('Subagent impl-05')
    for (const paint of paintWithin(within(node).getByTestId('subagent-status'))) expect(paint).not.toContain('--kind-')
  })
})

function ticket(num: number): Ticket {
  return {
    epic: 'a',
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
  }
}

async function epicNodes(): Promise<readonly CanvasFlowNode[]> {
  const { buildEpicNodes } = await import('../../src/renderer/canvas/sources/epics')
  const model: WorkflowModel = { root: '/repo', epics: [{ epic: 'a', hasSpec: true, hasMap: false, title: 'a title' }], tickets: [ticket(1)], error: null, branchErrors: [] }
  const layout: Layout = { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
  return buildEpicNodes('kind-0000000a', '/repo', model, layout, {})
}

describe('Epic frame header', () => {
  it('has the band and the icon of kind-epic', async () => {
    const { default: EpicFrameNode } = await import('../../src/renderer/canvas/nodes/EpicFrameNode')
    const { epicNodeId } = await import('../../src/renderer/canvas/sources/epics')
    const frame = (await epicNodes()).find((node) => node.id === epicNodeId('a'))!
    inFlow(<EpicFrameNode {...propsOf(frame.id, frame.data)} />)
    expectKind(screen.getByTestId('epic-frame'), 'epic', '--kind-epic')
  })
})

describe('neutral kinds', () => {
  it('a Ticket has no band and no icon', async () => {
    const { default: TicketNode } = await import('../../src/renderer/canvas/nodes/TicketNode')
    const { ticketNodeId } = await import('../../src/renderer/canvas/sources/epics')
    const node = (await epicNodes()).find((each) => each.id === ticketNodeId('a', 1))!
    const { container } = inFlow(<TicketNode {...propsOf(node.id, node.data)} />)
    expect(container.textContent).toContain('Ticket 1')
    expectNoKind(container as HTMLElement)
  })

  it('a Note has no band and no icon', async () => {
    const { default: NoteNode } = await import('../../src/renderer/canvas/nodes/NoteNode')
    const { container } = inFlow(<NoteNode {...propsOf('note', { node: { data: { text: 'a note' } } })} />)
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeTruthy()
    expectNoKind(container as HTMLElement)
  })

  it('a Card has no band and no icon', async () => {
    const { default: CardNode } = await import('../../src/renderer/canvas/nodes/CardNode')
    const { container } = inFlow(<CardNode {...propsOf('card', { node: { id: 'card', kind: 'card', data: { cardId: 'c0000001' } } })} />)
    await vi.waitFor(() => expect(container.firstElementChild).not.toBeNull())
    expectNoKind(container as HTMLElement)
  })
})
