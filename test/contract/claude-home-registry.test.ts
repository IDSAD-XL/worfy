import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHomeRegistry, gitWorktrees, processAlive, projectDirName, type ClaudeHomeChange } from '../../src/main/claude-home/registry'
import { readNewLines } from '../../src/main/claude-home/tail'
import { ClaudeHomeSubscriptions, claudeHomeHandlers, type Subscriber } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { parseTranscriptLines } from '../../src/shared/transcript/parse'

// The Claude home of ticket 09 (test/fixtures/claude-home/README.md). Tests never touch it: each
// one works on a copy in a temporary directory.
const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'claude-home')
const DEMO = '/Users/test/projects/demo'
const WORKTREE_07 = '/Users/test/projects/demo/.claude/worktrees/07'
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const S4 = '44444444-4444-4444-8444-444444444444'
const S5 = '55555555-5555-4555-8555-555555555555'
const S6 = '66666666-6666-4666-8666-666666666666'

const temps: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'worfy-claude-home-'))
  temps.push(dir)
  return dir
}

async function copyOfFixture(): Promise<string> {
  const home = join(await tempDir(), 'claude')
  await cp(FIXTURE, home, { recursive: true })
  return home
}

const alive =
  (...pids: number[]) =>
  async (pid: number): Promise<boolean> =>
    pids.includes(pid)

const noWorktrees = async (): Promise<string[]> => []

/** `ps -o lstart=` of a process, the way Claude Code records it as procStart. */
const lstart = async (pid: number): Promise<string> =>
  new Promise((done, fail) => {
    const ps = spawn('ps', ['-p', String(pid), '-o', 'lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } })
    let out = ''
    ps.stdout.on('data', (data: Buffer) => (out += data.toString()))
    ps.on('error', fail)
    ps.on('close', () => done(out.trim()))
  })

const execFileAsync = promisify(execFile)

/** Runs git for test setup, never against the repository the tests run in. */
const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  const { stdout } = await execFileAsync('git', ['-C', cwd, '-c', 'user.name=worfy-test', '-c', 'user.email=test@worfy.invalid', '-c', 'commit.gpgsign=false', ...args], { env })
  return stdout
}

const userLine = (text: string, cwd: string, uuid: string): string =>
  JSON.stringify({ type: 'user', uuid, timestamp: '2026-06-01T00:00:00.000Z', cwd, gitBranch: 'main', isSidechain: false, message: { role: 'user', content: text } })

/** mtime, size and content hash of every file and folder under `root`. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const stats = await lstat(path)
      if (entry.isDirectory()) {
        out[path] = `dir mtime=${stats.mtimeMs}`
        await walk(path)
      } else {
        const sha1 = createHash('sha1')
          .update(await readFile(path))
          .digest('hex')
        out[path] = `file mtime=${stats.mtimeMs} size=${stats.size} sha1=${sha1}`
      }
    }
  }
  out[root] = `dir mtime=${(await lstat(root)).mtimeMs}`
  await walk(root)
  return out
}

/** Collects watcher changes and lets a test wait for the one it expects. */
function changeLog() {
  const changes: { at: number; change: ClaudeHomeChange }[] = []
  return {
    changes,
    onChange: (change: ClaudeHomeChange) => changes.push({ at: Date.now(), change }),
    waitFor: (match: (change: ClaudeHomeChange) => boolean, timeoutMs = 3000) =>
      vi.waitFor(
        () => {
          const found = changes.find((entry) => match(entry.change))
          if (!found) throw new Error('no matching change yet')
          return found
        },
        { timeout: timeoutMs, interval: 20 },
      ),
  }
}

const assistantLine = (text: string, uuid: string): string =>
  JSON.stringify({ type: 'assistant', uuid, timestamp: '2026-05-05T10:07:00.000Z', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })

describe('project folder names', () => {
  it.each([
    ['/Users/test/projects/demo', '-Users-test-projects-demo'],
    ['/Users/test/projects/demo/.claude/worktrees/07', '-Users-test-projects-demo--claude-worktrees-07'],
    ['/Users/test/My Projects/demo.app', '-Users-test-My-Projects-demo-app'],
    ['/Users/test/проект', '-Users-test-------'],
    // NFD input (macOS file names) gives the same folder as NFC: one dash per letter, not two.
    ['/Users/test/café', '-Users-test-caf-'],
  ])('%s → %s', (cwd, dir) => {
    expect(projectDirName(cwd)).toBe(dir)
  })

  it('shortens a name longer than 200 characters with a hash of the path', () => {
    const cwd = `/Users/test/${'deep/'.repeat(60)}x`
    const name = projectDirName(cwd)
    expect(name).toMatch(/^-Users-test-deep-deep-.{178}-[0-9a-z]+$/)
    expect(name.slice(0, 200)).toBe(cwd.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200))
    expect(projectDirName(`${cwd}y`)).not.toBe(name)
  })
})

