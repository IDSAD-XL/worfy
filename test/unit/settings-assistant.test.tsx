// Settings → Assistant (src/renderer/settings/AssistantSection.tsx; worfy-assistant ticket 15; stories 12–15, 17–20, 34
// and 35): the switch of the Assistant, the work hours, each check with its failures in a row and Check now, each duty
// with the mode of each action, its counters and its pause, the daily limit of wakes, the usage of the day and the week
// marked as an estimate, and the rules from dislikes. Over the real renderer IPC client and a fake preload of this
// Machine: a choice goes to main as its channel and its fields; what main keeps is checked in
// test/contract/assistant-settings.test.ts and test/unit/assistant-settings-panel.test.ts.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantSettingsView } from '../../src/shared/assistant/settings-view'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const NOW = Date.now()
const MIN = 60_000

const appSettings = (over: Partial<AppSettings> = {}): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 1,
  ...over,
})

const counters = { shown: 4, accepted: 2, declined: 1, ignored: 1, liked: 3, disliked: 0 }

const panel = (over: Partial<AssistantSettingsView> = {}): AssistantSettingsView => ({
  running: false,
  duties: [
    {
      id: 'waits-for-user',
      title: 'Waits for you',
      projectId: null,
      projectName: null,
      sources: ['Session', 'Pull requests'],
      enabled: true,
      thresholdMinutes: 15,
      actions: [
        { action: 'open', mode: 'hand-over', allowed: ['self', 'pre-approved', 'ask', 'hand-over'] },
        { action: 'pr-follow', mode: 'ask', allowed: ['pre-approved', 'ask', 'hand-over'] },
      ],
      counters,
      paused: null,
    },
    { id: 'source:slack', title: 'Slack', projectId: null, projectName: null, sources: ['Slack'], enabled: true, thresholdMinutes: null, actions: [{ action: 'open', mode: 'hand-over', allowed: ['self', 'pre-approved', 'ask', 'hand-over'] }], counters, paused: { at: NOW - 5 * MIN, by: 'ignored' } },
  ],
  pauseAfter: 5,
  rules: [{ id: 'rule-1', text: 'Do not show Slack mention items in shop', duty: 'source:slack', createdAt: NOW - MIN }],
  checks: [
    { kind: 'slack', failures: 3, nextAt: new Date(NOW).setHours(14, 20, 0, 0), running: false },
    { kind: 'jira', failures: 0, nextAt: null, running: false },
    { kind: 'main-ci', failures: 0, nextAt: null, running: false },
  ],
  wakesToday: 3,
  usage: {
    day: { from: NOW - 10 * 60 * MIN, total: { tokens: 25_800, calls: 12 }, sources: [{ source: 'slack', tokens: 5_200, calls: 9 }], wakes: { count: 3, total: { tokens: 18_000, calls: 3 }, byWake: [{ id: 'w3', at: NOW - 30 * MIN, urgent: true, tokens: 6_000 }] }, conversation: { tokens: 2_600, calls: 1 } },
    week: { from: NOW - 6 * 24 * 60 * MIN, total: { tokens: 244_600, calls: 80 }, sources: [{ source: 'slack', tokens: 52_300, calls: 60 }, { source: 'jira', tokens: 15_600, calls: 10 }], wakes: { count: 20, total: { tokens: 150_000, calls: 20 }, byWake: [] }, conversation: { tokens: 26_700, calls: 4 } },
    shares: [{ window: 'five_hour', utilization: 34, share: 1.1 }],
    estimate: true,
  },
  ...over,
})

interface Main {
  calls: { channel: string; input: unknown }[]
}

