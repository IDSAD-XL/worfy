// The `statusLine` command that runs worfy's Limits bridge (worfy-harness tickets 14 and 15,
// worfy-windows tickets 08 and 13). Claude Code pipes its status line JSON to that command; the
// bridge copies `rate_limits` into worfy's data folder and runs the user's own command after it,
// with the same input, passing its output through.
//
// One function builds the command for both places that write it: the move form of the old Harness
// (migrate/plan.ts), which repoints the bridge of another build, and the "Limits from terminal" row
// of the first-run screen on Windows (first-run/checks.ts and actions.ts). The forms:
//
//   macOS    <Resources>/statusline-bridge.sh '<the user's command>'        (the sh entry, ticket 08)
//   Windows  node 'C:/…/resources/statusline-bridge.mjs' '<the user's command>'
//
// Claude Code runs `statusLine` through Git Bash on Windows (its own status line setup agent says
// so, worfy-windows ticket 08), and the bridge runs the user's command through Git Bash too
// (scripts/statusline-bridge.mjs). So both are POSIX shell words: the path with forward slashes and
// the user's command, each in single quotes when it needs quotes, where Git Bash expands nothing —
// in double quotes a `$`, `$(…)` or backtick in the install folder would run.
import { readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/** The sh entry of the bridge, which macOS `statusLine` commands name (electron-builder.yml). */
export const BRIDGE_ENTRY = 'statusline-bridge.sh'
/** The bridge itself, in Node; Windows `statusLine` commands run it with node. */
export const BRIDGE_SCRIPT = 'statusline-bridge.mjs'

/** The bridge file a `statusLine` of this build names: `<resources>/statusline-bridge.mjs` on Windows, the sh entry elsewhere. */
export function bridgeFile(platform: NodeJS.Platform, resourcesPath: string): string {
  return platform === 'win32' ? win32.join(resourcesPath, BRIDGE_SCRIPT) : posix.join(resourcesPath, BRIDGE_ENTRY)
}

/** The first word of a command — a quoted one without its quotes — and the text after it. */
export function splitCommand(command: string): { head: string; rest: string } {
  const text = command.trimStart()
  const quote = text[0]
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1)
    if (end > 0) return { head: text.slice(1, end), rest: text.slice(end + 1) }
  }
  const match = /^\S+/.exec(text)
  const head = match?.[0] ?? ''
  return { head, rest: text.slice(head.length) }
}

/** The last part of a path with either separator. */
const fileName = (path: string): string => path.split(/[\\/]/).at(-1) ?? ''

/**
 * The bridge a status line command runs, and the text after it (its argument, as written); null
 * when it runs no worfy bridge. Both forms count on every system: `<…>/statusline-bridge.sh …` and
 * `node '<…>/statusline-bridge.mjs' …` (the path in double quotes too, as earlier builds wrote it).
 */
export function bridgeOf(command: string): { bridge: string; rest: string } | null {
  const first = splitCommand(command)
  if (fileName(first.head) === BRIDGE_ENTRY) return { bridge: first.head, rest: first.rest }
  if (/^node(?:\.exe)?$/i.test(fileName(first.head))) {
    const second = splitCommand(first.rest)
    if (fileName(second.head) === BRIDGE_SCRIPT) return { bridge: second.head, rest: second.rest }
  }
  return null
}

/** `text` as one POSIX shell word: as it is when it needs no quotes, else in single quotes. */
export function shellWord(text: string): string {
  return /^[\w./+@-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * The `statusLine.command` that runs `bridge` followed by `rest` — the text after the bridge, with
 * its leading space, such as ` 'bash ~/.claude/statusline.sh'`, or '' for none. On Windows
 * `node <bridge>` with forward slashes; elsewhere the entry. The path is a shell word (shellWord):
 * in single quotes when it needs quotes.
 */
export function bridgeCommand(platform: NodeJS.Platform, bridge: string, rest: string): string {
  if (platform === 'win32') return `node ${shellWord(bridge.replace(/\\/g, '/'))}${rest}`
  return `${shellWord(bridge)}${rest}`
}

/**
 * The command that puts `bridge` in front of `current`: a bridge of another build is replaced and
 * its argument kept; any other command becomes the bridge's argument; no command — the bridge
 * alone (it then only copies the Limits and prints nothing).
 */
export function withBridge(platform: NodeJS.Platform, bridge: string, current: string | null): string {
  if (current === null || current.trim() === '') return bridgeCommand(platform, bridge, '')
  const other = bridgeOf(current)
  return bridgeCommand(platform, bridge, other === null ? ` ${shellWord(current)}` : other.rest)
}

/** Whether two paths name one file: on Windows `\` and `/` are one separator and case does not matter. */
export function samePath(platform: NodeJS.Platform, a: string, b: string): boolean {
  if (platform !== 'win32') return posix.normalize(a) === posix.normalize(b)
  return win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase()
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** settings.json with its statusLine command set to `command`; the other keys of statusLine stay. */
export function withStatusLineCommand(settings: Json, command: string): Json {
  return { ...settings, statusLine: isObject(settings.statusLine) ? { ...settings.statusLine, command } : { type: 'command', command } }
}

/** What the "Limits from terminal" row finds in settings.json. */
export type LimitsBridgeState =
  | { kind: 'bridged'; command: string }
  | { kind: 'unavailable'; detail: string; reason: string; current: string | null }
  | { kind: 'offer'; detail: string; current: string | null; command: string }

export interface LimitsBridgeOptions {
  platform: NodeJS.Platform
  /** Claude Code's settings.json. */
  settingsFile: string
  /** The bridge of this build (bridgeFile()); null in a development build. */
  bridge: string | null
  /** Whether a file is there; tests and the check pass existsSync. */
  exists: (path: string) => boolean
}

/** The statusLine command of a settings.json text; null when there is none. Throws on JSON that is no object. */
export function statusLineCommandOf(text: string): string | null {
  const parsed: unknown = JSON.parse(text)
  if (!isObject(parsed)) throw new Error('settings.json holds no JSON object')
  const statusLine = parsed.statusLine
  return isObject(statusLine) && typeof statusLine.command === 'string' ? statusLine.command : null
}

/**
 * Whether `statusLine` of settings.json runs the bridge of this build, and the command that would
 * make it do so. Reads only.
 */
export function limitsBridgeState({ platform, settingsFile, bridge, exists }: LimitsBridgeOptions): LimitsBridgeState {
  let current: string | null = null
  if (exists(settingsFile)) {
    try {
      current = statusLineCommandOf(readFileSync(settingsFile, 'utf8'))
    } catch (error) {
      return { kind: 'unavailable', detail: 'settings.json is not readable', reason: `worfy writes only valid JSON: fix ${settingsFile} first (${error instanceof Error ? error.message : String(error)})`, current: null }
    }
  }
  const found = current === null ? null : bridgeOf(current)
  if (bridge !== null && found !== null && samePath(platform, found.bridge, bridge)) return { kind: 'bridged', command: current ?? '' }
  const detail = current === null ? 'no statusLine in settings.json' : found === null ? 'statusLine does not run the worfy bridge' : 'statusLine runs the bridge of another build'
  if (bridge === null) return { kind: 'unavailable', detail, reason: 'A development build has no bridge of its own: the installed worfy offers it', current }
  if (!exists(bridge)) return { kind: 'unavailable', detail, reason: `This build has no ${bridge}`, current }
  return { kind: 'offer', detail, current, command: withBridge(platform, bridge, current) }
}
