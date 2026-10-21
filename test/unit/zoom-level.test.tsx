// Semantic zoom (worfy-canvas ticket 06): the three levels of a Node's view and the hook that
// follows the level, not the zoom. A Node that reads the level is drawn again only when the level
// changes; a pan or a zoom within one level leaves it alone. The marks on the React Flow root (the
// level and, at the far level, the zoom for the inverse scale) come from overlays/ZoomLevel.tsx.
// jsdom applies no CSS: what each level looks like is test/e2e/semantic-zoom.spec.ts.
import { act, render } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import ZoomLevelMarks from '../../src/renderer/canvas/overlays/ZoomLevel'
import { COMPACT_ZOOM_MIN, FULL_ZOOM_MIN, useZoomLevel, ZOOM_LEVEL_ATTRIBUTE, ZOOM_VARIABLE, zoomLevelOf, type ZoomLevel } from '../../src/renderer/canvas/zoom-level'

describe('zoomLevelOf', () => {
  it('has the thresholds 0.3 and 0.6 of the ticket', () => {
    expect(COMPACT_ZOOM_MIN).toBe(0.3)
    expect(FULL_ZOOM_MIN).toBe(0.6)
  })

  it.each([
    [2.5, 'full'],
    [1, 'full'],
    [0.6, 'full'],
    [0.5999, 'compact'],
    [0.45, 'compact'],
    [0.3, 'compact'],
    [0.2999, 'far'],
    [0.2, 'far'],
  ] as const)('zoom %f is %s', (zoom, level) => {
    expect(zoomLevelOf(zoom)).toBe(level)
  })
})

type SetZoom = (zoom: number) => void

/** Hands the test a way to set React Flow's zoom, and points its store at `root`. */
function Store({ root, onReady, children }: { root: HTMLElement; onReady: (set: SetZoom) => void; children: ReactNode }) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store.setState({ domNode: root as HTMLDivElement })
    onReady((zoom) => store.setState({ transform: [12, 34, zoom] }))
  }, [store, root, onReady])
  return <>{children}</>
}

function setup(start: number, extra?: ReactNode) {
  const root = document.createElement('div')
  const seen: ZoomLevel[] = []
  function Probe() {
    seen.push(useZoomLevel())
    return null
  }
  let setZoom: SetZoom = () => undefined
  render(
    <ReactFlowProvider>
      <Store root={root} onReady={(set) => (setZoom = set)}>
        <Probe />
        {extra}
      </Store>
    </ReactFlowProvider>,
  )
  act(() => setZoom(start))
  const zoomTo = (zoom: number) => act(() => setZoom(zoom))
  return { root, seen, zoomTo }
}

describe('useZoomLevel', () => {
  it('draws the Node again when the level changes, never for a zoom within the level', () => {
    const { seen, zoomTo } = setup(1)
    const before = seen.length
    expect(seen.at(-1)).toBe('full')

    for (const zoom of [0.95, 0.8, 0.7, 0.61, 0.6, 1.4, 2.5, 1]) zoomTo(zoom)
    expect(seen.length).toBe(before)

    zoomTo(0.59)
    expect(seen.length).toBe(before + 1)
    expect(seen.at(-1)).toBe('compact')
    for (const zoom of [0.55, 0.4, 0.31, 0.3, 0.5]) zoomTo(zoom)
    expect(seen.length).toBe(before + 1)

    zoomTo(0.29)
    expect(seen.length).toBe(before + 2)
    expect(seen.at(-1)).toBe('far')
    for (const zoom of [0.25, 0.2, 0.28]) zoomTo(zoom)
    expect(seen.length).toBe(before + 2)

    zoomTo(0.6)
    expect(seen.length).toBe(before + 3)
    expect(seen.at(-1)).toBe('full')
  })
})

describe('overlays/ZoomLevel.tsx', () => {
  it('marks the React Flow root with the level, and with the zoom only at the far level', () => {
    const { root, zoomTo } = setup(1, <ZoomLevelMarks />)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('full')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('')

    zoomTo(0.45)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('compact')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('')

    zoomTo(0.25)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('far')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('0.25')
    zoomTo(0.2)
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('0.2')

    zoomTo(0.7)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('full')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('')
  })
})
