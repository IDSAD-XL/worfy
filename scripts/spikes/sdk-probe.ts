// Spike for ticket worfy-mvp/06: how the Claude Agent SDK behaves inside the Electron main
// process with the user's own Claude Code settings (CLAUDE.md, hooks, skills, MCP servers).
//
// Run (from the repository root, one command; every scenario makes real, short model calls):
//
//   pnpm exec electron scripts/spikes/sdk-probe.ts [scenario ...] [--out <dir>] [--fixtures <dir>] [--switch-model <model>]
//     [--env KEY=VALUE ...]
//
// Scenarios (all by default): init, controls, stop-hook, no-login, permissions, bypass.
// --switch-model is the model `controls` switches to with setModel() mid-session (default: sonnet).
// --env adds a variable to the Claude Code environment of every scenario (repeatable).
// Electron 44 runs this file directly: its Node 24 strips the TypeScript types, so the file
// sticks to erasable syntax (no enums, no namespaces, `import type` for types).
//
// Output: one sanitized `<scenario>.jsonl` per scenario plus `summary.json` in --out
// (default: $TMPDIR/worfy-sdk-probe/<timestamp>). With --fixtures, the sanitized SDK messages
// alone (no timing, at most 12 partial events per file) are also written there
// (test/fixtures/sdk-messages/, for the contract tests of ticket 07).
//
// The probe never writes to ~/.claude itself. Claude Code does, as it always does for a session
// (transcript, session registry, the user's hooks); the probe only reads those files afterwards.
// The red Gate marker of the stop-hook scenario lives in a temporary directory that the user's
// stop hook reads through CLAUDE_GATE_STATE.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { CanUseTool, Options, PermissionUpdate, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'

type Scenario = 'init' | 'controls' | 'stop-hook' | 'no-login' | 'permissions' | 'bypass'
const ALL: Scenario[] = ['init', 'controls', 'stop-hook', 'no-login', 'permissions', 'bypass']
const MODEL = 'haiku'

type Recorded = { t: number; turn: number; msg: unknown }
type Facts = Record<string, unknown>
type ScenarioResult = { scenario: Scenario; facts: Facts; messages: Recorded[] }

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('sdk-probe.ts')) + 1)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const envFlags = args.flatMap((a, i) => (args[i - 1] === '--env' ? [a] : []))
const flagValues = new Set([flag('--out'), flag('--fixtures'), flag('--switch-model'), ...envFlags])
const picked = args.filter((a) => !a.startsWith('--') && !flagValues.has(a)) as Scenario[]
const scenarios = picked.length > 0 ? picked : ALL
const outDir = resolve(flag('--out') ?? join(tmpdir(), 'worfy-sdk-probe', new Date().toISOString().replace(/[:.]/g, '-')))
const switchModel = flag('--switch-model') ?? 'sonnet'
const fixturesFlag = flag('--fixtures')
const fixturesDir = fixturesFlag ? resolve(fixturesFlag) : undefined
const cwd = process.cwd()
const home = homedir()
const scratch = mkdtempSync(join(tmpdir(), 'worfy-sdk-probe-'))
let initSessionId: string | undefined

// --- environment ---------------------------------------------------------------------------

// Variables a parent Claude Code session (terminal, Desktop) leaves in the environment. worfy
// started from such a terminal would inherit them; a Finder launch would not. The probe drops
// them so the child Claude Code logs in the way the app will: through the user's own login.
const INHERITED = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)|^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT)$/
const removedEnv = Object.keys(process.env)
  .filter((k) => INHERITED.test(k))
  .sort()

function cleanEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) if (!INHERITED.test(k)) env[k] = v
  const fromFlags = Object.fromEntries(envFlags.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))
  return { ...env, ...fromFlags, ...extra }
}

// --- sanitizing ------------------------------------------------------------------------------

const user = home.split('/').pop() ?? ''
const uuidMap = new Map<string, string>()
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

