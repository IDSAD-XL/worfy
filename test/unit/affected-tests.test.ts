// scripts/affected-tests.mjs (worfy-throughput ticket 21): which unit and contract test files a
// change touches — by vite's module graph and by scripts/affected-tests.table.json for the links the
// graph cannot see; ALL for a change to the test run itself and for a path nothing covers.
// Each case makes a branch in a temporary git repository with its own small module graph and table,
// checks the branch out and runs the script there, as CI would run it on the head of a pull request.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'affected-tests.mjs')
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

/** A new branch from `from` with one commit made by `change`; returns its name. */
function branch(change: () => void, from = 'main'): string {
  const name = `topic-${++branches}`
  git('checkout', '-q', '-b', name, from)
  change()
  git('add', '-A')
  git('commit', '-q', '--allow-empty', '-m', name)
  git('checkout', '-q', 'main')
  return name
}

/** The script run on `head` checked out, as `<base> <head>`. */
function affected(head: string, ...extra: string[]) {
  git('checkout', '-q', head)
  try {
    const result = spawnSync(scriptNode(), [SCRIPT, 'main', head, ...extra], { cwd: repo, encoding: 'utf8', env: gitEnv() })
    return { status: result.status, lines: result.stdout.split('\n').filter((line) => line !== ''), stdout: result.stdout, stderr: result.stderr }
  } finally {
    git('checkout', '-q', 'main')
  }
}

// The fixture's table: the shape of the real one, small.
const TABLE = {
  all: [{ paths: ['vitest.config.ts', 'package.json'] }],
  none: [{ paths: ['docs/**'] }],
  links: [
    { paths: ['harness/**'], files: ['test/contract/harness-scripts.test.ts', 'test/contract/wave-gate.test.ts'] },
    { paths: ['config/flags.json'], files: ['test/flags.ts'] },
    { paths: ['test/**'], files: ['test/unit/scan.test.ts'] },
  ],
}

// A vitest configuration without imports: the temporary repository has no node_modules.
const CONFIG = `export default {
  test: {
    projects: [
      { test: { name: 'node', include: ['test/unit/**/*.test.ts'] } },
      { test: { name: 'contract', include: ['test/contract/**/*.test.ts'] } },
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

  it('answers ALL for a path neither the graph nor the table covers, changed or new', () => {
    const changed = branch(() => put('tools/build.sh', '#!/bin/sh\necho build\n'))
    expect(affected(changed).lines).toEqual(['ALL'])
    const added = branch(() => put('assets/logo.svg', '<svg/>\n'))
    const r = affected(added)
    expect(r.lines).toEqual(['ALL'])
    expect(r.stderr).toContain('assets/logo.svg: neither the module graph nor')
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
    git('checkout', '-q', '-b', 'base-ahead', 'main')
    put('vitest.config.ts', `${CONFIG}// changed on the base\n`)
    git('commit', '-q', '-am', 'base moves on')
    git('checkout', '-q', head)
    const r = spawnSync(scriptNode(), [SCRIPT, 'base-ahead', head], { cwd: repo, encoding: 'utf8', env: gitEnv() })
    git('checkout', '-q', 'main')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('prints one JSON object with --json', () => {
    const head = branch(() => put('src/shared/label.ts', "import { format } from './format'\nexport const label = (n: number): string => `#${format(n)}`\n"))
    const r = affected(head, '--json')
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ all: false, files: ['test/unit/menu.test.ts'], reasons: [] })
    const all = affected(branch(() => put('package.json', '{"name": "x"}\n')), '--json')
    expect(JSON.parse(all.stdout)).toEqual({ all: true, files: [], reasons: ['package.json: changes the whole test run'] })
  })
})

describe('affected-tests.mjs refuses', () => {
  it('to answer when the working tree is not the head (exit code 2)', () => {
    const head = branch(() => put('src/shared/alone.ts', 'export const alone = 3\n'))
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
    const missing = branch(() => git('rm', '-q', 'scripts/affected-tests.table.json'))
    const r = affected(missing)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('cannot read scripts/affected-tests.table.json')
  })
})

describe('scripts/affected-tests.table.json of this repository', () => {
  type Entry = { paths: string[]; files?: string[] }
  const table = JSON.parse(readFileSync(join(REPO, 'scripts', 'affected-tests.table.json'), 'utf8')) as Record<'all' | 'none' | 'links', Entry[]>
  const selected = (path: string): string[] =>
    table.links.filter((entry) => entry.paths.some((pattern) => posix.matchesGlob(path, pattern))).flatMap((entry) => entry.files ?? [])

  it('names only files that exist', () => {
    const missing = table.links.flatMap((entry) => entry.files ?? []).filter((file) => !existsSync(join(REPO, file)))
    expect(missing).toEqual([])
  })

  it('sends a Harness script to the contract tests that start it as a process', () => {
    expect(selected('harness/bin/wave-gate')).toContain('test/contract/harness-scripts.test.ts')
    expect(selected('harness/bin/land')).toContain('test/contract/harness-scripts.test.ts')
    expect(selected('harness/bin/profile')).toEqual(expect.arrayContaining(['test/contract/harness-migrate.test.ts', 'test/contract/projects-connect.test.ts']))
    expect(selected('harness/bin/project-connect')).toEqual(expect.arrayContaining(['test/contract/projects-connect.test.ts', 'test/contract/demo-template.test.ts']))
    expect(selected('harness/hooks/gate.mjs')).toEqual(expect.arrayContaining(['test/unit/gate-state.test.ts', 'test/contract/harness-migrate.test.ts']))
  })

  it('runs the whole suite for the configuration of the run', () => {
    const all = (path: string): boolean => table.all.some((entry) => entry.paths.some((pattern) => posix.matchesGlob(path, pattern)))
    for (const path of ['vitest.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.node.json', 'test/setup-contract.ts', 'scripts/vitest-electron.mjs']) expect(all(path), path).toBe(true)
  })
})
