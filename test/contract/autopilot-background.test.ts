// Autopilot and the Orchestrator's background tasks (worfy-daily ticket 29, ADR-0029) on the fake
// agent: the real Session registry, Orchestrators, launcher, run journal and cycle, over a copy of
// an Epic in a temporary folder. The fake agent plays
// test/fixtures/agent-scripts/autopilot-background.jsonl: the Wave's turn starts two background
// tasks and ends while the Wave's Tickets are still open, as /epic-wave does; the test releases the
// tasks one by one (wait_release), and each one's task-notification starts a turn of its own.
// Variants of the script (an ambient task, no background_tasks_changed at all) are written into
// the test's temporary folder. keep-awake is a fake; the background-task limit runs on a manual clock.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import type { LaunchApproval, RunApproval } from '../../src/main/agent/auto-approve/run-approval'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { LayoutStore } from '../../src/main/layout/store'
import { Autopilot, STOP_TEXT } from '../../src/main/autopilot/run'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { BACKGROUND_STALL_MS, TASKS_GRACE_MS } from '../../src/shared/autopilot/cycle'
import type { AgentEvent } from '../../src/shared/agent/events'
import { makeRunId, type JournalEvent } from '../../src/shared/autopilot/journal'
import { autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { IGNORE_TERM_EXIT_SIGNAL, StubProcesses, type StubKind } from './claude-process-stub'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const PROJECT = 'demo-000000a9'
const EPIC = 'demo'

let scratch: string
let repo: string
let scriptsDir: string
let registries: SessionRegistry[] = []
let autopilots: Autopilot[] = []
let stubs: StubProcesses[] = []

// Wave 1: 01 and 02; Wave 2: 03 (after 01 and 02).
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
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autopilot-bg-')))
  repo = join(scratch, 'repo')
  scriptsDir = join(scratch, 'scripts')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  mkdirSync(scriptsDir, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  for (const { num } of TICKETS) writeTicket(num, 'open')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  const script = readFileSync(join(fixtures, 'autopilot-background.jsonl'), 'utf8')
  writeFileSync(join(scriptsDir, 'autopilot-background.jsonl'), script)
  writeFileSync(join(scriptsDir, 'autopilot-waves.jsonl'), readFileSync(join(fixtures, 'autopilot-waves.jsonl'), 'utf8'))
})

afterEach(async () => {
  for (const autopilot of autopilots) await autopilot.stopAll()
  autopilots = []
  for (const registry of registries) registry.closeAll()
  registries = []
  for (const stub of stubs) await stub.stopAll()
  stubs = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A variant of the fixture script: each parsed line through `map`; null drops the line. */
function variant(name: string, map: (line: Record<string, unknown>) => Record<string, unknown> | null): string {
  const lines = readFileSync(join(fixtures, 'autopilot-background.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const next = map(JSON.parse(line) as Record<string, unknown>)
      return next === null ? [] : [JSON.stringify(next)]
    })
  writeFileSync(join(scriptsDir, `${name}.jsonl`), `${lines.join('\n')}\n`)
  return name
}

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
  /** How many timers were set so far. */
  sets = 0
  readonly timers = new Map<number, { fn: () => void; ms: number }>()
  setTimeout = (fn: () => void, ms: number): number => {
    this.sets += 1
    const id = this.next++
    this.timers.set(id, { fn, ms })
    return id
  }
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }
  /** The durations of the timers now set. */
  pending(): number[] {
    return [...this.timers.values()].map((timer) => timer.ms)
  }
  /** Fires every timer of this duration. */
  fire(ms: number): void {
    for (const [id, timer] of [...this.timers]) {
      if (timer.ms !== ms) continue
      this.timers.delete(id)
      timer.fn()
    }
  }
}

/** A hold on the run's fresh reads of the workflow model: while `held`, each read waits for open(). */
class ReadGate {
  held = false
  /** Reads waiting now. */
  waiting = 0
  /** Reads that went through after waiting. */
  passed = 0
  private opens: (() => void)[] = []
  async pass(): Promise<void> {
    if (!this.held) return
    this.waiting += 1
    await new Promise<void>((done) => this.opens.push(done))
    this.waiting -= 1
    this.passed += 1
  }
  open(): void {
    this.held = false
    for (const done of this.opens.splice(0)) done()
  }
}

/**
 * How long a Stop waits for the interrupted turn here: the fake agent's wait_release does not end
 * on interrupt(), so a Stop during such a wait ends the turn by closing the process after this.
 */
const HALT_MS = 100

/** What the unattended fake agent answers setPermissionMode with under `refuseModeChange`. */
const MODE_REFUSED = 'the agent refused the change of the permission mode'

