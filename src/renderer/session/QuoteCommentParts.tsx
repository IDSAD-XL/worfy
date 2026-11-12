import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { machineLabel } from '../../shared/cards/bridge'
import { attachmentImageUrl } from '../../shared/images'
import { SHORTCUTS } from '../../shared/shortcuts'
import { windowMachine } from '../ipc'
import { Popover as KitPopover, type AnchorBox, type DismissReason } from '../theme/kit/Popover'
import { PreviewCard } from '../theme/kit/PreviewCard'
import { matches as matchesShortcut } from '../shortcuts/match'
import { clockOf, squash, type CommentImage, type QuoteComment, type SentQuote } from './quote-comments'
import { imageDataOf } from './quote-store'
import './quote-comments.css'

// The parts of the comments on quotes (worfy-polish ticket 102) that QuoteComments.tsx draws: the
// button next to a selection, the right click's menu, the comment's popover and the card of a comment
// under the pointer, with the icons they and the tray share. They hold no comments themselves: the
// layer (useQuoteComments) gives them what to show and what to do.

/** What is selected in an agent's message now. */
export interface Selected {
  anchor: string
  start: number
  end: number
  quote: string
  messageAt: number | null
  /** The unsent comment the range overlaps (owner, answer 1). */
  overlap: QuoteComment | null
  /** The last line of the selection on screen: where the button stands. */
  rect: DOMRect
}

export type Selection = Selected | { cross: true; rect: DOMRect }

/** The popover of a comment, new or being edited. */
export interface Popover {
  id: string | null
  anchor: string
  start: number
  end: number
  quote: string
  messageAt: number | null
  text: string
  images: CommentImage[]
  /** Images being read and checked. */
  reading: number
  error: string | null
  /** The text and images it opened with: unchanged, a click outside closes it. */
  was: { text: string; images: number }
}


export interface Menu {
  x: number
  y: number
  items: MenuItem[]
}

export type MenuItem = { label: string; keys?: string; disabled?: boolean; note?: string; testId: string; run: () => void } | 'separator'


/** A place for a floating element next to `rect`: below it, or above when below has no room. */
function placeNear(rect: { top: number; bottom: number; left: number }, width: number, height: number): { left: number; top: number } {
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const below = rect.bottom + 8
  const above = rect.top - height - 8
  const top = below + height <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, Math.min(below, window.innerHeight - height - 8))
  return { left: Math.round(left), top: Math.round(top) }
}

/** Places the element `ref` holds next to `rect` once it has a size. */
function useFloating(ref: RefObject<HTMLElement | null>, rect: { top: number; bottom: number; left: number } | null, deps: readonly unknown[]): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || rect === null) return
    const place = placeNear(rect, element.offsetWidth, element.offsetHeight)
    element.style.left = `${place.left}px`
    element.style.top = `${place.top}px`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, rect, ...deps])
}

/** A box on the screen the kit places a popup against, read anew from `rect` each time it is asked. */
function useBox(rect: () => DOMRect | null): AnchorBox {
  const latest = useRef(rect)
  useLayoutEffect(() => {
    latest.current = rect
  })
  const [box] = useState<AnchorBox>(() => ({ getBoundingClientRect: () => latest.current() ?? new DOMRect() }))
  return box
}

export function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
      <path d="M5 6.5h6M5 8.8h4" />
    </svg>
  )
}

export function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.5v3M8 11.3v.2" />
    </svg>
  )
}

export function QuoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4v8M6 5.5h7M6 8h7M6 10.5h4.5" />
    </svg>
  )
}

export function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  )
}

export function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="M14 11l-3.5-3.5L4 13" />
    </svg>
  )
}

/**
 * An image's thumbnail: its bytes when this window read them, else main's kept copy by its ref, on
 * the Machine whose Sessions the window shows (as MessageAttachments does); none when that Machine
 * has no name to reach it by.
 */
function imageSource(image: CommentImage): string | undefined {
  const data = imageDataOf(image.ref)
  if (data !== undefined) return `data:${image.mediaType};base64,${data}`
  const machine = windowMachine()
  const label = machine === null ? null : machineLabel(machine)
  return machine !== null && label === null ? undefined : attachmentImageUrl(image.ref, image.mediaType, label)
}

