import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHomeRegistry, projectDirName, type ClaudeHomeChange, type ClaudeHomeWatch } from '../../src/main/claude-home/registry'

// chokidar 5 reports a change of a path at most once in 50 ms and drops the rest: a writer that
// truncates a transcript and then writes it gives one `change`, and the watcher may read the file
// between the two. Here chokidar reports only what the test emits, and the test sees each read of
// a transcript through `open` of node:fs/promises.
const state = vi.hoisted(() => ({
  watcher: undefined as (EventEmitter & { add: () => unknown; close: () => Promise<void> }) | undefined,
  /** Paths opened for reading, in order. */
  opened: [] as string[],
  /** Run once after the next read of this path closes, before the reader goes on. */
  afterRead: undefined as { path: string; run: () => void } | undefined,
}))

vi.mock('chokidar', () => ({
  watch: () => {
    const watcher = new EventEmitter() as EventEmitter & { add: () => unknown; close: () => Promise<void> }
    watcher.add = () => watcher
    watcher.close = () => Promise.resolve()
    setTimeout(() => watcher.emit('ready'), 0)
    state.watcher = watcher
    return watcher
  },
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const open = (async (path: string, ...rest: unknown[]) => {
    const handle = await (actual.open as (...args: unknown[]) => Promise<Awaited<ReturnType<typeof actual.open>>>)(path, ...rest)
    if (!String(path).endsWith('.jsonl')) return handle
    state.opened.push(String(path))
    return new Proxy(handle, {
      get(target, key) {
        if (key === 'close')
          return async () => {
            await target.close()
            const after = state.afterRead
            if (after?.path === String(path)) {
              state.afterRead = undefined
              after.run()
            }
          }
        const value = Reflect.get(target, key, target) as unknown
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })
  }) as typeof actual.open
  return { ...actual, default: { ...actual, open }, open }
})

const ID = 'f1111111-1111-4111-8111-111111111111'
const enqueue = JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-01-10T09:00:07.000Z', sessionId: ID, content: 'x' })

let home: string | undefined
let watch: ClaudeHomeWatch | undefined

afterEach(async () => {
  await watch?.close()
  watch = undefined
  state.watcher = undefined
  state.opened = []
  state.afterRead = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

/** A transcript whose cwd is not known yet, watched from a Linked machine (an unknown cwd is not reported). */
async function watched(): Promise<{ path: string; project: string; changes: ClaudeHomeChange[] }> {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-dropped-change-')))
  const project = join(home, 'p', 'A')
  await mkdir(project, { recursive: true })
  const folder = join(home, 'claude', 'projects', projectDirName(project))
  await mkdir(folder, { recursive: true })
  await mkdir(join(home, 'claude', 'sessions'), { recursive: true })
  const path = join(folder, `${ID}.jsonl`)
  await writeFile(path, `${enqueue}\n`)
  const registry = new ClaudeHomeRegistry({ home: join(home, 'claude'), listWorktrees: async () => [], isAlive: async () => true })
  const changes: ClaudeHomeChange[] = []
  watch = await registry.watch({ path: project, gitAt: project }, (change) => changes.push(change), { debounceMs: 20 })
  await watch.ready
  return { path, project, changes }
}

const userLine = (cwd: string): string =>
  JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-06-01T00:00:00.000Z', cwd, gitBranch: 'main', isSidechain: false, message: { role: 'user', content: 'a prompt' } })

/** Resolves once the next read of `path` has closed; `run` goes first, before the reader sees what it read. */
const nextRead = (path: string, run: () => void = () => undefined): Promise<void> =>
  new Promise((done) => {
    state.afterRead = {
      path,
      run: () => {
        run()
        done()
      },
    }
  })

describe('a write that chokidar drops after the change it reported', () => {
  it('a transcript read while still empty and written right after is read again and reported', async () => {
    const { path, project, changes } = await watched()
    writeFileSync(path, '')
    // The read of the truncated file closes; the line lands before the watcher goes on, with no change of its own.
    const read = nextRead(path, () => writeFileSync(path, `${userLine(project)}\n`))
    state.watcher?.emit('change', path)
    await read
    await vi.waitFor(() => expect(changes.flatMap((change) => change.transcripts)).toContain(ID), { timeout: 3000, interval: 20 })
  })

  it('a transcript whose cwd stays unknown is read once more per change, not again and again', async () => {
    const { path, changes } = await watched()
    const read = nextRead(path)
    state.watcher?.emit('change', path)
    await read
    await vi.waitFor(() => expect(state.opened).toHaveLength(2), { timeout: 3000, interval: 10 })
    await new Promise((done) => setTimeout(done, 300))
    expect(state.opened).toHaveLength(2)
    expect(changes.flatMap((change) => change.transcripts)).not.toContain(ID)
  })

  it('no read after close, though one more was due', async () => {
    const { path } = await watched()
    const read = nextRead(path)
    state.watcher?.emit('change', path)
    await read
    // The watcher takes in what it read without further I/O: by the next turn of the event loop it has set up the next read.
    await new Promise((done) => setImmediate(done))
    await watch?.close()
    await new Promise((done) => setTimeout(done, 200))
    expect(state.opened).toHaveLength(1)
  })
})
