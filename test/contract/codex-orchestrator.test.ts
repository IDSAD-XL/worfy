// The Orchestrator and Autopilot on Codex (worfy-multi-vendor ticket 37) over the fake app-server
// (WORFY_CODEX=fake, which test/setup-contract.ts sets): the real Session registry, Orchestrators,
// launcher, run journal and cycle, over a one-Ticket Epic in a temporary folder (two Tickets in one test). The
// Orchestrator's Vendor is the Project's defaultVendor (the `vendor` dep); its Sessions run on the
// Codex driver's session part, each process on its own script and log:
//   - the attended Session the Orchestrator opens with: `turn` (it opens a thread and waits);
//   - the unattended one of the run: `autopilot-wave` — the Wave's turn asks one approval, which the
//     unattended Session declines, and ends. Its thread/start result keeps a recorded sandbox shape
//     (codex-compat.test.ts: no recording has `dangerFullAccess`); worfy does not read it back, and
//     the Full access asked for is checked in what worfy sent;
//   - the attended one it is given back as: `resume`.
// The Claude Sessions of the Vendor switch run on the fake agent (test/fixtures/agent-scripts).
// Whether Codex runs the Harness's hooks (worfy-multi-vendor ticket 39) is the Codex driver's real check:
// `hooks/list` of a fake app-server of its own, over a CODEX_HOME with the Harness of this repository
// installed, approved or not by approvePluginHooks as a user's /hooks approves it. Those processes run
// with CODEX_HOME of their own and log elsewhere: the Sessions' processes never see the Harness, so no
// hook of it runs.
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of the session
// part, as in codex-session.test.ts; the real Codex never starts.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { observeSessionLimits } from '../../src/main/agent/limits'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, STATIC_CLAUDE_PARTS } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { UNATTENDED_MODE_MESSAGE, unattendedPresetMessage } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import type { LimitsWaitDeps } from '../../src/main/autopilot/limits-wait'
import { Autopilot, type AutopilotDeps } from '../../src/main/autopilot/run'
import { LayoutStore } from '../../src/main/layout/store'
import { CODEX_HOOKS_REFUSAL, codexHarnessHooksPart } from '../../src/main/vendors/codex/harness-hooks'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import { codexAskStarter } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { CODEX_CAPABILITIES, codexCapabilities } from '../../src/main/vendors/codex/capabilities'
import { codexCommands } from '../../src/main/vendors/codex/commands'
import { UNATTENDED_DECLINED_MESSAGE } from '../../src/main/vendors/codex/approvals'
import { codexSessions } from '../../src/main/vendors/codex/session'
import type { HarnessHooksPart } from '../../src/main/vendors/harness-hooks'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LimitWindow } from '../../src/shared/agent/limits'
import { DEFAULT_SETTINGS, type SessionSettings } from '../../src/shared/agent/settings'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { ORCHESTRATOR_HEIGHT, ORCHESTRATOR_KIND, ORCHESTRATOR_WIDTH, readOrchestratorData } from '../../src/shared/ipc/orchestrator'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { CLAUDE_CAPABILITIES, type Capabilities } from '../../src/shared/vendors/capabilities'
import type { VendorId } from '../../src/shared/vendors/vendor'
import { approvePluginHooks } from '../fixtures/codex-app-server/hook-runner.mjs'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const REPO = join(import.meta.dirname, '..', '..')
const AGENT_SCRIPTS = join(REPO, 'test', 'fixtures', 'agent-scripts')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const PROJECT = 'demo-00000037'
const EPIC = 'demo'
/** What the default Run wave template sends for the Epic's one Wave (ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01 эпика demo'
/** The "Process gate queue" template on a machine with `serve` (worfy-windows ticket 17). */
const GATE_QUEUE = '/worfy:gate-queue'
/** The thread of the run's unattended Session (test/fixtures/codex-scripts/autopilot-wave.jsonl). */
const WAVE_THREAD = 'thr_fake_wave'
/** The attended Orchestrator's picks: Auto on Codex, so the run's Full access is its own. */
const ATTENDED_PICKS: SessionSettings = { ...DEFAULT_SETTINGS, permissionMode: 'acceptEdits' }

let scratch: string
let repo: string
const registries: SessionRegistry[] = []
const autopilots: Autopilot[] = []
const children: ChildProcess[] = []

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-codex-orchestrator-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  writeTicket('open')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
})

afterEach(async () => {
  for (const autopilot of autopilots.splice(0)) await autopilot.stopAll()
  for (const registry of registries.splice(0)) registry.closeAll()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  removeTestTree(scratch)
})

