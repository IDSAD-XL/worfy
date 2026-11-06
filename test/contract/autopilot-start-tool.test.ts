// The canvas tool autopilot_start (worfy-flight-recorder ticket 23, ADR-0091), called through the
// canvas MCP server the way Claude Code calls it. A person confirms the start in the Start Autopilot
// window of worfy, its "Agent asks" view (worfy-autopilot-queue ticket 11): main sends
// `autopilot.confirm.ask` to a window of the Project's Machine (a stand-in webContents here) and waits
// 10 minutes (fake timers) for that window's `autopilot.confirm.answer`; a Run mode goes to the real
// ChatStarts.startFromChat, whose Autopilot is a stand-in that records every start (its `journal`, with
// the Run mode the start names, as run-started of the real run carries it). An unattended Session, a
// Project with a run under way and a Machine without a worfy window are refused without an ask. The
// app's own wiring (appAutopilotStarter, the starter of appDeps, the handler of `autopilot.confirm.answer`)
// runs over a stand-in Session registry, ChatStarts, Project list, workflow read, run journals, Limits
// and Settings. No native message box is shown any more: the stand-in of Electron's counts any, and
// every test ends with none. No Claude Code and no agent start here.
//
// The Run mode and the forecast (worfy-resource-planner ticket 06): the ask carries the default mode of
// Settings and the forecast lines of the past runs' journals; the window answers the mode chosen.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatStarts, chatRunningHint, WAIT_MESSAGE, type ChatStartDeps } from '../../src/main/autopilot/chat-start'
import type { AutopilotPrompt } from '../../src/main/autopilot/chat-confirm'
import type { AutopilotStartOptions } from '../../src/main/autopilot/run'
import type { CanvasContext, ToolResult } from '../../src/main/mcp/canvas-server'
import type { LimitsState } from '../../src/shared/agent/limits'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import type { RunMode } from '../../src/shared/autopilot/run-mode'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { AutopilotConfirmAnswer, AutopilotConfirmAsk } from '../../src/shared/ipc/autopilot-confirm'
import { IPC_CHANNEL_PREFIX } from '../../src/shared/ipc/channels'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

/** What the mocked modules below answer; each test sets its own. */
const app = vi.hoisted(() => ({
  focused: null as unknown,
  windows: [] as unknown[],
  /** Every native message box main tried to show: none, since worfy-autopilot-queue ticket 11. */
  messageBoxes: 0,
  /** Session id → whether it runs unattended; a Session not here is not in the registry. */
  sessions: new Map<string, boolean>(),
  /** The unattended Sessions whose run has stopped and which only wait to be given back (Orchestrators.awaitsGiveBack). */
  givingBack: new Set<string>(),
  chat: null as unknown,
  workflowReads: [] as string[],
  /** What readRecentRuns answers; null: the journals cannot be read. */
  runs: [] as unknown[][] | null,
  runReads: [] as string[],
  limits: { windows: {} } as unknown,
  /** The Vendor the Project's Orchestrator runs on (Orchestrators.runsOn) and each Vendor's windows (LimitsTracker.windowsOf). */
  vendor: 'claude',
  vendorWindows: {} as Record<string, unknown[]>,
  /** The app settings main reads: the default Run mode and the budget (Settings → Autopilot). */
  settings: {} as unknown,
}))

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getFocusedWindow: () => app.focused, getAllWindows: () => app.windows, fromWebContents: () => null },
  dialog: {
    showMessageBox: () => {
      app.messageBoxes += 1
      return Promise.reject(new Error('no message box: autopilot_start asks in the window of worfy'))
    },
  },
}))
vi.mock('../../src/main/agent/app-registry', () => ({
  sharedRegistry: () => ({
    get: (sessionId: string) => {
      const unattended = app.sessions.get(sessionId)
      if (unattended === undefined) throw new Error(`no Session ${sessionId}`)
      return { unattended }
    },
  }),
}))
vi.mock('../../src/main/agent/app-orchestrators', () => ({
  sharedOrchestrators: () => ({ awaitsGiveBack: (sessionId: string) => app.givingBack.has(sessionId), runsOn: () => app.vendor }),
}))
vi.mock('../../src/main/ipc/autopilot', () => ({ sharedChatStarts: () => app.chat }))
vi.mock('../../src/main/workflow/reader', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readWorkflow: (options: { root: string }) => {
    app.workflowReads.push(options.root)
    return Promise.resolve({ model: MODEL })
  },
}))
vi.mock('../../src/main/autopilot/journal', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readRecentRuns: (projectId: string) => {
    app.runReads.push(projectId)
    return app.runs === null ? Promise.reject(new Error('the journals cannot be read')) : Promise.resolve(app.runs)
  },
}))
vi.mock('../../src/main/agent/limits', async (importOriginal) => ({ ...(await importOriginal<object>()), appLimits: () => ({ snapshot: () => app.limits, windowsOf: (vendor: string) => app.vendorWindows[vendor] ?? null }) }))
vi.mock('../../src/main/settings/store', async (importOriginal) => ({ ...(await importOriginal<object>()), appSettingsStore: () => ({ get: () => app.settings }) }))
vi.mock('../../src/main/projects/store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  projectStore: () => ({ get: (id: string) => ({ id, name: PROJECT_NAME, path: PROJECT_ROOT }), list: () => [], dataDir: () => '/Users/someone/data' }),
}))

const PROJECT = 'demo-000000a4'
const PROJECT_NAME = 'Demo shop'
const PROJECT_ROOT = '/Users/someone/demo'
const EPIC = 'demo'
const ORCHESTRATOR = 'orch-session'
const NODE_SESSION = 'node-session'
const AUTOPILOT_SESSION = 'autopilot-session'

