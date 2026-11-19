// The base of a Ticket's changes (worfy-changes-view ticket 02; ADR-0110): the branch the Ticket's branch is
// compared with, and the merge-base of the two. The facts are the Profile's, as main already reads them for the
// workflow (`worktree.base` and `workflow.finish`, ProjectLayout of src/main/workflow/folder.ts): no second run of
// `bin/profile`.
//
// The order is the Harness preflight's (`harness/profiles/README.md`, the row `worktree.base`):
// - `worktree.base` when it names a branch that exists;
// - else `origin/<default_branch>` of the repository, the branch `origin/HEAD` points to, `origin/main`;
// - a repository without `origin` in a Project that ends Tickets with `local-green` takes the local branch: the
//   value of `worktree.base` without `origin/`, then the default branch, `main`, `master`.
// When none of these exists, the local branches of that last step are tried in any Project: a repository with no
// `origin` and a Profile of `pr-green-ci` still has a main branch to compare with. Nothing found — no base, and the
// screen says so.
import type { ChangesGit } from './git'

/** What of the Profile picks the base. */
export interface BaseFacts {
  /** `worktree.base` (`origin/main`, `main`); null or absent when the Profile names none. */
  mainBranch?: string | null | undefined
  /** `workflow.finish`; null or absent when the Profile names none. */
  finish?: 'pr-green-ci' | 'local-green' | null | undefined
  /** `layout.repos.<repo>.default_branch`; null or absent when unknown. */
  defaultBranch?: string | null | undefined
}

/** The questions pickBase asks of the repository; gitProbe asks git, tests answer themselves. */
export interface RefProbe {
  /** Whether `ref` names a commit. */
  exists(ref: string): Promise<boolean>
  /** The branch `refs/remotes/origin/HEAD` points to, as `origin/<name>`; null when it points nowhere. */
  originHead(): Promise<string | null>
  /** Whether the repository has a branch of `origin` at all. */
  hasOrigin(): Promise<boolean>
}

/** Where a base came from: which step of the order found it. */
export type BaseSource = 'worktree.base' | 'default_branch' | 'origin/HEAD' | 'origin/main' | 'local'

export interface PickedBase {
  ref: string
  from: BaseSource
}

/** A branch name without `refs/heads/`, `refs/remotes/origin/` or `origin/`: `origin/main` and `main` give `main`. */
export function localName(ref: string): string {
  return ref
    .trim()
    .replace(/^refs\/(?:heads|remotes\/origin)\//u, '')
    .replace(/^origin\//u, '')
}

const blank = (value: string | null | undefined): value is null | undefined => value === null || value === undefined || value.trim() === ''

/** The base by the order at the top of the file; null when no branch of it exists. */
export async function pickBase(facts: BaseFacts, probe: RefProbe): Promise<PickedBase | null> {
  const local = async (): Promise<PickedBase | null> => {
    const names = [blank(facts.mainBranch) ? null : localName(facts.mainBranch), blank(facts.defaultBranch) ? null : localName(facts.defaultBranch), 'main', 'master']
    for (const name of new Set(names)) {
      if (name !== null && name !== '' && (await probe.exists(`refs/heads/${name}`))) return { ref: name, from: 'local' }
    }
    return null
  }
  const origin = await probe.hasOrigin()
  if (!origin && facts.finish === 'local-green') return local()
  if (!blank(facts.mainBranch) && (await probe.exists(facts.mainBranch.trim()))) return { ref: facts.mainBranch.trim(), from: 'worktree.base' }
  if (origin) {
    if (!blank(facts.defaultBranch)) {
      const ref = `origin/${localName(facts.defaultBranch)}`
      if (await probe.exists(ref)) return { ref, from: 'default_branch' }
    }
    const head = await probe.originHead()
    if (head !== null && (await probe.exists(head))) return { ref: head, from: 'origin/HEAD' }
    if (await probe.exists('origin/main')) return { ref: 'origin/main', from: 'origin/main' }
  }
  return local()
}

/** A ref the probe may hand to git: not an option, no whitespace or control characters. */
export const safeRef = (ref: string): boolean => ref !== '' && !ref.startsWith('-') && !/[\s\0-\x1f\x7f]/u.test(ref)

/** The probe over git in `cwd`: `cat-file -e` and `for-each-ref`, both only reading. */
export function gitProbe(cwd: string, git: ChangesGit): RefProbe {
  return {
    exists: async (ref) => safeRef(ref) && (await git(cwd, ['cat-file', '-e', `${ref}^{commit}`])).code === 0,
    originHead: async () => {
      const read = await git(cwd, ['for-each-ref', '--format=%(symref)', 'refs/remotes/origin/HEAD'])
      const target = read.code === 0 ? read.stdout.trim() : ''
      return target.startsWith('refs/remotes/') ? target.slice('refs/remotes/'.length) : null
    },
    hasOrigin: async () => {
      const read = await git(cwd, ['for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes/origin'])
      return read.code === 0 && read.stdout.trim() !== ''
    },
  }
}

/** `git merge-base <base> <head>`: the SHA, or null when the two have no common commit. */
export async function mergeBase(cwd: string, base: string, head: string, git: ChangesGit): Promise<string | null> {
  if (!safeRef(base) || !safeRef(head)) return null
  const read = await git(cwd, ['merge-base', base, head])
  const sha = read.stdout.trim()
  return read.code === 0 && /^[0-9a-f]{40,64}$/u.test(sha) ? sha : null
}
