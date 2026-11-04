// The Orchestrator and Autopilot on Codex (worfy-multi-vendor ticket 37) over the fake app-server
// (WORFY_CODEX=fake, which test/setup-contract.ts sets): the real Session registry, Orchestrators,
// launcher, run journal and cycle, over a copy of a one-Ticket Epic in a temporary folder. The
// Orchestrator's Vendor is the Project's defaultVendor (the `vendor` dep); its Sessions run on the
// Codex driver's session part, each process on its own script and log:
//   - the attended Session the Orchestrator opens with: `turn` (it opens a thread and waits);
//   - the unattended one of the run: `autopilot-wave` — the Wave's turn asks one approval, which the
//     unattended Session declines, and ends. Its thread/start result keeps a recorded sandbox shape
//     (codex-compat.test.ts: no recording has `dangerFullAccess`); worfy does not read it back, and
//     the Full access asked for is checked in what worfy sent;
//   - the attended one it is given back as: `resume`.
// The Claude Sessions of the Vendor switch run on the fake agent (test/fixtures/agent-scripts).
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of the session
// part, as in codex-session.test.ts; the real Codex never starts.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, STATIC_CLAUDE_PARTS } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { Autopilot } from '../../src/main/autopilot/run'
import { LayoutStore } from '../../src/main/layout/store'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexCapabilities } from '../../src/main/vendors/codex/capabilities'
import { codexCommands } from '../../src/main/vendors/codex/commands'
import { UNATTENDED_DECLINED_MESSAGE } from '../../src/main/vendors/codex/approvals'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS, type SessionSettings } from '../../src/shared/agent/settings'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { ORCHESTRATOR_HEIGHT, ORCHESTRATOR_KIND, ORCHESTRATOR_WIDTH, readOrchestratorData } from '../../src/shared/ipc/orchestrator'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import type { VendorId } from '../../src/shared/vendors/vendor'
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

function writeTicket(status: string): void {
  writeFileSync(join(repo, '.scratch', EPIC, 'issues', '01-ticket-1.md'), ['# 01 — Ticket 1', '', 'Type: task', `Status: ${status}`, 'Blocked by: —', ''].join('\n'))
}

/** `epic-status --json` over the Epic's one Ticket, as the real script reads it. */
const runner: EpicStatusRunner = (cwd) => {
  const text = readFileSync(join(cwd, '.scratch', EPIC, 'issues', '01-ticket-1.md'), 'utf8')
  const status = /^Status:\s*(.*)$/m.exec(text)?.[1] ?? null
  const state = /^done\b/i.test(status ?? '') ? 'done' : 'open'
  const ticket = { epic: EPIC, num: 1, slug: 'ticket-1', title: '01 — Ticket 1', statusRaw: status, state, blockedRaw: '—', blockedNums: [], blockedParsed: true }
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticket] }))
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

/**
 * The app's parts over the fakes: the Orchestrators of `vendor()` (the Project's defaultVendor), an
 * Autopilot and its launcher. `scripts`: the Codex script of each app-server process in start order,
 * the last for every later one; each process logs what worfy sent into a file of its own.
 */
function harness(options: { vendor: () => VendorId | undefined; scripts: string[]; settings?: SessionSettings }) {
  const env = { WORFY_DATA_DIR: join(scratch, 'data-root') }
  const logs: string[] = []
  const codex = codexSessions(() => {
    const index = logs.length
    const log = join(scratch, `codex-${index + 1}.log`)
    logs.push(log)
    return Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: options.scripts[Math.min(index, options.scripts.length - 1)]!, WORFY_CODEX_LOG: log },
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
  const picks = new Map<string, SessionSettings>()
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
  return { registry, orchestrators, autopilot, layout, journal, logs, logged, request, node, data, observed, transcripts, picks, claudeMessages }
}

describe('Autopilot on a Codex Orchestrator (worfy-multi-vendor ticket 37)', () => {
  it('drives the Wave through the Codex SessionHandle: Full access, the approval declined and journalled as refused-dialog, run-started names codex, and the Orchestrator goes back attended on the same thread', async () => {
    const h = harness({ vendor: () => 'codex', scripts: ['turn', 'autopilot-wave', 'resume'] })
    await h.autopilot.start(PROJECT, EPIC)
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
    // The Claude Code session is not asked for: it is not the Codex thread's.
    expect(seed.transcripts).toEqual([])
    expect(seed.data()).toEqual({ sessionId: null, costUsd: 0, vendor: 'codex' })

    // The thread is the Node's once Codex names it (at its first turn); the next start resumes it.
    seed.registry.get(view.sessionId!).send('Say hello')
    await until(() => seed.data().sessionId === 'thr_fake_1', 'the thread id in the Node')
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
    expect(h.data()).toEqual({ sessionId: null, costUsd: 0, vendor: 'claude' })
    h.registry.get(fresh.sessionId!).send(WAVE_1)
    await until(() => h.claudeMessages.length === 1, 'the message to Claude Code')
    expect(h.logs).toHaveLength(1)
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
