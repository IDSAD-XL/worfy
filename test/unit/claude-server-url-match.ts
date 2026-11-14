// How Claude Code 2.1.322 matches a remote MCP server's URL against a `serverUrl` entry of `allowedMcpServers`,
// for the tests of the patterns worfy writes (worfy-mcp-live ticket 12, review of #1847). Ported by hand from the
// minified functions `t5` (the match) and `WT` (the glob) of the Claude Code binary the SDK 0.3.322 ships; the
// punycode guard and the non-URL fallback are left out (the tests use plain http, https and ws addresses only, and
// the fallback throws so a test cannot silently rely on it).
//
// What it says about the patterns: `*` matches any run of characters, `/` included; the pattern's path and query
// are compared with the server's path and query, never its user name, password or fragment; a pattern whose path is
// empty or `/`, with no query and no trailing `/`, matches every path of the host.
const WILD = 'zzwildcardzz'

/** `WT` of Claude Code: `pattern` with `*` as "any characters", against the whole of `text`. */
export function claudeGlob(pattern: string, text: string): boolean {
  const parts = pattern.split('*')
  const first = parts[0] ?? ''
  if (parts.length === 1) return first === text
  const last = parts.at(-1) ?? ''
  const end = text.length - last.length
  if (end < first.length || !text.startsWith(first) || !text.endsWith(last)) return false
  let at = first.length
  for (const part of parts.slice(1, -1).filter((each) => each !== '')) {
    const found = text.indexOf(part, at)
    if (found === -1 || found + part.length > end) return false
    at = found + part.length
  }
  return true
}

/** `t5` of Claude Code: whether the server address `url` matches the `serverUrl` entry `pattern`. */
export function claudeServerUrlMatches(url: string, pattern: string): boolean {
  if (pattern === '*') return true
  let server: URL
  try {
    server = new URL(url)
  } catch {
    return false
  }
  const marked = pattern.replaceAll('*', WILD)
  let anyPort = false
  let entry: URL | undefined
  try {
    entry = new URL(marked)
  } catch {
    const zeroPort = marked.replace(new RegExp(`:${WILD}(?=[/?#]|$)`), ':0')
    if (zeroPort !== marked) {
      try {
        entry = new URL(zeroPort)
        anyPort = true
      } catch {
        // Not a URL: Claude Code's segment fallback, not modelled here.
      }
    }
  }
  if (entry === undefined) throw new Error(`not modelled: a pattern that is not a URL (${pattern})`)
  if (entry.protocol !== `${WILD}:` && entry.protocol !== server.protocol) return false
  const host = server.hostname.replace(/\.$/, '').toLowerCase()
  const entryHost = entry.hostname.replace(/\.$/, '').toLowerCase().replaceAll(WILD, '*')
  if (!claudeGlob(entryHost, host)) return false
  if (entry.port === '' && entry.hostname.includes(WILD)) anyPort = true
  if (!anyPort && entry.port !== server.port) return false
  if ((entry.pathname === '/' || entry.pathname === '') && entry.search === '' && !marked.endsWith('/')) return true
  return claudeGlob((entry.pathname + entry.search).replaceAll(WILD, '*'), server.pathname + server.search)
}
