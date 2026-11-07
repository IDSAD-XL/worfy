// A run accepted while the Orchestrator is busy waits for it (worfy-autopilot-queue ticket 07): the
// real Session registry, Orchestrators, launcher, run journal and cycle on the fake agent, over a copy
// of an Epic in a temporary folder, set up as test/contract/autopilot-background.test.ts does. The
// person's Orchestrator plays test/fixtures/agent-scripts/autopilot-wait-person.jsonl (a turn that
// holds until the test releases `turn`) or autopilot-wait-tasks.jsonl (a turn that starts two
// background tasks, then more held turns, then the tasks end on releases of `tasks`); the run's
// unattended Orchestrator plays autopilot-waves.jsonl. keep-awake is a fake; the grace time after the
// last task runs on a manual clock.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import type { LaunchApproval, RunApproval } from '../../src/main/agent/auto-approve/run-approval'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { LayoutStore } from '../../src/main/layout/store'
import { Autopilot, runningElsewhere, type LinkedRuns } from '../../src/main/autopilot/run'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { emptyLimits } from '../../src/shared/agent/limits'
import { makeRunId, type JournalEvent } from '../../src/shared/autopilot/journal'
import { autopilotStateSchema, autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const PROJECT = 'demo-000000b7'
const EPIC = 'demo'
const ORIGIN = 'github.com/example/demo'
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
/** The grace time after the last background task of the busy Orchestrator, on the manual clock. */
const GRACE_MS = 120_000

let scratch: string
let repo: string
let scriptsDir: string
let registries: SessionRegistry[] = []
let autopilots: Autopilot[] = []

const TICKETS = [
  { num: 1, blocked: '—' },
  { num: 2, blocked: '—' },
  { num: 3, blocked: '01, 02' },
]
const nn = (num: number): string => String(num).padStart(2, '0')

function writeTicket(num: number, status: string): void {
  const { blocked } = TICKETS.find((each) => each.num === num)!
  const content = [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, ''].join('\n')
  writeFileSync(join(repo, '.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`), content)
}

/** `epic-status --json` over the Epic's files, as the real script reads these simple Tickets. */
const runner: EpicStatusRunner = (cwd) => {
  const dir = join(cwd, '.scratch', EPIC, 'issues')
  const tickets = readdirSync(dir).map((name) => {
    const text = readFileSync(join(dir, name), 'utf8')
    const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text)?.[1] ?? null
    const status = field('Status')
    const blocked = field('Blocked by')
    const word = (status ?? '').split(/\s/)[0] ?? ''
    const state = /^done$/i.test(word) ? 'done' : /^claimed$/i.test(word) ? 'work' : 'open'
    const nums = blocked && blocked !== '—' ? blocked.split(',').map((each) => Number(each.trim())) : []
    const match = /^(\d+)-(.*)\.md$/.exec(name)!
    return { epic: EPIC, num: Number(match[1]), slug: match[2], title: text.split('\n')[0]!.replace(/^#\s*/, ''), statusRaw: status, state, blockedRaw: blocked, blockedNums: nums, blockedParsed: true }
  })
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets }))
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autopilot-wait-')))
  repo = join(scratch, 'repo')
  scriptsDir = join(scratch, 'scripts')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  mkdirSync(scriptsDir, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  for (const { num } of TICKETS) writeTicket(num, 'open')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  for (const name of ['autopilot-waves', 'autopilot-wait-person', 'autopilot-wait-tasks']) writeFileSync(join(scriptsDir, `${name}.jsonl`), readFileSync(join(fixtures, `${name}.jsonl`), 'utf8'))
})

afterEach(async () => {
  for (const autopilot of autopilots) await autopilot.stopAll()
  autopilots = []
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 5000): Promise<void> {
  const wait = ms(limit)
  const end = Date.now() + wait
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

/** A clock the test moves by hand: it keeps the timers the run sets and fires them when told. */
class ManualClock {
  private next = 1
  readonly timers = new Map<number, { fn: () => void; ms: number }>()
  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.next++
    this.timers.set(id, { fn, ms })
    return id
  }
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }
  pending(): number[] {
    return [...this.timers.values()].map((timer) => timer.ms)
  }
  fire(ms: number): void {
    for (const [id, timer] of [...this.timers]) {
      if (timer.ms !== ms) continue
      this.timers.delete(id)
      timer.fn()
    }
  }
}

/** How long Start now waits for the interrupted turn: the fake agent's wait_release does not end on interrupt(). */
const HALT_MS = 100

interface HarnessOptions {
  /** The script of the person's (attended) Orchestrator. */
  attended?: 'autopilot-wait-person' | 'autopilot-wait-tasks' | 'autopilot-wait-late'
  /** What the Linked machines answer when a start asks them; the test may change it meanwhile. */
  linked?: LinkedRuns[]
  /** A run in the Run mode Start window, over this window, with the Limits' clock at `now()`. */
  window?: { from: number; to: number; now: () => number }
  /** The script of the run's unattended Orchestrator. */
  unattended?: 'autopilot-waves' | 'autopilot-waves-held'
  /** Auto-approval On: each run opens a fake policy (fakeApproval), and its folder is the Session's TMPDIR. */
  approval?: boolean
}

interface FakeApproval {
  run: string
  runTemp: string
  closed: boolean
}

/** A run's policy that judges nothing and tells when its folder goes, as in test/contract/autopilot-background.test.ts. */
function fakeApproval(approvals: FakeApproval[]): RunApproval {
  const run = makeRunId(new Date(), (approvals.length + 1).toString(16).padStart(6, '0'))
  const entry: FakeApproval = { run, runTemp: join(scratch, 'run-temp', run), closed: false }
  approvals.push(entry)
  return {
    run,
    runTemp: entry.runTemp,
    environment: { TMPDIR: entry.runTemp },
    facts: { hooksPath: null, hooksActive: false, rebaseUpdateRefs: false, remotes: [], defaultBranch: 'main', configFiles: [], checkoutConfig: false, commonDir: null },
    setWave: () => undefined,
    judge: () => Promise.resolve({ outcome: 'deny', rule: 'not-judged', hint: null, targets: [] }),
    close: () => {
      entry.closed = true
      return Promise.resolve()
    },
  }
}

function harness(options: HarnessOptions = {}) {
  const env = { WORFY_DATA_DIR: join(scratch, 'data-root') }
  const calls: (FakeCall & { unattended: boolean })[] = []
  const requests: QueryRequest[] = []
  const releases = new FakeReleases()
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    const unattended = request.unattended === true
    return fakeQueryFactory({
      scriptsDir,
      script: unattended ? (options.unattended ?? 'autopilot-waves') : (options.attended ?? 'autopilot-wait-person'),
      record: (call) => calls.push({ ...call, unattended }),
      releases,
    })(request)
  })
  registries.push(registry)
  /** The Orchestrators' answers as the main process sees them. */
  const texts: string[] = []
  registry.observe((_sessionId, event) => {
    if (event.type === 'text') texts.push(event.text)
  })
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
  const power: string[] = []
  const states: AutopilotState[] = []
  const clock = new ManualClock()
  const linked = options.linked
  const window = options.window
  const approvals: FakeApproval[] = []
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
    tasksClock: clock,
    tasksGraceMs: GRACE_MS,
    haltTurnMs: HALT_MS,
    ...(options.approval === true ? { approval: { mode: () => 'on' as const, open: () => Promise.resolve(fakeApproval(approvals)) } } : {}),
    ...(linked === undefined ? {} : { origin: () => Promise.resolve(ORIGIN), linkedRuns: () => Promise.resolve(linked) }),
    ...(window === undefined
      ? {}
      : {
          runSettings: () => ({ mode: 'start-window' as const, window: { from: window.from, to: window.to } }),
          limits: { state: emptyLimits, observeSession: () => () => undefined, send: (sessionId: string, text: string) => void registry.get(sessionId).send(text), now: window.now, schedule: () => () => undefined },
        }),
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  const journal = async (): Promise<JournalEvent[]> => {
    const dir = join(env.WORFY_DATA_DIR, 'autopilot')
    const runs = readdirSync(dir).map((name) => name.replace(/\.jsonl$/, ''))
    expect(runs).toHaveLength(1)
    return (await readRun(runs[0]!, { env }))!.events
  }
  /** The kinds of the journal's lines, with the reason of run-stopped and tasks-killed. */
  const kinds = async () => (await journal()).map((event) => (event.kind === 'run-stopped' || event.kind === 'tasks-killed' ? `${event.kind} ${event.reason}` : event.kind))
  const session = async () => registry.get((await orchestrators.open(PROJECT)).sessionId ?? '')
  /** The texts of the messages Claude Code got, of the unattended Sessions or of the person's. */
  const messages = (unattended: boolean) => calls.flatMap((call) => (call.kind === 'message' && call.unattended === unattended ? [call.text] : []))
  const state = () => autopilot.state(PROJECT)
  /**
   * Every call of Orchestrators.setUnattended, with the policy the run passed (the same object for every
   * run of the Project). `before` runs once, ahead of the next call that makes the Orchestrator unattended.
   */
  const unattendedCalls: (LaunchApproval | undefined)[] = []
  let before: (() => Promise<void>) | null = null
  const setUnattended = orchestrators.setUnattended.bind(orchestrators)
  vi.spyOn(orchestrators, 'setUnattended').mockImplementation(async (projectId, unattended, approval) => {
    if (unattended) {
      unattendedCalls.push(approval)
      const first = before
      before = null
      await first?.()
    }
    return setUnattended(projectId, unattended, approval)
  })
  const beforeUnattended = (fn: () => Promise<void>): void => {
    before = fn
  }
  return { registry, orchestrators, autopilot, calls, requests, releases, power, states, clock, journal, kinds, session, messages, state, texts, approvals, unattendedCalls, beforeUnattended }
}

