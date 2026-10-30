// The assist process of Terminal AI (src/main/terminal-ai/assist.ts) over a fake Agent SDK and fake
// clocks: when processes start and close, the queue of requests, timeouts and refusals, the Limits
// it feeds and obeys, the file fake of WORFY_AGENT=fake, and the `terminalAi` channels.
//
// No test here starts Claude Code or asks a model: the SDK is a fake passed in, the module itself is
// mocked so that any call to it fails the test, and the real backend refuses to start under vitest.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaimOptions, Options } from '@anthropic-ai/claude-agent-sdk'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitsTracker } from '../../src/main/agent/limits'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { terminalAiHandlers } from '../../src/main/ipc/terminal-ai'
import { AssistService, IDLE_MS, backendFromEnv, commandOf, realBackend, sdkBackend, type AssistAnswer, type AssistQuery, type AssistSdk } from '../../src/main/terminal-ai/assist'
import type { FakeLogEntry } from '../../src/main/terminal-ai/fake-backend'
import { gitBranch } from '../../src/main/terminal-ai/git-branch'
import { TerminalAiSettingsStore } from '../../src/main/terminal-ai/settings'
import type { LimitWindowState } from '../../src/shared/agent/limits'
import { accessOf, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { TerminalAiState } from '../../src/shared/ipc/terminal-ai'
import type { TerminalAiInput } from '../../src/shared/terminal-ai/context'
import { REDACTED } from '../../src/shared/terminal-ai/redact'
import type { TerminalAiFeature } from '../../src/shared/terminal-ai/settings'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

// The real SDK module, replaced: a test that reached it would fail here instead of starting Claude Code.
const sdkModule = vi.hoisted(() => ({ loaded: 0 }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  sdkModule.loaded++
  const refuse = (): never => {
    throw new Error('a test reached the real Agent SDK')
  }
  return { prewarm: vi.fn(refuse), query: vi.fn(refuse), startup: vi.fn(refuse) }
})

const NOW = Date.UTC(2026, 9, 10, 12, 0)

// ---- the fake SDK ----------------------------------------------------------------------------------

/** A Query the test feeds: push() a message, end() the stream; close() ends it as Claude Code exiting would. */
class FakeQuery implements AssistQuery {
  closed = false
  private readonly queue: unknown[] = []
  private ended = false
  private wake: (() => void) | null = null

  constructor(
    readonly prompt: string,
    readonly options: ClaimOptions | Options,
  ) {}

  push(...messages: unknown[]): void {
    this.queue.push(...messages)
    this.wake?.()
  }

  end(): void {
    this.ended = true
    this.wake?.()
  }

  /** The model answers `text` and the turn ends. */
  answer(text: string): void {
    this.push(
      { type: 'system', subtype: 'init', claude_code_version: '2.1.289', apiKeySource: 'none', model: 'claude-haiku-4-5', plugins: [{ name: 'builtin-a', path: '/x' }] },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } },
      { type: 'result', subtype: 'success', is_error: false, result: text },
    )
    this.end()
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
    for (;;) {
      if (this.closed) return
      const next = this.queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (this.ended) return
      await new Promise<void>((resolve) => (this.wake = resolve))
      this.wake = null
    }
  }
}

class FakeSpare {
  closed = false
  query: FakeQuery | null = null
  claimed: Promise<unknown>
  exited: Promise<void>
  resolveClaim!: () => void
  rejectClaim!: (error: Error) => void
  private exit!: () => void

  constructor(readonly options: Options) {
    this.claimed = new Promise((resolve, reject) => {
      this.resolveClaim = () => resolve({ cwd: '', sessionId: 's' })
      this.rejectClaim = reject
    })
    this.exited = new Promise((resolve) => (this.exit = resolve))
  }

  claim(params: { prompt: string; options: ClaimOptions }): FakeQuery {
    if (this.query !== null) throw new Error('claimed twice')
    // As the SDK's claim() does on a spare that is gone.
    if (this.closed) throw new Error('spare_exited: the spare process has exited')
    this.query = new FakeQuery(params.prompt, params.options)
    return this.query
  }

  close(): void {
    if (!this.closed) this.rejectClaim(new Error('spare_closed'))
    this.closed = true
    this.query?.close()
    this.exit()
  }
}

class FakeSdk implements AssistSdk {
  readonly spares: FakeSpare[] = []
  readonly queries: FakeQuery[] = []
  /** While set, a new spare does not finish starting until release() is called. */
  hold = false
  private held: (() => void)[] = []

  async prewarm(params?: { options?: Options }): Promise<FakeSpare> {
    const spare = new FakeSpare(params?.options ?? {})
    this.spares.push(spare)
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve))
    return spare
  }

  release(): void {
    this.hold = false
    for (const resolve of this.held.splice(0)) resolve()
  }

  query(params: { prompt: string; options?: Options }): FakeQuery {
    const query = new FakeQuery(params.prompt, params.options ?? {})
    this.queries.push(query)
    return query
  }

  /** The spare the last claim went to. */
  get claimedSpare(): FakeSpare {
    const spare = this.spares.findLast((candidate) => candidate.query !== null)
    if (spare === undefined) throw new Error('nothing was claimed')
    return spare
  }
}

// ---- the world of one test -------------------------------------------------------------------------

let scratch: string
let dataDir: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-terminal-ai-')))
  dataDir = join(scratch, 'data')
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  removeTestTree(scratch)
})

