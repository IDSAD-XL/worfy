// A change of the Assistant's settings the Assistant proposes (worfy-assistant ticket 15; spec, UI; story 26): the card
// «before → after» with Apply. The Assistant writes it with `proposal_create` of `worfy-app` (its `change`); main keeps it
// in the proposal (src/shared/assistant/proposals.ts) and changes nothing. Only the user's Apply under the card applies
// it (AssistantWindow.apply, src/main/assistant/window/view.ts), through the same functions as Settings → Assistant: the
// app settings for the work hours, the checks and the daily limit of wakes, Duties.configure for a duty.
//
// What a change may name is what Settings → Assistant shows, except the switch of the Assistant itself, which only the
// user turns: the work hours, each check (on, interval, sleep outside work hours), the daily limit of automatic wakes,
// and of each duty whether it is on, its threshold and the mode of its actions. The rows of the card say each setting in
// words, as it is now and as it would be (changeRows); the window shows them as main writes them.
import { z } from 'zod'
import { DUTY_ACTION_ALLOWED_MODES, DUTY_ACTIONS, dutyActionModeAllowed, dutyActionModeSchema, type DutyAction, type DutyActionMode, type DutyStatus } from './duties'
import { CHECK_KINDS, checkChoicesSchema, checkSettingsOf, workHoursOf, type AssistantScheduleSettings, type CheckKind } from './schedule/settings'
import { WEEKDAYS, workHoursSchema, type WorkHours } from './schedule/work-hours'
import { dailyWakeLimitOf, dailyWakeLimitSchema, type AssistantSettings } from './settings'

/** The longest threshold of a duty, in minutes: a week, as the memory file bounds it. */
export const DUTY_THRESHOLD_MAX = 7 * 24 * 60

export const dutyThresholdSchema = z.number().int().min(1).max(DUTY_THRESHOLD_MAX)

const nonEmpty = (value: object): boolean => Object.values(value).some((each) => each !== undefined)

export const dutyChangeSchema = z
  .object({
    enabled: z.boolean().optional(),
    thresholdMinutes: dutyThresholdSchema.optional(),
    modes: z.partialRecord(z.enum(DUTY_ACTIONS), dutyActionModeSchema).optional(),
  })
  .strict()
  .refine(nonEmpty, 'a change of a duty names what changes')
export type DutyChange = z.output<typeof dutyChangeSchema>

export const settingsChangeSchema = z
  .object({
    workHours: workHoursSchema.optional(),
    checks: checkChoicesSchema.optional(),
    dailyWakeLimit: dailyWakeLimitSchema.optional(),
    /** By the duty's id (items_list names it). */
    duties: z.record(z.string().min(1).max(300), dutyChangeSchema).optional(),
  })
  .strict()
  .refine(nonEmpty, 'a change of the settings names at least one setting')
export type SettingsChange = z.output<typeof settingsChangeSchema>

/** One row of the card: the setting, as it is now and as the change would make it. */
export const changeRowSchema = z.object({ label: z.string(), before: z.string(), after: z.string() })
export type ChangeRow = z.output<typeof changeRowSchema>

/** What the rows are read against: the app settings and the duties as they are now. */
export interface SettingsNow {
  settings: AssistantScheduleSettings & AssistantSettings
  duties: readonly Pick<DutyStatus, 'id' | 'title' | 'modes' | 'thresholdMinutes' | 'enabled'>[]
}

/** The modes in words, as Settings → Assistant shows them. */
export const MODE_LABELS: Readonly<Record<DutyActionMode, string>> = Object.freeze({ self: 'On its own', 'pre-approved': 'Pre-approved', ask: 'Ask me', 'hand-over': 'Leave to me' })

/** The actions in words. */
export const ACTION_LABELS: Readonly<Record<DutyAction, string>> = Object.freeze({
  open: 'Open the item',
  'wake-orchestrator': 'Wake the Orchestrator',
  'continue-session': 'Continue the Session',
  'fix-session': 'Prepare a Session that fixes the CI',
  summary: 'Write the morning summary',
  'pr-follow': 'Fix checks, Resolve conflicts or Address comments',
  'autopilot-start': 'Start Autopilot again',
})

/** The kinds of checks in words. */
export const CHECK_LABELS: Readonly<Record<CheckKind, string>> = Object.freeze({ slack: 'Slack', jira: 'Jira', 'main-ci': 'CI of the main branch' })

