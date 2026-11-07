// A Run over a queue of Epics (worfy-autopilot-queue ticket 14, ADR-0100). The first part plays the
// queue on the fake agent: the real Session registry, Orchestrators, launcher, run journal, cycle and
// the rule of the queue (epic-queue.ts), over three Epics in a temporary folder. The fake agent plays
// test/fixtures/agent-scripts/autopilot-queue-*.jsonl; this test does what the agent would and marks
// the Tickets of a Wave done when its "Run wave" reaches it. The second part drives the run's queue
// logic over stand-ins (the Session, the waves, the workflow), so each branch is reached in the order
// the test gives. keep-awake is a fake; no real Claude Code or Codex runs, nothing goes to ~/.claude.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher, waveBriefText, type AutopilotWaveResult } from '../../src/main/actions/launch'
import type { RunApproval } from '../../src/main/agent/auto-approve/run-approval'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { LimitsTracker, observeSessionLimits } from '../../src/main/agent/limits'
import { Orchestrators, type OrchestratorBusy } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun, type RunStart } from '../../src/main/autopilot/journal'
import {
  Autopilot,
  NAMED_QUEUE_MESSAGE,
  NO_EDIT_MESSAGE,
  NO_RUN_MESSAGE,
  QUEUE_SIZE_MESSAGE,
  QUEUE_TICKETS_MESSAGE,
  queueFirstMessage,
  queueRefusals,
  RunningElsewhere,
  startQueue,
  STOPPING_MESSAGE,
  type AutopilotDeps,
  type LinkedRuns,
  type RunSession,
} from '../../src/main/autopilot/run'
import { autopilotHandlers } from '../../src/main/ipc/autopilot'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { LayoutStore } from '../../src/main/layout/store'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import type { AgentEvent, SessionState } from '../../src/shared/agent/events'
import { MAX_QUEUE_EPICS } from '../../src/shared/autopilot/epic-queue'
import type { JournalEvent, JournalEventFields } from '../../src/shared/autopilot/journal'
import { autopilotStateSchema, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { readyWave } from '../../src/shared/workflow/waves'
import { APP_URL, INDEX_HTML } from '../app-url'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const PROJECT = 'queue-000000a5'
const ORIGIN = 'github.com/owner/repo'
const WAVE_SCRIPT = 'autopilot-queue-wave'
const LIMITS_SCRIPT = 'autopilot-queue-limits'

let scratch: string
let repo: string
const registries: SessionRegistry[] = []
const autopilots: Autopilot[] = []

async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 5000): Promise<void> {
  const end = Date.now() + ms(limit)
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-autopilot-queue-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
})

afterEach(async () => {
  for (const autopilot of autopilots.splice(0)) await autopilot.stopAll()
  for (const registry of registries.splice(0)) registry.closeAll()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

// ── the Epics in a temporary folder ──────────────────────────────────────────

interface TicketSpec {
  num: number
  status: string
  blocked?: string
  waits?: string
}

const nn = (num: number): string => String(num).padStart(2, '0')
const issues = (epic: string): string => join(repo, '.scratch', epic, 'issues')
/** Each Ticket's last header, by Epic: setStatus rewrites one keeping the others. */
const specs = new Map<string, Map<number, TicketSpec>>()

function writeTicket(epic: string, spec: TicketSpec): void {
  const own = specs.get(epic) ?? new Map<number, TicketSpec>()
  specs.set(epic, own.set(spec.num, spec))
  const lines = [`# ${nn(spec.num)} — Ticket ${spec.num}`, '', 'Type: task', `Status: ${spec.status}`, `Blocked by: ${spec.blocked ?? '—'}`]
  if (spec.waits !== undefined) lines.push(`Waits: ${spec.waits}`)
  writeFileSync(join(issues(epic), `${nn(spec.num)}-ticket-${spec.num}.md`), [...lines, '', '## Где в коде', '', `- \`src/${epic}-${spec.num}.ts\``, ''].join('\n'))
}

/** An Epic of the Project: by default 01 and 02 open, one Wave. */
function writeEpic(epic: string, tickets: TicketSpec[] = [{ num: 1, status: 'open' }, { num: 2, status: 'open' }]): void {
  mkdirSync(issues(epic), { recursive: true })
  writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
  for (const spec of tickets) writeTicket(epic, spec)
}

function setStatus(epic: string, num: number, status: string): void {
  writeTicket(epic, { ...specs.get(epic)!.get(num)!, status })
}

/** `epic-status --json` over every Epic's files, as the real script reads these simple Tickets. */
const runner: EpicStatusRunner = (cwd) => {
  const root = join(cwd, '.scratch')
  const epics = readdirSync(root).filter((name) => readdirSync(join(root, name)).includes('issues'))
  const tickets = epics.flatMap((epic) =>
    readdirSync(join(root, epic, 'issues')).map((name) => {
      const text = readFileSync(join(root, epic, 'issues', name), 'utf8')
      const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text)?.[1] ?? null
      const status = field('Status')
      const blocked = field('Blocked by')
      const word = (status ?? '').split(/\s/)[0] ?? ''
      const state = /^done$/i.test(word) ? 'done' : /^claimed$/i.test(word) ? 'work' : /^blocked$/i.test(word) ? 'blocked' : 'open'
      const nums = blocked && blocked !== '—' ? blocked.split(',').map((each) => Number(each.trim())) : []
      const match = /^(\d+)-(.*)\.md$/.exec(name)!
      return { epic, num: Number(match[1]), slug: match[2], title: text.split('\n')[0]!.replace(/^#\s*/, ''), statusRaw: status, state, blockedRaw: blocked, blockedNums: nums, blockedParsed: true, waits: field('Waits') }
    }),
  )
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: epics.map((epic) => ({ epic, hasSpec: true, hasMap: false })), tickets }))
}

// ── the harness on the fake agent ────────────────────────────────────────────

/** The text the default "Run wave" template sends for these Tickets of an Epic. */
const waveText = (epic: string, nums: number[]): string => `/epic-wave Ticket-ы ${nums.map(nn).join(', ')} эпика ${epic}`

interface HarnessOptions {
  /** What the agent does with a Wave of each Epic: marks its Tickets done (the default), or nothing. */
  agent?: Record<string, 'done' | 'nothing'>
  /** The script of every unattended Session, by its number from 1; WAVE_SCRIPT when absent. */
  script?: (unattended: number) => string
  /** The Linked machines' runs, asked at the start and when the run reaches an Epic (the origin is ORIGIN then). */
  linkedRuns?: () => Promise<readonly LinkedRuns[]>
  /** The Limits and their wait (limits-wait.ts), over the Sessions' own Limits events. */
  limits?: boolean
  /** Told the Epic and the Tickets of every Wave as its prompt reaches the agent. */
  onWave?: (epic: string, nums: number[]) => void
  /** "Process gate queue" answers this text: the machine with `serve` (worfy-windows ticket 17). */
  gateQueue?: string
}

