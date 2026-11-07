// The Orchestrator's relaunch waits for the old Claude Code process (worfy-week ticket 20,
// ADR-0064): over the real Layout store, Session registry and Orchestrators, on the fake agent with
// a real child process behind each query (claude-process-stub.ts), started by watchedSpawn — the
// spawnClaudeCodeProcess worfy hands the SDK. The order of the processes' starts and exits is what
// is checked, not how long anything took; the limits are small (exitWaitMs) so nothing waits 7.5 s.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { ORCHESTRATOR_HAS_QUEUE, ORCHESTRATOR_HAS_TASKS, ORCHESTRATOR_IN_TURN, Orchestrators } from '../../src/main/agent/orchestrator'
import { sessionOptions, watchedSpawn } from '../../src/main/vendors/claude/options'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import type { ClaudeCodeProcess } from '../../src/main/agent/session/types'
import { LayoutStore } from '../../src/main/layout/store'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexCapabilities } from '../../src/main/vendors/codex/capabilities'
import { codexCommands } from '../../src/main/vendors/codex/commands'
import { codexSessions } from '../../src/main/vendors/codex/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'
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

/**
 * One run of the app with stub processes of `kind` behind every query. `script`: what every query plays (default `turn`);
 * `releases`: what lets its wait_release lines through; `modeChange`: stands in for each unattended query's setPermissionMode.
 */
