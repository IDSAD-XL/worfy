// Autopilot over one Epic (worfy-daily ticket 04, ADR-0024) on the fake agent: the real Session
// registry, Orchestrators, launcher, run journal and cycle, over a copy of an Epic in a temporary
// folder. The fake agent plays test/fixtures/agent-scripts/autopilot-waves.jsonl; this test does
// what the agent would, and marks the Tickets of each Wave done when "Run wave" reaches it.
// keep-awake is a fake (src/main/autopilot/power.ts is tested over Electron's in
// test/unit/autopilot-power.test.ts), so nothing here keeps the Mac awake.
import { existsSync, readdirSync, readFileSync, realpathSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher, AUTOPILOT_RUNNING_HINT } from '../../src/main/actions/launch'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { AUTOPILOT_OWNS_ORCHESTRATOR, ORCHESTRATOR_HAS_QUEUE, ORCHESTRATOR_IN_TURN, Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore, UNATTENDED_MODE_MESSAGE } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { Autopilot, alreadyRunning, selfProjectRefusal, SELF_PROJECT_MESSAGE, type AutopilotDeps } from '../../src/main/autopilot/run'
import { agentHandlers } from '../../src/main/ipc/agent'
import { autopilotHandlers } from '../../src/main/ipc/autopilot'
import { sendFromCard } from '../../src/main/ipc/card-api'
import { appUrlMatcher, emit, registerIpc } from '../../src/main/ipc/index'
import { LayoutStore } from '../../src/main/layout/store'
import { applyBranches, readCheckout, readWorkflow, type BranchCache, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { autopilotChanged, autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { AUTOPILOT_TEMPLATE_HINT, DEFAULT_ACTION_TEMPLATES, LEGACY_RUN_WAVE_TEMPLATE } from '../../src/shared/projects/action-templates'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const PROJECT = 'demo-000000a4'
const EPIC = 'demo'

let scratch: string
let repo: string
let registries: SessionRegistry[] = []
let autopilots: Autopilot[] = []

// ── the Epic in a temporary folder ───────────────────────────────────────────

// Wave 1: 01 and 02; Wave 2: 03 (after 01 and 02).
const TICKETS = [
  { num: 1, blocked: '—' },
  { num: 2, blocked: '—' },
  { num: 3, blocked: '01, 02' },
]
const nn = (num: number): string => String(num).padStart(2, '0')
/** What the default Run wave template sends for each Wave (ticket 30: the Wave's Tickets, ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
const WAVE_2 = '/epic-wave Ticket-ы 03 эпика demo'
const ticketPath = (num: number): string => join(repo, '.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`)

/** Every file the test itself wrote into the repository, as the agent would, with its last content. */
const written = new Map<string, string>()

function writeTicket(num: number, status: string): void {
  const { blocked } = TICKETS.find((each) => each.num === num)!
  const content = [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
  written.set(relative(repo, ticketPath(num)), content)
  writeFileSync(ticketPath(num), content)
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
    const state = /^done$/i.test(word) ? 'done' : /^claimed$/i.test(word) ? 'work' : /^blocked$/i.test(word) ? 'blocked' : 'open'
    const nums = blocked && blocked !== '—' ? blocked.split(',').map((each) => Number(each.trim())) : []
    const match = /^(\d+)-(.*)\.md$/.exec(name)!
    return { epic: EPIC, num: Number(match[1]), slug: match[2], title: text.split('\n')[0]!.replace(/^#\s*/, ''), statusRaw: status, state, blockedRaw: blocked, blockedNums: nums, blockedParsed: true }
  })
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets }))
}

/** Every file of the repository with its content. */
function tree(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(repo, path)] = readFileSync(path, 'utf8')
    }
  }
  walk(repo)
  return out
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autopilot-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  for (const { num } of TICKETS) writeTicket(num, 'open')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
})

