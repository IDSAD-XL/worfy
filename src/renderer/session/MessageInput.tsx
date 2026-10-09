import { useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { FILE_COPY_LIMIT_BYTES, MAX_ATTACHMENTS, fileTooLarge, imageTooLarge, tooManyAttachments, type Attachment, type AttachmentSource, type AttachResult } from '../../shared/agent/attachments'
import { invoke, windowMachine } from '../ipc'
import { composerItems } from './composer/index'
import { stepHistory } from './history'
import { useSlashMenu } from './SlashMenu'

// The input field of a Session: Return sends, Shift+Return starts a new line, ↑ and ↓ in an empty
// field step through the prompts sent before, and the field grows with its text. While the
// Session runs a turn, Return still sends: main puts the message in the Session's queue and sends
// it after the turn (ticket 19); "Interrupt" (or Escape) stops the turn. Items of the bottom bar
// come from composer/ (composer/index.ts): the model, effort and permission pickers and the queue
// chip (ticket 19).
//
// Ticket 20: `/` at the start of the field opens the slash menu (SlashMenu.tsx). Files come in by
// "+" (main's file dialog), by dropping them on the field, and by pasting an image; main checks each
// one (`agent.attach`, src/main/agent/attachments.ts) and the field shows it as a chip until the
// message is sent, or the chip is removed. A refused file is named under the field; the message
// itself can still be sent. A message takes MAX_ATTACHMENTS at most: what comes past that is left
// out, and named under the field.
//
// In a window on a Linked machine (worfy-link ticket 12; ADR-0053) the file dialog is this
// Machine's: "+" opens a hidden <input type="file">, and the chosen files go to the Project's
// Machine as bytes, the way dropped files do: the same size limit and the same count. That
// Machine's own dialog (`agent.attachPick`) would open on a screen nobody here sees; it refuses
// the call anyway.

/** A message as the field sends it. */
export interface OutgoingMessage {
  text: string
  attachments: Attachment[]
}

export interface MessageInputProps {
  /** The live Session's id; null while none runs, and the field is disabled. */
  sessionId: string | null
  /** The Session is running a turn. */
  busy: boolean
  /** The prompts sent to this Session, oldest first. */
  history: readonly string[]
  /** Who the message goes to, for the field's label. */
  recipient: string
  /** Sends a message; resolves to an error text when it was not sent. */
  onSend: (message: OutgoingMessage) => Promise<string | null>
  onInterrupt: () => void
}

/** The tallest the field grows before it scrolls, in px. */
const MAX_HEIGHT = 200

/** An attachment shown as a chip; `key` tells two attachments of one name apart. */
interface Chip {
  key: number
  attachment: Attachment
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

function FileIcon({ image }: { image: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {image ? (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M2.5 11.5l3.5-3.5 3 3 2-2 2.5 2.5" />
        </>
      ) : (
        <path d="M4 1.75h5L12.5 5.25v9H4zM9 1.75v3.5h3.5" />
      )}
    </svg>
  )
}

/** A size for a chip: bytes, KB or MB. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/** The bytes of a File in base64. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error(`${file.name} could not be read`))
    reader.readAsDataURL(file)
  })
}

export function MessageInput({ sessionId, busy, history, recipient, onSend, onInterrupt }: MessageInputProps) {
  const [text, setText] = useState('')
  // Where ↑/↓ are in the history; null while the field holds the user's own text.
  const [at, setAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [chips, setChips] = useState<Chip[]>([])
  const [dragging, setDragging] = useState(false)
  const nextKey = useRef(1)
  // The chips as they are now, ahead of the next render: attaching is async, and its answer counts
  // against the chips there are by then. Every change of the chips goes through changeChips.
  const chipsNow = useRef<Chip[]>([])
  // The attachments of a message being sent: they come back as chips if it is not sent.
  const sendingCount = useRef(0)
  const field = useRef<HTMLTextAreaElement>(null)
  const chooser = useRef<HTMLInputElement>(null)
  // A window on a Linked machine picks files with this Machine's dialog (the hidden input). The
  // window's Machine never changes: another Machine loads the window again (useProjects.ts).
  const [pickHere] = useState(() => windowMachine() !== null)
  const disabled = sessionId === null

  // Grows with the text up to MAX_HEIGHT.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`
  }, [text])

  const edit = (value: string) => {
    setText(value)
    setAt(null)
  }

  // The field still shows a prompt brought back by ↑/↓ from the history.
  const browsing = at !== null && text === history[at]

  const slash = useSlashMenu(
    sessionId,
    text,
    (value) => {
      edit(value)
      field.current?.focus()
    },
    browsing,
  )

  const changeChips = (change: (current: Chip[]) => Chip[]) => {
    chipsNow.current = change(chipsNow.current)
    setChips(chipsNow.current)
  }

  /** How many more attachments the message takes. */
  const room = () => Math.max(0, MAX_ATTACHMENTS - chipsNow.current.length - sendingCount.current)

  /** Shows what main made of the attached things: chips for the taken ones, the reasons for the others. */
  const took = (results: readonly AttachResult[], refused: readonly string[] = []) => {
    const ok = results.flatMap((result) => (result.ok ? [result.attachment] : []))
    const fits = room()
    const taken = ok.slice(0, fits).map((attachment) => ({ key: nextKey.current++, attachment }))
    const left = ok.slice(fits).map((attachment) => attachment.name)
    const reasons = [...refused, ...results.flatMap((result) => (result.ok ? [] : [result.error])), ...(left.length > 0 ? [tooManyAttachments(left)] : [])]
    if (taken.length > 0) changeChips((current) => [...current, ...taken])
    setError(reasons.length > 0 ? reasons.join('\n') : null)
  }

  const attachSources = async (sources: AttachmentSource[], refused: string[]) => {
    if (sessionId === null) return
    if (sources.length === 0) {
      took([], refused)
      return
    }
    const result = await invoke('agent.attach', { sessionId, sources })
    if (result.ok) took(result.value.results, refused)
    else setError([...refused, result.error].join('\n'))
  }

  /** Pasted or dropped files: read here, checked in main. A file too big to carry is refused before it is read. */
  const attachFiles = async (all: readonly File[], kind: 'pasted' | 'dropped') => {
    const sources: AttachmentSource[] = []
    const refused: string[] = []
    // What does not fit in the message is neither read nor sent to main.
    const files = all.slice(0, room())
    const left = all.slice(files.length).map((file) => (file.name === '' ? 'image.png' : file.name))
    for (const file of files) {
      const name = file.name === '' ? 'image.png' : file.name
      if (file.size > FILE_COPY_LIMIT_BYTES) {
        refused.push(kind === 'pasted' || file.type.startsWith('image/') ? imageTooLarge(name) : fileTooLarge(name))
        continue
      }
      try {
        sources.push({ kind, name, data: await base64Of(file) })
      } catch (reason) {
        refused.push(reason instanceof Error ? reason.message : String(reason))
      }
    }
    if (left.length > 0) refused.push(tooManyAttachments(left))
    await attachSources(sources, refused)
  }

  const pick = () => {
    if (sessionId === null) return
    if (pickHere) {
      chooser.current?.click()
      return
    }
    void invoke('agent.attachPick', { sessionId }).then((result) => {
      if (result.ok) took(result.value.results)
      else setError(result.error)
    })
  }

  /** Files chosen in this Machine's dialog: carried as bytes, like dropped ones. */
  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    // Emptied, so that choosing the same file again is a change too.
    event.target.value = ''
    if (disabled || files.length === 0) return
    void attachFiles(files, 'dropped')
  }

  const send = async () => {
    const message = text
    const attached = chipsNow.current
    if (disabled || sending || (message.trim() === '' && attached.length === 0)) return
    setSending(true)
    setError(null)
    setText('')
    changeChips(() => [])
    setAt(null)
    sendingCount.current = attached.length
    const failure = await onSend({ text: message, attachments: attached.map((chip) => chip.attachment) })
    sendingCount.current = 0
    setSending(false)
    if (failure !== null) {
      // Not sent: the text and the attachments come back so nothing is lost.
      setText((current) => (current === '' ? message : current))
      changeChips((current) => [...attached, ...current])
      setError(failure)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (slash.keyDown(event)) return
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      void send()
      return
    }
    if (event.key === 'Escape' && busy) {
      event.preventDefault()
      onInterrupt()
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      // Only an empty field, or one that still shows a prompt from the history, steps through it.
      if (text !== '' && !browsing) return
      const next = stepHistory(history, browsing ? at : null, event.key === 'ArrowUp' ? 'older' : 'newer')
      if (next === null) return
      event.preventDefault()
      setText(next.text)
      setAt(next.index)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    // Text pastes as text; only a pasted image becomes an attachment.
    if (images.length === 0) return
    event.preventDefault()
    void attachFiles(images, 'pasted')
  }

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    // Never let the window open a dropped file in place of the app.
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    void attachFiles([...event.dataTransfer.files], 'dropped')
  }

  const canSend = !disabled && !sending && (text.trim() !== '' || chips.length > 0)

  return (
    <div className="w-composer" data-testid="message-input">
      <div className="w-composer__anchor">
        {slash.element}
        <div
          className="w-composer__box"
          data-disabled={disabled || undefined}
          data-dragging={dragging || undefined}
          data-testid="message-input-box"
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {chips.length > 0 ? (
            <ul className="w-attachments" aria-label="Attachments">
              {chips.map(({ key, attachment }) => (
                <li key={key} className="w-attachment" data-testid="attachment-chip" data-kind={attachment.kind} title={attachment.kind === 'file' ? attachment.path : attachment.name}>
                  <FileIcon image={attachment.kind === 'image'} />
                  <span className="w-attachment__name">{attachment.name}</span>
                  <span className="w-attachment__size w-mono">{formatSize(attachment.size)}</span>
                  <button
                    type="button"
                    className="w-attachment__remove"
                    aria-label={`Remove ${attachment.name}`}
                    data-testid="attachment-remove"
                    onClick={() => changeChips((current) => current.filter((chip) => chip.key !== key))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={field}
            className="w-composer__field"
            aria-label={`Message ${recipient}`}
            placeholder={disabled ? 'The Session is not running' : `Message ${recipient}`}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(event) => edit(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="w-composer__bar">
            <button type="button" className="w-composer__attach" aria-label="Attach files" title="Attach files" data-testid="input-attach" disabled={disabled} onClick={pick}>
              <PlusIcon />
            </button>
            {pickHere ? <input ref={chooser} type="file" multiple hidden tabIndex={-1} aria-hidden="true" data-testid="input-attach-file" onChange={chosen} /> : null}
            <span className="w-composer__hint w-mono">/ commands · ⇧⏎ new line · ↑↓ history</span>
            <span className="w-composer__spacer" />
            {composerItems.map(({ id, Component }) => (
              <span key={id} className="w-composer__item" data-item={id}>
                <Component sessionId={sessionId} busy={busy} text={text} setText={edit} />
              </span>
            ))}
            {busy ? (
              <button type="button" className="w-session__button" data-testid="input-interrupt" onClick={onInterrupt}>
                <StopIcon />
                Interrupt
                <kbd className="w-session__kbd w-mono">esc</kbd>
              </button>
            ) : null}
            <span className="w-composer__hint">{busy ? 'Return to queue' : 'Return to send'}</span>
            <button
              type="button"
              className="w-composer__send"
              aria-label={busy ? 'Queue message' : 'Send message'}
              data-testid="input-send"
              disabled={!canSend}
              onClick={() => void send()}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
      {error !== null ? (
        <div className="w-composer__error" role="alert" data-testid="input-error">
          {error}
        </div>
      ) : null}
    </div>
  )
}