function harness(
  kind: StubKind | ((n: number, request: QueryRequest) => StubKind),
  exitWaitMs: number,
  options: { script?: string; releases?: FakeReleases; modeChange?: (mode: string) => Promise<void> } = {},
) {
  const calls: FakeCall[] = []
  const requests: QueryRequest[] = []
  const stub = new StubProcesses(typeof kind === 'string' ? () => kind : kind)
  stubs.push(stub)
  const factory = stub.wrap(fakeQueryFactory({ scriptsDir: join(scratch, 'scripts'), script: options.script ?? 'turn', releases: options.releases, record: (call) => calls.push(call) }))
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    const query = factory(request)
    const modeChange = options.modeChange
    if (modeChange === undefined || request.unattended !== true) return query
    return query.then((handle) => Object.assign(handle, { setPermissionMode: modeChange }))
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
    const asked = Date.now()
    await h.orchestrators.setUnattended(PROJECT, true)
    expect(h.stub.order()).toEqual(['spawn 1', 'exit 1 SIGTERM', 'spawn 2'])
    const exit = h.stub.events.find((event) => event.kind === 'exit' && event.n === 1)
    const spawn = h.stub.events.find((event) => event.kind === 'spawn' && event.n === 2)
    // What the relaunch adds is counted on both sides of the system ending the old process: from
    // the ask to the SIGTERM, and from the exit, as worfy hears of it, to the new start. The time
    // from SIGTERM to exit (on the owner's PC 20 ms quiet, 0.2-0.6 s under load, 1.8 s in a whole
    // `pnpm test`) is the system's, and the relaunch must wait for it (ADR-0064).
    const untilTerm = (h.stub.terminated.get(1) ?? Infinity) - asked
    const added = (spawn?.at ?? Infinity) - (exit?.at ?? -Infinity)
    expect(added).toBeGreaterThanOrEqual(0)
    // A fifth of the limit for both sides together: a relaunch that waited it out, before the close,
    // after the exit or split between them, would be far past this.
    expect(untilTerm + added).toBeLessThan(LIMIT_MS / 5)
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

describe('going attended while a turn runs gives the Session back as it runs, without a relaunch (worfy-autopilot-queue ticket 08)', () => {
  /** A turn held until the test releases `turn`, then a turn with a permission request outside bypassPermissions; then the process exits. */
  const held = (): string => {
    const lines = readFileSync(join(scratch, 'scripts', 'turn.jsonl'), 'utf8').trim().split('\n')
    const ask = JSON.stringify({ fake: 'permission', toolName: 'Bash', toolUseId: 'toolu_after_ls', input: { command: 'ls build', description: 'List the build folder' } })
    writeFileSync(join(scratch, 'scripts', 'held.jsonl'), [lines[0], lines[1], JSON.stringify({ fake: 'wait_release', name: 'turn' }), lines[2], lines[0], lines[1], ask, lines[2], JSON.stringify({ fake: 'exit' })].join('\n'))
    return 'held'
  }

  /** The Node's pick is `default`; the run's unattended Session is in the turn of its Wave, held. */
  async function inTurn(options: { modeChange?: (mode: string) => Promise<void> } = {}) {
    const releases = new FakeReleases()
    const h = harness('exit-at-once', 5000, { script: held(), releases, ...options })
    await h.opened()
    await h.registry.get(h.view().sessionId ?? '').configure({ permissionMode: 'default' })
    await h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(h.view().state).toBe('idle'))
    const session = h.registry.get(h.view().sessionId ?? '')
    session.send('the Wave')
    await vi.waitFor(() => expect(session.state).toBe('busy'))
    const events: AgentEvent[] = []
    h.registry.observe((sessionId, event) => {
      if (sessionId === session.id) events.push(event)
    })
    /** The mode changes the unattended process got. */
    const modeChanges = (): string[] => {
      const second = h.calls.findIndex((call, index) => call.kind === 'start' && index > 0)
      return h.calls.slice(second).flatMap((call) => (call.kind === 'setPermissionMode' ? [call.mode] : []))
    }
    return { h, releases, session, events, modeChanges, order: h.stub.order() }
  }

  it("the same Session and process go on attended in the Node's mode: the turn ends there, nothing starts again, and the next request asks the person", async () => {
    const { h, releases, session, events, modeChanges, order } = await inTurn()
    await h.orchestrators.setUnattended(PROJECT, false)
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(false)
    expect(h.registry.get(h.view().sessionId ?? '')).toBe(session)
    expect(session.unattended).toBe(false)
    expect(session.settings.permissionMode).toBe('default')
    expect(modeChanges()).toEqual(['default'])
    expect(session.state).toBe('busy')

    releases.release('turn')
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await new Promise((done) => setTimeout(done, 50))
    // No relaunch after the turn: the process of the run goes on.
    expect(h.stub.order()).toEqual(order)
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])

    session.send('list the build folder')
    await vi.waitFor(() => expect(session.state).toBe('needs_permission'))
    const asked = events.flatMap((event) => (event.type === 'permission_request' ? [event] : []))
    expect(asked).toMatchObject([{ toolName: 'Bash', input: { command: 'ls build' } }])
    expect(events.filter((event) => event.type === 'refused_dialog')).toEqual([])
    expect(session.answerPermission(asked[0]!.requestId, 'allow')).toBe(true)
    await vi.waitFor(() => expect(h.calls.filter((call) => call.kind === 'permission')).toMatchObject([{ result: { behavior: 'allow' } }]))
    // The Node keeps the person's pick; the run's bypassPermissions was never saved for it. The script is over, and the process with it.
    await vi.waitFor(() => expect(session.state).toBe('error'))
    expect(h.requests.map((request) => request.unattended)).toEqual([false, true])

    // The fake agent's exit line ends its query, not the stub process behind it; Claude Code's own
    // exit ends both. Ended here: the next process waits for the one before it (ADR-0064).
    await h.stub.stopAll()
    // The Session's next process is the person's Orchestrator, in the Node's mode.
    session.send('one more')
    await vi.waitFor(() => expect(h.requests).toHaveLength(3))
    expect(h.requests[2]).toMatchObject({ unattended: false, orchestrator: true, settings: { permissionMode: 'default' } })
  })

  it('waitForWork (a graceful Stop): the Session stays unattended until the turn has ended, then starts again attended', async () => {
    const { h, releases, session, modeChanges } = await inTurn()
    await h.orchestrators.setUnattended(PROJECT, false, undefined, { waitForWork: true })
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(true)
    expect(session.unattended).toBe(true)
    expect(modeChanges()).toEqual([])
    releases.release('turn')
    await vi.waitFor(() => expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false]))
    await vi.waitFor(() => expect(h.orchestrators.isUnattended(PROJECT)).toBe(false))
    expect(h.registry.get(h.view().sessionId ?? '')).not.toBe(session)
  })

  it('the agent refuses the change of mode: the Session stays unattended and in bypassPermissions until the turn has ended, then starts again attended', async () => {
    const { h, releases, session } = await inTurn({ modeChange: () => Promise.reject(new Error('the mode cannot change now')) })
    await h.orchestrators.setUnattended(PROJECT, false)
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(true)
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(true)
    expect(session.unattended).toBe(true)
    expect(session.settings.permissionMode).toBe('bypassPermissions')
    releases.release('turn')
    await vi.waitFor(() => expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false]))
    await vi.waitFor(() => expect(h.orchestrators.isUnattended(PROJECT)).toBe(false))
  })

  it('a refusal that comes after the turn ended still gives the Orchestrator back: the wait for the turn has nothing left to wait for', async () => {
    let refuse: (error: Error) => void = () => undefined
    const asked: string[] = []
    const { h, releases, session } = await inTurn({
      modeChange: (mode) => {
        asked.push(mode)
        return new Promise<void>((_resolve, reject) => {
          refuse = reject
        })
      },
    })
    const back = h.orchestrators.setUnattended(PROJECT, false)
    await vi.waitFor(() => expect(asked).toEqual(['default']))
    releases.release('turn')
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    // While the change is tried, no give-back waits: a new run would find the Orchestrator busy, not left to it.
    expect(h.orchestrators.awaitsGiveBack(session.id)).toBe(false)
    refuse(new Error('the mode cannot change now'))
    await back
    await vi.waitFor(() => expect(h.requests.map((request) => request.unattended)).toEqual([false, true, false]))
    await vi.waitFor(() => expect(h.orchestrators.isUnattended(PROJECT)).toBe(false))
  })

  it('becomeAttended of a Session that is attended already, or closed, changes nothing', async () => {
    const h = harness('exit-at-once', 5000)
    await h.opened()
    const session = h.registry.get(h.view().sessionId ?? '')
    await expect(session.becomeAttended({ model: null, effort: null, permissionMode: 'default' })).resolves.toMatchObject({ permissionMode: 'bypassPermissions' })
    expect(h.calls.filter((call) => call.kind === 'setPermissionMode')).toEqual([])
    session.close()
    await expect(session.becomeAttended({ model: null, effort: null, permissionMode: 'default' })).rejects.toThrow(/is closed/)
  })
})

