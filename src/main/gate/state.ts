// The gate's verdict on each worktree of a Project, read from what the Gate leaves behind: the
// plugin's hooks/gate.mjs, or gate.sh of a Harness older than worfy-windows ticket 03
// (~/.claude/hooks/gate.sh; WORFY_CLAUDE_HOME stands for ~/.claude in tests). <gate> below is the
// gate/ folder of the Harness found on the machine (src/main/harness/locate.ts, worfy-harness
// ticket 12): <harnessHome>/gate with the plugin, <home>/gate with the old Harness or none.
//
// - markers in <gate>/state/: `red-<key>-<tag>` (red) and `unverified-<key>-<tag>` (could not
//   verify), where `tag` is the first 8 hex digits of SHA-1 of the worktree path as
//   `git rev-parse --show-toplevel` prints it (`C:/Users/x/worfy` on Windows) and `key` is the
//   entry of <gate>/config.json whose `match` is the longest prefix of the repository root
//   (gate-resolve.mjs --which);
// - without a marker, the verdict file `verdict-<tag>.json` in the same folder: the Gate rewrites it
//   on every run with the outcome of that run (ticket worfy-harness/09, the format is in the header
//   of harness/hooks/gate.mjs). A marker goes first: after a red run, a run that checked nothing
//   writes `none` into the file, and the worktree stays red while the red marker is there;
// - without a marker or a usable verdict file (a gate older than the file, ~/.claude before the
//   Harness moves to the plugin), the last `[gate] зелено | красно | ничего не прогналось | ПРОВЕРИТЬ НЕ УДАЛОСЬ`
//   line in the transcripts of the Sessions started in that worktree: the output of a Bash call
//   that ran the Gate in that worktree, and hook output. The output of other commands (the gate's
//   own tests, `tail` of an old log, the Gate after `cd` to another repository) and a line the user
//   or the model wrote (a prompt, a brief, a reply) do not count.
//
// «Ничего не прогналось» (`none` in the file) is «нет данных», never green. Nothing here writes: the
// state folder and the transcripts are only listed and read, git only lists worktrees.
//
// Paths of Windows (worfy-windows ticket 03): realpath gives `C:\Users\x\worfy`, git and the Gate
// write `C:/Users/x/worfy`, Git Bash `/c/Users/x/worfy`, and NTFS does not tell letter case apart.
// The functions that hash, compare or resolve a path take the platform, `process.platform` by
// default, so the Windows rules are tested on macOS and Linux; with any other platform a path is
// read as before.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { gateOutcomeSchema, type GateOutcome, type GateState } from '../../shared/ipc/checks'
import { isWindowsAbsolutePath } from '../../shared/paths'
import { projectDirName } from '../claude-home/registry'
import { harnessHomes, locateHarness } from '../harness/locate'
import { readNewLines, type TailCursor } from '../claude-home/tail'

const run = promisify(execFile)
const realpathNative = promisify(realpath.native)
const realpathPlain = promisify(realpath)

/** A Windows path as git prints it: `/` for `\`, the drive letter in upper case (`C:/Users/x/worfy`). */
const gitSpelling = (path: string): string => path.replaceAll('\\', '/').replace(/^[a-z]:/u, (drive) => drive.toUpperCase())

/**
 * A path in the form two paths are compared in. On Windows `\` and `/` are one separator and
 * letter case does not count; elsewhere it is the path itself.
 */
const comparable = (path: string, platform: NodeJS.Platform): string => (platform === 'win32' ? path.replaceAll('\\', '/').toLowerCase() : path)

