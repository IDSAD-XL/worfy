// scripts/agent-cost.mjs: the cost of the agents by role and the prompt cache rewritten after an
// idle pause, from Claude Code transcripts. The fixture (test/fixtures/agent-cost/project/) is one
// main session and two of its subagents on 2026-10-20, all on claude-opus-5-5:
//   - s-main.jsonl, the Orchestrator: msg_m3 comes 6 min after msg_m2 and writes most of its context
//     to the cache; msg_m4 comes 4 min after msg_m3 and is written twice (two content blocks, the
//     output count grows from 10 to 300); msg_m5 comes 6 min after msg_m4 but reads its context
//     from the cache;
//   - subagents/agent-aimpl.jsonl with meta.json of agentType worfy:implementer: msg_i2 comes 7 min
//     after msg_i1 and writes 25k tokens to the 1-hour cache;
//   - subagents/agent-arev.jsonl without meta.json: the first line of its brief says "Review".
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'agent-cost.mjs')
const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'agent-cost', 'project')

type RoleName = 'orchestrator' | 'implementer' | 'reviewer' | 'scout' | 'other'
interface Role {
  calls: number
  cost: number
  share: number
}
interface Report {
  transcripts: number
  calls: number
  duplicates: number
  cost: number
  roles: Record<RoleName, Role>
  idleRewrite: { calls: number; cost: number; share: number; byRole: Record<RoleName, { calls: number; cost: number }> }
  orchestratorContext: { calls: number; meanContext: number; meanCacheRead: number }
  startContext: Record<Exclude<RoleName, 'orchestrator'>, { agents: number; median: number; mean: number; byDay: Record<string, { agents: number; median: number }> }>
  unpricedModels: string[]
}
interface AgentCost {
  defaultTranscriptFolders: (env: Record<string, string | undefined>, home: string, root: string) => string[]
  roleOf: (agent: { subagent: boolean; agentType?: string; name?: string; description?: string; brief?: string }) => string
}
const { defaultTranscriptFolders, roleOf } = (await import(pathToFileURL(SCRIPT).href)) as AgentCost

