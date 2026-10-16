// The text an action sends (ticket 23): a Project's action template (src/shared/projects/action-templates.ts,
// ticket 04) with its placeholders filled in, and whether the action can run now. Pure, so the
// renderer shows the same verdict on the button that main checks again before it starts anything.
//
// worfy does not know what the skill does with the text (ADR 0002): it only fills in
//
//   {epic}    the Epic's folder name under .scratch/
//   {NN}      the Ticket's number, two digits at least (07)
//   {wave}    the number of the ready Wave in the Epic's plan (readyWaveNumber below); kept for
//             owners' own templates, the default no longer has it (ADR-0033)
//   {slug}    the slug of the Ticket's file name
//   {branch}  the branch checked out in the Project's root
//   {tickets} the Tickets of the ready Wave, two digits at least, by number: `11, 23, 25, 27`
//
// A placeholder the action has no value for (`{NN}` in "Run wave") fails the render rather than
// turning into an empty string: the agent would get a command with a hole in it.
import { ACTION_LABELS, AUTOPILOT_TEMPLATE_HINT, isActionConfigured, namesWaveTickets, PLACEHOLDERS, unknownPlaceholders, type Action, type Placeholder } from '../projects/action-templates'
import type { Ticket } from '../workflow/types'
import { doneOnlyInBranch, readyWave, waveNumbers, type SkippedTicket } from '../workflow/waves'

/** The values one action has; a placeholder without one cannot be rendered. */
export type TemplateValues = Partial<Record<Placeholder, string>>

export type RenderResult = { ok: true; text: string } | { ok: false; error: string }

const KNOWN = new Set<string>(PLACEHOLDERS)

/** Fills every `{name}` of the template; any unknown name or name without a value fails the render. */
export function renderTemplate(template: string, values: TemplateValues, action?: Action): RenderResult {
  const unknown = unknownPlaceholders(template)
  if (unknown.length > 0) return { ok: false, error: `Unknown placeholder ${unknown.map((name) => `{${name}}`).join(', ')}` }
  const missing = [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]!).filter((name, index, all) => KNOWN.has(name) && values[name as Placeholder] === undefined && all.indexOf(name) === index)
  if (missing.length > 0) {
    const where = action === undefined ? '' : ` in ${ACTION_LABELS[action]}`
    return { ok: false, error: `${missing.map((name) => `{${name}}`).join(', ')} has no value${where}` }
  }
  return { ok: true, text: template.replace(/\{([^{}]*)\}/g, (_match, name: string) => values[name as Placeholder]!) }
}

/** `7` → `07`; numbers of three digits stay as they are. */
export const ticketNumber = (num: number): string => String(num).padStart(2, '0')

/** What "Ship ticket" fills in: everything but {wave}. A null branch (git cannot say) leaves {branch} without a value. */
export function ticketValues(ticket: Pick<Ticket, 'epic' | 'num' | 'slug'>, branch: string | null): TemplateValues {
  return { epic: ticket.epic, NN: ticketNumber(ticket.num), slug: ticket.slug, ...(branch === null ? {} : { branch }) }
}

/** `{tickets}`: the numbers in order, two digits at least, joined by `, ` — `11, 23, 25, 27`. */
export const waveTickets = (nums: readonly number[]): string =>
  [...nums]
    .sort((a, b) => a - b)
    .map(ticketNumber)
    .join(', ')

/**
 * What "Run wave" fills in: the Epic, its ready Wave's number in the plan, the branch and the
 * Wave's Tickets; no single Ticket. No Tickets (or none given) leaves {tickets} without a value.
 */
export function waveValues(epic: string, wave: number | null, branch: string | null, tickets: readonly number[] = []): TemplateValues {
  return { epic, ...(wave === null ? {} : { wave: String(wave) }), ...(branch === null ? {} : { branch }), ...(tickets.length === 0 ? {} : { tickets: waveTickets(tickets) }) }
}

type WaveTicket = Parameters<typeof readyWave>[0][number]

/**
 * The number of the Epic's ready Wave as the Epic's plan counts it — the «Волны» table of its
 * spec.md, where every Ticket is still open (waves.ts, waveNumbers) — so that `/epic-wave волна 3`
 * names the same Wave as the table. When the ready Tickets fall into several Waves of the plan,
 * the earliest one. Null when nothing is ready.
 */
export function readyWaveNumber(tickets: readonly WaveTicket[], epic: string): number | null {
  return planWaveNumber(
    tickets,
    epic,
    readyWave(tickets, epic).ready.map((entry) => entry.num),
  )
}

/** The lowest Wave number of the Epic's plan among `nums`; null when none has one. */
function planWaveNumber(tickets: readonly WaveTicket[], epic: string, nums: readonly number[]): number | null {
  if (nums.length === 0) return null
  const plan = waveNumbers(
    tickets.filter((ticket) => ticket.epic === epic).map((ticket) => ({ ...ticket, state: 'open' as const })),
    epic,
  )
  const numbers = nums.map((num) => plan.get(num)).filter((wave): wave is number => wave !== undefined)
  return numbers.length === 0 ? null : Math.min(...numbers)
}

/**
 * The Tickets of `resumable` — the Wave a Stop of Autopilot interrupted (worfy-week ticket 17) —
 * that are still in work in `epic`, by number. A later run takes them into its first Wave: the
 * implementers the Stop killed left them claimed, so the ready Wave never would.
 */
