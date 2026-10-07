// What snapping shows while a Node is dragged (worfy-week ticket 06): the alignment guides through
// the dragged Node and its neighbours, the marks of equal gaps, and the dashed outline of where the
// Node lands when the rule "Nodes never overlap" moves it off where it was snapped to. Canvas.tsx
// computes all three with snapping.ts and puts them into its store; this overlay only draws them,
// in screen pixels, so every line stays 1 px at any zoom. Everything goes out on the drop.
import { useStore } from '@xyflow/react'
import { useSnapGuides, type GapMark, type Guide } from '../snapping'

export const order = 15

/** A 1 px line is sharp when it runs through the middle of a pixel. */
const crisp = (value: number): number => Math.round(value) + 0.5

/** The length of the ends of a gap mark, in pixels. */
const TICK = 4

export default function SnapGuides() {
  const { guides, gaps, outline } = useSnapGuides()
  const [tx, ty, zoom] = useStore((state) => state.transform)
  if (guides.length === 0 && gaps.length === 0 && outline.length === 0) return null
  const sx = (x: number) => tx + x * zoom
  const sy = (y: number) => ty + y * zoom

  const guideLine = (guide: Guide) =>
    guide.axis === 'x' ? (
      <line key={`x${guide.at}`} className="w-snap__guide" data-testid="snap-guide" data-axis="x" data-at={guide.at} x1={crisp(sx(guide.at))} x2={crisp(sx(guide.at))} y1={sy(guide.from)} y2={sy(guide.to)} />
    ) : (
      <line key={`y${guide.at}`} className="w-snap__guide" data-testid="snap-guide" data-axis="y" data-at={guide.at} x1={sx(guide.from)} x2={sx(guide.to)} y1={crisp(sy(guide.at))} y2={crisp(sy(guide.at))} />
    )

  const gapMark = (gap: GapMark) => {
    const key = `${gap.axis}${gap.from}:${gap.to}:${gap.at}`
    if (gap.axis === 'x') {
      const y = crisp(sy(gap.at))
      const [x1, x2] = [crisp(sx(gap.from)), crisp(sx(gap.to))]
      return (
        <g key={key} className="w-snap__gap" data-testid="snap-gap" data-axis="x" data-from={gap.from} data-to={gap.to}>
          <line x1={x1} x2={x2} y1={y} y2={y} />
          <line x1={x1} x2={x1} y1={y - TICK} y2={y + TICK} />
          <line x1={x2} x2={x2} y1={y - TICK} y2={y + TICK} />
        </g>
      )
    }
    const x = crisp(sx(gap.at))
    const [y1, y2] = [crisp(sy(gap.from)), crisp(sy(gap.to))]
    return (
      <g key={key} className="w-snap__gap" data-testid="snap-gap" data-axis="y" data-from={gap.from} data-to={gap.to}>
        <line x1={x} x2={x} y1={y1} y2={y2} />
        <line x1={x - TICK} x2={x + TICK} y1={y1} y2={y1} />
        <line x1={x - TICK} x2={x + TICK} y1={y2} y2={y2} />
      </g>
    )
  }

  return (
    <svg className="w-snap" aria-hidden="true">
      {outline.map((rect) => (
        <rect
          key={`${rect.x}:${rect.y}:${rect.w}:${rect.h}`}
          className="w-snap__outline"
          data-testid="snap-outline"
          data-x={rect.x}
          data-y={rect.y}
          data-w={rect.w}
          data-h={rect.h}
          x={crisp(sx(rect.x))}
          y={crisp(sy(rect.y))}
          width={Math.max(0, Math.round(rect.w * zoom) - 1)}
          height={Math.max(0, Math.round(rect.h * zoom) - 1)}
        />
      ))}
      {guides.map(guideLine)}
      {gaps.map(gapMark)}
    </svg>
  )
}
