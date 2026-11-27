// A Product Session's Node on the Canvas (src/renderer/canvas/nodes/SessionNode.tsx,
// worfy-product-session ticket 06): still a Session Node, told apart by the label «Product Session»
// where a plain Session's Node says «Session». The kind comes from the Node's data, and from main's
// view while the Session runs.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import { installHeaderLayout, menuItems, type HeaderLayout } from './session-header-layout'

// Imported once while the file is collected (see session-node-drop.test.tsx): the first import of
// the Node transforms every renderer module it reaches, too slow for one test on a loaded machine.
const { TITLE_MIN } = await import('../../src/renderer/canvas/nodes/SessionNode')

const ROOT = '/Users/test/projects/demo'
const PROJECT = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }
const NODE = 'session-node-1'
const SAVED = 'dddddddd-0000-4000-8000-000000000004'

/** main's views of the Node's Session: none means it is not running. */
let views: SessionNodeView[]
/** Every `layout.apply` the Node sent, oldest first. */
let applied: unknown[]
/** Every channel the Node asked, oldest first. */
let asked: string[]
/** Every operation the Node gave the Canvas (useLayoutOps), oldest first. */
let operations: unknown[]

const view = (over: Partial<SessionNodeView> = {}): SessionNodeView => ({
  projectId: PROJECT.id,
  nodeId: NODE,
  vendor: 'claude',
  sessionId: 'live-1',
  sdkSessionId: null,
  state: 'idle',
  error: null,
  cwd: ROOT,
  model: null,
  version: 1,
  ...over,
})

