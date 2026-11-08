// Removing a plugin worfy installed as a dependency of an older Harness, once this one no longer
// needs it (worfy-skills ticket 03; spec "Removing a plugin worfy installed", owner's answer Q5).
//
// Up to worfy-skills 03 the Harness declared `mattpocock-skills@claude-plugins-official`, and the
// installer put it in before the plugin `worfy` (ADR-0059, point 4). Its skills now ship inside the
// plugin `worfy`, so the dependency is gone, and a copy worfy put in would show every skill twice.
// worfy removes such a plugin only when worfy installed it, never one the user installed:
// - worfy's own record says so: from this version on each dependency install worfy runs, in Claude
//   Code and in Codex, is recorded in worfy's data folder (`harness-dependencies.json`, next to
//   `harness-codex.json`) with its id, Vendor and time; or, for an install made before that record,
// - the Vendor's install time says so: the plugin was installed at most 10 minutes before the plugin
//   `worfy@worfy-harness`, and before it, as the installer did in one run (dependency first). Claude
//   Code lists `installedAt` of every plugin in `claude plugin list --json` (Claude Code 2.1.289,
//   the SDK's binary); Codex 0.166.0 lists no install time for a plugin of a local marketplace, so
//   there the record alone decides.
// A record whose plugin is gone, or was installed again later than the record (the user removed
// worfy's copy and installed their own), is stale: it is dropped and decides nothing.
// A plugin that is not listed, or whose time or worfy's is missing or does not read, stays. So does
// a retired id the build's plugin.json names again. It runs only after the Harness of this build is
// in place by an update of an installed `worfy` (the install after Update and Update Harness in the
// toolbar), never on a first install: the caller (install.ts, codex-install.ts) decides that. The
// marketplace stays: other plugins of the user may come from it. A failed removal is a line of the
// result; the Harness stays installed, and the next Update tries again.
import { z } from 'zod'
import type { HarnessCleanup, HarnessVendor } from '../../shared/ipc/harness'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

/** Dependencies an older Harness declared and this one does not: the only plugins this module may remove. */
export const RETIRED_DEPENDENCIES: readonly string[] = ['mattpocock-skills@claude-plugins-official']

/** How long before `worfy@worfy-harness` a dependency without worfy's record may have been installed and still count as worfy's. */
export const INSTALL_WINDOW_MS = 10 * 60_000

/** The file of worfy's record in its data folder (dataRoot()). */
export const DEPENDENCY_RECORD_FILE = 'harness-dependencies.json'

const recordSchema = z.object({
  installs: z.array(z.object({ id: z.string(), vendor: z.enum(['claude', 'codex']), at: z.string() })),
})
export type DependencyInstall = z.infer<typeof recordSchema>['installs'][number]

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** worfy's record of its own dependency installs; none when the file is missing or does not read (a file that does not read is set aside). */
export function readDependencyInstalls(file: string): DependencyInstall[] {
  try {
    return readJsonFile(file, recordSchema)?.installs ?? []
  } catch (error) {
    console.warn(`[harness] worfy's record of its dependency installs ${file} could not be read: ${messageOf(error)}`)
    return []
  }
}

function writeInstalls(file: string, installs: DependencyInstall[]): void {
  try {
    writeJsonFile(file, recordSchema, { installs })
  } catch (error) {
    console.warn(`[harness] worfy's record of its dependency installs ${file} could not be written: ${messageOf(error)}`)
  }
}

/** Records that worfy installed `id` into `vendor` now. A failure is a warning: the install itself went in. */
export function recordDependencyInstall(file: string, id: string, vendor: HarnessVendor, now: Date = new Date()): void {
  const kept = readDependencyInstalls(file).filter((each) => !(each.id === id && each.vendor === vendor))
  writeInstalls(file, [...kept, { id, vendor, at: now.toISOString() }])
}

function forgetDependencyInstall(file: string, id: string, vendor: HarnessVendor): void {
  const installs = readDependencyInstalls(file)
  const kept = installs.filter((each) => !(each.id === id && each.vendor === vendor))
  if (kept.length !== installs.length) writeInstalls(file, kept)
}

/** A plugin as a Vendor lists it: when it was installed, in ms since the epoch; null when the Vendor names no time or one that does not read. */
export interface ListedInstall {
  installedAt: number | null
}

/**
 * An install time as a Vendor gives it: an ISO 8601 string (Claude Code's `installedAt`) or a Unix
 * time in seconds (Codex's `installedAt`); null for anything else, a time that does not read included.
 */
export function installTimeOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value * 1000 : null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/**
 * The user-scope plugins of `claude plugin list --json` with their install time. An entry of another
 * scope does not count; an id listed twice in the user scope has no time worfy could trust.
 */
export function claudeInstallsOf(parsed: unknown): Map<string, ListedInstall> | null {
  if (!Array.isArray(parsed)) return null
  const installs = new Map<string, ListedInstall>()
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { id, scope, installedAt } = item as { id?: unknown; scope?: unknown; installedAt?: unknown }
    if (typeof id !== 'string' || (scope !== undefined && scope !== 'user')) continue
    installs.set(id, { installedAt: installs.has(id) ? null : installTimeOf(installedAt) })
  }
  return installs
}

/** How much later than worfy's record the Vendor's install time may be and still be that install (the record is written as the command ends). */
export const RECORD_SLACK_MS = 60_000

