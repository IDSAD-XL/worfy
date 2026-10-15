// The way back from a Subagent's window (worfy-polish ticket 25): the arrow in its header and the
// "of <Session>" link lead to its parent — the Session, or the Subagent that started it — not to
// where the window was opened from. A Session worfy runs opens live; any other Session, and a
// worfy Session that no longer runs, opens read-only from its transcript. ⌘[ (Ctrl+[ elsewhere) is
// the arrow's key. The panel is rendered against a fake bridge: no main process, no ~/.claude.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SubagentFile } from '../../src/shared/transcript/subagents'

const PROJECT = 'alpha-0000000a'
const ROOT = '/repo/alpha'
const SESSION = '77777777-7777-4777-8777-777777777777'
const ORCH = 'orch'

const file = (agentId: string, meta: Record<string, unknown>): SubagentFile => ({
  agentId,
  meta,
  transcript: true,
  firstAt: null,
  lastAt: null,
  model: 'sonnet',
  finalText: null,
  ended: false,
  signals: [],
  workflow: null,
})

/** impl-09 is the Session's own Subagent; scout-1 is one impl-09 started. */
const FILES = [file('aimpl', { agentType: 'worfy:implementer', name: 'impl-09' }), file('ascout', { agentType: 'scout', name: 'scout-1', parentAgentId: 'aimpl' })]

let answers: Record<string, (input: unknown) => unknown>

