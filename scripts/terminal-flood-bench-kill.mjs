// The end of the shells scripts/terminal-flood-bench.mjs started, kept out of that script so a unit
// test can call it (test/unit/terminal-flood-bench-kill.test.ts).
//
// Only a pid above 0 is signalled. On Windows node-pty reports pid 0 until the console has started
// the shell, and process.kill(0) there ends the calling process (libuv takes 0 for itself); on
// macOS and Linux 0 and a negative pid signal a whole process group.
import process from 'node:process'

/** Whether `pid` names one process that may be signalled: a whole number above 0. */
export function isShellPid(pid) {
  return Number.isInteger(pid) && pid > 0
}

/** Sends SIGKILL to each pid that names one process; one that is gone already is skipped. */
export function killShells(pids, kill = (pid, signal) => process.kill(pid, signal)) {
  for (const pid of pids) {
    if (!isShellPid(pid)) continue
    try {
      kill(pid, 'SIGKILL')
    } catch {
      // Gone already.
    }
  }
}
