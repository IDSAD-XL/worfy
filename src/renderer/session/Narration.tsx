import { memo } from 'react'

// The live summary of a Product Session's turn (worfy-product-session ticket 32): the last lines Haiku wrote about
// what the advisor is doing and why (src/main/agent/narrator.ts), under the status line of ticket 29, dimmed and
// small, oldest first. A small «summary» tag tells them from the advisor's own words. They are no chat messages:
// the Transcript draws them only while the turn runs, and the store drops them when it ends (store.ts).
//
// The lines stand inside the transcript's live region (role="log"), so each line keeps its element while the list
// moves on: its key is its number among the turn's lines (`first`, from main), never its place. A screen reader then
// hears the new line only, not every line again each time the oldest one goes.

/** The tooltip of the tag. */
export const NARRATION_TITLE = 'Short summary by Haiku while the advisor works'

export const Narration = memo(function Narration({ lines, first }: { lines: readonly string[]; first: number }) {
  return (
    <div className="w-pmsg__narration" role="group" data-testid="product-narration" aria-label="Live summary">
      <span className="w-pmsg__narration-tag" title={NARRATION_TITLE} data-testid="product-narration-tag">
        summary
      </span>
      <ul className="w-pmsg__narration-lines">
        {lines.map((line, at) => (
          <li key={first + at} className="w-pmsg__narration-line" data-testid="product-narration-line" title={line}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
})
