// The sidebar's Epics section under the Project switcher (worfy-polish ticket 94, src/renderer/shell/sidebar/EpicsSection.tsx,
// sidebar-scope.ts): «All Projects» shows the open Project's Epics first, then those of every other Project with Epics,
// each under its name; one Project shows the open one alone. A click on an Epic of another Project opens that Project
// first. The Projects, their workflow models and the opening are stand-ins.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const HOUR = 60 * 60_000
const ORCHARD = { id: 'orchard-0000000a', name: 'orchard', path: '/repos/orchard', branch: 'main' }
const HARBOR = { id: 'harbor-0000000b', name: 'harbor', path: '/repos/harbor', branch: 'main' }
const QUIET = { id: 'quiet-0000000c', name: 'quiet', path: '/repos/quiet', branch: 'main' }

const state = vi.hoisted(() => ({
  opened: [] as { machine: string | null; id: string }[],
  refusal: undefined as string | undefined,
  focused: [] as { projectId: string; epic: string }[],
}))

vi.mock('../../src/renderer/projects/useProjects', () => {
  const list = { projects: [ORCHARD, HARBOR, QUIET], activeId: ORCHARD.id, revision: 1 }
  return {
    useProjects: () => list,
    activeProject: (current: typeof list | undefined) => current?.projects.find((project) => project.id === current.activeId),
    openProject: (machine: string | null, id: string) => {
      state.opened.push({ machine, id })
      return Promise.resolve(state.refusal)
    },
  }
})
vi.mock('../../src/renderer/workflow/useWorkflow', () => ({ useWorkflow: (root: string) => ({ model: models[root], error: undefined }) }))
vi.mock('../../src/renderer/canvas/sources/epics', () => ({ focusEpic: (projectId: string, epic: string) => state.focused.push({ projectId, epic }) }))

const at = (ago: number): string => new Date(Date.now() - ago).toISOString()
const epic = (name: string): Epic => ({ epic: name, hasSpec: true, hasMap: false, title: null, specAt: at(HOUR) })
const ticket = (name: string): Ticket =>
  ({ epic: name, num: 1, slug: 't1', title: 'T1', statusRaw: 'done', state: 'done', statusAt: at(HOUR), blockedRaw: null, blockedNums: [], blockedParsed: true, files: [], filesListed: false, fromBranch: null }) as Ticket
const model = (root: string, names: string[]): WorkflowModel => ({ root, epics: names.map(epic), tickets: names.map(ticket), error: null, branchErrors: [] })

const models: Record<string, WorkflowModel> = {
  [ORCHARD.path]: model(ORCHARD.path, ['orchard-billing']),
  [HARBOR.path]: model(HARBOR.path, ['harbor-docks']),
  [QUIET.path]: model(QUIET.path, []),
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  state.opened = []
  state.refusal = undefined
  state.focused = []
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel) => Promise.resolve({ ok: false, error: `no ${channel} here` }),
    on: () => 1,
    off: () => undefined,
  }
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function draw() {
  const { default: EpicsSection } = await import('../../src/renderer/shell/sidebar/EpicsSection')
  render(<EpicsSection />)
  await act(async () => undefined)
}

const groups = () => screen.getAllByTestId('sidebar-epics-project').map((group) => [group.getAttribute('data-project'), within(group).getAllByTestId('sidebar-epic').map((row) => row.getAttribute('data-epic'))])

describe('the Epics section under the Project switcher', () => {
  it('«All Projects»: the open Project first, then every other one with Epics, each under its name; one without Epics shows nothing', async () => {
    await draw()
    expect(groups()).toEqual([
      [ORCHARD.id, ['orchard-billing']],
      [HARBOR.id, ['harbor-docks']],
    ])
    expect(screen.getByText('orchard')).toBeTruthy()
    expect(screen.getByText('harbor')).toBeTruthy()
    expect(screen.queryByText('quiet')).toBeNull()
    expect(screen.getByTestId('sidebar-scope-label').textContent).toBe('All Projects')
  })

  it('one Project: the open one alone, without its name above the list', async () => {
    localStorage.setItem('worfy.sidebar.scope', 'project')
    await draw()
    expect(groups()).toEqual([[ORCHARD.id, ['orchard-billing']]])
    expect(within(screen.getByTestId('sidebar-epics-project')).queryByText('orchard')).toBeNull()
    expect(screen.getByTestId('sidebar-scope-label').textContent).toBe('orchard')
  })

  it('a click on an Epic of the open Project centres it at once', async () => {
    await draw()
    fireEvent.click(screen.getByText('orchard-billing'))
    expect(state.opened).toEqual([])
    expect(state.focused).toEqual([{ projectId: ORCHARD.id, epic: 'orchard-billing' }])
  })

  it('a click on an Epic of another Project opens that Project, then centres the Epic on its Canvas', async () => {
    await draw()
    await act(async () => {
      fireEvent.click(screen.getByText('harbor-docks'))
    })
    expect(state.opened).toEqual([{ machine: null, id: HARBOR.id }])
    expect(state.focused).toEqual([{ projectId: HARBOR.id, epic: 'harbor-docks' }])
  })

  it('says why the other Project could not be opened, and centres nothing', async () => {
    state.refusal = 'the folder is gone'
    await draw()
    await act(async () => {
      fireEvent.click(screen.getByText('harbor-docks'))
    })
    expect(screen.getByRole('alert').textContent).toBe('harbor could not be opened: the folder is gone')
    expect(state.focused).toEqual([])
  })
})