describe('live Sessions from the registry', () => {
  it('lists the live Sessions in the Project root and inside its worktrees', async () => {
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive(41004, 41005) })
    const { live } = await registry.sessions(DEMO)
    expect(live).toStrictEqual([
      {
        pid: 41004,
        sessionId: S4,
        cwd: WORKTREE_07,
        status: 'busy',
        entrypoint: 'cli',
        name: 'ship-demo-epic-07',
        kind: 'interactive',
        version: '2.1.284',
        startedAt: 1776722400000,
        updatedAt: 1776722460000,
      },
      {
        pid: 41005,
        sessionId: S5,
        cwd: DEMO,
        status: 'idle',
        entrypoint: 'claude-desktop',
        name: 'Synthetic wave run',
        kind: 'interactive',
        version: '2.1.286',
        startedAt: 1777975200000,
        updatedAt: 1777975260000,
      },
    ])
  })

  it('passes pid and procStart to the liveness check and drops a Session whose process is gone', async () => {
    const isAlive = vi.fn(alive(41004))
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive })
    const { live, history } = await registry.sessions(DEMO)
    expect(live.map((session) => session.pid)).toEqual([41004])
    expect(isAlive).toHaveBeenCalledWith(41005, 'Tue May  5 10:00:00 2026')
    expect(history.find((entry) => entry.sessionId === S4)?.live).toBe(true)
    expect(history.find((entry) => entry.sessionId === S5)?.live).toBe(false)
  })

  it('does not list Sessions of another Project', async () => {
    const isAlive = vi.fn(alive(41004, 41005))
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive })
    expect((await registry.sessions('/Users/test/projects/demo-other')).live).toEqual([])
    // Not even the liveness of a foreign Session is checked.
    expect(isAlive).not.toHaveBeenCalled()
  })

  it('lists a Session in a worktree outside the root, with its history folder', async () => {
    const home = await copyOfFixture()
    const elsewhere = '/Users/test/elsewhere/demo-wt'
    await writeFile(join(home, 'sessions', '41006.json'), JSON.stringify({ pid: 41006, sessionId: 'abc-6', cwd: elsewhere, status: 'thinking', procStart: 'x' }))
    await mkdir(join(home, 'projects', projectDirName(elsewhere)))
    await writeFile(join(home, 'projects', projectDirName(elsewhere), 'abc-6.jsonl'), `${JSON.stringify({ type: 'user', cwd: elsewhere, message: { content: 'Elsewhere prompt' } })}\n`)
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: async () => [elsewhere], isAlive: alive(41006) })
    const { live, history } = await registry.sessions(DEMO)
    expect(live).toStrictEqual([{ pid: 41006, sessionId: 'abc-6', cwd: elsewhere, status: 'unknown' }])
    expect(history.find((entry) => entry.sessionId === 'abc-6')).toMatchObject({ title: 'Elsewhere prompt', live: true })
  })

  it('lists a Session started in a subfolder of the root with its history and transcript, and not a look-alike Project', async () => {
    const home = await copyOfFixture()
    const web = `${DEMO}/packages/web`
    // `/Users/test/projects/demo/web` and the other Project `/Users/test/projects/demo-web` share one folder name.
    const demoWeb = '/Users/test/projects/demo-web'
    const write = async (cwd: string, sessionId: string) => {
      await mkdir(join(home, 'projects', projectDirName(cwd)), { recursive: true })
      await writeFile(join(home, 'projects', projectDirName(cwd), `${sessionId}.jsonl`), `${userLine(`Prompt in ${cwd}`, cwd, `${sessionId}-u`)}\n`)
    }
    await writeFile(join(home, 'sessions', '41011.json'), JSON.stringify({ pid: 41011, sessionId: 'sub-live', cwd: web, status: 'busy' }))
    await write(web, 'sub-live')
    await write(web, 'sub-done')
    await write(`${DEMO}/web`, 'sub-web')
    await write(demoWeb, 'demo-web-1')
    expect(projectDirName(`${DEMO}/web`)).toBe(projectDirName(demoWeb))

    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive(41011) })
    const { live, history } = await registry.sessions(DEMO)
    expect(live).toStrictEqual([{ pid: 41011, sessionId: 'sub-live', cwd: web, status: 'busy' }])
    const byId = new Map(history.map((entry) => [entry.sessionId, entry]))
    expect(byId.get('sub-live')).toMatchObject({ cwd: web, live: true, title: `Prompt in ${web}` })
    expect(byId.get('sub-done')).toMatchObject({ cwd: web, live: false })
    expect(byId.get('sub-web')).toMatchObject({ cwd: `${DEMO}/web` })
    expect(byId.has('demo-web-1')).toBe(false)
    expect(await registry.transcriptPath(DEMO, 'sub-live')).toBe(join(home, 'projects', projectDirName(web), 'sub-live.jsonl'))
    expect(await registry.transcriptPath(DEMO, 'sub-web')).toBe(join(home, 'projects', projectDirName(demoWeb), 'sub-web.jsonl'))
    expect(await registry.transcriptPath(DEMO, 'demo-web-1')).toBeNull()
    // The look-alike Project still finds its own Session.
    expect(await registry.transcriptPath(demoWeb, 'demo-web-1')).toBe(join(home, 'projects', projectDirName(demoWeb), 'demo-web-1.jsonl'))
  })

  it('finds worktrees with the real `git worktree list` and leaves the repository unchanged', async () => {
    const base = await realpath(await tempDir())
    const repo = join(base, 'repo')
    const outside = join(base, 'outside-wt')
    await mkdir(repo)
    await git(repo, 'init', '-q', '-b', 'main')
    await writeFile(join(repo, 'README.md'), 'demo\n')
    await git(repo, 'add', 'README.md')
    await git(repo, 'commit', '-q', '-m', 'init')
    await git(repo, 'worktree', 'add', '-q', '-b', 'feature', outside)
    expect(await gitWorktrees(repo)).toStrictEqual([outside])
    // git fails outside a repository: no worktrees, no error.
    expect(await gitWorktrees(join(base, 'missing'))).toStrictEqual([])

    const home = join(base, 'claude')
    const cwd = join(outside, 'src')
    await mkdir(join(home, 'sessions'), { recursive: true })
    await writeFile(join(home, 'sessions', '41012.json'), JSON.stringify({ pid: 41012, sessionId: 'wt-live', cwd, status: 'idle' }))
    await mkdir(join(home, 'projects', projectDirName(outside)), { recursive: true })
    await writeFile(join(home, 'projects', projectDirName(outside), 'wt-done.jsonl'), `${userLine('In the outside worktree', outside, 'wt-u')}\n`)

    const before = { repo: await snapshot(repo), outside: await snapshot(outside) }
    // Default listWorktrees: the real `git worktree list --porcelain` in the repository.
    const registry = new ClaudeHomeRegistry({ home, isAlive: alive(41012) })
    const { live, history } = await registry.sessions(repo)
    expect(live.map((session) => session.sessionId)).toEqual(['wt-live'])
    expect(history.map((entry) => entry.sessionId)).toEqual(['wt-done'])
    expect(await registry.transcriptPath(repo, 'wt-done')).toBe(join(home, 'projects', projectDirName(outside), 'wt-done.jsonl'))
    expect({ repo: await snapshot(repo), outside: await snapshot(outside) }).toStrictEqual(before)
  })

  it('skips registry files it cannot read and never opens the .key files', async () => {
    const home = await copyOfFixture()
    await writeFile(join(home, 'sessions', '41007.json'), '{"pid": 41007, "sessionId": ')
    await writeFile(join(home, 'sessions', '41008.json'), JSON.stringify({ pid: 'not-a-number', sessionId: 'x', cwd: DEMO }))
    await writeFile(join(home, 'sessions', '41009.json'), JSON.stringify({ pid: -1, sessionId: 'x', cwd: DEMO }))
    await writeFile(join(home, 'sessions', '41004.0123abcd.key'), '{"pid": 41004, "sessionId": "key", "cwd": "/Users/test/projects/demo"}')
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: async () => true })
    expect((await registry.sessions(DEMO)).live.map((session) => session.pid)).toEqual([41004, 41005])
  })

  it('returns nothing, without failing, when the Claude home is empty', async () => {
    const registry = new ClaudeHomeRegistry({ home: await tempDir(), listWorktrees: noWorktrees, isAlive: async () => true })
    expect(await registry.sessions(DEMO)).toEqual({ live: [], history: [] })
  })
})

