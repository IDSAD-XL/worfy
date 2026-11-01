// Types of pr-facts.mjs: a PR as gh gives it read into facts. See that file for what each function does.

/** A check run (CI) or a commit status (a merge mark) of `statusCheckRollup`. */
export interface GhCheck {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
  startedAt?: string | null
  completedAt?: string | null
  createdAt?: string | null
}

export interface GhComment {
  createdAt?: string
  body?: string
}

export interface GhCommit {
  authoredDate?: string
  committedDate?: string
}

export interface GhLabel {
  id?: string
  name?: string
  description?: string
  color?: string
}

/** A run of `gh run list --json` with GH_RUN_FIELDS. */
export interface GhRun {
  status?: string
  conclusion?: string | null
  event?: string
  createdAt?: string
  updatedAt?: string
}

/** A PR of `gh pr view` / `gh pr list --json` with GH_FIELDS (or GH_APP_FIELDS); `ciRuns` — the runs of its branch. */
export interface GhPr {
  number: number
  headRefName?: string
  state?: string
  createdAt?: string
  mergedAt?: string | null
  statusCheckRollup?: GhCheck[]
  comments?: GhComment[]
  commits?: GhCommit[]
  files?: (string | { path?: string })[]
  labels?: GhLabel[]
  mergeCommit?: { oid?: string } | null
  ciRuns?: GhRun[]
}

/** A mark: { at } (at null — a head without CI, headCi only) or { why } when there is no time. */
export type Mark = { at: number | null; why?: undefined } | { why: string; at?: undefined }

export interface VerdictComment {
  at: number | null
  /** null: the opening of a narrow round. */
  verdict: 'VERIFIED' | 'REJECTED' | null
  narrow: boolean
}

export interface HeadMark {
  name: string
  state: string | null
  at: number | null
}

export interface CiRun {
  status: string | null
  conclusion: string | null
  event: string | null
  created: number | null
  updated: number | null
}

export interface PrFacts {
  number: number
  branch: string | null
  state: string | null
  opened: number | null
  merged: number | null
  /** The merge commit's oid (GH_APP_FIELDS); null before the merge or without the field. */
  mergeCommit: string | null
  firstCommit: number | null
  ciRuns: CiRun[]
  /** CI green before the Gate (ciMark). */
  ci: Mark
  /** CI on the head (headCi). */
  headCi: Mark
  headMarks: HeadMark[]
  verdicts: VerdictComment[]
  labels: string[]
}

export declare const GH_FIELDS: string
/** GH_FIELDS plus labels and mergeCommit. */
export declare const GH_APP_FIELDS: string
export declare const GH_RUN_FIELDS: string

export declare function pick<T extends Partial<GhPr>>(prs: readonly T[]): T | null
export declare function ciMark(pr: GhPr, gate: number | null): Mark
export declare function isCheckRun(check: unknown): boolean
export declare function headCi(pr: GhPr): Mark
export declare function headMarks(pr: GhPr): HeadMark[]
export declare function verdictComments(pr: GhPr): VerdictComment[]
export declare function verdicts(pr: GhPr): { gate: number | null; rejected: number; narrow: number }
export declare function firstCommit(pr: GhPr): number | null
export declare function labelNames(pr: Partial<GhPr>): string[]
export declare function prFacts(pr: GhPr): PrFacts
