// Sessions of a Project as Claude Code records them under its home directory (~/.claude, or
// WORFY_CLAUDE_HOME in tests). Formats and rules come from ticket 09 (its result section):
//
// - live Sessions: sessions/<pid>.json. A file alone does not prove the Session runs, so it is
//   live only when the process `pid` exists and was started at `procStart` (`ps -o lstart=` in
//   UTC; on Windows the FILETIME of the start, read with PowerShell — worfy-windows ticket 08);
//   this guards against a reused pid.
// - history: projects/<dir>/<sessionId>.jsonl, where <dir> is the cwd the Session was started in,
//   NFC-normalised, every character outside [A-Za-z0-9] replaced by `-` (long names shortened
//   the way Claude Code does; on Windows the same rule: `C:\a\b` → `C--a-b`, evidence of
//   worfy-windows ticket 01, section 12). A list reads only the head and the tail of each file.
// - one rule for both: a Session belongs to the Project when its cwd is the root, a worktree, or
//   a folder inside either. Folder names lose the difference between `/`, `-` and any character
//   outside [A-Za-z0-9], so no folder is the Project's by its name alone: a transcript in a folder
//   named like the root, a worktree or a folder inside them is kept by the cwd its first record
//   that names one gives (the worktree `/p/A/evil` shares its folder with `/p/A-evil`, worfy-link
//   ticket 32). A transcript whose cwd is unknown is shown only to this Machine's own callers (a
//   `local` RegistryRoot) and only in a folder named exactly like a root or worktree; any other
//   root, a Linked machine's among them, is judged strictly.
//
// Nothing here writes: no cache file, no marker files, no lock under the Claude home. The history
// entries read from transcripts are kept in memory (HistoryCache). The watcher only reads directory
// listings.
import { execFile } from 'node:child_process'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join, posix, relative, resolve, sep, win32 } from 'node:path'
import { promisify } from 'node:util'
import { watch, type FSWatcher } from 'chokidar'
import { z } from 'zod'
import type { HistorySession, LiveSession } from '../../shared/ipc/claude-home'
import { parseTranscriptRecord } from '../../shared/transcript/parse'
import { powershellScriptCommand, runFile, type RunFile } from '../agent/env'
import { closeForGood } from '../chokidar-close'
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

/**
 * How a folder under projects/ relates to the Project with these roots: `root` — named exactly
 * like a root or a worktree; `subfolder` — named like a folder inside a root or worktree, a removed
 * worktree under <root>/.claude/worktrees/ among them; `none`.
 *
 * A name stands for several paths: every character outside [A-Za-z0-9] is `-`, so `/proj/a` and
 * `/proj-a`, `/p/A/evil` and `/p/A-evil`, `/p/Ä` and `/p/Ö` share one. No name is proof alone:
 * each transcript's cwd decides (belongs), for both matches (worfy-link ticket 32).
 */
type DirMatch = 'root' | 'subfolder' | 'none'

function dirMatch(dirName: string, roots: readonly string[]): DirMatch {
  if (roots.some((path) => projectDirName(path) === dirName)) return 'root'
  if (roots.some((path) => dirName.startsWith(`${projectDirName(path)}-`))) return 'subfolder'
  return 'none'
}

/**
 * Is `path` the folder `root` or inside it? Both are resolved by the rules of `platform`. On Windows
 * the separator is `\` and the comparison ignores case, as the file system does by default
 * (worfy-windows ticket 08): a Session started in a subfolder of a Project belongs to it.
 */
export function isInsidePath(path: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  const paths = platform === 'win32' ? win32 : posix
  const fold = (text: string): string => (platform === 'win32' ? text.toLowerCase() : text)
  const inner = fold(paths.resolve(path))
  const outer = fold(paths.resolve(root))
  return inner === outer || inner.startsWith(outer.endsWith(paths.sep) ? outer : `${outer}${paths.sep}`)
}

/**
 * Is `cwd` the root, a worktree or a folder inside one of them? Both sides in NFC, as the folder
 * names are: macOS hands out a name in NFD as often as in NFC.
 */
const inProject = (cwd: string, roots: readonly string[]): boolean => roots.some((root) => isInsidePath(cwd.normalize('NFC'), root.normalize('NFC')))

/**
 * Whether a transcript of a folder of the Project (dirMatch) is the Project's, by the cwd it
 * started in. A known cwd decides. An unknown one (no record names it within the reach of
 * scanStartCwd) is no proof the Session is the Project's: the transcript is shown only to this
 * Machine's own callers (not `strict`, RegistryRoot), and only in a folder named exactly like a
 * root or worktree, as before. The Orchestrator resumes such a Session; a `subfolder` folder may
 * be another Project's own (`/p/A-evil` for `/p/A`).
 */
