// The fake Codex app-server (WORFY_CODEX=fake; worfy-multi-vendor ticket 18). worfy starts it in place
// of `codex app-server` (src/main/vendors/codex/launch.ts), under its own Node, so tests and e2e runs
// never start the real Codex and never sign in to an account. It speaks JSON-RPC over stdio as the
// app-server does: one JSON message per line, without the "jsonrpc" field.
//
// It plays the script test/fixtures/codex-scripts/<WORFY_CODEX_SCRIPT or "turn">.jsonl from the folder
// WORFY_CODEX_SCRIPTS (launch.ts names the fixtures folder). Each line of a script is one step:
//   {"expect":"<method>","result":{...}}  wait for worfy's request <method> and answer it with this result
//   {"expect":"<method>","error":{...}}   the same, answered with this JSON-RPC error ({code, message})
//   {"expect":"<method>"}                 wait for worfy's notification <method> (`initialized`)
//   {"notify":"<method>","params":{...}}  send this notification
//   {"request":"<method>","params":{...}} send this request to worfy (an approval) and wait for its answer
// Every message a script sends passes the JSON Schema of the pinned Codex
// (test/contract/codex-fake.test.ts checks each script), so a script never plays a field or a method the
// real app-server of that version does not have.
//
// A "notify" step may carry one more key, which makes the agent act before the notification goes out; the
// hooks of the plugins installed in CODEX_HOME run on it as the pinned Codex runs them (hook-runner.mjs,
// ticket 44), each with a hook/started and a hook/completed notification:
//   "tool":"<name>" on item/completed — the agent calls the tool <name> (Bash, apply_patch, mcp__s__t) with
//       "input" (tool_input of the hooks), as the Subagent "agentId" of "agentType" when they are given
//       (agentId: the threadId of the item by default). PreToolUse runs first: a deny stops the tool, and
//       no item is sent. Then the sandbox of the thread: under read-only a fileChange item, or a command
//       the step marks "writes":true, is refused (fileChange: status "declined"; command: "failed", exit
//       code 1) and nothing is written. Otherwise item/started goes out, the changes of a completed
//       fileChange are written under the thread's cwd (add: the diff is the content; update: the hunks;
//       delete), and then the item/completed of the step. A fileChange with a path or a move_path that
//       resolves outside the thread's cwd is declined whole, as under read-only, and nothing is written.
//       The fake never runs a command: whether one writes is what the step says.
//   "stop":"turn" or "stop":"subagent" on turn/completed — the agent, or the Subagent "agentId" of
//       "agentType", ends its turn with "lastAgentMessage". Stop (SubagentStop) runs: a block keeps the
//       turn open: a hookPrompt item with the reason goes out instead of the turn/completed, and the next
//       Stop of that thread has stop_hook_active true. Without a block the turn/completed goes out and the
//       next "continuation" steps (0 by default) — what the agent does after a block — are skipped.
//   "start":"subagent" on any notification — the Subagent "agentId" of "agentType" starts: SubagentStart.
// SessionStart runs after the first turn/start of a thread is answered ("startup", "resume" after a
// thread/resume), SessionEnd for each such thread when worfy closes stdin (no notifications then).
// The sandbox of a thread: the `sandbox` worfy asks in thread/start or thread/resume, else the `sandbox`
// of the scripted result ("the thread is open with sandbox S"), else workspace-write; a `sandboxPolicy`
// of turn/start changes it from then on. A Subagent has the sandbox of the thread worfy opened. The cwd of
// a thread — for its hooks and its file changes — is the `cwd` worfy asks, else the fake's own folder.
//
// What worfy sends while the fake waits for something else: a request gets a JSON-RPC error that names
// the step the fake waits for; a notification or an answer is only reported on stderr. After the last
// step every request gets an error. The fake exits when worfy closes its stdin.
// One exception (ticket 39): a `hooks/list` the script does not expect is answered at any point, also
// after the last step, from the plugins installed in CODEX_HOME (hook-runner.mjs, hooksList) — each hook
// "untrusted", "trusted" or "modified" by config.toml, so approvePluginHooks of a test approves them as
// /hooks would. worfy's check whether the Harness hooks are approved starts an app-server of its own on
// whatever script the test set, and asks only that after the handshake. WORFY_CODEX_HOOKS_SILENT=1: such a
// `hooks/list` gets no answer at all, as from a Codex that hangs (the check's timeout).
//
// WORFY_CODEX_LOG: every message worfy sends — requests, notifications, answers — is appended to that
// file, one JSON line each. WORFY_CODEX_HOME: the threads of the fake. The thread of a `thread/start`
// or `thread/resume` result is written to <WORFY_CODEX_HOME>/threads/<id>.json, and a `thread/resume`
// of a thread with no such file is refused, as the real app-server refuses a thread it has no rollout
// of: so a resume works only after another run of the fake started that thread. Without the variable
// nothing is written and every resume is answered from the script.
//
// It writes nothing else: no CODEX_HOME, no file next to the script; the hooks it runs and the file
// changes of a "tool" step in a thread that may write are the agent's own writes.
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { hookInput, hooksList, loadHooks, runHooks } from './hook-runner.mjs'

