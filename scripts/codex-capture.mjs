#!/usr/bin/env node
// Records the messages of the pinned Codex app-server for the compatibility suite
// (test/contract/codex-compat.test.ts; worfy-multi-vendor ticket 30). Run `node scripts/codex-capture.mjs --help`.
//
// For the owner only, with their own ChatGPT login: the run starts the real Codex and spends the plan's
// limits. It refuses without --use-my-login, and under CI or VITEST whatever the flags: tests and CI never
// start the real Codex.
//
// What a run does:
//   - makes a temporary folder with a CODEX_HOME, a Project folder (a git repository with one commit) and
//     a hook recorder; the user's ~/.codex is never read or written. CODEX_HOME gets a config.toml that
//     keeps the login in a file of that folder (not in the keychain), asks for reasoning summaries and
//     names one stdio MCP server of the run (`capture`, tools `echo` and `fail`), and a hooks.json whose
//     PreToolUse, Stop, SubagentStop… hooks write their input to the recorder's folder. Codex runs a
//     hook it does not trust only after its hash is approved: the run reads the hashes with `hooks/list`
//     and approves them in that config.toml (`hooks.state."<key>".trusted_hash`, as `/hooks` does).
//   - starts `codex app-server` three times: sign-in (a new ChatGPT login through a link the owner opens)
//     and the hooks; the scenario (turns, plan, MCP, file change, approvals, steer, interrupt, Subagent,
//     compaction, review, a failed turn, skills, thread list and read); a resume after the restart.
//   - records every message both ways, in the step form of the fake's scripts
//     (test/fixtures/codex-scripts/), one file per part of the scenario, and every hook input.
//   - replaces the email, the account and user ids, the tokens, the home folder, the temporary folders,
//     the host name, the installation id and the login id in what it writes, checks that none is left,
//     and replaces the recordings of the output
//     folder (default test/fixtures/codex-messages/; its README.md stays) with a manifest.json.
//   - logs out of the temporary login and removes the temporary folder.
//
// --app-server <file> starts <file> app-server instead of the pinned Codex: a way to run this script
// against the fake app-server (a wrapper that starts test/fixtures/codex-app-server/fake-app-server.mjs)
// without the real Codex.
//
// The step form, the kinds and the key paths are exported for the compatibility suite.
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { removeTree } from './remove-tree.mjs'

const HELP = `usage: node scripts/codex-capture.mjs --use-my-login [options]

Starts the pinned Codex app-server (@openai/codex of package.json) with a temporary
CODEX_HOME, signs in with a new ChatGPT login (open the link it prints), plays the
scenario of the compatibility suite and writes the messages to the output folder.
For the owner only: it uses the owner's ChatGPT plan. Refuses under CI and VITEST.

  --use-my-login        required: the run signs in to the owner's ChatGPT account
  --out <folder>        where to write (default test/fixtures/codex-messages)
  --app-server <file>   start <file> app-server instead of the pinned Codex
  --timeout <seconds>   how long to wait for a turn or a notification (default 300)
  --login-timeout <s>   how long to wait for the sign-in (default 600)`

const ROOT = join(import.meta.dirname, '..')
const PACKAGE = '@openai/codex'
const DEFAULT_OUT = join(ROOT, 'test', 'fixtures', 'codex-messages')

// --- The step form, kinds and key paths (also read by test/contract/codex-compat.test.ts) ----------

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The kind of a step of a script or a recording: `result <method>` (a request of worfy's side and its
 * answer), `error <method>` (the same, refused), `expect <method>` (a notification of worfy's side),
 * `notify <method>` and `request <method>` (a notification and a request of the app-server).
 */
export function kindOf(step) {
  if (typeof step.notify === 'string') return `notify ${step.notify}`
  if (typeof step.request === 'string') return `request ${step.request}`
  if (typeof step.expect === 'string') {
    if (step.error !== undefined) return `error ${step.expect}`
    if (step.result !== undefined) return `result ${step.expect}`
    return `expect ${step.expect}`
  }
  return 'unknown'
}

/** What of a step the app-server sent, or worfy for a notification of its own: its shape is compared. */
export function bodyOf(step) {
  if (typeof step.notify === 'string' || typeof step.request === 'string') return step.params
  if (step.error !== undefined) return step.error
  if (step.result !== undefined) return step.result
  return step.params
}

const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value)

/** `(fileChange)` for an object with a string `type`, else nothing. */
const tagOf = (value) => (isObject(value) && typeof value.type === 'string' ? `(${value.type})` : '')

/** Keys whose value is a tool's or a caller's, not a shape of Codex: recorded without their insides. */
const OPAQUE_KEYS = new Set(['arguments', 'structuredContent', '_meta'])

