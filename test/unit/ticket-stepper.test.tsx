// The stepper of Stages on a Ticket's Card (src/renderer/pipeline/Stepper.tsx, worfy-pipeline ticket 05):
// a dot per Stage of the Project's Pipeline — passed, current, future, a Check passed by a `skipped`
// mark — the current Stage's name and who the Ticket waits for, the `blocked` flag with its reason in
// the tooltip, `rework` on Implementing, and on a narrow Card only the current Stage and «N/M». The
// Card (TicketNode.tsx) draws it from the `pipeline.get` snapshot in place of the status word.
import { act, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { PipelineColumn, PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import { stageId, stageLabel, type PipelineStage } from '../../src/shared/workflow/pipeline'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import Stepper from '../../src/renderer/pipeline/Stepper'
import TicketNode from '../../src/renderer/canvas/nodes/TicketNode'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { buildEpicNodes } from '../../src/renderer/canvas/sources/epics'

// The badges and actions on a Ticket are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

const columns = (stages: PipelineStage[]): PipelineColumn[] => stages.map((stage) => ({ ...stage, id: stageId(stage), title: stageLabel(stage) }))

/** The Pipeline of worfy (spec.md, owner's decision 4). */
const WORFY = columns([
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'ci' },
  { kind: 'agent-review' },
  { kind: 'check', name: 'windows' },
  { kind: 'gate-merge' },
  { kind: 'deploy' },
  { kind: 'closing' },
  { kind: 'done' },
])

/** The Pipeline of Atakama, Silent mode: the agent reviews before the PR, people merge. */
const ATAKAMA = columns([
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'agent-review' },
  { kind: 'ci' },
  { kind: 'human-review', label: 'Team review' },
  { kind: 'awaiting-merge' },
  { kind: 'done' },
])

/** A Ticket on Stage `id` of `pipeline`, every Stage before it passed. */
function on(pipeline: PipelineColumn[], id: string, over: Partial<PipelineTicket> = {}): PipelineTicket {
  const index = pipeline.findIndex((column) => column.id === id)
  if (index < 0) throw new Error(`${id} is not in the Pipeline`)
  return {
    epic: 'demo',
    num: 8,
    stage: id,
    index,
    kind: pipeline[index]!.kind,
    passed: pipeline.slice(0, index).map((column) => column.id),
    skipped: [],
    blocked: null,
    rework: false,
    sub: null,
    waits: pipeline[index]!.kind === 'done' ? null : 'agent',
    enteredAt: null,
    ...over,
  }
}

const dots = () => [...screen.getByTestId('ticket-stepper').querySelectorAll<HTMLElement>('[data-step]')].map((dot) => [dot.dataset.step, dot.dataset.state])

