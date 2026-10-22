// The colour of each Node kind that has one (ADR-0077; kind-icons.tsx draws the band and the icon):
// the one place a `kind-*` role is named. A Node file names its kind (`kindColour`, nodes/index.ts),
// never a colour.

export type NodeKindColour = 'orchestrator' | 'session' | 'subagent' | 'epic'

/**
 * The `kind-*` role of each kind with a colour: `band` for the band, the icon and the Node's colour
 * on the minimap; `tint` for the pale ground of a Node that has one. A Subagent has no ground of
 * its own; the Epic frame's ground is in epic-frame.css.
 */
export const KIND = {
  orchestrator: { band: 'var(--kind-orchestrator)', tint: 'var(--kind-orchestrator-tint)' },
  session: { band: 'var(--kind-session)', tint: 'var(--kind-session-tint)' },
  subagent: { band: 'var(--kind-subagent)' },
  epic: { band: 'var(--kind-epic)' },
} as const satisfies Record<NodeKindColour, { band: string; tint?: string }>

export const isNodeKindColour = (value: unknown): value is NodeKindColour => typeof value === 'string' && Object.hasOwn(KIND, value)
