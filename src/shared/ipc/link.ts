// The `link` domain (worfy-link tickets 01 and 02; ADR-0052): this Machine as the link knows it,
// its Linked machines, "Link a machine" and the access switch. Handled in src/main/ipc/link.ts.
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

/** `host:port`, IPv6 in brackets: how an address is shown and typed. */
export function formatLinkAddress({ host, port }: LinkAddress): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

// ---- the state the UI shows ----------------------------------------------------------------------

/** A Linked machine as the sidebar shows it ("sleeping" comes with worfy-link ticket 14). */
export const linkedMachineViewSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  state: z.enum(['online', 'unavailable']),
  /** The last connection met another certificate: the Machine has to be linked again. */
  certificateChanged: z.boolean(),
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
  }),
  linked: z.array(linkedMachineViewSchema),
  discovered: z.array(discoveredMachineSchema),
  /** "Linked machines can work with my Projects"; off by default (ADR-0052, point 6). */
  projectsAccess: z.boolean(),
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

/** Sets "Linked machines can work with my Projects". */
export const linkSetAccess = invokeChannel('link.setAccess', z.object({ projectsAccess: z.boolean() }), linkStateSchema, 'local')

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
    'link.changed': typeof linkChanged
  }
}
