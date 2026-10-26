// The link's journal in a file (worfy-link ticket 36): every `[link]` line worfy prints also goes
// to <dataDir>/link/link.log, next to link/machine.json, on every Machine. When the owner's link
// broke after a change of address there was nothing to read afterwards; now there is.
//
// - What goes in: the lines console.log, info, warn and error print whose text starts with `[link]`,
//   each after the time it was written. The link's modules print through console (or a `warn`
//   option that defaults to it), so one place catches them all, src/main/index.ts's included.
// - Size: when the file would grow past `maxBytes` (1 MiB), it becomes link.log.1, the older ones
//   move up to link.log.<files>, and the oldest goes. At most (files + 1) · maxBytes in all, 4 MiB.
// - Secrets: no token and no pairing code is ever printed (ADR-0052, point 10), and the file
//   checks again: what looks like one is replaced before the line is written (redactSecrets).
// - A file that cannot be written never stops worfy: the journal says so once on the console and
//   writes nothing more.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { removeFile } from '../storage/remove'

export const LINK_LOG_FILE = 'link.log'

export interface LinkLogOptions {
  /** The folder of the file: <dataDir>/link. */
  dir: string
  /** The size at which the file rotates; 1 MiB by default. */
  maxBytes?: number
  /** How many rotated files are kept; 3 by default. */
  files?: number
  now?: () => number
}

/** A Machine id; left as it is, its digits and letters are no secret. */
const MACHINE_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/**
 * The line with everything that may be a secret replaced, Machine ids left alone: a bearer token, a
 * run of 32 or more base64url characters (a device token is 43), and a standalone run of exactly
 * six digits (a pairing code). shortcut: a six-digit number that is no code (a byte count, a pid)
 * is replaced too; when a `[link]` line needs one, mark codes at their source instead.
 */
export function redactSecrets(line: string): string {
  return line
    .split(MACHINE_ID)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, '[redacted]')
            .replace(/(?<!\d)\d{6}(?!\d)/g, '[code]'),
    )
    .join('')
}

export class LinkLogFile {
  private readonly file: string
  private readonly maxBytes: number
  private readonly files: number
  private readonly now: () => number
  private size: number | undefined
  private broken = false

  constructor(private readonly options: LinkLogOptions) {
    this.file = join(options.dir, LINK_LOG_FILE)
    this.maxBytes = options.maxBytes ?? 1024 * 1024
    this.files = options.files ?? 3
    this.now = options.now ?? Date.now
  }

  get path(): string {
    return this.file
  }

  /** Appends one line, with its time, rotating first when it would not fit. */
  write(message: string): void {
    if (this.broken) return
    const line = `${new Date(this.now()).toISOString()} ${redactSecrets(message.replace(/\r?\n/g, ' | '))}\n`
    const bytes = Buffer.byteLength(line)
    try {
      if (this.size === undefined) {
        mkdirSync(this.options.dir, { recursive: true })
        this.size = sizeOf(this.file)
      }
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate()
      appendFileSync(this.file, line, { mode: 0o600 })
      this.size += bytes
    } catch (error) {
      // Set first: the warning below goes through the tee, which must find the journal stopped.
      this.broken = true
      console.warn(`[worfy] the link journal ${this.file} cannot be written, it stops: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private rotate(): void {
    removeFile(`${this.file}.${this.files}`)
    for (let index = this.files - 1; index >= 1; index -= 1) {
      const from = `${this.file}.${index}`
      if (exists(from)) renameSync(from, `${this.file}.${index + 1}`)
    }
    renameSync(this.file, `${this.file}.1`)
    this.size = 0
  }
}

function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

const METHODS = ['log', 'info', 'warn', 'error'] as const

/**
 * Copies every `[link]` line printed through console into `log`, the console still printing it.
 * Returns the undo. Called once by the app's link (service.ts, startAppLink).
 */
export function teeLinkConsole(log: Pick<LinkLogFile, 'write'>): () => void {
  const saved = METHODS.map((method) => [method, console[method]] as const)
  for (const [method, print] of saved) {
    console[method] = (...args: unknown[]): void => {
      print.apply(console, args)
      if (typeof args[0] === 'string' && args[0].startsWith('[link]')) log.write(format(...args))
    }
  }
  return () => {
    for (const [method, print] of saved) console[method] = print
  }
}