beforeEach(() => {
  vi.resetModules()
  views = []
  applied = []
  asked = []
  operations = []
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: unknown) => {
      asked.push(channel)
      if (channel === 'layout.apply') applied.push(input)
      const value: unknown =
        channel === 'projects.list'
          ? { projects: [PROJECT], activeId: PROJECT.id, revision: 1 }
          : channel === 'claudeHome.sessions'
            ? { live: [], history: [] }
            : channel === 'claudeHome.live'
              ? { live: [] }
              : channel === 'sessions.views'
                ? { views }
                : undefined
      return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Renders a Session Node with `data` and answers it once its status chip says `status`. */
async function mount(data: Record<string, unknown>, status: string, fields: Record<string, unknown> = {}): Promise<HTMLElement> {
  const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
  // The Canvas's own operations, as the Canvas gives them to its Nodes: Keep, Hide and Remove go there.
  const { LayoutOpsContext } = await import('../../src/renderer/canvas/useLayout')
  const ops = { apply: (op: unknown) => (operations.push(op), Promise.resolve()) } as unknown as Parameters<typeof LayoutOpsContext.Provider>[0]['value']
  const props = { id: NODE, data: { node: { id: NODE, kind: 'session', data, ...fields } }, selected: false } as unknown as CanvasNodeProps
  render(
    <ReactFlowProvider>
      <LayoutOpsContext.Provider value={ops}>
        <SessionNode {...props} />
      </LayoutOpsContext.Provider>
    </ReactFlowProvider>,
  )
  await vi.waitFor(() => expect(screen.getByTestId('session-node').getAttribute('data-status')).toBe(status))
  return screen.getByTestId('session-node')
}

describe('the label of a Product Session on the Canvas', () => {
  it('a new Node of kind product says «Product Session», in its label and in its name', async () => {
    const node = await mount({ origin: 'worfy', kind: 'product' }, 'new')
    expect(screen.getByTestId('session-node-kind').textContent).toBe('Product Session')
    expect(node.getAttribute('aria-label')).toBe('New Product Session')
    expect(node.getAttribute('data-session-kind')).toBe('product')
    expect(screen.getByTestId('session-node-title').textContent).toBe('New Product Session')
  })

  it('a finished one keeps the label, and its name says Product Session, not Session', async () => {
    const node = await mount({ origin: 'worfy', kind: 'product', sessionId: SAVED }, 'finished')
    expect(screen.getByTestId('session-node-kind').textContent).toBe('Product Session')
    expect(node.getAttribute('aria-label')).toBe(`Product Session ${SAVED.slice(0, 8)}`)
  })

  it('a running one takes the kind from main’s view as well', async () => {
    views = [view({ kind: 'product' })]
    await mount({ origin: 'worfy' }, 'idle')
    expect(screen.getByTestId('session-node-kind').textContent).toBe('Product Session')
  })

  it('a plain Session has no such label and is named a Session, as before', async () => {
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    expect(screen.queryByTestId('session-node-kind')).toBeNull()
    expect(node.getAttribute('data-session-kind')).toBeNull()
    expect(node.getAttribute('aria-label')).toBe(`Session ${SAVED.slice(0, 8)}`)
    expect(screen.getByTestId('session-node-title').textContent).toBe(`Session ${SAVED.slice(0, 8)}`)
  })

  it('a kind this build does not know is no Product Session', async () => {
    await mount({ origin: 'worfy', kind: 'later-kind', sessionId: SAVED }, 'finished')
    expect(screen.queryByTestId('session-node-kind')).toBeNull()
  })
})

describe('Archive on a Session Node (worfy-product-session ticket 37)', () => {
  it('a finished Product Session offers Archive: one `archive` of this Node alone, sent with the screen as the user\'s gesture', async () => {
    await mount({ origin: 'worfy', kind: 'product', sessionId: SAVED }, 'finished')
    const archive = screen.getByTestId('session-node-archive')
    expect(archive.textContent).toBe('Archive')
    expect((archive as HTMLButtonElement).disabled).toBe(false)
    expect(archive.getAttribute('title')).toMatch(/nothing is deleted/)
    // Not in the header beside the title: there it left a 300 px Node's title no room (CI windows-e2e of PR #2194).
    expect(screen.getByTestId('session-node-title').parentElement!.contains(archive)).toBe(false)
    fireEvent.click(archive)
    await vi.waitFor(() => expect(applied).toHaveLength(1))
    expect(applied[0]).toMatchObject({ projectId: PROJECT.id, op: { op: 'archive', nodes: [{ id: NODE }] } })
    expect((applied[0] as { screen?: unknown }).screen).toEqual(expect.any(String))
  })

  it('a plain finished Session offers it too', async () => {
    await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    expect((screen.getByTestId('session-node-archive') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a running Session offers it inactive, saying why; a click sends nothing', async () => {
    views = [view({ kind: 'product' })]
    await mount({ origin: 'worfy', kind: 'product', sessionId: SAVED }, 'idle')
    const running = screen.getByTestId('session-node-archive') as HTMLButtonElement
    expect(running.disabled).toBe(true)
    expect(running.getAttribute('title')).toBe('Close the Session before archiving its Node')
    fireEvent.click(running)
    expect(applied).toEqual([])
  })

  it('a kept Node offers it inactive, as main would drop it from the archive; Keep is named first', async () => {
    await mount({ origin: 'worfy', kind: 'product', sessionId: SAVED }, 'finished', { keep: true, pinned: true })
    const kept = screen.getByTestId('session-node-archive') as HTMLButtonElement
    expect(kept.disabled).toBe(true)
    expect(kept.getAttribute('title')).toBe('Kept on the Canvas: press Kept to let it go first')
  })

  it('a pinned Node without Keep offers it inactive too, saying it is pinned', async () => {
    await mount({ origin: 'worfy', kind: 'product', sessionId: SAVED }, 'finished', { pinned: true })
    const pinned = screen.getByTestId('session-node-archive') as HTMLButtonElement
    expect(pinned.disabled).toBe(true)
    expect(pinned.getAttribute('title')).toBe('Pinned to the screen: unpin it first')
    fireEvent.click(pinned)
    expect(applied).toEqual([])
  })

  it('a Session that has not started offers it inactive, saying why', async () => {
    await mount({ origin: 'worfy', kind: 'product' }, 'new')
    const fresh = screen.getByTestId('session-node-archive') as HTMLButtonElement
    expect(fresh.disabled).toBe(true)
    expect(fresh.getAttribute('title')).toBe('Nothing to archive yet: the Session has not started')
    expect(applied).toEqual([])
  })
})

// worfy-polish ticket 153: when the header has no room for the title at its minimum, the header's buttons
// go into one «⋯» menu, one at a time from the end (Remove, Hide, Keep), the action of the state last.
// The menu's items are the same actions, with the same names, tooltips and inactive states.
describe('the header of a worfy Session Node: buttons into the «⋯» menu before the title gets unreadable', () => {
  let layout: HeaderLayout | undefined
  afterEach(() => {
    cleanup()
    layout?.restore()
    layout = undefined
  })

  /** The names of the buttons in the header itself. */
  const headerButtons = (): string[] => within(screen.getByTestId('session-node-header')).queryAllByRole('button').map((button) => button.textContent ?? '')
  const menu = () => screen.getByRole('menu', { name: 'Session actions' })

  it('a wide header keeps every button outside, and there is no menu', async () => {
    layout = installHeaderLayout(600)
    await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    expect(headerButtons()).toEqual(['Resume', 'Keep', 'Hide', 'Remove'])
    expect(screen.queryByTestId('session-node-more')).toBeNull()
  })

  it('a 240 px header puts them all in the menu, the title keeps its minimum, and the items are the same actions', async () => {
    layout = installHeaderLayout(240)
    await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    expect(headerButtons()).toEqual(['⋯'])
    expect(layout.titleWidth()).toBeGreaterThanOrEqual(TITLE_MIN)
    fireEvent.click(screen.getByTestId('session-node-more'))
    const items = menuItems(menu())
    expect(items.map((item) => item.textContent)).toEqual(['Resume', 'Keep', 'Hide', 'Remove'])
    expect(items.map((item) => item.getAttribute('title'))).toEqual([
      'Continue this Session in worfy',
      'Keep this Session on the Canvas: the archive leaves it',
      'Hide the Node; the Session goes on',
      'Remove the Node; the transcript stays',
    ])
    expect(within(menu()).getByRole('menuitemcheckbox', { name: 'Keep' }).getAttribute('aria-checked')).toBe('false')
    expect(items.every((item) => item.getAttribute('aria-disabled') !== 'true')).toBe(true)
    // Choosing an item runs its action, as the button does: Resume starts the Session.
    await act(async () => {
      fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Resume' }))
    })
    await vi.waitFor(() => expect(asked).toContain('sessions.start'))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByTestId('session-node-more'))
    await act(async () => {
      fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Hide' }))
    })
    expect(operations).toEqual([{ op: 'hide', id: NODE, hidden: true }])
    fireEvent.click(screen.getByTestId('session-node-more'))
    await act(async () => {
      fireEvent.click(within(menu()).getByRole('menuitemcheckbox', { name: 'Keep' }))
    })
    expect(operations.at(-1)).toEqual({ op: 'keep', id: NODE, keep: true })
  })

  it('a header a little short goes one button at a time from the end, and a button comes back only with room to spare', async () => {
    // FIXED + TITLE_MIN + 4 buttons is 404 px; with Remove in the menu, 374 px.
    layout = installHeaderLayout(390)
    await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    expect(headerButtons()).toEqual(['Resume', 'Keep', 'Hide', '⋯'])
    expect(screen.getByTestId('session-node-title').style.minWidth).toBe(`${TITLE_MIN}px`)
    // Just wide enough for Remove again: it stays in the menu, so it does not jump back and forth at the edge.
    layout.resize(405)
    expect(headerButtons()).toEqual(['Resume', 'Keep', 'Hide', '⋯'])
    layout.resize(420)
    expect(headerButtons()).toEqual(['Resume', 'Keep', 'Hide', 'Remove'])
    layout.resize(400)
    expect(headerButtons()).toEqual(['Resume', 'Keep', 'Hide', '⋯'])
  })

  it('a running Session: Remove in the menu is inactive, saying why, and choosing it sends nothing', async () => {
    views = [view()]
    layout = installHeaderLayout(240)
    await mount({ origin: 'worfy', sessionId: SAVED }, 'idle')
    expect(headerButtons()).toEqual(['⋯'])
    fireEvent.click(screen.getByTestId('session-node-more'))
    expect(menuItems(menu()).map((item) => item.textContent)).toEqual(['Close', 'Keep', 'Hide', 'Remove'])
    const remove = within(menu()).getByRole('menuitem', { name: 'Remove' })
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    expect(remove.getAttribute('title')).toBe('Close the Session before removing its Node')
    await act(async () => {
      fireEvent.click(remove)
    })
    expect(operations).toEqual([])
    expect(screen.getByRole('menu', { name: 'Session actions' })).toBeTruthy()
  })
})
