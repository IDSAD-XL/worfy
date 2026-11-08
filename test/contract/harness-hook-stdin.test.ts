// How the Harness hooks read their input, the hook JSON on stdin (the fix after PR #1464).
//
// Touching process.stdin (its isTTY, say) makes Node hold a pipe on descriptor 0 in non-blocking mode.
// A hook that then read the input with fs.readFileSync(0) failed with EAGAIN whenever the writer was late
// (a machine under load), and went on with an empty input: session-start, session-end (removed since, worfy-skills 02) and gh-token-env
// asked bin/profile about the hook's own folder instead of the session's. They now read stdin as a stream
// through hooks/hook-stdin.mjs, as stop.mjs does: a limited wait for the first byte, then to its end.
// inject-rules.mjs never touches process.stdin, so its synchronous read waits for the writer; a case here
// holds it to that.
//
// The late writer is made exact: a preload says on stderr when the hook first touches process.stdin or
// reads descriptor 0, and only then does the test write the input. So a synchronous read after a touch
// meets an empty pipe every time.
//
// The stop.mjs cases of the same reader (a late input, an open pipe that sends nothing, an input split
// in two, a terminal) are in harness-codex-hooks.test.ts.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const HOOKS = join(REPO, 'harness', 'hooks')
const RUN_MS = ms(60_000)
const WINDOWS = process.platform === 'win32'
const TOUCHED = 'stdin-touched-by-the-hook'
const READ_FD0 = 'fd0-read-by-the-hook'

let root: string

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(realpathSync(tmpdir()), 'worfy-hook-stdin-')))
})
afterAll(() => removeTestTree(root))
afterEach(() => vi.unstubAllEnvs())

/**
 * A folder for one case: the hook runs in `hookCwd`, the input names `session`; the stand-in of
 * bin/profile appends the folder it is asked about (`-C`) to `record` and answers "no project" (exit 3),
 * so every hook stops right after that call. `hang` makes it wait 10 s before it answers; `print` makes
 * it print that text (or what the function makes of the case folder) and exit 0 instead; `flood` makes
 * it print 4 MB, more than spawnSync keeps by default (maxBuffer, 1 MB), so the hook's call fails with
 * ENOBUFS on every system. `sessionName` names the session folder.
 */
function caseDir({ hang = false, print, flood = false, sessionName = 'session' }: { hang?: boolean; print?: string | ((dir: string) => string); flood?: boolean; sessionName?: string } = {}) {
  const dir = realpathSync.native(mkdtempSync(join(root, 'case-')))
  const hookCwd = join(dir, 'hook-cwd')
  const session = join(dir, sessionName)
  const printed = typeof print === 'function' ? print(dir) : print
  mkdirSync(hookCwd)
  mkdirSync(session)
  const record = join(dir, 'asked.txt')
  const profile = join(dir, 'profile.mjs')
  writeFileSync(
    profile,
    `import fs from 'node:fs'
fs.appendFileSync(${JSON.stringify(record)}, process.argv[process.argv.indexOf('-C') + 1] + '\\n')
${flood ? "process.stdout.write('x'.repeat(4 * 1024 * 1024))" : printed !== undefined ? `process.stdout.write(${JSON.stringify(printed)})` : hang ? 'setTimeout(() => process.exit(3), 10000)' : 'process.exit(3)'}
`,
  )
  // Says once on stderr which comes first: a touch of process.stdin or a synchronous read of descriptor 0.
  const preload = join(dir, 'stdin-watch.cjs')
  writeFileSync(
    preload,
    `const fs = require('node:fs')
let told = false
const say = (what) => { if (!told) { told = true; fs.writeSync(2, what + '\\n') } }
const own = Object.getOwnPropertyDescriptor(process, 'stdin')
Object.defineProperty(process, 'stdin', { configurable: true, enumerable: own.enumerable, get() {
  const stdin = own.get.call(process)
  say(${JSON.stringify(TOUCHED)})
  return stdin
} })
const read = fs.readFileSync
fs.readFileSync = function (file, ...rest) {
  if (file === 0) say(${JSON.stringify(READ_FD0)})
  return read.call(this, file, ...rest)
}
`,
  )
  const asked = () => (existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean) : [])
  return { dir, hookCwd, session, profile, preload, asked }
}

