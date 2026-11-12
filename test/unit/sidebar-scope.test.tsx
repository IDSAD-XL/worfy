// What the sidebar shows (worfy-polish ticket 94): the Project switcher's answer and the section of the
// panel (src/renderer/shell/sidebar-scope.ts), the rail and the panel (Sidebar.tsx) and the switcher
// itself (ProjectSwitcher.tsx). The real sections are checked against the built app
// (test/e2e/sidebar-rail.spec.ts); here the sections are stand-ins.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectsState } from '../../src/shared/ipc/projects'

const ALPHA = { id: 'alpha-0000000a', name: 'alpha', path: '/projects/alpha', branch: 'main' }
const BETA = { id: 'beta-0000000b', name: 'beta', path: '/projects/beta', branch: 'next' }
const LIST: ProjectsState = { projects: [ALPHA, BETA], activeId: ALPHA.id, revision: 1 }

let asked: { channel: string; input: unknown }[]

beforeEach(() => {
  // useProjects and sidebar-scope keep their state in modules: every test starts with fresh ones.
  vi.resetModules()
  localStorage.clear()
  asked = []
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      asked.push({ channel, input })
      if (channel === 'projects.list') return Promise.resolve({ ok: true, value: LIST })
      if (channel === 'projects.select') return Promise.resolve({ ok: true, value: { ...LIST, activeId: (input as { id: string }).id, revision: 2 } })
      return Promise.resolve({ ok: false, error: `unexpected channel ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

const scopeModule = () => import('../../src/renderer/shell/sidebar-scope')

describe('the Projects a section shows', () => {
  it('under «All»: every Project of the window', async () => {
    const { projectsInScope } = await scopeModule()
    expect(projectsInScope(LIST.projects, 'all', ALPHA.id)).toEqual([ALPHA, BETA])
  })

  it('under one Project: the open one alone', async () => {
    const { projectsInScope } = await scopeModule()
    expect(projectsInScope(LIST.projects, 'project', BETA.id)).toEqual([BETA])
  })

  it('under one Project with none open — the open one was closed — every Project, so nothing is hidden', async () => {
    const { projectsInScope } = await scopeModule()
    expect(projectsInScope(LIST.projects, 'project', null)).toEqual([ALPHA, BETA])
    expect(projectsInScope(LIST.projects, 'project', 'gone-0000000c')).toEqual([ALPHA, BETA])
    expect(projectsInScope([], 'project', null)).toEqual([])
  })

  it('reads a saved answer: «project» is one Project, anything else is «All»', async () => {
    const { parseScope } = await scopeModule()
    expect(parseScope('project')).toBe('project')
    expect(parseScope('all')).toBe('all')
    expect(parseScope(null)).toBe('all')
    expect(parseScope('alpha-0000000a')).toBe('all')
  })

  it('the panel holds the saved section while it exists, else the first', async () => {
    const { pickSection } = await scopeModule()
    expect(pickSection('EpicsSection', ['ProjectsSection', 'EpicsSection'])).toBe('EpicsSection')
    expect(pickSection('GoneSection', ['ProjectsSection', 'EpicsSection'])).toBe('ProjectsSection')
    expect(pickSection(null, ['ProjectsSection'])).toBe('ProjectsSection')
    expect(pickSection(null, [])).toBeUndefined()
  })
})

describe('keeping the choices', () => {
  it('starts from «All» and no section when nothing is saved', async () => {
    const { useSidebarScope } = await scopeModule()
    expect(useSidebarScope.getState()).toEqual({ scope: 'all', section: null })
  })

  it('writes both choices to localStorage, and a new window (a fresh module) starts from them', async () => {
    const first = await scopeModule()
    first.setSidebarScope('project')
    first.showSidebarSection('EpicsSection')
    expect(localStorage.getItem(first.SIDEBAR_SCOPE_KEY)).toBe('project')
    expect(localStorage.getItem(first.SIDEBAR_SECTION_KEY)).toBe('EpicsSection')
    vi.resetModules()
    const next = await scopeModule()
    expect(next.useSidebarScope.getState()).toEqual({ scope: 'project', section: 'EpicsSection' })
  })

  it('a storage that refuses to be read reads as the defaults, and one that refuses a write keeps the choice in the window', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { setSidebarScope, useSidebarScope } = await scopeModule()
    expect(useSidebarScope.getState().scope).toBe('all')
    setSidebarScope('project')
    expect(setItem).toHaveBeenCalled()
    expect(useSidebarScope.getState().scope).toBe('project')
    expect(error).toHaveBeenCalled()
  })

  it('a badge set twice with the same value does not wake its readers', async () => {
    const { setRailBadge, useRailBadge } = await scopeModule()
    let renders = 0
    function Probe() {
      renders++
      const badge = useRailBadge('DemoSection')
      return <span>{badge?.label ?? 'none'}</span>
    }
    render(<Probe />)
    act(() => setRailBadge('DemoSection', { tone: 'working', count: 2, label: '2 live' }))
    const after = renders
    act(() => setRailBadge('DemoSection', { tone: 'working', count: 2, label: '2 live' }))
    expect(renders).toBe(after)
    expect(screen.getByText('2 live')).toBeTruthy()
    act(() => setRailBadge('DemoSection', undefined))
    expect(screen.getByText('none')).toBeTruthy()
  })
})

const stand = (text: string) =>
  function Stand() {
    return <p>{text}</p>
  }

async function drawSidebar(onToggle?: () => void) {
  const { collectExtensions } = await import('../../src/renderer/shell/registry')
  const { SidebarView } = await import('../../src/renderer/shell/Sidebar')
  const sections = collectExtensions({
    './sidebar/ProjectsSection.tsx': { default: stand('Projects body'), order: 10, railTitle: 'Projects' },
    './sidebar/MachinesSection.tsx': { default: stand('Machines body'), order: 15, railTitle: 'Machines', railEnd: true },
    './sidebar/EpicsSection.tsx': { default: stand('Epics body'), order: 20, railTitle: 'Epics' },
    './sidebar/PlainSection.tsx': { default: stand('Plain body'), order: 30 },
  })
  return render(<SidebarView sections={sections} onToggle={onToggle} />)
}

const rail = () => screen.getByRole('tablist', { name: 'Sidebar sections' })
const tabNames = () => within(rail()).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))
const shownBodies = () => screen.getAllByText(/body$/).filter((node) => node.closest('[hidden]') === null).map((node) => node.textContent)

describe('the rail and the panel', () => {
  it('has a tab per section, the foot ones last, named by railTitle or by the file name', async () => {
    await drawSidebar()
    expect(tabNames()).toEqual(['Projects', 'Epics', 'Plain', 'Machines'])
    // Settings is a button of the rail, not a section: it stands outside the tablist, which holds tabs alone.
    expect(within(rail()).queryByRole('button', { name: 'Settings' })).toBeNull()
    expect([...rail().children].map((child) => child.getAttribute('role'))).toEqual(['tab', 'tab', 'tab', 'tab'])
    expect(within(screen.getByRole('navigation', { name: 'Sidebar' })).getByRole('button', { name: 'Settings' })).toBeTruthy()
    // The first section of the foot carries the mark that pushes the foot down.
    expect(within(rail()).getAllByRole('tab').map((tab) => tab.hasAttribute('data-rail-foot'))).toEqual([false, false, false, true])
  })

  it('shows the first section alone; the other sections stay mounted, hidden', async () => {
    await drawSidebar()
    expect(shownBodies()).toEqual(['Projects body'])
    expect(screen.getByText('Epics body').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
    const tab = within(rail()).getByRole('tab', { name: 'Projects' })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')?.textContent).toBe('Projects body')
  })

  it('a click on a tab shows its section and saves the choice', async () => {
    await drawSidebar()
    fireEvent.click(within(rail()).getByRole('tab', { name: 'Epics' }))
    expect(shownBodies()).toEqual(['Epics body'])
    expect(within(rail()).getByRole('tab', { name: 'Epics' }).getAttribute('aria-selected')).toBe('true')
    const { SIDEBAR_SECTION_KEY } = await scopeModule()
    expect(localStorage.getItem(SIDEBAR_SECTION_KEY)).toBe('EpicsSection')
  })

  it('opens on the saved section', async () => {
    localStorage.setItem('worfy.sidebar.section', 'MachinesSection')
    await drawSidebar()
    expect(shownBodies()).toEqual(['Machines body'])
  })

  it('is one tab stop; ↓ and ↑ walk it and wrap round, Home and End go to its ends, and the section follows the focus', async () => {
    await drawSidebar()
    const tabs = within(rail()).getAllByRole('tab')
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])
    tabs[0]!.focus()
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[1])
    expect(shownBodies()).toEqual(['Epics body'])
    fireEvent.keyDown(tabs[1]!, { key: 'End' })
    expect(document.activeElement).toBe(tabs[3])
    fireEvent.keyDown(tabs[3]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tabs[3])
    fireEvent.keyDown(tabs[3]!, { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])
    expect(shownBodies()).toEqual(['Projects body'])
  })

  it('shows a badge on the tab of a section that sets one, and names it in the tooltip', async () => {
    await drawSidebar()
    const { setRailBadge } = await scopeModule()
    act(() => setRailBadge('EpicsSection', { tone: 'blocked', count: 3, label: '3 need you' }))
    const tab = within(rail()).getByRole('tab', { name: 'Epics' })
    expect(within(tab).getByTestId('sidebar-rail-badge').textContent).toBe('3')
    // The tooltip is the Tooltip kit's (worfy-ui-kit ticket 13), shown on the keyboard focus; the badge is the description.
    expect(tab.hasAttribute('title')).toBe(false)
    expect(tab.getAttribute('aria-description')).toBe('3 need you')
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => tab.focus())
    expect((await screen.findByRole('tooltip')).textContent).toBe('Epics — 3 need you')
    act(() => tab.blur())
    act(() => setRailBadge('EpicsSection', { tone: 'ready', label: 'online' }))
    expect(within(tab).getByTestId('sidebar-rail-badge').textContent).toBe('')
    act(() => setRailBadge('EpicsSection', undefined))
    expect(within(tab).queryByTestId('sidebar-rail-badge')).toBeNull()
  })

  it('has the button that hides the sidebar in its strip at the top when given one', async () => {
    const onToggle = vi.fn()
    const first = await drawSidebar(onToggle)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    first.unmount()
    await drawSidebar()
    expect(screen.queryByRole('button', { name: 'Hide sidebar' })).toBeNull()
  })

  it('lays out the top as the owner chose: the strip holds the wordmark, then the button at its end; the switcher has a row of its own under it, before the rail', async () => {
    const { container } = await drawSidebar(() => undefined)
    const nav = container.querySelector('nav')
    const strip = container.querySelector('.w-sidebar__titlebar')
    expect([...(nav?.children ?? [])].map((child) => child.className)).toEqual(['w-sidebar__titlebar', 'w-sidebar__switcher', 'w-sidebar__body'])
    expect([...(strip?.children ?? [])].map((child) => child.getAttribute('data-testid') ?? child.getAttribute('aria-label') ?? child.className)).toEqual(['sidebar-wordmark', 'w-sidebar__titlebar-gap', 'Hide sidebar'])
    expect(screen.getByTestId('sidebar-wordmark').textContent).toBe('worfy')
    expect(screen.getByTestId('sidebar-wordmark').closest('a')).toBeNull()
    expect(container.querySelector('.w-sidebar__switcher [data-testid="project-switcher"]')).not.toBeNull()
  })
})

describe('the Project switcher', () => {
  async function drawSwitcher() {
    const { ProjectSwitcher } = await import('../../src/renderer/shell/ProjectSwitcher')
    render(<ProjectSwitcher />)
    await screen.findByRole('button', { name: 'Sidebar shows: All Projects' })
  }
  const menu = () => screen.getByRole('menu', { name: 'Sidebar shows' })
  const item = (name: string) => within(menu()).getByRole('menuitemradio', { name: new RegExp(`^${name}`) })

  it('opens on «All Projects» and every Project of the window, the answer checked and focused', async () => {
    await drawSwitcher()
    fireEvent.click(screen.getByTestId('project-switcher'))
    expect(within(menu()).getAllByRole('menuitemradio').map((each) => each.textContent)).toEqual(['All Projects', 'alphamain', 'betanext'])
    expect(item('All Projects').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(item('All Projects'))
  })

  it('one Project opens that Project and shows it alone; the answer is saved', async () => {
    await drawSwitcher()
    fireEvent.click(screen.getByTestId('project-switcher'))
    await act(async () => {
      fireEvent.click(item('beta'))
    })
    expect(asked.filter((each) => each.channel === 'projects.select').map((each) => each.input)).toEqual([{ id: BETA.id }])
    expect(await screen.findByRole('button', { name: 'Sidebar shows: beta' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(localStorage.getItem('worfy.sidebar.scope')).toBe('project')
  })

  it('the open Project alone opens nothing; «All Projects» brings every Project back', async () => {
    await drawSwitcher()
    fireEvent.click(screen.getByTestId('project-switcher'))
    fireEvent.click(item('alpha'))
    expect(await screen.findByRole('button', { name: 'Sidebar shows: alpha' })).toBeTruthy()
    expect(asked.some((each) => each.channel === 'projects.select')).toBe(false)
    fireEvent.click(screen.getByTestId('project-switcher'))
    expect(item('alpha').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(item('All Projects'))
    expect(screen.getByRole('button', { name: 'Sidebar shows: All Projects' })).toBeTruthy()
    expect(localStorage.getItem('worfy.sidebar.scope')).toBe('all')
  })

  it('↓ and ↑ walk the menu and wrap round; Esc closes it and gives the focus back to the button', async () => {
    await drawSwitcher()
    const button = screen.getByTestId('project-switcher')
    fireEvent.click(button)
    fireEvent.keyDown(menu(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('alpha'))
    fireEvent.keyDown(menu(), { key: 'End' })
    expect(document.activeElement).toBe(item('beta'))
    fireEvent.keyDown(menu(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('All Projects'))
    fireEvent.keyDown(menu(), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('a press outside closes the menu', async () => {
    await drawSwitcher()
    fireEvent.click(screen.getByTestId('project-switcher'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it("says why a Project could not be opened", async () => {
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel) => Promise.resolve(channel === 'projects.list' ? { ok: true, value: LIST } : { ok: false, error: 'the folder is gone' }),
      on: () => 1,
      off: () => undefined,
    }
    await drawSwitcher()
    fireEvent.click(screen.getByTestId('project-switcher'))
    await act(async () => {
      fireEvent.click(item('beta'))
    })
    expect((await screen.findByRole('alert')).textContent).toBe('beta could not be opened: the folder is gone')
    // The refusal keeps the answer the switcher had: the sidebar does not narrow to the Project that stayed open.
    expect(screen.getByRole('button', { name: 'Sidebar shows: All Projects' })).toBeTruthy()
    expect(localStorage.getItem('worfy.sidebar.scope')).toBeNull()
  })

  it('a Project that opens after «All Projects» was picked in the meantime does not narrow the sidebar', async () => {
    let answer: (value: IpcResult<unknown>) => void = () => undefined
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel) => (channel === 'projects.list' ? Promise.resolve({ ok: true, value: LIST }) : new Promise((resolve) => (answer = resolve))),
      on: () => 1,
      off: () => undefined,
    }
    await drawSwitcher()
    fireEvent.click(screen.getByTestId('project-switcher'))
    fireEvent.click(item('beta'))
    // Before beta answers, the sidebar still shows every Project.
    expect(screen.getByRole('button', { name: 'Sidebar shows: All Projects' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('project-switcher'))
    fireEvent.click(item('All Projects'))
    await act(async () => {
      answer({ ok: true, value: { ...LIST, activeId: BETA.id, revision: 2 } })
    })
    expect(screen.getByRole('button', { name: 'Sidebar shows: All Projects' })).toBeTruthy()
    expect(localStorage.getItem('worfy.sidebar.scope')).toBe('all')
  })
})
