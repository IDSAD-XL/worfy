// The Epic of a Wave in the Orchestrator's Session (worfy-continuity ticket 12): an Orchestrator that
// Autopilot started — the unattended launch at a run's start (setUnattended) and the new SDK session before
// each later Wave (newUnattendedSession) — gets `WORFY_EPIC=<the run's Epic>` in its Claude Code's
// environment and a line of the system prompt that names the Epic (waveInstructions). The Epic is asked of
// the Orchestrators' `waveEpic` when the Session starts: the environment of a process is fixed then. An
// attended Orchestrator — opened by a person, or given back after the run — gets neither, and so the
// Harness's after-compact hook falls back to the Epic of the checkout's branch there.
//
// The chain runs for real from the Orchestrators and the Session registry down to the options of query(),
// as in test/contract/agent-autocompact.test.ts; the Session plays the fake agent. No Claude Code can
// start: query() comes from the test (loadSdk), the SDK module is mocked to throw, and the "packaged" app's
// Resources folder does not exist. Data folder and Claude home are temporary folders.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryFactory, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { waveInstructions } from '../../src/main/vendors/claude/options'
import { LayoutStore } from '../../src/main/layout/store'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  loadSdk: vi.fn(),
  agentEnv: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the Agent SDK module was imported: sdkQueryFactory must take query() from loadSdk')
  },
}))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { sdkQueryFactory } = await import('../../src/main/vendors/claude/query')

const PROJECT = 'demo-0000000e'
const LOGIN_ENV = { HOME: '/Users/someone', PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
const SDK_QUERY = { kind: 'sdk query' }
const NO_RESOURCES = join(tmpdir(), 'worfy-wave-epic-no-resources-0e0e0e', 'Contents', 'Resources')

let dataDir: string
let scratch: string
let repo: string
let registries: SessionRegistry[] = []
let resourcesPath: PropertyDescriptor | undefined

beforeAll(() => {
  dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-wave-epic-data-')))
  vi.stubEnv('WORFY_DATA_DIR', dataDir)
  resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: NO_RESOURCES, configurable: true })
})

