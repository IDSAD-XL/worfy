// The motion of a live diagram of the worfy Guide (worfy-guide ticket 04, ADR-0090 point 9): the dots
// that run along its Edges. One frame loop per diagram, on requestAnimationFrame, and only while the
// diagram can be seen: the Guide is open (LivingScene is mounted only then), the page is visible
// (`visibilitychange`) and the diagram is in view (IntersectionObserver, which also sees the Guide's
// own scrolled content clip it). A dot stands on the same <path> that draws its line, through
// getPointAtLength, so there is no second copy of the curve. Under Reduce motion
// (`prefers-reduced-motion`) no frame runs and the dots stand still at (i + 0.5) / n.
//
// The diagram says what its dots do in `data-motion` on the <svg>: `running`, `paused` or `still`.
import { dotFraction } from './model'

export type MotionState = 'running' | 'paused' | 'still'

const REDUCE = '(prefers-reduced-motion: reduce)'

interface MovingEdge {
  path: SVGPathElement
  dots: SVGElement[]
}

const round = (value: number): number => Math.round(value * 10) / 10

/** The Edges of `svg` that carry dots: a `path[data-edge]` and its `[data-dot-edge]` dots. */
function movingEdges(svg: SVGSVGElement): MovingEdge[] {
  const dots = [...svg.querySelectorAll<SVGElement>('[data-dot-edge]')]
  return [...svg.querySelectorAll<SVGPathElement>('path[data-edge]')].map((path) => ({
    path,
    dots: dots.filter((dot) => dot.dataset.dotEdge === path.dataset.edge),
  }))
}

/** Puts every dot where it stands `seconds` into the motion, or at its still place. */
function placeDots(edges: readonly MovingEdge[], seconds: number, still: boolean): void {
  for (const { path, dots } of edges) {
    const length = path.getTotalLength()
    dots.forEach((dot, index) => {
      const point = path.getPointAtLength(dotFraction(index, dots.length, seconds, length, still) * length)
      dot.setAttribute('transform', `translate(${round(point.x)} ${round(point.y)})`)
    })
  }
}

/**
 * Moves the dots of `svg` while it can be seen; returns the function that stops everything it
 * started — the frame, the observer and the listeners.
 */
export function runSceneMotion(svg: SVGSVGElement): () => void {
  const edges = movingEdges(svg)
  const media = typeof matchMedia === 'function' ? matchMedia(REDUCE) : null
  // Without IntersectionObserver (an old engine) the diagram is taken to be in view.
  const Observer = typeof IntersectionObserver === 'function' ? IntersectionObserver : null
  let inView = Observer === null
  let frame = 0
  /** Seconds of motion so far; the clock stands while the motion is paused, so dots go on where they stopped. */
  let seconds = 0
  let last: number | null = null

  const tick = (now: number): void => {
    if (last !== null) seconds += (now - last) / 1000
    last = now
    placeDots(edges, seconds, false)
    frame = requestAnimationFrame(tick)
  }

  const update = (): void => {
    const state: MotionState = media?.matches === true ? 'still' : inView && document.visibilityState !== 'hidden' ? 'running' : 'paused'
    svg.dataset.motion = state
    if (state === 'running') {
      if (frame === 0) {
        last = null
        frame = requestAnimationFrame(tick)
      }
      return
    }
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
    if (state === 'still') placeDots(edges, 0, true)
  }

  const observer =
    Observer === null
      ? null
      : new Observer((entries) => {
          const entry = entries[entries.length - 1]
          if (entry === undefined) return
          inView = entry.isIntersecting
          update()
        })
  observer?.observe(svg)
  document.addEventListener('visibilitychange', update)
  media?.addEventListener('change', update)
  // Before the first frame the dots stand at their still places, not in a heap at the start of the line.
  placeDots(edges, 0, true)
  update()

  return () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
    observer?.disconnect()
    document.removeEventListener('visibilitychange', update)
    media?.removeEventListener('change', update)
  }
}
