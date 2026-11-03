// The `limits` domain: the last known Limits, the same for every Project — Claude's subscription windows
// and those of every other Vendor signed in to (LimitsView) — and the stream of their changes
// (src/main/agent/limits.ts keeps them).
import { z } from 'zod'
import { limitsViewSchema } from '../agent/limits'
import { eventChannel, invokeChannel } from './channels'

/** The Limits known now; the calling window then receives `limits.changed` until it is gone. */
export const limitsOpen = invokeChannel('limits.open', z.void(), limitsViewSchema, 'local')

/** The whole new view after a change of Claude's state or of another Vendor's windows. */
export const limitsChanged = eventChannel('limits.changed', limitsViewSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'limits.open': typeof limitsOpen
    'limits.changed': typeof limitsChanged
  }
}
