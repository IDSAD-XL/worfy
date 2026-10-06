// The Orchestrator of a Project (src/main/agent/orchestrator.ts) over the real Layout store and
// Session registry, on the fake agent: its locked Node, the view main keeps of it while the
// Session runs, what main writes into the Node's data (the session id and the cost, nothing else),
// where the picked model, effort and permission mode are kept instead (session-settings.ts),
// resume after a restart and when the saved session is gone, the `orchestrator.*` channels and
// main's own wiring (src/main/agent/app-orchestrators.ts).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { CostCounter, Orchestrators, orchestratorPlace } from '../../src/main/agent/orchestrator'
import type { TranscriptFacts } from '../../src/main/agent/orchestrator-transcript'
import { SessionRegistry, type QueryFactory, type QueryRequest } from '../../src/main/agent/session'
import { SESSION_SETTINGS_FILE, SessionSettingsStore } from '../../src/main/agent/session-settings'
import { LayoutStore } from '../../src/main/layout/store'
import type { AgentEventEnvelope } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import {
  ORCHESTRATOR_HEIGHT,
  ORCHESTRATOR_WIDTH,
  orchestratorDataSchema,
  readOrchestratorData,
  type OrchestratorView,
} from '../../src/shared/ipc/orchestrator'
import type { LayoutNode } from '../../src/shared/layout/types'

const electron = vi.hoisted(() => ({
  listeners: new Map<string, (() => void)[]>(),
  sent: [] as { channel: string; payload: unknown }[],
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/nowhere',
    on: (event: string, listener: () => void) => electron.listeners.set(event, [...(electron.listeners.get(event) ?? []), listener]),
  },
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }) } },
    ],
  },
}))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const PROJECT = 'demo-0000000d'

const BLOCK_1 = [
  '— Этап: worfy-mvp · /implement · волна 5',
  '— Сейчас: тикет 08 в работе, тесты пишутся',
  '— Дальше: PR и зелёный CI',
  '— Жду: ничего',
].join('\n')
const BLOCK_3 = ['- Этап: worfy-mvp · /implement · волна 6', '- Сейчас: PR #21 ждёт ревью', '- Дальше: мерж волны 5', '- Жду: решение владельца по ADR'].join('\n')
const BLOCK_TERMINAL = ['— Этап: worfy-mvp · из терминала', '— Сейчас: продолжено через claude --resume', '— Дальше: вернуться в worfy', '— Жду: ничего'].join('\n')

let scratch: string
let repo: string
/** Registries of the test, closed before its folder goes, so no late write lands in a removed folder. */
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-orchestrator-')))
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  // The user's model and effort come from <Claude home>/settings.json: an empty home of the test's
  // own, never the real ~/.claude.
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface HarnessOptions {
  script?: string | ((request: QueryRequest) => string)
  scripts?: string
  /** Wraps the fake agent, e.g. to refuse a resume the way Claude Code does. */
  factory?: (fake: QueryFactory) => QueryFactory
  /** The transcript of a saved session: found with these facts (default), missing (null), unreadable (an Error) or still being read (a Promise). */
  transcript?: (sdkSessionId: string) => TranscriptFacts | null | Error | Promise<TranscriptFacts | null>
}

const NO_FACTS: TranscriptFacts = { model: null, statusBlock: null }

/** One run of the app: a Layout store over the data folder, a registry on the fake agent, the Orchestrators. */
function harness(options: HarnessOptions = {}) {
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const requests: QueryRequest[] = []
  const fake = fakeQueryFactory({ scriptsDir: options.scripts ?? scriptsDir, script: options.script ?? 'orchestrator' })
  const factory = options.factory?.(fake) ?? fake
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    return factory(request)
  })
  registries.push(registry)
  const broadcast: AgentEventEnvelope[] = []
  const published: OrchestratorView[] = []
  const transcriptCalls: { projectRoot: string; sdkSessionId: string }[] = []
  const known = new Set([PROJECT])
  const orchestrators = new Orchestrators({
    layout,
    projectPath: (projectId) => {
      if (!known.has(projectId)) throw new Error(`No Project with id ${projectId}`)
      return repo
    },
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: (projectRoot, sdkSessionId) => {
      transcriptCalls.push({ projectRoot, sdkSessionId })
      const answer = options.transcript ? options.transcript(sdkSessionId) : NO_FACTS
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
    broadcast: (sessionId, event) => broadcast.push({ sessionId, event }),
    publish: (view) => published.push(view),
  })
  const node = (): LayoutNode => {
    const found = layout.get(PROJECT).layout.nodes.filter((each) => each.kind === 'orchestrator')
    expect(found).toHaveLength(1)
    return found[0] as LayoutNode
  }
  const data = () => node().data
  const view = (): OrchestratorView => {
    const current = orchestrators.view(node().id)
    if (current === null) throw new Error('no view yet')
    return current
  }
  /** The live Session's id, for registry.get(). */
  const sessionId = (): string => view().sessionId ?? ''
  /** Every state the view went through, in order, without repeats. */
  const states = () => published.map((each) => each.state).filter((state, index, all) => index === 0 || all[index - 1] !== state)
  return { layout, registry, requests, broadcast, published, transcriptCalls, orchestrators, node, data, view, sessionId, states, known }
}

