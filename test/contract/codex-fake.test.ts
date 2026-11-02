// The fake Codex app-server and the Codex isolation of the tests (worfy-multi-vendor ticket 18).
//
// - Every script of the fake (test/fixtures/codex-scripts/*.jsonl) plays only messages the JSON Schema
//   of the pinned Codex has (src/main/vendors/codex/protocol/json/, generated in ticket 17): each
//   notification and request it sends, each result it answers with. The generated schemas leave
//   objects open — a field they do not name passes them — so the check closes every object of a copy of
//   the bundle first (closedBundle): a field the pinned version does not have fails it, as does a method
//   it does not have. The control script with an extra field lives in this file, not among the fixtures.
// - The fake plays a script over stdio and logs worfy's messages (WORFY_CODEX_LOG); it writes only into
//   the log and WORFY_CODEX_HOME.
// - launch.ts under the tests starts the fake under process.execPath and never the binary of
//   @openai/codex; the spawn here is a stand-in that only records what it is given.
// - test/setup-contract.ts gives every test file WORFY_CODEX=fake and a CODEX_HOME of its own in the
//   run's temporary folder; test/e2e/launch-env.ts gives every app launch the same.
//
// The fake runs here under scriptNode() (test/script-node.ts), with the arguments and environment
// launch.ts gives: under `pnpm test` process.execPath is Electron, which starts far slower under load,
// and the program launch.ts picks is checked on its own, through the spawn stand-in.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { codexExecutablePath, type CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexLaunch, FAKE_APP_SERVER, FAKE_SCRIPTS, startCodexAppServer } from '../../src/main/vendors/codex/launch'
import { CODEX_SCHEMA_BUNDLE, codexAjv } from '../../src/main/vendors/codex/schema'
import { DIRECT_START_PROFILE, directStartEnv, launchEnv } from '../e2e/launch-env'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPTS = join(REPO, FAKE_SCRIPTS)
const BUNDLE = join(REPO, 'src', 'main', 'vendors', 'codex', 'protocol', 'json', CODEX_SCHEMA_BUNDLE)

/** The scripts the ticket names; the folder may hold more. */
const NAMED_SCRIPTS = ['turn', 'steer', 'interrupt', 'approval', 'resume', 'account-plus', 'account-pro', 'signed-out', 'login', 'limits-two-windows', 'usage-limit-window', 'usage-limit-quota', 'threads']

const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

/** How long the fake may take to send the message a test waits for. */
const ANSWER_MS = ms(10_000)

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  for (const root of roots.splice(0)) removeTestTree(root)
})

/** A new empty folder under the system temporary folder, removed after the test. */
function tempRoot(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-fake-'))
  roots.push(root)
  return root
}

// --- The check of the scripts against the JSON Schema ---------------------------------------------

type Schema = Record<string, unknown>
const isSchema = (value: unknown): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The keywords of draft-07 whose value is one schema, a list of them, or a map of names to them. */
const ONE = ['items', 'additionalItems', 'additionalProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']
const LIST = ['items', 'allOf', 'anyOf', 'oneOf']
const MAP = ['properties', 'patternProperties', 'definitions', 'dependencies']

/**
 * Closes `schema` and every schema inside it: an object schema with `properties` and no
 * `additionalProperties` refuses the properties it does not name. When it also has oneOf, anyOf or
 * allOf branches of its own properties (a ThreadItem: `startedAtMs` beside the branch of each kind),
 * the branches are closed instead, each knowing the properties of the schema around it; with a branch
 * that is a reference or has no properties nothing is closed there.
 */
function close(schema: Schema): void {
  const properties = schema.properties
  if (isSchema(properties) && !('additionalProperties' in schema)) {
    const branches = [schema.oneOf, schema.anyOf, schema.allOf].find(Array.isArray) as unknown[] | undefined
    if (branches === undefined) schema.additionalProperties = false
    else if (branches.every((branch) => isSchema(branch) && isSchema(branch.properties) && !('$ref' in branch))) {
      for (const branch of branches as Schema[]) branch.properties = { ...Object.fromEntries(Object.keys(properties).map((name) => [name, true])), ...(branch.properties as Schema) }
    }
  }
  for (const key of ONE) {
    const value = schema[key]
    if (isSchema(value)) close(value)
  }
  for (const key of LIST) {
    const value = schema[key]
    if (Array.isArray(value)) for (const item of value as unknown[]) if (isSchema(item)) close(item)
  }
  for (const key of MAP) {
    const value = schema[key]
    if (isSchema(value)) for (const item of Object.values(value)) if (isSchema(item)) close(item)
  }
}

