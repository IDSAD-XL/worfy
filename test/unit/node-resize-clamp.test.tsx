// The resize mark of NodeResizeClamp (worfy-week ticket 09): from the start of a resize to its end
// the React Flow root carries data-node-resizing, and canvas.css turns the mouse off for every
// iframe on the Canvas while it is there. jsdom applies no CSS and has no iframe of another origin,
// so the effect itself is test/e2e/card-drag.spec.ts; here is the mark. React Flow's NodeResizer is
// replaced by a stand-in that keeps the handlers the wrapper hands it, so the test plays the start
// and the end of a resize directly.
import { render } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi, type NodeResizerProps, type ResizeParams } from '@xyflow/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeResizeClamp, RESIZING_ATTRIBUTE } from '../../src/renderer/canvas/NodeResizeClamp'

const resizer = vi.hoisted(() => ({ props: undefined as NodeResizerProps | undefined }))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    NodeResizer: (props: NodeResizerProps) => {
      resizer.props = props
      return null
    },
  }
})

const params: ResizeParams = { x: 0, y: 0, width: 200, height: 100 }
const event = {} as Parameters<NonNullable<NodeResizerProps['onResizeStart']>>[0]

/** Points React Flow's store at `root`, as ReactFlow does with its own root element. */
function Root({ root, children }: { root: HTMLElement; children: ReactNode }) {
  const store = useStoreApi()
  useLayoutEffect(() => store.setState({ domNode: root as HTMLDivElement }), [store, root])
  return <>{children}</>
}

function setup(props: NodeResizerProps = {}) {
  const root = document.createElement('div')
  const view = render(
    <ReactFlowProvider>
      <Root root={root}>
        <NodeResizeClamp {...props} />
      </Root>
    </ReactFlowProvider>,
  )
  const handed = resizer.props
  if (!handed?.onResizeStart || !handed.onResizeEnd) throw new Error('NodeResizeClamp handed NodeResizer no start or end handler')
  return { root, view, start: handed.onResizeStart, end: handed.onResizeEnd }
}

afterEach(() => {
  resizer.props = undefined
})

describe('NodeResizeClamp marks the Canvas while a resize goes on', () => {
  it('sets data-node-resizing on the React Flow root at the start and takes it off at the end', () => {
    const onResizeStart = vi.fn()
    const onResizeEnd = vi.fn()
    const { root, start, end } = setup({ onResizeStart, onResizeEnd })
    expect(root.hasAttribute(RESIZING_ATTRIBUTE)).toBe(false)

    start(event, params)
    expect(root.hasAttribute(RESIZING_ATTRIBUTE)).toBe(true)
    expect(onResizeStart).toHaveBeenCalledWith(event, params)

    end(event, params)
    expect(root.hasAttribute(RESIZING_ATTRIBUTE)).toBe(false)
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it('takes the mark off at the end when the Node has no end handler of its own', () => {
    const { root, start, end } = setup()
    start(event, params)
    expect(root.hasAttribute(RESIZING_ATTRIBUTE)).toBe(true)
    end(event, params)
    expect(root.hasAttribute(RESIZING_ATTRIBUTE)).toBe(false)
  })

  it('takes the mark off when the Node goes away in the middle of a resize', () => {
    const { root, view, start } = setup({ onResizeEnd: vi.fn() })
    start(event, params)
    expect(root.hasAttribute(RESIZING_ATTRIBUTE)).toBe(true)
    view.unmount()
    expect(root.hasAttribute(RESIZING_ATTRIBUTE)).toBe(false)
  })

  it('still hands the end of a resize on to the Node, with the rectangle the mouse left', () => {
    const onResizeEnd = vi.fn()
    const { start, end } = setup({ onResizeEnd })
    start(event, params)
    end(event, { x: 10, y: 20, width: 300, height: 150 })
    expect(onResizeEnd).toHaveBeenCalledWith(event, { x: 10, y: 20, width: 300, height: 150 })
  })
})
