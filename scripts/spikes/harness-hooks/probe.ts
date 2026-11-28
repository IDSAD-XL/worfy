// Spike for ticket worfy-harness-guarantees/01 (result: the "Itog" (summary) section of the ticket): how the Claude Code
// of the pinned Agent SDK calls the hooks of the Harness plugin `worfy`. No model, no key, no
// sign-in: every run goes to a local scripted stand-in of the Messages API, with the environment of
// test/contract/messages-api-stand-in.ts (claudeEnv: a fake key, HOME and CLAUDE_CONFIG_DIR in a
// temporary folder, no telemetry). Nothing reads or writes the real ~/.claude.
//
// Run from the repository root with plain Node 24 (it strips the types; no Electron):
//
//   node scripts/spikes/harness-hooks/probe.ts [scenario ...] [--out <dir>] [--fixtures <dir>]
//
// Scenarios (all when none is named):
//   init-errors  system/init of Harness copies: broken hooks.json, a missing hook script, unmet engines
//   listing      the get_hooks_listing control request on the Harness, with and without disableAllHooks
//   edit-hooks   PreToolUse Edit|Write|MultiEdit|NotebookEdit in bypassPermissions: main thread,
//                Subagent, a Session started with an agent (--agent) and its Subagent
//   ask          permissionDecision "ask" from PreToolUse in bypassPermissions: canUseTool or not
//   cli          claude -p --output-format stream-json --verbose: does the stand-in drive a Subagent turn
//   claude-home  what Claude Code writes under its config folder and which config paths it tells the model
//
// --fixtures <dir> writes the sanitized system/init messages of init-errors to
// <dir>/init-plugin-errors.jsonl. Everything else goes to --out (default: a new temporary folder).
//
// The stand-in here scripts a chain of tool calls per conversation (the main thread and each
// Subagent), where test/contract/messages-api-stand-in.ts scripts one call: a Subagent's Write
// needs two (Agent in the main thread, Write in the Subagent).

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { claudeEnv } from '../../../test/contract/messages-api-stand-in.ts'

type Block = Record<string, unknown>
interface Call {
  id: string
  name: string
  input: Record<string, unknown>
}
/** A conversation is told by a marker in its first user message; it gets its calls in order. */
interface Chain {
  marker: string
  calls: Call[]
}

const REPO = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..')
const HARNESS = join(REPO, 'harness')
const SDK_DIR = realpathSync(join(REPO, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'))
const MODEL = 'claude-sonnet-4-5'
const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const flagValues = new Set([flag('--out'), flag('--fixtures')])
const ALL = ['init-errors', 'listing', 'edit-hooks', 'ask', 'cli', 'claude-home']
const picked = args.filter((a) => !a.startsWith('--') && !flagValues.has(a))
const scenarios = picked.length > 0 ? picked : ALL
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-hooks-probe-')))
const outDir = resolve(flag('--out') ?? join(scratch, 'out'))
mkdirSync(outDir, { recursive: true })
/** A new folder of the scratch folder: names are unique per run, so a fixture needs no random suffix. */
const fresh = (name: string): string => {
  const dir = join(scratch, name)
  mkdirSync(dir)
  return dir
}
const fixturesDir = flag('--fixtures') === undefined ? undefined : resolve(flag('--fixtures') as string)

// ---------- the scripted stand-in ----------

interface StandIn {
  url: string
  requests: Block[]
  close(): Promise<void>
}

function sse(res: ServerResponse, events: Block[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of events) res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
  res.end()
}
const start = (id: string): Block => ({
  type: 'message_start',
  message: { id, type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
})
function answerText(res: ServerResponse, stream: boolean, said: string): void {
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'msg_text', type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: said }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 3 } }))
    return
  }
  sse(res, [
    start('msg_text'),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: said } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ])
}
function answerTool(res: ServerResponse, call: Call): void {
  sse(res, [
    start(`msg_${call.id}`),
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ])
}
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? (content as Block[]).map((b) => (typeof b.text === 'string' ? b.text : textOf(b.content))).join('\n') : ''

async function body(req: IncomingMessage): Promise<Block> {
  let raw = ''
  for await (const chunk of req) raw += String(chunk)
  try {
    return JSON.parse(raw) as Block
  } catch {
    return {}
  }
}