function scrubString(s: string): string {
  let out = s
    .split(scratch)
    .join('<tmp>')
    .split(cwd)
    .join('<repo>')
    .split(home)
    .join('~')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\/Users\/[^/\s"]+/g, '/Users/<user>')
  if (user) out = out.split(`-Users-${user}-`).join('-Users-<user>-')
  out = out.replace(UUID, (m) => {
    const key = m.toLowerCase()
    if (!uuidMap.has(key)) uuidMap.set(key, `00000000-0000-4000-8000-${String(uuidMap.size + 1).padStart(12, '0')}`)
    return uuidMap.get(key) as string
  })
  return out.length > 600 ? `${out.slice(0, 600)}…<truncated ${out.length - 600} chars>` : out
}

// Keys whose values identify the user or carry a credential; the key itself stays.
const REDACT = new Set([
  'email',
  'emailAddress',
  'user_email',
  'account',
  'accountUuid',
  'account_uuid',
  'organization',
  'organizationUuid',
  'organization_uuid',
  'organizationName',
  'accessToken',
  'refreshToken',
  'oauthToken',
  'apiKey',
  'api_key',
  'signature',
  'messaging_socket_path',
  'request_id',
])

const LISTS = new Set(['commands', 'slash_commands', 'terminal_slash_commands', 'skills', 'agents', 'tools'])

function sanitize(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) {
    // The user's own MCP connectors and plugins: keep the shape, not the inventory.
    const objects = value.every((v) => v !== null && typeof v === 'object')
    if (objects && key === 'mcp_servers') return value.slice(0, 3).map((v, i) => ({ ...(sanitize(v) as object), name: `server-${i + 1}` }))
    if (objects && key === 'plugins') return value.slice(0, 2).map((v, i) => ({ ...(sanitize(v) as object), name: `plugin-${i + 1}` }))
    // The user's skills, commands and agents: a few entries show the shape.
    if (LISTS.has(key) && value.length > 6) return [...value.slice(0, 5).map((v) => sanitize(v)), `<${value.length - 5} more>`]
    return value.map((v) => sanitize(v))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = REDACT.has(k) && v !== null && v !== undefined ? '<redacted>' : sanitize(v, k)
    return out
  }
  return value
}

// --- driving a session ---------------------------------------------------------------------

/** Streaming input: the control methods and canUseTool need it. */
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

type Waiter = { resolve: (m: SDKMessage | undefined) => void; onMessage?: (m: SDKMessage) => void }
type Session = {
  q: Query
  inbox: Inbox
  messages: Recorded[]
  /** Sends one prompt and resolves with the result message of that turn. */
  turn: (prompt: string, onMessage?: (m: SDKMessage) => void) => Promise<SDKMessage | undefined>
  finish: () => Promise<void>
}

function start(options: Options): Session {
  const inbox = new Inbox()
  const q = query({ prompt: inbox, options })
  const messages: Recorded[] = []
  const t0 = Date.now()
  let turnNo = 0
  let waiter: Waiter | undefined
  const settle = (m: SDKMessage | undefined) => {
    const w = waiter
    waiter = undefined
    w?.resolve(m)
  }
  const pump = (async () => {
    try {
      for await (const m of q) {
        messages.push({ t: Date.now() - t0, turn: turnNo, msg: m })
        waiter?.onMessage?.(m)
        if (m.type === 'result') settle(m)
      }
    } catch (err) {
      messages.push({ t: Date.now() - t0, turn: turnNo, msg: { probe_error: String(err) } })
    }
    settle(undefined)
  })()
  return {
    q,
    inbox,
    messages,
    turn: (prompt, onMessage) =>
      new Promise((resolveTurn) => {
        turnNo += 1
        waiter = { resolve: resolveTurn, onMessage }
        inbox.push(prompt)
      }),
    finish: async () => {
      inbox.close()
      await pump
    },
  }
}

const baseOptions = (extra: Partial<Options> = {}): Options => ({
  cwd,
  model: MODEL,
  settingSources: ['user', 'project', 'local'],
  includeHookEvents: true,
  env: cleanEnv(),
  maxTurns: 8,
  ...extra,
})

// Scenarios other than `init` do not need the user's MCP connectors; without them the context
// (and the cost of a turn) is much smaller. `init` keeps them: question 1 is about them.
const withoutUserMcp: Partial<Options> = { strictMcpConfig: true, mcpServers: {} }

