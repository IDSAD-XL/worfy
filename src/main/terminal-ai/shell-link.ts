// The route between the zsh of Terminal Nodes and the features of Terminal AI in main
// (worfy-terminal-ai ticket 03), over the socket of socket.ts with the messages of protocol.ts.
//
//   - push(terminal, message) sends a message to the shell of a Terminal; a shell that is not
//     connected gets nothing.
//   - An `ask` of a shell goes to the handler of its feature: a module of ./features/, found by
//     itself (as src/main/ipc/index.ts finds the handlers of IPC). A feature adds its own file
//     there and does not change this one. Its default export is a ShellFeature.
//   - The settings of Terminal AI go to every shell as `config`: when it connects, and when they
//     change.
//
// A Terminal here is the key of its shell in the registry of Terminal Nodes (terminalKey of
// src/main/ipc/terminal.ts). Nothing in this file runs a command or types into a Terminal: what a
// feature answers lands in the line the user is editing, and Enter stays the user's.
import type { ShellState } from '../terminal/osc'
import type { AssistAdmission } from '../terminal/shell-integration'
import { featureEnabled, TERMINAL_AI_FEATURES, type TerminalAiSettings } from '../../shared/terminal-ai/settings'
import type { AssistService } from './assist'
import { isFeatureName, type MainMessage } from './protocol'
import { AssistSocket, errorName, type ShellRequest } from './socket'

/** The Suggestion from the history of commands in `config`: the shell makes it itself, without main. */
export const HISTORY_FEATURE = 'history'

/** One `ask` of a shell. */
export interface ShellAsk {
  terminal: string
  id: number
  /** The line being edited, as the shell sent it. */
  line: string
  /** Aborted when the shell cancels the ask, asks again or disconnects. */
  signal: AbortSignal
}

/** The answers to one ask; each is dropped once the ask is aborted. False: not sent. */
export interface ShellReply {
  /** Grey text after the line, taken with →. */
  show(text: string): boolean
  /** A short grey note instead ("asking Claude…"); an empty text takes it away. */
  status(text: string): boolean
  /** The line becomes `text`. Nothing is run. */
  insert(text: string): boolean
}

/** What main gives a feature besides the ask. */
export interface FeatureContext {
  /** What the shell integration knows of the Terminal's shell; null when it has no integration or is gone. */
  shellState(terminal: string): ShellState | null
  /** The assist service: the model, the settings, the Limits. */
  assist(): Promise<AssistService>
}

/** The default export of a module of ./features/. */
export interface ShellFeature {
  /** The name in `ask <id> <feature> <line>`. */
  feature: string
  ask(ask: ShellAsk, reply: ShellReply, context: FeatureContext): void | Promise<void>
}

/** Loads one module of ./features/, as import.meta.glob returns it. */
export type FeatureLoader = () => Promise<unknown>

/** src/main/terminal-ai/features/<feature>.ts. */
export const featureModules: Record<string, FeatureLoader> = import.meta.glob('./features/*.ts', { import: 'default' })

function isShellFeature(value: unknown): value is ShellFeature {
  if (typeof value !== 'object' || value === null) return false
  const { feature, ask } = value as Partial<ShellFeature>
  return typeof feature === 'string' && isFeatureName(feature) && typeof ask === 'function'
}

/** The settings of Terminal AI as the link reads them. */
export interface SettingsSource {
  current(): TerminalAiSettings
  /** Calls `listener` when the settings may have changed; answers the unsubscribe. */
  subscribe(listener: () => void): () => void
}

/**
 * The features a shell is told are on. The Suggestion from history goes by the switches
 * "Terminal AI" and "Suggestion" alone: "Ask Claude when history has nothing" turns off only the
 * model behind it (`suggest`).
 */
export function configFeatures(settings: TerminalAiSettings): string[] {
  const history = settings.enabled && settings.suggestion ? [HISTORY_FEATURE] : []
  return [...history, ...TERMINAL_AI_FEATURES.filter((feature) => featureEnabled(settings, feature))]
}

export interface ShellLinkOptions {
  /** Asked when the first shell connects. */
  settings: () => Promise<SettingsSource>
  context: FeatureContext
  /** The modules of the features; those of ./features/ by default. */
  features?: Record<string, FeatureLoader>
  helloTimeoutMs?: number
}

export class ShellLink {
  private readonly socket: AssistSocket
  private features: Promise<Map<string, ShellFeature>> | null = null
  private source: Promise<SettingsSource | null> | null = null
  private unsubscribe: (() => void) | null = null
  /** The `config` last sent to every shell. */
  private config: string | null = null
  /** The open ask of each Terminal. */
  private readonly open = new Map<string, { id: number; abort: AbortController }>()
  private closed = false

