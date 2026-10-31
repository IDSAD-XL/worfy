// The colours of the groups on the worfy Guide's diagrams (ADR-0090, point 10): the one file of the
// Guide that names a kind-* role. The Guide's diagrams may colour a block by its group, an exception
// to the rule "Kind colours" of docs/design/F-SPEC.md that holds only inside the Guide; the three
// groups that match a kind take its band. Machine, Project and Tools get colours of their own with
// the scene kit (worfy-guide ticket 04), checked against the status colours.

export const GROUP_COLOURS = {
  /** Epics, Tickets, Waves: the Epic frame's ochre. */
  workflow: 'var(--kind-epic)',
  /** Sessions and Subagents. */
  agents: 'var(--kind-session)',
  /** The Harness and the Orchestrator. */
  harness: 'var(--kind-orchestrator)',
} as const
