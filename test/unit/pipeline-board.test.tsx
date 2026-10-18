// The Pipeline tab and the Pipeline section of the sidebar (worfy-pipeline ticket 04), over snapshots
// of `pipeline.get` built the way main builds them (src/main/workflow/stages.ts): the columns from a
// Pipeline with stageId and stageLabel, the Stage of each Ticket from its facts with stageOf.
// - the board (src/renderer/pipeline/PipelineBoard.tsx): a column per Stage of the Project's
//   Pipeline, in its order — worfy's and Atakama's from the spec; Done folded into a count that a
//   click opens; on a card the Ticket, its title, who it waits for, `blocked` with the reason,
//   `rework` and the caption of its Stage; a click shows the Ticket's Card on the Canvas; a
//   `pipeline.changed` moves a card without a reload;
// - the section (src/renderer/shell/sidebar/PipelineSection.tsx): the Tickets in work of every
//   Project, neither Queued nor Done, with the Stage and who they wait for; "Nothing in work" when
//   there are none; a click opens the board of that Project.
// jsdom lays nothing out: the columns side by side and both themes are checked against the built
// app (test/e2e/pipeline.spec.ts).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import { stageId, stageLabel, stageOf, type CheckFact, type PipelineStage, type StageFacts } from '../../src/shared/workflow/pipeline'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

/** worfy: Queued → Implementing → CI → Agent review → Check «windows» → Gate & merge → Deploy → Closing → Done. */
const WORFY: PipelineStage[] = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'ci' },
  { kind: 'agent-review' },
  { kind: 'check', name: 'windows' },
  { kind: 'gate-merge' },
  { kind: 'deploy' },
  { kind: 'closing' },
  { kind: 'done' },
]

/** Atakama (Silent mode): Queued → Implementing → Agent review → CI → Human review → Awaiting merge → Done. */
const ATAKAMA: PipelineStage[] = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'agent-review' },
  { kind: 'ci' },
  { kind: 'human-review' },
  { kind: 'awaiting-merge' },
  { kind: 'done' },
]

const WORFY_ROOT = '/projects/worfy'
const ATAKAMA_ROOT = '/projects/atakama'
const HEAD = 'a'.repeat(40)

const baseFacts = (change: Partial<StageFacts> = {}): StageFacts => ({
  mode: 'full',
  status: 'open',
  statusAt: '2026-10-17T09:00Z',
  blockedReason: null,
  waits: null,
  headSha: null,
  pr: null,
  marks: [],
  deploys: [],
  lock: null,
  ...change,
})

const openPr = (checks: readonly CheckFact[] = []): NonNullable<StageFacts['pr']> => ({
  number: 7,
  state: 'OPEN',
  headSha: HEAD,
  checks,
  reviewDecision: null,
  mergedAt: null,
  mergeCommit: null,
})

const ticket = (epic: string, num: number, pipeline: readonly PipelineStage[], facts: Partial<StageFacts> = {}): PipelineTicket => ({ epic, num, ...stageOf(baseFacts(facts), pipeline) })

const snapshotOf = (root: string, pipeline: readonly PipelineStage[], tickets: PipelineTicket[], error: string | null = null): PipelineSnapshot => ({
  root,
  pipeline: pipeline.map((stage) => ({ ...stage, id: stageId(stage), title: stageLabel(stage) })),
  tickets,
  error,
})

/** worfy's board: two open, one claimed and blocked waiting for the owner, one back in rework, one with red CI, three done. */
const worfySnapshot = (): PipelineSnapshot =>
  snapshotOf(WORFY_ROOT, WORFY, [
    ticket('worfy-pipeline', 1, WORFY, { status: 'done' }),
    ticket('worfy-pipeline', 2, WORFY, { status: 'done' }),
    ticket('worfy-pipeline', 3, WORFY, { status: 'done' }),
    ticket('worfy-pipeline', 4, WORFY, { status: 'blocked', blockedReason: 'приёмка владельца', waits: 'owner' }),
    ticket('worfy-pipeline', 5, WORFY, { status: 'work', headSha: HEAD, marks: [{ kind: 'review', verdict: 'failure', sha: HEAD, at: '2026-10-17T10:00Z' }] }),
    ticket('worfy-pipeline', 6, WORFY, { status: 'work', headSha: HEAD, pr: openPr([{ name: 'check', state: 'failure', startedAt: '2026-10-17T10:00Z', completedAt: '2026-10-17T10:05Z' }]) }),
    ticket('worfy-pipeline', 7, WORFY),
    ticket('worfy-pipeline', 8, WORFY),
  ])

