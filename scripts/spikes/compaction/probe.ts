// Spike for ticket worfy-continuity/01 (result: the result section of ticket 01 in
// .scratch/worfy-continuity/issues/): how Claude Code
// compacts a conversation — which hooks fire, which instruction source the summary follows, what
// survives — and how it continues a transcript that was cut off in the middle of a tool call.
//
// Run from the repository root, one scenario per command, by hand and never in CI (it calls a real
// model, and every run costs money):
//
//   pnpm exec electron scripts/spikes/compaction/probe.ts manual    # `/compact <text>`: questions 1 (main), 2, 3, 4
//   pnpm exec electron scripts/spikes/compaction/probe.ts auto      # auto-compaction at a low threshold: questions 1, 2, 4
//   pnpm exec electron scripts/spikes/compaction/probe.ts subagent  # a Subagent that compacts: question 1 (Subagent)
//   pnpm exec electron scripts/spikes/compaction/probe.ts cutoff    # Claude Code killed during a Bash call, then resumed: question 6
//
// Options: --out <dir> (default $TMPDIR/worfy-compaction-probe/<timestamp>), --model <model>
// (default haiku, the cheapest model that follows these short prompts), --window <tokens> and
// --pct <n> (the auto-compaction window, CLAUDE_CODE_AUTO_COMPACT_WINDOW, default 100000, and the
// threshold in percent of it, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, default 5; for `auto` and `subagent`), --signal <SIGKILL|SIGTERM> (how `cutoff` stops Claude Code; default
// SIGKILL, a crash).
//
// What a run touches: sessions run with no settings sources (no user or project settings, hooks,
// CLAUDE.md or plugins of the user), only the spike plugin in fixture/ and the user's login. Each
// session works in a fresh temporary directory, so Claude Code writes its transcript under
// ~/.claude/projects/<that directory>/ — summary.json lists those files. Question 5 (Codex) is not
// run here: the brief forbids starting the real Codex binary.
//
// Electron 44 runs this file directly (Node 24 strips the types): erasable syntax only.

import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, Query, SDKMessage, SDKUserMessage, SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'
import { scrubPersonal } from '../personal-scrub.mjs'

type Scenario = 'manual' | 'auto' | 'subagent' | 'cutoff'
type Facts = Record<string, unknown>
type Row = Record<string, unknown>

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('probe.ts')) + 1)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const flagValues = new Set([flag('--out'), flag('--model'), flag('--pct'), flag('--window'), flag('--signal')])
const scenarios = args.filter((a) => !a.startsWith('--') && !flagValues.has(a)) as Scenario[]
const outDir = resolve(flag('--out') ?? join(tmpdir(), 'worfy-compaction-probe', new Date().toISOString().replace(/[:.]/g, '-')))
const MODEL = flag('--model') ?? 'haiku'
const PCT = flag('--pct') ?? '5'
// haiku has a 1M window here (effectiveWindow=980000 in the debug log): the smallest auto-compaction
// window first, then the percentage of it.
const WINDOW = flag('--window') ?? '100000'
const SIGNAL = (flag('--signal') ?? 'SIGKILL') as NodeJS.Signals
const repo = process.cwd()
const home = homedir()
const FIXTURE = join(repo, 'scripts', 'spikes', 'compaction', 'fixture')
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-compaction-probe-')))
const hooksOut = join(outDir, 'hooks')

// One mark per instruction source of the summary (question 2). The fixture hook carries the RULES
// mark (SessionStart additionalContext) and the PRECOMPACT mark (PreCompact stdout).
const MARKS = { rules: 'kestrel-17', precompact: 'osprey-23', slash: 'heron-31', system_prompt: 'falcon-47' }
const SYSTEM_APPEND = `Spike note appended to the system prompt: the project code word is ${MARKS.system_prompt}. Whenever you write a summary of this conversation, include the line SYSPROMPT-MARK: ${MARKS.system_prompt}.`
const SLASH_TEXT = `Include the line SLASH-MARK: ${MARKS.slash} in the summary.`
const QUESTION = [
  'Answer in exactly three lines, from what you know now, without using any tool:',
  '1) the project code word from your system prompt;',
  '2) the deploy target I told you earlier;',
  '3) the RULES-MARK value from the project rules.',
  'Write "unknown" for anything you do not know.',
].join('\n')
// Not "remember": that word sends Claude Code to its auto-memory files (first run of this spike).
const REMEMBER = 'Keep this fact in mind for later: the deploy target is staging-east. Reply with: ok'

