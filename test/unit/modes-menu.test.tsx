// The Modes menu under the Orchestrator's input field (src/renderer/session/composer/Modes.tsx,
// worfy-retry ticket 12) over the real renderer IPC client and a fake preload. One button «Modes»
// replaces the Eco mode switch (worfy-throughput ticket 60) and the Auto-approval switch
// (worfy-auto-approve ticket 06); every case of their tests moved here (test/unit/eco-mode-switch.test.tsx
// and test/unit/auto-approve-switch.test.tsx before this ticket).
//
// Only the Orchestrator's field has it. Eco mode shows `workflow.agents` of the Profile as main reads it
// (eco — on), a choice writes the other value with the fingerprint it read, and a write that did not go
// through shows a toast and the Profile as it is now. Auto-approval shows the mode main reads for the
// Project (Off / Shadow / On), choosing another position writes it through `autoApproval.set`, and a
// write that did not go through shows a toast and the mode read again; under a debugging port it is Off
// and unavailable. Auto-continue (worfy-retry ticket 02), the third item, shows whether main reads it
// on for the Project, a choice writes the other value through `autoContinue.set`, a change made in
// another window shows at once (`autoContinue.changed`), and a write that did not go through shows a
// toast and the setting read again. A window on a Linked machine (worfy-retry ticket 13) reads and writes
// the modes of that Machine through `linked.invoke`: with full access it changes them, with read-only
// access it shows them unavailable with the read-only hint. What main does with a write is checked in test/contract/eco-mode.test.ts,
// test/contract/auto-approve-setting.test.ts, test/contract/auto-continue-setting.test.ts and, from a Linked
// machine, test/contract/modes-linked.test.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoApprovalState } from '../../src/shared/ipc/auto-approve'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { EcoModeSetResult, EcoModeState } from '../../src/shared/ipc/eco-mode'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'

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

/** What autoApproval.* answers: a mode (saved and in force), a whole state, or a string — main threw with it. */
type Answer = AutoApprovalMode | AutoApprovalState | string

interface FakeMain {
  /** Every call; the inner one of `linked.invoke` also names the Machine it went to. */
  calls: { channel: string; input: unknown; machine?: string }[]
  /** What each ecoMode.read answers, in turn (the last one again once they run out); a string — main threw with it. */
  ecoReads: (EcoModeState | string)[]
  /** What ecoMode.set answers; a string — main threw with it. */
  ecoSet: EcoModeSetResult | string
  /** What each autoApproval.read answers, in turn (the last one again once they run out). */
  autoReads: Answer[]
  /** What autoApproval.set answers; undefined — the mode it was given. */
  autoSet: Answer | undefined
  /** Holds the answer of autoApproval.set until called. */
  hold: (() => void) | null
  /** What each autoContinue.read answers, in turn (the last one again once they run out); a string — main threw with it. */
  contReads: (boolean | string)[]
  /** What autoContinue.set answers; undefined — the value it was given; a string — main threw with it. */
  contSet: boolean | string | undefined
  /** Holds the answer of autoContinue.set until called. */
  contHold: (() => void) | null
  /** What `autoApproval.blockedHere` of this Machine answers: why it lets no Shadow or On out. */
  blockedHere: string | null
  /** When set, `autoApproval.blockedHere` fails with this error instead. */
  blockedHereFails: string | null
  /** Sends an event of main to the window's subscribers. */
  emit: (channel: string, payload: unknown) => void
  /** Sends an event of Linked machine `machine` to the window, as this Machine's main passes it on (`linked.event`). */
  emitLinked: (machine: string, channel: string, payload: unknown) => void
  /** How many subscriptions the window holds on `channel` now. */
  listening: (channel: string) => number
}

let main: FakeMain

const MODES: readonly string[] = ['off', 'shadow', 'on']
const ECO_OFF: EcoModeState = { available: true, on: false, fingerprint: FP_OFF }
const ECO_ON: EcoModeState = { available: true, on: true, fingerprint: FP_ON }

interface Setup {
  blockedHere?: string | null
  blockedHereFails?: string
  eco?: (EcoModeState | string)[]
  ecoSet?: EcoModeSetResult | string
  auto?: Answer[]
  autoSet?: Answer
  hold?: boolean
  cont?: (boolean | string)[]
  contSet?: boolean | string
  contHold?: boolean
}

