// The common setup of the Fault scenarios of an Autopilot Run (worfy-faults ticket 02): faultRun()
// builds the real Session registry, Orchestrators, launcher, run journal, cycle, LimitsTracker,
// PrTracker and Autopilot over the fake agent and a temporary git Project, the way harness() of
// test/contract/autopilot-limits.test.ts does (that file is not imported: a test file is no library).
// A scenario injects one fault through a script of the fake agent, and then hands what the Run left
// behind to checkRecovery (test/autopilot-invariants.ts) through recovery().
//
// - The Project: a git repository with Epic `demo` — Tickets 01 and 02 ready (Wave 1), 03 blocked by
//   both (Wave 2). The agent "does" a Wave by writing its Tickets' `Status:` when the Wave's command
//   reaches it (`marks`); every such write is a StatusWrite for I3 and a change the workflow watch
//   reports. `.git` is left out of the Project's snapshot: git keeps its own files there.
// - The agent: each Claude Code process plays a script of test/fixtures/agent-scripts, or lines the
//   test gives. The unattended Sessions play `scripts` in start order, the last one for every later
//   Session (the second Wave of a run and the next run both start a new one); attended Sessions play
//   `attendedScript`. `processes` puts a Claude process stub (claude-process-stub.ts) behind each
//   query, for the check that no process is left; the death of Claude Code itself is the script's
//   `crash` directive, not a signal.
// - The clock: one clock of the test (FaultClock) is the Limits' clock and timer, the PR tracker's
//   clock, the clock of the run's PR reads and of its background-task limits. Nothing on it moves
//   unless the test moves it. The settle limit (`settleMs`) and the journal's times stay real.
// - GitHub: the run reads PRs through its own PrTracker over the gh stand-in (gh-world.ts), so every
//   gh call lands in the stand-in's log for I2. `prs: false` gives the run no PR reads at all.
// - The Vendor: `claude` (default) or `codex` — the Project's Orchestrator then runs on the fake
//   Codex app-server (WORFY_CODEX=fake from test/setup-contract.ts) with a CODEX_HOME of the test;
//   its approval of the Harness's hooks is not checked here (codex-orchestrator.test.ts checks it).
// - Auto-continue (`autoContinue`, worfy-retry ticket 09): off unless asked; on, the pause before a
//   continuation after a temporary API error is a timer on the test's clock, as the Limits wait is.
//
// A test file that imports this module mocks `electron` as autopilot-faults-api.test.ts does. The
// module's afterEach stops every run, closes every Session, kills every stub and fake process and
// removes the temporary folders, whether the test passed or not.
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { fakeQueryFactory, FakeReleases, type FakeCall } from '../../src/main/agent/fake-query'
import { LimitsTracker, observeSessionLimits } from '../../src/main/agent/limits'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, STATIC_CLAUDE_PARTS, type QueryRequest } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun } from '../../src/main/autopilot/journal'
import { Autopilot, type TasksClock } from '../../src/main/autopilot/run'
import { ghRunner, PrTracker } from '../../src/main/github/prs'
import { LayoutStore } from '../../src/main/layout/store'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { CODEX_CAPABILITIES, codexCapabilities } from '../../src/main/vendors/codex/capabilities'
import { codexCommands } from '../../src/main/vendors/codex/commands'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { DEFAULT_SETTINGS, type SessionSettings } from '../../src/shared/agent/settings'
import { parseJournal, type JournalEvent, type TicketStatusState } from '../../src/shared/autopilot/journal'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { CLAUDE_CAPABILITIES, type Capabilities } from '../../src/shared/vendors/capabilities'
import type { VendorId } from '../../src/shared/vendors/vendor'
import type { RecoveryExpect, RecoveryInput, StatusWrite } from '../autopilot-invariants'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'
import { StubProcesses, type StubKind } from './claude-process-stub'
import { ghWorld, STUB_COMMAND, type GhWorld, type StubAccount } from './gh-world'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
export const AGENT_SCRIPTS = join(REPO_ROOT, 'test', 'fixtures', 'agent-scripts')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

export const PROJECT = 'demo-000000f2'
export const EPIC = 'demo'

/** The reset of the refused 5-hour window in autopilot-limits.jsonl: 2026-10-05T07:10:00Z. */
export const LIMITS_RESET_MS = 1791184200 * 1000
/** The test's clock starts an hour before that reset. */
export const START_MS = LIMITS_RESET_MS - 3_600_000

