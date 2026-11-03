// The hooks of the fake Codex app-server (worfy-multi-vendor ticket 44): it runs the hooks/hooks.json of
// every plugin installed in CODEX_HOME the way the pinned Codex (0.166.0, @openai/codex in package.json)
// runs them, so the guarantees the Harness keeps with hooks on Codex are testable without Codex. The rules
// follow the source of that version, codex-rs/ at the tag rust-v0.166.0:
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/discovery.rs
//     where a plugin's hooks come from, PLUGIN_ROOT and the other variables, `${KEY}` in the command,
//     timeouts (600 s by default; SessionEnd 1 s, at most 3 s), trust of a hook before it is registered
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/plugin_fingerprint.rs
//     the SHA-256 of the plugin folder (pluginFingerprint below)
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/plugin_trust.rs
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/config_rules.rs
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/config/src/hook_config.rs
//     config.toml [hooks.state."<key>"]: enabled, trusted_hash, trusted_content_hash
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/lib.rs
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/declarations.rs
//     the key of a plugin hook: <plugin id>:hooks/hooks.json:<event_label>:<group>:<handler>
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/matcher.rs
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/hook_names.rs
//     matchers: empty or "*" is all, [A-Za-z0-9_|] is an exact list, anything else a regex; apply_patch
//     answers to Edit and Write as well
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/command_runner.rs
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/dispatcher.rs
//     a hook gets its input as JSON on stdin; the hooks of one event run in parallel, their results
//     in the configured order; on a timeout the process tree is killed
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/output_parser.rs
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/events/pre_tool_use.rs
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/events/stop.rs
//     PreToolUse: permissionDecision "deny" with a reason, decision "block", or exit 2 with stderr stops
//     the tool; Stop and SubagentStop: decision "block" with a reason, or exit 2, continue the turn with
//     the reason as a new prompt; continue:false ends it
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/schema.rs
//     the input of each event, field by field (hookInput below)
//   https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/protocol/src/hooks.rs
//     the event names of hooks.json; any other name (TaskCompleted, TeammateIdle) is skipped silently
//
// Trust, as Codex checks it while it runs: a plugin hook runs only when config.toml of CODEX_HOME holds a
// trusted_hash for its key; without one it is skipped silently. Each run compares trusted_content_hash with
// the fingerprint of the plugin folder: a folder changed since the approval fails the run with "plugin
// contents changed; hook approval required", and the action goes on. approvePluginHooks writes that
// approval for the tests, as a user's /hooks would.
//
// The fake plays six events: SessionStart, SubagentStart, PreToolUse, Stop, SubagentStop, SessionEnd.
// shortcut: the other events Codex knows (PostToolUse, UserPromptSubmit, PreCompact…) are read but never
// run, and hooks.json "hooks" paths or inline hooks of a manifest are not read (hooks/hooks.json only);
// play them when the Harness adds a hook on one of those events or moves its hooks file.
//
// A hook command runs through the shell of Node's spawn: /bin/sh -c off Windows, cmd.exe /d /s /c on
// Windows, as Codex runs it without a configured shell (%COMSPEC% /C). `${PLUGIN_ROOT}` and the other
// variables are replaced in the command text before it runs, so `node "${CLAUDE_PLUGIN_ROOT}/x.mjs"` needs
// no shell expansion on Windows. `commandWindows` takes the place of `command` there.
//
// It reads CODEX_HOME and writes nothing; only approvePluginHooks, which the tests call, writes config.toml.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { clearTimeout, setTimeout } from 'node:timers'

