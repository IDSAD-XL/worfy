// The Orchestrator's relaunch waits for the old Claude Code process (worfy-week ticket 20,
// ADR-0064): over the real Layout store, Session registry and Orchestrators, on the fake agent with
// a real child process behind each query (claude-process-stub.ts), started by watchedSpawn — the
// spawnClaudeCodeProcess worfy hands the SDK. The order of the processes' starts and exits is what
// is checked, not how long anything took; the limits are small (exitWaitMs) so nothing waits 7.5 s.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { sessionOptions, watchedSpawn } from '../../src/main/agent/options'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { LayoutStore } from '../../src/main/layout/store'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import { IGNORE_TERM_EXIT_SIGNAL, StubProcesses, type StubKind } from './claude-process-stub'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const PROJECT = 'demo-00000020'

// On Windows kill() is TerminateProcess: an `ignore-term` stub dies at the close's SIGTERM, so there
// is no wait for the old process to happen in, and its exit reports SIGTERM (IGNORE_TERM_EXIT_SIGNAL).
const WINDOWS = process.platform === 'win32'
/** How the old `ignore-term` process exited, as StubProcesses.order() writes it. */
const KILLED = (n: number): string => `exit ${n} ${IGNORE_TERM_EXIT_SIGNAL}`

let scratch: string
let repo: string
let registries: SessionRegistry[] = []
let stubs: StubProcesses[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-relaunch-')))
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
  const scripts = join(scratch, 'scripts')
  mkdirSync(scripts)
  const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-000000002001' })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000002002' })
  writeFileSync(join(scripts, 'turn.jsonl'), [JSON.stringify({ fake: 'wait_message' }), init, result].join('\n'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  for (const stub of stubs) await stub.stopAll()
  stubs = []
  vi.unstubAllEnvs()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** One run of the app with stub processes of `kind` behind every query. */
function harness(kind: StubKind | ((n: number, request: QueryRequest) => StubKind), exitWaitMs: number) {
  const calls: FakeCall[] = []
  const requests: QueryRequest[] = []
  const stub = new StubProcesses(typeof kind === 'string' ? () => kind : kind)
  stubs.push(stub)
  const factory = stub.wrap(fakeQueryFactory({ scriptsDir: join(scratch, 'scripts'), script: 'turn', record: (call) => calls.push(call) }))
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    return factory(request)
  })
  registries.push(registry)
  const views: OrchestratorView[] = []
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const orchestrators = new Orchestrators({
    layout,
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: (view) => views.push(view),
    exitWaitMs,
  })
  const view = (): OrchestratorView => {
    const last = views.at(-1)
    if (last === undefined) throw new Error('no view yet')
    return last
  }
  /** The text of each user message, one list per fake query in start order. */
  const messagesPerProcess = (): string[][] => {
    const lists: string[][] = []
    for (const call of calls) {
      if (call.kind === 'start') lists.push([])
      else if (call.kind === 'message') lists.at(-1)?.push(call.text)
    }
    return lists
  }
  const opened = async () => {
    await orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(view().state).toBe('idle'))
  }
  return { stub, calls, requests, registry, orchestrators, views, view, messagesPerProcess, opened }
}