/** A script of the fake agent: a fixture's name in test/fixtures/agent-scripts, or its lines. */
export type FaultScript = string | readonly Record<string, unknown>[]

/** What the agent writes into the Tickets of a Wave when the Wave's command reaches it; `none`: the test writes them. */
export type FaultMarks = 'done' | 'claimed' | 'none'

export interface FaultPrs {
  /** The gh accounts the stand-in knows (gh-world.ts); none by default — `pr list` needs none. */
  accounts?: readonly StubAccount[]
  /** prs.json of the stand-in: the repository's PRs, newest first; none by default. */
  pulls?: readonly Record<string, unknown>[]
  /** How long one gh call may take (ghRunner's timeoutMs; default 15 s times the run's multiplier). */
  timeoutMs?: number
  /** The tracker's intervals (PrTracker's baseIntervalMs and maxIntervalMs; default its own). */
  baseIntervalMs?: number
  maxIntervalMs?: number
  /** How often the run reads the PRs on the test's clock (AutopilotDeps.prsEveryMs; default the tracker's interval). */
  everyMs?: number
  /** The limit of the last read before run-stopped on the test's clock (AutopilotDeps.endReadMs). */
  endReadMs?: number
}

export interface FaultRunOptions {
  /** The scripts of the unattended Sessions in start order, the last for every later one (default autopilot-waves). */
  scripts?: readonly FaultScript[]
  /** The script of every attended Session (default autopilot-waves). */
  attendedScript?: FaultScript
  /** Default `done`. */
  marks?: FaultMarks
  /** A Claude process stub of this kind behind every Claude Code query; none by default. */
  processes?: StubKind | ((n: number, request: QueryRequest) => StubKind)
  /** The run's PR reads over the gh stand-in (default: on, with an empty gh world); false: no PR reads. */
  prs?: FaultPrs | false
  /** The Vendor of the Project's Orchestrator (default claude). */
  vendor?: VendorId
  /** With `codex`: the fake Codex script of each app-server process in start order, the last for every later one. */
  codexScripts?: readonly string[]
  /** How long a run settles before wave-unfinished, real time (default 60 s). */
  settleMs?: number
  /** The background-task limits on the test's clock (AutopilotDeps.backgroundStallMs, tasksGraceMs). */
  backgroundStallMs?: number
  tasksGraceMs?: number
  /** How long a Stop waits for the interrupted turn before the process is closed (default 100 ms). */
  haltTurnMs?: number
  /**
   * Auto-continue on for the Project (worfy-retry ticket 09): the run gets AutopilotDeps.retry with the
   * switch on, the pause's timer on the test's clock and no spread (each pause is the plan's own: 1, 5,
   * 15, 30, 60 minutes). Absent or false: no `retry` at all, the run as before worfy-retry.
   */
  autoContinue?: boolean
  /** Gets each view the Orchestrators publish (the app gives it to Auto-continue of a manual turn, worfy-retry ticket 08). */
  publish?: (view: OrchestratorView) => void
}

// ── the clock of the test ────────────────────────────────────────────────────

interface ClockTimer {
  id: number
  at: number
  fire: () => void
  /** The delay it was set with (setTimeout), null for one set for a time (schedule). */
  ms: number | null
}

/**
 * The test's clock: `now` moves only when the test moves it, and the timers set on it fire only then.
 * It is the run's TasksClock (setTimeout/clearTimeout) and the Limits' `schedule`.
 */
export class FaultClock implements TasksClock {
  private next = 1
  private readonly timers = new Map<number, ClockTimer>()
  constructor(public now: number) {}
  setTimeout = (fire: () => void, delay: number): number => this.add(this.now + delay, fire, delay)
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }
  schedule = (at: number, fire: () => void): (() => void) => {
    const id = this.add(at, fire, null)
    return () => {
      this.timers.delete(id)
    }
  }
  /** The timers now set, earliest first. */
  pending(): { at: number; ms: number | null }[] {
    return [...this.timers.values()].sort((a, b) => a.at - b.at).map(({ at, ms: delay }) => ({ at, ms: delay }))
  }
  /** Moves the clock by `delay` and fires, earliest first, the timers due by then; a timer set while they fire waits for the next move. */
  advance(delay: number): void {
    this.advanceTo(this.now + delay)
  }
  advanceTo(at: number): void {
    this.now = Math.max(this.now, at)
    const due = [...this.timers.values()].filter((timer) => timer.at <= this.now).sort((a, b) => a.at - b.at)
    for (const timer of due) {
      if (!this.timers.delete(timer.id)) continue
      timer.fire()
    }
  }
  private add(at: number, fire: () => void, delay: number | null): number {
    const id = this.next++
    this.timers.set(id, { id, at, fire, ms: delay })
    return id
  }
}