const belongs = (cwd: string | undefined, roots: readonly string[], strict: boolean, match: DirMatch): boolean =>
  cwd === undefined ? !strict && match === 'root' : inProject(cwd, roots)

// ---------------------------------------------------------------------------------------------
// Dependencies that touch the system, replaceable in tests

/** Variables that would point git at another repository than the one `-C` names. */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']

/**
 * Whether a failed `git worktree list` means the Project can have no worktrees: git is not
 * installed (ENOENT), or the folder is not a git repository (exit 128, "not a git repository").
 */
function noWorktreesPossible(error: unknown): boolean {
  const failed = error as { code?: unknown; stderr?: unknown }
  if (failed.code === 'ENOENT') return true
  return failed.code === 128 && typeof failed.stderr === 'string' && failed.stderr.includes('not a git repository')
}

/**
 * Paths of the Project's git worktrees other than the root itself; empty when the folder is not a
 * git repository or git is not installed. Throws when git fails otherwise or does not answer within
 * 5 s: the worktrees could not be read.
 */
export async function listGitWorktrees(root: string): Promise<string[]> {
  // LC_ALL=C: git's messages in English, so a folder outside git is told by its text.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION_VARS.includes(name))), LC_ALL: 'C' }
  let stdout: string
  try {
    // `worktree list` only reads the repository; it prunes nothing.
    ;({ stdout } = await run('git', ['-C', root, 'worktree', 'list', '--porcelain'], { env, timeout: 5000 }))
  } catch (error) {
    if (noWorktreesPossible(error)) return []
    throw error
  }
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length)))
    .filter((path) => path !== resolve(root))
}

/** Paths of the Project's git worktrees other than the root itself; empty when git fails. */
export async function gitWorktrees(root: string): Promise<string[]> {
  try {
    return await listGitWorktrees(root)
  } catch {
    return []
  }
}

const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ')

/** The start of each running process asked for, as a FILETIME in decimal, or `?` when it cannot be read; a pid not in the map runs no more. */
export type WindowsProcessStarts = (pids: readonly number[]) => Promise<Map<number, string>>

/** The variable of the environment PROCESS_STARTS_SCRIPT reads its pids from: decimal numbers with commas between them. */
export const PROCESS_IDS_VAR = 'WORFY_PROCESS_IDS'

/**
 * The script of readWindowsProcessStarts: one line per running process of the pids asked for,
 * `<pid> <start as a FILETIME in decimal>`, or `<pid> ?` when the start cannot be read. The text is
 * constant (worfy-windows ticket 21): the pids come in PROCESS_IDS_VAR, and only what is all
 * digits is taken of it. Before, the pids went into the text, handed over with -EncodedCommand:
 * what cost a second more from Electron was PowerShell decoding a text it had not run before, and
 * every new set of live Sessions was such a text (the numbers are at REGISTRY_SCRIPT of
 * src/main/agent/env.ts).
 *
 * Without PROCESS_IDS_VAR at all it exits with 2 (worfy-windows ticket 29): an environment lost on
 * the way must fail the read, so the Sessions are `unknown`, not `gone` because no pid was found.
 * readWindowsProcessStarts never starts it for an empty list.
 */
export const PROCESS_STARTS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  `if ($null -eq $env:${PROCESS_IDS_VAR}) { exit 2 }`,
  `$ids = @([string]$env:${PROCESS_IDS_VAR} -split ',' | Where-Object { $_ -match '^[0-9]+$' } | ForEach-Object { [int]$_ })`,
  'if ($ids.Count -eq 0) { exit 0 }',
  'foreach ($process in Get-Process -Id $ids) {',
  '  $start = $null',
  '  try { $start = $process.StartTime } catch { }',
  '  if ($null -eq $start) { "$($process.Id) ?" } else { "$($process.Id) $($start.ToFileTimeUtc())" }',
  '}',
  'exit 0',
].join('\n')

/**
 * The start times of processes on Windows, by one Windows PowerShell call: `Get-Process`,
 * `StartTime.ToFileTimeUtc()`. That is exactly the FILETIME Claude Code writes as `procStart` there
 * (evidence of worfy-windows ticket 01, section 23; checked again for ticket 08: `Get-CimInstance
 * Win32_Process` `CreationDate` drops the last digit, the 100 ns). Rejects when PowerShell fails.
 */
