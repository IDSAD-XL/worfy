// Spike for ticket worfy-harness/01 (result: docs/adr/0048-harness-plugin-spike-results.md): how
// Claude Code treats the Harness plugin `worfy` — hooks of workflow-script Subagents, GH_TOKEN via
// CLAUDE_ENV_FILE, installing from a local marketplace, the name of the plugin's MCP server.
//
// Run from the repository root, one command per scenario:
//
//   pnpm exec electron scripts/spikes/harness-plugin/probe.ts known           # the five facts of the 2026-10-07 spike
//   pnpm exec electron scripts/spikes/harness-plugin/probe.ts workflow-hooks  # SubagentStart and bin/ in a workflow-script agent
//   pnpm exec electron scripts/spikes/harness-plugin/probe.ts env-file        # GH_TOKEN through CLAUDE_ENV_FILE (fake gh, then the real one)
//   pnpm exec electron scripts/spikes/harness-plugin/probe.ts install         # plugin validate/marketplace/install/update/uninstall, sandbox only
//   pnpm exec electron scripts/spikes/harness-plugin/probe.ts mcp-name        # the plugin's `qmd` against allowedMcpServers
//   pnpm exec electron scripts/spikes/harness-plugin/probe.ts --rescrub test/fixtures/sdk-messages  # re-sanitize plugin-*.jsonl, no model call
//
// Options: --out <dir> (default $TMPDIR/worfy-harness-probe/<timestamp>), --fixtures <dir>
// (sanitized system/init messages as plugin-<scenario>-<variant>.jsonl, for
// test/fixtures/sdk-messages), --model <model> (default haiku, the cheapest model that follows
// these short prompts; the env-file SDK session defaults to sonnet, because haiku refuses to hash
// GH_TOKEN), --account <login> (default: `github.account` of the worfy Profile).
//
// Model calls: `known`, `workflow-hooks` and `env-file` run real sessions with the user's own
// settings (settingSources user + project + local, as worfy does) in a temporary working
// directory, plus one `claude -p` from the terminal (env-file). `install` and `mcp-name` make no
// model call: they run in a sandbox (HOME and CLAUDE_CONFIG_DIR in a temporary directory, not
// logged in) — Claude Code still loads plugins, hooks and MCP servers and sends system/init there.
//
// The probe never writes to ~/.claude itself. Claude Code does what it does for any session:
// transcripts under ~/.claude/projects, which the probe lists in summary.json. Real settings are
// fingerprinted before and after every scenario. GitHub tokens: env-file first runs on a fake
// `gh` that prints a known fake token; the real check compares the real token only by sha256 in
// memory — its value is never printed nor written.
//
// Electron 44 runs this file directly (Node 24 strips the types): erasable syntax only.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'

type Scenario = 'known' | 'workflow-hooks' | 'env-file' | 'install' | 'mcp-name'
const ALL: Scenario[] = ['known', 'workflow-hooks', 'env-file', 'install', 'mcp-name']
type Facts = Record<string, unknown>
type Recorded = { t: number; msg: unknown }

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('probe.ts')) + 1)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const flagValues = new Set([flag('--out'), flag('--fixtures'), flag('--model'), flag('--account'), flag('--rescrub')])
const picked = args.filter((a) => !a.startsWith('--') && !flagValues.has(a)) as Scenario[]
const scenarios = picked.length > 0 ? picked : ALL
const outDir = resolve(flag('--out') ?? join(tmpdir(), 'worfy-harness-probe', new Date().toISOString().replace(/[:.]/g, '-')))
const fixturesDir = flag('--fixtures') ? resolve(flag('--fixtures') as string) : undefined
const MODEL = flag('--model') ?? 'haiku'
// haiku refuses step 2 of env-file (hashing GH_TOKEN, "would expose a credential"); sonnet runs it.
const ENV_FILE_MODEL = flag('--model') ?? 'sonnet'
const repo = process.cwd()
const home = homedir()
const here = join(repo, 'scripts', 'spikes', 'harness-plugin')
const FIXTURE = join(here, 'fixture')
const MARKETPLACE = join(here, 'marketplace')
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-probe-')))
const hooksOut = join(outDir, 'hooks')

// The hook marks of fixture/hooks/hook.mjs.
const SESSION_MARK = 'amber-5172'
const SUBAGENT_MARK = 'cobalt-9038'
// A fake that looks like no GitHub token format: only the fake `gh` below ever prints it.
const FAKE_TOKEN = 'worfy-spike-fake-token-0000000000000000'
/** Which hook marks an agent passed to worfy-spike-bin, and whether bin/ was on its PATH. */
const markFacts = (b: Record<string, unknown>): Facts => {
  const marks = (b.marks as string[] | undefined) ?? []
  return { who: b.who, marks, sees_session_mark: marks.includes(SESSION_MARK), sees_subagent_mark: marks.includes(SUBAGENT_MARK), plugin_bin_on_path: b.plugin_bin_on_path }
}
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

// --- environment ---------------------------------------------------------------------------

// Variables a parent Claude Code session leaves behind; worfy started from Finder has none.
const INHERITED = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)|^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_ENV_FILE|GH_TOKEN|GITHUB_TOKEN)$/
function cleanEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) if (!INHERITED.test(k)) env[k] = v
  return { ...env, WORFY_SPIKE_OUT: hooksOut, ...extra }
}

