// scripts/affected-tests.mjs (worfy-throughput ticket 21): which unit and contract test files a
// change touches — by vite's module graph and by scripts/affected-tests.table.json for the links the
// graph cannot see; ALL for a change to the test run itself and for a path nothing covers.
// Each case makes a branch in a temporary git repository with its own small module graph and table,
// checks the branch out and runs the script there, as CI would run it on the head of a pull request.
// The rows of what each test reads by path are built from the test sources on every run
// (scripts/affected-tests-table.mjs, called here in-process on a second temporary repository and on this
// one), never committed: a committed copy went stale when two pull requests merged side by side.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quarantined } from '../quarantine'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'affected-tests.mjs')
const GENERATOR = join(REPO, 'scripts', 'affected-tests-table.mjs')
type Generated = { file: string; reads?: string[]; scans?: string[] }
const { generate } = (await import(pathToFileURL(GENERATOR).href)) as { generate: (root: string) => Generated[] }
const SETTINGS = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0']

let scratch = ''
let repo = ''
let branches = 0
let emptyConfig = ''

/** The environment of every git here, the script's own included: no system or user configuration, no GIT_* of the run around. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig }
}

function git(...args: string[]): string {
  const result = spawnSync('git', [...SETTINGS, ...args], { cwd: repo, encoding: 'utf8', env: gitEnv() })
  expect(result.status, `git ${args.join(' ')}: ${result.stderr}`).toBe(0)
  return result.stdout
}

function put(path: string, text = `${path}\n`): void {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
}

// What the helpers below last checked out. Every git process costs about 0.1 s on an idle Windows PC
// and several times that under the load of a full run, so a checkout of what is already checked out
// is skipped; every checkout of the tests goes through these helpers, so the record stays right.
let checkedOut = 'main'

/** Checks out `ref` unless the helpers checked it out last. */
function checkout(ref: string): void {
  if (checkedOut === ref) return
  git('checkout', '-q', ref)
  checkedOut = ref
}

/** Creates branch `name` at `from` and checks it out. */
function startBranch(name: string, from: string): void {
  git('checkout', '-q', '-b', name, from)
  checkedOut = name
}

/**
 * A new branch from `from` with one commit made by `change`; returns its name. The branch stays
 * checked out: the script runs on it next, and the next branch starts from its own base anyway.
 */
function branch(change: () => void, from = 'main'): string {
  const name = `topic-${++branches}`
  startBranch(name, from)
  change()
  git('add', '-A')
  git('commit', '-q', '--allow-empty', '-m', name)
  return name
}

// A test runs the script once, on one branch: each run is a fresh Node process that loads vitest to
// build the module graph, a few seconds under the load of a full run, and the tests that ran it two
// to four times went past their time limit on Windows (worfy-polish 41).

/** The script run on `head` checked out, as `<base> <head>`. */
function affected(head: string, ...extra: string[]) {
  return affectedIn({}, head, ...extra)
}

/** The same with more environment variables. */
function affectedIn(env: NodeJS.ProcessEnv, head: string, ...extra: string[]) {
  return affectedFrom('main', env, head, ...extra)
}

/** The same from another base. */
function affectedFrom(base: string, env: NodeJS.ProcessEnv, head: string, ...extra: string[]) {
  checkout(head)
  const result = spawnSync(scriptNode(), [SCRIPT, base, head, ...extra], { cwd: repo, encoding: 'utf8', env: { ...gitEnv(), ...env } })
  return { status: result.status, lines: result.stdout.split('\n').filter((line) => line !== ''), stdout: result.stdout, stderr: result.stderr }
}

// The fixture's table: the shape of the real one, small, with the rows written by hand only.
const TABLE = {
  all: [{ paths: ['vitest.config.ts', 'package.json'] }],
  none: [{ paths: ['docs/**'] }],
  links: [
    { paths: ['harness/**'], files: ['test/contract/harness-scripts.test.ts', 'test/contract/wave-gate.test.ts'] },
    { paths: ['config/flags.json'], files: ['test/flags.ts'] },
    { paths: ['test/**'], files: ['test/unit/scan.test.ts'], scan: true },
  ],
}

