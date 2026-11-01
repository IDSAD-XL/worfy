// The canvas tool autopilot_start (worfy-flight-recorder ticket 23, ADR-0091), called through the
// canvas MCP server the way Claude Code calls it. A person confirms the start in a native message box
// (a stand-in showMessageBox here) on a window of the Project's Machine; it waits 10 minutes (fake
// timers); "Start Autopilot" goes to the real ChatStarts.startFromChat, whose Autopilot is a stand-in
// that records every start (its `journal`). An unattended Session and a Project with a run under way
// are refused without a dialog. No Claude Code and no agent start here.
import type { BaseWindow, BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AFTER_TURN_MESSAGE, ChatStarts, chatRunningHint, type ChatStartDeps } from '../../src/main/autopilot/chat-start'
import type { AutopilotStartOptions } from '../../src/main/autopilot/run'
import type { CanvasContext, ToolResult } from '../../src/main/mcp/canvas-server'
import type { Client } from '../../src/main/clients'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const windows = vi.hoisted(() => ({ focused: null as unknown, all: [] as unknown[] }))

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getFocusedWindow: () => windows.focused, getAllWindows: () => windows.all, fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('the app dialog is not for tests')) },
}))

const PROJECT = 'demo-000000a4'
const PROJECT_NAME = 'Demo shop'
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
const MODEL = { root: '/Users/someone/demo', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [t(5), t(6), t(7)], error: null, branchErrors: [] } as unknown as WorkflowModel

/** A window of this Machine, as the dialog's owner. */
const localWindow = (name: string, visible = true): BrowserWindow => ({ name, isDestroyed: () => false, isVisible: () => visible }) as unknown as BrowserWindow

let confirm: typeof import('../../src/main/autopilot/chat-confirm')
let server: typeof import('../../src/main/mcp/canvas-server')

beforeEach(async () => {
  windows.focused = null
  windows.all = []
  vi.resetModules()
  confirm = await import('../../src/main/autopilot/chat-confirm')
  server = await import('../../src/main/mcp/canvas-server')
})

afterEach(() => {
  vi.useRealTimers()
})