function walk(value, path, paths) {
  if (path !== '') (paths[path] ??= new Set()).add(typeOf(value))
  if (Array.isArray(value)) {
    for (const element of value) walk(element, `${path}[]${tagOf(element)}`, paths)
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    // A string type is in the tag of its object.
    if (key === 'type' && typeof child === 'string') continue
    const childPath = `${path === '' ? '' : `${path}.`}${key}${tagOf(child)}`
    if (OPAQUE_KEYS.has(key)) (paths[childPath] ??= new Set()).add(typeOf(child))
    else walk(child, childPath, paths)
  }
}

/**
 * The key paths of a value, each with its JSON types: `{ path: [type] }`. A path goes through objects
 * (`turn.error.message`) and arrays (`changes[]`); an object with a string `type` carries it in
 * brackets (`item(fileChange).changes`), so the items of each type keep their own keys.
 */
export function shapeOf(value) {
  const paths = {}
  if (value !== undefined) walk(value, '', paths)
  return Object.fromEntries(Object.entries(paths).map(([path, types]) => [path, [...types].sort()]))
}

/** The steps of a `.jsonl` script or recording, each with `<file>:<line>`; the run's own notes are left out. */
export function readSteps(file, name = file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (line.trim() === '') return []
      const step = JSON.parse(line)
      return isObject(step) && 'capture' in step ? [] : [{ where: `${name}:${index + 1}`, step }]
    })
}

// --- Replacing what names the owner --------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/**
 * A replacement `{ from, to, what }` replaces every occurrence of `from`; one with `name: true` (a host
 * name) only a whole name, not one inside a longer name: a host `mac` leaves `macos` as it is.
 */
const NAME_CHAR = 'A-Za-z0-9-'
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const matcherOf = ({ from, name }) => (name === true ? new RegExp(`(?<![${NAME_CHAR}])${literal(from)}(?![${NAME_CHAR}])`, 'g') : null)

/** Every occurrence of each `from` in the strings and keys of `value` becomes its `to`; every email too. */
export function scrub(value, replacements) {
  const ordered = [...replacements].filter(({ from }) => from.length > 0).sort((a, b) => b.from.length - a.from.length)
  const text = (string) => {
    let out = string
    for (const replacement of ordered) {
      const matcher = matcherOf(replacement)
      out = matcher === null ? out.split(replacement.from).join(replacement.to) : out.replace(matcher, () => replacement.to)
    }
    return out.replace(EMAIL, (email) => (email === 'owner@example.com' ? email : 'owner@example.com'))
  }
  const visit = (node) => {
    if (typeof node === 'string') return text(node)
    if (Array.isArray(node)) return node.map(visit)
    if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([key, child]) => [text(key), visit(child)]))
    return node
  }
  return visit(value)
}

/** The `from`s of `replacements` still found in `text`, as the names of what they are, each once. */
export function leftovers(text, replacements) {
  const found = replacements.filter((replacement) => {
    if (replacement.from.length === 0) return false
    const matcher = matcherOf(replacement)
    return matcher === null ? text.includes(replacement.from) : matcher.test(text)
  })
  return [...new Set(found.map(({ what }) => what))]
}

const HOST = 'capture-host'

/**
 * The host name `host` (os.hostname(): `Name.local` on a Mac) as replacements of whole names: the host
 * name and its first label with `.local` become `capture-host.local`, the first label alone
 * `capture-host`. The app-server names the host in `serverName` of remoteControl/status/changed.
 */
export function hostReplacements(host) {
  const whole = typeof host === 'string' ? host.trim() : ''
  if (whole === '') return []
  const [label] = whole.split('.')
  const names = new Map([
    [whole, `${HOST}.local`],
    [`${label}.local`, `${HOST}.local`],
    [label, HOST],
  ])
  return [...names].map(([from, to]) => ({ from, to, what: 'the host name', name: true }))
}

/**
 * Identifiers of the run that the messages carry under these keys, each replaced by a fixed id: the
 * installation id of the app-server and the id of the sign-in. The host name of `serverName` in
 * remoteControl/status/changed too: the form the app-server gives may differ from os.hostname().
 */
const IDENTIFIERS = {
  installationId: { to: '00000000-0000-4000-8000-000000000001', what: 'the installation id' },
  loginId: { to: '00000000-0000-4000-8000-000000000002', what: 'the login id' },
}

