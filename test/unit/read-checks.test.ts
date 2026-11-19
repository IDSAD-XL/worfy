// readChecks (src/main/ipc/checks.ts): the worktree list of a Project as the gate badges get it. A
// worktree inside %TEMP% of Windows is marked (worfy-windows ticket 61); the others carry no mark.
import { describe, expect, it } from 'vitest'
import type { GateReader, Worktree } from '../../src/main/gate/state'
import { githubHealth, type GithubHealth } from '../../src/main/github/github-health'
import type { PrTracker } from '../../src/main/github/prs'
import { readChecks, type ChecksService } from '../../src/main/ipc/checks'

const ROOT = 'C:/Users/someone/worfy'
const IN_TEMP = 'C:/Users/someone/AppData/Local/Temp/worfy-01/07'
const OUTSIDE = 'C:/Users/someone/worfy-wt/08'
const worktrees: Worktree[] = [
  { path: ROOT, branch: 'main', head: 'a1' },
  { path: IN_TEMP, branch: 'demo/07', head: 'b2' },
  { path: OUTSIDE, branch: 'demo/08', head: 'c3' },
]

function service(insideTemp?: (path: string) => boolean): { service: ChecksService; asked: string[] } {
  const asked: string[] = []
  const gate = { read: (_root: string, list: readonly Worktree[]) => Promise.resolve(list.map((each) => ({ ...each, gate: { outcome: 'none' as const, source: 'none' as const, at: null } }))) }
  const prs = { read: () => Promise.resolve({ pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } }) }
  return {
    asked,
    service: {
      gate: gate as unknown as GateReader,
      prs: prs as unknown as PrTracker,
      worktrees: () => Promise.resolve(worktrees),
      ...(insideTemp ? { insideTemp: (path: string) => (asked.push(path), insideTemp(path)) } : {}),
    },
  }
}

describe('readChecks and %TEMP%', () => {
  it('marks the worktree inside %TEMP% and no other', async () => {
    const { service: checks, asked } = service((path) => path.includes('/AppData/Local/Temp/'))
    const snapshot = await readChecks(checks, ROOT, [])
    expect(snapshot.worktrees.map((each) => [each.path, each.insideTemp])).toEqual([
      [ROOT, undefined],
      [IN_TEMP, true],
      [OUTSIDE, undefined],
    ])
    expect(snapshot.worktrees.filter((each) => 'insideTemp' in each)).toHaveLength(1)
    expect(asked).toEqual([ROOT, IN_TEMP, OUTSIDE])
  })

  it('without a stand-in it asks insideUserTemp: these folders lie in no real %TEMP%, so nothing is marked', async () => {
    const snapshot = await readChecks(service().service, ROOT, [])
    expect(snapshot.worktrees.some((each) => 'insideTemp' in each)).toBe(false)
  })
})

// worfy-auth-check ticket 07: the PR badges tell Health check — a sign-in GitHub refused is reported for the Project
// whose folder was read and marks the snapshot, whose error is then the reason of the GitHub access row.
describe('readChecks and Health check (worfy-auth-check ticket 07)', () => {
  function withGh(gh: () => { available: boolean; error: string | null }): ChecksService {
    const base = service().service
    return { ...base, prs: { read: () => Promise.resolve({ pulls: [], gh: { ...gh(), intervalMs: 60_000 } }) } as unknown as PrTracker }
  }

  function recorder(detail: string | null): { calls: string[]; health: GithubHealth } {
    const calls: string[] = []
    const health = githubHealth({
      feature: 'PR badges',
      reports: {
        reportFailure: (id, project, reason) => void calls.push(`fail ${id} ${project?.id ?? '-'} ${reason}`),
        reportOk: (id, project) => void calls.push(`ok ${id} ${project?.id ?? '-'}`),
        current: () => (detail === null ? null : { checkedAt: '2026-11-19T00:00:00Z', checks: [{ id: 'github-access', group: 'Projects', title: 'GitHub access', project: { id: 'worfy-1', name: 'worfy' }, status: 'fail', severity: 'critical', detail, hint: '', command: null, actions: [], opensFirstRun: false }] }),
      },
      project: (root) => (root === ROOT ? { id: 'worfy-1', name: 'worfy' } : undefined),
    })
    return { calls, health }
  }

  it('a 401 is reported for the Project root, once; the snapshot carries signInFailed and the row reason', async () => {
    const { calls, health } = recorder('GH_TOKEN from the environment does not work (HTTP 401)')
    let gh = { available: false, error: 'gh: Bad credentials (HTTP 401)' as string | null }
    const checks = { ...withGh(() => gh), health }
    // A repository of the Project is read: the report speaks for the Project at its root.
    const first = await readChecks(checks, `${ROOT}/api`, [], () => false, ROOT)
    expect(first.gh).toEqual({ available: false, error: 'GH_TOKEN from the environment does not work (HTTP 401)', intervalMs: 60_000, signInFailed: true })
    await readChecks(checks, `${ROOT}/api`, [], () => false, ROOT)
    expect(calls).toEqual(['fail github-access worfy-1 PR badges: gh: Bad credentials (HTTP 401)'])
    gh = { available: true, error: null }
    expect((await readChecks(checks, `${ROOT}/api`, [], () => false, ROOT)).gh).toEqual({ available: true, error: null, intervalMs: 60_000 })
    await readChecks(checks, `${ROOT}/api`, [], () => false, ROOT)
    expect(calls).toEqual(['fail github-access worfy-1 PR badges: gh: Bad credentials (HTTP 401)', 'ok github-access worfy-1'])
  })

  it('gh failing for another reason is no sign-in: no mark, nothing reported', async () => {
    const { calls, health } = recorder(null)
    const snapshot = await readChecks({ ...withGh(() => ({ available: false, error: 'error connecting to api.github.com' })), health }, ROOT, [])
    expect(snapshot.gh).toEqual({ available: false, error: 'error connecting to api.github.com', intervalMs: 60_000 })
    expect(calls).toEqual([])
  })
})
