// Notifications on Linked machines (worfy-link ticket 13; src/main/link/notes.ts, src/main/notify.ts):
// the Machine of a Project decides what to notify about, and every connected Linked machine it
// shares its Projects with shows the note too, each by its own rules — the focus of its own worfy
// window and its own 10 s per Session. A click opens the Session on the Machine where it was made.
//
// The Machines are link services of the bench of worfy-link ticket 01 (test/contract/link-bench.ts):
// two data folders and real connections over 127.0.0.1 in this vitest process. Electron's
// Notification and windows are replaced: each Machine shows through its own NotifyDeps.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListedProject, Note, NoteLink, TicketLink, TicketNote } from '../../src/main/notify'
import type { WorkflowSubscriber } from '../../src/main/workflow/watch'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { Frame } from '../../src/main/link/messages'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { APP_URL } from '../app-url'
import { ms } from '../time-scale'

const electron = vi.hoisted(() => ({ windows: [] as unknown[] }))

vi.mock('electron', () => ({
  app: { focus: () => undefined },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => electron.windows },
  Notification: { isSupported: () => false },
}))
// The real window module loads the app's page; openNote gets its own window factory.
vi.mock('../../src/main/window', () => ({ createMainWindow: () => undefined }))
// The app's link (appNoteLink follows it): the real service module, with the app's service set by the test.
const appLink = vi.hoisted(() => ({ service: undefined as unknown, listeners: new Set<() => void>() }))
vi.mock('../../src/main/link/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/link/service')>()),
  appLinkService: () => appLink.service,
  onAppLinkStart: (listener: () => void) => {
    appLink.listeners.add(listener)
    return () => appLink.listeners.delete(listener)
  },
}))

const { NOTIFY_INTERVAL_MS, installNotifications, openNote } = await import('../../src/main/notify')
const { PendingOpens } = await import('../../src/main/notify-pending')
const { LinkNotes, appNoteLink, noteMessage, ticketNoteMessage } = await import('../../src/main/link/notes')
const { projectMatchKey } = await import('../../src/main/autopilot/origin')
const { LinkBench } = await import('../contract/link-bench')

type Bench = InstanceType<typeof LinkBench>
type Machine = Awaited<ReturnType<Bench['machine']>>

