// readChecks (src/main/ipc/checks.ts): the worktree list of a Project as the gate badges get it. A
// worktree inside %TEMP% of Windows is marked (worfy-windows ticket 61); the others carry no mark.
import { describe, expect, it } from 'vitest'
import type { GateReader, Worktree } from '../../src/main/gate/state'
import type { PrTracker } from '../../src/main/github/prs'
import { readChecks, type ChecksService } from '../../src/main/ipc/checks'

const ROOT = 'C:/Users/a/worfy'
const IN_TEMP = 'C:/Users/a/AppData/Local/Temp/worfy-01/07'
const OUTSIDE = 'C:/Users/a/worfy-wt/08'
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
