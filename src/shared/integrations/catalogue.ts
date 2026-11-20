// The catalogue of services an Integration starts from (worfy-integrations ticket 03; ADR-0111). Each row is data:
// the address, the ways to sign in, the OAuth scopes, a hint, where to get a token and the default name. A new
// service is a new row, not code. The first version (spec, "decided without the owner", 5): Jira and Confluence, Linear,
// Notion, Sentry, GitHub, Figma and a custom server. Slack is not here (owner's answer Q6, 2026-11-20): its server
// lets in only a registered Slack app with a secret, so Slack stays with the claude.ai connector.
// The addresses and what each server takes are the spec's facts 5 and 7 (checked 2026-11-20).
import type { IntegrationAuth } from './types'

/** Where the service's server is: a fixed https address, or the custom server, whose address the user gives. */
export type CatalogueServer = { readonly kind: 'http'; readonly url: string } | { readonly kind: 'custom'; readonly transports: readonly ['http', 'stdio'] }

export interface CatalogueEntry {
  /** The key an Integration keeps in `service`. */
  readonly key: string
  /** The service's name in Add integration. */
  readonly name: string
  /** The label a new Integration of the service starts with; the user adds «— client A». */
  readonly defaultLabel: string
  readonly server: CatalogueServer
  /** The ways to sign in, the first one offered first. */
  readonly auth: readonly IntegrationAuth[]
  /** OAuth scopes to ask for; empty — the scopes the server's metadata names (ticket 05). */
  readonly scopes: readonly string[]
  /** One line under the service in Add integration. */
  readonly hint: string
  /** Where to get a token, for a service that signs in with one; null when it signs in with OAuth only. */
  readonly tokenHint: string | null
  /** Why the service may refuse worfy as its client; null when nothing is known against it. */
  readonly mayRefuse: string | null
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    key: 'atlassian',
    name: 'Jira and Confluence',
    defaultLabel: 'Jira',
    server: { kind: 'http', url: 'https://mcp.atlassian.com/v2/mcp' },
    auth: ['oauth', 'basic', 'bearer'],
    scopes: [],
    hint: 'Atlassian Rovo MCP server. One site per sign-in: add one Integration per site.',
    tokenHint:
      'An Atlassian API token (e-mail and token) or a service account token. Works only when the organisation admin turned token sign-in on: Admin → Rovo → Rovo MCP server → Authentication.',
    mayRefuse: null,
  },
  {
    key: 'linear',
    name: 'Linear',
    defaultLabel: 'Linear',
    server: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
    auth: ['oauth', 'bearer'],
    scopes: [],
    hint: 'Linear MCP server.',
    tokenHint: 'A Linear personal API key (Settings → Security & access).',
    mayRefuse: null,
  },
  {
    key: 'notion',
    name: 'Notion',
    defaultLabel: 'Notion',
    server: { kind: 'http', url: 'https://mcp.notion.com/mcp' },
    auth: ['oauth', 'bearer'],
    scopes: [],
    hint: 'Notion MCP server.',
    tokenHint: 'A Notion MCP token, on the Business and Enterprise plans.',
    mayRefuse: null,
  },
  {
    key: 'sentry',
    name: 'Sentry',
    defaultLabel: 'Sentry',
    server: { kind: 'http', url: 'https://mcp.sentry.dev/mcp' },
    auth: ['oauth', 'bearer'],
    scopes: [],
    hint: 'Sentry MCP server.',
    tokenHint: 'A Sentry user auth token (User settings → Personal tokens).',
    mayRefuse: null,
  },
  {
    key: 'github',
    name: 'GitHub',
    defaultLabel: 'GitHub',
    server: { kind: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    // GitHub's OAuth for this server is not open to a client that registers itself: a token only.
    auth: ['bearer'],
    scopes: [],
    hint: 'GitHub MCP server.',
    tokenHint: 'A personal access token: GitHub → Settings → Developer settings → Personal access tokens, or the token gh already has.',
    mayRefuse: null,
  },
  {
    key: 'figma',
    name: 'Figma',
    defaultLabel: 'Figma',
    server: { kind: 'http', url: 'https://mcp.figma.com/mcp' },
    auth: ['oauth'],
    scopes: [],
    hint: 'Figma MCP server.',
    tokenHint: null,
    mayRefuse: 'Figma accepts only the clients of its own catalogue and may refuse worfy.',
  },
  {
    key: 'custom',
    name: 'Custom server',
    defaultLabel: 'Custom server',
    server: { kind: 'custom', transports: ['http', 'stdio'] },
    auth: ['oauth', 'bearer', 'basic', 'header', 'none'],
    scopes: [],
    hint: 'Any MCP server: an address (streamable HTTP) or a command worfy starts on this Machine.',
    tokenHint: 'The token, the header or the secret variables the server documents.',
    mayRefuse: null,
  },
]

/** The catalogue row of `key`; undefined for a key the catalogue does not have. */
export function catalogueEntry(key: string): CatalogueEntry | undefined {
  return CATALOGUE.find((entry) => entry.key === key)
}
