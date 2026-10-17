import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { invoke } from '../../ipc'
import { label } from '../../shortcuts/match'
import { failureReason } from '../../../shared/ipc/channels'
import { MAX_REQUEST_CHARS } from '../../../shared/ipc/terminal-ai-request'
import { SHORTCUTS } from '../../../shared/shortcuts'

// Command request of Terminal AI from the keyboard: ⌘I in a Terminal Node opens this small panel
// over its screen (the key and the state of the panel are in TerminalNode.tsx). The user writes
// what the command should do; Enter asks the model (the Machine of the Terminal asks, on its
// subscription), and the command lands in the line of the shell — it never runs, Enter in the
// terminal stays the user's. Esc closes the panel; either way the focus goes back to the terminal.
// While a command runs in the Terminal the panel says so and sends nothing. With the words goes the
// line typed in the shell as the Terminal reads it when Enter is pressed (terminal-line.ts).

const BUSY_TEXT = 'Terminal is busy'

interface TerminalAiRequestProps {
  projectId: string
  nodeId: string
  busy: boolean
  /** How far below the top of the screen the panel hangs, in CSS pixels: under its first row. Undefined — the place of TerminalNode.css. */
  top?: number | undefined
  /** The line typed in the shell now. */
  line: () => string
  /** The panel is done: the answer is in the line, or the user closed it. The focus goes back to the terminal. */
  onClose: () => void
}

export default function TerminalAiRequest({ projectId, nodeId, busy, top, line, onClose }: TerminalAiRequestProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const pending = useRef(false)

  useEffect(() => {
    field.current?.focus()
  }, [])
  // A panel that goes while its request waits (the Node closed, the zsh gone) puts nothing into the line.
  useEffect(
    () => () => {
      if (pending.current) void invoke('terminalAi.request.cancel', { projectId, nodeId })
    },
    [projectId, nodeId],
  )

  const send = async () => {
    const words = text.trim()
    if (words === '' || sending) return
    if (busy) {
      setMessage(BUSY_TEXT)
      return
    }
    setSending(true)
    setMessage(null)
    pending.current = true
    const result = await invoke('terminalAi.request', { projectId, nodeId, text: words, line: line() })
    pending.current = false
    setSending(false)
    if (result.ok && result.value.ok) onClose()
    else setMessage(result.ok ? (result.value.ok ? null : result.value.message) : failureReason('terminalAi.request', result.error))
  }

  const close = () => {
    if (pending.current) void invoke('terminalAi.request.cancel', { projectId, nodeId })
    pending.current = false
    onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  const note = busy ? BUSY_TEXT : sending ? 'Asking Claude…' : message
  const refused = busy || (!sending && message !== null)
  // The outer box has no height: the panel hangs from it over the screen (TerminalNode.css).
  return (
    <div className="w-terminal-request">
      <div
        className="w-terminal-request__panel nodrag nowheel nopan nokey"
        role="dialog"
        aria-label="Command request"
        data-testid="terminal-ai-request"
        style={top === undefined ? undefined : { top }}
      >
        <div className="w-terminal-request__row">
          <span className="w-terminal-request__key" aria-hidden="true">
            {label(SHORTCUTS.terminalRequest)}
          </span>
          <input
            ref={field}
            className="w-terminal-request__field"
            type="text"
            aria-label="Describe the command"
            placeholder="Describe the command, Enter to ask Claude"
            maxLength={MAX_REQUEST_CHARS}
            value={text}
            readOnly={sending}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className={`w-terminal-request__note${refused ? ' w-terminal-request__note--refused' : ''}`} role="status" aria-live="polite">
          {note ?? 'The command goes into the line; it does not run. Esc closes.'}
        </div>
      </div>
    </div>
  )
}