/**
 * The exit code of `child` once it closes. A child still running after half the test's limit is killed
 * there and gives 'killed': a hook that hangs fails its test without outliving it.
 */
function closeOf(child: ChildProcess): Promise<number | null | 'killed'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve('killed')
    }, RUN_MS / 2)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

type Case = ReturnType<typeof caseDir>

/** The environment of a hook run: the profile stand-in, an isolated Harness home and the env file of gh-token-env. */
const hookEnv = (c: Case, more: Record<string, string> = {}) => ({
  ...process.env,
  CLAUDE_PROFILE_BIN: c.profile,
  HARNESS_HOME: join(c.dir, 'harness-home'),
  CLAUDE_ENV_FILE: join(c.dir, 'env-file.sh'),
  ...more,
})

/**
 * Runs `hook` in `c.hookCwd` and writes `input` only once the preload says the hook has touched
 * process.stdin or reads descriptor 0. Returns the exit code, stdout, the rest of stderr and which came first.
 */
async function runLate(c: Case, hook: string, args: string[], input: string, more: Record<string, string> = {}) {
  const child = spawn(scriptNode(), [join(HOOKS, hook), ...args], {
    cwd: c.hookCwd,
    env: hookEnv(c, { NODE_OPTIONS: `--require ${JSON.stringify(c.preload)}`, ...more }),
    stdio: 'pipe',
  })
  let stdout = ''
  let stderr = ''
  let first = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
    if (!first) {
      const line = stderr.split('\n')[0] ?? ''
      if (line === TOUCHED || line === READ_FD0) {
        first = line
        child.stdin.end(input)
      }
    }
  })
  const code = await closeOf(child)
  return { code, stdout, stderr: stderr.replace(`${first}\n`, ''), first }
}

const sessionInput = (event: string, cwd: string, more: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: 'ses-1', transcript_path: '/tmp/ses-1.jsonl', cwd, hook_event_name: event, ...more })

describe('a hook input that arrives after the hook touched process.stdin', () => {
  for (const [hook, event] of [
    ['session-start.mjs', 'SessionStart'],
    ['gh-token-env.mjs', 'SessionStart'],
  ] as const) {
    it(`${hook} reads it: bin/profile is asked about the session's folder, not the hook's`, async () => {
      const c = caseDir()
      const run = await runLate(c, hook, [], sessionInput(event, c.session))
      expect(run.first, 'the hook touched process.stdin before its input came').toBe(TOUCHED)
      expect([run.code, run.stderr]).toEqual([0, ''])
      expect(c.asked()).toEqual([c.session])
    }, RUN_MS)
  }

  // A failure inside the hook after its input came is still one line on stderr and exit 0: a broken hook
  // must not break the session. session-start fails on a profile that prints no JSON,
  // gh-token-env on a profile call whose output overflows spawnSync's buffer (ENOBUFS). Not a gh it
  // cannot start: a folder in gh's place fails with EACCES on macOS and Linux, but on Windows the hook
  // took it for a missing gh, a note on stdout with stderr empty (CI run 42143406350).
  for (const [hook, event, answer, why] of [
    ['session-start.mjs', 'SessionStart', { print: 'not json' }, 'profile --json printed no JSON'],
    ['gh-token-env.mjs', 'SessionStart', { flood: true }, 'ENOBUFS'],
  ] as const) {
    it(`${hook} reports a failure after the input came as one line on stderr, exit 0`, async () => {
      const c = caseDir(answer)
      const run = await runLate(c, hook, [], sessionInput(event, c.session))
      expect(run.code).toBe(0)
      expect(run.stderr).toMatch(new RegExp(`^${hook.replace('.mjs', '')}: .*${why}.*\n$`))
      expect(c.asked()).toEqual([c.session])
    }, RUN_MS)
  }

  it('inject-rules.mjs reads descriptor 0 without touching process.stdin, so its synchronous read waits for the writer', async () => {
    const c = caseDir()
    const run = await runLate(c, 'inject-rules.mjs', ['common'], sessionInput('SubagentStart', c.session))
    expect(run.first).toBe(READ_FD0)
    expect([run.code, run.stderr]).toEqual([0, ''])
    expect(JSON.parse(run.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'SubagentStart' } })
  }, RUN_MS)
})

