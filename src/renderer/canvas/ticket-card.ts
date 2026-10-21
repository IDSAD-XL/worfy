// The size of a Ticket's card on the Canvas (nodes/TicketNode.tsx, worfy-canvas ticket 18). Every
// element of the card is whole — no "…", no line clamp: the title, the blocked reason and the
// blockers line wrap, the top row and the checks chips wrap onto more lines. So a card is as tall
// as its content, and the layout (epic-layout.ts, elk/layout.ts) places each card by the height
// computed here.
//
// The height comes from the Ticket's data, before anything is drawn and the same on every run:
// nothing is measured on screen, so the layout does not depend on when the card was drawn. Text is
// measured by an estimate of each character's width that errs wide (`charEm`); greedy line
// breaking at spaces, as the browser does with `overflow-wrap: anywhere`, gives at least as many
// lines as the browser draws. What the card shows from main's snapshots rather than from the
// Ticket — the Stage's name, the checks chips, "Open PR" — gets room for its widest form.
//
// Every number here mirrors a rule of epic-frame.css, stepper.css or checks-badges.css; change both.
import { DEFAULT_PIPELINE, stageLabel } from '../../shared/workflow/pipeline'
import type { Ticket, TicketState } from '../../shared/workflow/types'

/** The card's width; the layout's columns are this wide (TICKET_WIDTH of epic-layout.ts). */
export const TICKET_WIDTH = 240
/** The height of the smallest card: one line of title and blockers, a top row of one line. */
export const TICKET_MIN_HEIGHT = 138

/** `.w-ticket`: 1 px border, 8 px × 10 px padding, 4 px between its rows. */
const BORDER = 1
const PADDING_Y = 8
const PADDING_X = 10
const CARD_GAP = 4
/** The width inside the card's border and padding. */
export const CONTENT_WIDTH = TICKET_WIDTH - 2 * BORDER - 2 * PADDING_X

/** `.w-ticket__top`: lines of 18 px, 2 px apart, items 4 px apart. */
const TOP_LINE = 18
const TOP_ROW_GAP = 2
const TOP_GAP = 4
/** `.w-stepper`: the stepper keeps at least this width beside the number, or takes a line of its own. */
export const STEPPER_MIN_WIDTH = 100
/** `.w-stepper`: lines of 16 px, 2 px apart, parts 4 px apart, at least one top line high. */
const STEPPER_LINE = 16
const STEPPER_ROW_GAP = 2
const STEPPER_GAP = 4
/** `.w-ticket__title`: 13 px semibold on 17 px lines. */
const TITLE_LINE = 17
/** `.w-ticket__meta`: 11 px on 15 px lines. */
const META_LINE = 15
/** `.w-ticket__reason`: 12 px on 15 px lines, 2 px × 6 px padding. */
const REASON_LINE = 15
const REASON_PAD_Y = 2
const REASON_PAD_X = 6
/**
 * `.w-ticket__slots`, at its tallest: the checks chips on two lines (16 px each, 2 px apart) — a gate,
 * a PR, CI and a verdict need two lines of CONTENT_WIDTH — then 4 px and the actions' line (20 px).
 * The chips come from main's checks snapshot, which the layout does not read, so every card keeps
 * this room.
 */
export const SLOTS_HEIGHT = 2 * 16 + 2 + 4 + 20

export interface Font {
  size: number
  weight?: 400 | 500 | 600 | 700
  mono?: boolean
}

// The Cyrillic letters are written as escapes: code and comments stay in Latin script.
// Wide Cyrillic: capital and small Zhe, Sha, Shcha, Yu, Em, Ef, Yeru.
const WIDE = new Set('MWmw@%\u0416\u0428\u0429\u042e\u041c\u0424\u042b\u0436\u0448\u0449\u044e\u043c\u0444\u044b')
const NARROW = new Set(" il.,:;'!|`Ij")
const SLIM = new Set('ftr()[]{}/\\*')

/**
 * The width of one character in em, a little over that of the UI font (SF Pro on macOS, Segoe UI
 * on Windows) or the monospace one: a wider guess costs a line of empty room, a narrower one would
 * cut text.
 */