describe('Stepper', () => {
  it('worfy on CI: a dot per Stage, passed ones before, the current one, then the future ones; the caption names the Stage and who it waits for', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'ci')} />)
    expect(dots()).toEqual([
      ['queued', 'passed'],
      ['implementing', 'passed'],
      ['ci', 'current'],
      ['agent-review', 'future'],
      ['check/windows', 'future'],
      ['gate-merge', 'future'],
      ['deploy', 'future'],
      ['closing', 'future'],
      ['done', 'future'],
    ])
    expect(screen.getByTestId('stepper-label').textContent).toBe('CI')
    expect(screen.getByTestId('stepper-waits').textContent).toBe('agent')
    const stepper = screen.getByTestId('ticket-stepper')
    expect(stepper.dataset.stage).toBe('ci')
    expect(stepper.title).toBe('CI · waits for agent · Stage 3 of 9')
  })

  it('worfy on Gate & merge with Check «windows» skipped: that dot is drawn skipped, not passed; the caption says why it waits', () => {
    const stage = on(WORFY, 'gate-merge', { skipped: ['check/windows'], sub: 'waiting for gate' })
    render(<Stepper pipeline={WORFY} stage={stage} />)
    expect(dots().slice(3, 6)).toEqual([
      ['agent-review', 'passed'],
      ['check/windows', 'skipped'],
      ['gate-merge', 'current'],
    ])
    expect(screen.getByTestId('stepper-label').textContent).toBe('Gate & merge')
    expect(screen.getByTestId('ticket-stepper').title).toBe('Gate & merge · waiting for gate · waits for agent · Stage 6 of 9\nskipped: Check «windows»')
  })

  it('Atakama: its own order and labels; Human review waits for the team', () => {
    render(<Stepper pipeline={ATAKAMA} stage={on(ATAKAMA, 'human-review', { waits: 'team' })} />)
    expect(dots().map(([step]) => step)).toEqual(['queued', 'implementing', 'agent-review', 'ci', 'human-review', 'awaiting-merge', 'done'])
    expect(dots()[4]).toEqual(['human-review', 'current'])
    expect(screen.getByTestId('stepper-label').textContent).toBe('Team review')
    expect(screen.getByTestId('stepper-waits').textContent).toBe('team')
  })

  it('a Waits: line names whom else the Ticket waits for: the owner, a Machine', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'check/windows', { waits: 'owner' })} />)
    expect(screen.getByTestId('stepper-waits').textContent).toBe('owner')
    expect(screen.getByTestId('stepper-label').textContent).toBe('Check «windows»')
  })

  it('blocked: a flag on the current step, its reason in the tooltip', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'agent-review', { blocked: { reason: 'needs Stripe test keys' }, waits: 'owner' })} />)
    expect(dots()[3]).toEqual(['agent-review', 'current'])
    const current = screen.getByTestId('ticket-stepper').querySelector<HTMLElement>('[data-step="agent-review"]')!
    expect(current.dataset.blocked).toBe('true')
    expect(screen.getByTestId('stepper-blocked').title).toBe('blocked: needs Stripe test keys')
    expect(screen.getByTestId('ticket-stepper').title).toBe('Agent review · waits for owner · Stage 4 of 9\nblocked: needs Stripe test keys')
  })

  it('blocked without a reason says so', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing', { blocked: { reason: null } })} />)
    expect(screen.getByTestId('stepper-blocked').title).toBe('blocked: no reason given')
  })

  it('rework: Implementing again after a failed review, marked on that step', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing', { rework: true })} />)
    const current = screen.getByTestId('ticket-stepper').querySelector<HTMLElement>('[data-step="implementing"]')!
    expect(current.dataset.state).toBe('current')
    expect(current.dataset.rework).toBe('true')
    expect(screen.getByTestId('stepper-rework').getAttribute('aria-label')).toBe('rework')
    expect(screen.getByTestId('ticket-stepper').title).toBe('Implementing · rework · waits for agent · Stage 2 of 9')
  })

  it('without blocked or rework there is no flag', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'ci')} />)
    expect(screen.queryByTestId('stepper-blocked')).toBeNull()
    expect(screen.queryByTestId('stepper-rework')).toBeNull()
  })

  it('Done: every dot before it passed, the last one current, nobody waited for', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'done')} />)
    expect(dots().at(-1)).toEqual(['done', 'current'])
    expect(dots().slice(0, -1).every(([, state]) => state === 'passed')).toBe(true)
    expect(screen.queryByTestId('stepper-waits')).toBeNull()
    expect(screen.getByTestId('ticket-stepper').title).toBe('Done · Stage 9 of 9')
  })

  it('narrow: only the current Stage and «N/M», no dots and no one waited for; the tooltip keeps everything', () => {
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'agent-review', { rework: false, blocked: { reason: 'x' } })} narrow />)
    const stepper = screen.getByTestId('ticket-stepper')
    expect(stepper.dataset.narrow).toBe('true')
    expect(stepper.querySelectorAll('[data-step]')).toHaveLength(0)
    expect(screen.getByTestId('stepper-label').textContent).toBe('Agent review')
    expect(screen.getByTestId('stepper-count').textContent).toBe('4/9')
    expect(screen.queryByTestId('stepper-waits')).toBeNull()
    // The blocked flag stays: it is a fact about the current Stage.
    expect(screen.getByTestId('stepper-blocked')).toBeTruthy()
    expect(stepper.title).toBe('Agent review · waits for agent · Stage 4 of 9\nblocked: x')
  })

  it('narrow Atakama on its last Stage: 7/7', () => {
    render(<Stepper pipeline={ATAKAMA} stage={on(ATAKAMA, 'done')} narrow />)
    expect(screen.getByTestId('stepper-count').textContent).toBe('7/7')
  })

  it('Done carries the check of the done chip (F-SPEC); no other Stage does', () => {
    const { unmount } = render(<Stepper pipeline={WORFY} stage={on(WORFY, 'done')} />)
    expect(screen.getByTestId('stepper-label').querySelectorAll('svg')).toHaveLength(1)
    expect(screen.getByTestId('stepper-label').textContent).toBe('Done')
    unmount()
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'closing')} />)
    expect(screen.getByTestId('stepper-label').querySelector('svg')).toBeNull()
  })
})

