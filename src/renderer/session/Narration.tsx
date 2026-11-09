import { memo } from 'react'

// The live summary of a Product Session's turn (worfy-product-session ticket 32): the last lines Haiku wrote about
// what the advisor is doing and why (src/main/agent/narrator.ts), under the status line of ticket 29, dimmed and
// small, oldest first. A small «summary» tag tells them from the advisor's own words. They are no chat messages:
// the Transcript draws them only while the turn runs, and the store drops them when it ends (store.ts).

/** The tooltip of the tag. */
export const NARRATION_TITLE = 'Short summary by Haiku while the advisor works'

export const Narration = memo(function Narration({ lines }: { lines: readonly string[] }) {
  return (
    <div className="w-pmsg__narration" data-testid="product-narration" aria-label="Live summary">
      <span className="w-pmsg__narration-tag" title={NARRATION_TITLE} data-testid="product-narration-tag">
        summary
      </span>
      <ul className="w-pmsg__narration-lines">
        {lines.map((line, at) => (
          <li key={`${at}:${line}`} className="w-pmsg__narration-line" data-testid="product-narration-line" title={line}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
})
