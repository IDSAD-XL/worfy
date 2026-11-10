// The Pipeline tab and the Pipeline section of the sidebar (worfy-pipeline ticket 04), over snapshots
// of `pipeline.get` built the way main builds them (src/main/workflow/stages.ts): the columns from a
// Pipeline with stageId and stageLabel, the Stage of each Ticket from its facts with stageOf.
// - the board (src/renderer/pipeline/PipelineBoard.tsx): a column per Stage of the Project's
//   Pipeline, in its order — worfy's and Atalaya's from the spec; Done folded into a count that a
//   click opens; on a card the Ticket, its title, who it waits for, `blocked` with the reason,
//   `rework` and the caption of its Stage; a click shows the Ticket's Card on the Canvas; a
//   `pipeline.changed` moves a card without a reload;
// - the section (src/renderer/shell/sidebar/PipelineSection.tsx): the Tickets in work of every
//   Project, neither Queued nor Done, with the Stage and who they wait for; "Nothing in work" when
//   there are none; a click opens the board of that Project.
// jsdom lays nothing out: the columns side by side and both themes are checked against the built
// app (test/e2e/pipeline.spec.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import type { PrInboxRow, PrInboxSnapshot, PrInboxThread } from '../../src/shared/ipc/pr-inbox'
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

/** Atalaya (Silent mode): Queued → Implementing → Agent review → CI → Human review → Awaiting merge → Done. */
const ATALAYA: PipelineStage[] = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'agent-review' },
  { kind: 'ci' },
  { kind: 'human-review' },
  { kind: 'awaiting-merge' },
  { kind: 'done' },
]

const WORFY_ROOT = '/projects/worfy'
const ATALAYA_ROOT = '/projects/atalaya'
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
  'atalaya/3': 'Login page',
  'atalaya/9': 'Reports export',
}

const worfyModel = (): WorkflowModel =>
  modelOf(
    WORFY_ROOT,
    Object.entries(TITLES)
      .filter(([key]) => key.startsWith('worfy-pipeline/'))
      .map(([key, title]) => modelTicket('worfy-pipeline', Number(key.split('/')[1]), title)),
  )

const atalayaSnapshot = (): PipelineSnapshot =>
  snapshotOf(ATALAYA_ROOT, ATALAYA, [
    ticket('atalaya', 3, ATALAYA, { mode: 'silent', status: 'work', headSha: HEAD, marks: [{ kind: 'review', verdict: 'success', sha: HEAD, at: null }], pr: { ...openPr(), reviewDecision: null } }),
    ticket('atalaya', 9, ATALAYA, { mode: 'silent' }),
  ])

const atalayaModel = (): WorkflowModel => modelOf(ATALAYA_ROOT, [modelTicket('atalaya', 3, TITLES['atalaya/3']!), modelTicket('atalaya', 9, TITLES['atalaya/9']!)])

