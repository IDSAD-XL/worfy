// The preset of a subscription plan (worfy-throughput ticket 42): settings that make a Ticket spend
// fewer tokens, offered for the plan Claude Code is signed in with. worfy offers it with an Apply
// button and writes nothing without the click (src/renderer/settings/PlanSection.tsx); main writes the
// Profile's fields through the Harness's `bin/profile-set --field` (src/main/ipc/plan-preset.ts).
//
// The plan comes from `accountInfo().subscriptionType` (src/main/agent/session.ts). Claude Code
// 2.1.289 answers it as "Claude " and the plan's name: the organization's `plan_display_name` when the
// account has one, else by the plan's code — "Claude Pro", "Claude Max", "Claude Team",
// "Claude Enterprise" ("Claude API" without a subscription). The rule here: the text without a leading
// "Claude ", in any case, is the plan's code alone ("Pro"), or for Max the code and a tier after a
// space ("Max 20x"). Anything else is a plan worfy does not know, and gets no offer.
//
// Only Pro has a preset: Max keeps the Profile as it is. The Pro preset names no Opus.

/** The plans Claude Code knows a subscription by. */
export const PLANS = ['pro', 'max', 'team', 'enterprise'] as const
export type Plan = (typeof PLANS)[number]

/** The Harness agent roles a Profile's `agents` sets a model and effort for (harness/profiles/README.md). */
export const AGENT_ROLES = ['implementer', 'reviewer', 'scout', 'verifier'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export interface RoleSettings {
  model: 'sonnet' | 'opus'
  effort: 'low' | 'medium' | 'high'
}

/** The fields of a Profile a preset writes, as `bin/profile-set --field workflow.agents --field agents --set` takes them. */
export interface PresetProfileFields {
  'workflow.agents': 'eco' | 'full'
  agents: Record<AgentRole, RoleSettings>
}

export interface PlanPreset {
  plan: Plan
  /** The plan's name in the UI. */
  label: string
  /** The Profile's fields, written for the Project. */
  profile: PresetProfileFields
  /** The Autopilot budget of this Machine (Settings → Autopilot), set with the same click. */
  autopilotBudget: { enabled: true }
  /** What the preset sets, one line each, for the offer. */
  summary: readonly string[]
}

const SONNET_MEDIUM: RoleSettings = { model: 'sonnet', effort: 'medium' }

/** The preset of each plan that has one. */
export const PLAN_PRESETS: Readonly<Partial<Record<Plan, PlanPreset>>> = Object.freeze({
  pro: {
    plan: 'pro',
    label: 'Pro',
    profile: {
      'workflow.agents': 'eco',
      agents: { implementer: SONNET_MEDIUM, reviewer: SONNET_MEDIUM, scout: SONNET_MEDIUM, verifier: SONNET_MEDIUM },
    },
    autopilotBudget: { enabled: true },
    summary: ['Fewer agents per Ticket (eco)', 'Sonnet for every agent role', 'Effort medium', 'Daily budget of the Limits for Autopilot: on'],
  },
})

const PLAN_NAME = /^(?:claude\s+)?(pro|max|team|enterprise)(\s+\d+x)?$/u

/** The plan `subscriptionType` names, by the rule above; null for a string the rule does not know. */
export function planOf(subscriptionType: string | null | undefined): Plan | null {
  if (typeof subscriptionType !== 'string') return null
  const match = PLAN_NAME.exec(subscriptionType.trim().toLowerCase())
  if (match === null) return null
  const plan = match[1] as Plan
  // Only Max has tiers in its name.
  return match[2] === undefined || plan === 'max' ? plan : null
}

/** The preset worfy offers for `subscriptionType`; null — no offer. */
export function presetFor(subscriptionType: string | null | undefined): PlanPreset | null {
  const plan = planOf(subscriptionType)
  return plan === null ? null : (PLAN_PRESETS[plan] ?? null)
}

/** The Profile's fields as `bin/profile-set --field … --read` gives them (null — absent), and the budget in force. */
export interface PresetCurrent {
  fields: { 'workflow.agents': unknown; agents: unknown }
  budgetEnabled: boolean
}

/** JSON with the keys of every object sorted, as harness/lib/pipeline.cjs compares values. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Whether the Profile and the budget already are what `preset` sets: then there is nothing to apply. */
export function presetInUse(preset: PlanPreset, current: PresetCurrent): boolean {
  return (
    current.budgetEnabled === preset.autopilotBudget.enabled &&
    current.fields['workflow.agents'] === preset.profile['workflow.agents'] &&
    canonical(current.fields.agents) === canonical(preset.profile.agents)
  )
}
