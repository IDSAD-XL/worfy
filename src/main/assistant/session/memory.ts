// The memory of the Assistant's Sessions (worfy-assistant ticket 10; ADR-0114, point 2): one file,
// `<WORFY_DATA_DIR>/assistant/memory.json` (src/main/assistant/duties/memory.ts), with the duties as the user set them,
// the rules drawn from dislikes, the open proposals, the Assistant's commitments and the user's answers.
//
// - SessionMemory: what a Session writes through `worfy-app` (memory_note, memory_forget) — a commitment or an answer of
//   the user. A new answer on the same topic replaces the old one.
// - memoryView: what each new Session gets in its first message — the five, without the counters and the items the
//   duties keep for themselves. A proposal names its item by the id `worfy-app` knows it by.
// - memoryForPrompt: the view as the first message carries it. Every text in it is an outside-text object, as text
//   other people wrote is in `worfy-app`'s answers: a note an earlier Session wrote may hold text it read somewhere,
//   and must read as data, never as an instruction. At most MEMORY_PROMPT_MAX_CHARS characters: the duties and the
//   rules always, then the proposals, commitments and answers newest first; how many older ones stayed out is counted.
import { randomUUID } from 'node:crypto'
import { ANSWERS_MAX, COMMITMENTS_MAX, commitmentSchema, userAnswerSchema, type Commitment, type UserAnswer } from '../../../shared/assistant/memory'
import { outsideText, type OutsideText } from '../../mcp/app-server'
import { readJsonFile } from '../../storage/json-file'
import { assistantMemorySchema, type AssistantMemory, type SessionMemoryStore } from '../duties/memory'

/** What a Session asks to keep. */
export type MemoryNote = { kind: 'commitment'; text: string; due: number | null } | { kind: 'answer'; topic: string; text: string }

export interface SessionMemoryOptions {
  store: SessionMemoryStore
  now: () => number
  /** A new entry's id; a random UUID by default. */
  id?: () => string
}

/** The topic as a key: case and the spaces around it do not make another topic. */
const topicKey = (topic: string): string => topic.trim().toLowerCase()

export class SessionMemory {
  constructor(private readonly options: SessionMemoryOptions) {}

  /** Keeps a commitment or an answer; throws when the memory is full or the entry is out of its bounds, and keeps nothing. */
  note(note: MemoryNote): Commitment | UserAnswer {
    const part = this.options.store.read()
    const id = (this.options.id ?? randomUUID)()
    const at = this.options.now()
    if (note.kind === 'commitment') {
      const commitments = part.commitments ?? []
      if (commitments.length >= COMMITMENTS_MAX) throw new Error(`The memory keeps ${COMMITMENTS_MAX} commitments: forget one that is done first (memory_forget)`)
      const commitment = commitmentSchema.parse({ id, text: note.text.trim(), due: note.due, at })
      this.options.store.write({ ...part, commitments: [...commitments, commitment] })
      return commitment
    }
    const answers = (part.answers ?? []).filter((each) => topicKey(each.topic) !== topicKey(note.topic))
    if (answers.length >= ANSWERS_MAX) throw new Error(`The memory keeps ${ANSWERS_MAX} answers: forget one that no longer holds first (memory_forget)`)
    const answer = userAnswerSchema.parse({ id, topic: note.topic.trim(), text: note.text.trim(), at })
    this.options.store.write({ ...part, answers: [...answers, answer] })
    return answer
  }

  /** Drops a commitment or an answer; throws for an id the memory does not hold. */
  forget(id: string): void {
    const part = this.options.store.read()
    const commitments = part.commitments ?? []
    const answers = part.answers ?? []
    if (!commitments.some((each) => each.id === id) && !answers.some((each) => each.id === id)) throw new Error(`The memory holds no commitment or answer ${id}`)
    this.options.store.write({ ...part, commitments: commitments.filter((each) => each.id !== id), answers: answers.filter((each) => each.id !== id) })
  }
}

