// The reading git runner of the Changes screen (src/main/changes/git.ts; worfy-changes-view ticket 02, ADR-0110):
// which commands it refuses, the command line and the environment every run gets, and the runner's handling of a
// process — a refused command starts none, the output limit stops git and the answer has no exit code then, the
// time limit stops it too. The process is a stand-in handed to the runner in place of child_process.spawn, so the
// tests see what would start and run the same on every OS.
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { changesGitRunner, LIST_MAX_BYTES, LOCATION_VARS, readArgs, readEnv, refusal } from '../../src/main/changes/git'

const CONFIG = ['-c', 'core.quotePath=false', '-c', 'diff.autoRefreshIndex=false', '-c', 'core.fsmonitor=false']
const PATCH = ['--no-ext-diff', '--no-textconv', '--no-color']

describe('the commands the runner refuses', () => {
  it('refuses a command outside the list: the ones that write, fetch or stash', () => {
    for (const command of ['add', 'fetch', 'stash', 'update-index', 'commit', 'checkout', 'reset', 'gc', 'maintenance', 'config', 'notes']) {
      expect(refusal([command]), command).toMatch(/not a reading command/u)
    }
    expect(refusal([])).toMatch(/not a reading command/u)
  })

  it('runs worktree, ls-files and hash-object only in the one form the screen uses', () => {
    expect(refusal(['worktree', 'list', '--porcelain'])).toBeNull()
    for (const args of [['worktree', 'add', 'x'], ['worktree', 'remove', 'x'], ['worktree', 'prune'], ['worktree', 'list'], ['worktree', 'list', '--porcelain', 'extra'], ['worktree', 'lock', 'x']]) {
      expect(refusal(args), args.join(' ')).toMatch(/only as git worktree list --porcelain/u)
    }
    expect(refusal(['ls-files', '--others', '--exclude-standard', '-z'])).toBeNull()
    for (const args of [['ls-files'], ['ls-files', '--others', '--exclude-standard'], ['ls-files', '--others', '--exclude-standard', '-z', '--cached'], ['ls-files', '-z', '--others', '--exclude-standard']]) {
      expect(refusal(args), args.join(' ')).toMatch(/only as git ls-files/u)
    }
    expect(refusal(['hash-object', '--no-filters', '--stdin-paths'])).toBeNull()
    for (const args of [['hash-object', '-w', 'a.txt'], ['hash-object', '--write', 'a.txt'], ['hash-object', '-tw', 'blob', 'a.txt'], ['hash-object', '--stdin-paths'], ['hash-object', '--no-filters', '--stdin-paths', '-w'], ['hash-object', 'a.txt']]) {
      expect(refusal(args), args.join(' ')).toMatch(/never -w/u)
    }
  })

  it('runs cat-file only as -e or -s of one object', () => {
    expect(refusal(['cat-file', '-e', 'HEAD^{commit}'])).toBeNull()
    expect(refusal(['cat-file', '-s', 'abc123'])).toBeNull()
    for (const args of [['cat-file', '-p', 'HEAD'], ['cat-file', '--batch'], ['cat-file', '-e'], ['cat-file', '-e', 'a', 'b'], ['cat-file', '-e', '--batch-all-objects'], ['cat-file', 'blob', 'abc']]) {
      expect(refusal(args), args.join(' ')).toMatch(/cat-file is run only/u)
    }
  })

  it('refuses --output and -o before --, never a path after it', () => {
    expect(refusal(['diff', '--output=x.patch'])).toMatch(/--output/u)
    expect(refusal(['log', '--output', 'x'])).toMatch(/--output/u)
    expect(refusal(['show', '-o', 'x'])).toMatch(/--output/u)
    expect(refusal(['diff', 'HEAD', '--', '--output=x', '-o'])).toBeNull()
    expect(refusal(['merge-base', 'a', 'b'])).toBeNull()
  })
})

