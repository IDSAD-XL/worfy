import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Check, FirstRunReport } from '../../src/shared/ipc/first-run'
import type { MigrationPlan } from '../../src/shared/ipc/harness-migration'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import { acceptProjectsState } from '../../src/renderer/projects/useProjects'
import { SettingsDialogView } from '../../src/renderer/settings/SettingsDialog'
import { collectSections, settingsSections } from '../../src/renderer/settings/sections'
import { closeSettings, openSettings, selectSection, SETTINGS_LAYER, useSettingsWindow } from '../../src/renderer/settings/settings-window'
import { FirstRun } from '../../src/renderer/shell/FirstRun'
import { openFirstRun, useFirstRun } from '../../src/renderer/shell/first-run-store'
import { resetToasts, toasts } from '../../src/renderer/toast/toasts'

// worfy-ui ticket 6: Settings → Health shows the checks of the First run dialog, from the same
// store, and never writes the mark of that dialog. main is a fake preload bridge: each channel
// answers what the test gave it, and every call is recorded.

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
type Handler = (input: unknown) => Answer | Promise<Answer>

const handlers: Record<string, Handler> = {}
const invoke = vi.fn((channel: string, input?: unknown): Promise<Answer> => Promise.resolve((handlers[channel] ?? (() => ({ ok: false, error: `${channel}: not in this test` })))(input)))
;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke, on: () => 1, off: () => undefined } as unknown as WorfyBridge

const callsOf = (channel: string): unknown[] => invoke.mock.calls.filter(([name]) => name === channel).map(([, input]) => input)

/** An answer the test gives later, to look at the screen while main is still working. */
function later(): { answer: Promise<Answer>; give: (answer: Answer) => Promise<void> } {
  let resolve: (answer: Answer) => void = () => undefined
  const answer = new Promise<Answer>((done) => {
    resolve = done
  })
  return { answer, give: (value) => act(async () => resolve(value)) }
}

const check = (id: Check['id'], group: Check['group'], title: string, extra: Partial<Check> = {}): Check => ({ id, group, title, status: 'ok', detail: '', hint: '', command: null, actions: [], ...extra })

/** One report: a row of every status, a command to copy, and the actions the tests press. */
const report = (extra: Partial<Record<Check['id'], Partial<Check>>> = {}): FirstRunReport => ({
  checkedAt: '2026-10-13T00:00:00.000Z',
  checks: [
    check('claude-login', 'Claude Code', 'Sign-in', { detail: 'me@example.com' }),
    check('jq', 'Command-line tools', 'jq', { status: 'fail', detail: 'not found', hint: 'Install it', command: 'brew install jq' }),
    check('gh-auth', 'GitHub', 'GitHub accounts', { status: 'fail', detail: 'signed in nowhere', hint: 'Sign in', command: 'gh auth login', actions: [{ id: 'gh-login', label: 'Sign in…' }] }),
    check('harness', 'Harness', 'Harness plugin', { status: 'fail', detail: 'not installed', actions: [{ id: 'harness-install', label: 'Install' }] }),
    check('legacy-harness', 'Harness', 'Old Harness in ~/.claude', { status: 'warn', detail: 'files of the old Harness are in ~/.claude', actions: [{ id: 'migration-form', label: 'Move…' }] }),
    check('qmd-models', 'qmd', 'qmd models', { status: 'warn', detail: 'not downloaded', actions: [{ id: 'qmd-models-download', label: 'Download…' }, { id: 'qmd-models-skip', label: 'Skip…' }] }),
  ].map((each) => ({ ...each, ...extra[each.id] })),
})

const installed = (): FirstRunReport => report({ harness: { status: 'ok', detail: '1.2.3', actions: [] } })

/** The Settings window over the real Health section and a stub one to leave it for. */
const sections = () => {
  const health = settingsSections.find((each) => each.id === 'HealthSection')
  if (health === undefined) throw new Error('src/renderer/settings/HealthSection.tsx is not among the sections')
  return [health, ...collectSections({ './OtherSection.tsx': { default: () => <p>Other body</p>, order: 99, title: 'Other' } })]
}

function renderApp(options: { firstRun?: boolean } = {}) {
  return render(
    <>
      <button type="button">opener</button>
      {options.firstRun ? <FirstRun /> : null}
      <SettingsDialogView sections={sections()} />
    </>,
  )
}

const settings = () => screen.getByRole('dialog', { name: 'Settings' })
const firstRun = () => screen.getByRole('dialog', { name: 'First run' })
const rowsOf = (place: HTMLElement): HTMLElement[] => [...place.querySelectorAll<HTMLElement>('[data-check]')]
const rowOf = (place: HTMLElement, id: Check['id']): HTMLElement => {
  const found = place.querySelector<HTMLElement>(`[data-check="${id}"]`)
  if (found === null) throw new Error(`no row ${id}`)
  return found
}
/** A row as the person reads it: its name, the word of its chip and what was found. */
const readRow = (each: HTMLElement) => ({
  id: each.dataset.check,
  name: each.getAttribute('aria-label'),
  status: each.dataset.status,
  chip: each.querySelector('.w-chip')?.textContent,
  detail: each.querySelector('[title]')?.getAttribute('title') ?? null,
})
const expected = (from: FirstRunReport) =>
  from.checks.map((each) => ({ id: each.id, name: each.title, status: each.status, chip: { ok: 'OK', warn: 'Warning', fail: 'Failed' }[each.status], detail: each.detail }))