/** The events of hooks.json the pinned Codex knows, in the order of HookEventsToml (protocol/src/hooks.rs). */
export const KNOWN_EVENTS = ['PreModelRequest', 'PostModelRequest', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt']

/** The events the fake runs. */
export const PLAYED_EVENTS = ['SessionStart', 'SubagentStart', 'PreToolUse', 'Stop', 'SubagentStop', 'SessionEnd']

/** Events whose hooks run whatever their matcher says (events/common.rs). */
const NO_MATCHER = new Set(['Stop', 'UserPromptSubmit', 'PreModelRequest', 'PostModelRequest', 'Interrupt'])

const snake = (event) => event.replace(/[A-Z]/g, (letter, at) => `${at === 0 ? '' : '_'}${letter.toLowerCase()}`)
const kebab = (event) => snake(event).replaceAll('_', '-')
const camel = (event) => `${event[0].toLowerCase()}${event.slice(1)}`

/** The hooks.json of a plugin, from its root; Codex's DEFAULT_HOOKS_CONFIG_FILE. */
const HOOKS_FILE = 'hooks/hooks.json'

// --- Trust --------------------------------------------------------------------------------------------

/** Names the fingerprint leaves out (plugin_fingerprint.rs). */
const skipped = (name) => name === '__pycache__' || name === '.venv' || name.endsWith('.pyc') || name.endsWith('.egg-info')

const u64 = (value) => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes
}

/**
 * The SHA-256 of a plugin folder, as Codex approves it: the seed, then depth first from the root (children
 * by name) the path from the root with its length, "directory", or "file" with its size and contents.
 * Throws on a link, which Codex refuses as well.
 */
export function pluginFingerprint(root) {
  const hash = createHash('sha256')
  hash.update('codex-plugin-bundle-v1')
  const walk = (path) => {
    const rel = Buffer.from(relative(root, path))
    hash.update(u64(rel.length))
    hash.update(rel)
    const stat = lstatSync(path)
    if (stat.isDirectory()) {
      hash.update('directory')
      for (const name of readdirSync(path).sort()) if (!skipped(name)) walk(join(path, name))
    } else if (stat.isFile()) {
      const contents = readFileSync(path)
      hash.update('file')
      hash.update(u64(contents.length))
      hash.update(contents)
    } else throw new Error(`${path}: neither a file nor a folder, a plugin cannot have it`)
  }
  walk(root)
  return `sha256:${hash.digest('hex')}`
}

/**
 * The hash of one hook as a declaration.
 * shortcut: not Codex's exact form (the TOML normalisation of its version_for_toml was not checked); Codex
 * itself only asks at run time that a trusted_hash be there, and so does the fake. Compute it as Codex does
 * when a test must match the trusted_hash Codex reports in hooks/list.
 */
function declarationHash(handler) {
  const sorted = (value) => (Array.isArray(value) ? value.map(sorted) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value)
  const declaration = { event_name: snake(handler.event), matcher: handler.matcher ?? null, hooks: [handler.declared] }
  return `sha256:${createHash('sha256').update(JSON.stringify(sorted(declaration))).digest('hex')}`
}

const tomlString = (value) => JSON.stringify(value)

/**
 * The tables of config.toml the fake reads: [hooks.state."<key>"] and [plugins."<id>"], with their string
 * and boolean values.
 * shortcut: a line parser, no inline tables or dotted keys; replace it with a TOML parser when a test needs
 * a config.toml Codex itself wrote.
 */
export function readCodexConfig(codexHome) {
  const file = join(codexHome, 'config.toml')
  const hooks = new Map()
  const plugins = new Map()
  if (!existsSync(file)) return { hooks, plugins }
  let table = null
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const header = /^\[\s*(hooks\s*\.\s*state|plugins)\s*\.\s*("(?:[^"\\]|\\.)*")\s*\]$/.exec(line)
    if (header) {
      const into = header[1].startsWith('hooks') ? hooks : plugins
      const key = JSON.parse(header[2])
      if (!into.has(key)) into.set(key, {})
      table = into.get(key)
      continue
    }
    if (line.startsWith('[')) {
      table = null
      continue
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*("(?:[^"\\]|\\.)*"|true|false)\s*(#.*)?$/.exec(line)
    if (pair && table !== null) table[pair[1]] = JSON.parse(pair[2])
  }
  return { hooks, plugins }
}

/**
 * Approves every hook of every installed plugin as a user does in /hooks: appends to config.toml of
 * `codexHome` a [hooks.state."<key>"] table with trusted_hash and trusted_content_hash for each. For tests.
 */
