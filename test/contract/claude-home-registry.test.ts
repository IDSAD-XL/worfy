import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ClaudeHomeRegistry,
  gitWorktrees,
  isInsidePath,
  processAlive,
  projectDirName,
  type ClaudeHomeChange,
  type RegistryRoot,
} from '../../src/main/claude-home/registry'
import { readNewLines } from '../../src/main/claude-home/tail'
import { ClaudeHomeSubscriptions, claudeHomeHandlers, type LiveSessionsListener, type Subscriber } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent } from '../../src/shared/agent/events'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { parseTranscriptLines } from '../../src/shared/transcript/parse'
import { APP_URL, INDEX_HTML } from '../app-url'
import { copyClaudeHome, projectDir, windowsProcStart } from './claude-home-fixture'

// The Claude home of ticket 09 (test/fixtures/claude-home/README.md). Tests never touch it. FIXTURE
// is a copy in a temporary directory that the tests which only read share; a test that writes
// makes its own (copyOfFixture). The folders under projects/ of a copy have the names the registry
// looks for on this system (claude-home-fixture.ts), so a test names one with projectDir().
let FIXTURE: string
let fixtureDir: string
const DEMO = '/Users/test/projects/demo'
const CYRILLIC = '/Users/test/проект'
const WORKTREE_07 = '/Users/test/projects/demo/.claude/worktrees/07'
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const S4 = '44444444-4444-4444-8444-444444444444'
const S5 = '55555555-5555-4555-8555-555555555555'
const S6 = '66666666-6666-4666-8666-666666666666'

const temps: string[] = []
const closers: (() => Promise<void>)[] = []

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'worfy-claude-home-'))
  FIXTURE = await copyClaudeHome(join(fixtureDir, 'claude'))
})

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

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
  return copyClaudeHome(join(await tempDir(), 'claude'))
}

const alive =
  (...pids: number[]) =>
  async (pid: number): Promise<boolean> =>
    pids.includes(pid)

const noWorktrees = async (): Promise<string[]> => []

/**
 * The start of a process, the way Claude Code records it as procStart: `ps -o lstart=`; on Windows
 * the FILETIME of the start, asked by the test's own command (claude-home-fixture.ts).
 */
const lstart = async (pid: number): Promise<string> => {
  if (process.platform === 'win32') return windowsProcStart(pid)
  return new Promise((done, fail) => {
    const ps = spawn('ps', ['-p', String(pid), '-o', 'lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } })
    let out = ''
    ps.stdout.on('data', (data: Buffer) => (out += data.toString()))
    ps.on('error', fail)
    ps.on('close', () => done(out.trim()))
  })
}

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

  // As Claude Code 2.1.233 named them on Windows (evidence of worfy-windows ticket 01, section 12).
  it.each([
    ['C:\\a\\b', 'C--a-b'],
    ['C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\with space', 'C--Users-Alexey-AppData-Local-Temp-worfy-01-with-space'],
    ['C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\кириллица', 'C--Users-Alexey-AppData-Local-Temp-worfy-01----------'],
  ])('Windows: %s → %s', (cwd, dir) => {
    expect(projectDirName(cwd)).toBe(dir)
  })
})