afterAll(async () => {
  if (resourcesPath) Object.defineProperty(process, 'resourcesPath', resourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
  vi.unstubAllEnvs()
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-wave-epic-')))
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
  mocks.query.mockReset().mockReturnValue(SDK_QUERY)
  mocks.loadSdk.mockReset().mockResolvedValue({ query: mocks.query })
  mocks.agentEnv.mockReset().mockResolvedValue({ env: LOGIN_ENV, from: 'login-shell' })
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The fake agent's script: one turn per message. */
function scripts(): string {
  const dir = join(scratch, 'scripts')
  mkdirSync(dir)
  const wait = JSON.stringify({ fake: 'wait_message' })
  const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-0000000012e1' })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-0000000012e2' })
  writeFileSync(join(dir, 'turn.jsonl'), [wait, init, result].join('\n'))
  return dir
}

/**
 * The app's chain with `waveEpic` answering what `epic.now` holds, or what `epic` answers when it is a
 * function (which may throw); without `epic`, no waveEpic at all.
 */
function harness(epic?: { now: string | null } | (() => string | null)) {
  const ask = typeof epic === 'function' ? epic : (): string | null => epic?.now ?? null
  const requests: QueryRequest[] = []
  const fake = fakeQueryFactory({ scriptsDir: scripts(), script: 'turn' })
  const sdk = sdkQueryFactory(
    () => Promise.resolve(null),
    () => Promise.resolve([]),
    { loadSdk: mocks.loadSdk },
  )
  const factory: QueryFactory = async (request) => {
    requests.push(request)
    if (((await sdk(request)) as unknown) !== SDK_QUERY) throw new Error('sdkQueryFactory reached past the query() of loadSdk')
    return fake(request)
  }
  const registry = new SessionRegistry(factory, () => null, () => null)
  registries.push(registry)
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const orchestrators = new Orchestrators({
    layout,
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: () => undefined,
    ...(epic === undefined ? {} : { waveEpic: (projectId: string) => (projectId === PROJECT ? ask() : null) }),
  })
  const state = (): string | undefined => {
    const node = layout.get(PROJECT).layout.nodes.find((each) => each.kind === 'orchestrator')
    return node === undefined ? undefined : orchestrators.view(node.id)?.state
  }
  return { requests, orchestrators, state }
}

/** The options query() got at its n-th call. */
function sdkOptions(n: number): { env?: Record<string, string | undefined>; systemPrompt?: unknown } {
  const call = mocks.query.mock.calls[n] as [{ options: { env?: Record<string, string | undefined>; systemPrompt?: unknown } }] | undefined
  if (call === undefined) throw new Error(`query() was called ${mocks.query.mock.calls.length} times, not ${n + 1}`)
  return call[0].options
}

const epicOf = (n: number): string | undefined => sdkOptions(n).env?.WORFY_EPIC
const appended = (n: number): string => {
  const prompt = sdkOptions(n).systemPrompt as { append?: string } | undefined
  return prompt?.append ?? ''
}

describe('the Epic of a Wave in the Orchestrator\'s Session', () => {
  it('an unattended Session carries WORFY_EPIC and the line of the Epic; the attended one before and after it carries neither', async () => {
    const epic = { now: 'ep-a' as string | null }
    const h = harness(epic)
    await h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.state()).toBe('idle'))
    await h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(h.state()).toBe('idle'))
    await h.orchestrators.setUnattended(PROJECT, false)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(3))

    expect(h.requests.map((request) => [request.unattended, request.epic])).toEqual([
      [false, undefined],
      [true, 'ep-a'],
      [false, undefined],
    ])
    expect([epicOf(0), epicOf(1), epicOf(2)]).toEqual([undefined, 'ep-a', undefined])
    // The unattended Session also tells the Harness's guard that no person is at it, and where worfy's data folder is.
    expect(sdkOptions(1).env).toEqual({ ...LOGIN_ENV, WORFY_EPIC: 'ep-a', WORFY_UNATTENDED: '1', WORFY_GUARD_DATA_DIR: dataDir })
    expect(appended(1)).toContain(waveInstructions('ep-a'))
    expect(appended(0)).not.toContain('wave-brief')
    expect(appended(2)).not.toContain('wave-brief')
  })

  it('the new SDK session before a later Wave takes the Epic the run is on when it starts, a later Epic of a queue too', async () => {
    const epic = { now: 'ep-a' as string | null }
    const h = harness(epic)
    await h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.state()).toBe('idle'))
    await h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(h.state()).toBe('idle'))
    epic.now = 'ep-b'
    const view = await h.orchestrators.newUnattendedSession(PROJECT)
    expect(view).not.toBeNull()
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(3))

    expect(h.requests.map((request) => [request.unattended, request.epic])).toEqual([
      [false, undefined],
      [true, 'ep-a'],
      [true, 'ep-b'],
    ])
    expect(epicOf(2)).toBe('ep-b')
    expect(appended(2)).toContain(waveInstructions('ep-b'))
  })

  it.each([
    ['no run answers an Epic', { now: null }],
    ['the Orchestrators have no waveEpic', undefined],
    ['the run answers an empty Epic', { now: '' }],
    [
      'the ask for the Epic throws',
      () => {
        throw new Error('the Autopilot could not tell')
      },
    ],
  ] as const)('an unattended Session still starts and carries no Epic when %s', async (_case, epic) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    onTestFinished(() => warn.mockRestore())
    const h = harness(epic === undefined || typeof epic === 'function' ? epic : { ...epic })
    await h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.state()).toBe('idle'))
    await h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    expect(h.requests[1]?.unattended).toBe(true)
    expect(h.requests[1]).not.toHaveProperty('epic')
    expect(epicOf(1)).toBeUndefined()
    expect(appended(1)).not.toContain('wave-brief')
    if (typeof epic === 'function') expect(warn).toHaveBeenCalledWith(expect.stringContaining(`could not tell the Epic of the run of ${PROJECT}`), expect.any(Error))
  })
})
