// The groups of the kit (worfy-ui-kit ticket 14, ADR-0106): ToggleGroup, RadioGroup and Tabs over
// Base UI. In each, Tab enters the group in one step (one element of it is a Tab stop: the checked
// radio, the selected tab, the first or the last focused toggle), the arrows move along it and Home
// and End go to its ends. In a
// ToggleGroup the arrows move the focus and Space or Enter presses; in a RadioGroup and in Tabs the
// choice moves with the focus. SegmentedControl (theme/primitives.tsx) keeps its API over ToggleGroup.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RadioGroup, Radio } from '../../src/renderer/theme/kit/RadioGroup'
import { Tab, TabList, TabPanel, Tabs } from '../../src/renderer/theme/kit/Tabs'
import { ToggleGroup, ToggleGroupItem } from '../../src/renderer/theme/kit/ToggleGroup'
import { SegmentedControl } from '../../src/renderer/theme/primitives'

afterEach(cleanup)

/** The elements of `root` that Tab stops at: focusable and not taken out with tabindex=-1. */
const tabStops = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter((element) => element.tabIndex >= 0 && !(element as HTMLButtonElement).disabled)

/** A key pressed where the focus is, as the browser sends it. */
const press = async (key: string, init: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
    // Base UI moves the focus in a microtask.
    await Promise.resolve()
  })
}

const LETTERS = ['a', 'b', 'c', 'd'] as const
type Letter = (typeof LETTERS)[number]