export function readWindowsProcessStarts(systemRoot: string | undefined = process.env.SystemRoot, run: RunFile = runFile): WindowsProcessStarts {
  return (pids) =>
    new Promise((done, fail) => {
      // What the script can take: decimal digits (1e21 prints as 1e+21) that fit its [int].
      const ids = pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0 && pid <= 0x7fffffff)
      if (ids.length === 0) {
        done(new Map())
        return
      }
      const { file, args, options } = powershellScriptCommand(systemRoot, PROCESS_STARTS_SCRIPT, { [PROCESS_IDS_VAR]: ids.join(',') })
      run(file, args, options, (error, stdout) => {
        if (error) {
          fail(new Error(`${file} could not read process start times: ${error.killed ? 'timed out' : `exit ${String(error.code)}`}`))
          return
        }
        const starts = new Map<number, string>()
        for (const line of stdout.split(/\r?\n/)) {
          const match = /^(\d+) (\d+|\?)\s*$/.exec(line)
          if (match) starts.set(Number(match[1]), match[2]!)
        }
        done(starts)
      })
    })
}

/** How long the pids asked for are gathered before one PowerShell call reads them all. */
export const PROCESS_START_BATCH_MS = 25
/**
 * How long a start time read for a pid is reused. The live list and the Subagents are asked again
 * every 2 s; the start of a running process never changes, so PowerShell runs at most once in this
 * time per pid. A pid that a new process took within it would still match the old start: that
 * takes a registry file left behind by a dead Session and the pid reused within 30 s.
 */
export const PROCESS_START_CACHE_MS = 30_000

/**
 * `read`, but every pid asked for within PROCESS_START_BATCH_MS goes into one call: the live
 * Sessions of a listing are checked by one PowerShell start, not one per Session. A start time
 * read is reused for PROCESS_START_CACHE_MS; `?`, a pid not found and a failed read are not.
 */
export function batchedProcessStarts(
  read: WindowsProcessStarts,
  delayMs = PROCESS_START_BATCH_MS,
  cacheMs = PROCESS_START_CACHE_MS,
  now: () => number = Date.now,
): (pid: number) => Promise<Map<number, string>> {
  const known = new Map<number, { start: string; at: number }>()
  let batch: { pids: Set<number>; starts: Promise<Map<number, string>> } | null = null
  return (pid) => {
    const cached = known.get(pid)
    if (cached !== undefined && now() - cached.at < cacheMs) return Promise.resolve(new Map([[pid, cached.start]]))
    if (batch === null) {
      const pids = new Set<number>()
      const starts = new Promise<void>((wait) => setTimeout(wait, delayMs)).then(async () => {
        batch = null
        const answer = await read([...pids])
        const at = now()
        for (const [each, start] of answer) if (start !== '?') known.set(each, { start, at })
        return answer
      })
      batch = { pids, starts }
    }
    batch.pids.add(pid)
    return batch.starts
  }
}

let windowsStarts: ((pid: number) => Promise<Map<number, string>>) | null = null

export interface ProcessStateOptions {
  platform?: NodeJS.Platform
  /** On Windows: the start of `pid` among others asked for at the same time; batchedProcessStarts(readWindowsProcessStarts()) by default. */
  windowsStart?: (pid: number) => Promise<Map<number, string>>
}

/**
 * Whether process `pid` runs and, if `procStart` is given, was started at that time:
 * `alive`, `gone` (no such process, or another one started at another time under a reused pid),
 * or `unknown` when the start time could not be read (`ps` or PowerShell not found, timed out,
 * killed, no output). EPERM still means it runs. `procStart` is, on macOS and Linux, `ps -o
 * lstart=` in UTC with the C locale (ticket 09); on Windows the FILETIME of the process start in
 * decimal (worfy-windows ticket 08), read for every pid of a listing by one PowerShell call.
 */
