// The start of Autopilot from a chat (worfy-flight-recorder ticket 21, ADR-0091): the command typed in a
// chat (ticket 22) and the Orchestrator's tool (ticket 23) both go through startFromChat. It checks the
// Epic and the named Tickets, refuses while a run goes on, starts the run as the button does, and when
// the Orchestrator of this Project asked in its turn, starts once that turn is over. Autopilot, the
// workflow and the Sessions are stand-ins; the journal is the stand-in Autopilot's, which a refusal
// never reaches.
import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_HAS_QUEUE, ORCHESTRATOR_HAS_TASKS } from '../../src/main/agent/orchestrator'
import {
  AFTER_TURN_MESSAGE,
  ChatStarts,
  chatRunningHint,
  chatWaitingHint,
  lateRefusalNotice,
  orchestratorRefusal,
  whenIdle,
  type ChatStartDeps,
  type ChatStartRequest,
} from '../../src/main/autopilot/chat-start'
import type { AutopilotStartOptions } from '../../src/main/autopilot/run'
import type { BackgroundTask } from '../../src/shared/agent/background-tasks'
import type { AgentEvent, SessionState } from '../../src/shared/agent/events'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const PROJECT = 'demo-000000a4'
const EPIC = 'demo'
const ORCHESTRATOR = 'orch-session'

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
  files: [`src/f${num}.ts`],
  filesListed: true,
  fromBranch: null,
})

const model = (error: string | null = null): WorkflowModel =>
  ({ root: '/repo', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [t(5), t(6), t(7)], error: error === null ? null : { message: error }, branchErrors: [] }) as unknown as WorkflowModel

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((done) => setTimeout(done, 0))
}

/** A stand-in Autopilot, workflow and Orchestrator; every start, journal line and notice is recorded. */
function standIn(options: { running?: string | null; orchestratorBusy?: boolean; workflowError?: string } = {}) {
  const out = {
    starts: [] as [string, string, AutopilotStartOptions | undefined][],
    checks: [] as [string, string, AutopilotStartOptions | undefined][],
    journal: [] as string[],
    notices: [] as [string, string][],
    running: options.running ?? null,
    /** Every Session runs a turn while true: the Orchestrator's and any other. */
    busy: options.orchestratorBusy ?? false,
    /** What Autopilot.startCheck answers. */
    check: null as string | null,
    /** What the Orchestrator's state refuses (tasks, queue). */
    orchestrator: null as string | null,
    /** Ends the Orchestrator's turn: true — it is idle; false — its Session closed first. */
    endTurn: (idle: boolean) => {
      out.busy = false
      turnEnded?.(idle)
    },
    deps: null as unknown as ChatStartDeps,
  }
  let turnEnded: ((idle: boolean) => void) | null = null
  out.deps = {
    autopilot: {
      start: (projectId, epic, start) => {
        out.starts.push([projectId, epic, start])
        out.journal.push('run-started')
        out.running = epic
        return Promise.resolve({ projectId, epic, status: 'running' } as AutopilotState)
      },
      startCheck: (projectId, epic, start) => {
        out.checks.push([projectId, epic, start])
        return Promise.resolve(out.check)
      },
      runningEpic: () => out.running,
    },
    workflow: () => Promise.resolve(model(options.workflowError ?? null)),
    orchestratorSession: () => Promise.resolve(ORCHESTRATOR),
    inTurn: () => out.busy,
    whenIdle: () =>
      new Promise<boolean>((done) => {
        turnEnded = done
      }),
    orchestratorRefusal: () => out.orchestrator,
    notify: (sessionId, text) => void out.notices.push([sessionId, text]),
  }
  return out
}

const fromTurn = (extra: Partial<ChatStartRequest> = {}): ChatStartRequest => ({ projectId: PROJECT, epic: EPIC, by: 'tool', session: ORCHESTRATOR, ...extra })

