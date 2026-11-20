// The diff of a pull request read from GitHub (worfy-pr-review ticket 06; ADR-0110, Amendment): when the PR's
// repository is not the Project's, or a commit of the PR is not in it, the Changes screen reads what GitHub says
// instead of git — and never fetches. Only GETs through `gh api <path>`, only while the screen asks:
//
// - All changes: `repos/{o}/{r}/pulls/{n}/files?per_page=100&page=<k>`, page after page until one is short; GitHub
//   lists at most GITHUB_FILES_MAX files of a PR (30 pages), and the answer says when it stopped there.
// - Commit: `repos/{o}/{r}/commits/{sha}?per_page=100&page=<k>`, its `files` the same way.
// - Since my review (the scope `compare` with a commit as `ref`): `repos/{o}/{r}/compare/{a}...{head}` — a three-dot
//   diff, as the local one; GitHub lists at most COMPARE_FILES_MAX files there, in one answer.
// - The commits of the PR: `repos/{o}/{r}/pulls/{n}/commits?per_page=100&page=<k>`, at most PR_COMMITS_MAX.
//
// A file's `patch` is the hunks of a git patch without its headers; parse.ts reads them as it reads a local diff
// (patchHunks gives it a header of its own). A file without `patch` — too large for GitHub, or binary (GitHub does not
// say which) — has no hunks: «Large diff · Open on GitHub». There is no context past the hunks GitHub sent: «Show whole
// file» gives the same hunks, and the screen offers «View file on GitHub» instead. Hide whitespace has no meaning here.
//
// The answers are kept in memory by the PR's head (and the scope): a second read of the same head asks gh nothing.
import { z } from 'zod'
import { foldOf, parsePatch } from '../../shared/changes/parse'
import type { ChangedFile, ChangeStatus, ChangesCommit, ChangesPrRef, ChangesScope, DiffHunk, FileDiff } from '../../shared/changes/types'

/** GitHub lists at most this many files of a pull request (`pulls/{n}/files`). */
export const GITHUB_FILES_MAX = 3_000
/** And at most this many of a compare. */
export const COMPARE_FILES_MAX = 300
/** The files and commits of one page. */
export const GITHUB_PAGE = 100
/** GitHub lists at most this many commits of a pull request. */
export const PR_COMMITS_MAX = 250
/** The reads kept in memory: the PRs of a review or two, their scopes and heads. */
export const KEPT_READS = 16

/** Runs `gh api <path>` as the Project's account and resolves its stdout; rejects with gh's reason. */
export type GhGet = (path: string) => Promise<string>

/** A file of `pulls/{n}/files`, `commits/{sha}` or `compare/{a}...{b}`, as GitHub gives it. */
export const githubFileSchema = z
  .object({
    filename: z.string().min(1),
    previous_filename: z.string().optional().catch(undefined),
    status: z.string().catch('modified'),
    additions: z.number().int().nonnegative().catch(0),
    deletions: z.number().int().nonnegative().catch(0),
    changes: z.number().int().nonnegative().optional().catch(undefined),
    sha: z.string().nullish().catch(null),
    blob_url: z.string().nullish().catch(null),
    patch: z.string().optional().catch(undefined),
  })
  .loose()
export type GithubFile = z.input<typeof githubFileSchema>

/** A file of the PR as the screen lists it, and the patch GitHub sent with it (null without one). */
export interface PrFile {
  file: ChangedFile
  patch: string | null
}

/** The files of a scope of the PR; `truncatedAt` — GitHub listed only that many, null when it listed all. */
export interface PrListing {
  files: PrFile[]
  truncatedAt: number | null
}

const STATUSES: Readonly<Record<string, ChangeStatus>> = { added: 'A', removed: 'D', modified: 'M', renamed: 'R', copied: 'A', changed: 'T', unchanged: 'M' }

/** The hunks of a patch GitHub sent: hunks without the headers of git, read by parse.ts under a header of their own. */
export function patchHunks(patch: string): DiffHunk[] {
  const text = patch.endsWith('\n') ? patch : `${patch}\n`
  return parsePatch(`diff --git a/file b/file\n${text}`)[0]?.hunks ?? []
}

/**
 * A file GitHub sent as the screen lists it. Without `patch` and without a line counted (and not a bare rename) it is
 * taken for binary; a file without `patch` is never folded: it has nothing to show but «Open on GitHub».
 */
export function prFileOf(input: GithubFile): PrFile {
  const raw = githubFileSchema.parse(input)
  const status = STATUSES[raw.status] ?? 'M'
  const patch = raw.patch === undefined || raw.patch === '' ? null : raw.patch
  const binary = patch === null && raw.additions === 0 && raw.deletions === 0 && status !== 'R'
  const additions = binary ? null : raw.additions
  const deletions = binary ? null : raw.deletions
  const file: ChangedFile = {
    path: raw.filename,
    oldPath: status === 'R' ? (raw.previous_filename ?? null) : null,
    status,
    additions,
    deletions,
    binary,
    oldMode: null,
    newMode: null,
    oldBlob: null,
    newBlob: status === 'D' ? null : (raw.sha ?? null),
    untracked: false,
    // Where the workflow lies in another repository is not known: no file of a PR is grouped as Workflow files.
    workflow: false,
    fold: patch === null ? null : foldOf({ path: raw.filename, additions, deletions, binary }),
    ...(raw.blob_url ? { url: raw.blob_url } : {}),
  }
  return { file, patch }
}

