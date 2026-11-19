import { MAX_ATTACHMENTS, typedText, type Attachment, type ImageMediaType } from '../../shared/agent/attachments'

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
//   file and the live events share, and a hash of the block's text, so a comment finds its block
//   after a restart however much of the transcript is loaded.
// - An image of a comment is kept by main, `<sha256>.<ext>` in its images folder (agent.attach with
//   `keep`); the comment holds its ref, and the bytes are read back from main when the round goes.
// - The text for the agent (agentText) is also what the user's bubble reads back (parseQuoted): a
//   restart has only the transcript, and the bubble needs nothing else to draw the quote blocks.
// - A comment may be on lines of a file of a diff instead (CodeComment, worfy-changes-view ticket 04):
//   the screen Changes makes it, the same tray holds it, and the same round sends it, in a second
//   section of the agent's text after the comments on messages. It names its file, side and lines
//   and keeps their text, so a Refresh of the diff finds the lines again (anchorLines).

/** An image of a comment: one main checked and keeps a copy of (agent.attach with `keep`), named by the sha256 of its bytes. */
export interface CommentImage {
  kind: 'image'
  name: string
  mediaType: ImageMediaType
  size: number
  ref: string
}

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

/** A comment not sent yet on a quote of an agent's message. */
export interface MessageComment {
  /** None: the comments kept before comments on code (store schema `v: 2`) have no kind, and these keep none. */
  kind?: undefined
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

/** What a comment on code is about: a Ticket in part 1 of worfy-changes-view (its spec: part 1 has Tickets alone). */
export interface CodeSubject {
  kind: 'ticket'
  epic: string
  /** The Ticket's number in its epic, as its file names it (`04`). */
  number: string
}

/** A comment not sent yet on lines of a file of a diff (worfy-changes-view ticket 04). */
export interface CodeComment {
  kind: 'code'
  id: string
  /** The file, relative to the root of its repository, `/` between folders. */
  path: string
  /** The root of the repository the diff was read in. */
  repository: string
  /** The side of the diff the lines are on: `old` before the change, `new` after it. */
  side: 'old' | 'new'
  /** The first and the last line on that side, from 1. */
  startLine: number
  endLine: number
  /** The text of those lines as the diff showed them, `\n` between them. */
  code: string
  /** The commit the lines were read at; null for the working tree, not committed yet. */
  commit: string | null
  subject: CodeSubject
  /** The worktree and the branch the header of the agent's section names. */
  worktree: string
  branch: string
  /** The comment; may be empty when there are images. */
  text: string
  images: CommentImage[]
  /** When the comment was made, ms. */
  at: number
}

/** A comment not sent yet: on a quote of an agent's message, or on lines of code. */
export type QuoteComment = MessageComment | CodeComment

/** The comments on quotes of agent messages, without the ones on code: what the transcript lights. */
export function onMessages<T extends QuoteComment>(comments: readonly T[]): Exclude<T, CodeComment>[] {
  return comments.filter((each): each is Exclude<T, CodeComment> => each.kind !== 'code')
}

/** A comment that went: its quote stays dim in the message, and its block stands in the sent bubble. */
export interface SentQuote {
  id: string
  /** The round it went in (SentRound). */
  round: string
  anchor: string
  start: number
  end: number
  quote: string
  text: string
  images: number
  /** Its number in that message, from 1. */
  number: number
}

/** A message a round of comments went in: its text once, for all its quotes. */
export interface SentRound {
  id: string
  /** The text of the message (agentText) as the user typed it: the bubble that shows this text is its bubble. */
  message: string
  at: number
}

/**
 * A round that was sent and has not reached the agent yet: it waits in the Session's queue. Its
 * comments are out of the tray; it becomes sent when its prompt comes, and goes back to the tray
 * when its message leaves the queue without being sent.
 */
export interface PendingRound {
  id: string
  message: string
  at: number
  comments: QuoteComment[]
}

/** A short hash of a text block (FNV-1a, 32 bits, hex): which block of a message a quote is in. */
export function blockKey(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The id of the agent's text block a row draws: its message id and the hash of its text. It does not
 * depend on the blocks before it, so a transcript loaded from a later event names it the same.
 */
export function quoteAnchor(messageId: string, text: string): string {
  return `${messageId}#${blockKey(text)}`
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
export function overlapping<T extends Pick<MessageComment, 'anchor' | 'start' | 'end'>>(drafts: readonly T[], anchor: string, start: number, end: number): T | null {
  return drafts.find((each) => each.anchor === anchor && each.start < end && start < each.end) ?? null
}

/** -1, 0 or 1 as `a` sorts before, with or after `b`, by UTF-16 code units: the same on every machine. */
const byText = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1)

/**
 * The comments of a round in the order the agent reads them: by where they stand in the agent's text,
 * not by when they were made — the earlier message first, then the earlier range in it.
 * `order` places a message among the others (its row in the transcript); without it, by its time.
 * The comments on code come after every comment on a message, as their section does: by worktree and
 * branch (one section each), then by file, side and first line. Their images go in this order too.
 */
export function inTextOrder<T extends QuoteComment>(comments: readonly T[], order?: (anchor: string) => number | undefined): T[] {
  const place = (comment: MessageComment): number => order?.(comment.anchor) ?? comment.messageAt ?? comment.at
  return [...comments].sort((a, b) => {
    if (a.kind === 'code' || b.kind === 'code') {
      if (a.kind !== 'code') return -1
      if (b.kind !== 'code') return 1
      return byText(a.worktree, b.worktree) || byText(a.branch, b.branch) || byText(a.path, b.path) || byText(a.side, b.side) || a.startLine - b.startLine || a.at - b.at
    }
    return place(a) - place(b) || (a.anchor === b.anchor ? a.start - b.start : byText(a.anchor, b.anchor)) || a.at - b.at
  })
}

/** How a quote goes to the agent (owner, answer 4): whole up to QUOTE_FOR_AGENT characters, else its start, «…» and its end. */
export function quoteForAgent(quote: string): string {
  const text = squash(quote)
  if (text.length <= QUOTE_FOR_AGENT) return text
  return `${text.slice(0, QUOTE_HEAD).trimEnd()} … ${text.slice(-QUOTE_TAIL).trimStart()}`
}

/** Lines of code longer than this are cut in the middle in the agent's text (worfy-changes-view spec). */
export const CODE_FOR_AGENT = 6
/** What cut code keeps of its first lines and of its last ones; «…» stands between them. */
const CODE_HEAD = 3
const CODE_TAIL = 2

/** The lines of code as the agent gets them: all up to CODE_FOR_AGENT, else the first ones, «…» and the last ones. */
export function codeForAgent(code: string): string[] {
  const lines = code.split(/\r?\n/)
  if (lines.length <= CODE_FOR_AGENT) return lines
  return [...lines.slice(0, CODE_HEAD), '…', ...lines.slice(-CODE_TAIL)]
}

/** The mark of a comment on code whose lines a new read of the file no longer has. */
export const LINE_CHANGED = 'Line changed'

/**
 * Where a comment's lines lie in the file's text now (after a Refresh of the diff): at their old
 * place when the text there is still theirs, else at the occurrence nearest to it, as anchorRange
 * finds a quote; else nowhere, and the comment is marked LINE_CHANGED.
 */
export function anchorLines(file: string, kept: { startLine: number; code: string }): { startLine: number; endLine: number } | { mark: typeof LINE_CHANGED } {
  const lines = file.split(/\r?\n/)
  const wanted = kept.code.split(/\r?\n/)
  const fits = (from: number): boolean => from >= 0 && from + wanted.length <= lines.length && wanted.every((line, index) => lines[from + index] === line)
  const was = kept.startLine - 1
  let best: number | null = fits(was) ? was : null
  for (let from = 0; best !== was && from + wanted.length <= lines.length; from += 1) {
    if (fits(from) && (best === null || Math.abs(from - was) < Math.abs(best - was))) best = from
  }
  return best === null ? { mark: LINE_CHANGED } : { startLine: best + 1, endLine: best + wanted.length }
}

/** `src/a.ts:11`, `src/a.ts:40–44`: a file and its lines, as the agent's text and a chip of the tray name them. */
export function linesLabel(path: string, startLine: number, endLine: number): string {
  return `${path}:${startLine}${endLine > startLine ? `–${endLine}` : ''}`
}

/** One comment on a quote as the agent's text holds it. */
export interface AgentQuoteItem {
  kind?: undefined
  quote: string
  text: string
  /** How many images the comment has: they go as attachments in this order. */
  images: number
  /** The time of the agent's message as the transcript shows it (`14:02`); null when unknown. */
  time: string | null
}

/** One comment on lines of code as the agent's text holds it. */
export interface AgentCodeItem {
  kind: 'code'
  path: string
  side: 'old' | 'new'
  startLine: number
  endLine: number
  code: string
  commit: string | null
  worktree: string
  branch: string
  text: string
  images: number
}

/** One comment as the agent's text holds it. */
export type AgentItem = AgentQuoteItem | AgentCodeItem

const HEADER = /^Comments on parts of your messages \((\d+)\):$/
const ITEM = /^(\d+)\. > «(.*)» \(your message(?: ([^()]+))?\)$/
const CODE_HEADER = /^Comments on lines of the diff \((\d+)\)(?:, worktree (.+?))?(?:, branch ([^,]+?))?:$/
const CODE_ITEM = /^(\d+)\. (.+):(\d+)(?:–(\d+))? \((old|new) side, (?:commit ([0-9a-f]+)|(uncommitted))\)$/
const CODE_LINE = /^>(?: (.*))?$/
/** How much of a commit the agent's text names, as `git log --oneline` does. */
const COMMIT_SHOWN = 7
const IMAGE_MARK = /^\[image (\d+)\]$/
const INDENT = '   '
const GENERAL = 'General:'

/**
 * The text the agent gets for a round (the prototype's «What the agent receives»): a header with the
 * count, each comment as a numbered quote with its time, its lines indented under it and a mark
 * `[image N]` per image (N counts the images of the whole message, in the order they are attached),
 * then «General:» and the field's own text. Without comments it is the field's text as it is.
 * The comments on code follow in their own section, one per worktree and branch (worfy-changes-view
 * spec): each names its file, lines, side and commit, then the code as `> `
 * lines (codeForAgent), then the comment and its images. `items` come in text order (inTextOrder):
 * the images are numbered in the order the sections write them.
 */
export function agentText(items: readonly AgentItem[], general: string): string {
  const text = general.trim()
  if (items.length === 0) return general
  const lines: string[] = []
  let image = 0
  const body = (item: AgentItem): void => {
    if (item.text.trim() !== '') for (const line of item.text.trim().split('\n')) lines.push(`${INDENT}${line.replace(/\s+$/, '')}`)
    for (let each = 0; each < item.images; each += 1) {
      image += 1
      lines.push(`${INDENT}[image ${image}]`)
    }
    lines.push('')
  }
  const quotes = items.filter((item): item is AgentQuoteItem => item.kind !== 'code')
  if (quotes.length > 0) lines.push(`Comments on parts of your messages (${quotes.length}):`, '')
  quotes.forEach((item, index) => {
    lines.push(`${index + 1}. > «${quoteForAgent(item.quote)}» (your message${item.time === null ? '' : ` ${item.time}`})`)
    body(item)
  })
  for (const section of codeSections(items.filter((item): item is AgentCodeItem => item.kind === 'code'))) {
    const [first] = section
    if (first === undefined) continue
    lines.push(`Comments on lines of the diff (${section.length})${first.worktree === '' ? '' : `, worktree ${first.worktree}`}${first.branch === '' ? '' : `, branch ${first.branch}`}:`, '')
    section.forEach((item, index) => {
      lines.push(`${index + 1}. ${linesLabel(item.path, item.startLine, item.endLine)} (${item.side} side, ${item.commit === null ? 'uncommitted' : `commit ${item.commit.slice(0, COMMIT_SHOWN)}`})`)
      for (const line of codeForAgent(item.code)) {
        const shown = line.replace(/\s+$/, '')
        lines.push(`${INDENT}>${shown === '' ? '' : ` ${shown}`}`)
      }
      body(item)
    })
  }
  if (text !== '') lines.push(GENERAL, text)
  return lines.join('\n').replace(/\s+$/, '')
}

/** The comments on code cut into sections: a new one wherever the worktree or the branch changes. */
function codeSections(items: readonly AgentCodeItem[]): AgentCodeItem[][] {
  const sections: AgentCodeItem[][] = []
  for (const item of items) {
    const last = sections.at(-1)
    const head = last?.[0]
    if (last !== undefined && head !== undefined && head.worktree === item.worktree && head.branch === item.branch) last.push(item)
    else sections.push([item])
  }
  return sections
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

/** A block of a sent message's comment on code, as parseQuoted reads it. */
export interface ParsedCode {
  /** Its number in its section, from 1. */
  number: number
  path: string
  side: 'old' | 'new'
  startLine: number
  endLine: number
  /** The commit as the agent's text names it, shortened; null for uncommitted lines. */
  commit: string | null
  worktree: string
  branch: string
  /** The lines as the agent got them: cut in the middle with «…» when there were more than CODE_FOR_AGENT. */
  code: string[]
  text: string
  /** The numbers of its images among the message's images, from 1. */
  images: number[]
}

/** A sent message with comments: its quote blocks, its blocks of comments on code, and the general text after them. */
export interface ParsedMessage {
  quotes: ParsedQuote[]
  code: ParsedCode[]
  general: string
}

/** The numbered items of one section from line `at`, each read by `item`; null when they do not read as `count` items. */
function readItems<T>(lines: readonly string[], at: number, count: number, item: (head: string, number: number, body: string[]) => T | null): { items: T[]; at: number } | null {
  const items: T[] = []
  let next = at
  while (next < lines.length && items.length < count) {
    const head = lines[next] ?? ''
    next += 1
    const body: string[] = []
    while (next < lines.length && (lines[next] ?? '').startsWith(INDENT)) {
      body.push((lines[next] ?? '').slice(INDENT.length))
      next += 1
    }
    const read = item(head, items.length + 1, body)
    if (read === null) return null
    items.push(read)
    if (next < lines.length && lines[next] !== '') return null
    next += 1
  }
  return items.length === count && count > 0 ? { items, at: next } : null
}

/** A comment's own lines under its head: its text, and the numbers of its `[image N]` marks. */
function commentOf(body: readonly string[]): { text: string; images: number[] } {
  const text: string[] = []
  const images: number[] = []
  for (const line of body) {
    const mark = IMAGE_MARK.exec(line)
    if (mark !== null) images.push(Number(mark[1]))
    else text.push(line)
  }
  return { text: text.join('\n').trim(), images }
}

/**
 * Reads a message agentText wrote back into its quote blocks, its blocks of comments on code and its
 * general text; null for any other text, which the bubble then shows as it is. The whole message has
 * to read: each header and as many numbered items as it names, in order.
 */
export function parseQuoted(message: string): ParsedMessage | null {
  // A Codex transcript keeps the attachment lines main adds at the end of the text (messageText).
  const lines = typedText(message).split('\n')
  const quotes: ParsedQuote[] = []
  const code: ParsedCode[] = []
  let at = 0
  const count = HEADER.exec(lines[0] ?? '')
  if (count !== null) {
    if (lines[1] !== '') return null
    const read = readItems(lines, 2, Number(count[1]), (line, number, body) => {
      const head = ITEM.exec(line)
      if (head === null || Number(head[1]) !== number) return null
      return { number, quote: head[2] ?? '', time: head[3] ?? null, ...commentOf(body) }
    })
    if (read === null) return null
    quotes.push(...read.items)
    at = read.at
  }
  for (let section = CODE_HEADER.exec(lines[at] ?? ''); section !== null; section = CODE_HEADER.exec(lines[at] ?? '')) {
    if (lines[at + 1] !== '') return null
    const worktree = section[2] ?? ''
    const branch = section[3] ?? ''
    const read = readItems(lines, at + 2, Number(section[1]), (line, number, body) => {
      const head = CODE_ITEM.exec(line)
      if (head === null || Number(head[1]) !== number) return null
      const startLine = Number(head[3])
      const endLine = head[4] === undefined ? startLine : Number(head[4])
      // As many `> ` lines as agentText wrote for these lines: all of them, or CODE_FOR_AGENT when cut.
      const shown: string[] = []
      while (shown.length < Math.min(endLine - startLine + 1, CODE_FOR_AGENT)) {
        const quoted = CODE_LINE.exec(body[shown.length] ?? '')
        if (quoted === null) break
        shown.push(quoted[1] ?? '')
      }
      if (shown.length === 0 || endLine < startLine) return null
      const side = head[5] === 'old' ? 'old' : 'new'
      return { number, path: head[2] ?? '', side, startLine, endLine, commit: head[6] ?? null, worktree, branch, code: shown, ...commentOf(body.slice(shown.length)) } satisfies ParsedCode
    })
    if (read === null) return null
    code.push(...read.items)
    at = read.at
  }
  if (quotes.length === 0 && code.length === 0) return null
  if (at >= lines.length) return { quotes, code, general: '' }
  if (lines[at] !== GENERAL) return null
  return { quotes, code, general: lines.slice(at + 1).join('\n') }
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
  return comments.map((each): AgentItem => {
    if (each.kind !== 'code') return { quote: each.quote, text: each.text, images: each.images.length, time: clockOf(each.messageAt) }
    const { path, side, startLine, endLine, code, commit, worktree, branch, text } = each
    return { kind: 'code', path, side, startLine, endLine, code, commit, worktree, branch, text, images: each.images.length }
  })
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
 * comments, the field's message as it is. `imageOf` gives an image's bytes, read back from main.
 * Refused: a slash command in the field (it would reach the agent as text after the comments), more
 * than MESSAGE_IMAGES images of comments, more than MAX_ATTACHMENTS attachments, an image not read back.
 */
export function composeRound(
  drafts: readonly QuoteComment[],
  message: RoundMessage,
  imageOf: (image: CommentImage) => Attachment | undefined,
  order?: (anchor: string) => number | undefined,
): { message: RoundMessage; round: QuoteComment[] } | { error: string } {
  if (drafts.length === 0) return { message, round: [] }
  if (message.text.trimStart().startsWith('/')) return { error: 'A command goes alone: send it without comments, or clear the comments first' }
  const round = inTextOrder(drafts, order)
  const kept = round.flatMap((each) => each.images)
  if (kept.length > MESSAGE_IMAGES) return { error: `Up to ${MESSAGE_IMAGES} images per message: remove some from the comments` }
  if (kept.length + message.attachments.length > MAX_ATTACHMENTS) return { error: `A message takes up to ${MAX_ATTACHMENTS} attachments: remove some from the comments or the field` }
  const images: Attachment[] = []
  for (const image of kept) {
    const attachment = imageOf(image)
    if (attachment === undefined) return { error: `${image.name} could not be read back: attach it again` }
    images.push(attachment)
  }
  return { message: { text: agentText(agentItems(round), message.text), attachments: [...images, ...message.attachments] }, round }
}

/**
 * The general text of a message, for ↑ in the input field: what the user typed after the comments of
 * a round, or the message as it is when it carries none.
 */
export function ownText(message: string): string {
  return parseQuoted(message)?.general ?? message
}
