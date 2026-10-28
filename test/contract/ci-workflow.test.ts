// The CI workflow (.github/workflows/ci.yml) checks every pull request and every push to main with
// what gate full runs on the Mac — lint, typecheck, pnpm test on Linux, macOS and Windows, pnpm
// test:e2e and pnpm test:package on macOS — and reports one check, ci-ok, that a merge reads. Here:
// the triggers and limits of the workflow, the job that decides what a run needs
// (scripts/ci-scope.mjs) and the verdict of ci-ok (scripts/ci-ok.mjs). The project has no YAML
// parser, so the workflow is read as text, the way windows-tests-workflow.test.ts reads its
// workflow: block style, one key per line, `#` only at the start of comment lines.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(__dirname, '..', '..')
const WORKFLOW = join(REPO, '.github', 'workflows', 'ci.yml')
const SCOPE = join(REPO, 'scripts', 'ci-scope.mjs')
const OK = join(REPO, 'scripts', 'ci-ok.mjs')

/** A workflow file without its comment lines and blank lines. */
const codeOf = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

/** ci.yml without its comment lines and blank lines. */
const code = (): string[] => codeOf(WORKFLOW)

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

  it('runs one run per pull request and cancels the older one; a push to main has a group of its own commit', () => {
    const group = under(code(), 'concurrency:')
    // GitHub keeps one waiting run per group and cancels the older waiting one, so pushes to main that
    // shared a group could cancel the run of a merged pull request before it started; github.sha in
    // the group of a push keeps every push to main in a group of its own.
    expect(value(group, 'group')).toBe(
      "ci-${{ github.event.pull_request.number || github.ref }}-${{ inputs.job || github.event_name }}${{ github.event_name == 'push' && format('-{0}', github.sha) || '' }}",
    )
    expect(value(group, 'cancel-in-progress')).toBe("${{ github.event_name == 'pull_request' }}")
  })

  it('pins the third-party action pnpm/action-setup by the commit of its tag v6, the same in every job', () => {
    const lines = code().filter((line) => line.includes('pnpm/action-setup'))
    expect(lines).toHaveLength(['lint-typecheck', 'linux-tests', 'macos-tests', 'macos-e2e', 'macos-package'].length)
    for (const line of lines) expect(line.trim()).toMatch(/^- uses: pnpm\/action-setup@[0-9a-f]{40} # v6$/)
    expect(new Set(lines.map((line) => line.trim())).size).toBe(1)
  })

  it('keeps no token in .git/config: every checkout of every workflow sets persist-credentials: false', () => {
    const folder = dirname(WORKFLOW)
    const files = readdirSync(folder).filter((name) => /\.ya?ml$/.test(name))
    expect(files).toEqual(expect.arrayContaining(['ci.yml', 'windows-tests.yml']))
    for (const file of files) {
      const lines = codeOf(join(folder, file))
      const checkouts = lines.flatMap((line, at) => (/^\s*- uses: actions\/checkout@/.test(line) ? [at] : []))
      expect(checkouts.length, file).toBeGreaterThan(0)
      for (const at of checkouts) {
        const step: string[] = []
        for (const line of lines.slice(at + 1)) {
          if (indent(line) <= indent(lines[at] ?? '')) break
          step.push(line.trim())
        }
        expect(step, `${file}: checkout number ${checkouts.indexOf(at) + 1}`).toContain('persist-credentials: false')
      }
    }
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
    expect(runs('macos-tests')).toEqual(['pnpm install --frozen-lockfile', 'pnpm test'])
    expect(runs('macos-e2e')).toEqual(['pnpm install --frozen-lockfile', 'osascript -l JavaScript scripts/ci-display.js', 'pnpm test:e2e "--shard=$SHARD"'])
    // electron-builder needs the binary that Electron downloads only on its first require.
    expect(runs('macos-package')).toEqual(['pnpm install --frozen-lockfile', `node -e "require('electron')"`, 'pnpm test:package'])
    // Windows: the job full-suite of windows-tests.yml, which runs pnpm test with the shard it is
    // given (its own contract test), once per shard of the matrix.
    const windows = job('windows')
    expect(value(windows, 'uses')).toBe('./.github/workflows/windows-tests.yml')
    expect(under(windows, '    with:')).toEqual(['      mode: full', '      shard: ${{ matrix.shard }}'])
  })

  it('splits the tests into shards that together cover every file', () => {
    expect(shards('linux-tests')).toHaveLength(4)
    expect(shards('macos-e2e')).toHaveLength(2)
    // One Windows job ran the heavy contract files side by side on one runner; three shards share them out.
    expect(shards('windows')).toHaveLength(3)
    for (const name of ['linux-tests', 'macos-e2e']) {
      expect(job(name), name).toContain('          SHARD: ${{ matrix.shard }}')
    }
  })

  it('asks the free plan for 3 macOS jobs on an ordinary pull request: macos-tests is one job, macos-e2e two shards', () => {
    // The free plan runs 5 macOS jobs at a time; macos-package runs only when ci-scope.mjs says so.
    expect(job('macos-tests').join('\n')).not.toMatch(/strategy:|matrix|shard/i)
    expect(value(job('macos-tests'), 'timeout-minutes')).toBe('45')
    expect(shards('macos-e2e')).toHaveLength(2)
  })

  it('pastes no expression into a command: values reach the shell through env', () => {
    for (const line of code().filter((l) => /^\s*(- )?run: /.test(l))) expect(line).not.toContain('${{')
  })

  it('lets electron-builder sign the app ad hoc in a pull request, with no certificate', () => {
    expect(under(job('macos-package'), '    env:')).toEqual(["      CSC_FOR_PULL_REQUEST: 'true'"])
    expect(readFileSync(join(REPO, 'electron-builder.yml'), 'utf8')).toMatch(/^\s+identity: '-'/m)
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
    // core.quotePath is pinned to git's default, which the runner keeps: with it git quotes a path
    // that has bytes outside ASCII, a double quote or a control character, whatever this machine sets.
    const quotePath = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.quotePath', GIT_CONFIG_VALUE_0: 'true' }
    const result = spawnSync(scriptNode(), [SCOPE], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...quotePath, GITHUB_OUTPUT: output, EVENT: '', JOB: '', BASE: '', ...env } })
    const written = /^expect=(.*)$/m.exec(readFileSync(output, 'utf8'))?.[1]
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, expect: written === undefined ? undefined : (JSON.parse(written) as Record<string, boolean>) }
  }

  const ALL = Object.fromEntries(DECIDED.map((name) => [name, true]))
  const ONLY_LINT = Object.fromEntries(DECIDED.map((name) => [name, name === 'lint-typecheck']))
  const NO_PACKAGE = { ...ALL, 'macos-package': false }

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

  it('names every job of ci.yml but changes and ci-ok, and a change of code pushed to main runs them all', () => {
    commitOnBase(['src/main/index.ts'])
    const result = scope({ EVENT: 'push', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(ALL)
    expect(result.stdout).toContain('code changed: src/main/index.ts')
  })

  it.each([
    ['the app', ['src/main/index.ts', 'src/renderer/App.tsx']],
    ['tests and scripts the package does not use', ['test/e2e/canvas.spec.ts', 'scripts/ci-scope.mjs', 'test/contract/ci-workflow.test.ts']],
    ['look-alikes of build inputs', ['src/build/x.ts', 'buildx/a.ts', 'test/package.json', 'scripts/statusline-bridge.test.mjs']],
  ])('a pull request that changes code but no build input (%s) runs every job but macos-package', (_name, files) => {
    commitOnBase(files)
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(NO_PACKAGE)
    expect(result.stdout).toContain('no build input, so no macos-package')
  })

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'electron-builder.yml',
    'electron.vite.config.ts',
    'scripts/build-version.ts',
    'build/icon.icns',
    'build/brand/logo.svg',
    'scripts/postinstall.mjs',
    'scripts/statusline-bridge.sh',
    'scripts/statusline-bridge.mjs',
    // The @packaged tests install the packaged app with it.
    'scripts/install-stable.mjs',
    'playwright.config.ts',
    'test/e2e/packaged.spec.ts',
    // Holds the @packaged test of node-pty unpacked from app.asar.
    'test/e2e/terminal.spec.ts',
    // packagedBuild, packagedExecutable and packagedResources of the @packaged tests.
    'test/e2e/helpers.ts',
    '.github/workflows/ci.yml',
    '.github/workflows/windows-tests.yml',
  ])('a pull request that changes the build input %s next to the app runs every job, macos-package too', (file) => {
    commitOnBase(['src/main/index.ts', file])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(ALL)
  })

  it.each([
    ['tickets and docs', ['.scratch/epic/issues/01-a.md', 'docs/adr/0001-a.md', 'docs/research/chart.png']],
    ['Markdown at the root and in other folders', ['HANDOFF.md', 'CONTEXT.md', 'docs/lessons/process.md', '.github/notes.md']],
  ])('a change of documents only (%s) runs lint-typecheck alone', (_name, files) => {
    commitOnBase(files)
    for (const event of ['pull_request', 'push']) {
      const result = scope({ EVENT: event, BASE: base })
      expect(result.status, result.stderr).toBe(0)
      expect(result.expect, event).toEqual(ONLY_LINT)
      expect(result.stdout).toMatch(/^documents only: /)
    }
  })

  // git quotes these names by default (core.quotePath); the last two are not valid file names on Windows.
  const ODD_NAMES: Array<[string, string, boolean]> = [
    ['a ticket with a Cyrillic name', '.scratch/worfy-windows/issues/113-уведомления-молчат.md', false],
    ['a document with a space in its name', 'docs/research/two words.md', false],
    ['a document with a double quote in its name', 'docs/research/say "hi".md', true],
    ['a document with a newline in its name', 'docs/research/two\nlines.md', true],
  ]
  it.each(ODD_NAMES.filter(([, , unixOnly]) => !unixOnly || process.platform !== 'win32'))(
    'a change of documents only, %s, runs lint-typecheck alone and names the file as it is',
    (_name, file) => {
      commitOnBase([file])
      const result = scope({ EVENT: 'pull_request', BASE: base })
      expect(result.status, result.stderr).toBe(0)
      expect(result.expect).toEqual(ONLY_LINT)
      expect(result.stdout).toContain(`documents only: ${file}\n`)
    },
  )

  it('a source file with a Cyrillic name runs the tests: every job on a push, every job but macos-package on a pull request', () => {
    commitOnBase(['docs/adr/0001-a.md', 'src/main/уведомления.ts'])
    const push = scope({ EVENT: 'push', BASE: base })
    expect(push.status, push.stderr).toBe(0)
    expect(push.expect).toEqual(ALL)
    expect(push.stdout).toContain('code changed: src/main/уведомления.ts\n')
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual(NO_PACKAGE)
    expect(pr.stdout).toContain('code changed: src/main/уведомления.ts; no build input, so no macos-package\n')
  })

  it.each([
    ['Markdown under src/', 'src/renderer/notes.md'],
    ['Markdown under test/', 'test/fixtures/epic/spec.md'],
    ['Markdown under harness/', 'harness/skills/x/SKILL.md'],
    // test/contract/harness-evals-outcome.test.ts reads the README files of scripts/eval-outcome/.
    ['Markdown under scripts/, which a test reads', 'scripts/eval-outcome/README.md'],
    ['any Markdown under scripts/', 'scripts/notes.md'],
    // test/unit/kind-tokens.test.ts reads docs/design/F-SPEC.md.
    ['the design spec, which a test reads', 'docs/design/F-SPEC.md'],
    ['any file under docs/design/', 'docs/design/F-1.dc.html'],
    ['README.md, which a test reads', 'README.md'],
    ['the lessons index, which a test reads', 'docs/lessons/README.md'],
    ['a workflow', '.github/workflows/ci.yml'],
    ['package.json', 'package.json'],
  ])('%s next to documents runs the tests: every job on a push, every job but maybe macos-package on a pull request', (_name, file) => {
    commitOnBase(['docs/adr/0001-a.md', file])
    const push = scope({ EVENT: 'push', BASE: base })
    expect(push.status, push.stderr).toBe(0)
    expect(push.expect).toEqual(ALL)
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual({ ...ALL, 'macos-package': ['.github/workflows/ci.yml', 'package.json'].includes(file) })
  })

  it.each([
    ['a base of zeros (a new branch)', '0000000000000000000000000000000000000000'],
    ['a base that does not exist', 'f'.repeat(40)],
    ['no base', ''],
  ])('runs every job, macos-package too, when the diff cannot be read: %s', (_name, missing) => {
    commitOnBase(['docs/adr/0001-a.md'])
    for (const event of ['push', 'pull_request']) {
      const result = scope({ EVENT: event, BASE: missing })
      expect(result.status, result.stderr).toBe(0)
      expect(result.expect, event).toEqual(ALL)
    }
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

  const ok = (raw: string) => spawnSync(scriptNode(), [OK], { encoding: 'utf8', env: { ...process.env, NEEDS: raw } })

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

  it('is green when a pull request with no build input skipped macos-package and the other jobs succeeded', () => {
    const result = ok(JSON.stringify(needs({ ...ALL, 'macos-package': false }, results((name) => (name === 'macos-package' ? 'skipped' : 'success')))))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('macos-package: skipped (not needed)')
  })

  it.each([
    ['a needed macos-package failed', true, 'failure', /macos-package: failure, expected success/],
    ['a needed macos-package was skipped', true, 'skipped', /macos-package: skipped, expected success/],
    ['a macos-package that was not needed failed', false, 'failure', /macos-package: failure, expected skipped/],
  ])('is red when %s', (_name, needed, packageResult, reason) => {
    const result = ok(JSON.stringify(needs({ ...ALL, 'macos-package': needed }, results((name) => (name === 'macos-package' ? packageResult : 'success')))))
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(reason)
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
