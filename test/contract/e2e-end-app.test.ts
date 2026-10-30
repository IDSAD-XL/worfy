// How the e2e helper ends an app that did not quit (test/e2e/end-app.ts), on real processes. On
// Windows Playwright starts Electron through cmd.exe, so the process it hands over is a shell and
// the app is that shell's child. A POSIX shell that starts `sleep` and waits for it has the same
// shape, so the case is checked here on macOS and Linux too.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { endApp, exited, killThenClean, running } from '../e2e/end-app'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const started: ChildProcess[] = []
const strays: number[] = []

afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Gone already.
    }
  }
  for (const child of started.splice(0)) child.kill('SIGKILL')
})

/** A shell that starts `sleep` in the background and waits for it, like cmd.exe over electron.exe. Resolves with the sleep's PID. */
async function shellOverApp(): Promise<{ shell: ChildProcess; appPid: number }> {
  const shell = spawn('sh', ['-c', 'sleep 600 & echo $!; wait'], { stdio: ['ignore', 'pipe', 'ignore'] })
  started.push(shell)
  const appPid = await firstNumber(shell)
  strays.push(appPid)
  return { shell, appPid }
}

/** The first line `child` prints, as a number. */
function firstNumber(child: ChildProcess): Promise<number> {
  return new Promise<number>((done, fail) => {
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      if (out.includes('\n')) done(Number(out.trim()))
    })
    child.once('exit', () => fail(new Error('the process exited before it printed a PID')))
  })
}

/**
 * A zombie: a process that has exited but whose parent never reaps it, so `kill(pid, 0)` still
 * finds it and SIGKILL cannot remove it — a process that outlives the kill. The shell starts a short
 * `sleep` and replaces itself with `sleep 30`, which never waits for children. Resolves once the
 * short `sleep` has become a zombie. Killing `parent` lets init reap it.
 */
async function zombie(): Promise<{ parent: ChildProcess; pid: number }> {
  const parent = spawn('sh', ['-c', 'sleep 0.2 & echo $!; exec sleep 30'], { stdio: ['ignore', 'pipe', 'ignore'] })
  started.push(parent)
  const pid = await firstNumber(parent)
  const deadline = Date.now() + ms(5_000)
  while (!execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim().startsWith('Z')) {
    if (Date.now() > deadline) throw new Error(`process ${pid} did not become a zombie`)
    await new Promise((done) => setTimeout(done, 20))
  }
  return { parent, pid }
}

/** A process that runs until killed, started directly: the app as macOS and Linux start it. */
function app(): ChildProcess {
  const child = spawn(scriptNode(), ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  started.push(child)
  return child
}

describe('endApp', () => {
  // Windows: the stand-in is a POSIX `sh` over `sleep` (shellOverApp), the macOS and Linux shape of the case.
  it.skipIf(process.platform === 'win32')('kills the app the shell started, not only the shell, and waits for both', async () => {
    const { shell, appPid } = await shellOverApp()
    expect(running(appPid)).toBe(true)

    await endApp(shell, appPid)

    expect(running(appPid)).toBe(false)
    expect(shell.exitCode !== null || shell.signalCode !== null).toBe(true)
  })

  it('kills the app when it is the process Playwright started', async () => {
    const child = app()
    await new Promise((done) => child.once('spawn', done))

    await endApp(child, child.pid)

    expect(child.signalCode ?? child.exitCode).not.toBeNull()
    expect(running(child.pid!)).toBe(false)
  })

  it('without the app’s PID, kills the started process on macOS and Linux', async () => {
    const child = app()
    await new Promise((done) => child.once('spawn', done))
    const trees: number[] = []

    await endApp(child, undefined, { platform: 'darwin', killTree: async (pid) => void trees.push(pid) })

    expect(trees).toEqual([])
    expect(running(child.pid!)).toBe(false)
  })

  // Windows: the stand-in is a zombie process read through `ps -o stat=` (zombie); Windows has neither.
  it.skipIf(process.platform === 'win32')('rejects when the app’s process outlives the kill', async () => {
    const { pid } = await zombie()
    const child = app()
    await new Promise((done) => child.once('spawn', done))

    await expect(endApp(child, pid, { goneTimeoutMs: 300 })).rejects.toThrow(`the app's process ${pid} still runs 0.3 s after SIGKILL`)
    expect(running(pid)).toBe(true)
  })

  // Windows: the stand-in is a zombie process read through `ps -o stat=` (zombie); Windows has neither.
  it.skipIf(process.platform === 'win32')('waits until the app’s process is gone, past the exit of the started process', async () => {
    const { parent, pid } = await zombie()
    const child = app()
    await new Promise((done) => child.once('spawn', done))
    // The zombie goes once its parent dies and init reaps it: well after `child` has exited.
    const killParent = setTimeout(() => parent.kill('SIGKILL'), 500)

    await endApp(child, pid, { goneTimeoutMs: ms(5_000) })

    expect(running(pid)).toBe(false)
    clearTimeout(killParent)
  })

  it('without the app’s PID, kills the whole tree under the started process on Windows', async () => {
    const child = app()
    await new Promise((done) => child.once('spawn', done))
    const trees: number[] = []

    await endApp(child, undefined, { platform: 'win32', killTree: async (pid) => void trees.push(pid) })

    expect(trees).toEqual([child.pid])
    await exited(child)
  })
})

describe('killThenClean', () => {
  it('cleans after a kill that failed, and resolves with that failure', async () => {
    const failure = new Error('outlived')
    const steps: string[] = []

    const result = await killThenClean(
      async () => {
        steps.push('kill')
        throw failure
      },
      async () => void steps.push('clean'),
    )

    expect(steps).toEqual(['kill', 'clean'])
    expect(result).toBe(failure)
  })

  it('cleans after a kill that succeeded, and resolves with undefined', async () => {
    const steps: string[] = []

    const result = await killThenClean(async () => void steps.push('kill'), async () => void steps.push('clean'))

    expect(steps).toEqual(['kill', 'clean'])
    expect(result).toBeUndefined()
  })
})
