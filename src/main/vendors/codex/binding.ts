// The signals of Bindings (ticket 16) of a Codex Session (worfy-multi-vendor ticket 41). Codex keeps no
// transcript file worfy could tail (ticket 05): a thread's events come from the history part of the
// Codex driver (history.ts, `thread/read`), and each command it ran goes through the same pure parser
// as a Claude transcript's Bash command (src/shared/binding/signals.ts, claimIn).
//
// - claim: the last `ticket claim <epic> <NN>` among the thread's commands;
// - cwd: the folder of its last command, else the thread's own folder (a worktree `.claude/worktrees/<NN>`
//   binds by the worktree rule);
// - gitBranch: the branch checked out in that folder now, read from git's files (gitBranch of
//   src/main/terminal-ai/git-branch.ts). Codex records no branch per item, only the one the thread
//   started on (Thread.gitInfo), which the history part does not give and which a Session that made its
//   worktree later never had; a folder that is gone gives none.
// - skill and task: none. The Harness skills are not installed in Codex yet, and a Codex Subagent is a
//   thread of its own. An edit of a Ticket's file binds nothing, as for Claude: an Orchestrator edits
//   many of them.
//
// Only new turns are folded: the events already read of a thread are counted, and Codex is asked again
// only when the last list of the Project's Codex Sessions (sessions-on-canvas.ts) shows the thread
// changed. A thread that list does not name is not a Codex Session of the Project: null. worfy writes
// nothing into CODEX_HOME or the folder (ADR-0005).
import { EMPTY_AGENT_SIGNALS, BRANCH_MAX, PATH_MAX, type AgentSignals } from '../../../shared/binding/resolve'
import { claimIn } from '../../../shared/binding/signals'
import type { TranscriptEntry } from '../../../shared/transcript/parse'
import { gitBranch } from '../../terminal-ai/git-branch'
import type { HistoryPart, HistorySession } from '../history'
import { codexHistory } from './history'
import type { CodexSessions } from './sessions-on-canvas'

/** The tool name a Codex command gets as an event (items.ts, toolUse). */
const COMMAND_TOOL = 'commandExecution'

const cap = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value)
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What the events of a thread say so far: the last claim and the folder of the last command. */
export interface CodexSignalState {
  claim: AgentSignals['claim']
  /** The folder of the last command; null before the first one. */
  commandCwd: string | null
}

export const emptyCodexSignalState = (): CodexSignalState => ({ claim: null, commandCwd: null })

/** Folds a thread's transcript entries (in order) into the state. Pure; what it does not know is skipped. */
export function extendCodexSignals(state: CodexSignalState, entries: readonly TranscriptEntry[]): CodexSignalState {
  let { claim, commandCwd } = state
  for (const { event } of entries) {
    if (event.type !== 'tool_use' || event.name !== COMMAND_TOOL || !isObject(event.input)) continue
    const { command, cwd } = event.input
    if (typeof command === 'string') claim = claimIn(command) ?? claim
    if (typeof cwd === 'string' && cwd !== '') commandCwd = cwd
  }
  return { claim, commandCwd }
}

export interface CodexBindingOptions {
  /** The history part of the Codex driver: `read(id, cwd)` gives a thread's transcript. */
  history: Pick<HistoryPart, 'read'>
  /** The Project's Codex Sessions as their last list found them (never asks Codex itself). */
  sessions: Pick<CodexSessions, 'cached'>
  /** The branch checked out in a folder; null when none. gitBranch() by default. */
  branch?: (cwd: string) => Promise<string | null>
  log?: (message: string, cause: unknown) => void
}

interface Known {
  /** The thread's `updatedAt` when it was last read; undefined before a read succeeded. */
  updatedAt: number | null | undefined
  /** How many entries of its transcript are folded. */
  count: number
  state: CodexSignalState
  reading?: Promise<CodexSignalState>
}

/** Keeps what was read of each thread, so asking again reads Codex only after the thread changed. */
export class CodexBindingSignals {
  private readonly known = new Map<string, Known>()
  private readonly branch: (cwd: string) => Promise<string | null>
  private readonly log: (message: string, cause: unknown) => void

  constructor(private readonly options: CodexBindingOptions) {
    this.branch = options.branch ?? ((cwd) => gitBranch(cwd))
    this.log = options.log ?? ((message, cause) => console.warn(message, cause))
  }

  /** The signals of the Codex Session `id` of the Project at `root`; null when it is not one. */
  async session(root: string, id: string): Promise<AgentSignals | null> {
    const thread = this.options.sessions.cached(root).find((each) => each.id === id)
    if (thread === undefined) return null
    const state = await this.state(thread, root)
    const cwd = state.commandCwd ?? thread.cwd
    const branch = cwd === null ? null : await this.branch(cwd).catch(() => null)
    return {
      ...EMPTY_AGENT_SIGNALS,
      claim: state.claim,
      cwd: cwd === null ? null : cap(cwd, PATH_MAX),
      gitBranch: branch === null || branch === '' ? null : cap(branch, BRANCH_MAX),
    }
  }

  /** The thread's folded state, read again only when its `updatedAt` moved since the last read. */
  private async state(thread: HistorySession, root: string): Promise<CodexSignalState> {
    const known = this.known.get(thread.id)
    if (known !== undefined) {
      if (known.reading !== undefined) return known.reading
      if (known.updatedAt === thread.updatedAt) return known.state
    }
    const entry: Known = known ?? { updatedAt: undefined, count: 0, state: emptyCodexSignalState() }
    this.known.set(thread.id, entry)
    entry.reading = this.read(thread, root, entry).finally(() => {
      entry.reading = undefined
    })
    return entry.reading
  }

  private async read(thread: HistorySession, root: string, entry: Known): Promise<CodexSignalState> {
    let entries: TranscriptEntry[]
    try {
      entries = await this.options.history.read(thread.id, thread.cwd ?? root)
    } catch (error) {
      // What was read before stays; the next ask tries again (updatedAt is left as it was).
      this.log(`[codex] could not read the thread ${thread.id} for its Binding`, error)
      return entry.state
    }
    // A thread with fewer events than were folded is not the one read before: it starts over.
    const from = entries.length < entry.count ? 0 : entry.count
    const base = from === 0 ? emptyCodexSignalState() : entry.state
    entry.state = extendCodexSignals(base, entries.slice(from))
    entry.count = entries.length
    entry.updatedAt = thread.updatedAt
    return entry.state
  }
}

let app: CodexBindingSignals | undefined

/** The app's reader of Codex Binding signals over the app's Codex Sessions (`sessions`, appCodexSessions). */
export function appCodexBindingSignals(sessions: Pick<CodexSessions, 'cached'>): CodexBindingSignals {
  app ??= new CodexBindingSignals({ history: codexHistory, sessions })
  return app
}
