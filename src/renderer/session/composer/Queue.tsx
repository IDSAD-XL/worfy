import { useState } from 'react'
import { invoke } from '../../ipc'
import { writeAction } from '../../projects/read-only'
import { useReadOnly } from '../../projects/useProjects'
import { Popover } from '../../theme/kit/Popover'
import { removeQueuedMessage } from '../queue-removals'
import { useSessionControls } from '../store'
import type { ComposerItemProps } from './index'

// The Session's message queue in the input field (ticket 19): a chip "N queued" opens the list,
// where each message can be removed before it is sent. After Interrupt the queue is held and
// "Send queued" lets it go. The queue itself lives in main (src/main/agent/queue.ts); this only
// shows it and asks main to change it. On a read-only screen (worfy-link ticket 25) the list shows
// and its actions are inactive.
//
// The list is a Popover of the kit (theme/kit/Popover.tsx, worfy-ui-kit ticket 10): the focus goes in when
// it opens and back to the chip when it closes; Esc, a press elsewhere, a blur of the window and a switch
// of the view close it. Esc that closes it does nothing else: the turn of the agent goes on (the message
// field asks theme/open-layers.ts before it interrupts).

export const order = 20
/** On the hint line (index.ts), with Interrupt: a turn and its queue take no room from the pickers. */
export const line = 'hint'

export default function Queue({ sessionId }: ComposerItemProps) {
  const { queue } = useSessionControls(sessionId)
  const [open, setOpen] = useState(false)
  const readOnly = useReadOnly()
  if (sessionId === null || queue === null || queue.items.length === 0) return null

  // Taken out before it was sent: the comments it carried go back to the tray (queue-removals.ts).
  const remove = (id: string, text: string) => removeQueuedMessage(sessionId, id, text)
  const sendQueued = () => {
    void invoke('agent.queueSend', { sessionId }).then((result) => {
      if (!result.ok) console.error('agent.queueSend failed:', result.error)
    })
  }

  return (
    <span className="w-queue" data-testid="queue" data-paused={queue.paused || undefined}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Queued messages"
        testId="queue-list"
        className="w-queue__popover"
        side="top"
        align="end"
        sideOffset={8}
        // The list itself takes the focus, not the «×» of its first message: an Enter or a Space
        // pressed twice on the chip would take that message out of the queue, and nothing brings it back.
        initialFocus="popup"
        trigger={
          <button type="button" className="w-queue__chip w-mono" aria-label={`${queue.items.length} queued ${queue.items.length === 1 ? 'message' : 'messages'}`} data-testid="queue-chip">
            {queue.items.length} queued
          </button>
        }
      >
        <div className="w-queue__title">{queue.paused ? 'Held after Interrupt' : 'Sent one per turn, after the running one'}</div>
        <ol className="w-queue__items">
          {queue.items.map((item, index) => (
            <li key={item.id} className="w-queue__item" data-testid="queue-item">
              <span className="w-queue__text w-mono">{item.text}</span>
              <button type="button" className="w-queue__remove" aria-label={`Remove queued message ${index + 1}`} data-testid="queue-remove" {...writeAction(readOnly, () => remove(item.id, item.text))}>
                ×
              </button>
            </li>
          ))}
        </ol>
      </Popover>
      {queue.paused ? (
        <button type="button" className="w-session__button" data-testid="queue-send" {...writeAction(readOnly, sendQueued)}>
          Send queued
        </button>
      ) : null}
    </span>
  )
}
