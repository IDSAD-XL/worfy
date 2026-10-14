// The checks badges on Tickets and Sessions (src/renderer/canvas/badges/ChecksBadges.tsx and use-checks.ts, ticket 17):
// what each subject shows from one `checks.get` snapshot, which Ticket branches the renderer asks
// about, and that it asks again only while the window has focus.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ChecksSnapshot, ProjectRepos } from '../../src/shared/ipc/checks'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const ROOT = '/Users/test/projects/demo'
const WT07 = `${ROOT}/.claude/worktrees/07`
const S7 = '77777777-0000-4000-8000-000000000007'
const SROOT = '88888888-0000-4000-8000-000000000008'

const ticket = (num: number, state: Ticket['state'], fromBranch: string | null = null): Ticket => ({
  epic: 'demo',
  num,
  slug: `t${num}`,
  title: `Ticket ${num}`,
  statusRaw: state,
  state,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch,
})

const tickets = [ticket(7, 'work', 'demo/07'), ticket(8, 'work'), ticket(9, 'open'), ticket(10, 'done')]
const MODEL: WorkflowModel = { root: ROOT, epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets, error: null, branchErrors: [] }
let model: WorkflowModel = MODEL

let snapshot: ChecksSnapshot
/** What checks.get answers for a folder other than ROOT; ROOT gets `snapshot`. */
let snapshotsByRoot: Record<string, ChecksSnapshot>
/** What checks.repos answers: one repository unless a test says otherwise. */
let repos: ProjectRepos
let checksCalls: unknown[]
let focused: boolean

beforeEach(() => {
  model = MODEL
  snapshotsByRoot = {}
  repos = { mode: 'full', repos: [{ name: 'demo', path: ROOT }] }
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  checksCalls = []
  focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  snapshot = {
    root: ROOT,
    worktrees: [
      { path: ROOT, branch: 'main', gate: { outcome: 'green', source: 'transcript', at: '2026-10-05T10:00:00.000Z' } },
      { path: WT07, branch: 'demo/07', gate: { outcome: 'red', source: 'marker', at: null } },
    ],
    pulls: [{ number: 31, url: 'https://github.com/o/r/pull/31', state: 'OPEN', branch: 'demo/08', ci: 'running', verdict: 'VERIFIED' }],
    gh: { available: true, error: null, intervalMs: 60_000 },
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      if (channel === 'checks.get') {
        checksCalls.push(input)
        const root = (input as { root: string }).root
        return Promise.resolve({ ok: true, value: snapshotsByRoot[root] ?? snapshot })
      }
      if (channel === 'checks.repos') return Promise.resolve({ ok: true, value: repos })
      if (channel === 'workflow.open') return Promise.resolve({ ok: true, value: model })
      if (channel === 'claudeHome.sessions')
        return Promise.resolve({
          ok: true,
          value: {
            live: [{ pid: 1, sessionId: S7, cwd: `${WT07}/src`, status: 'busy' }],
            history: [{ sessionId: SROOT, cwd: ROOT, size: 1, modifiedAt: 1, live: false }],
          },
        })
      if (channel === 'claudeHome.live') return Promise.resolve({ ok: true, value: { live: [] } })
      return Promise.resolve({ ok: true, value: { closed: true } })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function load() {
  const [badges, hook] = await Promise.all([import('../../src/renderer/canvas/badges/ChecksBadges'), import('../../src/renderer/canvas/badges/use-checks')])
  return { default: badges.default, POLL_MS: hook.POLL_MS }
}

const ticketSubject = (num: number) => ({ kind: 'ticket' as const, projectId: 'p', root: ROOT, ticket: tickets.find((each) => each.num === num)! })

describe('ChecksBadges on a Ticket', () => {
  it('shows the gate of the Ticket’s worktree: red on Ticket 07', async () => {
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={ticketSubject(7)} />)
    const gate = await screen.findByTestId('checks-gate')
    expect(gate.dataset.value).toBe('red')
    expect(gate.textContent).toBe('gate red')
    expect(gate.querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked')
    expect(screen.getByTestId('checks-badges').getAttribute('title')).toBe('gate red')
  })

  it('shows «PR #31», CI running and VERIFIED on Ticket 08', async () => {
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={ticketSubject(8)} />)
    expect((await screen.findByTestId('checks-pr')).textContent).toBe('PR #31')
    expect(screen.getByTestId('checks-ci').dataset.value).toBe('running')
    expect(screen.getByTestId('checks-ci').querySelector('[data-status]')?.getAttribute('data-status')).toBe('working')
    expect(screen.getByTestId('checks-verdict').textContent).toBe('VERIFIED')
    expect(screen.queryByTestId('checks-gate')).toBeNull()
    // The row may be cut at the Node's edge; its tooltip lists everything.
    expect(screen.getByTestId('checks-badges').getAttribute('title')).toBe('PR #31 open · CI running · VERIFIED')
  })

  it('asks about the branches of Tickets in work: the claimed branch, else <epic>/<NN>', async () => {
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={ticketSubject(9)} />)
    await vi.waitFor(() => expect(checksCalls.at(-1)).toEqual({ root: ROOT, branches: ['demo/07', 'demo/08'] }))
  })

  it('shows «gh unavailable» on Tickets in work, and nothing on an open Ticket without a worktree', async () => {
    snapshot = { ...snapshot, pulls: [], gh: { available: false, error: 'gh not found (gh)', intervalMs: 120_000 } }
    const { default: ChecksBadges } = await load()
    const { container } = render(
      <>
        <div data-testid="t8">
          <ChecksBadges subject={ticketSubject(8)} />
        </div>
        <div data-testid="t9">
          <ChecksBadges subject={ticketSubject(9)} />
        </div>
      </>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('t8').querySelector('[data-testid="checks-gh-unavailable"]')?.getAttribute('title')).toBe('gh not found (gh)'))
    expect(screen.getByTestId('t9').textContent).toBe('')
    expect(container.querySelectorAll('[data-testid="checks-gh-unavailable"]')).toHaveLength(1)
  })
})

