import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { forwardRef, lazy, memo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import { collectExtensions } from '../../src/renderer/shell/registry'
import { SidebarView } from '../../src/renderer/shell/Sidebar'
import { ToolbarView } from '../../src/renderer/shell/Toolbar'
import { AppShell } from '../../src/renderer/shell/AppShell'
import { ListRow, PrimaryButton, SegmentedControl, StatusChip } from '../../src/renderer/theme/primitives'

const section = (text: string) =>
  function Section() {
    return <p>{text}</p>
  }

describe('collectExtensions', () => {
  it('turns glob results into components ordered by `order`, then by file name', () => {
    const extensions = collectExtensions({
      './sidebar/SessionsSection.tsx': { default: section('Sessions'), order: 30 },
      './sidebar/ProjectsSection.tsx': { default: section('Projects'), order: 10 },
      './sidebar/AdrSection.tsx': { default: section('ADR'), order: 30 },
    })
    expect(extensions.map(({ id, order }) => [id, order])).toEqual([
      ['ProjectsSection', 10],
      ['AdrSection', 30],
      ['SessionsSection', 30],
    ])
  })

  it('accepts components wrapped in memo, forwardRef or lazy', () => {
    const Plain = section('Plain')
    const extensions = collectExtensions({
      './sidebar/MemoSection.tsx': { default: memo(Plain), order: 1 },
      './sidebar/RefSection.tsx': { default: forwardRef<HTMLParagraphElement>((_props, ref) => <p ref={ref}>Ref</p>), order: 2 },
      './sidebar/LazySection.tsx': { default: lazy(() => Promise.resolve({ default: Plain })), order: 3 },
    })
    expect(extensions.map(({ id }) => id)).toEqual(['MemoSection', 'RefSection', 'LazySection'])
    render(<SidebarView sections={extensions.slice(0, 2)} />)
    expect(screen.getByText('Plain')).toBeTruthy()
    expect(screen.getByText('Ref')).toBeTruthy()
  })

  it('rejects a module whose default export is not a component', () => {
    expect(() => collectExtensions({ './sidebar/TextSection.tsx': { default: 'div', order: 1 } })).toThrow(/TextSection.tsx must default-export/)
    expect(() => collectExtensions({ './sidebar/NullSection.tsx': { default: null, order: 1 } })).toThrow(/NullSection.tsx must default-export/)
  })

  it('rejects a module without a component', () => {
    expect(() => collectExtensions({ './sidebar/BrokenSection.tsx': { order: 1 } })).toThrow(/BrokenSection.tsx must default-export/)
  })

  it('rejects a module without a numeric order', () => {
    expect(() => collectExtensions({ './toolbar/Gate.tsx': { default: section('Gate') } })).toThrow(/Gate.tsx must export a numeric `order`/)
  })
})

describe('SidebarView', () => {
  it('renders one block per section file, in order, without knowing the sections', () => {
    const sections = collectExtensions({
      './sidebar/EpicsSection.tsx': { default: section('Epics body'), order: 20 },
      './sidebar/ProjectsSection.tsx': { default: section('Projects body'), order: 10 },
    })
    render(<SidebarView sections={sections} />)
    const nav = screen.getByRole('navigation', { name: 'Sidebar' })
    expect(within(nav).getAllByText(/body$/).map((node) => node.textContent)).toEqual(['Projects body', 'Epics body'])
  })
})

describe('ToolbarView', () => {
  const base = { items: [], view: 'canvas' as const, onViewChange: () => {}, sidebarVisible: true, onToggleSidebar: () => {} }

  it('shows the project name and branch', () => {
    render(<ToolbarView {...base} project={{ name: 'auction', branch: 'main' }} />)
    expect(screen.getByText('worfy — auction')).toBeTruthy()
    expect(screen.getByText('main').className).toContain('w-mono')
  })

  it('places toolbar items before the command palette hint', () => {
    const items = collectExtensions({ './toolbar/Gate.tsx': { default: section('Gate item'), order: 1 } })
    render(<ToolbarView {...base} items={items} />)
    const header = screen.getByRole('banner')
    const text = header.textContent ?? ''
    expect(text.indexOf('Gate item')).toBeGreaterThan(text.indexOf('Session'))
    expect(text.indexOf('Gate item')).toBeLessThan(text.indexOf('⌘K'))
  })
})

describe('AppShell', () => {
  it('switches between the Canvas and Session views', () => {
    render(<AppShell canvas={<p>canvas body</p>} session={<p>session body</p>} />)
    expect(screen.getByText('canvas body').closest('[hidden]')).toBeNull()
    expect(screen.getByText('session body').closest('[hidden]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Session' }))
    expect(screen.getByRole('main', { name: 'Session' })).toBeTruthy()
    expect(screen.getByText('session body').closest('[hidden]')).toBeNull()
    expect(screen.getByText('canvas body').closest('[hidden]')).not.toBeNull()
  })

  it('keeps the inactive view mounted, so its in-memory state survives a switch', () => {
    function Counter() {
      const [count, setCount] = useState(0)
      return (
        <button type="button" onClick={() => setCount((n) => n + 1)}>
          clicks {count}
        </button>
      )
    }
    render(<AppShell canvas={<Counter />} session={<p>session body</p>} />)
    fireEvent.click(screen.getByRole('button', { name: 'clicks 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }))
    expect(screen.getByRole('button', { name: 'clicks 1' })).toBeTruthy()
  })

  it('hides and shows the sidebar', () => {
    render(<AppShell />)
    const toolbar = screen.getByRole('banner')
    expect(toolbar.dataset.sidebar).toBe('visible')
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull()
    expect(toolbar.dataset.sidebar).toBe('hidden')
    expect(screen.getByTestId('app-shell').dataset.sidebar).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeTruthy()
    expect(toolbar.dataset.sidebar).toBe('visible')
  })

  it.each([
    ['mac', 'Hide sidebar (⌘B)', 'Meta+B'],
    ['windows', 'Hide sidebar (Ctrl+B)', 'Control+B'],
  ])('on %s the button names the keys of View ▸ Toggle Sidebar in its tooltip, and keeps its name', (system, tooltip, keys) => {
    document.documentElement.dataset.platform = system
    render(<AppShell />)
    const button = screen.getByRole('button', { name: 'Hide sidebar' })
    expect(button.getAttribute('title')).toBe(tooltip)
    expect(button.getAttribute('aria-keyshortcuts')).toBe(keys)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})

// Whether the sidebar is shown is kept in the app settings, apart for the normal view and focus
// mode (src/renderer/shell/sidebar-visibility.ts). Main is faked: the test answers `appSettings.get`
// and every `appSettings.set` itself, in the order it wants, and fires the events.
describe('the sidebar, hidden and shown', () => {
  interface FakeMain {
    /** Every `appSettings.set` the window made, oldest first, with the way to answer it. */
    sets: { input: unknown; answer: (result: IpcResult<AppSettings>) => void }[]
    /** Answers the `appSettings.get` the window made at start. */
    answerGet: (state: AppSettings) => void
    /** Fires an event of main in the window. */
    emit: (channel: string, payload: unknown) => void
  }

  const settings = (revision: number, visible: Partial<AppSettings['sidebar']['visible']> = {}): AppSettings => ({
    interfaceScale: 1,
    sidebar: { collapsed: {}, visible: { normal: true, focus: true, ...visible } },
    autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
    revision,
  })

  let main: FakeMain

  beforeEach(() => {
    // useAppSettings and sidebar-visibility keep their state in modules: every test starts with fresh ones.
    vi.resetModules()
    const handlers = new Map<string, Set<(payload: unknown) => void>>()
    const ids = new Map<number, () => void>()
    let answerGet: (state: AppSettings) => void = () => undefined
    const fake: FakeMain = {
      sets: [],
      answerGet: (state) => answerGet(state),
      emit: (channel, payload) => {
        for (const handler of [...(handlers.get(channel) ?? [])]) handler(payload)
      },
    }
    const bridge: WorfyBridge = {
      invoke: (channel, input) => {
        if (channel === 'appSettings.get') return new Promise((resolve) => (answerGet = (value) => resolve({ ok: true, value })))
        if (channel === 'appSettings.set') return new Promise((resolve) => fake.sets.push({ input, answer: resolve }))
        return Promise.resolve({ ok: false, error: `not in this test: ${channel}` })
      },
      on: (channel, handler) => {
        const set = handlers.get(channel) ?? new Set()
        handlers.set(channel, set)
        set.add(handler)
        const id = ids.size + 1
        ids.set(id, () => set.delete(handler))
        return id
      },
      off: (id) => ids.get(id)?.(),
    }
    main = fake
    ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
    // What the rest of the shell says about the channels this test does not answer.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
    vi.restoreAllMocks()
  })

  /**
   * The shell and the store that says whether focus mode is on screen, from the same fresh modules.
   * `setFocusActive` lets the shell render the change; `setFocusActiveUnrendered` does not.
   */
  async function mount(): Promise<{ setFocusActive: (active: boolean) => void; setFocusActiveUnrendered: (active: boolean) => void }> {
    const { AppShell: FreshShell } = await import('../../src/renderer/shell/AppShell')
    const { setFocusActive } = await import('../../src/renderer/focus/focus-state')
    await act(async () => {
      render(<FreshShell canvas={<button type="button">on the canvas</button>} />)
    })
    return { setFocusActive: (active) => act(() => setFocusActive(active)), setFocusActiveUnrendered: setFocusActive }
  }

  const sidebar = () => screen.queryByRole('navigation', { name: 'Sidebar' })
  const shown = () => sidebar() !== null
  const toggleButton = () => screen.getByRole('button', { name: /^(Hide|Show) sidebar$/ })
  const click = () => fireEvent.click(toggleButton())
  const menuToggle = () => act(() => main.emit('menu.command', 'toggleSidebar'))
  /** Answers the `index`-th `appSettings.set` the way main does: the settings after the change. */
  const answerSet = (index: number, state: AppSettings) => act(async () => main.sets[index]!.answer({ ok: true, value: state }))
  const inputs = () => main.sets.map((set) => set.input)

  it('a fresh user, with no answer saved, sees the sidebar in the normal view and in focus mode', async () => {
    const { setFocusActive } = await mount()
    expect(shown()).toBe(true)
    await act(async () => main.answerGet(settings(0)))
    expect(shown()).toBe(true)
    setFocusActive(true)
    expect(shown()).toBe(true)
    expect(main.sets).toEqual([])
  })

  it.each([
    ['hidden in the normal view and shown in focus mode', { normal: false, focus: true }],
    ['shown in the normal view and hidden in focus mode', { normal: true, focus: false }],
    ['hidden in both', { normal: false, focus: false }],
  ])('saved %s: each of the two shows its own answer', async (_name, visible) => {
    const { setFocusActive } = await mount()
    await act(async () => main.answerGet(settings(4, visible)))
    expect(shown()).toBe(visible.normal)
    expect(screen.getByRole('banner').dataset.sidebar).toBe(visible.normal ? 'visible' : 'hidden')
    setFocusActive(true)
    expect(shown()).toBe(visible.focus)
    setFocusActive(false)
    expect(shown()).toBe(visible.normal)
    // Looking writes nothing.
    expect(main.sets).toEqual([])
    // A switch starts from the saved answer, not from the one the shell had before main answered.
    await menuToggle()
    expect(shown()).toBe(!visible.normal)
    expect(inputs()).toEqual([{ sidebar: { visible: { normal: !visible.normal } } }])
    setFocusActive(true)
    await menuToggle()
    expect(shown()).toBe(!visible.focus)
    expect(inputs()[1]).toEqual({ sidebar: { visible: { focus: !visible.focus } } })
  })

  it('the toolbar button writes `sidebar.visible.normal`, and nothing about focus mode', async () => {
    const { setFocusActive } = await mount()
    await act(async () => main.answerGet(settings(0)))
    click()
    expect(shown()).toBe(false)
    expect(inputs()).toEqual([{ sidebar: { visible: { normal: false } } }])
    await answerSet(0, settings(1, { normal: false }))
    expect(shown()).toBe(false)
    // Focus mode still shows it: its answer was not touched.
    setFocusActive(true)
    expect(shown()).toBe(true)
    setFocusActive(false)
    click()
    expect(shown()).toBe(true)
    expect(inputs()[1]).toEqual({ sidebar: { visible: { normal: true } } })
  })

  it('while focus mode is on screen a switch writes `sidebar.visible.focus`, and the normal view keeps its own', async () => {
    const { setFocusActive } = await mount()
    await act(async () => main.answerGet(settings(0)))
    setFocusActive(true)
    await menuToggle()
    expect(shown()).toBe(false)
    expect(inputs()).toEqual([{ sidebar: { visible: { focus: false } } }])
    await answerSet(0, settings(1, { focus: false }))
    setFocusActive(false)
    expect(shown()).toBe(true)
    setFocusActive(true)
    expect(shown()).toBe(false)
  })

  it('`menu.command` with `toggleSidebar` switches the sidebar of what the window shows; another command does not', async () => {
    await mount()
    await act(async () => main.answerGet(settings(0)))
    await act(async () => main.emit('menu.command', 'settings'))
    expect(shown()).toBe(true)
    expect(main.sets).toEqual([])
    await menuToggle()
    expect(shown()).toBe(false)
    expect(inputs()).toEqual([{ sidebar: { visible: { normal: false } } }])
    await menuToggle()
    expect(shown()).toBe(true)
    expect(inputs()[1]).toEqual({ sidebar: { visible: { normal: true } } })
  })

  it('the shell that left listens to the menu no more', async () => {
    const { AppShell: FreshShell } = await import('../../src/renderer/shell/AppShell')
    const { unmount } = render(<FreshShell />)
    unmount()
    await menuToggle()
    expect(main.sets).toEqual([])
  })

  it('two quick presses undo each other without waiting for main, and a late answer to the first does not hide it again', async () => {
    await mount()
    await act(async () => main.answerGet(settings(0)))
    await menuToggle()
    await menuToggle()
    expect(shown()).toBe(true)
    expect(inputs()).toEqual([{ sidebar: { visible: { normal: false } } }, { sidebar: { visible: { normal: true } } }])
    // The answer to the first press says "hidden": the second press decides.
    await answerSet(0, settings(1, { normal: false }))
    expect(shown()).toBe(true)
    await answerSet(1, settings(2, { normal: true }))
    expect(shown()).toBe(true)
    // Three presses: hidden, whatever order the answers come in.
    await menuToggle()
    await menuToggle()
    await menuToggle()
    expect(shown()).toBe(false)
    await answerSet(4, settings(5, { normal: false }))
    await answerSet(2, settings(3, { normal: false }))
    await answerSet(3, settings(4, { normal: true }))
    expect(shown()).toBe(false)
  })

  it('a press made while focus mode opens or closes goes to the view on screen at that moment', async () => {
    const { setFocusActive } = await mount()
    await act(async () => main.answerGet(settings(0)))
    // Hidden in the normal view, its write still on the way when focus mode opens.
    await menuToggle()
    setFocusActive(true)
    expect(shown()).toBe(true)
    await menuToggle()
    expect(shown()).toBe(false)
    // Focus mode closes before either write is answered.
    setFocusActive(false)
    expect(shown()).toBe(false)
    await menuToggle()
    expect(shown()).toBe(true)
    expect(inputs()).toEqual([{ sidebar: { visible: { normal: false } } }, { sidebar: { visible: { focus: false } } }, { sidebar: { visible: { normal: true } } }])
    // The answers arrive: the normal view shows it, focus mode does not.
    await answerSet(0, settings(1, { normal: false }))
    await answerSet(1, settings(2, { normal: false, focus: false }))
    await answerSet(2, settings(3, { normal: true, focus: false }))
    expect(shown()).toBe(true)
    setFocusActive(true)
    expect(shown()).toBe(false)
  })

  it('a press that arrives before the shell has rendered focus mode opening, or closing, still goes to the view of that moment', async () => {
    const { setFocusActiveUnrendered } = await mount()
    await act(async () => main.answerGet(settings(0)))
    await act(async () => {
      setFocusActiveUnrendered(true)
      main.emit('menu.command', 'toggleSidebar')
    })
    expect(inputs()).toEqual([{ sidebar: { visible: { focus: false } } }])
    expect(shown()).toBe(false)
    await act(async () => {
      setFocusActiveUnrendered(false)
      main.emit('menu.command', 'toggleSidebar')
    })
    expect(inputs()[1]).toEqual({ sidebar: { visible: { normal: false } } })
    expect(shown()).toBe(false)
  })

  it('a switch made in another window of this Machine is followed', async () => {
    const { setFocusActive } = await mount()
    await act(async () => main.answerGet(settings(0)))
    await act(async () => main.emit('appSettings.changed', settings(1, { normal: false })))
    expect(shown()).toBe(false)
    // After a switch of its own that main has saved, too.
    click()
    await answerSet(0, settings(2, { normal: true }))
    expect(shown()).toBe(true)
    await act(async () => main.emit('appSettings.changed', settings(3, { normal: false, focus: false })))
    expect(shown()).toBe(false)
    setFocusActive(true)
    expect(shown()).toBe(false)
  })

  it('a write main refuses leaves the sidebar switched in this window, and the next switch still works', async () => {
    await mount()
    await act(async () => main.answerGet(settings(0)))
    click()
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'app-settings.json cannot be written' }))
    expect(shown()).toBe(false)
    expect(vi.mocked(console.error).mock.calls.some(([message]) => String(message).includes('the sidebar stays hidden in this window only'))).toBe(true)
    click()
    expect(shown()).toBe(true)
  })

  describe('the keyboard focus', () => {
    it('goes to the toolbar button when the sidebar is hidden with the focus inside it', async () => {
      await mount()
      await act(async () => main.answerGet(settings(0)))
      const row = within(sidebar()!).getAllByRole('button')[0]!
      row.focus()
      expect(document.activeElement).toBe(row)
      await menuToggle()
      expect(shown()).toBe(false)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show sidebar' }))
    })

    it('stays where it is when it was not in the sidebar', async () => {
      await mount()
      await act(async () => main.answerGet(settings(0)))
      const onCanvas = screen.getByRole('button', { name: 'on the canvas' })
      onCanvas.focus()
      await menuToggle()
      expect(shown()).toBe(false)
      expect(document.activeElement).toBe(onCanvas)
      // Shown again, the focus is not taken either.
      await menuToggle()
      expect(shown()).toBe(true)
      expect(document.activeElement).toBe(onCanvas)
    })

    it('goes to a button that is not inert: the one of the focus mode bar while the toolbar is covered', async () => {
      const { setFocusActive } = await mount()
      await act(async () => main.answerGet(settings(0)))
      // What focus mode does to the shell: the toolbar inert, its own bar with the same button over it.
      setFocusActive(true)
      const toolbar = screen.getByRole('banner')
      toolbar.setAttribute('inert', '')
      const inBar = document.createElement('button')
      inBar.setAttribute('data-sidebar-toggle', '')
      toolbar.after(inBar)
      const row = within(sidebar()!).getAllByRole('button')[0]!
      row.focus()
      await menuToggle()
      expect(shown()).toBe(false)
      expect(document.activeElement).toBe(inBar)
      inBar.remove()
    })
  })
})

describe('primitives', () => {
  it.each(['ready', 'working', 'blocked', 'done'] as const)('a %s chip always carries its label and an icon', (status) => {
    const { container } = render(<StatusChip status={status} label={`label ${status}`} />)
    const chip = container.querySelector(`[data-status="${status}"]`)
    expect(chip?.textContent).toBe(`label ${status}`)
    expect(chip?.querySelector('svg, .w-chip__dot')).not.toBeNull()
  })

  it('a list row marks the selected item and reports clicks', () => {
    const onSelect = vi.fn()
    render(<ListRow label="payments-v2" mono selected onSelect={onSelect} trailing="3/9" />)
    const row = screen.getByRole('button', { name: /payments-v2/ })
    expect(row.getAttribute('aria-current')).toBe('true')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('the primary button runs its action', () => {
    const onClick = vi.fn()
    render(<PrimaryButton onClick={onClick}>Run wave</PrimaryButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Run wave' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('the segmented control presses exactly one segment', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="View"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value="a"
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'B' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
