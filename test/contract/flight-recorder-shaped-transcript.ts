// An Orchestrator Session shaped like a real one, for the tests and the measure of the incremental
// transcript facts (worfy-flight-recorder ticket 27). Built from a seed: nothing here comes from a
// real transcript.
//
// The shape follows what a long worfy Session holds: Waves started as slash commands, typed prompts,
// tool calls with long results, background `Agent` calls of implementers and verifiers (some named
// only by their meta file), their task-notifications (some queued first), failed and killed agents,
// verifiers that answer REJECTED, a rework through a resuming `SendMessage`, messages to an agent
// that still works, `<agent-message>` prompts, foreground agents, a restart under the same name, meta
// prompts and a compact summary. Each agent whose call lies in the window gets its own transcript
// and a `.meta.json`; it moves to its worktree after its first records.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Json = Record<string, unknown>

export interface ShapedOptions {
  sessionId: string
  /** The Project root: the Orchestrator's cwd. Worktrees lie under `<cwd>/.claude/worktrees/`. */
  cwd: string
  epic: string
  /** How many turns of the Orchestrator; each holds one or a few agent events. */
  turns: number
  /** The time of the first record. */
  start: number
  /** Seconds between two turns. */
  turnSeconds?: number
  /** The bytes of each tool result: a real Session's file is mostly tool output. */
  toolResultBytes?: number
  /** Tool calls in a plain turn. */
  toolsPerTurn?: number
  /** The bytes of an agent's prompt and of its report. */
  promptBytes?: number
  reportBytes?: number
  /** Records of each Subagent's own transcript, and the bytes of each. */
  subagentRecords?: number
  subagentRecordBytes?: number
  /** Agents whose call lies at or after this time get their own files (the Run's window); 0 — all. */
  subagentsFrom?: number
  seed?: number
}

export interface ShapedSubagent {
  meta: Json
  lines: string[]
}

export interface ShapedSession {
  /** The Orchestrator's transcript lines, in file order. */
  lines: string[]
  /** The Subagents' files by agent id. */
  subagents: Map<string, ShapedSubagent>
  /** The Tickets the Waves named, `<epic>/<NN>`. */
  tickets: string[]
  /** The time of the last record. */
  end: number
  /** How many `Agent` calls. */
  agents: number
}

/** A small seeded random source (mulberry32): the same seed gives the same Session. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const filler = (bytes: number, word: string): string => (word + ' ').repeat(Math.max(1, Math.ceil(bytes / (word.length + 1)))).slice(0, bytes)

interface LiveAgent {
  id: string
  callId: string
  name: string
  ticket: number
  verifier: boolean
  worktree: string
  start: number
  reported: boolean
  /** The agent's meta names it; the call does not. */
  metaOnly: boolean
}