function preload(setup: Setup = {}): FakeMain {
  const fake: FakeMain = {
    calls: [],
    ecoReads: setup.eco ?? [ECO_OFF],
    ecoSet: setup.ecoSet ?? { status: 'saved', on: true, fingerprint: FP_ON, warning: null },
    autoReads: setup.auto ?? ['off'],
    autoSet: setup.autoSet,
    hold: null,
    contReads: setup.cont ?? [false],
    contSet: setup.contSet,
    contHold: null,
    blockedHere: setup.blockedHere ?? null,
    blockedHereFails: setup.blockedHereFails ?? null,
    emit: (channel, payload) => {
      for (const [, each] of listeners) if (each.channel === channel) each.handler(payload)
    },
    emitLinked: (machine, channel, payload) => fake.emit('linked.event', { machine, channel, payload }),
    listening: (channel) => [...listeners.values()].filter((each) => each.channel === channel).length,
  }
  const listeners = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let nextListener = 1
  const contAnswer = (value: boolean | string | undefined) => Promise.resolve(typeof value === 'boolean' ? ({ ok: true, value: { on: value } } as never) : ({ ok: false, error: value } as never))
  const ecoAnswer = (value: unknown) => Promise.resolve(typeof value === 'string' ? ({ ok: false, error: value } as never) : ({ ok: true, value } as never))
  const autoAnswer = (value: Answer | undefined) =>
    Promise.resolve(
      typeof value === 'object'
        ? ({ ok: true, value } as never)
        : MODES.includes(value ?? '')
          ? ({ ok: true, value: { mode: value, saved: value, blocked: null } } as never)
          : ({ ok: false, error: value } as never),
    )
  const answer = (channel: string, input: unknown, machine: string | null): Promise<never> => {
    fake.calls.push(machine === null ? { channel, input } : { channel, input, machine })
    switch (channel) {
      case 'linked.invoke': {
        // A window on a Linked machine: this Machine's main passes the call on and wraps the answer.
        const call = input as { machine: string; channel: string; input: unknown }
        return answer(call.channel, call.input, call.machine).then((inner) => ({ ok: true, value: inner }) as never)
      }
      case 'autoApproval.blockedHere':
        if (fake.blockedHereFails !== null) return Promise.resolve({ ok: false, error: fake.blockedHereFails } as never)
        return Promise.resolve({ ok: true, value: { blocked: fake.blockedHere } } as never)
      case 'ecoMode.read':
        return ecoAnswer(fake.ecoReads.length > 1 ? fake.ecoReads.shift() : fake.ecoReads[0])
      case 'ecoMode.set':
        return ecoAnswer(fake.ecoSet)
      case 'autoApproval.read':
        return autoAnswer(fake.autoReads.length > 1 ? fake.autoReads.shift() : fake.autoReads[0])
      case 'autoApproval.set': {
        const value = fake.autoSet ?? (input as { mode: AutoApprovalMode }).mode
        if (setup.hold !== true) return autoAnswer(value)
        return new Promise((resolve) => {
          fake.hold = () => resolve(autoAnswer(value) as never)
        })
      }
      case 'autoContinue.read':
        return contAnswer(fake.contReads.length > 1 ? fake.contReads.shift() : fake.contReads[0])
      case 'autoContinue.set': {
        const value = fake.contSet ?? (input as { on: boolean }).on
        if (setup.contHold !== true) return contAnswer(value)
        return new Promise((resolve) => {
          fake.contHold = () => resolve(contAnswer(value) as never)
        })
      }
      default:
        return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => answer(channel, input, null),
    on: (channel, handler) => {
      const id = nextListener++
      listeners.set(id, { channel, handler })
      return id
    },
    off: (id) => {
      listeners.delete(id)
    },
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return fake
}

const view = (sessionId: string): OrchestratorView => ({ projectId: PROJECT, nodeId: 'orch-node', sessionId, state: 'idle', error: null, model: null, costUsd: 0, statusBlock: null, version: 1 })

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/**
 * The revision of the Project list each mount gives: the mocked useProjects module keeps its store from
 * test to test (vi.resetModules does not renew a mocked module), and a list of a lower revision is not taken.
 */
let projectsRevision = 100

/** The button with the window knowing the Orchestrator of the Project at ROOT and its live Session SESSION. */
async function mount(sessionId: string | null = SESSION) {
  const { acceptOrchestratorView } = await import('../../src/renderer/canvas/nodes/orchestrator-view')
  const { acceptProjectsState } = await import('../../src/renderer/projects/useProjects')
  const { default: Modes } = await import('../../src/renderer/session/composer/Modes')
  acceptOrchestratorView(view(SESSION))
  acceptProjectsState({ projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: null }], activeId: PROJECT, revision: ++projectsRevision })
  render(<Modes sessionId={sessionId} busy={false} text="" setText={() => undefined} />)
  // Whatever main was asked has answered.
  await settle()
}

type Name = 'Off' | 'Shadow' | 'On'
const trigger = () => screen.getByRole('button', { name: /^Modes/u })
const menu = () => screen.queryByRole('menu', { name: 'Modes' })
const ecoItem = () => within(menu()!).getByRole('menuitemcheckbox', { name: /^Eco mode/u })
const group = () => within(menu()!).getByRole('group', { name: 'Auto-approval' })
const position = (name: Name) => within(menu()!).getByRole('menuitemradio', { name: new RegExp(`^${name}`, 'u') })
const items = () => [...menu()!.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"], [role="menuitemradio"]')]
/** The state icon of an item on the button: on, off, shadow or unknown. */
const slot = (item: 'eco' | 'auto-approval' | 'auto-continue') => trigger().querySelector<HTMLElement>(`[data-mode-item="${item}"]`)!
/** What main was asked of the modes; other channels (projects.list) do not count. */
const modeCalls = () => main.calls.filter((call) => /^(ecoMode|autoApproval|autoContinue)\./u.test(call.channel))
/** The check mark in front of an item: shown only on a checked one. */
const marked = (item: HTMLElement) => item.querySelector('.w-modes__check svg') !== null
const ecoCalls = () => main.calls.filter((call) => call.channel.startsWith('ecoMode.'))
const autoCalls = () => main.calls.filter((call) => call.channel.startsWith('autoApproval.'))
const contCalls = () => main.calls.filter((call) => call.channel.startsWith('autoContinue.'))
const contItem = () => within(menu()!).getByRole('menuitemcheckbox', { name: /^Auto-continue/u })
const press = async (element: Element, key: string) => {
  await act(async () => {
    fireEvent.keyDown(element, { key })
  })
}
const openMenu = async () => {
  await act(async () => {
    fireEvent.click(trigger())
  })
}
const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element)
  })
  await settle()
}
/** Opens the menu if it is closed, and clicks Eco mode in it. */
const clickEco = async () => {
  if (menu() === null) await openMenu()
  await click(ecoItem())
}
/** Opens the menu if it is closed, and chooses `name` in it. */
const choose = async (name: Name) => {
  if (menu() === null) await openMenu()
  await click(position(name))
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

describe('the Modes button', () => {
  it("takes Eco mode's place in the controls line", async () => {
    const modes = await import('../../src/renderer/session/composer/Modes')
    expect(modes.order).toBe(15)
    expect((modes as { line?: string }).line).toBeUndefined()
  })

  it('a Session that is not the Orchestrator has none, and asks main for nothing', async () => {
    main = preload()
    await mount('another-session')
    expect(screen.queryByRole('button', { name: /^Modes/u })).toBeNull()
    expect(modeCalls()).toEqual([])
  })

  it('no live Session: none, and nothing asked', async () => {
    main = preload()
    await mount(null)
    expect(screen.queryByRole('button', { name: /^Modes/u })).toBeNull()
    expect(modeCalls()).toEqual([])
  })

  it('the Orchestrator: «Modes», a menu button, with the state icon of every item in a fixed order and the states in its tooltip', async () => {
    main = preload({ eco: [ECO_ON], auto: ['shadow'] })
    await mount()
    expect(modeCalls()).toEqual([
      { channel: 'ecoMode.read', input: { root: ROOT } },
      { channel: 'autoApproval.read', input: { projectId: PROJECT } },
      { channel: 'autoContinue.read', input: { projectId: PROJECT } },
    ])
    expect(trigger().textContent).toBe('Modes')
    // The states are in the accessible name and the tooltip alike.
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode on, Auto-approval shadow, Auto-continue off')
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().getAttribute('aria-disabled')).toBeNull()
    expect([...trigger().querySelectorAll('[data-mode-item]')].map((each) => each.getAttribute('data-mode-item'))).toEqual(['eco', 'auto-approval', 'auto-continue'])
    expect(slot('eco').getAttribute('data-state')).toBe('on')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('shadow')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('off')
    expect(trigger().title).toBe('Modes: Eco mode on, Auto-approval shadow, Auto-continue off')
    expect(menu()).toBeNull()
  })

  it('the button is as wide in every combination of states: each icon has a slot of its own, the same in every state', async () => {
    const shape = () =>
      [...trigger().querySelectorAll('[data-mode-item]')].map((each) => {
        const svg = each.querySelector('svg')
        return `${each.className} ${svg?.getAttribute('width')}x${svg?.getAttribute('height')} ${svg?.getAttribute('viewBox')}`
      })
    const seen = new Map<string, string[]>()
    for (const eco of [ECO_OFF, ECO_ON, { available: false, reason: 'no Profile' } as EcoModeState]) {
      for (const auto of ['off', 'shadow', 'on', 'cannot read'] as Answer[]) {
        for (const cont of [false, true, 'cannot read']) {
          main = preload({ eco: [eco], auto: [auto], cont: [cont] })
          await mount()
          seen.set(`${slot('eco').getAttribute('data-state')}/${slot('auto-approval').getAttribute('data-state')}/${slot('auto-continue').getAttribute('data-state')}`, [trigger().textContent ?? '', ...shape()])
          cleanup()
        }
      }
    }
    // Every combination of the three states: 3 × 4 × 3.
    expect(seen.size).toBe(36)
    expect(new Set([...seen.values()].map((each) => JSON.stringify(each))).size).toBe(1)
    expect(seen.get('on/on/on')).toEqual(['Modes', 'w-modes__slot 10x10 0 0 16 16', 'w-modes__slot 10x10 0 0 16 16', 'w-modes__slot 10x10 0 0 16 16'])
    expect(seen.has('unknown/unknown/unknown')).toBe(true)
  })
})