describe('startFromChat', () => {
  it('refuses an Epic the Project has not, and a named Ticket the Epic has not, by name; nothing starts', async () => {
    const s = standIn()
    const starts = new ChatStarts(s.deps)
    expect(await starts.startFromChat({ projectId: PROJECT, epic: 'other', by: 'command' })).toEqual({ kind: 'refused', message: 'The Project has no Epic other' })
    expect(await starts.startFromChat({ projectId: PROJECT, epic: EPIC, tickets: [5, 9], by: 'tool' })).toEqual({ kind: 'refused', message: 'Epic demo has no Ticket 09' })
    expect(s.starts).toEqual([])
    expect(s.journal).toEqual([])
  })

  it('refuses when the workflow cannot be read, or the Orchestrator of a Project gone meanwhile cannot be asked', async () => {
    const s = standIn({ workflowError: 'no .scratch' })
    expect(await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: 'Cannot read the workflow: no .scratch' })
    const gone = standIn({ orchestratorBusy: true })
    gone.deps.orchestratorSession = () => Promise.reject(new Error('the Orchestrator of demo was stopped'))
    expect(await new ChatStarts(gone.deps).startFromChat(fromTurn())).toEqual({ kind: 'refused', message: 'the Orchestrator of demo was stopped' })
    expect([...s.starts, ...gone.starts]).toEqual([])
  })

  it('refuses while a run goes on in the Project, naming its Epic, and writes nothing to the journal', async () => {
    const s = standIn({ running: 'billing' })
    const answer = await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, tickets: [5], by: 'command' })
    expect(answer).toEqual({ kind: 'refused', message: 'Autopilot is already running Epic billing. Stop it first.' })
    expect(chatRunningHint('billing')).toBe('Autopilot is already running Epic billing. Stop it first.')
    expect(s.starts).toEqual([])
    expect(s.journal).toEqual([])
  })

  it('otherwise starts the run as the button does, with the named Tickets and who started it', async () => {
    const s = standIn()
    const starts = new ChatStarts(s.deps)
    expect(await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toMatchObject({ kind: 'started', state: { status: 'running', epic: EPIC } })
    s.running = null
    await starts.startFromChat({ projectId: PROJECT, epic: EPIC, tickets: [6, 5], by: 'tool' })
    expect(s.starts).toEqual([
      [PROJECT, EPIC, { override: false, by: 'command' }],
      [PROJECT, EPIC, { override: false, by: 'tool', tickets: [6, 5] }],
    ])
  })

  it('passes the Run mode of the request on to the start, and none without one (worfy-resource-planner ticket 06)', async () => {
    const s = standIn()
    const starts = new ChatStarts(s.deps)
    await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'tool', mode: 'start-window' })
    s.running = null
    await starts.startFromChat({ projectId: PROJECT, epic: EPIC, tickets: [5], by: 'tool', mode: 'fastest' })
    s.running = null
    await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })
    expect(s.starts).toEqual([
      [PROJECT, EPIC, { override: false, by: 'tool', mode: 'start-window' }],
      [PROJECT, EPIC, { override: false, by: 'tool', tickets: [5], mode: 'fastest' }],
      [PROJECT, EPIC, { override: false, by: 'command' }],
    ])
    // Without a mode the options have no `mode` key at all: the run takes the default of Settings.
    expect(Object.keys(s.starts[2]![2]!)).not.toContain('mode')
  })

  it('answers a refusal of Autopilot.start in its own words, and a start that lost to another one with the running hint', async () => {
    const s = standIn()
    s.deps.autopilot.start = () => Promise.reject(new Error('The Orchestrator is in a turn'))
    expect(await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: 'The Orchestrator is in a turn' })
    // The button started Epic billing while this start was on its way.
    s.deps.autopilot.start = () => {
      s.running = 'billing'
      return Promise.reject(new Error('Autopilot is already running in this Project (Epic billing): stop it first'))
    }
    expect(await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: chatRunningHint('billing') })
  })

  it('asked from the turn of the Project\'s Orchestrator: checks first, answers "Autopilot starts after this turn", starts only once the Session is idle', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    const answer = await starts.startFromChat(fromTurn({ tickets: [5] }))
    expect(answer).toEqual({ kind: 'after-turn', message: AFTER_TURN_MESSAGE })
    expect(AFTER_TURN_MESSAGE).toBe('Autopilot starts after this turn')
    expect(s.checks).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [5] }]])
    await settle()
    expect(s.starts).toEqual([])
    // A second ask before the turn is over: the start waiting has its own words, there is nothing to stop.
    expect(await starts.startFromChat(fromTurn())).toEqual({ kind: 'refused', message: chatWaitingHint(EPIC) })
    expect(chatWaitingHint(EPIC)).toBe("Autopilot is about to start Epic demo after the Orchestrator's turn.")
    s.endTurn(true)
    await settle()
    expect(s.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [5] }]])
    expect(s.notices).toEqual([])
  })

  it('does not promise a start the Orchestrator\'s tasks or queue, or Autopilot\'s own checks, refuse now; nothing waits after it', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    s.orchestrator = ORCHESTRATOR_HAS_TASKS
    expect(await starts.startFromChat(fromTurn())).toEqual({ kind: 'refused', message: ORCHESTRATOR_HAS_TASKS })
    s.orchestrator = null
    s.check = 'Autopilot is already running Epic demo of this repository on Studio'
    expect(await starts.startFromChat(fromTurn())).toEqual({ kind: 'refused', message: 'Autopilot is already running Epic demo of this repository on Studio' })
    s.check = null
    expect(await starts.startFromChat(fromTurn())).toEqual({ kind: 'after-turn', message: AFTER_TURN_MESSAGE })
    expect(s.starts).toEqual([])
  })

  it('a button pressed while the checks are read wins: the ask is refused and does not wait', async () => {
    const s = standIn({ orchestratorBusy: true })
    s.deps.autopilot.startCheck = () => {
      s.running = 'billing'
      return Promise.resolve(null)
    }
    const starts = new ChatStarts(s.deps)
    expect(await starts.startFromChat(fromTurn())).toEqual({ kind: 'refused', message: chatRunningHint('billing') })
    s.endTurn(true)
    await settle()
    expect(s.starts).toEqual([])
  })

  it('two asks in one turn at once: one waits, the other is refused', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    const answers = await Promise.all([starts.startFromChat(fromTurn()), starts.startFromChat(fromTurn({ tickets: [6] }))])
    expect(answers).toEqual([
      { kind: 'after-turn', message: AFTER_TURN_MESSAGE },
      { kind: 'refused', message: chatWaitingHint(EPIC) },
    ])
    s.endTurn(true)
    await settle()
    expect(s.starts).toEqual([[PROJECT, EPIC, { override: false, by: 'tool' }]])
  })

  it('a refusal after the turn is told on the Orchestrator\'s Session, and frees the Project', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    await starts.startFromChat(fromTurn())
    s.deps.autopilot.start = () => Promise.reject(new Error(ORCHESTRATOR_HAS_QUEUE))
    s.endTurn(true)
    await settle()
    expect(s.notices).toEqual([[ORCHESTRATOR, lateRefusalNotice(EPIC, ORCHESTRATOR_HAS_QUEUE)]])
    expect(lateRefusalNotice(EPIC, 'x')).toBe('Autopilot did not start Epic demo: x')
    expect(await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: ORCHESTRATOR_HAS_QUEUE })
  })

  it('a Session that closes before its turn ends starts nothing, tells nothing, and frees the Project for the next ask', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    await starts.startFromChat(fromTurn())
    s.endTurn(false)
    await settle()
    expect(s.starts).toEqual([])
    expect(s.notices).toEqual([])
    expect(await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toMatchObject({ kind: 'started' })
  })

  it('another Session\'s ask during its own turn, or the Orchestrator\'s while idle, starts at once', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    // A Card's Session in a turn is not the Orchestrator: the run starts now.
    expect(await starts.startFromChat(fromTurn({ session: 'card-session' }))).toMatchObject({ kind: 'started' })
    s.running = null
    s.busy = false
    expect(await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command', session: ORCHESTRATOR })).toMatchObject({ kind: 'started' })
    expect(s.starts).toHaveLength(2)
    expect(s.checks).toEqual([])
  })
})