const summaryOf = (place: HTMLElement): string | null => within(place).queryByTestId('first-run-summary')?.textContent ?? null
const isInactive = (button: HTMLElement): boolean => button.getAttribute('aria-disabled') === 'true'

/** Opens Settings → Health and waits for the checks main answered with. */
async function openHealth(): Promise<HTMLElement> {
  act(() => openSettings('HealthSection'))
  await waitFor(() => expect(summaryOf(settings())).not.toBe('Checking…'))
  return settings()
}

const flush = (): Promise<void> => act(async () => undefined)

beforeEach(() => {
  for (const channel of Object.keys(handlers)) delete handlers[channel]
  handlers['firstRun.checks'] = () => ({ ok: true, value: report() })
  handlers['firstRun.startup'] = () => ({ ok: true, value: { show: false, report: null } })
  handlers['firstRun.close'] = () => ({ ok: true, value: undefined })
  handlers['projects.list'] = () => ({ ok: true, value: { projects: [], activeId: null, revision: 0 } satisfies ProjectsState })
  invoke.mockClear()
  useSettingsWindow.setState({ open: false, section: null })
  useFirstRun.setState({ open: false, report: null, checking: false, failure: null })
})

afterEach(async () => {
  act(() => closeSettings())
  cleanup()
  await flush()
})

describe('Settings → Health: the section', () => {
  it('is a section file of the Settings window, after General', () => {
    const ids = settingsSections.map((each) => each.id)
    expect(ids.slice(0, 2)).toEqual(['GeneralSection', 'HealthSection'])
    expect(settingsSections[1]).toMatchObject({ order: 20, title: 'Health' })
  })

  it('its row is reached from the keyboard as the row of General is: ↓ from General shows Health and takes the focus along', async () => {
    render(<SettingsDialogView sections={settingsSections} />)
    act(() => openSettings())
    const rows = within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('button')
    expect(rows.slice(0, 2).map((each) => each.textContent)).toEqual(['General', 'Health'])
    expect(document.activeElement).toBe(rows[0])
    // General is still what Settings opens on, and nothing has checked.
    expect(within(settings()).getByRole('heading', { level: 2 }).textContent).toBe('General')
    expect(callsOf('firstRun.checks')).toHaveLength(0)
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(within(settings()).getByRole('heading', { level: 2 }).textContent).toBe('Health')
    expect(document.activeElement).toBe(rows[1])
    expect(rows[1]?.getAttribute('aria-current')).toBe('true')
    await waitFor(() => expect(rowsOf(settings())).toHaveLength(report().checks.length))
  })

  it('opening it asks main for the checks and shows a row for each: name, status, what was found, in the groups of First run', async () => {
    renderApp()
    expect(callsOf('firstRun.checks')).toHaveLength(0)
    act(() => openSettings('HealthSection'))
    expect(within(settings()).getByRole('heading', { level: 2 }).textContent).toBe('Health')
    expect(summaryOf(settings())).toBe('Checking…')
    const health = await openHealth()
    expect(callsOf('firstRun.checks')).toHaveLength(1)
    expect(rowsOf(health).map(readRow)).toEqual(expected(report()))
    expect([...health.querySelectorAll('section[aria-label] h3')].map((each) => each.textContent)).toEqual(['Claude Code', 'Command-line tools', 'GitHub', 'Harness', 'qmd'])
    expect(summaryOf(health)).toBe('3 failed · 2 warnings')
    // What to do, and the command to copy.
    expect(rowOf(health, 'jq').textContent).toContain('Install it')
    expect(rowOf(health, 'jq').querySelector('code')?.textContent).toBe('brew install jq')
    expect(within(rowOf(health, 'jq')).getByRole('button', { name: 'Copy brew install jq' })).toBeTruthy()
  })

  it('Copy puts the command on the clipboard and says so in a success toast; the label stays "Copy"', async () => {
    const written: string[] = []
    const clipboard = { writeText: (text: string) => (written.push(text), Promise.resolve()) }
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
    resetToasts()
    try {
      renderApp()
      act(() => openSettings('HealthSection'))
      const health = await openHealth()
      const copy = within(rowOf(health, 'jq')).getByRole('button', { name: 'Copy brew install jq' })
      await act(async () => {
        fireEvent.click(copy)
      })
      expect(written).toEqual(['brew install jq'])
      expect(toasts.getState().toasts).toMatchObject([{ kind: 'success', text: 'Copied brew install jq' }])
      expect(copy.textContent).toBe('Copy')
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard
      resetToasts()
    }
  })

  it('a check main could not run is said in an alert, and the next "Check again" clears it', async () => {
    // Answered a turn of the event loop later, as main does: were the failed check asked again by
    // itself, the test would fail on its count instead of spinning without end.
    handlers['firstRun.checks'] = () => new Promise<Answer>((resolve) => setTimeout(() => resolve({ ok: false, error: 'the login shell did not start' }), 0))
    renderApp()
    const health = await openHealth()
    await new Promise((resolve) => setTimeout(resolve, 20))
    // One call: a failed check is not asked again by itself.
    await flush()
    expect(callsOf('firstRun.checks')).toHaveLength(1)
    expect(within(health).getByRole('alert').textContent).toContain('the login shell did not start')
    handlers['firstRun.checks'] = () => ({ ok: true, value: report() })
    fireEvent.click(within(health).getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(rowsOf(health)).toHaveLength(report().checks.length))
    expect(within(health).queryByRole('alert')).toBeNull()
  })

  it('"Check again" asks main again; while a check runs it and the actions are inactive', async () => {
    renderApp()
    const health = await openHealth()
    const pending = later()
    handlers['firstRun.checks'] = () => pending.answer
    const again = within(health).getByRole('button', { name: 'Check again' })
    const actions = (): HTMLElement[] => rowsOf(health).flatMap((each) => within(each).queryAllByRole('button').filter((button) => !button.getAttribute('aria-label')?.startsWith('Copy ')))
    expect(actions().map((each) => each.textContent)).toEqual(['Install', 'Move…', 'Download…', 'Skip…'])
    expect([again, ...actions()].map(isInactive)).toEqual([false, false, false, false, false])
    fireEvent.click(again)
    expect(callsOf('firstRun.checks')).toHaveLength(2)
    expect(summaryOf(health)).toBe('Checking…')
    // Inactive to the eye too (F-SPEC "First run": muted, no fill), not only deaf to the click.
    expect([again, ...actions()].map(isInactive)).toEqual([true, true, true, true, true])
    fireEvent.click(again)
    fireEvent.click(within(rowOf(health, 'harness')).getByRole('button', { name: 'Install' }))
    fireEvent.click(within(rowOf(health, 'legacy-harness')).getByRole('button', { name: 'Move…' }))
    expect(callsOf('firstRun.checks')).toHaveLength(2)
    expect(callsOf('firstRun.run')).toHaveLength(0)
    expect(screen.queryByTestId('migration-form')).toBeNull()
    await pending.give({ ok: true, value: installed() })
    expect(rowOf(health, 'harness').dataset.status).toBe('ok')
    expect(summaryOf(health)).toBe('2 failed · 2 warnings')
    expect([again, ...actions()].map(isInactive)).toEqual([false, false, false, false])
  })
})

