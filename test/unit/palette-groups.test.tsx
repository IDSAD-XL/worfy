// The groups of the command palette (⌘K): after ranking, rows are grouped — a group stands where its
// best row stands, and inside a group the rows keep the ranking's order (by score, ties in build
// order). The list shows a heading over each group; ↑ and ↓ walk the rows across group borders.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LayoutNode } from '../../src/shared/layout/types'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { rankItems } from '../../src/renderer/find/search-index'
import { PaletteBody } from '../../src/renderer/palette/CommandPalette'
import { buildCommands, type CommandContext, type CommandGroup, type PaletteCommand } from '../../src/renderer/palette/commands'
import { groupRows } from '../../src/renderer/palette/groups'

interface Row {
  id: string
  group: string
  title: string
}

const row = (id: string, group: string, title = id): Row => ({ id, group, title })
const groupOf = (each: { group: string }) => each.group
const shape = (groups: readonly { name: string; rows: readonly { id: string }[] }[]) => groups.map(({ name, rows }) => [name, rows.map((each) => each.id)])

function ticket(num: number, state: Ticket['state'], blockedNums: number[] = []): Ticket {
  return {
    epic: 'e',
    num,
    slug: `t${num}`,
    title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
    statusRaw: state,
    state,
    blockedRaw: blockedNums.join(', ') || null,
    blockedNums,
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
  }
}

function node(id: string, kind: string, over: Partial<LayoutNode> = {}): LayoutNode {
  return { id, kind, x: 0, y: 0, w: 100, h: 100, hidden: false, locked: false, pinned: false, tags: [], data: {}, ...over }
}

const project = { id: 'p1', name: 'one', path: '/repo/one', branch: 'main' }

function context(): CommandContext {
  const model: WorkflowModel = {
    root: '/repo/one',
    epics: [{ epic: 'e', hasSpec: true, hasMap: false, title: 'Epic E' }],
    tickets: [ticket(1, 'done'), ticket(7, 'open', [1]), ticket(9, 'work')],
    error: null,
    branchErrors: [],
  }
  return {
    project,
    projects: [project, { id: 'p2', name: 'two', path: '/repo/two', branch: null }],
    view: 'canvas',
    model,
    layoutNodes: [node('n1', 'note', { tags: ['plan'], data: { text: 'Plan' } })],
    history: [],
    adrs: [],
    tagFilter: null,
    createItems: [{ label: 'New terminal', kind: 'terminal' }],
  }
}

describe('groupRows', () => {
  it('puts Go to before Action when the best row is from Go to and the second from Action', () => {
    const ranked = [row('g1', 'Go to'), row('a1', 'Action'), row('g2', 'Go to'), row('a2', 'Action'), row('v1', 'View')]
    expect(shape(groupRows(ranked, groupOf))).toEqual([
      ['Go to', ['g1', 'g2']],
      ['Action', ['a1', 'a2']],
      ['View', ['v1']],
    ])
  })

  it('keeps the rows of a group in the ranking’s order — by score, not in the order they were built', () => {
    // Built: "Run wave" before "Wave"; ranked for "wave": "Wave" (starts with it) before "Run wave".
    const built = [row('run-wave', 'Action', 'Run wave'), row('go-wave', 'Go to', 'Go to wave plan'), row('wave', 'Action', 'Wave')]
    const ranked = rankItems(built, 'wave')
    expect(ranked.map((each) => each.id)).toEqual(['wave', 'run-wave', 'go-wave'])
    expect(shape(groupRows(ranked, groupOf))).toEqual([
      ['Action', ['wave', 'run-wave']],
      ['Go to', ['go-wave']],
    ])
  })

  it('with the empty query gives Action (with Ship ticket and Run wave), View, Project, Go to', () => {
    const commands = buildCommands(context())
    const groups = groupRows(rankItems(commands, ''), (command) => command.group)
    expect(groups.map((group) => group.name)).toEqual(['Action', 'View', 'Project', 'Go to'])
    const action = groups[0]!.rows.map((command) => command.id)
    expect(action).toEqual(expect.arrayContaining(['new:session', 'tidy-up', 'ship-ticket:e/07', 'run-wave:e']))
    // Every Action command is in the one group: none is left at the tail of the list.
    expect(action).toHaveLength(commands.filter((command) => command.group === 'Action').length)
  })

  it('makes a group of one row', () => {
    expect(shape(groupRows([row('a1', 'Action'), row('g1', 'Go to'), row('a2', 'Action')], groupOf))).toEqual([
      ['Action', ['a1', 'a2']],
      ['Go to', ['g1']],
    ])
  })

  it('gives no groups for no rows', () => {
    expect(groupRows([], groupOf)).toEqual([])
  })
})

// ── the list in the palette ─────────────────────────────────────────────────

const command = (id: string, group: CommandGroup, title: string, over: Partial<PaletteCommand> = {}): PaletteCommand => ({
  id,
  group,
  title,
  run: vi.fn(() => undefined),
  ...over,
})