/** Builds the Session in memory. */
export function shapedSession(options: ShapedOptions): ShapedSession {
  const rnd = random(options.seed ?? 27)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!
  const turnMs = (options.turnSeconds ?? 20) * 1000
  const toolBytes = options.toolResultBytes ?? 4_000
  const toolsPerTurn = options.toolsPerTurn ?? 2
  const promptBytes = options.promptBytes ?? 4_000
  const reportBytes = options.reportBytes ?? 1_500
  const subagentRecords = options.subagentRecords ?? 12
  const subagentRecordBytes = options.subagentRecordBytes ?? 600
  const subagentsFrom = options.subagentsFrom ?? 0
  const { sessionId, cwd, epic } = options

  const lines: string[] = []
  const subagents = new Map<string, ShapedSubagent>()
  const tickets = new Set<string>()
  let now = options.start
  let serial = 0
  let agentCount = 0
  const iso = (ms: number): string => new Date(ms).toISOString()
  /** A record of the Orchestrator; `cwd: undefined` in `value` leaves the folder out, as some records do. */
  const record = (value: Json, at = now): void => {
    lines.push(JSON.stringify({ parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId, version: '2.1.0', gitBranch: 'main', uuid: `u-${serial++}`, timestamp: iso(at), ...value }))
  }
  const tick = (ms = 1_000 + Math.floor(rnd() * 3_000)): number => (now += ms)
  const user = (content: unknown, extra: Json = {}): void => record({ type: 'user', message: { role: 'user', content }, ...extra })
  const assistant = (content: unknown[], extra: Json = {}): void => record({ type: 'assistant', message: { id: `msg-${serial}`, model: 'claude-opus-5-5', role: 'assistant', content, usage: { input_tokens: 10, output_tokens: 200 } }, ...extra })
  const say = (text: string): void => assistant([{ type: 'text', text }])
  const tools = (count: number): void => {
    for (let n = 0; n < count; n++) {
      const id = `toolu_${serial}`
      assistant([{ type: 'thinking', thinking: filler(300, 'thinking'), signature: 'sig' }, { type: 'tool_use', id, name: pick(['Bash', 'Read', 'Grep', 'Edit']), input: { command: `echo ${serial}`, file_path: `${cwd}/src/file-${serial}.ts` } }])
      tick(500)
      user([{ type: 'tool_result', tool_use_id: id, content: filler(toolBytes, 'output') }], { toolUseResult: { stdout: filler(Math.floor(toolBytes / 2), 'stdout'), stderr: '', interrupted: false } })
      tick(500)
    }
  }

  const live: LiveAgent[] = []
  const notification = (agent: LiveAgent, status: string, result: string): string =>
    `<task-notification>\n<task-id>${agent.id}</task-id>\n<tool-use-id>${agent.callId}</tool-use-id>\n<status>${status}</status>\n<summary>Agent "${agent.name}" ${status}</summary>\n<result>${result}</result>\n</task-notification>`
  const reportOf = (agent: LiveAgent): string => {
    if (agent.verifier) return `${rnd() < 0.3 ? 'REJECTED: [med] the test misses the empty case' : 'VERIFIED'}\n\n${filler(reportBytes, 'finding')}`
    return `\`\`\`json\n${JSON.stringify({ ticket: `${epic}/${String(agent.ticket).padStart(2, '0')}`, branch: `${epic}/${agent.ticket}`, pr: 1000 + agent.ticket, worktree: agent.worktree })}\n\`\`\`\n${filler(reportBytes, 'claim')}`
  }
  const ownFiles = (agent: LiveAgent, until: number): void => {
    if (agent.start < subagentsFrom) return
    const own: string[] = []
    const span = Math.max(1, until - agent.start)
    for (let n = 0; n < subagentRecords; n++) {
      const at = agent.start + Math.floor((span * n) / subagentRecords)
      const where = n < 2 ? cwd : agent.worktree
      const base = { parentUuid: null, isSidechain: true, userType: 'external', cwd: where, sessionId, agentId: agent.id, uuid: `s-${agent.id}-${n}`, timestamp: iso(at) }
      if (n === 0) own.push(JSON.stringify({ ...base, type: 'user', message: { role: 'user', content: filler(promptBytes, 'task') } }))
      else if (n % 2 === 1) own.push(JSON.stringify({ ...base, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t-${agent.id}-${n}`, name: 'Bash', input: { command: 'pnpm test' } }] } }))
      else {
        own.push(JSON.stringify({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${agent.id}-${n - 1}`, content: filler(subagentRecordBytes, 'log') }] } }))
        // Every other answer says what it found: the text the facts keep.
        if (n % 4 === 2) own.push(JSON.stringify({ ...base, uuid: `${base.uuid}-text`, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: filler(Math.max(100, Math.floor(subagentRecordBytes / 20)), 'note') }] } }))
      }
    }
    own.push(JSON.stringify({ parentUuid: null, isSidechain: true, cwd: agent.worktree, sessionId, agentId: agent.id, type: 'assistant', uuid: `s-${agent.id}-end`, timestamp: iso(until), message: { role: 'assistant', content: [{ type: 'text', text: reportOf(agent) }] } }))
    const meta: Json = { agentType: agent.verifier ? 'worfy:reviewer' : 'worfy:implementer', description: `${agent.verifier ? 'Verify' : 'Implement'} ticket ${agent.ticket}`, toolUseId: agent.callId, spawnDepth: 1, requestShape: 'background' }
    if (agent.metaOnly) meta.name = agent.name
    subagents.set(agent.id, { meta, lines: own })
  }
  const launch = (ticket: number, verifier: boolean, foreground = false, named?: string): LiveAgent => {
    const id = `a${(agentCount++).toString(16).padStart(16, '0')}`
    const callId = `toolu_agent_${serial}`
    const name = named ?? `${verifier ? 'verify' : 'impl'}-${String(ticket).padStart(2, '0')}${rnd() < 0.2 ? '-r2' : ''}`
    const metaOnly = named === undefined && rnd() < 0.15
    // A verifier reviews in the Project's root: it moves to no worktree.
    const agent: LiveAgent = { id, callId, name, ticket, verifier, worktree: verifier ? cwd : `${cwd}/.claude/worktrees/${ticket}`, start: now, reported: false, metaOnly }
    // An agent named only by its meta has a prompt and a description that name no Ticket: its Ticket is
    // known from the meta alone, once its id is.
    const prompt = metaOnly ? filler(promptBytes, 'brief') : `Ticket: .scratch/${epic}/issues/${String(ticket).padStart(2, '0')}-x.md\n${filler(promptBytes, 'brief')}`
    const input: Json = { subagent_type: verifier ? 'worfy:reviewer' : 'worfy:implementer', description: metaOnly ? 'Work on the next item' : `${verifier ? 'Verify' : 'Implement'} ${epic} ticket ${ticket}`, prompt, run_in_background: !foreground }
    if (!metaOnly) input.name = name
    // The call of a verifier names no folder: the folder is the one of the records before it.
    assistant([{ type: 'text', text: `Launching ${name}.` }, { type: 'tool_use', id: callId, name: 'Agent', input }], verifier ? { cwd: undefined } : {})
    tick(300)
    if (foreground) {
      tick(30_000)
      user([{ type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text: reportOf(agent) }] }], { toolUseResult: { status: 'completed', agentId: id, prompt: 'x', content: [{ type: 'text', text: 'x' }], totalDurationMs: 30_000 } })
      agent.reported = true
      ownFiles(agent, now)
      return agent
    }
    user([{ type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text: 'Async agent launched successfully.' }] }], { toolUseResult: { isAsync: true, status: 'async_launched', agentId: id, description: input.description, prompt: input.prompt } })
    live.push(agent)
    return agent
  }

  let ticket = 1
  for (let turn = 0; turn < options.turns; turn++) {
    now = Math.max(now, options.start + turn * turnMs)
    const kind = turn % 10
    if (kind === 0) {
      // A Wave: a slash command naming two Tickets, and their implementers.
      const first = ticket
      const second = ticket + 1
      ticket += 2
      tickets.add(`${epic}/${String(first).padStart(2, '0')}`)
      tickets.add(`${epic}/${String(second).padStart(2, '0')}`)
      user(`<command-message>worfy:epic-wave</command-message>\n<command-name>/worfy:epic-wave</command-name>\n<command-args>tickets ${first}, ${second} of epic ${epic}</command-args>`)
      tick()
      say('Starting the Wave.')
      tools(toolsPerTurn)
      launch(first, false)
      launch(second, false)
      say('Both implementers run.')
    } else if (kind === 3 || kind === 6) {
      // A report arrives: a task-notification, queued first every other time.
      const agent = live.find((each) => !each.reported)
      if (agent === undefined) {
        user(filler(200, 'question'))
        say('Nothing runs.')
        continue
      }
      const roll = rnd()
      const status = roll < 0.07 ? 'failed' : roll < 0.1 ? 'killed' : 'completed'
      const text = notification(agent, status, status === 'completed' ? reportOf(agent) : 'the agent stopped')
      if (kind === 6) {
        // Claude Code writes queue operations and attachments without a folder.
        record({ type: 'queue-operation', operation: 'enqueue', content: text, cwd: undefined, uuid: undefined })
        tick(2_000)
        record({ type: 'attachment', attachment: { type: 'queued_command', prompt: text, commandMode: 'task-notification' }, cwd: undefined })
        tick(200)
      }
      user(text)
      agent.reported = true
      ownFiles(agent, now)
      tick()
      say(`${agent.name} reported.`)
      tools(toolsPerTurn)
      // A reported implementer gets its verifier.
      if (!agent.verifier && status === 'completed') launch(agent.ticket, true)
    } else if (kind === 4) {
      // A rework: a resuming SendMessage to an agent that reported; a message to one that still works waits.
      const done = live.find((each) => each.reported && !each.verifier)
      const working = live.find((each) => !each.reported)
      user(`<agent-message from="${working?.name ?? 'impl-99'}">\nA question about the fixture.\n</agent-message>`)
      tick()
      if (done !== undefined) {
        const id = `toolu_send_${serial}`
        assistant([{ type: 'tool_use', id, name: 'SendMessage', input: { to: done.name, summary: 'Rework round', message: filler(500, 'fix') } }])
        tick(200)
        user([{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'resumed' }] }], { toolUseResult: { success: true, message: `Resuming agent ${done.name}`, resumedAgentId: done.id } })
        done.reported = false
        done.start = now
      }
      if (working !== undefined) {
        const id = `toolu_send_${serial}`
        assistant([{ type: 'tool_use', id, name: 'SendMessage', input: { to: working.name, summary: 'Note', message: 'one more thing' } }])
        tick(200)
        user([{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'queued' }] }], { toolUseResult: { success: true, message: `Message queued for delivery to ${working.name} at its next tool round.` } })
      }
      say('Sent.')
    } else if (kind === 7 && turn % 40 === 7) {
      // A restart after a session-error: a new call under the name of an agent that still works.
      const open = live.find((each) => !each.reported && !each.metaOnly)
      user('Session error: resume the Wave.')
      tick()
      if (open !== undefined) {
        open.reported = true
        ownFiles(open, now)
        launch(open.ticket, open.verifier, false, open.name)
      }
      say('Restarted.')
    } else if (kind === 8 && turn % 30 === 8) {
      // A foreground agent, answered in the call's own result.
      user('Look at the gate log of the last run.')
      tick()
      launch(Math.max(1, ticket - 1), false, true)
      say('Done.')
    } else if (kind === 9 && turn % 50 === 9) {
      // A compact summary and meta prompts start no turn.
      user('This session is being continued from a previous conversation.', { isCompactSummary: true })
      user('<local-command-caveat>Caveat</local-command-caveat>', { isMeta: true })
      say('Continuing.')
    } else {
      // A plain turn: a typed prompt, tool calls, an answer.
      user(filler(300, 'prompt'))
      tick()
      say(filler(400, 'thought'))
      tools(toolsPerTurn)
      say(filler(800, 'answer'))
    }
  }
  // The agents still at work have their own records so far.
  for (const agent of live) if (!agent.reported) ownFiles(agent, now)
  return { lines, subagents, tickets: [...tickets], end: now, agents: agentCount }
}

/** Writes the Session as Claude Code keeps it: `<dir>/<session>.jsonl` and `<dir>/<session>/subagents/`. */
export function writeShapedSession(dir: string, session: ShapedSession, sessionId: string): { bytes: number } {
  const folder = join(dir, sessionId, 'subagents')
  mkdirSync(folder, { recursive: true })
  const text = session.lines.join('\n') + '\n'
  writeFileSync(join(dir, `${sessionId}.jsonl`), text)
  let bytes = Buffer.byteLength(text)
  for (const [id, file] of session.subagents) {
    const own = file.lines.join('\n') + '\n'
    bytes += Buffer.byteLength(own)
    writeFileSync(join(folder, `agent-${id}.jsonl`), own)
    writeFileSync(join(folder, `agent-${id}.meta.json`), JSON.stringify(file.meta))
  }
  return { bytes }
}
