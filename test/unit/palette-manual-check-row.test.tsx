// A row of the "Manual check" group of the command palette (⌘K) wraps its title onto at most three
// lines, cut with an ellipsis after them; other rows keep one line. A row's title is its tooltip
// only when the title is cut on screen, and the palette works that out again when the row's width
// changes. A row without a detail gives its title the whole width. The tooltip of a gated row
// ("Ship ticket", "Run wave") stays its command text or the reason it cannot run.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { PaletteBody } from '../../src/renderer/palette/CommandPalette'
import { buildCommands, type CommandContext, type CommandGroup, type PaletteCommand } from '../../src/renderer/palette/commands'

// 200 characters, so no palette width could show it on one line.
const LONG_CHECK = `Stable copy after the merge: open the palette, type the name of a Ticket, ${'and read the row to its very end '.repeat(4)}`.slice(0, 200)
// As long as the longest real check: 995 characters, about 12 lines of the palette.
const LONGEST_CHECK = `Stable copy after the merge: ${'open the palette, type the name of a Ticket and read the row to its very end; '.repeat(13)}`.slice(0, 995)
const SHORT_CHECK = 'Stable copy: the row reads in full'

function ticket(num: number, manualChecks: Ticket['manualChecks'] = []): Ticket {
  return {
    epic: 'e',
    num,
    slug: `t${num}`,
    title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    manualChecks,
  }
}

function context(tickets: Ticket[]): CommandContext {
  const project = { id: 'p1', name: 'one', path: '/repo/one', branch: 'main' }
  const model: WorkflowModel = { root: '/repo/one', epics: [{ epic: 'e', hasSpec: true, hasMap: false, title: 'Epic E' }], tickets, error: null, branchErrors: [] }
  return { project, projects: [project], view: 'canvas', model, layoutNodes: [], history: [], adrs: [], tagFilter: null, createItems: [] }
}

const command = (id: string, group: CommandGroup, title: string, over: Partial<PaletteCommand> = {}): PaletteCommand => ({ id, group, title, run: vi.fn(() => undefined), ...over })

const option = (id: string) => screen.getAllByTestId('palette-option').find((each) => each.dataset['command'] === id)!
/** The span of the row's title: the row's first child. */
const titleOf = (row: HTMLElement) => row.firstElementChild as HTMLElement

/**
 * jsdom lays nothing out, so the title span of a row gets the sizes a browser would give it: every
 * character is CHAR px wide and the title has `width` px. A wrapping title (`white-space: normal`)
 * breaks into lines of its line height and shows no more of them than its line clamp, when it has
 * one that works (`display: -webkit-box`, `overflow: hidden`); a one-line title shows `width` px.
 */
const CHAR = 7
let width = 500
interface Box {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
}
function box(element: HTMLElement): Box {
  const row = element.parentElement
  if (row?.dataset['testid'] !== 'palette-option' || row.firstElementChild !== element) return { scrollWidth: 0, clientWidth: 0, scrollHeight: 0, clientHeight: 0 }
  const content = (element.textContent ?? '').length * CHAR
  const lineHeight = parseFloat(element.style.lineHeight) || 16
  if (element.style.whiteSpace === 'normal') {
    const lines = Math.ceil(content / width)
    const clamp = Number(element.style.webkitLineClamp)
    const clamped = element.style.display === '-webkit-box' && element.style.overflow === 'hidden' && clamp > 0
    const shown = clamped ? Math.min(lines, clamp) : lines
    return { scrollWidth: width, clientWidth: width, scrollHeight: lines * lineHeight, clientHeight: shown * lineHeight }
  }
  return { scrollWidth: content, clientWidth: Math.min(content, width), scrollHeight: lineHeight, clientHeight: lineHeight }
}
const SIZES = ['scrollWidth', 'clientWidth', 'scrollHeight', 'clientHeight'] as const

