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

  it('on Windows, finds a registry Session whose note spells the Project root with `\\` while the Project list keeps git\'s `C:/` (worfy-windows ticket 49)', async () => {
    const { notificationTarget } = await import('../../src/renderer/session/notification-target')
    const project = { id: 'worfy-d5750da7', path: 'C:/Users/Alexey/worfy' }
    const found = { nodeId: 'session:ext-1', projectId: 'worfy-d5750da7', external: { sessionId: 'ext-1' } }
    expect(notificationTarget({ sessionId: 'ext-1', projectRoot: 'C:\\Users\\Alexey\\worfy' }, project)).toEqual(found)
    expect(notificationTarget({ sessionId: 'ext-1', projectRoot: 'c:\\Users\\Alexey\\worfy\\' }, project)).toEqual(found)
    expect(notificationTarget({ sessionId: 'ext-1', projectRoot: 'C:\\Users\\Alexey\\worfy-two' }, project)).toBeNull()
    expect(notificationTarget({ sessionId: 'ext-1', projectRoot: 'C:\\Users\\Alexey\\Worfy' }, project)).toBeNull()
  })

  it('a note of Linked machine A finds the Session Node of A\'s Project in a window on A; the same id without a Machine finds the Session of this Machine', async () => {
    // The window's views are of one Machine: here the Node that runs sdk-7.
    answers['sessions.views'] = () => ({ views: [nodeView({ state: 'busy' })] })
    const { notificationTarget, noteMachine } = await import('../../src/renderer/session/notification-target')
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
    const ofA = { sessionId: 'sdk-7', projectRoot: null, machineId: 'machine-a' }
    const local = { sessionId: 'sdk-7', projectRoot: null }
    expect(noteMachine(ofA)).toBe('machine-a')
    expect(noteMachine(local)).toBeNull()
    expect(noteMachine({ ...local, machineId: null })).toBeNull()
    // In a window on A (on B): A's note finds A's Node; a note of B's own Session is not looked for among A's.
    expect(notificationTarget(ofA, project, 'machine-a')).toEqual({ nodeId: 'node-7', projectId: 'alpha' })
    expect(notificationTarget(local, project, 'machine-a')).toBeNull()
    // In a window on this Machine: its own Session; A's note is not looked for here.
    expect(notificationTarget(local, project, null)).toEqual({ nodeId: 'node-7', projectId: 'alpha' })
    expect(notificationTarget(ofA, project, null)).toBeNull()
    expect(notificationTarget({ sessionId: 'ext-1', projectRoot: '/Users/test/alpha', machineId: 'machine-a' }, project, 'machine-a')).toEqual({
      nodeId: 'session:ext-1',
      projectId: 'alpha',
      external: { sessionId: 'ext-1' },
    })
  })
})