/** The message boxes shown, and the answer of the last one: 0 — "Start Autopilot", 1 — "Cancel". */
function messageBox() {
  const shown: { owner: BaseWindow | null; options: MessageBoxOptions }[] = []
  let answer: ((response: number) => void) | null = null
  const box = {
    showMessageBox: vi.fn((...args: [BaseWindow, MessageBoxOptions] | [MessageBoxOptions]): Promise<MessageBoxReturnValue> => {
      const options = args.length === 2 ? args[1] : args[0]
      shown.push({ owner: args.length === 2 ? args[0] : null, options })
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
function app(options: { running?: string | null; orchestratorInTurn?: boolean } = {}) {
  const out = {
    running: options.running ?? null,
    starts: [] as [string, string, AutopilotStartOptions | undefined][],
    journal: [] as string[],
    /** Ends the Orchestrator's turn: its Session is idle. */
    endTurn: () => undefined as void,
    sessions: new Map<string, boolean>([
      [ORCHESTRATOR, false],
      [NODE_SESSION, false],
      [AUTOPILOT_SESSION, true],
    ]),
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
function tool(world: ReturnType<typeof app>, box: ReturnType<typeof messageBox>['box'], owner: BrowserWindow | null = localWindow('project machine')) {
  const confirmations = vi.fn((prompt: Parameters<typeof confirm.confirmAutopilotStart>[1]) => confirm.confirmAutopilotStart(owner, prompt, box))
  const starter = confirm.autopilotStarter({
    unattended: (sessionId) => world.out.sessions.get(sessionId) ?? null,
    runningEpic: () => world.out.running,
    workflow: () => Promise.resolve(MODEL),
    projectName: () => PROJECT_NAME,
    confirm: confirmations,
    startFromChat: (request) => world.chat.startFromChat(request),
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
    const world = app()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(world, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05', '06'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    const { options } = shown[0]!
    expect(options.buttons).toEqual(['Start Autopilot', 'Cancel'])
    expect(options.cancelId).toBe(1)
    expect(options.message).toBe(`Start Autopilot on Tickets 05, 06 of Epic "${EPIC}" in Project "${PROJECT_NAME}"?`)
    expect(world.startFromChat).not.toHaveBeenCalled()
    answer(0)
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(`Autopilot started Tickets 05, 06 of Epic ${EPIC}.`)
    expect(world.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [5, 6], by: 'tool', session: NODE_SESSION })
    expect(world.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [5, 6] }]])
    expect(world.out.journal).toEqual(['run-started'])
  })

  it('without Tickets names the Epic and the Project only, and the whole Epic starts', async () => {
    const world = app()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(world, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    expect(shown[0]!.options.message).toBe(`Start Autopilot on Epic "${EPIC}" in Project "${PROJECT_NAME}"?`)
    expect(shown[0]!.options.message).not.toMatch(/Ticket/u)
    answer(0)
    expect(textOf(await call)).toBe(`Autopilot started Epic ${EPIC}.`)
    expect(world.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, by: 'tool', session: NODE_SESSION })
    expect(world.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool' }]])
  })

  it('"Cancel" is a refusal: no startFromChat, no run, nothing in the journal', async () => {
    const world = app()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(world, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['05'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(1)
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.CANCELED_MESSAGE)
    expect(world.startFromChat).not.toHaveBeenCalled()
    expect(world.out.starts).toEqual([])
    expect(world.out.journal).toEqual([])
  })

  it('a second call while the first dialog waits is refused without a second dialog', async () => {
    const world = app()
    const { box, shown, answer } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(world, box).starter)
    const first = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    const second = await rpc.call('autopilot_start', { epic: EPIC, tickets: ['07'] })
    expect(second.isError).toBe(true)
    expect(textOf(second)).toBe(confirm.CONFIRM_PENDING_MESSAGE)
    expect(shown).toHaveLength(1)
    answer(1)
    await first
    expect(world.out.starts).toEqual([])
  })
})

describe('autopilot_start: no answer in 10 minutes', () => {
  it('closes the dialog and refuses with "No one confirmed"; no run starts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const world = app()
    const { box, shown } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(world, box).starter)
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
    expect(world.startFromChat).not.toHaveBeenCalled()
    expect(world.out.starts).toEqual([])
    expect(confirm.CONFIRM_WAIT_MS).toBe(10 * 60_000)
  })
})

describe("autopilot_start: the dialog is on the Project's Machine", () => {
  it("goes on the focused window of this Machine, else its first visible one, else alone; a Linked machine's screen gets nothing", async () => {
    const { addClient } = await import('../../src/main/broadcast')
    const linked: Client & { sent: unknown[] } = { id: 'link:pc', sent: [], send: (...args) => void linked.sent.push(args), isDestroyed: () => false, once: () => undefined }
    addClient(linked)
    const hidden = localWindow('hidden', false)
    const shown = localWindow('shown')
    windows.all = [hidden, shown]
    expect(confirm.dialogOwner()).toBe(shown)
    windows.focused = hidden
    expect(confirm.dialogOwner()).toBe(hidden)
    windows.focused = null
    windows.all = []
    expect(confirm.dialogOwner()).toBeNull()

    // The app's tool shows the box on dialogOwner(): the window of this Machine.
    windows.all = [shown]
    const world = app()
    const box = messageBox()
    const rpc = await connect(NODE_SESSION, tool(world, box.box, confirm.dialogOwner()).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC })
    await vi.waitFor(() => expect(box.shown).toHaveLength(1))
    expect(box.shown[0]!.owner).toBe(shown)
    // The Linked machine's screen is a client without a window: no dialog, nothing to answer.
    expect(linked.sent).toEqual([])
    box.answer(0)
    expect((await call).isError).toBeFalsy()
    expect(linked.sent).toEqual([])
  })

  it('a dialog without a window of this Machine is shown alone, still by this Machine', async () => {
    const { box, shown, answer } = messageBox()
    const answered = confirm.confirmAutopilotStart(null, { project: PROJECT_NAME, epic: EPIC }, box)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.owner).toBeNull()
    expect(box.showMessageBox.mock.calls[0]).toHaveLength(1)
    answer(0)
    expect(await answered).toBe('start')
  })
})

