import { MAX_ATTACHMENTS, type Attachment } from '../../shared/agent/attachments'

// Comments on quotes of an agent's message (worfy-polish ticket 102): the user selects a part of an
// answer, writes a comment on it (text, images, or both), and sends every comment of the round as
// one message, with the field's own text after them. This file is the model, with no DOM and no
// React: where a quote lies in its message, the rule against overlaps, the order of a round, the text
// the agent gets, and how a sent message is read back into quote blocks.
//
// - A quote is a range of the message's plain text: the text of its element as the transcript draws
//   it (Range.toString from the start of the element). Its own text is kept with it; when the message
//   draws differently (a link note, another version of the renderer) the quote is found again by its
//   text, the occurrence nearest to where it was (anchorRange).
// - The message is named by its anchor (quoteAnchor): the agent's message id, which the transcript
//   file and the live events share, so a comment finds its message after a restart.
// - The text for the agent (agentText) is also what the user's bubble reads back (parseQuoted): a
//   restart has only the transcript, and the bubble needs nothing else to draw the quote blocks.

/** An image of a comment: an image attachment main has checked (agent.attach). */
export type CommentImage = Extract<Attachment, { kind: 'image' }>

/** Images one comment takes (owner, answer 3). */
export const COMMENT_IMAGES = 3
/** Images the comments of one message take together (owner, answer 3). */
export const MESSAGE_IMAGES = 10
/** The long side an image is scaled down to before it is attached, in px (owner, answer 3). */
export const IMAGE_EDGE = 1568
/** A quote longer than this many characters is cut in the middle in the agent's text (owner, answer 4). */
export const QUOTE_FOR_AGENT = 200
/** What a cut quote keeps of its start and of its end. */
const QUOTE_HEAD = 130
const QUOTE_TAIL = 55

/** A comment not sent yet. */
export interface QuoteComment {
  id: string
  /** The agent's message (quoteAnchor). */
  anchor: string
  /** The range in the message's plain text, end exclusive. */
  start: number
  end: number
  /** The quoted text as it was selected. */
  quote: string
  /** The comment; may be empty when there are images. */
  text: string
  images: CommentImage[]
  /** When the agent's message came, ms; null when the transcript does not say. Orders a round. */
  messageAt: number | null
  /** When the comment was made, ms. */
  at: number
}

/** A comment that went: its quote stays dim in the message, and its block stands in the sent bubble. */
export interface SentQuote {
  id: string
  anchor: string
  start: number
  end: number
  quote: string
  text: string
  images: number
  /** The text of the message it went in (agentText): the bubble that shows this text is its bubble. */
  message: string
  /** Its number in that message, from 1. */
  number: number
  at: number
}

/** The id of the agent's message a text row draws: its message id and which text block of that message it is. */
export function quoteAnchor(messageId: string, block: number): string {
  return `${messageId}#${block}`
}

/** Whitespace of any length as one space, none at the ends: how a quote is written for the agent and in a bubble. */
export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The range without the whitespace at its ends; null when nothing else is in it. */
export function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let from = Math.max(0, start)
  let to = Math.min(text.length, end)
  while (from < to && /\s/.test(text[from] ?? '')) from += 1
  while (to > from && /\s/.test(text[to - 1] ?? '')) to -= 1
  return to > from ? { start: from, end: to } : null
}

/**
 * Where a kept quote lies in the message's text now: at its offsets when the text there is still the
 * quote, else at the occurrence of the quote nearest to where it was, else nowhere (null).
 */
export function anchorRange(text: string, kept: { start: number; end: number; quote: string }): { start: number; end: number } | null {
  if (kept.quote === '') return null
  if (text.slice(kept.start, kept.end) === kept.quote) return { start: kept.start, end: kept.end }
  let best: number | null = null
  for (let at = text.indexOf(kept.quote); at !== -1; at = text.indexOf(kept.quote, at + 1)) {
    if (best === null || Math.abs(at - kept.start) < Math.abs(best - kept.start)) best = at
  }
  return best === null ? null : { start: best, end: best + kept.quote.length }
}