/** Lets every pending promise and the timers due by now run. */
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

interface World {
  service: AssistService
  sdk: FakeSdk
  limits: LimitsTracker
  log: string[]
}

function world(sdk = new FakeSdk(), branchOf: (cwd: string) => Promise<string | null> = async () => 'main'): World {
  const limits = new LimitsTracker({ dataDir, now: () => Date.now() })
  const log: string[] = []
  const service = new AssistService({
    backend: async () => sdkBackend(sdk),
    prewarmOptions: async () => ({ settingSources: [], tools: [], env: {} }),
    settings: new TerminalAiSettingsStore(dataDir),
    limits,
    dataDir,
    branchOf,
    log: (line) => log.push(line),
  })
  return { service, sdk, limits, log }
}

function input(over: Partial<TerminalAiInput> = {}): TerminalAiInput {
  return { line: 'git st', cwd: '/Users/me/work', commands: ['ls'], exitCode: 0, commandRunning: false, alternateScreen: false, ...over }
}

/** Starts a request and lets it reach the SDK. The answer is wrapped: an async function would wait for it. */
async function start(service: AssistService, feature: TerminalAiFeature, over: Partial<TerminalAiInput> = {}): Promise<{ answer: Promise<AssistAnswer> }> {
  const answer = service.request(feature, input(over))
  await settle()
  return { answer }
}

const limitWindow = (over: Partial<LimitWindowState>): LimitWindowState => ({ utilization: 0.1, resetsAt: NOW / 1000 + 3600, status: 'allowed', receivedAt: NOW, source: 'sdk', ...over })

// ---- the process -----------------------------------------------------------------------------------

describe('the assist process', () => {
  it('starts with the first request, not before', async () => {
    const { service, sdk } = world()
    expect(sdk.spares).toHaveLength(0)
    expect(service.state().process).toBe('idle')

    const { answer } = await start(service, 'suggest')
    expect(sdk.spares).toHaveLength(1)
    expect(service.state().process).toBe('busy')
    const spare = sdk.claimedSpare
    expect(spare).toBe(sdk.spares[0])
    expect(spare.query?.options).toMatchObject({ cwd: join(dataDir, 'terminal-ai'), model: 'haiku', maxThinkingTokens: 0 })
    spare.query?.answer('git status')
    expect(await answer).toEqual({ ok: true, command: 'git status', model: 'haiku' })
  })

  it('closes the process after the answer and starts the next spare at once', async () => {
    const { service, sdk } = world()
    const { answer } = await start(service, 'next', { line: '' })
    sdk.claimedSpare.query?.answer('git push')
    await answer
    await settle()
    expect(sdk.spares).toHaveLength(2)
    expect(sdk.spares[0]?.closed).toBe(true)
    expect(sdk.spares[1]?.closed).toBe(false)
    expect(sdk.spares[1]?.query).toBeNull()
    expect(service.state().process).toBe('warm')
  })

  it('makes a request that comes while the spare starts wait for it, with no second process', async () => {
    const { service, sdk } = world()
    sdk.hold = true
    const answer = service.request('fix', input({ exitCode: 1, output: ['boom'] }))
    await settle()
    expect(sdk.spares).toHaveLength(1)
    expect(sdk.spares[0]?.query).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(sdk.spares).toHaveLength(1)
    sdk.release()
    await settle()
    expect(sdk.spares).toHaveLength(1)
    expect(sdk.spares[0]?.query).not.toBeNull()
    sdk.spares[0]?.query?.answer('make test')
    expect(await answer).toMatchObject({ ok: true, command: 'make test' })
  })

  it('makes a request that comes while the next spare starts wait for that one', async () => {
    const { service, sdk } = world()
    const { answer: first } = await start(service, 'request', { request: 'list files' })
    sdk.hold = true
    sdk.claimedSpare.query?.answer('ls')
    await first
    await settle()
    expect(sdk.spares).toHaveLength(2) // the next one, still starting
    const second = service.request('request', input({ request: 'disk usage' }))
    await settle()
    expect(sdk.spares).toHaveLength(2)
    sdk.release()
    await settle()
    expect(sdk.spares).toHaveLength(2)
    sdk.spares[1]?.query?.answer('du -sh .')
    expect(await second).toMatchObject({ ok: true, command: 'du -sh .' })
  })

  it('closes a spare left without requests for 10 minutes', async () => {
    const { service, sdk } = world()
    const { answer } = await start(service, 'suggest')
    sdk.claimedSpare.query?.answer('git status')
    await answer
    await settle()
    const spare = sdk.spares[1]
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000)
    expect(spare?.closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(spare?.closed).toBe(true)
    expect(sdk.spares).toHaveLength(2)
    expect(service.state().process).toBe('idle')
  })

  it('cuts the answer to one command: backticks, a code block and an explanation go', async () => {
    const { service, sdk } = world()
    const { answer } = await start(service, 'request', { request: 'status' })
    sdk.claimedSpare.query?.answer('`git status`')
    expect(await answer).toEqual({ ok: true, command: 'git status', model: 'sonnet' })
    expect(commandOf('```bash\ngit log --oneline\n```\nThis shows the log.')).toBe('git log --oneline')
    expect(commandOf('ls -la\nLists every file.')).toBe('ls -la')
    expect(commandOf('$ make')).toBe('make')
    expect(commandOf('\n\n')).toBe('')
  })

  it('logs the process and the model, never the request, the context or the answer', async () => {
    const { service, sdk, log } = world()
    const { answer } = await start(service, 'suggest', { line: 'git sta', cwd: '/Users/me/secret-project' })
    sdk.claimedSpare.query?.push({ type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'builtin-a:remind', hook_event: 'UserPromptSubmit' })
    sdk.claimedSpare.query?.answer('git stash')
    await answer
    expect(log).toContain('[terminal-ai] assist process ran a hook: UserPromptSubmit builtin-a:remind')
    expect(log).toContain('[terminal-ai] suggest: model haiku')
    expect(log).toContain('[terminal-ai] assist process: Claude Code 2.1.289, apiKeySource none, model claude-haiku-4-5, plugins: builtin-a; hooks: not reported by init')
    const text = log.join('\n')
    expect(text).not.toContain('git sta')
    expect(text).not.toContain('secret-project')
    expect(text).not.toContain('git stash')
  })
})

