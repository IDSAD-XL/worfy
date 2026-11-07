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
import { fakeQueryFactory, FakeReleases, type FakeCall } from '../../src/main/agent/fake-query'
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
import { RECHECK_MS, RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { ms } from '../time-scale'

/** The listeners of the app's events (`will-quit`), and the registry the app's wiring runs its Sessions in. */
const stand = vi.hoisted(() => ({ listeners: new Map<string, (() => void)[]>(), registry: null as unknown }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/nowhere',
    on: (event: string, listener: () => void) => stand.listeners.set(event, [...(stand.listeners.get(event) ?? []), listener]),
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))
vi.mock('../../src/main/agent/app-registry', async (original) => ({ ...(await original<object>()), sharedRegistry: () => stand.registry }))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const PROJECT = 'demo-000000c6'
/** A second Project, with its own Orchestrator. */
const PROJECT_B = 'other-000000c6'
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
let repoB: string
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
  repoB = join(scratch, 'repo-b')
  mkdirSync(repoB)
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(join(scratch, 'data', PROJECT_B), { recursive: true })
  clock = START_MS
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  stand.listeners.clear()
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
  /** The script of the Orchestrator's Session, by its request (attended or unattended, its Project's folder). */
  script: string | ((request: QueryRequest) => string)
  /** Auto-continue at the start (default on), for PROJECT and PROJECT_B alike. */
  on?: boolean
  /** Whether the Sessions' rate_limit_event feed limits.json (default true). */
  feedLimits?: boolean
  /** Whether the module hears of a change of the settings (default true). */
  observeSettings?: boolean
}

