// The SessionHandle of the Codex driver (src/main/vendors/codex/session.ts, worfy-multi-vendor ticket 20)
// on the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets): a turn, steer during a
// turn, Interrupt, resume, the model, effort and preset of the next turn, approvals and their answers,
// an unattended Session, a crash, starts that fail without leaving a process, and the slash menu
// (ticket 22: skills, /compact, /review). What worfy sent is read from the fake's log (WORFY_CODEX_LOG).
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of the session
// part, as in test/contract/codex-app-server.test.ts. A preload module of the test's own (`--import`)
// stops the fake with exit code 101 when worfy sends the method WORFY_TEST_CRASH_ON, and writes the
// lines WORFY_TEST_INJECT to its stdout right after the fake wrote a message of the method
// WORFY_TEST_INJECT_AFTER: what no script can play — a request Codex resolves itself, a line that is
// not JSON, a method the schema does not know, a notification of another thread. Under
// WORFY_TEST_HOLD_MS it also starts a child that holds the fake's stdout after the fake exited (HOLDER).
// HOLDER does not keep the pipe open on Windows; holdClose() holds back the 'close' of the fake's
// process itself, the same on every OS.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS, type SessionSettings } from '../../src/shared/agent/settings'
import { PermissionGate } from '../../src/main/agent/permissions'
import { hasExited, within } from '../../src/main/agent/session/process'
import type { AgentProcess, PermissionAsk, PermissionAsker, RefusalDetails, SessionHandle, SessionPart, SessionStart } from '../../src/main/vendors/session'
import { OUTPUT_AFTER_EXIT_MS } from '../../src/main/vendors/codex/app-server'
import { UNATTENDED_DECLINED_MESSAGE } from '../../src/main/vendors/codex/approvals'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexDriver } from '../../src/main/vendors/codex'
import { CODEX_CAPABILITIES, codexCapabilities } from '../../src/main/vendors/codex/capabilities'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

/** How long the fake may take to send what a test waits for. */
const ANSWER_MS = ms(10_000)

/**
 * A child of the fake that holds the fake's stdout after the fake exited, as a process the app-server
 * leaves behind would: once the fake is gone it waits WORFY_TEST_LATE_MS, writes WORFY_TEST_LATE_LINE
 * (if any), and exits WORFY_TEST_HOLD_MS after the fake did — after a minute at the latest.
 */
const HOLDER = `const parent = Number(process.env.WORFY_TEST_PARENT)
const alive = () => { try { process.kill(parent, 0); return true } catch { return false } }
setTimeout(() => process.exit(0), 60000)
const watch = setInterval(() => {
  if (alive()) return
  clearInterval(watch)
  const line = process.env.WORFY_TEST_LATE_LINE
  if (line) setTimeout(() => process.stdout.write(line), Number(process.env.WORFY_TEST_LATE_MS))
  setTimeout(() => process.exit(0), Number(process.env.WORFY_TEST_HOLD_MS))
}, 10)
`

const PRELOAD = `import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
if (process.env.WORFY_TEST_HOLD_MS) {
  const holder = spawn(process.execPath, ['-e', ${JSON.stringify(HOLDER)}], {
    stdio: ['ignore', 'inherit', 'ignore'],
    env: { ...process.env, WORFY_TEST_PARENT: String(process.pid) },
  })
  writeFileSync(join(dirname(process.env.WORFY_CODEX_LOG), 'holder.pid'), String(holder.pid))
}
const crashOn = process.env.WORFY_TEST_CRASH_ON
if (crashOn) process.stdin.on('data', (chunk) => {
  if (String(chunk).includes('"method":"' + crashOn + '"')) {
    process.stderr.write('panic: the fake app-server crashed on ' + crashOn + '\\n')
    process.exit(101)
  }
})
const injectAfter = process.env.WORFY_TEST_INJECT_AFTER
const lines = process.env.WORFY_TEST_INJECT
if (injectAfter && lines) {
  const write = process.stdout.write.bind(process.stdout)
  let injected = false
  process.stdout.write = (chunk, ...rest) => {
    const written = write(chunk, ...rest)
    if (!injected && String(chunk).includes('"method":"' + injectAfter + '"')) {
      injected = true
      write(lines)
    }
    return written
  }
}
`

const roots: string[] = []
const handles: SessionHandle[] = []
/** Every process the spawn stand-in started: one a test left running is killed by its pid. */
const children: ChildProcess[] = []
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const root of roots.splice(0)) {
    const holder = holderOf(root)
    if (holder !== null && alive(holder)) process.kill(holder, 'SIGKILL')
    removeTestTree(root)
  }
})