// ── the full form only when it fits ─────────────────────────────────────────

describe('Stepper measures whether the full form fits', () => {
  /**
   * The box the stepper has, and what its full form needs; jsdom has no layout, so both are set
   * here, as the rectangles the stepper measures (fractional, like the browser's): an element's
   * own for its box, its parts' for what the full form needs, a Range over the name's text.
   */
  let room: number
  let need: (stepper: HTMLElement) => number
  let labelCut: boolean
  let labelNeeds = 80
  let observers: { callback: () => void }[]

  const rect = (width: number) => ({ width, height: 16, top: 0, left: 0, right: width, bottom: 16, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  const layout = () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('w-stepper')) return rect(room)
      if (this.classList.contains('w-stepper__label')) return rect(labelCut && this.closest('[data-narrow]') === null ? 40 : 80)
      // The parts of the stepper: the dots span what the full form needs, from the stepper's left edge.
      if (this.classList.contains('w-stepper__dots')) return rect(need(this.closest<HTMLElement>('.w-stepper')!))
      return rect(0)
    })
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let contents: Node | null = null
      return {
        selectNodeContents: (node: Node) => {
          contents = node
        },
        getBoundingClientRect: () => {
          const element = contents as HTMLElement
          if (element.classList.contains('w-stepper__label')) return rect(labelNeeds)
          // The whole text inside the stepper, who it waits for included, which is cut with «…» in its own box by design.
          if (element.classList.contains('w-stepper')) return rect(1000)
          return rect(0)
        },
      } as unknown as Range
    })
    observers = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(readonly callback: () => void) {
          observers.push(this)
        }
        observe() {}
        disconnect() {
          observers = observers.filter((each) => each !== this)
        }
      },
    )
  }
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    labelNeeds = 80
  })

  const stepper = () => screen.getByTestId('ticket-stepper')
  const isNarrow = () => stepper().dataset.narrow === 'true'

  it('nine Stages that do not fit the box: the narrow form with «N/M», though nobody asked for it', () => {
    room = 160
    need = () => 230
    labelCut = false
    layout()
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing', { rework: true, blocked: { reason: 'x' } })} />)
    expect(isNarrow()).toBe(true)
    expect(stepper().querySelectorAll('[data-step]')).toHaveLength(0)
    expect(screen.getByTestId('stepper-count').textContent).toBe('2/9')
    expect(screen.getByTestId('stepper-rework')).toBeTruthy()
    expect(screen.getByTestId('stepper-blocked')).toBeTruthy()
  })

  it('room enough: the full form with its dots, though the text of who it waits for runs past its own box', () => {
    room = 300
    need = () => 230
    labelCut = false
    layout()
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'ci')} />)
    expect(isNarrow()).toBe(false)
    expect(stepper().querySelectorAll('[data-step]')).toHaveLength(9)
    expect(screen.getByTestId('stepper-waits')).toBeTruthy()
  })

  it('the dots fit but the Stage\'s name would be cut: narrow', () => {
    room = 300
    need = () => 230
    labelCut = true
    layout()
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'check/windows')} />)
    expect(isNarrow()).toBe(true)
  })

  it('a change of the same Stage is measured again: Implementing fits, with rework and blocked it does not', () => {
    room = 180
    need = (element) => 150 + (element.querySelector('[data-testid="stepper-rework"]') ? 30 : 0) + (element.querySelector('[data-testid="stepper-blocked"]') ? 30 : 0)
    labelCut = false
    layout()
    const { rerender } = render(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing')} />)
    expect(isNarrow()).toBe(false)
    rerender(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing', { rework: true, blocked: { reason: 'x' } })} />)
    expect(isNarrow()).toBe(true)
    rerender(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing')} />)
    expect(isNarrow()).toBe(false)
  })

  it('the box widens: the full form again; narrows: the narrow one; the same width does not measure again', () => {
    room = 160
    need = () => 230
    labelCut = false
    layout()
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing')} />)
    expect(isNarrow()).toBe(true)
    expect(observers).toHaveLength(1)
    room = 300
    act(() => observers[0]!.callback())
    expect(isNarrow()).toBe(false)
    room = 160
    act(() => observers[0]!.callback())
    expect(isNarrow()).toBe(true)
    // A callback at the same width — the first one an observer gives, or one after a child changed — keeps the form.
    need = () => 100
    act(() => observers[0]!.callback())
    expect(isNarrow()).toBe(true)
  })

  // The round-2 review: «Queued» needed 42.66 px and got 42, and scrollWidth and clientWidth both read 50.
  it('the dots overrun the box by less than a pixel: narrow; exactly as wide as the box: full', () => {
    room = 200
    need = () => 200.3
    labelCut = false
    layout()
    const { unmount } = render(<Stepper pipeline={WORFY} stage={on(WORFY, 'ci')} />)
    expect(isNarrow()).toBe(true)
    unmount()
    need = () => 200
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'ci')} />)
    expect(isNarrow()).toBe(false)
  })

  it('the Stage\'s name is cut by less than a pixel: narrow', () => {
    room = 300
    need = () => 230
    labelCut = false
    labelNeeds = 80.3
    layout()
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'queued')} />)
    expect(isNarrow()).toBe(true)
  })

  it('the box narrows by less than a pixel: measured again, and the full form no longer fits', () => {
    room = 200
    need = () => 199.9
    labelCut = false
    layout()
    render(<Stepper pipeline={WORFY} stage={on(WORFY, 'ci')} />)
    expect(isNarrow()).toBe(false)
    room = 199.7
    act(() => observers[0]!.callback())
    expect(isNarrow()).toBe(true)
  })

  it('stops observing when the stepper is gone', () => {
    room = 160
    need = () => 230
    labelCut = false
    layout()
    const { unmount } = render(<Stepper pipeline={WORFY} stage={on(WORFY, 'implementing')} />)
    expect(observers).toHaveLength(1)
    unmount()
    expect(observers).toHaveLength(0)
  })
})