function harness(options: HarnessOptions) {
  const dataRoot = join(scratch, 'data-root')
  mkdirSync(dataRoot, { recursive: true })
  const tracker = new LimitsTracker({ dataDir: dataRoot, now: () => clock })
  /** What each fake query was asked to do, with the folder of its Session (whose Project). */
  const calls: { cwd: string; call: FakeCall }[] = []
  const releases = new FakeReleases()
  const scriptOf = (request: QueryRequest): string => (typeof options.script === 'string' ? options.script : options.script(request))
  const fake = (request: QueryRequest) => fakeQueryFactory({ scriptsDir: fixtures, script: scriptOf(request), releases, record: (call) => calls.push({ cwd: request.cwd, call }) })(request)
  const registry = new SessionRegistry(options.feedLimits === false ? fake : tracker.observe(fake))
  registries.push(registry)
  const events: { sessionId: string; event: AgentEvent }[] = []
  registry.observe((sessionId, event) => events.push({ sessionId, event }))
  let on = options.on ?? true
  /** The Session runs unattended as far as the module asks (a run took it), without a relaunch. */
  let forceUnattended = false
  const settingsListeners = new Set<() => void>()
  const moduleTimers = timers()
  const continuer = new OrchestratorContinue({
    observe: (sink) => registry.observe(sink),
    session: (sessionId) => {
      const live = registry.get(sessionId)
      return {
        send: (text: string, attachments?: Parameters<typeof live.send>[1]) => live.send(text, attachments),
        notice: (text: string) => live.notice(text),
        get state() {
          return live.state
        },
        get unattended() {
          return forceUnattended || live.unattended
        },
      }
    },
    enabled: (projectId) => (projectId === PROJECT || projectId === PROJECT_B) && on,
    ...(options.observeSettings === false
      ? {}
      : {
          observeSettings: (listener: () => void) => {
            settingsListeners.add(listener)
            return () => void settingsListeners.delete(listener)
          },
        }),
    limits: () => tracker.snapshot(),
    now: () => clock,
    schedule: moduleTimers.schedule,
    random: () => 0.5,
  })
  modules.push(continuer)
  const views = new Map<string, OrchestratorView>()
  /** The events as the windows get them (the Orchestrators' broadcast, after the registry's observers). */
  const windowEvents: AgentEvent[] = []
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
    projectPath: (projectId) => (projectId === PROJECT_B ? repoB : repo),
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: (_sessionId, event) => windowEvents.push(event),
    publish: (view) => {
      views.set(view.projectId, view)
      continuer.view(view)
    },
  })
  /** The Project's Orchestrator Session id, as its last view names it. */
  const sessionId = (projectId = PROJECT): string => {
    const id = views.get(projectId)?.sessionId
    if (id === null || id === undefined) throw new Error(`the Orchestrator of ${projectId} has no Session`)
    return id
  }
  const session = (projectId = PROJECT) => registry.get(sessionId(projectId))
  /** Opens the Project's Orchestrator and waits until it takes messages. */
  const open = async (projectId = PROJECT): Promise<void> => {
    await orchestrators.open(projectId)
    await until(() => views.get(projectId)?.sessionId != null && session(projectId).state === 'idle', `the Orchestrator of ${projectId} to be idle`)
  }
  /** A person sends `text` in the Project's Orchestrator chat. */
  const write = (text: string, projectId = PROJECT): void => {
    session(projectId).send(text)
  }
  /** The messages the Project's Orchestrator got. */
  const messages = (projectId = PROJECT) =>
    calls.flatMap(({ cwd, call }) => (call.kind === 'message' && cwd === (projectId === PROJECT_B ? repoB : repo) ? [call.text] : []))
  /** worfy's lines in the transcript of the Project's Orchestrator: its `notice` events of kind `notification`. */
  const notices = (projectId?: string) =>
    events.flatMap(({ sessionId: id, event }) => (event.type === 'notice' && event.kind === 'notification' && (projectId === undefined || id === sessionId(projectId)) ? [event.text] : []))
  /** The ends of the Project's turns so far: true for a turn that ended with an error. */
  const results = (projectId?: string) =>
    events.flatMap(({ sessionId: id, event }) => (event.type === 'result' && (projectId === undefined || id === sessionId(projectId)) ? [event.isError] : []))
  const setOn = (value: boolean): void => {
    on = value
    for (const listener of settingsListeners) listener()
  }
  /** Another setting of app-settings.json changed: the switch stays as it is. */
  const touchSettings = (): void => {
    for (const listener of settingsListeners) listener()
  }
  /** Turns the switch without telling the module (as when it cannot observe the settings). */
  const setOnSilently = (value: boolean): void => {
    on = value
  }
  const setUnattended = (value: boolean): void => {
    forceUnattended = value
  }
  return { registry, tracker, orchestrators, continuer, open, write, session, sessionId, messages, notices, results, timers: moduleTimers, setOn, setOnSilently, touchSettings, setUnattended, releases, windowEvents, dataRoot }
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
    // The windows get the line below the error row it tells of.
    const errorRow = h.windowEvents.findIndex((event) => event.type === 'result' && event.isError)
    const line = h.windowEvents.findIndex((event) => event.type === 'notice' && event.text.startsWith('worfy: API error 529'))
    expect(errorRow).toBeGreaterThanOrEqual(0)
    expect(line).toBeGreaterThan(errorRow)

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

// ── the turn's boundaries, the guards at the timer, two Projects (review round 1) ─