/** The replacements of the identifiers in the recorded steps `steps` (IDENTIFIERS, and the `serverName` of the host). */
export function identifierReplacements(steps) {
  const found = new Map()
  const visit = (node) => {
    if (Array.isArray(node)) for (const child of node) visit(child)
    else if (isObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (typeof child === 'string' && child.length > 0 && Object.hasOwn(IDENTIFIERS, key)) found.set(child, IDENTIFIERS[key])
        else visit(child)
      }
    }
  }
  visit(steps)
  const hosts = steps.flatMap((step) => (isObject(step) && step.notify === 'remoteControl/status/changed' && typeof step.params?.serverName === 'string' ? hostReplacements(step.params.serverName) : []))
  return [...[...found].map(([from, { to, what }]) => ({ from, to, what })), ...hosts]
}

// --- The run ---------------------------------------------------------------------------------------

function fail(code, message) {
  process.stderr.write(`codex-capture: ${message}\n`)
  return code
}

const say = (message) => process.stdout.write(`codex-capture: ${message}\n`)

function parseArgs(argv) {
  const options = { useMyLogin: false, out: DEFAULT_OUT, appServer: null, timeoutMs: 300_000, loginTimeoutMs: 600_000, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[(index += 1)]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }
    const seconds = () => {
      const number = Number(value())
      if (!Number.isFinite(number) || number <= 0) throw new Error(`${arg} takes a number of seconds`)
      return number * 1000
    }
    if (arg === '--use-my-login') options.useMyLogin = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--out') options.out = value()
    else if (arg === '--app-server') options.appServer = value()
    else if (arg === '--timeout') options.timeoutMs = seconds()
    else if (arg === '--login-timeout') options.loginTimeoutMs = seconds()
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

/** The exact version of `@openai/codex` in package.json. */
function pinnedVersion() {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies?.[PACKAGE]
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json: ${PACKAGE} must be in dependencies with an exact version`)
  return version
}

/** How to start the app-server: the launcher of the pinned package under this Node, or `--app-server`. */
function appServerCommand(options, version) {
  if (options.appServer !== null) return { file: options.appServer, args: ['app-server'] }
  const launcher = createRequire(join(ROOT, 'package.json')).resolve(`${PACKAGE}/bin/codex.js`)
  const installed = JSON.parse(readFileSync(join(dirname(launcher), '..', 'package.json'), 'utf8')).version
  if (installed !== version) throw new Error(`node_modules has ${PACKAGE} ${installed}, package.json pins ${version}; run pnpm install`)
  return { file: process.execPath, args: [launcher, 'app-server'] }
}

/** The steps recorded so far, by part of the scenario. */
class Recorder {
  parts = new Map()
  current = 'start'
  part(name) {
    this.current = name
    if (!this.parts.has(name)) this.parts.set(name, [])
  }
  add(step) {
    if (!this.parts.has(this.current)) this.parts.set(this.current, [])
    this.parts.get(this.current).push(step)
  }
  note(text) {
    say(text)
    this.add({ capture: text })
  }
}

/** One app-server process and the JSON-RPC over its stdio, every message recorded. */
class AppServer {
  constructor(command, env, cwd, recorder, answerServerRequest) {
    this.recorder = recorder
    this.answerServerRequest = answerServerRequest
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Set()
    this.notifications = []
    this.child = spawn(command.file, command.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.exited = new Promise((resolve) => this.child.once('exit', (code, signal) => resolve(code ?? signal)))
    this.child.once('error', (error) => recorder.note(`the app-server did not start: ${error.message}`))
    this.child.stderr.on('data', () => {})
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => this.receive(line))
    this.exited.then((code) => {
      for (const { resolve } of this.pending.values()) resolve({ exited: code })
      this.pending.clear()
    })
  }

  receive(line) {
    if (line.trim() === '') return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      this.recorder.note(`a line of the app-server is not JSON: ${line.slice(0, 200)}`)
      return
    }
    if (typeof message.method === 'string' && message.id !== undefined) {
      void this.serverRequest(message)
      return
    }
    if (typeof message.method === 'string') {
      const step = { notify: message.method, params: message.params }
      this.recorder.add(step)
      this.notifications.push(message)
      for (const listener of this.listeners) listener(message)
      return
    }
    const pending = this.pending.get(message.id)
    if (pending === undefined) return
    this.pending.delete(message.id)
    const step = { expect: pending.method, ...(pending.params === undefined ? {} : { params: pending.params }) }
    if (message.error !== undefined) step.error = message.error
    else step.result = message.result ?? null
    this.recorder.add(step)
    pending.resolve(message.error !== undefined ? { error: message.error } : { result: message.result })
  }

  async serverRequest(message) {
    let answer
    try {
      answer = { result: await this.answerServerRequest(message, this) }
    } catch (error) {
      answer = { error: { code: -32601, message: error.message } }
    }
    this.recorder.add({ request: message.method, params: message.params, ...(answer.error === undefined ? { answer: answer.result } : { answerError: answer.error }) })
    this.write({ id: message.id, ...answer })
  }

  write(message) {
    if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** The answer to a request: `{ result }`, `{ error }`, `{ timeout: true }` or `{ exited }`. */
  request(method, params, timeoutMs) {
    const id = (this.nextId += 1)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.recorder.note(`no answer to ${method} in ${timeoutMs / 1000} s`)
        resolve({ timeout: true })
      }, timeoutMs)
      this.pending.set(id, {
        method,
        params,
        resolve: (answer) => {
          clearTimeout(timer)
          resolve(answer)
        },
      })
      this.write({ id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  notify(method) {
    this.recorder.add({ expect: method })
    this.write({ method })
  }

  /** The first notification from index `from` on that `match` takes, or null after `timeoutMs`. */
  waitFor(match, timeoutMs, from = 0, what = 'a notification') {
    const seen = this.notifications.slice(from).find(match)
    if (seen !== undefined) return Promise.resolve(seen)
    return new Promise((resolve) => {
      const done = (message) => {
        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve(message)
      }
      const listener = (message) => {
        if (match(message)) done(message)
      }
      const timer = setTimeout(() => {
        this.recorder.note(`no ${what} in ${timeoutMs / 1000} s`)
        done(null)
      }, timeoutMs)
      this.listeners.add(listener)
      void this.exited.then(() => done(null))
    })
  }

  async close() {
    this.child.stdin.end()
    const timer = setTimeout(() => this.child.kill(), 10_000)
    await this.exited
    clearTimeout(timer)
  }
}

/** A stdio MCP server with two tools: `echo` answers its text, `fail` answers an error. */
const MCP_SERVER = `import { createInterface } from 'node:readline'
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
const tools = [
  { name: 'echo', description: 'Answers the text it is given.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'fail', description: 'Always fails.', inputSchema: { type: 'object', properties: {} } },
]
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'capture', version: '1.0.0' } } })
  else if (message.method === 'tools/list') send({ id: message.id, result: { tools } })
  else if (message.method === 'tools/call' && message.params.name === 'echo') send({ id: message.id, result: { content: [{ type: 'text', text: String(message.params.arguments?.text) }], structuredContent: { text: String(message.params.arguments?.text) } } })
  else if (message.method === 'tools/call') send({ id: message.id, result: { content: [{ type: 'text', text: 'The tool failed on purpose.' }], isError: true } })
  else if (message.method === 'ping') send({ id: message.id, result: {} })
  else send({ id: message.id, error: { code: -32601, message: 'unknown method ' + message.method } })
})
`

/** The hook command: writes its stdin, the hook input, to a new file of the folder it is given. */
const HOOK_RECORDER = `import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  writeFileSync(join(process.argv[2], Date.now() + '-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'), input)
})
`

/** The hook events whose input the run records: those Codex knows (ticket 04, codex-rs/hooks). */
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd']

const tomlString = (value) => JSON.stringify(value)

/** The temporary folder of a run: CODEX_HOME with its config and hooks, the Project, the hook recorder. */
function prepare(work) {
  const codexHome = join(work, 'codex-home')
  const project = join(work, 'project')
  const hookInputs = join(work, 'hook-inputs')
  for (const folder of [codexHome, project, hookInputs]) mkdirSync(folder, { recursive: true })
  const mcpServer = join(work, 'mcp-capture.mjs')
  const hookRecorder = join(work, 'hook-recorder.mjs')
  writeFileSync(mcpServer, MCP_SERVER)
  writeFileSync(hookRecorder, HOOK_RECORDER)
  writeFileSync(
    join(codexHome, 'config.toml'),
    [
      '# The temporary CODEX_HOME of scripts/codex-capture.mjs; removed with the run.',
      'cli_auth_credentials_store = "file"',
      'model_reasoning_summary = "detailed"',
      '',
      '[mcp_servers.capture]',
      `command = ${tomlString(process.execPath)}`,
      `args = [${tomlString(mcpServer)}]`,
      '',
    ].join('\n'),
  )
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(hookRecorder)} ${JSON.stringify(hookInputs)}`
  const hooks = Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: 'command', command, timeout: 30 }] }]]))
  writeFileSync(join(codexHome, 'hooks.json'), `${JSON.stringify({ hooks }, null, 2)}\n`)
  writeFileSync(join(project, 'README.md'), '# Capture project\n\nA temporary Project of scripts/codex-capture.mjs.\n')
  writeFileSync(join(project, 'notes.txt'), 'one\n')
  const skill = join(project, '.agents', 'skills', 'capture-greeting')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: capture-greeting\ndescription: Greets the user in one short line.\n---\n\nSay hello in one short line.\n')
  return { codexHome, project, hookInputs }
}

