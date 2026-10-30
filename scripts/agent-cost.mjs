#!/usr/bin/env node
// What the agents cost and where they sat idle, read from Claude Code transcripts, so that the
// baseline of a process change and its result are measured by the same code. Run
// `node scripts/agent-cost.mjs --help`.
//
// Source, read only: the transcripts Claude Code writes, `<config>/projects/<folder>/*.jsonl` (a
// main session) and `<session>/subagents/**/agent-*.jsonl` with `agent-*.meta.json` beside it (a
// subagent). Every model response is an `assistant` line whose `message.usage` holds the token
// counts. A response of several content blocks is written as several lines with one `message.id`;
// the output count grows from line to line. So a response is counted once, by `message.id` across
// all files: the earliest timestamp, the largest count of each kind.
//
// The script writes nothing: the report goes to stdout, and nothing else is opened for writing.
import { createReadStream, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

/**
 * API list prices, dollars per million tokens: input, output, cache read, cache write with a
 * 5-minute lifetime, cache write with a 1-hour lifetime. The same table the process analytics of
 * 2026-10-27 used. A model not in the table is priced as FALLBACK_MODEL and named in the report.
 */
export const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2, 5, 8],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5, 4],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125, 0.2],
  'claude-opus-4-8': [5, 25, 0.5, 6.25, 10],
  'claude-haiku-4-5-20251001': [1, 5, 0.1, 1.25, 2],
}
export const FALLBACK_MODEL = 'claude-opus-5-5'
/** A response in fast mode (`usage.speed` "fast") costs this many times the table. */
export const FAST_MULTIPLIER = 2
/** A pause longer than this before a request lets the 5-minute prompt cache expire. */
export const IDLE_MS = 5 * 60 * 1000
/** A pause up to this long keeps a 1-hour prompt cache; a longer one rewrites it with either lifetime. */
export const HOUR_MS = 60 * 60 * 1000
export const ROLES = ['orchestrator', 'implementer', 'reviewer', 'scout', 'other']

const HELP = `usage: node scripts/agent-cost.mjs [options]

The cost of the agents by role, the prompt cache rewritten after an idle pause, the context of
an Orchestrator call and the start context of a subagent, from Claude Code transcripts. Reads only.

  --transcripts <folder>  a folder of transcripts, read with every folder under it. Default:
                          every folder of <config>/projects whose name is this repository's
                          path (its worktrees included), <config> being CLAUDE_CONFIG_DIR or
                          ~/.claude.
  --since <date>          only responses at or after this time: YYYY-MM-DD (UTC midnight) or ISO.
  --until <date>          only responses before this time; a bare YYYY-MM-DD takes in that whole
                          UTC day.
  --by-ticket             a row per Ticket instead of per role: its tokens and cost, its scouts,
                          its implementers up to their first Edit or Write, the files they read
                          by then and how many of them agents of other Tickets of the Epic read
                          earlier. The Ticket of a subagent comes from its brief (see ticketOf);
                          the Orchestrator from the wave command, split evenly between the
                          Wave's Tickets; the rest is the row "(no ticket)".
  --waits                 how many Orchestrator responses come right after a wait: the notice
                          that a background command ended or that a Monitor printed an event
                          (a Monitor sends one notice per event, not only at its end), or the
                          result of a CI wait run in the foreground (gh pr checks --watch,
                          gh run watch; one run in the background counts by its notice);
                          their tokens and cost. Responses right after the notice that a
                          subagent finished are shown apart and are not counted as waits.
  --idle                  per role, what a 1-hour prompt cache would change: the agents, the
                          median count per agent of pauses of 5-60 min (a 1-hour cache keeps
                          its context over them), the pauses over 60 min (rewritten with either
                          lifetime), the cache rewritten after the 5-60 min pauses, and the
                          cache write cost now against the cost with 1 hour: every write at the
                          1-hour price, the context the 5-minute cache lost in a 5-60 min pause
                          read instead of written.
  --json                  JSON instead of the table.
  --help                  this text.

Exit code: 0 the report was made; 2 wrong arguments or no transcripts folder.`

const REFUSED = 2
const DAY_MS = 24 * 60 * 60 * 1000
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A time from --since/--until: a bare date is UTC midnight, `end` moves it to the next midnight. */
function parseTime(text, end) {
  const ms = Date.parse(DATE.test(text) ? `${text}T00:00:00Z` : text)
  if (Number.isNaN(ms)) throw new Error(`not a date: ${text}`)
  return end && DATE.test(text) ? ms + DAY_MS : ms
}