// --- environment ---------------------------------------------------------------------------

// Variables a parent Claude Code session leaves behind; worfy started from Finder has none.
const INHERITED = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_|CLAUDE_AUTOCOMPACT_)|^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_ENV_FILE|GH_TOKEN|GITHUB_TOKEN)$/
function cleanEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) if (!INHERITED.test(k)) env[k] = v
  return {
    ...env,
    WORFY_SPIKE_OUT: hooksOut,
    // The account's claude.ai connectors join after the first request and bring hundreds of tools:
    // on the first run they made the request after compaction 700K tokens long. Auto-memory sent
    // haiku looking for memory files it had no tool to read.
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    ...extra,
  }
}

/** The Claude Code binary of the SDK's platform package — the one worfy runs. */
function bundledClaude(): string {
  const sdkPkg = realpathSync(join(repo, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'))
  const pkg = createRequire(sdkPkg).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
  return join(dirname(pkg), 'claude')
}
const CLAUDE_BIN = bundledClaude()

/** Home directory and temporary paths out, then the owner's personal words (scripts/spikes/personal-scrub.mjs). */
function scrub(s: string): string {
  return scrubPersonal(s.split(scratch).join('<tmp>').split(home).join('~'))
}
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return scrub(value)
  if (Array.isArray(value)) return value.map((v) => sanitize(v))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]))
  return value
}

function workDir(name: string): string {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

// --- driving a session ---------------------------------------------------------------------

class Inbox {
  private queue: SDKUserMessage[] = []
  private wake: (() => void) | undefined
  private closed = false
  push(text: string): void {
    this.queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null } as SDKUserMessage)
    this.wake?.()
  }
  close(): void {
    this.closed = true
    this.wake?.()
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const next = this.queue.shift()
      if (next) {
        yield next
        continue
      }
      if (this.closed) return
      await new Promise<void>((r) => (this.wake = r))
      this.wake = undefined
    }
  }
}

type Session = {
  q: Query
  messages: Row[]
  stderr: string[]
  /** The Claude Code process, once the SDK has started it. */
  child: () => ChildProcess | undefined
  /** Sends one prompt; resolves with the next result message (or undefined when the stream ends). */
  turn: (prompt: string, ms?: number) => Promise<SDKMessage | undefined>
  /** Sends one prompt without waiting. */
  send: (prompt: string) => void
  finish: () => Promise<void>
}

function start(options: Options): Session {
  const inbox = new Inbox()
  let proc: ChildProcess | undefined
  const stderr: string[] = []
  // Started here rather than by the SDK, so `cutoff` can kill it the way a crash would.
  const spawnClaudeCodeProcess = (o: SpawnOptions): SpawnedProcess => {
    proc = spawn(o.command, o.args, { cwd: o.cwd, env: o.env, signal: o.signal, stdio: ['pipe', 'pipe', 'pipe'] })
    proc.stderr?.on('data', (d: Buffer) => {
      stderr.push(d.toString())
      if (stderr.length > 50) stderr.shift()
    })
    return proc as unknown as SpawnedProcess
  }
  const q = query({ prompt: inbox, options: { ...options, spawnClaudeCodeProcess } })
  const messages: Row[] = []
  let waiters: ((m: SDKMessage | undefined) => void)[] = []
  const settle = (m: SDKMessage | undefined) => {
    const ws = waiters
    waiters = []
    for (const w of ws) w(m)
  }
  const pump = (async () => {
    try {
      for await (const m of q) {
        messages.push(m as unknown as Row)
        if (m.type === 'result') settle(m)
      }
    } catch (err) {
      messages.push({ probe_error: String(err) })
    }
    settle(undefined)
  })()
  const nextResult = (ms: number) =>
    new Promise<SDKMessage | undefined>((res) => {
      const timer = setTimeout(() => res(undefined), ms)
      waiters.push((m) => {
        clearTimeout(timer)
        res(m)
      })
    })
  return {
    q,
    messages,
    stderr,
    child: () => proc,
    turn: (prompt, ms = 300_000) => {
      const p = nextResult(ms)
      inbox.push(prompt)
      return p
    },
    send: (prompt) => inbox.push(prompt),
    finish: async () => {
      inbox.close()
      await Promise.race([pump, new Promise((r) => setTimeout(r, 30_000))])
      if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
    },
  }
}