export function approvePluginHooks(codexHome) {
  const { handlers } = loadHooks(codexHome, { all: true })
  const tables = handlers.map((handler) => `[hooks.state.${tomlString(handler.key)}]\ntrusted_hash = ${tomlString(declarationHash(handler))}\ntrusted_content_hash = ${tomlString(pluginFingerprint(handler.pluginRoot))}\n`)
  appendFileSync(join(codexHome, 'config.toml'), `\n${tables.join('\n')}`)
  return handlers.map((handler) => handler.key)
}

// --- Discovery ----------------------------------------------------------------------------------------

/** The plugins installed in `codexHome`: plugins/cache/<marketplace>/<plugin>/<version>/, id <plugin>@<marketplace>. */
export function installedPlugins(codexHome) {
  const cache = join(codexHome, 'plugins', 'cache')
  const folders = (path) => (existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : [])
  return folders(cache).flatMap((marketplace) =>
    folders(join(cache, marketplace)).flatMap((name) =>
      folders(join(cache, marketplace, name)).map((version) => ({
        id: `${name}@${marketplace}`,
        root: join(cache, marketplace, name, version),
        data: join(codexHome, 'plugins', 'data', `${name}-${marketplace}`),
      })),
    ),
  )
}

/** A matcher of a group: null when the matcher is not a regex Codex takes (the group is skipped). */
function matcherOf(matcher) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return () => true
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) {
    const names = new Set(matcher.split('|'))
    return (candidates) => candidates.some((name) => names.has(name))
  }
  try {
    const regex = new RegExp(matcher)
    return (candidates) => candidates.some((name) => regex.test(name))
  } catch {
    return null
  }
}

/**
 * Every hook handler of the installed plugins, in Codex's order (plugin by plugin, events in the order of
 * KNOWN_EVENTS, groups and handlers as written), with the warnings Codex would give. Without `all`, only
 * the ones Codex registers: enabled, trusted, of an event the fake plays.
 */
export function loadHooks(codexHome, { all = false } = {}) {
  const handlers = []
  const warnings = []
  const config = readCodexConfig(codexHome)
  let displayOrder = 0
  for (const plugin of installedPlugins(codexHome)) {
    if (config.plugins.get(plugin.id)?.enabled === false) continue
    const sourcePath = join(plugin.root, HOOKS_FILE)
    if (!existsSync(sourcePath)) continue
    let file
    try {
      file = JSON.parse(readFileSync(sourcePath, 'utf8'))
      const extra = Object.keys(file).filter((key) => key !== 'description' && key !== 'hooks')
      if (extra.length > 0) throw new Error(`unknown field ${extra.join(', ')}`)
    } catch (error) {
      warnings.push(`failed to parse plugin hooks config ${sourcePath}: ${error.message}`)
      continue
    }
    const fileHandlers = []
    let broken = null
    for (const event of KNOWN_EVENTS) {
      const groups = file.hooks?.[event]
      if (!Array.isArray(groups)) continue
      groups.forEach((group, groupIndex) => {
        const match = matcherOf(group.matcher)
        if (match === null) warnings.push(`invalid matcher ${JSON.stringify(group.matcher)} in ${sourcePath}`)
        ;(group.hooks ?? []).forEach((declared, handlerIndex) => {
          const order = displayOrder++
          if (declared.type === 'prompt' || declared.type === 'agent') {
            warnings.push(`${declared.type} hooks are not supported yet: ${sourcePath}`)
            return
          }
          if (declared.type !== 'command') {
            broken ??= `unknown hook type ${JSON.stringify(declared.type)}`
            return
          }
          if (match === null) return
          const key = `${plugin.id}:${HOOKS_FILE}:${snake(event)}:${groupIndex}:${handlerIndex}`
          fileHandlers.push({ key, event, matcher: group.matcher ?? null, match, declared, displayOrder: order, sourcePath, pluginId: plugin.id, pluginRoot: plugin.root, pluginData: plugin.data, state: config.hooks.get(key) ?? {} })
        })
      })
    }
    // An unknown handler type fails the whole file (the handler enum is tagged by `type`).
    if (broken !== null) {
      warnings.push(`failed to parse plugin hooks config ${sourcePath}: ${broken}`)
      continue
    }
    handlers.push(...fileHandlers)
  }
  if (all) return { handlers, warnings }
  return { handlers: handlers.filter((handler) => PLAYED_EVENTS.includes(handler.event) && handler.state.enabled !== false && typeof handler.state.trusted_hash === 'string' && handler.state.trusted_hash !== ''), warnings }
}

