// The code a step of a Code story shows for a fragment, read from git when the step is shown (worfy-code-stories
// ticket 08; harness/bin/TICKETS.md, "Story anchor"). A fragment's line numbers are those of the PR's head, and a
// PR is merged by squash, so its head never reaches the main branch, and the main branch may have moved the code.
//
// Where a fragment is read — its anchor commit:
// - A committed story in Full mode (`{ path }`, the file under the Tickets root): the commit that brought the story
//   file to the main branch, `git log --first-parent --follow --diff-filter=A --format=%H -1 <main> -- <story path>`.
//   `<main>` is the commit the workflow is read from (main-ref.ts, ADR-0107): origin's main branch with the Tickets in
//   git, HEAD of the folder when that branch does not resolve.
// - A committed story in Silent mode: it lies in the Workflow folder, no commit of the code. Its anchor is its PR's
//   (`{ path, pr }`: the PR of the story's header, or of the chapter): the merge commit once the PR is merged, else the
//   PR's head (`gh pr view <N> --json headRefOid,mergeCommit`, through the `prCommits` the caller gives, asked once per
//   PR: cachedPrCommits). A PR story whose header says `PR -` — the implementer writes it before `gh pr create`, and
//   nothing rewrites it after — takes its Ticket's PR from the workflow model (the Ticket's `PR: #N` line, ticketPr).
//   With no PR there either, it has no anchor: TICKETS.md's anchor of that case, HEAD of the Ticket branch's worktree,
//   is not read (the deviation is recorded in the ticket).
// - A story kept outside git (`{ commit }`): the PR head its header, or its chapter, names.
//
// The fragment is looked for by its code in that commit's file: its lines as one block, a trailing carriage return
// dropped; of several matches, the one nearest the story's line numbers. Found — the commit's line numbers, the key
// lines moved by the same amount. Otherwise the story's own code with its own numbers, marked `fromHead`, with the
// reason: `changed` — the anchor holds other code there, or no such file; `no-anchor` — there is no anchor, or git
// cannot read it (a shallow clone, a colleague's head never fetched). The story carries its code, so nothing is lost
// and no story is refused for it.
//
// Nothing here writes: git only reads objects (main-ref.ts: one `ls-tree` and one `cat-file --batch` per file read).
import * as nativePath from 'node:path'
import { fragmentTooLarge, type FragmentCode, type StoryCodeAt } from '../../shared/ipc/stories'
import type { StoryFragment } from '../../shared/stories/schema'
import type { ProjectLayout } from '../workflow/folder'
import { refTree, resolveSource, runGit, type CatFileRunner, type RefGitRunner } from '../workflow/main-ref'

/** The largest file a fragment is looked for in; a larger one shows the story's own code. */
const FILE_MAX_BYTES = 8 * 1024 * 1024
/** How many anchors and file texts are kept between two steps of one story; the oldest goes first. */
const CACHE_SIZE = 64

/**
 * How many lines the search may compare beyond the first line of each place: a file of many like lines (empty ones) and
 * a long fragment of them would otherwise take its lines times the fragment's. Spent, the search keeps the nearest
 * match found so far, or shows the story's own code.
 */
export const SEARCH_BUDGET = 1_000_000

const SHA = /^[0-9a-f]{40,64}$/u

const lines = (text: string): string[] => text.split('\n').map((line) => line.replace(/\r$/u, ''))

/** The story's own code with its own numbers, and why it is shown. */
const ownCode = (fragment: StoryFragment, reason: NonNullable<FragmentCode['reason']>): FragmentCode => ({
  code: fragment.code,
  startLine: fragment.startLine,
  keyLines: [...fragment.keyLines],
  fromHead: true,
  reason,
})

/**
 * Where `fragment` stands in `text` (its file in the anchor commit; null when the commit has no such file): the block
 * nearest the story's line numbers, or the story's own code, marked `changed`, when the file does not hold it. Only the
 * places whose first line is the fragment's are compared further, and those comparisons are bounded by `budget`.
 */
