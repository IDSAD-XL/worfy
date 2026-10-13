import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select, type SelectOption } from '../../src/renderer/theme/Select'

// The shared Select of worfy: a button and a listbox after the WAI-ARIA "select-only combobox"
// pattern. The focus stays on the button; the option under the keyboard cursor is named by
// aria-activedescendant. Esc on an open list closes only the list.

const OPTIONS: SelectOption[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet', detail: 'fast' },
  { value: 'haiku', label: 'Haiku', disabled: true },
  { value: 'plan', label: 'Plan only' },
  { value: 'pleasant', label: 'Pleasant' },
]

function Harness({ initial = 'opus', onChange, onOpen, disabled }: { initial?: string; onChange?: (value: string) => void; onOpen?: () => void; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <Select
      aria-label="Model"
      data-testid="picker"
      prefix="Model"
      value={value}
      options={OPTIONS}
      disabled={disabled}
      onOpen={onOpen}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

const button = (): HTMLElement => screen.getByTestId('picker')
const listbox = (): HTMLElement | null => screen.queryByRole('listbox')
const active = (): string | null => {
  const id = button().getAttribute('aria-activedescendant')
  // The label only: an option's detail sits next to it.
  return id === null || id === '' ? null : (document.getElementById(id)?.querySelector('.w-select-option__label')?.textContent ?? null)
}
const key = (name: string, init: Partial<KeyboardEventInit> = {}): void => {
  fireEvent.keyDown(button(), { key: name, ...init })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Select', () => {
  it('↓ opens the list and Enter chooses the option under the cursor', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(listbox()).toBeNull()
    key('ArrowDown')
    expect(listbox()).not.toBeNull()
    key('ArrowDown')
    key('Enter')
    expect(onChange).toHaveBeenCalledWith('sonnet')
    expect(listbox()).toBeNull()
    expect(button().getAttribute('data-value')).toBe('sonnet')
    expect(document.activeElement).toBe(button())
  })

  it('ARIA of the button and the list', () => {
    render(<Harness />)
    const trigger = button()
    expect(trigger.getAttribute('role')).toBe('combobox')
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-label')).toBe('Model')
    expect(trigger.getAttribute('data-value')).toBe('opus')
    expect(trigger.textContent).toContain('Model')
    expect(trigger.textContent).toContain('Opus')
    fireEvent.click(trigger)
    const list = listbox()
    expect(list).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(list?.id)
    // In document.body, out of any dialog's overflow.
    expect(list?.parentElement).toBe(document.body)
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    expect(options[2]?.getAttribute('aria-disabled')).toBe('true')
    expect(options[1]?.textContent).toContain('fast')
    // The cursor starts on the chosen option.
    expect(active()).toBe('Opus')
  })

  it('↑ and ↓ move aria-activedescendant, skip a disabled option and stop at the ends', () => {
    render(<Harness />)
    key('ArrowDown')
    expect(active()).toBe('Opus')
    key('ArrowUp')
    expect(active()).toBe('Opus')
    key('ArrowDown')
    expect(active()).toBe('Sonnet')
    key('ArrowDown')
    expect(active()).toBe('Plan only')
    key('ArrowDown')
    expect(active()).toBe('Pleasant')
    key('ArrowDown')
    expect(active()).toBe('Pleasant')
    key('Home')
    expect(active()).toBe('Opus')
    key('End')
    expect(active()).toBe('Pleasant')
  })

  it('Home and End open the list on the first and the last option', () => {
    render(<Harness initial="sonnet" />)
    key('End')
    expect(listbox()).not.toBeNull()
    expect(active()).toBe('Pleasant')
    key('Escape')
    key('Home')
    expect(active()).toBe('Opus')
  })

  it('Space opens and chooses', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    key(' ')
    expect(listbox()).not.toBeNull()
    key('ArrowDown')
    key(' ')
    expect(onChange).toHaveBeenCalledWith('sonnet')
    expect(listbox()).toBeNull()
  })

  it('Tab chooses the option under the cursor and closes, without keeping the focus', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    key('ArrowDown')
    key('ArrowDown')
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      button().dispatchEvent(event)
    })
    expect(onChange).toHaveBeenCalledWith('sonnet')
    expect(listbox()).toBeNull()
    // The focus moves on as Tab does.
    expect(event.defaultPrevented).toBe(false)
  })

  it('typing "pl" goes to the option starting with "Pl"; the buffer resets after 500 ms', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    key('ArrowDown')
    key('p')
    expect(active()).toBe('Plan only')
    key('l')
    expect(active()).toBe('Plan only')
    key('e')
    expect(active()).toBe('Pleasant')
    key('Enter')
    expect(onChange).toHaveBeenCalledWith('pleasant')
    // A letter on a closed Select opens it on the match.
    key('s')
    expect(listbox()).not.toBeNull()
    expect(active()).toBe('Sonnet')
    act(() => {
      vi.advanceTimersByTime(600)
    })
    key('o')
    expect(active()).toBe('Opus')
    // The same letter again cycles through the options that start with it.
    act(() => {
      vi.advanceTimersByTime(600)
    })
    key('p')
    expect(active()).toBe('Plan only')
    act(() => {
      vi.advanceTimersByTime(600)
    })
    key('p')
    expect(active()).toBe('Pleasant')
  })

  it('a disabled Select does not open', () => {
    const onOpen = vi.fn()
    render(<Harness disabled onOpen={onOpen} />)
    expect((button() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button())
    key('ArrowDown')
    key('Enter')
    expect(listbox()).toBeNull()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a click outside closes without choosing; a click on an option chooses it', () => {
    const onChange = vi.fn()
    render(
      <>
        <Harness onChange={onChange} />
        <div data-testid="outside">outside</div>
      </>,
    )
    fireEvent.click(button())
    expect(listbox()).not.toBeNull()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(listbox()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(button())
    // The press inside the list keeps the list open and the focus on the button.
    fireEvent.mouseDown(screen.getByRole('option', { name: /Plan only/ }))
    expect(listbox()).not.toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Plan only/ }))
    expect(onChange).toHaveBeenCalledWith('plan')
    expect(listbox()).toBeNull()
    // A disabled option takes no click.
    fireEvent.click(button())
    fireEvent.click(screen.getByRole('option', { name: /Haiku/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(listbox()).not.toBeNull()
    // A click on the button of an open Select closes it.
    fireEvent.click(button())
    expect(listbox()).toBeNull()
  })

  it('onOpen is called on every opening', () => {
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    fireEvent.click(button())
    expect(onOpen).toHaveBeenCalledTimes(1)
    key('Escape')
    key('ArrowDown')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('the label, the invalid state and the description go onto the button', () => {
    render(
      <>
        <label htmlFor="finish">Finish</label>
        <Select id="finish" value="local-green" options={[{ value: 'pr-green-ci', label: 'pr-green-ci' }, { value: 'local-green', label: 'local-green' }]} onChange={() => {}} aria-invalid="true" aria-describedby="err" mono />
        <span id="err">bad</span>
      </>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Finish' })
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe('err')
    expect(trigger.getAttribute('data-value')).toBe('local-green')
    // The list is named after the label.
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe('Finish')
  })

  it('a label that wraps the Select names the list with its own text only', () => {
    render(
      <label htmlFor="mode">
        mode
        <Select id="mode" value="full" options={[{ value: 'full', label: 'full' }, { value: 'silent', label: 'silent' }]} onChange={() => {}} />
      </label>,
    )
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe('mode')
  })
})

describe('Select: Esc', () => {
  function Dialog({ onContainerEsc }: { onContainerEsc: () => void }) {
    return (
      <div
        data-testid="dialog"
        onKeyDown={(event: ReactKeyboardEvent) => {
          if (event.key === 'Escape') onContainerEsc()
        }}
      >
        <Harness />
      </div>
    )
  }

  it('Esc on an open list closes only the list: neither the container nor window get it', () => {
    const onContainerEsc = vi.fn()
    const onWindowEsc = vi.fn()
    const windowListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onWindowEsc(event.defaultPrevented)
    }
    window.addEventListener('keydown', windowListener)
    try {
      render(<Dialog onContainerEsc={onContainerEsc} />)
      key('ArrowDown')
      expect(listbox()).not.toBeNull()
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => {
        button().dispatchEvent(event)
      })
      expect(listbox()).toBeNull()
      expect(event.defaultPrevented).toBe(true)
      expect(onContainerEsc).not.toHaveBeenCalled()
      expect(onWindowEsc).not.toHaveBeenCalled()
      expect(button().getAttribute('data-value')).toBe('opus')
      expect(document.activeElement).toBe(button())

      // On a closed Select Esc goes on to the dialog, as before.
      key('Escape')
      expect(onContainerEsc).toHaveBeenCalledTimes(1)
      expect(onWindowEsc).toHaveBeenCalledWith(false)
    } finally {
      window.removeEventListener('keydown', windowListener)
    }
  })
})

describe('Select: what closes the list', () => {
  it('a scroll closes the list only when the scrolled element holds the button', () => {
    render(
      <>
        <div data-testid="transcript">a transcript that scrolls by itself</div>
        <div data-testid="column">
          <Harness />
        </div>
      </>,
    )
    fireEvent.click(button())
    // A scroll next to the button does not move it: the list stays under it.
    fireEvent.scroll(screen.getByTestId('transcript'))
    expect(listbox()).not.toBeNull()
    // Nor does a scroll of the list itself.
    fireEvent.scroll(screen.getByRole('listbox'))
    expect(listbox()).not.toBeNull()
    // A scroll of an element around the button takes the button away from the list.
    fireEvent.scroll(screen.getByTestId('column'))
    expect(listbox()).toBeNull()
    fireEvent.click(button())
    expect(listbox()).not.toBeNull()
    fireEvent.scroll(document)
    expect(listbox()).toBeNull()
  })

  it('a resize of the window closes the list', () => {
    render(<Harness />)
    fireEvent.click(button())
    fireEvent(window, new Event('resize'))
    expect(listbox()).toBeNull()
  })

  it('the window losing focus closes the list', () => {
    render(<Harness />)
    fireEvent.click(button())
    fireEvent.blur(window)
    expect(listbox()).toBeNull()
  })

  describe('the listeners live only while the list is open', () => {
    type Listener = [target: 'document' | 'window', type: string, listener: unknown, capture: unknown]
    const WATCHED = ['mousedown', 'scroll', 'resize', 'blur']
    function watch(): { added: () => Listener[]; removed: () => Listener[] } {
      const calls = (target: 'document' | 'window', spy: { mock: { calls: unknown[][] } }): Listener[] =>
        spy.mock.calls.filter(([type]) => WATCHED.includes(String(type))).map(([type, listener, capture]) => [target, String(type), listener, capture])
      const documentAdd = vi.spyOn(document, 'addEventListener')
      const documentRemove = vi.spyOn(document, 'removeEventListener')
      const windowAdd = vi.spyOn(window, 'addEventListener')
      const windowRemove = vi.spyOn(window, 'removeEventListener')
      return {
        added: () => [...calls('document', documentAdd), ...calls('window', windowAdd)],
        removed: () => [...calls('document', documentRemove), ...calls('window', windowRemove)],
      }
    }
    const types = (listeners: Listener[]): string[] => listeners.map(([target, type]) => `${target}:${type}`).sort()

    it('added on opening, each removed on closing', () => {
      render(<Harness />)
      const { added, removed } = watch()
      expect(added()).toEqual([])
      fireEvent.click(button())
      expect(types(added())).toEqual(['document:mousedown', 'document:scroll', 'window:blur', 'window:resize'])
      expect(removed()).toEqual([])
      key('Escape')
      // The very listeners that were added, with the same capture flag.
      expect(removed()).toHaveLength(4)
      expect(removed()).toEqual(expect.arrayContaining(added()))
    })

    it('each removed when the Select goes away with its list open', () => {
      const view = render(<Harness />)
      const { added, removed } = watch()
      fireEvent.click(button())
      expect(added()).toHaveLength(4)
      view.unmount()
      expect(removed()).toHaveLength(4)
      expect(removed()).toEqual(expect.arrayContaining(added()))
    })
  })

  it('a Select disabled with its list open closes it for good: enabling it again does not bring the list back', () => {
    const view = render(<Harness />)
    fireEvent.click(button())
    expect(listbox()).not.toBeNull()
    view.rerender(<Harness disabled />)
    expect(listbox()).toBeNull()
    view.rerender(<Harness />)
    expect(listbox()).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })
})

describe('Select: keys and focus', () => {
  it('Alt+↑ chooses the option under the cursor and closes the list', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    key('ArrowDown')
    key('ArrowDown')
    expect(active()).toBe('Sonnet')
    key('ArrowUp', { altKey: true })
    expect(onChange).toHaveBeenCalledWith('sonnet')
    expect(listbox()).toBeNull()
    expect(button().getAttribute('data-value')).toBe('sonnet')
  })

  it('a chosen option gives the focus back to the button', () => {
    render(
      <>
        <Harness />
        <input data-testid="elsewhere" />
      </>,
    )
    fireEvent.click(button())
    // The focus left the button while the list was open.
    screen.getByTestId('elsewhere').focus()
    expect(document.activeElement).not.toBe(button())
    fireEvent.click(screen.getByRole('option', { name: /Plan only/ }))
    expect(listbox()).toBeNull()
    expect(document.activeElement).toBe(button())
  })

  it('the chevron of the button points both ways, as in the mockup', () => {
    render(<Harness />)
    const path = button().querySelector('.w-select__chevron path')?.getAttribute('d') ?? ''
    // Two strokes: one up, one down.
    expect(path.match(/M/g)).toHaveLength(2)
  })
})

