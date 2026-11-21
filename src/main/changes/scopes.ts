// The scopes of part 1 of the Changes screen over one repository of a Ticket (worfy-changes-view ticket 02;
// ADR-0110), with the git commands each one reads:
//
// - All changes (default): `git diff <merge-base>` — the work tree of the worktree against the merge-base with the
//   base, so the commits and what is not committed yet; plus the new files `ls-files --others --exclude-standard`
//   gives, each through `diff --no-index /dev/null <file>`. A branch checked out nowhere: `git diff <merge-base>
//   <branch>`, no new files.
// - Uncommitted (only a worktree): `git diff HEAD` plus the new files.
// - Commit: `git log <merge-base>..HEAD` lists the commits, `git show <sha>` gives one (a merge against its first
//   parent).
// - Compare against: All changes with any branch of `for-each-ref` in place of the base.
//
// The list of files is always whole (`--raw --numstat`); a file's patch is read only when asked for (`changes.file`)
// and comes folded past FOLD_LINES or FOLD_BYTES, for a lock file and for a `linguist-generated` one, unless the
// screen asks to expand it; even then no patch is read past PATCH_MAX_BYTES. All git goes through the reading
// runner of src/main/changes/git.ts.
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { foldOf, isRepoPath, isWorkflowPath, patchOfPath, parseCommits, parseDiffList, parseGenerated, parseNumstat, parsePatch, splitZ, COMMIT_FORMAT, FOLD_BYTES, type ListedFile } from '../../shared/changes/parse'
import type { ChangedFile, ChangesCommit, ChangesScope, FileDiff, ScopeKind } from '../../shared/changes/types'
import { gitProbe, mergeBase, pickBase, safeRef, type BaseFacts, type BaseSource } from './base'
import type { ChangesGit, GitRead } from './git'
import type { RepoSubject } from './subjects'

/** The most bytes of one file's patch read even when the screen asks to expand it. */
export const PATCH_MAX_BYTES = 64 * 1024 * 1024
/** «Show whole file»: context lines enough for any file the screen shows. */
export const WHOLE_FILE_CONTEXT = 100_000_000
/** The most commits `changes.commits` lists. */
export const COMMITS_MAX = 500
/** How many `diff --no-index` runs for the new files go at once. */
const UNTRACKED_AT_ONCE = 8

/** What the scopes of one repository read with. */
export interface ChangesContext {
  subject: RepoSubject
  git: ChangesGit
  /** The Profile's facts that pick the base. */
  facts: BaseFacts
  /** The Tickets root from this repository's top folder (`.scratch`) in Full mode; null when the workflow is not in it. */
  workflowPrefix: string | null
  /** The most bytes of an expanded patch; PATCH_MAX_BYTES when absent (tests set a smaller one). */
  patchMaxBytes?: number | undefined
  /**
   * The base commit of a pull request (worfy-pr-review ticket 06): All changes is its head against the merge-base with
   * it, whatever the Profile names; absent for a Ticket.
   */
  base?: string | undefined
}

/** The base of a repository's changes: the branch and the merge-base of the Ticket with it. */
export interface RepoBase {
  ref: string
  from: BaseSource | 'compare' | 'pr'
  mergeBase: string
}

/** The answer for one repository; `error` says why it has no files (no base, a git failure). */
export interface RepoChanges {
  repo: string
  kind: RepoSubject['kind']
  branch: string
  scope: ScopeKind
  base: RepoBase | null
  headSha: string
  /** The work tree is part of the scope: what is not committed is shown too. */
  workTree: boolean
  files: ChangedFile[]
  additions: number
  deletions: number
  error: string | null
}

/** A file of `changes.file`: its path, its old path after a rename, and whether git does not track it yet. */
export interface FileTarget {
  path: string
  oldPath?: string | null | undefined
  untracked?: boolean | undefined
}

export interface ReadOptions {
  /** Hide whitespace: `-w --ignore-cr-at-eol`. */
  hideWhitespace?: boolean | undefined
}

export interface FileOptions extends ReadOptions {
  /** «Show whole file»: the hunks hold every line of the file. */
  whole?: boolean | undefined
  /** «Show» on a folded patch: read it anyway, up to PATCH_MAX_BYTES. */
  expand?: boolean | undefined
}

/** The scopes the subject has: Uncommitted only where there is a work tree (never for a pull request). */
export function scopeKinds(subject: RepoSubject): ScopeKind[] {
  return subject.kind === 'worktree' ? ['all', 'uncommitted', 'commit', 'compare'] : ['all', 'commit', 'compare']
}

const failed = (what: string, read: GitRead): Error => new Error(`${what} failed: ${read.stderr.trim().split('\n')[0] || `exit code ${String(read.code)}`}`)

