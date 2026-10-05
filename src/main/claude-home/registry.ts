// Sessions of a Project as Claude Code records them under its home directory (~/.claude, or
// WORFY_CLAUDE_HOME in tests). Formats and rules come from ticket 09 ("Итог"):
//
// - live Sessions: sessions/<pid>.json. A file alone does not prove the Session runs, so it is
//   live only when the process `pid` exists and was started at `procStart` (`ps -o lstart=` in
//   UTC); this guards against a reused pid.
// - history: projects/<dir>/<sessionId>.jsonl, where <dir> is the cwd the Session was started in,
//   NFC-normalised, every character outside [A-Za-z0-9] replaced by `-` (long names shortened
//   the way Claude Code does). A list reads only the head and the tail of each file.
// - one rule for both: a Session belongs to the Project when its cwd is the root, a worktree, or
//   a folder inside either. Folder names lose the difference between `/` and `-`, so a transcript
//   in a folder that only starts like a subfolder of the Project is kept only when the cwd its
//   first records name lies inside the Project.
//
// Nothing here writes: no cache, no marker files, no lock under the Claude home. The watcher only
// reads directory listings.
import { execFile } from 'node:child_process'
import { open, readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { watch, type FSWatcher } from 'chokidar'
import { z } from 'zod'
import type { HistorySession, LiveSession } from '../../shared/ipc/claude-home'
import { parseTranscriptRecord } from '../../shared/transcript/parse'
import { splitLines } from './tail'

const run = promisify(execFile)

// ---------------------------------------------------------------------------------------------
// Folder names

const MAX_DIR_NAME = 200

/** Claude Code's 32-bit string hash (`h = h * 31 + charCode`), as in the Agent SDK. */
function hash32(text: string): number {
  let h = 0
  for (let index = 0; index < text.length; index += 1) h = ((h << 5) - h + text.charCodeAt(index)) | 0
  return h
}

/** The folder under projects/ where Claude Code keeps the transcripts of Sessions started in `cwd`. */
export function projectDirName(cwd: string): string {
  const path = cwd.normalize('NFC')
  const name = path.replace(/[^a-zA-Z0-9]/g, '-')
  if (name.length <= MAX_DIR_NAME) return name
  return `${name.slice(0, MAX_DIR_NAME)}-${Math.abs(hash32(path)).toString(36)}`
}

/** Prefix of the folders of worktrees under <root>/.claude/worktrees/, including removed ones. */
const worktreeDirPrefix = (root: string): string => `${projectDirName(root)}--claude-worktrees-`

/**
 * How a folder under projects/ relates to the Project with these roots: `project` — the folder
 * of the root, of a worktree, or of a (possibly removed) worktree under <root>/.claude/worktrees/;
 * `subfolder` — named like a folder inside a root or worktree, which another Project's folder can
 * be too (`/proj/a` and `/proj-a` share one name), so each transcript's cwd decides; `none`.
 */
type DirMatch = 'project' | 'subfolder' | 'none'

function dirMatch(dirName: string, roots: readonly string[]): DirMatch {
  const [root] = roots
  if (root !== undefined && dirName.startsWith(worktreeDirPrefix(root))) return 'project'
  if (roots.some((path) => projectDirName(path) === dirName)) return 'project'
  if (roots.some((path) => dirName.startsWith(`${projectDirName(path)}-`))) return 'subfolder'
  return 'none'
}

const isInside = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)

/** Is `cwd` the root, a worktree or a folder inside one of them? */
const inProject = (cwd: string, roots: readonly string[]): boolean => {
  const path = resolve(cwd)
  return roots.some((root) => isInside(path, root))
}

// ---------------------------------------------------------------------------------------------
// Dependencies that touch the system, replaceable in tests

/** Variables that would point git at another repository than the one `-C` names. */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']

/** Paths of the Project's git worktrees other than the root itself; empty when git fails. */
export async function gitWorktrees(root: string): Promise<string[]> {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION_VARS.includes(name)))
    // `worktree list` only reads the repository; it prunes nothing.
    const { stdout } = await run('git', ['-C', root, 'worktree', 'list', '--porcelain'], { env, timeout: 5000 })
    return stdout
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice('worktree '.length)))
      .filter((path) => path !== resolve(root))
  } catch {
    return []
  }
}

