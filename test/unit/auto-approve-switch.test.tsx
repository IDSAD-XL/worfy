// The Auto-approval switch under the input field (src/renderer/session/composer/AutoApprove.tsx,
// worfy-auto-approve ticket 06) over the real renderer IPC client and a fake preload: only the
// Orchestrator's field has it; it shows the mode main reads for the Project (Off / Shadow / On), a
// click on another position writes it through `autoApproval.set`, and a write that did not go through
// shows a toast and the mode read again. A window on a Linked machine reads and writes nothing and
// says where the mode is set. What main does with a write — app-settings.json — is checked in
// test/contract/auto-approve-setting.test.ts.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'

const readOnly = vi.hoisted(() => ({ hint: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => readOnly.hint,
}))

const ROOT = '/work/demo'
const PROJECT = 'demo-0000000d'
const SESSION = 'orch-session'

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  /** What each autoApproval.read answers, in turn (the last one again once they run out); a string — main threw with it. */
  reads: (AutoApprovalMode | string)[]
  /** What autoApproval.set answers; a string — main threw with it; undefined — the mode it was given. */
  set: AutoApprovalMode | string | undefined
  /** Holds the answer of autoApproval.set until called. */
  hold: (() => void) | null
}

let main: FakeMain

function preload(reads: (AutoApprovalMode | string)[], set?: AutoApprovalMode | string, options: { hold?: boolean } = {}): FakeMain {
  const fake: FakeMain = { calls: [], reads, set, hold: null }
  const answer = (value: unknown) => Promise.resolve(typeof value === 'string' && !['off', 'shadow', 'on'].includes(value) ? ({ ok: false, error: value } as never) : ({ ok: true, value: { mode: value } } as never))
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      switch (channel) {
        case 'autoApproval.read':
          return answer(fake.reads.length > 1 ? fake.reads.shift() : fake.reads[0])
        case 'autoApproval.set': {
          const value = fake.set ?? (input as { mode: AutoApprovalMode }).mode
          if (options.hold !== true) return answer(value)
          return new Promise((resolve) => {
            fake.hold = () => resolve(answer(value) as never)
          })
        }
        default:
          return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
      }
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return fake
}

const view = (sessionId: string): OrchestratorView => ({ projectId: PROJECT, nodeId: 'orch-node', sessionId, state: 'idle', error: null, model: null, costUsd: 0, statusBlock: null, version: 1 })

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** The switch with the window knowing the Orchestrator of the Project at ROOT and its live Session SESSION. */
async function mount(sessionId: string | null = SESSION) {
  const { acceptOrchestratorView } = await import('../../src/renderer/canvas/nodes/orchestrator-view')
  const { acceptProjectsState } = await import('../../src/renderer/projects/useProjects')
  const { default: AutoApprove } = await import('../../src/renderer/session/composer/AutoApprove')
  acceptOrchestratorView(view(SESSION))
  acceptProjectsState({ projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: null }], activeId: PROJECT, revision: 1 })
  render(<AutoApprove sessionId={sessionId} busy={false} text="" setText={() => undefined} />)
  // Whatever main was asked has answered.
  await settle()
}

const group = () => screen.getByRole('group', { name: 'Auto-approval' })
const position = (name: 'Off' | 'Shadow' | 'On') => within(group()).getByRole('button', { name })
const pressed = () => within(group())
  .getAllByRole('button')
  .filter((button) => button.getAttribute('aria-pressed') === 'true')
  .map((button) => button.textContent)
const calls = () => main.calls.filter((call) => call.channel.startsWith('autoApproval.'))
const click = async (name: 'Off' | 'Shadow' | 'On') => {
  await act(async () => {
    fireEvent.click(position(name))
  })
  await settle()
}
const shownToasts = async () => {
  const { toasts } = await import('../../src/renderer/toast/toasts')
  return toasts.getState().toasts.map((toast) => ({ kind: toast.kind, text: toast.text }))
}

beforeEach(() => {
  vi.resetModules()
  readOnly.hint = null
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  window.history.replaceState(null, '', '/')
})

