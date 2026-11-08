// `gate-failures rerun` (harness/lib/gate-failures/rerun.mjs): the failed tests of a red run, run again one at a time
// on the same SHA, and the rerun file it writes. Every test gets a temporary git repository, a temporary Harness home
// (HARNESS_HOME, with machine.json and, where the e2e lock is the subject, a profile that sets workflow.e2e_lock to
// a temporary folder) and a temporary gate state (CLAUDE_GATE_STATE). The tests themselves are a stub script
// (test/fixtures/gate-failures/rerun/stub-test.mjs) that leaves a trace file per run. No test takes the real e2e
// lock or touches the Harness home of this machine. Each world() is a new folder (a retry of a red test does not
// meet the repository of its first attempt), and its git runs without the global and system config of the machine.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkRerunRecord, testId, type FailureRecord, type RunRecord } from '../../harness/hooks/gate-failures.mjs'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const CLI = join(process.cwd(), 'harness', 'bin', 'gate-failures')
const FIXTURES = join(process.cwd(), 'test', 'fixtures', 'gate-failures', 'rerun')
const STUB = join(FIXTURES, 'stub-test.mjs')
const OWN = '0a1b2c3d'
const OTHER = '9f8e7d6c'
const POSIX = process.platform !== 'win32'

let root: string
// An empty file in place of the global git config of the machine (GIT_CONFIG_GLOBAL).
let noGitConfig: string

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gate-failures-rerun-')))
  noGitConfig = join(root, 'gitconfig')
  writeFileSync(noGitConfig, '')
})

afterAll(() => {
  removeTestTree(root)
})

interface World {
  repo: string
  home: string
  state: string
  trace: string
  bin: string
  lock: string
  head: string
  tag: string
}

