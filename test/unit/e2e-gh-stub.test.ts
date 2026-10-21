// No e2e start of the app can reach the machine's own gh (worfy-windows ticket 80). On 2026-10-21
// a gh.exe watcher on Windows saw `gh --version` and `gh auth status` from the app under test: the
// window.spec.ts starts that run Electron themselves left out WORFY_FIRST_RUN_AUTO=0, so the
// first-run screen opened and checked, and the first-run checks ran gh from the Path, not WORFY_GH.
//
// What keeps gh to the stand-in, and what this file checks:
// - every start of the app gets the isolation variables of test/e2e/launch-env.ts — launchEnv when
//   Playwright starts it, directStartEnv when a spec does — with WORFY_GH on the gh stub and the
//   first-run screen off;
// - a spec starts the app only through those: Playwright's `_electron.launch` only in helpers.ts,
//   and each `spawn` of the app (the one with NO_WINDOW_RESTORE) next to a directStartEnv call, and no
//   spec copies the variables by hand;
// - the first-run checks get WORFY_GH (src/main/ipc/first-run.ts) and run it for both gh rows
//   (test/unit/first-run-windows.test.ts, "the gh rows and WORFY_GH").
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { directStartEnv, GH_STUB, launchEnv } from '../e2e/launch-env'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')
const E2E = join(REPO, 'test', 'e2e')
const files = readdirSync(E2E)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(E2E, name), 'utf8') }))
const count = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length

const scratch = mkdtempSync(join(tmpdir(), 'worfy-e2e-gh-stub-'))
afterAll(() => removeTestTree(scratch))

describe('every e2e start of the app gets the gh stub', () => {
  it('launchEnv: WORFY_GH is the stub and the first-run screen is off, whatever the test process has', async () => {
    const env = await launchEnv({ dataDir: 'd', claudeHome: 'c', shellDir: mkdtempSync(join(scratch, 'shell-')), source: { WORFY_GH: 'gh', WORFY_FIRST_RUN_AUTO: '1', PATH: '/usr/bin' } })
    expect(env).toMatchObject({ WORFY_GH: GH_STUB, WORFY_FIRST_RUN_AUTO: '0' })
  })

  it('directStartEnv: the same, with the spec\'s own variables on top', () => {
    const env = directStartEnv({ dataDir: 'd', claudeHome: 'c', source: { WORFY_GH: 'gh', WORFY_FIRST_RUN_AUTO: '1', ELECTRON_RUN_AS_NODE: '1' }, env: { WORFY_STARTUP_DIALOG: 'off' } })
    expect(env).toMatchObject({ WORFY_GH: GH_STUB, WORFY_FIRST_RUN_AUTO: '0', WORFY_DATA_DIR: 'd', WORFY_CLAUDE_HOME: 'c', WORFY_STARTUP_DIALOG: 'off' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('Playwright starts the app only in helpers.ts, with launchEnv', () => {
    const launching = files.filter((file) => /_electron\.launch\(/.test(file.text)).map((file) => file.name)
    expect(launching).toEqual(['helpers.ts'])
    expect(files.find((file) => file.name === 'helpers.ts')?.text).toMatch(/await launchEnv\(/)
  })

  it('each spawn of the app in a spec comes with a directStartEnv call', () => {
    for (const file of files) {
      const starts = count(file.text, /spawn\([^)]*NO_WINDOW_RESTORE/g)
      if (starts === 0) continue
      expect(count(file.text, /directStartEnv\(/g), `${file.name}: ${starts} start(s) of the app`).toBeGreaterThanOrEqual(starts)
    }
  })

  it('no spec sets WORFY_GH to the stub by hand: the variables live in launch-env.ts alone', () => {
    const copies = files.filter((file) => file.name !== 'launch-env.ts' && /WORFY_GH:\s*GH_STUB/.test(file.text)).map((file) => file.name)
    expect(copies).toEqual([])
  })

  it('the first-run checks get WORFY_GH', () => {
    expect(readFileSync(join(REPO, 'src', 'main', 'ipc', 'first-run.ts'), 'utf8')).toMatch(/runChecks\(\{[^}]*\bgh: process\.env\.WORFY_GH\b/)
  })
})