/** The Claude Code binary of the SDK's platform package — the one worfy runs (src/main/agent/options.ts). */
function bundledClaude(): string {
  const sdkPkg = realpathSync(join(repo, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'))
  const pkg = createRequire(sdkPkg).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
  return join(dirname(pkg), 'claude')
}
const CLAUDE_BIN = bundledClaude()

type Sandbox = { dir: string; home: string; config: string; env: Record<string, string | undefined> }
/** HOME and CLAUDE_CONFIG_DIR in a temporary directory: nothing of the user's is read or written. */
function sandbox(name: string, extra: Record<string, string> = {}): Sandbox {
  const dir = join(scratch, `sandbox-${name}`)
  const sbHome = join(dir, 'home')
  const config = join(sbHome, '.claude')
  mkdirSync(config, { recursive: true })
  return { dir, home: sbHome, config, env: cleanEnv({ HOME: sbHome, CLAUDE_CONFIG_DIR: config, ...extra }) }
}

/** The marketplace with the plugin sample next to it as ./worfy (marketplace/.claude-plugin/marketplace.json). */
function marketplaceCopy(dir: string, version?: string): string {
  const mp = join(dir, 'mp')
  cpSync(MARKETPLACE, mp, { recursive: true })
  cpSync(FIXTURE, join(mp, 'worfy'), { recursive: true })
  if (version) setVersion(join(mp, 'worfy'), version)
  return mp
}
function setVersion(pluginDir: string, version: string): void {
  const file = join(pluginDir, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  writeFileSync(file, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`)
}

type CliRun = { cmd: string; exit: number | null; stdout: string; stderr: string; json?: unknown }
/** One command of the bundled binary, with its exit code and output (sanitized). */
function cli(sb: Sandbox, argv: string[], cwd: string = sb.dir): CliRun {
  const r = spawnSync(CLAUDE_BIN, argv, { cwd, env: sb.env, encoding: 'utf8', timeout: 120_000 })
  const run: CliRun = { cmd: `claude ${argv.join(' ')}`, exit: r.status, stdout: scrub(r.stdout ?? ''), stderr: scrub(r.stderr ?? '') }
  try {
    run.json = JSON.parse(r.stdout)
  } catch {
    // human output
  }
  if (run.json !== undefined) run.json = sanitize(run.json)
  process.stdout.write(`[probe]   ${run.cmd} -> ${String(run.exit)}\n`)
  return run
}
const twice = (sb: Sandbox, argv: string[]): CliRun[] => [cli(sb, argv), cli(sb, argv)]

/** Files under a directory, relative, for "where did the install put things". */
function tree(dir: string, skip: RegExp = /\/(projects|backups|shell-snapshots|statsig|todos|debug|session-env|telemetry)\//): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (skip.test(`${p}/`)) continue
      if (e.isDirectory()) walk(p)
      else out.push(relative(dir, p))
    }
  }
  walk(dir)
  return out.sort()
}
const readJson = (file: string): unknown => (existsSync(file) ? sanitize(JSON.parse(readFileSync(file, 'utf8'))) : 'absent')

// --- sanitizing ------------------------------------------------------------------------------

const user = home.split('/').pop() ?? ''
const uuidMap = new Map<string, string>()
// Numbers below this are taken by placeholders already in the files --rescrub reads.
let uuidBase = 0
// Not \b: a UUID next to `_` (synced plugin paths `<accountUuid>_<organizationUuid>`) has no word boundary.
const UUID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi
const SANITIZED_UUID = /^00000000-0000-4000-8000-\d{12}$/
// The user's own plugins and MCP servers say what the user has: they become plugin-N / server-N.
// The spike's own names (worfy, qmd, its tools) and builtin plugins stay.
const OWN = new Set(['worfy', 'qmd', 'worfy-canvas'])
const aliases = new Map<string, string>()
const alias = (kind: 'plugin' | 'server', name: string): string => {
  if (OWN.has(name)) return name
  const key = `${kind}:${name}`
  if (!aliases.has(key)) aliases.set(key, `${kind}-${[...aliases.keys()].filter((k) => k.startsWith(`${kind}:`)).length + 1}`)
  return aliases.get(key) as string
}
const userPlugins = (() => {
  try {
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, unknown> }
    return Object.keys(s.enabledPlugins ?? {}).map((id) => id.split('@')[0] ?? id)
  } catch {
    return []
  }
})()
/** Adds the user's plugins a system/init lists (installed, synced…) to the names scrub() replaces. */
function registerPlugins(value: unknown, key = ''): void {
  if (Array.isArray(value)) {
    if (key === 'plugins')
      for (const p of value as { name?: unknown; path?: unknown }[])
        if (p && typeof p.name === 'string' && p.path !== 'builtin' && !OWN.has(p.name) && !/^plugin-\d+$/.test(p.name) && !userPlugins.includes(p.name)) userPlugins.push(p.name)
    for (const v of value) registerPlugins(v)
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) registerPlugins(v, k)
}
const userServers = (() => {
  try {
    const c = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown> }
    return Object.keys(c.mcpServers ?? {})
  } catch {
    return []
  }
})()

function scrub(s: string): string {
  let out = s
    .split(FAKE_TOKEN)
    .join('<fake-token>')
    .split(scratch)
    .join('<tmp>')
    .split(repo)
    .join('<repo>')
    .split(home)
    .join('~')
    .replace(/\/(private\/)?(var\/folders|tmp)\/[^\s"']*/g, '<tmp-path>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => (/^[\w-]+@[\w-]+$/.test(m) ? m : '<email>'))
    .replace(/\/Users\/[^/\s"]+/g, '/Users/<user>')
  if (user) out = out.split(`-Users-${user}-`).join('-Users-<user>-')
  out = out.replace(/mcp__([A-Za-z0-9_.-]+?)__([A-Za-z0-9_-]+)/g, (m, server: string) => (userServers.includes(server) && !OWN.has(server) ? `mcp__${alias('server', server)}__tool` : m))
  for (const p of userPlugins) if (!OWN.has(p)) out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), alias('plugin', p))
  for (const s of userServers) if (!OWN.has(s)) out = out.replace(new RegExp(`(["'/:])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(["'/:])`, 'g'), `$1${alias('server', s)}$2`)
  out = out.replace(UUID, (m) => {
    if (SANITIZED_UUID.test(m)) return m // already replaced (--rescrub)
    const key = m.toLowerCase()
    if (!uuidMap.has(key)) uuidMap.set(key, `00000000-0000-4000-8000-${String(uuidBase + uuidMap.size + 1).padStart(12, '0')}`)
    return uuidMap.get(key) as string
  })
  return out.length > 600 ? `${out.slice(0, 600)}…<truncated ${out.length - 600} chars>` : out
}

const REDACT = new Set(['email', 'emailAddress', 'account', 'accountUuid', 'organization', 'organizationUuid', 'organizationName', 'signature', 'request_id', 'messaging_socket_path', 'memory_paths'])
const LISTS = new Set(['commands', 'slash_commands', 'terminal_slash_commands', 'skills', 'agents'])

function sanitize(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return scrub(value)
  if (Array.isArray(value)) {
    // Skills and commands: the spike's own entries and a few others show the shape.
    if (LISTS.has(key) && value.length > 6) {
      const own = value.filter((v) => typeof v === 'string' && v.startsWith('worfy:'))
      const rest = value.filter((v) => !own.includes(v)).slice(0, 4)
      return [...own, ...rest].map((v) => sanitize(v)).concat(`<${value.length - own.length - rest.length} more>`)
    }
    // Tools: every MCP tool (they are the question), the built-ins counted.
    if (key === 'tools' && value.every((v) => typeof v === 'string')) {
      const mcp = (value as string[]).filter((v) => v.startsWith('mcp__'))
      return [...mcp.map((v) => scrub(v)), `<${value.length - mcp.length} built-in tools>`]
    }
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
  messages: Recorded[]
  /** Sends one prompt; resolves with the next result message (or undefined when the stream ends). */
  turn: (prompt: string) => Promise<SDKMessage | undefined>
  /** Resolves with the next result message without sending anything (a turn Claude Code starts itself). */
  nextResult: (ms: number) => Promise<SDKMessage | undefined>
  finish: () => Promise<void>
}

function start(options: Options): Session {
  const inbox = new Inbox()
  const q = query({ prompt: inbox, options })
  const messages: Recorded[] = []
  const t0 = Date.now()
  let waiters: ((m: SDKMessage | undefined) => void)[] = []
  const settle = (m: SDKMessage | undefined) => {
    const ws = waiters
    waiters = []
    for (const w of ws) w(m)
  }
  const pump = (async () => {
    try {
      for await (const m of q) {
        messages.push({ t: Date.now() - t0, msg: m })
        if (m.type === 'result') settle(m)
      }
    } catch (err) {
      messages.push({ t: Date.now() - t0, msg: { probe_error: scrub(String(err)) } })
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
    turn: (prompt) => {
      const p = nextResult(300_000)
      inbox.push(prompt)
      return p
    },
    nextResult,
    finish: async () => {
      inbox.close()
      await Promise.race([pump, new Promise((r) => setTimeout(r, 30_000))])
    },
  }
}

const sessionOptions = (cwd: string, extra: Partial<Options> = {}): Options => ({
  cwd,
  model: MODEL,
  settingSources: ['user', 'project', 'local'],
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  includeHookEvents: true,
  pathToClaudeCodeExecutable: CLAUDE_BIN,
  env: cleanEnv(),
  ...extra,
})

// The MCP servers of a worfy Session today (DEFAULT_MCP_SERVERS without the canvas, ADR-0021):
// the user's `qmd` by name. It also keeps the user's other servers (hundreds of tools) out.
const WORFY_MCP: Partial<Options> = { managedSettings: { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'qmd' }] } }

const msgs = (s: Session) => s.messages.map((r) => r.msg as Record<string, unknown>)
const initOf = (s: Session) => msgs(s).find((m) => m.type === 'system' && m.subtype === 'init')
const sessionIdOf = (s: Session) => initOf(s)?.session_id as string | undefined
const resultFacts = (m: SDKMessage | undefined): Facts => {
  if (!m || m.type !== 'result') return { result: null }
  const r = m as unknown as Record<string, unknown>
  return { subtype: r.subtype, is_error: r.is_error, num_turns: r.num_turns, result: typeof r.result === 'string' ? scrub(r.result.slice(0, 200)) : null, total_cost_usd: r.total_cost_usd }
}

/** The plugins, plugin errors, MCP servers and MCP tools of system/init (unsanitized values; sanitize later). */
function initInventory(init: Record<string, unknown> | undefined): Facts {
  if (!init) return { init: null }
  return {
    plugins: init.plugins,
    plugin_errors: init.plugin_errors,
    mcp_servers: init.mcp_servers,
    mcp_tools: ((init.tools as string[] | undefined) ?? []).filter((t) => t.startsWith('mcp__')),
    worfy_skills: ((init.skills as string[] | undefined) ?? []).filter((t) => t.startsWith('worfy:')),
    apiKeySource: init.apiKeySource,
    claude_code_version: init.claude_code_version,
  }
}

/** Waits until no MCP server is `pending`, then returns mcpServerStatus() (names, status, source, tool names). */
async function mcpStatus(q: Query, ms = 25_000): Promise<unknown> {
  const until = Date.now() + ms
  for (;;) {
    let list: Awaited<ReturnType<Query['mcpServerStatus']>>
    try {
      list = await q.mcpServerStatus()
    } catch (err) {
      return { error: scrub(String(err)) }
    }
    if (!list.some((s) => s.status === 'pending') || Date.now() > until)
      return list.map((s) => ({ name: s.name, status: s.status, source: s.source, scope: s.scope, error: s.error, tool_names: s.tools?.map((t) => t.name) }))
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const readLines = (file: string): Record<string, unknown>[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : []
const hookLines = (sessionId?: string) => readLines(join(hooksOut, 'hooks.jsonl')).filter((l) => !sessionId || l.session_id === sessionId)
const binLines = () => readLines(join(hooksOut, 'bin.jsonl'))

/** Every file Claude Code keeps for a session under ~/.claude/projects: the transcript and its subagents/ tree. */
function transcriptFiles(sessionId: string | undefined): string[] {
  if (!sessionId) return []
  const projects = join(home, '.claude', 'projects')
  const out: string[] = []
  for (const p of existsSync(projects) ? readdirSync(projects) : []) {
    const main = join(projects, p, `${sessionId}.jsonl`)
    if (existsSync(main)) out.push(main)
    const dir = join(projects, p, sessionId)
    if (existsSync(dir)) out.push(...tree(dir, /^$/).map((f) => join(dir, f)))
  }
  return out
}
const createdTranscripts: string[] = []

/** Waits for a file condition while a background workflow runs. */
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  return pred()
}

function workflowRuns(sessionId: string | undefined): Facts[] {
  return transcriptFiles(sessionId)
    .filter((f) => /\/subagents\/workflows\/[^/]+\/(journal\.jsonl|agent-[^/]+\.meta\.json)$/.test(f))
    .map((f) => ({ file: scrub(f.replace(/^.*\/subagents\//, 'subagents/')), content: f.endsWith('.json') ? sanitize(JSON.parse(readFileSync(f, 'utf8'))) : readLines(f).map((l) => sanitize(l)) }))
}

// --- real settings guard ---------------------------------------------------------------------

const GUARDED = [join(home, '.claude', 'settings.json'), join(home, '.claude', 'plugins', 'installed_plugins.json'), join(home, '.claude', 'plugins', 'known_marketplaces.json'), join(home, '.claude.json')]
const fingerprint = () => Object.fromEntries(GUARDED.map((f) => [scrub(f), existsSync(f) ? createHash('sha1').update(readFileSync(f)).digest('hex') : 'absent']))

// --- fixtures ----------------------------------------------------------------------------------

const fixtureMessages: { file: string; messages: unknown[] }[] = []
/** system/init of a session, sanitized, as plugin-<scenario>-<variant>.jsonl. */
function keepInit(scenario: string, variant: string, s: Session): void {
  const init = initOf(s)
  if (init) fixtureMessages.push({ file: `plugin-${scenario}-${variant}.jsonl`, messages: [init] })
}

// --- prompts -----------------------------------------------------------------------------------

const MARK_RULE = 'MARK_S is the value after "WORFY_SPIKE_SESSION_MARK=" in your context, MARK_A the value after "WORFY_SPIKE_SUBAGENT_MARK="; write NONE for a mark you do not see. Do not guess.'
const subagentPrompt = (who: string) => `In Bash run exactly: worfy-spike-bin ${who} MARK_A MARK_S — with the marks substituted. ${MARK_RULE} If the command is not found, reply NO_BIN; otherwise reply with its output.`
const workflowScript = (who: string) =>
  [
    "export const meta = { name: 'worfy-spike-hooks', description: 'Spike: one agent reports the hook marks it sees' }",
    `const r = await agent(${JSON.stringify(subagentPrompt(who))}, { label: 'spike-${who}' })`,
    'return r',
  ].join('\n')

// --- scenarios ---------------------------------------------------------------------------------

/** A temporary working directory outside any git repository: the user's hooks that act on a repo stay idle. */
const workDir = (name: string): string => {
  const d = join(scratch, `work-${name}`)
  mkdirSync(d, { recursive: true })
  return d
}

async function runKnown(): Promise<Facts> {
  // Part A, sandbox, no model: the sample installed in the user scope, then the same name inline.
  const sb = sandbox('known')
  const mp = marketplaceCopy(sb.dir)
  const setup = [cli(sb, ['plugin', 'marketplace', 'add', mp]), cli(sb, ['plugin', 'install', 'worfy@worfy-spike', '--scope', 'user', '--json'])]
  const inline = join(scratch, 'inline-known', 'worfy')
  cpSync(FIXTURE, inline, { recursive: true })
  setVersion(inline, '9.9.9-inline')
  const sandboxInit = async (variant: string, plugins?: Options['plugins']): Promise<Facts> => {
    const s = start(sessionOptions(workDir('known-sandbox'), { env: sb.env, ...(plugins ? { plugins } : {}) }))
    await s.turn('Reply with: ok')
    await s.finish()
    keepInit('known', variant, s)
    return initInventory(initOf(s))
  }
  const installedOnly = await sandboxInit('installed')
  const installedPlusInline = await sandboxInit('inline-over-installed', [{ type: 'local', path: inline }])

  // Part B, the user's settings and the model: bin/ on PATH, ${CLAUDE_PLUGIN_ROOT} in SKILL.md, the hook marks.
  const before = binLines().length
  const s = start(sessionOptions(workDir('known'), { plugins: [{ type: 'local', path: FIXTURE }], ...WORFY_MCP, maxTurns: 12 }))
  const r = await s.turn(
    [
      'This is an automated test. Do exactly these steps and nothing else:',
      '1. Use the Skill tool to run the skill "worfy:spike-root" and do what it says.',
      `2. In Bash run exactly: worfy-spike-bin main MARK_S — with the mark substituted. ${MARK_RULE}`,
      `3. Use the Agent tool (subagent_type "general-purpose") with this prompt: "${subagentPrompt('sub')}"`,
      '4. Reply with the single word: done',
    ].join('\n'),
  )
  await s.finish()
  keepInit('known', 'user-settings', s)
  const sid = sessionIdOf(s)
  createdTranscripts.push(...transcriptFiles(sid))
  const bins = binLines().slice(before)
  const realFixture = realpathSync(FIXTURE)
  const skillRun = bins.find((b) => b.who === 'skill')
  return {
    sandbox_setup: setup,
    a_user_scope_plugin_loads: installedOnly,
    b_inline_over_installed: installedPlusInline,
    user_session: {
      result: resultFacts(r),
      inventory: initInventory(initOf(s)),
      user_scope_plugins_in_init: ((initOf(s)?.plugins as { name?: string; path?: string }[] | undefined) ?? []).filter((p) => p.name !== 'worfy' && p.path !== 'builtin').length,
      c_bin_on_path: bins.map((b) => ({ who: b.who, plugin_bin_on_path: b.plugin_bin_on_path })),
      d_plugin_root_in_skill: skillRun ? { arg: skillRun.marks, substituted: (skillRun.marks as string[])[0] === realFixture || (skillRun.marks as string[])[0] === FIXTURE } : 'skill did not run worfy-spike-bin',
      e_marks: bins.filter((b) => b.who !== 'skill').map(markFacts),
      hooks: hookLines(sid).map((h) => ({ event: h.event, agent_type: h.agent_type, agent_id: h.agent_id ? 'set' : null, source: h.source })),
    },
  }
}

async function runWorkflowHooks(): Promise<Facts> {
  const before = binLines().length
  const s = start(sessionOptions(workDir('workflow-hooks'), { plugins: [{ type: 'local', path: FIXTURE }], ...WORFY_MCP, maxTurns: 6 }))
  const r = await s.turn(
    [
      'This is an automated test. Call the Workflow tool once, with exactly this script as its `script` argument and no other arguments, then reply with the single word: started',
      '',
      workflowScript('wf'),
    ].join('\n'),
  )
  const done = await waitFor(() => binLines().slice(before).some((b) => b.who === 'wf') || workflowRuns(sessionIdOf(s)).some((w) => JSON.stringify(w.content).includes('"result"')), 240_000)
  // The task notification starts a turn of its own; let it end before closing.
  const followUp = await s.nextResult(90_000)
  await s.finish()
  keepInit('workflow-hooks', 'user-settings', s)
  const sid = sessionIdOf(s)
  createdTranscripts.push(...transcriptFiles(sid))
  const workflowCalls = msgs(s)
    .filter((m) => m.type === 'assistant')
    .flatMap((m) => ((m.message as { content?: { type?: string; name?: string }[] }).content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.name))
  return {
    result: resultFacts(r),
    follow_up_result: resultFacts(followUp),
    workflow_agent_finished: done,
    tool_uses_of_main_session: workflowCalls,
    workflow_tool_in_init: ((initOf(s)?.tools as string[] | undefined) ?? []).includes('Workflow'),
    bin_runs: binLines().slice(before).map(markFacts),
    hooks: hookLines(sid).map((h) => ({ event: h.event, agent_type: h.agent_type, agent_id: h.agent_id ? 'set' : null, source: h.source, command: h.command ? scrub(String(h.command)) : undefined })),
    workflow_files: workflowRuns(sid),
  }
}

/** A fake `gh`: prints FAKE_TOKEN for `auth token`, `fake-login` for `api user`, and counts its calls. */
function fakeGh(): string {
  const dir = join(scratch, 'fake-gh')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'gh')
  writeFileSync(
    file,
    [
      '#!/bin/sh',
      `printf '%s\\t%s\\n' "$(date +%s)" "$*" >> "${join(hooksOut, 'gh-calls.log')}"`,
      `case "$1 $2" in "auth token") printf '%s\\n' '${FAKE_TOKEN}' ;; "api user") printf 'fake-login\\n' ;; *) exit 1 ;; esac`,
      '',
    ].join('\n'),
  )
  chmodSync(file, 0o755)
  return dir
}
const ghCalls = () => (existsSync(join(hooksOut, 'gh-calls.log')) ? readFileSync(join(hooksOut, 'gh-calls.log'), 'utf8').split('\n').filter(Boolean) : [])

// The env file's line calls `gh auth token -u <account>`; the user's own hooks may call gh too
// (qmd-refresh's git credential helper runs `gh auth token --user …`), so calls are told apart by
// their arguments.
const envFileCalls = (lines: string[]) => lines.filter((l) => / auth token -u /.test(` ${l.split('\t')[1] ?? ''} `)).length
const otherCalls = (lines: string[]) => lines.filter((l) => !/ auth token -u /.test(` ${l.split('\t')[1] ?? ''} `)).map((l) => l.split('\t')[1])

function profileAccount(): string {
  const fromFlag = flag('--account')
  if (fromFlag) return fromFlag
  return execFileSync(join(home, '.claude', 'bin', 'profile'), ['-C', repo, '--field', 'github.account'], { encoding: 'utf8' }).trim()
}

/** Files that contain a string — the string itself is never printed. */
const filesContaining = (files: string[], needle: string): string[] => files.filter((f) => existsSync(f) && statSync(f).isFile() && readFileSync(f, 'utf8').includes(needle))

async function runEnvFile(): Promise<Facts> {
  const account = profileAccount()
  const ghDir = fakeGh()
  const emptyGhConfig = join(scratch, 'empty-gh-config')
  mkdirSync(emptyGhConfig, { recursive: true })
  // Fake gh first on PATH; GH_CONFIG_DIR empty, so even a real gh found later has no token to give.
  const fakeEnv = cleanEnv({ PATH: `${ghDir}:${process.env.PATH ?? ''}`, GH_CONFIG_DIR: emptyGhConfig, WORFY_SPIKE_GH_ACCOUNT: account })

  // 1. SDK session (the bundled binary): main Bash, an Agent Subagent, a workflow-script agent.
  const binBefore = binLines().length
  const ghBefore = ghCalls().length
  const cwd = workDir('env-file')
  const s = start(sessionOptions(cwd, { plugins: [{ type: 'local', path: FIXTURE }], ...WORFY_MCP, model: ENV_FILE_MODEL, env: fakeEnv, maxTurns: 12 }))
  const r = await s.turn(
    [
      'This is an automated test. Do exactly these steps and nothing else:',
      '1. In Bash run exactly: worfy-spike-bin main',
      '2. In Bash run exactly: set -o pipefail; printf %s "$GH_TOKEN" | shasum -a 256',
      '3. In Bash run exactly: worfy-spike-bin main-again',
      '4. Use the Agent tool (subagent_type "general-purpose") with this prompt: "In Bash run exactly: worfy-spike-bin sub — then reply with its output."',
      '5. Call the Workflow tool once with exactly this script as its `script` argument:',
      '',
      ["export const meta = { name: 'worfy-spike-env', description: 'Spike: GH_TOKEN in a workflow agent' }", "return await agent('In Bash run exactly: worfy-spike-bin wf — then reply with its output.', { label: 'spike-env-wf' })"].join('\n'),
      '',
      '6. Reply with the single word: started',
    ].join('\n'),
  )
  await waitFor(() => binLines().slice(binBefore).some((b) => b.who === 'wf'), 240_000)
  const followUp = await s.nextResult(90_000)
  await s.finish()
  keepInit('env-file', 'sdk', s)
  const sid = sessionIdOf(s)
  const sdkTranscripts = transcriptFiles(sid)
  createdTranscripts.push(...sdkTranscripts)
  const sdkBins = binLines().slice(binBefore)
  const sdkHooks = hookLines(sid)
  const bashHashOutputs = msgs(s)
    .filter((m) => m.type === 'user')
    .flatMap((m) => ((m.message as { content?: unknown }).content as { type?: string; content?: unknown }[] | string | undefined) ?? [])
    .filter((b) => typeof b === 'object' && b.type === 'tool_result')
    .map((b) => JSON.stringify((b as { content?: unknown }).content))
    .filter((t) => /[0-9a-f]{64}/.test(t))
  const sdkPart = {
    result: resultFacts(r),
    follow_up_result: resultFacts(followUp),
    session_start_hooks: sdkHooks.filter((h) => h.event === 'SessionStart').map((h) => ({ source: h.source, claude_env_file_set: h.claude_env_file_set, env_file_written: h.env_file_written })),
    bash_commands_seen_by_pretooluse: sdkHooks.filter((h) => h.event === 'PreToolUse').map((h) => ({ agent_type: h.agent_type, command: scrub(String(h.command)) })),
    env_file_gh_calls: envFileCalls(ghCalls().slice(ghBefore)),
    other_gh_calls: otherCalls(ghCalls().slice(ghBefore)),
    bin_runs: sdkBins.map((b) => ({ who: b.who, gh_token_set: b.gh_token_set, is_fake_token: b.gh_token_sha256 === sha256(FAKE_TOKEN) })),
    agent_hash_matches_fake: bashHashOutputs.some((t) => t.includes(sha256(FAKE_TOKEN))),
    subagent_start_hooks: sdkHooks.filter((h) => h.event === 'SubagentStart').map((h) => h.agent_type),
    transcripts: sdkTranscripts.length,
    workflow_files: workflowRuns(sid).map((w) => w.file),
  }

  // 2. `claude -p` from the terminal with the plugin by --plugin-dir.
  const termBin = binLines().length
  const termGh = ghCalls().length
  const termHooks = hookLines().length
  const term = spawnSync(
    'claude',
    ['-p', 'This is an automated test. In Bash run exactly: worfy-spike-bin term — then reply with the single word: done', '--plugin-dir', FIXTURE, '--model', MODEL, '--strict-mcp-config', '--allowedTools', 'Bash(worfy-spike-bin:*)', '--output-format', 'json'],
    { cwd: workDir('env-file-terminal'), env: fakeEnv, encoding: 'utf8', timeout: 240_000 },
  )
  let termSession: string | undefined
  try {
    termSession = (JSON.parse(term.stdout) as { session_id?: string }).session_id
  } catch {
    termSession = undefined
  }
  const termTranscripts = transcriptFiles(termSession)
  createdTranscripts.push(...termTranscripts)
  const claudeVersion = spawnSync('claude', ['--version'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim()
  const termPart = {
    claude_version: claudeVersion,
    exit: term.status,
    stderr: scrub(term.stderr ?? '').slice(0, 300),
    session_start_hooks: hookLines()
      .slice(termHooks)
      .filter((h) => h.event === 'SessionStart')
      .map((h) => ({ source: h.source, claude_env_file_set: h.claude_env_file_set, env_file_written: h.env_file_written })),
    bash_commands_seen_by_pretooluse: hookLines()
      .slice(termHooks)
      .filter((h) => h.event === 'PreToolUse').length,
    env_file_gh_calls: envFileCalls(ghCalls().slice(termGh)),
    other_gh_calls: otherCalls(ghCalls().slice(termGh)),
    bin_runs: binLines()
      .slice(termBin)
      .map((b) => ({ who: b.who, gh_token_set: b.gh_token_set, is_fake_token: b.gh_token_sha256 === sha256(FAKE_TOKEN) })),
    transcripts: termTranscripts.length,
  }

  // 3. The real gh of the user, the Project's account: compared by hash in memory only.
  const realBin = binLines().length
  const realEnv = cleanEnv({ WORFY_SPIKE_GH_ACCOUNT: account })
  const s2 = start(sessionOptions(workDir('env-file-real'), { plugins: [{ type: 'local', path: FIXTURE }], ...WORFY_MCP, env: realEnv, maxTurns: 4 }))
  const r2 = await s2.turn('This is an automated test. In Bash run exactly: worfy-spike-bin real --login — then reply with the single word: done')
  await s2.finish()
  const sid2 = sessionIdOf(s2)
  const realTranscripts = transcriptFiles(sid2)
  createdTranscripts.push(...realTranscripts)
  const realRun = binLines()
    .slice(realBin)
    .find((b) => b.who === 'real')
  const allTranscripts = [...sdkTranscripts, ...termTranscripts, ...realTranscripts]
  // The real token lives only inside this function: compared by hash, searched for, never returned.
  const compareRealToken = (): Facts => {
    let token: string
    try {
      token = execFileSync('gh', ['auth', 'token', '-u', account], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: cleanEnv() }).trim()
    } catch {
      return { token_is_the_accounts: 'gh auth token failed: nothing to compare' }
    }
    return {
      token_is_the_accounts: realRun?.gh_token_sha256 === sha256(token),
      real_token_in_transcripts: filesContaining(allTranscripts, token).length,
      real_token_in_probe_output: filesContaining(
        tree(outDir, /^$/).map((f) => join(outDir, f)),
        token,
      ).length,
    }
  }
  const realPart = {
    github_account: account,
    result: resultFacts(r2),
    gh_token_set: realRun?.gh_token_set ?? null,
    gh_api_user_login: realRun?.gh_login ?? realRun?.gh_login_error ?? null,
    ...compareRealToken(),
  }

  const outFiles = tree(outDir, /^$/).map((f) => join(outDir, f))
  return {
    sdk: sdkPart,
    terminal: termPart,
    real_gh: realPart,
    fake_token_in_transcripts: filesContaining([...sdkTranscripts, ...termTranscripts, ...realTranscripts], FAKE_TOKEN).map((f) => scrub(f)),
    fake_token_in_probe_output: filesContaining(outFiles, FAKE_TOKEN).map((f) => scrub(f)),
  }
}

async function runInstall(): Promise<Facts> {
  // Layout of marketplace/: marketplace.json with the plugin in ./worfy.
  const sb = sandbox('install')
  const mp = marketplaceCopy(sb.dir)
  const plugins = join(sb.config, 'plugins')
  const steps: Facts = {}
  steps.validate_plugin = twice(sb, ['plugin', 'validate', join(mp, 'worfy')])
  steps.validate_marketplace = twice(sb, ['plugin', 'validate', mp])
  steps.marketplace_add = twice(sb, ['plugin', 'marketplace', 'add', mp])
  steps.install = twice(sb, ['plugin', 'install', 'worfy@worfy-spike', '--scope', 'user', '--json'])
  steps.list_after_install = cli(sb, ['plugin', 'list', '--json'])
  steps.files_after_install = tree(sb.config)
  steps.settings_after_install = readJson(join(sb.config, 'settings.json'))
  steps.installed_plugins = readJson(join(plugins, 'installed_plugins.json'))
  steps.known_marketplaces = readJson(join(plugins, 'known_marketplaces.json'))
  // A session in the sandbox: which copy loads — the marketplace folder or plugins/cache.
  const s = start(sessionOptions(workDir('install-session'), { env: sb.env }))
  await s.turn('Reply with: ok')
  await s.finish()
  steps.session_plugins = initInventory(initOf(s)).plugins

  // A new version in the marketplace folder.
  setVersion(join(mp, 'worfy'), '0.2.0')
  steps.v2_list_before_update = cli(sb, ['plugin', 'list', '--json'])
  steps.v2_update = twice(sb, ['plugin', 'update', 'worfy@worfy-spike', '--scope', 'user'])
  steps.v2_list_after_update = cli(sb, ['plugin', 'list', '--json'])
  steps.v2_files = tree(join(plugins, 'cache'))
  setVersion(join(mp, 'worfy'), '0.3.0')
  steps.v3_install_again = cli(sb, ['plugin', 'install', 'worfy@worfy-spike', '--scope', 'user', '--json'])
  steps.v3_list = cli(sb, ['plugin', 'list', '--json'])
  steps.v3_marketplace_update = cli(sb, ['plugin', 'marketplace', 'update', 'worfy-spike'])
  steps.v3_update_after_marketplace_update = cli(sb, ['plugin', 'update', 'worfy@worfy-spike', '--scope', 'user'])
  steps.v3_list_after = cli(sb, ['plugin', 'list', '--json'])
  steps.v3_files = tree(join(plugins, 'cache'))
  // ADR-0040, point 4: version `<semver>+<short SHA>`. Same semver, other build metadata — as two
  // builds of one release (Stable copy and dev) would differ — and back again.
  const versions: Facts = {}
  for (const [i, v] of ['0.4.0+aaaaaaa', '0.4.0+bbbbbbb', '0.4.0+aaaaaaa', '0.3.9+ccccccc'].entries()) {
    setVersion(join(mp, 'worfy'), v)
    const update = cli(sb, ['plugin', 'update', 'worfy@worfy-spike', '--scope', 'user'])
    const list = cli(sb, ['plugin', 'list', '--json'])
    const entry = (Array.isArray(list.json) ? (list.json as Record<string, unknown>[]) : [])[0]
    versions[`${i + 1}: ${v}`] = { update, recorded_version: entry?.version, install_path: entry?.installPath }
  }
  steps.build_metadata_versions = versions
  steps.uninstall = twice(sb, ['plugin', 'uninstall', 'worfy@worfy-spike', '--scope', 'user'])
  steps.list_after_uninstall = cli(sb, ['plugin', 'list', '--json'])
  steps.files_after_uninstall = tree(sb.config)
  steps.settings_after_uninstall = readJson(join(sb.config, 'settings.json'))

  // The same folder as both marketplace and plugin (ADR-0040: the copy of harness/ is the marketplace), source "./".
  const sbA = sandbox('install-same-folder')
  const same = join(sbA.dir, 'harness')
  cpSync(FIXTURE, same, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(MARKETPLACE, '.claude-plugin', 'marketplace.json'), 'utf8')) as { plugins: { source: string }[] }
  manifest.plugins = manifest.plugins.map((p) => ({ ...p, source: './' }))
  writeFileSync(join(same, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const sameFolder = {
    validate: cli(sbA, ['plugin', 'validate', same]),
    marketplace_add: cli(sbA, ['plugin', 'marketplace', 'add', same]),
    install: cli(sbA, ['plugin', 'install', 'worfy@worfy-spike', '--scope', 'user', '--json']),
    list: cli(sbA, ['plugin', 'list', '--json']),
  }

  // Without network: every request goes to a closed local port.
  const dead = 'http://127.0.0.1:9'
  const sbN = sandbox('install-offline', { HTTPS_PROXY: dead, HTTP_PROXY: dead, https_proxy: dead, http_proxy: dead, NO_PROXY: '', no_proxy: '' })
  const mpN = marketplaceCopy(sbN.dir)
  const offline = {
    marketplace_add: cli(sbN, ['plugin', 'marketplace', 'add', mpN]),
    install: cli(sbN, ['plugin', 'install', 'worfy@worfy-spike', '--scope', 'user', '--json']),
    list: cli(sbN, ['plugin', 'list', '--json']),
    uninstall: cli(sbN, ['plugin', 'uninstall', 'worfy@worfy-spike', '--scope', 'user']),
  }
  return { binary: scrub(CLAUDE_BIN), logged_in: false, steps, same_folder_marketplace: sameFolder, offline }
}

// Every session here also gets an in-process SDK server named `worfy-canvas`, as worfy's own
// Sessions do (src/main/mcp/canvas-server.ts), to see what a command entry does to it.
async function canvasServer(): Promise<NonNullable<Options['mcpServers']>> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  const ping = tool('canvas_ping', 'Spike tool of the worfy-canvas stand-in. Returns pong.', {}, () => Promise.resolve({ content: [{ type: 'text' as const, text: 'pong from canvas' }] }))
  return { 'worfy-canvas': createSdkMcpServer({ name: 'worfy-canvas', version: '0.0.1', tools: [ping] }) }
}

// The variants whose system/init goes to the fixtures: one per distinct outcome.
const FIXTURE_VARIANTS = new Set(['plugin-only-no-allowlist', 'user-qmd-no-allowlist', 'user-qmd-allow-qmd', 'user-qmd-allow-plugin-name', 'user-qmd-allow-qmd-and-command', 'user-qmd-allow-both-commands', 'user-qmd-host-server-allow-by-name', 'user-qmd-host-server-not-listed', 'user-qmd-skip-discovery-allow-command'])

async function runMcpName(): Promise<Facts> {
  const serverJs = join(FIXTURE, 'mcp', 'server.mjs')
  // allowedMcpServers entries: by name (every spelling the plugin server's name takes) and by command.
  const variants: [string, Record<string, unknown>[] | null][] = [
    ['no-allowlist', null],
    ['allow-qmd', [{ serverName: 'qmd' }]],
    ['allow-plugin-name', [{ serverName: 'plugin:worfy:qmd' }]],
    ['allow-tool-prefix', [{ serverName: 'plugin_worfy_qmd' }]],
    ['allow-worfy-qmd', [{ serverName: 'worfy:qmd' }]],
    ['allow-plugin', [{ serverName: 'worfy' }]],
    ['allow-command', [{ serverCommand: ['node', serverJs] }]],
    ['allow-command-unexpanded', [{ serverCommand: ['node', '${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs'] }]],
    ['allow-qmd-and-plugin-name', [{ serverName: 'qmd' }, { serverName: 'plugin:worfy:qmd' }]],
    ['allow-qmd-and-command', [{ serverName: 'qmd' }, { serverCommand: ['node', serverJs] }]],
    ['allow-both-commands', [{ serverCommand: ['node', serverJs] }, { serverCommand: ['node', serverJs, 'user'] }]],
    ['allow-canvas-and-command', [{ serverName: 'worfy-canvas' }, { serverCommand: ['node', serverJs] }]],
    ['allow-none', []],
    // The plugin with skipMcpDiscovery and the same server registered by the host under the name
    // the plugin's tools carry (`plugin_worfy_qmd`), so the tool names stay mcp__plugin_worfy_qmd__….
    ['host-server-allow-by-name', [{ serverName: 'plugin_worfy_qmd' }, { serverName: 'qmd' }, { serverName: 'worfy-canvas' }]],
    // Does the list filter a host server at all? Its name absent from the list, and an empty list.
    ['host-server-not-listed', [{ serverName: 'qmd' }, { serverName: 'worfy-canvas' }]],
    ['host-server-allow-none', []],
    // Does skipMcpDiscovery drop the plugin's own server? Without a list, and with the command
    // entry that admits that server otherwise (allow-command).
    ['skip-discovery-no-allowlist', null],
    ['skip-discovery-allow-command', [{ serverCommand: ['node', serverJs] }]],
  ]
  const out: Facts = {}
  for (const userQmd of [false, true]) {
    const sb = sandbox(`mcp-${userQmd ? 'user-qmd' : 'plugin-only'}`)
    if (userQmd) writeFileSync(join(sb.config, '.claude.json'), `${JSON.stringify({ mcpServers: { qmd: { type: 'stdio', command: 'node', args: [serverJs, 'user'] } } }, null, 2)}\n`)
    for (const [name, allow] of variants) {
      const variant = `${userQmd ? 'user-qmd' : 'plugin-only'}-${name}`
      const managed = allow === null ? {} : { managedSettings: { allowManagedMcpServersOnly: true, allowedMcpServers: allow } }
      const hostOwned = name.startsWith('host-server')
      const skip = hostOwned || name.startsWith('skip-discovery')
      const plugins: Options['plugins'] = [{ type: 'local', path: FIXTURE, ...(skip ? { skipMcpDiscovery: true } : {}) }]
      const mcpServers: Options['mcpServers'] = { ...(await canvasServer()), ...(hostOwned ? { plugin_worfy_qmd: { type: 'stdio', command: 'node', args: [serverJs] } } : {}) }
      const s = start(sessionOptions(workDir('mcp'), { env: sb.env, plugins, mcpServers, ...managed }))
      const status = await mcpStatus(s.q)
      await s.turn('Reply with: ok')
      await s.finish()
      if (FIXTURE_VARIANTS.has(variant)) keepInit('mcp-name', variant, s)
      const inv = initInventory(initOf(s))
      out[variant] = { allowedMcpServers: allow, mcp_server_status: status, init_mcp_servers: inv.mcp_servers, init_mcp_tools: inv.mcp_tools, plugin_errors: inv.plugin_errors }
    }
  }
  return out
}

const RUNNERS: Record<Scenario, () => Promise<Facts>> = {
  known: runKnown,
  'workflow-hooks': runWorkflowHooks,
  'env-file': runEnvFile,
  install: runInstall,
  'mcp-name': runMcpName,
}

// --- main ------------------------------------------------------------------------------------

/** Re-applies scrub() to every string of the plugin-*.jsonl fixtures in a directory, without a model call. */
function rescrub(dir: string): void {
  const deep = (v: unknown): unknown => {
    if (typeof v === 'string') return scrub(v)
    if (Array.isArray(v)) return v.map(deep)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
    return v
  }
  const files = readdirSync(dir).filter((f) => f.startsWith('plugin-') && f.endsWith('.jsonl'))
  const parsed = files.map((f) => ({ f, values: readLines(join(dir, f)) }))
  for (const f of files) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/00000000-0000-4000-8000-(\d{12})/g)) uuidBase = Math.max(uuidBase, Number(m[1]))
  registerPlugins(parsed.flatMap((p) => p.values))
  for (const { f, values } of parsed) {
    writeFileSync(join(dir, f), `${values.map((v) => JSON.stringify(deep(v))).join('\n')}\n`)
    process.stdout.write(`[probe] rescrubbed ${f}\n`)
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  app.dock?.hide()
  const rescrubDir = flag('--rescrub')
  if (rescrubDir) return rescrub(resolve(rescrubDir))
  mkdirSync(hooksOut, { recursive: true })
  const sdkPkg = JSON.parse(readFileSync(join(repo, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')) as { version: string; claudeCodeVersion?: string }
  const results: Facts = {}
  const guard: Facts = { before: fingerprint() }
  const summary: Facts = {
    sdk_version: sdkPkg.version,
    bundled_claude_code: spawnSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim(),
    model: MODEL,
    electron: process.versions.electron,
    scenarios: results,
    real_settings: guard,
  }
  for (const name of scenarios) {
    const runner = RUNNERS[name]
    if (!runner) throw new Error(`unknown scenario: ${name}`)
    process.stdout.write(`[probe] ${name} …\n`)
    try {
      const facts = await runner()
      registerPlugins(facts)
      results[name] = sanitize(facts)
    } catch (err) {
      results[name] = { probe_error: scrub(err instanceof Error ? (err.stack ?? err.message) : String(err)) }
    }
    guard[`after_${name}`] = fingerprint()
  }
  summary.transcripts_created = [...new Set(createdTranscripts)].map((f) => scrub(f))
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  // The raw transcript paths, for the owner to decide about them; the file stays in --out only.
  writeFileSync(join(outDir, 'transcripts-created.txt'), `${[...new Set(createdTranscripts)].join('\n')}\n`)
  if (fixturesDir) {
    mkdirSync(fixturesDir, { recursive: true })
    registerPlugins(fixtureMessages)
    for (const f of fixtureMessages) writeFileSync(join(fixturesDir, f.file), `${f.messages.map((m) => JSON.stringify(sanitize(m))).join('\n')}\n`)
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n[probe] written to ${outDir}\n`)
}

main().then(
  () => app.exit(0),
  (err: unknown) => {
    process.stderr.write(`[probe] failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    app.exit(1)
  },
)
