// Focus mode's layer (src/renderer/focus/FocusMode.tsx) over a React Flow store with no Canvas:
// where the keyboard focus goes, Nodes that leave the Canvas while their tile is open, and a
// title-bar drag whose pointerup arrives before React has rendered the pointermove before it.
// Inside the window shell (src/renderer/shell/AppShell.tsx) the layer covers the main area and
// leaves the sidebar working: what is inert, which Esc leaves, where the focus ends up. And the way
// in (src/renderer/canvas/overlays/FocusEntry.tsx) leaves focus mode when the main area is asked
// to show something else.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasFlowNode } from '../../src/renderer/canvas/nodes/index'
import FocusEntry from '../../src/renderer/canvas/overlays/FocusEntry'
import { focusEpic, requestRepack } from '../../src/renderer/canvas/sources/epics'
import { focusSessionNode } from '../../src/renderer/claude-home/focus'
import { closeFind, createCanvasNode, focusCanvasNode, markAdrHandled, openAdr, openFind, requestArrangeByEpic, requestTidyUp, setTagFilter } from '../../src/renderer/find/canvas-requests'
import { FocusMode } from '../../src/renderer/focus/FocusMode'
import { focusModeActive, useFocusState } from '../../src/renderer/focus/focus-state'
import { buildPreset, leafIds, type TileTree } from '../../src/renderer/focus/split-tree'
import { openSession, setView } from '../../src/renderer/session/navigation'
import { AppShell } from '../../src/renderer/shell/AppShell'


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

