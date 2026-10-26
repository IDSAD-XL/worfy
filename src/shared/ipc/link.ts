// The `link` domain (worfy-link tickets 01, 02 and 14; ADR-0052): this Machine as the link knows it,
// its Linked machines, "Link a machine", the access switch and the keep-awake switch. Handled in src/main/ipc/link.ts.
//
// Only `link.ping` is open to Linked machines (its mark `link`, src/shared/ipc/channels.ts). Every
// other channel here is `local`, for this Machine's own windows: `link.state` carries the pairing
// code, which only this Machine's screen may show. Tokens and certificate fingerprints never
// appear in this contract.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/** This Machine: its id and name, the link protocol it speaks and its build version. */
export const linkMachineSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  protocol: z.number().int().positive(),
  build: z.string().min(1),
})

export const linkPing = invokeChannel('link.ping', z.void(), linkMachineSchema, 'link')

// ---- an address typed by hand ------------------------------------------------------------------

/** Where a worfy listens, as typed by hand or found by Bonjour. */
export interface LinkAddress {
  /** A host name, an IPv4 address, or an IPv6 address without brackets. */
  host: string
  port: number
}

const HOST_NAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/
const IPV6 = /^[0-9A-Fa-f:.]+(?:%[A-Za-z0-9._-]+)?$/

/**
 * Reads an address typed by hand: `host:port`, `192.168.1.20:52000`, `[fe80::1%en0]:52000`. An
 * IPv6 address goes in brackets, since its own colons would hide the port. Returns the address, or
 * the reason to show under the field.
 */
export function parseLinkAddress(text: string): { ok: true; address: LinkAddress } | { ok: false; error: string } {
  const value = text.trim()
  if (value === '') return { ok: false, error: 'Type the address as host:port' }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return { ok: false, error: 'Type only host:port, without http:// or another scheme' }
  let host: string
  let portText: string | undefined
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close === -1) return { ok: false, error: 'An IPv6 address needs its closing bracket: [::1]:port' }
    host = value.slice(1, close)
    const rest = value.slice(close + 1)
    if (rest === '') portText = undefined
    else if (rest.startsWith(':')) portText = rest.slice(1)
    else return { ok: false, error: 'Write the port after the bracket: [::1]:port' }
    if (!host.includes(':') || !IPV6.test(host)) return { ok: false, error: `Not an IPv6 address: ${host}` }
  } else {
    const colons = value.split(':').length - 1
    if (colons > 1) return { ok: false, error: 'Put an IPv6 address in brackets: [::1]:port' }
    const [first = '', second] = value.split(':')
    host = first
    portText = second
    if (!HOST_NAME.test(host)) return { ok: false, error: `Not a host name or address: ${host === '' ? '(empty)' : host}` }
  }
  if (portText === undefined) return { ok: false, error: 'Add the port: host:port' }
  if (!/^\d{1,5}$/.test(portText)) return { ok: false, error: `Not a port: ${portText === '' ? '(empty)' : portText}` }
  const port = Number(portText)
  if (port < 1 || port > 65535) return { ok: false, error: `The port is 1 to 65535, not ${port}` }
  return { ok: true, address: { host, port } }
}

/**
 * Whether `host` (an address without brackets and port) is in a Tailscale range: IPv4
 * 100.64.0.0/10 or IPv6 fd7a:115c:a1e0::/48 (ADR-0070, point 4). For the window's mark on this
 * Machine's own addresses only; what the link lets through is decided in main
 * (src/main/link/checks.ts, isTailscaleAddress), and a unit test holds the two to one table.
 */
export function isTailscaleHost(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4 !== null) return v4.slice(1).every((octet) => Number(octet) <= 255) && v4[1] === '100' && (Number(v4[2]) & 0xc0) === 64
  if (!host.includes(':')) return false
  // The first three groups stand left of `::`: a group it stands for is 0, and none of fd7a:115c:a1e0 is.
  const groups = (host.split('::')[0] ?? '').split(':')
  return groups.length >= 3 && groups.slice(0, 3).every((group, index) => /^[0-9a-f]{1,4}$/i.test(group) && parseInt(group, 16) === [0xfd7a, 0x115c, 0xa1e0][index])
}

/** `host:port`, IPv6 in brackets: how an address is shown and typed. */
export function formatLinkAddress({ host, port }: LinkAddress): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

// ---- access to the Projects of this Machine ---------------------------------------------------

/**
 * How far one Linked machine may work with the Projects of this Machine (worfy-link ticket 18;
 * ADR-0066, which refines point 6 of ADR-0052): `off` — not at all; `read` — the `read` channels
 * only (src/shared/ipc/channels.ts, ChannelUse); `all` — every `project` channel. A newly linked
 * Machine starts `off`. Read-only still means trust: a transcript may show a secret.
 */
export const ACCESS_LEVELS = ['off', 'read', 'all'] as const
export const accessLevelSchema = z.enum(ACCESS_LEVELS)
export type AccessLevel = z.output<typeof accessLevelSchema>

// ---- the state the UI shows ----------------------------------------------------------------------

/** A Linked machine as the sidebar shows it. */
export const linkedMachineViewSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  /**
   * `sleeping` (worfy-link ticket 14): it said it was going to sleep, and no connection to it has
   * opened since; `unavailable`: no connection, without such a message.
   */
  state: z.enum(['online', 'unavailable', 'sleeping']),
  /** The last connection met another certificate: the Machine has to be linked again. */
  certificateChanged: z.boolean(),
  /**
   * Its access to the Projects of this Machine as set for it (worfy-link ticket 18); it applies
   * only while `projectsAccess` of the state is on.
   */
  access: accessLevelSchema,
})
export type LinkedMachineView = z.output<typeof linkedMachineViewSchema>