describe('where the menu stands', () => {
  it('over the button, moved left as far as the right edge of the window makes it', async () => {
    main = preload()
    const width = window.innerWidth
    const height = window.innerHeight
    // The button and the menu both 240 px wide, 900 px from the left, 700 px from the top, in a 1000×800 window.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 900, top: 700, width: 240, height: 24, right: 1140, bottom: 724, x: 900, y: 700, toJSON: () => ({}) })
    Object.assign(window, { innerWidth: 1000, innerHeight: 800 })
    try {
      await mount()
      await openMenu()
      expect(menu()!.style.bottom).toBe('104px')
      expect(menu()!.style.left).toBe(`${1000 - 240 - 8}px`)
      await press(ecoItem(), 'Escape')
      // Room enough on the right: it stays where the button starts.
      Object.assign(window, { innerWidth: 1600 })
      await openMenu()
      expect(menu()!.style.left).toBe('900px')
    } finally {
      rect.mockRestore()
      Object.assign(window, { innerWidth: width, innerHeight: height })
    }
  })
})

describe('the keyboard', () => {
  it('ArrowDown on the button opens the menu; arrows, Home and End move; Enter and Space choose; Esc closes it back to the button', async () => {
    main = preload({ eco: [ECO_OFF], auto: ['off'] })
    await mount()
    await press(trigger(), 'ArrowDown')
    expect(menu()).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    // The roles: one menu, a checkbox item, then the group of three radio items.
    expect(items().map((item) => `${item.getAttribute('role')} ${item.getAttribute('aria-checked')}`)).toEqual([
      'menuitemcheckbox false',
      'menuitemradio true',
      'menuitemradio false',
      'menuitemradio false',
      'menuitemcheckbox false',
    ])
    expect(document.activeElement).toBe(ecoItem())
    await press(ecoItem(), 'ArrowDown')
    expect(document.activeElement).toBe(position('Off'))
    await press(position('Off'), 'End')
    expect(document.activeElement).toBe(contItem())
    await press(contItem(), 'ArrowDown')
    expect(document.activeElement).toBe(contItem())
    await press(contItem(), 'ArrowUp')
    expect(document.activeElement).toBe(position('On'))
    await press(position('On'), 'ArrowUp')
    expect(document.activeElement).toBe(position('Shadow'))
    await press(position('Shadow'), 'Home')
    expect(document.activeElement).toBe(ecoItem())
    await press(ecoItem(), 'ArrowUp')
    expect(document.activeElement).toBe(ecoItem())

    // Enter on Eco mode turns it on; the menu stays open and shows it.
    await press(ecoItem(), 'Enter')
    await settle()
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
    expect(slot('eco').getAttribute('data-state')).toBe('on')
    // Space on Shadow sets it; the menu stays open.
    await press(ecoItem(), 'ArrowDown')
    await press(position('Off'), 'ArrowDown')
    await press(position('Shadow'), ' ')
    await settle()
    expect(position('Shadow').getAttribute('aria-checked')).toBe('true')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('shadow')
    // Enter on Auto-continue turns it on.
    await press(position('Shadow'), 'End')
    await press(contItem(), 'Enter')
    await settle()
    expect(contItem().getAttribute('aria-checked')).toBe('true')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
    expect(modeCalls().map((call) => call.channel)).toEqual(['ecoMode.read', 'autoApproval.read', 'autoContinue.read', 'ecoMode.set', 'autoApproval.set', 'autoContinue.set'])

    await press(contItem(), 'Escape')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    // Enter and Space on the button are its click: they open the menu again.
    await act(async () => {
      fireEvent.click(trigger())
    })
    expect(menu()).not.toBeNull()
  })

  it('Esc in the menu goes no further: a dialog or the focus mode under the bar does not close on it', async () => {
    main = preload()
    await mount()
    const heard: string[] = []
    const listener = (event: KeyboardEvent) => heard.push(event.key)
    document.addEventListener('keydown', listener)
    try {
      await openMenu()
      let delivered = true
      await act(async () => {
        delivered = fireEvent.keyDown(position('Off'), { key: 'Escape' })
      })
      // Taken by the menu: its default is held back too.
      expect(delivered).toBe(false)
      expect(menu()).toBeNull()
      expect(heard).toEqual([])
    } finally {
      document.removeEventListener('keydown', listener)
    }
  })

  it('Tab, a resize and the window losing focus close the menu, writing nothing', async () => {
    main = preload()
    await mount()
    await openMenu()
    await press(position('Off'), 'Tab')
    expect(menu()).toBeNull()
    // The focus goes back to the button before the menu goes, so Tab moves on from the button.
    expect(document.activeElement).toBe(trigger())
    await openMenu()
    expect(menu()).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(menu()).toBeNull()
    await openMenu()
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(menu()).toBeNull()
    expect(modeCalls()).toHaveLength(3)
  })

  it('a press outside closes the menu and writes nothing; a second click on the button closes it too', async () => {
    main = preload()
    await mount()
    await openMenu()
    // A press inside the menu or on the button is not outside.
    await act(async () => {
      fireEvent.pointerDown(ecoItem())
    })
    expect(menu()).not.toBeNull()
    await act(async () => {
      fireEvent.pointerDown(trigger())
    })
    expect(menu()).not.toBeNull()
    await act(async () => {
      fireEvent.pointerDown(document.body)
    })
    expect(menu()).toBeNull()
    await openMenu()
    await openMenu()
    expect(menu()).toBeNull()
    expect(modeCalls()).toHaveLength(3)
  })
})