const appSettings = (): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
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
    { id: 'atalaya-00000002', name: 'atalaya', path: ATALAYA_ROOT, branch: 'main' },
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

  it("has Atalaya's columns in Atalaya's order, a label of the Profile replacing the catalogue's name", async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    const pipeline = ATALAYA.map((stage) => (stage.kind === 'human-review' ? { ...stage, label: 'Team review' } : stage))
    render(<PipelineBoardView name="atalaya" snapshot={snapshotOf(ATALAYA_ROOT, pipeline, atalayaSnapshot().tickets)} titles={{}} onOpenTicket={() => undefined} />)
    expect(columnTitles()).toEqual(['Queued', 'Implementing', 'Agent review', 'CI', 'Team review', 'Awaiting merge', 'Done'])
    // Agent review passed, the PR's CI is green: Atalaya 03 stands on Human review, waiting for the team.
    expect(columnOf(cardOf('atalaya', 3))).toBe('human-review')
    expect(within(cardOf('atalaya', 3)).getByTestId('pipeline-waits').textContent).toBe('Waits: team')
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
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATALAYA_ROOT]: atalayaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATALAYA_ROOT]: atalayaModel() } })
    const { default: PipelineSection } = await import('../../src/renderer/shell/sidebar/PipelineSection')
    render(<PipelineSection />)
    await waitFor(() => expect(screen.getAllByTestId('pipeline-row')).toHaveLength(4))
    expect(rows()).toEqual([
      { project: 'worfy-00000001', ref: 'worfy-pipeline 04', stage: 'Implementing', waits: 'Waits: owner' },
      { project: 'worfy-00000001', ref: 'worfy-pipeline 05', stage: 'Implementing', waits: 'Waits: agent' },
      { project: 'worfy-00000001', ref: 'worfy-pipeline 06', stage: 'CI', waits: 'Waits: agent' },
      { project: 'atalaya-00000002', ref: 'atalaya 03', stage: 'Human review', waits: 'Waits: team' },
    ])
    // Each Project under its name; the titles come from the workflow model.
    expect(screen.getByText('worfy')).toBeTruthy()
    expect(screen.getByText('atalaya')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Login page')).toBeTruthy())
    // The blocked one says so on its chip.
    const blocked = screen.getAllByTestId('pipeline-row')[0]!
    expect(within(blocked).getByTestId('pipeline-stage').querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked')
    expect(screen.getAllByTestId('pipeline-row')[1]!.querySelector('[data-status]')?.getAttribute('data-status')).toBe('working')
    expect(screen.queryByText('Nothing in work')).toBeNull()
  })

  it('says "Nothing in work" when no Project has a Ticket in work', async () => {
    const idle = snapshotOf(WORFY_ROOT, WORFY, [ticket('worfy-pipeline', 1, WORFY, { status: 'done' }), ticket('worfy-pipeline', 2, WORFY)])
    const idleAtalaya = snapshotOf(ATALAYA_ROOT, ATALAYA, [ticket('atalaya', 9, ATALAYA, { mode: 'silent' })])
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: idle, [ATALAYA_ROOT]: idleAtalaya }, models: { [WORFY_ROOT]: worfyModel(), [ATALAYA_ROOT]: atalayaModel() } })
    const { default: PipelineSection } = await import('../../src/renderer/shell/sidebar/PipelineSection')
    render(<PipelineSection />)
    expect(await screen.findByText('Nothing in work')).toBeTruthy()
    expect(screen.queryAllByTestId('pipeline-row')).toHaveLength(0)
    // A Ticket that goes into work shows up without a reload, and the empty line goes.
    const claimed = snapshotOf(ATALAYA_ROOT, ATALAYA, [ticket('atalaya', 9, ATALAYA, { mode: 'silent', status: 'work' })])
    act(() => main.emit('pipeline.changed', claimed))
    expect(rows()).toEqual([{ project: 'atalaya-00000002', ref: 'atalaya 09', stage: 'Implementing', waits: 'Waits: agent' }])
    expect(screen.queryByText('Nothing in work')).toBeNull()
  })

  it("opens the Pipeline board of a clicked row's Project", async () => {
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATALAYA_ROOT]: atalayaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATALAYA_ROOT]: atalayaModel() } })
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
    fireEvent.click(screen.getAllByTestId('pipeline-row').find((row) => row.dataset.project === 'atalaya-00000002')!)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'atalaya-00000002' } })
    await waitFor(() => expect(active).toBe('atalaya-00000002'))

    // A row of the active Project switches the view and selects nothing.
    useNavigation.setState({ view: 'session' })
    const selects = main.calls.filter((call) => call.channel === 'projects.select').length
    fireEvent.click(screen.getAllByTestId('pipeline-row').find((row) => row.dataset.project === 'atalaya-00000002')!)
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
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATALAYA_ROOT]: atalayaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATALAYA_ROOT]: atalayaModel() } })
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
    preload({ projects: PROJECTS, pipelines: { [WORFY_ROOT]: worfySnapshot(), [ATALAYA_ROOT]: atalayaSnapshot() }, models: { [WORFY_ROOT]: worfyModel(), [ATALAYA_ROOT]: atalayaModel() } })
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
      answers: { 'sessions.views': () => ({ views: [] }), 'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: ATALAYA_ROOT, epic: 'atalaya', num: 3 } }) },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    expect(useNavigation.getState().view).toBe('canvas')
    render(<NotificationTarget />)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'atalaya-00000002' } })
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

