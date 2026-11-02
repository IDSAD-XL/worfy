// One `codex app-server` process of a Session (worfy-multi-vendor ticket 19; spec, the process of a
// Session): there is no shared process, each Session starts its own and closes it. The process starts
// through launch.ts (the pinned binary, or the fake under WORFY_CODEX=fake), without a shell on every
// system, and speaks JSON-RPC over its stdio through rpc.ts.
//
// The start is the handshake of the app-server: `initialize` with clientInfo.name "worfy" (by the
// `originator` it derives from that name worfy knows its own threads, ticket 05) and no capabilities —
// so no experimentalApi, and the server refuses experimental methods instead of worfy leaning on them
// unnoticed (ticket 02) — then the `initialized` notification.
//
// stderr is kept (its last STDERR_KEPT characters) to explain a crash: a process that exits rejects
// every request still waiting with CodexAppServerExit, which carries its exit code and that stderr.
// close() ends stdin, the app-server's way to stop, and waits for the exit as a Session waits for its
// Claude Code process (ADR-0064, src/main/agent/session/process.ts): SIGKILL after EXIT_WAIT_MS, then
// KILL_EXIT_MS more, and on Windows it asks the system for the exit too, since Node's `exit` event
// can come seconds after it.
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { EXIT_WAIT_MS, hasExited, KILL_EXIT_MS, stopWaiting, waitForExit, within } from '../../agent/session/process'
import { startCodexAppServer, type CodexLaunchOptions, type SpawnProcess } from './launch'
import type { InitializeResponse } from './protocol/ts/InitializeResponse'
import type { RequestId } from './protocol/ts/RequestId'
import { CodexRpc, type ClientMethod, type CodexRpcEvent, type CodexRpcOptions, type ParamsOf } from './rpc'

/** How much of the end of stderr a process keeps, in characters. */
export const STDERR_KEPT = 16_000

/**
 * After the exit, how long the rejection of the waiting requests waits for the end of stdout and
 * stderr: the last lines a crashing process wrote still arrive, and its stderr is whole in the error. A
 * pipe a child of the process holds open would never end, so the wait is bounded.
 */
export const OUTPUT_AFTER_EXIT_MS = 1_000

/** The error waiting requests get when the process is gone: how it ended and the end of its stderr. */
export class CodexAppServerExit extends Error {
  constructor(
    readonly code: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
  ) {
    const how = signal !== null ? `was stopped by ${signal}` : `exited with code ${code ?? 'unknown'}`
    const tail = stderr.trim()
    super(`Codex app-server ${how}${tail === '' ? '' : `; its stderr: ${tail}`}`)
    this.name = 'CodexAppServerExit'
  }
}

export interface CodexAppServerOptions extends CodexLaunchOptions {
  /** The Session's folder: the process's working directory. */
  cwd: string
  /** worfy's version, as clientInfo.version (app.getVersion()). */
  clientVersion: string
  /** Every notification, server→client request, unknown message and broken line, in order. */
  onEvent: (event: CodexRpcEvent) => void
  log?: CodexRpcOptions['log']
  /** How long a request waits for its answer; rpc.ts's REQUEST_TIMEOUT_MS by default. */
  timeoutMs?: number
  /** child_process.spawn by default; tests pass one that starts the fake under node. */
  spawnProcess?: SpawnProcess
}

/** A running app-server, past its handshake. */
export class CodexAppServer {
  /** The process, for the Session to watch (AgentProcess). */
  readonly process: ChildProcess
  private readonly rpc: CodexRpc
  private stderrText = ''
  private closing: Promise<void> | undefined
  private readonly warn: (line: string) => void
  /** What `initialize` answered; set by start(). */
  private initializeResult: InitializeResponse | undefined

