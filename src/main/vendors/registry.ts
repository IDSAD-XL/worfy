// The driver of each Vendor (ADR-0094 item 2): Claude Code, and Codex (worfy-multi-vendor ticket 17,
// its parts wired by later tickets; the interface offers it from ticket 24).
import type { VendorId } from '../../shared/vendors/vendor'
import { claudeDriver } from './claude'
import { codexDriver } from './codex'
import type { VendorDriver } from './driver'

/** The driver of the Vendor `id`. A Vendor id without a driver fails the typecheck here. */
export function vendorDriver(id: VendorId): VendorDriver {
  // Built at the call, not at load: the Claude driver and src/main/agent/app-registry.ts import
  // each other.
  const drivers: Record<VendorId, () => VendorDriver> = { claude: claudeDriver, codex: codexDriver }
  return drivers[id]()
}
