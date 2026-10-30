// The Eco mode switch under the input field (src/renderer/session/composer/EcoMode.tsx,
// worfy-throughput ticket 60) over the real renderer IPC client and a fake preload: only the
// Orchestrator's field has it; it shows `workflow.agents` of the Profile as main reads it (eco — on),
// a click writes the other value with the fingerprint it read, and a write that did not go through
// shows a toast and the Profile as it is now. A window on another Machine, read-only or not, reads and
// writes nothing. What main does with a click — bin/profile-set — is checked in
// test/contract/eco-mode.test.ts.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { EcoModeSetResult, EcoModeState } from '../../src/shared/ipc/eco-mode'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'

const readOnly = vi.hoisted(() => ({ hint: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => readOnly.hint,
}))

const ROOT = '/work/demo'
const PROJECT = 'demo-0000000d'
const SESSION = 'orch-session'
const FP_OFF = `sha256:${'1'.repeat(64)}`
const FP_ON = `sha256:${'2'.repeat(64)}`

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  /** What each ecoMode.read answers, in turn (the last one again once they run out); a string — main threw with it. */
  reads: (EcoModeState | string)[]
  /** What ecoMode.set answers; a string — main threw with it. */
  set: EcoModeSetResult | string
}

let main: FakeMain

function preload(reads: (EcoModeState | string)[], set: EcoModeSetResult | string = { status: 'saved', on: true, fingerprint: FP_ON, warning: null }): FakeMain {
  const fake: FakeMain = { calls: [], reads, set }
  const answer = (value: unknown) => Promise.resolve(typeof value === 'string' ? ({ ok: false, error: value } as never) : ({ ok: true, value } as never))
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      switch (channel) {
        case 'ecoMode.read':
          return answer(fake.reads.length > 1 ? fake.reads.shift() : fake.reads[0])
        case 'ecoMode.set':
          return answer(fake.set)
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

/** The switch with the window knowing the Orchestrator of the Project at ROOT and its live Session SESSION. */
async function mount(sessionId: string | null = SESSION) {
  const { acceptOrchestratorView } = await import('../../src/renderer/canvas/nodes/orchestrator-view')
  const { acceptProjectsState } = await import('../../src/renderer/projects/useProjects')
  const { default: EcoMode } = await import('../../src/renderer/session/composer/EcoMode')
  acceptOrchestratorView(view(SESSION))
  acceptProjectsState({ projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: null }], activeId: PROJECT, revision: 1 })
  render(<EcoMode sessionId={sessionId} busy={false} text="" setText={() => undefined} />)
  // Whatever main was asked has answered.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const eco = () => screen.getByRole('switch', { name: 'Eco mode' })
const icon = () => eco().querySelector('[data-testid="eco-mode-icon"]')?.getAttribute('data-icon')
const ecoCalls = () => main.calls.filter((call) => call.channel.startsWith('ecoMode.'))
const shownToasts = async () => {
  const { toasts } = await import('../../src/renderer/toast/toasts')
  return toasts.getState().toasts.map((toast) => ({ kind: toast.kind, text: toast.text }))
}
const click = async () => {
  await act(async () => {
    fireEvent.click(eco())
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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

describe('the Eco mode switch', () => {
  it('a Session that is not the Orchestrator has none, and asks main for nothing', async () => {
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }])
    await mount('another-session')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(ecoCalls()).toEqual([])
  })

  it('no live Session: none', async () => {
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }])
    await mount(null)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('the Orchestrator: off without workflow.agents eco; a click writes on with the fingerprint read, and shows on', async () => {
    const { ECO_MODE_TITLE } = await import('../../src/renderer/session/composer/EcoMode')
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }])
    await mount()
    expect(eco().getAttribute('aria-checked')).toBe('false')
    expect(icon()).toBe('bolt')
    expect(eco().textContent).toBe('Eco mode')
    expect(eco().title).toBe(ECO_MODE_TITLE)
    expect(eco().title).toMatch(/applies to the next Ticket/u)
    expect(eco().getAttribute('aria-disabled')).toBeNull()
    await click()
    expect(ecoCalls()).toEqual([
      { channel: 'ecoMode.read', input: { root: ROOT } },
      { channel: 'ecoMode.set', input: { root: ROOT, on: true, expected: FP_OFF } },
    ])
    expect(eco().getAttribute('aria-checked')).toBe('true')
    expect(icon()).toBe('leaf')
    expect(await shownToasts()).toEqual([])
  })

  it('on: a click writes off with the fingerprint of the last write, and no read in between', async () => {
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }])
    await mount()
    await click()
    main.set = { status: 'saved', on: false, fingerprint: FP_OFF, warning: null }
    await click()
    expect(ecoCalls().map((call) => call.input)).toEqual([{ root: ROOT }, { root: ROOT, on: true, expected: FP_OFF }, { root: ROOT, on: false, expected: FP_ON }])
    expect(eco().getAttribute('aria-checked')).toBe('false')
  })

  it('shows on what main reads as on', async () => {
    main = preload([{ available: true, on: true, fingerprint: FP_ON }], { status: 'saved', on: false, fingerprint: FP_OFF, warning: null })
    await mount()
    expect(eco().getAttribute('aria-checked')).toBe('true')
    await click()
    expect(ecoCalls().at(-1)).toEqual({ channel: 'ecoMode.set', input: { root: ROOT, on: false, expected: FP_ON } })
  })

  it('the Profile changed outside: nothing written, a toast says so, and the switch shows the Profile read again', async () => {
    const { ECO_MODE_CHANGED } = await import('../../src/renderer/session/composer/EcoMode')
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }, { available: true, on: true, fingerprint: FP_ON }], { status: 'conflict' })
    await mount()
    await click()
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read', 'ecoMode.set', 'ecoMode.read'])
    expect(eco().getAttribute('aria-checked')).toBe('true')
    expect(await shownToasts()).toEqual([{ kind: 'info', text: ECO_MODE_CHANGED }])
  })

  it.each<[string, EcoModeSetResult | string, RegExp]>([
    ['refused', { status: 'invalid', reason: 'cannot write profile.json: EACCES' }, /^Eco mode was not turned on: cannot write profile\.json: EACCES$/u],
    ['busy', { status: 'busy' }, /another write of the Profile is in progress/u],
    ['too old', { status: 'too-old' }, /the Harness is too old/u],
    ['failed in main', 'ecoMode.set: bin/profile-set --set failed (exit 9)', /^Eco mode was not turned on: ecoMode\.set: bin\/profile-set --set failed \(exit 9\)$/u],
  ])('a write that did not go through (%s): an error toast with the reason, and the switch back to what the Profile says', async (_name, set, text) => {
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }], set)
    await mount()
    await click()
    expect(eco().getAttribute('aria-checked')).toBe('false')
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read', 'ecoMode.set', 'ecoMode.read'])
    const toasts = await shownToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.kind).toBe('error')
    expect(toasts[0]?.text).toMatch(text)
  })

  it('a Profile that cannot be read: unavailable, with the reason in the tooltip; a click writes nothing', async () => {
    main = preload([{ available: false, reason: 'this Harness has no bin/profile-set --field' }])
    await mount()
    expect(eco().getAttribute('aria-disabled')).toBe('true')
    expect(eco().title).toBe('Eco mode is not available: this Harness has no bin/profile-set --field')
    await click()
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read'])
  })

  it('a read that failed in main: unavailable, saying why', async () => {
    main = preload(['bin/profile-set --read failed (exit 3)'])
    await mount()
    expect(eco().getAttribute('aria-disabled')).toBe('true')
    expect(eco().title).toBe("Eco mode is not available: could not read the Project's Profile: bin/profile-set --read failed (exit 3)")
  })

  it('a window on a Linked machine: unavailable, and nothing read or written', async () => {
    const { ECO_MODE_ELSEWHERE } = await import('../../src/renderer/session/composer/EcoMode')
    window.history.replaceState(null, '', '/?machine=studio')
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }])
    await mount()
    expect(eco().getAttribute('aria-disabled')).toBe('true')
    expect(eco().title).toBe(ECO_MODE_ELSEWHERE)
    await click()
    expect(ecoCalls()).toEqual([])
  })

  it('read-only: unavailable with the read-only hint as its tooltip', async () => {
    window.history.replaceState(null, '', '/?machine=studio')
    readOnly.hint = 'studio gives this Machine read-only access'
    main = preload([{ available: true, on: false, fingerprint: FP_OFF }])
    await mount()
    expect(eco().getAttribute('aria-disabled')).toBe('true')
    expect(eco().title).toBe('studio gives this Machine read-only access')
    expect(eco().hasAttribute('data-read-only')).toBe(true)
    await click()
    expect(ecoCalls()).toEqual([])
  })
})
