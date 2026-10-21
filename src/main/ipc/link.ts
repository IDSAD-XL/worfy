// The `link` domain's handlers (worfy-link tickets 01, 02 and 14; ADR-0052): `link.ping` for windows
// and Linked machines, and for this Machine's windows the state of the link, "Link a machine",
// linking, revoking, the access switch, the access level of each Linked machine (worfy-link ticket
// 18) and the keep-awake switch.
//
// The state is built anew on every call and every change, from the app's link (service.ts,
// appLink): nothing here keeps a copy of the Linked machines. What only the UI has is kept here:
// which windows have "Link a machine" open, the Machine linked while it was open (the success both
// sides show), and the last failed attempt of another worfy.
//
// `link.changed` goes to this Machine's windows only, not to every client of main
// (src/main/broadcast.ts): it carries the pairing code, which a client without a window — the
// connection of a Linked machine, worfy-link ticket 08 — must never get.
//
// This module is also loaded by the IPC adapter of every link service (ipc-adapter.ts), in tests
// without Electron: it imports Electron only when it broadcasts, and follows the app's link only
// once a window has asked for its state.
import {
  linkChanged,
  linkClose,
  linkOpen,
  linkPair,
  linkPing,
  linkRevoke,
  linkSetAccess,
  linkSetKeepAwake,
  linkSetMachineAccess,
  linkState,
  parseLinkAddress,
  type LinkState,
} from '../../shared/ipc/link'
import { ClientHolders, clientOf, type Client, type ClientId } from '../clients'
import { localMachineOf } from '../link/ipc-adapter'
import { appLink, appLinkProblem, appLinkService, onAppLinkStart, type AppLink } from '../link/service'
import { defineHandler, emit, type HandlerModule } from './index'

/**
 * The windows with "Link a machine" open; linking stays open while there is one. A window that
 * goes away with it open closes it too: its `destroyed` is listened to once per window, however
 * often it opens the dialog (ClientHolders, src/main/clients.ts).
 */
export class LinkingWindows {
  private readonly open = new Set<ClientId>()
  private readonly holders: ClientHolders

  constructor(onLastGone: () => void) {
    this.holders = new ClientHolders((id) => {
      if (this.close(id)) onLastGone()
    })
  }

  /** Adds a window: 'first' when no other has it open, 'added', 'again' when it already had, 'gone' for a destroyed one. */
  add(client: Pick<Client, 'id' | 'once' | 'isDestroyed'>): 'first' | 'added' | 'again' | 'gone' {
    if (!this.holders.hold(client)) return 'gone'
    if (this.open.has(client.id)) return 'again'
    this.open.add(client.id)
    return this.open.size === 1 ? 'first' : 'added'
  }

  /** Removes a window; true when it was the last one with the dialog open. */
  close(id: ClientId): boolean {
    return this.open.delete(id) && this.open.size === 0
  }

  get size(): number {
    return this.open.size
  }
}

const openers = new LinkingWindows(() => void lastClosed())
/** The Machine linked while "Link a machine" was open: the success it shows. */
let linkedNow: { id: string; name: string } | null = null
/** The last failed attempt of another worfy to link to this one. */
let failure: string | null = null
let revision = 0
let followed: AppLink | undefined
let followingStart = false
let broadcastQueued = false
let expiryTimer: NodeJS.Timeout | null = null

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function notStarted(): Error {
  return new Error(appLinkProblem() ?? 'the link service has not started yet')
}

/** The app's link, followed from the first call on; throws while it has not started. */
function requireLink(): AppLink {
  follow()
  const link = appLink()
  if (link === undefined) throw notStarted()
  return link
}

/** Starts following the app's link: its changes are sent to the windows from now on. */
function follow(): void {
  if (!followingStart) {
    followingStart = true
    onAppLinkStart(() => {
      follow()
      changed()
    })
  }
  const link = appLink()
  if (link === undefined || followed === link) return
  followed = link
  const { service, connections, discovery } = link
  for (const event of ['status', 'pairing-code', 'pairing-paused', 'unlinked', 'connected', 'disconnected', 'certificate-changed', 'settings'] as const) {
    service.on(event, changed)
  }
  service.on('pairing-failed', ({ message }) => {
    failure = message
    changed()
  })
  service.on('linked', (info) => {
    if (openers.size > 0) linkedNow = { id: info.id, name: info.name }
    failure = null
    changed()
  })
  connections.on('changed', changed)
  discovery?.on('changed', changed)
  link.sleep.on('changed', changed)
}

/** Something changed: one broadcast per turn of the event loop, however many changes came. */
function changed(): void {
  revision += 1
  if (broadcastQueued) return
  broadcastQueued = true
  setImmediate(() => {
    broadcastQueued = false
    void broadcast()
  })
}

async function broadcast(): Promise<void> {
  try {
    const { BrowserWindow } = await import('electron')
    const state = buildState()
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      emit(window.webContents, linkChanged, state)
    }
  } catch (error) {
    console.error(`[link] could not send the link state to the windows: ${messageOf(error)}`)
  }
}

