// The history part of a Vendor driver (ADR-0094 item 2): the Vendor's past Sessions of a folder and
// their transcripts, as worfy's transcript entries.
import type { TranscriptEntry } from '../../shared/transcript/parse'

/** A past Session of the Vendor. */
export interface HistorySession {
  id: string
  /** Where it ran; null when the Vendor does not say. */
  cwd: string | null
  /** The Vendor's name for it; null when it has none. */
  title: string | null
  /** When it last changed, in epoch milliseconds; null when the Vendor does not say. */
  updatedAt: number | null
  /**
   * Where it was started: in worfy, outside it (a terminal, another app: Resume asks first, spec
   * decision 9), or null when the Vendor does not tell.
   */
  origin: 'worfy' | 'external' | null
}

export interface HistoryPart {
  /** The Sessions of the folder `cwd`. */
  list(cwd: string): Promise<HistorySession[]>
  /**
   * The transcript of the Session `id` of the folder `cwd` (a Vendor that finds it by id alone
   * ignores `cwd`); rejects when there is none.
   */
  read(id: string, cwd: string): Promise<TranscriptEntry[]>
}
