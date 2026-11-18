// The Health check button of the sidebar rail (worfy-auth-check ticket 04; spec: the solution, point 3,
// the icon's colour; owner's decisions Q1–Q4, Q9): its dot follows the worst level of main's report —
// read once through `firstRun.health`, then from `firstRun.reportChanged` — and a click opens
// Settings → Health. main is a fake preload bridge; where the button stands among the tabs is checked
// against the built app (test/e2e/sidebar-rail.spec.ts).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Check, FirstRunReport } from '../../src/shared/ipc/first-run'
import { useSettingsWindow } from '../../src/renderer/settings/settings-window'
import { useFirstRun } from '../../src/renderer/shell/first-run-store'
import { collectExtensions } from '../../src/renderer/shell/registry'
import { HealthRailButton, SidebarView } from '../../src/renderer/shell/Sidebar'

const row = (id: Check['id'], extra: Partial<Check> = {}): Check => ({ id, group: 'Harness', title: id, status: 'ok', severity: 'non-critical', detail: '', hint: '', command: null, actions: [], ...extra })
const reportOf = (...checks: Check[]): FirstRunReport => ({ checkedAt: '2026-11-18T00:00:00.000Z', checks })

/** What `firstRun.health` answers; undefined — it never answers. */
let health: FirstRunReport | null | undefined
let listeners: Map<string, (payload: unknown) => void>
let asked: string[]