describe('a folder inside a Project (worfy-windows ticket 08)', () => {
  it('on Windows takes `\\` and `/` and ignores case', () => {
    expect(isInsidePath('C:\\p\\worfy', 'C:\\p\\worfy', 'win32')).toBe(true)
    expect(isInsidePath('C:\\p\\worfy\\src\\main', 'C:\\p\\worfy', 'win32')).toBe(true)
    expect(isInsidePath('c:/P/Worfy/src', 'C:\\p\\worfy', 'win32')).toBe(true)
    expect(isInsidePath('C:\\p\\worfy\\.claude\\worktrees\\05', 'C:\\p\\worfy\\', 'win32')).toBe(true)
    expect(isInsidePath('C:\\p\\worfy-other', 'C:\\p\\worfy', 'win32')).toBe(false)
    expect(isInsidePath('D:\\p\\worfy', 'C:\\p\\worfy', 'win32')).toBe(false)
    expect(isInsidePath('C:\\p\\worfy\\..\\x', 'C:\\p\\worfy', 'win32')).toBe(false)
    expect(isInsidePath('C:\\anything', 'C:\\', 'win32')).toBe(true)
  })

  it('on macOS and Linux is as before: `/` only, case counts', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(isInsidePath('/p/worfy/src', '/p/worfy', platform)).toBe(true)
      expect(isInsidePath('/p/worfy', '/p/worfy/', platform)).toBe(true)
      expect(isInsidePath('/p/Worfy/src', '/p/worfy', platform)).toBe(false)
      expect(isInsidePath('/p/worfy-other', '/p/worfy', platform)).toBe(false)
      expect(isInsidePath('/anything', '/', platform)).toBe(true)
    }
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
    await mkdir(join(home, 'projects', projectDir(elsewhere)))
    await writeFile(join(home, 'projects', projectDir(elsewhere), 'abc-6.jsonl'), `${JSON.stringify({ type: 'user', cwd: elsewhere, message: { content: 'Elsewhere prompt' } })}\n`)
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
      await mkdir(join(home, 'projects', projectDir(cwd)), { recursive: true })
      await writeFile(join(home, 'projects', projectDir(cwd), `${sessionId}.jsonl`), `${userLine(`Prompt in ${cwd}`, cwd, `${sessionId}-u`)}\n`)
    }
    await writeFile(join(home, 'sessions', '41011.json'), JSON.stringify({ pid: 41011, sessionId: 'sub-live', cwd: web, status: 'busy' }))
    await write(web, 'sub-live')
    await write(web, 'sub-done')
    await write(`${DEMO}/web`, 'sub-web')
    await write(demoWeb, 'demo-web-1')
    expect(projectDir(`${DEMO}/web`)).toBe(projectDir(demoWeb))

    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive(41011) })
    const { live, history } = await registry.sessions(DEMO)
    expect(live).toStrictEqual([{ pid: 41011, sessionId: 'sub-live', cwd: web, status: 'busy' }])
    const byId = new Map(history.map((entry) => [entry.sessionId, entry]))
    expect(byId.get('sub-live')).toMatchObject({ cwd: web, live: true, title: `Prompt in ${web}` })
    expect(byId.get('sub-done')).toMatchObject({ cwd: web, live: false })
    expect(byId.get('sub-web')).toMatchObject({ cwd: `${DEMO}/web` })
    expect(byId.has('demo-web-1')).toBe(false)
    expect(await registry.transcriptPath(DEMO, 'sub-live')).toBe(join(home, 'projects', projectDir(web), 'sub-live.jsonl'))
    expect(await registry.transcriptPath(DEMO, 'sub-web')).toBe(join(home, 'projects', projectDir(demoWeb), 'sub-web.jsonl'))
    expect(await registry.transcriptPath(DEMO, 'demo-web-1')).toBeNull()
    // The look-alike Project still finds its own Session.
    expect(await registry.transcriptPath(demoWeb, 'demo-web-1')).toBe(join(home, 'projects', projectDir(demoWeb), 'demo-web-1.jsonl'))
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
    // Where each was started, for the history (ticket 18): the first record that names it.
    expect([S1, S2, S4, S5].map((id) => byId.get(id)?.entrypoint)).toEqual(['claude-desktop', 'cli', 'cli', 'claude-desktop'])
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
    const file = join(home, 'projects', projectDir(DEMO), `${S2}.jsonl`)
    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => !line.includes('"custom-title"'))
    await writeFile(file, lines.join('\n'))
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    expect((await registry.sessions(DEMO)).history.find((entry) => entry.sessionId === S2)?.title).toBe('/demo-skill')
  })

  it('skips text the harness injected (isMeta) and takes the first prompt the user typed as the title', async () => {
    const home = await copyOfFixture()
    const file = join(home, 'projects', projectDir(DEMO), 'meta-1.jsonl')
    const lines = [
      JSON.stringify({ type: 'user', uuid: 'meta', isMeta: true, timestamp: '2026-06-01T00:00:00.000Z', cwd: DEMO, message: { content: 'Base directory for this skill: injected text' } }),
      JSON.stringify({ type: 'user', uuid: 'meta-block', isMeta: true, timestamp: '2026-06-01T00:00:01.000Z', cwd: DEMO, message: { content: [{ type: 'text', text: 'Injected block text' }] } }),
      JSON.stringify({ type: 'user', uuid: 'real', timestamp: '2026-06-01T00:00:02.000Z', cwd: DEMO, message: { content: 'The prompt the user typed' } }),
    ]
    await writeFile(file, `${lines.join('\n')}\n`)
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    expect((await registry.sessions(DEMO)).history.find((entry) => entry.sessionId === 'meta-1')?.title).toBe('The prompt the user typed')
  })

  it('names a Session by the first prompt with text: a message of attachments only names none', async () => {
    const home = await copyOfFixture()
    const dir = join(home, 'projects', projectDir(DEMO))
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('png bytes').toString('base64') } }
    const user = (uuid: string, content: unknown, second: number) =>
      JSON.stringify({ type: 'user', uuid, timestamp: `2026-06-01T00:00:0${second}.000Z`, cwd: DEMO, message: { role: 'user', content } })
    await writeFile(
      join(dir, 'attach-1.jsonl'),
      `${[
        user('images', [image, { type: 'text', text: 'Attached images: shot.png' }], 0),
        user('files', 'Attached files: /Users/test/notes.txt', 1),
        user('typed', 'The prompt after the attachments', 2),
      ].join('\n')}\n`,
    )
    await writeFile(join(dir, 'attach-2.jsonl'), `${[user('only', [image], 0)].join('\n')}\n`)
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const history = (await registry.sessions(DEMO)).history
    expect(history.find((entry) => entry.sessionId === 'attach-1')?.title).toBe('The prompt after the attachments')
    // No title at all, so the sidebar and the Session Node fall back to «Session <id>».
    expect(history.find((entry) => entry.sessionId === 'attach-2')).toBeDefined()
    expect(history.find((entry) => entry.sessionId === 'attach-2')?.title).toBeUndefined()
  })

  it('reads only the head and the tail of a large transcript', async () => {
    const home = await copyOfFixture()
    const file = join(home, 'projects', projectDir(DEMO), 'big-1.jsonl')
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

  it('sees a new, an appended, a rewritten and a removed transcript in the next list, and reads an unchanged one only once', async () => {
    const home = await copyOfFixture()
    const dir = join(home, 'projects', projectDir(DEMO))
    const s5 = join(dir, `${S5}.jsonl`)
    const then = new Date('2026-06-01T00:00:00.000Z')
    await utimes(s5, then, then)
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const titles = async () => new Map((await registry.sessions(DEMO)).history.map((entry) => [entry.sessionId, entry.title]))
    expect((await titles()).get(S5)).toBe('Synthetic wave run')

    // Other words of the same length, under the same size and modification time: not read again.
    const text = await readFile(s5, 'utf8')
    await writeFile(s5, text.replace('Synthetic wave run', 'Synthetic wove run'))
    await utimes(s5, then, then)
    await appendFile(join(dir, `${S1}.jsonl`), `${JSON.stringify({ type: 'custom-title', customTitle: 'Renamed after the first list' })}\n`)
    await writeFile(join(dir, 'new-1.jsonl'), `${userLine('A Session started after the first list', DEMO, 'n1')}\n`)
    await rm(join(dir, `${S2}.jsonl`))
    const second = await titles()
    expect(second.get(S5)).toBe('Synthetic wave run')
    expect(second.get(S1)).toBe('Renamed after the first list')
    expect(second.get('new-1')).toBe('A Session started after the first list')
    expect(second.has(S2)).toBe(false)

    // Only the modification time moved: read again.
    const later = new Date('2026-06-02T00:00:00.000Z')
    await utimes(s5, later, later)
    const third = (await registry.sessions(DEMO)).history.find((entry) => entry.sessionId === S5)
    expect(third).toMatchObject({ title: 'Synthetic wove run', modifiedAt: later.getTime() })
  })

  it('builds the history index of an Auction-sized Project in at most one second', async () => {
    // Auction (ticket 09, "Volumes"): 88 Sessions in the root and the rest in worktrees. Files are
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
    await write(projectDir(root), 88, 'root-')
    for (let w = 0; w < 13; w += 1) await write(`${projectDir(root)}--claude-worktrees-${w}`, 3, `wt${w}-`)
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
    expect(await registry.transcriptPath(DEMO, S4)).toBe(join(FIXTURE, 'projects', projectDir(WORKTREE_07), `${S4}.jsonl`))
    expect(await registry.transcriptPath(DEMO, S1)).toBe(join(FIXTURE, 'projects', projectDir(DEMO), `${S1}.jsonl`))
    // Another Project's Session, a missing one and a path in disguise are not found.
    expect(await registry.transcriptPath(DEMO, S6)).toBeNull()
    expect(await registry.transcriptPath(DEMO, 'no-such-session')).toBeNull()
    expect(await registry.transcriptPath(DEMO, `../${projectDir(CYRILLIC)}/${S6}`)).toBeNull()
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

    await appendFile(join(home, 'projects', projectDir(CYRILLIC), `${S6}.jsonl`), `${assistantLine('other project', 'o-1')}\n`)
    const worktreeDir = join(home, 'projects', projectDir(`${DEMO}/.claude/worktrees/99`))
    await mkdir(worktreeDir)
    // Its first record names the cwd, as Claude Code writes it: no folder is the Project's by its name alone (worfy-link ticket 32).
    await writeFile(join(worktreeDir, 'new-session.jsonl'), `${userLine('in a new worktree', `${DEMO}/.claude/worktrees/99`, 'w-1')}\n`)
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
    const dir = join(home, 'projects', projectDir(`${DEMO}/web`))
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
    const dir = join(home, 'projects', projectDir(`${DEMO}/web`))
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
    // A transcript of a subfolder whose cwd was never known was never listed: its removal is not reported (worfy-link ticket 32).
    await log.waitFor((change) => change.transcripts.includes('ours'))
    await new Promise((done) => setTimeout(done, 300))
    expect(log.changes.some((entry) => entry.change.transcripts.includes('foreign'))).toBe(false)
    expect(log.changes.some((entry) => entry.change.transcripts.includes('unknown'))).toBe(false)
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

async function ipcOver(registry: ClaudeHomeRegistry, listeners?: ReadonlySet<LiveSessionsListener>) {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const subscriptions = new ClaudeHomeSubscriptions(registry, listeners)
  closers.push(() => subscriptions.closeAll())
  await registerIpc(ipc, { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  const call = async (channel: string, input: unknown, sender?: Subscriber): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  return { handlers, call, subscriptions }
}

describe('claudeHome IPC channels', () => {
  it('registers the request channels of the domain', async () => {
    const { handlers } = await ipcOver(new ClaudeHomeRegistry({ home: FIXTURE, listWorktrees: noWorktrees, isAlive: alive() }))
    expect([...handlers.keys()].sort()).toEqual([
      'worfy:claudeHome.close',
      'worfy:claudeHome.live',
      'worfy:claudeHome.search',
      'worfy:claudeHome.sessions',
      'worfy:claudeHome.subagentTranscript',
      'worfy:claudeHome.subagents',
      'worfy:claudeHome.transcript',
      'worfy:claudeHome.transcriptFind',
    ])
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
    ['claudeHome.search', { projectRoot: DEMO, query: 'ab' }],
    ['claudeHome.search', { projectRoot: 'relative/path', query: 'synthetic' }],
    ['claudeHome.search', { projectRoot: DEMO, query: 'x'.repeat(201) }],
    ['claudeHome.transcriptFind', { projectRoot: DEMO, sessionId: S1, query: ' a ', before: 10 }],
    ['claudeHome.transcriptFind', { projectRoot: DEMO, sessionId: S1, query: 'x'.repeat(201), before: 10 }],
    ['claudeHome.transcriptFind', { projectRoot: DEMO, sessionId: S1, query: 'zebra', before: -1 }],
    ['claudeHome.transcriptFind', { projectRoot: DEMO, sessionId: S1, query: 'zebra' }],
    ['claudeHome.transcriptFind', { projectRoot: DEMO, sessionId: '../../etc/passwd', query: 'zebra', before: 10 }],
    ['claudeHome.transcriptFind', { projectRoot: DEMO, sessionId: S1, agentId: '../a', query: 'zebra', before: 10 }],
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
    // With the time of its record, so the row shows when it was written (ticket 14).
    expect(events.at(-1)).toStrictEqual({ type: 'text', text: 'after the subagent', messageId: 'own-1', parentToolUseId: null, synthetic: false, at: Date.parse('2026-05-05T10:07:00.000Z') })
  })

  it('names an image of a user message by the sha256 of its bytes, the copy main keeps, and sends no base64 (worfy-ui ticket 28)', async () => {
    const home = await copyOfFixture()
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: noWorktrees, isAlive: alive() })
    const file = (await registry.transcriptPath(DEMO, S5)) ?? ''
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 9)])
    const content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } },
      { type: 'text', text: 'see\n\nAttached images: shot.png' },
    ]
    await appendFile(file, `${JSON.stringify({ type: 'user', uuid: 'img-1', isSidechain: false, message: { role: 'user', content } })}\n`)
    const { call } = await ipcOver(registry)
    const result = await call('claudeHome.transcript', { projectRoot: DEMO, sessionId: S5 })
    if (!result.ok) throw new Error(result.error)
    const { events } = result.value as { events: AgentEvent[] }
    expect(events.at(-1)).toStrictEqual({
      type: 'notice',
      kind: 'user',
      text: 'see',
      attachments: [{ kind: 'image', name: 'shot.png', mediaType: 'image/png', ref: createHash('sha256').update(bytes).digest('hex') }],
    })
    expect(JSON.stringify(result)).not.toContain(bytes.toString('base64'))
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

    const file = join(home, 'projects', projectDir(DEMO), `${S1}.jsonl`)
    await appendFile(file, `${assistantLine('seen by the window', 'ipc-1')}\n`)
    // FSEvents may also replay the fixture copy made just before the watch (a `sessions: true`
    // change); the test looks for the append, not for an exact list.
    const mentionsS1 = (entry: { payload: unknown }) => (entry.payload as { transcripts: string[] }).transcripts.includes(S1)
    await vi.waitFor(() => expect(window.sent.filter(mentionsS1)).toHaveLength(1), { timeout: 3000, interval: 20 })
    // The root as the window sent it (ticket 57): on Windows resolve(DEMO) would be C:\Users\….
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

    await appendFile(join(home, 'projects', projectDir(DEMO), `${S1}.jsonl`), `${assistantLine('after close', 'c-1')}\n`)
    await appendFile(join(home, 'projects', projectDir(CYRILLIC), `${S6}.jsonl`), `${assistantLine('still watched', 'c-2')}\n`)
    const payloads = () => window.sent.map((entry) => entry.payload as { projectRoot: string; transcripts: string[] })
    await vi.waitFor(() => expect(payloads().some((payload) => payload.transcripts.includes(S6))).toBe(true), { timeout: 3000, interval: 20 })
    await new Promise((done) => setTimeout(done, 400))
    expect(payloads().every((payload) => payload.projectRoot === CYRILLIC)).toBe(true)
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
    const file = join(home, 'projects', projectDir(DEMO), `${S1}.jsonl`)
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

// worfy-windows ticket 57: the window looks the root of claudeHome.changed up by the string it
// subscribed with. On Windows that is git's `C:/…` from the Project list, while path.resolve gives
// `C:\…`; an event in main's spelling was dropped by all three readers in the window.
describe('claudeHome.changed carries the root as the window sent it', () => {
  /** A registry whose watchers the test fires by hand; it records the roots it was asked to watch. */
  function handRegistry() {
    const watchers: { root: RegistryRoot; onChange: (change: ClaudeHomeChange) => void; closed: boolean }[] = []
    const registry = {
      watch: async (root: RegistryRoot, onChange: (change: ClaudeHomeChange) => void) => {
        const watcher = { root, onChange, closed: false }
        watchers.push(watcher)
        return { ready: Promise.resolve(), close: async () => void (watcher.closed = true) }
      },
      sessions: async () => ({ live: [], history: [] }),
      live: async () => [],
    } as unknown as ClaudeHomeRegistry
    const fire = (change: ClaudeHomeChange) => {
      for (const watcher of watchers) if (!watcher.closed) watcher.onChange(change)
    }
    return { registry, watchers, fire }
  }
  const changes = (sent: readonly { channel: string; payload: unknown }[]) => sent.filter((entry) => entry.channel === 'worfy:claudeHome.changed').map((entry) => entry.payload)

  it('a window that asked with C:/p gets C:/p back; the registry still watches the resolved root', async () => {
    const { registry, watchers, fire } = handRegistry()
    const { call } = await ipcOver(registry)
    const window = fakeSender(21)
    expect((await call('claudeHome.sessions', { projectRoot: 'C:/p' }, window.sender)).ok).toBe(true)
    expect(watchers.map((watcher) => watcher.root)).toEqual([{ path: resolve('C:/p'), local: true }])

    fire({ sessions: false, transcripts: [S1] })
    expect(changes(window.sent)).toEqual([{ projectRoot: 'C:/p', sessions: false, transcripts: [S1] }])
  })

  it('spellings of one root from one window: each gets its events in its own spelling and closes on its own; the live Sessions go out under the resolved root', async () => {
    const { registry, fire } = handRegistry()
    const reported: string[] = []
    const { call, subscriptions } = await ipcOver(registry, new Set<LiveSessionsListener>([(root) => void reported.push(root)]))
    const window = fakeSender(22)
    // C:/p and C:/p/ resolve to one root on any system; C:\p joins them on Windows.
    for (const projectRoot of ['C:/p', 'C:/p/', 'C:\\p']) expect((await call('claudeHome.sessions', { projectRoot }, window.sender)).ok).toBe(true)
    // The same spelling again adds no watcher.
    expect((await call('claudeHome.sessions', { projectRoot: 'C:/p' }, window.sender)).ok).toBe(true)
    expect(subscriptions.size).toBe(3)

    fire({ sessions: true, transcripts: [] })
    expect(changes(window.sent).map((payload) => (payload as { projectRoot: string }).projectRoot).sort()).toEqual(['C:/p', 'C:/p/', 'C:\\p'])
    // Three reports when the watchers became ready and three for the change, each under the
    // resolved root: one Project, one key for the notifications (src/main/notify.ts).
    await vi.waitFor(() => expect(reported).toHaveLength(6))
    expect(new Set(reported)).toEqual(new Set([resolve('C:/p'), resolve('C:\\p')]))

    expect(await call('claudeHome.close', { projectRoot: 'C:/p' }, window.sender)).toStrictEqual({ ok: true, value: { closed: true } })
    expect(subscriptions.size).toBe(2)
    window.sent.length = 0
    fire({ sessions: false, transcripts: [S1] })
    expect(changes(window.sent).map((payload) => (payload as { projectRoot: string }).projectRoot).sort()).toEqual(['C:/p/', 'C:\\p'])
  })

  it('a Linked machine\'s call: git runs at the real path its check answered, the Claude home folders and the live Sessions go by the spelling it sent', async () => {
    const dir = await realpath(await tempDir())
    const project = join(dir, 'project')
    const alias = join(dir, 'alias')
    await mkdir(project)
    await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir')
    // Claude Code named the folder after the cwd it started in: the alias, as the Project list has it.
    const home = join(dir, 'claude')
    await mkdir(join(home, 'projects', projectDirName(alias)), { recursive: true })
    // Its records name that cwd: a transcript of the folder named like the root is kept by its cwd (worfy-link ticket 32).
    await writeFile(join(home, 'projects', projectDirName(alias), `${S1}.jsonl`), `${userLine('a prompt in the alias', alias, `${S1}-u`)}\n`)
    const gitAt: string[] = []
    const registry = new ClaudeHomeRegistry({
      home,
      listWorktrees: async (root) => {
        gitAt.push(root)
        return []
      },
      isAlive: alive(),
    })
    const fires: ((change: ClaudeHomeChange) => void)[] = []
    vi.spyOn(registry, 'watch').mockImplementation(async (_root, onChange) => {
      fires.push(onChange)
      return { ready: Promise.resolve(), close: async () => undefined }
    })
    const reported: string[] = []
    const subscriptions = new ClaudeHomeSubscriptions(registry, new Set<LiveSessionsListener>([(root) => void reported.push(root)]))
    closers.push(() => subscriptions.closeAll())
    const handlers = new Map<string, Listener>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    await registerIpc(ipc, { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, undefined, () => [{ path: project }]) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
    // A client of a link connection has a string id (src/main/link/caller.ts).
    const sent: { channel: string; payload: unknown }[] = []
    const linked: Subscriber = { id: 'link:machine-b/1', send: (channel, payload) => void sent.push({ channel, payload }), isDestroyed: () => false, once: () => undefined }
    const event = { senderFrame: { url: APP_URL }, sender: linked } as unknown as IpcMainInvokeEvent
    const result = (await handlers.get(`${IPC_CHANNEL_PREFIX}claudeHome.sessions`)?.(event, { projectRoot: alias })) as IpcResult<{ history: { sessionId: string }[] }>
    if (!result.ok) throw new Error(result.error)
    expect(result.value.history.map((session) => session.sessionId)).toEqual([S1])
    // git only at the checked real path: a link swapped after the check does not lead it elsewhere.
    expect(new Set(gitAt)).toEqual(new Set([project]))
    await vi.waitFor(() => expect(reported).toEqual([alias]))

    for (const fire of fires) fire({ sessions: false, transcripts: [S1] })
    expect(changes(sent)).toEqual([{ projectRoot: alias, sessions: false, transcripts: [S1] }])
  })
})