const modelTicket = (epic: string, num: number, title: string): Ticket => ({
  epic,
  num,
  slug: `t-${num}`,
  title: `${String(num).padStart(2, '0')} — ${title}`,
  statusRaw: 'open',
  state: 'open',
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: false,
  fromBranch: null,
})

const modelOf = (root: string, tickets: Ticket[]): WorkflowModel => ({ root, epics: [], tickets, error: null, branchErrors: [] })

const TITLES: Record<string, string> = {
  'worfy-pipeline/4': 'Pipeline tab and sidebar section',
  'worfy-pipeline/5': 'Stepper on the Card',
  'worfy-pipeline/6': 'Stuck Tickets',
  'worfy-pipeline/7': 'epic-wave by the Pipeline',
  'atakama/3': 'Login page',
  'atakama/9': 'Reports export',
}

const worfyModel = (): WorkflowModel =>
  modelOf(
    WORFY_ROOT,
    Object.entries(TITLES)
      .filter(([key]) => key.startsWith('worfy-pipeline/'))
      .map(([key, title]) => modelTicket('worfy-pipeline', Number(key.split('/')[1]), title)),
  )

const atakamaSnapshot = (): PipelineSnapshot =>
  snapshotOf(ATAKAMA_ROOT, ATAKAMA, [
    ticket('atakama', 3, ATAKAMA, { mode: 'silent', status: 'work', headSha: HEAD, marks: [{ kind: 'review', verdict: 'success', sha: HEAD, at: null }], pr: { ...openPr(), reviewDecision: null } }),
    ticket('atakama', 9, ATAKAMA, { mode: 'silent' }),
  ])

const atakamaModel = (): WorkflowModel => modelOf(ATAKAMA_ROOT, [modelTicket('atakama', 3, TITLES['atakama/3']!), modelTicket('atakama', 9, TITLES['atakama/9']!)])

const appSettings = (): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  revision: 0,
})

interface FakeMain {
  /** Every call, oldest first. */
  calls: { channel: string; input: unknown }[]
  /** Fires an event of main to the window. */
  emit: (channel: string, payload: unknown) => void
}

let main: FakeMain

