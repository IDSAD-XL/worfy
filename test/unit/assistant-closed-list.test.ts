// The closed list of actions of the Assistant (worfy-assistant ticket 08; spec, implementation decisions, the closed list of
// actions; test decisions, seam A). In: the events of the Sessions, a clock that is not the machine's, the duties' modes
// and the Limits. Out: the actions of the closed list — the exact text each Session gets, the waits for the Limits that
// are seen, the lines of the Assistant's journal and the escalation to the model.
//
// Nothing here runs a real Session or a model: the Sessions are fakes that record what they get, the registry is a hub
// the test emits events into, and the attention core, the duties and the journal are the real ones over a temporary
// data folder. The night of 2026-11-13 is the first scenario: a 5-hour refusal at 00:29Z, reset at 04:00Z.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LimitsState } from '../../src/shared/agent/limits'
import { CLOSED_ACTIONS, CONTINUE_SESSION_TEXT, continueSessionText, WAKE_ORCHESTRATOR_TEXT, type ActionRequest } from '../../src/shared/assistant/actions'
import type { DutyActionMode, ShownItem } from '../../src/shared/assistant/duties'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { AUTO_LOOK_MS, runClosedListAuto, type ClosedListAuto } from '../../src/main/assistant/actions/auto'
import { ClosedList, WAKES_PER_DAY, type ActionTarget } from '../../src/main/assistant/actions/closed-list'
import { actionJournalFile, actionJournalPath, type ActionJournal } from '../../src/main/assistant/actions/journal'
import { LimitsWaits } from '../../src/main/assistant/actions/limits-waits'
import { AttentionCore } from '../../src/main/assistant/core/attention-core'
import { sessionAttention } from '../../src/main/assistant/core/sources'
import { attentionFileStore, attentionPaths } from '../../src/main/assistant/core/store'
import { Duties } from '../../src/main/assistant/duties/duties'
import { assistantMemoryPath, memoryFileStore } from '../../src/main/assistant/duties/memory'
import type { EventSink } from '../../src/main/agent/session/types'
import { removeTree } from '../../src/main/storage/remove'

const temp = mkdtempSync(join(tmpdir(), 'worfy-closed-list-'))
afterAll(() => removeTree(temp))

const PROJECT = 'p-alpha'
const PROJECT_PATH = join(temp, 'work', 'alpha')
const ORCH = 'orch-1'
const CANVAS = 'canvas-1'
const MIN = 60_000
/** 2026-11-13T00:29:29Z: the refusal of the Orchestrator's turn that night. */
const REFUSED_AT = Date.parse('2026-11-13T00:29:29Z')
/** 04:00Z, 06:00 in Kyiv: the reset of the 5-hour window it reported (resetsAt 1794542400). */
const RESET_S = 1794542400
const RESET_MS = RESET_S * 1000
const LIMIT_TEXT = "You've hit your 5-hour limit · resets 6am (Europe/Kiev)"

interface FakeSession extends ActionTarget {
  state: ActionTarget['state']
  unattended: boolean
  tasks: string[]
  sent: string[]
  notices: string[]
  /** Set: the Session queues what it gets, as Session.send does while worfy quits or holds it back. */
  queueing: boolean
  queue: { id: string; text: string }[]
  notice(text: string): void
}

const fakeSession = (): FakeSession => {
  const session: FakeSession = {
    state: 'idle',
    unattended: false,
    tasks: [],
    sent: [],
    notices: [],
    queueing: false,
    queue: [],
    backgroundTasks: () => session.tasks,
    send: (text: string) => {
      if (session.queueing) {
        session.queue.push({ id: `q${session.queue.length}`, text })
        return 'queued'
      }
      // A Session takes a message into a turn at once (Session.send → deliver).
      session.sent.push(text)
      session.state = 'busy'
      return 'sent'
    },
    queued: () => ({ items: session.queue.map((each) => ({ ...each })), paused: false }),
    removeQueued: (id: string) => {
      const before = session.queue.length
      session.queue = session.queue.filter((each) => each.id !== id)
      return session.queue.length < before
    },
    notice: (text: string) => void session.notices.push(text),
  }
  return session
}