/** The memory as a new Session reads it. */
export interface MemoryView {
  pauseAfter: number | null
  /** The duties the user changed, by id: what they chose, and the pause. A duty not listed is as worfy made it. */
  duties: Record<string, { modes?: Record<string, string>; projects?: string[]; thresholdMinutes?: number; enabled?: boolean; paused?: { at: string; by: string } }>
  rules: { id: string; duty: string; projectId: string | null; source: string; kind: string; text: string }[]
  proposals: { id: string; title: string; why: string; item: string | null; prepare: { projectId: string; text: string } | null; createdAt: string }[]
  commitments: { id: string; text: string; due: string | null; at: string }[]
  answers: { id: string; topic: string; text: string; at: string }[]
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** The view of `memory` (none: an empty one); `itemId` gives an item's id as `worfy-app` names it. */
export function memoryView(memory: AssistantMemory | undefined, itemId: (id: string) => string): MemoryView {
  const duties: MemoryView['duties'] = {}
  for (const [id, state] of Object.entries(memory?.duties ?? {})) {
    duties[id] = {
      ...(state.modes === undefined ? {} : { modes: { ...state.modes } as Record<string, string> }),
      ...(state.projects === undefined ? {} : { projects: [...state.projects] }),
      ...(state.thresholdMinutes === undefined ? {} : { thresholdMinutes: state.thresholdMinutes }),
      ...(state.enabled === undefined ? {} : { enabled: state.enabled }),
      ...(state.paused === undefined ? {} : { paused: { at: iso(state.paused.at), by: state.paused.by } }),
    }
  }
  return {
    pauseAfter: memory?.pauseAfter ?? null,
    duties,
    rules: (memory?.rules ?? []).map(({ id, duty, projectId, source, kind, text }) => ({ id, duty, projectId, source, kind, text })),
    proposals: (memory?.proposals ?? []).map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      why: proposal.why,
      item: proposal.item === null ? null : itemId(proposal.item),
      prepare: proposal.prepare,
      createdAt: iso(proposal.createdAt),
    })),
    commitments: (memory?.commitments ?? []).map((each) => ({ id: each.id, text: each.text, due: each.due === null ? null : iso(each.due), at: iso(each.at) })),
    answers: (memory?.answers ?? []).map((each) => ({ id: each.id, topic: each.topic, text: each.text, at: iso(each.at) })),
  }
}

/** The view of the memory file `file`; an unreadable file is set aside by readJsonFile and reads as an empty memory. */
export function readMemoryView(file: string, itemId: (id: string) => string): MemoryView {
  return memoryView(readJsonFile(file, assistantMemorySchema), itemId)
}

/**
 * The most characters of memory one first message carries (about 8k tokens): a full memory — 100 answers of 2,000
 * characters and 50 commitments — would cost some 55k tokens of the strong model on every wake. Decided without the
 * owner (ticket 10, result section).
 */
export const MEMORY_PROMPT_MAX_CHARS = 32_000

/** The source of the memory's texts in their outside-text objects. */
export const MEMORY_TEXT_SOURCE = 'assistant-memory'

const note = (text: string): OutsideText => outsideText(text, MEMORY_TEXT_SOURCE)

/** The memory as the first message carries it: its texts as outside-text objects. */
export interface PromptMemory {
  pauseAfter: MemoryView['pauseAfter']
  duties: MemoryView['duties']
  rules: (Omit<MemoryView['rules'][number], 'text'> & { text: OutsideText })[]
  proposals: (Omit<MemoryView['proposals'][number], 'title' | 'why' | 'prepare'> & { title: OutsideText; why: OutsideText; prepare: { projectId: string; text: OutsideText } | null })[]
  commitments: (Omit<MemoryView['commitments'][number], 'text'> & { text: OutsideText })[]
  answers: (Omit<MemoryView['answers'][number], 'topic' | 'text'> & { topic: OutsideText; text: OutsideText })[]
}

type Dated = 'proposals' | 'commitments' | 'answers'
type Entry = { [K in Dated]: { list: K; at: string; value: PromptMemory[K][number] } }[Dated]

/** `view` within `maxChars` characters, and how many entries of each dated list stayed out (the oldest). */
export function memoryForPrompt(view: MemoryView, maxChars: number = MEMORY_PROMPT_MAX_CHARS): { memory: PromptMemory; leftOut: Record<Dated, number> } {
  const memory: PromptMemory = {
    pauseAfter: view.pauseAfter,
    duties: view.duties,
    rules: view.rules.map((rule) => ({ ...rule, text: note(rule.text) })),
    proposals: [],
    commitments: [],
    answers: [],
  }
  const entries: Entry[] = [
    ...view.proposals.map((each): Entry => ({
      list: 'proposals',
      at: each.createdAt,
      value: { ...each, title: note(each.title), why: note(each.why), prepare: each.prepare === null ? null : { projectId: each.prepare.projectId, text: note(each.prepare.text) } },
    })),
    ...view.commitments.map((each): Entry => ({ list: 'commitments', at: each.at, value: { ...each, text: note(each.text) } })),
    ...view.answers.map((each): Entry => ({ list: 'answers', at: each.at, value: { ...each, topic: note(each.topic), text: note(each.text) } })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const leftOut: Record<Dated, number> = { proposals: 0, commitments: 0, answers: 0 }
  let size = JSON.stringify(memory).length
  let full = false
  for (const entry of entries) {
    // One more element of a JSON array: its text and a comma.
    const cost = JSON.stringify(entry.value).length + 1
    full = full || size + cost > maxChars
    if (full) {
      leftOut[entry.list] += 1
      continue
    }
    ;(memory[entry.list] as unknown[]).push(entry.value)
    size += cost
  }
  return { memory, leftOut }
}
