// The Stage of each Ticket computed in main (worfy-pipeline ticket 03, ADR-0067), against a
// temporary git repository, the stub epic-status of test/fixtures/workflow-stub watched by the real
// WorkflowHub, and a stub gh: an in-test GhRunner that answers `pr list` from a list of PRs the test
// changes, the Deployments of an environment and the deploy marks of the default branch. Nothing
// reaches GitHub; the Harness home is a temporary folder.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeploymentReader } from '../../src/main/github/deployments'
import { PrTracker, type GhRunner } from '../../src/main/github/prs'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { pipelineHandlers } from '../../src/main/ipc/pipeline'
import { markFilePath } from '../../src/main/workflow/marks'
import { readPipelineProfile, type PipelineProfile } from '../../src/main/workflow/profile'
import { readE2eLock, StageHub, StageReader, type StageSources } from '../../src/main/workflow/stages'
import { WorkflowHub } from '../../src/main/workflow/watch'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import { DEFAULT_PIPELINE, type PipelineStage } from '../../src/shared/workflow/pipeline'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { ms } from '../time-scale'

const WORKFLOW_STUB = join(__dirname, '..', 'fixtures', 'workflow-stub')
const ownEnv = (): Promise<NodeJS.ProcessEnv> => Promise.resolve(process.env)

const WORFY: PipelineStage[] = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'ci' },
  { kind: 'agent-review' },
  { kind: 'check', name: 'windows' },
  { kind: 'gate-merge' },
  { kind: 'deploy', environment: 'production' },
  { kind: 'closing' },
  { kind: 'done' },
]
const ATAKAMA: PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'agent-review' }, { kind: 'ci' }, { kind: 'human-review' }, { kind: 'awaiting-merge' }, { kind: 'done' }]

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
}

function ticketText(num: number, status: string, extra: string[] = []): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, ...extra, 'Blocked by: —', '', '## Что делаем', '', 'text', ''].join('\n')
}

/** Every file under `dir` with its size, mtime and content hash, `.git` included. */
function treeState(dir: string): Map<string, string> {
  const state = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const stats = statSync(path)
        state.set(path, `${stats.size}:${stats.mtimeMs}:${createHash('sha1').update(readFileSync(path)).digest('hex')}`)
      }
    }
  }
  walk(dir)
  return state
}

interface World {
  repo: string
  home: string
  harnessHome: string
  lock: string
  /** main: A (the Epic) → B → C → D. */
  commits: { A: string; B: string; C: string; D: string }
}

let dir: string
let cleanups: (() => Promise<void>)[]

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-stages-')))
  cleanups = []
})

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The repository of Epic `demo`: Tickets 01 done, 02 open, 03–06 claimed; branches demo/02 … demo/06 at main. */
function makeWorld(): World {
  const repo = join(dir, 'project')
  const issues = join(repo, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# Demo epic\n')
  writeFileSync(join(issues, '01-first.md'), ticketText(1, 'done 2026-10-16T08:00Z'))
  writeFileSync(join(issues, '02-second.md'), ticketText(2, 'open'))
  writeFileSync(join(issues, '03-third.md'), ticketText(3, 'claimed 2026-10-17T09:00Z'))
  writeFileSync(join(issues, '04-fourth.md'), ticketText(4, 'claimed 2026-10-17T09:00Z'))
  writeFileSync(join(issues, '05-fifth.md'), ticketText(5, 'claimed 2026-10-17T09:00Z'))
  writeFileSync(join(issues, '06-sixth.md'), ticketText(6, 'claimed 2026-10-17T09:00Z'))
  git(dir, 'init', '-q', '-b', 'main', repo)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'epic')
  const A = git(repo, 'rev-parse', 'HEAD')
  const step = (name: string) => {
    writeFileSync(join(repo, `${name}.txt`), name)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', name)
    return git(repo, 'rev-parse', 'HEAD')
  }
  const B = step('b')
  const C = step('c')
  const D = step('d')
  for (const n of ['02', '03', '04', '05', '06']) git(repo, 'branch', `demo/${n}`, A)

  const home = join(dir, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  symlinkSync(join(WORKFLOW_STUB, 'epic-status'), join(home, 'bin', 'epic-status'))
  const log = join(dir, 'stub-calls.log')
  writeFileSync(log, '')
  process.env.STUB_LOG = log
  const harnessHome = join(dir, 'harness-home')
  mkdirSync(harnessHome)
  return { repo, home, harnessHome, lock: join(dir, 'e2e.lock'), commits: { A, B, C, D } }
}

interface StubPull {
  number: number
  headRefName: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  url: string
  statusCheckRollup: unknown[]
  comments: unknown[]
  headRefOid?: string
  reviewDecision?: string
  mergeCommit?: { oid: string }
  mergedAt?: string
}

const pr = (number: number, branch: string, extra: Partial<StubPull> = {}): StubPull => ({
  number,
  headRefName: branch,
  state: 'OPEN',
  url: `https://github.com/o/r/pull/${number}`,
  statusCheckRollup: [],
  comments: [],
  ...extra,
})
const run = (name: string, conclusion: string) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion, startedAt: '2026-10-17T10:00:00Z', completedAt: '2026-10-17T10:05:00Z' })
const status = (context: string, state: string) => ({ __typename: 'StatusContext', context, state, startedAt: '2026-10-17T11:00:00Z' })

