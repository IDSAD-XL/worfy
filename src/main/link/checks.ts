// Checks the link server runs on a request before the WebSocket handshake (ADR-0052, points 7 and
// 8): the peer is on the local network or loopback, and the Host header names this machine with the
// server's port. Pure functions over their inputs, so the unit test covers every range without a
// network; the server (server.ts) only calls them.
import { isIP } from 'node:net'
import type { NetworkInterfaceInfo } from 'node:os'

/** `::ffff:192.168.0.5` → `192.168.0.5`; a zone id (`fe80::1%en0`) is dropped; lower case. */
export function normalizeAddress(address: string): string {
  let value = address.trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  const zone = value.indexOf('%')
  if (zone !== -1) value = value.slice(0, zone)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)
  if (mapped?.[1] !== undefined) return mapped[1]
  return value
}

function ipv4Octets(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined
  return address.split('.').map(Number)
}

/** The 128 bits of an IPv6 address as eight 16-bit groups; undefined when it is not IPv6. */
function ipv6Groups(address: string): number[] | undefined {
  if (isIP(address) !== 6) return undefined
  let text = address
  // An embedded IPv4 tail (`::ffff:1.2.3.4` that normalizeAddress did not reduce) becomes two groups.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (tail?.[1] !== undefined) {
    const [a = 0, b = 0, c = 0, d = 0] = tail[1].split('.').map(Number)
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = '', rest] = text.split('::')
  const left = head === '' ? [] : head.split(':')
  const right = rest === undefined || rest === '' ? [] : rest.split(':')
  const fill = rest === undefined ? 0 : 8 - left.length - right.length
  return [...left, ...Array<string>(fill).fill('0'), ...right].map((group) => parseInt(group, 16))
}