describe('autopilot_start: refusals without a dialog', () => {
  it('an unattended Session (Autopilot) is refused: no dialog, no start', async () => {
    const world = app()
    const { box, shown } = messageBox()
    const { starter, confirmations } = tool(world, box)
    const result = await (await connect(AUTOPILOT_SESSION, starter)).call('autopilot_start', { epic: EPIC, tickets: ['05'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(confirm.UNATTENDED_MESSAGE)
    expect(confirmations).not.toHaveBeenCalled()
    expect(shown).toEqual([])
    expect(world.startFromChat).not.toHaveBeenCalled()
    expect(world.out.starts).toEqual([])
  })

  it('a Session worfy does not know, or a call before the Session id is known, is refused the same way', async () => {
    const world = app()
    const { box, shown } = messageBox()
    const { starter } = tool(world, box)
    for (const session of ['someone-else', null]) {
      const result = await (await connect(session, starter)).call('autopilot_start', { epic: EPIC })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe(confirm.UNKNOWN_SESSION_MESSAGE)
    }
    expect(shown).toEqual([])
    expect(world.out.starts).toEqual([])
  })

  it('while a run goes on: the hint to stop it first, no dialog, no new journal line', async () => {
    const world = app({ running: 'billing' })
    world.out.journal.push('run-started')
    const { box, shown } = messageBox()
    const result = await (await connect(NODE_SESSION, tool(world, box).starter)).call('autopilot_start', { epic: EPIC })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(chatRunningHint('billing'))
    expect(textOf(result)).toBe('Autopilot is already running Epic billing. Stop it first.')
    expect(shown).toEqual([])
    expect(world.startFromChat).not.toHaveBeenCalled()
    expect(world.out.journal).toEqual(['run-started'])
  })

  it('an Epic or a Ticket the Project has not is refused by name before anyone is asked', async () => {
    const world = app()
    const { box, shown } = messageBox()
    const rpc = await connect(NODE_SESSION, tool(world, box).starter)
    expect(textOf(await rpc.call('autopilot_start', { epic: 'billing' }))).toBe('The Project has no Epic billing')
    expect(textOf(await rpc.call('autopilot_start', { epic: EPIC, tickets: ['05', '09'] }))).toBe(`Epic ${EPIC} has no Ticket 09`)
    expect(shown).toEqual([])
    expect(world.out.starts).toEqual([])
  })

  it('a server without the starter refuses, and a call without an Epic is a form error', async () => {
    const rpc = await connect(NODE_SESSION, undefined)
    const refused = await rpc.call('autopilot_start', { epic: EPIC })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(server.NO_AUTOPILOT_MESSAGE)
    const world = app()
    const { box, shown } = messageBox()
    const malformed = await (await connect(NODE_SESSION, tool(world, box).starter)).call('autopilot_start', { tickets: ['05'] })
    expect(malformed.isError).toBe(true)
    expect(textOf(malformed)).toMatch(/epic/u)
    expect(shown).toEqual([])
  })
})

describe("autopilot_start from the Project's Orchestrator in its turn", () => {
  it('answers "Autopilot starts after this turn", and the run starts once the Orchestrator is idle', async () => {
    const world = app({ orchestratorInTurn: true })
    const { box, shown, answer } = messageBox()
    const rpc = await connect(ORCHESTRATOR, tool(world, box).starter)
    const call = rpc.call('autopilot_start', { epic: EPIC, tickets: ['06'] })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    answer(0)
    const result = await call
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(textOf(result)).toBe(AFTER_TURN_MESSAGE)
    expect(textOf(result)).toBe('Autopilot starts after this turn')
    expect(world.startFromChat).toHaveBeenCalledWith({ projectId: PROJECT, epic: EPIC, tickets: [6], by: 'tool', session: ORCHESTRATOR })
    await settle()
    expect(world.out.starts).toEqual([])
    world.out.endTurn()
    await vi.waitFor(() => expect(world.out.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [6] }]]))
    expect(world.out.journal).toEqual(['run-started'])
  })
})
