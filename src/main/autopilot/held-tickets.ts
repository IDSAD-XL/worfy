// The Tickets a continued Run leaves to a person (worfy-continuity ticket 06, Q4 (a) of the Epic's spec): those of the
// cut-off Wave whose implementer has an external call without a result — a `git push` or a `gh pr merge` that may or
// may not have run. Read once, before the Run goes on and before its Orchestrator is started again: Claude Code adds
// its own "Tool call interrupted" result to a cut call only when the session is resumed (spike 01 of the Epic, its result, item 6).
//
// The reading is unknownSideEffects of ticket 16 (src/shared/agent/unknown-side-effects.ts) over the transcript of the
// Orchestrator's session the cut-off Wave went to (`session` of its `wave-started`): the events of its last turn — the
// Wave's — and the files of its Subagents, each bound to its Ticket as the canvas binds it. A Subagent bound to a Ticket
// of the Wave holds that Ticket; one bound to another Ticket is not the Wave's and holds none. A call of the
// Orchestrator itself, or of a Subagent bound to no Ticket, cannot be put on one Ticket: it holds every Ticket of the
// Wave.
//
// What is not read holds nothing: a Vendor other than Claude Code (Codex keeps its history in its own threads, not read
// here), a Wave line without a session, a transcript that is gone. Reads only; writes nothing.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentEvent } from '../../shared/agent/events'
import type { LiveSession } from '../../shared/agent/live-sessions'
import { unknownSideEffects, type InterruptedSubagent } from '../../shared/agent/unknown-side-effects'
import type { BindingWorkflow } from '../../shared/binding/resolve'
import { mainThreadEvents, parseTranscriptLines } from '../../shared/transcript/parse'

/** The cut-off Wave of a Run, as its journal tells it (checkpoint.ts). */
export interface CutOffWave {
  /** The Project's repository root. */
  root: string
  /** The Run's id: the record handed to unknownSideEffects names it. */
  run: string
  epic: string
  /** The Vendor of the Run's Orchestrator. */
  vendor: string
  /** The SDK session the Wave went to (`session` of its `wave-started`); null when the line has none. */
  session: string | null
  /** The Tickets of the Wave still in work. */
  tickets: readonly number[]
  /** The workflow model as a Binding needs it; undefined when there is none. */
  workflow: BindingWorkflow | undefined
}

export interface HeldTicketsDeps {
  /** The path of a Claude Code session's transcript among the Project's folders, or null (ClaudeHomeRegistry.transcriptPath). */
  transcriptPath(root: string, sessionId: string): Promise<string | null>
  /** A file's lines, or null when it cannot be read; tests pass their own. */
  readLines?(path: string): Promise<string[] | null>
  /** A folder's file names, or none when it cannot be read; tests pass their own. */
  listFiles?(dir: string): Promise<string[]>
}

const readLinesOf = async (path: string): Promise<string[] | null> => {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line.trim() !== '')
  } catch {
    return null
  }
}

const listFilesOf = async (dir: string): Promise<string[]> => {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** A Subagent's own transcript: `agent-<id>.jsonl` in `<session>/subagents/` beside the session's file. */
const SUBAGENT_FILE = /^agent-(.+)\.jsonl$/u

/** The events of the last turn: from the last prompt on, the Wave's turn in a session that a new Wave started. */
function lastTurn(events: readonly AgentEvent[]): AgentEvent[] {
  const start = events.findLastIndex((event) => event.type === 'prompt')
  return start === -1 ? [...events] : events.slice(start)
}

/** The Tickets of `cut` that wait for a person, in number order; none when nothing could be read. */
export async function heldTickets(deps: HeldTicketsDeps, cut: CutOffWave): Promise<number[]> {
  if (cut.tickets.length === 0 || cut.session === null || cut.vendor !== 'claude') return []
  const readLines = deps.readLines ?? readLinesOf
  const listFiles = deps.listFiles ?? listFilesOf
  const path = await deps.transcriptPath(cut.root, cut.session)
  if (path === null) return []
  const lines = await readLines(path)
  if (lines === null) return []
  const folder = join(dirname(path), cut.session, 'subagents')
  const subagents: InterruptedSubagent[] = []
  for (const name of (await listFiles(folder)).sort()) {
    const agentId = SUBAGENT_FILE.exec(name)?.[1]
    if (agentId === undefined) continue
    const own = await readLines(join(folder, name))
    if (own !== null) subagents.push({ agentId, lines: own })
  }
  // The record unknownSideEffects reads only for its Node; the Run's Orchestrator is the one here.
  const session: LiveSession = {
    nodeId: 'orchestrator',
    kind: 'orchestrator',
    vendor: 'claude',
    vendorSessionId: cut.session,
    state: 'busy',
    queue: { items: [], held: false },
    runId: cut.run,
    lastEventAt: 0,
    continuedAt: [],
  }
  const found = unknownSideEffects({ session, events: lastTurn(mainThreadEvents(parseTranscriptLines(lines))), subagents, workflow: cut.workflow })
  const wave = new Set(cut.tickets)
  const all = (): number[] => [...wave].sort((a, b) => a - b)
  if (found.session.length > 0) return all()
  const held = new Set<number>()
  for (const subagent of found.subagents) {
    const ticket = subagent.ticket
    if (ticket === null) return all()
    // A Subagent of another Ticket is no implementer of this Wave (the session may be older than the Wave).
    if (ticket.epic === cut.epic && wave.has(ticket.num)) held.add(ticket.num)
  }
  return [...held].sort((a, b) => a - b)
}
