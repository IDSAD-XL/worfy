// The renderer keeps the Project state with the highest revision: broadcasts and list answers
// can arrive out of order (src/renderer/projects/useProjects.ts).
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LinkState } from '../../src/shared/ipc/link'
import type { LinkedState } from '../../src/shared/ipc/linked'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const state = (revision: number, activeId: string): ProjectsState => ({
  projects: [
    { id: 'a-00000000', name: 'a', path: '/repos/a', branch: 'main' },
    { id: 'b-00000000', name: 'b', path: '/repos/b', branch: 'dev' },
  ],
  activeId,
  revision,
})

let answerList: (state: ProjectsState) => void
let broadcast: (payload: unknown) => void

beforeEach(() => {
  vi.resetModules()
  const bridge: WorfyBridge = {
    // The list call made on mount answers only when the test says so.
    invoke: () => new Promise((resolve) => (answerList = (value) => resolve({ ok: true, value }))),
    on: (_channel, handler) => {
      broadcast = handler
      return 1
    },
    off: () => undefined,
  } as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount() {
  const module = await import('../../src/renderer/projects/useProjects')
  const hook = renderHook(() => module.useProjects())
  return { ...module, hook }
}

describe('useProjects', () => {
  it('keeps a newer state when an older one arrives after it', async () => {
    const { acceptProjectsState, hook } = await mount()
    act(() => acceptProjectsState(state(3, 'b-00000000')))
    act(() => acceptProjectsState(state(2, 'a-00000000')))
    expect(hook.result.current).toStrictEqual(state(3, 'b-00000000'))
  })

  it('ignores a list answer that comes back after a newer broadcast', async () => {
    const { hook } = await mount()
    // Select A, then B: the broadcast for B lands before the list answer that still says A.
    act(() => broadcast(state(5, 'b-00000000')))
    await act(async () => answerList(state(4, 'a-00000000')))
    expect(hook.result.current?.activeId).toBe('b-00000000')
    expect(hook.result.current?.revision).toBe(5)
  })

  it('takes a state with the same revision, which may carry a fresher branch', async () => {
    const { acceptProjectsState, hook } = await mount()
    act(() => acceptProjectsState(state(3, 'b-00000000')))
    const fresher = state(3, 'b-00000000')
    fresher.projects[1] = { ...fresher.projects[1]!, branch: 'feature' }
    act(() => acceptProjectsState(fresher))
    expect(hook.result.current?.projects[1]?.branch).toBe('feature')
  })
})

// ── Projects of Linked machines (worfy-link ticket 09) ─────────────────────────────────────────

const THIS = '11111111-1111-4111-8111-111111111111'
const M = '22222222-2222-4222-8222-222222222222'
const Z = '33333333-3333-4333-8333-333333333333'

const linkState = (linked: { id: string; name: string; state?: 'online' | 'unavailable' }[]): LinkState => ({
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

const linkedState = (machines: { id: string; sharing: 'yes' | 'no' | 'unknown'; epoch?: number; online?: boolean; readOnly?: boolean }[], revision = 1): LinkedState => ({
  revision,
  machines: machines.map(({ id, sharing, epoch = 1, online = true, readOnly = false }) => ({ id, sharing, readOnly, epoch, online })),
})

const listOf = (prefix: string, activeId: string | null = null): ProjectsState => ({
  projects: [
    { id: `${prefix}-one-00000001`, name: `${prefix} one`, path: `/repos/${prefix}/one`, branch: 'main' },
    { id: `${prefix}-two-00000002`, name: `${prefix} two`, path: `/repos/${prefix}/two`, branch: 'dev' },
  ],
  activeId,
  revision: 1,
})

/**
 * This Machine's preload: what reached it, in order. `linked.invoke` answers with the list of the
 * Machine it names — or "access is off" for one in `refusing`, "is unreachable" for one in
 * `unreachable` (read at each call, so a test can change it on the way).
 */
function machinesBridge(options: { link: LinkState; linked: LinkedState; refusing?: string[]; unreachable?: string[]; gateRole?: 'serve' | 'request' | null }) {
  const calls: [string, unknown][] = []
  const listeners = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  /** The gate queue's answers, the same on this Machine and on a Linked one. */
  const gate = (channel: string): unknown => {
    if (options.gateRole === undefined) return { ok: false, error: `unexpected ${channel}` }
    if (channel === 'actions.gateQueue') return { ok: true, value: { sessionId: 'orch-1', text: '/worfy:gate-queue', delivery: 'sent' } }
    return {
      ok: true,
      value: {
        role: options.gateRole,
        label: options.gateRole === null ? null : 'needs-mac-gate',
        waiting: [],
        gh: options.gateRole === null ? { state: 'skipped', reason: 'no cross_machine_gate' } : { state: 'ok' },
      },
    }
  }
  const answer = (channel: string, input: unknown): unknown => {
    switch (channel) {
      case 'projects.list':
        return { ok: true, value: listOf('studio', 'studio-one-00000001') }
      case 'projects.select':
        return { ok: true, value: listOf('studio', (input as { id: string }).id) }
      case 'link.state':
        return { ok: true, value: options.link }
      case 'linked.state':
        return { ok: true, value: options.linked }
      case 'linked.open':
        return { ok: true, value: { projectId: (input as { projectId: string | null }).projectId } }
      case 'gateQueue.get':
      case 'actions.gateQueue':
        return gate(channel)
      case 'linked.invoke': {
        const call = input as { machine: string; channel: string }
        if (options.unreachable?.includes(call.machine)) return { ok: true, value: { ok: false, error: `${call.channel}: Mini is unreachable` } }
        if (options.refusing?.includes(call.machine)) {
          return { ok: true, value: { ok: false, error: 'Linked machines cannot work with the Projects of Z: access is off' } }
        }
        if (call.channel === 'gateQueue.get' || call.channel === 'actions.gateQueue') return { ok: true, value: gate(call.channel) }
        return { ok: true, value: { ok: true, value: listOf(call.machine === M ? 'm' : 'z') } }
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
    on: (channel, handler) => {
      listeners.set(next, { channel, handler })
      return next++
    },
    off: (id) => void listeners.delete(id),
  }
  const fire = (channel: string, payload: unknown): void => {
    for (const listener of [...listeners.values()]) if (listener.channel === channel) listener.handler(payload)
  }
  return { bridge, calls, fire }
}

describe('the Projects of Linked machines', () => {
  let load: Mock<(url: string) => void>
  let reload: Mock<() => void>

  async function loadModules(options: Parameters<typeof machinesBridge>[0], shown: string | null = null) {
    window.history.replaceState(null, '', shown === null ? '/' : `/?machine=${shown}&project=m-one-00000001`)
    const fake = machinesBridge(options)
    ;(globalThis as { worfy?: WorfyBridge }).worfy = fake.bridge
    vi.resetModules()
    const projects = await import('../../src/renderer/projects/useProjects')
    load = vi.fn<(url: string) => void>()
    reload = vi.fn<() => void>()
    projects.navigation.load = load
    projects.navigation.reload = reload
    return { ...fake, projects }
  }

  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
  })

  it('without Linked machines the list is as it was: no groups', async () => {
    const { projects } = await loadModules({ link: linkState([]), linked: linkedState([]) })
    expect(projects.groupProjects({ windowMachine: null, windowState: listOf('studio'), link: linkState([]), linked: linkedState([]), lists: {} })).toBeNull()
    const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
    render(<ProjectsSection />)
    await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(2))
    expect(screen.queryByTestId('machine-group')).toBeNull()
  })

  it('with one Linked machine the Projects are grouped by Machine, this one first, the Linked ones by name', async () => {
    const link = linkState([
      { id: Z, name: 'Zeta' },
      { id: M, name: 'Mini' },
    ])
    const linked = linkedState([
      { id: M, sharing: 'yes' },
      { id: Z, sharing: 'yes' },
    ])
    const { projects, calls } = await loadModules({ link, linked })
    const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
    render(<ProjectsSection />)
    await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(6))
    const groups = screen.getAllByTestId('machine-group')
    expect(groups.map((group) => group.getAttribute('data-machine-id'))).toEqual([null, M, Z])
    expect(groups.map((group) => group.getAttribute('data-state'))).toEqual(['this', 'online', 'online'])
    expect(within(groups[0]!).getByText('Studio')).toBeTruthy()
    expect(within(groups[1]!).getAllByTestId('project-row').map((row) => row.getAttribute('data-project-id'))).toEqual(['m-one-00000001', 'm-two-00000002'])
    expect(within(groups[1]!).getByText('Online')).toBeTruthy()
    // The Linked machines' lists come from them, through this Machine's main.
    expect(calls).toContainEqual(['linked.invoke', { machine: M, channel: 'projects.list', input: undefined }])
    expect(calls).toContainEqual(['linked.invoke', { machine: Z, channel: 'projects.list', input: undefined }])
    // The pure grouping says the same.
    const grouped = projects.groupProjects({ windowMachine: null, windowState: listOf('studio'), link, linked, lists: {} })
    expect(grouped?.map((group) => group.name)).toEqual(['Studio', 'Mini', 'Zeta'])
  })

  it("a Machine that does not share its Projects shows none, with a line that says so; an unavailable one shows its state", async () => {
    const link = linkState([
      { id: M, name: 'Mini', state: 'unavailable' },
      { id: Z, name: 'Zeta' },
    ])
    const { fire } = await loadModules({ link, linked: linkedState([{ id: M, sharing: 'unknown', online: false }, { id: Z, sharing: 'unknown' }]), refusing: [Z] })
    const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
    render(<ProjectsSection />)
    await waitFor(() => expect(screen.getAllByTestId('machine-group')).toHaveLength(3))
    // Main learns "access is off" from the refusal and says so in the linked state.
    act(() => fire('linked.changed', linkedState([{ id: M, sharing: 'unknown', online: false }, { id: Z, sharing: 'no' }], 2)))
    const zeta = screen.getAllByTestId('machine-group')[2]!
    await waitFor(() => expect(within(zeta).getByTestId('machine-not-sharing').textContent).toBe("Zeta doesn't share its Projects"))
    expect(within(zeta).queryAllByTestId('project-row')).toHaveLength(0)
    expect(zeta.getAttribute('data-sharing')).toBe('no')
    const mini = screen.getAllByTestId('machine-group')[1]!
    expect(mini.getAttribute('data-state')).toBe('unavailable')
    expect(within(mini).getByText('Unavailable')).toBeTruthy()
    expect(within(mini).queryAllByTestId('project-row')).toHaveLength(0)
  })

  it('a Machine that shares its Projects read-only is marked "Read only" beside Online; its rows cannot be removed and it cannot be chosen for Add project (worfy-link ticket 25)', async () => {
    const link = linkState([
      { id: M, name: 'Mini' },
      { id: Z, name: 'Zeta' },
    ])
    const { calls } = await loadModules({ link, linked: linkedState([{ id: M, sharing: 'yes', readOnly: true }, { id: Z, sharing: 'yes' }]) })
    const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
    render(<ProjectsSection />)
    await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(6))
    const [, mini, zeta] = screen.getAllByTestId('machine-group')
    const mark = within(mini!).getByTestId('machine-read-only')
    expect(mark.textContent).toBe('Read only')
    expect(mark.getAttribute('title')).toBe('Mini gives this Machine read-only access')
    expect(within(mini!).getByText('Online')).toBeTruthy()
    expect(within(zeta!).queryByTestId('machine-read-only')).toBeNull()

    // The context menu of a row of Mini: "Remove from list" is inactive and removes nothing.
    fireEvent.contextMenu(within(mini!).getAllByTestId('project-row')[0]!)
    const remove = screen.getByRole('menuitem', { name: 'Remove from list' })
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    expect(remove.getAttribute('title')).toBe('Mini gives this Machine read-only access')
    fireEvent.click(remove)
    expect(calls.filter(([channel, input]) => channel === 'linked.invoke' && (input as { channel: string }).channel === 'projects.remove')).toEqual([])
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' })

    // A row of Zeta, with Full access: as before.
    fireEvent.contextMenu(within(zeta!).getAllByTestId('project-row')[0]!)
    expect(screen.getByRole('menuitem', { name: 'Remove from list' }).getAttribute('aria-disabled')).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' })

    // Add project: Mini cannot be chosen and says why; Zeta can.
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    const options = within(await screen.findByTestId('add-project-machine')).getAllByTestId('add-project-machine-option')
    const option = (id: string) => options.find((candidate) => candidate.getAttribute('data-machine-id') === id)!
    expect((option(M) as HTMLButtonElement).disabled).toBe(true)
    expect(within(option(M)).getByTestId('add-project-machine-reason').textContent).toBe('Mini gives this Machine read-only access')
    expect((option(Z) as HTMLButtonElement).disabled).toBe(false)
  })

  it("choosing a Project of M does not call projects.select: the window loads again on M with that Project", async () => {
    const { calls } = await loadModules({ link: linkState([{ id: M, name: 'Mini' }]), linked: linkedState([{ id: M, sharing: 'yes' }]) })
    const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
    render(<ProjectsSection />)
    await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(4))
    const row = screen.getAllByTestId('project-row').find((candidate) => candidate.getAttribute('data-project-id') === 'm-two-00000002')!
    fireEvent.click(within(row).getByRole('button'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    const url = new URL(load.mock.calls[0]![0] as string)
    expect(url.searchParams.get('machine')).toBe(M)
    expect(url.searchParams.get('project')).toBe('m-two-00000002')
    expect(calls.filter(([channel]) => channel === 'projects.select')).toEqual([])
  })

  it("in a window on M: the list is M's, the active Project the window's own; another Project of M opens without a reload, one of this Machine with one", async () => {
    const { projects, calls } = await loadModules({ link: linkState([{ id: M, name: 'Mini' }]), linked: linkedState([{ id: M, sharing: 'yes' }]) }, M)
    const hook = renderHook(() => projects.useProjects())
    await waitFor(() => expect(hook.result.current?.projects[0]?.id).toBe('m-one-00000001'))
    // M's list says nothing is active; the window shows what its address names.
    expect(hook.result.current?.activeId).toBe('m-one-00000001')
    expect(calls).toContainEqual(['linked.open', { machine: M, projectId: 'm-one-00000001' }])

    await act(async () => expect(await projects.openProject(M, 'm-two-00000002')).toBeUndefined())
    expect(hook.result.current?.activeId).toBe('m-two-00000002')
    expect(new URL(window.location.href).searchParams.get('project')).toBe('m-two-00000002')
    expect(calls).toContainEqual(['linked.open', { machine: M, projectId: 'm-two-00000002' }])
    expect(load).not.toHaveBeenCalled()
    expect(calls.filter(([channel]) => channel === 'projects.select')).toEqual([])

    // A Project of this Machine: selected here, then the window comes back to this Machine.
    await act(async () => expect(await projects.openProject(null, 'studio-two-00000002')).toBeUndefined())
    expect(calls).toContainEqual(['projects.select', { id: 'studio-two-00000002' }])
    const url = new URL(load.mock.calls[0]![0] as string)
    expect(url.searchParams.has('machine')).toBe(false)
    expect(url.searchParams.has('project')).toBe(false)
  })

  it('the Sessions section words an unreachable Machine without the channel name, and leaves other reasons whole', async () => {
    const { readableReason } = await import('../../src/renderer/ipc')
    expect(readableReason('claudeHome.live: Mini (dev) is unreachable')).toBe('Mini (dev) is unreachable')
    expect(readableReason('claudeHome.live: Mini did not answer in time')).toBe('Mini did not answer in time')
    expect(readableReason('claudeHome.live failed: EACCES')).toBe('claudeHome.live failed: EACCES')
  })

  it("the palette's Switch to project in a window on M opens M's Project in this window, without projects.select", async () => {
    const { calls } = await loadModules({ link: linkState([{ id: M, name: 'Mini' }]), linked: linkedState([{ id: M, sharing: 'yes' }]) }, M)
    const { buildCommands } = await import('../../src/renderer/palette/commands')
    const projects = listOf('m', 'm-one-00000001').projects
    const commands = buildCommands({ project: projects[0], projects, view: 'canvas', model: undefined, layoutNodes: [], history: [], adrs: [], tagFilter: null, createItems: [] })
    const command = commands.find((candidate) => candidate.id === 'project:m-two-00000002')
    expect(await command?.run()).toBeUndefined()
    expect(calls.filter(([channel]) => channel === 'projects.select')).toEqual([])
    expect(calls).toContainEqual(['linked.open', { machine: M, projectId: 'm-two-00000002' }])
    expect(new URL(window.location.href).searchParams.get('project')).toBe('m-two-00000002')
    expect(load).not.toHaveBeenCalled()
  })

  it('a window on M loads again when M comes back with another epoch, and not before', async () => {
    const { projects, fire } = await loadModules({ link: linkState([{ id: M, name: 'Mini' }]), linked: linkedState([{ id: M, sharing: 'yes', epoch: 4 }]) }, M)
    const hook = renderHook(() => projects.useLinked())
    await waitFor(() => expect(hook.result.current?.machines[0]?.epoch).toBe(4))
    await act(async () => fire('linked.changed', linkedState([{ id: M, sharing: 'yes', epoch: 4 }], 2)))
    // Gone: no reload while it cannot answer.
    await act(async () => fire('linked.changed', linkedState([{ id: M, sharing: 'yes', epoch: 4, online: false }], 3)))
    // Sharing off: no reload either.
    await act(async () => fire('linked.changed', linkedState([{ id: M, sharing: 'no', epoch: 5 }], 4)))
    expect(reload).not.toHaveBeenCalled()
    await act(async () => fire('linked.changed', linkedState([{ id: M, sharing: 'yes', epoch: 6 }], 5)))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('a window on M does not load again on a new epoch M cannot answer on: M quit, and the second connection that took over closes too', async () => {
    const options: Parameters<typeof machinesBridge>[0] = { link: linkState([{ id: M, name: 'Mini' }]), linked: linkedState([{ id: M, sharing: 'yes', epoch: 4 }]) }
    const { projects, fire, calls } = await loadModules(options, M)
    const hook = renderHook(() => projects.useLinked())
    await waitFor(() => expect(hook.result.current?.machines[0]?.epoch).toBe(4))
    // Both sides dial each other: M quits, the first connection closes and the second one takes
    // over — a new epoch, still online — and is already gone when the window asks over it.
    options.unreachable = [M]
    const asked = calls.length
    await act(async () => fire('linked.changed', linkedState([{ id: M, sharing: 'yes', epoch: 5 }], 2)))
    // A reload now would come up with no Project and no Canvas; the window keeps its Canvas.
    expect(reload).not.toHaveBeenCalled()
    // It asked M over the new epoch, and the answer said M is unreachable.
    await waitFor(() => expect(calls.slice(asked)).toContainEqual(['linked.invoke', { machine: M, channel: 'projects.list', input: undefined }]))
    await act(async () => fire('linked.changed', linkedState([{ id: M, sharing: 'yes', epoch: 5, online: false }], 3)))
    expect(reload).not.toHaveBeenCalled()
    // M is back: another epoch it answers on loads the window again, once.
    options.unreachable = []
    await act(async () => fire('linked.changed', linkedState([{ id: M, sharing: 'yes', epoch: 6 }], 4)))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })
  describe('"Process gate queue" in the Project menu (worfy-windows ticket 17)', () => {
    const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent)

    it('serve: between Project settings and Remove from list; a click sends actions.gateQueue of the row\'s Project and says so', async () => {
      const { calls } = await loadModules({ link: linkState([]), linked: linkedState([]), gateRole: 'serve' })
      const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
      render(<ProjectsSection />)
      await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(2))
      fireEvent.contextMenu(screen.getAllByTestId('project-row')[1]!)
      // Read on the row's Machine when the menu opens.
      await waitFor(() => expect(items()).toEqual(['Project settings…', 'Process gate queue', 'Remove from list']))
      expect(calls).toContainEqual(['gateQueue.get', { projectId: 'studio-two-00000002' }])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Process gate queue' }))
      await waitFor(() => expect(screen.getByTestId('projects-notice').textContent).toBe('Sent to the Orchestrator of studio two: /worfy:gate-queue'))
      expect(calls.filter(([channel]) => channel === 'actions.gateQueue')).toEqual([['actions.gateQueue', { projectId: 'studio-two-00000002' }]])
      expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull()
    })

    it('a row of a Linked machine: the role is read on that Machine, and the click runs the gate queue there', async () => {
      const { calls } = await loadModules({ link: linkState([{ id: M, name: 'Mini' }]), linked: linkedState([{ id: M, sharing: 'yes' }]), gateRole: 'serve' })
      const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
      render(<ProjectsSection />)
      await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(4))
      const row = within(screen.getAllByTestId('machine-group')[1]!).getAllByTestId('project-row')[1]!
      expect(row.getAttribute('data-project-id')).toBe('m-two-00000002')
      fireEvent.contextMenu(row)
      await waitFor(() => expect(items()).toContain('Process gate queue'))
      expect(calls).toContainEqual(['linked.invoke', { machine: M, channel: 'gateQueue.get', input: { projectId: 'm-two-00000002' } }])
      // Not on this Machine: it has no Project of that id.
      expect(calls.filter(([channel, input]) => channel === 'gateQueue.get' && (input as { projectId: string }).projectId === 'm-two-00000002')).toEqual([])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Process gate queue' }))
      await waitFor(() => expect(calls).toContainEqual(['linked.invoke', { machine: M, channel: 'actions.gateQueue', input: { projectId: 'm-two-00000002' } }]))
      expect(calls.filter(([channel]) => channel === 'actions.gateQueue')).toEqual([])
    })

    it.each([
      ['request', 'request' as const],
      ['no cross_machine_gate', null],
    ])('%s: no item', async (_name, gateRole) => {
      const { calls } = await loadModules({ link: linkState([]), linked: linkedState([]), gateRole })
      const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
      render(<ProjectsSection />)
      await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(2))
      fireEvent.contextMenu(screen.getAllByTestId('project-row')[0]!)
      await waitFor(() => expect(calls).toContainEqual(['gateQueue.get', { projectId: 'studio-one-00000001' }]))
      await act(async () => undefined)
      expect(items()).toEqual(['Project settings…', 'Remove from list'])
    })
  })
})