/** This Machine's preload over the answers of main: Projects, Pipelines and workflow models by root. */
function preload(options: { projects: ProjectsState; pipelines: Record<string, PipelineSnapshot>; models: Record<string, WorkflowModel>; answers?: Record<string, () => unknown> }): void {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let projects = options.projects
  let next = 0
  const fake: FakeMain = {
    calls: [],
    emit: (channel, payload) => {
      for (const each of handlers.values()) if (each.channel === channel) each.handler(payload)
    },
  }
  const answer = (channel: string, input: unknown): IpcResult<unknown> => {
    const root = (input as { root?: string } | undefined)?.root ?? ''
    const own = options.answers?.[channel]
    if (own !== undefined) return { ok: true, value: own() }
    switch (channel) {
      case 'projects.list':
        return { ok: true, value: projects }
      case 'projects.select':
        projects = { ...projects, activeId: (input as { id: string }).id, revision: projects.revision + 1 }
        return { ok: true, value: projects }
      case 'appSettings.get':
        return { ok: true, value: appSettings() }
      case 'pipeline.get':
        return options.pipelines[root] ? { ok: true, value: options.pipelines[root] } : { ok: false, error: `no Project at ${root}` }
      case 'workflow.open':
        return options.models[root] ? { ok: true, value: options.models[root] } : { ok: false, error: `no Project at ${root}` }
      default:
        return { ok: true, value: { closed: true } }
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      return Promise.resolve(answer(channel, input) as never)
    },
    on: (channel, handler) => {
      next += 1
      handlers.set(next, { channel, handler: handler as (payload: unknown) => void })
      return next
    },
    off: (id) => {
      handlers.delete(id)
    },
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

const PROJECTS: ProjectsState = {
  projects: [
    { id: 'worfy-00000001', name: 'worfy', path: WORFY_ROOT, branch: 'main' },
    { id: 'atakama-00000002', name: 'atakama', path: ATAKAMA_ROOT, branch: 'main' },
  ],
  activeId: 'worfy-00000001',
  revision: 1,
}

beforeEach(() => {
  // usePipeline, useWorkflow, useProjects and the navigation keep their state in modules: every test starts with fresh ones.
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

const columnTitles = (): string[] => screen.getAllByTestId('pipeline-column').map((column) => within(column).getByTestId('pipeline-column-title').textContent ?? '')

const cardOf = (epic: string, num: number): HTMLElement => {
  const card = screen.getAllByTestId('pipeline-card').find((each) => each.dataset.epic === epic && each.dataset.ticket === String(num))
  if (!card) throw new Error(`no card ${epic} ${num}`)
  return card
}

const columnOf = (card: HTMLElement): string | undefined => card.closest<HTMLElement>('[data-testid="pipeline-column"]')?.dataset.stage

describe('the Pipeline board', () => {
  it("has a column for each Stage of worfy's Pipeline, in its order, with the Profile's names", async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={{}} onOpenTicket={() => undefined} />)
    expect(columnTitles()).toEqual(['Queued', 'Implementing', 'CI', 'Agent review', 'Check «windows»', 'Gate & merge', 'Deploy', 'Closing', 'Done'])
    expect(screen.getAllByTestId('pipeline-column').map((column) => column.dataset.stage)).toEqual(WORFY.map(stageId))
  })

  it("has Atakama's columns in Atakama's order, a label of the Profile replacing the catalogue's name", async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    const pipeline = ATAKAMA.map((stage) => (stage.kind === 'human-review' ? { ...stage, label: 'Team review' } : stage))
    render(<PipelineBoardView name="atakama" snapshot={snapshotOf(ATAKAMA_ROOT, pipeline, atakamaSnapshot().tickets)} titles={{}} onOpenTicket={() => undefined} />)
    expect(columnTitles()).toEqual(['Queued', 'Implementing', 'Agent review', 'CI', 'Team review', 'Awaiting merge', 'Done'])
    // Agent review passed, the PR's CI is green: Atakama 03 stands on Human review, waiting for the team.
    expect(columnOf(cardOf('atakama', 3))).toBe('human-review')
    expect(within(cardOf('atakama', 3)).getByTestId('pipeline-waits').textContent).toBe('Waits: team')
  })

  it('puts open Tickets in Queued and folds Done into a count that a click opens', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={{}} onOpenTicket={() => undefined} />)
    expect(columnOf(cardOf('worfy-pipeline', 7))).toBe('queued')
    expect(columnOf(cardOf('worfy-pipeline', 8))).toBe('queued')
    const done = screen.getAllByTestId('pipeline-column').find((column) => column.dataset.stage === 'done')!
    expect(within(done).queryAllByTestId('pipeline-card')).toHaveLength(0)
    const toggle = within(done).getByRole('button', { name: '3 done' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(done).getAllByTestId('pipeline-card').map((card) => card.dataset.ticket)).toEqual(['1', '2', '3'])
    fireEvent.click(toggle)
    expect(within(done).queryAllByTestId('pipeline-card')).toHaveLength(0)
  })

  it('shows on a card the Ticket, its title, who it waits for, blocked with its reason, rework and the caption of the Stage', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={TITLES} onOpenTicket={() => undefined} />)

    const blocked = cardOf('worfy-pipeline', 4)
    expect(within(blocked).getByTestId('pipeline-ref').textContent).toBe('worfy-pipeline 04')
    expect(within(blocked).getByText('Pipeline tab and sidebar section')).toBeTruthy()
    expect(within(blocked).getByTestId('pipeline-waits').textContent).toBe('Waits: owner')
    expect(within(blocked).getByTestId('pipeline-blocked').textContent).toBe('Blocked: приёмка владельца')
    expect(blocked.dataset.blocked).toBe('true')
    // Blocked is a flag on whatever Stage the Ticket stands on, not a Stage: claimed without a PR is Implementing.
    expect(columnOf(blocked)).toBe('implementing')

    const rework = cardOf('worfy-pipeline', 5)
    expect(columnOf(rework)).toBe('implementing')
    expect(within(rework).getByTestId('pipeline-rework').textContent).toBe('Rework')
    expect(within(rework).getByTestId('pipeline-waits').textContent).toBe('Waits: agent')
    expect(within(rework).queryByTestId('pipeline-blocked')).toBeNull()

    const failing = cardOf('worfy-pipeline', 6)
    expect(columnOf(failing)).toBe('ci')
    expect(within(failing).getByTestId('pipeline-sub').textContent).toBe('failing')
    expect(within(failing).queryByTestId('pipeline-rework')).toBeNull()

    // A Ticket the workflow model does not have yet keeps its reference.
    expect(within(cardOf('worfy-pipeline', 8)).queryByTestId('pipeline-title')).toBeNull()
  })

  it('shows the captions of a Ticket on Gate & merge: gate running, waiting for gate', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    const mine = { ...openPr(), number: 11 }
    const passedAll = (pr: NonNullable<StageFacts['pr']>): Partial<StageFacts> => ({
      status: 'work',
      headSha: HEAD,
      pr,
      marks: [
        { kind: 'review', verdict: 'success', sha: HEAD, at: null },
        { kind: 'check/windows', verdict: 'skipped', sha: HEAD, at: null },
      ],
    })
    const snapshot = snapshotOf(WORFY_ROOT, WORFY, [
      ticket('worfy-pipeline', 11, WORFY, { ...passedAll(mine), lock: { prs: [11] } }),
      ticket('worfy-pipeline', 12, WORFY, { ...passedAll({ ...openPr(), number: 12 }), lock: { prs: [11] } }),
    ])
    render(<PipelineBoardView name="worfy" snapshot={snapshot} titles={{}} onOpenTicket={() => undefined} />)
    expect(columnOf(cardOf('worfy-pipeline', 11))).toBe('gate-merge')
    expect(within(cardOf('worfy-pipeline', 11)).getByTestId('pipeline-sub').textContent).toBe('gate running')
    expect(within(cardOf('worfy-pipeline', 12)).getByTestId('pipeline-sub').textContent).toBe('waiting for gate')
  })

  it('names a Machine the Ticket waits for, and says why the Stages may be short of facts', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    const snapshot = snapshotOf(WORFY_ROOT, WORFY, [ticket('worfy-pipeline', 4, WORFY, { status: 'blocked', waits: 'Windows PC' })], 'gh is unavailable: not logged in')
    render(<PipelineBoardView name="worfy" snapshot={snapshot} titles={{}} onOpenTicket={() => undefined} />)
    expect(within(cardOf('worfy-pipeline', 4)).getByTestId('pipeline-waits').textContent).toBe('Waits: Windows PC')
    // A blocked Ticket without a reason still says it is blocked.
    expect(within(cardOf('worfy-pipeline', 4)).getByTestId('pipeline-blocked').textContent).toBe('Blocked')
    expect(screen.getByRole('status').textContent).toContain('gh is unavailable: not logged in')
  })

  it('opens the Ticket of a clicked card', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    const open = vi.fn()
    render(<PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={{}} onOpenTicket={open} />)
    fireEvent.click(cardOf('worfy-pipeline', 6))
    expect(open).toHaveBeenCalledWith({ epic: 'worfy-pipeline', num: 6 })
  })

  it('shows the Card of a clicked Ticket on the Canvas, and follows pipeline.changed without a reload', async () => {
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot() }, models: { [WORFY_ROOT]: worfyModel() } })
    const { PipelineBoard } = await import('../../src/renderer/pipeline/PipelineBoard')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const { useCanvasRequests } = await import('../../src/renderer/find/canvas-requests')
    render(<PipelineBoard project={PROJECTS.projects[0]} />)
    await waitFor(() => expect(columnOf(cardOf('worfy-pipeline', 7))).toBe('queued'))
    await waitFor(() => expect(within(cardOf('worfy-pipeline', 7)).getByTestId('pipeline-title').textContent).toBe('epic-wave by the Pipeline'))
    expect(main.calls.filter((call) => call.channel === 'pipeline.get')).toEqual([{ channel: 'pipeline.get', input: { root: WORFY_ROOT } }])

    // `ticket claim` on 07: main sends the whole snapshot again.
    const claimed = worfySnapshot()
    claimed.tickets = claimed.tickets.map((each) => (each.num === 7 ? ticket('worfy-pipeline', 7, WORFY, { status: 'work' }) : each))
    act(() => main.emit('pipeline.changed', claimed))
    expect(columnOf(cardOf('worfy-pipeline', 7))).toBe('implementing')

    useNavigation.setState({ view: 'pipeline' })
    fireEvent.click(cardOf('worfy-pipeline', 7))
    expect(useNavigation.getState().view).toBe('canvas')
    expect(useCanvasRequests.getState().focus).toMatchObject({ projectId: 'worfy-00000001', nodeId: 'ticket:worfy-pipeline/7', fallbackId: 'epic:worfy-pipeline' })
  })

  it('says why the Pipeline could not be read', async () => {
    preload({ projects: PROJECTS, pipelines: {}, models: {} })
    const { PipelineBoard } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoard project={PROJECTS.projects[0]} />)
    expect((await screen.findByRole('alert')).textContent).toContain(`no Project at ${WORFY_ROOT}`)
  })

  it('without a Project, says there is none and asks main for nothing', async () => {
    preload({ projects: PROJECTS, pipelines: {}, models: {} })
    const { PipelineBoard } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoard project={undefined} />)
    expect(screen.getByText('No project')).toBeTruthy()
    expect(main.calls.filter((call) => call.channel === 'pipeline.get')).toEqual([])
  })
})