const typeOf = (m: unknown): string => {
  const r = m as { type?: string; subtype?: string; event?: { type?: string }; probe_error?: string }
  if (r.probe_error) return 'probe_error'
  if (r.type === 'stream_event') return `stream_event/${r.event?.type ?? '?'}`
  return r.subtype ? `${r.type}/${r.subtype}` : String(r.type)
}
const countTypes = (ms: Recorded[], turn?: number): Record<string, number> => {
  const c: Record<string, number> = {}
  for (const r of ms) if (turn === undefined || r.turn === turn) c[typeOf(r.msg)] = (c[typeOf(r.msg)] ?? 0) + 1
  return c
}
const all = (ms: Recorded[], pred: (m: Record<string, unknown>) => boolean): Record<string, unknown>[] =>
  ms.map((r) => r.msg as Record<string, unknown>).filter(pred)
const isSystem = (subtype: string) => (m: Record<string, unknown>) => m.type === 'system' && m.subtype === subtype
const textOf = (m: Record<string, unknown>): string => {
  const content = (m.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return ''
  return content.map((b: { type?: string; text?: string }) => (b.type === 'text' ? b.text : `[${b.type}]`)).join(' ')
}

function initFacts(ms: Recorded[]): Facts {
  const init = all(ms, isSystem('init'))[0]
  if (!init) return { init: null }
  const slash = (init.slash_commands as string[] | undefined) ?? []
  return {
    claude_code_version: init.claude_code_version,
    apiKeySource: init.apiKeySource,
    permissionMode: init.permissionMode,
    model: init.model,
    effort: init.effort,
    slash_commands_count: slash.length,
    has_ship_ticket: slash.some((s) => s.endsWith('ship-ticket')),
    has_epic_wave: slash.some((s) => s.endsWith('epic-wave')),
    skills_count: (init.skills as string[] | undefined)?.length,
    agents: init.agents,
    mcp_servers: (init.mcp_servers as { status: string; source?: string }[] | undefined)?.map((s) => `${s.source ?? '?'}:${s.status}`),
    plugins_count: (init.plugins as unknown[] | undefined)?.length,
    init_keys: Object.keys(init).sort(),
  }
}

const hookSummary = (ms: Recorded[]) =>
  all(ms, isSystem('hook_response')).map((m) => ({
    event: m.hook_event,
    name: scrubString(String(m.hook_name ?? '')),
    exit_code: m.exit_code,
    outcome: m.outcome,
    stdout: scrubString(String(m.stdout ?? '')).slice(0, 160),
    stderr: scrubString(String(m.stderr ?? '')).slice(0, 300),
  }))

const resultFacts = (m: SDKMessage | undefined): Facts => {
  if (!m || m.type !== 'result') return { result: m ? typeOf(m) : null }
  const r = m as unknown as Record<string, unknown>
  return {
    subtype: r.subtype,
    is_error: r.is_error,
    num_turns: r.num_turns,
    stop_reason: r.stop_reason,
    result: typeof r.result === 'string' ? r.result.slice(0, 160) : r.result,
    errors: r.errors,
    permission_denials: r.permission_denials,
    total_cost_usd: r.total_cost_usd,
  }
}

/** Read-only look at where Claude Code recorded this session. */
function sessionTraces(sessionId: string | undefined): Facts {
  if (!sessionId) return { sessionId: null }
  const registry = join(home, '.claude', 'sessions')
  const entries = existsSync(registry) ? readdirSync(registry).filter((f) => f.endsWith('.json')) : []
  const hit = entries
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(registry, f), 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    })
    .find((e) => e?.sessionId === sessionId)
  const transcript = join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`)
  const lines = existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n').filter(Boolean) : []
  let entrypoint: unknown
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as Record<string, unknown>
      if (e.entrypoint) {
        entrypoint = e.entrypoint
        break
      }
    } catch {
      // a partial line at the tail of a live transcript
    }
  }
  // The user's SessionStart hook `worktree-lock claim` registers the session per worktree.
  const locks = join(home, '.claude', 'worktree-sessions')
  const lockFiles = existsSync(locks)
    ? readdirSync(locks).filter((f) => f.endsWith('.json') && readFileSync(join(locks, f), 'utf8').includes(sessionId))
    : []
  return {
    worktree_lock_files_with_session: lockFiles.length,
    registry_entry: hit ? { kind: hit.kind, entrypoint: hit.entrypoint, status: hit.status, keys: Object.keys(hit).sort() } : null,
    transcript_exists: existsSync(transcript),
    transcript_lines: lines.length,
    transcript_entrypoint: entrypoint,
  }
}

function fingerprint(path: string): string {
  if (!existsSync(path)) return 'absent'
  return `${statSync(path).mtimeMs}:${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12)}`
}
const settingsFiles = [
  join(home, '.claude', 'settings.json'),
  join(home, '.claude', 'settings.local.json'),
  join(cwd, '.claude', 'settings.json'),
  join(cwd, '.claude', 'settings.local.json'),
]
const fingerprints = () => Object.fromEntries(settingsFiles.map((f) => [scrubString(f), fingerprint(f)]))

// --- scenarios -------------------------------------------------------------------------------

// A heading of the user's ~/.claude/CLAUDE.md: the model sees it only if the file was loaded.
const CLAUDE_MD_QUESTION =
  'Look only at your system context. Does it contain a section titled "Workflow: orchestrator + subagents"? Answer YES or NO, one word.'

// Questions 1, 3, 5 and 7: settings sources, login, the event stream, session traces.
async function runInit(): Promise<ScenarioResult> {
  const s = start(baseOptions({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, includePartialMessages: true, tools: [] }))
  const facts: Facts = {}
  const r1 = await s.turn(CLAUDE_MD_QUESTION)
  facts.turn1 = { ...resultFacts(r1), types: countTypes(s.messages, 1) }
  facts.init = initFacts(s.messages)
  facts.traces_during_session = sessionTraces(all(s.messages, isSystem('init'))[0]?.session_id as string | undefined)
  facts.hooks_session_start = hookSummary(s.messages).filter((h) => h.event === 'SessionStart')

  const commands = await s.q.supportedCommands()
  facts.supportedCommands = {
    count: commands.length,
    sample: commands.filter((c) => ['ship-ticket', 'epic-wave', 'compact', 'model'].includes(c.name)).map((c) => sanitize(c)),
  }
  const models = await s.q.supportedModels()
  facts.supportedModels = models.map((m) => ({
    value: m.value,
    displayName: m.displayName,
    supportsEffort: m.supportsEffort,
    supportedEffortLevels: m.supportedEffortLevels,
  }))
  facts.initializationResult_keys = Object.keys(await s.q.initializationResult()).sort()
  const account = (await s.q.accountInfo()) as unknown as Record<string, unknown>
  facts.accountInfo = { keys: Object.keys(account).sort(), tokenSource: account.tokenSource, apiKeySource: account.apiKeySource, apiProvider: account.apiProvider, subscriptionType: account.subscriptionType }

  // The user's MCP connectors start without blocking turn 1. Turn 2 is built with their tools.
  await new Promise((r) => setTimeout(r, 5_000))
  const r2 = await s.turn('Reply with the single word: ok')
  facts.turn2_same_model = {
    ...resultFacts(r2),
    types: countTypes(s.messages, 2),
    status_messages: all(s.messages, isSystem('status')).map((m) => ({ status: m.status, permissionMode: m.permissionMode })),
    mcp_servers_at_turn2: initFacts(s.messages.filter((r) => r.turn === 2)).mcp_servers,
  }

  await s.finish()
  facts.all_types = countTypes(s.messages)
  facts.session_end_hooks = hookSummary(s.messages).filter((h) => h.event === 'SessionEnd')
  initSessionId = all(s.messages, isSystem('init'))[0]?.session_id as string | undefined
  facts.traces_after_exit = sessionTraces(initSessionId)
  return { scenario: 'init', facts, messages: s.messages }
}

// Questions 5 and 6: controls during a session, interrupt and the turn after it. Without the
// user's MCP connectors the context stays small enough for any model (see `init`, turn 2).
async function runControls(): Promise<ScenarioResult> {
  const s = start(
    baseOptions({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, includePartialMessages: true, tools: [], ...withoutUserMcp }),
  )
  const facts: Facts = {}
  // The user's CLAUDE.md: `init` asks the same, but there the MCP tools can push turn 1 past the
  // model's context window before the answer comes.
  const r1 = await s.turn(CLAUDE_MD_QUESTION)
  facts.turn1 = { ...resultFacts(r1), types: countTypes(s.messages, 1), init: initFacts(s.messages) }
  const sessionId = all(s.messages, isSystem('init'))[0]?.session_id as string | undefined
  facts.traces_during_session = sessionTraces(sessionId)

  const controls: Facts = {}
  const tryCall = async (name: string, fn: () => Promise<unknown>) => {
    try {
      controls[name] = { ok: true, value: sanitize(await fn()) ?? null }
    } catch (err) {
      controls[name] = { ok: false, error: String(err) }
    }
  }
  await tryCall('setPermissionMode(default)', () => s.q.setPermissionMode('default'))
  await tryCall(`setModel(${switchModel})`, () => s.q.setModel(switchModel))
  await tryCall('applyFlagSettings(effortLevel: low)', () => s.q.applyFlagSettings({ effortLevel: 'low' }))
  facts.controls = controls

  const r2 = await s.turn('Reply with the single word: ok')
  const lastAssistant = all(s.messages, (m) => m.type === 'assistant').pop()
  facts.turn2 = {
    ...resultFacts(r2),
    types: countTypes(s.messages, 2),
    init_turn2: initFacts(s.messages.filter((r) => r.turn === 2)),
    assistant_model: (lastAssistant?.message as { model?: string } | undefined)?.model,
    status_messages: all(s.messages, isSystem('status')).map((m) => ({ status: m.status, permissionMode: m.permissionMode })),
  }

  // Interrupt mid-stream: the first text delta triggers interrupt().
  let interrupted = false
  const r3 = await s.turn('Write every integer from 1 to 400, separated by single spaces, and nothing else.', (m) => {
    if (interrupted || m.type !== 'stream_event') return
    const ev = (m as unknown as { event: { type: string; delta?: { type?: string } } }).event
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      interrupted = true
      s.q.interrupt().then(
        (v) => (facts.interrupt_returned = sanitize(v) ?? null),
        (err: unknown) => (facts.interrupt_error = String(err)),
      )
    }
  })
  facts.turn3_interrupt = { ...resultFacts(r3), types: countTypes(s.messages, 3), interrupted }

  // Does the same session take another turn after an interrupt?
  const r4 = await s.turn('Reply with the single word: ok')
  facts.turn4_after_interrupt = { ...resultFacts(r4), types: countTypes(s.messages, 4) }

  await s.finish()
  facts.all_types = countTypes(s.messages)
  facts.errors = all(s.messages, (m) => typeof m.probe_error === 'string').map((m) => scrubString(String(m.probe_error)))
  facts.traces_after_exit = sessionTraces(sessionId)
  return { scenario: 'controls', facts, messages: s.messages }
}

// Question 2: the user's Stop hook blocking the end of a turn (exit 2) while the Gate is red.
async function runStopHook(): Promise<ScenarioResult> {
  const state = join(scratch, 'gate-state')
  mkdirSync(state, { recursive: true })
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim()
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim()
  const canon = resolve(top, common, '..')
  const which = execFileSync('node', [join(home, '.claude', 'hooks', 'gate-resolve.mjs'), '--which', canon], { encoding: 'utf8' })
  const key = which.split('\t')[0]?.trim() ?? ''
  const tag = createHash('sha1').update(top).digest('hex').slice(0, 8)
  writeFileSync(join(state, `red-${key}-${tag}`), 'lint (sdk-probe red marker)\n')

  const s = start(
    baseOptions({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, tools: [], env: cleanEnv({ CLAUDE_GATE_STATE: state }), ...withoutUserMcp }),
  )
  const r1 = await s.turn('Reply with the single word: ok')
  const r2 = await s.turn('Reply with the single word: again')
  await s.finish()
  const blocks = join(state, 'stop-blocks')
  return {
    scenario: 'stop-hook',
    facts: {
      gate_key: key,
      turn1: { ...resultFacts(r1), types: countTypes(s.messages, 1) },
      turn2: { ...resultFacts(r2), types: countTypes(s.messages, 2) },
      stop_hooks: hookSummary(s.messages).filter((h) => h.event === 'Stop'),
      assistant_texts: all(s.messages, (m) => m.type === 'assistant').map((m) => textOf(m).slice(0, 120)),
      user_messages: all(s.messages, (m) => m.type === 'user').map((m) =>
        scrubString(JSON.stringify((m.message as { content?: unknown }).content)).slice(0, 300),
      ),
      counters: existsSync(blocks) ? readdirSync(blocks).map((f) => `${scrubString(f)}=${readFileSync(join(blocks, f), 'utf8').trim()}`) : [],
    },
    messages: s.messages,
  }
}

// Question 3, second half: Claude Code that is not logged in (an empty config directory).
async function runNoLogin(): Promise<ScenarioResult> {
  const config = join(scratch, 'empty-claude-config')
  mkdirSync(config, { recursive: true })
  const s = start(
    baseOptions({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, tools: [], env: cleanEnv({ CLAUDE_CONFIG_DIR: config }), ...withoutUserMcp }),
  )
  const timer = setTimeout(() => s.inbox.close(), 90_000)
  const r = await s.turn('Reply with the single word: ok')
  let account: unknown
  try {
    const info = (await s.q.accountInfo()) as unknown as Record<string, unknown>
    account = { keys: Object.keys(info).sort(), tokenSource: info.tokenSource, apiKeySource: info.apiKeySource, subscriptionType: info.subscriptionType }
  } catch (err) {
    account = { error: String(err) }
  }
  clearTimeout(timer)
  await s.finish()
  return {
    scenario: 'no-login',
    facts: {
      ...initFacts(s.messages),
      result: resultFacts(r),
      accountInfo: account,
      types: countTypes(s.messages),
      assistant_texts: all(s.messages, (m) => m.type === 'assistant').map((m) => textOf(m).slice(0, 200)),
      auth_status: all(s.messages, (m) => m.type === 'auth_status').map((m) => sanitize(m)),
    },
    messages: s.messages,
  }
}

// Question 8: canUseTool and "Always allow" for the rest of this session only.
async function runPermissions(): Promise<ScenarioResult> {
  const target = join(scratch, 'perm')
  const before = fingerprints()
  const requests: unknown[] = []
  const canUseTool: CanUseTool = async (toolName, input, options) => {
    const suggestions = options.suggestions ?? []
    requests.push(
      sanitize({
        toolName,
        input,
        suggestions,
        blockedPath: options.blockedPath,
        decisionReason: options.decisionReason,
        title: options.title,
        displayName: options.displayName,
        option_keys: Object.keys(options).sort(),
      }),
    )
    // "Always allow" in worfy: the whole tool (a rule without ruleContent) plus the suggested
    // directories, all in the in-memory session layer. The suggested rule is for this exact
    // command and its destination is localSettings (a file); a suggested mode change (setMode)
    // would widen every later permission. Neither is applied. A rule alone is not enough for a
    // path outside the working directory: without addDirectories the same command asks again.
    const sessionOnly: PermissionUpdate[] = [
      { type: 'addRules', rules: [{ toolName }], behavior: 'allow', destination: 'session' },
      ...suggestions.filter((u) => u.type === 'addDirectories').map((u) => ({ ...u, destination: 'session' as const })),
    ]
    return { behavior: 'allow', updatedInput: input, updatedPermissions: sessionOnly }
  }
  const s = start(baseOptions({ permissionMode: 'default', canUseTool, tools: ['Bash'], ...withoutUserMcp }))
  const r = await s.turn(
    `Use the Bash tool twice, one call after the other: first run exactly \`mkdir -p ${target}/one\`, then run exactly \`mkdir -p ${target}/two\`. Then reply: done.`,
  )
  await s.finish()
  const after = fingerprints()
  return {
    scenario: 'permissions',
    facts: {
      result: resultFacts(r),
      can_use_tool_calls: requests.length,
      requests,
      created: ['one', 'two'].filter((d) => existsSync(join(target, d))),
      settings_files_unchanged: JSON.stringify(before) === JSON.stringify(after),
      before,
      after,
      permission_denied_events: all(s.messages, isSystem('permission_denied')).length,
      status_messages: all(s.messages, isSystem('status')).map((m) => ({ status: m.status, permissionMode: m.permissionMode })),
      bash_calls: all(s.messages, (m) => m.type === 'assistant').flatMap((m) =>
        ((m.message as { content?: { type: string; input?: { command?: string } }[] }).content ?? [])
          .filter((b) => b.type === 'tool_use')
          .map((b) => scrubString(b.input?.command ?? '')),
      ),
    },
    messages: s.messages,
  }
}