/** A layout.json with an Orchestrator Node whose data is `data`. */
function savedNode(data: Record<string, unknown>): void {
  writeFileSync(
    join(scratch, 'data', PROJECT, 'layout.json'),
    JSON.stringify({ nodes: [{ id: 'orch', kind: 'orchestrator', x: 10, y: 20, w: 300, h: 180, locked: true, data }] }),
  )
}

/** The Project's settings file (src/main/agent/session-settings.ts). */
const settingsFile = (): string => join(scratch, 'data', PROJECT, SESSION_SETTINGS_FILE)

function writeSettings(value: unknown): void {
  writeFileSync(settingsFile(), JSON.stringify(value))
}

describe('Orchestrator Node', () => {
  it('is created locked on the first open, once: concurrent and later opens keep the Node and the Session', async () => {
    const h = harness()
    const [first, second] = await Promise.all([h.orchestrators.open(PROJECT), h.orchestrators.open(PROJECT)])
    const node = h.node()
    expect(node).toMatchObject({ id: first.nodeId, kind: 'orchestrator', locked: true, x: 40, y: 40, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT })
    expect(first).toMatchObject({ projectId: PROJECT, sessionId: h.requests[0]?.sessionId ?? 'no session id asked for' })
    expect(second.sessionId).toBe(first.sessionId)
    expect((await h.orchestrators.open(PROJECT)).sessionId).toBe(first.sessionId)
    expect(h.requests).toHaveLength(1)
    expect(h.layout.get(PROJECT).layout.nodes).toHaveLength(1)
    // No session reported yet: nothing to keep, and a new Session reads no transcript.
    expect(h.data()).toStrictEqual({})
    expect(h.transcriptCalls).toEqual([])
  })

  it('cannot be removed, but can be moved and resized', async () => {
    const h = harness()
    const { nodeId } = await h.orchestrators.open(PROJECT)
    expect(() => h.layout.apply(PROJECT, { op: 'remove', id: nodeId })).toThrow(/locked/)
    h.layout.apply(PROJECT, { op: 'move', id: nodeId, x: 400, y: 300 })
    h.layout.apply(PROJECT, { op: 'resize', id: nodeId, w: 500, h: 260 })
    expect(h.node()).toMatchObject({ x: 400, y: 300, w: 500, h: 260, locked: true })
  })

  it('goes under the Nodes already on the Canvas instead of covering them', () => {
    const note = (x: number, y: number, w = 220, h = 120) => ({ id: `${x}-${y}`, kind: 'note', x, y, w, h, hidden: false, locked: false, pinned: false, tags: [], data: {} })
    expect(orchestratorPlace([])).toEqual({ x: 40, y: 40 })
    expect(orchestratorPlace([note(600, 40)])).toEqual({ x: 40, y: 40 })
    expect(orchestratorPlace([note(120, 80), note(500, 300, 100, 50)])).toEqual({ x: 120, y: 390 })
  })

  it('is found again by its kind; the Session resumes the saved session and shows the model and block of its transcript', async () => {
    // A damaged field is dropped and the rest still counts; keys of an older build are not read.
    savedNode({ sessionId: 'sdk-saved', costUsd: 'damaged', statusBlock: 'stale block from layout.json', model: 'stale-model' })
    const h = harness({ transcript: () => ({ model: 'claude-sonnet-5', statusBlock: BLOCK_TERMINAL }) })
    const opened = await h.orchestrators.open(PROJECT)
    expect(opened.nodeId).toBe('orch')
    expect(h.transcriptCalls).toEqual([{ projectRoot: repo, sdkSessionId: 'sdk-saved' }])
    expect(h.requests.map((request) => request.resume)).toEqual(['sdk-saved'])
    expect(opened).toMatchObject({ state: 'starting', model: 'claude-sonnet-5', statusBlock: BLOCK_TERMINAL, costUsd: 0 })
    await vi.waitFor(() => expect(h.view().state).toBe('idle'))
  })

  it('a Project that is not in the list has no Orchestrator', async () => {
    const h = harness()
    await expect(h.orchestrators.open('nope-00000000')).rejects.toThrow(/No Project/)
    expect(h.requests).toEqual([])
  })

  it('has no view for a Node main does not run', () => {
    expect(harness().orchestrators.view('no-such-node')).toBeNull()
  })
})

