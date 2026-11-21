import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import type { Integration, IntegrationStatus, ProjectIntegration } from '../../src/shared/integrations/types'
import type { IntegrationToolInfo } from '../../src/shared/ipc/integrations'
import { flush } from './kit-window'

// Project settings → Integrations (worfy-integrations ticket 08): the rows of «worfy integrations» in every status,
// the Tools filter (Read only off without readOnlyHint, with its reason), the price after the filter, the ticks, the
// menu «…» and the confirmation of Remove; «From Claude Code» with the warning of two tool sets and «Add as
// integration»; a Linked machine with read-only and with full access. main is replaced: what it answers is set by
// each test, and what it was asked is recorded.

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  answers: {} as Record<string, Answer | ((input: unknown) => Answer | Promise<Answer>)>,
  calls: [] as { machine: string | null | undefined; channel: string; input: unknown }[],
  windowMachine: null as string | null,
  readOnly: {} as Record<string, string>,
  rows: null as McpServerRow[] | null,
}))
const answer = async (machine: string | null | undefined, channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ machine, channel, input })
  const set = main.answers[channel]
  if (set === undefined) return { ok: false, error: `no answer for ${channel}` }
  return typeof set === 'function' ? set(input) : set
}
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => answer(undefined, channel, input),
  invokeOn: (machine: string | null, channel: string, input?: unknown) => answer(machine, channel, input),
  subscribe: () => () => undefined,
  windowMachine: () => main.windowMachine,
  hasPreloadBridge: () => false,
}))
vi.mock('../../src/renderer/projects/useProjects', async (original) => ({
  ...(await original<object>()),
  useReadOnly: (machine: string | null) => main.readOnly[machine ?? ''] ?? null,
  useProjects: () => ({ projects: [{ id: PROJECT.id, name: PROJECT.name, path: PROJECT.path }] }),
}))
vi.mock('../../src/renderer/session/store', async (original) => ({ ...(await original<object>()), useLatestMcp: () => main.rows }))

const { IntegrationsSection } = await import('../../src/renderer/integrations/IntegrationsSection')

const PROJECT = { id: 'demo-00000001', name: 'demo', path: '/work/demo' }

const integration = (id: string, label: string, extra: Partial<Integration> = {}): Integration => ({
  id,
  service: 'custom',
  label,
  transport: { kind: 'http', url: 'http://127.0.0.1:4100/mcp' },
  auth: 'bearer',
  headerName: null,
  signIn: { account: null, site: null, at: '2026-11-21T00:00:00.000Z' },
  ...extra,
})
const entry = (id: string, extra: Partial<ProjectIntegration> = {}): ProjectIntegration => ({ id, enabled: true, tools: 'all', autopilot: false, ...extra })

// Sizes chosen so the price is easy to read: all three — (100 + 120 + 200) + 2 commas + 2 brackets = 424 → 106 tokens;
// the two read-only — 220 + 1 + 2 = 223 → 56 tokens.
const TOOLS: IntegrationToolInfo[] = [
  { name: 'whoami', readOnly: true, size: 100 },
  { name: 'list_items', readOnly: true, size: 120 },
  { name: 'create_item', readOnly: false, size: 200 },
]
const NO_HINTS: IntegrationToolInfo[] = TOOLS.map((tool) => ({ ...tool, readOnly: null }))

const A = integration('aaaa0001', 'Tracker — client A')
const B = integration('bbbb0002', 'Notes — client A')
const C = integration('cccc0003', 'Logs — client A')
const D = integration('dddd0004', 'Wiki — client A')

