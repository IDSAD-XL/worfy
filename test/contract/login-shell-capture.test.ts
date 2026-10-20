// The capture of the login shell environment (src/main/agent/env.ts) against real shells, and the
// PATH the Harness scripts get when that capture fails (src/main/harness/script-env.ts),
// worfy-harness ticket 43.
//
// An rc file may leave a process in the background (`sleep 30 &`). It inherits the shell's output
// and holds it open after the shell has printed its environment and exited. The capture used to
// answer when that output closed, so it waited out its whole time limit (10 s), and the first read
// of a Project's Epics waited with it. Now it answers on the end marker of the dump, and reads the
// output on until that process closes it: closing it would kill the process at its next write.
//
// The login shells are the real /bin/sh, /bin/zsh and /bin/bash with rc files in a temporary HOME:
// no new executable file is started (macOS checks a new one first, under load for seconds). Every
// background process an rc file starts writes its pid into HOME and is killed after the test.
// Nothing here reads or writes the real ~/.claude or the real rc files.
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentEnv, captureLoginShellEnv, MAX_SHELL_OUTPUT, SYSTEM_PATH, type CapturedEnv } from '../../src/main/agent/env'
import { harnessScriptEnv, withProcessPath } from '../../src/main/harness/script-env'
import { removeTestTree } from '../remove'

/** The files in HOME where an rc file writes the pids of what it leaves behind. */
const PID_FILES = ['background.pid', 'probe.pid', 'shell.pid']

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'worfy-login-shell-'))
})