describe('the Auto-approval switch', () => {
  it('stands right of Eco mode in the controls line', async () => {
    const auto = await import('../../src/renderer/session/composer/AutoApprove')
    const eco = await import('../../src/renderer/session/composer/EcoMode')
    expect(auto.order).toBe(17)
    expect(auto.order).toBeGreaterThan(eco.order)
    expect((auto as { line?: string }).line).toBeUndefined()
  })

  it('a Session that is not the Orchestrator has none, and asks main for nothing', async () => {
    main = preload(['on'])
    await mount('another-session')
    expect(screen.queryByRole('group', { name: 'Auto-approval' })).toBeNull()
    expect(calls()).toEqual([])
  })

  it('no live Session: none', async () => {
    main = preload(['on'])
    await mount(null)
    expect(screen.queryByRole('group', { name: 'Auto-approval' })).toBeNull()
    expect(calls()).toEqual([])
  })

  it('three positions, each with its own tooltip; the one main reads is pressed', async () => {
    const { AUTO_APPROVAL_OFF, AUTO_APPROVAL_SHADOW, AUTO_APPROVAL_ON } = await import('../../src/renderer/session/composer/AutoApprove')
    main = preload(['shadow'])
    await mount()
    expect(calls()).toEqual([{ channel: 'autoApproval.read', input: { projectId: PROJECT } }])
    expect(within(group()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Off', 'Shadow', 'On'])
    expect(pressed()).toEqual(['Shadow'])
    expect(position('Off').title).toBe(AUTO_APPROVAL_OFF)
    expect(position('Shadow').title).toBe(AUTO_APPROVAL_SHADOW)
    expect(position('On').title).toBe(AUTO_APPROVAL_ON)
    expect(new Set([AUTO_APPROVAL_OFF, AUTO_APPROVAL_SHADOW, AUTO_APPROVAL_ON]).size).toBe(3)
    expect(group().getAttribute('aria-disabled')).toBeNull()
  })

  it('a click on another position writes it through main and shows it', async () => {
    main = preload(['off'])
    await mount()
    expect(pressed()).toEqual(['Off'])
    await click('Shadow')
    expect(calls().slice(1)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'shadow' } }])
    expect(pressed()).toEqual(['Shadow'])
    await click('On')
    expect(calls().slice(2)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'on' } }])
    expect(pressed()).toEqual(['On'])
    await click('Off')
    expect(calls().slice(3)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'off' } }])
    expect(pressed()).toEqual(['Off'])
    // No read in between: the answer of the write is what the switch shows.
    expect(calls().filter((call) => call.channel === 'autoApproval.read')).toHaveLength(1)
  })

  it('a click on the pressed position writes nothing', async () => {
    main = preload(['on'])
    await mount()
    await click('On')
    expect(calls()).toEqual([{ channel: 'autoApproval.read', input: { projectId: PROJECT } }])
  })

  it('shows the position being written at once, busy until main answers; a second click meanwhile writes nothing', async () => {
    main = preload(['off'], undefined, { hold: true })
    await mount()
    await click('On')
    expect(pressed()).toEqual(['On'])
    expect(group().getAttribute('aria-busy')).toBe('true')
    await click('Shadow')
    expect(calls().filter((call) => call.channel === 'autoApproval.set')).toHaveLength(1)
    await act(async () => {
      main.hold?.()
    })
    await settle()
    expect(group().getAttribute('aria-busy')).toBeNull()
    expect(pressed()).toEqual(['On'])
  })

  it('a write that failed: a toast says so, and the switch shows the mode read again', async () => {
    main = preload(['off', 'off'], 'app-settings.json could not be written')
    await mount()
    await click('On')
    expect(pressed()).toEqual(['Off'])
    expect(calls().map((call) => call.channel)).toEqual(['autoApproval.read', 'autoApproval.set', 'autoApproval.read'])
    expect(await shownToasts()).toEqual([{ kind: 'error', text: 'Auto-approval was not set to On: app-settings.json could not be written' }])
  })

  it('a read that failed: unavailable, saying why; a click writes nothing', async () => {
    main = preload(['demo-0000000d is not a Project of this Machine'])
    await mount()
    expect(group().getAttribute('aria-disabled')).toBe('true')
    expect(group().title).toBe('Auto-approval is not available: demo-0000000d is not a Project of this Machine')
    expect(pressed()).toEqual([])
    await click('On')
    expect(calls().map((call) => call.channel)).toEqual(['autoApproval.read'])
  })

  it('a window on a Linked machine: read-only with where the mode is set, nothing read or written', async () => {
    const { AUTO_APPROVAL_ELSEWHERE } = await import('../../src/renderer/session/composer/AutoApprove')
    expect(AUTO_APPROVAL_ELSEWHERE).toBe('Auto-approval is set in worfy on the Machine of the Project')
    window.history.replaceState(null, '', '/?machine=studio')
    main = preload(['on'])
    await mount()
    expect(group().getAttribute('aria-disabled')).toBe('true')
    expect(group().hasAttribute('data-read-only')).toBe(true)
    expect(group().title).toBe(AUTO_APPROVAL_ELSEWHERE)
    for (const name of ['Off', 'Shadow', 'On'] as const) expect(position(name).title).toBe(AUTO_APPROVAL_ELSEWHERE)
    expect(pressed()).toEqual([])
    for (const name of ['Off', 'Shadow', 'On'] as const) await click(name)
    expect(calls()).toEqual([])
  })

  it('a window on a Linked machine with read-only access: the same text, nothing read or written', async () => {
    const { AUTO_APPROVAL_ELSEWHERE } = await import('../../src/renderer/session/composer/AutoApprove')
    window.history.replaceState(null, '', '/?machine=studio')
    readOnly.hint = 'studio gives this Machine read-only access'
    main = preload(['on'])
    await mount()
    expect(group().getAttribute('aria-disabled')).toBe('true')
    expect(group().title).toBe(AUTO_APPROVAL_ELSEWHERE)
    await click('On')
    expect(calls()).toEqual([])
  })
})