export function placeFragment(text: string | null, fragment: StoryFragment, budget: number = SEARCH_BUDGET): FragmentCode {
  if (text === null) return ownCode(fragment, 'changed')
  const want = lines(fragment.code)
  const file = lines(text)
  let left = budget
  let best: number | null = null
  search: for (let at = 0; at + want.length <= file.length; at += 1) {
    if (file[at] !== want[0]) continue
    for (let index = 1; index < want.length; index += 1) {
      left -= 1
      if (left < 0) break search
      if (file[at + index] !== want[index]) continue search
    }
    if (best === null || Math.abs(at + 1 - fragment.startLine) < Math.abs(best + 1 - fragment.startLine)) best = at
  }
  if (best === null) return ownCode(fragment, 'changed')
  const shift = best + 1 - fragment.startLine
  return { code: want.join('\n'), startLine: best + 1, keyLines: fragment.keyLines.map((line) => line + shift), fromHead: false, reason: null }
}

/**
 * Keeps at most CACHE_SIZE answers by key, dropping the oldest. Calls for one key while its answer is pending share it.
 * An answer is kept for `keepFor(answer)` ms (for good by default); a failure is not kept: the next step asks again.
 */
class Recent<T> {
  private readonly items = new Map<string, { made: Promise<T>; until: number }>()

  constructor(
    private readonly keepFor: (value: T) => number = () => Number.POSITIVE_INFINITY,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, make: () => Promise<T>): Promise<T> {
    const held = this.items.get(key)
    if (held !== undefined && held.until > this.now()) return held.made
    const item = { made: make(), until: Number.POSITIVE_INFINITY }
    this.items.delete(key)
    this.items.set(key, item)
    if (this.items.size > CACHE_SIZE) this.items.delete(this.items.keys().next().value!)
    item.made.then(
      (value) => {
        item.until = this.now() + this.keepFor(value)
      },
      () => {
        if (this.items.get(key) === item) this.items.delete(key)
      },
    )
    return item.made
  }
}

const anchors = new Recent<string | null>()
const texts = new Recent<string | null>()

/**
 * The anchor commit of the committed story at `storyPath` (relative to the repository's top, `/` between the parts)
 * on `main`: the commit that added the file, followed along the first parents; null when there is none. Rejects when
 * git fails: that is no answer, and nothing is kept of it.
 */
export async function anchorCommit(top: string, main: string, storyPath: string, git: RefGitRunner = runGit): Promise<string | null> {
  const ask = async (): Promise<string | null> => {
    // Literal pathspecs: an Epic named with `*` or `?` is a name, not a pattern (as refTree of main-ref.ts).
    const out = await git(top, ['--literal-pathspecs', 'log', '--first-parent', '--follow', '--diff-filter=A', '--format=%H', '-1', main, '--', storyPath])
    const sha = out.trim()
    return SHA.test(sha) ? sha : null
  }
  // A full sha does not move; a name such as HEAD does, and is asked each time.
  return SHA.test(main) && git === runGit ? anchors.get(`${top}\0${main}\0${storyPath}`, ask) : ask()
}

/**
 * The text of `file` (relative to the repository's top) in `commit`; null when the commit has no such file. Rejects
 * when git cannot read the commit (it is not in the repository, or git failed): that is kept by no cache.
 */
async function fileAt(top: string, commit: string, file: string, git: RefGitRunner, cat?: CatFileRunner): Promise<string | null> {
  const read = async (): Promise<string | null> => {
    const tree = refTree({ top, sha: commit, committedAt: 0 }, '', [file], git, cat)
    return (await tree.texts([file], FILE_MAX_BYTES)).get(file) ?? null
  }
  return git === runGit && cat === undefined ? texts.get(`${top}\0${commit}\0${file}`, read) : read()
}