describe('the command line and the environment of every run', () => {
  it('puts the reading settings first and the patch flags right after a patch command', () => {
    expect(readArgs(['diff', 'HEAD', '--', 'a'])).toEqual([...CONFIG, 'diff', ...PATCH, 'HEAD', '--', 'a'])
    expect(readArgs(['log', '-z', 'a..b'])).toEqual([...CONFIG, 'log', ...PATCH, '-z', 'a..b'])
    expect(readArgs(['show', 'abc'])).toEqual([...CONFIG, 'show', ...PATCH, 'abc'])
    expect(readArgs(['for-each-ref', 'refs/heads'])).toEqual([...CONFIG, 'for-each-ref', 'refs/heads'])
    expect(readArgs(['cat-file', '-e', 'x'])).toEqual([...CONFIG, 'cat-file', '-e', 'x'])
  })

  it('drops the variables that point git elsewhere, whatever their case, and sets no locks, no prompt, literal paths', () => {
    const env = { PATH: '/bin', HOME: '/h', GIT_DIR: '/other/.git', git_index_file: '/tmp/i', Git_Work_Tree: '/w', GIT_CONFIG_PARAMETERS: "'core.pager=x'", GIT_OPTIONAL_LOCKS: '1', GIT_TERMINAL_PROMPT: '1' }
    expect(readEnv(env)).toEqual({ PATH: '/bin', HOME: '/h', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' })
    for (const name of LOCATION_VARS) expect(readEnv({ [name]: 'x', [name.toLowerCase()]: 'y' }), name).toEqual({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' })
    expect(LOCATION_VARS).toEqual(expect.arrayContaining(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CONFIG_PARAMETERS']))
  })
})

/** A stand-in for git's process: the test emits its output and its end. `killOnClose`: a kill ends it with no exit code. */
class FakeGit extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined })
  readonly written: string[] = []
  readonly stdin = Object.assign(new EventEmitter(), { end: (text: string) => void this.written.push(text) })
  kills = 0
  constructor(private readonly killOnClose: boolean) {
    super()
  }
  kill(): boolean {
    this.kills++
    if (this.killOnClose) setImmediate(() => this.emit('close', null))
    return true
  }
}

function fakeSpawn(killOnClose = false) {
  const started: { command: string; args: string[]; options: SpawnOptions; child: FakeGit }[] = []
  const start = (command: string, args: string[], options: SpawnOptions): ChildProcess => {
    const child = new FakeGit(killOnClose)
    started.push({ command, args, options, child })
    return child as unknown as ChildProcess
  }
  return { started, start }
}

describe('the runner over a process', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('starts no process for a refused command', async () => {
    const { started, start } = fakeSpawn()
    const git = changesGitRunner('git', start)
    for (const args of [['stash'], ['worktree', 'add', 'x'], ['hash-object', '-w', 'a'], ['diff', '--output=x']]) {
      expect(await git('/repo', args), args.join(' ')).toMatchObject({ code: null, stdout: '', bytes: 0, truncated: false, stderr: expect.any(String) as string })
    }
    expect(started).toHaveLength(0)
  })

  it('starts git in cwd with the reading command line and environment, without GIT_DIR of main', async () => {
    vi.stubEnv('GIT_DIR', '/elsewhere/.git')
    vi.stubEnv('GIT_INDEX_FILE', '/elsewhere/index')
    const { started, start } = fakeSpawn()
    const run = changesGitRunner('/opt/git', start)('/repo', ['diff', 'HEAD', '--', 'a'])
    expect(started).toHaveLength(1)
    const [{ command, args, options, child }] = started as [(typeof started)[number]]
    expect([command, args, options.cwd, options.stdio]).toEqual(['/opt/git', readArgs(['diff', 'HEAD', '--', 'a']), '/repo', ['ignore', 'pipe', 'pipe']])
    expect(options.env).toMatchObject({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' })
    expect(options.env).not.toHaveProperty('GIT_DIR')
    expect(options.env).not.toHaveProperty('GIT_INDEX_FILE')
    child.stdout.emit('data', Buffer.from('out'))
    child.stderr.emit('data', 'warn')
    child.emit('close', 0)
    expect(await run).toEqual({ code: 0, stdout: 'out', bytes: 3, truncated: false, stderr: 'warn' })
  })

  it('stops git past maxBytes: what came before, truncated, and no exit code even when git ended with 0', async () => {
    const { started, start } = fakeSpawn()
    const run = changesGitRunner('git', start)('/repo', ['show', 'abc'], { maxBytes: 5 })
    const [{ child }] = started as [(typeof started)[number]]
    child.stdout.emit('data', Buffer.from('abc'))
    child.stdout.emit('data', Buffer.from('defgh'))
    child.stdout.emit('data', Buffer.from('more'))
    // git had already printed it all and ends with 0 before the kill reaches it.
    child.emit('close', 0)
    expect(await run).toEqual({ code: null, stdout: 'abcde', bytes: 5, truncated: true, stderr: '' })
    expect(child.kills).toBe(1)
  })

  it('reads up to LIST_MAX_BYTES when no maxBytes is given', async () => {
    const { started, start } = fakeSpawn()
    const run = changesGitRunner('git', start)('/repo', ['diff', 'HEAD'])
    const [{ child }] = started as [(typeof started)[number]]
    // Past the 8 MB buffer of the stages' runner (src/main/workflow/stages.ts) and FOLD_BYTES, within LIST_MAX_BYTES.
    const big = Buffer.alloc(9 * 1024 * 1024, 0x61)
    expect(big.length).toBeLessThan(LIST_MAX_BYTES)
    child.stdout.emit('data', big)
    child.emit('close', 0)
    const read = await run
    expect([read.code, read.bytes, read.truncated, child.kills]).toEqual([0, big.length, false, 0])
  })

  it('stops git that runs past timeoutMs and says so', async () => {
    const { started, start } = fakeSpawn(true)
    // unscaled: a bound the test expects to run out
    const read = await changesGitRunner('git', start)('/repo', ['log'], { timeoutMs: 5 })
    expect(read).toMatchObject({ code: null, truncated: false })
    expect(read.stderr).toMatch(/did not finish in 5 ms/u)
    expect(started[0]!.child.kills).toBe(1)
  })

  it('writes the input to stdin, and a failure to start is an answer, not a throw', async () => {
    const { started, start } = fakeSpawn()
    const git = changesGitRunner('git', start)
    const run = git('/repo', ['check-attr', '-z', '--stdin', 'linguist-generated'], { input: 'a\0' })
    const [{ options, child }] = started as [(typeof started)[number]]
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(child.written).toEqual(['a\0'])
    child.emit('error', new Error('spawn git ENOENT'))
    expect(await run).toMatchObject({ code: null, stderr: 'spawn git ENOENT' })
  })
})
