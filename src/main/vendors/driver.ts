// The driver of a Vendor (ADR-0094 item 2): every part through which worfy runs the Vendor's agent.
// Each part's types live in a file of their own next to this one, and each Vendor's driver in
// src/main/vendors/<id>/, one file per part, so that a ticket changes one part without touching
// the others.
import type { Capabilities } from '../../shared/vendors/capabilities'
import type { VendorId } from '../../shared/vendors/vendor'
import type { AccountPart } from './account'
import type { CommandsPart } from './commands'
import type { HarnessHooksPart } from './harness-hooks'
import type { HistoryPart } from './history'
import type { LimitsPart } from './limits'
import type { McpPart } from './mcp'
import type { OneShot } from './one-shot'
import type { SessionHandle, SessionPart } from './session'

export interface VendorDriver {
  readonly id: VendorId
  /**
   * What the Vendor can do: as such, or for the live Session `session` (a handle of this driver's),
   * where the running version or the Session may tell more (its models).
   */
  capabilities(session?: SessionHandle): Promise<Capabilities>
  readonly session: SessionPart
  readonly account: AccountPart
  readonly limits: LimitsPart
  readonly history: HistoryPart
  readonly commands: CommandsPart
  readonly mcp: McpPart
  readonly oneShot: OneShot
  /**
   * Whether the Vendor runs the Harness's hooks now (worfy-multi-vendor ticket 39); absent for a Vendor
   * that runs a plugin's hooks without an approval (Claude Code).
   */
  readonly harnessHooks?: HarnessHooksPart
}

/** What a driver's part answers with until a ticket wires it to the Vendor. */
export class PartNotWired extends Error {
  constructor(vendor: VendorId, part: string, wiredBy: string) {
    super(`${part} of the ${vendor} driver is not wired yet (${wiredBy})`)
    this.name = 'PartNotWired'
  }
}
