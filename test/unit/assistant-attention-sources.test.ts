// The sources of the attention core (worfy-assistant ticket 03): the seven sources of main become items with their
// fields, the waits are counted for every Project of the Machine with no window open, and what came while worfy was
// closed becomes an item after the start. Fixture events take the shape the events measurement saw
// (the events measurement of the proactive-runtime map, docs/product/proactive-runtime/): rules (d), (e) and (f).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LimitsState } from '../../src/shared/agent/limits'
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

const ALPHA = { id: 'p-alpha', path: '/work/alpha' }
const BETA = { id: 'p-beta', path: '/work/beta' }
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
    sessions: { observe: keep('session') },
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
  return { sources, session: call('session'), journalLine: call('journal'), prChanged: call('pr'), health: call('health'), limits: call('limits'), time: { now: () => at, add: (ms) => (at += ms) } }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the seven sources', () => {
  it('each source gives items with the source, Project, subject, kind, start, revision, state and duty', async () => {
    const h = harness({ [ALPHA.path]: model(ALPHA.path, [owner('worfy-x', 1), ticket('worfy-x', 2, { state: 'blocked', statusRaw: 'blocked', waits: 'agent', blockedReason: 'waits for 01' })]) })
    const { core, stop } = installAttentionCore(h.sources)
    await settle()

    h.session('s-1', { type: 'init', cwd: '/work/alpha/.claude/worktrees/07' } as AgentEvent)
    h.session('s-1', { type: 'question_request', requestId: 'q1', toolUseId: null, questions: [{ question: 'Which port?' }] } as AgentEvent)
    h.session('s-2', { type: 'init', cwd: '/work/beta' } as AgentEvent)
    h.session('s-2', { type: 'state', state: 'error', error: 'rate_limit' } as AgentEvent)
    h.session('s-3', { type: 'init', cwd: '/work/beta' } as AgentEvent)
    h.session('s-3', { type: 'permission_request', requestId: 'p1', toolName: 'Bash', input: {} } as unknown as AgentEvent)
    h.session('s-4', { type: 'init', cwd: '/work/beta' } as AgentEvent)
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

  it('projectOfPath: a worktree inside a Project belongs to it, the longest folder wins, a folder of none is the Machine’s', () => {
    const nested = { id: 'p-nested', path: '/work/alpha/sub' }
    expect(projectOfPath([ALPHA, nested], '/work/alpha/sub/x')).toBe('p-nested')
    expect(projectOfPath([ALPHA, nested], '/work/alpha')).toBe(ALPHA.id)
    expect(projectOfPath([ALPHA], '/work/alphabet')).toBeNull()
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
})
