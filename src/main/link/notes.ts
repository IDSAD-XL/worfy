// Notifications over the link (worfy-link ticket 13; the owner's decisions Q6 and Q16 in
// .scratch/worfy-link/spec.md; ADR-0053): the Machine of a Project decides what to notify about
// (src/main/notify.ts, Notifier), and hands each note to its own display and, through this module,
// to every connected Linked machine it shares its Projects with. Each Machine shows a note by its
// own rules: the focus of its own worfy window, its own 10 s per Session, and the Focus mode
// ("do not disturb") of its own OS, which applies by itself to a notification shown there.
//
// "Connected to the Project": the Linked machine has a connection to this Machine now, and its
// access to this Machine's Projects is on — "Linked machines can work with my Projects" on and its
// own level `read` or `all` (worfy-link ticket 18): the Projects that machine lists in its sidebar
// (worfy-link ticket 09). Without access a click could not open the Session there, so no note goes
// to a Machine whose access is off. Read-only access gets the notes: the owner counts them as
// reading, as Session transcripts.
//
// The note is the service message `note` of the link (src/main/link/messages.ts), not an IPC
// channel: it is not in the list of channels open to Linked machines (ipc-adapter.ts). It carries
// what the banner says and which Session a click opens; the receiver takes the sender's Machine
// from the connection, never from the message. A Machine that is not connected misses the note:
// nothing is kept for it, so no old notification comes after it is back. A received note is shown
// and goes no further: a Machine only sends notes about its own Sessions.
//
// A Ticket that comes to wait for the owner or for a Machine (worfy-pipeline ticket 10, the owner's
// decisions Q12-Q16) travels as its own message, `ticket-note`, added after ADR-0079: it goes only
// to a Machine whose `hello` named it in `accepts`, so a build before it gets none and its link
// works as before. Whom it goes to is decided in src/main/notify.ts (ticketRecipients); this module
// adds the same rule of access as `note`. The message names the Project by its id, name and match
// key (src/main/autopilot/origin.ts, projectMatchKey), never by a local path.
import { z } from 'zod'
import type { NoteLink, SharedNote, SharedTicketNote, TicketLink } from '../notify'
import { defineLinkMessage } from './messages'
import { appLinkService, onAppLinkStart, type LinkService } from './service'

/** One notification of a Session of the sender's Projects. */
export const noteMessage = defineLinkMessage(
  'note',
  z.object({
    title: z.string().max(1000),
    body: z.string().max(1000),
    /** A Session the sender runs (its id for `agent.*` or its SDK id), or one from its registry under ~/.claude. */
    sessionId: z.string().min(1).max(1000),
    /** The sender's Project root of a Session from its registry; null for a Session it runs. */
    projectRoot: z.string().min(1).max(4096).nullable(),
  }),
)

/** One notification of a Ticket of the sender's Projects that came to wait for the owner or a Machine. */
export const ticketNoteMessage = defineLinkMessage(
  'ticket-note',
  z.object({
    title: z.string().max(1000),
    body: z.string().max(1000),
    /** The sender's Project: its id and name, and the key that finds the same repository on the receiver. */
    project: z.object({
      id: z.string().min(1).max(1000),
      name: z.string().min(1).max(1000),
      match: z.string().min(1).max(4096),
    }),
    epic: z.string().min(1).max(200),
    num: z.number().int().nonnegative().max(1_000_000),
    /** The key of the wait (src/main/workflow/waits-notify.ts, waitKey): one wait, one notification. */
    wait: z.string().min(1).max(4096),
  }),
)

type Followed = Pick<LinkService, 'machine' | 'settings' | 'linkedMachines' | 'isConnected' | 'accepts' | 'registerMessage' | 'sendMessage'>

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The notes of one link service: sends this Machine's, hands on the Linked machines'. */
export class LinkNotes implements NoteLink, TicketLink {
  private readonly handlers = new Set<(machineId: string, note: SharedNote) => void>()
  private readonly ticketHandlers = new Set<(machineId: string, note: SharedTicketNote) => void>()
  private readonly warn: (message: string) => void