/** A new state when the code shown now expires: the service then shows a new one. */
function scheduleExpiry(expiresAt: number | null): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer)
  expiryTimer = null
  if (expiresAt === null) return
  expiryTimer = setTimeout(changed, Math.max(0, expiresAt - Date.now()) + 50)
  expiryTimer.unref()
}

function buildState(): LinkState {
  const link = appLink()
  if (link === undefined) {
    return {
      revision,
      machine: null,
      problem: appLinkProblem() ?? null,
      listening: false,
      addresses: [],
      bonjour: false,
      linking: { open: openers.size > 0, code: null, expiresAt: null, linked: null, failure: null },
      linked: [],
      discovered: [],
      projectsAccess: false,
      keepAwake: false,
    }
  }
  const { service, discovery, sleep } = link
  const status = service.status()
  const settings = service.settings.get()
  const pairing = openers.size > 0 ? service.pairingCode() : null
  const pausedUntil = openers.size > 0 ? service.pairingPausedUntil() : null
  scheduleExpiry(pairing?.expiresAt ?? null)
  return {
    revision,
    machine: service.machine,
    problem: status.problem,
    listening: status.listening,
    addresses: service.addresses(),
    bonjour: discovery !== null,
    linking: {
      open: openers.size > 0,
      code: pairing?.code ?? null,
      expiresAt: pairing?.expiresAt ?? null,
      linked: openers.size > 0 ? linkedNow : null,
      failure: openers.size > 0 ? failure : null,
      ...(pausedUntil === null ? {} : { pausedUntil }),
    },
    linked: service.linkedMachines().map((machine) => ({
      id: machine.id,
      name: machine.name,
      state: sleep.stateOf(machine),
      certificateChanged: machine.certificateChanged,
      access: settings.machines[machine.id] ?? 'off',
    })),
    discovered: discovery === null || openers.size === 0 ? [] : discovery.list(),
    projectsAccess: settings.projectsAccess,
    keepAwake: settings.keepAwake,
  }
}

/** The last window closed "Link a machine": linking closes on the service. */
async function lastClosed(): Promise<void> {
  linkedNow = null
  failure = null
  const link = appLink()
  link?.discovery?.browse('linking', false)
  await link?.service.closeLinking()
  changed()
}

export default [
  // A call over the link answers for the link service it came through (one process may run several
  // in tests); a window's call, for the app's link service.
  defineHandler(linkPing, (_input, { event }) => {
    const machine = localMachineOf(event) ?? appLinkService()?.localMachine()
    if (machine === undefined) throw notStarted()
    return machine
  }),

  defineHandler(linkState, () => {
    follow()
    return buildState()
  }),

  defineHandler(linkOpen, async (_input, { event }) => {
    const { service, discovery } = requireLink()
    const client: Client | undefined = clientOf(event)
    if (client !== undefined && openers.add(client) === 'first') {
      linkedNow = null
      failure = null
    }
    // Opens again after the service closed linking itself (too many failed attempts in a row); stays
    // closed while it is paused (too many within the hour), and the state says until when.
    await service.openLinking()
    discovery?.browse('linking', true)
    changed()
    return buildState()
  }),

  defineHandler(linkClose, async (_input, { event }) => {
    follow()
    const client = clientOf(event)
    if (client !== undefined && openers.close(client.id)) await lastClosed()
    return buildState()
  }),

  defineHandler(linkPair, async ({ address, code }) => {
    const { service } = requireLink()
    const parsed = parseLinkAddress(address)
    if (!parsed.ok) return { status: 'failed' as const, reason: parsed.error, state: buildState() }
    try {
      const info = await service.pair({ host: parsed.address.host, port: parsed.address.port, code })
      return { status: 'linked' as const, machine: { id: info.id, name: info.name }, state: buildState() }
    } catch (error) {
      // The texts of pairing.ts and client.ts never carry the code (ADR-0052, point 10).
      return { status: 'failed' as const, reason: messageOf(error), state: buildState() }
    }
  }),

  defineHandler(linkRevoke, ({ id }) => {
    const { service } = requireLink()
    if (!service.isLinked(id)) throw new Error(`Machine ${id} is not linked`)
    service.revoke(id)
    return buildState()
  }),

  defineHandler(linkSetAccess, ({ projectsAccess }) => {
    const { service } = requireLink()
    service.settings.set({ projectsAccess })
    return buildState()
  }),

  defineHandler(linkSetMachineAccess, ({ id, access }) => {
    const { service } = requireLink()
    // A level is kept only for a Machine linked now; revoking clears it (service.ts).
    if (!service.isLinked(id)) throw new Error(`Machine ${id} is not linked`)
    service.settings.setLevel(id, access)
    return buildState()
  }),

  defineHandler(linkSetKeepAwake, ({ keepAwake }) => {
    const { service } = requireLink()
    service.settings.set({ keepAwake })
    return buildState()
  }),
] satisfies HandlerModule
