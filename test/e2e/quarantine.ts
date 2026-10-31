// The quarantine of flaky e2e tests: `quarantined('<id>')(name, body)` in place of Playwright's
// `test(name, body)`; in a loop, `quarantined('<id>', { when: <the round the entry names> })`. The
// rules, the entries (test/quarantine/<id>.json, with "runner": "playwright"; a quarantine entry or a
// Windows exception) and the modes of WORFY_QUARANTINE are those of test/quarantine.ts
// (quarantinedDeclaration); this file only hands it Playwright's `test`, `test.skip` and
// `test.only`, and gives back one of them for the spec to call.
//
// test/quarantine.ts imports vitest's `it`; loading vitest in a Playwright process is harmless while
// nothing calls it, and nothing here does.
import {
  test,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
} from '@playwright/test'
import { quarantinedDeclaration, type E2eDeclarations, type E2eQuarantineOptions } from '../quarantine'

type Declare = (
  title: string,
  body: (args: PlaywrightTestArgs & PlaywrightTestOptions & PlaywrightWorkerArgs & PlaywrightWorkerOptions, testInfo: TestInfo) => Promise<unknown> | unknown,
) => void

const DECLARATIONS: E2eDeclarations<Declare> = { test, skip: test.skip, only: test.only }

/**
 * Playwright loads every spec file in the runner process, to list the tests, and again in each
 * worker that runs one of its tests: the line about a skipped test is written in the runner only,
 * once a run (once a shard, under --shard). A worker has TEST_WORKER_INDEX set.
 */
const log = (line: string): void => {
  if (process.env.TEST_WORKER_INDEX === undefined) process.stderr.write(`${line}\n`)
}

export function quarantined(id: string, options: E2eQuarantineOptions = {}): Declare {
  return quarantinedDeclaration(id, DECLARATIONS, { log, ...options })
}
