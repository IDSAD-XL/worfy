// The Getting started panel in the top right corner of the window (worfy-onboarding ticket 13, in
// place of the sidebar section of ticket 07), over the real renderer IPC client and a fake preload of
// this Machine:
// - it shows while main's state says `section: 'shown'` and is gone, pill and all, while it says
//   `hidden`; the sidebar has no Getting started section any more;
// - it is a layer of <body> below the dialogs (z-index under 90), not a dialog: a region, no backdrop,
//   and toasts keep out of it and of its pill (`data-toast-keep-out`);
// - collapsed, it is the pill "Getting started · n/6" alone; the pill expands it, "Collapse" collapses
//   it, and the choice is `sidebar.collapsed.GettingStartedSection` of the app settings, as the
//   section's was;
// - six steps in an ordered list, each marked one with a check, the time in its tooltip and "done"
//   for a screen reader; the first unmarked step is the current one and alone has its button;
// - the buttons: "Open checks" opens the first-run checks, "Create demo project" calls
//   `gettingStarted.createDemo` and shows its progress and its refusal, "Open the Orchestrator" and
//   "Ship the ticket" open the demo's Orchestrator with a ready text in its input field;
// - "Connect…" asks for the same "Add project" as "+" of Projects; "Skip" hides the panel and says
//   where to find it again; openGettingStarted() (the Command palette) shows it, expanded, and focuses
//   its heading.
// The ready text of the input field (src/renderer/session/pending-input.ts): MessageInput puts it in
// once, only into an empty field, and never sends it (decision 4 of the spec).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const DEMO = 'demo-project-id'

const snapshot = (change: Partial<GettingStartedSnapshot> = {}): GettingStartedSnapshot => ({
  user: 'new',
  section: 'shown',
  steps: {},
  reworkSeen: false,
  noticeShown: false,
  demo: null,
  ...change,
})

const twoDone = (): GettingStartedSnapshot =>
  snapshot({
    steps: { '1': '2026-10-30T09:00:00.000Z', '2': '2026-10-30T09:05:00.000Z' },
    demo: { projectId: DEMO, path: '/Users/u/worfy-demo', profile: 'worfy-demo', cost: 'cheaper' },
  })

const appSettings: AppSettings = {
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 0,
}

interface Call {
  channel: string
  input: unknown
  answer: (result: IpcResult<unknown>) => void
}

/** What the fake main saw and the way to talk back. */
interface FakeMain {
  /** Every call the fake does not answer by itself, oldest first. */
  calls: Call[]
  /** Fires an event of main, as `gettingStarted.changed`. */
  emit: (channel: string, payload: unknown) => void
}

let main: FakeMain

/** What `appSettings.set` was asked, oldest first. */
let settingsAsked: unknown[] = []

/**
 * This Machine's preload: `gettingStarted.state` answers `state` (null: the test answers it), the
 * app settings at once — `settings` first, then whatever `appSettings.set` makes of them.
 */
function preload(state: GettingStartedSnapshot | null, settings: AppSettings = appSettings): void {
  let current = settings
  settingsAsked = []
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const fake: FakeMain = {
    calls: [],
    emit: (channel, payload) => {
      for (const handler of handlers.get(channel) ?? []) handler(payload)
    },
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel, input) => {
      if (channel === 'gettingStarted.state' && state !== null) return Promise.resolve({ ok: true, value: state } as never)
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: current } as never)
      if (channel === 'appSettings.set') {
        settingsAsked.push(input)
        const collapsed = { ...current.sidebar.collapsed, ...(input as { sidebar?: { collapsed?: Record<string, boolean> } }).sidebar?.collapsed }
        current = { ...current, sidebar: { ...current.sidebar, collapsed }, revision: current.revision + 1 }
        return Promise.resolve({ ok: true, value: current } as never)
      }
      return new Promise((resolve) => fake.calls.push({ channel, input, answer: resolve as (result: IpcResult<unknown>) => void }))
    },
    on: (channel, handler) => {
      const set = handlers.get(channel) ?? new Set()
      set.add(handler as (payload: unknown) => void)
      handlers.set(channel, set)
      return set.size
    },
    off: () => undefined,
  }
  main = fake
}

