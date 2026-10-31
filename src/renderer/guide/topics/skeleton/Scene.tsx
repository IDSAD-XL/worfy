// The diagram of the test Topic (worfy-guide ticket 03): the two ways into the Guide. A still frame
// in the Living Canvas style of the epic's spec — Node blocks with a tinted header and Edges as Bézier
// curves with an arrowhead; the moving dots, highlighting and the rest of the scene kit come with
// ticket 04. Labels come from the Topic's texts, so the diagram speaks the Guide's language.
import { useId } from 'react'
import type { SceneProps } from '../../content'
import { GROUP_COLOURS } from '../../scene-colours'

interface Block {
  key: string
  x: number
  y: number
  /** The colour of its group (scene-colours.ts). */
  colour: string
}

const W = 180
const H = 58
const HEADER = 26

const BLOCKS: readonly Block[] = [
  { key: 'menu', x: 40, y: 30, colour: GROUP_COLOURS.workflow },
  { key: 'palette', x: 40, y: 150, colour: GROUP_COLOURS.agents },
  { key: 'guide', x: 420, y: 90, colour: GROUP_COLOURS.harness },
]

const EDGES: readonly (readonly [string, string])[] = [
  ['menu', 'guide'],
  ['palette', 'guide'],
]

/** A cubic curve from the middle of the right side of `from` to the middle of the left side of `to`. */
function edgePath(from: Block, to: Block): string {
  const x1 = from.x + W
  const y1 = from.y + H / 2
  const x2 = to.x - 6
  const y2 = to.y + H / 2
  const arm = Math.max(26, 0.42 * Math.hypot(x2 - x1, y2 - y1))
  return `M ${x1} ${y1} C ${x1 + arm} ${y1}, ${x2 - arm} ${y2}, ${x2} ${y2}`
}

export default function Scene({ labels }: SceneProps) {
  const arrow = useId()
  const byKey = new Map(BLOCKS.map((block) => [block.key, block]))
  return (
    <svg className="w-guide-scene" viewBox="0 0 640 238" preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-testid="guide-scene">
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
        </marker>
      </defs>
      <rect className="w-guide-scene__canvas" x="1" y="1" width="638" height="236" rx="14" />
      {EDGES.map(([from, to]) => {
        const a = byKey.get(from)
        const b = byKey.get(to)
        if (a === undefined || b === undefined) return null
        return <path key={`${from}-${to}`} className="w-guide-scene__edge" d={edgePath(a, b)} markerEnd={`url(#${arrow})`} />
      })}
      {BLOCKS.map((block) => (
        <g key={block.key} transform={`translate(${block.x} ${block.y})`} style={{ ['--c' as string]: block.colour }}>
          <rect className="w-guide-scene__node" width={W} height={H} rx="8" />
          <path className="w-guide-scene__header" d={`M 0 8 a 8 8 0 0 1 8 -8 h ${W - 16} a 8 8 0 0 1 8 8 v ${HEADER - 8} h ${-W} z`} />
          <line className="w-guide-scene__rule" x1="0" y1={HEADER} x2={W} y2={HEADER} />
          <circle cx="14" cy={HEADER / 2} r="4" fill="var(--c)" />
          <text className="w-guide-scene__title" x="26" y={HEADER / 2 + 4.5}>
            {labels[block.key]}
          </text>
          <text className="w-guide-scene__note" x="12" y={HEADER + 20}>
            {labels[`${block.key}Note`]}
          </text>
        </g>
      ))}
    </svg>
  )
}
