// A live diagram of the worfy Guide (worfy-guide ticket 04, ADR-0090 point 9) in the Living Canvas
// style of the epic's spec: Node blocks with a header tinted by their group, Edges as Bézier curves
// with an arrowhead, two dots running along each Edge. The pointer or the keyboard focus on a block
// lights it, its neighbours and its Edges, shows the labels of those Edges and fades the rest; a block
// with a Topic opens it, or its Full page on GitHub while that Topic is not written yet. Frames say
// what lies inside what (a Canvas, an Epic): a frame's block is the tab on its top edge, and the frame
// lights and fades with it; a chip on a frame is a thing that is computed and stored nowhere (a Wave),
// drawn dashed. Captions name the areas outside the Canvas (worfy-guide ticket 05). The step player under the diagram lights one step at a time and says what
// happens in it. A Topic's Scene.tsx describes its diagram (model.ts, SceneSpec) and passes it here
// with its labels; motion.ts moves the dots.
//
// For a screen reader the <svg> is a group described by a hidden list of every Edge, "A → B: label";
// each block reads "title: note". Reduce motion stops the dots (motion.ts) and the CSS transitions
// (guide.css), and the highlight still changes, at once.
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { GuideStrings } from '../content'
import { githubFileUrl, openInBrowser } from '../links'
import { shownTopics } from '../registry'
import { GROUP_COLOURS } from '../scene-colours'
import { selectGuideTopic, useGuide } from '../store'
import {
  CHIP_HEIGHT,
  DOTS_PER_EDGE,
  HEADER_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  STEP_SECONDS,
  TAB_HEIGHT,
  blockTarget,
  edgeId,
  edgeShape,
  litParts,
  noteLines,
  playerReducer,
  type BlockTarget,
  type SceneBlock,
  type SceneSpec,
} from './model'
import { runSceneMotion } from './motion'

export interface LivingSceneProps {
  spec: SceneSpec
  /** `scene.labels` of the Topic in the Guide's language. */
  labels: Readonly<Record<string, string>>
  /** The Guide's own labels in its language. */
  strings: GuideStrings
}

/** The arrowhead, its tip at the origin, pointing right. */
const ARROW = 'M 0 0 L -9 -4.5 L -7 0 L -9 4.5 Z'
/** About how wide a character of an 11 px Edge label is; the real width replaces it once drawn. */
const LABEL_CHAR_WIDTH = 6.2
const LABEL_PADDING = 14

/** `--c`, the colour of the block's group; an Edge and its dots take the colour of the block they leave. */
const colourOf = (block: SceneBlock): CSSProperties => ({ ['--c' as string]: GROUP_COLOURS[block.group] })
const classes = (...names: (string | false)[]): string => names.filter(Boolean).join(' ')

interface BlockProps {
  block: SceneBlock
  labels: LivingSceneProps['labels']
  hot: boolean
  near: boolean
  target: BlockTarget
  /** What a block that opens a page on GitHub says under the pointer. */
  pageHint: string
  onLight: (id: string | null, by: 'pointer' | 'focus') => void
  onOpen: (target: NonNullable<BlockTarget>) => void
}

