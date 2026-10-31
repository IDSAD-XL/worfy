// worfy-update ticket 05 (spec R5, R8; ADR-0089 point 5): the Harness of the new copy is installed
// at the first start after an Update or a roll back, without a second dialog, because the press of
// "Restart now" or "Roll back" was the consent. `update/restart.json` (ticket 04) says the restart
// happened and to which copy.
//
// Every case runs in a sandbox, as test/contract/harness-install.test.ts does: HOME, CLAUDE_CONFIG_DIR
// and the Claude home worfy reads (WORFY_CLAUDE_HOME) all point into a temporary folder, never at
// the real ~/.claude, and `claude` is a stub that logs its arguments and keeps its own state; it never
// reaches the network.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HARNESS_PLUGIN_ID, HarnessInstaller, type InstallerOptions } from '../../src/main/harness/install'
import { harnessHome } from '../../src/main/storage/paths'
import { readJsonFile, writeJsonFile } from '../../src/main/storage/json-file'
import { installHarnessAfterUpdate, isRestartCopy } from '../../src/main/update/harness-after-update'
import { previousCopy, previousPaths, restartFile, restartRecordSchema, settleLastRestart, type RestartRecord } from '../../src/main/update/restart'
import { changeUpdateState, readUpdateState, updateStateFile } from '../../src/main/update/state'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { shellStub } from '../shell-stub'
import { ms } from '../time-scale'

const REPO = join(__dirname, '..', '..')
const SHA_A = 'aaaaaaa' + '1'.repeat(33)
const SHA_B = 'bbbbbbb' + '2'.repeat(33)
/** The copy rolled back to and the copy updated to: one semver, two commits, so worfy cannot order them. */
const VA = '0.3.0+aaaaaaa'
const VB = '0.3.0+bbbbbbb'
const LIST = 'plugin list --json'
/** How long a test waits for `claude` of the stub to answer: on a loaded machine longer than vi.waitFor's 1 s. */
const CLAUDE_WAIT = { timeout: ms(10_000) }
const UPDATE_WORFY = `plugin update ${HARNESS_PLUGIN_ID} --scope user`

// The Claude Code side, kept in STUB_CLAUDE_STATE outside the sandbox: the marketplaces it knows and
// the plugins it installed. STUB_CLAUDE_FAIL: commands starting so exit 3 before anything is recorded.
const STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
const line = args.join(' ')
appendFileSync(process.env.STUB_CLAUDE_LOG, JSON.stringify({ args }) + '\\n')
if ((process.env.STUB_CLAUDE_FAIL ?? '') !== '' && line.startsWith(process.env.STUB_CLAUDE_FAIL)) {
  process.stderr.write(line + ' failed: stub error\\n')
  process.exit(3)
}
const statePath = process.env.STUB_CLAUDE_STATE
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') {
  process.stdout.write(JSON.stringify(Object.entries(state.marketplaces).map(([name, source]) => ({ name, source }))) + '\\n')
} else if (command === 'plugin marketplace add') {
  state.marketplaces[manifest(args[3], 'marketplace.json').name] = args[3]
} else if (command === 'plugin install' || command === 'plugin update') {
  const source = state.marketplaces[args[2].split('@')[1]]
  if (source === undefined || !isAbsolute(source)) {
    process.stderr.write('marketplace of ' + args[2] + ' not found\\n')
    process.exit(1)
  }
  state.plugins[args[2]] = manifest(source, 'plugin.json').version
} else if (command === 'plugin list') {
  process.stdout.write(JSON.stringify(Object.entries(state.plugins).map(([id, version]) => ({ id, version, scope: 'user', enabled: true, errors: [] }))) + '\\n')
}
writeFileSync(statePath, JSON.stringify(state))
`

interface Sandbox {
  root: string
  claudeHome: string
  harnessHome: string
  stub: string
  log: string
  /** worfy's data folder: update/ with restart.json and state.json. */
  data: string
  env: Record<string, string | undefined>
}

let sb: Sandbox

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-update-harness-')))
  const home = join(root, 'home')
  const claudeHome = join(home, '.claude')
  mkdirSync(claudeHome, { recursive: true })
  const stubDir = join(root, 'stub')
  mkdirSync(stubDir)
  writeFileSync(join(stubDir, 'claude-stub.mjs'), STUB)
  // Windows cannot start a `#!/bin/sh` script: there the stand-in is the Node script itself (src/main/program.ts).
  const stub = process.platform === 'win32' ? join(stubDir, 'claude-stub.mjs') : join(stubDir, 'claude')
  if (process.platform !== 'win32') shellStub(stub, [`exec "${scriptNode()}" "${join(stubDir, 'claude-stub.mjs')}" "$@"`])
  const data = join(root, 'data')
  mkdirSync(join(data, 'update'), { recursive: true })
  sb = {
    root,
    claudeHome,
    harnessHome: harnessHome({ WORFY_CLAUDE_HOME: claudeHome }),
    stub,
    log: join(stubDir, 'calls.jsonl'),
    data,
    env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: claudeHome, STUB_CLAUDE_LOG: join(stubDir, 'calls.jsonl'), STUB_CLAUDE_STATE: join(stubDir, 'state.json') },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(sb.root)
})

