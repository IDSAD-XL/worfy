// A stand-in for the Claude Code process in tests of the relaunch (worfy-week ticket 20, ADR-0064).
// The fake agent (fake-query.ts) has no process, so each of its queries gets a real child process
// (`node -e`, Electron's binary run as Node), started through watchedSpawn — the function the app
// hands the SDK as spawnClaudeCodeProcess — and attached the way the SDK attaches Claude Code: the
// Session learns of it through QueryRequest.spawned, and the query's close() ends its stdin and sends
// SIGTERM, as the SDK's close() does (the SDK sends SIGTERM 2 s after the stdin's end; here at once).
// A query is handed over only once its process says `ready` on stderr — its SIGTERM handler is in
// place by then. Every process also ends by itself after STUB_LIFETIME_MS, and stopAll() kills what
// is left, so a failing test leaves nothing running.
import type { ChildProcess } from 'node:child_process'
import { watchedSpawn } from '../../src/main/agent/options'
import { exitOf } from '../../src/main/agent/session/process'
import type { QueryFactory, QueryRequest } from '../../src/main/agent/session'

/** `ignore-term`: SIGTERM and the stdin's end do not end it, only SIGKILL does; `exit-at-once`: exits when its stdin ends. */
export type StubKind = 'ignore-term' | 'exit-at-once'

/**
 * The signal an `ignore-term` process's exit reports after its Session closed it. On Windows Node's
 * kill() is TerminateProcess whatever the signal: the SIGTERM handler never runs, the process dies at
 * the close's SIGTERM, and its exit reports the signal asked for (SIGTERM) — worfy's SIGKILL at the
 * limit is never needed there. Elsewhere SIGTERM is ignored and only that SIGKILL ends it.
 */
export const IGNORE_TERM_EXIT_SIGNAL: NodeJS.Signals = process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL'

/** How long a stub process lives at most, whatever happens to the test. */
const STUB_LIFETIME_MS = 30_000

/** How long a stub process may take to say `ready`. */
const STUB_READY_MS = 10_000

const READY = `process.stdin.resume(); setTimeout(() => process.exit(3), ${STUB_LIFETIME_MS}); process.stderr.write('ready\\n')`

const SCRIPTS: Record<StubKind, string> = {
  'ignore-term': `process.on('SIGTERM', () => process.stderr.write('SIGTERM ignored\\n')); ${READY}`,
  'exit-at-once': `process.stdin.on('end', () => process.exit(0)); ${READY}`,
}

export interface StubEvent {
  kind: 'spawn' | 'exit'
  /** The process, numbered from 1 in start order. */
  n: number
  /** The signal that ended it (exit). */
  signal?: NodeJS.Signals | null
  at: number
}

/** The stub processes of one test, and what happened to them in order. */
export class StubProcesses {
  readonly events: StubEvent[] = []
  /** What each process wrote to stderr, as its Session got it (QueryRequest.stderr), by process number. */
  readonly stderr = new Map<number, string>()
  /** When its query's close() sent SIGTERM, by process number; kept out of `events`, so order() is unchanged. */
  readonly terminated = new Map<number, number>()
  private readonly children: ChildProcess[] = []

  /** `kind` chooses what the process of the n-th query does. */
  constructor(private readonly kind: (n: number, request: QueryRequest) => StubKind) {}

  /** The fake agent's factory with a real process behind each query. */
  wrap(fake: QueryFactory): QueryFactory {
    return async (request) => {
      const n = this.children.length + 1
      let ready: () => void = () => undefined
      const readySaid = new Promise<void>((done) => {
        ready = done
      })
      const stderr = (data: string): void => {
        this.stderr.set(n, (this.stderr.get(n) ?? '') + data)
        if (this.stderr.get(n)?.includes('ready\n') === true) ready()
        request.stderr(data)
      }
      const start = watchedSpawn((child) => {
        this.children.push(child)
        this.events.push({ kind: 'spawn', n, at: Date.now() })
        // The exit as worfy hears of it (exitOf), asked before the Session asks: the event comes
        // before anything the Session does on it. When the system reports the exit before Node does,
        // the signal is that of the first kill() that took: on Windows the one Node's exit will report.
        let killedBy: NodeJS.Signals | null = null
        const kill = child.kill.bind(child)
        child.kill = (signal?: NodeJS.Signals | number) => {
          const took = kill(signal)
          if (took && killedBy === null && typeof signal === 'string') killedBy = signal
          return took
        }
        void exitOf(child).then(() => this.events.push({ kind: 'exit', n, signal: child.signalCode ?? killedBy, at: Date.now() }))
        request.spawned?.(child)
      }, stderr)
      const sdkSide = start({
        command: process.execPath,
        args: ['-e', SCRIPTS[this.kind(n, request)]],
        cwd: request.cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        signal: new AbortController().signal,
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          readySaid,
          new Promise((_done, fail) => {
            timer = setTimeout(() => fail(new Error(`stub process ${n} did not say ready in ${STUB_READY_MS} ms`)), STUB_READY_MS)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
      const handle = await fake(request)
      const close = handle.close.bind(handle)
      handle.close = () => {
        close()
        sdkSide.stdin.end()
        if (sdkSide.exitCode === null && sdkSide.signalCode == null) {
          this.terminated.set(n, Date.now())
          sdkSide.kill('SIGTERM')
        }
      }
      return handle
    }
  }

  /** The events as `spawn 1`, `exit 1 SIGKILL`, … */
  order(): string[] {
    return this.events.map((event) => (event.kind === 'spawn' ? `spawn ${event.n}` : `exit ${event.n}${event.signal ? ` ${event.signal}` : ''}`))
  }

  /** The most processes alive at one time. */
  maxAlive(): number {
    let alive = 0
    let most = 0
    for (const event of this.events) {
      alive += event.kind === 'spawn' ? 1 : -1
      most = Math.max(most, alive)
    }
    return most
  }

  /** Processes alive now. */
  alive(): number {
    return this.children.filter((child) => child.exitCode === null && child.signalCode === null).length
  }

  /** Kills every process still alive and waits for each exit. */
  async stopAll(): Promise<void> {
    await Promise.all(
      this.children
        .filter((child) => child.exitCode === null && child.signalCode === null)
        .map(
          (child) =>
            new Promise<void>((done) => {
              child.once('exit', () => done())
              child.kill('SIGKILL')
            }),
        ),
    )
  }
}