/** The stub gh: `pr list` over `pulls`, Deployments of `production`, the deploy marks of the default branch; every call logged. */
function stubGh(world: { pulls: StubPull[]; deployments: { sha: string; created_at: string }[]; deployMarks: string[] }) {
  const calls: string[][] = []
  const gh: GhRunner = async (args) => {
    calls.push([...args])
    if (args[0] === 'pr' && args[1] === 'list') {
      const head = args.indexOf('--head')
      return JSON.stringify(head === -1 ? world.pulls : world.pulls.filter((pull) => pull.headRefName === args[head + 1]))
    }
    if (args[0] === 'api' && args[1] === 'repos/o/r/deployments?environment=production&per_page=30') return JSON.stringify(world.deployments)
    if (args[0] === 'api' && args[1] === 'graphql') {
      const nodes = world.deployMarks.map((oid) => ({ oid, status: { context: { state: 'SUCCESS', createdAt: '2026-10-17T14:00:00Z' } } }))
      return JSON.stringify({ data: { repository: { defaultBranchRef: { target: { history: { nodes } } } } } })
    }
    throw new Error(`stub gh: unexpected call ${args.join(' ')}`)
  }
  return { gh, calls, world }
}

function hubOver(world: World, profile: PipelineProfile, gh: GhRunner, logs: string[] = []): { hub: StageHub; workflow: WorkflowHub } {
  const workflow = new WorkflowHub({ claudeHome: world.home, env: ownEnv })
  const prs = new PrTracker({ run: gh, baseIntervalMs: 20 })
  const sources: StageSources = {
    workflow,
    prs,
    profile: async () => ({ ok: true, profile }),
    deployments: new DeploymentReader({ gh: (root, args) => prs.gh(root, args), intervalMs: 20 }),
    harnessHome: world.harnessHome,
    intervalMs: 30,
    log: (line) => logs.push(line),
  }
  const hub = new StageHub(sources)
  cleanups.push(async () => {
    await hub.closeAll()
    await workflow.closeAll()
  })
  return { hub, workflow }
}

const ticket = (snapshot: PipelineSnapshot, num: number): PipelineTicket => {
  const found = snapshot.tickets.find((each) => each.epic === 'demo' && each.num === num)
  if (!found) throw new Error(`no Ticket ${num} in ${JSON.stringify(snapshot.tickets)}`)
  return found
}

/** Resolves with the next snapshot sent for which `match` holds, or rejects after `ms`. */
function nextSnapshot(sent: PipelineSnapshot[], match: (snapshot: PipelineSnapshot) => boolean, limit = 8000): Promise<PipelineSnapshot> {
  const wait = ms(limit)
  const start = sent.length
  return new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + wait
    const poll = () => {
      const found = sent.slice(start).find(match)
      if (found) return resolvePromise(found)
      if (Date.now() > deadline) return reject(new Error(`no matching pipeline.changed within ${wait} ms; last: ${JSON.stringify(sent.at(-1)?.tickets ?? null)}`))
      setTimeout(poll, 10)
    }
    poll()
  })
}

const fullProfile = (world: World, pipeline: PipelineStage[] = WORFY, finish: PipelineProfile['finish'] = 'pr-green-ci'): PipelineProfile => ({
  name: 'demo-project',
  mode: 'full',
  finish,
  pipeline,
  pipelineReason: null,
  e2eLock: world.lock,
  repos: [],
})

