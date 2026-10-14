// The Unix socket between the zsh of Terminal Nodes and main (worfy-terminal-ai ticket 03): the
// shell's line editor asks main over it and main answers with what to show (protocol.ts).
//
// The file is `assist.sock` in worfy's ZDOTDIR folder (src/main/terminal/shell-integration.ts): the
// folder is 0700 and the file 0600, and its path fits zsh's zsocket (103 bytes). The server starts
// with the first zsh Terminal. Before every later one the file is looked for again: macOS cleans
// $TMPDIR, and when the file is gone main listens anew, while the shells already connected keep
// their connections.
//
// Every shell gets its own token in its environment. The first message of a connection must be
// `hello` with a token that is alive and not in use; any other connection is closed. A token dies
// with its shell (revoke), and its connection is closed with it. Neither a token nor a line a shell
// sent is ever logged or put into an error.
import { randomBytes } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { SOCKET_PATH_MAX, socketPath } from '../terminal/shell-integration'
import { encodeMessage, MAX_LINE_BYTES, parseShellMessage, type MainMessage, type ShellMessage } from './protocol'

/** How long a new connection has to say hello. */
export const HELLO_TIMEOUT_MS = 5000
/** Messages a shell has not read yet (it reads only while it waits for a key); past this, new ones are dropped. */
export const MAX_UNREAD_BYTES = 256 * 1024

/** What a connected shell sends after its hello. */
export type ShellRequest = Exclude<ShellMessage, { type: 'hello' }>

export interface AssistSocketHandlers {
  /** The shell of `terminal` said hello with its token. */
  connected?: (terminal: string) => void
  message?: (terminal: string, message: ShellRequest) => void
  /** The connection of the shell of `terminal` is closed. */
  disconnected?: (terminal: string) => void
}

export interface AssistSocketOptions extends AssistSocketHandlers {
  helloTimeoutMs?: number
}

/** A shell that was given a token. */
interface Admitted {
  /** The key of the shell's Terminal in the registry. */
  terminal: string
  connection: Socket | null
}

async function isSocket(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSocket()
  } catch {
    return false
  }
}

/** The name of an error, never its message: a message may quote what a shell sent. */
export const errorName = (error: unknown): string => (error instanceof Error ? error.name : typeof error)

export class AssistSocket {
  /** By token. */
  private readonly admitted = new Map<string, Admitted>()
  /** The connected shell of each Terminal. */
  private readonly byTerminal = new Map<string, Admitted>()
  private readonly connections = new Set<Socket>()
  private server: Server | null = null
  private path: string | null = null
  /** One listen at a time: two Terminals starting at once make one server. */
  private opening: Promise<unknown> = Promise.resolve()
  private closed = false
  private readonly helloTimeoutMs: number

  constructor(private readonly options: AssistSocketOptions = {}) {
    this.helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS
  }

  /** Makes sure a server listens on the socket file of the folder `dir`; answers the file's path. */
  listen(dir: string): Promise<string> {
    const listening = this.opening.then(() => this.open(dir))
    this.opening = listening.catch(() => undefined)
    return listening
  }

  private async open(dir: string): Promise<string> {
    if (this.closed) throw new Error('the socket of Terminal AI is closed')
    const path = socketPath(dir)
    if (Buffer.byteLength(path) > SOCKET_PATH_MAX) throw new Error(`the path of the socket of Terminal AI is longer than ${SOCKET_PATH_MAX} bytes`)
    if (this.server !== null && this.path === path && (await isSocket(path))) return path
    // The file is gone, or the folder is a new one. The old server stops taking connections (Node
    // removes its file, if it is still there); the shells connected through it stay connected.
    this.server?.close()
    this.server = null
    this.path = null
    await unlink(path).catch(() => undefined)
    const server = createServer((connection) => this.accept(connection))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.on('error', (error) => console.warn(`[terminal-ai] the socket failed: ${errorName(error)}`))
    try {
      // The folder is 0700 already; the file is the user's alone as well.
      await chmod(path, 0o600)
    } catch (error) {
      server.close()
      throw error
    }
    if (this.closed) {
      server.close()
      throw new Error('the socket of Terminal AI is closed')
    }
    this.server = server
    this.path = path
    return path
  }

