import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { SHORTCUTS } from '../../shared/shortcuts'
import { invoke } from '../ipc'
import { label as shortcutLabel, matches as matchesShortcut } from '../shortcuts/match'
import { dismissToast, showToast } from '../toast/toasts'
import { readCommentImage } from './comment-image'
import type { OutgoingMessage } from './MessageInput'
import { anchorRange, chipWords, composeRound, imageRefusal, inTextOrder, overlapping, squash, trimRange, type CommentImage, type QuoteComment } from './quote-comments'
import { CommentPopover, ContextMenu, HoverCard, ImageIcon, QuoteIcon, SelectionButton, type Menu, type MenuItem, type Popover, type Selected, type Selection } from './QuoteCommentParts'
import { addDraft, editDraft, markSent, removeDrafts, useQuotes } from './quote-store'
import type { SentQuotes } from './sent-quotes'
import type { TranscriptJump } from './Transcript'
import './quote-comments.css'

// Comments on quotes of the agent's messages in the Session view (worfy-polish ticket 102), built
// against the owner's prototype (Card card-b7c9cf09). The text of an agent's answer is selected; a
// right click (a two-finger click on a trackpad) opens «Comment» / «Copy», a button next to the
// selection says «Comment ⌘⇧M», and ⌘⇧M (Ctrl+Shift+M) does the same. The popover takes the comment
// and up to three images (a file, a paste, a drop). The quote is lit — a light green ground and a green
// underline — and the tray above the input field lists the round; Send sends the round as one message
// (quote-comments.ts, agentText) and the quotes stay dim for good (owner, answer 2).
//
// The light is painted with the CSS Custom Highlight API, as find is (transcript-find.ts): the
// transcript's markdown is React's, and wrapping its text in elements would fight React's own updates.
// A highlight is no element, so the pointer finds the comment under it by the rectangles of its range
// (hitAt), and the keyboard reaches a comment through its chip in the tray. A text row the transcript
// lets be commented carries `data-quote-anchor` and `data-quote-at` (Transcript.tsx, quoteTarget).

/** The names of the highlights in CSS (quote-comments.css). */
const HIGHLIGHT = { draft: 'worfy-quote', sent: 'worfy-quote-sent', pending: 'worfy-quote-pending', hover: 'worfy-quote-hover', flash: 'worfy-quote-flash' } as const

/** How long the pointer rests on a light before its card shows, and leaves it before the card goes, in ms. */
const HOVER_IN_MS = 280
const HOVER_OUT_MS = 220
/** How long a flash lasts, in ms; the CSS fades nothing, the light just goes back. */
const FLASH_MS = 1300
/** How long Undo of a deletion is offered, in ms. */
const UNDO_MS = 6000

type Registry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void }

/** The CSS highlight registry and its Highlight class; undefined where the API is missing (jsdom). */
function highlights(): { registry: Registry; Highlight: new (...ranges: Range[]) => { priority: number } } | undefined {
  const css = (globalThis as { CSS?: { highlights?: Registry } }).CSS
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => { priority: number } }).Highlight
  return css?.highlights !== undefined && Highlight !== undefined ? { registry: css.highlights, Highlight } : undefined
}

function clearHighlights(): void {
  const api = highlights()
  for (const name of Object.values(HIGHLIGHT)) api?.registry.delete(name)
}

/** The text-row element of a node inside an agent's message that may be commented on; null outside one. */
function anchorElement(node: Node | null): HTMLElement | null {
  const element = node === null ? null : node.nodeType === 1 ? (node as Element) : node.parentElement
  return element?.closest<HTMLElement>('[data-quote-anchor]') ?? null
}