async function startStandIn(chains: Chain[]): Promise<StandIn> {
  const requests: Block[] = []
  const server = createServer((req, res) => {
    void body(req).then((json) => {
      const url = req.url ?? ''
      if (!url.startsWith('/v1/messages') || url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: 10 }))
        return
      }
      const messages = Array.isArray(json.messages) ? (json.messages as Block[]) : []
      const tools = Array.isArray(json.tools) ? (json.tools as Block[]).map((t) => String(t.name)) : []
      const first = textOf(messages[0]?.content)
      requests.push({ system: textOf(json.system), first, tools })
      const chain = chains.find((c) => first.includes(c.marker))
      if (chain !== undefined && tools.length > 0) {
        const answered = new Set(messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as Block[]) : []).filter((b) => b.type === 'tool_result').map((b) => String(b.tool_use_id))))
        const next = chain.calls.find((c) => !answered.has(c.id))
        if (next !== undefined && tools.includes(next.name)) {
          answerTool(res, next)
          return
        }
      }
      answerText(res, json.stream === true, 'done')
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}

// ---------- plugins and runs ----------

/** A plugin whose hooks log their input to $PROBE_HOOK_LOG; PreToolUse answers $PROBE_DECISION when set. */
function probePlugin(dir: string, matcher: string, extra: Record<string, unknown> = {}): string {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'hooks-probe', description: 'hooks of the spike', ...extra }))
  writeFileSync(
    join(dir, 'hooks', 'log.mjs'),
    [
      "import { appendFileSync, readFileSync } from 'node:fs'",
      "const input = JSON.parse(readFileSync(0, 'utf8'))",
      'appendFileSync(process.env.PROBE_HOOK_LOG, JSON.stringify(input) + "\\n")',
      "const decision = process.env.PROBE_DECISION",
      "if (input.hook_event_name === 'PreToolUse' && decision) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: 'spike ' + decision } }))",
      '',
    ].join('\n'),
  )
  const hook = { type: 'command', command: `node "${join(dir, 'hooks', 'log.mjs')}"`, timeout: 10 }
  writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher, hooks: [hook] }], SubagentStart: [{ hooks: [hook] }], Stop: [{ hooks: [hook] }] } }))
  return dir
}

interface Run {
  messages: SDKMessage[]
  stderr: string
  hookLog: Block[]
  requests: Block[]
  home: string
  cwd: string
  extra: Record<string, unknown>
}

async function run(name: string, chains: Chain[], prompt: string, options: Partial<Options>, after?: (q: ReturnType<typeof query>, extra: Record<string, unknown>) => Promise<void>, env: Record<string, string> = {}): Promise<Run> {
  const standIn = await startStandIn(chains)
  const home = fresh(`home-${name}`)
  const cwd = fresh(`cwd-${name}`)
  const hookLogPath = join(scratch, `hooks-${name}.jsonl`)
  writeFileSync(hookLogPath, '')
  const stderr: string[] = []
  const messages: SDKMessage[] = []
  const extra: Record<string, unknown> = {}
  const q = query({
    prompt,
    options: {
      cwd,
      env: { ...claudeEnv(standIn, home), HARNESS_HOME: join(home, 'harness'), PROBE_HOOK_LOG: hookLogPath, ...env },
      settingSources: [],
      model: MODEL,
      includeHookEvents: true,
      stderr: (data) => stderr.push(data),
      ...options,
    },
  })
  try {
    for await (const message of q) {
      messages.push(message)
      if (message.type === 'system' && message.subtype === 'init' && after !== undefined) await after(q, extra)
      if (message.type === 'result') break
    }
  } finally {
    q.close()
    await standIn.close()
  }
  const hookLog = readFileSync(hookLogPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Block)
  const result: Run = { messages, stderr: stderr.join(''), hookLog, requests: standIn.requests, home, cwd, extra }
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(result, null, 2))
  return result
}

const init = (r: Run): Block => (r.messages.find((m) => m.type === 'system' && m.subtype === 'init') ?? {}) as Block
const hookRows = (r: Run): unknown[] => r.hookLog.map((h) => ({ event: h.hook_event_name, tool: h.tool_name, file: (h.tool_input as Block | undefined)?.file_path, agent_type: h.agent_type, agent_id: h.agent_id, permission_mode: h.permission_mode }))
const exists = (path: string): boolean => existsSync(path)
const print = (title: string, value: unknown): void => console.log(`\n## ${title}\n${JSON.stringify(value, null, 2)}`)

// ---------- sanitizing ----------