const sessionOptions = (cwd: string, extra: Partial<Options> = {}): Options => ({
  cwd,
  model: MODEL,
  // Nothing of the user's: no settings, hooks, CLAUDE.md or plugins — only the spike plugin.
  settingSources: [],
  systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
  plugins: [{ type: 'local', path: FIXTURE }],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  pathToClaudeCodeExecutable: CLAUDE_BIN,
  env: cleanEnv(),
  strictMcpConfig: true,
  mcpServers: {},
  // Adaptive thinking ran to the 128K output limit on "Reply with: ok" in the first run.
  thinking: { type: 'disabled' },
  tools: [],
  maxTurns: 4,
  ...extra,
})

// --- reading what happened -----------------------------------------------------------------

const readLines = (file: string): Row[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Row)
    : []
const hookLines = (sessionId: string | undefined) => readLines(join(hooksOut, 'hooks.jsonl')).filter((l) => l.session_id === sessionId)
const sessionIdOf = (s: Session) => s.messages.find((m) => m.type === 'system' && m.subtype === 'init')?.session_id as string | undefined
const marksIn = (text: unknown): string[] => (typeof text === 'string' ? Object.entries(MARKS).filter(([, v]) => text.includes(v)).map(([k]) => k) : [])
const boundaries = (s: Session) => s.messages.filter((m) => m.type === 'system' && m.subtype === 'compact_boundary').map((m) => m.compact_metadata)
const results = (s: Session) =>
  s.messages
    .filter((m) => m.type === 'result')
    .map((m) => ({ subtype: m.subtype, is_error: m.is_error, num_turns: m.num_turns, total_cost_usd: m.total_cost_usd, result: typeof m.result === 'string' ? m.result.slice(0, 600) : null }))
/** The running cost of the session: each result carries the total so far. */
const costOf = (s: Session): number | null => {
  const r = s.messages.filter((m) => m.type === 'result').at(-1)
  return typeof r?.total_cost_usd === 'number' ? r.total_cost_usd : null
}
const hookFacts = (lines: Row[]) =>
  lines.map((h) => ({
    event: h.event,
    in_subagent: h.agent_id !== null,
    agent_type: h.agent_type,
    transcript: h.transcript,
    source: h.source,
    trigger: h.trigger,
    custom_instructions: h.custom_instructions,
    compact_summary: h.compact_summary,
    summary_marks: marksIn(h.compact_summary),
    command: h.command,
  }))

/** Every file Claude Code keeps for a session under ~/.claude/projects: the transcript and its subagents/ tree. */
function transcriptFiles(sessionId: string | undefined): string[] {
  if (!sessionId) return []
  const projects = join(home, '.claude', 'projects')
  const found: string[] = []
  for (const p of existsSync(projects) ? readdirSync(projects) : []) {
    const main = join(projects, p, `${sessionId}.jsonl`)
    if (existsSync(main)) found.push(main)
    const dir = join(projects, p, sessionId)
    if (existsSync(dir)) found.push(...readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f)).filter((f) => f.endsWith('.jsonl') || f.endsWith('.json')))
  }
  return found
}
const createdTranscripts: string[] = []

/** One transcript row in short: its type and, for messages, each content block. */
function rowShape(row: Row): Row {
  const message = row.message as { role?: string; content?: unknown } | undefined
  const content = message?.content
  const blocks = Array.isArray(content)
    ? content.map((b: Row) => {
        if (b.type === 'text') return { type: 'text', text: String(b.text).slice(0, 400) }
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
        if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.tool_use_id, is_error: b.is_error, content: JSON.stringify(b.content).slice(0, 600) }
        return { type: b.type }
      })
    : typeof content === 'string'
      ? [{ type: 'string', text: content.slice(0, 400) }]
      : undefined
  return {
    type: row.type,
    subtype: row.subtype,
    isMeta: row.isMeta,
    isCompactSummary: row.isCompactSummary,
    ...(row.toolUseResult !== undefined ? { toolUseResult: JSON.stringify(row.toolUseResult).slice(0, 300) } : {}),
    ...(blocks ? { blocks } : {}),
  }
}

