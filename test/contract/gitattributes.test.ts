// .gitattributes (worfy-windows ticket 02): the files whose bytes are a contract — the Harness scripts,
// shell and Node scripts, everything under scripts/ and the brand SVGs whose hashes are in
// build/icons.json — are checked out with LF on every system, also under Git for Windows with
// core.autocrlf=true. CI runs on Linux only, where a broken rule changes nothing; this test reads the
// attributes themselves.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')

/** `git check-attr eol` of each path: path → value (`lf`, `unspecified`, …). */
const eolOf = (paths: string[]): Map<string, string> => {
  const result = spawnSync('git', ['check-attr', 'eol', '--', ...paths], { cwd: REPO, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  const map = new Map<string, string>()
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    const match = /^(.*): eol: (.*)$/.exec(line)
    if (match) map.set(match[1]!, match[2]!)
  }
  return map
}

describe('.gitattributes', () => {
  const LF = [
    'harness/bin/epic-status', // the Harness CLI, no extension
    'harness/bin/profile',
    'harness/hooks/hooks.json',
    'harness/hooks/rules/common.md',
    'harness/hooks/stop.sh', // *.sh
    'harness/bin/tests/profile.test.sh',
    'harness/hooks/guard.mjs', // *.mjs
    'scripts/check-handoff.mjs',
    'scripts/install-stable.mjs',
    'scripts/build-version.ts', // scripts/**
    'scripts/spikes/path-probe/main.ts',
    'build/brand/icon.svg', // hashes in build/icons.json
    'build/brand/mark.svg',
  ]

  it.each(LF)('%s is checked out with LF', (path) => {
    expect(eolOf([path]).get(path)).toBe('lf')
  })

  it('leaves other text files to the checkout settings of the machine', () => {
    const eol = eolOf(['README.md', 'src/main/index.ts', 'package.json'])
    expect([...eol.values()]).toEqual(['unspecified', 'unspecified', 'unspecified'])
  })
})
