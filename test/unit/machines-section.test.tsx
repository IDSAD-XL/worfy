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
import type { LinkedState } from '../../src/shared/ipc/linked'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const THIS = '11111111-1111-4111-8111-111111111111'
const MINI = '22222222-2222-4222-8222-222222222222'
const ATTIC = '33333333-3333-4333-8333-333333333333'

const machine = (id: string, name: string, state: LinkedMachineView['state'] = 'online', certificateChanged = false, access: LinkedMachineView['access'] = 'off'): LinkedMachineView => ({ id, name, state, certificateChanged, access })

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
  tailscale: false,
  ...change,
})

const appSettings = (revision: number, collapsed: Record<string, boolean> = {}): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision,
})

interface FakeMain {
  /** Every call of a channel that changes something, oldest first, with the way to answer it. */
  calls: { channel: string; input: unknown; answer: (result: IpcResult<unknown>) => void }[]
  /** Fires `link.changed`, as main does after any change of the link. */
  linkChanged: (state: LinkState) => void
  /** Fires `linked.changed`: what this Machine learned of the Linked machines over the link. */
  linkedChanged: (state: LinkedState) => void
}

let main: FakeMain

/**
 * This Machine's preload: `link` answers `link.state`, `settings` answers `appSettings.get`, `linked`
 * answers `linked.state` (nothing known of the Linked machines by default).
 */
function preload(link: LinkState, settings: AppSettings = appSettings(0), linked: LinkedState = { revision: 0, machines: [] }): void {
  const handlers = new Map<string, (payload: unknown) => void>()
  const fake: FakeMain = { calls: [], linkChanged: (state) => handlers.get('link.changed')?.(state), linkedChanged: (state) => handlers.get('linked.changed')?.(state) }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'link.state') return Promise.resolve({ ok: true, value: link } as never)
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: settings } as never)
      if (channel === 'linked.state') return Promise.resolve({ ok: true, value: linked } as never)
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
const TAILSCALE = 'Link through Tailscale'

async function mountSettings(link: LinkState) {
  preload(link)
  const { default: MachinesSection } = await import('../../src/renderer/settings/MachinesSection')
  const view = render(<MachinesSection />)
  await settle()
  return { view, MachinesSection }
}

const access = () => screen.getByRole('switch', { name: ACCESS }) as HTMLButtonElement
const keepAwake = () => screen.getByRole('switch', { name: KEEP_AWAKE }) as HTMLButtonElement
const tailscale = () => screen.getByRole('switch', { name: TAILSCALE }) as HTMLButtonElement
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
    // The third is "Link through Tailscale" (its own describe below).
    expect(screen.getAllByRole('switch')).toHaveLength(3)
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

