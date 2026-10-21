// The fixture test/fixtures/claude-home-legacy made concrete for one sandbox, the one rule of its contract tests
// (test/contract/harness-migrate-harness.ts) and its e2e specs (test/e2e/legacy-claude-home.ts).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
