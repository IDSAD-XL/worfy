import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasNodeProps } from './index'
import { useReadOnly } from '../../projects/useProjects'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { NODE_HEADER } from '../node-header'
import { useLayoutOps } from '../useLayout'

// A plain text note. It is the debug Node type: a double click on an empty spot of the Canvas
// creates one, and tests use it to exercise the Layout.
export const kind = 'note'
export const defaultWidth = 220
export const defaultHeight = 120
export const minimapColor = 'var(--border-strong)'

/** How long typing must pause before the text is sent to main. */
export const NOTE_SEND_DELAY_MS = 200

export default function NoteNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  // On a read-only screen (worfy-link ticket 25) the note can be read, not edited.
  const readOnly = useReadOnly()
  const text = typeof data.node.data.text === 'string' ? data.node.data.text : ''
  const textarea = useRef<HTMLTextAreaElement>(null)
  // What was typed and not yet sent to main; undefined when main has everything.
  const unsent = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Sends main has not answered yet. An answer to an earlier send can arrive after newer typing
  // went out, and its text is older than what the textarea shows.
  const inFlight = useRef(0)
  // Bumped when the last send in flight is answered, so text from main that was held back while
  // sends were on their way is taken then.
  const [settled, setSettled] = useState(0)

  const send = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const value = unsent.current
    unsent.current = undefined
    if (value === undefined) return
    inFlight.current += 1
    void ops.apply({ op: 'patchData', id, data: { text: value } }).finally(() => {
      inFlight.current -= 1
      if (inFlight.current === 0) setSettled((count) => count + 1)
    })
  }, [ops, id])

  // A change that arrives from main replaces the text, unless the user has typed something that
  // is not sent yet or a send is still unanswered; then it waits until the last send is answered.
  // The textarea is not remounted, so an echo of what was typed keeps the focus and the caret.
  useEffect(() => {
    const element = textarea.current
    if (element && unsent.current === undefined && inFlight.current === 0 && element.value !== text) element.value = text
  }, [text, settled])

  // Typing is sent after a short pause, on blur, and when the window goes away: quitting the app
  // with the focus still in the note fires no blur, and main saves only what it has received.
  useEffect(() => {
    window.addEventListener('beforeunload', send)
    window.addEventListener('pagehide', send)
    return () => {
      window.removeEventListener('beforeunload', send)
      window.removeEventListener('pagehide', send)
      send()
    }
  }, [send])

  return (
    <div className="w-node-surface w-note" data-testid="note-node" data-node-id={id}>
      <NodeResizeClamp
        isVisible={selected}
        minWidth={120}
        minHeight={64}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-note__header" {...NODE_HEADER}>
        Note
      </div>
      <textarea
        ref={textarea}
        className="w-note__text nodrag nowheel"
        aria-label="Note text"
        placeholder={readOnly === null ? 'Write a note…' : ''}
        readOnly={readOnly !== null}
        title={readOnly ?? undefined}
        defaultValue={text}
        onChange={(event) => {
          unsent.current = event.target.value
          clearTimeout(timer.current)
          timer.current = setTimeout(send, NOTE_SEND_DELAY_MS)
        }}
        onBlur={send}
      />
    </div>
  )
}