/** The top of the git work tree `folder` lies in, and the folder's path under it (`/`, ending in `/`; '' at the top). */
async function placeInGit(folder: string, git: RefGitRunner): Promise<{ top: string; prefix: string } | null> {
  try {
    const [top, prefix] = (await git(folder, ['rev-parse', '--show-toplevel', '--show-prefix'])).split('\n')
    return top ? { top: top.trim(), prefix: (prefix ?? '').trim() } : null
  } catch {
    return null
  }
}

/**
 * The parts of a story file under the Tickets root, `/` between them: `<epic>/story.md` or `<epic>/stories/<name>.md`
 * (harness/bin/TICKETS.md, "Code story"); null for anything else — a deeper file, `..`, a backslash, an absolute path.
 */
export function storyPathParts(path: string): { epic: string; parts: string[] } | null {
  if (/[\\\0]/u.test(path)) return null
  const parts = path.split('/')
  const epic = parts[0] ?? ''
  if (epic === '' || epic === '.' || epic === '..') return null
  const story = parts.length === 2 && parts[1] === 'story.md'
  const pr = parts.length === 3 && parts[1] === 'stories' && parts[2]!.endsWith('.md') && parts[2] !== '.md' && !parts[2]!.startsWith('.')
  return story || pr ? { epic, parts } : null
}

/** A fragment path of a story: relative to the repository's root, never out of it. */
const insideRepo = (path: string): boolean => !nativePath.posix.isAbsolute(path) && !/^[A-Za-z]:/u.test(path) && !path.split(/[\\/]/u).includes('..')

/** The commits GitHub names for PR `pr` of the Project at `root`: its head and, once merged, its merge commit. */
export type PrCommits = (root: string, pr: number) => Promise<{ head: string | null; merge: string | null }>

/** How long the head of a PR not merged yet is kept: a push moves it. A merge commit does not move, and is kept for good. */
export const PR_HEAD_TTL_MS = 60_000

/**
 * `prCommits` asked once per PR: the steps of one story, and the calls for it while gh answers, share the answer
 * (gh is a process and a GitHub request on the Project's account, shared with the PR badges and Autopilot). A merged
 * PR's answer is kept for good, an open one's for PR_HEAD_TTL_MS; a failure is not kept.
 */
export function cachedPrCommits(prCommits: PrCommits, now: () => number = Date.now): PrCommits {
  const recent = new Recent<{ head: string | null; merge: string | null }>((commits) => (commits.merge === null ? PR_HEAD_TTL_MS : Number.POSITIVE_INFINITY), now)
  return (root, pr) => recent.get(`${root}\0${String(pr)}`, () => prCommits(root, pr))
}

/** The PR number of Ticket `ticket` of Epic `epic` of the Project at `root`: its `PR: #N` line; null without one. */
export type TicketPr = (root: string, epic: string, ticket: number) => Promise<number | null>

/** How long a Ticket's PR number is kept: `ticket done --pr` writes it once, and a Ticket without one gets it later. */
export const TICKET_PR_TTL_MS = 60_000

/**
 * TicketPr from the workflow model `read` gives (readWorkflow of src/main/workflow/reader.ts, the Ticket's `pr`), asked
 * once per Project and Ticket for TICKET_PR_TTL_MS; the calls while the model is read share it, a failure is not kept.
 */
export function ticketPrFromModel(
  read: (root: string) => Promise<{ tickets: readonly { epic: string; num: number; pr?: number | null | undefined }[] }>,
  now: () => number = Date.now,
): TicketPr {
  const recent = new Recent<number | null>(() => TICKET_PR_TTL_MS, now)
  return (root, epic, ticket) =>
    recent.get(`${root}\0${epic}\0${String(ticket)}`, async () => (await read(root)).tickets.find((one) => one.epic === epic && one.num === ticket)?.pr ?? null)
}

export interface StoryCodeOptions {
  /** The git runner; main-ref.ts's runGit by default. Tests pass one with their own configuration. */
  git?: RefGitRunner
  cat?: CatFileRunner
  /** The commits of a PR, for the anchor of a Silent Project's story; none — such a story has no anchor. */
  prCommits?: PrCommits
  /** The PR of a Ticket, for a Silent story of the Ticket's PR whose header says `PR -`; none — such a story has no anchor. */
  ticketPr?: TicketPr
}