/** A git repository with one commit in `project`, for the review of uncommitted changes. */
async function gitInit(project, env) {
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=capture', '-c', 'user.email=capture@example.com', 'commit', '-q', '-m', 'start']]) {
    const code = await new Promise((resolve) => {
      const child = spawn('git', args, { cwd: project, env, stdio: 'ignore' })
      child.once('error', () => resolve(-1))
      child.once('exit', (exit) => resolve(exit))
    })
    if (code !== 0) return false
  }
  return true
}

/** What the temporary login names: the email, the account and user ids, the tokens. */
function loginSecrets(codexHome) {
  const found = []
  const file = join(codexHome, 'auth.json')
  if (!existsSync(file)) return found
  let auth
  try {
    auth = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return found
  }
  const tokens = isObject(auth.tokens) ? auth.tokens : {}
  if (typeof tokens.account_id === 'string') found.push({ from: tokens.account_id, to: 'capture-account-id', what: 'the account id' })
  for (const name of ['id_token', 'access_token', 'refresh_token']) {
    if (typeof tokens[name] === 'string') found.push({ from: tokens[name], to: 'capture-token', what: `the ${name}` })
  }
  if (typeof auth.OPENAI_API_KEY === 'string') found.push({ from: auth.OPENAI_API_KEY, to: 'capture-token', what: 'the API key' })
  const claims = (() => {
    try {
      return JSON.parse(Buffer.from(String(tokens.id_token).split('.')[1], 'base64url').toString('utf8'))
    } catch {
      return {}
    }
  })()
  const openai = isObject(claims['https://api.openai.com/auth']) ? claims['https://api.openai.com/auth'] : {}
  const profile = isObject(claims['https://api.openai.com/profile']) ? claims['https://api.openai.com/profile'] : {}
  for (const [value, to, what] of [
    [claims.email, 'owner@example.com', 'the email'],
    [profile.email, 'owner@example.com', 'the email'],
    [openai.chatgpt_account_id, 'capture-account-id', 'the account id'],
    [openai.chatgpt_user_id, 'capture-user-id', 'the user id'],
    [openai.user_id, 'capture-user-id', 'the user id'],
    [claims.sub, 'capture-user-id', 'the user id'],
  ]) {
    if (typeof value === 'string' && value.length > 0) found.push({ from: value, to, what })
  }
  return found
}

