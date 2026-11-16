// The build of a Code story as the renderer holds it (worfy-code-stories ticket 04): main's `stories.build`
// with its lines (`stories.activity`) and Stop (`stories.stop`), for StoryProgress.tsx and the buttons of
// tickets 11 and 12. Ticket 11 adds `make`: the story made by the button (`stories.make`), where main reads the
// material itself and keeps the story, or opens the one it kept.
//
// A build nobody waits for any more is stopped, so its paid request does not run to its end (audit of PR #1890):
// when the component that holds it goes away, on reset() while it runs, and when start() or make() replaces it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { failureReason, type IpcResult } from '../../shared/ipc/channels'
import type { StoryInput, StoryOutcome, StoryTarget } from '../../shared/ipc/stories'
import type { Story } from '../../shared/stories/schema'
import { invoke, subscribe } from '../ipc'

/** How many lines of the agent's activity the bar shows; the oldest go first. */
export const SHOWN_LINES = 3

export type StoryRun =
  | { kind: 'idle' }
  | { kind: 'running'; storyId: string; lines: string[]; stopping: boolean }
  /** `key`: where main keeps a story made by the button; `reused` — the kept one, opened without a request. */
  | { kind: 'done'; story: Story; key?: string; reused?: boolean }
  | { kind: 'stopped' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unavailable'; reason: string }

/** The line the bar shows before the agent's first one. */
export const STARTING_LINE = 'Starting…'

/** How main answered a build: the outcome, and for a story made by the button its key and whether it was kept before. */
type Answer = { channel: 'stories.build' | 'stories.make'; result: IpcResult<StoryOutcome>; key?: string; reused?: boolean }

export interface StoryBuild {
  run: StoryRun
  start: (input: StoryInput) => Promise<void>
  /** The story of `target` made by the button (`stories.make`); `rebuild` builds it again in place of the kept one. */
  make: (target: StoryTarget, options?: { rebuild?: boolean }) => Promise<void>
  stop: () => void
  reset: () => void
}

/**
 * The build of one story in Project `projectId`: start() or make() asks main, follows its lines and ends in `done`
 * with the story, or in the reason there is none; stop() ends it.
 */
export function useStoryBuild(projectId: string): StoryBuild {
  const [run, setRun] = useState<StoryRun>({ kind: 'idle' })
  const running = run.kind === 'running' ? run.storyId : null
  // The build main runs for this hook now; a later start() replaces it and its answer is dropped.
  const current = useRef<string | null>(null)

  /** Stops the build main runs for this hook, if any: nobody waits for its answer any more. */
  const abandon = useCallback((): void => {
    const storyId = current.current
    current.current = null
    if (storyId !== null) void invoke('stories.stop', { storyId })
  }, [])

  useEffect(() => abandon, [abandon])

  useEffect(() => {
    if (running === null) return
    return subscribe('stories.activity', ({ storyId, text }) => {
      setRun((now) => (now.kind === 'running' && now.storyId === storyId ? { ...now, lines: [...now.lines, text].slice(-SHOWN_LINES) } : now))
    })
  }, [running])

  const begin = useCallback(
    async (ask: (storyId: string) => Promise<Answer>): Promise<void> => {
      abandon()
      const storyId = crypto.randomUUID()
      current.current = storyId
      setRun({ kind: 'running', storyId, lines: [], stopping: false })
      const { channel, result, key, reused } = await ask(storyId)
      if (current.current !== storyId) return
      current.current = null
      if (!result.ok) {
        setRun({ kind: 'failed', reason: failureReason(channel, result.error) })
        return
      }
      const outcome = result.value
      switch (outcome.status) {
        case 'story':
          setRun({ kind: 'done', story: outcome.story, ...(key === undefined ? {} : { key, reused: reused === true }) })
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
    [abandon],
  )

  const start = useCallback((input: StoryInput) => begin(async (storyId) => ({ channel: 'stories.build', result: await invoke('stories.build', { storyId, projectId, input }) })), [begin, projectId])

  const make = useCallback(
    (target: StoryTarget, options: { rebuild?: boolean } = {}) =>
      begin(async (storyId) => {
        const result = await invoke('stories.make', { storyId, projectId, target, ...(options.rebuild === true ? { rebuild: true } : {}) })
        if (!result.ok) return { channel: 'stories.make', result }
        return { channel: 'stories.make', result: { ok: true, value: result.value.outcome }, key: result.value.key, reused: result.value.reused }
      }),
    [begin, projectId],
  )

  const stop = useCallback((): void => {
    if (run.kind !== 'running' || run.stopping) return
    setRun({ ...run, stopping: true })
    void invoke('stories.stop', { storyId: run.storyId })
  }, [run])

  const reset = useCallback((): void => {
    abandon()
    setRun({ kind: 'idle' })
  }, [abandon])

  return { run, start, make, stop, reset }
}