// git of the test's own setup: neither the global nor the system config of the machine (an identity, hooks,
// core.autocrlf of a CI runner) changes what it does. Its error carries both streams: git says "nothing to
// commit" on stdout.
function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: noGitConfig, GIT_CONFIG_NOSYSTEM: '1' }
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env })
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} (exit ${run.status ?? run.signal}): ${run.stderr}${run.stdout}`)
  return run.stdout.trim()
}

// A committed repository, a Harness home with machine.json of the computer OWN, an empty gate state and a trace
// folder, all in a new folder <root>/<name>-XXXXXX: a retry of a red test gets a new one, not the repository its
// first attempt committed (where `git commit` has nothing to commit). With `lock`, the profile of the repository
// sets workflow.e2e_lock to <world>/e2e.lock. The repository's own config sets core.autocrlf false, so the CLI's
// `git status` there does not depend on the config of the machine either.
function world(name: string, { lock = false }: { lock?: boolean } = {}): World {
  const base = mkdtempSync(join(root, `${name}-`))
  const w: World = {
    repo: join(base, 'repo'),
    home: join(base, 'harness-home'),
    state: join(base, 'state'),
    trace: join(base, 'trace'),
    bin: join(base, 'bin'),
    lock: join(base, 'e2e.lock'),
    head: '',
    tag: '',
  }
  for (const dir of [w.repo, join(w.home, 'gate'), w.state, w.trace, w.bin]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(w.home, 'gate', 'machine.json'), JSON.stringify({ id: OWN, name: 'mac' }))
  git(w.repo, 'init', '-q')
  git(w.repo, 'config', 'user.email', 'test@example.invalid')
  git(w.repo, 'config', 'user.name', 'test')
  git(w.repo, 'config', 'commit.gpgsign', 'false')
  git(w.repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(w.repo, 'README.md'), 'demo\n')
  git(w.repo, 'add', '.')
  git(w.repo, 'commit', '-q', '-m', 'demo')
  w.head = git(w.repo, 'rev-parse', 'HEAD')
  w.tag = createHash('sha1').update(git(w.repo, 'rev-parse', '--show-toplevel')).digest('hex').slice(0, 8)
  if (lock) {
    const entry = { key: 'demo', match: realpathSync.native(w.repo), profile: 'demo', pm: 'npm', root: {}, workspace: {} }
    writeFileSync(join(w.home, 'gate', 'config.json'), JSON.stringify({ repos: [entry] }))
    mkdirSync(join(w.home, 'projects', 'demo'), { recursive: true })
    writeFileSync(
      join(w.home, 'projects', 'demo', 'profile.json'),
      JSON.stringify({ schema: 2, name: 'demo', mode: 'full', attribution: 'on', workflow: { e2e_lock: w.lock } }),
    )
  }
  // An `ioreg` that says the screen is unlocked, so the real screen of this machine never makes a test wait.
  if (POSIX) screen(w, 0)
  return w
}

// An `ioreg` stand-in in <world>/bin: "IOConsoleLocked" = Yes for its first `lockedCalls` calls, No after; each call
// is counted in <world>/trace/ioreg.count.
function screen(w: World, lockedCalls: number): void {
  const file = join(w.bin, 'ioreg')
  const count = join(w.trace, 'ioreg.count')
  writeFileSync(
    file,
    [
      '#!/bin/sh',
      `n=$(cat '${count}' 2>/dev/null || echo 0)`,
      'n=$((n + 1))',
      `echo "$n" > '${count}'`,
      `if [ "$n" -le ${lockedCalls} ]; then echo '  "IOConsoleLocked" = Yes'; else echo '  "IOConsoleLocked" = No'; fi`,
      '',
    ].join('\n'),
  )
  chmodSync(file, 0o755)
}

// A failure record of a stub test: green or red alone, after `wait` ms; `runner` vitest unless given.
function stubFailure(w: World, name: string, exit: number, { wait = 50, runner = 'vitest', lock = false } = {}): FailureRecord {
  const file = `test/${runner === 'playwright' ? 'e2e' : 'unit'}/${name}.test.ts`
  const rerun = ['node', STUB, w.trace, name, String(exit), String(wait), ...(lock ? [w.lock] : [])]
  return { step: `demo/.:${runner === 'playwright' ? 'test:e2e' : 'test'}`, runner, file, line: 3, name: `${name} > works`, test: testId(runner, file, `${name} > works`), ms: 100, error: 'was red', attempt: 1, rerun }
}

function fixtureFailures(w: World): FailureRecord[] {
  const text = readFileSync(join(FIXTURES, 'run-three.json'), 'utf8')
  const failures = (JSON.parse(text) as { failures: FailureRecord[] }).failures
  return failures.map((f) => ({ ...f, rerun: f.rerun && f.rerun.map((a) => (a === '<stub>' ? STUB : a === '<trace>' ? w.trace : a)) }))
}

function runRecord(w: World, failures: FailureRecord[], { run = 'r1', computer = OWN, head = w.head } = {}): RunRecord {
  return {
    version: 1,
    kind: 'run',
    run: `${w.tag}/${run}`,
    at: '2026-11-04T10:00:00Z',
    key: 'demo',
    profile: 'full',
    head,
    outcome: 'red',
    computer: { id: computer, name: 'mac', platform: process.platform },
    dirty: false,
    failures,
  }
}

function put(w: World, record: RunRecord, dir = join(w.state, 'failures')): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${record.run.replace('/', '--')}.json`), `${JSON.stringify(record, null, 2)}\n`)
}

function env(w: World, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    HARNESS_HOME: w.home,
    CLAUDE_GATE_STATE: w.state,
    EVAL_HARNESS_HOME: '',
    // The rerun must not hand the file of the gate's reporters to the tests it starts.
    GATE_FAILURES_FILE: join(w.trace, 'should-not-be-seen.jsonl'),
    WAVE_GATE_LOCK_POLL_S: '0.1',
    WAVE_GATE_SCREEN_POLL_S: '0.1',
    PATH: `${w.bin}${delimiter}${process.env.PATH ?? ''}`,
    ...extra,
  }
  delete e.CLAUDE_GATE_CONFIG
  return e
}

interface Ran {
  status: number | null
  stdout: string
  stderr: string
}

function cli(w: World, args: string[]): Ran {
  const run = spawnSync(scriptNode(), [CLI, 'rerun', ...args], { cwd: w.repo, encoding: 'utf8', env: env(w) })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

// The CLI started in the background: its pid, its output so far and the promise of its end.
function start(w: World, args: string[]): { pid: number; out: () => string; done: Promise<Ran>; kill: (sig: NodeJS.Signals) => void } {
  const child = spawn(scriptNode(), [CLI, 'rerun', ...args], { cwd: w.repo, env: env(w), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (b: Buffer) => (stdout += b.toString()))
  child.stderr.on('data', (b: Buffer) => (stderr += b.toString()))
  const done = new Promise<Ran>((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr })))
  return { pid: child.pid ?? -1, out: () => stdout, done, kill: (sig) => child.kill(sig) }
}

