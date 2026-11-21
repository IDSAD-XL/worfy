// The rules of the Integrations screen without React (worfy-integrations ticket 08): the secrets an Integration's
// sign-in needs and how they are kept, the names of the ways to sign in, the addresses a token may go to, and the
// catalogue service a server of Claude Code is of.
import { CATALOGUE, type CatalogueEntry } from '../../shared/integrations/catalogue'
import type { Integration, IntegrationAuth, IntegrationSecretPart, IntegrationStatus } from '../../shared/integrations/types'
import { invoke } from '../ipc'

/** Whether the Integration signs in with secrets typed into worfy: a token, a header or secret variables, not OAuth. */
export const usesToken = (integration: Integration): boolean => integration.auth !== 'oauth'

/** Labels are unique on the Machine, compared without case and the spaces around them (the store's rule). */
export const sameLabel = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/** What `<id>:access` keeps for Basic: `<e-mail>:<token>`; null with the reason when the pair cannot be kept. */
export function basicPair(email: string, token: string): { value: string } | { problem: string } {
  const address = email.trim()
  if (address === '') return { problem: 'Needs the e-mail.' }
  if (address.includes(':')) return { problem: 'The e-mail cannot have a colon in it.' }
  if (token === '') return { problem: 'Needs the token.' }
  return { value: `${address}:${token}` }
}

/** Keeps `secrets` of Integration `id` in order, the token last, so its check runs with every other part kept. */
export async function keepSecrets(id: string, secrets: readonly { part: IntegrationSecretPart; value: string }[]): Promise<{ status: IntegrationStatus } | { problem: string }> {
  let status: IntegrationStatus = { state: 'needs-sign-in' }
  const ordered = [...secrets.filter((secret) => secret.part !== 'access'), ...secrets.filter((secret) => secret.part === 'access')]
  for (const secret of ordered) {
    const result = await invoke('integrations.setSecret', { id, part: secret.part, value: secret.value })
    if (!result.ok) return { problem: result.error }
    status = result.value.status
  }
  return { status }
}

/** The fields of an Integration's secrets: what each part is called on the screen. */
export function secretFields(integration: Integration): { part: IntegrationSecretPart | 'email'; label: string; secret: boolean }[] {
  const fields: { part: IntegrationSecretPart | 'email'; label: string; secret: boolean }[] = []
  if (integration.auth === 'basic') fields.push({ part: 'email', label: 'E-mail', secret: false }, { part: 'access', label: 'API token', secret: true })
  if (integration.auth === 'bearer') fields.push({ part: 'access', label: 'API token', secret: true })
  if (integration.auth === 'header') fields.push({ part: 'access', label: `${integration.headerName ?? 'Header'} value`, secret: true })
  if (integration.transport.kind === 'stdio') for (const name of integration.transport.secretEnv) fields.push({ part: `env:${name}`, label: `Value of ${name}`, secret: true })
  return fields
}

/** The values of `fields` as the secret store keeps them: Basic's e-mail and token become one pair. */
export function secretsOf(fields: ReturnType<typeof secretFields>, values: Readonly<Record<string, string>>): { secrets: { part: IntegrationSecretPart; value: string }[] } | { problem: string } {
  const secrets: { part: IntegrationSecretPart; value: string }[] = []
  const basic = fields.some((field) => field.part === 'email')
  for (const field of fields) {
    if (field.part === 'email') continue
    const value = values[field.part] ?? ''
    if (basic && field.part === 'access') {
      const pair = basicPair(values.email ?? '', value)
      if ('problem' in pair) return pair
      secrets.push({ part: 'access', value: pair.value })
      continue
    }
    if (value === '') return { problem: `Needs ${field.label}.` }
    secrets.push({ part: field.part, value })
  }
  return { secrets }
}

/** The name of a way to sign in, for the service `entry`. */
export function wayName(entry: CatalogueEntry, auth: IntegrationAuth): string {
  switch (auth) {
    case 'oauth':
      return `Sign in with ${entry.key === 'custom' ? 'the server' : entry.defaultLabel === 'Jira' ? 'Atlassian' : entry.defaultLabel}`
    case 'bearer':
      return entry.key === 'atlassian' ? 'Service account token' : entry.key === 'github' ? 'Personal access token' : 'Token'
    case 'basic':
      return 'API token (e-mail and token)'
    case 'header':
      return 'A header of its own'
    case 'none':
      return 'No sign-in'
  }
}

/** The ways the screen offers for `entry` now: OAuth comes with the next ticket; Basic for a custom server is not offered. */
export const offered = (entry: CatalogueEntry): IntegrationAuth[] => entry.auth.filter((auth) => auth !== 'oauth' && !(entry.key === 'custom' && auth === 'basic'))

/** An address a token may go to: https, or http on this computer only (a local server, a stub). */
export function addressProblem(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return 'An address such as https://example.com/mcp.'
  }
  if (parsed.protocol === 'https:') return null
  if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) return null
  return 'Only https:// addresses (http:// only on this computer).'
}

/** Other names of a service in a server's name. */
const ALIASES: Readonly<Record<string, readonly string[]>> = { atlassian: ['jira', 'confluence'] }

/** The catalogue service a server of Claude Code is of, by its name; null for none (or for several). */
export function serviceOfServer(name: string): string | null {
  const lower = name.toLocaleLowerCase()
  const found = CATALOGUE.filter((entry) => entry.server.kind === 'http' && [entry.key, ...(ALIASES[entry.key] ?? [])].some((word) => lower.includes(word)))
  return found.length === 1 ? found[0]!.key : null
}
