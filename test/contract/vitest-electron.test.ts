// scripts/vitest-electron.mjs (worfy-windows ticket 02) is `pnpm test`: it runs vitest under Electron's
// Node with ELECTRON_RUN_AS_NODE set for the child. Gate and CI read only its exit code, so the code
// of vitest must come through: a red run that exits 0 would turn every check green.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'vitest-electron.mjs')

const run = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120_000 })

describe('scripts/vitest-electron.mjs', () => {
  it('passes the exit code of vitest on: a filter that matches no test file exits 1', () => {
    const result = run('test/contract/no-such-file-zz-vitest-electron.test.ts')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
  }, 120_000)

  it('passes the exit code of vitest on: a green file exits 0', () => {
    const result = run('test/contract/postinstall.test.ts')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  }, 120_000)

  it('is the test script of package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.test).toBe('node scripts/vitest-electron.mjs')
  })
})