describe('orchestratorRefusal', () => {
  const task = { taskId: 't1' } as unknown as BackgroundTask
  it('names live background tasks first, then queued messages; none when free', () => {
    expect(orchestratorRefusal({ backgroundTasks: () => [task], queued: () => ({ items: [{}] }) })).toBe(ORCHESTRATOR_HAS_TASKS)
    expect(orchestratorRefusal({ backgroundTasks: () => [], queued: () => ({ items: [{}] }) })).toBe(ORCHESTRATOR_HAS_QUEUE)
    expect(orchestratorRefusal({ backgroundTasks: () => [], queued: () => ({ items: [] }) })).toBeNull()
  })
})

describe('whenIdle', () => {
  function session(state: SessionState) {
    const sinks = new Set<(sessionId: string, event: AgentEvent) => void>()
    return {
      registry: {
        get: (id: string) => {
          if (id !== ORCHESTRATOR) throw new Error(`no Session ${id}`)
          return { state }
        },
        observe: (sink: (sessionId: string, event: AgentEvent) => void) => {
          sinks.add(sink)
          return () => void sinks.delete(sink)
        },
      },
      emit: (sessionId: string, next: SessionState) => {
        for (const sink of [...sinks]) sink(sessionId, { type: 'state', state: next, error: null } as AgentEvent)
      },
      sinks,
    }
  }

  it('settles true at once for an idle Session, false for one that is gone', async () => {
    expect(await whenIdle(session('idle').registry, ORCHESTRATOR)).toBe(true)
    expect(await whenIdle(session('idle').registry, 'gone')).toBe(false)
  })

  it('waits for the Session\'s own idle; closed or failed first settles false; then stops listening', async () => {
    const s = session('busy')
    let answer: boolean | null = null
    void whenIdle(s.registry, ORCHESTRATOR).then((idle) => (answer = idle))
    s.emit('other', 'idle')
    s.emit(ORCHESTRATOR, 'needs_permission')
    await settle()
    expect(answer).toBeNull()
    s.emit(ORCHESTRATOR, 'idle')
    await settle()
    expect(answer).toBe(true)
    expect(s.sinks.size).toBe(0)
    const closing = session('busy')
    const closed = whenIdle(closing.registry, ORCHESTRATOR)
    closing.emit(ORCHESTRATOR, 'closed')
    expect(await closed).toBe(false)
    const failing = session('busy')
    const failed = whenIdle(failing.registry, ORCHESTRATOR)
    failing.emit(ORCHESTRATOR, 'error')
    expect(await failed).toBe(false)
  })
})