// --- Input ----------------------------------------------------------------------------------------------

/**
 * The JSON a hook of `event` gets on stdin, with the fields in the order of hooks/src/schema.rs. `fields`:
 * sessionId, turnId, agentId, agentType, transcriptPath, agentTranscriptPath, cwd, model, permissionMode,
 * toolName, toolInput, toolUseId, stopHookActive, lastAssistantMessage, source. agent_id and agent_type
 * stand in a PreToolUse input only inside a Subagent.
 */
export function hookInput(event, fields) {
  const head = { session_id: fields.sessionId }
  const where = { transcript_path: fields.transcriptPath ?? null, cwd: fields.cwd, hook_event_name: event }
  const model = { model: fields.model, permission_mode: fields.permissionMode ?? 'default' }
  const agent = { agent_id: fields.agentId, agent_type: fields.agentType }
  switch (event) {
    case 'PreToolUse':
      return { ...head, turn_id: fields.turnId, ...(fields.agentType === undefined ? {} : agent), ...where, ...model, tool_name: fields.toolName, tool_input: fields.toolInput, tool_use_id: fields.toolUseId }
    case 'SessionStart':
      return { ...head, ...where, ...model, source: fields.source }
    case 'SessionEnd':
      return { ...head, ...where, reason: 'other' }
    case 'SubagentStart':
      return { ...head, turn_id: fields.turnId, ...where, ...model, ...agent }
    case 'Stop':
      return { ...head, turn_id: fields.turnId, ...where, ...model, stop_hook_active: fields.stopHookActive, last_assistant_message: fields.lastAssistantMessage ?? null }
    case 'SubagentStop':
      return { ...head, turn_id: fields.turnId, transcript_path: fields.transcriptPath ?? null, agent_transcript_path: fields.agentTranscriptPath ?? null, cwd: fields.cwd, hook_event_name: event, ...model, stop_hook_active: fields.stopHookActive, ...agent, last_assistant_message: fields.lastAssistantMessage ?? null }
    default:
      throw new Error(`the fake does not play ${event}`)
  }
}

/** The names a matcher of `event` is matched against: the tool with its aliases, the source, the agent type. */
export function matchNames(event, value) {
  if (event === 'PreToolUse') return value === 'apply_patch' ? ['apply_patch', 'Edit', 'Write'] : value === 'spawn_agent' ? ['spawn_agent', 'Agent'] : [value]
  if (event === 'SessionEnd') return ['other']
  return [value]
}

// --- Running -------------------------------------------------------------------------------------------

/** The timeout of a handler of `event` in seconds: 600 by default, at least 1; SessionEnd 1 by default, 1 to 3. */
export function timeoutSec(event, declared) {
  if (event === 'SessionEnd' || event === 'Interrupt') return Math.min(3, Math.max(1, declared ?? 1))
  return Math.max(1, declared ?? 600)
}

/** Kills a hook process and everything it started. */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true })
  else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

/** Runs one handler with `input` on stdin: its exit code (null on a timeout), stdout and stderr. */
function execute(handler, input, cwd) {
  const vars = { PLUGIN_ROOT: handler.pluginRoot, CLAUDE_PLUGIN_ROOT: handler.pluginRoot, PLUGIN_DATA: handler.pluginData, CLAUDE_PLUGIN_DATA: handler.pluginData }
  const text = (process.platform === 'win32' && typeof handler.declared.commandWindows === 'string' ? handler.declared.commandWindows : handler.declared.command) ?? ''
  const command = text.replace(/\$\{(PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT|PLUGIN_DATA|CLAUDE_PLUGIN_DATA)\}/g, (_, name) => vars[name])
  const seconds = timeoutSec(handler.event, handler.declared.timeout)
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd, env: { ...process.env, ...vars }, detached: process.platform !== 'win32', windowsHide: true, stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.stdin.on('error', () => undefined)
    child.stdin.end(JSON.stringify(input))
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, seconds * 1000)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: error.message, timedOut: false, seconds })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: timedOut ? null : code, stdout, stderr, timedOut, seconds })
    })
  })
}