/** The list, the statuses and the tools of each Integration: the answers of a Project with A–D. */
function project(items: { integration: Integration; project: ProjectIntegration | null; status: IntegrationStatus; tools?: Answer | 'pending' }[]): void {
  main.answers['integrations.list'] = { ok: true, value: { items: items.map(({ integration: each, project: own }) => ({ integration: each, project: own })) } }
  main.answers['integrations.status'] = { ok: true, value: { statuses: items.filter((item) => item.project !== null).map((item) => ({ id: item.integration.id, status: item.status })) } }
  main.answers['integrations.machine'] = { ok: true, value: { items: items.map((item) => ({ integration: item.integration, status: item.status, projects: item.project === null ? [] : [{ id: PROJECT.id, name: PROJECT.name, enabled: item.project.enabled }] })), dangling: [] } }
  main.answers['integrations.tools'] = (input) => {
    const id = (input as { id: string }).id
    const found = items.find((item) => item.integration.id === id)
    if (found?.tools === 'pending') return new Promise<Answer>(() => undefined)
    return found?.tools ?? { ok: true, value: { status: found?.status ?? { state: 'signed-in' }, tools: TOOLS, hidden: [] } }
  }
}

const row = (id: string): HTMLElement => screen.getAllByTestId('integration-row').find((each) => each.dataset.id === id)!
const asked = (channel: string): unknown[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)

async function open(props: { machine?: string | null; path?: boolean } = {}): Promise<void> {
  const { path = false, ...rest } = props
  render(<IntegrationsSection project={path ? PROJECT : { id: PROJECT.id, name: PROJECT.name }} readOnly={main.readOnly[props.machine ?? ''] ?? null} {...rest} />)
  await flush()
}

beforeEach(() => {
  main.calls.length = 0
  main.answers = {}
  main.windowMachine = null
  main.readOnly = {}
  main.rows = null
})
afterEach(cleanup)

describe('the rows of «worfy integrations»', () => {
  it('shows each status: signed in with the price, sign-in needed with Sign in and no call to the service, the service’s error, checking', async () => {
    project([
      { integration: A, project: entry(A.id), status: { state: 'signed-in' } },
      { integration: B, project: entry(B.id), status: { state: 'needs-sign-in' } },
      { integration: C, project: entry(C.id), status: { state: 'signed-in' }, tools: { ok: true, value: { status: { state: 'error', message: 'Bad credentials (401)' }, tools: null, hidden: [] } } },
      { integration: D, project: entry(D.id), status: { state: 'signed-in' }, tools: 'pending' },
    ])
    await open()
    expect(row(A.id).dataset.status).toBe('signed-in')
    expect(within(row(A.id)).getByTestId('integration-cost').textContent).toBe('3 tools · ~106 tokens')
    expect(row(B.id).dataset.status).toBe('needs-sign-in')
    expect(within(row(B.id)).getByTestId('integration-sub').textContent).toContain('Sign-in needed')
    expect(within(row(B.id)).getByTestId('integration-sign-in')).toBeTruthy()
    expect(row(C.id).dataset.status).toBe('error')
    expect(within(row(C.id)).getByTestId('integration-sub').textContent).toContain('127.0.0.1:4100 answered: Bad credentials (401)')
    expect(row(D.id).dataset.status).toBe('checking')
    expect(within(row(D.id)).getByTestId('integration-cost').textContent).toBe('counting…')
    // The service of an Integration without its secret is never asked.
    expect(asked('integrations.tools')).toEqual([
      { projectId: PROJECT.id, id: A.id },
      { projectId: PROJECT.id, id: C.id },
      { projectId: PROJECT.id, id: D.id },
    ])
  })

  it('asks no service after the list failed to read', async () => {
    main.answers['integrations.list'] = { ok: false, error: 'settings.json unreadable' }
    main.answers['integrations.status'] = { ok: true, value: { statuses: [] } }
    await open()
    expect(screen.getByTestId('integrations-failure').textContent).toContain('settings.json unreadable')
    expect(asked('integrations.tools')).toEqual([])
    expect(asked('integrations.machine')).toEqual([])
  })

  it('asks no service after the statuses failed to read, though the list did', async () => {
    project([{ integration: A, project: entry(A.id), status: { state: 'signed-in' } }])
    main.answers['integrations.status'] = { ok: false, error: 'secrets.json unreadable' }
    await open()
    expect(screen.getByTestId('integrations-failure').textContent).toContain('secrets.json unreadable')
    expect(asked('integrations.tools')).toEqual([])
  })

  it('shows an Integration turned off in the Project, and only those the Project has an entry for', async () => {
    project([
      { integration: A, project: entry(A.id, { enabled: false }), status: { state: 'signed-in' } },
      { integration: B, project: null, status: { state: 'signed-in' } },
    ])
    await open()
    expect(screen.getAllByTestId('integration-row').map((each) => each.dataset.id)).toEqual([A.id])
    expect(within(row(A.id)).getByText('Off in this Project')).toBeTruthy()
    // A row off in the Project starts nothing.
    expect(asked('integrations.tools')).toEqual([])
  })
})