const blocked = ticket(8, 'open', [9])

/** Built in this order; with the empty query the groups are Action, View, Go to. */
function commands(): PaletteCommand[] {
  return [
    command('new:session', 'Action', 'New session'),
    command('tidy-up', 'Action', 'Tidy up'),
    command('view:canvas', 'View', 'Canvas'),
    command('ticket:e/07', 'Go to', '07 — Release notes', { keys: ['07'] }),
    // A gated row: the Project's action templates never arrive here, so it stays inactive with a reason.
    command('ship-ticket:e/08', 'Action', 'Ship ticket 08', { gate: { kind: 'ship-ticket', projectId: 'p1', ticket: blocked, tickets: [blocked] } }),
  ]
}

const options = () => screen.getAllByRole('option')
const active = () => options().find((option) => option.getAttribute('aria-selected') === 'true')

const scrolled: string[] = []

beforeEach(() => {
  // jsdom lays nothing out and has no scrollIntoView; the palette calls it for the active row.
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute('data-testid') ?? '')
  }
  // Nothing in the main process answers: the gated row keeps reading the Project settings.
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

describe('the palette list', () => {
  it('shows each group as a group named by its heading, and the heading is not an option', () => {
    render(<PaletteBody commands={commands()} empty="Nothing matches" onClose={() => undefined} />)
    const listbox = screen.getByRole('listbox', { name: 'Commands' })
    const groups = within(listbox).getAllByRole('group')
    expect(groups.map((group) => group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent)).toEqual([
      'Action',
      'View',
      'Go to',
    ])
    const action = within(listbox).getByRole('group', { name: 'Action' })
    expect(within(action).getAllByRole('option').map((option) => option.dataset['command'])).toEqual(['new:session', 'tidy-up', 'ship-ticket:e/08'])
    const heading = screen.getAllByTestId('palette-group-heading')
    expect(heading.map((each) => each.textContent)).toEqual(['Action', 'View', 'Go to'])
    for (const each of heading) {
      expect(each.hasAttribute('aria-selected')).toBe(false)
      expect(each.getAttribute('role')).not.toBe('option')
    }
    // A line before every group but the first.
    expect(within(groups[0]!).queryByTestId('palette-group-separator')).toBeNull()
    expect(within(groups[1]!).queryByTestId('palette-group-separator')).not.toBeNull()
    expect(within(groups[2]!).queryByTestId('palette-group-separator')).not.toBeNull()
  })

  it('moves ↓ from the last row of a group to the first row of the next one, and ↑ back, never onto a heading', () => {
    render(<PaletteBody commands={commands()} empty="Nothing matches" onClose={() => undefined} />)
    const input = screen.getByRole('combobox')
    expect(active()?.dataset['command']).toBe('new:session')
    scrolled.length = 0
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    // A row inside a group scrolls only itself into view.
    expect(scrolled).toEqual(['palette-option'])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    // Last row of Action: the gated one, built last but grouped with the other actions.
    expect(active()?.dataset['command']).toBe('ship-ticket:e/08')
    scrolled.length = 0
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(active()?.dataset['command']).toBe('view:canvas')
    expect(input.getAttribute('aria-activedescendant')).toBe(active()?.id)
    // The first row of a group brings its heading into view, then itself.
    expect(scrolled).toEqual(['palette-group-heading', 'palette-option'])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(active()?.dataset['command']).toBe('ticket:e/07')
    // Around the end: back to the first row.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(active()?.dataset['command']).toBe('new:session')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(active()?.dataset['command']).toBe('ticket:e/07')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(active()?.dataset['command']).toBe('view:canvas')
    expect(options()).toHaveLength(5)
  })

  it('selects the first row of the best group on typing, and Enter runs it', () => {
    const list = commands()
    render(<PaletteBody commands={list} empty="Nothing matches" onClose={() => undefined} />)
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.change(input, { target: { value: '07' } })
    expect(screen.getAllByTestId('palette-group-heading')[0]?.textContent).toBe('Go to')
    expect(active()?.dataset['command']).toBe('ticket:e/07')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(list.find((each) => each.id === 'ticket:e/07')!.run).toHaveBeenCalledTimes(1)
  })

  it('shows no group name at the right of a row, but the reason of an inactive row', () => {
    render(<PaletteBody commands={commands()} empty="Nothing matches" onClose={() => undefined} />)
    const notes = new Map(screen.getAllByTestId('palette-option').map((option) => [option.dataset['command'], within(option).queryByTestId('palette-option-note')?.textContent ?? null]))
    expect(notes.get('new:session') ?? '').toBe('')
    expect(notes.get('view:canvas') ?? '').toBe('')
    expect(notes.get('ticket:e/07') ?? '').toBe('')
    expect(notes.get('ship-ticket:e/08')).toBe('Reading the Project settings…')
    const gated = screen.getAllByTestId('palette-option').find((option) => option.dataset['command'] === 'ship-ticket:e/08')!
    expect(gated.getAttribute('aria-disabled')).toBe('true')
  })
})