// ---- the queue -------------------------------------------------------------------------------------

describe('the queue', () => {
  it('cancels a Suggestion in flight on a new one: its process is closed, the next spare serves the new one', async () => {
    const { service, sdk } = world()
    const { answer: first } = await start(service, 'suggest', { line: 'git s' })
    const firstSpare = sdk.claimedSpare
    const { answer: second } = await start(service, 'suggest', { line: 'git st' })
    expect(await first).toEqual({ ok: false, reason: 'cancelled' })
    expect(firstSpare.closed).toBe(true)
    expect(firstSpare.query?.closed).toBe(true)
    expect(sdk.spares).toHaveLength(2)
    const secondSpare = sdk.claimedSpare
    expect(secondSpare).toBe(sdk.spares[1])
    expect(secondSpare.query?.prompt).toContain('Typed so far: git st')
    secondSpare.query?.answer('git status')
    expect(await second).toMatchObject({ ok: true, command: 'git status' })
  })

  it('cancels a Next command in flight on a Fix', async () => {
    const { service, sdk } = world()
    const { answer: next } = await start(service, 'next', { line: '' })
    const nextSpare = sdk.claimedSpare
    const { answer: fix } = await start(service, 'fix', { exitCode: 2, output: ['error'] })
    expect(await next).toEqual({ ok: false, reason: 'cancelled' })
    expect(nextSpare.closed).toBe(true)
    sdk.claimedSpare.query?.answer('npm ci')
    expect(await fix).toMatchObject({ ok: true, command: 'npm ci' })
  })

  it('does not cancel a Fix for a Next command, and makes the next on-demand request wait', async () => {
    const { service, sdk } = world()
    const { answer: fix } = await start(service, 'fix', { exitCode: 2, output: ['error'] })
    const fixSpare = sdk.claimedSpare
    expect(await service.request('next', input({ line: '' }))).toEqual({ ok: false, reason: 'busy' })
    expect(fixSpare.closed).toBe(false)

    const { answer: request } = await start(service, 'request', { request: 'list' })
    expect(sdk.spares.filter((spare) => spare.query !== null)).toHaveLength(1)
    fixSpare.query?.answer('npm ci')
    expect(await fix).toMatchObject({ ok: true, command: 'npm ci' })
    await settle()
    expect(sdk.claimedSpare).not.toBe(fixSpare)
    sdk.claimedSpare.query?.answer('ls')
    expect(await request).toMatchObject({ ok: true, command: 'ls' })
  })

  it('cancels a Suggestion that waits for the starting spare on a new one, which then gets that spare', async () => {
    const { service, sdk } = world()
    sdk.hold = true
    const { answer: first } = await start(service, 'suggest', { line: 'git s' })
    const { answer: second } = await start(service, 'suggest', { line: 'git st' })
    expect(await first).toEqual({ ok: false, reason: 'cancelled' })
    sdk.release()
    await settle()
    expect(sdk.spares).toHaveLength(1)
    expect(sdk.spares[0]?.query?.prompt).toContain('Typed so far: git st')
    sdk.spares[0]?.query?.answer('git status')
    expect(await second).toMatchObject({ ok: true, command: 'git status' })
  })

  it('lets an on-demand request that waits in the queue leave it when its caller gives up', async () => {
    const { service, sdk } = world()
    const { answer: fix } = await start(service, 'fix', { exitCode: 1 })
    const controller = new AbortController()
    const waiting = service.request('request', input({ request: 'x' }), controller.signal)
    await settle()
    controller.abort()
    expect(await waiting).toEqual({ ok: false, reason: 'cancelled' })
    // The Fix in flight is untouched, and an automatic request is no longer held back by the waiter.
    expect(sdk.claimedSpare.closed).toBe(false)
    sdk.claimedSpare.query?.answer('make')
    expect(await fix).toMatchObject({ ok: true, command: 'make' })
  })

  it('cancels a request whose caller gives up', async () => {
    const { service, sdk } = world()
    const controller = new AbortController()
    const answer = service.request('request', input({ request: 'x' }), controller.signal)
    await settle()
    controller.abort()
    expect(await answer).toEqual({ ok: false, reason: 'cancelled' })
    expect(sdk.spares[0]?.closed).toBe(true)
  })
})

// ---- ends in flight ----------------------------------------------------------------------------------

