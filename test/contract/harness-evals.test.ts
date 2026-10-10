// The eval cases of the Harness (harness/evals/, ticket worfy-harness/27) are run by
// `claude plugin eval` through `pnpm eval:harness`: by hand, on a Mac, against the owner's model
// account. This test is their free part and never starts claude: every case has the files
// `claude plugin eval` needs, every scaffold script builds its fixture in a temporary folder with a
// temporary HOME, the fixture is a project the Harness scripts recognise (bin/profile exit 0,
// epic-status sees four tickets), and the build leaves harness/evals/ out of the app's copy.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const EVALS = join(HARNESS, 'evals')

// The ticket's table of cases; the tag decides which `claude plugin eval` call runs a case.
const CASES: [name: string, tag: 'main' | 'gui'][] = [
  ['epic-wave-tickets', 'main'],
  ['epic-wave-old-form', 'main'],
  ['ship-ticket-local-green', 'main'],
  ['ship-ticket-pr-green-ci', 'main'],
  ['implementer-report', 'main'],
  ['reviewer-verdict', 'main'],
  ['no-os-screen-capture', 'gui'],
  ['status-block', 'main'],
  ['reviewer-intended-breakage', 'main'],
  ['reviewer-simplification', 'main'],
]
// A scaffold script has 120 seconds inside `claude plugin eval`; here it takes about a second.
const SCAFFOLD_TIMEOUT_MS = 60_000

/** The YAML front matter of a case or grader file, as raw text ('' when there is none). */
const frontMatter = (file: string): string => /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
const field = (yaml: string, key: string): string | undefined =>
  new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(yaml)?.[1]?.trim().replace(/^['"]|['"]$/g, '')

const graderFiles = (name: string): string[] => {
  const dir = join(EVALS, name, 'graders')
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.md')).map((file) => join(dir, file)) : []
}

const temps: string[] = []
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

/**
 * Runs a case's scaffold script the way `claude plugin eval --scaffold` does: in an empty
 * workspace, with HOME in a temporary folder and only PATH, HOME and TMPDIR from this process
 * (git in an empty HOME has no identity, so the fixture must not need one).
 */
function scaffold(name: string): { work: string; home: string; run: SpawnSyncReturns<string> } {
  const root = tempDir('worfy-eval-')
  const work = join(root, 'work')
  const home = join(root, 'home')
  mkdirSync(work)
  mkdirSync(home)
  const script = field(readFileSync(join(EVALS, name, 'case.yaml'), 'utf8'), 'scaffold_script') ?? ''
  const run = spawnSync('bash', [join(EVALS, name, script)], {
    cwd: work,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(), TERM: 'dumb' },
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })
  return { work, home, run }
}

/** Runs a Harness script against a scaffolded fixture with only the fixture's HOME. */
const harness = (home: string, cwd: string, script: string, args: string[]): SpawnSyncReturns<string> =>
  spawnSync(join(HARNESS, 'bin', script), args, {
    cwd,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'C.UTF-8' },
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })

describe('harness/evals: the cases', () => {
  it('holds exactly the ten cases', () => {
    const found = existsSync(EVALS)
      ? readdirSync(EVALS, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(EVALS, entry.name, 'prompt.md')))
          .map((entry) => entry.name)
          .sort()
      : []
    expect(found).toEqual(CASES.map(([name]) => name).sort())
  })

  describe.each(CASES)('%s', (name, tag) => {
    it('has prompt.md with its tag and case.yaml with a scaffold script', () => {
      expect(existsSync(join(EVALS, name, 'prompt.md'))).toBe(true)
      expect(field(frontMatter(join(EVALS, name, 'prompt.md')), 'tags')).toBe(`[${tag}]`)
      const yaml = readFileSync(join(EVALS, name, 'case.yaml'), 'utf8')
      expect(field(yaml, 'schema_version')).toBe('1.1')
      expect(field(yaml, 'name')).toBe(name)
      const script = field(yaml, 'scaffold_script')
      expect(script).toBeTruthy()
      expect(existsSync(join(EVALS, name, script ?? ''))).toBe(true)
    })

    it('has at least two graders, one of them tool_used', () => {
      const types = graderFiles(name).map((file) => field(frontMatter(file), 'type'))
      expect(types.length).toBeGreaterThanOrEqual(2)
      expect(types).toContain('tool_used')
      for (const type of types) expect(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm']).toContain(type)
    })

    it('builds its fixture with exit code 0 in a temporary HOME', () => {
      const { work, home, run } = scaffold(name)
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
      expect(existsSync(join(work, '.git'))).toBe(true)
      expect(existsSync(join(home, '.claude', 'worfy-harness', 'projects', 'demo', 'profile.json'))).toBe(true)
    })
  })
})

