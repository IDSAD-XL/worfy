// Where a Session may take a Browser (ADR-0078 item 5, worfy-browser ticket 04): only to a page on
// one of the origins of the Browser's profile. An origin is matched whole — scheme, host and port,
// in the browser's own spelling (URL.origin) — never by the host alone, so another port of
// localhost is another site. Anything that is not an http(s) page (about:blank, data:, javascript:,
// file:) is refused, and a profile without origins lets a Session go nowhere. The user goes
// anywhere by hand: the check is only on what happens while a Session drives the Browser
// (src/main/browser/cdp.ts, src/main/mcp/browser-server.ts).

/** scheme://host:port of an http(s) address; the scheme (`about:`) of any other; the text itself when it is no URL. */
export function originOf(url: string): string {
  if (!URL.canParse(url)) return url
  const parsed = new URL(url)
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin
  return parsed.protocol
}

/** Whether a Session may take a Browser to `url`, by the origins of its profile. */
export function sessionMayGo(url: string, origins: readonly string[]): boolean {
  if (!URL.canParse(url)) return false
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return origins.includes(parsed.origin)
}

/** Why a Session may not take a Browser of profile `profile` to `url`, naming the origin and the list; null when it may. */
export function originRefusal(url: string, profile: string, origins: readonly string[]): string | null {
  if (sessionMayGo(url, origins)) return null
  const list = origins.length === 0 ? `Browser profile "${profile}" lists no origins, so a Session may open no page in it` : `Browser profile "${profile}" allows only ${origins.join(', ')}`
  return `${originOf(url)} is outside the origins of this Browser: ${list}. Only the user can open other sites, by hand.`
}