/** Tool calls in a transcript without a result row after them. */
function unanswered(rows: Row[]): string[] {
  const asked = new Map<string, string>()
  // Conversation rows only: `api-request-blob` rows repeat the content sent and would list a call again.
  for (const row of rows.filter((r) => r.type === 'user' || r.type === 'assistant')) {
    const content = (row.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) continue
    for (const b of content as Row[]) {
      if (b.type === 'tool_use') asked.set(String(b.id), String(b.name))
      if (b.type === 'tool_result') asked.delete(String(b.tool_use_id))
    }
  }
  return [...asked.entries()].map(([id, name]) => `${name} ${id}`)
}

/**
 * What the first model request after the compaction carried, read from the request records Claude Code
 * keeps in the transcript (`api-request` names its `api-request-shape` by hash; `api-request-blob` rows
 * hold the message content sent): whether the system prompt still has the appended note (question 4) and
 * whether the rules of the SessionStart hook with source `compact` went to the model (question 1).
 */
function afterCompaction(transcript: string | undefined): Facts {
  const rows = transcript ? readLines(transcript) : []
  const boundary = rows.findIndex((r) => r.type === 'system' && r.subtype === 'compact_boundary')
  if (boundary < 0) return { compacted: false }
  const shapes = new Map(rows.filter((r) => r.type === 'api-request-shape').map((r) => [r.shapeHash, r.shape as { system?: unknown; tools?: unknown[] }]))
  const shapeOf = (r: Row | undefined) => (r ? shapes.get(r.shapeHash) : undefined)
  const before = shapeOf(rows.slice(0, boundary).findLast((r) => r.type === 'api-request'))
  const after = shapeOf(rows.slice(boundary).find((r) => r.type === 'api-request'))
  const blobs = rows.slice(boundary).filter((r) => r.type === 'api-request-blob').map((r) => JSON.stringify(r.message))
  return {
    compacted: true,
    system_prompt_append_before: before ? JSON.stringify(before.system).includes(MARKS.system_prompt) : null,
    system_prompt_append_after: after ? JSON.stringify(after.system).includes(MARKS.system_prompt) : null,
    tools_before: before?.tools?.length ?? null,
    tools_after: after?.tools?.length ?? null,
    compact_rules_sent_after: blobs.some((b) => b.includes('source: compact') && b.includes(MARKS.rules)),
    summary_sent_after: blobs.some((b) => b.includes('continued from a previous conversation')),
  }
}
const mainTranscript = (sid: string | undefined) => transcriptFiles(sid).find((f) => f.endsWith(`${sid}.jsonl`))

/** The auto-compaction decisions Claude Code wrote to its debug log (`debugFile`). */
const autocompactLog = (file: string): string[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => /autocompact/i.test(l))
        .slice(-12)
        .map((l) => l.slice(0, 300))
    : []

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (pred()) return true
    await sleep(500)
  }
  return pred()
}

// --- scenarios -----------------------------------------------------------------------------

/** Questions 1 (main Session), 2, 3 and 4 through `/compact <text>`. */
async function runManual(): Promise<Facts> {
  const s = start(sessionOptions(workDir('manual')))
  const r1 = await s.turn(REMEMBER)
  const r2 = await s.turn(`/compact ${SLASH_TEXT}`)
  const r3 = await s.turn(QUESTION)
  await s.finish()
  const sid = sessionIdOf(s)
  createdTranscripts.push(...transcriptFiles(sid))
  return {
    turns: [r1, r2, r3].map((r) => (r ? (r as unknown as Row).subtype : null)),
    compact_boundaries: boundaries(s),
    hooks: hookFacts(hookLines(sid)),
    request_after_compaction: afterCompaction(mainTranscript(sid)),
    answer_after_compaction: results(s).at(-1)?.result,
    results: results(s),
    cost_usd: costOf(s),
    stderr_tail: s.stderr.join('').slice(-800),
  }
}