const uuids = new Map<string, string>()
function sanitize(text: string): string {
  let out = text
  for (const [path, label] of [
    [REPO, '<repo>'],
    [scratch, '<tmp>'],
    [realpathSync(tmpdir()), '<tmp>'],
    [tmpdir(), '<tmp>'],
    [homedir(), '~'],
  ] as const)
    out = out.split(path).join(label)
  // Claude Code names a project folder by its path with every other character turned into '-'.
  for (const path of [scratch, realpathSync(tmpdir())]) out = out.split(path.replace(/[^a-zA-Z0-9]/g, '-')).join('<tmp>')
  out = out.split(userInfo().username).join('<user>').split(hostname()).join('<host>')
  return out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    if (!uuids.has(id)) uuids.set(id, `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, '0')}`)
    return uuids.get(id) as string
  })
}
const short = (list: unknown): unknown => (Array.isArray(list) && list.length > 5 ? [...list.slice(0, 5), `<${list.length - 5} more>`] : list)
function initForFixture(message: Block): Block {
  const out: Block = { ...message }
  for (const key of ['tools', 'slash_commands', 'skills', 'agents']) out[key] = short(out[key])
  if (typeof out.messaging_socket_path === 'string') out.messaging_socket_path = '<redacted>'
  out.plugins = (out.plugins as Block[] | undefined)?.filter((p) => p.path !== 'builtin' || p.name === undefined)
  return out
}

// ---------- scenarios ----------

/** A copy of the Harness with its manifest and hooks folder as `edit` leaves them. */
function harnessCopy(name: string, edit: (dir: string) => void): string {
  const dir = join(scratch, `harness-${name}`)
  cpSync(HARNESS, dir, { recursive: true })
  edit(dir)
  return dir
}

async function initErrors(): Promise<void> {
  const binary = JSON.parse(readFileSync(join(SDK_DIR, 'package.json'), 'utf8')) as { claudeCodeVersion: string }
  const variants: [string, string][] = [
    ['intact', harnessCopy('intact', () => undefined)],
    ['broken-hooks-json', harnessCopy('broken-hooks-json', (dir) => writeFileSync(join(dir, 'hooks', 'hooks.json'), '{ "hooks": { "PreToolUse": [ '))],
    ['missing-hook-script', harnessCopy('missing-hook-script', (dir) => unlinkSync(join(dir, 'hooks', 'guard.mjs')))],
    [
      'engines-unmet',
      harnessCopy('engines-unmet', (dir) => {
        const path = join(dir, '.claude-plugin', 'plugin.json')
        writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, 'utf8')) as Block), engines: { 'claude-code': '>=99.0.0' } }, null, 2))
      }),
    ],
    ['engines-met', harnessCopy('engines-met', (dir) => {
      const path = join(dir, '.claude-plugin', 'plugin.json')
      writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, 'utf8')) as Block), engines: { 'claude-code': `>=${binary.claudeCodeVersion}` } }, null, 2))
    })],
  ]
  const fixture: string[] = []
  for (const [variant, plugin] of variants) {
    // One Bash call: the missing guard.mjs is the command of the Harness's PreToolUse Bash|apply_patch hook.
    const r = await run(`init-${variant}`, [{ marker: 'INIT-PROBE', calls: [{ id: 'toolu_bash_1', name: 'Bash', input: { command: 'echo probe', description: 'probe' } }] }], 'INIT-PROBE', {
      plugins: [{ type: 'local', path: plugin }],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    })
    const i = init(r)
    const hooks = r.messages
      .filter((m) => m.type === 'system' && (m.subtype === 'hook_response' || m.subtype === 'hook_started'))
      .map((m) => {
        const h = m as unknown as Block
        return { subtype: h.subtype, event: h.hook_event, name: h.hook_name, outcome: h.outcome, exit_code: h.exit_code, stderr: typeof h.stderr === 'string' ? sanitize(h.stderr).slice(0, 300) : undefined }
      })
      .filter((h) => h.event === 'PreToolUse' || (h.subtype === 'hook_response' && h.outcome !== 'success'))
    print(`init-errors ${variant}`, {
      plugins: (i.plugins as Block[] | undefined)?.filter((p) => p.path !== 'builtin'),
      plugin_errors: i.plugin_errors,
      worfy_skills: (i.skills as string[] | undefined)?.filter((s) => s.startsWith('worfy:')).length,
      worfy_agents: (i.agents as string[] | undefined)?.filter((s) => s.startsWith('worfy:')).length,
      hooks_of_interest: hooks,
      bash_result: r.messages.filter((m) => m.type === 'user').map((m) => JSON.stringify((m as unknown as { message: unknown }).message).slice(0, 200)),
      stderr_tail: sanitize(r.stderr).slice(-600),
    })
    fixture.push(sanitize(JSON.stringify(initForFixture(i))))
  }
  if (fixturesDir !== undefined) {
    writeFileSync(join(fixturesDir, 'init-plugin-errors.jsonl'), `${fixture.join('\n')}\n`)
    console.log(`\nwrote ${join(fixturesDir, 'init-plugin-errors.jsonl')}`)
  }
}

