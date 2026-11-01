// The plan of an Epic's Waves: the table of the Waves section of its spec.md (worfy-flight-recorder
// ticket 22). The command `/worfy:epic-wave wave N of epic X` typed in a chat runs the Tickets of row
// N that are not done yet (src/shared/autopilot/chat-command.ts).
//
// The table comes in two shapes, both read here:
//   - one row per Ticket: `Ticket | Files | Wave` (each row names one Ticket and its Wave);
//   - one row per Wave: `Wave | Tickets` (a list such as `05, 09`, or a range such as `11–19`).
// The columns are found by their headings, so other columns (files, notes) do not matter. A table
// that cannot be read for sure is not guessed at: a row whose Wave is not a number makes the whole
// table unread (its Ticket could belong to any Wave), and a Tickets cell that is not a list of
// numbers and ranges makes its Wave unread. Either way the answer is a refusal that asks for the
// Tickets by number.
//
// Pure: the caller reads spec.md and the workflow model.
import type { Ticket } from './types'

/** The most Tickets a range of the plan expands to; more reads as a cell that cannot be read. */
const MAX_RANGE = 500

const WAVES_HEADING = /^(#{1,6})\s+waves\s*$/iu
const WAVE_COLUMN = /^waves?$/iu
const TICKET_COLUMN = /^tickets?$/iu
// shortcut: accepts the old Russian token, remove once no Epic's spec.md keeps its plan under Russian headings (worfy-neutral)
const OLD_WAVE_WORDS = { heading: /^(#{1,6})\s+волны\s*$/iu, wave: /^волна$/iu, ticket: /^(тикеты?|ticket-ы)$/iu }

/** The Tickets of each Wave in table order; null for a Wave whose row could not be read. */
export type WavePlan = ReadonlyMap<number, readonly number[] | null>

/** What a refusal asks for when the plan cannot give the Wave's Tickets. */
export const nameTheTicketsHint = (epic: string): string => `name the Tickets: tickets NN, NN of epic ${epic}`

/** The text of a table cell without the emphasis and code marks around it. */
const clean = (cell: string): string => cell.replace(/\*\*|__|`/gu, '').trim()

function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/u, '').replace(/\|$/u, '')
  return inner.split('|').map(clean)
}

const isTableLine = (line: string): boolean => line.trim().startsWith('|')
const isSeparator = (line: string): boolean => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/u.test(line.trim())

/** A Tickets cell: numbers and ranges (`11–19`, `11-19`) joined by commas; null for anything else. */
export function ticketsOfCell(cell: string): number[] | null {
  if (cell === '') return null
  const out: number[] = []
  for (const token of cell.split(/\s*,\s*/u)) {
    const one = /^(\d{1,5})$/u.exec(token)
    if (one) {
      out.push(Number(one[1]))
      continue
    }
    const range = /^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u.exec(token)
    if (!range) return null
    const [from, to] = [Number(range[1]), Number(range[2])]
    if (to < from || to - from >= MAX_RANGE) return null
    for (let num = from; num <= to; num += 1) out.push(num)
  }
  return [...new Set(out)]
}

/** The lines of the Waves section, up to the next heading of its level or higher; null without one. */
function wavesSection(lines: readonly string[]): readonly string[] | null {
  const start = lines.findIndex((line) => WAVES_HEADING.test(line.trim()) || OLD_WAVE_WORDS.heading.test(line.trim()))
  if (start === -1) return null
  const level = (WAVES_HEADING.exec(lines[start]!.trim()) ?? OLD_WAVE_WORDS.heading.exec(lines[start]!.trim()))![1]!.length
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => {
    const heading = /^(#{1,6})\s/u.exec(line)
    return heading !== null && heading[1]!.length <= level
  })
  return end === -1 ? rest : rest.slice(0, end)
}

/** The plan of the Waves section of an Epic's spec.md; null when it has no table this can read. */
export function parseWavePlan(markdown: string): WavePlan | null {
  const section = wavesSection(markdown.split(/\r?\n/u))
  if (section === null) return null
  const top = section.findIndex((line, at) => isTableLine(line) && at + 1 < section.length && isSeparator(section[at + 1]!))
  if (top === -1) return null
  const header = cellsOf(section[top]!)
  const waveColumn = header.findIndex((cell) => WAVE_COLUMN.test(cell) || OLD_WAVE_WORDS.wave.test(cell))
  const ticketColumn = header.findIndex((cell) => TICKET_COLUMN.test(cell) || OLD_WAVE_WORDS.ticket.test(cell))
  if (waveColumn === -1 || ticketColumn === -1) return null

  const plan = new Map<number, number[] | null>()
  for (const line of section.slice(top + 2)) {
    if (!isTableLine(line)) break
    const cells = cellsOf(line)
    const wave = /^\d{1,5}$/u.exec(cells[waveColumn] ?? '')
    if (!wave) return null
    const num = Number(wave[0])
    const tickets = ticketsOfCell(cells[ticketColumn] ?? '')
    const before = plan.has(num) ? plan.get(num)! : []
    plan.set(num, before === null || tickets === null ? null : [...new Set([...before, ...tickets])])
  }
  return plan.size === 0 ? null : plan
}

export type WaveTickets = { ok: true; tickets: number[] } | { ok: false; message: string }

/**
 * The Tickets of Wave `wave` of the Epic that are not done yet, from its spec.md (null: none) and the
 * Tickets of the workflow model. A Ticket counts as done only when it is done in the checkout: one
 * done only in its worktree branch is still in work (waves.ts), and the run takes it as such. A
 * Ticket of the plan the model does not know stays in the list: the start names it in its refusal.
 */
export function waveTickets(
  spec: string | null,
  epic: string,
  wave: number,
  tickets: readonly Pick<Ticket, 'epic' | 'num' | 'state' | 'fromBranch'>[],
): WaveTickets {
  const refuse = (why: string): WaveTickets => ({ ok: false, message: `${why}: ${nameTheTicketsHint(epic)}` })
  if (spec === null) return refuse(`Epic ${epic} has no spec.md to read Wave ${wave} from`)
  const plan = parseWavePlan(spec)
  if (plan === null) return refuse(`The Waves table of Epic ${epic} cannot be read`)
  if (!plan.has(wave)) return refuse(`The plan of Epic ${epic} has no Wave ${wave}`)
  const row = plan.get(wave)!
  if (row === null) return refuse(`Wave ${wave} of Epic ${epic} cannot be read`)
  const done = (num: number): boolean => tickets.some((each) => each.epic === epic && each.num === num && each.state === 'done' && !each.fromBranch)
  const open = row.filter((num) => !done(num))
  if (open.length === 0) return { ok: false, message: `Every Ticket of Wave ${wave} of Epic ${epic} is done` }
  return { ok: true, tickets: open }
}