/** The one unanswered call of `channel`; fails when there is none. */
async function callOf(channel: string): Promise<Call> {
  return await waitFor(() => {
    const call = main.calls.find((each) => each.channel === channel)
    if (call === undefined) throw new Error(`no call of ${channel}; calls: ${main.calls.map((each) => each.channel).join(', ')}`)
    return call
  })
}

async function renderPanel(state: GettingStartedSnapshot | null, settings: AppSettings = appSettings, sessionView?: boolean) {
  preload(state, settings)
  const { GettingStartedPanel } = await import('../../src/renderer/getting-started/GettingStartedPanel')
  const view = render(<GettingStartedPanel sessionView={sessionView} />)
  return { ...view, GettingStartedPanel }
}

const collapsedSettings = (): AppSettings => ({ ...appSettings, sidebar: { ...appSettings.sidebar, collapsed: { GettingStartedSection: true } } })

const region = () => screen.getByRole('region', { name: 'Getting started' })
const pill = () => screen.queryByTestId('getting-started-pill')
const steps = () => within(within(region()).getByRole('list', { name: 'Steps' })).getAllByRole('listitem')

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

describe('the Getting started panel', () => {
  it('the sidebar has no Getting started section while main says "shown"; the panel is outside it', async () => {
    preload(twoDone())
    const { Sidebar } = await import('../../src/renderer/shell/Sidebar')
    const { GettingStartedPanel } = await import('../../src/renderer/getting-started/GettingStartedPanel')
    render(
      <>
        <Sidebar />
        <GettingStartedPanel />
      </>,
    )
    await waitFor(() => expect(region()).toBeTruthy())
    const sidebar = screen.getByRole('navigation', { name: 'Sidebar' })
    expect(sidebar.contains(region())).toBe(false)
    expect(within(sidebar).queryByText('Getting started')).toBeNull()
    expect(sidebar.querySelector('[data-section="GettingStartedSection"], [data-section-id="GettingStartedSection"]')).toBeNull()
  })

  it('is a layer of <body> below the dialogs and above the window, not a dialog; toasts keep out of it', async () => {
    await renderPanel(twoDone())
    const panel = await waitFor(region)
    expect(panel.parentElement).toBe(document.body)
    expect(panel.getAttribute('data-testid')).toBe('getting-started')
    expect(panel.style.position).toBe('fixed')
    const layer = Number(panel.style.zIndex)
    // First run is 90, Add project and Connect 95, the Command palette 100, Settings 110.
    expect(layer).toBeGreaterThan(0)
    expect(layer).toBeLessThan(90)
    expect(panel.hasAttribute('data-toast-keep-out')).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(panel.getAttribute('aria-modal')).toBeNull()
    // Its height follows the content up to 70 % of the window; only past that does its body scroll.
    expect(panel.style.maxHeight).toBe('70vh')
    expect(pill()).toBeNull()
  })

  it('in the Session view the panel and its pill stand under the Session header and its find bar; elsewhere under the toolbar (Q22)', async () => {
    const UNDER_TOOLBAR = 'calc(var(--toolbar-height) + var(--space-3))'
    const UNDER_SESSION = 'calc(var(--toolbar-height) + 44px + var(--space-2) + 32px + var(--space-2))'
    const { rerender, GettingStartedPanel } = await renderPanel(twoDone(), appSettings, true)
    const panel = await waitFor(region)
    expect(panel.style.top).toBe(UNDER_SESSION)
    expect(panel.style.right).toBe('var(--space-4)')
    rerender(<GettingStartedPanel sessionView={false} />)
    expect(region().style.top).toBe(UNDER_TOOLBAR)
    rerender(<GettingStartedPanel sessionView />)
    fireEvent.click(within(region()).getByRole('button', { name: 'Collapse' }))
    await waitFor(() => expect(pill()).not.toBeNull())
    expect(pill()!.style.top).toBe(UNDER_SESSION)
    rerender(<GettingStartedPanel />)
    expect(pill()!.style.top).toBe(UNDER_TOOLBAR)
  })

  it('"Collapse" leaves the pill "Getting started · 2/6" alone, saved in the app settings; the pill expands it again', async () => {
    await renderPanel(twoDone())
    fireEvent.click(within(await waitFor(region)).getByRole('button', { name: 'Collapse' }))
    await waitFor(() => expect(pill()).not.toBeNull())
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    expect(screen.queryByTestId('getting-started')).toBeNull()
    expect(pill()!.tagName).toBe('BUTTON')
    expect(pill()!.textContent).toBe('Getting started · 2/6')
    expect(pill()!.hasAttribute('data-toast-keep-out')).toBe(true)
    expect(pill()!.parentElement).toBe(document.body)
    expect(document.activeElement).toBe(pill())
    expect(settingsAsked).toEqual([{ sidebar: { collapsed: { GettingStartedSection: true } } }])
    fireEvent.click(pill()!)
    await waitFor(() => expect(region()).toBeTruthy())
    expect(pill()).toBeNull()
    expect(settingsAsked).toEqual([{ sidebar: { collapsed: { GettingStartedSection: true } } }, { sidebar: { collapsed: { GettingStartedSection: false } } }])
    expect(document.activeElement).toBe(within(region()).getByRole('heading', { name: 'Getting started' }))
    // The work of the panel was kept while it was a pill: steps 1–2 marked, the button at step 3.
    expect(within(steps()[2]!).getByRole('button', { name: 'Open the Orchestrator' })).toBeTruthy()
  })

  it('collapsed in the app settings: only the pill, with the steps marked so far', async () => {
    await renderPanel(twoDone(), collapsedSettings())
    await waitFor(() => expect(pill()?.textContent).toBe('Getting started · 2/6'))
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    act(() => main.emit('gettingStarted.changed', { ...twoDone(), steps: { ...twoDone().steps, '3': '2026-10-30T09:10:00.000Z' } }))
    expect(pill()!.textContent).toBe('Getting started · 3/6')
  })

  it('an existing user, whose state main keeps hidden: neither the panel nor the pill', async () => {
    const { container } = await renderPanel(snapshot({ user: 'existing', section: 'hidden' }), collapsedSettings())
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    expect(pill()).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('shows with section "shown": steps 1 and 2 marked, the button at step 3 only', async () => {
    await renderPanel(twoDone())
    await waitFor(() => expect(region()).toBeTruthy())
    expect(within(region()).getByText('A guided demo: one ticket from start to merge.')).toBeTruthy()
    const items = steps()
    expect(items.map((item) => item.getAttribute('data-step'))).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(items.map((item) => item.getAttribute('data-done') === 'true')).toEqual([true, true, false, false, false, false])
    // A screen reader hears "done" on the two marked steps only.
    expect(within(items[0]!).getByText('Check your setup')).toBeTruthy()
    // Step 4 names the Orchestrator, not an implementer agent (owner's decision Q23, 2026-10-31).
    expect(within(items[3]!).getByText('Ship the ticket')).toBeTruthy()
    expect(within(items[3]!).getByText('The Orchestrator implements the ticket in its own branch. The Pipeline shows each Stage.')).toBeTruthy()
    expect(items[3]!.textContent).not.toMatch(/implementer/u)
    expect(items.map((item) => within(item).queryByText('done') !== null)).toEqual([true, true, false, false, false, false])
    // The time of a marked step is its tooltip.
    expect(within(items[1]!).getByTestId('getting-started-mark').getAttribute('title')).toMatch(/^Done /)
    expect(within(items[2]!).getByTestId('getting-started-mark').getAttribute('title')).toBeNull()
    // The current step is the first unmarked one, and only it has a button.
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, null, 'step', null, null, null])
    expect(within(items[2]!).getByRole('button', { name: 'Open the Orchestrator' })).toBeTruthy()
    for (const name of ['Open checks', 'Create demo project', 'Ship the ticket']) expect(within(region()).queryByRole('button', { name })).toBeNull()
    expect(within(items[4]!).queryByRole('button')).toBeNull()
    // Connect your own project and Skip are there too.
    expect(within(region()).getByRole('button', { name: 'Connect…' })).toBeTruthy()
    expect(within(region()).getByRole('button', { name: 'Skip' })).toBeTruthy()
  })

  it('is not there with section "hidden", and comes when main says "shown"', async () => {
    const { container } = await renderPanel(snapshot({ section: 'hidden' }))
    // Answered: still nothing.
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    expect(container.innerHTML).toBe('')
    act(() => main.emit('gettingStarted.changed', twoDone()))
    expect(region()).toBeTruthy()
    act(() => main.emit('gettingStarted.changed', snapshot({ section: 'hidden' })))
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    expect(pill()).toBeNull()
  })

  it('an answer to the first read that comes after a change loses to it', async () => {
    await renderPanel(null)
    const read = await callOf('gettingStarted.state')
    act(() => main.emit('gettingStarted.changed', twoDone()))
    expect(region()).toBeTruthy()
    await act(async () => read.answer({ ok: true, value: snapshot({ section: 'hidden' }) }))
    expect(region()).toBeTruthy()
  })

  it('Skip asks main to hide the panel and says where to find it again; no pill stays', async () => {
    const { toasts } = await import('../../src/renderer/toast/toasts')
    await renderPanel(twoDone())
    fireEvent.click(await within(await waitFor(region)).findByRole('button', { name: 'Skip' }))
    const call = await callOf('gettingStarted.setSection')
    expect(call.input).toEqual({ section: 'hidden' })
    await act(async () => call.answer({ ok: true, value: { ...twoDone(), section: 'hidden' } }))
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    expect(pill()).toBeNull()
    expect(toasts.getState().toasts.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'info', text: 'Getting started is hidden. Reopen it from the Command palette: Getting started.' },
    ])
  })

  it('step 1: "Open checks" opens the first-run checks', async () => {
    const { useFirstRun } = await import('../../src/renderer/shell/first-run-store')
    useFirstRun.setState({ open: false, report: { checks: [], checkedAt: '2026-10-30T09:00:00.000Z' } })
    await renderPanel(snapshot())
    fireEvent.click(await within(await waitFor(region)).findByRole('button', { name: 'Open checks' }))
    expect(useFirstRun.getState().open).toBe(true)
    expect(steps()[0]!.getAttribute('aria-current')).toBe('step')
  })

  it('step 2: "Create demo project" calls createDemo, shows where it is and the refusal', async () => {
    await renderPanel(snapshot({ steps: { '1': '2026-10-30T09:00:00.000Z' } }))
    const button = await within(await waitFor(region)).findByRole('button', { name: 'Create demo project' })
    expect(within(steps()[1]!).getByText('The agents work for real and use your Claude Code usage.')).toBeTruthy()
    fireEvent.click(button)
    const call = await callOf('gettingStarted.createDemo')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    act(() => main.emit('gettingStarted.createProgress', { step: 'Writing the files' }))
    expect(within(steps()[1]!).getByText('Writing the files')).toBeTruthy()
    await act(async () => call.answer({ ok: true, value: { ok: false, reason: 'git does not know the commit author' } }))
    expect(within(steps()[1]!).getByRole('alert').textContent).toBe('Could not create the demo project: git does not know the commit author')
    expect(within(steps()[1]!).queryByText('Writing the files')).toBeNull()
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('step 2: a call that fails is a refusal too', async () => {
    await renderPanel(snapshot({ steps: { '1': '2026-10-30T09:00:00.000Z' } }))
    fireEvent.click(await within(await waitFor(region)).findByRole('button', { name: 'Create demo project' }))
    const call = await callOf('gettingStarted.createDemo')
    await act(async () => call.answer({ ok: false, error: 'gettingStarted.createDemo failed: boom' }))
    expect(within(steps()[1]!).getByRole('alert').textContent).toBe('Could not create the demo project: boom')
  })

  for (const [step, button, text, done] of [
    ['3', 'Open the Orchestrator', 'What is planned in this project?', ['1', '2']],
    ['4', 'Ship the ticket', '/worfy:ship-ticket todo 01', ['1', '2', '3']],
  ] as const) {
    it(`step ${step}: "${button}" opens the demo's Orchestrator with "${text}" ready in its field, and sends nothing`, async () => {
      const { useNavigation } = await import('../../src/renderer/session/navigation')
      const { usePendingInput } = await import('../../src/renderer/session/pending-input')
      const marked = Object.fromEntries(done.map((each) => [each, '2026-10-30T09:00:00.000Z']))
      await renderPanel({ ...twoDone(), steps: marked })
      fireEvent.click(await within(await waitFor(region)).findByRole('button', { name: button }))
      // The demo becomes the window's Project, then its Orchestrator opens.
      const select = await callOf('projects.select')
      expect(select.input).toEqual({ id: DEMO })
      await act(async () => select.answer({ ok: true, value: { revision: 2, activeId: DEMO, projects: [] } }))
      const open = await callOf('orchestrator.open')
      expect(open.input).toEqual({ projectId: DEMO })
      await act(async () => open.answer({ ok: true, value: { nodeId: 'orch-node' } }))
      expect(usePendingInput.getState().texts).toEqual({ 'orch-node': text })
      expect(useNavigation.getState().view).toBe('session')
      expect(useNavigation.getState().opened[DEMO]?.nodeId).toBe('orch-node')
      expect(main.calls.map((each) => each.channel).filter((channel) => channel.startsWith('agent.'))).toEqual([])
    })
  }

  it('step 3: a refusal of the Orchestrator is shown in the step', async () => {
    await renderPanel(twoDone())
    fireEvent.click(await within(await waitFor(region)).findByRole('button', { name: 'Open the Orchestrator' }))
    await act(async () => (await callOf('projects.select')).answer({ ok: true, value: { revision: 2, activeId: DEMO, projects: [] } }))
    await act(async () => (await callOf('orchestrator.open')).answer({ ok: false, error: 'orchestrator.open failed: no such Project' }))
    expect(within(steps()[2]!).getByRole('alert').textContent).toBe('no such Project')
  })

  it('steps 5 and 6 have no button', async () => {
    await renderPanel(snapshot({ steps: { '1': 'x', '2': 'x', '3': 'x', '4': 'x' } as never }))
    const items = await waitFor(steps)
    expect(items[4]!.getAttribute('aria-current')).toBe('step')
    expect(within(items[4]!).queryByRole('button')).toBeNull()
  })

  it('"Connect…" asks for the same Add project as "+" of Projects', async () => {
    const { onAddProjectRequest } = await import('../../src/renderer/projects/add-project')
    const asked = vi.fn()
    const stop = onAddProjectRequest(asked)
    await renderPanel(twoDone())
    const section = await waitFor(region)
    expect(within(section).getByText('Connect your own project')).toBeTruthy()
    expect(within(section).getByText('Add a repository you work on. Not part of the demo.')).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: 'Connect…' }))
    expect(asked).toHaveBeenCalledTimes(1)
    stop()
  })

  it('the Projects section answers the request with its own "Add project": the folder picker, as "+" opens it', async () => {
    preload(twoDone())
    const { requestAddProject } = await import('../../src/renderer/projects/add-project')
    const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
    const { unmount } = render(<ProjectsSection />)
    const picks = () => main.calls.filter((call) => call.channel === 'projects.pickFolder').map((call) => call.input)
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(picks()).toEqual([{ purpose: 'project' }]))
    act(() => {
      expect(requestAddProject()).toBe(true)
    })
    await waitFor(() => expect(picks()).toEqual([{ purpose: 'project' }, { purpose: 'project' }]))
    unmount()
    // Nothing listens once the section is gone.
    expect(requestAddProject()).toBe(false)
  })

  it('openGettingStarted() asks main to show the panel, then focuses its heading', async () => {
    const { openGettingStarted } = await import('../../src/renderer/getting-started/store')
    await renderPanel(snapshot({ section: 'hidden' }))
    let opened: Promise<string | undefined> | undefined
    act(() => {
      opened = openGettingStarted()
    })
    const call = await callOf('gettingStarted.setSection')
    expect(call.input).toEqual({ section: 'shown' })
    await act(async () => call.answer({ ok: true, value: twoDone() }))
    expect(await opened).toBeUndefined()
    const heading = within(region()).getByRole('heading', { name: 'Getting started' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('openGettingStarted() expands a panel the user collapsed to its pill', async () => {
    const { openGettingStarted } = await import('../../src/renderer/getting-started/store')
    await renderPanel(twoDone(), collapsedSettings())
    await waitFor(() => expect(pill()).not.toBeNull())
    let opened: Promise<string | undefined> | undefined
    act(() => {
      opened = openGettingStarted()
    })
    await act(async () => (await callOf('gettingStarted.setSection')).answer({ ok: true, value: twoDone() }))
    expect(await opened).toBeUndefined()
    expect(settingsAsked).toEqual([{ sidebar: { collapsed: { GettingStartedSection: false } } }])
    const heading = await waitFor(() => within(region()).getByRole('heading', { name: 'Getting started' }))
    expect(pill()).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('openGettingStarted() answers the reason when main refuses', async () => {
    const { openGettingStarted } = await import('../../src/renderer/getting-started/store')
    preload(snapshot({ section: 'hidden' }))
    const opened = openGettingStarted()
    const call = await callOf('gettingStarted.setSection')
    call.answer({ ok: false, error: 'gettingStarted.setSection failed: disk full' })
    expect(await opened).toBe('disk full')
  })

  it('every button is reached by Tab: they are buttons, none taken out of the order; Collapse has its tooltip', async () => {
    await renderPanel(snapshot({ steps: { '1': '2026-10-30T09:00:00.000Z' } }))
    const section = await waitFor(region)
    for (const button of within(section).getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('tabindex')).toBeNull()
    }
    expect(within(section).getByRole('button', { name: 'Collapse' }).getAttribute('title')).toBe('Collapse')
  })
})

describe('the ready text of the input field', () => {
  async function renderInput(nodeId: string, onSend = vi.fn(async () => null)) {
    ;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke: () => new Promise(() => undefined), on: () => 1, off: () => undefined } as unknown as WorfyBridge
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    const view = render(<MessageInput nodeId={nodeId} sessionId="s1" busy={false} history={[]} recipient="Orchestrator" onSend={onSend} onInterrupt={() => undefined} />)
    return { ...view, onSend, field: () => screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement }
  }

  it('is put into the empty field once, and not sent', async () => {
    const { setPendingInput, usePendingInput } = await import('../../src/renderer/session/pending-input')
    setPendingInput('n1', 'What is planned in this project?')
    const { field, onSend, unmount } = await renderInput('n1')
    expect(field().value).toBe('What is planned in this project?')
    expect(usePendingInput.getState().texts).toEqual({})
    expect(onSend).not.toHaveBeenCalled()
    unmount()
    // Opened again: it was taken, the field starts empty.
    const again = await renderInput('n1')
    expect(again.field().value).toBe('')
  })

  it('comes into a field already open, and only for its own Node', async () => {
    const { setPendingInput, usePendingInput } = await import('../../src/renderer/session/pending-input')
    const { field, onSend } = await renderInput('n1')
    act(() => setPendingInput('n2', 'not mine'))
    expect(field().value).toBe('')
    expect(usePendingInput.getState().texts).toEqual({ n2: 'not mine' })
    act(() => setPendingInput('n1', '/worfy:ship-ticket todo 01'))
    expect(field().value).toBe('/worfy:ship-ticket todo 01')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('never replaces what the user typed', async () => {
    const { setPendingInput, usePendingInput } = await import('../../src/renderer/session/pending-input')
    const { field } = await renderInput('n1')
    fireEvent.change(field(), { target: { value: 'my own words' } })
    act(() => setPendingInput('n1', 'What is planned in this project?'))
    expect(field().value).toBe('my own words')
    // Taken all the same: it does not wait to replace the text later.
    expect(usePendingInput.getState().texts).toEqual({})
    fireEvent.change(field(), { target: { value: '' } })
    expect(field().value).toBe('')
  })
})
