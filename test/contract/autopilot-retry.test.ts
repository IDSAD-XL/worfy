// Autopilot continues after a temporary API error (worfy-retry ticket 04) on the fake agent: the real
// Session registry, Orchestrators, launcher, run journal, cycle and LimitsTracker over a copy of an
// Epic in a temporary folder, as in autopilot-limits.test.ts. Auto-continue is the test's switch
// (AutopilotDeps.retry.enabled), the clock is fixed, the pause's timer is the test's and the jitter
// is fixed at the middle (random 0.5: each pause is the plan's own, 1, 5, 15, 30, 60 minutes).
// keep-awake is a fake, nothing calls the model.
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
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { Autopilot } from '../../src/main/autopilot/run'
import { LayoutStore } from '../../src/main/layout/store'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { MAX_RETRIES, RETRY_DELAYS_MS, retryDelay, retryText } from '../../src/shared/agent/continue-plan'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
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
const PROJECT = 'demo-000000b4'
const EPIC = 'demo'
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
/** 2026-10-05T06:10:00Z: the run's start; the times of the test go from it. */
const START_MS = 1791180600 * 1000
/** Any Cyrillic letter: what worfy sends an agent is English (ADR-0074, point 6). */
const CYRILLIC = /[Ѐ-ӿ]/u

let scratch: string
let repo: string
let clock: number
let registries: SessionRegistry[] = []
let autopilots: Autopilot[] = []

// ── the Epic in a temporary folder (Wave 1: 01 and 02; Wave 2: 03) ───────────

const TICKETS = [
  { num: 1, blocked: '—' },
  { num: 2, blocked: '—' },
  { num: 3, blocked: '01, 02' },
]
const nn = (num: number): string => String(num).padStart(2, '0')
const ticketPath = (num: number): string => join(repo, '.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`)

function writeTicket(num: number, status: string): void {
  const { blocked } = TICKETS.find((each) => each.num === num)!
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

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autopilot-retry-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  for (const { num } of TICKETS) writeTicket(num, 'open')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  clock = START_MS
})