function harness(options: HarnessOptions = {}) {
  const env = { WORFY_DATA_DIR: join(scratch, 'data-root') }
  mkdirSync(env.WORFY_DATA_DIR, { recursive: true })
  const tracker = new LimitsTracker({ dataDir: env.WORFY_DATA_DIR })
  let unattended = 0
  const factory = (request: QueryRequest) => {
    if (request.unattended === true) unattended += 1
    const script = request.unattended === true ? (options.script?.(unattended) ?? WAVE_SCRIPT) : WAVE_SCRIPT
    return fakeQueryFactory({ scriptsDir, script })(request)
  }
  const registry = new SessionRegistry(options.limits === true ? tracker.observe(factory) : factory)
  registries.push(registry)
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  const workflow = async (root: string) => (await readWorkflow({ root, claudeHome: join(scratch, 'claude-home'), env: () => Promise.resolve(process.env) }, runner)).model
  const launcher = new ActionLauncher({
    projectRoot: () => repo,
    settings: () => ({ actionTemplates: { ...DEFAULT_ACTION_TEMPLATES } }),
    branch: () => Promise.resolve('main'),
    workflow,
    sessions: { create: () => ({ nodeId: 'n', sessionId: 's' }) as never },
    orchestrators,
    registry,
    bindings: { setLaunch: () => undefined },
    pollMs: 5,
    waitMs: 200,
  })
  // What the agent does: marks the Wave's Tickets done before its turn ends, unless told otherwise.
  const prompts: string[] = []
  registry.observe((_sessionId, event) => {
    if (event.type !== 'prompt') return
    const wave = /Ticket-ы ([\d, ]+) эпика (\S+)/.exec(event.text)
    if (wave === null) return
    prompts.push(event.text)
    const epic = wave[2]!
    const nums = wave[1]!.split(',').map((each) => Number(each.trim()))
    if ((options.agent?.[epic] ?? 'done') === 'done') for (const num of nums) setStatus(epic, num, 'done — 2026-11-06')
    options.onWave?.(epic, nums)
  })
  const power: string[] = []
  const states: AutopilotState[] = []
  const autopilot = new Autopilot({
    projectRoot: () => repo,
    selfRefusal: () => Promise.resolve(null),
    workflow,
    watchWorkflow: () => Promise.resolve(() => undefined),
    orchestrators,
    registry,
    waves: launcher,
    journal: (start) => openRun(start, { env }),
    harness: () => 'plugin',
    keepAwake: () => ({ start: () => power.push('start'), stop: () => power.push('stop') }),
    onChange: (state) => states.push(state),
    settleMs: 60_000,
    ...(options.linkedRuns === undefined ? {} : { origin: () => Promise.resolve(ORIGIN), linkedRuns: options.linkedRuns }),
    ...(options.limits !== true
      ? {}
      : {
          limits: {
            state: () => tracker.snapshot(),
            observeSession: (isSession, listener) => observeSessionLimits((sink) => registry.observe(sink), isSession, listener),
            send: (sessionId, text) => {
              registry.get(sessionId).send(text)
            },
          },
        }),
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  const gateCalls: string[] = []
  const gateText = options.gateQueue
  if (gateText !== undefined) {
    launcher.autopilotGateQueue = (projectId) => {
      gateCalls.push(projectId)
      return Promise.resolve(gateText)
    }
  }
  const journal = async (): Promise<JournalEvent[]> => {
    const runs = readdirSync(join(env.WORFY_DATA_DIR, 'autopilot')).map((name) => name.replace(/\.jsonl$/, ''))
    expect(runs).toHaveLength(1)
    return (await readRun(runs[0]!, { env }))!.events
  }
  /** The journal as [kind, Epic of the line, what it says], its ticket-status lines left out. */
  const story = async () => (await journal()).filter((event) => event.kind !== 'ticket-status').map(told)
  const stopped = () => until(() => autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
  return { registry, orchestrators, autopilot, prompts, power, states, journal, story, stopped, env, gateCalls }
}

/** One journal line as the tests read it: its kind, its Epic and the field that matters for it. */
function told(event: JournalEvent): [string, string, unknown] {
  switch (event.kind) {
    case 'wave-started':
    case 'wave-finished':
      return [event.kind, event.epic, event.tickets.join(',')]
    case 'epic-started':
      return [event.kind, event.epic, `${event.index}/${event.of}`]
    case 'epic-finished':
      return [event.kind, event.epic, event.tickets === undefined ? event.outcome : `${event.outcome} ${event.tickets.join(',')}`]
    case 'queue-changed':
      return [event.kind, event.epic, { ...(event.added === undefined ? {} : { added: event.added }), ...(event.removed === undefined ? {} : { removed: event.removed }) }]
    case 'run-started':
      return [event.kind, event.epic, event.epics ?? null]
    case 'run-stopped':
      return [event.kind, event.epic, event.reason]
    default:
      return [event.kind, event.epic, null]
  }
}

describe('a Run over a queue of Epics on the fake agent', () => {
  it('two Epics: the first ends done, epic-finished, the second begins with epic-started and runs its Wave in a new SDK session; one run-stopped for the whole Run', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    const h = harness()
    const first = await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    expect(first).toMatchObject({ epic: 'alpha', status: 'running', index: 0, queue: [{ epic: 'alpha', status: 'running' }, { epic: 'beta', status: 'next' }] })
    await h.stopped()

    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta']],
      ['wave-started', 'alpha', '01,02'],
      ['wave-finished', 'alpha', '01,02'],
      ['epic-finished', 'alpha', 'done'],
      ['epic-started', 'beta', '2/2'],
      ['wave-started', 'beta', '01,02'],
      ['wave-finished', 'beta', '01,02'],
      ['run-stopped', 'beta', 'no-ready-wave'],
    ])
    // Each Epic's last statuses come before its end, on lines of its own Epic.
    const events = await h.journal()
    const statuses = events.flatMap((event, at) => (event.kind === 'ticket-status' ? [[at, event.epic, event.ticket, event.state]] : []))
    const finished = events.findIndex((event) => event.kind === 'epic-finished')
    expect(statuses.map(([, epic, ticket, state]) => [epic, ticket, state])).toEqual([
      ['alpha', '01', 'done'],
      ['alpha', '02', 'done'],
      ['beta', '01', 'done'],
      ['beta', '02', 'done'],
    ])
    expect(statuses.slice(0, 2).every(([at]) => (at as number) < finished)).toBe(true)
    // The Wave of the second Epic goes to a new SDK session, as every Wave after the run's first.
    expect(h.prompts).toEqual([waveText('alpha', [1, 2]), waveBriefText('beta', waveText('beta', [1, 2]))])
    expect(h.autopilot.state(PROJECT)).toMatchObject({
      status: 'stopped',
      reason: 'no-ready-wave',
      epic: 'beta',
      wave: 1,
      index: 1,
      queue: [
        { epic: 'alpha', status: 'done' },
        { epic: 'beta', status: 'running' },
      ],
      // The Tickets of both Epics' Waves count in the stop's toast.
      ended: { done: 4, blocked: 0 },
    })
    // The status line runs through the second Epic: its state says so before the run ends.
    expect(h.states.some((state) => state.epic === 'beta' && state.status === 'running' && state.index === 1)).toBe(true)
    for (const state of h.states) expect(autopilotStateSchema.safeParse(state).success).toBe(true)
    // keep-awake once, for the whole Run.
    expect(h.power).toEqual(['start', 'stop'])
  })

  it('on the machine with serve the gate queue goes once, after the last Epic: the first Epic\'s end goes on to the next', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    const h = harness({ gateQueue: '/worfy:gate-queue' })
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta']],
      ['wave-started', 'alpha', '01,02'],
      ['wave-finished', 'alpha', '01,02'],
      ['epic-finished', 'alpha', 'done'],
      ['epic-started', 'beta', '2/2'],
      ['wave-started', 'beta', '01,02'],
      ['wave-finished', 'beta', '01,02'],
      ['gate-queue', 'beta', null],
      ['gate-queue-finished', 'beta', null],
      ['run-stopped', 'beta', 'no-ready-wave'],
    ])
    expect(h.gateCalls).toEqual([PROJECT])
  })

  it('an Epic where only a Ticket that waits for the owner is left: epic-finished waits-owner with that Ticket, and the next Epic goes', async () => {
    writeEpic('alpha', [
      { num: 1, status: 'open' },
      { num: 2, status: 'blocked — 2026-11-06', waits: 'owner' },
    ])
    writeEpic('beta')
    const h = harness()
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta']],
      ['wave-started', 'alpha', '01'],
      ['wave-finished', 'alpha', '01'],
      ['epic-finished', 'alpha', 'waits-owner 02'],
      ['epic-started', 'beta', '2/2'],
      ['wave-started', 'beta', '01,02'],
      ['wave-finished', 'beta', '01,02'],
      ['run-stopped', 'beta', 'no-ready-wave'],
    ])
    expect(h.autopilot.state(PROJECT).queue).toEqual([
      { epic: 'alpha', status: 'waits-owner' },
      { epic: 'beta', status: 'running' },
    ])
  })

  it('the last Epic of the queue where only a Ticket that waits for the owner is left: epic-finished waits-owner with it, then run-stopped waits-owner (ticket 21)', async () => {
    writeEpic('alpha')
    writeEpic('beta', [
      { num: 1, status: 'open' },
      { num: 2, status: 'blocked — 2026-11-07', waits: 'owner' },
    ])
    const h = harness()
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta']],
      ['wave-started', 'alpha', '01,02'],
      ['wave-finished', 'alpha', '01,02'],
      ['epic-finished', 'alpha', 'done'],
      ['epic-started', 'beta', '2/2'],
      ['wave-started', 'beta', '01'],
      ['wave-finished', 'beta', '01'],
      ['epic-finished', 'beta', 'waits-owner 02'],
      ['run-stopped', 'beta', 'waits-owner'],
    ])
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'waits-owner', tickets: ['02'] })
    expect(h.autopilot.state(PROJECT)).toMatchObject({
      status: 'stopped',
      reason: 'waits-owner',
      epic: 'beta',
      index: 1,
      queue: [
        { epic: 'alpha', status: 'done' },
        { epic: 'beta', status: 'waits-owner' },
      ],
    })
  })

  it('on the machine with serve, the last Epic that waits for the owner gets the gate queue\'s turn first, as blocked-tickets does', async () => {
    writeEpic('alpha')
    writeEpic('beta', [
      { num: 1, status: 'open' },
      { num: 2, status: 'blocked — 2026-11-07', waits: 'owner' },
    ])
    const h = harness({ gateQueue: '/worfy:gate-queue' })
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    expect((await h.story()).slice(-4)).toEqual([
      ['epic-finished', 'beta', 'waits-owner 02'],
      ['gate-queue', 'beta', null],
      ['gate-queue-finished', 'beta', null],
      ['run-stopped', 'beta', 'waits-owner'],
    ])
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'waits-owner', tickets: ['02'] })
    expect(h.gateCalls).toEqual([PROJECT])
    expect(h.autopilot.state(PROJECT).reason).toBe('waits-owner')
  })

  it('a Run of one Epic whose Ticket waits for the owner stops with blocked-tickets, as before: no epic-finished (ticket 21)', async () => {
    writeEpic('alpha', [
      { num: 1, status: 'open' },
      { num: 2, status: 'blocked — 2026-11-07', waits: 'owner' },
    ])
    const h = harness()
    await h.autopilot.start(PROJECT, 'alpha')
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', null],
      ['wave-started', 'alpha', '01'],
      ['wave-finished', 'alpha', '01'],
      ['run-stopped', 'alpha', 'blocked-tickets'],
    ])
    expect(h.autopilot.state(PROJECT).reason).toBe('blocked-tickets')
  })

  it('no-progress in the first Epic stops the whole Run: no epic-finished, the second Epic is not begun', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    const h = harness({ agent: { alpha: 'nothing' } })
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta']],
      ['wave-started', 'alpha', '01,02'],
      ['wave-finished', 'alpha', '01,02'],
      ['run-stopped', 'alpha', 'no-progress'],
    ])
    expect(h.prompts).toEqual([waveText('alpha', [1, 2])])
    expect(h.autopilot.state(PROJECT)).toMatchObject({
      reason: 'no-progress',
      index: 0,
      queue: [
        { epic: 'alpha', status: 'running' },
        { epic: 'beta', status: 'next' },
      ],
    })
  })

  it('limits-timeout in the first Epic stops the whole Run: the second Epic is not begun', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    // The Limits refuse the first Wave with a reset years away: the run gives the wait up at once.
    const h = harness({ limits: true, script: () => LIMITS_SCRIPT, agent: { alpha: 'nothing' } })
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta']],
      ['wave-started', 'alpha', '01,02'],
      ['limits-hit', 'alpha', null],
      ['run-stopped', 'alpha', 'limits-timeout'],
    ])
    expect(h.prompts).toEqual([waveText('alpha', [1, 2])])
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'limits-timeout', epic: 'alpha', index: 0 })
  })

  it('the second Epic runs on another Machine when the Run reaches it: epic-finished elsewhere, and the third Epic goes', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    writeEpic('gamma')
    let busy: string[] = []
    const asked: string[][] = []
    const h = harness({
      linkedRuns: () => {
        asked.push([...busy])
        return Promise.resolve([{ machine: 'Studio', runs: busy.map((epic) => ({ epic, origin: ORIGIN })) }])
      },
      // While Epic alpha's Wave runs, Studio starts Epic beta of the same repository.
      onWave: (epic) => {
        if (epic === 'alpha') busy = ['beta']
      },
    })
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta', 'gamma'] })
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta', 'gamma']],
      ['wave-started', 'alpha', '01,02'],
      ['wave-finished', 'alpha', '01,02'],
      ['epic-finished', 'alpha', 'done'],
      ['epic-finished', 'beta', 'elsewhere'],
      ['epic-started', 'gamma', '3/3'],
      ['wave-started', 'gamma', '01,02'],
      ['wave-finished', 'gamma', '01,02'],
      ['run-stopped', 'gamma', 'no-ready-wave'],
    ])
    // Asked once at the start (nothing busy), then at beta and at gamma.
    expect(asked).toEqual([[], ['beta'], ['beta']])
    expect(h.prompts.some((text) => text.includes('эпика beta'))).toBe(false)
    expect(h.autopilot.state(PROJECT).queue).toEqual([
      { epic: 'alpha', status: 'done' },
      { epic: 'beta', status: 'elsewhere' },
      { epic: 'gamma', status: 'running' },
    ])
  })

  it('an Epic of the queue that runs elsewhere at the start refuses the start; "Start anyway" goes, and does not pass that Epic later', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    const linkedRuns = () => Promise.resolve([{ machine: 'Studio', runs: [{ epic: 'beta', origin: ORIGIN }] }])
    const h = harness({ linkedRuns })
    const refused = await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(RunningElsewhere)
    expect(refused).toMatchObject({ epic: 'beta', machine: 'Studio' })
    expect(h.autopilot.running(PROJECT)).toBe(false)

    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'], override: true })
    await h.stopped()
    expect((await h.story()).map(([kind, epic, said]) => `${kind} ${epic} ${String(said)}`)).toEqual([
      'run-started alpha alpha,beta',
      'wave-started alpha 01,02',
      'wave-finished alpha 01,02',
      'epic-finished alpha done',
      'epic-started beta 2/2',
      'wave-started beta 01,02',
      'wave-finished beta 01,02',
      'run-stopped beta no-ready-wave',
    ])
  })

  it('editQueue during a Wave: the change waits for the Wave\'s end, then queue-changed and the removed Epic\'s epic-finished; the added Epic runs; the running Epic cannot be removed', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    writeEpic('gamma')
    const answers: Promise<unknown>[] = []
    let h: ReturnType<typeof harness> | null = null
    h = harness({
      onWave: (epic) => {
        if (epic !== 'alpha') return
        answers.push(h!.autopilot.editQueue(PROJECT, { add: 'gamma', remove: 'beta' }))
        answers.push(h!.autopilot.editQueue(PROJECT, { remove: 'alpha' }).catch((error: unknown) => (error as Error).message))
      },
    })
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    const [edited, refused] = await Promise.all(answers)
    // Answered during the Wave: the queue as it was, the change still to come.
    expect((edited as AutopilotState).queue).toEqual([
      { epic: 'alpha', status: 'running' },
      { epic: 'beta', status: 'next' },
    ])
    expect(refused).toBe(queueRefusals.running('alpha'))
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', ['alpha', 'beta']],
      ['wave-started', 'alpha', '01,02'],
      ['wave-finished', 'alpha', '01,02'],
      ['queue-changed', 'alpha', { added: ['gamma'], removed: ['beta'] }],
      ['epic-finished', 'beta', 'removed'],
      ['epic-finished', 'alpha', 'done'],
      ['epic-started', 'gamma', '2/2'],
      ['wave-started', 'gamma', '01,02'],
      ['wave-finished', 'gamma', '01,02'],
      ['run-stopped', 'gamma', 'no-ready-wave'],
    ])
    expect(h.prompts.some((text) => text.includes('эпика beta'))).toBe(false)
    expect(h.autopilot.state(PROJECT).queue).toEqual([
      { epic: 'alpha', status: 'done' },
      { epic: 'gamma', status: 'running' },
    ])
  })

  it('the old start of one Epic works as before: no queue in run-started, no epic-started or epic-finished, a queue of one in the state', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    const h = harness()
    await h.autopilot.start(PROJECT, 'alpha')
    await h.stopped()
    expect(await h.story()).toEqual([
      ['run-started', 'alpha', null],
      ['wave-started', 'alpha', '01,02'],
      ['wave-finished', 'alpha', '01,02'],
      ['run-stopped', 'alpha', 'no-ready-wave'],
    ])
    expect((await h.journal())[0]).not.toHaveProperty('epics')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ queue: [{ epic: 'alpha', status: 'running' }], index: 0 })
  })
})

