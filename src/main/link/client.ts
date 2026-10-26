// The link client: opens a WebSocket to another Machine's link server, presenting this Machine's
// certificate as the TLS client certificate.
//
// The server certificate is checked by fingerprint inside our own createConnection, before the
// socket is handed to the HTTP request: http.ClientRequest takes the socket only through the
// callback, so not one byte of the request — the Authorization header with the token included —
// is written to a server whose certificate is not the remembered one. Such a server ends the
// attempt as "certificate changed". (Node's checkServerIdentity is not used: it runs only after a
// chain check, which a self-signed certificate never passes without a CA.)
//
// While pairing there is nothing remembered yet: the fingerprint is only recorded, and the pairing
// transcript (pairing.ts) proves it.
import net, { type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import tls from 'node:tls'
import WebSocket from 'ws'
import { LINK_MAX_PAYLOAD, LINK_PROTOCOL_HEADER, LINK_PROTOCOL_VERSION, PAIR_PATH, PAIRING_MAX_PAYLOAD } from './messages'

/** Why a connection attempt failed, for the service and the UI (worfy-link ticket 02). */
export type LinkFailureKind = 'certificate-changed' | 'unauthorized' | 'refused' | 'protocol' | 'unreachable'

export class LinkConnectError extends Error {
  constructor(
    readonly kind: LinkFailureKind,
    message: string,
  ) {
    super(message)
    this.name = 'LinkConnectError'
  }
}

export interface OpenOptions {
  host: string
  port: number
  path: string
  /** This Machine's key and certificate, presented to the server. */
  key: string
  certificate: string
  /** The remembered fingerprint of the server; absent while pairing. */
  expectFingerprint?: string
  /** Sent as `Authorization: Bearer …`, only once the server certificate checked out. */
  token?: string
  /**
   * The limit on each step of the dial: TCP connect plus the TLS handshake together, then the
   * WebSocket upgrade (ws's handshakeTimeout). DIAL_TIMEOUT_MS by default.
   */
  timeoutMs?: number
  /** Overrides the protocol version sent (tests of a mismatch). */
  protocolVersion?: number
  /** The largest message taken from the server; by default PAIRING_MAX_PAYLOAD on the pairing path, LINK_MAX_PAYLOAD otherwise. */
  maxPayload?: number
  /**
   * Asked once the TCP connection is up, before the first byte of TLS: true lets it go on, a text
   * refuses it ('refused', with that text for the user). The address a name resolved to is known
   * only here. Without it every server is dialed.
   */
  allowServer?: (socket: Socket) => true | string
}

export interface OpenedSocket {
  ws: WebSocket
  /** The server certificate's fingerprint as seen in this connection. */
  serverFingerprint: string
  /** The address the connection went to (socket.remoteAddress). */
  remoteAddress: string | undefined
}

const hostForUrl = (host: string): string => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host)

/** How long a dial waits for each step before it gives up (worfy-link ticket 36). */
export const DIAL_TIMEOUT_MS = 10_000

/** Opens the WebSocket; rejects with LinkConnectError, whose message never carries the token. */
export function openLinkSocket(options: OpenOptions): Promise<OpenedSocket> {
  let serverFingerprint = ''
  let remoteAddress: string | undefined
  let certificateChanged = false
  const timeoutMs = options.timeoutMs ?? DIAL_TIMEOUT_MS
  const url = `wss://${hostForUrl(options.host)}:${options.port}${options.path}`
  const headers: Record<string, string> = { [LINK_PROTOCOL_HEADER]: String(options.protocolVersion ?? LINK_PROTOCOL_VERSION) }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`

  const ws = new WebSocket(url, {
    headers,
    handshakeTimeout: timeoutMs,
    perMessageDeflate: false,
    maxPayload: options.maxPayload ?? (options.path === PAIR_PATH ? PAIRING_MAX_PAYLOAD : LINK_MAX_PAYLOAD),
    createConnection: ((_options: unknown, ready: (error: Error | null, socket?: Duplex) => void) => {
      const host = options.host.replace(/^\[|\]$/g, '')
      let settled = false
      let socket: tls.TLSSocket | undefined
      // ws's handshakeTimeout starts only once the request has its socket, after secureConnect: an
      // address that keeps silent on TCP, or takes TCP and never answers TLS, is cut here.
      const timer = setTimeout(() => {
        socket?.destroy()
        tcp.destroy()
        fail(new LinkConnectError('unreachable', `could not reach ${options.host}:${options.port} (no answer within ${timeoutMs / 1000} s)`))
      }, timeoutMs)
      const fail = (error: Error): void => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        ready(error)
      }
      // TCP first, TLS over it: allowServer sees the address a name resolved to before the
      // ClientHello is written, so a refused server gets no byte of TLS.
      const tcp = net.connect({ host, port: options.port })
      tcp.once('error', fail)
      tcp.once('connect', () => {
        remoteAddress = tcp.remoteAddress
        const allowed = options.allowServer?.(tcp) ?? true
        if (allowed !== true) {
          tcp.destroy()
          fail(new LinkConnectError('refused', allowed))
          return
        }
        const secure = tls.connect({
          socket: tcp,
          host,
          port: options.port,
          ...(net.isIP(host) === 0 ? { servername: host } : {}),
          key: options.key,
          cert: options.certificate,
          minVersion: 'TLSv1.3',
          // The chain is not checked: trust is the fingerprint below.
          rejectUnauthorized: false,
        })
        socket = secure
        secure.once('secureConnect', () => {
          clearTimeout(timer)
          if (settled) return
          settled = true
          serverFingerprint = secure.getPeerCertificate().fingerprint256 ?? ''
          if (options.expectFingerprint !== undefined && serverFingerprint !== options.expectFingerprint) {
            certificateChanged = true
            secure.destroy()
            ready(new LinkConnectError('certificate-changed', 'certificate changed: the other Machine presents a certificate other than the one remembered at linking; link it again'))
            return
          }
          ready(null, secure)
        })
        secure.once('error', fail)
      })
      return undefined
    }) as never,
  })

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, serverFingerprint, remoteAddress }))
    ws.once('unexpected-response', (_request, response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8').slice(0, 1000)
        const status = response.statusCode ?? 0
        ws.terminate()
        if (status === 401) reject(new LinkConnectError('unauthorized', 'the other Machine does not accept this Machine any more (401)'))
        else if (status === 400) reject(new LinkConnectError('protocol', body))
        else reject(new LinkConnectError('refused', `the other Machine refused the connection (${status}: ${body})`))
      })
      response.on('error', () => reject(new LinkConnectError('refused', `the other Machine refused the connection (${response.statusCode ?? 0})`)))
    })
    ws.once('error', (error: Error & { code?: string }) => {
      if (error instanceof LinkConnectError) reject(error)
      else if (certificateChanged) reject(new LinkConnectError('certificate-changed', 'certificate changed'))
      else reject(new LinkConnectError('unreachable', `could not reach ${options.host}:${options.port} (${error.code ?? error.message})`))
    })
  })
}
