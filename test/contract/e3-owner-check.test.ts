// scripts/e3-owner-check.sh (worfy-harness ticket 26, item 3) against a temporary HOME: what it
// counts as a file of the Harness left in ~/.claude, what it reads of settings.json, .claude.json
// and `claude plugin list`, and which journals of an Autopilot run it accepts. The plugin in that
// HOME is a copy of harness/ as the app carries it (no tests, no evals); `claude` is a stub named
// by E3_CLAUDE, and E3_HARNESS_DONE_AT stands for the time the Harness moved. The real ~/.claude
// is never read: HOME is the temporary folder and CLAUDE_CONFIG_DIR is not passed.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitBash } from '../git-bash'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'e3-owner-check.sh')
const DONE_AT = '2026-10-08T02:00:00.000Z'
const NOT_IN_PLUGIN = [join('bin', 'tests'), join('hooks', 'tests'), 'evals']

let scratch: string
let home: string
let claudeHome: string
let plugin: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e3-owner-')))
  home = join(scratch, 'home')
  claudeHome = join(home, '.claude')
  plugin = join(claudeHome, 'worfy-harness', 'plugin')
  mkdirSync(claudeHome, { recursive: true })
  const harness = join(REPO, 'harness')
  cpSync(harness, plugin, { recursive: true, filter: (source) => !NOT_IN_PLUGIN.includes(relative(harness, source)) })
  // A personal ~/.claude after the move, as ticket 16 left the owner's: his own files, and what
  // the plugin does not ship (the Harness's tests and a file under another name).
  put('agents/mine.md', 'personal\n')
  put('skills/mine/SKILL.md', 'personal\n')
  put('bin/telegram-mcp', '#!/bin/sh\n')
  put('bin/tests/ticket.test.sh', '#!/bin/sh\n')
  put('bin/ТИКЕТЫ.md', 'notes\n')
  put('hooks/tests/gate.test.sh', '#!/bin/sh\n')
  put('CLAUDE.md', '# Me\n\n## Standing authorization\n\nyes\n\n## My notes\n\nx\n')
  put('settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '$HOME/.claude/bin/telegram-mcp notify' }] }] } }))
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { telegram: { command: 'x' } } }))
})

afterEach(() => {
  removeTestTree(scratch)
})

/** Writes a file under the temporary ~/.claude. */
function put(rel: string, text: string): void {
  const file = join(claudeHome, ...rel.split('/'))
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

/**
 * A stand-in `claude`: `plugin list --json` prints `plugins`. A Node script, which the check runs
 * with its own node: Windows does not start a `#!/bin/sh` file.
 */
function claudeStub(plugins: unknown = [{ id: 'worfy@worfy-harness', version: '0.2.0+abc', enabled: true }]): string {
  const answer = join(scratch, 'plugins.json')
  writeFileSync(answer, JSON.stringify(plugins))
  const stub = join(scratch, 'claude.mjs')
  writeFileSync(stub, `import { readFileSync } from 'node:fs'\nprocess.stdout.write(readFileSync(${JSON.stringify(answer)}, 'utf8'))\n`)
  return stub
}

type Line = { kind: string } & Record<string, unknown>

/** A journal of one run: every line gets `at` (a minute apart, from `start`), `run`, `project`, `epic`. */
function journal(lines: Line[], start = '2026-10-10T10:00:00.000Z'): string {
  const file = join(scratch, `run-${Math.random().toString(16).slice(2)}.jsonl`)
  const from = Date.parse(start)
  writeFileSync(file, lines.map((line, index) => JSON.stringify({ at: new Date(from + index * 60_000).toISOString(), run: 'r1', project: 'p-00000001', epic: 'demo', ...line })).join('\n') + '\n')
  return file
}

const wave = (kind: string, number: number, tickets: string[]): Line => ({ kind, wave: number, tickets })
const stopped = (reason: string): Line => ({ kind: 'run-stopped', reason })
/** A run whose one Wave finished by itself. */
const FINISHED: Line[] = [{ kind: 'run-started' }, wave('wave-started', 1, ['01']), wave('wave-finished', 1, ['01']), stopped('no-ready-wave')]

function check(journalPath: string | null, options: { claude?: string; env?: Record<string, string> } = {}): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: 'C.UTF-8', E3_CLAUDE: options.claude ?? claudeStub(), E3_HARNESS_DONE_AT: DONE_AT, ...options.env }
  const run = spawnSync(gitBash(), journalPath === null ? [SCRIPT] : [SCRIPT, journalPath], { cwd: scratch, env, encoding: 'utf8', input: '', timeout: 30_000, killSignal: 'SIGKILL' })
  expect(run.error).toBeUndefined()
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

/** Every file under `dir` with its size and modification time. */
function listing(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue
    const file = join(entry.parentPath, entry.name)
    const stats = statSync(file)
    out[relative(dir, file).split(sep).join('/')] = `${stats.size}:${stats.mtimeMs}`
  }
  return out
}

const violations = (stdout: string): string[] => stdout.trim().split('\n').slice(1)

