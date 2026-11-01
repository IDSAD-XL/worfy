// The canvas tool autopilot_start (worfy-flight-recorder ticket 23, ADR-0091), called through the
// canvas MCP server the way Claude Code calls it. A person confirms the start in a native message box
// (a stand-in showMessageBox here) on a window of the Project's Machine; it waits 10 minutes (fake
// timers); "Start Autopilot" goes to the real ChatStarts.startFromChat, whose Autopilot is a stand-in
// that records every start (its `journal`, with the Run mode the start names, as run-started of the
// real run carries it). An unattended Session, a Project with a run under way and
// a Machine without a worfy window are refused without a dialog. The app's own wiring
// (appAutopilotStarter, the starter of appDeps) runs over a stand-in Session registry, ChatStarts,
// Project list, workflow read, run journals, Limits and Settings. No Claude Code and no agent start here.
//
// The dialog's Run mode buttons and forecast (worfy-resource-planner ticket 06): "Start: Fastest",
// "Start: Budget-aware" and "Start: Start window", the default mode of Settings marked " (default)",
// then "Cancel", the default button; the forecast lines of the past runs' journals in its `detail`.
import type { BaseWindow, BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AFTER_TURN_MESSAGE, ChatStarts, chatRunningHint, chatWaitingHint, type ChatStartDeps } from '../../src/main/autopilot/chat-start'
import type { AutopilotStartOptions } from '../../src/main/autopilot/run'
import type { CanvasContext, ToolResult } from '../../src/main/mcp/canvas-server'
import type { LimitsState } from '../../src/shared/agent/limits'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import type { RunMode } from '../../src/shared/autopilot/run-mode'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

/** What the mocked modules below answer; each test sets its own. */
const app = vi.hoisted(() => ({
  focused: null as unknown,
  windows: [] as unknown[],
  showMessageBox: null as unknown as (...args: unknown[]) => Promise<unknown>,
  /** Session id → whether it runs unattended; a Session not here is not in the registry. */
  sessions: new Map<string, boolean>(),
  chat: null as unknown,
  workflowReads: [] as string[],
  /** What readRecentRuns answers; null: the journals cannot be read. */
  runs: [] as unknown[][] | null,
  runReads: [] as string[],
  limits: { windows: {} } as unknown,
  /** The app settings main reads: the default Run mode and the budget (Settings → Autopilot). */
  settings: {} as unknown,
}))

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getFocusedWindow: () => app.focused, getAllWindows: () => app.windows, fromWebContents: () => null },
  dialog: { showMessageBox: (...args: unknown[]) => app.showMessageBox(...args) },
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
vi.mock('../../src/main/agent/limits', async (importOriginal) => ({ ...(await importOriginal<object>()), appLimits: () => ({ snapshot: () => app.limits }) }))
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

/** The lines the forecast adds to the dialog's `detail`: those between its first paragraph and its last. */
const forecastOf = (detail: string | undefined): string[] => (detail ?? '').split('\n\n').slice(1, -1).join('\n').split('\n').filter(Boolean)

/** A window of this Machine; `calls` records what was done to it. */
function localWindow(name: string, state: { visible?: boolean; minimized?: boolean } = {}) {
  const calls: string[] = []
  let visible = state.visible ?? true
  let minimized = state.minimized ?? false
  const window = {
    name,
    calls,
    isDestroyed: () => false,
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
  }
  return window as unknown as BrowserWindow & { calls: string[] }
}

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
  app.chat = null
  app.workflowReads = []
  app.runs = []
  app.runReads = []
  app.limits = { windows: {} }
  app.settings = {}
  app.showMessageBox = () => Promise.reject(new Error('no message box in this test'))
  vi.resetModules()
  confirm = await import('../../src/main/autopilot/chat-confirm')
  server = await import('../../src/main/mcp/canvas-server')
})

afterEach(() => {
  vi.useRealTimers()
})

/** The button "Cancel" of the dialog, after "Start: Fastest", "Start: Budget-aware" and "Start: Start window". */
const CANCEL = 3

