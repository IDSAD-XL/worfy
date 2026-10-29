// "Add project" with Linked machines (worfy-link ticket 11): the Machine first, then the folder —
// this Machine's system picker, or a Linked machine's folders inside worfy (FolderBrowser). The
// sidebar section runs over the real renderer IPC client and a fake preload of this Machine;
// a Linked machine's calls go out as `linked.invoke` and are answered here.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LinkState } from '../../src/shared/ipc/link'
import type { LinkedState } from '../../src/shared/ipc/linked'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import { ms } from '../time-scale'

const THIS = '11111111-1111-4111-8111-111111111111'
/** Online, shares its Projects. */
const MINI = '22222222-2222-4222-8222-222222222222'
/** Not online. */
const ATTIC = '33333333-3333-4333-8333-333333333333'
/** Online, access off. */
const ZETA = '44444444-4444-4444-8444-444444444444'

type Linked = { id: string; name: string; state?: 'online' | 'unavailable' | 'sleeping'; sharing?: 'yes' | 'no' | 'unknown' }

const linkState = (linked: Linked[]): LinkState => ({
  revision: 1,
  machine: { id: THIS, name: 'Studio' },
  problem: null,
  listening: linked.length > 0,
  addresses: [],
  bonjour: false,
  linking: { open: false, code: null, expiresAt: null, linked: null, failure: null },
  linked: linked.map(({ id, name, state = 'online' }) => ({ id, name, state, certificateChanged: false, access: 'all' as const })),
  discovered: [],
  projectsAccess: false,
  keepAwake: true,
  tailscale: false,
})

const linkedState = (linked: Linked[]): LinkedState => ({
  revision: 1,
  machines: linked.map(({ id, state = 'online', sharing = 'yes' }) => ({ id, sharing, readOnly: false, epoch: 1, online: state === 'online' })),
})

const own: ProjectsState = { projects: [{ id: 'studio-00000001', name: 'studio', path: '/repos/studio', branch: 'main' }], activeId: 'studio-00000001', revision: 1 }
const miniList = (extra: ProjectsState['projects'] = []): ProjectsState => ({
  projects: [{ id: 'mini-00000001', name: 'mini', path: '/Users/m/mini', branch: 'main' }, ...extra],
  activeId: 'mini-00000001',
  revision: extra.length + 1,
})
const SHOP = { id: 'shop-0000000a', name: 'shop', path: '/Users/m/code/shop', branch: 'main' }

/**
 * This Machine's preload. `answers` answer a Linked machine's calls by channel; this Machine's own
 * calls answer the list, the link state and the picker.
 */