describe('process liveness', () => {
  it('is alive for a running process started at procStart', async () => {
    expect(await processAlive(process.pid, await lstart(process.pid))).toBe(true)
    expect(await processAlive(process.pid, undefined)).toBe(true)
  })

  it('is not alive when the pid now belongs to a process started at another time', async () => {
    expect(await processAlive(process.pid, 'Thu Jan  1 00:00:00 1970')).toBe(false)
  })

  it('is not alive for a process that has exited, or for a pid that is not a process id', async () => {
    const child = spawn(process.execPath, ['-e', ''], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    const pid = child.pid ?? 0
    await new Promise((done) => child.on('exit', done))
    expect(await processAlive(pid, undefined)).toBe(false)
    expect(await processAlive(0, undefined)).toBe(false)
    expect(await processAlive(-1, undefined)).toBe(false)
  })
})

describe('Session history', () => {
  it('lists the transcripts of the root and of worktrees, including removed ones, without Subagents', async () => {
    // git knows no worktree: the 07 folder is found by the <root>--claude-worktrees- prefix.
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive() })
    const { history } = await registry.sessions(DEMO)
    expect(history.map((entry) => entry.sessionId).sort()).toEqual([S1, S2, S4, S5])
  })

  it('reads title, times, cwd and branch of each Session', async () => {
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: async () => [WORKTREE_07], isAlive: alive() })
    const byId = new Map((await registry.sessions(DEMO)).history.map((entry) => [entry.sessionId, entry]))
    // The last custom-title wins over an earlier ai-title.
    expect(byId.get(S1)).toMatchObject({ title: 'Synthetic custom title one', cwd: DEMO, gitBranch: 'main', live: false })
    expect(byId.get(S1)?.firstAt).toBe('2026-01-10T09:00:07.000Z')
    expect(byId.get(S1)?.lastAt).toMatch(/^2026-01-10T/)
    expect(byId.get(S2)).toMatchObject({ title: 'Synthetic custom title two' })
    expect(byId.get(S4)).toMatchObject({ title: 'Ship demo-epic 07', cwd: WORKTREE_07, gitBranch: 'demo-epic/07' })
    expect(byId.get(S5)).toMatchObject({ title: 'Synthetic wave run' })
    for (const entry of byId.values()) {
      expect(entry.size).toBeGreaterThan(0)
      expect(entry.modifiedAt).toBeGreaterThan(0)
    }
  })

  it('falls back to the first prompt, and keeps the cwd the Session was started in', async () => {
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive() })
    expect((await registry.sessions('/Users/test/проект')).history).toMatchObject([{ sessionId: S6, title: 'Synthetic prompt six.', cwd: '/Users/test/проект' }])
    // `cd sub` in the middle of the Session changes the records' cwd, not the Session's.
    expect((await registry.sessions('/Users/test/My Projects/demo.app')).history).toMatchObject([
      { title: 'Synthetic prompt three.', cwd: '/Users/test/My Projects/demo.app', gitBranch: 'HEAD' },
    ])
  })

  it('names a Session that starts with a slash command after the command', async () => {
    const home = await copyOfFixture()
    const file = join(home, 'projects', '-Users-test-projects-demo', `${S2}.jsonl`)
    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => !line.includes('"custom-title"'))
    await writeFile(file, lines.join('\n'))
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    expect((await registry.sessions(DEMO)).history.find((entry) => entry.sessionId === S2)?.title).toBe('/demo-skill')
  })

  it('skips text the harness injected (isMeta) and takes the first prompt the user typed as the title', async () => {
    const home = await copyOfFixture()
    const file = join(home, 'projects', '-Users-test-projects-demo', 'meta-1.jsonl')
    const lines = [
      JSON.stringify({ type: 'user', uuid: 'meta', isMeta: true, timestamp: '2026-06-01T00:00:00.000Z', cwd: DEMO, message: { content: 'Base directory for this skill: injected text' } }),
      JSON.stringify({ type: 'user', uuid: 'meta-block', isMeta: true, timestamp: '2026-06-01T00:00:01.000Z', cwd: DEMO, message: { content: [{ type: 'text', text: 'Injected block text' }] } }),
      JSON.stringify({ type: 'user', uuid: 'real', timestamp: '2026-06-01T00:00:02.000Z', cwd: DEMO, message: { content: 'The prompt the user typed' } }),
    ]
    await writeFile(file, `${lines.join('\n')}\n`)
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    expect((await registry.sessions(DEMO)).history.find((entry) => entry.sessionId === 'meta-1')?.title).toBe('The prompt the user typed')
  })

  it('reads only the head and the tail of a large transcript', async () => {
    const home = await copyOfFixture()
    const file = join(home, 'projects', '-Users-test-projects-demo', 'big-1.jsonl')
    const filler = (n: number) => assistantLine('x'.repeat(500), `filler-${n}`)
    const lines = [
      JSON.stringify({ type: 'user', uuid: 'first', timestamp: '2026-06-01T00:00:00.000Z', cwd: DEMO, gitBranch: 'main', message: { content: 'Big first prompt' } }),
      ...Array.from({ length: 2000 }, (_, n) => filler(n)),
      // In the middle: a title that a full read would find and a head-and-tail read must not.
      JSON.stringify({ type: 'custom-title', customTitle: 'Title in the middle' }),
      ...Array.from({ length: 2000 }, (_, n) => filler(n + 2000)),
      JSON.stringify({ type: 'user', uuid: 'last', timestamp: '2026-06-02T00:00:00.000Z', cwd: DEMO, gitBranch: 'feature', message: { content: 'last' } }),
    ]
    await writeFile(file, `${lines.join('\n')}\n`)
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const entry = (await registry.sessions(DEMO)).history.find((item) => item.sessionId === 'big-1')
    expect(entry).toMatchObject({ title: 'Big first prompt', firstAt: '2026-06-01T00:00:00.000Z', lastAt: '2026-06-02T00:00:00.000Z', gitBranch: 'feature' })
  })

  it('builds the history index of an Auction-sized Project in at most one second', async () => {
    // Auction (ticket 09, "Объёмы"): 88 Sessions in the root and the rest in worktrees. Files are
    // larger than the head and tail windows, so the list has to skip their middles.
    const home = await tempDir()
    const root = '/Users/test/auction'
    const body = `${Array.from({ length: 600 }, (_, n) => assistantLine('y'.repeat(400), `l-${n}`)).join('\n')}\n`
    const write = async (dir: string, count: number, prefix: string) => {
      await mkdir(join(home, 'projects', dir), { recursive: true })
      for (let n = 0; n < count; n += 1) {
        const head = JSON.stringify({ type: 'user', timestamp: '2026-06-01T00:00:00.000Z', cwd: root, gitBranch: 'main', message: { content: `Prompt ${prefix}${n}` } })
        await writeFile(join(home, 'projects', dir, `${prefix}${n}.jsonl`), `${head}\n${body}${JSON.stringify({ type: 'custom-title', customTitle: `T ${prefix}${n}` })}\n`)
      }
    }
    await write(projectDirName(root), 88, 'root-')
    for (let w = 0; w < 13; w += 1) await write(`${projectDirName(root)}--claude-worktrees-${w}`, 3, `wt${w}-`)
    // Unrelated folders around it are not read.
    await write('-Users-test-other', 5, 'other-')

    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const started = performance.now()
    const { history } = await registry.sessions(root)
    const elapsed = performance.now() - started
    console.info(`[claude-home] history index of ${history.length} Sessions in ${elapsed.toFixed(0)} ms`)
    expect(history).toHaveLength(88 + 39)
    expect(history.every((entry) => entry.title === `T ${entry.sessionId}`)).toBe(true)
    expect(elapsed).toBeLessThanOrEqual(1000)
  })
})