describe('harness/evals: the fixture is a project the Harness recognises', () => {
  it.each(CASES.map(([name]) => name))('%s: bin/profile -C <fixture> exits 0 with profile demo', (name) => {
    const { work, home, run } = scaffold(name)
    expect(run.status, run.stderr).toBe(0)
    const profile = harness(home, work, 'profile', ['-C', work, '--name'])
    expect(profile.status, profile.stderr).toBe(0)
    expect(profile.stdout.trim()).toBe('demo')
  })

  it('epic-status sees the four tickets of epic demo', () => {
    const { work, home } = scaffold('status-block')
    const status = harness(home, work, 'epic-status', ['--json'])
    expect(status.status, status.stderr).toBe(0)
    const tickets = (JSON.parse(status.stdout) as { tickets: { epic: string }[] }).tickets.filter((t) => t.epic === 'demo')
    expect(tickets).toHaveLength(4)
    const line = harness(home, work, 'epic-status', ['demo'])
    expect(line.status, line.stderr).toBe(0)
    expect(line.stdout).toMatch(/demo 0\/4/)
  })
})

// The fixture's own commands, with the fixture's HOME and no Electron variables.
const inFixture = (home: string, cwd: string, command: string, args: string[]): SpawnSyncReturns<string> =>
  spawnSync(command, args, {
    cwd,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir() },
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })

