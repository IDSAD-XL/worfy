// The sidebar under «All Projects» (worfy-polish ticket 99): the Sessions and the ADRs of every Project of the
// window's Machine, each Project under its name, the open one first; a click on another Project's row opens
// that Project first, then the Session or the ADR. The Projects section's cards say each Project's live state
// («N busy · N PR need you · N waits»), and the Sessions rail button counts the busy Sessions. The live state
// comes from one answer of main (projectPulse.get), the other Projects' ADRs from one read each (docs.adrs);
// here main is a stand-in bridge. The real sections are checked against the built app
// (test/e2e/sidebar-rail.spec.ts).
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectPulseState } from '../../src/shared/ipc/project-pulse'
import type { ProjectsState } from '../../src/shared/ipc/projects'

const ALPHA = { id: 'alpha-0000000a', name: 'alpha', path: '/projects/alpha', branch: 'main' }
const BETA = { id: 'beta-0000000b', name: 'beta', path: '/projects/beta', branch: 'next' }
const GAMMA = { id: 'gamma-0000000c', name: 'gamma', path: '/projects/gamma', branch: 'main' }
const LIST: ProjectsState = { projects: [ALPHA, BETA, GAMMA], activeId: ALPHA.id, revision: 1 }

const live = (pid: number, sessionId: string, cwd: string, status: 'idle' | 'busy', name?: string) => ({
  pid,
  sessionId,
  cwd,
  status,
  entrypoint: 'cli',
  ...(name === undefined ? {} : { name }),
})
const ALPHA_LIVE = [live(11, 'alpha-live-1', ALPHA.path, 'busy', 'Fix the build')]
const BETA_LIVE = [live(21, 'beta-live-1', BETA.path, 'busy', 'Write the docs'), live(22, 'beta-live-2', `${BETA.path}/.claude/worktrees/07`, 'idle')]
const PULSE: ProjectPulseState = {
  projects: [
    { projectId: ALPHA.id, live: ALPHA_LIVE, busy: 1, prNeedYou: 2, waits: 1 },
    { projectId: BETA.id, live: BETA_LIVE, busy: 1, prNeedYou: 0, waits: null },
    // No live Session: no group of its own in the Sessions section.
    { projectId: GAMMA.id, live: [], busy: 0, prNeedYou: null, waits: null },
  ],
}
const adr = (number: string, title: string) => ({ path: `docs/adr/${number}-x.md`, number, title, status: 'accepted', version: `v${number}` })
const ADRS: Record<string, ReturnType<typeof adr>[]> = { [ALPHA.id]: [adr('0001', 'Alpha first')], [BETA.id]: [adr('0001', 'Beta first'), adr('0002', 'Beta second')], [GAMMA.id]: [] }

let asked: { channel: string; input: unknown }[]
let selectRefusal: string | null
/** Whether the Node of beta's first live Session is hidden on beta's Canvas. */
let betaHidden: boolean
/** The live Sessions of alpha's registry answer (claudeHome.*). */
let alphaRegistry: ReturnType<typeof live>[]
/** main's answer of projectPulse.get. */
let pulse: ProjectPulseState
/** main's answer of projects.list. */
let list: ProjectsState

function bridge(): WorfyBridge {
  return {
    invoke: (channel, input) => {
      asked.push({ channel, input })
      const projectId = (input as { projectId?: string } | undefined)?.projectId
      const answers: Record<string, unknown> = {
        'projects.list': list,
        'projectPulse.get': pulse,
        'claudeHome.sessions': { live: alphaRegistry, history: [] },
        'claudeHome.live': { live: alphaRegistry },
        'sessions.views': { views: [] },
        'docs.open': { projectId, handoff: null, adrs: ADRS[projectId ?? ''] ?? [] },
        'docs.adrs': { adrs: ADRS[projectId ?? ''] ?? [] },
        // The Canvas of beta has the Node of its first live Session.
        'layout.get': {
          projectId,
          layout: { nodes: projectId === BETA.id ? [{ id: 'node-beta-1', kind: 'session', x: 0, y: 0, w: 320, h: 200, hidden: betaHidden, data: { sessionId: 'beta-live-1' } }] : [], viewport: { x: 0, y: 0, zoom: 1 } },
          revision: 1,
        },
      }
      if (channel === 'projects.select') {
        if (selectRefusal !== null) return Promise.resolve({ ok: false, error: selectRefusal })
        return Promise.resolve({ ok: true, value: { ...LIST, activeId: (input as { id: string }).id, revision: 2 } })
      }
      const value = answers[channel]
      return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
    },
    on: () => 1,
    off: () => undefined,
  }
}