/** The Ticket a PR story is of, by its file name `NN-<slug>.md`; null for an Epic story and a name without a number. */
function storyTicketNumber(parts: readonly string[]): number | null {
  const match = parts.length === 3 ? /^(\d+)-/u.exec(parts[2]!) : null
  return match === null ? null : Number(match[1])
}

/** The PR a Silent story's code is read at: the one the call names, else, for `PR -`, its Ticket's (TICKETS.md, "Code story"). */
async function storyPr(layout: ProjectLayout, at: { path: string; pr?: number | null | undefined }, options: StoryCodeOptions): Promise<number | null> {
  if (at.pr !== undefined && at.pr !== null) return at.pr
  const where = storyPathParts(at.path)
  const ticket = where === null ? null : storyTicketNumber(where.parts)
  if (where === null || ticket === null || options.ticketPr === undefined) return null
  return options.ticketPr(layout.root, where.epic, ticket)
}

/** Where the fragments of the story `at` are read: the repository's top and the commit; null — there is no anchor. */
async function codeSource(layout: ProjectLayout, at: StoryCodeAt, options: StoryCodeOptions, git: RefGitRunner): Promise<{ top: string; commit: string } | null> {
  if ('commit' in at) {
    const place = await placeInGit(layout.root, git)
    return place === null ? null : { top: place.top, commit: at.commit }
  }
  if (layout.failed) return null
  if (layout.mode === 'silent') {
    // The Workflow folder is no commit of the code: the anchor is the PR's (see the top of the file).
    const pr = options.prCommits === undefined ? null : await storyPr(layout, at, options)
    if (pr === null) return null
    const commits = await options.prCommits!(layout.root, pr)
    const commit = commits.merge ?? commits.head
    const place = commit === null || !SHA.test(commit) ? null : await placeInGit(layout.root, git)
    return place === null ? null : { top: place.top, commit: commit! }
  }
  const source = await resolveSource(layout.root, layout, { details: false, git })
  if (source.kind === 'ref') {
    const story = source.ticketsRel === '' ? at.path : `${source.ticketsRel}/${at.path}`
    const anchor = await anchorCommit(source.top, source.sha, story, git)
    return anchor === null ? null : { top: source.top, commit: anchor }
  }
  // The main branch does not resolve: the folder's HEAD is the main branch as seen from here.
  const place = await placeInGit(layout.ticketsRoot, git)
  if (place === null) return null
  const anchor = await anchorCommit(place.top, 'HEAD', `${place.prefix}${at.path}`, git)
  return anchor === null ? null : { top: place.top, commit: anchor }
}

/**
 * The code the step shows for `fragment` of the story `at` of the Project laid out as `layout`. A fragment larger than
 * FRAGMENT_MAX_LINES or FRAGMENT_MAX_CHARS is refused (throws) before git is read.
 */
export async function storyFragmentCode(layout: ProjectLayout, at: StoryCodeAt, fragment: StoryFragment, options: StoryCodeOptions = {}): Promise<FragmentCode> {
  const large = fragmentTooLarge(fragment)
  if (large !== null) throw new Error(large)
  const git = options.git ?? runGit
  if (!insideRepo(fragment.path) || ('path' in at && storyPathParts(at.path) === null)) return ownCode(fragment, 'no-anchor')
  let text: string | null
  try {
    const source = await codeSource(layout, at, options, git)
    if (source === null) return ownCode(fragment, 'no-anchor')
    text = await fileAt(source.top, source.commit, fragment.path, git, options.cat)
  } catch {
    // git could not answer, or the anchor commit is not in the repository: shown as having none, and asked again next time.
    return ownCode(fragment, 'no-anchor')
  }
  return placeFragment(text, fragment)
}