const updateDir = (): string => join(sb.data, 'update')
const stateFile = (): string => updateStateFile(sb.data)
const commands = (): string[] =>
  existsSync(sb.log)
    ? readFileSync(sb.log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => (JSON.parse(line) as { args: string[] }).args.join(' '))
    : []

/** The Harness copy a build makes (electron.vite.config.ts), with `version` and no dependency. */
function makeBundle(version: string): string {
  const source = join(REPO, 'harness')
  const target = join(sb.root, `bundle-${version.replace(/[^0-9a-z]/gu, '-')}`)
  const tests = [join('bin', 'tests'), join('hooks', 'tests')]
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(source, path)
      return !tests.some((dir) => inside === dir || inside.startsWith(`${dir}${sep}`))
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const { name, ...rest } = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  writeFileSync(manifestPath, `${JSON.stringify({ name, version, ...rest, dependencies: [] }, null, 2)}\n`)
  return target
}

function installer(bundle: string, options: Partial<InstallerOptions> = {}): HarnessInstaller {
  return new HarnessInstaller({ bundledDir: bundle, harnessHome: sb.harnessHome, claude: sb.stub, env: sb.env, canInstall: true, claudeHome: sb.claudeHome, ...options })
}

/** The Harness of `version` installed, as the copy before the restart left it; the log of `claude` then starts empty. */
async function installedBefore(version: string): Promise<void> {
  const result = await installer(makeBundle(version)).install(() => Promise.resolve(true))
  expect(result.status.state).toEqual({ kind: 'installed', version, enabled: true })
  writeFileSync(sb.log, '')
}

/** restart.json as ticket 04 writes it before the helper swaps the copy. */
function restartRecord(record: Partial<RestartRecord> = {}): RestartRecord {
  const full: RestartRecord = { action: 'install', version: VB, sha: SHA_B, from: { sha: SHA_A, version: VA }, harness: true, at: '2026-10-31T10:00:00.000Z', ...record }
  writeJsonFile(restartFile(updateDir()), restartRecordSchema, full)
  return full
}

/** restart.json is still there, as it was written, and marked as taken by the start: no second install, and its names stay. */
function expectTaken(record: RestartRecord): void {
  expect(JSON.parse(readFileSync(restartFile(updateDir()), 'utf8'))).toEqual({ ...record, harnessTaken: true })
}

/** The start after the restart: the copy whose Harness is `bundle`, its installer with a dialog that must not open. */
async function startWith(bundle: string, version: string, options: Partial<InstallerOptions> = {}) {
  const harness = installer(bundle, options)
  const install = vi.spyOn(harness, 'install')
  const onChange = vi.fn()
  const outcome = await installHarnessAfterUpdate({ dir: updateDir(), stateFile: stateFile(), bundled: version, installer: harness, onChange })
  return { harness, install, onChange, outcome }
}