export function charEm(ch: string, mono = false): number {
  const code = ch.codePointAt(0) ?? 0
  // Symbols and emoji (from U+2600 on) and CJK: a colour emoji is wider than its em.
  if (code >= 0x2600) return 1.5
  if (mono) return code < 0x2000 ? 0.62 : 1
  if (NARROW.has(ch)) return 0.32
  if (SLIM.has(ch)) return 0.44
  if (WIDE.has(ch)) return ch === ch.toLowerCase() ? 0.95 : 1.02
  // Digits, «-» and «"» are tabular or wide in SF Pro and Segoe UI.
  if (/[0-9"-]/u.test(ch)) return 0.66
  if (/[a-z]/u.test(ch)) return 0.62
  if (/[\u0430-\u044f\u0451]/u.test(ch)) return 0.66
  if (/[A-Z\u0410-\u042f\u0401]/u.test(ch)) return 0.78
  return code < 0x2000 ? 0.8 : 1
}

const WEIGHT: Record<number, number> = { 400: 1, 500: 1.03, 600: 1.06, 700: 1.1 }

const charWidth = (ch: string, font: Font): number => charEm(ch, font.mono) * font.size * WEIGHT[font.weight ?? 400]!

/** The estimated width of `text` in `font`, in CSS pixels. */
export function textWidth(text: string, font: Font): number {
  let width = 0
  for (const ch of text) width += charWidth(ch, font)
  return width
}

/** A piece of text in one font; a line of text may have several (the blockers line's numbers are monospace). */
export interface Run {
  text: string
  font: Font
}

/** A piece of a line between break opportunities, with the width of the white space before it. */
interface Piece {
  width: number
  chars: number[]
  space: number
}

/** `runs` cut at white space, and also after «-» and «/» when `soft`. */
function pieces(runs: readonly Run[], soft: boolean): Piece[] {
  const out: Piece[] = []
  let chars: number[] = []
  let space = 0
  const close = () => {
    if (chars.length) out.push({ width: chars.reduce((sum, w) => sum + w, 0), chars, space })
    chars = []
    space = 0
  }
  for (const run of runs) {
    for (const ch of run.text) {
      if (/\s/u.test(ch)) {
        close()
        space = Math.max(space, charWidth(' ', run.font))
        continue
      }
      chars.push(charWidth(ch, run.font))
      if (soft && (ch === '-' || ch === '/')) close()
    }
  }
  close()
  return out
}

/** Greedy line filling of `list` in `room` px; a piece wider than the line breaks between its characters. */
function fill(list: readonly Piece[], room: number): number {
  if (!list.length) return 0
  let lines = 1
  let x = 0
  for (const piece of list) {
    const gap = x === 0 ? 0 : piece.space
    if (x + gap + piece.width <= room) {
      x += gap + piece.width
      continue
    }
    if (x > 0) {
      lines += 1
      x = 0
    }
    if (piece.width <= room) {
      x = piece.width
      continue
    }
    for (const w of piece.chars) {
      if (x > 0 && x + w > room) {
        lines += 1
        x = 0
      }
      x += w
    }
  }
  return lines
}

/**
 * How many lines `runs` take in `width` px. The browser breaks at white space and after «-» and
 * «/», and inside a word only when a piece alone is wider than the line (`overflow-wrap:
 * anywhere`); the count is the larger of breaking at white space only and breaking at all three,
 * since either can take more lines. White space collapses as in HTML. No text — no lines.
 */
export function textLines(runs: readonly Run[], width: number): number {
  const room = width - 1
  return Math.max(fill(pieces(runs, false), room), fill(pieces(runs, true), room))
}

const lines = (text: string, font: Font, width: number) => textLines([{ text, font }], width)

/** A box in a wrapping flex row: its width, or a share of the line's free room for the one that grows. */
interface Item {
  width: number
  /** The width it keeps at least while it grows into the line's free room. */
  grows?: { min: number }
  /** Its height at a given width. */
  height: (width: number) => number
}

/**
 * The height of a flex row with `flex-wrap: wrap` of `items`, `width` px wide: an item goes to the
 * next line when it does not fit beside the ones before it (the growing one by its minimum); each
 * line is as tall as its tallest item.
 */
function wrapHeight(items: readonly Item[], width: number, gap: number, rowGap: number): number {
  const rows: Item[][] = []
  let row: Item[] = []
  let used = 0
  for (const item of items) {
    const size = Math.min(width, item.grows ? item.grows.min : item.width)
    if (row.length && used + gap + size > width) {
      rows.push(row)
      row = []
      used = 0
    }
    used += (row.length ? gap : 0) + size
    row.push(item)
  }
  if (row.length) rows.push(row)
  let height = 0
  for (const each of rows) {
    const fixed = each.filter((item) => !item.grows).reduce((sum, item) => sum + Math.min(width, item.width), 0)
    const free = width - fixed - gap * (each.length - 1)
    height += Math.max(...each.map((item) => item.height(item.grows ? Math.max(item.grows.min, free) : Math.min(width, item.width))))
  }
  return height + rowGap * (rows.length - 1)
}

/** A box of one line of `lineHeight` whose text wraps inside `padX` of padding when it is narrower than the text. */
function textItem(text: string, font: Font, padX: number, lineHeight: number, padY = 0): Item {
  const width = textWidth(text, font) + padX
  // At its own width the text is one line; narrower, it wraps.
  return { width, height: (box) => padY + lineHeight * (box >= width ? 1 : Math.max(1, lines(text, font, box - padX))) }
}

const STEPPER_FONT: Font = { size: 11 }
const DEFAULT_STAGE_TITLES = DEFAULT_PIPELINE.map(stageLabel)

/**
 * The Stage names a Ticket in `state` can show: Queued (the first Stage) while it is open, Done (the
 * last) when done, any Stage between them otherwise — the Stage comes from main's Pipeline
 * snapshot, which also has the facts (a PR, the marks) that pick one of those.
 */
function stageTitles(state: TicketState, stages: readonly string[] | undefined): string[] {
  const all = stages && stages.length >= 2 ? stages : DEFAULT_STAGE_TITLES
  if (state === 'open' || state === 'none') return [all[0]!]
  if (state === 'done') return [all[all.length - 1]!]
  const between = all.slice(1, -1)
  return between.length ? between : [...all]
}

/**
 * The stepper's height in a box `width` px wide, in its narrow form (the Stage's name, its flags,
 * «N/M», who it waits for): the full form, with the dots, is drawn only when it fits on one line
 * (Stepper.tsx), and the narrow one takes no more lines than the widest name the Ticket can show.
 */
function stepperHeight(card: CardInput, width: number): number {
  const label = stageTitles(card.state, card.stages)
    .map((title) => textItem(title, { ...STEPPER_FONT, weight: 600 }, 8 + (card.state === 'done' ? 12 : 0), STEPPER_LINE))
    .reduce((widest, item) => (item.width > widest.width ? item : widest))
  const flag: Item = { width: 8 + textWidth('↺', { size: 11, weight: 700 }), height: () => STEPPER_LINE }
  const flags = card.state === 'work' || card.state === 'blocked' ? [flag, ...(card.state === 'blocked' ? [flag] : [])] : []
  const count = String((card.stages && card.stages.length >= 2 ? card.stages : DEFAULT_STAGE_TITLES).length)
  const parts = [label, ...flags, textItem(`${count}/${count}`, { ...STEPPER_FONT, mono: true }, 0, STEPPER_LINE)]
  // Done waits for nobody (pipeline.ts); else the Ticket's `Waits:` line, or `agent` — wider than `team`.
  if (card.state !== 'done') parts.push(textItem(`· ${card.waits ?? 'agent'}`, STEPPER_FONT, 0, STEPPER_LINE))
  return Math.max(TOP_LINE, wrapHeight(parts, width, STEPPER_GAP, STEPPER_ROW_GAP))
}

/** The top row: the number, the repository chip, the stepper, the Ready chip. */
function topHeight(card: CardInput): number {
  const items: Item[] = [{ width: textWidth(String(card.num).padStart(2, '0'), { size: 12, weight: 600, mono: true }), height: () => TOP_LINE }]
  // The chip of a Project over several repositories (ADR-0045): 12 px monospace, 6 px padding and a 1 px border on each side.
  if (card.repo) items.push(textItem(card.repo, { size: 12, weight: 500, mono: true }, 14, 16, 2))
  items.push({ width: 0, grows: { min: Math.min(CONTENT_WIDTH, STEPPER_MIN_WIDTH) }, height: (width) => stepperHeight(card, width) })
  // The Ready chip: 6 px padding on each side, a 6 px dot and 4 px after it.
  if (card.ready) items.push({ width: textWidth('Ready', { size: 12, weight: 500 }) + 22, height: () => TOP_LINE })
  return wrapHeight(items, CONTENT_WIDTH, TOP_GAP, TOP_ROW_GAP)
}

/** What of a Ticket its card shows, as text. */
export interface CardInput {
  num: number
  /** The title as drawn (`ticketTitle`). */
  title: string
  state: TicketState
  /** The `Waits:` line. */
  waits?: string | null | undefined
  /** The `Repo:` line. */
  repo?: string | null | undefined
  ready: boolean
  /** The blocked reason, drawn in place of the blockers line; null when the line is drawn. */
  reason: string | null
  /** The blockers line (`blockersLine`). */
  meta: BlockersText
  /** The names of the Project's Stages, in order; the default Pipeline's while unknown. */
  stages?: readonly string[] | undefined
}

/** The card's height for `card`: border, padding, the top row, the title, the reason or blockers line, the slots. */
export function cardHeight(card: CardInput): number {
  const title = TITLE_LINE * lines(card.title, { size: 13, weight: 600 }, CONTENT_WIDTH)
  const line =
    card.reason !== null
      ? 2 * REASON_PAD_Y + REASON_LINE * Math.max(1, lines(card.reason, { size: 12 }, CONTENT_WIDTH - 2 * REASON_PAD_X))
      : META_LINE * Math.max(1, textLines(metaRuns(card.meta), CONTENT_WIDTH))
  return 2 * BORDER + 2 * PADDING_Y + topHeight(card) + CARD_GAP + title + CARD_GAP + line + CARD_GAP + SLOTS_HEIGHT
}

// ── the blockers line ────────────────────────────────────────────────────────

/** The blockers line: words, then the Ticket numbers in monospace, then words. */
export interface BlockersText {
  lead: string
  nums: string | null
  tail: string
  /** The Ticket is in "Needs attention": the line says why, in the blocked colour. */
  attention: boolean
}

const META_FONT: Font = { size: 11 }

const metaRuns = (meta: BlockersText): Run[] => [
  { text: meta.lead, font: META_FONT },
  ...(meta.nums === null ? [] : [{ text: meta.nums, font: { ...META_FONT, mono: true } }]),
  { text: meta.tail, font: META_FONT },
]

export const pad = (num: number): string => String(num).padStart(2, '0')
export const numList = (nums: readonly number[]): string => nums.map(pad).join(', ')

/** Why a Ticket is in "Needs attention" (the `AttentionReason` of epic-layout.ts). */
export type Attention = { kind: 'unparsed'; raw: string | null } | { kind: 'missing-blocker'; missing: number[] } | { kind: 'cycle'; cycle: number[] }

export function attentionText(reason: Attention): string {
  switch (reason.kind) {
    case 'unparsed':
      return `“Blocked by: ${reason.raw ?? ''}” is not a list of tickets`
    case 'missing-blocker':
      return `blocked by ${numList(reason.missing)}, not in this epic`
    case 'cycle':
      return `blocking cycle: ${numList(reason.cycle)}`
  }
}

/** The blockers that are in the Epic and not done yet. */
export function waitingOnOf(ticket: Pick<Ticket, 'blockedNums'>, byNum: ReadonlyMap<number, Pick<Ticket, 'state'>>): number[] {
  return ticket.blockedNums.filter((blocker) => byNum.has(blocker) && byNum.get(blocker)!.state !== 'done')
}

/** The line under the title: why the Ticket needs attention, whom it waits on, or that its blockers are done. */
export function blockersLine(ticket: Pick<Ticket, 'state' | 'blockedNums'>, attention: Attention | null, waitingOn: readonly number[]): BlockersText {
  if (attention) return { lead: attentionText(attention), nums: null, tail: '', attention: true }
  if (!ticket.blockedNums.length) return { lead: 'no blockers', nums: null, tail: '', attention: false }
  if (ticket.state !== 'done' && waitingOn.length) return { lead: 'waiting on ', nums: numList(waitingOn), tail: '', attention: false }
  return { lead: 'blocked by ', nums: numList(ticket.blockedNums), tail: ' · done', attention: false }
}

export const blockersString = (meta: BlockersText): string => `${meta.lead}${meta.nums ?? ''}${meta.tail}`
