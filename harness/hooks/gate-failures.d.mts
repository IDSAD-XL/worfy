// Types of harness/hooks/gate-failures.mjs for the tests that import it.

export declare const FORMAT_VERSION: 1
export declare const FAILURES_DAYS: number
export declare const ERROR_CHARS: number

/** The computer a gate ran on: machine.json and the platform. Never a host name. */
export interface Computer {
  id: string
  name: string
  platform: string
}

/** One failed test, or one failed script without test records (runner, file, name and test null). */
export interface FailureRecord {
  step: string
  runner: string | null
  file: string | null
  line: number | null
  name: string | null
  test: string | null
  ms: number | null
  error: string
  attempt: number
  rerun: string[] | null
}

/** A run file of version 1. */
export interface RunRecord {
  version: 1
  kind: 'run'
  run: string
  at: string
  key: string | null
  profile: string
  head: string | null
  outcome: 'green' | 'red' | 'unverified' | 'none'
  computer: Computer
  dirty: boolean
  failures: FailureRecord[]
}

/** A rerun file of version 1: the failed tests of the run `of`, each run alone. */
export interface RerunRecord {
  version: 1
  kind: 'rerun'
  of: string
  at: string
  head: string | null
  computer: Computer
  results: { test: string; exit: number | null; ms: number | null; error: string | null }[]
}

export type Parsed<T> = { ok: true; record: T } | { ok: false; reason: string }

/** What scrub replaces; each may be missing. deny: the words of the personal list of privacy.cjs. */
export interface ScrubContext {
  repo?: string
  home?: string
  user?: string
  host?: string
  deny?: string[]
}

/** A finding of harness/lib/privacy.cjs: where in the text, not the value. */
export interface Leak {
  rule: string
  index: number
  length: number
}

export interface Listed<T> {
  file: string
  imported: boolean
  record: T
}

export declare function checkRunRecord(record: unknown): string | null
export declare function checkRerunRecord(record: unknown): string | null
export declare function parseRunFile(text: string): Parsed<RunRecord>
export declare function parseRerunFile(text: string): Parsed<RerunRecord>
export declare function parseRecordFile(text: string): Parsed<RunRecord | RerunRecord>

export declare function testId(runner: string, file: string, name: string): string
export declare function firstLine(text: string, max?: number): string
export declare function scrub(text: string, ctx?: ScrubContext): string
export declare function scrubRecord<T extends Partial<FailureRecord>>(record: T, ctx?: ScrubContext): T
export declare function findLeaks(text: string, options?: { hostname?: string; deny?: string[] }): Leak[]
export declare function byTest(runs: readonly RunRecord[]): Map<string, { run: RunRecord; failure: FailureRecord }[]>

export declare function defaultComputerName(platform?: string): string
export declare function machineFile(harnessHome: string): string
export declare function readComputer(harnessHome: string): { id: string; name: string } | null
export declare function ensureComputer(harnessHome: string, platform?: string): Computer
export declare function checkComputerName(name: string, mine?: { host?: string; user?: string }): string | null
export declare function setComputerName(harnessHome: string, name: string, platform?: string): Computer

export declare function failuresDir(state: string): string
export declare function importedDir(state: string, computerId: string): string
export declare function recordFileName(record: RunRecord | RerunRecord): string
export declare function writeRunFile(state: string, record: RunRecord): string
export declare function writeImported(state: string, record: RunRecord | RerunRecord): string
export declare function listRuns(
  state: string,
  options?: { days?: number; now?: number },
): { runs: Listed<RunRecord>[]; reruns: Listed<RerunRecord>[]; skipped: { file: string; reason: string }[] }
export declare function pruneFailures(state: string, now?: number, days?: number): string[]
