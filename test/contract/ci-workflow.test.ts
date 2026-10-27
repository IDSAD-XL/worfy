// The CI workflow (.github/workflows/ci.yml) checks every pull request and every push to main with
// what gate full runs on the Mac — lint, typecheck, pnpm test on Linux, macOS and Windows, pnpm
// test:e2e and pnpm test:package on macOS — and reports one check, ci-ok, that a merge reads. Here:
// the triggers and limits of the workflow, the job that decides what a run needs
// (scripts/ci-scope.mjs) and the verdict of ci-ok (scripts/ci-ok.mjs). The project has no YAML
// parser, so the workflow is read as text, the way windows-tests-workflow.test.ts reads its
// workflow: block style, one key per line, `#` only at the start of comment lines.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const WORKFLOW = join(REPO, '.github', 'workflows', 'ci.yml')
const SCOPE = join(REPO, 'scripts', 'ci-scope.mjs')
const OK = join(REPO, 'scripts', 'ci-ok.mjs')

/** The workflow without its comment lines and blank lines. */
const code = (): string[] =>
  readFileSync(WORKFLOW, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

const indent = (line: string): number => line.length - line.trimStart().length

/** The lines nested under the line that reads exactly `header`; there must be one such line. */
function under(lines: string[], header: string): string[] {
  expect(lines.filter((line) => line === header), `lines that read "${header}"`).toHaveLength(1)
  const nested: string[] = []
  for (const line of lines.slice(lines.indexOf(header) + 1)) {
    if (indent(line) <= indent(header)) break
    nested.push(line)
  }
  return nested
}

/** The keys one level down in a block: its least indented lines, up to the colon. */
function keys(block: string[]): string[] {
  const least = Math.min(...block.map(indent))
  return block.filter((line) => indent(line) === least).map((line) => line.trim().replace(/:.*$/, ''))
}

/** The value of `key:` among the direct children of a block. */
function value(block: string[], key: string): string | undefined {
  const least = Math.min(...block.map(indent))
  const line = block.find((l) => indent(l) === least && l.trim().startsWith(`${key}:`))
  return line?.trim().slice(key.length + 1).trim()
}

/** The items of a block list (`- a`), without the dash. */
const items = (block: string[]): string[] => block.map((line) => line.trim().replace(/^- /, ''))

const JOBS = ['changes', 'lint-typecheck', 'linux-tests', 'macos-tests', 'macos-e2e', 'macos-package', 'windows', 'ci-ok']
/** The jobs that ci-scope.mjs decides on: every job but itself and ci-ok. */
const DECIDED = JOBS.filter((name) => name !== 'changes' && name !== 'ci-ok')

const job = (name: string): string[] => under(under(code(), 'jobs:'), `  ${name}:`)

/** The commands of a job's `run:` lines, one-line form only. */
const runs = (name: string): string[] =>
  job(name)
    .filter((line) => /^\s*(- )?run: /.test(line))
    .map((line) => line.trim().replace(/^(- )?run: /, ''))

/** The shards of a job's matrix, which must be 1/n … n/n. */
function shards(name: string): string[] {
  const list = items(under(under(under(job(name), '    strategy:'), '      matrix:'), '        shard:'))
  const count = list.length
  expect(list, `${name}: shards`).toEqual(Array.from({ length: count }, (_, at) => `${at + 1}/${count}`))
  expect(value(under(job(name), '    strategy:'), 'fail-fast'), `${name}: every shard runs to its end`).toBe('false')
  return list
}

describe('ci.yml: every pull request and every push to main, one check for the merge', () => {
  it('runs on pull requests, on pushes to main and by hand, never on pull_request_target or a timer', () => {
    const on = under(code(), 'on:')
    expect(keys(on)).toEqual(['pull_request', 'push', 'workflow_dispatch'])
    expect(items(under(under(on, '  pull_request:'), '    types:'))).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review'])
    expect(keys(under(on, '  push:'))).toEqual(['branches'])
    expect(items(under(under(on, '  push:'), '    branches:'))).toEqual(['main'])
    // pull_request_target runs a pull request's code with the base's token and secrets.
    expect(code().join('\n')).not.toMatch(/pull_request_target|schedule|secrets\./)
  })

  it('takes a job input for a run by hand: check by default, or full-macos', () => {
    const input = under(under(under(code(), 'on:'), '    inputs:'), '      job:')
    expect(value(input, 'type')).toBe('choice')
    expect(value(input, 'default')).toBe('check')
    expect(items(under(input, '        options:'))).toEqual(['check', 'full-macos'])
  })

  it('may only read the repository: permissions are contents: read and nothing else', () => {
    expect(code().filter((line) => /permissions/.test(line))).toEqual(['permissions:'])
    expect(under(code(), 'permissions:')).toEqual(['  contents: read'])
  })

  it('runs one run per pull request and cancels the older one; runs on main are never cancelled', () => {
    const group = under(code(), 'concurrency:')
    expect(value(group, 'group')).toBe('ci-${{ github.event.pull_request.number || github.ref }}-${{ inputs.job || github.event_name }}')
    expect(value(group, 'cancel-in-progress')).toBe("${{ github.event_name == 'pull_request' }}")
  })

  it('has the jobs of gate full, each run only when the job changes says the run needs it', () => {
    expect(keys(under(code(), 'jobs:'))).toEqual(JOBS)
    for (const name of DECIDED) {
      expect(value(job(name), 'needs'), name).toBe('changes')
      expect(value(job(name), 'if'), name).toBe(`fromJSON(needs.changes.outputs.expect)['${name}']`)
    }
    expect(value(job('changes'), 'runs-on')).toBe('ubuntu-latest')
    expect(value(job('lint-typecheck'), 'runs-on')).toBe('ubuntu-latest')
    expect(value(job('linux-tests'), 'runs-on')).toBe('ubuntu-latest')
    for (const name of ['macos-tests', 'macos-e2e', 'macos-package']) expect(value(job(name), 'runs-on'), name).toBe('macos-latest')
  })

  it('runs the commands of gate full: lint, typecheck, test on three systems, test:e2e and test:package on macOS', () => {
    expect(runs('lint-typecheck')).toEqual(['pnpm install --frozen-lockfile', 'pnpm lint', 'pnpm typecheck'])
    expect(runs('linux-tests')).toContain('pnpm test "--shard=$SHARD" --sequence.shuffle.files')
    expect(runs('macos-tests')).toEqual(['pnpm install --frozen-lockfile', 'pnpm test "--shard=$SHARD"'])
    expect(runs('macos-e2e')).toEqual(['pnpm install --frozen-lockfile', 'system_profiler SPDisplaysDataType', 'pnpm test:e2e "--shard=$SHARD"'])
    // electron-builder needs the binary that Electron downloads only on its first require.
    expect(runs('macos-package')).toEqual(['pnpm install --frozen-lockfile', `node -e "require('electron')"`, 'pnpm test:package'])
    // Windows: the job full-suite of windows-tests.yml, which runs pnpm test (its own contract test).
    const windows = job('windows')
    expect(value(windows, 'uses')).toBe('./.github/workflows/windows-tests.yml')
    expect(under(windows, '    with:')).toEqual(['      mode: full', '      shard: ${{ matrix.shard }}'])
  })

  it('splits the tests into shards that together cover every file', () => {
    expect(shards('linux-tests')).toHaveLength(4)
    expect(shards('macos-tests')).toHaveLength(2)
    expect(shards('macos-e2e')).toHaveLength(2)
    expect(shards('windows')).toHaveLength(4)
    for (const name of ['linux-tests', 'macos-tests', 'macos-e2e']) {
      expect(job(name), name).toContain('          SHARD: ${{ matrix.shard }}')
    }
  })

  it('pastes no expression into a command: values reach the shell through env', () => {
    for (const line of code().filter((l) => /^\s*(- )?run: /.test(l))) expect(line).not.toContain('${{')
  })

  it('keeps the trace and screenshots of a failed e2e or packaged run', () => {
    for (const name of ['macos-e2e', 'macos-package']) {
      const text = job(name).join('\n')
      expect(text, name).toMatch(/- if: failure\(\)\n\s+uses: actions\/upload-artifact@v\d+/)
      expect(text, name).toContain('path: test-results/')
    }
  })

  it('ci-ok needs every other job, runs whatever happened before it, and asks scripts/ci-ok.mjs', () => {
    const ok = job('ci-ok')
    expect(items(under(ok, '    needs:'))).toEqual(JOBS.filter((name) => name !== 'ci-ok'))
    expect(value(ok, 'if')).toBe('always()')
    expect(ok).toContain('          NEEDS: ${{ toJSON(needs) }}')
    expect(runs('ci-ok')).toEqual(['node scripts/ci-ok.mjs'])
  })

  it('the job changes hands the event, the input and the base to scripts/ci-scope.mjs through env', () => {
    const changes = job('changes')
    expect(value(under(changes, '    outputs:'), 'expect')).toBe('${{ steps.scope.outputs.expect }}')
    expect(changes).toContain('          fetch-depth: 2')
    expect(changes).toContain('          EVENT: ${{ github.event_name }}')
    expect(changes).toContain('          JOB: ${{ inputs.job }}')
    expect(changes).toContain("          BASE: ${{ github.event_name == 'pull_request' && 'HEAD^1' || github.event.before }}")
    expect(runs('changes')).toEqual(['node scripts/ci-scope.mjs'])
  })
})

describe('scripts/ci-scope.mjs', () => {
  let scratch = ''
  let repo = ''
  let base = ''

  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, encoding: 'utf8' }).trim()

  /** A commit on top of `base` that changes the given files; HEAD is left on it. */
  function commitOnBase(files: string[]): void {
    git('checkout', '-q', '--detach', base)
    for (const file of files) {
      mkdirSync(join(repo, dirname(file)), { recursive: true })
      writeFileSync(join(repo, file), `changed ${Math.random()}\n`)
    }
    if (files.length > 0) git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', 'change')
  }

  let outputs = 0
  const scope = (env: Record<string, string>) => {
    const output = join(scratch, `output-${++outputs}`)
    writeFileSync(output, '')
    const result = spawnSync(process.execPath, [SCOPE], { cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, EVENT: '', JOB: '', BASE: '', ...env } })
    const written = /^expect=(.*)$/m.exec(readFileSync(output, 'utf8'))?.[1]
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, expect: written === undefined ? undefined : (JSON.parse(written) as Record<string, boolean>) }
  }

  const ALL = Object.fromEntries(DECIDED.map((name) => [name, true]))
  const ONLY_LINT = Object.fromEntries(DECIDED.map((name) => [name, name === 'lint-typecheck']))

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'worfy-ci-scope-'))
    repo = join(scratch, 'repo')
    mkdirSync(repo)
    git('init', '-q')
    writeFileSync(join(repo, 'package.json'), '{}\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    base = git('rev-parse', 'HEAD')
  })

  afterAll(() => {
    removeTestTree(scratch)
  })

  it('names every job of ci.yml but changes and ci-ok, and a change of code runs them all', () => {
    commitOnBase(['src/main/index.ts'])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(ALL)
    expect(result.stdout).toContain('code changed: src/main/index.ts')
  })

  it.each([
    ['tickets and docs', ['.scratch/epic/issues/01-a.md', 'docs/adr/0001-a.md', 'docs/design/F-1.dc.html']],
    ['Markdown at the root and in other folders', ['HANDOFF.md', 'CONTEXT.md', 'scripts/notes.md']],
  ])('a change of documents only (%s) runs lint-typecheck alone', (_name, files) => {
    commitOnBase(files)
    for (const event of ['pull_request', 'push']) {
      const result = scope({ EVENT: event, BASE: base })
      expect(result.status, result.stderr).toBe(0)
      expect(result.expect, event).toEqual(ONLY_LINT)
      expect(result.stdout).toMatch(/^documents only: /)
    }
  })

  it.each([
    ['Markdown under src/', 'src/renderer/notes.md'],
    ['Markdown under test/', 'test/fixtures/epic/spec.md'],
    ['Markdown under harness/', 'harness/skills/x/SKILL.md'],
    ['README.md, which a test reads', 'README.md'],
    ['the lessons index, which a test reads', 'docs/lessons/README.md'],
    ['a workflow', '.github/workflows/ci.yml'],
    ['package.json', 'package.json'],
  ])('%s next to documents runs every job', (_name, file) => {
    commitOnBase(['docs/adr/0001-a.md', file])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(ALL)
  })

  it.each([
    ['a base of zeros (a new branch)', '0000000000000000000000000000000000000000'],
    ['a base that does not exist', 'f'.repeat(40)],
    ['no base', ''],
  ])('runs every job when the diff cannot be read: %s', (_name, missing) => {
    commitOnBase(['docs/adr/0001-a.md'])
    const result = scope({ EVENT: 'push', BASE: missing })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(ALL)
  })

  it('runs every job when no file changed', () => {
    commitOnBase([])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(ALL)
  })

  it('a run by hand: job check runs lint and the Linux tests, job full-macos lint and the macOS jobs', () => {
    commitOnBase(['docs/adr/0001-a.md'])
    expect(scope({ EVENT: 'workflow_dispatch', JOB: 'check' }).expect).toEqual({ ...ONLY_LINT, 'linux-tests': true })
    expect(scope({ EVENT: 'workflow_dispatch', JOB: 'full-macos' }).expect).toEqual({ ...ONLY_LINT, 'macos-tests': true, 'macos-e2e': true, 'macos-package': true })
  })

  it.each([
    ['an unknown job of a run by hand', { EVENT: 'workflow_dispatch', JOB: 'everything' }, /workflow_dispatch with job "everything"/],
    ['an event ci.yml does not have', { EVENT: 'pull_request_target', BASE: 'x' }, /event "pull_request_target"/],
    ['no event', {}, /event ""/],
  ])('refuses %s and writes no answer', (_name, env, reason) => {
    const result = scope(env)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(reason)
    expect(result.expect).toBeUndefined()
  })
})

