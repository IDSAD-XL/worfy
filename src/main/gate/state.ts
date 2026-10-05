// The gate's verdict on each worktree of a Project, read from what gate.sh leaves behind
// (~/.claude/hooks/gate.sh; WORFY_CLAUDE_HOME stands for ~/.claude in tests):
//
// - markers in <home>/gate/state/: `red-<key>-<tag>` (red) and `unverified-<key>-<tag>` (could not
//   verify), where `tag` is the first 8 hex digits of SHA-1 of the worktree path (gate.sh:
//   `printf '%s' "$repo" | shasum | cut -c1-8`) and `key` is the entry of <home>/gate/config.json
//   whose `match` is the longest prefix of the repository root (gate-resolve.mjs --which);
// - without a marker, the last `[gate] зелено | красно | ничего не прогналось | ПРОВЕРИТЬ НЕ УДАЛОСЬ`
//   line in the transcripts of the Sessions started in that worktree: the output of a Bash call
//   that ran gate.sh in that worktree, and hook output. The output of other commands (the gate's
//   own tests, `tail` of an old log, gate.sh after `cd` to another repository) and a line the user
//   or the model wrote (a prompt, a brief, a reply) do not count.
//
// «Ничего не прогналось» is «нет данных», never green. Nothing here writes: the state folder and
// the transcripts are only listed and read, git only lists worktrees.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { GateOutcome, GateState } from '../../shared/ipc/checks'
import { projectDirName } from '../claude-home/registry'
import { readNewLines, type TailCursor } from '../claude-home/tail'

const run = promisify(execFile)
const realpathNative = promisify(realpath.native)

/** gate.sh's per-worktree tag: the first 8 hex digits of SHA-1 of the path, as `shasum` prints it. */
export function gateTag(path: string): string {
  return createHash('sha1').update(path, 'utf8').digest('hex').slice(0, 8)
}

// ── which entry of gate/config.json ─────────────────────────────────────────

const configSchema = z.object({ repos: z.array(z.object({ key: z.string().min(1), match: z.string().min(1) }).loose()) }).loose()
export type GateConfig = z.infer<typeof configSchema>

