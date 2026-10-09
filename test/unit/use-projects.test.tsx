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
  linked: linked.map(({ id, name, state = 'online' }) => ({ id, name, state, certificateChanged: false })),
  discovered: [],
  projectsAccess: false,
  keepAwake: true,
})

const linkedState = (machines: { id: string; sharing: 'yes' | 'no' | 'unknown'; epoch?: number; online?: boolean }[], revision = 1): LinkedState => ({
  revision,
  machines: machines.map(({ id, sharing, epoch = 1, online = true }) => ({ id, sharing, epoch, online })),
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
 * Machine it names — or "access is off" for one in `refusing`.
 */
function machinesBridge(options: { link: LinkState; linked: LinkedState; refusing?: string[] }) {
  const calls: [string, unknown][] = []
  const listeners = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
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
      case 'linked.invoke': {
        const call = input as { machine: string; channel: string }
        if (options.refusing?.includes(call.machine)) {
          return { ok: true, value: { ok: false, error: 'Linked machines cannot work with the Projects of Z: access is off' } }
        }
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
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