// ── the channels ─────────────────────────────────────────────────────────────

type Listener = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>

async function ipcOver(autopilot: () => Autopilot): Promise<(channel: string, input: unknown) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, Listener>()
  const modules = { './autopilot.ts': async () => autopilotHandlers(autopilot) }
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener as Listener) }, { modules: modules as never, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  return async (channel, input) => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: APP_URL }, sender: { id: 1, once: () => undefined } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

describe('autopilot.start with a queue and autopilot.queue', () => {
  it('epics with tickets is refused and starts nothing; epics alone start the queue; the old input starts one Epic', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    const h = harness()
    const invoke = await ipcOver(() => h.autopilot)
    const refused = await invoke('autopilot.start', { projectId: PROJECT, epic: 'alpha', epics: ['alpha', 'beta'], tickets: [1] })
    expect(refused).toMatchObject({ ok: false })
    expect((refused as { error: string }).error).toContain(QUEUE_TICKETS_MESSAGE)
    expect(h.autopilot.running(PROJECT)).toBe(false)
    expect(readdirSync(h.env.WORFY_DATA_DIR)).not.toContain('autopilot')
    // More than MAX_QUEUE_EPICS, or none, is outside the contract.
    const many = Array.from({ length: MAX_QUEUE_EPICS + 1 }, (_, index) => `e${index}`)
    for (const epics of [[], many]) expect((await invoke('autopilot.start', { projectId: PROJECT, epic: 'alpha', epics })).ok).toBe(false)

    const started = await invoke('autopilot.start', { projectId: PROJECT, epic: 'alpha', epics: ['alpha', 'beta'] })
    expect(started).toMatchObject({ ok: true, value: { epic: 'alpha', queue: [{ epic: 'alpha' }, { epic: 'beta' }] } })
    await h.stopped()
    expect((await h.journal())[0]).toMatchObject({ kind: 'run-started', epics: ['alpha', 'beta'] })
  })

  it('autopilot.queue adds and removes an Epic of the queue of the run and answers its state; without a run it is refused', async () => {
    writeEpic('alpha')
    writeEpic('beta')
    writeEpic('gamma')
    let h: ReturnType<typeof harness> | null = null
    let invoke: Awaited<ReturnType<typeof ipcOver>> | null = null
    const answers: Promise<IpcResult<unknown>>[] = []
    h = harness({
      onWave: (epic) => {
        if (epic !== 'alpha') return
        answers.push(invoke!('autopilot.queue', { projectId: PROJECT, add: 'gamma' }), invoke!('autopilot.queue', { projectId: PROJECT, remove: 'beta' }))
      },
    })
    invoke = await ipcOver(() => h!.autopilot)
    expect(await invoke('autopilot.queue', { projectId: PROJECT, add: 'gamma' })).toEqual({ ok: false, error: expect.stringContaining(NO_RUN_MESSAGE) })
    expect((await invoke('autopilot.queue', { projectId: PROJECT, add: '' })).ok).toBe(false)
    await h.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await h.stopped()
    expect(await Promise.all(answers)).toMatchObject([
      { ok: true, value: { epic: 'alpha' } },
      { ok: true, value: { epic: 'alpha' } },
    ])
    // Both reached the run: gamma joined the queue at the Wave's end, and beta left it without a Wave.
    expect((await h.story()).filter(([kind]) => kind === 'queue-changed' || kind.startsWith('epic-'))).toEqual([
      ['queue-changed', 'alpha', { added: ['gamma'], removed: ['beta'] }],
      ['epic-finished', 'beta', 'removed'],
      ['epic-finished', 'alpha', 'done'],
      ['epic-started', 'gamma', '2/2'],
    ])
  })
})

