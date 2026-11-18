// The continuation of the Sessions a restart of worfy cut off (worfy-continuity ticket 05, src/main/agent/continuity.ts)
// over the real Layout store, Session registry, Node Sessions and record of live Sessions (live-sessions.ts), on the
// fake agent and the fake Codex app-server: a Session Node in a turn when worfy quits gets one continuation message
// after the start and its queue in place, held as it was; one with a `git push` without a result (its own, or a
// Subagent's) is not continued and shows the chip with Continue; a call without a result of an earlier turn does
// not count; a Session a Run owns is left to the Run; a previous process of the Session that still runs is waited
// for; a Codex Session goes on through thread/resume with one message. The transcripts lie in a temporary Claude
// home, which the continuation only reads.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claudeTranscript, Continuity, type ContinuityDeps } from '../../src/main/agent/continuity'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { LiveSessions } from '../../src/main/agent/live-sessions'
import { NodeSessions } from '../../src/main/agent/node-sessions'
import { clockText } from '../../src/main/agent/orchestrator-continue'
import { SessionRegistry, STATIC_CLAUDE_PARTS } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { projectDirName } from '../../src/main/claude-home/registry'
import { LayoutStore } from '../../src/main/layout/store'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { AgentEventEnvelope } from '../../src/shared/agent/events'
import { LIVE_SESSIONS_FILE, LIVE_SESSIONS_VERSION, type LiveSession } from '../../src/shared/agent/live-sessions'
import { makeRunId } from '../../src/shared/autopilot/journal'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import { parseTranscriptLines } from '../../src/shared/transcript/parse'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptsDir = join(REPO, 'test', 'fixtures', 'agent-scripts')
const PROJECT = 'demo-00000005'
const SDK = 'c0000000-0000-4000-8000-0000000000c5'
const NODE = 'node-cut'
const MINUTE = 60_000
const UNTIL = { timeout: ms(5000), interval: 20 }

let scratch: string
let repo: string
let dataDir: string
let claudeHome: string
let registries: SessionRegistry[] = []
const children: ChildProcess[] = []

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-continuity-')))
  repo = join(scratch, 'repo')
  dataDir = join(scratch, 'data', PROJECT)
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(repo, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(claudeHome, 'projects', projectDirName(repo)), { recursive: true })
  // The user's model and effort come from <Claude home>/settings.json: the test's own home, never ~/.claude.
  vi.stubEnv('WORFY_CLAUDE_HOME', claudeHome)
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    child.kill('SIGKILL')
    await exited
  }
  vi.unstubAllEnvs()
  removeTestTree(scratch)
})

// ── the transcripts Claude Code would have written ──────────────────────────────────────────────

const transcriptFile = (sessionId: string): string => join(claudeHome, 'projects', projectDirName(repo), `${sessionId}.jsonl`)
const stamp = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * MINUTE).toISOString()
const record = (extra: Record<string, unknown>, minutesAgo: number, sidechain = false): string =>
  JSON.stringify({ isSidechain: sidechain, timestamp: stamp(minutesAgo), cwd: repo, sessionId: SDK, entrypoint: 'sdk-ts', ...extra })
const said = (text: string, minutesAgo: number): string => record({ type: 'user', message: { role: 'user', content: text } }, minutesAgo)
const call = (id: string, name: string, input: unknown, minutesAgo: number, sidechain = false): string =>
  record({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }, minutesAgo, sidechain)
const answered = (id: string, minutesAgo: number, sidechain = false): string =>
  record({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }, minutesAgo, sidechain)

function writeTranscript(lines: readonly string[], subagents: Record<string, readonly string[]> = {}): void {
  writeFileSync(transcriptFile(SDK), `${lines.join('\n')}\n`)
  for (const [agentId, agentLines] of Object.entries(subagents)) {
    const dir = join(dirname(transcriptFile(SDK)), SDK, 'subagents')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `agent-${agentId}.jsonl`), `${agentLines.join('\n')}\n`)
  }
}