describe('a request in flight', () => {
  it('cancels a Suggestion after 5 s without an answer and closes its process', async () => {
    const { service, sdk } = world()
    const { answer } = await start(service, 'suggest')
    await vi.advanceTimersByTimeAsync(4999)
    expect(sdk.claimedSpare.closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await answer).toEqual({ ok: false, reason: 'timeout' })
    expect(sdk.spares[0]?.closed).toBe(true)
  })

  it('cancels a Suggestion whose stream starts with thinking, and takes a Next command that thinks', async () => {
    const thinking = { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } }
    const { service, sdk } = world()
    const { answer: suggest } = await start(service, 'suggest')
    sdk.claimedSpare.query?.push(thinking)
    expect(await suggest).toEqual({ ok: false, reason: 'thinking' })
    expect(sdk.spares[0]?.closed).toBe(true)

    const { answer: next } = await start(service, 'next', { line: '' })
    sdk.claimedSpare.query?.push(thinking)
    sdk.claimedSpare.query?.answer('git push')
    expect(await next).toMatchObject({ ok: true, command: 'git push' })
  })

  it('cancels a Suggestion on option_not_applied, and takes the answer of a Fix with a line in the log', async () => {
    const { service, sdk, log } = world()
    const { answer: suggest } = await start(service, 'suggest')
    sdk.claimedSpare.rejectClaim(new Error('option_not_applied: maxThinkingTokens'))
    expect(await suggest).toEqual({ ok: false, reason: 'option-not-applied' })
    expect(sdk.spares[0]?.closed).toBe(true)

    const { answer: fix } = await start(service, 'fix', { exitCode: 1 })
    sdk.claimedSpare.rejectClaim(new Error('option_not_applied: model'))
    await settle()
    sdk.claimedSpare.query?.answer('make')
    expect(await fix).toMatchObject({ ok: true, command: 'make' })
    expect(log).toContain('[terminal-ai] fix: option_not_applied; the answer is taken')
  })

  it('retries a Fix once with a cold query() when the claim is refused before the prompt went out', async () => {
    const { service, sdk } = world()
    const { answer: fix } = await start(service, 'fix', { exitCode: 1, output: ['boom'] })
    const spare = sdk.claimedSpare
    spare.rejectClaim(new Error('settings_not_applied: effortLevel'))
    await settle()
    expect(spare.closed).toBe(true)
    expect(sdk.queries).toHaveLength(1)
    const cold = sdk.queries[0]
    expect(cold?.options).toMatchObject({ cwd: join(dataDir, 'terminal-ai'), model: 'sonnet', effort: 'low', settingSources: [], tools: [] })
    expect(cold?.prompt).toBe(spare.query?.prompt)
    cold?.answer('make test')
    expect(await fix).toMatchObject({ ok: true, command: 'make test' })
  })

  it('retries a Fix with a cold query() when its spare exits between being taken and the claim', async () => {
    let giveBranch: (branch: string | null) => void = () => undefined
    const { service, sdk } = world(new FakeSdk(), () => new Promise((resolve) => (giveBranch = resolve)))
    const { answer: fix } = await start(service, 'fix', { exitCode: 1, branch: undefined })
    const spare = sdk.spares[0]
    expect(spare?.query).toBeNull() // taken, waiting for the git branch
    spare?.close() // the parked process dies meanwhile
    giveBranch('main')
    await settle()
    expect(sdk.queries).toHaveLength(1)
    expect(sdk.queries[0]?.prompt).toContain('Git branch: main')
    sdk.queries[0]?.answer('make')
    expect(await fix).toMatchObject({ ok: true, command: 'make' })
  })

  it('refuses a Next command at once when the claim is refused, without a retry or waiting for the timeout', async () => {
    const { service, sdk } = world()
    const { answer: next } = await start(service, 'next', { line: '' })
    sdk.claimedSpare.rejectClaim(new Error('settings_not_applied: effortLevel'))
    await settle()
    // No timer advanced: the refusal is already the answer.
    expect(await next).toEqual({ ok: false, reason: 'not-claimed', detail: 'settings_not_applied' })
    expect(sdk.queries).toHaveLength(0)
  })

  it('does not retry a cold query twice: a refused Fix whose cold query fails is a failure', async () => {
    const { service, sdk } = world()
    const { answer: fix } = await start(service, 'fix', { exitCode: 1 })
    sdk.claimedSpare.rejectClaim(new Error('spare_exited'))
    await settle()
    sdk.queries[0]?.push({ type: 'result', subtype: 'error_during_execution', is_error: true })
    sdk.queries[0]?.end()
    expect(await fix).toEqual({ ok: false, reason: 'failed', detail: 'error_during_execution' })
    expect(sdk.queries).toHaveLength(1)
  })
})

// ---- Limits, settings, refusals before the SDK -----------------------------------------------------