/** The message boxes shown, and the answer of the last one: the number of its button. */
function messageBox() {
  const shown: { owner: BaseWindow | null; options: MessageBoxOptions; args: number }[] = []
  let answer: ((response: number) => void) | null = null
  const box = {
    showMessageBox: vi.fn((...args: [BaseWindow, MessageBoxOptions] | [MessageBoxOptions]): Promise<MessageBoxReturnValue> => {
      const options = args.length === 2 ? args[1] : args[0]
      shown.push({ owner: args.length === 2 ? args[0] : null, options, args: args.length })
      return new Promise((done) => {
        answer = (response) => done({ response, checkboxChecked: false })
        // Electron closes the box when its signal aborts, and answers the cancel button.
        options.signal?.addEventListener('abort', () => done({ response: options.cancelId ?? 1, checkboxChecked: false }))
      })
    }),
  }
  return {
    box,
    shown,
    answer: (response: number) => {
      if (answer === null) throw new Error('no message box is open')
      answer(response)
    },
  }
}

/** The real starts from a chat over a stand-in Autopilot; `journal` gets a line for every run that starts. */
function world(options: { running?: string | null; orchestratorInTurn?: boolean } = {}) {
  const out = {
    running: options.running ?? null,
    starts: [] as [string, string, AutopilotStartOptions | undefined][],
    journal: [] as string[],
    /** Ends the Orchestrator's turn: its Session is idle. */
    endTurn: () => undefined as void,
    inTurn: options.orchestratorInTurn ?? false,
  }
  const deps: ChatStartDeps = {
    autopilot: {
      runningEpic: () => out.running,
      startCheck: () => Promise.resolve(null),
      start: (projectId, epic, start) => {
        out.starts.push([projectId, epic, start])
        // run-started of the real run (run.ts) carries the start's mode, else the default of Settings.
        out.journal.push(`run-started ${start?.mode ?? 'default'}`)
        out.running = epic
        return Promise.resolve({ projectId, epic, status: 'running' } as unknown as AutopilotState)
      },
    },
    workflow: () => Promise.resolve(MODEL),
    orchestratorSession: () => Promise.resolve(ORCHESTRATOR),
    inTurn: (sessionId) => out.inTurn && sessionId === ORCHESTRATOR,
    whenIdle: () =>
      new Promise((done) => {
        out.endTurn = () => {
          out.inTurn = false
          done(true)
        }
      }),
    orchestratorRefusal: () => null,
    notify: () => undefined,
  }
  const chat = new ChatStarts(deps)
  const startFromChat = vi.spyOn(chat, 'startFromChat')
  return { out, chat, startFromChat }
}