describe('the Pipeline section of the sidebar', () => {
  const rows = (): { project: string | undefined; ref: string; stage: string; waits: string }[] =>
    screen.getAllByTestId('pipeline-row').map((row) => ({
      project: row.dataset.project,
      ref: within(row).getByTestId('pipeline-ref').textContent ?? '',
      stage: within(row).getByTestId('pipeline-stage').textContent ?? '',
      waits: within(row).getByTestId('pipeline-waits').textContent ?? '',
    }))

  it('lists the Tickets in work of every Project, neither Queued nor Done, with the Stage and who they wait for', async () => {
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATAKAMA_ROOT]: atakamaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATAKAMA_ROOT]: atakamaModel() } })
    const { default: PipelineSection } = await import('../../src/renderer/shell/sidebar/PipelineSection')
    render(<PipelineSection />)
    await waitFor(() => expect(screen.getAllByTestId('pipeline-row')).toHaveLength(4))
    expect(rows()).toEqual([
      { project: 'worfy-00000001', ref: 'worfy-pipeline 04', stage: 'Implementing', waits: 'Waits: owner' },
      { project: 'worfy-00000001', ref: 'worfy-pipeline 05', stage: 'Implementing', waits: 'Waits: agent' },
      { project: 'worfy-00000001', ref: 'worfy-pipeline 06', stage: 'CI', waits: 'Waits: agent' },
      { project: 'atakama-00000002', ref: 'atakama 03', stage: 'Human review', waits: 'Waits: team' },
    ])
    // Each Project under its name; the titles come from the workflow model.
    expect(screen.getByText('worfy')).toBeTruthy()
    expect(screen.getByText('atakama')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Login page')).toBeTruthy())
    // The blocked one says so on its chip.
    const blocked = screen.getAllByTestId('pipeline-row')[0]!
    expect(within(blocked).getByTestId('pipeline-stage').querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked')
    expect(screen.getAllByTestId('pipeline-row')[1]!.querySelector('[data-status]')?.getAttribute('data-status')).toBe('working')
    expect(screen.queryByText('Nothing in work')).toBeNull()
  })

  it('says "Nothing in work" when no Project has a Ticket in work', async () => {
    const idle = snapshotOf(WORFY_ROOT, WORFY, [ticket('worfy-pipeline', 1, WORFY, { status: 'done' }), ticket('worfy-pipeline', 2, WORFY)])
    const idleAtakama = snapshotOf(ATAKAMA_ROOT, ATAKAMA, [ticket('atakama', 9, ATAKAMA, { mode: 'silent' })])
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: idle, [ATAKAMA_ROOT]: idleAtakama }, models: { [WORFY_ROOT]: worfyModel(), [ATAKAMA_ROOT]: atakamaModel() } })
    const { default: PipelineSection } = await import('../../src/renderer/shell/sidebar/PipelineSection')
    render(<PipelineSection />)
    expect(await screen.findByText('Nothing in work')).toBeTruthy()
    expect(screen.queryAllByTestId('pipeline-row')).toHaveLength(0)
    // A Ticket that goes into work shows up without a reload, and the empty line goes.
    const claimed = snapshotOf(ATAKAMA_ROOT, ATAKAMA, [ticket('atakama', 9, ATAKAMA, { mode: 'silent', status: 'work' })])
    act(() => main.emit('pipeline.changed', claimed))
    expect(rows()).toEqual([{ project: 'atakama-00000002', ref: 'atakama 09', stage: 'Implementing', waits: 'Waits: agent' }])
    expect(screen.queryByText('Nothing in work')).toBeNull()
  })

  it("opens the Pipeline board of a clicked row's Project", async () => {
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATAKAMA_ROOT]: atakamaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATAKAMA_ROOT]: atakamaModel() } })
    const { default: PipelineSection } = await import('../../src/renderer/shell/sidebar/PipelineSection')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const { useProjects, activeProject } = await import('../../src/renderer/projects/useProjects')
    let active: string | undefined
    function Active() {
      active = activeProject(useProjects())?.id
      return null
    }
    render(
      <>
        <PipelineSection />
        <Active />
      </>,
    )
    await waitFor(() => expect(screen.getAllByTestId('pipeline-row')).toHaveLength(4))
    expect(useNavigation.getState().view).toBe('canvas')
    fireEvent.click(screen.getAllByTestId('pipeline-row').find((row) => row.dataset.project === 'atakama-00000002')!)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'atakama-00000002' } })
    await waitFor(() => expect(active).toBe('atakama-00000002'))

    // A row of the active Project switches the view and selects nothing.
    useNavigation.setState({ view: 'session' })
    const selects = main.calls.filter((call) => call.channel === 'projects.select').length
    fireEvent.click(screen.getAllByTestId('pipeline-row').find((row) => row.dataset.project === 'atakama-00000002')!)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls.filter((call) => call.channel === 'projects.select')).toHaveLength(selects)
  })
})