describe('Limits and refusals', () => {
  it('feeds the Limits with the rate_limit_event of a request', async () => {
    const { service, sdk, limits } = world()
    const { answer } = await start(service, 'next', { line: '' })
    sdk.claimedSpare.query?.push({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.42, resetsAt: NOW / 1000 + 7200 },
    })
    sdk.claimedSpare.query?.answer('git push')
    await answer
    expect(limits.snapshot().windows.five_hour).toMatchObject({ utilization: 0.42, status: 'allowed', resetsAt: NOW / 1000 + 7200, source: 'sdk' })
  })

  it('sends nothing to the SDK on rejected', async () => {
    const { service, sdk, limits } = world()
    limits.record([{ window: 'five_hour', state: limitWindow({ status: 'rejected' }) }])
    for (const feature of ['suggest', 'next', 'request', 'fix'] as const) {
      expect(await service.request(feature, input({ request: 'x' }))).toEqual({ ok: false, reason: 'limits', until: (NOW / 1000 + 3600) * 1000 })
    }
    expect(sdk.spares).toHaveLength(0)
    expect(sdk.queries).toHaveLength(0)
  })

  it('sends nothing while a command runs or a full-screen program holds the Terminal, nor a Suggestion of a line that starts with a space', async () => {
    const { service, sdk } = world()
    expect(await service.request('fix', input({ commandRunning: true }))).toEqual({ ok: false, reason: 'command-running' })
    expect(await service.request('next', input({ alternateScreen: true }))).toEqual({ ok: false, reason: 'alternate-screen' })
    expect(await service.request('suggest', input({ line: ' mysql -p' }))).toEqual({ ok: false, reason: 'private-line' })
    expect(sdk.spares).toHaveLength(0)
  })

  it('refuses a feature turned off in Settings with the reason off', async () => {
    const { service, sdk } = world()
    service.setSettings({ fix: false })
    expect(await service.request('fix', input())).toEqual({ ok: false, reason: 'off' })
    service.setSettings({ fix: true, enabled: false })
    expect(await service.request('fix', input())).toEqual({ ok: false, reason: 'off' })
    service.setSettings({ enabled: true, suggestionAsksModel: false })
    expect(await service.request('suggest', input())).toEqual({ ok: false, reason: 'off' })
    expect(sdk.spares).toHaveLength(0)
    expect(service.state().features).toEqual({ suggest: { state: 'off' }, next: { state: 'on' }, request: { state: 'on' }, fix: { state: 'on' } })
  })

  it('asks Haiku for Next command when Settings say so', async () => {
    const { service, sdk } = world()
    service.setSettings({ nextCommandModel: 'haiku' })
    const { answer: next } = await start(service, 'next', { line: '' })
    expect(sdk.claimedSpare.query?.options).toMatchObject({ model: 'haiku', maxThinkingTokens: 0 })
    sdk.claimedSpare.query?.answer('ls')
    expect(await next).toEqual({ ok: true, command: 'ls', model: 'haiku' })
  })

  it('lifts a Limits pause at the reset time by itself: terminalAi.changed with on, without a new request', async () => {
    const { service, limits } = world()
    const window = new FakeWindow()
    const call = await registered(service)
    await call('terminalAi.state', undefined, window)
    limits.record([{ window: 'five_hour', state: limitWindow({ utilization: 0.95, resetsAt: NOW / 1000 + 60 }) }])
    await settle()
    const paused = window.lastState()
    expect(paused.features.suggest).toEqual({ state: 'paused', until: NOW + 60_000, window: 'five_hour' })
    expect(paused.features.fix).toEqual({ state: 'on' })

    const sent = window.sent.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(window.sent.length).toBeGreaterThan(sent)
    expect(window.lastState().features.suggest).toEqual({ state: 'on' })
    expect(window.lastState().features.next).toEqual({ state: 'on' })
  })
})

// ---- races and shutdown ----------------------------------------------------------------------------