/** A path under the home folder as the check prints it: `~` and the rest joined with the system's separator. */
const tilde = (rel: string): string => join('~', ...rel.split('/'))

describe('e3-owner-check.sh: files of the Harness in ~/.claude', () => {
  it('passes a personal ~/.claude that keeps what the plugin does not ship: bin/tests, bin/ТИКЕТЫ.md, hooks/tests', () => {
    const result = check(journal(FINISHED))
    expect(result.stdout).toContain(`ok: ${tilde('.claude')} holds only personal files`)
    expect(result.status).toBe(0)
  })

  it('names a file the plugin carries under the same name, and exits 1', () => {
    put('bin/epic-status', '#!/bin/sh\n')
    const result = check(journal(FINISHED))
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(`1 violation:\na file of the Harness is still there: ${tilde('.claude/bin/epic-status')}\n`)
  })

  it('names an agent, a skill, a hook, a qmd script and profiles/README.md of the Harness, one line each', () => {
    put('agents/implementer.md', 'x\n')
    put('skills/epic-wave/SKILL.md', 'x\n')
    put('hooks/gate.sh', '#!/bin/sh\n')
    put('bin/qmd-mcp', '#!/bin/sh\n')
    put('profiles/README.md', 'x\n')
    const result = check(journal(FINISHED))
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([
      `a file of the Harness is still there: ${tilde('.claude/agents/implementer.md')}`,
      `a file of the Harness is still there: ${tilde('.claude/skills/epic-wave')}`,
      `a qmd script of the old Harness is still there: ${tilde('.claude/bin/qmd-mcp')}`,
      `a file of the Harness is still there: ${tilde('.claude/hooks/gate.sh')}`,
      `a file of the Harness is still there: ${tilde('.claude/profiles/README.md')}`,
    ])
  })

  it('exits 1 without the plugin folder: a bare ~/.claude has nothing to be compared with', () => {
    removeTestTree(join(claudeHome, 'worfy-harness'))
    put('bin/epic-status', '#!/bin/sh\n')
    const result = check(journal(FINISHED))
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([`the Harness plugin is not in ${tilde('.claude/worfy-harness/plugin')}: nothing to compare ${tilde('.claude')} with`])
  })

  it('names the sections of CLAUDE.md the plugin carries, and leaves the personal ones', () => {
    put('CLAUDE.md', '# Me\n\n## Standing authorization\n\nyes\n\n## Plain language\n\nold\n\n## My notes\n\nx\n')
    const result = check(journal(FINISHED))
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([`a rule of the Harness is still in ${tilde('.claude/CLAUDE.md')}: "Plain language"`])
  })
})

describe('e3-owner-check.sh: settings.json, .claude.json and the plugin', () => {
  it('names a hook that runs a file of ~/.claude that is gone', () => {
    put('settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/gone.sh x' }, { type: 'command', command: '/usr/bin/true' }] }] } }))
    const result = check(journal(FINISHED))
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([`a hook of ${tilde('.claude/settings.json')} (Stop) runs a file that is gone: ${tilde('.claude/hooks/gone.sh')}`])
  })

  it('names every qmd MCP record of .claude.json, the per-project ones too', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { qmd: {} }, projects: { '/x': { mcpServers: { 'qmd-local': {} } } } }))
    const result = check(journal(FINISHED))
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([`${tilde('.claude.json')} still registers qmd: mcpServers.qmd`, `${tilde('.claude.json')} still registers qmd: projects["/x"].mcpServers.qmd-local`])
  })

  it('exits 1 when the worfy plugin is disabled or not listed, 2 when claude cannot run', () => {
    const disabled = check(journal(FINISHED), { claude: claudeStub([{ id: 'worfy@worfy-harness', enabled: false }]) })
    expect(disabled.status).toBe(1)
    expect(violations(disabled.stdout)).toEqual(['claude plugin list --json: worfy@worfy-harness is not enabled'])
    const absent = check(journal(FINISHED), { claude: claudeStub([{ id: 'other@x', enabled: true }]) })
    expect(violations(absent.stdout)).toEqual(['claude plugin list --json: no worfy plugin'])
    const missing = check(journal(FINISHED), { claude: join(scratch, 'no-such-claude') })
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('claude plugin list --json could not run')
  })

  it('reads the Claude home of CLAUDE_CONFIG_DIR, with .claude.json inside it', () => {
    put('.claude.json', JSON.stringify({ mcpServers: { qmd: {} } }))
    const result = check(journal(FINISHED), { env: { HOME: join(scratch, 'elsewhere'), CLAUDE_CONFIG_DIR: claudeHome } })
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([`${join(claudeHome, '.claude.json')} still registers qmd: mcpServers.qmd`])
  })

  it('writes nothing: every file of the temporary HOME is as it was, also when it reports violations', () => {
    put('bin/epic-status', '#!/bin/sh\n')
    const path = journal(FINISHED)
    const stub = claudeStub()
    const before = listing(scratch)
    expect(check(path, { claude: stub }).status).toBe(1)
    expect(listing(scratch)).toEqual(before)
  })
})