const t = (num: number): Ticket => ({
  epic: EPIC,
  num,
  slug: `slug-${num}`,
  title: `T${num}`,
  statusRaw: 'open',
  state: 'open',
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
})
const MODEL = { root: PROJECT_ROOT, epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [t(5), t(6), t(7)], error: null, branchErrors: [] } as unknown as WorkflowModel

/** The time of the dialog's forecast in the tests over `tool`. */
const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const HOUR = 3_600_000
/** The 7-day window resets two days after NOW. */
const RESETS = NOW + 48 * HOUR
/** The Limits now: 80 % of the week used, the number fresh. */
const LIMITS: LimitsState = { windows: { seven_day: { utilization: 0.8, resetsAt: RESETS / 1000, status: null, receivedAt: NOW, source: 'usage' } } }

/**
 * One past run of `waves` Waves of one Ticket each, an hour long, each taking 10 % of the week with a
 * fresh number at both ends: from five on, the forecast has a range and the Wave duration a p90.
 */
function pastRuns(waves: number): JournalEvent[][] {
  const iso = (ms: number): string => new Date(ms).toISOString()
  const common = (ms: number) => ({ at: iso(ms), run: '2026-11-01T10-00-00-000Z-a1b2c3', project: PROJECT, epic: EPIC })
  const week = (utilization: number, ms: number) => ({ five_hour: null, seven_day: { utilization, receivedAt: iso(ms), resetsAt: iso(RESETS) } })
  const events = [{ ...common(NOW - 30 * HOUR), kind: 'run-started' } as JournalEvent]
  for (let wave = 1; wave <= waves; wave += 1) {
    const start = NOW - 24 * HOUR + (wave - 1) * 2 * HOUR
    events.push({ ...common(start), kind: 'wave-started', wave, tickets: ['01'], limits: week((wave - 1) / 10, start) })
    events.push({ ...common(start + HOUR), kind: 'wave-finished', wave, tickets: ['01'], limits: week(wave / 10, start + HOUR) })
  }
  return [events]
}

/**
 * A past run on Codex with `waves` Waves (worfy-multi-vendor ticket 38): each Wave uses 5 % of Plus's
 * weekly `secondary` window, its lines carry the {windows} shape.
 */
function pastCodexRuns(waves: number): JournalEvent[][] {
  const iso = (ms: number): string => new Date(ms).toISOString()
  const common = (ms: number) => ({ at: iso(ms), run: '2026-11-01T09-00-00-000Z-c0d3c0', project: PROJECT, epic: EPIC })
  const window = (id: string, minutes: number, used: number, ms: number) => ({ vendor: 'codex', id, label: id, usedPercent: used, windowMinutes: minutes, resetsAt: iso(RESETS), receivedAt: iso(ms), state: 'ok', source: 'read' })
  const plus = (week: number, ms: number) => ({ windows: [window('primary', 300, 10, ms), window('secondary', 10080, week, ms)] })
  const events = [{ ...common(NOW - 30 * HOUR), kind: 'run-started' } as JournalEvent]
  for (let wave = 1; wave <= waves; wave += 1) {
    const start = NOW - 24 * HOUR + (wave - 1) * 2 * HOUR
    events.push({ ...common(start), kind: 'wave-started', wave, tickets: ['01'], limits: plus(20 + (wave - 1) * 5, start) } as JournalEvent)
    events.push({ ...common(start + HOUR), kind: 'wave-finished', wave, tickets: ['01'], limits: plus(20 + wave * 5, start + HOUR) } as JournalEvent)
  }
  return [events]
}

let windowsMade = 0

/** A window of this Machine; `calls` records what was done to it, `sent` the events its page got. */
function localWindow(name: string, state: { visible?: boolean; minimized?: boolean } = {}) {
  const calls: string[] = []
  const sent: { channel: string; payload: unknown }[] = []
  const closedListeners = new Set<() => void>()
  let visible = state.visible ?? true
  let minimized = state.minimized ?? false
  let destroyed = false
  windowsMade += 1
  const window = {
    name,
    calls,
    sent,
    webContents: {
      id: windowsMade,
      isDestroyed: () => destroyed,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    },
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
    restore: () => {
      calls.push('restore')
      minimized = false
    },
    show: () => {
      calls.push('show')
      visible = true
    },
    once: (event: string, listener: () => void) => {
      if (event === 'closed') closedListeners.add(listener)
    },
    removeListener: (event: string, listener: () => void) => {
      if (event === 'closed') closedListeners.delete(listener)
    },
    /** The person closes the window. */
    close: () => {
      destroyed = true
      for (const listener of [...closedListeners]) listener()
      closedListeners.clear()
    },
    /** How many listeners of its close the asks left on it. */
    closedListeners: () => closedListeners.size,
  }
  return window as unknown as BrowserWindow & { calls: string[]; sent: typeof sent; close(): void; closedListeners(): number }
}

type LocalWindow = ReturnType<typeof localWindow>

/** The asks `window` got, as its page receives them. */
const asksOf = (window: LocalWindow): AutopilotConfirmAsk[] =>
  window.sent.filter((each) => each.channel === `${IPC_CHANNEL_PREFIX}autopilot.confirm.ask`).map((each) => each.payload as AutopilotConfirmAsk)

/** The ids of the asks main closed on `window`: their time was up. */
const closesOf = (window: LocalWindow): string[] =>
  window.sent.filter((each) => each.channel === `${IPC_CHANNEL_PREFIX}autopilot.confirm.close`).map((each) => (each.payload as { id: string }).id)