export function SelectionButton({ selection, commentKeys, onComment }: { selection: Selection; commentKeys: string; onComment: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const rect = { top: selection.rect.top, bottom: selection.rect.bottom, left: selection.rect.right - 40 }
  useFloating(ref, rect, [selection])
  if ('cross' in selection) {
    return (
      <div ref={ref} className="w-qfab w-qfab--note" role="note" data-quote-float="" data-testid="quote-button">
        <WarnIcon />
        Select inside one message to comment
      </div>
    )
  }
  return (
    <div ref={ref} className="w-qfab" data-quote-float="">
      <button type="button" className={`w-qfab__button${selection.overlap !== null ? ' w-qfab__button--warn' : ''}`} data-testid="quote-button" onMouseDown={(event) => event.preventDefault()} onClick={onComment}>
        {selection.overlap !== null ? (
          <>
            <WarnIcon />
            Overlaps a comment · <u>Open it</u>
          </>
        ) : (
          <>
            <CommentIcon />
            Comment <kbd className="w-qkbd">{commentKeys}</kbd>
          </>
        )}
      </button>
    </div>
  )
}

export function ContextMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useFloating(ref, { top: menu.y, bottom: menu.y - 6, left: menu.x + 2 }, [menu])
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose()
    }
    const onBlur = () => onClose()
    document.addEventListener('mousedown', onDown, true)
    globalThis.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      globalThis.removeEventListener('blur', onBlur)
    }
  }, [onClose])
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      buttons[(at + step + buttons.length) % buttons.length]?.focus()
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose()
    }
  }
  return (
    <div ref={ref} className="w-qmenu" role="menu" aria-label="Selection actions" data-quote-float="" data-testid="quote-menu" onKeyDown={onKeyDown} onMouseDown={(event) => event.preventDefault()}>
      {menu.items.map((item, index) =>
        item === 'separator' ? (
          <div key={`separator:${index}`} className="w-qmenu__separator" role="separator" />
        ) : (
          <div key={item.testId}>
            <button
              type="button"
              role="menuitem"
              className="w-qmenu__item"
              data-testid={item.testId}
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.run()
              }}
            >
              {item.label}
              {item.keys !== undefined ? <kbd className="w-qmenu__keys">{item.keys}</kbd> : null}
            </button>
            {item.note !== undefined ? <div className="w-qmenu__note">{item.note}</div> : null}
          </div>
        ),
      )}
    </div>
  )
}

export function CommentPopover({
  popover,
  shake,
  assistant,
  saveKeys,
  rect,
  onText,
  onRemoveImage,
  onFiles,
  onSave,
  onCancel,
  onDelete,
  onOutside,
}: {
  popover: Popover
  shake: number
  assistant: string
  saveKeys: string
  rect: () => DOMRect | null
  onText: (text: string) => void
  onRemoveImage: (index: number) => void
  onFiles: (files: File[]) => void
  onSave: () => void
  onCancel: () => void
  onDelete: (() => void) | null
  onOutside: () => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // The quote's box on the screen, read anew whenever the kit places the popover: the transcript scrolls under it.
  const anchor = useBox(rect)
  // The field takes the focus with the caret after its text once it is drawn: the kit draws the popup
  // into the body a moment after the popover mounts.
  const fieldDrawn = useCallback((element: HTMLTextAreaElement | null) => {
    field.current = element
    if (element === null) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])
  useEffect(() => {
    // The popup of the kit around the field.
    const element = field.current?.closest<HTMLElement>('.w-qpop') ?? null
    if (element === null || shake === 0) return
    element.classList.remove('w-qpop--shake')
    void element.offsetWidth
    element.classList.add('w-qpop--shake')
  }, [shake])
  const changed = popover.text.trim() !== popover.was.text.trim() || popover.images.length !== popover.was.images
  // A click outside closes an unchanged popover; a changed one asks to be saved or cancelled first
  // (onOutside). An Esc pressed outside that no field took (the message field interrupts a running
  // turn with it) is the same as a click outside. The focus going elsewhere or a switch of the view
  // closes an unchanged one and keeps a changed one, without a word: the text is not lost. A blur of
  // the window closes none: «Attach image» opens the system's file picker, which takes the focus of
  // the window, and a drag from the Finder may too; the image it brings needs the popover.
  const dismiss = (reason: DismissReason): boolean => {
    if (reason === 'outside-press' || reason === 'escape-outside') onOutside()
    else if (reason !== 'blur' && !changed) onCancel()
    return false
  }
  // Esc pressed in the popover is the kit's: it closes the popover (onCancel) and goes no further.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (matchesShortcut(event.nativeEvent, SHORTCUTS.quoteSave)) {
      event.preventDefault()
      onSave()
      return
    }
    if (event.key === 'Tab') {
      const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)'))
      const at = stops.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && at <= 0) {
        event.preventDefault()
        stops.at(-1)?.focus()
      } else if (!event.shiftKey && at === stops.length - 1) {
        event.preventDefault()
        stops[0]?.focus()
      }
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return
    event.preventDefault()
    onFiles(images)
  }
  // The drop is the popover's: the chat around it would take the files for the input field.
  const drag = (event: DragEvent<HTMLDivElement>, over: boolean | null) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (over !== null) setDragging(over)
  }
  const empty = popover.text.trim() === '' && popover.images.length === 0
  return (
    <KitPopover
      open
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      anchor={anchor}
      label="Comment on the quote"
      testId="quote-popover"
      className={`w-qpop${dragging ? ' w-qpop--drag' : ''}`}
      align="start"
      sideOffset={8}
      initialFocus={field}
      onDismiss={dismiss}
      passOutsideEscape
      popupProps={{
        'data-quote-float': '',
        onKeyDown,
        onDragEnter: (event) => drag(event, true),
        onDragOver: (event) => {
          drag(event, true)
          if (event.dataTransfer.types.includes('Files')) event.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: (event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          drag(event, false)
        },
        onDrop: (event) => {
          drag(event, false)
          if (event.dataTransfer.types.includes('Files')) onFiles([...event.dataTransfer.files])
        },
      }}
    >
      <div className="w-qpop__head">
        <span className="w-qpop__title">{popover.id === null ? 'Comment' : 'Edit comment'}</span>
        <span className="w-qpop__source w-mono">
          {assistant}
          {clockOf(popover.messageAt) === null ? '' : ` · ${clockOf(popover.messageAt) ?? ''}`}
        </span>
      </div>
      <blockquote className="w-qpop__quote" data-testid="quote-popover-quote">
        {squash(popover.quote)}
      </blockquote>
      <textarea
        ref={fieldDrawn}
        className="w-qpop__text"
        rows={3}
        aria-label="Comment text"
        placeholder="Your comment. Paste or drop an image here."
        data-testid="quote-popover-text"
        value={popover.text}
        onChange={(event) => onText(event.target.value)}
        onPaste={onPaste}
      />
      {popover.images.length > 0 || popover.reading > 0 ? (
        <ul className="w-qpop__images" aria-label="Images">
          {popover.images.map((image, index) => (
            <li key={`${index}:${image.name}`} className="w-qpop__image" data-testid="quote-popover-image">
              <img src={imageSource(image)} alt={image.name} />
              <button type="button" className="w-qpop__image-remove" aria-label={`Remove image ${image.name}`} onClick={() => onRemoveImage(index)}>
                ×
              </button>
            </li>
          ))}
          {Array.from({ length: popover.reading }, (_, index) => (
            <li key={`reading:${index}`} className="w-qpop__image w-qpop__image--reading" aria-label="Reading the image" />
          ))}
        </ul>
      ) : null}
      {popover.error !== null ? (
        <div className="w-qpop__error" role="alert" data-testid="quote-popover-error">
          {popover.error}
        </div>
      ) : null}
      <div className="w-qpop__bar">
        <button type="button" className="w-qbtn w-qbtn--ghost" data-testid="quote-popover-add-image" onClick={() => chooser.current?.click()}>
          <ImageIcon />
          Add image
        </button>
        <input
          ref={chooser}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-testid="quote-popover-file"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length > 0) onFiles(files)
            field.current?.focus()
          }}
        />
        <span className="w-qtray__spacer" />
        {onDelete !== null ? (
          <button type="button" className="w-qbtn w-qbtn--danger" data-testid="quote-popover-delete" onClick={onDelete}>
            Delete
          </button>
        ) : null}
        <button type="button" className="w-qbtn" data-testid="quote-popover-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="w-qbtn w-qbtn--primary" data-testid="quote-popover-save" disabled={empty} onClick={onSave}>
          Save <kbd className="w-qkbd">{saveKeys}</kbd>
        </button>
      </div>
      {dragging ? (
        <div className="w-qpop__drop" aria-hidden="true">
          Drop the image to attach
        </div>
      ) : null}
    </KitPopover>
  )
}

