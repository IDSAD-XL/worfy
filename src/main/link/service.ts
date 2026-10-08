// The link service (worfy-link ticket 01; ADR-0052): this Machine, its Linked machines, the link
// server and the connections. One per data folder; src/main/index.ts starts the app's one after
// registerIpc, tests start several over temporary folders (test/contract/link-bench.ts).
//
// When the server listens (ADR-0052, point 6: without the user's action worfy does not listen):
// only while it has a reason. The reasons are "at least one Linked machine" (kept by this
// service), "Link a machine is open" (openLinking/closeLinking, the UI of worfy-link ticket 02),
// and "this Machine is linking itself to another" (for the duration of pair(), so the other side
// learns a port that answers). No reason — the server is closed; over a fresh data folder it never
// opens. The switch "Linked machines can work with my Projects" (worfy-link ticket 08) is another
// matter: it decides what a Linked machine may do, not whether the server listens.
//
// The port: the OS picks one on the first listen; it is kept in link/machine.json and asked for
// again on the next start, so a Linked machine finds this one where it was. When it is taken, the
// OS picks a new one, which is kept from then on; the other side learns it from `hello` the next
// time this Machine connects to it, from Bonjour or from an address typed by hand (ticket 02).
//
// Logs (ADR-0052, point 10): no pairing code and no token reaches console.*, an error text, an IPC
// answer or a worfy journal. Messages name a Machine by its id and name.
import { EventEmitter } from 'node:events'
import { hostname as osHostname, networkInterfaces as osNetworkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { WebSocket } from 'ws'
import type { z } from 'zod'
import type { IpcResult } from '../../shared/ipc/channels'
import type { ModuleLoader } from '../ipc/index'
import { dataRoot, type BuildKind } from '../storage/paths'
import { normalizeAddress, type HostNames } from './checks'
import { LinkConnectError, openLinkSocket } from './client'
import { CLOSE_REVOKED, CLOSE_UNLINKED, LinkConnection } from './connection'
import { loadIdentity, MACHINE_KEY, saveIdentity, type MachineIdentity } from './identity'
import { createLinkIpc, LinkSender, type LinkIpcAdapter, type LocalMachine } from './ipc-adapter'
import {
  CONNECT_PATH,
  helloMessage,
  LINK_PROTOCOL_VERSION,
  MessageRegistry,
  PAIR_PATH,
  revokedMessage,
  type Frame,
  type LinkMessage,
  type MessageHandler,
} from './messages'
import {
  initiatePairing,
  PAIRING_CODE_PATTERN,
  PAIRING_CODE_TTL_MS,
  PairingError,
  PairingWindow,
  respondToPairing,
  type Hello,
  type PairingResult,
} from './pairing'
import { FileSecretStore, type SecretStore } from './secrets'
import { startLinkServer, UNAUTHORIZED, type Admission, type LinkServer, type Refusal } from './server'
import { LinkedMachineStore, outgoingTokenKey, tokenHash, type LinkedMachineRecord } from './store'

/** Why the server listens. */
export type ListenReason = 'linked' | 'linking' | 'pairing'

/** What the UI (ticket 02) shows of the service. */
export interface LinkStatus {
  machine: { id: string; name: string }
  listening: boolean
  port: number | null
  /** The last problem of the server (a port it could not take, a key it could not read); null when none. */
  problem: string | null
}

/** A Linked machine as the UI shows it. */
export interface LinkedMachineInfo {
  id: string
  name: string
  address: string
  port: number
  fingerprint: string
  connected: boolean
  /** The last connection attempt met another certificate: the Machine must be linked again. */
  certificateChanged: boolean
}

export interface LinkServiceEvents {
  /** The server started or stopped listening, or met a problem. */
  status: [LinkStatus]
  /** The pairing code changed (opened, burnt, expired, closed); read it with pairingCode(). */
  'pairing-code': []
  /** A pairing attempt on this Machine (as B) failed; the message never carries the code. */
  'pairing-failed': [{ message: string }]
  linked: [LinkedMachineInfo]
  /** A Linked machine was forgotten: revoked here, or the other side revoked this one. */
  unlinked: [{ id: string; name: string; by: 'this-machine' | 'other-machine' }]
  connected: [{ id: string; name: string }]
  disconnected: [{ id: string; name: string }]
  'certificate-changed': [{ id: string; name: string }]
  /** An IPC event pushed by a Linked machine (worfy-link ticket 08 routes them). */
  'ipc-event': [{ machineId: string; channel: string; payload: unknown }]
}

export interface LinkServiceOptions {
  /** worfy's data folder; the link keeps its files in <dataDir>/link. */
  dataDir: string
  buildKind: BuildKind
  /** The build version, `<semver>+<SHA>[.dirty]`, sent in `hello` and named in a protocol mismatch. */
  buildVersion: string
  /** Where the server listens: every interface by default; tests pass 127.0.0.1. */
  listenHost?: string
  hostname?: () => string
  networkInterfaces?: () => HostNames['interfaces']
  now?: () => number
  /** The secret store; the 0600 file in <dataDir>/link by default. */
  secrets?: SecretStore
  /** Handler modules for IPC over the link; every src/main/ipc/<domain>.ts by default. */
  ipcModules?: Record<string, ModuleLoader>
  pingIntervalMs?: number
  codeTtlMs?: number
  pairingStepTimeoutMs?: number
  /** Warnings for the worfy log; console.warn by default. */
  warn?: (message: string) => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Every interface, IPv6 and IPv4; on a system without IPv6, IPv4 only. */
const ALL_INTERFACES = '::'

export class LinkService extends EventEmitter<LinkServiceEvents> {
  private readonly linkDir: string
  private readonly secrets: SecretStore
  private readonly store: LinkedMachineStore
  private readonly messages = new MessageRegistry()
  private readonly pairingWindow: PairingWindow
  private readonly reasons = new Set<ListenReason>()
  private readonly connections = new Map<string, Set<LinkConnection>>()
  private readonly certificateChanged = new Set<string>()
  /** pair() calls running on this side; the 'pairing' reason holds while there is one. */
  private pairingsOut = 0
  /** WebSockets of pairing attempts this side answers; stop() cuts them. */
  private readonly pairingSockets = new Set<WebSocket>()
  private server: LinkServer | null = null
  /** The IPC adapter, made at the first call over the link: a worfy without Linked machines never loads it. */
  private ipc: Promise<LinkIpcAdapter> | undefined
  private listenChain: Promise<void> = Promise.resolve()
  private problem: string | null = null
  private stopped = false
  private readonly warn: (message: string) => void
  private readonly hostname: () => string
  private readonly interfaces: () => HostNames['interfaces']

  private constructor(
    private readonly options: LinkServiceOptions,
    private identity: MachineIdentity,
    secrets: SecretStore,
  ) {
    super()
    this.linkDir = join(options.dataDir, 'link')
    this.secrets = secrets
    this.store = new LinkedMachineStore(this.linkDir)
    this.warn = options.warn ?? ((message) => console.warn(message))
    this.hostname = options.hostname ?? osHostname
    this.interfaces = options.networkInterfaces ?? osNetworkInterfaces
    this.pairingWindow = new PairingWindow(options.now ?? Date.now, options.codeTtlMs ?? PAIRING_CODE_TTL_MS, () => this.emit('pairing-code'))
    this.messages.register(helloMessage, (hello, from) => this.onHello(hello, from.machineId))
    this.messages.register(revokedMessage, (_payload, from) => this.forget(from.machineId, 'other-machine'))
  }

  /** Loads or makes this Machine over the data folder and starts listening when it has Linked machines. */
  static async start(options: LinkServiceOptions): Promise<LinkService> {
    const linkDir = join(options.dataDir, 'link')
    const secrets = options.secrets ?? new FileSecretStore(join(linkDir, 'secrets.json'))
    const warn = options.warn ?? ((message: string) => console.warn(message))
    const identity = await loadIdentity({ linkDir, secrets, hostname: (options.hostname ?? osHostname)(), buildKind: options.buildKind, warn })
    const service = new LinkService(options, identity, secrets)
    service.updateReasons()
    await service.listenChain
    return service
  }

  get machine(): { id: string; name: string } {
    return { id: this.identity.id, name: this.identity.name }
  }

  /** What `link.ping` answers. */
  localMachine(): LocalMachine {
    return { id: this.identity.id, name: this.identity.name, protocol: LINK_PROTOCOL_VERSION, build: this.options.buildVersion }
  }

  status(): LinkStatus {
    return { machine: this.machine, listening: this.server !== null, port: this.server?.port ?? null, problem: this.problem }
  }

  /** Resolves once the server has followed the latest change of reasons. */
  settled(): Promise<void> {
    return this.listenChain
  }

  linkedMachines(): LinkedMachineInfo[] {
    return this.store.list().map((record) => this.info(record))
  }

  // ---- "Link a machine" on this side (B) -------------------------------------------------------

  /** Opens "Link a machine": a code to show, and the server listens. */
  async openLinking(): Promise<void> {
    this.pairingWindow.open()
    this.reasons.add('linking')
    this.updateReasons()
    await this.listenChain
  }

  async closeLinking(): Promise<void> {
    this.pairingWindow.close()
    this.reasons.delete('linking')
    this.updateReasons()
    await this.listenChain
  }

  /** The code "Link a machine" shows and when it expires; null while it is closed. */
  pairingCode(): { code: string; expiresAt: number } | null {
    return this.pairingWindow.code()
  }

  // ---- linking from this side (A) --------------------------------------------------------------

  /** Links this Machine with the one at host:port, whose "Link a machine" shows `code`. */
  async pair(target: { host: string; port: number; code: string }): Promise<LinkedMachineInfo> {
    if (!PAIRING_CODE_PATTERN.test(target.code)) throw new PairingError('the pairing code is six digits')
    this.pairingsOut += 1
    this.reasons.add('pairing')
    this.updateReasons()
    try {
      await this.listenChain
      // The other side stores the port this one listens on: without a server there is none to give.
      if (this.server === null) throw new PairingError(`this Machine cannot listen, so it cannot be linked: ${this.problem ?? 'the link server is not running'}`)
      const key = this.machineKey()
      const { ws, serverFingerprint } = await openLinkSocket({
        host: target.host,
        port: target.port,
        path: PAIR_PATH,
        key,
        certificate: this.identity.certificate,
        ...(this.options.pairingStepTimeoutMs === undefined ? {} : { timeoutMs: this.options.pairingStepTimeoutMs }),
      })
      let stored: LinkedMachineRecord | undefined
      try {
        await initiatePairing(ws, target.code, {
          local: this.hello(),
          clientFingerprint: this.identity.fingerprint,
          serverFingerprint,
          ...(this.options.pairingStepTimeoutMs === undefined ? {} : { stepTimeoutMs: this.options.pairingStepTimeoutMs }),
          commit: (result) => {
            stored = this.commitLink(result, serverFingerprint, normalizeAddress(target.host), result.peer.port ?? target.port)
          },
        })
      } catch (error) {
        ws.terminate()
        throw error
      }
      if (stored === undefined) throw new PairingError('linking ended without a result')
      const info = this.info(stored)
      this.emit('linked', info)
      return info
    } finally {
      this.pairingsOut -= 1
      if (this.pairingsOut === 0) this.reasons.delete('pairing')
      this.updateReasons()
      await this.listenChain
    }
  }

  // ---- connections -----------------------------------------------------------------------------

  /**
   * Connects to Linked machine `machineId` (once per call; reconnecting is ticket 02's). A 401 from
   * a Machine whose certificate checked out means it has forgotten this one: this side forgets it
   * too. Another certificate marks it "certificate changed".
   */
  async connect(machineId: string): Promise<void> {
    const record = this.store.get(machineId)
    if (record === undefined) throw new Error(`Machine ${machineId} is not linked`)
    const token = this.secrets.get(record.outgoingTokenKey)
    if (token === undefined) throw new Error(`the token for Machine ${record.id} (${record.name}) is missing; link it again`)
    let opened: Awaited<ReturnType<typeof openLinkSocket>>
    try {
      opened = await openLinkSocket({
        host: record.address,
        port: record.port,
        path: CONNECT_PATH,
        key: this.machineKey(),
        certificate: this.identity.certificate,
        expectFingerprint: record.fingerprint,
        token,
      })
    } catch (error) {
      if (error instanceof LinkConnectError && error.kind === 'certificate-changed') {
        this.certificateChanged.add(record.id)
        this.emit('certificate-changed', { id: record.id, name: record.name })
      } else if (error instanceof LinkConnectError && error.kind === 'unauthorized') {
        this.forget(record.id, 'other-machine')
      }
      throw error
    }
    this.certificateChanged.delete(record.id)
    if (!this.attach(opened.ws, record, 'out')) throw new Error(`Machine ${record.id} (${record.name}) was unlinked while connecting`)
  }

  /** Calls an IPC channel on Linked machine `machineId` over an open connection. */
  call(machineId: string, channel: string, input?: unknown): Promise<IpcResult<unknown>> {
    const connection = this.openConnection(machineId)
    if (connection === undefined) return Promise.resolve({ ok: false, error: `${channel}: Machine ${machineId} is not connected` })
    return connection.call(channel, input)
  }

  isConnected(machineId: string): boolean {
    return this.openConnection(machineId) !== undefined
  }

  // ---- service messages ------------------------------------------------------------------------

  /** Registers a service message of a module (messages.ts); each name once per service. */
  registerMessage<S extends z.ZodType>(message: LinkMessage<S>, handle: MessageHandler<S>): void {
    this.messages.register(message, handle)
  }

  /** Sends a service message to Linked machine `machineId`; throws when it is not connected. */
  sendMessage<S extends z.ZodType>(machineId: string, message: LinkMessage<S>, payload: z.input<S>): void {
    const parsed = this.messages.outgoing(message, payload)
    const connection = this.openConnection(machineId)
    if (connection === undefined) throw new Error(`link message ${message.name}: Machine ${machineId} is not connected`)
    connection.send({ t: 'msg', name: message.name, payload: parsed })
  }

  // ---- revoking --------------------------------------------------------------------------------

  /**
   * Forgets Linked machine `machineId` (its record, the hash of its token, the token this side
   * presents to it), tells it `revoked` over every open connection and closes them. A Machine that
   * is not connected learns it from a 401 on its next connection.
   */
  revoke(machineId: string): void {
    for (const connection of this.connections.get(machineId) ?? []) {
      connection.send({ t: 'msg', name: revokedMessage.name, payload: {} })
      connection.close(CLOSE_REVOKED, 'revoked')
    }
    this.forget(machineId, 'this-machine')
  }

  /** Closes everything: connections, the server, linking. The files stay. */
  async stop(): Promise<void> {
    this.stopped = true
    for (const set of this.connections.values()) for (const connection of set) connection.terminate()
    this.connections.clear()
    for (const ws of this.pairingSockets) ws.terminate()
    this.pairingSockets.clear()
    this.pairingWindow.close()
    this.reasons.clear()
    this.updateReasons()
    await this.listenChain
  }

  // ---- internals -------------------------------------------------------------------------------

  private machineKey(): string {
    const key = this.secrets.get(MACHINE_KEY)
    if (key === undefined) throw new Error('the key of this Machine is missing from link/secrets.json; restart worfy to make a new one')
    return key
  }

  private hello(): Hello {
    return { ...this.localMachine(), port: this.server?.port ?? this.identity.port }
  }

  private info(record: LinkedMachineRecord): LinkedMachineInfo {
    return {
      id: record.id,
      name: record.name,
      address: record.address,
      port: record.port,
      fingerprint: record.fingerprint,
      connected: this.isConnected(record.id),
      certificateChanged: this.certificateChanged.has(record.id),
    }
  }

  private openConnection(machineId: string): LinkConnection | undefined {
    for (const connection of this.connections.get(machineId) ?? []) if (connection.isOpen) return connection
    return undefined
  }

  /** Stores a finished pairing: the token this side presents first, then the record that names it. */
  private commitLink(result: PairingResult, fingerprint: string, address: string, port: number | null): LinkedMachineRecord {
    if (port === null) throw new PairingError('the other Machine did not say which port it listens on; nothing was linked')
    const key = outgoingTokenKey(result.peer.id)
    this.secrets.set(key, result.outgoingToken)
    const record: LinkedMachineRecord = {
      id: result.peer.id,
      name: result.peer.name,
      address,
      port,
      fingerprint,
      incomingTokenHash: tokenHash(result.incomingToken),
      outgoingTokenKey: key,
      linkedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
    }
    this.store.put(record)
    this.certificateChanged.delete(record.id)
    this.updateReasons()
    return record
  }

  private forget(machineId: string, by: 'this-machine' | 'other-machine'): void {
    const record = this.store.get(machineId)
    for (const connection of this.connections.get(machineId) ?? []) connection.close(by === 'this-machine' ? CLOSE_REVOKED : CLOSE_UNLINKED, 'unlinked')
    if (record === undefined) return
    this.store.remove(machineId)
    this.secrets.delete(record.outgoingTokenKey)
    this.certificateChanged.delete(machineId)
    this.warn(`[link] Machine ${record.id} (${record.name}) is no longer linked (${by === 'this-machine' ? 'revoked on this Machine' : 'revoked by that Machine'})`)
    this.emit('unlinked', { id: record.id, name: record.name, by })
    this.updateReasons()
  }

  /**
   * Takes an established WebSocket of a Linked machine into service; false (and the socket closed)
   * when the Machine was forgotten while the handshake ran, or the service stopped.
   */
  private attach(ws: WebSocket, record: LinkedMachineRecord, direction: 'in' | 'out'): boolean {
    if (this.stopped || this.store.get(record.id) === undefined) {
      ws.close(CLOSE_UNLINKED, 'unlinked')
      return false
    }
    const connection = new LinkConnection(ws, record.id, direction, {
      ...(this.options.pingIntervalMs === undefined ? {} : { pingIntervalMs: this.options.pingIntervalMs }),
      warn: this.warn,
    })
    const sender = new LinkSender(record.id, (channel, payload) => connection.send({ t: 'event', channel, payload }), () => this.localMachine())
    let set = this.connections.get(record.id)
    if (set === undefined) {
      set = new Set()
      this.connections.set(record.id, set)
    }
    set.add(connection)
    connection.on('frame', (frame) => void this.onFrame(connection, sender, frame))
    connection.once('close', () => {
      sender.destroy()
      const current = this.connections.get(record.id)
      current?.delete(connection)
      if (current?.size === 0) this.connections.delete(record.id)
      const name = this.store.get(record.id)?.name ?? record.name
      if (!this.isConnected(record.id)) this.emit('disconnected', { id: record.id, name })
    })
    connection.send({ t: 'msg', name: helloMessage.name, payload: this.messages.outgoing(helloMessage, this.hello()) })
    this.emit('connected', { id: record.id, name: record.name })
    return true
  }

  private async onFrame(connection: LinkConnection, sender: LinkSender, frame: Frame): Promise<void> {
    // A Machine forgotten meanwhile gets nothing more from this side.
    if (this.store.get(connection.machineId) === undefined) {
      connection.close(CLOSE_UNLINKED, 'unlinked')
      return
    }
    switch (frame.t) {
      case 'msg':
        await this.messages.dispatch(frame.name, frame.payload, { machineId: connection.machineId }, this.warn)
        return
      case 'call': {
        const result = await this.ipcAdapter().then(
          (adapter) => adapter.call(sender, frame.channel, frame.input),
          (error: unknown): IpcResult<unknown> => ({ ok: false, error: `${frame.channel}: IPC over the link is unavailable (${messageOf(error)})` }),
        )
        connection.send({ t: 'result', id: frame.id, result })
        return
      }
      case 'event':
        this.emit('ipc-event', { machineId: connection.machineId, channel: frame.channel, payload: frame.payload })
        return
      case 'result':
        return
    }
  }

  private onHello(hello: Hello, machineId: string): void {
    if (hello.id !== machineId) {
      this.warn(`[link] Machine ${machineId} introduced itself as ${hello.id}; the connection is closed`)
      for (const connection of this.connections.get(machineId) ?? []) connection.close(CLOSE_UNLINKED, 'wrong machine')
      return
    }
    this.store.touch(machineId, { name: hello.name, ...(hello.port === null ? {} : { port: hello.port }) })
  }

  /** The IPC handlers for calls over the link, registered on first use; a failure stays and answers every call. */
  private ipcAdapter(): Promise<LinkIpcAdapter> {
    this.ipc ??= createLinkIpc({
      ...(this.options.ipcModules === undefined ? {} : { modules: this.options.ipcModules }),
      isLinked: (machineId) => this.store.get(machineId) !== undefined,
    })
    return this.ipc
  }

  /** The server's endpoint checks after the common ones (server.ts). */
  private admit(upgrade: { path: string; clientFingerprint: string | undefined; remoteAddress: string; token: string | undefined }): Refusal | Admission {
    if (upgrade.path === PAIR_PATH) {
      if (upgrade.clientFingerprint === undefined) return { status: 403, body: 'linking needs the client certificate of the other worfy' }
      const refusal = this.pairingWindow.begin()
      if (refusal !== null) return { status: refusal.startsWith('another') ? 409 : 403, body: refusal }
      const clientFingerprint = upgrade.clientFingerprint
      return { accept: (ws) => void this.respond(ws, clientFingerprint, upgrade.remoteAddress), abort: () => this.endAttempt(false) }
    }
    if (upgrade.token === undefined) return UNAUTHORIZED
    const record = this.store.byToken(upgrade.token)
    // The token and the certificate must both be the ones of one Linked machine.
    if (record === undefined || record.fingerprint !== upgrade.clientFingerprint) return UNAUTHORIZED
    return {
      accept: (ws) => {
        this.store.touch(record.id, { address: upgrade.remoteAddress })
        this.attach(ws, record, 'in')
      },
      abort: () => undefined,
    }
  }

  private async respond(ws: WebSocket, clientFingerprint: string, remoteAddress: string): Promise<void> {
    let stored: LinkedMachineRecord | undefined
    this.pairingSockets.add(ws)
    try {
      await respondToPairing(ws, () => this.pairingWindow.take(), {
        local: this.hello(),
        clientFingerprint,
        serverFingerprint: this.identity.fingerprint,
        ...(this.options.pairingStepTimeoutMs === undefined ? {} : { stepTimeoutMs: this.options.pairingStepTimeoutMs }),
        commit: (result) => {
          stored = this.commitLink(result, clientFingerprint, remoteAddress, result.peer.port)
        },
      })
      ws.close(1000, 'linked')
      if (stored !== undefined) this.emit('linked', this.info(stored))
    } catch (error) {
      ws.terminate()
      const message = error instanceof PairingError ? error.message : `linking failed: ${messageOf(error)}`
      this.warn(`[link] a pairing attempt from ${remoteAddress} failed: ${message}`)
      this.emit('pairing-failed', { message })
    } finally {
      this.pairingSockets.delete(ws)
      this.endAttempt(stored !== undefined)
    }
  }

  /** Ends a pairing attempt; too many failures in a row close "Link a machine" (pairing.ts). */
  private endAttempt(succeeded: boolean): void {
    if (this.pairingWindow.end(succeeded) === 'closed' && this.reasons.has('linking')) {
      this.warn('[link] "Link a machine" closed after too many failed pairing attempts')
      this.emit('pairing-failed', { message: 'too many failed pairing attempts; "Link a machine" was closed' })
      this.reasons.delete('linking')
      this.updateReasons()
    }
  }

  /** Recomputes the reasons from the state and makes the server follow them. */
  private updateReasons(): void {
    if (this.store.list().length > 0 && !this.stopped) this.reasons.add('linked')
    else this.reasons.delete('linked')
    this.listenChain = this.listenChain.then(() => this.applyListening())
  }

  private async applyListening(): Promise<void> {
    const want = this.reasons.size > 0 && !this.stopped
    if (want && this.server === null) {
      try {
        this.server = await this.listen()
        this.problem = null
        if (this.identity.port !== this.server.port) {
          this.identity = { ...this.identity, port: this.server.port }
          saveIdentity(this.linkDir, this.identity)
        }
      } catch (error) {
        this.problem = `the link server could not start: ${messageOf(error)}`
        this.warn(`[link] ${this.problem}`)
      }
      this.emit('status', this.status())
    } else if (!want && this.server !== null) {
      this.server.close()
      this.server = null
      this.emit('status', this.status())
    }
  }

  /** Listens on the kept port, or on a new one the OS picks when that one is taken. */
  private async listen(): Promise<LinkServer> {
    const key = this.machineKey()
    const hosts = this.options.listenHost === undefined ? [ALL_INTERFACES, '0.0.0.0'] : [this.options.listenHost]
    let lastError: unknown
    for (const host of hosts) {
      for (const port of this.identity.port === null ? [0] : [this.identity.port, 0]) {
        try {
          return await startLinkServer({
            key,
            certificate: this.identity.certificate,
            host,
            port,
            build: this.options.buildVersion,
            hostNames: () => ({ interfaces: this.interfaces(), hostname: this.hostname() }),
            admit: (upgrade) => this.admit(upgrade),
          })
        } catch (error) {
          lastError = error
          const code = error instanceof Error && 'code' in error ? error.code : undefined
          // A taken port: the next one is the OS's pick. No IPv6: the next host is IPv4.
          if (code === 'EADDRINUSE') continue
          if (code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL') break
          throw error
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('could not listen')
  }
}

// ---- the app's service ---------------------------------------------------------------------------

let appService: LinkService | undefined
let appProblem: string | undefined

/** The app's link service; undefined before its start finished, or when it failed. */
export function appLinkService(): LinkService | undefined {
  return appService
}

/** Why the app's link service is not running, for the UI of ticket 02; undefined when it runs. */
export function appLinkProblem(): string | undefined {
  return appProblem
}

/** Starts the app's link service over worfy's data folder (src/main/index.ts, after registerIpc). */
export async function startAppLink(options: { buildKind: BuildKind; buildVersion: string }): Promise<LinkService> {
  try {
    appService = await LinkService.start({ dataDir: dataRoot(), ...options })
    appProblem = undefined
    return appService
  } catch (error) {
    appProblem = `the link service could not start: ${messageOf(error)}`
    throw error
  }
}
