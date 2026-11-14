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
// An address with a query, a fragment or a user name and password is written as its origin and path followed
// by `*` (Claude Code's wildcard), never with that part: a token there would land in `--managed-settings`,
// which `ps` shows to every process of the user (the owner's rule of proportionate security: the address is
// not a secret, a token is). Two servers with one address and path are allowed together; a server whose URL
// carries a user name and password does not match such a pattern if Claude Code compares it with them. The
// addresses stay in main: no row, log, Journal or Flight recorder line ever carries one.
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

/**
 * The addresses of the remote servers in an answer of mcpServerStatus(): `config.url` of an http or sse server
 * of any scope, and of a server whose scope is `claudeai` — a claude.ai connector, whose `url` is the address of
 * its service in claude.ai's list of connectors, the one Claude Code matches it by.
 *
 * The proxy case: an entry of type `claudeai-proxy` whose scope is not `claudeai` (a server reaching its service
 * through claude.ai's proxy that is not one of the user's connectors). Its address is not taken: what its `url`
 * names — the service or the proxy — is not checked, and a pattern made of the proxy's address could match every
 * server behind it. It stays a `serverName` entry if its name can be one, and is left out if not.
 */
export function remoteAddressesOf(answer: unknown): Map<string, string> {
  const found = new Map<string, string>()
  if (!Array.isArray(answer)) return found
  for (const each of answer) {
    const entry = statusEntry.safeParse(each)
    if (!entry.success) continue
    const { name, scope, config } = entry.data
    const url = config?.url
    if (url === undefined) continue
    const remote = scope === 'claudeai' || config?.type === 'http' || config?.type === 'sse'
    if (remote) found.set(name, url)
  }
  return found
}

/**
 * The `serverUrl` pattern of `url`: the address itself, or — when it has a query, a fragment or a user name and
 * password — its origin and path followed by `*`. Null for what is not an http or https address.
 */
export function serverUrlPattern(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const plain = parsed.search === '' && parsed.hash === '' && parsed.username === '' && parsed.password === '' && !url.includes('?') && !url.includes('#')
  return plain ? url : `${parsed.origin}${parsed.pathname}*`
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