describe('Orchestrator Session', () => {
  it('shows state, model, cost and the last status block; keeps only the session id and the cost in the Node data', async () => {
    const h = harness()
    const tempId = (await h.orchestrators.open(PROJECT)).sessionId ?? ''
    await vi.waitFor(() => expect(h.view().state).toBe('idle'))
    expect(h.view()).toMatchObject({ model: null, statusBlock: null, costUsd: 0, error: null })

    // Turn 1 of the script holds the turn open after its answer until it is interrupted (a message
    // sent during a turn waits in the queue, ticket 19).
    h.registry.get(tempId).send('прогони волну 5')
    await vi.waitFor(() => expect(h.view().statusBlock).toBe(BLOCK_1))
    expect(h.view().state).toBe('busy')
    const sdkId = h.view().sessionId
    expect(sdkId).toMatch(/^[0-9a-f-]{36}$/)
    expect(h.view().model).toBe('claude-opus-5-5')
    expect(h.data()).toStrictEqual({ sessionId: sdkId })
    void h.registry.get(tempId).interrupt()
    await vi.waitFor(() => expect(h.view().costUsd).toBe(0.0125))
    expect(h.view().state).toBe('idle')

    // Turn 2: a subagent's block, a block in text Claude Code wrote itself, and an answer without
    // one change nothing.
    h.registry.get(tempId).send('статус')
    await vi.waitFor(() => expect(h.view().costUsd).toBe(0.02))
    expect(h.view().statusBlock).toBe(BLOCK_1)

    // Turn 3: of two blocks, the last one.
    h.registry.get(tempId).send('статус')
    await vi.waitFor(() => expect(h.view().costUsd).toBe(0.03))
    expect(h.view()).toMatchObject({ state: 'idle', error: null, sessionId: sdkId, model: 'claude-opus-5-5', costUsd: 0.03, statusBlock: BLOCK_3 })
    expect(h.states()).toEqual(['starting', 'idle', 'busy', 'idle', 'busy', 'idle', 'busy', 'idle'])
    // The Layout keeps nothing that the transcript or the live Session already has.
    expect(h.data()).toStrictEqual({ sessionId: sdkId, costUsd: 0.03 })

    // Views only grow in version; every event also went out under the Session's id.
    const versions = h.published.map((each) => each.version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
    expect(new Set(versions).size).toBe(versions.length)
    expect(h.broadcast.filter((e) => e.event.type === 'result')).toHaveLength(3)
    expect(h.broadcast.find((e) => e.event.type === 'renamed')).toBeUndefined()
  })

  it('after a restart resumes the saved session, shows its transcript rather than anything kept, and keeps counting its cost', async () => {
    const first = harness()
    const { sessionId } = await first.orchestrators.open(PROJECT)
    first.registry.get(sessionId ?? '').send('one')
    await vi.waitFor(() => expect(first.view().statusBlock).toBe(BLOCK_1))
    void first.registry.get(sessionId ?? '').interrupt()
    await vi.waitFor(() => expect(first.view().costUsd).toBe(0.0125))
    const sdkId = first.view().sessionId
    first.registry.closeAll()
    first.layout.flushAll()
    const onDisk = JSON.parse(readFileSync(join(scratch, 'data', PROJECT, 'layout.json'), 'utf8')) as { nodes: LayoutNode[] }
    expect(onDisk.nodes[0]?.data).toStrictEqual({ sessionId: sdkId, costUsd: 0.0125 })

    // Meanwhile the session went on in a terminal: its transcript has a newer block.
    const second = harness({ transcript: () => ({ model: 'claude-sonnet-5', statusBlock: BLOCK_TERMINAL }) })
    const reopened = await second.orchestrators.open(PROJECT)
    expect(second.requests.map((request) => request.resume)).toEqual([sdkId])
    expect(reopened).toMatchObject({ state: 'starting', statusBlock: BLOCK_TERMINAL, model: 'claude-sonnet-5', costUsd: 0.0125 })
    second.registry.get(second.sessionId()).send('one')
    await vi.waitFor(() => expect(second.view().state).toBe('busy'))
    void second.registry.get(second.sessionId()).interrupt()
    // A new Claude Code process counts from zero: 0.0125 before the restart + 0.0125 now.
    await vi.waitFor(() => expect(second.view().costUsd).toBe(0.025))
    expect(second.data()).toStrictEqual({ sessionId: sdkId, costUsd: 0.025 })
  })

  it('the Node data declares only the session id and the cost (ADR-0010); other keys are not read back', () => {
    expect(Object.keys(orchestratorDataSchema.shape).sort()).toEqual(['costUsd', 'sessionId'])
    expect(readOrchestratorData({ sessionId: 'sdk-1', costUsd: 1, settings: { model: 'sonnet', effort: 'low', permissionMode: 'plan' }, extra: true })).toStrictEqual({
      sessionId: 'sdk-1',
      costUsd: 1,
    })
  })

  it('keeps the picked model, effort and permission mode in its own file, not in the Node data, and resumes with them after a restart', async () => {
    const picked = { model: 'sonnet', effort: 'low', permissionMode: 'plan' } as const
    const first = harness()
    const { sessionId } = await first.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(first.view().state).toBe('idle'))
    // The defaults change nothing: no Node data, no settings file.
    expect(first.data()).toStrictEqual({})
    expect(existsSync(settingsFile())).toBe(false)
    await first.registry.get(sessionId ?? '').configure(picked)
    // ADR-0010: the Node data stays the session id and the cost; the picks go to the settings file, under the Node id.
    expect(first.data()).toStrictEqual({})
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8'))).toStrictEqual({ nodes: { [first.node().id]: picked } })
    first.registry.get(sessionId ?? '').send('one')
    await vi.waitFor(() => expect(first.view().statusBlock).toBe(BLOCK_1))
    // Claude Code's next turn runs with the picked model.
    expect(first.view().model).toBe('sonnet')
    void first.registry.get(sessionId ?? '').interrupt()
    await vi.waitFor(() => expect(first.view().costUsd).toBe(0.0125))
    const sdkId = first.view().sessionId
    first.registry.closeAll()
    first.layout.flushAll()
    const onDisk = JSON.parse(readFileSync(join(scratch, 'data', PROJECT, 'layout.json'), 'utf8')) as { nodes: LayoutNode[] }
    expect(onDisk.nodes[0]?.data).toStrictEqual({ sessionId: sdkId, costUsd: 0.0125 })

    // A new run of the app: new stores over the same data folder.
    const second = harness()
    await second.orchestrators.open(PROJECT)
    expect(second.requests).toMatchObject([{ resume: sdkId, settings: picked }])
    expect(second.registry.get(second.sessionId()).settings).toEqual(picked)
  })

  it('keeps the picks when the saved session cannot be resumed and a new one starts', async () => {
    savedNode({ sessionId: 'sdk-gone' })
    writeSettings({ nodes: { orch: { model: 'opus', effort: 'max', permissionMode: 'acceptEdits' } } })
    const h = harness({ transcript: () => null })
    await h.orchestrators.open(PROJECT)
    expect(h.requests).toMatchObject([{ resume: undefined, settings: { model: 'opus', effort: 'max', permissionMode: 'acceptEdits' } }])
  })

  it('reads damaged settings field by field, falling back to the defaults; another Node\'s picks are not its own', async () => {
    savedNode({ sessionId: null })
    writeSettings({ nodes: { orch: { model: 42, effort: 'ultra', permissionMode: 'acceptEdits', extra: true }, other: { model: 'haiku', effort: null, permissionMode: 'plan' } } })
    const h = harness()
    await h.orchestrators.open(PROJECT)
    expect(h.requests.map((request) => request.settings)).toStrictEqual([{ model: null, effort: null, permissionMode: 'acceptEdits' }])
  })

  it('ignores settings left in the Node data by an older build', async () => {
    savedNode({ sessionId: null, settings: { model: 'sonnet', effort: 'low', permissionMode: 'plan' } })
    const h = harness()
    await h.orchestrators.open(PROJECT)
    expect(h.requests.map((request) => request.settings)).toStrictEqual([DEFAULT_SETTINGS])
  })

  it.each([
    ['is not JSON', () => writeFileSync(settingsFile(), '{"nodes": {')],
    ['does not match its schema', () => writeSettings({ nodes: ['orch'] })],
  ])('a settings file that %s does not stop the start: the defaults are used and the file is set aside', async (_name, damage) => {
    savedNode({ sessionId: null })
    damage()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = harness()
    await h.orchestrators.open(PROJECT)
    expect(h.requests.map((request) => request.settings)).toStrictEqual([DEFAULT_SETTINGS])
    expect(readdirSync(join(scratch, 'data', PROJECT)).filter((name) => name.startsWith('session-settings.json.unreadable-'))).toHaveLength(1)
    // The next pick writes a new file.
    await h.registry.get(h.sessionId()).configure({ permissionMode: 'plan' })
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8'))).toStrictEqual({ nodes: { orch: { ...DEFAULT_SETTINGS, permissionMode: 'plan' } } })
    warn.mockRestore()
  })

  it('a settings file that cannot be read or written at all does not stop the Session', async () => {
    savedNode({ sessionId: null })
    // A folder where the file should be: reading and writing both fail with EISDIR.
    mkdirSync(settingsFile())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = harness()
    await h.orchestrators.open(PROJECT)
    expect(h.requests.map((request) => request.settings)).toStrictEqual([DEFAULT_SETTINGS])
    await expect(h.registry.get(h.sessionId()).configure({ model: 'sonnet' })).resolves.toMatchObject({ model: 'sonnet' })
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([expect.stringContaining('could not read the saved settings'), expect.stringContaining('could not save the settings')]),
    )
    h.registry.get(h.sessionId()).send('one')
    await vi.waitFor(() => expect(h.view().statusBlock).toBe(BLOCK_1))
    warn.mockRestore()
  })

  it('a crashed Session shows error with its reason; the process it is resumed in counts its cost on top', async () => {
    const scripts = join(scratch, 'scripts')
    mkdirSync(scripts)
    const init = (model: string) =>
      JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model, permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-0000000000c1' })
    const result = (cost: number) =>
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: cost, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-0000000000c2' })
    const wait = JSON.stringify({ fake: 'wait_message' })
    writeFileSync(join(scripts, 'crash-after-turn.jsonl'), [wait, init('m'), result(0.5), wait, JSON.stringify({ fake: 'crash', error: 'Claude Code process exited with code 1' })].join('\n'))
    writeFileSync(join(scripts, 'after-crash.jsonl'), [wait, init('m'), result(0.6)].join('\n'))
    const h = harness({ scripts, script: (request) => (request.resume === undefined ? 'crash-after-turn' : 'after-crash') })

    await h.orchestrators.open(PROJECT)
    h.registry.get(h.sessionId()).send('one')
    await vi.waitFor(() => expect(h.view().costUsd).toBe(0.5))
    h.registry.get(h.sessionId()).send('two')
    await vi.waitFor(() => expect(h.view().state).toBe('error'))
    expect(h.view().error).toMatch(/exited with code 1/)

    // The next message starts a new Claude Code process, which reports 0.6 for itself.
    h.registry.get(h.sessionId()).send('three')
    await vi.waitFor(() => expect(h.view().state).toBe('idle'))
    expect(h.requests.map((request) => request.resume)).toEqual([undefined, h.view().sessionId])
    expect(h.view().costUsd).toBeCloseTo(1.1, 10)
    expect(h.data().costUsd).toBeCloseTo(1.1, 10)
  })

  it('a closed Orchestrator is started again by the next open, resuming its session', async () => {
    const h = harness()
    const first = await h.orchestrators.open(PROJECT)
    h.registry.get(h.sessionId()).send('one')
    await vi.waitFor(() => expect(h.data().sessionId).toBeDefined())
    h.registry.get(h.sessionId()).close()
    expect(h.view().state).toBe('closed')
    const again = await h.orchestrators.open(PROJECT)
    expect(again.sessionId).not.toBe(first.sessionId)
    expect(h.requests.map((request) => request.resume)).toEqual([undefined, h.data().sessionId])
  })

  it('retain stops the Orchestrators of Projects removed from the list', async () => {
    const h = harness()
    const opened = await h.orchestrators.open(PROJECT)
    const { nodeId } = opened
    const sessionId = opened.sessionId ?? ''
    h.orchestrators.retain(new Set([PROJECT]))
    expect(h.registry.get(sessionId).state).not.toBe('closed')
    h.known.delete(PROJECT)
    h.orchestrators.retain(new Set())
    expect(() => h.registry.get(sessionId)).toThrow(/No live Session/)
    expect(h.orchestrators.view(nodeId)).toBeNull()
  })

  it('a Project removed while its transcript is read never starts its Session', async () => {
    savedNode({ sessionId: 'sdk-saved' })
    let release: (facts: TranscriptFacts) => void = () => undefined
    const h = harness({ transcript: () => new Promise<TranscriptFacts>((done) => (release = done)) })
    const opening = h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.transcriptCalls).toHaveLength(1))
    h.known.delete(PROJECT)
    h.orchestrators.retain(new Set())
    release(NO_FACTS)
    await expect(opening).rejects.toThrow(/was stopped/)
    expect(h.requests).toEqual([])
    expect(h.published).toEqual([])
  })
})

