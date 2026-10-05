import type { WebContents } from 'electron'
import { workflowChanged, workflowClose, workflowOpen } from '../../shared/ipc/workflow'
import { claudeHome } from '../storage/paths'
import { WorkflowHub, type WorkflowSubscriber } from '../workflow/watch'
import { defineHandler, emit, type HandlerModule } from './index'

/** One hub for the app: one watcher per Project, shared by the windows that opened it. */
export const workflowHub = new WorkflowHub({ claudeHome: claudeHome() })

const subscribed = new WeakSet<WebContents>()

/** The window that called, as a subscriber; it leaves every Project when it is destroyed. */
function subscriberOf(sender: WebContents): WorkflowSubscriber {
  if (!subscribed.has(sender)) {
    subscribed.add(sender)
    sender.once('destroyed', () => void workflowHub.drop(sender.id))
  }
  return {
    id: sender.id,
    send: (delta) => {
      if (!sender.isDestroyed()) emit(sender, workflowChanged, delta)
    },
  }
}

export default [
  defineHandler(workflowOpen, ({ root }, { event }) => workflowHub.open(root, subscriberOf(event.sender))),
  defineHandler(workflowClose, async ({ root }, { event }) => ({ closed: await workflowHub.close(root, event.sender.id) })),
] satisfies HandlerModule
