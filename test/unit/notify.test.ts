// When worfy shows a macOS notification and how often (ticket 21, src/main/notify.ts): a Session
// that finished its turn or asks for permission, only while no worfy window has focus, at most one
// per Session in 10 s; a click opens that Session. Electron's Notification is replaced by
// NotifyDeps.
import { describe, expect, it, vi } from 'vitest'
import type { QueuePr } from '../../src/main/github/gate-queue'
import type { TicketNote, WindowNote } from '../../src/main/notify'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import type { PipelineColumn, PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import { stageId, stageLabel, type PipelineStage } from '../../src/shared/workflow/pipeline'
import type { StageSubscriber } from '../../src/main/workflow/stages'
import { APP_URL } from '../app-url'

const electron = vi.hoisted(() => ({
  shown: [] as { title: string; body: string }[],
  focused: null as unknown,
  windows: [] as unknown[],
}))

vi.mock('electron', () => {
  class Notification {
    static isSupported = () => true
    constructor(private readonly options: { title: string; body: string }) {}
    on() {
      return this
    }
    show() {
      electron.shown.push(this.options)
    }
  }
  return { app: { focus: vi.fn() }, BrowserWindow: { getFocusedWindow: () => electron.focused, getAllWindows: () => electron.windows }, Notification }
})
// The real window module loads the app's page; openNote gets its own window factory.
vi.mock('../../src/main/window', () => ({ createMainWindow: () => undefined }))

const { NOTIFY_INTERVAL_MS, NoteDisplay, Notifier, GateQueueNotices, electronNotifyDeps, electronWindowNoteDeps, installGateQueueNotifications, installNotifications, openNote } = await import('../../src/main/notify')
const { GATE_QUEUE_INTERVAL_MS, waitingPrs } = await import('../../src/main/github/gate-queue')
const { NORMAL_WINDOWS, quietWindows } = await import('../../src/main/quiet-windows')
const { app: electronApp } = await import('electron')

/** Runs `body` with WORFY_QUIET_WINDOWS set to `value` (unset for undefined), then puts it back. */
function withQuietWindows(value: string | undefined, body: () => void): void {
  const before = process.env.WORFY_QUIET_WINDOWS
  if (value === undefined) delete process.env.WORFY_QUIET_WINDOWS
  else process.env.WORFY_QUIET_WINDOWS = value
  try {
    body()
  } finally {
    if (before === undefined) delete process.env.WORFY_QUIET_WINDOWS
    else process.env.WORFY_QUIET_WINDOWS = before
  }
}
const { PENDING_OPEN_MS, PendingOpens } = await import('../../src/main/notify-pending')
const { WaitsNotices, installWaitsNotifications } = await import('../../src/main/workflow/waits-notify')
type Note = Parameters<ConstructorParameters<typeof Notifier>[0]['show']>[0]

type Result = Extract<AgentEvent, { type: 'result' }>
const result = (overrides: Partial<Result> = {}): Result => ({
  type: 'result',
  subtype: 'success',
  isError: false,
  error: null,
  text: 'All tests pass.',
  costUsd: 0,
  durationMs: 1,
  numTurns: 1,
  usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  terminalReason: null,
  interrupted: false,
  ...overrides,
})
const permission = (command = 'git push'): AgentEvent => ({
  type: 'permission_request',
  requestId: 'r1',
  toolName: 'Bash',
  toolUseId: null,
  input: { command },
  title: null,
  description: null,
  blockedPath: null,
  alwaysAllow: true,
  suggestions: [],
})
const init = (cwd: string, sdkSessionId = 'sdk-1'): AgentEvent => ({
  type: 'init',
  sdkSessionId,
  model: 'm',
  permissionMode: 'default',
  apiKeySource: 'none',
  cwd,
  claudeCodeVersion: null,
  slashCommands: [],
})
const live = (sessionId: string, status: LiveSession['status'], name?: string): LiveSession => ({
  pid: 100,
  sessionId,
  cwd: '/Users/test/alpha/.claude/worktrees/07',
  status,
  ...(name === undefined ? {} : { name }),
})

function harness() {
  let focused = false
  let now = 1_000_000
  const shown: { note: Note; click: () => void }[] = []
  const opened: Note[] = []
  const notifier = new Notifier({
    focused: () => focused,
    show: (note, click) => shown.push({ note, click }),
    open: (note) => opened.push(note),
    now: () => now,
  })
  return {
    notifier,
    shown,
    opened,
    focused: () => focused,
    now: () => now,
    focus: (value: boolean) => {
      focused = value
    },
    wait: (ms: number) => {
      now += ms
    },
  }
}

describe('Notifier', () => {
  it('notifies a finished turn and a permission request while no worfy window has focus, and not while one has', () => {
    const h = harness()
    h.notifier.sessionEvent('s1', init('/Users/test/alpha'))
    h.focus(true)
    h.notifier.sessionEvent('s1', result())
    h.notifier.sessionEvent('s1', permission())
    expect(h.shown).toEqual([])

    h.focus(false)
    h.notifier.sessionEvent('s1', result())
    expect(h.shown.map((each) => each.note)).toEqual([{ title: 'alpha', body: 'All tests pass.', sessionId: 's1', projectRoot: null }])
    h.wait(NOTIFY_INTERVAL_MS)
    h.notifier.sessionEvent('s1', permission('git push origin main'))
    expect(h.shown[1]?.note).toEqual({ title: 'alpha', body: 'Needs permission: Bash git push origin main', sessionId: 's1', projectRoot: null })
  })

  it('sends one notification per Session in 10 s, each Session on its own', () => {
    const h = harness()
    h.notifier.sessionEvent('s1', permission())
    h.notifier.sessionEvent('s1', result())
    h.notifier.sessionEvent('s2', result())
    expect(h.shown.map((each) => each.note.sessionId)).toEqual(['s1', 's2'])
    h.wait(NOTIFY_INTERVAL_MS - 1)
    h.notifier.sessionEvent('s1', result())
    expect(h.shown).toHaveLength(2)
    h.wait(1)
    h.notifier.sessionEvent('s1', result())
    expect(h.shown).toHaveLength(3)
  })

  it('does not count a notification it held back while focused', () => {
    const h = harness()
    h.focus(true)
    h.notifier.sessionEvent('s1', result())
    h.focus(false)
    h.notifier.sessionEvent('s1', result())
    expect(h.shown).toHaveLength(1)
  })

  it('keeps the 10 s across the rename of a new Session to its SDK id', () => {
    const h = harness()
    h.notifier.sessionEvent('pending-1', permission())
    h.notifier.sessionEvent('sdk-1', { type: 'renamed', from: 'pending-1' })
    h.notifier.sessionEvent('sdk-1', result())
    expect(h.shown).toHaveLength(1)
  })

  it('stays quiet for a turn the user interrupted, and says "Finished its turn" for one without text', () => {
    const h = harness()
    h.notifier.sessionEvent('s1', result({ interrupted: true, isError: true, error: 'aborted' }))
    expect(h.shown).toEqual([])
    h.notifier.sessionEvent('s1', result({ text: null }))
    expect(h.shown[0]?.note.body).toBe('Finished its turn')
  })

  it('opens the Session of a clicked notification', () => {
    const h = harness()
    h.notifier.sessionEvent('s1', permission())
    h.shown[0]?.click()
    expect(h.opened).toEqual([h.shown[0]?.note])
  })

  it('notifies a Session from the registry going busy → idle, not its first sight', () => {
    const h = harness()
    const root = '/Users/test/alpha'
    h.notifier.externalSessions(root, [live('ext-1', 'idle'), live('ext-2', 'busy', 'ship 07')])
    expect(h.shown).toEqual([])
    h.notifier.externalSessions(root, [live('ext-1', 'busy'), live('ext-2', 'idle', 'ship 07')])
    expect(h.shown.map((each) => each.note)).toEqual([{ title: 'ship 07', body: 'Finished its turn', sessionId: 'ext-2', projectRoot: root }])
    h.notifier.externalSessions(root, [live('ext-1', 'idle')])
    expect(h.shown.map((each) => each.note.title)).toEqual(['ship 07', '07'])
    // A Session gone from the registry and back is seen anew.
    h.wait(NOTIFY_INTERVAL_MS)
    h.notifier.externalSessions(root, [live('ext-2', 'idle')])
    expect(h.shown).toHaveLength(2)
  })
})

describe('the Machine of a Project and its Linked machines (worfy-link ticket 13)', () => {
  /** The harness with a link that records what this Machine sends to its Linked machines. */
  function linked() {
    let focused = false
    let now = 1_000_000
    const sent: Note[] = []
    const shown: { note: Note; click: () => void }[] = []
    const opened: Note[] = []
    const notifier = new Notifier(
      { focused: () => focused, show: (note, click) => shown.push({ note, click }), open: (note) => opened.push(note), now: () => now },
      { send: (note) => sent.push(note) },
    )
    return {
      notifier,
      sent,
      shown,
      opened,
      focus: (value: boolean) => {
        focused = value
      },
      wait: (ms: number) => {
        now += ms
      },
    }
  }

  it('with its window focused the result is not shown here but goes to the Linked machines; without focus, both', () => {
    const h = linked()
    h.notifier.sessionEvent('s1', init('/Users/test/alpha'))
    h.focus(true)
    h.notifier.sessionEvent('s1', result())
    expect(h.shown).toEqual([])
    expect(h.sent).toEqual([{ title: 'alpha', body: 'All tests pass.', sessionId: 's1', projectRoot: null }])
    h.focus(false)
    h.notifier.sessionEvent('s1', permission())
    expect(h.shown.map((each) => each.note)).toEqual([{ title: 'alpha', body: 'Needs permission: Bash git push', sessionId: 's1', projectRoot: null }])
    expect(h.sent).toHaveLength(2)
    // A registry Session's note goes the same way.
    h.notifier.externalSessions('/r', [live('e1', 'busy')])
    h.notifier.externalSessions('/r', [live('e1', 'idle')])
    expect(h.sent[2]).toEqual({ title: '07', body: 'Finished its turn', sessionId: 'e1', projectRoot: '/r' })
  })

  it('sends every note it decides on: the 10 s are counted by each Machine that shows it', () => {
    const h = linked()
    h.notifier.sessionEvent('s1', result())
    h.notifier.sessionEvent('s1', result())
    expect(h.shown).toHaveLength(1)
    expect(h.sent).toHaveLength(2)
    // An interrupted turn stays quiet everywhere.
    h.notifier.sessionEvent('s1', result({ interrupted: true }))
    expect(h.sent).toHaveLength(2)
  })

  it('shows a received note by its own rules, with its own 10 s per Machine and Session, and sends it nowhere', () => {
    const h = linked()
    const note = { title: 'beta', body: 'Done', sessionId: 's1', projectRoot: null }
    // Held back by focus: not counted.
    h.focus(true)
    h.notifier.received('machine-a', note)
    h.focus(false)
    h.notifier.received('machine-a', note)
    expect(h.shown.map((each) => each.note)).toEqual([{ ...note, machineId: 'machine-a' }])
    // The same Session id of this Machine and of another Linked machine are counted apart.
    h.notifier.sessionEvent('s1', result())
    h.notifier.received('machine-c', note)
    expect(h.shown.map((each) => each.note.machineId)).toEqual(['machine-a', undefined, 'machine-c'])
    h.notifier.received('machine-a', note)
    expect(h.shown).toHaveLength(3)
    h.wait(NOTIFY_INTERVAL_MS)
    h.notifier.received('machine-a', note)
    expect(h.shown).toHaveLength(4)
    // Only this Machine's own note went to the link.
    expect(h.sent.map((each) => each.sessionId)).toEqual(['s1'])
    // A click opens it with its Machine.
    h.shown[0]?.click()
    expect(h.opened).toEqual([{ ...note, machineId: 'machine-a' }])
  })

  it('a closed Session of this Machine leaves the count of a Linked machine\'s Session with the same id alone', () => {
    const h = linked()
    const note = { title: 'beta', body: 'Done', sessionId: 's1', projectRoot: null }
    h.notifier.received('machine-a', note)
    h.notifier.sessionEvent('s1', result())
    h.notifier.sessionEvent('s1', { type: 'state', state: 'closed', error: null } as AgentEvent)
    h.notifier.received('machine-a', note)
    expect(h.shown).toHaveLength(2)
    h.notifier.sessionEvent('s1', result())
    expect(h.shown).toHaveLength(3)
  })
})

describe('Electron notifications', () => {
  it('shows an Electron Notification only when no window has focus', () => {
    electron.shown.length = 0
    withQuietWindows(undefined, () => {
      const stop = installNotifications(
        {
          observe: (listener) => {
            listener('s1', result())
            electron.focused = {}
            listener('s2', result())
            electron.focused = null
            return () => undefined
          },
        },
        new Set(),
      )
      expect(electron.shown).toEqual([{ title: 'Session', body: 'All tests pass.' }])
      stop()
    })
    expect(electronNotifyDeps.focused()).toBe(false)
  })

  it('with quiet windows (WORFY_QUIET_WINDOWS=1, e2e tests) shows no system notification, though no window has focus', () => {
    electron.shown.length = 0
    electron.focused = null
    withQuietWindows('1', () => {
      electronNotifyDeps.show({ title: 'alpha', body: 'Done', sessionId: 's1', projectRoot: null }, () => undefined)
    })
    expect(electron.shown).toEqual([])
    // Any other value is the normal start: the notification shows.
    withQuietWindows('0', () => {
      electronNotifyDeps.show({ title: 'alpha', body: 'Done', sessionId: 's1', projectRoot: null }, () => undefined)
    })
    expect(electron.shown).toEqual([{ title: 'alpha', body: 'Done' }])
  })

  it('feeds the registry watchers’ live Sessions to the notifier until stopped', () => {
    const listeners = new Set<(root: string, live: readonly LiveSession[]) => void>()
    const stop = installNotifications({ observe: () => () => undefined }, listeners, {
      focused: () => false,
      show: (note) => electron.shown.push({ title: note.title, body: note.body }),
      open: () => undefined,
      now: () => 0,
    })
    expect(listeners.size).toBe(1)
    electron.shown.length = 0
    for (const listener of listeners) {
      listener('/r', [live('e1', 'busy')])
      listener('/r', [live('e1', 'idle')])
    }
    expect(electron.shown).toEqual([{ title: '07', body: 'Finished its turn' }])
    stop()
    expect(listeners.size).toBe(0)
  })
})

describe('live Sessions from the registry watchers', () => {
  it('reach the listeners when a watcher starts and after each change of the registry, not after a transcript change', async () => {
    const { ClaudeHomeSubscriptions } = await import('../../src/main/ipc/claude-home')
    let onChange: (change: { sessions: boolean; transcripts: string[] }) => void = () => undefined
    let status: LiveSession['status'] = 'busy'
    const registry = {
      watch: (_root: string, listener: typeof onChange) => {
        onChange = listener
        return Promise.resolve({ ready: Promise.resolve(), close: () => Promise.resolve() })
      },
      live: () => Promise.resolve([live('e1', status)]),
    }
    const seen: string[] = []
    const listeners = new Set([(root: string, sessions: readonly LiveSession[]) => seen.push(`${root} ${sessions.map((each) => each.status).join()}`)])
    const subscriptions = new ClaudeHomeSubscriptions(registry as never, listeners)
    const sender = { id: 1, send: () => undefined, isDestroyed: () => false, once: () => undefined }
    await subscriptions.subscribe(sender, '/r')
    await vi.waitFor(() => expect(seen).toEqual(['/r busy']))
    status = 'idle'
    onChange({ sessions: false, transcripts: ['t'] })
    onChange({ sessions: true, transcripts: [] })
    await vi.waitFor(() => expect(seen).toEqual(['/r busy', '/r idle']))
  })
})

/** A BrowserWindow as openNote uses it. */
function fakeWindow(id: number, { loading = false, minimized = false, onSend = (): void => undefined } = {}) {
  const sent: { channel: string; payload: unknown }[] = []
  const destroyed: (() => void)[] = []
  const calls: string[] = []
  const window = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    showInactive: () => calls.push('showInactive'),
    focus: () => calls.push('focus'),
    webContents: {
      id,
      isLoading: () => loading,
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
        onSend()
      },
      once: (event: string, listener: () => void) => {
        if (event === 'destroyed') destroyed.push(listener)
      },
    },
  }
  return { window, sent, calls, destroy: () => destroyed.forEach((each) => each()) }
}