// worfy-link ticket 18 (ADR-0066): the access level of each Linked machine, in Settings → Machines.
describe('Settings → Machines: the level of each Linked machine', () => {
  const level = (id: string) => screen.getByTestId(`link-machine-access-${id}`) as HTMLButtonElement
  const row = (id: string) => screen.getByTestId(`settings-machines-level-row-${id}`)
  const TRUST = 'Read only still means trust: a Session transcript can show a secret'

  it('a row per Linked machine with its level and what the level means; read only says plainly it is still trust', async () => {
    await mountSettings(linkState(1, { linked: [machine(MINI, 'Mini', 'online', false, 'read'), machine(ATTIC, 'Attic', 'unavailable', false, 'all')], projectsAccess: true }))
    expect(level(MINI).textContent).toContain('Read only')
    expect(level(ATTIC).textContent).toContain('Full access')
    expect(level(MINI).getAttribute('aria-label')).toBe('Access of Mini to my Projects')
    expect(within(row(MINI)).getByText('Mini')).toBeTruthy()
    expect(within(row(MINI)).getByText(new RegExp(TRUST))).toBeTruthy()
    expect(within(row(MINI)).getByText(/not Terminal output/)).toBeTruthy()
    expect(within(row(ATTIC)).queryByText(new RegExp(TRUST))).toBeNull()
    expect(level(MINI).disabled).toBe(false)
  })

  it('a new Linked machine shows Off; choosing Read only calls link.setMachineAccess and shows what main answered', async () => {
    await mountSettings(linkState(1, { linked: [machine(MINI, 'Mini')], projectsAccess: true }))
    expect(level(MINI).textContent).toContain('Off')
    expect(within(row(MINI)).getByText('Cannot see or change your Projects')).toBeTruthy()
    fireEvent.click(level(MINI))
    const option = screen.getAllByRole('option').find((element) => element.getAttribute('data-value') === 'read')
    if (option === undefined) throw new Error('no option read')
    fireEvent.click(option)
    expect(linkCalls()).toStrictEqual([['link.setMachineAccess', { id: MINI, access: 'read' }]])
    // Not changed until main says so.
    expect(level(MINI).textContent).toContain('Off')
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2, { linked: [machine(MINI, 'Mini', 'online', false, 'read')], projectsAccess: true }) }))
    expect(level(MINI).textContent).toContain('Read only')
  })

  it('access off for everyone: each row shows Off, is disabled and dimmed, and says why; the level kept in main shows again once access is on', async () => {
    const linked = [machine(MINI, 'Mini', 'online', false, 'all')]
    await mountSettings(linkState(1, { linked, projectsAccess: false }))
    expect(level(MINI).textContent).toContain('Off')
    expect(level(MINI).disabled).toBe(true)
    expect(level(MINI).getAttribute('title')).toBe('Turn on "Linked machines can work with my Projects" first')
    expect(row(MINI).hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(level(MINI))
    expect(screen.queryAllByRole('option')).toStrictEqual([])
    expect(main.calls).toStrictEqual([])

    act(() => main.linkChanged(linkState(2, { linked, projectsAccess: true })))
    expect(level(MINI).textContent).toContain('Full access')
    expect(level(MINI).disabled).toBe(false)
    expect(row(MINI).hasAttribute('data-disabled')).toBe(false)
  })

  it('a refusal of main is shown under the switches', async () => {
    await mountSettings(linkState(1, { linked: [machine(MINI, 'Mini')], projectsAccess: true }))
    fireEvent.click(level(MINI))
    const option = screen.getAllByRole('option').find((element) => element.getAttribute('data-value') === 'all')
    if (option === undefined) throw new Error('no option all')
    fireEvent.click(option)
    await act(async () => main.calls[0]!.answer({ ok: false, error: `link.setMachineAccess failed: Machine ${MINI} is not linked` }))
    expect(screen.getByRole('alert').textContent).toContain('is not linked')
  })
})

// worfy-link ticket 27 (ADR-0070, point 3).
describe('Settings → Machines: "Link through Tailscale"', () => {
  it('shows off as main has it, enabled whether access is on or off', async () => {
    await mountSettings(linkState(1, { projectsAccess: false }))
    expect(tailscale().getAttribute('aria-checked')).toBe('false')
    expect(tailscale().disabled).toBe(false)
    expect(tailscale().getAttribute('data-testid')).toBe('link-tailscale-switch')
    expect(screen.getByTestId('settings-machines-tailscale-row').hasAttribute('data-disabled')).toBe(false)
    expect(screen.getByText(TAILSCALE)).toBeTruthy()
  })

  it('a click calls link.setTailscale with the other value, and the switch shows what main answered', async () => {
    await mountSettings(linkState(1))
    fireEvent.click(tailscale())
    expect(linkCalls()).toStrictEqual([['link.setTailscale', { tailscale: true }]])
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2, { tailscale: true }) }))
    expect(tailscale().getAttribute('aria-checked')).toBe('true')
    fireEvent.click(tailscale())
    expect(linkCalls()[1]).toStrictEqual(['link.setTailscale', { tailscale: false }])
    await act(async () => main.calls[1]!.answer({ ok: false, error: 'link.setTailscale: refused' }))
    expect(tailscale().getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('link.setTailscale: refused')
  })

  it('without this Machine it is disabled', async () => {
    await mountSettings(linkState(1, { machine: null, problem: 'the link service has not started yet', tailscale: true }))
    expect(tailscale().disabled).toBe(true)
    fireEvent.click(tailscale())
    expect(linkCalls()).toStrictEqual([])
  })
})

// ── worfy-link ticket 37: Reconnect, Remove, Change address…, the access both ways ──────────────

const HINT = 'worfy does not find this machine on the network: it may be off, asleep or on another network.'
const linkedInfo = (id: string, sharing: 'yes' | 'no' | 'unknown', revision = 1): LinkedState => ({ revision, machines: [{ id, online: false, sharing, readOnly: false, epoch: 1 }] })

