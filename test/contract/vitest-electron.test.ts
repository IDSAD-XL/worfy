// scripts/vitest-electron.mjs (worfy-windows ticket 02) is `pnpm test`: it runs vitest under Electron's
// Node with ELECTRON_RUN_AS_NODE set for the child. Gate and CI read only its exit code, so the code
// of vitest must come through: a red run that exits 0 would turn every check green.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'

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

  it('prints the summary of a real green run and still exits 0', () => {
    const result = run('test/contract/postinstall.test.ts')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(stripVTControlCharacters(result.stdout)).toMatch(/^\s*Test Files\s+\d+ passed/m)
    expect(result.stderr).not.toContain(NO_SUMMARY)
  }, 120_000)
})

// A copy of the wrapper next to a stand-in vitest: a run that exits 0 but never printed vitest's
// summary (a worker that hung and was closed, Electron started as a GUI app) must not read as green.
// The stand-in replaces node_modules/vitest/vitest.mjs and electron resolves to the Node running the
// test, so the wrapper runs unchanged.
const NO_SUMMARY = 'vitest ended without its summary'

const STAND_IN = `
const mode = process.env.STAND_IN_MODE
const out = (text) => process.stdout.write(text)
const summary = (files, tests) =>
  out('\\n \\x1b[2mTest Files\\x1b[22m  ' + files + '\\n      \\x1b[2mTests\\x1b[22m  ' + tests + '\\n   Start at  02:00:00\\n')
out('ARGS ' + JSON.stringify(process.argv.slice(2)) + '\\n RUN  v5.0.3 /stand-in\\n')
if (mode === 'no-summary') process.exit(0)
if (mode === 'no-summary-code-3') process.exit(3)
if (mode === 'summary') { summary('\\x1b[32m1 passed\\x1b[39m (1)', '\\x1b[32m2 passed\\x1b[39m (2)'); process.exit(0) }
if (mode === 'skipped') { summary('1 skipped (1)', '2 skipped (2)'); process.exit(0) }
if (mode === 'failed') { summary('\\x1b[31m1 failed\\x1b[39m (1)', '\\x1b[31m1 failed\\x1b[39m | 1 passed (2)'); process.exit(1) }
if (mode === 'no-files') { out('No test files found, exiting with code 0\\n'); process.exit(0) }
if (mode === 'json') { out('{"numTotalTests":1}\\n'); process.exit(0) }
if (mode === 'split') {
  // The summary arrives in pieces cut inside its lines, and the last line has no line break.
  out('\\n Test Fi')
  setTimeout(() => { out('les  1 passed (1)\\n      Te'); setTimeout(() => { out('sts  1 passed (1)'); process.exit(0) }, 50) }, 50)
}
if (mode === 'summary-then-hang-notice') {
  summary('1 passed (1)', '1 passed (1)')
  process.stderr.write('close timed out after 10000ms\\n')
  out('Tests closed successfully but something prevents 2 Vite servers from exiting\\n')
  process.exit(0)
}
`

let standInRepo = ''
beforeAll(() => {
  standInRepo = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-vitest-electron-')))
  mkdirSync(join(standInRepo, 'scripts'))
  copyFileSync(SCRIPT, join(standInRepo, 'scripts', 'vitest-electron.mjs'))
  mkdirSync(join(standInRepo, 'node_modules', 'vitest'), { recursive: true })
  writeFileSync(join(standInRepo, 'node_modules', 'vitest', 'vitest.mjs'), STAND_IN)
  mkdirSync(join(standInRepo, 'node_modules', 'electron'), { recursive: true })
  writeFileSync(join(standInRepo, 'node_modules', 'electron', 'package.json'), '{"name":"electron","main":"index.js"}')
  writeFileSync(join(standInRepo, 'node_modules', 'electron', 'index.js'), 'module.exports = process.execPath\n')
})

const runStandIn = (mode: string, ...args: string[]) =>
  spawnSync(process.execPath, [join(standInRepo, 'scripts', 'vitest-electron.mjs'), ...args], {
    cwd: standInRepo,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, STAND_IN_MODE: mode },
  })

describe('scripts/vitest-electron.mjs with a stand-in vitest', () => {
  it('a leading -- (pnpm test -- <file>) is dropped, so the file filter reaches vitest run', () => {
    const result = runStandIn('summary', '--', 'test/unit/a.test.ts', '--project', 'node')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('ARGS ["run","test/unit/a.test.ts","--project","node"]')
  })

  it('a -- that is not the first argument is passed on as it is', () => {
    const result = runStandIn('summary', '--project', 'node', '--', 'x')
    expect(result.stdout).toContain('ARGS ["run","--project","node","--","x"]')
  })

  it('a run that exits 0 without the summary exits 1 with one line on stderr', () => {
    const result = runStandIn('no-summary', 'test/unit/a.test.ts')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr.split('\n').filter((line) => line.includes(NO_SUMMARY))).toHaveLength(1)
    // The output of vitest still comes through, with the arguments after `run`.
    expect(result.stdout).toContain('ARGS ["run","test/unit/a.test.ts"]')
    expect(result.stdout).toContain('RUN  v5.0.3')
  })

  it('a run with the summary exits 0 as before, colours and all', () => {
    const result = runStandIn('summary')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('\x1b[32m2 passed\x1b[39m (2)')
    expect(result.stderr).not.toContain(NO_SUMMARY)
  })

  it('a run where every test is skipped has a summary too and exits 0', () => {
    const result = runStandIn('skipped')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  it('a summary cut into pieces across writes, without a final line break, is found', () => {
    const result = runStandIn('split')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('Test Files  1 passed (1)\n      Tests  1 passed (1)')
  })

  it('notices that vitest prints after the summary do not hide it', () => {
    const result = runStandIn('summary-then-hang-notice')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  it('a failed run keeps its exit code and gets no extra line', () => {
    const result = runStandIn('failed')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).not.toContain(NO_SUMMARY)
  })

  it('a non-zero exit without the summary keeps its own code', () => {
    const result = runStandIn('no-summary-code-3')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3)
    expect(result.stderr).not.toContain(NO_SUMMARY)
  })

  it('vitest\'s own "No test files found, exiting with code 0" ends a run without a summary', () => {
    const result = runStandIn('no-files', '--passWithNoTests')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  it.each([['--help'], ['-h'], ['--version'], ['-v'], ['--reporter=json'], ['--reporter', 'json'], ['--reporter=junit', '--outputFile=x.xml']])(
    'invocations that print no summary by design exit 0: %s',
    (...args: string[]) => {
      const result = runStandIn('json', ...args)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    },
  )

  it.each([['--reporter=verbose'], ['--reporter', 'dot'], ['--reporter=default', '--reporter=json']])(
    'a reporter that prints the summary is still checked: %s',
    (...args: string[]) => {
      const result = runStandIn('no-summary', ...args)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stderr).toContain(NO_SUMMARY)
    },
  )
})