const STEP_KEYS = { expect: ['expect', 'result', 'error'], notify: ['notify', 'params'], request: ['request', 'params'] }
/** The keys that make a notify step an act of the agent, the notification each goes with, and its other keys. */
const ACT_KEYS = {
  tool: { notify: 'item/completed', keys: ['agentType', 'agentId', 'input', 'writes'] },
  stop: { notify: 'turn/completed', keys: ['agentType', 'agentId', 'lastAgentMessage', 'continuation'], values: ['turn', 'subagent'] },
  start: { notify: undefined, keys: ['agentType', 'agentId'], values: ['subagent'] },
}

/** The steps of the script `name` in `dir`; stops the process with exit code 2 on a malformed one. */
function loadScript(dir, name) {
  const file = join(dir, `${name}.jsonl`)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    fail(`cannot read the script ${file}: ${error.message}`)
  }
  const steps = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue
    const where = `${name}.jsonl:${index + 1}`
    let step
    try {
      step = JSON.parse(line)
    } catch (error) {
      fail(`${where}: not JSON: ${error.message}`)
    }
    const kind = Object.keys(STEP_KEYS).find((key) => typeof step?.[key] === 'string')
    if (kind === undefined) fail(`${where}: a step has one of "expect", "notify" or "request"`)
    const acts = kind === 'notify' ? Object.keys(ACT_KEYS).filter((key) => key in step) : []
    if (acts.length > 1) fail(`${where}: a step has one of ${acts.map((key) => `"${key}"`).join(', ')}, not several`)
    const act = acts[0]
    const allowed = [...STEP_KEYS[kind], ...(act === undefined ? [] : [act, ...ACT_KEYS[act].keys])]
    const unknown = Object.keys(step).filter((key) => !allowed.includes(key))
    if (unknown.length > 0) fail(`${where}: a "${act ?? kind}" step has no ${unknown.map((key) => `"${key}"`).join(', ')}`)
    if (act !== undefined) {
      const spec = ACT_KEYS[act]
      if (typeof step[act] !== 'string' || (spec.values !== undefined && !spec.values.includes(step[act]))) fail(`${where}: "${act}" is ${spec.values === undefined ? 'a tool name' : spec.values.map((value) => `"${value}"`).join(' or ')}`)
      if (spec.notify !== undefined && step.notify !== spec.notify) fail(`${where}: a "${act}" step goes with the notification ${spec.notify}`)
      if (act === 'tool' && typeof step.params?.item?.id !== 'string') fail(`${where}: a "tool" step has the item of the tool in params.item`)
      if ((act === 'start' || step[act] === 'subagent') && typeof step.agentType !== 'string') fail(`${where}: a Subagent step names its "agentType"`)
    }
    steps.push({ ...step, kind, act, where })
  }
  return steps
}

function fail(message) {
  process.stderr.write(`fake app-server: ${message}\n`)
  process.exit(2)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const isRequest = (message) => typeof message.method === 'string' && message.id !== undefined
const isNotification = (message) => typeof message.method === 'string' && message.id === undefined

const scriptName = process.env.WORFY_CODEX_SCRIPT || 'turn'
const scriptsDir = process.env.WORFY_CODEX_SCRIPTS
if (!scriptsDir) fail('WORFY_CODEX_SCRIPTS is not set: start the fake through src/main/vendors/codex/launch.ts')
const steps = loadScript(scriptsDir, scriptName)
const log = process.env.WORFY_CODEX_LOG || undefined
const threadsHome = process.env.WORFY_CODEX_HOME ? join(process.env.WORFY_CODEX_HOME, 'threads') : undefined

// worfy's messages, in order, and the wait for the next one.
const incoming = []
let wake = () => undefined
let closed = false
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  if (line.trim() === '') return
  if (log) appendFileSync(log, `${line.trim()}\n`)
  try {
    incoming.push(JSON.parse(line))
  } catch {
    process.stderr.write(`fake app-server: worfy sent a line that is not JSON: ${line}\n`)
  }
  wake()
})
input.on('close', () => {
  closed = true
  wake()
})

