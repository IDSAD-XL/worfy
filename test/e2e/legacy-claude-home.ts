// The ~/.claude of the old Harness for the e2e specs of its move (harness-migrate.spec.ts, select.spec.ts): the
// fixture test/fixtures/claude-home-legacy in a scratch folder, as test/contract/harness-migrate-harness.ts builds it
// for the contract tests.
import { spawnSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { copyLegacyFixture, SANDBOX_GIT_IDENTITY } from '../claude-home-legacy'
import { repoRoot } from './helpers'

const GIT_ENV = { ...process.env, ...SANDBOX_GIT_IDENTITY }

function gitCommitAll(dir: string): void {
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
    const result = spawnSync('git', ['-C', dir, ...args], { env: GIT_ENV, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  }
}

/**
 * Writes the fixture into `scratch` and returns its ~/.claude: a git repository, as is the fixture's repos/worfy,
 * with the Harness plugin of this build in worfy-harness/plugin.
 */
export function legacyClaudeHome(scratch: string): string {
  const claudeHome = copyLegacyFixture(repoRoot, scratch)
  gitCommitAll(claudeHome)
  gitCommitAll(join(scratch, 'repos', 'worfy'))
  cpSync(join(repoRoot, 'out', 'harness'), join(claudeHome, 'worfy-harness', 'plugin'), { recursive: true })
  return claudeHome
}