/** Options from the arguments; throws with the reason when they are wrong. */
export function parseArgs(args) {
  const options = { json: false, help: false, byTicket: false, waits: false, idle: false }
  const valued = { '--transcripts': 'transcripts', '--since': 'since', '--until': 'until' }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') options.json = true
    else if (arg === '--by-ticket') options.byTicket = true
    else if (arg === '--waits') options.waits = true
    else if (arg === '--idle') options.idle = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg in valued) {
      const value = args[++i]
      if (value === undefined || value === '') throw new Error(`${arg} needs a value`)
      options[valued[arg]] = value
    } else throw new Error(`unknown argument: ${arg}`)
  }
  options.sinceMs = options.since === undefined ? -Infinity : parseTime(options.since, false)
  options.untilMs = options.until === undefined ? Infinity : parseTime(options.until, true)
  return options
}

/** The main checkout of the repository this script lies in, also when it runs from a worktree. */
function repoRoot() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  return root.split(`${sep}.claude${sep}worktrees${sep}`)[0]
}

/**
 * The transcript folders of a repository: Claude Code names the folder of a session after its
 * working directory with every character but a letter or a digit replaced by "-", so the
 * repository and its worktrees under .claude/worktrees share the prefix.
 */
export function defaultTranscriptFolders(env = process.env, home = homedir(), root = repoRoot()) {
  const projects = join(env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(home, '.claude'), 'projects')
  const prefix = root.replace(/[^a-zA-Z0-9]/g, '-')
  let names
  try {
    names = readdirSync(projects)
  } catch {
    return []
  }
  return names.filter((name) => name === prefix || name.startsWith(`${prefix}-`)).map((name) => join(projects, name))
}

/** Every transcript under `folder`; `journal.jsonl` of a Workflow is a step log without usage. */
function listTranscripts(folder, found = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) listTranscripts(path, found)
    else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name !== 'journal.jsonl') found.push(path)
  }
  return found
}

/** The text of a user message; a tool result is not a text block. */
function messageText(message) {
  const content = message?.content
  return typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : ''
}

const firstLine = (text) => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''

const number = (digits) => String(Number(digits)).padStart(2, '0')

/**
 * Where a brief names its Ticket, as `<epic>/<NN>`. Each form gives the Epic and the number:
 * "ticket 39 of epic X" or its Russian form; "ticket X 39" or "ticket X/39"; a bare "X/39",
 * "X 39" or "X ticket 39" when X has a dash (worfy-canvas/18, worfy-harness 51), so that "PR 12"
 * or "round 2" is no Ticket; a Ticket file path, `.scratch/X/issues/39-…`.
 */
// shortcut: accepts the old Russian token of the Russian briefs, until the Harness writes briefs in English only (Epic worfy-neutral)
const TICKET_FORMS = [
  /\b[Tt]icket\s+(?<num>\d{1,3})\s+(?:of\s+(?:the\s+)?epic|эпика)\s+`?(?<epic>[a-z][a-z0-9-]*)/,
  /\b[Tt]icket\s+`?(?<epic>[a-z][a-z0-9]*(?:-[a-z0-9]+)*)`?[ /](?<num>\d{1,3})(?![\w.])/,
  /(?<![\w./-])(?<epic>[a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\/| ticket | )(?<num>\d{1,3})(?![\w.])/,
  /\.scratch\/(?<epic>[a-z][a-z0-9-]*)\/issues\/(?<num>\d{1,3})-/,
]
/** How many lines of a brief the last step of ticketOf reads. */
const BRIEF_LINES = 8
/**
 * A line of those first lines that may name the brief's own Ticket: it has the word "ticket" (or
 * the Russian word for it), not "tickets", or a Ticket file path. A branch name, a commit or test
 * output in another line only mentions a Ticket.
 */
// shortcut: accepts the old Russian token of the Russian briefs, until the Harness writes briefs in English only (Epic worfy-neutral)
const NAMES_A_TICKET = /(?<!\p{L})(?:ticket|тикет)(?!\p{L})|\.scratch\/[a-z][a-z0-9-]*\/issues\/\d{1,3}-/iu

/** The Ticket the text names first, `<epic>/<NN>`, or null. */
function ticketIn(text) {
  let best
  for (const form of TICKET_FORMS) {
    const match = form.exec(text)
    if (match && (best === undefined || match.index < best.index)) best = match
  }
  return best === undefined ? null : `${best.groups.epic}/${number(best.groups.num)}`
}

/**
 * The Ticket of a subagent from its brief, `<epic>/<NN>`, or null. The first line, then a line
 * that starts with `Ticket:`, then the lines among the first BRIEF_LINES that NAMES_A_TICKET
 * accepts: briefs often open with the repository and name the Ticket a line or two later.
 */
// shortcut: a line such as "added by worfy-x ticket 18" still gives its Ticket, redo it if the per-ticket rows must be exact
export function ticketOf(brief) {
  const lines = brief.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const ticketLine = lines.find((line) => /^\**Ticket\**\s*:/.test(line))
  const naming = lines.slice(0, BRIEF_LINES).filter((line) => NAMES_A_TICKET.test(line))
  return ticketIn(lines[0] ?? '') ?? (ticketLine === undefined ? null : ticketIn(ticketLine)) ?? ticketIn(naming.join('\n'))
}

/**
 * The Tickets of a wave command a user message starts with — the Autopilot's
 * `/worfy:epic-wave tickets 01, 02 of epic X` (in a transcript, the command-name and command-args
 * tags) or the older Russian form of the same command — as `<epic>/<NN>`; [] for a wave command
 * without Ticket numbers (the oldest form, by Wave number); null for any other message.
 */
export function waveTickets(text) {
  const start = text.trimStart()
  if (!/^(?:<command-message>(?:worfy:)?epic-wave<\/command-message>|\/(?:worfy:)?epic-wave\s)/.test(start)) return null
  // shortcut: accepts the old Russian token of the older wave command, until no transcript in a measured period has it
  const match = /(?:tickets|Ticket-ы)\s+(?<nums>\d{1,3}(?:[,\s]+\d{1,3})*)\s+(?:of\s+epic|эпика)\s+(?<epic>[a-z][a-z0-9-]*)/.exec(start)
  if (match === null) return []
  return match.groups.nums.split(/[,\s]+/).map((num) => `${match.groups.epic}/${number(num)}`)
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELL_READERS = new Set(['cat', 'head', 'tail', 'sed', 'nl', 'less', 'more'])

/**
 * The files a shell command prints: the path arguments of cat, head, tail, nl, less, more and
 * `sed -n`, in each part of the command between `&&`, `||`, `;`, `|` and a line break. A part that
 * redirects (`cat > file`) writes, not reads; a word is a path when it has a slash or a dot and no
 * `$`, glob or redirect.
 * shortcut: a word split, not a shell parser — a quoted path with spaces, a path relative to a
 * `cd` and one in a variable are missed; redo it if a decision rests on the file counts alone.
 */
export function shellReads(command) {
  const paths = []
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const words = part.trim().split(/\s+/)
    if (!SHELL_READERS.has(words[0]) || /[<>]/.test(part) || (words[0] === 'sed' && !words.includes('-n'))) continue
    for (const raw of words.slice(1)) {
      const word = raw.replace(/^['"]|['"]$/g, '')
      if (word.startsWith('-') || !/[/.]/.test(word) || /[$*?`'"]/.test(word) || /^[\d,$p;]+$/.test(word) || word.startsWith('/dev/')) continue
      paths.push(word)
    }
  }
  return paths
}

