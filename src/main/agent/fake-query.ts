// The fake agent (WORFY_AGENT=fake): instead of starting Claude Code, a Session plays a script
// from test/fixtures/agent-scripts/<name>.jsonl. Tests and e2e runs never call the real model.
//
// Each line of a script is either an SDK message, yielded as is, or a directive:
//   {"fake":"account","info":{...}}  what accountInfo() answers (first line only; default: a subscription login)
//   {"fake":"wait_message"}          wait for the next user message (the turn starts)
//   {"fake":"wait_interrupt"}        wait until interrupt() is called
//   {"fake":"crash","error":"..."}   Claude Code dies: the message iterator throws
// In SDK messages, "{{session}}" becomes the SDK session id (a new uuid, or the id passed as
// `resume`) and "{{cwd}}" the Session's cwd. After the last line the script starts over, so one
// script serves any number of turns; it ends when the Session closes its input.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountInfoLike, QueryFactory, QueryHandle, QueryRequest } from './session'

const SUBSCRIPTION: AccountInfoLike = { apiProvider: 'firstParty', subscriptionType: 'Claude Max', tokenSource: 'claude.ai' }

type Line = { kind: 'message'; message: unknown } | { kind: 'wait_message' } | { kind: 'wait_interrupt' } | { kind: 'crash'; error: string } | { kind: 'account'; info: AccountInfoLike }

function parseScript(path: string, session: string, cwd: string): Line[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((text, index): Line => {
      const value = JSON.parse(text.replaceAll('{{session}}', session).replaceAll('{{cwd}}', JSON.stringify(cwd).slice(1, -1))) as Record<string, unknown>
      switch (value.fake) {
        case undefined:
          return { kind: 'message', message: value }
        case 'wait_message':
          return { kind: 'wait_message' }
        case 'wait_interrupt':
          return { kind: 'wait_interrupt' }
        case 'crash':
          return { kind: 'crash', error: String(value.error ?? 'Claude Code crashed') }
        case 'account':
          return { kind: 'account', info: value.info as AccountInfoLike }
        default:
          throw new Error(`${path}:${index + 1}: unknown directive ${JSON.stringify(value.fake)}`)
      }
    })
}

class FakeQuery implements QueryHandle {
  private closed = false
  private interruptRequested = false
  private wakeInterrupt: (() => void) | null = null
  private readonly lines: Line[]
  private readonly account: AccountInfoLike

  constructor(
    path: string,
    private readonly request: QueryRequest,
  ) {
    this.lines = parseScript(path, request.resume ?? randomUUID(), request.cwd)
    const first = this.lines[0]
    this.account = first?.kind === 'account' ? first.info : SUBSCRIPTION
  }

  accountInfo(): Promise<AccountInfoLike> {
    return Promise.resolve(this.account)
  }

  interrupt(): Promise<unknown> {
    this.interruptRequested = true
    this.wakeInterrupt?.()
    return Promise.resolve({ still_queued: [] })
  }

  close(): void {
    this.closed = true
    this.wakeInterrupt?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    const input = this.request.prompt[Symbol.asyncIterator]()
    const body = this.lines.filter((line) => line.kind !== 'account')
    if (body.length === 0) return
    for (;;) {
      for (const line of body) {
        if (this.closed) return
        switch (line.kind) {
          case 'message':
            // Lets the consumer react between messages, as a real stream would.
            await Promise.resolve()
            yield line.message
            break
          case 'wait_message': {
            const next = await input.next()
            if (next.done || this.closed) return
            break
          }
          case 'wait_interrupt':
            if (!this.interruptRequested) {
              await new Promise<void>((resolve) => {
                this.wakeInterrupt = resolve
              })
              this.wakeInterrupt = null
            }
            this.interruptRequested = false
            break
          case 'crash':
            throw new Error(line.error)
        }
      }
    }
  }
}

export interface FakeQueryOptions {
  scriptsDir: string
  /** The script to play for a request; a test may pick one per Session or per resume. */
  script: string | ((request: QueryRequest) => string)
}

export function fakeQueryFactory(options: FakeQueryOptions): QueryFactory {
  return (request) => {
    const name = typeof options.script === 'string' ? options.script : options.script(request)
    return Promise.resolve(new FakeQuery(join(options.scriptsDir, `${name}.jsonl`), request))
  }
}
