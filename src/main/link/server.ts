// The link server (ADR-0052, points 5, 7 and 8): HTTPS with TLS 1.3 under this Machine's
// certificate, and WebSocket over it through `ws` in noServer mode. Every check runs in the
// server's 'upgrade' event, before handleUpgrade, as the `ws` documentation advises: a refused
// request gets a plain HTTP answer and its socket is closed before any WebSocket handshake. The
// order: the peer may connect (isAllowedPeer: the local network, or Tailscale on the Tailscale
// interface while "Link through Tailscale" is on), no Origin header, the Host names this machine and port, the
// protocol version matches, then the endpoint's own check — the token for /link/connect, an open
// "Link a machine" for /link/pair. Refusal texts say what kind of refusal it is, never which part
// of a token was wrong.
//
// The server asks every client for its certificate (TLS client authentication without a CA): the
// certificate is not checked against a chain but by fingerprint — the one remembered at linking
// for /link/connect, and the one the pairing transcript binds for /link/pair.
import type { IncomingMessage } from 'node:http'
import { createServer, type Server } from 'node:https'
import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { WebSocketServer, type WebSocket } from 'ws'
import { isAllowedHost, isAllowedPeer, normalizeAddress, type HostNames, type PeerAddresses, type SocketAddresses } from './checks'
import { CONNECT_PATH, LINK_MAX_PAYLOAD, LINK_PROTOCOL_HEADER, LINK_PROTOCOL_VERSION, PAIR_PATH, PAIRING_MAX_PAYLOAD } from './messages'

/** A refusal before the handshake: status and body. */
export interface Refusal {
  status: 400 | 401 | 403 | 404 | 409
  body: string
}

const STATUS_TEXT: Record<Refusal['status'], string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict' }

export const FORBIDDEN: Refusal = { status: 403, body: 'forbidden' }
export const UNAUTHORIZED: Refusal = { status: 401, body: 'unauthorized' }

/** The text of a protocol mismatch: both versions and the server's build, shown to the user as is. */
export function protocolMismatch(theirs: string | undefined, build: string): Refusal {
  return {
    status: 400,
    body: `worfy link protocol mismatch: this Machine (worfy ${build}) speaks link protocol ${LINK_PROTOCOL_VERSION}, the connecting worfy speaks ${theirs ?? 'none'}. Update both to the same version.`,
  }
}

export interface UpgradeRequest {
  peer: PeerAddresses
  headers: IncomingMessage['headers']
  url: string | undefined
}

/** The checks every upgrade passes, whatever the endpoint; null when they pass. */
export function checkUpgrade(request: UpgradeRequest, context: { port: number; names: HostNames; build: string; isAllowedPeer: (peer: PeerAddresses) => boolean }): Refusal | null {
  if (!context.isAllowedPeer(request.peer)) return FORBIDDEN
  // A browser always sends Origin (and an old one Sec-WebSocket-Origin); worfy's client never does.
  if (request.headers.origin !== undefined || request.headers['sec-websocket-origin'] !== undefined) return FORBIDDEN
  if (!isAllowedHost(request.headers.host, context.port, context.names)) return FORBIDDEN
  const version = request.headers[LINK_PROTOCOL_HEADER]
  const theirs = Array.isArray(version) ? version.join(',') : version
  if (theirs !== String(LINK_PROTOCOL_VERSION)) return protocolMismatch(theirs, context.build)
  const path = (request.url ?? '').split('?')[0]
  if (path !== PAIR_PATH && path !== CONNECT_PATH) return { status: 404, body: 'not found' }
  return null
}

/** The bearer token of an Authorization header; undefined when there is none. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{16,200})$/.exec(header ?? '')
  return match?.[1]
}

function refuse(socket: Socket, refusal: Refusal): void {
  const body = Buffer.from(refusal.body, 'utf8')
  socket.once('finish', () => socket.destroy())
  socket.end(
    `HTTP/1.1 ${refusal.status} ${STATUS_TEXT[refusal.status]}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n${refusal.body}`,
  )
}

export interface AcceptedUpgrade {
  path: typeof PAIR_PATH | typeof CONNECT_PATH
  /** The client's certificate fingerprint; undefined when it sent none. */
  clientFingerprint: string | undefined
  remoteAddress: string
  token: string | undefined
}

