// The answers to questions about lines of a Code story as the renderer holds them (worfy-code-stories ticket 12): read
// from main once per story the view shows (`stories.answers`, kept in worfy's data under what the story names), and
// added to as questions are answered (LineQuestion.tsx). With them main gives the digest of the shown story: an answer
// with another digest was asked about an earlier text of it. Held by the story object: a story opened anew is read anew.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { StoryAnswer } from '../../shared/ipc/stories'
import type { StoryFile, StoryLabels } from '../../shared/stories/schema'
import { invoke } from '../ipc'

/** The answers of a story and the digest of its shown text; null until main has said. */
export interface ShownAnswers {
  answers: readonly StoryAnswer[]
  digest: string | null
}

interface Kept {
  shown: ShownAnswers
  read: boolean
  listeners: Set<() => void>
}

const kept = new WeakMap<object, Kept>()

function keptOf(story: StoryFile): Kept {
  let entry = kept.get(story)
  if (entry === undefined) {
    entry = { shown: { answers: [], digest: null }, read: false, listeners: new Set() }
    kept.set(story, entry)
  }
  return entry
}

const sameAnswer = (a: StoryAnswer, b: StoryAnswer): boolean => a.at === b.at && a.question === b.question

function changed(entry: Kept, shown: ShownAnswers): void {
  entry.shown = shown
  for (const listener of entry.listeners) listener()
}

/** Asks main once for the answers kept for `story`; those added meanwhile stay after them. */
function readOnce(projectId: string, story: StoryFile): void {
  const entry = keptOf(story)
  if (entry.read) return
  entry.read = true
  void invoke('stories.answers', { projectId, story }).then((result) => {
    // A reply of another shape (a stand-in of main) shows none.
    if (!result.ok || !Array.isArray(result.value.answers)) return
    const read = result.value.answers
    changed(entry, { digest: result.value.digest, answers: [...read, ...entry.shown.answers.filter((answer) => !read.some((one) => sameAnswer(one, answer)))] })
  })
}

/** Shows a new answer to a question about `story`. */
export function addStoryAnswer(story: StoryFile, answer: StoryAnswer): void {
  const entry = keptOf(story)
  changed(entry, { ...entry.shown, answers: [...entry.shown.answers, answer] })
}

/** The answers kept for `story` and the digest of its text; nothing is read without a Project. */
export function useStoryAnswers(projectId: string | undefined, story: StoryFile): ShownAnswers {
  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = keptOf(story)
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },
    [story],
  )
  const answers = useSyncExternalStore(subscribe, () => keptOf(story).shown)
  useEffect(() => {
    if (projectId !== undefined) readOnce(projectId, story)
  }, [projectId, story])
  return answers
}

/** "Question about line 7" or "Question about lines 7–9", in the story's language. */
export const questionName = (labels: StoryLabels, lines: { from: number; to: number }): string =>
  lines.from === lines.to
    ? labels.questionAboutLine.replace('{n}', String(lines.from))
    : labels.questionAboutLines.replace('{from}', String(lines.from)).replace('{to}', String(lines.to))