// A test that reads files by path, the rows of which every run builds from its source: it reads
// data/input.txt, GUIDE.md, docs/spec.md and the folder data/cases, and looks through assets/ (a
// top-level folder: a scan).
const READER = [
  "import { readdirSync, readFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  "const REPO = join(__dirname, '..', '..')",
  "export const input = readFileSync(join(REPO, 'data', 'input.txt'), 'utf8')",
  "export const cases = readdirSync(join(REPO, 'data', 'cases'))",
  "export const guide = readFileSync(join(REPO, 'GUIDE.md'), 'utf8')",
  "export const spec = readFileSync(join(REPO, 'docs', 'spec.md'), 'utf8')",
  "export const assets = readdirSync(join(REPO, 'assets'))",
  '',
].join('\n')

// A vitest configuration without imports: the temporary repository has no node_modules. Like the
// real one, it leaves out the files WORFY_TEST_EXCLUDE names.
const CONFIG = `const exclude = (process.env.WORFY_TEST_EXCLUDE ?? '').split(' ').filter(Boolean)
export default {
  test: {
    projects: [
      { test: { name: 'node', include: ['test/unit/**/*.test.ts'], exclude } },
      { test: { name: 'contract', include: ['test/contract/**/*.test.ts'], exclude } },
    ],
  },
}
`

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worfy-affected-tests-'))
  emptyConfig = join(scratch, 'empty-gitconfig')
  writeFileSync(emptyConfig, '')
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  git('init', '-q')
  put('vitest.config.ts', CONFIG)
  put('package.json', '{}\n')
  put('scripts/affected-tests.table.json', JSON.stringify(TABLE))
  put('README.md', '# fixture\n')
  put('docs/notes.md', 'notes\n')
  put('docs/spec.md', 'spec\n')
  put('GUIDE.md', '# guide\n')
  put('docs/mock-up.html', '<p>mock-up</p>\n')
  put('tools/build.sh', '#!/bin/sh\n')
  put('config/flags.json', '{}\n')
  // src/shared/format.ts ← src/shared/label.ts ← src/main/menu.ts; src/shared/alone.ts is imported by nothing.
  put('src/shared/format.ts', 'export const format = (n: number): string => String(n)\n')
  put('src/shared/label.ts', "import { format } from './format'\nexport const label = (n: number): string => `n=${format(n)}`\n")
  put('src/main/menu.ts', "import { label } from '../shared/label'\nexport const menu = (): string => label(1)\n")
  put('src/shared/alone.ts', 'export const alone = 1\n')
  put('scripts/lonely.mjs', 'export const lonely = 1\n')
  put('scripts/used.mjs', 'export const used = 1\n')
  put('test/flags.ts', 'export const flags = {}\n')
  put('test/unit/format.test.ts', "import { format } from '../../src/shared/format'\nexport const probe = format(1)\n")
  put('test/unit/menu.test.ts', "import { menu } from '../../src/main/menu'\nexport const probe = menu()\n")
  put('test/unit/flags.test.ts', "import { flags } from '../flags'\nexport const probe = flags\n")
  put('test/unit/used.test.ts', "import { used } from '../../scripts/used.mjs'\nexport const probe = used\n")
  put('test/unit/other.test.ts', 'export const probe = 0\n')
  put('test/unit/scan.test.ts', 'export const probe = 0\n')
  put('test/unit/reader.test.ts', READER)
  put('data/input.txt', 'input\n')
  put('data/cases/one.json', '{}\n')
  put('assets/logo.svg', '<svg/>\n')
  put('harness/bin/wave-gate', '#!/bin/sh\n')
  put('test/contract/harness-scripts.test.ts', 'export const probe = 0\n')
  put('test/contract/wave-gate.test.ts', 'export const probe = 0\n')
  put('test/contract/unrelated.test.ts', 'export const probe = 0\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
})

afterAll(() => {
  removeTestTree(scratch)
})