// ── the queue over stand-ins ─────────────────────────────────────────────────

const SESSION = 'orch-session'

const t = (epic: string, num: number, state: Ticket['state'] = 'open', extra: Partial<Ticket> = {}): Ticket => ({
  epic,
  num,
  slug: `slug-${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
  files: [`src/${epic}-${num}.ts`],
  filesListed: true,
  fromBranch: null,
  ...extra,
})

interface StandOptions {
  /** Epics of the Project, each with 01 open: one Wave each. */
  epics?: string[]
  /** The Wave's turn waits for finish() instead of ending by itself. */
  hold?: boolean
  overrides?: Partial<AutopilotDeps>
}

function stand(options: StandOptions = {}) {
  const sinks = new Set<(sessionId: string, event: AgentEvent) => void>()
  const emit = (event: AgentEvent): void => {
    for (const sink of [...sinks]) sink(SESSION, event)
  }
  const epics = options.epics ?? ['alpha', 'beta', 'gamma']
  const out = {
    tickets: epics.map((epic) => t(epic, 1)),
    /** The journal lines with the Epic each was written for. */
    lines: [] as { fields: JournalEventFields; epic: string | undefined }[],
    starts: [] as RunStart[],
    waves: [] as { epic: string; nums: number[]; resume: readonly number[] }[],
    state: 'idle' as SessionState,
    busy: null as OrchestratorBusy | null,
    /** Reads of the workflow left before every later one fails; null: none fails. */
    readsLeft: null as number | null,
    /** Ends the turn of a held Wave. */
    finish: (): void => undefined,
    emit,
  }
  const end = (): void => {
    out.state = 'idle'
    emit({ type: 'result', isError: false, interrupted: false, subtype: 'success', text: 'done', error: null, costUsd: 0, durationMs: 1, numTurns: 1 } as unknown as AgentEvent)
  }
  const session: RunSession = {
    id: SESSION,
    get state() {
      return out.state
    },
    queued: () => ({ items: [], paused: false }),
    removeQueued: () => false,
    backgroundTasks: () => [],
    halt: () => Promise.resolve(),
    send: () => 'sent',
  }
  const model = (): WorkflowModel =>
    ({ root: '/repo', epics: epics.map((epic) => ({ epic, hasSpec: true, hasMap: false })), tickets: out.tickets.map((each) => ({ ...each })), error: null, branchErrors: [] }) as unknown as WorkflowModel
  const deps: AutopilotDeps = {
    projectRoot: () => '/repo',
    selfRefusal: () => Promise.resolve(null),
    workflow: () => {
      if (out.readsLeft !== null) {
        if (out.readsLeft === 0) return Promise.resolve({ ...model(), error: { code: 'failed', message: 'the disk is gone' } } as WorkflowModel)
        out.readsLeft -= 1
      }
      return Promise.resolve(model())
    },
    watchWorkflow: () => Promise.resolve(() => undefined),
    orchestrators: {
      setUnattended: () => Promise.resolve({ sessionId: SESSION } as OrchestratorView),
      giveBackNow: () => Promise.resolve({ sessionId: 'attended' } as OrchestratorView),
      newUnattendedSession: () => Promise.resolve(null),
      busy: () => out.busy,
    },
    registry: {
      get: () => session,
      observe: (sink) => {
        sinks.add(sink)
        return () => sinks.delete(sink)
      },
      observeInput: () => () => undefined,
    },
    waves: {
      autopilotWave: (_projectId, epic, resume, _brief, named): Promise<AutopilotWaveResult> => {
        const nums = readyWave(out.tickets, epic, named).ready.map((entry) => entry.num)
        out.waves.push({ epic, nums, resume })
        const text = `/wave ${epic} ${nums.join(' ')}`
        out.state = 'busy'
        emit({ type: 'prompt', text })
        out.tickets = out.tickets.map((each) => (each.epic === epic && nums.includes(each.num) ? { ...each, state: 'done' as const } : each))
        if (options.hold === true) out.finish = end
        else setTimeout(end, 0)
        return Promise.resolve({ sessionId: SESSION, text, delivery: 'sent', tickets: nums, skipped: [] })
      },
      autopilotRefusal: () => null,
    },
    journal: (start) => {
      out.starts.push(start)
      return Promise.resolve({
        run: '2026-11-06T01-02-03-004Z-a1b2c3',
        append: (fields, epic) => {
          out.lines.push({ fields, epic })
          return Promise.resolve()
        },
      })
    },
    harness: () => 'plugin',
    keepAwake: () => ({ start: () => undefined, stop: () => undefined }),
    settleMs: 60_000,
    ...options.overrides,
  }
  const autopilot = new Autopilot(deps)
  autopilots.push(autopilot)
  const stopped = () => until(() => autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
  /** The journal as `kind epic said`, ticket-status left out. */
  const said = () =>
    out.lines
      .filter(({ fields }) => fields.kind !== 'ticket-status')
      .map(({ fields, epic }) => {
        const what =
          fields.kind === 'epic-started'
            ? `${fields.index}/${fields.of}`
            : fields.kind === 'epic-finished'
              ? fields.outcome
              : fields.kind === 'queue-changed'
                ? JSON.stringify(fields)
                : fields.kind === 'run-stopped'
                  ? fields.reason
                  : null
        return what === null ? `${fields.kind} ${epic}` : `${fields.kind} ${epic} ${what}`
      })
  return { autopilot, deps, out, stopped, said }
}

describe('startQueue: the queue a start names', () => {
  it('the Epic alone without epics; epics in order without repeats; one Epic may name Tickets', () => {
    expect(startQueue('a', undefined, undefined)).toEqual(['a'])
    expect(startQueue('a', ['a', 'b', 'a', 'c', 'b'], undefined)).toEqual(['a', 'b', 'c'])
    expect(startQueue('a', ['a'], [1])).toEqual(['a'])
    expect(startQueue('a', undefined, [1])).toEqual(['a'])
    // MAX_QUEUE_EPICS fit, with a repeat beyond them too.
    const full = Array.from({ length: MAX_QUEUE_EPICS }, (_, index) => `e${index}`)
    expect(startQueue('e0', [...full, 'e0'], undefined)).toEqual(full)
  })

  it('refuses an empty queue, one past MAX_QUEUE_EPICS, one that does not begin with the Epic, and Tickets with more than one Epic', () => {
    expect(() => startQueue('a', [], undefined)).toThrow(QUEUE_SIZE_MESSAGE)
    expect(() => startQueue('e0', Array.from({ length: MAX_QUEUE_EPICS + 1 }, (_, index) => `e${index}`), undefined)).toThrow(QUEUE_SIZE_MESSAGE)
    expect(() => startQueue('a', ['b', 'a'], undefined)).toThrow(queueFirstMessage('a', 'b'))
    expect(queueFirstMessage('a', 'b')).toBe('The queue begins with Epic b, not with Epic a')
    expect(() => startQueue('a', ['a', 'b'], [1])).toThrow(QUEUE_TICKETS_MESSAGE)
  })
})

describe('the queue of a run over stand-ins', () => {
  it('a start whose queue names an Epic the Project has not is refused, and so is startCheck; nothing is journaled', async () => {
    const s = stand()
    await expect(s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'delta'] })).rejects.toThrow('The Project has no Epic delta')
    expect(await s.autopilot.startCheck(PROJECT, 'alpha', { epics: ['alpha', 'delta'] })).toBe('The Project has no Epic delta')
    expect(await s.autopilot.startCheck(PROJECT, 'alpha', { epics: ['alpha', 'beta'], tickets: [1] })).toBe(QUEUE_TICKETS_MESSAGE)
    expect(await s.autopilot.startCheck(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })).toBeNull()
    await expect(s.autopilot.start(PROJECT, 'alpha', { epics: ['beta'] })).rejects.toThrow(queueFirstMessage('alpha', 'beta'))
    expect(s.out.starts).toEqual([])
    expect(s.autopilot.running(PROJECT)).toBe(false)
  })

  it('an Epic of the queue running in another Project of this Machine refuses the start, by its name', async () => {
    const s = stand({ hold: true, overrides: { origin: () => Promise.resolve(ORIGIN) } })
    await s.autopilot.start('other-00000001', 'beta')
    await until(() => s.out.waves.length === 1, 'the other Project\'s Wave')
    const refused = await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(RunningElsewhere)
    expect(refused).toMatchObject({ epic: 'beta', machine: 'this Machine (Project other-00000001)' })
    expect(await s.autopilot.startCheck(PROJECT, 'alpha', { epics: ['alpha', 'gamma'] })).toBeNull()
  })

  it('"Start anyway" of a queue whose second Epic runs in another Project: the Run goes through both Epics, run-started with override, no epic-finished elsewhere (ticket 21)', async () => {
    const OTHER = 'other-00000001'
    const s = stand({ overrides: { origin: () => Promise.resolve(ORIGIN) } })
    // The other Project's run of beta waits for its busy Orchestrator the whole test: it sends no Wave.
    s.deps.orchestrators.busy = (projectId) => (projectId === OTHER ? { turn: true, queued: 0, tasks: [] } : null)
    expect(await s.autopilot.start(OTHER, 'beta')).toMatchObject({ waitingFor: 'orchestrator' })
    const refused = await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(RunningElsewhere)
    expect(refused).toMatchObject({ epic: 'beta', machine: `this Machine (Project ${OTHER})` })
    expect(s.autopilot.running(PROJECT)).toBe(false)

    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'], override: true })
    await s.stopped()
    expect(s.out.waves.map((wave) => wave.epic)).toEqual(['alpha', 'beta'])
    const lines = s.out.lines.map(({ fields }) => fields)
    // run-started of each run is its journal's start; the other Project's comes first.
    expect(s.out.starts.at(-1)).toMatchObject({ project: PROJECT, epic: 'alpha', epics: ['alpha', 'beta'], override: true })
    expect(lines.filter((fields) => fields.kind === 'epic-finished')).toEqual([{ kind: 'epic-finished', outcome: 'done' }])
    expect(s.said().filter((line) => line.startsWith('epic-') || line.startsWith('run-stopped'))).toEqual(['epic-finished alpha done', 'epic-started beta 2/2', 'run-stopped beta no-ready-wave'])
    expect(s.autopilot.state(OTHER)).toMatchObject({ epic: 'beta', waitingFor: 'orchestrator' })
  })

  it('the forecast counts the Waves of every Epic of the queue', async () => {
    const s = stand({ hold: true, overrides: { budget: { settings: () => ({ enabled: false, reserve: 0.1 }), runs: () => Promise.resolve([]) } } })
    s.out.tickets.push(t('beta', 2, 'open', { blockedRaw: '01', blockedNums: [1] }))
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    const forecast = s.out.lines.find(({ fields }) => fields.kind === 'forecast')?.fields
    // alpha: one Wave of one Ticket; beta: two Waves of one Ticket each.
    expect(forecast).toMatchObject({ waves: 3, tickets: 3 })
    expect(s.out.starts).toEqual([expect.objectContaining({ epic: 'alpha', epics: ['alpha', 'beta'] })])
  })

  it('while the run waits for its Orchestrator an edit applies at once; the run then takes the queue as changed', async () => {
    const s = stand()
    s.out.busy = { turn: true, queued: 0, tasks: [] }
    const waiting = await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    expect(waiting).toMatchObject({ waitingFor: 'orchestrator', queue: [{ epic: 'alpha' }, { epic: 'beta' }] })
    const added = await s.autopilot.editQueue(PROJECT, { add: 'gamma' })
    expect(added.queue).toEqual([
      { epic: 'alpha', status: 'running' },
      { epic: 'beta', status: 'next' },
      { epic: 'gamma', status: 'next' },
    ])
    const removed = await s.autopilot.editQueue(PROJECT, { remove: 'beta' })
    expect(removed.queue?.map((each) => each.epic)).toEqual(['alpha', 'gamma'])
    expect(s.said()).toEqual([
      'orchestrator-busy alpha',
      'queue-changed alpha {"kind":"queue-changed","added":["gamma"]}',
      'queue-changed alpha {"kind":"queue-changed","removed":["beta"]}',
      'epic-finished beta removed',
    ])
    s.out.busy = null
    s.out.emit({ type: 'state', state: 'idle' } as AgentEvent)
    await s.stopped()
    expect(s.out.waves.map((wave) => wave.epic)).toEqual(['alpha', 'gamma'])
    expect(s.said().slice(4)).toEqual([
      'orchestrator-free alpha',
      'wave-started alpha',
      'wave-finished alpha',
      'epic-finished alpha done',
      'epic-started gamma 2/2',
      'wave-started gamma',
      'wave-finished gamma',
      'run-stopped gamma no-ready-wave',
    ])
  })

  it('editQueue refusals: no run, nothing named, an Epic queued already or unknown, the queue full, an Epic absent, running or finished', async () => {
    const epics = Array.from({ length: MAX_QUEUE_EPICS + 1 }, (_, index) => `e${index}`)
    const s = stand({ epics, hold: true })
    await expect(s.autopilot.editQueue(PROJECT, { add: 'e1' })).rejects.toThrow(NO_RUN_MESSAGE)
    await s.autopilot.start(PROJECT, 'e0', { epics: ['e0', 'e1'] })
    await until(() => s.out.waves.length === 1, 'the first Wave')
    const refusal = (edit: { add?: string; remove?: string }) => s.autopilot.editQueue(PROJECT, edit).then(
      () => null,
      (error: unknown) => (error as Error).message,
    )
    expect(await refusal({})).toBe(NO_EDIT_MESSAGE)
    expect(await refusal({ add: 'e1' })).toBe(queueRefusals.queued('e1'))
    expect(await refusal({ add: 'e0' })).toBe(queueRefusals.queued('e0'))
    expect(await refusal({ add: 'delta' })).toBe('The Project has no Epic delta')
    expect(await refusal({ remove: 'e5' })).toBe(queueRefusals.absent('e5'))
    expect(await refusal({ remove: 'e0' })).toBe(queueRefusals.running('e0'))
    // A refused part refuses the whole edit: the add of e2 does not wait either.
    expect(await refusal({ add: 'e2', remove: 'e0' })).toBe(queueRefusals.running('e0'))
    // The adds waiting for the Wave's end count: two in the queue, eight to come, the eleventh refused.
    for (const epic of epics.slice(2, MAX_QUEUE_EPICS)) expect(await refusal({ add: epic })).toBeNull()
    expect(await refusal({ add: 'e2' })).toBe(queueRefusals.queued('e2'))
    expect(await refusal({ add: epics[MAX_QUEUE_EPICS]! })).toBe(queueRefusals.full())
    expect(queueRefusals.full()).toBe(`The queue holds ${MAX_QUEUE_EPICS} Epics at most`)
    // Nothing applied during the Wave.
    expect(s.said().filter((line) => line.startsWith('queue-changed'))).toEqual([])
    s.out.finish()
    await until(() => s.out.waves.length === 2, 'the second Epic\'s Wave')
    expect(await refusal({ remove: 'e0' })).toBe(queueRefusals.finished('e0'))
    expect(s.said().filter((line) => line.startsWith('queue-changed'))).toEqual([`queue-changed e0 ${JSON.stringify({ kind: 'queue-changed', added: epics.slice(2, MAX_QUEUE_EPICS) })}`])
    await s.autopilot.forceStop(PROJECT)
    await expect(s.autopilot.editQueue(PROJECT, { add: 'e1' })).rejects.toThrow(NO_RUN_MESSAGE)
  })

  it('an Epic passed as elsewhere counts as finished: it cannot be removed', async () => {
    let busy = false
    const s = stand({
      hold: true,
      overrides: { origin: () => Promise.resolve(ORIGIN), linkedRuns: () => Promise.resolve([{ machine: 'Studio', runs: busy ? [{ epic: 'beta', origin: ORIGIN }] : [] }]) },
    })
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta', 'gamma'] })
    await until(() => s.out.waves.length === 1, 'the first Wave')
    busy = true
    s.out.finish()
    await until(() => s.out.waves.length === 2, 'gamma\'s Wave')
    await expect(s.autopilot.editQueue(PROJECT, { remove: 'beta' })).rejects.toThrow(queueRefusals.finished('beta'))
    expect(s.autopilot.state(PROJECT).queue?.map((each) => each.status)).toEqual(['done', 'elsewhere', 'running'])
  })

  it('an add that waits for the Wave\'s end is taken back by a remove of it: nothing is journaled', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha')
    await until(() => s.out.waves.length === 1, 'the first Wave')
    await s.autopilot.editQueue(PROJECT, { add: 'beta' })
    await s.autopilot.editQueue(PROJECT, { remove: 'beta' })
    s.out.finish()
    await s.stopped()
    expect(s.said()).toEqual(['wave-started alpha', 'wave-finished alpha', 'run-stopped alpha no-ready-wave'])
    expect(s.out.starts[0]).not.toHaveProperty('epics')
  })

  it('an Epic added to a run of one Epic makes it a queue: queue-changed and epic-started 2/2 after the Wave; an add taken back is not in it', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha')
    await until(() => s.out.waves.length === 1, 'the first Wave')
    await s.autopilot.editQueue(PROJECT, { add: 'beta' })
    // beta's add still waits: removing it takes it back, and gamma goes in its place.
    await s.autopilot.editQueue(PROJECT, { add: 'gamma', remove: 'beta' })
    s.out.finish()
    await until(() => s.out.waves.length === 2, 'the next Epic\'s Wave')
    s.out.finish()
    await s.stopped()
    expect(s.said()).toEqual([
      'wave-started alpha',
      'wave-finished alpha',
      'queue-changed alpha {"kind":"queue-changed","added":["gamma"]}',
      'epic-finished alpha done',
      'epic-started gamma 2/2',
      'wave-started gamma',
      'wave-finished gamma',
      'run-stopped gamma no-ready-wave',
    ])
  })

  it('an Epic removed twice during a Wave is removed once', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await until(() => s.out.waves.length === 1, 'the first Wave')
    await s.autopilot.editQueue(PROJECT, { remove: 'beta' })
    await s.autopilot.editQueue(PROJECT, { remove: 'beta' })
    s.out.finish()
    await s.stopped()
    expect(s.said()).toEqual(['wave-started alpha', 'wave-finished alpha', 'queue-changed alpha {"kind":"queue-changed","removed":["beta"]}', 'epic-finished beta removed', 'run-stopped alpha no-ready-wave'])
    expect(s.autopilot.state(PROJECT).queue).toEqual([{ epic: 'alpha', status: 'running' }])
  })

  it('a run over named Tickets takes no other Epic', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha', { tickets: [1] })
    await until(() => s.out.waves.length === 1, 'the first Wave')
    await expect(s.autopilot.editQueue(PROJECT, { add: 'beta' })).rejects.toThrow(NAMED_QUEUE_MESSAGE)
  })

  it('an edit that cannot read the workflow is refused with the reason', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha')
    await until(() => s.out.waves.length === 1, 'the first Wave')
    s.out.readsLeft = 0
    await expect(s.autopilot.editQueue(PROJECT, { add: 'beta' })).rejects.toThrow('Cannot read the workflow: the disk is gone')
    s.deps.workflow = () => Promise.reject(new Error('EIO'))
    await expect(s.autopilot.editQueue(PROJECT, { add: 'beta' })).rejects.toThrow('Cannot read the workflow: EIO')
  })

  it('a Stop during the first Epic\'s Wave ends the Run there: the next Epic is not begun, and the queue no longer changes', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await until(() => s.out.waves.length === 1, 'the first Wave')
    await s.autopilot.stop(PROJECT)
    // The run is still on its Wave, but no Epic of its queue begins any more: an edit is refused.
    expect(s.autopilot.state(PROJECT).status).toBe('running')
    await expect(s.autopilot.editQueue(PROJECT, { add: 'gamma' })).rejects.toThrow(STOPPING_MESSAGE)
    await expect(s.autopilot.editQueue(PROJECT, { remove: 'beta' })).rejects.toThrow(STOPPING_MESSAGE)
    s.out.finish()
    await s.stopped()
    expect(s.out.waves.map((wave) => wave.epic)).toEqual(['alpha'])
    expect(s.said().filter((line) => line.startsWith('epic-'))).toEqual([])
    expect(s.autopilot.state(PROJECT)).toMatchObject({ reason: 'user-stop', epic: 'alpha' })
  })

  it('a Stop clicked while the next Epic is asked about elsewhere: that Epic is not begun', async () => {
    let s: ReturnType<typeof stand> | null = null
    let calls = 0
    s = stand({
      overrides: {
        origin: () => Promise.resolve(ORIGIN),
        linkedRuns: () => {
          calls += 1
          // The second question is the one at beta: the Stop comes while it is asked.
          if (calls === 2) void s!.autopilot.stop(PROJECT)
          return Promise.resolve([])
        },
      },
    })
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await s.stopped()
    expect(s.out.waves.map((wave) => wave.epic)).toEqual(['alpha'])
    expect(s.said().slice(-2)).toEqual(['epic-finished alpha done', 'run-stopped alpha no-ready-wave'])
  })

  it('the workflow cannot be read when the Epic\'s cycle stops: the Run stops with its reason, the next Epic is not begun', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await until(() => s.out.waves.length === 1, 'the first Wave')
    // The read after the turn goes; the rule's read fails.
    s.out.readsLeft = 1
    s.out.finish()
    await s.stopped()
    expect(s.out.waves.map((wave) => wave.epic)).toEqual(['alpha'])
    expect(s.said()).toEqual(['wave-started alpha', 'wave-finished alpha', 'run-stopped alpha no-ready-wave'])
  })

  it('the Vendor is asked before the first Wave of a later Epic, as before every Wave after the run\'s first', async () => {
    let asked = 0
    const s = stand()
    s.deps.orchestrators.unattendedRefusal = () => {
      asked += 1
      // The first answer is the start's own check.
      return Promise.resolve(asked === 1 ? null : 'The hooks of the Harness are not approved')
    }
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await s.stopped()
    expect(asked).toBe(2)
    expect(s.out.waves.map((wave) => wave.epic)).toEqual(['alpha'])
    expect(s.autopilot.state(PROJECT)).toMatchObject({ reason: 'session-error', epic: 'beta', message: 'The hooks of the Harness are not approved' })
  })

  it('the Tickets a Force stop left of the first Epic go only with its first Wave, never with a later Epic\'s', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha')
    await until(() => s.out.waves.length === 1, 'the first Wave')
    await s.autopilot.forceStop(PROJECT)
    expect(s.autopilot.state(PROJECT).resumable).toEqual([1])
    s.out.state = 'idle'
    // alpha's Ticket is done by now: its Epic has nothing ready, and the run goes on to beta at once.
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await until(() => s.out.waves.length === 2, 'beta\'s Wave')
    expect(s.out.waves).toEqual([
      { epic: 'alpha', nums: [1], resume: [] },
      { epic: 'beta', nums: [1], resume: [] },
    ])
    expect(s.said().slice(-3)).toEqual(['epic-finished alpha done', 'epic-started beta 2/2', 'wave-started beta'])
  })

  it('a later Epic that sends no Wave leaves resumable nothing of the Tickets the first Epic was given', async () => {
    const s = stand({ hold: true })
    await s.autopilot.start(PROJECT, 'alpha')
    await until(() => s.out.waves.length === 1, 'the first Wave')
    await s.autopilot.forceStop(PROJECT)
    expect(s.autopilot.state(PROJECT).resumable).toEqual([1])
    s.out.state = 'idle'
    // beta has no ready Wave: its only Ticket is blocked, and not by the owner.
    s.out.tickets = s.out.tickets.map((each) => (each.epic === 'beta' ? { ...each, state: 'blocked' as const, statusRaw: 'blocked', blockedRaw: '07', blockedNums: [7] } : each))
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await s.stopped()
    expect(s.out.waves.map((wave) => wave.epic)).toEqual(['alpha'])
    expect(s.said().slice(-3)).toEqual(['epic-finished alpha done', 'epic-started beta 2/2', 'run-stopped beta no-ready-wave'])
    // alpha's Ticket 01 was given to alpha, not to beta: beta's 01 is another Ticket, not resumable.
    expect(s.autopilot.state(PROJECT)).toMatchObject({ epic: 'beta', wave: 0, resumable: [] })
  })

  it('Auto-approval follows the Epic of each Wave: the policy opens once, and the second Epic\'s Wave sets its roots with that Epic', async () => {
    const opened: string[] = []
    const set: [string[], string | undefined][] = []
    const approval = {
      run: 'r',
      runTemp: '/tmp/worfy-run',
      environment: {},
      facts: {},
      setWave: (tickets: readonly string[], epic?: string) => void set.push([[...tickets], epic]),
      judge: () => Promise.resolve({ outcome: 'deny', rule: 'not-judged', hint: null, targets: [] }),
      close: () => Promise.resolve(),
    } as unknown as RunApproval
    const s = stand({
      overrides: {
        approval: {
          mode: () => 'on',
          open: (_projectId, _root, epic) => {
            opened.push(epic)
            return Promise.resolve(approval)
          },
        },
      },
    })
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await s.stopped()
    expect(opened).toEqual(['alpha'])
    expect(set).toEqual([
      [['01'], 'alpha'],
      [['01'], 'beta'],
    ])
  })

  it('the Tickets and PRs of a Wave are each Epic\'s own: same numbers in two Epics are counted and journaled for both', async () => {
    const asked: string[][] = []
    const s = stand({
      epics: ['alpha', 'beta'],
      overrides: {
        prs: {
          read: (_root, branches) => {
            asked.push([...branches])
            const pulls = branches.map((branch, at) => ({ number: at + 1, url: `https://example.com/${branch}`, state: 'OPEN' as const, branch, ci: null, verdict: null, narrow: [{ outcome: 'verified' as const, text: 'NARROW: VERIFIED', at: null }] }))
            return Promise.resolve({ pulls })
          },
        },
      },
    })
    // alpha: 01 and 02 in one Wave. beta: 01 in its Wave; its 02 was done before the run.
    s.out.tickets = [t('alpha', 1), t('alpha', 2), t('beta', 1), t('beta', 2, 'done')]
    await s.autopilot.start(PROJECT, 'alpha', { epics: ['alpha', 'beta'] })
    await s.stopped()
    expect(s.out.waves.map(({ epic, nums }) => [epic, nums])).toEqual([
      ['alpha', [1, 2]],
      ['beta', [1]],
    ])
    // beta's 02 is not a Ticket of the run's Waves: two of alpha and one of beta are done.
    expect(s.autopilot.state(PROJECT).ended).toMatchObject({ done: 3, blocked: 0 })
    // The last read of each Epic asks the branches of its own Wave only.
    expect(asked.at(-1)).toEqual(['beta/01'])
    // The narrow round of beta's 01 is journaled, though alpha's 01 had the same state.
    expect(s.out.lines.filter(({ fields }) => fields.kind === 'narrow-round').map(({ fields, epic }) => `${epic} ${(fields as { ticket: string }).ticket}`)).toEqual(['alpha 01', 'alpha 02', 'beta 01'])
  })
})