/** The base and the merge-base: by the Profile (pickBase), or `compare` in its place. */
export async function resolveBase(context: ChangesContext, compare?: string): Promise<RepoBase> {
  const { subject, git } = context
  const probe = gitProbe(subject.cwd, git)
  let ref: string
  let from: RepoBase['from']
  if (compare !== undefined) {
    if (!(await probe.exists(compare))) throw new Error(`No branch ${compare} in ${subject.repo}`)
    ref = compare
    from = 'compare'
  } else if (context.base !== undefined) {
    if (!(await probe.exists(context.base))) throw new Error(`No commit ${context.base} in ${subject.repo}`)
    ref = context.base
    from = 'pr'
  } else {
    const picked = await pickBase(context.facts, probe)
    if (picked === null) throw new Error(`No base branch in ${subject.repo}: neither worktree.base of the Profile nor origin/main nor a local main exists`)
    ref = picked.ref
    from = picked.from
  }
  const sha = await mergeBase(subject.cwd, ref, subject.head, git)
  if (sha === null) throw new Error(`${subject.branch} and ${ref} have no common commit`)
  return { ref, from, mergeBase: sha }
}

/** What a scope reads: the revisions of `git diff`, or the commit of `git show`. */
type Range = { kind: 'diff'; revs: string[]; untracked: boolean; base: RepoBase | null; workTree: boolean } | { kind: 'show'; sha: string; base: null; workTree: false }

const SHA = /^[0-9a-f]{7,64}$/u

async function rangeOf(context: ChangesContext, scope: ChangesScope): Promise<Range> {
  const { subject } = context
  const worktree = subject.kind === 'worktree'
  switch (scope.kind) {
    case 'all':
    case 'compare': {
      const base = await resolveBase(context, scope.kind === 'compare' ? scope.ref : undefined)
      return { kind: 'diff', revs: worktree ? [base.mergeBase] : [base.mergeBase, subject.head], untracked: worktree, base, workTree: worktree }
    }
    case 'uncommitted':
      if (!worktree) throw new Error(`The branch ${subject.branch} is checked out nowhere: it has nothing uncommitted`)
      return { kind: 'diff', revs: ['HEAD'], untracked: true, base: null, workTree: true }
    case 'commit': {
      if (!SHA.test(scope.sha) || (await context.git(subject.cwd, ['cat-file', '-e', `${scope.sha}^{commit}`])).code !== 0) throw new Error(`No commit ${scope.sha} in ${subject.repo}`)
      return { kind: 'show', sha: scope.sha, base: null, workTree: false }
    }
  }
}

const whitespace = (options: ReadOptions): string[] => (options.hideWhitespace ? ['-w', '--ignore-cr-at-eol'] : [])

/** The command that reads the range: `diff <revs>` or `show <sha>`, with `extra` options, and the paths after `--`. */
function rangeArgs(range: Range, extra: string[], paths: string[] = []): string[] {
  return range.kind === 'diff' ? ['diff', ...extra, ...range.revs, '--', ...paths] : ['show', '--format=', '--diff-merges=first-parent', ...extra, range.sha, '--', ...paths]
}

const LIST_FLAGS = ['--raw', '--numstat', '-z', '-M', '--no-abbrev']

/** The paths `ls-files --others --exclude-standard` gives: new files git does not track, without the ignored ones. */
async function untrackedPaths(context: ChangesContext): Promise<string[]> {
  const read = await context.git(context.subject.cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (read.code !== 0) throw failed('git ls-files', read)
  // A folder with `/` at its end is a repository inside this one: not a file of it.
  return splitZ(read.stdout).filter((path) => path !== '' && !path.endsWith('/'))
}

/** The counts of a new file: `diff --no-index --numstat /dev/null <file>` (exit code 1 means it differs). */
async function untrackedCounts(context: ChangesContext, path: string, options: ReadOptions): Promise<{ additions: number | null; deletions: number | null }> {
  const read = await context.git(context.subject.cwd, ['diff', '--no-index', '--numstat', '-z', ...whitespace(options), '--', '/dev/null', path])
  if (read.code !== 0 && read.code !== 1) throw failed(`git diff --no-index of ${path}`, read)
  const [entry] = parseNumstat(read.stdout)
  return entry ? { additions: entry.additions, deletions: entry.deletions } : { additions: 0, deletions: 0 }
}

/**
 * The blob ids of the new files' bytes as they are (`hash-object --no-filters --stdin-paths`; without `-w`: nothing
 * is written; `--no-filters`: no clean filter runs). For a file with a filter or an end-of-line conversion of
 * `.gitattributes` the id differs from the one `git add` would give.
 */
async function untrackedBlobs(context: ChangesContext, paths: string[]): Promise<Map<string, string>> {
  const hashable = paths.filter((path) => !path.includes('\n'))
  const blobs = new Map<string, string>()
  if (hashable.length === 0) return blobs
  const read = await context.git(context.subject.cwd, ['hash-object', '--no-filters', '--stdin-paths'], { input: `${hashable.join('\n')}\n` })
  if (read.code !== 0) return blobs
  const lines = read.stdout.split('\n')
  hashable.forEach((path, index) => {
    const blob = lines[index]?.trim()
    if (blob) blobs.set(path, blob)
  })
  return blobs
}

/** The paths of `paths` git marks `linguist-generated`: in the work tree's attributes, or those of `source`. */
async function generatedPaths(context: ChangesContext, paths: string[], source: string | null): Promise<Set<string>> {
  if (paths.length === 0) return new Set()
  const args = ['check-attr', '-z', '--stdin', ...(source !== null ? [`--source=${source}`] : []), 'linguist-generated']
  const read = await context.git(context.subject.cwd, args, { input: `${paths.join('\0')}\0` })
  // An old git without --source, or no attributes at all: nothing is generated.
  return read.code === 0 ? parseGenerated(read.stdout) : new Set()
}

/** The revision whose attributes count: the work tree's for a worktree scope, else the commit the changes end at. */
const attributeSource = (context: ChangesContext, range: Range): string | null => (range.kind === 'show' ? range.sha : range.workTree ? null : context.subject.head)

function runPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!
      await task(item)
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => undefined)
}

