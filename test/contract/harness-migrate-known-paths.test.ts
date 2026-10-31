// knownPaths (src/main/harness/migrate/apply.ts) asks git once for all the paths a move commits,
// where it used to ask once per path. These cases hold it to the old answer: on one repository and
// one mix of paths, the set it returns is the set the call per path returns, in both modes. git
// runs with the global and system config switched off and HOME in the temporary folder, so neither
// the user's excludes file nor the real home take part.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { knownPaths } from '../../src/main/harness/migrate/apply'
import { removeTestTree } from '../remove'

// execFileSync as it is, with the git calls written down: the one-process claim is counted, not
// assumed. A batch call that failed and fell back to one call per path would give the same answer.
const spawned = vi.hoisted(() => ({ git: [] as string[][] }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const run = actual.execFileSync as (file: string, args: string[], options: object) => unknown
  const execFileSync = ((file: string, args: string[], options: object) => {
    if (file === 'git') spawned.git.push(args)
    return run(file, args, options)
  }) as typeof actual.execFileSync
  return { ...actual, execFileSync, default: { ...actual, execFileSync } }
})

/** knownPaths with the git processes it started. */
function counted(paths: string[], tracked: boolean): { known: string[]; processes: number } {
  spawned.git.length = 0
  const known = knownPaths(repo, paths, tracked)
  return { known, processes: spawned.git.length }
}

let root: string
let repo: string

const git = (...args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** The old answer, one git process per path: the code knownPaths replaced. */
function oneByOne(paths: string[], tracked: boolean): string[] {
  return paths.filter((rel) => {
    if (tracked) return git('ls-files', '-z', '--', rel) !== ''
    try {
      git('check-ignore', '-q', '--', rel)
      return false
    } catch {
      return true
    }
  })
}

const write = (rel: string): void => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), `${rel}\n`)
}

/** The paths asked about, each a kind of answer. */
const PATHS = [
  'settings.json', // a tracked file
  'skills/qmd', // a tracked folder
  'skills/qm', // the start of a tracked folder's name, not a folder: unknown
  'bin/epic', // the start of a tracked file's name: unknown
  'my notes.md', // a tracked file with a space
  'profiles/my profile', // a tracked folder with a space
  'SETTINGS.JSON', // a tracked file in another letter case
  'new.md', // untracked
  'cache', // an ignored folder
  'cache/state.json', // an ignored file
  'debug.log', // an ignored file by a pattern
  'gone.md', // not on disk at all
  'skills/*', // a pattern: git matches it, not a name
]

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-known-paths-')))
  const globalConfig = join(root, 'gitconfig')
  writeFileSync(globalConfig, '')
  vi.stubEnv('HOME', root)
  vi.stubEnv('USERPROFILE', root)
  vi.stubEnv('XDG_CONFIG_HOME', root)
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  repo = join(root, 'repo')
  mkdirSync(repo)
  git('init', '-q')
  for (const rel of ['settings.json', 'skills/qmd/SKILL.md', 'skills/qmd-extra/SKILL.md', 'bin/epic-status', 'my notes.md', 'profiles/my profile/profile.md', '.gitignore']) write(rel)
  writeFileSync(join(repo, '.gitignore'), 'cache/\n*.log\n')
  git('add', '-A')
  git('-c', 'user.name=worfy', '-c', 'user.email=worfy@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture')
  for (const rel of ['new.md', 'cache/state.json', 'debug.log']) write(rel)
})

afterAll(() => {
  vi.unstubAllEnvs()
  removeTestTree(root)
})

describe('knownPaths: one git process, the answer of one process per path', () => {
  it('tracked: the paths with a tracked file at them or under them', () => {
    const { known, processes } = counted(PATHS, true)
    // One for the plain paths, one for the pattern `skills/*`.
    expect(processes).toBe(2)
    expect(known).toEqual(oneByOne(PATHS, true))
    // The fixed half of the answer, so the comparison above cannot pass on two empty lists.
    expect(known).toEqual(expect.arrayContaining(['settings.json', 'skills/qmd', 'my notes.md', 'profiles/my profile', 'skills/*']))
    expect(known).not.toContain('skills/qm')
    expect(known).not.toContain('bin/epic')
    expect(known).not.toContain('new.md')
    expect(known).not.toContain('gone.md')
  })

  it('untracked: the paths no ignore rule takes', () => {
    const { known, processes } = counted(PATHS, false)
    expect(processes).toBe(2)
    expect(known).toEqual(oneByOne(PATHS, false))
    expect(known).toEqual(expect.arrayContaining(['settings.json', 'skills/qmd', 'my notes.md', 'new.md', 'gone.md']))
    for (const rel of ['cache', 'cache/state.json', 'debug.log']) expect(known).not.toContain(rel)
  })

  it('untracked with nothing ignored: check-ignore exits 1, and every path is known', () => {
    const paths = ['settings.json', 'new.md', 'my notes.md']
    expect(counted(paths, false)).toEqual({ known: paths, processes: 1 })
  })

  it('no paths: no answer', () => {
    expect(counted([], true)).toEqual({ known: [], processes: 0 })
    expect(counted([], false)).toEqual({ known: [], processes: 0 })
  })
})