describe('scripts/ci-ok.mjs', () => {
  type Needs = Record<string, { result: string; outputs?: Record<string, string> }>

  const needs = (expect: Record<string, boolean>, results: Record<string, string>, changes = 'success'): Needs => ({
    changes: { result: changes, outputs: { expect: JSON.stringify(expect) } },
    ...Object.fromEntries(Object.entries(results).map(([name, result]) => [name, { result, outputs: {} }])),
  })

  const ok = (raw: string) => spawnSync(process.execPath, [OK], { encoding: 'utf8', env: { ...process.env, NEEDS: raw } })

  const ALL = Object.fromEntries(DECIDED.map((name) => [name, true]))
  const ONLY_LINT = Object.fromEntries(DECIDED.map((name) => [name, name === 'lint-typecheck']))
  const results = (each: (name: string) => string) => Object.fromEntries(DECIDED.map((name) => [name, each(name)]))

  it('is green when every needed job succeeded', () => {
    const result = ok(JSON.stringify(needs(ALL, results(() => 'success'))))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('windows: success (needed)')
  })

  it('is green when a change of documents skipped every job but lint-typecheck', () => {
    const result = ok(JSON.stringify(needs(ONLY_LINT, results((name) => (name === 'lint-typecheck' ? 'success' : 'skipped')))))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('linux-tests: skipped (not needed)')
  })

  it.each([
    ['a failed job', ALL, (name: string) => (name === 'macos-e2e' ? 'failure' : 'success'), /macos-e2e: failure, expected success/],
    ['a cancelled job', ALL, (name: string) => (name === 'windows' ? 'cancelled' : 'success'), /windows: cancelled, expected success/],
    ['a needed job that was skipped', ALL, (name: string) => (name === 'linux-tests' ? 'skipped' : 'success'), /linux-tests: skipped, expected success/],
    ['a job that ran though not needed', ONLY_LINT, () => 'success', /linux-tests: success, expected skipped/],
  ])('is red on %s', (_name, expect_, each, reason) => {
    const result = ok(JSON.stringify(needs(expect_, results(each))))
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(reason)
  })

  it('is red when the job changes did not succeed', () => {
    const result = ok(JSON.stringify(needs(ALL, results(() => 'skipped'), 'failure')))
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/changes: failure/)
  })

  it('is red when a job of the workflow is missing from the answer of ci-scope.mjs, or the other way round', () => {
    const extra = needs(ALL, { ...results(() => 'success'), 'new-job': 'success' })
    expect(ok(JSON.stringify(extra)).stderr).toMatch(/new-job: ci-ok needs it, but scripts\/ci-scope\.mjs does not name it/)
    const fewer = results(() => 'success')
    delete fewer.windows
    const missing = ok(JSON.stringify(needs(ALL, fewer)))
    expect(missing.status).toBe(1)
    expect(missing.stderr).toMatch(/windows: in "expect" of changes, but ci-ok does not need it/)
  })

  it.each([
    ['not JSON', 'nope', /NEEDS is not JSON/],
    ['empty', '', /NEEDS is not JSON/],
    ['without changes', JSON.stringify({ 'lint-typecheck': { result: 'success' } }), /no job "changes"/],
    ['with an answer of changes that is not JSON', JSON.stringify({ changes: { result: 'success', outputs: { expect: '' } } }), /"expect" of changes is not JSON/],
  ])('is red when NEEDS is %s', (_name, raw, reason) => {
    const result = ok(raw)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(reason)
  })
})
