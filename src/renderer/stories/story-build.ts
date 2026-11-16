// The build of a Code story as the renderer holds it (worfy-code-stories ticket 04): main's `stories.build`
// with its lines (`stories.activity`) and Stop (`stories.stop`), for StoryProgress.tsx and the buttons of
// tickets 11 and 12.
import { useCallback, useEffect, useRef, useState } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import type { StoryInput } from '../../shared/ipc/stories'
import type { Story } from '../../shared/stories/schema'
import { invoke, subscribe } from '../ipc'

/** How many lines of the agent's activity the bar shows; the oldest go first. */
export const SHOWN_LINES = 3

export type StoryRun =
  | { kind: 'idle' }
  | { kind: 'running'; storyId: string; lines: string[]; stopping: boolean }
  | { kind: 'done'; story: Story }
  | { kind: 'stopped' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unavailable'; reason: string }

/** The line the bar shows before the agent's first one. */
export const STARTING_LINE = 'Starting…'

/**
 * The build of one story in Project `projectId`: start() asks main (`stories.build`), follows its lines
 * and ends in `done` with the story, or in the reason there is none; stop() ends it.
 */
export function useStoryBuild(projectId: string): { run: StoryRun; start: (input: StoryInput) => Promise<void>; stop: () => void; reset: () => void } {
  const [run, setRun] = useState<StoryRun>({ kind: 'idle' })
  const running = run.kind === 'running' ? run.storyId : null
  // The build a later start() replaced: its answer is dropped.
  const current = useRef<string | null>(null)

  useEffect(() => {
    if (running === null) return
    return subscribe('stories.activity', ({ storyId, text }) => {
      setRun((now) => (now.kind === 'running' && now.storyId === storyId ? { ...now, lines: [...now.lines, text].slice(-SHOWN_LINES) } : now))
    })
  }, [running])

  const start = useCallback(
    async (input: StoryInput): Promise<void> => {
      const storyId = crypto.randomUUID()
      current.current = storyId
      setRun({ kind: 'running', storyId, lines: [], stopping: false })
      const result = await invoke('stories.build', { storyId, projectId, input })
      if (current.current !== storyId) return
      current.current = null
      if (!result.ok) {
        setRun({ kind: 'failed', reason: failureReason('stories.build', result.error) })
        return
      }
      const outcome = result.value
      switch (outcome.status) {
        case 'story':
          setRun({ kind: 'done', story: outcome.story })
          return
        case 'stopped':
          setRun({ kind: 'stopped' })
          return
        case 'unavailable':
          setRun({ kind: 'unavailable', reason: outcome.reason })
          return
        case 'failed':
          setRun({ kind: 'failed', reason: outcome.reason })
          return
      }
    },
    [projectId],
  )

  const stop = useCallback((): void => {
    if (run.kind !== 'running' || run.stopping) return
    setRun({ ...run, stopping: true })
    void invoke('stories.stop', { storyId: run.storyId })
  }, [run])

  const reset = useCallback((): void => {
    current.current = null
    setRun({ kind: 'idle' })
  }, [])

  return { run, start, stop, reset }
}