describe('Stages in Full mode', () => {
  it('PR, CI, commit status marks, the e2e lock and a Deployment give each Ticket its Stage; pipeline.changed follows a Ticket file edit and a PR read', async () => {
    const world = makeWorld()
    const { B, C, D } = world.commits
    const HEAD3 = 'e'.repeat(40)
    const HEAD6 = 'f'.repeat(40)
    const gh = stubGh({
      pulls: [
        pr(3, 'demo/03', { headRefOid: HEAD3, statusCheckRollup: [run('check', 'SUCCESS'), status('review', 'SUCCESS'), status('check/windows', 'SUCCESS')] }),
        pr(4, 'demo/04', { state: 'MERGED', headRefOid: HEAD3, mergeCommit: { oid: B }, mergedAt: '2026-10-17T12:00:00Z' }),
        pr(5, 'demo/05', { state: 'MERGED', headRefOid: HEAD3, mergeCommit: { oid: D }, mergedAt: '2026-10-17T13:00:00Z' }),
        pr(6, 'demo/06', { headRefOid: HEAD6, statusCheckRollup: [run('check', 'SUCCESS'), status('review', 'FAILURE')] }),
      ],
      deployments: [{ sha: C, created_at: '2026-10-17T14:00:00Z' }],
      deployMarks: [],
    })
    mkdirSync(world.lock)
    writeFileSync(join(world.lock, 'holder.json'), JSON.stringify({ prs: [3], what: 'gate-full', pid: 1, since: '2026-10-17T12:00:00Z' }))
    const { hub } = hubOver(world, fullProfile(world), gh.gh)
    const sent: PipelineSnapshot[] = []
    const first = await hub.open(world.repo, { id: 1, send: (snapshot) => sent.push(snapshot) })

    expect(first.pipeline.map((column) => column.title)).toEqual(['Queued', 'Implementing', 'CI', 'Agent review', 'Check «windows»', 'Gate & merge', 'Deploy', 'Closing', 'Done'])
    expect(first.error).toBeNull()
    expect(ticket(first, 1)).toMatchObject({ stage: 'done', waits: null })
    expect(ticket(first, 2)).toMatchObject({ stage: 'queued' })
    expect(ticket(first, 3)).toMatchObject({ stage: 'gate-merge', sub: 'gate running' })
    // Merged in B, deployed in C: B is an ancestor of C.
    expect(ticket(first, 4)).toMatchObject({ stage: 'closing', enteredAt: '2026-10-17T14:00:00.000Z' })
    // Merged in D, after the deployed C.
    expect(ticket(first, 5)).toMatchObject({ stage: 'deploy', enteredAt: '2026-10-17T13:00:00.000Z' })
    expect(ticket(first, 6)).toMatchObject({ stage: 'implementing', rework: true })
    // Stage reads no comments: gh is asked for nothing it would need them for, and only read-only commands run.
    for (const args of gh.calls) expect(['pr list', 'api repos/o/r/deployments?environment=production&per_page=30']).toContain(args.slice(0, 2).join(' '))

    // A Ticket file edit: 02 is claimed.
    const file = join(world.repo, '.scratch', 'demo', 'issues', '02-second.md')
    writeFileSync(file, ticketText(2, 'claimed 2026-10-17T15:00Z'))
    const claimed = await nextSnapshot(sent, (snapshot) => ticket(snapshot, 2).stage === 'implementing')
    expect(ticket(claimed, 2)).toMatchObject({ stage: 'implementing', enteredAt: '2026-10-17T15:00:00.000Z' })

    // A PR read: 02 has a PR with red CI; 03 got a new commit, so its marks are stale.
    gh.world.pulls.push(pr(2, 'demo/02', { headRefOid: HEAD6, statusCheckRollup: [run('check', 'FAILURE')] }))
    const three = gh.world.pulls.find((pull) => pull.number === 3)!
    three.headRefOid = 'a'.repeat(40)
    three.statusCheckRollup = [run('check', 'SUCCESS')]
    const polled = await nextSnapshot(sent, (snapshot) => ticket(snapshot, 2).stage === 'ci' && ticket(snapshot, 3).stage === 'agent-review')
    expect(ticket(polled, 2)).toMatchObject({ stage: 'ci', sub: 'failing' })
    expect(ticket(polled, 3)).toMatchObject({ stage: 'agent-review', sub: null })
  })
})

