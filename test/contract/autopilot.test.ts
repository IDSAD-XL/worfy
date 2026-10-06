// Autopilot over one Epic (worfy-daily ticket 04, ADR-0024) on the fake agent: the real Session
// registry, Orchestrators, launcher, run journal and cycle, over a copy of an Epic in a temporary
// folder. The fake agent plays test/fixtures/agent-scripts/autopilot-waves.jsonl; this test does
// what the agent would, and marks the Tickets of each Wave done when "Run wave" reaches it.
// keep-awake is a fake (src/main/autopilot/power.ts is tested over Electron's in
// test/unit/autopilot-power.test.ts), so nothing here keeps the Mac awake.
import { readdirSync, readFileSync, realpathSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher, AUTOPILOT_RUNNING_HINT } from '../../src/main/actions/launch'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { AUTOPILOT_OWNS_ORCHESTRATOR, Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore, UNATTENDED_MODE_MESSAGE } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { Autopilot, alreadyRunning, selfProjectRefusal, SELF_PROJECT_MESSAGE, type AutopilotDeps } from '../../src/main/autopilot/run'
import { agentHandlers } from '../../src/main/ipc/agent'
import { autopilotHandlers } from '../../src/main/ipc/autopilot'
import { appUrlMatcher, emit, registerIpc } from '../../src/main/ipc/index'
import { LayoutStore } from '../../src/main/layout/store'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { autopilotChanged, autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
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
const ticketPath = (num: number): string => join(repo, '.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`)

function writeTicket(num: number, status: string): void {
  const { blocked } = TICKETS.find((each) => each.num === num)!
  writeFileSync(ticketPath(num), [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n'))
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
  // What the agent does: marks the Wave's Tickets done before its turn ends.
  if (options.agentMarksDone !== false) {
    registry.observe((_sessionId, event) => {
      if (event.type !== 'prompt') return
      if (event.text === '/epic-wave волна 1 эпика demo') for (const num of [1, 2]) writeTicket(num, 'done — 2026-10-06')
      if (event.text === '/epic-wave волна 2 эпика demo') writeTicket(3, 'done — 2026-10-06')
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
    const first = await h.autopilot.start(PROJECT, EPIC)
    expect(first).toMatchObject({ projectId: PROJECT, epic: EPIC, status: 'running' })
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')

    expect(h.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave', wave: 2 })
    expect(messages(h.calls)).toEqual(['/epic-wave волна 1 эпика demo', '/epic-wave волна 2 эпика demo'])
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
    // keep-awake from start to stop, once each.
    expect(h.power).toEqual(['start', 'stop'])
    // The status line runs through the Waves and ends with the reason.
    const lines = h.states.map((state) => autopilotStatusLine(state))
    expect(lines).toContain('Wave 1 · running')
    expect(lines).toContain('Wave 2 · running')
    expect(lines.at(-1)).toBe('stopped: no ready wave')
    // worfy wrote nothing into the repository: only the agent's status changes are there.
    const after = tree()
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    for (const path of Object.keys(before)) if (!path.includes('issues')) expect(after[path]).toBe(before[path])
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

  it('Stop ends the run with user-stop and releases keep-awake; the Orchestrator turns attended once its turn ends', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => messages(h.calls).length === 1, 'Wave 1')
    expect(h.power).toEqual(['start'])
    const stopped = await h.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop', wave: 1 })
    expect(h.power).toEqual(['start', 'stop'])
    expect((await h.kinds()).at(-1)).toEqual(['run-stopped', 'user-stop'])
    // The turn still runs: the Orchestrator stays unattended until it ends.
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    await (await h.session()).interrupt()
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the attended Orchestrator')
    expect(h.requests.at(-1)?.unattended).toBe(false)
  })

  it('refuses "New conversation" of the Orchestrator while the run has it', async () => {
    const h = harness({ script: 'orchestrator' })
    await h.autopilot.start(PROJECT, EPIC)
    await expect(h.orchestrators.newConversation(PROJECT)).rejects.toThrow(AUTOPILOT_OWNS_ORCHESTRATOR)
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
    await expect(h.launcher.runWave(PROJECT, EPIC)).resolves.toMatchObject({ text: '/epic-wave волна 2 эпика demo' })
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
  })

  it('a workflow change that takes the last Ticket out of work finishes the Wave', async () => {
    const h = harness({ agentMarksDone: false })
    h.registry.observe((_id, event) => {
      if (event.type === 'prompt' && event.text.includes('волна 1')) {
        writeTicket(1, 'done — 2026-10-06')
        writeTicket(2, 'claimed — 2026-10-06')
      }
      if (event.type === 'prompt' && event.text.includes('волна 2')) writeTicket(3, 'done — 2026-10-06')
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
    expect(messages(h.calls)).toEqual([])
    expect(h.power).toEqual(['start', 'stop'])
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
  const state = (overrides: Partial<AutopilotState> = {}): AutopilotState => ({ projectId: 'p', epic: 'e', status: 'running', wave: 1, reason: null, message: null, revision: 3, ...overrides })

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