describe('the Tools filter and the price', () => {
  it('counts the price after the filter: Read only shows «2 of 3 tools» and sends the filter to main', async () => {
    project([{ integration: A, project: entry(A.id), status: { state: 'signed-in' } }])
    main.answers['integrations.setTools'] = { ok: true, value: { project: entry(A.id, { tools: 'read-only' }) } }
    await open()
    fireEvent.click(within(row(A.id)).getByTestId('integration-filter'))
    const readOnly = await screen.findByRole('menuitemradio', { name: /Read only/u })
    expect(readOnly.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(readOnly)
    await flush()
    expect(asked('integrations.setTools')).toEqual([{ projectId: PROJECT.id, id: A.id, tools: 'read-only' }])
    expect(within(row(A.id)).getByTestId('integration-cost').textContent).toBe('2 of 3 tools · ~56 tokens')
    expect(within(row(A.id)).getByTestId('integration-filter').textContent).toContain('Read only')
  })

  it('offers no Read only for a service that marks no tool read-only, and says why', async () => {
    project([{ integration: A, project: entry(A.id), status: { state: 'signed-in' }, tools: { ok: true, value: { status: { state: 'signed-in' }, tools: NO_HINTS, hidden: [] } } }])
    await open()
    fireEvent.click(within(row(A.id)).getByTestId('integration-filter'))
    const readOnly = await screen.findByRole('menuitemradio', { name: /Read only/u })
    expect(readOnly.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('integration-read-only-why').textContent).toContain('marks no tool read-only (no readOnlyHint)')
  })

  it('Choose… keeps the tools picked and the price of them', async () => {
    project([{ integration: A, project: entry(A.id), status: { state: 'signed-in' } }])
    main.answers['integrations.setTools'] = { ok: true, value: { project: entry(A.id, { tools: ['whoami'] }) } }
    await open()
    fireEvent.click(within(row(A.id)).getByTestId('integration-filter'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Choose/u }))
    const dialog = await screen.findByTestId('integration-choose-dialog')
    for (const name of ['list_items', 'create_item']) fireEvent.click(within(dialog).getByText(name))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use these tools' }))
    await flush()
    expect(asked('integrations.setTools')).toEqual([{ projectId: PROJECT.id, id: A.id, tools: ['whoami'] }])
    expect(within(row(A.id)).getByTestId('integration-cost').textContent).toBe('1 of 3 tools · ~26 tokens')
  })
})