function harness(options: { script?: string; attendedScript?: string; returnGraceMs?: number; processes?: StubKind; exitWaitMs?: number; approval?: boolean; refuseModeChange?: boolean | (() => Promise<void>) } = {}) {
  const env = { WORFY_DATA_DIR: join(scratch, 'data-root') }
  const calls: (FakeCall & { unattended: boolean })[] = []
  const requests: QueryRequest[] = []
  const releases = new FakeReleases()
  // With `processes`, a real child process stands behind each query (claude-process-stub.ts, ADR-0064).
  const kind = options.processes
  const stub = kind === undefined ? null : new StubProcesses(() => kind)
  if (stub !== null) stubs.push(stub)
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    const unattended = request.unattended === true
    const fake = fakeQueryFactory({
      scriptsDir,
      script: unattended ? (options.script ?? 'autopilot-background') : (options.attendedScript ?? 'autopilot-waves'),
      record: (call) => calls.push({ ...call, unattended }),
      releases,
    })
    const query = (stub === null ? fake : stub.wrap(fake))(request)
    // `refuseModeChange`: the unattended process refuses a change of its permission mode, so a stopped run cannot give
    // its Session back as it runs (worfy-autopilot-queue ticket 08) and waits for its turn and tasks, as before. A function:
    // what the change answers instead (a refusal the test holds back).
    const refuse = options.refuseModeChange
    if (refuse === undefined || refuse === false || !unattended) return query
    return query.then((handle) => Object.assign(handle, { setPermissionMode: refuse === true ? () => Promise.reject(new Error(MODE_REFUSED)) : refuse }))
  })
  registries.push(registry)
  /** Every event of every Session as the main process sees it (registry.observe), and as the windows get it. */
  const observed: AgentEvent[] = []
  const broadcast: AgentEvent[] = []
  registry.observe((_sessionId, event) => observed.push(event))
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: (_sessionId, event) => broadcast.push(event),
    publish: () => undefined,
    ...(options.returnGraceMs === undefined ? {} : { returnGraceMs: options.returnGraceMs }),
    ...(options.exitWaitMs === undefined ? {} : { exitWaitMs: options.exitWaitMs }),
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
  /** The policies the runs opened (worfy-auto-approve ticket 04), in order, and whether each let its folder go. */
  const approvals: FakeApproval[] = []
  const states: AutopilotState[] = []
  const clock = new ManualClock()
  const workflowListeners = new Set<() => void>()
  /** `fails`: the next workflow watch a start opens is refused. */
  const watch = { fails: false }
  const gate = new ReadGate()
  const autopilot = new Autopilot({
    projectRoot: () => repo,
    selfRefusal: () => Promise.resolve(null),
    workflow: async (root) => {
      await gate.pass()
      return workflow(root)
    },
    watchWorkflow: (_root, onChange) => {
      if (watch.fails) return Promise.reject(new Error('the workflow watch cannot open'))
      workflowListeners.add(onChange)
      return Promise.resolve(() => {
        workflowListeners.delete(onChange)
      })
    },
    orchestrators,
    registry,
    waves: launcher,
    journal: (start) => openRun(start, { env }),
    harness: () => 'plugin',
    keepAwake: () => ({ start: () => power.push('start'), stop: () => power.push('stop') }),
    onChange: (state) => states.push(state),
    settleMs: 60_000,
    tasksClock: clock,
    haltTurnMs: HALT_MS,
    ...(options.approval === true ? { approval: { mode: () => 'on' as const, open: () => Promise.resolve(fakeApproval(approvals)) } } : {}),
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  const journal = async (): Promise<JournalEvent[]> => {
    const dir = join(env.WORFY_DATA_DIR, 'autopilot')
    const runs = readdirSync(dir).map((name) => name.replace(/\.jsonl$/, ''))
    expect(runs).toHaveLength(1)
    return (await readRun(runs[0]!, { env }))!.events
  }
  const kinds = async () => (await journal()).map((event) => event.kind)
  const session = async () => registry.get((await orchestrators.open(PROJECT)).sessionId ?? '')
  const results = () => calls.filter((call) => call.kind === 'message' && call.unattended).length
  const changed = () => {
    for (const listener of workflowListeners) listener()
  }
  /** What reached Claude Code so far: prompts the Sessions reported, and messages the fake agent got. */
  const sent = () => ({ prompts: observed.filter((event) => event.type === 'prompt').length, messages: calls.filter((call) => call.kind === 'message').length })
  const closes = () => calls.filter((call) => call.kind === 'close').map((call) => (call.kind === 'close' ? call.backgroundTasks : []))
  return { registry, orchestrators, autopilot, calls, requests, releases, power, states, clock, gate, observed, broadcast, journal, kinds, session, results, changed, sent, closes, stub, watch, approvals }
}

interface FakeApproval {
  run: string
  closed: boolean
}

/** A run's policy that judges nothing and tells when its folder goes (worfy-auto-approve ticket 04). */
function fakeApproval(approvals: FakeApproval[]): RunApproval {
  const entry: FakeApproval = { run: makeRunId(new Date(), (approvals.length + 1).toString(16).padStart(6, '0')), closed: false }
  approvals.push(entry)
  const runTemp = join(scratch, 'run-temp', entry.run)
  return {
    run: entry.run,
    runTemp,
    environment: { TMPDIR: runTemp },
    facts: { hooksPath: null, hooksActive: false, rebaseUpdateRefs: false, remotes: [], defaultBranch: 'main', configFiles: [], checkoutConfig: false, commonDir: null },
    setWave: () => undefined,
    judge: () => Promise.resolve({ outcome: 'deny', rule: 'not-judged', hint: null, targets: [] }),
    close: () => {
      entry.closed = true
      return Promise.resolve()
    },
  }
}

/** The Session's background tasks as worfy counts them, by id. */
const taskIds = async (h: ReturnType<typeof harness>) => (await h.session()).backgroundTasks().map((task) => task.taskId)

/**
 * The rule of ADR-0029 point 4 over a journal: a `wave-finished`, or a `run-stopped` with
 * no-progress or no-ready-wave, only where the last `background-tasks` line before it is empty.
 */
function heldWhileTasksLive(events: readonly JournalEvent[]): string[] {
  const broken: string[] = []
  let live = 0
  for (const event of events) {
    if (event.kind === 'background-tasks') live = event.tasks.length
    const ends = event.kind === 'wave-finished' || (event.kind === 'run-stopped' && (event.reason === 'no-progress' || event.reason === 'no-ready-wave'))
    if (ends && live > 0) broken.push(`${event.kind} at ${event.at} with ${live} tasks`)
  }
  return broken
}

/** Lets the Wave 1 turn end with both tasks alive: the run waits for them. */
async function waveWaitsForTasks(h: ReturnType<typeof harness>): Promise<void> {
  await h.autopilot.start(PROJECT, EPIC)
  await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
  await until(async () => (await taskIds(h)).length === 2 && (await h.session()).state === 'idle', 'the turn to end with two tasks')
  await until(() => autopilotStatusLine(h.autopilot.state(PROJECT)) === 'Wave 1 · 2 background tasks', 'the status line')
  // The turn's end has been judged: the run waits in phase tasks, with the limit set.
  await until(() => h.clock.pending().length > 0, 'the run to wait for the tasks')
}

/**
 * A variant whose Wave turn starts both tasks and then ends with a server error: the run stops with turn-error. `edit`
 * changes the script's lines (parsed) before the error is put in.
 */
function turnErrorScript(name = 'turn-error-tasks', edit: (lines: Record<string, unknown>[]) => Record<string, unknown>[] = (lines) => lines): string {
  const lines = edit(readFileSync(join(fixtures, 'autopilot-background.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>))
  let results = 0
  const failed = lines.map((line) => {
    if (line.type !== 'result' || (results += 1) > 1) return line
    return { ...line, is_error: true, result: 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}', terminal_reason: 'api_error' }
  })
  writeFileSync(join(scriptsDir, `${name}.jsonl`), `${failed.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return name
}

/** The person's pick of the permission mode for the Orchestrator's Node, made in its attended Session before the run. */
async function pickMode(h: ReturnType<typeof harness>, mode: string): Promise<void> {
  const session = await h.session()
  await until(() => session.state === 'idle', 'the attended Orchestrator')
  await session.configure({ permissionMode: mode })
}

/** The background-tasks lines of a journal after its run-stopped line, as lists of task ids. */
function setsAfterStop(events: readonly JournalEvent[]): string[][] {
  const stopped = events.findIndex((event) => event.kind === 'run-stopped')
  return events.slice(stopped + 1).flatMap((event) => (event.kind === 'background-tasks' ? [event.tasks.map((task) => task.id)] : []))
}

/** A variant of the script whose last task ends without a task-notification turn after it. */
function noLastTurn(name: string): string {
  const script = variant(name, (line) => line)
  const lines = readFileSync(join(scriptsDir, `${script}.jsonl`), 'utf8').trim().split('\n')
  writeFileSync(join(scriptsDir, `${script}.jsonl`), `${lines.slice(0, -3).join('\n')}\n{"fake":"wait_release","name":"never"}\n`)
  return script
}

/**
 * A variant of the script with one more turn right after the Wave's turn: the answer to the next
 * user message (STOP_TEXT of a graceful Stop), played while both tasks still run.
 */
function stopTurn(name: string): string {
  const script = variant(name, (line) => line)
  const lines = readFileSync(join(scriptsDir, `${script}.jsonl`), 'utf8').trim().split('\n')
  const resultAt = lines.findIndex((line) => (JSON.parse(line) as { type?: string }).type === 'result')
  const turn = ['{"fake":"wait_message"}', lines[1]!, lines[resultAt - 1]!, lines[resultAt]!]
  writeFileSync(join(scriptsDir, `${script}.jsonl`), `${[...lines.slice(0, resultAt + 1), ...turn, ...lines.slice(resultAt + 1)].join('\n')}\n`)
  return script
}

describe('Autopilot waits for the background tasks of its Orchestrator', () => {
  it('keeps the Wave while tasks run, and ends it only with the result of the last turn a task-notification started', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    // The real run of 2026-10-06 stopped right here with no-progress: the Tickets are still open.
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 1, backgroundTasks: 2 })
    expect(await h.kinds()).not.toContain('wave-finished')
    expect(await h.kinds()).not.toContain('run-stopped')
    // The implementers work: they claim their Tickets, then finish them.
    writeTicket(1, 'claimed — 2026-10-06')
    writeTicket(2, 'claimed — 2026-10-06')
    h.changed()
    writeTicket(1, 'done — 2026-10-06')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    await until(() => autopilotStatusLine(h.autopilot.state(PROJECT)) === 'Wave 1 · 1 background task', 'one task left')
    expect(await h.kinds()).not.toContain('wave-finished')
    writeTicket(2, 'done — 2026-10-06')
    h.releases.release('tasks')
    // The last task's turn ends the Wave; Wave 2 (Ticket 03) is sent and waits for its own tasks.
    await until(async () => (await h.kinds()).includes('wave-finished'), 'Wave 1 to finish')
    await until(async () => (await h.kinds()).filter((kind) => kind === 'wave-started').length === 2, 'Wave 2')
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'wave-finished')).toMatchObject({ wave: 1, tickets: ['01', '02'] })
    expect(heldWhileTasksLive(events)).toEqual([])
    // Every change of the set is in the journal, in order: two, one, none, then Wave 2's.
    const sets = events.filter((event) => event.kind === 'background-tasks').map((event) => event.tasks.map((task) => task.id))
    expect(sets.slice(0, 4)).toEqual([['task_impl_0001'], ['task_impl_0001', 'task_impl_0002'], ['task_impl_0002'], []])
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
  })

  it('an ambient task does not hold the Wave', async () => {
    const script = variant('ambient', (line) => {
      if (line.subtype === 'background_tasks_changed') return { ...line, tasks: (line.tasks as Record<string, unknown>[]).map((task) => ({ ...task, ambient: true })) }
      if (line.subtype === 'task_started') return { ...line, ambient: true }
      return line
    })
    const h = harness({ script })
    await h.autopilot.start(PROJECT, EPIC)
    // The turn ends with only ambient tasks: the Wave is judged at once, and its Tickets are open.
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'no-progress', backgroundTasks: 0 })
    expect(await taskIds(h)).toEqual([])
  })

  it('without background_tasks_changed, the task_started / task_notification pairs hold the Wave the same way', async () => {
    const script = variant('pairs', (line) => (line.subtype === 'background_tasks_changed' ? null : line))
    const h = harness({ script })
    await waveWaitsForTasks(h)
    expect(await h.kinds()).not.toContain('wave-finished')
    writeTicket(1, 'done — 2026-10-06')
    writeTicket(2, 'done — 2026-10-06')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    expect(await h.kinds()).not.toContain('wave-finished')
    h.releases.release('tasks')
    await until(async () => (await h.kinds()).includes('wave-finished'), 'Wave 1 to finish')
    expect(heldWhileTasksLive(await h.journal())).toEqual([])
  })

  it('a graceful Stop with live tasks keeps the Orchestrator unattended until the last task\'s turn has ended; STOP_TEXT goes once, no new Wave (worfy-week ticket 18)', async () => {
    const h = harness({ script: stopTurn('graceful-tasks') })
    await waveWaitsForTasks(h)
    const answer = await h.autopilot.stop(PROJECT)
    expect(answer).toMatchObject({ status: 'running', stopping: true })
    // The Orchestrator was idle: STOP_TEXT starts its turn at once, and that turn ends with both tasks alive.
    await until(() => h.calls.some((call) => call.kind === 'message' && call.text === STOP_TEXT), 'STOP_TEXT to reach the Orchestrator')
    await until(async () => (await h.session()).state === 'idle' && (await h.kinds()).includes('run-stopping'), 'the turn of STOP_TEXT to end')
    await new Promise((done) => setTimeout(done, 50))
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true, backgroundTasks: 2 })
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    // The implementers finish their Tickets; the first task's turn ends: one task still runs.
    writeTicket(1, 'done — 2026-10-06')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    await new Promise((done) => setTimeout(done, 50))
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true })
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    // The last task's turn ends: the run ends with user-stop and gives the Orchestrator back.
    writeTicket(2, 'done — 2026-10-06')
    h.releases.release('tasks')
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'user-stop', stopping: false, resumable: [] })
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the Orchestrator to be given back')
    // Keep-awake stops right after the run's last journal line, on its own tick.
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.calls.filter((call) => call.kind === 'message' && call.text === STOP_TEXT)).toHaveLength(1)
    // Wave 2 (Ticket 03) was ready and did not go; nothing was killed.
    const kinds = await h.kinds()
    expect(kinds.filter((kind) => kind === 'wave-started')).toHaveLength(1)
    expect(kinds).not.toContain('wave-finished')
    expect(kinds).not.toContain('tasks-killed')
    expect(h.closes()).toEqual([])
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'run-stopping')).toMatchObject({ reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork: [] })
    expect(events.at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'user-stop' })
    expect(events.at(-1)).not.toHaveProperty('tickets')
  })

  it('Force stop with live tasks interrupts the Orchestrator: its process closes with the tasks, it is a person\'s Session again when forceStop() answers, and nothing more is sent (worfy-week tickets 17, 18)', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    const before = h.sent()
    const stopped = await h.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop', resumable: [1, 2] })
    // Closing the unattended Session's process killed both implementers.
    expect(h.closes()).toEqual([['task_impl_0001', 'task_impl_0002']])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    // Keep-awake stops right after the run's last journal line, on its own tick.
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.autopilot.anyRunning()).toBe(false)
    const events = await h.journal()
    expect(events.slice(events.findIndex((event) => event.kind === 'run-stopped'))).toMatchObject([
      { kind: 'run-stopped', reason: 'user-force-stop', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }], tickets: ['01', '02'] },
      { kind: 'tasks-killed', reason: 'user-force-stop', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] },
      { kind: 'orchestrator-returned' },
    ])
    // No turn follows: the attended Session gets no prompt and no message by itself.
    await new Promise((done) => setTimeout(done, 100))
    expect(h.sent()).toEqual(before)
    expect((await h.session()).state).toBe('idle')
    // A new run is taken at once: nothing waits to be given back.
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running' })
  })

  it('Force stop with a Claude Code process that ignores SIGTERM: forceStop() answers once the old process was killed and the new one started (worfy-week ticket 20)', async () => {
    const h = harness({ processes: 'ignore-term', exitWaitMs: 300 })
    await waveWaitsForTasks(h)
    // The attended process, then the unattended one Autopilot started after the first had exited. On
    // Windows kill() is TerminateProcess: each old process dies at its SIGTERM, which its exit reports.
    const killed = (n: number): string => `exit ${n} ${IGNORE_TERM_EXIT_SIGNAL}`
    expect(h.stub?.order()).toEqual(['spawn 1', killed(1), 'spawn 2'])
    const stopped = await h.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop', resumable: [1, 2] })
    // When forceStop() answers, the unattended process is gone and the attended one has started, in that order.
    expect(h.stub?.order()).toEqual(['spawn 1', killed(1), 'spawn 2', killed(2), 'spawn 3'])
    expect(h.stub?.maxAlive()).toBe(1)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    const events = await h.journal()
    expect(events.slice(events.findIndex((event) => event.kind === 'run-stopped')).map((event) => event.kind)).toEqual(['run-stopped', 'tasks-killed', 'orchestrator-returned'])
    await until(async () => (await h.session()).state === 'idle', 'the attended Session to be idle')
  })

  /** The fixture with the Wave's turn held (wait_release `turn`) after its first `upTo` lines. */
  function heldTurn(name: string, upTo: number): string {
    const script = variant(name, (line) => line)
    const lines = readFileSync(join(scriptsDir, `${script}.jsonl`), 'utf8').trim().split('\n')
    writeFileSync(join(scriptsDir, `${script}.jsonl`), `${[...lines.slice(0, upTo), '{"fake":"wait_release","name":"turn"}', ...lines.slice(upTo)].join('\n')}\n`)
    return script
  }

  it('Stop during the Wave\'s turn, before it started any task, ends the turn: no task starts, and the Orchestrator is a person\'s Session again', async () => {
    // The Wave's turn holds before its first task, as /epic-wave runs a while before it starts the
    // implementers; the fake agent's turn does not end on interrupt(), so the halt's limit runs out.
    const h = harness({ script: heldTurn('stop-in-turn', 2) })
    await h.autopilot.start(PROJECT, EPIC)
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    const unattended = await h.session()
    expect(unattended.state).toBe('busy')
    expect(await taskIds(h)).toEqual([])
    const before = h.sent()
    const stopped = await h.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop' })
    expect(unattended.state).toBe('closed')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    // Keep-awake stops right after the run's last journal line, on its own tick.
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.autopilot.anyRunning()).toBe(false)
    const events = await h.journal()
    expect(events.slice(events.findIndex((event) => event.kind === 'run-stopped')).map((event) => event.kind)).toEqual(['run-stopped', 'orchestrator-returned'])
    expect(events.find((event) => event.kind === 'run-stopped')).not.toHaveProperty('tasks')
    // The held turn would have started two tasks: its process is gone, so nothing starts, nothing is sent.
    h.releases.release('turn')
    await new Promise((done) => setTimeout(done, 100))
    expect(h.sent()).toEqual(before)
    expect(setsAfterStop(await h.journal())).toEqual([])
    expect(await taskIds(h)).toEqual([])
  })

  it('Stop while the Wave\'s turn is starting its tasks closes the process with them and journals them as killed', async () => {
    // The turn holds right after its second task started, before its result.
    const h = harness({ script: heldTurn('stop-starting-tasks', 6) })
    await h.autopilot.start(PROJECT, EPIC)
    await until(async () => (await taskIds(h)).length === 2, 'the two tasks')
    expect((await h.session()).state).toBe('busy')
    await h.autopilot.forceStop(PROJECT)
    expect(h.closes()).toEqual([['task_impl_0001', 'task_impl_0002']])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    const events = await h.journal()
    expect(events.slice(events.findIndex((event) => event.kind === 'run-stopped'))).toMatchObject([
      { kind: 'run-stopped', reason: 'user-force-stop', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] },
      { kind: 'tasks-killed', reason: 'user-force-stop', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] },
      { kind: 'orchestrator-returned' },
    ])
  })

  it('a person\'s message queued before Stop waits, held, in the queue of the person\'s Session after it; no turn starts', async () => {
    const h = harness({ script: heldTurn('stop-with-queue', 2) })
    await h.autopilot.start(PROJECT, EPIC)
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    const unattended = await h.session()
    expect(unattended.send('look at ticket 02 when you can')).toBe('queued')
    const before = h.sent()
    await h.autopilot.forceStop(PROJECT)
    const attended = await h.session()
    expect(attended).not.toBe(unattended)
    expect(attended.queued()).toMatchObject({ items: [{ text: 'look at ticket 02 when you can' }], paused: true })
    await new Promise((done) => setTimeout(done, 100))
    expect(h.sent()).toEqual(before)
    expect(attended.queued().items).toHaveLength(1)
  })

  it('after a stop of the cycle, the Orchestrator returns when the grace time passes without the last task\'s turn', async () => {
    // The agent refuses the change of mode, so the stopped run waits for its tasks unattended (worfy-autopilot-queue ticket 08).
    const h = harness({ script: noLastTurn('return-grace'), returnGraceMs: 20, refuseModeChange: true })
    await pickMode(h, 'default')
    await waveWaitsForTasks(h)
    // background-stalled waits for the tasks (ADR-0029); only user-force-stop interrupts them (worfy-week tickets 17, 18).
    h.clock.fire(BACKGROUND_STALL_MS)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    h.releases.release('tasks')
    // No turn follows the last task's end: only the grace timer gives the Orchestrator back.
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator')
    await until(async () => (await h.kinds()).at(-1) === 'orchestrator-returned', 'the orchestrator-returned line')
    // Keep-awake stops right after the run's last journal line, on its own tick.
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
  })

  it('a new run takes the Orchestrator of a stalled run that waits for the last task\'s turn, with no task left, as it is: no relaunch (worfy-polish ticket 50)', async () => {
    // The agent refuses the change of mode, so the stopped run waits for its tasks unattended (worfy-autopilot-queue ticket 08).
    const h = harness({ script: noLastTurn('return-pending'), returnGraceMs: 60_000, refuseModeChange: true })
    await pickMode(h, 'default')
    await waveWaitsForTasks(h)
    h.clock.fire(BACKGROUND_STALL_MS)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 0, 'the last task to end')
    // No task, no turn, no queue: only the pending return of the Orchestrator, which the new run calls off.
    expect((await h.session()).state).toBe('idle')
    expect((await h.session()).queued().items).toEqual([])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    const session = await h.session()
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running' })
    expect(await h.session()).toBe(session)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    // The grace timer of this Orchestrator must not fire into a later test.
    h.orchestrators.retain(new Set())
  })

  it('a turn that started before the fresh read decides the Wave with its own result', async () => {
    // The Wave's turn starts no task; right after its result another turn begins (a task-notification
    // or a queued message), and holds.
    const lines = readFileSync(join(fixtures, 'autopilot-background.jsonl'), 'utf8').trim().split('\n')
    const turn = (n: number) => lines[n]!
    writeFileSync(
      join(scriptsDir, 'next-turn.jsonl'),
      `${[turn(0), turn(1), '{"fake":"wait_release","name":"turn"}', turn(6), turn(7), turn(12), '{"fake":"wait_release","name":"next"}', turn(13), turn(14), '{"fake":"wait_release","name":"never"}'].join('\n')}\n`,
    )
    const h = harness({ script: 'next-turn' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    // The Wave's Tickets are done: judged on the first result alone, the Wave would be finished.
    writeTicket(1, 'done — 2026-10-06')
    writeTicket(2, 'done — 2026-10-06')
    h.gate.held = true
    h.releases.release('turn')
    // The first result's fresh read waits; meanwhile the next turn has started.
    await until(async () => h.gate.waiting === 1 && (await h.session()).state === 'busy', 'the next turn during the read')
    h.gate.open()
    await until(() => h.gate.passed === 1, 'the read to go through')
    await expect(until(async () => (await h.kinds()).includes('wave-finished'), 'no wave-finished', 300)).rejects.toThrow(/timed out/)
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 1 })
    // The next turn's result decides.
    h.releases.release('next')
    await until(async () => (await h.kinds()).includes('wave-finished'), 'Wave 1 to finish')
  })

  it('the death of Claude Code with live tasks empties the set: the run does not wait, and the Orchestrator returns', async () => {
    // Claude Code dies in the Wave's turn, after starting both tasks.
    const lines = readFileSync(join(fixtures, 'autopilot-background.jsonl'), 'utf8').trim().split('\n')
    const result = lines.findIndex((line) => line.includes('"type": "result"'))
    writeFileSync(join(scriptsDir, 'crash.jsonl'), `${[...lines.slice(0, result), '{"fake":"wait_release","name":"crash"}', '{"fake":"crash","error":"Claude Code crashed"}'].join('\n')}\n`)
    const h = harness({ script: 'crash' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    await until(async () => (await taskIds(h)).length === 2, 'the two tasks')
    const session = await h.session()
    h.releases.release('crash')
    const crashedAt = () => h.observed.findIndex((event) => event.type === 'state' && event.state === 'error')
    await until(() => crashedAt() >= 0, 'the crash')
    // The set is emptied with the process, before the Session reports its error (and before any close).
    const emptied = h.observed.findIndex((event) => event.type === 'background_tasks' && event.tasks.length === 0)
    expect(emptied).toBeGreaterThanOrEqual(0)
    expect(emptied).toBeLessThan(crashedAt())
    expect(session.backgroundTasks()).toEqual([])
    const sets = h.observed.flatMap((event) => (event.type === 'background_tasks' ? [event.tasks.map((task) => task.taskId)] : []))
    expect(sets.slice(0, 3)).toEqual([['task_impl_0001'], ['task_impl_0001', 'task_impl_0002'], []])
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const last = (await h.journal()).at(-1)
    expect(last).toMatchObject({ kind: 'run-stopped', reason: 'session-error' })
    expect(last).not.toHaveProperty('tasks')
    // Nothing holds the Orchestrator: it is given back at once, and keep-awake is released.
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator')
    // Keep-awake stops right after the run's last journal line, on its own tick.
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.autopilot.anyRunning()).toBe(false)
  })

  it('task_activity reaches the main process, not the windows', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    expect(h.observed.filter((event) => event.type === 'task_activity')).toEqual([{ type: 'task_activity', taskId: 'task_impl_0001', backgrounded: false }])
    expect(h.broadcast.filter((event) => event.type === 'task_activity')).toEqual([])
    // Every other event of the Session still reaches the windows.
    expect(h.broadcast.filter((event) => event.type === 'background_tasks')).toHaveLength(3)
    expect(h.broadcast.filter((event) => event.type === 'result')).toHaveLength(2)
  })

  it('a stop for a reason of the cycle does not close the Session while tasks live either: it goes back to a person as it runs (worfy-autopilot-queue ticket 08)', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    const session = await h.session()
    // The limit without task events is a stop of the cycle (background-stalled): the Session stays.
    expect(h.clock.pending()).toEqual([BACKGROUND_STALL_MS])
    h.clock.fire(BACKGROUND_STALL_MS)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'background-stalled' })
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(await h.session()).toBe(session)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
  })

  it('a task event while the run waits sets the limit anew, without a turn', async () => {
    // Only task_progress of the first task, then the script stands: no turn, no change of the set.
    const script = variant('progress-only', (line) => line)
    const lines = readFileSync(join(scriptsDir, `${script}.jsonl`), 'utf8').trim().split('\n')
    const progress = lines.findIndex((line) => line.includes('"task_progress"'))
    writeFileSync(join(scriptsDir, `${script}.jsonl`), `${[...lines.slice(0, progress + 1), '{"fake":"wait_release","name":"never"}'].join('\n')}\n`)
    const h = harness({ script })
    await waveWaitsForTasks(h)
    const before = h.clock.sets
    h.releases.release('tasks')
    await until(() => h.clock.sets > before, 'the limit set anew')
    expect(h.clock.pending()).toEqual([BACKGROUND_STALL_MS])
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'running', backgroundTasks: 2 })
  })

  it('stops with background-stalled after the limit without task events, and lists the live tasks', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    expect(h.clock.pending()).toEqual([BACKGROUND_STALL_MS])
    const before = h.clock.sets
    // An event of a task starts the limit over: the first task's end (and the turn after it) sets it anew.
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    await until(() => h.clock.pending().length === 1, 'the limit set again')
    expect(h.clock.sets).toBeGreaterThan(before)
    expect(h.clock.pending()).toEqual([BACKGROUND_STALL_MS])
    h.clock.fire(BACKGROUND_STALL_MS)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'background-stalled' })
    expect((await h.journal()).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'background-stalled', tasks: [{ id: 'task_impl_0002', type: 'local_agent', description: 'Implement the second ticket of the wave' }] })
  })

  it('judges the Wave without a turn when the tasks ended and no task-notification turn came within the grace time', async () => {
    // The last task ends without a turn of its own.
    const h = harness({ script: noLastTurn('no-last-turn') })
    await waveWaitsForTasks(h)
    writeTicket(1, 'done — 2026-10-06')
    writeTicket(2, 'done — 2026-10-06')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 0, 'the last task to end')
    await until(() => h.clock.pending().includes(TASKS_GRACE_MS), 'the grace time')
    expect(await h.kinds()).not.toContain('wave-finished')
    h.clock.fire(TASKS_GRACE_MS)
    await until(async () => (await h.kinds()).includes('wave-finished'), 'Wave 1 to finish')
  })

  it('app-quit with live tasks lists them in run-stopped', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    await h.autopilot.stopAll()
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'app-quit', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] })
    // On quit the run does not wait for the tasks: every Session closes with the app.
    // Keep-awake stops right after the run's last journal line, on its own tick.
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.autopilot.anyRunning()).toBe(false)
    // Closing the Session ends its process, and the tasks with it.
    const session = await h.session()
    h.registry.closeAll()
    expect(session.backgroundTasks()).toEqual([])
    expect(h.observed.filter((event) => event.type === 'background_tasks').at(-1)).toEqual({ type: 'background_tasks', tasks: [] })
  })

  it('app-quit while a stopped run still waits for its tasks journals them as killed', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    // A stop of the cycle leaves the tasks running (ADR-0029); Stop by the user would have killed them.
    h.clock.fire(BACKGROUND_STALL_MS)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'background-stalled' })
    // The app's quit waits for stopAll() only while this is true.
    expect(h.autopilot.anyRunning()).toBe(true)
    await h.autopilot.stopAll()
    expect(h.autopilot.anyRunning()).toBe(false)
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'tasks-killed', reason: 'app-quit', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] })
    // Keep-awake stops right after the run's last journal line, on its own tick.
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
  })
})

describe("a stop of the run's own gives the Orchestrator back as it runs: no new process, the tasks live on (worfy-autopilot-queue ticket 08)", () => {
  /** A permission request of the Wave's turn that Claude Code makes in bypassPermissions too (its own rm check). */
  const WAVE_REQUEST = { fake: 'permission', toolName: 'Bash', toolUseId: 'toolu_wave_rm', input: { command: 'rm -rf build', description: 'Remove the build folder' }, bypassImmune: true, decisionReason: 'Dangerous rm operation' }
  /** A permission request of the turn the first task's task-notification starts. */
  const REPORT_REQUEST = { fake: 'permission', toolName: 'Bash', toolUseId: 'toolu_report_ls', input: { command: 'ls build', description: 'List the build folder' } }
  /** turnErrorScript with WAVE_REQUEST in the Wave's turn and REPORT_REQUEST in the first task-notification turn. */
  const requestsScript = (): string =>
    turnErrorScript('turn-error-requests', (lines) => {
      const waveResult = lines.findIndex((line) => line.type === 'result')
      const withWave: Record<string, unknown>[] = [...lines.slice(0, waveResult), WAVE_REQUEST, ...lines.slice(waveResult)]
      const reportInit = withWave.findIndex((line, index) => index > waveResult && line.type === 'system' && line.subtype === 'init')
      return [...withWave.slice(0, reportInit + 1), REPORT_REQUEST, ...withWave.slice(reportInit + 1)]
    })
  const line = (h: ReturnType<typeof harness>) => autopilotStatusLine(h.autopilot.state(PROJECT))

  it("turn-error with two live tasks: the same process goes on attended in the Node's mode, orchestrator-returned names the tasks, and their task-notification turns run in the person's Session", async () => {
    const h = harness({ script: turnErrorScript() })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const session = await h.session()
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'turn-error', backgroundTasks: 2 })
    expect(line(h)).toBe('stopped: turn error · 2 background tasks still run')
    // A person's Session at once, in the mode the Node keeps; no run waits to give it back.
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(session.unattended).toBe(false)
    expect(session.settings.permissionMode).toBe('default')
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(false)
    // No new process: the run's one, never closed, its mode changed in place.
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    expect(h.closes()).toEqual([])
    expect(h.calls.filter((call) => call.kind === 'setPermissionMode' && call.unattended)).toMatchObject([{ mode: 'default' }])
    expect(await taskIds(h)).toEqual(['task_impl_0001', 'task_impl_0002'])
    const named = [
      { id: 'task_impl_0001', type: 'local_agent', description: 'Implement the first ticket of the wave' },
      { id: 'task_impl_0002', type: 'local_agent', description: 'Implement the second ticket of the wave' },
    ]
    expect((await h.journal()).slice(-2)).toMatchObject([
      { kind: 'run-stopped', reason: 'turn-error', tasks: named },
      { kind: 'orchestrator-returned', tasks: named },
    ])
    // The Mac stays awake while the tasks live.
    expect(h.power).toEqual(['start'])

    // The first task ends: its task-notification starts a turn of the person's Session, in its mode.
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && session.state === 'idle', 'the first task-notification turn')
    expect(await h.session()).toBe(session)
    expect(h.observed.filter((event) => event.type === 'init').at(-1)).toMatchObject({ permissionMode: 'default' })
    await until(() => line(h) === 'stopped: turn error · 1 background task still runs', 'the line to count one task')
    expect(h.power).toEqual(['start'])

    // The last one ends: keep-awake goes, the line names no task, and the journal says nothing more of the person's Session.
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 0 && session.state === 'idle', 'the last task-notification turn')
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(line(h)).toBe('stopped: turn error')
    expect(h.states.at(-1)).toMatchObject({ status: 'stopped', backgroundTasks: 0 })
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'orchestrator-returned' })
    expect(await h.kinds()).not.toContain('tasks-killed')
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    expect(h.closes()).toEqual([])
  })

  for (const policy of ['off', 'on'] as const) {
    it(`Auto-approval ${policy}: a request while the run holds the Session is the run's to answer; after the give-back it goes to the person`, async () => {
      const h = harness({ script: requestsScript(), approval: policy === 'on' })
      await pickMode(h, 'default')
      await h.autopilot.start(PROJECT, EPIC)
      await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
      const session = await h.session()
      const permissions = () => h.calls.filter((call) => call.kind === 'permission')
      // In the run: refused at once (Off) or judged by the run's policy (On); no person was asked.
      expect(permissions()).toMatchObject([{ toolName: 'Bash', input: WAVE_REQUEST.input, result: { behavior: 'deny' } }])
      expect(h.observed.filter((event) => event.type === 'permission_request')).toEqual([])
      if (policy === 'off') expect(h.observed.filter((event) => event.type === 'refused_dialog')).toMatchObject([{ dialog: 'permission_request', subject: 'Bash' }])
      else expect(h.observed.filter((event) => event.type === 'auto_approval')).toMatchObject([{ mode: 'on', tool: 'Bash', outcome: 'deny' }])
      const judged = h.observed.filter((event) => event.type === 'refused_dialog' || event.type === 'auto_approval').length

      // The first task's report runs in the person's Session: its request waits for the person, in the same process.
      h.releases.release('tasks')
      await until(() => session.state === 'needs_permission', 'the request of the report to wait for the person')
      const asked = h.observed.flatMap((event) => (event.type === 'permission_request' ? [event] : []))
      expect(asked).toMatchObject([{ toolName: 'Bash', input: REPORT_REQUEST.input }])
      expect(asked[0]).not.toHaveProperty('parked')
      expect(session.answerPermission(asked[0]!.requestId, 'allow')).toBe(true)
      await until(() => permissions().length === 2, 'the answer to reach the agent')
      expect(permissions()[1]).toMatchObject({ input: REPORT_REQUEST.input, result: { behavior: 'allow' } })
      expect(h.observed.filter((event) => event.type === 'refused_dialog' || event.type === 'auto_approval')).toHaveLength(judged)
      expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
      h.releases.release('tasks')
      await until(async () => (await taskIds(h)).length === 0 && session.state === 'idle', 'the last task-notification turn')
    })
  }

  it('the agent refuses the change of mode: the Session stays unattended until its tasks end, then starts again attended, as before', async () => {
    const h = harness({ script: turnErrorScript(), refuseModeChange: true })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const session = await h.session()
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(session.unattended).toBe(true)
    expect(session.settings.permissionMode).toBe('bypassPermissions')
    // The give-back waits for the tasks: a new run would take the Session as it is (worfy-polish ticket 50).
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(true)
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'turn-error', backgroundTasks: 0 })
    expect(line(h)).toBe('stopped: turn error')
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'turn-error' })
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && session.state === 'idle', 'the first task-notification turn')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    h.releases.release('tasks')
    await until(async () => (await h.kinds()).at(-1) === 'orchestrator-returned', 'the Orchestrator to be given back')
    expect((await h.journal()).at(-1)).not.toHaveProperty('tasks')
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
  })

  it('a refusal that comes once the tasks and their turns have ended: the Session starts again attended after the grace time, and the run journals orchestrator-returned and lets keep-awake go', async () => {
    let refuse: (error: Error) => void = () => undefined
    let asked = 0
    const h = harness({
      script: turnErrorScript(),
      returnGraceMs: 2000,
      refuseModeChange: () => {
        asked += 1
        return new Promise<void>((_resolve, reject) => {
          refuse = reject
        })
      },
    })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => asked === 1, 'the change of mode to be asked')
    const session = await h.session()
    // Both tasks end, and their turns too, while the change is still tried.
    h.releases.release('tasks')
    h.releases.release('tasks')
    await until(async () => session.backgroundTasks().length === 0 && session.state === 'idle', 'the tasks and their turns to end')
    expect(h.autopilot.state(PROJECT).status).toBe('running')
    refuse(new Error(MODE_REFUSED))
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    // The last task ended during the change: its task-notification turn may still be on its way, so the grace time runs first.
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    await until(async () => (await h.kinds()).at(-1) === 'orchestrator-returned', 'the Orchestrator to be given back')
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.autopilot.anyRunning()).toBe(false)
  })

  it("the message Start now kept aside comes back to the person's Session, held and first, when the run gives it back as it runs; once only", async () => {
    writeFileSync(join(scriptsDir, 'autopilot-wait-person.jsonl'), readFileSync(join(fixtures, 'autopilot-wait-person.jsonl'), 'utf8'))
    const h = harness({ script: turnErrorScript(), attendedScript: 'autopilot-wait-person' })
    await pickMode(h, 'default')
    const person = await h.session()
    person.send('how is it going?')
    await until(() => person.state === 'busy', "the person's turn")
    expect(person.send('look at the logs later')).toBe('queued')
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'waiting', waitingFor: 'orchestrator' })
    await expect(h.autopilot.startNow(PROJECT)).resolves.toMatchObject({ status: 'running' })
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'turn-error', backgroundTasks: 2 })
    const session = await h.session()
    expect(session.unattended).toBe(false)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    // Not lost with the person's closed process, and never sent to the run's: it waits for "Send queued".
    expect(session.queued()).toMatchObject({ items: [{ text: 'look at the logs later' }], paused: true })
    expect(h.calls.filter((call) => call.kind === 'message').map((call) => (call.kind === 'message' ? call.text : ''))).not.toContain('look at the logs later')

    // Given back once: the person drops it, the tasks end, and the next run's give-back brings nothing back.
    expect(session.removeQueued(session.queued().items[0]!.id)).toBe(true)
    h.releases.release('tasks')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 0 && session.state === 'idle', 'the last task-notification turn')
    await until(() => !h.autopilot.anyRunning(), 'the first run to be done')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.requests.length === 3 && h.autopilot.state(PROJECT).status === 'stopped', 'the second run to stop')
    const second = await h.session()
    expect(second.unattended).toBe(false)
    expect(second.queued().items).toEqual([])
  })

  it("the run's policy is let go at the give-back: the person's Session is judged by none, its folder stays", async () => {
    const h = harness({ script: turnErrorScript(), approval: true })
    const launches: (LaunchApproval | undefined)[] = []
    const setUnattended = h.orchestrators.setUnattended.bind(h.orchestrators)
    vi.spyOn(h.orchestrators, 'setUnattended').mockImplementation((projectId, unattended, approval, options) => {
      if (unattended) launches.push(approval)
      return setUnattended(projectId, unattended, approval, options)
    })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(launches[0]?.mode()).toBe('off')
    expect(launches[0]?.environment()).toEqual({})
    expect(h.approvals.map((approval) => approval.closed)).toEqual([false])
  })

  it("a new run while the given-back Session still has its tasks waits for them: the Orchestrator is a busy person's Session now", async () => {
    const h = harness({ script: turnErrorScript() })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'waiting', waitingFor: 'orchestrator' })
    expect(h.autopilot.state(PROJECT).busy?.tasks).toHaveLength(2)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    await h.autopilot.stop(PROJECT)
  })

  it('app-quit while the given-back Session still has its tasks journals them as killed and lets keep-awake go', async () => {
    const h = harness({ script: turnErrorScript() })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.anyRunning()).toBe(true)
    await h.autopilot.stopAll()
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'tasks-killed', reason: 'app-quit', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] })
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.autopilot.anyRunning()).toBe(false)
  })
})