async function until(what: string, ok: () => boolean, limit = ms(8_000)): Promise<void> {
  for (const end = Date.now() + limit; !ok(); ) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

interface Trace {
  name: string
  pid: number
  cwd: string
  start: number
  end: number
  failuresFile: string | null
  holder: { pid: number; what: string } | null
}

function traces(w: World): Trace[] {
  return readdirSync(w.trace)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(w.trace, f), 'utf8')) as Trace)
    .sort((a, b) => a.start - b.start)
}

function rerunFiles(w: World): string[] {
  const dir = join(w.state, 'failures')
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.includes('.rerun-')) : []
}

interface RerunFile {
  kind: string
  of: string
  head: string
  computer: { id: string }
  interrupted: boolean
  results: { test: string; exit: number | null; ms: number | null; error: string | null }[]
}

function rerunFile(w: World): RerunFile {
  const files = rerunFiles(w)
  expect(files).toHaveLength(1)
  const record = JSON.parse(readFileSync(join(w.state, 'failures', files[0] ?? ''), 'utf8')) as RerunFile
  expect(checkRerunRecord(record)).toBeNull()
  return record
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// errorText of rerun.mjs, loaded by its URL: the module has no type declarations.
type ErrorText = (stderr: string, stdout: string, code: number, ctx: { repo?: string; home?: string; host?: string; user?: string }) => string
async function errorText(): Promise<ErrorText> {
  const url = pathToFileURL(join(process.cwd(), 'harness', 'lib', 'gate-failures', 'rerun.mjs')).href
  return ((await import(url)) as { errorText: ErrorText }).errorText
}

describe('the error line of a red rerun', () => {
  it('writes a path under a Windows root from the root with "/", in every spelling of that root, on any OS', async () => {
    const text = await errorText()
    const ctx = { repo: 'D:\\a\\worfy\\worfy', home: 'C:\\Users\\runneradmin', host: 'fv-az123', user: 'runneradmin' }
    const err = (path: string) => `\nAssertionError: red failed in ${path}\n    at more\n`
    expect(text(err('D:\\a\\worfy\\worfy\\test\\x.test.ts'), '', 1, ctx)).toBe('AssertionError: red failed in <repo>/test/x.test.ts')
    // JSON doubles "\"; Git Bash writes /d/…; Windows ignores the letter case
    expect(text(err('D:\\\\a\\\\worfy\\\\worfy\\\\test\\\\x.test.ts'), '', 1, ctx)).toBe('AssertionError: red failed in <repo>/test/x.test.ts')
    expect(text(err('/d/a/worfy/worfy/test/x.test.ts'), '', 1, ctx)).toBe('AssertionError: red failed in <repo>/test/x.test.ts')
    expect(text(err('d:\\A\\Worfy\\worfy\\test\\x.test.ts'), '', 1, ctx)).toBe('AssertionError: red failed in <repo>/test/x.test.ts')
    // the line and column after the path, and what follows it, stay as they were
    expect(text('Error: at fn (D:\\a\\worfy\\worfy\\src\\a.ts:12:5), then "D:\\a\\worfy\\worfy\\x.ts"', '', 1, ctx)).toBe(
      'Error: at fn (<repo>/src/a.ts:12:5), then "<repo>/x.ts"',
    )
  })

  it('leaves a POSIX path under the root as it was, and a path outside the root alone', async () => {
    const text = await errorText()
    const ctx = { repo: '/work/repo', home: '/home/someone', host: 'box-1', user: 'dev' }
    expect(text('AssertionError: failed in /work/repo/test/x.test.ts:3', '', 1, ctx)).toBe('AssertionError: failed in <repo>/test/x.test.ts:3')
    expect(text('Error: cannot read E:\\data\\x.json', '', 1, ctx)).toBe('Error: cannot read E:\\data\\x.json')
  })
})

describe('the setup of these tests', () => {
  it('gives each world() a repository of its own, even under the same name (a retry of a red test makes it again)', () => {
    const first = world('again')
    const second = world('again')
    expect(second.repo).not.toBe(first.repo)
    expect(git(second.repo, 'status', '--porcelain')).toBe('')
    expect(git(second.repo, 'rev-list', '--count', 'HEAD')).toBe('1')
  })

  it('commits whatever the global git config of the machine says', () => {
    const hooks = join(root, 'global-hooks')
    mkdirSync(hooks, { recursive: true })
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(hooks, 'pre-commit'), 0o755)
    const hostile = join(root, 'hostile-gitconfig')
    writeFileSync(hostile, `[core]\n\thooksPath = ${hooks.replaceAll('\\', '/')}\n[user]\n\tuseConfigOnly = true\n`)
    const saved = process.env.GIT_CONFIG_GLOBAL
    process.env.GIT_CONFIG_GLOBAL = hostile
    try {
      const w = world('hostile')
      expect(git(w.repo, 'rev-list', '--count', 'HEAD')).toBe('1')
    } finally {
      if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = saved
    }
  })
})

