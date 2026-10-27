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
function parseArgs(args) {
  const options = { json: false, help: false }
  const valued = { '--transcripts': 'transcripts', '--since': 'since', '--until': 'until' }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') options.json = true
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

/** The first line of the first user message: the brief of a subagent. */
function briefLine(message) {
  const content = message?.content
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : ''
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''
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
 * The responses of one transcript and its first brief line. Only lines that carry a usage (and,
 * for a subagent, the first user line) are parsed: a main session runs to hundreds of megabytes.
 */
async function readTranscript(path, subagent) {
  const calls = []
  let brief
  let order = 0
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    const wantBrief = subagent && brief === undefined && line.includes('"user"')
    if (!wantBrief && !line.includes('"usage"')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.type === 'user' && wantBrief && !entry.isMeta) {
      brief = briefLine(entry.message)
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
    calls.push({
      id: message.id || entry.requestId || `${path}#${order}`,
      ts,
      model: message.model || '',
      fast: usage.speed === 'fast',
      input: count(usage.input_tokens),
      output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      write5m: hasSplit ? count(split.ephemeral_5m_input_tokens) : written,
      write1h: hasSplit ? count(split.ephemeral_1h_input_tokens) : 0,
    })
    order++
  }
  return { calls, brief: brief ?? '' }
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
    const { calls, brief } = await readTranscript(path, subagent)
    const role = roleOf({ subagent, agentType: meta.agentType, name: meta.name, description: meta.description, brief })
    const transcript = { subagent, role, calls: [] }
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
  return {
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
}

const dollars = (n) => `$${n.toFixed(2)}`
const percent = (n) => `${(n * 100).toFixed(1)}%`
const kTokens = (n) => `${(n / 1000).toFixed(1)}k`

function toTable(report) {
  const { period, roles, idleRewrite, orchestratorContext, startContext } = report
  const out = [
    `Period: ${period.since ?? 'start'} .. ${period.until ?? 'end'}; ${report.calls} responses in ${report.transcripts} transcripts, ${report.duplicates} duplicate lines counted once`,
    `Total: ${dollars(report.cost)} at API list prices`,
    '',
    'role          responses        cost   share   idle rewrite  rewrite cost',
  ]
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
    deps.err('usage: node scripts/agent-cost.mjs [--transcripts <folder>] [--since <date>] [--until <date>] [--json] | --help')
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
