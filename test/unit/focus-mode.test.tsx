// Focus mode's layer (src/renderer/focus/FocusMode.tsx) over a React Flow store with no Canvas:
// where the keyboard focus goes, Nodes that leave the Canvas while their tile is open, and a
// title-bar drag whose pointerup arrives before React has rendered the pointermove before it.
import { act, render, screen } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasFlowNode } from '../../src/renderer/canvas/nodes/index'
import { FocusMode } from '../../src/renderer/focus/FocusMode'
import { buildPreset, leafIds, type TileTree } from '../../src/renderer/focus/split-tree'

const flowNode = (id: string): CanvasFlowNode => ({
  id,
  position: { x: 0, y: 0 },
  // A kind no file declares: the tile draws the placeholder, which needs no Layout operations.
  data: { node: { id, kind: 'zz-focus-test', x: 0, y: 0, w: 100, h: 100, hidden: false, locked: false, pinned: false, tags: [], data: { title: id.toUpperCase() } } },
})

const columns = (ids: string[]): TileTree => {
  const tree = buildPreset('columns', ids)
  if (tree === null) throw new Error('no tree')
  return tree
}

interface Harness {
  /** Replaces the Nodes in the React Flow store, as the Canvas does when the Layout changes. */
  setNodes: (nodes: CanvasFlowNode[]) => void
  /** The tiling as focus mode last changed it. */
  tree: () => TileTree | undefined
  exits: () => number
}

interface LayerProps {
  start: TileTree
  onStore: (setNodes: Harness['setNodes']) => void
  onTree: (tree: TileTree) => void
  onExit: () => void
}

function Layer({ start, onStore, onTree, onExit }: LayerProps) {
  const [tree, setTree] = useState<TileTree | null>(start)
  const store = useStoreApi<CanvasFlowNode>()
  useEffect(() => onStore((nodes) => store.getState().setNodes(nodes)), [store, onStore])
  if (tree === null) return null
  return (
    <FocusMode
      tree={tree}
      onChange={(next) => {
        onTree(next)
        setTree(next)
      }}
      onExit={() => {
        onExit()
        setTree(null)
      }}
    />
  )
}

function open(ids: string[]): Harness {
  let setNodes: Harness['setNodes'] = () => {
    throw new Error('the store is not ready')
  }
  let tree: TileTree | undefined
  let exits = 0
  render(
    <ReactFlowProvider initialNodes={ids.map(flowNode)}>
      <Layer
        start={columns(ids)}
        onStore={(set) => {
          setNodes = set
        }}
        onTree={(next) => {
          tree = next
        }}
        onExit={() => {
          exits += 1
        }}
      />
    </ReactFlowProvider>,
  )
  return { setNodes: (nodes) => setNodes(nodes), tree: () => tree, exits: () => exits }
}

describe('keyboard focus', () => {
  let outside: HTMLButtonElement

  beforeEach(() => {
    outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.append(outside)
  })

  afterEach(() => {
    outside.remove()
  })

  it('moves into the layer, makes the rest of the window inert, and goes back on leaving', () => {
    outside.focus()
    const { unmount } = render(
      <ReactFlowProvider initialNodes={[flowNode('a')]}>
        <FocusMode tree={columns(['a'])} onChange={() => {}} onExit={() => {}} />
      </ReactFlowProvider>,
    )
    const layer = screen.getByTestId('focus-mode')
    expect(document.activeElement).toBe(layer)
    expect(outside.hasAttribute('inert')).toBe(true)
    expect(layer.hasAttribute('inert')).toBe(false)
    unmount()
    expect(outside.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(outside)
  })

  it('leaves an element inert that was inert before focus mode', () => {
    outside.setAttribute('inert', '')
    const { unmount } = render(
      <ReactFlowProvider initialNodes={[flowNode('a')]}>
        <FocusMode tree={columns(['a'])} onChange={() => {}} onExit={() => {}} />
      </ReactFlowProvider>,
    )
    unmount()
    expect(outside.hasAttribute('inert')).toBe(true)
  })

  it('does not go back to a Canvas Node that is out of view: React Flow would pan the Canvas to it', () => {
    const pane = document.createElement('div')
    pane.className = 'react-flow'
    const node = document.createElement('div')
    node.tabIndex = 0
    pane.append(node)
    document.body.append(pane)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    const where = vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 100, 200, 100))
    try {
      const layer = (
        <ReactFlowProvider initialNodes={[flowNode('a')]}>
          <FocusMode tree={columns(['a'])} onChange={() => {}} onExit={() => {}} />
        </ReactFlowProvider>
      )
      node.focus()
      render(layer).unmount()
      expect(document.activeElement).not.toBe(node)

      // The same Node in view gets the focus back.
      where.mockReturnValue(new DOMRect(700, 100, 200, 100))
      node.focus()
      render(layer).unmount()
      expect(document.activeElement).toBe(node)
    } finally {
      pane.remove()
    }
  })
})

