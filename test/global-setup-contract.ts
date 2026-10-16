// The globalSetup of the `contract` project (vitest.config.ts): one temporary folder per run, under
// which test/setup-contract.ts makes the Claude home of each test file. vitest runs no afterAll in a
// file whose tests are all skipped (the Windows-only and macOS-only files), so a home made there
// would stay behind; the teardown here removes the whole folder at the end of the run whatever ran.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { removeTestTree } from './remove'

declare module 'vitest' {
  export interface ProvidedContext {
    /** The folder of this run's Claude homes of the contract tests. */
    contractClaudeHomes: string
  }
}

/** Prefix of the folder of a run, under the system temp directory; vitest.config.ts removes stale ones. */
export const CONTRACT_HOMES_PREFIX = 'worfy-contract-claude-homes-'

export default function setup(project: TestProject): () => void {
  const root = mkdtempSync(join(realpathSync(tmpdir()), CONTRACT_HOMES_PREFIX))
  project.provide('contractClaudeHomes', root)
  return () => removeTestTree(root)
}
