// The Autopilot command typed in a chat through `agent.send` (worfy-flight-recorder ticket 22,
// ADR-0091), on the fake agent: a command does not reach the agent and starts Autopilot through
// startFromChat (the real ChatStarts, over a stand-in Autopilot whose journal is a list); any other
// text, an Epic named alone that the Project does not have, and the Waves Autopilot sends to the
// Session itself (session.send) reach the agent as before. While a run goes on a command is refused
// with the hint, no second run starts and the journal gets no line: not even the line a running run
// writes for a person's input (the registry's input observers hear nothing).
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry } from '../../src/main/agent/session'
import { ChatStarts, type ChatStartRequest } from '../../src/main/autopilot/chat-start'
import type { AutopilotStartOptions } from '../../src/main/autopilot/run'
import { agentHandlers, OUTSIDE_PROJECTS, type AttachDeps, type ChatCommandDeps } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { APP_URL } from '../app-url'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const PROJECT = 'demo-000000a4'
const EPIC = 'demo'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)])

// The plan of the Epic's spec.md, in the Russian headings this repository's specs have.
const SPEC = ['# Demo', '', '## Волны', '', '| Тикет | Файлы | Волна |', '| --- | --- | --- |', '| 01 | `a` | 1 |', '| 02 | `b` | 1 |', '| 03 | `c` | 2 |', ''].join('\n')