let confirm: typeof import('../../src/main/autopilot/chat-confirm')
let server: typeof import('../../src/main/mcp/canvas-server')

beforeEach(async () => {
  app.focused = null
  app.windows = []
  app.sessions = new Map([
    [ORCHESTRATOR, false],
    [NODE_SESSION, false],
    [AUTOPILOT_SESSION, true],
  ])
  app.givingBack = new Set()
  app.chat = null
  app.workflowReads = []
  app.runs = []
  app.runReads = []
  app.limits = { windows: {} }
  app.vendor = 'claude'
  app.vendorWindows = {}
  app.settings = {}
  app.messageBoxes = 0
  vi.resetModules()
  confirm = await import('../../src/main/autopilot/chat-confirm')
  server = await import('../../src/main/mcp/canvas-server')
})

afterEach(() => {
  vi.useRealTimers()
  expect(app.messageBoxes).toBe(0)
})

/**
 * The window of the Project's Machine that is asked, over its own WindowAsks: `shown` — the asks its
 * page got; `answer` — what the person chose in the last one, sent back from this window.
 */
function windowAsk() {
  const owner = localWindow('project machine')
  const asks = new confirm.WindowAsks()
  return {
    owner,
    asks,
    get shown(): AutopilotConfirmAsk[] {
      return asksOf(owner)
    },
    answer: (answer: AutopilotConfirmAnswer) => {
      const last = asksOf(owner).at(-1)
      if (last === undefined) throw new Error('no ask is open')
      asks.answer(last.id, answer, owner.webContents.id)
    },
  }
}

/** The options of a start as the stand-in records them: without the listener of a late refusal (run.ts). */
const recorded = (start: AutopilotStartOptions | undefined): AutopilotStartOptions | undefined =>
  start === undefined ? undefined : (Object.fromEntries(Object.entries(start).filter(([key]) => key !== 'onLateRefusal')) as AutopilotStartOptions)

/**
 * The real starts from a chat over a stand-in Autopilot; `journal` gets a line for every run that starts.
 * With `orchestratorBusy` the run is accepted and waits for the Orchestrator, as the real one does
 * (worfy-autopilot-queue ticket 07): its journal opens at once all the same.
 */
function world(options: { running?: string | null; orchestratorBusy?: boolean } = {}) {
  const out = {
    running: options.running ?? null,
    starts: [] as [string, string, AutopilotStartOptions | undefined][],
    journal: [] as string[],
    busy: options.orchestratorBusy ?? false,
  }
  const deps: ChatStartDeps = {
    autopilot: {
      runningEpic: () => out.running,
      start: (projectId, epic, start) => {
        out.starts.push([projectId, epic, recorded(start)])
        // run-started of the real run (run.ts) carries the start's mode, else the default of Settings.
        out.journal.push(`run-started ${start?.mode ?? 'default'}`)
        out.running = epic
        const state = out.busy ? { projectId, epic, status: 'waiting', waitingFor: 'orchestrator' } : { projectId, epic, status: 'running' }
        return Promise.resolve(state as unknown as AutopilotState)
      },
    },
    workflow: () => Promise.resolve(MODEL),
    notify: () => undefined,
  }
  const chat = new ChatStarts(deps)
  const startFromChat = vi.spyOn(chat, 'startFromChat')
  return { out, chat, startFromChat }
}

/** The tool over the stand-ins, asking in the window of `ask`. */
function tool(
  w: ReturnType<typeof world>,
  ask: ReturnType<typeof windowAsk>,
  options: {
    workflow?: () => Promise<WorkflowModel>
    runs?: () => Promise<JournalEvent[][]>
    mode?: RunMode
    limits?: LimitsState
    window?: { from: number; to: number }
    reserve?: number
  } = {},
) {
  const confirmations = vi.fn((prompt: AutopilotPrompt) => ask.asks.ask(ask.owner, prompt))
  const starter = confirm.autopilotStarter({
    unattended: (sessionId) => app.sessions.get(sessionId) ?? null,
    awaitsGiveBack: (sessionId) => app.givingBack.has(sessionId),
    busy: (projectId) => w.chat.busyRefusal(projectId),
    workflow: options.workflow ?? (() => Promise.resolve(MODEL)),
    projectName: () => PROJECT_NAME,
    confirm: confirmations,
    startFromChat: (request) => w.chat.startFromChat(request),
    forecast: {
      runs: options.runs ?? (() => Promise.resolve([])),
      limits: () => options.limits ?? LIMITS,
      settings: () => ({ run: { mode: options.mode ?? 'budget-aware', window: options.window ?? { from: 23, to: 7 } }, budget: { enabled: false, reserve: options.reserve ?? 0.15 } }),
      now: () => NOW,
    },
  })
  return { starter, confirmations }
}

interface Rpc {
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>
  names(): Promise<string[]>
}