describe('a saved session that cannot be resumed', () => {
  it('whose transcript is gone: the Orchestrator starts a new session instead and forgets the old one', async () => {
    savedNode({ sessionId: 'sdk-gone', costUsd: 4.2 })
    const h = harness({ transcript: () => null })
    const opened = await h.orchestrators.open(PROJECT)
    expect(h.requests.map((request) => request.resume)).toEqual([undefined])
    expect(opened).toMatchObject({ costUsd: 0, statusBlock: null })
    expect(h.data()).toStrictEqual({ sessionId: null, costUsd: 0 })
    h.registry.get(h.sessionId()).send('one')
    await vi.waitFor(() => expect(h.data().sessionId).toMatch(/^[0-9a-f-]{36}$/))
  })

  it('whose transcript cannot be read: the session is kept and resumed', async () => {
    savedNode({ sessionId: 'sdk-saved', costUsd: 1 })
    const h = harness({ transcript: () => new Error('EACCES: permission denied') })
    const opened = await h.orchestrators.open(PROJECT)
    expect(h.requests.map((request) => request.resume)).toEqual(['sdk-saved'])
    expect(opened).toMatchObject({ costUsd: 1, statusBlock: null, model: null })
    expect(h.data()).toStrictEqual({ sessionId: 'sdk-saved', costUsd: 1 })
  })

  it('that Claude Code refuses: a new Session starts a new session, and messages go through again', async () => {
    savedNode({ sessionId: 'sdk-expired', costUsd: 2 })
    const refuseResume = (fake: QueryFactory): QueryFactory => (request) =>
      request.resume === undefined ? fake(request) : Promise.reject(new Error(`No conversation found with session ID: ${request.resume}`))
    const h = harness({ factory: refuseResume })
    await h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.requests.map((request) => request.resume)).toEqual(['sdk-expired', undefined]))
    // The refused Session is closed, not left in error for every message to fail again.
    const refused = h.published.find((each) => each.sessionId !== null)?.sessionId ?? ''
    expect(refused).toMatch(/^pending-/)
    expect(() => h.registry.get(refused)).toThrow(/No live Session/)
    expect(h.sessionId()).not.toBe(refused)
    await vi.waitFor(() => expect(h.view().state).toBe('idle'))
    expect(h.view()).toMatchObject({ costUsd: 0, error: null })
    expect(h.data()).toStrictEqual({ sessionId: null, costUsd: 0 })
    expect(h.states()).not.toContain('error')

    h.registry.get(h.sessionId()).send('one')
    await vi.waitFor(() => expect(h.view().statusBlock).toBe(BLOCK_1))
    expect(h.data().sessionId).toBe(h.view().sessionId)
    expect(h.requests).toHaveLength(2)
  })

  it('a start that fails for another reason keeps the session: the Node shows the error', async () => {
    savedNode({ sessionId: 'sdk-saved', costUsd: 2 })
    const noSpace = (fake: QueryFactory): QueryFactory => (request) =>
      request.resume === undefined ? fake(request) : Promise.reject(new Error('ENOSPC: no space left on device'))
    const h = harness({ factory: noSpace })
    await h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.view().state).toBe('error'))
    expect(h.view().error).toMatch(/ENOSPC/)
    expect(h.requests.map((request) => request.resume)).toEqual(['sdk-saved'])
    expect(h.data()).toStrictEqual({ sessionId: 'sdk-saved', costUsd: 2 })
  })

  it.each([
    ['after Claude Code reported the session', 'resumed', 'No conversation found with session ID: x'],
    ['of a new session, with nothing to resume', 'new', 'No conversation found with session ID: x'],
  ])('the same refusal %s is an error like any other: nothing starts over', async (_label, start, message) => {
    const scripts = join(scratch, 'scripts')
    mkdirSync(scripts)
    const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-0000000000d1' })
    const wait = JSON.stringify({ fake: 'wait_message' })
    // Resumed: the refusal comes after init. New: it comes before any init, but there was no resume.
    const lines = start === 'resumed' ? [wait, init, JSON.stringify({ fake: 'crash', error: message })] : [JSON.stringify({ fake: 'crash', error: message })]
    writeFileSync(join(scripts, 'refuse.jsonl'), lines.join('\n'))
    if (start === 'resumed') savedNode({ sessionId: 'sdk-saved', costUsd: 2 })
    const h = harness({ scripts, script: 'refuse' })
    await h.orchestrators.open(PROJECT)
    if (start === 'resumed') h.registry.get(h.sessionId()).send('one')
    await vi.waitFor(() => expect(h.view().state).toBe('error'))
    expect(h.requests).toHaveLength(1)
    expect(h.data().sessionId ?? null).toBe(start === 'resumed' ? 'sdk-saved' : null)
  })

  it('a session already live in another Session: the view says so, and the next open tries again', async () => {
    savedNode({ sessionId: 'sdk-saved' })
    const h = harness()
    const other = h.registry.start(repo, 'sdk-saved', () => undefined)
    const refused = await h.orchestrators.open(PROJECT)
    expect(refused).toMatchObject({ state: 'error', error: expect.stringMatching(/already live/) as unknown, sessionId: null })
    other.close()
    const again = await h.orchestrators.open(PROJECT)
    expect(again.state).toBe('starting')
    expect(h.requests.map((request) => request.resume)).toEqual(['sdk-saved', 'sdk-saved'])
  })
})