/** The sidebar section and the shell's host of the Machine windows, as AppShell has them. */
async function mountWithDialogs(link: LinkState, linked?: LinkedState) {
  preload(link, appSettings(0, { MachinesSection: false }), linked)
  const { default: MachinesSection } = await import('../../src/renderer/shell/sidebar/MachinesSection')
  const { MachineDialogs } = await import('../../src/renderer/machines/MachineDialogs')
  const view = render(
    <>
      <MachinesSection />
      <MachineDialogs />
    </>,
  )
  await settle()
  return view
}

async function mountSettingsWithDialogs(link: LinkState, linked?: LinkedState) {
  preload(link, appSettings(0), linked)
  const { default: MachinesSection } = await import('../../src/renderer/settings/MachinesSection')
  const { MachineDialogs } = await import('../../src/renderer/machines/MachineDialogs')
  const view = render(
    <>
      <MachinesSection />
      <MachineDialogs />
    </>,
  )
  await settle()
  return view
}

const rowOf = (id: string) => {
  const element = document.querySelector<HTMLElement>(`[data-testid="machine-row"][data-machine-id="${id}"]`)
  if (element === null) throw new Error(`no row for ${id}`)
  return element
}
const accessLines = (scope: HTMLElement, testId = 'machine-access-line') => within(scope).queryAllByTestId(testId).map((line) => line.textContent)

describe('a Machine row without a connection (worfy-link ticket 37)', () => {
  it('shows Offline with Reconnect, Change address… and Remove; an online row has none of them', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable'), machine(ATTIC, 'Attic', 'online')] }))
    const mini = rowOf(MINI)
    expect(within(mini).getByText('Offline')).toBeTruthy()
    expect(within(mini).queryByText('Unavailable')).toBeNull()
    expect(within(mini).getByRole('button', { name: 'Reconnect Mini' })).toBeTruthy()
    expect(within(mini).getByRole('button', { name: 'Change address of Mini' })).toBeTruthy()
    expect(within(mini).getByRole('button', { name: 'Remove Mini' })).toBeTruthy()
    const attic = rowOf(ATTIC)
    expect(within(attic).getByText('Online')).toBeTruthy()
    for (const name of ['Reconnect Attic', 'Change address of Attic', 'Remove Attic']) expect(within(attic).queryByRole('button', { name })).toBeNull()
  })

  it('a sleeping Machine and one with another certificate have the buttons too: neither is connected', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'sleeping'), machine(ATTIC, 'Attic', 'unavailable', true)] }))
    expect(within(rowOf(MINI)).getByText('Sleeping')).toBeTruthy()
    expect(within(rowOf(ATTIC)).getByText('Certificate changed')).toBeTruthy()
    expect(within(rowOf(MINI)).getByRole('button', { name: 'Reconnect Mini' })).toBeTruthy()
    expect(within(rowOf(ATTIC)).getByRole('button', { name: 'Reconnect Attic' })).toBeTruthy()
    // The tooltip of "Certificate changed" says Remove, not Revoke.
    expect(rowOf(ATTIC).getAttribute('title')).toBe('Attic answered with another certificate. Remove it, then link it again with Link a machine')
  })

  it('shows the firewall hint when main gives one, and nothing when it does not', async () => {
    await mountWithDialogs(linkState(1, { linked: [{ ...machine(MINI, 'Mini', 'unavailable'), hint: `${HINT} Check Windows firewall.` }, machine(ATTIC, 'Attic', 'unavailable')] }))
    expect(within(rowOf(MINI)).getByTestId('machine-hint').textContent).toBe(`${HINT} Check Windows firewall.`)
    expect(within(rowOf(ATTIC)).queryByTestId('machine-hint')).toBeNull()
  })

  it('Reconnect calls link.reconnect for the Machine; while worfy dials it the button is inactive and says it is connecting', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Reconnect Mini' }))
    expect(linkCalls()).toStrictEqual([['link.reconnect', { id: MINI }]])
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2, { linked: [{ ...machine(MINI, 'Mini', 'unavailable'), dialing: true }] }) }))
    const button = within(rowOf(MINI)).getByTestId('machine-reconnect') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Connecting…')
    expect(button.title).toBe('worfy is connecting to Mini')
    fireEvent.click(button)
    expect(main.calls).toHaveLength(1)
    // The dial ended without a connection: Reconnect is there again.
    act(() => main.linkChanged(linkState(3, { linked: [machine(MINI, 'Mini', 'unavailable')] })))
    expect((within(rowOf(MINI)).getByTestId('machine-reconnect') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a refusal of link.reconnect is shown above the list', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Reconnect Mini' }))
    await act(async () => main.calls[0]!.answer({ ok: false, error: 'link.reconnect: Machine is not linked' }))
    expect(screen.getByTestId('machines-error').textContent).toBe('link.reconnect: Machine is not linked')
  })
})

