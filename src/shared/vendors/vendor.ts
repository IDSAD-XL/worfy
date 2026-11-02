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
