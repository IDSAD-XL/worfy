import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { machineLabel } from '../../shared/cards/bridge'
import { attachmentImageUrl } from '../../shared/images'
import { SHORTCUTS } from '../../shared/shortcuts'
import { windowMachine } from '../ipc'
import { linesLabel, type CodeComment, type CommentImage } from '../session/quote-comments'
import { imageDataOf } from '../session/quote-store'
import { matches as matchesShortcut } from '../shortcuts/match'
import { Popover as KitPopover, type DismissReason } from '../theme/kit/Popover'
import '../session/quote-comments.css'

// A comment on lines of the Changes screen (worfy-changes-view ticket 05): the popover that takes it — its text and up
// to three images, as a comment on a quote (session/QuoteCommentParts.tsx), ⌘↵ saves — and the box of a comment under
// its last line: not sent yet, with Edit and Delete, or sent, dim. The comments themselves live in the store of the
// Session they go to (session/quote-store.ts); line-comments.tsx gives these parts what to show and what to do.

/** The popover of a comment on lines, new or being edited. */
export interface LinePopover {
  /** The comment being edited; null for a new one. */
  id: string | null
  /** The file (FileEntry.key) and its lines. */
  key: string
  path: string
  side: 'old' | 'new'
  startLine: number
  endLine: number
  /** The text of the lines, `\n` between them. */
  code: string
  text: string
  images: CommentImage[]
  /** Images being read and checked. */
  reading: number
  error: string | null
  /** The text and images it opened with: unchanged, a click outside closes it. */
  was: { text: string; images: number }
}

/** A comment's image as the window can draw it: its bytes when this window read them, else main's copy (as QuoteCommentParts.tsx draws one). */
function imageSource(image: CommentImage): string | undefined {
  const data = imageDataOf(image.ref)
  if (data !== undefined) return `data:${image.mediaType};base64,${data}`
  const machine = windowMachine()
  const label = machine === null ? null : machineLabel(machine)
  return machine !== null && label === null ? undefined : attachmentImageUrl(image.ref, image.mediaType, label)
}

