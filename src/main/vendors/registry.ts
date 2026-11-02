// The driver of each Vendor (ADR-0094 item 2). Only Claude Code has one so far; worfy-multi-vendor
// ticket 17 adds Codex.
import type { VendorId } from '../../shared/vendors/vendor'
import { claudeDriver } from './claude'
import type { VendorDriver } from './driver'

/** The driver of the Vendor `id`; throws for a Vendor that has none yet. */
export function vendorDriver(id: VendorId): VendorDriver {
  // Built at the call, not at load: the Claude driver and src/main/agent/app-registry.ts import
  // each other.
  const drivers: Partial<Record<VendorId, () => VendorDriver>> = { claude: claudeDriver }
  const driver = drivers[id]
  if (driver === undefined) throw new Error(`there is no driver for the vendor ${id} yet`)
  return driver()
}