beforeEach(() => {
  // The stores of useProjects, sidebar-scope and the live state live in modules: fresh ones for each test.
  vi.resetModules()
  localStorage.clear()
  asked = []
  selectRefusal = null
  betaHidden = false
  alphaRegistry = ALPHA_LIVE
  pulse = PULSE
  list = LIST
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

async function mountSection(file: string): Promise<void> {
  const projects = await import('../../src/renderer/projects/useProjects')
  projects.acceptProjectsState(LIST)
  const { default: Section } = (await import(`../../src/renderer/shell/sidebar/${file}.tsx`)) as { default: () => ReactNode }
  render(<Section />)
}

const groups = (testId: string) => screen.getAllByTestId(testId).map((group) => ({ project: group.getAttribute('data-project'), text: group.textContent }))

describe('Sessions under «All Projects»', () => {
  it("shows the open Project's Sessions first, then those of every other Project that has one, each under its name; no «… only» line", async () => {
    await mountSection('SessionsSection')
    const section = screen.getByRole('region', { name: 'Sessions' })
    await waitFor(() => expect(within(section).getAllByTestId('sidebar-session')).toHaveLength(3))
    expect(groups('sidebar-sessions-project').map((group) => group.project)).toEqual([ALPHA.id, BETA.id])
    const [alpha, beta] = screen.getAllByTestId('sidebar-sessions-project')
    if (alpha === undefined || beta === undefined) throw new Error('two groups expected')
    expect(alpha.textContent).toContain('alpha')
    expect(alpha.textContent).toContain('Fix the build')
    expect(within(beta).getAllByTestId('sidebar-session-name').map((row) => row.textContent)).toEqual(['Write the docs', 'Session beta-liv'])
    expect(within(beta).getAllByTestId('sidebar-session').map((row) => row.getAttribute('data-project'))).toEqual([BETA.id, BETA.id])
    expect(within(section).getByTestId('sidebar-sessions-live').textContent).toBe('3 live')
    expect(within(section).getByTestId('sidebar-scope-label').textContent).toBe('All Projects')
    expect(screen.queryByTestId('sidebar-scope-note')).toBeNull()
    // The other Projects come from the one answer of main: no Sessions channel is asked for them.
    expect(asked.filter((call) => call.channel.startsWith('claudeHome.')).map((call) => (call.input as { projectRoot: string }).projectRoot)).not.toContain(BETA.path)
    expect(asked.filter((call) => call.channel === 'projectPulse.get')).toHaveLength(1)
  })

  it('under one Project shows the open one alone, with no name above it', async () => {
    await mountSection('SessionsSection')
    await waitFor(() => expect(screen.getAllByTestId('sidebar-session')).toHaveLength(3))
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    act(() => scope.setSidebarScope('project'))
    expect(screen.getAllByTestId('sidebar-session')).toHaveLength(1)
    expect(groups('sidebar-sessions-project')).toEqual([{ project: ALPHA.id, text: expect.not.stringContaining('alpha') as unknown as string }])
  })

  it('a click on a Session of another Project opens that Project, then the Session once its Node is known', async () => {
    await mountSection('SessionsSection')
    await waitFor(() => expect(screen.getAllByTestId('sidebar-session')).toHaveLength(3))
    const focus = await import('../../src/renderer/claude-home/focus')
    const request = await import('../../src/renderer/shell/session-request')
    const row = screen.getAllByTestId('sidebar-session').find((each) => each.getAttribute('data-session-id') === 'beta-live-1')
    if (row === undefined) throw new Error('no row of beta')
    await act(async () => {
      fireEvent.click(row)
    })
    expect(asked.filter((call) => call.channel === 'projects.select').map((call) => call.input)).toEqual([{ id: BETA.id }])
    // beta is open now; its section finds the Node in beta's Layout and centres it on the Canvas.
    await waitFor(() => expect(focus.useSessionFocus.getState().request).toMatchObject({ projectId: BETA.id, nodeId: 'node-beta-1' }))
    expect(request.useSessionRequest.getState().request).toBeNull()
  })

  it('says why when the other Project could not be opened, and drops the request', async () => {
    selectRefusal = 'the Project folder is gone'
    await mountSection('SessionsSection')
    await waitFor(() => expect(screen.getAllByTestId('sidebar-session')).toHaveLength(3))
    const request = await import('../../src/renderer/shell/session-request')
    const row = screen.getAllByTestId('sidebar-session').find((each) => each.getAttribute('data-project') === BETA.id)
    if (row === undefined) throw new Error('no row of beta')
    await act(async () => {
      fireEvent.click(row)
    })
    expect((await screen.findByRole('alert')).textContent).toBe('beta could not be opened: the Project folder is gone')
    expect(request.useSessionRequest.getState().request).toBeNull()
  })

  it('on a read-only screen does not bring back the hidden Node of another Project\'s Session, and says why', async () => {
    const READ_ONLY = 'Read-only: the Linked machine gives this Machine read-only access'
    vi.doMock('../../src/renderer/projects/useProjects', async (importOriginal) => ({ ...(await importOriginal<object>()), useReadOnly: () => READ_ONLY }))
    betaHidden = true
    await mountSection('SessionsSection')
    await waitFor(() => expect(screen.getAllByTestId('sidebar-session')).toHaveLength(3))
    const focus = await import('../../src/renderer/claude-home/focus')
    const request = await import('../../src/renderer/shell/session-request')
    const row = screen.getAllByTestId('sidebar-session').find((each) => each.getAttribute('data-session-id') === 'beta-live-1')
    if (row === undefined) throw new Error('no row of beta')
    await act(async () => {
      fireEvent.click(row)
    })
    expect((await screen.findByRole('alert')).textContent).toBe(READ_ONLY)
    expect(request.useSessionRequest.getState().request).toBeNull()
    expect(focus.useSessionFocus.getState().request).toBeNull()
    // Nothing is changed on beta's Canvas: only its Layout is read.
    expect(asked.filter((call) => call.channel.startsWith('layout.') && call.channel !== 'layout.get')).toEqual([])
    vi.doUnmock('../../src/renderer/projects/useProjects')
  })

  it('lists and counts a Session of a Project nested in the open one once: under the nested Project', async () => {
    const INNER = { id: 'inner-0000000d', name: 'inner', path: `${ALPHA.path}/inner`, branch: 'main' }
    const nested = live(12, 'inner-live-1', `${INNER.path}/src`, 'busy', 'Inner work')
    // The open Project's registry answer holds every Session under its folder, the nested Project's too.
    alphaRegistry = [...ALPHA_LIVE, nested]
    pulse = { projects: [...PULSE.projects, { projectId: INNER.id, live: [nested], busy: 1, prNeedYou: null, waits: null }] }
    list = { ...LIST, projects: [...LIST.projects, INNER] }
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(list)
    const { default: Section } = await import('../../src/renderer/shell/sidebar/SessionsSection')
    render(<Section />)
    await waitFor(() => expect(screen.getAllByTestId('sidebar-session')).toHaveLength(4))
    expect(screen.getAllByTestId('sidebar-session').filter((row) => row.getAttribute('data-session-id') === 'inner-live-1')).toHaveLength(1)
    const own = screen.getAllByTestId('sidebar-sessions-project').find((group) => group.getAttribute('data-project') === ALPHA.id)
    expect(own?.textContent).not.toContain('Inner work')
    expect(screen.getByTestId('sidebar-sessions-live').textContent).toBe('4 live')
    // Under one Project the nested one is not shown apart: its Session stays in the open Project's list.
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    act(() => scope.setSidebarScope('project'))
    expect(screen.getAllByTestId('sidebar-session').map((row) => row.getAttribute('data-session-id'))).toEqual(['alpha-live-1', 'inner-live-1'])
  })

  it('a request older than SESSION_REQUEST_MS is not carried out', async () => {
    const request = await import('../../src/renderer/shell/session-request')
    expect(request.requestLive(1000, 1000 + request.SESSION_REQUEST_MS)).toBe(true)
    expect(request.requestLive(1000, 1001 + request.SESSION_REQUEST_MS)).toBe(false)
  })

  it('counts the busy Sessions of the Projects shown on the rail, in the tone of work; one Project counts its own', async () => {
    await mountSection('SessionsSection')
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    const { result } = renderHook(() => scope.useRailBadge('SessionsSection'))
    await waitFor(() => expect(result.current).toEqual({ tone: 'working', count: 2, label: '2 busy' }))
    act(() => scope.setSidebarScope('project'))
    expect(result.current).toEqual({ tone: 'working', count: 1, label: '1 busy' })
  })
})

describe('ADR under «All Projects»', () => {
  it("reads the other Projects' ADRs once each when the section comes into the panel, and lists them after the open Project's", async () => {
    await mountSection('AdrSection')
    await screen.findByText('Alpha first')
    // Not in the panel yet: nothing is read for the other Projects.
    expect(asked.filter((call) => call.channel === 'docs.adrs')).toEqual([])
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    act(() => scope.showSidebarSection('AdrSection'))
    await screen.findByText('Beta second')
    expect(asked.filter((call) => call.channel === 'docs.adrs').map((call) => call.input)).toEqual([{ projectId: BETA.id }, { projectId: GAMMA.id }])
    // Only the open Project is watched (docs.open); gamma has no ADRs and no group.
    expect(asked.filter((call) => call.channel === 'docs.open').map((call) => call.input)).toEqual([{ projectId: ALPHA.id }])
    expect(groups('sidebar-adr-project').map((group) => group.project)).toEqual([ALPHA.id, BETA.id])
    expect(screen.getByTestId('adr-count').textContent).toBe('3')
    expect(screen.getByTestId('sidebar-scope-label').textContent).toBe('All Projects')
  })

  it('a click on an ADR of another Project opens that Project, then the ADR', async () => {
    await mountSection('AdrSection')
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    act(() => scope.showSidebarSection('AdrSection'))
    const row = (await screen.findByText('Beta second')).closest('button')
    if (row === null) throw new Error('no row')
    expect(row.getAttribute('data-project')).toBe(BETA.id)
    await act(async () => {
      fireEvent.click(row)
    })
    expect(asked.filter((call) => call.channel === 'projects.select').map((call) => call.input)).toEqual([{ id: BETA.id }])
    // beta is open now, and its ADR panel shows the one clicked.
    await waitFor(() => expect(screen.getByTestId('adr-panel').getAttribute('data-path')).toBe('docs/adr/0002-x.md'))
  })

  it('under one Project reads nothing for the others', async () => {
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    scope.setSidebarScope('project')
    scope.showSidebarSection('AdrSection')
    await mountSection('AdrSection')
    await screen.findByText('Alpha first')
    expect(asked.filter((call) => call.channel === 'docs.adrs')).toEqual([])
    expect(groups('sidebar-adr-project').map((group) => group.project)).toEqual([ALPHA.id])
  })
})

describe('Project cards', () => {
  it('says each Project of the window’s Machine in two lines: name and branch, then its live state or «quiet»', async () => {
    await mountSection('ProjectsSection')
    await waitFor(() => expect(screen.getAllByTestId('project-pulse')).toHaveLength(3))
    const line = (id: string) => screen.getAllByTestId('project-row').find((row) => row.getAttribute('data-project-id') === id)?.querySelector('[data-testid="project-pulse"]')?.textContent
    expect(line(ALPHA.id)).toBe('1 busy·2 PR need you·1 waits')
    expect(line(BETA.id)).toBe('1 busy')
    expect(line(GAMMA.id)).toBe('quiet')
    // The open Project's card is the current one.
    const alpha = screen.getAllByTestId('project-row').find((row) => row.getAttribute('data-project-id') === ALPHA.id)
    expect(alpha?.querySelector('button')?.getAttribute('aria-current')).toBe('true')
  })

  it('words the parts as the prototype does, and leaves out what is unknown or zero', async () => {
    const { pulseParts } = await import('../../src/renderer/projects/useProjectPulse')
    expect(pulseParts({ busy: 2, prNeedYou: 3, waits: 1 }).map((part) => part.text)).toEqual(['2 busy', '3 PR need you', '1 waits'])
    expect(pulseParts({ busy: 0, prNeedYou: null, waits: null })).toEqual([])
    expect(pulseParts({ busy: 0, prNeedYou: 0, waits: 4 }).map((part) => [part.text, part.tone])).toEqual([['4 waits', 'needs']])
  })
})