/**
 * What a response of --waits came right after, strongest first: the result of a CI wait, the
 * notice that a background command or a Monitor ended (both are waits), the notice that a subagent
 * finished (shown apart, not a wait).
 */
export const WAIT_KINDS = ['ci', 'background', 'agent']
const COUNTED_WAITS = ['ci', 'background']

/**
 * Whether a shell command waits for CI: `gh pr checks … --watch` or `gh run watch`.
 * shortcut: matched as text, as shellReads does; a wait in a script or a polling loop of
 * `gh pr checks` without --watch is not seen, redo it if the CI share must be exact.
 */
export const ciWait = (command) => /\bgh\s+(?:pr\s+checks\b[^\n;&|]*\s--watch\b|run\s+watch\b)/.test(command)

/**
 * Notes in `pending` what a main session's user line brings: a task notification (Claude Code's
 * `<task-notification>` message) that a background command ended or a Monitor printed an event
 * ("Monitor event: …", one per event), or of a subagent; the result of a tool call in `ciTools`. A response after several of them gets the first of WAIT_KINDS among
 * them; a prompt of the person in between does not change that.
 */
function noteWait(message, pending, ciTools) {
  const content = message?.content
  const results = Array.isArray(content) ? content.filter((block) => block?.type === 'tool_result') : []
  for (const block of results) if (ciTools.delete(block.tool_use_id)) pending.add('ci')
  const text = results.length > 0 ? '' : messageText(message).trimStart()
  if (!text.startsWith('<task-notification>')) return
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1].trim() ?? ''
  if (/^(?:Background command|Monitor)\b/.test(summary)) pending.add('background')
  else if (/^(?:Background agent|Agent)\b|^\d+ background agents\b/.test(summary)) pending.add('agent')
}

/**
 * A path a subagent read, relative to its repository: the part after `.claude/worktrees/<name>/`,
 * else after the repository of its working directory; any other path stays as it is.
 */
function repoPath(path, cwd) {
  const p = path.replaceAll('\\', '/')
  const inWorktree = /\/\.claude\/worktrees\/[^/]+\/(.+)$/.exec(p)
  if (inWorktree) return inWorktree[1]
  const root = (cwd ?? '').replaceAll('\\', '/').split('/.claude/worktrees/')[0]
  return root !== '' && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p
}

/**
 * The role of a transcript. The rule, first match wins:
 *   1. a file outside a `subagents` folder is a main session: orchestrator;
 *   2. `agentType` of the subagent's meta.json: one ending in "implementer" is implementer, in
 *      "reviewer" is reviewer, "Explore" or one ending in "scout" is scout;
 *   3. otherwise the agent's name and description from meta.json — or, without them, the first line
 *      of the brief (the first user message) — matched in lower case: "impl" or "implement" at a
 *      word start is implementer; review, verif, refute, sceptic or skeptic, lens, audit or "check"
 *      at a word start is reviewer; scout or explore is scout;
 *   4. anything else is other.
 * A verifier counts as reviewer, a rework round of an implementer as implementer.
 */
