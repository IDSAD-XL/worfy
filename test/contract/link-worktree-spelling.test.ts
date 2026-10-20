// A Linked machine may name a git worktree of a Project as the root of its Claude home calls
// (src/main/link/caller.ts, realProjectRoot): the worktree must be one `git worktree list` gives for
// the Project. git prints its paths in its own spelling — `C:/…` with forward slashes on Windows —
// while worfy's own paths have `\`. Here a real repository and a real worktree: the list as git
// prints it, and as gitWorktrees (src/main/claude-home/registry.ts) parses it, both let the
// worktree in, and a folder that is not a worktree stays out.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gitWorktrees } from '../../src/main/claude-home/registry'
import { realProjectRoot } from '../../src/main/link/caller'
import { removeTestTree } from '../remove'

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-link-worktree-')))
afterAll(() => removeTestTree(scratch))

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const SETTINGS = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0']
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...SETTINGS, ...args], { cwd, env: gitEnv, encoding: 'utf8' })

/** The `worktree` lines of `git worktree list --porcelain`, exactly as git prints them. */
const listedByGit = async (root: string): Promise<string[]> =>
  git(root, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))

describe('a worktree root in the spelling of `git worktree list`', () => {
  const project = join(scratch, 'project')
  mkdirSync(project)
  git(project, 'init', '-q')
  writeFileSync(join(project, 'README.md'), 'hi\n')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'first')
  const worktree = join(project, '.claude', 'worktrees', 'w')
  git(project, 'worktree', 'add', '-q', '-b', 'feature', worktree)
  const plain = join(project, 'src')
  mkdirSync(plain)
  const projects = [{ path: project }]

  it('git names the worktree with forward slashes on Windows, as the system spells it elsewhere', async () => {
    const listed = await listedByGit(project)
    const spelled = process.platform === 'win32' ? worktree.replaceAll('\\', '/') : worktree
    expect(listed.map((path) => path.toLowerCase())).toContain(spelled.toLowerCase())
  })

  it('the worktree passes with the list as git prints it and as gitWorktrees parses it; a plain subfolder does not', async () => {
    for (const lister of [listedByGit, gitWorktrees]) {
      expect(await realProjectRoot(worktree, projects, lister), lister.name).toBe(realpathSync.native(worktree))
      expect(await realProjectRoot(plain, projects, lister), lister.name).toBeNull()
    }
  })

  it('the worktree named the way git prints it passes too', async () => {
    const spelled = (await listedByGit(project)).find((path) => path.toLowerCase().endsWith('/w') || path.toLowerCase().endsWith('\\w')) ?? ''
    expect(await realProjectRoot(spelled, projects, gitWorktrees)).toBe(realpathSync.native(worktree))
  })
})