describe('SessionSettingsStore', () => {
  it("saves one Node's picks and keeps the other Nodes'; a Project that is not in the list is refused", () => {
    const store = new SessionSettingsStore((projectId) => {
      if (projectId !== PROJECT) throw new Error(`No Project with id ${projectId}`)
      return join(scratch, 'data', projectId)
    })
    const a = { model: 'sonnet', effort: 'low', permissionMode: 'plan' } as const
    const b = { model: null, effort: 'max', permissionMode: 'acceptEdits' } as const
    expect(store.read(PROJECT, 'a')).toBeUndefined()
    store.write(PROJECT, 'a', a)
    store.write(PROJECT, 'b', b)
    expect(store.read(PROJECT, 'a')).toStrictEqual(a)
    expect(store.read(PROJECT, 'b')).toStrictEqual(b)
    expect(store.read(PROJECT, 'c')).toBeUndefined()
    expect(() => store.write(PROJECT, 'a', { ...a, effort: 'ultra' } as never)).toThrow(/does not match its schema/)
    expect(store.read(PROJECT, 'a')).toStrictEqual(a)
    expect(() => store.write('gone-0000000f', 'a', a)).toThrow(/No Project/)
    expect(existsSync(join(scratch, 'data', 'gone-0000000f'))).toBe(false)
  })
})