describe('Eco mode in the menu', () => {
  it('off without workflow.agents eco; a choice writes on with the fingerprint read, and shows on', async () => {
    const { ECO_MODE_TITLE } = await import('../../src/renderer/session/modes/eco-mode')
    main = preload({ eco: [ECO_OFF] })
    await mount()
    expect(slot('eco').getAttribute('data-state')).toBe('off')
    await openMenu()
    expect(ecoItem().getAttribute('aria-checked')).toBe('false')
    expect(marked(ecoItem())).toBe(false)
    expect(ecoItem().title).toBe(ECO_MODE_TITLE)
    expect(ecoItem().title).toMatch(/applies to the next Ticket/u)
    expect(ecoItem().getAttribute('aria-disabled')).toBeNull()
    await clickEco()
    expect(ecoCalls()).toEqual([
      { channel: 'ecoMode.read', input: { root: ROOT } },
      { channel: 'ecoMode.set', input: { root: ROOT, on: true, expected: FP_OFF } },
    ])
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
    expect(marked(ecoItem())).toBe(true)
    expect(slot('eco').getAttribute('data-state')).toBe('on')
    // The menu stays open: the new state shows in it.
    expect(menu()).not.toBeNull()
    expect(await shownToasts()).toEqual([])
  })

  it('on: a choice writes off with the fingerprint of the last write, and no read in between', async () => {
    main = preload({ eco: [ECO_OFF] })
    await mount()
    await clickEco()
    main.ecoSet = { status: 'saved', on: false, fingerprint: FP_OFF, warning: null }
    await clickEco()
    expect(ecoCalls().map((call) => call.input)).toEqual([{ root: ROOT }, { root: ROOT, on: true, expected: FP_OFF }, { root: ROOT, on: false, expected: FP_ON }])
    expect(ecoItem().getAttribute('aria-checked')).toBe('false')
    expect(slot('eco').getAttribute('data-state')).toBe('off')
  })

  it('shows on what main reads as on', async () => {
    main = preload({ eco: [ECO_ON], ecoSet: { status: 'saved', on: false, fingerprint: FP_OFF, warning: null } })
    await mount()
    await openMenu()
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
    await clickEco()
    expect(ecoCalls().at(-1)).toEqual({ channel: 'ecoMode.set', input: { root: ROOT, on: false, expected: FP_ON } })
  })

  it('a write committed without the Harness home: an info toast with the warning', async () => {
    main = preload({ eco: [ECO_OFF], ecoSet: { status: 'saved', on: true, fingerprint: FP_ON, warning: 'git commit failed' } })
    await mount()
    await clickEco()
    expect(await shownToasts()).toEqual([{ kind: 'info', text: 'Eco mode turned on. The change was not committed in the Harness home: git commit failed' }])
  })

  it('the Profile changed outside: nothing written, a toast says so, and the item shows the Profile read again', async () => {
    const { ECO_MODE_CHANGED } = await import('../../src/renderer/session/modes/eco-mode')
    main = preload({ eco: [ECO_OFF, ECO_ON], ecoSet: { status: 'conflict' } })
    await mount()
    await clickEco()
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read', 'ecoMode.set', 'ecoMode.read'])
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
    expect(await shownToasts()).toEqual([{ kind: 'info', text: ECO_MODE_CHANGED }])
  })

  it.each<[string, EcoModeSetResult | string, RegExp]>([
    ['refused', { status: 'invalid', reason: 'cannot write profile.json: EACCES' }, /^Eco mode was not turned on: cannot write profile\.json: EACCES$/u],
    ['busy', { status: 'busy' }, /another write of the Profile is in progress/u],
    ['too old', { status: 'too-old' }, /the Harness is too old/u],
    ['failed in main', 'ecoMode.set: bin/profile-set --set failed (exit 9)', /^Eco mode was not turned on: ecoMode\.set: bin\/profile-set --set failed \(exit 9\)$/u],
  ])('a write that did not go through (%s): an error toast with the reason, and the item back to what the Profile says', async (_name, set, text) => {
    main = preload({ eco: [ECO_OFF], ecoSet: set })
    await mount()
    await clickEco()
    expect(ecoItem().getAttribute('aria-checked')).toBe('false')
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read', 'ecoMode.set', 'ecoMode.read'])
    const toasts = await shownToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.kind).toBe('error')
    expect(toasts[0]?.text).toMatch(text)
  })

  it('busy while main writes: the item and the button say so, and another choice meanwhile writes nothing', async () => {
    main = preload({ eco: [ECO_OFF] })
    let release: (() => void) | null = null
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const invoke = bridge.invoke
    // Every ecoMode.set is recorded when it is asked, not when it answers: a second write while the
    // first is held must show in the calls.
    bridge.invoke = (channel, input) => {
      if (channel !== 'ecoMode.set') return invoke(channel, input)
      main.calls.push({ channel, input })
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, value: main.ecoSet } as never)
      })
    }
    await mount()
    await clickEco()
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
    expect(ecoItem().getAttribute('aria-busy')).toBe('true')
    expect(trigger().getAttribute('aria-busy')).toBe('true')
    await click(ecoItem())
    await act(async () => {
      release?.()
    })
    await settle()
    expect(ecoItem().getAttribute('aria-busy')).toBeNull()
    expect(trigger().getAttribute('aria-busy')).toBeNull()
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read', 'ecoMode.set'])
  })

  it('while the Profile is read: unavailable, «Reading…»', async () => {
    main = preload({ eco: [ECO_OFF] })
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const invoke = bridge.invoke
    bridge.invoke = (channel, input) => (channel === 'ecoMode.read' ? new Promise(() => undefined) : invoke(channel, input))
    await mount()
    expect(slot('eco').getAttribute('data-state')).toBe('unknown')
    await openMenu()
    expect(ecoItem().getAttribute('aria-disabled')).toBe('true')
    expect(ecoItem().title).toBe("Reading the Project's Profile…")
    expect(ecoItem().getAttribute('aria-checked')).toBe('false')
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode being read, Auto-approval off, Auto-continue off')
  })

  it('a Profile that cannot be read: unavailable, with the reason in the tooltip; a choice writes nothing', async () => {
    main = preload({ eco: [{ available: false, reason: 'this Harness has no bin/profile-set --field' }] })
    await mount()
    expect(slot('eco').getAttribute('data-state')).toBe('unknown')
    await openMenu()
    expect(ecoItem().getAttribute('aria-disabled')).toBe('true')
    expect(ecoItem().title).toBe('Eco mode is not available: this Harness has no bin/profile-set --field')
    expect(ecoItem().getAttribute('aria-checked')).toBe('false')
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode not available, Auto-approval off, Auto-continue off')
    await clickEco()
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read'])
  })

  it("the Project's folder changes: what was read of the old folder is not shown, nothing is written until the new one is read", async () => {
    const OTHER = '/work/moved'
    main = preload({ eco: [ECO_ON] })
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const invoke = bridge.invoke
    // The read of the new folder never answers.
    bridge.invoke = (channel, input) => {
      if (channel !== 'ecoMode.read' || (input as { root: string }).root !== OTHER) return invoke(channel, input)
      main.calls.push({ channel, input })
      return new Promise(() => undefined)
    }
    await mount()
    expect(slot('eco').getAttribute('data-state')).toBe('on')
    const { acceptProjectsState } = await import('../../src/renderer/projects/useProjects')
    await act(async () => {
      acceptProjectsState({ projects: [{ id: PROJECT, name: 'demo', path: OTHER, branch: null }], activeId: PROJECT, revision: ++projectsRevision })
    })
    await settle()
    expect(ecoCalls().map((call) => call.input)).toEqual([{ root: ROOT }, { root: OTHER }])
    expect(slot('eco').getAttribute('data-state')).toBe('unknown')
    await openMenu()
    expect(ecoItem().title).toBe("Reading the Project's Profile…")
    await clickEco()
    expect(ecoCalls().map((call) => call.channel)).toEqual(['ecoMode.read', 'ecoMode.read'])
  })

  it('a read that failed in main: unavailable, saying why', async () => {
    main = preload({ eco: ['bin/profile-set --read failed (exit 3)'] })
    await mount()
    await openMenu()
    expect(ecoItem().getAttribute('aria-disabled')).toBe('true')
    expect(ecoItem().title).toBe("Eco mode is not available: could not read the Project's Profile: bin/profile-set --read failed (exit 3)")
  })
})

