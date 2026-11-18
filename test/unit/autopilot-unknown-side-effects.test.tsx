// Unknown side effects in the renderer (worfy-continuity ticket 07, src/renderer/autopilot/unknown-side-effects.ts):
// the frame of an Epic shows one action toast per mark of main's Autopilot state, "Checked, include" asks main to give
// the Ticket back (`autopilot.include`), and the marks of the store follow main's newest state — gone once the Ticket
// is included, and once a state of the Project no longer names them. What main does is checked in
// test/contract/autopilot-faults-restart.test.ts.
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const ROOT = '/work/demo'
const PROJECT = 'demo-000000d7'
const MERGE = { epic: 'demo', ticket: 1, actions: ['gh pr merge 41'] }

const ticket = (num: number, state: Ticket['state']): Ticket => ({
  epic: 'demo',
  num,
  slug: `ticket-${num}`,
  title: `Ticket ${num}`,
  statusRaw: state,
  state,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [`src/f${num}.ts`],
  filesListed: true,
  fromBranch: null,
})
const EPIC: Epic = { epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }
const TICKETS = [ticket(1, 'work'), ticket(2, 'work')]

const stopped = (over: Partial<AutopilotState> = {}): AutopilotState => ({
  projectId: PROJECT,
  epic: 'demo',
  status: 'stopped',
  wave: 2,
  backgroundTasks: 0,
  resumesAt: null,
  reason: 'user-force-stop',
  message: null,
  resumable: [2],
  stopping: false,
  ticketsInWork: 0,
  harnessBehind: null,
  run: '2026-11-18T09-00-00-000Z-a1b2c3',
  unknownSideEffects: [MERGE],
  revision: 2,
  ...over,
})

describe('the toast of Unknown side effects and "Checked, include"', () => {
  let calls: { channel: string; input: unknown }[]
  let answers: Record<string, { ok: boolean; value?: unknown; error?: string }>

  beforeEach(() => {
    vi.resetModules()
    calls = []
    answers = {}
    const model = { root: ROOT, epics: [EPIC], tickets: TICKETS, error: null, branchErrors: [] } as unknown as WorkflowModel
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string, input: unknown) => {
        calls.push({ channel, input })
        const answer = answers[channel]
        if (answer !== undefined) return Promise.resolve(answer)
        switch (channel) {
          case 'autopilot.state':
            return Promise.resolve({ ok: true, value: stopped() })
          case 'workflow.open':
            return Promise.resolve({ ok: true, value: model })
          case 'projects.list':
            return Promise.resolve({ ok: true, value: { projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 } })
          case 'projects.settings.get':
            return Promise.resolve({ ok: true, value: { actionTemplates: { ...DEFAULT_ACTION_TEMPLATES } } })
          case 'appSettings.get':
            return Promise.resolve({ ok: true, value: { ...defaultAppSettings(), revision: 1 } })
          default:
            return Promise.resolve({ ok: false, error: `no ${channel} here` })
        }
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
  })

  afterEach(() => {
    cleanup()
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  async function frame() {
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    const { toasts, pressToastAction } = await import('../../src/renderer/toast/toasts')
    const marks = await import('../../src/renderer/autopilot/unknown-side-effects')
    const view = render(<AutopilotAction subject={{ kind: 'epic', projectId: PROJECT, root: ROOT, epic: EPIC, tickets: TICKETS }} />)
    const mine = () => toasts.getState().toasts.filter((toast) => toast.testId === marks.SIDE_EFFECTS_TOAST)
    await vi.waitFor(() => expect(mine()).toHaveLength(1))
    return { view, mine, pressToastAction, marks, AutopilotAction }
  }

  it('one action toast per mark: the calls, the Ticket and "Checked, include"; drawn again, the frame adds none', async () => {
    const { view, mine, AutopilotAction } = await frame()
    expect(mine()[0]).toMatchObject({ kind: 'action', text: 'Unknown side effects: `gh pr merge 41` may or may not have run (Ticket 01 of demo)', actions: [{ label: 'Checked, include' }] })
    view.rerender(<AutopilotAction subject={{ kind: 'epic', projectId: PROJECT, root: ROOT, epic: EPIC, tickets: [...TICKETS] }} />)
    expect(mine()).toHaveLength(1)
    expect(mine()[0]!.version).toBe(1)
  })

  it('"Checked, include" asks main for the Ticket, and the mark leaves the store with main\'s answer', async () => {
    const { mine, pressToastAction, marks } = await frame()
    const store = renderHook(() => marks.useUnknownSideEffects(PROJECT, 'demo', 1))
    expect(store.result.current).toEqual(['gh pr merge 41'])
    answers['autopilot.include'] = { ok: true, value: stopped({ unknownSideEffects: undefined, resumable: [1, 2], revision: 3 }) }
    await act(async () => {
      pressToastAction(mine()[0]!.id, 0)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(calls.filter((call) => call.channel === 'autopilot.include').map((call) => call.input)).toEqual([{ projectId: PROJECT, epic: 'demo', ticket: 1 }])
    expect(store.result.current).toBeNull()
    expect(mine()).toHaveLength(0)
  })

  it('a refusal of main is an error toast, and the mark stays', async () => {
    const { mine, pressToastAction, marks } = await frame()
    answers['autopilot.include'] = { ok: false, error: 'the journal cannot be written' }
    await act(async () => {
      pressToastAction(mine()[0]!.id, 0)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mine()).toMatchObject([{ kind: 'error' }])
    expect(renderHook(() => marks.useUnknownSideEffects(PROJECT, 'demo', 1)).result.current).toEqual(['gh pr merge 41'])
  })
})

describe('the store of the marks', () => {
  beforeEach(() => vi.resetModules())

  it('follows main\'s newest state: a mark goes when the Ticket is included, and all of them when a state names none', async () => {
    const marks = await import('../../src/renderer/autopilot/unknown-side-effects')
    const two = { projectId: PROJECT, unknownSideEffects: [MERGE, { epic: 'demo', ticket: 2, actions: ['git push origin demo/02'] }] }
    marks.takeMarks(two)
    const hook = renderHook(() => marks.useSideEffectsMarks(PROJECT))
    expect(hook.result.current).toHaveLength(2)
    // Ticket 01 included.
    act(() => marks.takeMarks({ projectId: PROJECT, unknownSideEffects: [two.unknownSideEffects[1]!] }))
    expect(hook.result.current).toEqual([two.unknownSideEffects[1]])
    // A state without marks — the Run ended on another Epic, or a new Run took the Ticket along: none left.
    act(() => marks.takeMarks({ projectId: PROJECT }))
    expect(hook.result.current).toEqual([])
    // Another Project's marks are its own.
    act(() => marks.takeMarks({ projectId: 'other-00000001', unknownSideEffects: [MERGE] }))
    expect(hook.result.current).toEqual([])
    expect(marks.sideEffectsTitle(['gh pr merge 41', 'git push origin main'])).toBe('gh pr merge 41; git push origin main may or may not have run')
  })
})
