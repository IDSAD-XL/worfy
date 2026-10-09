// Notifications over the link (worfy-link ticket 13; the owner's decisions Q6 and Q16 in
// .scratch/worfy-link/spec.md; ADR-0053): the Machine of a Project decides what to notify about
// (src/main/notify.ts, Notifier), and hands each note to its own display and, through this module,
// to every connected Linked machine it shares its Projects with. Each Machine shows a note by its
// own rules: the focus of its own worfy window, its own 10 s per Session, and the Focus mode
// ("do not disturb") of its own OS, which applies by itself to a notification shown there.
//
// "Connected to the Project": the Linked machine has a connection to this Machine now, and this
// Machine's switch "Linked machines can work with my Projects" is on — the Projects that machine
// lists in its sidebar (worfy-link ticket 09). Without access a click could not open the Session
// there, so no note goes out while the switch is off.
//
// The note is the service message `note` of the link (src/main/link/messages.ts), not an IPC
// channel: it is not in the list of channels open to Linked machines (ipc-adapter.ts). It carries
// what the banner says and which Session a click opens; the receiver takes the sender's Machine
// from the connection, never from the message. A Machine that is not connected misses the note:
// nothing is kept for it, so no old notification comes after it is back. A received note is shown
// and goes no further: a Machine only sends notes about its own Sessions.
import { z } from 'zod'
import type { NoteLink, SharedNote } from '../notify'
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

type Followed = Pick<LinkService, 'settings' | 'linkedMachines' | 'isConnected' | 'registerMessage' | 'sendMessage'>

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The notes of one link service: sends this Machine's, hands on the Linked machines'. */
export class LinkNotes implements NoteLink {
  private readonly handlers = new Set<(machineId: string, note: SharedNote) => void>()
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
  }

  /** Sends `note` to every connected Linked machine while this Machine shares its Projects. */
  send(note: SharedNote): void {
    if (!this.service.settings.get().projectsAccess) return
    const payload = { title: note.title, body: note.body, sessionId: note.sessionId, projectRoot: note.projectRoot }
    for (const machine of this.service.linkedMachines()) {
      if (!this.service.isConnected(machine.id)) continue
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
}

/**
 * The notes of the app's link (src/main/index.ts). The link starts after notifications do, and may
 * not start at all: until it has, a note goes nowhere but this Machine's own display.
 */
export function appNoteLink(): NoteLink & { stop(): void } {
  let notes: { service: LinkService; link: LinkNotes } | undefined
  const handlers = new Set<(machineId: string, note: SharedNote) => void>()
  const follow = (): void => {
    const service = appLinkService()
    if (service === undefined || notes?.service === service) return
    const link = new LinkNotes(service)
    link.receive((machineId, note) => {
      for (const handler of handlers) handler(machineId, note)
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
    stop: () => {
      stopFollowing()
      handlers.clear()
    },
  }
}
