// The settings of the Assistant's checks (src/shared/assistant/schedule/settings.ts, worfy-assistant ticket 04):
// work hours and, for each kind of check, whether it is on, its interval and whether it sleeps outside work
// hours. Each field counts only once chosen; a field not chosen takes its default.
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_CHECK_DEFAULTS,
  assistantScheduleAfter,
  assistantScheduleChoiceSchema,
  assistantScheduleFileSchema,
  CHECK_INTERVAL_BOUNDS,
  CHECK_KINDS,
  checkSettingsOf,
  sameAssistantSchedule,
  workHoursOf,
} from '../../src/shared/assistant/schedule/settings'
import { DEFAULT_WORK_HOURS, type WorkHours } from '../../src/shared/assistant/schedule/work-hours'

const EVENINGS: WorkHours = { days: ['sat', 'sun'], windows: [{ from: 18 * 60, to: 23 * 60 }], timeZone: 'Europe/Kyiv' }

describe('the defaults', () => {
  it('Slack every 10 minutes and Jira every hour, both off and both asleep outside work hours; the CI of the main branch every 10 minutes, off, awake at night', () => {
    expect(CHECK_KINDS).toEqual(['slack', 'jira', 'main-ci'])
    expect(ASSISTANT_CHECK_DEFAULTS).toEqual({
      slack: { enabled: false, intervalMinutes: 10, sleepOutsideWorkHours: true },
      jira: { enabled: false, intervalMinutes: 60, sleepOutsideWorkHours: true },
      'main-ci': { enabled: false, intervalMinutes: 10, sleepOutsideWorkHours: false },
    })
    expect(checkSettingsOf({}, 'slack')).toEqual(ASSISTANT_CHECK_DEFAULTS.slack)
    expect(workHoursOf({})).toEqual(DEFAULT_WORK_HOURS)
  })

  it('each kind takes the fields chosen for it and the defaults for the rest', () => {
    const settings = { assistantSchedule: { checks: { jira: { enabled: true, sleepOutsideWorkHours: false } } } }
    expect(checkSettingsOf(settings, 'jira')).toEqual({ enabled: true, intervalMinutes: 60, sleepOutsideWorkHours: false })
    expect(checkSettingsOf(settings, 'slack')).toEqual(ASSISTANT_CHECK_DEFAULTS.slack)
    expect(workHoursOf({ assistantSchedule: { workHours: EVENINGS } })).toEqual(EVENINGS)
  })
})

describe('assistantScheduleAfter', () => {
  it('a change keeps what it does not name: other kinds, other fields, the work hours', () => {
    const first = assistantScheduleAfter(undefined, { checks: { slack: { enabled: true } } })
    expect(first).toEqual({ checks: { slack: { enabled: true } } })
    const second = assistantScheduleAfter(first, { checks: { slack: { intervalMinutes: 15 }, jira: { sleepOutsideWorkHours: false } } })
    expect(second).toEqual({ checks: { slack: { enabled: true, intervalMinutes: 15 }, jira: { sleepOutsideWorkHours: false } } })
    const third = assistantScheduleAfter(second, { workHours: EVENINGS })
    expect(third).toEqual({ workHours: EVENINGS, checks: { slack: { enabled: true, intervalMinutes: 15 }, jira: { sleepOutsideWorkHours: false } } })
  })

  it('work hours given replace the old ones whole', () => {
    const before = assistantScheduleAfter(undefined, { workHours: EVENINGS })
    const office: WorkHours = { days: ['mon'], windows: [{ from: 600, to: 660 }] }
    expect(assistantScheduleAfter(before, { workHours: office })).toEqual({ workHours: office })
  })

  it('nothing chosen is no field at all', () => {
    expect(assistantScheduleAfter(undefined, undefined)).toBeUndefined()
    expect(assistantScheduleAfter(undefined, {})).toBeUndefined()
    expect(assistantScheduleAfter(undefined, { checks: {} })).toBeUndefined()
  })
})

describe('sameAssistantSchedule', () => {
  it('the same choices in another key order are the same; another value is not', () => {
    const a = { workHours: EVENINGS, checks: { slack: { enabled: true, intervalMinutes: 15 } } }
    const b = { checks: { slack: { intervalMinutes: 15, enabled: true } }, workHours: { timeZone: 'Europe/Kyiv', windows: [{ to: 23 * 60, from: 18 * 60 }], days: ['sat', 'sun'] as WorkHours['days'] } }
    expect(sameAssistantSchedule(a, b)).toBe(true)
    expect(sameAssistantSchedule(a, { ...a, checks: { slack: { enabled: true, intervalMinutes: 20 } } })).toBe(false)
    expect(sameAssistantSchedule(undefined, undefined)).toBe(true)
    expect(sameAssistantSchedule(undefined, a)).toBe(false)
  })
})

describe('the schemas', () => {
  it('the choice refuses an interval off its bounds or not whole, and a kind it does not know', () => {
    expect(CHECK_INTERVAL_BOUNDS).toEqual({ min: 5, max: 1440 })
    for (const bad of [{ checks: { slack: { intervalMinutes: 4 } } }, { checks: { slack: { intervalMinutes: 1441 } } }, { checks: { jira: { intervalMinutes: 7.5 } } }, { checks: { teams: { enabled: true } } }]) {
      expect(assistantScheduleChoiceSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
    expect(assistantScheduleChoiceSchema.safeParse({ checks: { slack: { intervalMinutes: 5 }, jira: { intervalMinutes: 1440 } } }).success).toBe(true)
  })

  it('the file is read field by field: a bad field reads as not chosen, the others stay', () => {
    expect(assistantScheduleFileSchema.parse({ workHours: { days: [], windows: [] }, checks: { slack: { enabled: true, intervalMinutes: 2 }, jira: 'often' } })).toEqual({ checks: { slack: { enabled: true } } })
    expect(assistantScheduleFileSchema.parse('weekly')).toBeUndefined()
    expect(assistantScheduleFileSchema.parse(undefined)).toBeUndefined()
    expect(assistantScheduleFileSchema.parse({ workHours: EVENINGS })).toEqual({ workHours: EVENINGS })
  })
})