describe('races and shutdown', () => {
  it('drops a spare that dies while parked: the state turns idle and the next request starts a new process', async () => {
    const { service, sdk } = world()
    const { answer: first } = await start(service, 'next', { line: '' })
    sdk.claimedSpare.query?.answer('ls')
    await first
    await settle()
    const parked = sdk.spares[1]
    expect(service.state().process).toBe('warm')
    parked?.close() // the parked process dies on its own
    await settle()
    expect(service.state().process).toBe('idle')

    const { answer: second } = await start(service, 'suggest')
    expect(sdk.spares).toHaveLength(3)
    expect(sdk.claimedSpare).toBe(sdk.spares[2])
    sdk.claimedSpare.query?.answer('git status')
    expect(await second).toMatchObject({ ok: true, command: 'git status' })
  })

  it('re-checks the Limits after the queue: a Fix waiting behind a Fix that brought rejected does not reach the SDK', async () => {
    const { service, sdk } = world()
    const { answer: first } = await start(service, 'fix', { exitCode: 1 })
    const { answer: second } = await start(service, 'fix', { exitCode: 2 })
    sdk.claimedSpare.query?.push({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: NOW / 1000 + 600 } })
    sdk.claimedSpare.query?.answer('make')
    expect(await first).toMatchObject({ ok: true, command: 'make' })
    expect(await second).toEqual({ ok: false, reason: 'limits', until: NOW + 600_000 })
    await settle()
    expect(sdk.spares.filter((spare) => spare.query !== null)).toHaveLength(1)
    expect(sdk.queries).toHaveLength(0)
  })

  it('re-checks the Settings after the queue: a Fix turned off while it waits does not reach the SDK', async () => {
    const { service, sdk } = world()
    const { answer: first } = await start(service, 'fix', { exitCode: 1 })
    const { answer: second } = await start(service, 'fix', { exitCode: 2 })
    service.setSettings({ fix: false })
    sdk.claimedSpare.query?.answer('make')
    await first
    expect(await second).toEqual({ ok: false, reason: 'off' })
    await settle()
    expect(sdk.spares.filter((spare) => spare.query !== null)).toHaveLength(1)
  })

  it('keeps the spare a cancelled Suggestion was waiting for, and closes it after 10 idle minutes', async () => {
    const { service, sdk } = world()
    sdk.hold = true
    const controller = new AbortController()
    const answer = service.request('suggest', input(), controller.signal)
    await settle()
    controller.abort()
    expect(await answer).toEqual({ ok: false, reason: 'cancelled' })
    sdk.release()
    await settle()
    expect(sdk.spares).toHaveLength(1)
    const spare = sdk.spares[0]
    expect(spare?.query).toBeNull()
    expect(spare?.closed).toBe(false)
    expect(service.state().process).toBe('warm')
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(spare?.closed).toBe(true)
    expect(service.state().process).toBe('idle')
  })

  it('starts nothing for a caller that already gave up', async () => {
    const { service, sdk } = world()
    const controller = new AbortController()
    controller.abort()
    for (const feature of ['suggest', 'fix'] as const) expect(await service.request(feature, input(), controller.signal)).toEqual({ ok: false, reason: 'cancelled' })
    await settle()
    expect(sdk.spares).toHaveLength(0)
  })

  it('stops before claim() when the caller gives up while the git branch is read', async () => {
    let giveBranch: (branch: string | null) => void = () => undefined
    const { service, sdk } = world(new FakeSdk(), () => new Promise((resolve) => (giveBranch = resolve)))
    const controller = new AbortController()
    const answer = service.request('request', input({ request: 'x', branch: undefined }), controller.signal)
    await settle()
    const spare = sdk.spares[0]
    expect(spare?.query).toBeNull() // taken, waiting for the branch
    controller.abort()
    giveBranch('main')
    expect(await answer).toEqual({ ok: false, reason: 'cancelled' })
    expect(spare?.query).toBeNull()
    expect(spare?.closed).toBe(true)
    expect(sdk.queries).toHaveLength(0)
  })

  it('closes the parked spare on dispose()', async () => {
    const { service, sdk } = world()
    const { answer } = await start(service, 'next', { line: '' })
    sdk.claimedSpare.query?.answer('ls')
    await answer
    await settle()
    const parked = sdk.spares[1]
    expect(parked?.closed).toBe(false)
    service.dispose()
    expect(parked?.closed).toBe(true)
    expect(await service.request('fix', input())).toEqual({ ok: false, reason: 'cancelled' })
    await settle()
    expect(sdk.spares).toHaveLength(2)
  })

  it('closes a process that finishes starting after dispose(), and the request in flight', async () => {
    const { service, sdk } = world()
    sdk.hold = true
    const answer = service.request('fix', input({ exitCode: 1 }))
    await settle()
    service.dispose()
    expect(await answer).toEqual({ ok: false, reason: 'cancelled' })
    sdk.release()
    await settle()
    expect(sdk.spares).toHaveLength(1)
    expect(sdk.spares[0]?.closed).toBe(true)
    expect(sdk.spares[0]?.query).toBeNull()
  })

  it('closes a spare handed out just before a cancel, and keeps one a cancel finds still in the slot', async () => {
    // The cancel walks microtask by microtask from the spare finishing its start to the claim. Each
    // landing has one of three outcomes, in this order: the spare is still in the slot and stays
    // for the next request ('kept'); take() already handed it out, so it is closed unclaimed and a
    // new spare is parked ('orphan'); it was claimed, so the flight closes it ('claimed').
    type Outcome = 'kept' | 'orphan' | 'claimed' | 'other'
    const outcomes: Outcome[] = []
    for (let ticks = 0; !outcomes.includes('claimed') && ticks < 100; ticks++) {
      const { service, sdk } = world()
      sdk.hold = true
      const controller = new AbortController()
      const answer = service.request('request', input({ request: 'x' }), controller.signal)
      await settle()
      sdk.release()
      for (let tick = 0; tick < ticks; tick++) await Promise.resolve()
      controller.abort()
      expect(await answer).toEqual({ ok: false, reason: 'cancelled' })
      await settle()
      const [first, second, ...rest] = sdk.spares
      const parked = (spare: FakeSpare | undefined): boolean => spare !== undefined && !spare.closed && spare.query === null
      outcomes.push(
        rest.length > 0 || first === undefined
          ? 'other'
          : second === undefined
            ? parked(first) ? 'kept' : 'other'
            : !parked(second) || !first.closed
              ? 'other'
              : first.query === null ? 'orphan' : 'claimed',
      )
      // In every outcome the one live spare is parked in the slot, so dispose() reaches it.
      service.dispose()
      expect(sdk.spares.filter((spare) => !spare.closed)).toEqual([])
    }
    // Every landing has a known outcome; each outcome happens, the orphan window included.
    expect(outcomes.join(' ')).toMatch(/^(kept )+(orphan )+claimed$/)
  })

  it('leaves at most the spare alive after Suggestions with cancels, Next command, Command request and Fix, none after IDLE_MS or dispose()', async () => {
    const { service, sdk } = world()
    const alive = (): number => sdk.spares.filter((spare) => !spare.closed).length

    // Suggestions, each cancelled by the next one; the last one answers.
    const first = await start(service, 'suggest', { line: 'g' })
    const second = await start(service, 'suggest', { line: 'gi' })
    const third = await start(service, 'suggest', { line: 'git' })
    sdk.claimedSpare.query?.answer('git status')
    expect(await first.answer).toEqual({ ok: false, reason: 'cancelled' })
    expect(await second.answer).toEqual({ ok: false, reason: 'cancelled' })
    expect(await third.answer).toMatchObject({ ok: true })
    await settle()

    // A Suggestion its caller cancels while it flies.
    const controller = new AbortController()
    const dropped = service.request('suggest', input({ line: 'np' }), controller.signal)
    await settle()
    controller.abort()
    expect(await dropped).toEqual({ ok: false, reason: 'cancelled' })
    await settle()

    const onDemand: [TerminalAiFeature, Partial<TerminalAiInput>, string][] = [
      ['next', { line: '' }, 'git push'],
      ['request', { request: 'list files' }, 'ls'],
      ['fix', { exitCode: 1, output: ['boom'] }, 'make'],
    ]
    for (const [feature, over, text] of onDemand) {
      const { answer } = await start(service, feature, over)
      sdk.claimedSpare.query?.answer(text)
      expect(await answer).toMatchObject({ ok: true, command: text })
      await settle()
    }
    expect(service.state().process).toBe('warm')
    expect(alive()).toBe(1)

    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(alive()).toBe(0)
    expect(service.state().process).toBe('idle')

    // A new request after the idle close starts one spare again; dispose() closes it.
    const { answer } = await start(service, 'next', { line: '' })
    sdk.claimedSpare.query?.answer('ls')
    await answer
    await settle()
    expect(alive()).toBe(1)
    service.dispose()
    expect(alive()).toBe(0)
  })
})