const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ')

/**
 * True when process `pid` exists and, if `procStart` is given, was started at that time.
 * `procStart` is `ps -o lstart=` in UTC with the C locale (ticket 09); EPERM still means alive.
 */
export async function processAlive(pid: number, procStart: string | undefined): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM')) return false
  }
  if (procStart === undefined) return true
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, timeout: 5000 })
    return collapse(stdout) === collapse(procStart)
  } catch {
    return false
  }
}

export interface RegistryOptions {
  /** The Claude home directory (src/main/storage/paths.ts, claudeHome()). */
  home: string
  /** Lists the Project's worktrees; defaults to `git worktree list`. */
  listWorktrees?: (root: string) => Promise<string[]>
  /** Decides whether a registry entry's process runs; defaults to processAlive(). */
  isAlive?: (pid: number, procStart: string | undefined) => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------
// Live Sessions

const registryEntrySchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  procStart: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  entrypoint: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  kind: z.string().optional().catch(undefined),
  version: z.string().optional().catch(undefined),
  startedAt: z.number().optional().catch(undefined),
  updatedAt: z.number().optional().catch(undefined),
})

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

async function listDir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }))
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

async function liveSessions(home: string, roots: readonly string[], isAlive: NonNullable<RegistryOptions['isAlive']>): Promise<LiveSession[]> {
  const dir = join(home, 'sessions')
  // Only <pid>.json: the <pid>.<sha256>.key files next to them are never opened.
  const files = (await listDir(dir)).filter((entry) => entry.isFile && /^\d+\.json$/.test(entry.name))
  const found = await Promise.all(
    files.map(async ({ name }): Promise<LiveSession | undefined> => {
      let raw: unknown
      try {
        raw = JSON.parse(await readFile(join(dir, name), 'utf8'))
      } catch {
        return undefined // removed between the listing and the read, or half written
      }
      const parsed = registryEntrySchema.safeParse(raw)
      if (!parsed.success) return undefined
      const entry = parsed.data
      if (!inProject(entry.cwd, roots)) return undefined
      if (!(await isAlive(entry.pid, entry.procStart))) return undefined
      return dropUndefined<LiveSession>({
        pid: entry.pid,
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        status: entry.status === 'idle' || entry.status === 'busy' ? entry.status : 'unknown',
        entrypoint: entry.entrypoint,
        name: entry.name,
        kind: entry.kind,
        version: entry.version,
        startedAt: entry.startedAt,
        updatedAt: entry.updatedAt,
      })
    }),
  )
  return found.filter((session): session is LiveSession => session !== undefined).sort((a, b) => a.pid - b.pid)
}

// ---------------------------------------------------------------------------------------------
// History: head and tail of each transcript

const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 64 * 1024
const MAX_HEAD_BYTES = 1024 * 1024
const MAX_TITLE = 200

async function readRange(file: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await file.read(buffer, filled, length - filled, position + filled)
    if (bytesRead === 0) break
    filled += bytesRead
  }
  return buffer.subarray(0, filled)
}

function records(lines: readonly string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) out.push(value as Record<string, unknown>)
    } catch {
      // A broken line does not stop the list.
    }
  }
  return out
}