describe('inside the window shell', () => {
  /** The shell, and then focus mode opened over its Canvas view, as FocusEntry opens it in a shell already on screen. */
  function openInShell(): { exits: () => number } {
    let exits = 0
    const { rerender } = render(<AppShell />)
    rerender(
      <AppShell
        canvas={
          <ReactFlowProvider initialNodes={[flowNode('a')]}>
            <Layer
              start={columns(['a'])}
              onStore={() => {}}
              onTree={() => {}}
              onExit={() => {
                exits += 1
              }}
            />
          </ReactFlowProvider>
        }
      />,
    )
    return { exits: () => exits }
  }

  const layer = (): HTMLElement => screen.getByTestId('focus-mode')
  const sidebar = (): HTMLElement => screen.getByRole('navigation', { name: 'Sidebar' })
  /** A control of the sidebar: the heading of its first section. */
  const sidebarButton = (): HTMLElement => {
    const button = within(sidebar()).getAllByRole('button')[0]
    if (button === undefined) throw new Error('the sidebar has no button')
    return button
  }
  const one = (selector: string): HTMLElement => {
    const found = document.querySelector<HTMLElement>(selector)
    if (found === null) throw new Error(`nothing matches ${selector}`)
    return found
  }
  /** Esc pressed where the keyboard focus is, as the browser sends it. */
  function pressEscape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      ;(document.activeElement ?? document.body).dispatchEvent(event)
    })
    return event
  }
  /** Takes the keyboard focus off every element: it is on <body>, as after a click on plain text. */
  function focusNowhere(): void {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    expect(document.activeElement).toBe(document.body)
  }

  it('draws the layer in the main area: the toolbar and the view under it are inert, the sidebar and the page are not', () => {
    openInShell()
    expect(layer().parentElement).toBe(one('.w-shell__main'))
    expect(useFocusState.getState().slot).toBe(one('.w-shell__main'))
    expect(one('.w-toolbar').hasAttribute('inert')).toBe(true)
    expect(one('.w-shell__content').hasAttribute('inert')).toBe(true)
    expect(layer().closest('[inert]')).toBeNull()
    // The sidebar is next to the main area, not in it: nothing above it is inert either.
    expect(sidebar().closest('[inert]')).toBeNull()
    expect([...document.body.children].filter((element) => element.hasAttribute('inert'))).toEqual([])
    expect(document.activeElement).toBe(layer())
    expect(focusModeActive()).toBe(true)

    pressEscape()
    expect(screen.queryByTestId('focus-mode')).toBeNull()
    expect(one('.w-toolbar').hasAttribute('inert')).toBe(false)
    expect(one('.w-shell__content').hasAttribute('inert')).toBe(false)
    expect(focusModeActive()).toBe(false)
  })

  it('is a region named "Focus mode", not a modal dialog: the sidebar next to it is in reach', () => {
    openInShell()
    expect(screen.getByRole('region', { name: 'Focus mode' })).toBe(layer())
    expect(layer().hasAttribute('aria-modal')).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the shell takes its main area back when it leaves: the next layer is drawn on <body>', () => {
    const { unmount } = render(<AppShell />)
    expect(useFocusState.getState().slot).toBe(one('.w-shell__main'))
    unmount()
    expect(useFocusState.getState().slot).toBeNull()
    render(
      <ReactFlowProvider initialNodes={[flowNode('a')]}>
        <FocusMode tree={columns(['a'])} onChange={() => {}} onExit={() => {}} />
      </ReactFlowProvider>,
    )
    expect(layer().parentElement).toBe(document.body)
  })

  describe('Esc', () => {
    it('leaves with the focus on the layer', () => {
      const harness = openInShell()
      expect(document.activeElement).toBe(layer())
      expect(pressEscape().defaultPrevented).toBe(true)
      expect(harness.exits()).toBe(1)
    })

    it('leaves with the focus on a control inside the layer', () => {
      const harness = openInShell()
      within(layer()).getByRole('button', { name: 'Columns' }).focus()
      expect(pressEscape().defaultPrevented).toBe(true)
      expect(harness.exits()).toBe(1)
    })

    it('leaves with the focus nowhere (on <body>)', () => {
      const harness = openInShell()
      focusNowhere()
      expect(pressEscape().defaultPrevented).toBe(true)
      expect(harness.exits()).toBe(1)
    })

    it('does not leave with the focus in the sidebar, and leaves the press to the sidebar', () => {
      const harness = openInShell()
      sidebarButton().focus()
      expect(document.activeElement).toBe(sidebarButton())
      expect(pressEscape().defaultPrevented).toBe(false)
      expect(harness.exits()).toBe(0)
      expect(screen.getByTestId('focus-mode')).toBeTruthy()
    })

    it('does not leave when somebody took the press before', () => {
      const harness = openInShell()
      const take = (event: Event): void => event.preventDefault()
      layer().addEventListener('keydown', take)
      pressEscape()
      expect(harness.exits()).toBe(0)
    })

    // A menu or a dialog open outside the layer while the focus is in the layer or nowhere. It gets
    // the press first, and whether it took it is known only once every listener has run: its own
    // may sit on the window after focus mode's (the ADR panel). One that did not react is not in
    // the way — the press leaves focus mode. There is no state in which Esc does nothing.
    describe('with a menu or a dialog open outside the layer', () => {
      type Reaction = 'does not react' | 'closes and calls preventDefault' | 'closes without preventDefault' | 'hides itself'
      const undo: (() => void)[] = []

      afterEach(() => {
        for (const each of undo.splice(0)) each()
      })

      /** A popup of `role` in `parent` that reacts to Esc from a listener added to the window now, after focus mode's. */
      function openPopup(role: string, parent: HTMLElement, reaction: Reaction): HTMLElement {
        const popup = document.createElement('div')
        popup.setAttribute('role', role)
        popup.tabIndex = -1
        parent.append(popup)
        const onKeyDown = (event: KeyboardEvent): void => {
          if (event.key !== 'Escape' || reaction === 'does not react' || !popup.isConnected || popup.hidden) return
          if (reaction === 'closes and calls preventDefault') event.preventDefault()
          if (reaction === 'hides itself') popup.hidden = true
          else popup.remove()
        }
        window.addEventListener('keydown', onKeyDown)
        undo.push(() => {
          window.removeEventListener('keydown', onKeyDown)
          popup.remove()
        })
        return popup
      }
      const isOpen = (popup: HTMLElement): boolean => popup.isConnected && !popup.hidden
      /** Lets the task of the press end: what focus mode put off until every listener has run happens here. */
      const afterThePress = (): Promise<void> => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))

      describe.each<[string, () => void]>([
        ['on the layer', () => layer().focus()],
        ['nowhere', () => focusNowhere()],
      ])('and the focus %s', (_where, putFocus) => {
        it.each<[string, string, () => HTMLElement]>([
          ['a dialog of the sidebar', 'dialog', () => sidebar()],
          ['a menu of the sidebar', 'menu', () => sidebar()],
          ['a dialog drawn on <body>', 'dialog', () => document.body],
        ])('%s that does not react to Esc is not in the way: the press leaves focus mode and it stays open', async (_name, role, parent) => {
          const harness = openInShell()
          const popup = openPopup(role, parent(), 'does not react')
          putFocus()
          pressEscape()
          await afterThePress()
          expect(harness.exits()).toBe(1)
          expect(screen.queryByTestId('focus-mode')).toBeNull()
          expect(isOpen(popup)).toBe(true)
        })

        it.each<Reaction>(['closes and calls preventDefault', 'closes without preventDefault', 'hides itself'])(
          'one that %s on the press gets it — one press, one action — and the next press leaves focus mode',
          async (reaction) => {
            const harness = openInShell()
            const popup = openPopup('dialog', document.body, reaction)
            putFocus()
            pressEscape()
            await afterThePress()
            expect(isOpen(popup)).toBe(false)
            expect(harness.exits()).toBe(0)
            expect(screen.getByTestId('focus-mode')).toBeTruthy()
            // Nothing is open outside the layer any more: this press is focus mode's at once.
            expect(pressEscape().defaultPrevented).toBe(true)
            expect(harness.exits()).toBe(1)
          },
        )
      })

      it('a menu under the layer in what a Browser tile has hidden (not inert) is not outside: the press leaves at once (worfy-browser ticket 17)', () => {
        const harness = openInShell()
        // As focus mode covers the view while a tile shows a Browser: hidden, not inert.
        const view = one('.w-shell__content')
        view.removeAttribute('inert')
        view.setAttribute('data-focus-covered', '')
        undo.push(() => view.removeAttribute('data-focus-covered'))
        openPopup('menu', view, 'does not react')
        layer().focus()
        expect(pressEscape().defaultPrevented).toBe(true)
        expect(harness.exits()).toBe(1)
      })

      it('one that takes the press (preventDefault) and stays open keeps it: a dialog that closed a list of its own', async () => {
        const harness = openInShell()
        const popup = openPopup('dialog', document.body, 'does not react')
        const take = (event: KeyboardEvent): void => {
          if (event.key === 'Escape') event.preventDefault()
        }
        // Added after focus mode's listener, as the dialog's own would be.
        window.addEventListener('keydown', take)
        undo.push(() => window.removeEventListener('keydown', take))
        pressEscape()
        await afterThePress()
        expect(harness.exits()).toBe(0)
        expect(isOpen(popup)).toBe(true)
      })

      it('with the focus inside a popup that does not react the press is not focus mode\'s, as anywhere outside the layer', async () => {
        const harness = openInShell()
        const popup = openPopup('dialog', sidebar(), 'does not react')
        popup.focus()
        expect(document.activeElement).toBe(popup)
        pressEscape()
        await afterThePress()
        expect(harness.exits()).toBe(0)
        expect(isOpen(popup)).toBe(true)
      })

      it('a press somebody in the layer took first is not focus mode\'s later either', async () => {
        const harness = openInShell()
        openPopup('dialog', sidebar(), 'does not react')
        layer().addEventListener('keydown', (event) => event.preventDefault())
        pressEscape()
        await afterThePress()
        expect(harness.exits()).toBe(0)
      })

      it('a leave that was put off is dropped when focus mode closes before it: nothing leaves twice', async () => {
        const harness = openInShell()
        openPopup('dialog', sidebar(), 'does not react')
        pressEscape()
        expect(harness.exits()).toBe(0)
        fireEvent.click(within(layer()).getByRole('button', { name: /^Exit focus/ }))
        expect(harness.exits()).toBe(1)
        await afterThePress()
        expect(harness.exits()).toBe(1)
      })

      it('two presses in a row over a popup that does not react leave once', async () => {
        const harness = openInShell()
        openPopup('menu', sidebar(), 'does not react')
        pressEscape()
        pressEscape()
        await afterThePress()
        expect(harness.exits()).toBe(1)
      })
    })

    // The context menus of the sidebar close on Esc themselves and do not call preventDefault. By
    // the time the press has bubbled up to the window the menu is out of the page and the focus it
    // held is on <body>: whose press it was has to be read before that.
    it.each([
      ['a menu drawn on <body>', 'menu', () => document.body],
      ['a field of the sidebar', 'textbox', () => sidebar()],
    ])('does not leave on the press that closes %s holding the focus, though it is gone when the press gets to the window', (_name, role, parent) => {
      const harness = openInShell()
      const popup = document.createElement('div')
      popup.setAttribute('role', role)
      popup.tabIndex = -1
      popup.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') popup.remove()
      })
      parent().append(popup)
      popup.focus()
      expect(document.activeElement).toBe(popup)
      expect(pressEscape().defaultPrevented).toBe(false)
      expect(popup.isConnected).toBe(false)
      expect(document.activeElement).toBe(document.body)
      expect(harness.exits()).toBe(0)
      // The next press, with the focus nowhere, is focus mode's.
      pressEscape()
      expect(harness.exits()).toBe(1)
    })

    it('leaves over a dialog the layer covers, a hidden one, and one inside the layer: none of them is in the way', () => {
      const harness = openInShell()
      const dialog = (): HTMLElement => {
        const element = document.createElement('div')
        element.setAttribute('role', 'dialog')
        return element
      }
      const covered = dialog()
      one('.w-shell__content').append(covered)
      const hidden = dialog()
      const holder = document.createElement('div')
      holder.hidden = true
      holder.append(hidden)
      document.body.append(holder)
      const inside = dialog()
      layer().append(inside)
      try {
        pressEscape()
        expect(harness.exits()).toBe(1)
      } finally {
        covered.remove()
        holder.remove()
      }
    })
  })

  describe('the keyboard focus on leaving', () => {
    it('goes back to where it was before focus mode, a control of the sidebar too', () => {
      const harness = { exits: 0 }
      function Opener() {
        const [tree, setTree] = useState<TileTree | null>(null)
        return (
          <ReactFlowProvider initialNodes={[flowNode('a')]}>
            <button type="button" onClick={() => setTree(columns(['a']))}>
              open
            </button>
            {tree === null ? null : (
              <FocusMode
                tree={tree}
                onChange={setTree}
                onExit={() => {
                  harness.exits += 1
                  setTree(null)
                }}
              />
            )}
          </ReactFlowProvider>
        )
      }
      // The opener stands in the sidebar's place: outside the main area, so never inert.
      render(
        <>
          <Opener />
          <AppShell />
        </>,
      )
      const before = sidebarButton()
      before.focus()
      fireEvent.click(screen.getByRole('button', { name: 'open' }))
      expect(document.activeElement).toBe(layer())
      pressEscape()
      expect(harness.exits).toBe(1)
      expect(document.activeElement).toBe(before)
    })

    // No rule of focus mode's own: React puts the focus back on the element that had it before the
    // layer left the page. The test keeps that from changing unnoticed.
    it('stays in the sidebar when it went there meanwhile: leaving does not take it to the Canvas', () => {
      outsideFocus(() => {
        openInShell()
        const row = sidebarButton()
        row.focus()
        // A click does not move the focus in jsdom: the focus is still on the sidebar's control.
        fireEvent.click(within(layer()).getByRole('button', { name: /^Exit focus/ }))
        expect(screen.queryByTestId('focus-mode')).toBeNull()
        expect(document.activeElement).toBe(row)
      })
    })

    /** Runs `body` with the focus on a button of the page first, so focus mode has somewhere to go back to. */
    function outsideFocus(body: () => void): void {
      const before = document.createElement('button')
      document.body.append(before)
      before.focus()
      try {
        body()
      } finally {
        before.remove()
      }
    }
  })

  it('the bar carries the button that hides and shows the sidebar, and says whether the sidebar is there', () => {
    openInShell()
    const bar = one('.w-focus__bar')
    expect(bar.dataset.sidebar).toBe('visible')
    // The first control of the bar, left of the title.
    const hide = within(layer()).getByRole('button', { name: 'Hide sidebar' })
    expect(bar.firstElementChild).toBe(hide)
    expect(hide.getAttribute('aria-pressed')).toBe('true')
    expect(hide.getAttribute('title')).toBe('Hide sidebar (⌘B)')
    fireEvent.click(hide)
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull()
    expect(bar.dataset.sidebar).toBe('hidden')
    const show = within(layer()).getByRole('button', { name: 'Show sidebar' })
    expect(show.getAttribute('aria-pressed')).toBe('false')
    // Shown again, so the tests after this one start with the sidebar.
    fireEvent.click(show)
    expect(sidebar()).toBeTruthy()
    expect(bar.dataset.sidebar).toBe('visible')
  })
})