function changedFile(context: ChangesContext, listed: ListedFile, generated: Set<string>, untracked: boolean): ChangedFile {
  return {
    ...listed,
    untracked,
    workflow: isWorkflowPath(listed.path, context.workflowPrefix),
    fold: foldOf({ ...listed, generated: generated.has(listed.path) }),
  }
}

/** The files of a scope in one repository, sorted by path. Never throws: a failure is the answer's `error`. */
export async function listChanges(context: ChangesContext, scope: ChangesScope, options: ReadOptions = {}): Promise<RepoChanges> {
  const { subject } = context
  const answer = (fields: Partial<RepoChanges>): RepoChanges => ({
    repo: subject.repo,
    kind: subject.kind,
    branch: subject.branch,
    scope: scope.kind,
    base: null,
    headSha: subject.headSha,
    workTree: false,
    files: [],
    additions: 0,
    deletions: 0,
    error: null,
    ...fields,
  })
  try {
    const range = await rangeOf(context, scope)
    const read = await context.git(subject.cwd, rangeArgs(range, [...LIST_FLAGS, ...whitespace(options)]))
    if (read.code !== 0) throw failed(`git ${range.kind}`, read)
    const tracked = parseDiffList(read.stdout)
    const fresh: ListedFile[] = []
    if (range.kind === 'diff' && range.untracked) {
      const paths = await untrackedPaths(context)
      const blobs = await untrackedBlobs(context, paths)
      const counts = new Map<string, { additions: number | null; deletions: number | null }>()
      await runPool(paths, UNTRACKED_AT_ONCE, async (path) => {
        counts.set(path, await untrackedCounts(context, path, options))
      })
      for (const path of paths) {
        const { additions, deletions } = counts.get(path) ?? { additions: 0, deletions: 0 }
        fresh.push({ path, oldPath: null, status: 'A', additions, deletions, binary: additions === null && deletions === null, oldMode: null, newMode: null, oldBlob: null, newBlob: blobs.get(path) ?? null })
      }
    }
    const generated = await generatedPaths(context, [...tracked, ...fresh].map((file) => file.path), attributeSource(context, range))
    const files = [...tracked.map((file) => changedFile(context, file, generated, false)), ...fresh.map((file) => changedFile(context, file, generated, true))].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return answer({
      base: range.base,
      workTree: range.workTree,
      files,
      additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
      deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    })
  } catch (error) {
    return answer({ error: error instanceof Error ? error.message : String(error) })
  }
}

/** The size of a blob (`cat-file -s`), or of the file in the work tree when the side is the work tree's. */
async function sideSize(context: ChangesContext, blob: string | null, path: string | null, workTree: boolean): Promise<number | null> {
  if (blob !== null) {
    const read = await context.git(context.subject.cwd, ['cat-file', '-s', blob])
    const size = Number(read.stdout.trim())
    if (read.code === 0 && Number.isFinite(size)) return size
  }
  if (workTree && path !== null) {
    try {
      // lstat: a link is its own size (the length of its target path, as its blob), not that of the file it points to.
      return (await lstat(join(context.subject.cwd, path))).size
    } catch {
      return null
    }
  }
  return null
}