/** The complete lines at the start and at the end of a transcript, without reading the middle. */
async function headAndTail(path: string): Promise<{ head: Record<string, unknown>[]; tail: Record<string, unknown>[]; size: number; modifiedAt: number }> {
  const file = await open(path, 'r')
  try {
    const stats = await file.stat()
    const size = stats.size
    // Head: grow the window while it holds no complete line (a very long first prompt).
    let headLength = Math.min(size, HEAD_BYTES)
    let head = await readRange(file, 0, headLength)
    while (head.lastIndexOf(0x0a) === -1 && headLength < Math.min(size, MAX_HEAD_BYTES)) {
      headLength = Math.min(size, MAX_HEAD_BYTES, headLength * 4)
      head = await readRange(file, 0, headLength)
    }
    const headLines = splitLines(head.subarray(0, head.lastIndexOf(0x0a) + 1))
    if (size <= headLength) {
      const all = records(headLines)
      return { head: all, tail: all, size, modifiedAt: Math.trunc(stats.mtimeMs) }
    }
    // Tail: one byte before the window tells whether it starts on a line; a partial first line is
    // dropped, and so is a last line still being written (splitLines keeps complete lines only).
    const tailStart = Math.max(headLength, size - TAIL_BYTES)
    const tail = await readRange(file, tailStart - 1, size - tailStart + 1)
    const firstBreak = tail.indexOf(0x0a)
    const tailLines = firstBreak === -1 ? [] : splitLines(tail.subarray(firstBreak + 1))
    return { head: records(headLines), tail: records(tailLines), size, modifiedAt: Math.trunc(stats.mtimeMs) }
  } finally {
    await file.close()
  }
}

const oneLine = (text: string): string => {
  const line = collapse(text)
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line
}

