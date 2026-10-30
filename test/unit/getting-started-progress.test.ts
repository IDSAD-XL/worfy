// The steps of Getting started that mark themselves (worfy-onboarding ticket 06,
// src/main/getting-started/progress.ts), over substituted sources: the First run report, the
// events of the Sessions, the Stage snapshots of the Demo project and its workflow model. The
// state is an in-memory stand-in for src/main/getting-started/state.ts; the file itself is covered
// by test/contract/getting-started-state.test.ts.
import { describe, expect, it } from 'vitest'
import { DEMO_EPIC, DEMO_TICKET, GettingStartedProgress, firstRunPasses, noteFirstRunReport, type ProgressSources } from '../../src/main/getting-started/progress'
import type { GettingStartedStep } from '../../src/shared/ipc/getting-started'
import type { CheckId, CheckStatus } from '../../src/shared/ipc/first-run'
import type { PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorkflowModel } from '../../src/shared/workflow/types'
import type { StageSubscriber } from '../../src/main/workflow/stages'
import type { DemoRecord } from '../../src/main/getting-started/state'

// ── the First run report (decision 2) ────────────────────────────────────────

const MAC_CHECKS: CheckId[] = ['claude-login', 'claude-version', 'git', 'git-identity', 'gh', 'node', 'jq', 'gh-auth', 'harness', 'harness-dependencies', 'harness-scripts', 'legacy-harness', 'qmd', 'qmd-models', 'qmd-collections']
const WINDOWS_CHECKS: CheckId[] = [...MAC_CHECKS, 'limits', 'windows', 'arch', 'powershell', 'git-bash']

const report = (ids: readonly CheckId[], failing: readonly CheckId[], warning: readonly CheckId[] = []) =>
  ids.map((id) => ({ id, status: (failing.includes(id) ? 'fail' : warning.includes(id) ? 'warn' : 'ok') as CheckStatus }))

describe('firstRunPasses', () => {
  it('passes with a fail at gh, gh-auth, every qmd check, legacy-harness, claude-version and limits: the demo needs none of them', () => {
    expect(firstRunPasses(report(MAC_CHECKS, ['gh', 'qmd']), 'darwin')).toBe(true)
    expect(firstRunPasses(report(WINDOWS_CHECKS, ['gh', 'gh-auth', 'qmd', 'qmd-models', 'qmd-collections', 'legacy-harness', 'claude-version', 'limits']), 'win32')).toBe(true)
  })

  it('fails with a fail at any check the demo needs', () => {
    for (const id of ['claude-login', 'git', 'git-identity', 'node', 'jq', 'harness', 'harness-dependencies', 'harness-scripts'] as const) {
      expect(firstRunPasses(report(MAC_CHECKS, [id]), 'darwin'), id).toBe(false)
    }
  })

  it('on Windows also needs windows, arch, powershell and git-bash', () => {
    for (const id of ['windows', 'arch', 'powershell', 'git-bash'] as const) {
      expect(firstRunPasses(report(WINDOWS_CHECKS, [id]), 'win32'), id).toBe(false)
    }
    // Elsewhere those rows are never in the report; one that is there does not hold the step.
    expect(firstRunPasses(report(WINDOWS_CHECKS, ['git-bash']), 'darwin')).toBe(true)
  })

  it('a warn does not hold the step', () => {
    expect(firstRunPasses(report(MAC_CHECKS, [], ['git-identity', 'harness']), 'darwin')).toBe(true)
  })
})

// ── an in-memory state ───────────────────────────────────────────────────────

