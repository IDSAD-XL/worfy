// killTree (src/main/workflow/profile.ts) with a stand-in system: the Windows branch (taskkill /T /F,
// the child alone when taskkill fails) and the POSIX fallback when the process group cannot be
// signalled, on any system (Mac review of PR #482, worfy-windows ticket 59).
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { killTree, type KilledChild, type KillSystem } from '../../src/main/workflow/profile'

/** A child that records the signals it is sent; `exited` as if it had ended already. */
function child(pid: number | undefined, exited = false): KilledChild & { sent: (NodeJS.Signals | number | undefined)[] } {
  const sent: (NodeJS.Signals | number | undefined)[] = []
  return {
    pid,
    exitCode: exited ? 0 : null,
    signalCode: null,
    sent,
    kill: (signal) => {
      sent.push(signal)
      return true
    },
  }
}

/** A system of `platform` that records what killTree started and signalled; `kill` throws when `groupFails`. */
function system(platform: NodeJS.Platform, groupFails = false) {
  const started: { command: string; args: readonly string[]; options: object; process: EventEmitter }[] = []
  const killed: { pid: number; signal: NodeJS.Signals }[] = []
  const stand: KillSystem = {
    platform,
    systemRoot: 'D:\\Win',
    spawn: (command, args, options) => {
      const process = new EventEmitter()
      started.push({ command, args, options, process })
      return process as unknown as ReturnType<KillSystem['spawn']>
    },
    kill: (pid, signal) => {
      killed.push({ pid, signal })
      if (groupFails) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    },
  }
  return { stand, started, killed }
}

describe('killTree on Windows', () => {
  it('runs taskkill /T /F for the pid from %SystemRoot%\\System32, without a window, and signals nothing itself', () => {
    const { stand, started, killed } = system('win32')
    const script = child(4242)
    killTree(script, stand)
    expect(started).toHaveLength(1)
    expect(started[0]?.command.startsWith('D:\\Win')).toBe(true)
    expect(started[0]?.command.replaceAll('\\', '/').endsWith('/System32/taskkill.exe')).toBe(true)
    expect(started[0]?.args).toEqual(['/T', '/F', '/PID', '4242'])
    expect(started[0]?.options).toEqual({ stdio: 'ignore', windowsHide: true })
    started[0]?.process.emit('exit', 0)
    expect(script.sent).toEqual([])
    expect(killed).toEqual([])
  })

  it('taskkill that fails (a code other than 0) or does not start: the child alone gets SIGKILL', () => {
    for (const fail of [(p: EventEmitter) => p.emit('exit', 128), (p: EventEmitter) => p.emit('error', new Error('spawn ENOENT'))]) {
      const { stand, started } = system('win32')
      const script = child(4242)
      killTree(script, stand)
      fail(started[0]!.process)
      expect(script.sent).toEqual(['SIGKILL'])
    }
  })

  it('without a systemRoot taskkill is looked for under C:\\Windows', () => {
    const { stand, started } = system('win32')
    killTree(child(7), { ...stand, systemRoot: undefined })
    expect(started[0]?.command.startsWith('C:\\Windows')).toBe(true)
  })

  it('a failed taskkill after the child has ended sends it nothing', () => {
    const { stand, started } = system('win32')
    const script = child(4242, true)
    killTree(script, stand)
    started[0]?.process.emit('exit', 128)
    expect(script.sent).toEqual([])
  })
})

describe('killTree outside Windows', () => {
  it('sends SIGKILL to the process group the child leads (a negative pid), not to the child', () => {
    const { stand, started, killed } = system('darwin')
    const script = child(4242)
    killTree(script, stand)
    expect(killed).toEqual([{ pid: -4242, signal: 'SIGKILL' }])
    expect(script.sent).toEqual([])
    expect(started).toEqual([])
  })

  it('a group that cannot be signalled: the child alone gets SIGKILL', () => {
    const { stand, killed } = system('linux', true)
    const script = child(4242)
    killTree(script, stand)
    expect(killed).toEqual([{ pid: -4242, signal: 'SIGKILL' }])
    expect(script.sent).toEqual(['SIGKILL'])
  })

  it('a child without a pid (it never started) gets SIGKILL alone, and no group is signalled', () => {
    const { stand, killed } = system('darwin')
    const script = child(undefined)
    killTree(script, stand)
    expect(killed).toEqual([])
    expect(script.sent).toEqual(['SIGKILL'])
  })
})