describe('the way in (FocusEntry) leaves focus mode when the main area is asked for something else', () => {
  let restore: (() => void)[] = []

  beforeEach(() => {
    // jsdom lays nothing out: every element is "on screen", and React Flow gets an observer that reports nothing.
    const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
    const globals = globalThis as { ResizeObserver?: unknown }
    const observer = globals.ResizeObserver
    globals.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    restore = [
      () => {
        if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent)
        if (observer === undefined) delete globals.ResizeObserver
        else globals.ResizeObserver = observer
      },
    ]
    act(() => {
      setView('canvas')
      setTagFilter(null)
    })
  })

  afterEach(() => {
    for (const undo of restore) undo()
    act(() => {
      setView('canvas')
      setTagFilter(null)
    })
  })

  /** A Canvas with one selected Node and the way into focus mode; ⌘↩ opens focus mode over the selection. */
  async function openFromCanvas(): Promise<void> {
    render(
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={[{ ...flowNode('a'), selected: true }]}>
          <FocusEntry />
        </ReactFlow>
      </div>,
    )
    expect(screen.queryByTestId('focus-mode')).toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
    })
    expect(screen.getByTestId('focus-mode')).toBeTruthy()
  }

  it.each<[string, () => void]>([
    ['the Session view', () => setView('session')],
    ['a Session opened in the Session view', () => openSession({ nodeId: 's', projectId: 'p' })],
    ['an Epic of the sidebar (focusEpic)', () => focusEpic('p', 'demo')],
    ['a Session of the sidebar (focusSessionNode)', () => focusSessionNode('p', 'session-1')],
    ['"Go to" of the palette (focusCanvasNode)', () => focusCanvasNode('p', 'n1')],
    ['a new Node (createCanvasNode)', () => createCanvasNode('p', 'note')],
    ['"Tidy up" (requestTidyUp)', () => requestTidyUp('p')],
    ['"Re-pack" of the palette (requestRepack)', () => requestRepack('p')],
    ['"Arrange by Epic" of the palette (requestArrangeByEpic)', () => requestArrangeByEpic('p')],
    ['a tag filter (setTagFilter)', () => setTagFilter({ projectId: 'p', tag: 'urgent' })],
    ['an ADR (openAdr)', () => openAdr('p', 'docs/adr/0001-first.md')],
  ])('leaves on %s', async (_name, request) => {
    await openFromCanvas()
    act(request)
    expect(screen.queryByTestId('focus-mode')).toBeNull()
    expect(focusModeActive()).toBe(false)
  })

  it('leaves on a request repeated word for word, and on a tag filter taken off', async () => {
    act(() => {
      focusEpic('p', 'again')
      setTagFilter({ projectId: 'p', tag: 'urgent' })
    })
    await openFromCanvas()
    act(() => focusEpic('p', 'again'))
    expect(screen.queryByTestId('focus-mode')).toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
    })
    expect(screen.getByTestId('focus-mode')).toBeTruthy()
    act(() => setTagFilter(null))
    expect(screen.queryByTestId('focus-mode')).toBeNull()
  })

  it('stays for what asks the main area for nothing: requests made before it opened, the find bar, an ADR marked as shown, the Canvas view named again', async () => {
    act(() => {
      focusEpic('p', 'before')
      focusSessionNode('p', 'before')
      focusCanvasNode('p', 'before')
      openAdr('p', 'docs/adr/0002-before.md')
    })
    await openFromCanvas()
    act(() => {
      openFind()
      closeFind()
      markAdrHandled(99)
      setView('canvas')
      setTagFilter(null)
    })
    expect(screen.getByTestId('focus-mode')).toBeTruthy()
  })

  it('stops listening once focus mode is closed: a later request opens nothing and breaks nothing', async () => {
    await openFromCanvas()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(screen.queryByTestId('focus-mode')).toBeNull()
    act(() => focusEpic('p', 'later'))
    expect(screen.queryByTestId('focus-mode')).toBeNull()
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
