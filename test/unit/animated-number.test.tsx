// The one wrapper over NumberFlow (src/renderer/theme/AnimatedNumber.tsx, worfy-ui-kit ticket 17): the
// digits roll only when the value changes, not on the first show; under Reduce motion they change at
// once; the text a screen reader gets is the final value. The tests never wait for an animation: the
// ones about motion replace NumberFlow with a stub that records the `animated` it was given, and the
// rest read the final text.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REDUCE = '(prefers-reduced-motion: reduce)'

/** A matchMedia whose Reduce motion answer the test sets, with the change listeners it was given. */
function stubReducedMotion(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === REDUCE && matches
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  return {
    set(next: boolean) {
      matches = next
      for (const listener of listeners) listener()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@number-flow/react')
  vi.resetModules()
})

describe('AnimatedNumber text', () => {
  it('shows the text alone where NumberFlow cannot animate (jsdom has no linear() easing)', async () => {
    const { AnimatedNumber } = await import('../../src/renderer/theme/AnimatedNumber')
    const { rerender, container } = render(
      <span data-testid="value">
        <AnimatedNumber value={62} suffix="%" />
      </span>,
    )
    expect(screen.getByTestId('value').textContent).toBe('62%')
    expect(container.querySelector('number-flow-react')).toBeNull()
    rerender(
      <span data-testid="value">
        <AnimatedNumber value={91} suffix="%" />
      </span>,
    )
    expect(screen.getByTestId('value').textContent).toBe('91%')
  })

  it('writes a cost with cents, or four decimals below a dollar, rounded as toFixed rounds', async () => {
    const { AnimatedNumber } = await import('../../src/renderer/theme/AnimatedNumber')
    const { costNumber } = await import('../../src/renderer/session/format')
    const textOf = (usd: number): string | null => {
      const { container, unmount } = render(<AnimatedNumber {...costNumber(usd)} />)
      const text = container.textContent
      unmount()
      return text
    }
    const cases: [number, string][] = [
      [0, '$0.00'],
      [0.0021, '$0.0021'],
      [0.0125, '$0.0125'],
      [0.03, '$0.0300'],
      [0.99996, '$1.0000'],
      [1, '$1.00'],
      [1.005, '$1.00'],
      [12.5, '$12.50'],
      [1234.567, '$1234.57'],
    ]
    for (const [usd, text] of cases) {
      expect(textOf(usd), String(usd)).toBe(text)
      expect(text, String(usd)).toBe(`$${usd.toFixed(usd !== 0 && usd < 1 ? 4 : 2)}`)
    }
  })
})

describe('AnimatedNumber motion', () => {
  const given: boolean[] = []

  beforeEach(() => {
    given.length = 0
    vi.resetModules()
    // NumberFlow as in Chromium, where it can animate; the stub draws no digits of its own.
    vi.doMock('@number-flow/react', () => ({
      useIsSupported: () => true,
      default: ({ animated, ...rest }: { animated?: boolean; 'aria-hidden'?: string }) => {
        given.push(animated === true)
        return <span data-testid="digits" aria-hidden={rest['aria-hidden'] === 'true' ? 'true' : undefined} />
      },
    }))
  })

  it('gives a screen reader the final value and hides the drawn digits from it', async () => {
    stubReducedMotion(false)
    const { show, container } = await mount(62)
    expect(screen.getByTestId('digits').getAttribute('aria-hidden')).toBe('true')
    expect(container.textContent).toBe('62%')
    show(91)
    expect(container.textContent).toBe('91%')
    const text = screen.getByText('91%')
    expect(text.className).toBe('w-animated-number__text')
    expect(text.style.position).toBe('absolute')
    expect(text.style.clipPath).toBe('inset(50%)')
  })

  async function mount(value: number) {
    const { AnimatedNumber } = await import('../../src/renderer/theme/AnimatedNumber')
    const view = render(<AnimatedNumber value={value} suffix="%" />)
    return { ...view, show: (next: number) => view.rerender(<AnimatedNumber value={next} suffix="%" />) }
  }

  it('draws the first value without animation', async () => {
    stubReducedMotion(false)
    const { show } = await mount(10)
    expect(given.at(-1)).toBe(false)
    show(10)
    expect(given.at(-1)).toBe(false)
  })

  it('animates a change of the value', async () => {
    stubReducedMotion(false)
    const { show } = await mount(10)
    show(42)
    expect(given.at(-1)).toBe(true)
    expect(screen.getByText('42%')).toBeTruthy()
  })

  it('changes the value at once under Reduce motion', async () => {
    stubReducedMotion(true)
    const { show } = await mount(10)
    show(42)
    expect(given.at(-1)).toBe(false)
    expect(screen.getByText('42%')).toBeTruthy()
  })

  it('follows Reduce motion when the system setting changes', async () => {
    const motion = stubReducedMotion(false)
    const { show } = await mount(10)
    show(42)
    expect(given.at(-1)).toBe(true)
    act(() => motion.set(true))
    expect(given.at(-1)).toBe(false)
    show(50)
    expect(given.at(-1)).toBe(false)
  })

  it('animates without matchMedia, where nothing asks for less motion', async () => {
    vi.stubGlobal('matchMedia', undefined)
    const { show } = await mount(10)
    show(42)
    expect(given.at(-1)).toBe(true)
  })
})