/**
 * Whether worfy's record still describes the plugin the Vendor lists: no install time to compare
 * (Codex), or one no later than the record (plus RECORD_SLACK_MS). A later one means the plugin was
 * installed again after worfy's install — by the user, after removing worfy's copy — so the record
 * is stale. A record whose time does not read describes nothing.
 */
export function recordHolds(record: DependencyInstall, entry: ListedInstall): boolean {
  const recorded = installTimeOf(record.at)
  if (recorded === null) return false
  return entry.installedAt === null || entry.installedAt <= recorded + RECORD_SLACK_MS
}

/**
 * Whether worfy installed `id` in `vendor`, by its record (recordHolds) or by the window before
 * `harness`: `record`, `window`, or null — not listed, or nothing says worfy installed it.
 */
export function installedByWorfy(
  id: string,
  vendor: HarnessVendor,
  listed: ReadonlyMap<string, ListedInstall>,
  records: readonly DependencyInstall[],
  harness: string,
): 'record' | 'window' | null {
  const entry = listed.get(id)
  if (entry === undefined) return null
  if (records.some((each) => each.id === id && each.vendor === vendor && recordHolds(each, entry))) return 'record'
  const dependency = entry.installedAt
  const worfy = listed.get(harness)?.installedAt ?? null
  if (dependency === null || worfy === null) return null
  // Strictly before: the installer ran the dependency's install first, and a time equal to worfy's is
  // what a tool that rewrote every record at once would leave, not proof of that order.
  return dependency < worfy && worfy - dependency <= INSTALL_WINDOW_MS ? 'window' : null
}

const PRODUCT: Record<HarnessVendor, string> = { claude: 'Claude Code', codex: 'Codex' }

/** The command that puts a removed plugin back. */
export function reinstallCommand(id: string, vendor: HarnessVendor): string {
  return vendor === 'claude' ? `claude plugin install ${id} --scope user` : `codex plugin add ${id}`
}

export interface RetireOptions {
  vendor: HarnessVendor
  /** The id of the plugin `worfy` as the Vendor lists it. */
  harness: string
  /** The plugins the Vendor lists, with their install time; rejects when it cannot say. */
  list: () => Promise<ReadonlyMap<string, ListedInstall>>
  /** Removes one plugin from the Vendor's user scope; rejects with the command and the tail of its output. */
  remove: (id: string) => Promise<void>
  /** The dependencies the build's plugin.json names: never removed. */
  needed: readonly string[]
  /** worfy's record (DEPENDENCY_RECORD_FILE); without it only the window decides. */
  recordFile?: string | undefined
  /** The ids that may be removed; RETIRED_DEPENDENCIES by default. */
  retired?: readonly string[]
  /**
   * The ids a list read before the install named, when there was one: without a candidate among them
   * the Vendor is not asked again, as an update does not install a retired plugin.
   */
  listedBefore?: ReadonlySet<string>
}

/**
 * Removes each retired dependency worfy installed into the Vendor (installedByWorfy) and returns a
 * line for each removal and each failed one. A list that cannot be read removes nothing.
 */
export async function retireDependencies({ vendor, harness, list, remove, needed, recordFile, retired = RETIRED_DEPENDENCIES, listedBefore }: RetireOptions): Promise<HarnessCleanup[]> {
  const retiredHere = retired.filter((id) => !needed.includes(id))
  // worfy's record of a plugin the list before the install did not name is stale: the plugin is gone.
  if (recordFile !== undefined && listedBefore !== undefined) for (const id of retiredHere.filter((each) => !listedBefore.has(each))) forgetDependencyInstall(recordFile, id, vendor)
  const candidates = retiredHere.filter((id) => listedBefore === undefined || listedBefore.has(id))
  if (candidates.length === 0) return []
  let listed: ReadonlyMap<string, ListedInstall>
  try {
    listed = await list()
  } catch (error) {
    console.warn(`[harness] worfy could not tell whether it installed ${candidates.join(', ')} in ${PRODUCT[vendor]}, so it leaves it: ${messageOf(error)}`)
    return []
  }
  const records = recordFile === undefined ? [] : readDependencyInstalls(recordFile)
  const lines: HarnessCleanup[] = []
  for (const id of candidates) {
    // A record that no longer describes a listed plugin — the plugin is gone, or installed again later — is dropped.
    const record = records.find((each) => each.id === id && each.vendor === vendor)
    const entry = listed.get(id)
    if (recordFile !== undefined && record !== undefined && (entry === undefined || !recordHolds(record, entry))) forgetDependencyInstall(recordFile, id, vendor)
    if (installedByWorfy(id, vendor, listed, records, harness) === null) continue
    try {
      await remove(id)
    } catch (error) {
      lines.push({
        vendor,
        id,
        outcome: 'failed',
        text: `worfy could not remove ${id} from ${PRODUCT[vendor]} (an older Harness had worfy install it; this one carries its skills itself). The Harness is installed; the next Update tries again.\n${messageOf(error)}`,
      })
      continue
    }
    if (recordFile !== undefined) forgetDependencyInstall(recordFile, id, vendor)
    lines.push({
      vendor,
      id,
      outcome: 'removed',
      text: `worfy removed ${id} from ${PRODUCT[vendor]}: an older Harness had worfy install it, and this one carries its skills itself. To get it back: ${reinstallCommand(id, vendor)}`,
    })
  }
  return lines
}
