// What a Terminal Node shows on the Canvas of a Linked machine that shares its Projects read-only
// (worfy-link ticket 25, ADR-0066). The Terminal itself is never mounted there: opening it starts
// the shell on the Project's Machine (`terminal.open` is a `write` call), and its output is not
// sent to a read-only Machine at all (`terminal.output` is a `write` event). NodeChrome.tsx draws
// this in its place; the look is the Terminal's header and colours (nodes/TerminalNode.css).
import type { CSSProperties } from 'react'
import { NODE_HEADER } from './node-header'

const styles = {
  body: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-3)',
    textAlign: 'center',
    fontSize: 'var(--text-12)',
    lineHeight: '18px',
    color: 'color-mix(in srgb, var(--terminal-text) 60%, var(--terminal-bg))',
  },
} satisfies Record<string, CSSProperties>

export function ReadOnlyTerminal({ id, hint }: { id: string; hint: string }) {
  return (
    <div className="w-node-surface w-terminal" data-testid="terminal-node-read-only" data-node-id={id} title={hint}>
      <div className="w-terminal__header" {...NODE_HEADER}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
          <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
        </svg>
        <span className="w-terminal__title">
          Terminal
        </span>
      </div>
      <div style={styles.body}>
        <span>
          {hint}. Terminal output is not shared with it.
        </span>
      </div>
    </div>
  )
}