const ticket = (num: number, state: Ticket['state']): Ticket => ({
  epic: EPIC,
  num,
  slug: `t${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
})

let scratch: string
let project: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-agent-send-autopilot-')))
  project = join(scratch, 'project')
  await mkdir(project)
  execFileSync('git', ['-C', project, 'init', '-q'])
  await writeFile(join(project, 'README.md'), 'hi\n')
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.restoreAllMocks()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface HarnessOptions {
  /** The Epic of a run already going on. */
  running?: string | null
  /**
   * When the journal hears a person's input: `always` — as if a run were on from the start; `from-start` — once
   * the stand-in Autopilot has started, as a real run subscribes to the input (run.ts).
   */
  input?: 'always' | 'from-start'
  /** Holds Autopilot.start until it settles. */
  startGate?: Promise<void>
  /** What the read of the workflow answers; the model below by default. */
  workflow?: () => Promise<WorkflowModel>
}

async function harness(options: HarnessOptions = {}) {
  const calls: FakeCall[] = []
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: join(import.meta.dirname, '..', 'fixtures', 'agent-scripts'), script: 'message-input', record: (call) => calls.push(call) }))
  registries.push(registry)

  // The stand-in Autopilot: its journal gets `run-started` on a start, and `human-input` whenever the
  // registry tells of a person's input, as a running run's journal does (src/main/autopilot/run.ts).
  const journal: string[] = []
  const starts: [string, string, AutopilotStartOptions | undefined][] = []
  let running = options.running ?? null
  // What happened in order: every person's input the registry tells of, and every start asked of startFromChat.
  const order: string[] = []
  registry.observeInput((_session, what) => order.push(`input ${what}`))
  const journalInput = () => registry.observeInput((_session, what) => journal.push(`human-input ${what}`))
  if (options.input !== 'from-start') journalInput()
  const model: WorkflowModel = { root: project, epics: [{ epic: EPIC, hasSpec: true, hasMap: false, title: 'Demo' }], tickets: [ticket(1, 'done'), ticket(2, 'open'), ticket(3, 'open')], error: null, branchErrors: [] }
  const starter = new ChatStarts({
    autopilot: {
      runningEpic: () => running,
      startCheck: () => Promise.resolve(null),
      start: async (projectId, epic, start) => {
        starts.push([projectId, epic, start])
        await options.startGate
        journal.push('run-started')
        if (options.input === 'from-start') journalInput()
        running = epic
        return { projectId, epic, status: 'running' } as unknown as AutopilotState
      },
    },
    workflow: () => Promise.resolve(model),
    orchestratorSession: () => Promise.resolve(null),
    inTurn: () => false,
    whenIdle: () => Promise.resolve(true),
    orchestratorRefusal: () => null,
    notify: () => undefined,
  })
  const requests: ChatStartRequest[] = []
  const chat: ChatCommandDeps = {
    projectOf: (cwd) => (cwd === project ? PROJECT : null),
    start: (request) => {
      requests.push(request)
      order.push('start asked')
      return starter.startFromChat(request)
    },
    workflow: options.workflow ?? (() => Promise.resolve(model)),
    spec: (_projectId, epic) => Promise.resolve(epic === EPIC ? SPEC : null),
  }
  const attachDeps: AttachDeps = {
    target: (cwd) => ({ projectRoot: project, cwd, attachmentsDir: join(scratch, 'data', 'attachments') }),
    pickFiles: () => Promise.resolve([]),
    imagesDir: () => join(scratch, 'data', 'attachments', 'images'),
  }

  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  const received: AgentEventEnvelope[] = []
  const sender = { isDestroyed: () => false, send: (_channel: string, payload: unknown) => received.push(payload as AgentEventEnvelope), once: () => undefined }
  await registerIpc(ipc, {
    modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry, attachDeps, (send) => send(sender), () => [{ path: project }], chat)) },
    isTrustedSender: (url) => url === APP_URL,
  })
  const ok = async <T>(channel: string, input?: unknown): Promise<T> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const result = (await listener({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  const events = (): AgentEvent[] => received.map((each) => each.event)
  const start = async (cwd = project) => {
    const { sessionId } = await ok<{ sessionId: string }>('agent.start', { cwd })
    await vi.waitFor(() => expect(registry.get(sessionId).state).toBe('idle'))
    return sessionId
  }
  /** What reached the agent, once its one turn is over. */
  const reached = async (): Promise<string[]> => {
    await vi.waitFor(() => expect(events().filter((event) => event.type === 'result')).toHaveLength(1))
    return calls.flatMap((each) => (each.kind === 'message' ? [each.text] : []))
  }
  const send = (sessionId: string, text: string, attachments: unknown[] = []) => ok<{ autopilot: unknown } | undefined>('agent.send', { sessionId, text, attachments })
  return { registry, journal, order, starts, requests, ok, start, send, reached, setRunning: (epic: string | null) => (running = epic) }
}

describe('agent.send: an Autopilot command typed in a chat', () => {
  it('does not reach the agent: startFromChat starts the named Tickets, by `command`, and the answer says so', async () => {
    const h = await harness()
    const id = await h.start()
    expect(await h.send(id, '/worfy:epic-wave tickets 01 of epic demo')).toEqual({ autopilot: { kind: 'started', epic: EPIC, message: 'Autopilot started on Epic demo' } })
    expect(h.requests).toEqual([{ projectId: PROJECT, epic: EPIC, tickets: [1], by: 'command', session: id }])
    expect(h.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'command', tickets: [1] }]])
    // The next message is the agent's first.
    expect(await h.send(id, 'hi')).toBeUndefined()
    expect(await h.reached()).toEqual(['hi'])
    expect(h.journal).toEqual(['run-started', 'human-input sent a message'])
  })

  it('a Wave of the plan: its Tickets not done yet; the whole Epic: no list', async () => {
    const h = await harness()
    const id = await h.start()
    await h.send(id, '/worfy:epic-wave wave 1 of epic demo')
    h.setRunning(null)
    await h.send(id, '/worfy:epic-wave epic demo')
    h.setRunning(null)
    await h.send(id, '/worfy:epic-wave demo')
    expect(h.requests.map(({ epic, tickets }) => ({ epic, tickets }))).toEqual([
      { epic: EPIC, tickets: [2] },
      { epic: EPIC, tickets: undefined },
      { epic: EPIC, tickets: undefined },
    ])
  })

  it('a Wave the plan does not have is refused with the hint to name the Tickets; nothing starts', async () => {
    const h = await harness()
    const id = await h.start()
    expect(await h.send(id, '/worfy:epic-wave wave 7 of epic demo')).toEqual({
      autopilot: { kind: 'refused', epic: EPIC, message: 'The plan of Epic demo has no Wave 7: name the Tickets: tickets NN, NN of epic demo' },
    })
    expect(h.requests).toEqual([])
    expect(h.journal).toEqual([])
  })

  it('other text after the command reaches the agent, and starts nothing', async () => {
    const h = await harness()
    const id = await h.start()
    expect(await h.send(id, '/worfy:epic-wave resume after a session break')).toBeUndefined()
    expect(await h.reached()).toEqual(['/worfy:epic-wave resume after a session break'])
    expect(h.requests).toEqual([])
  })

  it('a word alone that is no Epic of the Project reaches the agent', async () => {
    const h = await harness()
    const id = await h.start()
    expect(await h.send(id, '/worfy:epic-wave resume')).toBeUndefined()
    expect(await h.reached()).toEqual(['/worfy:epic-wave resume'])
    expect(h.requests).toEqual([])
  })

  it('a command with an attachment reaches the agent: the files would have nowhere to go', async () => {
    const h = await harness()
    const id = await h.start()
    const image = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: PNG.length, data: PNG.toString('base64') }
    expect(await h.send(id, '/worfy:epic-wave tickets 01 of epic demo', [image])).toBeUndefined()
    expect((await h.reached())[0]).toContain('/worfy:epic-wave tickets 01 of epic demo')
    expect(h.requests).toEqual([])
  })

  it('the Waves Autopilot sends to the Session itself are not read as a command', async () => {
    const h = await harness()
    const id = await h.start()
    h.registry.get(id).send('/worfy:epic-wave tickets 01 of epic demo', [])
    expect(await h.reached()).toEqual(['/worfy:epic-wave tickets 01 of epic demo'])
    expect(h.requests).toEqual([])
  })

  it('a Session outside every Project is refused', async () => {
    const h = await harness()
    const elsewhere = join(scratch, 'elsewhere')
    await mkdir(elsewhere)
    const id = await h.start(elsewhere)
    expect(await h.send(id, '/worfy:epic-wave tickets 01 of epic demo')).toEqual({ autopilot: { kind: 'refused', epic: EPIC, message: OUTSIDE_PROJECTS } })
    expect(h.requests).toEqual([])
  })
})

describe('agent.send: a command among the other messages of its Session', () => {
  const START = '/worfy:epic-wave tickets 01 of epic demo'
  const image = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: PNG.length, data: PNG.toString('base64') }

  it('a message sent behind a command waits for its answer, and reaches the run it started as a person stepping in', async () => {
    let release!: () => void
    const h = await harness({ input: 'from-start', startGate: new Promise<void>((done) => (release = done)) })
    const id = await h.start()
    const command = h.send(id, START)
    const hi = h.send(id, 'hi, also look at X')
    await new Promise((done) => setTimeout(done, 50))
    // The run has not started yet: the message waits behind the command and has not reached the Session.
    expect(h.order).toEqual(['start asked'])
    release()
    expect(await command).toMatchObject({ autopilot: { kind: 'started' } })
    expect(await hi).toBeUndefined()
    expect(await h.reached()).toEqual(['hi, also look at X'])
    expect(h.journal).toEqual(['run-started', 'human-input sent a message'])
  })

  it('a command waits behind the messages sent before it, attachments and all', async () => {
    const h = await harness()
    const id = await h.start()
    // The image is stored before its message goes (storeImages): the file written takes longer than the command's checks.
    const first = h.send(id, 'look at this', [image])
    const command = h.send(id, START)
    expect(await first).toBeUndefined()
    expect(await command).toMatchObject({ autopilot: { kind: 'started' } })
    expect(h.order).toEqual(['input sent a message', 'start asked'])
  })

  it('a start that throws is a refusal with the error, and the next message still goes', async () => {
    const h = await harness({ workflow: () => Promise.reject(new Error('epic-status failed with exit code 2')) })
    const id = await h.start()
    expect(await h.send(id, '/worfy:epic-wave wave 1 of epic demo')).toEqual({ autopilot: { kind: 'refused', epic: EPIC, message: 'epic-status failed with exit code 2' } })
    expect(h.requests).toEqual([])
    // An Epic named alone cannot be checked without the workflow: the word goes to the agent.
    expect(await h.send(id, '/worfy:epic-wave demo')).toBeUndefined()
    expect(await h.reached()).toEqual(['/worfy:epic-wave demo'])
  })

  it('a workflow read with an error is a refusal that says so', async () => {
    const broken = { root: '/repo', epics: [], tickets: [], error: { code: 'failed', message: 'epic-status found no node' }, branchErrors: [] } as WorkflowModel
    const h = await harness({ workflow: () => Promise.resolve(broken) })
    const id = await h.start()
    expect(await h.send(id, '/worfy:epic-wave wave 1 of epic demo')).toEqual({
      autopilot: { kind: 'refused', epic: EPIC, message: 'Cannot read the workflow: epic-status found no node' },
    })
    expect(h.requests).toEqual([])
  })
})

describe('agent.send: a command while a run goes on', () => {
  it('is refused with the hint; no second run, no journal line, and the agent gets nothing', async () => {
    const h = await harness({ running: EPIC })
    const id = await h.start()
    expect(await h.send(id, '/worfy:epic-wave tickets 02 of epic demo')).toEqual({
      autopilot: { kind: 'refused', epic: EPIC, message: 'Autopilot is already running Epic demo. Stop it first.' },
    })
    expect(await h.send(id, '/worfy:epic-wave wave 1 of epic demo')).toMatchObject({ autopilot: { kind: 'refused' } })
    expect(h.starts).toEqual([])
    expect(h.journal).toEqual([])
    expect(await h.send(id, 'hi')).toBeUndefined()
    expect(await h.reached()).toEqual(['hi'])
  })
})