let roots = 0
/** One Machine: the attention core and the duties over a data root of their own, the fake Sessions, the closed list over them. */
function world(start = REFUSED_AT - 30 * MIN, options: { journal?: ActionJournal } = {}) {
  let at = start
  const now = (): number => at
  const root = join(temp, `root-${roots++}`)
  const projectDir = (id: string): string => join(root, 'projects', id)
  const duties = new Duties({ now, store: memoryFileStore(assistantMemoryPath(root)), projects: () => [PROJECT] })
  const core = new AttentionCore({ now, store: attentionFileStore(attentionPaths(projectDir, root)), settings: () => ({ timeZone: 'Europe/Kyiv' }), projects: () => [PROJECT], dutyOf: (event) => duties.dutyOf(event) })
  const sinks = new Set<EventSink>()
  const observe = (sink: EventSink): (() => void) => {
    sinks.add(sink)
    return () => void sinks.delete(sink)
  }
  observe(sessionAttention(core, (cwd) => (cwd.startsWith(PROJECT_PATH) ? PROJECT : null), now, () => false, () => duties.thresholdMs('work-stalled')))
  const sessions = new Map<string, FakeSession>([
    [ORCH, fakeSession()],
    [CANVAS, fakeSession()],
  ])
  let limits: LimitsState = { windows: {} }
  /** Auto-continue of the Orchestrator waits to continue it (OrchestratorContinue.wait). */
  let continuing = false
  const timers: { at: number; fire: () => void; cancelled: boolean }[] = []
  const schedule = (when: number, fire: () => void): (() => void) => {
    const timer = { at: when, fire, cancelled: false }
    timers.push(timer)
    return () => void (timer.cancelled = true)
  }
  const waits = new LimitsWaits({ observe, isOrchestrator: (id) => id === ORCH, session: (id) => sessions.get(id) ?? null, limits: () => limits, now, schedule })
  const escalated: string[] = []
  const journal = options.journal ?? actionJournalFile(actionJournalPath(root), now)
  const shown = (): readonly ShownItem[] => duties.look([...core.items(null), ...core.items(PROJECT)]).shown
  /** A closed list over this Machine, as after a restart of worfy: the same journal, nothing in memory. */
  const makeList = (): ClosedList =>
    new ClosedList({
      now,
      shown,
      orchestratorOf: (projectId) => (projectId === PROJECT ? ORCH : null),
      session: (id) => sessions.get(id) ?? null,
      limits: () => limits,
      continuing: () => continuing,
      waits,
      journal,
      escalate: (id) => void escalated.push(id),
    })
  const list = new ClosedList({
    now,
    shown,
    orchestratorOf: (projectId) => (projectId === PROJECT ? ORCH : null),
    session: (id) => sessions.get(id) ?? null,
    limits: () => limits,
    continuing: () => continuing,
    waits,
    journal,
    escalate: (id) => void escalated.push(id),
  })
  const emit = (sessionId: string, event: Record<string, unknown>): void => {
    // The fake Session's state follows its events, as a live one's does.
    const session = sessions.get(sessionId)
    if (session !== undefined && event.type === 'state') session.state = event.state as FakeSession['state']
    for (const sink of [...sinks]) sink(sessionId, { at: now(), ...event } as AgentEvent)
  }
  const result = (sessionId: string, error: string | null): void =>
    emit(sessionId, {
      type: 'result',
      subtype: error === null ? 'success' : 'error_during_execution',
      isError: error !== null,
      error,
      text: error,
      costUsd: 0,
      durationMs: 1,
      numTurns: 1,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      terminalReason: null,
      interrupted: false,
    })
  return {
    now,
    set: (time: number) => (at = time),
    add: (ms: number) => (at += ms),
    root,
    duties,
    core,
    sessions,
    session: (id: string) => sessions.get(id)!,
    waits,
    list,
    makeList,
    journal,
    escalated,
    shown,
    observe,
    emit,
    setLimits: (next: LimitsState) => (limits = next),
    setContinuing: (value: boolean) => (continuing = value),
    /** Fires the timers that are due by the clock, as the wall-clock timer does after a sleep of the Mac too. */
    runTimers: () => {
      for (const timer of timers.filter((each) => !each.cancelled && each.at <= at)) {
        timer.cancelled = true
        timer.fire()
      }
    },
    mode: (action: 'wake-orchestrator' | 'continue-session', mode: DutyActionMode) => duties.configure('work-stalled', { modes: { [action]: mode } }),
    /** A Session starts in the Project's folder: its first turn opens. */
    open: (sessionId: string) => {
      emit(sessionId, { type: 'init', sdkSessionId: sessionId, model: 'claude-opus-5-5', permissionMode: 'default', apiKeySource: 'none', cwd: PROJECT_PATH, claudeCodeVersion: null, slashCommands: [] })
      emit(sessionId, { type: 'state', state: 'busy', error: null })
    },
    /** The turn of `sessionId` is refused by the 5-hour window, as Claude Code tells it: the status, then the result. */
    refuse: (sessionId: string, resetS = RESET_S) => {
      emit(sessionId, { type: 'limits', vendor: 'claude', windows: [], status: { text: 'rejected', state: null, windowId: 'five_hour', resetsAt: resetS } })
      limits = { windows: { five_hour: { utilization: 1, resetsAt: resetS, status: 'rejected', receivedAt: at, source: 'sdk' } } }
      result(sessionId, LIMIT_TEXT)
      emit(sessionId, { type: 'state', state: 'idle', error: null })
    },
    endTurn: (sessionId: string) => {
      result(sessionId, null)
      emit(sessionId, { type: 'state', state: 'idle', error: null })
    },
    /** The message main sent reaches the Session: its turn starts, as the registry tells it. */
    took: (sessionId: string, text: string) => {
      emit(sessionId, { type: 'prompt', text })
      emit(sessionId, { type: 'state', state: 'busy', error: null })
    },
    itemOf: (sessionId: string) => shown().find((each) => each.item.subject.id === sessionId)?.item,
  }
}

