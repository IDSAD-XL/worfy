// The Stable copy line of an Acceptance item (worfy-acceptance ticket 02, src/main/acceptance/stable-line.ts): whether the
// change of a Ticket is in the owner's Stable copy, in words with version numbers, for a Project whose repository is
// worfy's own; "merged #N" or "not merged" for any other Project, which has no Stable copy. git and gh are stand-ins
// here: a git that answers from a table of commits, and a gh that answers `pr view` and `pr list` from a table of PRs.
import { describe, expect, it, vi } from 'vitest'
import { isWorfyRepo, RETRY_MS, StableLine, type StableLineSources, type StableProject } from '../../src/main/acceptance/stable-line'
import type { AcceptanceStable } from '../../src/shared/ipc/acceptance'
import { UPDATE_REPO_PAGE, type AvailableUpdate } from '../../src/shared/ipc/update'
import type { Ticket } from '../../src/shared/workflow/types'

const sha = (digit: string): string => digit.repeat(40)
const MERGE = sha('a')
const BLOCKER_MERGE = sha('b')
const STABLE = sha('c')
const UNKNOWN = sha('d')

/** Each commit of the stand-in clone: its number (`rev-list --count`) and the version of its package.json. */
const COMMITS = new Map([
  [MERGE, { count: 2093, version: '0.4.0' }],
  [BLOCKER_MERGE, { count: 2088, version: '0.4.0' }],
  [STABLE, { count: 2101, version: '0.4.0' }],
])

interface Clone {
  /** `merge-base --is-ancestor <a> <b>` answers 0 for these pairs `a b`, 1 for the other pairs of known commits. */
  ancestors: Set<string>
}

function git(clone: Clone, calls: string[]): NonNullable<StableLineSources['git']> {
  return async (_cwd, args) => {
    calls.push(args.join(' '))
    const [command, ...rest] = args
    if (command === 'merge-base') {
      const [, a, b] = rest
      if (!COMMITS.has(a!) || !COMMITS.has(b!)) return { code: 128, stdout: '' }
      return { code: clone.ancestors.has(`${a} ${b}`) ? 0 : 1, stdout: '' }
    }
    if (command === 'cat-file') return { code: COMMITS.has(rest[1]!.replace('^{commit}', '')) ? 0 : 128, stdout: '' }
    if (command === 'rev-list') {
      const commit = COMMITS.get(rest[1]!)
      return commit ? { code: 0, stdout: `${commit.count}\n` } : { code: 128, stdout: '' }
    }
    if (command === 'show') {
      const commit = COMMITS.get(rest[0]!.replace(':package.json', ''))
      return commit ? { code: 0, stdout: JSON.stringify({ name: 'worfy', version: commit.version }) } : { code: 128, stdout: '' }
    }
    return { code: 1, stdout: '' }
  }
}

interface Pr {
  number: number
  head: string
  merge: string | null
}

function gh(prs: Pr[], calls: string[], refuse = false): StableLineSources['gh'] {
  return async (_root, args) => {
    calls.push(args.join(' '))
    if (refuse) throw new Error('HTTP 403: API rate limit exceeded')
    const view = (pr: Pr) => ({ number: pr.number, state: pr.merge === null ? 'OPEN' : 'MERGED', mergeCommit: pr.merge === null ? null : { oid: pr.merge } })
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = prs.find((each) => each.number === Number(args[2]))
      if (!pr) throw new Error('no pull requests found')
      return JSON.stringify(view(pr))
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      const head = args[args.indexOf('--head') + 1]
      return JSON.stringify(prs.filter((pr) => pr.head === head && pr.merge !== null).map(view))
    }
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
}

const ticket = (num: number, extra: Partial<Ticket> = {}): Ticket => ({
  epic: 'demo',
  num,
  slug: `t${num}`,
  title: `ticket ${num}`,
  statusRaw: 'done',
  state: 'done',
  statusAt: '2026-11-22T10:00Z',
  waits: null,
  blockedReason: null,
  pr: null,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  evidence: [],
  ...extra,
})

const worfy = (tickets: Ticket[]): StableProject => ({ projectId: 'worfy-1', root: '/repo', repoUrl: UPDATE_REPO_PAGE, tickets })