describe('ChecksBadges by worktree folder', () => {
  const byFolder = () => {
    snapshot = { ...snapshot, worktrees: [snapshot.worktrees[0]!, { path: WT07, branch: 'feature-x', gate: { outcome: 'red', source: 'marker', at: null } }] }
  }

  it('shows the gate of .claude/worktrees/07 on branch feature-x on Ticket 07', async () => {
    byFolder()
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={ticketSubject(7)} />)
    expect((await screen.findByTestId('checks-gate')).dataset.value).toBe('red')
  })

  it('does not, when another Epic of the Project also has a Ticket 07', async () => {
    byFolder()
    model = { ...MODEL, epics: [...MODEL.epics, { epic: 'other', hasSpec: true, hasMap: false, title: 'Other' }], tickets: [...tickets, { ...ticket(7, 'open'), epic: 'other' }] }
    const { default: ChecksBadges } = await load()
    render(
      <>
        <ChecksBadges subject={ticketSubject(7)} />
        <ChecksBadges subject={ticketSubject(8)} />
      </>,
    )
    // Ticket 08's PR shows that the snapshot has arrived.
    await screen.findByTestId('checks-pr')
    expect(screen.queryByTestId('checks-gate')).toBeNull()
  })
})

describe('ChecksBadges in a Project over two repositories (worfy-harness ticket 23)', () => {
  const API = '/Users/test/projects/atakama/api'
  const WEB = '/Users/test/projects/atakama/web'
  const inRepo = (num: number, repo: string | null, branch: string | null): Ticket => ({ ...ticket(num, 'work'), epic: 'atakama', branch, repo })
  const silentTickets = [inRepo(5, 'api', 'fix/x'), inRepo(6, 'web', 'fix/y'), inRepo(7, null, 'fix/z')]
  const pullOn = (number: number, branch: string): ChecksSnapshot['pulls'][number] => ({ number, url: `https://github.com/o/r/pull/${number}`, state: 'OPEN', branch, ci: 'passing', verdict: null })
  const snap = (root: string, pulls: ChecksSnapshot['pulls']): ChecksSnapshot => ({ root, worktrees: [{ path: root, branch: 'main', gate: { outcome: 'green', source: 'marker', at: null } }], pulls, gh: { available: true, error: null, intervalMs: 60_000 } })
  const subject = (num: number) => ({ kind: 'ticket' as const, projectId: 'p', root: ROOT, ticket: silentTickets.find((each) => each.num === num)! })

  beforeEach(() => {
    model = { ...MODEL, epics: [{ epic: 'atakama', hasSpec: true, hasMap: false, title: 'Atakama' }], tickets: silentTickets }
    repos = {
      mode: 'silent',
      repos: [
        { name: 'api', path: API },
        { name: 'web', path: WEB },
      ],
    }
    // Both repositories have a PR on each branch: a Ticket must take only its own repository's.
    snapshotsByRoot = { [API]: snap(API, [pullOn(11, 'fix/x'), pullOn(12, 'fix/y')]), [WEB]: snap(WEB, [pullOn(21, 'fix/y'), pullOn(22, 'fix/x')]) }
    snapshot = snap(ROOT, [pullOn(99, 'fix/x'), pullOn(98, 'fix/y'), pullOn(97, 'fix/z')])
  })

  it('takes each Ticket\'s badges from the snapshot of its repository, asked with that repository\'s branches only', async () => {
    const { default: ChecksBadges } = await load()
    render(
      <>
        <div data-testid="t5">
          <ChecksBadges subject={subject(5)} />
        </div>
        <div data-testid="t6">
          <ChecksBadges subject={subject(6)} />
        </div>
      </>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('t5').querySelector('[data-testid="checks-pr"]')?.textContent).toBe('PR #11'))
    await vi.waitFor(() => expect(screen.getByTestId('t6').querySelector('[data-testid="checks-pr"]')?.textContent).toBe('PR #21'))
    const asked = checksCalls as { root: string; branches: string[] }[]
    expect(new Set(asked.map((each) => each.root))).toEqual(new Set([API, WEB]))
    for (const each of asked) expect(each.branches).toEqual(each.root === API ? ['fix/x'] : ['fix/y'])
  })

  it('a Ticket without a repository has no badges, and nothing is asked for it', async () => {
    const { default: ChecksBadges } = await load()
    render(
      <>
        <div data-testid="t7">
          <ChecksBadges subject={subject(7)} />
        </div>
        <div data-testid="t5">
          <ChecksBadges subject={subject(5)} />
        </div>
      </>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('t5').querySelector('[data-testid="checks-pr"]')).not.toBeNull())
    expect(screen.getByTestId('t7').textContent).toBe('')
    expect((checksCalls as { root: string }[]).map((each) => each.root)).not.toContain(ROOT)
  })

  it('with one repository the Project root is asked, as before', async () => {
    repos = { mode: 'silent', repos: [{ name: 'api', path: API }] }
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={subject(7)} />)
    expect((await screen.findByTestId('checks-pr')).textContent).toBe('PR #97')
    expect(new Set((checksCalls as { root: string }[]).map((each) => each.root))).toEqual(new Set([ROOT]))
  })
})