const dirs: string[] = []
const locked: string[] = []
afterEach(() => {
  for (const dir of locked.splice(0)) unlock(dir)
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-agent-cost-')))
  dirs.push(dir)
  return dir
}

const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CLAUDE_CONFIG_DIR'))

/** Runs the script as `pnpm test` runs it: under Electron as Node. */
function run(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...inherited, ELECTRON_RUN_AS_NODE: '1', ...options.env },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function report(args: string[] = []): Report {
  const result = run(['--transcripts', FIXTURE, '--json', ...args])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as Report
}

/** Dollars of a response at claude-opus-5-5's prices: input 4, output 20, read 0.2, write 5 / 8. */
const opus = (input: number, output: number, read: number, write5m: number, write1h = 0): number =>
  (input * 4 + output * 20 + read * 0.2 + write5m * 5 + write1h * 8) / 1e6

describe('agent-cost on the fixture', () => {
  it('counts a cache write after a 6 min pause as a rewrite, and not one after 4 min or one that reads its context', () => {
    const r = report()
    expect(r.idleRewrite.calls).toBe(2)
    expect(r.idleRewrite.byRole.orchestrator).toEqual({ calls: 1, cost: expect.closeTo(opus(0, 0, 0, 12000), 9) })
    expect(r.idleRewrite.byRole.implementer).toEqual({ calls: 1, cost: expect.closeTo(opus(0, 0, 0, 0, 25000), 9) })
    expect(r.idleRewrite.share).toBeCloseTo(r.idleRewrite.cost / r.cost, 9)
  })

  it('counts a response written on two lines once, with its final output count', () => {
    const r = report()
    expect(r.duplicates).toBe(1)
    expect(r.calls).toBe(9)
    expect(r.roles.orchestrator.calls).toBe(5)
    const orchestrator = opus(3, 100, 0, 10000) + opus(2, 50, 10000, 500) + opus(1, 40, 0, 12000) + opus(1, 300, 0, 13000) + opus(1, 20, 20000, 1000)
    expect(r.roles.orchestrator.cost).toBeCloseTo(orchestrator, 9)
    expect(r.orchestratorContext).toEqual({ calls: 5, meanContext: (10003 + 10502 + 12001 + 13001 + 21001) / 5, meanCacheRead: 30000 / 5 })
  })

  it('takes the implementer role from the subagent transcript and the reviewer role from the brief', () => {
    const r = report()
    expect(r.roles.implementer.calls).toBe(3)
    expect(r.roles.reviewer.calls).toBe(1)
    expect(r.roles.other.calls).toBe(0)
    expect(r.startContext.implementer).toEqual({ agents: 1, median: 28003, mean: 28003, byDay: { '2026-10-20': { agents: 1, median: 28003 } } })
    expect(r.startContext.reviewer.median).toBe(15005)
    expect(r.unpricedModels).toEqual([])
  })

  it('measures the pause from a response before --since, and leaves out a subagent that started before it', () => {
    const r = report(['--since', '2026-10-20T10:08:00Z', '--until', '2026-10-20'])
    expect(r.calls).toBe(5)
    expect(r.idleRewrite.calls).toBe(1)
    expect(r.idleRewrite.byRole.implementer.calls).toBe(1)
    expect(r.startContext.implementer.agents).toBe(0)
    expect(report(['--until', '2026-10-19']).calls).toBe(0)
  })

  it('prints the table without --json', () => {
    const result = run(['--transcripts', FIXTURE])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Cache rewritten after a pause > 5 min: 2 responses')
    expect(result.stdout).toMatch(/^implementer\s+3\s/m)
  })

  it('writes nothing: it runs in a read-only copy of the fixture with HOME there', () => {
    const dir = tempDir()
    const copy = join(dir, 'project')
    cpSync(FIXTURE, copy, { recursive: true })
    const before = snapshot(dir)
    lock(dir)
    locked.push(dir)
    const result = run(['--transcripts', 'project', '--json'], { cwd: dir, env: { HOME: dir, USERPROFILE: dir } })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect((JSON.parse(result.stdout) as Report).calls).toBe(9)
    expect(snapshot(dir)).toEqual(before)
  })

  it('refuses a wrong argument and a missing folder with exit code 2', () => {
    expect(run(['--since', 'yesterday']).status).toBe(2)
    expect(run(['--bogus']).status).toBe(2)
    const missing = run(['--transcripts', join(tempDir(), 'none')])
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('no transcripts folder')
  })
})

describe('roleOf', () => {
  it('reads agentType first, then the name and description, then the first line of the brief', () => {
    expect(roleOf({ subagent: false, agentType: 'worfy:reviewer' })).toBe('orchestrator')
    expect(roleOf({ subagent: true, agentType: 'worfy:implementer', name: 'verify-1' })).toBe('implementer')
    expect(roleOf({ subagent: true, agentType: 'worfy:scout' })).toBe('scout')
    expect(roleOf({ subagent: true, agentType: 'Explore' })).toBe('scout')
    expect(roleOf({ subagent: true, agentType: 'general-purpose', name: 'verify-27' })).toBe('reviewer')
    expect(roleOf({ subagent: true, agentType: 'general-purpose', name: 'impl-30' })).toBe('implementer')
    expect(roleOf({ subagent: true, name: 'docs-close-3', brief: 'Review PR #1' })).toBe('other')
    expect(roleOf({ subagent: true, brief: 'Implement ticket 07' })).toBe('implementer')
    expect(roleOf({ subagent: true, brief: 'Goal: write the docs' })).toBe('other')
  })
})

describe('defaultTranscriptFolders', () => {
  it('takes the folders of the repository and its worktrees from CLAUDE_CONFIG_DIR or ~/.claude', () => {
    const home = tempDir()
    const projects = join(home, '.claude', 'projects')
    for (const name of ['-repo-x', '-repo-x--claude-worktrees-a', '-repo-xy', '-other']) mkdirSync(join(projects, name), { recursive: true })
    expect(defaultTranscriptFolders({}, home, '/repo/x').sort()).toEqual([join(projects, '-repo-x'), join(projects, '-repo-x--claude-worktrees-a')])
    expect(defaultTranscriptFolders({ CLAUDE_CONFIG_DIR: join(home, 'none') }, home, '/repo/x')).toEqual([])
  })
})

/** Every path under `dir` with its size and modification time. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    const stat = statSync(path)
    out[path] = `${stat.size}:${stat.mtimeMs}`
  }
  return out
}

function lock(dir: string): void {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) chmodSync(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o555 : 0o444)
  chmodSync(dir, 0o555)
}

function unlock(dir: string): void {
  chmodSync(dir, 0o755)
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) chmodSync(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o755 : 0o644)
}