/** The path and its real path (on macOS /var is /private/var), both replaced by `to`. */
const pathReplacements = (path, to, what) => {
  const real = existsSync(path) ? realpathSync(path) : path
  return [...new Set([path, real])].map((from) => ({ from, to, what }))
}

/**
 * Everything a run replaces in what it writes: its folders (the Project, CODEX_HOME, the temporary
 * folder), the home folder, the host name, the identifiers the recorded `steps` carry and the `secrets`
 * of the login.
 */
export function replacementsOf({ project, codexHome, work, home, host, steps, secrets }) {
  return [
    ...pathReplacements(project, '/capture/project', 'the Project folder'),
    ...pathReplacements(codexHome, '/capture/codex-home', 'the CODEX_HOME folder'),
    ...pathReplacements(work, '/capture', 'the temporary folder'),
    ...pathReplacements(home, '/home/owner', 'the home folder'),
    ...hostReplacements(host),
    ...identifierReplacements(steps),
    ...secrets,
  ]
}

/** Plays the scenario; every message lands in `recorder`. Returns what the login named. */
async function scenario({ command, env, folders, recorder, options, secrets }) {
  const { codexHome, project } = folders
  const timeout = options.timeoutMs
  const ask = { timeout }
  /** Server requests: approvals take the next decision of `decisions` ('accept' when none is left). */
  let decisions = []
  let onApproval = null
  const answer = async (message, server) => {
    if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
      if (onApproval !== null) await onApproval(message, server)
      return { decision: decisions.shift() ?? 'accept' }
    }
    if (message.method === 'mcpServer/elicitation/request') return { action: 'accept', content: {}, _meta: null }
    throw new Error(`the capture does not answer ${message.method}`)
  }
  const start = async (name) => {
    recorder.part(name)
    const server = new AppServer(command, env, project, recorder, answer)
    const init = await server.request('initialize', { clientInfo: { name: 'worfy', title: 'worfy', version: 'capture' }, capabilities: null }, ask.timeout)
    if (init.result === undefined) throw new Error(`initialize failed: ${JSON.stringify(init)}`)
    server.notify('initialized')
    return server
  }
  /** Starts a turn and waits for its end; `during(turnId, server)` runs once it started. */
  const turn = async (server, threadId, text, extra = {}, during = null) => {
    const from = server.notifications.length
    const started = await server.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }], ...extra }, ask.timeout)
    const turnId = started.result?.turn?.id
    if (turnId === undefined) return null
    if (during !== null) await during(turnId, server, from)
    await server.waitFor((message) => message.method === 'turn/completed' && message.params?.turn?.id === turnId, timeout, from, `turn/completed of ${turnId}`)
    return turnId
  }
  const thread = async (server, params) => (await server.request('thread/start', { cwd: project, ...params }, ask.timeout)).result?.thread?.id

  // 1. Signed out, the sign-in, the account; then the hooks are approved.
  let server = await start('login')
  await server.request('account/read', { refreshToken: false }, ask.timeout)
  await server.request('account/rateLimits/read', undefined, ask.timeout)
  const login = await server.request('account/login/start', { type: 'chatgpt' }, ask.timeout)
  if (typeof login.result?.authUrl === 'string') {
    say(`sign in to your ChatGPT account (Plus) in the browser: ${login.result.authUrl}`)
    await server.waitFor((message) => message.method === 'account/login/completed', options.loginTimeoutMs, 0, 'account/login/completed')
  }
  secrets.push(...loginSecrets(codexHome))
  recorder.part('account')
  const account = await server.request('account/read', { refreshToken: false }, ask.timeout)
  const email = account.result?.account?.email
  if (typeof email === 'string') secrets.push({ from: email, to: 'owner@example.com', what: 'the email' })
  await server.request('account/rateLimits/read', undefined, ask.timeout)
  await server.request('model/list', {}, ask.timeout)

  recorder.part('hooks')
  const listed = await server.request('hooks/list', { cwds: [project] }, ask.timeout)
  const ours = (listed.result?.data ?? []).flatMap((entry) => entry.hooks ?? []).filter((hook) => String(hook.sourcePath ?? '').startsWith(codexHome) || String(hook.sourcePath ?? '').startsWith(realpathSync(codexHome)))
  if (ours.length === 0) recorder.note('hooks/list named none of the run\'s hooks: hook inputs will not be recorded')
  else {
    const lines = ours.map((hook) => `[hooks.state.${tomlString(hook.key)}]\ntrusted_hash = ${tomlString(hook.currentHash)}\n`)
    writeFileSync(join(codexHome, 'config.toml'), `${readFileSync(join(codexHome, 'config.toml'), 'utf8')}\n${lines.join('\n')}`)
    say(`approved ${ours.length} hooks of the run in its CODEX_HOME`)
  }
  await server.close()

  // 2. The scenario, on a new process: it reads the approved hooks and the login from CODEX_HOME.
  server = await start('hooks-approved')
  await server.request('hooks/list', { cwds: [project] }, ask.timeout)

  recorder.part('skills')
  await server.request('skills/list', { cwds: [project] }, ask.timeout)
  const skillsFrom = server.notifications.length
  const second = join(project, '.agents', 'skills', 'capture-farewell')
  mkdirSync(second, { recursive: true })
  writeFileSync(join(second, 'SKILL.md'), '---\nname: capture-farewell\ndescription: Says goodbye in one short line.\n---\n\nSay goodbye in one short line.\n')
  await server.waitFor((message) => message.method === 'skills/changed', Math.min(timeout, 15_000), skillsFrom, 'skills/changed')
  await server.request('skills/list', { cwds: [project], forceReload: true }, ask.timeout)

  recorder.part('turn')
  const main = await thread(server, { approvalPolicy: 'on-request', sandbox: 'workspace-write' })
  if (main !== undefined) {
    await turn(server, main, 'Use the update_plan tool to make a plan of two steps. Then run `cat README.md` and answer with its first line.')
    await turn(server, main, 'Use the skill $capture-greeting.', {}, null)
    recorder.part('mcp')
    await turn(server, main, 'Call the tool `echo` of the MCP server `capture` with the text "hello". Then call its tool `fail`. Answer in one line.')
    recorder.part('file-change')
    await turn(server, main, 'Create the file card.md with the single line "card" using apply_patch. Answer in one line.')
  }

  recorder.part('approval')
  const guarded = await thread(server, { approvalPolicy: 'untrusted', sandbox: 'read-only' })
  if (guarded !== undefined) {
    decisions = ['accept', 'accept', 'accept']
    await turn(server, guarded, 'Add the line "two" to notes.txt using apply_patch. Then run `node -e "require(\'fs\').writeFileSync(\'out.txt\', \'1\')"`. Answer in one line.')
    recorder.part('approval-declined')
    decisions = ['decline', 'decline', 'decline']
    await turn(server, guarded, 'Run `node -e "require(\'fs\').writeFileSync(\'declined.txt\', \'1\')"`. Answer in one line.')
    recorder.part('approval-interrupt')
    decisions = []
    let interrupted = false
    onApproval = async (message, live) => {
      if (interrupted) return
      interrupted = true
      decisions.unshift('cancel')
      setTimeout(() => void live.request('turn/interrupt', { threadId: guarded, turnId: message.params?.turnId }, ask.timeout), 0)
    }
    await turn(server, guarded, 'Run `node -e "require(\'fs\').writeFileSync(\'cancelled.txt\', \'1\')"`. Answer in one line.')
    onApproval = null
    decisions = []
  }

  recorder.part('steer')
  const live = await thread(server, { approvalPolicy: 'on-request', sandbox: 'workspace-write' })
  if (live !== undefined) {
    await turn(server, live, 'Run `sleep 20`, then answer "done".', {}, async (turnId, running, from) => {
      if ((await running.waitFor((message) => message.method === 'item/started', timeout, from, 'item/started of the turn to steer')) === null) return
      await running.request('turn/steer', { threadId: live, input: [{ type: 'text', text: 'Also say the word "steered".', text_elements: [] }], expectedTurnId: turnId }, ask.timeout)
    })
    recorder.part('interrupt')
    await turn(server, live, 'Run `sleep 30`, then answer "done".', {}, async (turnId, running, from) => {
      if ((await running.waitFor((message) => message.method === 'item/started', timeout, from, 'item/started of the turn to interrupt')) === null) return
      await running.request('turn/interrupt', { threadId: live, turnId }, ask.timeout)
    })
  }

  recorder.part('subagent')
  const parent = await thread(server, { approvalPolicy: 'on-request', sandbox: 'read-only' })
  if (parent !== undefined) {
    decisions = []
    await turn(server, parent, 'Spawn one subagent. The subagent creates the file sub.txt with the single line "sub" using apply_patch and then runs `ls`. Wait for it, then answer in one line.')
  }

  recorder.part('compact')
  if (main !== undefined) {
    const from = server.notifications.length
    const compacted = await server.request('thread/compact/start', { threadId: main }, ask.timeout)
    if (compacted.result !== undefined) await server.waitFor((message) => message.method === 'turn/completed' && message.params?.threadId === main, timeout, from, 'turn/completed of the compaction')
  }
  const empty = await thread(server, { approvalPolicy: 'on-request', sandbox: 'workspace-write' })
  if (empty !== undefined) await server.request('thread/compact/start', { threadId: empty }, ask.timeout)

  recorder.part('review')
  if (main !== undefined) {
    const from = server.notifications.length
    const review = await server.request('review/start', { threadId: main, target: { type: 'uncommittedChanges' }, delivery: 'inline' }, ask.timeout)
    const turnId = review.result?.turn?.id
    if (turnId !== undefined) await server.waitFor((message) => message.method === 'turn/completed' && message.params?.turn?.id === turnId, timeout, from, 'turn/completed of the review')
  }

  recorder.part('turn-failed')
  const failing = await thread(server, { approvalPolicy: 'on-request', sandbox: 'workspace-write' })
  if (failing !== undefined) await turn(server, failing, 'Answer "ok".', { model: 'worfy-capture-no-such-model' })

  recorder.part('threads')
  const page = await server.request('thread/list', { limit: 1, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: ['cli', 'vscode', 'exec', 'appServer'], archived: false }, ask.timeout)
  const cursor = page.result?.nextCursor
  if (typeof cursor === 'string') await server.request('thread/list', { limit: 1, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: ['cli', 'vscode', 'exec', 'appServer'], archived: false, cursor }, ask.timeout)
  if (main !== undefined) await server.request('thread/read', { threadId: main, includeTurns: true }, ask.timeout)
  await server.close()

  // 3. A resume after the restart, as worfy resumes a Session; then a thread Codex has no rollout of.
  server = await start('resume')
  if (main !== undefined) {
    const resumed = await server.request('thread/resume', { threadId: main, cwd: project, approvalPolicy: 'on-request', sandbox: 'workspace-write' }, ask.timeout)
    if (resumed.result !== undefined) await turn(server, main, 'Answer "resumed".')
  }
  await server.request('thread/resume', { threadId: '00000000-0000-0000-0000-000000000000', cwd: project }, ask.timeout)
  recorder.part('logout')
  await server.request('account/logout', undefined, ask.timeout)
  await server.close()
}