// ── what every faultRun leaves for the afterEach ─────────────────────────────

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  // In reverse: the runs stop before their Sessions close, the processes die before the folders go.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Waits until `condition` holds, polling every 10 ms; throws after `limit` ms (times the run's multiplier). */
export async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 5000): Promise<void> {
  const end = Date.now() + ms(limit)
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

// ── the Project ──────────────────────────────────────────────────────────────

const TICKETS = [
  { num: 1, blocked: '—' },
  { num: 2, blocked: '—' },
  { num: 3, blocked: '01, 02' },
] as const

const nn = (num: number): string => String(num).padStart(2, '0')

/** The journal's state of a `Status:` value, as the run reads it. */
function stateOf(status: string): TicketStatusState {
  const word = status.split(/\s/)[0]!.toLowerCase()
  if (word === 'done' || word === 'claimed' || word === 'blocked') return word
  return 'open'
}

/** `epic-status --json` over the Epic's Tickets, as the real script reads them. */
const runner: EpicStatusRunner = (cwd) => {
  const dir = join(cwd, '.scratch', EPIC, 'issues')
  const tickets = readdirSync(dir)
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name), 'utf8')
      const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text)?.[1] ?? null
      const status = field('Status')
      const blocked = field('Blocked by')
      const state = { done: 'done', claimed: 'work', blocked: 'blocked', open: 'open' }[stateOf(status ?? '')]
      const nums = blocked && blocked !== '—' ? blocked.split(',').map((each) => Number(each.trim())) : []
      const match = /^(\d+)-(.*)\.md$/.exec(name)!
      return { epic: EPIC, num: Number(match[1]), slug: match[2], title: text.split('\n')[0]!.replace(/^#\s*/, ''), statusRaw: status, state, blockedRaw: blocked, blockedNums: nums, blockedParsed: true }
    })
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets }))
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=worfy test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' })
}

