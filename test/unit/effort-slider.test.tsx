// The effort picker of the composer (src/renderer/session/composer/Pickers.tsx): a button "Effort
// <level>" that opens a popover with a slider. Its marks are "default" and the levels of the picked
// model; one value goes to agent.configure — when the popover closes, or 600 ms after the thumb
// last moved. main is replaced by a bridge that records what it was asked.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { EffortChoice, SessionSettings } from '../../src/shared/agent/settings'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

type Model = { value: string | null; displayName: string; efforts: EffortChoice[] }

const DEFAULTS: SessionSettings = { model: null, effort: null, permissionMode: 'bypassPermissions' }
const ALL: EffortChoice[] = ['low', 'medium', 'high', 'xhigh', 'max']
const MODELS: Model[] = [
  { value: null, displayName: 'Default (recommended)', efforts: ALL },
  { value: 'sonnet', displayName: 'Sonnet', efforts: ['low', 'high'] },
  { value: 'opus', displayName: 'Opus', efforts: ['medium', 'high', 'xhigh'] },
  { value: 'haiku', displayName: 'Haiku', efforts: [] },
]

const asked: { channel: string; input: unknown }[] = []
const handlers = new Map<string, (payload: unknown) => void>()
let answers: Record<string, (input: unknown) => unknown>

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  handlers.clear()
  answers = {}
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer(input) } : { ok: false, error: `no ${channel}` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, handler)
      return handlers.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const emit = (sessionId: string, event: AgentEvent) => act(() => handlers.get('agent.event')?.({ sessionId, event }))
/** What agent.configure was asked, in order. */
const configured = (): unknown[] => asked.filter((each) => each.channel === 'agent.configure').map((each) => each.input)
const sent = (change: object, sessionId = 's'): { sessionId: string; change: object } => ({ sessionId, change })

const button = (): HTMLButtonElement => screen.getByTestId<HTMLButtonElement>('picker-effort')
const popover = (): HTMLElement | null => screen.queryByTestId('effort-popover')
const slider = (): HTMLInputElement => screen.getByTestId<HTMLInputElement>('effort-slider')
const marks = (): (string | undefined)[] => screen.getAllByTestId('effort-mark').map((mark) => mark.dataset['mark'])
const press = (key: string): void => {
  fireEvent.keyDown(slider(), { key })
}

/** The pickers of Session `s` with what main answers; resolves when the settings and the models are in. */
async function mount({ settings = {}, models = MODELS, sessionId = 's' }: { settings?: Partial<SessionSettings>; models?: Model[] | null; sessionId?: string } = {}) {
  const saved = { ...DEFAULTS, ...settings }
  answers['agent.controls'] = () => ({ settings: saved, queue: { items: [], paused: false } })
  if (models !== null) answers['agent.models'] = () => ({ models })
  answers['agent.configure'] = (input) => ({ ...saved, ...(input as { change: object }).change })
  // agent.models that fails is logged by the pickers.
  if (models === null) vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { default: Pickers } = await import('../../src/renderer/session/composer/Pickers')
  const props = { busy: false, text: '', setText: () => undefined }
  const view = render(<Pickers sessionId={sessionId} {...props} />)
  // Both answers of main arrive within one turn of the event loop.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(asked.map((each) => each.channel)).toEqual(expect.arrayContaining(['agent.controls', 'agent.models']))
  return { saved, show: (next: string) => view.rerender(<Pickers sessionId={next} {...props} />), unmount: () => view.unmount() }
}

const open = (): void => {
  fireEvent.click(button())
  expect(popover()).not.toBeNull()
}

