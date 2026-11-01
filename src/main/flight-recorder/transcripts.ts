// The reader of the transcripts for Flight Recorder (worfy-flight-recorder ticket 14): finds the
// Orchestrator's transcript of each Wave of a Run under the Claude home, reads it and the files of
// the Subagents the Run started, and hands the facts of src/shared/flight-recorder/from-transcript.ts
// to the service (ticket 17) with the worktree paths canonical (facts.ts) and with what lies in the
// Run's Waves.
//
// - Where: `<Claude home>/projects/<projectDirName(root)>/<session>.jsonl`, the Subagents in
//   `<session>/subagents/agent-<id>.jsonl` and `.meta.json`. The folder name is no proof (it loses
//   the difference between `/`, `-` and any other sign; on Windows `C:\Users\Ann\repo` is
//   `C--Users-Ann-repo`): a transcript is the Project's when the `cwd` its records name lies in the
//   root, as the registry decides (src/main/claude-home/registry.ts).
// - Which: `wave-started.session` names it. A Journal without it has the Wave's text: the Session
//   whose prompt with that text lies nearest the Wave's start, within WAVE_SLACK_MS. With neither,
//   or with a file that is gone, the Wave's Orchestrator lane and its Tickets' agents are lost
//   («transcript deleted»): the Journal knows of them, the transcript holds nothing more.
// - Which Subagents: only those whose `Agent` call or resuming `SendMessage` lies in the Run's
//   Waves. A long Session keeps thousands of Subagent files (1.1 GB in one of worfy's own); a Run
//   uses a dozen.
// - An agent the transcript names no Ticket for, whose folder is the canonical worktree of an agent
//   of a Ticket, gets that Ticket; any other is the Run's (`ticket: null`), so it never vanishes.
// - Times: only the `timestamp` of the records; the time a file changed is never read.
//
// The lines come from `readLines` of the options, a streamed read of the whole file by default.
// shortcut: each call reads the Orchestrator's file whole (160 MB in a long Session) and parses it again; ticket 17 passes a `readLines` that tails the files (src/main/claude-home/tail.ts) and keeps what it parsed.
import { createReadStream, realpath } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import type { LostFact, TurnFact, WaveFact, WorkFact } from '../../shared/flight-recorder/facts'
import { agentIdsIn, transcriptCwd, transcriptFacts, wavePromptTimes, type SubagentLines } from '../../shared/flight-recorder/from-transcript'
import { isInsidePath, projectDirName } from '../claude-home/registry'
import { claudeHome } from '../storage/paths'

type Env = Readonly<Record<string, string | undefined>>
type Iso = string

const realpathNative = promisify(realpath.native)

/** How far the prompt of a Wave may lie from its `wave-started` for the search by text. */
export const WAVE_SLACK_MS = 60_000
/**
 * How long before its `wave-started` a Wave's own records may begin: worfy writes the line just
 * after it sends the prompt (29 ms in the night Run). Longer would take in the end of the Wave before.
 */
export const PROMPT_LEAD_MS = 5_000
/** A Session or agent id as Claude Code names its files; anything else (`../x`) names no file. */
const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/u

/** A Wave as the Journal gives it: `wave-started.session` and `wave-started.text` when it has them. */
export interface TranscriptWave extends Pick<WaveFact, 'number' | 'startedAt' | 'finishedAt' | 'tickets' | 'session'> {
  text?: string | undefined
}

/** What the reader needs of a Run. */
export interface TranscriptRun {
  epic: string
  /** The Project's root, as the Orchestrator's Sessions start in it. */
  root: string
  startedAt: Iso
  stoppedAt: Iso | null
  waves: readonly TranscriptWave[]
}

export interface CanonicalOptions {
  /** `process.platform` by default; `win32` checks the Windows rules on any system. */
  platform?: string
  /** realpath(3) by default. */
  realpath?: (path: string) => Promise<string>
}