describe('Remove asks first (worfy-link ticket 37)', () => {
  it('Remove opens the confirmation; Cancel closes it and calls nothing', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Remove Mini' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Mini?' })
    expect(dialog.textContent).toBe(
      'Remove Mini?Mini will be forgotten here now, and on Mini the next time it connects to this computer. It is the last linked machine, so this computer stops listening for links: Mini shows this computer as Offline until you remove it there too, or open Link a machine here. To link it again, use Link a machine with a new code.CancelRemove',
    )
    // The focus is on Cancel: Enter right away does not remove.
    expect(document.activeElement?.textContent).toBe('Cancel')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(main.calls).toStrictEqual([])
  })

  it('Esc closes the confirmation and calls nothing', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Remove Mini' }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Remove Mini?' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(main.calls).toStrictEqual([])
  })

  it('confirmed, it calls link.revoke for the Machine; the window closes and the row goes with main\'s answer', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Remove Mini' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Mini?' })).getByRole('button', { name: 'Remove' }))
    expect(linkCalls()).toStrictEqual([['link.revoke', { id: MINI }]])
    await act(async () => main.calls[0]!.answer({ ok: true, value: linkState(2) }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[data-testid="machine-row"]')).toBeNull()
  })

  it('a refusal stays in the window, and the Machine stays', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Remove Mini' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Mini?' })).getByRole('button', { name: 'Remove' }))
    await act(async () => main.calls[0]!.answer({ ok: false, error: 'link.revoke: the link service has not started' }))
    expect(within(screen.getByRole('dialog', { name: 'Remove Mini?' })).getByRole('alert').textContent).toBe('link.revoke: the link service has not started')
    expect(rowOf(MINI)).toBeTruthy()
  })

  it('the row menu has Reconnect, Change address… and Remove, and the word Revoke is nowhere', async () => {
    const { container } = await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable'), machine(ATTIC, 'Attic', 'online', true)] }))
    fireEvent.contextMenu(rowOf(MINI))
    expect(within(screen.getByRole('menu', { name: 'Machine Mini' })).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Reconnect', 'Change address…', 'Remove'])
    expect(document.body.textContent).not.toMatch(/revoke/i)
    expect(container.innerHTML).not.toMatch(/revoke/i)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(screen.getByRole('dialog', { name: 'Remove Mini?' })).toBeTruthy()
    expect(main.calls).toStrictEqual([])
    expect(document.body.innerHTML).not.toMatch(/revoke/i)
  })

  it('an online Machine\'s menu has Change address… and Remove, without Reconnect', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'online')] }))
    fireEvent.contextMenu(rowOf(MINI))
    expect(within(screen.getByRole('menu', { name: 'Machine Mini' })).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Change address…', 'Remove'])
  })

  it('Settings → Machines: a Remove per Linked machine, with access off too, behind the same confirmation', async () => {
    await mountSettingsWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'online'), machine(ATTIC, 'Attic', 'unavailable')] }))
    const remove = screen.getByRole('button', { name: 'Remove Attic' }) as HTMLButtonElement
    expect(remove.disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Remove Mini' })).toBeTruthy()
    fireEvent.click(remove)
    const dialog = screen.getByRole('dialog', { name: 'Remove Attic?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(main.calls).toStrictEqual([])
    fireEvent.click(remove)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Attic?' })).getByRole('button', { name: 'Remove' }))
    expect(linkCalls()).toStrictEqual([['link.revoke', { id: ATTIC }]])
    expect(document.body.innerHTML).not.toMatch(/revoke/i)
  })
})