describe('Auto-continue of a manual turn: turns without a prompt, the guards at the timer, two Projects (worfy-retry ticket 06)', () => {
  /** Runs the person's turn (a background push, a `rejected` 7-day status) and the task-notification turn that ends with a 529. */
  async function taskTurnWait(h: ReturnType<typeof harness>): Promise<void> {
    await h.open()
    h.write(PERSON)
    await until(() => h.results().length === 1, 'the turn that started the push')
    expect(h.results()).toEqual([false])
    // The task-notification turn: Claude Code starts it itself, with no prompt.
    h.releases.release('task')
    await until(() => h.session().state === 'busy', 'the turn of the task-notification')
    h.releases.release('end')
    await until(() => h.results().length === 2, 'the end of the task-notification turn')
  }

  it('a turn a background task starts is judged by its own calls and its own Limits status, not by the turn before', async () => {
    const h = harness({ script: 'orchestrator-continue-task-turn' })
    await taskTurnWait(h)
    await tick()
    // Not refused for the push of the turn before (no result there), not taken for a refusal by that turn's `rejected`.
    const at = START_MS + RETRY_DELAYS_MS[0]!
    expect(h.continuer.wait(PROJECT)).toEqual({ kind: 'retry', attempt: 1, of: MAX_RETRIES, error: 'overloaded', until: at })
    expect(h.timers.live().map((timer) => timer.at)).toEqual([at])
    expect(h.notices()).toEqual([`worfy: API error 529, retry 1 of ${MAX_RETRIES} at ${hhmm(at)}`])
    expect(h.messages()).toEqual([PERSON])
  })

  it('a turn under way when the timer fires takes the continuation\'s place: nothing is sent, a line says so, and its end decides', async () => {
    const h = harness({ script: 'orchestrator-continue-task-turn' })
    await taskTurnWait(h)
    await until(() => h.timers.live().length === 1, 'the wait for the continuation')
    const timer = h.timers.live()[0]!
    h.releases.release('task2')
    await until(() => h.session().state === 'busy', 'the second task-notification turn')
    clock = timer.at
    timer.fire()
    await tick()
    expect(h.continuer.wait(PROJECT)).toBeNull()
    expect(h.notices().at(-1)).toBe('worfy: a turn is under way; nothing was sent, its end decides')
    h.releases.release('end2')
    await until(() => h.results().length === 3, 'the end of the second task-notification turn')
    await tick(200)
    expect(h.results()).toEqual([false, true, false])
    expect(h.messages()).toEqual([PERSON])
    expect(h.timers.live()).toEqual([])
    expect(h.continuer.wait(PROJECT)).toBeNull()
  })

  it('at the timer: the switch found off sends nothing and says so, also when the module did not hear of the change', async () => {
    const h = harness({ script: 'orchestrator-continue-overloaded', observeSettings: false })
    await h.open()
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the wait for the continuation')
    const timer = h.timers.live()[0]!
    h.setOnSilently(false)
    clock = timer.at
    timer.fire()
    await tick(200)
    expect(h.messages()).toEqual([PERSON])
    expect(h.notices().at(-1)).toBe('worfy: Auto-continue is off; nothing was sent')
    expect(h.continuer.wait(PROJECT)).toBeNull()
  })

  it('at the timer: a Session a run has taken by then gets nothing from the module', async () => {
    const h = harness({ script: 'orchestrator-continue-overloaded' })
    await h.open()
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the wait for the continuation')
    const timer = h.timers.live()[0]!
    h.setUnattended(true)
    clock = timer.at
    timer.fire()
    await tick(200)
    expect(h.messages()).toEqual([PERSON])
    expect(h.notices()).toHaveLength(1)
    expect(h.continuer.wait(PROJECT)).toBeNull()
  })

  it('another setting of app-settings.json changed during the wait leaves it: one continuation follows', async () => {
    const h = harness({ script: 'orchestrator-continue-overloaded' })
    await h.open()
    h.write(PERSON)
    await until(() => h.timers.live().length === 1, 'the wait for the continuation')
    const timer = h.timers.live()[0]!
    h.touchSettings()
    await tick()
    expect(timer.cancelled).toBe(false)
    expect(h.continuer.wait(PROJECT)).toMatchObject({ kind: 'retry', attempt: 1 })
    clock = timer.at
    timer.fire()
    await until(() => h.results().length >= 2, 'the turn of the continuation')
    expect(h.messages()).toHaveLength(2)
    expect(h.messages()[1]!.startsWith(RETRY_START)).toBe(true)
    expect(h.notices()).not.toContain('worfy: Auto-continue is off; nothing was sent')
  })

  it('a turn the person interrupted is not continued, though the Limits refused during it and its error reads as the Limits', async () => {
    const h = harness({ script: 'orchestrator-continue-interrupted-limits' })
    await h.open()
    h.write(PERSON)
    await until(() => h.session().state === 'busy', 'the turn')
    await tick()
    await h.session().interrupt()
    await until(() => h.results().length === 1, 'the end of the interrupted turn')
    await tick(200)
    const end = h.windowEvents.find((event) => event.type === 'result')
    expect(end).toMatchObject({ type: 'result', isError: true, interrupted: true })
    expect(h.timers.all).toEqual([])
    expect(h.notices()).toEqual([])
    expect(h.messages()).toEqual([PERSON])
    expect(h.continuer.wait(PROJECT)).toBeNull()
  })

  it('two Projects: each Orchestrator waits on its own refusal, with its own Limits status, and gets only its own continuation', async () => {
    // limits.json stays empty: a refusal without a window of its own has no reset time to wait for.
    const h = harness({ script: (request) => (request.cwd === repoB ? 'orchestrator-continue-limits' : 'orchestrator-continue-limits-text'), feedLimits: false })
    await h.open(PROJECT)
    await h.open(PROJECT_B)
    // B is refused with the 7-day window and its reset.
    h.write(PERSON, PROJECT_B)
    await until(() => h.timers.live().length === 1, 'B to wait for the Limits')
    const waitB = { kind: 'limits', window: 'seven_day', until: RESET_MS + RESUME_MARGIN_MS }
    expect(h.continuer.wait(PROJECT_B)).toEqual(waitB)
    expect(h.continuer.wait(PROJECT)).toBeNull()
    // A is refused by the text alone: it does not borrow B's window, it tries again after RECHECK_MS.
    h.write(PERSON, PROJECT)
    await until(() => h.timers.live().length === 2, 'A to wait too')
    const untilA = START_MS + RECHECK_MS
    expect(h.continuer.wait(PROJECT)).toEqual({ kind: 'limits', window: null, until: untilA })
    expect(h.continuer.wait(PROJECT_B)).toEqual(waitB)
    await tick()
    expect(h.notices(PROJECT)).toEqual([`worfy: waiting for the Limits, no reset time reported, next try at ${hhmm(untilA)}`])
    expect(h.notices(PROJECT_B)).toEqual([`worfy: waiting for the Limits, resumes ${hhmm(RESET_MS + RESUME_MARGIN_MS)}`])

    // A's timer: A alone gets its continuation; B still waits.
    const timerA = h.timers.live().find((timer) => timer.at === untilA)!
    clock = untilA
    timerA.fire()
    await until(() => h.results(PROJECT).length >= 2, 'A\'s continuation turn')
    await tick()
    expect(h.messages(PROJECT)).toEqual([PERSON, continueText(START_MS, untilA)])
    expect(h.messages(PROJECT_B)).toEqual([PERSON])
    expect(h.continuer.wait(PROJECT)).toBeNull()
    expect(h.continuer.wait(PROJECT_B)).toEqual(waitB)
  })
})

