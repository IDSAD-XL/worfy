// Browser profiles (ADR-0078 item 5, worfy-browser ticket 03): the logins of a Project's Browsers,
// one `persist:` partition each (./partition.ts). A profile belongs to a Project and lives on its
// Machine, in the Project's data folder, never in its repository (ADR-0005): the file and its
// store are src/main/browser/profiles.ts, the window that manages them
// src/renderer/browser/BrowserProfiles.tsx. Shared here: the record, the file, and the reading of
// an origin, which the window checks as the user types and main checks again before it writes.
import { z } from 'zod'
import { BROWSER_PROFILE_ID, DEFAULT_BROWSER_PROFILE } from './partition'

/** The longest profile name; the frame's header shows it. */
export const BROWSER_PROFILE_NAME_MAX = 60
/** The most origins one profile lists. */
export const BROWSER_PROFILE_ORIGINS_MAX = 50

/**
 * Reads `text` as the origin of a site: `scheme://host` or `scheme://host:port`, http or https
 * only, and nothing else — no path, query, fragment or user info; one trailing `/` is allowed.
 * Only exact origins: a `*` (a wildcard of subdomains) is refused (the owner's decision 2 of
 * worfy-browser ticket 03). The answer is the origin as the browser writes it: scheme and host in
 * lower case, the scheme's default port left out (`HTTPS://Example.com:443` → `https://example.com`).
 */
export function parseOrigin(text: string): { origin: string } | { error: string } {
  const typed = text.trim()
  if (typed === '') return { error: 'Enter an origin, e.g. https://staging.example.com' }
  if (typed.includes('*')) return { error: `${typed}: only exact origins, no *` }
  const bare = typed.endsWith('/') ? typed.slice(0, -1) : typed
  const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?#@\s]+)$/i.exec(bare)
  if (parts === null) {
    return /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*[/?#@]/i.test(typed)
      ? { error: `${typed}: an origin has no path, query or user, only scheme://host:port` }
      : { error: `${typed}: write it as scheme://host:port, e.g. http://localhost:3000` }
  }
  const scheme = parts[1]!.toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') return { error: `${typed}: only http and https` }
  if (!URL.canParse(bare)) return { error: `${typed}: not a valid address` }
  const url = new URL(bare)
  if (url.hostname === '') return { error: `${typed}: no host` }
  return { origin: url.origin }
}

/**
 * The origins as the user typed them, one per item, read with parseOrigin: blank items are skipped,
 * and an origin typed twice is kept once, in the order typed. `error` names the first item that is
 * not an origin; the window shows it as the user types, and main refuses the change with it.
 */
export function readOrigins(typed: readonly string[]): { origins: string[]; error: string | undefined } {
  const origins: string[] = []
  for (const text of typed) {
    if (text.trim() === '') continue
    const parsed = parseOrigin(text)
    if ('error' in parsed) return { origins, error: parsed.error }
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin)
  }
  return { origins, error: undefined }
}

/** An origin as it is kept: already the browser's spelling of one (parseOrigin). */
export const browserOriginSchema = z.string().refine((value) => {
  const parsed = parseOrigin(value)
  return 'origin' in parsed && parsed.origin === value
}, 'an origin is scheme://host:port, http or https, as the browser writes it')

export const browserProfileIdSchema = z.string().regex(BROWSER_PROFILE_ID, 'a Browser profile id is lowercase letters, digits and dashes')
export const browserProfileNameSchema = z.string().trim().min(1, 'a Browser profile needs a name').max(BROWSER_PROFILE_NAME_MAX)

export const browserProfileSchema = z.object({
  id: browserProfileIdSchema,
  /** The role it logs in as: «admin», «moderator», «user». Shown in the frame's header. */
  name: browserProfileNameSchema,
  /** The sites a Session may take it to (checked by worfy-browser ticket 04); may be empty. */
  origins: z.array(browserOriginSchema).max(BROWSER_PROFILE_ORIGINS_MAX),
  /** Whether an Autopilot run may use it (read by worfy-browser ticket 08); off unless the user turns it on. */
  autopilot: z.boolean().default(false),
})
export type BrowserProfile = z.output<typeof browserProfileSchema>

/** browser-profiles.json in a Project's data folder. */
export const browserProfilesFileSchema = z.object({
  // Two profiles with one id would share one partition, and deleting one would erase the other's logins.
  profiles: z.array(browserProfileSchema).refine((profiles) => new Set(profiles.map((profile) => profile.id)).size === profiles.length, 'two Browser profiles have one id'),
})
export type BrowserProfilesFile = z.output<typeof browserProfilesFileSchema>

/**
 * The profile a Project has while it has no file yet (the owner's decision 5): "Default", on the
 * partition of the Browsers opened before profiles existed. The file is written at the first change.
 */
export function defaultBrowserProfile(): BrowserProfile {
  return { id: DEFAULT_BROWSER_PROFILE, name: 'Default', origins: [], autopilot: false }
}