  /** A new token for a shell of the Terminal `terminal`; the shell says hello with it. */
  issue(terminal: string): string {
    const token = randomBytes(16).toString('hex')
    this.admitted.set(token, { terminal, connection: null })
    return token
  }

  /** The shell of `token` is gone: the token no longer opens a connection, and the one it opened is closed. */
  revoke(token: string): void {
    const shell = this.admitted.get(token)
    if (shell === undefined) return
    this.admitted.delete(token)
    shell.connection?.destroy()
  }

  /** True while the shell of `terminal` is connected. */
  connected(terminal: string): boolean {
    return this.byTerminal.has(terminal)
  }

  /** The Terminals whose shells are connected. */
  terminals(): string[] {
    return [...this.byTerminal.keys()]
  }

  /** Sends `message` to the shell of `terminal`; false when it is not connected or does not read. */
  send(terminal: string, message: MainMessage): boolean {
    const connection = this.byTerminal.get(terminal)?.connection
    if (connection === null || connection === undefined || connection.destroyed) return false
    const line = encodeMessage(message)
    if (Buffer.byteLength(line) > MAX_LINE_BYTES || connection.writableLength > MAX_UNREAD_BYTES) return false
    connection.write(`${line}\n`)
    return true
  }

  /** Closes the server and every connection and removes the file; for worfy's exit, so it is synchronous. */
  closeSync(): void {
    this.closed = true
    for (const connection of [...this.connections]) connection.destroy()
    this.admitted.clear()
    const { server, path } = this
    this.server = null
    this.path = null
    server?.close()
    if (path === null) return
    try {
      unlinkSync(path)
    } catch {
      // Removed with the server, or with the folder.
    }
  }

  private accept(connection: Socket): void {
    if (this.closed) {
      connection.destroy()
      return
    }
    this.connections.add(connection)
    let unread: Buffer = Buffer.alloc(0)
    let shell: Admitted | null = null
    let warned = false
    const hello = setTimeout(() => connection.destroy(), this.helloTimeoutMs)

    const read = (line: string): void => {
      const message = parseShellMessage(line)
      if (shell === null) {
        const admitted = message?.type === 'hello' ? this.admitted.get(message.token) : undefined
        // No hello, a token nobody was given, the token of a shell that is gone, or of one already connected.
        if (admitted === undefined || admitted.connection !== null) {
          connection.destroy()
          return
        }
        clearTimeout(hello)
        shell = admitted
        admitted.connection = connection
        this.byTerminal.set(admitted.terminal, admitted)
        this.call('connected', admitted.terminal, () => this.options.connected?.(admitted.terminal))
        return
      }
      if (message === null || message.type === 'hello') {
        // Once per connection, and without the line: it may be what the user typed.
        if (!warned) console.warn(`[terminal-ai] the shell of ${shell.terminal} sent a line that is not a message`)
        warned = true
        return
      }
      const { terminal } = shell
      this.call(message.type, terminal, () => this.options.message?.(terminal, message))
    }

    connection.on('data', (chunk: Buffer) => {
      unread = unread.length === 0 ? chunk : Buffer.concat([unread, chunk])
      for (let end = unread.indexOf(0x0a); end !== -1 && !connection.destroyed; end = unread.indexOf(0x0a)) {
        const line = unread.subarray(0, end)
        unread = unread.subarray(end + 1)
        if (line.length > MAX_LINE_BYTES) {
          connection.destroy()
          return
        }
        read(line.toString('utf8'))
      }
      if (unread.length > MAX_LINE_BYTES) connection.destroy()
    })
    // A shell that was killed resets the connection; `close` follows.
    connection.on('error', () => undefined)
    connection.on('close', () => {
      clearTimeout(hello)
      this.connections.delete(connection)
      if (shell === null || shell.connection !== connection) return
      shell.connection = null
      if (this.byTerminal.get(shell.terminal) === shell) this.byTerminal.delete(shell.terminal)
      const { terminal } = shell
      this.call('disconnected', terminal, () => this.options.disconnected?.(terminal))
    })
  }

  /** A handler that throws does not take the connection with it. */
  private call(what: string, terminal: string, handler: () => void): void {
    try {
      handler()
    } catch (error) {
      console.warn(`[terminal-ai] handling ${what} of the shell of ${terminal} failed: ${errorName(error)}`)
    }
  }
}
