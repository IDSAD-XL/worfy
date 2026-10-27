// worfy-windows ticket 113: on Windows a window Electron calls focused counts only while worfy owns
// the system's foreground window. The runner is a stand-in: no real PowerShell runs here.
import { describe, expect, it, vi } from 'vitest'
import type { RunFile } from '../../src/main/agent/env'
import { createFocusCheck, FOREGROUND_TIMEOUT_MS, foregroundPid, type ForegroundAnswer } from '../../src/main/foreground'

const OWN_PID = 4242

function check(options: { electron: boolean; platform?: NodeJS.Platform; answer?: ForegroundAnswer }) {
  const foreground = vi.fn(() => Promise.resolve(options.answer ?? { pid: OWN_PID }))
  const warn = vi.fn()
  const focused = createFocusCheck({ electronFocused: () => options.electron, platform: options.platform ?? 'win32', pid: OWN_PID, foreground, warn })
  return { focused, foreground, warn }
}

describe('the focus check of notifications', () => {
  it('on Windows, Electron says focused but another application owns the foreground window: not focused, the notification goes', async () => {
    const c = check({ electron: true, answer: { pid: 40196 } })
    await expect(c.focused()).resolves.toBe(false)
  })

  it('on Windows, worfy owns the foreground window: focused', async () => {
    const c = check({ electron: true, answer: { pid: OWN_PID } })
    await expect(c.focused()).resolves.toBe(true)
  })

  it('no window is in the foreground (pid 0: a locked screen, a window switch): not focused, the notification goes', async () => {
    const c = check({ electron: true, answer: { pid: 0 } })
    await expect(c.focused()).resolves.toBe(false)
  })

  it('Electron says no window is focused: false at once, the system is not asked', () => {
    const c = check({ electron: false })
    expect(c.focused()).toBe(false)
    expect(c.foreground).not.toHaveBeenCalled()
  })

  it('macOS and Linux keep Electron\'s answer, the system is not asked', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const c = check({ electron: true, platform, answer: { pid: 1 } })
      expect(c.focused()).toBe(true)
      expect(c.foreground).not.toHaveBeenCalled()
    }
  })

  it('the system did not answer (timeout, failure): Electron\'s answer stands, and only the first failure is logged', async () => {
    const c = check({ electron: true, answer: { failure: `no answer within ${FOREGROUND_TIMEOUT_MS} ms` } })
    await expect(c.focused()).resolves.toBe(true)
    await expect(c.focused()).resolves.toBe(true)
    expect(c.warn).toHaveBeenCalledTimes(1)
    expect(c.warn.mock.calls[0]?.[0]).toContain(`no answer within ${FOREGROUND_TIMEOUT_MS} ms`)
  })
})

describe('foregroundPid', () => {
  /** A stand-in runner that answers the given result and keeps what it was asked. */
  function runner(result: { error: { code?: unknown; killed?: boolean } | null; stdout?: string; stderr?: string }) {
    const calls: { file: string; args: string[]; options: Parameters<RunFile>[2] }[] = []
    const run: RunFile = (file, args, options, done) => {
      calls.push({ file, args, options })
      done(result.error, result.stdout ?? '', result.stderr ?? '')
    }
    return { run, calls }
  }

  it('runs Windows PowerShell of SystemRoot without a profile or prompts, hidden, within FOREGROUND_TIMEOUT_MS, and reads the pid', async () => {
    const r = runner({ error: null, stdout: '40196\r\n' })
    await expect(foregroundPid(r.run, 'D:\\Windows')).resolves.toEqual({ pid: 40196 })
    expect(r.calls[0]?.file).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(r.calls[0]?.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(r.calls[0]?.args[3]).toContain('GetForegroundWindow')
    expect(r.calls[0]?.options).toMatchObject({ timeout: FOREGROUND_TIMEOUT_MS, windowsHide: true })
  })

  it('a call killed at the timeout, a failed call and an answer that is not a number are failures with the reason', async () => {
    await expect(foregroundPid(runner({ error: { killed: true } }).run)).resolves.toEqual({ failure: `no answer within ${FOREGROUND_TIMEOUT_MS} ms` })
    await expect(foregroundPid(runner({ error: { code: 1 }, stderr: 'Add-Type : boom\r\n' }).run)).resolves.toEqual({ failure: 'exit code 1: Add-Type : boom' })
    await expect(foregroundPid(runner({ error: null, stdout: 'WARNING: x' }).run)).resolves.toEqual({ failure: 'unexpected output "WARNING: x"' })
  })

  it('a runner that throws at once instead of calling back is a failure, not a rejected promise', async () => {
    const run: RunFile = () => {
      throw new Error('spawn EPERM')
    }
    await expect(foregroundPid(run)).resolves.toEqual({ failure: 'could not start: spawn EPERM' })
  })
})