describe('CostCounter', () => {
  it('adds the processes of a Session: a crash or a smaller figure starts a new process', () => {
    const cost = new CostCounter(1)
    expect(cost.result(0.5)).toBe(1.5)
    expect(cost.result(0.75)).toBe(1.75)
    cost.processEnded()
    expect(cost.result(0.25)).toBe(2)
    // No crash reported, but the figure went down: a new process.
    expect(cost.result(0.1)).toBe(2.1)
  })
})

describe('orchestrator.* channels', () => {
  const view: OrchestratorView = {
    projectId: PROJECT,
    nodeId: 'orch',
    sessionId: 'pending-1',
    state: 'idle',
    error: null,
    model: 'claude-opus-5-5',
    costUsd: 0.5,
    statusBlock: BLOCK_1,
    version: 3,
  }

  async function channels(fake: { open: (projectId: string) => unknown; view: (nodeId: string) => unknown }) {
    const { orchestratorHandlers } = await import('../../src/main/ipc/orchestrator')
    const { registerIpc } = await import('../../src/main/ipc/index')
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    const spies = { open: vi.fn(fake.open), view: vi.fn(fake.view) }
    await registerIpc(
      { handle: (name, listener) => handlers.set(name, listener) },
      { modules: { './orchestrator.ts': () => Promise.resolve(orchestratorHandlers(() => spies as unknown as Orchestrators)) }, isTrustedSender: (url) => url === APP_URL },
    )
    const call = async <T,>(channel: string, input: unknown) => {
      const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
      if (!listener) throw new Error(`${channel} is not registered`)
      return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
    }
    return { call, spies }
  }

  it.each([
    ['no projectId', {}],
    ['a projectId of the wrong type', { projectId: 7 }],
    ['an empty projectId', { projectId: '' }],
  ])('orchestrator.open rejects %s before the handler runs', async (_label, input) => {
    const { call, spies } = await channels({ open: () => view, view: () => view })
    const result = await call('orchestrator.open', input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/orchestrator\.open: invalid input/)
    expect(spies.open).not.toHaveBeenCalled()
  })

  it('orchestrator.open passes only the projectId and answers only the declared keys', async () => {
    const { call, spies } = await channels({ open: () => Promise.resolve({ ...view, internal: 'leak' }), view: () => view })
    expect(await call('orchestrator.open', { projectId: PROJECT, admin: true })).toStrictEqual({ ok: true, value: view })
    expect(spies.open).toHaveBeenCalledWith(PROJECT)
  })

  it('orchestrator.open refuses an answer outside the contract', async () => {
    const { call } = await channels({ open: () => ({ ...view, state: 'sleeping' }), view: () => view })
    expect((await call('orchestrator.open', { projectId: PROJECT })).ok).toBe(false)
  })

  it.each([
    ['no nodeId', {}],
    ['a nodeId of the wrong type', { nodeId: 7 }],
    ['an empty nodeId', { nodeId: '' }],
  ])('orchestrator.view rejects %s before the handler runs', async (_label, input) => {
    const { call, spies } = await channels({ open: () => view, view: () => view })
    const result = await call('orchestrator.view', input)
    expect(!result.ok && result.error).toMatch(/orchestrator\.view: invalid input/)
    expect(spies.view).not.toHaveBeenCalled()
  })

  it('orchestrator.view answers the view without extra keys, or null', async () => {
    const { call, spies } = await channels({ open: () => view, view: (nodeId) => (nodeId === 'orch' ? { ...view, internal: 'leak' } : null) })
    expect(await call('orchestrator.view', { nodeId: 'orch', extra: 1 })).toStrictEqual({ ok: true, value: { view } })
    expect(spies.view).toHaveBeenCalledWith('orch')
    expect(await call('orchestrator.view', { nodeId: 'other' })).toStrictEqual({ ok: true, value: { view: null } })
  })

  it('orchestrator.view refuses a view outside the contract', async () => {
    const { call } = await channels({ open: () => view, view: () => ({ ...view, costUsd: -1 }) })
    expect((await call('orchestrator.view', { nodeId: 'orch' })).ok).toBe(false)
  })
})

