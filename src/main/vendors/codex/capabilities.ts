// What Codex can do as worfy runs it (ADR-0094 item 2; worfy-multi-vendor ticket 17). Static: what
// the pinned version can do in the first release. The models and their effort levels come from
// `model/list` of the running version (ticket 20 adds them here).
import type { Capabilities, PermissionPreset } from '../../../shared/vendors/capabilities'
import type { VendorDriver } from '../driver'
import type { AskForApproval } from './protocol/ts/v2/AskForApproval'
import type { SandboxMode } from './protocol/ts/v2/SandboxMode'

/** A permission preset of Codex: the approval policy and the sandbox its turns run with. */
export interface CodexPermissionPreset extends PermissionPreset {
  approvalPolicy: AskForApproval
  sandbox: SandboxMode
}

/**
 * The presets in Codex's own words (spec of worfy-multi-vendor, decision 10), in the order the picker
 * lists them. Each turn (`turn/start`) takes the approval policy and the sandbox of the chosen one.
 */
export const CODEX_PERMISSION_PRESETS: readonly CodexPermissionPreset[] = [
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Codex reads files and asks before it edits a file or runs a command.',
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
  },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Codex edits files and runs commands in the project folder; it asks before anything outside it.',
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
  },
  {
    id: 'full-access',
    label: 'Full access',
    description: 'Codex edits any file and runs any command, with network access, without asking.',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
]

/** The preset with the id `id`; undefined for an id that is not one of Codex's. */
export function codexPermissionPreset(id: string): CodexPermissionPreset | undefined {
  return CODEX_PERMISSION_PRESETS.find((preset) => preset.id === id)
}

/**
 * Codex's capabilities in the first release. A message sent during a turn steers it (`turn/steer`);
 * a model change holds for the turns after it (`turn/start`); Limits come as windows
 * (`account/rateLimits/*`). Missing, each with the reason a tooltip shows: what worfy does not give
 * Codex yet (Subagent Nodes, hooks and the Harness come with the second release; the canvas tools
 * with worfy's MCP servers over HTTP), and what Codex does not have.
 */
export const CODEX_CAPABILITIES: Capabilities = {
  subagents: false,
  hooks: false,
  inProcessMcp: false,
  canvasTools: false,
  steer: true,
  resume: true,
  historyList: true,
  modelSwitchStable: true,
  oneShotToolFree: false,
  commandsComplete: false,
  harness: false,
  limitSource: 'windows',
  permissionPresets: CODEX_PERMISSION_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
  effortLevels: [],
  models: [],
  unsupported: {
    subagents: 'Subagents of a Codex Session do not show on the canvas yet.',
    hooks: 'worfy does not run hooks in Codex yet.',
    inProcessMcp: 'Codex runs in a process of its own: worfy reaches it over HTTP, not inside the app.',
    canvasTools: 'The canvas tools are not connected to Codex yet.',
    oneShotToolFree: 'One-off requests (the Project profile draft, Terminal AI) run on Claude Code only.',
    commandsComplete: 'The slash menu lists Codex skills and the commands the app server runs; the other Codex commands work only in its own terminal.',
    harness: 'The Harness is not installed in Codex yet.',
  },
}

/** The capabilities of Codex; the live Session is not asked until the running version tells the models (ticket 20). */
export const codexCapabilities: VendorDriver['capabilities'] = () => Promise.resolve(CODEX_CAPABILITIES)
