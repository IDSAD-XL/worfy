// A row of the "Manual check" group of the command palette (⌘K) shows the whole text of the check:
// the title wraps onto more lines instead of being cut at an ellipsis, and the row's tooltip holds
// the full text too. A row without a detail gives its title the whole width. The tooltip of a gated
// row ("Ship ticket", "Run wave") stays its command text or the reason it cannot run.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { PaletteBody } from '../../src/renderer/palette/CommandPalette'
import { buildCommands, type CommandContext, type CommandGroup, type PaletteCommand } from '../../src/renderer/palette/commands'

// 200 characters, so no palette width could show it on one line.
const LONG_CHECK = `Stable copy after the merge: open the palette, type the name of a Ticket, ${'and read the row to its very end '.repeat(4)}`.slice(0, 200)

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

const scrolled: string[] = []

beforeEach(() => {
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
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('a Manual check row of the palette', () => {
  it('shows the whole text of a 200-character check: wrapped, not cut, and in the tooltip', () => {
    const commands = buildCommands(context([ticket(7, [{ text: LONG_CHECK, checked: false }])]))
    render(<PaletteBody commands={commands} empty="Nothing matches" onClose={() => undefined} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'stable copy' } })

    const group = screen.getByRole('group', { name: 'Manual check' })
    const row = within(group).getByRole('option')
    const full = `e 07 · ${LONG_CHECK}`
    expect(LONG_CHECK).toHaveLength(200)
    expect(row.dataset['command']).toBe('manual-check:e/07:0')
    // The tooltip has all of it.
    expect(row.getAttribute('title')).toBe(full)
    // The row shows all of it: the title wraps and is cut nowhere.
    const title = titleOf(row)
    expect(title.textContent).toBe(full)
    expect(title.style.whiteSpace).toBe('normal')
    expect(title.style.textOverflow).not.toBe('ellipsis')
    expect(title.style.maxWidth).not.toBe('60%')
    expect(title.style.overflow).not.toBe('hidden')
    // The row grows with its lines: it is not held at the height of one.
    expect(row.style.height).not.toBe('var(--row-height)')
    expect(row.style.minHeight).toBe('var(--row-height)')
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
    // A title that may be cut has its full text in the tooltip.
    expect(row.getAttribute('title')).toBe('New session')
    expect(row.style.height).toBe('var(--row-height)')
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