/** Every file of `root` but `.git`: path → bytes as base64. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(root, path)] = readFileSync(path).toString('base64')
    }
  }
  walk(root)
  return out
}

// ── the setup ────────────────────────────────────────────────────────────────

/** The texts of a fake Codex log's `turn/start` requests. */
function codexTurnTexts(log: string): string[] {
  let text: string
  try {
    text = readFileSync(log, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { method?: string; params?: { input?: { type?: string; text?: string }[] } })
    .filter((each) => each.method === 'turn/start')
    .map((each) => (each.params?.input ?? []).flatMap((item) => (item.type === 'text' && item.text !== undefined ? [item.text] : [])).join('\n'))
}

export function faultRun(options: FaultRunOptions = {}) {
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-autopilot-faults-')))
  // The PR reads the run started that have not ended yet. A Force stop or the quit does not wait for them
  // (Autopilot's endRead drops the answer, pollPrs never awaited it), so their gh stand-in may still be
  // starting when the run has stopped, and its first act is a line in gh/calls.jsonl. Removing the
  // folder under it failed with ENOTEMPTY (worfy-polish ticket 90). A read settles only once each of
  // its gh processes has exited (ghRunner answers on the process's close), so the folder goes after
  // the last of them.
  const prReads = new Set<Promise<unknown>>()
  cleanups.push(async () => {
    while (prReads.size > 0) await Promise.allSettled([...prReads])
    removeTestTree(scratch)
  })
  const repo = join(scratch, 'repo')
  const dataRoot = join(scratch, 'data-root')
  const env = { WORFY_DATA_DIR: dataRoot }
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(dataRoot, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  const ticketFile = (num: number): string => join('.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`)
  const ticketText = (num: number, status: string): string => {
    const { blocked } = TICKETS.find((each) => each.num === num)!
    return [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
  }
  for (const { num } of TICKETS) writeFileSync(join(repo, ticketFile(num)), ticketText(num, 'open'))
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'demo')
  const projectBefore = snapshot(repo)

  const clock = new FaultClock(START_MS)
  const vendor: VendorId = options.vendor ?? 'claude'

  // The scripts: a fixture by name, or the test's lines written into a folder of its own.
  const scriptsDir = join(scratch, 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  let written = 0
  const placed = (script: FaultScript): { dir: string; name: string } => {
    if (typeof script === 'string') return { dir: AGENT_SCRIPTS, name: script }
    const name = `script-${++written}`
    writeFileSync(join(scriptsDir, `${name}.jsonl`), script.map((line) => JSON.stringify(line)).join('\n') + '\n')
    return { dir: scriptsDir, name }
  }
  const unattendedScripts = (options.scripts ?? ['autopilot-waves']).map(placed)
  if (unattendedScripts.length === 0) throw new Error('faultRun: scripts is empty')
  const attendedScript = placed(options.attendedScript ?? 'autopilot-waves')

  // Claude Code: the fake agent, a stub process behind each query when asked.
  const releases = new FakeReleases()
  /** Every call of every Claude Code query in order, with the query's number and how its Session was launched. */
  const calls: { query: number; unattended: boolean; call: FakeCall }[] = []
  const stubKind = options.processes
  const processes = stubKind === undefined ? null : new StubProcesses(typeof stubKind === 'function' ? stubKind : () => stubKind)
  if (processes !== null) cleanups.push(() => processes.stopAll())
  let queries = 0
  let unattendedQueries = 0
  const tracker = new LimitsTracker({ dataDir: dataRoot, now: () => clock.now })
  const claudeFactory = tracker.observe((request) => {
    const query = ++queries
    const unattended = request.unattended === true
    const script = unattended ? unattendedScripts[Math.min(unattendedQueries++, unattendedScripts.length - 1)]! : attendedScript
    const fake = fakeQueryFactory({ scriptsDir: script.dir, script: script.name, releases, record: (call) => calls.push({ query, unattended, call }) })
    return (processes === null ? fake : processes.wrap(fake))(request)
  })

  // Codex: the fake app-server under scriptNode(), each process with its own script and log.
  const codexHome = join(scratch, 'codex-home')
  mkdirSync(codexHome, { recursive: true })
  const codexLogs: string[] = []
  const codexChildren: ChildProcess[] = []
  cleanups.push(async () => {
    for (const child of codexChildren.splice(0)) {
      if (child.pid === undefined || hasExited(child)) continue
      const exited = new Promise<void>((done) => child.once('exit', () => done()))
      child.kill('SIGKILL')
      await exited
    }
  })
  const codexScripts = options.codexScripts ?? ['turn', 'autopilot-wave', 'resume']
  const codex = codexSessions(() => {
    const index = codexLogs.length
    const log = join(scratch, `codex-${index + 1}.log`)
    codexLogs.push(log)
    return Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO_ROOT,
      clientVersion: '9.9.9',
      env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: codexScripts[Math.min(index, codexScripts.length - 1)]!, WORFY_CODEX_LOG: log },
      spawnProcess: (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
        const child = spawn(scriptNode(), [...args], spawnOptions)
        codexChildren.push(child)
        return child
      },
      log: () => undefined,
    })
  })

  const claude = claudeSessions(claudeFactory)
  const registry = new SessionRegistry({
    sessionsOf: (each) => (each === 'codex' ? codex : claude),
    partsOf: (each) => (each === 'codex' ? { capabilities: codexCapabilities, commands: codexCommands } : STATIC_CLAUDE_PARTS),
  })
  cleanups.push(() => registry.closeAll())

  // The Tickets: what the agent writes, each write a StatusWrite and a change the watch reports.
  const statusWrites: StatusWrite[] = []
  const watchers = new Set<() => void>()
  const setStatus = (num: number, status: string): void => {
    writeFileSync(join(repo, ticketFile(num)), ticketText(num, status))
    statusWrites.push({ at: new Date().toISOString(), file: ticketFile(num), ticket: nn(num), state: stateOf(status) })
    for (const watcher of watchers) watcher()
  }
  let marks: FaultMarks = options.marks ?? 'done'
  const setMarks = (value: FaultMarks): void => {
    marks = value
  }
  registry.observe((_sessionId, event) => {
    if (event.type !== 'prompt' || marks === 'none') return
    const status = marks === 'done' ? 'done — 2026-11-05' : 'claimed — 2026-11-05'
    const command = /^[ \t]*\/(?:worfy:)?epic-wave\b(.*)$/mu.exec(event.text)?.[1]
    if (command === undefined) return
    const named = [...command.replaceAll(EPIC, ' ').matchAll(/\b\d+\b/gu)].map((match) => Number(match[0]))
    for (const num of named) setStatus(num, status)
  })

  const picks = new Map<string, SessionSettings>()
  const capabilities: Record<VendorId, Capabilities> = { claude: CLAUDE_CAPABILITIES, codex: CODEX_CAPABILITIES }
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const orchestrators = new Orchestrators({
    layout,
    projectPath: () => repo,
    registry,
    vendor: () => vendor,
    // Claude Code: the app's store; Codex: Auto, as a person picks it there (codex-orchestrator.test.ts).
    settings:
      vendor === 'codex'
        ? { read: (_projectId, nodeId) => picks.get(nodeId) ?? { ...DEFAULT_SETTINGS, permissionMode: 'acceptEdits' }, write: (_projectId, nodeId, settings) => void picks.set(nodeId, settings) }
        : new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    capabilities: (each) => Promise.resolve(capabilities[each]),
    harnessHooks: () => undefined,
    broadcast: () => undefined,
    publish: (view) => options.publish?.(view),
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

  // GitHub: the run's own PrTracker over the gh stand-in.
  let gh: GhWorld | null = null
  let prs: PrTracker | null = null
  /** The tracker as the run reads it: each read is kept in prReads until it settles. */
  let prReader: Pick<PrTracker, 'read'> | null = null
  const prOptions = options.prs === false ? null : (options.prs ?? {})
  if (prOptions !== null) {
    const world = ghWorld(join(scratch, 'gh'), { accounts: prOptions.accounts ?? [] })
    gh = world
    if (prOptions.pulls !== undefined) writeFileSync(join(world.dir, 'prs.json'), JSON.stringify(prOptions.pulls))
    // The developer's own gh tokens stay out, as in gh-world.ts.
    const ghEnv = { ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined, ...world.env }
    const tracker = new PrTracker({
      run: ghRunner({ command: STUB_COMMAND, env: () => Promise.resolve(ghEnv), timeoutMs: prOptions.timeoutMs ?? ms(15_000) }),
      now: () => clock.now,
      ...(prOptions.baseIntervalMs === undefined ? {} : { baseIntervalMs: prOptions.baseIntervalMs }),
      ...(prOptions.maxIntervalMs === undefined ? {} : { maxIntervalMs: prOptions.maxIntervalMs }),
    })
    prs = tracker
    prReader = {
      read: (root, branches) => {
        const read = tracker.read(root, branches)
        prReads.add(read)
        const settled = (): void => void prReads.delete(read)
        read.then(settled, settled)
        return read
      },
    }
  }

  const states: AutopilotState[] = []
  const autopilot = new Autopilot({
    projectRoot: () => repo,
    selfRefusal: () => Promise.resolve(null),
    workflow,
    watchWorkflow: (_root, onChange) => {
      watchers.add(onChange)
      return Promise.resolve(() => {
        watchers.delete(onChange)
      })
    },
    orchestrators,
    registry,
    waves: launcher,
    journal: (start) => openRun(start, { env }),
    harness: () => 'plugin',
    keepAwake: () => ({ start: () => undefined, stop: () => undefined }),
    onChange: (state) => states.push(state),
    settleMs: options.settleMs ?? 60_000,
    limits: {
      state: () => tracker.snapshot(),
      observeSession: (isSession, listener) => observeSessionLimits((sink) => registry.observe(sink), isSession, listener),
      send: (sessionId, text) => {
        registry.get(sessionId).send(text)
      },
      now: () => clock.now,
      schedule: clock.schedule,
    },
    tasksClock: clock,
    haltTurnMs: options.haltTurnMs ?? 100,
    ...(options.autoContinue === true
      ? {
          retry: {
            enabled: () => true,
            send: (sessionId: string, text: string) => {
              registry.get(sessionId).send(text)
            },
            now: () => clock.now,
            schedule: clock.schedule,
            random: () => 0.5,
          },
        }
      : {}),
    ...(options.backgroundStallMs === undefined ? {} : { backgroundStallMs: options.backgroundStallMs }),
    ...(options.tasksGraceMs === undefined ? {} : { tasksGraceMs: options.tasksGraceMs }),
    ...(prReader === null || prOptions === null
      ? {}
      : {
          prs: prReader,
          prsClock: clock,
          ...(prOptions.everyMs === undefined ? {} : { prsEveryMs: prOptions.everyMs }),
          ...(prOptions.endReadMs === undefined ? {} : { endReadMs: prOptions.endReadMs }),
        }),
  })
  cleanups.push(() => autopilot.stopAll())
  launcher.attachAutopilot(autopilot)

  // ── reads for the test ──

  /** The journal files of the Project's runs, oldest first (their names begin with the start time). */
  const journalFiles = (): string[] => {
    try {
      return readdirSync(join(dataRoot, 'autopilot'))
        .filter((name) => name.endsWith('.jsonl'))
        .sort()
        .map((name) => join(dataRoot, 'autopilot', name))
    } catch {
      return []
    }
  }
  const journals = (): string[] => journalFiles().map((file) => readFileSync(file, 'utf8'))
  /** The events of run `n` (1: the scenario's Run, 2: the first new start, …). */
  const journal = (n = 1): JournalEvent[] => parseJournal(journals()[n - 1] ?? '').events
  const kinds = (n = 1): string[] => journal(n).map((event) => event.kind)
  /** The texts the Orchestrator got, in order: what each Claude Code query or Codex turn was sent. */
  const messages = (): string[] =>
    vendor === 'codex'
      ? codexLogs.flatMap(codexTurnTexts)
      : calls.flatMap(({ call }) => (call.kind === 'message' ? [call.text] : []))
  /** The Claude Code queries in start order: how each Session was launched and the texts it got. */
  const queriesOf = (): { unattended: boolean; messages: string[]; calls: FakeCall[] }[] => {
    const out: { unattended: boolean; messages: string[]; calls: FakeCall[] }[] = []
    for (const { query, unattended, call } of calls) {
      const each = (out[query - 1] ??= { unattended, messages: [], calls: [] })
      each.calls.push(call)
      if (call.kind === 'message') each.messages.push(call.text)
    }
    return out
  }
  const state = (): AutopilotState => autopilot.state(PROJECT)
  /** Starts the run; a refused start answers its reason instead of throwing. */
  const start = async (): Promise<{ refusal: string | null }> => {
    try {
      await autopilot.start(PROJECT, EPIC)
      return { refusal: null }
    } catch (error) {
      return { refusal: error instanceof Error ? error.message : String(error) }
    }
  }
  let restart: { refusal: string | null } | null = null
  /**
   * The new start after the Run stopped (I6), kept for recovery(). It answers at once: a stop of the
   * run's own while background tasks live gives the Orchestrator back to a person as it runs
   * (worfy-autopilot-queue ticket 08), and the new run waits while it is busy (ADR-0099); a graceful
   * Stop leaves it unattended, and a new run takes that Session over as it runs (worfy-polish ticket 50).
   */
  const startAgain = async (): Promise<{ refusal: string | null }> => {
    restart = await start()
    return restart
  }
  const stopped = (n: number): Promise<void> =>
    until(() => journal(n).some((event) => event.kind === 'run-stopped') && state().status === 'stopped', `run ${n} to stop`)
  /** What checkRecovery needs, read now. */
  const recovery = (expect: RecoveryExpect): RecoveryInput => ({
    journals: journals(),
    messages: messages(),
    ...(gh === null ? {} : { gh: gh.calls() }),
    statusWrites: [...statusWrites],
    projectBefore,
    projectAfter: snapshot(repo),
    restart,
    expect,
  })

  return {
    autopilot,
    registry,
    orchestrators,
    launcher,
    tracker,
    clock,
    releases,
    /** The Claude process stubs; null without `processes`. */
    processes,
    /** The gh stand-in's world (its folder is GH_STUB_DIR); null with `prs: false`. */
    gh,
    prs,
    vendor,
    repo,
    scratch,
    codexHome,
    codexLogs,
    states,
    statusWrites,
    setStatus,
    setMarks,
    watchers,
    journals,
    journal,
    kinds,
    messages,
    queries: queriesOf,
    state,
    start,
    startAgain,
    stopped,
    snapshot: () => snapshot(repo),
    projectBefore,
    recovery,
  }
}

export type FaultRun = ReturnType<typeof faultRun>
