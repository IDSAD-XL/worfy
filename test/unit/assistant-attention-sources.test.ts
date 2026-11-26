// The sources of the attention core (worfy-assistant ticket 03): the seven sources of main become items with their
// fields, the waits are counted for every Project of the Machine with no window open, and what came while worfy was
// closed becomes an item after the start. Fixture events take the shape the events measurement saw
// (the events measurement of the proactive-runtime map, docs/product/proactive-runtime/): rules (d), (e) and (f).
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LimitsState } from '../../src/shared/agent/limits'
import { attentionItemSchema } from '../../src/shared/assistant/attention'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import type { FirstRunReport } from '../../src/shared/ipc/first-run'
import type { PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { installAttentionCore, type AttentionSources } from '../../src/main/assistant/core/install'
import { attentionFileStore, attentionPaths } from '../../src/main/assistant/core/store'
import { projectOfPath, SESSION_WAIT_MS } from '../../src/main/assistant/core/sources'
import { removeTree } from '../../src/main/storage/remove'

const temp = mkdtempSync(join(tmpdir(), 'worfy-attention-sources-'))
afterAll(() => removeTree(temp))

// Native paths: a Project's folder as the Project list spells it on this system.
const WORK = resolve(sep, 'work')
const ALPHA = { id: 'p-alpha', path: join(WORK, 'alpha') }
const BETA = { id: 'p-beta', path: join(WORK, 'beta') }
const MIN = 60_000

const ticket = (epic: string, num: number, extra: Partial<Ticket> = {}): Ticket => ({
  epic,
  num,
  slug: 'slug',
  title: `Title of ${epic} ${num}`,
  statusRaw: 'work',
  state: 'work',
  statusAt: '2026-11-13T09:00Z',
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
/** Rule (f): a Ticket became `blocked` with `Waits: owner`. */
const owner = (epic: string, num: number, statusAt = '2026-11-13T10:00Z'): Ticket => ticket(epic, num, { state: 'blocked', statusRaw: 'blocked', waits: 'owner', blockedReason: 'acceptance by the owner', statusAt })
const model = (root: string, tickets: Ticket[]): WorkflowModel => ({ root, epics: [], tickets, error: null, branchErrors: [] })

/** Rule (d): a line `run-stopped` of an Autopilot journal. */
const runStopped = (at: string, reason = 'blocked-tickets'): JournalEvent => ({ kind: 'run-stopped', at, run: '2026-11-17T08-00-00-000Z-abcd', project: ALPHA.id, epic: 'worfy-x', reason }) as JournalEvent

interface Harness {
  sources: AttentionSources
  /** worfy quits: the registry departs, and the Sessions it halts close. */
  quit: () => void
  session: (sessionId: string, event: AgentEvent) => void
  journalLine: (line: JournalEvent) => void
  prChanged: (projectId: string) => void
  health: (report: FirstRunReport) => void
  limits: (state: LimitsState) => void
  time: { now: () => number; add: (ms: number) => void }
}

let roots = 0
/** Sources that are fakes of main's: a workflow hub that answers `models` (no window subscribes), and the rest by hand. */
function harness(models: Record<string, WorkflowModel>, options: { root?: string; start?: string; journal?: JournalEvent[][]; pr?: PrInboxSnapshot } = {}): Harness {
  const root = options.root ?? join(temp, `root-${roots++}`)
  let at = Date.parse(options.start ?? '2026-11-13T12:00:00Z')
  let departing = false
  const listeners: Record<string, (...args: never[]) => void> = {}
  const keep =
    (name: string) =>
    (listener: (...args: never[]) => void): (() => void) => {
      listeners[name] = listener
      return () => delete listeners[name]
    }
  const sources: AttentionSources = {
    now: () => at,
    store: attentionFileStore(attentionPaths((id) => join(root, 'projects', id), root)),
    settings: () => ({ timeZone: 'Europe/Berlin' }),
    projects: () => [ALPHA, BETA],
    sessions: { observe: keep('session'), isDeparting: () => departing },
    hub: { open: async (path: string) => models[path] ?? model(path, []), close: async () => true } as unknown as AttentionSources['hub'],
    prInbox: { snapshot: () => options.pr!, onChange: keep('pr') },
    health: { subscribe: keep('health'), current: () => null },
    limits: { subscribe: keep('limits'), snapshot: () => ({ windows: {} }) },
    journal: { onLine: keep('journal'), recent: async () => options.journal ?? [] },
  }
  const call =
    (name: string) =>
    (...args: unknown[]) =>
      (listeners[name] as (...args: unknown[]) => void)(...args)
  return { sources, quit: () => (departing = true), session: call('session'), journalLine: call('journal'), prChanged: call('pr'), health: call('health'), limits: call('limits'), time: { now: () => at, add: (ms) => (at += ms) } }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the seven sources', () => {
  it('each source gives items with the source, Project, subject, kind, start, revision, state and duty', async () => {
    const h = harness({ [ALPHA.path]: model(ALPHA.path, [owner('worfy-x', 1), ticket('worfy-x', 2, { state: 'blocked', statusRaw: 'blocked', waits: 'agent', blockedReason: 'waits for 01' })]) })
    const { core, stop } = installAttentionCore(h.sources)
    await settle()

    h.session('s-1', { type: 'init', cwd: join(ALPHA.path, '.claude', 'worktrees', '07') } as AgentEvent)
    h.session('s-1', { type: 'question_request', requestId: 'q1', toolUseId: null, questions: [{ question: 'Which port?' }] } as AgentEvent)
    h.session('s-2', { type: 'init', cwd: BETA.path } as AgentEvent)
    h.session('s-2', { type: 'state', state: 'error', error: 'rate_limit' } as AgentEvent)
    h.session('s-3', { type: 'init', cwd: BETA.path } as AgentEvent)
    h.session('s-3', { type: 'permission_request', requestId: 'p1', toolName: 'Bash', input: {} } as unknown as AgentEvent)
    h.session('s-4', { type: 'init', cwd: BETA.path } as AgentEvent)
    h.session('s-4', { type: 'quiet', quietSince: h.time.now() - 10 * MIN } as AgentEvent)
    h.journalLine(runStopped('2026-11-13T11:00:00.000Z'))
    h.prChanged(ALPHA.id)
    h.health({ checkedAt: '2026-11-13T12:00:00Z', checks: [{ id: 'github-access', group: 'Projects', title: 'GitHub access', status: 'fail', severity: 'non-critical', project: { id: BETA.id, name: 'beta' }, detail: 'gh is not signed in', hint: '', command: null, actions: [] }] } as unknown as FirstRunReport)
    h.limits({ windows: { five_hour: { utilization: 1, resetsAt: 1_763_000_000, status: 'rejected', receivedAt: h.time.now(), source: 'sdk' } } })

    const kinds = (scope: string | null) => core.items(scope).map((item) => `${item.source}:${item.kind}:${item.subject.kind}:${item.subject.id}`)
    expect(kinds(ALPHA.id)).toEqual(['ticket-waits:waits:ticket:worfy-x/1', 'workflow:blocked:ticket:worfy-x/2', 'session:question:session:s-1', 'autopilot:run-stopped:run:2026-11-17T08-00-00-000Z-abcd'])
    expect(kinds(BETA.id)).toEqual(['session:error:session:s-2', 'session:permission:session:s-3', 'session:quiet:session:s-4', 'health:check-failed:check:github-access'])
    expect(kinds(null)).toEqual(['limits:limit-reached:limit:five_hour'])
    expect(core.items(ALPHA.id)[0]).toEqual(
      expect.objectContaining({ projectId: ALPHA.id, startedAt: Date.parse('2026-11-13T10:00Z'), revision: expect.any(String), state: 'new', duty: null, text: 'acceptance by the owner' }),
    )
    stop()
  })

  it('the PR inbox: a PR that needs the user is an item; once it waits on others, its item closes', async () => {
    const row = { repo: 'acme/app', number: 7, title: 'Fix', updatedAt: '2026-11-13T11:30:00Z' }
    const pr = (group: string): PrInboxSnapshot => ({ projectId: ALPHA.id, enabled: true, viewer: 'me', readAt: '2026-11-13T12:00:00Z', groups: [{ group, rows: [row] }] }) as unknown as PrInboxSnapshot
    let snapshot = pr('needs-review')
    const h = harness({})
    h.sources.prInbox.snapshot = () => snapshot
    const { core, stop } = installAttentionCore(h.sources)
    h.prChanged(ALPHA.id)
    expect(core.items(ALPHA.id).map((item) => [item.kind, item.text, item.state])).toEqual([['needs-review', 'Needs my review: acme/app#7 Fix', 'new']])
    snapshot = pr('waiting')
    h.prChanged(ALPHA.id)
    expect(core.items(ALPHA.id).map((item) => item.state)).toEqual(['closed'])
    stop()
  })

  it('a Session that ended its turn and heard nothing for 15 minutes waits for the user: one item; a prompt closes it', async () => {
    const h = harness({})
    const { core, stop } = installAttentionCore(h.sources)
    h.session('s-1', { type: 'init', cwd: ALPHA.path } as AgentEvent)
    h.session('s-1', { type: 'result', isError: false, interrupted: false, at: h.time.now() } as AgentEvent)
    h.time.add(SESSION_WAIT_MS)
    core.tick()
    expect(core.items(ALPHA.id).map((item) => [item.kind, item.state])).toEqual([
      ['turn-end', 'new'],
      ['waiting', 'new'],
    ])
    h.session('s-1', { type: 'prompt', text: 'go on' } as AgentEvent)
    expect(core.items(ALPHA.id).map((item) => item.state)).toEqual(['closed', 'closed'])
    stop()
  })

  it('a Session that closes after its turn closes its items and its «nothing happened» condition never fires', async () => {
    const h = harness({})
    const { core, stop } = installAttentionCore(h.sources)
    h.session('s-1', { type: 'init', cwd: ALPHA.path } as AgentEvent)
    h.session('s-1', { type: 'result', isError: false, interrupted: false, at: h.time.now() } as AgentEvent)
    h.session('s-1', { type: 'state', state: 'closed', error: null } as AgentEvent)
    h.time.add(SESSION_WAIT_MS)
    core.tick()
    expect(core.items(ALPHA.id).map((item) => [item.kind, item.state])).toEqual([['turn-end', 'closed']])
    stop()
  })

  it('two lines of one kind in one Autopilot run — two Tickets set aside — are two events of the run’s item', async () => {
    const h = harness({})
    const { core, stop } = installAttentionCore(h.sources)
    const setAside = (ticket: string, at: string): JournalEvent => ({ kind: 'ticket-set-aside', at, run: '2026-11-17T08-00-00-000Z-abcd', project: ALPHA.id, epic: 'worfy-x', ticket, cause: 'limits', attempts: 2 }) as unknown as JournalEvent
    h.journalLine(setAside('03', '2026-11-13T11:00:00.000Z'))
    h.journalLine(setAside('05', '2026-11-13T11:30:00.000Z'))
    // Another Ticket set aside in the same millisecond is news too; the same line once more (read back at a start) is not.
    h.journalLine(setAside('07', '2026-11-13T11:30:00.000Z'))
    h.journalLine(setAside('05', '2026-11-13T11:30:00.000Z'))
    expect(core.items(ALPHA.id).map((item) => [item.kind, item.events, item.text])).toEqual([['ticket-set-aside', 3, 'worfy-x: Ticket 07 set aside']])
    stop()
  })

  it('a PR that moves from Needs my answer to Needs a fix with the same updatedAt is news of its item', async () => {
    const row = { repo: 'acme/app', number: 7, title: 'Fix', updatedAt: '2026-11-13T11:30:00Z' }
    let group = 'needs-answer'
    const h = harness({})
    h.sources.prInbox.snapshot = () => ({ projectId: ALPHA.id, enabled: true, viewer: 'me', readAt: '2026-11-13T12:00:00Z', groups: [{ group, rows: [row] }] }) as unknown as PrInboxSnapshot
    const { core, stop } = installAttentionCore(h.sources)
    h.prChanged(ALPHA.id)
    group = 'needs-fix'
    h.prChanged(ALPHA.id)
    expect(core.items(ALPHA.id).map((item) => [item.kind, item.events])).toEqual([['needs-fix', 2]])
    stop()
  })

  it('the Sessions worfy closes when it quits stay as they are: their items stay open and their conditions armed for the next start', async () => {
    const root = join(temp, 'quit-sessions')
    const h = harness({}, { root })
    const one = installAttentionCore(h.sources)
    h.session('s-1', { type: 'init', cwd: ALPHA.path } as AgentEvent)
    h.session('s-1', { type: 'result', isError: false, interrupted: false, at: h.time.now() } as AgentEvent)
    h.quit()
    h.session('s-1', { type: 'state', state: 'closed', error: null } as AgentEvent)
    one.stop()

    const after = harness({}, { root, start: '2026-11-13T12:30:00Z' })
    const two = installAttentionCore(after.sources)
    expect(two.core.items(ALPHA.id).map((item) => [item.kind, item.state])).toEqual([
      ['turn-end', 'new'],
      ['waiting', 'new'],
    ])
    two.stop()
  })
})

describe('every Project of the Machine', () => {
  it('the waits are counted for every Project with no window showing its Pipeline', async () => {
    const h = harness({ [ALPHA.path]: model(ALPHA.path, [owner('worfy-x', 1)]), [BETA.path]: model(BETA.path, [owner('worfy-y', 3), owner('worfy-y', 4)]) })
    const { core, stop } = installAttentionCore(h.sources)
    await settle()
    const waits = (projectId: string) => core.items(projectId).filter((item) => item.kind === 'waits').length
    expect([waits(ALPHA.id), waits(BETA.id)]).toEqual([1, 2])
    stop()
  })

  // worfy-polish 151: the start of the e2e Project of 682 Tickets (test/e2e/epic-frame.spec.ts) wrote the file 96
  // times, once per item, in the main process before the window became interactive.
  it('one read of a Project — 682 Tickets, 111 of them blocked or waiting — is one write of its file and one call of the listeners', async () => {
    const tickets = Array.from({ length: 682 }, (_, n) =>
      n % 7 === 6 ? ticket('worfy-big', n + 1, { state: 'blocked', statusRaw: 'blocked', blockedReason: 'waiting for review' }) : n % 49 === 0 ? owner('worfy-big', n + 1) : ticket('worfy-big', n + 1),
    )
    const h = harness({ [ALPHA.path]: model(ALPHA.path, tickets) })
    const files = h.sources.store
    const writes: (string | null)[] = []
    h.sources.store = { read: files.read, write: (scope, file) => (writes.push(scope), files.write(scope, file)) }
    let told = 0
    const { core, stop } = installAttentionCore(h.sources)
    core.subscribe((scope) => (scope === ALPHA.id ? (told += 1) : undefined))
    // The start keeps the new scope at once (its `since`); the workflow read comes after, from the hub.
    expect(writes.filter((scope) => scope === ALPHA.id)).toHaveLength(1)
    writes.length = 0
    await settle()
    expect(core.items(ALPHA.id).length).toBe(tickets.filter((each) => each.state === 'blocked').length)
    expect(core.items(ALPHA.id).length).toBe(111)
    expect(writes.filter((scope) => scope === ALPHA.id)).toHaveLength(1)
    expect(told).toBe(1)
    stop()
  })

  it('projectOfPath: a worktree inside a Project belongs to it, the longest folder wins, a folder of none is the Machine’s', () => {
    const nested = { id: 'p-nested', path: join(ALPHA.path, 'sub') }
    expect(projectOfPath([ALPHA, nested], join(ALPHA.path, 'sub', 'x'))).toBe('p-nested')
    expect(projectOfPath([ALPHA, nested], ALPHA.path)).toBe(ALPHA.id)
    expect(projectOfPath([ALPHA, nested], join(ALPHA.path, 'sub', '..', 'other'))).toBe(ALPHA.id)
    expect(projectOfPath([{ ...ALPHA, path: ALPHA.path + sep }], join(ALPHA.path, 'x'))).toBe(ALPHA.id)
    expect(projectOfPath([ALPHA], join(WORK, 'alphabet'))).toBeNull()
  })

  it('projectOfPath reads real paths: a folder reached through a link, or /var for /private/var on a Mac, is the Project’s', () => {
    const real = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-attention-real-')))
    const project = join(real, 'project')
    mkdirSync(join(project, 'sub'), { recursive: true })
    const link = join(real, 'link')
    symlinkSync(project, link, 'junction')
    expect(projectOfPath([{ id: 'p-real', path: link }], join(project, 'sub'))).toBe('p-real')
    expect(projectOfPath([{ id: 'p-real', path: project }], join(link, 'sub'))).toBe('p-real')
    // A cwd that is gone (a removed worktree) falls back to the path as it is.
    expect(projectOfPath([{ id: 'p-real', path: project }], join(project, 'gone'))).toBe('p-real')
    removeTree(real)
  })

  it('projectOfPath on Windows: backslashes, either case of the letters, a drive letter', () => {
    const projects = [{ id: 'p-win', path: 'C:\\Work\\Alpha' }]
    expect(projectOfPath(projects, 'c:\\work\\alpha\\.claude\\worktrees\\07', 'win32')).toBe('p-win')
    expect(projectOfPath(projects, 'C:/Work/Alpha', 'win32')).toBe('p-win')
    expect(projectOfPath(projects, 'C:\\Work\\Alphabet', 'win32')).toBeNull()
    expect(projectOfPath(projects, 'c:\\work\\alpha', 'darwin')).toBeNull()
  })
})

describe('catching up after the start', () => {
  it('a Ticket that came to wait while worfy was closed is an item after the start; one taken before is not taken again', async () => {
    const root = join(temp, 'restart-waits')
    const first = harness({ [ALPHA.path]: model(ALPHA.path, [owner('worfy-x', 1)]) }, { root })
    const one = installAttentionCore(first.sources)
    await settle()
    one.stop()

    const second = harness({ [ALPHA.path]: model(ALPHA.path, [owner('worfy-x', 1), owner('worfy-x', 2, '2026-11-13T20:00Z')]) }, { root, start: '2026-11-14T08:00:00Z' })
    const two = installAttentionCore(second.sources)
    await settle()
    expect(two.core.items(ALPHA.id).map((item) => [item.subject.id, item.events, item.startedAt])).toEqual([
      ['worfy-x/1', 1, Date.parse('2026-11-13T10:00Z')],
      ['worfy-x/2', 1, Date.parse('2026-11-13T20:00Z')],
    ])
    two.stop()
  })

  it('an Autopilot journal line written while worfy was closed is an item after the start; lines older than the core are history', async () => {
    const root = join(temp, 'restart-journal')
    const one = installAttentionCore(harness({}, { root, start: '2026-11-13T12:00:00Z' }).sources)
    one.stop()

    const journal = [[runStopped('2026-11-12T09:00:00.000Z', 'app-quit'), runStopped('2026-11-13T22:00:00.000Z')]]
    const two = installAttentionCore(harness({}, { root, start: '2026-11-14T08:00:00Z', journal }).sources)
    await settle()
    expect(two.core.items(ALPHA.id).map((item) => [item.kind, item.startedAt])).toEqual([['run-stopped', Date.parse('2026-11-13T22:00:00.000Z')]])
    two.stop()
  })

  it('a start over 14 days after the core began reads the journal back only 14 days: older lines, whose keys are gone, give no item again', async () => {
    const root = join(temp, 'restart-journal-old')
    const one = installAttentionCore(harness({}, { root, start: '2026-11-01T12:00:00Z' }).sources)
    one.stop()

    const journal = [[runStopped('2026-11-05T09:00:00.000Z'), runStopped('2026-11-20T09:00:00.000Z', 'app-quit')]]
    const two = installAttentionCore(harness({}, { root, start: '2026-11-25T08:00:00Z', journal }).sources)
    await settle()
    expect(two.core.items(ALPHA.id).map((item) => [item.kind, item.startedAt])).toEqual([['run-stopped', Date.parse('2026-11-20T09:00:00.000Z')]])
    two.stop()
  })
})

describe('the stop of an Autopilot Run (ticket 23)', () => {
  const RUN = '2026-11-17T08-00-00-000Z-abcd'
  it('the item of a stop carries its reason in a field of its own and names it in words', async () => {
    const h = harness({})
    const { core, stop } = installAttentionCore(h.sources)
    h.journalLine(runStopped('2026-11-13T11:00:00.000Z', 'user-stop'))
    expect(core.items(ALPHA.id).map((item) => [item.kind, item.stopReason, item.text])).toEqual([['run-stopped', 'user-stop', 'worfy-x: stopped by the user']])
    stop()
  })

  it('another stop carries its own reason; a Run that did its Tickets is still run-finished, with its reason', async () => {
    const h = harness({})
    const { core, stop } = installAttentionCore(h.sources)
    h.journalLine(runStopped('2026-11-13T11:00:00.000Z', 'main-red'))
    h.journalLine({ ...runStopped('2026-11-13T11:30:00.000Z', 'tickets-done'), run: 'run-2' } as JournalEvent)
    expect(core.items(ALPHA.id).map((item) => [item.subject.id, item.kind, item.stopReason, item.text])).toEqual([
      [RUN, 'run-stopped', 'main-red', 'worfy-x: main was red, so the stuck Ticket was not continued'],
      ['run-2', 'run-finished', 'tickets-done', 'worfy-x: every Ticket of the Run is done'],
    ])
    stop()
  })

  it('a stop glued into an item of the Run gives it the reason; a reason this build does not know stays text only', async () => {
    const h = harness({})
    const { core, stop } = installAttentionCore(h.sources)
    h.journalLine({ kind: 'ticket-set-aside', at: '2026-11-13T10:00:00.000Z', run: RUN, project: ALPHA.id, epic: 'worfy-x', ticket: '03', cause: 'no-progress', attempts: 2 } as unknown as JournalEvent)
    expect(core.items(ALPHA.id)[0]?.stopReason).toBeUndefined()
    h.journalLine(runStopped('2026-11-13T11:00:00.000Z', 'user-force-stop'))
    expect(core.items(ALPHA.id).map((item) => [item.kind, item.events, item.stopReason, item.text])).toEqual([['run-stopped', 2, 'user-force-stop', 'worfy-x: force-stopped by the user']])
    h.journalLine({ ...runStopped('2026-11-13T11:30:00.000Z', 'some-later-reason'), run: 'run-3' } as JournalEvent)
    const later = core.items(ALPHA.id).find((item) => item.subject.id === 'run-3')
    expect(later).toMatchObject({ kind: 'run-stopped', text: 'worfy-x: some-later-reason' })
    expect(later).not.toHaveProperty('stopReason')
    stop()
  })

  it('a file of items written before the field reads, and so does a reason a later build wrote', async () => {
    const root = join(temp, 'stop-reason-old-file')
    const item = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      source: 'autopilot',
      projectId: ALPHA.id,
      subject: { kind: 'run', id, label: 'Autopilot · worfy-x' },
      kind: 'run-stopped',
      text: 'worfy-x: user-stop',
      startedAt: Date.parse('2026-11-13T11:00:00.000Z'),
      updatedAt: Date.parse('2026-11-13T11:00:00.000Z'),
      revision: 'r1',
      state: 'new',
      duty: null,
      events: 1,
      ...extra,
    })
    const store = attentionFileStore(attentionPaths((id) => join(root, 'projects', id), root))
    mkdirSync(join(root, 'projects', ALPHA.id), { recursive: true })
    writeFileSync(
      join(root, 'projects', ALPHA.id, 'assistant-items.json'),
      JSON.stringify({ since: Date.parse('2026-11-13T09:00:00.000Z'), items: [item('old'), item('newer', { stopReason: 'some-later-reason' })], seen: {}, conditions: [] }),
    )
    const read = store.read(ALPHA.id)
    expect(read?.items.map((each) => [each.id, each.stopReason])).toEqual([
      ['old', undefined],
      ['newer', 'some-later-reason'],
    ])
    // A build before the field: the same schema without it drops the field and reads the item.
    const before = attentionItemSchema.omit({ stopReason: true })
    expect(before.parse(item('x', { stopReason: 'user-stop' }))).not.toHaveProperty('stopReason')
  })
})
