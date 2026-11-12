// The MCP inventory of Claude Code (worfy-mcp-live ticket 05; spec, Q11): which servers the user has that
// the Profile's list keeps out of a Session. Claude Code does not say: a server its policy tier cut is in
// neither system/init nor mcpServerStatus() of the Session (the spike of ticket 01, F:cut-status-start). So
// main starts a query of its own — the user's settings as a Session reads them, but without the Profile's
// list, without worfy's own servers and without a single message, so no model is called (query.ts,
// sdkInventoryStarter; options.ts, inventoryOptions) — waits until its servers are out of `pending`, reads
// mcpServerStatus() and closes it (F:inventory-status: ~1.8 s, no transcript left).
//
// It runs when a Claude Session with a list starts and when a person opens the list of its servers (the
// Claude driver's handle, session.ts); one at a time per Project of this Machine: a Session in a worktree of
// the Project asks as one in its main checkout does (repositoryRoot, the way main tells a Project by a folder),
// so a Wave of Sessions in N worktrees starts one Claude Code, not N; a second ask while one runs gets the
// running one. It runs in the folder of the Session that asked first. The answer is kept in memory until the next run, never written to disk, never
// logged, and never told to the Autopilot journal or to the Flight recorder: it reaches the person only as
// the rows of the Session (notAllowedRows). A failure is logged by its kind alone, with no server in it.
//
// The query starts the user's servers for those seconds: an stdio server's process runs, then stops with it.
// It lists the claude.ai connectors too (the owner's live fact, the spike of ticket 11). Next to the rows it keeps
// the address of each remote server (`config.url`, mcp-addresses.ts), in memory only: a Session's start takes
// them (addresses), so an allowed remote server, a connector too, goes into its list by its address (ticket 12).
//
// A server the list names that the inventory finds but the Session's own status lacks is a row `not-started`
// (notStartedRows): Claude Code left it out of the Session, and without a row it would be shown nowhere. Its
// reason says whether a Restart helps: a remote server whose address the Session's start did not have yet
// (added after the inventory's answer) starts with the next start; one Claude Code can allow neither by its
// name nor by an address does not.
import { resolve } from 'node:path'
import { repositoryRoot } from '../../mcp/canvas-server'
import type { QueryHandle } from '../../agent/session/types'
import type { McpServerRow } from '../../../shared/agent/mcp-status'
import { mcpServerRowsOf } from '../../../shared/vendors/claude/events'
import { allowableByName, remoteAddressesOf, serverUrlPattern, type McpAddresses } from './mcp-addresses'

/** Starts the query of the inventory in the folder `cwd` with `prompt` as its input: one that never yields a message. */
export type InventoryQueryStarter = (cwd: string, prompt: AsyncIterable<never>) => Promise<QueryHandle>

/** An input that yields no message and ends once `stop` is aborted: no model is ever called through it. */
export function silentInput(stop: AbortSignal): AsyncIterable<never> {
  const ended = new Promise<IteratorResult<never>>((resolve) => {
    const end = (): void => resolve({ done: true, value: undefined })
    if (stop.aborted) end()
    else stop.addEventListener('abort', end, { once: true })
  })
  return { [Symbol.asyncIterator]: () => ({ next: () => ended }) }
}

/** How long the inventory waits for its servers to leave `pending`; then it reads them as they are. */
export const INVENTORY_SETTLE_MS = 10_000
/** How often it asks while one is pending. */
export const INVENTORY_POLL_MS = 250

export interface McpInventoryTiming {
  settleMs: number
  pollMs: number
  /** Past settleMs, how long Claude Code may take to start and answer at all; INVENTORY_ANSWER_MS by default. */
  answerMs?: number
}

/** How long, past INVENTORY_SETTLE_MS, a run waits for Claude Code to start and answer at all. */
export const INVENTORY_ANSWER_MS = 30_000