/**
 * The comment not sent yet that a new range of message `anchor` overlaps (owner, answer 1): none when
 * the range only touches it. Sent quotes do not count: a new round may comment on them again.
 */
export function overlapping<T extends Pick<QuoteComment, 'anchor' | 'start' | 'end'>>(drafts: readonly T[], anchor: string, start: number, end: number): T | null {
  return drafts.find((each) => each.anchor === anchor && each.start < end && start < each.end) ?? null
}

/**
 * The comments of a round in the order the agent reads them: by where they stand in the agent's text,
 * not by when they were made — the earlier message first, then the earlier range in it.
 * `order` places a message among the others (its row in the transcript); without it, by its time.
 */
export function inTextOrder<T extends Pick<QuoteComment, 'anchor' | 'start' | 'messageAt' | 'at'>>(comments: readonly T[], order?: (anchor: string) => number | undefined): T[] {
  const place = (comment: T): number => order?.(comment.anchor) ?? comment.messageAt ?? comment.at
  return [...comments].sort((a, b) => place(a) - place(b) || (a.anchor === b.anchor ? a.start - b.start : a.anchor < b.anchor ? -1 : 1) || a.at - b.at)
}

/** How a quote goes to the agent (owner, answer 4): whole up to QUOTE_FOR_AGENT characters, else its start, «…» and its end. */
export function quoteForAgent(quote: string): string {
  const text = squash(quote)
  if (text.length <= QUOTE_FOR_AGENT) return text
  return `${text.slice(0, QUOTE_HEAD).trimEnd()} … ${text.slice(-QUOTE_TAIL).trimStart()}`
}

/** One comment as the agent's text holds it. */
export interface AgentItem {
  quote: string
  text: string
  /** How many images the comment has: they go as attachments in this order. */
  images: number
  /** The time of the agent's message as the transcript shows it (`14:02`); null when unknown. */
  time: string | null
}

const HEADER = /^Comments on parts of your messages \((\d+)\):$/
const ITEM = /^(\d+)\. > «(.*)» \(your message(?: ([^()]+))?\)$/
const IMAGE_MARK = /^\[image (\d+)\]$/
const INDENT = '   '
const GENERAL = 'General:'

/**
 * The text the agent gets for a round (the prototype's «What the agent receives»): a header with the
 * count, each comment as a numbered quote with its time, its lines indented under it and a mark
 * `[image N]` per image (N counts the images of the whole message, in the order they are attached),
 * then «General:» and the field's own text. Without comments it is the field's text as it is.
 */
export function agentText(items: readonly AgentItem[], general: string): string {
  const text = general.trim()
  if (items.length === 0) return general
  const lines = [`Comments on parts of your messages (${items.length}):`, '']
  let image = 0
  items.forEach((item, index) => {
    lines.push(`${index + 1}. > «${quoteForAgent(item.quote)}» (your message${item.time === null ? '' : ` ${item.time}`})`)
    if (item.text.trim() !== '') for (const line of item.text.trim().split('\n')) lines.push(`${INDENT}${line.replace(/\s+$/, '')}`)
    for (let each = 0; each < item.images; each += 1) {
      image += 1
      lines.push(`${INDENT}[image ${image}]`)
    }
    lines.push('')
  })
  if (text !== '') lines.push(GENERAL, text)
  return lines.join('\n').replace(/\s+$/, '')
}

/** A quote block of a sent message, as parseQuoted reads it. */
export interface ParsedQuote {
  number: number
  /** The quote as the agent got it: cut in the middle when it was long. */
  quote: string
  time: string | null
  text: string
  /** The numbers of its images among the message's images, from 1. */
  images: number[]
}

/** A sent message with comments: its quote blocks and the general text after them. */
export interface ParsedMessage {
  quotes: ParsedQuote[]
  general: string
}

/**
 * Reads a message agentText wrote back into its quote blocks and its general text; null for any
 * other text, which the bubble then shows as it is. The whole message has to read: the header and
 * as many numbered items as it names, in order.
 */