export function roleOf({ subagent, agentType = '', name = '', description = '', brief = '' }) {
  if (!subagent) return 'orchestrator'
  if (/implementer$/.test(agentType)) return 'implementer'
  if (/reviewer$/.test(agentType)) return 'reviewer'
  if (agentType === 'Explore' || /scout$/.test(agentType)) return 'scout'
  const named = `${name} ${description}`.trim()
  const text = (named === '' ? brief : named).toLowerCase()
  if (/\bimpl/.test(text)) return 'implementer'
  if (/review|verif|refute|s[ck]eptic|\blens|audit|\bcheck/.test(text)) return 'reviewer'
  if (/scout|explore/.test(text)) return 'scout'
  return 'other'
}

function readMeta(path) {
  try {
    const meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
    return meta && typeof meta === 'object' ? meta : {}
  } catch {
    return {}
  }
}

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0)

/**
 * The responses of one transcript, its brief (the first user message of a subagent), its working
 * directory and, for a main session, its wave commands. Only lines that carry a usage, the first
 * user line of a subagent and a main session's user lines that mention epic-wave are parsed: a
 * main session runs to hundreds of megabytes. With `waits` a main session's user lines are parsed
 * too, and each response gets the wait it came right after (waitKind), or null.
 */
async function readTranscript(path, subagent, waits = false) {
  const calls = []
  const waves = []
  let brief
  let cwd
  let order = 0
  const noteWaits = waits && !subagent
  // What came in since the previous response: kinds of WAIT_KINDS, and the CI waits still running.
  const pending = new Set()
  const ciTools = new Set()
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    const wantBrief = subagent && brief === undefined && line.includes('"user"')
    const wantWave = !subagent && line.includes('epic-wave') && line.includes('"user"')
    const wantWait = noteWaits && line.includes('"user"')
    if (!wantBrief && !wantWave && !wantWait && !line.includes('"usage"')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (cwd === undefined && typeof entry?.cwd === 'string') cwd = entry.cwd
    if (entry?.type === 'user' && wantBrief && !entry.isMeta) {
      brief = messageText(entry.message)
      continue
    }
    if (entry?.type === 'user' && (wantWave || wantWait)) {
      if (entry.isMeta) continue
      if (wantWait) noteWait(entry.message, pending, ciTools)
      const tickets = wantWave ? waveTickets(messageText(entry.message)) : null
      const ts = Date.parse(entry.timestamp)
      if (tickets !== null && !Number.isNaN(ts)) waves.push({ ts, tickets })
      continue
    }
    const message = entry?.type === 'assistant' ? entry.message : undefined
    const usage = message?.usage
    if (!usage || typeof usage !== 'object' || message.model === '<synthetic>') continue
    const ts = Date.parse(entry.timestamp)
    if (Number.isNaN(ts)) continue
    const split = usage.cache_creation
    const hasSplit = split && typeof split === 'object' && ('ephemeral_5m_input_tokens' in split || 'ephemeral_1h_input_tokens' in split)
    const written = count(usage.cache_creation_input_tokens)
    const tools = Array.isArray(message.content) ? message.content.filter((block) => block?.type === 'tool_use') : []
    // The second line of a response finds nothing pending: measure keeps the wait of its first line.
    const wait = noteWaits ? (WAIT_KINDS.find((kind) => pending.has(kind)) ?? null) : null
    pending.clear()
    // A CI wait run in the background answers at once ("Command running in background"); it is
    // counted once, by the notice that it ended.
    for (const block of tools) if (noteWaits && block.name === 'Bash' && block.input?.run_in_background !== true && ciWait(String(block.input?.command ?? ''))) ciTools.add(block.id)
    calls.push({
      wait,
      id: message.id || entry.requestId || `${path}#${order}`,
      ts,
      model: message.model || '',
      fast: usage.speed === 'fast',
      input: count(usage.input_tokens),
      output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      write5m: hasSplit ? count(split.ephemeral_5m_input_tokens) : written,
      write1h: hasSplit ? count(split.ephemeral_1h_input_tokens) : 0,
      edit: tools.some((block) => EDIT_TOOLS.has(block.name)),
      reads: tools.flatMap((block) => {
        if (block.name === 'Read' && typeof block.input?.file_path === 'string') return [block.input.file_path]
        if (block.name === 'Bash' && typeof block.input?.command === 'string') return shellReads(block.input.command)
        return []
      }),
    })
    order++
  }
  return { calls, brief: brief ?? '', cwd, waves }
}

