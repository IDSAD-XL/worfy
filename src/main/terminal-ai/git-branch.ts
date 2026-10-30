// The git branch of a Terminal's folder, for the context of a Terminal AI request.
//
// First from the repository's files, with no process: find `.git` upwards from the folder, follow a
// `.git` file (`gitdir: <path>`, a worktree or a submodule) to the git directory, and read its `HEAD`.
// `ref: refs/heads/<name>` gives the name; a commit id (a detached HEAD) gives null. A git process
// did not answer within its limit on a loaded machine, and the request then went without a branch
// (worfy-terminal-ai ticket 17).
//
// Only when the files do not answer — no `.git` up to the root of the disk (GIT_DIR and the like may
// still name a repository), a file that cannot be read, a form this reader does not know (an empty or
// broken HEAD, a reftable repository) — `git branch --show-current` answers, at most
// GIT_BRANCH_TIMEOUT_MS; null when git is missing, fails or is slow: the request then goes without a
// branch.
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export const GIT_BRANCH_TIMEOUT_MS = 1000

export interface GitBranchOptions {
  /** The git program of the fallback; `git` on the PATH by default. */
  git?: string
  timeoutMs?: number
}

/** What a HEAD file says: a branch, or a detached HEAD (a commit id). */
export type Head = { branch: string } | { detached: true }

const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const BRANCH_REF = /^ref:\s*refs\/heads\/(.+)$/

/**
 * Reads the content of a HEAD file. Null for anything else than a branch of refs/heads or a commit
 * id, and for a branch name git would refuse (`git check-ref-format`): reftable repositories keep the
 * name `refs/heads/.invalid` in HEAD on purpose, and the real branch lives elsewhere.
 */
export function readHead(content: string): Head | null {
  const head = content.trim()
  if (COMMIT_ID.test(head)) return { detached: true }
  const name = BRANCH_REF.exec(head)?.[1]
  return name !== undefined && validBranchName(name) ? { branch: name } : null
}

/** The rules of `git check-ref-format` for the part after refs/heads/. */
function validBranchName(name: string): boolean {
  if (name === '@' || name.endsWith('/') || name.endsWith('.')) return false
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false
  // eslint-disable-next-line no-control-regex -- control characters are exactly what git refuses
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) return false
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'))
}

/**
 * The git directory a `.git` file in `dir` points to (`gitdir: <path>`, relative to `dir` or
 * absolute, with `/` or `\` and a drive letter on Windows). Null for a file in another form.
 * `pathApi` is node:path of the platform; the tests pass path.win32.
 */
export function gitDirFromFile(content: string, dir: string, pathApi: typeof path = path): string | null {
  const match = /^gitdir:\s*(.*?)\s*$/.exec(content.split(/\r?\n/, 1)[0] ?? '')
  const target = match?.[1]
  return target ? pathApi.resolve(dir, target) : null
}

/** The git directory of `cwd`, found upwards; null when none is found or a file on the way cannot be read. */
async function findGitDir(cwd: string): Promise<string | null> {
  try {
    if (!(await stat(cwd)).isDirectory()) return null
    for (let dir = path.resolve(cwd); ; ) {
      const dotGit = path.join(dir, '.git')
      const found = await stat(dotGit).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
        throw error
      })
      if (found?.isDirectory()) return dotGit
      if (found?.isFile()) return gitDirFromFile(await readFile(dotGit, 'utf8'), dir)
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  } catch {
    return null
  }
}

/** The branch from the repository's files; undefined when the files do not tell. */
async function branchFromFiles(cwd: string): Promise<string | null | undefined> {
  const gitDir = await findGitDir(cwd)
  if (gitDir === null) return undefined
  const head = readHead(await readFile(path.join(gitDir, 'HEAD'), 'utf8').catch(() => ''))
  if (head === null) return undefined
  return 'branch' in head ? head.branch : null
}

export async function gitBranch(cwd: string, options: GitBranchOptions = {}): Promise<string | null> {
  const fromFiles = await branchFromFiles(cwd)
  return fromFiles !== undefined ? fromFiles : gitProcessBranch(cwd, options)
}

function gitProcessBranch(cwd: string, options: GitBranchOptions): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        options.git ?? 'git',
        ['branch', '--show-current'],
        // GIT_OPTIONAL_LOCKS=0: reading the branch never takes the index lock of the user's repository.
        { cwd, timeout: options.timeoutMs ?? GIT_BRANCH_TIMEOUT_MS, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true },
        (error, stdout) => {
          const branch = error ? '' : String(stdout).trim()
          resolve(branch === '' ? null : branch)
        },
      )
    } catch {
      resolve(null)
    }
  })
}