function lastString(list: readonly Record<string, unknown>[], type: string | undefined, field: string): string | undefined {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const record = list[index]
    if (record === undefined || (type !== undefined && record.type !== type)) continue
    const value = record[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

const firstString = (list: readonly Record<string, unknown>[], field: string): string | undefined =>
  lastString([...list].reverse(), undefined, field)

/** The first prompt the user typed: a slash command gives `/name`, injected (meta) text is skipped. */
function firstPrompt(head: readonly Record<string, unknown>[]): string | undefined {
  for (const record of head) {
    if (record.type !== 'user' || record.isSidechain === true) continue
    for (const { event } of parseTranscriptRecord(record)) {
      if (event.type === 'command') return event.name
      if (event.type === 'notice' && event.kind === 'user' && !event.text.trimStart().startsWith('<')) return event.text
    }
  }
  return undefined
}

async function historyEntry(path: string, sessionId: string, liveIds: ReadonlySet<string>): Promise<HistorySession | undefined> {
  let read: Awaited<ReturnType<typeof headAndTail>>
  try {
    read = await headAndTail(path)
  } catch {
    return undefined // removed between the listing and the read
  }
  const { head, tail, size, modifiedAt } = read
  const both = [...head, ...tail]
  const title =
    lastString(tail, 'custom-title', 'customTitle') ??
    lastString(head, 'custom-title', 'customTitle') ??
    lastString(tail, 'ai-title', 'aiTitle') ??
    lastString(head, 'ai-title', 'aiTitle') ??
    firstPrompt(head)
  return dropUndefined<HistorySession>({
    sessionId,
    title: title === undefined ? undefined : oneLine(title),
    firstAt: firstString(head, 'timestamp'),
    lastAt: lastString(tail, undefined, 'timestamp') ?? lastString(head, undefined, 'timestamp'),
    cwd: firstString(head, 'cwd'),
    gitBranch: lastString(both, undefined, 'gitBranch'),
    entrypoint: firstString(head, 'entrypoint'),
    size,
    modifiedAt,
    live: liveIds.has(sessionId),
  })
}

/** The cwd a transcript was started in (first record that names one), or undefined. */
async function startCwd(path: string): Promise<string | undefined> {
  try {
    return firstString((await headAndTail(path)).head, 'cwd')
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------------------------
// The registry

export interface ProjectSessions {
  live: LiveSession[]
  history: HistorySession[]
}

/** What a watcher reports: the registry changed, and/or these transcripts did. */
export interface ClaudeHomeChange {
  sessions: boolean
  transcripts: string[]
}

export interface WatchOptions {
  /** Quiet time before a batch of file events is reported. */
  debounceMs?: number
  /**
   * Wait after the watcher's initial scan before `ready` resolves. On macOS fs.watch runs on
   * FSEvents, whose stream starts asynchronously: a file written in the first milliseconds after
   * chokidar's 'ready' was missed in 4 of 150 runs, and in none of 150 with a 50 ms wait.
   */
  settleMs?: number
}

export interface ClaudeHomeWatch {
  /** Resolves once the initial scan is done and changes are being reported. */
  ready: Promise<void>
  close(): Promise<void>
}

const TRANSCRIPT = /^([A-Za-z0-9][A-Za-z0-9-]*)\.jsonl$/

export class ClaudeHomeRegistry {
  readonly home: string
  private readonly listWorktrees: NonNullable<RegistryOptions['listWorktrees']>
  private readonly isAlive: NonNullable<RegistryOptions['isAlive']>

  constructor(options: RegistryOptions) {
    this.home = resolve(options.home)
    this.listWorktrees = options.listWorktrees ?? gitWorktrees
    this.isAlive = options.isAlive ?? processAlive
  }

  private get projectsDir(): string {
    return join(this.home, 'projects')
  }

  private get sessionsDir(): string {
    return join(this.home, 'sessions')
  }

  /** The Project root and its worktrees, absolute and normalised. */
  async roots(projectRoot: string): Promise<string[]> {
    const root = resolve(projectRoot)
    const worktrees = await this.listWorktrees(root)
    return [root, ...worktrees.map((path) => resolve(path)).filter((path) => path !== root)]
  }

  /**
   * Transcript folders of the Project: its root, its worktrees, removed worktrees of the root and
   * folders inside any of them. `checkCwd` marks folders whose transcripts may belong to another
   * Project; their transcripts are kept only when their cwd lies inside the Project.
   */
  async transcriptDirs(roots: readonly string[]): Promise<{ path: string; checkCwd: boolean }[]> {
    const entries = await listDir(this.projectsDir)
    return entries
      .flatMap((entry) => {
        const match = entry.isDirectory ? dirMatch(entry.name, roots) : 'none'
        return match === 'none' ? [] : [{ path: join(this.projectsDir, entry.name), checkCwd: match === 'subfolder' }]
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** Live Sessions and the history of the Project at `projectRoot`. */
  async sessions(projectRoot: string): Promise<ProjectSessions> {
    const roots = await this.roots(projectRoot)
    const [live, dirs] = await Promise.all([liveSessions(this.home, roots, this.isAlive), this.transcriptDirs(roots)])
    const liveIds = new Set(live.map((session) => session.sessionId))
    const files = (
      await Promise.all(
        dirs.map(async ({ path: dir, checkCwd }) =>
          (await listDir(dir)).flatMap((entry) => {
            const match = entry.isFile ? TRANSCRIPT.exec(entry.name) : null
            return match?.[1] ? [{ path: join(dir, entry.name), sessionId: match[1], checkCwd }] : []
          }),
        ),
      )
    ).flat()
    const history = (
      await Promise.all(
        files.map(async ({ path, sessionId, checkCwd }) => {
          const entry = await historyEntry(path, sessionId, liveIds)
          if (entry === undefined || !checkCwd) return entry
          return entry.cwd !== undefined && inProject(entry.cwd, roots) ? entry : undefined
        }),
      )
    )
      .filter((entry): entry is HistorySession => entry !== undefined)
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.sessionId.localeCompare(b.sessionId))
    return { live, history }
  }

  /** Only the live Sessions of the Project at `projectRoot`; the history is not read. */
  async live(projectRoot: string): Promise<LiveSession[]> {
    return liveSessions(this.home, await this.roots(projectRoot), this.isAlive)
  }

  /** Path of a Session's transcript among the Project's folders, or null. */
  async transcriptPath(projectRoot: string, sessionId: string): Promise<string | null> {
    if (!TRANSCRIPT.test(`${sessionId}.jsonl`)) return null
    const roots = await this.roots(projectRoot)
    for (const { path: dir, checkCwd } of await this.transcriptDirs(roots)) {
      const entries = await listDir(dir)
      if (!entries.some((entry) => entry.isFile && entry.name === `${sessionId}.jsonl`)) continue
      const path = join(dir, `${sessionId}.jsonl`)
      if (!checkCwd) return path
      const cwd = await startCwd(path)
      if (cwd !== undefined && inProject(cwd, roots)) return path
    }
    return null
  }

  /**
   * Watches the registry and the Project's transcript folders and reports changes, debounced.
   * New worktree folders of the root are picked up as they appear.
   */
  async watch(projectRoot: string, onChange: (change: ClaudeHomeChange) => void, options: WatchOptions = {}): Promise<ClaudeHomeWatch> {
    const roots = await this.roots(projectRoot)
    const debounceMs = options.debounceMs ?? 150
    const settleMs = options.settleMs ?? 100
    const projectsDir = this.projectsDir
    const sessionsDir = this.sessionsDir

    // Decides from the path alone, so whole unrelated subtrees of the Claude home are skipped.
    const ignored = (path: string): boolean => {
      if (path === this.home) return false
      const inSessions = relative(sessionsDir, path)
      if (inSessions === '') return false
      if (!inSessions.startsWith('..') && !inSessions.includes(sep)) return !/^\d+\.json$/.test(inSessions)
      const inProjects = relative(projectsDir, path)
      if (inProjects === '') return false
      if (inProjects.startsWith('..')) return true
      const parts = inProjects.split(sep)
      if (parts.length > 2 || dirMatch(parts[0] ?? '', roots) === 'none') return true
      return parts.length === 2 && !TRANSCRIPT.test(parts[1] ?? '')
    }

    let sessions = false
    const transcripts = new Set<string>()
    let timer: NodeJS.Timeout | undefined
    let closed = false
    const flush = () => {
      timer = undefined
      const change = { sessions, transcripts: [...transcripts].sort() }
      sessions = false
      transcripts.clear()
      onChange(change)
    }
    const schedule = () => {
      if (closed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, debounceMs)
    }
    // Verdicts for transcripts in `subfolder` folders: does the cwd they start in lie inside the
    // Project? Kept once known, so a removed file is still reported. Filled for the files that exist
    // when watching starts (`prefilled`), because the watcher skips them until they change.
    const verdicts = new Map<string, boolean>()
    const startsInProject = async (path: string): Promise<boolean> => {
      const known = verdicts.get(path)
      if (known !== undefined) return known
      const cwd = await startCwd(path)
      if (cwd === undefined) return false
      const verdict = inProject(cwd, roots)
      verdicts.set(path, verdict)
      return verdict
    }
    const note = (path: string, removed = false) => {
      if (/^\d+\.json$/.test(relative(sessionsDir, path))) {
        sessions = true
        schedule()
        return
      }
      const [dirName = '', fileName = ''] = relative(projectsDir, path).split(sep)
      const sessionId = TRANSCRIPT.exec(fileName)?.[1]
      if (!sessionId) return
      if (dirMatch(dirName, roots) === 'project') {
        transcripts.add(sessionId)
        schedule()
        return
      }
      const report = (inside: boolean) => {
        if (!inside) return
        transcripts.add(sessionId)
        schedule()
      }
      // A removed file can no longer be read: its verdict comes from the cache, and a file whose cwd
      // was never known is reported, since an extra reread is cheaper than a stale history.
      if (removed) void prefilled.then(() => report(verdicts.get(path) ?? true))
      else void startsInProject(path).then(report)
    }

    const watcher: FSWatcher = watch(this.home, { ignoreInitial: true, depth: 2, ignored, persistent: true })
    watcher
      .on('add', (path) => note(path))
      .on('change', (path) => note(path))
      .on('unlink', (path) => note(path, true))
    watcher.on('error', (error) => console.error('[claude-home] watch error', error))
    // Started after the watcher, so a file is either seen here or reported by the watcher.
    const prefilled: Promise<void> = this.transcriptDirs(roots)
      .then(async (dirs) => {
        const checked = dirs.filter((dir) => dir.checkCwd)
        const files = await Promise.all(
          checked.map(async ({ path: dir }) => (await listDir(dir)).filter((entry) => entry.isFile && TRANSCRIPT.test(entry.name)).map((entry) => join(dir, entry.name))),
        )
        await Promise.all(files.flat().map((path) => startsInProject(path)))
      })
      .catch((error: unknown) => console.error('[claude-home] reading transcript folders failed', error))
    const ready = Promise.all([new Promise<void>((done) => watcher.once('ready', () => setTimeout(done, settleMs))), prefilled]).then(() => undefined)
    return {
      ready,
      close: async () => {
        closed = true
        if (timer) clearTimeout(timer)
        timer = undefined
        await watcher.close()
      },
    }
  }
}
