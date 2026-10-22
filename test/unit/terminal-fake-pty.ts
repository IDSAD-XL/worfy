// The stand-in pty of the Terminal unit tests, and the Windows environment they give a registry.
// Shared by terminal-shell.test.ts and terminal-console.test.ts (worfy-windows ticket 22: the
// first file had passed the 1000 lines the gate warns about).
import type { PtyProcess, TerminalSink } from '../../src/main/terminal/pty'

export const WINDOWS_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
export const WIN_ENV = {
  Path: 'C:\\Tools;C:\\Program Files\\Git\\cmd;C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps',
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
}
export interface FakeOptions {
  /** Without node-pty's private agent and its helper process: not a pty of node-pty as 1.1.0 builds it. */
  plain?: boolean
  /** kill() does not end it: node-pty reports no exit. */
  deaf?: boolean
  /** With the agent and its helper, and without the thread that reads the output. */
  noWorker?: boolean
}

/**
 * A pty that only records. Its pid is one no system gives out: a registry that took the wrong way
 * to close it would signal nobody. `kill` ends it, as node-pty's does, unless it is `deaf`.
 */
export function fakePty(pid: number, options: FakeOptions = {}) {
  const kills: (string | undefined)[] = []
  /** What node-pty's helper would answer at each kill(): 'ran' when it is still node-pty's own. */
  const helper: unknown[] = []
  let onExit: (event: { exitCode: number; signal?: number }) => void = () => undefined
  let onData: (data: string) => void = () => undefined
  /** How many times kill() had been called when the thread that reads the output was asked to stop. */
  const stops: number[] = []
  const agent: { _getConsoleProcessList: unknown; _conoutSocketWorker?: { dispose: unknown }; exitCode?: number | undefined } = {
    _getConsoleProcessList: (): Promise<unknown> => Promise.resolve('ran'),
    // As node-pty's agent: the field is there, undefined while the shell runs (readsExitCode).
    exitCode: undefined,
    ...(options.noWorker ? {} : { _conoutSocketWorker: { dispose: () => void stops.push(kills.length) } }),
  }
  const pty: PtyProcess = {
    pid,
    onData: (listener) => {
      onData = listener
    },
    onExit: (listener) => {
      onExit = listener
    },
    write: () => undefined,
    resize: () => undefined,
    kill: (signal) => {
      kills.push(signal)
      if (!options.plain && typeof agent._getConsoleProcessList === 'function') helper.push((agent._getConsoleProcessList as () => unknown)())
      if (!options.deaf) onExit({ exitCode: 0 })
    },
    ...(options.plain ? {} : { _agent: agent }),
  }
  return {
    pty,
    kills,
    helper,
    stops,
    agent,
    exit: (exitCode = 0) => onExit({ exitCode }),
    /** The exit event as node-pty sends it on Windows when its output closes before the exit code is known. */
    exitWithoutCode: () => onExit({} as { exitCode: number }),
    print: (data: string) => onData(data),
  }
}

export const SINK: TerminalSink = { output: () => undefined, exit: () => undefined, started: () => undefined }
export const OPEN = { cwd: 'C:\\p\\repo', cols: 80, rows: 24 }
export const winEnv = () => Promise.resolve({ ...WIN_ENV })