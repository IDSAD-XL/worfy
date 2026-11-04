// The Auto-approval switch under the input field (src/renderer/session/composer/AutoApprove.tsx,
// worfy-auto-approve ticket 06) over the real renderer IPC client and a fake preload: only the
// Orchestrator's field has it; it shows the mode main reads for the Project (Off / Shadow / On), its
// menu lists the three positions with a tooltip each, choosing another one writes it through
// `autoApproval.set`, and a write that did not go through
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

type Name = 'Off' | 'Shadow' | 'On'
const trigger = () => screen.getByRole('button', { name: 'Auto-approval' })
const menu = () => screen.queryByRole('menu', { name: 'Auto-approval' })
const position = (name: Name) => within(menu()!).getByRole('menuitemradio', { name: new RegExp(`^${name}`, 'u') })
/** The mode the switch shows: its knob's place. */
const shownMode = () => trigger().getAttribute('data-mode')
const calls = () => main.calls.filter((call) => call.channel.startsWith('autoApproval.'))
const openMenu = async () => {
  await act(async () => {
    fireEvent.click(trigger())
  })
}
/** Opens the menu and chooses `name` in it. */
const choose = async (name: Name) => {
  await openMenu()
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
    expect(screen.queryByRole('button', { name: 'Auto-approval' })).toBeNull()
    expect(calls()).toEqual([])
  })

  it('no live Session: none', async () => {
    main = preload(['on'])
    await mount(null)
    expect(screen.queryByRole('button', { name: 'Auto-approval' })).toBeNull()
    expect(calls()).toEqual([])
  })

  it('shows the mode main reads; its menu has the three positions, each with its own tooltip, the one in force checked', async () => {
    const { AUTO_APPROVAL_OFF, AUTO_APPROVAL_SHADOW, AUTO_APPROVAL_ON } = await import('../../src/renderer/session/composer/AutoApprove')
    main = preload(['shadow'])
    await mount()
    expect(calls()).toEqual([{ channel: 'autoApproval.read', input: { projectId: PROJECT } }])
    expect(shownMode()).toBe('shadow')
    expect(trigger().getAttribute('aria-disabled')).toBeNull()
    expect(trigger().title).toBe(AUTO_APPROVAL_SHADOW)
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(menu()).toBeNull()
    await openMenu()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    const items = within(menu()!).getAllByRole('menuitemradio')
    expect(items.map((item) => item.querySelector('.w-auto-approval__option-label')?.textContent)).toEqual(['Off', 'Shadow', 'On'])
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(position('Off').title).toBe(AUTO_APPROVAL_OFF)
    expect(position('Shadow').title).toBe(AUTO_APPROVAL_SHADOW)
    expect(position('On').title).toBe(AUTO_APPROVAL_ON)
    expect(new Set([AUTO_APPROVAL_OFF, AUTO_APPROVAL_SHADOW, AUTO_APPROVAL_ON]).size).toBe(3)
    // The checked position has the focus; Esc closes the menu and gives the focus back.
    expect(document.activeElement).toBe(position('Shadow'))
    await act(async () => {
      fireEvent.keyDown(position('Shadow'), { key: 'ArrowDown' })
    })
    expect(document.activeElement).toBe(position('On'))
    await act(async () => {
      fireEvent.keyDown(position('On'), { key: 'Escape' })
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    expect(calls()).toHaveLength(1)
  })

  it('choosing another position writes it through main and shows it', async () => {
    main = preload(['off'])
    await mount()
    expect(shownMode()).toBe('off')
    await choose('Shadow')
    expect(calls().slice(1)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'shadow' } }])
    expect(shownMode()).toBe('shadow')
    expect(menu()).toBeNull()
    await choose('On')
    expect(calls().slice(2)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'on' } }])
    expect(shownMode()).toBe('on')
    await choose('Off')
    expect(calls().slice(3)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'off' } }])
    expect(shownMode()).toBe('off')
    // No read in between: the answer of the write is what the switch shows.
    expect(calls().filter((call) => call.channel === 'autoApproval.read')).toHaveLength(1)
  })

  it('choosing the position in force writes nothing', async () => {
    main = preload(['on'])
    await mount()
    await choose('On')
    expect(calls()).toEqual([{ channel: 'autoApproval.read', input: { projectId: PROJECT } }])
  })

  it('a press outside closes the menu and writes nothing', async () => {
    main = preload(['off'])
    await mount()
    await openMenu()
    await act(async () => {
      fireEvent.pointerDown(document.body)
    })
    expect(menu()).toBeNull()
    expect(calls()).toHaveLength(1)
  })

  it('shows the position being written at once, busy until main answers; the menu does not open meanwhile', async () => {
    main = preload(['off'], undefined, { hold: true })
    await mount()
    await choose('On')
    expect(shownMode()).toBe('on')
    expect(trigger().getAttribute('aria-busy')).toBe('true')
    await openMenu()
    expect(menu()).toBeNull()
    expect(calls().filter((call) => call.channel === 'autoApproval.set')).toHaveLength(1)
    await act(async () => {
      main.hold?.()
    })
    await settle()
    expect(trigger().getAttribute('aria-busy')).toBeNull()
    expect(shownMode()).toBe('on')
  })

  it('a write that failed: a toast says so, and the switch shows the mode read again', async () => {
    main = preload(['off', 'off'], 'app-settings.json could not be written')
    await mount()
    await choose('On')
    expect(shownMode()).toBe('off')
    expect(calls().map((call) => call.channel)).toEqual(['autoApproval.read', 'autoApproval.set', 'autoApproval.read'])
    expect(await shownToasts()).toEqual([{ kind: 'error', text: 'Auto-approval was not set to On: app-settings.json could not be written' }])
  })

  it('a read that failed: unavailable, saying why; a click opens nothing and writes nothing', async () => {
    main = preload(['demo-0000000d is not a Project of this Machine'])
    await mount()
    expect(trigger().getAttribute('aria-disabled')).toBe('true')
    expect(trigger().title).toBe('Auto-approval is not available: demo-0000000d is not a Project of this Machine')
    expect(shownMode()).toBeNull()
    await openMenu()
    expect(menu()).toBeNull()
    expect(calls().map((call) => call.channel)).toEqual(['autoApproval.read'])
  })

  it('a window on a Linked machine: read-only with where the mode is set, nothing read or written', async () => {
    const { AUTO_APPROVAL_ELSEWHERE } = await import('../../src/renderer/session/composer/AutoApprove')
    expect(AUTO_APPROVAL_ELSEWHERE).toBe('Auto-approval is set in worfy on the Machine of the Project')
    window.history.replaceState(null, '', '/?machine=studio')
    main = preload(['on'])
    await mount()
    expect(trigger().getAttribute('aria-disabled')).toBe('true')
    expect(trigger().hasAttribute('data-read-only')).toBe(true)
    expect(trigger().title).toBe(AUTO_APPROVAL_ELSEWHERE)
    expect(shownMode()).toBeNull()
    await openMenu()
    expect(menu()).toBeNull()
    expect(calls()).toEqual([])
  })

  it('a window on a Linked machine with read-only access: the same text, nothing read or written', async () => {
    const { AUTO_APPROVAL_ELSEWHERE } = await import('../../src/renderer/session/composer/AutoApprove')
    window.history.replaceState(null, '', '/?machine=studio')
    readOnly.hint = 'studio gives this Machine read-only access'
    main = preload(['on'])
    await mount()
    expect(trigger().getAttribute('aria-disabled')).toBe('true')
    expect(trigger().title).toBe(AUTO_APPROVAL_ELSEWHERE)
    await openMenu()
    expect(menu()).toBeNull()
    expect(calls()).toEqual([])
  })
})