const DAY_LABELS: Readonly<Record<(typeof WEEKDAYS)[number], string>> = Object.freeze({ mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' })

/** A minute of the day as `HH:MM`. */
export function minuteText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/** The days in Monday order, runs of three or more as a range: «Mon–Fri», «Mon, Wed», «Mon–Wed, Sat». */
export function daysText(days: readonly (typeof WEEKDAYS)[number][]): string {
  const indexes = WEEKDAYS.map((day, index) => (days.includes(day) ? index : -1)).filter((index) => index >= 0)
  const parts: string[] = []
  for (let at = 0; at < indexes.length; ) {
    let end = at
    while (end + 1 < indexes.length && indexes[end + 1] === indexes[end]! + 1) end += 1
    const first = DAY_LABELS[WEEKDAYS[indexes[at]!]!]
    const last = DAY_LABELS[WEEKDAYS[indexes[end]!]!]
    if (end - at >= 2) parts.push(`${first}–${last}`)
    else for (let one = at; one <= end; one++) parts.push(DAY_LABELS[WEEKDAYS[indexes[one]!]!])
    at = end + 1
  }
  return parts.join(', ')
}

/** Work hours in words: «Mon–Fri, 09:00–18:00, this Mac's zone». */
export function workHoursText(hours: WorkHours): string {
  const windows = hours.windows.map((window) => `${minuteText(window.from)}–${minuteText(window.to)}`).join(', ')
  return `${daysText(hours.days)}, ${windows}, ${hours.timeZone ?? "this Mac's zone"}`
}

/** An interval in words: «Every 10 min», «Every hour», «Every 1 h 30 min». */
export function intervalText(minutes: number): string {
  if (minutes === 60) return 'Every hour'
  if (minutes < 60) return `Every ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `Every ${hours} h` : `Every ${hours} h ${rest} min`
}

const onOff = (on: boolean): string => (on ? 'On' : 'Off')
const sleepText = (sleeps: boolean): string => (sleeps ? 'Sleeps' : 'Keeps checking')
const minutesText = (minutes: number | null): string => (minutes === null ? 'None' : `${minutes} min`)

/** The rows of the card: each setting the change names, as it is now and as it would be. */
export function changeRows(change: SettingsChange, now: SettingsNow): ChangeRow[] {
  const rows: ChangeRow[] = []
  if (change.workHours !== undefined) rows.push({ label: 'Work hours', before: workHoursText(workHoursOf(now.settings)), after: workHoursText(change.workHours) })
  for (const kind of CHECK_KINDS) {
    const check = change.checks?.[kind]
    if (check === undefined) continue
    const current = checkSettingsOf(now.settings, kind)
    const name = CHECK_LABELS[kind]
    if (check.enabled !== undefined) rows.push({ label: `${name} check`, before: onOff(current.enabled), after: onOff(check.enabled) })
    if (check.intervalMinutes !== undefined) rows.push({ label: `${name} interval`, before: intervalText(current.intervalMinutes), after: intervalText(check.intervalMinutes) })
    if (check.sleepOutsideWorkHours !== undefined) rows.push({ label: `${name} outside work hours`, before: sleepText(current.sleepOutsideWorkHours), after: sleepText(check.sleepOutsideWorkHours) })
  }
  if (change.dailyWakeLimit !== undefined) rows.push({ label: 'Daily limit of automatic wakes', before: String(dailyWakeLimitOf(now.settings)), after: String(change.dailyWakeLimit) })
  for (const [id, duty] of Object.entries(change.duties ?? {})) {
    const current = now.duties.find((each) => each.id === id)
    const name = `Duty «${current?.title ?? id}»`
    if (duty.enabled !== undefined) rows.push({ label: name, before: current === undefined ? '—' : onOff(current.enabled), after: onOff(duty.enabled) })
    if (duty.thresholdMinutes !== undefined) rows.push({ label: `${name}: threshold`, before: minutesText(current?.thresholdMinutes ?? null), after: minutesText(duty.thresholdMinutes) })
    for (const [action, mode] of Object.entries(duty.modes ?? {}) as [DutyAction, DutyActionMode][]) {
      const was = current?.modes[action]
      rows.push({ label: `${name}: ${ACTION_LABELS[action]}`, before: was === undefined ? '—' : MODE_LABELS[was], after: MODE_LABELS[mode] })
    }
  }
  return rows
}

/** Why the change cannot apply to these duties: a duty there is not, an action it has not, a mode its action may not have. */
export function dutyChangeProblems(change: SettingsChange, duties: readonly Pick<DutyStatus, 'id' | 'modes'>[]): string[] {
  const problems: string[] = []
  for (const [id, duty] of Object.entries(change.duties ?? {})) {
    const current = duties.find((each) => each.id === id)
    if (current === undefined) {
      problems.push(`there is no duty ${id}: items_list names the duties`)
      continue
    }
    for (const [action, mode] of Object.entries(duty.modes ?? {}) as [DutyAction, DutyActionMode][]) {
      if (!(action in current.modes)) problems.push(`the duty ${id} has no action ${action}`)
      else if (!dutyActionModeAllowed(action, mode)) problems.push(`the action ${action} may not be ${mode}: it may be ${DUTY_ACTION_ALLOWED_MODES[action].join(', ')}`)
    }
  }
  return problems
}

/** The part of the change that goes to the app settings (`appSettings.set`); null when it names none. */
export function settingsPatchOf(change: SettingsChange): { assistantSchedule?: { workHours?: WorkHours; checks?: SettingsChange['checks'] }; assistant?: { dailyWakeLimit: number } } | null {
  const schedule = change.workHours !== undefined || change.checks !== undefined ? { ...(change.workHours === undefined ? {} : { workHours: change.workHours }), ...(change.checks === undefined ? {} : { checks: change.checks }) } : undefined
  const assistant = change.dailyWakeLimit === undefined ? undefined : { dailyWakeLimit: change.dailyWakeLimit }
  if (schedule === undefined && assistant === undefined) return null
  return { ...(schedule === undefined ? {} : { assistantSchedule: schedule }), ...(assistant === undefined ? {} : { assistant }) }
}