describe('Auto-approval in the menu', () => {
  it('shows the mode main reads; the three positions, each with its caption, line and tooltip, the one in force checked', async () => {
    const { AUTO_APPROVAL_OFF, AUTO_APPROVAL_SHADOW, AUTO_APPROVAL_ON } = await import('../../src/renderer/session/modes/auto-approval')
    main = preload({ auto: ['shadow'] })
    await mount()
    expect(autoCalls()).toEqual([{ channel: 'autoApproval.read', input: { projectId: PROJECT } }])
    expect(slot('auto-approval').getAttribute('data-state')).toBe('shadow')
    expect(slot('auto-approval').getAttribute('data-saved')).toBe('shadow')
    await openMenu()
    expect(group().textContent).toMatch(/^Auto-approval/u)
    const radios = within(group()).getAllByRole('menuitemradio')
    expect(radios.map((item) => item.querySelector('.w-modes__item-label')?.textContent)).toEqual(['Off', 'Shadow', 'On'])
    expect(radios.map((item) => item.querySelector('.w-modes__item-detail')?.textContent)).toEqual(['Refuse every request', 'Refuse, and log what would pass', 'Answer by the Approval policy'])
    expect(radios.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(radios.map(marked)).toEqual([false, true, false])
    expect(radios.map((item) => item.getAttribute('aria-disabled'))).toEqual([null, null, null])
    expect(radios.map((item) => item.hasAttribute('data-read-only'))).toEqual([false, false, false])
    expect(trigger().hasAttribute('data-read-only')).toBe(false)
    expect(position('Off').title).toBe(AUTO_APPROVAL_OFF)
    expect(position('Shadow').title).toBe(AUTO_APPROVAL_SHADOW)
    expect(position('On').title).toBe(AUTO_APPROVAL_ON)
    expect(new Set([AUTO_APPROVAL_OFF, AUTO_APPROVAL_SHADOW, AUTO_APPROVAL_ON]).size).toBe(3)
    expect(autoCalls()).toHaveLength(1)
  })

  it('choosing another position writes it through main and shows it, the menu staying open', async () => {
    main = preload({ auto: ['off'] })
    await mount()
    expect(slot('auto-approval').getAttribute('data-state')).toBe('off')
    await choose('Shadow')
    expect(autoCalls().slice(1)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'shadow' } }])
    expect(slot('auto-approval').getAttribute('data-state')).toBe('shadow')
    expect(position('Shadow').getAttribute('aria-checked')).toBe('true')
    expect(menu()).not.toBeNull()
    await choose('On')
    expect(autoCalls().slice(2)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'on' } }])
    expect(slot('auto-approval').getAttribute('data-state')).toBe('on')
    await choose('Off')
    expect(autoCalls().slice(3)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'off' } }])
    expect(slot('auto-approval').getAttribute('data-state')).toBe('off')
    // No read in between: the answer of the write is what the item shows.
    expect(autoCalls().filter((call) => call.channel === 'autoApproval.read')).toHaveLength(1)
  })

  it('choosing the position in force writes nothing', async () => {
    main = preload({ auto: ['on'] })
    await mount()
    await choose('On')
    expect(autoCalls()).toEqual([{ channel: 'autoApproval.read', input: { projectId: PROJECT } }])
  })

  it('shows the position being written at once, busy until main answers; another choice meanwhile writes nothing', async () => {
    main = preload({ auto: ['off'], hold: true })
    await mount()
    await choose('On')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('on')
    expect(trigger().getAttribute('aria-busy')).toBe('true')
    expect(group().getAttribute('aria-busy')).toBe('true')
    await choose('Shadow')
    expect(autoCalls().filter((call) => call.channel === 'autoApproval.set')).toHaveLength(1)
    await act(async () => {
      main.hold?.()
    })
    await settle()
    expect(trigger().getAttribute('aria-busy')).toBeNull()
    expect(group().getAttribute('aria-busy')).toBeNull()
    expect(slot('auto-approval').getAttribute('data-state')).toBe('on')
  })

  it('a write that failed: a toast says so, and the item shows the mode read again', async () => {
    main = preload({ auto: ['off', 'off'], autoSet: 'app-settings.json could not be written' })
    await mount()
    await choose('On')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('off')
    expect(autoCalls().map((call) => call.channel)).toEqual(['autoApproval.read', 'autoApproval.set', 'autoApproval.read'])
    expect(await shownToasts()).toEqual([{ kind: 'error', text: 'Auto-approval was not set to On: app-settings.json could not be written' }])
  })

  it('a read that failed: the three positions unavailable, saying why; a choice writes nothing; Eco mode still works', async () => {
    main = preload({ auto: ['demo-0000000d is not a Project of this Machine'] })
    await mount()
    expect(slot('auto-approval').getAttribute('data-state')).toBe('unknown')
    await openMenu()
    for (const name of ['Off', 'Shadow', 'On'] as const) {
      expect(position(name).getAttribute('aria-disabled')).toBe('true')
      expect(position(name).getAttribute('aria-checked')).toBe('false')
      expect(position(name).title).toBe('Auto-approval is not available: demo-0000000d is not a Project of this Machine')
    }
    await choose('On')
    expect(autoCalls().map((call) => call.channel)).toEqual(['autoApproval.read'])
    expect(ecoItem().getAttribute('aria-disabled')).toBeNull()
  })

  it('while the mode is read: unavailable, «Reading…»', async () => {
    main = preload()
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const invoke = bridge.invoke
    bridge.invoke = (channel, input) => (channel === 'autoApproval.read' ? new Promise(() => undefined) : invoke(channel, input))
    await mount()
    await openMenu()
    expect(position('Off').getAttribute('aria-disabled')).toBe('true')
    expect(position('Off').title).toBe('Reading the Auto-approval mode…')
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode off, Auto-approval being read, Auto-continue off')
  })

  it('shows the mode main answers, not the one asked for', async () => {
    main = preload({ auto: ['off'], autoSet: { mode: 'shadow', saved: 'shadow', blocked: null } })
    await mount()
    await choose('On')
    expect(autoCalls().slice(1)).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'on' } }])
    expect(slot('auto-approval').getAttribute('data-state')).toBe('shadow')
  })

  it('a debugging port open: Off in force, the three positions unavailable, the tooltip says why and what was saved; nothing written', async () => {
    const reason = 'worfy runs with a debugging port open (--remote-debugging-port)'
    main = preload({ auto: [{ mode: 'off', saved: 'on', blocked: reason }] })
    await mount()
    expect(slot('auto-approval').getAttribute('data-state')).toBe('off')
    expect(slot('auto-approval').getAttribute('data-saved')).toBe('on')
    await openMenu()
    const title = `Auto-approval is off: ${reason}, so any program on this Machine could turn it on. The saved mode, On, applies once worfy starts without it.`
    for (const name of ['Off', 'Shadow', 'On'] as const) {
      expect(position(name).getAttribute('aria-disabled')).toBe('true')
      expect(position(name).title).toBe(title)
    }
    expect(position('Off').getAttribute('aria-checked')).toBe('true')
    await choose('On')
    await choose('Shadow')
    expect(autoCalls().map((call) => call.channel)).toEqual(['autoApproval.read'])
  })

  it('a debugging port with Off saved: the tooltip names no saved mode', async () => {
    const reason = 'worfy runs with a debugging port open (--remote-debugging-port)'
    main = preload({ auto: [{ mode: 'off', saved: 'off', blocked: reason }] })
    await mount()
    await openMenu()
    expect(position('On').title).toBe(`Auto-approval is off: ${reason}, so any program on this Machine could turn it on.`)
  })
})