describe('Change address… (worfy-link ticket 37)', () => {
  const openDialog = async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Change address of Mini' }))
    return screen.getByRole('dialog', { name: 'Change address of Mini' })
  }
  const field = () => screen.getByTestId('change-address-input') as HTMLInputElement

  it('an address that does not parse is refused in the window, and main is not asked', async () => {
    const dialog = await openDialog()
    expect(document.activeElement).toBe(field())
    fireEvent.change(field(), { target: { value: 'mini.local' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert').textContent).toBe('Add the port: host:port')
    expect(main.calls).toStrictEqual([])
  })

  it('saves through link.setAddress; a refusal of main is shown in the window and the window stays', async () => {
    const dialog = await openDialog()
    fireEvent.change(field(), { target: { value: ' 192.168.1.44:52000 ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(linkCalls()).toStrictEqual([['link.setAddress', { id: MINI, address: '192.168.1.44:52000' }]])
    expect(within(dialog).getByRole('button', { name: 'Checking…' })).toBeTruthy()
    const refusal = 'Another worfy answers at 192.168.1.44:52000: it is not Mini. The address stays as it was'
    await act(async () => main.calls[0]!.answer({ ok: true, value: { status: 'failed', reason: refusal, state: linkState(2, { linked: [machine(MINI, 'Mini', 'unavailable')] }) } }))
    expect(within(screen.getByRole('dialog', { name: 'Change address of Mini' })).getByRole('alert').textContent).toBe(refusal)
  })

  it('saved: the window closes', async () => {
    const dialog = await openDialog()
    fireEvent.change(field(), { target: { value: 'mini.local:52000' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(linkCalls()).toStrictEqual([['link.setAddress', { id: MINI, address: 'mini.local:52000' }]])
    expect(dialog.isConnected).toBe(true)
    await act(async () => main.calls[0]!.answer({ ok: true, value: { status: 'saved', state: linkState(2, { linked: [machine(MINI, 'Mini', 'online')] }) } }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cancel closes it and asks main nothing', async () => {
    const dialog = await openDialog()
    fireEvent.change(field(), { target: { value: 'mini.local:52000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(main.calls).toStrictEqual([])
  })
})

describe('the access both ways in a Machine row (worfy-link ticket 37)', () => {
  it('the sidebar: both lines, and each follows a change on its own side', async () => {
    await mountWithDialogs(linkState(1, { projectsAccess: true, linked: [machine(MINI, 'Mini', 'online', false, 'read')] }), linkedInfo(MINI, 'yes'))
    expect(accessLines(rowOf(MINI))).toEqual(['Shares its Projects with you', 'Can work with your Projects'])
    // Turned off on the other side: it said so over the link.
    act(() => main.linkedChanged(linkedInfo(MINI, 'no', 2)))
    expect(accessLines(rowOf(MINI))).toEqual(["Doesn't share its Projects", 'Can work with your Projects'])
    // Turned off here: the switch for every Linked machine.
    act(() => main.linkChanged(linkState(2, { projectsAccess: false, linked: [machine(MINI, 'Mini', 'online', false, 'read')] })))
    expect(accessLines(rowOf(MINI))).toEqual(["Doesn't share its Projects", "Can't see your Projects"])
    // On again here, but this Machine's level for it is Off.
    act(() => main.linkChanged(linkState(3, { projectsAccess: true, linked: [machine(MINI, 'Mini', 'online', false, 'off')] })))
    expect(accessLines(rowOf(MINI))).toEqual(["Doesn't share its Projects", "Can't see your Projects"])
    // On again on the other side.
    act(() => main.linkedChanged(linkedInfo(MINI, 'yes', 3)))
    expect(accessLines(rowOf(MINI))).toEqual(['Shares its Projects with you', "Can't see your Projects"])
  })

  it('the line about the other side is there only once the link said it', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }), linkedInfo(MINI, 'unknown'))
    expect(accessLines(rowOf(MINI))).toEqual(["Can't see your Projects"])
  })

  it('Settings → Machines: the same two lines under each Linked machine', async () => {
    await mountSettingsWithDialogs(linkState(1, { projectsAccess: true, linked: [machine(MINI, 'Mini', 'online', false, 'all')] }), linkedInfo(MINI, 'yes'))
    const row = screen.getByTestId(`settings-machines-level-row-${MINI}`)
    expect(accessLines(row, 'settings-machine-access-line')).toEqual(['Shares its Projects with you', 'Can work with your Projects'])
    act(() => main.linkedChanged(linkedInfo(MINI, 'no', 2)))
    act(() => main.linkChanged(linkState(2, { projectsAccess: false, linked: [machine(MINI, 'Mini', 'online', false, 'all')] })))
    expect(accessLines(row, 'settings-machine-access-line')).toEqual(["Doesn't share its Projects", "Can't see your Projects"])
  })
})

describe('"Link a machine" and a Machine already linked (worfy-link ticket 37)', () => {
  it('lists it as Already linked, with no way to link it and the line about one link both ways', async () => {
    preload(
      linkState(1, {
        bonjour: true,
        linking: { open: true, code: '482913', expiresAt: Date.now() + 60_000, linked: null, failure: null },
        linked: [machine(MINI, 'Mini', 'online')],
        discovered: [{ id: ATTIC, name: 'Attic', host: '192.168.1.31', port: 52000, protocol: 1, compatible: true, conflict: false }],
        discoveredLinked: [MINI],
      }),
    )
    const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
    render(<LinkMachineDialog onClose={() => undefined} />)
    await settle()
    const list = screen.getByRole('list', { name: 'Found in the network' })
    const mini = within(list).getByTestId('link-found-linked-row')
    expect(mini.dataset.machineId).toBe(MINI)
    expect(within(mini).getByText('Mini')).toBeTruthy()
    expect(within(mini).getByText('Already linked')).toBeTruthy()
    expect(within(mini).getByTestId('link-found-linked-hint').textContent).toBe(
      'One link works both ways. To open Mini\'s Projects here, turn on "Linked machines can work with my Projects" on Mini.',
    )
    expect(within(mini).queryByRole('button')).toBeNull()
    // Another worfy found is still offered for linking.
    const attic = within(list).getByTestId('link-found-row')
    expect(attic.dataset.machineId).toBe(ATTIC)
    expect(within(attic).getByRole('button')).toBeTruthy()
    expect(within(attic).queryByText('Already linked')).toBeNull()
  })

  it('with only a Linked machine found, the list shows it instead of "Looking for worfy…"', async () => {
    preload(
      linkState(1, {
        bonjour: true,
        linking: { open: true, code: '482913', expiresAt: Date.now() + 60_000, linked: null, failure: null },
        linked: [machine(MINI, 'Mini', 'online')],
        discoveredLinked: [MINI],
      }),
    )
    const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
    render(<LinkMachineDialog onClose={() => undefined} />)
    await settle()
    expect(screen.getByTestId('link-found-linked-row').textContent).toContain('Already linked')
    expect(screen.queryByText('Looking for worfy in the local network…')).toBeNull()
  })
})

describe('worfy-link ticket 37, review round', () => {
  it('Remove of one of several Linked machines does not speak of this computer no longer listening', async () => {
    await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable'), machine(ATTIC, 'Attic', 'online')] }))
    fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: 'Remove Mini' }))
    const text = screen.getByRole('dialog', { name: 'Remove Mini?' }).textContent ?? ''
    expect(text).toContain('Mini will be forgotten here now, and on Mini the next time it connects to this computer.')
    expect(text).not.toContain('stops listening')
  })

  it('an offline row does not show what the other side last said about sharing; online again, it does', async () => {
    await mountWithDialogs(linkState(1, { projectsAccess: true, linked: [machine(MINI, 'Mini', 'unavailable', false, 'all')] }), linkedInfo(MINI, 'yes'))
    expect(accessLines(rowOf(MINI))).toEqual(['Can work with your Projects'])
    act(() => main.linkChanged(linkState(2, { projectsAccess: true, linked: [machine(MINI, 'Mini', 'online', false, 'all')] })))
    expect(accessLines(rowOf(MINI))).toEqual(['Shares its Projects with you', 'Can work with your Projects'])
    act(() => main.linkChanged(linkState(3, { projectsAccess: true, linked: [machine(MINI, 'Mini', 'online', true, 'all')] })))
    expect(accessLines(rowOf(MINI))).toEqual(['Can work with your Projects'])
  })

  for (const kind of ['Change address of Mini', 'Remove Mini'] as const) {
    it(`${kind}: Tab and Shift+Tab stay inside the window, focus behind it comes back, and Esc still closes it`, async () => {
      await mountWithDialogs(linkState(1, { linked: [machine(MINI, 'Mini', 'unavailable')] }))
      fireEvent.click(within(rowOf(MINI)).getByRole('button', { name: kind }))
      const dialog = screen.getByRole('dialog')
      const inside = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input')]
      const first = inside[0]!
      const last = inside.at(-1)!
      last.focus()
      fireEvent.keyDown(last, { key: 'Tab' })
      expect(document.activeElement).toBe(first)
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)
      // Something behind the window takes the focus: it comes back inside.
      within(rowOf(MINI)).getByRole('button', { name: 'Reconnect Mini' }).focus()
      expect(dialog.contains(document.activeElement)).toBe(true)
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(main.calls).toStrictEqual([])
    })
  }
})