// ── the app's wiring ─────────────────────────────────────────────────────────

describe("the app's wiring (app-orchestrators.ts): the switch of app-settings.json, the Orchestrators' views, the quit", () => {
  /** The app's Orchestrators and Auto-continue over a data folder of the test, the registry on the fake agent. */
  async function app() {
    const data = join(scratch, 'app-data')
    mkdirSync(join(data, PROJECT), { recursive: true })
    mkdirSync(join(scratch, 'claude-home'), { recursive: true })
    writeFileSync(join(data, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'repo', path: repo }], activeId: PROJECT }))
    writeFileSync(join(data, PROJECT, 'settings.json'), JSON.stringify({ actionTemplates: DEFAULT_ACTION_TEMPLATES }))
    vi.stubEnv('WORFY_DATA_DIR', data)
    vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
    const calls: FakeCall[] = []
    const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: fixtures, script: 'orchestrator-continue-overloaded', record: (call) => calls.push(call) }))
    registries.push(registry)
    stand.registry = registry
    const events: AgentEvent[] = []
    registry.observe((_sessionId, event) => events.push(event))
    // The pause goes by the wall clock (wallTimer, Date.now as the module takes it when made): the test
    // moves that clock, which otherwise runs with the real one.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    vi.resetModules()
    const wiring = await import('../../src/main/agent/app-orchestrators')
    const { appSettingsStore } = await import('../../src/main/settings/store')
    const view = await wiring.sharedOrchestrators().open(PROJECT)
    const session = () => registry.get(wiring.sharedOrchestrators().view(view.nodeId)!.sessionId!)
    await until(() => wiring.sharedOrchestrators().view(view.nodeId)?.sessionId != null && session().state === 'idle', 'the Orchestrator to be idle')
    const messages = () => calls.flatMap((call) => (call.kind === 'message' ? [call.text] : []))
    const notices = () => events.flatMap((event) => (event.type === 'notice' && event.kind === 'notification' ? [event.text] : []))
    const results = () => events.filter((event) => event.type === 'result').length
    const quit = () => {
      for (const listener of stand.listeners.get('will-quit') ?? []) listener()
    }
    return { wiring, store: appSettingsStore(), session, messages, notices, results, quit }
  }

  it('off in app-settings.json: the 529 waits for nothing, and nothing goes even two hours later', async () => {
    const a = await app()
    expect(a.store.autoContinue(PROJECT)).toBe(false)
    a.session().send(PERSON)
    await until(() => a.results() === 1, 'the turn with the error')
    await tick(100)
    expect(a.wiring.sharedOrchestratorContinue().wait(PROJECT)).toBeNull()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    await tick(100)
    expect(a.notices()).toEqual([])
    expect(a.messages()).toEqual([PERSON])
    a.quit()
  })

  it('on in app-settings.json: one continuation at the wall-clock time', async () => {
    const a = await app()
    a.store.setAutoContinue(PROJECT, true)
    a.session().send(PERSON)
    await until(() => a.notices().length === 1, 'the line of the wait')
    expect(a.notices()[0]).toMatch(/^worfy: API error 529, retry 1 of 5 at \d{2}:\d{2}$/u)
    expect(a.wiring.sharedOrchestratorContinue().wait(PROJECT)).toMatchObject({ kind: 'retry', attempt: 1, error: 'overloaded' })
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await until(() => a.results() >= 2, 'the turn of the continuation')
    expect(a.messages()).toHaveLength(2)
    expect(a.messages()[1]!.startsWith(RETRY_START)).toBe(true)
    a.quit()
  })

  it('turned off in Modes during the wait: the wait ends at once; on again, the quit ends the next one', async () => {
    const a = await app()
    a.store.setAutoContinue(PROJECT, true)
    a.session().send(PERSON)
    await until(() => a.notices().length === 1, 'the line of the wait')
    // The store's change ends the wait before its time comes.
    a.store.setAutoContinue(PROJECT, false)
    await tick(50)
    expect(a.notices().at(-1)).toBe('worfy: Auto-continue is off; nothing was sent')
    expect(a.wiring.sharedOrchestratorContinue().wait(PROJECT)).toBeNull()

    // On again: the script's next turn goes through, the one after it fails; then the app quits.
    a.store.setAutoContinue(PROJECT, true)
    a.session().send('Go on.')
    await until(() => a.results() === 2, 'the turn that goes through')
    a.session().send(PERSON)
    await until(() => a.wiring.sharedOrchestratorContinue().wait(PROJECT) !== null, 'the second wait')
    a.quit()
    expect(a.wiring.sharedOrchestratorContinue().wait(PROJECT)).toBeNull()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    await tick(100)
    expect(a.messages()).toEqual([PERSON, 'Go on.', PERSON])
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