describe('ChecksBadges on a Session', () => {
  it('shows the gate of the worktree the Session runs in', async () => {
    const { default: ChecksBadges } = await load()
    render(
      <>
        <div data-testid="s7">
          <ChecksBadges subject={{ kind: 'session', projectId: 'p', root: ROOT, sessionId: S7 }} />
        </div>
        <div data-testid="sroot">
          <ChecksBadges subject={{ kind: 'session', projectId: 'p', root: ROOT, sessionId: SROOT }} />
        </div>
      </>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('s7').querySelector('[data-testid="checks-gate"]')?.getAttribute('data-value')).toBe('red'))
    await vi.waitFor(() => expect(screen.getByTestId('sroot').querySelector('[data-testid="checks-gate"]')?.getAttribute('data-value')).toBe('green'))
  })
})

describe('when the renderer asks', () => {
  it('asks every POLL_MS only while the window has focus, and at once when it gets focus', async () => {
    const { default: ChecksBadges, POLL_MS } = await load()
    render(<ChecksBadges subject={ticketSubject(7)} />)
    await screen.findByTestId('checks-gate')
    await act(async () => await vi.advanceTimersByTimeAsync(0))
    const start = checksCalls.length

    focused = false
    await act(async () => await vi.advanceTimersByTimeAsync(POLL_MS * 3))
    expect(checksCalls.length).toBe(start)

    focused = true
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(checksCalls.length).toBe(start + 1)

    await act(async () => await vi.advanceTimersByTimeAsync(POLL_MS))
    expect(checksCalls.length).toBe(start + 2)
  })

  it('stops asking when the last badge of the Project is gone', async () => {
    const { default: ChecksBadges, POLL_MS } = await load()
    const view = render(<ChecksBadges subject={ticketSubject(7)} />)
    await screen.findByTestId('checks-gate')
    view.unmount()
    const after = checksCalls.length
    await act(async () => await vi.advanceTimersByTimeAsync(POLL_MS * 2))
    expect(checksCalls.length).toBe(after)
  })
})

