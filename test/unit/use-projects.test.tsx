// The renderer keeps the Project state with the highest revision: broadcasts and list answers
// can arrive out of order (src/renderer/projects/useProjects.ts).
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
