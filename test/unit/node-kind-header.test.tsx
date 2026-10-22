// The kind band and icon in a Node's header (worfy-canvas ticket 05, ADR-0077): Session,
// Orchestrator, Subagent and the Epic frame carry a 4 px band and an icon in their `kind-*` colour
// (a Subagent's band is dashed, in the Session's colour); Ticket, Card and Note carry neither. The
// status chip never takes a kind colour, and a finished Session is told by its opacity and the word
// in its chip, not by a hue.
//
// The finished look and the Orchestrator's double border are CSS of the Canvas (node-chrome.css):
// the tests load focus.css and then that file, in the order of the app's built bundle, and draw each Node the
// way the app holds it — in a React Flow wrapper on the Canvas, or in a focus tile. Nothing ties that
// order to the bundle, so the last describe loads the two sheets the other way round: they must not
// depend on it.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { SubagentSummary } from '../../src/renderer/canvas/sources/subagents'
import { FocusTileContext } from '../../src/renderer/focus/focus-tile'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import type { Layout } from '../../src/shared/layout/types'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

vi.mock('../../src/renderer/canvas/badges', () => ({ badges: [], actions: [] }))

const ROOT = '/Users/test/projects/demo'
const PROJECT = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }
const SESSION = 'dddddddd-0000-4000-8000-000000000005'
const LIVE_NODE = 'live-session-node'

let live: LiveSession[]
/** main's views of the live Session Node: none means its Session does not run in this run of the app. */
let views: SessionNodeView[]
/** The registry of live Sessions is not read yet: `claudeHome.sessions` and `claudeHome.live` never answer. */
let unread: boolean

const liveView = (state: SessionNodeView['state']): SessionNodeView => ({
  projectId: PROJECT.id,
  nodeId: LIVE_NODE,
  sessionId: 'live-1',
  sdkSessionId: SESSION,
  state,
  error: null,
  cwd: ROOT,
  model: null,
  version: 1,
})

const sheets: HTMLStyleElement[] = []

beforeAll(() => {
  // In the order of the built bundle (out/renderer/assets/index-*.css): focus.css comes first.
  for (const file of ['src/renderer/focus/focus.css', 'src/renderer/canvas/node-chrome.css']) {
    const style = document.createElement('style')
    style.textContent = readFileSync(join(process.cwd(), file), 'utf8')
    document.head.append(style)
    sheets.push(style)
  }
})

afterAll(() => {
  for (const style of sheets.splice(0)) style.remove()
})

