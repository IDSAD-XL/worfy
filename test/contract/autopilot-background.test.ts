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
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { ORCHESTRATOR_HAS_TASKS, Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { LayoutStore } from '../../src/main/layout/store'
import { Autopilot } from '../../src/main/autopilot/run'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { BACKGROUND_STALL_MS, TASKS_GRACE_MS } from '../../src/shared/autopilot/cycle'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'

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

async function until(condition: () => boolean | Promise<boolean>, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms
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

function harness(options: { script?: string; returnGraceMs?: number } = {}) {
  const env = { WORFY_DATA_DIR: join(scratch, 'data-root') }
  const calls: (FakeCall & { unattended: boolean })[] = []
  const requests: QueryRequest[] = []
  const releases = new FakeReleases()
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    const unattended = request.unattended === true
    return fakeQueryFactory({
      scriptsDir,
      script: unattended ? (options.script ?? 'autopilot-background') : 'autopilot-waves',
      record: (call) => calls.push({ ...call, unattended }),
      releases,
    })(request)
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
  })
  const workflow = async (root: string) => (await readWorkflow({ root, claudeHome: join(scratch, 'claude-home') }, runner)).model
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
  const workflowListeners = new Set<() => void>()
  const gate = new ReadGate()
  const autopilot = new Autopilot({
    projectRoot: () => repo,
    selfRefusal: () => Promise.resolve(null),
    workflow: async (root) => {
      await gate.pass()
      return workflow(root)
    },
    watchWorkflow: (_root, onChange) => {
      workflowListeners.add(onChange)
      return Promise.resolve(() => {
        workflowListeners.delete(onChange)
      })
    },
    orchestrators,
    registry,
    waves: launcher,
    journal: (start) => openRun(start, { env }),
    keepAwake: () => ({ start: () => power.push('start'), stop: () => power.push('stop') }),
    onChange: (state) => states.push(state),
    settleMs: 60_000,
    tasksClock: clock,
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
  return { registry, orchestrators, autopilot, calls, requests, releases, power, states, clock, gate, observed, broadcast, journal, kinds, session, results, changed }
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

  it('Stop with live tasks stops the run at once, keeps the Orchestrator and keep-awake until the tasks end, and refuses a new run meanwhile', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    const stopped = await h.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    const events = await h.journal()
    expect(events.at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'user-stop', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] })
    // The unattended Session lives on: closing it would kill the tasks.
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.power).toEqual(['start'])
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(ORCHESTRATOR_HAS_TASKS)
    // The tasks end; the last one's task-notification turn runs in the same Session, then the Orchestrator returns.
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    h.releases.release('tasks')
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator')
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
    await until(() => !h.autopilot.anyRunning(), 'the stopped run to let go')
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    // worfy sent the unattended Session one message, the Wave; the other turns came from task-notifications.
    expect(h.calls.filter((call) => call.kind === 'message' && call.unattended)).toHaveLength(1)
    await until(async () => (await h.kinds()).at(-1) === 'orchestrator-returned', 'the orchestrator-returned line')
    expect(h.power).toEqual(['start', 'stop'])
    expect(heldWhileTasksLive(await h.journal())).toEqual([])
    // How the tasks ended after the stop is in the journal, between run-stopped and orchestrator-returned.
    expect(setsAfterStop(await h.journal())).toEqual([['task_impl_0002'], []])
  })

  it('Stop during the Wave\'s turn, before it started any task, still waits for the turn and the tasks it starts', async () => {
    // The Wave's turn holds before its first task, as /epic-wave runs a while before it starts the implementers.
    const script = variant('stop-in-turn', (line) => line)
    const lines = readFileSync(join(scriptsDir, `${script}.jsonl`), 'utf8').trim().split('\n')
    writeFileSync(join(scriptsDir, `${script}.jsonl`), `${[...lines.slice(0, 2), '{"fake":"wait_release","name":"turn"}', ...lines.slice(2)].join('\n')}\n`)
    const h = harness({ script })
    await h.autopilot.start(PROJECT, EPIC)
    await until(async () => (await h.kinds()).includes('wave-started'), 'Wave 1')
    expect((await h.session()).state).toBe('busy')
    expect(await taskIds(h)).toEqual([])
    const stopped = await h.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    const last = (await h.journal()).at(-1)
    expect(last).toMatchObject({ kind: 'run-stopped', reason: 'user-stop' })
    expect(last).not.toHaveProperty('tasks')
    // The turn runs on in the unattended Session: keep-awake stays, and the app's quit would wait for stopAll().
    expect(h.power).toEqual(['start'])
    expect(h.autopilot.anyRunning()).toBe(true)
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    // The turn starts its two tasks and ends; the Orchestrator waits for them.
    h.releases.release('turn')
    await until(async () => (await taskIds(h)).length === 2 && (await h.session()).state === 'idle', 'the turn to end with two tasks')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.power).toEqual(['start'])
    h.releases.release('tasks')
    h.releases.release('tasks')
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator')
    await until(async () => (await h.kinds()).at(-1) === 'orchestrator-returned', 'the orchestrator-returned line')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.autopilot.anyRunning()).toBe(false)
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
    expect(setsAfterStop(await h.journal())).toEqual([['task_impl_0001'], ['task_impl_0001', 'task_impl_0002'], ['task_impl_0002'], []])
  })

  it('after a stop, the Orchestrator returns when the grace time passes without the last task\'s turn', async () => {
    const h = harness({ script: noLastTurn('return-grace'), returnGraceMs: 20 })
    await waveWaitsForTasks(h)
    await h.autopilot.stop(PROJECT)
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    h.releases.release('tasks')
    // No turn follows the last task's end: only the grace timer gives the Orchestrator back.
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator')
    await until(async () => (await h.kinds()).at(-1) === 'orchestrator-returned', 'the orchestrator-returned line')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
  })

  it('refuses a new run while the Orchestrator waits for the last task\'s turn, with no task left', async () => {
    const h = harness({ script: noLastTurn('return-pending'), returnGraceMs: 60_000 })
    await waveWaitsForTasks(h)
    await h.autopilot.stop(PROJECT)
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 1 && (await h.session()).state === 'idle', 'the first task-notification turn')
    h.releases.release('tasks')
    await until(async () => (await taskIds(h)).length === 0, 'the last task to end')
    // No task, no turn, no queue: only the pending return of the Orchestrator refuses the start.
    expect((await h.session()).state).toBe('idle')
    expect((await h.session()).queued().items).toEqual([])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(ORCHESTRATOR_HAS_TASKS)
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

  it('a stop for a reason of the cycle does not close the Session while tasks live either', async () => {
    const h = harness()
    await waveWaitsForTasks(h)
    // The limit without task events is a stop of the cycle (background-stalled): the Session stays.
    expect(h.clock.pending()).toEqual([BACKGROUND_STALL_MS])
    h.clock.fire(BACKGROUND_STALL_MS)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'background-stalled' })
    expect(h.calls.filter((call) => call.kind === 'close')).toEqual([])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
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
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'background-stalled', tasks: [{ id: 'task_impl_0002', type: 'local_agent', description: 'Implement the second ticket of the wave' }] })
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
    await h.autopilot.stop(PROJECT)
    // The app's quit waits for stopAll() only while this is true.
    expect(h.autopilot.anyRunning()).toBe(true)
    await h.autopilot.stopAll()
    expect(h.autopilot.anyRunning()).toBe(false)
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'tasks-killed', reason: 'app-quit', tasks: [{ id: 'task_impl_0001' }, { id: 'task_impl_0002' }] })
    expect(h.power).toEqual(['start', 'stop'])
  })
})
