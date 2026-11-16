// Which commit of a Project the workflow is read from (ADR-0107; worfy-polish ticket 118).
//
// In Full mode with the Tickets in git, the list of Epics and Tickets, the specs, the text of the Tickets, the
// state file and the ADRs are read from the Project's main branch, never from the working tree of its folder: the
// folder may lag behind, sit on a detached HEAD or on a branch, and hold untracked files. The main branch is
// `refs/remotes/origin/HEAD`, else `refs/remotes/origin/<main>`, for a Project whose Tickets end with a PR
// (`workflow.finish` `pr-green-ci`, or none named); the local `refs/heads/<main>` for one whose Tickets are merged
// locally (`local-green`). `<main>` is the branch of the Profile's `worktree.base`, else `main`. In `local-green` a folder
// that stands on `<main>` or on a Ticket's branch is read as it is: there the Harness writes the status (`ticket
// claim`) and does not commit it yet; a detached folder or one on any other branch reads the local `<main>`.
//
// The working tree is read, as before this ticket, where it is the truth: Silent mode (the Workflow folder lives in no
// branch), and a Tickets root outside git. It is read too, with a reason the window shows, when the main branch does
// not resolve: no `origin`, an empty repository.
//
// The files of a commit come from git objects: one `git ls-tree -r -z` of the folders a read needs and one
// `git cat-file --batch` of the files it reads, never a `git show` per file and never a checkout. Nothing here writes.
import { execFile, spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import type { WorkflowSourceView } from '../../shared/workflow/types'
import type { FetchStatus } from './fetch'

/** Runs git in `cwd` with `args` and answers its stdout; rejects when git fails. */
export type RefGitRunner = (cwd: string, args: string[]) => Promise<string>

const MAX_OUTPUT = 256 * 1024 * 1024
const TIMEOUT_MS = 60_000

/** The default git runner: no prompt, no optional locks, and no variable that points git at another repository. */
export const runGit: RefGitRunner = (cwd, args) =>
  new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS, env: gitEnv(process.env) }, (error, stdout) =>
      error ? reject(error) : resolvePromise(stdout),
    )
  })

/** Variables that would make git read another repository than the one in `cwd`. */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']

/**
 * `env` without the variables that point git elsewhere, with no password prompt and no optional lock. Every git worfy
 * runs for the workflow and its releases (release.ts) gets it.
 */
export function gitEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const clean = Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_LOCATION_VARS.includes(name.toUpperCase())))
  return { ...clean, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
}

/** The main branch of the Project, read from git objects. */
export interface MainRef {
  kind: 'ref'
  /** The full name of the ref read: `refs/remotes/origin/main`, `refs/heads/main`. */
  ref: string
  /** The commit it pointed at when the read began; every file of the read comes from it. */
  sha: string
  /** When that commit was made, in ms. */
  committedAt: number
  /** The top level of the repository as git printed it. */
  top: string
  /** The Tickets root inside the repository, `/` between the parts. */
  ticketsRel: string
  /** The Project root inside the repository, `/` between the parts; '' at the top level. */
  rootRel: string
  /** The branch `git fetch origin` brings up to date; null for a local branch, which nothing fetches. */
  fetchBranch: string | null
}

/** The working tree of the Project folder. */
export interface WorkingTree {
  kind: 'tree'
  /**
   * Why the working tree is read though the Tickets are in git (the main branch did not resolve): the window shows it
   * with the "As of" line. Null where the working tree is the truth: Silent mode, a Tickets root outside git.
   */
  reason: string | null
  /** HEAD of the folder when `reason` is set and HEAD resolves; else null. */
  sha: string | null
  /** The branch fetch is to bring as `origin/<branch>` when the Project ends Tickets with a PR; null otherwise. */
  fetchBranch: string | null
}

export type WorkflowSource = MainRef | WorkingTree

