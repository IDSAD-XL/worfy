// What the Terminal contract tests share: the wording of what they type for each shell, the per-test
// scratch folders, and the harness that puts the `terminal.*` IPC channels on a real pseudo-terminal.
// Split out of terminal.test.ts (worfy-windows ticket 22) to keep that file under the gate's
// 1000-line bound; terminal.test.ts and terminal-windows.test.ts both use it.
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { SYSTEM_PATH } from '../../src/main/agent/env'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { terminalHandlers } from '../../src/main/ipc/terminal'
import { spawnShellPty, TerminalRegistry, terminalShellOptions, type SpawnPty } from '../../src/main/terminal/pty'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL } from '../app-url'

export const PROJECT = 'demo-00000001'
export const NODE = 'node-1'

// The shell of the harness: /bin/sh, and on Windows Windows PowerShell (worfy-windows ticket 10). What
// the tests type has a wording for each.
export const WINDOWS = process.platform === 'win32'
export const SYSTEM_ROOT = process.env['SystemRoot'] ?? 'C:\\Windows'
/** The file name of the shell the harness starts. */
export const SHELL_NAME = WINDOWS ? 'powershell.exe' : 'sh'
/** Prints `a` and `b` as one word. The typed line never holds the word itself, so only the output matches it. */
export const say = (a: string, b: string): string => (WINDOWS ? `Write-Output ('${a}' + '${b}')` : `echo ${a}""${b}`)
/** Prints `<label>=<columns>x<rows>` of the terminal. */
export const sayTheSize = (label: string): string =>
  WINDOWS ? `Write-Output ('${label}=' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)` : `echo "${label}=$(tput cols)x$(tput lines)"`
/** Prints `cwd=<the folder the shell is in>`; folderLine is the line to wait for. */
export const SAY_THE_FOLDER = WINDOWS ? "Write-Output ('cwd=' + (Get-Location).Path)" : 'echo "cwd=$(pwd)"'
export const folderLine = (folder: string): RegExp => new RegExp(`cwd=${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n`)
/** A shell that ignores SIGHUP, where there is one to ignore; then a word, to know the line ran. */
export const IGNORE_HANGUP = `${WINDOWS ? '' : "trap '' HUP; "}${say('trap', 'ped')}`

/**
 * The environment of a shell of Windows in the tests: the system folders on the Path, so the shell
 * is Windows PowerShell, and every folder of the user in the temporary home, so no profile,
 * history or cache of the machine running the tests takes part. `path` goes first on the Path.
 */