beforeEach(() => {
  health = null
  listeners = new Map()
  asked = []
  useFirstRun.setState({ open: false, report: null, checking: false, failure: null })
  useSettingsWindow.setState({ open: false, section: null })
  const bridge = {
    invoke: (channel: string) => {
      asked.push(channel)
      if (channel === 'projects.list') return Promise.resolve({ ok: true, value: { projects: [], activeId: null, revision: 1 } })
      if (channel === 'firstRun.health') return health === undefined ? new Promise(() => undefined) : Promise.resolve({ ok: true, value: health })
      return Promise.resolve({ ok: false, error: `unexpected channel ${channel}` })
    },
    on: (channel: string, listener: (payload: unknown) => void) => {
      listeners.set(channel, listener)
      return 1
    },
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge as unknown as WorfyBridge
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const button = () => screen.getByRole('button', { name: 'Health check' })
const dot = () => button().querySelector<HTMLElement>('[data-testid="health-rail-dot"]')
const tone = () => dot()?.dataset.tone ?? null
const reason = () => button().getAttribute('aria-description')
const flush = (): Promise<void> => act(async () => undefined)

async function draw(report: FirstRunReport | null | undefined): Promise<void> {
  health = report
  render(<HealthRailButton />)
  await flush()
}

/** main sends a changed report. */
const change = (report: FirstRunReport): void =>
  act(() => {
    const listener = listeners.get('firstRun.reportChanged')
    if (listener === undefined) throw new Error('the button did not subscribe to firstRun.reportChanged')
    listener(report)
  })

describe('the Health check button: its dot', () => {
  it('is red when a critical row is not ok, and names that row', async () => {
    await draw(reportOf(row('git', { title: 'git', status: 'fail', severity: 'critical' }), row('qmd-models', { title: 'qmd models', status: 'warn' }), row('node')))
    expect(tone()).toBe('critical')
    expect(button().dataset.health).toBe('critical')
    expect(reason()).toBe('critical: git · non-critical: qmd models')
  })

  it('is yellow when only non-critical rows are not ok', async () => {
    await draw(reportOf(row('git', { severity: 'critical' }), row('qmd-models', { title: 'qmd models', status: 'warn' }), row('jq', { title: 'jq', status: 'fail' })))
    expect(tone()).toBe('warning')
    expect(reason()).toBe('non-critical: qmd models, jq')
  })

  it('is not there when every row is ok', async () => {
    await draw(reportOf(row('git', { severity: 'critical' }), row('qmd')))
    expect(dot()).toBeNull()
    expect(button().dataset.health).toBe('ok')
    expect(reason()).toBe('everything works')
  })

  it('is a grey ring before the first report, and while "Check again" runs', async () => {
    await draw(undefined)
    expect(tone()).toBe('pending')
    expect(reason()).toBe('not checked yet')
    change(reportOf(row('git', { status: 'fail', severity: 'critical' })))
    expect(tone()).toBe('critical')
    act(() => useFirstRun.setState({ checking: true }))
    expect(tone()).toBe('pending')
    expect(reason()).toBe('checking…')
    act(() => useFirstRun.setState({ checking: false }))
    expect(tone()).toBe('critical')
  })

  it('a row that could not be checked never makes it red, even marked critical: yellow, "Couldn\'t check: <reason>"', async () => {
    const project = { id: 'alpha-0000000a', name: 'alpha' }
    await draw(reportOf(row('github-access', { title: 'GitHub access', group: 'Projects', project, status: 'unknown', severity: 'critical', detail: 'GitHub answered 503' }), row('git', { severity: 'critical' })))
    expect(tone()).toBe('warning')
    expect(reason()).toBe("Couldn't check: GitHub answered 503 (GitHub access (alpha))")
  })

  it('follows every report main sends, with no check of its own; a late answer to the first call does not undo a newer report', async () => {
    let answer: (value: unknown) => void = () => undefined
    ;(globalThis as { worfy?: { invoke: (channel: string) => Promise<unknown> } }).worfy!.invoke = (channel: string) => {
      asked.push(channel)
      return new Promise((resolve) => {
        answer = resolve
      })
    }
    render(<HealthRailButton />)
    await flush()
    change(reportOf(row('qmd', { status: 'warn' })))
    expect(tone()).toBe('warning')
    await act(async () => answer({ ok: true, value: reportOf(row('git', { status: 'fail', severity: 'critical' })) }))
    expect(tone()).toBe('warning')
    change(reportOf(row('qmd')))
    expect(dot()).toBeNull()
    // It only reads the report: no check runs from the button (ticket 03's channel).
    expect(asked).toEqual(['firstRun.health'])
  })

  it('with more than three rows to name, names three and counts the rest', async () => {
    await draw(reportOf(...(['jq', 'qmd', 'qmd-models', 'qmd-collections', 'arch'] as const).map((id) => row(id, { title: id, status: 'warn' }))))
    expect(reason()).toBe('non-critical: jq, qmd, qmd-models and 2 more')
  })
})

describe('the Health check button: what it is', () => {
  it('a click opens Settings → Health (openHealthCheck), and asks main for no check', async () => {
    await draw(reportOf(row('git', { status: 'fail', severity: 'critical' })))
    fireEvent.click(button())
    expect(useSettingsWindow.getState()).toMatchObject({ open: true, section: 'HealthSection' })
    expect(useFirstRun.getState().open).toBe(false)
    expect(asked).toEqual(['firstRun.health'])
  })

  it('stands on the rail outside the tablist, after it, before Settings, and is always there', async () => {
    const stand = () => () => null
    const sections = collectExtensions({
      './sidebar/ProjectsSection.tsx': { default: stand(), order: 0 },
      './sidebar/MachinesSection.tsx': { default: stand(), order: 15, railTitle: 'Machines', railEnd: true },
    })
    health = reportOf(row('git'))
    render(<SidebarView sections={sections} />)
    await flush()
    const nav = screen.getByRole('navigation', { name: 'Sidebar' })
    const rail = within(nav).getByRole('tablist', { name: 'Sidebar sections' })
    expect(within(rail).queryByRole('button', { name: 'Health check' })).toBeNull()
    const health_ = within(nav).getByRole('button', { name: 'Health check' })
    expect(health_.getAttribute('role')).toBeNull()
    expect(health_.previousElementSibling).toBe(rail)
    expect(health_.nextElementSibling?.getAttribute('aria-label')).toBe('Settings')
    // Every report ok: no dot, the button stays.
    expect(health_.querySelector('[data-testid="health-rail-dot"]')).toBeNull()
  })

  it('without the preload bridge it subscribes to nothing and shows the grey ring', async () => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
    render(<HealthRailButton />)
    await flush()
    expect(tone()).toBe('pending')
  })
})
