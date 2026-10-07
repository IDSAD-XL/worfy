// The Harness ships as the Claude Code plugin `worfy` (ADR-0040): its skills and Subagents live in
// the plugin's namespace — `/worfy:epic-wave`, Subagent type `worfy:implementer`. Transcripts
// written before the Harness became a plugin hold the bare names, and both mean the same thing.

/** The name of the Harness plugin: the namespace of its skills and Subagent types. */
export const HARNESS_PLUGIN = 'worfy'

const PREFIX = `${HARNESS_PLUGIN}:`

/**
 * A Harness name without its plugin: `worfy:implementer` → `implementer`, `implementer` →
 * `implementer`; null for a name of another plugin (`other:implementer`).
 */
export function harnessName(name: string): string | null {
  if (name.startsWith(PREFIX)) return name.slice(PREFIX.length)
  return name.includes(':') ? null : name
}

/**
 * The type of a Subagent as the UI shows it: without the Harness plugin (`worfy:implementer` →
 * `implementer`). Another plugin's type (`mattpocock-skills:…`), a bare type and null stay as they are.
 */
export function subagentTypeLabel(type: string): string
export function subagentTypeLabel(type: string | null): string | null
export function subagentTypeLabel(type: string | null): string | null {
  if (type === null || !type.startsWith(PREFIX) || type.length === PREFIX.length) return type
  return type.slice(PREFIX.length)
}