describe('a click on a notification', () => {
  const note: Note = { title: 'alpha', body: 'Needs permission: Bash ls', sessionId: 's1', projectRoot: null }
  const SIGNAL = { channel: 'worfy:notify.open', payload: {} }

  it('raises the open window, keeps the note for it and signals its overlay to take it', () => {
    const pending = new PendingOpens()
    const open = fakeWindow(1, { minimized: true })
    electron.windows = [open.window]
    const create = vi.fn()
    vi.mocked(electronApp.focus).mockClear()
    openNote(note, pending, create, NORMAL_WINDOWS)
    expect(create).not.toHaveBeenCalled()
    expect(open.calls).toEqual(['restore', 'show', 'focus'])
    expect(electronApp.focus).toHaveBeenCalledWith({ steal: true })
    // The signal carries no Session: the overlay takes the note from main.
    expect(open.sent).toEqual([SIGNAL])
    expect(pending.take(1)).toEqual({ sessionId: 's1', projectRoot: null })
    electron.windows = []
  })

  it('with quiet windows (e2e tests) shows the window inactive and takes no focus, and still hands it the note', () => {
    const pending = new PendingOpens()
    const open = fakeWindow(6, { minimized: true })
    electron.windows = [open.window]
    vi.mocked(electronApp.focus).mockClear()
    openNote(note, pending, vi.fn() as never, quietWindows({ WORFY_QUIET_WINDOWS: '1' }, 'darwin'))
    expect(open.calls).toEqual(['restore', 'showInactive'])
    expect(electronApp.focus).not.toHaveBeenCalled()
    expect(open.sent).toEqual([SIGNAL])
    expect(pending.take(6)).toEqual({ sessionId: 's1', projectRoot: null })
    electron.windows = []
  })

  it('reads quiet windows from WORFY_QUIET_WINDOWS by default', () => {
    const open = fakeWindow(7)
    electron.windows = [open.window]
    withQuietWindows('1', () => openNote(note, new PendingOpens(), vi.fn() as never))
    expect(open.calls).toEqual(['showInactive'])
    electron.windows = []
  })

  it('while a Card iframe loads (isLoading is true), a mounted overlay still gets the signal and the note', () => {
    const pending = new PendingOpens()
    const taken: unknown[] = []
    // The overlay is mounted: it takes the note as soon as the signal arrives.
    const open = fakeWindow(2, { loading: true, onSend: () => taken.push(pending.take(2)) })
    electron.windows = [open.window]
    openNote(note, pending, vi.fn() as never)
    expect(open.sent).toEqual([SIGNAL])
    expect(taken).toEqual([{ sessionId: 's1', projectRoot: null }])
    // Nothing is left for a later remount of the overlay to open unexpectedly.
    expect(pending.take(2)).toBeNull()
    electron.windows = []
  })

  it('when the page has loaded but the overlay is not mounted yet, the note waits for its mount', () => {
    const pending = new PendingOpens()
    // Nobody listens: the signal goes nowhere.
    const open = fakeWindow(5, { loading: false })
    electron.windows = [open.window]
    openNote(note, pending, vi.fn() as never)
    expect(open.sent).toEqual([SIGNAL])
    // The overlay mounts and asks for the note.
    expect(pending.take(5)).toEqual({ sessionId: 's1', projectRoot: null })
    electron.windows = []
  })

  it('a note nobody took within PENDING_OPEN_MS opens nothing on a later mount', () => {
    let now = 1_000
    const pending = new PendingOpens(() => now)
    const open = fakeWindow(6)
    electron.windows = [open.window]
    openNote(note, pending, vi.fn() as never)
    now += PENDING_OPEN_MS - 1
    expect(pending.take(6)).toEqual({ sessionId: 's1', projectRoot: null })
    openNote({ ...note, sessionId: 's2' }, pending, vi.fn() as never)
    now += PENDING_OPEN_MS
    expect(pending.take(6)).toBeNull()
    electron.windows = []
  })

  it('with no window open (macOS keeps the app running), opens one and keeps the note for its renderer', () => {
    const pending = new PendingOpens()
    const created = fakeWindow(7)
    electron.windows = []
    const create = vi.fn(() => created.window)
    openNote({ ...note, projectRoot: '/Users/test/alpha' }, pending, create as never)
    expect(create).toHaveBeenCalledTimes(1)
    // Nothing is sent to a page that is not there yet.
    expect(created.sent).toEqual([])
    expect(pending.take(7)).toEqual({ sessionId: 's1', projectRoot: '/Users/test/alpha' })
    // Taken once.
    expect(pending.take(7)).toBeNull()
  })

  it('keeps the latest note of a window, and forgets it when the window goes away', () => {
    const pending = new PendingOpens()
    const loading = fakeWindow(3, { loading: true })
    electron.windows = [loading.window]
    openNote(note, pending, vi.fn() as never)
    openNote({ ...note, sessionId: 's2' }, pending, vi.fn() as never)
    loading.destroy()
    expect(pending.take(3)).toBeNull()

    openNote({ ...note, sessionId: 's3' }, pending, vi.fn() as never)
    openNote({ ...note, sessionId: 's4' }, pending, vi.fn() as never)
    expect(pending.take(3)).toEqual({ sessionId: 's4', projectRoot: null })
    electron.windows = []
  })
})

