// How the e2e helper ends an app that did not quit (test/e2e/end-app.ts), on real processes. On
// Windows Playwright starts Electron through cmd.exe, so the process it hands over is a shell and
// the app is that shell's child. A POSIX shell that starts `sleep` and waits for it has the same
// shape, so the case is checked here on macOS and Linux too.
import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { endApp, exited, running } from '../e2e/end-app'

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
  const appPid = await new Promise<number>((done, fail) => {
    let out = ''
    shell.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      if (out.includes('\n')) done(Number(out.trim()))
    })
    shell.once('exit', () => fail(new Error('the shell exited before it named its child')))
  })
  strays.push(appPid)
  return { shell, appPid }
}

/** A process that runs until killed, started directly: the app as macOS and Linux start it. */
function app(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' })
  started.push(child)
  return child
}

describe('endApp', () => {
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

  it('without the app’s PID, kills the whole tree under the started process on Windows', async () => {
    const child = app()
    await new Promise((done) => child.once('spawn', done))
    const trees: number[] = []

    await endApp(child, undefined, { platform: 'win32', killTree: async (pid) => void trees.push(pid) })

    expect(trees).toEqual([child.pid])
    await exited(child)
  })
})