describe('a Node that leaves the Canvas while focus mode is open', () => {
  it('leaves its tile when it is removed, and focus mode ends when no Node is left', () => {
    const harness = open(['a', 'b'])
    expect(screen.getAllByTestId('focus-tile')).toHaveLength(2)

    act(() => harness.setNodes([flowNode('a')]))
    expect(screen.getAllByTestId('focus-tile').map((tile) => tile.dataset.nodeId)).toEqual(['a'])
    expect(leafIds(harness.tree() ?? columns(['none']))).toEqual(['a'])
    expect(harness.exits()).toBe(0)

    act(() => harness.setNodes([]))
    expect(harness.exits()).toBe(1)
    expect(screen.queryByTestId('focus-mode')).toBeNull()
  })

  it('leaves its tile when it is hidden', () => {
    const harness = open(['a', 'b', 'c'])
    act(() => harness.setNodes([{ ...flowNode('a'), hidden: true }, flowNode('b'), flowNode('c')]))
    expect(screen.getAllByTestId('focus-tile').map((tile) => tile.dataset.nodeId)).toEqual(['b', 'c'])
    expect(harness.exits()).toBe(0)
  })
})

describe('dragging a title bar', () => {
  const AREA = new DOMRect(0, 0, 1000, 500)

  beforeEach(() => {
    const own = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.classList.contains('w-focus__area') ? AREA : own.call(this)
    })
    // jsdom has no pointer capture.
    if (!('setPointerCapture' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: () => {} })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** A pointer event of the primary button; `pressed` says whether the button is down while it fires. */
  const pointer = (type: string, x: number, y: number, pressed = type !== 'pointerup'): Event => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: pressed ? 1 : 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }

  it('swaps the tiles when the pointerup comes before React renders the last pointermove', () => {
    const harness = open(['a', 'b'])
    const title = screen.getAllByTestId('focus-tile-title')[0]
    if (title === undefined) throw new Error('no title bar')
    act(() => {
      title.dispatchEvent(pointer('pointerdown', 100, 10))
    })
    // One act: the pointermove's update is still queued when the pointerup is handled.
    act(() => {
      title.dispatchEvent(pointer('pointermove', 750, 250))
      title.dispatchEvent(pointer('pointerup', 750, 250))
    })
    expect(leafIds(harness.tree() ?? columns(['none']))).toEqual(['b', 'a'])
  })

  it('does nothing for a press that does not move', () => {
    const harness = open(['a', 'b'])
    const title = screen.getAllByTestId('focus-tile-title')[0]
    if (title === undefined) throw new Error('no title bar')
    act(() => {
      title.dispatchEvent(pointer('pointerdown', 100, 10))
    })
    act(() => {
      title.dispatchEvent(pointer('pointermove', 101, 11))
      title.dispatchEvent(pointer('pointerup', 101, 11))
    })
    expect(harness.tree()).toBeUndefined()
    expect(screen.getAllByTestId('focus-tile').map((tile) => tile.dataset.nodeId)).toEqual(['a', 'b'])
  })

  const titleOf = (index: number): HTMLElement => {
    const title = screen.getAllByTestId('focus-tile-title')[index]
    if (title === undefined) throw new Error('no title bar')
    return title
  }
  const tileOf = (id: string): HTMLElement => {
    const tile = screen.getAllByTestId('focus-tile').find((element) => element.dataset.nodeId === id)
    if (tile === undefined) throw new Error(`no tile ${id}`)
    return tile
  }
  const dragging = (): string | undefined => screen.getByTestId('focus-mode').querySelector<HTMLElement>('.w-focus__area')?.dataset.dragging

  // Chromium can drop the pointer capture mid-drag without a pointercancel: the events that follow
  // reach whatever is under the pointer, not the title bar.
  it('swaps the tiles when the title bar loses the pointer capture and the rest of the drag lands on another tile', () => {
    const harness = open(['a', 'b'])
    act(() => {
      titleOf(0).dispatchEvent(pointer('pointerdown', 100, 10))
    })
    act(() => {
      titleOf(0).dispatchEvent(pointer('pointermove', 300, 100))
      titleOf(0).dispatchEvent(new MouseEvent('lostpointercapture', { bubbles: true }))
    })
    act(() => {
      tileOf('b').dispatchEvent(pointer('pointermove', 750, 250))
      tileOf('b').dispatchEvent(pointer('pointerup', 750, 250))
    })
    expect(leafIds(harness.tree() ?? columns(['none']))).toEqual(['b', 'a'])
    expect(dragging()).toBeUndefined()
  })

  // A pointermove with no button pressed, from the real cursor while another window appears under
  // it, came in the middle of an e2e drag: it is not a release.
  it('keeps the drag going through a pointermove with the button up', () => {
    const harness = open(['a', 'b'])
    act(() => {
      titleOf(0).dispatchEvent(pointer('pointerdown', 100, 10))
    })
    act(() => {
      tileOf('b').dispatchEvent(pointer('pointermove', 750, 250))
    })
    act(() => {
      tileOf('a').dispatchEvent(pointer('pointermove', 100, 250, false))
    })
    expect(dragging()).toBe('true')
    expect(tileOf('b').dataset.dropZone).toBe('center')
    act(() => {
      tileOf('b').dispatchEvent(pointer('pointermove', 760, 250))
      tileOf('b').dispatchEvent(pointer('pointerup', 760, 250))
    })
    expect(leafIds(harness.tree() ?? columns(['none']))).toEqual(['b', 'a'])
  })

  it('drops nothing when a new press shows that the release was missed', () => {
    const harness = open(['a', 'b'])
    act(() => {
      titleOf(0).dispatchEvent(pointer('pointerdown', 100, 10))
    })
    act(() => {
      tileOf('b').dispatchEvent(pointer('pointermove', 750, 250))
    })
    act(() => {
      tileOf('b').dispatchEvent(pointer('pointerdown', 750, 250))
    })
    expect(dragging()).toBeUndefined()
    act(() => {
      tileOf('b').dispatchEvent(pointer('pointerup', 750, 250))
    })
    expect(harness.tree()).toBeUndefined()
  })

  it('drops nothing after a pointercancel', () => {
    const harness = open(['a', 'b'])
    act(() => {
      titleOf(0).dispatchEvent(pointer('pointerdown', 100, 10))
    })
    act(() => {
      tileOf('b').dispatchEvent(pointer('pointermove', 750, 250))
      tileOf('b').dispatchEvent(pointer('pointercancel', 750, 250))
      tileOf('b').dispatchEvent(pointer('pointerup', 750, 250))
    })
    expect(harness.tree()).toBeUndefined()
    expect(dragging()).toBeUndefined()
  })
})