type World = ReturnType<typeof world>

const loops: ClosedListAuto[] = []
afterAll(() => {
  for (const loop of loops) loop.stop()
})

/** The automatic pass of main over a world; its timer is the test's own: it runs only when the test calls look(). */
function auto(w: World): ClosedListAuto {
  const loop = runClosedListAuto({ list: w.list, shown: w.shown, observe: w.observe, changes: [], now: w.now, setTimer: () => 0, clearTimer: () => undefined })
  loops.push(loop)
  return loop
}

describe('the closed list', () => {
  it('has two actions, and an action outside it is refused and written to the journal', () => {
    expect([...CLOSED_ACTIONS]).toEqual(['wake-orchestrator', 'continue-session'])
    const w = world()
    w.open(ORCH)
    w.endTurn(ORCH)
    const result = w.list.act({ action: 'delete-branch', itemId: 'anything', by: 'assistant' })
    expect(result).toMatchObject({ ok: false, reason: 'not-in-list' })
    expect(w.journal.lines()).toEqual([expect.objectContaining({ action: 'delete-branch', by: 'assistant', item: 'anything', outcome: 'refused', reason: 'not-in-list' })])
    expect(w.session(ORCH).sent).toEqual([])
  })

  it("each action's text is main's: the duties propose it as it will go, and a text in the request is not taken", () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    w.open(ORCH)
    w.endTurn(ORCH)
    w.add(16 * MIN)
    w.core.tick()
    const shown = w.shown().find((each) => each.item.subject.id === ORCH)!
    expect(shown.proposals.find((each) => each.action === 'wake-orchestrator')?.text).toBe(WAKE_ORCHESTRATOR_TEXT)
    expect(shown.proposals.find((each) => each.action === 'continue-session')?.text).toBe(CONTINUE_SESSION_TEXT)
    const result = w.list.act({ action: 'wake-orchestrator', itemId: shown.item.id, by: 'assistant', text: 'git push --force' } as ActionRequest)
    expect(result.ok).toBe(true)
    expect(w.session(ORCH).sent).toEqual([WAKE_ORCHESTRATOR_TEXT])
  })

  it('the mode decides who may act: hand-over — no one; ask — the user only; self — the Assistant too', () => {
    const w = world()
    w.open(ORCH)
    w.endTurn(ORCH)
    w.add(16 * MIN)
    w.core.tick()
    const itemId = w.itemOf(ORCH)!.id
    const request = (by: ActionRequest['by']): ActionRequest => ({ action: 'wake-orchestrator', itemId, by })
    w.mode('wake-orchestrator', 'hand-over')
    expect(w.list.check(request('user'))).toBe('mode')
    w.mode('wake-orchestrator', 'ask')
    expect(w.list.check(request('assistant'))).toBe('mode')
    expect(w.list.check(request('main'))).toBe('mode')
    expect(w.list.check(request('user'))).toBeNull()
    w.mode('wake-orchestrator', 'self')
    expect(w.list.check(request('assistant'))).toBeNull()
    expect(w.session(ORCH).sent).toEqual([])
    expect(w.journal.lines()).toEqual([])
  })
})