describe('stuck Tickets on the board and in the section (worfy-pipeline ticket 06)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // At 13:00 worfy-pipeline 06 has been on CI since its check started at 10:00, 05 in rework since
  // the failed review at 10:00 — both past 2 h; 04 waits for the owner since 09:00, under 24 h.
  const at = (time: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(time))
  }

  it('a card past the threshold of its Stage has the «stuck» frame and its time on the Stage in the tooltip; the others do not', async () => {
    at('2026-10-17T13:00:00Z')
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={TITLES} onOpenTicket={() => undefined} />)
    expect(cardOf('worfy-pipeline', 6).dataset.stuck).toBe('true')
    expect(cardOf('worfy-pipeline', 6).title).toContain('stuck: on CI for 3 h')
    expect(cardOf('worfy-pipeline', 5).dataset.stuck).toBe('true')
    expect(cardOf('worfy-pipeline', 5).title).toContain('stuck: on Implementing for 3 h')
    // Waits: owner — 24 h.
    expect(cardOf('worfy-pipeline', 4).dataset.stuck).toBeUndefined()
    expect(cardOf('worfy-pipeline', 4).title).not.toContain('stuck')
    // Queued and Done have no threshold.
    expect(cardOf('worfy-pipeline', 7).dataset.stuck).toBeUndefined()
  })

  it('an hour earlier nothing is stuck', async () => {
    at('2026-10-17T11:59:00Z')
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={TITLES} onOpenTicket={() => undefined} />)
    expect(screen.getAllByTestId('pipeline-card').filter((card) => card.dataset.stuck === 'true')).toEqual([])
  })

  it('a pipeline.changed that brings a Ticket onto a Stage it entered long ago frames it at once', async () => {
    at('2026-10-17T11:00:00Z')
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot() }, models: { [WORFY_ROOT]: worfyModel() } })
    const { PipelineBoard } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoard project={PROJECTS.projects[0]} />)
    await waitFor(() => expect(columnOf(cardOf('worfy-pipeline', 7))).toBe('queued'))
    expect(cardOf('worfy-pipeline', 7).dataset.stuck).toBeUndefined()
    const claimed = worfySnapshot()
    claimed.tickets = claimed.tickets.map((each) => (each.num === 7 ? ticket('worfy-pipeline', 7, WORFY, { status: 'work', statusAt: '2026-10-17T08:00Z' }) : each))
    act(() => main.emit('pipeline.changed', claimed))
    expect(columnOf(cardOf('worfy-pipeline', 7))).toBe('implementing')
    expect(cardOf('worfy-pipeline', 7).dataset.stuck).toBe('true')
  })

  // The clock of the board and the section ticks each minute: with setInterval faked too, a minute
  // passes without a new snapshot.
  const atWithClock = (time: string) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(time))
  }

  it('a card that passes the threshold while the board is open gets its frame a minute later, without a new snapshot', async () => {
    atWithClock('2026-10-17T11:59:30Z')
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={TITLES} onOpenTicket={() => undefined} />)
    expect(cardOf('worfy-pipeline', 6).dataset.stuck).toBeUndefined()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(cardOf('worfy-pipeline', 6).dataset.stuck).toBe('true')
    expect(cardOf('worfy-pipeline', 6).title).toContain('stuck: on CI for 2 h')
  })

  it('a row of the section that passes the threshold gets its frame a minute later, without a new snapshot', async () => {
    atWithClock('2026-10-17T11:59:30Z')
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATAKAMA_ROOT]: atakamaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATAKAMA_ROOT]: atakamaModel() } })
    const { default: PipelineSection } = await import('../../src/renderer/shell/sidebar/PipelineSection')
    render(<PipelineSection />)
    // vi.waitFor polls with the real timers: setInterval is faked here.
    await vi.waitFor(() => expect(screen.getAllByTestId('pipeline-row')).toHaveLength(4))
    const row = (num: number) => screen.getAllByTestId('pipeline-row').find((each) => each.dataset.project === 'worfy-00000001' && each.dataset.ticket === String(num))!
    expect(row(6).dataset.stuck).toBeUndefined()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(row(6).dataset.stuck).toBe('true')
    expect(row(6).title).toContain('stuck: on CI for 2 h')
  })

  it('a row of the section past the threshold has the frame and the time in its tooltip', async () => {
    at('2026-10-17T13:00:00Z')
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATAKAMA_ROOT]: atakamaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATAKAMA_ROOT]: atakamaModel() } })
    const { default: PipelineSection } = await import('../../src/renderer/shell/sidebar/PipelineSection')
    render(<PipelineSection />)
    await waitFor(() => expect(screen.getAllByTestId('pipeline-row')).toHaveLength(4))
    const row = (num: number) => screen.getAllByTestId('pipeline-row').find((each) => each.dataset.project === 'worfy-00000001' && each.dataset.ticket === String(num))!
    expect(row(6).dataset.stuck).toBe('true')
    expect(row(6).title).toContain('stuck: on CI for 3 h')
    expect(row(4).dataset.stuck).toBeUndefined()
    expect(row(4).title).not.toContain('stuck')
  })
})