describe('the marks of the effort slider', () => {
  it('are "default" and the levels of the picked model', async () => {
    await mount({ settings: { model: 'sonnet' } })
    open()
    expect(marks()).toEqual(['default', 'low', 'high'])
    expect(slider().min).toBe('0')
    expect(slider().max).toBe('2')
    expect(slider().step).toBe('1')
    expect(slider().type).toBe('range')
  })

  it('are every level while the list of models is empty: it has not arrived, or main could not get it', async () => {
    await mount({ models: [] })
    open()
    expect(marks()).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('are every level for a saved model too, when main could not list the models', async () => {
    await mount({ models: null, settings: { model: 'opus' } })
    open()
    expect(marks()).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('have a saved level the model does not list at its place by order: a saved "low" stands first after "default"', async () => {
    await mount({ settings: { model: 'opus', effort: 'low' } })
    open()
    expect(marks()).toEqual(['default', 'low', 'medium', 'high', 'xhigh'])
    expect(slider().value).toBe('1')
    // A saved level above the model's ones stands last.
    await emit('s', { type: 'settings', settings: { ...DEFAULTS, model: 'opus', effort: 'max' } })
    expect(marks()).toEqual(['default', 'medium', 'high', 'xhigh', 'max'])
    expect(slider().value).toBe('4')
  })

  it('are "default" and the saved level for a model that lists none', async () => {
    await mount({ settings: { model: 'haiku', effort: 'high' } })
    expect(button().disabled).toBe(false)
    expect(button().textContent).toBe('Efforthigh')
    open()
    expect(marks()).toEqual(['default', 'high'])
  })

  it('there are none for a model without levels and no saved one: the button reads "Effort —" and does not open', async () => {
    await mount({ settings: { model: 'haiku' } })
    expect(button().disabled).toBe(true)
    expect(button().textContent).toBe('Effort—')
    fireEvent.click(button())
    expect(popover()).toBeNull()
  })
})

describe('the button of the effort picker', () => {
  it('shows the level main reports and says that it is the level asked for, not the one applied', async () => {
    await mount({ settings: { effort: 'high' } })
    expect(button().textContent).toBe('Efforthigh')
    expect(button().dataset['value']).toBe('high')
    expect(button().getAttribute('aria-label')).toBe('Effort: high')
    expect(button().title).toBe('Claude Code does not report the effort it applies: this is the level worfy asked for')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    await emit('s', { type: 'settings', settings: DEFAULTS })
    expect(button().textContent).toBe('Effortdefault')
    expect(button().dataset['value']).toBe('')
  })

  it('keeps the level main reports while the thumb moves: only the popover follows the thumb', async () => {
    const { saved } = await mount({ settings: { effort: 'low' } })
    open()
    press('ArrowRight')
    expect(screen.getByTestId('effort-current').textContent).toBe('medium')
    expect(button().textContent).toBe('Effortlow')
    expect(button().getAttribute('aria-label')).toBe('Effort: low')
    press('Enter')
    expect(button().textContent).toBe('Effortlow')
    await emit('s', { type: 'settings', settings: { ...saved, effort: 'medium' } })
    expect(button().textContent).toBe('Effortmedium')
  })

  it('opens the popover with the focus on the slider; a second click closes it', async () => {
    await mount()
    open()
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(button().getAttribute('aria-controls')).toBe(popover()?.id)
    expect(document.activeElement).toBe(slider())
    fireEvent.click(button())
    expect(popover()).toBeNull()
    expect(configured()).toEqual([])
  })
})

describe('the thumb of the effort slider', () => {
  it('→ from "high" gives "xhigh" on a model that has it, and the mark is named above the slider and in aria-valuetext', async () => {
    await mount({ settings: { model: 'opus', effort: 'high' } })
    open()
    expect(slider().getAttribute('aria-valuetext')).toBe('high')
    expect(screen.getByTestId('effort-current').textContent).toBe('high')
    press('ArrowRight')
    expect(slider().getAttribute('aria-valuetext')).toBe('xhigh')
    expect(screen.getByTestId('effort-current').textContent).toBe('xhigh')
    expect(slider().value).toBe('3')
    // The last mark: → stays there.
    press('ArrowRight')
    expect(slider().getAttribute('aria-valuetext')).toBe('xhigh')
  })

  it('→ from "high" skips "xhigh" on a model without it', async () => {
    await mount({ settings: { model: 'sonnet', effort: 'low' } })
    open()
    press('ArrowRight')
    expect(slider().getAttribute('aria-valuetext')).toBe('high')
  })

  it('← goes down to "default" and stops there; Home and End go to the ends', async () => {
    await mount({ settings: { effort: 'medium' } })
    open()
    press('ArrowLeft')
    expect(slider().getAttribute('aria-valuetext')).toBe('low')
    press('ArrowLeft')
    expect(slider().getAttribute('aria-valuetext')).toBe('default')
    press('ArrowLeft')
    expect(slider().getAttribute('aria-valuetext')).toBe('default')
    expect(slider().value).toBe('0')
    press('End')
    expect(slider().getAttribute('aria-valuetext')).toBe('max')
    press('Home')
    expect(slider().getAttribute('aria-valuetext')).toBe('default')
  })

  it('follows the mouse: the input event of the native slider moves the mark', async () => {
    await mount()
    open()
    fireEvent.change(slider(), { target: { value: '3' } })
    expect(slider().getAttribute('aria-valuetext')).toBe('high')
    expect(screen.getByTestId('effort-current').textContent).toBe('high')
  })
})

describe('what the effort slider sends to agent.configure', () => {
  it.each([
    ['Esc', () => press('Escape')],
    ['Enter', () => press('Enter')],
    ['a press outside', () => fireEvent.mouseDown(document.body)],
    ['a click on the button', () => fireEvent.click(button())],
  ])('three presses of → and closing the popover with %s send one value', async (_name, close) => {
    await mount()
    open()
    press('ArrowRight')
    press('ArrowRight')
    press('ArrowRight')
    // Neither a press of an arrow nor the native slider's events send anything by themselves.
    expect(configured()).toEqual([])
    close()
    expect(popover()).toBeNull()
    expect(configured()).toEqual([sent({ effort: 'high' })])
  })

  it('three presses of → and 600 ms without a move send one value; closing after that sends nothing more', async () => {
    await mount()
    vi.useFakeTimers()
    open()
    press('ArrowRight')
    act(() => void vi.advanceTimersByTime(500))
    press('ArrowRight')
    act(() => void vi.advanceTimersByTime(500))
    press('ArrowRight')
    // 1000 ms since the first move, but only 0 since the last.
    act(() => void vi.advanceTimersByTime(599))
    expect(configured()).toEqual([])
    act(() => void vi.advanceTimersByTime(1))
    expect(configured()).toEqual([sent({ effort: 'high' })])
    expect(popover()).not.toBeNull()
    // The popover stays on the sent level until main reports it.
    expect(slider().getAttribute('aria-valuetext')).toBe('high')
    press('Escape')
    act(() => void vi.advanceTimersByTime(5000))
    expect(configured()).toEqual([sent({ effort: 'high' })])
  })

  it('the events of the native slider send nothing until the thumb rests or the popover closes', async () => {
    await mount()
    vi.useFakeTimers()
    open()
    fireEvent.change(slider(), { target: { value: '1' } })
    fireEvent.change(slider(), { target: { value: '2' } })
    fireEvent.input(slider(), { target: { value: '4' } })
    expect(configured()).toEqual([])
    act(() => void vi.advanceTimersByTime(600))
    expect(configured()).toEqual([sent({ effort: 'xhigh' })])
  })

  it('"default" goes as effort null', async () => {
    await mount({ settings: { effort: 'low' } })
    open()
    press('ArrowLeft')
    press('Enter')
    expect(configured()).toEqual([sent({ effort: null })])
  })

  it('a thumb back on the level main has sends nothing, on closing and after 600 ms alike', async () => {
    await mount({ settings: { effort: 'medium' } })
    vi.useFakeTimers()
    open()
    press('ArrowRight')
    press('ArrowLeft')
    act(() => void vi.advanceTimersByTime(600))
    expect(configured()).toEqual([])
    press('ArrowRight')
    press('ArrowLeft')
    press('Escape')
    expect(configured()).toEqual([])
    // An opening and a closing with no move send nothing either.
    open()
    press('Enter')
    act(() => void vi.advanceTimersByTime(600))
    expect(configured()).toEqual([])
  })

  it('a move after a sent value sends the new one, and a move back to the sent one sends nothing', async () => {
    const { saved } = await mount()
    vi.useFakeTimers()
    open()
    press('ArrowRight')
    act(() => void vi.advanceTimersByTime(600))
    expect(configured()).toEqual([sent({ effort: 'low' })])
    // main has not reported "low" yet: it is still what was sent last.
    press('ArrowRight')
    press('ArrowLeft')
    act(() => void vi.advanceTimersByTime(600))
    expect(configured()).toEqual([sent({ effort: 'low' })])
    await emit('s', { type: 'settings', settings: { ...saved, effort: 'low' } })
    press('ArrowRight')
    act(() => void vi.advanceTimersByTime(600))
    expect(configured()).toEqual([sent({ effort: 'low' }), sent({ effort: 'medium' })])
  })

  it('the value closing sent is not sent again by the 600 ms that follow', async () => {
    await mount()
    vi.useFakeTimers()
    open()
    press('ArrowRight')
    press('Escape')
    expect(configured()).toEqual([sent({ effort: 'low' })])
    act(() => void vi.advanceTimersByTime(5000))
    expect(configured()).toEqual([sent({ effort: 'low' })])
  })

  it('a level main did not take is sent again from a new opening of the popover', async () => {
    await mount()
    open()
    press('ArrowRight')
    press('Enter')
    expect(configured()).toEqual([sent({ effort: 'low' })])
    // main reported nothing: the button still shows its level, and the thumb starts from it.
    expect(button().dataset['value']).toBe('')
    open()
    expect(slider().getAttribute('aria-valuetext')).toBe('default')
    press('ArrowRight')
    press('Enter')
    expect(configured()).toEqual([sent({ effort: 'low' }), sent({ effort: 'low' })])
  })

  it('a thumb moved before the picker lost its levels is still sent when its 600 ms are over', async () => {
    await mount({ settings: { model: 'sonnet' } })
    vi.useFakeTimers()
    open()
    press('ArrowRight')
    await emit('s', { type: 'settings', settings: { ...DEFAULTS, model: 'haiku' } })
    expect(popover()).toBeNull()
    expect(configured()).toEqual([])
    act(() => void vi.advanceTimersByTime(600))
    expect(configured()).toEqual([sent({ effort: 'low' })])
  })

  it('pickers that go away with the thumb moved send its value', async () => {
    const { unmount } = await mount()
    vi.useFakeTimers()
    open()
    press('ArrowRight')
    press('ArrowRight')
    unmount()
    expect(configured()).toEqual([sent({ effort: 'medium' })])
    act(() => void vi.advanceTimersByTime(5000))
    expect(configured()).toEqual([sent({ effort: 'medium' })])
  })

  it('a thumb moved in one Session is sent to that Session when the pickers turn to another, and the popover closes', async () => {
    const { show } = await mount()
    open()
    press('ArrowRight')
    show('other')
    expect(configured()).toEqual([sent({ effort: 'low' }, 's')])
    expect(popover()).toBeNull()
  })

  it('says a level was not applied when main refuses it', async () => {
    await mount()
    delete answers['agent.configure']
    open()
    press('ArrowRight')
    press('Enter')
    expect((await screen.findByTestId('pickers-error')).getAttribute('title')).toBe('no agent.configure')
  })
})

describe('what closes the effort popover', () => {
  it('Esc closes the popover alone and gives the focus back to the button: nothing above gets the key', async () => {
    await mount()
    const onWindowEsc = vi.fn()
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onWindowEsc()
    }
    window.addEventListener('keydown', listener)
    try {
      open()
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => {
        slider().dispatchEvent(event)
      })
      expect(popover()).toBeNull()
      expect(event.defaultPrevented).toBe(true)
      expect(onWindowEsc).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(button())
      // Esc on the closed picker goes on, to whatever closes on it.
      fireEvent.keyDown(button(), { key: 'Escape' })
      expect(onWindowEsc).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', listener)
    }
  })

  it('Enter closes it and gives the focus back to the button', async () => {
    await mount()
    open()
    press('Enter')
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(button())
  })

  it('a press inside the popover keeps it open; a press outside closes it without taking the focus', async () => {
    await mount()
    render(<input data-testid="elsewhere" />)
    open()
    fireEvent.mouseDown(screen.getByTestId('effort-current'))
    fireEvent.mouseDown(slider())
    expect(popover()).not.toBeNull()
    fireEvent.mouseDown(screen.getByTestId('elsewhere'))
    expect(popover()).toBeNull()
    expect(document.activeElement).not.toBe(button())
  })

  it('a press on the popover next to the slider does not take the focus from the slider', async () => {
    await mount()
    open()
    const onLabel = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => {
      screen.getByTestId('effort-current').dispatchEvent(onLabel)
    })
    expect(onLabel.defaultPrevented).toBe(true)
    // The slider itself takes the press: the thumb is dragged with it.
    const onSlider = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => {
      slider().dispatchEvent(onSlider)
    })
    expect(onSlider.defaultPrevented).toBe(false)
  })

  it('the focus leaving the picker closes the popover and sends the value', async () => {
    await mount()
    render(<input data-testid="elsewhere" />)
    open()
    press('ArrowRight')
    act(() => {
      screen.getByTestId('elsewhere').focus()
    })
    expect(popover()).toBeNull()
    expect(configured()).toEqual([sent({ effort: 'low' })])
    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'))
  })

  it('the focus going from the slider to the button keeps it open', async () => {
    await mount()
    open()
    act(() => {
      button().focus()
    })
    expect(popover()).not.toBeNull()
  })

  it('the picker losing its levels under an open popover closes it for good', async () => {
    await mount({ settings: { model: 'sonnet' } })
    open()
    await emit('s', { type: 'settings', settings: { ...DEFAULTS, model: 'haiku' } })
    expect(popover()).toBeNull()
    expect(button().disabled).toBe(true)
    await emit('s', { type: 'settings', settings: { ...DEFAULTS, model: 'sonnet' } })
    expect(popover()).toBeNull()
  })

  it('the listener of presses outside lives only while the popover is open', async () => {
    await mount()
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const presses = (spy: typeof add): unknown[][] => spy.mock.calls.filter(([type]) => type === 'mousedown')
    try {
      open()
      expect(presses(add)).toHaveLength(1)
      press('Escape')
      expect(presses(remove)).toEqual(presses(add))
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
  })
})