/** worfy's next message; null once its stdin is closed and every message was taken. */
async function nextMessage() {
  while (incoming.length === 0) {
    if (closed) return null
    await new Promise((resolve) => (wake = resolve))
  }
  return incoming.shift()
}

/** Answers or reports a message that is not the one `waitingFor` describes. */
function unexpected(message, waitingFor) {
  if (isRequest(message) && message.method === 'hooks/list') {
    if (process.env.WORFY_CODEX_HOOKS_SILENT === '1') return
    send({ id: message.id, result: hooksList(codexHome, message.params?.cwds) })
    return
  }
  const what = isRequest(message) || isNotification(message) ? message.method : `an answer to ${JSON.stringify(message.id)}`
  const text = `fake app-server: waits for ${waitingFor}, got ${what}`
  process.stderr.write(`${text}\n`)
  if (isRequest(message)) send({ id: message.id, error: { code: -32600, message: text } })
}

const threadFile = (id) => join(threadsHome, `${encodeURIComponent(String(id))}.json`)

/** The refusal of a `thread/resume` of a thread this home never saw, or null. */
function refusal(message) {
  if (threadsHome === undefined || message.method !== 'thread/resume') return null
  const id = message.params?.threadId
  return existsSync(threadFile(id)) ? null : { code: -32600, message: `no rollout found for thread id ${id}` }
}

/** Keeps the thread of a `thread/start` or `thread/resume` result in WORFY_CODEX_HOME. */
function keepThread(method, result) {
  if (threadsHome === undefined || (method !== 'thread/start' && method !== 'thread/resume')) return
  const thread = result?.thread
  if (typeof thread?.id !== 'string') return
  mkdirSync(threadsHome, { recursive: true })
  writeFileSync(threadFile(thread.id), JSON.stringify(thread))
}

// --- The agent: hooks, sandbox and file changes (ticket 44) --------------------------------------------

const codexHome = process.env.CODEX_HOME || undefined
const hooks = codexHome === undefined ? { handlers: [], warnings: [] } : loadHooks(codexHome)
for (const warning of hooks.warnings) process.stderr.write(`fake app-server: ${warning}\n`)

const SANDBOX_MODES = { readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' }
/** The threads worfy opened: cwd, sandbox, model, the source of their SessionStart and whether it ran. */
const threads = new Map()
/** The thread worfy opened last (the session of the hooks) and its turn. */
const current = { threadId: undefined, turnId: undefined }
/** Threads whose last Stop (SubagentStop) blocked: their next one has stop_hook_active. */
const stopHookActive = new Set()
const DEFAULT_THREAD = { cwd: process.cwd(), sandbox: 'workspace-write', model: 'gpt-fake' }

const threadOf = (id) => threads.get(id) ?? threads.get(current.threadId) ?? DEFAULT_THREAD
const transcript = (id) => (codexHome === undefined || id === undefined ? null : join(codexHome, 'sessions', `rollout-${id}.jsonl`))

/** Notes what a request worfy got a result to changes: a thread opened, a turn started. */
async function answered(message, result) {
  const params = message.params ?? {}
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    const id = result?.thread?.id
    if (typeof id !== 'string') return
    threads.set(id, {
      cwd: typeof params.cwd === 'string' ? params.cwd : process.cwd(),
      sandbox: params.sandbox ?? SANDBOX_MODES[result.sandbox?.type] ?? 'workspace-write',
      model: result.model ?? params.model ?? 'gpt-fake',
      source: message.method === 'thread/start' ? 'startup' : 'resume',
      started: false,
    })
    current.threadId = id
  }
  if (message.method === 'turn/start') {
    const thread = threads.get(params.threadId) ?? threads.get(current.threadId)
    if (typeof result?.turn?.id === 'string') current.turnId = result.turn.id
    if (thread === undefined) return
    const mode = SANDBOX_MODES[params.sandboxPolicy?.type]
    if (mode !== undefined) thread.sandbox = mode
    if (!thread.started) {
      thread.started = true
      const id = threads.get(params.threadId) === undefined ? current.threadId : params.threadId
      const input = hookInput('SessionStart', { sessionId: id, transcriptPath: transcript(id), cwd: thread.cwd, model: thread.model, source: thread.source })
      await hooksOf('SessionStart', input, thread.source, thread.cwd, id, current.turnId)
    }
  }
}

