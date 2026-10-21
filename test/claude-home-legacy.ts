// The fixture test/fixtures/claude-home-legacy made concrete for one sandbox, the one rule of its contract tests
// (test/contract/harness-migrate-harness.ts) and its e2e specs (test/e2e/legacy-claude-home.ts).
import { cpSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The git author and committer of the sandbox's repositories. */
export const SANDBOX_GIT_IDENTITY = { GIT_AUTHOR_NAME: 'Sandbox', GIT_AUTHOR_EMAIL: 'sandbox@example.com', GIT_COMMITTER_NAME: 'Sandbox', GIT_COMMITTER_EMAIL: 'sandbox@example.com' }

/**
 * Copies the fixture of the repository at `repo` into `target`, made concrete for it, and returns the sandbox's
 * ~/.claude. The fixture keeps that folder's .gitignore as `gitignore`, so it does not apply to this repository.
 */
export function copyLegacyFixture(repo: string, target: string): string {
  cpSync(join(repo, 'test', 'fixtures', 'claude-home-legacy'), target, { recursive: true })
  substituteSandbox(target, target)
  const claudeHome = join(target, 'home', '.claude')
  renameSync(join(claudeHome, 'gitignore'), join(claudeHome, '.gitignore'))
  return claudeHome
}

/**
 * The fixture's files under `dir` with `__SANDBOX__` replaced by `root` — JSON-escaped in a .json file: a Windows
 * path has backslashes, which a JSON string spells `\\`, and settings.json with a bare one does not parse. Line ends
 * go back to the LF the fixture is committed with (every file of it is text): Git for Windows with core.autocrlf
 * checks it out with CRLF, and the cases compare bytes and lines.
 */
export function substituteSandbox(dir: string, root: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) substituteSandbox(path, root)
    else {
      const text = readFileSync(path, 'utf8')
      const value = entry.name.endsWith('.json') ? JSON.stringify(root).slice(1, -1) : root
      const fixed = text.replaceAll('\r\n', '\n').replaceAll('__SANDBOX__', value)
      if (fixed !== text) writeFileSync(path, fixed)
    }
  }
}
