import { attachmentLines } from '../../shared/agent/attachments'
import { invoke } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import type { ChatQueue } from './product-session'
import { removeQueuedMessage } from './queue-removals'

// The Session's queue at the end of a Product Session's chat (worfy-product-session ticket 28, owner
// 2026-11-09): a message sent while the advisor works is the owner's bubble, dimmed, with «queued», below
// everything else until main delivers it — then it is an ordinary message at its place (a `prompt` event).
// A queue held by Interrupt or a crash says «queued · held» and offers «Send queued»; × takes a message out,
// as the queue chip of a plain Session's input field does (composer/Queue.tsx); the same IPC calls. A closed
// Session sends nothing more: its messages say «not sent» and have no actions.

const LABELS: Record<ChatQueue['status'], string> = { queued: 'queued', held: 'queued · held', 'not-sent': 'not sent' }

function report(call: string) {
  return (result: { ok: boolean; error?: string }) => {
    if (!result.ok) console.error(`${call} failed:`, result.error)
  }
}

/** The rows of the queue, oldest first; the Transcript puts them after its last row. */
export function QueuedRows({ queue, sessionId }: { queue: ChatQueue; sessionId: string | null }) {
  const rows = queue.items.map((item) => (
    <div key={`queued:${item.id}`} className="w-tr__item w-tr__item--you">
      <QueuedMessage id={item.id} text={item.text} status={queue.status} sessionId={sessionId} />
    </div>
  ))
  if (queue.status === 'held' && sessionId !== null) {
    rows.push(
      <div key="queued:send" className="w-tr__item w-tr__item--you">
        <SendQueued sessionId={sessionId} />
      </div>,
    )
  }
  return <>{rows}</>
}

function QueuedMessage({ id, text, status, sessionId }: { id: string; text: string; status: ChatQueue['status']; sessionId: string | null }) {
  const readOnly = useReadOnly()
  // The queue keeps a message as main will send it, attachment paths included; the bubble shows what was typed.
  const lines = attachmentLines(text)
  const attached = lines.files.length + lines.images.length
  // Taken out before it was sent: the comments it carried go back to the tray (queue-removals.ts).
  const remove = () => {
    if (sessionId !== null) removeQueuedMessage(sessionId, id, text)
  }
  return (
    <div className="w-pmsg w-pmsg--you w-pmsg--queued" data-testid="product-queued" data-who="you" data-status={status}>
      <div className="w-pmsg__meta">
        <span className="w-pmsg__avatar" aria-hidden="true">
          Y
        </span>
        <span data-testid="product-message-role">You</span>
        <span aria-hidden="true">·</span>
        <span className="w-pmsg__queued" data-testid="product-queued-label">
          {LABELS[status]}
        </span>
        {status !== 'not-sent' && sessionId !== null ? (
          <button type="button" className="w-pmsg__unqueue" aria-label="Remove queued message" data-testid="product-queued-remove" {...writeAction(readOnly, remove)}>
            ×
          </button>
        ) : null}
      </div>
      <div className="w-pmsg__bubble" data-testid="product-message-bubble">
        {lines.typed !== '' ? <div className="w-pmsg__text">{lines.typed}</div> : null}
        {attached > 0 ? <div className="w-pmsg__attached">{attached === 1 ? '1 attachment' : `${attached} attachments`}</div> : null}
      </div>
    </div>
  )
}

function SendQueued({ sessionId }: { sessionId: string }) {
  const readOnly = useReadOnly()
  const send = () => {
    void invoke('agent.queueSend', { sessionId }).then(report('agent.queueSend'))
  }
  return (
    <button type="button" className="w-session__button w-pmsg__send-queued" data-testid="product-queue-send" {...writeAction(readOnly, send)}>
      Send queued
    </button>
  )
}
