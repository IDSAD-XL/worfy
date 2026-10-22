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
/** What workflow.open and checks.repos answer for a Project root other than ROOT, when a test sets them. */
let modelsByRoot: Record<string, WorkflowModel>
let reposByRoot: Record<string, ProjectRepos>
/** What checks.get answers by the Project that asks, before `snapshotsByRoot`. */
let snapshotsByProject: Record<string, ChecksSnapshot>
let checksCalls: unknown[]
let focused: boolean

beforeEach(() => {
  model = MODEL
  snapshotsByRoot = {}
  modelsByRoot = {}
  reposByRoot = {}
  snapshotsByProject = {}
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
        const { root, project } = input as { root: string; project?: string }
        return Promise.resolve({ ok: true, value: (project === undefined ? undefined : snapshotsByProject[project]) ?? snapshotsByRoot[root] ?? snapshot })
      }
      const asked = (input as { root?: string } | undefined)?.root ?? ''
      if (channel === 'checks.repos') return Promise.resolve({ ok: true, value: reposByRoot[asked] ?? repos })
      if (channel === 'workflow.open') return Promise.resolve({ ok: true, value: modelsByRoot[asked] ?? model })
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
    // The verdict is the review mark on the head commit (worfy-pipeline ticket 05), and its tooltip says so.
    expect(screen.getByTestId('checks-verdict').getAttribute('title')).toBe("VERIFIED — the review mark on the PR's head commit")
  })

  it('REJECTED from a failed review mark is a blocked chip; a PR without a verdict (no mark, or pending) has no verdict chip', async () => {
    snapshot = { ...snapshot, pulls: [{ ...snapshot.pulls[0]!, verdict: 'REJECTED' }] }
    const { default: ChecksBadges } = await load()
    const { unmount } = render(<ChecksBadges subject={ticketSubject(8)} />)
    const verdict = await screen.findByTestId('checks-verdict')
    expect(verdict.textContent).toBe('REJECTED')
    expect(verdict.querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked')
    unmount()

    snapshot = { ...snapshot, pulls: [{ ...snapshot.pulls[0]!, verdict: null }] }
    vi.resetModules()
    const fresh = await load()
    render(<fresh.default subject={ticketSubject(8)} />)
    expect((await screen.findByTestId('checks-pr')).textContent).toBe('PR #31')
    expect(screen.queryByTestId('checks-verdict')).toBeNull()
    expect(screen.getByTestId('checks-badges').getAttribute('title')).toBe('PR #31 open · CI running')
  })

  it('asks about the branches of Tickets in work: the claimed branch, else <epic>/<NN>', async () => {
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={ticketSubject(9)} />)
    await vi.waitFor(() => expect(checksCalls.at(-1)).toEqual({ root: ROOT, branches: ['demo/07', 'demo/08'], project: ROOT }))
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

describe('ChecksBadges when a repository of a Project is also a Project of its own', () => {
  // Project M over the repositories b and c; b is also added to worfy as Project B.
  const M = '/Users/test/projects/m'
  const B = '/Users/test/projects/b'
  const C = '/Users/test/projects/c'
  const inRepo = (num: number, epic: string, repo: string | null, branch: string): Ticket => ({ ...ticket(num, 'work'), epic, branch, repo })
  const mTicket = inRepo(5, 'm', 'b', 'fix/x')
  const bTicket = inRepo(1, 'own', null, 'own/b')
  const pullOn = (number: number, branch: string): ChecksSnapshot['pulls'][number] => ({ number, url: `https://github.com/o/r/pull/${number}`, state: 'OPEN', branch, ci: 'passing', verdict: null })
  const snap = (pulls: ChecksSnapshot['pulls']): ChecksSnapshot => ({ root: B, worktrees: [{ path: B, branch: 'main', gate: { outcome: 'green', source: 'marker', at: null } }], pulls, gh: { available: true, error: null, intervalMs: 60_000 } })

  beforeEach(() => {
    modelsByRoot = {
      [M]: { root: M, epics: [{ epic: 'm', hasSpec: true, hasMap: false, title: 'M' }], tickets: [mTicket], error: null, branchErrors: [] },
      [B]: { root: B, epics: [{ epic: 'own', hasSpec: true, hasMap: false, title: 'B' }], tickets: [bTicket], error: null, branchErrors: [] },
    }
    reposByRoot = {
      [M]: {
        mode: 'silent',
        repos: [
          { name: 'b', path: B },
          { name: 'c', path: C },
        ],
      },
      [B]: { mode: 'full', repos: [] },
    }
    // main answers each Project with its own Tickets' PRs in the same folder.
    snapshotsByProject = { [M]: snap([pullOn(11, 'fix/x')]), [B]: snap([pullOn(41, 'own/b')]) }
  })

  it('two Canvases ask about the same folder each with its own Project, and keep their own branches and badges', async () => {
    const { default: ChecksBadges, POLL_MS } = await load()
    render(
      <>
        <div data-testid="m5">
          <ChecksBadges subject={{ kind: 'ticket', projectId: 'm', root: M, ticket: mTicket }} />
        </div>
        <div data-testid="b1">
          <ChecksBadges subject={{ kind: 'ticket', projectId: 'b', root: B, ticket: bTicket }} />
        </div>
      </>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('m5').querySelector('[data-testid="checks-pr"]')?.textContent).toBe('PR #11'))
    await vi.waitFor(() => expect(screen.getByTestId('b1').querySelector('[data-testid="checks-pr"]')?.textContent).toBe('PR #41'))
    await act(async () => await vi.advanceTimersByTimeAsync(POLL_MS * 2))
    const asked = checksCalls as { root: string; branches: string[]; project?: string }[]
    expect(asked.every((each) => each.root === B)).toBe(true)
    expect(new Set(asked.map((each) => each.project))).toEqual(new Set([M, B]))
    // Each Canvas's list of branches stays its own on every ask, the timer's included.
    for (const each of asked) expect(each.branches).toEqual(each.project === M ? ['fix/x'] : ['own/b'])
    expect(asked.filter((each) => each.project === M).length).toBeGreaterThanOrEqual(3)
    expect(asked.filter((each) => each.project === B).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByTestId('m5').querySelector('[data-testid="checks-pr"]')?.textContent).toBe('PR #11')
    expect(screen.getByTestId('b1').querySelector('[data-testid="checks-pr"]')?.textContent).toBe('PR #41')
  })

  it('sends the Project root as `project` when it asks about the root itself', async () => {
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={ticketSubject(8)} />)
    await screen.findByTestId('checks-pr')
    expect(checksCalls.length).toBeGreaterThan(0)
    for (const each of checksCalls as { root: string; project?: string }[]) expect(each).toMatchObject({ root: ROOT, project: ROOT })
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

// worfy-windows ticket 61: a worktree inside %TEMP% of Windows carries the sign of the Folder step, with a tooltip.
describe('a worktree inside %TEMP%', () => {
  const inTemp = () => {
    snapshot = { ...snapshot, worktrees: [snapshot.worktrees[0]!, { ...snapshot.worktrees[1]!, insideTemp: true }] }
  }

  it('is marked on its Ticket and its Session, with the reason and the path in the tooltip; the checkout outside is not', async () => {
    inTemp()
    const { default: ChecksBadges } = await load()
    render(
      <>
        <div data-testid="t7">
          <ChecksBadges subject={ticketSubject(7)} />
        </div>
        <div data-testid="s7">
          <ChecksBadges subject={{ kind: 'session', projectId: 'p', root: ROOT, sessionId: S7 }} />
        </div>
        <div data-testid="sroot">
          <ChecksBadges subject={{ kind: 'session', projectId: 'p', root: ROOT, sessionId: SROOT }} />
        </div>
      </>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('sroot').querySelector('[data-testid="checks-gate"]')).not.toBeNull())
    for (const holder of ['t7', 's7']) {
      const sign = screen.getByTestId(holder).querySelector<HTMLElement>('[data-testid="checks-temp"]')
      expect(sign?.textContent).toBe('in %TEMP%')
      expect(sign?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('working')
      expect(sign?.getAttribute('title')).toContain('Storage Sense may delete files from it')
      expect(sign?.getAttribute('title')).toContain(WT07)
    }
    expect(screen.getByTestId('t7').querySelector('[data-testid="checks-badges"]')?.getAttribute('title')).toBe('gate red · in %TEMP%')
    expect(screen.getByTestId('sroot').querySelector('[data-testid="checks-temp"]')).toBeNull()
  })

  it('no worktree marked: no sign anywhere', async () => {
    const { default: ChecksBadges } = await load()
    render(<ChecksBadges subject={ticketSubject(7)} />)
    await screen.findByTestId('checks-gate')
    expect(screen.queryByTestId('checks-temp')).toBeNull()
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
