// The read-only Session view of a Session worfy started (worfy-polish ticket 75): after a restart of
// worfy, a Session Node's Session (a Product Session too) opens there while it does not run. The view
// says it is not running and offers Resume, which goes through `sessions.resume` — the path that keeps
// the Node's Vendor and kind — and then shows the live view; main's refusal shows in the view. A
// Session started in a terminal or Claude desktop keeps its old line and offers nothing. The panel is
// rendered against a fake bridge: no main process, no ~/.claude.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { readOnlyLine, worfyNodeOf } from '../../src/renderer/session/read-only-line'

const PROJECT = 'alpha-0000000a'
const ROOT = '/repo/alpha'
const SESSION = '75757575-7575-4757-8757-757575757575'
const NODE = 'node-product'

const sessionNode = (id: string, data: Record<string, unknown>) => ({ id, kind: 'session', x: 0, y: 0, w: 340, h: 220, hidden: false, locked: false, pinned: false, data })
const PRODUCT_NODE = sessionNode(NODE, { origin: 'worfy', vendor: 'claude', kind: 'product', sessionId: SESSION })
const liveView = (state: string) => ({ projectId: PROJECT, nodeId: NODE, vendor: 'claude', kind: 'product', sessionId: 'pending-1', sdkSessionId: SESSION, state, error: null, cwd: ROOT, model: null, version: 1 })