describe('the Harness after an Update', () => {
  it('installs the Harness of the new copy without a dialog when restart.json names this copy and the installed one is outdated, then marks restart.json taken and keeps it', async () => {
    await installedBefore(VA)
    const record = restartRecord()
    const bundle = makeBundle(VB)
    expect((await installer(bundle).status()).state).toEqual({ kind: 'outdated', from: VA, to: VB, sameVersion: true })

    const { install, outcome, onChange } = await startWith(bundle, VB)

    expect(outcome).toBe('installed')
    expect(install).toHaveBeenCalledTimes(1)
    // The consent is the press of "Restart now": the plan is accepted as it is, no dialog is asked.
    const [confirm] = install.mock.calls[0] ?? []
    await expect(confirm?.({} as never)).resolves.toBe(true)
    expect(commands()).toContain(UPDATE_WORFY)
    expect((await installer(bundle).status()).state).toEqual({ kind: 'installed', version: VB, enabled: true })
    expectTaken(record)
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBeNull()
    expect(onChange).toHaveBeenCalled()
  })

  it('installs into an empty Claude home too (not installed)', async () => {
    restartRecord()
    const bundle = makeBundle(VB)
    const { install, outcome } = await startWith(bundle, VB)
    expect(outcome).toBe('installed')
    expect(install).toHaveBeenCalledTimes(1)
    expect((await installer(bundle).status()).state).toEqual({ kind: 'installed', version: VB, enabled: true })
  })

  it('a later success clears the failure an earlier restart left for the toast', async () => {
    await installedBefore(VA)
    changeUpdateState((state) => ({ ...state, harnessAfterUpdate: 'failed' }), stateFile())
    restartRecord()
    expect((await startWith(makeBundle(VB), VB)).outcome).toBe('installed')
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBeNull()
  })

  it('does not install when restart.json names another copy (the swap did not happen), and marks restart.json taken', async () => {
    await installedBefore(VA)
    const record = restartRecord({ version: '0.3.0+ccccccc', sha: 'c'.repeat(40) })
    const { install, outcome } = await startWith(makeBundle(VB), VB)
    expect(outcome).toBe('other-copy')
    expect(install).not.toHaveBeenCalled()
    expect(commands().filter((command) => command !== LIST)).toEqual([])
    expectTaken(record)
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBeNull()
  })

  it('does nothing without restart.json: no status read, no install, no change of the state', async () => {
    await installedBefore(VA)
    const { install, outcome, onChange } = await startWith(makeBundle(VB), VB)
    expect(outcome).toBe('none')
    expect(install).not.toHaveBeenCalled()
    expect(commands()).toEqual([])
    expect(existsSync(stateFile())).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not install when the Harness of this copy is installed already, and marks restart.json taken', async () => {
    await installedBefore(VB)
    const record = restartRecord()
    const { install, outcome } = await startWith(makeBundle(VB), VB)
    expect(outcome).toBe('current')
    expect(install).not.toHaveBeenCalled()
    expectTaken(record)
  })

  it('a failed install marks harnessAfterUpdate failed, marks restart.json taken, and the next start does not try again', async () => {
    await installedBefore(VA)
    const record = restartRecord()
    sb.env.STUB_CLAUDE_FAIL = UPDATE_WORFY
    const bundle = makeBundle(VB)
    const first = await startWith(bundle, VB)
    expect(first.outcome).toBe('failed')
    expect(first.install).toHaveBeenCalledTimes(1)
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBe('failed')
    expectTaken(record)
    expect(first.onChange).toHaveBeenCalled()

    // The next start of worfy: no second try without a press.
    writeFileSync(sb.log, '')
    const second = await startWith(bundle, VB)
    expect(second.outcome).toBe('none')
    expect(second.install).not.toHaveBeenCalled()
    expect(commands()).toEqual([])
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBe('failed')
  })

  it('an install that refuses to run (a dev run without a sandbox) counts as failed', async () => {
    await installedBefore(VA)
    const record = restartRecord()
    const { outcome } = await startWith(makeBundle(VB), VB, { canInstall: false })
    expect(outcome).toBe('failed')
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBe('failed')
    expectTaken(record)
  })

  it('a restart.json that does not read installs nothing', async () => {
    await installedBefore(VA)
    writeFileSync(restartFile(updateDir()), '{ not json')
    const { install, outcome } = await startWith(makeBundle(VB), VB)
    expect(outcome).toBe('none')
    expect(install).not.toHaveBeenCalled()
    expect(existsSync(restartFile(updateDir()))).toBe(false)
  })

  it('two calls at one start install once: restart.json is taken by the first', async () => {
    await installedBefore(VA)
    restartRecord()
    const bundle = makeBundle(VB)
    const harness = installer(bundle)
    const install = vi.spyOn(harness, 'install')
    const options = { dir: updateDir(), stateFile: stateFile(), bundled: VB, installer: harness }
    const outcomes = await Promise.all([installHarnessAfterUpdate(options), installHarnessAfterUpdate(options)])
    expect(outcomes.sort()).toEqual(['installed', 'none'])
    expect(install).toHaveBeenCalledTimes(1)
  })
})