  constructor(
    private readonly service: Followed,
    /** Warnings for the worfy log, never with a note's text; console.warn by default. */
    options: { warn?: (message: string) => void } = {},
  ) {
    this.warn = options.warn ?? ((message) => console.warn(message))
    service.registerMessage(noteMessage, (note, { machineId }) => {
      for (const handler of this.handlers) handler(machineId, note)
    })
    service.registerMessage(ticketNoteMessage, (note, { machineId }) => {
      for (const handler of this.ticketHandlers) handler(machineId, note)
    })
  }

  /** Sends `note` to every connected Linked machine this Machine shares its Projects with. */
  send(note: SharedNote): void {
    const payload = { title: note.title, body: note.body, sessionId: note.sessionId, projectRoot: note.projectRoot }
    for (const machine of this.service.linkedMachines()) {
      if (this.service.settings.levelOf(machine.id) === 'off' || !this.service.isConnected(machine.id)) continue
      try {
        this.service.sendMessage(machine.id, noteMessage, payload)
      } catch (error) {
        // The connection closed between the check and the send: the note is missed, as when it was not there.
        this.warn(`[link] a notification did not go to Machine ${machine.id}: ${messageOf(error)}`)
      }
    }
  }

  /** Calls `handler` with each note a Linked machine sends; answers the function that stops it. */
  receive(handler: (machineId: string, note: SharedNote) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /**
   * Sends a Ticket's note to the Linked machines `to` names (every one for 'all'), of those this
   * Machine shares its Projects with (as `send`) and that accept `ticket-note` (ADR-0079).
   */
  sendTicket(note: SharedTicketNote, to: 'all' | readonly string[]): void {
    // Field by field: whatever else the caller's object holds stays here.
    const payload = { title: note.title, body: note.body, project: { id: note.project.id, name: note.project.name, match: note.project.match }, epic: note.epic, num: note.num, wait: note.wait }
    for (const machine of this.service.linkedMachines()) {
      if (to !== 'all' && !to.includes(machine.id)) continue
      if (this.service.settings.levelOf(machine.id) === 'off' || !this.service.accepts(machine.id, ticketNoteMessage)) continue
      try {
        this.service.sendMessage(machine.id, ticketNoteMessage, payload)
      } catch (error) {
        this.warn(`[link] a notification of a Ticket did not go to Machine ${machine.id}: ${messageOf(error)}`)
      }
    }
  }

  /** Calls `handler` with each Ticket's note a Linked machine sends; answers the function that stops it. */
  receiveTicket(handler: (machineId: string, note: SharedTicketNote) => void): () => void {
    this.ticketHandlers.add(handler)
    return () => this.ticketHandlers.delete(handler)
  }

  /** This Machine's name and the Linked machines', as Settings → Machines shows them. */
  machines(): { self: string | null; linked: { id: string; name: string }[] } {
    return { self: this.service.machine.name, linked: this.service.linkedMachines().map((machine) => ({ id: machine.id, name: machine.name })) }
  }
}

/**
 * The notes of the app's link (src/main/index.ts). The link starts after notifications do, and may
 * not start at all: until it has, a note goes nowhere but this Machine's own display.
 */
export function appNoteLink(): NoteLink & TicketLink & { stop(): void } {
  let notes: { service: LinkService; link: LinkNotes } | undefined
  const handlers = new Set<(machineId: string, note: SharedNote) => void>()
  const ticketHandlers = new Set<(machineId: string, note: SharedTicketNote) => void>()
  const follow = (): void => {
    const service = appLinkService()
    if (service === undefined || notes?.service === service) return
    const link = new LinkNotes(service)
    link.receive((machineId, note) => {
      for (const handler of handlers) handler(machineId, note)
    })
    link.receiveTicket((machineId, note) => {
      for (const handler of ticketHandlers) handler(machineId, note)
    })
    notes = { service, link }
  }
  const stopFollowing = onAppLinkStart(follow)
  follow()
  return {
    send: (note) => notes?.link.send(note),
    receive: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    sendTicket: (note, to) => notes?.link.sendTicket(note, to),
    receiveTicket: (handler) => {
      ticketHandlers.add(handler)
      return () => ticketHandlers.delete(handler)
    },
    // Before the link has started this Machine has no name of its own yet: no Machine name matches.
    machines: () => notes?.link.machines() ?? { self: null, linked: [] },
    stop: () => {
      stopFollowing()
      handlers.clear()
      ticketHandlers.clear()
    },
  }
}