/** The bundle: its definitions, and the unions of messages the check reads by name. */
interface Bundle {
  definitions: Record<string, Schema> & Record<'ClientRequest' | 'ClientNotification' | 'ServerNotification' | 'ServerRequest', Schema>
}

/** A copy of the generated bundle with every object closed (`close`); `v2` holds definitions, not a schema. */
function closedBundle(): Bundle {
  const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8')) as Bundle
  for (const [name, schema] of Object.entries(bundle.definitions)) {
    if (name === 'v2') for (const definition of Object.values(schema)) close(definition as Schema)
    else close(schema)
  }
  return bundle
}

/** The method names of a oneOf of messages (ClientRequest, ServerNotification…) with the schema of each. */
function methodsOf(union: Schema): Map<string, Schema> {
  const methods = new Map<string, Schema>()
  for (const branch of union.oneOf as Schema[]) {
    const [method] = ((branch.properties as Schema).method as Schema).enum as [string]
    methods.set(method, branch)
  }
  return methods
}

/** The first `$ref` inside `schema`, or undefined. */
function firstRef(schema: unknown): string | undefined {
  if (Array.isArray(schema)) return schema.map(firstRef).find((ref) => ref !== undefined)
  if (!isSchema(schema)) return undefined
  if (typeof schema.$ref === 'string') return schema.$ref
  return Object.values(schema).map(firstRef).find((ref) => ref !== undefined)
}

/** A step of a script, as test/fixtures/codex-app-server/fake-app-server.mjs reads it. */
interface Step {
  expect?: string
  notify?: string
  request?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

/**
 * The checker of the scripts: checkScript(text) is the list of what in the script the pinned Codex
 * does not have, empty when it plays only its messages. A result is checked against the response of
 * its method, named after the method's params (`v2/ThreadStartParams` → `v2/ThreadStartResponse`).
 */
function scriptChecker(): (text: string) => string[] {
  const bundle = closedBundle()
  const ajv = codexAjv()
  ajv.addSchema(bundle, 'codex')
  const validator = (name: string) => {
    const validate = ajv.getSchema(`codex#/definitions/${name}`)
    if (validate === undefined) throw new Error(`no ${name} in the bundle`)
    return validate
  }
  const requests = methodsOf(bundle.definitions.ClientRequest)
  const clientNotifications = methodsOf(bundle.definitions.ClientNotification)
  const notifications = methodsOf(bundle.definitions.ServerNotification)
  const serverRequests = methodsOf(bundle.definitions.ServerRequest)
  const errorShape = validator('JSONRPCErrorError')
  const check = (name: string, value: unknown): string[] => {
    const validate = validator(name)
    return validate(value) ? [] : (validate.errors ?? []).map((error) => `${name}${error.instancePath} ${error.message ?? ''} ${JSON.stringify(error.params)}`)
  }
  /** The definition of the params of a message of `union`, as `v2/ThreadStartParams`. */
  const paramsOf = (union: Map<string, Schema>, method: string): string | undefined => firstRef((union.get(method)?.properties as Schema | undefined)?.params)?.replace('#/definitions/', '')
  /** A message of the server, checked against the params of its method (so the errors name only that method) or, without a definition of its params, as a whole. */
  const checkSent = (union: Map<string, Schema>, unionName: string, kind: string, message: { method: string; params: unknown }): string[] => {
    if (!union.has(message.method)) return [`${message.method} is not a ${kind} of the server`]
    const params = paramsOf(union, message.method)
    return params === undefined ? check(unionName, message) : check(params, message.params)
  }
  const responseOf = (method: string): string | undefined => {
    const params = paramsOf(requests, method)
    return params?.endsWith('Params') ? params.replace(/Params$/, 'Response') : undefined
  }
  return (text) => {
    const problems: string[] = []
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (line.trim() === '') continue
      const at = (problem: string) => problems.push(`line ${index + 1}: ${problem}`)
      const step = JSON.parse(line) as Step
      if (step.notify !== undefined) for (const problem of checkSent(notifications, 'ServerNotification', 'notification', { method: step.notify, params: step.params })) at(problem)
      else if (step.request !== undefined) for (const problem of checkSent(serverRequests, 'ServerRequest', 'request', { method: step.request, params: step.params })) at(problem)
      else if (step.expect !== undefined && step.result === undefined && step.error === undefined) {
        if (!clientNotifications.has(step.expect)) at(`${step.expect} is not a notification of the client`)
      } else if (step.expect !== undefined) {
        if (!requests.has(step.expect)) at(`${step.expect} is not a request of the client`)
        else if (step.error !== undefined) {
          if (!errorShape(step.error)) at(`the error of ${step.expect} is not a JSON-RPC error`)
        } else {
          const response = responseOf(step.expect)
          if (response === undefined) at(`no response schema for ${step.expect}`)
          else for (const problem of check(response, step.result)) at(problem)
        }
      } else at('a step has one of "expect", "notify" or "request"')
    }
    return problems
  }
}

