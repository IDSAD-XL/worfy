// The error boundaries of the window (src/renderer/shell/ErrorBoundary.tsx; worfy-polish ticket 163). Before them a
// throw inside one sidebar section, one Assistant tab or one view unmounted the whole React tree and left the window
// blank. Now that part shows «… failed to render», the error's message and Reload; the rail, the toolbar and the other
// parts keep working. The sections and the views are real; IPC is replaced for the Assistant's panel.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantView } from '../../src/shared/assistant/window'

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: ipc.invoke,
  subscribe: () => () => undefined,
}))

/** Which real part throws in this case: one section file of the shell, and Work track of the Runs view. */
const broken = vi.hoisted(() => ({ adr: false, track: false }))

vi.mock('../../src/renderer/shell/sidebar/AdrSection.tsx', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/shell/sidebar/AdrSection')>()
  // The shell reads every rail export by name (registry.ts); a mock answers only the keys it lists.
  return {
    railEnd: undefined,
    railDefault: undefined,
    ...real,
    default: function AdrSection() {
      if (broken.adr) throw new Error('ADR section broke')
      return <real.default />
    },
  }
})

// Work track reads main; here it only draws the switch it is given, as the real view does in its bar, or throws.
vi.mock('../../src/renderer/work-track/WorkTrackView', () => ({
  WorkTrackView: function WorkTrackView({ switcher }: { switcher: ReactNode }) {
    if (broken.track) throw new Error('Work track broke')
    return <div data-testid="work-track">{switcher}</div>
  },
}))

const { ErrorBoundary } = await import('../../src/renderer/shell/ErrorBoundary')
const { RunsView } = await import('../../src/renderer/flight-recorder/RunsView')
const { setRunsTab } = await import('../../src/renderer/work-track/store')
const { errorText, topComponent } = await import('../../src/renderer/shell/error-text')
const { AppShell } = await import('../../src/renderer/shell/AppShell')
const { SidebarView } = await import('../../src/renderer/shell/Sidebar')
const { collectExtensions } = await import('../../src/renderer/shell/registry')
const { showSidebarSection } = await import('../../src/renderer/shell/sidebar-scope')
const { AssistantPanel } = await import('../../src/renderer/assistant/AssistantPanel')
const { useAssistant } = await import('../../src/renderer/assistant/useAssistant')

/** A part whose render throws, as the Journal tab and the Work track did in the owner's window. */
function Broken(): never {
  throw new Error('Cannot read properties of undefined (reading "map")')
}

const NOW = Date.UTC(2026, 10, 26, 21, 0)

const view = (over: Partial<AssistantView> = {}): AssistantView => ({
  on: true,
  projects: 1,
  items: [],
  snoozed: [],
  hidden: [],
  proposals: [],
  journal: [],
  conversation: [],
  summary: { id: 'summary-1', since: NOW - 16 * 3_600_000, came: 0, done: 0, stopped: 0, waiting: 0, projects: [], first: [], morning: null, rating: null },
  usage: { today: 1200, week: 5400, fiveHour: 0.02, sevenDay: 0.01, estimate: true },
  workHours: true,
  linked: [],
  offer: { owed: false, notice: false },
  ...over,
})

