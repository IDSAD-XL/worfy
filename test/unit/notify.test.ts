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
function fakeWindow(id: number, { loading = false, minimized = false } = {}) {
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
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      once: (event: string, listener: () => void) => {
        if (event === 'destroyed') destroyed.push(listener)
      },
    },
  }
  return { window, sent, calls, destroy: () => destroyed.forEach((each) => each()) }
}

describe('a click on a notification', () => {
  const note: Note = { title: 'alpha', body: 'Needs permission: Bash ls', sessionId: 's1', projectRoot: null }

  it('raises the open window and sends it the Session to open', () => {
    const pending = new PendingOpens()
    const open = fakeWindow(1, { minimized: true })
    electron.windows = [open.window]
    const create = vi.fn()
    openNote(note, pending, create)
    expect(create).not.toHaveBeenCalled()
    expect(open.calls).toEqual(['restore', 'show', 'focus'])
    expect(open.sent).toEqual([{ channel: 'worfy:notify.open', payload: { sessionId: 's1', projectRoot: null } }])
    expect(pending.take(1)).toBeNull()
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

  it('keeps the note for a window still loading, and forgets it when the window goes away', () => {
    const pending = new PendingOpens()
    const loading = fakeWindow(3, { loading: true })
    electron.windows = [loading.window]
    openNote(note, pending, vi.fn() as never)
    expect(loading.sent).toEqual([])
    openNote({ ...note, sessionId: 's2' }, pending, vi.fn() as never)
    loading.destroy()
    expect(pending.take(3)).toBeNull()

    openNote({ ...note, sessionId: 's3' }, pending, vi.fn() as never)
    expect(pending.take(3)).toEqual({ sessionId: 's3', projectRoot: null })
    electron.windows = []
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
    const call = (senderId: number, input?: unknown) => handlers.get('worfy:notify.pending')?.({ senderFrame: { url: APP_URL }, sender: { id: senderId } }, input)
    return { pending, call }
  }

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
