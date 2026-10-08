// The list of Linked machines (ADR-0052, points 2 and 4): link/linked.json in worfy's data folder,
// read and written through json-file.ts. Per Machine: its id and name, the address and port it was
// last seen at, the SHA-256 fingerprint of its certificate as this side saw it while linking, the
// SHA-256 hash of the token this side issued to it (the incoming token; never the token itself),
// and the secret-store key of the token this side presents to it (the outgoing token).
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
})

const linkedFileSchema = z.object({ version: z.literal(1), machines: z.array(linkedMachineSchema) })

export type LinkedMachineRecord = z.output<typeof linkedMachineSchema>

/** SHA-256 of a token, hex: what this side keeps of a token it issued. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
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
    this.save([...this.machines.filter((machine) => machine.id !== record.id), record])
  }

  /** Updates the address, port or name the Machine was last seen with; nothing when it is gone. */
  touch(id: string, change: Partial<Pick<LinkedMachineRecord, 'address' | 'port' | 'name'>>): void {
    const current = this.machines.find((machine) => machine.id === id)
    if (current === undefined) return
    const next = { ...current, ...change }
    if (next.address === current.address && next.port === current.port && next.name === current.name) return
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