describe('Select: where the list opens', () => {
  /** The button's place in a window `viewport` px tall; the list's content is `content()` px tall inside a 1 px border. */
  function geometry({ top, viewport, content }: { top: number; viewport: number; content: () => number }): void {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewport)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect = this.getAttribute('role') === 'combobox' ? { top, bottom: top + 24, left: 100, right: 220, width: 120, height: 24 } : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
      return { ...rect, x: rect.left, y: rect.top, toJSON: () => rect }
    })
    const isList = (element: Element): boolean => element.getAttribute('role') === 'listbox'
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
      return isList(this) ? content() : 0
    })
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return isList(this) ? content() : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return isList(this) ? content() + 2 : 0
    })
  }
  const list = (): HTMLElement => screen.getByRole('listbox')

  it('under the button when the list fits there, though there is more room over it', () => {
    // Under the button: 600 − 424 − 4 − 8 = 164 px; over it: 388 px.
    geometry({ top: 400, viewport: 600, content: () => 148 })
    render(<Harness />)
    fireEvent.click(button())
    expect(list().dataset['placement']).toBe('below')
    // 4 px under the button's bottom edge.
    expect(list().style.top).toBe('428px')
    expect(list().style.minWidth).toBe('120px')
    expect(list().style.left).toBe('100px')
  })

  it('over the button when there is no room under it, 4 px from its top edge with the border counted', () => {
    geometry({ top: 560, viewport: 600, content: () => 148 })
    render(<Harness />)
    fireEvent.click(button())
    expect(list().dataset['placement']).toBe('above')
    // The list is 148 px of content and 2 px of border: 560 − 4 − 150.
    expect(list().style.top).toBe('406px')
  })

  it('on the side with more room when it fits on neither, no taller than that room', () => {
    geometry({ top: 100, viewport: 300, content: () => 400 })
    render(<Harness />)
    fireEvent.click(button())
    // Under the button: 300 − 124 − 4 − 8 = 164 px; over it: 100 − 4 − 8 = 88 px.
    expect(list().dataset['placement']).toBe('below')
    expect(list().style.maxHeight).toBe('164px')
  })

  it('is placed again when the options change under an open list', () => {
    let content = 60
    geometry({ top: 560, viewport: 600, content: () => content })
    const few: SelectOption[] = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]
    const many: SelectOption[] = [...few, { value: 'c', label: 'C' }, { value: 'd', label: 'D' }]
    const view = render(<Select aria-label="Model" data-testid="picker" value="a" options={few} onChange={() => {}} />)
    fireEvent.click(button())
    // 560 − 4 − (60 + 2).
    expect(list().style.top).toBe('494px')
    // The options arrive after the opening, as the models of the composer do.
    content = 116
    view.rerender(<Select aria-label="Model" data-testid="picker" value="a" options={many} onChange={() => {}} />)
    expect(list().style.top).toBe('438px')
  })
})
