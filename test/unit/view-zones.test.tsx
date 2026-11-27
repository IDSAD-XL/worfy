// The View buttons in their three zones (worfy-layout ticket 04; spec, the section on one button in three looks, Seam 3): the
// header, the block of the rail under a line and the left of the footer draw the buttons the layout puts there, in its
// order; the button of the view on screen is pressed in any zone; the badges come from the views' own sources; a zone
// without buttons draws nothing; while the sidebar is hidden the rail's buttons stand at the end of the header; in focus
// mode the rail's and the footer's buttons are inert.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openRunHistory, readyCount } = vi.hoisted(() => ({ openRunHistory: vi.fn(() => Promise.resolve()), readyCount: { value: 0 } }))
vi.mock('../../src/renderer/flight-recorder/open', () => ({ openRunHistory }))
vi.mock('../../src/renderer/acceptance/useAcceptance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/acceptance/useAcceptance')>()),
  useReadyCount: () => readyCount.value,
}))

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

let revision = 1_000
function useLayout(viewButtons: ViewButtons | undefined): void {
  revision += 1
  act(() => acceptAppSettings({ ...defaultAppSettings(), revision, ...(viewButtons === undefined ? {} : { viewButtons }) }))
}

function views(over: Partial<ViewSwitch> = {}): ViewSwitch {
  return { layout: { header: ['canvas', 'session'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline', 'history'] }, view: 'canvas', project: PROJECT, onViewChange: () => {}, ...over }
}

beforeEach(() => useLayout(undefined))

afterEach(() => {
  cleanup()
  act(() => setFocusActive(false))
  readyCount.value = 0
  openRunHistory.mockClear()
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

describe('the parts without a shell', () => {
  it('ToolbarView takes the layout it is given; Footer and SidebarView draw no View buttons without one', () => {
    render(<ToolbarView items={[]} view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} layout={{ header: ['pipeline'], rail: [], footer: [] }} />)
    expect(names(header())).toEqual(['Pipeline'])
    cleanup()
    render(<Footer />)
    expect(screen.queryByRole('group', { name: 'Views' })).toBeNull()
  })
})