describe('Stages in Silent mode', () => {
  const silentProfile = (world: World): PipelineProfile => ({ name: 'atakama', mode: 'silent', finish: null, pipeline: ATAKAMA, pipelineReason: null, e2eLock: world.lock, repos: [] })
  const markFile = (world: World, num: number) => markFilePath(world.harnessHome, 'atakama', 'demo', num)
  const writeMarks = (world: World, num: number, marks: unknown) => {
    mkdirSync(join(world.harnessHome, 'runs', 'atakama', 'marks'), { recursive: true })
    writeFileSync(markFile(world, num), typeof marks === 'string' ? marks : JSON.stringify({ epic: 'demo', num: String(num).padStart(2, '0'), marks }))
  }

  it('reads the marks file of each Ticket on the head of its branch; an old SHA and a broken file count as no marks; nothing is written', async () => {
    const world = makeWorld()
    const { A, B } = world.commits
    const gh = stubGh({ pulls: [], deployments: [], deployMarks: [] })
    // 03: review success on the head of demo/03 (A) → past Agent review, no PR yet → CI.
    writeMarks(world, 3, [{ kind: 'review', verdict: 'success', sha: A, at: '2026-10-17T11:00:00.000Z' }])
    // 04: a mark on another SHA does not count → Implementing.
    writeMarks(world, 4, [{ kind: 'review', verdict: 'success', sha: B, at: '2026-10-17T11:00:00.000Z' }])
    // 05: a broken file → no marks, one line in the log.
    writeMarks(world, 5, '{ not json')
    const logs: string[] = []
    const { hub } = hubOver(world, silentProfile(world), gh.gh, logs)
    const before = [treeState(world.repo), treeState(world.harnessHome)]
    const sent: PipelineSnapshot[] = []
    const first = await hub.open(world.repo, { id: 1, send: (snapshot) => sent.push(snapshot) })

    expect(first.pipeline.map((column) => column.id)).toEqual(['queued', 'implementing', 'agent-review', 'ci', 'human-review', 'awaiting-merge', 'done'])
    expect(ticket(first, 3)).toMatchObject({ stage: 'ci', enteredAt: '2026-10-17T11:00:00.000Z' })
    expect(ticket(first, 4)).toMatchObject({ stage: 'implementing' })
    expect(ticket(first, 5)).toMatchObject({ stage: 'implementing' })
    expect(logs.filter((line) => line.includes(markFile(world, 5)))).toHaveLength(1)

    // A mark set between two reads arrives with the next tick: 04 failed its review on the head SHA.
    writeMarks(world, 4, [{ kind: 'review', verdict: 'failure', sha: A, at: '2026-10-17T12:00:00.000Z' }])
    const rework = await nextSnapshot(sent, (snapshot) => ticket(snapshot, 4).rework)
    expect(ticket(rework, 4)).toMatchObject({ stage: 'implementing', rework: true, enteredAt: '2026-10-17T12:00:00.000Z' })
    const after = [treeState(world.repo), treeState(world.harnessHome)]
    // The only change under the Harness home is the test's own write of 04's marks.
    after[1]!.delete(markFile(world, 4))
    before[1]!.delete(markFile(world, 4))
    expect(after).toEqual(before)
    // The broken file is still logged once, not once per read.
    expect(logs.filter((line) => line.includes(markFile(world, 5)))).toHaveLength(1)
    // Silent mode asks GitHub for no marks and no deploys.
    for (const args of gh.calls) expect(args.slice(0, 2)).toEqual(['pr', 'list'])
  })

  it('a review of an open PR in Silent mode: CI green → Human review, waits for the team; approved → Awaiting merge', async () => {
    const world = makeWorld()
    const { A } = world.commits
    writeMarks(world, 3, [{ kind: 'review', verdict: 'success', sha: A, at: '2026-10-17T11:00:00.000Z' }])
    const gh = stubGh({ pulls: [pr(3, 'demo/03', { headRefOid: A, statusCheckRollup: [run('check', 'SUCCESS')] })], deployments: [], deployMarks: [] })
    const { hub } = hubOver(world, silentProfile(world), gh.gh)
    const sent: PipelineSnapshot[] = []
    const first = await hub.open(world.repo, { id: 1, send: (snapshot) => sent.push(snapshot) })
    expect(ticket(first, 3)).toMatchObject({ stage: 'human-review', waits: 'team' })
    gh.world.pulls[0]!.reviewDecision = 'APPROVED'
    const approved = await nextSnapshot(sent, (snapshot) => ticket(snapshot, 3).stage === 'awaiting-merge')
    expect(ticket(approved, 3).waits).toBe('team')
  })
})

