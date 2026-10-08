// The secrets of the link (ADR-0052, point 4): the private key of this Machine and the outgoing
// tokens, those this Machine presents to its Linked machines. Both are needed as they are, so they
// cannot be stored as hashes; the incoming tokens, those this Machine issued, are kept in store.ts
// as SHA-256 hashes only.
//
// Where: a JSON file in worfy's data folder, link/secrets.json, readable by the owner only (0600, in
// a 0700 folder) — the way ssh keeps its keys. Not Electron's safeStorage: on macOS it keeps its key
// in the Keychain under the app's code signature, and worfy's ad-hoc signature (electron-builder.yml)
// changes with every build, so the Keychain would ask for access after each update of the stable
// copy; tests and CI have no safeStorage at all. The choice sits behind SecretStore, so a store over
// safeStorage (or DPAPI on Windows) replaces this one without touching the rest of the link.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'

/** A key-value store of secret strings. Keys name what the secret is (`machine-key`, `outgoing:<id>`). */
export interface SecretStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
}

const secretsSchema = z.object({ version: z.literal(1), secrets: z.record(z.string(), z.string()) })

/** File mode of the secrets file and of its folder. */
export const SECRET_FILE_MODE = 0o600
export const SECRET_DIR_MODE = 0o700

let temporaryCounter = 0

/**
 * Reads the secrets file. Not through json-file.ts: its message on an unreadable file quotes the
 * parser's error, and V8's JSON errors quote the text, which here is a secret. A file that cannot
 * be read as secrets is set aside under `<name>.unreadable-<time>` with a message that names the
 * file only, and the store starts empty.
 */
function readSecrets(file: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    throw new Error(`could not read the link secrets file ${file}: ${error instanceof Error && 'code' in error ? String(error.code) : 'read failed'}`, { cause: error })
  }
  let parsed: z.output<typeof secretsSchema> | undefined
  try {
    const result = secretsSchema.safeParse(JSON.parse(text))
    if (result.success) parsed = result.data
  } catch {
    parsed = undefined
  }
  if (parsed !== undefined) return { ...parsed.secrets }
  const base = `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`
  let target = base
  for (let n = 1; existsSync(target); n++) target = `${base}-${n}`
  renameSync(file, target)
  console.warn(`[link] ${file} could not be read and was moved to ${basename(target)}; the link secrets start empty`)
  return {}
}

/** The secrets file in `file`, 0600; read once, then kept in memory and written whole on each change. */
export class FileSecretStore implements SecretStore {
  private cache: Record<string, string> | undefined

  constructor(private readonly file: string) {}

  private load(): Record<string, string> {
    this.cache ??= readSecrets(this.file)
    return this.cache
  }

  get(key: string): string | undefined {
    return this.load()[key]
  }

  set(key: string, value: string): void {
    const next = { ...this.load(), [key]: value }
    this.write(next)
    this.cache = next
  }

  delete(key: string): void {
    const current = this.load()
    if (!(key in current)) return
    const next = { ...current }
    delete next[key]
    this.write(next)
    this.cache = next
  }

  /** Atomic write, like json-file.ts, but the temporary file is created 0600, so no moment exposes it. */
  private write(secrets: Record<string, string>): void {
    const directory = dirname(this.file)
    mkdirSync(directory, { recursive: true, mode: SECRET_DIR_MODE })
    chmodSync(directory, SECRET_DIR_MODE)
    const temporary = join(directory, `.${basename(this.file)}.${process.pid}.${temporaryCounter++}.tmp`)
    try {
      writeFileSync(temporary, `${JSON.stringify({ version: 1, secrets }, null, 2)}\n`, { mode: SECRET_FILE_MODE })
      chmodSync(temporary, SECRET_FILE_MODE)
      renameSync(temporary, this.file)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new Error(`could not write the link secrets file ${this.file}: ${error instanceof Error && 'code' in error ? String(error.code) : 'write failed'}`, { cause: error })
    }
  }
}