/** Dollars of a response: [all, the cache write part]. */
function costOf(call, unpriced) {
  if (!(call.model in PRICES)) unpriced.add(call.model)
  const [input, output, read, write5m, write1h] = PRICES[call.model] ?? PRICES[FALLBACK_MODEL]
  const k = (call.fast ? FAST_MULTIPLIER : 1) / 1e6
  const write = (call.write5m * write5m + call.write1h * write1h) * k
  return [(call.input * input + call.output * output + call.cacheRead * read) * k + write, write]
}

const contextOf = (call) => call.input + call.cacheRead + call.write5m + call.write1h

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The report over the transcript files: plain numbers, dollars and tokens. */
export async function measure(files, options) {
  const byId = new Map()
  let duplicates = 0
  const transcripts = []
  for (const path of files) {
    // A file last written before the period holds no response of it.
    if (statSync(path).mtimeMs < options.sinceMs) continue
    const subagent = path.split(sep).includes('subagents')
    const meta = subagent ? readMeta(path) : {}
    const { calls, brief, cwd, waves } = await readTranscript(path, subagent, options.waits)
    const role = roleOf({ subagent, agentType: meta.agentType, name: meta.name, description: meta.description, brief: firstLine(brief) })
    const transcript = { subagent, role, calls: [], ticket: subagent ? ticketOf(brief) : null, cwd, waves }
    transcripts.push(transcript)
    for (const call of calls) {
      const seen = byId.get(call.id)
      if (seen === undefined) {
        call.transcript = transcript
        byId.set(call.id, call)
        continue
      }
      duplicates++
      for (const key of ['input', 'output', 'cacheRead', 'write5m', 'write1h']) seen[key] = Math.max(seen[key], call[key])
      seen.edit ||= call.edit
      seen.reads.push(...call.reads)
      if (call.ts < seen.ts) {
        seen.ts = call.ts
        seen.transcript = transcript
      }
    }
  }
  for (const call of byId.values()) call.transcript.calls.push(call)

  const unpriced = new Set()
  const roles = Object.fromEntries(ROLES.map((role) => [role, { calls: 0, cost: 0 }]))
  const rewrite = { calls: 0, cost: 0, byRole: Object.fromEntries(ROLES.map((role) => [role, { calls: 0, cost: 0 }])) }
  const orchestrator = { calls: 0, context: 0, cacheRead: 0 }
  const part = () => ({ calls: 0, tokens: 0, cost: 0 })
  const waits = { orchestratorCalls: 0, orchestratorTokens: 0, ...part(), byKind: Object.fromEntries(WAIT_KINDS.map((kind) => [kind, part()])) }
  const starts = Object.fromEntries(ROLES.filter((role) => role !== 'orchestrator').map((role) => [role, []]))
  let total = 0
  let calls = 0
  const inPeriod = (call) => call.ts >= options.sinceMs && call.ts < options.untilMs
  for (const transcript of transcripts) {
    transcript.calls.sort((a, b) => a.ts - b.ts)
    // The pause is measured over the whole transcript: the response before the period still
    // makes the first one in it a rewrite or not.
    let previous
    for (const call of transcript.calls) {
      const pause = previous === undefined ? 0 : call.ts - previous.ts
      previous = call
      if (!inPeriod(call)) continue
      const [cost, write] = costOf(call, unpriced)
      const context = contextOf(call)
      calls++
      total += cost
      roles[transcript.role].calls++
      roles[transcript.role].cost += cost
      if (pause > IDLE_MS && call.write5m + call.write1h > context / 2) {
        rewrite.calls++
        rewrite.cost += write
        rewrite.byRole[transcript.role].calls++
        rewrite.byRole[transcript.role].cost += write
      }
      if (transcript.role === 'orchestrator') {
        orchestrator.calls++
        orchestrator.context += context
        orchestrator.cacheRead += call.cacheRead
        waits.orchestratorCalls++
        waits.orchestratorTokens += tokensOf(call)
        const counted = call.wait === null ? [] : COUNTED_WAITS.includes(call.wait) ? [waits.byKind[call.wait], waits] : [waits.byKind[call.wait]]
        for (const sum of counted) {
          sum.calls++
          sum.tokens += tokensOf(call)
          sum.cost += cost
        }
      }
    }
    const first = transcript.calls[0]
    if (transcript.subagent && first !== undefined && inPeriod(first)) {
      starts[transcript.role].push({ day: new Date(first.ts).toISOString().slice(0, 10), context: contextOf(first) })
    }
  }

  const share = (part) => (total > 0 ? part / total : 0)
  for (const role of ROLES) roles[role].share = share(roles[role].cost)
  rewrite.share = share(rewrite.cost)
  const startContext = {}
  for (const [role, list] of Object.entries(starts)) {
    const byDay = {}
    for (const day of [...new Set(list.map((s) => s.day))].sort()) {
      const of = list.filter((s) => s.day === day).map((s) => s.context)
      byDay[day] = { agents: of.length, median: median(of) }
    }
    const all = list.map((s) => s.context)
    startContext[role] = { agents: all.length, median: median(all), mean: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0, byDay }
  }
  const report = {
    period: { since: options.since ?? null, until: options.until ?? null },
    transcripts: transcripts.length,
    calls,
    duplicates,
    cost: total,
    roles,
    idleRewrite: rewrite,
    orchestratorContext: {
      calls: orchestrator.calls,
      meanContext: orchestrator.calls ? orchestrator.context / orchestrator.calls : 0,
      meanCacheRead: orchestrator.calls ? orchestrator.cacheRead / orchestrator.calls : 0,
    },
    startContext,
    unpricedModels: [...unpriced].sort(),
  }
  if (options.byTicket) report.tickets = byTicket(transcripts, inPeriod)
  if (options.idle) report.idle = idleOf(transcripts, inPeriod)
  if (options.waits) {
    const { orchestratorCalls, orchestratorTokens } = waits
    report.waits = { ...waits, share: orchestratorCalls ? waits.calls / orchestratorCalls : 0, tokenShare: orchestratorTokens ? waits.tokens / orchestratorTokens : 0 }
  }
  return report
}

