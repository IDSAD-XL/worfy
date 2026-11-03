// The Binding of a Codex Session (worfy-multi-vendor ticket 41, src/main/vendors/codex/binding.ts): its
// signals come from the thread's events, read through the history part of the Codex driver (`thread/read`
// on the fake app-server, WORFY_CODEX=fake from test/setup-contract.ts), and each command goes through the
// same pure parser as a Claude transcript's (src/shared/binding/signals.ts). The `bindings.signals` channel
// and the archive's Bindings (src/main/layout/archive.ts) take them for a Session with no Claude transcript.
// Codex is asked again only after the thread changed, and only the new events are folded.
//
// The fake runs under scriptNode() through the spawn stand-in of codexAskStarter, as
// test/contract/codex-history.test.ts starts it. Every process a test started is killed after it.
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { bindingsHandlers, type VendorBindingSignals } from '../../src/main/ipc/bindings'
import { sessionBindings } from '../../src/main/layout/archive'
import { BindingStore } from '../../src/main/layout/bindings'
import { codexAskStarter, type StartCodex } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { CodexBindingSignals } from '../../src/main/vendors/codex/binding'
import { codexHistoryPart } from '../../src/main/vendors/codex/history'
import type { HistoryPart, HistorySession } from '../../src/main/vendors/history'
import type { AgentEvent } from '../../src/shared/agent/events'
import { EMPTY_AGENT_SIGNALS, resolveBinding, type BindingWorkflow } from '../../src/shared/binding/resolve'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { TranscriptEntry } from '../../src/shared/transcript/parse'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

/** The thread of test/fixtures/codex-scripts/thread-binding.jsonl. */
const THREAD = '019a4b2c-0041-7000-8000-000000000041'
const PROJECT_ROOT = '/fake/project'
const WORKTREE = '/fake/project/.claude/worktrees/07'
const workflow: BindingWorkflow = { epics: ['worfy-demo'], tickets: [7, 8].map((num) => ({ epic: 'worfy-demo', num, state: 'open' })) }

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const root of roots.splice(0)) removeTestTree(root)
})

function tempRoot(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-binding-'))
  roots.push(root)
  return root
}

/** Every file under `root` with its size and modification time. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(root, path)] = `${statSync(path).size}:${statSync(path).mtimeMs}`
    }
  }
  walk(root)
  return out
}

/** The history part of the Codex driver over the fake playing `script`; `started` counts its processes. */
function fakeHistory(script: string) {
  const cwd = tempRoot()
  const codexHome = tempRoot()
  const started: ChildProcess[] = []
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), [...args], spawnOptions)
    children.push(child)
    started.push(child)
    return child
  }
  const start: StartCodex = codexAskStarter({
    runtime: RUNTIME,
    appPath: REPO,
    cwd,
    clientVersion: '9.9.9',
    env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: script },
    spawnProcess,
    log: () => undefined,
  })
  return { history: codexHistoryPart({ start, codexHome: () => codexHome }), started, codexHome }
}

/** The Project's Codex Sessions as the last list found them: `threads` for PROJECT_ROOT, none elsewhere. */
const listed = (threads: () => HistorySession[]) => ({ cached: (root: string) => (root === PROJECT_ROOT ? threads() : []) })
const thread = (updatedAt: number | null, cwd: string | null = PROJECT_ROOT): HistorySession => ({ id: THREAD, cwd, title: 'Take ticket 07 of worfy-demo', updatedAt, origin: 'worfy' })
const branches =
  (map: Record<string, string>) =>
  async (cwd: string): Promise<string | null> =>
    map[cwd] ?? null

/** A transcript entry of a Codex command, as codexTranscript() gives it. */
const command = (id: string, text: string, cwd: string): TranscriptEntry => ({
  uuid: id,
  sidechain: false,
  event: { type: 'tool_use', id, name: 'commandExecution', input: { command: text, cwd }, parentToolUseId: null },
})
const said = (id: string, text: string): TranscriptEntry => ({ uuid: id, sidechain: false, event: { type: 'text', text, messageId: id, parentToolUseId: null, synthetic: false } as AgentEvent })

/** A history part that answers `transcript()` and counts its reads. */
function stubHistory(transcript: () => TranscriptEntry[]) {
  const reads: { id: string; cwd: string }[] = []
  const history: Pick<HistoryPart, 'read'> = {
    read: async (id, cwd) => {
      reads.push({ id, cwd })
      return transcript()
    },
  }
  return { history, reads }
}

