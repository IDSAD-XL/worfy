// The limits part of a Vendor driver (ADR-0094 item 2): the Vendor's Limit windows. Updates during a
// Session come as events of the Session, not from here.
/**
 * One Limit window of a Vendor. A Vendor may not know the use, the length or the reset of a window
 * (null); `provider` names whose window it is when the Vendor has several.
 * shortcut: a copy of LimitWindow of ticket 11 (worfy-multi-vendor), redo as an import of it from
 * src/shared/agent/limits.ts in ticket 15, which wires the Claude limits part.
 */
export interface LimitWindow {
  /** The Vendor whose subscription the window belongs to. */
  vendor: string
  provider?: string | undefined
  id: string
  label: string
  /** 0..100 and more. */
  usedPercent: number | null
  windowMinutes: number | null
  /** Unix seconds. */
  resetsAt: number | null
  state: 'ok' | 'warning' | 'reached' | null
  /** When worfy received the value, in epoch milliseconds. */
  receivedAt: number
  /** Where the value came from, in the Vendor's terms. */
  source: string
}

export interface LimitsPart {
  read(): Promise<LimitWindow[]>
}