/** One file of the PR: «Open on GitHub» without a patch, folded unless `expand`, else the hunks GitHub sent. */
export function prFileDiff(entry: PrFile, options: { expand?: boolean | undefined }): FileDiff {
  const { file, patch } = entry
  // A bare rename: no line changed, so no patch and nothing to show but «No lines changed».
  if (patch === null && !file.binary && file.additions === 0 && file.deletions === 0) return { kind: 'hunks', path: file.path, oldPath: file.oldPath, oldMode: null, newMode: null, hunks: [], whole: false }
  if (patch === null) return { kind: 'no-patch', path: file.path, url: file.url ?? null }
  if (!options.expand && file.fold !== null) return { kind: 'folded', path: file.path, reason: file.fold, lines: (file.additions ?? 0) + (file.deletions ?? 0) }
  return { kind: 'hunks', path: file.path, oldPath: file.oldPath, oldMode: null, newMode: null, hunks: patchHunks(patch), whole: false }
}

const SHA = /^[0-9a-f]{7,64}$/u

const commitSchema = z
  .object({
    sha: z.string().min(1),
    commit: z
      .object({
        message: z.string().catch(''),
        author: z.object({ name: z.string().nullish(), date: z.string().nullish() }).loose().nullish().catch(null),
      })
      .loose(),
  })
  .loose()

const json = (text: string, what: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`GitHub's answer to ${what} is not JSON`)
  }
}

const byPath = (a: PrFile, b: PrFile): number => (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0)

/** Pages of `path` (`?per_page=100&page=<k>`) until one is short or `max` items came; `items` reads a page's answer. */
async function pages(get: GhGet, path: string, max: number, items: (answer: unknown) => unknown[]): Promise<{ items: unknown[]; full: boolean }> {
  const all: unknown[] = []
  for (let page = 1; all.length < max; page++) {
    const url = `${path}?per_page=${GITHUB_PAGE}&page=${page}`
    const got = items(json(await get(url), url))
    all.push(...got)
    if (got.length < GITHUB_PAGE) return { items: all.slice(0, max), full: false }
  }
  return { items: all.slice(0, max), full: true }
}

const filesOf = (answer: unknown): unknown[] => {
  const files = Array.isArray(answer) ? answer : (answer as { files?: unknown } | null)?.files
  return Array.isArray(files) ? files : []
}

/** The reads of PRs from GitHub, kept in memory by head and scope; one per handlers of `changes.*`. */
export class PrDiffs {
  private readonly kept = new Map<string, Promise<unknown>>()

  constructor(private readonly max = KEPT_READS) {}

  /** The files of a scope: All changes, Commit, or Since my review (`compare` with a commit). */
  files(get: GhGet, pr: ChangesPrRef, scope: ChangesScope): Promise<PrListing> {
    const base = `repos/${pr.repo}`
    switch (scope.kind) {
      case 'all':
        return this.keep(pr, 'all', async () => {
          const read = await pages(get, `${base}/pulls/${pr.number}/files`, GITHUB_FILES_MAX, filesOf)
          return listing(read.items, read.full ? GITHUB_FILES_MAX : null)
        })
      case 'commit':
        if (!SHA.test(scope.sha)) return Promise.reject(new Error(`No commit ${scope.sha} in ${pr.repo}`))
        return this.keep(pr, `commit ${scope.sha}`, async () => {
          const read = await pages(get, `${base}/commits/${scope.sha}`, GITHUB_FILES_MAX, filesOf)
          return listing(read.items, read.full ? GITHUB_FILES_MAX : null)
        })
      case 'compare': {
        if (!SHA.test(scope.ref)) return Promise.reject(new Error(`Since my review takes a commit of ${pr.repo}, not ${scope.ref}`))
        return this.keep(pr, `compare ${scope.ref}`, async () => {
          const path = `${base}/compare/${scope.ref}...${pr.headOid}`
          const files = filesOf(json(await get(path), path))
          return listing(files, files.length >= COMPARE_FILES_MAX ? COMPARE_FILES_MAX : null)
        })
      }
      case 'uncommitted':
        return Promise.reject(new Error(`A pull request has nothing uncommitted`))
    }
  }

  /** The commits of the PR, newest first, as `git log` lists a Ticket's. */
  commits(get: GhGet, pr: ChangesPrRef): Promise<ChangesCommit[]> {
    return this.keep(pr, 'commits', async () => {
      const read = await pages(get, `repos/${pr.repo}/pulls/${pr.number}/commits`, PR_COMMITS_MAX, (answer) => (Array.isArray(answer) ? answer : []))
      return read.items
        .map((item) => commitSchema.safeParse(item))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
        .map((each) => ({ sha: each.sha, short: each.sha.slice(0, 7), author: each.commit.author?.name ?? '', date: each.commit.author?.date ?? '', subject: each.commit.message.split('\n')[0] ?? '' }))
        .reverse()
    })
  }

  /** The read named by the PR's head and `what`: kept while it is among the last `max`; a failed one is not kept. */
  private keep<T>(pr: ChangesPrRef, what: string, read: () => Promise<T>): Promise<T> {
    const key = `${pr.repo.toLowerCase()}#${pr.number}@${pr.headOid}|${what}`
    const found = this.kept.get(key)
    if (found !== undefined) {
      // The newest use last: the oldest goes first.
      this.kept.delete(key)
      this.kept.set(key, found)
      return found as Promise<T>
    }
    const reading = read()
    this.kept.set(key, reading)
    reading.catch(() => {
      if (this.kept.get(key) === reading) this.kept.delete(key)
    })
    while (this.kept.size > this.max) this.kept.delete(this.kept.keys().next().value!)
    return reading
  }
}

function listing(items: readonly unknown[], truncatedAt: number | null): PrListing {
  const files = items.flatMap((item) => {
    const parsed = githubFileSchema.safeParse(item)
    return parsed.success ? [prFileOf(parsed.data)] : []
  })
  return { files: files.sort(byPath), truncatedAt }
}
