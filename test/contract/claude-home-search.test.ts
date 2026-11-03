// `claudeHome.search` (worfy-polish ticket 10): text search over the transcripts of a Project's
// Sessions, wherever they were started. Every test builds its own Claude home in a temporary
// directory (the WORFY_CLAUDE_HOME of the main process) and never reads the real ~/.claude. The
// Claude home is only read: a snapshot of every file before and after proves it.
//
// The search also finds the Project's Codex threads (worfy-multi-vendor ticket 28), on the fake
// app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets; the real Codex never starts). One
// script plays every process of the fake, so each test writes its own scripts into a temporary folder:
// the list of the Project's threads (`thread/list`) and the read of each thread (`thread/read`), and
// each read starts the fake with its thread's script. Every process a test started is killed after it.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { ClaudeHomeRegistry, projectDirName } from '../../src/main/claude-home/registry'
import { SEARCH_LIMITS, snippetAround, TranscriptSearch, type VendorThreads } from '../../src/main/claude-home/search'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { codexAskStarter } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexHistoryPart } from '../../src/main/vendors/codex/history'
import { CodexSessionsOnCanvas, type CodexSessions } from '../../src/main/vendors/codex/sessions-on-canvas'
import type { HistoryPart } from '../../src/main/vendors/history'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { scriptNode } from '../script-node'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const temps: string[] = []
const closers: (() => Promise<void>)[] = []
const children: ChildProcess[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function tempDir(): Promise<string> {
  // The real path: on macOS tmpdir() is a link (/var → /private/var), and the check of a Linked
  // machine's call compares real paths.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-claude-search-')))
  temps.push(dir)
  return dir
}

const at = (minute: number): string => `2026-10-15T10:${String(minute).padStart(2, '0')}:00.000Z`

function user(text: string, cwd: string, minute: number): string {
  return JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: text }, uuid: `u-${minute}`, timestamp: at(minute), cwd, entrypoint: 'cli' })
}

function assistant(content: unknown[], cwd: string, minute: number): string {
  return JSON.stringify({ type: 'assistant', isSidechain: false, message: { id: `m-${minute}`, role: 'assistant', model: 'claude-opus-5', content }, uuid: `a-${minute}`, timestamp: at(minute), cwd })
}

function toolResult(toolUseId: string, text: string, cwd: string, minute: number): string {
  return JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] }, uuid: `r-${minute}`, timestamp: at(minute), cwd })
}

