// The canvas tool autopilot_start (worfy-flight-recorder ticket 23, ADR-0091), called through the
// canvas MCP server the way Claude Code calls it. A person confirms the start in a native message box
// (a stand-in showMessageBox here) on a window of the Project's Machine; it waits 10 minutes (fake
// timers); "Start Autopilot" goes to the real ChatStarts.startFromChat, whose Autopilot is a stand-in
// that records every start (its `journal`). An unattended Session, a Project with a run under way and
// a Machine without a worfy window are refused without a dialog. The app's own wiring
// (appAutopilotStarter, the starter of appDeps) runs over a stand-in Session registry, ChatStarts,
// Project list and workflow read. No Claude Code and no agent start here.
import type { BaseWindow, BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AFTER_TURN_MESSAGE, ChatStarts, chatRunningHint, chatWaitingHint, type ChatStartDeps } from '../../src/main/autopilot/chat-start'
import type { AutopilotStartOptions } from '../../src/main/autopilot/run'
import type { CanvasContext, ToolResult } from '../../src/main/mcp/canvas-server'
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
  app.showMessageBox = () => Promise.reject(new Error('no message box in this test'))
  vi.resetModules()
  confirm = await import('../../src/main/autopilot/chat-confirm')
  server = await import('../../src/main/mcp/canvas-server')
})

afterEach(() => {
  vi.useRealTimers()
})

/** The message boxes shown, and the answer of the last one: 0 — "Start Autopilot", 1 — "Cancel". */
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
        out.journal.push('run-started')
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
function tool(w: ReturnType<typeof world>, box: ReturnType<typeof messageBox>['box'], options: { owner?: BrowserWindow; workflow?: () => Promise<WorkflowModel> } = {}) {
  const owner = options.owner ?? localWindow('project machine')
  const confirmations = vi.fn((prompt: Parameters<typeof confirm.confirmAutopilotStart>[1]) => confirm.confirmAutopilotStart(owner, prompt, box))
  const starter = confirm.autopilotStarter({
    unattended: (sessionId) => app.sessions.get(sessionId) ?? null,
    busy: (projectId) => w.chat.busyRefusal(projectId),
    workflow: options.workflow ?? (() => Promise.resolve(MODEL)),
    projectName: () => PROJECT_NAME,
    confirm: confirmations,
    startFromChat: (request) => w.chat.startFromChat(request),
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

  it('names the Epic, the Project and the named Tickets; "Start Autopilot" calls startFromChat with them and `tool`, and the run starts', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05', '06'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    const { options } = shown[0]!
    expect(options.buttons).toEqual(['Start Autopilot', 'Cancel'])
    // Cancel is both the default and the cancel button: Enter or Escape alone start nothing.
    expect(options.defaultId).toBe(1)
    expect(options.cancelId).toBe(1)
    expect(options.message).toBe(`Start Autopilot on Tickets 05, 06 of Epic "${EPIC}" in Project "${PROJECT_NAME}"?`)
    expect(w.startFromChat).not.toHaveBeenCalled()
    answer(0)
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(`Autopilot started Tickets 05, 06 of Epic ${EPIC}.`)
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [5, 6], by: 'tool', session: NODE_SESSION })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [5, 6] }]])
    expect(w.out.journal).toEqual(['run-started'])
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
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, by: 'tool', session: NODE_SESSION })
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool' }]])
  })

  it('"Cancel" is a refusal: no startFromChat, no run, nothing in the journal', async () => {
    const w = world()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(w, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(1)
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
    answer(1)
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
    expect(w.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [6], by: 'tool', session: ORCHESTRATOR })
    await settle()
    expect(w.out.starts).toEqual([])
    w.out.endTurn()
    await vi.waitFor(() => expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [6] }]]))
    expect(w.out.journal).toEqual(['run-started'])
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
    expect(w.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [7] }]])
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
    box.answer(1)
    expect(textOf(await first)).toBe(confirm.CANCELED_MESSAGE)
    expect(w.out.starts).toEqual([])
  })
})