/** The ResizeObservers the rows made; `resize(to)` gives the titles `to` px and tells each observer. */
const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []
class FakeResizeObserver {
  private readonly entry: (typeof observers)[number]
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: new Set() }
    observers.push(this.entry)
  }
  observe(target: Element) {
    this.entry.targets.add(target)
  }
  unobserve(target: Element) {
    this.entry.targets.delete(target)
  }
  disconnect() {
    this.entry.targets.clear()
  }
}
function resize(to: number) {
  width = to
  act(() => {
    for (const { callback, targets } of observers) {
      if (targets.size > 0) callback([...targets].map((target) => ({ target }) as ResizeObserverEntry), {} as ResizeObserver)
    }
  })
}

const scrolled: string[] = []

beforeEach(() => {
  width = 500
  observers.length = 0
  for (const size of SIZES) {
    Object.defineProperty(HTMLElement.prototype, size, {
      configurable: true,
      get(this: HTMLElement) {
        return box(this)[size]
      },
    })
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver
  // jsdom lays nothing out and has no scrollIntoView; the palette calls it for the active row.
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push((this as HTMLElement).dataset['command'] ?? this.getAttribute('data-testid') ?? '')
  }
  // Nothing in the main process answers: a gated row keeps reading the Project settings.
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: () => new Promise(() => undefined),
    on: () => 0,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  for (const size of SIZES) delete (HTMLElement.prototype as Partial<Record<(typeof SIZES)[number], number>>)[size]
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('a Manual check row of the palette', () => {
  it('shows a 995-character check on three lines with an ellipsis, and the whole text in the tooltip', () => {
    const commands = buildCommands(context([ticket(7, [{ text: LONGEST_CHECK, checked: false }])]))
    render(<PaletteBody commands={commands} empty="Nothing matches" onClose={() => undefined} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'stable copy' } })

    const group = screen.getByRole('group', { name: 'Manual check' })
    const row = within(group).getByRole('option')
    const full = `e 07 · ${LONGEST_CHECK}`
    expect(LONGEST_CHECK).toHaveLength(995)
    expect(row.dataset['command']).toBe('manual-check:e/07:0')
    const title = titleOf(row)
    expect(title.textContent).toBe(full)
    // The title wraps and stops after three lines, the last one ending in "…".
    expect(title.style.whiteSpace).toBe('normal')
    expect(title.style.display).toBe('-webkit-box')
    expect(title.style.webkitLineClamp).toBe('3')
    expect(title.style.webkitBoxOrient).toBe('vertical')
    expect(title.style.overflow).toBe('hidden')
    expect(title.style.maxWidth).not.toBe('60%')
    expect(title.scrollHeight).toBeGreaterThan(10 * 18)
    expect(title.clientHeight).toBeLessThanOrEqual(3 * parseFloat(title.style.lineHeight))
    // The row grows with its lines, up to the three of them: it is not held at the height of one.
    expect(row.style.height).not.toBe('var(--row-height)')
    expect(row.style.minHeight).toBe('var(--row-height)')
    // The title is cut, so the tooltip has all of it.
    expect(row.getAttribute('title')).toBe(full)
  })

  it('a check that fits in its lines has no tooltip', () => {
    render(<PaletteBody commands={buildCommands(context([ticket(7, [{ text: SHORT_CHECK, checked: false }])]))} empty="Nothing matches" onClose={() => undefined} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'stable copy' } })
    const row = within(screen.getByRole('group', { name: 'Manual check' })).getByRole('option')
    expect(titleOf(row).textContent).toBe(`e 07 · ${SHORT_CHECK}`)
    expect(titleOf(row).scrollHeight).toBe(titleOf(row).clientHeight)
    expect(row.hasAttribute('title')).toBe(false)
  })

  it('works out again whether the check is cut when the row gets narrower or wider', () => {
    // 207 characters with the Ticket: 1449 px, three lines of 500 px, five of 300 px.
    render(<PaletteBody commands={buildCommands(context([ticket(7, [{ text: LONG_CHECK, checked: false }])]))} empty="Nothing matches" onClose={() => undefined} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'stable copy' } })
    const row = () => within(screen.getByRole('group', { name: 'Manual check' })).getByRole('option')
    expect(row().hasAttribute('title')).toBe(false)
    resize(300)
    expect(row().getAttribute('title')).toBe(`e 07 · ${LONG_CHECK}`)
    resize(500)
    expect(row().hasAttribute('title')).toBe(false)
  })

  it('↑/↓ walk wrapped rows as any others and bring each into view', () => {
    const checks = [
      { text: `${LONG_CHECK} one`, checked: false },
      { text: `${LONG_CHECK} two`, checked: false },
    ]
    render(<PaletteBody commands={buildCommands(context([ticket(7, checks)]))} empty="Nothing matches" onClose={() => undefined} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'stable copy' } })
    const active = () => screen.getAllByRole('option').find((each) => each.getAttribute('aria-selected') === 'true')?.dataset['command']
    const first = active()
    expect(first).toMatch(/^manual-check:e\/07:/)
    scrolled.length = 0
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const second = active()
    expect(second).toMatch(/^manual-check:e\/07:/)
    expect(second).not.toBe(first)
    expect(scrolled).toEqual([second])
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(active()).toBe(first)
  })
})