describe('e3-owner-check.sh: the journal of the run', () => {
  const stopping = (inWork: string[]): Line => ({ kind: 'run-stopping', reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork })

  it('rule (a): a Wave finished, then the run stopped — any reason, a graceful Stop in the next Wave included', () => {
    const byItself = check(journal(FINISHED))
    expect(byItself.status).toBe(0)
    expect(byItself.stdout).toContain('a Wave ran by rule (a): 1 wave-finished line before run-stopped')
    expect(byItself.stdout).toContain('stopped (no-ready-wave)')
    const lines = [{ kind: 'run-started' }, wave('wave-started', 1, ['01']), wave('wave-finished', 1, ['01']), wave('wave-started', 2, ['02']), { ...stopping(['02']), wave: 2 }, stopped('user-stop'), { kind: 'background-tasks', tasks: [] }, { kind: 'orchestrator-returned' }]
    const thenStop = check(journal(lines))
    expect(thenStop.status).toBe(0)
    expect(thenStop.stdout).toContain('rule (a)')
  })

  it('rule (b): a graceful Stop during the first Wave with Tickets in work passes, and the output names those Tickets', () => {
    const result = check(journal([{ kind: 'run-started' }, wave('wave-started', 1, ['01', '02']), stopping(['01', '02']), { kind: 'background-tasks', tasks: [] }, stopped('user-stop')]))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('a Wave ran by rule (b): a graceful Stop during Wave 1, Tickets in work at the Stop: 01, 02 — compare with their Ticket statuses')
  })

  const NO_WAVE = 'no Wave ran: no wave-finished line before run-stopped'
  it.each<[string, Line[], string]>([
    ['the run stopped with no ready Wave', [{ kind: 'run-started' }, stopped('no-ready-wave')], `${NO_WAVE} (no-ready-wave)`],
    ['a Wave started, the Session failed', [{ kind: 'run-started' }, wave('wave-started', 1, ['01']), { kind: 'session-error', session: 's', message: 'boom' }, stopped('no-progress')], `${NO_WAVE} (no-progress)`],
    ['a graceful Stop with no Ticket in work', [{ kind: 'run-started' }, wave('wave-started', 1, ['01']), stopping([]), stopped('user-stop')], `${NO_WAVE} (user-stop)`],
    ['a Stop before the Wave was taken: no run-stopping line', [{ kind: 'run-started' }, wave('wave-started', 1, ['01']), stopped('user-stop')], `${NO_WAVE} (user-stop)`],
    ['a graceful Stop turned into a Force stop', [{ kind: 'run-started' }, wave('wave-started', 1, ['01']), stopping(['01']), stopped('user-force-stop')], `${NO_WAVE} (user-force-stop)`],
    ['a run-stopping line with no Wave started', [{ kind: 'run-started' }, stopping(['01']), stopped('user-stop')], `${NO_WAVE} (user-stop)`],
    ['a wave-finished line only after run-stopped', [{ kind: 'run-started' }, stopped('no-ready-wave'), wave('wave-finished', 1, ['01'])], `${NO_WAVE} (no-ready-wave)`],
  ])('no Wave ran, exit 1: %s', (_name, lines, message) => {
    const result = check(journal(lines))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(message)
  })

  it('names a refused dialog and a person stepping in, with their line numbers', () => {
    const lines = [{ kind: 'run-started' }, wave('wave-started', 1, ['01']), { kind: 'refused-dialog', session: 's', what: 'permission Bash' }, { kind: 'human-input', source: 'worfy', what: 'message' }, wave('wave-finished', 1, ['01']), stopped('no-ready-wave')]
    const path = journal(lines)
    const result = check(path)
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([`${path}: line 3 is refused-dialog (permission Bash)`, `${path}: line 4 is human-input (message)`])
  })

  it('exits 1 for a run that did not end, or went on after run-stopped', () => {
    const open = journal(FINISHED.slice(0, 3))
    expect(violations(check(open).stdout)).toEqual([`${open}: no run-stopped line (the last line is wave-finished): the run did not end`])
    const wentOn = journal([...FINISHED, wave('wave-started', 2, ['02'])])
    expect(violations(check(wentOn).stdout)).toEqual([`${wentOn}: wave-started after run-stopped: the run went on`])
  })

  it('exits 1 for a run that started before the Harness moved', () => {
    const path = journal(FINISHED, '2026-10-01T10:00:00.000Z')
    const result = check(path)
    expect(result.status).toBe(1)
    expect(violations(result.stdout)).toEqual([`${path}: the run started at 2026-10-01T10:00:00.000Z, not after Ticket 16 became done (${DONE_AT})`])
  })

  it('exits 2 without a journal argument, for a missing journal and for a line that is not JSON', () => {
    expect(check(null).status).toBe(2)
    expect(check(join(scratch, 'missing.jsonl')).status).toBe(2)
    const broken = journal(FINISHED)
    writeFileSync(broken, `${readFileSync(broken, 'utf8')}{"kind":\n`)
    const result = check(broken)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('is not JSON')
  })
})