/** Runs the hooks of `event`, each with its hook/started and hook/completed on `threadId`. */
function hooksOf(event, input, matchValue, cwd, threadId, turnId) {
  const note = (method) => (run) => send({ method, params: { threadId, turnId: turnId ?? null, run } })
  return runHooks(hooks.handlers, event, { input, matchValue, cwd, onStarted: note('hook/started'), onCompleted: note('hook/completed') })
}

/** The fields every hook input of a step shares: the session, the turn, the agent. */
function fieldsOf(step) {
  const params = step.params ?? {}
  const thread = threadOf(params.threadId)
  const agentId = step.agentType === undefined ? undefined : (step.agentId ?? params.threadId)
  const turnId = params.turnId ?? params.turn?.id ?? current.turnId
  const sessionId = current.threadId ?? params.threadId
  return { thread, agentId, turnId, fields: { sessionId, turnId, agentId, agentType: step.agentType, cwd: thread.cwd, model: thread.model } }
}

/** Applies the hunks of a unified diff to `text`; null when a hunk does not fit. */
function patched(text, diff) {
  let result = text
  let from = 0
  for (const hunk of diff.split(/^@@[^\n]*\n?/m).slice(1)) {
    const before = []
    const after = []
    for (const line of hunk.split('\n')) {
      if (line.startsWith(' ')) {
        before.push(line.slice(1))
        after.push(line.slice(1))
      } else if (line.startsWith('-')) before.push(line.slice(1))
      else if (line.startsWith('+')) after.push(line.slice(1))
    }
    const at = result.indexOf(before.join('\n'), from)
    if (at === -1) return null
    result = `${result.slice(0, at)}${after.join('\n')}${result.slice(at + before.join('\n').length)}`
    from = at + after.join('\n').length
  }
  return result
}

/** The first path of `changes` (a move_path included) that is not inside `cwd`; undefined when all are. */
function outsideOf(changes, cwd) {
  const paths = (changes ?? []).flatMap((change) => [change.path, ...(typeof change.kind?.move_path === 'string' ? [change.kind.move_path] : [])])
  return paths.find((path) => {
    const rel = relative(resolve(cwd), resolve(cwd, path))
    return rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  })
}

/** Writes the changes of a fileChange item under `cwd`; every path is inside it (outsideOf). */
function applyChanges(changes, cwd) {
  for (const change of changes ?? []) {
    const path = resolve(cwd, change.path)
    if (change.kind?.type === 'add') {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, change.diff)
    } else if (change.kind?.type === 'delete') {
      if (existsSync(path)) unlinkSync(path)
    } else if (change.kind?.type === 'update') {
      const text = patched(existsSync(path) ? readFileSync(path, 'utf8') : '', change.diff)
      if (text === null) {
        process.stderr.write(`fake app-server: the diff of ${change.path} does not fit the file; it is left as it was\n`)
        continue
      }
      const target = typeof change.kind.move_path === 'string' ? resolve(cwd, change.kind.move_path) : path
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
      if (target !== path && existsSync(path)) unlinkSync(path)
    }
  }
}

/** The item of a tool that is running. */
function inProgress(item) {
  if (item.type === 'commandExecution') return { ...item, status: 'inProgress', aggregatedOutput: null, exitCode: null, durationMs: null }
  return { ...item, status: 'inProgress' }
}

/** The item of a write the read-only sandbox refused. */
function refused(item) {
  if (item.type === 'fileChange') return { ...item, status: 'declined' }
  return { ...item, status: 'failed', exitCode: 1, aggregatedOutput: 'Operation not permitted: the thread has a read-only sandbox\n' }
}

/** A "tool" step: PreToolUse, the sandbox, the item. */
async function playTool(step) {
  const { params } = step
  const { thread, fields } = fieldsOf(step)
  const input = hookInput('PreToolUse', { ...fields, transcriptPath: transcript(fields.agentId ?? fields.sessionId), toolName: step.tool, toolInput: step.input ?? {}, toolUseId: params.item.id })
  const decided = await hooksOf('PreToolUse', input, step.tool, thread.cwd, params.threadId ?? current.threadId, fields.turnId)
  if (decided.block !== undefined) return
  const started = { threadId: params.threadId, turnId: params.turnId, startedAtMs: params.item.startedAtMs ?? params.completedAtMs ?? Date.now() }
  send({ method: 'item/started', params: { ...started, item: inProgress(params.item) } })
  const writes = params.item.type === 'fileChange' || step.writes === true
  if (writes && thread.sandbox === 'read-only') {
    send({ method: 'item/completed', params: { ...params, item: refused(params.item) } })
    return
  }
  if (params.item.type === 'fileChange' && params.item.status === 'completed') {
    const outside = outsideOf(params.item.changes, thread.cwd)
    if (outside !== undefined) {
      process.stderr.write(`fake app-server: ${params.item.id} changes ${outside}, outside the thread's cwd; the change is declined\n`)
      send({ method: 'item/completed', params: { ...params, item: refused(params.item) } })
      return
    }
    applyChanges(params.item.changes, thread.cwd)
  }
  send({ method: step.notify, params })
}