// Question 9: bypassPermissions without allowDangerouslySkipPermissions, once with the user's
// settings (they carry skipDangerousModePermissionPrompt) and once with no settings at all.
async function runBypass(): Promise<ScenarioResult> {
  const facts: Facts = {}
  const messages: Recorded[] = []
  const variants: [string, Partial<Options>][] = [
    ['user_settings', {}],
    ['no_settings', { settingSources: [] }],
  ]
  for (const [i, [name, extra]] of variants.entries()) {
    const target = join(scratch, `bypass-${name}`)
    const asked: string[] = []
    const canUseTool: CanUseTool = async (toolName) => {
      asked.push(toolName)
      return { behavior: 'deny', message: 'sdk-probe: denied to observe the fallback' }
    }
    const s = start(baseOptions({ permissionMode: 'bypassPermissions', canUseTool, tools: ['Bash'], ...withoutUserMcp, ...extra }))
    const timer = setTimeout(() => s.inbox.close(), 120_000)
    const r = await s.turn(`Use the Bash tool to run exactly \`mkdir -p ${target}\`, then reply: done.`)
    clearTimeout(timer)
    await s.finish()
    const init = all(s.messages, isSystem('init'))[0]
    facts[name] = {
      init_permissionMode: init?.permissionMode ?? null,
      result: resultFacts(r),
      can_use_tool_asked: asked,
      created: existsSync(target),
      status_messages: all(s.messages, isSystem('status')).map((m) => ({ status: m.status, permissionMode: m.permissionMode })),
      errors: all(s.messages, (m) => typeof m.probe_error === 'string').map((m) => scrubString(String(m.probe_error))),
    }
    for (const rec of s.messages) messages.push({ ...rec, turn: i + 1 })
  }
  return { scenario: 'bypass', facts, messages }
}

