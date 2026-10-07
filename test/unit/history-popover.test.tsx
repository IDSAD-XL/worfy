// Where the History popover says a Session was started (worfy-week ticket 12,
// src/renderer/session/HistoryPopover.tsx). A Session is «worfy» when worfy runs it, by the same
// rule as the sidebar (claude-home/session-nodes.ts, worfySessionIds): a Node of worfy's names it,
// or main's view of a running Session does. `sdk-cli` is `claude -p` in a terminal, never worfy's.
// A finished `sdk-ts` Session no Node names any more (an earlier conversation of the Orchestrator,
// a removed Node) stays «worfy»; a live one worfy does not run is not worfy's, as in the sidebar.
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { HistorySession } from '../../src/shared/ipc/claude-home'
import type { ProjectView } from '../../src/shared/ipc/projects'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'

const ROOT = '/Users/test/projects/demo'
const PROJECT: ProjectView = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }

const history = (sessionId: string, entrypoint: string | undefined, live = false): HistorySession => ({
  sessionId,
  title: `title of ${sessionId}`,
  ...(entrypoint === undefined ? {} : { entrypoint }),
  size: 10,
  modifiedAt: 1,
  live,
})

const node = (id: string, kind: string, data: Record<string, unknown>) => ({ id, kind, x: 0, y: 0, w: 300, h: 120, data })

let sessions: HistorySession[]
let nodes: ReturnType<typeof node>[]
let views: SessionNodeView[]

beforeEach(() => {
  vi.resetModules()
  sessions = []
  nodes = []
  views = []
  const bridge = {
    invoke: (channel: string) => {
      const value: unknown =
        channel === 'claudeHome.sessions'
          ? { live: [], history: sessions }
          : channel === 'claudeHome.live'
            ? { live: [] }
            : channel === 'layout.get'
              ? { projectId: PROJECT.id, layout: { nodes, viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 }
              : channel === 'sessions.views'
                ? { views }
                : channel === 'sessions.resumable'
                  ? { verdicts: {} }
                  : undefined
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

/**
 * Renders the popover and waits until each row's source label is the expected one. The history,
 * the Layout and main's views answer one after another; a label that never settles fails.
 */
async function expectSources(expected: Record<string, string>): Promise<void> {
  const { HistoryPopover } = await import('../../src/renderer/session/HistoryPopover')
  render(<HistoryPopover project={PROJECT} onClose={() => undefined} />)
  await screen.findAllByTestId('history-session')
  const read = () =>
    Object.fromEntries(screen.getAllByTestId('history-session').map((row) => [row.getAttribute('data-session-id'), within(row).getByTestId('history-source').textContent ?? '']))
  await vi.waitFor(() => expect(read()).toEqual(expected))
}

describe('History: where a Session was started', () => {
  it('calls a `claude -p` Session (`sdk-cli`) that worfy did not start «terminal», not «worfy»', async () => {
    sessions = [history('S-print', 'sdk-cli')]
    await expectSources({ 'S-print': 'terminal' })
  })

  it('calls «desktop» a Claude desktop Session and «terminal» a `claude` one', async () => {
    sessions = [history('S-desktop', 'claude-desktop'), history('S-cli', 'cli')]
    await expectSources({ 'S-desktop': 'desktop', 'S-cli': 'terminal' })
  })

  it('calls «worfy» a Session a Node of worfy names: a live Session Node or the Orchestrator', async () => {
    sessions = [history('S-node', 'sdk-ts'), history('S-orch', 'sdk-ts'), history('S-other', 'sdk-ts')]
    nodes = [
      node('session-live', 'session', { origin: 'worfy', sessionId: 'S-node' }),
      node('orch', 'orchestrator', { sessionId: 'S-orch' }),
      // A read-only Node of a Session started elsewhere does not make it worfy's.
      node('session-S-other', 'session', { origin: 'external', sessionId: 'S-other', source: 'terminal', cwd: ROOT }),
    ]
    await expectSources({ 'S-node': 'worfy', 'S-orch': 'worfy', 'S-other': 'terminal' })
  })

  it('calls «worfy» a Session main runs on a Session Node, by its SDK session, before the Node saved its id', async () => {
    sessions = [history('S-running', 'sdk-ts')]
    nodes = [node('session-new', 'session', { origin: 'worfy' })]
    views = [
      { projectId: PROJECT.id, nodeId: 'session-new', sessionId: 'pending-1', sdkSessionId: 'S-running', state: 'busy', error: null, cwd: ROOT, model: null, version: 1 } as SessionNodeView,
    ]
    await expectSources({ 'S-running': 'worfy' })
  })

  it('calls «worfy» a finished `sdk-ts` Session no Node names any more: an earlier Orchestrator conversation, a removed Node', async () => {
    sessions = [history('S-removed', 'sdk-ts'), history('S-print-done', 'sdk-cli'), history('S-unknown', undefined)]
    await expectSources({ 'S-removed': 'worfy', 'S-print-done': 'terminal', 'S-unknown': 'terminal' })
  })

  it('calls a live `sdk-ts` Session worfy does not run «terminal», as the sidebar does', async () => {
    sessions = [history('S-other-sdk', 'sdk-ts', true), history('S-print-live', 'sdk-cli', true)]
    await expectSources({ 'S-other-sdk': 'terminal', 'S-print-live': 'terminal' })
  })
})