/** Questions 1, 2 and 4 on auto-compaction: a low threshold, a long first message, no `/compact` text. */
async function runAuto(): Promise<Facts> {
  const filler = Array.from({ length: 300 }, (_, i) => `log line ${i + 1}: routine entry, nothing important here.`).join('\n')
  const debugFile = join(outDir, 'auto-debug.log')
  const s = start(sessionOptions(workDir('auto'), { env: cleanEnv({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: PCT, CLAUDE_CODE_AUTO_COMPACT_WINDOW: WINDOW }), debugFile }))
  const r1 = await s.turn(`${REMEMBER}\n\nA log to ignore:\n${filler}`)
  const r2 = await s.turn('Reply with: ok')
  const r3 = await s.turn(QUESTION)
  await s.finish()
  const sid = sessionIdOf(s)
  createdTranscripts.push(...transcriptFiles(sid))
  return {
    pct_override: PCT,
    window: WINDOW,
    autocompact_log: autocompactLog(debugFile),
    turns: [r1, r2, r3].map((r) => (r ? (r as unknown as Row).subtype : null)),
    compact_boundaries: boundaries(s),
    hooks: hookFacts(hookLines(sid)),
    request_after_compaction: afterCompaction(mainTranscript(sid)),
    answer_after_compaction: results(s).at(-1)?.result,
    results: results(s),
    cost_usd: costOf(s),
    stderr_tail: s.stderr.join('').slice(-800),
  }
}

/** Question 1 for a Subagent: one that reads a long file three times at a low threshold. */
async function runSubagent(): Promise<Facts> {
  const cwd = workDir('subagent')
  const debugFile = join(outDir, 'subagent-debug.log')
  writeFileSync(join(cwd, 'filler.txt'), Array.from({ length: 600 }, (_, i) => `entry ${i + 1}: routine record, nothing important here.`).join('\n'))
  const s = start(
    sessionOptions(cwd, {
      env: cleanEnv({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: PCT, CLAUDE_CODE_AUTO_COMPACT_WINDOW: WINDOW }),
      debugFile,
      tools: ['Agent', 'Read'],
      maxTurns: 6,
      agents: {
        'spike-reader': {
          description: 'Reads files for the compaction spike.',
          prompt: 'You read files when asked and follow the instructions exactly.',
          tools: ['Read'],
          model: MODEL,
        },
      },
    }),
  )
  const r = await s.turn(
    [
      'This is an automated test. Use the Agent tool with subagent_type "spike-reader" and exactly this prompt:',
      // One call per reply: three parallel Read calls leave no earlier reply to summarize, and Claude Code
      // skips the compaction ("no assistant messages in summarize set").
      '"Read the file filler.txt with the Read tool, one Read call per reply, never several at once. After the first result, read it again. After the second result, read it a third time. Then reply with the single word: done"',
      'When the agent has answered, reply with the single word: finished',
    ].join('\n'),
    600_000,
  )
  await s.finish()
  const sid = sessionIdOf(s)
  const files = transcriptFiles(sid)
  createdTranscripts.push(...files)
  const subagentBoundaries = files
    .filter((f) => f.includes('/subagents/') && f.endsWith('.jsonl'))
    .flatMap((f) => readLines(f).filter((row) => row.type === 'system' && row.subtype === 'compact_boundary').map((row) => ({ file: f.split('/subagents/')[1], compactMetadata: row.compactMetadata ?? row.compact_metadata })))
  return {
    pct_override: PCT,
    window: WINDOW,
    autocompact_log: autocompactLog(debugFile),
    result: r ? (r as unknown as Row).subtype : null,
    main_compact_boundaries: boundaries(s),
    request_after_compaction: afterCompaction(mainTranscript(sid)),
    subagent_compact_boundaries: subagentBoundaries,
    // The Subagent's own transcript: did the summary and the rules of SessionStart `compact` reach its model?
    subagent_request_after_compaction: files.filter((f) => f.includes('/subagents/') && f.endsWith('.jsonl')).map((f) => afterCompaction(f)),
    hooks: hookFacts(hookLines(sid)),
    results: results(s),
    cost_usd: costOf(s),
    stderr_tail: s.stderr.join('').slice(-800),
  }
}

