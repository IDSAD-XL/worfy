// worfy's own memory for the toolbar (worfy-ui ticket 20): while `enabled`, the window opens the
// figure in main (`memory.open`), follows `memory.changed`, and closes it (`memory.close`) when it
// stops showing it — the setting turned off or the component gone — so main samples only for the
// windows that show it (src/main/diagnostics/memory.ts).
import { useEffect, useState } from 'react'
import type { MemoryUsage } from '../../shared/memory'
import { invoke, subscribe } from '../ipc'

/** The latest sample while `enabled`; null before the first one and while not enabled. */
export function useAppMemory(enabled: boolean): MemoryUsage | null {
  const [usage, setUsage] = useState<MemoryUsage | null>(null)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    let changed = false
    let unsubscribe = (): void => undefined
    try {
      unsubscribe = subscribe('memory.changed', (next) => {
        changed = true
        setUsage(next)
      })
    } catch (error) {
      // No bridge (the preload did not run): the figure stays empty rather than taking the window down.
      console.error('memory.changed: cannot subscribe', error)
    }
    void invoke('memory.open').then((result) => {
      // A sample that arrived first is newer than this answer.
      if (!active || changed) return
      if (result.ok) setUsage(result.value)
      else console.error('memory.open failed:', result.error)
    })
    return () => {
      active = false
      unsubscribe()
      void invoke('memory.close')
      // Turned on again later, the figure starts from "…", not from an old sample.
      setUsage(null)
    }
  }, [enabled])
  return usage
}