/** <home>/gate/config.json, or null when it is missing or not the gate's format. */
export async function readGateConfig(home: string): Promise<GateConfig | null> {
  try {
    const parsed = configSchema.safeParse(JSON.parse(await readFile(join(home, 'gate', 'config.json'), 'utf8')))
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
 * The gate key of a repository, as gate-resolve.mjs --which picks it: the entry whose `match` is
 * the root itself or a folder above it, the longest such `match` winning. Letter case of `match`
 * follows the disk the way the gate's resolver does it.
 */
export async function gateKey(config: GateConfig | null, root: string): Promise<string | null> {
  if (config === null) return null
  const target = await onDisk(root)
  let best: { key: string; length: number } | null = null
  for (const repo of config.repos) {
    const native = await onDisk(repo.match)
    const match = native.toLowerCase() === repo.match.toLowerCase() ? native : repo.match
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

async function listState(home: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(join(home, 'gate', 'state')))
  } catch {
    return new Set()
  }
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The text of a tool result's `content`: a string or a list of text blocks. */
function toolResultText(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.filter(isRecord).flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
}

/** `gate.sh` as a word of a command: `~/.claude/hooks/gate.sh fast`, not `gate-unregistered.test.sh`. */
const GATE_SH = /(?:^|[\s;&|(/'"`])gate\.sh(?=$|[\s;&|)<>'"`])/gu
/** A `cd` or `pushd` at the start of a shell command, with its argument if it has one. */
const CD = /(?:^|[;&|({\n'"]|\b(?:then|do|else))\s*(?:cd|pushd)(?:[ \t]+("[^"]*"|'[^']*'|[^\s;&|)]+))?(?=$|[\s;&|)])/gu

/** Where `cd <arg>` from `from` leads; null when the shell would have to expand something to tell. */
function cdTarget(from: string, arg: string | undefined): string | null {
  if (arg === undefined) return homedir()
  let path: string
  if (arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2) path = arg.slice(1, -1)
  else {
    const quoted = arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2
    path = quoted ? arg.slice(1, -1) : arg
    path = path.replace(quoted ? /^(?:\$HOME|\$\{HOME\})(?=\/|$)/u : /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/u, homedir())
    if (/[$`*?~]/u.test(path)) return null
  }
  if (path === '-' || path === '') return null
  if (path.startsWith('/')) return resolve(path)
  return from === '' ? null : resolve(from, path)
}

/**
 * Where a Bash command ran gate.sh: undefined when it does not run gate.sh at all; else the folder
 * of the last `cd` before the last gate.sh (relative to `cwd`, the Session's folder at that
 * moment), `cwd` when there is no `cd`, '' when the record names no folder and the command has no
 * `cd` (then it is the Session's own), and null when the folder cannot be told without running a
 * shell (`cd "$W"`, `popd`, a relative `cd` with no `cwd`).
 */
export function gateRunDir(command: string, cwd: string | null): string | null | undefined {
  let end = -1
  for (const match of command.matchAll(GATE_SH)) end = match.index + match[0].length
  if (end < 0) return undefined
  const before = command.slice(0, end)
  if (/(?:^|[\s;&|(])popd\b/u.test(before)) return null
  let dir: string | null = cwd ?? ''
  for (const match of before.matchAll(CD)) {
    dir = cdTarget(dir, match[1])
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

const recordCwd = (record: Record<string, unknown>): string | null => (typeof record.cwd === 'string' && record.cwd.startsWith('/') ? record.cwd : null)

/**
 * The gate output in one transcript record: the result of a Bash call that ran gate.sh, and hook
 * output. `gateCalls` maps the ids of tool calls that ran gate.sh to their folder; this record's
 * tool calls are added to it and its results taken out. The result of any other tool call does not
 * count, though it may print gate lines (the gate's own tests, `tail` of an old log), and neither
 * do prompts, briefs, task notifications and the model's own text: they quote gate lines without
 * having run the gate.
 */
export function gateOutputs(record: unknown, gateCalls: Map<string, string | null>): GateOutput[] {
  if (!isRecord(record)) return []
  if (record.type === 'assistant' && isRecord(record.message) && Array.isArray(record.message.content)) {
    for (const block of record.message.content.filter(isRecord)) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string' || !isRecord(block.input) || typeof block.input.command !== 'string') continue
      const dir = gateRunDir(block.input.command, recordCwd(record))
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
  const dir = recordCwd(record) ?? ''
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
  /** Tool calls that ran gate.sh and have no result yet, by id, with their folder. */
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

const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`)

/** Whether a gate run in `dir` was about the worktree `place.here`: it is the deepest worktree holding `dir`. */
async function isAbout(dir: string, place: GatePlace): Promise<boolean> {
  if (dir === '') return true
  const real = await onDisk(dir)
  let owner: string | null = null
  for (const worktree of place.worktrees) {
    if (inside(real, worktree) && (owner === null || worktree.length > owner.length)) owner = worktree
  }
  return owner === place.here
}

/**
 * Finds the last gate verdict about a worktree in the transcripts of a folder under
 * <home>/projects/, reading each file only past what it read before: transcripts are append-only
 * and can be large. A truncated or replaced file is read again from the start.
 */
export class TranscriptGateScanner {
  private readonly files = new Map<string, FileScan>()

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
        if ((latest === null || sighting.seq > latest.seq) && (await isAbout(dir, place))) latest = sighting
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
        if (!line.includes('[gate]') && !line.includes('gate.sh')) continue
        let record: unknown
        try {
          record = JSON.parse(line)
        } catch {
          continue
        }
        for (const { text, dir } of gateOutputs(record, scan.gateCalls)) {
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
      result.push({ path, branch: ref ? ref.replace(/^refs\/heads\//, '') : null })
    }
    return result.length ? result : [{ path: root, branch: null }]
  } catch {
    return [{ path: root, branch: null }]
  }
}

// ── all together ─────────────────────────────────────────────────────────────

export interface GateReaderOptions {
  /** The Claude home (src/main/storage/paths.ts, claudeHome()). */
  home: string
}

/** Reads the gate state of a Project's worktrees; keeps what it learned of transcripts between reads. */
export class GateReader {
  private readonly scanner = new TranscriptGateScanner()

  constructor(private readonly options: GateReaderOptions) {}

  async read(root: string, worktrees: readonly Worktree[]): Promise<(Worktree & { gate: GateState })[]> {
    const { home } = this.options
    const key = await gateKey(await readGateConfig(home), root)
    const names = await listState(home)
    const real = await Promise.all(worktrees.map((worktree) => onDisk(worktree.path)))
    const result: (Worktree & { gate: GateState })[] = []
    for (const [index, worktree] of worktrees.entries()) {
      const marker = key === null ? null : markerOutcome(names, key, gateTag(real[index]!))
      if (marker !== null) {
        result.push({ ...worktree, gate: { outcome: marker, source: 'marker', at: null } })
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