afterEach(() => {
  for (const name of PID_FILES) {
    const file = join(home, name)
    if (!existsSync(file)) continue
    const pid = Number(readFileSync(file, 'utf8').trim())
    try {
      if (pid > 0) process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
  vi.restoreAllMocks()
  removeTestTree(home)
})

/** worfy's own environment as a test sets it: the temporary HOME and the given shell. */
function source(shell: string): Record<string, string> {
  return { HOME: home, USER: 'tester', SHELL: shell, LANG: 'en_US.UTF-8' }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(done: () => boolean, what: string, ms: number): Promise<void> {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error(`not within ${ms} ms: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function pidOf(name: string): number {
  return Number(readFileSync(join(home, name), 'utf8').trim())
}

/** What an rc file adds to leave `sleep 30` in the background, holding the shell's output open. */
const BACKGROUND = 'sleep 30 & echo $! > "$HOME/background.pid"\n'

// A second background process that writes to the shell's output and its stderr once the test
// creates HOME/go — after the capture has answered — and then writes HOME/after. A `git pull` of
// dotfiles an rc file starts in the background is such a process. It waits for the file, not for
// a fixed time, so a slow run cannot move its writes before the answer.
const LATE_WRITER =
  '( while [ ! -e "$HOME/go" ]; do sleep 0.05; done; echo late; echo late >&2; echo survived > "$HOME/after" ) & echo $! > "$HOME/probe.pid"\n'

/** `.profile` of HOME, which /bin/sh as a login shell reads. */
function profile(content: string): void {
  writeFileSync(join(home, '.profile'), content)
}

// POSIX shells only: Windows has no login shell (captureAgentEnv reads the registry there).
describe.skipIf(process.platform === 'win32')('the login shell capture with a process an rc file left in the background', () => {
  it('answers as soon as the environment is printed, well inside the time limit', async () => {
    profile(BACKGROUND)
    const started = Date.now()
    // The default time limit (10 s): the capture that waited for the output to close took all of it.
    const result = await captureLoginShellEnv({ shell: '/bin/sh', source: source('/bin/sh') })
    const took = Date.now() - started
    expect(result.from, result.error ?? '').toBe('login-shell')
    expect(result.error).toBeNull()
    expect(result.env.HOME).toBe(home)
    expect(took).toBeLessThan(2_000)
  }, 20_000)

  it("leaves that process running — it is the user's — and its writes to the shell's output and stderr after the answer do not kill it", async () => {
    profile(BACKGROUND + LATE_WRITER)
    const result = await captureLoginShellEnv({ shell: '/bin/sh', source: source('/bin/sh') })
    expect(result.from, result.error ?? '').toBe('login-shell')
    writeFileSync(join(home, 'go'), '')
    await until(() => existsSync(join(home, 'after')), 'the background process wrote after its late writes', 10_000)
    expect(readFileSync(join(home, 'after'), 'utf8').trim()).toBe('survived')
    expect(alive(pidOf('background.pid'))).toBe(true)
  }, 20_000)

  it('still falls back at the time limit when the shell prints nothing, and ends that shell', async () => {
    // The shell becomes `sleep 30`: it never prints the environment and never exits by itself.
    profile('echo $$ > "$HOME/shell.pid"; exec sleep 30\n')
    const started = Date.now()
    const result = await captureLoginShellEnv({ shell: '/bin/sh', source: source('/bin/sh'), timeoutMs: 1_000 })
    const took = Date.now() - started
    expect(result.from).toBe('fallback')
    expect(result.error).toMatch(/^\/bin\/sh -ilc failed: no environment within 1000 ms/)
    expect(result.env).toEqual({ PATH: SYSTEM_PATH, ...source('/bin/sh') })
    // The timer fired: not before the limit, and the run did not hang.
    expect(took).toBeGreaterThanOrEqual(950)
    await until(() => !alive(pidOf('shell.pid')), 'the shell that hung ended', 5_000)
  }, 20_000)

  // The ticket's risk: a shell ended early skips its logout files. The capture still answers with no error.
  for (const [shell, rcFile] of [
    ['/bin/zsh', '.zshrc'],
    ['/bin/bash', '.bash_profile'],
  ] as const) {
    it.skipIf(!existsSync(shell))(`${shell}: answers early and with no error`, async () => {
      writeFileSync(join(home, rcFile), BACKGROUND)
      writeFileSync(join(home, shell === '/bin/zsh' ? '.zlogout' : '.bash_logout'), 'echo logout >&2\n')
      const started = Date.now()
      const result = await captureLoginShellEnv({ shell, source: source(shell) })
      const took = Date.now() - started
      expect(result.from, result.error ?? '').toBe('login-shell')
      expect(result.error).toBeNull()
      expect(result.env.HOME).toBe(home)
      expect(took).toBeLessThan(2_000)
    }, 20_000)
  }
})

// What the First run window shows when the capture falls back (src/main/workflow/folder.ts).
describe.skipIf(process.platform === 'win32')('the reason of a fallback', () => {
  it("says the exit code and ends with what the rc file printed to stderr", async () => {
    profile('echo "profile: line 1: syntax error near nvm" >&2\nexit 3\n')
    const result = await captureLoginShellEnv({ shell: '/bin/sh', source: source('/bin/sh') })
    expect(result.from).toBe('fallback')
    expect(result.error).toMatch(/^\/bin\/sh -ilc failed: exit code 3\n/)
    expect(result.error).toContain('profile: line 1: syntax error near nvm')
  })

  it('says the signal that killed the shell', async () => {
    profile('kill -9 $$\n')
    const result = await captureLoginShellEnv({ shell: '/bin/sh', source: source('/bin/sh') })
    expect(result.from).toBe('fallback')
    expect(result.error).toMatch(/^\/bin\/sh -ilc failed: killed by SIGKILL/)
  })

  it('says the shell printed no environment when it exits 0 without the dump', async () => {
    profile('exec true\n')
    const result = await captureLoginShellEnv({ shell: '/bin/sh', source: source('/bin/sh') })
    expect(result).toMatchObject({ from: 'fallback', error: '/bin/sh -ilc printed no environment' })
  })

  it('falls back past MAX_SHELL_OUTPUT characters of output', async () => {
    profile("head -c 17000000 /dev/zero | tr '\\0' a\n")
    const result = await captureLoginShellEnv({ shell: '/bin/sh', source: source('/bin/sh') })
    expect(MAX_SHELL_OUTPUT).toBe(16_777_216)
    expect(result.from).toBe('fallback')
    expect(result.error).toMatch(/^\/bin\/sh -ilc failed: more than 16777216 characters of output/)
  }, 20_000)
})

describe('a shell started without pipes (out of file descriptors)', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process')
    vi.resetModules()
  })

  it('answers the fallback and throws nothing, now or when the timer would fire', async () => {
    // Out of descriptors, Node returns a child whose pipes are null and emits EMFILE on it.
    vi.resetModules()
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      const spawn = (): unknown => {
        const child = Object.assign(new EventEmitter(), { stdin: null, stdout: null, stderr: null, stdio: [null, null, null], pid: undefined, exitCode: null, signalCode: null, kill: () => false })
        process.nextTick(() => child.emit('error', Object.assign(new Error('spawn /bin/sh EMFILE'), { code: 'EMFILE' })))
        return child
      }
      return { ...actual, spawn }
    })
    const { captureLoginShellEnv: capture } = await import('../../src/main/agent/env')
    const result = await capture({ shell: '/bin/sh', source: source('/bin/sh'), timeoutMs: 200 })
    expect(result.from).toBe('fallback')
    expect(result.error).toMatch(/^\/bin\/sh -ilc failed: /)
    expect(result.env).toEqual({ PATH: SYSTEM_PATH, ...source('/bin/sh') })
    // Past the time limit and the error event: an uncaught throw from either fails the run.
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
})

describe('the PATH of the Harness scripts when the capture fails', () => {
  const failed = (path: string): CapturedEnv => ({ env: { PATH: path, HOME: '/home/u' }, from: 'fallback', error: 'shell failed' })

  it.skipIf(process.platform === 'win32')("the app's source: a failed capture gives the scripts the folder with node from worfy's own PATH, after the system PATH", async () => {
    const nodeDir = join(home, 'node-bin')
    const saved = { SHELL: process.env.SHELL, PATH: process.env.PATH }
    // worfy started from a terminal: its own PATH has node; the login shell cannot start.
    process.env.SHELL = join(home, 'no-such-shell')
    process.env.PATH = `/usr/bin:${nodeDir}:/bin`
    try {
      const held = await agentEnv()
      expect(held.from).toBe('fallback')
      expect(held.env.PATH).toBe(SYSTEM_PATH)
      expect((await harnessScriptEnv()).PATH).toBe(`${SYSTEM_PATH}:${nodeDir}`)
      expect((await harnessScriptEnv({ fresh: 'if-fallback' })).PATH).toBe(`${SYSTEM_PATH}:${nodeDir}`)
      expect((await harnessScriptEnv({ fresh: 'always' })).PATH).toBe(`${SYSTEM_PATH}:${nodeDir}`)
      // The Sessions and Terminal Nodes keep the minimal environment (ADR-0007).
      expect((await agentEnv()).env.PATH).toBe(SYSTEM_PATH)
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('withProcessPath: the PATH of the process goes after the system PATH, without repeats', () => {
    expect(withProcessPath(failed(SYSTEM_PATH), '/opt/node/bin:/usr/bin::/bin', 'darwin')).toEqual({ PATH: `${SYSTEM_PATH}:/opt/node/bin`, HOME: '/home/u' })
    // A folder twice in the PATH of the process itself goes in once.
    expect(withProcessPath(failed(SYSTEM_PATH), '/opt/node/bin:/opt/node/bin', 'darwin').PATH).toBe(`${SYSTEM_PATH}:/opt/node/bin`)
  })

  it('withProcessPath: a capture that did not fail is not touched, nor a fallback on Windows, nor one without a PATH of the process', () => {
    const fromShell: CapturedEnv = { env: { PATH: '/usr/bin', HOME: '/home/u' }, from: 'login-shell', error: null }
    expect(withProcessPath(fromShell, '/opt/node/bin', 'darwin')).toBe(fromShell.env)
    const onWindows = failed('C:\\Windows')
    expect(withProcessPath(onWindows, 'C:\\node', 'win32')).toBe(onWindows.env)
    const noPath = failed(SYSTEM_PATH)
    expect(withProcessPath(noPath, '', 'darwin')).toBe(noPath.env)
  })
})