/**
 * The --idle numbers per role, from transcripts whose responses are sorted by time. A pause is the
 * time from one response of a transcript to the next, measured over the whole transcript like the
 * idle rewrite. An agent is a transcript with a response in the period. With a 1-hour cache every
 * cache write would cost the 1-hour price, and a response after a pause of 5-60 min would read,
 * not write, the context the previous response had: the previous context less what this response
 * read from the cache or sent uncached, at most what it wrote. `saving` is the write cost now less
 * the cost with 1 hour, positive when 1 hour is cheaper.
 */
function idleOf(transcripts, inPeriod) {
  const sums = Object.fromEntries(ROLES.map((role) => [role, { perAgent: [], pauses: 0, longPauses: 0, rewrite: { calls: 0, cost: 0 }, writeCost: 0, writeCost1h: 0 }]))
  for (const transcript of transcripts) {
    const sum = sums[transcript.role]
    let pauses
    let previous
    for (const call of transcript.calls) {
      const before = previous
      previous = call
      if (!inPeriod(call)) continue
      pauses ??= 0
      const pause = before === undefined ? 0 : call.ts - before.ts
      const bridged = pause > IDLE_MS && pause <= HOUR_MS
      const [, , read, write5m, write1h] = PRICES[call.model] ?? PRICES[FALLBACK_MODEL]
      const k = (call.fast ? FAST_MULTIPLIER : 1) / 1e6
      const written = call.write5m + call.write1h
      const kept = bridged ? Math.min(written, Math.max(0, contextOf(before) - call.cacheRead - call.input)) : 0
      const write = (call.write5m * write5m + call.write1h * write1h) * k
      sum.writeCost += write
      sum.writeCost1h += ((written - kept) * write1h + kept * read) * k
      if (pause > HOUR_MS) sum.longPauses++
      if (!bridged) continue
      pauses++
      sum.pauses++
      if (written > contextOf(call) / 2) {
        sum.rewrite.calls++
        sum.rewrite.cost += write
      }
    }
    if (pauses !== undefined) sum.perAgent.push(pauses)
  }
  return Object.fromEntries(
    ROLES.map((role) => {
      const { perAgent, ...sum } = sums[role]
      return [role, { agents: perAgent.length, agentsWithPause: perAgent.filter((n) => n > 0).length, medianPauses: median(perAgent), ...sum, saving: sum.writeCost - sum.writeCost1h }]
    }),
  )
}

const tokensOf = (call) => call.input + call.output + call.cacheRead + call.write5m + call.write1h

/**
 * A row per Ticket. A subagent's response goes to the Ticket of its brief; an Orchestrator's to
 * the Tickets of the last wave command before it, split evenly; anything else to the row with
 * ticket null. An implementer's responses before the first one that calls Edit or Write are its
 * time before the first edit; the files it read by then (Read, or a shell command that prints a
 * file) are counted once per Ticket, and "earlier" when a subagent of another Ticket of the same
 * Epic read the same path before it did. An implementer that never calls Edit or Write (a round
 * that edits through the shell, rebases or only checks) is `noEdit`: neither scouting nor not.
 */
