import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react'
import type { Attachment, AttachResult } from '../../shared/agent/attachments'
import { invoke, windowMachine } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import { attachFiles as attachFilesIn, roomFor, takeAttached, type FileKind } from './attach-files'
import { dropRefusal } from './chat-drop'
import { composerItems } from './composer/index'
import { formatSize } from './attachment-format'
import { composerHint } from './hints'
import { stepHistory } from './history'
import { markField, takePendingInput, usePendingInput } from './pending-input'
import { useSlashMenu } from './SlashMenu'

// The input field of a Session: Return sends, Shift+Return starts a new line, ↑ and ↓ in an empty
// field step through the prompts sent before, and the field grows with its text. While the
// Session runs a turn, Return still sends: main puts the message in the Session's queue and sends
// it after the turn (ticket 19); "Interrupt" (or Escape) stops the turn. Items of the bottom bar
// come from composer/ (composer/index.ts): the model, effort and permission pickers and the queue
// chip (ticket 19).
//
// Ticket 20: `/` at the start of the field opens the slash menu (SlashMenu.tsx). Files come in by
// "+" (main's file dialog), by dropping them on the chat (the Session view hands them over with
// `drop`, chat-drop.tsx; worfy-ui ticket 28), and by pasting an image; main checks each
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
//
// A ready text left for the field's Node (pending-input.ts; Getting started, worfy-onboarding
// ticket 07) is taken as soon as it is there, and put in only when the field is empty. It is never
// sent: the user sends it, as anything typed (decision 4 of the onboarding spec). The field tells
// pending-input.ts whether that text lies in it or was sent (markField), and its Send button is a
// target of the Getting started ring (worfy-onboarding ticket 14, getting-started/highlight.ts).

/** A message as the field sends it. */
export interface OutgoingMessage {
  text: string
  attachments: Attachment[]
}

export interface MessageInputProps {
  /** The Node the Session is on: the key of a ready text for the field (pending-input.ts). */
  nodeId?: string
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
  /** What the chat around the field calls with the files dropped on it. */
  ref?: Ref<MessageInputHandle>
}

/** What the chat around the field asks of it. */
export interface MessageInputHandle {
  /** Files dropped on the chat: attached, or the reason they are not when the field is off. */
  drop(files: readonly File[]): void
}

/** The tallest the field grows before it scrolls, in px. */
const MAX_HEIGHT = 200

/** The items of the bar's two lines (composer/index.ts): the hint line's, and the controls line's. */
const hintItems = composerItems.filter((item) => item.line === 'hint')
const controlItems = composerItems.filter((item) => item.line === 'controls')