describe('wake an idle Orchestrator (the night of 2026-11-13)', () => {
  it('with the mode that allows it: the fixed message of main asks it to check and continue the stopped Subagents, once the Limits allow; a journal line names the item', () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    const loop = auto(w)
    w.open(ORCH)
    w.set(REFUSED_AT)
    w.refuse(ORCH)
    loop.look()
    // The Limits still refuse: a wake now would be refused too, and the model would read an old reset as a new one.
    expect(w.session(ORCH).sent).toEqual([])
    w.set(RESET_MS + 1)
    loop.look()
    expect(w.session(ORCH).sent).toEqual([WAKE_ORCHESTRATOR_TEXT])
    expect(WAKE_ORCHESTRATOR_TEXT).toMatch(/Subagents/)
    expect(WAKE_ORCHESTRATOR_TEXT).toMatch(/continue each from where it stopped/)
    const item = w.core.items(PROJECT).find((each) => each.subject.id === ORCH)!
    expect(w.journal.lines()).toEqual([
      expect.objectContaining({ action: 'wake-orchestrator', by: 'main', item: item.id, duty: 'work-stalled', projectId: PROJECT, mode: 'self', sessionId: ORCH, outcome: 'done', text: WAKE_ORCHESTRATOR_TEXT }),
    ])
  })

  it('with the mode that does not allow it (ask, the default): no message, also hours after the reset; the user may still click', () => {
    const w = world()
    const loop = auto(w)
    w.open(ORCH)
    w.set(REFUSED_AT)
    w.refuse(ORCH)
    w.set(RESET_MS + 6 * 60 * MIN)
    w.core.tick()
    loop.look()
    expect(w.session(ORCH).sent).toEqual([])
    expect(w.journal.lines()).toEqual([])
    const itemId = w.itemOf(ORCH)!.id
    expect(w.list.act({ action: 'wake-orchestrator', itemId, by: 'user' }).ok).toBe(true)
    expect(w.session(ORCH).sent).toEqual([WAKE_ORCHESTRATOR_TEXT])
  })

  it('not while a background task of it is alive, a turn goes on, an Autopilot run owns it or Auto-continue waits to continue it', () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    const loop = auto(w)
    w.open(ORCH)
    w.endTurn(ORCH)
    w.add(16 * MIN)
    w.core.tick()
    const orch = w.session(ORCH)
    orch.tasks = ['a8645efde45bd0de3']
    loop.look()
    orch.tasks = []
    orch.state = 'busy'
    loop.look()
    orch.state = 'idle'
    orch.unattended = true
    loop.look()
    orch.unattended = false
    // Auto-continue waits to send its own continuation: the wake would be a second message.
    w.setContinuing(true)
    loop.look()
    expect(orch.sent).toEqual([])
    w.setContinuing(false)
    loop.look()
    expect(orch.sent).toEqual([WAKE_ORCHESTRATOR_TEXT])
  })

  it('a Session that is not the Orchestrator is never woken', () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    const loop = auto(w)
    w.open(CANVAS)
    w.endTurn(CANVAS)
    w.add(16 * MIN)
    w.core.tick()
    loop.look()
    expect(w.session(CANVAS).sent).toEqual([])
    expect(w.list.check({ action: 'wake-orchestrator', itemId: w.itemOf(CANVAS)!.id, by: 'user' })).toBe('no-target')
  })

  it('the closed list did not help: woken, it stands again with nothing started, and the model of the Assistant is woken for it, once', () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    const loop = auto(w)
    w.open(ORCH)
    w.endTurn(ORCH)
    w.add(16 * MIN)
    w.core.tick()
    loop.look()
    expect(w.session(ORCH).sent).toHaveLength(1)
    w.took(ORCH, WAKE_ORCHESTRATOR_TEXT)
    w.endTurn(ORCH)
    w.add(16 * MIN)
    w.core.tick()
    loop.look()
    loop.look()
    expect(w.session(ORCH).sent).toHaveLength(1)
    const again = w.itemOf(ORCH)!
    expect(w.escalated).toEqual([again.id])
    expect(w.journal.lines().map((line) => [line.action, line.outcome, line.item])).toEqual([
      ['wake-orchestrator', 'done', expect.any(String)],
      ['wake-orchestrator', 'escalated', again.id],
    ])
  })

  it('a wake that helped — the Orchestrator started a Subagent — leaves the next stop to a new wake, up to WAKES_PER_DAY a day', () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    const loop = auto(w)
    w.open(ORCH)
    for (let round = 0; round < WAKES_PER_DAY + 1; round += 1) {
      w.endTurn(ORCH)
      w.add(16 * MIN)
      w.core.tick()
      loop.look()
      w.took(ORCH, WAKE_ORCHESTRATOR_TEXT)
      w.emit(ORCH, { type: 'subagent', phase: 'started', taskId: `t${round}`, toolUseId: null, description: 'implementer', subagentType: null, status: null })
    }
    expect(w.session(ORCH).sent).toHaveLength(WAKES_PER_DAY)
    expect(w.escalated).toHaveLength(1)
  })
})

