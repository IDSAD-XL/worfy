// Settings → Sessions (src/renderer/settings/SessionsSection.tsx, worfy-polish ticket 24): the
// autocompact window of the Orchestrator and of the other Sessions, over the real renderer IPC
// client and a fake preload of this Machine. The field takes thousands of tokens and keeps them in
// 100K–1M on a step of 10K; "Claude Code default" passes null; a line names
// CLAUDE_CODE_AUTO_COMPACT_WINDOW when the shell sets it. Under each role a line names where the
// window comes from (worfy-polish ticket 29): the person's own value, "Claude Code default", the
// user's ~/.claude/settings.json, or worfy's default. What reaches Claude Code is checked in
// test/contract/agent-autocompact.test.ts.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const settings = (revision: number, autoCompactWindow: AppSettings['autoCompactWindow'] = { orchestrator: 400_000, other: 500_000 }): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow,
  revision,
})

interface FakeMain {
  /** Every `appSettings.set`, oldest first, with the way to answer it. */
  sets: { input: unknown; answer: (result: IpcResult<unknown>) => void }[]
}

/**
 * This Machine's preload: `appSettings.get` answers `state`, `sessionAutocompact.shellOverride`
 * answers `shell`; `sessionAutocompact.userSettings` answers `userWindow`, or is refused when it is
 * undefined, as by a main that has no such channel.
 */
function preload(state: AppSettings, shell: string | null = null, userWindow?: number | null): FakeMain {
  const main: FakeMain = { sets: [] }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: state } as never)
      if (channel === 'sessionAutocompact.shellOverride') return Promise.resolve({ ok: true, value: { value: shell } } as never)
      if (channel === 'sessionAutocompact.userSettings' && userWindow !== undefined) return Promise.resolve({ ok: true, value: { value: userWindow } } as never)
      if (channel === 'appSettings.set') return new Promise((resolve) => main.sets.push({ input, answer: resolve as (result: IpcResult<unknown>) => void }))
      return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

beforeEach(() => {
  // useAppSettings keeps its state in a module: every test starts with a fresh one.
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** The section over a fake main that answers `appSettings.get` with `state` and has no window in the shell. */
async function mount(state: AppSettings) {
  const main = preload(state)
  const section = await import('../../src/renderer/settings/SessionsSection')
  const view = render(<section.default />)
  return { main, view }
}

const field = (role: 'orchestrator' | 'other'): HTMLInputElement => screen.getByTestId<HTMLInputElement>(`settings-autocompact-${role}`)
const mode = (label: string): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: `${label} autocompact window` })

/** Types `text` into a field and commits it the way a person does: Enter, or leaving the field. */
function type(role: 'orchestrator' | 'other', text: string, how: 'enter' | 'blur' = 'enter'): void {
  const input = field(role)
  fireEvent.change(input, { target: { value: text } })
  if (how === 'enter') fireEvent.keyDown(input, { key: 'Enter' })
  else fireEvent.blur(input)
}

function choose(label: string, option: string): void {
  fireEvent.click(mode(label))
  const listbox = screen.getByRole('listbox', { name: `${label} autocompact window` })
  fireEvent.click(within(listbox).getByRole('option', { name: option }))
}

