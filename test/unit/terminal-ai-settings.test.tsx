// Settings → Terminal AI (src/renderer/settings/TerminalAiSection.tsx), over the real renderer IPC
// client and a fake preload of this Machine: the switches show what `terminalAi.state` answers, a
// click asks `terminalAi.setSettings` for the one field it changes, `terminalAi.changed` redraws
// the section, the switches under a switch that is off take no click and say why, and a feature
// the Limits stopped says until when.
// jsdom draws nothing: the look in both themes, the contrast and the keys are checked against the
// built app (test/e2e/terminal-ai-settings.spec.ts).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { TerminalAiFeatureState, TerminalAiState } from '../../src/shared/ipc/terminal-ai'
import { DEFAULT_TERMINAL_AI_SETTINGS, type TerminalAiFeature, type TerminalAiSettings } from '../../src/shared/terminal-ai/settings'
import TerminalAiSection, { TerminalAiSectionView } from '../../src/renderer/settings/TerminalAiSection'
import { settingsSections } from '../../src/renderer/settings/sections'

const ON: TerminalAiFeatureState = { state: 'on' }
const OFF: TerminalAiFeatureState = { state: 'off' }

/** A state as main answers it: the settings, and every feature on unless `features` says otherwise. */
const stateOf = (settings: Partial<TerminalAiSettings> = {}, features: Partial<Record<TerminalAiFeature, TerminalAiFeatureState>> = {}): TerminalAiState => ({
  settings: { ...DEFAULT_TERMINAL_AI_SETTINGS, ...settings },
  features: { suggest: ON, next: ON, request: ON, fix: ON, ...features },
  process: 'idle',
})

interface Call {
  channel: string
  input: unknown
  answer: (result: IpcResult<unknown>) => void
}

interface FakeMain {
  /** Every call of a channel, oldest first, with the way to answer it. */
  calls: Call[]
  /** Fires `terminalAi.changed`, as main does after any change. */
  changed: (state: TerminalAiState) => void
  /** How many handlers listen to `terminalAi.changed` now. */
  listeners: () => number
}

/** This Machine's preload: every call waits in `calls` until the test answers it. */
function preload(): FakeMain {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 0
  const main: FakeMain = {
    calls: [],
    changed: (state) => {
      for (const { channel, handler } of handlers.values()) if (channel === 'terminalAi.changed') handler(state)
    },
    listeners: () => [...handlers.values()].filter(({ channel }) => channel === 'terminalAi.changed').length,
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => new Promise((resolve) => main.calls.push({ channel, input, answer: resolve })),
    on: (channel, handler) => {
      handlers.set(++next, { channel, handler })
      return next
    },
    off: (subscription) => {
      handlers.delete(subscription)
    },
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Answers a call and lets the answer reach the section. */
const answer = (call: Call | undefined, result: IpcResult<unknown>) =>
  act(async () => {
    if (call === undefined) throw new Error('no such call')
    call.answer(result)
  })

const callsOf = (main: FakeMain, channel: string): Call[] => main.calls.filter((call) => call.channel === channel)

/** The section over a fake main that has answered `terminalAi.state` with `state`. */
async function mount(state: TerminalAiState) {
  const main = preload()
  const view = render(<TerminalAiSection />)
  await answer(callsOf(main, 'terminalAi.state')[0], { ok: true, value: state })
  return { main, view }
}

const toggle = (name: string): HTMLElement => screen.getByRole('switch', { name })
const checked = (name: string): string | null => toggle(name).getAttribute('aria-checked')
const model = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: 'Next command model' })

const SWITCHES: [name: string, field: keyof TerminalAiSettings][] = [
  ['Terminal AI', 'enabled'],
  ['Suggestion', 'suggestion'],
  ['Ask Claude when history has nothing', 'suggestionAsksModel'],
  ['Next command', 'nextCommand'],
  ['Command request', 'commandRequest'],
  ['Fix', 'fix'],
]

