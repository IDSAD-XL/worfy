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
//
// The app's link (bottom of this file, worfy-link ticket 02) adds what a running worfy needs around
// the service: the connections kept to every Linked machine (connections.ts), Bonjour
// (discovery.ts), and (worfy-link ticket 14) "going to sleep" (sleep-notice.ts) and the keep-awake
// while Linked machines are connected (keep-awake.ts). Two environment variables shape it: WORFY_LINK_HOST is the one address the server
// listens on (e2e tests set 127.0.0.1, so the macOS firewall never asks about incoming
// connections), and WORFY_LINK_BONJOUR=0 turns Bonjour off (e2e tests, so macOS never asks for
// the Local Network permission during a run).
import { EventEmitter } from 'node:events'
import { hostname as osHostname, networkInterfaces as osNetworkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { WebSocket } from 'ws'
import type { z } from 'zod'
import type { IpcResult } from '../../shared/ipc/channels'
import type { Client } from '../clients'
import type { ModuleLoader } from '../ipc/index'
import { dataRoot, type BuildKind } from '../storage/paths'
import { normalizeAddress, type HostNames } from './checks'
import { LinkConnectError, openLinkSocket } from './client'
import { CLOSE_REVOKED, CLOSE_UNLINKED, LinkConnection } from './connection'
import { LinkConnections } from './connections'
import { bonjourBackend, LinkDiscovery } from './discovery'
import { loadIdentity, MACHINE_KEY, saveIdentity, type MachineIdentity } from './identity'
import { createLinkIpc, LinkPeer, type LinkIpcAdapter, type LocalMachine } from './ipc-adapter'
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
import { LinkSettings, type LinkSettingsValue } from './settings'
import { SleepNotice, type PowerEvents } from './sleep-notice'
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
  /**
   * An IPC event pushed by a Linked machine (worfy-link ticket 08), with the connection it came
   * over: with two connections open to one Machine, its broadcasts arrive on both, and the
   * receiver keeps one connection's (remote-calls.ts, worfy-link ticket 09).
   */
  'ipc-event': [{ machineId: string; channel: string; payload: unknown; connection: LinkConnection }]
  /** The link settings changed (settings.ts). */
  settings: [LinkSettingsValue]
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
  /**
   * Adds the client of a connection with access on to main's clients (src/main/broadcast.ts), so
   * broadcasts of `project` events reach the Linked machine (worfy-link ticket 08). Without it
   * such a client hears only what the handlers of its own calls send it.
   */
  addClient?: (client: Client) => void
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
  /** The link settings of this Machine, kept in <dataDir>/link/settings.json. */
  readonly settings: LinkSettings
  private readonly messages = new MessageRegistry()
  private readonly pairingWindow: PairingWindow
  private readonly reasons = new Set<ListenReason>()
  private readonly connections = new Map<string, Set<LinkConnection>>()
  /** The clients of every open connection (ipc-adapter.ts); they follow the access switch. */
  private readonly peers = new Set<LinkPeer>()
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
    this.settings = new LinkSettings(this.linkDir, { warn: this.warn, linked: () => this.store.list().map((record) => record.id) })
    this.settings.on('changed', (value) => {
      // Off, or another level: the connection's `project` client is destroyed now, and its
      // subscriptions with it; a level on makes a fresh one (ipc-adapter.ts, LinkPeer.setAccess).
      for (const peer of this.peers) peer.setAccess(this.settings.levelOf(peer.machineId))
      this.emit('settings', value)
    })
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

  isLinked(machineId: string): boolean {
    return this.store.get(machineId) !== undefined
  }

  /** Whether stop() has run: the service connects and listens no more. */
  get isStopped(): boolean {
    return this.stopped
  }

  /**
   * Addresses another worfy may type to reach this one, `host:port` (IPv6 in brackets): the listen
   * address when it is a single one, else every non-internal address of the machine. Empty while
   * the server does not listen.
   */
  addresses(): string[] {
    const port = this.server?.port
    if (port === undefined) return []
    const host = this.options.listenHost
    if (host !== undefined && host !== ALL_INTERFACES && host !== '0.0.0.0') return [host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`]
    const v4: string[] = []
    const v6: string[] = []
    for (const entries of Object.values(this.interfaces())) {
      for (const entry of entries ?? []) {
        if (entry.internal) continue
        if (entry.family === 'IPv4') v4.push(`${entry.address}:${port}`)
        else if (!/^fe[89ab]/i.test(entry.address)) v6.push(`[${entry.address}]:${port}`)
      }
    }
    return [...new Set([...v4, ...v6])]
  }

  // ---- "Link a machine" on this side (B) -------------------------------------------------------

  /** Opens "Link a machine": a code to show, and the server listens. */
  async openLinking(): Promise<void> {
    this.pairingWindow.open()
    this.reasons.add('linking')
    this.updateReasons()
    await this.listenChain
  }

  /** Closes "Link a machine"; an attempt in flight is cut off and stores nothing. */
  async closeLinking(): Promise<void> {
    this.pairingWindow.close()
    for (const ws of this.pairingSockets) ws.terminate()
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
          accept: (peer) => this.checkPeerId(peer.id, serverFingerprint),
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
   * Connects to Linked machine `machineId` (once per call; connections.ts retries). A 401 from a
   * Machine whose certificate checked out means it has forgotten this one: this side forgets it
   * too. Another certificate at the remembered address marks it "certificate changed".
   *
   * `via` is an address someone else claims for it — a Bonjour announcement (connections.ts), which
   * anyone in the network can send with any Machine id. It is tried once and proves nothing until
   * the certificate there is the remembered one: only then is the address kept (after the
   * connection opened). Another certificate there means "not that Machine": an error, with neither
   * the record nor the "certificate changed" mark touched. No token is sent before that check
   * (client.ts).
   */
  async connect(machineId: string, via?: { host: string; port: number }): Promise<void> {
    const record = this.store.get(machineId)
    if (record === undefined) throw new Error(`Machine ${machineId} is not linked`)
    const token = this.secrets.get(record.outgoingTokenKey)
    if (token === undefined) throw new Error(`the token for Machine ${record.id} (${record.name}) is missing; link it again`)
    const target = via ?? { host: record.address, port: record.port }
    let opened: Awaited<ReturnType<typeof openLinkSocket>>
    try {
      opened = await openLinkSocket({
        host: target.host,
        port: target.port,
        path: CONNECT_PATH,
        key: this.machineKey(),
        certificate: this.identity.certificate,
        expectFingerprint: record.fingerprint,
        token,
      })
    } catch (error) {
      if (via !== undefined && error instanceof LinkConnectError && error.kind === 'certificate-changed') {
        throw new LinkConnectError('refused', `the worfy announced at ${target.host}:${target.port} is not Machine ${record.id} (${record.name}): another certificate; nothing was changed`)
      }
      if (error instanceof LinkConnectError && error.kind === 'certificate-changed') {
        this.certificateChanged.add(record.id)
        this.emit('certificate-changed', { id: record.id, name: record.name })
      } else if (error instanceof LinkConnectError && error.kind === 'unauthorized') {
        this.forget(record.id, 'other-machine')
      }
      throw error
    }
    this.certificateChanged.delete(record.id)
    // Linked again while connecting: this socket was opened with the old token.
    const current = this.store.get(record.id)
    if (current !== undefined && this.secrets.get(current.outgoingTokenKey) !== token) {
      opened.ws.close(CLOSE_UNLINKED, 'linked again')
      throw new Error(`Machine ${record.id} (${record.name}) was linked again while connecting; connect again`)
    }
    if (!this.attach(opened.ws, current ?? record, 'out')) throw new Error(`Machine ${record.id} (${record.name}) was unlinked while connecting`)
    // The remembered certificate answered there: from now on it is where this Machine is.
    if (via !== undefined) this.store.touch(record.id, { address: normalizeAddress(via.host), port: via.port })
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

  /** An open connection to Linked machine `machineId`, the one call() uses; undefined when none is. */
  connectionTo(machineId: string): LinkConnection | undefined {
    return this.openConnection(machineId)
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

  /**
   * A Machine id is bound to the certificate it was linked with: linking it again is fine with the
   * same certificate, and refused with another one — else whoever knows a code could take over the
   * record (and the trust) of a Machine linked before. Such a Machine is revoked first, then linked.
   */
  private checkPeerId(peerId: string, fingerprint: string): void {
    if (peerId === this.identity.id) throw new PairingError('that address is this Machine; type the address of the other worfy; nothing was linked')
    const existing = this.store.get(peerId)
    if (existing !== undefined && existing.fingerprint !== fingerprint) {
      throw new PairingError(
        `Machine ${existing.id} (${existing.name}) is already linked with another certificate; revoke it on this Machine first, then link again; nothing was linked`,
      )
    }
  }

  /**
   * Stores a finished pairing: the token this side presents first, then the record that names it.
   * Linking a Machine again closes its connections: they were opened with the old tokens. The id
   * is checked again first: another attempt with the same id and another certificate may have
   * been stored while this one waited on the network since its own check.
   */
  private commitLink(result: PairingResult, fingerprint: string, address: string, port: number | null): LinkedMachineRecord {
    this.checkPeerId(result.peer.id, fingerprint)
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
    for (const connection of this.connections.get(record.id) ?? []) connection.close(CLOSE_UNLINKED, 'linked again')
    // A new link starts with access off (worfy-link ticket 18), also when the Machine was linked
    // before; when the old level cannot be cleared, nothing is linked.
    this.settings.setLevel(record.id, 'off')
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
    try {
      this.settings.setLevel(machineId, 'off')
    } catch (error) {
      // Linking it again resets the level before anything else (commitLink).
      this.warn(`[link] the access level of Machine ${record.id} could not be cleared: ${messageOf(error)}`)
    }
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
    const peer = new LinkPeer({
      machineId: record.id,
      describe: () => `${record.id} (${this.store.get(record.id)?.name ?? record.name})`,
      push: (channel, payload) => connection.send({ t: 'event', channel, payload }),
      local: () => this.localMachine(),
      ...(this.options.addClient === undefined ? {} : { addClient: this.options.addClient }),
      warn: this.warn,
    })
    this.peers.add(peer)
    peer.setAccess(this.settings.levelOf(record.id))
    let set = this.connections.get(record.id)
    if (set === undefined) {
      set = new Set()
      this.connections.set(record.id, set)
    }
    set.add(connection)
    connection.on('frame', (frame) => void this.onFrame(connection, peer, frame))
    connection.once('close', () => {
      this.peers.delete(peer)
      peer.close()
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

  private async onFrame(connection: LinkConnection, peer: LinkPeer, frame: Frame): Promise<void> {
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
          (adapter) => adapter.call(peer, frame.channel, frame.input, this.identity.name),
          (error: unknown): IpcResult<unknown> => ({ ok: false, error: `${frame.channel}: IPC over the link is unavailable (${messageOf(error)})` }),
        )
        connection.send({ t: 'result', id: frame.id, result })
        return
      }
      case 'event':
        this.emit('ipc-event', { machineId: connection.machineId, channel: frame.channel, payload: frame.payload, connection })
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
      // handleUpgrade calls back synchronously after this check, so the record is still current.
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
        accept: (peer) => this.checkPeerId(peer.id, clientFingerprint),
        commit: (result) => {
          // "Link a machine" closed while the attempt ran: nothing is stored.
          if (!this.pairingWindow.isOpen) throw new PairingError('"Link a machine" was closed while linking; nothing was linked')
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

// ---- the app's link ------------------------------------------------------------------------------

/** The app's link: the service and what keeps it connected and findable. */
export interface AppLink {
  service: LinkService
  connections: LinkConnections
  /** Null when Bonjour is off (WORFY_LINK_BONJOUR=0). */
  discovery: LinkDiscovery | null
  /** "Going to sleep" to and from the Linked machines, and which of them sleep. */
  sleep: SleepNotice
  /** The blocker held while Linked machines are connected; null where none is made (tests). */
  keepAwake: { stop(): void } | null
}

let appLinkValue: AppLink | undefined
let appProblem: string | undefined
const appLinkListeners = new Set<() => void>()

/** The app's link service; undefined before its start finished, or when it failed. */
export function appLinkService(): LinkService | undefined {
  return appLinkValue?.service
}

/** The app's link with its connections and Bonjour; undefined before its start finished, or when it failed. */
export function appLink(): AppLink | undefined {
  return appLinkValue
}

/** Why the app's link service is not running, for the UI; undefined when it runs. */
export function appLinkProblem(): string | undefined {
  return appProblem
}

/** Calls `listener` when the app's link has started or failed to; returns the unsubscribe. */
export function onAppLinkStart(listener: () => void): () => void {
  appLinkListeners.add(listener)
  return () => appLinkListeners.delete(listener)
}

function announceAppLink(): void {
  for (const listener of appLinkListeners) {
    try {
      listener()
    } catch (error) {
      console.warn(`[link] a listener of the link start failed: ${messageOf(error)}`)
    }
  }
}

/** Reads WORFY_LINK_HOST and WORFY_LINK_BONJOUR (see the top of this file). */
export function appLinkEnvironment(env: NodeJS.ProcessEnv = process.env): { listenHost?: string; bonjour: boolean } {
  const host = env.WORFY_LINK_HOST?.trim()
  const bonjour = env.WORFY_LINK_BONJOUR?.trim()
  return { ...(host ? { listenHost: host } : {}), bonjour: bonjour !== '0' && bonjour !== 'false' && bonjour !== 'off' }
}

export interface WireAppLinkOptions {
  bonjour: boolean
  discovery?: LinkDiscovery
  /** Electron's powerMonitor: `suspend` and `resume` are told to the Linked machines. */
  power?: PowerEvents
  /** Makes the keep-awake over the service (keep-awake.ts); the app passes it, tests may not. */
  keepAwake?: (service: LinkService) => { stop(): void }
}

/** Wires the connections, Bonjour, "going to sleep" and the keep-awake around a started service. */
export function wireAppLink(service: LinkService, options: WireAppLinkOptions): AppLink {
  const sleep = new SleepNotice(service, options.power === undefined ? {} : { power: options.power })
  const keepAwake = options.keepAwake?.(service) ?? null
  const connections = new LinkConnections(service)
  const discovery =
    options.discovery ??
    (options.bonjour
      ? new LinkDiscovery({
          backend: bonjourBackend(),
          self: () => service.machine,
          isLinked: (id) => service.isLinked(id),
          protocol: LINK_PROTOCOL_VERSION,
        })
      : null)
  if (discovery !== null) {
    // Announced while the server listens, on its port.
    const followServer = (): void => {
      const { listening, port } = service.status()
      discovery.advertise(listening ? port : null)
    }
    service.on('status', followServer)
    followServer()
    discovery.on('seen', (machine) => connections.seen(machine.id, machine.host, machine.port))
    // Searched for while a Linked machine is unavailable: a new address reconnects at once.
    const followConnections = (): void => discovery.browse('reconnect', connections.anyUnavailable())
    connections.on('changed', followConnections)
    followConnections()
  }
  connections.start()
  return { service, connections, discovery, sleep, keepAwake }
}

/**
 * Stops a link for good: no more dials, Bonjour sends its goodbye (other worfy drop this one from
 * their list now, not when the announcement's TTL runs out) and closes its socket, and the service
 * closes its connections and the server. The order matters: dials stop first, so none starts
 * against a service being stopped.
 */
export async function stopLink(link: AppLink): Promise<void> {
  link.connections.stop()
  link.sleep.stop()
  link.keepAwake?.stop()
  try {
    await link.discovery?.stop()
  } finally {
    await link.service.stop()
  }
}

/** Stops the app's link on quit (src/main/index.ts, before-quit); undefined when it is not running. */
export function stopAppLink(): Promise<void> | undefined {
  const link = appLinkValue
  if (link === undefined) return undefined
  appLinkValue = undefined
  return stopLink(link)
}

/** The part of Electron's `app` stopLinkOnQuit uses; the contract test passes a model of Electron's quit. */
export interface QuitApp {
  on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

/** How long quitting waits for the link to say goodbye on Bonjour and close its connections. */
export const LINK_QUIT_WAIT_MS = 1500

/**
 * Stops the app's link when worfy quits (src/main/index.ts), so Bonjour's goodbye goes out (other
 * worfy drop this one from "Link a machine" at once, not after the announcement's TTL of 8 hours)
 * and the Linked machines see the connections close.
 *
 * In `will-quit`, not `before-quit`: Electron fires `will-quit` only once every `before-quit`
 * handler has let the quit through, so the link never quits over another part's wait — Autopilot
 * holds `before-quit` until its runs have stopped and their journal is written
 * (src/main/ipc/autopilot.ts), and a later app.quit() from here would find its handler already
 * done and quit under it. In `will-quit` the link holds the quit while its stop is pending — on
 * every `will-quit`, not only the first: another part waiting there (the shells,
 * src/main/ipc/terminal.ts) may quit again before the link is done. At most `waitMs`.
 */
export function stopLinkOnQuit(app: QuitApp, stop: () => Promise<void> | undefined = stopAppLink, waitMs = LINK_QUIT_WAIT_MS): void {
  let stopping: Promise<void> | undefined
  let done = false
  app.on('will-quit', (event) => {
    if (stopping === undefined) {
      const started = stop()
      if (started === undefined) return
      const waited = new Promise<void>((resolve) => setTimeout(resolve, waitMs))
      stopping = Promise.race([started, waited])
        .catch((error: unknown) => console.warn(`[link] could not stop the link on quit: ${messageOf(error)}`))
        .finally(() => {
          done = true
        })
    }
    if (done) return
    event.preventDefault()
    // On a later turn of the event loop, never from a microtask: Electron ignores app.quit() until
    // its `will-quit` dispatch has returned, and a stop with nothing to wait for settles before that.
    void stopping.finally(() => setTimeout(() => app.quit(), 0))
  })
}

/** Starts the app's link over worfy's data folder (src/main/index.ts, after registerIpc). */
export async function startAppLink(options: { buildKind: BuildKind; buildVersion: string }): Promise<LinkService> {
  const environment = appLinkEnvironment()
  try {
    // Imported here, not at the top: broadcast.ts and keep-awake.ts reach Electron, and the link
    // tests run without it.
    const [{ addClient }, { powerMonitor }, { LinkKeepAwake }] = await Promise.all([import('../broadcast'), import('electron'), import('./keep-awake')])
    const service = await LinkService.start({
      dataDir: dataRoot(),
      ...options,
      addClient,
      ...(environment.listenHost === undefined ? {} : { listenHost: environment.listenHost }),
    })
    appLinkValue = wireAppLink(service, { bonjour: environment.bonjour, power: powerMonitor, keepAwake: (followed) => new LinkKeepAwake(followed) })
    appProblem = undefined
    return service
  } catch (error) {
    appProblem = `the link service could not start: ${messageOf(error)}`
    throw error
  } finally {
    announceAppLink()
  }
}
