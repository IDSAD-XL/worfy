// The start of Autopilot from a chat (worfy-flight-recorder ticket 21, ADR-0091): the command typed in a
// chat (ticket 22) and the Orchestrator's tool (ticket 23) both go through startFromChat. It checks the
// Epic and the named Tickets, refuses while a run goes on, and starts the run as the button does; a run
// that waits for the busy Orchestrator answers so, and a refusal when it takes the Orchestrator is told
// on the Session that asked (worfy-autopilot-queue ticket 07). Autopilot, the workflow and the Sessions
// are stand-ins; the journal is the stand-in Autopilot's, which a refusal never reaches.
import { describe, expect, it } from 'vitest'
import { ChatStarts, chatRunningHint, lateRefusalNotice, WAIT_MESSAGE, type ChatStartDeps, type ChatStartRequest } from '../../src/main/autopilot/chat-start'
import type { AutopilotStartOptions } from '../../src/main/autopilot/run'
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

/** A stand-in Autopilot and workflow; every start, journal line and notice is recorded. */
function standIn(options: { running?: string | null; orchestratorBusy?: boolean; workflowError?: string } = {}) {
  const out = {
    starts: [] as [string, string, AutopilotStartOptions | undefined][],
    journal: [] as string[],
    notices: [] as [string, string][],
    running: options.running ?? null,
    /** The Orchestrator is busy: a start is accepted and waits for it. */
    busy: options.orchestratorBusy ?? false,
    deps: null as unknown as ChatStartDeps,
  }
  out.deps = {
    autopilot: {
      start: (projectId, epic, start) => {
        out.starts.push([projectId, epic, start])
        out.journal.push('run-started')
        out.running = epic
        const state = out.busy ? { projectId, epic, status: 'waiting', waitingFor: 'orchestrator' } : { projectId, epic, status: 'running' }
        return Promise.resolve(state as AutopilotState)
      },
      runningEpic: () => out.running,
    },
    workflow: () => Promise.resolve(model(options.workflowError ?? null)),
    notify: (sessionId, text) => void out.notices.push([sessionId, text]),
  }
  return out
}

/** The options of a start without the listener of a late refusal, which a test calls by itself. */
const plain = (start: AutopilotStartOptions | undefined) =>
  start === undefined ? undefined : Object.fromEntries(Object.entries(start).filter(([key]) => key !== 'onLateRefusal'))

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

  it('refuses when the workflow cannot be read; nothing starts', async () => {
    const s = standIn({ workflowError: 'no .scratch' })
    expect(await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: 'Cannot read the workflow: no .scratch' })
    expect(s.starts).toEqual([])
  })

  it('refuses while a run goes on in the Project, naming its Epic and "Add to queue…", and writes nothing to the journal', async () => {
    const s = standIn({ running: 'billing' })
    const hint = 'Autopilot is already running Epic billing. Stop it first, or add Epics to its queue with "Add to queue…" in the ⋯ menu.'
    const answer = await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, tickets: [5], by: 'command' })
    expect(answer).toEqual({ kind: 'refused', message: hint })
    expect(chatRunningHint('billing')).toBe(hint)
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
    s.deps.autopilot.start = () => Promise.reject(new Error('Set the Run wave template in Project settings'))
    expect(await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: 'Set the Run wave template in Project settings' })
    // The button started Epic billing while this start was on its way.
    s.deps.autopilot.start = () => {
      s.running = 'billing'
      return Promise.reject(new Error('Autopilot is already running in this Project (Epic billing): stop it first'))
    }
    expect(await new ChatStarts(s.deps).startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: chatRunningHint('billing') })
  })

  it('a busy Orchestrator, also the one whose turn asked, refuses nothing: the run is accepted and waits, and the answer says so (worfy-autopilot-queue ticket 07)', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    expect(await starts.startFromChat(fromTurn({ tickets: [5] }))).toEqual({ kind: 'after-turn', message: WAIT_MESSAGE })
    expect(WAIT_MESSAGE).toBe('Autopilot waits for the Orchestrator and starts when it is free')
    expect(s.starts.map(([projectId, epic, start]) => [projectId, epic, plain(start)])).toEqual([[PROJECT, EPIC, { override: false, by: 'tool', tickets: [5] }]])
    // The waiting run is the Project's run: a second ask is refused with the running hint.
    expect(await starts.startFromChat(fromTurn())).toEqual({ kind: 'refused', message: chatRunningHint(EPIC) })
    expect(await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })).toEqual({ kind: 'refused', message: chatRunningHint(EPIC) })
    expect(s.starts).toHaveLength(1)
  })

  it('a refusal when the waiting run takes the Orchestrator is told on the Session that asked; a start without a Session tells no one', async () => {
    const s = standIn({ orchestratorBusy: true })
    const starts = new ChatStarts(s.deps)
    await starts.startFromChat(fromTurn())
    s.starts[0]![2]?.onLateRefusal?.('Autopilot is already running Epic demo of this repository on Studio')
    expect(s.notices).toEqual([[ORCHESTRATOR, lateRefusalNotice(EPIC, 'Autopilot is already running Epic demo of this repository on Studio')]])
    expect(lateRefusalNotice(EPIC, 'x')).toBe('Autopilot did not start Epic demo: x')
    s.running = null
    await starts.startFromChat({ projectId: PROJECT, epic: EPIC, by: 'command' })
    expect(s.starts[1]![2]).not.toHaveProperty('onLateRefusal')
  })

  it('a Session that is gone when the refusal comes shows nothing, and the run does not fail for it', async () => {
    const s = standIn({ orchestratorBusy: true })
    s.deps.notify = () => {
      throw new Error('No live Session orch-session')
    }
    await new ChatStarts(s.deps).startFromChat(fromTurn())
    expect(() => s.starts[0]![2]?.onLateRefusal?.('refused')).not.toThrow()
  })
})