/** One file of a scope: its hunks, or folded, or a binary file's sizes. Throws when git fails or the file is not in the scope. */
export async function fileDiff(context: ChangesContext, scope: ChangesScope, target: FileTarget, options: FileOptions = {}): Promise<FileDiff> {
  const { subject, git } = context
  // A path outside the repository is never read, whatever the caller sent (the channel's schema refuses it too).
  for (const path of [target.path, target.oldPath]) if (path !== null && path !== undefined && !isRepoPath(path)) throw new Error(`${path} is not a path inside ${subject.repo}`)
  const range = await rangeOf(context, scope)
  const untracked = target.untracked === true && range.kind === 'diff' && range.untracked
  const paths = target.oldPath && target.oldPath !== target.path ? [target.oldPath, target.path] : [target.path]
  let listed: ListedFile | undefined
  if (untracked) {
    // `diff --no-index` reads any file it is given: only a new file git itself lists is one of this scope.
    if (!(await untrackedPaths(context)).includes(target.path)) throw new Error(`${target.path} is not a new file of ${subject.repo}`)
    const counts = await untrackedCounts(context, target.path, options)
    listed = { path: target.path, oldPath: null, status: 'A', ...counts, binary: counts.additions === null && counts.deletions === null, oldMode: null, newMode: null, oldBlob: null, newBlob: null }
  } else {
    const read = await git(subject.cwd, rangeArgs(range, [...LIST_FLAGS, ...whitespace(options)], paths))
    if (read.code !== 0) throw failed(`git ${range.kind}`, read)
    listed = parseDiffList(read.stdout).find((file) => file.path === target.path)
  }
  if (!listed) throw new Error(`${target.path} has no changes in this scope`)
  if (listed.binary) {
    const workTree = range.workTree
    return {
      kind: 'binary',
      path: listed.path,
      oldSize: listed.status === 'A' ? null : await sideSize(context, listed.oldBlob, null, false),
      newSize: listed.status === 'D' ? null : await sideSize(context, listed.newBlob, listed.path, workTree),
    }
  }
  const lines = (listed.additions ?? 0) + (listed.deletions ?? 0)
  if (!options.expand) {
    const generated = await generatedPaths(context, [listed.path], attributeSource(context, range))
    const reason = foldOf({ ...listed, generated: generated.has(listed.path) })
    if (reason !== null) return { kind: 'folded', path: listed.path, reason, lines }
  }
  const patchFlags = ['-M', '--patch', ...(options.whole ? [`--unified=${WHOLE_FILE_CONTEXT}`] : []), ...whitespace(options)]
  const args = untracked ? ['diff', '--no-index', ...patchFlags, '--', '/dev/null', target.path] : rangeArgs(range, patchFlags, paths)
  const limit = context.patchMaxBytes ?? PATCH_MAX_BYTES
  const maxBytes = options.expand ? limit : FOLD_BYTES + 1
  const read = await git(subject.cwd, args, { maxBytes })
  if (read.truncated) {
    if (options.expand) throw new Error(`The patch of ${target.path} is larger than ${limit % (1024 * 1024) === 0 ? `${limit / 1024 / 1024} MB` : `${limit} bytes`}`)
    return { kind: 'folded', path: listed.path, reason: 'large', lines }
  }
  if (read.code !== 0 && !(untracked && read.code === 1)) throw failed(`git ${args[0]!}`, read)
  const patches = parsePatch(read.stdout)
  // A type change (a file became a link or back) comes as two patches of one path: the deletion and the addition.
  const patch = patchOfPath(patches, target.path) ?? patches[0]
  if (patch?.binary) return { kind: 'binary', path: listed.path, oldSize: await sideSize(context, listed.oldBlob, null, false), newSize: await sideSize(context, listed.newBlob, listed.path, range.workTree) }
  return {
    kind: 'hunks',
    path: listed.path,
    oldPath: listed.oldPath,
    oldMode: patch?.oldMode ?? listed.oldMode,
    newMode: patch?.newMode ?? listed.newMode,
    hunks: patch?.hunks ?? [],
    whole: options.whole === true,
  }
}

/** The Ticket's commits: `git log <merge-base>..<head>`, newest first, at most COMMITS_MAX. */
export async function listCommits(context: ChangesContext): Promise<{ base: RepoBase; commits: ChangesCommit[] }> {
  const { subject, git } = context
  const base = await resolveBase(context)
  const read = await git(subject.cwd, ['log', '-z', COMMIT_FORMAT, `--max-count=${COMMITS_MAX}`, `${base.mergeBase}..${subject.head}`, '--'])
  if (read.code !== 0) throw failed('git log', read)
  return { base, commits: parseCommits(read.stdout) }
}

/** The branches Compare against offers: the local ones and those of the remotes, without `<remote>/HEAD`. */
export async function compareBranches(context: ChangesContext): Promise<string[]> {
  const read = await context.git(context.subject.cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
  if (read.code !== 0) return []
  return read.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((ref) => ref !== '' && !ref.endsWith('/HEAD'))
    .map((ref) => ref.replace(/^refs\/(?:heads|remotes)\//u, ''))
    .filter(safeRef)
}