/** Every file under the Claude home with its size and modification time. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(claudeHome, path)] = `${statSync(path).size}:${statSync(path).mtimeMs}`
    }
  }
  walk(claudeHome)
  return out
}

// ── one run of the app ──────────────────────────────────────────────────────────────────────────

const RECORD: LiveSession = {
  nodeId: NODE,
  kind: 'session-node',
  vendor: 'claude',
  vendorSessionId: SDK,
  state: 'busy',
  queue: { items: [], held: false },
  runId: null,
  lastEventAt: Date.now() - 2 * MINUTE,
  continuedAt: [],
}

function writeRecords(records: readonly LiveSession[]): void {
  writeFileSync(join(dataDir, LIVE_SESSIONS_FILE), JSON.stringify({ version: LIVE_SESSIONS_VERSION, sessions: records }))
}

function savedNode(data: Record<string, unknown> = { origin: 'worfy', vendor: 'claude', sessionId: SDK }): void {
  writeFileSync(join(dataDir, 'layout.json'), JSON.stringify({ nodes: [{ id: NODE, kind: 'session', x: 0, y: 0, w: 340, h: 220, data }] }))
}

const textOf = async (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null)

/** A Layout store, a registry on the fake agent playing `script`, the Node Sessions and the record of live Sessions. */
function app(script: string, history: { sessionId: string; cwd: string }[] = []) {
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir, script }))
  registries.push(registry)
  const requests: { resume: string | undefined }[] = []
  const original = registry.start.bind(registry)
  registry.start = ((...args: Parameters<SessionRegistry['start']>) => {
    requests.push({ resume: args[1] })
    return original(...args)
  }) as SessionRegistry['start']
  const live = new LiveSessions({
    observe: (sink) => registry.observe(sink),
    observeInput: (listener) => registry.observeInput(listener),
    session: (sessionId) => {
      try {
        return registry.get(sessionId)
      } catch {
        return null
      }
    },
    // This test's folder, not the next test's: a watcher a failed test left running writes nowhere else.
    dirOf: ((dir: string) => () => dir)(dataDir),
  })
  const broadcast: AgentEventEnvelope[] = []
  const sessions = new NodeSessions({
    layout,
    projectPath: () => repo,
    registry,
    settings: { read: () => undefined, write: () => undefined },
    claude: () => Promise.resolve({ live: [], history }),
    isDirectory: () => Promise.resolve(true),
    broadcast: (sessionId, event) => broadcast.push({ sessionId, event }),
    publish: (view) => live.node(view),
  })
  return { layout, registry, requests, live, broadcast, sessions }
}

type App = ReturnType<typeof app>

/** The continuation over one run of the app; `deps` replace its parts. */
function continuity(h: App, deps: Partial<ContinuityDeps> = {}): Continuity {
  return new Continuity({
    projects: () => [{ id: PROJECT, root: repo, dataDir }],
    readFile: textOf,
    liveFile: (project) => join(project.dataDir, LIVE_SESSIONS_FILE),
    transcript: (_project, found) =>
      claudeTranscript(async () => ((await textOf(transcriptFile(found.vendorSessionId ?? ''))) === null ? null : transcriptFile(found.vendorSessionId ?? '')), {
        lines: async (path) => (await readFile(path, 'utf8')).split('\n').filter((line) => line !== ''),
        names: async (dir) => readdir(dir).catch(() => []),
        parse: (lines) => parseTranscriptLines(lines),
      }),
    previous: () => Promise.resolve(null),
    exited: () => Promise.resolve(true),
    kill: () => undefined,
    orchestrator: () => Promise.reject(new Error('no Orchestrator in this test')),
    node: (projectId, nodeId, sessionId) => h.sessions.started(projectId, nodeId, sessionId),
    keptSession: (projectId, nodeId) => h.sessions.keptSessionOf(projectId, nodeId),
    interrupted: (projectId, nodeId, mark) => h.sessions.interrupted(projectId, nodeId, mark),
    noteContinued: (nodeId, at) => h.live.noteContinued(nodeId, at),
    updatedAt: () => Promise.resolve(null),
    now: () => Date.now(),
    clock: clockText,
    log: () => undefined,
    ...deps,
  })
}

const prompts = (h: App): string[] => h.broadcast.flatMap(({ event }) => (event.type === 'prompt' ? [event.text] : []))
const notices = (h: App): string[] => h.broadcast.flatMap(({ event }) => (event.type === 'notice' && event.kind === 'notification' ? [event.text] : []))
const viewOf = (h: App, nodeId: string = NODE): SessionNodeView | undefined => h.sessions.list(PROJECT).find((view) => view.nodeId === nodeId)

