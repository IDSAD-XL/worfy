import { memo, useEffect, useState } from 'react'
import type { AdvisorStatusLine } from './advisor-status'

// The status line at the end of a Product Session's chat while a turn runs (worfy-product-session ticket 29):
// what the advisor does now (advisor-status.ts) and how long this step has taken. Only this component ticks once
// a second; the chat around it draws again only when an event comes. A new step (another `key`) starts the
// timer again. The time is hidden from screen readers so the live region speaks the step, not every second.

/** Whole seconds under a minute, then minutes and seconds. */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} m ${seconds % 60} s`
}

function Step({ text, since }: { text: string; since: number | null }) {
  const [start] = useState(() => since ?? Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="w-pmsg w-pmsg--advisor w-pmsg--thinking" role="status" data-testid="product-thinking">
      <div className="w-pmsg__meta">
        <span className="w-pmsg__avatar" aria-hidden="true">
          A
        </span>
        <span className="w-pmsg__status" data-testid="product-status" title={text}>
          {text}
        </span>
        <span aria-hidden="true">·</span>
        <span className="w-pmsg__elapsed" data-testid="product-status-elapsed" aria-hidden="true">
          {elapsed(now - start)}
        </span>
        <span className="w-pmsg__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  )
}

export const AdvisorStatus = memo(
  function AdvisorStatus({ status }: { status: AdvisorStatusLine }) {
    return <Step key={status.key} text={status.text} since={status.since} />
  },
  (before, after) => before.status.key === after.status.key && before.status.text === after.status.text && before.status.since === after.status.since,
)