// ---- WORFY_AGENT=fake and the real backend under vitest ---------------------------------------------

describe('the fake backend and the real one', () => {
  it('with WORFY_AGENT=fake answers from the answers file, logs the request after redaction, and never loads the SDK', async () => {
    const answers = join(scratch, 'answers.json')
    const logFile = join(scratch, 'requests.jsonl')
    writeFileSync(
      answers,
      JSON.stringify([
        { feature: 'suggest', match: 'git st', answer: '`git status`', rateLimit: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.3, resetsAt: NOW / 1000 + 3600 } },
        { feature: 'request', match: 'slow', answer: 'sleep 1', delayMs: 40_000 },
      ]),
    )
    const load = vi.fn<() => Promise<AssistSdk>>(() => Promise.reject(new Error('the SDK was loaded')))
    const env = { WORFY_AGENT: 'fake', WORFY_TERMINAL_AI_ANSWERS: answers, WORFY_TERMINAL_AI_LOG: logFile, VITEST: 'true' }
    const limits = new LimitsTracker({ dataDir, now: () => Date.now() })
    const service = new AssistService({
      backend: () => backendFromEnv(env, load),
      prewarmOptions: async () => ({}),
      settings: new TerminalAiSettingsStore(dataDir),
      limits,
      dataDir,
      branchOf: async () => null,
      log: () => undefined,
    })
    const token = `ghp_${'Zz90'.repeat(9)}`
    expect(await service.request('suggest', input({ line: 'git st', commands: [`GH_TOKEN=${token} gh pr list`] }))).toEqual({ ok: true, command: 'git status', model: 'haiku' })
    expect(limits.snapshot().windows.five_hour).toMatchObject({ utilization: 0.3 })

    const slow = service.request('request', input({ line: '', request: 'something slow' }))
    await settle()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await slow).toEqual({ ok: false, reason: 'timeout' })

    const lines = readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as FakeLogEntry)
    expect(lines).toEqual([
      {
        feature: 'suggest',
        model: 'haiku',
        context: { line: 'git st', request: null, cwd: '/Users/me/work', commands: [`GH_TOKEN=${REDACTED} gh pr list`], branch: null, exitCode: 0, output: null },
        cancelled: false,
        cold: false,
      },
      expect.objectContaining({ feature: 'request', model: 'sonnet', cancelled: true, cold: false }),
    ])
    expect(readFileSync(logFile, 'utf8')).not.toContain(token)
    expect(load).not.toHaveBeenCalled()
    expect(sdkModule.loaded).toBe(0)
    service.dispose()
  })

  it('refuses to make the real backend under vitest, before the SDK is loaded', async () => {
    const load = vi.fn<() => Promise<AssistSdk>>(() => Promise.reject(new Error('the SDK was loaded')))
    expect(process.env.VITEST).toBeTruthy()
    await expect(realBackend(process.env, load)).rejects.toThrow(/not started under vitest/)
    await expect(backendFromEnv({ ...process.env, WORFY_AGENT: undefined }, load)).rejects.toThrow(/not started under vitest/)
    await expect(backendFromEnv({ ...process.env, WORFY_AGENT: undefined })).rejects.toThrow(/not started under vitest/)
    expect(load).not.toHaveBeenCalled()
    expect(sdkModule.loaded).toBe(0)
  })

  it('answers a refusal, not an exception, when the backend cannot be made', async () => {
    const limits = new LimitsTracker({ dataDir, now: () => Date.now() })
    const service = new AssistService({
      backend: () => backendFromEnv({ VITEST: 'true' }),
      prewarmOptions: async () => ({}),
      settings: new TerminalAiSettingsStore(dataDir),
      limits,
      dataDir,
      branchOf: async () => null,
      log: () => undefined,
    })
    expect(await service.request('fix', input())).toEqual({ ok: false, reason: 'failed', detail: 'no_process' })
    expect(sdkModule.loaded).toBe(0)
  })
})

// ---- the channels ----------------------------------------------------------------------------------

class FakeWindow {
  sent: { channel: string; payload: unknown }[] = []
  private destroyed = false
  private readonly onDestroyed: (() => void)[] = []
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  once(_event: 'destroyed', listener: () => void): void {
    this.onDestroyed.push(listener)
  }
  destroy(): void {
    this.destroyed = true
    for (const listener of this.onDestroyed) listener()
  }
  lastState(): TerminalAiState {
    const last = this.sent.findLast((entry) => entry.channel === `${IPC_CHANNEL_PREFIX}terminalAi.changed`)
    if (last === undefined) throw new Error('no terminalAi.changed was sent')
    return last.payload as TerminalAiState
  }
}

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