/** The lines of a file, empty ones left out; null when there is no such file. */
export type ReadLines = (file: string) => Promise<readonly string[] | null>

export interface TranscriptReadOptions extends CanonicalOptions {
  env?: Env
  /** Where the lines come from: a streamed read of the whole file by default; ticket 17 tails. */
  readLines?: ReadLines
}

export interface RunTranscripts {
  work: WorkFact[]
  turns: TurnFact[]
  lost: LostFact[]
}

/**
 * A worktree path in the form the model compares as a string (facts.ts): realpath(3), which
 * resolves a link, expands an 8.3 short name like `RUNNER~1` and gives the drive letter's case,
 * else the path as written (a worktree that is gone); then `comparablePath`. The same rule as
 * reader 16's `canonicalWorktree` (src/main/flight-recorder/gate-logs.ts), so a gate run and an
 * agent of one worktree meet.
 */
export async function canonicalPath(path: string, options: CanonicalOptions = {}): Promise<string> {
  const resolve = options.realpath ?? ((target: string) => realpathNative(target))
  let real = path
  try {
    real = await resolve(path)
  } catch {
    // A worktree that is gone keeps the spelling the report gave.
  }
  return comparablePath(real, options.platform ?? process.platform)
}

/**
 * On Windows `\` and `/` are one separator and letter case does not tell two names apart, so the
 * path gets `/` and lower case, and the `\\?\` prefix of a long path goes; elsewhere it is the path
 * itself. A trailing separator goes too, except on a root (`/`, `c:/`). Reader 16's
 * `comparablePath` (src/shared/flight-recorder/from-gate.ts), character for character.
 */
export function comparablePath(path: string, platform: string): string {
  let result = path
  if (platform === 'win32') {
    result = result.replaceAll('\\', '/')
    if (result.startsWith('//?/UNC/')) result = `//${result.slice('//?/UNC/'.length)}`
    else if (result.startsWith('//?/')) result = result.slice('//?/'.length)
    result = result.toLowerCase()
  }
  while (result.length > 1 && result.endsWith('/') && !/^[a-z]:\/$/u.test(result)) result = result.slice(0, -1)
  return result
}

const missing = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code ?? '')

/** The default line source: the file streamed line by line, so no single string holds it whole. */
export const streamLines: ReadLines = async (file) => {
  const lines: string[] = []
  try {
    const stream = createReadStream(file, { encoding: 'utf8' })
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) if (line !== '') lines.push(line)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  return lines
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
}

/** The files of the Subagents `ids` of a Session; an id that names no file is left out. */
async function subagentFiles(dir: string, session: string, ids: ReadonlySet<string>, readLines: ReadLines): Promise<Map<string, SubagentLines>> {
  const folder = join(dir, session, 'subagents')
  const files = new Map<string, SubagentLines>()
  for (const id of ids) {
    if (!FILE_ID.test(id)) continue
    const lines = await readLines(join(folder, `agent-${id}.jsonl`))
    const metaLines = await readLines(join(folder, `agent-${id}.meta.json`))
    let meta: unknown
    try {
      meta = metaLines === null ? null : JSON.parse(metaLines.join('\n'))
    } catch {
      meta = null
    }
    if (lines !== null || metaLines !== null) files.set(id, { meta, lines: lines ?? [] })
  }
  return files
}

const ms = (iso: Iso): number => Date.parse(iso)