beforeEach(() => {
  vi.resetModules()
  answers = {
    'projects.list': () => ({ projects: [{ id: PROJECT, name: 'alpha', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 }),
    'linked.state': () => ({ machines: [] }),
    'claudeHome.sessions': () => ({ live: [], history: [{ sessionId: SESSION, title: 'Wave 3', size: 10, modifiedAt: 0, live: false }] }),
    'claudeHome.live': () => ({ live: [] }),
    'claudeHome.close': () => ({ closed: true }),
    'claudeHome.subagents': () => ({ found: true, signals: [], files: FILES }),
    'claudeHome.subagentTranscript': () => ({ found: true, events: [], reset: false, more: false, cursor: { offset: 0, fileId: null } }),
    'layout.get': () => ({ projectId: PROJECT, layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 }),
    'sessions.views': () => ({ views: [] }),
    // The Orchestrator runs the Session the Subagents belong to.
    'orchestrator.view': (input) =>
      (input as { nodeId: string }).nodeId === ORCH
        ? {
            view: { projectId: PROJECT, nodeId: ORCH, sessionId: SESSION, state: 'idle', error: null, model: 'claude-opus-5-5', costUsd: 0, statusBlock: null, version: 1 },
          }
        : { view: null },
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
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

async function openSubagent(agentId: string, nodeId = ORCH) {
  const navigation = await import('../../src/renderer/session/navigation')
  const { ExternalSessionPanel } = await import('../../src/renderer/session/ExternalSessionPanel')
  navigation.openSession({ nodeId, projectId: PROJECT, external: { sessionId: SESSION, agentId } })
  render(<ExternalSessionPanel projectId={PROJECT} nodeId={nodeId} sessionId={SESSION} agentId={agentId} />)
  return navigation
}

describe('the way back from a Subagent window', () => {
  it('a Subagent opened from the Orchestrator rail has "Back to <Session>", and a click opens the Orchestrator Session view', async () => {
    const navigation = await openSubagent('aimpl')
    const back = await screen.findByRole('button', { name: 'Back to Wave 3' })
    // The Orchestrator's view is asked for: the button leads to the live Session once it is known.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(back.getAttribute('title')).toBe('Back to Wave 3 (⌘[)')
    fireEvent.click(back)
    expect(navigation.useNavigation.getState()).toEqual({ view: 'session', opened: { nodeId: ORCH, projectId: PROJECT } })
  })

  it('a nested Subagent goes back to the window of the Subagent that started it', async () => {
    const navigation = await openSubagent('ascout')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Subagent impl-09' }))
    expect(navigation.useNavigation.getState()).toEqual({ view: 'session', opened: { nodeId: ORCH, projectId: PROJECT, external: { sessionId: SESSION, agentId: 'aimpl' } } })
  })

  it('the "of <Session>" link of a nested Subagent goes to the Session itself', async () => {
    const navigation = await openSubagent('ascout')
    await screen.findByRole('button', { name: 'Back to Subagent impl-09' })
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    fireEvent.click(screen.getByRole('link', { name: 'Wave 3' }))
    expect(navigation.useNavigation.getState()).toEqual({ view: 'session', opened: { nodeId: ORCH, projectId: PROJECT } })
  })

  it('a Subagent of a Session outside worfy goes back to that Session read-only', async () => {
    const navigation = await openSubagent('aimpl', 'claude-session:7777')
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Wave 3' }))
    expect(navigation.useNavigation.getState()).toEqual({ view: 'session', opened: { nodeId: 'claude-session:7777', projectId: PROJECT, external: { sessionId: SESSION } } })
  })

  const nodeView = (state: string) => ({ projectId: PROJECT, nodeId: 'node-s', sessionId: 'pending-1', sdkSessionId: SESSION, state, error: null, cwd: ROOT, model: null, version: 1 })

  it('a Subagent of a worfy Session Node that runs goes back to it live', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView('idle')] })
    const navigation = await openSubagent('aimpl', 'node-s')
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Wave 3' }))
    expect(navigation.useNavigation.getState().opened).toEqual({ nodeId: 'node-s', projectId: PROJECT })
  })

  it('a Subagent of a worfy Session Node that no longer runs goes back to its transcript read-only', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView('closed')] })
    const navigation = await openSubagent('aimpl', 'node-s')
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Wave 3' }))
    expect(navigation.useNavigation.getState().opened).toEqual({ nodeId: 'node-s', projectId: PROJECT, external: { sessionId: SESSION } })
  })

  it('⌘[ goes back while the Session view is shown, and does nothing over the Canvas', async () => {
    const navigation = await openSubagent('ascout')
    await screen.findByRole('button', { name: 'Back to Subagent impl-09' })
    act(() => navigation.setView('canvas'))
    fireEvent.keyDown(window, { key: '[', code: 'BracketLeft', metaKey: true })
    expect(navigation.useNavigation.getState().opened?.external?.agentId).toBe('ascout')
    act(() => navigation.setView('session'))
    // Ctrl+[ is not the key on macOS.
    fireEvent.keyDown(window, { key: '[', code: 'BracketLeft', ctrlKey: true })
    expect(navigation.useNavigation.getState().opened?.external?.agentId).toBe('ascout')
    fireEvent.keyDown(window, { key: '[', code: 'BracketLeft', metaKey: true })
    expect(navigation.useNavigation.getState().opened?.external?.agentId).toBe('aimpl')
  })

  it('the window of a Session (not a Subagent) has no back arrow', async () => {
    const { ExternalSessionPanel } = await import('../../src/renderer/session/ExternalSessionPanel')
    answers['claudeHome.transcript'] = () => ({ found: true, events: [], reset: false, more: false, cursor: { offset: 0, fileId: null } })
    render(<ExternalSessionPanel projectId={PROJECT} nodeId="claude-session:7777" sessionId={SESSION} />)
    await screen.findByText('terminal')
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull()
  })
})

describe('the parent of a Subagent (navigation.ts)', () => {
  it('is the parent Subagent, else the live Session, else the Session read-only', async () => {
    const { subagentParent, subagentSession } = await import('../../src/renderer/session/navigation')
    const at = { nodeId: 'n', projectId: PROJECT, sessionId: SESSION }
    expect(subagentParent(at, 'aimpl', true)).toEqual({ nodeId: 'n', projectId: PROJECT, external: { sessionId: SESSION, agentId: 'aimpl' } })
    expect(subagentParent(at, null, true)).toEqual({ nodeId: 'n', projectId: PROJECT })
    expect(subagentParent(at, null, false)).toEqual({ nodeId: 'n', projectId: PROJECT, external: { sessionId: SESSION } })
    expect(subagentSession(at, false)).toEqual({ nodeId: 'n', projectId: PROJECT, external: { sessionId: SESSION } })
  })

  it('openOrchestrator shows the Session view with nothing opened: the view shows the active Project’s Orchestrator', async () => {
    const navigation = await import('../../src/renderer/session/navigation')
    navigation.openSession({ nodeId: 'n', projectId: PROJECT, external: { sessionId: SESSION, agentId: 'aimpl' } })
    navigation.setView('canvas')
    navigation.openOrchestrator()
    expect(navigation.useNavigation.getState()).toEqual({ view: 'session', opened: null })
  })
})