export async function processState(pid: number, procStart: string | undefined, options: ProcessStateOptions = {}): Promise<'alive' | 'gone' | 'unknown'> {
  if (!Number.isInteger(pid) || pid <= 0) return 'gone'
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM')) return 'gone'
  }
  if (procStart === undefined) return 'alive'
  if ((options.platform ?? process.platform) === 'win32') {
    const start = options.windowsStart ?? (windowsStarts ??= batchedProcessStarts(readWindowsProcessStarts()))
    let starts: Map<number, string>
    try {
      starts = await start(pid)
    } catch {
      return 'unknown'
    }
    const found = starts.get(pid)
    if (found === undefined) return 'gone'
    if (found === '?') return 'unknown'
    return found === procStart.trim() ? 'alive' : 'gone'
  }
  let stdout: string
  try {
    stdout = (await run('ps', ['-p', String(pid), '-o', 'lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, timeout: 5000 })).stdout
  } catch (error) {
    // `ps -p` exits with 1 and prints nothing when the process ended after kill(0) found it; any
    // other failure (spawn error, timeout, a signal) says nothing about the process.
    const failure = error as { code?: unknown; killed?: unknown; signal?: unknown; stdout?: unknown }
    const vanished = failure.code === 1 && failure.killed !== true && failure.signal == null && typeof failure.stdout === 'string' && failure.stdout.trim() === ''
    return vanished ? 'gone' : 'unknown'
  }
  if (stdout.trim() === '') return 'unknown'
  return collapse(stdout) === collapse(procStart) ? 'alive' : 'gone'
}

/** True when processState() says `alive`; a `ps` that could not answer counts as not running here. */
export async function processAlive(pid: number, procStart: string | undefined): Promise<boolean> {
  return (await processState(pid, procStart)) === 'alive'
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
async function headAndTail(
  path: string,
): Promise<{ head: Record<string, unknown>[]; tail: Record<string, unknown>[]; size: number; modifiedAt: number; mtimeMs: number }> {
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
      return { head: all, tail: all, size, modifiedAt: Math.trunc(stats.mtimeMs), mtimeMs: stats.mtimeMs }
    }
    // Tail: one byte before the window tells whether it starts on a line; a partial first line is
    // dropped, and so is a last line still being written (splitLines keeps complete lines only).
    const tailStart = Math.max(headLength, size - TAIL_BYTES)
    const tail = await readRange(file, tailStart - 1, size - tailStart + 1)
    const firstBreak = tail.indexOf(0x0a)
    const tailLines = firstBreak === -1 ? [] : splitLines(tail.subarray(firstBreak + 1))
    return { head: records(headLines), tail: records(tailLines), size, modifiedAt: Math.trunc(stats.mtimeMs), mtimeMs: stats.mtimeMs }
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

/**
 * The first prompt the user typed: a slash command gives `/name`, injected (meta) text is skipped,
 * and so is a message of attachments only, which has no text to name the Session by.
 */
function firstPrompt(head: readonly Record<string, unknown>[]): string | undefined {
  for (const record of head) {
    if (record.type !== 'user' || record.isSidechain === true) continue
    for (const { event } of parseTranscriptRecord(record)) {
      if (event.type === 'command') return event.name
      if (event.type === 'notice' && event.kind === 'user' && event.text.trim() !== '' && !event.text.trimStart().startsWith('<')) return event.text
    }
  }
  return undefined
}

/**
 * Transcripts whose history entry is being read at once. Reading all of them in parallel brought
 * the completions back in one batch: with 2000 transcripts the main process's event loop stood
 * still for ~150 ms while their heads and tails were parsed. A few at a time, it gets a turn between them.
 */
const HISTORY_READS = 16

/** `run` over `items`, at most `limit` at a time; the results in the order of `items`. */
async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** A Session of the history as its transcript tells it; whether it runs is decided per list. */
type HistoryRecord = Omit<HistorySession, 'live'>

/** A history entry, with the size and the modification time of the file when it was read. */
interface ReadEntry {
  size: number
  mtimeMs: number
  entry: HistoryRecord
}

async function historyEntry(path: string, sessionId: string): Promise<ReadEntry | undefined> {
  let read: Awaited<ReturnType<typeof headAndTail>>
  try {
    read = await headAndTail(path)
  } catch {
    return undefined // removed between the listing and the read
  }
  const { head, tail, size, modifiedAt, mtimeMs } = read
  const both = [...head, ...tail]
  const title =
    lastString(tail, 'custom-title', 'customTitle') ??
    lastString(head, 'custom-title', 'customTitle') ??
    lastString(tail, 'ai-title', 'aiTitle') ??
    lastString(head, 'ai-title', 'aiTitle') ??
    firstPrompt(head)
  const entry = dropUndefined<HistoryRecord>({
    sessionId,
    title: title === undefined ? undefined : oneLine(title),
    firstAt: firstString(head, 'timestamp'),
    lastAt: lastString(tail, undefined, 'timestamp') ?? lastString(head, undefined, 'timestamp'),
    cwd: firstString(head, 'cwd') ?? (await startCwd(path)),
    gitBranch: lastString(both, undefined, 'gitBranch'),
    entrypoint: firstString(head, 'entrypoint'),
    size,
    modifiedAt,
  })
  return { size, mtimeMs, entry }
}

/**
 * The history entries of transcripts already read, by folder and file name, in memory only. A list
 * asks the file system for each file's size and modification time (`stat`) and reads the head and
 * tail again only when either differs from the last read: a new, appended or rewritten transcript
 * is seen by the very next list, without a watcher (a search of a Linked machine subscribes to no
 * changes). Entries of files and folders that a listing no longer shows are dropped, so the cache
 * holds no more than the transcripts that exist.
 */
class HistoryCache {
  private readonly dirs = new Map<string, Map<string, ReadEntry>>()

  /** Drops the folders that are not in `present`, the full listing of projects/. */
  keepDirs(present: ReadonlySet<string>): void {
    for (const dir of this.dirs.keys()) if (!present.has(dir)) this.dirs.delete(dir)
  }

  /** Drops the files of `dir` that are not in `names`, its listing. */
  keepFiles(dir: string, names: ReadonlySet<string>): void {
    const files = this.dirs.get(dir)
    if (files === undefined) return
    for (const name of files.keys()) if (!names.has(name)) files.delete(name)
    if (files.size === 0) this.dirs.delete(dir)
  }

  /** The history entry of the transcript `name` in `dir`; undefined when the file is gone. */
  async entry(dir: string, name: string, sessionId: string): Promise<HistoryRecord | undefined> {
    const path = join(dir, name)
    let now: { size: number; mtimeMs: number }
    try {
      now = await stat(path)
    } catch {
      this.drop(dir, name)
      return undefined // removed since the listing
    }
    const known = this.dirs.get(dir)?.get(name)
    if (known !== undefined && known.size === now.size && known.mtimeMs === now.mtimeMs) return known.entry
    // Kept under the size and time of the read itself: a file that grew meanwhile is read once more.
    const read = await historyEntry(path, sessionId)
    if (read === undefined) {
      this.drop(dir, name)
      return undefined
    }
    let files = this.dirs.get(dir)
    if (files === undefined) {
      files = new Map()
      this.dirs.set(dir, files)
    }
    files.set(name, read)
    return read.entry
  }

  /** The cwd the last read of the transcript `name` in `dir` found; undefined when none is known. */
  cwdOf(dir: string, name: string): string | undefined {
    return this.dirs.get(dir)?.get(name)?.entry.cwd
  }

  private drop(dir: string, name: string): void {
    this.dirs.get(dir)?.delete(name)
  }
}

/**
 * How far scanStartCwd reads for the first record that names a cwd. The records before it carry
 * no cwd but may carry the whole first prompt: a `queue-operation` enqueue holds its text, a pasted
 * screenshot in base64 makes it megabytes. Past either bound the cwd is unknown.
 */
const CWD_SCAN_BYTES = 32 * 1024 * 1024
const CWD_SCAN_LINES = 1000
const CWD_SCAN_CHUNK = 256 * 1024

/** Where scanStartCwd stopped: the cwd, or how far it read complete lines and whether a bound stopped it. */
interface CwdScan {
  cwd?: string
  /** The byte after the last complete line read; a later scan of the grown file goes on from here. */
  end: number
  lines: number
  /** A bound of the scan was reached: the cwd stays unknown however the file grows. */
  capped: boolean
}

/**
 * The cwd the first record that names one gives, read line by line from `from` (a byte after a
 * line, with `lines` lines before it), up to CWD_SCAN_BYTES and CWD_SCAN_LINES. A last line
 * still being written is not read. Throws when the file cannot be opened.
 */
async function scanStartCwd(path: string, from = 0, lines = 0): Promise<CwdScan> {
  const file = await open(path, 'r')
  try {
    let position = from
    let end = from
    let count = lines
    let partial: Buffer[] = []
    for (;;) {
      if (position >= CWD_SCAN_BYTES || count >= CWD_SCAN_LINES) return { end, lines: count, capped: true }
      const chunk = await readRange(file, position, Math.min(CWD_SCAN_CHUNK, CWD_SCAN_BYTES - position))
      if (chunk.length === 0) return { end, lines: count, capped: false }
      let start = 0
      for (let at = chunk.indexOf(0x0a); at !== -1; at = chunk.indexOf(0x0a, start)) {
        const line = partial.length === 0 ? chunk.subarray(start, at) : Buffer.concat([...partial, chunk.subarray(start, at)])
        partial = []
        start = at + 1
        end = position + start
        count += 1
        // Only a line that may name it is parsed: a prompt in base64 is not.
        if (line.includes('"cwd"')) {
          const cwd = firstString(records([line.toString('utf8')]), 'cwd')
          if (cwd !== undefined) return { cwd, end, lines: count, capped: false }
        }
        if (count >= CWD_SCAN_LINES) return { end, lines: count, capped: true }
      }
      if (start < chunk.length) partial.push(chunk.subarray(start))
      position += chunk.length
    }
  } finally {
    await file.close()
  }
}

/** The cwd a transcript was started in (first record that names one), or undefined when none is known. */
async function startCwd(path: string): Promise<string | undefined> {
  try {
    return (await scanStartCwd(path)).cwd
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
  /**
   * How often the registry folder is listed in case the watcher missed a change of it. On macOS
   * every fs.watch of the process shares one FSEvents stream, and libuv makes that stream again
   * each time any watch starts or stops: a file written meanwhile is never reported. With other
   * watches starting, 1 to 4 of 100 registry files written were missed (none without them), and
   * the app starts its watches in the first seconds. A missed file with no live Session left its
   * Node off the Canvas until the next change of the registry, which may never come.
   */
  pollMs?: number
}

/** Names, sizes and modification times of the registry files: equal while the registry is unchanged. */
async function registryStamp(sessionsDir: string): Promise<string> {
  const names = (await listDir(sessionsDir)).filter((entry) => entry.isFile && /^\d+\.json$/.test(entry.name)).map((entry) => entry.name)
  const stamps = await Promise.all(
    names.map(async (name) => {
      try {
        const stats = await stat(join(sessionsDir, name))
        return `${name}:${stats.size}:${stats.mtimeMs}`
      } catch {
        return `${name}:gone` // removed between the listing and the stat
      }
    }),
  )
  return stamps.sort().join('\n')
}

/**
 * A Project root for the registry. `path` names the Project's folders under projects/: Claude Code
 * names them after the cwd it started in, so the spelling of the Project list. `gitAt` is the real
 * path a Linked machine's call was checked on (src/main/link/caller.ts): git lists the worktrees
 * there, so a link swapped in after the check does not lead git elsewhere, and the folders named
 * after the real path count too; without it, `path` is both. `local` marks a call of this
 * Machine's own (a window, the Orchestrator, Node Sessions): it may see a transcript whose cwd is
 * unknown in a folder named exactly like a root (belongs). Any other root — a string among them —
 * is judged strictly, so a caller that does not say is never shown more than a Linked machine.
 */
export type RegistryRoot = string | { readonly path: string; readonly gitAt?: string; readonly local?: boolean }

/** The spelling of a RegistryRoot that names its folders. */
export const rootPath = (root: RegistryRoot): string => (typeof root === 'string' ? root : root.path)

/** Whether the call is judged strictly: any but a `local` one (RegistryRoot). */
const strictOf = (root: RegistryRoot): boolean => typeof root === 'string' || root.local !== true

export interface ClaudeHomeWatch {
  /** Resolves once the initial scan is done and changes are being reported. */
  ready: Promise<void>
  close(): Promise<void>
}

const TRANSCRIPT = /^([A-Za-z0-9][A-Za-z0-9-]*)\.jsonl$/

/**
 * How long chokidar 5.0.0 keeps quiet about a path after it reported a change of it: every other
 * change within that time is dropped, not reported at its end (`_throttle(EV.CHANGE, path, 50)`
 * in its index.js). A write in that time after a read of the file is seen by no one.
 */
const CHANGE_QUIET_MS = 50

export class ClaudeHomeRegistry {
  readonly home: string
  private readonly listWorktrees: NonNullable<RegistryOptions['listWorktrees']>
  private readonly isAlive: NonNullable<RegistryOptions['isAlive']>
  private readonly historyCache = new HistoryCache()

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

  /** The git worktrees of the Project at `root`, other than the root itself; the lister the registry was given. */
  worktrees(root: string): Promise<string[]> {
    return this.listWorktrees(root)
  }

  /** The Project root, its real path when one is given, and its worktrees, absolute and normalised. */
  async roots(projectRoot: RegistryRoot): Promise<string[]> {
    const root = resolve(rootPath(projectRoot))
    const gitAt = typeof projectRoot === 'string' || projectRoot.gitAt === undefined ? root : resolve(projectRoot.gitAt)
    const worktrees = await this.listWorktrees(gitAt)
    return [...new Set([root, gitAt, ...worktrees.map((path) => resolve(path))])]
  }

  /**
   * Transcript folders of the Project: its root, its worktrees, removed worktrees of the root and
   * folders inside any of them, with how each was matched (dirMatch). Any of them may be a folder
   * outside the Project too, so its transcripts are kept by their cwd (belongs).
   */
  async transcriptDirs(roots: readonly string[]): Promise<{ path: string; match: Exclude<DirMatch, 'none'> }[]> {
    const entries = await listDir(this.projectsDir)
    this.historyCache.keepDirs(new Set(entries.filter((entry) => entry.isDirectory).map((entry) => join(this.projectsDir, entry.name))))
    return entries
      .flatMap((entry) => {
        const match = entry.isDirectory ? dirMatch(entry.name, roots) : 'none'
        return match === 'none' ? [] : [{ path: join(this.projectsDir, entry.name), match }]
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** Live Sessions and the history of the Project at `projectRoot`. */
  async sessions(projectRoot: RegistryRoot): Promise<ProjectSessions> {
    const roots = await this.roots(projectRoot)
    const strict = strictOf(projectRoot)
    const [live, dirs] = await Promise.all([liveSessions(this.home, roots, this.isAlive), this.transcriptDirs(roots)])
    const liveIds = new Set(live.map((session) => session.sessionId))
    const files = (
      await Promise.all(
        dirs.map(async ({ path: dir, match: dirMatched }) => {
          const found = (await listDir(dir)).flatMap((entry) => {
            const match = entry.isFile ? TRANSCRIPT.exec(entry.name) : null
            return match?.[1] ? [{ dir, name: entry.name, sessionId: match[1], match: dirMatched }] : []
          })
          this.historyCache.keepFiles(dir, new Set(found.map((file) => file.name)))
          return found
        }),
      )
    ).flat()
    const history = (
      await mapLimit(files, HISTORY_READS, async ({ dir, name, sessionId, match }): Promise<HistorySession | undefined> => {
        const entry = await this.historyCache.entry(dir, name, sessionId)
        if (entry === undefined) return undefined
        if (!belongs(entry.cwd, roots, strict, match)) return undefined
        return { ...entry, live: liveIds.has(sessionId) }
      })
    )
      .filter((entry): entry is HistorySession => entry !== undefined)
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.sessionId.localeCompare(b.sessionId))
    return { live, history }
  }

  /** Only the live Sessions of the Project at `projectRoot`; the history is not read. */
  async live(projectRoot: RegistryRoot): Promise<LiveSession[]> {
    return liveSessions(this.home, await this.roots(projectRoot), this.isAlive)
  }

  /**
   * Path of a Session's transcript among the Project's folders, or null. For this Machine's own
   * callers a transcript whose cwd is unknown is found: the Orchestrator starts a new Session when
   * its saved one is not found (src/main/agent/orchestrator.ts), and that cannot be undone.
   */
  async transcriptPath(projectRoot: RegistryRoot, sessionId: string): Promise<string | null> {
    if (!TRANSCRIPT.test(`${sessionId}.jsonl`)) return null
    const roots = await this.roots(projectRoot)
    const strict = strictOf(projectRoot)
    for (const { path: dir, match } of await this.transcriptDirs(roots)) {
      const entries = await listDir(dir)
      if (!entries.some((entry) => entry.isFile && entry.name === `${sessionId}.jsonl`)) continue
      const path = join(dir, `${sessionId}.jsonl`)
      if (belongs(await startCwd(path), roots, strict, match)) return path
    }
    return null
  }

  /**
   * Watches the registry and the Project's transcript folders and reports changes, debounced.
   * New worktree folders of the root are picked up as they appear.
   */
  async watch(projectRoot: RegistryRoot, onChange: (change: ClaudeHomeChange) => void, options: WatchOptions = {}): Promise<ClaudeHomeWatch> {
    const roots = await this.roots(projectRoot)
    const debounceMs = options.debounceMs ?? 150
    const settleMs = options.settleMs ?? 100
    const pollMs = options.pollMs ?? 250
    const projectsDir = this.projectsDir
    const sessionsDir = this.sessionsDir

    // Decides from the path alone, so whole unrelated subtrees of the Claude home are skipped.
    // chokidar passes forward-slash paths on Windows, so the root is compared through relative().
    const ignored = (path: string): boolean => {
      if (relative(this.home, path) === '') return false
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
    // Verdicts of the transcripts: does the cwd they start in lie inside the Project (belongs)?
    // Kept once the cwd is known, or once scanStartCwd gave up on it, so an append does not read
    // the file's start again and a removed file is still judged. A file whose first records name
    // no cwd yet is scanned on from where the last scan stopped (`scans`). Filled for the files of
    // `subfolder` folders that exist when watching starts (`prefilled`), because the watcher skips
    // them until they change. Those of `root` folders get theirs at their first change: they are
    // most of a Project's transcripts, and scanning them all at each watch start costs too much.
    // One removed before it ever changed is judged by the cwd the last list read (HistoryCache): a
    // client lists the Sessions right after it subscribes.
    const strict = strictOf(projectRoot)
    const verdicts = new Map<string, boolean>()
    const scans = new Map<string, { end: number; lines: number }>()
    const startsInProject = async (path: string, match: DirMatch): Promise<boolean> => {
      const known = verdicts.get(path)
      if (known !== undefined) return known
      let scan: CwdScan
      try {
        const from = scans.get(path)
        // A file shorter than where the last scan stopped was rewritten: from its start again.
        const resume = from !== undefined && from.end <= (await stat(path)).size ? from : { end: 0, lines: 0 }
        scan = await scanStartCwd(path, resume.end, resume.lines)
      } catch {
        return belongs(undefined, roots, strict, match) // removed meanwhile, or unreadable
      }
      if (scan.cwd === undefined && !scan.capped) {
        scans.set(path, { end: scan.end, lines: scan.lines })
        return belongs(undefined, roots, strict, match)
      }
      scans.delete(path)
      const verdict = belongs(scan.cwd, roots, strict, match)
      verdicts.set(path, verdict)
      return verdict
    }
    const relooks = new Set<NodeJS.Timeout>()
    const note = (path: string, removed = false, again = false) => {
      if (/^\d+\.json$/.test(relative(sessionsDir, path))) {
        sessions = true
        schedule()
        return
      }
      const [dirName = '', fileName = ''] = relative(projectsDir, path).split(sep)
      const sessionId = TRANSCRIPT.exec(fileName)?.[1]
      const match = dirMatch(dirName, roots)
      if (!sessionId || match === 'none') return
      const report = (inside: boolean) => {
        if (!inside) return
        transcripts.add(sessionId)
        schedule()
      }
      if (!removed) {
        void startsInProject(path, match).then((inside) => {
          report(inside)
          // No cwd yet: a write chokidar dropped right after this change (a rewrite truncates the
          // file, then writes it) may hold it. One more read once chokidar reports changes again;
          // a later write is a change of its own. A read that was itself such a look ends here.
          if (inside || again || closed || verdicts.has(path)) return
          const timer = setTimeout(() => {
            relooks.delete(timer)
            note(path, false, true)
          }, CHANGE_QUIET_MS)
          relooks.add(timer)
        })
        return
      }
      // A removed file can no longer be read: its verdict, else the cwd of the last list, else unknown.
      void prefilled.then(() => {
        scans.delete(path)
        report(verdicts.get(path) ?? belongs(this.historyCache.cwdOf(join(projectsDir, dirName), fileName), roots, strict, match))
      })
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
        const checked = dirs.filter((dir) => dir.match === 'subfolder')
        const files = await Promise.all(
          checked.map(async ({ path: dir }) => (await listDir(dir)).filter((entry) => entry.isFile && TRANSCRIPT.test(entry.name)).map((entry) => join(dir, entry.name))),
        )
        await Promise.all(files.flat().map((path) => startsInProject(path, 'subfolder')))
      })
      .catch((error: unknown) => console.error('[claude-home] reading transcript folders failed', error))
    const ready = Promise.all([new Promise<void>((done) => watcher.once('ready', () => setTimeout(done, settleMs))), prefilled]).then(() => undefined)
    // The registry folder listed again every pollMs (WatchOptions.pollMs): a change the watcher
    // missed is reported all the same. Taken first when watching starts, so a file written after
    // that is either in the list a client reads after `ready` or reported here.
    let stamp: string | undefined
    let polling = true
    const listed = (now: string): void => {
      if (stamp !== undefined && now !== stamp) {
        sessions = true
        schedule()
      }
      stamp = now
    }
    const pollDone = () => {
      polling = false
    }
    void registryStamp(sessionsDir).then(listed, () => undefined).finally(pollDone)
    const poller = setInterval(() => {
      if (polling || closed) return
      polling = true
      void registryStamp(sessionsDir).then(listed, () => undefined).finally(pollDone)
    }, pollMs)
    poller.unref()
    return {
      ready,
      close: async () => {
        closed = true
        clearInterval(poller)
        if (timer) clearTimeout(timer)
        timer = undefined
        for (const relook of relooks) clearTimeout(relook)
        relooks.clear()
        await closeForGood(watcher)
      },
    }
  }
}