describe('Orchestrator relaunch waits for the old Claude Code process', () => {
  it('a process that ignores SIGTERM: the new one starts only after the old one exited by SIGKILL at the limit; giveBackNow answers after the new start', async () => {
    const h = harness('ignore-term', 300)
    await h.opened()
    expect(h.stub.order()).toEqual(['spawn 1'])

    await h.orchestrators.setUnattended(PROJECT, true)
    expect(h.stub.order()).toEqual(['spawn 1', KILLED(1), 'spawn 2'])
    await vi.waitFor(() => expect(h.view().state).toBe('idle'))

    const answer = await h.orchestrators.giveBackNow(PROJECT)
    // Force stop's answer: the new process has started, after the old one's exit.
    expect(h.stub.order()).toEqual(['spawn 1', KILLED(1), 'spawn 2', KILLED(2), 'spawn 3'])
    expect(answer?.state).toBe('starting')
    expect(h.stub.maxAlive()).toBe(1)
    // The SIGTERM did reach the old process; its stderr went to its Session, as the SDK's own spawn
    // sends it. On Windows the SIGTERM is TerminateProcess: the handler never runs to write it.
    for (const n of [1, 2]) {
      if (WINDOWS) expect(h.stub.stderr.get(n)).not.toContain('SIGTERM ignored')
      else expect(h.stub.stderr.get(n)).toContain('SIGTERM ignored')
    }
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false])
    await vi.waitFor(() => expect(h.view().state).toBe('idle'))
  })

  it('a process that exits at once: the new one starts with no wait added — well under the limit', async () => {
    const LIMIT_MS = 5000
    const h = harness('exit-at-once', LIMIT_MS)
    await h.opened()
    await h.orchestrators.setUnattended(PROJECT, true)
    expect(h.stub.order()).toEqual(['spawn 1', 'exit 1 SIGTERM', 'spawn 2'])
    const exit = h.stub.events.find((event) => event.kind === 'exit' && event.n === 1)
    const spawn = h.stub.events.find((event) => event.kind === 'spawn' && event.n === 2)
    // What the relaunch adds is counted from the old process's exit, as worfy hears of it: before
    // that the wait is for the system to end the process (on the owner's PC 20 ms quiet, 0.2-0.6 s
    // under load, 1.8 s in a whole `pnpm test`), which the relaunch must wait for (ADR-0064).
    const added = (spawn?.at ?? Infinity) - (exit?.at ?? -Infinity)
    expect(added).toBeGreaterThanOrEqual(0)
    // A fifth of the limit: a relaunch that waited it out would be far past this.
    expect(added).toBeLessThan(LIMIT_MS / 5)
  })

  it('a message sent during the wait waits in the new Session and reaches the new process; the old Session takes none', async () => {
    const h = harness('ignore-term', 400)
    await h.opened()
    const old = h.view().sessionId ?? ''
    const relaunched = h.orchestrators.setUnattended(PROJECT, true)
    // The new Session is live at once, `starting`, with no process yet.
    await vi.waitFor(() => expect(h.view().sessionId).not.toBe(old))
    // On Windows the old process is usually gone by now, so the new Session may be past `starting`.
    if (WINDOWS) expect(h.view().error).toBeNull()
    else expect(h.view()).toMatchObject({ state: 'starting', error: null })
    const waiting = h.registry.get(h.view().sessionId ?? '')
    const sent = waiting.send('status?')
    expect(() => h.registry.get(old)).toThrow(/No live Session/)
    if (WINDOWS) {
      // The old process died at the close's TerminateProcess, usually before the new Session was
      // seen (vi.waitFor polls every 50 ms): the message mostly goes at once. Either way it must
      // reach the new process and only it, which the lines after the relaunch check.
      expect(['sent', 'queued']).toContain(sent)
    } else {
      expect(sent).toBe('queued')
      expect(h.stub.order()).toEqual(['spawn 1'])
      expect(h.messagesPerProcess()).toEqual([[]])
    }

    await relaunched
    expect(h.stub.order()).toEqual(['spawn 1', KILLED(1), 'spawn 2'])
    await vi.waitFor(() => expect(h.messagesPerProcess()).toEqual([[], ['status?']]))
    await vi.waitFor(() => expect(waiting.state).toBe('idle'))
    expect(waiting.queued()).toMatchObject({ items: [], paused: false })
  })

  // Needs the old process to outlive its SIGTERM; on Windows kill() is TerminateProcess, so there is no wait to relaunch in.
  it.skipIf(WINDOWS)('a second relaunch during the wait starts no second process: the Session in between never starts one', async () => {
    const h = harness('ignore-term', 300)
    await h.opened()
    const first = h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(h.view().state).toBe('starting'))
    const second = h.orchestrators.giveBackNow(PROJECT)
    await Promise.all([first, second])
    expect(h.stub.order()).toEqual(['spawn 1', KILLED(1), 'spawn 2'])
    expect(h.stub.maxAlive()).toBe(1)
    // Only the last launch asked for a process: attended, as giveBackNow wants it.
    expect(h.requests.map((request) => request.unattended)).toEqual([false, false])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
  })

  // Needs the old process to outlive its SIGTERM; on Windows kill() is TerminateProcess, so there is no wait to close the Project in.
  it.skipIf(WINDOWS)('a Project closed during the wait starts no new process; the old one is still killed at the limit', async () => {
    const h = harness('ignore-term', 200)
    await h.opened()
    const relaunched = h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(h.view().state).toBe('starting'))
    h.orchestrators.retain(new Set())
    await expect(relaunched).rejects.toThrow(/was stopped/)
    await vi.waitFor(() => expect(h.stub.order()).toEqual(['spawn 1', KILLED(1)]))
    await new Promise((done) => setTimeout(done, 100))
    expect(h.stub.order()).toEqual(['spawn 1', KILLED(1)])
    expect(h.requests).toHaveLength(1)
  })
})