describe("main's automatic pass", () => {
  it('looks after a change it follows and by its own timer, and writes nothing while no action is due', () => {
    const w = world()
    w.mode('continue-session', 'self')
    const timers: { run: () => void; ms: number }[] = []
    const listeners: (() => void)[] = []
    const loop = runClosedListAuto({
      list: w.list,
      shown: w.shown,
      observe: w.observe,
      changes: [(listener) => w.waits.observeWaits(listener), (listener) => (listeners.push(listener), () => undefined)],
      now: w.now,
      setTimer: (run, ms) => timers.push({ run, ms }),
      clearTimer: () => undefined,
    })
    loops.push(loop)
    expect(timers.map((timer) => timer.ms)).toEqual([AUTO_LOOK_MS])
    w.open(CANVAS)
    w.set(REFUSED_AT)
    w.refuse(CANVAS)
    // The wait began: a look soon, which finds nothing due.
    const soon = timers.find((timer) => timer.ms === 0)!
    soon.run()
    expect(w.session(CANVAS).sent).toEqual([])
    expect(w.journal.lines()).toEqual([])
    // The reset passes while the Mac sleeps: the wait's timer makes it due, and the next look continues the Session.
    w.set(RESET_MS + RESUME_MARGIN_MS + 30 * MIN)
    w.runTimers()
    timers.filter((timer) => timer.ms === 0).at(-1)!.run()
    expect(w.session(CANVAS).sent).toHaveLength(1)
  })
})

