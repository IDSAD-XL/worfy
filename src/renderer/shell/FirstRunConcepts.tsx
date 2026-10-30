// The page of the three concepts (worfy-onboarding ticket 08, decision 8 of the epic's spec): what
// First run shows before its checks when it opened by itself on a new user's first start. The texts
// are the spec's, "Texts (draft)". This file is the content; the dialog around it, its header,
// footer and buttons, is FirstRun.tsx.
import type { CSSProperties } from 'react'

export const CONCEPTS_TITLE = 'Welcome to worfy'
export const CONCEPTS_LEAD = 'worfy runs Claude Code agents on your projects and shows their work. Three things to know:'
export const CONCEPTS_NOTE = 'Everything else is explained when you meet it.'

const CONCEPTS: readonly { name: string; text: string }[] = [
  {
    name: 'Project + Harness',
    text: 'A Project is a repository you work on. The Harness is the set of rules the agents follow in this Project: how to check a change, how to review it, when to merge.',
  },
  {
    name: 'Orchestrator',
    text: 'The Orchestrator is the main Claude Code Session of a Project. It hands tickets to agents, collects their reviews and merges the work.',
  },
  { name: 'Canvas', text: 'The Canvas is where it all shows: epics, tickets, Sessions and their progress, side by side.' },
]

const styles = {
  list: { listStyle: 'none', margin: 0, padding: 'var(--space-3) 0 var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
  name: { margin: '0 0 2px', fontSize: 'var(--text-13)', fontWeight: 600 },
  text: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-13)', lineHeight: 1.45 },
} satisfies Record<string, CSSProperties>

/** The three concepts, in the spec's order. */
export function FirstRunConcepts() {
  return (
    <ul style={styles.list} aria-label="Three things to know" data-testid="first-run-concepts">
      {CONCEPTS.map((concept) => (
        <li key={concept.name}>
          <h3 style={styles.name}>{concept.name}</h3>
          <p style={styles.text}>{concept.text}</p>
        </li>
      ))}
    </ul>
  )
}