let hookPrompts = 0

/** A "stop" step: Stop or SubagentStop; how many steps after it to skip. */
async function playStop(step) {
  const { params } = step
  const { thread, fields } = fieldsOf(step)
  const subagent = step.stop === 'subagent'
  const event = subagent ? 'SubagentStop' : 'Stop'
  const threadId = params.threadId
  const transcripts = subagent ? { transcriptPath: transcript(fields.sessionId), agentTranscriptPath: transcript(fields.agentId) } : { transcriptPath: transcript(threadId) }
  const input = hookInput(event, { ...fields, ...transcripts, stopHookActive: stopHookActive.has(threadId), lastAssistantMessage: step.lastAgentMessage })
  const decided = await hooksOf(event, input, step.agentType, thread.cwd, threadId, fields.turnId)
  if (decided.block !== undefined) {
    stopHookActive.add(threadId)
    const item = { type: 'hookPrompt', id: `hook_prompt_${++hookPrompts}`, fragments: decided.fragments }
    const now = Date.now()
    send({ method: 'item/started', params: { threadId, turnId: fields.turnId, startedAtMs: now, item } })
    send({ method: 'item/completed', params: { threadId, turnId: fields.turnId, completedAtMs: now, item } })
    return 0
  }
  stopHookActive.delete(threadId)
  send({ method: step.notify, params })
  return step.continuation ?? 0
}

/** A "start" step: SubagentStart, then the notification. */
async function playStart(step) {
  const { thread, fields } = fieldsOf(step)
  const input = hookInput('SubagentStart', { ...fields, transcriptPath: transcript(fields.agentId) })
  await hooksOf('SubagentStart', input, step.agentType, thread.cwd, fields.agentId, fields.turnId)
  send({ method: step.notify, params: step.params })
}

/** SessionEnd of every thread whose SessionStart ran; no notification, worfy has gone. */
async function endSessions() {
  await Promise.all(
    [...threads].filter(([, thread]) => thread.started).map(([id, thread]) => runHooks(hooks.handlers, 'SessionEnd', { input: hookInput('SessionEnd', { sessionId: id, transcriptPath: transcript(id), cwd: thread.cwd }), matchValue: 'other', cwd: thread.cwd })),
  )
}

async function play() {
  let serverRequestId = 0
  let skip = 0
  for (const step of steps) {
    if (skip > 0) {
      skip--
      continue
    }
    if (step.kind === 'notify') {
      if (step.act === 'tool') await playTool(step)
      else if (step.act === 'stop') skip = await playStop(step)
      else if (step.act === 'start') await playStart(step)
      else send({ method: step.notify, params: step.params })
      continue
    }
    if (step.kind === 'request') {
      const id = ++serverRequestId
      send({ id, method: step.request, params: step.params })
      for (;;) {
        const message = await nextMessage()
        if (message === null) return
        if (!isRequest(message) && !isNotification(message) && message.id === id) break
        unexpected(message, `the answer to ${step.request} (${step.where})`)
      }
      continue
    }
    const answers = step.result !== undefined || step.error !== undefined
    for (;;) {
      const message = await nextMessage()
      if (message === null) return
      if (message.method === step.expect && (answers ? isRequest(message) : isNotification(message))) {
        if (!answers) break
        const refused = refusal(message)
        if (refused !== null) {
          send({ id: message.id, error: refused })
          continue
        }
        if (step.error !== undefined) send({ id: message.id, error: step.error })
        else {
          keepThread(message.method, step.result)
          send({ id: message.id, result: step.result })
          await answered(message, step.result)
        }
        break
      }
      unexpected(message, `${step.expect} (${step.where})`)
    }
  }
  for (;;) {
    const message = await nextMessage()
    if (message === null) return
    unexpected(message, `nothing: the script ${scriptName} has ended`)
  }
}

await play()
await endSessions()
