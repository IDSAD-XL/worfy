// The limits part of a Vendor driver (ADR-0094 item 2): the Vendor's Limit windows. Updates during a
// Session come as events of the Session, not from here.
import type { LimitWindow } from '../../shared/agent/limits'

/**
 * One Limit window of a Vendor (src/shared/agent/limits.ts): a Vendor may not know the use, the
 * length or the reset of a window (null); `provider` names whose window it is when the Vendor has
 * several.
 */
export type { LimitWindow }

export interface LimitsPart {
  read(): Promise<LimitWindow[]>
}