describe('the Binding signals of a Codex Session (thread/read on the fake)', () => {
  it('a Session that edits its Ticket file and works in its branch is bound to the Ticket by the branch', async () => {
    const fake = fakeHistory('thread-binding')
    const before = snapshot(fake.codexHome)
    const reader = new CodexBindingSignals({ history: fake.history, sessions: listed(() => [thread(1793000200)]), branch: branches({ [WORKTREE]: 'worfy-demo/07', [PROJECT_ROOT]: 'main' }) })

    const signals = await reader.session(PROJECT_ROOT, THREAD)

    expect(signals).toEqual({ ...EMPTY_AGENT_SIGNALS, cwd: WORKTREE, gitBranch: 'worfy-demo/07' })
    expect(resolveBinding({ signals }, workflow)).toEqual({ target: { kind: 'ticket', epic: 'worfy-demo', num: 7 }, source: 'branch', detail: 'worfy-demo/07' })
    // Without the model the branch alone names the Ticket; without the branch the worktree folder does, with the model.
    expect(resolveBinding({ signals }, undefined)?.target).toEqual({ kind: 'ticket', epic: 'worfy-demo', num: 7 })
    expect(resolveBinding({ signals: { ...signals!, gitBranch: null } }, workflow)).toEqual({ target: { kind: 'ticket', epic: 'worfy-demo', num: 7 }, source: 'worktree', detail: '.claude/worktrees/07' })
    expect(fake.started).toHaveLength(1)
    // worfy writes nothing into CODEX_HOME (ADR-0005).
    expect(snapshot(fake.codexHome)).toEqual(before)
  })

  it('asks Codex again only after the thread changed', async () => {
    const fake = fakeHistory('thread-binding')
    let updatedAt = 1793000200
    const reader = new CodexBindingSignals({ history: fake.history, sessions: listed(() => [thread(updatedAt)]), branch: branches({ [WORKTREE]: 'worfy-demo/07' }) })
    const first = await reader.session(PROJECT_ROOT, THREAD)
    // Two asks at once share one read.
    const [second, third] = await Promise.all([reader.session(PROJECT_ROOT, THREAD), reader.session(PROJECT_ROOT, THREAD)])
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(fake.started).toHaveLength(1)

    updatedAt = 1793000300
    // The script answers one thread/read per process: the next one is a new process.
    expect(await reader.session(PROJECT_ROOT, THREAD)).toEqual(first)
    expect(fake.started).toHaveLength(2)
  })

  it('a thread the last list of the Project does not name is no Codex Session of it: null, and Codex is not asked', async () => {
    const { history, reads } = stubHistory(() => [])
    const reader = new CodexBindingSignals({ history, sessions: listed(() => [thread(1)]), branch: branches({}) })
    expect(await reader.session('/elsewhere', THREAD)).toBeNull()
    expect(await reader.session(PROJECT_ROOT, '019a4b2c-0041-7000-8000-000000000099')).toBeNull()
    expect(reads).toEqual([])
  })
})

