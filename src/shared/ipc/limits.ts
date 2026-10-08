// The `limits` domain: the last known Limits of the Claude subscription windows, the same for every
// Project, and the stream of their changes (src/main/agent/limits.ts keeps them).
import { z } from 'zod'
import { limitsStateSchema } from '../agent/limits'
import { eventChannel, invokeChannel } from './channels'

/** The Limits known now; the calling window then receives `limits.changed` until it is gone. */
export const limitsOpen = invokeChannel('limits.open', z.void(), limitsStateSchema, 'local')

/** The whole new state after a change. */
export const limitsChanged = eventChannel('limits.changed', limitsStateSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'limits.open': typeof limitsOpen
    'limits.changed': typeof limitsChanged
  }
}
