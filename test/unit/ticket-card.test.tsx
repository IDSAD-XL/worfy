// A Ticket's card on the Canvas shows every element whole (worfy-canvas ticket 18): no rule of the
// card's CSS ends text with "…" or clamps lines, the card draws the whole title, reason, blockers
// line, repository name and whom the Ticket waits for, and its Node is as tall as ticket-card.ts
// computes for that content.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { PipelineColumn, PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import { DEFAULT_PIPELINE, stageId, stageLabel } from '../../src/shared/workflow/pipeline'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import TicketNode, { defaultHeight, defaultWidth } from '../../src/renderer/canvas/nodes/TicketNode'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { buildEpicNodes } from '../../src/renderer/canvas/sources/epics'
import { cardHeight, CONTENT_WIDTH, TICKET_MIN_HEIGHT, TICKET_WIDTH, type CardInput } from '../../src/renderer/canvas/ticket-card'

// The badges and actions are their own tests' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

const css = (path: string) => readFileSync(join(import.meta.dirname, '../../src/renderer', path), 'utf8')

/** The rules of a stylesheet whose selector names one of `parts`, comments left out. */
function rulesFor(source: string, parts: readonly string[]): { selector: string; body: string }[] {
  const plain = source.replace(/\/\*[\s\S]*?\*\//gu, '')
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .map(([, selector, body]) => ({ selector: selector!.trim(), body: body! }))
    .filter((rule) => parts.some((part) => rule.selector.includes(part)))
}

describe('the card CSS cuts nothing', () => {
  const sheets = ['canvas/epic-frame.css', 'pipeline/stepper.css', 'canvas/badges/checks-badges.css']
  const parts = ['.w-ticket', '.w-stepper', '.w-checks']
  const WRAPPING_ROWS = ['.w-ticket__top', '.w-ticket__title', '.w-ticket__meta', '.w-ticket__reason', '.w-ticket__slots', '.w-stepper', '.w-checks']

  it.each(sheets)('%s: no rule of the card ends text with «…», clamps lines or keeps text on one line inside a narrower box', (sheet) => {
    const rules = rulesFor(css(sheet), parts)
    expect(rules.length, `${sheet} styles the card`).toBeGreaterThan(0)
    for (const { selector, body } of rules) {
      expect(body, `${selector} ends text with «…»`).not.toMatch(/text-overflow\s*:\s*ellipsis/u)
      expect(body, `${selector} clamps lines`).not.toMatch(/line-clamp/u)
      // A fixed height would cut a row that wraps; these rows grow (min-height) instead.
      if (WRAPPING_ROWS.includes(selector)) expect(body, `${selector} has a fixed height`).not.toMatch(/(^|[;\s])height\s*:\s*\d+px/u)
    }
  })

  it('the stepper keeps one line only in its full form, which it leaves when that does not fit; the narrow form wraps', () => {
    const rules = rulesFor(css('pipeline/stepper.css'), ['.w-stepper'])
    const nowrap = rules.filter((rule) => /white-space\s*:\s*nowrap/u.test(rule.body)).map((rule) => rule.selector)
    expect(nowrap).toEqual(['.w-stepper__label', '.w-stepper__count'])
    const narrow = rules.find((rule) => rule.selector === ".w-stepper[data-narrow='true'] .w-stepper__label")
    expect(narrow?.body).toMatch(/white-space\s*:\s*normal/u)
  })
})

// ── the card drawn ───────────────────────────────────────────────────────────

const ROOT = '/repo'
const PIPELINE: PipelineColumn[] = DEFAULT_PIPELINE.map((stage) => ({ ...stage, id: stageId(stage), title: stageLabel(stage) }))

function ticket(num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'demo',
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

function on(id: string, over: Partial<PipelineTicket>): PipelineTicket {
  const index = PIPELINE.findIndex((column) => column.id === id)
  return {
    epic: 'demo',
    num: 1,
    stage: id,
    index,
    kind: PIPELINE[index]!.kind,
    passed: PIPELINE.slice(0, index).map((column) => column.id),
    skipped: [],
    blocked: null,
    rework: false,
    sub: null,
    waits: 'agent',
    enteredAt: null,
    statusAt: null,
    ...over,
  }
}

let snapshot: PipelineSnapshot
let repoNames: string[]

function bridge(): void {
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => {
      if (channel === 'pipeline.get') return Promise.resolve({ ok: true, value: snapshot })
      if (channel === 'checks.repos') return Promise.resolve({ ok: true, value: { mode: 'full', repos: repoNames.map((name) => ({ name, path: `${ROOT}/${name}` })) } })
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
function renderCards(tickets: Ticket[], root = ROOT) {
  const model: WorkflowModel = { root, epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets, error: null, branchErrors: [] }
  const nodes = buildEpicNodes(`p-card-${(project += 1)}`, root, model, { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, {})
  const cards = nodes.filter((node) => node.type === 'ticket')
  render(
    <ReactFlowProvider>
      {cards.map((node) => (
        <TicketNode key={node.id} {...({ id: node.id, data: node.data, selected: false } as unknown as CanvasNodeProps)} />
      ))}
    </ReactFlowProvider>,
  )
  return cards
}

const card = (num: number) => screen.getAllByTestId('ticket-node').find((node) => node.dataset.ticket === String(num))!

const LONG_TITLE = 'Withdraw-lot button for moderators, with a reason the seller sees and an audit record kept for the support team to check'
const LONG_REASON = 'waits for the owner to answer which payment provider the platform uses in production'

describe('the card draws every element whole', () => {
  it('the whole title, blocked reason and blockers line; no inline style cuts them', async () => {
    snapshot = { root: ROOT, pipeline: PIPELINE, tickets: [], error: null }
    repoNames = ['repo']
    bridge()
    const blockers = Array.from({ length: 20 }, (_, i) => i + 10)
    renderCards([
      ticket(1, { title: `01 — ${LONG_TITLE}` }),
      ticket(2, { state: 'blocked', statusRaw: `blocked — ${LONG_REASON}`, blockedReason: LONG_REASON }),
      ticket(3, { blockedNums: blockers, blockedRaw: blockers.join(', ') }),
      ...blockers.map((num) => ticket(num, { state: 'done', statusRaw: 'done' })),
    ])
    expect(card(1).querySelector('.w-ticket__title')!.textContent).toBe(LONG_TITLE)
    expect(card(2).querySelector('.w-ticket__reason')!.textContent).toBe(LONG_REASON)
    expect(card(3).querySelector('.w-ticket__meta')!.textContent).toBe(`blocked by ${blockers.join(', ')} · done`)
    for (const element of screen.getAllByTestId('ticket-node').flatMap((node) => [node, ...node.querySelectorAll<HTMLElement>('*')])) {
      expect(element.style.textOverflow, element.className).toBe('')
      expect(element.style.maxWidth, element.className).toBe('')
    }
  })

  it('a narrow stepper beside the Ready chip still says whom the Ticket waits for, whole', async () => {
    snapshot = { root: ROOT, pipeline: PIPELINE, tickets: [on('queued', { num: 1, waits: 'owner' })], error: null }
    repoNames = ['repo']
    bridge()
    renderCards([ticket(1, { waits: 'owner' })])
    await vi.waitFor(() => expect(screen.getByTestId('ticket-stepper').dataset.narrow).toBe('true'))
    expect(card(1).dataset.ready).toBe('true')
    expect(screen.getByTestId('stepper-count').textContent).toBe('1/7')
    expect(screen.getByTestId('stepper-waits').textContent).toBe('owner')
  })

  it('the repository chip carries the whole name, with no width limit or «…» of its own', async () => {
    snapshot = { root: ROOT, pipeline: PIPELINE, tickets: [], error: null }
    repoNames = ['application-server-with-a-long-name', 'web']
    bridge()
    // Repositories are kept per Project root for the whole run: this test asks about a root of its own.
    renderCards([ticket(1, { repo: 'application-server-with-a-long-name' })], '/repo-many')
    const chip = await screen.findByTestId('ticket-repo')
    expect(chip.textContent).toBe('application-server-with-a-long-name')
    expect(chip.getAttribute('style')).toBeNull()
  })
})

// ── the card's height ────────────────────────────────────────────────────────

const base: CardInput = { num: 1, title: 'Short', state: 'open', ready: false, reason: null, meta: { lead: 'no blockers', nums: null, tail: '', attention: false } }

describe('the card is as tall as what it shows', () => {
  it('the Node is TICKET_WIDTH wide and as tall as cardHeight; the smallest card is TICKET_MIN_HEIGHT, the Node kind\'s default size', () => {
    snapshot = { root: ROOT, pipeline: PIPELINE, tickets: [], error: null }
    repoNames = ['repo']
    bridge()
    const cards = renderCards([ticket(1, { title: 'Short' }), ticket(2, { title: LONG_TITLE })])
    const [short, long] = cards
    expect(short!.width).toBe(TICKET_WIDTH)
    expect(short!.height).toBe(TICKET_MIN_HEIGHT)
    expect(long!.height).toBeGreaterThan(short!.height!)
    expect(cardHeight(base)).toBe(TICKET_MIN_HEIGHT)
    expect({ defaultWidth, defaultHeight }).toEqual({ defaultWidth: TICKET_WIDTH, defaultHeight: TICKET_MIN_HEIGHT })
  })

  it('a longer title, reason or blockers line takes more lines, 17, 15 and 15 px each', () => {
    const titleLines = (title: string) => (cardHeight({ ...base, title }) - TICKET_MIN_HEIGHT) / 17 + 1
    expect(titleLines(LONG_TITLE)).toBeGreaterThanOrEqual(3)
    expect(Number.isInteger(titleLines(LONG_TITLE))).toBe(true)
    const reason = cardHeight({ ...base, state: 'blocked', reason: LONG_REASON })
    const shortReason = cardHeight({ ...base, state: 'blocked', reason: 'keys' })
    expect(reason - shortReason).toBeGreaterThanOrEqual(15)
    const nums = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0')).join(', ')
    expect(cardHeight({ ...base, meta: { lead: 'blocked by ', nums, tail: ' · done', attention: false } })).toBeGreaterThan(TICKET_MIN_HEIGHT + 15)
  })

  it('a word longer than the line is broken inside it, as overflow-wrap: anywhere does', () => {
    const word = 'x'.repeat(200)
    expect(cardHeight({ ...base, title: word })).toBeGreaterThan(cardHeight({ ...base, title: 'x'.repeat(10) }))
  })

  it('room for the Stage names the Project uses: a long custom name takes another line of the top row', () => {
    const custom = ['Waiting to start for a really long while', 'Implementing', 'Done']
    expect(cardHeight({ ...base, stages: custom })).toBeGreaterThan(cardHeight(base))
    expect(cardHeight({ ...base, state: 'done', stages: custom })).toBe(cardHeight({ ...base, state: 'done' }))
  })

  it('room for a long Waits: value, a repository name and the Ready chip in the top row', () => {
    expect(cardHeight({ ...base, waits: 'the owner of the payment provider account, after the vendor answers' })).toBeGreaterThan(cardHeight(base))
    expect(cardHeight({ ...base, repo: 'x'.repeat(60) })).toBeGreaterThan(cardHeight(base))
    expect(cardHeight({ ...base, ready: true })).toBeGreaterThanOrEqual(cardHeight(base))
  })

  it('CONTENT_WIDTH is the card less its 1 px border and 10 px padding on each side', () => {
    expect(CONTENT_WIDTH).toBe(TICKET_WIDTH - 22)
  })
})