/** Connects to the canvas server of Session `sessionId` as Claude Code would: initialize, then requests. */
async function connect(sessionId: string | null, autopilotStart: CanvasContext['autopilotStart']): Promise<Rpc> {
  const config = await server.createCanvasServer({
    projectId: PROJECT,
    cardsDir: '/Users/someone/no-cards',
    layout: {
      get: () => {
        throw new Error('autopilot_start reads no Layout')
      },
      apply: () => {
        throw new Error('autopilot_start changes no Layout')
      },
    },
    workflow: () => Promise.resolve(MODEL),
    sessionId: () => sessionId,
    ...(autopilotStart === undefined ? {} : { autopilotStart }),
  })
  type Message = { id?: number; result?: unknown; error?: unknown }
  const pending = new Map<number, (message: Message) => void>()
  const transport: { onmessage?: (message: unknown) => void; start(): Promise<void>; close(): Promise<void>; send(message: Message): Promise<void> } = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    send: (message) => {
      const resolve = message.id === undefined ? undefined : pending.get(message.id)
      if (resolve && message.id !== undefined) {
        pending.delete(message.id)
        resolve(message)
      }
      return Promise.resolve()
    },
  }
  await config.instance.connect(transport as never)
  let next = 0
  const request = (method: string, params: unknown): Promise<Message> =>
    new Promise((resolve) => {
      next += 1
      pending.set(next, resolve)
      transport.onmessage?.({ jsonrpc: '2.0', id: next, method, params })
    })
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return {
    call: async (name, args = {}) => {
      const answer = await request('tools/call', { name, arguments: args })
      if (answer.error !== undefined) return { content: [{ type: 'text', text: JSON.stringify(answer.error) }], isError: true }
      return answer.result as ToolResult
    },
    names: async () => ((await request('tools/list', {})).result as { tools: { name: string }[] }).tools.map((each) => each.name),
  }
}

const textOf = (result: ToolResult): string => result.content[0]?.text ?? ''