/** The offset of a point (node, offset) in the plain text of `element`. */
function offsetIn(element: HTMLElement, node: Node, offset: number): number {
  const range = element.ownerDocument.createRange()
  range.setStart(element, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

/** A range over the characters `start`…`end` of the plain text of `element`; null when the text is shorter. */
function rangeAt(element: HTMLElement, start: number, end: number): Range | null {
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */)
  const range = element.ownerDocument.createRange()
  let at = 0
  let started = false
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = (node as Text).data.length
    if (!started && start < at + length) {
      range.setStart(node, start - at)
      started = true
    }
    if (started && end <= at + length) {
      range.setEnd(node, end - at)
      return range
    }
    at += length
  }
  return null
}

interface Painted {
  id: string
  sent: boolean
  range: Range
  element: HTMLElement
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

let made = 0
/** A new comment's id: unique in this window, and across restarts by the time. */
const newId = (): string => `q${Date.now().toString(36)}${(made += 1).toString(36)}`

/** Copies text, quietly: a refused clipboard only goes to the console. */
function copy(text: string): void {
  void globalThis.navigator?.clipboard?.writeText(text).catch((error: unknown) => console.error('[quotes] copy failed', error))
}

export interface QuoteCommentsOptions {
  /** The key of the Session's comments (quote-store.ts, quoteKey); null: nothing can be commented on. */
  storeKey: string | null
  /** The live Session, which checks the images (agent.attach); null while none runs. */
  sessionId: string | null
  /** The transcript's log element. */
  log: RefObject<HTMLDivElement | null>
  /** How the agent's rows are labelled: `claude`, `codex`, `orch`. */
  assistant: string
  /** Why comments cannot be made now (a read-only screen); null when they can. */
  refusal: string | null
}

export interface QuoteCommentsLayer {
  /** The floating parts: the button, the menu, the popover, the card. */
  overlay: ReactNode
  /** The tray above the input field; null with no comment in the round. */
  tray: ReactNode
  /** Comments in the round. */
  count: number
  /** The message as it goes with the round's comments, or why it cannot go. */
  compose: (message: OutgoingMessage) => { message: OutgoingMessage; round: QuoteComment[] } | { error: string }
  /** The round went in a message with this text. */
  sent: (round: readonly QuoteComment[], text: string) => void
  /** For the Transcript: the row to bring into view, and what to do once it is there. */
  jump: TranscriptJump | null
  onJump: (row: HTMLElement, jump: TranscriptJump) => void
  /** For the bubbles of sent messages (QuotedPrompt.tsx). */
  sentQuotes: SentQuotes
}

/** The comments on quotes of one Session view. */
export function useQuoteComments({ storeKey, sessionId, log: logRef, assistant, refusal }: QuoteCommentsOptions): QuoteCommentsLayer {
  const quotes = useQuotes(storeKey)
  const { drafts, sent } = quotes
  const [selection, setSelection] = useState<Selection | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [popover, setPopoverState] = useState<Popover | null>(null)
  // The comment under the pointer (its light, or its chip in the tray: `card` false, no card for it).
  const [hover, setHover] = useState<{ id: string; rect: DOMRect; card: boolean } | null>(null)
  const [card, setCard] = useState<{ id: string; rect: DOMRect } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [jump, setJump] = useState<TranscriptJump | null>(null)
  const [said, setSaid] = useState('')
  const [shake, setShake] = useState(0)
  const painted = useRef<Painted[]>([])
  const then = useRef<((row: HTMLElement) => void) | null>(null)
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The popover as it is now, ahead of the next render: reading images is async, and a key or a click
  // outside reads it in a listener. Every change goes through setPopover, which keeps both, so an image
  // read while another is checked counts against the images there are by then.
  const popoverNow = useRef<Popover | null>(null)
  const setPopover = useCallback((next: Popover | null | ((open: Popover | null) => Popover | null)) => {
    popoverNow.current = typeof next === 'function' ? next(popoverNow.current) : next
    setPopoverState(popoverNow.current)
  }, [])
  const enabled = storeKey !== null && refusal === null
  const commentKeys = shortcutLabel(SHORTCUTS.quoteComment)
  const saveKeys = shortcutLabel(SHORTCUTS.quoteSave)

  // The same words twice are still news to a screen reader: the second time ends in a no-break space.
  const say = useCallback((text: string) => setSaid((was) => (was === text ? `${text}\u00a0` : text)), [])

  // ── the light ───────────────────────────────────────────────────────────────────────────────
  const paint = useCallback(() => {
    const element = logRef.current
    const api = highlights()
    const found: Painted[] = []
    const ranges = { draft: [] as Range[], sent: [] as Range[], pending: [] as Range[], hover: [] as Range[], flash: [] as Range[] }
    if (element !== null) {
      for (const message of Array.from(element.querySelectorAll<HTMLElement>('[data-quote-anchor]'))) {
        const anchor = message.dataset['quoteAnchor'] ?? ''
        const text = message.textContent ?? ''
        const lit = (kept: { start: number; end: number; quote: string }): Range | null => {
          const at = anchorRange(text, kept)
          return at === null ? null : rangeAt(message, at.start, at.end)
        }
        for (const each of sent) {
          if (each.anchor !== anchor) continue
          const range = lit(each)
          if (range === null) continue
          found.push({ id: each.id, sent: true, range, element: message })
          ranges.sent.push(range)
          if (hover?.id === each.id) ranges.hover.push(range)
          if (flash === each.id) ranges.flash.push(range)
        }
        for (const each of drafts) {
          if (each.anchor !== anchor) continue
          const range = lit(each)
          if (range === null) continue
          found.push({ id: each.id, sent: false, range, element: message })
          ranges.draft.push(range)
          if (hover?.id === each.id || popover?.id === each.id) ranges.hover.push(range)
          if (flash === each.id) ranges.flash.push(range)
        }
        if (popover !== null && popover.id === null && popover.anchor === anchor) {
          const range = lit(popover)
          if (range !== null) ranges.pending.push(range)
        }
      }
    }
    painted.current = found
    if (api === undefined) return
    const order: (keyof typeof HIGHLIGHT)[] = ['sent', 'draft', 'pending', 'hover', 'flash']
    order.forEach((name, priority) => {
      const highlight = new api.Highlight(...ranges[name])
      highlight.priority = priority + 1
      api.registry.set(HIGHLIGHT[name], highlight)
    })
  }, [logRef, drafts, sent, hover, flash, popover])

  useLayoutEffect(() => {
    paint()
    const element = logRef.current
    if (element === null || typeof MutationObserver === 'undefined') return
    let frame = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    })
    observer.observe(element, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [paint, logRef])
  useEffect(() => clearHighlights, [])

  /** The comment whose light is under the point; null when none is. */
  const hitAt = useCallback((x: number, y: number): Painted | null => {
    for (const each of painted.current) {
      for (const box of Array.from(each.range.getClientRects?.() ?? [])) if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return each
    }
    return null
  }, [])

  const flashOn = useCallback((id: string) => {
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    setFlash(id)
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS)
  }, [])
  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
      if (cardTimer.current !== null) clearTimeout(cardTimer.current)
    },
    [],
  )

  // ── the selection ───────────────────────────────────────────────────────────────────────────
  const readSelection = useCallback((): Selection | null => {
    const element = logRef.current
    const chosen = globalThis.getSelection?.()
    if (element === null || !enabled || chosen === null || chosen === undefined || chosen.rangeCount === 0 || chosen.isCollapsed) return null
    const range = chosen.getRangeAt(0)
    const first = anchorElement(range.startContainer)
    const last = anchorElement(range.endContainer)
    if ((first === null && last === null) || !element.contains(first ?? last)) return null
    const boxes = Array.from(range.getClientRects?.() ?? [])
    const rect = boxes.at(-1) ?? range.getBoundingClientRect?.() ?? new DOMRect()
    if (first !== last || first === null) return { cross: true, rect }
    const text = first.textContent ?? ''
    const trimmed = trimRange(text, offsetIn(first, range.startContainer, range.startOffset), offsetIn(first, range.endContainer, range.endOffset))
    if (trimmed === null) return null
    const anchor = first.dataset['quoteAnchor'] ?? ''
    const at = Number(first.dataset['quoteAt'])
    return { anchor, ...trimmed, quote: text.slice(trimmed.start, trimmed.end), messageAt: Number.isFinite(at) && first.dataset['quoteAt'] !== undefined ? at : null, overlap: overlapping(drafts, anchor, trimmed.start, trimmed.end), rect }
  }, [logRef, enabled, drafts])

  // The button follows the selection: after the mouse lets go, or a moment after a keyboard selection changes.
  useEffect(() => {
    let down = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const update = () => setSelection(popoverNow.current === null ? readSelection() : null)
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('[data-quote-float]') !== null)) return
      down = true
      setSelection(null)
    }
    const onUp = () => {
      if (!down) return
      down = false
      setTimeout(update, 10)
    }
    const onChange = () => {
      if (down) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(update, 140)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('selectionchange', onChange)
    return () => {
      if (timer !== null) clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [readSelection])

  // ── the popover ─────────────────────────────────────────────────────────────────────────────
  const openNew = useCallback((chosen: Selected) => {
    setMenu(null)
    setCard(null)
    setSelection(null)
    globalThis.getSelection?.()?.removeAllRanges()
    setPopover({ id: null, anchor: chosen.anchor, start: chosen.start, end: chosen.end, quote: chosen.quote, messageAt: chosen.messageAt, text: '', images: [], reading: 0, error: null, was: { text: '', images: 0 } })
  }, [setPopover])

  const openEdit = useCallback(
    (id: string) => {
      const comment = drafts.find((each) => each.id === id)
      if (comment === undefined) return
      setMenu(null)
      setCard(null)
      setSelection(null)
      globalThis.getSelection?.()?.removeAllRanges()
      setPopover({ ...comment, id, reading: 0, error: null, was: { text: comment.text, images: comment.images.length } })
    },
    [drafts, setPopover],
  )

  const close = () => setPopover(null)

  const save = () => {
    const open = popoverNow.current
    if (open === null || storeKey === null) return
    const text = open.text.trim()
    if (text === '' && open.images.length === 0) {
      setPopover({ ...open, error: 'Write a comment or add an image.' })
      return
    }
    if (open.reading > 0) {
      setPopover({ ...open, error: 'Wait for the images to be read.' })
      return
    }
    const id = open.id ?? newId()
    if (open.id === null) addDraft(storeKey, { id, anchor: open.anchor, start: open.start, end: open.end, quote: open.quote, text, images: open.images, messageAt: open.messageAt, at: Date.now() })
    else editDraft(storeKey, id, { text, images: open.images })
    setPopover(null)
    flashOn(id)
    say(open.id === null ? `Comment saved. ${plural(drafts.length + 1, 'comment')} in the reply.` : 'Comment updated.')
  }

  const remove = useCallback(
    (ids: readonly string[]) => {
      if (storeKey === null) return
      const gone = removeDrafts(storeKey, ids)
      if (gone.length === 0) return
      setCard(null)
      setPopover((open) => (open !== null && open.id !== null && ids.includes(open.id) ? null : open))
      const toast = showToast({
        kind: 'action',
        key: `quote-undo:${storeKey}`,
        text: gone.length === 1 ? 'Comment deleted' : `${plural(gone.length, 'comment')} cleared`,
        testId: 'quote-undo-toast',
        actions: [{ label: 'Undo', run: () => gone.forEach((each) => addDraft(storeKey, each)) }],
      })
      setTimeout(() => dismissToast(toast), UNDO_MS)
      say(gone.length === 1 ? 'Comment deleted.' : 'Comments cleared.')
    },
    [storeKey, say, setPopover],
  )

  /** Images from a file, a paste or a drop, scaled and checked by main, within the limits (owner, answer 3). */
  const addImages = async (files: readonly File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (popoverNow.current === null) return
    if (files.length > 0 && images.length === 0) {
      setPopover((open) => open && { ...open, error: 'Only images can be attached here.' })
      return
    }
    if (sessionId === null) {
      setPopover((open) => open && { ...open, error: 'The Session is not running: images cannot be attached.' })
      return
    }
    for (const file of images) {
      const open: Popover | null = popoverNow.current
      if (open === null) return
      const others = drafts.filter((each) => each.id !== open.id).reduce((sum, each) => sum + each.images.length, 0)
      const refused = imageRefusal(open.images.length + open.reading, others)
      if (refused !== null) {
        setPopover({ ...open, error: refused })
        return
      }
      setPopover({ ...open, reading: open.reading + 1, error: null })
      let image: CommentImage | null = null
      let error: string | null = null
      try {
        const result = await invoke('agent.attach', { sessionId, sources: [await readCommentImage(file)] })
        const first = result.ok ? result.value.results[0] : undefined
        if (!result.ok) error = result.error
        else if (first === undefined) error = `${file.name || 'The image'} could not be attached.`
        else if (!first.ok) error = first.error
        else if (first.attachment.kind !== 'image') error = `${first.attachment.name} is not an image.`
        else image = first.attachment
      } catch (reason) {
        error = `${file.name || 'The image'} could not be read.`
        console.error('[quotes] an image could not be read', reason)
      }
      // The image is this popover's: one closed meanwhile, or opened on another quote, does not get it.
      const same = (now: Popover): boolean => now.id === open.id && now.anchor === open.anchor && now.start === open.start && now.end === open.end
      setPopover((now) => (now !== null && same(now) ? { ...now, reading: Math.max(0, now.reading - 1), images: image === null ? now.images : [...now.images, image], error: error ?? now.error } : now))
      if (popoverNow.current === null || !same(popoverNow.current)) return
    }
  }

  // ── the menu, the key, the pointer ──────────────────────────────────────────────────────────
  const goToReply = useCallback((id: string) => {
    const quote = sent.find((each) => each.id === id)
    if (quote === undefined) return
    setCard(null)
    setMenu(null)
    then.current = (row) => {
      const block = row.querySelector<HTMLElement>(`[data-quote-number="${quote.number}"]`) ?? row
      block.scrollIntoView?.({ block: 'center' })
      block.classList.remove('w-qprompt__block--flash')
      void block.offsetWidth
      block.classList.add('w-qprompt__block--flash')
      block.focus({ preventScroll: true })
    }
    setJump((was) => ({ seq: (was?.seq ?? 0) + 1, prompt: quote.message }))
  }, [sent])

  /** Brings a comment's light into view and flashes it; `open` shows its card too, for the keyboard. */
  const goToLight = useCallback(
    (id: string, open: boolean) => {
      const quote = drafts.find((each) => each.id === id) ?? sent.find((each) => each.id === id)
      if (quote === undefined) return
      then.current = () => {
        const found = painted.current.find((each) => each.id === id)
        const box = found?.range.getBoundingClientRect?.()
        const element = logRef.current
        if (found !== undefined && box !== undefined && element !== null) {
          const view = element.getBoundingClientRect()
          element.scrollTop += box.top - view.top - (element.clientHeight - box.height) / 2
          if (open) setCard({ id, rect: box })
        }
        flashOn(id)
      }
      setJump((was) => ({ seq: (was?.seq ?? 0) + 1, anchor: quote.anchor }))
    },
    [drafts, sent, logRef, flashOn],
  )

  const onJump = useCallback((row: HTMLElement) => {
    const run = then.current
    then.current = null
    run?.(row)
  }, [])

  const commentItems = (id: string, isSent: boolean, quote: string): MenuItem[] =>
    isSent
      ? [
          { label: 'Go to my reply', testId: 'quote-menu-reply', run: () => goToReply(id) },
          { label: 'Copy quote', testId: 'quote-menu-copy-quote', run: () => copy(quote) },
        ]
      : [
          { label: 'Edit comment', testId: 'quote-menu-edit', run: () => openEdit(id) },
          { label: 'Delete comment', testId: 'quote-menu-delete', run: () => remove([id]) },
          { label: 'Copy quote', testId: 'quote-menu-copy-quote', run: () => copy(quote) },
        ]

  useEffect(() => {
    const element = logRef.current
    if (element === null || !enabled) return
    const onMenu = (event: MouseEvent) => {
      const chosen = readSelection()
      const hit = hitAt(event.clientX, event.clientY)
      const quote = hit === null ? null : (drafts.find((each) => each.id === hit.id)?.quote ?? sent.find((each) => each.id === hit.id)?.quote ?? '')
      const inMessage = anchorElement(event.target as Node) !== null
      const items: MenuItem[] = []
      if (chosen !== null && inMessage && !(hit !== null && !('cross' in chosen) && chosen.overlap?.id === hit.id)) {
        const text = globalThis.getSelection?.()?.toString() ?? ''
        if ('cross' in chosen) items.push({ label: 'Comment', keys: commentKeys, disabled: true, note: 'Select text inside one agent message.', testId: 'quote-menu-comment', run: () => undefined })
        else if (chosen.overlap !== null) {
          const overlap = chosen.overlap
          items.push(
            { label: 'Comment', keys: commentKeys, disabled: true, note: 'Overlaps a comment you have not sent yet.', testId: 'quote-menu-comment', run: () => undefined },
            { label: 'Open that comment', testId: 'quote-menu-open', run: () => openEdit(overlap.id) },
          )
        } else items.push({ label: 'Comment', keys: commentKeys, testId: 'quote-menu-comment', run: () => openNew(chosen) })
        items.push({ label: 'Copy', keys: shortcutLabel({ id: 'copy', title: 'Copy', group: 'Session', scope: 'session view', keys: { primary: true, key: 'C' } }), testId: 'quote-menu-copy', run: () => copy(text) })
        if (hit !== null && quote !== null) items.push('separator', ...commentItems(hit.id, hit.sent, quote))
      } else if (hit !== null && quote !== null) {
        items.push(...commentItems(hit.id, hit.sent, quote))
      }
      if (items.length === 0) return
      event.preventDefault()
      setSelection(null)
      setCard(null)
      setMenu({ x: event.clientX, y: event.clientY, items })
    }
    let frame = 0
    const onMove = (event: MouseEvent) => {
      if (event.buttons !== 0) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const hit = hitAt(event.clientX, event.clientY)
        setHover((was) => (hit === null ? (was === null ? was : null) : was?.id === hit.id ? was : { id: hit.id, rect: hit.range.getBoundingClientRect?.() ?? new DOMRect(), card: true }))
      })
    }
    const onLeave = () => setHover(null)
    const onClick = (event: MouseEvent) => {
      const chosen = globalThis.getSelection?.()
      if (chosen !== null && chosen !== undefined && !chosen.isCollapsed) return
      const hit = hitAt(event.clientX, event.clientY)
      if (hit === null) return
      setCard(null)
      if (hit.sent) goToReply(hit.id)
      else openEdit(hit.id)
    }
    element.addEventListener('contextmenu', onMenu)
    element.addEventListener('mousemove', onMove)
    element.addEventListener('mouseleave', onLeave)
    element.addEventListener('click', onClick)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('contextmenu', onMenu)
      element.removeEventListener('mousemove', onMove)
      element.removeEventListener('mouseleave', onLeave)
      element.removeEventListener('click', onClick)
    }
  })

  // The card of the comment under the pointer, after a short rest.
  useEffect(() => {
    if (cardTimer.current !== null) clearTimeout(cardTimer.current)
    if (hover !== null && hover.card && popover === null && menu === null) cardTimer.current = setTimeout(() => setCard({ id: hover.id, rect: hover.rect }), HOVER_IN_MS)
    else if (hover === null) cardTimer.current = setTimeout(() => setCard(null), HOVER_OUT_MS)
  }, [hover, popover, menu])

  // ⌘⇧M (Ctrl+Shift+M): the selection's comment, new or the one it overlaps; Esc closes what floats.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = logRef.current
      if (element === null || element.clientHeight === 0) return
      if (matchesShortcut(event, SHORTCUTS.quoteComment)) {
        if (!enabled || popoverNow.current !== null) return
        const chosen = readSelection()
        if (chosen === null) {
          const inLog = element.contains(globalThis.getSelection?.()?.anchorNode ?? null)
          if (!inLog) return
        }
        event.preventDefault()
        if (chosen !== null && !('cross' in chosen)) {
          if (chosen.overlap !== null) openEdit(chosen.overlap.id)
          else openNew(chosen)
          return
        }
        showToast({ kind: 'info', key: 'quote-hint', text: chosen === null ? 'Select text in an agent message first' : 'Select text inside one agent message' })
        return
      }
      if (event.key === 'Escape') {
        if (menu !== null) {
          event.preventDefault()
          setMenu(null)
        } else if (card !== null) setCard(null)
        else if (selection !== null) {
          setSelection(null)
          globalThis.getSelection?.()?.removeAllRanges()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // A scroll or a resize moves the text under what floats: the menu and the card close, the button follows.
  useEffect(() => {
    const element = logRef.current
    if (element === null) return
    const onScroll = () => {
      setMenu(null)
      setCard(null)
      setHover(null)
      setSelection((was) => (was === null ? was : readSelection()))
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    globalThis.addEventListener('resize', onScroll)
    return () => {
      element.removeEventListener('scroll', onScroll)
      globalThis.removeEventListener('resize', onScroll)
    }
  }, [logRef, readSelection])

  // ── sending ─────────────────────────────────────────────────────────────────────────────────
  const compose = useCallback(
    (message: OutgoingMessage): { message: OutgoingMessage; round: QuoteComment[] } | { error: string } => {
      return composeRound(drafts, message)
    },
    [drafts],
  )

  const markRoundSent = useCallback(
    (round: readonly QuoteComment[], text: string) => {
      if (storeKey === null || round.length === 0) return
      markSent(storeKey, round, text, Date.now())
      say(`Sent with ${plural(round.length, 'quote')}.`)
    },
    [storeKey, say],
  )

  const sentQuotes = useMemo<SentQuotes>(
    () => ({
      sentIn: (message) => {
        const found = sent.filter((each) => each.message === message)
        return found.length === 0 ? undefined : new Map(found.map((each) => [each.number, each]))
      },
      showQuote: (id) => goToLight(id, false),
    }),
    [sent, goToLight],
  )

  // ── drawing ─────────────────────────────────────────────────────────────────────────────────
  const ordered = useMemo(() => inTextOrder(drafts), [drafts])
  const messages = new Set(ordered.map((each) => each.anchor)).size
  const tray =
    ordered.length === 0 ? null : (
      <div className="w-qtray" data-testid="quote-tray">
        <div className="w-qtray__head">
          <QuoteIcon />
          <span>
            <b>{plural(ordered.length, 'comment')}</b> {messages === 1 ? 'on this message' : `on ${messages} messages`} — sent together with your text
          </span>
          <span className="w-qtray__spacer" />
          <button type="button" className="w-qtray__link" data-testid="quote-tray-clear" onClick={() => remove(ordered.map((each) => each.id))}>
            Clear
          </button>
        </div>
        <ul className="w-qtray__chips" aria-label="Comments in this reply">
          {ordered.map((each, index) => (
            <li key={each.id} className={`w-qtray__chip${hover?.id === each.id ? ' w-qtray__chip--hover' : ''}`} data-testid="quote-chip" onMouseEnter={() => setHover({ id: each.id, rect: new DOMRect(), card: false })} onMouseLeave={() => setHover(null)}>
              <button
                type="button"
                className="w-qtray__go"
                title={each.text || 'Image only'}
                aria-label={`Comment ${index + 1} on «${squash(each.quote).slice(0, 50)}». Show it.`}
                data-testid="quote-chip-go"
                onClick={() => goToLight(each.id, true)}
              >
                <span className="w-qtray__n w-mono">{index + 1}</span>
                <span className="w-qtray__q">«{chipWords(each.quote)}»</span>
                {each.images.length > 0 ? <ImageIcon /> : null}
              </button>
              <button type="button" className="w-qtray__x" aria-label={`Remove comment ${index + 1}`} data-testid="quote-chip-remove" onClick={() => remove([each.id])}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    )

  const cardComment = card === null ? null : (drafts.find((each) => each.id === card.id) ?? null)
  const cardSent = card === null || cardComment !== null ? null : (sent.find((each) => each.id === card.id) ?? null)

  const overlay = (
    <>
      {selection !== null && popover === null && menu === null ? (
        <SelectionButton
          selection={selection}
          commentKeys={commentKeys}
          onComment={() => {
            if ('cross' in selection) return
            if (selection.overlap !== null) openEdit(selection.overlap.id)
            else openNew(selection)
          }}
        />
      ) : null}
      {menu !== null ? <ContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}
      {popover !== null ? (
        <CommentPopover
          key={popover.id ?? `new:${popover.anchor}:${popover.start}`}
          popover={popover}
          shake={shake}
          assistant={assistant}
          saveKeys={saveKeys}
          rect={() => painted.current.find((each) => each.id === popover.id)?.range.getBoundingClientRect?.() ?? pendingRect(logRef.current, popover)}
          onText={(text) => setPopover((open) => open && { ...open, text })}
          onRemoveImage={(index) => setPopover((open) => open && { ...open, images: open.images.filter((_, at) => at !== index) })}
          onFiles={(files) => void addImages(files)}
          onSave={save}
          onCancel={close}
          onDelete={popover.id === null ? null : () => remove([popover.id as string])}
          onOutside={() => {
            const open = popoverNow.current
            if (open === null) return
            const changed = open.text.trim() !== open.was.text.trim() || open.images.length !== open.was.images
            if (!changed) close()
            else {
              setPopover({ ...open, error: `Save (${saveKeys}) or Cancel (Esc) first.` })
              setShake((was) => was + 1)
            }
          }}
        />
      ) : null}
      {card !== null && (cardComment !== null || cardSent !== null) && popover === null && menu === null ? (
        <HoverCard
          rect={card.rect}
          comment={cardComment}
          sent={cardSent}
          onEnter={() => {
            if (cardTimer.current !== null) clearTimeout(cardTimer.current)
          }}
          onLeave={() => setCard(null)}
          onEdit={() => cardComment !== null && openEdit(cardComment.id)}
          onDelete={() => cardComment !== null && remove([cardComment.id])}
          onReply={() => cardSent !== null && goToReply(cardSent.id)}
        />
      ) : null}
      <div className="w-qsr" aria-live="polite" data-testid="quote-announce">
        {said}
      </div>
    </>
  )

  return {
    overlay: typeof document === 'undefined' ? overlay : createPortal(overlay, document.body),
    tray,
    count: drafts.length,
    compose,
    sent: markRoundSent,
    jump,
    onJump,
    sentQuotes,
  }
}

/** Where a new comment's quote is on screen while its popover is open. */
function pendingRect(log: HTMLElement | null, popover: Popover): DOMRect | null {
  const message = Array.from(log?.querySelectorAll<HTMLElement>('[data-quote-anchor]') ?? []).find((each) => each.dataset['quoteAnchor'] === popover.anchor)
  if (message === undefined) return null
  const at = anchorRange(message.textContent ?? '', popover)
  const range = at === null ? null : rangeAt(message, at.start, at.end)
  return range?.getBoundingClientRect?.() ?? null
}