/** Whether `path` is `folder` or lies under it; both are `comparable`. */
const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`)

/**
 * The Gate's per-worktree tag: the first 8 hex digits of SHA-1 of the worktree path as the Gate has
 * it from `git rev-parse --show-toplevel`. On Windows git prints `C:/a/b` for what realpath gives
 * as `C:\a\b`, so the path is brought to git's spelling first.
 */
export function gateTag(path: string, platform: NodeJS.Platform = process.platform): string {
  return createHash('sha1').update(platform === 'win32' ? gitSpelling(path) : path, 'utf8').digest('hex').slice(0, 8)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// ── which entry of gate/config.json ─────────────────────────────────────────

const configSchema = z.object({ repos: z.array(z.object({ key: z.string().min(1), match: z.string().min(1) }).loose()) }).loose()
export type GateConfig = z.infer<typeof configSchema>

/** <gateDir>/config.json, or null when it is missing or not the gate's format. */
export async function readGateConfig(gateDir: string): Promise<GateConfig | null> {
  try {
    const parsed = configSchema.safeParse(JSON.parse(await readFile(join(gateDir, 'config.json'), 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** realpath(3) of a path, which also gives the on-disk spelling of letter case; the path itself when that fails. */
async function onDisk(path: string): Promise<string> {
  try {
    return await realpathNative(path)
  } catch {
    return path
  }
}

/**
 * A registry `match` in the spelling gate-resolve.mjs (its onDisk) compares: realpath(3) when that
 * changes nothing but letter case. On Windows also when the plain realpath changes nothing but the
 * separators and letter case: then `match` is an 8.3 short name or a `subst` drive, not a link, and
 * realpath(3) expands it. Otherwise `match` as written.
 */
async function matchOnDisk(match: string, platform: NodeJS.Platform): Promise<string> {
  try {
    const native = await realpathNative(match)
    if (native.toLowerCase() === match.toLowerCase()) return native
    if (platform !== 'win32') return match
    return (await realpathPlain(match)).toLowerCase() === win32.normalize(match).toLowerCase() ? native : match
  } catch {
    return match
  }
}

/**
 * The gate key of a repository, as gate-resolve.mjs --which picks it: the entry whose `match` is
 * the root itself or a folder above it, the longest such `match` winning. `match` is spelled the
 * way the gate's resolver spells it (matchOnDisk). On Windows `match` and the root are compared
 * with either separator and without regard to letter case.
 */
export async function gateKey(config: GateConfig | null, root: string, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (config === null) return null
  const target = comparable(await onDisk(root), platform)
  let best: { key: string; length: number } | null = null
  for (const repo of config.repos) {
    const match = comparable(await matchOnDisk(repo.match, platform), platform)
    if (target !== match && !target.startsWith(`${match}/`)) continue
    if (best === null || match.length > best.length) best = { key: repo.key, length: match.length }
  }
  return best?.key ?? null
}

// ── markers ──────────────────────────────────────────────────────────────────

/** The marker verdict of one worktree: red wins over unverified; null when there is none. */
export function markerOutcome(names: ReadonlySet<string>, key: string, tag: string): 'red' | 'unverified' | null {
  if (names.has(`red-${key}-${tag}`)) return 'red'
  if (names.has(`unverified-${key}-${tag}`)) return 'unverified'
  return null
}

async function listState(gateDir: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(join(gateDir, 'state')))
  } catch {
    return new Set()
  }
}

// ── the verdict file ─────────────────────────────────────────────────────────

/** `verdict-<tag>.json` as the Gate writes it (harness/hooks/gate.mjs, the header). */
const verdictFileSchema = z
  .object({
    version: z.literal(1),
    outcome: gateOutcomeSchema,
    profile: z.string(),
    worktree: z.string().min(1),
    key: z.string().nullable(),
    head: z.string().nullable(),
    exit: z.number().int(),
    at: z.iso.datetime({ offset: true }),
    reason: z.string().nullable(),
  })
  .loose()
export type GateVerdictFile = z.infer<typeof verdictFileSchema>

/** The name of the verdict file of a worktree with this tag in the gate state folder. */
export const verdictFileName = (tag: string): string => `verdict-${tag}.json`

/**
 * The verdict file of the worktree `worktree` (its path on disk): `{ verdict }` when the file is
 * the gate's format and is about this worktree, `{ problem }` with one line saying why it is not
 * taken, and null when there is no file. Two worktrees whose tags (8 hex digits) collide share a
 * file name; the `worktree` inside it tells them apart. When both the file and `head` (the
 * worktree's HEAD now) name a commit and they differ, the file is about an earlier checkout — a
 * worktree removed and created again at the same path — and is not taken either. On Windows the
 * Gate writes `worktree` as git prints it (`C:/…`) and `worktree` here comes from realpath
 * (`C:\…`): the two are compared with either separator and without regard to letter case.
 */
export async function readVerdictFile(file: string, worktree: string, head?: string | null, platform: NodeJS.Platform = process.platform): Promise<{ verdict: GateVerdictFile } | { problem: string } | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    return isRecord(error) && error.code === 'ENOENT' ? null : { problem: `cannot be read: ${String(error)}` }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { problem: 'is not JSON' }
  }
  const parsed = verdictFileSchema.safeParse(json)
  if (!parsed.success) return { problem: `is not the gate's verdict format: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}` }
  const verdict = parsed.data
  const here = comparable(worktree, platform)
  if (comparable(verdict.worktree, platform) !== here && comparable(await onDisk(verdict.worktree), platform) !== here) return { problem: `is about another worktree: ${verdict.worktree}` }
  if (verdict.head !== null && head && verdict.head !== head) return { problem: `is about commit ${verdict.head}, the worktree is at ${head}` }
  return { verdict }
}