describe('the ticks and the menu «…»', () => {
  beforeEach(() => {
    project([{ integration: A, project: entry(A.id), status: { state: 'signed-in' } }])
  })

  it('Enabled in this Project and Available to Autopilot go to main at once', async () => {
    main.answers['integrations.setAutopilot'] = { ok: true, value: { project: entry(A.id, { autopilot: true }) } }
    main.answers['integrations.setEnabled'] = { ok: true, value: { project: entry(A.id, { enabled: false, autopilot: true }) } }
    await open()
    fireEvent.click(screen.getByLabelText(`Available to Autopilot: ${A.label}`))
    await flush()
    expect(asked('integrations.setAutopilot')).toEqual([{ projectId: PROJECT.id, id: A.id, autopilot: true }])
    expect((screen.getByLabelText(`Available to Autopilot: ${A.label}`) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText(`Enabled in this Project: ${A.label}`))
    await flush()
    expect(asked('integrations.setEnabled')).toEqual([{ projectId: PROJECT.id, id: A.id, enabled: false }])
    expect(within(row(A.id)).getByText('Off in this Project')).toBeTruthy()
  })

  it('Test asks the service again; Rename sends the new label; Sign out signs out', async () => {
    main.answers['integrations.rename'] = { ok: true, value: { integration: { ...A, label: 'Tracker — client B' } } }
    main.answers['integrations.signOut'] = { ok: true, value: { status: { state: 'needs-sign-in' } } }
    await open()
    fireEvent.click(within(row(A.id)).getByTestId('integration-more'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Test' }))
    await flush()
    expect(asked('integrations.tools')).toHaveLength(2)

    fireEvent.click(within(row(A.id)).getByTestId('integration-more'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const dialog = await screen.findByTestId('integration-rename-dialog')
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Tracker — client B' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    await flush()
    expect(asked('integrations.rename')).toEqual([{ projectId: PROJECT.id, id: A.id, label: 'Tracker — client B' }])
    expect(within(row(A.id)).getByText('Tracker — client B')).toBeTruthy()

    fireEvent.click(within(row(A.id)).getByTestId('integration-more'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await flush()
    expect(asked('integrations.signOut')).toEqual([{ id: A.id }])
    expect(row(A.id).dataset.status).toBe('needs-sign-in')
  })

  it('Disable in this Project turns the tick off', async () => {
    main.answers['integrations.setEnabled'] = { ok: true, value: { project: entry(A.id, { enabled: false }) } }
    await open()
    fireEvent.click(within(row(A.id)).getByTestId('integration-more'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable in this Project' }))
    await flush()
    expect(asked('integrations.setEnabled')).toEqual([{ projectId: PROJECT.id, id: A.id, enabled: false }])
  })

  it('Remove from Machine asks first when other Projects use it, and removes once confirmed', async () => {
    main.answers['integrations.remove'] = (input) =>
      (input as { confirmed?: boolean }).confirmed === true ? { ok: true, value: { status: 'removed' } } : { ok: true, value: { status: 'confirm', projects: ['other-app'] } }
    await open()
    fireEvent.click(within(row(A.id)).getByTestId('integration-more'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from Machine…' }))
    await flush()
    const dialog = await screen.findByTestId('integration-remove-dialog')
    expect(within(dialog).getByTestId('integration-remove-projects').textContent).toContain('other-app')
    // Nothing is removed before the confirmation.
    expect(asked('integrations.remove')).toEqual([{ projectId: PROJECT.id, id: A.id, confirmed: false }])
    main.answers['integrations.list'] = { ok: true, value: { items: [] } }
    fireEvent.click(within(dialog).getByTestId('integration-remove-confirm'))
    await flush()
    expect(asked('integrations.remove')).toEqual([
      { projectId: PROJECT.id, id: A.id, confirmed: false },
      { projectId: PROJECT.id, id: A.id, confirmed: true },
    ])
    expect(screen.queryAllByTestId('integration-row')).toEqual([])
  })

  it('Sign in of an Integration that needs it takes the token and shows what main answered', async () => {
    // main asks the service once the token is in: the answer is signed in.
    project([{ integration: A, project: entry(A.id), status: { state: 'needs-sign-in' }, tools: { ok: true, value: { status: { state: 'signed-in' }, tools: TOOLS, hidden: [] } } }])
    main.answers['integrations.setSecret'] = { ok: true, value: { status: { state: 'signed-in' } } }
    await open()
    fireEvent.click(within(row(A.id)).getByTestId('integration-sign-in'))
    const dialog = await screen.findByTestId('integration-token-dialog')
    fireEvent.change(within(dialog).getByLabelText('API token'), { target: { value: 'typed-value' } })
    fireEvent.click(within(dialog).getByTestId('integration-token-save'))
    await flush()
    expect(asked('integrations.setSecret')).toEqual([{ id: A.id, part: 'access', value: 'typed-value' }])
    expect(row(A.id).dataset.status).toBe('signed-in')
    expect(asked('integrations.tools')).toEqual([{ projectId: PROJECT.id, id: A.id }])
  })
})

describe('«From Claude Code»', () => {
  const jira = integration('eeee0005', 'Jira — client A', { service: 'atlassian', transport: { kind: 'http', url: 'https://mcp.atlassian.com/v2/mcp' }, auth: 'basic' })
  const server = (name: string, source: McpServerRow['source']): McpServerRow => ({ name, status: 'connected', tools: 3, error: null, source, sourceWord: null, actions: [] })
  const profile = (allowed: string[]): Answer => ({
    ok: true,
    value: { available: true, name: 'demo', values: { 'mcp.allowed': allowed }, fixed: {}, fixedFingerprint: 'f1', interrupted: false, severalRepos: false, fingerprint: 'f2' },
  })

  it('warns of two Jira tool sets while the connector and the Integration are both on, and turns the connector off on request', async () => {
    project([{ integration: jira, project: entry(jira.id), status: { state: 'signed-in' } }])
    main.rows = [server('claude.ai Atlassian', 'claudeai'), server('qmd', 'user')]
    main.answers['profileEdit.read'] = profile(['claude.ai Atlassian', 'qmd'])
    main.answers['profileEdit.write'] = { ok: true, value: { status: 'saved', fingerprint: 'f3', warning: null } }
    await open({ path: true })
    const rows = screen.getAllByTestId('claude-server')
    expect(rows.map((each) => [each.dataset.name, each.dataset.allowed])).toEqual([
      ['claude.ai Atlassian', 'true'],
      ['qmd', 'true'],
    ])
    const twin = screen.getByTestId('claude-server-twin')
    expect(twin.textContent).toContain('Two Jira tool sets in this Project.')
    expect(twin.textContent).toContain('Jira — client A')
    // A server of no catalogue service gets no warning.
    expect(screen.getAllByTestId('claude-server-twin')).toHaveLength(1)
    fireEvent.click(within(twin).getByRole('button', { name: 'Turn off claude.ai Atlassian in this Project' }))
    await flush()
    expect(asked('profileEdit.write')).toEqual([{ root: PROJECT.path, values: { 'mcp.allowed': ['qmd'] }, expected: 'f2' }])
  })

  it('gives no warning while the Integration of that service is off in the Project', async () => {
    project([{ integration: jira, project: entry(jira.id, { enabled: false }), status: { state: 'signed-in' } }])
    main.rows = [server('claude.ai Atlassian', 'claudeai')]
    main.answers['profileEdit.read'] = profile(['claude.ai Atlassian'])
    await open({ path: true })
    expect(screen.queryByTestId('claude-server-twin')).toBeNull()
  })

  it('«Add as integration» opens Add integration on that service; the list does not change by itself', async () => {
    project([])
    main.rows = [server('linear', 'user')]
    main.answers['profileEdit.read'] = profile([])
    await open({ path: true })
    const linear = screen.getAllByTestId('claude-server').find((each) => each.dataset.name === 'linear')!
    expect(linear.dataset.allowed).toBe('false')
    fireEvent.click(within(linear).getByRole('button', { name: 'Add as integration' }))
    await flush()
    expect(screen.getByTestId('add-integration-form').dataset.key).toBe('linear')
    expect(asked('profileEdit.write')).toEqual([])
  })

  it('a Profile with no list shows the default one as allowed, as the Sessions get it, and Allow adds to it', async () => {
    project([])
    main.rows = [server('plugin_worfy_qmd', 'user'), server('linear', 'user')]
    main.answers['profileEdit.read'] = { ok: true, value: { available: true, name: 'demo', values: { 'mcp.allowed': null }, fixed: {}, fixedFingerprint: 'f1', interrupted: false, severalRepos: false, fingerprint: 'f2' } }
    main.answers['profileEdit.write'] = { ok: true, value: { status: 'saved', fingerprint: 'f3', warning: null } }
    await open({ path: true })
    const rows = screen.getAllByTestId('claude-server')
    expect(rows.map((each) => [each.dataset.name, each.dataset.allowed])).toEqual([
      ['plugin_worfy_qmd', 'true'],
      ['linear', 'false'],
    ])
    expect(screen.getByTestId('integrations-claude').textContent).not.toContain('no MCP servers list')
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Allow' }))
    await flush()
    expect(asked('profileEdit.write')).toEqual([{ root: PROJECT.path, values: { 'mcp.allowed': ['plugin_worfy_qmd', 'worfy-canvas', 'linear'] }, expected: 'f2' }])
  })
})

describe('a window of a Linked machine with a Project of this Machine', () => {
  const profile: Answer = { ok: true, value: { available: true, name: 'demo', values: { 'mcp.allowed': [] }, fixed: {}, fixedFingerprint: 'f1', interrupted: false, severalRepos: false, fingerprint: 'f2' } }

  it('sends the Project’s channels of Add integration and «From Claude Code» to this Machine, not to the window’s', async () => {
    main.windowMachine = 'mac-l'
    const other = integration('ffff0006', 'Tracker — client B')
    project([{ integration: other, project: null, status: { state: 'signed-in' } }])
    main.answers['profileEdit.read'] = profile
    main.answers['integrations.setEnabled'] = { ok: true, value: { project: entry(other.id) } }
    main.answers['integrations.add'] = (input) => ({ ok: true, value: { integration: integration('ffff0007', (input as { label: string }).label), project: entry('ffff0007') } })
    main.answers['integrations.setSecret'] = { ok: true, value: { status: { state: 'signed-in' } } }
    await open({ machine: null, path: true })
    const through = (channel: string): (string | null | undefined)[] => main.calls.filter((call) => call.channel === channel).map((call) => call.machine)
    expect(through('profileEdit.read').length).toBeGreaterThan(0)
    expect(new Set(through('profileEdit.read'))).toEqual(new Set([null]))

    fireEvent.click(screen.getByTestId('integrations-add'))
    fireEvent.click(within(screen.getByTestId('add-integration-reuse')).getByRole('button', { name: 'Use in this Project' }))
    await flush()
    expect(through('integrations.setEnabled')).toEqual([null])

    fireEvent.click(screen.getByTestId('integrations-add'))
    fireEvent.click(within(screen.getByTestId('add-integration-catalogue')).getByText('Linear'))
    fireEvent.change(within(screen.getByTestId('add-integration-form')).getByLabelText('API token', { exact: true }), { target: { value: 'typed-value' } })
    fireEvent.click(screen.getByTestId('add-integration-save'))
    await flush()
    expect(through('integrations.add')).toEqual([null])
    expect(through('integrations.tools').filter((machine) => machine !== null)).toEqual([])
    expect(asked('integrations.tools')).toContainEqual({ projectId: PROJECT.id, id: 'ffff0007' })
  })
})

describe('a Linked machine', () => {
  beforeEach(() => {
    project([{ integration: A, project: entry(A.id), status: { state: 'signed-in' } }])
  })

  it('with read-only access shows the list and the status, and every change is off', async () => {
    main.readOnly['mac-b'] = 'Shared read-only by mac-b.'
    await open({ machine: 'mac-b' })
    expect(row(A.id).dataset.status).toBe('signed-in')
    expect((screen.getByTestId('integrations-add') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(`Enabled in this Project: ${A.label}`) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(`Available to Autopilot: ${A.label}`) as HTMLInputElement).disabled).toBe(true)
    expect((within(row(A.id)).getByTestId('integration-filter') as HTMLButtonElement).disabled).toBe(true)
    // The calls go to the Project's Machine, and the Machine-wide view (local) is not asked over the link.
    expect(main.calls.filter((call) => call.channel === 'integrations.list').map((call) => call.machine)).toEqual(['mac-b'])
    expect(asked('integrations.machine')).toEqual([])
  })

  it('with full access lets the ticks and the filter change, while Add integration and Sign out stay on the Project’s machine', async () => {
    await open({ machine: 'mac-b' })
    const add = screen.getByTestId('integrations-add') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(add.title).toContain("On the Project's machine only")
    expect((screen.getByLabelText(`Enabled in this Project: ${A.label}`) as HTMLInputElement).disabled).toBe(false)
    expect((within(row(A.id)).getByTestId('integration-filter') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(within(row(A.id)).getByTestId('integration-more'))
    expect((await screen.findByRole('menuitem', { name: 'Sign out' })).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Remove from Machine…' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Rename' }).getAttribute('aria-disabled')).not.toBe('true')
  })
})

