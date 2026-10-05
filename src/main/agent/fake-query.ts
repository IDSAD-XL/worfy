// The fake agent (WORFY_AGENT=fake): instead of starting Claude Code, a Session plays a script
// from test/fixtures/agent-scripts/<name>.jsonl. Tests and e2e runs never call the real model.
//
// Each line of a script is either an SDK message, yielded as is, or a directive:
//   {"fake":"account","info":{...}}  what accountInfo() answers (first line only; default: a subscription login)
//   {"fake":"account","error":"..."} accountInfo() rejects with this message (first line only)
//   {"fake":"models","models":[...]} what supportedModels() answers (a head line; default: FAKE_MODELS)
//   {"fake":"commands","commands":[...]} what supportedCommands() answers: rows of {name, description,
//                                    argumentHint} (a head line; default: the slash_commands of the
//                                    script's first system/init, without descriptions)
//   {"fake":"wait_message"}          wait for the next user message (the turn starts)
//   {"fake":"wait_interrupt"}        wait until interrupt() is called
//   {"fake":"stderr","text":"..."}   Claude Code writes this to its stderr
//   {"fake":"crash","error":"..."}   Claude Code dies: the message iterator throws
//   {"fake":"exit"}                  Claude Code exits quietly: the message iterator ends
// In SDK messages, "{{session}}" becomes the SDK session id (a new uuid, or the id passed as
// `resume`) and "{{cwd}}" the Session's cwd. After the last line the script starts over, so one
// script serves any number of turns; it ends when the Session closes its input.
//
// Head lines (account, models, commands) configure the fake agent and are not played; they may
// stand anywhere, the first of each kind counts. A new directive is one entry in DIRECTIVES and,
// for a head line, one field of FakeConfig.
//
// The fake agent reads the Session's input as soon as a message arrives, as Claude Code does, and
// reports what it gets to `record` (FakeQueryOptions): each user message whole — its text, and its
// content as Claude Code got it, image blocks included (ticket 20) —, each control call
// (setModel, setPermissionMode, applyFlagSettings for effort) and the settings it started with.
// After setModel or setPermissionMode, its system/init messages carry the new model and mode, as
// Claude Code's next turn does (ticket 06, question 6). Effort is not in system/init, here as in
// Claude Code.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionSettings } from '../../shared/agent/settings'
import type { CommandInfoLike } from './commands'
import type { AccountInfoLike, ModelInfoLike, QueryFactory, QueryHandle, QueryRequest } from './session'

/** What the fake agent was asked to do, in the order it happened. */
export type FakeCall =
  | { kind: 'start'; resume: string | null; settings: SessionSettings }
  /** `text`: the message's text blocks; `content`: the message content as sent, image blocks included. */
  | { kind: 'message'; text: string; content: unknown }
  | { kind: 'setModel'; model: string | null }
  | { kind: 'setPermissionMode'; mode: string }
  | { kind: 'applyFlagSettings'; settings: Record<string, unknown> }

/** supportedModels() of the fake agent: the shape of SDK 0.3.289, extra keys included. */
export const FAKE_MODELS: ModelInfoLike[] = [
  { value: 'default', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'haiku', displayName: 'Haiku', supportsEffort: false },
].map((model) => ({ ...model, description: `${model.displayName} (fake)`, resolvedModel: `claude-${model.value}-fake` }))

const SUBSCRIPTION: AccountInfoLike = { apiProvider: 'firstParty', subscriptionType: 'Claude Max', tokenSource: 'claude.ai' }

type Account = { info: AccountInfoLike } | { error: string }

/** What the head lines of a script set; absent fields keep the defaults. */
interface FakeConfig {
  account?: Account
  models?: ModelInfoLike[]
  commands?: CommandInfoLike[]
}

/** A line the fake agent plays, in order. */
type Step =
  | { kind: 'message'; message: unknown }
  | { kind: 'wait_message' }
  | { kind: 'wait_interrupt' }
  | { kind: 'stderr'; text: string }
  | { kind: 'crash'; error: string }
  | { kind: 'exit' }

