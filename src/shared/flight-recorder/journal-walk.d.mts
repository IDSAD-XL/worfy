// Types of journal-walk.mjs: the Autopilot Journal read into facts. See that file for what each function does.

/** Every kind of Journal event, as JOURNAL_EVENT_KINDS of src/shared/autopilot/journal.ts. */
export declare const JOURNAL_KINDS: readonly string[]

/** The time of an ISO text in ms, or null. */
export declare function time(text: unknown): number | null

/** A Journal line that passed the checks: its fields as written, `at` in ms. */
export interface JournalEvent {
  kind: string
  at: number
  epic: string
  [field: string]: unknown
}

/** The events of one Journal file's text and the lines skipped, by reason. */
export interface ParsedJournal {
  lines: number
  notJson: number
  unknownKind: number
  badFields: number
  events: JournalEvent[]
}

export declare function parseJournal(text: string): ParsedJournal

export interface RunStart {
  at: number
  epic: string
  project: string | null
  origin: string | null
}

export interface RunWave {
  epic: string
  wave: number
  tickets: string[]
  start: number
  /** null: the Run stopped inside the Wave, a later wave-started replaced it, or the Journal ends. */
  end: number | null
}

export interface RunWait {
  epic: string
  /** The event that opened the wait. */
  cause: 'limits-hit' | 'waiting-until'
  start: number
  /** null: the Journal ends while the Run waits. */
  end: number | null
  /** The Tickets of the Wave open when the wait started. */
  tickets: string[]
}

export interface RunStop {
  kind: 'session-error' | 'run-stopped'
  at: number
  /** The reason of a run-stopped; null for a session-error. */
  reason: string | null
  epic: string
  /** The Tickets of the Wave open at the stop; none outside a Wave. */
  tickets: string[]
}

export interface NarrowRound {
  at: number
  epic: string
  ticket: string
  outcome: 'started' | 'verified' | 'rejected'
}

/** One Run from the events of its Journal file. */
export interface WalkedRun {
  /** The first run-started; null when the file has none. */
  started: RunStart | null
  /** The last run-stopped; null while the Run goes on or when the Journal was cut. */
  stopped: { at: number; reason: string } | null
  waves: RunWave[]
  waits: RunWait[]
  stops: RunStop[]
  narrowRounds: NarrowRound[]
}

export declare function walkRun(events: readonly JournalEvent[]): WalkedRun

export interface TicketJournal {
  /** The first wave-started that names the Ticket. */
  start: number | null
  /** The Limits wait while the Ticket's Wave was open, ms. */
  wait: number
  /** A wait of the Ticket's Wave has no end in the Journal. */
  openWait: boolean
  /** `session-error` and `run-stopped: <reason>` while the Ticket's Wave was open. */
  stops: string[]
  narrow: { started: number; rejected: number }
}

export interface EpicJournal {
  /** The repository of the Epic's Runs, else of a Run of the same Project. */
  origin: string | null
  project: string | null
  wait: number
  openWait: boolean
}

/** Every Run of the Journals by Ticket (`<epic>/<NN>`) and Epic; `files` — the events of each file, in name order. */
export declare function walkJournals(files: readonly (readonly JournalEvent[])[]): { tickets: Map<string, TicketJournal>; epics: Map<string, EpicJournal> }