/** Ticket `num` of the Epic with `status`, blocked by the Tickets `blockedBy`. */
function writeTicket(status: string, num = 1, blockedBy: readonly number[] = []): void {
  const nn = String(num).padStart(2, '0')
  const blocked = blockedBy.length === 0 ? '—' : blockedBy.map((each) => String(each).padStart(2, '0')).join(', ')
  writeFileSync(join(repo, '.scratch', EPIC, 'issues', `${nn}-ticket-${String(num)}.md`), [`# ${nn} — Ticket ${String(num)}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, ''].join('\n'))
}

/** `epic-status --json` over the Epic's Tickets, as the real script reads them. */
const runner: EpicStatusRunner = (cwd) => {
  const issues = join(cwd, '.scratch', EPIC, 'issues')
  const tickets = readdirSync(issues)
    .sort()
    .map((name) => {
      const text = readFileSync(join(issues, name), 'utf8')
      const status = /^Status:\s*(.*)$/m.exec(text)?.[1] ?? null
      const state = /^done\b/i.test(status ?? '') ? 'done' : 'open'
      const blockedRaw = /^Blocked by:\s*(.*)$/m.exec(text)?.[1] ?? '—'
      const blockedNums = blockedRaw === '—' ? [] : blockedRaw.split(',').map((each) => Number(each.trim()))
      const title = /^# (.*)$/m.exec(text)?.[1] ?? name
      return { epic: EPIC, num: Number(name.slice(0, 2)), slug: name.slice(3, -3), title, statusRaw: status, state, blockedRaw, blockedNums, blockedParsed: true }
    })
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets }))
}

async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 10_000): Promise<void> {
  const end = Date.now() + ms(limit)
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

interface Logged {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

interface HarnessOptions {
  /** The Project's defaultVendor, asked at each start of the Orchestrator. */
  vendor: () => VendorId | undefined
  /** The Codex script of each app-server process in start order, the last for every later one. */
  scripts: string[]
  /** The Node's picks when none are saved (default ATTENDED_PICKS). */
  settings?: SessionSettings
  /** The saved picks, by Node id; one map passed to two harnesses is one store across a restart. */
  picks?: Map<string, SessionSettings>
  /**
   * The Harness's hooks are approved in the CODEX_HOME the check asks (approvePluginHooks); by default
   * the Harness is installed there and its hooks wait for the approval, as after an install.
   */
  hooksApproved?: boolean
  /** Every Codex start fails with this, before any process (no binary, nobody signed in). */
  codexFails?: string
  /** WORFY_CODEX_HOME of the fake: a resume works only for a thread one of its processes started. */
  codexHome?: string
  /**
   * The run follows the Limits (worfy-multi-vendor ticket 38): the Session's Limits status, Codex's windows
   * from the Sessions' `limits` events, and this clock, the fake's (its turns run at 1793000000); the
   * wait's timer never fires.
   */
  limitsClock?: number
  /** Codex's windows known before the run (the app's poll). */
  codexWindows?: LimitWindow[]
  /**
   * What each read of Codex's windows anew answers, in order (the last again after); none: no such read.
   * The app's `usage.refresh(olderThanMs, vendor)` reads when asked for Codex with age 0, with no
   * windows known, or with a window older than the age by the clock, as limits-usage.ts does.
   */
  reads?: LimitWindow[][]
  /**
   * Each read records its windows at once, then waits for this promise before it resolves (a poll
   * whose answer is in but whose call has not returned, during a Force stop or the quit).
   */
  hold?: Promise<void>
  /** Each read fails (the app's poll gets no answer): the windows stay as they were. */
  readFails?: boolean
  /** How many of the run's wait timers fire at once; the rest never do (default none). */
  fires?: number
  /** The budget of the Limits (Settings → Autopilot) and the past runs' journals. */
  budget?: AutopilotDeps['budget']
  /** The text of "Process gate queue" on a machine with `serve`, and what happens when it is read (worfy-multi-vendor ticket 38). */
  gateQueue?: { text: string; onRead?: () => void }
}

/**
 * The app's parts over the fakes: the Orchestrators of `vendor()` (the Project's defaultVendor), with
 * each Vendor's real capabilities, an Autopilot and its launcher. Each Codex process logs what worfy
 * sent into a file of its own.
 */
let harnesses = 0

/**
 * `home` as a CODEX_HOME with the Harness of this repository installed the way Codex keeps a plugin of a
 * local marketplace (hook-runner.mjs, installedPlugins): its manifest and hooks.json, no approval yet.
 */
function codexHomeWithHarness(home: string): string {
  const plugin = join(home, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local')
  mkdirSync(join(plugin, 'hooks'), { recursive: true })
  cpSync(join(REPO, 'harness', '.claude-plugin'), join(plugin, '.claude-plugin'), { recursive: true })
  cpSync(join(REPO, 'harness', 'hooks', 'hooks.json'), join(plugin, 'hooks', 'hooks.json'))
  return home
}

function harness(options: HarnessOptions) {
  const env = { WORFY_DATA_DIR: join(scratch, 'data-root') }
  const logs: string[] = []
  const codex = codexSessions(() => {
    if (options.codexFails !== undefined) return Promise.reject(new Error(options.codexFails))
    const index = logs.length
    const log = join(scratch, `codex-${index + 1}.log`)
    logs.push(log)
    return Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: {
        ...process.env,
        WORFY_CODEX_SCRIPT: options.scripts[Math.min(index, options.scripts.length - 1)]!,
        WORFY_CODEX_LOG: log,
        ...(options.codexHome === undefined ? {} : { WORFY_CODEX_HOME: options.codexHome }),
      },
      spawnProcess: (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
        const child = spawn(scriptNode(), [...args], spawnOptions)
        children.push(child)
        return child
      },
      log: () => undefined,
    })
  })
  const claudeMessages: string[] = []
  const claude = claudeSessions(
    fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'autopilot-waves', record: (call) => void (call.kind === 'message' && claudeMessages.push(call.text)) }),
    { model: () => null, effort: () => null },
  )
  const registry = new SessionRegistry({
    sessionsOf: (vendor) => (vendor === 'codex' ? codex : claude),
    partsOf: (vendor) => (vendor === 'codex' ? { capabilities: codexCapabilities, commands: codexCommands } : STATIC_CLAUDE_PARTS),
  })
  registries.push(registry)
  const observed: AgentEvent[] = []
  registry.observe((_sessionId, event) => observed.push(event))
  // What the agent does: marks the Wave's Ticket done when "Run wave" reaches it.
  registry.observe((_sessionId, event) => {
    if (event.type === 'prompt' && event.text === WAVE_1) writeTicket('done — 2026-11-04')
  })
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const transcripts: [string, VendorId | undefined][] = []
  const picks = options.picks ?? new Map<string, SessionSettings>()
  const capabilities: Record<VendorId, Capabilities> = { claude: CLAUDE_CAPABILITIES, codex: CODEX_CAPABILITIES }
  // The Codex driver's check over its own CODEX_HOME; the Vendors that ask it are counted.
  const hooksHome = codexHomeWithHarness(join(scratch, `hooks-home-${String(++harnesses)}`))
  if (options.hooksApproved === true) approvePluginHooks(hooksHome)
  const hooksLog = join(scratch, `hooks-${String(harnesses)}.log`)
  const askDir = join(scratch, 'ask')
  mkdirSync(askDir, { recursive: true })
  const codexHooks = codexHarnessHooksPart({
    start: codexAskStarter({
      runtime: RUNTIME,
      appPath: REPO,
      cwd: askDir,
      clientVersion: '9.9.9',
      env: { ...process.env, CODEX_HOME: hooksHome, WORFY_CODEX_SCRIPT: 'turn', WORFY_CODEX_LOG: hooksLog },
      spawnProcess: (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
        const child = spawn(scriptNode(), [...args], spawnOptions)
        children.push(child)
        return child
      },
      log: () => undefined,
    }),
  })
  const hookChecks: VendorId[] = []
  // As the drivers have it: Claude Code's has no such part (vendor-driver-types.test.ts), Codex's checks.
  const hookParts: Record<VendorId, HarnessHooksPart | undefined> = {
    claude: undefined,
    codex: { refusal: codexHooks.refusal, trust: (cwd) => (hookChecks.push('codex'), codexHooks.trust(cwd)) },
  }
  const orchestrators = new Orchestrators({
    layout,
    projectPath: () => repo,
    registry,
    vendor: options.vendor,
    settings: {
      read: (_projectId, nodeId) => picks.get(nodeId) ?? options.settings ?? ATTENDED_PICKS,
      write: (_projectId, nodeId, settings) => void picks.set(nodeId, settings),
    },
    transcript: (_root, sessionId, vendor) => {
      transcripts.push([sessionId, vendor])
      return Promise.resolve({ model: null, statusBlock: null })
    },
    capabilities: (vendor) => Promise.resolve(capabilities[vendor]),
    harnessHooks: (vendor) => hookParts[vendor],
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
  if (options.gateQueue !== undefined) {
    const queue = options.gateQueue
    launcher.autopilotGateQueue = () => {
      queue.onRead?.()
      return Promise.resolve(queue.text)
    }
  }
  // Codex's windows as the Sessions' `limits` events tell them (the app keeps them in its LimitsTracker).
  let codexWindows: readonly LimitWindow[] | null = options.codexWindows ?? null
  const reads = options.reads === undefined ? undefined : [...options.reads]
  let readCount = 0
  let fires = options.fires ?? 0
  registry.observe((_sessionId, event) => {
    if (event.type === 'limits' && event.vendor === 'codex') codexWindows = event.windows
  })
  const clock = options.limitsClock
  const limits: LimitsWaitDeps | undefined =
    clock === undefined
      ? undefined
      : {
          state: () => ({ windows: {} }),
          windows: (vendor) => (vendor === 'codex' ? codexWindows : null),
          observeSession: (isSession, listener) => observeSessionLimits((sink) => registry.observe(sink), isSession, listener),
          send: (sessionId, text) => void registry.get(sessionId).send(text),
          now: () => clock,
          schedule: (_at, fire) => {
            if (fires > 0) {
              fires -= 1
              setTimeout(fire, 0)
            }
            return () => undefined
          },
        }
  const usage: AutopilotDeps['usage'] =
    reads === undefined && options.readFails !== true
      ? undefined
      : {
          refresh: async (olderThanMs, vendor) => {
            if (vendor !== 'codex') return
            const fresh = codexWindows !== null && codexWindows.length > 0 && olderThanMs > 0 && codexWindows.every((each) => each.receivedAt > (clock ?? Date.now()) - olderThanMs - 1)
            if (fresh) return
            readCount += 1
            if (options.readFails === true || reads === undefined) {
              if (options.hold !== undefined) await options.hold
              throw new Error('no answer from Codex')
            }
            codexWindows = reads.length > 1 ? reads.shift()! : reads[0]!
            if (options.hold !== undefined) await options.hold
          },
        }
  const autopilot = new Autopilot({
    ...(limits === undefined ? {} : { limits }),
    ...(usage === undefined ? {} : { usage }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
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
    settleMs: 60_000,
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  const journal = async (): Promise<JournalEvent[]> => {
    const runs = readdirSync(join(env.WORFY_DATA_DIR, 'autopilot')).map((name) => name.replace(/\.jsonl$/, ''))
    expect(runs).toHaveLength(1)
    return (await readRun(runs[0]!, { env }))!.events
  }
  /** What worfy sent the app-server process `n` (1-based). */
  const logged = (n: number): Logged[] => {
    try {
      return readFileSync(logs[n - 1]!, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Logged)
    } catch {
      return []
    }
  }
  const request = (n: number, method: string) => logged(n).find((each) => each.method === method)
  const node = () => layout.get(PROJECT).layout.nodes.find((each) => each.kind === ORCHESTRATOR_KIND)
  const data = () => readOrchestratorData(node()?.data ?? {})
  /** What worfy asked the app-servers of the hooks check, each request with its params. */
  const hooksAsked = (): Logged[] =>
    existsSync(hooksLog)
      ? readFileSync(hooksLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Logged).filter((each) => each.method === 'hooks/list')
      : []
  return { registry, orchestrators, autopilot, layout, journal, logs, logged, request, node, data, observed, transcripts, picks, claudeMessages, hooksHome, hookChecks, hooksAsked, reads: () => readCount }
}

describe('Autopilot on a Codex Orchestrator (worfy-multi-vendor ticket 37)', () => {
  it('drives the Wave through the Codex SessionHandle: Full access, the approval declined and journalled as refused-dialog, run-started names codex, and the Orchestrator goes back attended on the same thread', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'autopilot-wave', 'resume'], hooksApproved: true })
    await h.autopilot.start(PROJECT, EPIC)
    // The start asked Codex whether the Harness's hooks are approved, for the Project's folder.
    expect(h.hookChecks.length).toBeGreaterThan(0)
    expect(h.hookChecks.every((vendor) => vendor === 'codex')).toBe(true)
    expect(h.hooksAsked()[0]?.params).toEqual({ cwds: [repo] })
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave', wave: 1 })

    const events = await h.journal()
    expect(events[0]).toMatchObject({ kind: 'run-started', vendor: 'codex' })
    expect(events.find((event) => event.kind === 'wave-started')).toMatchObject({ wave: 1, tickets: ['01'], text: WAVE_1 })
    expect(events.filter((event) => event.kind === 'refused-dialog')).toMatchObject([{ what: 'permission_request gh pr merge 101 --squash', reason: 'The command needs network access.' }])
    expect(events.find((event) => event.kind === 'wave-finished')).toMatchObject({ wave: 1, tickets: ['01'] })
    expect(events.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'no-ready-wave', lastText: 'Wave done: its Tickets are merged and marked done.' })
    expect(h.observed.filter((event) => event.type === 'refused_dialog')).toEqual([
      { type: 'refused_dialog', dialog: 'permission_request', subject: 'gh pr merge 101 --squash', message: UNATTENDED_DECLINED_MESSAGE, reason: 'The command needs network access.' },
    ])

    // 1: the attended Orchestrator, with its own picks (Auto); 2: the run's unattended Session, in Full access.
    expect(h.request(1, 'thread/start')?.params).toMatchObject({ cwd: repo, approvalPolicy: 'on-request', sandbox: 'workspace-write' })
    expect(h.request(2, 'thread/start')?.params).toMatchObject({ cwd: repo, approvalPolicy: 'never', sandbox: 'danger-full-access' })
    expect(h.request(2, 'turn/start')?.params).toMatchObject({ threadId: WAVE_THREAD })
    expect(h.logged(2).filter((each) => each.method === undefined && each.result !== undefined)).toEqual([{ id: 1, result: { decision: 'decline' } }])
    // 3: given back attended, continuing the run's thread with the person's picks again.
    await until(() => h.request(3, 'thread/resume') !== undefined, 'the give-back')
    expect(h.request(3, 'thread/resume')?.params).toMatchObject({ threadId: WAVE_THREAD, cwd: repo, approvalPolicy: 'on-request', sandbox: 'workspace-write' })
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(h.data()).toMatchObject({ sessionId: WAVE_THREAD, vendor: 'codex' })
    // The unattended Full access is not saved as the person's pick.
    expect([...h.picks.values()].every((picks) => picks.permissionMode !== 'bypassPermissions' && picks.permissionMode !== 'full-access')).toBe(true)
  })

  it("starts on the Project's defaultVendor: a Node saved with a Claude Code session starts a new Codex thread on the Vendor's own model, and the next start resumes that thread", async () => {
    const seed = harness({ vendor: () => 'codex', scripts: ['turn'], settings: { model: 'claude-opus-5-5', effort: 'max', permissionMode: 'acceptEdits' } })
    seed.layout.apply(PROJECT, { op: 'create', node: { kind: ORCHESTRATOR_KIND, x: 40, y: 40, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT, locked: true, data: { sessionId: 'claude-sdk-1', costUsd: 2 } } })
    const view = await seed.orchestrators.open(PROJECT)
    expect(view).toMatchObject({ vendor: 'codex', costUsd: 0 })
    await until(() => seed.request(1, 'thread/start') !== undefined, 'the thread')
    expect(seed.request(1, 'thread/resume')).toBeUndefined()
    // Claude Code's model goes, with its effort: the Codex thread starts on Codex's default model.
    expect(seed.request(1, 'thread/start')?.params).not.toHaveProperty('model')
    expect([...seed.picks.values()]).toMatchObject([{ model: null, effort: null }])
    // The Claude Code session is not asked for: it is not the Codex thread's. The Node keeps it until the thread is there.
    expect(seed.transcripts).toEqual([])
    expect(seed.data()).toEqual({ sessionId: 'claude-sdk-1', costUsd: 2 })

    // The thread is the Node's once Codex names it (at its first turn), with its Vendor and its cost from
    // zero; the next start resumes it.
    seed.registry.get(view.sessionId!).send('Say hello')
    await until(() => seed.data().sessionId === 'thr_fake_1', 'the thread id in the Node')
    expect(seed.data()).toEqual({ sessionId: 'thr_fake_1', costUsd: 0, vendor: 'codex' })
    seed.layout.flushAll()
    seed.registry.closeAll()
    const next = harness({ vendor: () => 'codex', scripts: ['resume'] })
    await next.orchestrators.open(PROJECT)
    await until(() => next.request(1, 'thread/resume') !== undefined, 'the resume')
    expect(next.request(1, 'thread/resume')?.params).toMatchObject({ threadId: 'thr_fake_1', cwd: repo })
    expect(next.transcripts).toEqual([['thr_fake_1', 'codex']])
  })

  it('a change of defaultVendor takes effect at the next start of the Orchestrator: not while it runs, and at New conversation', async () => {
    let vendor: VendorId | undefined = 'codex'
    const h = harness({ vendor: () => vendor, scripts: ['turn'] })
    const first = await h.orchestrators.open(PROJECT)
    expect(first.vendor).toBe('codex')
    await until(() => h.request(1, 'thread/start') !== undefined, 'the Codex thread')
    // No defaultVendor (or "None"): Claude Code. The running Orchestrator stays on Codex.
    vendor = undefined
    expect((await h.orchestrators.open(PROJECT)).vendor).toBe('codex')
    expect(h.logs).toHaveLength(1)
    const fresh = await h.orchestrators.newConversation(PROJECT)
    expect(fresh.vendor).toBe('claude')
    // The Codex Session never had a turn, so the Node never named it: Claude Code's new session is a plain one.
    expect(h.data()).toEqual({ sessionId: null, costUsd: 0 })
    h.registry.get(fresh.sessionId!).send(WAVE_1)
    await until(() => h.claudeMessages.length === 1, 'the message to Claude Code')
    expect(h.logs).toHaveLength(1)
  })

  it('refuses a Run on Codex while the Harness hooks wait for their approval in /hooks, with the reason, before any Session process starts (ticket 39)', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn'] })
    expect(CODEX_CAPABILITIES.harness).toBe(true)
    const reason = 'The Harness hooks are not approved in Codex. Approve them in /hooks and start again.'
    expect(CODEX_HOOKS_REFUSAL).toBe(reason)
    await expect(h.autopilot.startCheck(PROJECT, EPIC)).resolves.toBe(reason)
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(reason)
    // The Orchestrator refuses the unattended start itself too, for any other caller.
    await expect(h.orchestrators.setUnattended(PROJECT, true)).rejects.toThrow(reason)
    // No Session process, so no thread/start; only the checks' own app-servers, each asked hooks/list.
    expect(h.logs).toEqual([])
    expect(h.node()).toBeUndefined()
    expect(h.hooksAsked().length).toBe(h.hookChecks.length)
    expect(h.hooksAsked().every((each) => JSON.stringify(each.params) === JSON.stringify({ cwds: [repo] }))).toBe(true)
    // Approved in /hooks: the same Run starts.
    approvePluginHooks(h.hooksHome)
    await expect(h.autopilot.startCheck(PROJECT, EPIC)).resolves.toBeNull()
  })

  it('refuses again once the Harness changes after the approval (an update), and when Codex lists no hook of the Harness', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn'], hooksApproved: true })
    await expect(h.orchestrators.unattendedRefusal(PROJECT)).resolves.toBeNull()
    // Another version of the plugin folder: Codex's approval was of the old folder's hash ("modified").
    appendFileSync(join(h.hooksHome, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local', '.claude-plugin', 'plugin.json'), '\n')
    await expect(h.orchestrators.unattendedRefusal(PROJECT)).resolves.toBe(CODEX_HOOKS_REFUSAL)
    // No Harness in Codex at all: whether its hooks run is unknown, and unknown is not approved.
    removeTestTree(join(h.hooksHome, 'plugins'))
    await expect(h.orchestrators.unattendedRefusal(PROJECT)).resolves.toBe(CODEX_HOOKS_REFUSAL)
  })

  it('asks again before every later Wave: hooks turned off after Wave 1 start no Session for Wave 2, and the run stops with the reason (ticket 39)', async () => {
    // Two Tickets, the second blocked by the first: Wave 2 is ready once Wave 1 has marked 01 done.
    writeTicket('open', 2, [1])
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'autopilot-wave', 'resume'], hooksApproved: true })
    // While Wave 1 runs the Harness is updated: Codex's approval was of the old folder's hash.
    h.registry.observe((_sessionId, event) => {
      if (event.type === 'prompt' && event.text === WAVE_1) appendFileSync(join(h.hooksHome, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local', '.claude-plugin', 'plugin.json'), '\n')
    })
    await h.autopilot.start(PROJECT, EPIC)
    const atStart = h.hooksAsked().length
    expect(atStart).toBeGreaterThan(0)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'session-error', wave: 1 })
    expect(h.hooksAsked().length).toBe(atStart + 1)

    const events = await h.journal()
    expect(events.filter((event) => event.kind === 'wave-started')).toMatchObject([{ wave: 1, tickets: ['01'] }])
    expect(events.find((event) => event.kind === 'wave-finished')).toMatchObject({ wave: 1, tickets: ['01'] })
    expect(events.filter((event) => event.kind === 'session-error')).toMatchObject([{ message: CODEX_HOOKS_REFUSAL }])
    expect(events.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'session-error' })
    // 1: attended, 2: the run's Session of Wave 1, 3: given back attended (a resume). No new thread for Wave 2.
    await until(() => h.request(3, 'thread/resume') !== undefined, 'the give-back')
    expect(h.logs).toHaveLength(3)
    expect(h.logged(2).filter((each) => each.method === 'turn/start')).toHaveLength(1)
    expect(h.observed.filter((event) => event.type === 'prompt' && event.text !== WAVE_1)).toEqual([])
  })

  it('a check of the hooks that throws refuses the Run, as unknown does', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn'], hooksApproved: true })
    await expect(h.orchestrators.unattendedRefusal(PROJECT)).resolves.toBeNull()
    const throwing: HarnessHooksPart = { refusal: CODEX_HOOKS_REFUSAL, trust: () => Promise.reject(new Error('the part broke')) }
    const orchestrators = new Orchestrators({
      layout: h.layout,
      projectPath: () => repo,
      registry: h.registry,
      vendor: () => 'codex',
      settings: { read: () => ATTENDED_PICKS, write: () => undefined },
      transcript: () => Promise.resolve({ model: null, statusBlock: null }),
      capabilities: () => Promise.resolve(CODEX_CAPABILITIES),
      harnessHooks: () => throwing,
      broadcast: () => undefined,
      publish: () => undefined,
    })
    await expect(orchestrators.unattendedRefusal(PROJECT)).resolves.toBe(CODEX_HOOKS_REFUSAL)
    await expect(orchestrators.setUnattended(PROJECT, true)).rejects.toThrow(CODEX_HOOKS_REFUSAL)
  })

  it('checks no hooks for Claude Code, and asks an open Orchestrator by the Vendor it runs on, not by the Project setting now', async () => {
    const open = harness({ vendor: () => 'claude', scripts: ['turn'] })
    await expect(open.orchestrators.unattendedRefusal(PROJECT)).resolves.toBeNull()
    expect(open.hookChecks).toEqual([])
    expect(open.hooksAsked()).toEqual([])
    let vendor: VendorId = 'codex'
    const moved = harness({ vendor: () => vendor, scripts: ['turn'] })
    await moved.orchestrators.open(PROJECT)
    vendor = 'claude'
    await expect(moved.orchestrators.unattendedRefusal(PROJECT)).resolves.toBe(CODEX_HOOKS_REFUSAL)
    expect(moved.hookChecks).toEqual(['codex'])
  })

  it('keeps the permission setting across a Vendor switch by its equivalent: bypassPermissions on Claude Code, Full access on Codex, bypassPermissions again', async () => {
    const picks = new Map<string, SessionSettings>()
    const settings: SessionSettings = { ...DEFAULT_SETTINGS, permissionMode: 'bypassPermissions' }
    const codex = harness({ vendor: () => 'codex', scripts: ['turn'], picks, settings })
    const onCodex = await codex.orchestrators.open(PROJECT)
    await until(() => codex.request(1, 'thread/start') !== undefined, 'the Codex thread')
    expect(codex.request(1, 'thread/start')?.params).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' })
    await until(() => [...picks.values()][0]?.permissionMode === 'full-access', "Codex's own id saved")
    expect(codex.registry.get(onCodex.sessionId!).controls().settings.permissionMode).toBe('full-access')
    codex.registry.closeAll()

    const claude = harness({ vendor: () => 'claude', scripts: ['turn'], picks, settings })
    const onClaude = await claude.orchestrators.open(PROJECT)
    expect(claude.registry.get(onClaude.sessionId!).controls().settings.permissionMode).toBe('bypassPermissions')
    await until(() => [...picks.values()][0]?.permissionMode === 'bypassPermissions', "Claude Code's own mode saved")
  })

  it('a start that fails on the new Vendor leaves the Node on its old session: back on Claude Code, the Orchestrator resumes it', async () => {
    const failing = harness({ vendor: () => 'codex', scripts: ['turn'], codexFails: 'The Codex binary of this build is missing' })
    failing.layout.apply(PROJECT, { op: 'create', node: { kind: ORCHESTRATOR_KIND, x: 40, y: 40, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT, locked: true, data: { sessionId: 'claude-sdk-1', costUsd: 2 } } })
    const view = await failing.orchestrators.open(PROJECT)
    await until(() => failing.orchestrators.view(view.nodeId)?.state === 'error', 'the failed start')
    expect(failing.orchestrators.view(view.nodeId)?.error).toContain('The Codex binary of this build is missing')
    expect(failing.data()).toEqual({ sessionId: 'claude-sdk-1', costUsd: 2 })
    // The restart: the Layout as saved, as the app saves it when it quits.
    failing.layout.flushAll()
    failing.registry.closeAll()

    const back = harness({ vendor: () => 'claude', scripts: ['turn'] })
    const resumed = await back.orchestrators.open(PROJECT)
    expect(back.transcripts).toEqual([['claude-sdk-1', 'claude']])
    expect(back.registry.get(resumed.sessionId!).sdkId).toBe('claude-sdk-1')
    expect(resumed).toMatchObject({ vendor: 'claude', costUsd: 2 })
  })

  it("a Codex Node whose thread is gone starts a new thread: Codex's 'no rollout found' is a session that cannot be resumed", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = harness({ vendor: () => 'codex', scripts: ['resume', 'turn'], codexHome: join(scratch, 'codex-threads') })
    h.layout.apply(PROJECT, { op: 'create', node: { kind: ORCHESTRATOR_KIND, x: 40, y: 40, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT, locked: true, data: { sessionId: 'thr_gone', costUsd: 1, vendor: 'codex' } } })
    await h.orchestrators.open(PROJECT)
    await until(() => h.request(2, 'thread/start') !== undefined, 'the new thread')
    expect(h.request(1, 'thread/resume')?.params).toMatchObject({ threadId: 'thr_gone' })
    expect(h.data()).toEqual({ sessionId: null, costUsd: 0, vendor: 'codex' })
    expect(warn.mock.calls.some(([message]) => String(message).includes('thr_gone cannot be resumed'))).toBe(true)
    warn.mockRestore()
  })

  it("an unattended Codex Session takes a pick of its own Full access, and refuses another in its own words, not Claude Code's", async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn'] })
    const session = h.registry.start(repo, undefined, () => undefined, DEFAULT_SETTINGS, { unattended: true }, undefined, 'codex')
    await until(() => h.request(1, 'thread/start') !== undefined, 'the Codex thread')
    await expect(session.configure({ permissionMode: 'full-access' })).resolves.toMatchObject({ permissionMode: 'full-access' })
    const refusal = session.configure({ permissionMode: 'auto' })
    await expect(refusal).rejects.toThrow(unattendedPresetMessage('full-access'))
    await expect(refusal).rejects.not.toThrow(/Claude|bypassPermissions/)
    expect(UNATTENDED_MODE_MESSAGE).toContain('bypassPermissions')
  })

  it('settings that cannot be read start the Orchestrator on Claude Code, and the Node keeps no Vendor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = harness({
      vendor: () => {
        throw new Error('settings.json is not JSON')
      },
      scripts: ['turn'],
    })
    const view = await h.orchestrators.open(PROJECT)
    expect(view.vendor).toBe('claude')
    h.registry.get(view.sessionId!).send(WAVE_1)
    await until(() => h.claudeMessages.length === 1, 'the message to Claude Code')
    expect(h.logs).toEqual([])
    expect(h.data()).not.toHaveProperty('vendor')
    expect(warn.mock.calls.some(([message]) => String(message).includes('could not read the Vendor'))).toBe(true)
    warn.mockRestore()
  })
})

describe('the Limits of a Run on Codex and the gate queue\'s turn (worfy-multi-vendor ticket 38)', () => {
  /** The clock of the fake's scripts: their turns run at 1793000000 (Unix seconds). */
  const CLOCK = 1_793_000_000_000
  /** Codex Plus as limits-two-windows sends it: a 5-hour `primary` and a weekly `secondary`, read at CLOCK. */
  const plus = (five: number, week: number): LimitWindow[] => [
    { vendor: 'codex', id: 'primary', label: '5h', usedPercent: five, windowMinutes: 300, resetsAt: 1_793_003_600, state: five >= 100 ? 'reached' : 'ok', receivedAt: CLOCK, source: 'read' },
    { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: week, windowMinutes: 10080, resetsAt: 1_793_400_000, state: 'ok', receivedAt: CLOCK, source: 'read' },
  ]
  const USAGE_LIMIT = "You've hit your usage limit. Try again later."
  /** Plus's windows read `age` ms before CLOCK: older than the run's FRESH_USAGE_MS, so each Wave line reads them anew. */
  const stale = (five: number, week: number, age = 6 * 60_000): LimitWindow[] => plus(five, week).map((each) => ({ ...each, receivedAt: CLOCK - age }))
  /**
   * Past runs of the Project: three Waves on Claude at 5 % of its week each, then six on Codex at 30 %
   * of Plus's weekly window each (one Ticket a Wave), and one on Codex today, 20 minutes before CLOCK,
   * from 39 % to 40 % of the weekly window of now; only the Codex ones give samples to a Run on Codex.
   */
  const pastRuns = (): JournalEvent[][] => {
    const iso = (at: number): string => new Date(at).toISOString()
    const day = 86_400_000
    const line = (run: string, kind: 'wave-started' | 'wave-finished', wave: number, at: number, limits: unknown) =>
      ({ at: iso(at), run, project: PROJECT, epic: EPIC, kind, wave, tickets: ['01'], limits }) as JournalEvent
    const claude = (used: number, at: number) => ({ five_hour: null, seven_day: { utilization: used, receivedAt: iso(at), resetsAt: iso(at + 3 * day) } })
    const codex = (used: number, at: number, resets = at + 3 * day) => ({
      windows: [
        { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 10, windowMinutes: 300, resetsAt: iso(at + 4 * 3_600_000), receivedAt: iso(at), state: 'ok', source: 'read' },
        { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: used, windowMinutes: 10080, resetsAt: iso(resets), receivedAt: iso(at), state: 'ok', source: 'read' },
      ],
    })
    const first = CLOCK - 20 * day
    const claudeRun = [1, 2, 3].flatMap((wave) => [
      line('2026-10-01T10-00-00-000Z-c1a0de', 'wave-started', wave, first + wave * 3_600_000, claude(0.1 + (wave - 1) * 0.05, first + wave * 3_600_000)),
      line('2026-10-01T10-00-00-000Z-c1a0de', 'wave-finished', wave, first + wave * 3_600_000 + 1_800_000, claude(0.1 + wave * 0.05, first + wave * 3_600_000 + 1_800_000)),
    ])
    const later = CLOCK - 10 * day
    const codexRuns = [1, 2, 3, 4, 5, 6].map((wave) => {
      const at = later + wave * day
      return [line(`2026-10-1${wave}T10-00-00-000Z-c0de00`, 'wave-started', 1, at, codex(10, at)), line(`2026-10-1${wave}T10-00-00-000Z-c0de00`, 'wave-finished', 1, at + 1_800_000, codex(40, at + 1_800_000))]
    })
    const today = '2026-10-26T07-00-00-000Z-c0de07'
    const todayRun = [line(today, 'wave-started', 1, CLOCK - 20 * 60_000, codex(39, CLOCK - 20 * 60_000, 1_793_400_000_000)), line(today, 'wave-finished', 1, CLOCK - 10 * 60_000, codex(40, CLOCK - 10 * 60_000, 1_793_400_000_000))]
    return [claudeRun, ...codexRuns, todayRun]
  }

  it('usage-limit-window: the Wave\'s turn refused with the 5-hour window used up waits until its resetsAt, and does not stop', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'usage-limit-window', 'resume'], hooksApproved: true, limitsClock: CLOCK })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'waiting', 'the wait for the Limits')
    const resumesAt = 1_793_003_600_000 + RESUME_MARGIN_MS
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'waiting', resumesAt, reason: null })
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'limits-hit')).toEqual(expect.objectContaining({ window: 'primary', resetsAt: new Date(1_793_003_600_000).toISOString() }))
    expect(events.find((event) => event.kind === 'limits-hit')).not.toHaveProperty('reason')
    expect(events.find((event) => event.kind === 'waiting-until')).toMatchObject({ until: new Date(resumesAt).toISOString() })
    expect(events.some((event) => event.kind === 'run-stopped')).toBe(false)
  })

  it('after the wait Codex\'s windows are read again: one still used up is waited for once more, then the Orchestrator goes on; the Wave\'s line carries the {windows}', async () => {
    const h = harness({
      vendor: () => 'codex',
      scripts: ['turn', 'usage-limit-window', 'resume'],
      hooksApproved: true,
      limitsClock: CLOCK,
      fires: 2,
      reads: [plus(12, 40), plus(100, 64), plus(30, 64)],
    })
    await h.autopilot.start(PROJECT, EPIC)
    await until(async () => (await h.journal()).some((event) => event.kind === 'resumed'), 'the continuation')
    const events = await h.journal()
    expect(h.reads()).toBe(3)
    const kinds = events.map((event) => event.kind)
    const from = kinds.indexOf('limits-hit')
    expect(kinds.slice(from, from + 4)).toEqual(['limits-hit', 'waiting-until', 'waiting-until', 'resumed'])
    expect(events.filter((event) => event.kind === 'waiting-until')).toMatchObject([
      { until: new Date(1_793_003_600_000 + RESUME_MARGIN_MS).toISOString() },
      { until: new Date(1_793_003_600_000 + RESUME_MARGIN_MS).toISOString() },
    ])
    const started = events.find((event) => event.kind === 'wave-started')
    expect(started?.kind === 'wave-started' ? started.limits : null).toEqual({
      windows: [
        expect.objectContaining({ vendor: 'codex', id: 'primary', usedPercent: 12, windowMinutes: 300 }),
        expect.objectContaining({ vendor: 'codex', id: 'secondary', usedPercent: 40, windowMinutes: 10080 }),
      ],
    })
  })

  it('the budget of a Run on Codex reads Codex\'s windows: the 5-hour window used up holds Wave 1 until its reset; the forecast\'s week is the weekly window', async () => {
    const h = harness({
      vendor: () => 'codex',
      scripts: ['turn', 'turn', 'resume'],
      hooksApproved: true,
      limitsClock: CLOCK,
      codexWindows: plus(100, 41),
      budget: { settings: () => ({ enabled: true, reserve: 0.15 }), runs: () => Promise.resolve([]) },
    })
    await h.autopilot.start(PROJECT, EPIC, { mode: 'budget-aware' })
    await until(() => h.autopilot.state(PROJECT).status === 'waiting', 'the budget\'s wait')
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'forecast')).toMatchObject({ week: { utilization: 0.41, resetsAt: new Date(1_793_400_000_000).toISOString() } })
    expect(events.find((event) => event.kind === 'budget-stop')).toMatchObject({ cause: 'five-hour', until: new Date(1_793_003_600_000 + RESUME_MARGIN_MS).toISOString() })
    expect(events.some((event) => event.kind === 'wave-started')).toBe(false)
  })

  it("the budget and the forecast of a Run on Codex take Codex's past Waves and windows: need, samples and fit are Codex's, not Claude's", async () => {
    const h = harness({
      vendor: () => 'codex',
      scripts: ['turn', 'turn', 'resume'],
      hooksApproved: true,
      limitsClock: CLOCK,
      // 40 % of the weekly window used, 15 % kept: today's share of about 10 %, 1 % of it used today, is less
      // than the 30 % one Ticket takes on Codex; Claude's three Waves give no estimate, which would go.
      codexWindows: plus(10, 40),
      budget: { settings: () => ({ enabled: true, reserve: 0.15 }), runs: () => Promise.resolve(pastRuns()) },
    })
    await h.autopilot.start(PROJECT, EPIC, { mode: 'budget-aware' })
    await until(() => h.autopilot.state(PROJECT).status === 'waiting', "the budget's wait")
    const events = await h.journal()
    const forecast = events.find((event) => event.kind === 'forecast')
    // Seven Codex samples (Claude has three); 45 % free before the reset holds one Wave of 30 %.
    expect(forecast).toMatchObject({ samples: 7, fit: 1, week: { utilization: 0.4 } })
    const stop = events.find((event) => event.kind === 'budget-stop')
    expect(stop).toMatchObject({ cause: 'daily-share' })
    expect(stop?.kind === 'budget-stop' ? stop.need : null).toBeCloseTo(0.3, 6)
    expect(events.some((event) => event.kind === 'wave-started')).toBe(false)
  })

  it("run-stopped's actual on Codex is the growth of Codex's weekly window over the run's Wave", async () => {
    const h = harness({
      vendor: () => 'codex',
      scripts: ['turn', 'autopilot-wave', 'resume'],
      hooksApproved: true,
      limitsClock: CLOCK,
      // Read before wave-started at 40 %, before wave-finished at 46 %.
      codexWindows: stale(10, 30, 60 * 60_000),
      reads: [stale(10, 40), stale(12, 46)],
    })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const stopped = (await h.journal()).find((event) => event.kind === 'run-stopped')
    expect(stopped).toMatchObject({ reason: 'no-ready-wave', actual: { waves: 1, counted: 1 } })
    expect(stopped?.kind === 'run-stopped' ? stopped.actual?.share : null).toBeCloseTo(0.06, 6)
    expect(h.reads()).toBe(2)
  })

  it('a window still used up after the wait whose reset is more than 24 h after the wait began: the run stops with limits-timeout, no second wait, no continuation', async () => {
    const far = plus(100, 64).map((each) => (each.id === 'primary' ? { ...each, resetsAt: CLOCK / 1000 + 30 * 3600 } : each))
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'usage-limit-window', 'resume'], hooksApproved: true, limitsClock: CLOCK, fires: 1, reads: [plus(12, 40), far] })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'limits-timeout', resumesAt: null })
    expect(h.autopilot.state(PROJECT).message).toContain('more than 24 h after the wait began')
    const kinds = (await h.journal()).map((event) => event.kind)
    expect(kinds.filter((kind) => kind === 'waiting-until')).toHaveLength(1)
    expect(kinds).not.toContain('resumed')
    expect((await h.journal()).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'limits-timeout' })
  })

  for (const [what, stop] of [
    ['Force stop', (h: ReturnType<typeof harness>) => h.autopilot.forceStop(PROJECT)],
    ['the quit', (h: ReturnType<typeof harness>) => h.autopilot.stopAll()],
  ] as const) {
    it(`${what} during the read of Codex's windows after a wait ends the run at once: no resumed, no new prompt to the Session, even with the windows read no longer used up`, async () => {
      let release!: () => void
      const hold = new Promise<void>((resolve) => (release = resolve))
      // The read has the windows in (none used up, so the run would go on) but does not return until released.
      const h = harness({ vendor: () => 'codex', scripts: ['turn', 'usage-limit-window', 'resume'], hooksApproved: true, limitsClock: CLOCK, fires: 1, codexWindows: plus(10, 10), reads: [plus(30, 40)], hold })
      try {
        await h.autopilot.start(PROJECT, EPIC)
        await until(() => h.reads() === 1, 'the read after the wait')
        const prompts = h.observed.filter((event) => event.type === 'prompt').length
        let stopped = false
        const stopping = stop(h).then(() => (stopped = true))
        await until(() => stopped, `${what} while the read is held`)
        release()
        await stopping
        await new Promise((resolve) => setTimeout(resolve, 200))
        const kinds = (await h.journal()).map((event) => event.kind)
        expect(kinds).not.toContain('resumed')
        expect(kinds).toContain('run-stopped')
        expect(h.observed.filter((event) => event.type === 'prompt').length).toBe(prompts)
        expect(h.autopilot.state(PROJECT).status).toBe('stopped')
      } finally {
        release()
      }
    })
  }

  it('usage-limit-no-windows: a refusal with no window known and the read failing is a window with no reset, rechecked; not vendor-quota', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'usage-limit-no-windows', 'resume'], hooksApproved: true, limitsClock: CLOCK })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'waiting', 'the wait for the Limits')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'waiting', reason: null })
    const events = await h.journal()
    const hit = events.find((event) => event.kind === 'limits-hit')
    expect(hit).toMatchObject({ window: null, resetsAt: null })
    expect(hit).not.toHaveProperty('reason')
    expect(events.some((event) => event.kind === 'run-stopped')).toBe(false)
  })

  it('usage-limit-quota: refused with no window used up, the Run stops at once with vendor-quota and the error text, without a wait', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'usage-limit-quota', 'resume'], hooksApproved: true, limitsClock: CLOCK })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'vendor-quota', message: USAGE_LIMIT, resumesAt: null })
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'limits-hit')).toMatchObject({ window: null, resetsAt: null, reason: 'quota', message: USAGE_LIMIT })
    expect(events.some((event) => event.kind === 'waiting-until')).toBe(false)
    expect(events.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'vendor-quota' })
  })

  it('the gate queue\'s turn asks the Vendor first: hooks turned off by then send no gate queue, and the Run stops with session-error and the reason', async () => {
    // Ticket 01 waits on a Ticket the Epic does not have: no Wave is ready, so the run turns to the gate queue.
    writeTicket('open', 1, [9])
    const plugin = (): string => join(h.hooksHome, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local', '.claude-plugin', 'plugin.json')
    // The Harness is updated while the template is read: Codex's approval was of the old folder's hash.
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'turn', 'resume'], hooksApproved: true, gateQueue: { text: GATE_QUEUE, onRead: () => appendFileSync(plugin(), '\n') } })
    await h.autopilot.start(PROJECT, EPIC)
    const atStart = h.hooksAsked().length
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'session-error', message: CODEX_HOOKS_REFUSAL, wave: 0 })
    expect(h.hooksAsked().length).toBe(atStart + 1)
    const events = await h.journal()
    expect(events.some((event) => event.kind === 'gate-queue')).toBe(false)
    expect(events.filter((event) => event.kind === 'session-error')).toMatchObject([{ message: CODEX_HOOKS_REFUSAL }])
    expect(events.find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'session-error' })
    expect(h.observed.some((event) => event.type === 'prompt' && event.text === GATE_QUEUE)).toBe(false)
  })

  it('with the hooks still approved the gate queue goes as before, after the same check', async () => {
    writeTicket('open', 1, [9])
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'turn', 'resume'], hooksApproved: true, gateQueue: { text: GATE_QUEUE } })
    await h.autopilot.start(PROJECT, EPIC)
    const atStart = h.hooksAsked().length
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave' })
    expect(h.hooksAsked().length).toBe(atStart + 1)
    const kinds = (await h.journal()).map((event) => event.kind)
    expect(kinds.filter((kind) => kind === 'gate-queue' || kind === 'gate-queue-finished' || kind === 'run-stopped')).toEqual(['gate-queue', 'gate-queue-finished', 'run-stopped'])
    expect(h.observed.some((event) => event.type === 'prompt' && event.text === GATE_QUEUE)).toBe(true)
  })
})