describe('harness/evals: reviewer-intended-breakage is the diff the case describes', () => {
  it('removes the check the ticket removes on purpose, and hides a rounding defect behind green tests', () => {
    const { work, home, run } = scaffold('reviewer-intended-breakage')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const git = (...args: string[]): string => inFixture(home, work, 'git', args).stdout

    // The reviewer is pointed at origin/main...HEAD on the ticket's branch.
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('demo/01')
    expect(git('status', '--porcelain')).toBe('')
    const diff = git('diff', 'origin/main...HEAD', '--', 'src/percent.mjs')
    expect(diff).toMatch(/^-\s+if \(total === 0\) throw new RangeError/m)
    expect(diff).toMatch(/^\+\s+return Math\.floor\(/m)
    expect(git('diff', '--name-only', 'origin/main...HEAD').trim().split('\n').sort()).toEqual([
      '.scratch/demo/issues/01-alpha.md',
      'src/percent.mjs',
      'test/percent.test.mjs',
    ])

    // The removal is intended only because the ticket says so, and says so on the base branch: the
    // branch adds nothing to the ticket but its status. The only caller handles zero itself.
    const ticket = git('show', 'origin/main:.scratch/demo/issues/01-alpha.md')
    expect(ticket).toContain('Проверку `total === 0` убираем намеренно')
    const ticketDiff = git('diff', 'origin/main...HEAD', '--', '.scratch/demo/issues/01-alpha.md')
    expect(ticketDiff.split('\n').filter((line) => /^[+-][^+-]/.test(line))).toEqual([
      '-Status: open',
      '+Status: claimed — 2026-10-01',
    ])
    expect(ticket).toContain('`percent(2, 3)` —\n  `66.7`')
    expect(readFileSync(join(work, 'src', 'report.mjs'), 'utf8')).toContain("total === 0 ? '—'")

    // The real defect: the branch's tests are green, yet percent(2, 3) is 66.6, not the ticket's 66.7.
    const tests = inFixture(home, work, 'node', ['--test'])
    expect(tests.status, `${tests.stdout}\n${tests.stderr}`).toBe(0)
    const value = inFixture(home, work, 'node', [
      '--input-type=module',
      '-e',
      "import { percent } from './src/percent.mjs'; console.log(percent(2, 3), percent(1, 0))",
    ])
    expect(value.stdout.trim()).toBe('66.6 Infinity')
  })
})

describe('harness/evals: reviewer-simplification is the diff the case describes', () => {
  it('adds a thin wrapper over an existing helper, and two near-copies under a shortcut comment', () => {
    const { work, home, run } = scaffold('reviewer-simplification')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const git = (...args: string[]): string => inFixture(home, work, 'git', args).stdout

    // The reviewer is pointed at origin/main...HEAD on the ticket's branch, with the Profile's name of the lens.
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('demo/01')
    expect(git('status', '--porcelain')).toBe('')
    expect(git('diff', '--name-only', 'origin/main...HEAD').trim().split('\n').sort()).toEqual([
      '.scratch/demo/issues/01-alpha.md',
      'src/export.mjs',
      'test/export.test.mjs',
    ])
    expect(readFileSync(join(EVALS, 'reviewer-simplification', 'prompt.md'), 'utf8')).toContain('одной линзой «упрощение»')

    // The finding: durationText only passes its argument on to a helper the base branch already has.
    expect(git('show', 'origin/main:src/duration.mjs')).toContain('export function formatDuration(ms)')
    const source = readFileSync(join(work, 'src', 'export.mjs'), 'utf8')
    expect(source).toContain('function durationText(ms) {\n  return formatDuration(ms)\n}')
    // The ticket asks for neither the wrapper nor the two copies: both are the implementer's own choice.
    const ticket = git('show', 'origin/main:.scratch/demo/issues/01-alpha.md')
    expect(ticket).not.toMatch(/durationText|shortcut/)

    // Not a finding: the two copies stand under a comment of the form `shortcut: <limit>, <when to redo>`,
    // and its condition — a third format — is not met: the file exports two.
    const comments = source.split('\n').filter((line) => line.includes('shortcut:'))
    expect(comments).toEqual(['// shortcut: csvLine and tsvLine are two copies of one join, redo when a third format appears'])
    expect([...source.matchAll(/^export function (\w+)/gm)].map((match) => match[1])).toEqual(['csvLine', 'tsvLine'])
    expect(source).toContain("durationText(task.ms)].join(',')")
    expect(source).toContain("durationText(task.ms)].join('\\t')")

    // The change itself works: a reviewer has nothing to report but its shape.
    const tests = inFixture(home, work, 'node', ['--test'])
    expect(tests.status, `${tests.stdout}\n${tests.stderr}`).toBe(0)
  })
})

// A stand-in for claude: prints STUB_VERSION for --version; for every other call appends to
// STUB_LOG its arguments and what the target plugin folder holds (manifest, eval folder), and
// exits with the next code from STUB_CODES (comma-separated, one per call).
const STUB = `#!/usr/bin/env node
const { appendFileSync, existsSync, readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log(process.env.STUB_VERSION + ' (Claude Code)'); process.exit(0) }
const log = process.env.STUB_LOG
const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0
const manifest = JSON.parse(readFileSync(join(args[2], '.claude-plugin', 'plugin.json'), 'utf8'))
const evals = readdirSync(join(args[2], 'evals'))
appendFileSync(log, JSON.stringify({ args, manifest, evals, path: process.env.PATH }) + '\\n')
process.exit(Number((process.env.STUB_CODES || '0').split(',')[calls] || 0))
`

interface StubCall {
  args: string[]
  manifest: Record<string, unknown>
  evals: string[]
  path: string
}

/** Runs scripts/eval-harness.mjs against the stub; returns the run and the logged eval calls. */
function evalHarness(
  version: string,
  codes: string,
  args: string[] = [],
  path: (home: string) => string = () => process.env.PATH ?? '',
): { run: SpawnSyncReturns<string>; calls: StubCall[] } {
  const dir = tempDir('worfy-eval-stub-')
  const claude = join(dir, 'claude')
  writeFileSync(claude, STUB)
  chmodSync(claude, 0o755)
  const log = join(dir, 'calls.log')
  const run = spawnSync(process.execPath, [join(REPO, 'scripts', 'eval-harness.mjs'), ...args], {
    env: {
      PATH: path(dir),
      HOME: dir,
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDE_BIN: claude,
      STUB_VERSION: version,
      STUB_CODES: codes,
      STUB_LOG: log,
    },
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StubCall)
    : []
  return { run, calls }
}

const readManifestOf = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>

/** The values of a variadic option: everything after it up to the next option. */
const listAfter = (args: string[], option: string): string[] => {
  const from = args.indexOf(option) + 1
  const end = args.findIndex((arg, i) => i >= from && arg.startsWith('--'))
  return args.slice(from, end === -1 ? undefined : end)
}

describe('pnpm eval:harness (scripts/eval-harness.mjs, claude replaced by a stub)', () => {
  it('refuses with exit code 1 on claude older than 2.1.269 and runs nothing', () => {
    const { run, calls } = evalHarness('2.1.268', '0,0')
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/2\.1\.269/)
    expect(calls).toEqual([])
  })

  it('makes two calls with the flags of the ticket and a narrow Bash for the gui case', () => {
    const { run, calls: logged } = evalHarness('2.1.289', '0,0')
    expect(run.status, run.stderr).toBe(0)
    expect(logged).toHaveLength(2)
    const calls = logged.map((call) => call.args)
    for (const args of calls) {
      expect(args.slice(0, 2)).toEqual(['plugin', 'eval'])
      for (const flag of ['--scaffold', '--trust-plugin', '--no-publish']) expect(args).toContain(flag)
      expect(listAfter(args, '--ablation')).toEqual(['none'])
      expect(listAfter(args, '--threshold')).toEqual(['0.8'])
      expect(listAfter(args, '--max-cost-usd')).toEqual(['30'])
      expect(listAfter(args, '--model')).toHaveLength(1)
      expect(listAfter(args, '--judge-model')).toHaveLength(1)
    }
    const [main = [], gui = []] = calls
    expect(listAfter(main, '--tag')).toEqual(['main'])
    expect(listAfter(main, '--allow-tools')).toEqual(['Bash', 'Write', 'Edit'])
    expect(listAfter(gui, '--tag')).toEqual(['gui'])
    const guiGrants = listAfter(gui, '--allow-tools')
    expect(guiGrants).not.toContain('Bash')
    expect(guiGrants.filter((grant) => grant.startsWith('Bash(')).length).toBeGreaterThan(0)
    expect(guiGrants.filter((grant) => grant.includes(main[2] ?? '<no target>'))).not.toEqual([])
    expect(run.stdout).toContain(join('harness', 'evals', 'results'))
    expect(run.stdout).toMatch(/aggregate-result\.json/)
    expect(run.stdout).toMatch(/report\.html/)
  })

  it('evaluates a removed copy of harness/ whose manifest has no dependencies', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0')
    expect(run.status, run.stderr).toBe(0)
    const [first, second] = calls
    if (!first || !second) throw new Error(`expected two eval calls, got ${calls.length}`)
    const target = first.args[2] ?? ''
    expect(target).not.toBe(HARNESS)
    expect(second.args[2]).toBe(target)
    // Claude Code refuses a plugin whose dependency is not installed, and a run installs none.
    expect(readManifestOf(HARNESS)).toHaveProperty('dependencies')
    expect(first.manifest).not.toHaveProperty('dependencies')
    expect(first.manifest.name).toBe('worfy')
    expect(first.evals).toEqual(expect.arrayContaining(CASES.map(([name]) => name)))
    expect(first.evals).not.toContain('results')
    expect(existsSync(target)).toBe(false)
  })

  it('keeps other Harness copies off the PATH of the run', () => {
    const others = (home: string): string[] => [
      join(home, '.claude', 'bin'),
      join(home, '.claude', 'worfy-harness', 'plugin', 'bin'),
      '/Users/x/Applications/worfy-stable.app/Contents/Resources/harness/bin',
    ]
    let home = ''
    const { run, calls } = evalHarness('2.1.289', '0,0', [], (dir) => {
      home = dir
      return [...others(dir), process.env.PATH ?? ''].join(delimiter)
    })
    expect(run.status, run.stderr).toBe(0)
    const path = (calls[0]?.path ?? '').split(delimiter)
    for (const dir of others(home)) expect(path).not.toContain(dir)
    expect(path).toEqual(expect.arrayContaining((process.env.PATH ?? '').split(delimiter).filter((dir) => !/(harness|worfy-harness[\\/]plugin)[\\/]bin$/.test(dir))))
  })

  it.each([
    ['1,0', 1],
    ['0,2', 2],
    ['2,1', 2],
    ['130,0', 130],
  ])('exits with the worst code of the calls (%s -> %i)', (codes, worst) => {
    expect(evalHarness('2.1.289', codes).run.status).toBe(worst)
  })

  it('passes the arguments after -- through and skips a call that selects no case', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0', ['--', '--case', 'status-block', '--runs', '1'])
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(1)
    const args = calls[0]?.args ?? []
    expect(listAfter(args, '--tag')).toEqual(['main'])
    expect(args.slice(-4)).toEqual(['--case', 'status-block', '--runs', '1'])
    expect(run.stdout).toMatch(/no gui case selected/)
  })
})

describe('harness/evals stays out of the app', () => {
  it('the build leaves evals/ out of its copy of harness/', async () => {
    // Loaded by path: electron.vite.config.ts belongs to tsconfig.node.json, not to the test project.
    const config = join(REPO, 'electron.vite.config.ts')
    const { HARNESS_NOT_BUNDLED } = (await import(config)) as { HARNESS_NOT_BUNDLED: string[] }
    expect(HARNESS_NOT_BUNDLED).toContain('evals')
  })

  it('the run results are ignored by git', () => {
    const ignored = spawnSync('git', ['check-ignore', '-q', `harness${sep}evals${sep}results${sep}x${sep}report.html`], { cwd: REPO })
    expect(ignored.status).toBe(0)
  })
})