  constructor(private readonly options: ShellLinkOptions) {
    this.socket = new AssistSocket({
      connected: (terminal) => void this.greet(terminal),
      message: (terminal, message) => this.receive(terminal, message),
      disconnected: (terminal) => this.abort(terminal),
      ...(options.helloTimeoutMs === undefined ? {} : { helloTimeoutMs: options.helloTimeoutMs }),
    })
  }

  /** For a new zsh of `terminal` with the integration: the socket to connect to and the shell's own token. */
  async admit(terminal: string, dir: string): Promise<AssistAdmission> {
    const socket = await this.socket.listen(dir)
    return { socket, token: this.socket.issue(terminal) }
  }

  /** The shell of `token` is gone. */
  revoke(token: string): void {
    this.socket.revoke(token)
  }

  /** True while the shell of `terminal` is connected. */
  connected(terminal: string): boolean {
    return this.socket.connected(terminal)
  }

  /** Sends `message` to the shell of `terminal`; a shell that is not connected is passed over (false). */
  push(terminal: string, message: MainMessage): boolean {
    return !this.closed && this.socket.send(terminal, message)
  }

  /** Closes the socket; for worfy's exit, so it is synchronous. */
  closeSync(): void {
    this.closed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const terminal of [...this.open.keys()]) this.abort(terminal)
    this.socket.closeSync()
  }

  // ---- the settings --------------------------------------------------------------------------------

  private settings(): Promise<SettingsSource | null> {
    this.source ??= this.options.settings().then(
      (source) => {
        if (this.closed) return null
        this.unsubscribe = source.subscribe(() => this.settingsChanged(source))
        return source
      },
      (error: unknown) => {
        // The shell keeps what it does without a `config`: the Suggestion from history.
        console.warn('[terminal-ai] the settings could not be read for the shells', error)
        this.source = null
        return null
      },
    )
    return this.source
  }

  /** A shell that just connected is told the settings. */
  private async greet(terminal: string): Promise<void> {
    const source = await this.settings()
    if (source === null) return
    const features = configFeatures(source.current())
    this.config ??= features.join(' ')
    this.push(terminal, { type: 'config', features })
  }

  /** The source calls on every change of the assist service's state; a `config` goes out only when it differs. */
  private settingsChanged(source: SettingsSource): void {
    const features = configFeatures(source.current())
    const config = features.join(' ')
    if (config === this.config) return
    this.config = config
    for (const terminal of this.socket.terminals()) this.push(terminal, { type: 'config', features })
  }

  // ---- the asks ------------------------------------------------------------------------------------

  private loadFeatures(): Promise<Map<string, ShellFeature>> {
    this.features ??= (async () => {
      const found = new Map<string, ShellFeature>()
      for (const [path, load] of Object.entries(this.options.features ?? featureModules).sort(([a], [b]) => a.localeCompare(b))) {
        try {
          const module = await load()
          if (!isShellFeature(module)) console.warn(`[terminal-ai] ${path} does not export a feature`)
          else if (found.has(module.feature)) console.warn(`[terminal-ai] ${path}: the feature ${module.feature} has a handler already`)
          else found.set(module.feature, module)
        } catch (error) {
          console.warn(`[terminal-ai] ${path} could not be loaded`, error)
        }
      }
      return found
    })()
    return this.features
  }

  private abort(terminal: string): void {
    const open = this.open.get(terminal)
    if (open === undefined) return
    this.open.delete(terminal)
    open.abort.abort()
  }

  private receive(terminal: string, message: ShellRequest): void {
    if (message.type === 'cancel') {
      if (this.open.get(terminal)?.id === message.id) this.abort(terminal)
      return
    }
    // One ask per shell: a new one takes the place of the one before it.
    this.abort(terminal)
    const abort = new AbortController()
    this.open.set(terminal, { id: message.id, abort })
    void this.ask(terminal, message, abort.signal)
  }

  private async ask(terminal: string, message: Extract<ShellRequest, { type: 'ask' }>, signal: AbortSignal): Promise<void> {
    const { id, feature } = message
    const send = (answer: MainMessage): boolean => !signal.aborted && this.push(terminal, answer)
    const reply: ShellReply = {
      show: (text) => send({ type: 'show', id, text }),
      status: (text) => send({ type: 'status', id, text }),
      insert: (text) => send({ type: 'insert', text }),
    }
    try {
      const handler = (await this.loadFeatures()).get(feature)
      // A feature whose module is not there yet: the shell hears nothing, as when the model has no answer.
      if (handler === undefined || signal.aborted) return
      await handler.ask({ terminal, id, line: message.line, signal }, reply, this.options.context)
    } catch (error) {
      // Only the name of the error: its message may quote the line.
      console.warn(`[terminal-ai] the feature ${feature} failed on an ask of ${terminal}: ${errorName(error)}`)
    }
  }
}
