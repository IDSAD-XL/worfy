// What Settings → Assistant reads and changes in main (worfy-assistant ticket 15; src/main/assistant/settings/panel.ts):
// the duties with their modes, counters and pause, the rules from dislikes, each check with its failures in a row and its
// next time, the wakes of today and the usage of the day and the week; and a change the user applied under a card
// «before → after». The duties are real, over an in-memory memory file; the scheduler is real, over marks in memory.
import { describe, expect, it } from 'vitest'
import { Duties } from '../../src/main/assistant/duties/duties'
import type { AssistantMemory, MemoryStore } from '../../src/main/assistant/duties/memory'
import { CheckScheduler, memoryCheckMarks } from '../../src/main/assistant/schedule/scheduler'
import { applySettingsChange, assistantSettingsView } from '../../src/main/assistant/settings/panel'
import { emptyUsageLedger, usageSummary, type UsageLedger } from '../../src/shared/assistant/budget'
import type { AssistantScheduleSettings } from '../../src/shared/assistant/schedule/settings'
import { changeRows, settingsChangeSchema } from '../../src/shared/assistant/settings-change'
import type { AssistantSettings } from '../../src/shared/assistant/settings'

const NOW = Date.UTC(2026, 10, 25, 10, 0)
const MINUTE = 60_000

function memory(initial?: AssistantMemory): MemoryStore & { saved: () => AssistantMemory | undefined } {
  let kept = initial === undefined ? undefined : structuredClone(initial)
  return { read: () => (kept === undefined ? undefined : structuredClone(kept)), write: (next) => void (kept = structuredClone(next)), saved: () => kept }
}

