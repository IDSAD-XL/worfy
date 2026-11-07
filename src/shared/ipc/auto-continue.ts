// The `autoContinue` domain (worfy-retry ticket 02): the Auto-continue item of the Modes menu under the
// Orchestrator's input field (src/renderer/session/modes/auto-continue.ts). Whether Auto-continue is on
// for a Project is a setting of this Machine in app-settings.json of worfy's data folder (`autoContinue`
// of src/shared/settings/app-settings.ts), as Auto-approval is: off by default, on only for the Projects
// the person turned it on for. The retry of the Orchestrator's turn (tickets 04–06) reads it in main with
// autoContinueOn() of src/main/settings/store.ts. The channels are `project` (worfy-retry ticket 13):
// a window that shows a Linked machine reads and sets the setting of that Machine's Project through the
// link, and it is written in app-settings.json of that Machine. Reading and the change event are `read`,
// open with read-only access; setting is `write`, open only with full access.
//
// The wait (worfy-retry ticket 07): what the Project's Orchestrator waits for to be continued — a retry
// after a temporary API error or the reset of the Limits — for the countdown over its input field
// (src/renderer/session/composer/ContinueCountdown.tsx). Its source is the Project's Autopilot run when
// one waits (src/main/autopilot/run.ts), else the Auto-continue of manual turns
// (src/main/agent/orchestrator-continue.ts). `Retry now` sends the continuation at once, `Cancel` ends the
// wait with nothing sent; both are `write`.
import { z } from 'zod'
import type { TransientError } from '../agent/turn-failure'
import { autoApprovalProjectIdSchema } from '../settings/app-settings'
import { eventChannel, invokeChannel } from './channels'

/** The setting of a Project as the item shows it. */
export const autoContinueStateSchema = z.object({ on: z.boolean() })
export type AutoContinueState = z.infer<typeof autoContinueStateSchema>

/** Whether Auto-continue is on for Project `projectId`: off while it has no entry. Writes nothing. */
export const autoContinueRead = invokeChannel('autoContinue.read', z.object({ projectId: autoApprovalProjectIdSchema }), autoContinueStateSchema, 'project', 'read')

/** Turns Auto-continue of Project `projectId` on or off: the click of the item. Answers the setting after it. */
export const autoContinueSet = invokeChannel('autoContinue.set', z.object({ projectId: autoApprovalProjectIdSchema, on: z.boolean() }), autoContinueStateSchema, 'project', 'write')

/**
 * Sent to every client of the Project's Machine — its windows and the Linked machines with access — when
 * the setting of a Project changes, so an open menu shows it at once.
 */
export const autoContinueChanged = eventChannel('autoContinue.changed', z.object({ projectId: autoApprovalProjectIdSchema, on: z.boolean() }), 'project', 'read')

/** Every kind of temporary API error (src/shared/agent/turn-failure.ts). */
export const TRANSIENT_ERRORS = ['api-500', 'api-502', 'api-503', 'api-504', 'overloaded', 'connection', 'timeout', 'stream'] as const satisfies readonly TransientError[]

/**
 * What the Project's Orchestrator waits for to be continued; null when nothing waits. `at`: when the
 * continuation goes, in milliseconds since the epoch. `retry` — after a temporary API error, retry
 * `attempt` of `of` at most in a row; `limits` — after a refusal by the Limits, `window` the label of the
 * window whose reset it waits for (`5-hour`, `7-day`, Codex's `weekly`), null when none was reported and
 * it tries again at `at`. `source`: the Project's Autopilot run, or a manual turn.
 */
export const continueWaitSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('retry'), attempt: z.number().int().positive(), of: z.number().int().positive(), error: z.enum(TRANSIENT_ERRORS), at: z.number(), source: z.enum(['run', 'manual']) }),
    z.object({ kind: z.literal('limits'), window: z.string().nullable(), at: z.number(), source: z.enum(['run', 'manual']) }),
  ])
  .nullable()
export type ContinueWaitView = z.infer<typeof continueWaitSchema>

/** What the Project's Orchestrator waits for now. Writes nothing. */
export const autoContinueWait = invokeChannel('autoContinue.wait', z.object({ projectId: autoApprovalProjectIdSchema }), continueWaitSchema, 'project', 'read')

/**
 * Sent to every client of the Project's Machine when what a manual turn of its Orchestrator waits for
 * changes. A run's wait changes with its state (`autopilot.changed`): a window reads `autoContinue.wait`
 * again then.
 */
export const autoContinueWaitChanged = eventChannel('autoContinue.waitChanged', z.object({ projectId: autoApprovalProjectIdSchema, wait: continueWaitSchema }), 'project', 'read')

/** Whether the click found a wait to act on. */
export const continueActionSchema = z.object({ done: z.boolean() })

/**
 * Retry now: the continuation of a retry after an API error goes at once, as at its timer — the same
 * attempt, no new pause, and the timer sends nothing after it.
 */
export const autoContinueRetryNow = invokeChannel('autoContinue.retryNow', z.object({ projectId: autoApprovalProjectIdSchema }), continueActionSchema, 'project', 'write')

/**
 * Cancel: the wait ends and nothing is sent. A run stops as it would have without Auto-continue
 * (`turn-error` after an API error, `limits-timeout` after the Limits); a manual turn stays as it ended.
 */
export const autoContinueCancel = invokeChannel('autoContinue.cancel', z.object({ projectId: autoApprovalProjectIdSchema }), continueActionSchema, 'project', 'write')

/** The temporary error in the words of the countdown (worfy-retry ticket 07). */
const ERROR_WORDS: Record<TransientError, string> = {
  'api-500': 'API error 500',
  'api-502': 'API error 502',
  'api-503': 'API error 503',
  'api-504': 'API error 504',
  overloaded: 'API error 529 (overloaded)',
  connection: 'API connection lost',
  timeout: 'API request timed out',
  stream: 'API response stream broke off',
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** The time left until `at`: `4:12`, `27:40`, `2:13:05`; `0:00` once it has passed. */
export function countdownText(at: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** `at` in local time: `14:20` on the day of `now`, `2026-11-09 14:20` on another day. */
export function localTime(at: number, now: number): string {
  const date = new Date(at)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

/**
 * The words of the countdown over the Orchestrator's input field for `wait` at `now`
 * (src/renderer/session/composer/ContinueCountdown.tsx): `API error 529 (overloaded) · retry 2 of 5 in
 * 4:12`, `Limits: 7-day window · resumes 14:20 (in 2:13:05)`, `Limits: no reset time reported · next try
 * in 27:40`.
 */
export function countdownLine(wait: NonNullable<ContinueWaitView>, now: number): string {
  const left = countdownText(wait.at, now)
  if (wait.kind === 'retry') return `${ERROR_WORDS[wait.error]} · retry ${wait.attempt} of ${wait.of} in ${left}`
  if (wait.window === null) return `Limits: no reset time reported · next try in ${left}`
  return `Limits: ${wait.window} window · resumes ${localTime(wait.at, now)} (in ${left})`
}

declare module './channels' {
  interface IpcContract {
    'autoContinue.read': typeof autoContinueRead
    'autoContinue.set': typeof autoContinueSet
    'autoContinue.changed': typeof autoContinueChanged
    'autoContinue.wait': typeof autoContinueWait
    'autoContinue.waitChanged': typeof autoContinueWaitChanged
    'autoContinue.retryNow': typeof autoContinueRetryNow
    'autoContinue.cancel': typeof autoContinueCancel
  }
}
