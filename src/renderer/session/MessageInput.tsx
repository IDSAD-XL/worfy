import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { composerItems } from './composer/index'
import { stepHistory } from './history'

// The input field of a Session: Return sends, Shift+Return starts a new line, ↑ and ↓ in an empty
// field step through the prompts sent before, and the field grows with its text. While the
// Session runs a turn, the send button becomes "Interrupt" (Escape does the same). The queue, the
// model picker and the slash menu are tickets 19 and 20: items of the bottom bar come from
// composer/ (composer/index.ts).

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
  onSend: (text: string) => Promise<string | null>
  onInterrupt: () => void
}

/** The tallest the field grows before it scrolls, in px. */
const MAX_HEIGHT = 200

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

export function MessageInput({ sessionId, busy, history, recipient, onSend, onInterrupt }: MessageInputProps) {
  const [text, setText] = useState('')
  // Where ↑/↓ are in the history; null while the field holds the user's own text.
  const [at, setAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
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

  const send = async () => {
    const message = text
    if (disabled || busy || sending || message.trim() === '') return
    setSending(true)
    setError(null)
    setText('')
    setAt(null)
    const failure = await onSend(message)
    setSending(false)
    if (failure !== null) {
      // Not sent: the text comes back so nothing typed is lost.
      setText((current) => (current === '' ? message : current))
      setError(failure)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
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
      const browsing = at !== null && text === history[at]
      if (text !== '' && !browsing) return
      const next = stepHistory(history, browsing ? at : null, event.key === 'ArrowUp' ? 'older' : 'newer')
      if (next === null) return
      event.preventDefault()
      setText(next.text)
      setAt(next.index)
    }
  }

  return (
    <div className="w-composer" data-testid="message-input">
      <div className="w-composer__box" data-disabled={disabled || undefined}>
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
        />
        <div className="w-composer__bar">
          <span className="w-composer__hint w-mono">⇧⏎ new line · ↑↓ history</span>
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
          ) : (
            <>
              <span className="w-composer__hint">Return to send</span>
              <button
                type="button"
                className="w-composer__send"
                aria-label="Send message"
                data-testid="input-send"
                disabled={disabled || sending || text.trim() === ''}
                onClick={() => void send()}
              >
                <SendIcon />
              </button>
            </>
          )}
        </div>
      </div>
      {error !== null ? (
        <div className="w-composer__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}