export function resumedTickets(tickets: readonly WaveTicket[], epic: string, resumable: readonly number[]): number[] {
  return [...new Set(resumable)].filter((num) => tickets.some((ticket) => ticket.epic === epic && ticket.num === num && ticket.state === 'work')).sort((a, b) => a - b)
}

/** Whether an action can run now: the text it would send, or why not, in words for the button. */
export type ActionState = { enabled: true; text: string } | { enabled: false; reason: string }

/** The hint on an action whose template is empty. */
export const emptyTemplateHint = (action: Action): string => `Set the ${ACTION_LABELS[action]} template in Project settings`

const STATE_REASONS: Readonly<Record<Exclude<Ticket['state'], 'open'>, string>> = {
  work: 'Ticket is claimed',
  done: 'Ticket is done',
  blocked: 'Ticket is blocked',
  none: 'Ticket has no status',
}

type ShipTicket = Pick<Ticket, 'epic' | 'num' | 'slug' | 'state' | 'blockedNums' | 'blockedParsed' | 'blockedRaw'>

/** A Ticket as a blocker of "Ship ticket". Absent or null `fromBranch`: the status comes from the checkout. */
type BlockerTicket = Pick<Ticket, 'epic' | 'num' | 'state'> & Partial<Pick<Ticket, 'fromBranch'>>

/** The reason on "Ship ticket" while a Session it launched for the Ticket is still live. */
export const launchedHint = (num: number): string => `Ship ticket already started a Session for ${ticketNumber(num)}; close that Session to start another`

/**
 * "Ship ticket": the Ticket is open, no Session launched for it is still live (`launched`, kept by
 * main: the Ticket stays open until the launched agent runs `ticket claim`), every Ticket that
 * blocks it is done in the checkout, and the Project's template is set and renders. `tickets` are
 * the Project's Tickets (other Epics are ignored). A blocker done only in its unmerged worktree
 * branch (`fromBranch`, ADR-0033) is still open, as for the Wave: the new Session starts from the
 * main branch, which does not have the blocker's code yet. Without `fromBranch` a Ticket's status
 * comes from the checkout.
 */
export function shipTicketState(input: { ticket: ShipTicket; tickets: readonly BlockerTicket[]; template: string; branch: string | null; launched?: boolean }): ActionState {
  const { ticket, tickets, template, branch, launched = false } = input
  if (ticket.state !== 'open') return { enabled: false, reason: STATE_REASONS[ticket.state] }
  if (launched) return { enabled: false, reason: launchedHint(ticket.num) }
  if (!ticket.blockedParsed) return { enabled: false, reason: `“Blocked by: ${ticket.blockedRaw ?? ''}” is not a list of tickets` }
  const open = ticket.blockedNums.flatMap((num) => {
    const blocker = tickets.find((each) => each.epic === ticket.epic && each.num === num)
    if (blocker && doneOnlyInBranch(blocker)) return [`${ticketNumber(num)} (done in branch ${blocker.fromBranch}, not merged)`]
    return blocker?.state === 'done' ? [] : [ticketNumber(num)]
  })
  if (open.length > 0) return { enabled: false, reason: `blocked by ${open.join(', ')}` }
  if (!isActionConfigured(template)) return { enabled: false, reason: emptyTemplateHint('shipTicket') }
  const rendered = renderTemplate(template, ticketValues(ticket, branch), 'shipTicket')
  return rendered.ok ? { enabled: true, text: rendered.text } : { enabled: false, reason: rendered.error }
}

/**
 * "Run wave" when it can run: the text, and from the same read the Tickets it names and the
 * Tickets left out because they are not open (ADR-0033), so a run's journal says exactly what went.
 */
export type WaveState = { enabled: true; text: string; tickets: number[]; skipped: SkippedTicket[] } | { enabled: false; reason: string }

/**
 * "Run wave": the Epic's ready Wave is not empty, and the Project's template is set and renders.
 * For Autopilot (`autopilot`) the template must also name the Wave's Tickets ({tickets}): a run
 * has no person to read a Wave number against the plan. By hand any template runs. `resumable`
 * (Autopilot after a Stop, worfy-week ticket 17): the interrupted Wave's Tickets; those still in
 * work join the ready ones.
 */
export function runWaveState(input: { epic: string; tickets: readonly WaveTicket[]; template: string; branch: string | null; autopilot?: boolean; resumable?: readonly number[] }): WaveState {
  const { epic, tickets, template, branch, autopilot = false, resumable = [] } = input
  const { ready, skipped } = readyWave(tickets, epic)
  const resumed = resumedTickets(tickets, epic, resumable)
  const nums = [...new Set([...resumed, ...ready.map((entry) => entry.num)])].sort((a, b) => a - b)
  if (nums.length === 0) return { enabled: false, reason: 'No ready wave' }
  if (!isActionConfigured(template)) return { enabled: false, reason: emptyTemplateHint('runWave') }
  if (autopilot && !namesWaveTickets(template)) return { enabled: false, reason: AUTOPILOT_TEMPLATE_HINT }
  const rendered = renderTemplate(template, waveValues(epic, planWaveNumber(tickets, epic, nums), branch, nums), 'runWave')
  return rendered.ok ? { enabled: true, text: rendered.text, tickets: nums, skipped } : { enabled: false, reason: rendered.error }
}