describe('a click on a note of a Linked machine', () => {
  it('keeps the note with its Machine for the raised window', () => {
    const pending = new PendingOpens()
    const open = fakeWindow(8)
    electron.windows = [open.window]
    openNote({ title: 'beta', body: 'Done', sessionId: 's1', projectRoot: null, machineId: 'machine-a' }, pending, vi.fn() as never)
    expect(open.sent).toEqual([{ channel: 'worfy:notify.open', payload: {} }])
    expect(pending.take(8)).toEqual({ sessionId: 's1', projectRoot: null, machineId: 'machine-a' })
    // A null Machine is this one: the note reads as one of this Machine.
    pending.hold(8, { sessionId: 's2', projectRoot: null, machineId: null })
    expect(pending.take(8)).toEqual({ sessionId: 's2', projectRoot: null })
    electron.windows = []
  })
})

describe('notify.open at the IPC boundary', () => {
  it('is a signal with no Session in it: extra keys are cut, a payload of another type is refused', async () => {
    const { emit } = await import('../../src/main/ipc/index')
    const { notifyOpen } = await import('../../src/shared/ipc/notify')
    const sent: unknown[] = []
    const target = { send: (_channel: string, payload: unknown) => sent.push(payload) }
    emit(target as never, notifyOpen, { sessionId: 's1', projectRoot: null } as never)
    expect(sent).toEqual([{}])
    expect(() => emit(target as never, notifyOpen, 's1' as never)).toThrow(/notify\.open: invalid event payload/)
    expect(sent).toHaveLength(1)
  })
})