// worfy-onboarding: a Project that finishes locally and has no repository on GitHub (the Demo project)
// keeps its agents' marks in the marks file of the Harness home, as Silent mode does.
describe('Stages in Full mode with workflow.finish local-green', () => {
  const DEMO: PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'agent-review' }, { kind: 'gate-merge' }, { kind: 'done' }]
  const markFile = (world: World, num: number) => markFilePath(world.harnessHome, 'demo-project', 'demo', num)
  const writeMarks = (world: World, num: number, marks: unknown[]) => {
    mkdirSync(join(world.harnessHome, 'runs', 'demo-project', 'marks'), { recursive: true })
    writeFileSync(markFile(world, num), JSON.stringify({ epic: 'demo', num: String(num).padStart(2, '0'), marks }))
  }
  /** Marks on the head of each branch (A): 03 review pending, 04 review failure, 05 review success. */
  const reviewMarks = (world: World) => {
    const { A } = world.commits
    writeMarks(world, 3, [{ kind: 'review', verdict: 'pending', sha: A, at: '2026-10-17T11:00:00.000Z' }])
    writeMarks(world, 4, [{ kind: 'review', verdict: 'failure', sha: A, at: '2026-10-17T11:00:00.000Z' }])
    writeMarks(world, 5, [{ kind: 'review', verdict: 'success', sha: A, at: '2026-10-17T11:00:00.000Z' }])
  }

  it('without origin: the marks file gives each Ticket its Stage, gh is not asked for PRs, nothing is written', async () => {
    const world = makeWorld()
    reviewMarks(world)
    const gh = stubGh({ pulls: [], deployments: [], deployMarks: [] })
    const { hub } = hubOver(world, fullProfile(world, DEMO, 'local-green'), gh.gh)
    const before = [treeState(world.repo), treeState(world.harnessHome)]
    const snapshot = await hub.open(world.repo, { id: 1, send: () => undefined })

    expect(snapshot.error).toBeNull()
    expect(snapshot.pipeline.map((column) => column.title)).toEqual(['Queued', 'Implementing', 'Agent review', 'Gate & merge', 'Done'])
    expect(ticket(snapshot, 3)).toMatchObject({ stage: 'agent-review', rework: false })
    expect(ticket(snapshot, 4)).toMatchObject({ stage: 'implementing', rework: true })
    expect(ticket(snapshot, 5)).toMatchObject({ stage: 'gate-merge', passed: ['queued', 'implementing', 'agent-review'] })
    // No marks file: Implementing, as before.
    expect(ticket(snapshot, 6)).toMatchObject({ stage: 'implementing', rework: false })
    expect(gh.calls).toEqual([])
    expect([treeState(world.repo), treeState(world.harnessHome)]).toEqual(before)
  })

  it('with origin: the marks are the commit statuses of the PR, the marks file is not read', async () => {
    const world = makeWorld()
    git(world.repo, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
    reviewMarks(world)
    const HEAD = 'e'.repeat(40)
    const gh = stubGh({ pulls: [pr(4, 'demo/04', { headRefOid: HEAD, statusCheckRollup: [status('review', 'SUCCESS')] })], deployments: [], deployMarks: [] })
    const { hub } = hubOver(world, fullProfile(world, DEMO, 'local-green'), gh.gh)
    const snapshot = await hub.open(world.repo, { id: 1, send: () => undefined })

    // The file's pending review of 03 and success of 05 do not count; 04's PR has review success on its head.
    expect(ticket(snapshot, 3)).toMatchObject({ stage: 'implementing', rework: false })
    expect(ticket(snapshot, 4)).toMatchObject({ stage: 'gate-merge' })
    expect(ticket(snapshot, 5)).toMatchObject({ stage: 'implementing', rework: false })
    expect(gh.calls.some((args) => args[0] === 'pr' && args[1] === 'list')).toBe(true)
  })

  it('pr-green-ci without origin: no marks, as before; the PR tracker is asked', async () => {
    const world = makeWorld()
    reviewMarks(world)
    const gh = stubGh({ pulls: [], deployments: [], deployMarks: [] })
    const { hub } = hubOver(world, fullProfile(world, DEMO, 'pr-green-ci'), gh.gh)
    const snapshot = await hub.open(world.repo, { id: 1, send: () => undefined })

    for (const num of [3, 4, 5]) expect(ticket(snapshot, num)).toMatchObject({ stage: 'implementing', rework: false })
    expect(gh.calls.some((args) => args[0] === 'pr' && args[1] === 'list')).toBe(true)
  })
})

