// The list of Linked machines (ADR-0052, points 2 and 4): link/linked.json in worfy's data folder,
// read and written through json-file.ts. Per Machine: its id and name, the address and port it was
// last seen at, the SHA-256 fingerprint of its certificate as this side saw it while linking, the
// SHA-256 hash of the token this side issued to it (the incoming token; never the token itself),
// and the secret-store key of the token this side presents to it (the outgoing token).
//
// Two names of the Machine are kept apart from the address (worfy-link ticket 36): its mDNS name
// (`<host>.local`) and its MagicDNS name (`<host>.<tailnet>.ts.net`). A dial tries them when the
// address does not answer (service.ts, connect). Either is kept when it was the address, and so
// stays when an address from Bonjour or the socket replaces it; the `.local` name is also learnt
// from a Bonjour announcement at the address of an open connection (LinkService.learnLocalName).
import { createHash, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

const linkedMachineSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  address: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  fingerprint: z.string().regex(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/),
  incomingTokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  outgoingTokenKey: z.string().min(1),
  linkedAt: z.string(),
  localName: z.string().min(1).optional(),
  tailnetName: z.string().min(1).optional(),
})

const linkedFileSchema = z.object({ version: z.literal(1), machines: z.array(linkedMachineSchema) })

export type LinkedMachineRecord = z.output<typeof linkedMachineSchema>

/** SHA-256 of a token, hex: what this side keeps of a token it issued. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** The names a record keeps apart from its address. */
export type LinkedMachineNames = Pick<LinkedMachineRecord, 'localName' | 'tailnetName'>

/** `address` as the name it keeps, when it is an mDNS or a MagicDNS name; {} for an IP address or another name. */
export function namesOf(address: string): LinkedMachineNames {
  const name = address.toLowerCase().replace(/\.$/, '')
  if (name.endsWith('.local')) return { localName: name }
  if (name.endsWith('.ts.net')) return { tailnetName: name }
  return {}
}

/** The secret-store key of the token presented to Machine `id`. */
export const outgoingTokenKey = (id: string): string => `outgoing:${id}`

export class LinkedMachineStore {
  private readonly file: string
  private machines: LinkedMachineRecord[]

  constructor(linkDir: string) {
    this.file = join(linkDir, 'linked.json')
    this.machines = readJsonFile(this.file, linkedFileSchema)?.machines ?? []
  }

  list(): LinkedMachineRecord[] {
    return this.machines.map((machine) => ({ ...machine }))
  }

  get(id: string): LinkedMachineRecord | undefined {
    const found = this.machines.find((machine) => machine.id === id)
    return found === undefined ? undefined : { ...found }
  }

  /** The Machine whose incoming token is `token`, compared by hash in constant time. */
  byToken(token: string): LinkedMachineRecord | undefined {
    const hash = Buffer.from(tokenHash(token), 'hex')
    const found = this.machines.find((machine) => timingSafeEqual(Buffer.from(machine.incomingTokenHash, 'hex'), hash))
    return found === undefined ? undefined : { ...found }
  }

  /** Adds a Machine or replaces the one with its id (linking again). */
  put(record: LinkedMachineRecord): void {
    this.save([...this.machines.filter((machine) => machine.id !== record.id), { ...record, ...namesOf(record.address) }])
  }

  /**
   * Updates the address, port, Machine name or `.local` name the Machine was last seen with;
   * nothing when it is gone. The old address and the new one, when they are names, are kept as such.
   */
  touch(id: string, change: Partial<Pick<LinkedMachineRecord, 'address' | 'port' | 'name' | 'localName' | 'tailnetName'>>): void {
    const current = this.machines.find((machine) => machine.id === id)
    if (current === undefined) return
    const next = { ...current, ...namesOf(current.address), ...change }
    Object.assign(next, namesOf(next.address))
    const keys = ['address', 'port', 'name', 'localName', 'tailnetName'] as const
    if (keys.every((key) => next[key] === current[key])) return
    this.save(this.machines.map((machine) => (machine.id === id ? next : machine)))
  }

  /** Forgets Machine `id`; true when it was there. */
  remove(id: string): boolean {
    if (!this.machines.some((machine) => machine.id === id)) return false
    this.save(this.machines.filter((machine) => machine.id !== id))
    return true
  }

  private save(machines: LinkedMachineRecord[]): void {
    writeJsonFile(this.file, linkedFileSchema, { version: 1, machines })
    this.machines = machines
  }
}
