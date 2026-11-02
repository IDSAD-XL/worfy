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
// What worfy sends while the fake waits for something else: a request gets a JSON-RPC error that names
// the step the fake waits for; a notification or an answer is only reported on stderr. After the last
// step every request gets an error. The fake exits when worfy closes its stdin.
//
// WORFY_CODEX_LOG: every message worfy sends — requests, notifications, answers — is appended to that
// file, one JSON line each. WORFY_CODEX_HOME: the threads of the fake. The thread of a `thread/start`
// or `thread/resume` result is written to <WORFY_CODEX_HOME>/threads/<id>.json, and a `thread/resume`
// of a thread with no such file is refused, as the real app-server refuses a thread it has no rollout
// of: so a resume works only after another run of the fake started that thread. Without the variable
// nothing is written and every resume is answered from the script.
//
// It writes nothing else: no CODEX_HOME, no file next to the script.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'

const STEP_KEYS = { expect: ['expect', 'result', 'error'], notify: ['notify', 'params'], request: ['request', 'params'] }

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
    const unknown = Object.keys(step).filter((key) => !STEP_KEYS[kind].includes(key))
    if (unknown.length > 0) fail(`${where}: a "${kind}" step has no ${unknown.map((key) => `"${key}"`).join(', ')}`)
    steps.push({ ...step, kind, where })
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

async function play() {
  let serverRequestId = 0
  for (const step of steps) {
    if (step.kind === 'notify') {
      send({ method: step.notify, params: step.params })
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
