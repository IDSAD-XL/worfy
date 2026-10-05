// Reading and writing worfy's own JSON state files (ADR 0005). The stores added from ticket 04
// onward go through this module, so they share the same three rules:
//
// - what is read is parsed with a zod schema, and the caller gets the parsed value, never the raw
//   JSON (keys the schema does not declare are dropped);
// - a write goes to a temporary file in the same directory and is renamed over the target, so a
//   crash mid-write leaves either the old file or the new one, never half of one;
// - a file that cannot be parsed or does not match its schema is not overwritten: it is renamed to
//   `<name>.unreadable-<time>` and the caller starts from an empty state. The user keeps the data
//   to inspect or restore by hand, and the app still starts.
//
// One older store has not moved here yet: src/main/window.ts (ticket 03) reads and writes
// window-state.json itself, with no set-aside of an unreadable file.
//
// The calls are synchronous on purpose: the files are small, the main process reads them on
// startup and on user actions, and a window position has to be saved inside a 'close' handler.
// A synchronous read-modify-write also cannot interleave with another one in the same process.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'

export interface ReadOptions {
  /** Clock for the set-aside file name; tests pass a fixed one. */
  now?: () => Date
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** `2026-10-05T07:08:09.010Z` → `2026-10-05T07-08-09-010Z`: no colons, sorts by time. */
function fileTime(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

/** Renames an unreadable file next to itself under a name that is not taken yet; returns it. */
function setAside(file: string, now: Date): string {
  const base = `${file}.unreadable-${fileTime(now)}`
  let target = base
  for (let n = 1; existsSync(target); n++) target = `${base}-${n}`
  renameSync(file, target)
  return target
}

/**
 * Reads `file` and parses it with `schema`. Returns undefined when the file does not exist, and
 * also when it was unreadable, after setting it aside. Other I/O errors (no permission) throw.
 */
export function readJsonFile<S extends z.ZodType>(file: string, schema: S, options: ReadOptions = {}): z.output<S> | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }

  let problem: string
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    if (parsed.success) return parsed.data
    problem = z.prettifyError(parsed.error)
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error)
  }

  const movedTo = setAside(file, (options.now ?? (() => new Date()))())
  console.warn(`worfy: ${file} could not be read and was moved to ${basename(movedTo)}; starting from an empty state\n${problem}`)
  return undefined
}

let temporaryCounter = 0

/**
 * Parses `value` with `schema` and writes the result to `file` atomically, creating its
 * directory. A value outside the schema throws before anything is written.
 */
export function writeJsonFile<S extends z.ZodType>(file: string, schema: S, value: z.input<S>): void {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`refusing to write ${file}: the value does not match its schema\n${z.prettifyError(parsed.error)}`)
  }

  const directory = dirname(file)
  mkdirSync(directory, { recursive: true })
  // Same directory as the target, so the rename never crosses a file system.
  const temporary = join(directory, `.${basename(file)}.${process.pid}.${temporaryCounter++}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(parsed.data, null, 2)}\n`)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