describe('branchesInWork', () => {
  const inEpic = (epic: string, num: number, state: Ticket['state'], fromBranch: string | null = null): Ticket => ({ ...ticket(num, state, fromBranch), epic })

  it('takes Tickets in work and Tickets claimed in a branch, whatever their state', async () => {
    const { branchesInWork } = await import('../../src/renderer/canvas/badges/use-checks')
    const branches = branchesInWork([ticket(7, 'work', 'demo/07'), ticket(8, 'work'), ticket(9, 'open'), ticket(10, 'done'), ticket(11, 'done', 'demo/11-fix'), ticket(12, 'open', 'demo/12')])
    expect(branches).toEqual(['demo/07', 'demo/08', 'demo/11-fix', 'demo/12'])
  })

  it('leaves out branches checks.get would refuse, so one odd Epic name does not cost the Project its badges', async () => {
    const { branchesInWork } = await import('../../src/renderer/canvas/badges/use-checks')
    const { checksGet } = await import('../../src/shared/ipc/checks')
    const branches = branchesInWork([inEpic('аудит', 3, 'work'), inEpic('Q4 work', 5, 'work'), ticket(8, 'work')])
    expect(branches).toEqual(['demo/08'])
    expect(checksGet.input.safeParse({ root: ROOT, branches }).success).toBe(true)
  })

  it('takes the branch a Ticket\'s Branch: line names (Silent mode), but not one checks.get would refuse', async () => {
    const { branchesInWork } = await import('../../src/renderer/canvas/badges/use-checks')
    const { checksGet } = await import('../../src/shared/ipc/checks')
    const named = (num: number, branch: string, state: Ticket['state'] = 'work'): Ticket => ({ ...ticket(num, state), branch })
    const branches = branchesInWork([named(5, 'fix/x'), named(6, 'аудит/ветка'), named(7, 'fix y'), named(8, '-x'), named(9, 'fix/open', 'open'), { ...inEpic('аудит', 3, 'work'), branch: null }])
    expect(branches).toEqual(['fix/x', 'аудит/ветка'])
    expect(checksGet.input.safeParse({ root: ROOT, branches }).success).toBe(true)
  })
})

describe('the root checks.get and checks.repos take (worfy-windows ticket 03)', () => {
  it('is an absolute path of macOS or of Windows, and nothing relative', async () => {
    const { checksGet, checksRepos } = await import('../../src/shared/ipc/checks')
    for (const root of [ROOT, '/', 'C:\\a', 'C:/a', 'c:\\Users\\x\\worfy', '\\\\srv\\share\\a']) {
      expect(checksGet.input.safeParse({ root, branches: [] }).success, root).toBe(true)
      expect(checksRepos.input.safeParse({ root }).success, root).toBe(true)
    }
    for (const root of ['a\\b', 'C:a', 'a/b', '\\a', '', '/a\0b', 'C:\\a\0']) {
      expect(checksGet.input.safeParse({ root, branches: [] }).success, root).toBe(false)
      expect(checksRepos.input.safeParse({ root }).success, root).toBe(false)
    }
  })
})