let checker: ((text: string) => string[]) | undefined
const checkScript = (text: string): string[] => (checker ??= scriptChecker())(text)

const scriptFiles = () => readdirSync(SCRIPTS).filter((name) => name.endsWith('.jsonl'))

describe('the scripts of the fake app-server', () => {
  it('has every script the ticket names', () => {
    expect(scriptFiles().map((name) => name.replace(/\.jsonl$/, ''))).toEqual(expect.arrayContaining(NAMED_SCRIPTS))
  })

  it('plays only messages of the JSON Schema of the pinned Codex, every script', () => {
    for (const name of scriptFiles()) expect(checkScript(readFileSync(join(SCRIPTS, name), 'utf8')), name).toEqual([])
  })

  it('fails a script with a field, a method or a result the pinned Codex does not have', () => {
    const turn = readFileSync(join(SCRIPTS, 'turn.jsonl'), 'utf8').split('\n')
    const index = turn.findIndex((line) => line.includes('"notify":"turn/started"'))
    const extraField = turn.map((line, at) => (at === index ? line.replace('"threadId":', '"mood":"cheerful","threadId":') : line)).join('\n')
    expect(checkScript(extraField)).toEqual([`line ${index + 1}: v2/TurnStartedNotification must NOT have additional properties {"additionalProperty":"mood"}`])

    // The same field deep inside a message: an item of the thread of thread/start.
    expect(checkScript('{"expect":"thread/start","result":{"approvalPolicy":"never","approvalsReviewer":"user","cwd":"/p","model":"m","modelProvider":"openai","sandbox":{"type":"readOnly"},"thread":{"id":"t","sessionId":"s","cliVersion":"0","createdAt":1,"updatedAt":1,"cwd":"/p","ephemeral":false,"modelProvider":"openai","preview":"","projectId":null,"source":"appServer","status":{"type":"idle","since":1},"turns":[]}}}')).not.toEqual([])
    expect(checkScript('{"notify":"turn/teleported","params":{}}')).toEqual(['line 1: turn/teleported is not a notification of the server'])
    expect(checkScript('{"request":"item/commandExecution/requestApproval","params":{"itemId":"i","threadId":"t","turnId":"u"}}')).not.toEqual([])
    expect(checkScript('{"expect":"thread/teleport","result":{}}')).toEqual(['line 1: thread/teleport is not a request of the client'])
    expect(checkScript('{"expect":"turn/steer","result":{"turn":"u"}}')).not.toEqual([])
    expect(checkScript('{"expect":"initialised"}')).toEqual(['line 1: initialised is not a notification of the client'])
  })

  it('takes the fields a message has beside the branch of its kind', () => {
    // emittedAtMs stands beside every notification, startedAtMs beside every item kind.
    expect(checkScript('{"notify":"item/started","params":{"threadId":"t","turnId":"u","startedAtMs":1,"item":{"type":"agentMessage","id":"m","text":"","startedAtMs":1}}}')).toEqual([])
  })
})

