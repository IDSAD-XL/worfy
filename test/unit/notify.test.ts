// When worfy shows a macOS notification and how often (ticket 21, src/main/notify.ts): a Session
// that finished its turn or asks for permission, only while no worfy window has focus, at most one
// per Session in 10 s; a click opens that Session. Electron's Notification is replaced by
// NotifyDeps.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { QueuePr } from '../../src/main/github/gate-queue'
import type { ListedProject, SharedTicketNote, TicketNote, WindowNote } from '../../src/main/notify'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import type { StageSubscriber } from '../../src/main/workflow/stages'
import type { WorkflowSubscriber } from '../../src/main/workflow/watch'
import type { Ticket, WorkflowDelta, WorkflowModel } from '../../src/shared/workflow/types'
import { APP_URL } from '../app-url'

const electron = vi.hoisted(() => ({
  shown: [] as { title: string; body: string }[],
  focused: null as unknown,
  windows: [] as unknown[],
  /** The process that owns the system's foreground window; null: worfy. */
  foregroundPid: null as number | null,
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
// On Windows the focus check asks PowerShell for the foreground window: here the answer is
// `electron.foregroundPid`, worfy by default, and no real PowerShell runs (test/unit/foreground.test.ts
// covers the check).
vi.mock('../../src/main/foreground', async (original) => ({
  ...(await original<typeof import('../../src/main/foreground')>()),
  foregroundPid: () => Promise.resolve({ pid: electron.foregroundPid ?? process.pid }),
}))

/** Lets promised focus answers reach their notes. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The app's hubs and Project list, as src/main/notify.ts's appWaitsSources takes them (worfy-pipeline
 * ticket 09): a workflow hub that only answers its model, and the Stage hub built as
 * src/main/ipc/pipeline.ts builds it over that workflow hub, with every source that would start a
 * process (`bin/profile`, git, gh) counted.
 */
const appHubs = vi.hoisted(() => ({
  projects: [] as { path: string }[],
  workflowOpens: [] as string[],
  stageOpens: [] as string[],
  calls: { profile: 0, git: 0, gh: 0 },
}))
vi.mock('../../src/main/projects/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/projects/store')>()),
  projectStore: () => ({ list: () => appHubs.projects }),
}))
vi.mock('../../src/main/ipc/workflow', () => {
  const model = (root: string) => ({
    root,
    epics: [],
    tickets: [{ epic: 'e', num: 1, slug: 's', title: 'T', statusRaw: 'blocked', state: 'blocked', statusAt: '2026-10-18T10:00Z', blockedReason: 'r', waits: 'owner', blockedRaw: null, blockedNums: [], blockedParsed: true, files: [], filesListed: true, fromBranch: null }],
    error: null,
    branchErrors: [],
  })
  return {
    workflowHub: {
      open: async (root: string) => {
        appHubs.workflowOpens.push(root)
        return model(root)
      },
      close: async () => true,
      model: async (root: string) => model(root),
      drop: async () => undefined,
    },
  }
})
vi.mock('../../src/main/ipc/pipeline', async () => {
  const { StageHub } = await import('../../src/main/workflow/stages')
  const { workflowHub } = await import('../../src/main/ipc/workflow')
  const stageHub = new StageHub({
    workflow: workflowHub as never,
    prs: {
      read: async () => {
        appHubs.calls.gh += 1
        return { pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } }
      },
    },
    profile: async () => {
      appHubs.calls.profile += 1
      return { ok: false, reason: 'stub' }
    },
    deployments: {} as never,
    harnessHome: '/nonexistent/harness',
    git: async () => {
      appHubs.calls.git += 1
      return { code: 1, stdout: '' }
    },
  })
  const open = stageHub.open.bind(stageHub)
  stageHub.open = (root, subscriber) => {
    appHubs.stageOpens.push(root)
    return open(root, subscriber)
  }
  return { stageHub }
})

const { MATCH_KEY_TTL_MS, NOTIFY_INTERVAL_MS, NoteDisplay, Notifier, RECEIVED_LIMIT, TicketNotes, ticketRecipients, appWaitsSources, GateQueueNotices, electronDeps, electronNotifyDeps, electronWindowNoteDeps, installGateQueueNotifications, installNotifications, followAppLinkPauses, installPairingPauseNotes, openNote, pairingPauseNoteBody } = await import('../../src/main/notify')
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
const { WaitsNotices, installWaitsNotifications, waitKey } = await import('../../src/main/workflow/waits-notify')
const { originKey, projectMatchKey, readProjectMatchKey, remoteHasHost } = await import('../../src/main/autopilot/origin')
const { StageHub } = await import('../../src/main/workflow/stages')
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

const question = (first = 'Which database should the cache use?'): AgentEvent => ({
  type: 'question_request',
  requestId: 'q1',
  toolUseId: 'toolu_q1',
  questions: [
    { question: first, header: 'Database', multiSelect: false, options: [{ label: 'Postgres', description: '', preview: null }, { label: 'SQLite', description: '', preview: null }] },
    { question: 'Which checks?', header: 'Checks', multiSelect: true, options: [{ label: 'Lint', description: '', preview: null }] },
  ],
})