describe('transcript lookup', () => {
  it('finds a transcript in the root or in a worktree folder and nowhere else', async () => {
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive() })
    expect(await registry.transcriptPath(DEMO, S4)).toBe(join(FIXTURE, 'projects', '-Users-test-projects-demo--claude-worktrees-07', `${S4}.jsonl`))
    expect(await registry.transcriptPath(DEMO, S1)).toBe(join(FIXTURE, 'projects', '-Users-test-projects-demo', `${S1}.jsonl`))
    // Another Project's Session, a missing one and a path in disguise are not found.
    expect(await registry.transcriptPath(DEMO, S6)).toBeNull()
    expect(await registry.transcriptPath(DEMO, 'no-such-session')).toBeNull()
    expect(await registry.transcriptPath(DEMO, '../-Users-test-------/66666666-6666-4666-8666-666666666666')).toBeNull()
  })
})

describe('watching the Claude home', () => {
  it('delivers a record appended to a transcript as an event within one second, half lines included once', async () => {
    const home = await copyOfFixture()
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const file = (await registry.transcriptPath(DEMO, S5)) ?? ''
    let cursor = (await readNewLines(file)).cursor
    const log = changeLog()
    // The default debounce: the app's own delay is what is measured.
    const watch = await registry.watch(DEMO, log.onChange)
    closers.push(() => watch.close())
    await watch.ready

    const line = assistantLine('Appended while watching', 'appended-1')
    const half = Math.floor(line.length / 2)
    const written = Date.now()
    await appendFile(file, line.slice(0, half))
    const first = await log.waitFor((change) => change.transcripts.includes(S5))
    expect(first.at - written).toBeLessThanOrEqual(1000)
    const partial = await readNewLines(file, cursor)
    expect(partial.lines).toEqual([])
    cursor = partial.cursor

    log.changes.length = 0
    const rest = Date.now()
    await appendFile(file, `${line.slice(half)}\n`)
    const second = await log.waitFor((change) => change.transcripts.includes(S5))
    const chunk = await readNewLines(file, cursor)
    const events = parseTranscriptLines(chunk.lines)
    expect(Date.now() - rest).toBeLessThanOrEqual(1000)
    expect(second.at - rest).toBeLessThanOrEqual(1000)
    expect(events).toStrictEqual([
      {
        uuid: 'appended-1',
        timestamp: '2026-05-05T10:07:00.000Z',
        sidechain: false,
        event: { type: 'text', text: 'Appended while watching', messageId: 'appended-1', parentToolUseId: null, synthetic: false },
      },
    ])
    expect((await readNewLines(file, chunk.cursor)).lines).toEqual([])
  })

  it('reports registry changes and transcripts in a new worktree folder, not other Projects', async () => {
    const home = await copyOfFixture()
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const log = changeLog()
    const watch = await registry.watch(DEMO, log.onChange, { debounceMs: 50 })
    closers.push(() => watch.close())
    await watch.ready
    // FSEvents may replay the fixture copy as a `sessions` change; let it pass, then forget it, so
    // the wait below sees the new registry file and nothing else.
    await new Promise((done) => setTimeout(done, 300))
    log.changes.length = 0

    await writeFile(join(home, 'sessions', '41010.json'), JSON.stringify({ pid: 41010, sessionId: 'n', cwd: DEMO }))
    await log.waitFor((change) => change.sessions)

    await appendFile(join(home, 'projects', '-Users-test-------', `${S6}.jsonl`), `${assistantLine('other project', 'o-1')}\n`)
    const worktreeDir = join(home, 'projects', '-Users-test-projects-demo--claude-worktrees-99')
    await mkdir(worktreeDir)
    await writeFile(join(worktreeDir, 'new-session.jsonl'), `${assistantLine('in a new worktree', 'w-1')}\n`)
    await log.waitFor((change) => change.transcripts.includes('new-session'))
    expect(log.changes.some((entry) => entry.change.transcripts.includes(S6))).toBe(false)
  })

  it('reports transcripts in a subfolder of the root, not those of a look-alike Project', async () => {
    const home = await copyOfFixture()
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const log = changeLog()
    const watch = await registry.watch(DEMO, log.onChange, { debounceMs: 50 })
    closers.push(() => watch.close())
    await watch.ready

    // One folder name for `<demo>/web` and the other Project `/Users/test/projects/demo-web`.
    const dir = join(home, 'projects', projectDirName(`${DEMO}/web`))
    await mkdir(dir)
    await writeFile(join(dir, 'foreign.jsonl'), `${userLine('foreign', '/Users/test/projects/demo-web', 'f-1')}\n`)
    await writeFile(join(dir, 'ours.jsonl'), `${userLine('ours', `${DEMO}/web`, 'o-1')}\n`)
    await log.waitFor((change) => change.transcripts.includes('ours'))
    await appendFile(join(dir, 'foreign.jsonl'), `${assistantLine('still foreign', 'f-2')}\n`)
    await appendFile(join(dir, 'ours.jsonl'), `${assistantLine('still ours', 'o-2')}\n`)
    await new Promise((done) => setTimeout(done, 300))
    expect(log.changes.some((entry) => entry.change.transcripts.includes('foreign'))).toBe(false)
  })

  it('reports the removal of a subfolder transcript that existed before watching, not of a look-alike Project', async () => {
    const home = await copyOfFixture()
    const dir = join(home, 'projects', projectDirName(`${DEMO}/web`))
    await mkdir(dir)
    await writeFile(join(dir, 'foreign.jsonl'), `${userLine('foreign', '/Users/test/projects/demo-web', 'f-1')}\n`)
    await writeFile(join(dir, 'ours.jsonl'), `${userLine('ours', `${DEMO}/web`, 'o-1')}\n`)
    // Claude Code has created the file but not written its first record yet: the cwd is unknown.
    await writeFile(join(dir, 'unknown.jsonl'), '')
    // FSEvents replays writes from just before a watch starts; older files are not replayed.
    await new Promise((done) => setTimeout(done, 1000))
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const log = changeLog()
    const watch = await registry.watch(DEMO, log.onChange, { debounceMs: 50 })
    closers.push(() => watch.close())
    await watch.ready
    // FSEvents may replay the writes above; let them pass, then forget them.
    await new Promise((done) => setTimeout(done, 300))
    log.changes.length = 0

    await rm(join(dir, 'foreign.jsonl'))
    await rm(join(dir, 'ours.jsonl'))
    await rm(join(dir, 'unknown.jsonl'))
    // A removal whose cwd was never known is reported: an extra reread costs less than a stale list.
    await log.waitFor((change) => change.transcripts.includes('ours'))
    await log.waitFor((change) => change.transcripts.includes('unknown'))
    await new Promise((done) => setTimeout(done, 300))
    expect(log.changes.some((entry) => entry.change.transcripts.includes('foreign'))).toBe(false)
  })
})

