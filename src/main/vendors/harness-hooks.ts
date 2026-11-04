// The Harness-hooks part of a Vendor's driver (ADR-0094, risk 3; worfy-multi-vendor ticket 39): whether
// the Vendor runs the hooks of the Harness now. Codex turns a plugin's hooks off after each install or
// update until the user approves them in Codex (`/hooks`), and without them the gate and the guards of
// the workflow do not hold there. A Vendor that runs a plugin's hooks without an approval (Claude Code)
// has no such part, and nothing is checked for it.
import type { HarnessHooksTrust } from '../../shared/ipc/harness'

export interface HarnessHooksPart {
  /**
   * Whether the hooks of the Harness are approved now, read for a Project at `cwd` (the Vendor's own
   * folder when absent). Never throws: what cannot be read is `unknown`.
   */
  trust(cwd?: string): Promise<HarnessHooksTrust>
  /** What a start that needs the hooks (Autopilot's unattended Orchestrator) answers while they are not `approved`. */
  readonly refusal: string
}