describe('a Session Node cut off in a turn', () => {
  it('quit in a turn with a message queued: after the start one continuation message goes, the queue waits behind it, and the record counts the continuation', async () => {
    // The first run: a Session Node in a turn, a message queued behind it; then worfy quits as quit-grace.ts does.
    const first = app('interrupt')
    const created = first.sessions.create(PROJECT)
    const session = first.registry.get(created.sessionId)
    session.send('build the feature')
    // The agent named its session (system/init), and its turn runs.
    await vi.waitFor(() => expect(viewOf(first, created.nodeId)).toMatchObject({ state: 'busy', sdkSessionId: expect.any(String) }), UNTIL)
    session.send('and then the docs')
    const sdk = viewOf(first, created.nodeId)?.sdkSessionId ?? ''
    await vi.waitFor(async () => {
      const text = await textOf(join(dataDir, LIVE_SESSIONS_FILE))
      expect(JSON.parse(text ?? '{}')).toMatchObject({ sessions: [{ nodeId: created.nodeId, state: 'busy', vendorSessionId: sdk, queue: { items: [{ text: 'and then the docs' }], held: false } }] })
    }, UNTIL)
    first.live.stop()
    await first.live.settled()
    first.layout.flushAll()
    first.registry.closeAll()
    // What Claude Code wrote of that turn: the person's message and a call that has its result.
    writeFileSync(
      transcriptFile(sdk),
      `${[said('build the feature', 2).replaceAll(SDK, sdk), call('t-ls', 'Bash', { command: 'ls src' }, 2).replaceAll(SDK, sdk), answered('t-ls', 1).replaceAll(SDK, sdk)].join('\n')}\n`,
    )
    const before = snapshot()

    const next = app('interrupt', [{ sessionId: sdk, cwd: repo }])
    const outcomes = await continuity(next).run()
    expect(outcomes).toMatchObject([{ nodeId: created.nodeId, outcome: 'continued', reason: null }])
    expect(next.requests).toEqual([{ resume: sdk }])
    await vi.waitFor(() => expect(prompts(next)).toHaveLength(1), UNTIL)
    const [text] = prompts(next)
    expect(text).toMatch(/^worfy restarted at \d{2}:\d{2} \(it quit or crashed\), which cut off your previous turn/u)
    expect(text).toContain('check what it already did')
    expect(text).not.toContain('build the feature')
    expect(notices(next)).toEqual([expect.stringMatching(/^worfy: restarted at \d{2}:\d{2}, sent "continue"$/u)])
    // The queue is back in its place: behind the continuation, not held, its message not sent yet.
    const live = next.registry.get(viewOf(next, created.nodeId)?.sessionId ?? '')
    expect(live.queued()).toMatchObject({ items: [{ text: 'and then the docs' }], paused: false })
    // The record counts the continuation against the cap of the hour.
    await vi.waitFor(async () => expect(JSON.parse((await textOf(join(dataDir, LIVE_SESSIONS_FILE))) ?? '{}').sessions?.[0]?.continuedAt).toHaveLength(1), UNTIL)
    // The Claude home was only read.
    expect(snapshot()).toEqual(before)
  })

  it('a held queue comes back held, and the earlier continuations of the hour are kept in the record', async () => {
    savedNode()
    const earlier = Date.now() - 20 * MINUTE
    writeRecords([{ ...RECORD, queue: { items: [{ text: 'after that, the tests', files: [], images: [] }], held: true }, continuedAt: [earlier] }])
    writeTranscript([said('go on', 3)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    expect(await continuity(h).run()).toMatchObject([{ outcome: 'continued', reason: null }])
    await vi.waitFor(() => expect(prompts(h)).toHaveLength(1), UNTIL)
    expect(h.registry.get(viewOf(h)?.sessionId ?? '').queued()).toMatchObject({ items: [{ text: 'after that, the tests' }], paused: true })
    await vi.waitFor(async () => {
      const continued: number[] = JSON.parse((await textOf(join(dataDir, LIVE_SESSIONS_FILE))) ?? '{}').sessions?.[0]?.continuedAt ?? []
      expect(continued).toHaveLength(2)
      expect(continued[0]).toBe(earlier)
    }, UNTIL)
  })

  it('a call without a result of an earlier turn does not count: only the turn the restart cut off is checked', async () => {
    savedNode()
    writeRecords([RECORD])
    writeTranscript([said('push it', 30), call('t-old', 'Bash', { command: 'git push origin main' }, 30), said('[Request interrupted by user]', 29), said('now the docs', 3), call('t-new', 'Bash', { command: 'ls docs' }, 2), answered('t-new', 2)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    expect(await continuity(h).run()).toMatchObject([{ outcome: 'continued', reason: null }])
    await vi.waitFor(() => expect(prompts(h)).toHaveLength(1), UNTIL)
  })
})

describe('a Session not continued by itself: the chip and Continue', () => {
  it('a git push without a result: no continuation, the chip «Interrupted by restart»; Continue sends the message after the notice «not continued»', async () => {
    savedNode()
    writeRecords([RECORD])
    writeTranscript([said('ship it', 3), call('t-push', 'Bash', { command: 'git push origin main' }, 2)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    const outcomes = await continuity(h).run()
    expect(outcomes).toMatchObject([{ outcome: 'interrupted', reason: '`git push origin main` may or may not have run' }])
    expect(h.requests).toEqual([])
    expect(viewOf(h)).toMatchObject({ state: 'closed', restart: { reason: '`git push origin main` may or may not have run' } })

    // Continue: Resume, then the same message.
    await h.sessions.start(PROJECT, NODE)
    expect(h.requests).toEqual([{ resume: SDK }])
    expect(viewOf(h)?.restart).toBeUndefined()
    await vi.waitFor(() => expect(prompts(h)).toHaveLength(1), UNTIL)
    expect(prompts(h)[0]).toMatch(/^worfy restarted at/u)
    expect(notices(h)).toEqual(['worfy: not continued: `git push origin main` may or may not have run', expect.stringMatching(/^worfy: restarted at \d{2}:\d{2}, sent "continue"$/u)])
    // A second start of the running Session sends nothing more.
    await h.sessions.start(PROJECT, NODE)
    expect(prompts(h)).toHaveLength(1)
  })

  it("a Subagent's gh pr merge without a result keeps the Session from going on by itself, and names the Subagent", async () => {
    savedNode()
    writeRecords([RECORD])
    writeTranscript([said('run the wave', 3), call('t-agent', 'Agent', { description: 'ship', subagent_type: 'worfy:implementer' }, 3), answered('t-agent', 3)], {
      a1b2: [call('s-merge', 'Bash', { command: 'gh pr merge 12' }, 1, true)],
    })
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    expect(await continuity(h).run()).toMatchObject([{ outcome: 'interrupted', reason: '`gh pr merge 12` (Subagent a1b2) may or may not have run' }])
    expect(h.requests).toEqual([])
  })

  it('cut off more than an hour before the start: the chip, and nothing starts', async () => {
    savedNode()
    writeRecords([{ ...RECORD, lastEventAt: Date.now() - 61 * MINUTE }])
    writeTranscript([said('go on', 62)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    expect(await continuity(h).run()).toMatchObject([{ outcome: 'interrupted', reason: 'it was cut off more than an hour before worfy started again' }])
    expect(h.requests).toEqual([])
    expect(viewOf(h)).toMatchObject({ state: 'closed', restart: { reason: 'it was cut off more than an hour before worfy started again' } })
  })

  it('the restart is delivered once: a start after Continue delivered it, the Session closed in between, sends nothing more', async () => {
    savedNode()
    writeRecords([{ ...RECORD, lastEventAt: Date.now() - 61 * MINUTE }])
    writeTranscript([said('go on', 62)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    await continuity(h).run()
    await h.sessions.start(PROJECT, NODE)
    await vi.waitFor(() => expect(prompts(h)).toHaveLength(1), UNTIL)
    // The continued turn runs (the fake agent waits for an Interrupt): stop it, then close the Session.
    await h.registry.get(viewOf(h)?.sessionId ?? '').interrupt()
    await vi.waitFor(() => expect(viewOf(h)?.state).toBe('idle'), UNTIL)
    h.sessions.close(NODE)
    await vi.waitFor(() => expect(viewOf(h)?.state).toBe('closed'), UNTIL)
    await h.sessions.start(PROJECT, NODE)
    await vi.waitFor(() => expect(h.requests).toHaveLength(2), UNTIL)
    expect(prompts(h)).toHaveLength(1)
    expect(notices(h).filter((line) => line.startsWith('worfy: not continued'))).toHaveLength(1)
  })

  it('resumed from History instead of Continue: the restart is not delivered then, nor at a later start', async () => {
    savedNode()
    writeRecords([{ ...RECORD, lastEventAt: Date.now() - 61 * MINUTE }])
    writeTranscript([said('go on', 62)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    await continuity(h).run()
    await h.sessions.resume(PROJECT, SDK)
    expect(viewOf(h)?.restart).toBeUndefined()
    h.sessions.close(NODE)
    await vi.waitFor(() => expect(viewOf(h)?.state).toBe('closed'), UNTIL)
    await h.sessions.start(PROJECT, NODE)
    expect(h.requests).toEqual([{ resume: SDK }, { resume: SDK }])
    expect(prompts(h)).toEqual([])
    expect(notices(h)).toEqual([])
  })
})

describe('the session of the Node and the session the restart cut off', () => {
  it('the Node keeps no session id yet (a crash before layout.json was written): the cut-off session is resumed, never a new one', async () => {
    savedNode({ origin: 'worfy', vendor: 'claude' })
    writeRecords([RECORD])
    writeTranscript([said('go on', 3)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    expect(await continuity(h).run()).toMatchObject([{ outcome: 'continued', reason: null }])
    expect(h.requests).toEqual([{ resume: SDK }])
    await vi.waitFor(() => expect(prompts(h)).toHaveLength(1), UNTIL)
  })

  it('the Node keeps no session id and is not continued by itself: Continue resumes the cut-off session', async () => {
    savedNode({ origin: 'worfy', vendor: 'claude' })
    writeRecords([{ ...RECORD, lastEventAt: Date.now() - 61 * MINUTE }])
    writeTranscript([said('go on', 62)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    expect(await continuity(h).run()).toMatchObject([{ outcome: 'interrupted' }])
    expect(viewOf(h)).toMatchObject({ state: 'closed', sdkSessionId: SDK })
    await h.sessions.start(PROJECT, NODE)
    expect(h.requests).toEqual([{ resume: SDK }])
    await vi.waitFor(() => expect(prompts(h)).toHaveLength(1), UNTIL)
  })

  it('the Node names another session than the record: «Interrupted», nothing sent; Continue resumes the Node’s own session with the queue held', async () => {
    const OTHER = 'c0000000-0000-4000-8000-0000000000d6'
    savedNode({ origin: 'worfy', vendor: 'claude', sessionId: OTHER })
    writeRecords([{ ...RECORD, queue: { items: [{ text: 'after that, the tests', files: [], images: [] }], held: false } }])
    writeTranscript([said('go on', 3)])
    const h = app('interrupt', [
      { sessionId: SDK, cwd: repo },
      { sessionId: OTHER, cwd: repo },
    ])
    const reason = `its Node names the session ${OTHER}, not ${SDK} that the restart cut off`
    expect(await continuity(h).run()).toMatchObject([{ outcome: 'interrupted', reason }])
    expect(h.requests).toEqual([])
    expect(viewOf(h)).toMatchObject({ state: 'closed', restart: { reason } })

    await h.sessions.start(PROJECT, NODE)
    expect(h.requests).toEqual([{ resume: OTHER }])
    await vi.waitFor(() => expect(notices(h)).toEqual([`worfy: not continued: ${reason}`]), UNTIL)
    expect(prompts(h)).toEqual([])
    expect(h.registry.get(viewOf(h)?.sessionId ?? '').queued()).toMatchObject({ items: [{ text: 'after that, the tests' }], paused: true })
  })
})

describe('what the continuation leaves alone or waits for', () => {
  it('a Session a Run owns is left to the Run', async () => {
    savedNode()
    writeRecords([{ ...RECORD, kind: 'orchestrator', runId: makeRunId(new Date(), 'abcdef') }])
    writeTranscript([said('go on', 3)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    const orchestrator = vi.fn(() => Promise.reject(new Error('the Run continues it')))
    const node = vi.fn(() => Promise.reject(new Error('the Run continues it')))
    expect(await continuity(h, { orchestrator, node }).run()).toMatchObject([{ outcome: 'skipped' }])
    expect(orchestrator).not.toHaveBeenCalled()
    expect(node).not.toHaveBeenCalled()
    expect(h.requests).toEqual([])
  })

  it('the previous process of the Session still runs: the continuation waits for its exit', async () => {
    savedNode()
    writeRecords([RECORD])
    writeTranscript([said('go on', 3)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    let exit: (gone: boolean) => void = () => undefined
    const exited = vi.fn<ContinuityDeps['exited']>(() => new Promise<boolean>((done) => (exit = done)))
    const kill = vi.fn()
    const running = continuity(h, { previous: () => Promise.resolve({ pid: 4242, orphan: true }), exited, kill }).run()
    await vi.waitFor(() => expect(exited).toHaveBeenCalledTimes(1), UNTIL)
    expect(h.requests).toEqual([])
    exit(true)
    expect(await running).toMatchObject([{ outcome: 'continued' }])
    expect(h.requests).toEqual([{ resume: SDK }])
    expect(kill).not.toHaveBeenCalled()
  })

  it('a previous process that does not exit is killed; one that still runs after that, or that another program runs, keeps the Session from going on', async () => {
    savedNode()
    writeRecords([RECORD])
    writeTranscript([said('go on', 3)])
    const h = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    const kill = vi.fn()
    const exited = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await continuity(h, { previous: () => Promise.resolve({ pid: 4242, orphan: true }), exited, kill }).run()).toMatchObject([{ outcome: 'continued' }])
    expect(kill).toHaveBeenCalledTimes(1)

    const other = app('interrupt', [{ sessionId: SDK, cwd: repo }])
    writeRecords([RECORD])
    const stubborn = continuity(other, { previous: () => Promise.resolve({ pid: 4242, orphan: true }), exited: () => Promise.resolve(false), kill: () => undefined })
    expect(await stubborn.run()).toMatchObject([{ outcome: 'interrupted', reason: 'its previous Claude Code process (pid 4242) did not exit' }])
    const foreign = continuity(other, { previous: () => Promise.resolve({ pid: 77, orphan: false }) })
    expect(await foreign.run()).toMatchObject([{ outcome: 'interrupted', reason: 'it runs in another program (pid 77)' }])
    expect(other.requests).toEqual([])
  })
})

describe('a Codex Session (fake app-server)', () => {
  const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

  it('goes on through thread/resume and one message', async () => {
    const log = join(scratch, 'codex.log')
    const codex = codexSessions(() =>
      Promise.resolve({
        runtime: RUNTIME,
        appPath: REPO,
        clientVersion: '9.9.9',
        env: { ...process.env, WORFY_CODEX_SCRIPT: 'resume', WORFY_CODEX_LOG: log },
        spawnProcess: (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
          const child = spawn(scriptNode(), [...args], options)
          children.push(child)
          return child
        },
        log: () => undefined,
      }),
    )
    const claude = claudeSessions(fakeQueryFactory({ scriptsDir, script: 'turn' }), { model: () => null, effort: () => null })
    const registry = new SessionRegistry({ sessionsOf: (vendor) => (vendor === 'codex' ? codex : claude), partsOf: () => STATIC_CLAUDE_PARTS })
    registries.push(registry)
    savedNode({ origin: 'worfy', vendor: 'codex', sessionId: 'thr_fake_1' })
    writeRecords([{ ...RECORD, vendor: 'codex', vendorSessionId: 'thr_fake_1' }])
    const broadcast: AgentEventEnvelope[] = []
    const sessions = new NodeSessions({
      layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
      projectPath: () => repo,
      registry,
      settings: { read: () => undefined, write: () => undefined },
      claude: () => Promise.resolve({ live: [], history: [] }),
      vendorSessions: () => Promise.resolve({ live: [], history: [{ sessionId: 'thr_fake_1', cwd: repo }] }),
      isDirectory: () => Promise.resolve(true),
      broadcast: (sessionId, event) => broadcast.push({ sessionId, event }),
      publish: () => undefined,
    })
    const h = { sessions, live: { noteContinued: () => undefined } } as unknown as App
    // What Codex's history gives of the thread: the person's message of the cut-off turn.
    const transcript = () => Promise.resolve({ entries: parseTranscriptLines([said('write the tests', 2)]), subagents: [] })
    expect(await continuity(h, { transcript }).run()).toMatchObject([{ outcome: 'continued' }])
    const sent = (method: string): string[] => (readFileSync(log, 'utf8').split('\n') as string[]).filter((line) => line.includes(`"method":"${method}"`))
    await vi.waitFor(() => expect(sent('turn/start')).toHaveLength(1), { timeout: ms(15_000), interval: 20 })
    expect(sent('thread/resume')).toEqual([expect.stringContaining('"threadId":"thr_fake_1"')])
    expect(sent('thread/start')).toEqual([])
    expect(sent('turn/start')[0]).toContain('worfy restarted at')
  })
})
