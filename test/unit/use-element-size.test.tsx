// The shared size hook of the Focus button and the selection toolbar (src/renderer/canvas/use-element-size.ts).
// jsdom has no layout: the ResizeObserver here is a stand-in that reports a given border box.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useElementSize } from '../../src/renderer/canvas/use-element-size'

type Callback = (entries: unknown[], observer: unknown) => void

/** Every stand-in observer made: its callback, what it observes and whether it was disconnected. */
const observers: { callback: Callback; targets: Element[]; disconnected: boolean }[] = []

class StandInObserver {
  private readonly record: { callback: Callback; targets: Element[]; disconnected: boolean }
  constructor(callback: Callback) {
    this.record = { callback, targets: [], disconnected: false }
    observers.push(this.record)
  }
  observe(target: Element): void {
    this.record.targets.push(target)
  }
  unobserve(): void {}
  disconnect(): void {
    this.record.targets = []
    this.record.disconnected = true
  }
}

function resize(element: Element, width: number, height: number): void {
  for (const { callback, targets } of observers) {
    if (targets.includes(element)) callback([{ target: element, borderBoxSize: [{ inlineSize: width, blockSize: height }] }], null)
  }
}

function Measured({ onSize }: { onSize: (size: { width: number; height: number }) => void }) {
  return <div data-testid="measured" ref={useElementSize<HTMLDivElement>(onSize)} />
}

let hadObserver = false
beforeEach(() => {
  const globals = globalThis as { ResizeObserver?: unknown }
  hadObserver = 'ResizeObserver' in globals
  globals.ResizeObserver = StandInObserver
  observers.length = 0
})
afterEach(() => {
  cleanup()
  if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

describe('useElementSize', () => {
  it('reports the border box rounded up to whole pixels, and not a zero size', () => {
    const onSize = vi.fn()
    render(<Measured onSize={onSize} />)
    const element = screen.getByTestId('measured')
    // Fractions below one half: rounding to the nearest pixel would keep both short.
    act(() => resize(element, 104.25, 27.2))
    expect(onSize).toHaveBeenLastCalledWith({ width: 105, height: 28 })
    act(() => resize(element, 0, 0))
    act(() => resize(element, 120, 0))
    expect(onSize).toHaveBeenCalledTimes(1)
  })

  it('disconnects its observer when the element unmounts', () => {
    const onSize = vi.fn()
    const { unmount } = render(<Measured onSize={onSize} />)
    expect(observers).toHaveLength(1)
    unmount()
    expect(observers[0]!.disconnected).toBe(true)
  })
})