describe('a Codex Orchestrator given back as its turn runs (worfy-autopilot-queue ticket 08)', () => {
  const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
  const REPO = join(import.meta.dirname, '..', '..')
  const CODEX_SCRIPTS = join(REPO, 'test', 'fixtures', 'codex-scripts')
  /** How long the fake app-server may take to answer, as the other Codex contract tests wait for it. */
  const CODEX_WAIT = { timeout: ms(10_000) }
  const children: ChildProcess[] = []

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid === undefined || hasExited(child)) continue
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.kill('SIGKILL')
      await exited
    }
  })

  const scriptOf = (name: string): Record<string, unknown>[] =>
    readFileSync(join(CODEX_SCRIPTS, `${name}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)

  /**
   * The run's Codex process: its Wave turn asks a command's approval (declined while unattended) and runs until it is
   * interrupted; the next turn asks a file change's approval. Lines of approval.jsonl and interrupt.jsonl.
   */
  function backInPlaceScript(dir: string): string {
    const approval = scriptOf('approval')
    const interrupted = scriptOf('interrupt').at(-1)!
    const second = (line: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(line).replaceAll('turn_1', 'turn_2')) as Record<string, unknown>
    const [init, initialized, threadStart, threadStarted, turnStart, turnStarted, commandStarted, commandAsk, commandDone, patchStarted, patchAsk, patchDone] = approval
    const lines = [init, initialized, threadStart, threadStarted, turnStart, turnStarted, commandStarted, commandAsk, commandDone, { expect: 'turn/interrupt', result: {} }, interrupted]
    const next = [turnStart, turnStarted, patchStarted, patchAsk, patchDone, approval.at(-1)].map((line) => second(line!))
    writeFileSync(join(dir, 'back-in-place.jsonl'), `${[...lines, ...next].map((line) => JSON.stringify(line)).join('\n')}\n`)
    return 'back-in-place'
  }

  it("the next turn/start carries the Node's mode, the process and its thread go on, and the next approval asks the person", async () => {
    const dir = join(scratch, 'codex-scripts')
    mkdirSync(dir)
    writeFileSync(join(dir, 'turn.jsonl'), readFileSync(join(CODEX_SCRIPTS, 'turn.jsonl')))
    const scripts = ['turn', backInPlaceScript(dir)]
    const codexHome = join(scratch, 'codex-home')
    mkdirSync(codexHome)
    const logs: string[] = []
    const codex = codexSessions(() => {
      const index = logs.length
      const log = join(scratch, `codex-${index + 1}.log`)
      logs.push(log)
      return Promise.resolve({
        runtime: RUNTIME,
        appPath: REPO,
        clientVersion: '9.9.9',
        env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPTS: dir, WORFY_CODEX_SCRIPT: scripts[Math.min(index, scripts.length - 1)]!, WORFY_CODEX_LOG: log },
        spawnProcess: (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
          const child = spawn(scriptNode(), [...args], spawnOptions)
          children.push(child)
          return child
        },
        log: () => undefined,
      })
    })
    const registry = new SessionRegistry({ sessionsOf: () => codex, partsOf: () => ({ capabilities: codexCapabilities, commands: codexCommands }) })
    registries.push(registry)
    const views: OrchestratorView[] = []
    const orchestrators = new Orchestrators({
      layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
      projectPath: () => repo,
      registry,
      vendor: () => 'codex',
      // The person's pick: Auto on Codex (on-request, workspace-write).
      settings: { read: () => ({ ...DEFAULT_SETTINGS, permissionMode: 'acceptEdits' }), write: () => undefined },
      transcript: () => Promise.resolve({ model: null, statusBlock: null }),
      broadcast: () => undefined,
      publish: (view) => views.push(view),
    })
    const logged = (n: number): { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown }[] => {
      try {
        return readFileSync(logs[n - 1]!, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as { method?: string })
      } catch {
        return []
      }
    }
    const answers = (n: number) => logged(n).filter((each) => each.method === undefined && each.result !== undefined)
    const current = () => registry.get(views.at(-1)?.sessionId ?? '')

    await orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(views.at(-1)?.state).toBe('idle'), CODEX_WAIT)
    await orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(views.at(-1)?.state).toBe('idle'), CODEX_WAIT)
    const session = current()
    const events: AgentEvent[] = []
    registry.observe((sessionId, event) => {
      if (sessionId === session.id) events.push(event)
    })
    session.send('the Wave')
    // Unattended: the command's approval is declined at once, and the turn goes on.
    await vi.waitFor(() => expect(answers(2)).toEqual([{ id: 1, result: { decision: 'decline' } }]), CODEX_WAIT)
    expect(session.state).toBe('busy')

    await orchestrators.setUnattended(PROJECT, false)
    expect(orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(current()).toBe(session)
    expect(session.unattended).toBe(false)
    expect(session.settings.permissionMode).toBe('auto')

    await session.interrupt()
    await vi.waitFor(() => expect(session.state).toBe('idle'), CODEX_WAIT)
    session.send('go on')
    await vi.waitFor(() => expect(session.state).toBe('needs_permission'), CODEX_WAIT)
    // The same process and thread: no second thread/start, no thread/resume, no third process.
    expect(logs).toHaveLength(2)
    expect(logged(2).filter((each) => each.method === 'thread/start' || each.method === 'thread/resume')).toHaveLength(1)
    const turns = logged(2).filter((each) => each.method === 'turn/start')
    expect(turns).toHaveLength(2)
    expect(turns[0]?.params).not.toHaveProperty('approvalPolicy')
    expect(turns[1]?.params).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } })
    // The file change's approval waits for the person, and the person's answer goes back.
    const asked = events.flatMap((event) => (event.type === 'permission_request' ? [event] : []))
    expect(asked).toMatchObject([{ toolName: 'fileChange' }])
    expect(events.filter((event) => event.type === 'refused_dialog')).toHaveLength(1)
    expect(session.answerPermission(asked[0]!.requestId, 'accept')).toBe(true)
    await vi.waitFor(() => expect(answers(2)).toEqual([{ id: 1, result: { decision: 'decline' } }, { id: 2, result: { decision: 'accept' } }]), CODEX_WAIT)
    await vi.waitFor(() => expect(session.state).toBe('idle'), CODEX_WAIT)
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

  // A process that obeys its SIGTERM: the Session closed during the start closes it as soon as its
  // driver hands it over, so it ends at that SIGTERM, well before exited() would kill it at the limit.
  it('closes the process of a start still in progress once its driver answers: SIGTERM, not the SIGKILL at the limit', async () => {
    const stub = new StubProcesses(() => 'exit-at-once')
    stubs.push(stub)
    const fake = fakeQueryFactory({ scriptsDir: join(scratch, 'scripts'), script: 'turn' })
    let release: () => void = () => undefined
    const slow = new Promise<void>((done) => {
      release = done
    })
    const withProcess = stub.wrap(fake)
    const registry = new SessionRegistry(async (request) => {
      await slow
      return withProcess(request)
    })
    registries.push(registry)
    const session = registry.start(repo, undefined, () => undefined)
    // A message waits for the process, as one sent right after opening a Session does.
    session.send('hello')
    session.close()
    release()
    await session.exited(5000)
    expect(stub.terminated.has(1)).toBe(true)
    expect(stub.order()).toEqual(['spawn 1', 'exit 1 SIGTERM'])
  })

  // On the Windows runner Node's exit event of a killed process came seconds after the system had
  // ended it (CI run 40651661632). A process whose event never comes, and whose pid the system no
  // longer runs: exited() hears of it from the system, and the Session drops it, so no SIGKILL.
  it('hears from the system of a process whose exit event never comes: no SIGKILL, well under the limit', async () => {
    const PID = 2_000_000_001
    const signals: NodeJS.Signals[] = []
    const child: ClaudeCodeProcess = {
      pid: PID,
      exitCode: null,
      signalCode: null,
      kill: (signal) => {
        signals.push(signal)
        return true
      },
      once: () => child,
    }
    let gone = false
    const kill = process.kill.bind(process)
    const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid !== PID) return kill(pid, signal)
      if (gone) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
      return true
    })
    try {
      const fake = fakeQueryFactory({ scriptsDir: join(scratch, 'scripts'), script: 'turn' })
      const registry = new SessionRegistry(async (request) => {
        request.spawned?.(child)
        return fake(request)
      })
      registries.push(registry)
      const session = registry.start(repo, undefined, () => undefined)
      await vi.waitFor(() => expect(session.state).toBe('idle'))
      session.close()
      let done = false
      const exited = session.exited(5000).then(() => {
        done = true
      })
      await new Promise((wait) => setTimeout(wait, 200))
      // While the system still runs the pid, exited() waits: only the system's answer below ends it.
      expect(done).toBe(false)
      gone = true
      await exited
      // No SIGKILL also says exited() returned before its limit: the limit is what sends SIGKILL.
      expect(signals).not.toContain('SIGKILL')
    } finally {
      spy.mockRestore()
    }
  })

  // A process the system runs on after SIGKILL: exited() gives up on it after KILL_EXIT_MS, and from then on asks the
  // system nothing more about its pid, for the life of the app.
  it('stops asking the system about a process that outlived SIGKILL once exited() gave up on it', async () => {
    const PID = 2_000_000_003
    const signals: NodeJS.Signals[] = []
    const child: ClaudeCodeProcess = {
      pid: PID,
      exitCode: null,
      signalCode: null,
      kill: (signal) => {
        signals.push(signal)
        return true
      },
      once: () => child,
    }
    let asked = 0
    const kill = process.kill.bind(process)
    const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid !== PID) return kill(pid, signal)
      asked++
      return true
    })
    try {
      const fake = fakeQueryFactory({ scriptsDir: join(scratch, 'scripts'), script: 'turn' })
      const registry = new SessionRegistry(async (request) => {
        request.spawned?.(child)
        return fake(request)
      })
      registries.push(registry)
      const session = registry.start(repo, undefined, () => undefined)
      await vi.waitFor(() => expect(session.state).toBe('idle'))
      session.close()
      await session.exited(100)
      expect(signals).toContain('SIGKILL')
      expect(asked).toBeGreaterThan(0)
      const afterGivingUp = asked
      await new Promise((wait) => setTimeout(wait, 300))
      expect(asked).toBe(afterGivingUp)
    } finally {
      spy.mockRestore()
    }
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

// The last guards before an attended Orchestrator Session is started again unattended: the restart would kill the
// person's tasks and lose their queue, so setUnattended refuses a Session that is busy (audit-code-2026-11-07 ticket 02).
describe('setUnattended refuses an attended Orchestrator that is busy, and starts nothing', () => {
  /** The turn of a message is held until the test interrupts it (the harness' `turn` script with a wait_interrupt line in it). */
  const heldTurn = (): string => {
    const lines = readFileSync(join(scratch, 'scripts', 'turn.jsonl'), 'utf8').trim().split('\n')
    writeFileSync(join(scratch, 'scripts', 'held-turn.jsonl'), [lines[0], lines[1], JSON.stringify({ fake: 'wait_interrupt' }), lines[2]].join('\n'))
    return 'held-turn'
  }

  /** The Orchestrator is attended and idle, running `script`. */
  async function attended(script: string) {
    const h = harness('exit-at-once', 5000, { script, releases: new FakeReleases() })
    await h.opened()
    return { h, session: h.registry.get(h.view().sessionId ?? '') }
  }

  /** The refusal came before any new process: the same Session goes on attended, nothing was spawned or stopped. */
  function expectUntouched(h: Awaited<ReturnType<typeof attended>>['h'], session: ReturnType<typeof h.registry.get>): void {
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(h.registry.get(h.view().sessionId ?? '')).toBe(session)
    expect(h.requests.map((request) => request.unattended)).toEqual([false])
    expect(h.stub.order()).toEqual(['spawn 1'])
  }

  it('refuses a start while the Orchestrator is in a turn', async () => {
    const { h, session } = await attended(heldTurn())
    session.send('a long task')
    await vi.waitFor(() => expect(session.state).toBe('busy'))
    await expect(h.orchestrators.setUnattended(PROJECT, true)).rejects.toThrow(ORCHESTRATOR_IN_TURN)
    expect(session.state).toBe('busy')
    expectUntouched(h, session)
  })

  it('refuses a start while the Orchestrator has live background tasks', async () => {
    const tasks = JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'task_0001', task_type: 'local_agent', description: 'Implement a ticket' }], session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000002931' })
    const lines = readFileSync(join(scratch, 'scripts', 'turn.jsonl'), 'utf8').trim().split('\n')
    writeFileSync(join(scratch, 'scripts', 'tasks.jsonl'), [lines[0], lines[1], tasks, lines[2], JSON.stringify({ fake: 'wait_release', name: 'tasks' })].join('\n'))
    const { h, session } = await attended('tasks')
    session.send('start a task')
    await vi.waitFor(() => expect(session.backgroundTasks()).toHaveLength(1))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await expect(h.orchestrators.setUnattended(PROJECT, true)).rejects.toThrow(ORCHESTRATOR_HAS_TASKS)
    expect(session.backgroundTasks()).toHaveLength(1)
    expectUntouched(h, session)
  })

  it('refuses a start while messages wait in the Orchestrator\'s queue, and leaves them there', async () => {
    const { h, session } = await attended(heldTurn())
    session.send('a long task')
    session.send('then this')
    // Interrupt holds the queue; the turn ends and the Orchestrator is idle with a held message.
    await session.interrupt()
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(session.queued()).toMatchObject({ items: [{ text: 'then this' }], paused: true })
    await expect(h.orchestrators.setUnattended(PROJECT, true)).rejects.toThrow(ORCHESTRATOR_HAS_QUEUE)
    expect(session.queued().items.map((item) => item.text)).toEqual(['then this'])
    expectUntouched(h, session)
  })
})