/** Every file under `dir`, relative, with its size: what a test compares before and after. */
function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return `${path.slice(dir.length)}:${readFileSync(path).length}`
    })
    .sort()
}

describe("main's own wiring", () => {
  it('opens the active Project on the first window, a Project that becomes active, and stops a removed one; writes nothing into the Projects or the Claude home', async () => {
    const other = join(scratch, 'other')
    mkdirSync(other)
    mkdirSync(join(scratch, 'data', 'other-0000000e'))
    const home = join(scratch, 'claude-home')
    mkdirSync(join(home, 'projects'), { recursive: true })
    writeFileSync(
      join(scratch, 'data', 'projects.json'),
      JSON.stringify({ projects: [{ id: PROJECT, name: 'repo', path: repo }, { id: 'other-0000000e', name: 'other', path: other }], activeId: PROJECT }),
    )
    vi.stubEnv('WORFY_DATA_DIR', join(scratch, 'data'))
    vi.stubEnv('WORFY_CLAUDE_HOME', home)
    vi.stubEnv('WORFY_AGENT', 'fake')
    vi.stubEnv('WORFY_AGENT_SCRIPTS', scriptsDir)
    vi.stubEnv('WORFY_AGENT_SCRIPT', 'orchestrator')
    // Only this module instance may answer the window event: an earlier import of the module
    // (the channel tests) runs over the real data folder.
    electron.listeners.clear()
    electron.sent.length = 0
    vi.resetModules()
    try {
      const { startOrchestrators, sharedOrchestrators } = await import('../../src/main/agent/app-orchestrators')
      const { layoutStore } = await import('../../src/main/layout/store')
      const { projectStore } = await import('../../src/main/projects/store')
      const { sharedRegistry } = await import('../../src/main/agent/app-registry')
      // Loading the IPC handlers subscribes nothing.
      await import('../../src/main/ipc/orchestrator')
      expect(electron.listeners.size).toBe(0)
      const orchestratorOf = (projectId: string) => layoutStore().get(projectId).layout.nodes.filter((node) => node.kind === 'orchestrator')

      startOrchestrators()
      startOrchestrators()
      expect(electron.listeners.get('browser-window-created')).toHaveLength(1)
      // Nothing is opened before there is a window.
      expect(sharedRegistry().list()).toEqual([])
      for (const listener of electron.listeners.get('browser-window-created') ?? []) listener()
      await vi.waitFor(() => expect(sharedRegistry().list()).toMatchObject([{ cwd: repo }]))
      expect(orchestratorOf(PROJECT)).toHaveLength(1)
      await vi.waitFor(() => expect(electron.sent.some(({ channel }) => channel === `${IPC_CHANNEL_PREFIX}agent.event`)).toBe(true))
      const views = electron.sent.filter(({ channel }) => channel === `${IPC_CHANNEL_PREFIX}orchestrator.changed`)
      expect(views.at(-1)?.payload).toMatchObject({ projectId: PROJECT, nodeId: orchestratorOf(PROJECT)[0]?.id })

      projectStore().select('other-0000000e')
      await vi.waitFor(() => expect(sharedRegistry().list().map((session) => session.cwd)).toEqual([repo, other]))
      expect(orchestratorOf('other-0000000e')).toHaveLength(1)
      expect(sharedOrchestrators().view(orchestratorOf('other-0000000e')[0]?.id ?? '')).toMatchObject({ projectId: 'other-0000000e' })
      // A pick goes to the Project's own data folder, under the Node id.
      const otherSession = sharedRegistry().list().find((session) => session.cwd === other)
      await sharedRegistry().get(otherSession?.sessionId ?? '').configure({ permissionMode: 'plan' })
      expect(JSON.parse(readFileSync(join(scratch, 'data', 'other-0000000e', SESSION_SETTINGS_FILE), 'utf8'))).toStrictEqual({
        nodes: { [orchestratorOf('other-0000000e')[0]?.id ?? '']: { ...DEFAULT_SETTINGS, permissionMode: 'plan' } },
      })
      expect(orchestratorOf('other-0000000e')[0]?.data).not.toHaveProperty('settings')

      projectStore().remove(PROJECT)
      expect(sharedRegistry().list().map((session) => session.cwd)).toEqual([other])
      sharedRegistry().closeAll()
      layoutStore().flushAll()
      // ADR 0005: the Projects' repositories and the Claude home stay as they were.
      expect(readdirSync(repo)).toEqual([])
      expect(readdirSync(other)).toEqual([])
      expect(listing(home)).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