describe('continue a Session on the Canvas after the reset of the Limits', () => {
  it('while it waits, the wait is seen — in its chat and through the closed list; at the reset, at night, main continues it by the mode of the duty', () => {
    const w = world()
    w.mode('continue-session', 'self')
    const loop = auto(w)
    w.open(CANVAS)
    w.set(REFUSED_AT)
    w.refuse(CANVAS)
    const wait = w.waits.wait(CANVAS)
    expect(wait).toEqual({ sessionId: CANVAS, window: 'five_hour', since: REFUSED_AT, until: RESET_MS + RESUME_MARGIN_MS })
    expect(w.waits.waits()).toEqual([wait])
    return Promise.resolve().then(() => {
      expect(w.session(CANVAS).notices).toEqual([expect.stringMatching(/^worfy: waiting for the Limits, they reset at \d\d:\d\d$/u)])
      loop.look()
      expect(w.session(CANVAS).sent).toEqual([])
      // 04:02Z is 06:02 in Kyiv: outside the work hours, the Mac asleep until 07:30 local.
      w.set(Date.parse('2026-11-13T05:30:00Z'))
      w.runTimers()
      loop.look()
      expect(w.session(CANVAS).sent).toEqual([continueSessionText(REFUSED_AT, w.now())])
      expect(w.waits.wait(CANVAS)).toBeNull()
      const item = w.core.items(PROJECT).find((each) => each.subject.id === CANVAS)!
      expect(w.journal.lines()).toEqual([expect.objectContaining({ action: 'continue-session', by: 'main', item: item.id, duty: 'work-stalled', mode: 'self', sessionId: CANVAS, outcome: 'done' })])
    })
  })

  it('with the mode ask: the wait is seen, nothing goes at the reset; the user continues it from the item', () => {
    const w = world()
    const loop = auto(w)
    w.open(CANVAS)
    w.set(REFUSED_AT)
    w.refuse(CANVAS)
    const itemId = w.itemOf(CANVAS)!.id
    expect(w.list.check({ action: 'continue-session', itemId, by: 'user' })).toBe('limits')
    w.set(RESET_MS + RESUME_MARGIN_MS)
    w.runTimers()
    loop.look()
    expect(w.session(CANVAS).sent).toEqual([])
    expect(w.waits.wait(CANVAS)).not.toBeNull()
    expect(w.list.act({ action: 'continue-session', itemId, by: 'user' }).ok).toBe(true)
    expect(w.session(CANVAS).sent).toEqual([continueSessionText(REFUSED_AT, w.now())])
  })

  it('a message of the person during the wait ends it; nothing goes at the reset', () => {
    const w = world()
    w.mode('continue-session', 'self')
    const loop = auto(w)
    w.open(CANVAS)
    w.set(REFUSED_AT)
    w.refuse(CANVAS)
    w.took(CANVAS, 'never mind, I will do it myself')
    w.endTurn(CANVAS)
    w.set(RESET_MS + RESUME_MARGIN_MS)
    w.runTimers()
    loop.look()
    expect(w.waits.wait(CANVAS)).toBeNull()
    expect(w.session(CANVAS).sent).toEqual([])
  })

  it('the Orchestrator and a Session a run owns do not wait here: Auto-continue and the run answer them', () => {
    const w = world()
    w.open(ORCH)
    w.set(REFUSED_AT)
    w.refuse(ORCH)
    expect(w.waits.wait(ORCH)).toBeNull()
    w.session(CANVAS).unattended = true
    w.open(CANVAS)
    w.refuse(CANVAS)
    expect(w.waits.wait(CANVAS)).toBeNull()
  })
})