async function listing(): Promise<void> {
  const broken = harnessCopy('listing-broken', (dir) => writeFileSync(join(dir, 'hooks', 'hooks.json'), '{ "hooks": { "PreToolUse": [ '))
  for (const [variant, plugin, settings] of [
    ['harness', HARNESS, undefined],
    ['disable-all-hooks', HARNESS, { disableAllHooks: true }],
    ['broken-hooks-json', broken, undefined],
  ] as const) {
    const r = await run(`listing-${variant}`, [], 'LISTING-PROBE', { plugins: [{ type: 'local', path: plugin }], ...(settings === undefined ? {} : { settings }) }, async (q, extra) => {
      extra.listing = await (q as unknown as { getHooksListing(): Promise<Block> }).getHooksListing()
    })
    const l = r.extra.listing as { events: Block[]; hooks: Block[]; policy: Block }
    print(`listing ${variant}`, {
      plugin_errors: init(r).plugin_errors,
      events: l.events.map((e) => `${String(e.name)}:${String(e.hookCount)}`),
      policy: l.policy,
      worfy: l.hooks
        .filter((h) => h.pluginName === 'worfy' || String(h.source).includes('plugin'))
        .filter((h) => h.event === 'PreToolUse' || h.event === 'Stop')
        .map((h) => ({ event: h.event, matcher: h.matcher, source: h.source, sourceLabel: h.sourceLabel, pluginName: h.pluginName, type: h.type, command: sanitize(String(h.commandText)).slice(0, 120), timeout: h.timeout, disabled: h.disabled })),
      row_keys: [...new Set(l.hooks.flatMap((h) => Object.keys(h)))],
    })
  }
}

const EDITS = 'Edit|Write|MultiEdit|NotebookEdit'
const PROBE_AGENT = { description: 'Spike agent that writes one file', prompt: 'You write files.', tools: ['Write', 'Read', 'Agent'] }

async function editHooks(): Promise<void> {
  const plugin = probePlugin(join(scratch, 'probe-plugin'), EDITS)
  const base = { plugins: [{ type: 'local' as const, path: plugin }], permissionMode: 'bypassPermissions' as const, allowDangerouslySkipPermissions: true }
  const cases: [string, Partial<Options>][] = [
    ['main', {}],
    ['subagent', {}],
    ['agent-main', { agent: 'probe-agent', agents: { 'probe-agent': PROBE_AGENT } }],
    ['agent-subagent', { agent: 'probe-agent', agents: { 'probe-agent': PROBE_AGENT } }],
  ]
  for (const [name, options] of cases) {
    // Write takes an absolute path: the scripted calls name files in a folder of their own.
    const dir = fresh(`edits-${name}`)
    const target = (file: string): string => join(dir, file)
    const sub = name.endsWith('subagent')
    const chains: Chain[] = sub
      ? [
          { marker: 'EDIT-MAIN', calls: [{ id: 'toolu_agent_1', name: 'Agent', input: { description: 'write sub.txt', prompt: 'EDIT-SUB write the file', subagent_type: 'general-purpose' } }] },
          { marker: 'EDIT-SUB', calls: [{ id: 'toolu_write_sub', name: 'Write', input: { file_path: target('sub.txt'), content: 'sub\n' } }] },
        ]
      : [
          {
            marker: 'EDIT-MAIN',
            calls: [
              { id: 'toolu_write_main', name: 'Write', input: { file_path: target('main.txt'), content: 'main\n' } },
              { id: 'toolu_edit_main', name: 'Edit', input: { file_path: target('main.txt'), old_string: 'main', new_string: 'edited' } },
              // Whether this Claude Code has MultiEdit or NotebookEdit at all: neither is in the tools a request offers.
              { id: 'toolu_find_edits', name: 'ToolSearch', input: { query: 'select:MultiEdit,NotebookEdit', max_results: 5 } },
            ],
          },
        ]
    const r = await run(`edit-${name}`, chains, 'EDIT-MAIN', { ...base, ...options })
    print(`edit-hooks ${name}`, {
      hooks: hookRows(r),
      written: { 'main.txt': exists(target('main.txt')), 'sub.txt': exists(target('sub.txt')) },
      subagent_messages: r.messages.filter((m) => (m as unknown as Block).parent_tool_use_id).length,
      tool_search: r.messages.filter((m) => m.type === 'user' && JSON.stringify(m).includes('toolu_find_edits')).map((m) => JSON.stringify((m as unknown as { message: unknown }).message).slice(0, 300)),
      edit_tools_offered: [...new Set(r.requests.flatMap((q) => q.tools as string[]))].filter((t) => /Edit|Write/.test(t)),
      init_agents: short(init(r).agents),
      stderr_tail: sanitize(r.stderr).slice(-400),
    })
  }
}