function Toggles({ onChange, disabled }: { onChange?: (value: Letter | null) => void; disabled?: Letter }) {
  const [value, setValue] = useState<Letter | null>('b')
  return (
    <>
      <button type="button">before</button>
      <ToggleGroup
        aria-label="Letters"
        value={value}
        onValueChange={(next: Letter | null) => {
          onChange?.(next)
          setValue(next)
        }}
      >
        {LETTERS.map((letter) => (
          <ToggleGroupItem key={letter} value={letter} disabled={letter === disabled}>
            {letter.toUpperCase()}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <button type="button">after</button>
    </>
  )
}

function Radios({ initial = 'b', readOnly = false, disabled }: { initial?: Letter | null; readOnly?: boolean; disabled?: Letter }) {
  const [value, setValue] = useState<Letter | null>(initial)
  return (
    <>
      <button type="button">before</button>
      <RadioGroup aria-label="Letters" value={value} onValueChange={setValue} readOnly={readOnly}>
        {LETTERS.map((letter) => (
          <Radio key={letter} value={letter} disabled={letter === disabled}>
            {letter.toUpperCase()}
          </Radio>
        ))}
      </RadioGroup>
      <button type="button">after</button>
    </>
  )
}

function TabSet() {
  const [value, setValue] = useState<Letter>('b')
  return (
    <Tabs value={value} onValueChange={setValue} render={<section aria-label="Set" />}>
      <TabList aria-label="Letters">
        {LETTERS.map((letter) => (
          <Tab key={letter} value={letter}>
            {letter.toUpperCase()}
          </Tab>
        ))}
      </TabList>
      {LETTERS.map((letter) => (
        <TabPanel key={letter} value={letter}>
          Panel {letter.toUpperCase()}
        </TabPanel>
      ))}
    </Tabs>
  )
}

describe('ToggleGroup', () => {
  const group = () => screen.getByRole('group', { name: 'Letters' })
  const item = (name: string) => within(group()).getByRole('button', { name })
  const pressed = () => within(group()).getAllByRole('button').map((each) => each.getAttribute('aria-pressed'))

  it('is a group of buttons with aria-pressed; Tab enters it in one step, on the first button, then on the last one focused', () => {
    render(<Toggles />)
    expect(pressed()).toEqual(['false', 'true', 'false', 'false'])
    // Base UI's ToggleGroup starts its Tab stop on the first button, not on the pressed one.
    expect(tabStops(group())).toEqual([item('A')])
    expect(within(group()).getAllByRole('button').every((each) => each.getAttribute('type') === 'button')).toBe(true)
    act(() => item('C').focus())
    expect(tabStops(group())).toEqual([item('C')])
  })

  it('the arrows move the focus along it, round the ends; Home and End go to the ends; a click presses', async () => {
    const onChange = vi.fn()
    render(<Toggles onChange={onChange} />)
    act(() => item('B').focus())
    await press('ArrowRight')
    expect(document.activeElement).toBe(item('C'))
    // The focus moved, the press did not.
    expect(pressed()).toEqual(['false', 'true', 'false', 'false'])
    expect(tabStops(group())).toEqual([item('C')])
    await press('ArrowRight')
    await press('ArrowRight')
    expect(document.activeElement).toBe(item('A'))
    await press('ArrowLeft')
    expect(document.activeElement).toBe(item('D'))
    await press('Home')
    expect(document.activeElement).toBe(item('A'))
    await press('End')
    expect(document.activeElement).toBe(item('D'))
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      fireEvent.click(item('D'))
    })
    expect(onChange).toHaveBeenLastCalledWith('d')
    expect(pressed()).toEqual(['false', 'false', 'false', 'true'])
    // The pressed button pressed again: the caller hears null and decides.
    act(() => {
      fireEvent.click(item('D'))
    })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('a disabled button is skipped by the arrows', async () => {
    render(<Toggles disabled="c" />)
    act(() => item('B').focus())
    await press('ArrowRight')
    expect(document.activeElement).toBe(item('D'))
    expect((item('C') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('RadioGroup', () => {
  const group = () => screen.getByRole('radiogroup', { name: 'Letters' })
  const radio = (name: string) => within(group()).getByRole('radio', { name })
  const checked = () => within(group()).getAllByRole('radio').map((each) => each.getAttribute('aria-checked'))

  it('is a radiogroup of native buttons; Tab enters it in one step, on the checked radio', () => {
    render(<Radios />)
    expect(checked()).toEqual(['false', 'true', 'false', 'false'])
    const radios = within(group()).getAllByRole('radio')
    expect(radios.map((each) => each.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON'])
    expect(radios.every((each) => each.getAttribute('type') === 'button')).toBe(true)
    // Base UI's hidden inputs are no Tab stop.
    expect(tabStops(group())).toEqual([radio('B')])
  })

  it('while none is checked, Tab enters on the first radio', () => {
    render(<Radios initial={null} />)
    expect(checked()).toEqual(['false', 'false', 'false', 'false'])
    expect(tabStops(group())).toEqual([radio('A')])
  })

  it('the arrows move the choice with the focus, round the ends; Home and End choose the ends', async () => {
    render(<Radios />)
    act(() => radio('B').focus())
    await press('ArrowRight')
    expect(document.activeElement).toBe(radio('C'))
    expect(checked()).toEqual(['false', 'false', 'true', 'false'])
    expect(tabStops(group())).toEqual([radio('C')])
    await press('ArrowDown')
    await press('ArrowDown')
    expect(document.activeElement).toBe(radio('A'))
    expect(checked()).toEqual(['true', 'false', 'false', 'false'])
    await press('ArrowLeft')
    expect(checked()).toEqual(['false', 'false', 'false', 'true'])
    await press('Home')
    expect(document.activeElement).toBe(radio('A'))
    expect(checked()).toEqual(['true', 'false', 'false', 'false'])
    await press('End')
    expect(document.activeElement).toBe(radio('D'))
    expect(checked()).toEqual(['false', 'false', 'false', 'true'])
    expect(tabStops(group())).toEqual([radio('D')])
  })

  it('a click chooses; a disabled radio is skipped by the arrows and by End', async () => {
    render(<Radios disabled="d" />)
    act(() => {
      fireEvent.click(radio('A'))
    })
    expect(checked()).toEqual(['true', 'false', 'false', 'false'])
    act(() => radio('A').focus())
    await press('End')
    expect(document.activeElement).toBe(radio('C'))
    expect(checked()).toEqual(['false', 'false', 'true', 'false'])
    await press('ArrowRight')
    expect(document.activeElement).toBe(radio('A'))
  })

  it('a read-only group keeps its choice: the arrows, Home, End and a click choose nothing', async () => {
    render(<Radios readOnly />)
    act(() => radio('B').focus())
    await press('ArrowRight')
    await press('End')
    act(() => {
      fireEvent.click(radio('A'))
    })
    expect(checked()).toEqual(['false', 'true', 'false', 'false'])
  })
})

describe('Tabs', () => {
  const list = () => screen.getByRole('tablist', { name: 'Letters' })
  const tab = (name: string) => within(list()).getByRole('tab', { name })
  const selected = () => within(list()).getAllByRole('tab').map((each) => each.getAttribute('aria-selected'))

  it('the panel of the selected tab is named by it; Tab enters the list in one step, on the selected tab', () => {
    render(<TabSet />)
    expect(selected()).toEqual(['false', 'true', 'false', 'false'])
    expect(tabStops(list())).toEqual([tab('B')])
    const panel = screen.getByRole('tabpanel')
    expect(panel.textContent).toBe('Panel B')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('B').id)
    expect(screen.getByRole('tabpanel', { name: 'B' })).toBe(panel)
    expect(tab('B').getAttribute('aria-controls')).toBe(panel.id)
    expect(screen.getByRole('region', { name: 'Set' }).tagName).toBe('SECTION')
  })

  it('the arrows move the selection with the focus, round the ends; Home and End go to the ends', async () => {
    render(<TabSet />)
    act(() => tab('B').focus())
    await press('ArrowRight')
    expect(document.activeElement).toBe(tab('C'))
    expect(selected()).toEqual(['false', 'false', 'true', 'false'])
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel C')
    expect(tabStops(list())).toEqual([tab('C')])
    await press('ArrowRight')
    await press('ArrowRight')
    expect(selected()).toEqual(['true', 'false', 'false', 'false'])
    await press('ArrowLeft')
    expect(selected()).toEqual(['false', 'false', 'false', 'true'])
    await press('Home')
    expect(document.activeElement).toBe(tab('A'))
    expect(selected()).toEqual(['true', 'false', 'false', 'false'])
    await press('End')
    expect(document.activeElement).toBe(tab('D'))
    expect(selected()).toEqual(['false', 'false', 'false', 'true'])
    expect(screen.getByRole('tabpanel', { name: 'D' }).textContent).toBe('Panel D')
  })

  it('a click selects', () => {
    render(<TabSet />)
    act(() => {
      fireEvent.click(tab('A'))
    })
    expect(selected()).toEqual(['true', 'false', 'false', 'false'])
  })
})

describe('SegmentedControl over the kit ToggleGroup', () => {
  const OPTIONS = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two', title: 'The second' },
    { value: 'three', label: 'Three', disabled: true, title: 'Not now' },
  ] as const

  it('keeps its roles, names and tooltips; one Tab stop; the arrows move the focus, a click presses; pressing the pressed segment again reports it', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="View" options={OPTIONS} value="one" onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'View' })
    const segment = (name: string) => within(group).getByRole('button', { name })
    expect(group.classList.contains('w-segmented')).toBe(true)
    expect(within(group).getAllByRole('button').map((each) => [each.className, each.getAttribute('aria-pressed'), each.getAttribute('title')])).toEqual([
      ['w-segmented__item', 'true', 'One'],
      ['w-segmented__item', 'false', 'The second'],
      ['w-segmented__item', 'false', 'Not now'],
    ])
    expect((segment('Three') as HTMLButtonElement).disabled).toBe(true)
    expect(segment('Two').querySelector('.w-segmented__label')?.textContent).toBe('Two')
    expect(tabStops(group)).toEqual([segment('One')])
    act(() => segment('One').focus())
    await press('ArrowRight')
    expect(document.activeElement).toBe(segment('Two'))
    expect(onChange).not.toHaveBeenCalled()
    // The disabled segment is skipped: the focus goes round to the first.
    await press('ArrowRight')
    expect(document.activeElement).toBe(segment('One'))
    await press('End')
    expect(document.activeElement).toBe(segment('Two'))
    act(() => {
      fireEvent.click(segment('Two'))
    })
    expect(onChange).toHaveBeenLastCalledWith('two')
    // As before the kit: a press on the pressed segment calls onChange with its value.
    act(() => {
      fireEvent.click(segment('One'))
    })
    expect(onChange).toHaveBeenLastCalledWith('one')
  })
})
