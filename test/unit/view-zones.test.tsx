// The View buttons in their three zones (worfy-layout ticket 04; spec, the section on one button in three looks, Seam 3): the
// header, the block of the rail under a line and the left of the footer draw the buttons the layout puts there, in its
// order; the button of the view on screen is pressed in any zone; the badges come from the views' own sources; a zone
// without buttons draws nothing; while the sidebar is hidden the rail's buttons stand at the end of the header; in focus
// mode the rail's and the footer's buttons are inert. Ticket 05 moves a button with its menu and keys, ticket 06 with a
// drag: native drag events with a stub of DataTransfer, as test/unit/queue-list.test.tsx sends them.
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openRunHistory, readyCount, prCounts, tickets } = vi.hoisted(() => ({
  openRunHistory: vi.fn(() => Promise.resolve()),
  readyCount: { value: 0 },
  prCounts: { value: [] as { group: string; count: number }[] },
  tickets: { value: [] as { kind: string; blocked: unknown; waits: string | null }[] },
}))
vi.mock('../../src/renderer/flight-recorder/open', () => ({ openRunHistory }))
vi.mock('../../src/renderer/acceptance/useAcceptance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/acceptance/useAcceptance')>()),
  useReadyCount: () => readyCount.value,
}))
// The sources the Pull requests and Pipeline views read: the badges count from them, not from the sections.
vi.mock('../../src/renderer/pr-inbox/usePrInbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/pr-inbox/usePrInbox')>()),
  groupCounts: () => prCounts.value,
}))
vi.mock('../../src/renderer/pipeline/usePipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/pipeline/usePipeline')>()),
  usePipeline: () => ({ snapshot: tickets.value.length === 0 ? undefined : { tickets: tickets.value }, error: undefined }),
}))
// Main as the store answers a patch of the layout (ticket 05): a whole layout is kept, `null` takes the field away; the
// answer comes later, as over IPC.
const { patches, revision } = vi.hoisted(() => ({ patches: [] as unknown[], revision: { value: 1_000 } }))
vi.mock('../../src/renderer/settings/useAppSettings', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/settings/useAppSettings')>()
  const { defaultAppSettings: fresh } = await import('../../src/shared/settings/app-settings')
  return {
    ...real,
    setAppSettings: (patch: { viewButtons?: ViewButtons | null }) => {
      patches.push(patch)
      return Promise.resolve().then(() => {
        revision.value += 1
        const { viewButtons } = patch
        real.acceptAppSettings({ ...fresh(), revision: revision.value, ...(viewButtons === null || viewButtons === undefined ? {} : { viewButtons }) })
        return undefined
      })
    },
  }
})

import type { ViewButtons } from '../../src/shared/layout/view-buttons'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'
import { setFocusActive } from '../../src/renderer/focus/focus-state'
import { acceptAppSettings } from '../../src/renderer/settings/useAppSettings'
import { AppShell } from '../../src/renderer/shell/AppShell'
import { Footer } from '../../src/renderer/shell/footer/Footer'
import { SidebarView } from '../../src/renderer/shell/Sidebar'
import { ToolbarView, type ShellView } from '../../src/renderer/shell/Toolbar'
import type { ViewSwitch } from '../../src/renderer/shell/ViewZone'

const PROJECT = { id: 'auberge-00000001', name: 'auberge', branch: 'main' }

const names = (group: HTMLElement) => within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
const header = () => within(screen.getByRole('banner')).getByRole('group', { name: 'View' })
const rail = () => within(screen.getByRole('navigation', { name: 'Sidebar' })).getByRole('group', { name: 'Views' })
const footer = () => within(screen.getByRole('contentinfo', { name: 'Footer' })).getByRole('group', { name: 'Views' })
const pressed = () => screen.getAllByRole('button').filter((button) => button.dataset.viewButton !== undefined && button.getAttribute('aria-pressed') === 'true')

function useLayout(viewButtons: ViewButtons | undefined): void {
  revision.value += 1
  act(() => acceptAppSettings({ ...defaultAppSettings(), revision: revision.value, ...(viewButtons === undefined ? {} : { viewButtons }) }))
}