describe('the Harness after a roll back', () => {
  it('installs the Harness of the copy rolled back to, named by its short SHA as a roll back without a record names it', async () => {
    await installedBefore(VB)
    // The previous copy named only by its commit (restart.ts, previousCopy): its version is the short SHA.
    const record = restartRecord({ action: 'rollback', version: 'aaaaaaa', sha: SHA_A, from: { sha: SHA_B, version: VB } })
    const bundle = makeBundle(VA)
    const { install, outcome } = await startWith(bundle, VA)
    expect(outcome).toBe('installed')
    expect(install).toHaveBeenCalledTimes(1)
    expect((await installer(bundle).status()).state).toEqual({ kind: 'installed', version: VA, enabled: true })
    expectTaken(record)
  })

  it('installs nothing when the roll back did not happen: the copy that runs is still the one rolled back from', async () => {
    await installedBefore(VA)
    restartRecord({ action: 'rollback', version: VA, sha: SHA_A, from: { sha: SHA_B, version: VB } })
    const { install, outcome } = await startWith(makeBundle(VB), VB)
    expect(outcome).toBe('other-copy')
    expect(install).not.toHaveBeenCalled()
  })
})

describe('restart.json after the start (ticket 04 still reads it)', () => {
  /** The Stable copy of the test and the copy kept as previous, the one of SHA_A. */
  function previousKept(): string {
    const target = join(sb.root, 'apps', process.platform === 'darwin' ? 'worfy-stable.app' : 'worfy-stable')
    const paths = previousPaths(process.platform, target)
    mkdirSync(paths.copy, { recursive: true })
    writeFileSync(paths.metadata, JSON.stringify({ commit: SHA_A }))
    return target
  }

  it('keeps the name of the previous copy: settle, install, settle again still says <semver>+<short SHA>', async () => {
    await installedBefore(VA)
    const target = previousKept()
    restartRecord()
    const settle = (): void => settleLastRestart({ dir: updateDir(), stateFile: stateFile(), target })
    settle()
    expect(readUpdateState(stateFile()).previous).toEqual({ version: VA })

    expect((await startWith(makeBundle(VB), VB)).outcome).toBe('installed')

    // The next start of worfy, and the roll back's dialog, which names the copy as previousCopy does.
    settle()
    expect(readUpdateState(stateFile()).previous).toEqual({ version: VA })
    expect(previousCopy(process.platform, target, readJsonFile(restartFile(updateDir()), restartRecordSchema))).toEqual({ version: VA, commit: SHA_A })
  })

  it('a new restart replaces the taken record, and the start after it installs again', async () => {
    await installedBefore(VA)
    restartRecord()
    const bundle = makeBundle(VB)
    expect((await startWith(bundle, VB)).outcome).toBe('installed')
    // A roll back and then an Update to VB again: each restart writes its own record, without the mark.
    restartRecord({ action: 'rollback', version: VA, sha: SHA_A, from: { sha: SHA_B, version: VB } })
    expect((await startWith(makeBundle(VA), VA)).outcome).toBe('installed')
    restartRecord()
    const again = await startWith(bundle, VB)
    expect(again.outcome).toBe('installed')
    expect(again.install).toHaveBeenCalledTimes(1)
  })
})

