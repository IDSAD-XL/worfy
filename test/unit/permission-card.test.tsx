// The renderer's side of permission requests (ticket 21): the card in the transcript
// (session/PermissionCard.tsx through rows/PermissionRequest.tsx), the "Needs permission" badge on
// a Session Node (canvas/badges/NeedsPermission.tsx), and where a clicked notification opens
// (session/notification-target.ts). Against a fake bridge.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'

type Request = Extract<AgentEvent, { type: 'permission_request' }>

const COMMAND = 'git push origin fix/09-bid-race && echo "a long tail that must stay visible to the very end"'

const request = (overrides: Partial<Request> = {}): Request => ({
  type: 'permission_request',
  requestId: 'req-1',
  toolName: 'Bash',
  toolUseId: 'toolu_1',
  input: { command: COMMAND, description: 'Push the branch' },
  title: null,
  description: 'Push the branch',
  blockedPath: null,
  alwaysAllow: true,
  suggestions: [],
  ...overrides,
})

const nodeView = (overrides: Partial<SessionNodeView> = {}): SessionNodeView => ({
  projectId: 'alpha',
  nodeId: 'node-7',
  sessionId: 'sdk-7',
  sdkSessionId: 'sdk-7',
  state: 'needs_permission',
  error: null,
  cwd: '/Users/test/alpha',
  model: null,
  version: 1,
  ...overrides,
})

const asked: { channel: string; input: unknown }[] = []
const handlers = new Map<string, (payload: unknown) => void>()
let answers: Record<string, (input: unknown) => unknown>

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  handlers.clear()
  answers = {
    'agent.permission': () => ({ answered: true }),
    'sessions.views': () => ({ views: [] }),
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer(input) } : { ok: false, error: `no ${channel}` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, handler)
      return handlers.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const emit = (sessionId: string, event: AgentEvent) => act(() => handlers.get('agent.event')?.({ sessionId, event }))

async function renderTranscript(events: AgentEvent[], sessionId: string | null = 's1') {
  const { Transcript } = await import('../../src/renderer/session/Transcript')
  return render(<Transcript events={events} sessionId={sessionId} />)
}

describe('the permission card', () => {
  it('shows the tool and the whole Bash command monospaced, with Allow / Always allow / Deny', async () => {
    await renderTranscript([request()])
    const card = screen.getByTestId('permission-card')
    expect(within(card).getByTestId('permission-tool').textContent).toBe('Bash')
    const input = within(card).getByTestId('permission-input')
    expect(input.textContent).toBe(COMMAND)
    expect(input.className).toContain('w-mono')
    expect(within(card).getByText('Push the branch')).toBeTruthy()
    expect(within(card).getByTestId('permission-allow').textContent).toBe('Allow')
    expect(within(card).getByTestId('permission-always-allow').textContent).toBe('Always allow')
    expect(within(card).getByTestId('permission-deny').textContent).toBe('Deny')
  })

  it.each([
    ['permission-allow', 'allow'],
    ['permission-always-allow', 'always_allow'],
    ['permission-deny', 'deny'],
  ])('%s answers %s for this request of this Session', async (testId, decision) => {
    await renderTranscript([request()])
    await act(async () => {
      fireEvent.click(screen.getByTestId(testId))
      await Promise.resolve()
    })
    expect(asked.filter((each) => each.channel === 'agent.permission')).toEqual([{ channel: 'agent.permission', input: { sessionId: 's1', requestId: 'req-1', decision } }])
  })

  it('says how the request was resolved and drops its buttons', async () => {
    const { useSessionLog } = await import('../../src/renderer/session/store')
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    function Live() {
      const log = useSessionLog('s1')
      return <Transcript events={log.events} sessionId="s1" />
    }
    render(<Live />)
    emit('s1', request())
    expect(screen.getByTestId('permission-card').dataset.resolution).toBe('open')
    emit('s1', { type: 'permission_resolved', requestId: 'req-1', decision: 'cancelled' })
    const card = screen.getByTestId('permission-card')
    expect(card.dataset.resolution).toBe('cancelled')
    expect(within(card).getByTestId('permission-resolution').textContent).toBe('Cancelled')
    expect(within(card).queryByTestId('permission-allow')).toBeNull()
  })

  it('offers no "Always allow" when Claude Code says the request must not', async () => {
    await renderTranscript([request({ alwaysAllow: false })])
    expect(screen.queryByTestId('permission-always-allow')).toBeNull()
    expect(screen.getByTestId('permission-allow')).toBeTruthy()
  })

  it('shows another tool’s input as JSON', async () => {
    await renderTranscript([request({ toolName: 'Write', input: { file_path: '/tmp/a.txt', content: 'hi' } })])
    expect(JSON.parse(screen.getByTestId('permission-input').textContent ?? '')).toEqual({ file_path: '/tmp/a.txt', content: 'hi' })
  })

  it('says so when the request is no longer open', async () => {
    answers['agent.permission'] = () => ({ answered: false })
    await renderTranscript([request()])
    await act(async () => {
      fireEvent.click(screen.getByTestId('permission-allow'))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toBe('This request is no longer open')
  })
})

describe('the "Needs permission" badge', () => {
  const subject = { kind: 'session' as const, projectId: 'alpha', root: '/Users/test/alpha', sessionId: 'sdk-7' }

  it('shows on the Session that waits for an answer and opens it on a click', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView()] })
    const { default: NeedsPermission } = await import('../../src/renderer/canvas/badges/NeedsPermission')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    render(<NeedsPermission subject={subject} />)
    const badge = await screen.findByTestId('badge-needs-permission')
    expect(badge.textContent).toContain('Needs permission')
    fireEvent.click(badge)
    expect(useNavigation.getState()).toMatchObject({ view: 'session', opened: { nodeId: 'node-7', projectId: 'alpha' } })
  })

  it('shows nothing for a Session that is busy, or for a Ticket', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView({ state: 'busy' })] })
    const { default: NeedsPermission } = await import('../../src/renderer/canvas/badges/NeedsPermission')
    const { container } = render(<NeedsPermission subject={subject} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.innerHTML).toBe('')
    expect(asked.some((each) => each.channel === 'sessions.views')).toBe(true)
  })

  it('is in the badge slot', async () => {
    const { badges } = await import('../../src/renderer/canvas/badges/index')
    expect(badges.map((each) => each.id)).toContain('NeedsPermission')
  })
})

describe('the Session a notification opens', () => {
  it('is the Session Node that runs it, else the read-only Node of a registry Session in the active Project', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView({ state: 'busy' })] })
    const { notificationTarget } = await import('../../src/renderer/session/notification-target')
    const { useSessionNodeViewOf } = await import('../../src/renderer/session/node-sessions')
    function Load() {
      useSessionNodeViewOf('alpha', 'sdk-7')
      return null
    }
    render(<Load />)
    await act(async () => {
      await Promise.resolve()
    })
    const project = { id: 'alpha', path: '/Users/test/alpha' }
    expect(notificationTarget({ sessionId: 'sdk-7', projectRoot: null }, project)).toEqual({ nodeId: 'node-7', projectId: 'alpha' })
    expect(notificationTarget({ sessionId: 'ext-1', projectRoot: '/Users/test/alpha' }, project)).toEqual({ nodeId: 'session:ext-1', projectId: 'alpha', external: { sessionId: 'ext-1' } })
    expect(notificationTarget({ sessionId: 'ext-1', projectRoot: '/Users/test/other' }, project)).toBeNull()
    expect(notificationTarget({ sessionId: 'nobody', projectRoot: null }, project)).toBeNull()
  })
})