describe('the door holds its own limits (review round 1)', () => {
  /** One stop of the Orchestrator: its turn ended, and it stays silent past the threshold of «work stands». */
  const stall = (w: World): string => {
    w.endTurn(ORCH)
    w.add(16 * MIN)
    w.core.tick()
    return w.itemOf(ORCH)!.id
  }

  it("the Assistant's wakes count with main's: past WAKES_PER_DAY in 24 hours act() refuses it (cap) and says so in the journal; the user's click still goes", () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    w.open(ORCH)
    for (let round = 0; round < WAKES_PER_DAY; round += 1) {
      expect(w.list.act({ action: 'wake-orchestrator', itemId: stall(w), by: round % 2 === 0 ? 'assistant' : 'main' }).ok).toBe(true)
      w.took(ORCH, WAKE_ORCHESTRATOR_TEXT)
    }
    const itemId = stall(w)
    expect(w.list.act({ action: 'wake-orchestrator', itemId, by: 'assistant' })).toMatchObject({ ok: false, reason: 'cap' })
    expect(w.list.check({ action: 'wake-orchestrator', itemId, by: 'main' })).toBe('cap')
    expect(w.journal.lines().at(-1)).toMatchObject({ action: 'wake-orchestrator', by: 'assistant', outcome: 'refused', reason: 'cap' })
    expect(w.session(ORCH).sent).toHaveLength(WAKES_PER_DAY)
    expect(w.list.act({ action: 'wake-orchestrator', itemId, by: 'user' }).ok).toBe(true)
    // Read back from the journal after a restart: the cap still holds; 24 hours after the first wake it lets one go again.
    w.took(ORCH, WAKE_ORCHESTRATOR_TEXT)
    const again = stall(w)
    const restarted = w.makeList()
    expect(restarted.check({ action: 'wake-orchestrator', itemId: again, by: 'assistant' })).toBe('cap')
    w.add(24 * 60 * MIN)
    expect(restarted.check({ action: 'wake-orchestrator', itemId: again, by: 'assistant' })).toBeNull()
  })

  it("the user's wakes are not counted: two clicks before main's six leave main all six, in memory and read back after a restart", () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    w.open(ORCH)
    const wake = (by: 'user' | 'main'): void => {
      expect(w.list.act({ action: 'wake-orchestrator', itemId: stall(w), by }).ok).toBe(true)
      w.took(ORCH, WAKE_ORCHESTRATOR_TEXT)
    }
    wake('user')
    wake('user')
    for (let round = 0; round < WAKES_PER_DAY - 1; round += 1) wake('main')
    // A restart reads the journal back: two user wakes and five of main's leave main one more.
    const restarted = w.makeList()
    const itemId = stall(w)
    expect(restarted.check({ action: 'wake-orchestrator', itemId, by: 'main' })).toBeNull()
    expect(w.list.check({ action: 'wake-orchestrator', itemId, by: 'main' })).toBeNull()
    expect(w.list.act({ action: 'wake-orchestrator', itemId, by: 'main' }).ok).toBe(true)
    w.took(ORCH, WAKE_ORCHESTRATOR_TEXT)
    expect(w.list.check({ action: 'wake-orchestrator', itemId: stall(w), by: 'main' })).toBe('cap')
  })

  it('a journal that cannot be written: the cap and «escalate once» still hold, counted in memory', () => {
    const broken: ActionJournal = {
      append: () => {
        throw new Error('EACCES')
      },
      lines: () => [],
    }
    const w = world(REFUSED_AT - 30 * MIN, { journal: broken })
    w.mode('wake-orchestrator', 'self')
    const loop = auto(w)
    w.open(ORCH)
    for (let round = 0; round < WAKES_PER_DAY + 1; round += 1) {
      stall(w)
      loop.look()
      loop.look()
      w.took(ORCH, WAKE_ORCHESTRATOR_TEXT)
      w.emit(ORCH, { type: 'subagent', phase: 'started', taskId: `t${round}`, toolUseId: null, description: 'implementer', subagentType: null, status: null })
    }
    expect(w.session(ORCH).sent).toHaveLength(WAKES_PER_DAY)
    expect(w.escalated).toHaveLength(1)
    stall(w)
    loop.look()
    loop.look()
    expect(w.escalated).toHaveLength(2)
    expect(new Set(w.escalated).size).toBe(2)
  })

  it('a Session that queues the message (worfy quits, or holds it back) is not acted on: the message is taken back, the line says busy, the wait stays', () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    w.mode('continue-session', 'self')
    w.open(ORCH)
    const itemId = stall(w)
    w.session(ORCH).queueing = true
    expect(w.list.act({ action: 'wake-orchestrator', itemId, by: 'main' })).toMatchObject({ ok: false, reason: 'busy' })
    expect(w.session(ORCH).queue).toEqual([])
    expect(w.journal.lines().at(-1)).toMatchObject({ action: 'wake-orchestrator', outcome: 'refused', reason: 'busy' })
    w.open(CANVAS)
    w.set(REFUSED_AT)
    w.refuse(CANVAS)
    w.set(RESET_MS + RESUME_MARGIN_MS)
    w.runTimers()
    w.session(CANVAS).queueing = true
    const canvasItem = w.itemOf(CANVAS)!.id
    expect(w.list.act({ action: 'continue-session', itemId: canvasItem, by: 'main' })).toMatchObject({ ok: false, reason: 'busy' })
    expect(w.session(CANVAS).queue).toEqual([])
    expect(w.waits.wait(CANVAS)).not.toBeNull()
  })
})

describe("the Assistant's journal", () => {
  it("is worfy's own file under the data root, a line per action with the item that caused it", () => {
    const w = world()
    w.mode('wake-orchestrator', 'self')
    w.open(ORCH)
    w.endTurn(ORCH)
    w.add(16 * MIN)
    w.core.tick()
    const itemId = w.itemOf(ORCH)!.id
    w.list.act({ action: 'wake-orchestrator', itemId, by: 'assistant' })
    w.list.act({ action: 'continue-session', itemId, by: 'assistant' })
    const file = actionJournalPath(w.root)
    expect(file).toBe(join(w.root, 'assistant', 'journal.json'))
    expect(existsSync(file)).toBe(true)
    const lines = JSON.parse(readFileSync(file, 'utf8')).lines
    expect(lines.map((line: { action: string; item: string; outcome: string }) => [line.action, line.item, line.outcome])).toEqual([
      ['wake-orchestrator', itemId, 'done'],
      ['continue-session', itemId, 'refused'],
    ])
    expect(existsSync(join(PROJECT_PATH, 'assistant'))).toBe(false)
  })
})
