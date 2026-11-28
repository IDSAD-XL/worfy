// The time of a row of a chat (row-time.ts), drawn the same in the Session view's transcript and in the Assistant's
// Chat (worfy-polish ticket 171).
import type { RowWhen } from './row-time'

/** The time under a row's label, or in a message's meta line: the date for another day, then the clock. */
export function RowTime({ at, when, className = 'w-tr__time' }: { at: number; when: RowWhen; className?: string }) {
  return (
    <time className={className} dateTime={new Date(at).toISOString()} title={when.full} data-testid="transcript-time">
      {when.date !== null ? (
        <span className="w-tr__date" data-testid="transcript-date">
          {when.date}
        </span>
      ) : null}
      <span data-testid="transcript-clock">{when.clock}</span>
    </time>
  )
}