/** Lets the call reach its ask: the workflow read and the server's own steps are promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('autopilot_start: the ask in the window of worfy and its start', () => {
  it('is a tool of the worfy-canvas server', async () => {
    expect(await (await connect(NODE_SESSION, undefined)).names()).toContain('autopilot_start')
  })

  it('asks the window with the Project, the Epic, the named Tickets and the Session; a Run mode calls startFromChat with them, `tool` and the mode, and the run starts', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05', '06'] })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    expect(ask.shown[0]).toEqual({
      id: expect.any(String),
      projectId: PROJECT,
      project: PROJECT_NAME,
      epic: EPIC,
      tickets: [5, 6],
      session: NODE_SESSION,
      mode: 'budget-aware',
      // No past runs: the forecast says so (dialogLines).
      forecast: [
        'Forecast: This Epic: 1 Wave, 2 Tickets left. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 80%, resets in 2 d 0 h.',
        'Start window 23:00–07:00. Not enough data on Wave duration: every Wave may start inside the window.',
      ],
      waitMs: confirm.CONFIRM_WAIT_MS,
    })
    expect(w.startFromChat).not.toHaveBeenCalled()
    ask.answer('fastest')
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(`Autopilot started Tickets 05, 06 of Epic ${EPIC}.`)
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [5, 6], by: 'tool', session: NODE_SESSION, mode: 'fastest' })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [5, 6], mode: 'fastest' }]])
    expect(w.out.journal).toEqual(['run-started fastest'])
    // The answered ask leaves nothing on the window: no close, no listener of its close.
    expect(closesOf(ask.owner)).toEqual([])
    expect(ask.owner.closedListeners()).toBe(0)
  })

  it('without Tickets the ask names no Ticket, and the whole Epic starts', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    expect(ask.shown[0]).not.toHaveProperty('tickets')
    ask.answer('fastest')
    expect(textOf(await call)).toBe(`Autopilot started Epic ${EPIC}.`)
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, by: 'tool', session: NODE_SESSION, mode: 'fastest' })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', mode: 'fastest' }]])
  })

  it('Cancel is a refusal: no startFromChat, no run, nothing in the journal', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05'] })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer('cancel')
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.CANCELED_MESSAGE)
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.starts).toEqual([])
    expect(w.out.journal).toEqual([])
  })

  it('a run that started while the window asked: the start answers the refusal of startFromChat, not a start', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    // The person pressed the Autopilot button of Epic billing while the window asked.
    w.out.running = 'billing'
    ask.answer('fastest')
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(chatRunningHint('billing'))
    expect(w.startFromChat).toHaveBeenCalledOnce()
    expect(w.out.starts).toEqual([])
  })

  it('a second call while the first ask waits is refused without a second ask', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const first = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    const second = await rpc.call('autopilot_start', { epic: EPIC, tickets: ['07'] })
    expect(second.isError).toBe(true)
    expect(textOf(second)).toBe(confirm.CONFIRM_PENDING_MESSAGE)
    expect(ask.shown).toHaveLength(1)
    ask.answer('cancel')
    await first
    expect(w.out.starts).toEqual([])
  })

  it('a window open for another start answers `occupied`: the Session is told so, nothing starts', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer('occupied')
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.WINDOW_OCCUPIED_MESSAGE)
    expect(w.startFromChat).not.toHaveBeenCalled()
  })

  it('the window closed while it asks: no window to answer, nothing starts', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.owner.close()
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.NO_WINDOW_MESSAGE)
    expect(w.startFromChat).not.toHaveBeenCalled()
  })

  it("only the window asked answers: another window's answer is refused and the ask still waits", async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    const { id } = ask.shown[0]!
    const other = localWindow('another window')
    expect(() => ask.asks.answer(id, 'fastest', other.webContents.id)).toThrow('This window was not asked to confirm this start of Autopilot')
    expect(w.startFromChat).not.toHaveBeenCalled()
    ask.answer('cancel')
    expect(textOf(await call)).toBe(confirm.CANCELED_MESSAGE)
    // An answer after the ask is over changes nothing.
    ask.asks.answer(id, 'fastest', ask.owner.webContents.id)
    expect(w.startFromChat).not.toHaveBeenCalled()
  })
})

describe('autopilot_start: no answer in 10 minutes', () => {
  it('closes the window and refuses with "No one confirmed"; no run starts, and a late answer changes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    let result: ToolResult | null = null
    void rpc.call('autopilot_start', { epic: EPIC }).then((answer) => (result = answer))
    for (let i = 0; i < 50 && ask.shown.length === 0; i += 1) await settle()
    expect(ask.shown).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(confirm.CONFIRM_WAIT_MS - 1)
    expect(result).toBeNull()
    expect(closesOf(ask.owner)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(result).not.toBeNull()
    expect(result!.isError).toBe(true)
    expect(textOf(result!)).toBe(confirm.NO_ONE_CONFIRMED)
    expect(textOf(result!)).toMatch(/^No one confirmed/u)
    // The window is told to close, not left asking on the screen.
    expect(closesOf(ask.owner)).toEqual([ask.shown[0]!.id])
    expect(ask.owner.closedListeners()).toBe(0)
    ask.answer('fastest')
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.starts).toEqual([])
    expect(confirm.CONFIRM_WAIT_MS).toBe(10 * 60_000)
  })
})

describe("autopilot_start: the ask goes to a window of the Project's Machine, never without one", () => {
  it('the focused window when it is on screen, else the first window on screen', () => {
    const hidden = localWindow('hidden', { visible: false })
    const minimized = localWindow('minimized', { minimized: true })
    const shown = localWindow('shown')
    app.windows = [hidden, minimized, shown]
    expect(confirm.dialogOwner()).toBe(shown)
    app.focused = minimized
    expect(confirm.dialogOwner()).toBe(shown)
    app.focused = hidden
    expect(confirm.dialogOwner()).toBe(shown)
    const other = localWindow('other')
    app.windows = [hidden, other]
    app.focused = other
    expect(confirm.dialogOwner()).toBe(other)
    expect([...hidden.calls, ...minimized.calls, ...shown.calls, ...other.calls]).toEqual([])
  })

  it('a minimised or hidden window is brought back before the ask goes to it', () => {
    const minimized = localWindow('minimized', { minimized: true })
    app.windows = [minimized]
    app.focused = minimized
    expect(confirm.dialogOwner()).toBe(minimized)
    expect(minimized.calls).toEqual(['restore', 'show'])
    const hidden = localWindow('hidden', { visible: false })
    app.windows = [hidden]
    app.focused = null
    expect(confirm.dialogOwner()).toBe(hidden)
    expect(hidden.calls).toEqual(['show'])
  })

  it('no window at all: null', () => {
    app.windows = []
    expect(confirm.dialogOwner()).toBeNull()
  })
})

describe('autopilot_start: refusals without an ask', () => {
  it('an unattended Session (Autopilot) is refused: no ask, no start', async () => {
    const w = world()
    const ask = windowAsk()
    const { starter, confirmations } = tool(w, ask)
    const result = await (await connect(AUTOPILOT_SESSION, starter)).call('autopilot_start', { epic: EPIC, tickets: ['05'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.UNATTENDED_MESSAGE)
    expect(confirmations).not.toHaveBeenCalled()
    expect(ask.shown).toEqual([])
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.starts).toEqual([])
  })

  it("an Orchestrator's unattended Session whose run has stopped and which waits to be given back is asked; once a run drives it again, it is refused (worfy-polish ticket 50)", async () => {
    // The run stopped (turn-error) while the Orchestrator's background tasks live: its Session stays
    // unattended until they end, and the person asks in it for a new run.
    app.sessions.set(ORCHESTRATOR, true)
    app.givingBack.add(ORCHESTRATOR)
    const w = world({ orchestratorBusy: true })
    const ask = windowAsk()
    const { starter } = tool(w, ask)
    const rpc = await connect(ORCHESTRATOR, starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['06'] })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer('fastest')
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(WAIT_MESSAGE)
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [6], mode: 'fastest' }]])
    // The new run has taken the Session over: no one is at it again, and nothing is asked.
    app.givingBack.delete(ORCHESTRATOR)
    w.out.running = null
    const again = await rpc.call('autopilot_start', { epic: EPIC })
    expect(again.isError).toBe(true)
    expect(textOf(again)).toBe(confirm.UNATTENDED_MESSAGE)
    expect(ask.shown).toHaveLength(1)
  })

  it('a Session worfy does not know, or a call before the Session id is known, is refused the same way', async () => {
    const w = world()
    const ask = windowAsk()
    const { starter } = tool(w, ask)
    for (const session of ['someone-else', null]) {
      const result = await (await connect(session, starter)).call('autopilot_start', { epic: EPIC })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe(confirm.UNKNOWN_SESSION_MESSAGE)
    }
    expect(ask.shown).toEqual([])
    expect(w.out.starts).toEqual([])
  })

  it('while a run goes on: the hint to stop it first, no ask, no new journal line', async () => {
    const w = world({ running: 'billing' })
    w.out.journal.push('run-started')
    const ask = windowAsk()
    const result = await (await connect(NODE_SESSION, tool(w, ask).starter)).call('autopilot_start', { epic: EPIC })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(chatRunningHint('billing'))
    expect(textOf(result)).toBe('Autopilot is already running Epic billing. Stop it first.')
    expect(ask.shown).toEqual([])
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.journal).toEqual(['run-started'])
  })

  it('while a run waits for the busy Orchestrator: the running hint, no second ask (worfy-autopilot-queue ticket 07)', async () => {
    const w = world({ orchestratorBusy: true })
    const ask = windowAsk()
    const { starter } = tool(w, ask)
    const call = (await connect(ORCHESTRATOR, starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer('fastest')
    expect(textOf(await call)).toBe(WAIT_MESSAGE)
    const again = await (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC, tickets: ['07'] })
    expect(again.isError).toBe(true)
    expect(textOf(again)).toBe(chatRunningHint(EPIC))
    expect(ask.shown).toHaveLength(1)
    expect(w.startFromChat).toHaveBeenCalledOnce()
  })

  it('an Epic or a Ticket the Project has not, or a workflow that cannot be read, is refused before anyone is asked', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask).starter)
    expect(textOf(await rpc.call('autopilot_start', { epic: 'billing' }))).toBe('The Project has no Epic billing')
    expect(textOf(await rpc.call('autopilot_start', { epic: EPIC, tickets: ['05', '09'] }))).toBe(`Epic ${EPIC} has no Ticket 09`)
    const unreadable = { ...MODEL, error: { message: 'no .scratch' } } as unknown as WorkflowModel
    const broken = await (await connect(NODE_SESSION, tool(w, ask, { workflow: () => Promise.resolve(unreadable) }).starter)).call('autopilot_start', { epic: EPIC })
    expect(broken.isError).toBe(true)
    expect(textOf(broken)).toBe('Cannot read the workflow: no .scratch')
    expect(ask.shown).toEqual([])
    expect(w.out.starts).toEqual([])
  })

  it('a server without the starter refuses, and a call without an Epic is a form error', async () => {
    const rpc = await connect(NODE_SESSION, undefined)
    const refused = await rpc.call('autopilot_start', { epic: EPIC })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(server.NO_AUTOPILOT_MESSAGE)
    const w = world()
    const ask = windowAsk()
    const malformed = await (await connect(NODE_SESSION, tool(w, ask).starter)).call('autopilot_start', { tickets: ['05'] })
    expect(malformed.isError).toBe(true)
    expect(textOf(malformed)).toMatch(/epic/u)
    expect(ask.shown).toEqual([])
  })
})

describe("autopilot_start from the Project's Orchestrator in its turn", () => {
  it('answers that Autopilot waits for the Orchestrator: the run is accepted at once and waits by the common path (worfy-autopilot-queue ticket 07)', async () => {
    const w = world({ orchestratorBusy: true })
    const ask = windowAsk()
    const rpc = await connect(ORCHESTRATOR, tool(w, ask).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['06'] })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer('fastest')
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(WAIT_MESSAGE)
    expect(textOf(result)).toBe('Autopilot waits for the Orchestrator and starts when it is free')
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [6], by: 'tool', session: ORCHESTRATOR, mode: 'fastest' })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [6], mode: 'fastest' }]])
    expect(w.out.journal).toEqual(['run-started fastest'])
  })
})

describe("autopilot_start: the app's wiring (appDeps().autopilotStart, appAutopilotStarter, autopilot.confirm.answer)", () => {
  /** The app's starter of every Session, over the stand-ins of the mocked modules. */
  function appWorld() {
    const w = world()
    app.chat = w.chat
    const starter = server.appDeps().autopilotStart
    if (starter === undefined) throw new Error('the app gives no autopilot_start')
    return { w, starter }
  }

  /** The app's handler of `autopilot.confirm.answer`, called from the page of `from`. */
  async function answerFrom(from: LocalWindow, id: string, answer: AutopilotConfirmAnswer): Promise<void> {
    const { default: handlers } = await import('../../src/main/ipc/autopilot-confirm')
    const handler = handlers.find((each) => each.channel.name === 'autopilot.confirm.answer')
    if (handler === undefined) throw new Error('no handler of autopilot.confirm.answer')
    await handler.handle({ id, answer }, { event: { sender: from.webContents } } as never)
  }

  it('reads the Session registry at the call: an unattended Session and one not in the registry are refused, and nothing is asked', async () => {
    const { starter, w } = appWorld()
    const main = localWindow('main')
    app.windows = [main]
    expect(textOf(await (await connect(AUTOPILOT_SESSION, starter)).call('autopilot_start', { epic: EPIC }))).toBe(confirm.UNATTENDED_MESSAGE)
    expect(textOf(await (await connect('gone-session', starter)).call('autopilot_start', { epic: EPIC }))).toBe(confirm.UNKNOWN_SESSION_MESSAGE)
    // The same Session once the registry says it runs unattended (Autopilot took it).
    app.sessions.set(NODE_SESSION, true)
    expect(textOf(await (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC }))).toBe(confirm.UNATTENDED_MESSAGE)
    expect(asksOf(main)).toEqual([])
    // The app's Orchestrators say when such a Session's run has stopped and it only waits to be given back: then it is asked.
    app.givingBack.add(NODE_SESSION)
    const asked = (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(asksOf(main)).toHaveLength(1))
    await answerFrom(main, asksOf(main)[0]!.id, 'cancel')
    expect(textOf(await asked)).toBe(confirm.CANCELED_MESSAGE)
    app.givingBack.delete(NODE_SESSION)
    // The app's ChatStarts says whether a run goes on.
    w.out.running = 'billing'
    expect(textOf(await (await connect(ORCHESTRATOR, starter)).call('autopilot_start', { epic: EPIC }))).toBe(chatRunningHint('billing'))
    expect(asksOf(main)).toHaveLength(1)
    expect(w.startFromChat).not.toHaveBeenCalled()
  })

  it('with no worfy window on the Machine: refused at once, and nothing is asked', async () => {
    const { starter, w } = appWorld()
    app.windows = []
    const result = await (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.NO_WINDOW_MESSAGE)
    expect(w.startFromChat).not.toHaveBeenCalled()
  })

  it("asks the window of this Machine, brought back first, with the Project from the list and the workflow of its root; that window's answer goes to the app's ChatStarts", async () => {
    const { starter, w } = appWorld()
    const main = localWindow('main', { minimized: true })
    app.windows = [main]
    const call = (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC, tickets: ['07'] })
    await vi.waitFor(() => expect(asksOf(main)).toHaveLength(1))
    expect(main.calls).toEqual(['restore', 'show'])
    expect(asksOf(main)[0]).toMatchObject({ projectId: PROJECT, project: PROJECT_NAME, epic: EPIC, tickets: [7], session: NODE_SESSION, waitMs: confirm.CONFIRM_WAIT_MS })
    expect(app.workflowReads).toEqual([PROJECT_ROOT])
    // A page of another window cannot answer: the handler refuses it.
    const other = localWindow('other')
    await expect(answerFrom(other, asksOf(main)[0]!.id, 'fastest')).rejects.toThrow('This window was not asked')
    await answerFrom(main, asksOf(main)[0]!.id, 'fastest')
    expect(textOf(await call)).toBe(`Autopilot started Ticket 07 of Epic ${EPIC}.`)
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [7], mode: 'fastest' }]])
  })

  it("the forecast reads the Project's run journals, the app's Limits and Settings → Autopilot: the default mode and the lines in the ask", async () => {
    appWorld()
    const main = localWindow('main')
    app.windows = [main]
    // A reserve of 5 % and a window of 21:00–05:00 in Settings: at 60 % used, 35 % free holds the 30 % of the one Wave.
    app.settings = { autopilotRun: { mode: 'start-window', windowFrom: 21, windowTo: 5 }, autopilotBudget: { reservePercent: 5 } }
    app.runs = pastRuns(5)
    const now = Date.now()
    app.limits = { windows: { seven_day: { utilization: 0.6, resetsAt: Math.floor(now / 1000) + 48 * 3600 + 600, status: null, receivedAt: now, source: 'usage' } } }
    const call = (await connect(NODE_SESSION, server.appDeps().autopilotStart)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(asksOf(main)).toHaveLength(1))
    expect(app.runReads).toEqual([PROJECT])
    const [ask] = asksOf(main)
    expect(ask!.mode).toBe('start-window')
    expect(ask!.forecast).toEqual([
      'Forecast: This Epic: 1 Wave, 3 Tickets left, usually about 30% of the week. Used now: 60%, resets in 2 d 0 h.',
      'Budget-aware: 1 Wave fits before the reset without the reserve.',
      'Start window 21:00–05:00: a Wave usually takes up to 1 h 0 min.',
    ])
    await answerFrom(main, ask!.id, 'cancel')
    expect(textOf(await call)).toBe(confirm.CANCELED_MESSAGE)
  })

  it("on a Project whose Orchestrator runs on Codex the forecast reads Codex's Waves and its weekly window, not Claude's (worfy-multi-vendor ticket 38)", async () => {
    appWorld()
    const main = localWindow('main')
    app.windows = [main]
    app.settings = { autopilotRun: { mode: 'start-window', windowFrom: 21, windowTo: 5 }, autopilotBudget: { reservePercent: 5 } }
    // Claude's Waves use 10 % of its week each, Codex's 5 % of Plus's weekly window: the forecast takes Codex's.
    app.runs = [...pastRuns(5), ...pastCodexRuns(5)]
    app.vendor = 'codex'
    const now = Date.now()
    const window = (id: string, minutes: number, used: number) => ({ vendor: 'codex', id, label: id, usedPercent: used, windowMinutes: minutes, resetsAt: Math.floor(now / 1000) + 48 * 3600 + 600, receivedAt: now, state: 'ok', source: 'read' })
    app.vendorWindows = { codex: [window('primary', 300, 10), window('secondary', 10080, 92)] }
    // Claude's week alone would fit the Wave: 60 % used, 35 % free.
    app.limits = { windows: { seven_day: { utilization: 0.6, resetsAt: Math.floor(now / 1000) + 48 * 3600 + 600, status: null, receivedAt: now, source: 'usage' } } }
    const call = (await connect(NODE_SESSION, server.appDeps().autopilotStart)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(asksOf(main)).toHaveLength(1))
    expect(asksOf(main)[0]!.forecast).toEqual([
      // 5 % per Ticket over 3 Tickets; with Claude's samples it would say 30 % and "Used now: 60%".
      'Forecast: This Epic: 1 Wave, 3 Tickets left, usually about 15% of the week. The range is wide: this Vendor reports its Limits in whole percents only. Used now: 92%, resets in 2 d 0 h.',
      'Budget-aware: Recommended: no Wave now, 1 after the reset.',
      'Fastest: No Wave fits before the reset: then the run waits for the Limits.',
      'Start window 21:00–05:00: a Wave usually takes up to 1 h 0 min.',
    ])
    await answerFrom(main, asksOf(main)[0]!.id, 'cancel')
    expect(textOf(await call)).toBe(confirm.CANCELED_MESSAGE)
  })

  it('one starter for every Session: a second Session asking while the window asks is refused, one ask in all', async () => {
    const { w } = appWorld()
    const main = localWindow('main')
    app.windows = [main]
    // Each Session's server takes the starter from its own appDeps(), as canvasForSession does.
    const first = (await connect(ORCHESTRATOR, server.appDeps().autopilotStart)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(asksOf(main)).toHaveLength(1))
    const second = await (await connect(NODE_SESSION, server.appDeps().autopilotStart)).call('autopilot_start', { epic: EPIC })
    expect(textOf(second)).toBe(confirm.CONFIRM_PENDING_MESSAGE)
    expect(asksOf(main)).toHaveLength(1)
    await answerFrom(main, asksOf(main)[0]!.id, 'cancel')
    expect(textOf(await first)).toBe(confirm.CANCELED_MESSAGE)
    expect(w.out.starts).toEqual([])
  })

  it('no native message box is left on the way of autopilot_start: none of its modules calls showMessageBox', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
    const files = [
      ...readdirSync(join(src, 'main', 'autopilot'))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(src, 'main', 'autopilot', name)),
      join(src, 'main', 'mcp', 'canvas-server.ts'),
      join(src, 'main', 'ipc', 'autopilot-confirm.ts'),
    ]
    expect(files.length).toBeGreaterThan(3)
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/showMessageBox/u)
  })
})