describe('the title of other palette rows', () => {
  it('takes the whole row when the row has no detail, and keeps one line', () => {
    render(<PaletteBody commands={[command('new:session', 'Action', 'New session')]} empty="Nothing matches" onClose={() => undefined} />)
    const row = option('new:session')
    const title = titleOf(row)
    expect(title.style.maxWidth).not.toBe('60%')
    expect(title.style.flex).toMatch(/^1/)
    expect(title.style.whiteSpace).toBe('nowrap')
    // No empty detail beside it to share the width with.
    expect(row.children).toHaveLength(1)
    expect(row.style.height).toBe('var(--row-height)')
    // The title is seen whole, so the row has no tooltip.
    expect(row.hasAttribute('title')).toBe(false)
  })

  it('has its full title in the tooltip only while the title is cut', () => {
    // 50 characters: 350 px.
    const name = 'Go to the Ticket whose title runs past the row end'
    render(<PaletteBody commands={[command('ticket:e/07', 'Go to', name, { detail: 'e/07' })]} empty="Nothing matches" onClose={() => undefined} />)
    const row = option('ticket:e/07')
    expect(row.hasAttribute('title')).toBe(false)
    resize(200)
    expect(titleOf(row).scrollWidth).toBeGreaterThan(titleOf(row).clientWidth)
    expect(row.getAttribute('title')).toBe(name)
    resize(400)
    expect(row.hasAttribute('title')).toBe(false)
  })

  it('leaves the detail its place when there is one', () => {
    render(<PaletteBody commands={[command('ticket:e/07', 'Go to', '07 — Release notes', { detail: 'e/07' })]} empty="Nothing matches" onClose={() => undefined} />)
    const row = option('ticket:e/07')
    expect(titleOf(row).style.maxWidth).toBe('60%')
    expect(row.children).toHaveLength(2)
    expect(row.children[1]?.textContent).toBe('e/07')
  })

  it('a Ship ticket row keeps its own tooltip: the reason it cannot run, not its title', () => {
    const blocked = ticket(8)
    render(
      <PaletteBody
        commands={[command('ship-ticket:e/08', 'Action', 'Ship ticket 08', { gate: { kind: 'ship-ticket', projectId: 'p1', ticket: blocked, tickets: [blocked] } })]}
        empty="Nothing matches"
        onClose={() => undefined}
      />,
    )
    const row = option('ship-ticket:e/08')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.getAttribute('title')).toBe('Reading the Project settings…')
    expect(within(row).getByTestId('palette-option-note').textContent).toBe('Reading the Project settings…')
  })
})
