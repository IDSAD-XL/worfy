// The build of a Code story as the renderer holds it (worfy-code-stories ticket 04): main's `stories.build`
// with its lines (`stories.activity`) and Stop (`stories.stop`), for StoryProgress.tsx and the buttons of
// tickets 11 and 12. Ticket 11 adds `make`: the story made by the button (`stories.make`), where main reads the
// material itself and keeps the story, or opens the one it kept.
//
// A build made by the button runs to its end whatever view is open; only Stop ends it (worfy-polish 122: the owner's
// expectation of 2026-11-17 overrides, for these builds, the rule of the audit of PR #1890 that a build nobody waits for
// is stopped). Main keeps such builds by key, so a button that comes back to its PR or Epic — after a switch, or a
// reload of the window — follows the build under way (`follow`, `stories.running`) and ends with it (`stories.made`).
// The rule of #1890 stays for a build by `start` (`stories.build`): main keeps no key of it to come back to, so it is
// stopped when the component that holds it goes away, on reset() while it runs, and when start() or make() replaces it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { failureReason, type IpcResult } from '../../shared/ipc/channels'
import { RUNNING_LINES_KEPT, type StoryInput, type StoryMade, type StoryOutcome, type StoryTarget } from '../../shared/ipc/stories'
import type { Story } from '../../shared/stories/schema'
import { invoke, subscribe } from '../ipc'

/** How many lines of the agent's activity the bar shows; the oldest go first. */
export const SHOWN_LINES = RUNNING_LINES_KEPT

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
  /** Takes up the build by the button of `target` under way in main (`stories.running`), when this hook holds none. */
  follow: (target: StoryTarget) => Promise<void>
  stop: () => void
  reset: () => void
}

/** The build a hook holds: its storyId, and whether it is stopped when nobody waits for it (`start`: the rule of PR #1890). */
interface Held {
  storyId: string
  stopOnLeave: boolean
}

/**
 * The builds by the button that a mounted hook followed to their end (`stories.made`): the window's listener of the same
 * event shows no toast for them (use-story-toasts.ts). Each entry is taken by that listener, which hears every
 * stories.made the hook heard.
 */
const endedInView = new Set<string>()

/** Whether a mounted hook took the end of build `storyId`; forgets it. */
export function takeEndedInView(storyId: string): boolean {
  return endedInView.delete(storyId)
}

/**
 * The build of one story in Project `projectId`: start() or make() asks main, follows its lines and ends in `done`
 * with the story, or in the reason there is none; stop() ends it. follow() takes up a build by the button under way.
 */
export function useStoryBuild(projectId: string): StoryBuild {
  const [run, setRun] = useState<StoryRun>({ kind: 'idle' })
  const running = run.kind === 'running' ? run.storyId : null
  // The build main runs for this hook now; a later start() replaces it and its answer is dropped.
  const current = useRef<Held | null>(null)

  /** Takes `storyId` as this hook's build. */
  const hold = useCallback((storyId: string, stopOnLeave: boolean): void => {
    current.current = { storyId, stopOnLeave }
  }, [])

  /** Lets go of the build this hook holds, if any: a build by `start` is stopped, as nobody waits for its answer any more; one by the button runs on. */
  const abandon = useCallback((): void => {
    const held = current.current
    current.current = null
    if (held?.stopOnLeave === true) void invoke('stories.stop', { storyId: held.storyId })
  }, [])

  // Whether the hook is mounted: a build main names after the component went away is not taken up.
  const live = useRef(false)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      abandon()
    }
  }, [abandon])

  /** Ends build `storyId` with main's answer, unless this hook let go of it. */
  const settle = useCallback((storyId: string, { channel, result, key, reused }: Answer): void => {
    if (current.current?.storyId !== storyId) return
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
  }, [])

  useEffect(() => {
    if (running === null) return
    const lines = subscribe('stories.activity', ({ storyId, text }) => {
      setRun((now) => (now.kind === 'running' && now.storyId === storyId ? { ...now, lines: [...now.lines, text].slice(-SHOWN_LINES) } : now))
    })
    // The end of a build by the button, for a hook that took it up after the press's own answer was lost.
    const made = subscribe('stories.made', ({ storyId, made: answer }) => {
      if (current.current?.storyId !== storyId) return
      endedInView.add(storyId)
      settle(storyId, madeAnswer(answer))
    })
    return () => {
      lines()
      made()
    }
  }, [running, settle])

  const begin = useCallback(
    async (ask: (storyId: string) => Promise<Answer>, stopOnLeave: boolean): Promise<void> => {
      abandon()
      const storyId = crypto.randomUUID()
      hold(storyId, stopOnLeave)
      setRun({ kind: 'running', storyId, lines: [], stopping: false })
      settle(storyId, await ask(storyId))
    },
    [abandon, hold, settle],
  )

  const start = useCallback((input: StoryInput) => begin(async (storyId) => ({ channel: 'stories.build', result: await invoke('stories.build', { storyId, projectId, input }) }), true), [begin, projectId])

  const make = useCallback(
    (target: StoryTarget, options: { rebuild?: boolean } = {}) =>
      begin(async (storyId) => {
        const result = await invoke('stories.make', { storyId, projectId, target, ...(options.rebuild === true ? { rebuild: true } : {}) })
        if (!result.ok) return { channel: 'stories.make', result }
        return madeAnswer(result.value)
      }, false),
    [begin, projectId],
  )

  const follow = useCallback(
    async (target: StoryTarget): Promise<void> => {
      if (current.current !== null) return
      const result = await invoke('stories.running', { projectId, target })
      // A press, or another follow, took a build while main answered: that one stays.
      if (!result.ok || result.value === null || current.current !== null || !live.current) return
      const { storyId, lines } = result.value
      hold(storyId, false)
      setRun({ kind: 'running', storyId, lines: lines.slice(-SHOWN_LINES), stopping: false })
    },
    [hold, projectId],
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

  return { run, start, make, follow, stop, reset }
}

/** How stories.make answered, as the hook settles it. */
const madeAnswer = (made: StoryMade): Answer => ({ channel: 'stories.make', result: { ok: true, value: made.outcome }, key: made.key, reused: made.reused })