beforeEach(() => {
  // React and the boundary both report a caught error to the console; the cases read the screen instead.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  ipc.invoke.mockReset()
  // No main: every call is refused, so no store of the shell takes a made-up answer as its state.
  ipc.invoke.mockResolvedValue({ ok: false, error: 'no main in this test' })
  useAssistant.setState({ view: null, tab: 'waits', focus: null, closed: [], gone: [], prepare: null })
  broken.adr = false
  broken.track = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('shows what failed, the message and the component it came from instead of the children', () => {
    render(
      <ErrorBoundary scope="section" name="BrokenSection">
        <Broken />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('data-boundary')).toBe('BrokenSection')
    expect(within(alert).getByText('This section failed to render')).toBeTruthy()
    expect(within(alert).getByText('Cannot read properties of undefined (reading "map")')).toBeTruthy()
    expect(within(alert).getByText('in Broken')).toBeTruthy()
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('Reload mounts the children again: a part that renders now shows', () => {
    let fail = true
    function Flaky() {
      if (fail) throw new Error('first render fails')
      return <p>rendered again</p>
    }
    render(
      <ErrorBoundary scope="tab" name="journal">
        <Flaky />
      </ErrorBoundary>,
    )
    expect(screen.getByText('This tab failed to render')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(screen.getByText('rendered again')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the window boundary offers «Reload window», which reloads the page', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    render(
      <ErrorBoundary scope="window" name="app">
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.getByText('worfy failed to render this window')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reload window' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('says what was thrown when it is not an Error, and finds the component in either stack form', () => {
    expect(errorText('plain text')).toBe('plain text')
    expect(errorText({ code: 7 })).toBe('{"code":7}')
    expect(errorText(undefined)).toBe('undefined')
    expect(errorText(new TypeError(''))).toBe('TypeError')
    expect(topComponent('\n    at Journal (http://localhost/assets/index.js:1:2)\n    at div')).toBe('Journal')
    expect(topComponent('\n    in WorkTrackView\n    in div')).toBe('WorkTrackView')
    expect(topComponent(undefined)).toBeNull()
  })
})

describe('a sidebar section that throws', () => {
  it('shows the fallback in its panel; the rail and the other sections keep working', () => {
    const sections = collectExtensions({
      './sidebar/BrokenSection.tsx': { default: Broken, order: 10 },
      './sidebar/FineSection.tsx': {
        default: function FineSection() {
          const [count, setCount] = useState(0)
          return (
            <button type="button" onClick={() => setCount(count + 1)}>
              Pressed {count}
            </button>
          )
        },
        order: 20,
      },
    })
    act(() => showSidebarSection('BrokenSection'))
    render(<SidebarView sections={sections} />)
    const broken = document.querySelector('[data-section="BrokenSection"]')!
    expect(within(broken as HTMLElement).getByText('This section failed to render')).toBeTruthy()
    // The rail is still there, and the other section opens and works.
    const rail = screen.getByRole('tablist', { name: 'Sidebar sections' })
    fireEvent.click(within(rail).getByRole('tab', { name: 'Fine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pressed 0' }))
    expect(screen.getByRole('button', { name: 'Pressed 1' })).toBeTruthy()
  })

  it('the real shell: a real section file that throws fails in its own panel; the rail opens another section', () => {
    broken.adr = true
    act(() => showSidebarSection('AdrSection'))
    render(<AppShell canvas={<p>canvas body</p>} />)
    const adr = document.querySelector('[data-section="AdrSection"]') as HTMLElement
    expect(within(adr).getByText('This section failed to render')).toBeTruthy()
    expect(within(adr).getByText('ADR section broke')).toBeTruthy()
    // Only that section failed; the others are drawn, and the rail still switches to one.
    expect(screen.getAllByTestId('error-boundary')).toHaveLength(1)
    const rail = screen.getByRole('tablist', { name: 'Sidebar sections' })
    fireEvent.click(within(rail).getByRole('tab', { name: 'Projects' }))
    expect((document.querySelector('[data-section="ProjectsSection"]') as HTMLElement).hidden).toBe(false)
    expect(adr.hidden).toBe(true)
    expect(screen.getByText('canvas body')).toBeTruthy()
  })
})

describe('a view that throws', () => {
  it('shows the fallback in the view; the toolbar and the sidebar stay', () => {
    render(<AppShell view="history" history={<Broken />} canvas={<p>canvas body</p>} />)
    const history = document.querySelector('[data-view="history"]') as HTMLElement
    expect(within(history).getByText('This view failed to render')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Canvas' })).toBeTruthy()
    expect(screen.getByText('canvas body')).toBeTruthy()
  })

  it('Work track that throws fails under the switch of the Runs view, and the switch goes back to Run history', () => {
    broken.track = true
    act(() => setRunsTab('p-1', 'track'))
    render(<RunsView activeProjectId="p-1" />)
    const runs = screen.getByTestId('runs-view')
    expect(within(runs).getByText('Work track broke')).toBeTruthy()
    expect(screen.getByRole('alert').getAttribute('data-boundary')).toBe('work-track')
    fireEvent.click(within(runs).getByRole('button', { name: 'Run history' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('run-history').closest('[hidden]')).toBeNull()
  })
})

describe('an Assistant tab that throws', () => {
  it('shows the fallback in the tab; the tabs, the usage line and the box stay, and another tab renders', () => {
    // A view without its summary: the Summary tab throws as it reads it.
    const broken = { ...view(), summary: undefined } as unknown as AssistantView
    useAssistant.setState({ view: broken })
    render(<AssistantPanel view={broken} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    expect(screen.getByText('This tab failed to render')).toBeTruthy()
    expect(screen.getByTestId('assistant-usage')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message to Assistant' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Journal' }))
    expect(screen.getByTestId('assistant-journal')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the Journal tab renders its empty line and its rows', () => {
    const rows = view({
      journal: [
        { id: 'j1', at: NOW, by: 'worfy', text: 'Woke the Orchestrator', outcome: 'done', cause: { itemId: 'item-1', text: 'A ticket waits', open: false }, duty: null, rating: null },
      ],
    })
    useAssistant.setState({ view: view(), tab: 'journal' })
    const { rerender } = render(<AssistantPanel view={view()} />)
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy()
    rerender(<AssistantPanel view={rows} />)
    expect(screen.getAllByTestId('assistant-journal-row')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
