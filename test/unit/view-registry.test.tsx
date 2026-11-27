// The registry of the views (worfy-layout ticket 01, src/renderer/shell/views.tsx): one list gives the toolbar's six
// View buttons — their label, tooltip, why one is inactive, the Acceptance count and what a press opens — and the View
// rows of the Command palette, a row for each of the six, Pipeline board among them.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openRunHistory, readyCount } = vi.hoisted(() => ({ openRunHistory: vi.fn(() => Promise.resolve()), readyCount: { value: 0 } }))
vi.mock('../../src/renderer/flight-recorder/open', () => ({ openRunHistory }))
vi.mock('../../src/renderer/acceptance/useAcceptance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/acceptance/useAcceptance')>()),
  useReadyCount: () => readyCount.value,
}))

import { buildCommands, type CommandContext } from '../../src/renderer/palette/commands'
import { useNavigation } from '../../src/renderer/session/navigation'
import { ToolbarView, type ShellView } from '../../src/renderer/shell/Toolbar'
import { VIEWS } from '../../src/renderer/shell/views'
import { VIEW_BUTTON_IDS } from '../../src/shared/layout/view-buttons'
// The registry's six buttons all in the header (worfy-layout ticket 04 puts them in three zones; test/unit/view-zones.test.tsx).
const ALL_IN_HEADER = { header: [...VIEW_BUTTON_IDS], rail: [], footer: [] }

const PROJECT = { id: 'auberge-00000001', name: 'auberge', branch: 'main' }

function renderToolbar(props: { project?: typeof PROJECT; view?: ShellView; onViewChange?: (view: ShellView) => void }) {
  render(<ToolbarView items={[]} view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} layout={ALL_IN_HEADER} {...props} />)
  return within(screen.getByRole('group', { name: 'View' }))
}

function context(over: Partial<CommandContext> = {}): CommandContext {
  const project = { id: PROJECT.id, name: PROJECT.name, path: '/repo/auberge', branch: 'main' }
  return { project, projects: [project], view: 'canvas', model: undefined, layoutNodes: [], history: [], adrs: [], tagFilter: null, createItems: [], ...over }
}

const viewRows = (ctx: CommandContext) => buildCommands(ctx).filter((command) => command.group === 'View' && !command.id.startsWith('tag:'))

afterEach(() => {
  cleanup()
  openRunHistory.mockClear()
  readyCount.value = 0
  useNavigation.setState({ view: 'canvas' })
})

describe('the registry', () => {
  it('names the main area of each of the eight views; only six of them have a View button', () => {
    expect(VIEWS.map((view) => [view.id, view.area])).toEqual([
      ['canvas', 'Canvas'],
      ['session', 'Session'],
      ['pipeline', 'Pipeline'],
      ['history', 'Run history'],
      ['pull-requests', 'Pull requests'],
      ['acceptance', 'Acceptance'],
      ['story', 'Code story'],
      ['changes', 'Changes'],
    ])
    expect(VIEWS.filter((view) => view.button !== undefined).map((view) => view.id)).toEqual(['canvas', 'session', 'pipeline', 'history', 'pull-requests', 'acceptance'])
  })
})

describe('the View buttons of the toolbar', () => {
  it('are the six views in their order, each with its tooltip', () => {
    const tabs = renderToolbar({ project: PROJECT })
    const buttons = tabs.getAllByRole('button') as HTMLButtonElement[]
    expect(buttons.map((tab) => [tab.getAttribute('aria-label'), tab.title])).toEqual([
      ['Canvas', 'Canvas'],
      ['Session', 'Session view'],
      ['Pipeline', 'Pipeline board'],
      ['Runs', 'Run history'],
      ['Pull requests', 'Pull requests of the open Project'],
      ['Acceptance', 'Checks that wait for you'],
    ])
    expect(buttons.every((button) => !button.disabled)).toBe(true)
  })

  it('without a Project, Runs and Pull requests are inactive and their tooltip says why; the others stay usable', () => {
    const tabs = renderToolbar({})
    const inactive = (tabs.getAllByRole('button') as HTMLButtonElement[]).filter((button) => button.disabled)
    expect(inactive.map((button) => [button.getAttribute('aria-label'), button.title])).toEqual([
      ['Runs', 'Open a Project to see its Runs'],
      ['Pull requests', 'Open a Project to see its pull requests'],
    ])
  })

  it('Runs opens the Run history of the open Project', () => {
    const onViewChange = vi.fn()
    const tabs = renderToolbar({ project: PROJECT, onViewChange })
    fireEvent.click(tabs.getByRole('button', { name: 'Runs' }))
    expect(openRunHistory).toHaveBeenCalledWith(PROJECT.id)
    expect(onViewChange).not.toHaveBeenCalled()
  })

  it('the other five switch the shell view, as the tabs did', () => {
    const onViewChange = vi.fn()
    const tabs = renderToolbar({ project: PROJECT, onViewChange })
    for (const name of ['Canvas', 'Session', 'Pipeline', 'Pull requests', 'Acceptance']) fireEvent.click(tabs.getByRole('button', { name }))
    expect(onViewChange.mock.calls).toEqual([['canvas'], ['session'], ['pipeline'], ['pull-requests'], ['acceptance']])
    expect(openRunHistory).not.toHaveBeenCalled()
  })

  it('Acceptance carries the count of Ready to check, and none at zero', () => {
    readyCount.value = 3
    renderToolbar({})
    expect(within(screen.getByTestId('acceptance-tab')).getByTestId('acceptance-tab-count').textContent).toBe('3')
    cleanup()
    readyCount.value = 0
    renderToolbar({})
    expect(screen.queryByTestId('acceptance-tab-count')).toBeNull()
  })
})

describe('the View rows of the Command palette', () => {
  it('has a row for each of the six views, with the texts they had; Pipeline board is new', () => {
    expect(viewRows(context()).filter((row) => VIEW_ROW_IDS.includes(row.id)).map((row) => [row.id, row.title])).toEqual([
      ['view:canvas', 'Switch to Canvas'],
      ['view:session', 'Switch to Session'],
      ['view:pipeline', 'Pipeline board'],
      ['open-run-history', 'Open Run history'],
      ['view:pull-requests', 'Pull requests'],
      ['view:acceptance', 'Acceptance'],
    ])
  })

  it('without a Project keeps the rows of the views that need none', () => {
    expect(viewRows(context({ project: undefined })).filter((row) => VIEW_ROW_IDS.includes(row.id)).map((row) => row.id)).toEqual(['view:canvas', 'view:session', 'view:pipeline', 'view:acceptance'])
  })

  it('Pipeline board opens the Pipeline board, and says so while it is shown', async () => {
    const row = viewRows(context()).find((each) => each.id === 'view:pipeline')
    expect(row?.detail).toBeUndefined()
    expect(await row!.run()).toBeUndefined()
    expect(useNavigation.getState().view).toBe('pipeline')
    expect(viewRows(context({ view: 'pipeline' })).find((each) => each.id === 'view:pipeline')?.detail).toBe('shown now')
  })
})

const VIEW_ROW_IDS = ['view:canvas', 'view:session', 'view:pipeline', 'open-run-history', 'view:pull-requests', 'view:acceptance']