type Line = Step | { kind: 'config'; config: FakeConfig }

/** Each directive of a script (`{"fake": <name>, ...}`) and the line it makes. */
const DIRECTIVES: Record<string, (value: Record<string, unknown>) => Line> = {
  wait_message: () => ({ kind: 'wait_message' }),
  wait_interrupt: () => ({ kind: 'wait_interrupt' }),
  stderr: (value) => ({ kind: 'stderr', text: String(value.text ?? '') }),
  crash: (value) => ({ kind: 'crash', error: String(value.error ?? 'Claude Code crashed') }),
  exit: () => ({ kind: 'exit' }),
  account: (value) => ({ kind: 'config', config: { account: typeof value.error === 'string' ? { error: value.error } : { info: value.info as AccountInfoLike } } }),
  models: (value) => ({ kind: 'config', config: { models: value.models as ModelInfoLike[] } }),
  commands: (value) => ({ kind: 'config', config: { commands: value.commands as CommandInfoLike[] } }),
}

function parseScript(path: string, session: string, cwd: string): Line[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((text, index): Line => {
      const value = JSON.parse(text.replaceAll('{{session}}', session).replaceAll('{{cwd}}', JSON.stringify(cwd).slice(1, -1))) as Record<string, unknown>
      if (value.fake === undefined) return { kind: 'message', message: value }
      const directive = typeof value.fake === 'string' && Object.hasOwn(DIRECTIVES, value.fake) ? DIRECTIVES[value.fake] : undefined
      if (directive === undefined) throw new Error(`${path}:${index + 1}: unknown directive ${JSON.stringify(value.fake)}`)
      return directive(value)
    })
}

/** The head lines of a script, the first of each kind winning. */
function configOf(lines: readonly Line[]): FakeConfig {
  const config: FakeConfig = {}
  for (const line of lines) {
    if (line.kind !== 'config') continue
    for (const [key, value] of Object.entries(line.config) as [keyof FakeConfig, FakeConfig[keyof FakeConfig]][]) {
      if (config[key] === undefined) Object.assign(config, { [key]: value })
    }
  }
  return config
}

const contentOf = (message: unknown): unknown => (message as { message?: { content?: unknown } }).message?.content