// worfy-retry ticket 13 (Q15–Q18): a window on Linked machine `studio` shows the modes of that Machine's
// Project. Every mode channel goes there through this Machine's `linked.invoke`, its changes come back
// as `linked.event`; full access changes them, read-only access only sees them.
describe('a window on a Linked machine', () => {
  const MACHINE = 'studio'
  const HINT = 'studio gives this Machine read-only access'
  const DEBUG = 'worfy runs with a debugging port open (--remote-debugging-port)'
  const onLinked = () => window.history.replaceState(null, '', `/?machine=${MACHINE}`)
  const writes = () => modeCalls().filter((call) => call.channel.endsWith('.set'))

  it('full access: the menu shows the modes of the Machine of the Project, and every choice goes there through linked.invoke', async () => {
    onLinked()
    main = preload({ eco: [ECO_OFF], auto: ['shadow'], cont: [false] })
    await mount()
    expect(slot('eco').getAttribute('data-state')).toBe('off')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('shadow')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('off')
    expect(trigger().hasAttribute('data-read-only')).toBe(false)
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode off, Auto-approval shadow, Auto-continue off')
    // Read on the Machine of the Project, never on this one.
    expect(modeCalls().filter((call) => call.channel.endsWith('.read'))).toEqual([
      expect.objectContaining({ channel: expect.stringMatching(/^(ecoMode|autoApproval|autoContinue)\.read$/u), machine: MACHINE }),
      expect.objectContaining({ machine: MACHINE }),
      expect.objectContaining({ machine: MACHINE }),
    ])
    expect(main.calls.filter((call) => call.channel === 'ecoMode.read')).toEqual([{ channel: 'ecoMode.read', input: { root: ROOT }, machine: MACHINE }])
    // Why this Machine would hold Auto-approval back is asked of this Machine.
    expect(main.calls.filter((call) => call.channel === 'autoApproval.blockedHere')).toEqual([{ channel: 'autoApproval.blockedHere', input: undefined }])
    await openMenu()
    for (const item of items()) {
      expect(item.getAttribute('aria-disabled')).toBeNull()
      expect(item.hasAttribute('data-read-only')).toBe(false)
    }
    await clickEco()
    await choose('On')
    await click(contItem())
    expect(writes()).toEqual([
      { channel: 'ecoMode.set', input: { root: ROOT, on: true, expected: FP_OFF }, machine: MACHINE },
      { channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'on' }, machine: MACHINE },
      { channel: 'autoContinue.set', input: { projectId: PROJECT, on: true }, machine: MACHINE },
    ])
    expect(slot('eco').getAttribute('data-state')).toBe('on')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('on')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
  })

  it('a change made on the Machine of the Project shows in the open menu at once (Q18); one of another Machine does not', async () => {
    onLinked()
    main = preload({ eco: [ECO_OFF], auto: ['off'], cont: [false] })
    await mount()
    await openMenu()
    // This Machine's own change of a Project of the same id is not the Linked machine's.
    main.emit('autoContinue.changed', { projectId: PROJECT, on: true })
    main.emitLinked('other', 'autoContinue.changed', { projectId: PROJECT, on: true })
    await settle()
    expect(slot('auto-continue').getAttribute('data-state')).toBe('off')
    main.emitLinked(MACHINE, 'autoContinue.changed', { projectId: PROJECT, on: true })
    main.emitLinked(MACHINE, 'autoApproval.changed', { projectId: PROJECT, state: { mode: 'shadow', saved: 'shadow', blocked: null } })
    main.emitLinked(MACHINE, 'ecoMode.changed', { root: ROOT, on: true, fingerprint: FP_ON })
    // Another Project's change is not this one's.
    main.emitLinked(MACHINE, 'ecoMode.changed', { root: '/work/other', on: false, fingerprint: FP_OFF })
    main.emitLinked(MACHINE, 'autoApproval.changed', { projectId: 'other-0000000e', state: { mode: 'off', saved: 'off', blocked: null } })
    await settle()
    expect(menu()).not.toBeNull()
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('shadow')
    expect(slot('eco').getAttribute('data-state')).toBe('on')
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
    // The next write carries the fingerprint the change brought.
    await clickEco()
    expect(writes()).toEqual([{ channel: 'ecoMode.set', input: { root: ROOT, on: false, expected: FP_ON }, machine: MACHINE }])
  })

  it('read-only access: the three states show, each item is unavailable with the read-only hint, and nothing is written', async () => {
    onLinked()
    readOnly.hint = HINT
    main = preload({ eco: [ECO_ON], auto: ['on'], cont: [true] })
    await mount()
    expect(slot('eco').getAttribute('data-state')).toBe('on')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('on')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
    expect(trigger().hasAttribute('data-read-only')).toBe(true)
    expect(trigger().getAttribute('aria-disabled')).toBeNull()
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode on, Auto-approval on, Auto-continue on')
    await openMenu()
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
    expect(position('On').getAttribute('aria-checked')).toBe('true')
    expect(contItem().getAttribute('aria-checked')).toBe('true')
    for (const item of items()) {
      expect(item.getAttribute('aria-disabled')).toBe('true')
      expect(item.title).toBe(HINT)
      expect(item.hasAttribute('data-read-only')).toBe(true)
    }
    await clickEco()
    await choose('Off')
    await click(contItem())
    expect(writes()).toEqual([])
    // A change on the Machine of the Project still shows.
    main.emitLinked(MACHINE, 'autoContinue.changed', { projectId: PROJECT, on: false })
    await settle()
    expect(slot('auto-continue').getAttribute('data-state')).toBe('off')
  })

  it('access goes read-only after the menu was drawn: a choice writes nothing (readOnlyNow)', async () => {
    onLinked()
    main = preload({ eco: [ECO_OFF], auto: ['off'], cont: [false] })
    await mount()
    await openMenu()
    const { answerReadOnly } = await import('../../src/renderer/projects/read-only-now')
    answerReadOnly(() => HINT)
    await clickEco()
    await choose('On')
    await click(contItem())
    expect(writes()).toEqual([])
  })

  it('a debugging port open on this Machine: Auto-approval is unavailable with why; Eco mode and Auto-continue still change', async () => {
    const { blockedHereTitle } = await import('../../src/renderer/session/modes/auto-approval')
    expect(blockedHereTitle(DEBUG)).toBe(`Auto-approval cannot be set from this Machine: ${DEBUG}, so any program on this Machine could set it through this window.`)
    onLinked()
    main = preload({ eco: [ECO_OFF], auto: ['on'], cont: [false], blockedHere: DEBUG })
    await mount()
    // The mode in force on the Machine of the Project shows as it is.
    expect(slot('auto-approval').getAttribute('data-state')).toBe('on')
    await openMenu()
    for (const name of ['Off', 'Shadow', 'On'] as const) {
      expect(position(name).getAttribute('aria-disabled')).toBe('true')
      expect(position(name).title).toBe(blockedHereTitle(DEBUG))
    }
    await choose('Off')
    expect(ecoItem().getAttribute('aria-disabled')).toBeNull()
    expect(contItem().getAttribute('aria-disabled')).toBeNull()
    await click(contItem())
    expect(writes()).toEqual([{ channel: 'autoContinue.set', input: { projectId: PROJECT, on: true }, machine: MACHINE }])
  })

  it('asking this Machine why it would hold Auto-approval back fails: the group stays available, and the choice goes through the link, which checks on its own', async () => {
    onLinked()
    main = preload({ auto: ['off'], blockedHereFails: 'autoApproval.blockedHere failed: no answer' })
    await mount()
    await openMenu()
    for (const name of ['Off', 'Shadow', 'On'] as const) {
      expect(position(name).getAttribute('aria-disabled')).toBeNull()
      expect(position(name).title).not.toMatch(/cannot be set from this Machine/)
    }
    await choose('On')
    expect(writes()).toEqual([{ channel: 'autoApproval.set', input: { projectId: PROJECT, mode: 'on' }, machine: MACHINE }])
  })

  it('a window on this Machine does not ask why this Machine would hold Auto-approval back: the read says it', async () => {
    main = preload({ blockedHere: DEBUG })
    await mount()
    expect(main.calls.filter((call) => call.channel === 'autoApproval.blockedHere')).toEqual([])
    await openMenu()
    expect(position('On').getAttribute('aria-disabled')).toBeNull()
  })

  it('a write through the link without an answer: a toast with the reason, then what the Machine of the Project reads', async () => {
    onLinked()
    main = preload({ cont: [false, true], contSet: 'autoContinue.set: studio is unreachable' })
    await mount()
    await openMenu()
    await click(contItem())
    expect(await shownToasts()).toEqual([{ kind: 'error', text: 'Auto-continue was not turned on: studio is unreachable' }])
    // The write had gone through there: the read again shows it.
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
    expect(main.calls.filter((call) => call.channel === 'autoContinue.read')).toHaveLength(2)
  })

  it('while the read after a lost answer runs, no item shows what it showed before the write', async () => {
    onLinked()
    main = preload({
      eco: [ECO_OFF],
      ecoSet: 'ecoMode.set: studio is unreachable',
      auto: ['off'],
      autoSet: 'autoApproval.set: studio is unreachable',
      cont: [false],
      contSet: 'autoContinue.set: studio is unreachable',
    })
    await mount()
    // From now on no read answers.
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const invoke = bridge.invoke
    bridge.invoke = (channel, input) => {
      const inner = channel === 'linked.invoke' ? (input as { channel: string }).channel : channel
      return inner.endsWith('.read') ? new Promise(() => undefined) : invoke(channel, input)
    }
    await clickEco()
    await choose('On')
    await click(contItem())
    expect(slot('eco').getAttribute('data-state')).toBe('unknown')
    expect(slot('auto-approval').getAttribute('data-state')).toBe('unknown')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('unknown')
    expect(position('Off').getAttribute('aria-checked')).toBe('false')
    expect(ecoItem().getAttribute('aria-disabled')).toBe('true')
    expect(contItem().getAttribute('aria-disabled')).toBe('true')
  })

  it('the read after a lost answer fails too: the item is unavailable with why and shows no guess', async () => {
    onLinked()
    main = preload({ auto: ['off', 'autoApproval.read: studio is unreachable'], autoSet: 'autoApproval.set: studio is unreachable' })
    await mount()
    await choose('On')
    expect(await shownToasts()).toEqual([{ kind: 'error', text: 'Auto-approval was not set to On: studio is unreachable' }])
    expect(slot('auto-approval').getAttribute('data-state')).toBe('unknown')
    expect(position('Off').getAttribute('aria-checked')).toBe('false')
    expect(position('On').title).toBe('Auto-approval is not available: studio is unreachable')
  })
})

