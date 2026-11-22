// The Integrations of this Machine (worfy-integrations ticket 03; ADR-0111). An Integration belongs to the Machine
// and a Project enables it (owner's answer Q2); which Project uses which is in the Project's settings.json
// (src/main/projects/settings.ts), not here.
//
// Two files in <WORFY_DATA_DIR>/integrations:
// - integrations.json — the list, with no secret in it, through json-file.ts: a write goes to a temporary file
//   and is renamed over the list, so a write cut short leaves the old list or the new one;
// - secrets.json — the tokens, the OAuth client and the secret variables of stdio servers, in a FileSecretStore of
//   its own (src/main/link/secrets.ts): 0600 in a 0700 folder, under `<id>:access`, `<id>:refresh`,
//   `<id>:client` and `<id>:env:<NAME>` (owner's answer Q3; not Electron's safeStorage, for the reason secrets.ts
//   gives). The folder is the one of the list, so the list sits in the 0700 folder too.
// A label is unique on the Machine, compared without case and without the spaces around it.
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { catalogueEntry } from '../../shared/integrations/catalogue'
import {
  integrationLabelSchema,
  integrationSchema,
  type Integration,
  type IntegrationAuth,
  type IntegrationSecretPart,
  type IntegrationSignIn,
  type IntegrationTransport,
} from '../../shared/integrations/types'
import { FileSecretStore, SECRET_DIR_MODE, type SecretStore } from '../link/secrets'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { dataRoot } from '../storage/paths'

export const INTEGRATIONS_FILE = 'integrations.json'
export const INTEGRATION_SECRETS_FILE = 'secrets.json'

const integrationsFileSchema = z.object({ version: z.literal(1), integrations: z.array(integrationSchema) })

/** The folder of the Machine's Integrations: <WORFY_DATA_DIR>/integrations. */
export function integrationsDir(root: string = dataRoot()): string {
  return join(root, 'integrations')
}

/** The key of a secret of Integration `id` in the secret store. */
export function secretKey(id: string, part: IntegrationSecretPart): string {
  return `${id}:${part}`
}

/** A label another Integration of the Machine already has. */
export class LabelTakenError extends Error {
  constructor(readonly label: string) {
    super(`an Integration named "${label}" is already on this Machine`)
  }
}

/** What Add integration gives: the service, the label and the way to sign in; the custom server also its transport. */
export interface NewIntegration {
  service: string
  label: string
  auth: IntegrationAuth
  /** Required for the custom server; a catalogue service takes its own address and refuses another. */
  transport?: IntegrationTransport
  /** The header the token goes in, for `header`. */
  headerName?: string
}

const sameLabel = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

export class IntegrationStore {
  private readonly secrets: SecretStore

  /** Does no I/O: the files are read on first use. */
  constructor(
    private readonly dir: string,
    secrets?: SecretStore,
  ) {
    this.secrets = secrets ?? new FileSecretStore(join(dir, INTEGRATION_SECRETS_FILE))
  }

  private get file(): string {
    return join(this.dir, INTEGRATIONS_FILE)
  }

  /** The Integrations of the Machine, in the order they were added. Read from the file on every call. */
  list(): Integration[] {
    return readJsonFile(this.file, integrationsFileSchema)?.integrations ?? []
  }

  /**
   * The Integrations of the Machine when the list is known whole: its file read as it is and none of it set aside as
   * unreadable (readJsonFile moves a damaged file or one of another version to `integrations.json.unreadable-…` and
   * reads as empty from then on). null otherwise: an empty list then is not the Machine's, and every Integration a
   * Project names would look removed (worfy-integrations ticket 08, Clean up).
   */
  wholeList(): Integration[] | null {
    const integrations = this.list()
    if (!existsSync(this.file)) return null
    return this.setAsideFile() === null ? integrations : null
  }

  /**
   * The name of a copy of the list set aside as unreadable (`integrations.json.unreadable-…`), the newest when there are
   * several; null when there is none. While one is there, Clean up waits (worfy-integrations ticket 09: Settings says so).
   */
  setAsideFile(): string | null {
    this.list()
    if (!existsSync(this.dir)) return null
    const names = readdirSync(this.dir).filter((name) => name.startsWith(`${INTEGRATIONS_FILE}.unreadable-`)).sort()
    return names.at(-1) ?? null
  }

  get(id: string): Integration | undefined {
    return this.list().find((integration) => integration.id === id)
  }

  private save(integrations: readonly Integration[]): void {
    // The folder holds secrets.json too: 0700 from the first write, whichever file comes first.
    mkdirSync(this.dir, { recursive: true, mode: SECRET_DIR_MODE })
    chmodSync(this.dir, SECRET_DIR_MODE)
    writeJsonFile(this.file, integrationsFileSchema, { version: 1, integrations: [...integrations] })
  }

