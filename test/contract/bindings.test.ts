// The `bindings` domain at its boundary (ticket 16): the manual Bindings store over a temporary
// data folder, the signals reader over the synthetic Claude home (test/fixtures/claude-home), and
// the channels registered through registerIpc, the same wrapper the app uses.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BindingSignalReader } from '../../src/main/claude-home/binding-signals'
import { ClaudeHomeRegistry } from '../../src/main/claude-home/registry'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { bindingsHandlers, type TranscriptFinder } from '../../src/main/ipc/bindings'
import { BindingStore } from '../../src/main/layout/bindings'
import { EMPTY_AGENT_SIGNALS, resolveBinding, type BindingWorkflow } from '../../src/shared/binding/resolve'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { removeTestTree } from '../remove'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const HOME = join(__dirname, '..', 'fixtures', 'claude-home')
const DEMO = join(HOME, 'projects', '-Users-test-projects-demo')
const S4 = join(HOME, 'projects', '-Users-test-projects-demo--claude-worktrees-07', '44444444-4444-4444-8444-444444444444.jsonl')
const S5 = join(DEMO, '55555555-5555-4555-8555-555555555555.jsonl')
const PROJECT = 'demo-0000000d'

const demoWorkflow: BindingWorkflow = {
  epics: ['demo-epic'],
  tickets: [7, 8].map((num) => ({ epic: 'demo-epic', num, state: 'open' })),
}

let scratch: string
let dataDir: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-bindings-')))
  dataDir = join(scratch, 'data')
})

afterEach(() => {
  removeTestTree(scratch)
})