describe('read-only access to the Claude home', () => {
  it('leaves every file and folder under the Claude home unchanged', async () => {
    const home = await copyOfFixture()
    // A registry entry of a running process (this one), so the default liveness check gets past
    // `kill(pid, 0)` and really runs `ps`.
    await writeFile(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'this-process', cwd: DEMO, procStart: await lstart(process.pid), status: 'idle' }))
    const before = await snapshot(home)
    // Default liveness and worktree checks: they run `ps` and `git`, which must not write either.
    const registry = new ClaudeHomeRegistry({ home })
    expect((await registry.sessions(DEMO)).live.map((session) => session.sessionId)).toEqual(['this-process'])
    const log = changeLog()
    const watch = await registry.watch(DEMO, log.onChange)
    await watch.ready
    for (const root of [DEMO, '/Users/test/проект', '/Users/test/My Projects/demo.app']) {
      const { history } = await registry.sessions(root)
      for (const entry of history) {
        const path = await registry.transcriptPath(root, entry.sessionId)
        expect(path).not.toBeNull()
        let chunk = await readNewLines(path ?? '', undefined, { maxBytes: 512 })
        while (chunk.more) chunk = await readNewLines(path ?? '', chunk.cursor, { maxBytes: 512 })
      }
    }
    await watch.close()
    expect(await snapshot(home)).toStrictEqual(before)
  })
})