describe('Settings → Health: actions', () => {
  it('an action goes to main as firstRun.run, which asks before it runs; its row says "Running…" and the answer replaces the checks', async () => {
    renderApp()
    const health = await openHealth()
    const pending = later()
    handlers['firstRun.run'] = () => pending.answer
    // Two clicks before the screen has drawn the lock: still one action.
    const install = within(rowOf(health, 'harness')).getByRole('button', { name: 'Install' })
    act(() => {
      install.click()
      install.click()
    })
    expect(callsOf('firstRun.run')).toEqual([{ action: 'harness-install', projectName: undefined }])
    expect(rowOf(health, 'harness').querySelector('.w-chip')?.textContent).toBe('Running…')
    expect(rowOf(health, 'jq').querySelector('.w-chip')?.textContent).toBe('Failed')
    // Everything waits for the action: no second action, no check, and the buttons show it.
    const skip = within(rowOf(health, 'qmd-models')).getByRole('button', { name: 'Skip…' })
    expect([skip, within(rowOf(health, 'harness')).getByRole('button', { name: 'Install' }), within(health).getByRole('button', { name: 'Check again' })].map(isInactive)).toEqual([true, true, true])
    fireEvent.click(skip)
    fireEvent.click(within(health).getByRole('button', { name: 'Check again' }))
    expect(callsOf('firstRun.run')).toHaveLength(1)
    expect(callsOf('firstRun.checks')).toHaveLength(1)
    await pending.give({ ok: true, value: { outcome: 'done', message: 'Installed 1.2.3', report: installed() } })
    expect(isInactive(skip)).toBe(false)
    expect(rowOf(health, 'harness').dataset.status).toBe('ok')
    expect(rowOf(health, 'harness').querySelector('.w-chip')?.textContent).toBe('OK')
    expect(health.textContent).toContain('Installed 1.2.3')
    expect(within(health).queryByRole('alert')).toBeNull()
    // The checks came with the answer: main is not asked for them again.
    expect(callsOf('firstRun.checks')).toHaveLength(1)
  })

  it('"Cancel" in main\'s dialog (declined) changes nothing; a failed action is an alert; an action main could not take is an alert too', async () => {
    renderApp()
    const health = await openHealth()
    const install = () => fireEvent.click(within(rowOf(health, 'harness')).getByRole('button', { name: 'Install' }))

    handlers['firstRun.run'] = () => ({ ok: true, value: { outcome: 'declined', message: null, report: report() } })
    install()
    await flush()
    expect(rowsOf(health).map(readRow)).toEqual(expected(report()))
    expect(within(health).queryByRole('alert')).toBeNull()

    const failed = report({ harness: { status: 'fail', detail: 'The last attempt failed: no network', actions: [{ id: 'harness-install', label: 'Retry' }] } })
    handlers['firstRun.run'] = () => ({ ok: true, value: { outcome: 'failed', message: 'no network', report: failed } })
    install()
    await flush()
    expect(within(health).getByRole('alert').textContent).toBe('no network')
    expect(within(rowOf(health, 'harness')).getByRole('button', { name: 'Retry' })).toBeTruthy()

    handlers['firstRun.run'] = () => ({ ok: false, error: 'main is gone' })
    fireEvent.click(within(rowOf(health, 'harness')).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(within(health).getByRole('alert').textContent).toContain('main is gone')
    // Nothing is left running.
    expect(isInactive(within(health).getByRole('button', { name: 'Check again' }))).toBe(false)
  })

  it('an action that outlives the section is still running when the section comes back: no check and no second action meanwhile', async () => {
    renderApp()
    await openHealth()
    const pending = later()
    handlers['firstRun.run'] = () => pending.answer
    fireEvent.click(within(rowOf(settings(), 'harness')).getByRole('button', { name: 'Install' }))

    // To another section and back, then the window closed and opened again.
    act(() => selectSection('OtherSection'))
    expect(screen.getByText('Other body')).toBeTruthy()
    act(() => selectSection('HealthSection'))
    act(() => closeSettings())
    act(() => openSettings('HealthSection'))
    await flush()
    const health = settings()
    expect(rowOf(health, 'harness').querySelector('.w-chip')?.textContent).toBe('Running…')
    expect(isInactive(within(health).getByRole('button', { name: 'Check again' }))).toBe(true)
    fireEvent.click(within(rowOf(health, 'harness')).getByRole('button', { name: 'Install' }))
    fireEvent.click(within(health).getByRole('button', { name: 'Check again' }))
    expect(callsOf('firstRun.run')).toHaveLength(1)
    expect(callsOf('firstRun.checks')).toHaveLength(1)

    await pending.give({ ok: true, value: { outcome: 'done', message: null, report: installed() } })
    expect(rowOf(health, 'harness').dataset.status).toBe('ok')
    expect(isInactive(within(health).getByRole('button', { name: 'Check again' }))).toBe(false)
  })

  // worfy-update ticket 08: the row of a failed Update build, in the group "worfy".
  it('a failed Update shows "worfy version" red in the group "worfy"; "Show log" asks main for update.showLog, not for an action, and its error is an alert', async () => {
    const failed = report()
    failed.checks.push(
      check('worfy-update', 'worfy', 'worfy version', { status: 'fail', detail: 'update failed', hint: 'pnpm exited with 1', actions: [{ id: 'update-log', label: 'Show log' }], opensFirstRun: false }),
    )
    handlers['firstRun.checks'] = () => ({ ok: true, value: failed })
    handlers['update.showLog'] = () => ({ ok: true, value: undefined })
    renderApp()
    const health = await openHealth()
    const row = rowOf(health, 'worfy-update')
    expect(readRow(row)).toEqual({ id: 'worfy-update', name: 'worfy version', status: 'fail', chip: 'Failed', detail: 'update failed' })
    expect(row.textContent).toContain('pnpm exited with 1')
    expect(within(health).getByRole('region', { name: 'worfy' }).contains(row)).toBe(true)

    fireEvent.click(within(row).getByRole('button', { name: 'Show log' }))
    await flush()
    expect(callsOf('update.showLog')).toEqual([undefined])
    expect(callsOf('firstRun.run')).toEqual([])
    expect(within(health).queryByRole('alert')).toBeNull()

    handlers['update.showLog'] = () => ({ ok: false, error: 'there is no build log yet: no Update was built' })
    fireEvent.click(within(row).getByRole('button', { name: 'Show log' }))
    await flush()
    expect(within(health).getByRole('alert').textContent).toContain('there is no build log yet')
  })

  it('without a Project the GitHub sign-in is a command to copy, as in First run', async () => {
    renderApp()
    const health = await openHealth()
    const accounts = rowOf(health, 'gh-auth')
    expect(within(accounts).queryByRole('button', { name: 'Sign in…' })).toBeNull()
    expect(accounts.textContent).toContain('No Project is connected yet')
    expect(within(accounts).getByRole('button', { name: 'Copy gh auth login' })).toBeTruthy()
  })

  it('with a Project a confirmed GitHub sign-in opens a Terminal on its Canvas and closes Settings, without the mark', async () => {
    const projects: ProjectsState = { projects: [{ id: 'alpha-1', name: 'alpha', path: '/repo/alpha', branch: 'main' }], activeId: 'alpha-1', revision: 1 }
    handlers['projects.list'] = () => ({ ok: true, value: projects })
    act(() => acceptProjectsState(projects))
    handlers['firstRun.run'] = () => ({ ok: true, value: { outcome: 'confirmed', message: null, report: report() } })
    handlers['viewport.get'] = () => ({ ok: true, value: null })
    handlers['layout.apply'] = () => ({ ok: true, value: { projectId: 'alpha-1', layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 } })
    handlers['terminal.open'] = () => ({ ok: true, value: undefined })
    renderApp()
    const health = await openHealth()
    fireEvent.click(within(rowOf(health, 'gh-auth')).getByRole('button', { name: 'Sign in…' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
    expect(callsOf('firstRun.run')).toEqual([{ action: 'gh-login', projectName: 'alpha' }])
    expect(callsOf('terminal.open')).toMatchObject([{ projectId: 'alpha-1', command: 'gh auth login' }])
    expect(callsOf('firstRun.close')).toHaveLength(0)
  })

  it('a GitHub sign-in confirmed in Health over the open First run dialog closes Settings only: the dialog stays and no mark is written', async () => {
    const projects: ProjectsState = { projects: [{ id: 'alpha-1', name: 'alpha', path: '/repo/alpha', branch: 'main' }], activeId: 'alpha-1', revision: 2 }
    handlers['projects.list'] = () => ({ ok: true, value: projects })
    act(() => acceptProjectsState(projects))
    handlers['firstRun.run'] = () => ({ ok: true, value: { outcome: 'confirmed', message: null, report: report() } })
    handlers['viewport.get'] = () => ({ ok: true, value: null })
    handlers['layout.apply'] = () => ({ ok: true, value: { projectId: 'alpha-1', layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 2 } })
    handlers['terminal.open'] = () => ({ ok: true, value: undefined })
    renderApp({ firstRun: true })
    act(() => openFirstRun())
    await waitFor(() => expect(rowsOf(firstRun())).toHaveLength(report().checks.length))
    const health = await openHealth()
    fireEvent.click(within(rowOf(health, 'gh-auth')).getByRole('button', { name: 'Sign in…' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
    expect(callsOf('terminal.open')).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: 'First run' })).not.toBeNull()
    expect(callsOf('firstRun.close')).toHaveLength(0)
    fireEvent.click(within(firstRun()).getByRole('button', { name: 'Close' }))
  })

  it('a GitHub sign-in confirmed after the section left the screen still opens its Terminal, and closes nothing: Settings stays on the section the person went to', async () => {
    const projects: ProjectsState = { projects: [{ id: 'alpha-1', name: 'alpha', path: '/repo/alpha', branch: 'main' }], activeId: 'alpha-1', revision: 2 }
    handlers['projects.list'] = () => ({ ok: true, value: projects })
    act(() => acceptProjectsState(projects))
    const asked = later()
    handlers['firstRun.run'] = () => asked.answer
    handlers['viewport.get'] = () => ({ ok: true, value: null })
    handlers['layout.apply'] = () => ({ ok: true, value: { projectId: 'alpha-1', layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 2 } })
    handlers['terminal.open'] = () => ({ ok: true, value: undefined })
    renderApp()
    const health = await openHealth()
    fireEvent.click(within(rowOf(health, 'gh-auth')).getByRole('button', { name: 'Sign in…' }))
    // main's dialog is still up; the person goes to another section and answers "Confirm" there.
    act(() => selectSection('OtherSection'))
    await asked.give({ ok: true, value: { outcome: 'confirmed', message: null, report: report() } })
    await waitFor(() => expect(callsOf('terminal.open')).toMatchObject([{ projectId: 'alpha-1', command: 'gh auth login' }]))
    await flush()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()
    expect(screen.getByText('Other body')).toBeTruthy()
    expect(callsOf('firstRun.close')).toHaveLength(0)
  })
})

describe('Settings → Health: the mark of First run and the shared checks', () => {
  it('closing Settings — Close, Esc, another section — never tells main that First run was closed', async () => {
    renderApp()
    let health = await openHealth()
    fireEvent.click(within(health).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    health = await openHealth()
    fireEvent.keyDown(within(health).getByRole('button', { name: 'Check again' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await openHealth()
    act(() => selectSection('OtherSection'))
    await flush()
    expect(callsOf('firstRun.close')).toHaveLength(0)
    // Each opening of the section checked.
    expect(callsOf('firstRun.checks')).toHaveLength(3)
  })

  it('leaves no checks behind: First run opened afterwards checks afresh, as it does after its own Close', async () => {
    renderApp({ firstRun: true })
    const health = await openHealth()
    expect(useFirstRun.getState().report).not.toBeNull()
    fireEvent.click(within(health).getByRole('button', { name: 'Close' }))
    expect(useFirstRun.getState()).toMatchObject({ open: false, report: null, failure: null })
    act(() => openFirstRun())
    expect(summaryOf(firstRun())).toBe('Checking…')
    await waitFor(() => expect(rowsOf(firstRun())).toHaveLength(report().checks.length))
    expect(callsOf('firstRun.checks')).toHaveLength(2)
  })

  it('a check or an action that ends after Settings closed leaves no checks behind either', async () => {
    renderApp()
    const health = await openHealth()
    const checking = later()
    handlers['firstRun.checks'] = () => checking.answer
    fireEvent.click(within(health).getByRole('button', { name: 'Check again' }))
    act(() => closeSettings())
    await checking.give({ ok: true, value: installed() })
    expect(useFirstRun.getState()).toMatchObject({ report: null, checking: false })

    handlers['firstRun.checks'] = () => ({ ok: true, value: report() })
    const running = later()
    handlers['firstRun.run'] = () => running.answer
    fireEvent.click(within(rowOf(await openHealth(), 'harness')).getByRole('button', { name: 'Install' }))
    act(() => closeSettings())
    await running.give({ ok: true, value: { outcome: 'done', message: null, report: installed() } })
    expect(useFirstRun.getState()).toMatchObject({ report: null, checking: false })
    // The action is over: the section opened again checks and is not locked.
    const again = await openHealth()
    expect(isInactive(within(again).getByRole('button', { name: 'Check again' }))).toBe(false)
  })

  it('First run opening in the same moment Settings closes keeps the checks the section had: the dialog shows them and asks for none', async () => {
    renderApp({ firstRun: true })
    await openHealth()
    expect(callsOf('firstRun.checks')).toHaveLength(1)
    // One render: the section leaves the screen before the dialog is on it.
    act(() => {
      openFirstRun()
      closeSettings()
    })
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    expect(rowsOf(firstRun()).map(readRow)).toEqual(expected(report()))
    await flush()
    expect(rowsOf(firstRun()).map(readRow)).toEqual(expected(report()))
    expect(callsOf('firstRun.checks')).toHaveLength(1)
    fireEvent.click(within(firstRun()).getByRole('button', { name: 'Close' }))
  })

  it('opened while a check of the closed First run dialog still runs: that check is dropped with the dialog, and the section asks for its own', async () => {
    const dropped = later()
    handlers['firstRun.checks'] = () => dropped.answer
    renderApp({ firstRun: true })
    act(() => openFirstRun())
    fireEvent.click(within(firstRun()).getByRole('button', { name: 'Close' }))
    expect(callsOf('firstRun.close')).toHaveLength(1)

    act(() => openSettings('HealthSection'))
    // One check at a time: the section waits for the one that runs.
    expect(callsOf('firstRun.checks')).toHaveLength(1)
    expect(summaryOf(settings())).toBe('Checking…')
    handlers['firstRun.checks'] = () => ({ ok: true, value: installed() })
    await dropped.give({ ok: true, value: report() })
    await waitFor(() => expect(rowsOf(settings()).map(readRow)).toEqual(expected(installed())))
    expect(callsOf('firstRun.checks')).toHaveLength(2)
    expect(callsOf('firstRun.close')).toHaveLength(1)
  })

  it('shows the checks of the First run dialog and shares a check and an action with it; only the dialog\'s Close writes the mark', async () => {
    renderApp({ firstRun: true })
    act(() => openFirstRun())
    await waitFor(() => expect(rowsOf(firstRun())).toHaveLength(report().checks.length))
    expect(callsOf('firstRun.checks')).toHaveLength(1)

    // Health over the dialog: the same rows at once, and its own check shows in both.
    const pending = later()
    handlers['firstRun.checks'] = () => pending.answer
    act(() => openSettings('HealthSection'))
    expect(rowsOf(settings()).map(readRow)).toEqual(rowsOf(firstRun()).map(readRow))
    expect(callsOf('firstRun.checks')).toHaveLength(2)
    expect(summaryOf(settings())).toBe('Checking…')
    expect(summaryOf(firstRun())).toBe('Checking…')
    await pending.give({ ok: true, value: installed() })
    expect(rowsOf(settings()).map(readRow)).toEqual(expected(installed()))
    expect(rowsOf(firstRun()).map(readRow)).toEqual(expected(installed()))

    // An action pressed in Health: the dialog under it is "Running…" too and its Close waits.
    const running = later()
    handlers['firstRun.run'] = () => running.answer
    fireEvent.click(within(rowOf(settings(), 'qmd-models')).getByRole('button', { name: 'Skip…' }))
    expect(rowOf(firstRun(), 'qmd-models').querySelector('.w-chip')?.textContent).toBe('Running…')
    fireEvent.click(within(firstRun()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'First run' })).not.toBeNull()
    const skipped = report({ harness: { status: 'ok', actions: [] }, 'qmd-models': { status: 'ok', detail: 'skipped', actions: [] } })
    await running.give({ ok: true, value: { outcome: 'done', message: null, report: skipped } })
    expect(rowsOf(firstRun()).map(readRow)).toEqual(expected(skipped))

    // Settings closed: the dialog keeps its checks and no mark is written.
    fireEvent.click(within(settings()).getByRole('button', { name: 'Close' }))
    expect(rowsOf(firstRun()).map(readRow)).toEqual(expected(skipped))
    expect(callsOf('firstRun.close')).toHaveLength(0)
    fireEvent.click(within(firstRun()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(callsOf('firstRun.close')).toHaveLength(1)
  })
})

describe('Settings → Health: the move form of the old Harness', () => {
  const plan: MigrationPlan = {
    offered: true,
    available: false,
    missing: ['the plugin worfy is not installed: install it first'],
    claudeHome: '/Users/me/.claude',
    harnessHome: '/Users/me/.claude/worfy-harness',
    claudeJson: '/Users/me/.claude.json',
    warnings: [],
    rows: [{ id: 'file:agents/scout.md', group: 'files', label: '~/.claude/agents/scout.md', detail: null, choices: ['remove', 'keep'], defaultChoice: 'remove', note: null }],
    claudeMd: null,
    profiles: [],
  }

  const form = () => screen.getByTestId('migration-form')
  const layerOfForm = (): number => Number(form().parentElement?.style.zIndex)

  it('"Move…" in Health draws the form in a layer above the Settings window; from First run it keeps its own layer', async () => {
    handlers['harnessMigration.plan'] = () => ({ ok: true, value: plan })
    renderApp({ firstRun: true })
    const health = await openHealth()
    fireEvent.click(within(rowOf(health, 'legacy-harness')).getByRole('button', { name: 'Move…' }))
    await waitFor(() => expect(within(form()).getByTestId('migration-missing')).toBeTruthy())
    expect(layerOfForm()).toBeGreaterThan(SETTINGS_LAYER)
    fireEvent.keyDown(within(form()).getByTestId('migration-close'), { key: 'Escape' })
    act(() => closeSettings())

    act(() => openFirstRun())
    await waitFor(() => expect(rowsOf(firstRun())).toHaveLength(report().checks.length))
    const moveInDialog = within(rowOf(firstRun(), 'legacy-harness')).getByRole('button', { name: 'Move…' })
    moveInDialog.focus()
    fireEvent.click(moveInDialog)
    await waitFor(() => expect(within(form()).getByTestId('migration-missing')).toBeTruthy())
    expect(layerOfForm()).toBe(100)
    // The dialog is as it was: its form does not take the focus (only the one over Settings does).
    expect(document.activeElement).toBe(moveInDialog)
    // Esc on the dialog under the form does not close the dialog (F-SPEC "First run", Keys).
    fireEvent.keyDown(firstRun(), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'First run' })).not.toBeNull()
    fireEvent.click(within(form()).getByTestId('migration-close'))
    expect(screen.queryByTestId('migration-form')).toBeNull()
  })

  it('the keyboard is the form\'s while it is open: the focus goes into it and stays through its change, Tab turns round inside, Esc closes the form and not Settings, and the checks run again', async () => {
    const reading = later()
    handlers['harnessMigration.plan'] = () => reading.answer
    renderApp()
    const health = await openHealth()
    const move = within(rowOf(health, 'legacy-harness')).getByRole('button', { name: 'Move…' })
    move.focus()
    fireEvent.click(move)
    // "Reading ~/.claude…": the focus is in the form already, not on the window under it.
    expect(form().contains(document.activeElement)).toBe(true)
    // main answered: the form drew itself anew and the control that had the focus is gone.
    await reading.give({ ok: true, value: plan })
    expect(within(form()).getByTestId('migration-missing')).toBeTruthy()
    expect(form().contains(document.activeElement)).toBe(true)

    // Tab at the last control goes to the first, Shift+Tab back: never to the window under the form.
    const controls = [...form().querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])')]
    expect(controls.length).toBeGreaterThan(1)
    const first = controls[0]!
    const last = controls.at(-1)!
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    expect(settings().contains(document.activeElement)).toBe(false)

    const checksBefore = callsOf('firstRun.checks').length
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByTestId('migration-form')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()
    expect(within(settings()).getByRole('heading', { level: 2 }).textContent).toBe('Health')
    // Back on the button that opened the form; what the form may have moved is checked again.
    expect(document.activeElement).toBe(move)
    expect(callsOf('firstRun.checks')).toHaveLength(checksBefore + 1)
    await flush()
    expect(callsOf('firstRun.close')).toHaveLength(0)
  })

  /** A plan main lets the person move: a row with two choices, and "Move" is on. */
  const movable: MigrationPlan = { ...plan, available: true, missing: [] }
  /**
   * What a press of the mouse on text that takes no focus does in the app: the focus falls to the
   * page. jsdom moves no focus on a press, so the test takes it off the control the same way.
   */
  const pressOnText = async (): Promise<void> => {
    act(() => (document.activeElement as HTMLElement).blur())
    await flush()
  }
  /** Opens the form from Health with the focus on "Move…", as a click leaves it, and waits for the plan. */
  async function openForm(shown: MigrationPlan): Promise<HTMLElement> {
    handlers['harnessMigration.plan'] = () => ({ ok: true, value: shown })
    const move = within(rowOf(await openHealth(), 'legacy-harness')).getByRole('button', { name: 'Move…' })
    move.focus()
    fireEvent.click(move)
    await waitFor(() => expect(within(form()).getByTestId('migration-actions')).toBeTruthy())
    return move
  }

  it('a press on the text of the form does not hand the keyboard to the window under it: the focus returns to the control that had it, Tab stays in the form, Esc closes the form only', async () => {
    renderApp()
    const move = await openForm(plan)
    // The control that had the focus, not just the first one: the last button of the form.
    const held = within(form()).getByTestId('migration-close')
    held.focus()
    expect([...form().querySelectorAll('button:not([disabled])')].indexOf(held)).toBeGreaterThan(0)
    await pressOnText()
    expect(document.activeElement).toBe(held)

    // Tab, pressed where the focus is, turns round inside the form instead of walking the Settings window.
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(form().contains(document.activeElement)).toBe(true)
    expect(settings().contains(document.activeElement)).toBe(false)

    await pressOnText()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByTestId('migration-form')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()
    expect(within(settings()).getByRole('heading', { level: 2 }).textContent).toBe('Health')
    expect(document.activeElement).toBe(move)
  })

  it('the form redrawn while one of its controls has the focus leaves the focus on that control', async () => {
    renderApp()
    await openForm(movable)
    const held = within(form()).getByTestId('migration-close')
    held.focus()
    // Any change of the form's elements, as when main answers or a row changes.
    act(() => {
      form().append(document.createElement('span'))
    })
    await flush()
    expect(document.activeElement).toBe(held)
  })

  it('a control switched off under the focus ("Move" while main moves) passes the focus to a control of the form that is on; Esc then closes neither the form nor Settings', async () => {
    renderApp()
    await openForm(movable)
    const moving = later()
    handlers['harnessMigration.apply'] = () => moving.answer
    const start = within(form()).getByRole('button', { name: 'Move' })
    start.focus()
    fireEvent.click(start)
    await flush()
    expect((start as HTMLButtonElement).disabled).toBe(true)
    const holder = document.activeElement as HTMLElement
    expect(form().contains(holder)).toBe(true)
    expect(holder.matches(':disabled')).toBe(false)
    fireEvent.keyDown(holder, { key: 'Escape' })
    expect(screen.queryByTestId('migration-form')).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()
    await moving.give({ ok: true, value: { outcome: 'refused', reason: 'not now' } })
    expect(form().contains(document.activeElement)).toBe(true)
  })

  it('with every control of the form switched off the form itself holds the focus: Tab goes nowhere and Esc closes nothing, until a control is on again', async () => {
    renderApp()
    // Nothing to choose: the form has "Cancel" and "Move" only, and both are off while main moves.
    await openForm({ ...movable, rows: [] })
    const moving = later()
    handlers['harnessMigration.apply'] = () => moving.answer
    const start = within(form()).getByRole('button', { name: 'Move' })
    start.focus()
    fireEvent.click(start)
    await flush()
    expect(form().querySelectorAll('button:not([disabled])')).toHaveLength(0)
    const layer = form().parentElement!
    expect(document.activeElement).toBe(layer)
    // The layer covers the whole window: no focus ring round it.
    expect(layer.style.outline).toBe('none')
    expect(fireEvent.keyDown(layer, { key: 'Tab' })).toBe(false)
    fireEvent.keyDown(layer, { key: 'Escape' })
    expect(screen.queryByTestId('migration-form')).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()
    await moving.give({ ok: true, value: { outcome: 'refused', reason: 'not now' } })
    await flush()
    expect(document.activeElement).not.toBe(layer)
    expect(form().contains(document.activeElement)).toBe(true)
    expect((document.activeElement as HTMLElement).matches(':disabled')).toBe(false)
  })

  it('Esc while the form still reads ~/.claude, or says it could not, closes neither the form nor Settings; "Cancel" closes the form', async () => {
    const reading = later()
    handlers['harnessMigration.plan'] = () => reading.answer
    renderApp()
    const health = await openHealth()
    fireEvent.click(within(rowOf(health, 'legacy-harness')).getByRole('button', { name: 'Move…' }))
    expect(form().textContent).toContain('Reading ~/.claude…')
    expect(form().contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByTestId('migration-form')).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()

    await reading.give({ ok: false, error: 'cannot read ~/.claude' })
    expect(form().textContent).toContain('cannot read ~/.claude')
    expect(form().contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByTestId('migration-form')).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()

    fireEvent.click(within(form()).getByTestId('migration-close'))
    expect(screen.queryByTestId('migration-form')).toBeNull()
    expect(within(settings()).getByRole('heading', { level: 2 }).textContent).toBe('Health')
  })

  it('the form closed in the same moment the focus fell to the page: the focus goes back to "Move…", not after the form that is gone', async () => {
    renderApp()
    const move = await openForm(plan)
    const cancel = within(form()).getByTestId('migration-close')
    cancel.focus()
    act(() => {
      cancel.blur()
      cancel.click()
    })
    await flush()
    expect(screen.queryByTestId('migration-form')).toBeNull()
    expect(document.activeElement).toBe(move)
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeNull()
  })

  it('opened from First run the form is as before: a press on its text leaves the focus on the page', async () => {
    handlers['harnessMigration.plan'] = () => ({ ok: true, value: plan })
    renderApp({ firstRun: true })
    act(() => openFirstRun())
    await waitFor(() => expect(rowsOf(firstRun())).toHaveLength(report().checks.length))
    fireEvent.click(within(rowOf(firstRun(), 'legacy-harness')).getByRole('button', { name: 'Move…' }))
    await waitFor(() => expect(within(form()).getByTestId('migration-actions')).toBeTruthy())
    within(form()).getByTestId('migration-close').focus()
    await pressOnText()
    expect(document.activeElement).toBe(document.body)
    expect(form().parentElement?.hasAttribute('tabindex')).toBe(false)
    fireEvent.click(within(form()).getByTestId('migration-close'))
    fireEvent.click(within(firstRun()).getByRole('button', { name: 'Close' }))
  })
})