describe('an input pipe that stays open and sends nothing', () => {
  // The wait for the first byte is FIRST_BYTE_MS of hook-stdin.mjs; CLAUDE_HOOK_STDIN_WAIT_MS shortens it
  // here to 200 ms. The 5 s hooks must end well before their own wait would: the variable reached them.
  for (const [hook, ownWaitMs] of [
    ['session-start.mjs', 5000],
    ['gh-token-env.mjs', 5000],
  ] as const) {
    it(`${hook} takes it for no input once the wait for its first byte is over, and goes on from its own folder`, async () => {
      const c = caseDir()
      const started = Date.now()
      const child = spawn(scriptNode(), [join(HOOKS, hook)], { cwd: c.hookCwd, env: hookEnv(c, { CLAUDE_HOOK_STDIN_WAIT_MS: '200' }), stdio: 'pipe' })
      let output = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      // stdin is never written or closed: only the hook's own wait ends the run.
      expect(await closeOf(child)).toBe(0)
      expect(Date.now() - started).toBeLessThan(ownWaitMs)
      expect(output).toBe('')
      expect(c.asked()).toEqual([c.hookCwd])
    }, RUN_MS)
  }

  // The cut falls inside a two-byte letter of the session folder's name: a reader that decoded each
  // chunk on its own would turn both halves of it into replacement characters.
  it('session-start.mjs reads the input to its end once its first byte has come, however long the rest takes', async () => {
    const c = caseDir({ sessionName: 'сессия' })
    const input = Buffer.from(sessionInput('SessionStart', c.session))
    const half = input.indexOf(Buffer.from('сессия')) + 1
    const child = spawn(scriptNode(), [join(HOOKS, 'session-start.mjs')], { cwd: c.hookCwd, env: hookEnv(c, { CLAUDE_HOOK_STDIN_WAIT_MS: '200' }), stdio: 'pipe' })
    const closed = closeOf(child)
    child.stdin.write(input.subarray(0, half))
    // Five times the wait for the first byte: a hook that kept that wait after the first byte has given up by now.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    child.stdin.end(input.subarray(half))
    expect(await closed).toBe(0)
    expect(c.asked()).toEqual([c.session])
  }, RUN_MS)

  // No stdin at all (`ignore`): on POSIX Node opens /dev/null as descriptor 0, so the hook reads an
  // empty input to its end at once. The catch around process.stdin in hook-stdin.mjs is not reached
  // here: Node gives even a closed descriptor 0 a /dev/null before any script runs.
  it('session-start.mjs takes an ignored stdin for no input, at once', async () => {
    const c = caseDir()
    const started = Date.now()
    const child = spawn(scriptNode(), [join(HOOKS, 'session-start.mjs')], { cwd: c.hookCwd, env: hookEnv(c), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    expect(await closeOf(child)).toBe(0)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(output).toBe('')
    expect(c.asked()).toEqual([c.hookCwd])
  }, RUN_MS)

  // A descriptor 0 that cannot be read (a file open for writing only): the stream fails with an error,
  // and the hook goes on with no input at once, neither crashing nor waiting out its 5 s.
  it('session-start.mjs takes a stdin it cannot read for no input, at once', async () => {
    const c = caseDir()
    const fd = openSync(join(c.dir, 'write-only.txt'), 'w')
    const started = Date.now()
    const child = spawn(scriptNode(), [join(HOOKS, 'session-start.mjs')], { cwd: c.hookCwd, env: hookEnv(c), stdio: [fd, 'pipe', 'pipe'] })
    closeSync(fd)
    let output = ''
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    expect(await closeOf(child)).toBe(0)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(output).toBe('')
    expect(c.asked()).toEqual([c.hookCwd])
  }, RUN_MS)
})

// bin/code-map and bin/project-connect read stdin synchronously, to its end, as a command-line tool
// should. They check for a terminal with tty.isatty(0), not process.stdin.isTTY, so the pipe stays
// blocking (their late-writer cases are in harness/bin/tests/code-map.test.sh and project-connect.test.sh).
// On a terminal they refuse at once instead of waiting for input nobody sends. python3 with its pty
// module gives them the terminal; the script kills the command after half the test's limit (exit 98).
describe.skipIf(WINDOWS)('the scripts of bin/ that read stdin to its end', () => {
  // mode: `all` — stdin, stdout and stderr on the terminal; `stdin` — only stdin, the output on a
  // pipe; `out` — the output on the terminal and stdin a pipe that sends `data` and closes.
  const ON_TERMINAL = `
import os, pty, select, subprocess, sys, time
mode, seconds, data = sys.argv[1], float(sys.argv[2]), sys.argv[3].encode()
master, slave = pty.openpty()
tty_in, tty_out = mode in ("all", "stdin"), mode in ("all", "out")
p = subprocess.Popen(sys.argv[4:], stdin=slave if tty_in else subprocess.PIPE,
    stdout=slave if tty_out else subprocess.PIPE, stderr=slave if tty_out else subprocess.STDOUT)
os.close(slave)
if not tty_in:
    p.stdin.write(data)
    p.stdin.close()
fds = [master] + ([] if tty_out else [p.stdout.fileno()])
out = b""
def read_ready(wait):
    global out
    for fd in select.select(fds, [], [], wait)[0]:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            chunk = b""
        if chunk:
            out += chunk
        else:
            fds.remove(fd)
deadline = time.monotonic() + seconds
while p.poll() is None:
    if time.monotonic() > deadline:
        p.kill()
        p.wait()
        sys.stdout.buffer.write(out)
        sys.exit(98)
    read_ready(0.05)
for _ in range(20):
    if not fds:
        break
    read_ready(0.05)
sys.stdout.buffer.write(out)
sys.exit(p.returncode if p.returncode >= 0 else 99)
`
  /**
   * Runs `script` of harness/bin with `args`, the terminal where `mode` puts it (`data` on the stdin
   * pipe of `out`): its exit code (98 when it was still running after half the test's limit) and what it printed.
   */
  function onTerminal(mode: 'all' | 'stdin' | 'out', script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, data = '') {
    const run = spawnSync('python3', ['-c', ON_TERMINAL, mode, String(RUN_MS / 2 / 1000), data, scriptNode(), join(REPO, 'harness', 'bin', script), ...args], { cwd, env, encoding: 'utf8', timeout: RUN_MS })
    return { status: run.status, output: run.stdout }
  }

  /** A Harness home of its own with one registered repository, and the environment that points at it. */
  function registered() {
    const dir = realpathSync.native(mkdtempSync(join(root, 'bin-')))
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    execFileSync('git', ['-C', repo, 'init', '-q'])
    const home = join(dir, 'harness-home')
    mkdirSync(join(home, 'gate'), { recursive: true })
    mkdirSync(join(home, 'projects', 'demo'), { recursive: true })
    writeFileSync(join(home, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'demo', match: repo, profile: 'demo', root: {}, workspace: {} }] }))
    writeFileSync(join(home, 'projects', 'demo', 'profile.json'), JSON.stringify({ schema: 2, name: 'demo', mode: 'full' }))
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(dir, 'home'), USERPROFILE: join(dir, 'home'), HARNESS_HOME: home }
    for (const name of ['EVAL_GIT', 'EVAL_HARNESS_HOME', 'CLAUDE_GATE_CONFIG', 'CLAUDE_PROFILES_DIR', 'CLAUDE_GATE_RESOLVE']) delete env[name]
    mkdirSync(join(dir, 'home'))
    return { repo, env }
  }

  // Only a terminal on stdin counts: a terminal on stdout or stderr says nothing about where the input
  // comes from, and in `all` the three descriptors are one terminal.
  for (const [script, args, refusal, data] of [
    ['code-map', (repo: string) => ['put', '.', '-C', repo], 'the description comes on stdin', 'The root folder.\n'],
    ['project-connect', () => ['--schema-only'], 'the draft is read from stdin', '{}'],
  ] as const) {
    for (const mode of ['all', 'stdin'] as const) {
      it(`${script} refuses a terminal on stdin at once (${mode === 'all' ? 'stdin, stdout and stderr' : 'stdin only'}): ${refusal}`, (context) => {
        // Asked here, not while the file loads: no file of test/contract starts a process then (e2e-no-spawn-on-load).
        if (spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status !== 0) context.skip()
        const { repo, env } = registered()
        const run = onTerminal(mode, script, args(repo), repo, env)
        expect(run.status, run.output).toBe(2)
        expect(run.output).toContain(refusal)
      }, RUN_MS)
    }

    it(`${script} reads a stdin pipe while its output goes to a terminal`, (context) => {
      if (spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status !== 0) context.skip()
      const { repo, env } = registered()
      const run = onTerminal('out', script, args(repo), repo, env, data)
      expect(run.status, run.output).not.toBe(98)
      expect(run.status, run.output).not.toBe(2)
      expect(run.output).not.toContain(refusal)
    }, RUN_MS)
  }
})