function views(over: Partial<ViewSwitch> = {}): ViewSwitch {
  return { layout: { header: ['canvas', 'session'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline', 'history'] }, view: 'canvas', project: PROJECT, onViewChange: () => {}, ...over }
}

beforeEach(() => useLayout(undefined))

afterEach(() => {
  cleanup()
  act(() => setFocusActive(false))
  readyCount.value = 0
  prCounts.value = []
  tickets.value = []
  openRunHistory.mockClear()
  patches.length = 0
})

describe('the default layout', () => {
  it('puts Canvas and Session in the header, Pull requests and Acceptance on the rail, Pipeline and Runs in the footer', () => {
    render(<AppShell />)
    expect(names(header())).toEqual(['Canvas', 'Session'])
    expect(names(rail())).toEqual(['Pull requests', 'Acceptance'])
    expect(names(footer())).toEqual(['Pipeline', 'Runs'])
  })

  it('draws the rail block outside the tablist of the sections, after it: a press switches the main area, not the panel', () => {
    render(<AppShell />)
    const tablist = screen.getByRole('tablist', { name: 'Sidebar sections' })
    expect(tablist.contains(rail())).toBe(false)
    expect(tablist.compareDocumentPosition(rail()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(rail()).getByRole('button', { name: 'Acceptance' }))
    expect(screen.getByRole('main', { name: 'Acceptance' })).toBeTruthy()
  })
})

describe('a layout the person made', () => {
  it('draws each zone in the order the layout says, and follows a change of it', () => {
    useLayout({ header: ['history', 'canvas'], rail: ['session'], footer: ['acceptance', 'pull-requests', 'pipeline'] })
    render(<AppShell project={PROJECT} />)
    expect(names(header())).toEqual(['Runs', 'Canvas'])
    expect(names(rail())).toEqual(['Session'])
    expect(names(footer())).toEqual(['Acceptance', 'Pull requests', 'Pipeline'])
    useLayout({ header: ['canvas'], rail: ['session', 'history'], footer: ['acceptance', 'pull-requests', 'pipeline'] })
    expect(names(header())).toEqual(['Canvas'])
    expect(names(rail())).toEqual(['Session', 'Runs'])
  })

  it('draws no group for an empty zone: the header keeps the Project title', () => {
    useLayout({ header: [], rail: [], footer: ['canvas', 'session', 'pipeline', 'history', 'pull-requests', 'acceptance'] })
    render(<AppShell project={PROJECT} />)
    expect(within(screen.getByRole('banner')).queryByRole('group', { name: 'View' })).toBeNull()
    expect(within(screen.getByRole('banner')).getByText('auberge')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Sidebar' })).queryByRole('group', { name: 'Views' })).toBeNull()
    expect(names(footer())).toHaveLength(6)
    useLayout({ header: ['canvas', 'session', 'pipeline', 'history', 'pull-requests', 'acceptance'], rail: [], footer: [] })
    expect(within(screen.getByRole('contentinfo', { name: 'Footer' })).queryByRole('group', { name: 'Views' })).toBeNull()
  })

  it('tells the header how many buttons it holds: from four on, the labels give way at 1400 px (shell.css)', () => {
    useLayout({ header: ['canvas', 'session', 'pipeline', 'history'], rail: ['pull-requests'], footer: ['acceptance'] })
    render(<AppShell project={PROJECT} />)
    expect(header().dataset.count).toBe('4')
  })
})

describe('the pressed button', () => {
  it.each<[ShellView, string]>([
    ['session', 'Session'],
    ['acceptance', 'Acceptance'],
    ['history', 'Runs'],
  ])('is the one of the view on screen, %s, in whatever zone it stands', (view, name) => {
    render(<AppShell project={PROJECT} view={view} />)
    expect(pressed().map((button) => button.getAttribute('aria-label'))).toEqual([name])
  })

  it('is none on a view without a button (a Code story)', () => {
    render(<AppShell project={PROJECT} view="story" />)
    expect(pressed()).toEqual([])
  })

  it('opens its view from any zone: Runs in the footer opens the Run history of the open Project', () => {
    const onViewChange = vi.fn()
    render(<AppShell project={PROJECT} onViewChange={onViewChange} />)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Runs' }))
    expect(openRunHistory).toHaveBeenCalledWith(PROJECT.id)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Pipeline' }))
    expect(onViewChange).toHaveBeenLastCalledWith('pipeline')
  })
})

describe('the three looks', () => {
  it('the header shows icon and label, the footer icon and label, the rail the icon alone with the «window» mark', () => {
    render(<AppShell project={PROJECT} />)
    const session = within(header()).getByRole('button', { name: 'Session' })
    expect(session.textContent).toBe('Session')
    expect(session.querySelector('svg')).not.toBeNull()
    expect(within(session).queryByTestId('view-button-window')).toBeNull()
    const runs = within(footer()).getByRole('button', { name: 'Runs' })
    expect(runs.textContent).toBe('Runs')
    expect(runs.title).toBe('Run history')
    expect(within(runs).queryByTestId('view-button-window')).toBeNull()
    const acceptance = within(rail()).getByRole('button', { name: 'Acceptance' })
    expect(acceptance.textContent).toBe('')
    expect(within(acceptance).getByTestId('view-button-window')).toBeTruthy()
    // The rail's tooltip is the kit's, on the right: a screen reader hears it as the description.
    expect(acceptance.getAttribute('aria-description')).toBe('Checks that wait for you')
  })

  it('an inactive button (no Project) is disabled in every zone, its tooltip says why', () => {
    useLayout({ header: ['canvas', 'history'], rail: ['pull-requests'], footer: ['session', 'pipeline', 'acceptance'] })
    render(<AppShell />)
    const runs = within(header()).getByRole('button', { name: 'Runs' }) as HTMLButtonElement
    expect(runs.disabled).toBe(true)
    expect(runs.title).toBe('Open a Project to see its Runs')
    const pulls = within(rail()).getByRole('button', { name: 'Pull requests' }) as HTMLButtonElement
    expect(pulls.disabled).toBe(true)
    expect(pulls.title).toBe('Open a Project to see its pull requests')
    useLayout({ header: ['canvas'], rail: ['pull-requests'], footer: ['session', 'pipeline', 'acceptance', 'history'] })
    const inFooter = within(footer()).getByRole('button', { name: 'Runs' }) as HTMLButtonElement
    expect(inFooter.disabled).toBe(true)
    expect(inFooter.title).toBe('Open a Project to see its Runs')
  })
})

describe('the badges', () => {
  it('Acceptance carries its count in the header and in the footer', () => {
    readyCount.value = 2
    useLayout({ header: ['canvas', 'acceptance'], rail: [], footer: ['session', 'pipeline', 'history', 'pull-requests'] })
    render(<AppShell project={PROJECT} />)
    expect(within(header()).getByTestId('acceptance-tab-count').textContent).toBe('2')
    useLayout({ header: ['canvas'], rail: [], footer: ['session', 'pipeline', 'history', 'pull-requests', 'acceptance'] })
    expect(within(footer()).getByTestId('acceptance-tab-count').textContent).toBe('2')
    expect(within(footer()).getByRole('button', { name: 'Acceptance' }).getAttribute('aria-description')).toBe('2 checks ready to check')
  })

  it('Pull requests counts the pull requests that need you, Pipeline has a dot while a Ticket waits for a person, in the footer and in the header', () => {
    prCounts.value = [
      { group: 'needs-review', count: 2 },
      { group: 'needs-fix', count: 1 },
      { group: 'yours', count: 5 },
    ]
    tickets.value = [
      { kind: 'implementing', blocked: null, waits: 'owner' },
      { kind: 'done', blocked: { reason: 'old' }, waits: null },
    ]
    useLayout({ header: ['canvas', 'pull-requests'], rail: [], footer: ['session', 'pipeline', 'history', 'acceptance'] })
    render(<AppShell project={PROJECT} />)
    const pulls = within(header()).getByRole('button', { name: 'Pull requests' })
    expect(within(pulls).getByTestId('view-button-badge').textContent).toBe('3')
    expect(pulls.getAttribute('aria-description')).toBe('3 pull requests need you')
    const pipeline = within(footer()).getByRole('button', { name: 'Pipeline' })
    expect(within(pipeline).getByTestId('view-button-badge').textContent).toBe('')
    expect(pipeline.getAttribute('aria-description')).toBe('1 Ticket waits')
    // An agent's Ticket calls nobody: no dot.
    tickets.value = [{ kind: 'implementing', blocked: null, waits: 'agent' }]
    useLayout({ header: ['canvas', 'pipeline'], rail: [], footer: ['session', 'pull-requests', 'history', 'acceptance'] })
    expect(within(within(header()).getByRole('button', { name: 'Pipeline' })).queryByTestId('view-button-badge')).toBeNull()
    expect(within(within(footer()).getByRole('button', { name: 'Pull requests' })).getByTestId('view-button-badge').textContent).toBe('3')
  })

  it('on the rail a View button has no badge while its namesake section stands there with its own', () => {
    readyCount.value = 2
    render(<SidebarView sections={[{ id: 'AcceptanceSection', order: 15, Component: () => null, rail: { title: 'Acceptance', end: false, start: true } }]} views={views()} />)
    expect(within(rail()).queryByTestId('acceptance-tab-count')).toBeNull()
  })

  it('on the rail a View button without a namesake section shows its badge, in the look of the rail', () => {
    readyCount.value = 3
    render(<SidebarView sections={[]} views={views()} />)
    const count = within(rail()).getByTestId('acceptance-tab-count')
    expect(count.textContent).toBe('3')
    expect(count.classList.contains('w-sidebar__rail-count')).toBe(true)
  })

  it('while the sidebar is hidden, the rail buttons stand at the end of the header after a line, with their badges', () => {
    readyCount.value = 1
    render(<AppShell project={PROJECT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(names(header())).toEqual(['Canvas', 'Session', 'Pull requests', 'Acceptance'])
    expect(header().querySelector('.w-view-zone__line')).not.toBeNull()
    expect(within(header()).getByTestId('acceptance-tab-count').textContent).toBe('1')
    expect(within(header()).queryByTestId('view-button-window')).toBeNull()
    // The choice is kept for the next case (sidebar-visibility.ts): back as it was.
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(names(rail())).toEqual(['Pull requests', 'Acceptance'])
  })
})

describe('focus mode', () => {
  it('makes the View buttons of the rail and the footer inert, and only them: the rest of the footer stays usable', () => {
    render(<AppShell project={PROJECT} />)
    expect(rail().closest('[inert]')).toBeNull()
    expect(footer().closest('[inert]')).toBeNull()
    act(() => setFocusActive(true))
    // Focus mode keeps a sidebar choice of its own (sidebar-visibility.ts): shown, its rail block is inert.
    if (screen.queryByRole('navigation', { name: 'Sidebar' }) === null) fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(rail().hasAttribute('inert')).toBe(true)
    expect(footer().hasAttribute('inert')).toBe(true)
    // The version chip stands next to the group, not in it (footer/Footer.tsx).
    expect(screen.getByRole('contentinfo', { name: 'Footer' }).closest('[inert]')).toBeNull()
    act(() => setFocusActive(false))
    expect(footer().hasAttribute('inert')).toBe(false)
  })
})

describe('the menu of a View button (ticket 05)', () => {
  const menu = () => screen.getByRole('menu', { name: /View button$/ })
  const item = (name: string) => within(menu()).getByRole('menuitemradio', { name })
  const reset = () => within(menu()).getByRole('menuitem', { name: 'Reset layout' })
  const viewButton = (id: string) => document.querySelector<HTMLButtonElement>(`[data-view-button="${id}"]`)
  const answered = () => act(async () => {})

  it('opens on a right click: Move to Header, Sidebar or Footer with the current zone checked and inactive, a line, Reset layout inactive at the default', () => {
    render(<AppShell project={PROJECT} />)
    fireEvent.contextMenu(within(footer()).getByRole('button', { name: 'Runs' }), { clientX: 40, clientY: 700 })
    expect(menu().getAttribute('aria-label')).toBe('Runs View button')
    expect(within(menu()).getByRole('group', { name: 'Move to' })).toBeTruthy()
    expect(within(menu()).getAllByRole('menuitemradio').map((each) => each.textContent)).toEqual(['Header', 'Sidebar', 'Footer'])
    expect(item('Footer').getAttribute('aria-checked')).toBe('true')
    expect(item('Footer').getAttribute('aria-disabled')).toBe('true')
    expect(item('Header').getAttribute('aria-disabled')).toBeNull()
    expect(within(menu()).getByRole('separator')).toBeTruthy()
    expect(reset().getAttribute('aria-disabled')).toBe('true')
  })

  it('Move to puts the button at the end of that zone with one settings patch, and the focus goes to it there', async () => {
    render(<AppShell project={PROJECT} />)
    fireEvent.contextMenu(within(footer()).getByRole('button', { name: 'Runs' }), { clientX: 40, clientY: 700 })
    fireEvent.click(item('Header'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(patches).toEqual([{ viewButtons: { header: ['canvas', 'session', 'history'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline'] } }])
    await answered()
    expect(names(header())).toEqual(['Canvas', 'Session', 'Runs'])
    expect(names(footer())).toEqual(['Pipeline'])
    expect(document.activeElement).toBe(within(header()).getByRole('button', { name: 'Runs' }))
  })

  it('opens with Shift+F10 on the focused button; Reset layout takes the field away, and every zone is the default again', async () => {
    useLayout({ header: ['canvas'], rail: ['session', 'pull-requests', 'acceptance'], footer: ['pipeline', 'history'] })
    render(<AppShell project={PROJECT} />)
    const session = within(rail()).getByRole('button', { name: 'Session' })
    session.focus()
    fireEvent.keyDown(session, { key: 'F10', shiftKey: true })
    expect(item('Sidebar').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio')
    expect(reset().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(reset())
    expect(patches).toEqual([{ viewButtons: null }])
    await answered()
    expect(names(header())).toEqual(['Canvas', 'Session'])
    expect(names(rail())).toEqual(['Pull requests', 'Acceptance'])
    expect(document.activeElement).toBe(viewButton('session'))
  })

  it('while the sidebar is hidden, Move to Sidebar puts the button at the end of the rail: it shows in the header after the line, focused', async () => {
    render(<AppShell project={PROJECT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    fireEvent.contextMenu(within(header()).getByRole('button', { name: 'Canvas' }), { clientX: 80, clientY: 20 })
    fireEvent.click(item('Sidebar'))
    expect(patches).toEqual([{ viewButtons: { header: ['session'], rail: ['pull-requests', 'acceptance', 'canvas'], footer: ['pipeline', 'history'] } }])
    await answered()
    expect(names(header())).toEqual(['Session', 'Pull requests', 'Acceptance', 'Canvas'])
    expect(viewButton('canvas')?.dataset.zone).toBe('rail')
    expect(document.activeElement).toBe(viewButton('canvas'))
    // The rail's buttons drawn in the header have the menu too: their zone is the rail.
    fireEvent.contextMenu(viewButton('canvas')!, { clientX: 300, clientY: 20 })
    expect(item('Sidebar').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
  })
})

describe('the keys that move a View button within its zone (ticket 05)', () => {
  const answered = () => act(async () => {})

  it('⌥→ and ⌥← in the header move the focused button, and the focus stays on it', async () => {
    render(<AppShell project={PROJECT} />)
    const canvas = within(header()).getByRole('button', { name: 'Canvas' })
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'ArrowRight', altKey: true })
    expect(patches).toEqual([{ viewButtons: { header: ['session', 'canvas'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline', 'history'] } }])
    await answered()
    expect(names(header())).toEqual(['Session', 'Canvas'])
    expect(document.activeElement).toBe(within(header()).getByRole('button', { name: 'Canvas' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft', altKey: true })
    await answered()
    expect(names(header())).toEqual(['Canvas', 'Session'])
    expect(document.activeElement).toBe(within(header()).getByRole('button', { name: 'Canvas' }))
  })

  it('at the edge of a zone nothing happens: only the menu moves a button to another zone', async () => {
    render(<AppShell project={PROJECT} />)
    const session = within(header()).getByRole('button', { name: 'Session' })
    session.focus()
    fireEvent.keyDown(session, { key: 'ArrowRight', altKey: true })
    const runs = within(footer()).getByRole('button', { name: 'Runs' })
    runs.focus()
    fireEvent.keyDown(runs, { key: 'ArrowRight', altKey: true })
    await answered()
    expect(patches).toEqual([])
    expect(document.activeElement).toBe(runs)
  })

  it('⌥↓ and ⌥↑ on the rail, ⌥← in the footer; the other axis does nothing there', async () => {
    render(<AppShell project={PROJECT} />)
    const pulls = within(rail()).getByRole('button', { name: 'Pull requests' })
    pulls.focus()
    fireEvent.keyDown(pulls, { key: 'ArrowRight', altKey: true })
    expect(patches).toEqual([])
    fireEvent.keyDown(pulls, { key: 'ArrowDown', altKey: true })
    await answered()
    expect(names(rail())).toEqual(['Acceptance', 'Pull requests'])
    expect(document.activeElement).toBe(within(rail()).getByRole('button', { name: 'Pull requests' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true })
    await answered()
    expect(names(rail())).toEqual(['Pull requests', 'Acceptance'])
    const runs = within(footer()).getByRole('button', { name: 'Runs' })
    runs.focus()
    fireEvent.keyDown(runs, { key: 'ArrowLeft', altKey: true })
    await answered()
    expect(names(footer())).toEqual(['Runs', 'Pipeline'])
    expect(document.activeElement).toBe(within(footer()).getByRole('button', { name: 'Runs' }))
  })

  it('the rail buttons drawn in the header move within the rail with ⌥← and ⌥→, and never past the line into the header', async () => {
    render(<AppShell project={PROJECT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    const acceptance = within(header()).getByRole('button', { name: 'Acceptance' })
    acceptance.focus()
    fireEvent.keyDown(acceptance, { key: 'ArrowLeft', altKey: true })
    expect(patches).toEqual([{ viewButtons: { header: ['canvas', 'session'], rail: ['acceptance', 'pull-requests'], footer: ['pipeline', 'history'] } }])
    await answered()
    expect(names(header())).toEqual(['Canvas', 'Session', 'Acceptance', 'Pull requests'])
    expect(document.activeElement).toBe(within(header()).getByRole('button', { name: 'Acceptance' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft', altKey: true })
    await answered()
    expect(patches).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
  })
})

describe('the parts without a shell', () => {
  it('ToolbarView takes the layout it is given; Footer and SidebarView draw no View buttons without one', () => {
    render(<ToolbarView items={[]} view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} layout={{ header: ['pipeline'], rail: [], footer: [] }} />)
    expect(names(header())).toEqual(['Pipeline'])
    cleanup()
    render(<Footer />)
    expect(screen.queryByRole('group', { name: 'Views' })).toBeNull()
  })
})

describe('a drag of a View button (ticket 06)', () => {
  const answered = () => act(async () => {})
  const transfer = () => ({ setData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' })
  const shell = () => screen.getByTestId('app-shell')
  const zoneOf = (zone: string) => document.querySelector<HTMLElement>(`.w-view-zone[data-zone="${zone}"]`)
  const viewButton = (id: string) => document.querySelector<HTMLButtonElement>(`[data-view-button="${id}"]`)!
  /**
   * jsdom lays nothing out: the buttons of a zone are given boxes side by side, 80 px wide (the rail's one above the
   * other, 34 px high), in the order they are drawn.
   */
  function layOut(zone: string): void {
    const buttons = [...document.querySelectorAll<HTMLElement>(`[data-view-button][data-zone="${zone}"]`)]
    buttons.forEach((button, at) => {
      const box = zone === 'rail' ? { left: 0, width: 34, top: at * 34, height: 34 } : { left: at * 80, width: 80, top: 0, height: 24 }
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) })
    })
  }
  /** A drag event at a point (jsdom has no DragEvent, so the coordinates are set on the plain event). */
  function dragAt(make: typeof createEvent.dragOver, target: HTMLElement, data: object, at: { x?: number; y?: number }): void {
    const event = make(target, { dataTransfer: data })
    Object.defineProperty(event, 'clientX', { value: at.x ?? 0 })
    Object.defineProperty(event, 'clientY', { value: at.y ?? 0 })
    fireEvent(target, event)
  }

  it('Runs dragged from the footer onto the left half of Session lands between Canvas and Session; while it goes every zone is lit and the marker stands before Session', async () => {
    render(<AppShell project={PROJECT} />)
    layOut('header')
    const data = transfer()
    fireEvent.dragStart(viewButton('history'), { dataTransfer: data })
    expect(data.setData).toHaveBeenCalledWith('application/x-worfy-view-button', 'history')
    expect(data.effectAllowed).toBe('move')
    expect(shell().dataset.viewDrag).toBe('history')
    expect(['header', 'rail', 'footer'].map((zone) => zoneOf(zone)?.dataset.dropZone)).toEqual(['on', 'on', 'on'])
    dragAt(createEvent.dragOver, viewButton('session'), data, { x: 100 })
    expect(['header', 'rail', 'footer'].map((zone) => zoneOf(zone)?.dataset.dropZone)).toEqual(['over', 'on', 'on'])
    expect(viewButton('session').dataset.dropMarker).toBe('before')
    expect(viewButton('canvas').dataset.dropMarker).toBeUndefined()
    dragAt(createEvent.drop, viewButton('session'), data, { x: 100 })
    fireEvent.dragEnd(viewButton('history'), { dataTransfer: data })
    expect(patches).toEqual([{ viewButtons: { header: ['canvas', 'history', 'session'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline'] } }])
    expect(shell().dataset.viewDrag).toBeUndefined()
    expect(document.querySelector('[data-drop-zone]')).toBeNull()
    expect(document.querySelector('[data-drop-marker]')).toBeNull()
    await answered()
    expect(names(header())).toEqual(['Canvas', 'Runs', 'Session'])
    expect(names(footer())).toEqual(['Pipeline'])
  })

  it('a drag that ends without a drop (Esc, or let go outside a zone) changes nothing and puts the zones out', async () => {
    render(<AppShell project={PROJECT} />)
    layOut('header')
    const data = transfer()
    fireEvent.dragStart(viewButton('pipeline'), { dataTransfer: data })
    dragAt(createEvent.dragOver, viewButton('canvas'), data, { x: 10 })
    expect(viewButton('canvas').dataset.dropMarker).toBe('before')
    dragAt(createEvent.dragLeave, zoneOf('header')!, data, { x: 500, y: 300 })
    expect(zoneOf('header')?.dataset.dropZone).toBe('on')
    expect(document.querySelector('[data-drop-marker]')).toBeNull()
    fireEvent.dragEnd(viewButton('pipeline'), { dataTransfer: data })
    await answered()
    expect(patches).toEqual([])
    expect(shell().dataset.viewDrag).toBeUndefined()
    expect(document.querySelector('[data-drop-zone]')).toBeNull()
    expect(names(footer())).toEqual(['Pipeline', 'Runs'])
  })

  it('within a zone: Canvas over the right half of Session goes after it, under the marker after Session; dropped where it stands nothing is sent', async () => {
    render(<AppShell project={PROJECT} />)
    layOut('header')
    const data = transfer()
    fireEvent.dragStart(viewButton('canvas'), { dataTransfer: data })
    dragAt(createEvent.dragOver, viewButton('session'), data, { x: 150 })
    expect(viewButton('session').dataset.dropMarker).toBe('after')
    dragAt(createEvent.drop, viewButton('session'), data, { x: 150 })
    fireEvent.dragEnd(viewButton('canvas'), { dataTransfer: data })
    expect(patches).toEqual([{ viewButtons: { header: ['session', 'canvas'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline', 'history'] } }])
    await answered()
    expect(names(header())).toEqual(['Session', 'Canvas'])
    layOut('header')
    fireEvent.dragStart(viewButton('canvas'), { dataTransfer: data })
    dragAt(createEvent.drop, viewButton('canvas'), data, { x: 100 })
    fireEvent.dragEnd(viewButton('canvas'), { dataTransfer: data })
    await answered()
    expect(patches).toHaveLength(1)
  })

  it('on the rail the gap is counted along the column: Acceptance over the upper half of Pull requests goes first', async () => {
    render(<AppShell project={PROJECT} />)
    layOut('rail')
    const data = transfer()
    fireEvent.dragStart(viewButton('acceptance'), { dataTransfer: data })
    dragAt(createEvent.dragOver, viewButton('pull-requests'), data, { x: 30, y: 10 })
    expect(viewButton('pull-requests').dataset.dropMarker).toBe('before')
    dragAt(createEvent.drop, viewButton('pull-requests'), data, { x: 30, y: 10 })
    fireEvent.dragEnd(viewButton('acceptance'), { dataTransfer: data })
    await answered()
    expect(names(rail())).toEqual(['Acceptance', 'Pull requests'])
  })

  it('an empty zone shows a «Drop here» place only while a drag goes, and takes the button dropped there', async () => {
    useLayout({ header: ['canvas', 'session', 'history'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline'] })
    render(<AppShell project={PROJECT} />)
    const data = transfer()
    fireEvent.dragStart(viewButton('pipeline'), { dataTransfer: data })
    dragAt(createEvent.drop, viewButton('canvas'), data, { x: 10 })
    fireEvent.dragEnd(viewButton('pipeline'), { dataTransfer: data })
    await answered()
    expect(within(screen.getByRole('contentinfo', { name: 'Footer' })).queryByRole('group', { name: 'Views' })).toBeNull()
    expect(screen.queryByText('Drop here')).toBeNull()
    fireEvent.dragStart(viewButton('session'), { dataTransfer: data })
    const place = within(screen.getByRole('contentinfo', { name: 'Footer' })).getByText('Drop here')
    expect(zoneOf('footer')?.dataset.dropZone).toBe('on')
    dragAt(createEvent.dragOver, place, data, { x: 10 })
    expect(zoneOf('footer')?.dataset.dropZone).toBe('over')
    dragAt(createEvent.drop, place, data, { x: 10 })
    fireEvent.dragEnd(viewButton('session'), { dataTransfer: data })
    await answered()
    expect(names(footer())).toEqual(['Session'])
    expect(screen.queryByText('Drop here')).toBeNull()
  })

  it('an inactive button (no Project) is dragged too: the layout does not depend on the Project', async () => {
    render(<AppShell />)
    layOut('header')
    expect(viewButton('history').disabled).toBe(true)
    expect(viewButton('history').draggable).toBe(true)
    const data = transfer()
    fireEvent.dragStart(viewButton('history'), { dataTransfer: data })
    dragAt(createEvent.drop, viewButton('canvas'), data, { x: 10 })
    fireEvent.dragEnd(viewButton('history'), { dataTransfer: data })
    await answered()
    expect(names(header())).toEqual(['Runs', 'Canvas', 'Session'])
  })

  it('a drag that began elsewhere (another window, a file) is no drop: the zone does not take it', async () => {
    render(<AppShell project={PROJECT} />)
    const data = transfer()
    const over = createEvent.dragOver(viewButton('canvas'), { dataTransfer: data })
    fireEvent(viewButton('canvas'), over)
    expect(over.defaultPrevented).toBe(false)
    fireEvent.drop(viewButton('canvas'), { dataTransfer: data })
    await answered()
    expect(patches).toEqual([])
    expect(document.querySelector('[data-drop-zone]')).toBeNull()
  })

  it('while the sidebar is hidden the rail buttons at the end of the header are no drop place: past the header\'s own buttons is the end of the header', async () => {
    render(<AppShell project={PROJECT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    layOut('header')
    const data = transfer()
    fireEvent.dragStart(viewButton('pipeline'), { dataTransfer: data })
    expect(zoneOf('rail')).toBeNull()
    dragAt(createEvent.dragOver, viewButton('acceptance'), data, { x: 400 })
    expect(viewButton('session').dataset.dropMarker).toBe('after')
    expect(viewButton('acceptance').dataset.dropMarker).toBeUndefined()
    dragAt(createEvent.drop, viewButton('acceptance'), data, { x: 400 })
    fireEvent.dragEnd(viewButton('pipeline'), { dataTransfer: data })
    expect(patches).toEqual([{ viewButtons: { header: ['canvas', 'session', 'pipeline'], rail: ['pull-requests', 'acceptance'], footer: ['history'] } }])
    await answered()
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
  })
})

describe('two key presses before main answers (ticket 05, review)', () => {
  it('the second ⌥→ steps on from the layout the first asked for, not from the one still drawn', async () => {
    useLayout({ header: ['canvas', 'session', 'pipeline'], rail: ['pull-requests', 'acceptance'], footer: ['history'] })
    render(<AppShell project={PROJECT} />)
    const canvas = within(header()).getByRole('button', { name: 'Canvas' })
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(canvas, { key: 'ArrowRight', altKey: true })
    expect(patches.at(-1)).toEqual({ viewButtons: { header: ['session', 'pipeline', 'canvas'], rail: ['pull-requests', 'acceptance'], footer: ['history'] } })
    await act(async () => {})
    expect(names(header())).toEqual(['Session', 'Pipeline', 'Canvas'])
  })
})
