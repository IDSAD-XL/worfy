// The CI workflow (.github/workflows/ci.yml) checks every pull request and every push to main with
// what gate full runs on the Mac — lint, typecheck, pnpm test on Linux, macOS and Windows, pnpm
// test:e2e and pnpm test:package on macOS — and reports one check, ci-ok, that a merge reads. Here:
// the triggers and limits of the workflow, the job that decides what a run needs
// (scripts/ci-scope.mjs) and the verdict of ci-ok (scripts/ci-ok.mjs). The project has no YAML
// parser, so the workflow is read as text, the way windows-tests-workflow.test.ts reads its
// workflow: block style, one key per line, `#` only at the start of comment lines.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
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

const JOBS = ['changes', 'lint-typecheck', 'linux-tests', 'macos-tests', 'macos-e2e', 'macos-package', 'windows', 'windows-e2e', 'ci-ok']
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
    expect(lines).toHaveLength(['lint-typecheck', 'linux-tests', 'macos-tests', 'macos-e2e', 'macos-package', 'windows-e2e'].length)
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
    expect(value(job('windows-e2e'), 'runs-on')).toBe('windows-latest')
  })

  it('runs the commands of gate full: lint, typecheck, test on three systems, test:e2e and test:package on macOS', () => {
    expect(runs('lint-typecheck')).toEqual(['pnpm install --frozen-lockfile', 'pnpm lint', 'pnpm typecheck'])
    expect(runs('linux-tests')).toContain('pnpm test "--shard=$SHARD" --sequence.shuffle.files')
    // The test files ci-scope.mjs names, none (every file) but on a pull request.
    expect(runs('macos-tests')).toEqual(['pnpm install --frozen-lockfile', 'pnpm test $FILES'])
    expect(job('macos-tests')).toContain('          FILES: ${{ needs.changes.outputs.macos-tests-files }}')
    expect(runs('macos-e2e')).toEqual(['pnpm install --frozen-lockfile', 'osascript -l JavaScript scripts/ci-display.js', 'pnpm test:e2e "--shard=$SHARD"'])
    // electron-builder needs the binary that Electron downloads only on its first require.
    expect(runs('macos-package')).toEqual(['pnpm install --frozen-lockfile', `node -e "require('electron')"`, 'pnpm test:package'])
    // Windows: the job full-suite of windows-tests.yml, which runs pnpm test with the shard it is
    // given (its own contract test), once per shard of the matrix.
    const windows = job('windows')
    expect(value(windows, 'uses')).toBe('./.github/workflows/windows-tests.yml')
    expect(under(windows, '    with:')).toEqual(['      mode: full', '      shard: ${{ matrix.shard }}'])
    expect(runs('windows-e2e')).toEqual(['pnpm install --frozen-lockfile', 'pnpm test:e2e "--shard=$env:SHARD"'])
  })

  it('runs the Windows e2e tests under PowerShell: Git Bash would enable the backup and restore privileges for every process it starts', () => {
    // With them the app under test reads and writes a folder its user is denied (icacls /deny), and
    // linked-add-project.spec.ts and linked-machines.spec.ts turn red on the runner.
    const steps = job('windows-e2e')
    const e2e = steps.findIndex((line) => line.trim() === '- name: Run the e2e tests, one shard')
    expect(e2e).toBeGreaterThan(-1)
    const step: string[] = []
    for (const line of steps.slice(e2e + 1)) {
      if (indent(line) <= indent(steps[e2e] ?? '')) break
      step.push(line.trim())
    }
    expect(step).toEqual(['shell: pwsh', 'env:', 'SHARD: ${{ matrix.shard }}', 'run: pnpm test:e2e "--shard=$env:SHARD"'])
    expect(steps.join('\n')).not.toMatch(/shell: bash/)
  })

  it('splits the tests into shards that together cover every file', () => {
    expect(shards('linux-tests')).toHaveLength(4)
    expect(shards('macos-e2e')).toHaveLength(2)
    // One Windows job ran the heavy contract files side by side on one runner; three shards share them out.
    expect(shards('windows')).toHaveLength(3)
    // A shard of the Windows e2e tests took up to 14.5 min in four; one job stays under 20 min.
    expect(shards('windows-e2e')).toHaveLength(4)
    for (const name of ['linux-tests', 'macos-e2e', 'windows-e2e']) {
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
    for (const name of ['macos-e2e', 'macos-package', 'windows-e2e']) {
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
    expect(value(under(changes, '    outputs:'), 'macos-tests-files')).toBe('${{ steps.scope.outputs.macos-tests-files }}')
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

  /** A commit on top of `base` that changes the given files (to `texts[file]`, if given); HEAD is left on it. */
  function commitOnBase(files: string[], texts: Record<string, string> = {}): void {
    git('checkout', '-q', '--detach', base)
    for (const file of files) {
      mkdirSync(join(repo, dirname(file)), { recursive: true })
      writeFileSync(join(repo, file), `${texts[file] ?? ''}changed ${Math.random()}\n`)
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
    const text = readFileSync(output, 'utf8')
    const written = /^expect=(.*)$/m.exec(text)?.[1]
    const files = /^macos-tests-files=(.*)$/m.exec(text)?.[1]
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      expect: written === undefined ? undefined : (JSON.parse(written) as Record<string, boolean>),
      files: files === undefined ? undefined : files.split(' ').filter((name) => name !== ''),
    }
  }

  const ALL = Object.fromEntries(DECIDED.map((name) => [name, true]))
  const ONLY_LINT = Object.fromEntries(DECIDED.map((name) => [name, name === 'lint-typecheck']))
  const NO_PACKAGE = { ...ALL, 'macos-package': false }
  /** A pull request that changes code but no app path: the Linux and Windows jobs, no macOS job. */
  const NO_MACOS = { ...ALL, 'macos-tests': false, 'macos-e2e': false, 'macos-package': false }
  /** A pull request that changes a script or a part of the Harness the app does not carry: the macOS-only test files, no e2e. */
  const TESTS_ONLY = { ...NO_MACOS, 'macos-tests': true }
  // Test files of the base: two with a macOS-only test or assertion, one with a Windows-only test,
  // one with none. macos-tests on a pull request runs the first two alone.
  const DARWIN_FILES = ['test/unit/mac-only.test.ts', 'test/contract/mac-menu.test.tsx']
  // The guards are put together here, so that this file holds none: ci-scope.mjs would list it.
  const DARWIN = "'darwin'"
  const MAC_ONLY = `describe.skipIf(process.platform !== ${DARWIN})('x', () => {})\n`
  const BASE_FILES: Record<string, string> = {
    'test/unit/mac-only.test.ts': MAC_ONLY,
    'test/contract/mac-menu.test.tsx': `const file = process.platform === ${DARWIN.replaceAll("'", '"')} ? 'fileMenu' : 'File'\n`,
    'test/unit/windows-only.test.ts': "describe.runIf(process.platform === 'win32')('x', () => {})\n",
    'test/unit/plain.test.ts': "it('x', () => {})\n",
    // Not a test file: a helper that names the platform is not run by itself.
    'test/unit/mac-helper.ts': `export const mac = process.platform === ${DARWIN}\n`,
  }

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'worfy-ci-scope-'))
    repo = join(scratch, 'repo')
    mkdirSync(repo)
    git('init', '-q')
    writeFileSync(join(repo, 'package.json'), '{}\n')
    for (const [file, text] of Object.entries(BASE_FILES)) {
      mkdirSync(join(repo, dirname(file)), { recursive: true })
      writeFileSync(join(repo, file), text)
    }
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
    expect(result.stdout).toContain('code changed: src/main/index.ts\n')
    // No list: macos-tests runs every test file.
    expect(result.files).toEqual([])
  })

  it('chooses windows-e2e by the files as it chooses macos-e2e; a run by hand never asks for it', () => {
    const cases: Array<[string, string[]]> = [
      ['pull_request', ['src/main/index.ts']],
      ['pull_request', ['src/main/index.ts', 'package.json']],
      ['pull_request', ['docs/adr/0001-a.md']],
      ['push', ['src/main/index.ts']],
      ['push', ['HANDOFF.md']],
    ]
    for (const [event, files] of cases) {
      commitOnBase(files)
      const result = scope({ EVENT: event, BASE: base })
      expect(result.status, result.stderr).toBe(0)
      expect(result.expect?.['windows-e2e'], `${event} ${files.join(' ')}`).toBe(result.expect?.['macos-e2e'])
    }
    for (const job of ['check', 'full-macos']) expect(scope({ EVENT: 'workflow_dispatch', JOB: job }).expect?.['windows-e2e'], job).toBe(false)
  })

  it.each([
    ['the app', ['src/main/index.ts', 'src/renderer/App.tsx']],
    ['tests and scripts the package does not use', ['test/e2e/canvas.spec.ts', 'scripts/ci-scope.mjs', 'test/contract/ci-workflow.test.ts']],
    ['look-alikes of build inputs', ['src/build/x.ts', 'buildx/a.ts', 'test/package.json', 'scripts/statusline-bridge.test.mjs']],
  ])('a pull request that changes the app but no build input (%s) runs every job but macos-package, macos-tests with the macOS-only files', (_name, files) => {
    commitOnBase(files)
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(NO_PACKAGE)
    expect(result.files).toEqual(DARWIN_FILES)
    expect(result.stdout).toContain('no build input, so no macos-package; macos-tests runs the 2 macOS-only test files\n')
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
  ])('a pull request that changes the build input %s runs every job, macos-package too', (file) => {
    commitOnBase([file])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.expect).toEqual(ALL)
    expect(result.files).toEqual(DARWIN_FILES)
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
    expect(pr.stdout).toContain('code changed: src/main/уведомления.ts; no build input, so no macos-package; macos-tests')
  })

  it.each([
    ['Markdown under src/', 'src/renderer/notes.md', NO_PACKAGE],
    // The e2e tests read test/fixtures/.
    ['Markdown under test/fixtures/', 'test/fixtures/epic/spec.md', NO_PACKAGE],
    // The build copies harness/ into the app.
    ['Markdown under harness/', 'harness/skills/x/SKILL.md', NO_PACKAGE],
    // test/contract/harness-evals-outcome.test.ts reads the README files of scripts/eval-outcome/.
    ['Markdown under scripts/, which a test reads', 'scripts/eval-outcome/README.md', TESTS_ONLY],
    ['any Markdown under scripts/', 'scripts/notes.md', TESTS_ONLY],
    // test/unit/kind-tokens.test.ts reads docs/design/F-SPEC.md.
    ['the design spec, which a test reads', 'docs/design/F-SPEC.md', NO_MACOS],
    ['any file under docs/design/', 'docs/design/F-1.dc.html', NO_MACOS],
    ['README.md, which a test reads', 'README.md', NO_MACOS],
    ['the lessons index, which a test reads', 'docs/lessons/README.md', NO_MACOS],
    ['a workflow', '.github/workflows/ci.yml', ALL],
    ['package.json', 'package.json', ALL],
  ])('%s next to documents runs the tests: every job on a push, the macOS jobs its path asks for on a pull request', (_name, file, pullRequest) => {
    commitOnBase(['docs/adr/0001-a.md', file])
    const push = scope({ EVENT: 'push', BASE: base })
    expect(push.status, push.stderr).toBe(0)
    expect(push.expect).toEqual(ALL)
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual(pullRequest)
  })

  it.each([
    ['unit and contract tests', ['test/unit/plain.test.ts', 'test/contract/ci-workflow.test.ts', 'test/unit/windows-only.test.ts']],
    ['a test helper the e2e tests do not use', ['test/remove.ts']],
    ['a helper next to a macOS-only test file', ['test/unit/mac-helper.ts']],
  ])('a pull request that changes no app path, script or Harness file (%s) asks for no macOS job', (_name, files) => {
    commitOnBase(files)
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual(NO_MACOS)
    expect(pr.files).toEqual([])
    expect(pr.stdout).toContain('no app path, so no macos-e2e; no app path, script, Harness or macOS-only test file, so no macos-tests\n')
    // The same change pushed to main runs every job, macos-tests with every file.
    const push = scope({ EVENT: 'push', BASE: base })
    expect(push.expect).toEqual(ALL)
    expect(push.files).toEqual([])
  })

  it('a pull request that changes a macOS-only test file runs macos-tests with the macOS-only files, and no e2e', () => {
    commitOnBase(['test/unit/mac-only.test.ts', 'test/remove.ts'], { 'test/unit/mac-only.test.ts': MAC_ONLY })
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual(TESTS_ONLY)
    expect(pr.files).toEqual(DARWIN_FILES)
  })

  it.each([
    // The Harness the app carries: the build copies it, the e2e tests install and run it.
    ['harness/bin/profile', NO_PACKAGE],
    ['harness/agents/implementer.md', NO_PACKAGE],
    ['harness/profiles/draft.schema.json', NO_PACKAGE],
    ['harness/hooks/gate.mjs', NO_PACKAGE],
    ['harness/evalsx/a.md', NO_PACKAGE],
    // The parts of harness/ the build leaves out (HARNESS_NOT_BUNDLED): the macOS-only tests check them.
    ['harness/bin/tests/profile.test.sh', TESTS_ONLY],
    ['harness/hooks/tests/gate.test.mjs', TESTS_ONLY],
    ['harness/evals/cases/a.json', TESTS_ONLY],
    ['harness/evals-outcome/a.md', TESTS_ONLY],
    // Scripts the macOS-only tests run: make-icons.test.ts with the real sips, hang-sample.test.ts with the ps of macOS.
    ['scripts/make-icons.mjs', TESTS_ONLY],
    ['scripts/hang-sample.mjs', TESTS_ONLY],
    ['scripts/agent-cost.mjs', TESTS_ONLY],
    ['scripts/ci-scope.mjs', TESTS_ONLY],
  ])('a pull request that changes %s asks for the macOS jobs that check it', (file, jobs) => {
    commitOnBase([file])
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual(jobs)
    expect(pr.files).toEqual(DARWIN_FILES)
  })

  it('leaves out of the app exactly the parts of harness/ that the build leaves out of its copy', () => {
    // electron.vite.config.ts: export const HARNESS_NOT_BUNDLED = [join('bin', 'tests'), …]
    const build = /HARNESS_NOT_BUNDLED = \[(.*)\]/.exec(readFileSync(join(REPO, 'electron.vite.config.ts'), 'utf8'))?.[1] ?? ''
    const built = build.split(/,\s*(?![^(]*\))/).map((item) => [...item.matchAll(/'([^']+)'/g)].map(([, part]) => part).join('/'))
    const listed = /HARNESS_NOT_BUNDLED = \[(.*)\]/.exec(readFileSync(SCOPE, 'utf8'))?.[1] ?? ''
    expect([...listed.matchAll(/'([^']+)'/g)].map(([, part]) => part)).toEqual(built)
    expect(built).toContain('bin/tests')
  })

  it('a pull request that adds a macOS-only test file runs it on macOS with the others', () => {
    const added = 'test/contract/new-mac.test.ts'
    commitOnBase([added], { [added]: `it.runIf(os.platform() === ${DARWIN})('x', () => {})\n` })
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.expect).toEqual({ ...NO_MACOS, 'macos-tests': true })
    expect(pr.files).toEqual([...DARWIN_FILES, added])
  })

  it.each([
    ['vitest.config.ts', NO_MACOS],
    ['scripts/vitest-electron.mjs', NO_MACOS],
    ['src/renderer/App.tsx', NO_PACKAGE],
    ['src/main/index.ts', NO_PACKAGE],
    ['src/preload/index.ts', NO_PACKAGE],
    ['src/shared/ipc/channels.ts', NO_PACKAGE],
    ['src/card-runtime/worfy-card.ts', NO_PACKAGE],
  ])('a pull request that changes %s runs macos-tests with the macOS-only files', (file, jobs) => {
    commitOnBase([file])
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual({ ...jobs, 'macos-tests': true })
    expect(pr.files).toEqual(DARWIN_FILES)
  })

  it.each([
    'test/e2e/canvas.spec.ts',
    'test/e2e/helpers.ts',
    'test/fixtures/epic/spec.md',
    'test/quarantine/demo.json',
    'playwright.config.ts',
    'electron.vite.config.ts',
    'tsconfig.json',
    'tsconfig.web.json',
    'scripts/dev-bundle.ts',
    'scripts/build-version.ts',
    'scripts/ci-display.js',
  ])('a pull request that changes %s, which the e2e run builds or reads, runs macos-e2e', (file) => {
    commitOnBase([file])
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect?.['macos-e2e']).toBe(true)
  })

  it('every file outside test/e2e that the e2e tests import makes a pull request run macos-e2e', () => {
    const e2e = join(REPO, 'test', 'e2e')
    const imported = new Set<string>()
    for (const name of readdirSync(e2e, { recursive: true, encoding: 'utf8' })) {
      if (!/\.ts$/.test(name)) continue
      for (const [, from = ''] of readFileSync(join(e2e, name), 'utf8').matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
        const path = relative(REPO, resolve(e2e, dirname(name), from)).split(sep).join('/')
        if (!path.startsWith('test/e2e/')) imported.add(/\.[cm]?[jt]sx?$/.test(path) ? path : `${path}.ts`)
      }
    }
    expect(imported.size).toBeGreaterThan(3)
    for (const path of imported) {
      commitOnBase([path])
      expect(scope({ EVENT: 'pull_request', BASE: base }).expect?.['macos-e2e'], path).toBe(true)
    }
  })

  /** The macOS-only test files ci-scope.mjs lists in `root`. */
  const darwinTests = (root: string): string[] =>
    execFileSync(process.execPath, [SCOPE, '--darwin-tests'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => line !== '')

  // Other ways to guard a test on macOS: a constant or a function named for the Mac in skipIf, runIf,
  // an if or a ?: — an isMac imported from a helper, which ci-scope.mjs cannot see through.
  const OTHER_GUARD = /(skipIf|runIf)\(\s*!?\s*\w*(mac|darwin)\w*\b|\bif\s*\(\s*!?\s*\w*(mac|darwin)\w*\s*[)&|]|\b\w*(mac|darwin)\w*\s*\?\s/i

  /** The test files of `root` that guard on macOS another way and that ci-scope.mjs does not list. */
  function unlisted(root: string): string[] {
    const listed = darwinTests(root)
    const found: string[] = []
    for (const folder of ['test/unit', 'test/contract']) {
      if (!existsSync(join(root, folder))) continue
      for (const name of readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })) {
        const path = `${folder}/${name.split(sep).join('/')}`
        if (/\.test\.tsx?$/.test(path) && OTHER_GUARD.test(readFileSync(join(root, path), 'utf8')) && !listed.includes(path)) found.push(path)
      }
    }
    return found.sort()
  }

  it('lists a test file that compares the other way round or switches on the platform', () => {
    const reversed = 'test/unit/reversed.test.ts'
    const switched = 'test/contract/switched.test.ts'
    commitOnBase([reversed, switched], {
      [reversed]: `if (${DARWIN} === process.platform) it('x', () => {})\n`,
      [switched]: `switch (process.platform) {\n  case ${DARWIN}:\n    it('x', () => {})\n}\n`,
    })
    // test/unit first, then test/contract, each by name.
    expect(darwinTests(repo)).toEqual(['test/unit/mac-only.test.ts', reversed, 'test/contract/mac-menu.test.tsx', switched])
  })

  it('the check of the test files finds a macOS guard that ci-scope.mjs does not list: an imported isMac', () => {
    const imported = 'test/unit/imported-mac.test.ts'
    const mac = 'isMac'
    commitOnBase([imported], { [imported]: `import { ${mac} } from './platform'\nit.runIf(${mac})('x', () => {})\n` })
    expect(unlisted(repo)).toEqual([imported])
  })

  it('every test file of this repository that guards on macOS is one ci-scope.mjs lists', () => {
    expect(darwinTests(REPO).length).toBeGreaterThan(10)
    expect(unlisted(REPO)).toEqual([])
  })

  it('a macOS-only test file whose name the shell would split: macos-tests runs every file', () => {
    const odd = 'test/unit/two words.test.ts'
    commitOnBase([odd, 'src/main/index.ts'], { [odd]: MAC_ONLY })
    const pr = scope({ EVENT: 'pull_request', BASE: base })
    expect(pr.status, pr.stderr).toBe(0)
    expect(pr.expect).toEqual(NO_PACKAGE)
    expect(pr.files).toEqual([])
    expect(pr.stdout).toContain('the macOS-only test files could not be listed, so macos-tests runs every file')
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
      expect(result.files, event).toEqual([])
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
    const full = scope({ EVENT: 'workflow_dispatch', JOB: 'full-macos' })
    expect(full.expect).toEqual({ ...ONLY_LINT, 'macos-tests': true, 'macos-e2e': true, 'macos-package': true })
    expect(full.files).toEqual([])
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

  it('is green when a pull request that changes no app path skipped every macOS job and the other jobs succeeded', () => {
    const MACOS = ['macos-tests', 'macos-e2e', 'macos-package']
    const wanted = Object.fromEntries(DECIDED.map((name) => [name, !MACOS.includes(name)]))
    const result = ok(JSON.stringify(needs(wanted, results((name) => (MACOS.includes(name) ? 'skipped' : 'success')))))
    expect(result.status, result.stderr).toBe(0)
    for (const name of MACOS) expect(result.stdout).toContain(`${name}: skipped (not needed)`)
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

  it.each(['failure', 'cancelled', 'skipped'])('stays green when a needed windows-e2e ends %s: it does not block yet, and a warning says so', (windowsE2e) => {
    const result = ok(JSON.stringify(needs(ALL, results((name) => (name === 'windows-e2e' ? windowsE2e : 'success')))))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`windows-e2e: ${windowsE2e} (needed, does not block ci-ok)`)
    expect(result.stdout).toContain(`::warning::windows-e2e: ${windowsE2e}, expected success; it does not block ci-ok yet`)
    expect(result.stdout).toContain('ci-ok: every job the run needs succeeded')
  })

  it('prints a green windows-e2e without a warning', () => {
    const result = ok(JSON.stringify(needs(ALL, results(() => 'success'))))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('windows-e2e: success (needed, does not block ci-ok)')
    expect(result.stdout).not.toContain('::warning::')
  })

  it.each(['success', 'failure'])('is red when windows-e2e ran though the run did not need it (%s): the scope still holds', (windowsE2e) => {
    const result = ok(JSON.stringify(needs({ ...ALL, 'windows-e2e': false }, results((name) => (name === 'windows-e2e' ? windowsE2e : 'success')))))
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(new RegExp(`windows-e2e: ${windowsE2e}, expected skipped`))
  })

  // windows-e2e is the only job that does not block: a failure of any other job turns ci-ok red,
  // whatever windows-e2e did.
  it.each(DECIDED.filter((name) => name !== 'windows-e2e'))('is red when %s fails, also next to a red windows-e2e', (failed) => {
    const result = ok(JSON.stringify(needs(ALL, results((name) => (name === failed || name === 'windows-e2e' ? 'failure' : 'success')))))
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(new RegExp(`${failed}: failure, expected success`))
    expect(result.stderr).not.toMatch(/windows-e2e/)
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