describe('an install of the toolbar during the start', () => {
  it('joined, and cancelled in its dialog: not installed, no failure to tell, and no install over the answer', async () => {
    await installedBefore(VA)
    const record = restartRecord()
    const bundle = makeBundle(VB)
    const harness = installer(bundle)
    // The toolbar's "Update Harness" pressed during the start: its dialog is up.
    let answer: (yes: boolean) => void = () => undefined
    const dialog = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const toolbar = harness.install(dialog)
    await vi.waitFor(() => expect(dialog).toHaveBeenCalled(), CLAUDE_WAIT)
    const install = vi.spyOn(harness, 'install')
    const start = installHarnessAfterUpdate({ dir: updateDir(), stateFile: stateFile(), bundled: VB, installer: harness })
    await vi.waitFor(() => expect(install).toHaveBeenCalled(), CLAUDE_WAIT)
    answer(false)

    expect(await start).toBe('declined')
    expect((await toolbar).outcome).toBe('declined')
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
    expect((await installer(bundle).status()).state).toEqual({ kind: 'outdated', from: VA, to: VB, sameVersion: true })
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBeNull()
    expectTaken(record)
  })

  it('joined, and accepted in its dialog: installed', async () => {
    await installedBefore(VA)
    restartRecord()
    const bundle = makeBundle(VB)
    const harness = installer(bundle)
    let answer: (yes: boolean) => void = () => undefined
    const dialog = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const toolbar = harness.install(dialog)
    await vi.waitFor(() => expect(dialog).toHaveBeenCalled(), CLAUDE_WAIT)
    const start = installHarnessAfterUpdate({ dir: updateDir(), stateFile: stateFile(), bundled: VB, installer: harness })
    answer(true)
    expect(await start).toBe('installed')
    expect((await toolbar).outcome).toBe('done')
    expect((await installer(bundle).status()).state).toEqual({ kind: 'installed', version: VB, enabled: true })
  })

  it('an install that found nothing to do (another one brought the Harness up meanwhile) is the Harness of this copy, not a new install', async () => {
    const record = restartRecord()
    const status = { state: { kind: 'installed' as const, version: VB, enabled: true }, bundledVersion: VB, canInstall: true, pluginDir: join(sb.root, 'plugin'), dependencies: [] }
    const fake = {
      status: () => Promise.resolve({ ...status, state: { kind: 'outdated' as const, from: VA, to: VB, sameVersion: true } }),
      install: vi.fn(() => Promise.resolve({ outcome: 'nothing-to-do' as const, status })),
    }
    expect(await installHarnessAfterUpdate({ dir: updateDir(), stateFile: stateFile(), bundled: VB, installer: fake })).toBe('current')
    expect(fake.install).toHaveBeenCalledTimes(1)
    expect(readUpdateState(stateFile()).harnessAfterUpdate).toBeNull()
    expectTaken(record)
  })
})

describe('which copy restart.json names', () => {
  const record = (version: string, sha: string): RestartRecord => ({ action: 'install', version, sha, from: { sha: SHA_A, version: VA }, harness: true, at: '2026-10-31T10:00:00.000Z' })

  it('is this copy by its version, or by the commit of its build version', () => {
    expect(isRestartCopy(record(VB, 'c'.repeat(40)), VB)).toBe(true)
    expect(isRestartCopy(record('bbbbbbb', SHA_B), VB)).toBe(true)
    expect(isRestartCopy(record('bbbbbbb', SHA_B), '0.3.0+bbbbbbb.dirty')).toBe(true)
    expect(isRestartCopy(record(VA, SHA_A), VB)).toBe(false)
    expect(isRestartCopy(record(VB, SHA_B), undefined)).toBe(false)
    expect(isRestartCopy(record('', ''), '0.3.0')).toBe(false)
  })
})
