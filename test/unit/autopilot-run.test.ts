// The Autopilot run over a scripted Orchestrator Session (worfy-daily ticket 04): which `result`
// ends a Wave when "Run wave" waits in the Session's queue behind a person's message, what happens
// to such a Wave when the run stops, and a Session that fails while the run opens its workflow
// watch. The Session, the waves and the workflow are stand-ins, so every event comes in the order
// the test gives it.
import { afterEach, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AutopilotWaveResult } from '../../src/main/actions/launch'
import { harnessDriftWatch } from '../../src/main/autopilot/harness-drift'
import { Autopilot, QUITTING_MESSAGE, RunningElsewhere, runningElsewhere, STOP_TEXT, type AutopilotDeps, type LinkedRuns, type RunKey, type RunSession } from '../../src/main/autopilot/run'
import { ASK_RUNS_TIMEOUT_MS, AutopilotRunsLink, type RunsLinkService } from '../../src/main/link/autopilot-runs'
import { MessageRegistry, type LinkMessage, type MessageHandler } from '../../src/main/link/messages'
import type { BackgroundTask } from '../../src/shared/agent/background-tasks'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../src/shared/agent/events'
import { journalEventSchema, type JournalEventFields } from '../../src/shared/autopilot/journal'
import type { AutopilotState, HarnessBehind } from '../../src/shared/ipc/autopilot'
import type { PullRequest } from '../../src/shared/ipc/checks'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { readyWave } from '../../src/shared/workflow/waves'

const PROJECT = 'demo-000000a4'
const EPIC = 'demo'
const SESSION = 'orch-session'