function byTicket(transcripts, inPeriod) {
  const rows = new Map()
  const rowOf = (ticket) => {
    let row = rows.get(ticket)
    if (row === undefined) {
      row = { ticket, tokens: 0, cost: 0, orchestrator: { tokens: 0, cost: 0 }, scout: { agents: 0, tokens: 0, cost: 0 }, noEdit: { agents: 0, tokens: 0, cost: 0 }, beforeFirstEdit: { agents: 0, tokens: 0, cost: 0, read: new Set(), earlier: new Set() } }
      rows.set(ticket, row)
    }
    return row
  }
  // Who read a path, per Epic: [time, Ticket] of every read of a subagent with a Ticket.
  const readers = new Map()
  for (const t of transcripts) {
    if (!t.subagent || t.ticket === null) continue
    const epic = t.ticket.split('/')[0]
    if (!readers.has(epic)) readers.set(epic, new Map())
    for (const call of t.calls) {
      for (const path of call.reads) {
        const key = repoPath(path, t.cwd)
        const list = readers.get(epic).get(key) ?? []
        list.push([call.ts, t.ticket])
        readers.get(epic).set(key, list)
      }
    }
  }
  const unpriced = new Set()
  for (const t of transcripts) {
    const waves = [...(t.waves ?? [])].sort((a, b) => a.ts - b.ts)
    const firstEdit = t.calls.findIndex((call) => call.edit)
    let counted = false
    t.calls.forEach((call, index) => {
      if (!inPeriod(call)) return
      const [cost] = costOf(call, unpriced)
      const tokens = tokensOf(call)
      if (!t.subagent) {
        const wave = waves.filter((w) => w.ts <= call.ts).at(-1)
        const tickets = wave === undefined || wave.tickets.length === 0 ? [null] : wave.tickets
        for (const ticket of tickets) {
          const row = rowOf(ticket)
          for (const part of [row, row.orchestrator]) {
            part.tokens += tokens / tickets.length
            part.cost += cost / tickets.length
          }
        }
        return
      }
      const row = rowOf(t.ticket)
      row.tokens += tokens
      row.cost += cost
      const implementer = t.role === 'implementer'
      const part = t.role === 'scout' ? row.scout : implementer && firstEdit === -1 ? row.noEdit : implementer && index < firstEdit ? row.beforeFirstEdit : undefined
      if (part === undefined) return
      if (!counted) part.agents++
      counted = true
      part.tokens += tokens
      part.cost += cost
      if (part !== row.beforeFirstEdit) return
      const epic = t.ticket?.split('/')[0]
      for (const path of call.reads) {
        const key = repoPath(path, t.cwd)
        part.read.add(key)
        const before = epic === undefined ? undefined : readers.get(epic)?.get(key)
        if (before?.some(([ts, ticket]) => ts < call.ts && ticket !== t.ticket)) part.earlier.add(key)
      }
    })
  }
  const share = (part, of) => (of > 0 ? part / of : 0)
  return [...rows.values()]
    .sort((a, b) => (a.ticket === null ? 1 : b.ticket === null ? -1 : a.ticket.localeCompare(b.ticket)))
    .map(({ beforeFirstEdit: { read, earlier, ...before }, ...row }) => ({
      ...row,
      beforeFirstEdit: { ...before, filesRead: read.size, filesReadEarlier: earlier.size },
      scoutingShare: { tokens: share(row.scout.tokens + before.tokens, row.tokens), cost: share(row.scout.cost + before.cost, row.cost) },
    }))
}

const dollars = (n) => `$${n.toFixed(2)}`
const percent = (n) => `${(n * 100).toFixed(1)}%`
const kTokens = (n) => `${(n / 1000).toFixed(1)}k`

const mTokens = (n) => `${(n / 1e6).toFixed(2)}M`

/**
 * The --by-ticket table: one row per Ticket. Scouting is the scouts and the implementers up to their
 * first edit; no-edit is the implementers that never called Edit or Write, left out of it.
 */
function toTicketTable(report) {
  const out = [
    'ticket                         tokens       cost  scout tok  pre-edit tok  no-edit tok  files  earlier  scouting tok  scouting cost',
  ]
  for (const row of report.tickets) {
    const b = row.beforeFirstEdit
    out.push(
      `${(row.ticket ?? '(no ticket)').padEnd(28)} ${mTokens(row.tokens).padStart(8)} ${dollars(row.cost).padStart(10)} ${mTokens(row.scout.tokens).padStart(10)} ${mTokens(b.tokens).padStart(13)} ${mTokens(row.noEdit.tokens).padStart(12)} ${String(b.filesRead).padStart(6)} ${String(b.filesReadEarlier).padStart(8)} ${percent(row.scoutingShare.tokens).padStart(13)} ${percent(row.scoutingShare.cost).padStart(14)}`,
    )
  }
  return out
}

/** The --waits lines: the share of Orchestrator responses that come right after a wait, by kind. */
function toWaitLines({ waits }) {
  if (waits === undefined) return []
  const line = (label, part, note = '') =>
    `  ${label.padEnd(32)} ${String(part.calls).padStart(6)} ${kTokens(part.tokens).padStart(10)} tokens ${dollars(part.cost).padStart(9)}${note}`
  return [
    '',
    `Orchestrator waits: ${waits.calls} of ${waits.orchestratorCalls} responses (${percent(waits.share)}) come right after a wait; ${kTokens(waits.tokens)} tokens (${percent(waits.tokenShare)} of the Orchestrator's), ${dollars(waits.cost)}`,
    line('background command or Monitor', waits.byKind.background),
    line('CI wait (gh … --watch)', waits.byKind.ci),
    line('a subagent finished', waits.byKind.agent, '  (not a wait)'),
  ]
}