// --- The fake over stdio ----------------------------------------------------------------------------

interface Fake {
  send: (message: object) => void
  /** The next message of the fake that `match` takes; the ones before it are kept in `seen`. */
  next: (match: (message: Message) => boolean) => Promise<Message>
  /** Every message the fake sent so far. */
  seen: Message[]
  /** Ends the fake's stdin and waits for its exit; its stderr. */
  close: () => Promise<{ code: number | null; stderr: string }>
}

interface Message {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** Starts the fake as launch.ts would, with `env` on top of the test's environment, under scriptNode(). */
function startFake(cwd: string, env: Record<string, string>): Fake {
  const launch = codexLaunch({ runtime: RUNTIME, appPath: REPO, env: { ...process.env, WORFY_CODEX: 'fake', ...env } })
  const child = spawn(scriptNode(), launch.args, { cwd, env: launch.env, stdio: 'pipe' })
  children.push(child)
  // A fake that already exited (a script it cannot read) closes the pipe: a write to it is not an error of the test.
  child.stdin.on('error', () => undefined)
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const seen: Message[] = []
  let waiter: (() => void) | undefined
  createInterface({ input: child.stdout }).on('line', (line) => {
    seen.push(JSON.parse(line) as Message)
    waiter?.()
  })
  let taken = 0
  const exit = new Promise<number | null>((resolve) => child.on('exit', resolve))
  return {
    seen,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    next: (match) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the fake sent no such message in time; it sent ${JSON.stringify(seen.slice(taken))}; stderr: ${stderr}`)), ANSWER_MS)
        const look = () => {
          const at = seen.findIndex((message, index) => index >= taken && match(message))
          if (at === -1) return
          taken = at + 1
          clearTimeout(timer)
          waiter = undefined
          resolve(seen[at] as Message)
        }
        waiter = look
        look()
      }),
    close: async () => {
      child.stdin.end()
      return { code: await exit, stderr }
    },
  }
}

const answerTo = (id: number) => (message: Message) => message.id === id && message.method === undefined
const notification = (method: string) => (message: Message) => message.method === method && message.id === undefined

/** initialize → initialized, as the app-server client starts every process. */
async function handshake(fake: Fake): Promise<Message> {
  fake.send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'worfy', version: '0.0.0' } } })
  const initialized = await fake.next(answerTo(1))
  fake.send({ method: 'initialized' })
  return initialized
}

/** Every file under `root`, as paths from it with forward slashes. */
function filesUnder(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[]).filter((path) => statSync(join(root, path)).isFile()).map((path) => path.split(sep).join('/')).sort()
}

/** The files of the fixtures of the fake with their sizes and times, to see that a run left them as they were. */
function fixturesState(): string[] {
  return [join(REPO, 'test', 'fixtures', 'codex-app-server'), SCRIPTS].flatMap((dir) => readdirSync(dir).map((name) => {
    const stat = statSync(join(dir, name))
    return `${relative(REPO, join(dir, name))} ${stat.size} ${stat.mtimeMs}`
  }))
}

describe('the fake app-server', () => {
  it('plays turn: initialize → initialized, thread/start, turn/start and the notifications of the script; the log holds worfy\'s requests', async () => {
    const root = tempRoot()
    const log = join(root, 'codex.log')
    const before = fixturesState()
    const fake = startFake(root, { WORFY_CODEX_SCRIPT: 'turn', WORFY_CODEX_LOG: log, WORFY_CODEX_HOME: join(root, 'codex-home') })

    const initialized = await handshake(fake)
    expect(initialized.result).toMatchObject({ platformFamily: 'unix', userAgent: expect.any(String) })
    fake.send({ id: 2, method: 'thread/start', params: { cwd: root } })
    const started = await fake.next(answerTo(2))
    expect(started.result?.thread).toMatchObject({ id: 'thr_fake_1' })
    fake.send({ id: 3, method: 'turn/start', params: { threadId: 'thr_fake_1', input: [{ type: 'text', text: 'Say hello' }] } })
    expect((await fake.next(answerTo(3))).result?.turn).toMatchObject({ id: 'turn_1', status: 'inProgress' })
    const completed = await fake.next(notification('turn/completed'))
    expect(completed.params?.turn).toMatchObject({ id: 'turn_1', status: 'completed' })

    const methods = fake.seen.filter((message) => message.id === undefined).map((message) => message.method)
    expect(methods).toEqual(['thread/started', 'turn/started', 'item/started', 'item/agentMessage/delta', 'item/agentMessage/delta', 'item/completed', 'thread/tokenUsage/updated', 'turn/completed'])
    const deltas = fake.seen.filter(notification('item/agentMessage/delta')).map((message) => message.params?.delta).join('')
    expect(deltas).toBe('Hello from the fake Codex.')

    const { code, stderr } = await fake.close()
    expect(stderr).toBe('')
    expect(code).toBe(0)
    const logged = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Message)
    expect(logged.map((message) => message.method)).toEqual(['initialize', 'initialized', 'thread/start', 'turn/start'])
    expect(logged[0]?.params).toEqual({ clientInfo: { name: 'worfy', version: '0.0.0' } })
    // It wrote the log and the thread of WORFY_CODEX_HOME, nothing else in its folder, and left its own files as they were.
    expect(filesUnder(root)).toEqual(['codex-home/threads/thr_fake_1.json', 'codex.log'])
    expect(fixturesState()).toEqual(before)
  })

  it('resumes only a thread another run started in the same WORFY_CODEX_HOME', async () => {
    const root = tempRoot()
    const home = join(root, 'codex-home')
    const stranger = startFake(root, { WORFY_CODEX_SCRIPT: 'resume', WORFY_CODEX_HOME: home })
    await handshake(stranger)
    stranger.send({ id: 2, method: 'thread/resume', params: { threadId: 'thr_fake_1' } })
    expect((await stranger.next(answerTo(2))).error).toMatchObject({ message: 'no rollout found for thread id thr_fake_1' })
    await stranger.close()

    const first = startFake(root, { WORFY_CODEX_SCRIPT: 'turn', WORFY_CODEX_HOME: home })
    await handshake(first)
    first.send({ id: 2, method: 'thread/start', params: {} })
    await first.next(answerTo(2))
    await first.close()

    const second = startFake(root, { WORFY_CODEX_SCRIPT: 'resume', WORFY_CODEX_HOME: home })
    await handshake(second)
    second.send({ id: 2, method: 'thread/resume', params: { threadId: 'thr_fake_1' } })
    const resumed = await second.next(answerTo(2))
    expect(resumed.result?.thread).toMatchObject({ id: 'thr_fake_1', turns: [{ id: 'turn_1', status: 'completed' }] })
    expect((await second.close()).code).toBe(0)
  })

  it('asks worfy for approval and waits for the answer before the item completes', async () => {
    const root = tempRoot()
    const log = join(root, 'codex.log')
    const fake = startFake(root, { WORFY_CODEX_SCRIPT: 'approval', WORFY_CODEX_LOG: log })
    await handshake(fake)
    fake.send({ id: 2, method: 'thread/start', params: {} })
    fake.send({ id: 3, method: 'turn/start', params: { threadId: 'thr_fake_1', input: [{ type: 'text', text: 'Run the tests' }] } })
    const ask = await fake.next((message) => message.method === 'item/commandExecution/requestApproval')
    expect(ask.params).toMatchObject({ command: 'pnpm test', itemId: 'cmd_1' })
    expect(fake.seen.some(notification('item/completed'))).toBe(false)

    fake.send({ id: ask.id as number, result: { decision: 'accept' } })
    expect((await fake.next(notification('item/completed'))).params?.item).toMatchObject({ id: 'cmd_1', status: 'completed' })
    const patch = await fake.next((message) => message.method === 'item/fileChange/requestApproval')
    fake.send({ id: patch.id as number, result: { decision: 'decline' } })
    await fake.next(notification('turn/completed'))
    await fake.close()
    const answers = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Message).filter((message) => message.method === undefined)
    expect(answers).toEqual([{ id: ask.id, result: { decision: 'accept' } }, { id: patch.id, result: { decision: 'decline' } }])
  })

  it('refuses a request the script does not wait for, and every request after the script ends', async () => {
    const fake = startFake(tempRoot(), { WORFY_CODEX_SCRIPT: 'account-pro' })
    await handshake(fake)
    fake.send({ id: 2, method: 'thread/start', params: {} })
    expect((await fake.next(answerTo(2))).error?.message).toBe('fake app-server: waits for account/read (account-pro.jsonl:3), got thread/start')
    fake.send({ id: 3, method: 'account/read', params: {} })
    expect((await fake.next(answerTo(3))).result).toMatchObject({ account: { type: 'chatgpt', planType: 'pro' } })
    fake.send({ id: 4, method: 'account/rateLimits/read' })
    expect((await fake.next(answerTo(4))).result?.rateLimits).toMatchObject({ primary: { windowDurationMins: 10080 }, secondary: null })
    fake.send({ id: 5, method: 'account/read', params: {} })
    expect((await fake.next(answerTo(5))).error?.message).toBe('fake app-server: waits for nothing: the script account-pro has ended, got account/read')
    expect((await fake.close()).code).toBe(0)
  })

  it('stops with exit code 2 on a script it cannot read', async () => {
    const root = tempRoot()
    const fake = startFake(root, { WORFY_CODEX_SCRIPT: 'no-such-script' })
    const { code, stderr } = await fake.close()
    expect(code).toBe(2)
    expect(stderr).toMatch(/cannot read the script .*no-such-script\.jsonl/)
  })
})

// --- launch.ts -------------------------------------------------------------------------------------

interface Spawned {
  file: string
  args: readonly string[]
  options: SpawnOptions
}

/** A spawn that starts nothing and records what it was given. */
function recordingSpawn(calls: Spawned[]) {
  return (file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    calls.push({ file, args, options })
    return {} as ChildProcess
  }
}

describe('launch.ts', () => {
  it('under the tests starts only process.execPath with the fake, never the binary of @openai/codex', () => {
    const calls: Spawned[] = []
    const cwd = tempRoot()
    startCodexAppServer({ runtime: RUNTIME, appPath: REPO, cwd }, recordingSpawn(calls))
    expect(calls.map((call) => call.file)).toEqual([process.execPath])
    const [call] = calls as [Spawned]
    expect(call.args).toEqual([join(REPO, FAKE_APP_SERVER)])
    expect(call.options).toMatchObject({ cwd, stdio: 'pipe' })
    expect(call.options.shell).toBeUndefined()
    const binary = codexExecutablePath(RUNTIME)
    if (binary !== undefined) expect(call.file).not.toBe(binary)
    expect(call.file).not.toMatch(/@openai/)
    expect(call.options.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', WORFY_CODEX_SCRIPTS: SCRIPTS, CODEX_HOME: process.env.CODEX_HOME })
  })

  it('refuses the real Codex under vitest, whatever else the environment says', () => {
    const calls: Spawned[] = []
    const resolvePackage = () => '/node_modules/@openai/codex-darwin-arm64'
    expect(() => startCodexAppServer({ runtime: RUNTIME, appPath: REPO, cwd: REPO, env: { VITEST: 'true' }, resolvePackage }, recordingSpawn(calls))).toThrow(
      'the real Codex is not started under vitest: set WORFY_CODEX=fake',
    )
    expect(() => codexLaunch({ runtime: RUNTIME, appPath: REPO, env: { VITEST: 'true', WORFY_CODEX: 'real' }, resolvePackage })).toThrow(/not started under vitest/)
    expect(calls).toEqual([])
  })

  it('outside the tests names the pinned binary with app-server, and CODEX_HOME of the environment', () => {
    const resolvePackage = () => '/node_modules/@openai/codex-darwin-arm64'
    const runtime: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: 'darwin', arch: 'arm64' }
    const launch = codexLaunch({ runtime, appPath: REPO, env: { CODEX_HOME: '/home/user/.codex' }, resolvePackage })
    expect(launch).toEqual({ file: '/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex', args: ['app-server'], env: { CODEX_HOME: '/home/user/.codex' } })
    const windows: CodexRuntime = { packaged: true, resourcesPath: 'C:\\worfy\\resources', platform: 'win32', arch: 'x64' }
    expect(codexLaunch({ runtime: windows, appPath: REPO, env: {} }).file).toBe('C:\\worfy\\resources\\app.asar.unpacked\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe')
    expect(() => codexLaunch({ runtime, appPath: REPO, env: {}, resolvePackage: () => undefined })).toThrow('no Codex for darwin-arm64: the package @openai/codex-darwin-arm64 is not installed')
  })

  it('keeps the fake\'s own variables, the folder of the scripts among them', () => {
    const launch = codexLaunch({ runtime: RUNTIME, appPath: REPO, env: { WORFY_CODEX: 'fake', WORFY_CODEX_SCRIPT: 'steer', WORFY_CODEX_SCRIPTS: '/scripts', WORFY_CODEX_LOG: '/log' } })
    expect(launch.env).toEqual({ WORFY_CODEX: 'fake', WORFY_CODEX_SCRIPT: 'steer', WORFY_CODEX_SCRIPTS: '/scripts', WORFY_CODEX_LOG: '/log', ELECTRON_RUN_AS_NODE: '1' })
  })
})

// --- The isolation of the tests ---------------------------------------------------------------------

describe('Codex isolation of the tests', () => {
  it('gives a contract test WORFY_CODEX=fake and an empty CODEX_HOME of its own in the run\'s folder (test/setup-contract.ts)', () => {
    expect(process.env.WORFY_CODEX).toBe('fake')
    const home = process.env.CODEX_HOME ?? ''
    expect(relative(inject('contractClaudeHomes'), home)).toMatch(/^codex-home-[^\\/]+$/)
    expect(existsSync(home)).toBe(true)
    expect(readdirSync(home)).toEqual([])
  })

  it('takes the place of a CODEX_HOME and a WORFY_CODEX the developer\'s shell has (isolateCodex)', async () => {
    // Imported here, not at the top: the import itself runs the setup, and the test above would pass without the setup file.
    const { isolateCodex } = await import('../setup-contract')
    const root = tempRoot()
    const env: Record<string, string | undefined> = { CODEX_HOME: '/Users/developer/.codex', WORFY_CODEX: 'real' }
    const { home, release } = isolateCodex(env, root)
    expect(env).toEqual({ CODEX_HOME: home, WORFY_CODEX: 'fake' })
    expect(relative(root, home)).toMatch(/^codex-home-[^\\/]+$/)
    release()
    expect(existsSync(home)).toBe(false)
    expect(env.CODEX_HOME).toBeUndefined()
  })

  it('gives every app launch of the e2e tests the fake and a CODEX_HOME of the launch, over the developer\'s own (test/e2e/launch-env.ts)', async () => {
    const shellDir = tempRoot()
    const developer = { CODEX_HOME: '/Users/developer/.codex', WORFY_CODEX: 'real', PATH: process.env.PATH ?? '' }
    for (const platform of ['darwin', 'win32'] as const) {
      // SHELL of the spec's own: no link to the e2e shell is made, which Windows may not allow.
      const launchDir = mkdtempSync(join(shellDir, 'shell-'))
      const launched = await launchEnv({ dataDir: 'd', claudeHome: 'c', shellDir: launchDir, source: developer, platform, env: { SHELL: '/bin/sh' } })
      expect(launched.WORFY_CODEX, platform).toBe('fake')
      expect(launched.CODEX_HOME, platform).toBe(join(launchDir, 'profile', '.codex'))
      const direct = directStartEnv({ dataDir: 'd', claudeHome: 'c', source: developer, platform })
      expect(direct.WORFY_CODEX, platform).toBe('fake')
      expect(direct.CODEX_HOME, platform).toBe(join(DIRECT_START_PROFILE, '.codex'))
    }
  })
})
