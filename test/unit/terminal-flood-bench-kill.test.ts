// scripts/terminal-flood-bench.mjs ends the shells it started by pid (worfy-windows ticket 67). On
// Windows node-pty reports pid 0 until the console has started the shell, and process.kill(0) there
// ended the script itself; on macOS and Linux 0 and a negative pid name a process group.
import { describe, expect, it } from 'vitest'
import { isShellPid, killShells } from '../../scripts/terminal-flood-bench-kill.mjs'

describe('the flood bench kills only pids of one process', () => {
  it('a whole number above 0 is a pid; 0, a negative number, NaN, a fraction and no pid are not', () => {
    expect([1, 4242].map(isShellPid)).toEqual([true, true])
    expect([0, -1, Number.NaN, 1.5, undefined, null].map(isShellPid)).toEqual([false, false, false, false, false, false])
  })

  it('kills each pid above 0 and skips the others; a process already gone stops nothing', () => {
    const killed: [number, string][] = []
    killShells([0, 4242, -7, Number.NaN, undefined, 99], (pid: number, signal: string) => {
      killed.push([pid, signal])
      if (pid === 4242) throw new Error('ESRCH')
    })
    expect(killed).toEqual([
      [4242, 'SIGKILL'],
      [99, 'SIGKILL'],
    ])
  })
})