async function registered(service: Pick<AssistService, 'state' | 'setSettings' | 'subscribe'>): Promise<(channel: string, input: unknown, window?: FakeWindow) => Promise<IpcResult<unknown>>> {
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './terminal-ai.ts': async () => terminalAiHandlers(async () => service) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
  return async (channel, value, window = new FakeWindow()) => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: APP_URL }, sender: window } as unknown as IpcMainInvokeEvent, value)) as IpcResult<unknown>
  }
}

describe('terminalAi channels', () => {
  it('writes terminal-ai.json on terminalAi.setSettings and reads it back after a restart', async () => {
    const first = world()
    const call = await registered(first.service)
    const state = await call('terminalAi.state', undefined)
    expect(state).toMatchObject({ ok: true, value: { settings: { enabled: true, nextCommandModel: 'sonnet' }, process: 'idle' } })

    const changed = await call('terminalAi.setSettings', { nextCommandModel: 'haiku', fix: false })
    expect(changed).toMatchObject({ ok: true, value: { settings: { nextCommandModel: 'haiku', fix: false, enabled: true }, features: { fix: { state: 'off' } } } })
    expect(JSON.parse(readFileSync(join(dataDir, 'terminal-ai.json'), 'utf8'))).toMatchObject({ nextCommandModel: 'haiku', fix: false })
    first.service.dispose()

    const restarted = world()
    const again = await registered(restarted.service)
    expect(await again('terminalAi.state', undefined)).toMatchObject({ ok: true, value: { settings: { nextCommandModel: 'haiku', fix: false } } })
    expect((await again('terminalAi.setSettings', { nextCommandModel: 'gpt' })).ok).toBe(false)
  })

  it('sends terminalAi.changed on a settings change and a process change until the window is destroyed', async () => {
    const { service, sdk } = world()
    const call = await registered(service)
    const window = new FakeWindow()
    await call('terminalAi.state', undefined, window)
    await call('terminalAi.state', undefined, window) // one subscription per window
    service.setSettings({ commandRequest: false })
    expect(window.sent.filter((entry) => entry.channel === `${IPC_CHANNEL_PREFIX}terminalAi.changed`)).toHaveLength(1)
    expect(window.lastState().features.request).toEqual({ state: 'off' })

    const { answer } = await start(service, 'next', { line: '' })
    expect(window.lastState().process).toBe('busy')
    sdk.claimedSpare.query?.answer('ls')
    await answer
    await settle()
    expect(window.lastState().process).toBe('warm')

    window.destroy()
    const count = window.sent.length
    service.setSettings({ commandRequest: true })
    expect(window.sent).toHaveLength(count)
  })

  it('removes the subscription of a window when the window is destroyed', async () => {
    const { service } = world()
    const unsubscribed = vi.fn()
    const subscribe = vi.fn((listener: (state: TerminalAiState) => void) => {
      const off = service.subscribe(listener)
      return () => {
        unsubscribed()
        return off()
      }
    })
    const call = await registered({ state: () => service.state(), setSettings: (patch) => service.setSettings(patch), subscribe })
    const window = new FakeWindow()
    await call('terminalAi.state', undefined, window)
    await call('terminalAi.setSettings', { fix: false }, window)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribed).not.toHaveBeenCalled()
    window.destroy()
    expect(unsubscribed).toHaveBeenCalledTimes(1)
    // Another window gets a subscription of its own.
    const other = new FakeWindow()
    await call('terminalAi.state', undefined, other)
    expect(subscribe).toHaveBeenCalledTimes(2)
  })

  it('marks every terminalAi channel local: a Linked machine never reaches them', () => {
    for (const name of ['terminalAi.state', 'terminalAi.setSettings', 'terminalAi.changed']) expect(accessOf(name)).toBe('local')
  })
})

// ---- the git branch ----------------------------------------------------------------------------------

describe('gitBranch', () => {
  it('reads the branch of a repository folder, null outside one', async () => {
    vi.useRealTimers()
    const repo = join(scratch, 'repo')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q', '-b', 'feature/terminal-ai'], { cwd: repo })
    // Time enough for git on a busy machine: under the load of the whole suite it once took longer than its 1 s.
    expect(await gitBranch(repo, { timeoutMs: ms(10_000) })).toBe('feature/terminal-ai')
    const plain = join(scratch, 'plain')
    mkdirSync(plain)
    expect(await gitBranch(plain, { timeoutMs: ms(10_000) })).toBeNull()
    expect(await gitBranch(join(scratch, 'missing'))).toBeNull()
  })

  it('gives null when git answers later than its time: the request then goes without a branch', async () => {
    vi.useRealTimers()
    // A slow git: node in place of git runs the file `branch` of its folder, which answers after 10 s.
    const slow = join(scratch, 'slow')
    mkdirSync(slow)
    writeFileSync(join(slow, 'branch'), "setTimeout(() => console.log('late'), 10_000)\n")
    const started = Date.now()
    expect(await gitBranch(slow, { git: process.execPath, timeoutMs: 200 })).toBeNull()
    // Killed at its limit: neither sooner (the stand-in did not start) nor after its answer.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})
