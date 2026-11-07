// Auto-continue of a manual turn of the Orchestrator, outside an Autopilot run (worfy-retry ticket 06), on
// the fake agent: the real Session registry, Orchestrators and LimitsTracker, the module
// src/main/agent/orchestrator-continue.ts wired as app-orchestrators.ts wires it (the views of
// `publish`, the events of the registry). Auto-continue is the test's switch, the clock is fixed, the
// timers are the test's and the jitter is fixed at the middle (random 0.5: the first pause is 1 minute).
// The last test runs a real Autopilot run on the same registry: the module stays silent, the run retries.
// Nothing calls the model.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { LimitsTracker, observeSessionLimits } from '../../src/main/agent/limits'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { OrchestratorContinue } from '../../src/main/agent/orchestrator-continue'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { continueText } from '../../src/main/autopilot/limits-wait'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { Autopilot } from '../../src/main/autopilot/run'
import { LayoutStore } from '../../src/main/layout/store'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { MAX_RETRIES, RETRY_DELAYS_MS, retryText } from '../../src/shared/agent/continue-plan'
import type { AgentEvent } from '../../src/shared/agent/events'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const PROJECT = 'demo-000000c6'
const EPIC = 'demo'
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
/** 2026-10-05T06:10:00Z: the times of the test go from it. */
const START_MS = 1791180600 * 1000
/** The reset of the refused `seven_day` window of orchestrator-continue-limits.jsonl. */
const RESET_MS = 1791184200 * 1000
/** A person's message in the Orchestrator's chat. */
const PERSON = 'Merge the PRs of Wave 3, then start Wave 4 with background agents.'
/** The start of every continuation after an API error (retryText). */
const RETRY_START = 'The previous turn ended with a temporary API error'

let scratch: string
let repo: string
let clock: number
let registries: SessionRegistry[] = []
let modules: OrchestratorContinue[] = []
let autopilots: Autopilot[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-orchestrator-continue-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  for (const num of [1, 2, 3]) writeTicket(num, 'open')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  clock = START_MS
})

