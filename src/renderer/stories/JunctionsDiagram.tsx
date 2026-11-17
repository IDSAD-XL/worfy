// The small diagram of the step "Seams between tickets" of an Epic story (worfy-code-stories ticket 09, owner's
// decision 27): one box per Ticket the handoffs name, in the order of their numbers, and one arrow per handoff,
// from the Ticket that hands over to the one that takes it. A dropped handoff (`done: no`) is a red dashed arrow.
// A fixed picture: no pan, no zoom and no path through the files — of the map of variant C only this stays.
//
// Arrows to a later Ticket arc above the boxes, arrows back to an earlier one below them, each higher the further
// it reaches, so two handoffs between the same pair in opposite directions never cover each other.
import { storyLabels, type StoryHandoff, type StoryLanguage } from '../../shared/stories/schema'

const BOX_WIDTH = 64
const BOX_HEIGHT = 30
const GAP = 76
const MARGIN = 12
/** How high the arc of a handoff between neighbours rises; each Ticket further adds STEP_RISE. */
const BASE_RISE = 26
const STEP_RISE = 16

/** Ticket numbers compared as numbers, not as strings: a number has two digits at least, so 100 comes after 99. */
const byNumber = (a: string, b: string): number => Number(a) - Number(b)

/** Whether a handoff goes to a later Ticket, by number. */
const isForward = (handoff: StoryHandoff): boolean => byNumber(handoff.to, handoff.from) > 0

/** Whether a handoff goes back to an earlier Ticket, by number. */
const isBackward = (handoff: StoryHandoff): boolean => byNumber(handoff.to, handoff.from) < 0

/** The Tickets the handoffs name, by number. */
function handoffTickets(handoffs: readonly StoryHandoff[]): string[] {
  return [...new Set(handoffs.flatMap((handoff) => [handoff.from, handoff.to]))].sort(byNumber)
}

/** A handoff in words, for its tooltip and the name of the picture: the UI word "dropped" is English, `what` the story's. */
const handoffWords = (handoff: StoryHandoff): string => `${handoff.from} → ${handoff.to}: ${handoff.what}${handoff.done ? '' : ' (dropped)'}`

export function JunctionsDiagram({ handoffs, language }: { handoffs: readonly StoryHandoff[]; language: StoryLanguage }) {
  // No handoffs, no picture: the schema allows an empty list, and the step's prose says what there is.
  if (handoffs.length === 0) return null
  const tickets = handoffTickets(handoffs)
  const rise = (handoff: StoryHandoff) => BASE_RISE + STEP_RISE * (Math.abs(tickets.indexOf(handoff.to) - tickets.indexOf(handoff.from)) - 1)
  const above = Math.max(0, ...handoffs.filter(isForward).map(rise))
  const below = Math.max(0, ...handoffs.filter(isBackward).map(rise))
  const top = MARGIN + above
  const width = MARGIN * 2 + tickets.length * BOX_WIDTH + (tickets.length - 1) * GAP
  const height = top + BOX_HEIGHT + below + MARGIN
  const centre = (ticket: string) => MARGIN + tickets.indexOf(ticket) * (BOX_WIDTH + GAP) + BOX_WIDTH / 2

  const path = (handoff: StoryHandoff): string => {
    const forward = isForward(handoff)
    // Leave and enter a little off the middle of the box, so an arrow out and an arrow in do not meet in one point.
    const from = centre(handoff.from) + (forward ? 10 : -10)
    const to = centre(handoff.to) + (forward ? -10 : 10)
    const y = forward ? top : top + BOX_HEIGHT
    const peak = forward ? y - rise(handoff) * 2 : y + rise(handoff) * 2
    return `M ${String(from)} ${String(y)} Q ${String((from + to) / 2)} ${String(peak)} ${String(to)} ${String(y)}`
  }

  const label = `${storyLabels(language).seams}: ${handoffs.map((handoff) => handoffWords(handoff)).join('; ')}`
  return (
    <figure className="w-story-seams" data-testid="story-seams-diagram">
      <svg className="w-story-seams__svg" viewBox={`0 0 ${String(width)} ${String(height)}`} width={width} height={height} role="img" aria-label={label}>
        <defs>
          <marker id="w-story-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="w-story-seams__head" />
          </marker>
          <marker id="w-story-arrow-dropped" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="w-story-seams__head w-story-seams__head--dropped" />
          </marker>
        </defs>
        {handoffs.map((handoff, index) => (
          <path
            key={index}
            d={path(handoff)}
            className={handoff.done ? 'w-story-seams__arrow' : 'w-story-seams__arrow w-story-seams__arrow--dropped'}
            data-testid="story-seams-arrow"
            data-from={handoff.from}
            data-to={handoff.to}
            data-done={handoff.done ? 'yes' : 'no'}
            strokeDasharray={handoff.done ? undefined : '6 4'}
            markerEnd={handoff.done ? 'url(#w-story-arrow)' : 'url(#w-story-arrow-dropped)'}
          >
            <title>{handoffWords(handoff)}</title>
          </path>
        ))}
        {tickets.map((ticket) => (
          <g key={ticket} data-testid="story-seams-ticket" data-ticket={ticket}>
            <rect x={centre(ticket) - BOX_WIDTH / 2} y={top} width={BOX_WIDTH} height={BOX_HEIGHT} rx={6} className="w-story-seams__box" />
            <text x={centre(ticket)} y={top + BOX_HEIGHT / 2} className="w-story-seams__ticket" dominantBaseline="central" textAnchor="middle">
              {ticket}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  )
}
