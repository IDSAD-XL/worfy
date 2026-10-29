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
// The by-ticket fixture (test/fixtures/agent-cost/by-ticket/) is one main session and four of its
// subagents on 2026-10-21, all on claude-opus-5-5:
//   - s-wave.jsonl, the Orchestrator: msg_o1 before any Wave; then the command
//     `/worfy:epic-wave tickets 01, 02 of epic demo-epic`; msg_o2 and msg_o3 after it, with a tool
//     result between them that quotes another wave command (not a Wave start); then a second
//     command `/worfy:epic-wave tickets 02 of epic demo-epic` and msg_o4 after it;
//   - agent-aimpl1, implementer of demo-epic/01 (first line of the brief): reads src/a.ts and
//     src/b.ts (msg_a1, msg_a2), then edits in msg_a3, written on two lines (text, then the Edit),
//     then reads src/z.ts (msg_a4);
//   - agent-ascout, scout of demo-epic/02 (a `Ticket:` line): reads /repo/src/a.ts and src/c.ts;
//     its own implementer reading src/c.ts later is not a file read "earlier";
//   - agent-aimpl2, implementer of demo-epic/02 (named on the second line of the brief): reads
//     src/a.ts with Read, then src/c.ts and src/b.ts with one shell command (msg_b2), then writes
//     src/c.ts; ticket 01's implementer read src/a.ts and src/b.ts before it;
//   - agent-aimpl3, a rework round of demo-epic/01 that only runs the shell, no Edit or Write;
//   - agent-adocs, without meta.json and without a ticket in its brief.
// The report runs in this process: spawning the script takes seconds on a loaded Windows runner.
// Two tests spawn it, once each: the one that checks it writes nothing and the missing folder.
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'agent-cost.mjs')
const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'agent-cost', 'project')
const BY_TICKET = join(import.meta.dirname, '..', 'fixtures', 'agent-cost', 'by-ticket')

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
interface Part {
  tokens: number
  cost: number
}
interface TicketRow extends Part {
  ticket: string | null
  orchestrator: Part
  scout: Part & { agents: number }
  noEdit: Part & { agents: number }
  beforeFirstEdit: Part & { agents: number; filesRead: number; filesReadEarlier: number }
  scoutingShare: Part
}
type Deps = { env: Record<string, string | undefined>; home: string; cwd: string; out: (text: string) => void; err: (line: string) => void }
interface AgentCost {
  agentCost: (args: string[], deps: Deps) => Promise<number>
  ticketOf: (brief: string) => string | null
  waveTickets: (text: string) => string[] | null
  shellReads: (command: string) => string[]
  parseArgs: (args: string[]) => unknown
  defaultTranscriptFolders: (env: Record<string, string | undefined>, home: string, root: string) => string[]
  roleOf: (agent: { subagent: boolean; agentType?: string; name?: string; description?: string; brief?: string }) => string
}
const { agentCost, parseArgs, ticketOf, waveTickets, shellReads, defaultTranscriptFolders, roleOf } = (await import(pathToFileURL(SCRIPT).href)) as AgentCost

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