/** The root of the Project that holds the folder `cwd`; null: none, the folder stands for itself. */
export type ProjectRootOf = (cwd: string) => Promise<string | null>

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** `promise`, or a rejection once the clock passes `limit`. */
function beforeLimit<T>(promise: Promise<T>, limit: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Claude Code did not answer in time')), Math.max(0, limit - Date.now()))
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

export class McpInventory {
  /** The last answer of each Project, as rows; in memory only. */
  private readonly answers = new Map<string, McpServerRow[]>()
  /** The addresses of the remote servers of each Project's last answer, by name; in memory only, never in a row. */
  private readonly found = new Map<string, McpAddresses>()
  /** The run of each Project that has not ended yet. */
  private readonly running = new Map<string, Promise<McpServerRow[] | null>>()
  /** The Project of each folder asked about, once known: what latest() reads. */
  private readonly projects = new Map<string, string>()
  /** The Project of each folder asked about, being found or found. */
  private readonly finding = new Map<string, Promise<string>>()

  constructor(
    private readonly start: InventoryQueryStarter,
    private readonly timing: McpInventoryTiming = { settleMs: INVENTORY_SETTLE_MS, pollMs: INVENTORY_POLL_MS },
    private readonly rootOf: ProjectRootOf = repositoryRoot,
  ) {}

  /** The servers of the user in the Project of the folder `cwd` by the last run that answered; null before any did. */
  latest(cwd: string): readonly McpServerRow[] | null {
    const folder = resolve(cwd)
    return this.answers.get(this.projects.get(folder) ?? folder) ?? null
  }

  /** The addresses of the remote servers in the Project of the folder `cwd` by the last run that answered; null before any did. */
  addresses(cwd: string): McpAddresses | null {
    const folder = resolve(cwd)
    return this.found.get(this.projects.get(folder) ?? folder) ?? null
  }

  /**
   * Runs the inventory of the Project of the folder `cwd`, unless one runs for that Project already: then
   * its run. Settles with the rows (null: the run failed, and the last answer stays); never rejects.
   */
  async refresh(cwd: string): Promise<McpServerRow[] | null> {
    const folder = resolve(cwd)
    const key = await this.projectOf(folder)
    const now = this.running.get(key)
    if (now !== undefined) return now
    const run = this.run(folder, key).finally(() => this.running.delete(key))
    this.running.set(key, run)
    return run
  }

  /**
   * The key of the folder's Project: its root, or the folder itself outside a repository. Only a root found is
   * kept for the next ask: no root (git failed, or the folder is not in a repository yet) is asked again next
   * time (review of #1822), so a hiccup of git does not split a Project's inventory for the app's life.
   */
  private projectOf(folder: string): Promise<string> {
    const known = this.finding.get(folder)
    if (known !== undefined) return known
    const found = this.rootOf(folder).then(
      (root) => (root === null ? null : resolve(root)),
      () => null,
    ).then((root) => {
      this.projects.set(folder, root ?? folder)
      if (root === null && this.finding.get(folder) === found) this.finding.delete(folder)
      return root ?? folder
    })
    this.finding.set(folder, found)
    return found
  }

  private async run(cwd: string, key: string): Promise<McpServerRow[] | null> {
    const stop = new AbortController()
    let query: QueryHandle | null = null
    // A Claude Code that never answers must not hold the Project's inventory for good.
    const limit = Date.now() + this.timing.settleMs + (this.timing.answerMs ?? INVENTORY_ANSWER_MS)
    try {
      const starting = this.start(cwd, silentInput(stop.signal))
      query = await beforeLimit(starting, limit).catch((error: unknown) => {
        // Started after the limit: closed as soon as it comes.
        void starting.then((late) => late.close(), () => undefined)
        throw error
      })
      const status = query.mcpServerStatus
      if (status === undefined) return null
      const asked = query
      let answer: unknown = null
      const read = async (): Promise<McpServerRow[] | null> => mcpServerRowsOf((answer = await beforeLimit(status.call(asked), limit)))
      const until = Date.now() + this.timing.settleMs
      let rows = await read()
      while (rows !== null && rows.some((row) => row.status === 'pending') && Date.now() < until) {
        await delay(this.timing.pollMs)
        rows = await read()
      }
      if (rows !== null) {
        this.answers.set(key, rows)
        this.found.set(key, remoteAddressesOf(answer))
      }
      return rows
    } catch (error) {
      // The kind alone: a message may name the user's servers.
      console.warn(`[agent] the MCP inventory failed: ${error instanceof Error ? error.name : 'an error'}`)
      return null
    } finally {
      stop.abort()
      try {
        query?.close()
      } catch {
        // Closed already.
      }
    }
  }
}

/** What a Session of a list tells the inventory's rows by. */
export interface SessionSet {
  /** The Profile's list the Session's query started with (QueryRequest.mcpListed). */
  listed: readonly string[]
  /** The rows of the Session's own servers. */
  rows: readonly McpServerRow[]
  /** The servers turned off for this Session (Turn off, ticket 03): they are not "not allowed". */
  off: readonly string[]
  /** A person may act on the Session: a server Claude Code did not start offers a Restart. False: an unattended Session. */
  attended?: boolean
  /** The addresses of the remote servers the Session's query started with (QueryRequest.mcpAddresses); null or absent: none. */
  addressesAtStart?: McpAddresses | null
  /** The addresses of the remote servers by the inventory's last answer (McpInventory.addresses); null or absent: none. */
  addressesNow?: McpAddresses | null
}

/** Why a server of the Session's list has no row of the Session's own: what the person reads in its row. */
export const MCP_NOT_STARTED = 'Allowed in this Project, but Claude Code did not start it in this Session.'
/**
 * The reason of a remote server whose address the Session's start did not have (added after the inventory's
 * answer, or its address changed): the next start has it. An attended Session's row says to restart.
 */
export const MCP_NOT_STARTED_FOUND_LATER = 'Found after this Session started: restart the Session to start it.'
/** The same for an unattended Session (Autopilot), whose set of servers is fixed for the Wave: no Restart. */
export const MCP_NOT_STARTED_FOUND_LATER_UNATTENDED = 'Found after this Session started: the next Session starts it.'
/**
 * The reason of a server Claude Code can allow neither by its name (a dot or a space: every claude.ai connector)
 * nor by an address, since the inventory gave none: a Restart would send the same list, so the row offers none.
 */
export const MCP_NOT_ALLOWABLE =
  "Claude Code cannot allow a server by a name with a dot or a space, and it gave no address for this one, so a Session with the Project's list does not start it."

/** The reason and the actions of a row `not-started` of the server `name`. */
function notStartedReason(name: string, session: SessionSet): Pick<McpServerRow, 'error' | 'actions'> {
  const restart = session.attended === true ? ['restart' as const] : []
  const now = session.addressesNow?.get(name)
  const byAddress = now !== undefined && serverUrlPattern(now) !== null
  if (byAddress && session.addressesAtStart?.get(name) !== now) {
    return { error: session.attended === true ? MCP_NOT_STARTED_FOUND_LATER : MCP_NOT_STARTED_FOUND_LATER_UNATTENDED, actions: restart }
  }
  if (!byAddress && !allowableByName(name)) return { error: MCP_NOT_ALLOWABLE, actions: [] }
  return { error: MCP_NOT_STARTED, actions: restart }
}

/**
 * The rows `not-allowed` of the servers of `inventory` that the Session's list keeps out: a server of the
 * user (claude.ai, user config, Project) the list does not name, that the Session neither lists nor turned
 * off. Each offers Allow; its tools, when the inventory knew them, tell what Allow adds to each turn. worfy's
 * own servers and plugins' (source worfy) never are: Allow could not let a plugin's server through
 * (ADR-0048), and worfy's are on the list by default.
 */
export function notAllowedRows(inventory: readonly McpServerRow[] | null, session: SessionSet): McpServerRow[] {
  if (inventory === null) return []
  const known = new Set([...session.listed, ...session.off, ...session.rows.map((row) => row.name)])
  return inventory
    .filter((row) => row.source !== 'worfy' && !known.has(row.name))
    .map((row) => ({ ...row, status: 'not-allowed' as const, error: null, actions: ['allow' as const] }))
}

/**
 * The rows `not-started` of the servers of `inventory` that the Session's list names but that Claude Code
 * left out of the Session's own status: without them such a server would be in neither group of the popover
 * (a remote server added after the inventory's answer the Session started with, a claude.ai connector the
 * inventory gave no address for, or one connected after the process started). An attended Session's row offers a
 * Restart with the same conversation, which starts Claude Code again with the list, unless the server can be
 * allowed neither by its name nor by an address (notStartedReason); worfy's own servers and plugins' never get such a row.
 */
export function notStartedRows(inventory: readonly McpServerRow[] | null, session: SessionSet): McpServerRow[] {
  if (inventory === null) return []
  const listed = new Set(session.listed)
  const known = new Set([...session.off, ...session.rows.map((row) => row.name)])
  return inventory
    .filter((row) => row.source !== 'worfy' && listed.has(row.name) && !known.has(row.name))
    .map((row) => ({ ...row, status: 'not-started' as const, tools: null, ...notStartedReason(row.name, session) }))
}