/** The text of a user message: the content when it is a string, else its text blocks. */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  return content
    .flatMap((block) => (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text' ? [String((block as { text?: unknown }).text ?? '')] : []))
    .join('\n\n')
}

const isInit = (message: unknown): message is Record<string, unknown> =>
  typeof message === 'object' && message !== null && (message as Record<string, unknown>).type === 'system' && (message as Record<string, unknown>).subtype === 'init'

/** The commands of the script's first system/init, as Claude Code knows them before the first turn. */
function initCommands(steps: readonly Step[]): CommandInfoLike[] {
  const init = steps.find((step) => step.kind === 'message' && isInit(step.message))
  const names = init?.kind === 'message' && isInit(init.message) ? init.message.slash_commands : undefined
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string').map((name) => ({ name, description: '', argumentHint: '' })) : []
}

class FakeQuery implements QueryHandle {
  private closed = false
  private interruptRequested = false
  private wakeInterrupt: (() => void) | null = null
  private readonly steps: Step[]
  private readonly account: Account
  private readonly models: ModelInfoLike[]
  private readonly commands: CommandInfoLike[]
  /** User messages read from the input and not yet taken by a wait_message line. */
  private readonly inbox: unknown[] = []
  private inputEnded = false
  private wakeInbox: (() => void) | null = null
  private reading = false
  private model: string | null
  private permissionMode: string

  constructor(
    path: string,
    private readonly request: QueryRequest,
    private readonly record: (call: FakeCall) => void,
  ) {
    const lines = parseScript(path, request.resume ?? randomUUID(), request.cwd)
    this.steps = lines.filter((line): line is Step => line.kind !== 'config')
    const config = configOf(lines)
    this.account = config.account ?? { info: SUBSCRIPTION }
    this.models = config.models ?? FAKE_MODELS
    this.commands = config.commands ?? initCommands(this.steps)
    this.model = request.settings.model
    this.permissionMode = request.settings.permissionMode
    record({ kind: 'start', resume: request.resume ?? null, settings: { ...request.settings } })
  }

  accountInfo(): Promise<AccountInfoLike> {
    return 'error' in this.account ? Promise.reject(new Error(this.account.error)) : Promise.resolve(this.account.info)
  }

  setModel(model?: string): Promise<void> {
    this.model = model ?? null
    this.record({ kind: 'setModel', model: model ?? null })
    return Promise.resolve()
  }

  setPermissionMode(mode: string): Promise<void> {
    this.permissionMode = mode
    this.record({ kind: 'setPermissionMode', mode })
    return Promise.resolve()
  }

  applyFlagSettings(settings: Record<string, unknown>): Promise<void> {
    this.record({ kind: 'applyFlagSettings', settings: { ...settings } })
    return Promise.resolve()
  }

  supportedModels(): Promise<ModelInfoLike[]> {
    return Promise.resolve(this.models.map((model) => ({ ...model })))
  }

  supportedCommands(): Promise<CommandInfoLike[]> {
    return Promise.resolve(this.commands.map((command) => ({ ...command })))
  }

  /** Reads the Session's input as messages arrive, like Claude Code reading its stdin. */
  private readInput(): void {
    if (this.reading) return
    this.reading = true
    void (async () => {
      try {
        for await (const message of this.request.prompt) {
          const content = contentOf(message)
          this.record({ kind: 'message', text: textOf(content), content })
          this.inbox.push(message)
          this.wake()
        }
      } finally {
        this.inputEnded = true
        this.wake()
      }
    })()
  }

  private wake(): void {
    const resolve = this.wakeInbox
    this.wakeInbox = null
    resolve?.()
  }

  /** Waits for the next user message; false when the input ended or the query closed first. */
  private async nextMessage(): Promise<boolean> {
    while (this.inbox.length === 0) {
      if (this.inputEnded || this.closed) return false
      await new Promise<void>((resolve) => {
        this.wakeInbox = resolve
      })
    }
    this.inbox.shift()
    return !this.closed
  }

  /** A system/init as Claude Code would send it after setModel / setPermissionMode. */
  private current(message: unknown): unknown {
    if (!isInit(message)) return message
    return { ...message, ...(this.model !== null ? { model: this.model } : {}), permissionMode: this.permissionMode }
  }

  interrupt(): Promise<unknown> {
    this.interruptRequested = true
    this.wakeInterrupt?.()
    return Promise.resolve({ still_queued: [] })
  }

  close(): void {
    this.closed = true
    this.wakeInterrupt?.()
    this.wake()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    this.readInput()
    const body = this.steps
    if (body.length === 0) return
    for (;;) {
      for (const line of body) {
        if (this.closed) return
        switch (line.kind) {
          case 'message':
            // Lets the consumer react between messages, as a real stream would.
            await Promise.resolve()
            yield this.current(line.message)
            break
          case 'wait_message':
            if (!(await this.nextMessage())) return
            break
          case 'wait_interrupt':
            if (!this.interruptRequested) {
              await new Promise<void>((resolve) => {
                this.wakeInterrupt = resolve
              })
              this.wakeInterrupt = null
            }
            this.interruptRequested = false
            break
          case 'stderr':
            this.request.stderr(line.text)
            break
          case 'crash':
            throw new Error(line.error)
          case 'exit':
            return
        }
      }
    }
  }
}

export interface FakeQueryOptions {
  scriptsDir: string
  /** The script to play for a request; a test may pick one per Session or per resume. */
  script: string | ((request: QueryRequest) => string)
  /** Gets what every fake query was asked to do (FakeCall). */
  record?: ((call: FakeCall) => void) | undefined
}

export function fakeQueryFactory(options: FakeQueryOptions): QueryFactory {
  const record = options.record ?? (() => {})
  return (request) => {
    const name = typeof options.script === 'string' ? options.script : options.script(request)
    return Promise.resolve(new FakeQuery(join(options.scriptsDir, `${name}.jsonl`), request, record))
  }
}