async function ask(): Promise<void> {
  const plugin = probePlugin(join(scratch, 'ask-plugin'), EDITS)
  for (const [name, answer] of [
    ['deny', 'deny'],
    ['allow', 'allow'],
  ] as const) {
    const dir = fresh(`ask-${name}`)
    const file = join(dir, 'asked.txt')
    const asked: Block[] = []
    const r = await run(
      `ask-${name}`,
      [{ marker: 'ASK-PROBE', calls: [{ id: 'toolu_write_ask', name: 'Write', input: { file_path: file, content: 'asked\n' } }] }],
      'ASK-PROBE',
      {
        plugins: [{ type: 'local', path: plugin }],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        canUseTool: async (toolName, input, opts) => {
          asked.push({ toolName, input, decisionReason: (opts as unknown as Block).decisionReason, title: (opts as unknown as Block).title })
          return answer === 'allow' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'spike: denied by the human' }
        },
      },
      undefined,
      { PROBE_DECISION: 'ask' },
    )
    print(`ask canUseTool answers ${name}`, {
      hooks: hookRows(r),
      canUseTool_calls: asked,
      written: exists(file),
      tool_result: r.messages.filter((m) => m.type === 'user').map((m) => sanitize(JSON.stringify((m as unknown as { message: unknown }).message)).slice(0, 300)),
    })
  }
}

