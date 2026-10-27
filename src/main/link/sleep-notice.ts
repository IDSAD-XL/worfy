// "Going to sleep" between Machines, and the state "sleeping" of a Linked machine (worfy-link ticket
// 14; the owner's decision Q17 in .scratch/worfy-link/spec.md: a Machine that went to sleep is shown
// as sleeping, Wake-on-LAN comes later).
//
// Sending: on powerMonitor's `suspend` this Machine sends the service message `sleeping` to every
// connected Linked machine; on `resume`, `awake` to those whose connection survived. The others
// reconnect by the rules of worfy-link ticket 02 (connections.ts). `resume` is also the event
// `resumed`: the app's link dials the unavailable Linked machines at once and announces this Machine
// again on Bonjour (service.ts, wireAppLink; worfy-link ticket 36).
//
// Receiving: `sleeping` marks the sender "sleeping" until a connection to it opens again, or it
// says `awake`; the connection dropping after the message does not change it. When the message does
// not get through before the sleep, the sender is "unavailable", as it was before this ticket. A
// revoked Machine loses the mark with its record.
//
// The receiver logs the message with the Machine and the time it came, never a token or an
// address: the live check of the ticket compares that time with the moment of the sleep.
import { EventEmitter } from 'node:events'
import { z } from 'zod'
import type { LinkedMachineView } from '../../shared/ipc/link'
import { defineLinkMessage } from './messages'
import type { LinkedMachineInfo, LinkService } from './service'

/** The sender is going to sleep (powerMonitor `suspend`). */
export const sleepingMessage = defineLinkMessage('sleeping', z.object({}))

/** The sender woke up (powerMonitor `resume`) and this connection survived. */
export const awakeMessage = defineLinkMessage('awake', z.object({}))

/** The part of Electron's powerMonitor this module listens to; tests pass an EventEmitter. */
export interface PowerEvents {
  on(event: 'suspend' | 'resume', listener: () => void): unknown
  removeListener(event: 'suspend' | 'resume', listener: () => void): unknown
}

export interface SleepNoticeOptions {
  /** Electron's powerMonitor; without it this Machine only receives. */
  power?: PowerEvents
  /** Where the line about a received `sleeping` goes; console.log by default. */
  log?: (message: string) => void
  now?: () => number
}

type Followed = Pick<LinkService, 'on' | 'off' | 'linkedMachines' | 'isConnected' | 'registerMessage' | 'sendMessage'>

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class SleepNotice extends EventEmitter<{ changed: []; resumed: [] }> {
  private readonly sleeping = new Set<string>()
  private readonly log: (message: string) => void
  private readonly now: () => number
  private stopped = false
  private readonly onConnected = ({ id }: { id: string }): void => this.wake(id)
  private readonly onUnlinked = ({ id }: { id: string }): void => this.wake(id)
  private readonly onSuspend = (): void => this.tell(sleepingMessage, 'going to sleep')
  private readonly onResume = (): void => {
    this.tell(awakeMessage, 'awake again')
    if (!this.stopped) this.emit('resumed')
  }

  constructor(
    private readonly service: Followed,
    private readonly options: SleepNoticeOptions = {},
  ) {
    super()
    this.log = options.log ?? ((message) => console.log(message))
    this.now = options.now ?? Date.now
    service.registerMessage(sleepingMessage, (_payload, from) => this.received(from.machineId))
    service.registerMessage(awakeMessage, (_payload, from) => this.wake(from.machineId))
    // A new connection, in either direction, means the Machine is awake.
    service.on('connected', this.onConnected)
    service.on('unlinked', this.onUnlinked)
    options.power?.on('suspend', this.onSuspend)
    options.power?.on('resume', this.onResume)
  }

  isSleeping(machineId: string): boolean {
    return this.sleeping.has(machineId)
  }

  /** The state the UI shows for a Linked machine: "sleeping" wins over a connection not yet dropped. */
  stateOf(machine: Pick<LinkedMachineInfo, 'id' | 'connected'>): LinkedMachineView['state'] {
    if (this.sleeping.has(machine.id)) return 'sleeping'
    return machine.connected ? 'online' : 'unavailable'
  }

  /** Follows the service and the power monitor no more (the link stops); the received marks are dropped. */
  stop(): void {
    this.stopped = true
    this.service.off('connected', this.onConnected)
    this.service.off('unlinked', this.onUnlinked)
    this.options.power?.removeListener('suspend', this.onSuspend)
    this.options.power?.removeListener('resume', this.onResume)
    this.sleeping.clear()
  }

  private received(machineId: string): void {
    if (this.stopped) return
    const name = this.service.linkedMachines().find((machine) => machine.id === machineId)?.name ?? 'unknown'
    this.log(`[link] Machine ${machineId} (${name}) is going to sleep (${new Date(this.now()).toISOString()})`)
    if (this.sleeping.has(machineId)) return
    this.sleeping.add(machineId)
    this.emit('changed')
  }

  private wake(machineId: string): void {
    if (this.sleeping.delete(machineId)) this.emit('changed')
  }

  /** Sends `message` to every connected Linked machine; one that cannot be reached is skipped. */
  private tell(message: typeof sleepingMessage, what: string): void {
    if (this.stopped) return
    let told = 0
    for (const machine of this.service.linkedMachines()) {
      if (!this.service.isConnected(machine.id)) continue
      try {
        this.service.sendMessage(machine.id, message, {})
        told += 1
      } catch (error) {
        console.warn(`[link] could not tell Machine ${machine.id} (${machine.name}) this one is ${what}: ${messageOf(error)}`)
      }
    }
    if (told > 0) this.log(`[link] this Machine is ${what}; told ${told} Linked machine${told === 1 ? '' : 's'} (${new Date(this.now()).toISOString()})`)
  }
}
