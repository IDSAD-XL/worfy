// The SessionHandle of the Codex driver (src/main/vendors/codex/session.ts, worfy-multi-vendor ticket 20)
// on the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets): a turn, steer during a
// turn, Interrupt, resume, the model, effort and preset of the next turn, approvals and their answers,
// an unattended Session, a crash, and starts that fail without leaving a process. What worfy sent is
// read from the fake's log (WORFY_CODEX_LOG).
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of the session
// part, as in test/contract/codex-app-server.test.ts. A preload module of the test's own (`--import`)
// stops the fake with exit code 101 when worfy sends the method WORFY_TEST_CRASH_ON, and writes the
// lines WORFY_TEST_INJECT to its stdout right after the fake wrote a message of the method
// WORFY_TEST_INJECT_AFTER: what no script can play — a request Codex resolves itself, a line that is
// not JSON, a method the schema does not know, a notification of another thread.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS, type SessionSettings } from '../../src/shared/agent/settings'
import { hasExited } from '../../src/main/agent/session/process'
import type { AgentProcess, PermissionAsk, RefusalDetails, SessionHandle, SessionPart, SessionStart } from '../../src/main/vendors/session'
import { UNATTENDED_DECLINED_MESSAGE } from '../../src/main/vendors/codex/approvals'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { CODEX_CAPABILITIES, codexCapabilities } from '../../src/main/vendors/codex/capabilities'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

/** How long the fake may take to send what a test waits for. */
const ANSWER_MS = ms(10_000)

const PRELOAD = `import process from 'node:process'
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
  for (const root of roots.splice(0)) removeTestTree(root)
})

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

/** A session part over the fake playing `script`, and what a test looks at. */
interface Fake {
  part: SessionPart
  root: string
  log: string
  spawnedChildren: ChildProcess[]
  /** What worfy sent the fake so far. */
  logged: () => Logged[]
  requests: (method: string) => Logged[]
  /** The answers worfy gave to the fake's requests. */
  answers: () => Logged[]
}

function fake(script: string, env: Record<string, string> = {}): Fake {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-session-'))
  roots.push(root)
  const log = join(root, 'codex.log')
  const preload = join(root, 'preload.mjs')
  writeFileSync(preload, PRELOAD)
  const spawnedChildren: ChildProcess[] = []
  const spawnProcess = (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), ['--import', pathToFileURL(preload).href, ...args], options)
    children.push(child)
    spawnedChildren.push(child)
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
}

/** What a Session gives its driver, with every call recorded in `into`. */
function startOptions(at: Fake, into: Pick<Live, 'asks' | 'refused' | 'stderr' | 'spawned'>, options: Options): SessionStart {
  return {
    cwd: at.root,
    settings: options.settings ?? DEFAULT_SETTINGS,
    unattended: options.unattended ?? false,
    orchestrator: false,
    permissions: {
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
      { value: null, displayName: 'Default (GPT-5.5 Codex)', efforts: ['low', 'medium', 'high', 'xhigh'] },
      { value: 'gpt-5.5-codex', displayName: 'GPT-5.5 Codex', efforts: ['low', 'medium', 'high', 'xhigh'] },
      { value: 'gpt-5.4', displayName: 'GPT-5.4', efforts: ['low', 'medium', 'high'] },
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