export function parseQuoted(message: string): ParsedMessage | null {
  const lines = message.split('\n')
  const count = HEADER.exec(lines[0] ?? '')
  if (count === null || lines[1] !== '') return null
  const expected = Number(count[1])
  const quotes: ParsedQuote[] = []
  let at = 2
  while (at < lines.length && quotes.length < expected) {
    const head = ITEM.exec(lines[at] ?? '')
    if (head === null || Number(head[1]) !== quotes.length + 1) return null
    at += 1
    const body: string[] = []
    const images: number[] = []
    while (at < lines.length && (lines[at] ?? '').startsWith(INDENT)) {
      const line = (lines[at] ?? '').slice(INDENT.length)
      const mark = IMAGE_MARK.exec(line)
      if (mark !== null) images.push(Number(mark[1]))
      else body.push(line)
      at += 1
    }
    quotes.push({ number: quotes.length + 1, quote: head[2] ?? '', time: head[3] ?? null, text: body.join('\n').trim(), images })
    if (at < lines.length && lines[at] !== '') return null
    at += 1
  }
  if (quotes.length !== expected || expected === 0) return null
  if (at >= lines.length) return { quotes, general: '' }
  if (lines[at] !== GENERAL) return null
  return { quotes, general: lines.slice(at + 1).join('\n') }
}

/** Why one more image does not fit (owner, answer 3), or null when it does. */
export function imageRefusal(inComment: number, inOtherComments: number): string | null {
  if (inComment >= COMMENT_IMAGES) return `Up to ${COMMENT_IMAGES} images per comment.`
  if (inComment + inOtherComments >= MESSAGE_IMAGES) return `Up to ${MESSAGE_IMAGES} images per message.`
  return null
}

/** The size an image of `width` × `height` is scaled to: its long side at most IMAGE_EDGE, never larger than it is. */
export function scaledSize(width: number, height: number, edge = IMAGE_EDGE): { width: number; height: number; scaled: boolean } {
  const factor = Math.min(1, edge / Math.max(width, height, 1))
  if (factor === 1) return { width, height, scaled: false }
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), scaled: true }
}

/** `14:02`: the time of a message as a quote names it, in the local zone. */
export function clockOf(at: number | null): string | null {
  if (at === null || !Number.isFinite(at)) return null
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The comments of a round as the agent's text holds them, in text order. */
export function agentItems(comments: readonly QuoteComment[]): AgentItem[] {
  return comments.map((each) => ({ quote: each.quote, text: each.text, images: each.images.length, time: clockOf(each.messageAt) }))
}

/** The first five words of a quote, for a chip of the tray; «…» when there is more. */
export function chipWords(quote: string, words = 5): string {
  const all = squash(quote).split(' ')
  let shown = all.slice(0, words).join(' ')
  if (shown.length > 34) shown = shown.slice(0, 33).trimEnd()
  return shown.length < squash(quote).length ? `${shown}…` : shown
}

/** A message as the input field sends it (MessageInput.tsx, OutgoingMessage). */
export interface RoundMessage {
  text: string
  attachments: Attachment[]
}

/**
 * The message a round of comments goes in: the comments in text order (inTextOrder), their quotes and
 * texts before the field's own text (agentText), their images first among the attachments, in that
 * order, so `[image N]` is the message's N-th attachment; the field's attachments after them. Without
 * comments, the field's message as it is. Refused when the attachments are past MAX_ATTACHMENTS.
 */
export function composeRound(drafts: readonly QuoteComment[], message: RoundMessage, order?: (anchor: string) => number | undefined): { message: RoundMessage; round: QuoteComment[] } | { error: string } {
  if (drafts.length === 0) return { message, round: [] }
  const round = inTextOrder(drafts, order)
  const images = round.flatMap((each) => each.images)
  if (images.length + message.attachments.length > MAX_ATTACHMENTS) return { error: `A message takes up to ${MAX_ATTACHMENTS} attachments: remove some from the comments or the field` }
  return { message: { text: agentText(agentItems(round), message.text), attachments: [...images, ...message.attachments] }, round }
}