/** The tool over the stand-ins, with the dialog of `box` on `owner`. */
function tool(
  w: ReturnType<typeof world>,
  box: ReturnType<typeof messageBox>['box'],
  options: {
    owner?: BrowserWindow
    workflow?: () => Promise<WorkflowModel>
    runs?: () => Promise<JournalEvent[][]>
    mode?: RunMode
    limits?: LimitsState
    window?: { from: number; to: number }
    reserve?: number
  } = {},
) {
  const owner = options.owner ?? localWindow('project machine')
  const confirmations = vi.fn((prompt: Parameters<typeof confirm.confirmAutopilotStart>[1]) => confirm.confirmAutopilotStart(owner, prompt, box))
  const starter = confirm.autopilotStarter({
    unattended: (sessionId) => app.sessions.get(sessionId) ?? null,
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

/** Lets the call reach its dialog: the workflow read and the server's own steps are promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('autopilot_start: the dialog and "Start Autopilot"', () => {
  it('is a tool of the worfy-canvas server', async () => {
    expect(await (await connect(NODE_SESSION, undefined)).names()).toContain('autopilot_start')
  })

  it('names the Epic, the Project and the named Tickets; "Start: Fastest" calls startFromChat with them, `tool` and the mode, and the run starts', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05', '06'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    const { options } = shown[0]!
    expect(options.buttons).toEqual(['Start: Fastest', 'Start: Budget-aware (default)', 'Start: Start window', 'Cancel'])
    // Cancel is both the default and the cancel button: Enter or Escape alone start nothing.
    expect(options.defaultId).toBe(3)
    expect(options.cancelId).toBe(3)
    expect(options.message).toBe(`Start Autopilot on Tickets 05, 06 of Epic "${EPIC}" in Project "${PROJECT_NAME}"?`)
    expect(w.startFromChat).not.toHaveBeenCalled()
    answer(0)
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(`Autopilot started Tickets 05, 06 of Epic ${EPIC}.`)
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [5, 6], by: 'tool', session: NODE_SESSION, mode: 'fastest' })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [5, 6], mode: 'fastest' }]])
    expect(w.out.journal).toEqual(['run-started fastest'])
  })

  it('without Tickets names the Epic and the Project only, and the whole Epic starts', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    expect(shown[0]!.options.message).toBe(`Start Autopilot on Epic "${EPIC}" in Project "${PROJECT_NAME}"?`)
    expect(shown[0]!.options.message).not.toMatch(/Ticket/u)
    answer(0)
    expect(textOf(await call)).toBe(`Autopilot started Epic ${EPIC}.`)
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, by: 'tool', session: NODE_SESSION, mode: 'fastest' })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', mode: 'fastest' }]])
  })

  it('"Cancel" is a refusal: no startFromChat, no run, nothing in the journal', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(CANCEL)
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.CANCELED_MESSAGE)
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.starts).toEqual([])
    expect(w.out.journal).toEqual([])
  })

  it('a run that started while the box waited: "Start Autopilot" answers the refusal of startFromChat, not a start', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    // The person pressed the Autopilot button of Epic billing while the box was open.
    w.out.running = 'billing'
    answer(0)
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(chatRunningHint('billing'))
    expect(w.startFromChat).toHaveBeenCalledOnce()
    expect(w.out.starts).toEqual([])
  })

  it('a second call while the first dialog waits is refused without a second dialog', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    const first = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    const second = await rpc.call('autopilot_start', { epic: EPIC, tickets: ['07'] })
    expect(second.isError).toBe(true)
    expect(textOf(second)).toBe(confirm.CONFIRM_PENDING_MESSAGE)
    expect(shown).toHaveLength(1)
    answer(CANCEL)
    await first
    expect(w.out.starts).toEqual([])
  })
})

describe('autopilot_start: no answer in 10 minutes', () => {
  it('closes the dialog and refuses with "No one confirmed"; no run starts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const w = world()
    const { box, shown } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    let result: ToolResult | null = null
    void rpc.call('autopilot_start', { epic: EPIC }).then((answer) => (result = answer))
    for (let i = 0; i < 50 && shown.length === 0; i += 1) await settle()
    expect(shown).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(confirm.CONFIRM_WAIT_MS - 1)
    expect(result).toBeNull()
    expect(shown[0]!.options.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(result).not.toBeNull()
    expect(result!.isError).toBe(true)
    expect(textOf(result!)).toBe(confirm.NO_ONE_CONFIRMED)
    expect(textOf(result!)).toMatch(/^No one confirmed/u)
    // The box itself is closed, not left open on the screen.
    expect(shown[0]!.options.signal?.aborted).toBe(true)
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.starts).toEqual([])
    expect(confirm.CONFIRM_WAIT_MS).toBe(10 * 60_000)
  })
})

describe("autopilot_start: the dialog is on a window of the Project's Machine, never without one", () => {
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

  it('a minimised or hidden window is brought back before the box goes on it', () => {
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

describe('autopilot_start: refusals without a dialog', () => {
  it('an unattended Session (Autopilot) is refused: no dialog, no start', async () => {
    const w = world()
    const { box, shown } = messageBox()
    const { starter, confirmations } = tool(w, box)
    const result = await (await connect(AUTOPILOT_SESSION, starter)).call('autopilot_start', { epic: EPIC, tickets: ['05'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.UNATTENDED_MESSAGE)
    expect(confirmations).not.toHaveBeenCalled()
    expect(shown).toEqual([])
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.starts).toEqual([])
  })

  it('a Session worfy does not know, or a call before the Session id is known, is refused the same way', async () => {
    const w = world()
    const { box, shown } = messageBox()
    const { starter } = tool(w, box)
    for (const session of ['someone-else', null]) {
      const result = await (await connect(session, starter)).call('autopilot_start', { epic: EPIC })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe(confirm.UNKNOWN_SESSION_MESSAGE)
    }
    expect(shown).toEqual([])
    expect(w.out.starts).toEqual([])
  })

  it('while a run goes on: the hint to stop it first, no dialog, no new journal line', async () => {
    const w = world({ running: 'billing' })
    w.out.journal.push('run-started')
    const { box, shown } = messageBox()
    const result = await (await connect(NODE_SESSION, tool(w, box).starter)).call('autopilot_start', { epic: EPIC })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(chatRunningHint('billing'))
    expect(textOf(result)).toBe('Autopilot is already running Epic billing. Stop it first.')
    expect(shown).toEqual([])
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.journal).toEqual(['run-started'])
  })

  it('while a start waits for the end of the Orchestrator\'s turn: its hint, no second dialog', async () => {
    const w = world({ orchestratorInTurn: true })
    const { box, shown, answer } = messageBox()
    const { starter } = tool(w, box)
    const call = (await connect(ORCHESTRATOR, starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(0)
    expect(textOf(await call)).toBe(AFTER_TURN_MESSAGE)
    const again = await (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC, tickets: ['07'] })
    expect(again.isError).toBe(true)
    expect(textOf(again)).toBe(chatWaitingHint(EPIC))
    expect(shown).toHaveLength(1)
    expect(w.startFromChat).toHaveBeenCalledOnce()
  })

  it('an Epic or a Ticket the Project has not, or a workflow that cannot be read, is refused before anyone is asked', async () => {
    const w = world()
    const { box, shown } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    expect(textOf(await rpc.call('autopilot_start', { epic: 'billing' }))).toBe('The Project has no Epic billing')
    expect(textOf(await rpc.call('autopilot_start', { epic: EPIC, tickets: ['05', '09'] }))).toBe(`Epic ${EPIC} has no Ticket 09`)
    const unreadable = { ...MODEL, error: { message: 'no .scratch' } } as unknown as WorkflowModel
    const broken = await (await connect(NODE_SESSION, tool(w, box, { workflow: () => Promise.resolve(unreadable) }).starter)).call('autopilot_start', { epic: EPIC })
    expect(broken.isError).toBe(true)
    expect(textOf(broken)).toBe('Cannot read the workflow: no .scratch')
    expect(shown).toEqual([])
    expect(w.out.starts).toEqual([])
  })

  it('a server without the starter refuses, and a call without an Epic is a form error', async () => {
    const rpc = await connect(NODE_SESSION, undefined)
    const refused = await rpc.call('autopilot_start', { epic: EPIC })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(server.NO_AUTOPILOT_MESSAGE)
    const w = world()
    const { box, shown } = messageBox()
    const malformed = await (await connect(NODE_SESSION, tool(w, box).starter)).call('autopilot_start', { tickets: ['05'] })
    expect(malformed.isError).toBe(true)
    expect(textOf(malformed)).toMatch(/epic/u)
    expect(shown).toEqual([])
  })
})

describe("autopilot_start from the Project's Orchestrator in its turn", () => {
  it('answers "Autopilot starts after this turn", and the run starts once the Orchestrator is idle', async () => {
    const w = world({ orchestratorInTurn: true })
    const { box, shown, answer } = messageBox()
    const rpc = await connect(ORCHESTRATOR, tool(w, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['06'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(0)
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(AFTER_TURN_MESSAGE)
    expect(textOf(result)).toBe('Autopilot starts after this turn')
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [6], by: 'tool', session: ORCHESTRATOR, mode: 'fastest' })
    await settle()
    expect(w.out.starts).toEqual([])
    w.out.endTurn()
    await vi.waitFor(() => expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [6], mode: 'fastest' }]]))
    expect(w.out.journal).toEqual(['run-started fastest'])
  })
})

describe("autopilot_start: the app's wiring (appDeps().autopilotStart, appAutopilotStarter)", () => {
  /** The app's starter of every Session, over the stand-ins of the mocked modules. */
  function appWorld() {
    const w = world()
    app.chat = w.chat
    const box = messageBox()
    app.showMessageBox = box.box.showMessageBox as unknown as (...args: unknown[]) => Promise<unknown>
    const starter = server.appDeps().autopilotStart
    if (starter === undefined) throw new Error('the app gives no autopilot_start')
    return { w, box, starter }
  }

  it('reads the Session registry at the call: an unattended Session and one not in the registry are refused, and no box is shown', async () => {
    const { box, starter, w } = appWorld()
    app.windows = [localWindow('main')]
    expect(textOf(await (await connect(AUTOPILOT_SESSION, starter)).call('autopilot_start', { epic: EPIC }))).toBe(confirm.UNATTENDED_MESSAGE)
    expect(textOf(await (await connect('gone-session', starter)).call('autopilot_start', { epic: EPIC }))).toBe(confirm.UNKNOWN_SESSION_MESSAGE)
    // The same Session once the registry says it runs unattended (Autopilot took it).
    app.sessions.set(NODE_SESSION, true)
    expect(textOf(await (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC }))).toBe(confirm.UNATTENDED_MESSAGE)
    // The app's ChatStarts says whether a run goes on.
    w.out.running = 'billing'
    expect(textOf(await (await connect(ORCHESTRATOR, starter)).call('autopilot_start', { epic: EPIC }))).toBe(chatRunningHint('billing'))
    expect(box.shown).toEqual([])
    expect(w.startFromChat).not.toHaveBeenCalled()
  })

  it('with no worfy window on the Machine: refused at once, and no box without a parent is shown', async () => {
    const { box, starter, w } = appWorld()
    app.windows = []
    const result = await (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.NO_WINDOW_MESSAGE)
    expect(box.box.showMessageBox).not.toHaveBeenCalled()
    expect(w.startFromChat).not.toHaveBeenCalled()
  })

  it('shows the box on the window of this Machine, with the Project from the list and the workflow of its root; Start goes to the app\'s ChatStarts', async () => {
    const { box, starter, w } = appWorld()
    const main = localWindow('main', { minimized: true })
    app.windows = [main]
    const call = (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC, tickets: ['07'] })
    await vi.waitFor(() => expect(box.shown).toHaveLength(1))
    expect(box.shown[0]!.args).toBe(2)
    expect(box.shown[0]!.owner).toBe(main)
    expect(main.calls).toEqual(['restore', 'show'])
    expect(box.shown[0]!.options.message).toBe(`Start Autopilot on Ticket 07 of Epic "${EPIC}" in Project "${PROJECT_NAME}"?`)
    expect(app.workflowReads).toEqual([PROJECT_ROOT])
    box.answer(0)
    expect(textOf(await call)).toBe(`Autopilot started Ticket 07 of Epic ${EPIC}.`)
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [7], mode: 'fastest' }]])
  })

  it("the forecast reads the Project's run journals, the app's Limits and Settings → Autopilot: the default mode marked, the lines in the box", async () => {
    const { box, starter } = appWorld()
    app.windows = [localWindow('main')]
    // A reserve of 5 % and a window of 21:00–05:00 in Settings: at 60 % used, 35 % free holds the 30 % of the one Wave.
    app.settings = { autopilotRun: { mode: 'start-window', windowFrom: 21, windowTo: 5 }, autopilotBudget: { reservePercent: 5 } }
    app.runs = pastRuns(5)
    const now = Date.now()
    app.limits = { windows: { seven_day: { utilization: 0.6, resetsAt: Math.floor(now / 1000) + 48 * 3600 + 600, status: null, receivedAt: now, source: 'usage' } } }
    const call = (await connect(NODE_SESSION, starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(box.shown).toHaveLength(1))
    expect(app.runReads).toEqual([PROJECT])
    const { options } = box.shown[0]!
    expect(options.buttons).toEqual(['Start: Fastest', 'Start: Budget-aware', 'Start: Start window (default)', 'Cancel'])
    expect(forecastOf(options.detail)).toEqual([
      'Forecast: This Epic: 1 Wave, 3 Tickets left, usually about 30% of the week. Used now: 60%, resets in 2 d 0 h.',
      'Budget-aware: 1 Wave fits before the reset without the reserve.',
      'Start window 21:00–05:00: a Wave usually takes up to 1 h 0 min.',
    ])
    box.answer(CANCEL)
    expect(textOf(await call)).toBe(confirm.CANCELED_MESSAGE)
  })

  it('one starter for every Session: a second Session asking while the box is open is refused, one box in all', async () => {
    const { box, w } = appWorld()
    app.windows = [localWindow('main')]
    // Each Session's server takes the starter from its own appDeps(), as canvasForSession does.
    const first = (await connect(ORCHESTRATOR, server.appDeps().autopilotStart)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(box.shown).toHaveLength(1))
    const second = await (await connect(NODE_SESSION, server.appDeps().autopilotStart)).call('autopilot_start', { epic: EPIC })
    expect(textOf(second)).toBe(confirm.CONFIRM_PENDING_MESSAGE)
    expect(box.shown).toHaveLength(1)
    box.answer(CANCEL)
    expect(textOf(await first)).toBe(confirm.CANCELED_MESSAGE)
    expect(w.out.starts).toEqual([])
  })
})

