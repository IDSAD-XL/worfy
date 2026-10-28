// A globalSetup of the `contract` project (vitest.config.ts), Windows only: keeps one Git Bash
// running for the whole run, started with TEMP and TMP set to the system temp folder.
//
// Why. Git Bash runs on the MSYS2 runtime, a fork of Cygwin. The runtime keeps its mount table in
// memory shared by every MSYS2 process of the user, and fills it once, when the first of them
// starts: /etc/fstab of Git for Windows mounts /tmp as `usertemp`, the folder GetTempPathW names
// for that first process (TMP, else TEMP, else USERPROFILE). The table lives as long as any MSYS2
// process does. The contract tests start many Git Bash processes at once, several with TEMP or
// USERPROFILE in a temporary folder of their own; whichever came first decided /tmp for all the
// others, and when its test removed or renamed that folder, every other bash printed
// "bash.exe: warning: could not find /tmp, please create!" into the output its test compares
// (harness-scripts.test.ts on the Windows runner, 2026-10-27), or held a file in it so that the
// test could not rename it (EPERM in harness-evals-outcome.test.ts, keptRun). Started here, before
// any test file, this bash is the first, and /tmp is the system temp folder for the whole run.
//
// The bash waits on its stdin: the teardown closes it, and so does the end of this process however
// it ends, so the bash never outlives the run.
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { gitBash } from './git-bash'

// How long the setup waits for the bash to start before it gives up on holding /tmp.
const START_MS = 30_000

export default async function setup(): Promise<() => Promise<void>> {
  if (process.platform !== 'win32') return async () => {}
  let bash: string
  try {
    bash = gitBash()
  } catch {
    // No Git Bash on this machine: no test can start one either, and the ones that need it say so.
    return async () => {}
  }
  const tmp = tmpdir()
  const child = spawn(bash, ['-c', 'echo up; read -r _'], { env: { ...process.env, TEMP: tmp, TMP: tmp }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Git Bash ${bash} did not start in ${START_MS / 1000} s`)), START_MS)
    child.stdout.once('data', () => {
      clearTimeout(timer)
      resolve()
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  return async () => {
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), START_MS)
    await exited
    clearTimeout(timer)
  }
}