function preload(linked: Linked[], answers: Record<string, (input: unknown) => unknown> = {}) {
  const calls: [string, unknown][] = []
  const answer = (channel: string, input: unknown): unknown => {
    switch (channel) {
      case 'projects.list':
        return { ok: true, value: own }
      case 'link.state':
        return { ok: true, value: linkState(linked) }
      case 'linked.state':
        return { ok: true, value: linkedState(linked) }
      case 'projects.pickFolder':
        return { ok: true, value: { path: null } }
      case 'linked.invoke': {
        const call = input as { machine: string; channel: string; input: unknown }
        const machine = linked.find((candidate) => candidate.id === call.machine)
        if (machine?.sharing === 'no') return { ok: true, value: { ok: false, error: `Linked machines cannot work with the Projects of ${machine.name}: access is off` } }
        if (call.channel === 'projects.list') return { ok: true, value: { ok: true, value: miniList() } }
        const handler = answers[call.channel]
        if (handler === undefined) return { ok: true, value: { ok: false, error: `unexpected ${call.channel}` } }
        return { ok: true, value: { ok: true, value: handler(call.input) } }
      }
      default:
        return { ok: false, error: `unexpected ${channel}` }
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      calls.push([channel, input])
      return Promise.resolve(answer(channel, input) as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  return { bridge, calls }
}

let load: Mock<(url: string) => void>

async function mount(linked: Linked[], answers?: Record<string, (input: unknown) => unknown>) {
  window.history.replaceState(null, '', '/')
  const fake = preload(linked, answers)
  ;(globalThis as { worfy?: WorfyBridge }).worfy = fake.bridge
  vi.resetModules()
  const projects = await import('../../src/renderer/projects/useProjects')
  load = vi.fn<(url: string) => void>()
  projects.navigation.load = load
  const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
  render(<ProjectsSection />)
  await waitFor(() => expect(screen.getAllByTestId('project-row').length).toBeGreaterThan(0))
  return fake
}

/** The calls a Linked machine got, as [machine, channel, input]. */
const linkedCalls = (calls: [string, unknown][]) =>
  calls.filter(([channel]) => channel === 'linked.invoke').map(([, input]) => {
    const call = input as { machine: string; channel: string; input: unknown }
    return [call.machine, call.channel, call.input] as const
  })

const option = (machine: string | null) =>
  screen.getAllByTestId('add-project-machine-option').find((candidate) => candidate.getAttribute('data-machine-id') === (machine ?? null))!

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  window.history.replaceState(null, '', '/')
})

const MACHINES: Linked[] = [
  { id: ZETA, name: 'Zeta', sharing: 'no' },
  { id: MINI, name: 'Mini' },
  { id: ATTIC, name: 'Attic', state: 'unavailable', sharing: 'unknown' },
]

describe('"Add project" with Linked machines: the Machine first', () => {
  it('without Linked machines there is no Machine step: this Machine\'s picker opens at once', async () => {
    const { calls } = await mount([])
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(calls.map(([channel]) => channel)).toContain('projects.pickFolder'))
    expect(screen.queryByTestId('add-project-machine')).toBeNull()
    expect(screen.queryByTestId('folder-browser')).toBeNull()
  })

  it('this Machine first, then the Linked machines by name; one not online and one with access off cannot be chosen and say why', async () => {
    const { calls } = await mount(MACHINES)
    // The sidebar learned that Zeta does not share (its list was refused).
    await waitFor(() => expect(screen.getAllByTestId('machine-group')).toHaveLength(4))
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    const step = await screen.findByTestId('add-project-machine')
    const options = within(step).getAllByTestId('add-project-machine-option')
    expect(options.map((candidate) => candidate.getAttribute('data-machine-id'))).toEqual([null, ATTIC, MINI, ZETA])
    expect(options.map((candidate) => (candidate as HTMLButtonElement).disabled)).toEqual([false, true, false, true])
    expect(within(option(ATTIC)).getByTestId('add-project-machine-reason').textContent).toBe('Attic is not online')
    expect(within(option(ZETA)).getByTestId('add-project-machine-reason').textContent).toBe("Zeta doesn't let Linked machines work with its Projects")
    expect(within(option(MINI)).queryByTestId('add-project-machine-reason')).toBeNull()
    // A click on one that cannot be chosen does nothing.
    fireEvent.click(option(ZETA))
    expect(screen.getByTestId('add-project-machine')).toBeTruthy()
    expect(calls.map(([channel]) => channel)).not.toContain('projects.pickFolder')
  })

  it('choosing this Machine opens its system picker, not the folder browser', async () => {
    const { calls } = await mount(MACHINES)
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await screen.findByTestId('add-project-machine')
    fireEvent.click(option(null))
    await waitFor(() => expect(calls).toContainEqual(['projects.pickFolder', { purpose: 'project' }]))
    expect(screen.queryByTestId('add-project-machine')).toBeNull()
    expect(screen.queryByTestId('folder-browser')).toBeNull()
    expect(linkedCalls(calls).filter(([, channel]) => channel === 'projects.browse')).toEqual([])
  })

  it('choosing a Linked machine opens the folder browser over its folders; the system picker is not called', async () => {
    const { calls } = await mount(MACHINES, {
      'projects.browse': () => ({ ok: true, path: '/Users/m', parent: '/Users', truncated: false, folders: [{ name: 'code', path: '/Users/m/code', hidden: false, gitRepo: false }] }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await screen.findByTestId('add-project-machine')
    fireEvent.click(option(MINI))
    const browser = await screen.findByTestId('folder-browser')
    await waitFor(() => expect(within(browser).getByTestId('folder-browser-path').textContent).toBe('/Users/m'))
    expect(within(browser).getByText(/The folders of Mini/)).toBeTruthy()
    expect(linkedCalls(calls)).toContainEqual([MINI, 'projects.browse', { path: null }])
    expect(calls.map(([channel]) => channel)).not.toContain('projects.pickFolder')
  })

  it('a folder of the Linked machine its Harness knows: added there, the window opens it on that Machine', async () => {
    const { calls } = await mount(MACHINES, {
      'projects.browse': () => ({ ok: true, path: '/Users/m/code/shop', parent: '/Users/m/code', truncated: false, folders: [] }),
      'projects.connect.inspect': () => ({ status: 'added', project: SHOP, notice: null, state: miniList([SHOP]) }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await screen.findByTestId('add-project-machine')
    fireEvent.click(option(MINI))
    await waitFor(() => expect(screen.getByTestId('folder-browser').getAttribute('data-loading')).toBe('no'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(linkedCalls(calls)).toContainEqual([MINI, 'projects.connect.inspect', { path: '/Users/m/code/shop' }])
    const url = new URL(load.mock.calls[0]![0] as string)
    expect(url.searchParams.get('machine')).toBe(MINI)
    expect(url.searchParams.get('project')).toBe(SHOP.id)
    // Nothing went to this Machine: no inspect, no select.
    expect(calls.filter(([channel]) => channel === 'projects.connect.inspect' || channel === 'projects.select')).toEqual([])
  })

  it('a new folder of the Linked machine: the connect dialog runs there — its Workflow folder from its folders, its accounts, no gh sign-in here', async () => {
    const folder = { kind: 'git', root: '/Users/m/code/shop', repos: [{ name: 'shop', path: '/Users/m/code/shop' }], notice: null }
    const draft = { profile: { name: 'shop', mode: 'silent', workflow: { finish: 'local-green' } }, rules: '# shop\n', gate: [] }
    const { calls } = await mount(MACHINES, {
      'projects.browse': (input) => {
        const path = (input as { path: string | null }).path
        return path === null
          ? { ok: true, path: '/Users/m/code/shop', parent: '/Users/m/code', truncated: false, folders: [] }
          : { ok: true, path, parent: '/Users/m', truncated: false, folders: [] }
      },
      'projects.connect.inspect': () => ({ status: 'new', folder, harnessHome: '/Users/m/.claude/worfy-harness' }),
      'projects.connect.draft': () => ({ status: 'draft', draft, issues: [] }),
      'projects.connect.check': () => ({ issues: [] }),
      'projects.connect.accounts': () => ({ status: 'accounts', repos: [{ name: 'shop', host: 'github.com', slug: 'acme/shop' }], skipped: [], accounts: [], selected: null }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await screen.findByTestId('add-project-machine')
    fireEvent.click(option(MINI))
    await waitFor(() => expect(screen.getByTestId('folder-browser').getAttribute('data-loading')).toBe('no'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    const dialog = await screen.findByTestId('connect-project')
    expect(within(dialog).getByTestId('connect-machine').textContent).toContain('On Mini')
    expect(within(dialog).getByTestId('connect-workflow-folder').textContent).toBe('/Users/m/.claude/worfy-harness/projects/<name>/workflow/')

    // The Workflow folder: Mini's folders, not this Machine's picker.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose…' }))
    const browser = await screen.findByTestId('folder-browser')
    await waitFor(() => expect(browser.getAttribute('data-loading')).toBe('no'))
    fireEvent.click(within(browser).getByRole('button', { name: 'Choose' }))
    await waitFor(() => expect(within(dialog).getByTestId('connect-workflow-folder').textContent).toBe('/Users/m/code/shop'))
    expect(screen.queryByTestId('folder-browser')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Write draft' }))
    await within(dialog).findByLabelText('Name')
    await waitFor(() => expect(within(dialog).queryByTestId('connect-github-loading')).toBeNull())
    // Mini's accounts, read there; no sign-in from this screen.
    expect(within(dialog).getByTestId('connect-github-empty').textContent).toContain('gh on Mini has no account for github.com')
    expect(within(dialog).queryByRole('button', { name: 'Sign in with gh' })).toBeNull()
    expect(within(dialog).getByTestId('connect-github-remote')).toBeTruthy()

    // The account's choice is checked by Mini's Harness after a short pause.
    await waitFor(() => expect(linkedCalls(calls).map(([, channel]) => channel)).toContain('projects.connect.check'), { timeout: ms(2000) })
    const onMini = linkedCalls(calls).map(([machine, channel]) => `${machine === MINI ? 'Mini' : machine} ${channel}`)
    expect(onMini).toEqual(expect.arrayContaining(['Mini projects.connect.inspect', 'Mini projects.connect.draft', 'Mini projects.connect.accounts', 'Mini projects.connect.check']))
    expect(linkedCalls(calls)).toContainEqual([MINI, 'projects.connect.draft', expect.objectContaining({ root: '/Users/m/code/shop', workflowFolder: '/Users/m/code/shop' })])
    // None of the connection ran on this Machine, and no picker opened here.
    expect(calls.map(([channel]) => channel).filter((channel) => channel.startsWith('projects.connect.') || channel === 'projects.pickFolder')).toEqual([])
  })

  it('a Linked machine that goes away mid-way: the reason is shown', async () => {
    const { bridge } = await mount(MACHINES, {
      'projects.browse': () => ({ ok: true, path: '/Users/m', parent: '/Users', truncated: false, folders: [] }),
    })
    const invoke = bridge.invoke
    bridge.invoke = (channel, input) =>
      channel === 'linked.invoke' && (input as { channel: string }).channel === 'projects.connect.inspect' ? Promise.resolve({ ok: true, value: { ok: false, error: 'projects.connect.inspect: Mini is unreachable' } } as never) : invoke(channel, input)
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await screen.findByTestId('add-project-machine')
    fireEvent.click(option(MINI))
    await waitFor(() => expect(screen.getByTestId('folder-browser').getAttribute('data-loading')).toBe('no'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose' })))
    await waitFor(() => expect(screen.getByTestId('projects-error').textContent).toBe('Mini is unreachable'))
  })
})
