// The colours of the groups on the worfy Guide's diagrams (ADR-0090, point 10): the one file of the
// Guide that names a kind-* role. The Guide's diagrams may colour a block by its group, an exception
// to the rule "Kind colours" of docs/design/F-SPEC.md that holds only inside the Guide; the three
// groups that match a kind take its band. Machine, Project and Tools have colours of the Guide's own,
// --guide-machine, --guide-project and --guide-tools in guide.css (worfy-guide ticket 04), checked by
// test/unit/guide-scene-colours.test.ts: ΔE at least 15 from every status colour and from --accent,
// at least 3:1 against the grounds they are drawn on.

export const GROUP_COLOURS = {
  /** The Mac or the PC worfy runs on, and a Linked machine. */
  machine: 'var(--guide-machine)',
  /** A Project: its repository, its profile. */
  project: 'var(--guide-project)',
  /** Epics, Tickets, Waves: the Epic frame's ochre. */
  workflow: 'var(--kind-epic)',
  /** Sessions and Subagents. */
  agents: 'var(--kind-session)',
  /** Cards, the Terminal, the Browser. */
  tools: 'var(--guide-tools)',
  /** The Harness and the Orchestrator. */
  harness: 'var(--kind-orchestrator)',
} as const