function isLocalIpv4([a = -1, b = -1]: number[]): boolean {
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/**
 * True for loopback and local-network addresses: IPv4 127/8, 10/8, 172.16/12, 192.168/16,
 * 169.254/16; IPv6 ::1, fc00::/7, fe80::/10. An IPv4 address inside IPv6 (`::ffff:a.b.c.d`) is
 * judged as IPv4. Anything else, a malformed address included, is not local.
 */
export function isLocalNetworkAddress(address: string): boolean {
  const parsed = parseAddress(address)
  if (parsed === undefined) return false
  if (parsed.family === 4) return isLocalIpv4(parsed.parts)
  const v6 = parsed.parts
  const first = v6[0] ?? 0
  const isLoopback = v6.slice(0, 7).every((group) => group === 0) && v6[7] === 1
  return isLoopback || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
}

/**
 * An address as IPv4 octets or eight IPv6 groups; IPv4 inside IPv6 (`::ffff:a.b.c.d`, or
 * `::ffff:7f00:1` in hex) is IPv4. Undefined when malformed.
 */
function parseAddress(address: string): { family: 4 | 6; parts: number[] } | undefined {
  const value = normalizeAddress(address)
  const v4 = ipv4Octets(value)
  if (v4 !== undefined) return { family: 4, parts: v4 }
  const v6 = ipv6Groups(value)
  if (v6 === undefined || v6.length !== 8 || v6.some((group) => Number.isNaN(group))) return undefined
  if (v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff) {
    const [high = 0, low = 0] = v6.slice(6)
    return { family: 4, parts: [high >> 8, high & 0xff, low >> 8, low & 0xff] }
  }
  return { family: 6, parts: v6 }
}

/**
 * Which Tailscale range an address is in (ADR-0070, point 4): IPv4 100.64.0.0/10 (shared with
 * carrier-grade NAT) or IPv6 fd7a:115c:a1e0::/48; undefined for any other address.
 */
function tailscaleRange(address: string): 4 | 6 | undefined {
  const parsed = parseAddress(address)
  if (parsed === undefined) return undefined
  const [a = -1, b = -1, c = -1] = parsed.parts
  if (parsed.family === 4) return a === 100 && (b & 0xc0) === 64 ? 4 : undefined
  return a === 0xfd7a && b === 0x115c && c === 0xa1e0 ? 6 : undefined
}

/** True for an address in a Tailscale range: 100.64.0.0/10 or fd7a:115c:a1e0::/48. */
export function isTailscaleAddress(address: string): boolean {
  return tailscaleRange(address) !== undefined
}

/** The two ends of a connection as the server's socket sees them. */
export interface PeerAddresses {
  /** The peer's address (socket.remoteAddress). */
  remote: string | undefined
  /** This machine's address the connection arrived on (socket.localAddress). */
  local: string | undefined
}

/** What a socket tells of its two ends; net.Socket has both. */
export interface SocketAddresses {
  remoteAddress?: string | undefined
  localAddress?: string | undefined
}

export interface PeerRule {
  /** "Link through Tailscale" (link/settings.json): off by default. */
  tailscale: boolean
  /** os.networkInterfaces(), read on every connection: the Tailscale adapter may get its address after worfy starts. */
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>
}

/**
 * Whether a peer may connect at all (ADR-0052, point 7, replaced by ADR-0070, points 3 and 4). A
 * peer in a Tailscale range passes only while "Link through Tailscale" is on, and only when the
 * connection arrived on an address in the same range that an interface of this machine has: the
 * Tailscale interface, found by its address and not by its name (utun* on macOS, "Tailscale" on
 * Windows). 100.64.0.0/10 is also carrier-grade NAT, so a neighbour at the same provider arrives on
 * the home network's address and is refused. Any other peer passes when it is on the local network
 * or loopback; fd7a:115c:a1e0::/48 no longer passes as fc00::/7.
 */
export function isAllowedPeer({ remote, local }: PeerAddresses, { tailscale, interfaces }: PeerRule): boolean {
  if (remote === undefined) return false
  const range = tailscaleRange(remote)
  if (range === undefined) return isLocalNetworkAddress(remote)
  if (!tailscale || local === undefined || tailscaleRange(local) !== range) return false
  const arrivedOn = normalizeAddress(local)
  return Object.values(interfaces).some((list) => (list ?? []).some((info) => normalizeAddress(info.address) === arrivedOn))
}

export interface HostNames {
  /** os.networkInterfaces(), read on every request: a DHCP address changes while worfy runs. */
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>
  /** os.hostname(): `Name.local` on macOS, the bare computer name on Windows. */
  hostname: string
}

/**
 * The names a request may carry in Host, without the port: the addresses of the machine's
 * interfaces, `localhost`, `127.0.0.1`, `::1`, and the machine's name in `.local` (its first
 * label + `.local`, and os.hostname() itself when it already ends in `.local`). Lower case,
 * IPv6 without brackets and without a zone id.
 */
export function allowedHostNames({ interfaces, hostname }: HostNames): Set<string> {
  const names = new Set<string>(['localhost', '127.0.0.1', '::1'])
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) names.add(normalizeAddress(info.address))
  }
  const host = hostname.trim().toLowerCase()
  const label = host.split('.')[0] ?? ''
  if (label !== '') names.add(`${label}.local`)
  if (host.endsWith('.local')) names.add(host)
  return names
}

/** `name:port`, `[v6]:port`, `name` or `[v6]` → name and port (undefined when absent); undefined when malformed. */
export function parseHostHeader(header: string): { name: string; port: number | undefined } | undefined {
  const value = header.trim()
  let name: string
  let portText: string | undefined
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close === -1) return undefined
    name = value.slice(1, close)
    const after = value.slice(close + 1)
    if (after !== '' && !after.startsWith(':')) return undefined
    portText = after === '' ? undefined : after.slice(1)
  } else {
    const parts = value.split(':')
    // A bare IPv6 address without brackets is not a valid Host.
    if (parts.length > 2) return undefined
    name = parts[0] ?? ''
    portText = parts[1]
  }
  if (name === '') return undefined
  if (portText === undefined) return { name: normalizeAddress(name), port: undefined }
  if (!/^\d{1,5}$/.test(portText)) return undefined
  return { name: normalizeAddress(name), port: Number(portText) }
}

/**
 * Whether a Host header names this machine and the server's port. A Host without a port means
 * the https default, 443, so it passes only when the server listens there.
 */
export function isAllowedHost(header: string | undefined, serverPort: number, names: HostNames): boolean {
  if (header === undefined) return false
  const parsed = parseHostHeader(header)
  if (parsed === undefined) return false
  if ((parsed.port ?? 443) !== serverPort) return false
  return allowedHostNames(names).has(parsed.name)
}