describe('Deploy by the commit status deploy (Full mode, no environment)', () => {
  it('a merge commit that is an ancestor of the newest commit with deploy: success passes Deploy; a later one does not', async () => {
    const world = makeWorld()
    const { B, C, D } = world.commits
    const gh = stubGh({
      pulls: [
        pr(4, 'demo/04', { state: 'MERGED', mergeCommit: { oid: B }, mergedAt: '2026-10-17T12:00:00Z' }),
        pr(5, 'demo/05', { state: 'MERGED', mergeCommit: { oid: D }, mergedAt: '2026-10-17T13:00:00Z' }),
      ],
      deployments: [],
      deployMarks: [C],
    })
    const pipeline: PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'gate-merge' }, { kind: 'deploy' }, { kind: 'closing' }, { kind: 'done' }]
    const { hub } = hubOver(world, fullProfile(world, pipeline), gh.gh)
    const first = await hub.open(world.repo, { id: 1, send: () => undefined })
    expect(ticket(first, 4)).toMatchObject({ stage: 'closing', enteredAt: '2026-10-17T14:00:00.000Z' })
    expect(ticket(first, 5)).toMatchObject({ stage: 'deploy' })
    expect(gh.calls.filter((args) => args[1] === 'graphql').length).toBeGreaterThanOrEqual(1)
  })

  it('no Ticket on Deploy: no Deployment and no deploy mark is asked for', async () => {
    const world = makeWorld()
    const gh = stubGh({ pulls: [], deployments: [], deployMarks: [] })
    const { hub } = hubOver(world, fullProfile(world), gh.gh)
    await hub.open(world.repo, { id: 1, send: () => undefined })
    expect(gh.calls.every((args) => args[0] === 'pr')).toBe(true)
  })
})

describe('where gh and git run', () => {
  /** A model with one claimed Ticket of Epic `demo`, without a `Repo:` line. */
  const claimedModel = (root: string): WorkflowModel => {
    const claimed: Ticket = { epic: 'demo', num: 3, slug: 'third', title: '03 — Ticket 3', statusRaw: 'claimed 2026-10-17T09:00Z', state: 'work', blockedRaw: '—', blockedNums: [], blockedParsed: true, files: [], filesListed: false, fromBranch: null }
    return { root, epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets: [claimed], error: null, branchErrors: [] }
  }

  /** A reader whose Profile could not be read; the folders the PR reads go to are recorded. */
  const readerWithoutProfile = (asked: string[]): StageReader =>
    new StageReader({
      workflow: { open: () => Promise.reject(new Error('unused')), close: () => Promise.resolve(false), model: () => Promise.resolve(null) },
      prs: {
        read: (folder) => {
          asked.push(folder)
          return Promise.resolve({ gh: { available: true, error: null }, pulls: [] } as unknown as Awaited<ReturnType<StageSources['prs']['read']>>)
        },
      },
      profile: () => Promise.resolve({ ok: false, reason: 'profile exit code 1' }),
      deployments: { environment: () => Promise.resolve([]), deployMarks: () => Promise.resolve([]) } as unknown as StageSources['deployments'],
      harnessHome: join(dir, 'harness-home'),
    })

  it('a Profile that could not be read and a root that is a plain folder over repositories: gh runs nowhere', async () => {
    // Like Atakama: the Project's root holds the repositories and is none itself.
    const root = join(dir, 'atakama')
    for (const name of ['api', 'web']) {
      mkdirSync(join(root, name), { recursive: true })
      git(join(root, name), 'init', '-q', '-b', 'main')
    }
    const asked: string[] = []
    const snapshot = await readerWithoutProfile(asked).read(root, claimedModel(root))
    expect(asked).toEqual([])
    expect(snapshot.pipeline.map((column) => column.kind)).toEqual(DEFAULT_PIPELINE.map((stage) => stage.kind))
    expect(snapshot.tickets).toMatchObject([{ epic: 'demo', num: 3, stage: 'implementing' }])
    expect(snapshot.error).toContain('the Profile could not be read')
  })

  it('a Profile that could not be read and a root in a git repository: gh runs in the root, as before', async () => {
    const root = join(dir, 'single')
    mkdirSync(root)
    git(root, 'init', '-q', '-b', 'main')
    const asked: string[] = []
    await readerWithoutProfile(asked).read(root, claimedModel(root))
    expect(asked).toEqual([root])
  })
})

describe('the e2e lock', () => {
  it('free, held for PRs, held with an empty or broken holder.json', async () => {
    const lock = join(dir, 'lock')
    expect(await readE2eLock(lock)).toBeNull()
    expect(await readE2eLock(null)).toBeNull()
    mkdirSync(lock)
    expect(await readE2eLock(lock)).toEqual({ prs: null })
    writeFileSync(join(lock, 'holder.json'), '')
    expect(await readE2eLock(lock)).toEqual({ prs: null })
    writeFileSync(join(lock, 'holder.json'), JSON.stringify({ prs: [12, 14], what: 'gate-full', pid: 1, since: 'x' }))
    expect(await readE2eLock(lock)).toEqual({ prs: [12, 14] })
    rmSync(join(lock, 'holder.json'))
    rmdirSync(lock)
    // A plain file where the folder was (a `touch` without -c) is no lock.
    writeFileSync(lock, '')
    expect(await readE2eLock(lock)).toBeNull()
  })
})