/** The hook inputs the recorder wrote, by event. */
function hookInputs(folder) {
  const byEvent = new Map()
  for (const name of readdirSync(folder).sort()) {
    let input
    try {
      input = JSON.parse(readFileSync(join(folder, name), 'utf8'))
    } catch {
      continue
    }
    const event = typeof input?.hook_event_name === 'string' ? input.hook_event_name : 'unknown'
    if (!byEvent.has(event)) byEvent.set(event, [])
    byEvent.get(event).push(input)
  }
  return byEvent
}

const jsonl = (values) => values.map((value) => `${JSON.stringify(value)}\n`).join('')

/** Replaces the recordings of `out` (its README.md and other files stay) with `files`. */
function writeRecordings(out, files) {
  mkdirSync(out, { recursive: true })
  for (const name of readdirSync(out)) if (name.endsWith('.jsonl') || name === 'manifest.json') unlinkSync(join(out, name))
  removeTree(join(out, 'hooks'))
  for (const [name, text] of files) {
    mkdirSync(dirname(join(out, name)), { recursive: true })
    writeFileSync(join(out, name), text)
  }
}

/** The kinds the fake's scripts play that the recordings lack: what the compatibility suite will name. */
function missingKinds(recorded) {
  const scripts = join(ROOT, 'test', 'fixtures', 'codex-scripts')
  if (!existsSync(scripts)) return []
  const kinds = new Set(recorded.map(kindOf))
  const played = readdirSync(scripts)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readSteps(join(scripts, name), name).map(({ step }) => kindOf(step)))
  return [...new Set(played)].filter((kind) => !kinds.has(kind)).sort()
}