/** The person's message starts a turn of the attended Orchestrator that holds until released. */
async function personInTurn(h: ReturnType<typeof harness>, text = 'how is it going?') {
  const session = await h.session()
  await until(() => session.state === 'idle', 'the idle Orchestrator')
  session.send(text)
  await until(() => session.state === 'busy', 'the person\'s turn')
  return session
}

describe('a run accepted while the Orchestrator is busy waits for it (worfy-autopilot-queue ticket 07)', () => {
  it('waits for the person\'s turn: run-started and orchestrator-busy at once, then orchestrator-free and the Wave, sent once', async () => {
    const h = harness()
    await personInTurn(h)
    const first = await h.autopilot.start(PROJECT, EPIC)
    expect(first).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator', busy: { turn: true, queued: 0, tasks: [] }, wave: 0, resumesAt: null })
    expect(autopilotStateSchema.parse(first)).toEqual(first)
    expect(first.waitingSince).toEqual(expect.any(Number))
    expect(await h.kinds()).toEqual(['run-started', 'orchestrator-busy'])
    expect((await h.journal())[1]).toMatchObject({ kind: 'orchestrator-busy', turn: true, queued: 0, tasks: [] })
    // Nothing of the run yet: no unattended Session, keep-awake not held, and a second start is refused.
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(h.power).toEqual([])
    expect(h.autopilot.running(PROJECT)).toBe(true)
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow('Autopilot is already running in this Project (Epic demo): stop it first')

    h.releases.release('turn')
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    expect((await h.kinds()).slice(0, 4)).toEqual(['run-started', 'orchestrator-busy', 'orchestrator-free', 'wave-started'])
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    expect(h.power).toEqual(['start'])
    await until(() => h.messages(true).length === 1, 'the Wave to reach the Orchestrator')
    await new Promise((done) => setTimeout(done, 50))
    expect(h.messages(true)).toEqual([WAVE_1])
    expect(h.messages(false)).toEqual(['how is it going?'])
  })

  it('waits until the queue is empty and the tasks are over; a message of the person during the wait makes it longer', async () => {
    const h = harness({ attended: 'autopilot-wait-tasks' })
    const session = await personInTurn(h, 'start the helpers')
    await until(() => session.backgroundTasks().length === 2, 'the two helpers')
    session.send('first queued')
    session.send('second queued')
    const first = await h.autopilot.start(PROJECT, EPIC)
    expect(first.busy).toEqual({
      turn: true,
      queued: 2,
      tasks: [
        { id: 'task_person_0001', type: 'local_agent', description: 'Look into the flaky test' },
        { id: 'task_person_0002', type: 'local_agent', description: 'Draft the release notes' },
      ],
    })
    expect((await h.journal())[1]).toMatchObject({ kind: 'orchestrator-busy', turn: true, queued: 2 })
    expect(autopilotStatusLine(first)).toMatch(/^waiting for the Orchestrator/)

    // The first turn ends: the next queued message starts the next turn.
    h.releases.release('turn')
    await until(() => h.state().busy?.queued === 1, 'one message left in the queue')
    // The person writes again while the run waits: one more turn to wait for.
    session.send('one more thing')
    await until(() => h.state().busy?.queued === 2, 'the new message in the queue')
    for (let turn = 0; turn < 3; turn += 1) {
      const before = h.messages(false).length
      h.releases.release('turn')
      await until(() => h.messages(false).length === before + 1 || (turn === 2 && session.state === 'idle'), `turn ${turn + 2}`)
    }
    await until(() => session.state === 'idle' && session.queued().items.length === 0, 'the queue to be empty')
    await until(() => h.state().busy?.turn === false && h.state().busy?.queued === 0, 'the wait for the tasks alone')
    // The tasks still run: the run waits, and nothing has started.
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator', busy: { turn: false, queued: 0 } })
    expect(h.state().busy?.tasks).toHaveLength(2)
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(await h.kinds()).not.toContain('orchestrator-free')

    h.releases.release('tasks')
    await until(() => h.state().busy?.tasks.length === 1, 'one helper left')
    h.releases.release('tasks')
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    const busy = (await h.journal()).filter((event) => event.kind === 'orchestrator-busy')
    expect(busy.length).toBeGreaterThanOrEqual(4)
    expect(busy).toContainEqual(expect.objectContaining({ turn: false, queued: 0 }))
    expect(h.messages(false)).toEqual(['start the helpers', 'first queued', 'second queued', 'one more thing'])
    expect(h.messages(true)).toEqual([WAVE_1])
    // The turn the last task's task-notification started ran to its end in the person's Session
    // (the grace time after the last task), and no process closed while a task lived (the fake agent
    // records such a close).
    expect(h.texts).toContain('Both helpers are done.')
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
  })

  it('after the last task the run waits the grace time for its task-notification turn, and goes on without that turn once the time is out', async () => {
    // The last task ends, and its task-notification turn never comes.
    const lines = readFileSync(join(scriptsDir, 'autopilot-wait-tasks.jsonl'), 'utf8').trim().split('\n')
    const lastChange = lines.findLastIndex((line) => line.includes('"background_tasks_changed"'))
    writeFileSync(join(scriptsDir, 'autopilot-wait-late.jsonl'), `${[...lines.slice(0, lastChange + 1), '{"fake":"wait_release","name":"never"}'].join('\n')}\n`)
    const h = harness({ attended: 'autopilot-wait-late' })
    const session = await personInTurn(h, 'start the helpers')
    await until(() => session.backgroundTasks().length === 2, 'the two helpers')
    for (const text of ['first queued', 'second queued', 'third queued']) session.send(text)
    await h.autopilot.start(PROJECT, EPIC)
    for (let turn = 0; turn < 4; turn += 1) h.releases.release('turn')
    await until(() => h.messages(false).length === 4 && session.state === 'idle', 'the person\'s turns to end')
    h.releases.release('tasks')
    h.releases.release('tasks')
    await until(() => h.clock.pending().includes(GRACE_MS), 'the grace time after the last task')
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator', busy: { turn: false, queued: 0, tasks: [] } })
    expect(await h.kinds()).not.toContain('orchestrator-free')
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    h.clock.fire(GRACE_MS)
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
  })

  it('Stop cancels a waiting run: run-stopped start-cancelled; the Session was not started again and its queue is where it was', async () => {
    const h = harness()
    const session = await personInTurn(h)
    session.send('then this')
    await h.autopilot.start(PROJECT, EPIC)
    expect(await h.autopilot.stop(PROJECT)).toMatchObject({ status: 'stopped', reason: 'start-cancelled', wave: 0 })
    expect(await h.kinds()).toEqual(['run-started', 'orchestrator-busy', 'run-stopped start-cancelled'])
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(session.state).toBe('busy')
    expect(session.queued().items.map((item) => item.text)).toEqual(['then this'])
    expect(h.power).toEqual([])
    // The Orchestrator ends its turn later: nothing starts.
    h.releases.release('turn')
    h.releases.release('turn')
    await until(() => h.messages(false).length === 2 && session.state === 'idle', 'the queued message to go to the person\'s Session')
    await new Promise((done) => setTimeout(done, 50))
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(await h.kinds()).toEqual(['run-started', 'orchestrator-busy', 'run-stopped start-cancelled'])
  })

  it('Force stop on a waiting run cancels it the same way: start-cancelled, and the person\'s Orchestrator is not touched', async () => {
    const h = harness()
    const session = await personInTurn(h)
    await h.autopilot.start(PROJECT, EPIC)
    expect(await h.autopilot.forceStop(PROJECT)).toMatchObject({ status: 'stopped', reason: 'start-cancelled', wave: 0 })
    expect(await h.kinds()).toEqual(['run-started', 'orchestrator-busy', 'run-stopped start-cancelled'])
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(session.state).toBe('busy')
    expect(h.power).toEqual([])
  })

  it('Start now on a run that does not wait does nothing: no tasks-killed, no new Session, no second start, keep-awake held once', async () => {
    // The Wave's turn holds until the test releases `wave`: the run is in its Wave when Start now comes.
    const lines = readFileSync(join(scriptsDir, 'autopilot-waves.jsonl'), 'utf8').trim().split('\n')
    writeFileSync(join(scriptsDir, 'autopilot-waves-held.jsonl'), `${[...lines.slice(0, 2), '{"fake":"wait_release","name":"wave"}', ...lines.slice(2)].join('\n')}\n`)
    const h = harness({ unattended: 'autopilot-waves-held' })
    expect(await h.autopilot.start(PROJECT, EPIC)).toMatchObject({ status: 'running' })
    // The run writes `wave-started` only after "Run wave" has gone and its send has come back, a few awaits after the
    // message reached the Session: the journal is read once the line is there, so the Wave is fully started.
    await until(async () => h.messages(true).length === 1 && (await h.session()).state === 'busy' && (await h.kinds()).includes('wave-started'), 'the Wave\'s turn')
    const requests = h.requests.length
    const before = await h.kinds()
    expect(await h.autopilot.startNow(PROJECT)).toMatchObject({ status: 'running' })
    await new Promise((done) => setTimeout(done, 50))
    expect(h.requests).toHaveLength(requests)
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
    expect(await h.kinds()).toEqual(before)
    expect(before).not.toContain('tasks-killed')
    expect(before).not.toContain('orchestrator-free')
    expect(h.messages(true)).toEqual([WAVE_1])
    expect(h.power).toEqual(['start'])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
  })

  it('free, then busy again before the run takes it (a person wrote meanwhile): the run goes on waiting, and starts at the next end', async () => {
    const h = harness({ approval: true })
    const session = await personInTurn(h)
    await h.autopilot.start(PROJECT, EPIC)
    // The person writes again right as the run asks for the Orchestrator.
    h.beforeUnattended(async () => {
      session.send('one more question')
      await until(() => session.state === 'busy', 'the person\'s second turn')
    })
    h.releases.release('turn')
    await until(async () => (await h.kinds()).length === 4, 'the wait to go on')
    expect(await h.kinds()).toEqual(['run-started', 'orchestrator-busy', 'orchestrator-free', 'orchestrator-busy'])
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator', busy: { turn: true } })
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(h.power).toEqual([])
    // Back to waiting, the run's policy no longer judges the Project's unattended Session.
    expect(h.unattendedCalls[0]?.mode()).toBe('off')
    expect(h.unattendedCalls[0]?.environment()).toEqual({})

    h.releases.release('turn')
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    expect((await h.kinds()).slice(0, 6)).toEqual(['run-started', 'orchestrator-busy', 'orchestrator-free', 'orchestrator-busy', 'orchestrator-free', 'wave-started'])
    expect(h.messages(false)).toEqual(['how is it going?', 'one more question'])
    await until(() => h.messages(true).length === 1, 'the Wave to reach the Orchestrator')
    expect(h.messages(true)).toEqual([WAVE_1])
  })

  it('a message that lands between the start\'s read of the Orchestrator and its answer: the run waits instead of being refused', async () => {
    const h = harness({ approval: true })
    const session = await h.session()
    await until(() => session.state === 'idle', 'the idle Orchestrator')
    h.beforeUnattended(async () => {
      session.send('a late question')
      await until(() => session.state === 'busy', 'the person\'s turn')
    })
    expect(await h.autopilot.start(PROJECT, EPIC)).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator', busy: { turn: true } })
    expect(await h.kinds()).toEqual(['run-started', 'orchestrator-busy'])
    expect(h.unattendedCalls[0]?.mode()).toBe('off')
    expect(h.approvals.map((approval) => approval.closed)).toEqual([false])
    h.releases.release('turn')
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    expect((await h.kinds()).slice(0, 4)).toEqual(['run-started', 'orchestrator-busy', 'orchestrator-free', 'wave-started'])
    expect(h.requests.at(-1)).toMatchObject({ unattended: true, environment: { TMPDIR: h.approvals[0]!.runTemp } })
  })

  it('a run that waited starts its Session under its Auto-approval policy, with the run\'s TMPDIR', async () => {
    const h = harness({ approval: true })
    await personInTurn(h)
    await h.autopilot.start(PROJECT, EPIC)
    expect(h.approvals).toHaveLength(1)
    h.releases.release('turn')
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    expect(h.requests.at(-1)?.environment).toEqual({ TMPDIR: h.approvals[0]!.runTemp })
    expect(h.unattendedCalls[0]?.mode()).toBe('on')
    expect((await h.journal())[0]).toMatchObject({ kind: 'run-started', autoApproval: 'on', run: h.approvals[0]!.run })
  })

  it('a waiting run parks nothing: the stopped run\'s Session it waits for gets no park', async () => {
    const h = harness({ approval: true })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.messages(true).length === 1, 'the Wave to reach the Orchestrator')
    const launch = h.unattendedCalls[0]!
    expect(launch.parks?.()).toBe(true)
    await h.autopilot.forceStop(PROJECT)
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    await personInTurn(h)
    expect(await h.autopilot.start(PROJECT, EPIC)).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator' })
    expect(launch.parks?.()).toBe(false)
  })

  it('Start now: tasks-killed start-now with the tasks, the Session unattended at once, the Wave goes; the queued message stays the person\'s', async () => {
    const h = harness({ attended: 'autopilot-wait-tasks' })
    const session = await personInTurn(h, 'start the helpers')
    await until(() => session.backgroundTasks().length === 2, 'the two helpers')
    session.send('look at the logs later')
    await h.autopilot.start(PROJECT, EPIC)
    const started = await h.autopilot.startNow(PROJECT)
    expect(started).toMatchObject({ status: 'running' })
    expect(started.waitingFor).toBeUndefined()
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    const events = await h.journal()
    expect(events.map((event) => event.kind).slice(0, 4)).toEqual(['run-started', 'orchestrator-busy', 'tasks-killed', 'orchestrator-free'])
    expect(events[2]).toMatchObject({
      kind: 'tasks-killed',
      reason: 'start-now',
      tasks: [
        { id: 'task_person_0001', type: 'local_agent', description: 'Look into the flaky test' },
        { id: 'task_person_0002', type: 'local_agent', description: 'Draft the release notes' },
      ],
    })
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    // The person's process was closed with its tasks alive: they died with it.
    expect(h.calls.filter((call) => call.kind === 'close' && !call.unattended).map((call) => (call.kind === 'close' ? call.backgroundTasks : []))).toEqual([['task_person_0001', 'task_person_0002']])
    await until(() => h.messages(true).length === 1, 'the Wave to reach the Orchestrator')
    expect(h.power).toEqual(['start'])

    // The run ends; the queued message waits in the person's Session again, held, and never went to the unattended one.
    await h.autopilot.forceStop(PROJECT)
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    const attended = await h.session()
    expect(attended.queued()).toMatchObject({ items: [{ text: 'look at the logs later' }], paused: true })
    expect(h.messages(true)).toEqual([WAVE_1])
  })

  it('a run of the same Epic starts on a Linked machine during the wait: run-stopped start-refused with the reason, told to the start\'s listener', async () => {
    const linked: LinkedRuns[] = [{ machine: 'Studio', runs: [] }]
    const h = harness({ linked })
    await personInTurn(h)
    const refusals: string[] = []
    expect(await h.autopilot.start(PROJECT, EPIC, { onLateRefusal: (message) => refusals.push(message) })).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator' })
    expect(refusals).toEqual([])
    linked[0] = { machine: 'Studio', runs: [{ epic: EPIC, origin: ORIGIN }] }
    h.releases.release('turn')
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.state()).toMatchObject({ reason: 'start-refused', message: runningElsewhere(EPIC, 'Studio') })
    expect(await h.kinds()).toEqual(['run-started', 'orchestrator-busy', 'orchestrator-free', 'run-stopped start-refused'])
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'start-refused', message: runningElsewhere(EPIC, 'Studio') })
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(h.power).toEqual([])
    expect(refusals).toEqual([runningElsewhere(EPIC, 'Studio')])
  })

  it('"Start anyway" on a waiting run: the run of the same Epic elsewhere does not refuse it when the Orchestrator is free', async () => {
    const linked: LinkedRuns[] = [{ machine: 'Studio', runs: [{ epic: EPIC, origin: ORIGIN }] }]
    const h = harness({ linked })
    await personInTurn(h)
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(runningElsewhere(EPIC, 'Studio'))
    expect(await h.autopilot.start(PROJECT, EPIC, { override: true })).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator' })
    h.releases.release('turn')
    await until(async () => (await h.kinds()).includes('wave-started') || h.state().status === 'stopped', 'Wave 1 or the end of the run')
    expect((await h.kinds()).slice(0, 4)).toEqual(['run-started', 'orchestrator-busy', 'orchestrator-free', 'wave-started'])
    expect((await h.journal())[0]).toMatchObject({ kind: 'run-started', override: true })
    expect(h.messages(true)).toEqual([WAVE_1])
  })

  it('Start window: the window is weighed when the Orchestrator is free, not at the click', async () => {
    // At the click the clock is half an hour before the window opens; the turn ends inside it.
    const click = new Date(2026, 10, 6, 10, 30).getTime()
    let now = click
    const h = harness({ window: { from: 11, to: 13, now: () => now } })
    await personInTurn(h)
    expect(await h.autopilot.start(PROJECT, EPIC)).toMatchObject({ status: 'waiting', waitingFor: 'orchestrator' })
    now = click + 40 * 60_000
    h.releases.release('turn')
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    expect(await h.kinds()).not.toContain('start-window')
    expect(h.messages(true)).toEqual([WAVE_1])
  })
})
