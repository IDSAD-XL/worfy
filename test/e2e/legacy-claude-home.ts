// The ~/.claude of the old Harness for the e2e specs of its move (harness-migrate.spec.ts, select.spec.ts): the
// fixture test/fixtures/claude-home-legacy in a scratch folder, as test/contract/harness-migrate-harness.ts builds it
// for the contract tests.
import { spawnSync } from 'node:child_process'
import { cpSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { substituteSandbox } from '../claude-home-legacy'
import { repoRoot } from './helpers'

const FIXTURE = join(repoRoot, 'test', 'fixtures', 'claude-home-legacy')
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sandbox', GIT_AUTHOR_EMAIL: 'sandbox@example.com', GIT_COMMITTER_NAME: 'Sandbox', GIT_COMMITTER_EMAIL: 'sandbox@example.com' }

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
  cpSync(FIXTURE, scratch, { recursive: true })
  substituteSandbox(scratch, scratch)
  const claudeHome = join(scratch, 'home', '.claude')
  renameSync(join(claudeHome, 'gitignore'), join(claudeHome, '.gitignore'))
  gitCommitAll(claudeHome)
  gitCommitAll(join(scratch, 'repos', 'worfy'))
  cpSync(join(repoRoot, 'out', 'harness'), join(claudeHome, 'worfy-harness', 'plugin'), { recursive: true })
  return claudeHome
}