/** The native binary of the pinned SDK, as the SDK itself resolves it. */
function binaryPath(): string {
  // pnpm puts the native package next to the SDK, in the SDK's own node_modules/@anthropic-ai.
  return join(SDK_DIR, '..', `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude')
}

async function cliRun(name: string, chains: Chain[], prompt: string, extraArgs: string[], env: Record<string, string> = {}): Promise<{ lines: Block[]; stderr: string; hookLog: Block[]; code: number | null }> {
  const standIn = await startStandIn(chains)
  const home = fresh(`home-${name}`)
  const cwd = fresh(`cwd-${name}`)
  const hookLogPath = join(scratch, `hooks-${name}.jsonl`)
  writeFileSync(hookLogPath, '')
  const child = spawn(binaryPath(), ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--setting-sources', '', ...extraArgs], {
    cwd,
    env: { ...claudeEnv({ url: standIn.url, toolResult: () => null, offered: () => false, toolsOffered: () => [], close: standIn.close }, home), PROBE_HOOK_LOG: hookLogPath, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (d: Buffer) => (out += String(d)))
  child.stderr.on('data', (d: Buffer) => (err += String(d)))
  const code = await new Promise<number | null>((done) => child.on('close', (c) => done(c)))
  await standIn.close()
  const lines = out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Block)
  const hookLog = readFileSync(hookLogPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Block)
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ lines, stderr: err, hookLog, code }, null, 2))
  return { lines, stderr: err, hookLog, code }
}

async function cli(): Promise<void> {
  const plugin = probePlugin(join(scratch, 'cli-plugin'), EDITS)
  const dir = fresh('cli-files')
  const chains: Chain[] = [
    { marker: 'CLI-MAIN', calls: [{ id: 'toolu_agent_cli', name: 'Agent', input: { description: 'write sub.txt', prompt: 'CLI-SUB write the file', subagent_type: 'general-purpose' } }] },
    { marker: 'CLI-SUB', calls: [{ id: 'toolu_write_cli', name: 'Write', input: { file_path: join(dir, 'sub.txt'), content: 'sub\n' } }] },
  ]
  const r = await cliRun('cli-subagent', chains, 'CLI-MAIN', ['--permission-mode', 'bypassPermissions', '--plugin-dir', plugin])
  print('cli subagent turn', {
    exit_code: r.code,
    kinds: r.lines.map((l) => `${String(l.type)}${l.subtype === undefined ? '' : `/${String(l.subtype)}`}${l.parent_tool_use_id ? ` (parent ${String(l.parent_tool_use_id)})` : ''}`),
    hooks: r.hookLog.map((h) => ({ event: h.hook_event_name, tool: h.tool_name, agent_type: h.agent_type, agent_id: h.agent_id })),
    written: exists(join(dir, 'sub.txt')),
    stderr_tail: sanitize(r.stderr).slice(-400),
  })
  const dirAsk = fresh('cli-ask')
  const a = await cliRun('cli-ask', [{ marker: 'CLI-ASK', calls: [{ id: 'toolu_write_cliask', name: 'Write', input: { file_path: join(dirAsk, 'asked.txt'), content: 'asked\n' } }] }], 'CLI-ASK', ['--permission-mode', 'bypassPermissions', '--plugin-dir', plugin], { PROBE_DECISION: 'ask' })
  print('cli ask in bypassPermissions (no human, no permission prompt tool)', {
    exit_code: a.code,
    hooks: a.hookLog.map((h) => ({ event: h.hook_event_name, tool: h.tool_name })),
    written: exists(join(dirAsk, 'asked.txt')),
    tool_results: a.lines.filter((l) => l.type === 'user').map((l) => sanitize(JSON.stringify(l.message)).slice(0, 300)),
    permission_denials: (a.lines.find((l) => l.type === 'result') ?? {}).permission_denials,
  })
}

/** Every file under `root`, relative, with its size. */
function listTree(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const path = join(e.parentPath, e.name)
      return `${relative(root, path)} (${statSync(path).size} B)`
    })
    .sort()
}

async function claudeHome(): Promise<void> {
  const base = { permissionMode: 'bypassPermissions' as const, allowDangerouslySkipPermissions: true }
  // The Task tools are deferred: ToolSearch loads them first. This Claude Code has no TodoWrite (ToolSearch finds none).
  const load = { id: 'toolu_load', name: 'ToolSearch', input: { query: 'select:TodoWrite,TaskCreate', max_results: 5 } }
  const task = { id: 'toolu_task', name: 'TaskCreate', input: { subject: 'probe', description: 'probe task' } }
  for (const [name, options, calls, env] of [
    ['tools', base, [load, task], {}],
    ['plan', { ...base, permissionMode: 'plan' as const }, [], {}],
    // Auto memory: forced on by its variable, with and without the user settings layer.
    ['memory', base, [], { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' }],
    ['memory-user-settings', { ...base, settingSources: ['user'] }, [], { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' }],
  ] as [string, Partial<Options>, Call[], Record<string, string>][]) {
    const r = await run(`home-${name}`, [{ marker: 'HOME-PROBE', calls }], 'HOME-PROBE', options, undefined, env)
    const config = join(r.home, '.claude')
    const said = r.requests.map((q) => `${String(q.system)}\n${String(q.first)}`).join('\n')
    const paths = [...new Set([...said.matchAll(new RegExp(`${config.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s\`'")\\]]*`, 'g'))].map((m) => sanitize(m[0].replace(r.home, '<home>'))))]
    print(`claude-home ${name}`, {
      tools_offered: [...new Set(r.requests.flatMap((q) => q.tools as string[]))],
      tool_results: r.messages.filter((m) => m.type === 'user').map((m) => sanitize(JSON.stringify((m as unknown as { message: unknown }).message)).slice(0, 200)),
      config_paths_told_to_model: paths,
      files_under_config: listTree(config).map((p) => sanitize(p)),
    })
  }
}

const RUNS: Record<string, () => Promise<void>> = { 'init-errors': initErrors, listing, 'edit-hooks': editHooks, ask, cli, 'claude-home': claudeHome }
for (const name of scenarios) {
  const scenario = RUNS[name]
  if (scenario === undefined) throw new Error(`unknown scenario ${name}; known: ${ALL.join(', ')}`)
  await scenario()
}
console.log(`\nraw runs: ${outDir}`)
