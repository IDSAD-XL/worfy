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
import tls from 'node:tls'
import type { Duplex } from 'node:stream'
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
  timeoutMs?: number
  /** Overrides the protocol version sent (tests of a mismatch). */
  protocolVersion?: number
  /** The largest message taken from the server; by default PAIRING_MAX_PAYLOAD on the pairing path, LINK_MAX_PAYLOAD otherwise. */
  maxPayload?: number
}

export interface OpenedSocket {
  ws: WebSocket
  /** The server certificate's fingerprint as seen in this connection. */
  serverFingerprint: string
}

const hostForUrl = (host: string): string => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host)

const CONNECT_TIMEOUT_MS = 10_000

/** Opens the WebSocket; rejects with LinkConnectError, whose message never carries the token. */
export function openLinkSocket(options: OpenOptions): Promise<OpenedSocket> {
  let serverFingerprint = ''
  let certificateChanged = false
  const url = `wss://${hostForUrl(options.host)}:${options.port}${options.path}`
  const headers: Record<string, string> = { [LINK_PROTOCOL_HEADER]: String(options.protocolVersion ?? LINK_PROTOCOL_VERSION) }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`

  const ws = new WebSocket(url, {
    headers,
    handshakeTimeout: options.timeoutMs ?? CONNECT_TIMEOUT_MS,
    perMessageDeflate: false,
    maxPayload: options.maxPayload ?? (options.path === PAIR_PATH ? PAIRING_MAX_PAYLOAD : LINK_MAX_PAYLOAD),
    createConnection: ((_options: unknown, ready: (error: Error | null, socket?: Duplex) => void) => {
      const socket = tls.connect({
        host: options.host.replace(/^\[|\]$/g, ''),
        port: options.port,
        key: options.key,
        cert: options.certificate,
        minVersion: 'TLSv1.3',
        // The chain is not checked: trust is the fingerprint below.
        rejectUnauthorized: false,
      })
      let settled = false
      socket.once('secureConnect', () => {
        settled = true
        serverFingerprint = socket.getPeerCertificate().fingerprint256 ?? ''
        if (options.expectFingerprint !== undefined && serverFingerprint !== options.expectFingerprint) {
          certificateChanged = true
          socket.destroy()
          ready(new LinkConnectError('certificate-changed', 'certificate changed: the other Machine presents a certificate other than the one remembered at linking; link it again'))
          return
        }
        ready(null, socket)
      })
      socket.once('error', (error) => {
        if (settled) return
        settled = true
        ready(error)
      })
      return undefined
    }) as never,
  })

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, serverFingerprint }))
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