describe('Settings → Terminal AI', () => {
  it('is a section of the Settings window, after Machines', () => {
    const section = settingsSections.find(({ id }) => id === 'TerminalAiSection')
    expect(section).toMatchObject({ title: 'Terminal AI', order: 50 })
    // Right after Machines; the sections of later Epics (Sessions, order 60) may follow it.
    const titles = settingsSections.map(({ title }) => title)
    expect(titles.slice(titles.indexOf('Machines'), titles.indexOf('Machines') + 2)).toEqual(['Machines', 'Terminal AI'])
  })

  it('shows the values of terminalAi.state on the switches and on the model of Next command', async () => {
    const { main } = await mount(stateOf({ suggestionAsksModel: false, nextCommandModel: 'haiku', fix: false }, { suggest: OFF, fix: OFF }))

    expect(callsOf(main, 'terminalAi.state')).toHaveLength(1)
    expect(SWITCHES.map(([name]) => [name, checked(name)])).toEqual([
      ['Terminal AI', 'true'],
      ['Suggestion', 'true'],
      ['Ask Claude when history has nothing', 'false'],
      ['Next command', 'true'],
      ['Command request', 'true'],
      ['Fix', 'false'],
    ])
    expect(model().textContent).toBe('Haiku')
    for (const [name] of SWITCHES) expect(toggle(name)).toHaveProperty('disabled', false)
    expect(model().disabled).toBe(false)
    // Nothing is paused and nothing is held off by another switch.
    expect(screen.queryByText(/Paused by Limits/)).toBeNull()
    expect(screen.queryByText(/^Off while /)).toBeNull()
    expect(screen.getByTestId('terminal-ai-zsh').textContent).toBe('Works in zsh Terminals.')
  })

  it('shows everything on and Sonnet for the defaults', async () => {
    await mount(stateOf())
    expect(SWITCHES.map(([name]) => checked(name))).toEqual(['true', 'true', 'true', 'true', 'true', 'true'])
    expect(model().textContent).toBe('Sonnet')
  })

  it('draws nothing until main has answered, and asks for nothing more', () => {
    const main = preload()
    render(<TerminalAiSection />)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(main.calls.map((call) => call.channel)).toEqual(['terminalAi.state'])
  })

  it.each(SWITCHES)('a click on "%s" asks terminalAi.setSettings for that one field', async (name, field) => {
    const { main } = await mount(stateOf())

    fireEvent.click(toggle(name))
    expect(callsOf(main, 'terminalAi.setSettings').map((call) => call.input)).toEqual([{ [field]: false }])
    // The switch moves when main has answered with the new state, not before.
    expect(checked(name)).toBe('true')
    await answer(callsOf(main, 'terminalAi.setSettings')[0], { ok: true, value: stateOf({ [field]: false }) })
    expect(checked(name)).toBe('false')

    fireEvent.click(toggle(name))
    expect(callsOf(main, 'terminalAi.setSettings').map((call) => call.input)).toEqual([{ [field]: false }, { [field]: true }])
  })

  it('choosing a model asks terminalAi.setSettings for the model alone', async () => {
    const { main } = await mount(stateOf())

    fireEvent.click(model())
    const options = within(screen.getByRole('listbox', { name: 'Next command model' })).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Sonnet', 'Haiku'])
    fireEvent.click(options[1] as HTMLElement)
    expect(callsOf(main, 'terminalAi.setSettings').map((call) => call.input)).toEqual([{ nextCommandModel: 'haiku' }])

    await answer(callsOf(main, 'terminalAi.setSettings')[0], { ok: true, value: stateOf({ nextCommandModel: 'haiku' }) })
    expect(model().textContent).toBe('Haiku')
  })

  it('with Terminal AI off, everything under it takes no click and says why', async () => {
    const { main } = await mount(stateOf({ enabled: false }, { suggest: OFF, next: OFF, request: OFF, fix: OFF }))

    expect(toggle('Terminal AI')).toHaveProperty('disabled', false)
    expect(checked('Terminal AI')).toBe('false')
    for (const [name] of SWITCHES.slice(1)) {
      expect(toggle(name)).toHaveProperty('disabled', true)
      // What was chosen under it is kept and still shown.
      expect(checked(name)).toBe('true')
      fireEvent.click(toggle(name))
    }
    expect(model().disabled).toBe(true)
    expect(callsOf(main, 'terminalAi.setSettings')).toEqual([])
    // Not by the dimmed switch alone: every row under it says it in words.
    for (const row of ['suggestion', 'suggestion-model', 'next', 'next-model', 'request', 'fix']) {
      expect(screen.getByTestId(`terminal-ai-${row}-note`).textContent).toBe('Off while Terminal AI is off.')
    }

    fireEvent.click(toggle('Terminal AI'))
    expect(callsOf(main, 'terminalAi.setSettings').map((call) => call.input)).toEqual([{ enabled: true }])
  })

  it('with Terminal AI off, a row names Terminal AI even when its own switch is off too', async () => {
    await mount(stateOf({ enabled: false, suggestion: false, nextCommand: false }, { suggest: OFF, next: OFF, request: OFF, fix: OFF }))
    expect(screen.getByTestId('terminal-ai-suggestion-model-note').textContent).toBe('Off while Terminal AI is off.')
    expect(screen.getByTestId('terminal-ai-next-model-note').textContent).toBe('Off while Terminal AI is off.')
  })

  it('with Suggestion off, only "Ask Claude when history has nothing" is held off', async () => {
    await mount(stateOf({ suggestion: false }, { suggest: OFF }))

    expect(toggle('Ask Claude when history has nothing')).toHaveProperty('disabled', true)
    expect(screen.getByTestId('terminal-ai-suggestion-model-note').textContent).toBe('Off while Suggestion is off.')
    for (const name of ['Terminal AI', 'Suggestion', 'Next command', 'Command request', 'Fix']) expect(toggle(name)).toHaveProperty('disabled', false)
    expect(model().disabled).toBe(false)
    expect(screen.getAllByText(/^Off while /)).toHaveLength(1)
  })

  it('with Next command off, only its model is held off', async () => {
    await mount(stateOf({ nextCommand: false }, { next: OFF }))

    expect(model().disabled).toBe(true)
    expect(screen.getByTestId('terminal-ai-next-model-note').textContent).toBe('Off while Next command is off.')
    for (const [name] of SWITCHES) expect(toggle(name)).toHaveProperty('disabled', false)
    expect(screen.getAllByText(/^Off while /)).toHaveLength(1)
  })

  it('redraws on terminalAi.changed, and stops listening when it is gone', async () => {
    const { main, view } = await mount(stateOf())
    expect(main.listeners()).toBe(1)

    act(() => main.changed(stateOf({ enabled: false, nextCommandModel: 'haiku' }, { suggest: OFF, next: OFF, request: OFF, fix: OFF })))
    expect(checked('Terminal AI')).toBe('false')
    expect(model().textContent).toBe('Haiku')
    expect(toggle('Fix')).toHaveProperty('disabled', true)

    view.unmount()
    expect(main.listeners()).toBe(0)
  })

  it('keeps a change that came before the first answer: the answer is the older of the two', async () => {
    const main = preload()
    render(<TerminalAiSection />)
    act(() => main.changed(stateOf({ fix: false }, { fix: OFF })))
    expect(checked('Fix')).toBe('false')

    await answer(callsOf(main, 'terminalAi.state')[0], { ok: true, value: stateOf() })
    expect(checked('Fix')).toBe('false')
  })

  it('says why a change was not saved, and leaves the switch as main has it', async () => {
    const { main } = await mount(stateOf())

    fireEvent.click(toggle('Fix'))
    await answer(callsOf(main, 'terminalAi.setSettings')[0], { ok: false, error: 'terminalAi.setSettings failed: the disk is full' })
    expect(checked('Fix')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Not saved: the disk is full')

    // The next change that is saved takes the message away.
    fireEvent.click(toggle('Fix'))
    await answer(callsOf(main, 'terminalAi.setSettings')[1], { ok: true, value: stateOf({ fix: false }, { fix: OFF }) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(checked('Fix')).toBe('false')
  })

  it('the last click decides the message when answers come back out of order', async () => {
    const { main } = await mount(stateOf())

    fireEvent.click(toggle('Fix'))
    fireEvent.click(toggle('Command request'))
    const [first, second] = callsOf(main, 'terminalAi.setSettings')
    await answer(second, { ok: true, value: stateOf({ commandRequest: false }, { request: OFF }) })
    await answer(first, { ok: false, error: 'terminalAi.setSettings failed: the disk is full' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so when main cannot give the state', async () => {
    const main = preload()
    render(<TerminalAiSection />)
    await answer(callsOf(main, 'terminalAi.state')[0], { ok: false, error: 'terminalAi.state failed: no settings file' })

    expect(screen.getByRole('alert').textContent).toBe('Terminal AI settings are unavailable: no settings file')
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('does not go back to the answer of a change when a newer state came meanwhile', async () => {
    const { main } = await mount(stateOf())

    fireEvent.click(toggle('Fix'))
    // Main changed Fix and then, say from another window, the model; the answer of the click carries only the first.
    act(() => main.changed(stateOf({ fix: false, nextCommandModel: 'haiku' }, { fix: OFF })))
    await answer(callsOf(main, 'terminalAi.setSettings')[0], { ok: true, value: stateOf({ fix: false }, { fix: OFF }) })
    expect(model().textContent).toBe('Haiku')
    expect(checked('Fix')).toBe('false')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still shows the state and takes answers when it cannot subscribe to the changes', async () => {
    const main = preload()
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy as WorfyBridge
    bridge.on = () => {
      throw new Error('no events')
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<TerminalAiSection />)
    await answer(callsOf(main, 'terminalAi.state')[0], { ok: true, value: stateOf() })
    expect(errors).toHaveBeenCalledWith('terminalAi.changed: cannot subscribe', expect.any(Error))

    fireEvent.click(toggle('Fix'))
    await answer(callsOf(main, 'terminalAi.setSettings')[0], { ok: true, value: stateOf({ fix: false }, { fix: OFF }) })
    expect(checked('Fix')).toBe('false')
  })
})

// 14:20 UTC on Wed 2026-10-14, and 09:00 UTC on Thu 2026-10-15.
const NOW = Date.UTC(2026, 9, 14, 12, 0)
const TODAY = Date.UTC(2026, 9, 14, 14, 20)
const TOMORROW = Date.UTC(2026, 9, 15, 9, 0)

describe('a feature the Limits stopped', () => {
  const paused = (until: number, window = 'five_hour'): TerminalAiFeatureState => ({ state: 'paused', until, window })
  const status = (row: string): string | undefined => screen.queryByTestId(`terminal-ai-${row}-status`)?.textContent ?? undefined

  it('says until when, on the row of that feature only', () => {
    render(<TerminalAiSectionView state={stateOf({}, { suggest: paused(TODAY), next: paused(TODAY) })} onChange={() => undefined} now={NOW} timeZone="UTC" />)

    expect(status('suggestion-model')).toBe('Paused by Limits until 14:20')
    expect(status('next')).toBe('Paused by Limits until 14:20')
    expect(status('request')).toBeUndefined()
    expect(status('fix')).toBeUndefined()
    expect(screen.getAllByText(/Paused by Limits/)).toHaveLength(2)
    // The switch stays as the user set it and can still be turned off.
    expect(checked('Next command')).toBe('true')
    expect(toggle('Next command')).toHaveProperty('disabled', false)
  })

  it('says it for Command request and Fix too', () => {
    render(<TerminalAiSectionView state={stateOf({}, { suggest: paused(TODAY), next: paused(TODAY), request: paused(TODAY), fix: paused(TODAY) })} onChange={() => undefined} now={NOW} timeZone="UTC" />)
    expect(['suggestion-model', 'next', 'request', 'fix'].map(status)).toEqual(Array(4).fill('Paused by Limits until 14:20'))
  })

  it('shows the time in the time zone it is given', () => {
    render(<TerminalAiSectionView state={stateOf({}, { fix: paused(TODAY) })} onChange={() => undefined} now={NOW} timeZone="Europe/Kyiv" />)
    expect(status('fix')).toBe('Paused by Limits until 17:20')
  })

  it('names the day when the pause lifts on another day', () => {
    render(<TerminalAiSectionView state={stateOf({}, { fix: paused(TOMORROW, 'seven_day') })} onChange={() => undefined} now={NOW} timeZone="UTC" />)
    expect(status('fix')).toBe('Paused by Limits until Thu 09:00')
  })

  it('is a status a screen reader hears', () => {
    render(<TerminalAiSectionView state={stateOf({}, { next: paused(TODAY) })} onChange={() => undefined} now={NOW} timeZone="UTC" />)
    expect(screen.getByRole('status').textContent).toBe('Paused by Limits until 14:20')
  })

  it('goes away when main says the feature is on again', async () => {
    // The mounted section reads the real clock in the local time zone. Midday local, so a pause an
    // hour away lifts the same day whatever the hour and the time zone of the run; only Date is
    // faked, the promises of the fake main still settle.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0))
    const { main } = await mount(stateOf({}, { next: paused(Date.now() + 60 * 60 * 1000) }))
    expect(status('next')).toBe('Paused by Limits until 13:00')

    act(() => main.changed(stateOf()))
    expect(status('next')).toBeUndefined()
  })
})