describe('dragging a divider', () => {
  const AREA = new DOMRect(0, 0, 1000, 500)

  beforeEach(() => {
    const own = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.classList.contains('w-focus__area') ? AREA : own.call(this)
    })
    if (!('setPointerCapture' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: () => {} })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const pointer = (type: string, x: number, pressed = type !== 'pointerup'): Event => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: pressed ? 1 : 0, clientX: x, clientY: 250 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }

  it('follows the pointer after it has left the divider, and stops at the pointerup', () => {
    const harness = open(['a', 'b'])
    const divider = screen.getByTestId('focus-divider')
    act(() => {
      divider.dispatchEvent(pointer('pointerdown', 500))
    })
    // Off the 8 px divider, over tile b: the events no longer reach the divider itself.
    const over = screen.getAllByTestId('focus-tile')[1]
    if (over === undefined) throw new Error('no tile')
    act(() => {
      over.dispatchEvent(pointer('pointermove', 600))
      over.dispatchEvent(pointer('pointerup', 600))
    })
    const moved = harness.tree()
    expect(moved?.kind === 'split' ? moved.sizes.map((size) => Math.round(size * 10) / 10) : moved).toEqual([0.6, 0.4])
    act(() => {
      over.dispatchEvent(pointer('pointermove', 800))
    })
    expect(harness.tree()).toBe(moved)
  })

  it('stops following the pointer when focus mode closes mid-drag', () => {
    const harness = open(['a', 'b'])
    act(() => {
      screen.getByTestId('focus-divider').dispatchEvent(pointer('pointerdown', 500))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    })
    expect(harness.exits()).toBe(1)
    act(() => {
      document.body.dispatchEvent(pointer('pointermove', 600))
    })
    expect(harness.tree()).toBeUndefined()
  })
})