const PRE_TOOL_USE_FIELDS = new Set(['continue', 'stopReason', 'suppressOutput', 'systemMessage', 'decision', 'reason', 'hookSpecificOutput'])
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== ''

/** What one run of a handler of `event` decided: {status, entries, block?, stop?, context?}. */
export function outcomeOf(event, { code, stdout, stderr, timedOut, seconds }) {
  const failed = (text) => ({ status: 'failed', entries: [{ kind: 'error', text }] })
  if (timedOut) return failed(`hook timed out after ${seconds}s`)
  const out = stdout.trim()
  const err = stderr.trim()
  if (code === 2 && (event === 'PreToolUse' || event === 'Stop' || event === 'SubagentStop')) {
    return err === '' ? failed('hook exited with code 2 and wrote no reason to stderr') : { status: 'blocked', block: err, entries: [{ kind: 'feedback', text: err }] }
  }
  if (code !== 0) return failed(`hook exited with code ${code}${err === '' ? '' : `: ${err}`}`)
  if (out === '') return { status: 'completed', entries: [] }
  const json = out.startsWith('{') || out.startsWith('[')
  let parsed
  if (json) {
    try {
      parsed = JSON.parse(out)
    } catch {
      parsed = undefined
    }
  }
  const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  if (event === 'PreToolUse') {
    if (!json) return { status: 'completed', entries: [] }
    if (!isObject || Object.keys(parsed).some((key) => !PRE_TOOL_USE_FIELDS.has(key))) return failed('hook returned invalid pre-tool-use JSON output')
    if (parsed.continue === false || parsed.stopReason !== undefined || parsed.suppressOutput !== undefined) return failed('hook returned invalid pre-tool-use JSON output')
    const specific = parsed.hookSpecificOutput
    if (specific !== undefined && (specific === null || typeof specific !== 'object' || specific.hookEventName === undefined)) return failed('hook returned invalid pre-tool-use JSON output')
    const decision = specific?.permissionDecision
    if (decision === 'deny') return nonEmpty(specific.permissionDecisionReason) ? { status: 'blocked', block: specific.permissionDecisionReason, entries: [{ kind: 'feedback', text: specific.permissionDecisionReason }] } : failed('hook returned invalid pre-tool-use JSON output')
    if (decision === 'ask' || (decision === 'allow' && specific.updatedInput === undefined)) return failed('hook returned invalid pre-tool-use JSON output')
    if (parsed.decision === 'block') return nonEmpty(parsed.reason) ? { status: 'blocked', block: parsed.reason, entries: [{ kind: 'feedback', text: parsed.reason }] } : failed('hook returned invalid pre-tool-use JSON output')
    if (parsed.decision !== undefined) return failed('hook returned invalid pre-tool-use JSON output')
    // shortcut: an "allow" with updatedInput is accepted but the fake runs the scripted tool unchanged; apply the input when a test needs a rewritten tool call.
    return { status: 'completed', entries: nonEmpty(parsed.systemMessage) ? [{ kind: 'warning', text: parsed.systemMessage }] : [] }
  }
  if (event === 'Stop' || event === 'SubagentStop') {
    if (!isObject) return failed('hook returned invalid stop hook JSON output')
    if (parsed.continue === false) return { status: 'stopped', stop: parsed.stopReason ?? '', entries: nonEmpty(parsed.stopReason) ? [{ kind: 'stop', text: parsed.stopReason }] : [] }
    if (parsed.decision === 'block') return nonEmpty(parsed.reason) ? { status: 'blocked', block: parsed.reason, entries: [{ kind: 'feedback', text: parsed.reason }] } : failed('hook returned invalid stop hook JSON output')
    return { status: 'completed', entries: [] }
  }
  if (event === 'SessionStart' || event === 'SubagentStart') {
    // shortcut: plain stdout counts as context, as in Claude Code; not checked against Codex's parser of these two events.
    const context = isObject ? parsed.hookSpecificOutput?.additionalContext : out
    return { status: 'completed', context: nonEmpty(context) ? context : undefined, entries: nonEmpty(context) ? [{ kind: 'context', text: context }] : [] }
  }
  return { status: 'completed', entries: [] }
}