const RUNNERS: Record<Scenario, () => Promise<ScenarioResult>> = {
  init: runInit,
  controls: runControls,
  'stop-hook': runStopHook,
  'no-login': runNoLogin,
  permissions: runPermissions,
  bypass: runBypass,
}

// --- main ------------------------------------------------------------------------------------

function writeStream(dir: string, r: ScenarioResult, forFixtures: boolean): void {
  mkdirSync(dir, { recursive: true })
  let partials = 0
  const lines: string[] = []
  for (const rec of r.messages) {
    if (forFixtures && typeOf(rec.msg).startsWith('stream_event')) {
      partials += 1
      if (partials > 12) continue // a handful of partial events is enough for a contract test
    }
    lines.push(JSON.stringify(sanitize(forFixtures ? rec.msg : rec)))
  }
  writeFileSync(join(dir, `${r.scenario}.jsonl`), `${lines.join('\n')}\n`)
}

async function main(): Promise<void> {
  await app.whenReady()
  app.dock?.hide()
  mkdirSync(outDir, { recursive: true })
  const sdkPkg = JSON.parse(readFileSync(join(cwd, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')) as {
    version: string
    claudeCodeVersion?: string
  }
  const results: Facts = {}
  const summary: Facts = {
    sdk_version: sdkPkg.version,
    bundled_claude_code: sdkPkg.claudeCodeVersion,
    electron: process.versions.electron,
    node: process.versions.node,
    env_removed: removedEnv,
    scenarios: results,
  }
  for (const name of scenarios) {
    const runner = RUNNERS[name]
    if (!runner) throw new Error(`unknown scenario: ${name}`)
    process.stdout.write(`[sdk-probe] ${name} …\n`)
    const r = await runner()
    results[name] = sanitize(r.facts)
    writeStream(outDir, r, false)
    if (fixturesDir) writeStream(fixturesDir, r, true)
  }
  if (initSessionId) summary.init_traces_at_the_end = sanitize(sessionTraces(initSessionId))
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n[sdk-probe] written to ${outDir}\n`)
}

main().then(
  () => app.exit(0),
  (err: unknown) => {
    process.stderr.write(`[sdk-probe] failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    app.exit(1)
  },
)