describe('autopilot_start: the Run mode and the forecast in the ask (worfy-resource-planner ticket 06)', () => {
  it('"start-window" starts a run whose run-started carries start-window', async () => {
    const w = world()
    const ask = windowAsk()
    const rpc = await connect(NODE_SESSION, tool(w, ask, { mode: 'fastest' }).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    expect(ask.shown[0]!.mode).toBe('fastest')
    ask.answer('start-window')
    expect(textOf(await call)).toBe(`Autopilot started Epic ${EPIC}.`)
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, by: 'tool', session: NODE_SESSION, mode: 'start-window' })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', mode: 'start-window' }]])
    expect(w.out.journal).toEqual(['run-started start-window'])
  })

  it.each<RunMode>(['fastest', 'budget-aware', 'start-window'])('the answer %s starts in that mode, whatever the default', async (mode) => {
    const w = world()
    const ask = windowAsk()
    const call = (await connect(NODE_SESSION, tool(w, ask, { mode: 'start-window' }).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer(mode)
    await call
    expect(w.out.journal).toEqual([`run-started ${mode}`])
  })

  it.each<RunMode>(['fastest', 'budget-aware', 'start-window'])('Cancel starts nothing with the default %s', async (mode) => {
    const w = world()
    const ask = windowAsk()
    const call = (await connect(NODE_SESSION, tool(w, ask, { mode }).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer('cancel')
    expect(textOf(await call)).toBe(confirm.CANCELED_MESSAGE)
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.journal).toEqual([])
  })

  it('the ask carries the forecast of the journals', async () => {
    const w = world()
    const ask = windowAsk()
    const call = (await connect(NODE_SESSION, tool(w, ask, { runs: () => Promise.resolve(pastRuns(5)) }).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    expect(ask.shown[0]!.forecast).toEqual([
      'Forecast: This Epic: 1 Wave, 3 Tickets left, usually about 30% of the week. Used now: 80%, resets in 2 d 0 h.',
      'Budget-aware: Recommended: no Wave now, 1 after the reset.',
      'Fastest: No Wave fits before the reset: then the run waits for the Limits.',
      'Start window 23:00–07:00: a Wave usually takes up to 1 h 0 min.',
    ])
    ask.answer('cancel')
    await call
  })
})

describe("the ask's forecast lines (worfy-resource-planner ticket 06)", () => {
  it('the reserve and the Start window are those of Settings: at 60 % used the reserve keeps Wave 1 back, and the window is 21:00–05:00', async () => {
    const w = world()
    const ask = windowAsk()
    const at60: LimitsState = { windows: { seven_day: { ...LIMITS.windows.seven_day!, utilization: 0.6 } } }
    const options = { runs: () => Promise.resolve(pastRuns(5)), limits: at60, window: { from: 21, to: 5 }, reserve: 0.15 }
    const call = (await connect(NODE_SESSION, tool(w, ask, options).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    // 1 − 0.15 − 0.6 = 25 % free under the 30 % of the one Wave; without the reserve 40 % would hold it,
    // so there is no Fastest line.
    expect(ask.shown[0]!.forecast).toEqual([
      'Forecast: This Epic: 1 Wave, 3 Tickets left, usually about 30% of the week. Used now: 60%, resets in 2 d 0 h.',
      'Budget-aware: Recommended: no Wave now, 1 after the reset.',
      'Start window 21:00–05:00: a Wave usually takes up to 1 h 0 min.',
    ])
    ask.answer('cancel')
    await call
  })

  /** The forecast lines of the ask for a call with `tickets`, over the journals `runs`. */
  async function linesFor(runs: () => Promise<JournalEvent[][]>, tickets?: string[]): Promise<string[] | undefined> {
    const w = world()
    const ask = windowAsk()
    const call = (await connect(NODE_SESSION, tool(w, ask, { runs }).starter)).call('autopilot_start', { epic: EPIC, ...(tickets === undefined ? {} : { tickets }) })
    await vi.waitFor(() => expect(ask.shown).toHaveLength(1))
    ask.answer('cancel')
    await call
    return ask.shown[0]!.forecast
  }

  it('too few past Waves: the Forecast line says so, and there is no Budget-aware or Fastest line', async () => {
    expect(await linesFor(() => Promise.resolve(pastRuns(4)))).toEqual([
      'Forecast: This Epic: 1 Wave, 3 Tickets left. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 80%, resets in 2 d 0 h.',
      'Start window 23:00–07:00. Not enough data on Wave duration: every Wave may start inside the window.',
    ])
  })

  it('a run over named Tickets forecasts only those', async () => {
    expect((await linesFor(() => Promise.resolve(pastRuns(5)), ['05']))?.[0]).toBe(
      'Forecast: This Epic: 1 Wave, 1 Ticket left, usually about 10% of the week. Used now: 80%, resets in 2 d 0 h.',
    )
  })

  it('journals that cannot be read: the ask carries no forecast, and still asks', async () => {
    expect(await linesFor(() => Promise.reject(new Error('EACCES')))).toEqual([])
  })
})