/** A worfy found by Bonjour that is neither this Machine nor a Linked machine. */
export const discoveredMachineSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  /** The link protocol it announces; null when its announcement has none. */
  protocol: z.number().int().positive().nullable(),
  /** False when it speaks another link protocol: linking would be refused. */
  compatible: z.boolean(),
  /** Another announcement claims the same Machine id at another address: one of them is not it. */
  conflict: z.boolean(),
})
export type DiscoveredMachineView = z.output<typeof discoveredMachineSchema>

export const linkStateSchema = z.object({
  /** Grows with every change in main; a window keeps the state with the highest revision. */
  revision: z.number().int().nonnegative(),
  /** This Machine; null while the link service has not started (or could not). */
  machine: z.object({ id: z.uuid(), name: z.string().min(1) }).nullable(),
  /** Why the link does not work: the service did not start, the server could not listen. */
  problem: z.string().nullable(),
  listening: z.boolean(),
  /** Addresses another worfy may type to reach this one, `host:port`; empty while not listening. */
  addresses: z.array(z.string()),
  /** Whether this worfy announces itself and searches by Bonjour. */
  bonjour: z.boolean(),
  linking: z.object({
    open: z.boolean(),
    /** The six-digit code this Machine shows while "Link a machine" is open. */
    code: z.string().regex(/^\d{6}$/).nullable(),
    expiresAt: z.number().nullable(),
    /** The Machine linked while "Link a machine" was open, either side; shown as the success. */
    linked: z.object({ id: z.uuid(), name: z.string().min(1) }).nullable(),
    /** The last failed attempt of another worfy to link to this one. */
    failure: z.string().nullable(),
    /** While linking is paused after too many failed attempts within the hour: until when (ms since epoch). */
    pausedUntil: z.number().optional(),
  }),
  linked: z.array(linkedMachineViewSchema),
  discovered: z.array(discoveredMachineSchema),
  /**
   * "Linked machines can work with my Projects"; off by default (ADR-0052, point 6). Off turns
   * access off for every Linked machine whatever its own level (ADR-0066).
   */
  projectsAccess: z.boolean(),
  /** "Keep this computer awake while linked machines are connected"; on by default (worfy-link ticket 14). */
  keepAwake: z.boolean(),
  /** "Link through Tailscale"; off by default (worfy-link ticket 27; ADR-0070, point 3). */
  tailscale: z.boolean(),
})
export type LinkState = z.output<typeof linkStateSchema>

export const linkState = invokeChannel('link.state', z.void(), linkStateSchema, 'local')

/** Opens "Link a machine" for the calling window: the server listens, a code is shown, Bonjour searches. */
export const linkOpen = invokeChannel('link.open', z.void(), linkStateSchema, 'local')

/** Closes "Link a machine" for the calling window; linking stays open while another window has it open. */
export const linkClose = invokeChannel('link.close', z.void(), linkStateSchema, 'local')

/**
 * Links this Machine with the worfy at `address`, whose "Link a machine" shows `code`. A refusal —
 * a wrong code, another link protocol, an address that does not answer — is an answer, not an
 * error of the call: `reason` is shown as it is.
 */
export const linkPair = invokeChannel(
  'link.pair',
  z.object({ address: z.string().min(1).max(300), code: z.string().regex(/^\d{6}$/) }),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('linked'), machine: z.object({ id: z.uuid(), name: z.string().min(1) }), state: linkStateSchema }),
    z.object({ status: z.literal('failed'), reason: z.string().min(1), state: linkStateSchema }),
  ]),
  'local',
)

/** Revokes Linked machine `id`; it loses the link at once when connected, else on its next connection. */
export const linkRevoke = invokeChannel('link.revoke', z.object({ id: z.uuid() }), linkStateSchema, 'local')

/** Sets "Linked machines can work with my Projects": off turns access off for every Linked machine. */
export const linkSetAccess = invokeChannel('link.setAccess', z.object({ projectsAccess: z.boolean() }), linkStateSchema, 'local')

/** Sets the access level of Linked machine `id` (worfy-link ticket 18). */
export const linkSetMachineAccess = invokeChannel('link.setMachineAccess', z.object({ id: z.uuid(), access: accessLevelSchema }), linkStateSchema, 'local')

/** Sets "Keep this computer awake while linked machines are connected". */
export const linkSetKeepAwake = invokeChannel('link.setKeepAwake', z.object({ keepAwake: z.boolean() }), linkStateSchema, 'local')

/** Sets "Link through Tailscale": off closes the connections from Tailscale addresses. */
export const linkSetTailscale = invokeChannel('link.setTailscale', z.object({ tailscale: z.boolean() }), linkStateSchema, 'local')

/** Sent to this Machine's windows after any change of the state. */
export const linkChanged = eventChannel('link.changed', linkStateSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'link.ping': typeof linkPing
    'link.state': typeof linkState
    'link.open': typeof linkOpen
    'link.close': typeof linkClose
    'link.pair': typeof linkPair
    'link.revoke': typeof linkRevoke
    'link.setAccess': typeof linkSetAccess
    'link.setMachineAccess': typeof linkSetMachineAccess
    'link.setKeepAwake': typeof linkSetKeepAwake
    'link.setTailscale': typeof linkSetTailscale
    'link.changed': typeof linkChanged
  }
}
