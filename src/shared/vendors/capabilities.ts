// What a Vendor can do (ADR-0094 item 2): the flags and lists the interface reads instead of the
// Vendor's name. Pickers, the permission dialog, the slash menu and Limits take everything from
// here; a capability a Vendor lacks comes with the reason a tooltip shows. In shared, as the
// renderer reads them. A driver (src/main/vendors/<id>/) gives its Vendor's capabilities.
import { z } from 'zod'
import { EFFORT_LEVELS, PERMISSION_MODES, type PermissionModeChoice } from '../agent/settings'

/**
 * The yes-or-no capabilities: Subagents, hooks, MCP servers in the app's process, worfy's canvas
 * tools, a message that steers a running turn, resume, a list of the Vendor's past Sessions, a model
 * change that holds mid-Session, a one-shot request without tools, a full list of slash commands,
 * and the Harness.
 */
export const CAPABILITY_FLAGS = [
  'subagents',
  'hooks',
  'inProcessMcp',
  'canvasTools',
  'steer',
  'resume',
  'historyList',
  'modelSwitchStable',
  'oneShotToolFree',
  'commandsComplete',
  'harness',
] as const
export const capabilityFlagSchema = z.enum(CAPABILITY_FLAGS)
export type CapabilityFlag = z.infer<typeof capabilityFlagSchema>

/**
 * Where a Vendor's Limits come from: windows with use and reset (`windows`), only the error of a
 * turn that ran into one (`errorOnly`), or nowhere (`none`).
 */
export const LIMIT_SOURCES = ['windows', 'errorOnly', 'none'] as const
export const limitSourceSchema = z.enum(LIMIT_SOURCES)
export type LimitSource = z.infer<typeof limitSourceSchema>

/** A permission preset in the Vendor's own words: its id goes back to the driver, the label and description to the picker. */
export const permissionPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
})
export type PermissionPreset = z.output<typeof permissionPresetSchema>

const flagsShape = Object.fromEntries(CAPABILITY_FLAGS.map((flag) => [flag, z.boolean()])) as Record<CapabilityFlag, z.ZodBoolean>

/**
 * The capabilities of a Vendor. Every flag that is false has its reason in `unsupported`, and only
 * those: the interface shows the reason where the action would be.
 */
export const capabilitiesSchema = z
  .object({
    ...flagsShape,
    limitSource: limitSourceSchema,
    /** The permission presets, in the order the picker lists them. */
    permissionPresets: z.array(permissionPresetSchema).min(1),
    /** The effort levels, lowest first. */
    effortLevels: z.array(z.string().min(1)),
    /** Why a capability is missing, by flag. */
    unsupported: z.partialRecord(capabilityFlagSchema, z.string().min(1)),
  })
  .superRefine((capabilities, context) => {
    for (const flag of CAPABILITY_FLAGS) {
      const reason = capabilities.unsupported[flag]
      if (!capabilities[flag] && reason === undefined) context.addIssue({ code: 'custom', path: ['unsupported', flag], message: `${flag} is missing without a reason` })
      if (capabilities[flag] && reason !== undefined) context.addIssue({ code: 'custom', path: ['unsupported', flag], message: `${flag} is there, yet has a reason it is missing` })
    }
    const seen = new Set<string>()
    for (const [index, preset] of capabilities.permissionPresets.entries()) {
      if (seen.has(preset.id)) context.addIssue({ code: 'custom', path: ['permissionPresets', index, 'id'], message: `duplicate preset id ${preset.id}` })
      seen.add(preset.id)
    }
  })
export type Capabilities = z.output<typeof capabilitiesSchema>

/** Claude Code's permission modes in the words of the picker (src/renderer/session/composer/Pickers.tsx). */
const CLAUDE_PRESETS: Readonly<Record<PermissionModeChoice, Omit<PermissionPreset, 'id'>>> = {
  bypassPermissions: { label: 'Bypass permissions', description: 'Claude Code runs every tool without asking.' },
  acceptEdits: { label: 'Accept edits', description: 'File edits go through without asking; other tools ask first.' },
  default: { label: 'Ask before tools', description: 'Claude Code asks before each tool that needs permission.' },
  plan: { label: 'Plan only', description: 'Claude Code reads and plans; it changes nothing.' },
}

/**
 * Claude Code's capabilities, as today's code runs it: the permission modes and effort levels of
 * the pickers (settings.ts), Limits from the windows of rate_limit_event, the statusline and the
 * Limits probe. A message sent during a turn waits in the Session's queue (src/main/agent/session.ts).
 */
export const CLAUDE_CAPABILITIES: Capabilities = {
  subagents: true,
  hooks: true,
  inProcessMcp: true,
  canvasTools: true,
  steer: false,
  resume: true,
  historyList: true,
  modelSwitchStable: true,
  oneShotToolFree: true,
  commandsComplete: true,
  harness: true,
  limitSource: 'windows',
  permissionPresets: PERMISSION_MODES.map((id) => ({ id, ...CLAUDE_PRESETS[id] })),
  effortLevels: [...EFFORT_LEVELS],
  unsupported: { steer: 'A message sent during a turn waits in the queue and goes when the turn ends.' },
}
