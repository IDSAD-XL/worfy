// The Autopilot run over a scripted Orchestrator Session (worfy-daily ticket 04): which `result`
// ends a Wave when "Run wave" waits in the Session's queue behind a person's message, what happens
// to such a Wave when the run stops, and a Session that fails while the run opens its workflow
// watch. The Session, the waves and the workflow are stand-ins, so every event comes in the order
// the test gives it.
import { afterEach, describe, expect, it } from 'vitest'
import type { AutopilotWaveResult } from '../../src/main/actions/launch'
import { Autopilot, type AutopilotDeps, type RunSession } from '../../src/main/autopilot/run'
import type { BackgroundTask } from '../../src/shared/agent/background-tasks'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../src/shared/agent/events'
import type { JournalEventFields } from '../../src/shared/autopilot/journal'
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
  }
  const model = (): WorkflowModel => ({ root: '/repo', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: out.tickets.map((each) => ({ ...each })), error: null, branchErrors: [] }) as unknown as WorkflowModel
  let sent = 0
  const deps: AutopilotDeps = {
    projectRoot: () => '/repo',
    selfRefusal: () => Promise.resolve(null),
    workflow: () => Promise.resolve(model()),
    watchWorkflow: () => Promise.resolve(() => undefined),
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
    s.deps.waves.autopilotWave = (projectId, epic) => {
      s.emit(result())
      return wave2(projectId, epic)
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

  it('Stop takes the Wave out of the queue it still waits in; a person\'s own queued message stays', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    done(s, 1, 2)
    s.deliveries.push('queued')
    s.emit(result())
    s.emit({ type: 'prompt', text: 'how is it going?' })
    await settle()
    s.queue.push({ id: 'person', text: 'and then this' })
    await s.autopilot.stop(PROJECT)
    expect(s.queue).toEqual([{ id: 'person', text: 'and then this' }])
    expect(s.removed).toEqual(['queued-2'])
  })

  it('Stop leaves the queue alone when the Wave\'s turn has started', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.queue.push({ id: 'person', text: '/epic-wave 1 2' })
    await s.autopilot.stop(PROJECT)
    expect(s.removed).toEqual([])
    expect(s.queue).toHaveLength(1)
  })
})

describe('Stop interrupts the Orchestrator and its background tasks (worfy-week ticket 17)', () => {
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
    const stopped = await s.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop', resumable: [1, 2] })
    expect(s.halts).toBe(1)
    expect(s.orchestrator).toEqual(['unattended true', 'give-back'])
    // Nothing lingers: keep-awake is released, and the app's quit has nothing to wait for.
    expect(s.power).toEqual(['start', 'stop'])
    expect(s.autopilot.anyRunning()).toBe(false)
    expect(fromStop(s)).toEqual([
      { kind: 'run-stopped', reason: 'user-stop', tasks: ['task-1'], tickets: ['01', '02'] },
      { kind: 'tasks-killed', reason: 'user-stop', tasks: ['task-1'] },
      { kind: 'orchestrator-returned' },
    ])
  })

  it('during the Wave\'s turn, before any task: the same, without tasks-killed', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    const stopped = await s.autopilot.stop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-stop' })
    expect(s.halts).toBe(1)
    expect(s.orchestrator).toEqual(['unattended true', 'give-back'])
    expect(s.power).toEqual(['start', 'stop'])
    expect(s.autopilot.anyRunning()).toBe(false)
    expect(fromStop(s)).toEqual([{ kind: 'run-stopped', reason: 'user-stop', tickets: ['01', '02'] }, { kind: 'orchestrator-returned' }])
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
    await s.autopilot.stop(PROJECT)
    expect(fromStop(s)).toEqual([
      { kind: 'run-stopped', reason: 'user-stop', tickets: ['01', '02'] },
      { kind: 'tasks-killed', reason: 'user-stop', tasks: ['task-1'] },
      { kind: 'orchestrator-returned' },
    ])
  })

  it('a second Stop while the first one waits for the turn halts nothing more; both answer the stopped run', async () => {
    const s = standIn()
    await s.autopilot.start(PROJECT, EPIC)
    await settle()
    s.state = 'busy'
    let endTurn: () => void = () => undefined
    s.onHalt = () => new Promise((done) => (endTurn = done))
    const first = s.autopilot.stop(PROJECT)
    await settle()
    expect(s.halts).toBe(1)
    // The run still ends: it is running until its Orchestrator is back.
    expect(s.autopilot.running(PROJECT)).toBe(true)
    const second = s.autopilot.stop(PROJECT)
    // The interrupted turn's result and its tasks' events come in meanwhile: no Wave is judged, nothing is sent.
    s.emit(result(true))
    s.emit({ type: 'background_tasks', tasks: [] })
    s.emit({ type: 'state', state: 'idle', error: null })
    await settle()
    expect(s.orchestrator).toEqual(['unattended true'])
    endTurn()
    const answers = await Promise.all([first, second])
    for (const answer of answers) expect(answer).toMatchObject({ status: 'stopped', reason: 'user-stop' })
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
    await s.autopilot.stop(PROJECT)
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
    await s.autopilot.stop(PROJECT)
    // Another Epic: its run does not take this Epic's Tickets.
    s.tickets = [...s.tickets, { ...s.tickets[0]!, epic: 'other', num: 9 }]
    await s.autopilot.start(PROJECT, 'other').catch(() => undefined)
    await settle()
    expect(s.resumes.at(-1)).toEqual([])
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
