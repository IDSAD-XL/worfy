// The sidebar's Epics section in order, with the time since each Epic's last work and the folded «Older» group
// (worfy-polish ticket 98, src/renderer/shell/sidebar/EpicsSection.tsx). The workflow model and the active Project are
// stand-ins; the app settings go through the real renderer client over a fake preload, so the threshold and the fold
// are read and written as in the app. Every time is built from Date.now(), never a fixed date.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const PROJECT = { id: 'shop-0a1b2c3d', name: 'shop', path: '/repos/shop', branch: 'main' }
const FOLD_KEY = 'EpicsOlder-0a1b2c3d'

const state = vi.hoisted(() => ({ model: undefined as WorkflowModel | undefined, project: undefined as unknown }))

vi.mock('../../src/renderer/projects/useProjects', () => ({ useProjects: () => null, activeProject: () => state.project }))
vi.mock('../../src/renderer/workflow/useWorkflow', () => ({ useWorkflow: () => ({ model: state.model, error: undefined }) }))
vi.mock('../../src/renderer/canvas/sources/epics', () => ({ focusEpic: vi.fn() }))

const at = (ago: number): string => new Date(Date.now() - ago).toISOString()
const epic = (name: string, specAgo: number): Epic => ({ epic: name, hasSpec: true, hasMap: false, title: null, specAt: at(specAgo) })
const ticket = (name: string, num: number, state: Ticket['state'], ago: number | null): Ticket =>
  ({ epic: name, num, slug: `t${num}`, title: `T${num}`, statusRaw: state, state, statusAt: ago === null ? null : at(ago), blockedRaw: null, blockedNums: [], blockedParsed: true, files: [], filesListed: false, fromBranch: null }) as Ticket

/** The fixture of the e2e spec: an Epic in work since long ago, a fresh one, a closed and an open one 8 days old. */
function fixture(): WorkflowModel {
  return {
    root: PROJECT.path,
    epics: [epic('closed-old', 40 * DAY), epic('fresh', 30 * DAY), epic('in-work', 40 * DAY), epic('open-old', 40 * DAY)],
    tickets: [
      ticket('closed-old', 1, 'done', 8 * DAY),
      ticket('fresh', 1, 'done', 2 * HOUR),
      ticket('fresh', 2, 'open', null),
      ticket('in-work', 1, 'work', 20 * DAY),
      ticket('open-old', 1, 'done', 8 * DAY + HOUR),
      ticket('open-old', 2, 'open', null),
    ],
    error: null,
    branchErrors: [],
  }
}

const settings = (extra: Partial<AppSettings> = {}): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 1,
  ...extra,
})

/** Every `appSettings.set`, oldest first; each is answered with the settings it asks for. */
let sets: unknown[] = []

function preload(current: AppSettings): void {
  let value = current
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value } as never)
      if (channel === 'appSettings.set') {
        sets.push(input)
        const patch = input as { sidebar?: { collapsed?: Record<string, boolean> } }
        value = { ...value, sidebar: { ...value.sidebar, collapsed: { ...value.sidebar.collapsed, ...patch.sidebar?.collapsed } }, revision: value.revision + 1 }
        return Promise.resolve({ ok: true, value } as IpcResult<unknown> as never)
      }
      return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

beforeEach(() => {
  // useAppSettings keeps its state in a module: every test starts with a fresh one.
  vi.resetModules()
  sets = []
  state.model = fixture()
  state.project = PROJECT
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(current: AppSettings): Promise<void> {
  preload(current)
  const { default: EpicsSection } = await import('../../src/renderer/shell/sidebar/EpicsSection')
  render(<EpicsSection />)
  // The settings arrive from main after the first render.
  await act(async () => undefined)
}

const rows = (): (string | null)[] => screen.queryAllByTestId('sidebar-epic').map((row) => row.getAttribute('data-epic'))
const ageOf = (name: string): string | null | undefined =>
  screen.queryAllByTestId('sidebar-epic').find((row) => row.getAttribute('data-epic') === name)?.querySelector('[data-testid="sidebar-epic-age"]')?.textContent

describe('the Epics section, by last work', () => {
  it('lists the Epic in work first, then by last work; the 8-day-old Epics, closed and open, wait folded in «Older · 2»', async () => {
    await mount(settings())
    await waitFor(() => expect(rows()).toEqual(['in-work', 'fresh']))
    expect(ageOf('in-work')).toBe('20d')
    expect(ageOf('fresh')).toBe('2h')
    const older = screen.getByTestId('sidebar-epics-older')
    expect(older.textContent).toBe('Older · 2')
    expect(older.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('sidebar-epics-older-list').hidden).toBe(true)
  })

  it('opens «Older» with one click and keeps that for this Project in sidebar.collapsed', async () => {
    await mount(settings())
    fireEvent.click(await screen.findByTestId('sidebar-epics-older'))
    await waitFor(() => expect(rows()).toEqual(['in-work', 'fresh', 'closed-old', 'open-old']))
    expect(screen.getByTestId('sidebar-epics-older').getAttribute('aria-expanded')).toBe('true')
    expect(ageOf('closed-old')).toBe('8d')
    expect(sets).toEqual([{ sidebar: { collapsed: { [FOLD_KEY]: false } } }])

    fireEvent.click(screen.getByTestId('sidebar-epics-older'))
    await waitFor(() => expect(rows()).toEqual(['in-work', 'fresh']))
    expect(sets.at(-1)).toEqual({ sidebar: { collapsed: { [FOLD_KEY]: true } } })
  })

  it('opens «Older» unfolded when this Project left it so; the fold of another Project does not count', async () => {
    await mount(settings({ sidebar: { collapsed: { [FOLD_KEY]: false }, visible: { normal: true, focus: true } } }))
    await waitFor(() => expect(rows()).toEqual(['in-work', 'fresh', 'closed-old', 'open-old']))
    cleanup()

    state.project = { ...PROJECT, id: 'blog-ffffffff' }
    await mount(settings({ sidebar: { collapsed: { [FOLD_KEY]: false }, visible: { normal: true, focus: true } } }))
    await waitFor(() => expect(rows()).toEqual(['in-work', 'fresh']))
  })

  it('shows every Epic in the list, with no «Older», when the threshold is Never', async () => {
    await mount(settings({ epicsOlderAfter: 'never' }))
    await waitFor(() => expect(rows()).toEqual(['in-work', 'fresh', 'closed-old', 'open-old']))
    expect(screen.queryByTestId('sidebar-epics-older')).toBeNull()
  })

  it('follows the threshold: at 30 days the 8-day-old Epics stay in the list', async () => {
    await mount(settings({ epicsOlderAfter: '30d' }))
    await waitFor(() => expect(rows()).toEqual(['in-work', 'fresh', 'closed-old', 'open-old']))
    expect(screen.queryByTestId('sidebar-epics-older')).toBeNull()
  })
})
