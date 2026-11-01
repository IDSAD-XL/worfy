// The reader of the transcripts for Flight Recorder (worfy-flight-recorder ticket 14): finds the
// Orchestrator's transcript of each Wave of a Run under the Claude home, reads it and its Subagents'
// files whole, and hands the facts of src/shared/flight-recorder/from-transcript.ts to the service
// (ticket 17) with the worktree paths canonical (facts.ts) and with what lies in the Run's Waves.
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
// - Times: only the `timestamp` of the records; the time a file changed is never read.
//
// shortcut: reads every file whole on each call, a night Run is tens of MB; ticket 17 reads on from where it stopped (src/main/claude-home/tail.ts).
import { readdir, readFile, realpath } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import type { LostFact, TurnFact, WaveFact, WorkFact } from '../../shared/flight-recorder/facts'
import { transcriptCwd, transcriptFacts, wavePromptTimes, type SubagentLines } from '../../shared/flight-recorder/from-transcript'
import { isInsidePath, projectDirName } from '../claude-home/registry'
import { claudeHome } from '../storage/paths'

type Env = Readonly<Record<string, string | undefined>>
type Iso = string

/** How far the prompt of a Wave may lie from its `wave-started` for the search by text. */
export const WAVE_SLACK_MS = 60_000
/**
 * How long before its `wave-started` a Wave's own records may begin: worfy writes the line just
 * after it sends the prompt (29 ms in the night Run). Longer would take in the end of the Wave before.
 */
export const PROMPT_LEAD_MS = 5_000
/** A Session id as Claude Code names its files; anything else names no file. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/u
const AGENT_FILE = /^agent-([A-Za-z0-9_-]{1,128})\.(jsonl|meta\.json)$/u

/** A Wave as the Journal gives it: `wave-started.session` and `wave-started.text` when it has them. */
export interface TranscriptWave extends Pick<WaveFact, 'number' | 'startedAt' | 'finishedAt' | 'tickets' | 'session'> {
  text?: string
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

export interface TranscriptReadOptions {
  env?: Env
  /** Whose path rules apply: the Machine's own by default. */
  platform?: NodeJS.Platform
}

export interface RunTranscripts {
  work: WorkFact[]
  turns: TurnFact[]
  lost: LostFact[]
}

/**
 * A path as the model compares it (facts.ts): the real path when the folder exists on this
 * Machine, else the path normalised; one separator, no trailing one; on Windows case-folded, as its
 * file system compares names. The real path resolves a link and an 8.3 name (`RUNNER~1`).
 */
export async function canonicalPath(path: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  const paths = platform === 'win32' ? win32 : posix
  let resolved = paths.normalize(path.normalize('NFC'))
  if (platform === process.platform) {
    try {
      resolved = (await realpath(resolved)).normalize('NFC')
    } catch {
      // A removed worktree: the path as written.
    }
  }
  if (resolved.length > paths.parse(resolved).root.length && resolved.endsWith(paths.sep)) resolved = resolved.slice(0, -1)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

const missing = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code ?? '')

async function readLines(file: string): Promise<string[] | null> {
  try {
    return (await readFile(file, 'utf8')).split(/\r?\n/u).filter((line) => line !== '')
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
}

async function subagentFiles(dir: string, session: string): Promise<Map<string, SubagentLines>> {
  const folder = join(dir, session, 'subagents')
  const files = new Map<string, SubagentLines>()
  for (const name of await listDir(folder)) {
    const match = AGENT_FILE.exec(name)
    if (match === null) continue
    const [, agentId, kind] = match as unknown as [string, string, string]
    const entry = files.get(agentId) ?? { meta: null, lines: [] }
    const lines = (await readLines(join(folder, name))) ?? []
    if (kind === 'jsonl') entry.lines = lines
    else {
      try {
        entry.meta = JSON.parse(lines.join('\n'))
      } catch {
        entry.meta = null
      }
    }
    files.set(agentId, entry)
  }
  return files
}

const ms = (iso: Iso): number => Date.parse(iso)

/** The facts of the transcripts of a Run. */
export async function readRunTranscripts(run: TranscriptRun, options: TranscriptReadOptions = {}): Promise<RunTranscripts> {
  const platform = options.platform ?? process.platform
  const dir = join(claudeHome(options.env), 'projects', projectDirName(run.root))
  const tickets = [...new Set(run.waves.flatMap((wave) => wave.tickets))]
  const ofProject = (lines: readonly string[]): boolean => {
    const cwd = transcriptCwd(lines)
    return cwd !== undefined && isInsidePath(cwd.normalize('NFC'), run.root.normalize('NFC'), platform)
  }

  // The transcripts of the folder, read once, for the Waves that have no session.
  let listed: Map<string, string[]> | undefined
  const transcripts = async (): Promise<Map<string, string[]>> => {
    if (listed !== undefined) return listed
    listed = new Map()
    for (const name of (await listDir(dir)).sort()) {
      if (!name.endsWith('.jsonl')) continue
      const lines = await readLines(join(dir, name))
      if (lines !== null && ofProject(lines)) listed.set(name.slice(0, -'.jsonl'.length), lines)
    }
    return listed
  }
  const read = new Map<string, string[] | null>()
  const sessionLines = async (session: string): Promise<string[] | null> => {
    if (!read.has(session)) {
      const lines = SESSION_ID.test(session) ? await readLines(join(dir, `${session}.jsonl`)) : null
      read.set(session, lines !== null && ofProject(lines) ? lines : null)
    }
    return read.get(session) ?? null
  }

  const lost: LostFact[] = []
  const windows = new Map<string, { start: number; end: number }>()
  for (const wave of run.waves) {
    let session: string | undefined
    if (wave.session !== undefined) {
      if ((await sessionLines(wave.session)) !== null) session = wave.session
    } else if (wave.text !== undefined && wave.text.trim() !== '') {
      let nearest = WAVE_SLACK_MS + 1
      for (const [id, lines] of await transcripts()) {
        for (const at of wavePromptTimes(lines, wave.text)) {
          const distance = Math.abs(ms(at) - ms(wave.startedAt))
          if (distance < nearest) [nearest, session] = [distance, id]
        }
      }
      if (session !== undefined) read.set(session, listed!.get(session)!)
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
    const facts = transcriptFacts({ session, epic: run.epic, tickets, lines, subagents: await subagentFiles(dir, session) })
    const inside = (fact: { start: Iso }) => ms(fact.start) >= window.start && ms(fact.start) <= window.end
    for (const fact of facts.work.filter(inside)) work.push(fact.worktree === undefined ? fact : { ...fact, worktree: await canonicalPath(fact.worktree, platform) })
    turns.push(...facts.turns.filter(inside))
  }
  return { work, turns, lost }
}
