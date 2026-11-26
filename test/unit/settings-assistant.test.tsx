// Settings → Assistant (src/renderer/settings/AssistantSection.tsx; worfy-assistant tickets 15 and 25; stories 12–15,
// 17–20, 34 and 35): the switch of the Assistant with «On since …», the work hours, each check with its failures in a row
// and Check now, the notifications in the window and of the system, each duty with its Projects, the mode of each action,
// its counters and its pause, the daily limit of wakes, the usage of the day and the week marked as an estimate, and the
// rules from dislikes. Over the real renderer IPC client and a fake preload of this
// Machine: a choice goes to main as its channel and its fields; what main keeps is checked in
// test/contract/assistant-settings.test.ts and test/unit/assistant-settings-panel.test.ts.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** The Slack check turned on, so its Check now may go. */
const slackOn = appSettings({ assistantSchedule: { checks: { slack: { enabled: true } } } })

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
      projects: ['p-shop'],
      enabled: true,
      thresholdMinutes: 15,
      actions: [
        { action: 'open', mode: 'hand-over', allowed: ['self', 'pre-approved', 'ask', 'hand-over'] },
        { action: 'pr-follow', mode: 'ask', allowed: ['ask', 'hand-over'] },
      ],
      counters,
      paused: null,
    },
    { id: 'source:slack', title: 'Slack', projectId: null, projectName: null, sources: ['Slack'], projects: null, enabled: true, thresholdMinutes: null, actions: [{ action: 'open', mode: 'hand-over', allowed: ['self', 'pre-approved', 'ask', 'hand-over'] }], counters, paused: { at: NOW - 5 * MIN, by: 'ignored' } },
  ],
  projects: [
    { id: 'p-shop', name: 'shop' },
    { id: 'p-api', name: 'api' },
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

function preload(state: AppSettings, view: AssistantSettingsView, checkNow: unknown = { started: true, refused: null }): Main {
  const main: Main = { calls: [] }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      main.calls.push({ channel, input })
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: state } as never)
      if (channel === 'appSettings.set') return Promise.resolve({ ok: true, value: { ...state, revision: state.revision + 1 } } as never)
      if (channel === 'assistant.settings') return Promise.resolve({ ok: true, value: view } as never)
      if (channel === 'assistant.checkNow') return Promise.resolve({ ok: true, value: checkNow } as never)
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