  private existing(id: string): Integration {
    const integration = this.get(id)
    if (integration === undefined) throw new Error(`no Integration ${id} on this Machine`)
    return integration
  }

  /** Adds an Integration under a new random id; a label taken on the Machine throws LabelTakenError. */
  add(input: NewIntegration): Integration {
    const entry = catalogueEntry(input.service)
    if (entry === undefined) throw new Error(`the catalogue has no service "${input.service}"`)
    if (!entry.auth.includes(input.auth)) throw new Error(`${entry.name} does not sign in with ${input.auth}`)
    let transport: IntegrationTransport
    if (entry.server.kind === 'http') {
      if (input.transport !== undefined && (input.transport.kind !== 'http' || input.transport.url !== entry.server.url)) {
        throw new Error(`${entry.name} has its own address, ${entry.server.url}`)
      }
      transport = { kind: 'http', url: entry.server.url }
    } else {
      if (input.transport === undefined) throw new Error('a custom server needs an address or a command')
      transport = input.transport
    }
    if (input.auth === 'header' && input.headerName === undefined) throw new Error('sign-in with a header needs the header name')
    const label = integrationLabelSchema.parse(input.label)
    const integrations = this.list()
    if (integrations.some((other) => sameLabel(other.label, label))) throw new LabelTakenError(label)
    let id = randomBytes(8).toString('hex')
    while (integrations.some((other) => other.id === id)) id = randomBytes(8).toString('hex')
    const integration = integrationSchema.parse({
      id,
      service: entry.key,
      label,
      transport,
      auth: input.auth,
      headerName: input.auth === 'header' ? (input.headerName ?? null) : null,
      signIn: null,
    })
    this.save([...integrations, integration])
    return integration
  }

  /** Gives Integration `id` another label; one taken by another Integration of the Machine throws LabelTakenError. */
  rename(id: string, label: string): Integration {
    this.existing(id)
    const next = integrationLabelSchema.parse(label)
    const integrations = this.list()
    if (integrations.some((other) => other.id !== id && sameLabel(other.label, next))) throw new LabelTakenError(next)
    const renamed = integrations.map((integration) => (integration.id === id ? { ...integration, label: next } : integration))
    this.save(renamed)
    return this.existing(id)
  }

  /** Records what the last sign-in showed (null — signed out). Ticket 04 and 05 call it. */
  setSignIn(id: string, signIn: IntegrationSignIn | null): Integration {
    this.existing(id)
    this.save(this.list().map((integration) => (integration.id === id ? { ...integration, signIn } : integration)))
    return this.existing(id)
  }

  /** The secret parts an Integration may have: its tokens, its OAuth client and its secret variables. */
  private parts(integration: Integration): IntegrationSecretPart[] {
    const env = integration.transport.kind === 'stdio' ? integration.transport.secretEnv.map((name): IntegrationSecretPart => `env:${name}`) : []
    return ['access', 'refresh', 'client', ...env]
  }

  /** Keeps a secret of Integration `id`; a secret variable its transport does not name throws. The value is never in a message. */
  setSecret(id: string, part: IntegrationSecretPart, value: string): void {
    const integration = this.existing(id)
    if (!this.parts(integration).includes(part)) throw new Error(`Integration ${id} has no secret ${part}`)
    this.secrets.set(secretKey(id, part), value)
  }

  /** Whether a secret of Integration `id` is kept; the value itself never leaves main through here. */
  hasSecret(id: string, part: IntegrationSecretPart): boolean {
    return this.secrets.get(secretKey(id, part)) !== undefined
  }

  /** The secret itself, for the proxy and the sign-in in main (tickets 04–06); never for a channel. */
  secret(id: string, part: IntegrationSecretPart): string | undefined {
    return this.secrets.get(secretKey(id, part))
  }

  /** Removes every secret of Integration `id` and keeps the Integration: Sign out (ticket 04). */
  deleteSecrets(id: string): void {
    for (const part of this.parts(this.existing(id))) this.secrets.delete(secretKey(id, part))
  }

  /**
   * Removes Integration `id` and every secret of it. The secrets go first: a remove cut short leaves an
   * Integration without its sign-in, never a secret without its Integration.
   */
  remove(id: string): void {
    const integration = this.get(id)
    if (integration === undefined) return
    for (const part of this.parts(integration)) this.secrets.delete(secretKey(id, part))
    this.save(this.list().filter((other) => other.id !== id))
  }
}

let machineStore: IntegrationStore | undefined

/** The Integrations of this Machine, in worfy's data folder. */
export function integrationStore(): IntegrationStore {
  machineStore ??= new IntegrationStore(integrationsDir())
  return machineStore
}