describe('Notifier and questions (worfy-ui ticket 17)', () => {
  it('a question of a Session in the background says "Asks: <its first question>"; a click opens that Session', () => {
    const h = harness()
    h.notifier.sessionEvent('s1', init('/Users/test/alpha'))
    h.focus(true)
    h.notifier.sessionEvent('s1', question())
    expect(h.shown).toEqual([])

    h.focus(false)
    h.notifier.sessionEvent('s1', question())
    expect(h.shown.map((each) => each.note)).toEqual([{ title: 'alpha', body: 'Asks: Which database should the cache use?', sessionId: 's1', projectRoot: null }])
    h.shown[0]?.click()
    expect(h.opened).toEqual([{ title: 'alpha', body: 'Asks: Which database should the cache use?', sessionId: 's1', projectRoot: null }])
  })

  it('a long question is clipped like any note; the next one waits out the Session\'s interval', () => {
    const h = harness()
    h.notifier.sessionEvent('s1', question('x'.repeat(400)))
    expect(h.shown[0]?.note.body.length).toBeLessThan(400)
    expect(h.shown[0]?.note.body.startsWith('Asks: xxx')).toBe(true)
    h.notifier.sessionEvent('s1', question())
    expect(h.shown).toHaveLength(1)
  })
})

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

  it('a promised focus answer (Windows asks the system, worfy-windows ticket 113): the note shows once it says no window has focus; one held back is not counted', async () => {
    const answers: ((focused: boolean) => void)[] = []
    const shown: Note[] = []
    const notifier = new Notifier({
      focused: () => new Promise<boolean>((resolve) => answers.push(resolve)),
      show: (note) => shown.push(note),
      open: () => undefined,
      now: () => 1_000_000,
    })
    notifier.sessionEvent('s1', init('/Users/test/alpha'))
    notifier.sessionEvent('s1', result())
    expect(answers).toHaveLength(1)
    answers.shift()?.(true)
    await settle()
    expect(shown).toEqual([])

    notifier.sessionEvent('s1', result())
    expect(shown).toEqual([])
    answers.shift()?.(false)
    await settle()
    expect(shown).toEqual([{ title: 'alpha', body: 'All tests pass.', sessionId: 's1', projectRoot: null }])
  })

  it('a focus answer that fails is logged, not left as an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const shown: Note[] = []
      const notifier = new Notifier({
        focused: () => Promise.reject(new Error('boom')),
        show: (note) => shown.push(note),
        open: () => undefined,
        now: () => 1_000_000,
      })
      notifier.sessionEvent('s1', init('/Users/test/alpha'))
      notifier.sessionEvent('s1', result())
      await settle()
      expect(shown).toEqual([])
      expect(warn).toHaveBeenCalledWith('[notify] a notification was not shown: boom')
    } finally {
      warn.mockRestore()
    }
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
  it('shows an Electron Notification only when no window has focus', async () => {
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
    // On Windows the second answer comes from the system (worfy owns the foreground here): still silent.
    await settle()
    expect(electron.shown).toEqual([{ title: 'Session', body: 'All tests pass.' }])
    expect(electronNotifyDeps.focused()).toBe(false)
  })

  it('on Windows a window Electron calls focused counts only while worfy owns the foreground window (worfy-windows ticket 113)', async () => {
    electron.focused = {}
    electron.foregroundPid = process.pid + 1
    try {
      // The Windows wiring, built on any system.
      const windows = electronDeps('win32')
      await expect(Promise.resolve(windows.notify.focused())).resolves.toBe(false)
      await expect(Promise.resolve(windows.window.focused())).resolves.toBe(false)
      electron.foregroundPid = null
      await expect(Promise.resolve(windows.notify.focused())).resolves.toBe(true)
      await expect(Promise.resolve(windows.window.focused())).resolves.toBe(true)
      // macOS keeps Electron's answer.
      electron.foregroundPid = process.pid + 1
      expect(electronDeps('darwin').notify.focused()).toBe(true)
    } finally {
      electron.focused = null
      electron.foregroundPid = null
    }
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

  it('a promised focus answer (worfy-windows ticket 113): held back while it says focused; once it says not, one notification, however many reads waited for it', async () => {
    const answers: ((focused: boolean) => void)[] = []
    const shown: WindowNote[] = []
    const notices = new GateQueueNotices({ focused: () => new Promise<boolean>((resolve) => answers.push(resolve)), show: (note) => shown.push(note), open: () => undefined })
    const waiting = waitingPrs([labelled([{ oid: 'c1', committedDate: new Date(START).toISOString() }])], 'Mac checks', 'mac-bot', START + 2 * 60 * MIN)
    const read = (): void => notices.read(PROJECT, { role: 'serve', label: 'needs-mac-gate', gh: { state: 'ok' }, waiting })
    read()
    answers.shift()?.(true)
    await settle()
    expect(shown).toEqual([])

    read()
    read()
    expect(answers).toHaveLength(2)
    for (const answer of answers.splice(0)) answer(false)
    await settle()
    expect(shown.map((note) => note.body)).toEqual(['PR #480 Gate queue has waited for the gate queue for over an hour. Run Process gate queue'])
  })

  it('a read with no PR due (under an hour, or already shown) does not ask whether a window has focus (worfy-windows ticket 113: on Windows that starts PowerShell)', () => {
    const focused = vi.fn(() => false)
    const shown: WindowNote[] = []
    const notices = new GateQueueNotices({ focused, show: (note) => shown.push(note), open: () => undefined })
    const pr = labelled([{ oid: 'c1', committedDate: new Date(START).toISOString() }])
    const read = (at: number): void => notices.read(PROJECT, { role: 'serve', label: 'needs-mac-gate', gh: { state: 'ok' }, waiting: waitingPrs([pr], 'Mac checks', 'mac-bot', at) })
    read(START + 30 * MIN)
    expect(focused).not.toHaveBeenCalled()
    read(START + 61 * MIN)
    expect(focused).toHaveBeenCalledTimes(1)
    expect(shown).toHaveLength(1)
    read(START + 70 * MIN)
    expect(focused).toHaveBeenCalledTimes(1)
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

describe('a Ticket that comes to wait for the owner (worfy-pipeline tickets 06 and 09)', () => {
  const ROOT = '/projects/worfy'

  /** A Ticket of the workflow model, in work and waiting for an agent, with a timed Status. */
  const ticket = (epic: string, num: number, extra: Partial<Ticket> = {}): Ticket => ({
    epic,
    num,
    slug: 'slug',
    title: `Title of ${epic} ${num}`,
    statusRaw: 'work',
    state: 'work',
    statusAt: '2026-10-18T09:00Z',
    statusError: null,
    blockedReason: null,
    waits: 'agent',
    pr: null,
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    branch: null,
    repo: null,
    files: [],
    filesListed: true,
    fromBranch: null,
    ...extra,
  })
  /** A Ticket blocked with `Waits: owner`, its Blocked reason and Status time. */
  const owner = (epic: string, num: number, reason: string | null, statusAt: string | null = '2026-10-18T10:00Z'): Ticket =>
    ticket(epic, num, { state: 'blocked', statusRaw: 'blocked', waits: 'owner', blockedReason: reason, statusAt })
  const model = (tickets: Ticket[], root = ROOT): WorkflowModel => ({ root, epics: [], tickets, error: null, branchErrors: [] })
  const failed = (root = ROOT): WorkflowModel => ({ ...model([], root), error: { code: 'failed', message: 'epic-status failed' } })
  const delta = (tickets: Ticket[], root = ROOT): WorkflowDelta => ({ root, epics: [], tickets, removedEpics: [], removedTickets: [], error: null, branchErrors: [] })

  function waits() {
    const h = harness()
    const shown: { note: TicketNote; click: () => void }[] = []
    const opened: TicketNote[] = []
    const display = new NoteDisplay<TicketNote>({ focused: () => h.focused(), show: (note, click) => shown.push({ note, click }), open: (note) => opened.push(note), now: () => h.now() })
    // This Machine is "Mac" and has no Linked machine: a wait for the owner or for "Mac" shows here.
    const tickets = new TicketNotes(display, { machines: () => ({ self: 'Mac', linked: [] }) }, () => [{ path: ROOT }])
    return { focus: h.focus, wait: h.wait, shown, opened, notices: new WaitsNotices(tickets) }
  }

  it('a Ticket going into Waits: owner gives one notification: the title «<epic> NN» and the waiting phrase, the text its Blocked reason', () => {
    const w = waits()
    w.notices.read(ROOT, model([ticket('worfy-link', 16)]))
    expect(w.shown).toEqual([])
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
    expect(w.shown.map((each) => [each.note.title, each.note.body])).toEqual([['worfy-link 16 is waiting for you', 'acceptance']])
    expect(w.shown[0]!.note).toMatchObject({ projectRoot: ROOT, ticket: { epic: 'worfy-link', num: 16 } })
  })

  it('without a Blocked reason the text is «<epic> NN — <title of the Ticket>»', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.notices.read(ROOT, delta([owner('worfy-pipeline', 6, null)]))
    expect(w.shown.map((each) => [each.note.title, each.note.body])).toEqual([['worfy-pipeline 06 is waiting for you', 'worfy-pipeline 06 — Title of worfy-pipeline 6']])
  })

  it('the same wait seen again gives no second notification; a new Status time does', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
    w.wait(NOTIFY_INTERVAL_MS)
    // With a timed Status the key is the time: a new reason at the same time is the same wait.
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'another reason')]))
    expect(w.shown).toHaveLength(1)
    // It stopped waiting and came back with a new `ticket block`: a new wait.
    w.notices.read(ROOT, delta([ticket('worfy-link', 16)]))
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'once more', '2026-10-18T12:00Z')]))
    expect(w.shown.map((each) => each.note.body)).toEqual(['acceptance', 'once more'])
  })

  it('a Status with a date alone: a new Blocked reason on the same date is a second notification, the same reason again none', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance', '2026-10-18')]))
    w.wait(NOTIFY_INTERVAL_MS)
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'release', '2026-10-18')]))
    w.wait(NOTIFY_INTERVAL_MS)
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'release', '2026-10-18')]))
    expect(w.shown.map((each) => each.note.body)).toEqual(['acceptance', 'release'])
  })

  it('a Ticket without a Status time is keyed by its Status word and Blocked reason too', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.notices.read(ROOT, delta([owner('e', 1, 'a', null)]))
    w.wait(NOTIFY_INTERVAL_MS)
    w.notices.read(ROOT, delta([owner('e', 1, 'a', null)]))
    expect(w.shown).toHaveLength(1)
    // The Status word changed (blocked → work) with the same reason: a new wait.
    w.notices.read(ROOT, delta([{ ...owner('e', 1, 'a', null), state: 'work', statusRaw: 'work' }]))
    expect(w.shown).toHaveLength(2)
  })

  it('a wait that leaves and comes back with the same Status time is the same wait: no second notification', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
    w.notices.read(ROOT, delta([ticket('worfy-link', 16)]))
    w.wait(NOTIFY_INTERVAL_MS)
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
    expect(w.shown).toHaveLength(1)
  })

  it('on the start of worfy, Tickets already waiting for the owner give none; one that comes to wait later does', () => {
    const w = waits()
    w.notices.read(ROOT, model([owner('worfy-link', 16, 'acceptance'), ticket('worfy-link', 17)]))
    expect(w.shown).toEqual([])
    w.notices.read(ROOT, delta([owner('worfy-link', 17, 'merge')]))
    expect(w.shown.map((each) => each.note.title)).toEqual(['worfy-link 17 is waiting for you'])
  })

  it('the first model of each Project is its own start; Projects do not share their waits', () => {
    const w = waits()
    w.notices.read('/projects/a', model([owner('e', 1, 'a')], '/projects/a'))
    w.notices.read('/projects/b', model([owner('e', 1, 'b')], '/projects/b'))
    expect(w.shown).toEqual([])
    w.notices.read('/projects/a', delta([owner('e', 2, 'a2')], '/projects/a'))
    expect(w.shown.map((each) => each.note.projectRoot)).toEqual(['/projects/a'])
  })

  it('a model that failed is no start: the change that ends the failure is, and what waits in it gives none', () => {
    const w = waits()
    w.notices.read(ROOT, failed())
    // The change from the failed (empty) model carries every Ticket.
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
    expect(w.shown).toEqual([])
    // Nor does a failure in the middle make the waits after it new.
    w.notices.read(ROOT, { ...delta([]), removedTickets: [{ epic: 'worfy-link', num: 16 }], error: { code: 'failed', message: 'epic-status failed' } })
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
    expect(w.shown).toEqual([])
    w.notices.read(ROOT, delta([owner('worfy-link', 17, 'new')]))
    expect(w.shown.map((each) => each.note.title)).toEqual(['worfy-link 17 is waiting for you'])
  })

  it('Waits: team, agent or a Machine that is not this one gives none here', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.notices.read(ROOT, delta([ticket('e', 1, { waits: 'team' }), ticket('e', 2, { waits: 'Windows PC' }), ticket('e', 3, { waits: 'agent' }), ticket('e', 4, { waits: null })]))
    expect(w.shown).toEqual([])
  })

  it('two Projects with the same epic and NN, both waiting within 10 s: each gives its notification', () => {
    const w = waits()
    w.notices.read('/projects/a', model([], '/projects/a'))
    w.notices.read('/projects/b', model([], '/projects/b'))
    w.notices.read('/projects/a', delta([owner('worfy-link', 16, 'a')], '/projects/a'))
    w.notices.read('/projects/b', delta([owner('worfy-link', 16, 'b')], '/projects/b'))
    expect(w.shown.map((each) => [each.note.projectRoot, each.note.title])).toEqual([
      ['/projects/a', 'worfy-link 16 is waiting for you'],
      ['/projects/b', 'worfy-link 16 is waiting for you'],
    ])
  })

  it('the old rules of showing: none while a worfy window has focus, and one per Ticket in 10 s', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.focus(true)
    w.notices.read(ROOT, delta([owner('e', 1, 'a')]))
    expect(w.shown).toEqual([])
    w.focus(false)
    w.notices.read(ROOT, delta([owner('e', 1, 'a'), owner('e', 2, 'b')]))
    // A different Ticket is counted on its own.
    expect(w.shown.map((each) => each.note.title)).toEqual(['e 02 is waiting for you'])
    w.notices.read(ROOT, delta([owner('e', 2, 'b', '2026-10-18T11:00Z')]))
    expect(w.shown).toHaveLength(1)
  })

  it('a click opens the Pipeline board of the Project: the note waits for the window as a Pipeline note, with no Session', () => {
    const w = waits()
    w.notices.read(ROOT, model([]))
    w.notices.read(ROOT, delta([owner('worfy-link', 16, 'acceptance')]))
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

  /** A workflow hub whose every open waits for the test: `opens[i].resolve(…)` answers the i-th, `reject` fails it. */
  function heldHub() {
    const opens: { root: string; subscriber: WorkflowSubscriber; resolve: (model: WorkflowModel) => void; reject: (error: Error) => void }[] = []
    const closed: string[] = []
    const hub = {
      open: (root: string, subscriber: WorkflowSubscriber) =>
        new Promise<WorkflowModel>((resolve, reject) => {
          opens.push({ root, subscriber, resolve, reject })
        }),
      close: async (root: string) => {
        closed.push(root)
        return true
      },
    }
    return { hub, opens, closed }
  }

  it('a change sent before the hub answered the open is read after the model: a wait the model holds gives none, a new one gives one', async () => {
    const { hub, opens } = heldHub()
    const shown: string[] = []
    const stop = installWaitsNotifications(hub, () => [{ path: ROOT }], { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
    await Promise.resolve()
    opens[0]!.subscriber.send(delta([owner('e', 1, 'in the model too')]))
    opens[0]!.subscriber.send(delta([owner('e', 2, 'newer than the model')]))
    expect(shown).toEqual([])
    opens[0]!.resolve(model([owner('e', 1, 'in the model too')]))
    await Promise.resolve()
    await Promise.resolve()
    expect(shown).toEqual(['e 02 is waiting for you'])
    opens[0]!.subscriber.send(delta([owner('e', 3, 'new')]))
    expect(shown).toEqual(['e 02 is waiting for you', 'e 03 is waiting for you'])
    stop()
    // A change after the stop shows nothing.
    opens[0]!.subscriber.send(delta([owner('e', 4, 'late')]))
    expect(shown).toEqual(['e 02 is waiting for you', 'e 03 is waiting for you'])
  })

  it('the model is read before the changes that came before it: a wait the model holds and the first early change lacks gives none', async () => {
    const { hub, opens } = heldHub()
    const shown: string[] = []
    const stop = installWaitsNotifications(hub, () => [{ path: ROOT }], { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
    await Promise.resolve()
    // A change carries only the Tickets that changed: were it read first, it would be the start
    // without e 1, and the model's e 1 would look new.
    opens[0]!.subscriber.send(delta([owner('e', 2, 'two')]))
    opens[0]!.resolve(model([owner('e', 1, 'one'), owner('e', 2, 'two')]))
    await Promise.resolve()
    await Promise.resolve()
    expect(shown).toEqual([])
    stop()
  })

  it('the changes of a follow that ended are not read: a Project that left the list and came back notifies only by its new subscription', async () => {
    vi.useFakeTimers()
    try {
      const { hub, opens } = heldHub()
      let list = [{ path: ROOT }]
      const shown: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
      opens[0]!.resolve(model([]))
      await vi.advanceTimersByTimeAsync(0)
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: ROOT }]
      await vi.advanceTimersByTimeAsync(60_000)
      opens[1]!.resolve(model([]))
      await vi.advanceTimersByTimeAsync(0)
      // The old subscriber's open had answered: only the check of the follow keeps its change out.
      opens[0]!.subscriber.send(delta([owner('e', 5, 'old subscription')]))
      expect(shown).toEqual([])
      opens[1]!.subscriber.send(delta([owner('e', 6, 'new subscription')]))
      expect(shown).toEqual(['e 06 is waiting for you'])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('installNotifications with the workflow hub follows the listed Projects, shows the notes by its deps, and lets them go when stopped', async () => {
    let subscriber: WorkflowSubscriber | undefined
    const hub = {
      open: vi.fn(async (_root: string, each: WorkflowSubscriber) => {
        subscriber = each
        return model([])
      }),
      close: vi.fn(async () => true),
    }
    const shown: TicketNote[] = []
    const deps = { focused: () => false, show: (note: TicketNote) => shown.push(note), open: vi.fn(), now: () => 1 }
    const stop = installNotifications({ observe: () => () => undefined }, new Set(), undefined, undefined, { hub, projects: () => [{ path: ROOT }], deps })
    await Promise.resolve()
    await Promise.resolve()
    expect(hub.open).toHaveBeenCalledWith(ROOT, expect.objectContaining({ id: 'waits-notify' }))
    subscriber!.send(delta([owner('worfy-link', 16, 'acceptance')]))
    expect(shown.map((note) => note.title)).toEqual(['worfy-link 16 is waiting for you'])
    stop()
    expect(hub.close).toHaveBeenCalledWith(ROOT, 'waits-notify')
  })

  /**
   * The Stage hub as the app builds it (src/main/ipc/pipeline.ts), over the same workflow hub, with
   * every source that would start a process counted: `bin/profile` (profile), git, gh (the PR tracker
   * and the Deployments).
   */
  function countedStageHub(workflow: { open: (root: string, subscriber: WorkflowSubscriber) => Promise<WorkflowModel>; close: (root: string, id: number | string) => Promise<boolean>; model: (root: string) => Promise<WorkflowModel | null> }) {
    const calls = { profile: 0, git: 0, gh: 0 }
    const hub = new StageHub({
      workflow,
      prs: {
        read: async () => {
          calls.gh += 1
          return { pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } }
        },
      },
      profile: async () => {
        calls.profile += 1
        return { ok: false, reason: 'stub' }
      },
      deployments: {
        environment: async () => {
          calls.gh += 1
          return null
        },
        deployMarks: async () => {
          calls.gh += 1
          return null
        },
      } as never,
      harnessHome: '/nonexistent/harness',
      git: async () => {
        calls.git += 1
        return { code: 1, stdout: '' }
      },
    })
    return { hub, calls }
  }

  /** A workflow hub that only answers its model: it starts no process and sends no change. */
  function quietWorkflowHub(tickets: Ticket[]) {
    return {
      open: vi.fn(async () => model(tickets)),
      close: vi.fn(async () => true),
      model: vi.fn(async () => model(tickets)),
    }
  }

  it("over 3 minutes without a change of the files the app's notes start no process: the workflow hub is opened, the Stage hub never; gh, git and bin/profile never run", async () => {
    vi.useFakeTimers()
    try {
      appHubs.projects = [{ path: ROOT }]
      const deps = { focused: () => false, show: vi.fn(), open: vi.fn(), now: () => 1 }
      // The sources src/main/index.ts passes, over the app's hubs (both replaced by the mocks above).
      const stop = installNotifications({ observe: () => () => undefined }, new Set(), undefined, undefined, { ...appWaitsSources(), deps })
      await vi.advanceTimersByTimeAsync(3 * 60_000)
      expect(appHubs.workflowOpens).toEqual([ROOT])
      expect(appHubs.stageOpens).toEqual([])
      expect(appHubs.calls).toEqual({ profile: 0, git: 0, gh: 0 })
      expect(deps.show).not.toHaveBeenCalled()
      stop()
    } finally {
      appHubs.projects = []
      vi.useRealTimers()
    }
  })

  it('the control of the test above: following the Stage hub, as before ticket 09, runs bin/profile every minute with no change at all', async () => {
    vi.useFakeTimers()
    try {
      const workflow = quietWorkflowHub([ticket('e', 1), owner('e', 2, 'waits')])
      const stages = countedStageHub(workflow)
      const subscriber: StageSubscriber = { id: 'control', send: () => undefined }
      await stages.hub.open(ROOT, subscriber)
      const atStart = stages.calls.profile
      await vi.advanceTimersByTimeAsync(3 * 60_000)
      expect(stages.calls.profile - atStart).toBeGreaterThanOrEqual(3)
      await stages.hub.closeAll()
    } finally {
      vi.useRealTimers()
    }
  })

  it('watches the workflow model of every Project of the list: the first model is the start, the changes notify; a Project gone from the list is let go', async () => {
    vi.useFakeTimers()
    try {
      const subscribers = new Map<string, WorkflowSubscriber>()
      const closed: string[] = []
      const first: Record<string, WorkflowModel> = {
        '/projects/a': model([owner('e', 1, 'already')], '/projects/a'),
        '/projects/b': model([], '/projects/b'),
      }
      const hub = {
        open: vi.fn(async (root: string, subscriber: WorkflowSubscriber) => {
          subscribers.set(root, subscriber)
          const answer = first[root]
          if (answer === undefined) throw new Error(`workflow: the first read of ${root} failed`)
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

      subscribers.get('/projects/a')!.send(delta([owner('e', 2, 'new')], '/projects/a'))
      expect(shown).toEqual(['e 02 is waiting for you'])

      // The next tick opens nothing twice; a Project gone from the list is closed.
      list = [{ path: '/projects/a' }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(hub.open).toHaveBeenCalledTimes(2)
      expect(closed).toEqual(['/projects/b'])

      // A Project whose model could not be read is let go of and tried again on the next tick.
      list = [{ path: '/projects/a' }, { path: '/projects/c' }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(hub.open).toHaveBeenCalledTimes(3)
      expect(closed).toEqual(['/projects/b', '/projects/c'])
      first['/projects/c'] = model([owner('e', 3, 'was there')], '/projects/c')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(hub.open).toHaveBeenCalledTimes(4)
      expect(shown).toEqual(['e 02 is waiting for you'])

      stop()
      await vi.advanceTimersByTimeAsync(0)
      expect(closed.slice(2).sort()).toEqual(['/projects/a', '/projects/c'])
      await vi.advanceTimersByTimeAsync(120_000)
      expect(hub.open).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a Project removed from the list and added again starts afresh: what began to wait while it was gone gives none', async () => {
    vi.useFakeTimers()
    try {
      const { hub, opens } = heldHub()
      let list = [{ path: ROOT }]
      const shown: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note: { title: string }) => shown.push(note.title) }, 60_000)
      opens[0]!.resolve(model([]))
      await vi.advanceTimersByTimeAsync(0)
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: ROOT }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toHaveLength(2)
      opens[1]!.resolve(model([owner('e', 1, 'began while gone')]))
      await vi.advanceTimersByTimeAsync(0)
      expect(shown).toEqual([])
      opens[1]!.subscriber.send(delta([owner('e', 2, 'new')]))
      expect(shown).toEqual(['e 02 is waiting for you'])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the workflow hub answers in its own spelling of the root (path.resolve, C:\\… on Windows): the notes keep the spelling of the list', async () => {
    vi.useFakeTimers()
    try {
      const { hub, opens } = heldHub()
      const listed = 'C:/Users/owner/worfy'
      const resolved = 'C:\\Users\\owner\\worfy'
      let list = [{ path: listed }]
      const shown: TicketNote[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note) => shown.push(note) }, 60_000)
      opens[0]!.resolve(model([], resolved))
      await vi.advanceTimersByTimeAsync(0)
      opens[0]!.subscriber.send(delta([owner('e', 1, 'new')], resolved))
      expect(shown.map((note) => note.projectRoot)).toEqual([listed])
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: listed }]
      await vi.advanceTimersByTimeAsync(60_000)
      opens[1]!.resolve(model([owner('e', 2, 'began while gone')], resolved))
      await vi.advanceTimersByTimeAsync(0)
      expect(shown).toHaveLength(1)
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
      // The old open answers late, with an older model: were it the start, e 1 would look new.
      opens[0]!.resolve(model([]))
      await vi.advanceTimersByTimeAsync(0)
      opens[1]!.resolve(model([owner('e', 1, 'already')]))
      await vi.advanceTimersByTimeAsync(0)
      expect(shown).toEqual([])
      // Nor are the old subscriber's changes read.
      opens[0]!.subscriber.send(delta([owner('e', 5, 'old subscriber')]))
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
      opens[1]!.resolve(model([]))
      await vi.advanceTimersByTimeAsync(0)
      opens[0]!.reject(new Error('workflow: the first read failed'))
      await vi.advanceTimersByTimeAsync(0)
      expect(closed).toEqual([ROOT])
      expect(logs).toEqual([])
      opens[1]!.subscriber.send(delta([owner('e', 1, 'new')]))
      expect(shown).toEqual(['e 01 is waiting for you'])
      // Nor is the Project opened again: it is followed.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toHaveLength(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no model (the first read failed): tried again after 1, 2, 4… intervals up to 32 minutes, no notes; the first model is the start, the next change notifies', async () => {
    vi.useFakeTimers()
    try {
      let opens = 0
      let fails = true
      let subscriber: WorkflowSubscriber | undefined
      const hub = {
        open: vi.fn(async (_root: string, each: WorkflowSubscriber) => {
          opens += 1
          subscriber = each
          if (fails) throw new Error('workflow: the first read failed')
          return model([owner('e', 1, 'already waiting')])
        }),
        close: vi.fn(async () => true),
      }
      let list = [{ path: ROOT }]
      const logs: string[] = []
      const shown: string[] = []
      const stop = installWaitsNotifications(hub, () => list, { show: (note: { title: string }) => shown.push(note.title) }, 60_000, (message) => logs.push(message))
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
      // A failed open's subscriber is let go: what it would send shows nothing.
      subscriber!.send(delta([owner('e', 9, 'from a failed open')]))
      expect(shown).toEqual([])
      // Gone from the list and back: the pause starts over.
      list = []
      await vi.advanceTimersByTimeAsync(60_000)
      list = [{ path: ROOT }]
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toBe(10)
      expect(logs.at(-1)).toContain('tried again in 60 s')
      // A read that succeeds ends the tries: the Project is followed, and its first model is the start.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(opens).toBe(11)
      fails = false
      await vi.advanceTimersByTimeAsync(120_000)
      expect(opens).toBe(12)
      expect(shown).toEqual([])
      subscriber!.send(delta([owner('e', 2, 'new')]))
      expect(shown).toEqual(['e 02 is waiting for you'])
      await vi.advanceTimersByTimeAsync(40 * 60_000)
      expect(opens).toBe(12)
      expect(logs).toHaveLength(11)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a Ticket that waits, across the Linked machines (worfy-pipeline ticket 10)', () => {
  const MAC_ROOT = '/Users/a/worfy'
  const PC_ROOT = 'C:/src/worfy'
  const MAC_PROJECT = { path: MAC_ROOT, id: 'worfy-1a2b3c4d', name: 'worfy' }
  const PC_PROJECT = { path: PC_ROOT, id: 'worfy-5e6f7a8b', name: 'worfy' }
  /** The match keys of one repository on two Machines: the origin spelled two ways, the Project at the root. */
  const MAC_KEY = projectMatchKey({ id: MAC_PROJECT.id, origin: originKey('git@git.example.com:o/worfy.git'), repoPath: '' })
  const PC_KEY = projectMatchKey({ id: PC_PROJECT.id, origin: originKey('https://git.example.com/o/worfy'), repoPath: '' })
  const AT = '2026-10-20T09:00Z'

  const ticket = (epic: string, num: number, waits: string | null, reason: string | null = 'acceptance'): Ticket => ({
    epic,
    num,
    slug: 'slug',
    title: `Title of ${epic} ${num}`,
    statusRaw: waits === null ? 'work' : 'blocked',
    state: waits === null ? 'work' : 'blocked',
    statusAt: AT,
    statusError: null,
    blockedReason: reason,
    waits,
    pr: null,
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    branch: null,
    repo: null,
    files: [],
    filesListed: true,
    fromBranch: null,
  })
  const model = (root: string): WorkflowModel => ({ root, epics: [], tickets: [], error: null, branchErrors: [] })
  const delta = (root: string, tickets: Ticket[]): WorkflowDelta => ({ root, epics: [], tickets, removedEpics: [], removedTickets: [], error: null, branchErrors: [] })
  const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

  type Sent = { note: SharedTicketNote; to: 'all' | readonly string[] }

  /** One Machine: its name, its Linked machines, its Project list with the match keys, its display and what it sends. */
  function machine(options: { self: string | null; linked?: { id: string; name: string }[]; projects?: ListedProject[]; keys?: Record<string, string> }) {
    let now = 1_000_000
    let self = options.self
    /** The roots whose match key was read, in order. */
    const reads: string[] = []
    const shown: { note: TicketNote; click: () => void }[] = []
    const opened: TicketNote[] = []
    const sent: Sent[] = []
    const projects = options.projects ?? [MAC_PROJECT]
    const keys = options.keys ?? { [MAC_ROOT]: MAC_KEY }
    const display = new NoteDisplay<TicketNote>({ focused: () => false, show: (note, click) => shown.push({ note, click }), open: (note) => opened.push(note), now: () => now })
    const link = { sendTicket: (note: SharedTicketNote, to: 'all' | readonly string[]) => sent.push({ note, to }), machines: () => ({ self, linked: options.linked ?? [] }) }
    const matchKey = async (root: string, id: string) => {
      reads.push(root)
      return keys[root] ?? projectMatchKey({ id, origin: null, repoPath: null })
    }
    const tickets = new TicketNotes(display, link, () => projects, matchKey, undefined, () => now)
    const notices = new WaitsNotices(tickets)
    return {
      shown,
      opened,
      sent,
      tickets,
      notices,
      reads,
      titles: () => shown.map((each) => each.note.title),
      wait: (ms: number) => {
        now += ms
      },
      name: (value: string) => {
        self = value
      },
    }
  }

  const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

  /** A shared note of the Project with match key `match`, of Ticket `epic num`, as a Linked machine sends it. */
  const shared = (match: string, epic = 'worfy-link', num = 16, wait = `${epic}|${num}|${AT}`): SharedTicketNote => ({
    title: `${epic} ${String(num).padStart(2, '0')} is waiting for you`,
    body: 'acceptance',
    project: { id: PC_PROJECT.id, name: 'worfy', match },
    epic,
    num,
    wait,
  })

  it('Waits: owner — one note here and one sending to every Linked machine, with the Project by id, name and match key, no local path', async () => {
    const mac = machine({ self: 'Mac', linked: [{ id: 'pc', name: 'Windows PC' }] })
    mac.notices.read(MAC_ROOT, model(MAC_ROOT))
    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('worfy-link', 16, 'owner')]))
    await settle()
    expect(mac.titles()).toEqual(['worfy-link 16 is waiting for you'])
    expect(mac.sent).toEqual([
      {
        to: 'all',
        note: {
          title: 'worfy-link 16 is waiting for you',
          body: 'acceptance',
          project: { id: MAC_PROJECT.id, name: 'worfy', match: MAC_KEY },
          epic: 'worfy-link',
          num: 16,
          wait: sha256(waitKey(ticket('worfy-link', 16, 'owner'))),
        },
      },
    ])
    expect(JSON.stringify(mac.sent)).not.toContain(MAC_ROOT)
  })

  it('Waits: <this Machine> — a note here, nothing sent; Waits: <a Linked machine> — sent to it alone, nothing here', async () => {
    const mac = machine({ self: 'Mac', linked: [{ id: 'pc', name: 'Windows PC' }, { id: 'linux', name: 'Linux box' }] })
    mac.notices.read(MAC_ROOT, model(MAC_ROOT))
    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('e', 1, 'Mac')]))
    await settle()
    expect(mac.titles()).toEqual(['e 01 is waiting for you'])
    expect(mac.sent).toEqual([])

    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('e', 2, 'Windows PC')]))
    await settle()
    expect(mac.titles()).toEqual(['e 01 is waiting for you'])
    expect(mac.sent.map((each) => [each.note.num, each.to])).toEqual([[2, ['pc']]])
  })

  it('Waits: team, agent, or a name no Machine has (compared whole, case and all): nothing here, nothing sent', async () => {
    const mac = machine({ self: 'Mac', linked: [{ id: 'pc', name: 'Windows PC' }] })
    mac.notices.read(MAC_ROOT, model(MAC_ROOT))
    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('e', 1, 'team'), ticket('e', 2, 'agent'), ticket('e', 3, 'windows pc'), ticket('e', 4, 'Windows'), ticket('e', 5, 'mac')]))
    await settle()
    expect(mac.shown).toEqual([])
    expect(mac.sent).toEqual([])
  })

  it('ticketRecipients: owner, this Machine, a Linked machine, team and agent', () => {
    const machines = { self: 'Mac', linked: [{ id: 'pc', name: 'Windows PC' }] }
    expect(ticketRecipients('owner', machines)).toEqual({ here: true, linked: 'all' })
    expect(ticketRecipients('Mac', machines)).toEqual({ here: true, linked: [] })
    expect(ticketRecipients('Windows PC', machines)).toEqual({ here: false, linked: ['pc'] })
    expect(ticketRecipients('team', machines)).toEqual({ here: false, linked: [] })
    expect(ticketRecipients('agent', machines)).toEqual({ here: false, linked: [] })
    // Before the link started this Machine has no name: a wait for a Machine shows nowhere.
    expect(ticketRecipients('Mac', { self: null, linked: [] })).toEqual({ here: false, linked: [] })
  })

  it('a received note is shown with the name of the Machine that sent it, and goes nowhere; a click opens the Pipeline board of that Project on that Machine', async () => {
    const pc = machine({ self: 'Windows PC', linked: [{ id: 'mac', name: 'Mac' }], projects: [] })
    await pc.tickets.receive('mac', { ...shared(MAC_KEY), project: { id: MAC_PROJECT.id, name: 'worfy', match: MAC_KEY } })
    expect(pc.shown.map((each) => each.note)).toEqual([
      { title: 'worfy-link 16 is waiting for you (Mac)', body: 'acceptance', sessionId: null, projectRoot: null, ticket: { epic: 'worfy-link', num: 16 }, machineId: 'mac', projectId: MAC_PROJECT.id },
    ])
    expect(pc.sent).toEqual([])

    pc.shown[0]!.click()
    const pending = new PendingOpens()
    const open = fakeWindow(12)
    electron.windows = [open.window]
    openNote(pc.opened[0]!, pending, vi.fn() as never, NORMAL_WINDOWS)
    const held = pending.take(12)
    expect(held).toEqual({ view: 'pipeline', projectId: MAC_PROJECT.id, machineId: 'mac', epic: 'worfy-link', num: 16 })
    const { notifyOpenSchema } = await import('../../src/shared/ipc/notify')
    expect(notifyOpenSchema.parse(held)).toEqual(held)
    // A Pipeline note names its Project by root or by id.
    expect(notifyOpenSchema.safeParse({ view: 'pipeline', machineId: 'mac', epic: 'e', num: 1 }).success).toBe(false)
    electron.windows = []
  })

  it('a received note of a Project whose match key this Machine has in its list is not shown: it notified of it itself', async () => {
    const pc = machine({ self: 'Windows PC', linked: [{ id: 'mac', name: 'Mac' }], projects: [PC_PROJECT], keys: { [PC_ROOT]: PC_KEY } })
    await pc.tickets.receive('mac', shared(MAC_KEY))
    expect(pc.shown).toEqual([])
    // The control: a Project of another repository is shown.
    await pc.tickets.receive('mac', shared(projectMatchKey({ id: 'other-0000', origin: originKey('git@git.example.com:o/other.git'), repoPath: '' })))
    expect(pc.titles()).toEqual(['worfy-link 16 is waiting for you (Mac)'])
  })

  it('the same note twice is shown once, though 10 s passed and another Machine sent it; a new wait is shown again', async () => {
    const linux = machine({ self: 'Linux box', linked: [{ id: 'mac', name: 'Mac' }, { id: 'pc', name: 'Windows PC' }], projects: [] })
    await Promise.all([linux.tickets.receive('mac', shared(MAC_KEY)), linux.tickets.receive('mac', shared(MAC_KEY))])
    linux.wait(NOTIFY_INTERVAL_MS)
    await linux.tickets.receive('pc', shared(MAC_KEY))
    expect(linux.titles()).toEqual(['worfy-link 16 is waiting for you (Mac)'])
    await linux.tickets.receive('mac', shared(MAC_KEY, 'worfy-link', 16, 'worfy-link|16|2026-10-20T11:00Z'))
    expect(linux.shown).toHaveLength(2)
  })

  it('two Machines with one repository at /Users/a/worfy and C:/src/worfy, origins spelled two ways: Waits: owner gives one note on each Machine, its own; the other\'s is dropped', async () => {
    expect(MAC_KEY).toBe(PC_KEY)
    const mac = machine({ self: 'Mac', linked: [{ id: 'pc', name: 'Windows PC' }, { id: 'linux', name: 'Linux box' }], projects: [MAC_PROJECT], keys: { [MAC_ROOT]: MAC_KEY } })
    const pc = machine({ self: 'Windows PC', linked: [{ id: 'mac', name: 'Mac' }], projects: [PC_PROJECT], keys: { [PC_ROOT]: PC_KEY } })
    // The control: a Machine without the repository in its list.
    const linux = machine({ self: 'Linux box', linked: [{ id: 'mac', name: 'Mac' }], projects: [] })
    mac.notices.read(MAC_ROOT, model(MAC_ROOT))
    pc.notices.read(PC_ROOT, model(PC_ROOT))
    // The Ticket file came to both clones: each Machine sees the wait in its own Project.
    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('worfy-link', 16, 'owner')]))
    pc.notices.read(PC_ROOT, delta(PC_ROOT, [ticket('worfy-link', 16, 'owner')]))
    await settle()
    for (const { note } of mac.sent) {
      await pc.tickets.receive('mac', note)
      await linux.tickets.receive('mac', note)
    }
    for (const { note } of pc.sent) await mac.tickets.receive('pc', note)
    expect(mac.titles()).toEqual(['worfy-link 16 is waiting for you'])
    expect(pc.titles()).toEqual(['worfy-link 16 is waiting for you'])
    expect(linux.titles()).toEqual(['worfy-link 16 is waiting for you (Mac)'])
  })

  it('a repository without origin: the Project is matched by its id alone', async () => {
    const idKey = projectMatchKey({ id: 'scratch-11111111', origin: null, repoPath: null })
    const same = machine({ self: 'Windows PC', linked: [{ id: 'mac', name: 'Mac' }], projects: [{ path: 'C:/scratch', id: 'scratch-11111111', name: 'scratch' }], keys: {} })
    await same.tickets.receive('mac', shared(idKey))
    expect(same.shown).toEqual([])
    const other = machine({ self: 'Windows PC', linked: [{ id: 'mac', name: 'Mac' }], projects: [{ path: 'C:/scratch', id: 'scratch-22222222', name: 'scratch' }], keys: {} })
    await other.tickets.receive('mac', shared(idKey))
    expect(other.shown).toHaveLength(1)
  })

  it('a Blocked reason of 1200 characters: the note still goes, its texts clipped, the wait as a hash, within the limits of the message', async () => {
    const reason = 'r'.repeat(1200)
    const mac = machine({ self: 'Mac', linked: [{ id: 'pc', name: 'Windows PC' }] })
    mac.notices.read(MAC_ROOT, model(MAC_ROOT))
    // A Status with a date alone: the key of the wait holds the reason.
    const long = { ...ticket('worfy-link', 16, 'owner', reason), statusAt: '2026-10-20' }
    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [long]))
    await settle()
    expect(mac.shown[0]?.note.body).toBe(reason)
    expect(mac.sent).toHaveLength(1)
    const sent = mac.sent[0]!.note
    expect(sent.body.length).toBeLessThanOrEqual(160)
    expect(sent.title.length).toBeLessThanOrEqual(1000)
    expect(sent.wait).toBe(sha256(waitKey(long)))
    expect(sent.wait).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the receiver drops a note whose match key is that of its second Project, and names the second of two Linked machines that sent one', async () => {
    const pc = machine({
      self: 'Windows PC',
      linked: [{ id: 'mac', name: 'Mac' }, { id: 'linux', name: 'Linux box' }],
      projects: [{ path: 'C:/src/other', id: 'other-00000000', name: 'other' }, PC_PROJECT],
      keys: { 'C:/src/other': projectMatchKey({ id: 'x', origin: 'git.example.com/o/other', repoPath: '' }), [PC_ROOT]: PC_KEY },
    })
    await pc.tickets.receive('linux', shared(MAC_KEY))
    expect(pc.shown).toEqual([])
    await pc.tickets.receive('linux', shared(projectMatchKey({ id: 'x', origin: 'git.example.com/o/third', repoPath: '' })))
    expect(pc.titles()).toEqual(['worfy-link 16 is waiting for you (Linux box)'])
  })

  it('the match keys of this Machine\'s Projects are read with git once per minute, not for every note', async () => {
    const pc = machine({ self: 'Windows PC', linked: [{ id: 'mac', name: 'Mac' }], projects: [PC_PROJECT, { path: 'C:/src/other', id: 'other-00000000', name: 'other' }], keys: { [PC_ROOT]: PC_KEY } })
    await pc.tickets.receive('mac', shared(MAC_KEY, 'e', 1))
    await pc.tickets.receive('mac', shared(MAC_KEY, 'e', 2))
    expect(pc.reads).toEqual([PC_ROOT, 'C:/src/other'])
    pc.wait(MATCH_KEY_TTL_MS)
    await pc.tickets.receive('mac', shared(MAC_KEY, 'e', 3))
    expect(pc.reads).toEqual([PC_ROOT, 'C:/src/other', PC_ROOT, 'C:/src/other'])
  })

  it(`remembers the last ${RECEIVED_LIMIT} waits: the oldest is forgotten and shows again, the next oldest does not`, async () => {
    const shown: TicketNote[] = []
    const tickets = new TicketNotes({ show: (note) => shown.push(note) }, { machines: () => ({ self: 'Linux box', linked: [] }) }, () => [], async () => 'unused')
    for (let index = 0; index <= RECEIVED_LIMIT; index++) await tickets.receive('mac', shared(MAC_KEY, 'e', 1, `wait-${index}`))
    expect(shown).toHaveLength(RECEIVED_LIMIT + 1)
    await tickets.receive('mac', shared(MAC_KEY, 'e', 1, 'wait-1'))
    expect(shown).toHaveLength(RECEIVED_LIMIT + 1)
    await tickets.receive('mac', shared(MAC_KEY, 'e', 1, 'wait-0'))
    expect(shown).toHaveLength(RECEIVED_LIMIT + 2)
  })

  it('Waits: <a Machine name> while this Machine has no name yet: nothing shown and the wait not counted as seen; once the name is known, the next read shows it', async () => {
    const mac = machine({ self: null })
    mac.notices.read(MAC_ROOT, model(MAC_ROOT))
    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('e', 1, 'Mac')]))
    expect(mac.shown).toEqual([])
    mac.name('Mac')
    mac.notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('e', 1, 'Mac')]))
    expect(mac.titles()).toEqual(['e 01 is waiting for you'])
  })

  it('stopping the notifications lets go of the Linked machines\' Ticket notes', () => {
    const handlers = new Set<unknown>()
    const link = {
      send: () => undefined,
      receive: () => () => undefined,
      receiveTicket: (handler: unknown) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      machines: () => ({ self: 'Mac', linked: [] }),
    }
    const hub = { open: vi.fn(async (root: string) => model(root)), close: vi.fn(async () => true) }
    const stop = installNotifications({ observe: () => () => undefined }, new Set(), undefined, link, { hub, projects: () => [], deps: { focused: () => false, show: () => undefined, open: () => undefined, now: () => 1 } })
    expect(handlers.size).toBe(1)
    stop()
    expect(handlers.size).toBe(0)
  })

  it('remoteHasHost: a remote with a host has one; a local path, a Windows drive and file:// have none', () => {
    for (const url of ['git@git.example.com:o/worfy.git', 'https://git.example.com/o/worfy', 'ssh://git@host:22/o/r.git', 'host.example:o/r']) expect(remoteHasHost(url)).toBe(true)
    for (const url of ['/Users/x/repo.git', 'C:\\repos\\x.git', 'C:/repos/x.git', 'file:///srv/x.git', '../x.git', 'x.git', 'https:///nohost']) expect(remoteHasHost(url)).toBe(false)
  })

  describe('a failure of git is not "no origin"', () => {
    type Answer = { ok: true; out: string } | { ok: false; code: number | null; stderr: string }
    /** A git that answers `rev-parse` and `get-url` as given. */
    const git = (prefix: Answer, url: Answer) => async (_cwd: string, args: string[]) => (args[0] === 'rev-parse' ? prefix : url)
    const ROOT_PREFIX: Answer = { ok: true, out: '' }
    const SUB_PREFIX: Answer = { ok: true, out: 'docs/site/' }
    const ORIGIN: Answer = { ok: true, out: 'git@git.example.com:o/worfy.git' }
    const idKey = projectMatchKey({ id: 'p-1', origin: null, repoPath: null })

    it('get-url exit 2 (no remote origin) and "not a git repository" give the id key; an origin gives the origin key with the path', async () => {
      expect(await readProjectMatchKey('/r', 'p-1', git(ROOT_PREFIX, { ok: false, code: 2, stderr: 'error: No such remote' }))).toBe(idKey)
      const outside = { ok: false as const, code: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' }
      expect(await readProjectMatchKey('/r', 'p-1', git(outside, outside))).toBe(idKey)
      expect(await readProjectMatchKey('/r', 'p-1', git(SUB_PREFIX, ORIGIN))).toBe(projectMatchKey({ id: 'x', origin: 'git.example.com/o/worfy', repoPath: 'docs/site' }))
    })

    it('get-url timed out, killed or failed otherwise: the read rejects, no id key', async () => {
      for (const failed of [{ ok: false as const, code: null, stderr: '' }, { ok: false as const, code: 1, stderr: 'error' }, { ok: false as const, code: 128, stderr: 'fatal: unable to access' }]) {
        await expect(readProjectMatchKey('/r', 'p-1', git(ROOT_PREFIX, failed))).rejects.toThrow(/match key of Project p-1 is unknown/)
      }
    })

    it('rev-parse failed for a Project in a subfolder: the read rejects, rather than give the key of the repository\'s root', async () => {
      await expect(readProjectMatchKey('/r/docs/site', 'p-1', git({ ok: false, code: null, stderr: '' }, ORIGIN))).rejects.toThrow(/rev-parse failed/)
    })

    it('a sender whose key could not be read sends nothing, keeps no key, and reads it again for the next wait', async () => {
      const sent: SharedTicketNote[] = []
      const warned: string[] = []
      let fail = true
      const reads: string[] = []
      const tickets = new TicketNotes(
        { show: () => undefined },
        { sendTicket: (note) => sent.push(note), machines: () => ({ self: 'Mac', linked: [{ id: 'pc', name: 'Windows PC' }] }) },
        () => [MAC_PROJECT],
        async (root) => {
          reads.push(root)
          if (fail) throw new Error('git remote get-url origin failed (exit null)')
          return MAC_KEY
        },
        (message) => warned.push(message),
        () => 1,
      )
      const notices = new WaitsNotices(tickets)
      notices.read(MAC_ROOT, model(MAC_ROOT))
      notices.read(MAC_ROOT, delta(MAC_ROOT, [ticket('e', 1, 'owner')]))
      await settle()
      expect(sent).toEqual([])
      expect(warned).toHaveLength(1)
      fail = false
      notices.read(MAC_ROOT, delta(MAC_ROOT, [{ ...ticket('e', 2, 'owner') }]))
      await settle()
      // Within the minute of the cache: the failed read was not kept.
      expect(reads).toEqual([MAC_ROOT, MAC_ROOT])
      expect(sent.map((note) => [note.num, note.project.match])).toEqual([[2, MAC_KEY]])
    })

    it('a receiver whose own key could not be read shows the note, and reads the key again for the next one', async () => {
      const shown: TicketNote[] = []
      let fail = true
      const reads: string[] = []
      const tickets = new TicketNotes({ show: (note) => shown.push(note) }, { machines: () => ({ self: 'Windows PC', linked: [{ id: 'mac', name: 'Mac' }] }) }, () => [PC_PROJECT], async (root) => {
        reads.push(root)
        if (fail) throw new Error('timed out')
        return PC_KEY
      })
      await tickets.receive('mac', shared(MAC_KEY, 'e', 1))
      expect(shown).toHaveLength(1)
      fail = false
      await tickets.receive('mac', shared(MAC_KEY, 'e', 2))
      expect(reads).toEqual([PC_ROOT, PC_ROOT])
      expect(shown).toHaveLength(1)
    })
  })

  describe('the match key read with git', () => {
    const dirs: string[] = []
    const scratch = (): string => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-match-')))
      dirs.push(dir)
      return dir
    }
    const git = (cwd: string, ...args: string[]): void => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
      execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, env, stdio: 'ignore' })
    }
    const repo = (origin: string | null): string => {
      const dir = scratch()
      git(dir, 'init', '-q')
      if (origin !== null) git(dir, 'remote', 'add', 'origin', origin)
      mkdirSync(join(dir, 'docs', 'site'), { recursive: true })
      return dir
    }

    it('one repository at two paths is one key; another folder inside it is another; without origin, the id; no local path in any', async () => {
      try {
        const a = repo('git@git.example.com:o/worfy.git')
        const b = repo('https://git.example.com/o/worfy')
        const atA = await readProjectMatchKey(a, 'worfy-aaaaaaaa')
        expect(atA).toBe(await readProjectMatchKey(b, 'worfy-bbbbbbbb'))
        expect(atA).toBe(projectMatchKey({ id: 'x', origin: 'git.example.com/o/worfy', repoPath: '' }))
        const docsA = await readProjectMatchKey(join(a, 'docs', 'site'), 'site-1')
        expect(docsA).toBe(projectMatchKey({ id: 'x', origin: 'git.example.com/o/worfy', repoPath: 'docs/site' }))
        expect(docsA).toBe(await readProjectMatchKey(join(b, 'docs', 'site'), 'site-2'))
        expect(docsA).not.toBe(atA)
        // A folder outside any repository: git says so, and the key is the id.
        expect(await readProjectMatchKey(scratch(), 'plain-eeeeeeee')).toBe(projectMatchKey({ id: 'plain-eeeeeeee', origin: null, repoPath: null }))
        const bare = repo(null)
        expect(await readProjectMatchKey(bare, 'bare-cccccccc')).toBe(projectMatchKey({ id: 'bare-cccccccc', origin: null, repoPath: null }))
        // An origin that is a folder of this Machine is no origin (Q16): its key would be a local path.
        const local = repo(a)
        const localKey = await readProjectMatchKey(local, 'local-dddddddd')
        expect(localKey).toBe(projectMatchKey({ id: 'local-dddddddd', origin: null, repoPath: null }))
        expect(localKey.toLowerCase()).not.toContain(a.toLowerCase().slice(1))
        for (const key of [atA, docsA]) for (const dir of dirs) expect(key).not.toContain(dir)
      } finally {
        for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
      }
    })
  })
})