// ── on the Card ──────────────────────────────────────────────────────────────

const ROOT = '/repo'

function ticket(num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'demo',
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
    statusRaw: 'claimed 2026-10-17T09:41Z',
    state: 'work',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

let pipelineAnswer: () => Promise<unknown>
let pipelineCalls: unknown[]

function bridge(): void {
  pipelineCalls = []
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: unknown) => {
      if (channel === 'pipeline.get') {
        pipelineCalls.push(input)
        return pipelineAnswer()
      }
      if (channel === 'checks.repos') return Promise.resolve({ ok: true, value: { mode: 'full', repos: [{ name: 'repo', path: ROOT }] } })
      return Promise.resolve({ ok: true, value: { closed: true } })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
}

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

let project = 0
function renderCards(tickets: Ticket[]) {
  const model: WorkflowModel = { root: ROOT, epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets, error: null, branchErrors: [] }
  const nodes = buildEpicNodes(`p-stepper-${(project += 1)}`, ROOT, model, { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, {})
  return render(
    <ReactFlowProvider>
      {nodes
        .filter((node) => node.type === 'ticket')
        .map((node) => (
          <TicketNode key={node.id} {...({ id: node.id, data: node.data, selected: false } as unknown as CanvasNodeProps)} />
        ))}
    </ReactFlowProvider>,
  )
}

const card = (num: number) => screen.getAllByTestId('ticket-node').find((node) => node.dataset.ticket === String(num))!

describe('the stepper on a Ticket Card', () => {
  it('replaces the status word: aria-label «Ticket NN, <Stage>», the stepper from pipeline.get in the top row, no status chip', async () => {
    const snapshot: PipelineSnapshot = { root: ROOT, pipeline: WORFY, tickets: [on(WORFY, 'ci', { num: 8 }), on(WORFY, 'check/windows', { num: 9, waits: 'owner' })], error: null }
    pipelineAnswer = () => Promise.resolve({ ok: true, value: snapshot })
    bridge()
    renderCards([ticket(8), ticket(9)])
    await vi.waitFor(() => expect(card(8).getAttribute('aria-label')).toBe('Ticket 08, CI'))
    expect(card(9).getAttribute('aria-label')).toBe('Ticket 09, Check «windows»')
    const top = card(8).querySelector('.w-ticket__top')!
    expect(top.querySelector('[data-testid="ticket-stepper"]')).not.toBeNull()
    expect(top.querySelector('.w-chip[data-status]')).toBeNull()
    expect(card(8).textContent).not.toContain('claimed')
    // One question for the Project, however many Cards it has.
    expect(pipelineCalls).toEqual([{ root: ROOT }])
  })

  it('a Card in the ready Wave, with its «Ready» chip in the same row, draws the narrow stepper', async () => {
    const snapshot: PipelineSnapshot = { root: ROOT, pipeline: WORFY, tickets: [on(WORFY, 'queued', { num: 1, waits: 'agent' })], error: null }
    pipelineAnswer = () => Promise.resolve({ ok: true, value: snapshot })
    bridge()
    renderCards([ticket(1, { state: 'open', statusRaw: 'open' })])
    await vi.waitFor(() => expect(card(1).getAttribute('aria-label')).toBe('Ticket 01, Queued'))
    expect(card(1).dataset.ready).toBe('true')
    expect(screen.getByTestId('ticket-stepper').dataset.narrow).toBe('true')
    expect(screen.getByTestId('stepper-count').textContent).toBe('1/9')
  })

  it('until main has answered, or when pipeline.get fails, or when the snapshot does not name the Ticket: the status word, as before', async () => {
    let answer!: (value: unknown) => void
    pipelineAnswer = () => new Promise((resolve) => (answer = resolve))
    bridge()
    renderCards([ticket(8), ticket(9, { state: 'blocked', statusRaw: 'blocked 2026-10-17', blockedReason: 'keys' })])
    expect(card(8).getAttribute('aria-label')).toBe('Ticket 08, claimed')
    expect(card(8).querySelector('.w-chip[data-status="working"]')?.textContent).toBe('claimed')
    expect(screen.queryByTestId('ticket-stepper')).toBeNull()
    // The snapshot names Ticket 08 only: Ticket 09 keeps its word.
    answer({ ok: true, value: { root: ROOT, pipeline: WORFY, tickets: [on(WORFY, 'ci', { num: 8 })], error: null } satisfies PipelineSnapshot })
    await vi.waitFor(() => expect(card(8).getAttribute('aria-label')).toBe('Ticket 08, CI'))
    expect(card(9).getAttribute('aria-label')).toBe('Ticket 09, blocked')
  })

  it('pipeline.get failed: the status word stays', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    pipelineAnswer = () => Promise.resolve({ ok: false, error: 'no Profile' })
    bridge()
    renderCards([ticket(8)])
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    expect(card(8).getAttribute('aria-label')).toBe('Ticket 08, claimed')
    expect(screen.queryByTestId('ticket-stepper')).toBeNull()
    error.mockRestore()
  })
})