/** The facts of the transcripts of a Run. */
export async function readRunTranscripts(run: TranscriptRun, options: TranscriptReadOptions = {}): Promise<RunTranscripts> {
  const platform = options.platform ?? process.platform
  const readLines = options.readLines ?? streamLines
  const dir = join(claudeHome(options.env), 'projects', projectDirName(run.root))
  const tickets = [...new Set(run.waves.flatMap((wave) => wave.tickets))]
  const ofProject = (lines: readonly string[]): boolean => {
    const cwd = transcriptCwd(lines)
    return cwd !== undefined && isInsidePath(cwd.normalize('NFC'), run.root.normalize('NFC'), platform as NodeJS.Platform)
  }
  const read = new Map<string, readonly string[] | null>()
  const sessionLines = async (session: string): Promise<readonly string[] | null> => {
    if (!read.has(session)) {
      const lines = FILE_ID.test(session) ? await readLines(join(dir, `${session}.jsonl`)) : null
      read.set(session, lines !== null && ofProject(lines) ? lines : null)
    }
    return read.get(session) ?? null
  }

  // The prompts of the folder's transcripts, read once, for the Waves that have no session: only
  // the times are kept, so the files are not held while the others are read.
  let prompts: Map<string, Map<string, Iso[]>> | undefined
  const promptTimes = async (text: string): Promise<Map<string, Iso[]>> => {
    prompts ??= new Map()
    const known = prompts.get(text)
    if (known !== undefined) return known
    const found = new Map<string, Iso[]>()
    for (const name of (await listDir(dir)).sort()) {
      const session = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : ''
      if (!FILE_ID.test(session)) continue
      const lines = await readLines(join(dir, name))
      if (lines === null || !ofProject(lines)) continue
      const times = wavePromptTimes(lines, text)
      if (times.length > 0) found.set(session, times)
    }
    prompts.set(text, found)
    return found
  }

  const lost: LostFact[] = []
  const windows = new Map<string, { start: number; end: number }>()
  for (const wave of run.waves) {
    let session: string | undefined
    if (wave.session !== undefined) {
      if ((await sessionLines(wave.session)) !== null) session = wave.session
    } else if (wave.text !== undefined && wave.text.trim() !== '') {
      let nearest = WAVE_SLACK_MS + 1
      for (const [id, times] of await promptTimes(wave.text)) {
        for (const at of times) {
          const distance = Math.abs(ms(at) - ms(wave.startedAt))
          if (distance < nearest) [nearest, session] = [distance, id]
        }
      }
      if (session !== undefined && (await sessionLines(session)) === null) session = undefined
    }
    const end = wave.finishedAt ?? run.stoppedAt
    if (session === undefined) {
      lost.push({ kind: 'orchestrator-turn', name: 'Orchestrator', source: 'transcript-deleted', start: wave.startedAt, ...(end === null ? {} : { end }) })
      for (const ticket of wave.tickets) lost.push({ kind: 'agent', ticket, name: `impl-${/(\d+)$/u.exec(ticket)?.[1] ?? ticket}`, source: 'transcript-deleted' })
      continue
    }
    const window = windows.get(session) ?? { start: Infinity, end: -Infinity }
    window.start = Math.min(window.start, ms(wave.startedAt) - PROMPT_LEAD_MS)
    window.end = Math.max(window.end, end === null ? Infinity : ms(end))
    windows.set(session, window)
  }

  const work: WorkFact[] = []
  const turns: TurnFact[] = []
  for (const [session, window] of windows) {
    const lines = read.get(session)!
    const inside = (at: Iso) => ms(at) >= window.start && ms(at) <= window.end
    const subagents = await subagentFiles(dir, session, agentIdsIn(lines, inside), readLines)
    const facts = transcriptFacts({ session, epic: run.epic, tickets, lines, subagents })
    for (const fact of facts.work.filter((item) => inside(item.start))) work.push(fact.worktree === undefined ? fact : { ...fact, worktree: await canonicalPath(fact.worktree, options) })
    turns.push(...facts.turns.filter((item) => inside(item.start)))
  }

  // An agent with no Ticket of its own: the Ticket of an agent in the same worktree, else the Run's.
  const ticketOfWorktree = new Map<string, string>()
  for (const fact of work) if (typeof fact.ticket === 'string' && fact.worktree !== undefined) ticketOfWorktree.set(fact.worktree, fact.ticket)
  for (const fact of work) if (fact.ticket === undefined) fact.ticket = ticketOfWorktree.get(fact.worktree ?? '') ?? null
  return { work, turns, lost }
}