afterEach(async () => {
  for (const autopilot of autopilots) await autopilot.stopAll()
  autopilots = []
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

// ── the harness ──────────────────────────────────────────────────────────────

async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 3000): Promise<void> {
  const end = Date.now() + ms(limit)
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

const tick = (wait = 50): Promise<void> => new Promise((done) => setTimeout(done, wait))

/** The lines of a fixture script, as objects. */
const scriptLines = (script: string): Record<string, unknown>[] =>
  readFileSync(join(fixtures, `${script}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

interface Timer {
  at: number
  fire: () => void
  cancelled: boolean
}

interface HarnessOptions {
  /** The fixture the run's Orchestrator plays (test/fixtures/agent-scripts). */
  script: string
  /** A variant of the script: its lines, written to a scripts folder of the test. */
  lines?: Record<string, unknown>[]
  /** Auto-continue for the Project at the start (default on). */
  on?: boolean
  /** Without AutopilotDeps.retry at all: the app before this ticket. */
  noRetry?: boolean
  /** The random number of each pause's spread (default 0.5: the pause itself). */
  random?: number
}

function harness(options: HarnessOptions) {
  const dataRoot = join(scratch, 'data-root')
  mkdirSync(dataRoot, { recursive: true })
  let scriptsDir = fixtures
  if (options.lines !== undefined) {
    scriptsDir = join(scratch, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(join(scriptsDir, `${options.script}.jsonl`), options.lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
    writeFileSync(join(scriptsDir, 'autopilot-waves.jsonl'), readFileSync(join(fixtures, 'autopilot-waves.jsonl'), 'utf8'))
  }
  const tracker = new LimitsTracker({ dataDir: dataRoot, now: () => clock })
  const calls: FakeCall[] = []
  const releases = new FakeReleases()
  const scriptOf = (request: QueryRequest): string => (request.unattended === true ? options.script : 'autopilot-waves')
  const registry = new SessionRegistry(
    tracker.observe((request) =>
      fakeQueryFactory({
        scriptsDir,
        script: scriptOf(request),
        releases,
        record: (call) => {
          if (request.unattended === true) calls.push(call)
        },
      })(request),
    ),
  )
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
  // The agent marks the Wave's Tickets done when its "Run wave" arrives.
  registry.observe((_sessionId, event) => {
    if (event.type === 'prompt' && event.text === WAVE_1) for (const num of [1, 2]) writeTicket(num, 'done — 2026-10-06')
  })
  const env = { WORFY_DATA_DIR: dataRoot }
  const timers: Timer[] = []
  const states: AutopilotState[] = []
  let on = options.on ?? true
  /** Whom the switch was asked for: the run reads it before each decision. */
  const asked: string[] = []
  const schedule = (at: number, fire: () => void): (() => void) => {
    const timer: Timer = { at, fire, cancelled: false }
    timers.push(timer)
    return () => {
      timer.cancelled = true
    }
  }
  const send = (sessionId: string, text: string): void => {
    registry.get(sessionId).send(text)
  }
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
    keepAwake: () => ({ start: () => undefined, stop: () => undefined }),
    onChange: (state) => states.push(state),
    settleMs: 60_000,
    limits: {
      state: () => tracker.snapshot(),
      observeSession: (isSession, listener) => observeSessionLimits((sink) => registry.observe(sink), isSession, listener),
      send,
      now: () => clock,
      schedule,
    },
    ...(options.noRetry === true
      ? {}
      : {
          retry: {
            enabled: (projectId: string) => {
              asked.push(projectId)
              return on
            },
            send,
            now: () => clock,
            schedule,
            random: () => options.random ?? 0.5,
          },
        }),
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  const journal = async (): Promise<JournalEvent[]> => {
    const runs = readdirSync(join(dataRoot, 'autopilot')).map((name) => name.replace(/\.jsonl$/, ''))
    expect(runs).toHaveLength(1)
    return (await readRun(runs[0]!, { env }))!.events
  }
  const kinds = async () => (await journal()).map((event) => event.kind)
  const messages = () => calls.filter((call): call is Extract<FakeCall, { kind: 'message' }> => call.kind === 'message').map((call) => call.text)
  const state = () => autopilot.state(PROJECT)
  const live = () => timers.filter((timer) => !timer.cancelled)
  const setOn = (value: boolean): void => {
    on = value
  }
  /** The state of the run's Orchestrator Session, the only live one. */
  const sessionState = () => registry.get(registry.list()[0]!.sessionId).state
  return { autopilot, orchestrators, timers, live, states, journal, kinds, messages, state, releases, setOn, asked, sessionState }
}

type Harness = ReturnType<typeof harness>

const iso = (at: number): string => new Date(at).toISOString()
/** The `turn-retry` lines of the journal. */
const retries = async (h: Harness) => (await h.journal()).filter((event): event is Extract<JournalEvent, { kind: 'turn-retry' }> => event.kind === 'turn-retry')
/** The texts the Orchestrator got that are continuations after an API error. */
const continuations = (h: Harness): string[] => h.messages().filter((text) => text.startsWith('The previous turn ended with a temporary API error'))
/** The 400 of the Anthropic API, in place of the 500 of autopilot-retry-500. */
const ERROR_400 = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"},"request_id":"req_fake_400"}'

/** Starts the run and waits for its first `turn-retry`. */
async function untilRetry(h: Harness, count = 1): Promise<void> {
  await until(async () => (await retries(h)).length >= count && h.state().status === 'waiting', `turn-retry ${count}`)
}

// ── the runs ─────────────────────────────────────────────────────────────────

describe('Autopilot continues after a temporary API error (worfy-retry ticket 04)', () => {
  it('off: a 500 stops the run with turn-error, as before the ticket; nothing waits and nothing more goes to the Orchestrator', async () => {
    for (const noRetry of [false, true]) {
      const h = harness({ script: 'autopilot-retry-500', on: false, noRetry })
      await h.autopilot.start(PROJECT, EPIC)
      await until(() => h.state().status === 'stopped', 'the run to stop')
      expect(h.state()).toMatchObject({ reason: 'turn-error', wave: 1 })
      expect(h.state().message).toMatch(/^API Error: 500 /u)
      const kinds = await h.kinds()
      expect(kinds).not.toContain('turn-retry')
      expect(kinds).not.toContain('retry-refused')
      expect(kinds.slice(0, 2)).toEqual(['run-started', 'wave-started'])
      expect(kinds).toContain('session-error')
      expect((await h.journal()).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'turn-error' })
      expect(h.messages()).toEqual([WAVE_1])
      expect(h.timers).toEqual([])
      if (noRetry) expect(h.asked).toEqual([])
      else expect(h.asked).toEqual([PROJECT])
      for (const autopilot of autopilots) await autopilot.stopAll()
      autopilots = []
      for (const registry of registries) registry.closeAll()
      registries = []
      await rm(join(scratch, 'data-root'), { recursive: true, force: true })
      for (const { num } of TICKETS) writeTicket(num, 'open')
    }
  })

  it('on: a 500 gives turn-retry 1 of 5; at the timer the Orchestrator gets one continuation without the Wave command, and the run goes on', async () => {
    const h = harness({ script: 'autopilot-retry-500' })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)

    const until1 = START_MS + RETRY_DELAYS_MS[0]!
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'retry', retry: { attempt: 1, of: MAX_RETRIES }, resumesAt: until1, wave: 1, reason: null })
    expect(autopilotStateSchema.parse(h.state())).toEqual(h.state())
    expect(autopilotStatusLine(h.state(), { timeZone: 'UTC' })).toBe('API error · retry 1/5 · 06:11')
    const [line] = await retries(h)
    expect(line).toMatchObject({ attempt: 1, of: 5, error: 'api-500', until: iso(until1) })
    expect(line!.message).toMatch(/^API Error: 500 \{"type":"error","error":\{"type":"api_error"/u)
    expect(h.live().map((timer) => timer.at)).toEqual([until1])
    await tick()
    expect(h.messages()).toEqual([WAVE_1])

    // The timer: one continuation, even if it fires twice.
    clock = until1
    const timer = h.live()[0]!
    timer.fire()
    timer.fire()
    await until(() => h.messages().length >= 2, 'the continuation')
    const continuation = h.messages()[1]!
    expect(continuation).toBe(retryText({ attempt: 1, of: MAX_RETRIES, error: 'api-500', actions: [] }))
    expect(continuation).not.toMatch(/epic-wave/u)
    expect(continuation).not.toMatch(CYRILLIC)

    // The continuation's turn went through: Wave 1 is finished, Wave 2 goes (its own new Session fails again).
    await until(async () => (await retries(h)).length >= 2, 'the turn-retry of Wave 2')
    expect(h.messages().filter((text) => text === WAVE_1)).toHaveLength(1)
    expect(continuations(h)).toHaveLength(1)
    expect(h.state()).toMatchObject({ status: 'waiting', wave: 2, retry: { attempt: 1, of: 5 } })
    await h.autopilot.forceStop(PROJECT)
    const kinds = await h.kinds()
    const wave1 = kinds.slice(0, kinds.indexOf('wave-finished') + 1)
    expect(wave1.filter((kind) => kind !== 'ticket-status')).toEqual(['run-started', 'wave-started', 'turn-retry', 'resumed', 'wave-finished'])
    expect(kinds.slice(-3)).toEqual(['turn-retry', 'run-stopped', 'orchestrator-returned'])
    expect(h.live()).toEqual([])
  })

  it('on: 529 again and again — pauses of 1, 5, 15, 30 and 60 minutes, then retry-refused cap and turn-error', async () => {
    // The spread at its low end: each pause is the plan's less 20 %.
    const h = harness({ script: 'autopilot-retry-overloaded-5', random: 0 })
    await h.autopilot.start(PROJECT, EPIC)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      await untilRetry(h, attempt)
      const timer = h.live().at(-1)!
      expect(h.live()).toHaveLength(1)
      expect(timer.at - clock).toBe(retryDelay(attempt, 0))
      expect(timer.at - clock).toBe(Math.round(RETRY_DELAYS_MS[attempt - 1]! * 0.8))
      expect(h.state()).toMatchObject({ waitingFor: 'retry', retry: { attempt, of: 5 }, resumesAt: timer.at })
      // The timer of the retry before fires late: it sends nothing for this wait.
      if (attempt > 1) {
        h.timers.at(-2)!.fire()
        await tick()
        expect(continuations(h)).toHaveLength(attempt - 1)
      }
      clock = timer.at
      timer.fire()
      await until(() => continuations(h).length === attempt, `continuation ${attempt}`)
    }
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.state()).toMatchObject({ reason: 'turn-error' })
    expect(h.state().message).toMatch(/^API Error: 529 .*gave up after 5 retries/su)
    const events = await h.journal()
    expect(events.filter((event) => event.kind === 'turn-retry').map((event) => [event.attempt, event.error])).toEqual([1, 2, 3, 4, 5].map((attempt) => [attempt, 'overloaded']))
    expect(events.filter((event) => event.kind === 'retry-refused')).toMatchObject([{ reason: 'cap' }])
    const kinds = events.map((event) => event.kind)
    expect(kinds.slice(kinds.indexOf('retry-refused')).filter((kind) => kind !== 'ticket-status')).toEqual(['retry-refused', 'session-error', 'run-stopped'])
    expect(continuations(h)).toEqual([1, 2, 3, 4, 5].map((attempt) => retryText({ attempt, of: 5, error: 'overloaded', actions: [] })))
    expect(h.messages().filter((text) => text === WAVE_1)).toHaveLength(1)
  })

  it('on: a 400 is no temporary error — retry-refused not-transient, turn-error, no continuation', async () => {
    const lines = scriptLines('autopilot-retry-500').map((line) => (line.type === 'result' && line.is_error === true ? { ...line, result: ERROR_400 } : line))
    const h = harness({ script: 'autopilot-retry-500', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.state()).toMatchObject({ reason: 'turn-error', message: ERROR_400 })
    const events = await h.journal()
    expect(events.filter((event) => event.kind === 'retry-refused')).toMatchObject([{ reason: 'not-transient' }])
    expect(events.find((event) => event.kind === 'retry-refused')).not.toHaveProperty('actions')
    expect(events.map((event) => event.kind)).not.toContain('turn-retry')
    expect(h.messages()).toEqual([WAVE_1])
    expect(h.timers).toEqual([])
  })

  it('on: a git push without its result, then a 500 — retry-refused in-flight names the push, turn-error, no continuation', async () => {
    const h = harness({ script: 'autopilot-retry-in-flight' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.state()).toMatchObject({ reason: 'turn-error' })
    const events = await h.journal()
    expect(events.filter((event) => event.kind === 'retry-refused')).toMatchObject([{ reason: 'in-flight', actions: ['git push origin demo/01'] }])
    expect(events.map((event) => event.kind)).not.toContain('turn-retry')
    expect(h.messages()).toEqual([WAVE_1])
    expect(h.timers).toEqual([])
  })

  it('on: the journal keeps no secret of a push in flight — a token in its URL is written as ***', async () => {
    const token = `ghp_${'a1'.repeat(12)}`
    const lines = scriptLines('autopilot-retry-in-flight').map((line) => {
      if (line.type !== 'assistant') return line
      const text = JSON.stringify(line).replace('git push origin demo/01', `git push https://bot:${token}@git.example.org/o/r.git main`)
      return JSON.parse(text) as Record<string, unknown>
    })
    const h = harness({ script: 'autopilot-retry-in-flight', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'stopped', 'the run to stop')
    const refused = (await h.journal()).find((event) => event.kind === 'retry-refused')
    expect(refused).toMatchObject({ reason: 'in-flight' })
    expect(JSON.stringify(refused)).not.toContain(token)
    expect(refused).toMatchObject({ actions: [expect.stringMatching(/^git push https:\/\/bot:\*\*\*@git\.example\.org/u)] })
  })

  it('on: each continuation names the actions of the turn that failed, not of an earlier one', async () => {
    // Turn 1 pushes (with its result) and fails with a 500; the continuation's turn does nothing and fails again.
    const [wait, init, push] = scriptLines('autopilot-retry-in-flight')
    const failed = scriptLines('autopilot-retry-500').find((line) => line.type === 'result' && line.is_error === true)!
    const result = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_retry_push', content: 'pushed', is_error: false }] }, parent_tool_use_id: null, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000499' }
    const lines = [wait!, init!, push!, result, failed, wait!, init!, failed]
    const h = harness({ script: 'autopilot-retry-in-flight', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    clock = h.live()[0]!.at
    h.live()[0]!.fire()
    await untilRetry(h, 2)
    clock = h.live()[0]!.at
    h.live()[0]!.fire()
    await until(() => continuations(h).length === 2, 'the second continuation')
    const pushed = [{ toolUseId: 'toolu_retry_push', tool: 'Bash', description: 'git push origin demo/01', done: true, known: true }]
    expect(continuations(h)).toEqual([retryText({ attempt: 1, of: 5, error: 'api-500', actions: pushed }), retryText({ attempt: 2, of: 5, error: 'api-500', actions: [] })])
    expect(continuations(h)[0]).toContain('`git push origin demo/01`')
    await h.autopilot.forceStop(PROJECT)
  })

  it('on: a Stop clicked as the timer fires wins — the run ends with user-stop and the continuation does not go', async () => {
    const h = harness({ script: 'autopilot-retry-500' })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    const timer = h.live()[0]!
    clock = timer.at
    // The timer's step is queued first, the Stop's right behind it.
    timer.fire()
    const stopped = await h.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    await tick()
    expect(h.messages()).toEqual([WAVE_1])
    expect(await h.kinds()).not.toContain('resumed')
  })

  it('on: a refusal by the Limits is no retry — limits-hit and waiting-until, as before', async () => {
    const h = harness({ script: 'autopilot-limits' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')
    expect(h.state()).toMatchObject({ waitingFor: 'limits' })
    expect(h.state()).not.toHaveProperty('retry')
    const kinds = await h.kinds()
    expect(kinds).toEqual(['run-started', 'wave-started', 'limits-hit', 'waiting-until'])
    await h.autopilot.forceStop(PROJECT)
  })

  it('on: a turn of a background task during the wait holds the timer, and going through ends the wait — no continuation', async () => {
    // The turn of the first implementer's report holds until the test lets it end.
    const lines = scriptLines('autopilot-fault-api-500')
    const report = lines.findIndex((line) => line.type === 'result' && line.is_error === false)
    lines.splice(report, 0, { fake: 'wait_release', name: 'turn' })
    const h = harness({ script: 'autopilot-fault-api-500', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    const timer = h.live()[0]!
    // The first implementer reports: its turn starts and is under way when the timer fires.
    h.releases.release('tasks')
    await until(() => h.sessionState() === 'busy', 'the turn of the report')
    clock = timer.at
    timer.fire()
    // The fire during the turn ends the wait: the Canvas shows the run running, not a retry due in the past.
    await until(() => h.state().status === 'running', 'the wait to end at the fire')
    expect(continuations(h)).toEqual([])
    expect(h.state()).not.toHaveProperty('retry')
    expect(h.state()).not.toHaveProperty('waitingFor')
    expect(h.state().resumesAt).toBeNull()
    // …and so does the state the Canvas got last.
    await until(() => h.states.at(-1)?.status === 'running', 'the running state to be published')
    expect(h.states.at(-1)).not.toHaveProperty('retry')
    expect((await h.kinds()).filter((kind) => kind === 'turn-retry' || kind === 'resumed')).toEqual(['turn-retry', 'resumed'])
    // The turn goes through: nothing waits, and no second resumed.
    h.releases.release('turn')
    await until(() => h.sessionState() === 'idle', 'the turn of the report to end')
    await tick()
    expect(h.state()).toMatchObject({ status: 'running' })
    expect(timer.cancelled).toBe(true)
    expect((await h.kinds()).filter((kind) => kind === 'turn-retry' || kind === 'resumed')).toEqual(['turn-retry', 'resumed'])
    // A late fire of the old timer sends nothing and stops nothing, the switch off or not.
    h.setOn(false)
    timer.fire()
    await tick()
    expect(continuations(h)).toEqual([])
    expect(h.messages()).toEqual([WAVE_1])
    expect(h.state()).toMatchObject({ status: 'running' })
    // The second implementer reports: the Wave is finished.
    h.releases.release('tasks')
    await until(async () => (await h.kinds()).includes('wave-finished'), 'the end of Wave 1')
    expect(continuations(h)).toEqual([])
    await h.autopilot.forceStop(PROJECT)
  })

  it('on: a turn of a background task that goes through before the timer ends the wait with resumed — no continuation', async () => {
    const h = harness({ script: 'autopilot-fault-api-500' })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    const timer = h.live()[0]!
    // The first implementer reports, and its turn ends without an error before the timer is due.
    h.releases.release('tasks')
    await until(() => h.state().status === 'running', 'the wait to end')
    expect(timer.cancelled).toBe(true)
    expect(h.state()).not.toHaveProperty('retry')
    await until(async () => (await h.kinds()).includes('resumed'), 'the resumed of the wait')
    const kinds = await h.kinds()
    expect(kinds.filter((kind) => kind === 'turn-retry' || kind === 'resumed')).toEqual(['turn-retry', 'resumed'])
    expect(continuations(h)).toEqual([])
    await h.autopilot.forceStop(PROJECT)
  })

  it('on: Stop during the wait ends the run with user-stop at once; the continuation never goes', async () => {
    const h = harness({ script: 'autopilot-retry-500' })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    const timer = h.live()[0]!
    const stopped = await h.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(timer.cancelled).toBe(true)
    clock = timer.at
    timer.fire()
    await tick()
    expect(h.messages()).toEqual([WAVE_1])
    const kinds = await h.kinds()
    expect(kinds).toContain('turn-retry')
    expect(kinds).not.toContain('resumed')
    expect((await h.journal()).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'user-stop' })
  })

  it('on: the quit and the Force stop during the wait cancel the timer; the continuation never goes', async () => {
    for (const how of ['quit', 'force'] as const) {
      const h = harness({ script: 'autopilot-retry-500' })
      await h.autopilot.start(PROJECT, EPIC)
      await untilRetry(h)
      const timer = h.live()[0]!
      if (how === 'quit') await h.autopilot.stopAll()
      else await h.autopilot.forceStop(PROJECT)
      expect(h.state()).toMatchObject({ status: 'stopped', reason: how === 'quit' ? 'app-quit' : 'user-force-stop' })
      expect(timer.cancelled).toBe(true)
      clock = timer.at
      timer.fire()
      await tick()
      expect(h.messages()).toEqual([WAVE_1])
      expect(await h.kinds()).not.toContain('resumed')
      for (const autopilot of autopilots) await autopilot.stopAll()
      autopilots = []
      for (const registry of registries) registry.closeAll()
      registries = []
      await rm(join(scratch, 'data-root'), { recursive: true, force: true })
      for (const { num } of TICKETS) writeTicket(num, 'open')
      clock = START_MS
    }
  })

  it('on, then off during the wait: at the timer the wait is dropped and the error ends the run with turn-error; no continuation', async () => {
    const h = harness({ script: 'autopilot-retry-500' })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    h.setOn(false)
    const timer = h.live()[0]!
    clock = timer.at
    timer.fire()
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.state()).toMatchObject({ reason: 'turn-error' })
    expect(h.state().message).toMatch(/^API Error: 500 /u)
    expect(h.messages()).toEqual([WAVE_1])
    const kinds = await h.kinds()
    expect(kinds).not.toContain('resumed')
    expect(kinds.slice(kinds.indexOf('turn-retry')).filter((kind) => kind !== 'ticket-status')).toEqual(['turn-retry', 'session-error', 'run-stopped'])
  })

  it('on: a refusal by the Limits during the wait ends the retry — the Limits wait alone goes on, and the retry timer sends nothing', async () => {
    // The Wave's turn fails with a 500; the turn of the first implementer's report is refused by the Limits.
    const lines = scriptLines('autopilot-fault-api-500')
    const limits = scriptLines('autopilot-limits')
    const refusal = limits.slice(2, 5)
    const report = lines.findIndex((line) => line.type === 'assistant' && JSON.stringify(line).includes('msg_background_2'))
    lines.splice(report, 2, ...refusal)
    const h = harness({ script: 'autopilot-fault-api-500', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    const timer = h.live()[0]!
    h.releases.release('tasks')
    await until(async () => (await h.kinds()).includes('waiting-until'), 'the wait for the Limits')
    expect(timer.cancelled).toBe(true)
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'limits' })
    expect(h.state()).not.toHaveProperty('retry')
    // The retry timer fires anyway (it was due first): nothing goes, and the Limits wait stays open.
    clock = timer.at
    timer.fire()
    await tick()
    expect(continuations(h)).toEqual([])
    expect(h.messages()).toEqual([WAVE_1])
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'limits' })
    const kinds = await h.kinds()
    expect(kinds.slice(kinds.indexOf('turn-retry')).filter((kind) => kind !== 'ticket-status' && kind !== 'background-tasks')).toEqual(['turn-retry', 'limits-hit', 'waiting-until'])
    await h.autopilot.forceStop(PROJECT)
  })

  it.each([
    ['vercel --token abcd1234efgh5678ijkl deploy', 'abcd1234efgh5678ijkl'],
    ['mytool --password hunter2secret run', 'hunter2secret'],
  ])('on: the journal keeps no secret option of a command in flight — %s', async (command, secret) => {
    const lines = scriptLines('autopilot-retry-in-flight').map((line) => {
      if (line.type !== 'assistant') return line
      return JSON.parse(JSON.stringify(line).replace('git push origin demo/01', command)) as Record<string, unknown>
    })
    const h = harness({ script: 'autopilot-retry-in-flight', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'stopped', 'the run to stop')
    const refused = (await h.journal()).find((event) => event.kind === 'retry-refused')
    expect(refused).toMatchObject({ reason: 'in-flight' })
    expect(JSON.stringify(refused)).not.toContain(secret)
    expect(refused).toMatchObject({ actions: [command.replace(secret, '***')] })
  })

  it('on: a second Stop while stopping ends a retry wait at once with user-stop', async () => {
    // The Wave's turn holds; the first Stop makes the run stopping; that turn and the Stop's turn fail with a 500.
    const [wait, init, failed] = scriptLines('autopilot-retry-500')
    const lines = [wait!, init!, { fake: 'wait_release', name: 'turn' }, failed!, wait!, init!, failed!]
    const h = harness({ script: 'autopilot-retry-500', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.sessionState() === 'busy', 'the Wave turn')
    const first = await h.autopilot.stop(PROJECT)
    expect(first).toMatchObject({ stopping: true })
    h.releases.release('turn')
    await until(async () => (await retries(h)).length >= 2 && h.state().status === 'waiting', 'the wait after the Stop turn')
    expect(h.state()).toMatchObject({ waitingFor: 'retry', stopping: true })
    const timer = h.live().at(-1)!
    const second = await h.autopilot.stop(PROJECT)
    expect(second).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(timer.cancelled).toBe(true)
    expect((await h.journal()).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'user-stop' })
  })

  it('on: a Stop while a turn is under way during the wait is graceful — the run goes stopping, not stopped', async () => {
    const lines = scriptLines('autopilot-fault-api-500')
    const report = lines.findIndex((line) => line.type === 'result' && line.is_error === false)
    lines.splice(report, 0, { fake: 'wait_release', name: 'turn' })
    const h = harness({ script: 'autopilot-fault-api-500', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await untilRetry(h)
    h.releases.release('tasks')
    await until(() => h.sessionState() === 'busy', 'the turn of the report')
    const stopped = await h.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ stopping: true })
    expect(stopped.status).not.toBe('stopped')
    expect(await h.kinds()).toContain('run-stopping')
    await h.autopilot.forceStop(PROJECT)
  })

  it('on: a 500 of the Wave turn that ends after a Force stop starts no wait', async () => {
    const [wait, init, failed] = scriptLines('autopilot-retry-500')
    const lines = [wait!, init!, { fake: 'wait_release', name: 'turn' }, failed!]
    const h = harness({ script: 'autopilot-retry-500', lines })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.sessionState() === 'busy', 'the Wave turn')
    await h.autopilot.forceStop(PROJECT)
    h.releases.release('turn')
    await until(() => h.sessionState() === 'idle', 'the turn to end')
    await tick()
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'user-force-stop' })
    expect(h.timers).toEqual([])
    expect(await h.kinds()).not.toContain('turn-retry')
  })

  it('on: the timer fired just before a Force stop or the quit sends nothing', async () => {
    for (const how of ['quit', 'force'] as const) {
      const h = harness({ script: 'autopilot-retry-500' })
      await h.autopilot.start(PROJECT, EPIC)
      await untilRetry(h)
      const timer = h.live()[0]!
      clock = timer.at
      // The timer's step is queued first; the Force stop and the quit go ahead of the run's order.
      timer.fire()
      if (how === 'quit') await h.autopilot.stopAll()
      else await h.autopilot.forceStop(PROJECT)
      await tick()
      expect(h.state()).toMatchObject({ status: 'stopped', reason: how === 'quit' ? 'app-quit' : 'user-force-stop' })
      expect(h.messages()).toEqual([WAVE_1])
      expect(await h.kinds()).not.toContain('resumed')
      for (const autopilot of autopilots) await autopilot.stopAll()
      autopilots = []
      for (const registry of registries) registry.closeAll()
      registries = []
      await rm(join(scratch, 'data-root'), { recursive: true, force: true })
      for (const { num } of TICKETS) writeTicket(num, 'open')
      clock = START_MS
    }
  })
})