describe('gate-failures rerun', () => {
  it('runs each test with a rerun argv alone, lists the one without as "cannot rerun", writes the rerun file and exits 2 on a red one', () => {
    const w = world('three')
    put(w, runRecord(w, fixtureFailures(w)))
    const r = cli(w, [])
    expect(r.status, r.stdout + r.stderr).toBe(2)
    const record = rerunFile(w)
    expect(record).toMatchObject({ kind: 'rerun', of: `${w.tag}/r1`, head: w.head, computer: { id: OWN }, interrupted: false })
    const by = new Map(record.results.map((x) => [x.test, x]))
    expect(record.results).toHaveLength(3)
    expect(by.get('vitest test/unit/alone.test.ts > alone > goes green')).toMatchObject({ exit: 0, error: null })
    const red = by.get('vitest test/unit/alone.test.ts > alone > stays red')
    expect(red?.exit).toBe(1)
    expect(red?.ms).toEqual(expect.any(Number))
    // the first line of the error, with the root of the worktree scrubbed
    expect(red?.error).toBe('AssertionError: red failed in <repo>/test/x.test.ts')
    expect(by.get('vitest test/unit/other.test.ts > other > has no rerun')).toEqual({ test: 'vitest test/unit/other.test.ts > other > has no rerun', exit: null, ms: null, error: 'cannot rerun: the record has no rerun argv' })
    expect(r.stdout).toMatch(/cannot rerun/)

    const ran = traces(w)
    expect(ran.map((t) => t.name).sort()).toEqual(['green', 'red'])
    for (const t of ran) {
      expect(realpathSync.native(t.cwd)).toBe(realpathSync.native(w.repo))
      expect(t.failuresFile).toBeNull()
    }
  })

  it('exits 0 when every test is green alone', () => {
    const w = world('green')
    put(w, runRecord(w, [stubFailure(w, 'one', 0), stubFailure(w, 'two', 0)]))
    const r = cli(w, ['--last'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(rerunFile(w).results.map((x) => x.exit)).toEqual([0, 0])
  })

  it('refuses a run from imported/ and a run of another computer with exit 3, and starts no test', () => {
    const w = world('foreign')
    const imported = runRecord(w, [stubFailure(w, 'imported', 0)], { run: 'r-imp', computer: OTHER })
    put(w, imported, join(w.state, 'failures', 'imported', OTHER))
    const r1 = cli(w, ['--run', imported.run])
    expect(r1.status, r1.stdout + r1.stderr).toBe(3)
    expect(r1.stderr).toMatch(/not a run of this computer/)

    const other = runRecord(w, [stubFailure(w, 'other', 0)], { run: 'r-other', computer: OTHER })
    put(w, other)
    const r2 = cli(w, ['--run', other.run])
    expect(r2.status, r2.stdout + r2.stderr).toBe(3)
    expect(r2.stderr).toMatch(/not a run of this computer/)
    const r3 = cli(w, ['--last'])
    expect(r3.status, r3.stdout + r3.stderr).toBe(3)
    expect(r3.stderr).toMatch(/not a run of this computer/)

    expect(readdirSync(w.trace).filter((f) => !f.startsWith('ioreg'))).toEqual([])
    expect(rerunFiles(w)).toEqual([])
  })

  it('refuses with exit 3 when HEAD is not the SHA of the run or the tree is dirty, and starts no test', () => {
    const w = world('head')
    put(w, runRecord(w, [stubFailure(w, 'moved', 0)], { head: '0123456789abcdef0123456789abcdef01234567' }))
    const moved = cli(w, [])
    expect(moved.status, moved.stdout + moved.stderr).toBe(3)
    expect(moved.stderr).toMatch(/HEAD is not the SHA of the run/)

    const d = world('dirty')
    put(d, runRecord(d, [stubFailure(d, 'dirty', 0)]))
    writeFileSync(join(d.repo, 'README.md'), 'changed\n')
    const dirty = cli(d, [])
    expect(dirty.status, dirty.stdout + dirty.stderr).toBe(3)
    expect(dirty.stderr).toMatch(/not clean/)

    for (const x of [w, d]) {
      expect(readdirSync(x.trace).filter((f) => !f.startsWith('ioreg'))).toEqual([])
      expect(rerunFiles(x)).toEqual([])
    }
  })

  it('--dry-run prints the list and the estimate, and neither runs nor writes anything', () => {
    const w = world('dry')
    put(w, runRecord(w, fixtureFailures(w)))
    const r = cli(w, ['--dry-run'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('vitest test/unit/alone.test.ts > alone > goes green')
    expect(r.stdout).toContain('vitest test/unit/alone.test.ts > alone > stays red')
    expect(r.stdout).toMatch(/cannot rerun.*other > has no rerun/)
    // 1200 + 800 ms of the two records with a rerun argv
    expect(r.stdout).toMatch(/2 test\(s\) to run one at a time, about 2 s/)
    expect(readdirSync(w.trace).filter((f) => !f.startsWith('ioreg'))).toEqual([])
    expect(rerunFiles(w)).toEqual([])
  })

  it('runs the tests one at a time and leaves no child process behind', () => {
    const w = world('serial')
    put(w, runRecord(w, [stubFailure(w, 'a', 0, { wait: 150 }), stubFailure(w, 'b', 1, { wait: 150 }), stubFailure(w, 'c', 0, { wait: 150 })]))
    const r = cli(w, [])
    expect(r.status, r.stdout + r.stderr).toBe(2)
    const ran = traces(w)
    expect(ran.map((t) => t.name)).toEqual(['a', 'b', 'c'])
    for (let i = 1; i < ran.length; i++) expect(ran[i]!.start).toBeGreaterThanOrEqual(ran[i - 1]!.end)
    for (const t of ran) expect(alive(t.pid), `pid ${t.pid} of ${t.name}`).toBe(false)
  })

  it('takes no e2e lock for vitest reruns, waits for a lock someone else holds before the Playwright ones, and releases its own', async () => {
    const w = world('lock', { lock: true })
    put(w, runRecord(w, [stubFailure(w, 'unit', 0, { lock: true }), stubFailure(w, 'e2e', 0, { runner: 'playwright', lock: true })]))
    mkdirSync(w.lock)
    const run = start(w, [])
    await until('the wait for the e2e lock', () => run.out().includes('waiting for the e2e lock'))
    expect(existsSync(join(w.trace, 'e2e.started'))).toBe(false)
    removeTestTree(w.lock)
    const r = await run.done
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const [unit, e2e] = [traces(w).find((t) => t.name === 'unit'), traces(w).find((t) => t.name === 'e2e')]
    expect(unit?.holder).toBeNull()
    expect(e2e?.holder).toMatchObject({ pid: run.pid, what: 'rerun' })
    expect(existsSync(w.lock)).toBe(false)
  })

  it.skipIf(!POSIX)('on SIGTERM during an e2e rerun ends it, releases the lock and writes what it has with interrupted: true', async () => {
    const w = world('sigterm', { lock: true })
    put(w, runRecord(w, [stubFailure(w, 'first', 0, { runner: 'playwright' }), stubFailure(w, 'long', 0, { runner: 'playwright', wait: 60_000 })]))
    const run = start(w, [])
    await until('the long e2e rerun', () => existsSync(join(w.trace, 'long.started')))
    const stub = Number(readFileSync(join(w.trace, 'long.started'), 'utf8'))
    expect(existsSync(w.lock)).toBe(true)
    run.kill('SIGTERM')
    const r = await run.done
    expect(r.status, r.stdout + r.stderr).toBe(143)
    expect(existsSync(w.lock)).toBe(false)
    const record = rerunFile(w)
    expect(record.interrupted).toBe(true)
    expect(record.results.map((x) => x.test)).toEqual([testId('playwright', 'test/e2e/first.test.ts', 'first > works')])
    await until('the end of the stopped test', () => !alive(stub))
  })

  it.skipIf(!POSIX)('waits while the screen is locked and starts the e2e rerun once it is unlocked', () => {
    const w = world('screen', { lock: true })
    screen(w, 1)
    put(w, runRecord(w, [stubFailure(w, 'window', 0, { runner: 'playwright' })]))
    const r = cli(w, [])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/screen locked: the e2e rerun waits/)
    expect(Number(readFileSync(join(w.trace, 'ioreg.count'), 'utf8'))).toBeGreaterThanOrEqual(2)
    expect(traces(w).map((t) => t.name)).toEqual(['window'])
  })
})