export function windowsEnv(home: string, path: readonly string[] = []): Record<string, string> {
  return {
    SystemRoot: SYSTEM_ROOT,
    SystemDrive: SYSTEM_ROOT.slice(0, 2),
    windir: SYSTEM_ROOT,
    ComSpec: win32.join(SYSTEM_ROOT, 'System32', 'cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    Path: [...path, win32.join(SYSTEM_ROOT, 'System32'), SYSTEM_ROOT, win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    ProgramFiles: process.env['ProgramFiles'] ?? 'C:\\Program Files',
    ProgramData: process.env['ProgramData'] ?? 'C:\\ProgramData',
    USERPROFILE: home,
    HOME: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TEMP: home,
    TMP: home,
    PWD: '/somewhere/else',
    SHLVL: '3',
  }
}

/**
 * node-pty as the app starts it, with PowerShell started without the profile of the user (as the
 * empty HOME does for /bin/sh). Nothing here answers the request the console of Windows sends at
 * the start of a shell: the registry does (src/main/terminal/console-request.ts).
 */
const spawnWithoutProfile: SpawnPty = (shell, args, options) => spawnShellPty(shell, /(?:powershell|pwsh)\.exe$/i.test(shell) ? [...args, '-NoProfile'] : args, options)

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
export interface OpenResult {
  pid: number
  shell: string
  replay: string
  end: number
  started: boolean
  exited: { exitCode: number; signal: number | null } | null
}
export interface Output {
  projectId: string
  nodeId: string
  data: string
  end: number
}
export interface Exit {
  projectId: string
  nodeId: string
  exitCode: number
  signal: number | null
}
export interface Started {
  projectId: string
  nodeId: string
  pid: number
}
export type Window = ReturnType<Awaited<ReturnType<typeof harness>>['makeWindow']>

// The Project folder and the home folder of the test that runs now. The hooks below assign them, so
// a test file reads them through its import (a live binding) and must not copy them at load time.
export let root: string
export let home: string
const registries: TerminalRegistry[] = []

// Whether the test that runs now has printed the timing of its first command (worfy-windows ticket 41).
let firstRunTimed = false

/** Gives every test of the file that calls it, once and at its top level, a fresh `root` and `home`, and closes what the test left. */
export function useTerminalScratch(): void {
  beforeEach(async () => {
    firstRunTimed = false
    root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-terminal-project-')))
    home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-terminal-home-')))
  })

  afterEach(async () => {
    // A failed test must not leave shells behind either.
    await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
}

// The skip of the Windows PowerShell 5.1 tests on the GitHub runner (worfy-windows ticket 41) lives in
// test/windows-runner.ts, where test/unit/windows-runner.test.ts pins its condition.
export { NO_WINDOWS_POWERSHELL_ON_RUNNER, needsWindowsPowerShellOffRunner } from '../windows-runner'

/** True while a process with this pid exists (a reaped child is gone). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * A cursor-position request (DSR 6) and what a screen answers to it: row and column, 1-based.
 * main answers it (cursor-answers.ts); xterm.js in a view answers too, and main drops that answer.
 * The console of the node-pty package 1.2.0-beta.15
 * (OpenConsole.exe 1.25.2603.03002) sends it about ten times after a resize, and PowerShell echoes
 * nothing more until it is answered (measured on the owner's PC, PR #498).
 */
export const CURSOR_REQUEST = '\x1b[6n'
export const CURSOR_ANSWER = '\x1b[1;1R'

/** Counts the cursor-position requests in the output of one Terminal, a request split across chunks too. */
export function cursorRequests(): (data: string) => number {
  let carry = ''
  return (data) => {
    const seen = carry + data
    let count = 0
    for (let at = seen.indexOf(CURSOR_REQUEST); at !== -1; at = seen.indexOf(CURSOR_REQUEST, at + CURSOR_REQUEST.length)) count += 1
    // What could be the start of the next request: shorter than a whole one, so never counted twice.
    carry = seen.slice(-(CURSOR_REQUEST.length - 1))
    return count
  }
}

export interface HarnessOptions {
  killGraceMs?: number
  nodes?: string[]
  spawn?: SpawnPty
  path?: readonly string[]
  shell?: 'powershell' | 'git-bash'
  /** The system of the registry, with a stand-in `spawn`: the Windows way on any machine. */
  platform?: NodeJS.Platform
  /** The files there are, for the search of the shell on Windows. */
  exists?: (path: string) => boolean
  /** What the settings of a Project answer; `shell` for every Project when left out. */
  shellSetting?: (projectId: string) => 'powershell' | 'git-bash' | undefined
  /** What terminal.shells is given; the shells of this machine when left out. */
  shells?: (() => Promise<unknown[]>) | null
}

export async function harness(options: HarnessOptions = {}) {
  // /bin/sh with an empty HOME: no rc file of the machine running the tests takes part. On
  // Windows: Windows PowerShell without a profile (windowsEnv, spawnWithoutProfile).
  const onWindows = options.platform === undefined ? WINDOWS : options.platform === 'win32'
  const env = (): Promise<Record<string, string>> =>
    Promise.resolve(onWindows ? windowsEnv(home, options.path) : { SHELL: '/bin/sh', PATH: SYSTEM_PATH, HOME: home, PS1: '$ ', PWD: '/somewhere/else', SHLVL: '3' })
  const registry = new TerminalRegistry({
    env,
    killGraceMs: options.killGraceMs ?? 1000,
    // A stand-in pty has a pid of no process: nothing of the system is asked to end it.
    ...(options.spawn === undefined ? (WINDOWS ? { spawn: spawnWithoutProfile } : {}) : { spawn: options.spawn, endDescendants: () => undefined }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.exists === undefined ? {} : { exists: options.exists }),
  })
  registries.push(registry)
  const nodes = new Set(options.nodes ?? [NODE])
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  const projectRoot = vi.fn((projectId: string) => {
    if (projectId !== PROJECT) throw new Error(`No Project with id ${projectId}`)
    return root
  })
  const shellSetting = vi.fn(options.shellSetting ?? (() => options.shell))
  await registerIpc(ipc, {
    modules: {
      './terminal.ts': () =>
        Promise.resolve(
          terminalHandlers({
            registry: () => registry,
            projectRoot,
            isTerminalNode: (projectId, nodeId) => projectId === PROJECT && nodes.has(nodeId),
            shellSetting,
            ...(options.shells === null ? {} : { shells: (options.shells ?? (async () => terminalShellOptions(await env()))) as () => Promise<never[]> }),
          }),
        ),
    },
    isTrustedSender: (url) => url === APP_URL,
  })

  // What every window got, and what each window got on its own (`window.outputs` and the rest).
  const outputs: Output[] = []
  const exits: Exit[] = []
  let windows = 0
  // The window of the calls without a window of their own is the screen: it answers the cursor
  // requests, once for each, as xterm.js does in a view — marked as an answer (`reply`), and main
  // drops it: main answers those requests itself (cursor-answers.ts, worfy-windows ticket 39).
  // Another window stays silent.
  const screens = new Map<string, (data: string) => number>()
  const answerCursor = (output: Output, from: ReturnType<typeof makeWindow>) => {
    let requests = screens.get(output.nodeId)
    if (requests === undefined) screens.set(output.nodeId, (requests = cursorRequests()))
    for (let left = requests(output.data); left > 0; left--) {
      void ok('terminal.input', { projectId: PROJECT, nodeId: output.nodeId, data: CURSOR_ANSWER, reply: true }, from).catch(() => undefined)
    }
  }
  const makeWindow = (screen = false) => {
    const window = Object.assign(new EventEmitter(), {
      id: ++windows,
      destroyed: false,
      outputs: [] as Output[],
      exits: [] as Exit[],
      starts: [] as Started[],
      isDestroyed: () => window.destroyed,
      send: (channel: string, payload: unknown) => {
        if (channel === `${IPC_CHANNEL_PREFIX}terminal.output`) {
          outputs.push(payload as Output)
          window.outputs.push(payload as Output)
          if (screen) answerCursor(payload as Output, window)
        } else if (channel === `${IPC_CHANNEL_PREFIX}terminal.exit`) {
          exits.push(payload as Exit)
          window.exits.push(payload as Exit)
        } else if (channel === `${IPC_CHANNEL_PREFIX}terminal.started`) window.starts.push(payload as Started)
        else throw new Error(`unexpected event ${channel}`)
      },
      destroy: () => {
        window.destroyed = true
        window.emit('destroyed')
      },
    })
    return window
  }
  const sender = makeWindow(true)
  const call = async (channel: string, input?: unknown, from: ReturnType<typeof makeWindow> = sender): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: APP_URL }, sender: from } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  const ok = async <T>(channel: string, input?: unknown, from?: ReturnType<typeof makeWindow>): Promise<T> => {
    const result = await call(channel, input, from)
    if (!result.ok) throw new Error(result.error)
    return result.value as T
  }
  const text = (nodeId = NODE) =>
    outputs
      .filter((o) => o.nodeId === nodeId)
      .map((o) => o.data)
      .join('')
  const open = (nodeId = NODE, size: { cols: number; rows: number; restart?: boolean; command?: string } = { cols: 80, rows: 24 }, from?: ReturnType<typeof makeWindow>) =>
    ok<OpenResult>('terminal.open', { projectId: PROJECT, nodeId, ...size }, from)
  const type = (data: string, nodeId = NODE, from?: ReturnType<typeof makeWindow>) => ok('terminal.input', { projectId: PROJECT, nodeId, data }, from)
  /** Runs a command and waits for the line its output starts with. */
  const run = async (command: string, expected: RegExp, nodeId = NODE, from?: ReturnType<typeof makeWindow>) => {
    // On a real shell of Windows the first command of each test prints its time to output (ticket 41).
    const timed = WINDOWS && options.spawn === undefined && !firstRunTimed
    firstRunTimed ||= timed
    const started = Date.now()
    let ok = false
    try {
      await type(`${command}\r`, nodeId, from)
      await vi.waitFor(() => expect(text(nodeId)).toMatch(expected), { timeout: 5000 })
      ok = true
    } finally {
      if (timed) process.stdout.write(`[first41] ${JSON.stringify({ test: expect.getState().currentTestName, ms: Date.now() - started, ok })}\n`)
    }
  }
  return { registry, call, ok, open, type, run, text, outputs, exits, sender, makeWindow, nodes, projectRoot, shellSetting }
}

/**
 * The console hosts this process started: one per pseudo-console that is still open. conhost.exe
 * is the one of the system; OpenConsole.exe the one of the node-pty package (useConptyDll).
 */
export function consoleHosts(): number {
  const script = `@(Get-CimInstance -Query "SELECT ProcessId FROM Win32_Process WHERE ParentProcessId = ${process.pid} AND (Name = 'conhost.exe' OR Name = 'OpenConsole.exe')").Count`
  return Number(execFileSync(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }))
}

/** The threads of this process, as Windows counts them. */
export function threads(): number {
  return Number(execFileSync(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid}).Threads.Count`], { encoding: 'utf8' }))
}