// --- IPC ---------------------------------------------------------------------------------------

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function fakeSender(id: number) {
  const sent: { channel: string; payload: unknown }[] = []
  let destroyed = false
  const onDestroyed: (() => void)[] = []
  const sender: Subscriber = {
    id,
    send: (channel, payload) => sent.push({ channel, payload }),
    isDestroyed: () => destroyed,
    once: (_event, listener) => onDestroyed.push(listener),
  }
  const destroy = () => {
    destroyed = true
    for (const listener of onDestroyed) listener()
  }
  return { sender, sent, destroy }
}

async function ipcOver(registry: ClaudeHomeRegistry) {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const subscriptions = new ClaudeHomeSubscriptions(registry)
  closers.push(() => subscriptions.closeAll())
  await registerIpc(ipc, { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  const call = async (channel: string, input: unknown, sender?: Subscriber): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: `file://${INDEX_HTML}` }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  return { handlers, call, subscriptions }
}

describe('claudeHome IPC channels', () => {
  it('registers the four request channels of the domain', async () => {
    const { handlers } = await ipcOver(new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive() }))
    expect([...handlers.keys()].sort()).toEqual(['worfy:claudeHome.close', 'worfy:claudeHome.live', 'worfy:claudeHome.sessions', 'worfy:claudeHome.transcript'])
  })

  it.each([
    ['claudeHome.sessions', { projectRoot: 'relative/path' }],
    ['claudeHome.sessions', { projectRoot: 42 }],
    ['claudeHome.sessions', undefined],
    ['claudeHome.live', { projectRoot: 'relative/path' }],
    ['claudeHome.live', { projectRoot: ['/Users/test/projects/demo'] }],
    ['claudeHome.close', { projectRoot: 'relative/path' }],
    ['claudeHome.close', {}],
    ['claudeHome.transcript', { projectRoot: DEMO, sessionId: '../../etc/passwd' }],
    ['claudeHome.transcript', { projectRoot: DEMO, sessionId: `${S1}/x` }],
    ['claudeHome.transcript', { projectRoot: DEMO, sessionId: S1, cursor: { offset: -1, fileId: null } }],
    ['claudeHome.transcript', { projectRoot: DEMO, sessionId: S1, maxBytes: 0 }],
  ])('rejects %s with input %j', async (channel, input) => {
    const { call } = await ipcOver(new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive() }))
    const result = await call(channel, input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/invalid input/)
  })

  it('answers live with the live Sessions only, in the contract fields only', async () => {
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive(41005) })
    const { call } = await ipcOver(registry)
    const plain = await call('claudeHome.live', { projectRoot: DEMO })
    expect(plain).toStrictEqual({ ok: true, value: { live: (await registry.sessions(DEMO)).live } })
    expect(plain.ok && (plain.value as { live: { pid: number }[] }).live.map((session) => session.pid)).toEqual([41005])
    // A registry that leaks fields of the raw files: the channel must not pass them on.
    vi.spyOn(registry, 'live').mockImplementation(async () => {
      const real = await ClaudeHomeRegistry.prototype.live.call(registry, DEMO)
      return real.map((session) => ({ ...session, messagingSocketPath: '/Users/test/tmp/cc-socks/41005.sock' }))
    })
    const result = await call('claudeHome.live', { projectRoot: DEMO, extra: true })
    expect(JSON.stringify(result)).not.toMatch(/messagingSocketPath/)
    expect(result).toStrictEqual(plain)
  })

  it('sends the events of the Session thread, as a live Session sends them', async () => {
    const home = await copyOfFixture()
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const file = (await registry.transcriptPath(DEMO, S5)) ?? ''
    // An older Claude Code wrote a Subagent's records into the Session's own file.
    await appendFile(file, `${JSON.stringify({ type: 'assistant', isSidechain: true, agentId: 'a9', uuid: 'side-1', message: { id: 'm9', content: [{ type: 'text', text: 'from a subagent' }] } })}\n`)
    await appendFile(file, `${assistantLine('after the subagent', 'own-1')}\n`)
    const { call } = await ipcOver(registry)
    const result = await call('claudeHome.transcript', { projectRoot: DEMO, sessionId: S5 })
    if (!result.ok) throw new Error(result.error)
    const { events } = result.value as { events: { type: string; text?: string }[] }
    expect(events.map((event) => event.text)).not.toContain('from a subagent')
    expect(events.at(-1)).toStrictEqual({ type: 'text', text: 'after the subagent', messageId: 'own-1', parentToolUseId: null, synthetic: false })
  })

  it('answers sessions with the contract fields only', async () => {
    const registry = new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive(41005) })
    // A registry that leaks fields of the raw files: the channel must not pass them on.
    vi.spyOn(registry, 'sessions').mockImplementation(async () => {
      const real = await ClaudeHomeRegistry.prototype.sessions.call(registry, DEMO)
      return {
        live: real.live.map((session) => ({ ...session, messagingSocketPath: '/Users/test/tmp/cc-socks/41005.sock' })),
        history: real.history.map((entry) => ({ ...entry, rawRecords: ['secret'] })),
      }
    })
    const { call } = await ipcOver(registry)
    const result = await call('claudeHome.sessions', { projectRoot: DEMO, extra: true })
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/messagingSocketPath|rawRecords|secret/)
    expect(result.ok && result.value).toMatchObject({ live: [{ pid: 41005, sessionId: S5 }], history: expect.arrayContaining([expect.objectContaining({ sessionId: S1 })]) })
  })

  it('pages through a transcript by cursor and answers found: false for an unknown Session', async () => {
    const { call } = await ipcOver(new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive() }))
    const kinds: string[] = []
    let cursor: unknown
    for (let round = 0; round < 50; round += 1) {
      const result = await call('claudeHome.transcript', { projectRoot: DEMO, sessionId: S5, maxBytes: 1024, ...(cursor ? { cursor } : {}) })
      if (!result.ok) throw new Error(result.error)
      const value = result.value as { found: boolean; events: { type: string }[]; cursor: unknown; more: boolean }
      expect(value.found).toBe(true)
      kinds.push(...value.events.map((event) => event.type))
      cursor = value.cursor
      if (!value.more) break
    }
    // The events of a live Session (src/shared/agent/events.ts); the Stop hook that said nothing is not one.
    expect(kinds).toEqual(['unknown', 'unknown', 'command', 'unknown', 'thinking', 'tool_use', 'tool_result', 'subagent', 'text', 'subagent', 'text', 'title', 'title', 'unknown', 'unknown'])
    expect(await call('claudeHome.transcript', { projectRoot: DEMO, sessionId: S6 })).toStrictEqual({
      ok: true,
      value: { found: false, events: [], cursor: { offset: 0, fileId: null }, reset: false, more: false },
    })
  })

  it('sends claudeHome.changed to the window that asked for the Sessions, until it is closed', async () => {
    const home = await copyOfFixture()
    const { call } = await ipcOver(new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() }))
    const window = fakeSender(7)
    expect((await call('claudeHome.sessions', { projectRoot: DEMO }, window.sender)).ok).toBe(true)
    // A second request does not add a second watcher: one change, one message.
    expect((await call('claudeHome.sessions', { projectRoot: DEMO }, window.sender)).ok).toBe(true)

    const file = join(home, 'projects', '-Users-test-projects-demo', `${S1}.jsonl`)
    await appendFile(file, `${assistantLine('seen by the window', 'ipc-1')}\n`)
    // FSEvents may also replay the fixture copy made just before the watch (a `sessions: true`
    // change); the test looks for the append, not for an exact list.
    const mentionsS1 = (entry: { payload: unknown }) => (entry.payload as { transcripts: string[] }).transcripts.includes(S1)
    await vi.waitFor(() => expect(window.sent.filter(mentionsS1)).toHaveLength(1), { timeout: 3000, interval: 20 })
    expect(window.sent.find(mentionsS1)).toMatchObject({ channel: 'worfy:claudeHome.changed', payload: { projectRoot: DEMO, transcripts: [S1] } })

    window.destroy()
    await new Promise((done) => setTimeout(done, 50))
    const sentBefore = window.sent.length
    await appendFile(file, `${assistantLine('not seen', 'ipc-2')}\n`)
    await new Promise((done) => setTimeout(done, 600))
    expect(window.sent).toHaveLength(sentBefore)
  })

  it('stops claudeHome.changed for a Project on claudeHome.close and closes its watcher', async () => {
    const home = await copyOfFixture()
    const { call, subscriptions } = await ipcOver(new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() }))
    const window = fakeSender(8)
    expect((await call('claudeHome.sessions', { projectRoot: DEMO }, window.sender)).ok).toBe(true)
    expect((await call('claudeHome.sessions', { projectRoot: '/Users/test/проект' }, window.sender)).ok).toBe(true)
    expect(subscriptions.size).toBe(2)

    expect(await call('claudeHome.close', { projectRoot: DEMO, extra: true }, window.sender)).toStrictEqual({ ok: true, value: { closed: true } })
    expect(subscriptions.size).toBe(1)
    // What the watchers sent before the close (FSEvents may replay the fixture copy) is not checked.
    window.sent.length = 0
    // Closing again, or closing for another window, closes nothing.
    expect(await call('claudeHome.close', { projectRoot: DEMO }, window.sender)).toStrictEqual({ ok: true, value: { closed: false } })
    expect(await call('claudeHome.close', { projectRoot: '/Users/test/проект' }, fakeSender(9).sender)).toStrictEqual({ ok: true, value: { closed: false } })
    expect(subscriptions.size).toBe(1)

    await appendFile(join(home, 'projects', '-Users-test-projects-demo', `${S1}.jsonl`), `${assistantLine('after close', 'c-1')}\n`)
    await appendFile(join(home, 'projects', '-Users-test-------', `${S6}.jsonl`), `${assistantLine('still watched', 'c-2')}\n`)
    const payloads = () => window.sent.map((entry) => entry.payload as { projectRoot: string; transcripts: string[] })
    await vi.waitFor(() => expect(payloads().some((payload) => payload.transcripts.includes(S6))).toBe(true), { timeout: 3000, interval: 20 })
    await new Promise((done) => setTimeout(done, 400))
    expect(payloads().every((payload) => payload.projectRoot === '/Users/test/проект')).toBe(true)
  })

  it('starts no watcher for a window that is already gone', async () => {
    const { call, subscriptions } = await ipcOver(new ClaudeHomeRegistry({ home: await copyOfFixture(), listWorktrees: noWorktrees, isAlive: alive() }))
    const window = fakeSender(10)
    window.destroy()
    expect((await call('claudeHome.sessions', { projectRoot: DEMO }, window.sender)).ok).toBe(true)
    expect(subscriptions.size).toBe(0)
  })

  it('watches before it reads, so a change made during the read is still sent', async () => {
    const home = await copyOfFixture()
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const file = join(home, 'projects', '-Users-test-projects-demo', `${S1}.jsonl`)
    const read = registry.sessions.bind(registry)
    vi.spyOn(registry, 'sessions').mockImplementation(async (root) => {
      await appendFile(file, `${assistantLine('written during the read', 'r-1')}\n`)
      return read(root)
    })
    const { call } = await ipcOver(registry)
    const window = fakeSender(11)
    expect((await call('claudeHome.sessions', { projectRoot: DEMO }, window.sender)).ok).toBe(true)
    // `sessions` may be true as well when FSEvents replays the fixture copy; the append is what counts.
    await vi.waitFor(() => expect(window.sent).toContainEqual({ channel: 'worfy:claudeHome.changed', payload: expect.objectContaining({ projectRoot: DEMO, transcripts: [S1] }) }), {
      timeout: 3000,
      interval: 20,
    })
  })
})