/** A Node: the header tinted by its group, the title, and the note in one line or two. */
function NodeShape({ title, note }: { title: string; note: string }) {
  const lines = noteLines(note, NODE_WIDTH)
  return (
    <>
      <rect className="w-guide-scene__node" width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" />
      <path className="w-guide-scene__header" d={`M 0 8 a 8 8 0 0 1 8 -8 h ${NODE_WIDTH - 16} a 8 8 0 0 1 8 8 v ${HEADER_HEIGHT - 8} h ${-NODE_WIDTH} z`} />
      <line className="w-guide-scene__rule" x1="0" y1={HEADER_HEIGHT} x2={NODE_WIDTH} y2={HEADER_HEIGHT} />
      <circle className="w-guide-scene__group" cx="14" cy={HEADER_HEIGHT / 2} r="4" />
      <text className="w-guide-scene__title" x="26" y={HEADER_HEIGHT / 2 + 4.5}>
        {title}
      </text>
      {lines.length === 1 ? (
        <text className="w-guide-scene__note" x="12" y={HEADER_HEIGHT + 20}>
          {note}
        </text>
      ) : (
        <text className="w-guide-scene__note is-wrapped" x="12" y={HEADER_HEIGHT + 13}>
          {lines.map((line, index) => (
            <tspan key={index} x="12" dy={index === 0 ? 0 : 12}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </>
  )
}

/** The tab of a frame: its title in the tab, its note to the right of it, above the frame's edge. */
function TabShape({ title, note, width }: { title: string; note: string; width: number }) {
  return (
    <>
      <rect className="w-guide-scene__tab" width={width} height={TAB_HEIGHT} rx="8" />
      <circle className="w-guide-scene__group" cx="14" cy={TAB_HEIGHT / 2} r="4.5" />
      <text className="w-guide-scene__title is-tab" x="25" y={TAB_HEIGHT / 2 + 5}>
        {title}
      </text>
      {note === '' ? null : (
        <text className="w-guide-scene__tab-note" x={width + 10} y="11">
          {note}
        </text>
      )}
    </>
  )
}

/** A chip: a dashed pill with the dot of its group and its title; its note is for a screen reader. */
function ChipShape({ title, width }: { title: string; width: number }) {
  return (
    <>
      <rect className="w-guide-scene__chip" width={width} height={CHIP_HEIGHT} rx={CHIP_HEIGHT / 2} />
      <circle className="w-guide-scene__group" cx="13" cy={CHIP_HEIGHT / 2} r="4" />
      <text className="w-guide-scene__title is-chip" x="23" y={CHIP_HEIGHT / 2 + 4.5}>
        {title}
      </text>
    </>
  )
}

function Block({ block, labels, hot, near, target, pageHint, onLight, onOpen }: BlockProps) {
  const title = labels[block.id] ?? block.id
  const note = labels[`${block.id}Note`] ?? ''
  const shape = block.shape ?? 'node'
  const width = block.width ?? NODE_WIDTH
  const open = target === null ? undefined : () => onOpen(target)
  return (
    <g
      className={classes('w-guide-scene__block', `is-${shape}`, hot && 'is-hot', near && 'is-near', target !== null && 'is-link')}
      transform={`translate(${block.x} ${block.y})`}
      style={colourOf(block)}
      role={target === null ? 'img' : 'link'}
      tabIndex={0}
      aria-label={note === '' ? title : `${title}: ${note}`}
      data-block={block.id}
      data-target={target === null ? undefined : target.kind}
      data-to={target === null ? undefined : target.kind === 'topic' ? target.topic : target.page}
      onMouseEnter={() => onLight(block.id, 'pointer')}
      onMouseLeave={() => onLight(null, 'pointer')}
      onFocus={() => onLight(block.id, 'focus')}
      onBlur={() => onLight(null, 'focus')}
      onClick={open}
      onKeyDown={
        open === undefined
          ? undefined
          : (event: KeyboardEvent) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              open()
            }
      }
    >
      {target?.kind === 'page' ? <title>{pageHint}</title> : null}
      {shape === 'tab' ? <TabShape title={title} note={note} width={width} /> : shape === 'chip' ? <ChipShape title={title} width={width} /> : <NodeShape title={title} note={note} />}
    </g>
  )
}

export function LivingScene({ spec, labels, strings }: LivingSceneProps) {
  const svg = useRef<SVGSVGElement>(null)
  const listId = useId()
  const gridId = useId()
  const [pointer, setPointer] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const steps = spec.steps ?? []
  const [player, dispatch] = useReducer(playerReducer(steps.length), { step: null, playing: false })
  const lit = litParts(spec, pointer ?? focused, player.step)
  const build = useGuide((state) => state.build)
  const shown = new Set(shownTopics(build.packaged).map((topic) => topic.id))
  const openTarget = (target: NonNullable<BlockTarget>): void => {
    if (target.kind === 'topic') selectGuideTopic(target.topic)
    else openInBrowser(githubFileUrl(target.page, build.version))
  }
  const frames = spec.frames ?? []
  // A diagram with a Canvas frame of its own is not drawn on a Canvas as a whole.
  const field = !frames.some((frame) => frame.kind === 'canvas')
  const byId = new Map(spec.blocks.map((block) => [block.id, block]))
  const edges = spec.edges.flatMap((edge) => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) return []
    const id = edgeId(edge)
    return [{ edge, id, from, to, shape: edgeShape(from, to, edge), hot: lit.edges.has(id) }]
  })
  // A lit Edge is drawn over the others.
  const drawn = [...edges.filter((each) => !each.hot), ...edges.filter((each) => each.hot)]

  useLayoutEffect(() => {
    if (svg.current === null) return undefined
    return runSceneMotion(svg.current)
  }, [spec])

  // Each label's pill takes the width of its text once the text is drawn.
  useLayoutEffect(() => {
    for (const label of svg.current?.querySelectorAll<SVGGElement>('[data-edge-label]') ?? []) {
      const text = label.querySelector('text')
      const pill = label.querySelector('rect')
      const width = typeof text?.getComputedTextLength === 'function' ? text.getComputedTextLength() : 0
      if (pill === null || width <= 0) continue
      pill.setAttribute('x', String(-(width + LABEL_PADDING) / 2))
      pill.setAttribute('width', String(width + LABEL_PADDING))
    }
  })

  // The player moves on by itself only while it plays and the diagram is on screen.
  useEffect(() => {
    if (!player.playing) return undefined
    const timer = setTimeout(() => dispatch({ type: 'tick' }), STEP_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [player])

  const light = (id: string | null, by: 'pointer' | 'focus') => (by === 'pointer' ? setPointer(id) : setFocused(id))
  const name = (id: string) => labels[id] ?? id
  const caption = player.step === null ? '' : (labels[steps[player.step]?.caption ?? ''] ?? '')

  return (
    <div className="w-guide-scene-wrap">
      <svg
        ref={svg}
        className={classes('w-guide-scene', lit.focusing && 'is-focusing')}
        viewBox={`0 0 ${spec.width} ${spec.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={strings.diagram}
        aria-describedby={listId}
        data-testid="guide-scene"
      >
        <defs>
          <pattern id={gridId} width="16" height="16" patternUnits="userSpaceOnUse">
            <circle className="w-guide-scene__grid" cx="8" cy="8" r="1.1" />
          </pattern>
        </defs>
        {field ? (
          <>
            <rect className="w-guide-scene__canvas" x="0.75" y="0.75" width={spec.width - 1.5} height={spec.height - 1.5} rx="14" />
            <rect x="0.75" y="0.75" width={spec.width - 1.5} height={spec.height - 1.5} rx="14" fill={`url(#${gridId})`} />
          </>
        ) : null}
        <g aria-hidden="true">
          {(spec.regions ?? []).map((region) => (
            <text key={region.label} className="w-guide-scene__region" x={region.x} y={region.y} data-region={region.label}>
              {labels[region.label] ?? region.label}
            </text>
          ))}
          {frames.map((frame) => {
            const tab = byId.get(frame.block)
            const box = { x: frame.x, y: frame.y, width: frame.width, height: frame.height, rx: frame.kind === 'canvas' ? 14 : 10 }
            return (
              <g
                key={frame.block}
                className={classes('w-guide-scene__frame', `is-${frame.kind}`, lit.hot.has(frame.block) && 'is-hot', lit.near.has(frame.block) && 'is-near')}
                style={tab === undefined ? undefined : colourOf(tab)}
                data-frame={frame.block}
              >
                <rect className="w-guide-scene__frame-ground" {...box} />
                {frame.kind === 'canvas' ? <rect {...box} fill={`url(#${gridId})`} /> : null}
              </g>
            )
          })}
        </g>
        <g aria-hidden="true">
          {drawn.map(({ id, from, shape, hot }) => (
            <g key={id} style={colourOf(from)}>
              <path className={classes('w-guide-scene__edge', hot && 'is-hot')} d={shape.d} data-edge={id} />
              <path className={classes('w-guide-scene__arrow', hot && 'is-hot')} d={ARROW} transform={`translate(${shape.tip.x} ${shape.tip.y}) rotate(${shape.angle})`} data-arrow-edge={id} />
            </g>
          ))}
        </g>
        <g aria-hidden="true">
          {edges.map(({ id, from, hot }) =>
            Array.from({ length: DOTS_PER_EDGE }, (_, index) => (
              <circle key={`${id}-${index}`} className={classes('w-guide-scene__dot', hot && 'is-hot')} r="3" style={colourOf(from)} data-dot-edge={id} />
            )),
          )}
        </g>
        <g>
          {spec.blocks.map((block) => (
            <Block
              key={block.id}
              block={block}
              labels={labels}
              hot={lit.hot.has(block.id)}
              near={lit.near.has(block.id)}
              target={blockTarget(block, (topic) => shown.has(topic))}
              pageHint={strings.openOnGitHub}
              onLight={light}
              onOpen={openTarget}
            />
          ))}
        </g>
        <g aria-hidden="true">
          {edges.map(({ id, edge, shape, hot }) => {
            const text = edge.label === undefined ? undefined : labels[edge.label]
            if (text === undefined) return null
            const width = text.length * LABEL_CHAR_WIDTH + LABEL_PADDING
            // shortcut: the label stands at the middle of its curve and does not move off a block it
            // covers, as the style's prototype does; redo when a diagram's lit labels overlap.
            return (
              <g key={id} className={classes('w-guide-scene__label', hot && 'is-hot')} transform={`translate(${shape.middle.x} ${shape.middle.y})`} data-edge-label={id}>
                <rect x={-width / 2} y="-9.5" width={width} height="19" rx="9.5" />
                <text y="4" textAnchor="middle">
                  {text}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <ul id={listId} className="w-guide__sr-only">
        {edges.map(({ id, edge }) => (
          <li key={id}>{`${name(edge.from)} → ${name(edge.to)}${edge.label === undefined ? '' : `: ${labels[edge.label] ?? ''}`}`}</li>
        ))}
      </ul>
      {steps.length === 0 ? null : (
        <div className="w-guide-steps" role="group" aria-label={strings.steps}>
          <button type="button" className="w-guide-steps__play" onClick={() => dispatch({ type: 'toggle' })}>
            {player.playing ? strings.pause : strings.play}
          </button>
          <div className="w-guide-steps__track">
            {steps.map((step, index) => (
              <button
                key={step.caption}
                type="button"
                className="w-guide-steps__step"
                aria-pressed={player.step === index}
                aria-label={`${strings.step} ${index + 1}`}
                onClick={() => dispatch({ type: 'choose', step: index })}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <p className="w-guide-steps__caption" aria-live="polite" data-testid="guide-scene-caption">
            {caption}
          </p>
        </div>
      )}
    </div>
  )
}