async function mount(state: AppSettings = appSettings(), view: AssistantSettingsView = panel(), checkNow?: unknown) {
  const main = preload(state, view, checkNow)
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
    const { sent } = await mount(slackOn)
    const line = screen.getByTestId('settings-assistant-failures-slack')
    expect(line.textContent).toContain('Slack: 3 failures in a row, next check at 14:20')
    expect(screen.queryByTestId('settings-assistant-failures-jira')).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(sent('assistant.checkNow')).toEqual([{ kind: 'slack' }]))
  })

  it('Check now of a check that is turned off cannot be pressed: it would read a source the person turned off', async () => {
    const { sent } = await mount()
    const button = within(screen.getByTestId('settings-assistant-failures-slack')).getByRole('button', { name: 'Check now' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent('assistant.checkNow')).toEqual([])
  })

  it('a Check now main refuses says the reason main gives', async () => {
    await mount(slackOn, panel(), { started: false, refused: 'not-registered' })
    const { toasts } = await import('../../src/renderer/toast/toasts')
    fireEvent.click(within(screen.getByTestId('settings-assistant-failures-slack')).getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(toasts.getState().toasts.map((toast) => toast.text)).toEqual(['The Slack check did not start: it does not run on this Mac.']))
  })

  it('«On since …» next to the switch says when it was turned on', async () => {
    await mount(appSettings({ assistant: { on: true, onSince: NOW } }))
    expect(screen.getByTestId('settings-assistant-on-since').textContent).toMatch(/^On since today, \d\d:\d\d$/)
  })

  it('an Assistant turned on before the time was kept reads, with no «On since …» line', async () => {
    await mount(appSettings({ assistant: { on: true } }))
    expect(screen.getByRole('switch', { name: 'Assistant on this Mac' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByTestId('settings-assistant-on-since')).toBeNull()
  })

  it('Notifications: both are shown with their defaults, change and go to main as app settings of this Machine', async () => {
    const { sent } = await mount()
    const inWindow = within(screen.getByTestId('settings-assistant-in-window')).getByRole('combobox', { name: 'In the window' })
    expect(inWindow.textContent).toContain('Urgent and batched')
    const system = within(screen.getByTestId('settings-assistant-system-notices')).getByRole('switch', { name: 'System notifications' })
    expect(system.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('settings-assistant-system-notices').textContent).toContain('Urgent only, in work hours')
    fireEvent.click(inWindow)
    fireEvent.click(screen.getByRole('option', { name: 'None: the list only' }))
    fireEvent.click(system)
    await waitFor(() => expect(sent('appSettings.set')).toEqual([{ assistant: { inWindow: 'none' } }, { assistant: { systemNotices: false } }]))
  })

  it('Notifications read what is kept: urgent only, and the system ones off', async () => {
    await mount(appSettings({ assistant: { inWindow: 'urgent', systemNotices: false } }))
    expect(within(screen.getByTestId('settings-assistant-in-window')).getByRole('combobox', { name: 'In the window' }).textContent).toContain('Urgent only')
    expect(within(screen.getByTestId('settings-assistant-system-notices')).getByRole('switch', { name: 'System notifications' }).getAttribute('aria-checked')).toBe('false')
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
    // pr-follow is only Ask me or Leave to me (worfy-assistant ticket 26).
    expect(within(prFollow).queryByRole('button', { name: 'On its own' })).toBeNull()
    expect(within(prFollow).queryByRole('button', { name: 'Pre-approved' })).toBeNull()
    fireEvent.click(within(prFollow).getByRole('button', { name: 'Leave to me' }))
    fireEvent.click(within(duty).getByRole('switch', { name: 'Waits for you' }))
    await waitFor(() => expect(sent('assistant.configureDuty')).toEqual([{ dutyId: 'waits-for-user', modes: { 'pr-follow': 'hand-over' } }, { dutyId: 'waits-for-user', enabled: false }]))
  })

  it('the Projects of a duty: picked ones of this Machine, All Projects back; none offered for a duty not scoped by Project', async () => {
    const { sent } = await mount()
    tab('Duties')
    const projects = within(screen.getByTestId('settings-assistant-duty-waits-for-user')).getByRole('group', { name: 'Waits for you: Projects' })
    expect(within(projects).getByRole('button', { name: 'shop' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(projects).getByRole('button', { name: 'All Projects' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(projects).getByRole('button', { name: 'api' }))
    fireEvent.click(within(projects).getByRole('button', { name: 'shop' }))
    fireEvent.click(within(projects).getByRole('button', { name: 'All Projects' }))
    await waitFor(() =>
      expect(sent('assistant.configureDuty')).toEqual([
        { dutyId: 'waits-for-user', projects: ['p-shop', 'p-api'] },
        // The last one unpicked: back to every Project.
        { dutyId: 'waits-for-user', projects: 'all' },
        { dutyId: 'waits-for-user', projects: 'all' },
      ]),
    )
    expect(screen.queryByTestId('settings-assistant-duty-projects-source:slack')).toBeNull()
  })

  it('a duty main reads as All Projects has «All Projects» pressed and no Project (review)', async () => {
    const base = panel()
    await mount(appSettings(), { ...base, duties: base.duties.map((duty) => (duty.id === 'waits-for-user' ? { ...duty, projects: 'all' as const } : duty)) })
    tab('Duties')
    const projects = within(screen.getByTestId('settings-assistant-duty-waits-for-user')).getByRole('group', { name: 'Waits for you: Projects' })
    expect(within(projects).getByRole('button', { name: 'All Projects' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(projects).getByRole('button', { name: 'shop' }).getAttribute('aria-pressed')).toBe('false')
  })

  // worfy-polish 159: six Projects in a 550 px column squeezed each button until its text broke onto two lines, out of
  // the 24 px button and over the counters. jsdom lays nothing out, so this reads what the layout depends on: the
  // structure of the row and the rules of the sheet.
  it('six Projects with long names: one line of text per button, a row of buttons that wraps, the counters a block after it (the structure and the sheet are read)', async () => {
    const names = ['CanvasForAI', 'shop-backend-services', 'worfy-demo', 'shop-browser-extension', 'worfy-sandbox', 'a-Project-with-a-very-long-name-that-has-to-be-cut-short']
    const base = panel()
    const projects = names.map((name, index) => ({ id: `p-${index}`, name }))
    await mount(appSettings(), { ...base, projects, duties: base.duties.map((duty) => (duty.id === 'waits-for-user' ? { ...duty, projects: 'all' as const } : duty)) })
    tab('Duties')
    const duty = screen.getByTestId('settings-assistant-duty-waits-for-user')
    const row = within(duty).getByTestId('settings-assistant-duty-projects-waits-for-user')
    expect(row.classList.contains('w-asst-set__action--projects')).toBe(true)
    expect(row.firstElementChild?.textContent).toBe('Projects')
    expect(row.firstElementChild?.classList.contains('w-asst-set__action-label')).toBe(true)
    const group = within(row).getByRole('group', { name: 'Waits for you: Projects' })
    expect(group.classList.contains('w-asst-set__chips')).toBe(true)
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['All Projects', ...names])
    for (const button of buttons) {
      expect(button.classList.contains('w-asst-set__project')).toBe(true)
      // No width of its own: the button is as wide as its text, up to the sheet's max-width.
      expect(button.getAttribute('style')).toBeNull()
    }
    // A name cut short by the ellipsis is read whole in the tooltip.
    for (const name of names) expect(within(group).getByRole('button', { name }).getAttribute('title')).toBe(name)
    // The counters are their own block after the row of Projects, never inside it.
    const counters = duty.querySelector('.w-asst-set__counters')
    expect(counters).not.toBeNull()
    expect(row.contains(counters)).toBe(false)
    expect(row.nextElementSibling).toBe(counters)

    const sheet = readFileSync(join(import.meta.dirname, '../../src/renderer/settings/assistant-settings.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    // Every declaration of the rules whose selector list names the selector.
    const rules = (selector: string): string => {
      const bodies = [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/gu)].filter((match) => match[1]!.split(',').some((each) => each.trim() === selector)).map((match) => match[2]!)
      expect(bodies.length, selector).toBeGreaterThan(0)
      return bodies.join(';')
    }
    const fixedWidth = /(?:^|[\s;])width\s*:/u
    expect(rules('.w-asst-set__chips')).toMatch(/flex-wrap\s*:\s*wrap/u)
    expect(rules('.w-asst-set__chips')).toMatch(/min-width\s*:\s*0/u)
    expect(rules('.w-asst-set__action--projects')).toMatch(/align-items\s*:\s*flex-start/u)
    expect(rules('.w-asst-set__day')).toMatch(/white-space\s*:\s*nowrap/u)
    expect(rules('.w-asst-set__day')).not.toMatch(fixedWidth)
    const project = rules('.w-asst-set__project')
    expect(project).toMatch(/flex\s*:\s*none/u)
    expect(project).toMatch(/max-width\s*:/u)
    expect(project).toMatch(/overflow\s*:\s*hidden/u)
    expect(project).toMatch(/text-overflow\s*:\s*ellipsis/u)
    expect(project).not.toMatch(fixedWidth)
    // The modes of an action had the same flaw beside a long action name: their text stays on one line too.
    expect(rules('.w-asst-set__modes button')).toMatch(/white-space\s*:\s*nowrap/u)
    expect(rules('.w-asst-set__modes')).toMatch(/flex\s*:\s*none/u)
    expect(rules('.w-asst-set__action')).toMatch(/flex-wrap\s*:\s*wrap/u)
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