describe('the time a hook gives its input', () => {
  type HookStdin = { FIRST_BYTE_MS: Record<string, number>; firstByteWait: (defaultMs: number, name: string) => number }
  const load = async () => (await import(pathToFileURL(join(HOOKS, 'hook-stdin.mjs')).href)) as HookStdin

  // A hook gives the wait for its first byte at most half of its time limit in hooks.json, so the other
  // half is left for its own work. SessionEnd gets 3 s at most on Codex (test/fixtures/codex-app-server/hook-runner.mjs,
  // timeoutSec), whatever hooks.json says.
  it('each hook that reads its input as a stream waits for the first byte at most half of its limit in hooks.json', async () => {
    const { FIRST_BYTE_MS } = await load()
    const declared = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')) as { hooks: Record<string, { hooks: { command: string; timeout: number }[] }[]> }
    const limits: Record<string, number[]> = {}
    for (const [event, groups] of Object.entries(declared.hooks))
      for (const group of groups)
        for (const handler of group.hooks) {
          const file = /\/hooks\/([\w-]+\.mjs)"/.exec(handler.command)?.[1]
          if (file) (limits[file] ??= []).push(event === 'SessionEnd' ? Math.min(3, handler.timeout) : handler.timeout)
        }
    expect(Object.keys(FIRST_BYTE_MS).sort()).toEqual(['gh-token-env.mjs', 'session-start.mjs', 'stage-lines.mjs', 'stop.mjs'])
    for (const [file, wait] of Object.entries(FIRST_BYTE_MS)) {
      expect(limits[file], `${file} is a hook of hooks.json`).toBeDefined()
      // The hook takes its own entry of the table, not another hook's.
      expect(readFileSync(join(HOOKS, file), 'utf8'), file).toContain(`FIRST_BYTE_MS[${JSON.stringify(file)}]`)
      for (const seconds of limits[file] ?? []) expect(wait, file).toBeLessThanOrEqual((seconds * 1000) / 2)
    }
  })

  it('a variable may shorten the wait, never lengthen it; anything but a positive whole number leaves it as it is', async () => {
    const { firstByteWait } = await load()
    vi.stubEnv('SOME_WAIT_MS', '200')
    expect(firstByteWait(5000, 'SOME_WAIT_MS')).toBe(200)
    vi.stubEnv('SOME_WAIT_MS', '9000')
    expect(firstByteWait(5000, 'SOME_WAIT_MS')).toBe(5000)
    for (const junk of ['', '0', '-5', '1.5', 'soon']) {
      vi.stubEnv('SOME_WAIT_MS', junk)
      expect(firstByteWait(5000, 'SOME_WAIT_MS'), junk).toBe(5000)
    }
  })
})