afterEach(async () => {
  for (const autopilot of autopilots) await autopilot.stopAll()
  autopilots = []
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

// ── the harness ──────────────────────────────────────────────────────────────

async function until(condition: () => boolean | Promise<boolean>, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

interface HarnessOptions {
  /** The script of the unattended Session (default autopilot-waves); attended ones play `attended`. */
  script?: string
  attended?: string
  /** Marks the Tickets of a Wave done when its "Run wave" reaches the agent (default true). */
  agentMarksDone?: boolean
  selfRefusal?: AutopilotDeps['selfRefusal']
  settleMs?: number
  /** Each journal line is written this much later, as on a slow disk. */
  slowJournalMs?: number
  /** Worktree branches laid over the checkout as the reader does (applyBranches); default: the reader's own. */
  branches?: BranchCache
  /** The Project's Run wave template (default DEFAULT_ACTION_TEMPLATES.runWave). */
  runWave?: string
}

function harness(options: HarnessOptions = {}) {
  const env = { WORFY_DATA_DIR: join(scratch, 'data-root') }
  const calls: (FakeCall & { unattended: boolean })[] = []
  const requests: QueryRequest[] = []
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    const unattended = request.unattended === true
    return fakeQueryFactory({
      scriptsDir,
      script: unattended ? (options.script ?? 'autopilot-waves') : (options.attended ?? 'autopilot-waves'),
      record: (call) => calls.push({ ...call, unattended }),
    })(request)
  })
  registries.push(registry)
  const settings = new SessionSettingsStore((projectId) => join(scratch, 'data', projectId))
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
    projectPath: () => repo,
    registry,
    settings,
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  const branches = options.branches
  const workflow = async (root: string) =>
    branches === undefined ? (await readWorkflow({ root, claudeHome: join(scratch, 'claude-home') }, runner)).model : applyBranches(await readCheckout(root, runner), branches)
  const launcher = new ActionLauncher({
    projectRoot: () => repo,
    settings: () => ({ actionTemplates: { ...DEFAULT_ACTION_TEMPLATES, ...(options.runWave === undefined ? {} : { runWave: options.runWave }) } }),
    branch: () => Promise.resolve('main'),
    workflow,
    sessions: { create: () => ({ nodeId: 'n', sessionId: 's' }) as never },
    orchestrators,
    registry,
    bindings: { setLaunch: () => undefined },
    pollMs: 5,
    waitMs: 200,
  })
  // What the agent does: marks the Wave's Tickets done before its turn ends.
  if (options.agentMarksDone !== false) {
    registry.observe((_sessionId, event) => {
      if (event.type !== 'prompt') return
      if (event.text === WAVE_1) for (const num of [1, 2]) writeTicket(num, 'done — 2026-10-06')
      if (event.text === WAVE_2) writeTicket(3, 'done — 2026-10-06')
    })
  }
  const power: string[] = []
  const states: AutopilotState[] = []
  const workflowListeners = new Set<() => void>()
  const autopilot = new Autopilot({
    projectRoot: () => repo,
    selfRefusal: options.selfRefusal ?? (() => Promise.resolve(null)),
    workflow,
    watchWorkflow: (_root, onChange) => {
      workflowListeners.add(onChange)
      return Promise.resolve(() => {
        workflowListeners.delete(onChange)
      })
    },
    orchestrators,
    registry,
    waves: launcher,
    journal: async (start) => {
      const opened = await openRun(start, { env })
      const slow = options.slowJournalMs
      if (slow === undefined) return opened
      const append = async (fields: Parameters<typeof opened.append>[0]): Promise<void> => {
        await new Promise((done) => setTimeout(done, slow))
        await opened.append(fields)
      }
      return { run: opened.run, append }
    },
    keepAwake: () => ({ start: () => power.push('start'), stop: () => power.push('stop') }),
    onChange: (state) => states.push(state),
    settleMs: options.settleMs ?? 60_000,
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  const journal = async (): Promise<JournalEvent[]> => {
    const dir = join(env.WORFY_DATA_DIR, 'autopilot')
    const runs = readdirSync(dir).map((name) => name.replace(/\.jsonl$/, ''))
    expect(runs).toHaveLength(1)
    return (await readRun(runs[0]!, { env }))!.events
  }
  const kinds = async () => (await journal()).map((event) => [event.kind, 'wave' in event ? event.wave : 'reason' in event ? event.reason : 'what' in event ? event.what : null])
  /** The Orchestrator's live Session. */
  const session = async () => registry.get((await orchestrators.open(PROJECT)).sessionId ?? '')
  const changed = () => {
    for (const listener of workflowListeners) listener()
  }
  return { registry, orchestrators, launcher, autopilot, calls, requests, power, states, journal, kinds, session, settings, changed, env }
}

const messages = (calls: FakeCall[]) => calls.filter((call): call is Extract<FakeCall, { kind: 'message' }> => call.kind === 'message').map((call) => call.text)

// ── the runs ─────────────────────────────────────────────────────────────────

describe('an Autopilot run on the fake agent', () => {
  it('runs Wave 1, then Wave 2, then stops with no-ready-wave; the journal keeps that order', async () => {
    const h = harness()
    const before = tree()
    written.clear()
    const first = await h.autopilot.start(PROJECT, EPIC)
    expect(first).toMatchObject({ projectId: PROJECT, epic: EPIC, status: 'running' })
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')

    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave', wave: 2 })
    expect(messages(h.calls)).toEqual([WAVE_1, WAVE_2])
    expect(await h.kinds()).toEqual([
      ['run-started', null],
      ['wave-started', 1],
      ['wave-finished', 1],
      ['wave-started', 2],
      ['wave-finished', 2],
      ['run-stopped', 'no-ready-wave'],
    ])
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'wave-started')).toMatchObject({ project: PROJECT, epic: EPIC, wave: 1, tickets: ['01', '02'] })
    expect(events.filter((event) => event.kind === 'wave-finished').map((event) => (event as { tickets: string[] }).tickets)).toEqual([['01', '02'], ['03']])
    // Each Wave's line carries the text that went, which names the line's Tickets (ADR-0033).
    expect(events.filter((event) => event.kind === 'wave-started').map((event) => [(event as { text?: string }).text, (event as { skipped?: unknown[] }).skipped])).toEqual([
      [WAVE_1, []],
      [WAVE_2, []],
    ])
    // The stop carries the Orchestrator's answer of the last Wave.
    expect(events.at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'no-ready-wave', lastText: 'Wave done: its Tickets are merged and marked done.' })
    // keep-awake from start to stop, once each.
    expect(h.power).toEqual(['start', 'stop'])
    // The status line runs through the Waves and ends with the reason.
    const lines = h.states.map((state) => autopilotStatusLine(state))
    expect(lines).toContain('Wave 1 · running')
    expect(lines).toContain('Wave 2 · running')
    expect(lines.at(-1)).toBe('stopped: no ready wave')
    // worfy wrote nothing into the repository: every file is as before, or byte for byte what the
    // agent wrote (here the test, as the agent); worfy never writes a Ticket status (ADR-0002).
    expect(written.size).toBeGreaterThan(0)
    expect(tree()).toEqual({ ...before, ...Object.fromEntries(written) })
  })

  it('reports a run stopped only once its end is journaled and keep-awake released', async () => {
    const h = harness({ slowJournalMs: 30 })
    await h.autopilot.start(PROJECT, EPIC)
    const seen: string[] = []
    await until(async () => {
      const state = h.autopilot.state(PROJECT)
      if (state.status === 'running') {
        expect(state.reason).toBeNull()
        return false
      }
      seen.push(...(await h.kinds()).map(([kind]) => kind as string))
      return true
    }, 'the run to stop')
    expect(seen.at(-1)).toBe('run-stopped')
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.states.at(-1)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave' })
    expect(h.states.filter((state) => state.status === 'stopped')).toHaveLength(1)
  })

  it('runs the Orchestrator unattended, continuing its SDK session, and gives it back attended after the run', async () => {
    // The Orchestrator Node, with the user's own picks saved for it.
    writeFileSync(join(scratch, 'data', PROJECT, 'layout.json'), JSON.stringify({ nodes: [{ id: 'orch', kind: 'orchestrator', x: 0, y: 0, w: 300, h: 180, locked: true, data: {} }] }))
    const h = harness()
    h.settings.write(PROJECT, 'orch', { ...DEFAULT_SETTINGS, permissionMode: 'default' })
    const opened = await h.orchestrators.open(PROJECT)
    expect(opened.nodeId).toBe('orch')
    expect(h.requests[0]?.settings.permissionMode).toBe('default')
    await h.autopilot.start(PROJECT, EPIC)
    const unattended = h.requests.find((request) => request.unattended === true)
    expect(unattended?.settings.permissionMode).toBe('bypassPermissions')
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    await until(() => h.requests.at(-1)?.unattended === false, 'the attended Orchestrator')
    // The attended Session after the run continues the SDK session of the run.
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    expect(typeof h.requests.at(-1)?.resume).toBe('string')
    // The forced bypassPermissions was not saved over the user's pick, and the Orchestrator has it back.
    expect(h.settings.read(PROJECT, 'orch')?.permissionMode).toBe('default')
    expect(h.requests.at(-1)?.settings.permissionMode).toBe('default')
  })

  it('refuses a change of the Orchestrator\'s permission mode during the run, and journals the attempt', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    const ipc = await agentIpc(h.registry)
    const id = (await h.session()).id
    expect(await ipc('agent.configure', { sessionId: id, change: { permissionMode: 'default' } })).toEqual({ ok: false, error: `agent.configure failed: ${UNATTENDED_MODE_MESSAGE}` })
    expect((await h.session()).settings.permissionMode).toBe('bypassPermissions')
    await until(async () => (await h.kinds()).some(([kind]) => kind === 'human-input'), 'the human-input line')
    expect((await h.journal()).filter((event) => event.kind === 'human-input')).toEqual([expect.objectContaining({ source: 'worfy', what: 'changed the permission mode' })])
  })

  it('journals a message of the user to the run\'s Orchestrator and "Send queued" as human-input from worfy', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    const ipc = await agentIpc(h.registry)
    const id = (await h.session()).id
    expect((await ipc('agent.send', { sessionId: id, text: 'how is it going?', attachments: [] })).ok).toBe(true)
    expect((await ipc('agent.queueSend', { sessionId: id })).ok).toBe(true)
    await until(async () => (await h.kinds()).filter(([kind]) => kind === 'human-input').length === 2, 'two human-input lines')
    expect((await h.journal()).filter((event) => event.kind === 'human-input').map((event) => [(event as { source: string }).source, (event as { what: string }).what])).toEqual([
      ['worfy', 'sent a message'],
      ['worfy', 'pressed Send queued'],
    ])
  })

  it('journals a dialog the unattended Orchestrator refused', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    ;(await h.session()).refuseDialog('card_ask', 'card-7', 'No one is at this Session')
    await until(async () => (await h.kinds()).some(([kind]) => kind === 'refused-dialog'), 'the refused-dialog line')
    expect((await h.journal()).find((event) => event.kind === 'refused-dialog')).toMatchObject({ what: 'card_ask card-7', session: (await h.session()).id })
  })

  it('does not journal what a person does in another Session', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    const other = h.registry.start(repo, undefined, () => undefined)
    const ipc = await agentIpc(h.registry)
    expect((await ipc('agent.send', { sessionId: other.id, text: 'unrelated', attachments: [] })).ok).toBe(true)
    await h.autopilot.stop(PROJECT)
    expect((await h.kinds()).map(([kind]) => kind)).not.toContain('human-input')
  })

  it('a Session in error stops the run with session-error; keep-awake is released and both are in the journal', async () => {
    const h = harness({ script: 'crash' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'session-error' })
    expect(h.autopilot.state(PROJECT).message).toContain('Claude Code process exited with code 1')
    expect(h.power).toEqual(['start', 'stop'])
    expect(await h.kinds()).toEqual([
      ['run-started', null],
      ['wave-started', 1],
      ['session-error', null],
      ['run-stopped', 'session-error'],
    ])
    const error = (await h.journal()).find((event) => event.kind === 'session-error')
    expect(error).toMatchObject({ message: expect.stringContaining('Claude Code process exited with code 1') })
  })

  it('Stop ends the run with user-stop: it interrupts the Orchestrator\'s turn, gives the Orchestrator back and releases keep-awake before it answers (worfy-week ticket 17)', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    const unattended = await h.session()
    expect(unattended.state).toBe('busy')
    expect(h.power).toEqual(['start'])
    const stopped = await h.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop', wave: 1 })
    expect((await h.kinds()).slice(-2)).toEqual([
      ['run-stopped', 'user-stop'],
      ['orchestrator-returned', null],
    ])
    // The turn ended on the interrupt (the script's turn waits for it); no new turn follows.
    expect(unattended.state).toBe('closed')
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(h.requests.at(-1)?.unattended).toBe(false)
    expect(h.power).toEqual(['start', 'stop'])
    await new Promise((done) => setTimeout(done, 50))
    expect(messages(h.calls)).toHaveLength(1)
  })

  it('refuses "New conversation" of the Orchestrator while the run has it', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await expect(h.orchestrators.newConversation(PROJECT)).rejects.toThrow(AUTOPILOT_OWNS_ORCHESTRATOR)
  })

  it('journals Interrupt, closing the Session, removing a queued message and answering a permission request as human-input', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    const ipc = await agentIpc(h.registry)
    const id = (await h.session()).id
    expect((await ipc('agent.send', { sessionId: id, text: 'a question', attachments: [] })).ok).toBe(true)
    const queued = (await h.session()).queued().items[0]!
    expect(await ipc('agent.queueRemove', { sessionId: id, id: queued.id })).toEqual({ ok: true, value: { removed: true } })
    expect(await ipc('agent.permission', { sessionId: id, requestId: 'no-such-request', decision: 'allow' })).toEqual({ ok: true, value: { answered: false } })
    // Closing during a turn is refused, and journaled all the same: a person stepped in.
    expect((await ipc('agent.close', { sessionId: id })).ok).toBe(false)
    expect((await ipc('agent.interrupt', { sessionId: id })).ok).toBe(true)
    await until(async () => (await h.kinds()).filter(([kind]) => kind === 'human-input').length === 5, 'five human-input lines')
    expect((await h.journal()).filter((event) => event.kind === 'human-input').map((event) => (event as { what: string }).what)).toEqual([
      'sent a message',
      'removed a queued message',
      'answered a permission request',
      'closed the Session',
      'interrupted the turn',
    ])
  })

  it('journals a Card message the user sent to the run\'s Orchestrator as human-input', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    const session = await h.session()
    sendFromCard(h.registry, session.id, 'Card "Notes" asks: is the Wave done?')
    expect(session.queued().items.map((item) => item.text)).toEqual(['Card "Notes" asks: is the Wave done?'])
    await until(async () => (await h.kinds()).some(([kind]) => kind === 'human-input'), 'the human-input line')
    expect((await h.journal()).filter((event) => event.kind === 'human-input')).toEqual([expect.objectContaining({ source: 'worfy', what: 'sent a message from a Card' })])
  })

  it('refuses to start while the attended Orchestrator is in a turn, and starts no Session', async () => {
    const h = harness({ attended: 'orchestrator' })
    const opened = await h.orchestrators.open(PROJECT)
    const session = h.registry.get(opened.sessionId ?? '')
    await until(() => session.state === 'idle', 'the idle Orchestrator')
    session.send('a long task')
    expect(session.state).toBe('busy')
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(ORCHESTRATOR_IN_TURN)
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(session.state).toBe('busy')
    expect(h.power).toEqual([])
    expect(h.autopilot.running(PROJECT)).toBe(false)
  })

  it('takes a new start at once after Stop: no turn of the stopped run is left to wait for (worfy-week ticket 17)', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    await h.autopilot.stop(PROJECT)
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    // After Stop no new turn: the stopped run's Wave is not sent again by itself.
    expect(messages(h.calls)).toHaveLength(1)
    expect((await h.session()).queued().items).toEqual([])
    // The attended Session is still coming up; the start waits for nothing else.
    await expect(h.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running' })
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false, true])
  })

  it('refuses to start while messages wait in the Orchestrator\'s queue', async () => {
    const h = harness({ attended: 'orchestrator' })
    const session = await h.session()
    await until(() => session.state === 'idle', 'the idle Orchestrator')
    session.send('a long task')
    session.send('then this')
    // Interrupt holds the queue; the turn ends and the Orchestrator is idle with a held message.
    await session.interrupt()
    await until(() => session.state === 'idle', 'the end of the turn')
    expect(session.queued()).toMatchObject({ items: [{ text: 'then this' }], paused: true })
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(ORCHESTRATOR_HAS_QUEUE)
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(session.queued().items.map((item) => item.text)).toEqual(['then this'])
  })

  it('carries the queue of the run\'s Orchestrator over to the attended Session after the run, held as it was', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    const unattended = await h.session()
    unattended.send('look at ticket 02 when you can')
    // Stop interrupts the turn and holds the queue; the Orchestrator is attended when it answers.
    await h.autopilot.stop(PROJECT)
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    const attended = await h.session()
    expect(attended).not.toBe(unattended)
    expect(attended.queued()).toMatchObject({ items: [{ text: 'look at ticket 02 when you can' }], paused: true })
    // Held, it goes only on "Send queued", into the attended Session.
    attended.sendQueued()
    await until(() => messages(h.calls).includes('look at ticket 02 when you can'), 'the carried message')
    expect(h.calls.find((call) => call.kind === 'message' && call.text === 'look at ticket 02 when you can')?.unattended).toBe(false)
  })

  it('on app-quit leaves the Orchestrator as it is: no attended Session is started, also once the turn ends', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    await h.autopilot.stopAll()
    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'app-quit' })
    const session = await h.session()
    await session.interrupt()
    await until(() => session.state === 'idle', 'the end of the turn')
    await new Promise((done) => setTimeout(done, 50))
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])
  })

  it('refuses a second start on the same Project while a run goes on, also when both come at once', async () => {
    const h = harness({ script: 'orchestrator' })
    const both = await Promise.allSettled([h.autopilot.start(PROJECT, EPIC), h.autopilot.start(PROJECT, EPIC)])
    expect(both.map((each) => each.status).sort()).toEqual(['fulfilled', 'rejected'])
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(alreadyRunning(EPIC))
    expect(h.power).toEqual(['start'])
  })

  it('refuses "Run wave" by hand while the run goes on, and allows it again after', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await expect(h.launcher.runWave(PROJECT, EPIC)).rejects.toThrow(AUTOPILOT_RUNNING_HINT)
    await h.autopilot.stop(PROJECT)
    expect(h.autopilot.running(PROJECT)).toBe(false)
    // Wave 1 is done by now (the agent marked it when it got the run's "Run wave").
    await expect(h.launcher.runWave(PROJECT, EPIC)).resolves.toMatchObject({ text: WAVE_2 })
  })

  it('a Ticket of the Wave left in work after the turn stops the run with wave-unfinished once the settle time is out', async () => {
    const h = harness({ agentMarksDone: false, settleMs: 50 })
    h.registry.observe((_id, event) => {
      if (event.type === 'prompt') {
        writeTicket(1, 'done — 2026-10-06')
        writeTicket(2, 'claimed — 2026-10-06')
      }
    })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(h.autopilot.state(PROJECT).reason).toBe('wave-unfinished')
    expect((await h.kinds()).map(([kind]) => kind)).not.toContain('wave-finished')
    // The Wave's turn answered, but only a stop for want of a Wave carries the answer (ADR-0033).
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'wave-unfinished' })
    expect((await h.journal()).at(-1)).not.toHaveProperty('lastText')
  })

  it('a workflow change that takes the last Ticket out of work finishes the Wave', async () => {
    const h = harness({ agentMarksDone: false })
    h.registry.observe((_id, event) => {
      if (event.type === 'prompt' && event.text === WAVE_1) {
        writeTicket(1, 'done — 2026-10-06')
        writeTicket(2, 'claimed — 2026-10-06')
      }
      if (event.type === 'prompt' && event.text === WAVE_2) writeTicket(3, 'done — 2026-10-06')
    })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    await new Promise((done) => setTimeout(done, 100))
    expect(messages(h.calls)).toHaveLength(1)
    writeTicket(2, 'done — 2026-10-06')
    h.changed()
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(messages(h.calls)).toHaveLength(2)
    expect(h.autopilot.state(PROJECT).reason).toBe('no-ready-wave')
  })

  it('an Epic with nothing ready stops at once with no-ready-wave', async () => {
    const h = harness()
    for (const { num } of TICKETS) writeTicket(num, 'done — 2026-10-06')
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect(await h.kinds()).toEqual([
      ['run-started', null],
      ['run-stopped', 'no-ready-wave'],
    ])
    // No turn of a Wave: no answer to carry.
    expect((await h.journal()).at(-1)).not.toHaveProperty('lastText')
    expect(messages(h.calls)).toEqual([])
    expect(h.power).toEqual(['start', 'stop'])
  })

  // ── ticket 30 (ADR-0033): blocked Tickets stay out of the Wave, the text names the Wave's Tickets ──

  /** The worktree branch of Ticket 02 that never touched its file: Status open, as on its base. */
  const untouchedBranch = (): BranchCache => new Map([['demo/02', { head: 'b0', ticket: { epic: EPIC, num: 2, state: 'open', statusRaw: 'open' }, error: null }]])
  const ANSWER = 'Волна уже закрыта, перезапускать в ней нечего.'

  it('repeats the run of 2026-10-06 15:24Z: a Ticket blocked in the checkout and open in its branch stays out; the journal shows what went, the answer and the skipped Ticket', async () => {
    writeTicket(2, 'blocked — rejected by review')
    const h = harness({ script: 'autopilot-blocked', agentMarksDone: false, branches: untouchedBranch() })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')

    expect(h.autopilot.state(PROJECT).reason).toBe('no-progress')
    expect(messages(h.calls)).toEqual(['/epic-wave Ticket-ы 01 эпика demo'])
    const events = await h.journal()
    expect(events.map((event) => event.kind)).toEqual(['run-started', 'wave-started', 'wave-finished', 'run-stopped'])
    const started = events.find((event) => event.kind === 'wave-started')
    expect(started).toMatchObject({ wave: 1, tickets: ['01'], skipped: [{ num: '02', state: 'blocked' }], text: '/epic-wave Ticket-ы 01 эпика demo' })
    // The list in the text is the list of the line.
    expect((started as { text: string }).text).toContain((started as { tickets: string[] }).tickets.join(', '))
    expect(events.at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'no-progress', lastText: ANSWER })
    expect(events.at(-1)).not.toHaveProperty('tickets')
  })

  it('stops at once with blocked-tickets when only a blocked Ticket has its blockers done: no Wave, no text, no lastText', async () => {
    writeTicket(1, 'done — 2026-10-06')
    writeTicket(2, 'blocked — waits for the owner')
    const h = harness({ agentMarksDone: false, branches: untouchedBranch() })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')

    expect(h.autopilot.state(PROJECT).reason).toBe('blocked-tickets')
    expect(messages(h.calls)).toEqual([])
    const events = await h.journal()
    expect(events.map((event) => event.kind)).toEqual(['run-started', 'run-stopped'])
    expect(events.at(-1)).toMatchObject({ reason: 'blocked-tickets', tickets: ['02'] })
    expect(events.at(-1)).not.toHaveProperty('lastText')
  })

  it('after a Wave, stops with blocked-tickets and the Orchestrator\'s last answer when the next Tickets wait for a blocked one', async () => {
    writeTicket(2, 'blocked — waits for the owner')
    const h = harness({ script: 'autopilot-blocked', agentMarksDone: false })
    h.registry.observe((_id, event) => {
      if (event.type === 'prompt' && event.text === '/epic-wave Ticket-ы 01 эпика demo') writeTicket(1, 'done — 2026-10-06')
    })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')

    const events = await h.journal()
    expect(events.map((event) => event.kind)).toEqual(['run-started', 'wave-started', 'wave-finished', 'run-stopped'])
    expect(events.at(-1)).toMatchObject({ reason: 'blocked-tickets', tickets: ['02'], lastText: ANSWER })
  })

  it('keeps the first 1000 characters of a longer answer, so run-stopped still reaches the journal', async () => {
    const answer = JSON.parse(readFileSync(join(scriptsDir, 'autopilot-long.jsonl'), 'utf8').split('\n')[3]!).result as string
    expect(answer.length).toBeGreaterThan(1000)
    const h = harness({ script: 'autopilot-long' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')

    expect(h.autopilot.state(PROJECT).reason).toBe('no-ready-wave')
    const last = (await h.journal()).at(-1) as { kind: string; reason: string; lastText?: string }
    expect(last).toMatchObject({ kind: 'run-stopped', reason: 'no-ready-wave' })
    expect(last.lastText).toHaveLength(1000)
    expect(last.lastText).toBe(answer.slice(0, 1000))
  })

  it('does not carry an answer of one Wave into the next: a Wave whose turn ends without text stops with no lastText', async () => {
    // Wave 1's turn answers, Wave 2's ends with an empty result.
    const h = harness({ script: 'autopilot-silent-second' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')

    expect(h.autopilot.state(PROJECT)).toMatchObject({ reason: 'no-ready-wave', wave: 2 })
    expect(messages(h.calls)).toEqual([WAVE_1, WAVE_2])
    const last = (await h.journal()).at(-1)
    expect(last).toMatchObject({ kind: 'run-stopped', reason: 'no-ready-wave' })
    expect(last).not.toHaveProperty('lastText')
  })

  it('does not start with a Run wave template that does not name the Wave\'s tickets: nothing is journaled or sent', async () => {
    const h = harness({ runWave: LEGACY_RUN_WAVE_TEMPLATE })
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(AUTOPILOT_TEMPLATE_HINT)
    expect(h.autopilot.running(PROJECT)).toBe(false)
    expect(existsSync(join(h.env.WORFY_DATA_DIR, 'autopilot'))).toBe(false)
    expect(h.requests.some((request) => request.unattended === true)).toBe(false)
    expect(h.power).toEqual([])
    // By hand, the same template still runs a Wave: a person presses the button.
    await expect(h.launcher.runWave(PROJECT, EPIC)).resolves.toMatchObject({ text: '/epic-wave волна 1 эпика demo' })
  })

  it('a refused start leaves nothing behind: no journal, no keep-awake, the Orchestrator untouched', async () => {
    const h = harness({ selfRefusal: () => Promise.resolve(SELF_PROJECT_MESSAGE) })
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(SELF_PROJECT_MESSAGE)
    await expect(h.autopilot.start(PROJECT, 'no-such-epic').catch((error: Error) => error.message)).resolves.toBe(SELF_PROJECT_MESSAGE)
    expect(h.power).toEqual([])
    expect(h.requests).toEqual([])
    expect(() => statSync(join(h.env.WORFY_DATA_DIR, 'autopilot'))).toThrow()
    expect(h.autopilot.running(PROJECT)).toBe(false)
  })

  it('refuses an Epic the Project does not have', async () => {
    const h = harness()
    await expect(h.autopilot.start(PROJECT, 'other')).rejects.toThrow('The Project has no Epic other')
    expect(h.power).toEqual([])
  })
})

// ── worfy's own repository ───────────────────────────────────────────────────

describe('selfProjectRefusal', () => {
  const sameGit = (dir: string) => Promise.resolve(dir.startsWith(join(scratch, 'worfy')) ? join(scratch, 'worfy', '.git') : null)

  it('on a development build refuses the app\'s own folder and any checkout of its repository', async () => {
    mkdirSync(join(scratch, 'worfy', '.claude', 'worktrees', '04'), { recursive: true })
    const appPath = join(scratch, 'worfy', '.claude', 'worktrees', '04')
    expect(await selfProjectRefusal({ packaged: false, appPath, projectRoot: appPath, gitCommonDir: () => Promise.resolve(null) })).toBe(SELF_PROJECT_MESSAGE)
    expect(await selfProjectRefusal({ packaged: false, appPath, projectRoot: join(scratch, 'worfy'), gitCommonDir: sameGit })).toBe(SELF_PROJECT_MESSAGE)
    expect(SELF_PROJECT_MESSAGE).toContain('stable copy')
  })

  it('lets another Project run on a development build, and any Project on a packaged one', async () => {
    mkdirSync(join(scratch, 'worfy'), { recursive: true })
    const appPath = join(scratch, 'worfy')
    expect(await selfProjectRefusal({ packaged: false, appPath, projectRoot: repo, gitCommonDir: sameGit })).toBeNull()
    expect(await selfProjectRefusal({ packaged: true, appPath, projectRoot: appPath, gitCommonDir: sameGit })).toBeNull()
  })

  it('the run itself refuses such a Project with that text', async () => {
    const h = harness({ selfRefusal: (root) => selfProjectRefusal({ packaged: false, appPath: repo, projectRoot: root, gitCommonDir: () => Promise.resolve(null) }) })
    await expect(h.autopilot.start(PROJECT, EPIC)).rejects.toThrow(SELF_PROJECT_MESSAGE)
  })
})

// ── the IPC boundary ─────────────────────────────────────────────────────────

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

async function ipcOver(modules: Record<string, () => Promise<unknown>>): Promise<(channel: string, input: unknown) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, Listener>()
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener as Listener) }, { modules: modules as never, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  return async (channel, input) => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: `file://${INDEX_HTML}` }, sender: { id: 1, once: () => undefined } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