/** An attachment shown as a chip; `key` tells two attachments of one name apart. */
export interface Chip {
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

/** The chips of a message's attachments, each with its "×"; the Session Node shows them too. */
export function AttachmentChips({ chips, onRemove }: { chips: readonly Chip[]; onRemove: (key: number) => void }) {
  return (
    <ul className="w-attachments" aria-label="Attachments">
      {chips.map(({ key, attachment }) => (
        <li key={key} className="w-attachment" data-testid="attachment-chip" data-kind={attachment.kind} title={attachment.kind === 'file' ? attachment.path : attachment.name}>
          <FileIcon image={attachment.kind === 'image'} />
          <span className="w-attachment__name">{attachment.name}</span>
          <span className="w-attachment__size w-mono">{formatSize(attachment.size)}</span>
          <button type="button" className="w-attachment__remove" aria-label={`Remove ${attachment.name}`} data-testid="attachment-remove" onClick={() => onRemove(key)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

export function MessageInput({ nodeId, sessionId, busy, history, recipient, onSend, onInterrupt, ref }: MessageInputProps) {
  const [text, setText] = useState('')
  // Where ↑/↓ are in the history; null while the field holds the user's own text.
  const [at, setAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [chips, setChips] = useState<Chip[]>([])
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
  // On a read-only screen (worfy-link ticket 25) the field is off as when no Session runs, and says why.
  const readOnly = useReadOnly()
  const disabled = sessionId === null || readOnly !== null

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

  // A field emptied without sending no longer holds the offered text. Before the effect below, so the
  // text that effect puts in at mount is not taken for gone in the same commit.
  useEffect(() => {
    if (nodeId !== undefined && text.trim() === '' && usePendingInput.getState().fields[nodeId] === 'ready') markField(nodeId, 'offered')
  }, [nodeId, text])

  // A ready text for this Node: taken when the field opens or as soon as it comes, put in only into
  // an empty field, never sent.
  useEffect(() => {
    if (nodeId === undefined) return
    const take = () => {
      const ready = takePendingInput(nodeId)
      if (ready === undefined) return
      setText((current) => (current === '' ? ready : current))
      // Put in, or the field keeps what the user has there (perhaps an edit of an earlier offer): either is what Send sends now.
      markField(nodeId, 'ready')
      setAt(null)
      field.current?.focus()
    }
    take()
    return usePendingInput.subscribe(take)
  }, [nodeId])

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
  const room = () => roomFor(chipsNow.current.length + sendingCount.current)

  /** Shows what main made of the attached things: chips for the taken ones, the reasons for the others. */
  const took = (results: readonly AttachResult[], refused: readonly string[] = []) => {
    const { taken, problem } = takeAttached({ results, refused }, room())
    if (taken.length > 0) changeChips((current) => [...current, ...taken.map((attachment) => ({ key: nextKey.current++, attachment }))])
    setError(problem)
  }

  /** Pasted or dropped files: read here, checked in main (attach-files.ts). */
  const attachFiles = async (files: readonly File[], kind: FileKind) => {
    if (sessionId === null) return
    const { results, refused } = await attachFilesIn(files, kind, room(), sessionId, invoke)
    took(results, refused)
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
    // A send from a field a step offered a text to, whatever it sends: no ring on Send or on the step's button now (Getting started).
    const before = nodeId === undefined ? undefined : usePendingInput.getState().fields[nodeId]
    const offeredIn = nodeId !== undefined && (before === 'offered' || before === 'ready') ? nodeId : null
    if (offeredIn !== null) markField(offeredIn, 'sent')
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
      if (offeredIn !== null && before !== undefined) markField(offeredIn, before)
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

  useImperativeHandle(ref, () => ({
    drop: (files) => {
      const refusal = dropRefusal(sessionId, readOnly)
      if (refusal !== null) {
        setError(refusal)
        return
      }
      // A drop of no files (a file promise, such as a photo dragged from Photos) changes nothing: an earlier error stays.
      if (files.length > 0) void attachFiles(files, 'dropped')
    },
  }))

  const canSend = !disabled && !sending && (text.trim() !== '' || chips.length > 0)

  return (
    <div className="w-composer" data-testid="message-input" data-toast-keep-out="">
      <div className="w-composer__anchor">
        {slash.element}
        <div
          className="w-composer__box"
          data-disabled={disabled || undefined}
          data-testid="message-input-box"
        >
          {chips.length > 0 ? <AttachmentChips chips={chips} onRemove={(key) => changeChips((current) => current.filter((chip) => chip.key !== key))} /> : null}
          <textarea
            ref={field}
            className="w-composer__field"
            aria-label={`Message ${recipient}`}
            placeholder={readOnly ?? (disabled ? 'The Session is not running' : `Message ${recipient}`)}
            title={readOnly ?? undefined}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(event) => edit(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="w-composer__bar">
            {/* The hint line: attach, the hints, the items that stand there (the context meter, the queue) and Interrupt. */}
            <div className="w-composer__line" data-line="hint">
              <button type="button" className="w-composer__attach" aria-label="Attach files" title={readOnly ?? 'Attach files'} data-testid="input-attach" disabled={disabled} onClick={pick}>
                <PlusIcon />
              </button>
              {pickHere ? <input ref={chooser} type="file" multiple hidden tabIndex={-1} aria-hidden="true" data-testid="input-attach-file" onChange={chosen} /> : null}
              <span className="w-composer__hint w-mono">{composerHint()}</span>
              <span className="w-composer__spacer" />
              {hintItems.map(({ id, Component }) => (
                <span key={id} className="w-composer__item" data-item={id}>
                  <Component sessionId={sessionId} busy={busy} text={text} setText={edit} />
                </span>
              ))}
              {busy ? (
                <button type="button" className="w-session__button" data-testid="input-interrupt" {...writeAction(readOnly, onInterrupt)}>
                  <StopIcon />
                  Interrupt
                  <kbd className="w-session__kbd w-mono">esc</kbd>
                </button>
              ) : null}
            </div>
            {/* The controls line: the pickers and the other items from the left, the send group at the right. */}
            <div className="w-composer__line" data-line="controls">
              {controlItems.map(({ id, Component }) => (
                <span key={id} className="w-composer__item" data-item={id}>
                  <Component sessionId={sessionId} busy={busy} text={text} setText={edit} />
                </span>
              ))}
              <span className="w-composer__send-group" data-testid="input-send-group">
                <span className="w-composer__hint w-composer__send-hint" data-reserve={busy ? 'Return to send' : 'Return to queue'}>
                  <span>{busy ? 'Return to queue' : 'Return to send'}</span>
                </span>
                <button
                  type="button"
                  className="w-composer__send"
                  aria-label={busy ? 'Queue message' : 'Send message'}
                  data-testid="input-send"
                  data-getting-started-target={nodeId === undefined ? undefined : 'send'}
                  data-getting-started-node={nodeId}
                  disabled={!canSend}
                  onClick={() => void send()}
                >
                  <SendIcon />
                </button>
              </span>
            </div>
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
