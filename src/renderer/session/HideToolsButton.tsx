// The «Hide tools» button of the Session view's header (worfy-ui ticket 25); its choice is kept per
// Session by transcript-view.ts.

/**
 * The header button: pressed while tool calls are folded. An icon with its name in aria-label and
 * the tooltip, as the Subagent view's back arrow: a word would take the room the
 * header's title needs at the default window width.
 */
export function HideToolsButton({ hidden, onChange }: { hidden: boolean; onChange: (hidden: boolean) => void }) {
  const title = hidden
    ? 'Tool calls are folded into one line per run; calls with an error stay shown. Click to show every call. Remembered for this Session'
    : 'Fold tool calls into one line per run; calls with an error stay shown. Remembered for this Session'
  return (
    <button
      type="button"
      className="w-session__button w-session__toggle"
      aria-label="Hide tools"
      aria-pressed={hidden}
      title={`Hide tools: ${title}`}
      data-testid="session-hide-tools"
      onClick={() => onChange(!hidden)}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 3.5h11M2.5 12.5h11M5.5 6.5L8 9l2.5-2.5" />
      </svg>
    </button>
  )
}
