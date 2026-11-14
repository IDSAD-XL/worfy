// The addresses of the user's remote MCP servers and the entries of the policy tier's `allowedMcpServers`
// made of them (worfy-mcp-live ticket 12; the spike of ticket 11, .scratch/worfy-mcp-live/spike-claudeai-connectors.md;
// ADR-0021, Amendment 2026-11-13).
//
// Claude Code (checked on 2.1.322) reads a `serverName` entry of `allowedMcpServers` only when the name is
// letters, digits, `_` and `-`. Any other entry is dropped with a warning on stderr, and the rest of the list
// still applies. Every claude.ai connector is named `claude.ai <name>`, with a dot and a space, so a connector
// allowed by its name was never started. And once the list has a single `serverUrl` entry, Claude Code matches
// a remote server (http, sse, a claude.ai connector) by its address only, never by its name. So:
// - every allowed remote server whose address the MCP inventory knows is a `serverUrl` entry, all of them at
//   once, or one address would cut the remote servers allowed by name;
// - every other allowed name Claude Code can read is a `serverName` entry: stdio servers, and a remote server
//   whose address is not known yet (added after the inventory's last answer; its row says so, notStartedRows);
// - a name it cannot read that has no known address is left out: Claude Code would drop it anyway.
//
// The pattern is the address's origin and path, exact (Claude Code 2.1.322 compares a pattern's path and query
// with the server's path and query; its `*` matches any characters, `/` too, so a `*` after the path would allow
// every sibling path and subpath of the host). An address with a query is written as origin, path and `?*`, never
// with the query: a token there would land in `--managed-settings`, which `ps` shows to every process of the user
// (the owner's rule of proportionate security: the address is not a secret, a token is). Cost: every query on that
// same path is allowed, so two servers with one origin and path are allowed together. A user name and password and
// a fragment are left out: Claude Code compares neither, so a server whose URL carries them still matches. A bare
// host is written with its path `/`: a pattern with an empty path would allow the whole host. The addresses stay
// in main: no row, log, Journal or Flight recorder line ever carries one.
import { z } from 'zod'

/** The names Claude Code takes in a `serverName` entry of `allowedMcpServers`. */
const ALLOWABLE_NAME = /^[a-zA-Z0-9_-]+$/

/** Whether Claude Code takes `name` in a `serverName` entry: no dot, no space, nothing but letters, digits, `_` and `-`. */
export const allowableByName = (name: string): boolean => ALLOWABLE_NAME.test(name)

/** The address of each remote server of the user, by the server's name, as the inventory found them. */
export type McpAddresses = ReadonlyMap<string, string>

/** An entry of the policy tier's `allowedMcpServers` as worfy writes it. */
export type AllowedMcpEntry = { serverName: string } | { serverUrl: string }

const statusEntry = z.object({
  name: z.string().min(1),
  scope: z.string().optional(),
  config: z.object({ type: z.string().optional(), url: z.string().min(1).optional() }).passthrough().optional(),
})

/** The remote servers of an answer of mcpServerStatus(): the address of each one that has a usable one, and the rest. */
export interface McpRemoteServers {
  addresses: Map<string, string>
  /** The remote servers it gives no usable address for: Claude Code matches them by an address worfy does not know. */
  unaddressed: Set<string>
}

/** The config types of remote servers Claude Code matches by address. */
const REMOTE_TYPES: ReadonlySet<string> = new Set(['http', 'sse', 'ws', 'claudeai-proxy'])

/**
 * The remote servers in an answer of mcpServerStatus(). The address is `config.url` of an http, sse or ws server
 * of any scope, and of a server whose scope is `claudeai` — a claude.ai connector, whose `url` is the address of
 * its service in claude.ai's list of connectors, the one Claude Code matches it by.
 *
 * The proxy case: an entry of type `claudeai-proxy` whose scope is not `claudeai` (a server reaching its service
 * through claude.ai's proxy that is not one of the user's connectors). Claude Code matches it by the proxy's
 * address it makes of the server's id, not by `config.url`, so its address is not taken. It is unaddressed: with
 * any `serverUrl` entry on the list it does not start, and its row says so (notStartedRows). So is a connector the
 * answer gives no `url`, and a remote server whose `url` has no pattern.
 */
export function remoteServersOf(answer: unknown): McpRemoteServers {
  const found: McpRemoteServers = { addresses: new Map(), unaddressed: new Set() }
  if (!Array.isArray(answer)) return found
  for (const each of answer) {
    const entry = statusEntry.safeParse(each)
    if (!entry.success) continue
    const { name, scope, config } = entry.data
    const type = config?.type ?? ''
    if (scope !== 'claudeai' && !REMOTE_TYPES.has(type)) continue
    const proxied = type === 'claudeai-proxy' && scope !== 'claudeai'
    const url = config?.url
    if (!proxied && url !== undefined && serverUrlPattern(url) !== null) found.addresses.set(name, url)
    else found.unaddressed.add(name)
  }
  return found
}

/** The schemes of the remote servers' addresses. */
const REMOTE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:'])

/**
 * The `serverUrl` pattern of `url`: its origin and path, exact, followed by `?*` when it has a query. Null for
 * what is not an http, https, ws or wss address.
 */
export function serverUrlPattern(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!REMOTE_SCHEMES.has(parsed.protocol)) return null
  const exact = `${parsed.origin}${parsed.pathname}`
  return parsed.search === '' ? exact : `${exact}?*`
}

/**
 * The `allowedMcpServers` of the allowed `names`: an address entry for each one `addresses` knows, a name entry
 * for each other one Claude Code can read, nothing for the rest. Each address once. May be empty; the caller
 * sends an empty list as it is, never leaves it out (no list lets every server through).
 */
export function allowedMcpEntries(names: readonly string[], addresses: McpAddresses | null): AllowedMcpEntry[] {
  const entries: AllowedMcpEntry[] = []
  const patterns = new Set<string>()
  for (const name of names) {
    const url = addresses?.get(name)
    const pattern = url === undefined ? null : serverUrlPattern(url)
    if (pattern !== null) {
      if (!patterns.has(pattern)) entries.push({ serverUrl: pattern })
      patterns.add(pattern)
    } else if (allowableByName(name)) entries.push({ serverName: name })
  }
  return entries
}