describe('PendingOpens', () => {
  it('hands a note out once, the latest of a window, only within PENDING_OPEN_MS, without other keys', () => {
    let now = 0
    const pending = new PendingOpens(() => now)
    pending.hold(1, { sessionId: 'a', projectRoot: null, title: 'extra' } as never)
    pending.hold(1, { sessionId: 'b', projectRoot: null, body: 'extra' } as never)
    pending.hold(2, { sessionId: 'c', projectRoot: '/r' })
    expect(pending.take(1)).toEqual({ sessionId: 'b', projectRoot: null })
    expect(pending.take(1)).toBeNull()
    now = PENDING_OPEN_MS - 1
    expect(pending.take(2)).toEqual({ sessionId: 'c', projectRoot: '/r' })
    pending.hold(2, { sessionId: 'd', projectRoot: null })
    now += PENDING_OPEN_MS
    expect(pending.take(2)).toBeNull()
  })
})

describe('notify.pending at the IPC boundary', () => {
  async function harness() {
    const { notifyHandlers } = await import('../../src/main/ipc/notify')
    const { registerIpc } = await import('../../src/main/ipc/index')
    const pending = new PendingOpens()
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener as never) }, { modules: { './notify.ts': () => Promise.resolve(notifyHandlers(pending)) }, isTrustedSender: (url) => url === APP_URL })
    const callFrom = (sender: unknown, input?: unknown) => handlers.get('worfy:notify.pending')?.({ senderFrame: { url: APP_URL }, sender }, input)
    const call = (senderId: number, input?: unknown) => callFrom({ id: senderId }, input)
    return { pending, call, callFrom }
  }

  /** A client without a window (src/main/clients.ts), e.g. a Linked machine's connection. */
  function windowless(id: string) {
    const onDestroyed: (() => void)[] = []
    const client = { id, send: () => undefined, isDestroyed: () => false, once: (_event: 'destroyed', listener: () => void) => onDestroyed.push(listener) }
    return { client, onDestroyed, destroy: () => onDestroyed.splice(0).forEach((listener) => listener()) }
  }

  it('answers the note of a client without a window to that client only, and drops it when the client is destroyed', async () => {
    const h = await harness()
    const linked = windowless('link:machine-b')
    h.pending.holdFor(linked.client, { sessionId: 's1', projectRoot: '/r' })
    h.pending.hold(4, { sessionId: 's2', projectRoot: null })
    // Neither a window nor another client gets it.
    expect(await h.call(4)).toEqual({ ok: true, value: { note: { sessionId: 's2', projectRoot: null } } })
    expect(await h.callFrom(windowless('link:machine-c').client)).toEqual({ ok: true, value: { note: null } })
    expect(await h.callFrom(linked.client)).toEqual({ ok: true, value: { note: { sessionId: 's1', projectRoot: '/r' } } })
    expect(await h.callFrom(linked.client)).toEqual({ ok: true, value: { note: null } })

    // A note left untaken goes with the client; one listener per client however many notes it gets.
    h.pending.holdFor(linked.client, { sessionId: 's3', projectRoot: null })
    h.pending.holdFor(linked.client, { sessionId: 's4', projectRoot: null })
    expect(linked.onDestroyed).toHaveLength(1)
    linked.destroy()
    expect(await h.callFrom(linked.client)).toEqual({ ok: true, value: { note: null } })
    // A client that comes back under the same id is watched again.
    const back = windowless('link:machine-b')
    h.pending.holdFor(back.client, { sessionId: 's5', projectRoot: null })
    back.destroy()
    expect(h.pending.take('link:machine-b')).toBeNull()
  })

  it('a late destroyed of an old client keeps the note of a new client with its id', async () => {
    const h = await harness()
    const old = windowless('link:machine-b')
    h.pending.holdFor(old.client, { sessionId: 's1', projectRoot: null })
    // The old connection closed, its destroyed is on the way; a new one comes under the same id.
    const fresh = windowless('link:machine-b')
    h.pending.holdFor(fresh.client, { sessionId: 's2', projectRoot: null })
    // A late note for the old client, already destroyed, is not kept and takes nothing back.
    old.client.isDestroyed = () => true
    h.pending.holdFor(old.client, { sessionId: 'late', projectRoot: null })
    old.destroy()
    expect(await h.callFrom(fresh.client)).toEqual({ ok: true, value: { note: { sessionId: 's2', projectRoot: null } } })
    // The new client's own destroyed still drops its note.
    h.pending.holdFor(fresh.client, { sessionId: 's3', projectRoot: null })
    fresh.destroy()
    expect(h.pending.take('link:machine-b')).toBeNull()
  })

  it('answers no note to a call without a client', async () => {
    const h = await harness()
    h.pending.hold(4, { sessionId: 's1', projectRoot: null })
    expect(await h.callFrom(undefined)).toEqual({ ok: true, value: { note: null } })
    expect(h.pending.take(4)).toEqual({ sessionId: 's1', projectRoot: null })
  })

  it('answers the note of the asking window only, once', async () => {
    const h = await harness()
    h.pending.hold(4, { sessionId: 's1', projectRoot: null })
    expect(await h.call(5)).toEqual({ ok: true, value: { note: null } })
    expect(await h.call(4)).toEqual({ ok: true, value: { note: { sessionId: 's1', projectRoot: null } } })
    expect(await h.call(4)).toEqual({ ok: true, value: { note: null } })
  })

  it('refuses an input it does not take, and leaves the note in place', async () => {
    const h = await harness()
    h.pending.hold(4, { sessionId: 's1', projectRoot: null })
    expect(await h.call(4, { sessionId: 'other' })).toMatchObject({ ok: false })
    expect(h.pending.take(4)).toEqual({ sessionId: 's1', projectRoot: null })
  })
})