export function LineCommentPopover({
  popover,
  saveKeys,
  anchor,
  onText,
  onRemoveImage,
  onFiles,
  onSave,
  onCancel,
  onDelete,
}: {
  popover: LinePopover
  saveKeys: string
  /** The last line's row on the screen; null while it is not drawn. */
  anchor: () => Element | null
  onText: (text: string) => void
  onRemoveImage: (index: number) => void
  onFiles: (files: File[]) => void
  onSave: () => void
  onCancel: () => void
  onDelete: (() => void) | null
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // The field takes the focus with the caret after its text once the kit has drawn the popup into the body.
  const fieldDrawn = useCallback((element: HTMLTextAreaElement | null) => {
    field.current = element
    if (element === null) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])
  const changed = popover.text.trim() !== popover.was.text.trim() || popover.images.length !== popover.was.images
  // A click outside or an Esc closes an unchanged popover and keeps a changed one, so no text is lost; a blur of the
  // window closes none: «Add image» opens the system's file picker. Cancel always closes it.
  const dismiss = (reason: DismissReason): boolean => {
    if (reason !== 'blur' && !changed) onCancel()
    return false
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The Node's own keys (j, k, n, p, c) are not for it while the popover is open.
    event.stopPropagation()
    // The kit closes its popup on an Esc pressed in it whatever the place says; an Esc marked handled here keeps it
    // (worfy-polish 136).
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && changed) {
      event.preventDefault()
      return
    }
    if (matchesShortcut(event.nativeEvent, SHORTCUTS.quoteSave)) {
      event.preventDefault()
      onSave()
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return
    event.preventDefault()
    onFiles(images)
  }
  const drag = (event: DragEvent<HTMLDivElement>, over: boolean | null) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (over !== null) setDragging(over)
  }
  const empty = popover.text.trim() === '' && popover.images.length === 0
  const where = linesLabel(popover.path, popover.startLine, popover.endLine)
  return (
    <KitPopover
      open
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      anchor={anchor}
      label={`Comment on ${where}`}
      testId="changes-comment-popover"
      className={`w-qpop${dragging ? ' w-qpop--drag' : ''}`}
      align="start"
      sideOffset={6}
      inNode
      initialFocus={field}
      onDismiss={dismiss}
      popupProps={{
        onKeyDown,
        onDragEnter: (event) => drag(event, true),
        onDragOver: (event) => drag(event, true),
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
        <span className="w-qpop__source w-mono" data-testid="changes-comment-where">
          {where} · {popover.side} side
        </span>
      </div>
      <blockquote className="w-qpop__quote w-mono" style={{ whiteSpace: 'pre-wrap' }} data-testid="changes-comment-code">
        {popover.code}
      </blockquote>
      <textarea
        ref={fieldDrawn}
        className="w-qpop__text"
        rows={3}
        aria-label="Comment text"
        placeholder="Your comment. Paste or drop an image here."
        data-testid="changes-comment-text"
        value={popover.text}
        onChange={(event) => onText(event.target.value)}
        onPaste={onPaste}
      />
      {popover.images.length > 0 || popover.reading > 0 ? (
        <ul className="w-qpop__images" aria-label="Images">
          {popover.images.map((image, index) => (
            <li key={`${index}:${image.name}`} className="w-qpop__image" data-testid="changes-comment-image">
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
        <div className="w-qpop__error" role="alert" data-testid="changes-comment-error">
          {popover.error}
        </div>
      ) : null}
      <div className="w-qpop__bar">
        <button type="button" className="w-qbtn w-qbtn--ghost" data-testid="changes-comment-add-image" onClick={() => chooser.current?.click()}>
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
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length > 0) onFiles(files)
            field.current?.focus()
          }}
        />
        <span className="w-qtray__spacer" />
        {onDelete !== null ? (
          <button type="button" className="w-qbtn w-qbtn--danger" data-testid="changes-comment-delete" onClick={onDelete}>
            Delete
          </button>
        ) : null}
        <button type="button" className="w-qbtn" data-testid="changes-comment-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="w-qbtn w-qbtn--primary" data-testid="changes-comment-save" disabled={empty || popover.reading > 0} onClick={onSave}>
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

const images = (count: number): string => (count === 0 ? '' : ` · ${count} image${count === 1 ? '' : 's'}`)

/** A comment not sent yet, under its last line: its text, «Line changed» when a Refresh did not find its lines, Edit and Delete. */
export function LineCommentBox({ comment, lineChanged, onEdit, onDelete }: { comment: CodeComment; lineChanged: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="w-cl w-cl--draft nodrag" data-testid="changes-comment" data-comment-id={comment.id} data-path={comment.path} data-lines={`${comment.startLine}-${comment.endLine}`}>
      <div className="w-cl__head">
        <span className="w-cl__state">not sent</span>
        <span className="w-mono">{linesLabel(comment.path, comment.startLine, comment.endLine)}</span>
        {lineChanged ? (
          <span className="w-cl__changed" data-testid="changes-comment-line-changed">
            Line changed
          </span>
        ) : null}
      </div>
      {comment.text !== '' ? <div className="w-cl__text">{comment.text}</div> : null}
      <div className="w-cl__bar">
        <span className="w-cl__muted">{images(comment.images.length).replace(/^ · /u, '')}</span>
        <span className="w-qtray__spacer" />
        <button type="button" className="w-changes__link" data-testid="changes-comment-edit" onClick={onEdit}>
          Edit
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="w-changes__link" data-testid="changes-comment-remove" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

/** A comment that went, dim under its last line. */
export function SentLineBox({ text, imageCount, to }: { text: string; imageCount: number; to: string }) {
  return (
    <div className="w-cl w-cl--sent" data-testid="changes-comment-sent">
      <div className="w-cl__head">
        <span className="w-cl__state">sent to {to}</span>
      </div>
      {text !== '' ? <div className="w-cl__text">{text}</div> : null}
      {imageCount > 0 ? <div className="w-cl__muted">{images(imageCount).replace(/^ · /u, '')}</div> : null}
    </div>
  )
}