// ── gate lines in transcripts ────────────────────────────────────────────────

const GATE_LINE = /^\[gate\] (зелено|красно|ничего не прогналось|ПРОВЕРИТЬ НЕ УДАЛОСЬ)/gmu

const OUTCOME: Record<string, GateOutcome> = {
  зелено: 'green',
  красно: 'red',
  'ничего не прогналось': 'none',
  'ПРОВЕРИТЬ НЕ УДАЛОСЬ': 'unverified',
}

/** The outcome of the last gate verdict line in a piece of output; null when it has none. */
export function lastGateOutcome(text: string): GateOutcome | null {
  let last: GateOutcome | null = null
  for (const match of text.matchAll(GATE_LINE)) last = OUTCOME[match[1]!] ?? last
  return last
}

/** The text of a tool result's `content`: a string or a list of text blocks. */
function toolResultText(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.filter(isRecord).flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
}

/**
 * The Gate's script as a word of a command: `node "C:\Users\x\plugin\hooks\gate.mjs" fast`, or
 * `~/.claude/hooks/gate.sh fast` of a Harness older than worfy-windows ticket 03 and of old
 * transcripts; not `gate-unregistered.test.sh` or `gate-resolve.mjs`. A `\` before the name is a
 * path separator on Windows only: elsewhere bash reads `my\gate.sh` as `mygate.sh`.
 */
