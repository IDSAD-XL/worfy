// Handlers of the `limits` domain (src/shared/ipc/limits.ts). A window that opens the Limits gets
// every later change on `limits.changed` until it is destroyed.
import type { WebContents } from 'electron'
import { appLimits, type LimitsTracker } from '../agent/limits'
import { limitsChanged, limitsOpen } from '../../shared/ipc/limits'
import { defineHandler, emit, type HandlerModule } from './index'

/** The window as far as sending it the Limits needs. */
export type LimitsWindow = Pick<WebContents, 'send' | 'isDestroyed' | 'once'>

/** The handlers over a tracker; tests pass their own. */
export function limitsHandlers(tracker: () => LimitsTracker): HandlerModule {
  const subscribed = new WeakSet<LimitsWindow>()
  return [
    defineHandler(limitsOpen, (_input, { event }) => {
      const window: LimitsWindow = event.sender
      if (!subscribed.has(window)) {
        subscribed.add(window)
        const unsubscribe = tracker().subscribe((state) => {
          if (!window.isDestroyed()) emit(window, limitsChanged, state)
        })
        window.once('destroyed', () => {
          unsubscribe()
          subscribed.delete(window)
        })
      }
      return tracker().snapshot()
    }),
  ]
}

export default limitsHandlers(appLimits) satisfies HandlerModule