interface Setup {
  prs?: Pr[]
  ancestors?: string[]
  stable?: string | null
  available?: AvailableUpdate | null
  refuse?: boolean
  /** Now, in ms; Date.now by default. */
  now?: () => number
}

function setup({ prs = [], ancestors = [], stable = STABLE, available = null, refuse = false, now = Date.now }: Setup = {}) {
  const gitCalls: string[] = []
  const ghCalls: string[] = []
  const changed = vi.fn()
  const line = new StableLine(
    {
      gh: gh(prs, ghCalls, refuse),
      git: git({ ancestors: new Set(ancestors) }, gitCalls),
      stableCommit: () => stable,
      available: () => available,
      now,
    },
    changed,
  )
  /** The line of `t` once every answer it needs has come. */
  const answer = async (project: StableProject, t: Ticket): Promise<AcceptanceStable> => {
    let got: AcceptanceStable | null = null
    await vi.waitFor(() => {
      got = line.line(project, t)
      expect(got).not.toBeNull()
    })
    return got!
  }
  return { line, answer, gitCalls, ghCalls, changed }
}

describe('the Stable copy line', () => {
  it('names the version of the Stable copy and the first version with the change, numbered by the count of commits', async () => {
    const { answer, changed } = setup({ prs: [{ number: 42, head: 'demo/01', merge: MERGE }], ancestors: [`${MERGE} ${STABLE}`] })
    const t = ticket(1, { pr: 42 })
    expect(await answer(worfy([t]), t)).toEqual({ state: 'in', text: 'In your Stable copy 0.4.2101 — the change is there since 0.4.2093', update: null })
    expect(changed).toHaveBeenCalled()
  })

  it('says the change is not in the Stable copy yet, with Update worfy when an Available update has it', async () => {
    const t = ticket(1, { pr: 42 })
    const prs = [{ number: 42, head: 'demo/01', merge: MERGE }]
    const later: AvailableUpdate = { sha: sha('e').slice(0, 40), version: '0.4.0+eeeeeee', quiet: false, number: 2110 }
    expect(await setup({ prs, available: later }).answer(worfy([t]), t)).toEqual({
      state: 'out',
      text: 'Not in your Stable copy yet: it runs 0.4.2101, the change is in 0.4.2093',
      update: 'available',
    })
    // No Available update, or one older than the change: `main` waits for a green CI.
    expect((await setup({ prs }).answer(worfy([t]), t)).update).toBe('waits-ci')
    expect((await setup({ prs, available: { ...later, number: 2090 } }).answer(worfy([t]), t)).update).toBe('waits-ci')
    // An Available update without a number is taken to have it.
    expect((await setup({ prs, available: { sha: later.sha, version: later.version, quiet: false } }).answer(worfy([t]), t)).update).toBe('available')
  })

  it('says "Stable copy not checked" when a commit is not in the checkout, there is no Stable copy, or GitHub refuses', async () => {
    const t = ticket(1, { pr: 42 })
    const missingStable = await setup({ prs: [{ number: 42, head: 'demo/01', merge: MERGE }], stable: UNKNOWN }).answer(worfy([t]), t)
    expect(missingStable).toEqual({ state: 'not-checked', text: `Stable copy not checked: its commit ${UNKNOWN.slice(0, 7)} is not in this checkout`, update: null })
    const missingMerge = await setup({ prs: [{ number: 42, head: 'demo/01', merge: UNKNOWN }] }).answer(worfy([t]), t)
    expect(missingMerge.text).toBe(`Stable copy not checked: the merge commit ${UNKNOWN.slice(0, 7)} is not in this checkout`)
    const none = setup({ prs: [{ number: 42, head: 'demo/01', merge: MERGE }], stable: null })
    expect(await none.answer(worfy([t]), t)).toEqual({ state: 'not-checked', text: 'Stable copy not checked: no Stable copy found', update: null })
    // Without a Stable copy there is nothing to compare: gh is not asked.
    expect(none.ghCalls).toEqual([])
    expect((await setup({ prs: [{ number: 42, head: 'demo/01', merge: MERGE }], refuse: true }).answer(worfy([t]), t)).text).toBe(
      'Stable copy not checked: GitHub did not answer',
    )
  })

  it('asks gh once per merged PR, and finds the PR of a Ticket without a `PR:` line by its branch', async () => {
    let now = Date.parse('2026-11-24T10:00:00Z')
    const { line, answer, ghCalls } = setup({ prs: [{ number: 7, head: 'demo/01', merge: MERGE }], ancestors: [`${MERGE} ${STABLE}`], now: () => now })
    const t = ticket(1)
    expect((await answer(worfy([t]), t)).state).toBe('in')
    expect(ghCalls).toEqual(['pr list --head demo/01 --state merged --json number,state,mergeCommit --limit 1'])
    line.line(worfy([t]), t)
    // A merged PR's merge commit does not change: it is kept for good, not only for RETRY_MS.
    now += 2 * RETRY_MS
    line.line(worfy([t]), t)
    expect(ghCalls).toHaveLength(1)
  })

  it('asks again RETRY_MS after GitHub refused, and keeps the old line meanwhile', async () => {
    let now = Date.parse('2026-11-24T10:00:00Z')
    const { line, answer, ghCalls } = setup({ prs: [{ number: 42, head: 'demo/01', merge: MERGE }], refuse: true, now: () => now })
    const t = ticket(1, { pr: 42 })
    expect((await answer(worfy([t]), t)).state).toBe('not-checked')
    line.line(worfy([t]), t)
    expect(ghCalls).toHaveLength(1)
    now += RETRY_MS
    expect(line.line(worfy([t]), t)?.state).toBe('not-checked')
    expect(ghCalls).toHaveLength(2)
  })

  it('takes the merges of the blockers of a Ticket that waits for the owner without a PR of its own', async () => {
    const blocker = ticket(1, { pr: 41 })
    const acceptance = ticket(3, { state: 'blocked', statusRaw: 'blocked', waits: 'owner', blockedNums: [1, 2] })
    const open = ticket(2, { state: 'work', statusRaw: 'claimed' })
    const { answer, ghCalls } = setup({ prs: [{ number: 41, head: 'demo/01', merge: BLOCKER_MERGE }], ancestors: [`${BLOCKER_MERGE} ${STABLE}`] })
    expect(await answer(worfy([blocker, open, acceptance]), acceptance)).toEqual({
      state: 'in',
      text: 'In your Stable copy 0.4.2101 — the change is there since 0.4.2088',
      update: null,
    })
    // A blocker not merged yet has no merge to ask for.
    expect(ghCalls).toEqual(['pr view 41 --json number,state,mergeCommit'])
  })

  it('gives "merged #N" or "not merged" for a Project that is not worfy, with no gh or git', () => {
    const { line, gitCalls, ghCalls } = setup()
    const other: StableProject = { projectId: 'other-1', root: '/other', repoUrl: 'https://github.com/someone/else', tickets: [] }
    expect(line.line(other, ticket(1, { pr: 5 }))).toEqual({ state: 'merged', text: 'merged #5', update: null })
    expect(line.line(other, ticket(2))).toEqual({ state: 'merged', text: 'merged', update: null })
    expect(line.line(other, ticket(3, { state: 'blocked', statusRaw: 'blocked', waits: 'owner' }))).toEqual({ state: 'not-merged', text: 'not merged', update: null })
    expect(line.line({ ...other, repoUrl: null }, ticket(4, { state: 'done', fromBranch: 'demo/04' }))?.text).toBe('not merged')
    expect([...gitCalls, ...ghCalls]).toEqual([])
  })

  it('knows worfy\'s repository by its page, in any case and with a trailing slash', () => {
    expect(isWorfyRepo(UPDATE_REPO_PAGE)).toBe(true)
    expect(isWorfyRepo(`${UPDATE_REPO_PAGE.toUpperCase()}/`)).toBe(true)
    expect(isWorfyRepo('https://github.com/IDSAD-XL/worfy-windows')).toBe(false)
    expect(isWorfyRepo(null)).toBe(false)
    expect(isWorfyRepo(undefined)).toBe(false)
  })
})