describe('Session.exited', () => {
  it('waits for a start still in progress, then kills its process at the limit', async () => {
    const stub = new StubProcesses(() => 'ignore-term')
    stubs.push(stub)
    const fake = fakeQueryFactory({ scriptsDir: join(scratch, 'scripts'), script: 'turn' })
    let release: () => void = () => undefined
    const slow = new Promise<void>((done) => {
      release = done
    })
    // The process starts only once the factory is released, as the SDK factory spawns Claude Code
    // only after the login shell and the canvas.
    const withProcess = stub.wrap(fake)
    const registry = new SessionRegistry(async (request) => {
      await slow
      return withProcess(request)
    })
    registries.push(registry)
    const session = registry.start(repo, undefined, () => undefined)
    session.close()
    let done = false
    const exited = session.exited(1000).then(() => {
      done = true
    })
    await new Promise((wait) => setTimeout(wait, 50))
    expect(done).toBe(false)
    release()
    await exited
    // On Windows the process ends at the SIGTERM of the late start's close (TerminateProcess), before the limit.
    expect(stub.order()).toEqual(['spawn 1', KILLED(1)])
  })

  it('answers at once for a Session without a process of its own (the fake agent)', async () => {
    const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: join(scratch, 'scripts'), script: 'turn' }))
    registries.push(registry)
    const session = registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.close()
    const asked = Date.now()
    await session.exited(5000)
    expect(Date.now() - asked).toBeLessThan(1000)
  })
})

describe('watchedSpawn: Claude Code started as the SDK starts it', () => {
  it('runs the command with its arguments, folder and environment; stderr goes to the Session before the SDK hears of the exit', async () => {
    let raw: import('node:child_process').ChildProcess | null = null
    let stderr = ''
    const start = watchedSpawn(
      (child) => {
        raw = child
      },
      (data) => {
        stderr += data
      },
    )
    const sdkSide = start({
      command: process.execPath,
      args: ['-e', "process.stderr.write(process.cwd() + ' ' + process.env.WORFY_STUB + ' ' + process.argv.slice(1).join(',')); process.exit(2)", 'a', 'b'],
      cwd: repo,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WORFY_STUB: 'stub-env' },
      signal: new AbortController().signal,
    })
    expect(raw).not.toBeNull()
    const [code, signal, seen] = await new Promise<[number | null, NodeJS.Signals | null, string]>((done) => {
      sdkSide.once('exit', (exitCode, exitSignal) => done([exitCode, exitSignal, stderr]))
    })
    expect([code, signal]).toEqual([2, null])
    expect(seen).toBe(`${repo} stub-env a,b`)
    expect(sdkSide.exitCode).toBe(2)
  })

  it('is given to the SDK only for a Session that watches its process', () => {
    const runtime = { packaged: false, resourcesPath: '/nowhere', platform: process.platform, arch: process.arch }
    expect(sessionOptions({ cwd: repo, env: {}, runtime }).spawnClaudeCodeProcess).toBeUndefined()
    expect(sessionOptions({ cwd: repo, env: {}, runtime, spawned: () => undefined }).spawnClaudeCodeProcess).toBeTypeOf('function')
  })
})
