// The frame of a sidebar section (src/renderer/shell/SidebarSection.tsx) in the panel of the sidebar
// (worfy-polish ticket 94): a region named by its heading of level 2, the header with the Projects the
// section shows (`scope`), its count and its buttons, a notice and an overlay outside the body. The
// panel shows one section at a time, so a section no longer collapses (Sidebar.tsx, sidebar-scope.ts).
// jsdom lays nothing out: the heights are checked against the built app (test/e2e/sidebar-sections.spec.ts).
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { SidebarSectionProps } from '../../src/renderer/shell/SidebarSection'

const TWO: ProjectsState = {
  projects: [
    { id: 'alpha-0000000a', name: 'alpha', path: '/projects/alpha', branch: 'main' },
    { id: 'beta-0000000b', name: 'beta', path: '/projects/beta', branch: 'main' },
  ],
  activeId: 'alpha-0000000a',
  revision: 1,
}

beforeEach(() => {
  // useProjects and sidebar-scope keep their state in modules: every test starts with fresh ones.
  vi.resetModules()
  localStorage.clear()
  const bridge: WorfyBridge = {
    invoke: (channel) => Promise.resolve(channel === 'projects.list' ? { ok: true, value: TWO } : { ok: false, error: `unexpected channel ${channel}` }),
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

async function mount(props: Partial<SidebarSectionProps> = {}, children: ReactNode = <button type="button">a row</button>) {
  const { SidebarSection } = await import('../../src/renderer/shell/SidebarSection')
  return render(
    <SidebarSection id="DemoSection" title="Demo" {...props}>
      {children}
    </SidebarSection>,
  )
}

const region = () => screen.getByRole('region', { name: 'Demo' })
const body = () => {
  const element = region().querySelector('.w-sidebar-section__body')
  if (!(element instanceof HTMLElement)) throw new Error('the section has no body')
  return element
}

describe('SidebarSection', () => {
  it('the heading is a heading of level 2 that names the region, not a button; the body holds the list', async () => {
    await mount()
    expect(within(region()).getByRole('heading', { level: 2, name: 'Demo' })).toBeTruthy()
    expect(region().tagName).toBe('SECTION')
    expect(within(region()).queryByRole('button', { name: 'Demo' })).toBeNull()
    expect(body().contains(screen.getByText('a row'))).toBe(true)
    expect(body().hidden).toBe(false)
  })

  it("the section's own buttons stand in the header, beside the heading and at the right edge", async () => {
    const onAdd = vi.fn()
    await mount({ meta: <button type="button">3 live</button>, trailing: <button type="button" onClick={onAdd}>Add</button> })
    fireEvent.click(within(region()).getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    const header = region().querySelector('.w-sidebar-section__header')
    expect(header?.contains(screen.getByRole('button', { name: '3 live' }))).toBe(true)
    expect(header?.contains(screen.getByRole('button', { name: 'Add' }))).toBe(true)
  })

  it('a notice and an overlay are outside the body', async () => {
    await mount({ notice: <p role="alert">could not add</p>, overlay: <div role="dialog" aria-label="History" /> })
    expect(body().contains(within(region()).getByRole('alert'))).toBe(false)
    expect(body().contains(within(region()).getByRole('dialog', { name: 'History' }))).toBe(false)
  })

  it('marks a section that shows a notice', async () => {
    const { SidebarSection } = await import('../../src/renderer/shell/SidebarSection')
    const draw = (notice: ReactNode) => (
      <SidebarSection id="DemoSection" title="Demo" notice={notice}>
        a row
      </SidebarSection>
    )
    const shown = render(draw(<p role="alert">could not add</p>))
    expect(region().getAttribute('data-notice')).toBe('true')
    // What a section passes while it has nothing to say: `cond ? <p/> : null`, `cond && <p/>`.
    for (const nothing of [null, undefined, false]) {
      shown.rerender(draw(nothing))
      expect(region().getAttribute('data-notice')).toBeNull()
    }
  })

  it('carries its id and a test id for the tests of the built app', async () => {
    await mount({ testId: 'demo-section' })
    expect(region().getAttribute('data-section-id')).toBe('DemoSection')
    expect(screen.getByTestId('demo-section')).toBe(region())
  })

  it('says nothing about Projects without `scope`', async () => {
    await mount()
    await act(async () => undefined)
    expect(screen.queryByTestId('sidebar-scope-label')).toBeNull()
    expect(screen.queryByTestId('sidebar-scope-note')).toBeNull()
  })

  it('a filtered section says «All Projects» under «All», and the open Project under one Project', async () => {
    await mount({ scope: 'filtered' })
    expect((await screen.findByTestId('sidebar-scope-label')).textContent).toBe('All Projects')
    expect(screen.queryByTestId('sidebar-scope-note')).toBeNull()
    const { setSidebarScope } = await import('../../src/renderer/shell/sidebar-scope')
    act(() => setSidebarScope('project'))
    expect(screen.getByTestId('sidebar-scope-label').textContent).toBe('alpha')
  })

  it('no section says it shows the open Project alone: Sessions and ADR follow the switcher too (worfy-polish ticket 99)', async () => {
    await mount({ scope: 'filtered' })
    expect((await screen.findByTestId('sidebar-scope-label')).textContent).toBe('All Projects')
    expect(document.body.textContent).not.toContain('only: this list does not show other Projects')
  })
})

// "New Product Session" in the Sessions section (shell/sidebar/SessionsSection.tsx,
// worfy-product-session ticket 06): an entry of its own beside "New session", with no Vendor picker —
// a Product Session runs on Claude Code only — that opens the new Session in the Session view.
describe('Sessions: New Product Session', () => {
  const PROJECT_ID = 'demo-0000000a'
  const LIST = { projects: [{ id: PROJECT_ID, name: 'demo', path: '/Users/test/projects/demo', branch: 'main' }], activeId: PROJECT_ID, revision: 1 }
  const HINT = 'Mini gives this Machine read-only access'

  /** A main that knows the Project and answers `sessions.new` with `answer`; records every call. */
  function preload(answer: IpcResult<{ nodeId: string }>): { channel: string; input: unknown }[] {
    const asked: { channel: string; input: unknown }[] = []
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel, input) => {
        asked.push({ channel, input })
        if (channel === 'sessions.new') return Promise.resolve(answer)
        const value: unknown =
          channel === 'projects.list'
            ? LIST
            : channel === 'claudeHome.sessions'
              ? { live: [], history: [] }
              : channel === 'claudeHome.live'
                ? { live: [] }
                : channel === 'sessions.views'
                  ? { views: [] }
                  : channel === 'layout.get'
                    ? { layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 }
                    : undefined
        return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
      },
      on: () => 1,
      off: () => undefined,
    }
    return asked
  }

  async function draw(readOnly: string | null = null): Promise<HTMLElement> {
    vi.doMock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
      useReadOnly: () => readOnly,
    }))
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const { default: SessionsSection } = await import('../../src/renderer/shell/sidebar/SessionsSection')
    render(<SessionsSection />)
    return screen.findByTestId('sidebar-new-product-session')
  }

  afterEach(() => {
    vi.doUnmock('../../src/renderer/projects/useProjects')
  })

  it('asks sessions.new for a Session of kind product with no Vendor, offers no Vendor picker, and opens the Session view on its Node', async () => {
    const asked = preload({ ok: true, value: { nodeId: 'session-new-1' } })
    const entry = await draw()
    // The prototype's label; the name a screen reader hears stays "New Product Session".
    expect(entry.textContent).toBe('Product Session')
    expect(entry.getAttribute('aria-label')).toBe('New Product Session')
    expect(entry.getAttribute('aria-haspopup')).toBeNull()
    await act(async () => {
      fireEvent.click(entry)
    })
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    await vi.waitFor(() => expect(useNavigation.getState().view).toBe('session'))
    expect(useNavigation.getState().opened[PROJECT_ID]).toEqual({ nodeId: 'session-new-1', projectId: PROJECT_ID })
    expect(asked.filter((each) => each.channel === 'sessions.new').map((each) => each.input)).toEqual([{ projectId: PROJECT_ID, kind: 'product' }])
    // No Vendor picker: it asks main for no Vendors and shows no list.
    expect(asked.some((each) => each.channel === 'sessions.vendors')).toBe(false)
    expect(screen.queryByTestId('new-session-vendor-option')).toBeNull()
  })

  it("shows main's refusal in the section and stays on the Canvas", async () => {
    preload({ ok: false, error: 'Product Session runs on Claude Code only' })
    const entry = await draw()
    await act(async () => {
      fireEvent.click(entry)
    })
    expect((await screen.findByRole('alert')).textContent).toBe('Product Session runs on Claude Code only')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('on a read-only screen it is inactive with the hint of New session, and a click starts nothing', async () => {
    const asked = preload({ ok: true, value: { nodeId: 'session-new-1' } })
    const entry = await draw(HINT)
    expect(entry.getAttribute('aria-disabled')).toBe('true')
    expect(entry.getAttribute('data-kit-hint')).toBe(HINT)
    expect(screen.getByTestId('sidebar-new-session').getAttribute('data-kit-hint')).toBe(HINT)
    fireEvent.click(entry)
    expect(asked.some((each) => each.channel === 'sessions.new')).toBe(false)
  })
})

describe('Sessions, Epics and ADR with no Project open, and the badge of Sessions', () => {
  const PROJECT_ID = 'demo-0000000a'
  const LIST = { projects: [{ id: PROJECT_ID, name: 'demo', path: '/projects/demo', branch: 'main' }], activeId: PROJECT_ID, revision: 1 }
  const NONE = { projects: [], activeId: null, revision: 1 }
  const LIVE = [1, 2].map((pid) => ({ pid, sessionId: `live-${pid}`, cwd: '/projects/demo', status: 'idle' }))
  // One of the two is busy in the live state of the Projects (projectPulse.get).
  const PULSE = { projects: [{ projectId: PROJECT_ID, live: [LIVE[0], { ...LIVE[1], status: 'busy' }], busy: 1, prNeedYou: null, waits: null }] }

  function preload(list: unknown): void {
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel) => {
        const value: unknown =
          channel === 'projects.list'
            ? list
            : channel === 'claudeHome.sessions'
              ? { live: LIVE, history: [] }
              : channel === 'claudeHome.live'
                ? { live: LIVE }
                : channel === 'sessions.views'
                  ? { views: [] }
                  : channel === 'layout.get'
                    ? { layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 }
                    : channel === 'projectPulse.get'
                      ? PULSE
                      : undefined
        return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
      },
      on: () => 1,
      off: () => undefined,
    }
  }

  it.each([
    ['SessionsSection', 'Sessions', 'Open a Project to see its Sessions.'],
    ['EpicsSection', 'Epics', 'Open a Project to see its Epics.'],
    ['AdrSection', 'ADR', 'Open a Project to see its ADRs.'],
  ])('%s keeps its header and says what brings its list, not a blank panel', async (file, title, line) => {
    preload(NONE)
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(NONE as ProjectsState)
    const { default: Section } = (await import(`../../src/renderer/shell/sidebar/${file}.tsx`)) as { default: () => ReactNode }
    render(<Section />)
    const section = screen.getByRole('region', { name: title })
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe(title)
    expect(within(section).getByTestId('sidebar-no-project').textContent).toBe(line)
  })

  it('counts the busy Sessions on the rail in the tone of work, as the prototype does: live alone is not counted', async () => {
    preload(LIST)
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    const { default: SessionsSection } = await import('../../src/renderer/shell/sidebar/SessionsSection')
    render(<SessionsSection />)
    await screen.findAllByTestId('sidebar-session')
    const { result } = renderHook(() => scope.useRailBadge('SessionsSection'))
    await waitFor(() => expect(result.current).toEqual({ tone: 'working', count: 1, label: '1 busy' }))
  })
})
