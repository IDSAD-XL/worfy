// What Codex can do as worfy runs it (ADR-0094 item 2; worfy-multi-vendor ticket 17). Static: what
// the pinned version can do in the first release. The models and their effort levels come from
// `model/list` of the running version, through a live Session (ticket 20): capabilities(session) and the
// model picker's rows (codexModelOptions) take them from there.
import { isEffortSetting, type ModelOption, type SessionSettings } from '../../../shared/agent/settings'
import type { Capabilities, PermissionPreset, VendorModel } from '../../../shared/vendors/capabilities'
import type { VendorDriver } from '../driver'
import type { SessionHandle } from '../session'
import type { AskForApproval } from './protocol/ts/v2/AskForApproval'
import type { Model } from './protocol/ts/v2/Model'
import type { SandboxMode } from './protocol/ts/v2/SandboxMode'
import type { SandboxPolicy } from './protocol/ts/v2/SandboxPolicy'

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
 * The Codex preset that stands for each of Claude Code's permission modes: a Session's settings carry
 * the Vendor's preset id (worfy-multi-vendor ticket 25), but the defaults and the picks saved before
 * that name Claude Code's modes.
 */
const PRESET_OF_CLAUDE_MODE: Readonly<Record<string, string>> = {
  bypassPermissions: 'full-access',
  acceptEdits: 'auto',
  default: 'read-only',
  plan: 'read-only',
}

/**
 * The preset a Session's permission setting means for Codex: a preset of Codex by its id, or the one
 * that stands for a permission mode of Claude Code; undefined for anything else.
 */
export function codexPresetFor(setting: string): CodexPermissionPreset | undefined {
  return codexPermissionPreset(setting) ?? codexPermissionPreset(PRESET_OF_CLAUDE_MODE[setting] ?? '')
}

/** Codex's effort levels lowest first, as far as worfy knows them; a level it does not know goes after them. */
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

/**
 * A Session's settings in Codex's terms (SessionPart.settingsFor): a permission mode of Claude Code
 * becomes the Codex preset that stands for it, an effort level Codex has no such name for (Claude
 * Code's `max`) the model's default. A setting that names neither a preset nor a mode stays, and the
 * start refuses it.
 */
export function codexSettings(settings: SessionSettings): SessionSettings {
  const preset = codexPresetFor(settings.permissionMode)
  const permissionMode = preset?.id ?? settings.permissionMode
  const effort = settings.effort !== null && EFFORT_ORDER.includes(settings.effort) ? settings.effort : null
  return permissionMode === settings.permissionMode && effort === settings.effort ? settings : { ...settings, permissionMode, effort }
}

/**
 * The sandbox of a turn (`turn/start` takes a policy, `thread/start` a mode): no network, and no folder
 * to write to beyond the workspace.
 */
export function codexSandboxPolicy(mode: SandboxMode): SandboxPolicy {
  switch (mode) {
    case 'read-only':
      return { type: 'readOnly', networkAccess: false }
    case 'workspace-write':
      return { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
  }
}

/**
 * Codex's capabilities in the first release. A message sent during a turn steers it (`turn/steer`);
 * a model change holds for the turns after it (`turn/start`); Limits come as windows
 * (`account/rateLimits/*`); the canvas tools come from worfy's MCP servers over HTTP (mcp.ts); its
 * Subagents get Nodes on the canvas from Codex's threads (subagents.ts, ticket 34). The Harness holds on
 * Codex (ticket 39): its guarantees rest on its hooks, which Codex runs once the user approved them in
 * /hooks, and the driver's `harnessHooks` part (harness-hooks.ts) checks that before each Autopilot Run
 * and each Session of one. Missing, each with the reason a tooltip shows: what worfy does not give Codex yet,
 * and what Codex does not have.
 */
export const CODEX_CAPABILITIES: Capabilities = {
  subagents: true,
  hooks: false,
  inProcessMcp: false,
  canvasTools: true,
  steer: true,
  resume: true,
  historyList: true,
  modelSwitchStable: true,
  oneShotToolFree: false,
  commandsComplete: false,
  harness: true,
  limitSource: 'windows',
  permissionPresets: CODEX_PERMISSION_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
  effortLevels: [],
  models: [],
  unsupported: {
    hooks: 'worfy does not run hooks in Codex yet.',
    inProcessMcp: 'Codex runs in a process of its own: worfy reaches it over HTTP, not inside the app.',
    oneShotToolFree: 'One-off requests (the Project profile draft, Terminal AI) run on Claude Code only.',
    commandsComplete: 'The slash menu lists Codex skills and the commands the app server runs; the other Codex commands work only in its own terminal.',
  },
}

/** The models the picker lists: those `model/list` does not hide, each once. */
function shownModels(models: readonly Model[]): Model[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (model.hidden || seen.has(model.model)) return false
    seen.add(model.model)
    return true
  })
}

const effortsOf = (model: Model): string[] => (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort)

/**
 * The capabilities with the models of `model/list`: each model the picker lists, with the effort levels
 * it takes, and every level any of them takes, lowest first.
 */
export function capabilitiesWithModels(models: readonly Model[]): Capabilities {
  const shown = shownModels(models)
  const vendorModels: VendorModel[] = shown.map((model) => ({ id: model.model, label: model.displayName, effortLevels: effortsOf(model) }))
  const levels = [...new Set(shown.flatMap(effortsOf))]
  const rank = (level: string): number => (EFFORT_ORDER.includes(level) ? EFFORT_ORDER.indexOf(level) : EFFORT_ORDER.length + levels.indexOf(level))
  return { ...CODEX_CAPABILITIES, models: vendorModels, effortLevels: [...levels].sort((a, b) => rank(a) - rank(b)) }
}

/** The levels of a model the picker offers: those a Session's settings take (a level worfy has no name for is left out). */
const pickerEfforts = (model: Model): string[] => effortsOf(model).filter(isEffortSetting)

/**
 * The model picker's rows of `model/list`: "Default" (value null) for the model Codex marks as its
 * default, then each model it does not hide.
 */
export function codexModelOptions(models: readonly Model[]): ModelOption[] {
  const fallback = models.find((model) => model.isDefault)
  const rows = shownModels(models).map((model) => ({ value: model.model, displayName: model.displayName, efforts: pickerEfforts(model) }))
  return fallback === undefined ? rows : [{ value: null, displayName: `Default (${fallback.displayName})`, efforts: pickerEfforts(fallback) }, ...rows]
}

/** What a live Codex Session tells of the running version: the models of its `model/list`. */
export interface CodexModelSource {
  codexModels(): Promise<Model[]>
}

/** The model source of a Session's handle; null for a handle that is not a Codex one. */
export function codexModelSource(session: SessionHandle | undefined): CodexModelSource | null {
  const source = session as (SessionHandle & Partial<CodexModelSource>) | undefined
  return typeof source?.codexModels === 'function' ? (source as CodexModelSource) : null
}

/**
 * The capabilities of Codex: the static ones, with the models of the live Session `session` when it
 * lists any. Without a Codex Session, or when `model/list` fails or lists none, the static ones.
 */
export const codexCapabilities: VendorDriver['capabilities'] = async (session) => {
  const source = codexModelSource(session)
  if (source === null) return CODEX_CAPABILITIES
  try {
    const models = await source.codexModels()
    return shownModels(models).length === 0 ? CODEX_CAPABILITIES : capabilitiesWithModels(models)
  } catch (error) {
    console.warn('[vendors] model/list of a Codex Session failed', error)
    return CODEX_CAPABILITIES
  }
}