type Result = Extract<AgentEvent, { type: 'result' }>
const result = (text = 'All tests pass.'): Result => ({
  type: 'result',
  subtype: 'success',
  isError: false,
  error: null,
  text,
  costUsd: 0,
  durationMs: 1,
  numTurns: 1,
  usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  terminalReason: null,
  interrupted: false,
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
const init = (cwd: string): AgentEvent => ({
  type: 'init',
  sdkSessionId: 'sdk-1',
  model: 'm',
  permissionMode: 'default',
  apiKeySource: 'none',
  cwd,
  claudeCodeVersion: null,
  slashCommands: [],
})

// Real connections: linking and connecting take a moment more than vitest's default 5 s allows on a busy machine.
vi.setConfig({ testTimeout: ms(20_000) })

let bench: Bench
const stops: (() => void)[] = []

beforeEach(() => {
  bench = new LinkBench()
})

afterEach(async () => {
  for (const stop of stops.splice(0)) stop()
  await bench.close()
  electron.windows = []
})

const until = (check: () => boolean): Promise<void> =>
  vi.waitFor(
    () => {
      if (!check()) throw new Error('not yet')
    },
    { timeout: ms(5_000), interval: 10 },
  )

/** Links `from` to `to` and opens one connection, dialled by `from`; resolves once both sides see it. */
async function connect(from: Machine, to: Machine): Promise<void> {
  if (!from.service.isLinked(to.service.machine.id)) {
    await bench.link(from, to)
    // Each side gives the other full access: the switch "Linked machines can work with my Projects" decides.
    from.service.settings.setLevel(to.service.machine.id, 'all')
    to.service.settings.setLevel(from.service.machine.id, 'all')
  }
  await from.service.connect(to.service.machine.id)
  await until(() => to.service.isConnected(from.service.machine.id) && from.service.isConnected(to.service.machine.id))
}

/** One Machine's notifications: its Sessions, its display and its own clock and focus. */
function notifications(machine: Machine, open: (note: Note) => void = () => undefined) {
  let focused = false
  let now = 1_000_000
  let listener: (sessionId: string, event: AgentEvent) => void = () => undefined
  const shown: { note: Note; click: () => void }[] = []
  const opened: Note[] = []
  const stop = installNotifications(
    {
      observe: (each) => {
        listener = each
        return () => undefined
      },
    },
    new Set(),
    {
      focused: () => focused,
      show: (note, click) => shown.push({ note, click }),
      open: (note) => {
        opened.push(note)
        open(note)
      },
      now: () => now,
    },
    new LinkNotes(machine.service),
  )
  stops.push(stop)
  return {
    shown,
    opened,
    notes: () => shown.map((each) => each.note),
    event: (sessionId: string, event: AgentEvent) => listener(sessionId, event),
    focus: (value: boolean) => {
      focused = value
    },
    wait: (ms: number) => {
      now += ms
    },
  }
}

/** Project machine `a` that shares its Projects, and Linked machine `b` connected to it. */
async function pair(options: { access?: boolean } = {}) {
  const a = await bench.machine('a')
  const b = await bench.machine('b')
  a.service.settings.set({ projectsAccess: options.access ?? true })
  await connect(b, a)
  return { a, b, aId: a.service.machine.id, bId: b.service.machine.id }
}

/**
 * Waits until the notes `a` sent before now have reached `b`: a marker note goes over the same
 * connection after them, and the connection keeps the order. The marker is not shown.
 */
async function settled(a: Machine, b: Machine): Promise<void> {
  let seen = false
  const id = `marker-${Math.random()}`
  b.service.registerMessage({ name: id, schema: noteMessage.schema }, () => {
    seen = true
  })
  a.service.sendMessage(b.service.machine.id, { name: id, schema: noteMessage.schema }, { title: '', body: '', sessionId: 'x', projectRoot: null })
  await until(() => seen)
}

describe('a note of a Session of the Project machine on a Linked machine', () => {
  it('the result and the permission request of a Session on A are shown on B with the same title and body', async () => {
    const { a, b, aId } = await pair()
    const onA = notifications(a)
    const onB = notifications(b)
    onA.event('s1', init('/Users/test/alpha'))
    onA.event('s1', result())
    await until(() => onB.shown.length === 1)
    expect(onA.notes()).toEqual([{ title: 'alpha', body: 'All tests pass.', sessionId: 's1', projectRoot: null }])
    // The sender's Machine comes from the connection, not from the message.
    expect(onB.notes()).toEqual([{ title: 'alpha', body: 'All tests pass.', sessionId: 's1', projectRoot: null, machineId: aId }])

    onA.wait(NOTIFY_INTERVAL_MS)
    onB.wait(NOTIFY_INTERVAL_MS)
    onA.event('s1', permission('git push origin main'))
    await until(() => onB.shown.length === 2)
    expect(onB.notes()[1]).toEqual({ title: 'alpha', body: 'Needs permission: Bash git push origin main', sessionId: 's1', projectRoot: null, machineId: aId })
    expect(onA.notes()[1]).toEqual({ title: 'alpha', body: 'Needs permission: Bash git push origin main', sessionId: 's1', projectRoot: null })
  })

  it('works both ways: a Session on B notifies A when B shares its Projects', async () => {
    const { a, b, bId } = await pair()
    b.service.settings.set({ projectsAccess: true })
    const onA = notifications(a)
    const onB = notifications(b)
    onB.event('s9', result('From B'))
    await until(() => onA.shown.length === 1)
    expect(onA.notes()).toEqual([{ title: 'Session', body: 'From B', sessionId: 's9', projectRoot: null, machineId: bId }])
  })

  it('a Machine does not pass on the notes it received: B shows A\'s note, C linked to B only gets nothing', async () => {
    const { a, b } = await pair()
    b.service.settings.set({ projectsAccess: true })
    const c = await bench.machine('c')
    await connect(c, b)
    const onA = notifications(a)
    const onB = notifications(b)
    const onC = notifications(c)
    onA.event('s1', result())
    await until(() => onB.shown.length === 1)
    await settled(b, c)
    expect(onC.shown).toEqual([])
    expect(onA.shown).toHaveLength(1)
  })

  it('B with read-only access gets the notes; B whose own level is off gets none (worfy-link ticket 18)', async () => {
    const { a, b, bId } = await pair()
    const onA = notifications(a)
    const onB = notifications(b)
    a.service.settings.setLevel(bId, 'read')
    onA.event('s1', result('while read-only'))
    await until(() => onB.shown.length === 1)
    expect(onB.notes().map((note) => note.body)).toEqual(['while read-only'])

    a.service.settings.setLevel(bId, 'off')
    onA.wait(NOTIFY_INTERVAL_MS)
    onA.event('s1', result('while off'))
    expect(onA.notes().map((note) => note.body)).toEqual(['while read-only', 'while off'])
    await settled(a, b)
    expect(onB.shown).toHaveLength(1)
  })

  it('with the access switch off on A, B gets nothing; on again, the next note comes', async () => {
    const { a, b } = await pair({ access: false })
    const onA = notifications(a)
    const onB = notifications(b)
    onA.event('s1', result('while off'))
    expect(onA.notes().map((note) => note.body)).toEqual(['while off'])
    await settled(a, b)
    expect(onB.shown).toEqual([])

    a.service.settings.set({ projectsAccess: true })
    onA.wait(NOTIFY_INTERVAL_MS)
    onA.event('s1', result('while on'))
    await until(() => onB.shown.length === 1)
    expect(onB.notes().map((note) => note.body)).toEqual(['while on'])
  })

  it('without a connection B gets nothing, and once connected again it gets no old note', async () => {
    const { a, b, bId } = await pair()
    const onA = notifications(a)
    const onB = notifications(b)
    await b.service.stop()
    await until(() => !a.service.isConnected(bId))
    // Not connected: nothing to send it over, nothing kept for later, and no error.
    expect(() => onA.event('s1', result('while away'))).not.toThrow()
    expect(onA.notes().map((note) => note.body)).toEqual(['while away'])

    await bench.restart(b)
    const back = notifications(b)
    await connect(b, a)
    await settled(a, b)
    expect(back.shown).toEqual([])
    expect(onB.shown).toEqual([])

    onA.wait(NOTIFY_INTERVAL_MS)
    onA.event('s1', result('after'))
    await until(() => back.shown.length === 1)
    expect(back.notes().map((note) => note.body)).toEqual(['after'])
  })
})

describe('the rules of showing, on each Machine its own', () => {
  it('B with its window focused does not show, while A shows; A focused does not hold B back', async () => {
    const { a, b } = await pair()
    const onA = notifications(a)
    const onB = notifications(b)
    onB.focus(true)
    onA.event('s1', result('one'))
    expect(onA.notes().map((note) => note.body)).toEqual(['one'])
    await settled(a, b)
    expect(onB.shown).toEqual([])

    // A's own focus holds back A's banner only: the note still goes to B.
    onB.focus(false)
    onA.focus(true)
    onA.wait(NOTIFY_INTERVAL_MS)
    onA.event('s1', result('two'))
    await until(() => onB.shown.length === 1)
    expect(onB.notes().map((note) => note.body)).toEqual(['two'])
    expect(onA.notes().map((note) => note.body)).toEqual(['one'])
  })

  it('each Machine counts its own 10 s per Session; a note held back by focus is not counted', async () => {
    const { a, b } = await pair()
    const onA = notifications(a)
    const onB = notifications(b)
    // B is focused for the first note: held back there, so B's 10 s do not start.
    onB.focus(true)
    onA.event('s1', result('first'))
    await settled(a, b)
    onB.focus(false)
    // A's 10 s run: A does not show the second note, B — whose count has not started — does.
    onA.event('s1', result('second'))
    await until(() => onB.shown.length === 1)
    expect(onA.notes().map((note) => note.body)).toEqual(['first'])
    expect(onB.notes().map((note) => note.body)).toEqual(['second'])
    // Now B's 10 s run, A's are over: A shows, B does not.
    onA.wait(NOTIFY_INTERVAL_MS)
    onA.event('s1', result('third'))
    await settled(a, b)
    expect(onA.notes().map((note) => note.body)).toEqual(['first', 'third'])
    expect(onB.notes().map((note) => note.body)).toEqual(['second'])
    onB.wait(NOTIFY_INTERVAL_MS)
    onA.wait(NOTIFY_INTERVAL_MS)
    onA.event('s1', result('fourth'))
    await until(() => onB.shown.length === 2)
  })
})

describe('a click on a note from a Linked machine', () => {
  /** A BrowserWindow as openNote uses it. */
  function fakeWindow(id: number) {
    const sent: string[] = []
    const calls: string[] = []
    return {
      sent,
      calls,
      window: {
        isDestroyed: () => false,
        isMinimized: () => false,
        restore: () => calls.push('restore'),
        show: () => calls.push('show'),
        focus: () => calls.push('focus'),
        webContents: { id, send: (channel: string) => sent.push(channel), once: () => undefined },
      },
    }
  }

  it('raises B\'s window, keeps the note with Machine A for B\'s client; notify.pending hands it out once; A opens nothing', async () => {
    const { a, b, aId } = await pair()
    const pendingB = new PendingOpens()
    const windowB = fakeWindow(41)
    const onA = notifications(a)
    const onB = notifications(b, (note) => openNote(note, pendingB, () => windowB.window as never))
    electron.windows = [windowB.window]
    onA.event('s1', permission())
    await until(() => onB.shown.length === 1)
    onB.shown[0]?.click()
    expect(windowB.calls).toEqual(['show', 'focus'])
    expect(windowB.sent).toEqual(['worfy:notify.open'])
    expect(onA.opened).toEqual([])

    const { notifyHandlers } = await import('../../src/main/ipc/notify')
    const { registerIpc } = await import('../../src/main/ipc/index')
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener as never) }, { modules: { './notify.ts': () => Promise.resolve(notifyHandlers(pendingB)) }, isTrustedSender: (url) => url === APP_URL })
    const pendingFor = (id: number) => handlers.get('worfy:notify.pending')?.({ senderFrame: { url: APP_URL }, sender: { id } })
    expect(await pendingFor(7)).toEqual({ ok: true, value: { note: null } })
    expect(await pendingFor(41)).toEqual({ ok: true, value: { note: { sessionId: 's1', projectRoot: null, machineId: aId } } })
    expect(await pendingFor(41)).toEqual({ ok: true, value: { note: null } })
  })
})