/** The run summary of the app-server protocol (v2 HookRunSummary) for one handler. */
function summary(handler, event, toolUseId, startedAt) {
  const id = `${kebab(event)}:${handler.displayOrder}:${handler.sourcePath}${event === 'PreToolUse' && toolUseId !== undefined ? `:${toolUseId}` : ''}`
  return {
    id,
    eventName: camel(event),
    handlerType: 'command',
    executionMode: handler.declared.async === true ? 'async' : 'sync',
    scope: event === 'SessionStart' || event === 'SubagentStart' ? 'thread' : 'turn',
    sourcePath: handler.sourcePath,
    source: 'plugin',
    displayOrder: handler.displayOrder,
    status: 'running',
    statusMessage: typeof handler.declared.statusMessage === 'string' ? handler.declared.statusMessage : null,
    startedAt: Math.floor(startedAt / 1000),
    completedAt: null,
    durationMs: null,
    entries: [],
  }
}

/**
 * Runs the registered hooks of `event` that match `matchValue`, in parallel, with `input` on stdin and
 * `cwd` as their folder. `onStarted(run)` and `onCompleted(run)` get the run summaries. The result:
 * `block` (the reason of the first blocking hook in the configured order for PreToolUse; every blocking
 * reason for Stop and SubagentStop, joined by an empty line), `fragments` (one per blocking hook, for the
 * hook prompt of a continued turn), `stop` (a continue:false of Stop), `contexts` and `runs`.
 */
export async function runHooks(handlers, event, { input, matchValue, cwd, onStarted = () => undefined, onCompleted = () => undefined }) {
  const names = matchNames(event, matchValue)
  const matched = handlers.filter((handler) => handler.event === event && (NO_MATCHER.has(event) || handler.match(names)))
  const fingerprints = new Map()
  const fingerprint = (root) => {
    if (!fingerprints.has(root)) {
      try {
        fingerprints.set(root, pluginFingerprint(root))
      } catch (error) {
        fingerprints.set(root, `unreadable: ${error.message}`)
      }
    }
    return fingerprints.get(root)
  }
  const runs = await Promise.all(
    matched.map(async (handler) => {
      const started = Date.now()
      const run = summary(handler, event, input.tool_use_id, started)
      onStarted(run)
      const outcome = handler.state.trusted_content_hash === fingerprint(handler.pluginRoot) ? outcomeOf(event, await execute(handler, input, cwd)) : { status: 'failed', entries: [{ kind: 'error', text: 'plugin contents changed; hook approval required' }] }
      // An async hook never decides (engine/mod.rs).
      const decided = handler.declared.async === true && event !== 'SessionEnd' ? { ...outcome, block: undefined, stop: undefined, status: outcome.status === 'failed' ? 'failed' : 'completed' } : outcome
      const done = { ...run, status: decided.status, completedAt: Math.floor(Date.now() / 1000), durationMs: Date.now() - started, entries: decided.entries }
      onCompleted(done)
      return { run: done, outcome: decided }
    }),
  )
  const blocking = runs.filter(({ outcome }) => outcome.block !== undefined)
  const stop = runs.find(({ outcome }) => outcome.stop !== undefined)?.outcome.stop
  let block
  if (blocking.length > 0) block = event === 'PreToolUse' ? blocking[0].outcome.block : blocking.map(({ outcome }) => outcome.block).join('\n\n')
  return {
    block: stop === undefined ? block : undefined,
    stop,
    fragments: stop === undefined ? blocking.map(({ run, outcome }) => ({ hookRunId: run.id, text: outcome.block })) : [],
    contexts: runs.map(({ outcome }) => outcome.context).filter((context) => context !== undefined),
    runs: runs.map(({ run }) => run),
  }
}
