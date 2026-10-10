// The git branch of a Terminal's folder, for the context of a Terminal AI request:
// `git branch --show-current`, at most GIT_BRANCH_TIMEOUT_MS. Null when the folder is not in a
// repository, HEAD is detached, git is missing or slow: the request then goes without a branch.
import { execFile } from 'node:child_process'

export const GIT_BRANCH_TIMEOUT_MS = 1000

export interface GitBranchOptions {
  /** The git program; `git` on the PATH by default. */
  git?: string
  timeoutMs?: number
}

export function gitBranch(cwd: string, options: GitBranchOptions = {}): Promise<string | null> {
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
