// The Limits for the toolbar: what main knows (`limits.open`), kept current
// through `limits.changed`, and a clock that redraws the bars so "as of" appears in time.
import { useEffect, useState } from 'react'
import { emptyLimits, type LimitsState } from '../../shared/agent/limits'
import { invoke, subscribe } from '../ipc'

/** How often the bars are redrawn, so "as of" appears once the data gets old. */
const REDRAW_MS = 60 * 1000

/** The Limits from main, kept current through `limits.changed`; empty until the first answer. */
export function useLimits(): LimitsState {
  const [state, setState] = useState<LimitsState>(emptyLimits)
  useEffect(() => {
    let active = true
    let changed = false
    let unsubscribe = (): void => undefined
    try {
      unsubscribe = subscribe('limits.changed', (next) => {
        changed = true
        setState(next)
      })
    } catch (error) {
      // No bridge (the preload did not run): show what limits.open answers rather than taking
      // the whole window down, as the other views do.
      console.error('limits.changed: cannot subscribe', error)
    }
    void invoke('limits.open').then((result) => {
      // A change that arrived first is newer than this snapshot.
      if (!active || changed) return
      if (result.ok) setState(result.value)
      else console.error('limits.open failed:', result.error)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return state
}

/** The current time, refreshed every minute. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REDRAW_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}