const t = (num: number, state: Ticket['state'], blockedNums: number[] = []): Ticket => ({
  epic: EPIC,
  num,
  slug: `slug-${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  blockedRaw: blockedNums.length ? blockedNums.join(', ') : '—',
  blockedNums,
  blockedParsed: true,
  files: [`src/f${num}.ts`],
  filesListed: true,
  fromBranch: null,
})

const result = (interrupted = false): AgentEvent =>
  ({
    type: 'result',
    isError: interrupted,
    interrupted,
    subtype: interrupted ? 'error_during_execution' : 'success',
    text: interrupted ? null : 'done',
    error: interrupted ? 'interrupted' : null,
    costUsd: 0.01,
    durationMs: 1,
    numTurns: 1,
  }) as unknown as AgentEvent

const runs: Autopilot[] = []

afterEach(async () => {
  for (const autopilot of runs.splice(0)) await autopilot.stopAll()
})

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((done) => setTimeout(done, 0))
}

interface StandIn {
  autopilot: Autopilot
  /** Wave 1: 01, 02; Wave 2: 03 (after 01 and 02). */
  tickets: Ticket[]
  emit(event: AgentEvent): void
  /** What the Session's queue holds, as the queue snapshot shows it. */
  queue: { id: string; text: string }[]
  /** Whether the Session's queue is held (after an Interrupt). */
  paused: boolean
  /** How the next "Run wave" goes: at once, or into the queue (a person's turn runs). */
  deliveries: ('sent' | 'queued')[]
  journal: JournalEventFields[]
  removed: string[]
  deps: AutopilotDeps
  /** The Session's state as the run reads it. */
  state: SessionState
  /** The Session's live background tasks. */
  tasks: BackgroundTask[]
  /** What happens on halt() (default: at once); each call is counted in `halts`. */
  onHalt: () => Promise<void>
  halts: number
  /** giveBackNow and setUnattended calls, in order: `give-back`, `unattended true`, `unattended false`. */
  orchestrator: string[]
  /** keep-awake starts and stops. */
  power: string[]
  /** The `resume` list of each "Run wave" the run sent. */
  resumes: (readonly number[] | undefined)[]
  /** What the run sent the Session itself (Session.send): an idle Session starts a turn, a busy one queues it. */
  sent: string[]
  /** Tells the run its workflow changed (`workflow.changed`). */
  workflowChanged: () => void
}

function standIn(overrides: Partial<AutopilotDeps> = {}): StandIn {
  const sinks = new Set<(sessionId: string, event: AgentEvent) => void>()
  const out: StandIn = {
    autopilot: null as unknown as Autopilot,
    tickets: [t(1, 'open'), t(2, 'open'), t(3, 'open', [1, 2])],
    emit: (event) => {
      for (const sink of [...sinks]) sink(SESSION, event)
    },
    queue: [],
    paused: false,
    deliveries: [],
    journal: [],
    removed: [],
    deps: null as unknown as AutopilotDeps,
    state: 'idle',
    tasks: [],
    onHalt: () => Promise.resolve(),
    halts: 0,
    orchestrator: [],
    power: [],
    resumes: [],
    sent: [],
    workflowChanged: () => undefined,
  }
  const session: RunSession = {
    id: SESSION,
    get state() {
      return out.state
    },
    queued: (): QueueSnapshot => ({ items: out.queue.map((item) => ({ ...item })), paused: out.paused }),
    backgroundTasks: () => out.tasks.map((task) => ({ ...task })),
    halt: () => {
      out.halts += 1
      return out.onHalt()
    },
    removeQueued: (id) => {
      const before = out.queue.length
      out.queue = out.queue.filter((item) => item.id !== id)
      if (out.queue.length !== before) out.removed.push(id)
      return out.queue.length !== before
    },
    send: (text) => {
      out.sent.push(text)
      if (out.state !== 'idle') {
        out.queue.push({ id: `sent-${out.sent.length}`, text })
        return 'queued'
      }
      out.state = 'busy'
      out.emit({ type: 'prompt', text })
      return 'sent'
    },
  }
  const model = (): WorkflowModel => ({ root: '/repo', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: out.tickets.map((each) => ({ ...each })), error: null, branchErrors: [] }) as unknown as WorkflowModel
  let sent = 0
  const deps: AutopilotDeps = {
    projectRoot: () => '/repo',
    selfRefusal: () => Promise.resolve(null),
    workflow: () => Promise.resolve(model()),
    watchWorkflow: (_root, onChange) => {
      out.workflowChanged = onChange
      return Promise.resolve(() => undefined)
    },
    orchestrators: {
      setUnattended: (_projectId, unattended) => {
        out.orchestrator.push(`unattended ${unattended}`)
        return Promise.resolve({ sessionId: SESSION } as OrchestratorView)
      },
      giveBackNow: () => {
        out.orchestrator.push('give-back')
        return Promise.resolve({ sessionId: 'attended-session' } as OrchestratorView)
      },
    },
    registry: {
      get: () => session,
      observe: (sink) => {
        sinks.add(sink)
        return () => sinks.delete(sink)
      },
      observeInput: () => () => undefined,
    },
    waves: {
      autopilotWave: (_projectId, _epic, resume): Promise<AutopilotWaveResult> => {
        out.resumes.push(resume)
        const resumed = (resume ?? []).filter((num) => out.tickets.some((each) => each.num === num && each.state === 'work'))
        const tickets = [...resumed, ...readyWave(out.tickets, EPIC).ready.map((entry) => entry.num)]
        const text = `/epic-wave ${tickets.join(' ')}`
        const delivery = out.deliveries.shift() ?? 'sent'
        sent += 1
        if (delivery === 'sent') out.emit({ type: 'prompt', text })
        else out.queue.push({ id: `queued-${sent}`, text })
        return Promise.resolve({ sessionId: SESSION, text, delivery, tickets, skipped: [] })
      },
      autopilotRefusal: () => null,
    },
    journal: () =>
      Promise.resolve({
        run: 'run-1',
        append: (fields) => {
          out.journal.push(fields)
          return Promise.resolve()
        },
      }),
    keepAwake: () => ({ start: () => void out.power.push('start'), stop: () => void out.power.push('stop') }),
    settleMs: 60_000,
    ...overrides,
  }
  out.deps = deps
  out.autopilot = new Autopilot(deps)
  runs.push(out.autopilot)
  return out
}

const kinds = (s: StandIn) => s.journal.map((line) => [line.kind, 'wave' in line ? line.wave : 'reason' in line ? line.reason : null])
const done = (s: StandIn, ...nums: number[]) => {
  for (const num of nums) s.tickets = s.tickets.map((each) => (each.num === num ? { ...each, state: 'done' as const } : each))
}

describe('the Wave a result ends', () => {
  it('a person\'s turn ahead of a queued Wave does not end it; the Wave\'s own result does', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // Wave 1 runs; a person's message waits behind it and goes right after its result.
    done(s, 1, 2)
    s.deliveries.push('queued')
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    await settle()
    // Wave 2 went into the queue behind the person's turn.
    expect(s.queue.map((item) => item.text)).toEqual(['/epic-wave 3'])
    expect(kinds(s)).toEqual([
      ['wave-started', 1],
      ['wave-finished', 1],
      ['wave-started', 2],
    ])
    // The person's turn ends: not the end of Wave 2, whose Ticket has not even started.
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 2 })
    expect(kinds(s)).toHaveLength(3)
    // Wave 2 leaves the queue, runs, and its own result ends it.
    s.queue.shift()
    s.emit({ type: 'prompt', text: '/epic-wave 3' })
    done(s, 3)
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave', wave: 2 })
    expect(kinds(s).slice(3)).toEqual([
      ['wave-finished', 2],
      ['run-stopped', 'no-ready-wave'],
    ])
  })

  it('a person\'s result that comes while "Run wave" is on its way is not the result of the Wave sent after it', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    // Wave 1 ends; the person's message goes right after it and its turn ends too, before the run
    // has read the workflow and sent Wave 2, which then goes at once.
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 2 })
    done(s, 3)
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave' })
  })

  it('a person\'s result inside the sending of a Wave that goes at once is not the Wave\'s', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    // Wave 1 ends; the person's message goes right after it; while Wave 2 is being sent the
    // person's turn ends and Wave 2 starts at once.
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    const wave2 = s.deps.waves.autopilotWave
    s.deps.waves.autopilotWave = (projectId, epic, resume) => {
      s.emit(result())
      return wave2(projectId, epic, resume)
    }
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 2 })
    expect(kinds(s).map(([kind]) => kind)).not.toContain('run-stopped')
    done(s, 3)
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave' })
  })

  it('an Interrupt of the person\'s turn ahead of the queued Wave stops the run, and the Wave leaves the queue', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    s.deliveries.push('queued')
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    await settle()
    expect(s.queue.map((item) => item.text)).toEqual(['/epic-wave 3'])
    s.emit(result(true))
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'interrupted' })
    expect(s.queue).toEqual([])
    expect(s.removed).toEqual(['queued-2'])
  })

  it('a person\'s turn that finishes normally after an Interrupt, leaving the Wave in the held queue, stops the run', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    s.deliveries.push('queued')
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    await settle()
    expect(s.queue.map((item) => item.text)).toEqual(['/epic-wave 3'])
    // Interrupt holds the queue, but the person's turn still ends with success (not interrupted).
    s.paused = true
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'interrupted', wave: 2 })
    expect(kinds(s).slice(3)).toEqual([['run-stopped', 'interrupted']])
    expect(s.removed).toEqual(['queued-2'])
  })

  it('a held queue resumed before the run handles the person\'s result does not stop the run', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    s.deliveries.push('queued')
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    await settle()
    s.paused = true
    s.emit(result())
    // The person resumes the queue at once: the Wave starts before the run looks at the queue.
    s.paused = false
    s.queue.shift()
    s.emit({ type: 'prompt', text: '/epic-wave 3' })
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 2 })
    done(s, 3)
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave' })
  })

  it('a new turn while the run settles ends the Wave with its own result (ADR-0024)', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // Wave 1 ends with 02 still in work: the run settles.
    done(s, 1)
    s.tickets = s.tickets.map((each) => (each.num === 2 ? { ...each, state: 'work' as const } : each))
    s.emit(result())
    await settle()
    expect(kinds(s)).toEqual([['wave-started', 1]])
    // A person's message starts a new turn; 02 becomes done while it runs; its result comes.
    s.emit({ type: 'prompt', text: 'how is it going?' })
    s.emit({ type: 'state', state: 'busy', error: null })
    await settle()
    done(s, 2)
    s.emit(result())
    await settle()
    expect(kinds(s).slice(1, 3)).toEqual([
      ['wave-finished', 1],
      ['wave-started', 2],
    ])
  })

  it('Force stop takes the Wave out of the queue it still waits in; a person\'s own queued message stays', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    s.deliveries.push('queued')
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    await settle()
    s.queue.push({ id: 'person', text: 'and then this' })
    await s.autopilot.forceStop(PROJECT)
    expect(s.queue).toEqual([{ id: 'person', text: 'and then this' }])
    expect(s.removed).toEqual(['queued-2'])
  })

  it('Force stop leaves the queue alone when the Wave\'s turn has started', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.queue.push({ id: 'person', text: '/epic-wave 1 2' })
    await s.autopilot.forceStop(PROJECT)
    expect(s.removed).toEqual([])
    expect(s.queue).toHaveLength(1)
  })
})

describe('Force stop interrupts the Orchestrator and its background tasks (worfy-week tickets 17, 18)', () => {
  const TASK: BackgroundTask = { taskId: 'task-1', taskType: 'local_agent', description: 'Implement 01' }
  const claim = (s: StandIn, ...nums: number[]) => {
    for (const num of nums) s.tickets = s.tickets.map((each) => (each.num === num ? { ...each, state: 'work' as const } : each))
  }
  /** The journal from run-stopped on, with each line's reason, tasks and tickets. */
  const fromStop = (s: StandIn) =>
    s.journal
      .slice(s.journal.findIndex((line) => line.kind === 'run-stopped'))
      .map((line) => ({
        kind: line.kind,
        ...('reason' in line ? { reason: line.reason } : {}),
        ...('tasks' in line && line.tasks !== undefined ? { tasks: line.tasks.map((task) => task.id) } : {}),
        ...('tickets' in line && line.tickets !== undefined ? { tickets: line.tickets } : {}),
      }))

  it('in phase tasks: halts the Session and gives the Orchestrator back at once, once each; the journal says so in order', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // The Wave's turn ends with an implementer alive and its Tickets claimed: the run waits for it.
    claim(s, 1, 2)
    s.tasks = [TASK]
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', backgroundTasks: 1 })
    // The implementer dies with the process the halt and the give-back end.
    s.onHalt = () => {
      s.tasks = []
      return Promise.resolve()
    }
    const stopped = await s.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop', resumable: [1, 2] })
    expect(s.halts).toBe(1)
    expect(s.orchestrator).toEqual(['unattended true', 'give-back'])
    // Nothing lingers: keep-awake is released, and the app's quit has nothing to wait for.
    expect(s.power).toEqual(['start', 'stop'])
    expect(s.autopilot.anyRunning()).toBe(false)
    expect(fromStop(s)).toEqual([
      { kind: 'run-stopped', reason: 'user-force-stop', tasks: ['task-1'], tickets: ['01', '02'] },
      { kind: 'tasks-killed', reason: 'user-force-stop', tasks: ['task-1'] },
      { kind: 'orchestrator-returned' },
    ])
  })

  it('during the Wave\'s turn, before any task: the same, without tasks-killed', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    const stopped = await s.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop' })
    expect(s.halts).toBe(1)
    expect(s.orchestrator).toEqual(['unattended true', 'give-back'])
    expect(s.power).toEqual(['start', 'stop'])
    expect(s.autopilot.anyRunning()).toBe(false)
    expect(fromStop(s)).toEqual([{ kind: 'run-stopped', reason: 'user-force-stop', tickets: ['01', '02'] }, { kind: 'orchestrator-returned' }])
  })

  it('journals as killed a task that started while the halt waited for the turn', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    s.onHalt = () => {
      // The turn started an implementer before the interrupt reached it.
      s.tasks = [TASK]
      s.emit({ type: 'background_tasks', tasks: [TASK] })
      s.state = 'idle'
      return Promise.resolve()
    }
    await s.autopilot.forceStop(PROJECT)
    expect(fromStop(s)).toEqual([
      { kind: 'run-stopped', reason: 'user-force-stop', tickets: ['01', '02'] },
      { kind: 'tasks-killed', reason: 'user-force-stop', tasks: ['task-1'] },
      { kind: 'orchestrator-returned' },
    ])
  })

  it('a second Force stop while the first one waits for the turn halts nothing more; both answer the stopped run', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    let endTurn: () => void = () => undefined
    s.onHalt = () => new Promise((done) => (endTurn = done))
    const first = s.autopilot.forceStop(PROJECT)
    await settle()
    expect(s.halts).toBe(1)
    // The run still ends: it is running until its Orchestrator is back.
    expect(s.autopilot.running(PROJECT)).toBe(true)
    const second = s.autopilot.forceStop(PROJECT)
    // The interrupted turn's result and its tasks' events come in meanwhile: no Wave is judged, nothing is sent.
    s.emit(result(true))
    s.emit({ type: 'background_tasks', tasks: [] })
    s.emit({ type: 'state', state: 'idle', error: null })
    await settle()
    expect(s.orchestrator).toEqual(['unattended true'])
    endTurn()
    const answers = await Promise.all([first, second])
    for (const answer of answers) expect(answer).toMatchObject({ status: 'stopped', reason: 'user-force-stop' })
    expect(s.halts).toBe(1)
    expect(s.orchestrator).toEqual(['unattended true', 'give-back'])
    expect(s.journal.map((line) => line.kind)).toEqual(['wave-started', 'run-stopped', 'orchestrator-returned'])
  })

  it('a stop for another reason still waits for the tasks: no halt, no give-back at once (ADR-0029)', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.tasks = [TASK]
    s.emit(result(true))
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'interrupted', resumable: [] })
    expect(s.halts).toBe(0)
    expect(s.orchestrator).toEqual(['unattended true', 'unattended false'])
    expect(s.power).toEqual(['start'])
    expect(s.autopilot.anyRunning()).toBe(true)
  })

  it('the next run takes the interrupted Tickets still in work first; once, for its first Wave', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    claim(s, 1, 2)
    s.state = 'busy'
    await s.autopilot.forceStop(PROJECT)
    expect(s.autopilot.state(PROJECT).resumable).toEqual([1, 2])
    s.state = 'idle'
    // 01 was finished by hand meanwhile; 02 is still claimed: nothing is ready on its own.
    done(s, 1)
    const again = await s.autopilot.start(PROJECT, EPIC)
    expect(again).toMatchObject({ status: 'running', resumable: [] })
    await settle()
    expect(s.resumes).toEqual([[], [1, 2]])
    expect(s.journal.filter((line) => line.kind === 'wave-started').at(-1)).toMatchObject({ wave: 1, tickets: ['02'] })
    // Wave 2 of this run is the ready set alone.
    done(s, 2)
    s.emit(result())
    await settle()
    expect(s.resumes).toEqual([[], [1, 2], []])
  })

  it('a Stop of another Epic\'s run, or no Stop at all, resumes nothing', async () => {
    const s = standIn()
    expect(s.autopilot.state(PROJECT).resumable).toEqual([])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    claim(s, 1, 2)
    await s.autopilot.forceStop(PROJECT)
    // Another Epic: its run does not take this Epic's Tickets.
    s.tickets = [...s.tickets, { ...s.tickets[0]!, epic: 'other', num: 9 }]
    await s.autopilot.start(PROJECT, 'other').catch(() => undefined)
    await settle()
    expect(s.resumes.at(-1)).toEqual([])
  })
})

describe('the graceful Stop: no new Ticket, the ones in work finish (worfy-week ticket 18)', () => {
  const TASK: BackgroundTask = { taskId: 'task-1', taskType: 'local_agent', description: 'Implement 01' }
  const claim = (s: StandIn, ...nums: number[]) => {
    for (const num of nums) s.tickets = s.tickets.map((each) => (each.num === num ? { ...each, state: 'work' as const } : each))
  }
  /** Every journal line with what the graceful Stop is judged by. */
  const lines = (s: StandIn) =>
    s.journal.map((line) => ({
      kind: line.kind,
      ...('reason' in line ? { reason: line.reason } : {}),
      ...('wave' in line && line.kind === 'run-stopping' ? { wave: line.wave } : {}),
      ...('tickets' in line && line.tickets !== undefined && line.kind !== 'wave-started' ? { tickets: line.tickets } : {}),
      ...('inWork' in line ? { inWork: line.inWork } : {}),
      ...('tasks' in line && line.tasks !== undefined && line.kind !== 'background-tasks' ? { tasks: line.tasks.map((task) => task.id) } : {}),
    }))

  it('during the Wave\'s turn: STOP_TEXT goes once, nothing is halted, stop() answers stopping before the turn ends, and the run ends with its turn', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // The Wave's turn runs and has claimed 01 so far.
    s.state = 'busy'
    claim(s, 1)
    const answer = await s.autopilot.stop(PROJECT)
    expect(answer).toMatchObject({ status: 'running', stopping: true, ticketsInWork: 1 })
    expect(s.sent).toEqual([STOP_TEXT])
    // Behind the running turn: the text waits in the Session's queue.
    expect(s.queue.map((item) => item.text)).toEqual([STOP_TEXT])
    // A second Stop sends nothing more and answers the same.
    expect(await s.autopilot.stop(PROJECT)).toMatchObject({ status: 'running', stopping: true })
    expect(s.sent).toHaveLength(1)
    expect(s.halts).toBe(0)
    // The Wave's turn ends; the queued STOP_TEXT starts the next turn at once.
    s.queue.shift()
    s.emit(result())
    s.emit({ type: 'prompt', text: STOP_TEXT })
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true })
    // That turn ends: idle, no task. 01 is still in work: it is a person's now.
    s.state = 'idle'
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop', stopping: false, ticketsInWork: 0, resumable: [] })
    expect(s.halts).toBe(0)
    expect(s.orchestrator).toEqual(['unattended true', 'unattended false'])
    expect(s.power).toEqual(['start', 'stop'])
    expect(lines(s)).toEqual([
      { kind: 'wave-started' },
      { kind: 'run-stopping', reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork: ['01'] },
      { kind: 'run-stopped', reason: 'user-stop' },
    ])
    // After a graceful Stop the next run takes nothing along, though 01 is still in work.
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(s.resumes).toEqual([[], []])
  })

  it('Stop and the end of the turn at the same moment: the turn STOP_TEXT started decides, no next Wave goes', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // Wave 1 is done and its turn has just ended (the Session idle); the Stop arrives first.
    done(s, 1, 2)
    const answer = s.autopilot.stop(PROJECT)
    s.emit(result())
    await settle()
    expect(await answer).toMatchObject({ stopping: true })
    // STOP_TEXT went at once and runs: the Wave's turn end is not the end of the run.
    expect(s.sent).toEqual([STOP_TEXT])
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true, wave: 1 })
    s.state = 'idle'
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop', wave: 1 })
    // Wave 2 (03) was ready, and still did not go.
    expect(s.resumes).toHaveLength(1)
    expect(s.journal.map((line) => line.kind)).toEqual(['wave-started', 'run-stopping', 'run-stopped'])
  })

  it('while background tasks live: STOP_TEXT starts a turn at once, and the run ends with the turn after the last task', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    claim(s, 1, 2)
    s.tasks = [TASK]
    s.emit({ type: 'background_tasks', tasks: [TASK] })
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', backgroundTasks: 1 })
    expect(await s.autopilot.stop(PROJECT)).toMatchObject({ stopping: true, ticketsInWork: 2 })
    // The Orchestrator is idle: the text starts its turn now, not from the queue.
    expect(s.sent).toEqual([STOP_TEXT])
    expect(s.queue).toEqual([])
    s.state = 'idle'
    s.emit(result())
    await settle()
    // The implementer still runs: the run waits for it.
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true })
    // 01 merges: the count follows the workflow.
    done(s, 1)
    s.workflowChanged()
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true, ticketsInWork: 1 })
    s.tasks = []
    s.emit({ type: 'background_tasks', tasks: [] })
    await settle()
    // The task-notification turn of the last task ends.
    s.emit({ type: 'prompt', text: '<task-notification>' })
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(s.halts).toBe(0)
    expect(s.sent).toHaveLength(1)
    expect(lines(s)).toEqual([
      { kind: 'wave-started' },
      { kind: 'background-tasks' },
      { kind: 'run-stopping', reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork: ['01', '02'] },
      { kind: 'background-tasks' },
      { kind: 'run-stopped', reason: 'user-stop' },
    ])
  })

  it('Force stop during the graceful Stop halts and gives back once each; the next run takes the interrupted Tickets', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    claim(s, 1, 2)
    s.tasks = [TASK]
    s.emit({ type: 'background_tasks', tasks: [TASK] })
    s.state = 'busy'
    await s.autopilot.stop(PROJECT)
    s.onHalt = () => {
      s.tasks = []
      s.state = 'idle'
      return Promise.resolve()
    }
    const stopped = await s.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop', stopping: false, resumable: [1, 2] })
    expect(s.halts).toBe(1)
    expect(s.orchestrator).toEqual(['unattended true', 'give-back'])
    expect(s.power).toEqual(['start', 'stop'])
    expect(s.sent).toEqual([STOP_TEXT])
    expect(lines(s).slice(2)).toEqual([
      { kind: 'run-stopping', reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork: ['01', '02'] },
      { kind: 'run-stopped', reason: 'user-force-stop', tickets: ['01', '02'], tasks: ['task-1'] },
      { kind: 'tasks-killed', reason: 'user-force-stop', tasks: ['task-1'] },
      { kind: 'orchestrator-returned' },
    ])
    // 01 is finished by hand; the next run takes 02, still in work.
    done(s, 1)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(s.resumes.at(-1)).toEqual([1, 2])
    expect(s.journal.filter((line) => line.kind === 'wave-started').at(-1)).toMatchObject({ tickets: ['02'] })
  })

  it('while "Run wave" still waits in the Session\'s queue: the Wave leaves the queue, the run stops with user-stop, STOP_TEXT does not go', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // Wave 2 goes into the queue behind a person's turn.
    done(s, 1, 2)
    s.deliveries.push('queued')
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    await settle()
    expect(s.queue.map((item) => item.text)).toEqual(['/epic-wave 3'])
    const stopped = await s.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop', resumable: [] })
    expect(s.removed).toEqual(['queued-2'])
    expect(s.sent).toEqual([])
    expect(s.halts).toBe(0)
    expect(s.journal.map((line) => line.kind)).toEqual(['wave-started', 'wave-finished', 'wave-started', 'run-stopped'])
  })
})

describe('the click on Stop is noted at once: no Wave goes after it (worfy-week ticket 18)', () => {
  /** The stand-in whose workflow reads take READ_MS once `slow.on` is set, as epic-status and git do. */
  const READ_MS = 50
  function slowStandIn() {
    const s = standIn()
    const fast = s.deps.workflow
    const slow = { on: false }
    s.deps.workflow = async (root) => {
      if (slow.on) await new Promise((done) => setTimeout(done, READ_MS))
      return fast(root)
    }
    return { s, slow }
  }
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
  const kindsOnly = (s: StandIn) => s.journal.map((line) => line.kind)

  it('Stop during the read after the Wave\'s result: the next Wave does not go, the run stops with user-stop', async () => {
    const { s, slow } = slowStandIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    slow.on = true
    s.emit(result())
    // The click comes while the run reads the workflow after the result; Wave 2 (03) is ready.
    await pause(10)
    const answer = await s.autopilot.stop(PROJECT)
    expect(answer).toMatchObject({ status: 'stopped', reason: 'user-stop', stopping: false })
    expect(s.resumes).toHaveLength(1)
    expect(s.sent).toEqual([])
    expect(kindsOnly(s)).toEqual(['wave-started', 'wave-finished', 'run-stopped'])
  })

  it('the state says stopping from the click on, while the step for it still waits', async () => {
    const { s, slow } = slowStandIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.tickets = s.tickets.map((each) => (each.num === 1 ? { ...each, state: 'work' as const } : each))
    slow.on = true
    s.emit(result())
    await pause(10)
    const answer = s.autopilot.stop(PROJECT)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true })
    expect(await answer).toMatchObject({ status: 'stopped', reason: 'user-stop' })
  })

  it('Stop during the read after a workflow change while settling: the next Wave does not go', async () => {
    const { s, slow } = slowStandIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // The Wave's turn ends with 02 still in work: the run settles.
    done(s, 1)
    s.tickets = s.tickets.map((each) => (each.num === 2 ? { ...each, state: 'work' as const } : each))
    s.emit(result())
    await settle()
    expect(kindsOnly(s)).toEqual(['wave-started'])
    // 02 is merged; the watcher's change is read slowly, and the click comes meanwhile.
    done(s, 2)
    slow.on = true
    s.workflowChanged()
    await pause(10)
    const answer = await s.autopilot.stop(PROJECT)
    expect(answer).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(s.resumes).toHaveLength(1)
    expect(kindsOnly(s)).toEqual(['wave-started', 'wave-finished', 'run-stopped'])
  })

  it('Stop before the workflow change while settling: stops at once, the change finds the run stopped', async () => {
    const { s } = slowStandIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1)
    s.tickets = s.tickets.map((each) => (each.num === 2 ? { ...each, state: 'work' as const } : each))
    s.emit(result())
    await settle()
    done(s, 2)
    const answer = s.autopilot.stop(PROJECT)
    s.workflowChanged()
    expect(await answer).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    await settle()
    expect(s.resumes).toHaveLength(1)
    expect(kindsOnly(s)).toEqual(['wave-started', 'run-stopped'])
  })

  it('Stop while "Run wave" is on its way: the Wave goes out stopping, and STOP_TEXT follows it once', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    const wave = s.deps.waves.autopilotWave
    const answers: Promise<unknown>[] = []
    s.deps.waves.autopilotWave = (projectId, epic, resume) => {
      // The click lands while Wave 2 is being sent; its turn starts at once and runs.
      answers.push(s.autopilot.stop(PROJECT))
      s.state = 'busy'
      return wave(projectId, epic, resume)
    }
    s.emit(result())
    await settle()
    await Promise.all(answers)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', stopping: true, wave: 2 })
    expect(s.sent).toEqual([STOP_TEXT])
    expect(s.queue.map((item) => item.text)).toEqual([STOP_TEXT])
    expect(lines(s).slice(2)).toEqual([{ kind: 'wave-started' }, { kind: 'run-stopping', reason: 'user-stop', wave: 2, tickets: ['03'], inWork: [] }])
  })

  it('Stop right after the start, before the first Wave goes: nothing is sent, the run stops with user-stop', async () => {
    // The click lands as the run publishes its first state, before its first step runs.
    let answer: Promise<AutopilotState> | null = null
    const holder: { s?: StandIn } = {}
    const s = standIn({
      onChange: (state) => {
        if (answer === null && state.status === 'running' && state.wave === 0) answer = holder.s!.autopilot.stop(PROJECT)
      },
    })
    holder.s = s
    await s.autopilot.start(PROJECT, EPIC)
    expect(answer).not.toBeNull()
    expect(await answer).toMatchObject({ status: 'stopped', reason: 'user-stop', wave: 0 })
    expect(s.resumes).toEqual([])
    expect(s.sent).toEqual([])
    expect(kindsOnly(s)).toEqual(['run-stopped'])
  })

  it('Force stop right after a Stop whose step still waits: the run ends once, no Wave, no STOP_TEXT', async () => {
    const { s, slow } = slowStandIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    slow.on = true
    s.emit(result())
    await pause(10)
    const answers = await Promise.all([s.autopilot.stop(PROJECT), s.autopilot.forceStop(PROJECT)])
    // The step ahead of both ended the run before the Wave: there was nothing left to interrupt.
    for (const answer of answers) expect(answer).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(s.resumes).toHaveLength(1)
    expect(s.sent).toEqual([])
    expect(s.halts).toBe(0)
    expect(kindsOnly(s).filter((kind) => kind === 'run-stopped')).toHaveLength(1)
  })

  /** Every journal line with what the graceful Stop is judged by. */
  const lines = (s: StandIn) =>
    s.journal.map((line) => ({
      kind: line.kind,
      ...('reason' in line ? { reason: line.reason } : {}),
      ...('wave' in line && line.kind === 'run-stopping' ? { wave: line.wave } : {}),
      ...('tickets' in line && line.tickets !== undefined && line.kind === 'run-stopping' ? { tickets: line.tickets } : {}),
      ...('inWork' in line ? { inWork: line.inWork } : {}),
    }))
})

describe('the Harness in main is newer than this build (worfy-harness ticket 21)', () => {
  const behind = (commits: number): HarnessBehind => ({ harness: '0.1.0+abcdef1', main: 'origin/main', commits })

  /** A stand-in whose harnessDrift answers `answer.value`, read on every call, and counts the calls. */
  function drifting(initial: HarnessBehind | null) {
    const answer = { value: initial, calls: 0 }
    const states: AutopilotState[] = []
    const s = standIn({
      harnessDrift: (projectId, root) => {
        answer.calls += 1
        expect([projectId, root]).toEqual([PROJECT, '/repo'])
        return Promise.resolve(answer.value)
      },
      onChange: (state) => void states.push(state),
    })
    return { s, answer, states }
  }

  it('journals harness-behind right after run-started, and the state carries it', async () => {
    const { s } = drifting(behind(2))
    expect((await s.autopilot.start(PROJECT, EPIC)).harnessBehind).toEqual(behind(2))
    await settle()
    // The stand-in's journal gets the lines after run-started, which openRun writes.
    expect(s.journal[0]).toEqual({ kind: 'harness-behind', harness: '0.1.0+abcdef1', main: 'origin/main', commits: 2 })
    expect(kinds(s)).toEqual([
      ['harness-behind', null],
      ['wave-started', 1],
    ])
    expect(s.autopilot.state(PROJECT).harnessBehind).toEqual(behind(2))
  })

  it('a lesson merged between Waves: a new line right before the next wave-started; the same count writes none', async () => {
    const { s, answer } = drifting(behind(1))
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    answer.value = behind(2)
    done(s, 1, 2)
    s.emit(result())
    await settle()
    expect(kinds(s)).toEqual([
      ['harness-behind', null],
      ['wave-started', 1],
      ['wave-finished', 1],
      ['harness-behind', null],
      ['wave-started', 2],
    ])
    expect(s.journal[3]).toMatchObject({ kind: 'harness-behind', commits: 2 })
    expect(s.autopilot.state(PROJECT).harnessBehind).toEqual(behind(2))
    // Asked before each wave-started, not only at the start.
    expect(answer.calls).toBe(3)
  })

  it('behind only from the second Wave on: the first line comes before that wave-started', async () => {
    const { s, answer } = drifting(null)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    answer.value = behind(1)
    done(s, 1, 2)
    s.emit(result())
    await settle()
    expect(kinds(s).map(([kind]) => kind)).toEqual(['wave-started', 'wave-finished', 'harness-behind', 'wave-started'])
  })

  it('not behind: no line, and the state says null', async () => {
    const { s } = drifting(null)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(kinds(s)).toEqual([['wave-started', 1]])
    expect(s.autopilot.state(PROJECT).harnessBehind).toBeNull()
  })

  it('a development build: no line and no mark, though git would say behind', async () => {
    const check = () => Promise.resolve({ kind: 'newer' as const, harness: '0.1.0+abcdef1', main: 'origin/main', commits: 2 })
    const s = standIn({ harnessDrift: harnessDriftWatch({ packaged: false, harnessVersion: () => '0.1.0+abcdef1', check }) })
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(kinds(s)).toEqual([['wave-started', 1]])
    expect(s.autopilot.state(PROJECT).harnessBehind).toBeNull()
  })

  it('without a run: refreshHarness puts the mark into the state and sends it once; it stays after a run ends', async () => {
    const { s, answer, states } = drifting(behind(1))
    expect(s.autopilot.state(PROJECT).harnessBehind).toBeNull()
    await s.autopilot.refreshHarness(PROJECT)
    expect(states.map((state) => state.harnessBehind)).toEqual([behind(1)])
    expect(s.autopilot.state(PROJECT).harnessBehind).toEqual(behind(1))
    // The same answer again sends nothing.
    await s.autopilot.refreshHarness(PROJECT)
    expect(states).toHaveLength(1)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    await s.autopilot.forceStop(PROJECT)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-force-stop', harnessBehind: behind(1) })
    // Caught up after a rebuild: the stopped state drops the mark.
    answer.value = null
    await s.autopilot.refreshHarness(PROJECT)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-force-stop', harnessBehind: null })
    expect(states.at(-1)?.harnessBehind).toBeNull()
  })

  it('a harnessDrift that throws is no mark, and the run goes on', async () => {
    const s = standIn({ harnessDrift: () => Promise.reject(new Error('git is gone')) })
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(kinds(s)).toEqual([['wave-started', 1]])
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', harnessBehind: null })
  })
})

describe('the narrow fix round from the PR comments (worfy-harness ticket 20)', () => {
  const pr = (number: number, branch: string, narrow?: PullRequest['narrow']): PullRequest => ({
    number,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'OPEN',
    branch,
    ci: null,
    verdict: null,
    ...(narrow === undefined ? {} : { narrow }),
  })
  // Comments made during the run: an hour after now (the run starts in the test, after this line).
  const during = new Date(Date.now() + 3_600_000).toISOString()
  const STARTED = { outcome: 'started' as const, text: 'NARROW: [med] src/a.ts:1 — x', at: during }
  const REJECTED = { outcome: 'rejected' as const, text: 'NARROW: REJECTED: src/a.ts:1 still open', at: during }

  /**
   * A stand-in whose PR reader answers `reader.pulls` (or throws `reader.error`) and records the
   * branches of each read; its read timer fires only on `tick()`.
   */
  function reading(pulls: PullRequest[] = []) {
    const reader = { pulls, error: null as Error | null, reads: [] as string[][] }
    const timers = new Map<number, () => void>()
    let next = 0
    const s = standIn({
      prs: {
        read: (root, branches) => {
          expect(root).toBe('/repo')
          reader.reads.push([...branches])
          return reader.error === null ? Promise.resolve({ pulls: reader.pulls.map((each) => ({ ...each })) }) : Promise.reject(reader.error)
        },
      },
      prsClock: {
        setTimeout: (fn) => {
          next += 1
          timers.set(next, fn)
          return next
        },
        clearTimeout: (handle) => void timers.delete(handle as number),
      },
    })
    const tick = async (): Promise<void> => {
      const due = [...timers.values()]
      timers.clear()
      for (const fn of due) fn()
      await settle()
    }
    return { s, reader, tick, timers }
  }
  const narrowLines = (s: StandIn) => s.journal.filter((line) => line.kind === 'narrow-round')
  const outcomes = (s: StandIn) => narrowLines(s).map((line) => ('outcome' in line ? line.outcome : null))

  it('a new state on the PR of a Wave Ticket is one line; the same state at the next read writes none', async () => {
    const { s, reader, tick } = reading([pr(5, 'demo/02')])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // Read at wave-started, for the branches of the Wave's Tickets: nothing on the PR yet.
    expect(reader.reads).toEqual([['demo/01', 'demo/02']])
    expect(narrowLines(s)).toEqual([])

    reader.pulls = [pr(5, 'demo/02', [STARTED])]
    await tick()
    expect(narrowLines(s)).toEqual([{ kind: 'narrow-round', ticket: '02', outcome: 'started', text: STARTED.text }])
    await tick()
    expect(narrowLines(s)).toHaveLength(1)

    reader.pulls = [pr(5, 'demo/02', [STARTED, REJECTED])]
    await tick()
    expect(narrowLines(s)).toEqual([
      { kind: 'narrow-round', ticket: '02', outcome: 'started', text: STARTED.text },
      { kind: 'narrow-round', ticket: '02', outcome: 'rejected', text: REJECTED.text },
    ])
    await tick()
    expect(narrowLines(s)).toHaveLength(2)
    expect(reader.reads).toHaveLength(5)
  })

  it('states seen for the first time together are journaled in comment order, one line each', async () => {
    const { s } = reading([pr(5, 'demo/02', [STARTED, REJECTED])])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(kinds(s)).toEqual([
      ['wave-started', 1],
      ['narrow-round', null],
      ['narrow-round', null],
    ])
    expect(outcomes(s)).toEqual(['started', 'rejected'])
  })

  it("a Ticket not of the run's Waves, or of another Epic, or a branch that names no Ticket: no line", async () => {
    const { s, tick } = reading([pr(6, 'demo/03', [STARTED]), pr(7, 'other/02', [STARTED]), pr(8, 'feature-narrow', [STARTED])])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    await tick()
    expect(narrowLines(s)).toEqual([])
  })

  it('a Ticket of an earlier Wave of the run still counts once the next Wave goes', async () => {
    const { s, reader, tick } = reading([])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    s.emit(result())
    await settle()
    expect(kinds(s).map(([kind]) => kind)).toEqual(['wave-started', 'wave-finished', 'wave-started'])
    expect(reader.reads.at(-1)).toEqual(['demo/01', 'demo/02', 'demo/03'])
    reader.pulls = [pr(5, 'demo/02', [STARTED, { outcome: 'verified', text: 'NARROW: VERIFIED', at: during }])]
    await tick()
    expect(outcomes(s)).toEqual(['started', 'verified'])
  })

  it('a failing read writes no line, and the run goes on; the next read journals what it finds', async () => {
    const { s, reader, tick } = reading([pr(5, 'demo/02', [STARTED])])
    reader.error = new Error('gh unavailable')
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    await tick()
    expect(narrowLines(s)).toEqual([])
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 1 })
    done(s, 1, 2)
    s.emit(result())
    await settle()
    expect(kinds(s)).toEqual([
      ['wave-started', 1],
      ['wave-finished', 1],
      ['wave-started', 2],
    ])
    reader.error = null
    await tick()
    expect(narrowLines(s)).toHaveLength(1)
  })

  it('the run reads once more before run-stopped: a Ticket blocked after NARROW: REJECTED has its line ahead of blocked-tickets', async () => {
    const { s, reader } = reading([pr(5, 'demo/02', [STARTED])])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    reader.pulls = [pr(5, 'demo/02', [STARTED, REJECTED])]
    done(s, 1)
    s.tickets = s.tickets.map((each) => (each.num === 2 ? { ...each, state: 'blocked' as const } : each))
    s.emit(result())
    await settle()
    expect(kinds(s)).toEqual([
      ['wave-started', 1],
      ['narrow-round', null],
      ['wave-finished', 1],
      ['narrow-round', null],
      ['run-stopped', 'blocked-tickets'],
    ])
    expect(s.journal.at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'blocked-tickets', tickets: ['02'] })
    expect(s.journal[3]).toEqual({ kind: 'narrow-round', ticket: '02', outcome: 'rejected', text: REJECTED.text })
  })

  it('no read after the run: the timer is gone, a late answer writes nothing; a Force stop does not wait for gh', async () => {
    const { s, reader, tick, timers } = reading([])
    let answer: (() => void) | null = null
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    // From now on a read does not answer until the test says so.
    s.deps.prs = {
      read: (_root, branches) => {
        reader.reads.push([...branches])
        return new Promise((resolve) => {
          answer = () => resolve({ pulls: [pr(5, 'demo/02', [STARTED])] })
        })
      },
    }
    await tick()
    expect(answer).not.toBeNull()
    const reads = reader.reads.length
    await s.autopilot.forceStop(PROJECT)
    expect(reader.reads).toHaveLength(reads)
    expect(timers.size).toBe(0)
    answer!()
    await settle()
    expect(narrowLines(s)).toEqual([])
    expect(kinds(s).at(-1)).toEqual(['orchestrator-returned', null])
  })

  it('a comment made before the run started (an earlier run, a closed PR) writes no line; one without a time is taken', async () => {
    const before = '2026-01-01T00:00:00Z'
    const { s } = reading([
      pr(4, 'demo/01', [{ ...STARTED, at: before }, { ...REJECTED, at: before }]),
      pr(5, 'demo/02', [{ ...STARTED, at: before }, { outcome: 'verified', text: 'NARROW: VERIFIED', at: null }]),
    ])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(narrowLines(s)).toEqual([{ kind: 'narrow-round', ticket: '02', outcome: 'verified', text: 'NARROW: VERIFIED' }])
  })

  /** Ticket 01 done and 02 blocked, as the Orchestrator leaves them: the Wave's end stops the run with blocked-tickets. */
  const blockTwo = (s: StandIn): void => {
    done(s, 1)
    s.tickets = s.tickets.map((each) => (each.num === 2 ? { ...each, state: 'blocked' as const } : each))
  }

  /** A reader whose first read (at wave-started) answers at once and whose later reads wait for `answer()`. */
  function slowAfterFirst() {
    const slow = { reads: 0, answer: null as (() => void) | null }
    const read = (): Promise<{ pulls: PullRequest[] }> => {
      slow.reads += 1
      if (slow.reads === 1) return Promise.resolve({ pulls: [] })
      return new Promise((resolve) => {
        slow.answer = () => resolve({ pulls: [pr(5, 'demo/02', [STARTED, REJECTED])] })
      })
    }
    return { slow, read }
  }

  /** Fails when `promise` has not settled within `ms` of real time. */
  const within = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([promise, new Promise<never>((_done, fail) => setTimeout(() => fail(new Error(`not settled within ${ms} ms`)), ms))])

  it('the app\'s quit does not wait for gh: stopAll during the last read ends the run at once, and the late answer writes nothing', async () => {
    const { slow, read } = slowAfterFirst()
    // A limit far longer than the 3 s the quit waits: only the quit itself may cut the read short.
    const s = standIn({ prs: { read }, endReadMs: 60_000 })
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    blockTwo(s)
    s.emit(result())
    await settle()
    // The end waits for its read: run-stopped is not written yet.
    expect(slow.reads).toBe(2)
    expect(kinds(s).map(([kind]) => kind)).toEqual(['wave-started', 'wave-finished'])
    await within(s.autopilot.stopAll(), 500)
    expect(kinds(s).at(-1)).toEqual(['run-stopped', 'blocked-tickets'])
    slow.answer!()
    await settle()
    expect(narrowLines(s)).toEqual([])
  })

  it('Force stop during the last read does not wait for gh: the run ends at once with its own reason', async () => {
    const { slow, read } = slowAfterFirst()
    const s = standIn({ prs: { read }, endReadMs: 60_000 })
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    blockTwo(s)
    s.emit(result())
    await settle()
    expect(slow.reads).toBe(2)
    const state = await within(s.autopilot.forceStop(PROJECT), 500)
    expect(state).toMatchObject({ status: 'stopped', reason: 'blocked-tickets' })
    expect(kinds(s).at(-1)).toEqual(['run-stopped', 'blocked-tickets'])
    slow.answer!()
    await settle()
    expect(narrowLines(s)).toEqual([])
  })

  it('the last read waits endReadMs at most: then run-stopped goes without its answer', async () => {
    const { s, tick } = reading([])
    const { slow, read } = slowAfterFirst()
    s.deps.prs = { read }
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    blockTwo(s)
    s.emit(result())
    await settle()
    expect(slow.reads).toBe(2)
    expect(kinds(s).map(([kind]) => kind)).toEqual(['wave-started', 'wave-finished'])
    // The limit's timer (and the every-minute read's, cleared at the end) fire.
    await tick()
    expect(kinds(s).at(-1)).toEqual(['run-stopped', 'blocked-tickets'])
    slow.answer!()
    await settle()
    expect(narrowLines(s)).toEqual([])
  })

  it('without a PR reader: no read, no line, as before', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(kinds(s)).toEqual([['wave-started', 1]])
  })
})

describe('the gate queue before the run stops for want of a Wave (worfy-windows ticket 17)', () => {
  const GATE_TEXT = '/worfy:gate-queue'
  /** The fields the journal file adds to each line (src/main/autopilot/journal.ts), for the real schema. */
  const JOURNAL_COMMON = { at: '2026-10-18T10:00:00.000Z', run: '2026-10-18T10-00-00-000Z-abcdef', project: PROJECT, epic: EPIC }
  /** A stand-in whose "Process gate queue" answers `text` (null: not the machine with serve, or no template); each call counted. */
  function gated(text: string | null, overrides: Partial<AutopilotDeps> = {}) {
    const s = standIn(overrides)
    const calls: string[] = []
    s.deps.waves.autopilotGateQueue = (projectId) => {
      calls.push(projectId)
      return Promise.resolve(text)
    }
    return { s, calls }
  }
  const answer = (text: string): AgentEvent => ({ ...(result() as object), text }) as unknown as AgentEvent
  const lines = (s: StandIn) =>
    s.journal.map((line) => ({
      kind: line.kind,
      ...('reason' in line ? { reason: line.reason } : {}),
      ...('text' in line && line.kind === 'gate-queue' ? { text: line.text } : {}),
      ...('tickets' in line && line.kind === 'run-stopped' && line.tickets !== undefined ? { tickets: line.tickets } : {}),
      ...('lastText' in line && line.lastText !== undefined ? { lastText: line.lastText } : {}),
    }))

  it('serve, no ready Wave at the start: the template goes, gate-queue is journaled, and run-stopped with no-ready-wave follows its turn', async () => {
    const { s, calls } = gated(GATE_TEXT)
    done(s, 1, 2, 3)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(s.sent).toEqual([GATE_TEXT])
    expect(calls).toEqual([PROJECT])
    expect(lines(s)).toEqual([{ kind: 'gate-queue', text: GATE_TEXT }])
    // The turn goes on: the run waits for its end, as for a Wave.
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running' })
    s.state = 'idle'
    s.emit(answer('queue empty'))
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'no-ready-wave' })
    expect(lines(s)).toEqual([{ kind: 'gate-queue', text: GATE_TEXT }, { kind: 'run-stopped', reason: 'no-ready-wave' }])
    expect(s.power).toEqual(['start', 'stop'])
    expect(s.orchestrator).toEqual(['unattended true', 'unattended false'])
    // Once per run.
    expect(calls).toHaveLength(1)
  })

  it('serve, after the last Wave: blocked-tickets with its Tickets and the Wave\'s last answer, after the gate queue\'s turn; no second wave-finished', async () => {
    const { s, calls } = gated(GATE_TEXT)
    s.tickets = [t(1, 'open'), t(2, 'open'), t(3, 'blocked', [1, 2])]
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    s.emit(result())
    await settle()
    expect(s.sent).toEqual([GATE_TEXT])
    expect(lines(s)).toEqual([{ kind: 'wave-started' }, { kind: 'wave-finished' }, { kind: 'gate-queue', text: GATE_TEXT }])
    s.state = 'idle'
    s.emit(answer('merged #470'))
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'blocked-tickets', wave: 1 })
    expect(lines(s)).toEqual([
      { kind: 'wave-started' },
      { kind: 'wave-finished' },
      { kind: 'gate-queue', text: GATE_TEXT },
      { kind: 'run-stopped', reason: 'blocked-tickets', tickets: ['03'], lastText: 'done' },
    ])
    expect(calls).toHaveLength(1)
  })

  it('the gate queue\'s turn makes a Ticket ready: the run still stops with the reason it had, no Wave goes', async () => {
    const { s } = gated(GATE_TEXT)
    s.tickets = [t(1, 'open'), t(2, 'blocked')]
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1)
    s.emit(result())
    await settle()
    // The merge of the queue unblocked 02.
    s.tickets = s.tickets.map((each) => (each.num === 2 ? { ...each, state: 'open' as const } : each))
    s.state = 'idle'
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'blocked-tickets' })
    expect(s.resumes).toHaveLength(1)
    expect(s.journal.map((line) => line.kind)).toEqual(['wave-started', 'wave-finished', 'gate-queue', 'run-stopped'])
  })

  it('request, no field or no template (null): no gate-queue, the run stops at once', async () => {
    const { s, calls } = gated(null)
    done(s, 1, 2, 3)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(calls).toEqual([PROJECT])
    expect(s.sent).toEqual([])
    expect(lines(s)).toEqual([{ kind: 'run-stopped', reason: 'no-ready-wave' }])
  })

  it('a Stop by the owner: no gate-queue, though no Wave is left', async () => {
    const { s, calls } = gated(GATE_TEXT)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2, 3)
    s.state = 'busy'
    await s.autopilot.stop(PROJECT)
    s.queue.shift()
    s.emit(result())
    s.emit({ type: 'prompt', text: STOP_TEXT })
    await settle()
    s.state = 'idle'
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(calls).toEqual([])
    expect(s.sent).toEqual([STOP_TEXT])
    expect(s.journal.map((line) => line.kind)).not.toContain('gate-queue')
  })

  it('a Stop while the role and the template are read: no gate-queue, the run stops with its reason', async () => {
    const { s } = gated(GATE_TEXT)
    s.deps.waves.autopilotGateQueue = () => {
      void s.autopilot.stop(PROJECT)
      return Promise.resolve(GATE_TEXT)
    }
    done(s, 1, 2, 3)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(s.sent).toEqual([])
    expect(lines(s)).toEqual([{ kind: 'run-stopped', reason: 'no-ready-wave' }])
  })

  it('a Force stop while the role and the template are read: no gate-queue, the template is not sent', async () => {
    const { s } = gated(GATE_TEXT)
    let forced: Promise<unknown> = Promise.resolve()
    s.deps.waves.autopilotGateQueue = () => {
      forced = s.autopilot.forceStop(PROJECT)
      return Promise.resolve(GATE_TEXT)
    }
    done(s, 1, 2, 3)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    await forced
    await settle()
    expect(s.sent).toEqual([])
    expect(s.journal.map((line) => line.kind)).not.toContain('gate-queue')
    expect(lines(s)).toEqual([{ kind: 'run-stopped', reason: 'no-ready-wave' }])
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped' })
  })

  it('a Stop during the gate queue\'s turn is graceful, as in a Wave: STOP_TEXT behind the turn, user-stop after it', async () => {
    const { s } = gated(GATE_TEXT)
    done(s, 1, 2, 3)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(await s.autopilot.stop(PROJECT)).toMatchObject({ status: 'running', stopping: true })
    expect(s.sent).toEqual([GATE_TEXT, STOP_TEXT])
    expect(s.halts).toBe(0)
    s.queue.shift()
    s.emit(result())
    s.emit({ type: 'prompt', text: STOP_TEXT })
    await settle()
    s.state = 'idle'
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    // No run-stopping: the turn has no Wave, and a run-stopping with wave 0 would not pass the journal's schema.
    expect(s.journal.map((line) => line.kind)).toEqual(['gate-queue', 'run-stopped'])
    for (const line of s.journal) expect(journalEventSchema.safeParse({ ...line, ...JOURNAL_COMMON }).error?.issues ?? []).toEqual([])
  })

  it('a Force stop during the gate queue\'s turn: the Session is halted, run-stopped says user-force-stop', async () => {
    const { s } = gated(GATE_TEXT)
    done(s, 1, 2, 3)
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(await s.autopilot.forceStop(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-force-stop', resumable: [] })
    expect(s.halts).toBe(1)
    expect(lines(s)).toEqual([{ kind: 'gate-queue', text: GATE_TEXT }, { kind: 'run-stopped', reason: 'user-force-stop' }, { kind: 'orchestrator-returned' }])
  })

  it('limits-timeout: no gate-queue', async () => {
    const far = Date.now() + 30 * 24 * 3_600_000
    const limits = {
      state: () => ({ windows: { seven_day: { utilization: 1, resetsAt: far / 1000, status: 'rejected', receivedAt: Date.now(), source: 'sdk' as const } } }),
      observeSession: () => () => undefined,
      send: () => undefined,
    }
    const { s, calls } = gated(GATE_TEXT, { limits })
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2, 3)
    s.state = 'idle'
    s.emit({ ...(result() as object), isError: true, subtype: 'error_during_execution', text: null, error: "You've hit your limit" } as unknown as AgentEvent)
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'limits-timeout' })
    expect(calls).toEqual([])
    expect(s.journal.map((line) => line.kind)).toEqual(['wave-started', 'limits-hit', 'run-stopped'])
  })
})

describe('a Session that fails while the run opens its workflow watch', () => {
  it('ends the run, closes the watch, and keeps no run behind', async () => {
    let unwatched = 0
    let open: (() => void) | null = null
    const s = standIn({
      watchWorkflow: () =>
        new Promise((resolve) => {
          open = () => resolve(() => void (unwatched += 1))
        }),
    })
    const started = s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(open).not.toBeNull()
    s.emit({ type: 'state', state: 'error', error: 'Claude Code exited' })
    await settle()
    open!()
    const state = await started
    expect(state).toMatchObject({ status: 'stopped', reason: 'session-error' })
    expect(unwatched).toBe(1)
    expect(s.autopilot.running(PROJECT)).toBe(false)
    expect(s.autopilot.anyRunning()).toBe(false)
    expect(kinds(s)).toEqual([
      ['session-error', null],
      ['run-stopped', 'session-error'],
    ])
  })
})

describe('one Autopilot per Epic and origin across the Linked machines (worfy-link ticket 15)', () => {
  const KEY = 'github.com/idsad-xl/worfy'
  const HERE = { id: '00000000-0000-4000-8000-0000000000aa', name: 'Laptop' }

  /** A stand-in whose Project has origin KEY (or `origin`), and whose Linked machines answer `answers`. */
  function linked(answers: () => Promise<LinkedRuns[]> | LinkedRuns[], origin: string | null = KEY, overrides: Partial<AutopilotDeps> = {}) {
    let asked = 0
    const opened: Parameters<AutopilotDeps['journal']>[0][] = []
    const s = standIn({
      origin: () => Promise.resolve(origin),
      linkedRuns: async () => {
        asked += 1
        return answers()
      },
      machine: () => HERE,
      ...overrides,
    })
    const journal = s.deps.journal
    s.deps.journal = (start) => {
      opened.push(start)
      return journal(start)
    }
    return { s, opened, asked: () => asked }
  }

  it('a Linked machine runs the same Epic of the same origin: start is refused with its name, nothing is taken', async () => {
    const { s, opened } = linked(() => [{ machine: 'Studio', runs: [{ epic: EPIC, origin: KEY }] }])
    const refusal = await s.autopilot.start(PROJECT, EPIC).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(RunningElsewhere)
    expect((refusal as RunningElsewhere).message).toBe(runningElsewhere(EPIC, 'Studio'))
    expect(refusal).toMatchObject({ epic: EPIC, machine: 'Studio' })
    expect(runningElsewhere(EPIC, 'Studio')).toBe(`Autopilot is already running Epic ${EPIC} of this repository on Studio`)
    expect(s.orchestrator).toEqual([])
    expect(s.power).toEqual([])
    expect(opened).toEqual([])
    expect(s.autopilot.running(PROJECT)).toBe(false)
    expect(s.autopilot.anyRunning()).toBe(false)
    expect(s.autopilot.runKeys()).toEqual([])
  })

  it('another Epic or another origin on the Linked machine: the start goes, and the run is answered by its key', async () => {
    const { s, opened } = linked(() => [
      { machine: 'Studio', runs: [{ epic: 'other', origin: KEY }] },
      { machine: 'Desk', runs: [{ epic: EPIC, origin: 'github.com/idsad-xl/other' }] },
    ])
    await s.autopilot.start(PROJECT, EPIC)
    expect(s.orchestrator).toEqual(['unattended true'])
    expect(opened).toEqual([{ project: PROJECT, epic: EPIC, origin: KEY }])
    expect(s.autopilot.runKeys()).toEqual([{ epic: EPIC, origin: KEY }])
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', machine: HERE, unasked: [] })
  })

  it('Start anyway (override) while the other run goes on: the run goes, and run-started says override', async () => {
    const { s, opened, asked } = linked(() => [{ machine: 'Studio', runs: [{ epic: EPIC, origin: KEY }] }])
    await s.autopilot.start(PROJECT, EPIC, { override: true })
    expect(asked()).toBe(1)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running' })
    expect(opened).toEqual([{ project: PROJECT, epic: EPIC, origin: KEY, override: true }])
  })

  it('Start anyway once the other run has ended: asked again, a plain start, no override in run-started', async () => {
    const { s, opened, asked } = linked(() => [
      { machine: 'Studio', runs: [] },
      { machine: 'Desk', runs: null },
    ])
    await s.autopilot.start(PROJECT, EPIC, { override: true })
    expect(asked()).toBe(1)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', unasked: ['Desk'] })
    expect(opened).toEqual([{ project: PROJECT, epic: EPIC, origin: KEY, unasked: ['Desk'] }])
  })

  it('Start anyway past another Project of this Machine: the run goes with override', async () => {
    const { s, opened } = linked(() => [])
    s.deps.projectRoot = (projectId) => `/repo/${projectId}`
    await s.autopilot.start(PROJECT, EPIC)
    await s.autopilot.start('clone-00000001', EPIC, { override: true })
    expect(opened.at(-1)).toEqual({ project: 'clone-00000001', epic: EPIC, origin: KEY, override: true })
  })

  it('another Project of this Machine over the same repository runs the Epic: refused, naming this Machine', async () => {
    const { s } = linked(() => [])
    s.deps.projectRoot = (projectId) => `/repo/${projectId}`
    await s.autopilot.start(PROJECT, EPIC)
    await expect(s.autopilot.start('clone-00000001', EPIC)).rejects.toThrow(runningElsewhere(EPIC, `${HERE.name} (this Machine, Project ${PROJECT})`))
    // A Project of this Machine over another repository runs the same Epic.
    s.deps.origin = (root) => Promise.resolve(root.endsWith('fork-00000002') ? 'github.com/someone/worfy' : KEY)
    await expect(s.autopilot.start('fork-00000002', EPIC)).resolves.toMatchObject({ status: 'running', epic: EPIC })
  })

  it('two Machines start one key at once, each answering while the other starts: at most one run goes', async () => {
    let both: () => void = () => undefined
    let inside = 0
    const met = new Promise<void>((done) => (both = done))
    const meet = async (): Promise<void> => {
      inside += 1
      if (inside === 2) both()
      await met
    }
    const pair: { s: StandIn }[] = []
    const answerOf = (other: number) => async (): Promise<LinkedRuns[]> => {
      await meet()
      return [{ machine: `machine ${other}`, runs: pair[other]!.s.autopilot.runKeys() }]
    }
    pair.push(linked(answerOf(1)), linked(answerOf(0)))
    const results = await Promise.allSettled(pair.map(({ s }) => s.autopilot.start(PROJECT, EPIC)))
    const going = pair.filter(({ s }) => s.autopilot.running(PROJECT)).length
    expect(going).toBeLessThanOrEqual(1)
    expect(results.filter((each) => each.status === 'fulfilled')).toHaveLength(going)
    for (const each of results) if (each.status === 'rejected') expect(each.reason).toBeInstanceOf(RunningElsewhere)
  })

  it('the second of two starts asks while the first runs: only the first goes', async () => {
    const pair: { s: StandIn }[] = []
    pair.push(
      linked(() => [{ machine: 'B', runs: pair[1]!.s.autopilot.runKeys() }]),
      linked(() => [{ machine: 'A', runs: pair[0]!.s.autopilot.runKeys() }]),
    )
    await pair[0]!.s.autopilot.start(PROJECT, EPIC)
    await expect(pair[1]!.s.autopilot.start(PROJECT, EPIC)).rejects.toThrow(runningElsewhere(EPIC, 'A'))
  })

  it('a run that waits for the Limits is still answered', async () => {
    const { s } = linked(() => [])
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(s.autopilot.runKeys()).toEqual([{ epic: EPIC, origin: KEY }])
    await s.autopilot.forceStop(PROJECT)
    expect(s.autopilot.runKeys()).toEqual([])
  })

  it('question 1: a Linked machine that did not answer within 3 s does not block; the state and run-started name it', async () => {
    const { s, opened } = linked(() => [
      { machine: 'Studio', runs: null },
      { machine: 'Desk', runs: [] },
    ])
    await s.autopilot.start(PROJECT, EPIC)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running', unasked: ['Studio'] })
    expect(opened).toEqual([{ project: PROJECT, epic: EPIC, origin: KEY, unasked: ['Studio'] }])
  })

  it('question 3: a Project without origin asks no one, and starts as before', async () => {
    const { s, opened, asked } = linked(() => [{ machine: 'Studio', runs: [{ epic: EPIC, origin: KEY }] }], null)
    await s.autopilot.start(PROJECT, EPIC)
    expect(asked()).toBe(0)
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'running' })
    expect(opened).toEqual([{ project: PROJECT, epic: EPIC }])
    expect(s.autopilot.runKeys()).toEqual([])
  })

  it('an origin read or a question that throws counts as no origin and no answer: the start goes', async () => {
    const { s } = linked(() => Promise.reject(new Error('link down')), KEY, { origin: () => Promise.reject(new Error('git gone')) })
    await expect(s.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running' })
    const other = linked(() => Promise.reject(new Error('link down')))
    await expect(other.s.autopilot.start(PROJECT, EPIC)).resolves.toMatchObject({ status: 'running', unasked: [] })
  })

  it('the app quits while the start asks: the start is refused, and nothing is taken', async () => {
    let answer: (runs: LinkedRuns[]) => void = () => undefined
    const { s } = linked(() => new Promise((done) => (answer = done)))
    const started = s.autopilot.start(PROJECT, EPIC)
    await settle()
    expect(s.autopilot.anyRunning()).toBe(true)
    await s.autopilot.stopAll()
    answer([])
    await expect(started).rejects.toThrow(QUITTING_MESSAGE)
    expect(s.orchestrator).toEqual([])
    expect(s.power).toEqual([])
    expect(s.autopilot.anyRunning()).toBe(false)
  })

  it('without the link, the state names no Machine', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    expect(s.autopilot.state(PROJECT).machine ?? null).toBeNull()
  })
})

describe('two screens stop one run at once (worfy-link ticket 15)', () => {
  it('two Stops at once during the Wave\'s turn: STOP_TEXT goes once, both answer stopping; then one run-stopped, the Orchestrator given back once', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    // The graceful Stop (worfy-week ticket 18) answers as soon as the run is stopping.
    const answers = await Promise.all([s.autopilot.stop(PROJECT), s.autopilot.stop(PROJECT)])
    for (const answer of answers) expect(answer).toMatchObject({ status: 'running', stopping: true })
    expect(s.sent).toEqual([STOP_TEXT])
    expect(s.journal.filter((line) => line.kind === 'run-stopping')).toHaveLength(1)
    // The Wave's turn ends, STOP_TEXT's turn runs and ends: the run is over.
    s.queue.shift()
    s.emit(result())
    s.emit({ type: 'prompt', text: STOP_TEXT })
    await settle()
    s.state = 'idle'
    s.emit(result())
    await settle()
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(s.journal.filter((line) => line.kind === 'run-stopped')).toHaveLength(1)
    expect(s.orchestrator).toEqual(['unattended true', 'unattended false'])
    expect(s.power).toEqual(['start', 'stop'])
    expect(s.halts).toBe(0)
    // A Stop or Force stop after the end answers the state and writes nothing.
    const lines = s.journal.length
    expect(await s.autopilot.stop(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(await s.autopilot.forceStop(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(s.journal).toHaveLength(lines)
    expect(s.orchestrator).toEqual(['unattended true', 'unattended false'])
  })

  it('two Force stops at once: one run-stopped, giveBackNow once, both answer stopped with user-force-stop', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    const answers = await Promise.all([s.autopilot.forceStop(PROJECT), s.autopilot.forceStop(PROJECT)])
    for (const answer of answers) expect(answer).toMatchObject({ status: 'stopped', reason: 'user-force-stop' })
    expect(s.journal.filter((line) => line.kind === 'run-stopped')).toHaveLength(1)
    expect(s.orchestrator.filter((call) => call === 'give-back')).toHaveLength(1)
    expect(s.halts).toBe(1)
  })

  it('Stop on one screen and Force stop on the other at once: one run-stopped, giveBackNow once, both answer the stopped run', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    const [stopped, forced] = await Promise.all([s.autopilot.stop(PROJECT), s.autopilot.forceStop(PROJECT)])
    expect(forced).toMatchObject({ status: 'stopped', reason: 'user-force-stop' })
    // The graceful Stop answers as soon as the run is stopping; the Force stop behind it ends the run.
    expect(stopped).toMatchObject({ status: 'running', stopping: true })
    expect(s.autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', reason: 'user-force-stop' })
    expect(s.journal.filter((line) => line.kind === 'run-stopped')).toHaveLength(1)
    expect(s.orchestrator.filter((call) => call === 'give-back')).toHaveLength(1)
  })
})

describe('the question about Autopilot runs over the link (worfy-link ticket 15, src/main/link/autopilot-runs.ts)', () => {
  /** A link service of one Machine over the real message registry; `send` hands each message to the peer on a later tick. */
  class FakeLink implements RunsLinkService {
    readonly registry = new MessageRegistry()
    readonly peers = new Map<string, FakeLink>()
    readonly connected = new Set<string>()
    readonly sent: { to: string; name: string; payload: unknown }[] = []
    constructor(
      readonly id: string,
      readonly name: string,
    ) {}
    registerMessage<S extends z.ZodType>(message: LinkMessage<S>, handle: MessageHandler<S>): void {
      this.registry.register(message, handle)
    }
    sendMessage<S extends z.ZodType>(machineId: string, message: LinkMessage<S>, payload: z.input<S>): void {
      if (!this.connected.has(machineId)) throw new Error(`Machine ${machineId} is not connected`)
      const parsed = this.registry.outgoing(message, payload)
      this.sent.push({ to: machineId, name: message.name, payload: parsed })
      const peer = this.peers.get(machineId)!
      setTimeout(() => void peer.deliver(message.name, parsed, this.id), 0)
    }
    deliver(name: string, payload: unknown, from: string): Promise<void> {
      return this.registry.dispatch(name, payload, { machineId: from }, () => undefined)
    }
    linkedMachines() {
      return [...this.peers.values()].map((peer) => ({ id: peer.id, name: peer.name, connected: this.connected.has(peer.id) }))
    }
  }
  const link = (a: FakeLink, b: FakeLink, connected = true) => {
    a.peers.set(b.id, b)
    b.peers.set(a.id, a)
    if (connected) {
      a.connected.add(b.id)
      b.connected.add(a.id)
    }
  }
  const KEY = 'github.com/idsad-xl/worfy'

  it('asks every connected Linked machine; each answers the Epic and origin key of its runs, nothing more', async () => {
    const [a, b, c] = [new FakeLink('a', 'Laptop'), new FakeLink('b', 'Studio'), new FakeLink('c', 'Desk')]
    link(a, b)
    link(a, c)
    const asking = new AutopilotRunsLink(a, () => [])
    new AutopilotRunsLink(b, () => [{ epic: EPIC, origin: KEY, project: 'secret' } as RunKey])
    new AutopilotRunsLink(c, () => [])
    expect(await asking.ask()).toEqual([
      { machine: 'Studio', runs: [{ epic: EPIC, origin: KEY }] },
      { machine: 'Desk', runs: [] },
    ])
    expect(b.sent).toEqual([{ to: 'a', name: 'autopilot-runs', payload: { id: expect.any(String) as unknown, runs: [{ epic: EPIC, origin: KEY }] } }])
  })

  it('a Linked machine that is not connected is not asked, and counts as unasked at once', async () => {
    const [a, b] = [new FakeLink('a', 'Laptop'), new FakeLink('b', 'Studio')]
    link(a, b, false)
    const asking = new AutopilotRunsLink(a, () => [], { timeoutMs: 60_000 })
    expect(await asking.ask()).toEqual([{ machine: 'Studio', runs: null }])
    expect(a.sent).toEqual([])
  })

  it('no answer within the limit counts as unasked; a late answer changes nothing', async () => {
    const [a, b] = [new FakeLink('a', 'Laptop'), new FakeLink('b', 'Studio')]
    link(a, b)
    // B is an older build: it knows no such message and drops it.
    const asking = new AutopilotRunsLink(a, () => [], { timeoutMs: 20 })
    expect(await asking.ask()).toEqual([{ machine: 'Studio', runs: null }])
    const question = (a.sent[0]!.payload as { id: string }).id
    await expect(a.deliver('autopilot-runs', { id: question, runs: [{ epic: EPIC, origin: KEY }] }, 'b')).resolves.toBeUndefined()
    expect(ASK_RUNS_TIMEOUT_MS).toBe(3000)
  })

  it('only the Machine asked answers its question', async () => {
    const [a, b, c] = [new FakeLink('a', 'Laptop'), new FakeLink('b', 'Studio'), new FakeLink('c', 'Desk')]
    link(a, b)
    link(a, c, false)
    const asking = new AutopilotRunsLink(a, () => [], { timeoutMs: 60_000 })
    // B answers late, by hand; C, linked but not asked, answers B's question first.
    const answers = asking.ask()
    await new Promise((done) => setTimeout(done, 0))
    const question = (a.sent[0]!.payload as { id: string }).id
    await a.deliver('autopilot-runs', { id: question, runs: [{ epic: EPIC, origin: KEY }] }, 'c')
    await a.deliver('autopilot-runs', { id: question, runs: [] }, 'b')
    expect(await answers).toEqual([
      { machine: 'Studio', runs: [] },
      { machine: 'Desk', runs: null },
    ])
  })

  it('a send that fails (the connection went between the list and the send) counts as unasked', async () => {
    const [a, b] = [new FakeLink('a', 'Laptop'), new FakeLink('b', 'Studio')]
    link(a, b)
    a.sendMessage = () => {
      throw new Error('gone')
    }
    const asking = new AutopilotRunsLink(a, () => [], { timeoutMs: 60_000 })
    expect(await asking.ask()).toEqual([{ machine: 'Studio', runs: null }])
  })

  it('end to end with Autopilot: B is refused while A runs the Epic; A answers through runKeys', async () => {
    const [a, b] = [new FakeLink('a', 'Studio'), new FakeLink('b', 'Laptop')]
    link(a, b)
    const sa = standIn({ origin: () => Promise.resolve(KEY) })
    const sb = standIn({ origin: () => Promise.resolve(KEY) })
    const linkA = new AutopilotRunsLink(a, () => sa.autopilot.runKeys())
    const linkB = new AutopilotRunsLink(b, () => sb.autopilot.runKeys())
    sa.deps.linkedRuns = () => linkA.ask()
    sb.deps.linkedRuns = () => linkB.ask()
    await sa.autopilot.start(PROJECT, EPIC)
    await expect(sb.autopilot.start(PROJECT, EPIC)).rejects.toThrow(runningElsewhere(EPIC, 'Studio'))
    await expect(sb.autopilot.start(PROJECT, EPIC, { override: true })).resolves.toMatchObject({ status: 'running' })
  })
})
