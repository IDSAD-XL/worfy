// Machines in the sidebar and in Settings (worfy-ui ticket 5), over the real renderer IPC client and
// a fake preload of this Machine:
// - the sidebar section (src/renderer/shell/sidebar/MachinesSection.tsx) is collapsed until the
//   user expands it, shows a status dot next to its heading, a collapsed section too, and has no
//   switch any more;
// - Settings → Machines (src/renderer/settings/MachinesSection.tsx) has the two switches, which
//   call the channels the sidebar called.
// jsdom draws nothing: the colours, the pulse and `prefers-reduced-motion` are checked against the
// built app (test/e2e/linked-machines.spec.ts).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { LinkState, LinkedMachineView } from '../../src/shared/ipc/link'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const THIS = '11111111-1111-4111-8111-111111111111'
const MINI = '22222222-2222-4222-8222-222222222222'
const ATTIC = '33333333-3333-4333-8333-333333333333'

const machine = (id: string, name: string, state: LinkedMachineView['state'] = 'online', certificateChanged = false): LinkedMachineView => ({ id, name, state, certificateChanged })

const linkState = (revision: number, change: Partial<LinkState> = {}): LinkState => ({
  revision,
  machine: { id: THIS, name: 'Studio' },
  problem: null,
  listening: true,
  addresses: [],
  bonjour: false,
  linking: { open: false, code: null, expiresAt: null, linked: null, failure: null },
  linked: [],
  discovered: [],
  projectsAccess: false,
  keepAwake: true,
  ...change,
})

const appSettings = (revision: number, collapsed: Record<string, boolean> = {}): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  revision,
})

interface FakeMain {
  /** Every call of a channel that changes something, oldest first, with the way to answer it. */
  calls: { channel: string; input: unknown; answer: (result: IpcResult<unknown>) => void }[]
  /** Fires `link.changed`, as main does after any change of the link. */
  linkChanged: (state: LinkState) => void
}

let main: FakeMain

/** This Machine's preload: `link` answers `link.state`, `settings` answers `appSettings.get`. */
function preload(link: LinkState, settings: AppSettings = appSettings(0)): void {
  const handlers = new Map<string, (payload: unknown) => void>()
  const fake: FakeMain = { calls: [], linkChanged: (state) => handlers.get('link.changed')?.(state) }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'link.state') return Promise.resolve({ ok: true, value: link } as never)
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: settings } as never)
      return new Promise((resolve) => fake.calls.push({ channel, input, answer: resolve as (result: IpcResult<unknown>) => void }))
    },
    on: (channel, handler) => {
      handlers.set(channel, handler as (payload: unknown) => void)
      return handlers.size
    },
    off: () => undefined,
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