/** Runs the script under the real node (test/script-node.ts). */
function run(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(scriptNode(), [SCRIPT, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...inherited, ...options.env },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

async function report(args: string[] = []): Promise<Report> {
  const result = await inProcess(['--transcripts', FIXTURE, '--json', ...args])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as Report
}

/** Dollars of a response at claude-opus-5-5's prices: input 4, output 20, read 0.2, write 5 / 8. */
const opus = (input: number, output: number, read: number, write5m: number, write1h = 0): number =>
  (input * 4 + output * 20 + read * 0.2 + write5m * 5 + write1h * 8) / 1e6

describe('agent-cost on the fixture', () => {
  it('counts a cache write after a 6 min pause as a rewrite, and not one after 4 min or one that reads its context', async () => {
    const r = await report()
    expect(r.idleRewrite.calls).toBe(2)
    expect(r.idleRewrite.byRole.orchestrator).toEqual({ calls: 1, cost: expect.closeTo(opus(0, 0, 0, 12000), 9) })
    expect(r.idleRewrite.byRole.implementer).toEqual({ calls: 1, cost: expect.closeTo(opus(0, 0, 0, 0, 25000), 9) })
    expect(r.idleRewrite.share).toBeCloseTo(r.idleRewrite.cost / r.cost, 9)
  })

  it('counts a response written on two lines once, with its final output count', async () => {
    const r = await report()
    expect(r.duplicates).toBe(1)
    expect(r.calls).toBe(9)
    expect(r.roles.orchestrator.calls).toBe(5)
    const orchestrator = opus(3, 100, 0, 10000) + opus(2, 50, 10000, 500) + opus(1, 40, 0, 12000) + opus(1, 300, 0, 13000) + opus(1, 20, 20000, 1000)
    expect(r.roles.orchestrator.cost).toBeCloseTo(orchestrator, 9)
    expect(r.orchestratorContext).toEqual({ calls: 5, meanContext: (10003 + 10502 + 12001 + 13001 + 21001) / 5, meanCacheRead: 30000 / 5 })
  })

  it('takes the implementer role from the subagent transcript and the reviewer role from the brief', async () => {
    const r = await report()
    expect(r.roles.implementer.calls).toBe(3)
    expect(r.roles.reviewer.calls).toBe(1)
    expect(r.roles.other.calls).toBe(0)
    expect(r.startContext.implementer).toEqual({ agents: 1, median: 28003, mean: 28003, byDay: { '2026-10-20': { agents: 1, median: 28003 } } })
    expect(r.startContext.reviewer.median).toBe(15005)
    expect(r.unpricedModels).toEqual([])
  })

  it('measures the pause from a response before --since, and leaves out a subagent that started before it', async () => {
    const r = await report(['--since', '2026-10-20T10:08:00Z', '--until', '2026-10-20'])
    expect(r.calls).toBe(5)
    expect(r.idleRewrite.calls).toBe(1)
    expect(r.idleRewrite.byRole.implementer.calls).toBe(1)
    expect(r.startContext.implementer.agents).toBe(0)
    expect((await report(['--until', '2026-10-19'])).calls).toBe(0)
  })

  it('prints the table without --json', async () => {
    const result = await inProcess(['--transcripts', FIXTURE])
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

  // One spawn per test: a loaded Windows runner takes seconds to start a process.
  it('refuses a wrong argument and a missing folder with exit code 2', async () => {
    expect(() => parseArgs(['--since', 'yesterday'])).toThrow('not a date: yesterday')
    expect(() => parseArgs(['--bogus'])).toThrow('unknown argument: --bogus')
    expect((await inProcess(['--since', 'yesterday'])).status).toBe(2)
    expect((await inProcess(['--bogus'])).status).toBe(2)
    const missing = run(['--transcripts', join(tempDir(), 'none')])
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('no transcripts folder')
  })
})

async function inProcess(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const deps: Deps = { env: {}, home: tempDir(), cwd: process.cwd(), out: (text) => (stdout += text), err: (line) => (stderr += `${line}\n`) }
  const status = await agentCost(args, deps)
  return { status, stdout, stderr }
}

async function byTicket(): Promise<Report & { tickets: TicketRow[] }> {
  const result = await inProcess(['--transcripts', BY_TICKET, '--json', '--by-ticket'])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as Report & { tickets: TicketRow[] }
}

/** The three rows of the by-ticket fixture: demo-epic/01, demo-epic/02 and the one without a ticket. */
async function threeRows(): Promise<[TicketRow, TicketRow, TicketRow]> {
  const [one, two, none, ...rest] = (await byTicket()).tickets
  if (one === undefined || two === undefined || none === undefined || rest.length > 0) throw new Error('the by-ticket fixture gives three rows')
  return [one, two, none]
}

/** Tokens of a response: input + output + cache read + cache write. */
const tokens = (input: number, output: number, read: number, write: number): number => input + output + read + write

describe('agent-cost --by-ticket on the by-ticket fixture', () => {
  it('gives two tickets and the row without a ticket, and the rows add up to the total without --by-ticket', async () => {
    const r = await byTicket()
    expect(r.tickets.map((row) => row.ticket)).toEqual(['demo-epic/01', 'demo-epic/02', null])
    const plain = await inProcess(['--transcripts', BY_TICKET, '--json'])
    expect(plain.status).toBe(0)
    const total = JSON.parse(plain.stdout) as Report & { tickets?: unknown }
    expect(total.tickets).toBeUndefined()
    expect(r.tickets.reduce((sum, row) => sum + row.cost, 0)).toBeCloseTo(total.cost, 9)
    expect(r.cost).toBeCloseTo(total.cost, 9)
    expect(r.tickets.reduce((sum, row) => sum + row.tokens, 0)).toBe(241335 + tokens(2, 50, 12100, 500))
  })

  it('splits the Orchestrator evenly between the tickets of a Wave, from the wave command on until the next one', async () => {
    const [one, two, none] = await threeRows()
    const wave = tokens(2, 200, 10000, 2000) + tokens(2, 100, 12000, 0)
    expect(one.orchestrator.tokens).toBe(wave / 2)
    // msg_o4 comes after the second wave command, which names demo-epic/02 alone.
    expect(two.orchestrator.tokens).toBe(wave / 2 + tokens(2, 50, 12100, 500))
    expect(two.orchestrator.cost).toBeCloseTo((opus(2, 200, 10000, 2000) + opus(2, 100, 12000, 0)) / 2 + opus(2, 50, 12100, 500), 9)
    expect(none.orchestrator.tokens).toBe(tokens(1, 100, 0, 10000))
    expect(none.tokens).toBe(tokens(1, 100, 0, 10000) + tokens(4, 700, 5000, 9000))
    expect(one.orchestrator.cost + two.orchestrator.cost).toBeCloseTo(opus(2, 200, 10000, 2000) + opus(2, 100, 12000, 0) + opus(2, 50, 12100, 500), 9)
  })

  it('counts the scout of a ticket and its implementer up to the first Edit or Write', async () => {
    const [one, two] = await threeRows()
    expect(one.scout).toEqual({ agents: 0, tokens: 0, cost: 0 })
    expect(two.scout).toEqual({ agents: 1, tokens: tokens(2, 60, 0, 15000) + tokens(1, 400, 15000, 1000), cost: expect.closeTo(opus(2, 60, 0, 15000) + opus(1, 400, 15000, 1000), 9) })
    // msg_a3 carries the Edit only on its second line: it is the first edit, and msg_a4 comes after it.
    expect(one.beforeFirstEdit).toEqual({
      agents: 1,
      tokens: tokens(3, 50, 0, 20000) + tokens(1, 40, 20000, 3000),
      cost: expect.closeTo(opus(3, 50, 0, 20000) + opus(1, 40, 20000, 3000), 9),
      filesRead: 2,
      filesReadEarlier: 0,
    })
    expect(two.beforeFirstEdit).toMatchObject({ agents: 1, tokens: tokens(3, 30, 0, 18000) + tokens(1, 30, 18000, 2000), filesRead: 3, filesReadEarlier: 2 })
    expect(two.scoutingShare.tokens).toBeCloseTo((two.scout.tokens + two.beforeFirstEdit.tokens) / two.tokens, 12)
    expect(two.scoutingShare.cost).toBeCloseTo((two.scout.cost + two.beforeFirstEdit.cost) / two.cost, 12)
  })

  it('keeps an implementer that never calls Edit or Write out of the time before the first edit', async () => {
    const [one, two] = await threeRows()
    expect(one.noEdit).toEqual({ agents: 1, tokens: tokens(2, 80, 10000, 1000), cost: expect.closeTo(opus(2, 80, 10000, 1000), 9) })
    expect(two.noEdit).toEqual({ agents: 0, tokens: 0, cost: 0 })
    expect(one.beforeFirstEdit.agents).toBe(1)
    expect(one.tokens).toBe(tokens(3, 50, 0, 20000) + tokens(1, 40, 20000, 3000) + tokens(1, 300, 23000, 500) + tokens(1, 20, 23500, 100) + tokens(2, 80, 10000, 1000) + one.orchestrator.tokens)
  })

  it('prints a table row per ticket without --json', async () => {
    const result = await inProcess(['--transcripts', BY_TICKET, '--by-ticket'])
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^demo-epic\/02\s/m)
    expect(result.stdout).toMatch(/^\(no ticket\)\s/m)
  })
})

describe('ticketOf', () => {
  it('reads the ticket from the first line, then a Ticket: line, then the first lines of the brief', () => {
    expect(ticketOf('Implement ticket 39 of epic `worfy-throughput` in the repo.')).toBe('worfy-throughput/39')
    expect(ticketOf('Review PR #688 (IDSAD-XL/worfy, ticket worfy-harness 51) through the lens')).toBe('worfy-harness/51')
    expect(ticketOf('Второй круг review PR #691, ticket 3 эпика worfy-browser.')).toBe('worfy-browser/03')
    expect(ticketOf('Repo worktree: /x/.claude/worktrees/c (branch worfy-canvas/18, PR #647)')).toBe('worfy-canvas/18')
    expect(ticketOf('Review PR #498 (worfy-windows ticket 40: pin node-pty)')).toBe('worfy-windows/40')
    expect(ticketOf('Lens: correctness.\nTicket: .scratch/worfy-browser/issues/01-прототип.md')).toBe('worfy-browser/01')
    expect(ticketOf('Goal: ticket demo 01 - add the button.')).toBe('demo/01')
    expect(ticketOf('Lens: correctness.\nRead the PR first.\nTicket worfy-ui 27 is the source.')).toBe('worfy-ui/27')
    expect(ticketOf('Review worfy-ui 05 first.\nTicket: worfy-ui/27')).toBe('worfy-ui/05')
    expect(ticketOf('Lens: correctness, depth high, round 2.\nRepo: /repo, Claude Code 2.1.289')).toBe(null)
    expect(ticketOf('PR #1 of IDSAD-XL/worfy, ADR-0075 and round-2 gate')).toBe(null)
    expect(ticketOf('Lens: correctness.\nRead .scratch/worfy-ui/issues/27-pointer.md first.')).toBe('worfy-ui/27')
  })

  it('takes no ticket from a line of the first lines that only mentions one: a branch, a commit, test output', () => {
    const brief = [
      'Repository: /repo. Read the profile first.',
      'Worktree /repo/.claude/worktrees/x on branch worfy-mvp/11.',
      'Test output: blocks:worfy-mvp/11->16 failed after commit "worfy-polish 41: tidy".',
      'Edits of open tickets (05, 11, worfy-polish 41) stay out of this change.',
    ].join('\n')
    expect(ticketOf(brief)).toBe(null)
  })

  it('reads a Ticket: line that comes after the first lines of the brief', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `Step ${i + 1}: read the profile and the rules.`)
    expect(ticketOf([...lines, 'Ticket: worfy-ui/27'].join('\n'))).toBe('worfy-ui/27')
  })
})

describe('shellReads', () => {
  it('takes the files cat, head, tail and sed -n print, and not a write, a search or an edit', () => {
    expect(shellReads(`sed -n '1,40p' /w/src/c.ts && cat src/b.ts | head -n 5`)).toEqual(['/w/src/c.ts', 'src/b.ts'])
    expect(shellReads('cat > notes.md <<EOF')).toEqual([])
    expect(shellReads(`sed -i 's/a/b/' src/a.ts; grep -n x src/a.ts; tail -20 log.txt 2>/dev/null`)).toEqual([])
    expect(shellReads('head -n 30 "$F" README.md /dev/null')).toEqual(['README.md'])
  })
})

describe('waveTickets', () => {
  it('reads the wave command in both forms and nothing else', () => {
    const command = '<command-message>worfy:epic-wave</command-message>\n<command-name>/worfy:epic-wave</command-name>\n'
    expect(waveTickets(`${command}<command-args>tickets 21, 27 of epic worfy-harness</command-args>`)).toEqual(['worfy-harness/21', 'worfy-harness/27'])
    expect(waveTickets('/epic-wave Ticket-ы 11, 23 эпика worfy-daily')).toEqual(['worfy-daily/11', 'worfy-daily/23'])
    expect(waveTickets('/epic-wave волна 3 эпика worfy-daily')).toEqual([])
    expect(waveTickets('Please run /worfy:epic-wave tickets 01 of epic x later')).toBe(null)
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
