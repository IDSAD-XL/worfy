// The limits part of a Vendor driver (ADR-0094 item 2): the Vendor's Limit windows. Updates during a
// Session come as events of the Session, not from here.
import type { VendorId } from '../../shared/vendors/vendor'

/**
 * One Limit window of a Vendor. A Vendor may not know the use, the length or the reset of a window
 * (null); `provider` names whose window it is when the Vendor has several.
 * shortcut: a copy of LimitWindow, redo as an import once ticket 11 (worfy-multi-vendor) is merged:
 * that ticket adds the type to src/shared/agent/limits.ts in parallel with this one.
 */
export interface LimitWindow {
  vendor: VendorId
  provider?: string
  id: string
  label: string
  /** 0..100. */
  usedPercent: number | null
  windowMinutes: number | null
  /** Unix seconds. */
  resetsAt: number | null
  state: 'ok' | 'warning' | 'reached' | null
}

export interface LimitsPart {
  read(): Promise<LimitWindow[]>
}