/** Every file under `root` with its size and modification time. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const stats = statSync(path)
        out[relative(root, path)] = `${stats.size}:${stats.mtimeMs}`
      }
    }
  }
  walk(root)
  return out
}

const store = (): BindingStore =>
  new BindingStore((projectId) => {
    if (projectId !== PROJECT) throw new Error(`no Project ${projectId}`)
    return join(dataDir, projectId)
  })

describe('BindingSignalReader over the synthetic Claude home', () => {
  it('reads the claim, the worktree, the branch and /ship-ticket of a Session; resolves it to its Ticket by the claim', async () => {
    const before = snapshot(HOME)
    const { session, subagents } = await new BindingSignalReader().session(S4)
    expect(session).toEqual({
      claim: { epic: 'demo-epic', num: 7, command: expect.stringContaining('ticket claim demo-epic 07') as string },
      cwd: '/Users/test/projects/demo/.claude/worktrees/07',
      gitBranch: 'demo-epic/07',
      skill: { name: 'ship-ticket', args: 'demo-epic 07' },
      task: null,
    })
    expect(subagents).toEqual([])
    expect(resolveBinding({ signals: session }, demoWorkflow)).toMatchObject({ target: { kind: 'ticket', epic: 'demo-epic', num: 7 }, source: 'claim' })
    expect(snapshot(HOME)).toEqual(before)
  })

  it('binds the Session that runs /epic-wave to the Epic and its implementer, who claims, to the Ticket', async () => {
    const { session, subagents } = await new BindingSignalReader().session(S5)
    expect(session.skill).toEqual({ name: 'epic-wave', args: 'demo-epic 1' })
    expect(session.claim).toBeNull()
    expect(resolveBinding({ signals: session }, demoWorkflow)).toEqual({ target: { kind: 'epic', epic: 'demo-epic' }, source: 'skill', detail: '/epic-wave demo-epic 1' })
    expect(subagents.map((each) => each.agentId)).toEqual(['a1000000000000286', 'a2000000000000286'])
    const [implementer, nested] = subagents
    expect(resolveBinding({ signals: implementer!.signals, subagent: true }, demoWorkflow)).toMatchObject({ target: { kind: 'ticket', epic: 'demo-epic', num: 7 }, source: 'claim' })
    expect(resolveBinding({ signals: nested!.signals, subagent: true }, demoWorkflow)).toBeNull()
  })

  it('reads only what was appended, and starts over on a truncated file', async () => {
    const dir = join(scratch, 'home')
    cpSync(join(HOME, 'projects', '-Users-test-projects-demo--claude-worktrees-07'), dir, { recursive: true })
    const path = join(dir, '44444444-4444-4444-8444-444444444444.jsonl')
    const reader = new BindingSignalReader()
    expect((await reader.file(path, false)).claim?.num).toBe(7)
    const bash = (command: string) => `${JSON.stringify({ type: 'assistant', cwd: '/x', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command } }] } })}\n`
    appendFileSync(path, bash('ticket claim demo-epic 08'))
    expect((await reader.file(path, false)).claim?.num).toBe(8)
    writeFileSync(path, bash('git status'))
    expect(await reader.file(path, false)).toEqual({ ...EMPTY_AGENT_SIGNALS, cwd: '/x' })
    rmSync(path)
    expect(await reader.file(path, false)).toEqual(EMPTY_AGENT_SIGNALS)
  })
})

describe('BindingStore', () => {
  it('keeps one manual Binding per agent in bindings.json of the Project data folder, and reads it back', () => {
    const first = store()
    expect(first.get(PROJECT)).toEqual({ projectId: PROJECT, bindings: [] })
    expect(existsSync(join(dataDir, PROJECT, 'bindings.json'))).toBe(false)
    first.set(PROJECT, { sessionId: 's1', agentId: null }, { kind: 'ticket', epic: 'e', num: 7 })
    first.set(PROJECT, { sessionId: 's1', agentId: 'a1' }, { kind: 'epic', epic: 'e' })
    first.set(PROJECT, { sessionId: 's1', agentId: null }, { kind: 'ticket', epic: 'e', num: 12 })
    const saved = [
      { sessionId: 's1', agentId: 'a1', target: { kind: 'epic', epic: 'e' } },
      { sessionId: 's1', agentId: null, target: { kind: 'ticket', epic: 'e', num: 12 } },
    ]
    expect(JSON.parse(readFileSync(join(dataDir, PROJECT, 'bindings.json'), 'utf8'))).toEqual({ bindings: saved })
    // A new store (a restart) reads it.
    expect(store().get(PROJECT).bindings).toEqual(saved)
    expect(first.remove(PROJECT, { sessionId: 's1', agentId: null }).bindings).toEqual([saved[0]])
    expect(store().get(PROJECT).bindings).toEqual([saved[0]])
    // Only the data folder was written: no temporary file left next to it.
    expect(readdirSync(join(dataDir, PROJECT))).toEqual(['bindings.json'])
  })

  it('tells listeners of a change, not of a no-op; refuses a Project that is not in the list', () => {
    const bindings = store()
    const changes: unknown[] = []
    bindings.onChange((change) => changes.push(change))
    bindings.remove(PROJECT, { sessionId: 's1', agentId: null })
    bindings.set(PROJECT, { sessionId: 's1', agentId: null }, { kind: 'epic', epic: 'e' })
    bindings.set(PROJECT, { sessionId: 's1', agentId: null }, { kind: 'epic', epic: 'e' })
    expect(changes).toEqual([{ projectId: PROJECT, bindings: [{ sessionId: 's1', agentId: null, target: { kind: 'epic', epic: 'e' } }] }])
    expect(() => bindings.get('other-00000000')).toThrow('no Project other-00000000')
  })

  it('keeps a launch Binding (ticket 23) next to the manual one: replaced by the next launch, untouched by set and remove', () => {
    const bindings = store()
    const agent = { sessionId: 's1', agentId: null }
    bindings.setLaunch(PROJECT, agent, { kind: 'ticket', epic: 'e', num: 7 })
    bindings.set(PROJECT, agent, { kind: 'ticket', epic: 'e', num: 12 })
    bindings.setLaunch(PROJECT, agent, { kind: 'epic', epic: 'e' })
    const launch = { sessionId: 's1', agentId: null, target: { kind: 'epic', epic: 'e' }, source: 'launch' }
    const manual = { sessionId: 's1', agentId: null, target: { kind: 'ticket', epic: 'e', num: 12 } }
    expect(JSON.parse(readFileSync(join(dataDir, PROJECT, 'bindings.json'), 'utf8'))).toEqual({ bindings: [manual, launch] })
    // "Remove binding" takes the manual one only; a restart reads the launch one back.
    expect(bindings.remove(PROJECT, agent).bindings).toEqual([launch])
    expect(bindings.remove(PROJECT, agent).bindings).toEqual([launch])
    expect(store().get(PROJECT).bindings).toEqual([launch])
  })

  it('sets an unreadable file aside and starts empty', () => {
    mkdirSync(join(dataDir, PROJECT), { recursive: true })
    writeFileSync(join(dataDir, PROJECT, 'bindings.json'), '{"bindings": [{"sessionId": 5}]}')
    expect(store().get(PROJECT).bindings).toEqual([])
    expect(readdirSync(join(dataDir, PROJECT)).some((name) => name.startsWith('bindings.json.unreadable-'))).toBe(true)
  })
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

interface FakeWindow {
  sent: { channel: string; payload: unknown }[]
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
  once(event: string, listener: () => void): void
  destroy(): void
}

function fakeWindow(): FakeWindow {
  let destroyed = false
  const onDestroyed: (() => void)[] = []
  return {
    sent: [],
    send(channel, payload) {
      this.sent.push({ channel, payload })
    },
    isDestroyed: () => destroyed,
    once(_event, listener) {
      onDestroyed.push(listener)
    },
    destroy() {
      destroyed = true
      for (const listener of onDestroyed) listener()
    },
  }
}

async function register(bindings: BindingStore, finder: TranscriptFinder, reader?: BindingSignalReader) {
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './bindings.ts': async () => bindingsHandlers(() => bindings, () => finder, reader) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
  return async (channel: string, input: unknown, window: FakeWindow = fakeWindow()): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: `file://${INDEX_HTML}` }, sender: window } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

const noTranscripts: TranscriptFinder = { transcriptPath: async () => null }

describe('the bindings channels', () => {
  it('set stores only what the contract describes: extra keys are dropped, a wrong type is refused and nothing is written', async () => {
    const invoke = await register(store(), noTranscripts)
    const set = await invoke('bindings.set', { projectId: PROJECT, sessionId: 's1', agentId: null, target: { kind: 'ticket', epic: 'e', num: 7, note: 'x' }, extra: true })
    const stored = { sessionId: 's1', agentId: null, target: { kind: 'ticket', epic: 'e', num: 7 } }
    expect(set).toEqual({ ok: true, value: { projectId: PROJECT, bindings: [stored] } })
    expect(JSON.parse(readFileSync(join(dataDir, PROJECT, 'bindings.json'), 'utf8'))).toEqual({ bindings: [stored] })

    for (const input of [
      { projectId: PROJECT, sessionId: 's2', agentId: null, target: { kind: 'ticket', epic: 'e', num: '7' } },
      { projectId: PROJECT, sessionId: 's2', agentId: null, target: { kind: 'wave', epic: 'e' } },
      { projectId: PROJECT, sessionId: 's2', agentId: null, target: { kind: 'epic', epic: '../e' } },
      { projectId: PROJECT, sessionId: '../s2', agentId: null, target: { kind: 'epic', epic: 'e' } },
      { projectId: PROJECT, sessionId: 's2', agentId: 'a/b', target: { kind: 'epic', epic: 'e' } },
    ]) {
      const refused = await invoke('bindings.set', input)
      expect(refused.ok, JSON.stringify(input)).toBe(false)
    }
    expect(JSON.parse(readFileSync(join(dataDir, PROJECT, 'bindings.json'), 'utf8'))).toEqual({ bindings: [stored] })
  })

  it('set cannot write a launch Binding: `source` is not part of its input (ticket 23)', async () => {
    const invoke = await register(store(), noTranscripts)
    const set = await invoke('bindings.set', { projectId: PROJECT, sessionId: 's1', agentId: null, target: { kind: 'epic', epic: 'e' }, source: 'launch' })
    expect(set).toEqual({ ok: true, value: { projectId: PROJECT, bindings: [{ sessionId: 's1', agentId: null, target: { kind: 'epic', epic: 'e' } }] } })
  })

  it('get answers launch Bindings with their source, and refuses a stored one with another source', async () => {
    const bindings = store()
    bindings.setLaunch(PROJECT, { sessionId: 's1', agentId: null }, { kind: 'epic', epic: 'e' })
    const invoke = await register(bindings, noTranscripts)
    expect(await invoke('bindings.get', { projectId: PROJECT })).toEqual({
      ok: true,
      value: { projectId: PROJECT, bindings: [{ sessionId: 's1', agentId: null, target: { kind: 'epic', epic: 'e' }, source: 'launch' }] },
    })
    writeFileSync(join(dataDir, PROJECT, 'bindings.json'), JSON.stringify({ bindings: [{ sessionId: 's2', agentId: null, target: { kind: 'epic', epic: 'e' }, source: 'skill' }] }))
    expect(store().get(PROJECT).bindings).toEqual([])
  })

  it('get subscribes the window: a later set or remove reaches it as bindings.changed until it is destroyed', async () => {
    const bindings = store()
    const invoke = await register(bindings, noTranscripts)
    const window = fakeWindow()
    expect(await invoke('bindings.get', { projectId: PROJECT }, window)).toEqual({ ok: true, value: { projectId: PROJECT, bindings: [] } })
    await invoke('bindings.get', { projectId: PROJECT }, window)
    await invoke('bindings.set', { projectId: PROJECT, sessionId: 's1', agentId: 'a1', target: { kind: 'epic', epic: 'e' } })
    await invoke('bindings.remove', { projectId: PROJECT, sessionId: 's1', agentId: 'a1' })
    expect(window.sent).toEqual([
      { channel: `${IPC_CHANNEL_PREFIX}bindings.changed`, payload: { projectId: PROJECT, bindings: [{ sessionId: 's1', agentId: 'a1', target: { kind: 'epic', epic: 'e' } }] } },
      { channel: `${IPC_CHANNEL_PREFIX}bindings.changed`, payload: { projectId: PROJECT, bindings: [] } },
    ])
    window.destroy()
    await invoke('bindings.set', { projectId: PROJECT, sessionId: 's1', agentId: null, target: { kind: 'epic', epic: 'e' } })
    expect(window.sent).toHaveLength(2)
    // A Project that is not in the list is refused.
    expect((await invoke('bindings.get', { projectId: 'other-00000000' })).ok).toBe(false)
  })

  it('signals reads a Session found among the Project folders, and not one outside them', async () => {
    const registry = new ClaudeHomeRegistry({ home: HOME, listWorktrees: async () => [] })
    const invoke = await register(store(), registry)
    const found = await invoke('bindings.signals', { projectRoot: '/Users/test/projects/demo', sessionId: '55555555-5555-4555-8555-555555555555' })
    expect(found.ok).toBe(true)
    const value = (found as { value: { found: boolean; session: unknown; subagents: { agentId: string }[] } }).value
    expect(value.found).toBe(true)
    expect(value.session).toMatchObject({ skill: { name: 'epic-wave', args: 'demo-epic 1' } })
    expect(value.subagents.map((each) => each.agentId)).toEqual(['a1000000000000286', 'a2000000000000286'])

    expect(await invoke('bindings.signals', { projectRoot: '/Users/test/projects/other', sessionId: '55555555-5555-4555-8555-555555555555' })).toEqual({
      ok: true,
      value: { found: false, session: EMPTY_AGENT_SIGNALS, subagents: [] },
    })
    for (const input of [
      { projectRoot: 'relative/path', sessionId: '55555555-5555-4555-8555-555555555555' },
      { projectRoot: '/Users/test/projects/demo', sessionId: '../55555555' },
    ]) {
      expect((await invoke('bindings.signals', input)).ok, JSON.stringify(input)).toBe(false)
    }
  })

  it('signals sends only what the contract describes: extra keys are dropped, a wrong type is refused', async () => {
    const finder: TranscriptFinder = { transcriptPath: async () => '/x/s.jsonl' }
    let answer: unknown = {
      session: { ...EMPTY_AGENT_SIGNALS, cwd: '/x', raw: 'secret' },
      subagents: [{ agentId: 'a1', signals: { ...EMPTY_AGENT_SIGNALS, task: { epic: 'e', num: 3, path: '/p' } }, extra: 1 }],
    }
    const reader = { session: async () => answer } as unknown as BindingSignalReader
    const invoke = await register(store(), finder, reader)
    expect(await invoke('bindings.signals', { projectRoot: '/x', sessionId: 's' })).toEqual({
      ok: true,
      value: { found: true, session: { ...EMPTY_AGENT_SIGNALS, cwd: '/x' }, subagents: [{ agentId: 'a1', signals: { ...EMPTY_AGENT_SIGNALS, task: { epic: 'e', num: 3 } } }] },
    })
    answer = { session: { ...EMPTY_AGENT_SIGNALS, claim: { epic: 'e', num: '7', command: 'x' } }, subagents: [] }
    expect(await invoke('bindings.signals', { projectRoot: '/x', sessionId: 's' })).toEqual({ ok: false, error: 'bindings.signals: invalid output from the handler' })
  })
})