/** The --idle lines: a row per role with an agent. */
function toIdleLines({ idle }) {
  if (idle === undefined) return []
  const out = [
    '',
    `Pauses a 1-hour prompt cache keeps (${IDLE_MS / 60000}-${HOUR_MS / 60000} min) and the cache write cost with it:`,
    '  role          agents  with pause  median  pauses  over 1 h  rewrites  rewrite cost  writes now  writes 1 h     saving',
  ]
  for (const role of ROLES) {
    const r = idle[role]
    if (r.agents === 0) continue
    out.push(
      `  ${role.padEnd(12)} ${String(r.agents).padStart(7)} ${String(r.agentsWithPause).padStart(11)} ${String(r.medianPauses).padStart(7)} ${String(r.pauses).padStart(7)} ${String(r.longPauses).padStart(9)} ${String(r.rewrite.calls).padStart(9)} ${dollars(r.rewrite.cost).padStart(13)} ${dollars(r.writeCost).padStart(11)} ${dollars(r.writeCost1h).padStart(11)} ${dollars(r.saving).padStart(10)}`,
    )
  }
  return out
}

function toTable(report) {
  const { period, roles, idleRewrite, orchestratorContext, startContext } = report
  const out = [
    `Period: ${period.since ?? 'start'} .. ${period.until ?? 'end'}; ${report.calls} responses in ${report.transcripts} transcripts, ${report.duplicates} duplicate lines counted once`,
    `Total: ${dollars(report.cost)} at API list prices`,
    '',
  ]
  if (report.tickets !== undefined) {
    out.push(...toTicketTable(report), ...toWaitLines(report), ...toIdleLines(report))
    if (report.unpricedModels.length) out.push('', `Priced as ${FALLBACK_MODEL}: ${report.unpricedModels.join(', ')}`)
    return `${out.join('\n')}\n`
  }
  out.push(
    'role          responses        cost   share   idle rewrite  rewrite cost',
  )
  for (const role of ROLES) {
    const r = roles[role]
    const w = idleRewrite.byRole[role]
    out.push(`${role.padEnd(12)} ${String(r.calls).padStart(10)} ${dollars(r.cost).padStart(11)} ${percent(r.share).padStart(7)} ${String(w.calls).padStart(13)} ${dollars(w.cost).padStart(13)}`)
  }
  out.push(
    '',
    `Cache rewritten after a pause > ${IDLE_MS / 60000} min: ${idleRewrite.calls} responses, ${dollars(idleRewrite.cost)}, ${percent(idleRewrite.share)} of the total`,
    `Orchestrator context per call: ${kTokens(orchestratorContext.meanContext)} tokens on average (cache read ${kTokens(orchestratorContext.meanCacheRead)}), ${orchestratorContext.calls} calls`,
    '',
    'Start context of a subagent (input + cache write + cache read of its first request):',
  )
  for (const [role, s] of Object.entries(startContext)) {
    if (s.agents === 0) continue
    const days = Object.entries(s.byDay).map(([day, d]) => `${day.slice(5)} ${kTokens(d.median)} (${d.agents})`).join(', ')
    out.push(`  ${role.padEnd(12)} ${s.agents} agents, median ${kTokens(s.median)}, mean ${kTokens(s.mean)}; by day, median: ${days}`)
  }
  out.push(...toWaitLines(report), ...toIdleLines(report))
  if (report.unpricedModels.length) out.push('', `Priced as ${FALLBACK_MODEL}: ${report.unpricedModels.join(', ')}`)
  return `${out.join('\n')}\n`
}

/** Runs the report and returns the exit code; `deps` is the real system unless a test passes its own. */
export async function agentCost(args, deps = { env: process.env, home: homedir(), cwd: process.cwd(), out: (t) => process.stdout.write(t), err: (l) => process.stderr.write(`${l}\n`) }) {
  let options
  try {
    options = parseArgs(args)
  } catch (error) {
    deps.err(`agent-cost: ${error.message}`)
    deps.err('usage: node scripts/agent-cost.mjs [--transcripts <folder>] [--since <date>] [--until <date>] [--by-ticket] [--waits] [--idle] [--json] | --help')
    return REFUSED
  }
  if (options.help) {
    deps.out(`${HELP}\n`)
    return 0
  }
  const folders = options.transcripts !== undefined ? [resolve(deps.cwd, options.transcripts)] : defaultTranscriptFolders(deps.env, deps.home)
  const missing = folders.length === 0 ? '(none for this repository)' : folders.find((folder) => !isFolder(folder))
  if (missing !== undefined) {
    deps.err(`agent-cost: no transcripts folder: ${missing}`)
    return REFUSED
  }
  const report = await measure(folders.flatMap((folder) => listTranscripts(folder)), options)
  deps.out(options.json ? `${JSON.stringify(report, null, 2)}\n` : toTable(report))
  return 0
}

function isFolder(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function runAsScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) process.exitCode = await agentCost(process.argv.slice(2))
