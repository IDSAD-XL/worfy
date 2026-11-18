// The Autopilot line of a Run a restart of worfy cut off (worfy-continuity ticket 06): `cut off by restart · 14:05` with
// Resume and Discard beside it, one toast that says so, and the Autopilot button inactive until a person decides. On a
// Read only screen of a Linked machine (ADR-0066) the line shows and the buttons do not: only full access decides, as
// it starts Autopilot. What main does with both is checked in test/contract/autopilot-faults-restart.test.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const readOnly = vi.hoisted(() => ({ hint: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => readOnly.hint,
}))

const ROOT = '/work/demo'
const PROJECT = 'demo-000000c7'
const READ_ONLY = 'Read-only: this Project is on another Machine'

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
const TICKETS = [ticket(1, 'work'), ticket(2, 'open')]
const CUT_AT = Date.now() - 2 * 3_600_000

const cutOff = (): AutopilotState => ({
  projectId: PROJECT,
  epic: 'demo',
  status: 'stopped',
  wave: 1,
  backgroundTasks: 0,
  resumesAt: null,
  reason: null,
  message: null,
  resumable: [1],
  stopping: false,
  ticketsInWork: 1,
  harnessBehind: null,
  revision: 2,
  cutOff: { at: CUT_AT, after: 'quit' },
})

describe('the Autopilot line of a Run a restart cut off', () => {
  let calls: { channel: string; input: unknown }[]
  let answers: Record<string, { ok: boolean; value?: unknown; error?: string }>

  beforeEach(() => {
    vi.resetModules()
    readOnly.hint = null
    calls = []
    answers = {}
    const model = { root: ROOT, epics: [EPIC], tickets: TICKETS, error: null, branchErrors: [] } as unknown as WorkflowModel
    let listener = 0
    const bridge = {
      invoke: (channel: string, input: unknown) => {
        calls.push({ channel, input })
        const answer = answers[channel]
        if (answer !== undefined) return Promise.resolve(answer)
        switch (channel) {
          case 'autopilot.state':
            return Promise.resolve({ ok: true, value: cutOff() })
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
      on: () => ++listener,
      off: () => undefined,
    } as unknown as WorfyBridge
    ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  })

  afterEach(() => {
    cleanup()
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  const sent = (channel: string) => calls.filter((call) => call.channel === channel).map((call) => call.input)
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  async function line() {
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    const { toasts } = await import('../../src/renderer/toast/toasts')
    render(<AutopilotAction subject={{ kind: 'epic', projectId: PROJECT, root: ROOT, epic: EPIC, tickets: TICKETS }} />)
    const status = await screen.findByTestId('autopilot-status')
    await vi.waitFor(() => expect(status.textContent).toBe(autopilotStatusLine(cutOff())))
    const shown = () => toasts.getState().toasts.map((toast) => ({ kind: toast.kind, testId: toast.testId }))
    return { status, shown }
  }

  it('says when the restart cut it off, with Resume and Discard beside it, one toast, and Autopilot inactive', async () => {
    const { status, shown } = await line()
    expect(status.textContent).toMatch(/^cut off by restart · \d\d:\d\d$/u)
    expect(screen.getByTestId('autopilot-resume').textContent).toBe('Resume')
    expect(screen.getByTestId('autopilot-discard').textContent).toBe('Discard')
    expect(shown()).toEqual([{ kind: 'info', testId: 'autopilot-cut-off' }])
    const autopilot = screen.getByTestId('action-autopilot')
    expect(autopilot.getAttribute('aria-disabled')).toBe('true')
    expect(autopilot.getAttribute('title')).toBe('A Run of demo cut off by the restart of worfy waits: Resume or Discard it first')
  })

  it('Resume asks main to continue the Run; Discard to end it', async () => {
    await line()
    answers['autopilot.resume'] = { ok: true, value: { ...cutOff(), cutOff: undefined, status: 'running', wave: 1, revision: 3 } }
    fireEvent.click(screen.getByTestId('autopilot-resume'))
    await settle()
    expect(sent('autopilot.resume')).toEqual([{ projectId: PROJECT }])
    expect(sent('autopilot.discard')).toEqual([])
  })

  it('Discard asks main to end the Run; a refusal is an error toast', async () => {
    const { shown } = await line()
    answers['autopilot.discard'] = { ok: false, error: 'the journal cannot be written' }
    fireEvent.click(screen.getByTestId('autopilot-discard'))
    await settle()
    expect(sent('autopilot.discard')).toEqual([{ projectId: PROJECT }])
    expect(shown()).toContainEqual({ kind: 'error', testId: 'autopilot-cut-off' })
  })

  it('Read only on a Linked machine: the line shows, Resume and Discard do not', async () => {
    readOnly.hint = READ_ONLY
    await line()
    expect(screen.queryByTestId('autopilot-resume')).toBeNull()
    expect(screen.queryByTestId('autopilot-discard')).toBeNull()
    expect(screen.getByTestId('action-autopilot').getAttribute('title')).toBe(READ_ONLY)
  })
})