describe('autopilot_start: the Run mode buttons and the forecast (worfy-resource-planner ticket 06)', () => {
  it('"Start: Start window" starts a run whose run-started carries start-window', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box, { mode: 'fastest' }).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    expect(shown[0]!.options.buttons).toEqual(['Start: Fastest (default)', 'Start: Budget-aware', 'Start: Start window', 'Cancel'])
    expect(shown[0]!.options.buttons![2]).toBe('Start: Start window')
    answer(2)
    expect(textOf(await call)).toBe(`Autopilot started Epic ${EPIC}.`)
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, by: 'tool', session: NODE_SESSION, mode: 'start-window' })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', mode: 'start-window' }]])
    expect(w.out.journal).toEqual(['run-started start-window'])
  })

  it.each<[number, RunMode]>([
    [0, 'fastest'],
    [1, 'budget-aware'],
    [2, 'start-window'],
  ])('button %i starts in the mode %s, whatever the default', async (button, mode) => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const call = (await connect(NODE_SESSION, tool(w, box, { mode: 'start-window' }).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(button)
    await call
    expect(w.out.journal).toEqual([`run-started ${mode}`])
  })

  it('"Cancel" — and Enter or Escape, which answer it — starts nothing in any mode', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const call = (await connect(NODE_SESSION, tool(w, box).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    const { options } = shown[0]!
    expect(options.buttons![CANCEL]).toBe('Cancel')
    expect([options.defaultId, options.cancelId]).toEqual([CANCEL, CANCEL])
    answer(CANCEL)
    expect(textOf(await call)).toBe(confirm.CANCELED_MESSAGE)
    expect(w.startFromChat).not.toHaveBeenCalled()
    expect(w.out.journal).toEqual([])
  })

  it('the detail has the forecast of the journals between its first paragraph and the 10 minutes', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const call = (await connect(NODE_SESSION, tool(w, box, { runs: () => Promise.resolve(pastRuns(5)) }).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    const { detail } = shown[0]!.options
    expect(detail).toMatch(/^An agent asked for it in a chat\./u)
    expect(detail).toMatch(/\n\nWithout an answer in 10 minutes nothing starts\.$/u)
    expect(forecastOf(detail)).toEqual([
      'Forecast: This Epic: 1 Wave, 3 Tickets left, usually about 30% of the week. Used now: 80%, resets in 2 d 0 h.',
      'Budget-aware: Recommended: no Wave now, 1 after the reset.',
      'Fastest: No Wave fits before the reset: then the run waits for the Limits.',
      'Start window 23:00–07:00: a Wave usually takes up to 1 h 0 min.',
    ])
    answer(CANCEL)
    await call
  })
})

describe('confirmationOptions: the forecast lines (worfy-resource-planner ticket 06)', () => {
  it('the reserve and the Start window are those of Settings: at 60 % used the reserve keeps Wave 1 back, and the window is 21:00–05:00', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const at60: LimitsState = { windows: { seven_day: { ...LIMITS.windows.seven_day!, utilization: 0.6 } } }
    const options = { runs: () => Promise.resolve(pastRuns(5)), limits: at60, window: { from: 21, to: 5 }, reserve: 0.15 }
    const call = (await connect(NODE_SESSION, tool(w, box, options).starter)).call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    // 1 − 0.15 − 0.6 = 25 % free under the 30 % of the one Wave; without the reserve 40 % would hold it,
    // so there is no Fastest line.
    expect(forecastOf(shown[0]!.options.detail)).toEqual([
      'Forecast: This Epic: 1 Wave, 3 Tickets left, usually about 30% of the week. Used now: 60%, resets in 2 d 0 h.',
      'Budget-aware: Recommended: no Wave now, 1 after the reset.',
      'Start window 21:00–05:00: a Wave usually takes up to 1 h 0 min.',
    ])
    answer(CANCEL)
    await call
  })

  /** The forecast lines of the box for a call with `tickets`, over the journals `runs`. */
  async function linesFor(runs: () => Promise<JournalEvent[][]>, tickets?: string[]): Promise<string[] | undefined> {
    const w = world()
    const { box, shown, answer } = messageBox()
    const call = (await connect(NODE_SESSION, tool(w, box, { runs }).starter)).call('autopilot_start', { epic: EPIC, ...(tickets === undefined ? {} : { tickets }) })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(CANCEL)
    await call
    return forecastOf(shown[0]!.options.detail)
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

  it('journals that cannot be read: the box shows no forecast, and still asks', async () => {
    expect(await linesFor(() => Promise.reject(new Error('EACCES')))).toEqual([])
  })
})