describe('the gate queue: a PR that has waited over an hour (worfy-windows ticket 17)', () => {
  const ROOT = '/Users/test/worfy'
  const PROJECT = { root: ROOT, name: 'worfy' }
  const START = Date.parse('2026-10-18T06:00:00Z')
  const MIN = 60_000
  const labelled = (commits: { oid: string; committedDate: string }[]): QueuePr => ({
    number: 480,
    title: 'Gate queue',
    url: 'https://github.com/o/r/pull/480',
    createdAt: new Date(START).toISOString(),
    commits,
    comments: [],
  })
  /** The notices over a fake clock and fake Electron parts, fed reads made by rule 1 at that clock. */
  function gate(role: 'serve' | 'request' = 'serve') {
    let now = START
    let focused = false
    const commits = [{ oid: 'c1', committedDate: new Date(START).toISOString() }]
    let pr = labelled(commits)
    const shown: { note: WindowNote; click: () => void }[] = []
    const opened: WindowNote[] = []
    const notices = new GateQueueNotices({
      focused: () => focused,
      show: (note, click) => shown.push({ note, click }),
      open: (note) => opened.push(note),
    })
    const read = (): void => notices.read(PROJECT, { role, label: 'needs-mac-gate', gh: { state: 'ok' }, waiting: waitingPrs([pr], 'Mac checks', 'mac-bot', now) })
    return {
      shown,
      opened,
      read,
      wait: (ms: number) => {
        now += ms
      },
      focus: (value: boolean) => {
        focused = value
      },
      push: (oid: string) => {
        commits.push({ oid, committedDate: new Date(now).toISOString() })
        pr = labelled([...commits])
      },
    }
  }

  it('59 minutes: none; 61: one; the next read with the same commit: none; a new commit and another hour: one more', () => {
    const g = gate()
    g.wait(59 * MIN)
    g.read()
    expect(g.shown).toHaveLength(0)
    g.wait(2 * MIN)
    g.read()
    expect(g.shown).toHaveLength(1)
    g.wait(5 * MIN)
    g.read()
    expect(g.shown).toHaveLength(1)
    // A new commit: the wait counts from it.
    g.push('c2')
    g.wait(30 * MIN)
    g.read()
    expect(g.shown).toHaveLength(1)
    g.wait(31 * MIN)
    g.read()
    expect(g.shown).toHaveLength(2)
  })

  it('a focused worfy window: none; the next read after the focus is lost shows it', () => {
    const g = gate()
    g.wait(61 * MIN)
    g.focus(true)
    g.read()
    expect(g.shown).toHaveLength(0)
    g.focus(false)
    g.wait(5 * MIN)
    g.read()
    expect(g.shown).toHaveLength(1)
  })

  it('the text on serve and on request; the title is the Project\'s name', () => {
    const serve = gate('serve')
    serve.wait(61 * MIN)
    serve.read()
    expect(serve.shown[0]?.note).toEqual({ title: 'worfy', body: 'PR #480 Gate queue has waited for the gate queue for over an hour. Run Process gate queue', sessionId: null })
    const request = gate('request')
    request.wait(61 * MIN)
    request.read()
    expect(request.shown[0]?.note.body).toBe('PR #480 Gate queue has waited for the gate queue for over an hour. No machine has taken it yet')
  })

  it('a read that failed, or a Project without the gate: nothing', () => {
    const shown: unknown[] = []
    const notices = new GateQueueNotices({ focused: () => false, show: (note) => shown.push(note), open: () => undefined })
    const waiting = waitingPrs([labelled([])], 'Mac checks', 'mac-bot', START + 2 * 60 * MIN)
    notices.read(PROJECT, { role: 'serve', label: 'needs-mac-gate', gh: { state: 'failed', reason: 'HTTP 502' }, waiting })
    notices.read(PROJECT, { role: null, label: null, gh: { state: 'skipped', reason: 'no field' }, waiting })
    expect(shown).toEqual([])
  })

  it('two Projects, each read twice: two notifications, not four; one Project\'s read keeps the other\'s marks', () => {
    const shown: WindowNote[] = []
    const notices = new GateQueueNotices({ focused: () => false, show: (note) => shown.push(note), open: () => undefined })
    const waiting = waitingPrs([labelled([{ oid: 'c1', committedDate: new Date(START).toISOString() }])], 'Mac checks', 'mac-bot', START + 2 * 60 * MIN)
    const other = { root: '/Users/test/auction', name: 'auction' }
    for (let round = 0; round < 2; round += 1) {
      notices.read(PROJECT, { role: 'serve', label: 'needs-mac-gate', gh: { state: 'ok' }, waiting })
      notices.read(other, { role: 'serve', label: 'needs-mac-gate', gh: { state: 'ok' }, waiting })
    }
    expect(shown.map((note) => note.title)).toEqual(['worfy', 'auction'])
  })

  it('a click raises the window and opens no Session: no note waits for the renderer, no notify.open', () => {
    const g = gate()
    g.wait(61 * MIN)
    g.read()
    g.shown[0]?.click()
    expect(g.opened).toEqual([g.shown[0]?.note])
    const pending = new PendingOpens()
    const open = fakeWindow(9, { minimized: true })
    electron.windows = [open.window]
    const create = vi.fn()
    openNote(g.opened[0]!, pending, create, NORMAL_WINDOWS)
    expect(create).not.toHaveBeenCalled()
    expect(open.calls).toEqual(['restore', 'show', 'focus'])
    expect(open.sent).toEqual([])
    expect(pending.take(9)).toBeNull()
    electron.windows = []
  })

  it('without a window: the click opens one, and still no Session', () => {
    const pending = new PendingOpens()
    const created = fakeWindow(10)
    electron.windows = []
    openNote({ title: 'worfy', body: 'PR #480', sessionId: null }, pending, () => created.window as never, NORMAL_WINDOWS)
    expect(created.sent).toEqual([])
    expect(pending.take(10)).toBeNull()
  })

  it('the Electron notification carries the note\'s title and body', () => {
    electron.shown.length = 0
    withQuietWindows(undefined, () => electronWindowNoteDeps.show({ title: 'worfy', body: 'PR #480 waits', sessionId: null }, () => undefined))
    expect(electron.shown).toEqual([{ title: 'worfy', body: 'PR #480 waits' }])
  })

  it('with its default tick, the watcher gets a new read within a minute of the reader\'s 5-minute interval, though another caller read in between', async () => {
    vi.useFakeTimers()
    try {
      const refreshes: number[] = []
      let readAt = -Infinity
      // The reader's own rule: its last read until GATE_QUEUE_INTERVAL_MS is over.
      const reader = {
        read: () => {
          if (Date.now() - readAt >= GATE_QUEUE_INTERVAL_MS) {
            readAt = Date.now()
            refreshes.push(readAt)
          }
          return Promise.resolve({ role: 'serve' as const, label: 'needs-mac-gate', gh: { state: 'ok' as const }, waiting: [] })
        },
      }
      const stop = installGateQueueNotifications(reader, () => [{ path: ROOT, name: 'worfy' }], { focused: () => false, show: () => undefined, open: () => undefined })
      // The menu of the Project reads too, between two ticks: the reader's interval then counts from it.
      await vi.advanceTimersByTimeAsync(MIN / 2)
      void reader.read()
      await vi.advanceTimersByTimeAsync(31 * MIN)
      stop()
      const gaps = refreshes.slice(1).map((at, index) => at - refreshes[index]!)
      expect(gaps.length).toBeGreaterThanOrEqual(4)
      for (const gap of gaps) expect(gap).toBeLessThanOrEqual(GATE_QUEUE_INTERVAL_MS + MIN)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the watcher reads every Project of the list each interval, and stops', async () => {
    vi.useFakeTimers()
    try {
      const reads: string[] = []
      const shown: WindowNote[] = []
      const reader = {
        read: (root: string) => {
          reads.push(root)
          return Promise.resolve({ role: 'serve' as const, label: 'needs-mac-gate', gh: { state: 'ok' as const }, waiting: waitingPrs([labelled([])], 'Mac checks', 'mac-bot', START + 2 * 60 * MIN) })
        },
      }
      const stop = installGateQueueNotifications(reader, () => [{ path: ROOT, name: 'worfy' }, { path: '/Users/test/auction', name: 'auction' }], { focused: () => false, show: (note) => shown.push(note), open: () => undefined }, 1_000)
      expect(reads).toEqual([])
      await vi.advanceTimersByTimeAsync(1_000)
      expect(reads).toEqual([ROOT, '/Users/test/auction'])
      expect(shown.map((note) => note.title)).toEqual(['worfy', 'auction'])
      stop()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(reads).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a Ticket that comes to wait for the owner (worfy-pipeline ticket 06)', () => {
  const ROOT = '/projects/worfy'
  const PIPELINE: PipelineColumn[] = (
    [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'ci' }, { kind: 'agent-review' }, { kind: 'gate-merge' }, { kind: 'closing' }, { kind: 'done' }] as PipelineStage[]
  ).map((stage) => ({ ...stage, id: stageId(stage), title: stageLabel(stage) }))

  /** A Ticket on Stage `kind` of the Pipeline above, with its Waits and Status time. */
  const onStage = (epic: string, num: number, kind: string, extra: Partial<PipelineTicket> = {}): PipelineTicket => {
    const index = PIPELINE.findIndex((column) => column.id === kind)
    return {
      epic,
      num,
      stage: kind,
      index,
      kind: PIPELINE[index]!.kind,
      passed: PIPELINE.slice(0, index).map((column) => column.id),
      skipped: [],
      blocked: null,
      rework: false,
      sub: null,
      waits: 'agent',
      enteredAt: null,
      statusAt: '2026-10-18T09:00Z',
      ...extra,
    }
  }
  const snapshot = (tickets: PipelineTicket[], root = ROOT): PipelineSnapshot => ({ root, pipeline: PIPELINE, tickets, error: null })
  const owner = (epic: string, num: number, reason: string | null, statusAt = '2026-10-18T10:00Z', kind = 'implementing'): PipelineTicket =>
    onStage(epic, num, kind, { waits: 'owner', blocked: { reason }, statusAt })

  function waits() {
    const h = harness()
    const shown: { note: TicketNote; click: () => void }[] = []
    const opened: TicketNote[] = []
    const display = new NoteDisplay<TicketNote>({ focused: () => h.focused(), show: (note, click) => shown.push({ note, click }), open: (note) => opened.push(note), now: () => h.now() })
    return { focus: h.focus, wait: h.wait, shown, opened, notices: new WaitsNotices(display) }
  }

  it('a Ticket going into Waits: owner gives one notification: «<epic> NN ждёт тебя» with the Blocked reason', () => {
    const w = waits()
    w.notices.read(snapshot([onStage('worfy-link', 16, 'implementing')]))
    expect(w.shown).toEqual([])
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    expect(w.shown.map((each) => [each.note.title, each.note.body])).toEqual([['worfy-link 16 ждёт тебя', 'приёмка']])
    expect(w.shown[0]!.note).toMatchObject({ projectRoot: ROOT, ticket: { epic: 'worfy-link', num: 16 } })
  })

  it('without a Blocked reason the text is the name of the Stage', () => {
    const w = waits()
    w.notices.read(snapshot([]))
    w.notices.read(snapshot([owner('worfy-pipeline', 6, null, '2026-10-18T10:00Z', 'ci')]))
    expect(w.shown.map((each) => [each.note.title, each.note.body])).toEqual([['worfy-pipeline 06 ждёт тебя', 'CI']])
  })

  it('the same wait seen again — the same snapshot, a Stage that moved — gives no second notification; a new Status time does', () => {
    const w = waits()
    w.notices.read(snapshot([]))
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    w.wait(NOTIFY_INTERVAL_MS)
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка', '2026-10-18T10:00Z', 'ci')]))
    expect(w.shown).toHaveLength(1)
    // It stopped waiting and came back with a new `ticket block`: a new wait.
    w.notices.read(snapshot([onStage('worfy-link', 16, 'implementing')]))
    w.notices.read(snapshot([owner('worfy-link', 16, 'ещё раз', '2026-10-18T12:00Z')]))
    expect(w.shown.map((each) => each.note.body)).toEqual(['приёмка', 'ещё раз'])
  })

  it('a wait that leaves and comes back with the same Status time is the same wait: no second notification', () => {
    const w = waits()
    w.notices.read(snapshot([]))
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    w.notices.read(snapshot([]))
    w.wait(NOTIFY_INTERVAL_MS)
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    expect(w.shown).toHaveLength(1)
  })

  it('on the start of worfy, Tickets already waiting for the owner give none; one that comes to wait later does', () => {
    const w = waits()
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка'), onStage('worfy-link', 17, 'ci')]))
    expect(w.shown).toEqual([])
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка'), owner('worfy-link', 17, 'merge')]))
    expect(w.shown.map((each) => each.note.title)).toEqual(['worfy-link 17 ждёт тебя'])
  })

  it('the first snapshot of each Project is its own start; Projects do not share their waits', () => {
    const w = waits()
    w.notices.read(snapshot([owner('e', 1, 'a')], '/projects/a'))
    w.notices.read(snapshot([owner('e', 1, 'b')], '/projects/b'))
    expect(w.shown).toEqual([])
    w.notices.read(snapshot([owner('e', 1, 'a'), owner('e', 2, 'a2')], '/projects/a'))
    expect(w.shown.map((each) => each.note.projectRoot)).toEqual(['/projects/a'])
  })

  it('a snapshot without Tickets because the workflow model failed is no start: what waits after it gives none', () => {
    const w = waits()
    w.notices.read({ ...snapshot([]), error: 'the workflow model is empty: no epics' })
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    expect(w.shown).toEqual([])
    // Nor does a failed read in the middle make the waits after it new.
    w.notices.read({ ...snapshot([]), error: 'the workflow model is empty: no epics' })
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    expect(w.shown).toEqual([])
  })

  it('Waits: team or a Machine gives none; only the owner', () => {
    const w = waits()
    w.notices.read(snapshot([]))
    w.notices.read(snapshot([onStage('e', 1, 'ci', { waits: 'team' }), onStage('e', 2, 'ci', { waits: 'Windows PC' })]))
    expect(w.shown).toEqual([])
  })

  it('a snapshot with Tickets and an error (gh unavailable, the Profile unread) still notifies: the error only marks facts missing', () => {
    const w = waits()
    w.notices.read(snapshot([]))
    w.notices.read({ ...snapshot([owner('worfy-link', 16, 'приёмка')]), error: 'gh is unavailable' })
    expect(w.shown.map((each) => each.note.title)).toEqual(['worfy-link 16 ждёт тебя'])
  })

  it('two Projects with the same epic and NN, both waiting within 10 s: each gives its notification', () => {
    const w = waits()
    w.notices.read(snapshot([], '/projects/a'))
    w.notices.read(snapshot([], '/projects/b'))
    w.notices.read(snapshot([owner('worfy-link', 16, 'a')], '/projects/a'))
    w.notices.read(snapshot([owner('worfy-link', 16, 'b')], '/projects/b'))
    expect(w.shown.map((each) => [each.note.projectRoot, each.note.title])).toEqual([
      ['/projects/a', 'worfy-link 16 ждёт тебя'],
      ['/projects/b', 'worfy-link 16 ждёт тебя'],
    ])
  })

  it('the old rules of showing: none while a worfy window has focus, and one per Ticket in 10 s', () => {
    const w = waits()
    w.notices.read(snapshot([]))
    w.focus(true)
    w.notices.read(snapshot([owner('e', 1, 'a')]))
    expect(w.shown).toEqual([])
    w.focus(false)
    w.notices.read(snapshot([owner('e', 1, 'a'), owner('e', 2, 'b')]))
    // A different Ticket is counted on its own.
    expect(w.shown.map((each) => each.note.title)).toEqual(['e 02 ждёт тебя'])
    w.notices.read(snapshot([owner('e', 1, 'a'), owner('e', 2, 'b', '2026-10-18T11:00Z')]))
    expect(w.shown).toHaveLength(1)
  })

  it('a click opens the Pipeline board of the Project: the note waits for the window as a Pipeline note, with no Session', () => {
    const w = waits()
    w.notices.read(snapshot([]))
    w.notices.read(snapshot([owner('worfy-link', 16, 'приёмка')]))
    w.shown[0]!.click()
    expect(w.opened).toEqual([w.shown[0]!.note])

    const pending = new PendingOpens()
    const open = fakeWindow(9)
    electron.windows = [open.window]
    openNote(w.shown[0]!.note, pending, vi.fn() as never, NORMAL_WINDOWS)
    expect(open.sent).toEqual([{ channel: 'worfy:notify.open', payload: {} }])
    expect(pending.take(9)).toEqual({ view: 'pipeline', projectRoot: ROOT, epic: 'worfy-link', num: 16 })
    electron.windows = []
  })

  it('the Pipeline note passes notify.pending at the IPC boundary', async () => {
    const { notifyOpenSchema } = await import('../../src/shared/ipc/notify')
    expect(notifyOpenSchema.parse({ view: 'pipeline', projectRoot: ROOT, epic: 'worfy-link', num: 16, extra: 1 })).toEqual({ view: 'pipeline', projectRoot: ROOT, epic: 'worfy-link', num: 16 })
    expect(notifyOpenSchema.safeParse({ view: 'pipeline', projectRoot: ROOT }).success).toBe(false)
    expect(notifyOpenSchema.parse({ sessionId: 's1', projectRoot: null })).toEqual({ sessionId: 's1', projectRoot: null })
  })

  it('a snapshot that comes before main answered the open is the start; the older answer after it changes nothing', async () => {
    let answer: (snapshot: PipelineSnapshot) => void = () => undefined
    let subscriber: StageSubscriber | undefined
    const hub = {
      open: (_root: string, each: StageSubscriber) => {
        subscriber = each
        return new Promise<PipelineSnapshot>((resolve) => {
          answer = resolve
        })
      },
      close: async () => true,
    }
    const shown: string[] = []
    const stop = installWaitsNotifications(hub, () => [{ path: ROOT }], { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
    await Promise.resolve()
    // The newer snapshot first: e 1 waits already, so it is part of the start.
    subscriber!.send(snapshot([owner('e', 1, 'newer')]))
    // The answer of the open is older: e 2 waited then; it is not taken for a new wait.
    answer(snapshot([owner('e', 2, 'older')]))
    await Promise.resolve()
    await Promise.resolve()
    subscriber!.send(snapshot([owner('e', 1, 'newer'), owner('e', 3, 'new')]))
    expect(shown).toEqual(['e 03 ждёт тебя'])
    stop()
    // A snapshot after the stop shows nothing.
    subscriber!.send(snapshot([owner('e', 4, 'late')]))
    expect(shown).toEqual(['e 03 ждёт тебя'])
  })

  it('installNotifications with the Stage hub follows the listed Projects, shows the notes by its deps, and lets them go when stopped', async () => {
    let subscriber: StageSubscriber | undefined
    const hub = {
      open: vi.fn(async (_root: string, each: StageSubscriber) => {
        subscriber = each
        return snapshot([])
      }),
      close: vi.fn(async () => true),
    }
    const shown: TicketNote[] = []
    const deps = { focused: () => false, show: (note: TicketNote) => shown.push(note), open: vi.fn(), now: () => 1 }
    const stop = installNotifications({ observe: () => () => undefined }, new Set(), undefined, undefined, { hub, projects: () => [{ path: ROOT }], deps })
    await Promise.resolve()
    await Promise.resolve()
    expect(hub.open).toHaveBeenCalledWith(ROOT, expect.objectContaining({ id: 'waits-notify' }))
    subscriber!.send(snapshot([owner('worfy-link', 16, 'приёмка')]))
    expect(shown.map((note) => note.title)).toEqual(['worfy-link 16 ждёт тебя'])
    stop()
    expect(hub.close).toHaveBeenCalledWith(ROOT, 'waits-notify')
  })

  it('watches the Stages of every Project of the list: the first snapshot is the start, the later ones notify; a Project gone from the list is let go', async () => {
    vi.useFakeTimers()
    try {
      const subscribers = new Map<string, StageSubscriber>()
      const closed: string[] = []
      const first: Record<string, PipelineSnapshot> = {
        '/projects/a': snapshot([owner('e', 1, 'already')], '/projects/a'),
        '/projects/b': snapshot([], '/projects/b'),
      }
      const hub = {
        open: vi.fn(async (root: string, subscriber: StageSubscriber) => {
          subscribers.set(root, subscriber)
          const answer = first[root]
          if (answer === undefined) throw new Error(`the Stages of ${root} could not be computed`)
          return answer
        }),
        close: vi.fn(async (root: string) => {
          closed.push(root)
          subscribers.delete(root)
          return true
        }),
      }
      let list = [{ path: '/projects/a' }, { path: '/projects/b' }]
      const shown: string[] = []
      const display = { show: (note: { title: string }) => shown.push(note.title) }
      const stop = installWaitsNotifications(hub, () => list, display, 60_000)
      await vi.advanceTimersByTimeAsync(0)
      expect(hub.open).toHaveBeenCalledTimes(2)
      expect(shown).toEqual([])

      subscribers.get('/projects/a')!.send(snapshot([owner('e', 1, 'already'), owner('e', 2, 'new')], '/projects/a'))
      expect(shown).toEqual(['e 02 ждёт тебя'])

      // The next tick opens nothing twice; a Project gone from the list is closed.
      list = [{ path: '/projects/a' }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(hub.open).toHaveBeenCalledTimes(2)
      expect(closed).toEqual(['/projects/b'])

      // A Project whose Stages could not be computed is let go of and tried again on the next tick.
      list = [{ path: '/projects/a' }, { path: '/projects/c' }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(hub.open).toHaveBeenCalledTimes(3)
      expect(closed).toEqual(['/projects/b', '/projects/c'])
      first['/projects/c'] = snapshot([owner('e', 3, 'was there')], '/projects/c')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(hub.open).toHaveBeenCalledTimes(4)
      expect(shown).toEqual(['e 02 ждёт тебя'])

      stop()
      await vi.advanceTimersByTimeAsync(0)
      expect(closed.slice(2).sort()).toEqual(['/projects/a', '/projects/c'])
      await vi.advanceTimersByTimeAsync(120_000)
      expect(hub.open).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  /** A Stage hub whose every open waits for the test: `answer(i, …)` resolves the i-th, `fail(i)` rejects it. */
  function heldHub() {
    const opens: { root: string; subscriber: StageSubscriber; resolve: (snapshot: PipelineSnapshot) => void; reject: (error: Error) => void }[] = []
    const closed: string[] = []
    const hub = {
      open: (root: string, subscriber: StageSubscriber) =>
        new Promise<PipelineSnapshot>((resolve, reject) => {
          opens.push({ root, subscriber, resolve, reject })
        }),
      close: async (root: string) => {
        closed.push(root)
        return true
      },
    }
    return { hub, opens, closed }
  }

  it('a Project removed from the list and added again starts afresh: what began to wait while it was gone gives none', async () => {
    vi.useFakeTimers()
    try {
      const { hub, opens } = heldHub()
      let list = [{ path: ROOT }]
      const shown: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
      opens[0]!.resolve(snapshot([]))
      await vi.advanceTimersByTimeAsync(0)
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: ROOT }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toHaveLength(2)
      opens[1]!.resolve(snapshot([owner('e', 1, 'began while gone')]))
      await vi.advanceTimersByTimeAsync(0)
      expect(shown).toEqual([])
      opens[1]!.subscriber.send(snapshot([owner('e', 1, 'began while gone'), owner('e', 2, 'new')]))
      expect(shown).toEqual(['e 02 ждёт тебя'])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the Stage hub answers in its own spelling of the root (path.resolve, C:\\… on Windows): a Project removed and added again still starts afresh', async () => {
    vi.useFakeTimers()
    try {
      const { hub, opens } = heldHub()
      const listed = 'C:/Users/owner/worfy'
      const resolved = 'C:\\Users\\owner\\worfy'
      let list = [{ path: listed }]
      const shown: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
      opens[0]!.resolve(snapshot([], resolved))
      await vi.advanceTimersByTimeAsync(0)
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: listed }]
      await vi.advanceTimersByTimeAsync(60_000)
      opens[1]!.resolve(snapshot([owner('e', 1, 'began while gone')], resolved))
      await vi.advanceTimersByTimeAsync(0)
      expect(shown).toEqual([])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the answer of an open made before the Project left the list and came back changes nothing: the new open is the start', async () => {
    vi.useFakeTimers()
    try {
      const { hub, opens } = heldHub()
      let list = [{ path: ROOT }]
      const shown: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: ROOT }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toHaveLength(2)
      // The old open answers late, with an older snapshot: were it the start, e 1 would look new.
      opens[0]!.resolve(snapshot([]))
      await vi.advanceTimersByTimeAsync(0)
      opens[1]!.resolve(snapshot([owner('e', 1, 'already')]))
      await vi.advanceTimersByTimeAsync(0)
      expect(shown).toEqual([])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a rejection of an open made before the Project left the list and came back lets the new follow be: it is not closed and still notifies', async () => {
    vi.useFakeTimers()
    try {
      const { hub, opens, closed } = heldHub()
      let list = [{ path: ROOT }]
      const shown: string[] = []
      const logs: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note: { title: string }) => shown.push(note.title) }, 60_000, (message) => logs.push(message))
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      expect(closed).toEqual([ROOT])
      list = [{ path: ROOT }]
      await vi.advanceTimersByTimeAsync(60_000)
      opens[1]!.resolve(snapshot([]))
      await vi.advanceTimersByTimeAsync(0)
      opens[0]!.reject(new Error('the Stages could not be computed'))
      await vi.advanceTimersByTimeAsync(0)
      expect(closed).toEqual([ROOT])
      expect(logs).toEqual([])
      opens[1]!.subscriber.send(snapshot([owner('e', 1, 'new')]))
      expect(shown).toEqual(['e 01 ждёт тебя'])
      // Nor is the Project opened again: it is followed.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toHaveLength(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a Project whose Stages keep failing is tried again after a pause that doubles up to 32 minutes; one warn line per try', async () => {
    vi.useFakeTimers()
    try {
      let opens = 0
      let fails = true
      const hub = {
        open: vi.fn(async () => {
          opens += 1
          if (fails) throw new Error('the Stages could not be computed')
          return snapshot([])
        }),
        close: vi.fn(async () => true),
      }
      let list = [{ path: ROOT }]
      const logs: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: () => undefined }, 60_000, (message) => logs.push(message))
      await vi.advanceTimersByTimeAsync(0)
      // Tries at minutes 0, 1, 3, 7, 15, 31, 63, then every 32 minutes: 95, 127.
      const at: number[] = [0]
      for (let minute = 1; minute <= 127; minute += 1) {
        const before = opens
        await vi.advanceTimersByTimeAsync(60_000)
        if (opens > before) at.push(minute)
      }
      expect(at).toEqual([0, 1, 3, 7, 15, 31, 63, 95, 127])
      expect(logs).toHaveLength(9)
      expect(logs.at(-1)).toContain('tried again in 1920 s')
      // Gone from the list and back: the pause starts over.
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: ROOT }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toBe(10)
      expect(logs.at(-1)).toContain('tried again in 60 s')
      // A read that succeeds ends the tries: the Project is followed.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toBe(11)
      fails = false
      await vi.advanceTimersByTimeAsync(120_000)
      expect(opens).toBe(12)
      await vi.advanceTimersByTimeAsync(40 * 60_000)
      expect(opens).toBe(12)
      expect(logs).toHaveLength(11)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