afterEach(async () => {
  for (const autopilot of autopilots) await autopilot.stopAll()
  autopilots = []
  for (const module of modules) module.stop()
  modules = []
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

// ── the Epic of the Autopilot run (Wave 1: 01 and 02; Wave 2: 03) ────────────

const nn = (num: number): string => String(num).padStart(2, '0')
const ticketPath = (num: number): string => join(repo, '.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`)

function writeTicket(num: number, status: string): void {
  const blocked = num === 3 ? '01, 02' : '—'
  writeFileSync(ticketPath(num), [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n'))
}

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

// ── the harness ──────────────────────────────────────────────────────────────

async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 3000): Promise<void> {
  const end = Date.now() + ms(limit)
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

const tick = (wait = 50): Promise<void> => new Promise((done) => setTimeout(done, wait))

interface Timer {
  at: number
  fire: () => void
  cancelled: boolean
}

/** A timer of the test: fires only when the test calls `fire`. */
function timers() {
  const all: Timer[] = []
  const schedule = (at: number, fire: () => void): (() => void) => {
    const timer: Timer = { at, fire, cancelled: false }
    all.push(timer)
    return () => {
      timer.cancelled = true
    }
  }
  return { all, schedule, live: () => all.filter((timer) => !timer.cancelled) }
}

interface HarnessOptions {
  /** The script of the Orchestrator's Session, by its request (attended or unattended). */
  script: string | ((request: QueryRequest) => string)
  /** Auto-continue for the Project at the start (default on). */
  on?: boolean
}

function harness(options: HarnessOptions) {
  const dataRoot = join(scratch, 'data-root')
  mkdirSync(dataRoot, { recursive: true })
  const tracker = new LimitsTracker({ dataDir: dataRoot, now: () => clock })
  const calls: FakeCall[] = []
  const scriptOf = (request: QueryRequest): string => (typeof options.script === 'string' ? options.script : options.script(request))
  const registry = new SessionRegistry(tracker.observe((request) => fakeQueryFactory({ scriptsDir: fixtures, script: scriptOf(request), record: (call) => calls.push(call) })(request)))
  registries.push(registry)
  const events: { sessionId: string; event: AgentEvent }[] = []
  registry.observe((sessionId, event) => events.push({ sessionId, event }))
  let on = options.on ?? true
  const settingsListeners = new Set<() => void>()
  const moduleTimers = timers()
  const continuer = new OrchestratorContinue({
    observe: (sink) => registry.observe(sink),
    session: (sessionId) => registry.get(sessionId),
    enabled: (projectId) => projectId === PROJECT && on,
    observeSettings: (listener) => {
      settingsListeners.add(listener)
      return () => void settingsListeners.delete(listener)
    },
    limits: () => tracker.snapshot(),
    now: () => clock,
    schedule: moduleTimers.schedule,
    random: () => 0.5,
  })
  modules.push(continuer)
  const views: OrchestratorView[] = []
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: (view) => {
      views.push(view)
      continuer.view(view)
    },
  })
  /** The Orchestrator's Session id, as its last view names it. */
  const sessionId = (): string => {
    const id = views.at(-1)?.sessionId
    if (id === null || id === undefined) throw new Error('the Orchestrator has no Session')
    return id
  }
  const session = () => registry.get(sessionId())
  /** Opens the Project's Orchestrator and waits until it takes messages. */
  const open = async (): Promise<void> => {
    await orchestrators.open(PROJECT)
    await until(() => views.at(-1)?.sessionId != null && session().state === 'idle', 'the Orchestrator to be idle')
  }
  /** A person sends `text` in the Orchestrator's chat. */
  const write = (text: string): void => {
    session().send(text)
  }
  const messages = () => calls.filter((call): call is Extract<FakeCall, { kind: 'message' }> => call.kind === 'message').map((call) => call.text)
  /** worfy's lines in the Orchestrator's transcript: its `notice` events of kind `notification`. */
  const notices = () => events.flatMap(({ event }) => (event.type === 'notice' && event.kind === 'notification' ? [event.text] : []))
  /** The ends of the turns so far: true for a turn that ended with an error. */
  const results = () => events.flatMap(({ event }) => (event.type === 'result' ? [event.isError] : []))
  const setOn = (value: boolean): void => {
    on = value
    for (const listener of settingsListeners) listener()
  }
  return { registry, tracker, orchestrators, continuer, open, write, session, sessionId, messages, notices, results, timers: moduleTimers, setOn, dataRoot }
}

/** The local clock time of `at`, as the lines in the transcript show it. */
const hhmm = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// ── manual turns ─────────────────────────────────────────────────────────────

describe('Auto-continue of a manual turn of the Orchestrator (worfy-retry ticket 06)', () => {
  it('on: a 529 of a manual turn gives one continuation at the timer, with its lines in the transcript; the next turn goes through', async () => {
    const h = harness({ script: 'orchestrator-continue-overloaded' })
    await h.open()
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the wait for the continuation')

    const at = START_MS + RETRY_DELAYS_MS[0]!
    expect(h.timers.live().map((timer) => timer.at)).toEqual([at])
    expect(h.continuer.wait(PROJECT)).toEqual({ kind: 'retry', attempt: 1, of: MAX_RETRIES, error: 'overloaded', until: at })
    expect(h.notices()).toEqual([`worfy: API error 529, retry 1 of ${MAX_RETRIES} at ${hhmm(at)}`])
    await tick()
    expect(h.messages()).toEqual([PERSON])

    // The timer, even if it fires twice: one continuation, never the person's message again.
    clock = at
    const timer = h.timers.live()[0]!
    timer.fire()
    timer.fire()
    await until(() => h.results().length >= 2, 'the turn of the continuation')
    await tick()
    // `git status` only reads: the text names no action of the turn.
    expect(h.messages()).toHaveLength(2)
    expect(h.messages()[1]).toBe(retryText({ attempt: 1, of: MAX_RETRIES, error: 'overloaded', actions: [] }))
    expect(h.messages()[1]).toMatch(new RegExp(`^${RETRY_START}`, 'u'))
    expect(h.messages()[1]).not.toContain(PERSON)
    expect(h.notices()).toEqual([`worfy: API error 529, retry 1 of ${MAX_RETRIES} at ${hhmm(at)}`, `worfy: sent "continue" (retry 1 of ${MAX_RETRIES})`])
    // The continuation's turn went through: nothing waits, and no line came after it.
    expect(h.results()).toEqual([true, false])
    expect(h.continuer.wait(PROJECT)).toBeNull()
    expect(h.timers.live()).toEqual([])
  })

  it('off: the same 529 ends the turn as before the ticket — no timer, no line, nothing more goes to the Orchestrator', async () => {
    const h = harness({ script: 'orchestrator-continue-overloaded', on: false })
    await h.open()
    h.write(PERSON)
    await until(() => h.results().length === 1, 'the turn with the error')
    await tick(200)
    expect(h.results()).toEqual([true])
    expect(h.timers.all).toEqual([])
    expect(h.notices()).toEqual([])
    expect(h.messages()).toEqual([PERSON])
    expect(h.continuer.wait(PROJECT)).toBeNull()
  })

  it('a person who writes during the wait takes its place: the timer is cancelled and no continuation goes', async () => {
    const h = harness({ script: 'orchestrator-continue-overloaded' })
    await h.open()
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the wait for the continuation')
    const timer = h.timers.live()[0]!

    h.write('Go on with the merge.')
    await until(() => h.results().length >= 2, 'the person\'s turn')
    expect(timer.cancelled).toBe(true)
    expect(h.continuer.wait(PROJECT)).toBeNull()
    // A timer that fired before its cancel reached it sends nothing either.
    clock = timer.at
    timer.fire()
    await tick(200)
    expect(h.messages()).toEqual([PERSON, 'Go on with the merge.'])
    expect(h.messages().some((text) => text.startsWith(RETRY_START))).toBe(false)
    expect(h.notices()).toHaveLength(1)
  })

  it('the switch turned off during the wait cancels it; so does closing the Session', async () => {
    const h = harness({ script: 'orchestrator-continue-overloaded' })
    await h.open()
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the wait for the continuation')
    const timer = h.timers.live()[0]!
    h.setOn(false)
    expect(timer.cancelled).toBe(true)
    expect(h.continuer.wait(PROJECT)).toBeNull()
    clock = timer.at
    timer.fire()
    await tick(200)
    expect(h.messages()).toEqual([PERSON])
    expect(h.notices().at(-1)).toBe('worfy: Auto-continue is off; nothing was sent')

    // On again: the script's next turn goes through, the one after it ends with a 529 again; closing
    // the Session ends that wait.
    h.setOn(true)
    h.write('Go on.')
    await until(() => h.results().length >= 2, 'the turn that goes through')
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the second wait')
    const second = h.timers.live()[0]!
    h.session().close()
    await until(() => second.cancelled, 'the wait to end with the Session')
    expect(h.continuer.wait(PROJECT)).toBeNull()
    clock = second.at
    second.fire()
    await tick(200)
    expect(h.messages()).toEqual([PERSON, 'Go on.', PERSON])
  })

  it('a git push without its result is not retried: the line «not retried» and nothing more', async () => {
    const h = harness({ script: 'autopilot-retry-in-flight' })
    await h.open()
    h.write(PERSON)
    await until(() => h.results().length === 1, 'the turn with the error')
    await tick(200)
    expect(h.timers.all).toEqual([])
    expect(h.continuer.wait(PROJECT)).toBeNull()
    expect(h.notices()).toEqual(['worfy: not retried: `git push origin demo/01` may or may not have run'])
    expect(h.messages()).toEqual([PERSON])
  })

  it('a refusal by the Limits outside a run waits for the reset the stub reported, then sends one continuation', async () => {
    const h = harness({ script: 'orchestrator-continue-limits' })
    await h.open()
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the wait for the Limits')

    const at = RESET_MS + RESUME_MARGIN_MS
    expect(h.timers.live().map((timer) => timer.at)).toEqual([at])
    expect(h.continuer.wait(PROJECT)).toEqual({ kind: 'limits', window: 'seven_day', until: at })
    expect(h.notices()).toEqual([`worfy: waiting for the Limits, resumes ${hhmm(at)}`])
    await tick()
    expect(h.messages()).toEqual([PERSON])

    clock = at
    const timer = h.timers.live()[0]!
    timer.fire()
    timer.fire()
    await until(() => h.results().length >= 2, 'the turn of the continuation')
    await tick()
    expect(h.messages()).toEqual([PERSON, continueText(START_MS, at)])
    expect(h.notices().at(-1)).toBe('worfy: sent "continue" after the Limits wait')
    expect(h.results()).toEqual([true, false])
    expect(h.continuer.wait(PROJECT)).toBeNull()
    expect(h.timers.live()).toEqual([])
  })
})

// ── a run owns the Session ───────────────────────────────────────────────────

describe('while an Autopilot run owns the Orchestrator (worfy-retry ticket 06, spec risk 6)', () => {
  it('the module sends nothing and sets no timer; the run retries once', async () => {
    const h = harness({ script: (request) => (request.unattended === true ? 'autopilot-retry-500' : 'autopilot-waves') })
    const env = { WORFY_DATA_DIR: h.dataRoot }
    const workflow = async (root: string) => (await readWorkflow({ root, claudeHome: join(scratch, 'claude-home'), env: () => Promise.resolve(process.env) }, runner)).model
    const launcher = new ActionLauncher({
      projectRoot: () => repo,
      settings: () => ({ actionTemplates: { ...DEFAULT_ACTION_TEMPLATES } }),
      branch: () => Promise.resolve('main'),
      workflow,
      sessions: { create: () => ({ nodeId: 'n', sessionId: 's' }) as never },
      orchestrators: h.orchestrators,
      registry: h.registry,
      bindings: { setLaunch: () => undefined },
      pollMs: 5,
      waitMs: 200,
    })
    h.registry.observe((_sessionId, event) => {
      if (event.type === 'prompt' && event.text === WAVE_1) for (const num of [1, 2]) writeTicket(num, 'done — 2026-10-06')
    })
    const runTimers = timers()
    const send = (sessionId: string, text: string): void => {
      h.registry.get(sessionId).send(text)
    }
    const autopilot = new Autopilot({
      projectRoot: () => repo,
      selfRefusal: () => Promise.resolve(null),
      workflow,
      watchWorkflow: () => Promise.resolve(() => undefined),
      orchestrators: h.orchestrators,
      registry: h.registry,
      waves: launcher,
      journal: (start) => openRun(start, { env }),
      harness: () => 'plugin',
      keepAwake: () => ({ start: () => undefined, stop: () => undefined }),
      onChange: () => undefined,
      settleMs: 60_000,
      limits: {
        state: () => h.tracker.snapshot(),
        observeSession: (isSession, listener) => observeSessionLimits((sink) => h.registry.observe(sink), isSession, listener),
        send,
        now: () => clock,
        schedule: runTimers.schedule,
      },
      retry: { enabled: () => true, send, now: () => clock, schedule: runTimers.schedule, random: () => 0.5 },
    })
    autopilots.push(autopilot)
    launcher.attachAutopilot(autopilot)

    const retryLines = async (): Promise<number> => {
      const runs = readdirSync(join(h.dataRoot, 'autopilot')).map((name) => name.replace(/\.jsonl$/, ''))
      return (await readRun(runs[0]!, { env }))!.events.filter((event) => event.kind === 'turn-retry').length
    }
    const continuations = () => h.messages().filter((text) => text.startsWith(RETRY_START))

    await autopilot.start(PROJECT, EPIC)
    await until(() => autopilot.state(PROJECT).status === 'waiting' && runTimers.live().length === 1, 'the run\'s wait to retry')
    await tick(200)
    // The run waits; the module, which saw the same 500 of the same Session, does not.
    expect(await retryLines()).toBe(1)
    expect(h.timers.all).toEqual([])
    expect(h.continuer.wait(PROJECT)).toBeNull()
    expect(h.notices()).toEqual([])
    expect(continuations()).toEqual([])

    // The run's timer: one continuation, the run's own; the module adds none.
    clock = runTimers.live()[0]!.at
    runTimers.live()[0]!.fire()
    await until(() => continuations().length >= 1, 'the run\'s continuation')
    await until(() => h.messages().length >= 3, 'the run to send its next Wave')
    await tick(200)
    expect(continuations()).toHaveLength(1)
    expect(h.messages()[0]).toBe(WAVE_1)
    expect(h.timers.all).toEqual([])
    expect(h.notices()).toEqual([])
  })
})