function preload(state: AppSettings, view: AssistantSettingsView): Main {
  const main: Main = { calls: [] }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      main.calls.push({ channel, input })
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: state } as never)
      if (channel === 'appSettings.set') return Promise.resolve({ ok: true, value: { ...state, revision: state.revision + 1 } } as never)
      if (channel === 'assistant.settings') return Promise.resolve({ ok: true, value: view } as never)
      if (channel === 'assistant.checkNow') return Promise.resolve({ ok: true, value: { started: true } } as never)
      if (channel === 'assistant.open') return Promise.resolve({ ok: false, error: 'not here' } as never)
      return Promise.resolve({ ok: true, value: {} } as IpcResult<unknown> as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(state: AppSettings = appSettings(), view: AssistantSettingsView = panel()) {
  const main = preload(state, view)
  const { default: AssistantSection, title } = await import('../../src/renderer/settings/AssistantSection')
  render(<AssistantSection />)
  await screen.findByTestId('settings-assistant-checks')
  const sent = (channel: string): unknown[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)
  return { main, sent, title }
}

const tab = (name: string): void => void fireEvent.click(screen.getByRole('tab', { name }))

describe('Settings → Assistant: General', () => {
  it('the section is «Assistant»; the switch is off by default and turning it on sends that field alone', async () => {
    const { sent, title } = await mount()
    expect(title).toBe('Assistant')
    const toggle = screen.getByRole('switch', { name: 'Assistant on this Mac' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(sent('appSettings.set')).toEqual([{ assistant: { on: true } }]))
  })

  it('each check: on, interval and sleep outside work hours; a check off by default sends its field when turned on', async () => {
    const { sent } = await mount()
    const checks = screen.getByTestId('settings-assistant-checks')
    expect(within(checks).getByRole('switch', { name: 'Slack check' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(checks).getByRole('switch', { name: 'Jira check' }))
    fireEvent.click(within(checks).getByRole('switch', { name: 'Slack sleeps outside work hours' }))
    await waitFor(() => expect(sent('appSettings.set')).toEqual([{ assistantSchedule: { checks: { jira: { enabled: true } } } }, { assistantSchedule: { checks: { slack: { sleepOutsideWorkHours: false } } } }]))
  })

  it('a check that failed in a row says how many times and when it goes next, with Check now; the others say nothing', async () => {
    const { sent } = await mount()
    const line = screen.getByTestId('settings-assistant-failures-slack')
    expect(line.textContent).toContain('Slack: 3 failures in a row, next check at 14:20')
    expect(screen.queryByTestId('settings-assistant-failures-jira')).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(sent('assistant.checkNow')).toEqual([{ kind: 'slack' }]))
  })

  it('work hours: a day turned off sends the work hours whole, the other days kept', async () => {
    const { sent } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Fri' }))
    await waitFor(() => expect(sent('appSettings.set')).toEqual([{ assistantSchedule: { workHours: { days: ['mon', 'tue', 'wed', 'thu'], windows: [{ from: 540, to: 1080 }] } } }]))
  })
})

describe('Settings → Assistant: Duties', () => {
  it('each duty with its counters; a mode pressed goes to main; a mode its action may not have is not offered', async () => {
    const { sent } = await mount()
    tab('Duties')
    const duty = screen.getByTestId('settings-assistant-duty-waits-for-user')
    expect(duty.textContent).toMatch(/Shown\s*4/)
    expect(duty.textContent).toMatch(/Ignored\s*1/)
    const prFollow = within(duty).getByRole('group', { name: 'Fix checks, Resolve conflicts or Address comments' })
    expect(within(prFollow).queryByRole('button', { name: 'On its own' })).toBeNull()
    fireEvent.click(within(prFollow).getByRole('button', { name: 'Pre-approved' }))
    fireEvent.click(within(duty).getByRole('switch', { name: 'Waits for you' }))
    await waitFor(() => expect(sent('assistant.configureDuty')).toEqual([{ dutyId: 'waits-for-user', modes: { 'pr-follow': 'pre-approved' } }, { dutyId: 'waits-for-user', enabled: false }]))
  })

  it('a paused duty says so, with Resume', async () => {
    const { sent } = await mount()
    tab('Duties')
    const slack = screen.getByTestId('settings-assistant-duty-source:slack')
    expect(slack.textContent).toContain('Paused')
    fireEvent.click(within(slack).getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(sent('assistant.resumeDuty')).toEqual([{ dutyId: 'source:slack' }]))
  })
})

describe('Settings → Assistant: Usage and limits, Memory', () => {
  it('the tokens by source, by wake and for the conversation, the day and the week; the share of the Limits marked as an estimate; the daily limit', async () => {
    await mount()
    tab('Usage and limits')
    const usage = screen.getByTestId('settings-assistant-usage')
    expect(usage.textContent).toContain('25.8k')
    expect(usage.textContent).toContain('Slack checks')
    expect(usage.textContent).toContain('Conversation')
    expect(usage.textContent).toContain('≈1.1% of the 5-hour window')
    expect(usage.textContent?.toLowerCase()).toContain('estimate')
    fireEvent.click(within(usage).getByRole('button', { name: 'This week' }))
    expect(usage.textContent).toContain('244.6k')
    expect(usage.textContent).toContain('Jira checks')
    expect(screen.getByTestId('settings-assistant-wake-limit').textContent).toContain('Today: 3 of 20')
  })

  it('the rules from dislikes, each with Delete', async () => {
    const { sent } = await mount()
    tab('Memory')
    const rule = screen.getByTestId('settings-assistant-rule')
    expect(rule.textContent).toContain('Do not show Slack mention items in shop')
    fireEvent.click(within(rule).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(sent('assistant.forgetRule')).toEqual([{ ruleId: 'rule-1' }]))
  })
})