describe('Auto-continue in the menu', () => {
  it('off by default: the third item, a checkbox after Auto-approval, with the tooltip of the spec; the icon muted', async () => {
    const { AUTO_CONTINUE_TITLE } = await import('../../src/renderer/session/modes/auto-continue')
    expect(AUTO_CONTINUE_TITLE).toBe(
      'Auto-continue: after a temporary API error (500, 529, connection lost) worfy sends the Orchestrator "continue" up to 5 times with growing pauses; after the Limits refuse, it waits for the reset and continues. Never resends your message or the Wave command.',
    )
    main = preload()
    await mount()
    expect(contCalls()).toEqual([{ channel: 'autoContinue.read', input: { projectId: PROJECT } }])
    expect(slot('auto-continue').getAttribute('data-state')).toBe('off')
    await openMenu()
    expect(items().at(-1)).toBe(contItem())
    // After a line of its own, below the group of Auto-approval.
    expect(contItem().previousElementSibling?.getAttribute('role')).toBe('separator')
    expect(contItem().previousElementSibling?.previousElementSibling).toBe(group())
    // The key the stylesheet colours a checked item by (session.css, the green of Eco mode).
    expect(contItem().getAttribute('data-item')).toBe('auto-continue')
    expect(contItem().querySelector('.w-modes__item-label')?.textContent).toBe('Auto-continue')
    expect(contItem().querySelector('.w-modes__item-detail')?.textContent).toBe('Retry after API errors and Limits')
    expect(contItem().getAttribute('aria-checked')).toBe('false')
    expect(contItem().getAttribute('aria-disabled')).toBeNull()
    expect(marked(contItem())).toBe(false)
    expect(contItem().title).toBe(AUTO_CONTINUE_TITLE)
    expect(contItem().textContent).toContain('Auto-continue')
  })

  it('the stylesheet draws a checked Auto-continue in the green of Eco mode, by its data-item key', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/session/session.css'), 'utf8')
    const checked = [...css.matchAll(/^\.w-modes__item\[aria-checked='true'\]:is\(([^)]*)\)/gmu)].map((match) => match[1])
    expect(checked.length).toBeGreaterThan(0)
    for (const keys of checked) expect(keys).toContain("[data-item='auto-continue']")
  })

  it('a subscription to changes is held while the button shows, and dropped with it', async () => {
    main = preload()
    await mount()
    expect(main.listening('autoContinue.changed')).toBe(1)
    cleanup()
    expect(main.listening('autoContinue.changed')).toBe(0)
  })

  it('a choice writes on through main and shows it, the menu staying open; another writes off', async () => {
    main = preload()
    await mount()
    await openMenu()
    await click(contItem())
    expect(contCalls()).toEqual([
      { channel: 'autoContinue.read', input: { projectId: PROJECT } },
      { channel: 'autoContinue.set', input: { projectId: PROJECT, on: true } },
    ])
    expect(contItem().getAttribute('aria-checked')).toBe('true')
    expect(marked(contItem())).toBe(true)
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode off, Auto-approval off, Auto-continue on')
    expect(menu()).not.toBeNull()
    await click(contItem())
    expect(contCalls().at(-1)).toEqual({ channel: 'autoContinue.set', input: { projectId: PROJECT, on: false } })
    expect(slot('auto-continue').getAttribute('data-state')).toBe('off')
    expect(await shownToasts()).toEqual([])
  })

  it('shows on what main reads as on', async () => {
    main = preload({ cont: [true] })
    await mount()
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
    await openMenu()
    expect(contItem().getAttribute('aria-checked')).toBe('true')
  })

  it('shows the value being written at once, busy until main answers; another choice meanwhile writes nothing', async () => {
    main = preload({ contHold: true })
    await mount()
    await openMenu()
    await click(contItem())
    expect(contItem().getAttribute('aria-checked')).toBe('true')
    expect(contItem().getAttribute('aria-busy')).toBe('true')
    expect(trigger().getAttribute('aria-busy')).toBe('true')
    await click(contItem())
    expect(contCalls().filter((call) => call.channel === 'autoContinue.set')).toHaveLength(1)
    await act(async () => {
      main.contHold?.()
    })
    await settle()
    expect(contItem().getAttribute('aria-busy')).toBeNull()
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
  })

  it('a write that failed: a toast with the reason, and the item shows the setting read again', async () => {
    main = preload({ cont: [false, false], contSet: 'autoContinue.set failed: disk full' })
    await mount()
    await openMenu()
    await click(contItem())
    expect(await shownToasts()).toEqual([{ kind: 'error', text: 'Auto-continue was not turned on: disk full' }])
    expect(contCalls().map((call) => call.channel)).toEqual(['autoContinue.read', 'autoContinue.set', 'autoContinue.read'])
    expect(contItem().getAttribute('aria-checked')).toBe('false')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('off')
  })

  it('a read that failed: unavailable, saying why; a choice writes nothing; the other items still work', async () => {
    main = preload({ cont: ['autoContinue.read failed: no such Project'] })
    await mount()
    expect(slot('auto-continue').getAttribute('data-state')).toBe('unknown')
    expect(trigger().getAttribute('aria-label')).toBe('Modes: Eco mode off, Auto-approval off, Auto-continue not available')
    await openMenu()
    expect(contItem().getAttribute('aria-disabled')).toBe('true')
    expect(contItem().title).toBe('Auto-continue is not available: no such Project')
    await click(contItem())
    expect(contCalls().map((call) => call.channel)).toEqual(['autoContinue.read'])
    await clickEco()
    expect(ecoItem().getAttribute('aria-checked')).toBe('true')
  })

  it('a change made in another window shows at once in the open menu; a change of another Project does not', async () => {
    main = preload()
    await mount()
    await openMenu()
    await act(async () => {
      main.emit('autoContinue.changed', { projectId: 'other-0000000e', on: true })
    })
    expect(contItem().getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      main.emit('autoContinue.changed', { projectId: PROJECT, on: true })
    })
    expect(contItem().getAttribute('aria-checked')).toBe('true')
    expect(slot('auto-continue').getAttribute('data-state')).toBe('on')
    expect(contCalls().map((call) => call.channel)).toEqual(['autoContinue.read'])
  })

  it('a Session that is not the Orchestrator asks nothing of Auto-continue', async () => {
    main = preload()
    await mount('another-session')
    expect(contCalls()).toEqual([])
  })
})
