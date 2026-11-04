// The driver of Codex (ADR-0094 item 2), one file per part. Until the tickets of worfy-multi-vendor
// wire them (20: session; 21: account, limits; 22: history, commands; 33: mcp), each part answers
// that it is not wired yet. A ticket that changes a part changes its file, not this one. The
// interface shows no Codex before ticket 24. Whether Codex runs the Harness's hooks (ticket 39) is
// read by src/main/harness/codex-hooks-trust.ts, next to the install of the Harness into Codex.
import { codexHarnessHooks } from '../../harness/codex-hooks-trust'
import type { VendorDriver } from '../driver'
import { codexAccount } from './account'
import { codexCapabilities } from './capabilities'
import { codexCommands } from './commands'
import { codexHistory } from './history'
import { codexLimits } from './limits'
import { codexMcp } from './mcp'
import { codexOneShot } from './one-shot'
import { codexSession } from './session'

const driver: VendorDriver = {
  id: 'codex',
  capabilities: codexCapabilities,
  session: codexSession,
  account: codexAccount,
  limits: codexLimits,
  history: codexHistory,
  commands: codexCommands,
  mcp: codexMcp,
  oneShot: codexOneShot,
  harnessHooks: codexHarnessHooks,
}

/** The Codex driver, the same object at every call. */
export function codexDriver(): VendorDriver {
  return driver
}