describe('one card for a Ticket over several repositories (worfy-multi-repo-ticket 06, ADR-0104)', () => {
  /** A Silent Project whose consumer waits for the library's release: Release stands before Awaiting merge. */
  const TEAM: PipelineStage[] = [
    { kind: 'queued' },
    { kind: 'implementing' },
    { kind: 'agent-review' },
    { kind: 'ci' },
    { kind: 'human-review' },
    { kind: 'release' },
    { kind: 'awaiting-merge' },
    { kind: 'done' },
  ]
  const TEAM_ROOT = '/projects/team'
  const LIB_HEAD = 'b'.repeat(40)
  const APP_HEAD = 'c'.repeat(40)
  const green: CheckFact = { name: 'ci', state: 'success', startedAt: '2026-11-09T10:00Z', completedAt: '2026-11-09T10:05Z' }
  const red: CheckFact = { ...green, state: 'failure' }
  const pullOf = (number: number, state: 'OPEN' | 'MERGED', headSha: string, checks: readonly CheckFact[] = [green]): NonNullable<StageFacts['pr']> => ({
    number,
    state,
    headSha: state === 'OPEN' ? headSha : null,
    checks,
    reviewDecision: 'APPROVED',
    mergedAt: state === 'MERGED' ? '2026-11-09T12:00Z' : null,
    mergeCommit: state === 'MERGED' ? 'd'.repeat(40) : null,
  })
  /** One repository of the Ticket: its PR (or none) and a verified review on the head of its branch. */
  const repoOf = (repo: string, headSha: string, pr: StageFacts['pr'], reviewed = true): NonNullable<StageFacts['repos']>[number] => ({
    repo,
    headSha,
    pr,
    marks: reviewed ? [{ kind: 'review', verdict: 'success', sha: headSha, at: '2026-11-09T11:00Z' }] : [],
    deploys: [],
  })
  const LINE = { repo: 'lib', kind: 'tag', ref: 'lib-v1.4.0' }
  const twoRepos = (lib: StageFacts['pr'], app: StageFacts['pr'], release: 'waiting' | 'released' | 'not checked' | null = 'waiting', change: Partial<StageFacts> = {}): PipelineTicket =>
    ticket('team', 4, TEAM, {
      mode: 'silent',
      status: 'work',
      repos: [repoOf('lib', LIB_HEAD, lib), repoOf('app', APP_HEAD, app)],
      ...(release === null ? {} : { releases: [{ ...LINE, state: release }] }),
      ...change,
    })
  const board = async (...tickets: PipelineTicket[]) => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="team" snapshot={snapshotOf(TEAM_ROOT, TEAM, tickets)} titles={{}} onOpenTicket={() => undefined} />)
  }
  const rowsOf = (card: HTMLElement) => within(card).queryAllByTestId('pipeline-pr')

  it('a card with two PRs has a row per PR named by its repository, and «1/2 merged» once one of them is merged', async () => {
    await board(twoRepos(pullOf(41, 'OPEN', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD)))
    expect(screen.getAllByTestId('pipeline-card')).toHaveLength(1)
    let card = cardOf('team', 4)
    expect(rowsOf(card).map((row) => row.textContent)).toEqual(['lib #41 · open', 'app #118 · open'])
    expect(rowsOf(card).map((row) => [row.dataset.repo, row.dataset.state])).toEqual([
      ['lib', 'OPEN'],
      ['app', 'OPEN'],
    ])
    // Nothing merged yet: no count.
    expect(within(card).queryByTestId('pipeline-merged')).toBeNull()
    cleanup()

    await board(twoRepos(pullOf(41, 'MERGED', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD)))
    card = cardOf('team', 4)
    expect(rowsOf(card).map((row) => row.textContent)).toEqual(['lib #41 · merged', 'app #118 · open'])
    expect(rowsOf(card)[0]!.dataset.state).toBe('MERGED')
    expect(within(card).getByTestId('pipeline-merged').textContent).toBe('1/2 merged')
    // Half merged is in work, not an accident (ADR-0104, item 8): the card stands where the consumer stands.
    expect(columnOf(card)).toBe('release')
  })

  it('the card stands on the Stage of the repository furthest behind, and each row says where its own repository stands', async () => {
    // The library is approved and waits for its merge; the consumer still waits for the agents' review.
    await board(twoRepos(pullOf(41, 'OPEN', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD), null, { repos: [repoOf('lib', LIB_HEAD, pullOf(41, 'OPEN', LIB_HEAD)), repoOf('app', APP_HEAD, pullOf(118, 'OPEN', APP_HEAD), false)] }))
    const card = cardOf('team', 4)
    expect(columnOf(card)).toBe('agent-review')
    expect(rowsOf(card).map((row) => row.dataset.stage)).toEqual(['awaiting-merge', 'agent-review'])
    expect(rowsOf(card).map((row) => row.title)).toEqual(['lib: Awaiting merge', 'app: Agent review'])
  })

  it('a closed PR reads «closed» on its row', async () => {
    const closed: NonNullable<StageFacts['pr']> = { ...pullOf(41, 'OPEN', LIB_HEAD), state: 'CLOSED', headSha: null }
    await board(twoRepos(closed, pullOf(118, 'OPEN', APP_HEAD), null))
    expect(rowsOf(cardOf('team', 4)).map((row) => [row.textContent, row.dataset.state])).toEqual([
      ['lib #41 · closed', 'CLOSED'],
      ['app #118 · open', 'OPEN'],
    ])
  })

  it('a row has a flag only for failing: another caption of its repository is in its tooltip alone', async () => {
    // Gate & merge with the e2e lock held by lib's PR: lib's own caption is «gate running».
    const GATED: PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'agent-review' }, { kind: 'ci' }, { kind: 'gate-merge' }, { kind: 'done' }]
    const gated = ticket('team', 4, GATED, {
      mode: 'silent',
      status: 'work',
      lock: { prs: [41] },
      repos: [repoOf('lib', LIB_HEAD, pullOf(41, 'OPEN', LIB_HEAD)), repoOf('app', APP_HEAD, pullOf(118, 'OPEN', APP_HEAD), false)],
    })
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="team" snapshot={snapshotOf(TEAM_ROOT, GATED, [gated])} titles={{}} onOpenTicket={() => undefined} />)
    const [lib, app] = rowsOf(cardOf('team', 4))
    expect(lib!.dataset.stage).toBe('gate-merge')
    expect(lib!.title).toBe('lib: Gate & merge, gate running')
    expect(within(lib!).queryByTestId('pipeline-pr-sub')).toBeNull()
    expect(within(app!).queryByTestId('pipeline-pr-sub')).toBeNull()
  })

  it('the row’s failing flag stays whole and a release line wraps, on the narrow board column', async () => {
    await board(twoRepos(pullOf(41, 'OPEN', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD, [red]), null))
    expect(within(cardOf('team', 4)).getByTestId('pipeline-pr-sub').classList.contains('w-pipeline-flag--whole')).toBe(true)
    cleanup()
    await board(twoRepos(pullOf(41, 'MERGED', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD), 'not checked'))
    expect(within(cardOf('team', 4)).getByTestId('pipeline-release').classList.contains('w-pipeline-flag--wrap')).toBe(true)
    // The stylesheet: after `.w-pipeline-flag`, the one keeps its width, the other wraps and ends in no «…».
    const sheet = readFileSync(join(import.meta.dirname, '../../src/renderer/pipeline/pipeline.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    const body = (selector: string) => {
      const at = sheet.indexOf(`${selector} {`)
      expect(at, selector).toBeGreaterThan(sheet.indexOf('.w-pipeline-flag {'))
      return sheet.slice(at, sheet.indexOf('}', at))
    }
    expect(body('.w-pipeline-flag--whole')).toMatch(/flex\s*:\s*none/u)
    expect(body('.w-pipeline-flag--whole')).toMatch(/overflow\s*:\s*visible/u)
    expect(body('.w-pipeline-flag--wrap')).toMatch(/white-space\s*:\s*normal/u)
    expect(body('.w-pipeline-flag--wrap')).toMatch(/overflow\s*:\s*visible/u)
    expect(body('.w-pipeline-flag--wrap')).toMatch(/height\s*:\s*auto/u)
  })

  it('a repository without a PR yet has a row that says so', async () => {
    await board(twoRepos(pullOf(41, 'OPEN', LIB_HEAD), null, null))
    expect(rowsOf(cardOf('team', 4)).map((row) => [row.textContent, row.dataset.state])).toEqual([
      ['lib #41 · open', 'OPEN'],
      ['app · no PR', 'none'],
    ])
  })

  it('names the PR whose CI is red on its own row; the card has the Ticket’s «failing» too', async () => {
    await board(twoRepos(pullOf(41, 'OPEN', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD, [red]), null))
    const card = cardOf('team', 4)
    expect(columnOf(card)).toBe('ci')
    expect(within(card).getByTestId('pipeline-sub').textContent).toBe('failing')
    const [lib, app] = rowsOf(card)
    expect(within(lib!).queryByTestId('pipeline-pr-sub')).toBeNull()
    expect(within(app!).getByTestId('pipeline-pr-sub').textContent).toBe('failing')
    expect(app!.title).toBe('app: CI, failing')
  })

  it('the Stage release: «waits for release <version>» while the line is not met, nothing once it is released', async () => {
    await board(twoRepos(pullOf(41, 'MERGED', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD)))
    let card = cardOf('team', 4)
    expect(columnOf(card)).toBe('release')
    expect(within(card).getAllByTestId('pipeline-release').map((flag) => flag.textContent)).toEqual(['waits for release lib-v1.4.0'])
    expect(within(card).getByTestId('pipeline-release').className).toContain('w-pipeline-flag--working')
    cleanup()

    await board(twoRepos(pullOf(41, 'MERGED', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD), 'released'))
    card = cardOf('team', 4)
    expect(columnOf(card)).toBe('awaiting-merge')
    expect(within(card).queryByTestId('pipeline-release')).toBeNull()
    expect(within(card).getByTestId('pipeline-merged').textContent).toBe('1/2 merged')
  })

  it('of two Release: lines, only the one not met yet is shown while the consumer waits', async () => {
    const releases: StageFacts['releases'] = [
      { ...LINE, state: 'released' },
      { repo: 'lib', kind: 'package', ref: '@team/lib@1.4.0', state: 'waiting' },
    ]
    await board(twoRepos(pullOf(41, 'MERGED', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD), null, { releases }))
    const card = cardOf('team', 4)
    expect(columnOf(card)).toBe('release')
    expect(within(card).getAllByTestId('pipeline-release').map((flag) => flag.textContent)).toEqual(['waits for release @team/lib@1.4.0'])
  })

  it('a release worfy could not check says so, as a flag that needs attention', async () => {
    await board(twoRepos(pullOf(41, 'MERGED', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD), 'not checked'))
    const flag = within(cardOf('team', 4)).getByTestId('pipeline-release')
    expect(flag.textContent).toBe('release lib-v1.4.0 not checked')
    expect(flag.className).toContain('w-pipeline-flag--attention')
  })

  it('the consumer waits on release while the library is still open: the line shows, though the Ticket stands earlier', async () => {
    // The library waits for the agents' review; the consumer has passed everything up to the release.
    const facts: Partial<StageFacts> = { repos: [repoOf('lib', LIB_HEAD, pullOf(41, 'OPEN', LIB_HEAD), false), repoOf('app', APP_HEAD, pullOf(118, 'OPEN', APP_HEAD))] }
    await board(twoRepos(null, null, 'waiting', facts))
    const card = cardOf('team', 4)
    expect(columnOf(card)).toBe('agent-review')
    expect(rowsOf(card).map((row) => row.dataset.stage)).toEqual(['agent-review', 'release'])
    expect(within(card).getByTestId('pipeline-release').textContent).toBe('waits for release lib-v1.4.0')
  })

  it('no repository on release: the line is not shown before its time', async () => {
    const facts: Partial<StageFacts> = { repos: [repoOf('lib', LIB_HEAD, pullOf(41, 'OPEN', LIB_HEAD), false), repoOf('app', APP_HEAD, pullOf(118, 'OPEN', APP_HEAD), false)] }
    await board(twoRepos(null, null, 'waiting', facts))
    const card = cardOf('team', 4)
    expect(columnOf(card)).toBe('agent-review')
    expect(within(card).queryByTestId('pipeline-release')).toBeNull()
  })

  it('a Ticket with one PR looks as before: no rows, no count, no release line of its own repository', async () => {
    const one = ticket('team', 5, TEAM, {
      mode: 'silent',
      status: 'work',
      repo: 'lib',
      headSha: LIB_HEAD,
      pr: pullOf(41, 'OPEN', LIB_HEAD),
      marks: [{ kind: 'review', verdict: 'success', sha: LIB_HEAD, at: '2026-11-09T11:00Z' }],
      releases: [{ ...LINE, state: 'waiting' }],
    })
    expect(one.prs).toBeUndefined()
    expect(one.merged).toBeUndefined()
    await board(one, ticket('team', 6, TEAM, { mode: 'silent' }))
    for (const num of [5, 6]) {
      const card = cardOf('team', num)
      expect(within(card).queryByTestId('pipeline-repos')).toBeNull()
      expect(within(card).queryByTestId('pipeline-pr')).toBeNull()
      expect(within(card).queryByTestId('pipeline-merged')).toBeNull()
      expect(within(card).queryByTestId('pipeline-release')).toBeNull()
    }
    // The library does not wait for its own release: it stands on Awaiting merge, its card as it was.
    expect(columnOf(cardOf('team', 5))).toBe('awaiting-merge')
    expect(cardOf('team', 5).textContent).toBe('team 05Waits: team')
  })

  it('a card from a Linked machine’s older worfy, with «merged» but no rows, still shows the count', async () => {
    const older = { ...twoRepos(pullOf(41, 'MERGED', LIB_HEAD), pullOf(118, 'OPEN', APP_HEAD), null) }
    delete older.prs
    await board(older)
    const card = cardOf('team', 4)
    expect(rowsOf(card)).toEqual([])
    expect(within(card).getByTestId('pipeline-merged').textContent).toBe('1/2 merged')
  })
})