  private constructor(options: CodexAppServerOptions) {
    this.warn = options.log ?? ((line) => console.warn(`[codex] ${line}`))
    const child = startCodexAppServer(options, options.spawnProcess)
    this.process = child
    this.rpc = new CodexRpc({
      write: (line) => {
        if (child.stdin?.writable === true) child.stdin.write(line)
      },
      onEvent: options.onEvent,
      log: options.log,
      timeoutMs: options.timeoutMs,
    })
    // A write to a process that is gone fails with EPIPE; its exit rejects the waiting requests.
    child.stdin?.on('error', (error) => this.warn(`stdin of the app-server ${child.pid ?? ''}: ${error.message}`))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderrText = (this.stderrText + chunk).slice(-STDERR_KEPT)
    })
    if (child.stdout !== null) createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => this.rpc.receive(line))
    const outputClosed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.once('exit', (code, signal) => {
      void within(outputClosed, OUTPUT_AFTER_EXIT_MS).then(() => this.rpc.fail(new CodexAppServerExit(code, signal, this.stderrText)))
    })
    child.on('error', (error) => {
      // A process that never started (no pid) has no exit to wait for; any other error (a kill that
      // failed) leaves the process to its exit.
      if (child.pid === undefined) this.rpc.fail(new Error(`Codex app-server did not start: ${error.message}`))
      else this.warn(`the app-server ${child.pid}: ${error.message}`)
    })
  }

  /**
   * Starts an app-server and makes its handshake. Rejects, with the process closed, when the start or
   * `initialize` fails; throws at once when launch.ts refuses (no Codex for this platform, the real
   * Codex under vitest).
   */
  static async start(options: CodexAppServerOptions): Promise<CodexAppServer> {
    const server = new CodexAppServer(options)
    try {
      server.initializeResult = await server.request<InitializeResponse>('initialize', {
        clientInfo: { name: 'worfy', title: 'worfy', version: options.clientVersion },
        capabilities: null,
      })
    } catch (error) {
      await server.close()
      throw error
    }
    server.rpc.notify('initialized')
    return server
  }

  /** What the app-server answered to `initialize`: its CODEX_HOME, platform and user agent. */
  get initialized(): InitializeResponse {
    return this.initializeResult as InitializeResponse
  }

  request<R = unknown, M extends ClientMethod = ClientMethod>(method: M, params: ParamsOf<M>, timeoutMs?: number): Promise<R> {
    return this.rpc.request<R, M>(method, params, timeoutMs)
  }

  /** Answers a server→client request (an approval, a question). */
  respond(id: RequestId, result: unknown): void {
    this.rpc.respond(id, result)
  }

  respondError(id: RequestId, code: number, message: string): void {
    this.rpc.respondError(id, code, message)
  }

  /** The end of what the process wrote to stderr so far. */
  get stderr(): string {
    return this.stderrText
  }

  /**
   * Ends the process and settles once it has exited: the waiting requests are rejected, stdin is
   * ended; a process alive `killAfterMs` later gets SIGKILL and KILL_EXIT_MS more, and one that outlives
   * even that is left with a warning, so the caller is never held for good. Never rejects; every call
   * waits for the same exit.
   */
  close(killAfterMs = EXIT_WAIT_MS): Promise<void> {
    this.closing ??= this.stop(killAfterMs)
    return this.closing
  }

  private async stop(killAfterMs: number): Promise<void> {
    const child = this.process
    this.rpc.fail(new Error('the Codex app-server was closed'))
    child.stdin?.end()
    if (hasExited(child) || (await within(waitForExit(child), killAfterMs))) return
    this.warn(`the app-server ${child.pid ?? ''} did not exit ${killAfterMs} ms after its stdin was closed; sending SIGKILL`)
    try {
      child.kill('SIGKILL')
    } catch (error) {
      this.warn(`could not kill the app-server ${child.pid ?? ''}: ${(error as Error).message}`)
    }
    if (!(await within(waitForExit(child), KILL_EXIT_MS))) {
      this.warn(`the app-server ${child.pid ?? ''} did not exit after SIGKILL; going on without it`)
      stopWaiting(child)
    }
  }
}