describe('Settings → Sessions', () => {
  it('is a section of its own, after Terminal AI', async () => {
    const section = await import('../../src/renderer/settings/SessionsSection')
    expect(section.title).toBe('Sessions')
    expect(section.order).toBeGreaterThan(50)
  })

  it('shows both windows in thousands of tokens, the hints, and no line about the shell when it sets nothing', async () => {
    await mount(settings(1, { orchestrator: 300_000, other: 700_000 }))
    await waitFor(() => expect(field('orchestrator').value).toBe('300'))
    expect(field('other').value).toBe('700')
    expect(mode('Orchestrator').textContent).toContain('Custom')
    expect(mode('Other Sessions').textContent).toContain('Custom')
    expect(screen.getByTestId('settings-autocompact-hint').textContent).toBe('Autocompact runs a little below this: Claude Code keeps room for the summary.')
    expect(screen.getByTestId('settings-autocompact-orchestrator-row').textContent).toContain('Applies after restarting the Session.')
    expect(screen.getByTestId('settings-autocompact-other-row').textContent).toContain('Applies after restarting the Session.')
    expect(screen.queryByTestId('settings-autocompact-shell-override')).toBeNull()
  })

  it('a typed window goes to main for its role alone, in tokens', async () => {
    const { main } = await mount(settings(1))
    await waitFor(() => expect(field('orchestrator').value).toBe('400'))
    type('orchestrator', '450')
    expect(main.sets.map((each) => each.input)).toEqual([{ autoCompactWindow: { orchestrator: 450_000 } }])
    type('other', '650', 'blur')
    expect(main.sets.map((each) => each.input)).toEqual([{ autoCompactWindow: { orchestrator: 450_000 } }, { autoCompactWindow: { other: 650_000 } }])
  })

  it('keeps the window in 100K–1M on a step of 10K; text that is no number asks for nothing and shows the window again', async () => {
    const { main } = await mount(settings(1))
    await waitFor(() => expect(field('other').value).toBe('500'))
    type('other', '50')
    type('other', '1500')
    type('other', '455')
    expect(main.sets.map((each) => each.input)).toEqual([
      { autoCompactWindow: { other: 100_000 } },
      { autoCompactWindow: { other: 1_000_000 } },
      { autoCompactWindow: { other: 460_000 } },
    ])
    type('other', '')
    type('other', 'abc')
    // The same window as in force asks for nothing either.
    type('other', '500')
    expect(main.sets).toHaveLength(3)
    expect(field('other').value).toBe('500')
    expect(field('other')).toMatchObject({ min: '100', max: '1000', step: '10' })
  })

  it('"Claude Code default" asks for null and hides the field; "Custom" asks for the role\'s own default', async () => {
    const { main } = await mount(settings(1, { orchestrator: 300_000, other: null }))
    await waitFor(() => expect(field('orchestrator').value).toBe('300'))
    expect(screen.queryByTestId('settings-autocompact-other')).toBeNull()
    expect(mode('Other Sessions').textContent).toContain('Claude Code default')

    choose('Orchestrator', 'Claude Code default')
    choose('Other Sessions', 'Custom')
    expect(main.sets.map((each) => each.input)).toEqual([{ autoCompactWindow: { orchestrator: null } }, { autoCompactWindow: { other: 500_000 } }])

    await act(async () => main.sets[1]!.answer({ ok: true, value: settings(3, { orchestrator: null, other: 500_000 }) }))
    expect(field('other').value).toBe('500')
    expect(screen.queryByTestId('settings-autocompact-orchestrator')).toBeNull()
  })

  it('says when the shell sets CLAUDE_CODE_AUTO_COMPACT_WINDOW, with its value', async () => {
    preload(settings(1), '300000')
    const section = await import('../../src/renderer/settings/SessionsSection')
    render(<section.default />)
    const line = await screen.findByTestId('settings-autocompact-shell-override')
    expect(line.textContent).toBe('Overridden by CLAUDE_CODE_AUTO_COMPACT_WINDOW in your shell (300000).')
    expect(line.getAttribute('role')).toBe('note')
  })

  it('a change main refused says why, in place of the restart hint', async () => {
    const { main } = await mount(settings(1))
    await waitFor(() => expect(field('orchestrator').value).toBe('400'))
    type('orchestrator', '450')
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'disk full' }))
    expect(screen.getByTestId('settings-autocompact-orchestrator-problem').textContent).toBe('Not saved: disk full')
    expect(screen.getByTestId('settings-autocompact-orchestrator-row').textContent).not.toContain('Applies after restarting the Session.')
    // The field shows the window in force again.
    expect(field('orchestrator').value).toBe('400')
  })

  describe('where each window comes from', () => {
    const source = (role: 'orchestrator' | 'other'): string | null => screen.getByTestId(`settings-autocompact-${role}-source`).textContent

    async function mountWith(state: AppSettings, userWindow: number | null): Promise<FakeMain> {
      const main = preload(state, null, userWindow)
      const section = await import('../../src/renderer/settings/SessionsSection')
      render(<section.default />)
      return main
    }

    it('a window in ~/.claude/settings.json and nothing chosen in worfy: "From ~/.claude/settings.json", shown as "Claude Code default" with no field', async () => {
      await mountWith(settings(1), 300_000)
      await waitFor(() => expect(source('orchestrator')).toBe('From ~/.claude/settings.json (300K)'))
      expect(source('other')).toBe('From ~/.claude/settings.json (300K)')
      expect(mode('Orchestrator').textContent).toContain('Claude Code default')
      expect(screen.queryByTestId('settings-autocompact-orchestrator')).toBeNull()
      expect(screen.queryByTestId('settings-autocompact-other')).toBeNull()
    })

    it('no window there and nothing chosen: "worfy default" with its value, in the field too', async () => {
      await mountWith(settings(1), null)
      await waitFor(() => expect(source('orchestrator')).toBe('worfy default (400K)'))
      expect(source('other')).toBe('worfy default (500K)')
      expect(field('orchestrator').value).toBe('400')
      expect(mode('Orchestrator').textContent).toContain('Custom')
    })

    it('a window the person chose wins over settings.json: their own value, or "Claude Code default"', async () => {
      await mountWith(settings(1, { orchestrator: 450_000, other: null }), 300_000)
      await waitFor(() => expect(source('orchestrator')).toBe('Custom (450K)'))
      expect(source('other')).toBe('Claude Code default')
      expect(field('orchestrator').value).toBe('450')
    })

    it('"Custom" at worfy\'s default value, marked chosen, stays "Custom" over settings.json', async () => {
      await mountWith({ ...settings(1), autoCompactWindowChosen: { orchestrator: true, other: false } }, 300_000)
      await waitFor(() => expect(source('orchestrator')).toBe('Custom (400K)'))
      expect(source('other')).toBe('From ~/.claude/settings.json (300K)')
    })

    it('"Custom" chosen over a window of settings.json asks for the role\'s worfy default, and the line follows the answer', async () => {
      const main = await mountWith(settings(1), 300_000)
      await waitFor(() => expect(source('other')).toBe('From ~/.claude/settings.json (300K)'))
      choose('Other Sessions', 'Custom')
      expect(main.sets.map((each) => each.input)).toEqual([{ autoCompactWindow: { other: 500_000 } }])
      await act(async () => main.sets[0]!.answer({ ok: true, value: { ...settings(2), autoCompactWindowChosen: { orchestrator: false, other: true } } }))
      expect(source('other')).toBe('Custom (500K)')
      expect(field('other').value).toBe('500')
    })
  })
})