/** Question 6: Claude Code stopped (SIGKILL by default) while a Bash call runs, then resumed with a prompt. */
async function runCutoff(): Promise<Facts> {
  const cwd = workDir('cutoff')
  const command = 'echo CUTOFF-START && sleep 20 && echo CUTOFF-END'
  const a = start(sessionOptions(cwd, { tools: ['Bash'] }))
  a.send(`This is an automated test. Run exactly this one Bash command and then tell me its output:\n${command}`)
  const toolStarted = await waitFor(() => readLines(join(hooksOut, 'hooks.jsonl')).some((h) => h.event === 'PreToolUse' && String(h.command).includes('CUTOFF-START')), 120_000)
  const startedAt = Date.now()
  // The PreToolUse hook ran; give Bash a moment to start the command, then stop Claude Code mid-call.
  await sleep(3000)
  const proc = a.child()
  const killed = proc ? proc.kill(SIGNAL) : false
  await waitFor(() => proc !== undefined && (proc.exitCode !== null || proc.signalCode !== null), 15_000)
  // Is the command Claude Code started still running without it? (`pgrep -f` matches its `sleep 20`.)
  const orphanAlive = spawnSync('pgrep', ['-f', 'sleep 20'], { encoding: 'utf8' }).status === 0
  await a.finish()
  const sid = sessionIdOf(a)
  const transcript = mainTranscript(sid)
  const rowsAfterKill = transcript ? readLines(transcript) : []
  // The orphaned `sleep 20` ends by itself; wait for it so the run leaves no process behind.
  await sleep(Math.max(0, 22_000 - (Date.now() - startedAt)))

  const b = start(sessionOptions(cwd, { tools: ['Bash'], resume: sid, maxTurns: 3 }))
  const r = await b.turn(
    [
      'worfy restarted while your last turn was running. Do not run any tool in this reply.',
      'Answer in up to three lines: 1) the exact result your last Bash call returned, as you see it; 2) did that command finish? 3) what would you do next?',
    ].join('\n'),
  )
  await b.finish()
  const rowsAfterResume = transcript ? readLines(transcript) : []
  createdTranscripts.push(...transcriptFiles(sid))
  return {
    signal: SIGNAL,
    tool_started: toolStarted,
    killed,
    exit: proc ? { code: proc.exitCode, signal: proc.signalCode } : null,
    command_still_running_after_stop: orphanAlive,
    before_resume: {
      rows: rowsAfterKill.length,
      unanswered_calls: unanswered(rowsAfterKill),
      tail: rowsAfterKill.slice(-4).map(rowShape),
    },
    resume: {
      same_session_id: sessionIdOf(b) === sid,
      resume_reasons: b.messages.map((m) => m.resume_reason).filter((v) => v !== undefined),
      result: r ? (r as unknown as Row).subtype : null,
      answer: results(b).at(-1)?.result,
      tool_calls_after_resume: hookLines(sid).filter((h) => h.event === 'PreToolUse').length - 1,
      rows_added: rowsAfterResume.slice(rowsAfterKill.length).map(rowShape),
      unanswered_calls_after: unanswered(rowsAfterResume),
      errors: b.messages.filter((m) => m.probe_error !== undefined || m.is_error === true).map((m) => m.probe_error ?? m.result),
      stderr_tail: b.stderr.join('').slice(-800),
    },
    // A killed session sends no result message: its cost is only in the usage of its assistant rows.
    cost_usd: { killed_session: costOf(a), killed_session_usage: rowsAfterKill.filter((row) => row.type === 'assistant').map((row) => (row.message as { usage?: unknown }).usage), resumed_session: costOf(b) },
  }
}

const RUNNERS: Record<Scenario, () => Promise<Facts>> = { manual: runManual, auto: runAuto, subagent: runSubagent, cutoff: runCutoff }

async function main(): Promise<void> {
  await app.whenReady()
  app.dock?.hide()
  if (scenarios.length !== 1 || !RUNNERS[scenarios[0] as Scenario]) throw new Error(`name one scenario: ${Object.keys(RUNNERS).join(', ')}`)
  const name = scenarios[0] as Scenario
  mkdirSync(hooksOut, { recursive: true })
  const sdkPkg = JSON.parse(readFileSync(join(repo, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')) as { version: string }
  process.stdout.write(`[probe] ${name} …\n`)
  let facts: Facts
  try {
    facts = await RUNNERS[name]()
  } catch (err) {
    facts = { probe_error: err instanceof Error ? (err.stack ?? err.message) : String(err) }
  }
  const summary = sanitize({ scenario: name, sdk_version: sdkPkg.version, model: MODEL, facts, transcripts_created: [...new Set(createdTranscripts)] })
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n[probe] written to ${scrub(outDir)}\n`)
}

main().then(
  () => app.exit(0),
  (err: unknown) => {
    process.stderr.write(`[probe] failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    app.exit(1)
  },
)
