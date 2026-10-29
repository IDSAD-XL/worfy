import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHomeRegistry, projectDirName, type ClaudeHomeChange, type ClaudeHomeWatch } from '../../src/main/claude-home/registry'

// On macOS every fs.watch of the process shares one FSEvents stream, which libuv makes again each
// time a watch starts or stops; a file written meanwhile is never reported. Here chokidar reports
// nothing at all, the way it does for such a dropped event, and the registry must still notice a
// Session that starts or ends. A test emits what chokidar did report through `watchers`.
const { watchers } = vi.hoisted(() => ({ watchers: [] as EventEmitter[] }))
vi.mock('chokidar', () => ({
  watch: () => {
    const watcher = new EventEmitter() as EventEmitter & { add: () => unknown; close: () => Promise<void> }
    watcher.add = () => watcher
    watcher.close = () => Promise.resolve()
    setTimeout(() => watcher.emit('ready'), 0)
    watchers.push(watcher)
    return watcher
  },
}))

const DEMO = '/Users/test/projects/demo'
const noWorktrees = (): Promise<string[]> => Promise.resolve([])

let home: string | undefined
let watch: ClaudeHomeWatch | undefined

afterEach(async () => {
  await watch?.close()
  watch = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

async function watched(pollMs?: number): Promise<{ sessions: string; changes: { at: number; change: ClaudeHomeChange }[] }> {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-missed-event-')))
  const sessions = join(home, 'sessions')
  await mkdir(sessions)
  await writeFile(join(sessions, '41000.json'), JSON.stringify({ pid: 41000, sessionId: 'before', cwd: DEMO }))
  const changes: { at: number; change: ClaudeHomeChange }[] = []
  const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: () => Promise.resolve(true) })
  watch = await registry.watch(DEMO, (change) => changes.push({ at: Date.now(), change }), pollMs === undefined ? {} : { pollMs })
  await watch.ready
  return { sessions, changes }
}

const sessionsChange = (changes: { at: number; change: ClaudeHomeChange }[]) =>
  vi.waitFor(
    () => {
      const found = changes.find((entry) => entry.change.sessions)
      if (!found) throw new Error('no sessions change yet')
      return found
    },
    { timeout: 3000, interval: 20 },
  )

describe('a registry change the file watcher never reports', () => {
  it('a new registry file is reported within half a second at the default interval', async () => {
    const { sessions, changes } = await watched()
    const written = Date.now()
    await writeFile(join(sessions, '41010.json'), JSON.stringify({ pid: 41010, sessionId: 'new', cwd: DEMO }))
    const found = await sessionsChange(changes)
    expect(found.at - written).toBeLessThanOrEqual(500)
  })

  it('a removed registry file and a rewritten one are reported too', async () => {
    const { sessions, changes } = await watched(50)
    await unlink(join(sessions, '41000.json'))
    await sessionsChange(changes)
    changes.length = 0
    await writeFile(join(sessions, '41020.json'), '{}')
    await sessionsChange(changes)
    changes.length = 0
    await writeFile(join(sessions, '41020.json'), JSON.stringify({ pid: 41020, sessionId: 'rewritten', cwd: DEMO, status: 'idle' }))
    await sessionsChange(changes)
  })

  it('reports nothing while the registry stays as it is, and nothing after close', async () => {
    const { sessions, changes } = await watched(50)
    await new Promise((done) => setTimeout(done, 300))
    expect(changes).toEqual([])
    await watch?.close()
    await writeFile(join(sessions, '41030.json'), '{}')
    await new Promise((done) => setTimeout(done, 300))
    expect(changes).toEqual([])
  })

  it('a file outside the registry names is not a registry change', async () => {
    const { sessions, changes } = await watched(50)
    await writeFile(join(sessions, '41040.key'), 'secret')
    await new Promise((done) => setTimeout(done, 300))
    expect(changes).toEqual([])
  })
})

// chokidar reports a new folder (addDir) before it lists the folder, and starts its fs.watch of it only after
// that list (node_modules/chokidar/handler.js, _handleDir): a file written between the two is reported by
// neither. Claude Code makes the folder of a new worktree or subfolder and writes the first transcript
// into it at once, so that transcript was not reported until its next write (claude-home-registry.test.ts,
// «reports transcripts in a subfolder of the root», FLAKY on the Linux runner). Here chokidar reports the
// folder and none of its files.
describe('a transcript in a new folder the file watcher never reports', () => {
  const userLine = (cwd: string, uuid: string): string =>
    JSON.stringify({ type: 'user', uuid, timestamp: '2026-06-01T00:00:00.000Z', cwd, gitBranch: 'main', isSidechain: false, message: { role: 'user', content: 'hi' } })

  it('the new folder is listed again: its transcript is reported, a look-alike Project\'s is not', async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-missed-event-')))
    await mkdir(join(home, 'sessions'))
    await mkdir(join(home, 'projects'))
    const changes: { at: number; change: ClaudeHomeChange }[] = []
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: () => Promise.resolve(true) })
    watch = await registry.watch(DEMO, (change) => changes.push({ at: Date.now(), change }), { debounceMs: 50 })
    await watch.ready
    const watcher = watchers.at(-1)
    if (watcher === undefined) throw new Error('the registry started no watcher')

    // One folder name for `<demo>/web` and the other Project `/Users/test/projects/demo-web`.
    const dir = join(home, 'projects', projectDirName(`${DEMO}/web`))
    await mkdir(dir)
    await writeFile(join(dir, 'foreign.jsonl'), `${userLine('/Users/test/projects/demo-web', 'f-1')}\n`)
    await writeFile(join(dir, 'ours.jsonl'), `${userLine(`${DEMO}/web`, 'o-1')}\n`)
    watcher.emit('addDir', dir)

    await vi.waitFor(
      () => {
        if (!changes.some((entry) => entry.change.transcripts.includes('ours'))) throw new Error('no change of ours yet')
      },
      { timeout: 3000, interval: 20 },
    )
    await new Promise((done) => setTimeout(done, 300))
    expect(changes.some((entry) => entry.change.transcripts.includes('foreign'))).toBe(false)
  })

  it('a folder of another Project is not listed', async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-missed-event-')))
    await mkdir(join(home, 'sessions'))
    await mkdir(join(home, 'projects'))
    const changes: { at: number; change: ClaudeHomeChange }[] = []
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: () => Promise.resolve(true) })
    watch = await registry.watch(DEMO, (change) => changes.push({ at: Date.now(), change }), { debounceMs: 50 })
    await watch.ready
    const other = join(home, 'projects', projectDirName('/Users/test/projects/other'))
    await mkdir(other)
    await writeFile(join(other, 'theirs.jsonl'), `${userLine('/Users/test/projects/other', 't-1')}\n`)
    watchers.at(-1)?.emit('addDir', other)
    await new Promise((done) => setTimeout(done, 1500))
    expect(changes).toEqual([])
  })
})