describe('a new run after a stop while the Orchestrator still has live tasks (worfy-polish ticket 50)', () => {
  // A stop of the run's own gives the Session back as it runs (worfy-autopilot-queue ticket 08): these runs stop with a
  // Session that refuses the change of its permission mode, so it waits for its tasks unattended, and a new run takes it.

  /** Every run journal of the test, oldest first. */
  const journals = async (): Promise<JournalEvent[][]> => {
    const dir = join(scratch, 'data-root', 'autopilot')
    const runs = await Promise.all(readdirSync(dir).map(async (name) => (await readRun(name.replace(/\.jsonl$/, ''), { env: { WORFY_DATA_DIR: join(scratch, 'data-root') } }))!.events))
    return runs.sort((a, b) => (a[0]?.at ?? '').localeCompare(b[0]?.at ?? ''))
  }

  it('after a turn-error stop with live tasks, the next start takes the same unattended Session: no relaunch, the tasks live on', async () => {
    const h = harness({ script: turnErrorScript(), refuseModeChange: true })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'turn-error' })
    // The stopped run waits for both tasks before it gives the Orchestrator back (ADR-0029).
    expect(await taskIds(h)).toEqual(['task_impl_0001', 'task_impl_0002'])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    const session = await h.session()
    // No run drives it now: autopilot_start in it asks the person (chat-confirm.ts).
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(true)

    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running' })
    // The same Session and process: nothing was started again, so nothing was killed.
    expect(await h.session()).toBe(session)
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(false)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    expect(h.closes()).toEqual([])
    expect(await taskIds(h)).toEqual(['task_impl_0001', 'task_impl_0002'])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    const [first, second] = await journals()
    expect(first!.at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'turn-error', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] })
    expect(second![0]).toMatchObject({ kind: 'run-started' })
    // The old run's wait for the tasks is over: keep-awake goes to the new run, which holds it first.
    expect(h.power).toEqual(['start', 'start', 'stop'])

    // A task ends: the new run journals it, the old one no more; the Orchestrator is not given back.
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1, 'the first task to end')
    await until(async () => (await journals())[1]!.some((event) => event.kind === 'background-tasks' && event.tasks.length === 1), 'the new run to journal the set')
    expect((await journals())[0]!.at(-1)).toMatchObject({ kind: 'run-stopped' })
    await new Promise((done) => setTimeout(done, 50))
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
  })

  it('a start that fails after it took the Session leaves the tasks to the stopped run: keep-awake stays on, and that run journals them until it gives the Orchestrator back', async () => {
    const h = harness({ script: turnErrorScript(), refuseModeChange: true })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const session = await h.session()
    // The new run's workflow watch cannot open: the start fails after its journal and keep-awake.
    h.watch.fails = true
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow('the workflow watch cannot open')
    // Only the failed run's keep-awake went: the stopped run still holds its own.
    expect(h.power).toEqual(['start', 'start', 'stop'])
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(true)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    h.releases.release('tasks')
    await until(async () => (await journals())[0]!.at(-1)?.kind === 'background-tasks', 'the stopped run to journal the set')
    expect((await journals())[0]!.at(-1)).toMatchObject({ kind: 'background-tasks', tasks: [{ id: 'task_impl_0002' }] })
    // The last task's turn ends: the Orchestrator goes back, and the stopped run's wait ends with it.
    h.releases.release('tasks')
    await until(async () => (await journals())[0]!.at(-1)?.kind === 'orchestrator-returned', 'the Orchestrator to be given back')
    await until(() => h.power.length >= 4, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'start', 'stop', 'stop'])
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
  })

  /**
   * Two runs in one Session: run A's Wave turn starts task 1 and ends with a server error; task 1
   * ends (release `a`) with no turn after it. Run B's Wave turn starts task 2 and ends with the same
   * error; task 2 ends (release `b`), and its task-notification turn comes only on release `late`.
   */
  const twoRunsScript = (): string => {
    const lines = readFileSync(join(fixtures, 'autopilot-background.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    const at = (index: number): Record<string, unknown> => lines[index]!
    const failed = (index: number) => ({ ...at(index), is_error: true, result: 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}', terminal_reason: 'api_error' })
    const noTasks = (suffix: string) => ({ ...at(16), uuid: `00000000-0000-4000-8000-0000000050${suffix}` })
    const wait = (name: string) => ({ fake: 'wait_release', name })
    const script = [
      // Run A: Wave turn with task 1, then task 1 ends.
      at(0), at(1), at(2), at(3), at(6), failed(7),
      wait('a'), noTasks('01'), at(11),
      // Run B: Wave turn with task 2, then task 2 ends; its turn comes late.
      at(0), at(12), at(10), at(5), at(13), failed(14),
      wait('b'), noTasks('02'), at(17),
      wait('late'), at(18), at(19), at(20),
    ]
    writeFileSync(join(scriptsDir, 'two-runs.jsonl'), `${script.map((line) => JSON.stringify(line)).join('\n')}\n`)
    return 'two-runs'
  }

  /** Run A stops with task 1, task 1 ends, and run B takes the Session and stops with task 2 alive. */
  const takenOverRun = async (h: ReturnType<typeof harness>): Promise<number> => {
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'run A to stop')
    expect(await taskIds(h)).toEqual(['task_impl_0001'])
    h.releases.release('a')
    await until(async () => (await taskIds(h)).length === 0, 'task 1 to end')
    // Run A's give-back now waits for the grace time, with no task and no turn.
    const ended = Date.now()
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running' })
    await until(async () => (await taskIds(h)).length === 1 && h.autopilot.state(PROJECT).status === 'stopped', 'run B to stop with task 2')
    expect(await taskIds(h)).toEqual(['task_impl_0002'])
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'turn-error' })
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    return ended
  }

  it("the stopped run's grace time does not give back the Session the new run took: only the new run's own grace time does", async () => {
    const grace = ms(1500)
    const h = harness({ script: twoRunsScript(), returnGraceMs: grace, refuseModeChange: true })
    await pickMode(h, 'default')
    const ended = await takenOverRun(h)
    // Task 2 ends well after task 1, so run B's grace time ends well after run A's would have.
    await new Promise((done) => setTimeout(done, Math.max(0, ended + ms(700) - Date.now())))
    h.releases.release('b')
    await until(async () => (await taskIds(h)).length === 0, 'task 2 to end')
    await new Promise((done) => setTimeout(done, Math.max(0, ended + grace + ms(200) - Date.now())))
    // Past run A's grace time: the Session is still unattended, waiting for task 2's turn.
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
    // No turn comes: run B's grace time gives the Orchestrator back.
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator', 10_000)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    await until(async () => (await journals())[1]!.at(-1)?.kind === 'orchestrator-returned', 'run B to journal the return')
  })

  it('the new run ends after the takeover: once its task and that task\'s turn have ended, the Session is given back attended', async () => {
    const h = harness({ script: twoRunsScript(), returnGraceMs: 60_000, refuseModeChange: true })
    await pickMode(h, 'default')
    await takenOverRun(h)
    h.releases.release('b')
    await until(async () => (await taskIds(h)).length === 0, 'task 2 to end')
    await new Promise((done) => setTimeout(done, 50))
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    // Task 2's task-notification turn: once it has ended, the Orchestrator is a person's Session again.
    h.releases.release('late')
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator')
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    await until(async () => (await journals())[1]!.at(-1)?.kind === 'orchestrator-returned', 'run B to journal the return')
    const [first, second] = await journals()
    // Run A's journal ends where run B took its Session; nothing was killed in either run.
    expect(first!.at(-1)).toMatchObject({ kind: 'background-tasks', tasks: [] })
    expect([...first!, ...second!].map((event) => event.kind)).not.toContain('tasks-killed')
    await until(() => h.power.length >= 4, 'keep-awake to stop')
    expect(h.power).toEqual(['start', 'start', 'stop', 'stop'])
    // Run B's grace timer must not fire into a later test.
    h.orchestrators.retain(new Set())
  })

  it('an attended Orchestrator with live tasks is not taken: going unattended would start its Session again and kill them, so the run waits (worfy-autopilot-queue ticket 07)', async () => {
    // A person's turn starts the two tasks and ends while they run.
    const h = harness({ attendedScript: 'autopilot-background' })
    const session = await h.session()
    session.send('start the implementers')
    await until(async () => (await taskIds(h)).length === 2 && (await h.session()).state === 'idle', 'the person\'s turn to end with two tasks')
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'waiting', waitingFor: 'orchestrator', busy: { turn: false, queued: 0 } })
    expect(h.autopilot.state(PROJECT).busy?.tasks).toHaveLength(2)
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    await expect(h.autopilot.stop(PROJECT)).resolves.toMatchObject({ reason: 'start-cancelled' })
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
  })
})