const call = (over: Partial<UsageLedger['calls'][number]>): UsageLedger['calls'][number] => ({
  at: NOW - 10 * MINUTE,
  kind: 'source-check',
  source: 'slack',
  wakeId: null,
  model: 'haiku',
  usage: { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  costUsd: 0.001,
  ...over,
})

function world({ settings = { assistant: { on: true }, assistantSchedule: { checks: { slack: { enabled: true, sleepOutsideWorkHours: false } } } } as AssistantScheduleSettings & AssistantSettings } = {}) {
  const store = memory()
  const duties = new Duties({ now: () => NOW, store })
  const marks = memoryCheckMarks({ slack: { startedAt: NOW - 2 * MINUTE, failures: 3 }, jira: { startedAt: NOW - 2 * MINUTE, succeededAt: NOW - 2 * MINUTE } })
  const checks = new CheckScheduler({ now: () => NOW, settings: () => settings, marks, random: () => 0.5, setTimer: () => 0, clearTimer: () => undefined })
  checks.register('slack', () => Promise.resolve())
  checks.register('jira', () => Promise.resolve())
  const ledger: UsageLedger = {
    ...emptyUsageLedger(),
    wakes: [{ id: 'wake-1', at: NOW - 30 * MINUTE, urgent: true }],
    calls: [call({}), call({ kind: 'wake', source: null, wakeId: 'wake-1', usage: { inputTokens: 1000, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } }), call({ kind: 'conversation', source: null, at: NOW - 8 * 24 * 60 * MINUTE + MINUTE })],
  }
  const view = () =>
    assistantSettingsView({
      running: () => true,
      duties,
      projects: () => [],
      checks,
      usage: () => usageSummary(ledger, NOW),
      shares: () => [{ window: 'five_hour', estimate: true, method: 'cost-share', utilization: 0.34, share: 0.05, since: NOW - 60 * MINUTE }],
      wakesToday: () => 1,
    })
  return { duties, checks, view, store }
}

describe('the view of Settings → Assistant', () => {
  it('each built-in duty with its actions, the modes each action may have, its counters and no pause', () => {
    const { view } = world()
    const waits = view().duties.find((duty) => duty.id === 'waits-for-user')
    expect(waits).toMatchObject({ title: 'Waits for you', enabled: true, thresholdMinutes: 15, paused: null, counters: { shown: 0, accepted: 0, declined: 0, ignored: 0, liked: 0, disliked: 0 } })
    expect(waits?.actions).toEqual([
      { action: 'open', mode: 'hand-over', allowed: ['self', 'pre-approved', 'ask', 'hand-over'] },
      { action: 'pr-follow', mode: 'ask', allowed: ['ask', 'hand-over'] },
    ])
    expect(view().pauseAfter).toBe(5)
  })

  it('a check with failures in a row carries their count and its next time, a check that succeeded none', () => {
    const { view } = world()
    const checks = view().checks
    expect(checks.map((check) => check.kind)).toEqual(['slack', 'jira', 'main-ci'])
    const slack = checks.find((check) => check.kind === 'slack')
    expect(slack).toMatchObject({ failures: 3, running: false })
    // Backed off after three failures: twice its interval of 10 minutes, spread by the middle draw.
    expect(slack?.nextAt).toBe(NOW - 2 * MINUTE + 20 * MINUTE)
    expect(checks.find((check) => check.kind === 'jira')).toMatchObject({ failures: 0, nextAt: null })
  })

  it('the usage of the day and the week: by source, by wake and for the conversation; the shares in percent and marked as an estimate', () => {
    const { view } = world()
    const { usage, wakesToday } = view()
    expect(wakesToday).toBe(1)
    expect(usage.estimate).toBe(true)
    expect(usage.day.sources).toEqual([{ source: 'slack', tokens: 120, calls: 1 }])
    expect(usage.day.wakes).toMatchObject({ count: 1, total: { tokens: 1200, calls: 1 }, byWake: [{ id: 'wake-1', urgent: true, tokens: 1200 }] })
    expect(usage.day.conversation).toEqual({ tokens: 0, calls: 0 })
    expect(usage.day.total).toEqual({ tokens: 1320, calls: 2 })
    expect(usage.shares).toEqual([{ window: 'five_hour', utilization: 34, share: 5 }])
  })

  it('a paused duty shows since when and why; the rules of dislikes are listed', () => {
    const { duties, view } = world()
    duties.setPauseAfter(1)
    const item = { id: 'i1', source: 'slack', projectId: null, subject: { kind: 'message', id: 's/1', label: '#x' }, kind: 'mention', text: 'x', startedAt: NOW, lastAt: NOW, updatedAt: NOW, revision: '1', state: 'new', duty: 'source:slack', events: 1 } as const
    duties.rate(item as never, 'dislike')
    const slack = view().duties.find((duty) => duty.id === 'source:slack')
    expect(slack?.paused).toEqual({ at: NOW, by: 'disliked' })
    expect(view().rules).toEqual([expect.objectContaining({ duty: 'source:slack', text: expect.any(String) })])
    expect(view().pauseAfter).toBe(1)
  })
})

describe('applying a change of the settings', () => {
  it('the app settings part goes through setSettings, a duty through Duties.configure', () => {
    const { duties } = world()
    const patches: unknown[] = []
    const change = settingsChangeSchema.parse({ checks: { slack: { intervalMinutes: 20 } }, dailyWakeLimit: 10, duties: { 'work-stalled': { enabled: false, modes: { 'wake-orchestrator': 'pre-approved' } } } })
    applySettingsChange(change, { duties, setSettings: (patch) => void patches.push(patch) })
    expect(patches).toEqual([{ assistantSchedule: { checks: { slack: { intervalMinutes: 20 } } }, assistant: { dailyWakeLimit: 10 } }])
    const stalled = duties.look([], { countShown: false }).duties.find((duty) => duty.id === 'work-stalled')
    expect(stalled).toMatchObject({ enabled: false, modes: { 'wake-orchestrator': 'pre-approved' } })
  })

  it('a change of a duty there is not, or a mode its action may not have (self or pre-approved of pr-follow), changes nothing at all', () => {
    const { duties, store } = world()
    const patches: unknown[] = []
    for (const duties1 of [{ 'no-such-duty': { enabled: false } }, { 'waits-for-user': { modes: { 'pr-follow': 'self' } } }, { 'waits-for-user': { modes: { 'pr-follow': 'pre-approved' } } }]) {
      const change = settingsChangeSchema.parse({ dailyWakeLimit: 10, duties: duties1 })
      expect(() => applySettingsChange(change, { duties, setSettings: (patch) => void patches.push(patch) })).toThrow()
    }
    expect(patches).toEqual([])
    expect(store.saved()).toBeUndefined()
  })
})

describe('the rows of a card «before → after»', () => {
  it('a duty of a Project rule names its Project, so two rules of one title in two Projects read apart', () => {
    const rule = (id: string, projectId: string) => ({ id, title: 'Release day', projectId, modes: {}, thresholdMinutes: 30, enabled: true })
    const rows = changeRows(
      { duties: { 'rule:a': { enabled: false }, 'rule:b': { enabled: false } } },
      { settings: {}, duties: [rule('rule:a', 'p-shop'), rule('rule:b', 'p-site')], projects: [{ id: 'p-shop', name: 'Shop' }, { id: 'p-site', name: 'Site' }] },
    )
    expect(rows.map((row) => row.label)).toEqual(['Duty «Release day» of Shop', 'Duty «Release day» of Site'])
    expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length)
  })
})
