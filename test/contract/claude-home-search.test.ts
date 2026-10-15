// `claudeHome.search` (worfy-polish ticket 10): text search over the transcripts of a Project's
// Sessions, wherever they were started. Every test builds its own Claude home in a temporary
// directory (the WORFY_CLAUDE_HOME of the main process) and never reads the real ~/.claude. The
// Claude home is only read: a snapshot of every file before and after proves it.
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeHomeRegistry, projectDirName } from '../../src/main/claude-home/registry'
import { SEARCH_LIMITS, snippetAround, TranscriptSearch } from '../../src/main/claude-home/search'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const temps: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
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

async function ipcOver(registry: ClaudeHomeRegistry, projects: () => readonly { path: string }[] = () => []) {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
  closers.push(() => subscriptions.closeAll())
  await registerIpc(ipc, { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, undefined, projects) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
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