describe('the folder for temporary files of a run with a policy (worfy-auto-approve ticket 04)', () => {
  const turnErrorScript = (): string => {
    let results = 0
    return variant('turn-error-tasks-approval', (line) => {
      if (line.type !== 'result' || (results += 1) > 1) return line
      return { ...line, is_error: true, result: 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}', terminal_reason: 'api_error' }
    })
  }

  it('a stopped run whose tasks still live keeps its folder until the Orchestrator is given back', async () => {
    // The agent refuses the change of mode, so the stopped run waits for its tasks unattended (worfy-autopilot-queue ticket 08).
    const h = harness({ script: turnErrorScript(), approval: true, refuseModeChange: true })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.requests.at(-1)?.environment).toEqual({ TMPDIR: join(scratch, 'run-temp', h.approvals[0]!.run) })
    await new Promise((done) => setTimeout(done, 50))
    expect(h.approvals.map((approval) => approval.closed)).toEqual([false])
    h.releases.release('tasks')
    h.releases.release('tasks')
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the Orchestrator to be given back')
    await until(() => h.approvals[0]!.closed, 'the folder to go')
  })

  it('a stopped run that gives its Session back as it runs keeps its folder after the tasks end: the process goes on with it as TMPDIR (worfy-autopilot-queue ticket 08)', async () => {
    const h = harness({ script: turnErrorScript(), approval: true })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    h.releases.release('tasks')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 0 && (await h.session()).state === 'idle', 'the last task-notification turn')
    await until(() => h.power.length >= 2, 'keep-awake to stop')
    await new Promise((done) => setTimeout(done, 50))
    // The person's Session goes on in the same process: its folder is left to the next start of the app (sweepRunTemps).
    expect(h.approvals.map((approval) => approval.closed)).toEqual([false])
    expect(h.requests.map((request) => request.environment?.['TMPDIR'])).toEqual([undefined, join(scratch, 'run-temp', h.approvals[0]!.run)])
  })

  it('a new run that takes the Session over keeps the old run\'s folder: the process goes on with it as TMPDIR', async () => {
    // The agent refuses the change of mode, so the stopped run waits for its tasks unattended (worfy-autopilot-queue ticket 08).
    const h = harness({ script: turnErrorScript(), approval: true, refuseModeChange: true })
    await pickMode(h, 'default')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running' })
    // The same process: it started with the first run's folder.
    expect(h.requests.map((request) => request.environment?.['TMPDIR'])).toEqual([undefined, join(scratch, 'run-temp', h.approvals[0]!.run)])
    await new Promise((done) => setTimeout(done, 50))
    expect(h.approvals.map((approval) => approval.closed)).toEqual([false, false])
  })

  it('a start cancelled while it waits for the Orchestrator lets its folder go (worfy-autopilot-queue ticket 07)', async () => {
    const h = harness({ attendedScript: 'autopilot-background', approval: true })
    const session = await h.session()
    session.send('start the implementers')
    await until(async () => (await taskIds(h)).length === 2 && (await h.session()).state === 'idle', 'the person\'s turn to end with two tasks')
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'waiting' })
    expect(h.approvals.map((approval) => approval.closed)).toEqual([false])
    await h.autopilot.stop(PROJECT)
    expect(h.approvals.map((approval) => approval.closed)).toEqual([true])
  })
})
