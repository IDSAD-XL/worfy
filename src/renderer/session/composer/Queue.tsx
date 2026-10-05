import { useState } from 'react'
import { invoke } from '../../ipc'
import { useSessionControls } from '../store'
import type { ComposerItemProps } from './index'

// The Session's message queue in the input field (ticket 19): a chip "N queued" opens the list,
// where each message can be removed before it is sent. After Interrupt the queue is held and
// "Send queued" lets it go. The queue itself lives in main (src/main/agent/queue.ts); this only
// shows it and asks main to change it.

export const order = 20

export default function Queue({ sessionId }: ComposerItemProps) {
  const { queue } = useSessionControls(sessionId)
  const [open, setOpen] = useState(false)
  if (sessionId === null || queue === null || queue.items.length === 0) return null

  const remove = (id: string) => {
    void invoke('agent.queueRemove', { sessionId, id }).then((result) => {
      if (!result.ok) console.error('agent.queueRemove failed:', result.error)
    })
  }
  const sendQueued = () => {
    void invoke('agent.queueSend', { sessionId }).then((result) => {
      if (!result.ok) console.error('agent.queueSend failed:', result.error)
    })
  }

  return (
    <span className="w-queue" data-testid="queue" data-paused={queue.paused || undefined}>
      <button
        type="button"
        className="w-queue__chip w-mono"
        aria-expanded={open}
        aria-label={`${queue.items.length} queued ${queue.items.length === 1 ? 'message' : 'messages'}`}
        data-testid="queue-chip"
        onClick={() => setOpen((was) => !was)}
      >
        {queue.items.length} queued
      </button>
      {queue.paused ? (
        <button type="button" className="w-session__button" data-testid="queue-send" onClick={sendQueued}>
          Send queued
        </button>
      ) : null}
      {open ? (
        <div className="w-queue__popover" role="dialog" aria-label="Queued messages" data-testid="queue-list">
          <div className="w-queue__title">{queue.paused ? 'Held after Interrupt' : 'Sent one per turn, after the running one'}</div>
          <ol className="w-queue__items">
            {queue.items.map((item, index) => (
              <li key={item.id} className="w-queue__item" data-testid="queue-item">
                <span className="w-queue__text w-mono">{item.text}</span>
                <button type="button" className="w-queue__remove" aria-label={`Remove queued message ${index + 1}`} data-testid="queue-remove" onClick={() => remove(item.id)}>
                  ×
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </span>
  )
}