describe('affected-tests.mjs on the module graph', () => {
  it('selects the tests of a changed src/shared/ module and the tests of its importers, directly or not', () => {
    const head = branch(() => put('src/shared/format.ts', 'export const format = (n: number): string => `${n}`\n'))
    const r = affected(head)
    expect(r.status, r.stderr).toBe(0)
    expect(r.lines).toEqual(['test/unit/format.test.ts', 'test/unit/menu.test.ts'])
  })

  it('selects nothing for a module under src/ that no test imports — not ALL', () => {
    const head = branch(() => put('src/shared/alone.ts', 'export const alone = 2\n'))
    const r = affected(head)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('takes a module outside src/ and test/ as covered when a test imports it', () => {
    const head = branch(() => put('scripts/used.mjs', 'export const used = 2\n'))
    expect(affected(head).lines).toEqual(['test/unit/used.test.ts'])
  })

  it('answers ALL for a module outside src/ and test/ that no test imports and the table does not name', () => {
    const head = branch(() => put('scripts/lonely.mjs', 'export const lonely = 2\n'))
    const r = affected(head)
    expect(r.status).toBe(0)
    expect(r.lines).toEqual(['ALL'])
    expect(r.stderr).toContain('scripts/lonely.mjs: no test imports it')
  })
})

describe('affected-tests.mjs on the table', () => {
  it('selects the contract tests the table names for a change to harness/bin/wave-gate', () => {
    const head = branch(() => put('harness/bin/wave-gate', '#!/bin/sh\nexit 0\n'))
    expect(affected(head).lines).toEqual(['test/contract/harness-scripts.test.ts', 'test/contract/wave-gate.test.ts'])
  })

  it('selects the importers of a module the table names for a file it reads', () => {
    const head = branch(() => put('config/flags.json', '{"on": true}\n'))
    expect(affected(head).lines).toEqual(['test/unit/flags.test.ts'])
  })

  it('answers ALL for a change to vitest.config.ts', () => {
    const head = branch(() => put('vitest.config.ts', `${CONFIG}// changed\n`))
    const r = affected(head)
    expect(r.status).toBe(0)
    expect(r.lines).toEqual(['ALL'])
    expect(r.stderr).toContain('vitest.config.ts: changes the whole test run')
  })

  it('answers ALL for a changed path neither the graph nor the table covers', () => {
    const changed = branch(() => put('tools/build.sh', '#!/bin/sh\necho build\n'))
    expect(affected(changed).lines).toEqual(['ALL'])
  })

  it('answers ALL for a new path neither the graph nor the table covers', () => {
    const added = branch(() => put('pictures/logo.svg', '<svg/>\n'))
    const r = affected(added)
    expect(r.lines).toEqual(['ALL'])
    expect(r.stderr).toContain('pictures/logo.svg: neither the module graph nor')
  })

  it('answers ALL when the table names a file that is not there', () => {
    const head = branch(() => {
      const table = { ...TABLE, links: [...TABLE.links, { paths: ['tools/**'], files: ['test/contract/gone.test.ts'] }] }
      put('scripts/affected-tests.table.json', JSON.stringify(table))
      put('tools/build.sh', '#!/bin/sh\necho again\n')
    })
    const r = affected(head)
    expect(r.lines).toEqual(['ALL'])
    expect(r.stderr).toContain('names test/contract/gone.test.ts, which is not a file')
  })

  it('selects nothing for a change to Markdown and to paths of `none` only', () => {
    const head = branch(() => {
      put('README.md', '# fixture, changed\n')
      put('docs/notes.md', 'more notes\n')
      put('docs/mock-up.html', '<p>changed</p>\n')
    })
    const r = affected(head)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })
})

describe('affected-tests.mjs on what covers a path', () => {
  it('answers ALL for an unknown .json file', () => {
    expect(affected(branch(() => put('config/other.json', '{}\n'))).lines).toEqual(['ALL'])
  })

  it('answers ALL for an unknown .yml file', () => {
    expect(affected(branch(() => put('config/pipeline.yml', 'a: 1\n'))).lines).toEqual(['ALL'])
  })

  it('takes a scan row for an addition to the list, not for the cover of a path', () => {
    // test/** is a scan row: the scanner goes in, and a data file nothing else names is still ALL.
    const r = affected(branch(() => put('test/data/sample.yml', 'a: 1\n')))
    expect(r.lines).toEqual(['ALL'])
    expect(r.stderr).toContain('test/data/sample.yml: neither the module graph nor')
  })

  it('selects what a generated row reads: a file it reads', () => {
    expect(affected(branch(() => put('data/input.txt', 'changed\n'))).lines).toEqual(['test/unit/reader.test.ts'])
  })

  it('selects what a generated row reads: every file under a folder it reads', () => {
    expect(affected(branch(() => put('data/cases/new.json', '{}\n'))).lines).toEqual(['test/unit/reader.test.ts'])
  })

  it('takes the scans of a generated row for no cover', () => {
    expect(affected(branch(() => put('assets/new.svg', '<svg/>\n'))).lines).toEqual(['ALL'])
  })

  it('reads what the tests read from the sources of the head, so a test file split on the base since needs no table update', () => {
    // The base moved on: reader.test.ts gave its read of data/input.txt to a new file, and the table
    // was not touched — as when a pull request that splits a test file merges next to this one.
    startBranch('split-base', 'main')
    put('test/unit/reader.test.ts', READER.replace("export const input = readFileSync(join(REPO, 'data', 'input.txt'), 'utf8')\n", ''))
    put('test/unit/input-reader.test.ts', "import { readFileSync } from 'node:fs'\nimport { join } from 'node:path'\nexport const input = readFileSync(join(__dirname, '..', '..', 'data', 'input.txt'), 'utf8')\n")
    git('add', '-A')
    git('commit', '-q', '-m', 'split reader.test.ts')
    const head = branch(() => put('data/input.txt', 'changed after the split\n'), 'split-base')
    const r = affectedFrom('split-base', {}, head)
    expect(r.status, r.stderr).toBe(0)
    expect(r.lines).toEqual(['test/unit/input-reader.test.ts'])
  })

  // Markdown outside the code folders and the paths of `none` need no tests of their own, but the
  // tests that read them still go in.
  it('selects the reader of a Markdown file that a test reads as text', () => {
    expect(affected(branch(() => put('GUIDE.md', '# guide, changed\n'))).lines).toEqual(['test/unit/reader.test.ts'])
  })

  it('selects the reader of a path of `none` that a test reads as text', () => {
    expect(affected(branch(() => put('docs/spec.md', 'spec, changed\n'))).lines).toEqual(['test/unit/reader.test.ts'])
  })

  it('answers ALL for a deleted module, whose importers the graph of the head cannot name', () => {
    const r = affected(branch(() => git('rm', '-q', 'src/shared/alone.ts')))
    expect(r.lines).toEqual(['ALL'])
    expect(r.stderr).toContain('src/shared/alone.ts: a deleted module')
  })

  it('answers ALL for Markdown under src/, test/, harness/ or scripts/ that nothing names', () => {
    const r = affected(branch(() => put('src/shared/notes.md', 'notes\n')))
    expect(r.lines).toEqual(['ALL'])
  })

  it('answers for the whole suite when WORFY_TEST_EXCLUDE leaves a file out of the run', () => {
    const head = branch(() => put('src/shared/format.ts', 'export const format = (n: number): string => `<${n}>`\n'))
    const r = affectedIn({ WORFY_TEST_EXCLUDE: 'test/unit/format.test.ts' }, head)
    expect(r.status, r.stderr).toBe(0)
    expect(r.lines).toEqual(['test/unit/format.test.ts', 'test/unit/menu.test.ts'])
  })
})

describe('affected-tests.mjs on test files', () => {
  it('always selects a changed or a new test file, with what the table links to it', () => {
    const head = branch(() => {
      put('test/unit/other.test.ts', 'export const probe = 1\n')
      put('test/contract/new.test.ts', 'export const probe = 0\n')
    })
    expect(affected(head).lines).toEqual(['test/contract/new.test.ts', 'test/unit/other.test.ts', 'test/unit/scan.test.ts'])
  })

  it('selects no deleted test file, and a deletion alone is not ALL', () => {
    const head = branch(() => git('rm', '-q', 'test/contract/unrelated.test.ts'))
    expect(affected(head).lines).toEqual(['test/unit/scan.test.ts'])
  })
})

describe('affected-tests.mjs on the diff', () => {
  it('reads a renamed file under its old name too', () => {
    // tools/build.sh is covered by nothing; under its new name in docs/ it would be `none`.
    const head = branch(() => {
      mkdirSync(join(repo, 'docs', 'tools'), { recursive: true })
      git('mv', 'tools/build.sh', 'docs/tools/build.sh')
    })
    expect(affected(head).lines).toEqual(['ALL'])
  })

  it('looks at what the head changed since it left the base, not at what the base did since', () => {
    const head = branch(() => put('README.md', '# fixture, on the branch\n'))
    startBranch('base-ahead', 'main')
    put('vitest.config.ts', `${CONFIG}// changed on the base\n`)
    git('commit', '-q', '-am', 'base moves on')
    checkout(head)
    const r = spawnSync(scriptNode(), [SCRIPT, 'base-ahead', head], { cwd: repo, encoding: 'utf8', env: gitEnv() })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('prints one JSON object with --json', () => {
    const head = branch(() => put('src/shared/label.ts', "import { format } from './format'\nexport const label = (n: number): string => `#${format(n)}`\n"))
    const r = affected(head, '--json')
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ all: false, files: ['test/unit/menu.test.ts'], reasons: [] })
  })

  it('prints one JSON object with --json for an answer of ALL', () => {
    const all = affected(branch(() => put('package.json', '{"name": "x"}\n')), '--json')
    expect(JSON.parse(all.stdout)).toEqual({ all: true, files: [], reasons: ['package.json: changes the whole test run'] })
  })

  /** The text of $GITHUB_OUTPUT after the script ran on `head` with --github-output; the file held a line before. */
  const output = (head: string): string => {
    const file = join(scratch, `github-output-${head}`)
    writeFileSync(file, 'earlier=1\n')
    const r = affectedIn({ GITHUB_OUTPUT: file }, head, '--github-output')
    expect(r.status, r.stderr).toBe(0)
    return readFileSync(file, 'utf8')
  }

  quarantined('affected-tests-github-output')('appends run and files to $GITHUB_OUTPUT with --github-output, for the test jobs of CI', () => {
    const some = branch(() => put('src/shared/format.ts', 'export const format = (n: number): string => `[${n}]`\n'))
    expect(output(some)).toBe('earlier=1\nrun=some\nfiles=test/unit/format.test.ts test/unit/menu.test.ts\n')
  })

  it('still prints the answer to stdout with --github-output, as without the option', () => {
    const some = branch(() => put('src/shared/format.ts', 'export const format = (n: number): string => `{${n}}`\n'))
    expect(affectedIn({ GITHUB_OUTPUT: join(scratch, 'github-output-stdout') }, some, '--github-output').lines).toEqual(['test/unit/format.test.ts', 'test/unit/menu.test.ts'])
  })

  it('appends run=none to $GITHUB_OUTPUT for a change that needs no tests', () => {
    expect(output(branch(() => put('docs/notes.md', 'other notes\n')))).toBe('earlier=1\nrun=none\nfiles=\n')
  })

  it('appends run=all to $GITHUB_OUTPUT for a change that needs them all', () => {
    expect(output(branch(() => put('vitest.config.ts', `${CONFIG}// for the output\n`)))).toBe('earlier=1\nrun=all\nfiles=\n')
  })

  it('answers all in $GITHUB_OUTPUT for a selected file whose name has white space, which a list split on spaces would cut', () => {
    const head = branch(() => put('test/unit/two words.test.ts', 'export const probe = 0\n'))
    const file = join(scratch, 'github-output-space')
    const r = affectedIn({ GITHUB_OUTPUT: file }, head, '--github-output')
    expect(r.status, r.stderr).toBe(0)
    expect(r.lines).toEqual(['test/unit/scan.test.ts', 'test/unit/two words.test.ts'])
    expect(readFileSync(file, 'utf8')).toBe('run=all\nfiles=\n')
    expect(r.stderr).toContain('"test/unit/two words.test.ts" has white space in its name')
  })

  it('refuses --github-output without GITHUB_OUTPUT (exit code 2)', () => {
    const head = branch(() => put('src/shared/alone.ts', 'export const alone = 4\n'))
    const r = affectedIn({ GITHUB_OUTPUT: '' }, head, '--github-output')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--github-output: GITHUB_OUTPUT is not set')
  })
})

describe('affected-tests.mjs refuses', () => {
  // With --github-output an error must fail the CI step, never read as an empty list: exit code 2,
  // and $GITHUB_OUTPUT keeps only what it held before. One test for each kind of failing input.
  const refusedWithOutput = (name: string, run: (file: string) => { status: number | null; stderr: string }): void => {
    const file = join(scratch, `github-output-refused-${name}`)
    writeFileSync(file, 'earlier=1\n')
    const r = run(file)
    expect(r.status, r.stderr).toBe(2)
    expect(readFileSync(file, 'utf8')).toBe('earlier=1\n')
  }

  it('with --github-output, exits 2 and writes no answer for a table it cannot read', () => {
    const broken = branch(() => put('scripts/affected-tests.table.json', '{"all": [], "none": []}\n'))
    refusedWithOutput('table', (file) => affectedIn({ GITHUB_OUTPUT: file }, broken, '--github-output'))
  })

  it('with --github-output, exits 2 and writes no answer for an unknown commit', () => {
    const head = branch(() => put('src/shared/alone.ts', 'export const alone = 5\n'))
    refusedWithOutput('commit', (file) => affectedFrom('no-such-ref', { GITHUB_OUTPUT: file }, head, '--github-output'))
  })

  it('with --github-output, exits 2 and writes no answer for a working tree that is not the head', () => {
    const head = branch(() => put('src/shared/alone.ts', 'export const alone = 6\n'))
    checkout('main')
    refusedWithOutput('tree', (file) => spawnSync(scriptNode(), [SCRIPT, 'main', head, '--github-output'], { cwd: repo, encoding: 'utf8', env: { ...gitEnv(), GITHUB_OUTPUT: file } }))
  })

  it('to answer when the working tree is not the head (exit code 2)', () => {
    const head = branch(() => put('src/shared/alone.ts', 'export const alone = 3\n'))
    checkout('main')
    const r = spawnSync(scriptNode(), [SCRIPT, 'main', head], { cwd: repo, encoding: 'utf8', env: gitEnv() })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain(`the working tree is not ${head}`)
  })

  it('wrong arguments and an unknown commit (exit code 2)', () => {
    for (const args of [[], ['main'], ['main', 'HEAD', 'extra'], ['--json'], ['-x', 'HEAD'], ['main', 'no-such-ref']]) {
      const r = spawnSync(scriptNode(), [SCRIPT, ...args], { cwd: repo, encoding: 'utf8', env: gitEnv() })
      expect(r.status, args.join(' ')).toBe(2)
      expect(r.stdout, args.join(' ')).toBe('')
    }
  })

  it('a table it cannot read, rather than taking it for "no links" (exit code 2)', () => {
    const broken = branch(() => put('scripts/affected-tests.table.json', '{"all": [], "none": [], "links": [{"paths": ["harness/**"]}]}\n'))
    const b = affected(broken)
    expect(b.status).toBe(2)
    expect(b.stderr).toContain('"links" must be a list of')
  })

  it('a table with a committed copy of the generated rows, even a correct one: it is what went stale before (exit code 2)', () => {
    const generated = branch(() => put('scripts/affected-tests.table.json', JSON.stringify({ ...TABLE, generated: [{ file: 'test/unit/reader.test.ts', reads: ['data/input.txt'] }] })))
    const g = affected(generated)
    expect(g.status).toBe(2)
    expect(g.stdout).toBe('')
    expect(g.stderr).toContain('"generated" is built from the test sources on every run; remove it from the table')
  })

  it('a missing table (exit code 2)', () => {
    const missing = branch(() => git('rm', '-q', 'scripts/affected-tests.table.json'))
    const r = affected(missing)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('cannot read scripts/affected-tests.table.json')
  })
})

describe('affected-tests-table.mjs, the generator of the rows', () => {
  // A second repository: the generator reads every tracked file under test/ of the one it runs in.
  let gen = ''
  const inGen = (path: string, text: string): void => {
    mkdirSync(join(gen, path, '..'), { recursive: true })
    writeFileSync(join(gen, path), text)
  }
  const gitGen = (...args: string[]) => spawnSync('git', [...SETTINGS, ...args], { cwd: gen, encoding: 'utf8', env: gitEnv() })

  beforeAll(() => {
    gen = join(scratch, 'generator')
    mkdirSync(gen)
    gitGen('init', '-q')
    for (const path of ['README.md', 'docs/design/SPEC.md', 'test/fixtures/agent-scripts/one.jsonl', 'test/fixtures/legacy/home.json', 'data/one.txt', 'data/two.txt', 'data/three.txt', 'src/a.ts']) inGen(path, 'x\n')
    // The forms the tests of this repository use to name a file.
    inGen(
      'test/unit/scripts-dir.test.ts',
      [
        "import { dirname, join, resolve } from 'node:path'",
        "import { fileURLToPath } from 'node:url'",
        "const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')",
        'export const script = (name: string): string => join(scriptsDir, name)',
        '',
      ].join('\n'),
    )
    inGen(
      'test/unit/read-helper.test.ts',
      [
        "import { readFileSync } from 'node:fs'",
        "import { join } from 'node:path'",
        // An import is the module graph's business, not a file read by path.
        "import type { a } from 'src/a.ts'",
        "const REPO = join(import.meta.dirname, '..', '..')",
        'const read = (...path: string[]): string => readFileSync(join(REPO, ...path), \'utf8\')',
        "export const readme = read('README.md')",
        "export const spec = readFileSync(join(REPO, 'docs', 'design', 'SPEC.md'), 'utf8')",
        '',
      ].join('\n'),
    )
    inGen('test/legacy.ts', "import { join } from 'node:path'\nexport const home = (repo: string): string => join(repo, 'test', 'fixtures', 'legacy')\n")
    inGen(
      'test/unit/scanner.test.ts',
      [
        "import { readdirSync, readFileSync } from 'node:fs'",
        "import { join } from 'node:path'",
        "import { a } from '../../src/a'",
        "const DATA = join(__dirname, '..', '..', 'data')",
        "export const one = readFileSync(join(DATA, 'one.txt'), 'utf8')",
        "export const two = readFileSync(new URL('../../data/two.txt', import.meta.url), 'utf8')",
        "export const sources = readdirSync(join(__dirname, '..', '..', 'src'))",
        "export const temporary = join('/tmp', 'src', 'b.ts')",
        "export const NAME = 'data/three.txt'",
        // Not a file of the repository: it stays out.
        "export const LATER = 'data/later.txt'",
        'export const used = a',
        '',
      ].join('\n'),
    )
    gitGen('add', '-A')
    gitGen('commit', '-q', '-m', 'base')
  })

  it('finds the files each test file and helper names, in the forms the tests use', () => {
    expect(generate(gen)).toEqual([
      { file: 'test/legacy.ts', reads: ['test/fixtures/legacy'] },
      { file: 'test/unit/read-helper.test.ts', reads: ['README.md', 'docs/design/SPEC.md'] },
      { file: 'test/unit/scanner.test.ts', reads: ['data/one.txt', 'data/three.txt', 'data/two.txt'], scans: ['src'] },
      { file: 'test/unit/scripts-dir.test.ts', reads: ['test/fixtures/agent-scripts'] },
    ])
  })

  it('prints the rows as JSON when run as a command, and nothing else', () => {
    const r = spawnSync(scriptNode(), [GENERATOR], { cwd: gen, encoding: 'utf8', env: gitEnv() })
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual(generate(gen))
  })

  it('builds the rows of a reader as soon as git tracks it: nothing to rebuild or commit', () => {
    inGen('test/unit/late.test.ts', "import { readFileSync } from 'node:fs'\nexport const late = readFileSync(`${import.meta.dirname}/../../data/two.txt`, 'utf8')\n")
    expect(generate(gen).map((row) => row.file)).not.toContain('test/unit/late.test.ts')
    gitGen('add', '-A')
    expect(generate(gen)).toContainEqual({ file: 'test/unit/late.test.ts', reads: ['data/two.txt'] })
  })
})

describe('scripts/affected-tests.table.json of this repository', () => {
  type Link = { paths: string[]; files: string[]; scan?: boolean }
  const table = JSON.parse(readFileSync(join(REPO, 'scripts', 'affected-tests.table.json'), 'utf8')) as {
    all: { paths: string[] }[]
    links: Link[]
  }
  // The rows a run builds, in-process: the same call scripts/affected-tests.mjs makes.
  let generated: Generated[] = []
  beforeAll(() => {
    generated = generate(REPO)
  })
  const under = (path: string, named: string): boolean => path === named || path.startsWith(`${named}/`)
  /** What the rows select for `path`, as scripts/affected-tests.mjs reads them (without the graph). */
  const selected = (path: string): string[] => [
    ...table.links.filter((entry) => entry.paths.some((pattern) => posix.matchesGlob(path, pattern))).flatMap((entry) => entry.files),
    ...generated.filter((entry) => [...(entry.reads ?? []), ...(entry.scans ?? [])].some((named) => under(path, named))).map((entry) => entry.file),
  ]

  quarantined('affected-tests-repo-hand-rows')('holds only the rows written by hand: the generated ones are never committed', () => {
    expect(table).not.toHaveProperty('generated')
    expect(generated.length).toBeGreaterThan(100)
  })

  quarantined('affected-tests-repo-files-exist')('names only files that exist', () => {
    const named = [...table.links.flatMap((entry) => entry.files), ...generated.map((entry) => entry.file)]
    expect(named.filter((file) => !existsSync(join(REPO, file)))).toEqual([])
  })

  quarantined('affected-tests-repo-links')('sends a fixture, a document and a Harness script to the tests that read or start it', () => {
    expect(selected('test/fixtures/agent-scripts/account-error.jsonl')).toEqual(expect.arrayContaining(['test/contract/agent-session.test.ts', 'test/contract/orchestrator.test.ts', 'test/contract/permissions.test.ts']))
    expect(selected('test/fixtures/sdk-messages/README.md')).toContain('test/contract/agent-events.test.ts')
    expect(selected('test/fixtures/claude-home-legacy/README.md')).toContain('test/claude-home-legacy.ts')
    expect(selected('docs/design/F-SPEC.md')).toContain('test/unit/kind-tokens.test.ts')
    expect(selected('README.md')).toContain('test/contract/node-version.test.ts')
    expect(selected('docs/lessons/README.md')).toContain('test/unit/check-lessons.test.ts')
    expect(selected('src/main/agent/env.ts')).toContain('test/unit/e2e-no-spawn-on-load.test.ts')
    expect(selected('test/contract/agent-session.test.ts')).toContain('test/unit/e2e-no-spawn-on-load.test.ts')
    expect(selected('harness/bin/wave-gate')).toContain('test/harness-scripts-suite.ts')
    expect(selected('harness/bin/profile')).toContain('test/harness-scripts-suite.ts')
    expect(selected('harness/hooks/gate.mjs')).toContain('test/unit/gate-state.test.ts')
    // This test runs the generator over every test source.
    expect(selected('test/unit/new.test.ts')).toContain('test/unit/affected-tests.test.ts')
    expect(selected('scripts/e2e-specs.table.json')).toContain('test/contract/ci-scope-e2e.test.ts')
  })

  quarantined('affected-tests-repo-run-all')('runs the whole suite for the configuration of the run', () => {
    const all = (path: string): boolean => table.all.some((entry) => entry.paths.some((pattern) => posix.matchesGlob(path, pattern)))
    for (const path of ['vitest.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.node.json', 'test/setup-contract.ts', 'scripts/vitest-electron.mjs']) expect(all(path), path).toBe(true)
    // A pull request that changes how the tests are picked runs them all.
    for (const path of ['scripts/affected-tests.mjs', 'scripts/affected-tests-table.mjs', 'scripts/affected-tests.table.json']) expect(all(path), path).toBe(true)
  })
})
