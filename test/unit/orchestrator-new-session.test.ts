// Orchestrators.newUnattendedSession (worfy-throughput ticket 52): the new SDK session Autopilot asks
// for before each Wave after a run's first. Over the real Layout store and Orchestrators, with a
// stand-in Session registry, so a turn, live background tasks and a give-back waiting can each be set
// on their own: closing the Session in any of them would end its process, and what runs in it.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import type { Session } from '../../src/main/agent/session'
import type { SessionLaunch } from '../../src/main/agent/session-settings'
import { LayoutStore } from '../../src/main/layout/store'
import type { BackgroundTask } from '../../src/shared/agent/background-tasks'
import type { AgentEvent, SessionState } from '../../src/shared/agent/events'

const PROJECT = 'demo-00000052'

let scratch: string

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-orch-52-')))
  mkdirSync(join(scratch, PROJECT), { recursive: true })
  // The Orchestrator Node with a saved SDK session and its cost.
  writeFileSync(
    join(scratch, PROJECT, 'layout.json'),
    JSON.stringify({ nodes: [{ id: 'orch', kind: 'orchestrator', x: 0, y: 0, w: 300, h: 180, locked: true, data: { sessionId: 'sdk-0', costUsd: 1.5 } }] }),
  )
})

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface FakeSession {
  id: string
  resume: string | undefined
  launch: SessionLaunch
  state: SessionState
  tasks: BackgroundTask[]
  closed: boolean
  emit(event: AgentEvent): void
}

const TASK = { taskId: 'task-1', taskType: 'local_agent', description: 'Implement' } as BackgroundTask

function setup() {
  const sessions: FakeSession[] = []
  const layout = new LayoutStore((projectId) => join(scratch, projectId), { delayMs: 0 })
  const registry = {
    start: (_path: string, resume: string | undefined, sink: (sessionId: string, event: AgentEvent) => void, _settings: unknown, launch: SessionLaunch) => {
      const fake: FakeSession = {
        id: `s${sessions.length + 1}`,
        resume,
        launch,
        state: 'idle',
        tasks: [],
        closed: false,
        emit: (event) => {
          if (event.type === 'state') fake.state = event.state
          sink(fake.id, event)
        },
      }
      sessions.push(fake)
      const session = {
        get id() {
          return fake.id
        },
        get state() {
          return fake.state
        },
        backgroundTasks: () => fake.tasks.map((task) => ({ ...task })),
        queued: () => ({ items: [], paused: false }),
        handOverQueue: () => ({ items: [], paused: false }),
        adoptQueue: () => undefined,
        close: () => {
          fake.closed = true
          fake.emit({ type: 'state', state: 'closed', error: null } as AgentEvent)
        },
        exited: () => Promise.resolve(),
        started: () => Promise.resolve(),
      }
      fake.emit({ type: 'state', state: 'idle', error: null } as AgentEvent)
      return session as unknown as Session
    },
  }
  const orchestrators = new Orchestrators({
    layout,
    projectPath: () => scratch,
    registry,
    settings: { read: () => undefined, write: () => undefined },
    transcript: () => Promise.resolve({ model: null, statusBlock: 'the last status block' }),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  const data = () => layout.get(PROJECT).layout.nodes[0]!.data
  /** The unattended Orchestrator, as a run has it: its Session is the last one started. */
  const unattended = async (): Promise<FakeSession> => {
    await orchestrators.setUnattended(PROJECT, true)
    return sessions.at(-1)!
  }
  const init = (session: FakeSession, sdkSessionId: string) =>
    session.emit({ type: 'init', sdkSessionId, model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', apiKeySource: 'none', cwd: scratch, claudeCodeVersion: null, slashCommands: [] } as unknown as AgentEvent)
  return { orchestrators, sessions, data, unattended, init }
}

describe('Orchestrators.newUnattendedSession (worfy-throughput ticket 52)', () => {
  it('a turn runs: answers null, closes nothing and starts nothing', async () => {
    const h = setup()
    const session = await h.unattended()
    session.emit({ type: 'state', state: 'busy', error: null } as AgentEvent)
    const count = h.sessions.length
    expect(await h.orchestrators.newUnattendedSession(PROJECT)).toBeNull()
    expect(session.closed).toBe(false)
    expect(h.sessions).toHaveLength(count)
  })

  it('a background task lives: answers null, closes nothing and starts nothing', async () => {
    const h = setup()
    const session = await h.unattended()
    session.tasks = [TASK]
    const count = h.sessions.length
    expect(await h.orchestrators.newUnattendedSession(PROJECT)).toBeNull()
    expect(session.closed).toBe(false)
    expect(h.sessions).toHaveLength(count)
  })

  it('a give-back waits (for tasks that have ended since): answers null, closes nothing and starts nothing', async () => {
    const h = setup()
    const session = await h.unattended()
    session.tasks = [TASK]
    // The run ended while the task lived: the give-back waits for it.
    await h.orchestrators.setUnattended(PROJECT, false)
    session.tasks = []
    const count = h.sessions.length
    expect(await h.orchestrators.newUnattendedSession(PROJECT)).toBeNull()
    expect(session.closed).toBe(false)
    expect(h.sessions).toHaveLength(count)
  })

  it('attended: answers null', async () => {
    const h = setup()
    await h.orchestrators.open(PROJECT)
    expect(await h.orchestrators.newUnattendedSession(PROJECT)).toBeNull()
    expect(h.sessions).toHaveLength(1)
  })

  it('free: a new unattended Session without resume, no status block; the Node keeps the saved id and cost until its init, so a give-back before it continues the saved session', async () => {
    const h = setup()
    const session = await h.unattended()
    expect(session.resume).toBe('sdk-0')
    expect(h.orchestrators.view('orch')?.statusBlock).toBe('the last status block')
    const view = await h.orchestrators.newUnattendedSession(PROJECT)
    const fresh = h.sessions.at(-1)!
    expect(session.closed).toBe(true)
    expect(fresh).toMatchObject({ resume: undefined, launch: { unattended: true } })
    expect(view).toMatchObject({ sessionId: fresh.id, statusBlock: null })
    expect(h.data()).toMatchObject({ sessionId: 'sdk-0', costUsd: 1.5 })
    // A Stop before the new session's first prompt: the person gets the saved session back.
    await h.orchestrators.setUnattended(PROJECT, false)
    expect(fresh.closed).toBe(true)
    expect(h.sessions.at(-1)).toMatchObject({ resume: 'sdk-0', launch: { unattended: false } })
    expect(h.data()).toMatchObject({ sessionId: 'sdk-0', costUsd: 1.5 })
  })

  it('the new session\'s first init makes it the Node\'s, its cost from zero; a give-back then continues it', async () => {
    const h = setup()
    await h.unattended()
    await h.orchestrators.newUnattendedSession(PROJECT)
    h.init(h.sessions.at(-1)!, 'sdk-1')
    expect(h.data()).toMatchObject({ sessionId: 'sdk-1', costUsd: 0 })
    expect(h.orchestrators.view('orch')?.costUsd).toBe(0)
    // The new session's first turn costs only itself, not the old session's 1.5 on top.
    h.sessions.at(-1)!.emit({ type: 'result', isError: false, interrupted: false, subtype: 'success', text: 'done', error: null, costUsd: 0.25, durationMs: 1, numTurns: 1 } as unknown as AgentEvent)
    expect(h.data()).toMatchObject({ costUsd: 0.25 })
    await h.orchestrators.setUnattended(PROJECT, false)
    expect(h.sessions.at(-1)).toMatchObject({ resume: 'sdk-1', launch: { unattended: false } })
  })
})