describe('the signals of a Codex thread', () => {
  it('folds only the new events: the claim of an earlier turn stays, the folder of the last command wins', async () => {
    let transcript = [said('m1', 'Starting'), command('c1', '~/.claude/worfy-harness/plugin/bin/ticket claim worfy-demo 07', PROJECT_ROOT)]
    const { history, reads } = stubHistory(() => transcript)
    let updatedAt = 1
    const reader = new CodexBindingSignals({ history, sessions: listed(() => [thread(updatedAt)]), branch: branches({}) })

    const claim = { epic: 'worfy-demo', num: 7, command: '~/.claude/worfy-harness/plugin/bin/ticket claim worfy-demo 07' }
    expect(await reader.session(PROJECT_ROOT, THREAD)).toEqual({ ...EMPTY_AGENT_SIGNALS, claim, cwd: PROJECT_ROOT })

    // A new turn: its commands are folded on top of what was read.
    transcript = [...transcript, command('c2', 'pnpm test', WORKTREE)]
    updatedAt = 2
    const after = await reader.session(PROJECT_ROOT, THREAD)
    expect(after).toEqual({ ...EMPTY_AGENT_SIGNALS, claim, cwd: WORKTREE })
    expect(resolveBinding({ signals: after }, workflow)).toEqual({ target: { kind: 'ticket', epic: 'worfy-demo', num: 7 }, source: 'claim', detail: claim.command })

    // Fewer events than were folded: another thread, read from the start.
    transcript = [command('c3', 'ls', PROJECT_ROOT)]
    updatedAt = 3
    expect(await reader.session(PROJECT_ROOT, THREAD)).toEqual({ ...EMPTY_AGENT_SIGNALS, cwd: PROJECT_ROOT })
    // Each read names the thread and its folder.
    expect(reads).toEqual([1, 2, 3].map(() => ({ id: THREAD, cwd: PROJECT_ROOT })))
  })

  it('a thread with no command has the folder of the thread; one whose read fails keeps what was read and tries again', async () => {
    let fail = false
    const history: Pick<HistoryPart, 'read'> = {
      read: async () => {
        if (fail) throw new Error('Codex did not answer')
        return [command('c1', 'ticket claim worfy-demo/08', WORKTREE)]
      },
    }
    const logged: string[] = []
    let updatedAt = 1
    const reader = new CodexBindingSignals({ history, sessions: listed(() => [thread(updatedAt)]), branch: branches({}), log: (message) => logged.push(message) })
    const read = await reader.session(PROJECT_ROOT, THREAD)
    expect(read?.claim).toEqual({ epic: 'worfy-demo', num: 8, command: 'ticket claim worfy-demo/08' })

    fail = true
    updatedAt = 2
    expect(await reader.session(PROJECT_ROOT, THREAD)).toEqual(read)
    expect(logged).toHaveLength(1)
    fail = false
    expect(await reader.session(PROJECT_ROOT, THREAD)).toEqual(read)

    const quiet = new CodexBindingSignals({ history: { read: async () => [said('m1', 'Hello')] }, sessions: listed(() => [thread(1)]), branch: branches({ [PROJECT_ROOT]: 'main' }) })
    expect(await quiet.session(PROJECT_ROOT, THREAD)).toEqual({ ...EMPTY_AGENT_SIGNALS, cwd: PROJECT_ROOT, gitBranch: 'main' })
  })

  it('reads the branch from git in the folder of the last command, and writes nothing there', async () => {
    const repo = join(tempRoot(), 'project')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q', '-b', 'worfy-demo/07'], { cwd: repo })
    const before = snapshot(repo)
    const reader = new CodexBindingSignals({ history: { read: async () => [command('c1', 'pnpm test', repo)] }, sessions: listed(() => [thread(1)]) })
    const signals = await reader.session(PROJECT_ROOT, THREAD)
    expect(signals).toEqual({ ...EMPTY_AGENT_SIGNALS, cwd: repo, gitBranch: 'worfy-demo/07' })
    expect(snapshot(repo)).toEqual(before)

    // A folder that is gone has no branch; its worktree folder still binds with the model.
    const gone = new CodexBindingSignals({ history: { read: async () => [command('c1', 'pnpm test', join(repo, 'missing', '.claude', 'worktrees', '07'))] }, sessions: listed(() => [thread(1)]) })
    expect((await gone.session(PROJECT_ROOT, THREAD))?.gitBranch).toBeNull()
  })
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

/** The `bindings` handlers with no Claude transcript at all, over `vendors`. */
async function register(vendors: readonly VendorBindingSignals[]) {
  const dataDir = tempRoot()
  const store = new BindingStore((projectId) => join(dataDir, projectId))
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './bindings.ts': async () => bindingsHandlers(() => store, () => ({ transcriptPath: async () => null }), undefined, () => [], () => vendors) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  return async (channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: APP_URL }, sender: { isDestroyed: () => false, once: () => undefined, send: () => undefined } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

describe('a Codex Session where Bindings are read', () => {
  const reader = () => new CodexBindingSignals({ history: fakeHistory('thread-binding').history, sessions: listed(() => [thread(1793000200)]), branch: branches({ [WORKTREE]: 'worfy-demo/07' }) })

  it('bindings.signals answers the signals of a Session with no Claude transcript from its Vendor', async () => {
    const invoke = await register([reader()])
    expect(await invoke('bindings.signals', { projectRoot: PROJECT_ROOT, sessionId: THREAD })).toEqual({
      ok: true,
      value: { found: true, session: { ...EMPTY_AGENT_SIGNALS, cwd: WORKTREE, gitBranch: 'worfy-demo/07' }, subagents: [] },
    })
    expect(await invoke('bindings.signals', { projectRoot: PROJECT_ROOT, sessionId: '019a4b2c-0041-7000-8000-000000000099' })).toEqual({
      ok: true,
      value: { found: false, session: EMPTY_AGENT_SIGNALS, subagents: [] },
    })
  })

  it('the archive binds it to its Ticket, so a done Ticket can archive it', async () => {
    const codex = reader()
    const found = await sessionBindings({ id: 'demo-0000000d', path: PROJECT_ROOT }, [THREAD, 'gone'], workflow, {
      stored: () => [],
      transcriptPath: async () => null,
      signals: async () => EMPTY_AGENT_SIGNALS,
      vendorSignals: (root, sessionId) => codex.session(root, sessionId),
    })
    expect(found).toEqual(
      new Map([
        [THREAD, { kind: 'ticket', epic: 'worfy-demo', num: 7 }],
        ['gone', null],
      ]),
    )
  })
})