describe('a click on a notification of a Ticket that waits for the owner (worfy-pipeline ticket 06)', () => {
  it('opens the Pipeline board of its Project: another Project is selected first', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: { 'sessions.views': () => ({ views: [] }), 'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: ATAKAMA_ROOT, epic: 'atakama', num: 3 } }) },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    expect(useNavigation.getState().view).toBe('canvas')
    render(<NotificationTarget />)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'atakama-00000002' } })
  })

  it('of the active Project: only the view changes', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: { 'sessions.views': () => ({ views: [] }), 'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: WORFY_ROOT, epic: 'worfy-pipeline', num: 4 } }) },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    render(<NotificationTarget />)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls.filter((call) => call.channel === 'projects.select')).toEqual([])
  })

  it('of a Project no longer in the list: nothing opens', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: { 'sessions.views': () => ({ views: [] }), 'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: '/projects/gone', epic: 'e', num: 1 } }) },
    })
    const error = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const { usePendingNote } = await import('../../src/renderer/session/notification-target')
    render(<NotificationTarget />)
    await waitFor(() => expect(main.calls.some((call) => call.channel === 'projects.list')).toBe(true))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(usePendingNote.getState().pending).toBeNull()
    expect(useNavigation.getState().view).toBe('canvas')
    expect(main.calls.filter((call) => call.channel === 'projects.select')).toEqual([])
  })
})