beforeEach(() => {
  vi.resetModules()
  live = []
  views = []
  unread = false
  const bridge = {
    invoke: (channel: string) => {
      const value: unknown =
        channel === 'projects.list'
          ? { projects: [PROJECT], activeId: PROJECT.id, revision: 1 }
          : channel === 'claudeHome.sessions'
            ? { live, history: [] }
            : channel === 'claudeHome.live'
              ? { live }
              : channel === 'sessions.views'
                ? { views }
                : undefined
      // The Orchestrator's view never answers: its header is drawn without it.
      if (channel === 'orchestrator.view') return new Promise(() => undefined)
      if (unread && (channel === 'claudeHome.sessions' || channel === 'claudeHome.live')) return new Promise(() => undefined)
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

type Place = 'canvas' | 'canvas-selected' | 'focus'

/** A Node where the app draws it: in its React Flow wrapper on the Canvas, or in a focus tile. */
const placed = (element: ReactElement, place: Place = 'canvas') =>
  place === 'focus' ? (
    <div className="w-focus__node">
      <FocusTileContext.Provider value={true}>{element}</FocusTileContext.Provider>
    </div>
  ) : (
    <div className="w-canvas">
      <div className={place === 'canvas-selected' ? 'react-flow__node selected' : 'react-flow__node'}>{element}</div>
    </div>
  )

const inFlow = (element: ReactElement, place: Place = 'canvas') => render(<ReactFlowProvider>{placed(element, place)}</ReactFlowProvider>)
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

const expectChipWithoutKind = (node: HTMLElement) => {
  for (const paint of paintWithin(within(node).getByTestId('session-node-status'))) expect(paint).not.toContain('--kind-')
}

/** The read-only Node of SESSION, once its status chip says `status`. */
async function sessionNode(status: string, place: Place = 'canvas'): Promise<HTMLElement> {
  const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
  const data = { node: { id: `session-${SESSION}`, kind: 'session', data: { origin: 'external', sessionId: SESSION, source: 'terminal', cwd: ROOT } } }
  inFlow(<SessionNode {...propsOf(`session-${SESSION}`, data, place === 'canvas-selected')} />, place)
  // The Node is drawn again once the Project is known: wait on whichever element is there now.
  await vi.waitFor(() => expect(screen.getByTestId('session-node').getAttribute('data-status')).toBe(status))
  return screen.getByTestId('session-node')
}

/** A Node of a Session worfy runs (or ran, `saved`), once its status chip says `status`. */
async function liveSessionNode(status: string, saved: string | undefined, place: Place = 'canvas'): Promise<HTMLElement> {
  const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
  const data = { node: { id: LIVE_NODE, kind: 'session', data: saved === undefined ? { origin: 'worfy' } : { origin: 'worfy', sessionId: saved } } }
  inFlow(<SessionNode {...propsOf(LIVE_NODE, data, place === 'canvas-selected')} />, place)
  // The Node is drawn again once the Project is known: wait on whichever element is there now.
  await vi.waitFor(() => expect(screen.getByTestId('session-node').getAttribute('data-status')).toBe(status))
  return screen.getByTestId('session-node')
}

const opacityOf = (element: Element): number => {
  const value = getComputedStyle(element).opacity
  return value === '' ? 1 : Number(value)
}

describe('read-only Session Node', () => {
  it('has the band and the icon of kind-session, and is named a Session', async () => {
    live = [{ pid: 100, sessionId: SESSION, cwd: ROOT, status: 'idle', entrypoint: 'cli', name: 'wave-05' }]
    const node = await sessionNode('idle')
    expectKind(node, 'session', '--kind-session')
    expect(node.getAttribute('role')).toBe('group')
    expect(node.getAttribute('aria-label')).toBe('Session wave-05')
  })

  it('a title that already starts with "Session" is not prefixed twice', async () => {
    const node = await sessionNode('finished')
    expect(within(node).getByTestId('session-node-title').textContent).toBe('Session dddddddd')
    expect(node.getAttribute('aria-label')).toBe('Session dddddddd')
  })

  it.each([
    ['my session', 'Session my session'],
    ['Sessions overview', 'Session Sessions overview'],
    ['session-2', 'session-2'],
    ['New session', 'New session'],
  ])('a Session named %j is named %j', async (name, label) => {
    live = [{ pid: 100, sessionId: SESSION, cwd: ROOT, status: 'idle', entrypoint: 'cli', name }]
    const node = await sessionNode('idle')
    expect(node.getAttribute('aria-label')).toBe(label)
  })

  it('before the registry of live Sessions is read: a neutral chip, not finished', async () => {
    unread = true
    const node = await sessionNode('…')
    expect(node.dataset.finished).toBeUndefined()
    expect(opacityOf(node)).toBe(1)
    expectChipWithoutKind(node)
  })

  it('a running Session: full opacity, a status chip without any kind colour', async () => {
    live = [{ pid: 100, sessionId: SESSION, cwd: ROOT, status: 'busy', entrypoint: 'cli' }]
    const node = await sessionNode('busy')
    expectChipWithoutKind(node)
    expect(node.dataset.finished).toBeUndefined()
    expect(opacityOf(node)).toBe(1)
  })

  it('a finished Session on the Canvas: 60 % opacity and the word «finished» in its chip, no kind colour on the chip', async () => {
    const node = await sessionNode('finished')
    expect(node.dataset.finished).toBe('true')
    expect(opacityOf(node)).toBe(0.6)
    expect(within(node).getByTestId('session-node-status').textContent).toBe('finished')
    expectChipWithoutKind(node)
    expectKind(node, 'session', '--kind-session')
  })

  it('a selected finished Session is back at full opacity', async () => {
    const node = await sessionNode('finished', 'canvas-selected')
    expect(opacityOf(node)).toBe(1)
  })

  it('a finished Session in a focus tile is at full opacity', async () => {
    const node = await sessionNode('finished', 'focus')
    expect(within(node).getByTestId('session-node-status').textContent).toBe('finished')
    expect(opacityOf(node)).toBe(1)
  })
})

describe('live Session Node (a Session worfy runs)', () => {
  it('running: the band and the icon of kind-session, its name, full opacity, a chip without kind colour', async () => {
    views = [liveView('idle')]
    const node = await liveSessionNode('idle', SESSION)
    expectKind(node, 'session', '--kind-session')
    expect(node.getAttribute('role')).toBe('group')
    expect(node.getAttribute('aria-label')).toBe('Session dddddddd')
    expect(node.dataset.finished).toBeUndefined()
    expect(opacityOf(node)).toBe(1)
    expectChipWithoutKind(node)
  })

  it('a new Node whose Session never ran is not finished', async () => {
    const node = await liveSessionNode('new', undefined)
    expect(node.getAttribute('aria-label')).toBe('New session')
    expect(node.dataset.finished).toBeUndefined()
    expect(opacityOf(node)).toBe(1)
  })

  it('finished (its Session does not run in this run of the app): 60 % opacity on the Canvas, «finished» in its chip', async () => {
    const node = await liveSessionNode('finished', SESSION)
    expect(node.dataset.finished).toBe('true')
    expect(opacityOf(node)).toBe(0.6)
    expectChipWithoutKind(node)
  })

  it('closed (main ended its Session): finished, as when it does not run', async () => {
    views = [liveView('closed')]
    const node = await liveSessionNode('finished', SESSION)
    expect(node.dataset.finished).toBe('true')
    expect(opacityOf(node)).toBe(0.6)
  })

  it('finished and selected: full opacity', async () => {
    const selected = await liveSessionNode('finished', SESSION, 'canvas-selected')
    expect(opacityOf(selected)).toBe(1)
  })

  it('finished in a focus tile: full opacity', async () => {
    const node = await liveSessionNode('finished', SESSION, 'focus')
    expect(opacityOf(node)).toBe(1)
  })
})

describe('Orchestrator Node header', () => {
  const mount = async (place: Place) => {
    const { default: OrchestratorNode } = await import('../../src/renderer/canvas/nodes/OrchestratorNode')
    inFlow(<OrchestratorNode {...propsOf('orch', { node: { data: {} } })} />, place)
    return screen.getByTestId('orchestrator-node')
  }

  it('on the Canvas: the band and the icon of kind-orchestrator, a double border, named the Orchestrator', async () => {
    const node = await mount('canvas')
    expectKind(node, 'orchestrator', '--kind-orchestrator')
    expect(node.getAttribute('role')).toBe('group')
    expect(node.getAttribute('aria-label')).toBe('Orchestrator')
    expect(getComputedStyle(node).borderStyle).toBe('double')
    expect(getComputedStyle(node).borderWidth).toBe('3px')
    for (const paint of paintWithin(within(node).getByTestId('orchestrator-state'))) expect(paint).not.toContain('--kind-')
  })

  it('in a focus tile: no double border inside the tile frame', async () => {
    const node = await mount('focus')
    expectKind(node, 'orchestrator', '--kind-orchestrator')
    expect(getComputedStyle(node).borderStyle).not.toBe('double')
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

describe('the kind colours of the Node files', () => {
  it('no Node file names a kind-* colour itself: each takes its band and tint from KIND (kind-colours.ts)', () => {
    const dir = join(process.cwd(), 'src/renderer/canvas/nodes')
    const files = readdirSync(dir).filter((file) => file.endsWith('.tsx'))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(/var\(--kind-/)
  })

  it('each kind with a colour shows on the minimap in its band colour', async () => {
    const { collectNodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    const types = collectNodeTypes({
      'OrchestratorNode.tsx': await import('../../src/renderer/canvas/nodes/OrchestratorNode'),
      'SessionNode.tsx': await import('../../src/renderer/canvas/nodes/SessionNode'),
      'SubagentNode.tsx': await import('../../src/renderer/canvas/nodes/SubagentNode'),
      'EpicFrameNode.tsx': await import('../../src/renderer/canvas/nodes/EpicFrameNode'),
    })
    expect(Object.fromEntries([...types].map(([kind, type]) => [kind, type.minimapColor]))).toEqual({
      orchestrator: 'var(--kind-orchestrator)',
      session: 'var(--kind-session)',
      subagent: 'var(--kind-subagent)',
      'epic-frame': 'var(--kind-epic)',
    })
  })

  it('a type file with a kind colour that is not one, or with a minimap colour of its own too, is a programming error', async () => {
    const { collectNodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    const Component = () => null
    expect(() => collectNodeTypes({ 'XNode.tsx': { default: Component, kind: 'x', kindColour: 'teal' } })).toThrow(/kindColour/)
    expect(() => collectNodeTypes({ 'XNode.tsx': { default: Component, kind: 'x', kindColour: 'session', minimapColor: 'red' } })).toThrow(/minimapColor/)
  })
})

// The tests above load focus.css before node-chrome.css, as the built bundle has them. Nothing ties
// that order to the bundle, so the two sheets must not depend on it: here node-chrome.css comes first.
describe('node-chrome.css and focus.css in the other order', () => {
  beforeAll(() => {
    document.head.append(sheets[0]!)
  })
  afterAll(() => {
    document.head.append(sheets[1]!)
  })

  it('the sheets are in the other order', () => {
    const styles = Array.from(document.head.querySelectorAll('style'))
    expect(styles.indexOf(sheets[1]!)).toBeLessThan(styles.indexOf(sheets[0]!))
  })

  it('the Orchestrator has its double border on the Canvas and none in a focus tile', async () => {
    const { default: OrchestratorNode } = await import('../../src/renderer/canvas/nodes/OrchestratorNode')
    inFlow(<OrchestratorNode {...propsOf('orch', { node: { data: {} } })} />)
    expect(getComputedStyle(screen.getByTestId('orchestrator-node')).borderStyle).toBe('double')
    inFlow(<OrchestratorNode {...propsOf('orch-tile', { node: { data: {} } })} />, 'focus')
    const [, tile] = screen.getAllByTestId('orchestrator-node')
    expect(getComputedStyle(tile!).borderStyle).not.toBe('double')
  })

  it('a finished Session is at 60 % opacity on the Canvas', async () => {
    expect(opacityOf(await sessionNode('finished'))).toBe(0.6)
  })

  it('a finished Session in a focus tile is at full opacity', async () => {
    expect(opacityOf(await sessionNode('finished', 'focus'))).toBe(1)
  })
})
