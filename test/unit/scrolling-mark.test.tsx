// The mark of a scrolling container (worfy-polish ticket 170, src/renderer/theme/scrolling-mark.ts): the
// thumb of the app's scrollbar shows while the container scrolls, also by the wheel or the keys without
// the pointer over it. One listener on the document marks the element that scrolled and clears the mark
// after a pause. The thumb itself is a pseudo-element jsdom does not draw: that is a manual check.
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCROLLING_MARK_MS, useScrollingMark } from '../../src/renderer/theme/scrolling-mark'

function container(): HTMLDivElement {
  const element = document.createElement('div')
  document.body.append(element)
  return element
}

function scroll(element: Element): void {
  // A scroll event of an element does not bubble: the hook hears it in the capture phase.
  element.dispatchEvent(new Event('scroll', { bubbles: false }))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('useScrollingMark', () => {
  it('marks the element that scrolls and clears the mark after a pause', () => {
    renderHook(() => useScrollingMark())
    const list = container()
    scroll(list)
    expect(list.hasAttribute('data-scrolling')).toBe(true)
    vi.advanceTimersByTime(SCROLLING_MARK_MS - 1)
    expect(list.hasAttribute('data-scrolling')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(list.hasAttribute('data-scrolling')).toBe(false)
  })

  it('keeps the mark while the scrolling goes on', () => {
    renderHook(() => useScrollingMark())
    const list = container()
    scroll(list)
    vi.advanceTimersByTime(SCROLLING_MARK_MS - 100)
    scroll(list)
    vi.advanceTimersByTime(SCROLLING_MARK_MS - 100)
    expect(list.hasAttribute('data-scrolling')).toBe(true)
    vi.advanceTimersByTime(100)
    expect(list.hasAttribute('data-scrolling')).toBe(false)
  })

  it('marks only the element that scrolled', () => {
    renderHook(() => useScrollingMark())
    const outer = container()
    const inner = document.createElement('div')
    outer.append(inner)
    const other = container()
    scroll(inner)
    expect(inner.hasAttribute('data-scrolling')).toBe(true)
    expect(outer.hasAttribute('data-scrolling')).toBe(false)
    expect(other.hasAttribute('data-scrolling')).toBe(false)
  })

  it('stops listening on unmount and leaves no mark behind', () => {
    const hook = renderHook(() => useScrollingMark())
    const list = container()
    scroll(list)
    hook.unmount()
    expect(list.hasAttribute('data-scrolling')).toBe(false)
    const later = container()
    scroll(later)
    expect(later.hasAttribute('data-scrolling')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