const agentIpc = (registry: SessionRegistry) => ipcOver({ './agent.ts': async () => agentHandlers(() => registry) })

describe('the autopilot channels', () => {
  const state = (overrides: Partial<AutopilotState> = {}): AutopilotState => ({ projectId: 'p', epic: 'e', status: 'running', wave: 1, backgroundTasks: 0, resumesAt: null, reason: null, message: null, resumable: [], revision: 3, ...overrides })

  async function register() {
    const calls: unknown[][] = []
    const autopilot = {
      start: (projectId: string, epic: string) => {
        calls.push(['start', projectId, epic])
        if (epic === 'busy') return Promise.reject(new Error('The Orchestrator is in a turn'))
        return Promise.resolve({ ...state(), extra: 'secret' } as AutopilotState)
      },
      stop: (projectId: string) => {
        calls.push(['stop', projectId])
        return Promise.resolve({ ...state({ status: 'stopped', reason: 'user-stop' }), journal: '/secret' } as AutopilotState)
      },
      state: (projectId: string) => {
        calls.push(['state', projectId])
        return projectId === 'bad' ? ({ ...state(), status: 'paused' } as unknown as AutopilotState) : state()
      },
    }
    const invoke = await ipcOver({ './autopilot.ts': async () => autopilotHandlers(() => autopilot as never) })
    return { invoke, calls }
  }

  it('autopilot.start passes only the Project and the Epic, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    expect(await invoke('autopilot.start', { projectId: 'p', epic: 'e', force: true })).toEqual({ ok: true, value: state() })
    expect(calls).toEqual([['start', 'p', 'e']])
  })

  it('autopilot.start refuses a wrong type before Autopilot runs, and answers its refusal as {ok:false}', async () => {
    const { invoke, calls } = await register()
    for (const input of [{ projectId: '', epic: 'e' }, { projectId: 'p', epic: '../e' }, { projectId: 'p' }, { projectId: 1, epic: 'e' }, undefined]) {
      expect((await invoke('autopilot.start', input)).ok, JSON.stringify(input)).toBe(false)
    }
    expect(calls).toEqual([])
    expect(await invoke('autopilot.start', { projectId: 'p', epic: 'busy' })).toEqual({ ok: false, error: 'autopilot.start failed: The Orchestrator is in a turn' })
  })

  it('autopilot.stop and autopilot.state pass only the Project and strip unknown keys', async () => {
    const { invoke, calls } = await register()
    expect(await invoke('autopilot.stop', { projectId: 'p', reason: 'app-quit' })).toEqual({ ok: true, value: state({ status: 'stopped', reason: 'user-stop' }) })
    expect(await invoke('autopilot.state', { projectId: 'p' })).toEqual({ ok: true, value: state() })
    expect(calls).toEqual([
      ['stop', 'p'],
      ['state', 'p'],
    ])
    expect((await invoke('autopilot.stop', { projectId: 7 })).ok).toBe(false)
    expect((await invoke('autopilot.state', {})).ok).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it('an answer outside the contract does not reach the renderer', async () => {
    const { invoke } = await register()
    expect((await invoke('autopilot.state', { projectId: 'bad' })).ok).toBe(false)
  })

  it('autopilot.changed sends only the contract keys, and refuses a payload of the wrong type', () => {
    const sent: unknown[] = []
    const target = { send: (_channel: string, payload: unknown) => sent.push(payload) }
    emit(target, autopilotChanged, { ...state(), extra: 1 } as AutopilotState)
    expect(sent).toEqual([state()])
    expect(() => emit(target, autopilotChanged, state({ reason: 'tired' as never }))).toThrow('invalid event payload')
    expect(() => emit(target, autopilotChanged, state({ wave: -1 }))).toThrow('invalid event payload')
  })
})

describe('autopilotStatusLine', () => {
  it('says the Wave while running and the reason once stopped', () => {
    expect(autopilotStatusLine({ status: 'running', wave: 3, reason: null })).toBe('Wave 3 · running')
    expect(autopilotStatusLine({ status: 'running', wave: 0, reason: null })).toBe('starting')
    expect(autopilotStatusLine({ status: 'stopped', wave: 2, reason: 'no-ready-wave' })).toBe('stopped: no ready wave')
    expect(autopilotStatusLine({ status: 'stopped', wave: 0, reason: null })).toBeNull()
  })
})
