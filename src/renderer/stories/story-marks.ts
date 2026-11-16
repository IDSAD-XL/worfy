// The screens of a Code story read and the person's answers to its "Check yourself", as the renderer holds them
// (worfy-code-stories ticket 13; spec, owner decision 15, stories 20 and 21): read from main once per story the view shows
// (`stories.marks`, kept in stories.json of worfy's data under the key of the story's answers), and added to as the
// person reads and answers. A screen read before main has named the key is sent once it has. Held by the story object,
// as its answers about lines are (story-answers.ts): a story opened anew is read anew. Nothing depends on them.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { StoryReadMark, StorySelfCheck } from '../../shared/ipc/stories'
import type { StoryFile } from '../../shared/stories/schema'
import { invoke } from '../ipc'
import { madeStoryKey } from './open'

/** What the view shows of the reading of a story: the screens read and the answers to "Check yourself". */
export interface ShownMarks {
  read: readonly StoryReadMark[]
  checks: readonly StorySelfCheck[]
}

interface Kept {
  shown: ShownMarks
  /** The key main keeps them under; null until it has said. */
  key: string | null
  projectId: string | null
  /** Screens read and questions answered before main named the key: sent once it has. */
  pending: StoryReadMark[]
  pendingChecks: { question: string; answer: string | null }[]
  listeners: Set<() => void>
}

const kept = new WeakMap<object, Kept>()

function keptOf(story: StoryFile): Kept {
  let entry = kept.get(story)
  if (entry === undefined) {
    entry = { shown: { read: [], checks: [] }, key: null, projectId: null, pending: [], pendingChecks: [], listeners: new Set() }
    kept.set(story, entry)
  }
  return entry
}

/** Whether two marks name the same screen. */
export const sameMark = (a: StoryReadMark, b: StoryReadMark): boolean =>
  'screen' in a ? 'screen' in b && a.screen === b.screen : !('screen' in b) && a.ticket === b.ticket && a.step === b.step

function changed(entry: Kept, shown: ShownMarks): void {
  entry.shown = shown
  for (const listener of entry.listeners) listener()
}

const send = (projectId: string, key: string, mark: StoryReadMark): void => {
  void invoke('stories.markRead', { projectId, key, mark })
}

const sendCheck = (projectId: string, key: string, answer: { question: string; answer: string | null }): void => {
  void invoke('stories.selfCheck', { projectId, key, answer })
}

/** Asks main once for what it keeps of `story`; what was read or answered meanwhile stays, and is sent. */
function readOnce(projectId: string, story: StoryFile): void {
  const entry = keptOf(story)
  if (entry.projectId !== null) return
  entry.projectId = projectId
  const made = madeStoryKey(story)
  void invoke('stories.marks', { projectId, story, ...(made === undefined ? {} : { key: made }) }).then((result) => {
    // A reply of another shape (a stand-in of main) keeps nothing.
    if (!result.ok || !Array.isArray(result.value.read) || !Array.isArray(result.value.checks)) return
    const { key, read, checks } = result.value
    entry.key = key
    for (const mark of entry.pending) if (!read.some((one) => sameMark(one, mark))) send(projectId, key, mark)
    for (const answer of entry.pendingChecks) sendCheck(projectId, key, answer)
    entry.pending = []
    entry.pendingChecks = []
    changed(entry, {
      read: [...read, ...entry.shown.read.filter((mark) => !read.some((one) => sameMark(one, mark)))],
      checks: [...checks.filter((check) => !entry.shown.checks.some((one) => one.question === check.question)), ...entry.shown.checks],
    })
  })
}

/** Marks screen `mark` of `story` read; main keeps it when the view has a Project. */
export function markRead(story: StoryFile, mark: StoryReadMark): void {
  const entry = keptOf(story)
  if (entry.shown.read.some((one) => sameMark(one, mark))) return
  changed(entry, { ...entry.shown, read: [...entry.shown.read, mark] })
  if (entry.projectId === null) return
  if (entry.key === null) entry.pending.push(mark)
  else send(entry.projectId, entry.key, mark)
}

/** Shows the person's answer to `question` of `story` (null: "I don't know"), and has main keep it. */
export function answerSelfCheck(story: StoryFile, question: string, answer: string | null): void {
  const entry = keptOf(story)
  const check: StorySelfCheck = { at: new Date().toISOString(), question, answer }
  changed(entry, { ...entry.shown, checks: [...entry.shown.checks.filter((one) => one.question !== question), check] })
  if (entry.projectId === null) return
  if (entry.key === null) entry.pendingChecks = [...entry.pendingChecks.filter((one) => one.question !== question), { question, answer }]
  else sendCheck(entry.projectId, entry.key, { question, answer })
}

/** The screens of `story` read and its answers to "Check yourself"; nothing is read or kept without a Project. */
export function useStoryMarks(projectId: string | undefined, story: StoryFile): ShownMarks {
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
  const marks = useSyncExternalStore(subscribe, () => keptOf(story).shown)
  useEffect(() => {
    if (projectId !== undefined) readOnce(projectId, story)
  }, [projectId, story])
  return marks
}