beforeEach(() => {
  // useMachines and useAppSettings keep their state in a module: every test starts with fresh ones.
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

/** Lets the answers of the fake preload, which are resolved promises, reach the components. */
const settle = () => act(async () => undefined)

// ── The sidebar section ───────────────────────────────────────────────────────────────────────

async function mountSidebar(link: LinkState, settings?: AppSettings) {
  preload(link, settings)
  const { default: MachinesSection } = await import('../../src/renderer/shell/sidebar/MachinesSection')
  const view = render(<MachinesSection />)
  await settle()
  return view
}

const region = () => screen.getByRole('region', { name: 'Machines' })
// `hidden: true`: what is asked about a collapsed section is asked about its hidden body too.
const heading = () => within(region()).getByRole('button', { name: 'Machines', hidden: true })
const body = () => {
  const element = document.getElementById(heading().getAttribute('aria-controls') ?? '')
  if (element === null) throw new Error('aria-controls of the heading names no element')
  return element
}
const dot = () => within(region()).queryByRole('img')

describe('the Machines section of the sidebar', () => {
  it('is collapsed for a user whose settings say nothing about it, and has no dot without a Linked machine', async () => {
    await mountSidebar(linkState(1))
    expect(heading().getAttribute('aria-expanded')).toBe('false')
    expect(body().hidden).toBe(true)
    expect(dot()).toBeNull()
    // "Link a machine…" is in the body: a collapsed section does not offer it.
    expect(within(region()).queryByRole('button', { name: 'Link a machine…' })).toBeNull()
    expect(within(body()).getByTestId('link-machine-button')).toBeTruthy()
  })

  it('stays expanded for a user who expanded it, and collapsed for one who collapsed it', async () => {
    const expanded = await mountSidebar(linkState(1, { linked: [machine(MINI, 'Mini')] }), appSettings(3, { MachinesSection: false }))
    expect(heading().getAttribute('aria-expanded')).toBe('true')
    expect(body().hidden).toBe(false)
    expect(within(region()).getByRole('button', { name: 'Link a machine…' })).toBeTruthy()
    expect(within(region()).getByTestId('machine-row').getAttribute('data-state')).toBe('online')
    expanded.unmount()

    vi.resetModules()
    await mountSidebar(linkState(1), appSettings(3, { MachinesSection: true }))
    expect(heading().getAttribute('aria-expanded')).toBe('false')
  })

  it('a click on the heading expands it and asks main to remember that', async () => {
    await mountSidebar(linkState(1))
    fireEvent.click(heading())
    expect(heading().getAttribute('aria-expanded')).toBe('true')
    expect(body().hidden).toBe(false)
    expect(main.calls.map(({ channel, input }) => [channel, input])).toStrictEqual([['appSettings.set', { sidebar: { collapsed: { MachinesSection: false } } }]])
  })

  it('one Linked machine online: a green dot in the header of the collapsed section, named for a screen reader and a tooltip', async () => {
    await mountSidebar(linkState(1, { linked: [machine(MINI, 'Mini'), machine(ATTIC, 'Attic', 'sleeping')] }))
    expect(heading().getAttribute('aria-expanded')).toBe('false')
    const shown = dot()
    expect(shown).not.toBeNull()
    expect(shown!.getAttribute('aria-label')).toBe('1 linked machine online')
    expect(shown!.getAttribute('title')).toBe('1 linked machine online')
    expect(shown!.getAttribute('data-state')).toBe('online')
    // In the header: outside the body a collapsed section hides…
    expect(body().contains(shown)).toBe(false)
    expect(shown!.closest('[hidden]')).toBeNull()
    // …and outside the heading, so the section is still named "Machines" and a click on the dot
    // does not collapse or expand it.
    expect(region().querySelector('h2')!.contains(shown)).toBe(false)
    expect(region().querySelector('h2')!.textContent).toBe('Machines')
    fireEvent.click(shown!)
    expect(heading().getAttribute('aria-expanded')).toBe('false')
    expect(main.calls).toStrictEqual([])
  })

  it('the dot follows the link: two online, then one with another certificate — amber, then nobody online — no dot', async () => {
    await mountSidebar(linkState(1, { linked: [machine(MINI, 'Mini'), machine(ATTIC, 'Attic')] }))
    expect(dot()!.getAttribute('aria-label')).toBe('2 linked machines online')

    act(() => main.linkChanged(linkState(2, { linked: [machine(MINI, 'Mini'), machine(ATTIC, 'Attic', 'online', true)] })))
    expect(dot()!.getAttribute('aria-label')).toBe('Certificate changed — link the machine again')
    expect(dot()!.getAttribute('title')).toBe('Certificate changed — link the machine again')
    expect(dot()!.getAttribute('data-state')).toBe('certificate-changed')

    act(() => main.linkChanged(linkState(3, { linked: [machine(MINI, 'Mini', 'unavailable'), machine(ATTIC, 'Attic', 'sleeping')] })))
    expect(dot()).toBeNull()

    // Revoked: no Linked machine, no dot.
    act(() => main.linkChanged(linkState(4, { linked: [] })))
    expect(dot()).toBeNull()
  })

  it('has no switch: neither in the header nor in the body, expanded or collapsed', async () => {
    await mountSidebar(linkState(1, { linked: [machine(MINI, 'Mini')], projectsAccess: true }))
    expect(within(region()).queryAllByRole('switch', { hidden: true })).toStrictEqual([])
    fireEvent.click(heading())
    expect(heading().getAttribute('aria-expanded')).toBe('true')
    expect(within(region()).queryAllByRole('switch', { hidden: true })).toStrictEqual([])
    expect(screen.queryByTestId('link-access-switch')).toBeNull()
    expect(screen.queryByTestId('link-keep-awake-switch')).toBeNull()
  })
})

// ── Settings → Machines ───────────────────────────────────────────────────────────────────────

const ACCESS = 'Linked machines can work with my Projects'
const KEEP_AWAKE = 'Keep this computer awake while linked machines are connected'

async function mountSettings(link: LinkState) {
  preload(link)
  const { default: MachinesSection } = await import('../../src/renderer/settings/MachinesSection')
  const view = render(<MachinesSection />)
  await settle()
  return { view, MachinesSection }
}

const access = () => screen.getByRole('switch', { name: ACCESS }) as HTMLButtonElement
const keepAwake = () => screen.getByRole('switch', { name: KEEP_AWAKE }) as HTMLButtonElement
const linkCalls = () => main.calls.map(({ channel, input }) => [channel, input])

describe('Settings → Machines', () => {
  it('is a section of the Settings window, after General: order 40, title "Machines"', async () => {
    preload(linkState(1))
    const { settingsSections } = await import('../../src/renderer/settings/sections')
    const found = settingsSections.find((section) => section.id === 'MachinesSection')
    expect(found).toMatchObject({ order: 40, title: 'Machines' })
    expect(settingsSections.findIndex((section) => section.id === 'MachinesSection')).toBeGreaterThan(settingsSections.findIndex((section) => section.id === 'GeneralSection'))
  })

  it('shows the two switches as main has them, under the test ids the sidebar gave them', async () => {
    await mountSettings(linkState(1, { projectsAccess: true }))
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(access().getAttribute('aria-checked')).toBe('true')
    expect(keepAwake().getAttribute('aria-checked')).toBe('true')
    expect(access().disabled).toBe(false)
    expect(keepAwake().disabled).toBe(false)
    expect(access().getAttribute('data-testid')).toBe('link-access-switch')
    expect(keepAwake().getAttribute('data-testid')).toBe('link-keep-awake-switch')
    // The label is on screen next to each switch.
    expect(screen.getByText(ACCESS)).toBeTruthy()
    expect(screen.getByText(KEEP_AWAKE)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a click calls link.setAccess and link.setKeepAwake with the other value, and the switch shows what main answered', async () => {
    await mountSettings(linkState(1))
    fireEvent.click(access())
    expect(linkCalls()).toStrictEqual([['link.setAccess', { projectsAccess: true }]])
    // Not switched until main says so.
    expect(access().getAttribute('aria-checked')).toBe('false')
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2, { projectsAccess: true }) }))
    expect(access().getAttribute('aria-checked')).toBe('true')

    fireEvent.click(keepAwake())
    expect(linkCalls()[1]).toStrictEqual(['link.setKeepAwake', { keepAwake: false }])
    await act(async () => main.calls[1]!.answer({ ok: true, value: linkState(3, { projectsAccess: true, keepAwake: false }) }))
    expect(keepAwake().getAttribute('aria-checked')).toBe('false')
    expect(access().getAttribute('aria-checked')).toBe('true')

    // And back.
    fireEvent.click(access())
    fireEvent.click(keepAwake())
    expect(linkCalls().slice(2)).toStrictEqual([
      ['link.setAccess', { projectsAccess: false }],
      ['link.setKeepAwake', { keepAwake: true }],
    ])
  })

  it('follows a change made elsewhere: another window of this Machine switched access on', async () => {
    await mountSettings(linkState(1))
    act(() => main.linkChanged(linkState(2, { projectsAccess: true, keepAwake: false })))
    expect(access().getAttribute('aria-checked')).toBe('true')
    expect(keepAwake().getAttribute('aria-checked')).toBe('false')
  })

  it('without this Machine both switches are disabled and a click asks main for nothing', async () => {
    await mountSettings(linkState(1, { machine: null, problem: 'the link service has not started yet' }))
    expect(access().disabled).toBe(true)
    expect(keepAwake().disabled).toBe(true)
    fireEvent.click(access())
    fireEvent.click(keepAwake())
    expect(main.calls).toStrictEqual([])

    // The link service started with access on: the switches work.
    act(() => main.linkChanged(linkState(2, { projectsAccess: true })))
    expect(access().disabled).toBe(false)
    expect(keepAwake().disabled).toBe(false)
  })

  it('a refusal of main is shown as it is, the switch stays, and the next change that works takes the message away', async () => {
    await mountSettings(linkState(1, { projectsAccess: true }))
    fireEvent.click(access())
    const refusal = "link.setAccess: EACCES: permission denied, open '/Users/a/Library/Application Support/worfy/link/settings.json.tmp'"
    await act(async () => main.calls[0]!.answer({ ok: false, error: refusal }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(refusal)
    expect(alert.getAttribute('data-testid')).toBe('settings-machines-error')
    expect(access().getAttribute('aria-checked')).toBe('true')

    fireEvent.click(keepAwake())
    // Still shown while main has not answered the next change.
    expect(screen.getByRole('alert').textContent).toBe(refusal)
    await act(async () => main.calls[1]!.answer({ ok: true, value: linkState(2, { projectsAccess: true, keepAwake: false }) }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(keepAwake().getAttribute('aria-checked')).toBe('false')
  })

  it('answers out of order: the last click decides the message', async () => {
    await mountSettings(linkState(1, { projectsAccess: true }))
    fireEvent.click(access())
    fireEvent.click(keepAwake())
    // The later click is answered first, and worked; then the earlier one is refused.
    await act(async () => main.calls[1]!.answer({ ok: true, value: linkState(2, { projectsAccess: true, keepAwake: false }) }))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => main.calls[0]!.answer({ ok: false, error: 'link.setAccess: late refusal' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(keepAwake().getAttribute('aria-checked')).toBe('false')

    // The other way round: the later click is the refused one, and its message stays.
    fireEvent.click(access())
    fireEvent.click(keepAwake())
    await act(async () => main.calls[3]!.answer({ ok: false, error: 'link.setKeepAwake: refused' }))
    await act(async () => main.calls[2]!.answer({ ok: true, value: linkState(3, { projectsAccess: false, keepAwake: false }) }))
    expect(screen.getByRole('alert').textContent).toBe('link.setKeepAwake: refused')
    expect(access().getAttribute('aria-checked')).toBe('false')
  })

  it('Settings closed before main answered: the change is kept and shown when the section opens again', async () => {
    const { view, MachinesSection } = await mountSettings(linkState(1, { projectsAccess: true }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fireEvent.click(keepAwake())
    fireEvent.click(access())
    view.unmount()
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2, { projectsAccess: true, keepAwake: false }) }))
    // A refusal that arrives after the section is gone changes nothing and breaks nothing.
    await act(async () => main.calls[1]!.answer({ ok: false, error: 'link.setAccess: refused' }))
    expect(errors).not.toHaveBeenCalled()

    render(<MachinesSection />)
    await waitFor(() => expect(keepAwake().getAttribute('aria-checked')).toBe('false'))
    expect(access().getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Sleep is kept away only while access is on (src/main/link/keep-awake.ts, `wanted()`): with access
  // off the keep-awake switch would promise what does not happen, so it is disabled and shows "off".
  const KEEP_AWAKE_NEEDS_ACCESS = 'Turn on "Linked machines can work with my Projects" first'
  const STARTED_WORK_KEEPS_RUNNING = 'Work already started from a Linked machine keeps running'

  it('under the access switch: work already started from a Linked machine keeps running — with access off and on', async () => {
    await mountSettings(linkState(1, { linked: [machine(MINI, 'Mini')] }))
    const row = screen.getByTestId('settings-machines-access-row')
    expect(within(row).getByText(STARTED_WORK_KEEPS_RUNNING)).toBeTruthy()
    // One line, in this row only.
    expect(screen.getAllByText(STARTED_WORK_KEEPS_RUNNING)).toHaveLength(1)
    expect(within(screen.getByTestId('settings-machines-keep-awake-row')).queryByText(STARTED_WORK_KEEPS_RUNNING)).toBeNull()

    act(() => main.linkChanged(linkState(2, { linked: [machine(MINI, 'Mini')], projectsAccess: true })))
    expect(within(screen.getByTestId('settings-machines-access-row')).getByText(STARTED_WORK_KEEPS_RUNNING)).toBeTruthy()
  })

  it('access off, a Linked machine online: keep-awake is disabled, shows off, says why, and a click asks main for nothing', async () => {
    // keepAwake is on in link/settings.json; sleep is not kept away while access is off.
    await mountSettings(linkState(1, { linked: [machine(MINI, 'Mini')], projectsAccess: false, keepAwake: true }))
    expect(keepAwake().disabled).toBe(true)
    expect(keepAwake().getAttribute('aria-checked')).toBe('false')
    expect(keepAwake().getAttribute('title')).toBe(KEEP_AWAKE_NEEDS_ACCESS)
    // The access switch itself works, and has no such hint.
    expect(access().disabled).toBe(false)
    expect(access().getAttribute('title')).toBeNull()
    fireEvent.click(keepAwake())
    expect(main.calls).toStrictEqual([])
  })

  // The row of a disabled switch is drawn dimmed (settings.css, `.w-setting-row[data-disabled]`): an
  // "off" that cannot be switched must not look like an "off" that can.
  it('the row of the disabled keep-awake switch is marked disabled, the access row is not; access on — neither', async () => {
    const linked = [machine(MINI, 'Mini')]
    await mountSettings(linkState(1, { linked, projectsAccess: false }))
    const keepAwakeRow = () => screen.getByTestId('settings-machines-keep-awake-row')
    const accessRow = () => screen.getByTestId('settings-machines-access-row')
    expect(keepAwakeRow().hasAttribute('data-disabled')).toBe(true)
    expect(accessRow().hasAttribute('data-disabled')).toBe(false)

    act(() => main.linkChanged(linkState(2, { linked, projectsAccess: true })))
    expect(keepAwakeRow().hasAttribute('data-disabled')).toBe(false)
    expect(accessRow().hasAttribute('data-disabled')).toBe(false)

    // Without this Machine both rows are disabled.
    act(() => main.linkChanged(linkState(3, { machine: null, problem: 'the link service stopped' })))
    expect(keepAwakeRow().hasAttribute('data-disabled')).toBe(true)
    expect(accessRow().hasAttribute('data-disabled')).toBe(true)
  })

  it('access switched on: keep-awake works again and shows the value kept in main; switched off: kept, not reset', async () => {
    const linked = [machine(MINI, 'Mini')]
    await mountSettings(linkState(1, { linked, projectsAccess: false, keepAwake: true }))
    fireEvent.click(access())
    expect(linkCalls()).toStrictEqual([['link.setAccess', { projectsAccess: true }]])
    // Disabled until main says access is on.
    expect(keepAwake().disabled).toBe(true)
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2, { linked, projectsAccess: true, keepAwake: true }) }))
    expect(keepAwake().disabled).toBe(false)
    expect(keepAwake().getAttribute('aria-checked')).toBe('true')
    expect(keepAwake().getAttribute('title')).toBeNull()

    // Access off again, keep-awake still on in main: disabled and off, and nothing asks main to
    // change keep-awake.
    fireEvent.click(access())
    await act(async () => main.calls[1]!.answer({ ok: true, value: linkState(3, { linked, projectsAccess: false, keepAwake: true }) }))
    expect(keepAwake().disabled).toBe(true)
    expect(keepAwake().getAttribute('aria-checked')).toBe('false')
    expect(linkCalls()).toStrictEqual([
      ['link.setAccess', { projectsAccess: true }],
      ['link.setAccess', { projectsAccess: false }],
    ])

    // On once more: on, as it was kept.
    act(() => main.linkChanged(linkState(4, { linked, projectsAccess: true, keepAwake: true })))
    expect(keepAwake().disabled).toBe(false)
    expect(keepAwake().getAttribute('aria-checked')).toBe('true')
    fireEvent.click(keepAwake())
    expect(linkCalls()[2]).toStrictEqual(['link.setKeepAwake', { keepAwake: false }])
  })

  it('without this Machine keep-awake is disabled without the access hint: switching access on would not help', async () => {
    await mountSettings(linkState(1, { machine: null, problem: 'the link service has not started yet', projectsAccess: true, keepAwake: true }))
    expect(keepAwake().disabled).toBe(true)
    expect(keepAwake().getAttribute('title')).toBeNull()
  })

  it('the sidebar and Settings read one state: access switched on in Settings while the sidebar shows the dot', async () => {
    preload(linkState(1, { linked: [machine(MINI, 'Mini')] }))
    const { default: SidebarMachines } = await import('../../src/renderer/shell/sidebar/MachinesSection')
    const { default: SettingsMachines } = await import('../../src/renderer/settings/MachinesSection')
    render(
      <>
        <SidebarMachines />
        <SettingsMachines />
      </>,
    )
    await settle()
    expect(dot()!.getAttribute('aria-label')).toBe('1 linked machine online')
    fireEvent.click(access())
    // The answer of main carries the whole link state: Mini went to sleep meanwhile.
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2, { projectsAccess: true, linked: [machine(MINI, 'Mini', 'sleeping')] }) }))
    expect(access().getAttribute('aria-checked')).toBe('true')
    expect(dot()).toBeNull()
    // The switches are in Settings only.
    expect(within(region()).queryAllByRole('switch', { hidden: true })).toStrictEqual([])
  })
})