describe('"Link a machine" paused after too many failed pairing attempts (worfy-link ticket 28)', () => {
  const pause = { failures: 10, addresses: ['192.168.1.20', '10.0.0.7'], until: Date.parse('2026-10-21T15:05:00.000Z') }
  const body = '10 failed attempts to link to this Machine within an hour, from 192.168.1.20, 10.0.0.7. "Link a machine" is paused until 15:05. Restart worfy to link sooner.'
  type PauseEvents = { 'pairing-paused': [typeof pause] }

  it('says how many failures, from which addresses, until when, that a restart lifts the pause, and never a code', () => {
    expect(pairingPauseNoteBody(pause, () => '15:05')).toBe(body)
    expect(pairingPauseNoteBody(pause, () => '15:05')).not.toMatch(/\d{6}/)
  })

  it.each([
    ['has focus', true],
    ['has no focus', false],
  ])('shows one notification per pause while a worfy window %s; a click opens worfy; nothing after stop', (_how, focused) => {
    const service = new EventEmitter<PauseEvents>()
    const shown: { note: WindowNote; click: () => void }[] = []
    const opened: WindowNote[] = []
    const stop = installPairingPauseNotes(
      service,
      { focused: () => focused, show: (note, click) => shown.push({ note, click }), open: (note) => opened.push(note) },
      () => '15:05',
    )
    service.emit('pairing-paused', pause)
    expect(shown.map((each) => each.note)).toEqual([{ title: 'Link a machine is paused', body, sessionId: null }])
    expect(opened).toEqual([])
    shown[0]?.click()
    expect(opened).toEqual([{ title: 'Link a machine is paused', body, sessionId: null }])
    stop()
    service.emit('pairing-paused', pause)
    expect(shown).toHaveLength(1)
  })

  it("follows the app's link: the service running now and each one started later get their notes once", () => {
    const listeners: (() => void)[] = []
    const onStart = (listener: () => void): (() => void) => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    }
    let current: EventEmitter<PauseEvents> | undefined
    const shown: WindowNote[] = []
    const deps = { focused: () => false, show: (note: WindowNote) => shown.push(note), open: () => undefined }
    const stop = followAppLinkPauses(onStart, () => current, (service) => installPairingPauseNotes(service, deps, () => '15:05'))
    const first = new EventEmitter<PauseEvents>()
    current = first
    for (const listener of [...listeners]) listener()
    // Announced twice (a start, then a later one with the same service): still one subscription.
    for (const listener of [...listeners]) listener()
    first.emit('pairing-paused', pause)
    expect(shown).toHaveLength(1)
    const second = new EventEmitter<PauseEvents>()
    current = second
    for (const listener of [...listeners]) listener()
    first.emit('pairing-paused', pause)
    second.emit('pairing-paused', pause)
    expect(shown).toHaveLength(2)
    stop()
    expect(listeners).toEqual([])
    second.emit('pairing-paused', pause)
    expect(shown).toHaveLength(2)
  })
})