describe('«Waits: N answers» on a card on Human review (worfy-pr-inbox ticket 06)', () => {
  const REPO = 'example-org/app'
  const ME = 'dev-me'
  const PEER = 'dev-peer'
  let id = 0
  /** An unresolved thread whose comments are by `authors`, oldest first. */
  const thread = (...authors: string[]): PrInboxThread => ({
    id: `T${++id}`,
    isResolved: false,
    isOutdated: false,
    path: 'src/a.ts',
    line: 1,
    viewerCanReply: true,
    comments: authors.map((author) => ({ id: `C${++id}`, databaseId: id, author, body: 'a question', createdAt: '2026-11-09T10:00:00Z', url: 'https://github.com/x' })),
  })
  /** The PR inbox of the Project: PR #7 on atalaya/03's branch with two threads waiting for the user and one the user answered. */
  const inbox = (rows: PrInboxRow[] = [inboxRow(7, 'atalaya/03', [thread(PEER), thread(PEER, ME, PEER), thread(PEER, ME)])]): PrInboxSnapshot => ({
    projectId: 'atalaya-00000002',
    enabled: true,
    viewer: ME,
    groups: [
      { group: 'needs-review', rows: [] },
      { group: 'needs-answer', rows },
      { group: 'needs-fix', rows: [] },
      { group: 'ready', rows: [] },
      { group: 'waiting', rows: [] },
    ],
    readAt: '2026-11-09T10:00:00Z',
    nextSearchAt: '2026-11-09T10:05:00Z',
    error: null,
    notice: null,
  })
  function inboxRow(number: number, branch: string, threads: PrInboxThread[]): PrInboxRow {
    return {
      repo: REPO,
      number,
      title: `PR ${number}`,
      url: `https://github.com/${REPO}/pull/${number}`,
      isDraft: false,
      author: ME,
      headRefName: branch,
      headRefOid: `sha${number}`,
      createdAt: '2026-11-08T10:00:00Z',
      updatedAt: '2026-11-09T10:00:00Z',
      ci: 'passing',
      reviewDecision: null,
      mergeStateStatus: 'CLEAN',
      viaTeam: false,
      unresolvedThreads: threads.length,
      newSinceSeen: 0,
      lastActivityAt: '2026-11-09T10:00:00Z',
      threads,
      comments: [],
    }
  }
  const ATALAYA_PROJECT = PROJECTS.projects[1]!

  it('the board of a Project whose PR inbox holds the PR of a Ticket on Human review: «Waits: 2 answers» beside «Waits: team»', async () => {
    preload({ projects: PROJECTS, pipelines: { [ATALAYA_ROOT]: atalayaSnapshot() }, models: { [ATALAYA_ROOT]: atalayaModel() }, answers: { 'prInbox.get': () => inbox() } })
    const { PipelineBoard } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoard project={ATALAYA_PROJECT} />)
    await waitFor(() => expect(within(cardOf('atalaya', 3)).getByTestId('pipeline-answers').textContent).toBe('Waits: 2 answers'))
    expect(columnOf(cardOf('atalaya', 3))).toBe('human-review')
    expect(within(cardOf('atalaya', 3)).getByTestId('pipeline-waits').textContent).toBe('Waits: team')
    expect(main.calls.filter((call) => call.channel === 'prInbox.get')).toEqual([{ channel: 'prInbox.get', input: { projectId: 'atalaya-00000002' } }])
  })

  it('one thread: «Waits: 1 answer»', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    render(<PipelineBoardView name="atalaya" snapshot={atalayaSnapshot()} titles={{}} answers={{ 'atalaya/3': 1 }} onOpenTicket={() => undefined} />)
    expect(within(cardOf('atalaya', 3)).getByTestId('pipeline-answers').textContent).toBe('Waits: 1 answer')
  })

  it('on any other Stage the card has no such line, whatever its PR waits for', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    const answers = { 'atalaya/3': 2, 'atalaya/9': 4, 'worfy-pipeline/6': 3, 'worfy-pipeline/4': 1 }
    render(
      <>
        <PipelineBoardView name="atalaya" snapshot={atalayaSnapshot()} titles={{}} answers={answers} onOpenTicket={() => undefined} />
        <PipelineBoardView name="worfy" snapshot={worfySnapshot()} titles={{}} answers={answers} onOpenTicket={() => undefined} />
      </>,
    )
    expect(columnOf(cardOf('atalaya', 9))).toBe('queued')
    expect(within(cardOf('atalaya', 9)).queryByTestId('pipeline-answers')).toBeNull()
    expect(within(cardOf('worfy-pipeline', 6)).queryByTestId('pipeline-answers')).toBeNull()
    expect(within(cardOf('worfy-pipeline', 4)).queryByTestId('pipeline-answers')).toBeNull()
    expect(screen.getAllByTestId('pipeline-answers')).toHaveLength(1)
  })

  it('a Ticket whose PR the inbox does not hold, or whose threads all have the user’s last word: the card as before', async () => {
    const { PipelineBoardView } = await import('../../src/renderer/pipeline/PipelineBoard')
    const { answersOf } = await import('../../src/renderer/pipeline/board')
    render(<PipelineBoardView name="atalaya" snapshot={atalayaSnapshot()} titles={{}} onOpenTicket={() => undefined} />)
    const before = cardOf('atalaya', 3).innerHTML
    expect(within(cardOf('atalaya', 3)).queryByTestId('pipeline-answers')).toBeNull()
    cleanup()
    for (const snapshot of [inbox([]), inbox([inboxRow(7, 'atalaya/03', [thread(PEER, ME)])]), inbox([inboxRow(8, 'other/01', [thread(PEER)])]), undefined]) {
      const answers = answersOf(snapshot, atalayaModel())
      expect(answers).toEqual({})
      render(<PipelineBoardView name="atalaya" snapshot={atalayaSnapshot()} titles={{}} answers={answers} onOpenTicket={() => undefined} />)
      expect(cardOf('atalaya', 3).innerHTML).toBe(before)
      cleanup()
    }
  })

  it('a Ticket over several repositories: the threads of all its PRs summed', async () => {
    const { answersOf } = await import('../../src/renderer/pipeline/board')
    const model = modelOf(ATALAYA_ROOT, [{ ...modelTicket('atalaya', 3, 'Login page'), repos: ['app', 'lib'], prs: [{ repo: 'app', number: 7 }] }])
    const lib = { ...inboxRow(41, 'atalaya/03', [thread(PEER)]), repo: 'example-org/lib' }
    expect(answersOf(inbox([inboxRow(7, 'feature/x', [thread(PEER), thread(PEER)]), lib]), model)).toEqual({ 'atalaya/3': 3 })
  })
})