let answers: Record<string, (input: unknown) => unknown>
/** Every call the renderer made, in order. */
const asked: { channel: string; input: unknown }[] = []
const resumes = () => asked.filter((call) => call.channel === 'sessions.resume').map((call) => call.input)
let nodes: unknown[]

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  nodes = [PRODUCT_NODE]
  answers = {
    'projects.list': () => ({ projects: [{ id: PROJECT, name: 'alpha', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 }),
    'linked.state': () => ({ machines: [] }),
    'claudeHome.sessions': () => ({ live: [], history: [{ sessionId: SESSION, title: 'Roadmap talk', size: 10, modifiedAt: 0, live: false, cwd: ROOT }] }),
    'claudeHome.live': () => ({ live: [] }),
    'claudeHome.close': () => ({ closed: true }),
    'claudeHome.transcript': () => ({ found: true, events: [], reset: false, more: false, cursor: { offset: 0, fileId: null } }),
    'layout.get': () => ({ projectId: PROJECT, layout: { nodes, viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 }),
    'sessions.views': () => ({ views: [] }),
    'orchestrator.view': () => ({ view: null }),
    'sessions.resume': () => liveView('starting'),
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer(input) } : { ok: false, error: `no ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Opens the read-only view of SESSION as the sidebar does, on `nodeId`, and renders it. */
async function openReadOnly(nodeId = NODE) {
  const navigation = await import('../../src/renderer/session/navigation')
  const { ExternalSessionPanel } = await import('../../src/renderer/session/ExternalSessionPanel')
  navigation.openSession({ nodeId, projectId: PROJECT, external: { sessionId: SESSION } })
  render(<ExternalSessionPanel projectId={PROJECT} nodeId={nodeId} sessionId={SESSION} />)
  // The Layout, the history and the views answer.
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })
  return navigation
}

describe('the line under the read-only transcript (read-only-line.ts)', () => {
  it('a worfy Session that does not run offers Resume; one that runs, its live view', () => {
    expect(readOnlyLine({ subagent: false, worfy: { running: false }, desktop: false })).toEqual({ text: 'Not running — Resume to continue', action: 'resume' })
    expect(readOnlyLine({ subagent: false, worfy: { running: true }, desktop: false })).toEqual({ text: 'Running in worfy', action: 'open' })
  })

  it('a Session started in a terminal or Claude desktop keeps its line and offers nothing', () => {
    expect(readOnlyLine({ subagent: false, worfy: null, desktop: false })).toEqual({ text: 'Read-only: started in terminal', action: null })
    expect(readOnlyLine({ subagent: false, worfy: null, desktop: true })).toEqual({ text: 'Read-only: started in Claude desktop', action: null })
  })

  it("a Subagent's transcript stays read-only, of any Session", () => {
    expect(readOnlyLine({ subagent: true, worfy: { running: false }, desktop: false })).toEqual({ text: 'Read-only: Subagent transcript', action: null })
  })

  it("finds the worfy Node by the view's Node, else by the Session it names; never a Node worfy did not start", () => {
    const other = sessionNode('node-other', { origin: 'worfy', vendor: 'claude', sessionId: SESSION })
    const external = sessionNode(`session:${SESSION}`, { sessionId: SESSION, origin: 'external', source: 'terminal', cwd: ROOT })
    expect(worfyNodeOf([other, PRODUCT_NODE] as never, NODE, SESSION)?.id).toBe(NODE)
    expect(worfyNodeOf([external, PRODUCT_NODE] as never, `session:${SESSION}`, SESSION)?.id).toBe(NODE)
    expect(worfyNodeOf([external] as never, `session:${SESSION}`, SESSION)).toBeUndefined()
    expect(worfyNodeOf(undefined, NODE, SESSION)).toBeUndefined()
  })
})

describe('Resume in the read-only view of a worfy Session', () => {
  it('a Product Session that does not run says so and offers Resume, not «started in terminal»', async () => {
    await openReadOnly()
    expect(screen.getByTestId('session-read-only').textContent).toBe('Not running — Resume to continue')
    expect(screen.getByTestId('session-source').textContent).toBe(`worfy · ${ROOT}`)
    expect(screen.getByRole('button', { name: 'Resume' }).getAttribute('title')).toBe('Continue this Session in worfy')
  })

  it('Resume asks main through sessions.resume with the Session id, then shows the live view of its Node', async () => {
    const navigation = await openReadOnly()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(resumes()).toEqual([{ projectId: PROJECT, sessionId: SESSION }])
    expect(asked.some((call) => call.channel === 'sessions.start')).toBe(false)
    expect(navigation.useNavigation.getState()).toMatchObject({ view: 'session', opened: { [PROJECT]: { nodeId: NODE, projectId: PROJECT } } })
    expect(navigation.useNavigation.getState().opened[PROJECT]?.external).toBeUndefined()
  })

  it('opened by the Session id (the palette, a notification) it still finds the Node and resumes there', async () => {
    const navigation = await openReadOnly(`session:${SESSION}`)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(resumes()).toEqual([{ projectId: PROJECT, sessionId: SESSION }])
    expect(navigation.useNavigation.getState().opened[PROJECT]).toEqual({ nodeId: NODE, projectId: PROJECT })
  })

  it("main's refusal shows in the view, and the view stays read-only", async () => {
    // The fake bridge refuses a channel it has no answer for, as main refuses a Resume: with the reason.
    delete answers['sessions.resume']
    const navigation = await openReadOnly()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(screen.getByRole('alert').textContent).toBe('no sessions.resume')
    expect(navigation.useNavigation.getState().opened[PROJECT]).toEqual({ nodeId: NODE, projectId: PROJECT, external: { sessionId: SESSION } })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('a user who left the Session view meanwhile is not taken back', async () => {
    const navigation = await openReadOnly()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    act(() => navigation.setView('canvas'))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(resumes()).toHaveLength(1)
    expect(navigation.useNavigation.getState().view).toBe('canvas')
  })

  it('while worfy runs it (resumed from its Node), the line says so and Open shows the live view', async () => {
    answers['sessions.views'] = () => ({ views: [liveView('idle')] })
    const navigation = await openReadOnly()
    expect(screen.getByTestId('session-read-only').textContent).toBe('Running in worfy')
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(navigation.useNavigation.getState().opened[PROJECT]).toEqual({ nodeId: NODE, projectId: PROJECT })
  })

  it('a Session started in a terminal keeps «Read-only: started in terminal» and has no Resume', async () => {
    nodes = [sessionNode(`session:${SESSION}`, { sessionId: SESSION, origin: 'external', source: 'terminal', cwd: ROOT })]
    await openReadOnly(`session:${SESSION}`)
    expect(screen.getByTestId('session-read-only').textContent).toBe('Read-only: started in terminal')
    expect(screen.getByTestId('session-source').textContent).toBe(`terminal · ${ROOT}`)
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  it('a Session started in Claude desktop keeps «Read-only: started in Claude desktop» and has no Resume', async () => {
    nodes = [sessionNode(`session:${SESSION}`, { sessionId: SESSION, origin: 'external', source: 'desktop', cwd: ROOT })]
    await openReadOnly(`session:${SESSION}`)
    expect(screen.getByTestId('session-read-only').textContent).toBe('Read-only: started in Claude desktop')
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })
})
