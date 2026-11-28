// The Harness-hooks part of a Vendor's driver (ADR-0094, risk 3; worfy-multi-vendor ticket 39): whether
// the Vendor runs the hooks of the Harness now; without them the gate and the guards of the workflow do not
// hold. Codex turns a plugin's hooks off after each install or update until the user approves them in Codex
// (`/hooks`; src/main/vendors/codex/harness-hooks.ts). Claude Code runs a plugin's hooks without an approval,
// but not those of a Harness that did not load — a hooks.json it cannot read, the plugin missing, hooks
// turned off (worfy-harness-guarantees ticket 07; src/main/vendors/claude/harness-hooks.ts).
import type { HarnessHooksTrust } from '../../shared/ipc/harness'

/** The answer of a check with its reason: null when `approved`, or when the driver gives none. */
export interface HarnessHooksAnswer {
  trust: HarnessHooksTrust
  reason: string | null
}

export interface HarnessHooksPart {
  /**
   * Whether the hooks of the Harness are approved now, read for a Project at `cwd` (the Vendor's own
   * folder when absent). Never throws: what cannot be read is `unknown`.
   */
  trust(cwd?: string): Promise<HarnessHooksTrust>
  /** The same check with the reason of an answer other than `approved`; absent: the driver names none (Codex). */
  check?(cwd?: string): Promise<HarnessHooksAnswer>
  /** What a start that needs the hooks (Autopilot's unattended Orchestrator) answers while they are not `approved`; the reason follows it. */
  readonly refusal: string
}
