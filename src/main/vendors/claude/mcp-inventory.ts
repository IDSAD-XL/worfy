// The MCP inventory of Claude Code (worfy-mcp-live ticket 05; spec, Q11): which servers the user has that
// the Profile's list keeps out of a Session. Claude Code does not say: a server its policy tier cut is in
// neither system/init nor mcpServerStatus() of the Session (the spike of ticket 01, F:cut-status-start). So
// main starts a query of its own — the user's settings as a Session reads them, but without the Profile's
// list, without worfy's own servers and without a single message, so no model is called (query.ts,
// sdkInventoryStarter; options.ts, inventoryOptions) — waits until its servers are out of `pending`, reads
// mcpServerStatus() and closes it (F:inventory-status: ~1.8 s, no transcript left).
//
// It runs when a Claude Session with a list starts and when a person opens the list of its servers (the
// Claude driver's handle, session.ts); one at a time per folder of this Machine: a second ask while one runs
// gets the running one. The answer is kept in memory until the next run, never written to disk, never
// logged, and never told to the Autopilot journal or to the Flight recorder: it reaches the person only as
// the rows of the Session (notAllowedRows). A failure is logged by its kind alone, with no server in it.
//
// The query starts the user's servers for those seconds: an stdio server's process runs, then stops with it.
// Whether it lists the claude.ai connectors waits for the owner's live check (spike-mcp-live.md); without them
// the person types a connector's name into the list in Project settings (McpChip.tsx says so).
import { resolve } from 'node:path'
import type { QueryHandle } from '../../agent/session/types'
import type { McpServerRow } from '../../../shared/agent/mcp-status'
import { mcpServerRowsOf } from '../../../shared/vendors/claude/events'

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
  /** The last answer of each folder, as rows; in memory only. */
  private readonly answers = new Map<string, McpServerRow[]>()
  /** The run of each folder that has not ended yet. */
  private readonly running = new Map<string, Promise<McpServerRow[] | null>>()

  constructor(
    private readonly start: InventoryQueryStarter,
    private readonly timing: McpInventoryTiming = { settleMs: INVENTORY_SETTLE_MS, pollMs: INVENTORY_POLL_MS },
  ) {}

  /** The servers of the user in the folder `cwd` by the last run that answered; null before any did. */
  latest(cwd: string): readonly McpServerRow[] | null {
    return this.answers.get(resolve(cwd)) ?? null
  }

  /**
   * Runs the inventory in the folder `cwd`, unless one runs there already: then its run. Settles with the
   * rows (null: the run failed, and the last answer stays); never rejects.
   */
  refresh(cwd: string): Promise<McpServerRow[] | null> {
    const key = resolve(cwd)
    const now = this.running.get(key)
    if (now !== undefined) return now
    const run = this.run(key).finally(() => this.running.delete(key))
    this.running.set(key, run)
    return run
  }

  private async run(cwd: string): Promise<McpServerRow[] | null> {
    const stop = new AbortController()
    let query: QueryHandle | null = null
    // A Claude Code that never answers must not hold the folder's inventory for good.
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
      const read = async (): Promise<McpServerRow[] | null> => mcpServerRowsOf(await beforeLimit(status.call(asked), limit))
      const until = Date.now() + this.timing.settleMs
      let rows = await read()
      while (rows !== null && rows.some((row) => row.status === 'pending') && Date.now() < until) {
        await delay(this.timing.pollMs)
        rows = await read()
      }
      if (rows !== null) this.answers.set(cwd, rows)
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