/** Writes a transcript and sets its modification time: a later `minute` is a newer Session. */
async function transcript(home: string, cwd: string, sessionId: string, lines: readonly string[], minute: number, dirName = projectDirName(cwd)): Promise<string> {
  const dir = join(home, 'projects', dirName)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${sessionId}.jsonl`)
  await writeFile(path, `${lines.join('\n')}\n`)
  const time = new Date(at(minute))
  await utimes(path, time, time)
  return path
}

interface World {
  home: string
  project: string
  other: string
}

/**
 * Three transcripts of the Project — two in its own folder, one in a worktree's — and one of
 * another Project, which says the searched word too.
 */
async function world(): Promise<World> {
  const base = await tempDir()
  const home = join(base, 'claude')
  const project = join(base, 'project')
  const other = join(base, 'elsewhere')
  await mkdir(project, { recursive: true })
  await mkdir(other, { recursive: true })
  await transcript(
    home,
    project,
    A,
    [
      user('Where does the Zebra config live?', project, 1),
      assistant([{ type: 'thinking', thinking: 'the thinkword is private' }], project, 2),
      assistant([{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'grep -r toolword src' } }], project, 3),
      toolResult('tu-1', 'src/a.ts: toolword found here', project, 4),
      assistant([{ type: 'text', text: 'It lives in config.ts, next to the router.' }], project, 5),
    ],
    20,
  )
  await transcript(home, project, B, [user('Rename the module', project, 6), assistant([{ type: 'text', text: 'Done: the ZEBRA module is now called stripes.' }], project, 7)], 30)
  await transcript(home, join(project, '.claude', 'worktrees', '07'), C, [user('Fix the lint errors', project, 8), assistant([{ type: 'text', text: 'Fixed.' }], project, 9)], 40, `${projectDirName(project)}--claude-worktrees-07`)
  await transcript(home, other, OTHER, [user('zebra in another Project', other, 10), assistant([{ type: 'text', text: 'zebra here too' }], other, 11)], 50)
  return { home, project, other }
}

const registryOf = (home: string) => new ClaudeHomeRegistry({ home, listWorktrees: async () => [], isAlive: async () => false })

/** Every file and folder under `root`: kind, size, modification time and a hash of the content. */
async function snapshot(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name)
      const info = await lstat(path)
      if (info.isDirectory()) {
        out.push(`d ${path} ${info.mtimeMs}`)
        await walk(path)
      } else {
        out.push(`f ${path} ${info.size} ${info.mtimeMs} ${createHash('sha256').update(await readFile(path)).digest('hex')}`)
      }
    }
  }
  await walk(root)
  return out
}

async function ipcOver(registry: ClaudeHomeRegistry, projects: () => readonly { path: string }[] = () => [], codex?: CodexSessions) {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
  closers.push(() => subscriptions.closeAll())
  await registerIpc(ipc, {
    modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, undefined, projects, undefined, undefined, codex) },
    isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
  })
  /** A window's call; with `remote`, a call of a Linked machine's client (a string id). */
  const call = async (channel: string, input: unknown, remote = false): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const sender = remote ? { id: 'link:mini/1', isDestroyed: () => false, once: () => undefined, send: () => undefined } : undefined
    const event = { senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  return { call }
}

describe('claudeHome.search', () => {
  it('finds the Project’s Sessions by the text of a reply, ignoring case, newest first, with a snippet and no path', async () => {
    const { home, project } = await world()
    const { call } = await ipcOver(registryOf(home))
    const result = await call('claudeHome.search', { projectRoot: project, query: 'zebra' })
    expect(result).toStrictEqual({
      ok: true,
      value: {
        hits: [
          { sessionId: B, title: 'Rename the module', at: new Date(at(30)).getTime(), snippet: 'Done: the ZEBRA module is now called stripes.' },
          { sessionId: A, title: 'Where does the Zebra config live?', at: new Date(at(20)).getTime(), snippet: 'Where does the Zebra config live?' },
        ],
        limited: false,
      },
    })
    // The other Project's transcript says "zebra" twice, and is not among the hits.
    expect(JSON.stringify(result)).not.toContain(OTHER)
    expect(JSON.stringify(result)).not.toContain(home)
  })

  it('finds a Session by a reply that is not its first message, in a worktree of the Project too', async () => {
    const { home, project } = await world()
    const search = new TranscriptSearch(registryOf(home))
    expect((await search.search(project, 'NEXT TO THE ROUTER')).hits.map((hit) => [hit.sessionId, hit.snippet])).toEqual([[A, 'It lives in config.ts, next to the router.']])
    expect((await search.search(project, 'lint errors')).hits.map((hit) => hit.sessionId)).toEqual([C])
  })

  it('does not search tool calls, their output or thinking', async () => {
    const { home, project } = await world()
    const search = new TranscriptSearch(registryOf(home))
    expect(await search.search(project, 'toolword')).toEqual({ hits: [], limited: false })
    expect(await search.search(project, 'grep -r')).toEqual({ hits: [], limited: false })
    expect(await search.search(project, 'thinkword')).toEqual({ hits: [], limited: false })
  })

  it('reads a transcript again once it changed', async () => {
    const { home, project } = await world()
    const search = new TranscriptSearch(registryOf(home))
    expect((await search.search(project, 'giraffe')).hits).toEqual([])
    await transcript(home, project, B, [user('Rename the module', project, 6), assistant([{ type: 'text', text: 'A giraffe now.' }], project, 7)], 31)
    expect((await search.search(project, 'giraffe')).hits.map((hit) => hit.sessionId)).toEqual([B])
  })

  it('a second search over unchanged transcripts reads none of them again, and leaves the Claude home unchanged', async () => {
    const { home, project } = await world()
    const registry = registryOf(home)
    const search = new TranscriptSearch(registry)
    const first = await search.search(project, 'zebra')
    expect(first.hits.map((hit) => [hit.sessionId, hit.title])).toEqual([
      [B, 'Rename the module'],
      [A, 'Where does the Zebra config live?'],
    ])
    // Every transcript of the Project gets other words of the same length, under the same size and
    // modification time. A search that read any head, tail or text again would show them.
    const own = projectDirName(project)
    const swaps: [string, string, string, number][] = [
      [join(home, 'projects', own, `${A}.jsonl`), 'Zebra config', 'Horse config', 20],
      [join(home, 'projects', own, `${B}.jsonl`), 'Rename the module', 'Delete the module', 30],
      [join(home, 'projects', `${own}--claude-worktrees-07`, `${C}.jsonl`), 'Fix the lint errors', 'Fix the type errors', 40],
    ]
    for (const [path, from, to, minute] of swaps) {
      const text = await readFile(path, 'utf8')
      expect(text).toContain(from)
      await writeFile(path, text.replaceAll(from, to))
      await utimes(path, new Date(at(minute)), new Date(at(minute)))
    }
    const before = await snapshot(home)
    expect(await search.search(project, 'zebra')).toEqual(first)
    expect((await search.search(project, 'horse')).hits).toEqual([])
    expect((await registry.sessions(project)).history.map((entry) => entry.title)).toEqual(['Fix the lint errors', 'Rename the module', 'Where does the Zebra config live?'])
    expect(await snapshot(home)).toEqual(before)
  })

  it('finds a new transcript and what was appended to one in the very next search, and drops a removed one', async () => {
    const { home, project } = await world()
    const search = new TranscriptSearch(registryOf(home))
    expect((await search.search(project, 'zebra')).hits.map((hit) => hit.sessionId)).toEqual([B, A])
    const own = projectDirName(project)
    const worktreeFile = join(home, 'projects', `${own}--claude-worktrees-07`, `${C}.jsonl`)
    await appendFile(worktreeFile, `${assistant([{ type: 'text', text: 'A zebra in the worktree.' }], project, 12)}\n${JSON.stringify({ type: 'custom-title', customTitle: 'Zebra hunt' })}\n`)
    await utimes(worktreeFile, new Date(at(45)), new Date(at(45)))
    const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    await transcript(home, project, E, [user('One more zebra question', project, 13)], 55)
    await rm(join(home, 'projects', own, `${B}.jsonl`))
    expect((await search.search(project, 'zebra')).hits).toEqual([
      { sessionId: E, title: 'One more zebra question', at: new Date(at(55)).getTime(), snippet: 'One more zebra question' },
      { sessionId: C, title: 'Zebra hunt', at: new Date(at(45)).getTime(), snippet: 'A zebra in the worktree.' },
      { sessionId: A, title: 'Where does the Zebra config live?', at: new Date(at(20)).getTime(), snippet: 'Where does the Zebra config live?' },
    ])
  })

  it('reads a transcript again when only its modification time tells it changed', async () => {
    const { home, project } = await world()
    const search = new TranscriptSearch(registryOf(home))
    expect((await search.search(project, 'zebra')).hits.map((hit) => hit.sessionId)).toEqual([B, A])
    // Same size, newer modification time: the cached entry no longer counts.
    const path = join(home, 'projects', projectDirName(project), `${A}.jsonl`)
    await writeFile(path, (await readFile(path, 'utf8')).replaceAll('Zebra config', 'Horse config'))
    await utimes(path, new Date(at(25)), new Date(at(25)))
    expect((await search.search(project, 'horse')).hits).toEqual([
      { sessionId: A, title: 'Where does the Horse config live?', at: new Date(at(25)).getTime(), snippet: 'Where does the Horse config live?' },
    ])
  })

  it('finds every message of a transcript of several megabytes, the one across the first megabyte too', async () => {
    const base = await tempDir()
    const home = join(base, 'claude')
    const project = join(base, 'project')
    await mkdir(project)
    // Messages of about 1.2 KB, two bytes per letter: a slice cut anywhere but after a line break
    // would break a line and lose its message.
    const lines = Array.from({ length: 3000 }, (_, n) => user(`метка-${n} ${'ж'.repeat(500)}`, project, n % 60))
    await transcript(home, project, A, lines, 1)
    const offsets: number[] = []
    let offset = 0
    for (const line of lines) {
      offsets.push(offset)
      offset += Buffer.byteLength(line) + 1
    }
    const acrossMegabyte = offsets.findLastIndex((start) => start <= 1024 * 1024)
    expect(offsets[acrossMegabyte]).toBeLessThan(1024 * 1024)
    const search = new TranscriptSearch(registryOf(home))
    for (const n of [0, acrossMegabyte, acrossMegabyte + 1, lines.length - 1]) {
      expect((await search.search(project, `метка-${n} `)).hits.map((hit) => hit.snippet.slice(0, `метка-${n}`.length)), String(n)).toEqual([`метка-${n}`])
    }
  })

  it('stops at the file limit and says so; the Claude home is the same before and after', async () => {
    const base = await tempDir()
    const home = join(base, 'claude')
    const project = join(base, 'project')
    await mkdir(project)
    // One more transcript than the limit; only the oldest says the word, so it stays unsearched.
    const count = SEARCH_LIMITS.files + 1
    for (let index = 0; index < count; index += 1) {
      const id = `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`
      const text = index === 0 ? 'the okapi is here' : `message ${index}`
      await transcript(home, project, id, [user(text, project, 0)], 0)
      const time = new Date(Date.parse(at(0)) + index * 1000)
      await utimes(join(home, 'projects', projectDirName(project), `${id}.jsonl`), time, time)
    }
    const before = await snapshot(home)
    const { call } = await ipcOver(registryOf(home))
    expect(await call('claudeHome.search', { projectRoot: project, query: 'okapi' })).toStrictEqual({ ok: true, value: { hits: [], limited: true } })
    expect(await call('claudeHome.search', { projectRoot: project, query: 'message 200' })).toMatchObject({ ok: true, value: { hits: [{ sessionId: '00000200-0000-4000-8000-000000000000' }], limited: true } })
    expect(await snapshot(home)).toEqual(before)
  })

  it('skips a transcript larger than the bytes left and says so; with room for all, nothing is left out', async () => {
    const { home, project } = await world()
    const own = projectDirName(project)
    const size = async (dir: string, id: string) => (await lstat(join(home, 'projects', dir, `${id}.jsonl`))).size
    const [a, b, c] = [await size(own, A), await size(own, B), await size(`${own}--claude-worktrees-07`, C)]
    // Newest first: C (no match), B, then A, which no longer fits.
    const tight = new TranscriptSearch(registryOf(home), { ...SEARCH_LIMITS, bytes: b + c })
    expect(await tight.search(project, 'zebra')).toMatchObject({ hits: [{ sessionId: B }], limited: true })
    const roomy = new TranscriptSearch(registryOf(home), { ...SEARCH_LIMITS, bytes: a + b + c })
    expect(await roomy.search(project, 'zebra')).toMatchObject({ hits: [{ sessionId: B }, { sessionId: A }], limited: false })
  })

  it('stops at the hit limit and says so', async () => {
    const { home, project } = await world()
    const search = new TranscriptSearch(registryOf(home), { ...SEARCH_LIMITS, hits: 1 })
    expect(await search.search(project, 'zebra')).toMatchObject({ hits: [{ sessionId: B }], limited: true })
  })

  it('refuses a query shorter than 3 characters and a relative root', async () => {
    const { home, project } = await world()
    const { call } = await ipcOver(registryOf(home))
    for (const input of [{ projectRoot: project, query: 'ze' }, { projectRoot: project, query: '  ze  ' }, { projectRoot: 'relative', query: 'zebra' }, { projectRoot: project }]) {
      const result = await call('claudeHome.search', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error).toMatch(/invalid input/)
    }
  })

  it('answers a Linked machine only inside the Projects of this Machine', async () => {
    const { home, project, other } = await world()
    const { call } = await ipcOver(registryOf(home), () => [{ path: project }])
    expect(await call('claudeHome.search', { projectRoot: other, query: 'zebra' }, true)).toMatchObject({ ok: false, error: expect.stringMatching(/outside the Projects of this Machine/) })
    expect(await call('claudeHome.search', { projectRoot: project, query: 'zebra' }, true)).toMatchObject({ ok: true, value: { hits: [{ sessionId: B }, { sessionId: A }] } })
  })
})

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const FIXTURES = join(REPO, 'test', 'fixtures', 'codex-scripts')

/** Codex threads: ids Codex gives (UUIDs), so each can name a Session. */
const T1 = '019a0000-0000-7000-8000-000000000281'
const T2 = '019a0000-0000-7000-8000-000000000282'
const FOREIGN = '019a0000-0000-7000-8000-000000000283'

/** A Codex message long enough to be cut around its match, which is in its middle. */
const LONG_REPLY = `${'The stripes were drawn by hand before the build, one after another, slowly. '.repeat(2)}The zebra pattern now lives in theme.ts.${' After that the tests ran green again, on every platform we have.'.repeat(2)}`

interface CodexThread {
  id: string
  cwd: string
  /** The thread's time, a minute of at(). */
  minute: number
  preview: string
  /** The user's message and the agent's reply of its one turn. */
  user: string
  reply: string
}

/** The steps of a checked script of the fake. */
async function fixtureSteps(name: string): Promise<Record<string, unknown>[]> {
  return (await readFile(join(FIXTURES, `${name}.jsonl`), 'utf8'))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * A Codex the search reads, over the fake: `list.jsonl` lists `threads`, `read-<id>.jsonl` reads each
 * one, built from the checked scripts threads.jsonl and thread-read.jsonl. `reads` counts the reads
 * the search asked for; `write` changes the threads (a new time, a new reply) for the next list.
 */
async function codexOf(base: string, threads: readonly CodexThread[]) {
  const scripts = join(base, 'codex-scripts')
  const codexHome = join(base, 'codex-home')
  const cwd = join(base, 'codex-cwd')
  for (const dir of [scripts, codexHome, cwd]) await mkdir(dir, { recursive: true })
  const [initialize, initialized, readStep] = (await fixtureSteps('thread-read')) as [Record<string, unknown>, Record<string, unknown>, { result: { thread: Record<string, unknown> } }]
  const template = readStep.result.thread
  const threadOf = (thread: CodexThread, turns: unknown[]) => ({
    ...template,
    id: thread.id,
    sessionId: `ses-${thread.id}`,
    cwd: thread.cwd,
    preview: thread.preview,
    originator: 'codex_cli_rs',
    source: 'cli',
    updatedAt: Date.parse(at(thread.minute)) / 1000,
    turns,
  })
  const script = (name: string, steps: readonly unknown[]) => writeFile(join(scripts, `${name}.jsonl`), `${steps.map((step) => JSON.stringify(step)).join('\n')}\n`)
  const write = async (all: readonly CodexThread[]) => {
    await script('list', [initialize, initialized, { expect: 'thread/list', result: { data: all.map((thread) => threadOf(thread, [])), nextCursor: null, backwardsCursor: null } }])
    for (const thread of all) {
      const turn = {
        id: `turn-${thread.id}`,
        items: [
          { type: 'userMessage', id: `user-${thread.id}`, clientId: null, content: [{ type: 'text', text: thread.user, text_elements: [] }] },
          { type: 'commandExecution', id: `cmd-${thread.id}`, command: 'grep -r zebra-in-a-command', commandActions: [], cwd: thread.cwd, status: 'completed', exitCode: 0, aggregatedOutput: 'zebra-in-the-output\n', durationMs: 5 },
          { type: 'agentMessage', id: `msg-${thread.id}`, text: thread.reply },
        ],
        status: 'completed',
        startedAt: Date.parse(at(thread.minute)) / 1000,
        completedAt: Date.parse(at(thread.minute)) / 1000,
        durationMs: 1000,
      }
      await script(`read-${thread.id}`, [initialize, initialized, { expect: 'thread/read', result: { thread: threadOf(thread, [turn]) } }])
    }
  }
  await write(threads)
  const starter = (name: string) =>
    codexAskStarter({
      runtime: RUNTIME,
      appPath: REPO,
      cwd,
      clientVersion: '9.9.9',
      env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: name, WORFY_CODEX_SCRIPTS: scripts },
      spawnProcess: (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
        const child = spawn(scriptNode(), [...args], options)
        children.push(child)
        return child
      },
      log: () => undefined,
    })
  const lists = codexHistoryPart({ start: starter('list'), codexHome: () => codexHome })
  const reads: string[] = []
  const history: HistoryPart = {
    list: (folder) => lists.list(folder),
    read: (id, folder) => {
      reads.push(id)
      return codexHistoryPart({ start: starter(`read-${id}`), codexHome: () => codexHome }).read(id, folder)
    },
  }
  // pollMs 0: each settled() asks Codex for the list again, as the window's next poll would.
  const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root], pollMs: 0 })
  const threadsOf = (sessions: CodexSessions): VendorThreads => ({ vendor: 'codex', cached: (root) => sessions.cached(root), transcript: (root, id) => sessions.transcript(root, id) })
  return { codex, codexHome, reads, write, threads: threadsOf(codex), threadsOf }
}

/** The Claude world, with two Codex threads of the Project — one in a folder inside it — and one of another Project. */
async function codexWorld() {
  const claude = await world()
  const base = join(claude.home, '..')
  const threads: CodexThread[] = [
    { id: T1, cwd: claude.project, minute: 35, preview: 'Theme the stripes', user: 'Theme the stripes', reply: LONG_REPLY },
    { id: T2, cwd: join(claude.project, 'src'), minute: 10, preview: 'Old zebra question', user: 'Is the ZEBRA icon still used?', reply: 'Not any more.' },
    { id: FOREIGN, cwd: claude.other, minute: 50, preview: 'zebra elsewhere', user: 'zebra elsewhere', reply: 'zebra in another Project' },
  ]
  const codex = await codexOf(base, threads)
  // The list the search reads: the one the Project's Codex Sessions last found (claudeHome.sessions asks for it).
  await codex.codex.settled(claude.project)
  return { ...claude, ...codex }
}

describe('claudeHome.search over the Codex threads of the Project (worfy-multi-vendor ticket 28)', () => {
  it('finds the text of a Codex message, with its Vendor, merged with the Claude transcripts newest first; the snippet is cut as for Claude, and nothing is written', async () => {
    const { home, project, other, codex, codexHome, reads } = await codexWorld()
    const before = [await snapshot(home), await snapshot(codexHome), await snapshot(project), await snapshot(other)]
    const { call } = await ipcOver(registryOf(home), () => [], codex)
    const result = await call('claudeHome.search', { projectRoot: project, query: 'zebra' })
    const index = LONG_REPLY.indexOf('zebra')
    const cut = snippetAround(LONG_REPLY, index, 'zebra'.length)
    expect(cut.length).toBeLessThanOrEqual(120)
    expect(cut.startsWith('…') && cut.endsWith('…')).toBe(true)
    expect(result).toStrictEqual({
      ok: true,
      value: {
        hits: [
          { sessionId: T1, title: 'Theme the stripes', at: new Date(at(35)).getTime(), snippet: cut, vendor: 'codex' },
          { sessionId: B, title: 'Rename the module', at: new Date(at(30)).getTime(), snippet: 'Done: the ZEBRA module is now called stripes.' },
          { sessionId: A, title: 'Where does the Zebra config live?', at: new Date(at(20)).getTime(), snippet: 'Where does the Zebra config live?' },
          { sessionId: T2, title: 'Old zebra question', at: new Date(at(10)).getTime(), snippet: 'Is the ZEBRA icon still used?', vendor: 'codex' },
        ],
        limited: false,
      },
    })
    // The thread of another Project says "zebra" and is never read; a command and its output are not searched.
    expect(reads).toEqual([T1, T2])
    expect(JSON.stringify(result)).not.toContain(FOREIGN)
    expect(await call('claudeHome.search', { projectRoot: project, query: 'zebra-in-a' })).toStrictEqual({ ok: true, value: { hits: [], limited: false } })
    // Neither the Claude home, the Codex home, the Project's folder nor the other Project's has changed.
    expect([await snapshot(home), await snapshot(codexHome), await snapshot(project), await snapshot(other)]).toEqual(before)
  })

  it('a Codex thread counts against the file, byte and hit limits as a transcript does, and the answer says so', async () => {
    const { home, project, threads } = await codexWorld()
    const own = projectDirName(project)
    const c = (await lstat(join(home, 'projects', `${own}--claude-worktrees-07`, `${C}.jsonl`))).size
    // Newest first: C (no match), then T1. Two reads, and the limit is reached.
    const files = new TranscriptSearch(registryOf(home), { ...SEARCH_LIMITS, files: 2 }, [threads])
    expect(await files.search(project, 'zebra')).toMatchObject({ hits: [{ sessionId: T1, vendor: 'codex' }], limited: true })
    const hitsLimit = new TranscriptSearch(registryOf(home), { ...SEARCH_LIMITS, hits: 1 }, [threads])
    expect(await hitsLimit.search(project, 'zebra')).toMatchObject({ hits: [{ sessionId: T1 }], limited: true })
    // T1's messages take more bytes than what C leaves: skipped, and the older ones are still searched.
    const t1Bytes = Buffer.byteLength('Theme the stripes') + Buffer.byteLength(LONG_REPLY)
    const tight = new TranscriptSearch(registryOf(home), { ...SEARCH_LIMITS, bytes: c + t1Bytes - 1 }, [threads])
    const skipped = await tight.search(project, 'zebra')
    expect(skipped.limited).toBe(true)
    expect(skipped.hits.map((hit) => hit.sessionId)).not.toContain(T1)
    // With exactly its bytes left, it is searched.
    const exact = new TranscriptSearch(registryOf(home), { ...SEARCH_LIMITS, bytes: c + t1Bytes }, [threads])
    expect((await exact.search(project, 'zebra')).hits[0]).toMatchObject({ sessionId: T1, vendor: 'codex' })
  })

  it('keeps a read thread in memory until its time changes, then reads it again', async () => {
    const { project, home, codex, reads, write, threads } = await codexWorld()
    const search = new TranscriptSearch(registryOf(home), SEARCH_LIMITS, [threads])
    expect((await search.search(project, 'zebra')).hits.map((hit) => hit.sessionId)).toEqual([T1, B, A, T2])
    expect(reads).toEqual([T1, T2])
    // A second search, another query: no thread is read again.
    expect((await search.search(project, 'theme.ts')).hits.map((hit) => hit.sessionId)).toEqual([T1])
    expect(reads).toEqual([T1, T2])
    // Codex now says T1 changed (a new time and a new reply); T2 is the same.
    await write([
      { id: T1, cwd: project, minute: 45, preview: 'Theme the stripes', user: 'Theme the stripes', reply: 'The okapi pattern replaced it.' },
      { id: T2, cwd: join(project, 'src'), minute: 10, preview: 'Old zebra question', user: 'Is the ZEBRA icon still used?', reply: 'Not any more.' },
    ])
    await codex.settled(project)
    expect(await search.search(project, 'okapi')).toMatchObject({ hits: [{ sessionId: T1, at: new Date(at(45)).getTime(), vendor: 'codex' }], limited: false })
    expect(reads).toEqual([T1, T2, T1])
  })

  it('a Codex that cannot read a thread is not asked for the others in that search: the Claude hits come, and the answer says threads were left out', async () => {
    const { home, project, codex } = await codexWorld()
    const asked: string[] = []
    const failing: VendorThreads = {
      vendor: 'codex',
      cached: (root) => codex.cached(root),
      transcript: (_root, id) => {
        asked.push(id)
        return Promise.reject(new Error('Codex did not answer thread/read within 30000 ms'))
      },
    }
    const search = new TranscriptSearch(registryOf(home), SEARCH_LIMITS, [failing])
    expect(await search.search(project, 'zebra')).toMatchObject({ hits: [{ sessionId: B }, { sessionId: A }], limited: true })
    expect(asked).toEqual([T1])
  })

  it('with no Codex thread in the last list the search is the Claude search', async () => {
    const { home, project } = await world()
    const empty: VendorThreads = { vendor: 'codex', cached: () => [], transcript: () => Promise.reject(new Error('never read')) }
    const search = new TranscriptSearch(registryOf(home), SEARCH_LIMITS, [empty])
    expect(await search.search(project, 'zebra')).toMatchObject({ hits: [{ sessionId: B }, { sessionId: A }], limited: false })
  })
})

describe('snippetAround', () => {
  it('keeps a short message whole and cuts a long one around the match, at most 120 characters', () => {
    expect(snippetAround('short', 0, 5)).toBe('short')
    const long = `${'a'.repeat(300)}NEEDLE${'b'.repeat(300)}`
    const snippet = snippetAround(long, 300, 6)
    expect(snippet.length).toBeLessThanOrEqual(120)
    expect(snippet).toContain('NEEDLE')
    expect(snippet.startsWith('…') && snippet.endsWith('…')).toBe(true)
    expect(snippetAround(long, 0, 3).startsWith('aaa')).toBe(true)
    expect(snippetAround(long, long.length - 3, 3).endsWith('bbb')).toBe(true)
  })
})