export function HoverCard({ rect, comment, sent, onEnter, onLeave, onEdit, onDelete, onReply }: {
  rect: DOMRect
  comment: QuoteComment | null
  sent: SentQuote | null
  onEnter: () => void
  onLeave: () => void
  onEdit: () => void
  onDelete: () => void
  onReply: () => void
}) {
  // The light of the comment is a highlight of the text, not an element: the card is placed against
  // its box, and the place (QuoteComments.tsx) opens it after the pointer rests on the light and closes
  // it after the pointer left both. Esc, a press elsewhere, a blur of the window and a switch of the
  // view close it too (the kit's PreviewCard).
  const anchor = useBox(() => rect)
  const text = comment?.text ?? sent?.text ?? ''
  const images = comment?.images ?? []
  return (
    <PreviewCard
      open
      onOpenChange={(next) => {
        if (!next) onLeave()
      }}
      anchor={anchor}
      label="Comment"
      testId="quote-card"
      className="w-qcard"
      popupProps={{ 'data-quote-float': '', onMouseEnter: onEnter, onMouseLeave: onLeave }}
    >
      <div className="w-qcard__meta">
        <span className="w-qcard__badge">{sent !== null ? 'answered' : 'draft'}</span>
        {sent !== null ? 'sent' : 'not sent yet'}
      </div>
      <div className={`w-qcard__text${text === '' ? ' w-qcard__text--none' : ''}`}>{text === '' ? 'Image only' : text}</div>
      {images.length > 0 ? (
        <div className="w-qcard__images">
          {images.map((image, index) => (
            <img key={`${index}:${image.name}`} src={imageSource(image)} alt={image.name} />
          ))}
        </div>
      ) : null}
      <div className="w-qcard__bar">
        {sent !== null ? (
          <button type="button" className="w-qbtn w-qbtn--ghost" data-testid="quote-card-reply" onClick={onReply}>
            Go to my reply
          </button>
        ) : (
          <>
            <button type="button" className="w-qbtn w-qbtn--ghost" data-testid="quote-card-delete" onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="w-qbtn" data-testid="quote-card-edit" onClick={onEdit}>
              Edit
            </button>
          </>
        )}
      </div>
    </PreviewCard>
  )
}