function memoryState(demo: DemoRecord | null = null) {
  const steps: Partial<Record<GettingStartedStep, string>> = {}
  let reworkSeen = false
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  let current = demo
  return {
    steps,
    rework: () => reworkSeen,
    setDemo(record: DemoRecord | null) {
      current = record
      changed()
    },
    demo: () => current,
    markStep(step: GettingStartedStep): boolean {
      if (steps[step] !== undefined) return false
      steps[step] = '2026-10-30T10:00:00.000Z'
      changed()
      return true
    },
    markReworkSeen(): boolean {
      if (reworkSeen) return false
      reworkSeen = true
      changed()
      return true
    },
    onChange(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

describe('noteFirstRunReport', () => {
  it('marks step 1 on a report with a fail at gh and qmd only', () => {
    const state = memoryState()
    noteFirstRunReport(state, { checks: report(MAC_CHECKS, ['gh', 'qmd']) }, 'darwin')
    expect(Object.keys(state.steps)).toEqual(['1'])
  })

  it('does not mark step 1 on a report with a fail at git-identity, nor on Windows with a fail at git-bash', () => {
    const state = memoryState()
    noteFirstRunReport(state, { checks: report(MAC_CHECKS, ['git-identity']) }, 'darwin')
    noteFirstRunReport(state, { checks: report(WINDOWS_CHECKS, ['git-bash']) }, 'win32')
    expect(state.steps).toEqual({})
  })

  it('a later report with a fail does not take step 1 back', () => {
    const state = memoryState()
    noteFirstRunReport(state, { checks: report(MAC_CHECKS, []) }, 'darwin')
    noteFirstRunReport(state, { checks: report(MAC_CHECKS, ['git']) }, 'darwin')
    expect(Object.keys(state.steps)).toEqual(['1'])
  })
})

// ── the progress over its sources ────────────────────────────────────────────

const DEMO: DemoRecord = { projectId: 'demo-id', path: '/home/me/worfy-demo', profile: 'worfy-demo', cost: 'cheaper' }
const PIPELINE = ['queued', 'implementing', 'agent-review', 'gate-merge', 'done'] as const

/** The demo's Ticket on `kind`, every Stage before it passed. */
function ticketOn(kind: (typeof PIPELINE)[number], rework = false): PipelineTicket {
  const index = PIPELINE.indexOf(kind)
  return {
    epic: DEMO_EPIC,
    num: DEMO_TICKET,
    stage: kind,
    index,
    kind,
    passed: PIPELINE.slice(0, index),
    skipped: [],
    blocked: null,
    rework,
    sub: null,
    waits: kind === 'done' ? null : 'agent',
    enteredAt: null,
  }
}

const snapshot = (root: string, ...tickets: PipelineTicket[]): PipelineSnapshot => ({
  root,
  pipeline: PIPELINE.map((kind) => ({ kind, id: kind, title: kind })),
  tickets,
  error: null,
})

const model = (root: string, state: WorkflowModel['tickets'][number]['state']): WorkflowModel =>
  ({ root, epics: [], tickets: [{ epic: DEMO_EPIC, num: DEMO_TICKET, slug: 'done-command', title: 'done', statusRaw: state, state }], error: null, branchErrors: [] }) as unknown as WorkflowModel

const result = (): AgentEvent =>
  ({
    type: 'result',
    at: 0,
    subtype: 'success',
    isError: false,
    error: null,
    text: 'hi',
    costUsd: 0,
    durationMs: 1,
    numTurns: 1,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  }) as unknown as AgentEvent

function sources(options: { demo?: DemoRecord | null; projects?: { id: string; path: string }[] } = {}) {
  const state = memoryState(options.demo === undefined ? DEMO : options.demo)
  let projects = options.projects ?? [{ id: DEMO.projectId, path: DEMO.path }]
  const projectListeners = new Set<() => void>()
  const subscribers = new Map<string, StageSubscriber>()
  const opened: string[] = []
  const closed: string[] = []
  let status: WorkflowModel['tickets'][number]['state'] = 'work'
  const sessionListeners = new Set<(sessionId: string, event: AgentEvent) => void>()
  const orchestrators = new Map<string, string>([
    ['s-demo', DEMO.projectId],
    ['s-other', 'other-id'],
  ])
  const deps: ProgressSources = {
    state,
    projects: {
      list: () => projects,
      onChange: (listener) => {
        projectListeners.add(listener)
        return () => projectListeners.delete(listener)
      },
    },
    stages: {
      open: (root, subscriber) => {
        opened.push(root)
        subscribers.set(root, subscriber)
        return Promise.resolve(snapshot(root, ticketOn('queued')))
      },
      close: (root) => {
        closed.push(root)
        return Promise.resolve(subscribers.delete(root))
      },
    },
    workflow: { model: (root) => Promise.resolve(model(root, status)) },
    sessions: {
      observe: (listener) => {
        sessionListeners.add(listener)
        return () => sessionListeners.delete(listener)
      },
    },
    isOrchestratorOf: (projectId, sessionId) => orchestrators.get(sessionId) === projectId,
  }
  return {
    deps,
    state,
    opened,
    closed,
    subscribers,
    setProjects(next: { id: string; path: string }[]) {
      projects = next
      for (const listener of projectListeners) listener()
    },
    setStatus(next: WorkflowModel['tickets'][number]['state']) {
      status = next
    },
    sessionEvent(sessionId: string, event: AgentEvent) {
      for (const listener of sessionListeners) listener(sessionId, event)
    },
    listening: () => sessionListeners.size + projectListeners.size,
  }
}

async function started(options?: Parameters<typeof sources>[0]) {
  const fake = sources(options)
  const progress = new GettingStartedProgress(fake.deps)
  const stop = progress.start()
  await progress.settled()
  /** Sends the demo's Ticket on `kind` and waits for the progress to take it in. */
  const stage = async (kind: (typeof PIPELINE)[number], options: { rework?: boolean; status?: WorkflowModel['tickets'][number]['state'] } = {}) => {
    fake.setStatus(options.status ?? 'work')
    fake.subscribers.get(DEMO.path)?.send(snapshot(DEMO.path, ticketOn(kind, options.rework)))
    await progress.settled()
  }
  return { ...fake, progress, stop, stage }
}

describe('GettingStartedProgress, the Stages of the demo Ticket', () => {
  it('a snapshot with the Ticket on Agent review marks step 4', async () => {
    const { state, stage } = await started()
    await stage('agent-review')
    expect(Object.keys(state.steps)).toEqual(['2', '4'])
  })

  it('Implementing, Agent review, Implementing again (rework), Gate & merge, Done: steps 4, 5, 6 and reworkSeen, each at its Stage', async () => {
    const { state, stage } = await started()
    await stage('implementing')
    expect(state.steps['4']).toBeUndefined()
    await stage('agent-review')
    expect(state.steps['4']).toBeDefined()
    expect(state.steps['5']).toBeUndefined()
    await stage('implementing', { rework: true })
    expect(state.rework()).toBe(true)
    expect(state.steps['5']).toBeUndefined()
    await stage('gate-merge')
    expect(state.steps['5']).toBeDefined()
    expect(state.steps['6']).toBeUndefined()
    await stage('done', { status: 'done' })
    expect(Object.keys(state.steps).sort()).toEqual(['2', '4', '5', '6'])
    expect(state.rework()).toBe(true)
  })

  it('without a rework round: step 5 all the same, and reworkSeen stays false', async () => {
    const { state, stage } = await started()
    await stage('implementing')
    await stage('agent-review')
    await stage('gate-merge')
    await stage('done', { status: 'done' })
    expect(Object.keys(state.steps).sort()).toEqual(['2', '4', '5', '6'])
    expect(state.rework()).toBe(false)
  })

  it('step 6 is the Status done of the workflow model, not the Stage alone', async () => {
    const { state, stage } = await started()
    await stage('done', { status: 'work' })
    expect(state.steps['6']).toBeUndefined()
    await stage('done', { status: 'done' })
    expect(state.steps['6']).toBeDefined()
  })

  it('a marked step stays when the Ticket goes back, and steps mark in any order', async () => {
    const { state, stage } = await started()
    await stage('done', { status: 'done' })
    expect(Object.keys(state.steps).sort()).toEqual(['2', '4', '5', '6'])
    await stage('queued')
    expect(Object.keys(state.steps).sort()).toEqual(['2', '4', '5', '6'])
  })

  it('another Ticket of the demo marks nothing', async () => {
    const { state, subscribers, progress } = await started()
    subscribers.get(DEMO.path)?.send(snapshot(DEMO.path, { ...ticketOn('done'), num: 2 }))
    await progress.settled()
    expect(Object.keys(state.steps)).toEqual(['2'])
  })
})

describe('GettingStartedProgress, the subscription to the Stages', () => {
  it('opens no subscription without a demo record, and opens it once the record is there', async () => {
    const { opened, state, progress } = await started({ demo: null })
    expect(opened).toEqual([])
    expect(state.steps).toEqual({})
    state.setDemo(DEMO)
    await progress.settled()
    expect(opened).toEqual([DEMO.path])
    expect(Object.keys(state.steps)).toEqual(['2'])
  })

  it('no step 2 and no subscription while the demo Project is not in the list', async () => {
    const { opened, state, setProjects, progress } = await started({ projects: [] })
    expect(opened).toEqual([])
    expect(state.steps).toEqual({})
    setProjects([{ id: DEMO.projectId, path: DEMO.path }])
    await progress.settled()
    expect(opened).toEqual([DEMO.path])
    expect(Object.keys(state.steps)).toEqual(['2'])
  })

  it('the Project leaving the list closes the subscription; the marked steps stay, and a late snapshot marks nothing', async () => {
    const { opened, closed, state, setProjects, subscribers, stage, progress } = await started()
    await stage('agent-review')
    const subscriber = subscribers.get(DEMO.path)
    setProjects([])
    await progress.settled()
    expect(closed).toEqual([DEMO.path])
    expect(Object.keys(state.steps)).toEqual(['2', '4'])
    subscriber?.send(snapshot(DEMO.path, ticketOn('gate-merge')))
    await progress.settled()
    expect(state.steps['5']).toBeUndefined()
    expect(opened).toEqual([DEMO.path])
  })

  it('a workflow model that answers after the subscription closed marks no step 6', async () => {
    const { state, deps, subscribers, setProjects, progress } = await started()
    const asked: ((answer: WorkflowModel) => void)[] = []
    deps.workflow = { model: () => new Promise((resolve) => asked.push(resolve)) }
    subscribers.get(DEMO.path)?.send(snapshot(DEMO.path, ticketOn('done')))
    // The snapshot's work runs up to its read of the model.
    await new Promise((resolve) => setImmediate(resolve))
    expect(asked).toHaveLength(1)
    expect(state.steps['5']).toBeDefined()
    setProjects([])
    asked[0]?.(model(DEMO.path, 'done'))
    await progress.settled()
    expect(state.steps['6']).toBeUndefined()
  })

  it('stop() closes the subscription and every listener', async () => {
    const { closed, stop, listening, progress } = await started()
    stop()
    await progress.settled()
    expect(closed).toEqual([DEMO.path])
    expect(listening()).toBe(0)
  })
})

describe('GettingStartedProgress, the Orchestrator of the demo', () => {
  it('the end of the first turn of the demo Orchestrator marks step 3', async () => {
    const { state, sessionEvent } = await started()
    sessionEvent('s-demo', result())
    expect(state.steps['3']).toBeDefined()
  })

  it('a turn of another Project\'s Orchestrator, or another event of the demo Orchestrator, marks nothing', async () => {
    const { state, sessionEvent } = await started()
    sessionEvent('s-other', result())
    sessionEvent('s-demo', { type: 'state', at: 0, state: 'idle', error: null } as unknown as AgentEvent)
    expect(state.steps['3']).toBeUndefined()
  })

  it('without a demo record no turn marks step 3', async () => {
    const { state, sessionEvent } = await started({ demo: null })
    sessionEvent('s-demo', result())
    expect(state.steps['3']).toBeUndefined()
  })
})