async function run(options) {
  const version = pinnedVersion()
  const command = appServerCommand(options, version)
  const work = mkdtempSync(join(tmpdir(), 'worfy-codex-capture-'))
  const recorder = new Recorder()
  const secrets = []
  try {
    const folders = prepare(work)
    const env = { ...process.env, CODEX_HOME: folders.codexHome }
    // The run signs in with ChatGPT: a key in the environment would sign it in with the key instead.
    for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[name]
    if (!(await gitInit(folders.project, env))) recorder.note('git init of the Project failed: the review has no uncommitted changes to look at')
    await scenario({ command, env, folders, recorder, options, secrets })
    const replacements = replacementsOf({ ...folders, work, home: homedir(), host: hostname(), steps: [...recorder.parts.values()].flat(), secrets })
    const files = []
    const plan = (() => {
      for (const steps of recorder.parts.values()) {
        for (const step of steps) if (step.expect === 'account/read' && typeof step.result?.account?.planType === 'string') return step.result.account.planType
      }
      return null
    })()
    for (const [part, steps] of recorder.parts) if (steps.length > 0) files.push([`${part}.jsonl`, jsonl(scrub(steps, replacements))])
    const hooks = hookInputs(folders.hookInputs)
    for (const [event, inputs] of hooks) files.push([join('hooks', `${event}.jsonl`), jsonl(scrub(inputs, replacements))])
    const manifest = {
      codex: version,
      capturedAt: new Date().toISOString().slice(0, 10),
      plan,
      platform: `${process.platform}-${process.arch}`,
      appServer: options.appServer === null ? 'pinned' : 'other (--app-server)',
      parts: [...recorder.parts.keys()].filter((part) => recorder.parts.get(part).length > 0),
    }
    files.push(['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`])
    const left = [...new Set(files.flatMap(([name, text]) => leftovers(text, replacements).map((what) => `${name}: ${what}`)))]
    if (left.length > 0) return fail(1, `nothing written: the recordings still name ${left.join(', ')}`)
    writeRecordings(options.out, files)
    say(`wrote ${files.length} files to ${options.out} (Codex ${version}, plan ${plan ?? 'unknown'})`)
    for (const event of ['PreToolUse', 'Stop', 'SubagentStop']) {
      const inputs = hooks.get(event) ?? []
      say(`hook ${event}: ${inputs.length} inputs, ${inputs.filter((input) => typeof input.agent_type === 'string').length} with agent_type`)
    }
    const missing = missingKinds([...recorder.parts.values()].flat().filter((step) => !('capture' in step)))
    if (missing.length > 0) say(`the fake's scripts play kinds these recordings lack (each needs a reason in the suite's exceptions): ${missing.join(', ')}`)
    return 0
  } finally {
    removeTree(work)
  }
}

/** The run with the arguments `argv`: its exit code. Under CI or VITEST it refuses before it reads them, `--help` too. */
export async function main(argv) {
  for (const name of ['CI', 'VITEST']) {
    if (process.env[name]) return fail(2, `refused: ${name} is set, and tests and CI never start the real Codex`)
  }
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    return fail(2, `${error.message}\n${HELP}`)
  }
  if (options.help) {
    process.stdout.write(`${HELP}\n`)
    return 0
  }
  if (!options.useMyLogin) return fail(2, `refused: the run signs in to your ChatGPT account and spends its limits; for the owner only, with --use-my-login\n${HELP}`)
  try {
    return await run(options)
  } catch (error) {
    return fail(1, error.message)
  }
}

const runAsScript = () => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) process.exitCode = await main(process.argv.slice(2))