/** The pid of the child that holds the fake's stdout (HOLDER), if the fake in `root` started one. */
function holderOf(root: string): number | null {
  const file = join(root, 'holder.pid')
  return existsSync(file) ? Number(readFileSync(file, 'utf8')) : null
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Waits until `check` holds, looking every 20 ms, for ANSWER_MS at most. */
async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + ANSWER_MS
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`not in time: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

interface Logged {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

interface Ask {
  request: PermissionAsk
  answer: (picked: string | null) => void
  refuse: () => void
}

/** The 'close' of one process held back: it reaches the process's listeners only after release(). */
interface CloseHold {
  release: () => void
  /** Whether the process's listeners got its 'close'. */
  closed: () => boolean
}

/**
 * Holds back the 'close' of `child` — the end of its stdout and stderr — until release(), as a pipe a
 * child of the process still held would: what the process wrote still arrives, only the end of its
 * output waits.
 */
function holdClose(child: ChildProcess): CloseHold {
  const emit = child.emit.bind(child)
  let released = false
  let closed = false
  let held: unknown[] | null = null
  const pass = (args: unknown[]): void => {
    closed = true
    emit('close', ...args)
  }
  child.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    if (event !== 'close') return emit(event, ...args)
    if (released) pass(args)
    else held = args
    return true
  }) as ChildProcess['emit']
  return {
    release: () => {
      released = true
      if (held !== null) pass(held)
    },
    closed: () => closed,
  }
}

/** A session part over the fake playing `script`, and what a test looks at. */
interface Fake {
  part: SessionPart
  root: string
  log: string
  spawnedChildren: ChildProcess[]
  /** With `holdClose`, the 'close' of each process the stand-in started, in the order of `spawnedChildren`. */
  holds: CloseHold[]
  /** What worfy sent the fake so far. */
  logged: () => Logged[]
  requests: (method: string) => Logged[]
  /** The answers worfy gave to the fake's requests. */
  answers: () => Logged[]
}

function fake(script: string, env: Record<string, string> = {}, options: { holdClose?: boolean } = {}): Fake {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-session-'))
  roots.push(root)
  const log = join(root, 'codex.log')
  const preload = join(root, 'preload.mjs')
  writeFileSync(preload, PRELOAD)
  const spawnedChildren: ChildProcess[] = []
  const holds: CloseHold[] = []
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), ['--import', pathToFileURL(preload).href, ...args], spawnOptions)
    children.push(child)
    spawnedChildren.push(child)
    if (options.holdClose === true) holds.push(holdClose(child))
    return child
  }
  const part = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log, ...env },
      spawnProcess,
      log: () => undefined,
    }),
  )
  const logged = (): Logged[] => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Logged)
    } catch {
      return []
    }
  }
  return {
    part,
    root,
    log,
    spawnedChildren,
    holds,
    logged,
    requests: (method) => logged().filter((message) => message.method === method),
    answers: () => logged().filter((message) => message.method === undefined),
  }
}

/** A live handle, with everything its Session would see. */
interface Live {
  handle: SessionHandle
  events: AgentEvent[]
  /** Settles when the events end: null when they ended, or the error they ended with. */
  ended: Promise<Error | null>
  until: (match: (event: AgentEvent) => boolean, what: string) => Promise<AgentEvent>
  asks: Ask[]
  refused: [string, string, RefusalDetails][]
  stderr: string[]
  spawned: AgentProcess[]
}

interface Options {
  settings?: SessionSettings
  unattended?: boolean
  resume?: string
  /** The gate the Session answers approvals with; one that records every request by default. */
  permissions?: PermissionAsker
}

/** What a Session gives its driver, with every call recorded in `into`. */
function startOptions(at: Fake, into: Pick<Live, 'asks' | 'refused' | 'stderr' | 'spawned'>, options: Options): SessionStart {
  return {
    cwd: at.root,
    settings: options.settings ?? DEFAULT_SETTINGS,
    unattended: options.unattended ?? false,
    orchestrator: false,
    permissions: options.permissions ?? {
      ask: (request) =>
        new Promise<string | null>((resolve, reject) => {
          into.asks.push({ request, answer: resolve, refuse: () => reject(new Error('the gate failed')) })
        }),
      askQuestions: () => Promise.resolve({ outcome: 'cancelled' }),
    },
    refused: (subject, message, details) => into.refused.push([subject, message, details]),
    stderr: (data) => into.stderr.push(data),
    spawned: (child) => into.spawned.push(child),
  }
}

async function live(at: Fake, options: Options = {}): Promise<Live> {
  const into = { asks: [] as Ask[], refused: [] as [string, string, RefusalDetails][], stderr: [] as string[], spawned: [] as AgentProcess[] }
  const opts = startOptions(at, into, options)
  const handle = options.resume === undefined ? await at.part.start({ ...opts, sessionId: 'worfy-session-1' }) : await at.part.resume(options.resume, opts)
  handles.push(handle)
  const events: AgentEvent[] = []
  const ended = (async (): Promise<Error | null> => {
    try {
      for await (const event of handle.events) events.push(event)
      return null
    } catch (error) {
      return error as Error
    }
  })()
  const until = async (match: (event: AgentEvent) => boolean, what: string): Promise<AgentEvent> => {
    await eventually(() => events.some(match), `${what}; the events: ${JSON.stringify(events)}`)
    return events.find(match) as AgentEvent
  }
  return { handle, events, ended, until, ...into }
}

const text = (value: string) => ({ type: 'text', text: value, text_elements: [] })
const isResult = (event: AgentEvent): boolean => event.type === 'result'
const message = (value: string) => ({ text: value, attachments: [] })
const deltaOf = (value: string) => (event: AgentEvent): boolean => event.type === 'delta' && event.text === value

describe('a Codex Session: start and turns', () => {
  it('starts a thread with the folder and the preset, then a turn: init with the thread\'s id, the answer, the context and the result', async () => {
    const at = fake('turn')
    const session = await live(at)
    await session.until((event) => event.type === 'account', 'account')
    await session.handle.send(message('Say hello'))
    await session.until(isResult, 'the result')
    expect(session.events).toEqual([
      { type: 'account', loggedIn: true, subscriptionType: null, apiProvider: null, tokenSource: null },
      { type: 'init', sdkSessionId: 'thr_fake_1', model: 'gpt-5.5-codex', permissionMode: 'full-access', apiKeySource: 'none', cwd: at.root, claudeCodeVersion: '0.166.0', slashCommands: [] },
      { type: 'delta', kind: 'text', text: 'Hello', parentToolUseId: null },
      { type: 'delta', kind: 'text', text: ' from the fake Codex.', parentToolUseId: null },
      { type: 'text', text: 'Hello from the fake Codex.', messageId: 'msg_1', parentToolUseId: null, synthetic: false },
      { type: 'context', usage: { percentage: 0, totalTokens: 1240, windowTokens: 272000, autoCompactThreshold: null, autoCompactEnabled: false } },
      {
        type: 'result',
        subtype: 'success',
        isError: false,
        error: null,
        text: 'Hello from the fake Codex.',
        costUsd: 0,
        durationMs: 3000,
        numTurns: 1,
        usage: { inputTokens: 1200, outputTokens: 40, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        terminalReason: 'completed',
        interrupted: false,
      },
    ])
    // DEFAULT_SETTINGS run in bypassPermissions: Codex's "Full access".
    expect(at.requests('thread/start').map((request) => request.params)).toEqual([{ cwd: at.root, approvalPolicy: 'never', sandbox: 'danger-full-access' }])
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('Say hello')] }])
    expect(session.spawned).toEqual(at.spawnedChildren)
  })

  it('starts the thread on the model named, and gives the effort to the first turn', async () => {
    const at = fake('turn')
    const session = await live(at, { settings: { model: 'gpt-5.4', effort: 'low', permissionMode: 'default' } })
    await session.handle.send(message('Say hello'))
    const init = await session.until((event) => event.type === 'init', 'init')
    expect(init).toMatchObject({ model: 'gpt-5.5-codex', permissionMode: 'read-only' })
    expect(at.requests('thread/start').map((request) => request.params)).toEqual([{ cwd: at.root, approvalPolicy: 'on-request', sandbox: 'read-only', model: 'gpt-5.4' }])
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('Say hello')], effort: 'low' }])
  })

  it('a message during a turn steers it (turn/steer with the turn\'s id), and the turn goes on to its result', async () => {
    const at = fake('steer')
    const session = await live(at)
    await session.handle.send(message('Fix the build'))
    await session.until(deltaOf('Working on it'), 'the first delta')
    await session.handle.send(message('Mind the tests'))
    await session.until(isResult, 'the result')
    expect(at.requests('turn/steer').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('Mind the tests')], expectedTurnId: 'turn_1' }])
    expect(at.requests('turn/start')).toHaveLength(1)
    expect(session.events.some(deltaOf(', and taking your note into account.'))).toBe(true)
  })

  it('a message sent right after another, before Codex named the turn, steers the turn that one starts', async () => {
    const at = fake('steer')
    const session = await live(at)
    // Both at once: the second waits for the first, which is done once turn/start answered with the turn.
    await Promise.all([session.handle.send(message('Fix the build')), session.handle.send(message('Mind the tests'))])
    await session.until(isResult, 'the result')
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('Fix the build')] }])
    expect(at.requests('turn/steer').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('Mind the tests')], expectedTurnId: 'turn_1' }])
  })

  it('Interrupt sends turn/interrupt for the running turn; the turn ends as interrupted; with no turn it sends nothing', async () => {
    const at = fake('interrupt')
    const session = await live(at)
    await session.handle.send(message('Do a long task'))
    await session.until(deltaOf('Starting a long task'), 'the delta')
    await session.handle.interrupt()
    const result = await session.until(isResult, 'the result')
    expect(result).toMatchObject({ subtype: 'interrupted', isError: true, error: 'The turn was interrupted.', interrupted: true })
    expect(at.requests('turn/interrupt').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', turnId: 'turn_1' }])
    await session.handle.interrupt()
    expect(at.requests('turn/interrupt')).toHaveLength(1)
  })

  it('Interrupt called with a send, neither waiting for the other, interrupts the turn that send starts', async () => {
    const at = fake('interrupt')
    const session = await live(at)
    await Promise.all([session.handle.send(message('Do a long task')), session.handle.interrupt()])
    const result = await session.until(isResult, 'the result')
    expect(result).toMatchObject({ subtype: 'interrupted', interrupted: true })
    expect(at.requests('turn/interrupt').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', turnId: 'turn_1' }])
  })

  it('a message Codex refuses to take into the running turn is a notice; the turn goes on', async () => {
    const at = fake('interrupt')
    const session = await live(at)
    await session.handle.send(message('Do a long task'))
    await session.until(deltaOf('Starting a long task'), 'the delta')
    await session.handle.send(message('And this'))
    const notice = await session.until((event) => event.type === 'notice', 'the notice')
    expect(notice).toMatchObject({ kind: 'notification', text: expect.stringMatching(/^Codex did not take the message into the running turn: Codex app-server refused turn\/steer: fake app-server: waits for turn\/interrupt/) as unknown as string })
    expect(session.events.some(isResult)).toBe(false)
    await session.handle.interrupt()
    await session.until(isResult, 'the result')
  })

  it('a turn Codex refuses to start ends at once with a result that says why, and its changes go with the next turn', async () => {
    const at = fake('turn')
    const session = await live(at)
    await session.handle.send(message('Say hello'))
    await session.until(isResult, 'the first result')
    await session.handle.setModel('gpt-5.4')
    await session.handle.send(message('Again'))
    await eventually(() => session.events.filter(isResult).length === 2, 'the second result')
    await session.handle.send(message('Once more'))
    await eventually(() => session.events.filter(isResult).length === 3, 'the third result')
    expect(at.requests('turn/start').map((request) => request.params?.model)).toEqual([undefined, 'gpt-5.4', 'gpt-5.4'])
    expect(session.events.filter(isResult)[1]).toEqual({
      type: 'result',
      subtype: 'error',
      isError: true,
      error: expect.stringMatching(/^Codex did not start the turn: Codex app-server refused turn\/start: fake app-server: waits for nothing: the script turn has ended/) as unknown as string,
      text: null,
      costUsd: 0,
      durationMs: 0,
      numTurns: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      terminalReason: 'error',
      interrupted: false,
    })
  })

  it('resumes a thread another process started (thread/resume), and its turns go on', async () => {
    const home = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-home-'))
    roots.push(home)
    const first = fake('turn', { WORFY_CODEX_HOME: home })
    const before = await live(first)
    await before.handle.send(message('Say hello'))
    await before.until(isResult, 'the first result')
    before.handle.close()
    await eventually(() => first.spawnedChildren.every(hasExited), 'the first process exited')

    const at = fake('resume', { WORFY_CODEX_HOME: home })
    const session = await live(at, { resume: 'thr_fake_1' })
    await session.handle.send(message('Say hello again'))
    const result = await session.until(isResult, 'the result')
    expect(result).toMatchObject({ isError: false, text: 'Hello again.' })
    expect(session.events.find((event) => event.type === 'init')).toMatchObject({ sdkSessionId: 'thr_fake_1' })
    expect(at.requests('thread/resume').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', cwd: at.root, approvalPolicy: 'never', sandbox: 'danger-full-access' }])
    expect(at.requests('thread/start')).toEqual([])
  })
})

describe('a Codex Session: model, effort and preset', () => {
  it('lists the models of model/list, page by page, once; the next turn takes what changed, and Default is Codex\'s default model and its effort', async () => {
    const at = fake('settings')
    const session = await live(at)
    await session.handle.send(message('One'))
    await session.until(isResult, 'the first result')

    const capabilities = await codexCapabilities(session.handle)
    expect(capabilities.models).toEqual([
      { id: 'gpt-5.5-codex', label: 'GPT-5.5 Codex', effortLevels: ['low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4', label: 'GPT-5.4', effortLevels: ['minimal', 'low', 'medium', 'high'] },
    ])
    expect(capabilities.effortLevels).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(await session.handle.models()).toEqual([
      // Each row names the level its model runs at while none is picked, for the Session header (worfy-polish 52).
      { value: null, displayName: 'Default (GPT-5.5 Codex)', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
      { value: 'gpt-5.5-codex', displayName: 'GPT-5.5 Codex', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
      // Codex's own `minimal` since the pickers read the capabilities (worfy-multi-vendor ticket 25).
      { value: 'gpt-5.4', displayName: 'GPT-5.4', efforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'low' },
    ])
    expect(at.requests('model/list').map((request) => request.params)).toEqual([{}, { cursor: 'page-2' }])

    await session.handle.setModel('gpt-5.4')
    await session.handle.setEffort('high')
    await session.handle.setPermissionPreset('read-only')
    await expect(session.handle.setPermissionPreset('ask-everything')).rejects.toThrow('ask-everything is no permission preset of Codex')
    await session.handle.send(message('Two'))
    await eventually(() => session.events.filter(isResult).length === 2, 'the second result')

    await session.handle.setModel(null)
    await session.handle.setEffort(null)
    await session.handle.setPermissionPreset('acceptEdits')
    await session.handle.send(message('Three'))
    await eventually(() => session.events.filter(isResult).length === 3, 'the third result')

    // A change makes no request of its own: the next turn/start carries it, and only what changed.
    expect(at.logged().flatMap((logged) => (logged.id === undefined || logged.method === undefined ? [] : [logged.method]))).toEqual([
      'initialize', 'thread/start', 'turn/start', 'model/list', 'model/list', 'turn/start', 'turn/start',
    ])
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([
      { threadId: 'thr_fake_1', input: [text('One')] },
      { threadId: 'thr_fake_1', input: [text('Two')], model: 'gpt-5.4', effort: 'high', approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } },
      {
        threadId: 'thr_fake_1',
        input: [text('Three')],
        model: 'gpt-5.5-codex',
        effort: 'medium',
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      },
    ])
    expect(session.events.filter((event) => event.type === 'init').map((event) => event.type === 'init' && [event.model, event.permissionMode])).toEqual([
      ['gpt-5.5-codex', 'full-access'],
      ['gpt-5.4', 'read-only'],
      ['gpt-5.5-codex', 'auto'],
    ])
  })

  it('a thread that names no model: the turn\'s init names the default model of model/list, and turn/start names no model (worfy-polish 52)', async () => {
    const at = fake('default-model')
    const session = await live(at)
    await session.handle.send(message('One'))
    await session.until(isResult, 'the result')
    expect(at.logged().flatMap((logged) => (logged.id === undefined || logged.method === undefined ? [] : [logged.method]))).toEqual(['initialize', 'thread/start', 'model/list', 'turn/start'])
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('One')] }])
    expect(session.events.filter((event) => event.type === 'init').map((event) => event.type === 'init' && event.model)).toEqual(['gpt-5.5-codex'])
  })

  it('a model/list Codex refuses gives no models and the static capabilities, and is asked again next time', async () => {
    const at = fake('turn')
    const session = await live(at)
    expect(await session.handle.models()).toEqual([])
    expect(await codexCapabilities(session.handle)).toBe(CODEX_CAPABILITIES)
    expect(at.requests('model/list')).toHaveLength(2)
  })

  it('without model/list a Default model or effort waits: the next turn names neither', async () => {
    const at = fake('turn')
    const session = await live(at, { settings: { model: 'gpt-5.4', effort: 'high', permissionMode: 'bypassPermissions' } })
    await session.handle.setModel(null)
    await session.handle.setEffort(null)
    await session.handle.send(message('Say hello'))
    await session.until(isResult, 'the result')
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('Say hello')] }])
  })
})

describe('a Codex Session: approvals', () => {
  it('a command and a file change become permission requests with Codex\'s four answers; the answer picked goes back', async () => {
    const at = fake('approval')
    const session = await live(at)
    await session.handle.send(message('Run the tests'))
    await eventually(() => session.asks.length === 1, 'the first approval')
    const [command] = session.asks as [Ask]
    expect(command.request).toMatchObject({ subject: 'pnpm test', toolName: 'commandExecution', toolUseId: 'cmd_1' })
    expect(command.request.options.map((option) => option.id)).toEqual(['accept', 'acceptForSession', 'decline', 'cancel'])
    expect(command.request.signal.aborted).toBe(false)
    command.answer('acceptForSession')
    await eventually(() => session.asks.length === 2, 'the second approval')
    const files = session.asks[1] as Ask
    expect(files.request).toMatchObject({ subject: '/fake/project/README.md', toolName: 'fileChange', toolUseId: 'patch_1' })
    files.answer('decline')
    await session.until(isResult, 'the result')
    expect(at.answers()).toEqual([
      { id: 1, result: { decision: 'acceptForSession' } },
      { id: 2, result: { decision: 'decline' } },
    ])
  })

  it('a request the Session cancelled, or whose gate failed, is answered cancel', async () => {
    const at = fake('approval')
    const session = await live(at)
    await session.handle.send(message('Run the tests'))
    await eventually(() => session.asks.length === 1, 'the first approval')
    session.asks[0]?.answer(null)
    await eventually(() => session.asks.length === 2, 'the second approval')
    session.asks[1]?.refuse()
    await session.until(isResult, 'the result')
    expect(at.answers()).toEqual([
      { id: 1, result: { decision: 'cancel' } },
      { id: 2, result: { decision: 'cancel' } },
    ])
  })

  it('Interrupt answers an open approval cancel before turn/interrupt, and withdraws its request; a late answer sends nothing', async () => {
    const at = fake('approval-interrupt')
    const session = await live(at)
    await session.handle.send(message('Clean up'))
    await eventually(() => session.asks.length === 1, 'the approval')
    const ask = session.asks[0] as Ask
    expect(ask.request.subject).toBe('rm -rf build')
    await session.handle.interrupt()
    expect(ask.request.signal.aborted).toBe(true)
    ask.answer('accept')
    const result = await session.until(isResult, 'the result')
    expect(result).toMatchObject({ interrupted: true })
    const order = at.logged().slice(-2)
    expect(order).toEqual([
      { id: 1, result: { decision: 'cancel' } },
      { id: expect.any(Number) as unknown as number, method: 'turn/interrupt', params: { threadId: 'thr_fake_1', turnId: 'turn_1' } },
    ])
    expect(at.answers()).toHaveLength(1)
  })

  it('closing answers an open approval cancel, withdraws its request, ends the events and the process', async () => {
    const at = fake('approval-interrupt')
    const session = await live(at)
    await session.handle.send(message('Clean up'))
    await eventually(() => session.asks.length === 1, 'the approval')
    session.handle.close()
    expect(session.asks[0]?.request.signal.aborted).toBe(true)
    expect(await session.ended).toBeNull()
    await eventually(() => at.spawnedChildren.every(hasExited), 'the process exited')
    expect(at.answers()).toEqual([{ id: 1, result: { decision: 'cancel' } }])
  })

  it('an unattended Session declines every approval at once, asks no one, and reports each refusal', async () => {
    const at = fake('approval')
    const session = await live(at, { unattended: true })
    await session.handle.send(message('Run the tests'))
    await session.until(isResult, 'the result')
    expect(session.asks).toEqual([])
    expect(session.refused).toEqual([
      ['pnpm test', UNATTENDED_DECLINED_MESSAGE, { reason: 'The command runs outside the sandbox.' }],
      ['/fake/project/README.md', UNATTENDED_DECLINED_MESSAGE, { reason: 'The change writes a file.' }],
    ])
    expect(at.answers()).toEqual([
      { id: 1, result: { decision: 'decline' } },
      { id: 2, result: { decision: 'decline' } },
    ])
  })

  it('withdraws a request Codex resolved itself; what it cannot read, another thread\'s turn and a request it does not answer reach the Session as unknown', async () => {
    const inject = [
      { method: 'serverRequest/resolved', params: { threadId: 'thr_fake_1', requestId: 1 } },
      'not a JSON line',
      { method: 'thread/teleported', params: { threadId: 'thr_fake_1' } },
      { method: 'turn/completed', params: { threadId: 'thr_other', turn: { id: 'turn_x', items: [], status: 'completed' } } },
      { id: 'inject-1', method: 'item/tool/requestUserInput', params: { threadId: 'thr_fake_1', turnId: 'turn_1', itemId: 'ask_1', questions: [], isBlocking: true } },
      { method: 'serverRequest/resolved', params: { threadId: 'thr_fake_1', requestId: 99 } },
    ]
    const lines = inject.map((each) => `${typeof each === 'string' ? each : JSON.stringify(each)}\n`).join('')
    const at = fake('approval-interrupt', { WORFY_TEST_INJECT_AFTER: 'item/commandExecution/requestApproval', WORFY_TEST_INJECT: lines })
    const session = await live(at)
    await session.handle.send(message('Clean up'))
    await eventually(() => session.asks.length === 1, 'the approval')
    await eventually(() => session.asks[0]?.request.signal.aborted === true, 'the request withdrawn')
    await session.until((event) => event.type === 'unknown' && event.sdkType === 'item/tool/requestUserInput', 'the request it does not answer')
    expect(session.events.filter((event) => event.type === 'unknown')).toEqual([
      { type: 'unknown', sdkType: 'not-json' },
      { type: 'unknown', sdkType: 'thread/teleported' },
      { type: 'unknown', sdkType: 'item/tool/requestUserInput' },
    ])
    expect(session.events.some(isResult)).toBe(false)
    await eventually(() => at.answers().length === 1, 'the answer to the request it does not answer')
    expect(at.answers()).toEqual([{ id: 'inject-1', error: { code: -32601, message: 'worfy does not answer item/tool/requestUserInput' } }])
    // Nothing is left to answer cancel; the fake still waits for the answer it will not get, and refuses the interrupt.
    await expect(session.handle.interrupt()).rejects.toThrow(/^Codex did not interrupt the turn: Codex app-server refused turn\/interrupt: fake app-server: waits for the answer to item\/commandExecution\/requestApproval/)
    expect(at.answers()).toHaveLength(1)
  })

  it('asks a Subagent\'s approvals with the files of its own items, and shows none of that thread\'s events', async () => {
    const at = fake('subagent-approval')
    const session = await live(at)
    await session.handle.send(message('Delegate the docs'))
    await eventually(() => session.asks.length === 1, 'the Subagent\'s approval')
    const subagent = session.asks[0] as Ask
    expect(subagent.request).toMatchObject({
      subject: '/fake/project/sub.md',
      toolName: 'fileChange',
      toolUseId: 'patch_sub_1',
      input: { changes: [{ path: '/fake/project/sub.md', kind: { type: 'add' }, diff: '+written by the Subagent\n' }] },
      description: 'The Subagent writes a file.',
    })
    subagent.answer('accept')
    await eventually(() => session.asks.length === 2, 'the approval of an item never seen')
    session.asks[1]?.answer('decline')
    await eventually(() => session.asks.length === 3, 'the second approval of an item never seen')
    session.asks[2]?.answer('decline')
    await session.until(isResult, 'the result')
    expect(session.events.filter((event) => event.type === 'result')).toHaveLength(1)
    expect(JSON.stringify(session.events)).not.toContain('patch_sub_1')
  })

  it('withdraws a Subagent\'s approval Codex resolved itself on that thread, and answers nothing', async () => {
    const resolved = `${JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'thr_sub_1', requestId: 1 } })}\n`
    const at = fake('subagent-approval', { WORFY_TEST_INJECT_AFTER: 'item/fileChange/requestApproval', WORFY_TEST_INJECT: resolved })
    const session = await live(at)
    await session.handle.send(message('Delegate the docs'))
    await eventually(() => session.asks.length === 1, 'the Subagent\'s approval')
    await eventually(() => session.asks[0]?.request.signal.aborted === true, 'the request withdrawn')
    session.asks[0]?.answer('accept')
    session.handle.close()
    expect(await session.ended).toBeNull()
    expect(at.answers()).toEqual([])
  })

  it('an approval of an item worfy never saw is offered no answer for the Session, so the gate remembers nothing that lets a later one through', async () => {
    const requests: Extract<AgentEvent, { type: 'permission_request' }>[] = []
    const gate = new PermissionGate(
      (event) => {
        if (event.type === 'permission_request') requests.push(event)
      },
      () => undefined,
    )
    const at = fake('subagent-approval')
    const session = await live(at, { permissions: gate })
    await session.handle.send(message('Delegate the docs'))
    await eventually(() => requests.length === 1, 'the Subagent\'s approval')
    expect(requests[0]?.options.map((option) => option.id)).toEqual(['accept', 'acceptForSession', 'decline', 'cancel'])
    gate.answer(requests[0]?.requestId as string, 'accept')
    await eventually(() => requests.length === 2, 'the approval of an item never seen')
    const unseen = requests[1] as (typeof requests)[number]
    expect(unseen).toMatchObject({ subject: 'file changes (item patch_unseen_1)', toolUseId: 'patch_unseen_1', input: { changes: [] } })
    expect(unseen.options.map((option) => option.id)).toEqual(['accept', 'decline', 'cancel'])
    expect(() => gate.answer(unseen.requestId, 'acceptForSession')).toThrow('This request does not offer "acceptForSession"')
    gate.answer(unseen.requestId, 'accept')
    // The next one without a name is asked, not let through.
    await eventually(() => requests.length === 3, 'the second approval of an item never seen')
    expect(requests[2]).toMatchObject({ subject: 'file changes (item patch_unseen_2)' })
    gate.answer(requests[2]?.requestId as string, 'decline')
    await session.until(isResult, 'the result')
    expect(gate.alwaysAllowed()).toEqual([])
    expect(at.answers()).toEqual([
      { id: 1, result: { decision: 'accept' } },
      { id: 2, result: { decision: 'accept' } },
      { id: 3, result: { decision: 'decline' } },
    ])
  })
})

describe('a Codex Session: the process', () => {
  it('a process that dies mid-turn ends the events with its exit code; its stderr goes to the Session, not into the error', async () => {
    const at = fake('turn', { WORFY_TEST_CRASH_ON: 'turn/start' })
    const session = await live(at)
    await session.handle.send(message('Say hello'))
    const error = await session.ended
    expect(error?.message).toBe('Codex app-server exited with code 101')
    expect(session.stderr.join('')).toContain('panic: the fake app-server crashed on turn/start')
    expect(session.events.map((event) => event.type)).toEqual(['account'])
  })

  it('a process that dies on a steer or an interrupt ends the events; neither says more than that', async () => {
    const steering = fake('steer', { WORFY_TEST_CRASH_ON: 'turn/steer' })
    const steered = await live(steering)
    await steered.handle.send(message('Fix the build'))
    await steered.until(deltaOf('Working on it'), 'the first delta')
    await steered.handle.send(message('Mind the tests'))
    expect((await steered.ended)?.message).toBe('Codex app-server exited with code 101')
    expect(steered.events.some((event) => event.type === 'notice' || event.type === 'result')).toBe(false)

    const interrupting = fake('interrupt', { WORFY_TEST_CRASH_ON: 'turn/interrupt' })
    const interrupted = await live(interrupting)
    await interrupted.handle.send(message('Do a long task'))
    await interrupted.until(deltaOf('Starting a long task'), 'the delta')
    await interrupted.handle.interrupt()
    expect((await interrupted.ended)?.message).toBe('Codex app-server exited with code 101')
  })

  it('a process that dies while an approval is open withdraws the Session\'s request', async () => {
    const at = fake('approval-interrupt')
    const session = await live(at)
    await session.handle.send(message('Clean up'))
    await eventually(() => session.asks.length === 1, 'the approval')
    at.spawnedChildren[0]?.kill('SIGKILL')
    expect((await session.ended)?.message).toBe('Codex app-server was stopped by SIGKILL')
    expect(session.asks[0]?.request.signal.aborted).toBe(true)
  })

  it('the events end only once the output of the process closed, when it closes after the exit', async () => {
    const at = fake('turn', { WORFY_TEST_CRASH_ON: 'turn/start' }, { holdClose: true })
    const session = await live(at)
    const [child, hold] = [at.spawnedChildren[0] as ChildProcess, at.holds[0] as CloseHold]
    // 100 ms after the exit: well before OUTPUT_AFTER_EXIT_MS, whose timer starts at the same exit.
    child.once('exit', () => setTimeout(() => hold.release(), 100))
    const closedAtTheEnd = session.ended.then(() => hold.closed())
    await session.handle.send(message('Say hello'))
    expect((await session.ended)?.message).toBe('Codex app-server exited with code 101')
    expect(await closedAtTheEnd).toBe(true)
  })

  it('output that never closes ends the events OUTPUT_AFTER_EXIT_MS after the exit', async () => {
    const at = fake('turn', { WORFY_TEST_CRASH_ON: 'turn/start' }, { holdClose: true })
    const session = await live(at)
    const hold = at.holds[0] as CloseHold
    const exited = new Promise<number>((resolve) => at.spawnedChildren[0]?.once('exit', () => resolve(Date.now())))
    // Taken when the events end: the send itself settles only once the app-server gave up on the output too.
    const endedAt = session.ended.then(() => Date.now())
    const sent = session.handle.send(message('Say hello'))
    expect(await within(endedAt, OUTPUT_AFTER_EXIT_MS + ms(3_000))).toBe(true)
    const waited = (await endedAt) - (await exited)
    await sent
    expect((await session.ended)?.message).toBe('Codex app-server exited with code 101')
    expect(hold.closed()).toBe(false)
    expect(waited).toBeGreaterThanOrEqual(OUTPUT_AFTER_EXIT_MS - 50)
  })

  // On Windows a child that inherits the fake's stdout does not keep the pipe open after the fake
  // exits (CI run 41546176352): the two tests above hold the end of the output there instead.
  it.skipIf(process.platform === 'win32')('what the process wrote after its exit, through a child that still holds its output, reaches the Session before the events end', async () => {
    const late = { method: 'item/agentMessage/delta', params: { threadId: 'thr_fake_1', turnId: 'turn_1', itemId: 'msg_1', delta: 'written after the exit' } }
    const at = fake('turn', { WORFY_TEST_CRASH_ON: 'turn/start', WORFY_TEST_HOLD_MS: '200', WORFY_TEST_LATE_MS: '100', WORFY_TEST_LATE_LINE: `${JSON.stringify(late)}\n` })
    const session = await live(at)
    await session.handle.send(message('Say hello'))
    expect((await session.ended)?.message).toBe('Codex app-server exited with code 101')
    expect(session.events).toContainEqual({ type: 'delta', kind: 'text', text: 'written after the exit', parentToolUseId: null })
    expect(holderOf(at.root)).not.toBeNull()
  })

  it.skipIf(process.platform === 'win32')('a child that holds the output longer ends the events about OUTPUT_AFTER_EXIT_MS after the exit, not when it lets go', async () => {
    const holdMs = OUTPUT_AFTER_EXIT_MS + ms(6_000)
    const at = fake('turn', { WORFY_TEST_CRASH_ON: 'turn/start', WORFY_TEST_HOLD_MS: String(holdMs) })
    const session = await live(at)
    const exited = new Promise<number>((resolve) => at.spawnedChildren[0]?.once('exit', () => resolve(Date.now())))
    await session.handle.send(message('Say hello'))
    const error = await session.ended
    const waited = Date.now() - (await exited)
    expect(error?.message).toBe('Codex app-server exited with code 101')
    expect(waited).toBeGreaterThanOrEqual(OUTPUT_AFTER_EXIT_MS - 50)
    expect(waited).toBeLessThan(OUTPUT_AFTER_EXIT_MS + ms(3_000))
    // The output was still held when the events ended.
    expect(alive(holderOf(at.root) as number)).toBe(true)
  })

  it('a start whose process dies in the handshake rejects with its exit code; the Session was told of the process and its stderr', async () => {
    const at = fake('turn', { WORFY_TEST_CRASH_ON: 'initialize' })
    const into = { asks: [] as Ask[], refused: [] as [string, string, RefusalDetails][], stderr: [] as string[], spawned: [] as AgentProcess[] }
    await expect(at.part.start(startOptions(at, into, {}))).rejects.toThrow(/^Codex app-server exited with code 101 before the Session started$/)
    expect(into.spawned).toEqual(at.spawnedChildren)
    expect(into.spawned).toHaveLength(1)
    expect(into.stderr.join('')).toContain('panic: the fake app-server crashed on initialize')
    expect(at.spawnedChildren.every(hasExited)).toBe(true)
  })

  it('a thread Codex cannot resume rejects the start and leaves no process', async () => {
    const home = join(mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-home-')), 'home')
    roots.push(home)
    mkdirSync(home)
    const at = fake('resume', { WORFY_CODEX_HOME: home })
    const into = { asks: [] as Ask[], refused: [] as [string, string, RefusalDetails][], stderr: [] as string[], spawned: [] as AgentProcess[] }
    await expect(at.part.resume('thr_missing', startOptions(at, into, {}))).rejects.toThrow(
      /^Codex did not start the Session: Codex app-server refused thread\/resume: no rollout found for thread id thr_missing/,
    )
    expect(into.spawned).toHaveLength(1)
    expect(at.spawnedChildren.every(hasExited)).toBe(true)
  })

  it('a permission setting Codex has no preset for refuses the start before any process', async () => {
    const at = fake('turn')
    const into = { asks: [] as Ask[], refused: [] as [string, string, RefusalDetails][], stderr: [] as string[], spawned: [] as AgentProcess[] }
    const settings = { ...DEFAULT_SETTINGS, permissionMode: 'everything' } as unknown as SessionSettings
    await expect(at.part.start(startOptions(at, into, { settings }))).rejects.toThrow('everything is no permission preset of Codex')
    expect(at.spawnedChildren).toEqual([])
  })

  it('after the close nothing more is sent: a message is dropped, a change refused, and the model list is empty', async () => {
    const at = fake('turn')
    const session = await live(at)
    session.handle.close()
    expect(await session.ended).toBeNull()
    await session.handle.send(message('Say hello'))
    await expect(session.handle.setModel('gpt-5.4')).rejects.toThrow('Codex is not running')
    await expect(session.handle.setEffort('high')).rejects.toThrow('Codex is not running')
    await expect(session.handle.setPermissionPreset('auto')).rejects.toThrow('Codex is not running')
    expect(await session.handle.models()).toEqual([])
    expect(await session.handle.commands()).toEqual([])
    await session.handle.interrupt()
    expect(at.requests('turn/start')).toEqual([])
    expect(at.requests('model/list')).toEqual([])
  })
})

describe('a Codex Session: the slash menu (worfy-multi-vendor ticket 22)', () => {
  const skillsOf = (at: Fake) => at.requests('skills/list').map((request) => request.params)

  it('lists /compact, /review and the enabled skills of skills/list; a skill call goes as a skill item in turn/start; skills/changed asks again', async () => {
    const at = fake('skills')
    const session = await live(at)
    await session.until((event) => event.type === 'account', 'account')
    const rows = await codexDriver().commands.list(session.handle)
    expect(rows).toEqual([
      { name: 'compact', description: expect.any(String) as string, argumentHint: '', kind: 'command' },
      { name: 'review', description: expect.any(String) as string, argumentHint: '[instructions]', kind: 'command' },
      { name: 'release-notes', description: 'Draft release notes', argumentHint: '', kind: 'skill' },
    ])
    expect(await session.handle.commands()).toEqual(rows)
    expect(skillsOf(at)).toEqual([{ cwds: [at.root] }])

    await session.handle.send(message('/release-notes for 1.2'))
    await session.until(isResult, 'the result')
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([
      { threadId: 'thr_fake_1', input: [text('$release-notes for 1.2'), { type: 'skill', name: 'release-notes', path: '/fake/codex-home/skills/release-notes/SKILL.md' }] },
    ])
    // skills/changed came before the turn's end: the next menu asks again, and gives no event of its own.
    expect(session.events.filter((event) => event.type === 'unknown')).toEqual([])
    expect((await session.handle.commands()).map((row) => row.name)).toEqual(['compact', 'review', 'release-notes', 'triage'])
    expect(skillsOf(at)).toHaveLength(2)
  })

  it('/compact runs thread/compact/start, and its turn ends with a result, a second one too; one refused ends with a result that says why', async () => {
    const at = fake('compact')
    const session = await live(at)
    await session.until((event) => event.type === 'account', 'account')
    await session.handle.send(message('/compact'))
    await session.until(isResult, 'the result of the compaction')
    expect(at.requests('thread/compact/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1' }])
    expect(at.requests('turn/start')).toEqual([])
    expect(at.requests('skills/list')).toEqual([])

    // Codex 0.166.0 compacts a thread with nothing new to compact too (test/fixtures/codex-messages/compact.jsonl:16).
    await session.handle.send(message('/compact'))
    await eventually(() => session.events.filter(isResult).length === 2, 'the result of the second compaction')
    expect(session.events.filter(isResult).map((event) => event.type === 'result' && event.isError)).toEqual([false, false])
    expect(at.requests('thread/compact/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1' }, { threadId: 'thr_fake_1' }])

    // A refusal (here the fake's, its script has ended) is a result that names it.
    await session.handle.send(message('/compact'))
    const refused = await session.until((event) => event.type === 'result' && event.isError, 'the refusal')
    expect(refused).toMatchObject({ type: 'result', subtype: 'error', error: expect.stringMatching(/^Codex did not run \/compact: Codex app-server refused thread\/compact\/start: fake app-server: waits for nothing: the script compact has ended/) as string })
  })

  it('/review reviews the uncommitted changes inline, and /review with text gives Codex those instructions', async () => {
    const at = fake('review')
    const session = await live(at)
    await session.until((event) => event.type === 'account', 'account')
    await session.handle.send(message('/review'))
    await session.until(isResult, 'the first review')
    await session.handle.send(message('/review focus on the tests'))
    await eventually(() => session.events.filter(isResult).length === 2, 'the second review')
    expect(at.requests('review/start').map((request) => request.params)).toEqual([
      { threadId: 'thr_fake_1', target: { type: 'uncommittedChanges' }, delivery: 'inline' },
      { threadId: 'thr_fake_1', target: { type: 'custom', instructions: 'focus on the tests' }, delivery: 'inline' },
    ])
    // Codex gives the review in its exitedReviewMode item: a text event, and the answer of the turn's result.
    expect(session.events.filter((event) => event.type === 'text').map((event) => (event as { text: string }).text)).toEqual(['No problems in the uncommitted changes.', 'The tests miss the empty case.'])
    expect(session.events.filter(isResult).map((event) => (event as { text: string | null }).text)).toEqual(['No problems in the uncommitted changes.', 'The tests miss the empty case.'])
  })

  it('/compact and /review while a turn runs give a notice and send nothing; the turn goes on', async () => {
    const at = fake('interrupt')
    const session = await live(at)
    await session.handle.send(message('Do a long task'))
    await session.until(deltaOf('Starting a long task'), 'the delta')
    await session.handle.send(message('/compact'))
    await session.handle.send(message('/review'))
    await eventually(() => session.events.filter((event) => event.type === 'notice').length === 2, 'the two notices')
    expect(session.events.filter((event) => event.type === 'notice')).toEqual([
      { type: 'notice', kind: 'notification', text: 'Codex runs /compact only between turns: send it again once this turn ends.' },
      { type: 'notice', kind: 'notification', text: 'Codex runs /review only between turns: send it again once this turn ends.' },
    ])
    expect(at.requests('thread/compact/start')).toEqual([])
    expect(at.requests('review/start')).toEqual([])
    expect(at.requests('turn/steer')).toEqual([])
    expect(session.events.some(isResult)).toBe(false)
    await session.handle.interrupt()
    await session.until(isResult, 'the result')
  })

  it('the menu is /compact and /review alone when Codex cannot list its skills, and asks again next time', async () => {
    // The turn script answers no skills/list: the fake refuses it.
    const at = fake('turn')
    const session = await live(at)
    await session.until((event) => event.type === 'account', 'account')
    const rows = await session.handle.commands()
    expect(rows.map((row) => `${row.kind}:${row.name}`)).toEqual(['command:compact', 'command:review'])
    await session.handle.commands()
    expect(at.requests('skills/list')).toHaveLength(2)
  })

  it('a /name that is no command and no skill goes as the text typed', async () => {
    const at = fake('turn')
    const session = await live(at)
    await session.until((event) => event.type === 'account', 'account')
    await session.handle.send(message('/model gpt-5'))
    // The turn script answers no skills/list: the message goes as typed all the same.
    await session.until(isResult, 'the result')
    expect(at.requests('turn/start').map((request) => request.params)).toEqual([{ threadId: 'thr_fake_1', input: [text('/model gpt-5')] }])
  })
})
