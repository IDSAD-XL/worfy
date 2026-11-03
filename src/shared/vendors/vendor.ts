// The Vendors whose agents worfy runs (ADR-0094): Claude Code and Codex. The rest of worfy names a
// Vendor only by its id; what one can do is in its capabilities (capabilities.ts), never in a check
// of the id outside src/main/vendors/<id>/.
import { z } from 'zod'

export const VENDOR_IDS = ['claude', 'codex'] as const
export const vendorIdSchema = z.enum(VENDOR_IDS)
export type VendorId = z.infer<typeof vendorIdSchema>

/** The text label of each Vendor, as the interface shows it (no logos: owner, Q10 of the spec). */
export const VENDOR_LABELS: Readonly<Record<VendorId, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

/** The Vendor of a Session saved without one: every Session from before worfy-multi-vendor is Claude Code's. */
export const UNNAMED_VENDOR: VendorId = 'claude'

/**
 * How the interface names a Vendor (worfy-multi-vendor ticket 24): `name` — the label of VENDOR_LABELS;
 * `short` — where room is scarce, a Session Node's header and a section of the Limits panel; `agent` —
 * the label of the agent's messages in a transcript, lower case as `you` and `orch` are.
 */
export type VendorLabelForm = 'name' | 'short' | 'agent'

const SHORT_LABELS: Readonly<Record<VendorId, string>> = { claude: 'Claude', codex: 'Codex' }
const AGENT_LABELS: Readonly<Record<VendorId, string>> = { claude: 'claude', codex: 'codex' }

/** A Vendor this build runs; false for the id of a later worfy's Vendor. */
export const isVendorId = (vendor: string): vendor is VendorId => (VENDOR_IDS as readonly string[]).includes(vendor)

/** The label of `vendor` in `form`; the id itself for a Vendor this build does not know (a later worfy's). */
export function vendorLabel(vendor: string, form: VendorLabelForm = 'name'): string {
  if (!isVendorId(vendor)) return vendor
  return form === 'name' ? VENDOR_LABELS[vendor] : form === 'short' ? SHORT_LABELS[vendor] : AGENT_LABELS[vendor]
}

/**
 * The neutral icon of each Vendor's badge: a plain shape drawn with SVG paths in a 16 × 16 box,
 * stroked in the text colour — never the Vendor's logo (owner, Q10 of the spec). Two shapes, so two
 * badges can be told apart when the label is cut.
 */
const ICONS: Readonly<Record<VendorId, readonly string[]>> = {
  // A circle.
  claude: ['M13 8A5 5 0 1 1 3 8a5 5 0 0 1 10 0Z'],
  // A rounded square.
  codex: ['M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5Z'],
}
/** The icon of a Vendor this build does not know: a diamond. */
const UNKNOWN_ICON: readonly string[] = ['M8 2.5L13.5 8 8 13.5 2.5 8Z']

/** The paths of `vendor`'s neutral icon. */
export const vendorIcon = (vendor: string): readonly string[] => (isVendorId(vendor) ? ICONS[vendor] : UNKNOWN_ICON)

/**
 * Why a Vendor nobody is signed in to cannot start a Session, and where to sign in: the refusal of
 * New session (src/main/agent/node-sessions.ts) and the tooltip of the Vendor's row in its picker.
 */
export const signInHint = (vendor: VendorId): string => `Sign in to ${VENDOR_LABELS[vendor]} in Settings → Vendors`