const GATE_SCRIPT = /(?:^|[\s;&|(/'"`])gate\.(?:mjs|sh)(?=$|[\s;&|)<>'"`])/gu
const GATE_SCRIPT_WINDOWS = /(?:^|[\s;&|(/\\'"`])gate\.(?:mjs|sh)(?=$|[\s;&|)<>'"`])/gu
/** The names GATE_SCRIPT looks for: a transcript line with neither has no Gate call. */
const GATE_SCRIPT_NAMES = ['gate.mjs', 'gate.sh']
/** A `cd` or `pushd` at the start of a shell command, with its argument if it has one. */
const CD = /(?:^|[;&|({\n'"]|\b(?:then|do|else))\s*(?:cd|pushd)(?:[ \t]+("[^"]*"|'[^']*'|[^\s;&|)]+))?(?=$|[\s;&|)])/gu
/** `/c` or `/c/Users/x`: how Git Bash spells `C:\` and `C:\Users\x`. */
const GIT_BASH_DRIVE = /^\/([A-Za-z])(?=\/|$)/u

/**
 * Where `cd <path>` from `from` leads on Windows. Absolute are `C:\…`, `C:/…`, UNC and Git Bash's
 * `/c/…`. Null for `/tmp/x` (under Git Bash's own root), `\x` (the root of the shell's drive) and
 * `C:x` (that drive's current folder): only the shell that ran the command can place them.
 */
function cdTargetWindows(from: string, path: string): string | null {
  const drive = GIT_BASH_DRIVE.exec(path)
  const target = drive ? `${drive[1]!.toUpperCase()}:${path.slice(2) || '/'}` : path
  if (isWindowsAbsolutePath(target)) return win32.resolve(target)
  if (/^(?:[\\/]|[A-Za-z]:)/u.test(target)) return null
  return isWindowsAbsolutePath(from) ? win32.resolve(from, target) : null
}

/**
 * Where `cd <arg>` from `from` leads; null when the shell would have to expand something to tell.
 * On Windows that includes an argument with a `\` outside quotes: the Bash tool runs Git Bash,
 * where it is an escape, so `cd C:\a\b` goes to `C:ab` and `cd /c/my\ repo` to `C:\my repo`. In
 * quotes a path of Windows is taken as written.
 */
function cdTarget(from: string, arg: string | undefined, platform: NodeJS.Platform): string | null {
  if (arg === undefined) return homedir()
  let path: string
  if (arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2) path = arg.slice(1, -1)
  else {
    const quoted = arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2
    if (platform === 'win32' && !quoted && arg.includes('\\')) return null
    path = quoted ? arg.slice(1, -1) : arg
    path = path.replace(quoted ? /^(?:\$HOME|\$\{HOME\})(?=\/|$)/u : /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/u, homedir())
    if (/[$`*?~]/u.test(path)) return null
  }
  if (path === '-' || path === '') return null
  if (platform === 'win32') return cdTargetWindows(from, path)
  if (path.startsWith('/')) return posix.resolve(path)
  return from === '' ? null : posix.resolve(from, path)
}

/**
 * Where a Bash command ran the Gate (gate.mjs, or the old gate.sh): undefined when it does not run
 * it at all; else the folder of the last `cd` before the last Gate call (relative to `cwd`, the
 * Session's folder at that moment), `cwd` when there is no `cd`, '' when the record names no folder
 * and the command has no `cd` (then it is the Session's own), and null when the folder cannot be
 * told without running a shell (`cd "$W"`, `popd`, a relative `cd` with no `cwd`).
 */
export function gateRunDir(command: string, cwd: string | null, platform: NodeJS.Platform = process.platform): string | null | undefined {
  let end = -1
  for (const match of command.matchAll(platform === 'win32' ? GATE_SCRIPT_WINDOWS : GATE_SCRIPT)) end = match.index + match[0].length
  if (end < 0) return undefined
  const before = command.slice(0, end)
  if (/(?:^|[\s;&|(])popd\b/u.test(before)) return null
  let dir: string | null = cwd ?? ''
  for (const match of before.matchAll(CD)) {
    dir = cdTarget(dir, match[1], platform)
    if (dir === null) return null
  }
  return dir
}

/** Program output of a transcript record that may carry gate lines, with the folder it is about. */
export interface GateOutput {
  text: string
  /** As gateRunDir: a folder, '' for the Session's own folder, null for a folder that cannot be told. */
  dir: string | null
}

/** The `cwd` of a transcript record when it is an absolute path: `/…`, and on Windows also `C:\…`, `C:/…` or UNC. */
function recordCwd(record: Record<string, unknown>, platform: NodeJS.Platform): string | null {
  if (typeof record.cwd !== 'string') return null
  return record.cwd.startsWith('/') || (platform === 'win32' && isWindowsAbsolutePath(record.cwd)) ? record.cwd : null
}

/**
 * The gate output in one transcript record: the result of a Bash call that ran the Gate, and hook
 * output. `gateCalls` maps the ids of tool calls that ran the Gate to their folder; this record's
 * tool calls are added to it and its results taken out. The result of any other tool call does not
 * count, though it may print gate lines (the gate's own tests, `tail` of an old log), and neither
 * do prompts, briefs, task notifications and the model's own text: they quote gate lines without
 * having run the gate.
 */
export function gateOutputs(record: unknown, gateCalls: Map<string, string | null>, platform: NodeJS.Platform = process.platform): GateOutput[] {
  if (!isRecord(record)) return []
  if (record.type === 'assistant' && isRecord(record.message) && Array.isArray(record.message.content)) {
    for (const block of record.message.content.filter(isRecord)) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string' || !isRecord(block.input) || typeof block.input.command !== 'string') continue
      const dir = gateRunDir(block.input.command, recordCwd(record, platform), platform)
      if (dir !== undefined) gateCalls.set(block.id, dir)
    }
    return []
  }
  if (record.type === 'user' && isRecord(record.message) && Array.isArray(record.message.content)) {
    const outputs: GateOutput[] = []
    for (const block of record.message.content.filter(isRecord)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string' || !gateCalls.has(block.tool_use_id)) continue
      const dir = gateCalls.get(block.tool_use_id) ?? null
      gateCalls.delete(block.tool_use_id)
      for (const text of toolResultText(block.content)) outputs.push({ text, dir })
    }
    return outputs
  }
  const dir = recordCwd(record, platform) ?? ''
  if (record.type === 'attachment' && isRecord(record.attachment) && typeof record.attachment.type === 'string' && record.attachment.type.startsWith('hook_')) {
    const { content, stdout, stderr } = record.attachment
    return [content, stdout, stderr].filter((value): value is string => typeof value === 'string').map((text) => ({ text, dir }))
  }
  if (record.type === 'system' && typeof record.subtype === 'string' && record.subtype.includes('hook')) {
    const errors = Array.isArray(record.hookErrors) ? record.hookErrors : []
    return [...errors.filter((value): value is string => typeof value === 'string'), ...(typeof record.content === 'string' ? [record.content] : [])].map((text) => ({ text, dir }))
  }
  return []
}

interface GateSighting {
  outcome: GateOutcome
  /** ISO time of the record, or '' when it has none. */
  at: string
}

interface FileScan {
  cursor: TailCursor | undefined
  /** Tool calls that ran the Gate and have no result yet, by id, with their folder. */
  gateCalls: Map<string, string | null>
  /** The last gate verdict per folder it is about ('' — the Session's own); `seq` orders them within the file. */
  last: Map<string, GateSighting & { seq: number }>
  seq: number
}

/** Where a transcript folder belongs: its worktree and every worktree of the Project, as on disk. */
export interface GatePlace {
  here: string
  worktrees: readonly string[]
}

/**
 * Whether a gate run in `dir` was about the worktree `place.here`: it is the deepest worktree
 * holding `dir`. On Windows `dir` may come from a command in any spelling (`C:/…`, other letter
 * case) while the worktrees are as realpath gives them.
 */
async function isAbout(dir: string, place: GatePlace, platform: NodeJS.Platform): Promise<boolean> {
  if (dir === '') return true
  const real = comparable(await onDisk(dir), platform)
  let owner: string | null = null
  for (const worktree of place.worktrees.map((each) => comparable(each, platform))) {
    if (inside(real, worktree) && (owner === null || worktree.length > owner.length)) owner = worktree
  }
  return owner === comparable(place.here, platform)
}

/**
 * Finds the last gate verdict about a worktree in the transcripts of a folder under
 * <home>/projects/, reading each file only past what it read before: transcripts are append-only
 * and can be large. A truncated or replaced file is read again from the start. `platform` says by
 * which rules the paths in the transcripts are read; the machine's own by default.
 */
export class TranscriptGateScanner {
  private readonly files = new Map<string, FileScan>()

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async lastIn(folder: string, place: GatePlace): Promise<GateSighting | null> {
    let names: string[]
    try {
      names = (await readdir(folder)).filter((name) => name.endsWith('.jsonl'))
    } catch {
      return null
    }
    let best: GateSighting | null = null
    for (const name of names) {
      let latest: (GateSighting & { seq: number }) | null = null
      for (const [dir, sighting] of await this.scanFile(join(folder, name))) {
        if ((latest === null || sighting.seq > latest.seq) && (await isAbout(dir, place, this.platform))) latest = sighting
      }
      if (latest !== null && (best === null || latest.at >= best.at)) best = { outcome: latest.outcome, at: latest.at }
    }
    return best
  }

  private async scanFile(file: string): Promise<Map<string, GateSighting & { seq: number }>> {
    const scan = this.files.get(file) ?? { cursor: undefined, gateCalls: new Map(), last: new Map(), seq: 0 }
    for (;;) {
      let chunk
      try {
        chunk = await readNewLines(file, scan.cursor)
      } catch {
        return scan.last
      }
      if (chunk.reset) {
        scan.gateCalls.clear()
        scan.last.clear()
      }
      for (const line of chunk.lines) {
        if (!line.includes('[gate]') && !GATE_SCRIPT_NAMES.some((name) => line.includes(name))) continue
        let record: unknown
        try {
          record = JSON.parse(line)
        } catch {
          continue
        }
        for (const { text, dir } of gateOutputs(record, scan.gateCalls, this.platform)) {
          const outcome = lastGateOutcome(text)
          if (outcome === null || dir === null) continue
          const at = isRecord(record) && typeof record.timestamp === 'string' ? record.timestamp : ''
          scan.seq += 1
          scan.last.set(dir, { outcome, at, seq: scan.seq })
        }
      }
      scan.cursor = chunk.cursor
      if (!chunk.more) break
    }
    this.files.set(file, scan)
    return scan.last
  }
}

// ── worktrees ────────────────────────────────────────────────────────────────

export interface Worktree {
  path: string
  branch: string | null
  /** The SHA of its HEAD as `git worktree list` gives it; absent or null when unknown. */
  head?: string | null
}

/** Variables that would point git at another repository than the one `-C` names. */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']

/** Every worktree of the repository at `root`, the checkout first; just the root outside git. */
export async function listWorktrees(root: string): Promise<Worktree[]> {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION_VARS.includes(name)))
    // `worktree list` only reads the repository; it prunes nothing.
    const { stdout } = await run('git', ['-C', root, 'worktree', 'list', '--porcelain'], { env, timeout: 10_000, encoding: 'utf8' })
    const result: Worktree[] = []
    for (const block of stdout.split(/\n\n+/)) {
      const lines = block.split('\n')
      const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
      if (!path) continue
      const ref = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length)
      const head = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length)
      result.push({ path, branch: ref ? ref.replace(/^refs\/heads\//, '') : null, head: head || null })
    }
    return result.length ? result : [{ path: root, branch: null }]
  } catch {
    return [{ path: root, branch: null }]
  }
}

// ── all together ─────────────────────────────────────────────────────────────

export interface GateReaderOptions {
  /** The Claude home (src/main/storage/paths.ts, claudeHome()): the transcripts are in its projects/. */
  home: string
  /**
   * The Harness home (src/main/storage/paths.ts, harnessHome()); WORFY_HARNESS_HOME or
   * <home>/worfy-harness by default. The Gate registry and state are in the gate/ folder of the
   * Harness found from both homes (src/main/harness/locate.ts): <harnessHome>/gate with the
   * plugin, <home>/gate with the old Harness or none.
   */
  harnessHome?: string
  /** Where a verdict file that is not taken is reported, one line each; console.warn by default. */
  warn?: (message: string) => void
}

/**
 * Reads the gate state of a Project's worktrees; keeps what it learned of transcripts between reads.
 * Per worktree: the red marker, the unverified marker, the verdict file, the last gate line of a
 * transcript.
 */
export class GateReader {
  private readonly scanner = new TranscriptGateScanner()
  /** The last problem reported per verdict file: the reader runs on every refresh, and says each one once. */
  private readonly reported = new Map<string, string>()

  constructor(private readonly options: GateReaderOptions) {}

  /** The gate/ folder of the Harness on the machine now: looked for on every read, so a switch to the plugin needs no restart. */
  private gateDir(): string {
    const { home, harnessHome } = this.options
    return locateHarness(harnessHome === undefined ? harnessHomes(home) : { claudeHome: home, harnessHome }).gateDir
  }

  private async fromFile(gateDir: string, names: ReadonlySet<string>, tag: string, worktree: string, head: string | null | undefined): Promise<GateState | null> {
    const name = verdictFileName(tag)
    const file = join(gateDir, 'state', name)
    const read = names.has(name) ? await readVerdictFile(file, worktree, head) : null
    if (read !== null && 'verdict' in read) {
      this.reported.delete(file)
      return { outcome: read.verdict.outcome, source: 'file', at: read.verdict.at }
    }
    if (read === null) this.reported.delete(file)
    else if (this.reported.get(file) !== read.problem) {
      this.reported.set(file, read.problem)
      const warn = this.options.warn ?? ((message: string) => console.warn(message))
      warn(`[gate] the verdict file ${file} is not taken for ${worktree}: it ${read.problem}`)
    }
    return null
  }

  async read(root: string, worktrees: readonly Worktree[]): Promise<(Worktree & { gate: GateState })[]> {
    const { home } = this.options
    const gateDir = this.gateDir()
    const key = await gateKey(await readGateConfig(gateDir), root)
    const names = await listState(gateDir)
    const real = await Promise.all(worktrees.map((worktree) => onDisk(worktree.path)))
    const result: (Worktree & { gate: GateState })[] = []
    for (const [index, { head, ...worktree }] of worktrees.entries()) {
      const tag = gateTag(real[index]!)
      const marker = key === null ? null : markerOutcome(names, key, tag)
      if (marker !== null) {
        result.push({ ...worktree, gate: { outcome: marker, source: 'marker', at: null } })
        continue
      }
      const file = await this.fromFile(gateDir, names, tag, real[index]!, head)
      if (file !== null) {
        result.push({ ...worktree, gate: file })
        continue
      }
      const sighting = await this.scanner.lastIn(join(home, 'projects', projectDirName(worktree.path)), { here: real[index]!, worktrees: real })
      result.push({
        ...worktree,
        gate: sighting === null ? { outcome: 'none', source: 'none', at: null } : { outcome: sighting.outcome, source: 'transcript', at: sighting.at || null },
      })
    }
    return result
  }
}