export interface LinkServerOptions {
  key: string
  certificate: string
  host: string
  port: number
  build: string
  hostNames: () => HostNames
  /** The endpoint's own check after the common ones: a refusal, or an admission. */
  admit: (upgrade: AcceptedUpgrade) => Refusal | Admission
  /**
   * Which peers may connect at all, asked on every connection and again at its upgrade: by default
   * the local network only, as with "Link through Tailscale" off (checks.ts, isAllowedPeer).
   */
  isAllowedPeer?: (peer: PeerAddresses) => boolean
  /** How a socket's two addresses are read; its own by default. Tests stand 127.0.0.1 in for a Tailscale address. */
  addressesOf?: (socket: SocketAddresses) => PeerAddresses
}

const LOCAL_NETWORK_ONLY = { tailscale: false, interfaces: {} }
const socketAddresses = (socket: SocketAddresses): PeerAddresses => ({ remote: socket.remoteAddress, local: socket.localAddress })

/** What to do with an admitted request: `accept` gets the WebSocket, `abort` runs when the handshake fails instead. */
export interface Admission {
  accept: (ws: WebSocket) => void
  abort: () => void
}

export interface LinkServer {
  readonly port: number
  close(): void
}

/** Listens; rejects with the listen error (EADDRINUSE and the like). */
export function startLinkServer(options: LinkServerOptions): Promise<LinkServer> {
  const server: Server = createServer({
    key: options.key,
    cert: options.certificate,
    minVersion: 'TLSv1.3',
    requestCert: true,
    rejectUnauthorized: false,
  })
  const pairing = new WebSocketServer({ noServer: true, maxPayload: PAIRING_MAX_PAYLOAD })
  const connections = new WebSocketServer({ noServer: true, maxPayload: LINK_MAX_PAYLOAD })
  let port = options.port
  const allowed = options.isAllowedPeer ?? ((peer: PeerAddresses) => isAllowedPeer(peer, LOCAL_NETWORK_ONLY))
  const addressesOf = options.addressesOf ?? socketAddresses

  // A peer that may not connect is dropped on the TCP connection, before the TLS handshake: it
  // never gets as far as the certificate (whose name carries the Machine id). The check at
  // 'upgrade' below stays as the second line.
  server.on('connection', (socket: Socket) => {
    if (!allowed(addressesOf(socket))) socket.destroy()
  })

  // Plain HTTPS requests have nothing here.
  server.on('request', (_request, response) => {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
    response.end('not found')
  })
  server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    socket.on('error', () => socket.destroy())
    const peerAddresses = addressesOf(socket)
    const remoteAddress = peerAddresses.remote
    const common = checkUpgrade({ peer: peerAddresses, headers: request.headers, url: request.url }, { port, names: options.hostNames(), build: options.build, isAllowedPeer: allowed })
    if (common !== null || remoteAddress === undefined) {
      refuse(socket, common ?? FORBIDDEN)
      return
    }
    const peer = (socket as TLSSocket).getPeerCertificate()
    const path = (request.url ?? '').split('?')[0] === PAIR_PATH ? PAIR_PATH : CONNECT_PATH
    const authorization = request.headers.authorization
    const decision = options.admit({
      path,
      clientFingerprint: peer.fingerprint256 || undefined,
      remoteAddress: normalizeAddress(remoteAddress),
      token: bearerToken(authorization),
    })
    if ('status' in decision) {
      refuse(socket, decision)
      return
    }
    // handleUpgrade never calls back when the handshake itself is malformed; the socket then closes.
    let accepted = false
    socket.once('close', () => {
      if (!accepted) decision.abort()
    })
    const wss = path === PAIR_PATH ? pairing : connections
    wss.handleUpgrade(request, socket, head, (ws) => {
      accepted = true
      decision.accept(ws)
    })
  })
  server.on('tlsClientError', () => {
    // A client that fails the TLS handshake (a browser probing the port) is dropped by Node itself.
  })

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen({ host: options.host, port: options.port }, () => {
      server.off('error', onError)
      server.on('error', () => {
        // After the listen, a server error is a socket's; the socket is gone already.
      })
      const address = server.address()
      port = typeof address === 'object' && address !== null ? address.port : options.port
      resolve({
        port,
        close: () => {
          server.close()
          pairing.close()
          connections.close()
        },
      })
    })
  })
}