describe('the note as it travels', () => {
  it('a note outside the schema never reaches B\'s display', async () => {
    const { a, b } = await pair()
    const onB = notifications(b)
    // A peer that sends a note without a Session: B's side of the schema drops it.
    a.service.connectionTo(b.service.machine.id)?.send({ t: 'msg', name: noteMessage.name, payload: { title: 't', body: 'b', projectRoot: null } })
    await settled(a, b)
    expect(onB.shown).toEqual([])
    expect(bench.captured.join('\n')).toMatch(/sent message note outside its schema; dropped/)
  })
})

describe('the note of a Ticket that waits, over the link (worfy-pipeline ticket 10)', () => {
  const A_ROOT = '/Users/a/worfy'
  const B_ROOT = 'C:/src/worfy'
  const REPO_KEY = projectMatchKey({ id: 'any', origin: 'git.example.com/o/worfy', repoPath: '' })
  const AT = '2026-10-20T09:00Z'
  const waiting = (waits: string, num = 16): Ticket => ({
    epic: 'worfy-link',
    num,
    slug: 'slug',
    title: 'Acceptance',
    statusRaw: 'blocked',
    state: 'blocked',
    statusAt: AT,
    statusError: null,
    blockedReason: 'acceptance',
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
  const empty = (root: string): WorkflowModel => ({ root, epics: [], tickets: [], error: null, branchErrors: [] })

  /**
   * One Machine's notifications with its Tickets: its Project list (each with a match key), a workflow
   * hub the test drives, the Sessions' notes and the Tickets' notes it shows, and the frames it receives.
   */
  async function onMachine(machine: Machine, projects: (ListedProject & { key: string })[], link: NoteLink & TicketLink = new LinkNotes(machine.service)) {
    /** How many times this Machine handed a Ticket's note to its link (whether or not it went out). */
    let attempts = 0
    const send = link.sendTicket.bind(link)
    link.sendTicket = (note, to) => {
      attempts += 1
      send(note, to)
    }
    const subscribers = new Map<string, WorkflowSubscriber>()
    const hub = {
      open: async (root: string, each: WorkflowSubscriber) => {
        subscribers.set(root, each)
        return empty(root)
      },
      close: async () => true,
    }
    let listener: (sessionId: string, event: AgentEvent) => void = () => undefined
    const sessions: Note[] = []
    const tickets: TicketNote[] = []
    const keys = new Map(projects.map((project) => [project.path, project.key]))
    const stop = installNotifications(
      {
        observe: (each) => {
          listener = each
          return () => undefined
        },
      },
      new Set(),
      { focused: () => false, show: (note) => sessions.push(note), open: () => undefined, now: () => 1 },
      link,
      {
        hub,
        projects: () => projects,
        matchKey: async (root, id) => keys.get(root) ?? projectMatchKey({ id, origin: null, repoPath: null }),
        deps: { focused: () => false, show: (note) => tickets.push(note), open: () => undefined, now: () => 1 },
      },
    )
    stops.push(stop)
    await until(() => projects.every((project) => subscribers.has(project.path)))
    // The first model of each Project is its start.
    await new Promise((done) => setTimeout(done, 0))
    return {
      sessions,
      tickets,
      attempts: () => attempts,
      event: (sessionId: string, event: AgentEvent) => listener(sessionId, event),
      wait: (root: string, ticket: Ticket) => subscribers.get(root)?.send({ root, epics: [], tickets: [ticket], removedEpics: [], removedTickets: [], error: null, branchErrors: [] }),
    }
  }

  /** The frames `machine` receives from `from` from now on, by message name. */
  function framesOf(machine: Machine, from: string): string[] {
    const names: string[] = []
    machine.service.connectionTo(from)?.on('frame', (frame: Frame) => {
      if (frame.t === 'msg') names.push(frame.name)
    })
    return names
  }

  /** A, which shares its Projects, and B connected to it, each with its Tickets' notes; A accepts nothing yet unknown. */
  async function pairWithTickets(bProjects: (ListedProject & { key: string })[] = []) {
    const { a, b, aId, bId } = await pair()
    const onA = await onMachine(a, [{ path: A_ROOT, id: 'worfy-aaaaaaaa', name: 'worfy', key: REPO_KEY }])
    const onB = await onMachine(b, bProjects)
    // B registered `ticket-note` after the connection opened: its `hello` again tells A.
    await until(() => a.service.accepts(bId, ticketNoteMessage) && b.service.accepts(aId, ticketNoteMessage))
    return { a, b, aId, bId, onA, onB }
  }

  it('the message: a full note passes; without epic, NN, the Project id or the match key it is refused; a projectRoot is cut; the limits are those of note', () => {
    const note = { title: 't', body: 'b', project: { id: 'worfy-aaaaaaaa', name: 'worfy', match: REPO_KEY }, epic: 'e', num: 1, wait: 'w' }
    expect(ticketNoteMessage.schema.parse(note)).toEqual(note)
    expect(ticketNoteMessage.schema.parse({ ...note, projectRoot: A_ROOT })).toEqual(note)
    const without = (key: keyof typeof note) => Object.fromEntries(Object.entries(note).filter(([each]) => each !== key))
    for (const each of [without('epic'), without('num'), { ...note, project: { name: 'worfy', match: REPO_KEY } }, { ...note, project: { id: 'worfy-aaaaaaaa', name: 'worfy' } }, { ...note, wait: '' }]) {
      expect(ticketNoteMessage.schema.safeParse(each).success).toBe(false)
    }
    expect(ticketNoteMessage.schema.safeParse({ ...note, title: 'x'.repeat(1001) }).success).toBe(false)
    expect(ticketNoteMessage.schema.safeParse({ ...note, body: 'x'.repeat(1001) }).success).toBe(false)
    expect(ticketNoteMessage.schema.safeParse({ ...note, title: 'x'.repeat(1000), body: 'x'.repeat(1000) }).success).toBe(true)
    // Every other field has its limit too: at it passes, one over is refused.
    const at = (limit: number) => 'x'.repeat(limit)
    const cases: [string, (value: string | number) => unknown, string | number, string | number][] = [
      ['project.id', (value) => ({ ...note, project: { ...note.project, id: value } }), at(1000), at(1001)],
      ['project.name', (value) => ({ ...note, project: { ...note.project, name: value } }), at(1000), at(1001)],
      ['project.match', (value) => ({ ...note, project: { ...note.project, match: value } }), at(4096), at(4097)],
      ['wait', (value) => ({ ...note, wait: value }), at(4096), at(4097)],
      ['epic', (value) => ({ ...note, epic: value }), at(200), at(201)],
      ['num', (value) => ({ ...note, num: value }), 1_000_000, 1_000_001],
    ]
    for (const [field, make, ok, over] of cases) {
      expect(ticketNoteMessage.schema.safeParse(make(ok)).success, `${field} at its limit`).toBe(true)
      expect(ticketNoteMessage.schema.safeParse(make(over)).success, `${field} over its limit`).toBe(false)
    }
    expect(ticketNoteMessage.schema.safeParse({ ...note, num: -1 }).success).toBe(false)
    expect(ticketNoteMessage.schema.safeParse({ ...note, num: 1.5 }).success).toBe(false)
  })

  it('a Ticket of A going into Waits: owner is shown on A, and on B with A\'s name; the frame carries no projectRoot and no local path', async () => {
    const { a, b, aId, onA, onB } = await pairWithTickets()
    const raw: unknown[] = []
    b.service.connectionTo(aId)?.on('frame', (frame: Frame) => {
      if (frame.t === 'msg' && frame.name === ticketNoteMessage.name) raw.push(frame.payload)
    })
    onA.wait(A_ROOT, waiting('owner'))
    await until(() => onB.tickets.length === 1)
    expect(onA.tickets.map((note) => note.title)).toEqual(['worfy-link 16 is waiting for you'])
    expect(onB.tickets).toEqual([
      { title: `worfy-link 16 is waiting for you (${a.service.machine.name})`, body: 'acceptance', sessionId: null, projectRoot: null, ticket: { epic: 'worfy-link', num: 16 }, machineId: aId, projectId: 'worfy-aaaaaaaa' },
    ])
    expect(raw).toHaveLength(1)
    expect(Object.keys(raw[0] as object).sort()).toEqual(['body', 'epic', 'num', 'project', 'title', 'wait'])
    expect(JSON.stringify(raw)).not.toContain(A_ROOT)
  })

  it('Waits: <the name of B> reaches B alone, A shows nothing; Waits: <the name of A> stays on A', async () => {
    const { a, b, aId, bId, onA, onB } = await pairWithTickets()
    const nameOfB = a.service.linkedMachines().find((machine) => machine.id === bId)?.name
    expect(nameOfB).toBe(b.service.machine.name)
    onA.wait(A_ROOT, waiting(nameOfB!, 1))
    await until(() => onB.tickets.length === 1)
    expect(onA.tickets).toEqual([])
    expect(onB.tickets[0]).toMatchObject({ ticket: { num: 1 }, machineId: aId })

    onA.wait(A_ROOT, waiting(a.service.machine.name, 2))
    await until(() => onA.tickets.length === 1)
    expect(onA.tickets[0]?.ticket.num).toBe(2)
    // The control: a Session note after it reaches B, and still only one Ticket note there.
    onA.event('s1', result())
    await until(() => onB.sessions.length === 1)
    expect(onB.tickets).toHaveLength(1)
  })

  it('B with the same repository in its list (another path, the same match key) drops A\'s note: it notified of it itself', async () => {
    const { b, aId, onA, onB } = await pairWithTickets([{ path: B_ROOT, id: 'worfy-bbbbbbbb', name: 'worfy', key: REPO_KEY }])
    const frames = framesOf(b, aId)
    onA.wait(A_ROOT, waiting('owner'))
    onB.wait(B_ROOT, waiting('owner'))
    await until(() => frames.includes(ticketNoteMessage.name))
    // B's handler ran as the frame came; the rest of its decision waits only on the test's match keys,
    // which resolve in microtasks: a macrotask later it has decided.
    await new Promise((done) => setTimeout(done, 0))
    expect(onA.tickets.map((note) => note.title)).toEqual(['worfy-link 16 is waiting for you'])
    expect(onB.tickets.map((note) => note.title)).toEqual(['worfy-link 16 is waiting for you'])
  })

  it('B of a build before the message (hello without accepts) gets no ticket-note, its link works as before; accepts without the name — none either; with it — the note comes', async () => {
    const { a, b, aId, bId, onA, onB } = await pairWithTickets()
    const frames = framesOf(b, aId)
    const hellosAtA = framesOf(a, bId)
    const helloOfB = { id: bId, name: b.service.machine.name, protocol: 3, build: '0.1.0+old', port: null }
    /** B says `hello` (with `accepts` or without); resolves once A has received it. */
    const announce = async (accepts?: string[]) => {
      const before = hellosAtA.filter((name) => name === 'hello').length
      b.service.connectionTo(aId)?.send({ t: 'msg', name: 'hello', payload: accepts === undefined ? helloOfB : { ...helloOfB, accepts } })
      await until(() => hellosAtA.filter((name) => name === 'hello').length === before + 1)
    }

    await announce()
    expect(a.service.accepts(bId, ticketNoteMessage)).toBe(false)
    expect(a.service.isConnected(bId)).toBe(true)
    onA.wait(A_ROOT, waiting('owner', 1))
    // A has handed the note to its link: whatever it sends goes before the Session note below.
    await until(() => onA.attempts() === 1)
    onA.event('s1', result('first'))
    await until(() => onB.sessions.length === 1)

    await announce(['note', 'hello'])
    expect(a.service.accepts(bId, ticketNoteMessage)).toBe(false)
    onA.wait(A_ROOT, waiting('owner', 2))
    await until(() => onA.attempts() === 2)
    onA.event('s2', result('second'))
    await until(() => onB.sessions.length === 2)
    expect(frames.filter((name) => name === ticketNoteMessage.name)).toEqual([])
    expect(onB.tickets).toEqual([])
    expect(bench.captured.join('\n')).not.toMatch(/unknown message ticket-note/)
    // A shows its own notes all the same.
    expect(onA.tickets.map((note) => note.ticket.num)).toEqual([1, 2])

    // The control: once B names the message, the next wait comes.
    await announce(['note', 'ticket-note'])
    expect(a.service.accepts(bId, ticketNoteMessage)).toBe(true)
    onA.wait(A_ROOT, waiting('owner', 3))
    await until(() => onB.tickets.length === 1)
    expect(onB.tickets[0]?.ticket.num).toBe(3)
  })
})

describe('the note of a Ticket over the link: whom it reaches, and the app\'s link (worfy-pipeline ticket 10, round 2)', () => {
  const A_ROOT = '/Users/a/worfy'
  const REPO_KEY = projectMatchKey({ id: 'any', origin: 'git.example.com/o/worfy', repoPath: '' })
  const waiting = (waits: string, num: number, reason = 'acceptance', statusAt = '2026-10-20T09:00Z'): Ticket => ({
    epic: 'worfy-link',
    num,
    slug: 'slug',
    title: 'Acceptance',
    statusRaw: 'blocked',
    state: 'blocked',
    statusAt,
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

  /** A Machine's Tickets' notes through `link`: a hub the test drives for its one Project at `root`, if any. */
  async function tickets(machine: Machine, root: string | null, link: NoteLink & TicketLink = new LinkNotes(machine.service)) {
    let subscriber: WorkflowSubscriber | undefined
    const hub = {
      open: async (each: string, sub: WorkflowSubscriber) => {
        subscriber = sub
        return { root: each, epics: [], tickets: [], error: null, branchErrors: [] }
      },
      close: async () => true,
    }
    let listener: (sessionId: string, event: AgentEvent) => void = () => undefined
    const sessions: Note[] = []
    const shown: TicketNote[] = []
    const stop = installNotifications(
      {
        observe: (each) => {
          listener = each
          return () => undefined
        },
      },
      new Set(),
      { focused: () => false, show: (note) => sessions.push(note), open: () => undefined, now: () => 1 },
      link,
      {
        hub,
        projects: () => (root === null ? [] : [{ path: root, id: 'worfy-aaaaaaaa', name: 'worfy' }]),
        matchKey: async () => REPO_KEY,
        deps: { focused: () => false, show: (note) => shown.push(note), open: () => undefined, now: () => 1 },
      },
    )
    stops.push(stop)
    if (root !== null) await until(() => subscriber !== undefined)
    await new Promise((done) => setTimeout(done, 0))
    return {
      shown,
      sessions,
      stop,
      event: (sessionId: string, event: AgentEvent) => listener(sessionId, event),
      wait: (ticket: Ticket) => subscriber?.send({ root: A_ROOT, epics: [], tickets: [ticket], removedEpics: [], removedTickets: [], error: null, branchErrors: [] }),
    }
  }

  /** A sharing its Projects with B and C, both connected and both accepting `ticket-note`. */
  async function three() {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const c = await bench.machine('c')
    a.service.settings.set({ projectsAccess: true })
    await connect(b, a)
    await connect(c, a)
    const onA = await tickets(a, A_ROOT)
    const onB = await tickets(b, null)
    const onC = await tickets(c, null)
    const [aId, bId, cId] = [a, b, c].map((each) => each.service.machine.id) as [string, string, string]
    await until(() => a.service.accepts(bId, ticketNoteMessage) && a.service.accepts(cId, ticketNoteMessage))
    return { a, b, c, aId, bId, cId, onA, onB, onC }
  }

  it('two Linked machines: Waits: <the name of B> reaches B alone, C gets nothing; Waits: owner reaches both', async () => {
    const { a, bId, cId, onA, onB, onC } = await three()
    const nameOfB = a.service.linkedMachines().find((machine) => machine.id === bId)!.name
    expect(a.service.linkedMachines().find((machine) => machine.id === cId)!.name).not.toBe(nameOfB)
    onA.wait(waiting(nameOfB, 1))
    await until(() => onB.shown.length === 1)
    // The control: a Session note after it reaches C over the same connection, and still no Ticket note there.
    onA.event('s1', result())
    await until(() => onC.sessions.length === 1)
    expect(onC.shown).toEqual([])
    onA.wait(waiting('owner', 2))
    await until(() => onB.shown.length === 2 && onC.shown.length === 1)
    expect(onC.shown[0]?.ticket.num).toBe(2)
  })

  it('B whose own level is off on A gets no Ticket note; read-only B gets it', async () => {
    const { a, b, bId, onA, onB, onC } = await three()
    a.service.settings.setLevel(bId, 'off')
    onA.wait(waiting('owner', 1))
    await until(() => onC.shown.length === 1)
    onA.event('s1', result())
    await until(() => onC.sessions.length === 1)
    await settled(a, b)
    expect(onB.shown).toEqual([])
    a.service.settings.setLevel(bId, 'read')
    onA.wait(waiting('owner', 2))
    await until(() => onB.shown.length === 1)
    expect(onB.shown[0]?.ticket.num).toBe(2)
  })

  it('a Blocked reason of 1200 characters: B still gets the note, its body clipped', async () => {
    const { onA, onB } = await three()
    // A Status with a date alone: the key of the wait holds the whole reason.
    onA.wait(waiting('owner', 1, 'r'.repeat(1200), '2026-10-20'))
    await until(() => onB.shown.length === 1)
    expect(onB.shown[0]!.body.length).toBeLessThanOrEqual(160)
    expect(onA.shown[0]!.body).toBe('r'.repeat(1200))
  })

  it('the app\'s link (appNoteLink): before the link starts it names this Machine from link/machine.json; once started, a Ticket note of A reaches it; stopped, no more', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    a.service.settings.set({ projectsAccess: true })
    await connect(b, a)
    const before = process.env.WORFY_DATA_DIR
    process.env.WORFY_DATA_DIR = b.dataDir
    try {
      appLink.service = undefined
      const link = appNoteLink()
      expect(link.machines()).toEqual({ self: b.service.machine.name, linked: [] })
      appLink.service = b.service
      for (const listener of appLink.listeners) listener()
      expect(link.machines().linked.map((machine) => machine.id)).toEqual([a.service.machine.id])
      const onA = await tickets(a, A_ROOT)
      const onB = await tickets(b, null, link)
      await until(() => a.service.accepts(b.service.machine.id, ticketNoteMessage))
      onA.wait(waiting('owner', 1))
      await until(() => onB.shown.length === 1)
      expect(onB.shown[0]).toMatchObject({ machineId: a.service.machine.id, ticket: { num: 1 } })

      const notes: unknown[] = []
      b.service.connectionTo(a.service.machine.id)?.on('frame', (frame: Frame) => {
        if (frame.t === 'msg' && frame.name === ticketNoteMessage.name) notes.push(frame.payload)
      })
      onB.stop()
      onA.wait(waiting('owner', 2))
      // The note still comes over the link; with the notifications stopped nothing shows it.
      await until(() => notes.length === 1)
      await new Promise((done) => setTimeout(done, 0))
      expect(onB.shown).toHaveLength(1)
      link.stop()
    } finally {
      appLink.service = undefined
      if (before === undefined) delete process.env.WORFY_DATA_DIR
      else process.env.WORFY_DATA_DIR = before
    }
  })
})