describe('pipeline IPC channels', () => {
  type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

  async function setup(world: World) {
    const gh = stubGh({ pulls: [], deployments: [], deployMarks: [] })
    const { hub } = hubOver(world, fullProfile(world), gh.gh)
    const handlers = new Map<string, Listener>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    const module = pipelineHandlers({ hub, projects: () => [{ path: world.repo }] })
    await registerIpc(ipc, { modules: { './pipeline.ts': async () => module }, isTrustedSender: () => true })
    const sent: { channel: string; payload: unknown }[] = []
    const senderOf = (id: number | string) => {
      const sender = {
        id,
        isDestroyed: () => false,
        once: () => sender,
        send: (channel: string, payload: unknown) => void sent.push({ channel, payload }),
      }
      return sender
    }
    const call = async (name: string, input: unknown, id: number | string = 7) => {
      const event = { senderFrame: { url: 'app://' }, sender: senderOf(id) } as unknown as IpcMainInvokeEvent
      return (await handlers.get(IPC_CHANNEL_PREFIX + name)!(event, input)) as IpcResult<unknown>
    }
    return { call, sent, hub }
  }

  it('pipeline.get answers the snapshot and streams pipeline.changed to the window until pipeline.close', async () => {
    const world = makeWorld()
    const { call, sent, hub } = await setup(world)
    const result = await call('pipeline.get', { root: world.repo, injected: 'drop me' })
    expect(result.ok).toBe(true)
    const snapshot = (result as { ok: true; value: PipelineSnapshot }).value
    expect(ticket(snapshot, 2).stage).toBe('queued')
    expect(JSON.stringify(result)).not.toContain('drop me')
    expect(hub.roots).toEqual([world.repo])

    writeFileSync(join(world.repo, '.scratch', 'demo', 'issues', '02-second.md'), ticketText(2, 'blocked 2026-10-17T15:00Z', ['Blocked reason: waits for the owner', 'Waits: owner']))
    const deadline = Date.now() + ms(8000)
    while (!sent.length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20))
    expect(sent[0]?.channel).toBe('worfy:pipeline.changed')
    expect(ticket(sent[0]!.payload as PipelineSnapshot, 2)).toMatchObject({ stage: 'implementing', blocked: { reason: 'waits for the owner' }, waits: 'owner' })

    expect(await call('pipeline.close', { root: world.repo })).toEqual({ ok: true, value: { closed: true } })
    expect(await call('pipeline.close', { root: world.repo })).toEqual({ ok: true, value: { closed: false } })
    expect(hub.roots).toEqual([])
  })

  it('a Linked machine reaches only the Projects of this Machine', async () => {
    const world = makeWorld()
    const { call, hub } = await setup(world)
    const outside = await call('pipeline.get', { root: dir }, 'link:machine/1')
    expect(outside.ok).toBe(false)
    expect(!outside.ok && outside.error).toMatch(/outside the Projects of this Machine/)
    expect(hub.roots).toEqual([])
    expect((await call('pipeline.get', { root: world.repo }, 'link:machine/1')).ok).toBe(true)
  })
})

describe('one computation per Project root, however it is spelled (worfy-pipeline ticket 06)', () => {
  it('on Windows the notification follows C:/… (the Project list) and a window C:\\… (path.resolve): both share one computation', async () => {
    const opened: string[] = []
    const closed: string[] = []
    const sources: StageSources = {
      workflow: {
        open: async (root) => {
          opened.push(root)
          return null as never
        },
        close: async (root) => {
          closed.push(root)
          return true
        },
        model: async () => null,
      },
      prs: { read: async () => ({ pulls: [], gh: { state: 'ok' } }) as never },
      profile: async () => ({ ok: false, reason: 'no Profile in this test' }),
      deployments: { environment: async () => [], deployMarks: async () => [] },
      harnessHome: dir,
      paths: win32,
    }
    const hub = new StageHub(sources)
    cleanups.push(async () => hub.closeAll())
    const sent: string[] = []
    const fromList = await hub.open('C:/Users/owner/worfy', { id: 'waits-notify', send: () => sent.push('waits-notify') })
    const fromWindow = await hub.open('C:\\Users\\owner\\worfy', { id: 7, send: () => sent.push('window') })
    expect(opened).toEqual(['C:\\Users\\owner\\worfy'])
    expect(hub.roots).toEqual(['C:\\Users\\owner\\worfy'])
    expect(fromWindow).toBe(fromList)
    // Either spelling lets its own subscriber go; the computation stops with the last of them.
    expect(await hub.close('C:\\Users\\owner\\worfy', 'waits-notify')).toBe(true)
    expect(closed).toEqual([])
    expect(await hub.close('C:/Users/owner/worfy', 7)).toBe(true)
    expect(closed).toEqual(['C:\\Users\\owner\\worfy'])
    expect(hub.roots).toEqual([])
  })
})

