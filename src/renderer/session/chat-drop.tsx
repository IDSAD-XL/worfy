// Files dropped anywhere on the chat of the Session view — the transcript or the input field —
// become chips of the input field (worfy-ui ticket 28). While files are dragged over the chat it
// shows where they go, «Drop files to attach», or why they are not taken: a chat whose Session is
// not running, or a read-only screen, takes none, and a drop there says so under the field.
import { useState, type DragEvent, type ReactNode } from 'react'

/** Why the chat takes no files now, or null when it takes them. */
export function dropRefusal(sessionId: string | null, readOnly: string | null): string | null {
  if (readOnly !== null) return readOnly
  return sessionId === null ? 'The Session is not running: files cannot be attached' : null
}

const carriesFiles = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files')

export interface ChatDrop {
  /** The drag handlers of the element that is the chat. */
  handlers: {
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragLeave: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
  /** The drop target over the chat while files are dragged over it; null otherwise. */
  overlay: ReactNode
}

/**
 * The drop target of a chat: `onFiles` gets the dropped files, also when the chat takes none
 * (`refusal`), so the input field can say why. The element with the handlers must be positioned:
 * the overlay covers it.
 */
export function useChatDrop(refusal: string | null, onFiles: (files: File[]) => void): ChatDrop {
  const [over, setOver] = useState(false)
  const handlers: ChatDrop['handlers'] = {
    onDragOver: (event) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = refusal === null ? 'copy' : 'none'
      setOver(true)
    },
    onDragLeave: (event) => {
      // Moving onto a row or the field inside is not leaving the chat.
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      setOver(false)
    },
    onDrop: (event) => {
      if (!carriesFiles(event)) return
      // Never let the window open a dropped file in place of the app.
      event.preventDefault()
      setOver(false)
      onFiles([...event.dataTransfer.files])
    },
  }
  const overlay = over ? (
    <div className="w-chat-drop" data-testid="chat-drop-zone" data-refused={refusal !== null || undefined}>
      <span className="w-chat-drop__label">{refusal ?? 'Drop files to attach'}</span>
    </div>
  ) : null
  return { handlers, overlay }
}