describe('the notification overlay', () => {
  const PROJECTS = { projects: [{ id: 'alpha', name: 'alpha', path: '/Users/test/alpha', branch: 'main' }], activeId: 'alpha', revision: 1 }

  async function mountOverlay() {
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const target = await import('../../src/renderer/session/notification-target')
    render(<NotificationTarget />)
    await act(async () => {
      await Promise.resolve()
    })
    return { opened: () => useNavigation.getState(), target }
  }

  it('in a window a click opened, takes the note from main and opens the Session once its view arrives', async () => {
    answers['projects.list'] = () => PROJECTS
    answers['notify.pending'] = () => ({ note: { sessionId: 'sdk-7', projectRoot: null } })
    // The Session Node's view comes only when the overlay asks for the Project's views.
    answers['sessions.views'] = () => ({ views: [nodeView({ state: 'busy' })] })
    const h = await mountOverlay()
    await vi.waitFor(() => expect(h.opened()).toMatchObject({ view: 'session', opened: { nodeId: 'node-7', projectId: 'alpha' } }))
    expect(asked.filter((each) => each.channel === 'notify.pending')).not.toHaveLength(0)
    expect(asked).toContainEqual({ channel: 'sessions.views', input: { projectId: 'alpha' } })
    expect(h.target.usePendingNote.getState().pending).toBeNull()
  })

  it('in an open window, `notify.open` makes the overlay take the note from main and open its Session', async () => {
    answers['projects.list'] = () => PROJECTS
    let held: { sessionId: string; projectRoot: string | null } | null = null
    answers['notify.pending'] = () => {
      const note = held
      held = null
      return { note }
    }
    const h = await mountOverlay()
    await vi.waitFor(() => expect(asked.map((each) => each.channel)).toContain('projects.list'))
    expect(asked.filter((each) => each.channel === 'notify.pending')).toHaveLength(1)
    expect(h.opened().opened).toBeNull()
    // Main keeps the note, then signals; the signal itself names no Session.
    held = { sessionId: 'ext-1', projectRoot: '/Users/test/alpha' }
    act(() => handlers.get('notify.open')?.({}))
    await vi.waitFor(() => expect(h.opened().opened).toEqual({ nodeId: 'session:ext-1', projectId: 'alpha', external: { sessionId: 'ext-1' } }))
    expect(asked.filter((each) => each.channel === 'notify.pending')).toHaveLength(2)
  })

  it('a signal for a note main no longer has (taken or expired) opens nothing', async () => {
    answers['projects.list'] = () => PROJECTS
    answers['notify.pending'] = () => ({ note: null })
    const h = await mountOverlay()
    await vi.waitFor(() => expect(asked.map((each) => each.channel)).toContain('projects.list'))
    act(() => handlers.get('notify.open')?.({}))
    await vi.waitFor(() => expect(asked.filter((each) => each.channel === 'notify.pending')).toHaveLength(2))
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.target.usePendingNote.getState().pending).toBeNull()
    expect(h.opened().opened).toBeNull()
  })

  it('drops a note whose Session does not show up in time, so a later view opens nothing', async () => {
    answers['projects.list'] = () => PROJECTS
    answers['notify.pending'] = () => ({ note: null })
    const h = await mountOverlay()
    act(() => h.target.holdNote({ sessionId: 'sdk-late', projectRoot: null }, Date.now() - h.target.NOTE_WAIT_MS + 30))
    expect(h.target.usePendingNote.getState().pending?.note.sessionId).toBe('sdk-late')
    await vi.waitFor(() => expect(h.target.usePendingNote.getState().pending).toBeNull())
    expect(handlers.has('sessions.changed')).toBe(true)
    act(() => handlers.get('sessions.changed')?.(nodeView({ nodeId: 'node-late', sessionId: 'sdk-late', sdkSessionId: 'sdk-late', state: 'busy', version: 2 })))
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.opened().opened).toBeNull()
  })

  describe('a note of a Linked machine', () => {
    const OF_A = { projects: [{ id: 'beta', name: 'beta', path: '/Users/test/beta', branch: 'main' }, { id: 'gamma', name: 'gamma', path: '/Users/test/gamma', branch: 'main' }], activeId: 'beta', revision: 3 }

    afterEach(() => {
      window.history.replaceState(null, '', '/')
      window.sessionStorage.clear()
    })

    /** Channels of the window's Machine go through `linked.invoke` in a window on a Linked machine. */
    function onLinkedMachine(machine: string, answer: Record<string, (input: unknown) => unknown>) {
      const reached: { machine: string; channel: string; input: unknown }[] = []
      answers['linked.invoke'] = (input) => {
        const call = input as { machine: string; channel: string; input: unknown }
        reached.push(call)
        const each = answer[call.channel]
        return each ? { ok: true, value: each(call.input) } : { ok: false, error: `no ${call.channel} on ${machine}` }
      }
      answers['linked.open'] = () => ({})
      return reached
    }

    it('in a window on this Machine, loads the window again on the Project of that Machine the Session is in, and carries the note across the load', async () => {
      answers['projects.list'] = () => PROJECTS
      // This Machine runs a Session of the same id: not the one the note is about.
      answers['sessions.views'] = () => ({ views: [nodeView({ sessionId: 'sdk-9', sdkSessionId: 'sdk-9', state: 'busy' })] })
      const reached = onLinkedMachine('machine-a', {
        'projects.list': () => OF_A,
        'sessions.views': (input) => ({ views: (input as { projectId: string }).projectId === 'gamma' ? [nodeView({ projectId: 'gamma', nodeId: 'node-g', sessionId: 'sdk-9', sdkSessionId: 'sdk-9', state: 'busy' })] : [] }),
      })
      answers['notify.pending'] = () => ({ note: { sessionId: 'sdk-9', projectRoot: null, machineId: 'machine-a' } })
      const { navigation } = await import('../../src/renderer/projects/useProjects')
      const loads: string[] = []
      navigation.load = (url) => loads.push(url)
      const h = await mountOverlay()
      await vi.waitFor(() => expect(loads).toHaveLength(1))
      expect(new URL(loads[0] ?? '').searchParams.get('machine')).toBe('machine-a')
      expect(new URL(loads[0] ?? '').searchParams.get('project')).toBe('gamma')
      expect(reached.every((each) => each.machine === 'machine-a')).toBe(true)
      // Nothing opened here, not even a Session of this Machine with the same id.
      expect(h.opened().opened).toBeNull()
      expect(h.target.usePendingNote.getState().pending).toBeNull()
      const carried = h.target.takeCarriedNote()
      expect(carried?.note).toEqual({ sessionId: 'sdk-9', projectRoot: null, machineId: 'machine-a' })
      // Taken once.
      expect(h.target.takeCarriedNote()).toBeNull()
    })

    it('a Session from the registry of that Machine: the window loads on its Project by root; unknown — on the Machine\'s active one', async () => {
      answers['projects.list'] = () => PROJECTS
      onLinkedMachine('machine-a', { 'projects.list': () => OF_A, 'sessions.views': () => ({ views: [] }) })
      const { projectOfNote } = await import('../../src/renderer/session/notification-target')
      expect(await projectOfNote({ sessionId: 'ext-1', projectRoot: '/Users/test/gamma', machineId: 'machine-a' }, 'machine-a')).toBe('gamma')
      expect(await projectOfNote({ sessionId: 'ext-1', projectRoot: '/Users/test/elsewhere', machineId: 'machine-a' }, 'machine-a')).toBe('beta')
      expect(await projectOfNote({ sessionId: 'orchestrator-1', projectRoot: null, machineId: 'machine-a' }, 'machine-a')).toBe('beta')
      answers['linked.invoke'] = () => ({ ok: false, error: 'projects.list: Mini is unreachable' })
      expect(await projectOfNote({ sessionId: 'sdk-9', projectRoot: null, machineId: 'machine-a' }, 'machine-a')).toBeNull()
    })

    // worfy-windows ticket 49: a Windows Machine lists git's `C:/…`, its notes carry path.resolve's `C:\…`.
    const OF_WINDOWS = {
      projects: [
        { id: 'beta', name: 'beta', path: 'C:/Users/test/beta', branch: 'main' },
        { id: 'gamma', name: 'gamma', path: 'C:/Users/test/gamma', branch: 'main' },
      ],
      activeId: 'beta',
      revision: 3,
    }

    it('a Session from the registry of a Windows Machine: its Project is found by a root spelled with `\\`', async () => {
      answers['projects.list'] = () => PROJECTS
      onLinkedMachine('machine-a', { 'projects.list': () => OF_WINDOWS, 'sessions.views': () => ({ views: [] }) })
      const { projectOfNote } = await import('../../src/renderer/session/notification-target')
      expect(await projectOfNote({ sessionId: 'ext-1', projectRoot: 'C:\\Users\\test\\gamma', machineId: 'machine-a' }, 'machine-a')).toBe('gamma')
      expect(await projectOfNote({ sessionId: 'ext-1', projectRoot: 'c:\\Users\\test\\gamma\\', machineId: 'machine-a' }, 'machine-a')).toBe('gamma')
      expect(await projectOfNote({ sessionId: 'ext-1', projectRoot: 'C:\\Users\\test\\gammas', machineId: 'machine-a' }, 'machine-a')).toBe('beta')
    })

    it('in a window on a Windows Machine, opens a registry Session of a Project other than the active one when the note spells its root with `\\`', async () => {
      window.history.replaceState(null, '', '/?machine=machine-a&project=beta')
      onLinkedMachine('machine-a', { 'projects.list': () => OF_WINDOWS, 'sessions.views': () => ({ views: [] }) })
      answers['notify.pending'] = () => ({ note: { sessionId: 'ext-1', projectRoot: 'C:\\Users\\test\\gamma', machineId: 'machine-a' } })
      const { navigation } = await import('../../src/renderer/projects/useProjects')
      navigation.replace = () => undefined
      navigation.load = () => {
        throw new Error('the window must not load again')
      }
      const h = await mountOverlay()
      await vi.waitFor(() => expect(h.opened()).toMatchObject({ view: 'session', opened: { nodeId: 'session:ext-1', projectId: 'gamma', external: { sessionId: 'ext-1' } } }))
      expect(asked).toContainEqual({ channel: 'linked.open', input: { machine: 'machine-a', projectId: 'gamma' } })
    })

    it('after the load on that Machine, looks for the Session in every Project of it and opens it with its Project', async () => {
      window.history.replaceState(null, '', '/?machine=machine-a')
      const view = nodeView({ projectId: 'gamma', nodeId: 'node-g', sessionId: 'sdk-9', sdkSessionId: 'sdk-9', state: 'busy' })
      const reached = onLinkedMachine('machine-a', {
        'projects.list': () => OF_A,
        'sessions.views': (input) => ({ views: (input as { projectId: string }).projectId === 'gamma' ? [view] : [] }),
      })
      answers['notify.pending'] = () => ({ note: null })
      const { carryNote } = await import('../../src/renderer/session/notification-target')
      carryNote({ note: { sessionId: 'sdk-9', projectRoot: null, machineId: 'machine-a' }, until: Date.now() + 5_000 })
      const { navigation } = await import('../../src/renderer/projects/useProjects')
      const replaced: string[] = []
      navigation.replace = (url) => replaced.push(url)
      navigation.load = () => {
        throw new Error('the window must not load again')
      }
      const h = await mountOverlay()
      await vi.waitFor(() => expect(h.opened()).toMatchObject({ view: 'session', opened: { nodeId: 'node-g', projectId: 'gamma' } }))
      // Every Project of A was asked for its views, through A.
      expect(reached.filter((each) => each.channel === 'sessions.views').map((each) => each.input)).toEqual(expect.arrayContaining([{ projectId: 'beta' }, { projectId: 'gamma' }]))
      expect(reached.every((each) => each.machine === 'machine-a')).toBe(true)
      // The window now shows gamma of A, as the sidebar would open it.
      expect(new URL(replaced.at(-1) ?? 'http://x/').searchParams.get('project')).toBe('gamma')
      expect(asked).toContainEqual({ channel: 'linked.open', input: { machine: 'machine-a', projectId: 'gamma' } })
    })

    it('a newer click while the Project of a Linked machine\'s note is looked up decides: the window stays and opens the newer one', async () => {
      answers['projects.list'] = () => PROJECTS
      answers['sessions.views'] = () => ({ views: [nodeView({ state: 'busy' })] })
      onLinkedMachine('machine-a', { 'projects.list': () => OF_A, 'sessions.views': () => ({ views: [] }) })
      // Machine A answers only when the test lets it.
      const bridge = (globalThis as { worfy?: WorfyBridge }).worfy as WorfyBridge
      const plain = bridge.invoke.bind(bridge)
      let release: () => void = () => undefined
      const released = new Promise<void>((done) => {
        release = done
      })
      let waiting = 0
      bridge.invoke = ((channel: string, input: unknown) => {
        if (channel !== 'linked.invoke') return plain(channel as never, input as never)
        waiting += 1
        return released.then(() => plain(channel as never, input as never))
      }) as never
      answers['notify.pending'] = () => ({ note: { sessionId: 'sdk-9', projectRoot: null, machineId: 'machine-a' } })
      const { navigation } = await import('../../src/renderer/projects/useProjects')
      const loads: string[] = []
      navigation.load = (url) => loads.push(url)
      const h = await mountOverlay()
      await vi.waitFor(() => expect(waiting).toBeGreaterThan(0))
      // The newer click is about a Session of this Machine: it opens here.
      act(() => h.target.holdNote({ sessionId: 'sdk-7', projectRoot: null }))
      await vi.waitFor(() => expect(h.opened().opened).toEqual({ nodeId: 'node-7', projectId: 'alpha' }))
      release()
      await act(async () => {
        await new Promise((done) => setTimeout(done, 20))
      })
      expect(loads).toEqual([])
      expect(h.target.takeCarriedNote()).toBeNull()
    })

    it('a carried note that waited too long opens nothing after the load', async () => {
      window.history.replaceState(null, '', '/?machine=machine-a')
      onLinkedMachine('machine-a', { 'projects.list': () => OF_A, 'sessions.views': () => ({ views: [nodeView({ projectId: 'beta', state: 'busy' })] }) })
      answers['notify.pending'] = () => ({ note: null })
      const { carryNote } = await import('../../src/renderer/session/notification-target')
      carryNote({ note: { sessionId: 'sdk-7', projectRoot: null, machineId: 'machine-a' }, until: Date.now() - 1 })
      const h = await mountOverlay()
      await vi.waitFor(() => expect(asked.map((each) => each.channel)).toContain('notify.pending'))
      await act(async () => {
        await Promise.resolve()
      })
      expect(h.target.usePendingNote.getState().pending).toBeNull()
      expect(h.opened().opened).toBeNull()
    })

    it('a note of this Machine in a window on a Linked machine brings the window back to this Machine', async () => {
      window.history.replaceState(null, '', '/?machine=machine-a&project=beta')
      onLinkedMachine('machine-a', { 'projects.list': () => OF_A, 'sessions.views': () => ({ views: [nodeView({ projectId: 'beta', state: 'busy' })] }) })
      answers['notify.pending'] = () => ({ note: { sessionId: 'sdk-7', projectRoot: null } })
      const { navigation } = await import('../../src/renderer/projects/useProjects')
      const loads: string[] = []
      navigation.load = (url) => loads.push(url)
      const h = await mountOverlay()
      await vi.waitFor(() => expect(loads).toHaveLength(1))
      const url = new URL(loads[0] ?? '')
      expect(url.searchParams.get('machine')).toBeNull()
      expect(url.searchParams.get('project')).toBeNull()
      // A's Node runs a Session of the same id: it is not the one the note is about.
      expect(h.opened().opened).toBeNull()
      expect(h.target.takeCarriedNote()?.note).toEqual({ sessionId: 'sdk-7', projectRoot: null })
    })
  })

  it('a newer note replaces one still waiting; letting go of the old one keeps the new', async () => {
    const { dropNote, holdNote, usePendingNote } = await import('../../src/renderer/session/notification-target')
    holdNote({ sessionId: 'a', projectRoot: null })
    const first = usePendingNote.getState().pending
    holdNote({ sessionId: 'b', projectRoot: null })
    if (first !== null) dropNote(first)
    expect(usePendingNote.getState().pending?.note.sessionId).toBe('b')
  })
})