/** What of a Project's layout says where its workflow is read from. */
export interface SourceLayout {
  mode: 'full' | 'silent'
  ticketsRoot: string
  /** `workflow.finish` of the Profile; null or absent when it names none. */
  finish?: 'pr-green-ci' | 'local-green' | null
  /** `worktree.base` of the Profile (`origin/main`, `main`); null or absent when it names none. */
  mainBranch?: string | null
}

const TREE: WorkingTree = Object.freeze({ kind: 'tree', reason: null, sha: null, fetchBranch: null })

/** The name of the main branch: `worktree.base` without `origin/` or `refs/heads/`, else `main`. */
export function mainBranchName(base: string | null | undefined): string {
  const name = (base ?? '').trim().replace(/^refs\/(?:heads|remotes\/origin)\//u, '').replace(/^origin\//u, '')
  return name === '' ? 'main' : name
}

/** `path` relative to `from` with `/` between the parts, or null when it is outside `from`. */
function inside(from: string, path: string, paths: typeof nativePath): string | null {
  const rel = paths.relative(from, path)
  if (rel === '..' || rel.startsWith(`..${paths.sep}`) || paths.isAbsolute(rel)) return null
  return rel.split(paths.sep).join('/')
}

/** The real path of `path`, or of its nearest folder that exists with the rest added: the Tickets root may be in the branch only. */
async function realOrNearest(path: string, paths: typeof nativePath): Promise<string> {
  let existing = path
  while (!(await stat(existing).then(() => true, () => false)) && paths.dirname(existing) !== existing) existing = paths.dirname(existing)
  const real = await realpath(existing).catch(() => existing)
  return existing === path ? real : paths.join(real, paths.relative(existing, path))
}

/** Where the Tickets root and the Project root lie in their repository. */
interface Place {
  top: string
  ticketsRel: string
  rootRel: string
}

/** How long the place of a Project in its repository is kept: it changes only when the repository itself does. */
export const PLACE_TTL_MS = 60_000
const places = new Map<string, { at: number; place: Promise<Place | null> }>()

/** The place of the Tickets root in its repository, or null where the working tree is read (see resolveSource). */
async function placeOf(root: string, ticketsRoot: string, git: RefGitRunner, paths: typeof nativePath): Promise<Place | null> {
  let top: string
  try {
    top = (await git(root, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return null
  }
  if (top === '') return null
  // git prints the real path (C:/… on Windows); both sides are compared as real paths, as epic-status does.
  const topReal = await realpath(top).catch(() => top)
  const ticketsRel = inside(topReal, await realOrNearest(paths.resolve(ticketsRoot), paths), paths)
  const rootRel = inside(topReal, await realOrNearest(paths.resolve(root), paths), paths)
  // A Tickets root in another repository, or the top level itself (epic-status refuses --ref there): the working tree.
  if (ticketsRel === null || ticketsRel === '' || rootRel === null) return null
  return { top, ticketsRel, rootRel }
}

export interface ResolveOptions {
  /** The git runner; runGit by default. A runner given here also skips the cache of the place (tests). */
  git?: RefGitRunner
  paths?: typeof nativePath
  /**
   * Whether a working tree read in place of the main branch asks for its HEAD and its `origin` too (the "As of" line
   * and the fetch need them; a read of one document does not). True by default.
   */
  details?: boolean
  now?: number
}

/**
 * Where the workflow of the Project at `root` is read from now (see the top of the file). Never throws: a git that
 * fails is a Tickets root outside git, read from the working tree; a main branch that does not resolve is the
 * working tree with the reason. The place of the Project in its repository is kept for PLACE_TTL_MS, so a read asks
 * git one question more than before (`for-each-ref`) once that place is known.
 */
export async function resolveSource(root: string, layout: SourceLayout, options: ResolveOptions | RefGitRunner = {}): Promise<WorkflowSource> {
  const { git = runGit, paths = nativePath, details = true, now = Date.now() } = typeof options === 'function' ? { git: options } : options
  if (layout.mode === 'silent') return TREE
  const key = `${paths.resolve(root)}\0${paths.resolve(layout.ticketsRoot)}`
  const cached = git === runGit ? places.get(key) : undefined
  let place: Promise<Place | null>
  if (cached !== undefined && now - cached.at < PLACE_TTL_MS) place = cached.place
  else {
    place = placeOf(root, layout.ticketsRoot, git, paths)
    if (git === runGit) places.set(key, { at: now, place })
  }
  const found = await place
  if (found === null) return TREE
  const { top, ticketsRel, rootRel } = found

  const name = mainBranchName(layout.mainBranch)
  const local = layout.finish === 'local-green'
  if (local) {
    // In local-green the folder is where the Harness writes the status: `ticket claim` changes the Ticket file there,
    // on main or on the Ticket's branch, and that edit is not committed yet. A folder that stands on main or on a
    // Ticket's branch is that place and is read as it is; one that is detached or on any other branch is not, and
    // the local main is read instead.
    const head = await git(root, ['symbolic-ref', '-q', 'HEAD']).then((out) => out.trim(), () => '')
    const branch = head.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : null
    if (branch !== null && (branch === name || parseTicketBranch(branch) !== null)) return TREE
  }
  const wanted = local ? [`refs/heads/${name}`] : ['refs/remotes/origin/HEAD', `refs/remotes/origin/${name}`]
  const rows = new Map<string, { sha: string; symref: string; at: number }>()
  try {
    const listed = await git(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)%00%(committerdate:unix)', ...wanted])
    for (const line of listed.split('\n')) {
      const [ref, sha, symref, at] = line.replace(/\r$/u, '').split('\0')
      if (ref && sha && /^[0-9a-f]{40,64}$/u.test(sha)) rows.set(ref, { sha, symref: symref ?? '', at: Number(at) * 1000 })
    }
  } catch {
    // Read as a ref that does not resolve.
  }
  const head = rows.get('refs/remotes/origin/HEAD')
  const named = rows.get(wanted.at(-1)!)
  const hit = local ? named : head ?? named
  if (hit === undefined) {
    const reason = local
      ? `the main branch ${name} does not resolve in ${top}: the Project folder is read`
      : `neither origin/HEAD nor origin/${name} resolves in ${top}: the Project folder is read`
    if (!details) return { kind: 'tree', reason, sha: null, fetchBranch: null }
    const sha = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).then((out) => out.trim() || null, () => null)
    // A fetch may bring origin/<main> to a repository that has an origin; one with none has nothing to fetch.
    const origin = local ? false : await git(root, ['remote', 'get-url', 'origin']).then((out) => out.trim() !== '', () => false)
    return { kind: 'tree', reason, sha, fetchBranch: origin ? name : null }
  }
  const ref = hit === head && head.symref !== '' ? head.symref : hit === head ? 'refs/remotes/origin/HEAD' : wanted.at(-1)!
  const fetchBranch = local ? null : ref.startsWith('refs/remotes/origin/') && ref !== 'refs/remotes/origin/HEAD' ? ref.slice('refs/remotes/origin/'.length) : name
  return { kind: 'ref', ref, sha: hit.sha, committedAt: Number.isFinite(hit.at) ? hit.at : 0, top, ticketsRel, rootRel, fetchBranch }
}

/** A key that changes when a read would give something else: another ref or commit, or the working tree. */
export function sourceKey(source: WorkflowSource | null): string {
  if (source === null) return ''
  return source.kind === 'ref' ? `ref\n${source.ref}\n${source.sha}\n${source.ticketsRel}` : `tree\n${source.reason ?? ''}\n${source.sha ?? ''}`
}

/** How long fetch may keep failing before the window says the list may be old. */
export const FETCH_STALE_AFTER_MS = 10 * 60_000

/**
 * What the window is told about the source of the list (WorkflowModel.source): null where the working tree is the
 * truth. A notice — the "As of" line — when the main branch did not resolve, or when fetch has failed for longer
 * than `staleAfterMs`.
 */
export function sourceView(source: WorkflowSource, fetch: FetchStatus | null = null, now: number = Date.now(), staleAfterMs: number = FETCH_STALE_AFTER_MS): WorkflowSourceView | null {
  if (source.kind === 'tree') return source.reason === null ? null : { ref: null, sha: source.sha, updatedAt: null, notice: source.reason }
  const stale = fetch !== null && fetch.failingSince !== null && now - fetch.failingSince >= staleAfterMs
  if (!stale) return { ref: source.ref, sha: source.sha, updatedAt: null, notice: null }
  // The time of the last fetch that worked is in the model only beside the notice that shows it: while fetches work,
  // each would change the model and send every subscriber a change in which main did not move.
  const minutes = Math.floor((now - fetch.failingSince!) / 60_000)
  const updatedAt = fetch.lastOk === null ? null : new Date(fetch.lastOk).toISOString()
  return { ref: source.ref, sha: source.sha, updatedAt, notice: `git fetch origin has failed for ${minutes} min: ${fetch.error ?? 'no reason given'}` }
}

// ── the files of a commit ────────────────────────────────────────────────────

/** The files of one commit under a few folders, read from git objects. Paths are relative to `base`, with `/`. */
export interface RepoTree {
  /** The commit. */
  readonly sha: string
  /** When it was made, in ms. */
  readonly committedAt: number
  /** The names directly in folder `dir`; [] when it is no folder of the commit or lies outside what was listed. */
  names(dir: string): Promise<string[]>
  /**
   * The texts of the files, by path, from one `git cat-file --batch`. A path that is no file of the commit (a folder,
   * a link, a submodule), or larger than `maxBytes`, is not in the answer.
   */
  texts(files: readonly string[], maxBytes?: number): Promise<Map<string, string>>
  /**
   * When each file matching `pattern` (a glob under `base`; `*` stops at `/`) was added, in ms, by path, from one
   * `git log` of the commit's history; a file whose addition git cannot tell is not in the answer. Empty when git fails.
   */
  addedAt(pattern: string): Promise<Map<string, number>>
}

/** Runs `git cat-file --batch` in `cwd` with `input` on stdin; answers its stdout. Tests replace it. */
export type CatFileRunner = (cwd: string, input: string) => Promise<Buffer>

const catFile: CatFileRunner = (cwd, input) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd, env: gitEnv(process.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const chunks: Buffer[] = []
    let size = 0
    let stderr = ''
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT) child.kill()
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise(Buffer.concat(chunks))
      else reject(new Error(`git cat-file --batch ended with ${code === null ? `the signal ${signal}` : `exit code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })

/** Splits the answer of `git cat-file --batch` into the contents of the objects asked, in order; null for a missing one. */
export function parseCatFile(out: Buffer, count: number): (Buffer | null)[] {
  const result: (Buffer | null)[] = []
  let at = 0
  for (let index = 0; index < count && at < out.length; index += 1) {
    const end = out.indexOf(0x0a, at)
    if (end === -1) break
    const header = out.subarray(at, end).toString('utf8').split(' ')
    at = end + 1
    if (header.length !== 3 || header[1] === 'missing') {
      result.push(null)
      continue
    }
    const size = Number(header[2])
    result.push(header[1] === 'blob' ? out.subarray(at, at + size) : null)
    // The content is followed by a newline.
    at += size + 1
  }
  while (result.length < count) result.push(null)
  return result
}

/** One entry of `git ls-tree -r`. */
interface TreeEntry {
  mode: string
  type: string
  oid: string
}

/**
 * The files of commit `source.sha` under `base` (a folder of the repository, `/` between the parts; '' for the top
 * level), limited to the folders and files of `scope` (relative to `base`; '' for all of it). The listing is one
 * `git ls-tree -r -z`, taken at the first ask; each `texts` is one `git cat-file --batch`.
 */
export function refTree(source: Pick<MainRef, 'top' | 'sha' | 'committedAt'>, base: string, scope: readonly string[] = [''], git: RefGitRunner = runGit, cat: CatFileRunner = catFile): RepoTree {
  const prefix = base === '' ? '' : `${base}/`
  let listing: Promise<Map<string, TreeEntry>> | null = null
  const list = (): Promise<Map<string, TreeEntry>> => {
    listing ??= (async () => {
      const specs = scope.map((part) => (part === '' ? (base === '' ? '.' : base) : `${prefix}${part}`))
      // Literal pathspecs: an Epic named with `*` or `?` is a name, not a pattern.
      const out = await git(source.top, ['--literal-pathspecs', 'ls-tree', '-r', '-z', '--full-tree', source.sha, '--', ...specs])
      const entries = new Map<string, TreeEntry>()
      for (const record of out.split('\0')) {
        const tab = record.indexOf('\t')
        if (tab === -1) continue
        const [mode, type, oid] = record.slice(0, tab).split(' ')
        const path = record.slice(tab + 1)
        if (!mode || !type || !oid || !path.startsWith(prefix)) continue
        entries.set(path.slice(prefix.length), { mode, type, oid })
      }
      return entries
    })()
    return listing
  }
  return {
    sha: source.sha,
    committedAt: source.committedAt,
    async names(dir) {
      const entries = await list()
      const from = dir === '' ? '' : `${dir.replace(/\/+$/u, '')}/`
      const names = new Set<string>()
      for (const path of entries.keys()) {
        if (!path.startsWith(from)) continue
        const name = path.slice(from.length).split('/')[0]
        if (name) names.add(name)
      }
      return [...names].sort()
    },
    async texts(files, maxBytes = Infinity) {
      const entries = await list()
      // Symlinks (120000) and submodules are not files a reader follows.
      const wanted = files.filter((file) => {
        const entry = entries.get(file)
        return entry !== undefined && entry.type === 'blob' && entry.mode !== '120000'
      })
      const result = new Map<string, string>()
      if (wanted.length === 0) return result
      const contents = parseCatFile(await cat(source.top, wanted.map((file) => `${entries.get(file)!.oid}\n`).join('')), wanted.length)
      wanted.forEach((file, index) => {
        const content = contents[index]
        if (content != null && content.length <= maxBytes) result.set(file, content.toString('utf8'))
      })
      return result
    },
    async addedAt(pattern) {
      // A glob pathspec: the base itself is a name, so its glob characters are escaped.
      const glob = `:(glob)${prefix.replace(/[*?[\]\\]/gu, '\\$&')}${pattern}`
      const out = await git(source.top, ['-c', 'core.quotePath=false', 'log', '--diff-filter=A', '--no-renames', '--format=@%ct', '--name-only', source.sha, '--', glob]).catch(() => '')
      const result = new Map<string, number>()
      let at: number | null = null
      for (const line of out.split(/\r?\n/u)) {
        if (line.startsWith('@')) at = Number(line.slice(1)) * 1000
        // The newest addition comes first: a file added, removed and added again keeps the last time.
        else if (line !== '' && line.startsWith(prefix) && at !== null && Number.isFinite(at) && !result.has(line.slice(prefix.length))) result.set(line.slice(prefix.length), at)
      }
      return result
    },
  }
}

// ── the moves of the main branch ─────────────────────────────────────────────

const moveListeners = new Set<(root: string) => void>()

/**
 * Says that the main branch of the Project at `root` moved: the workflow watcher calls it when a read finds another
 * commit than the one before (a fetch, a merge), and the documents' watcher reads the state file and the ADRs again.
 */
export function mainRefMoved(root: string): void {
  for (const listener of [...moveListeners]) {
    try {
      listener(root)
    } catch (error) {
      console.error('[workflow] a listener of the main branch failed', error)
    }
  }
}

/** Calls `listener` with the root of each Project whose main branch moved; the answer stops it. */
export function onMainRefMoved(listener: (root: string) => void): () => void {
  moveListeners.add(listener)
  return () => moveListeners.delete(listener)
}
