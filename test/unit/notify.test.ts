// When worfy shows a macOS notification and how often (ticket 21, src/main/notify.ts): a Session
// that finished its turn or asks for permission, only while no worfy window has focus, at most one
// per Session in 10 s; a click opens that Session. Electron's Notification is replaced by
// NotifyDeps.
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LiveSession } from '../../src/shared/ipc/claude-home'

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

const { NOTIFY_INTERVAL_MS, Notifier, electronNotifyDeps, installNotifications, openNote } = await import('../../src/main/notify')
const { PENDING_OPEN_MS, PendingOpens } = await import('../../src/main/notify-pending')
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
    expect(electronNotifyDeps.focused()).toBe(false)
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
    openNote(note, pending, create)
    expect(create).not.toHaveBeenCalled()
    expect(open.calls).toEqual(['restore', 'show', 'focus'])
    // The signal carries no Session: the overlay takes the note from main.
    expect(open.sent).toEqual([SIGNAL])
    expect(pending.take(1)).toEqual({ sessionId: 's1', projectRoot: null })
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
  const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

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