// worfy-polish ticket 36: an edit of a Ticket's body changes its `version` alone, and the Stages are
// computed from the Tickets' fields; a new computation would cost a `profile` run for nothing.
describe('the Stages and an edit of a Ticket\'s text alone', () => {
  it('watch the workflow as a subscriber of the Tickets\' fields only, so such an edit computes nothing', async () => {
    const subscribers: { fieldsOnly?: boolean }[] = []
    const sources: StageSources = {
      workflow: {
        open: async (_, subscriber) => {
          subscribers.push(subscriber)
          return null as never
        },
        close: async () => true,
        model: async () => null,
      },
      prs: { read: async () => ({ pulls: [], gh: { state: 'ok' } }) as never },
      profile: async () => ({ ok: false, reason: 'no Profile in this test' }),
      deployments: { environment: async () => [], deployMarks: async () => [] },
      harnessHome: dir,
    }
    const hub = new StageHub(sources)
    cleanups.push(async () => hub.closeAll())
    await hub.open(dir, { id: 1, send: () => undefined })
    expect(subscribers.map((subscriber) => subscriber.fieldsOnly)).toEqual([true])
  })
})

describe('readPipelineProfile', () => {
  const answer = (json: unknown, code = 0) => async () => ({ code, signal: null, stdout: typeof json === 'string' ? json : JSON.stringify(json), stderr: '' })
  const options = (json: unknown, code = 0) => ({ root: '/r', claudeHome: '/nowhere', env: {}, run: answer(json, code) })
  const resolved = (extra: Record<string, unknown> = {}) => ({ _resolved: { name: 'worfy', mode: 'full', repos: [{ name: 'r', path: '/r' }], ...extra }, workflow: { e2e_lock: '/tmp/worfy-e2e.lock' } })

  it('takes the name, mode, repositories, Pipeline and e2e lock of profile --json', async () => {
    const read = await readPipelineProfile(options(resolved({ pipeline: WORFY })))
    expect(read).toEqual({ ok: true, profile: { name: 'worfy', mode: 'full', finish: null, pipeline: WORFY, pipelineReason: null, e2eLock: '/tmp/worfy-e2e.lock', repos: [{ name: 'r', path: '/r' }] } })
  })

  it('takes workflow.finish; an unknown value or none is null', async () => {
    const finishOf = async (workflow: unknown) => {
      const read = await readPipelineProfile(options({ ...resolved({ pipeline: WORFY }), workflow }))
      return read.ok ? read.profile.finish : 'not read'
    }
    expect(await finishOf({ finish: 'local-green' })).toBe('local-green')
    expect(await finishOf({ finish: 'pr-green-ci', e2e_lock: '/tmp/lock' })).toBe('pr-green-ci')
    expect(await finishOf({ finish: 'merge-and-pray' })).toBeNull()
    expect(await finishOf({})).toBeNull()
    expect(await finishOf(undefined)).toBeNull()
  })

  it('a Harness without _resolved.pipeline, or a Pipeline that breaks the rules: the default Pipeline and the reason', async () => {
    const older = await readPipelineProfile(options(resolved()))
    expect(older.ok && older.profile.pipeline.map((stage) => stage.kind)).toEqual(['queued', 'implementing', 'ci', 'agent-review', 'gate-merge', 'closing', 'done'])
    expect(older.ok && older.profile.pipelineReason).toMatch(/older than the Pipeline/)
    const broken = await readPipelineProfile(options(resolved({ pipeline: [{ kind: 'ci' }, { kind: 'done' }] })))
    expect(broken.ok && broken.profile.pipelineReason).toMatch(/queued must be the first Stage/)
  })

  it('a relative lock path or none is no lock; a failed call or a non-JSON answer is a reason', async () => {
    const relative = await readPipelineProfile(options({ ...resolved({ pipeline: WORFY }), workflow: { e2e_lock: 'tmp/lock' } }))
    expect(relative.ok && relative.profile.e2eLock).toBeNull()
    const none = await readPipelineProfile(options({ _resolved: resolved({ pipeline: WORFY })._resolved }))
    expect(none.ok && none.profile.e2eLock).toBeNull()
    expect(await readPipelineProfile(options('', 3))).toMatchObject({ ok: false, miss: 'none' })
    expect(await readPipelineProfile(options('not json'))).toMatchObject({ ok: false, miss: 'failed' })
  })
})
