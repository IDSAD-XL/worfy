// The Terminal AI state for Settings → "Terminal AI": what main knows (`terminalAi.state`), kept
// current through `terminalAi.changed`, and the way to change a setting (`terminalAi.setSettings`).
// The channels are `local`: a window on a Linked machine's Project shows and changes the Terminal AI
// of its own Machine, as it does the Limits.
import { useCallback, useEffect, useRef, useState } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import type { TerminalAiState } from '../../shared/ipc/terminal-ai'
import type { TerminalAiSettingsPatch } from '../../shared/terminal-ai/settings'
import { invoke, subscribe } from '../ipc'

export interface TerminalAi {
  /** The state from main; undefined until it has answered once. */
  state: TerminalAiState | undefined
  /** Why there is no state, or why the last change was not saved; undefined when all is well. */
  problem: string | undefined
  /** Asks main to change some settings; the state follows main's answer. */
  change: (patch: TerminalAiSettingsPatch) => void
}

export function useTerminalAi(): TerminalAi {
  const [state, setState] = useState<TerminalAiState>()
  const [problem, setProblem] = useState<string>()
  // Answers can come back out of order: the last change asked for decides what `problem` says.
  const changes = useRef(0)
  // How many `terminalAi.changed` have come. A call's answer is taken only if none came since the
  // call was made: such a change is the newer state, whichever of the two arrives first.
  const events = useRef(0)

  useEffect(() => {
    let unsubscribe = (): void => undefined
    try {
      unsubscribe = subscribe('terminalAi.changed', (next) => {
        events.current += 1
        setState(next)
      })
    } catch (error) {
      // No bridge (the preload did not run): show what terminalAi.state answers, as the other views do.
      console.error('terminalAi.changed: cannot subscribe', error)
    }
    const seen = events.current
    // An answer that comes after the section is gone sets the state of nothing: React drops it.
    void invoke('terminalAi.state').then((result) => {
      if (!result.ok) setProblem(failureReason('terminalAi.state', result.error))
      else if (events.current === seen) setState(result.value)
    })
    return unsubscribe
  }, [])

  const change = useCallback((patch: TerminalAiSettingsPatch): void => {
    const asked = ++changes.current
    const seen = events.current
    void invoke('terminalAi.setSettings', patch).then((result) => {
      // Main sends `terminalAi.changed` for a change it made, so the answer usually finds it here.
      if (result.ok && events.current === seen) setState(result.value)
      if (asked === changes.current) setProblem(result.ok ? undefined : failureReason('terminalAi.setSettings', result.error))
    })
  }, [])

  return { state, problem, change }
}
