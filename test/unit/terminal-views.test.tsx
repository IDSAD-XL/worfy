// Which view of a shell sets the size of its pty (src/renderer/canvas/nodes/terminal-views.ts): the
// view mounted last, and when it goes, the view before it takes the size again.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addView, isLastView, type ShellView } from '../../src/renderer/canvas/nodes/terminal-views'

const removals: (() => void)[] = []

function view() {
  return { takeSize: vi.fn<() => void>() } satisfies ShellView
}

function add(key: string, shellView: ShellView): () => void {
  const remove = addView(key, shellView)
  removals.push(remove)
  return remove
}

afterEach(() => {
  for (const remove of removals.splice(0)) remove()
})

describe('terminal views', () => {
  it('the view mounted last sets the size; the one under it does not', () => {
    const canvas = view()
    const tile = view()
    add('p n', canvas)
    expect(isLastView('p n', canvas)).toBe(true)
    add('p n', tile)
    expect(isLastView('p n', tile)).toBe(true)
    expect(isLastView('p n', canvas)).toBe(false)
  })

  it('when the last view goes, the view before it takes the size, once', () => {
    const canvas = view()
    const tile = view()
    add('p n', canvas)
    const removeTile = add('p n', tile)
    removeTile()
    expect(canvas.takeSize).toHaveBeenCalledTimes(1)
    expect(isLastView('p n', canvas)).toBe(true)
    // Removing it again changes nothing.
    removeTile()
    expect(canvas.takeSize).toHaveBeenCalledTimes(1)
  })

  it('when a view that is not the last goes, the last keeps the size and is not asked to take it', () => {
    const canvas = view()
    const tile = view()
    const removeCanvas = add('p n', canvas)
    add('p n', tile)
    removeCanvas()
    expect(tile.takeSize).not.toHaveBeenCalled()
    expect(isLastView('p n', tile)).toBe(true)
  })

  it('the views of other shells are separate', () => {
    const one = view()
    const other = view()
    add('p one', one)
    const removeOther = add('p other', other)
    expect(isLastView('p one', one)).toBe(true)
    expect(isLastView('p other', other)).toBe(true)
    removeOther()
    expect(one.takeSize).not.toHaveBeenCalled()
    expect(isLastView('p other', other)).toBe(false)
  })
})
