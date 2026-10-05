// The text an action sends (ticket 23): a Project's action template (src/shared/projects/action-templates.ts,
// ticket 04) with its placeholders filled in, and whether the action can run now. Pure, so the
// renderer shows the same verdict on the button that main checks again before it starts anything.
//
// worfy does not know what the skill does with the text (ADR 0002): it only fills in
//
//   {epic}   the Epic's folder name under .scratch/
//   {NN}     the Ticket's number, two digits at least (07)
//   {wave}   the number of the ready Wave in the Epic's plan (readyWaveNumber below)
//   {slug}   the slug of the Ticket's file name
//   {branch} the branch checked out in the Project's root
//
// A placeholder the action has no value for (`{NN}` in "Run wave") fails the render rather than
// turning into an empty string: the agent would get a command with a hole in it.
import { ACTION_LABELS, isActionConfigured, PLACEHOLDERS, unknownPlaceholders, type Action, type Placeholder } from '../projects/action-templates'
import type { Ticket } from '../workflow/types'
import { readyWave, waveNumbers } from '../workflow/waves'

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

/** What "Run wave" fills in: the Epic, its ready Wave's number and the branch; no Ticket. */
export function waveValues(epic: string, wave: number | null, branch: string | null): TemplateValues {
  return { epic, ...(wave === null ? {} : { wave: String(wave) }), ...(branch === null ? {} : { branch }) }
}

type WaveTicket = Parameters<typeof readyWave>[0][number]

/**
 * The number of the Epic's ready Wave as the Epic's plan counts it — the «Волны» table of its
 * spec.md, where every Ticket is still open (waves.ts, waveNumbers) — so that `/epic-wave волна 3`
 * names the same Wave as the table. When the ready Tickets fall into several Waves of the plan,
 * the earliest one. Null when nothing is ready.
 */
export function readyWaveNumber(tickets: readonly WaveTicket[], epic: string): number | null {
  const ready = readyWave(tickets, epic).ready
  if (ready.length === 0) return null
  const plan = waveNumbers(
    tickets.filter((ticket) => ticket.epic === epic).map((ticket) => ({ ...ticket, state: 'open' as const })),
    epic,
  )
  const numbers = ready.map((entry) => plan.get(entry.num)).filter((wave): wave is number => wave !== undefined)
  return numbers.length === 0 ? null : Math.min(...numbers)
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

/**
 * "Ship ticket": the Ticket is open, every Ticket that blocks it is done, and the Project's
 * template is set and renders. `tickets` are the Project's Tickets (other Epics are ignored).
 */
export function shipTicketState(input: { ticket: ShipTicket; tickets: readonly Pick<Ticket, 'epic' | 'num' | 'state'>[]; template: string; branch: string | null }): ActionState {
  const { ticket, tickets, template, branch } = input
  if (ticket.state !== 'open') return { enabled: false, reason: STATE_REASONS[ticket.state] }
  if (!ticket.blockedParsed) return { enabled: false, reason: `“Blocked by: ${ticket.blockedRaw ?? ''}” is not a list of tickets` }
  const open = ticket.blockedNums.filter((num) => tickets.find((each) => each.epic === ticket.epic && each.num === num)?.state !== 'done')
  if (open.length > 0) return { enabled: false, reason: `blocked by ${open.map(ticketNumber).join(', ')}` }
  if (!isActionConfigured(template)) return { enabled: false, reason: emptyTemplateHint('shipTicket') }
  const rendered = renderTemplate(template, ticketValues(ticket, branch), 'shipTicket')
  return rendered.ok ? { enabled: true, text: rendered.text } : { enabled: false, reason: rendered.error }
}

/** "Run wave": the Epic's ready Wave is not empty, and the Project's template is set and renders. */
export function runWaveState(input: { epic: string; tickets: readonly WaveTicket[]; template: string; branch: string | null }): ActionState {
  const { epic, tickets, template, branch } = input
  const wave = readyWaveNumber(tickets, epic)
  if (readyWave(tickets, epic).ready.length === 0) return { enabled: false, reason: 'No ready wave' }
  if (!isActionConfigured(template)) return { enabled: false, reason: emptyTemplateHint('runWave') }
  const rendered = renderTemplate(template, waveValues(epic, wave, branch), 'runWave')
  return rendered.ok ? { enabled: true, text: rendered.text } : { enabled: false, reason: rendered.error }
}
