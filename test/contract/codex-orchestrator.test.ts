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
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, STATIC_CLAUDE_PARTS } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { UNATTENDED_MODE_MESSAGE, unattendedPresetMessage } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { Autopilot } from '../../src/main/autopilot/run'
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
import { DEFAULT_SETTINGS, type SessionSettings } from '../../src/shared/agent/settings'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
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
  return { registry, orchestrators, autopilot, layout, journal, logs, logged, request, node, data, observed, transcripts, picks, claudeMessages, hooksHome, hookChecks, hooksAsked }
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
