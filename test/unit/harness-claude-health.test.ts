import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseOutcome, ContractCase, ContractSetOptions } from '../../src/main/harness/contract/runner'
import { CONTRACT_CASES } from '../../src/main/harness/contract/cases'
import {
  CLAUDE_CODE_CHANGELOG_URL,
  contractSetRun,
  fakeSetRun,
  HarnessClaudeCheck,
  terminalClaude,
  type ClaudeCopy,
  type ClaudeFound,
  type HarnessClaudeDeps,
  type SetRun,
} from '../../src/main/first-run/harness-claude'
import { removeTestTree } from '../remove'

// worfy-harness-guarantees ticket 09: the Health rows "Harness on Claude Code" — the contract set of ticket 08 on
// worfy's copy of Claude Code and on the terminal's, once per pair of a Claude Code version and a Harness version,
// the answer kept in worfy's data folder, "Run again" running it anew. The set itself is a stub here: no process.

const passedAll = (): CaseOutcome[] => CONTRACT_CASES.map(({ id, title }) => ({ id, title, status: 'passed' }))
const withOutcome = (id: string, outcome: Pick<CaseOutcome, 'status'> & { reason?: string }): CaseOutcome[] =>
  passedAll().map((each) => (each.id === id ? ({ ...each, ...outcome } as CaseOutcome) : each))

let data: string
let cacheFile: string
let versions: Record<ClaudeCopy, ClaudeFound>
let harnessVersion: string | undefined
let answer: (copy: ClaudeCopy) => SetRun
let runSet: ReturnType<typeof vi.fn<HarnessClaudeDeps['runSet']>>

const found = (version: string, binary = `/opt/claude-${version}`): ClaudeFound => ({ kind: 'found', binary, version })

function check(extra: Partial<HarnessClaudeDeps> = {}): HarnessClaudeCheck {
  return new HarnessClaudeCheck({
    cacheFile,
    harness: () => ({ dir: '/opt/harness', version: harnessVersion }),
    claude: (copy) => Promise.resolve(versions[copy]),
    runSet,
    now: () => new Date(2026, 10, 14, 10, 2),
    ...extra,
  })
}

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'harness-claude-health-'))
  cacheFile = join(data, 'harness-claude.json')
  versions = { worfy: found('2.1.322'), terminal: found('2.1.330') }
  harnessVersion = '0.4.12+abc'
  answer = () => ({ outcomes: passedAll(), warnings: [] })
  runSet = vi.fn<HarnessClaudeDeps['runSet']>((_binary, _dir, copy) => Promise.resolve(answer(copy)))
})

afterEach(() => {
  removeTestTree(data)
})

describe('Health: Harness on Claude Code — once per pair of versions', () => {
  it('runs the set once per pair of a Claude Code version and a Harness version, on the binary of the copy and the Harness of this build', async () => {
    const health = check()
    const first = await health.row('worfy')
    const second = await health.row('worfy')
    expect(runSet).toHaveBeenCalledTimes(1)
    expect(runSet).toHaveBeenCalledWith('/opt/claude-2.1.322', '/opt/harness', 'worfy')
    expect(first).toMatchObject({ id: 'harness-claude', title: 'Harness on Claude Code', status: 'ok', severity: 'non-critical' })
    expect(first?.detail).toMatch(/^2\.1\.322 \(worfy\) · 6 of 6 checks · Nov 14, 10:02$/)
    expect(second).toEqual(first)
  })

  it('keeps the answer in worfy\'s data folder: a new start reads it and runs nothing; the cache file is the one thing written there', async () => {
    await check().row('worfy')
    expect(readdirSync(data)).toEqual(['harness-claude.json'])
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { entries: { claudeVersion: string; harnessVersion: string; outcomes: unknown[] }[] }
    expect(cached.entries).toEqual([expect.objectContaining({ claudeVersion: '2.1.322', harnessVersion: '0.4.12+abc', outcomes: passedAll() })])
    runSet.mockClear()
    const again = await check().row('worfy')
    expect(runSet).not.toHaveBeenCalled()
    expect(again?.status).toBe('ok')
  })

  it('a new version of Claude Code in the terminal is a new run; so is a new Harness version', async () => {
    const health = check()
    await health.row('terminal')
    versions.terminal = found('2.1.331')
    await health.row('terminal')
    harnessVersion = '0.4.13+def'
    await health.row('terminal')
    expect(runSet.mock.calls.map(([binary]) => binary)).toEqual(['/opt/claude-2.1.330', '/opt/claude-2.1.331', '/opt/claude-2.1.331'])
  })

  it('"Run again" runs the set anew over a kept answer and keeps the new one', async () => {
    const health = check()
    await health.row('terminal')
    answer = () => ({ outcomes: withOutcome('guard-reset-hard', { status: 'failed', reason: 'the guard did not refuse: the edit was wiped' }), warnings: [] })
    expect((await health.row('terminal'))?.status).toBe('ok')
    const again = await health.row('terminal', { again: true })
    expect(runSet).toHaveBeenCalledTimes(2)
    expect(again?.status).toBe('fail')
    expect((await check().row('terminal'))?.status).toBe('fail')
  })

  it('worfy\'s copy and the terminal on the same version share one run, even asked at the same time', async () => {
    versions.terminal = found('2.1.322', '/usr/local/bin/claude')
    const rows = await check().rows()
    expect(runSet).toHaveBeenCalledTimes(1)
    expect(rows.map((each) => [each.id, each.status, each.detail.split(' · ')[0]])).toEqual([
      ['harness-claude', 'ok', '2.1.322 (worfy)'],
      ['harness-claude-terminal', 'ok', '2.1.322 (terminal)'],
    ])
  })

  it('a cache file that does not read is no cache: the set runs, and the file is written anew', async () => {
    writeFileSync(cacheFile, '{ not json')
    expect((await check().row('worfy'))?.status).toBe('ok')
    expect(runSet).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toHaveProperty('entries')
  })
})

describe('Health: Harness on Claude Code — the row', () => {
  it('a failed case is a red row that names the case, with "Run again" and "Copy details", whose text has every outcome', async () => {
    answer = () => ({ outcomes: withOutcome('guard-reset-hard', { status: 'failed', reason: 'the guard did not refuse: the edit was wiped' }), warnings: [] })
    const row = await check().row('terminal')
    expect(row).toMatchObject({ id: 'harness-claude-terminal', status: 'fail', opensFirstRun: false })
    expect(row?.detail).toBe('2.1.330 (terminal) · guard-reset-hard: the guard did not refuse: the edit was wiped')
    expect(row?.actions.map((each) => each.id)).toEqual(['harness-claude-run', 'copy-details', 'open-link'])
    expect(row?.details).toContain('guard-reset-hard: failed — the guard did not refuse: the edit was wiped')
    expect(row?.details).toContain('plugin-loaded: passed')
    expect(row?.details).toContain('Harness 0.4.12+abc')
  })

  it('two failed cases are counted and named', async () => {
    answer = () => ({
      outcomes: passedAll().map((each): CaseOutcome => (each.id === 'guard-reset-hard' || each.id === 'stop-holds-on-red' ? { ...each, status: 'failed', reason: 'missing' } : each)),
      warnings: [],
    })
    expect((await check().row('worfy'))?.detail).toBe('2.1.322 (worfy) · 2 of 6 checks failed: guard-reset-hard, stop-holds-on-red')
  })

  it('"could not run" is its own text and status: a case that did not run says nothing about the Harness, so the row is not red', async () => {
    answer = () => ({ outcomes: withOutcome('plugin-loaded', { status: 'not-run', reason: 'could not start: ENOENT' }), warnings: [] })
    const row = await check().row('worfy')
    expect(row?.status).toBe('unknown')
    expect(row?.detail).toBe('2.1.322 (worfy) · the checks could not run: plugin-loaded: could not start: ENOENT')
    expect(row?.hint).toMatch(/nothing is known about the Harness/i)
    expect(row?.details).toContain('plugin-loaded: not run — could not start: ENOENT')
  })

  it('a failed case wins over one that did not run', async () => {
    answer = () => ({
      outcomes: passedAll().map((each): CaseOutcome => (each.id === 'plugin-loaded' ? { ...each, status: 'not-run', reason: 'x' } : each.id === 'guard-reset-hard' ? { ...each, status: 'failed', reason: 'y' } : each)),
      warnings: [],
    })
    expect((await check().row('worfy'))?.status).toBe('fail')
  })

  it('a plugin warning of system/init (Claude Code 2.1.332 and later) is a warning row that names it', async () => {
    answer = () => ({ outcomes: passedAll(), warnings: ['worfy engine-range-exempt: requires claude-code >=9.0.0'] })
    const row = await check().row('terminal')
    expect(row?.status).toBe('warn')
    expect(row?.detail).toBe('2.1.330 (terminal) · 6 of 6 checks · 1 plugin warning')
    expect(row?.hint).toContain('worfy engine-range-exempt: requires claude-code >=9.0.0')
    expect(row?.details).toContain('plugin warning: worfy engine-range-exempt: requires claude-code >=9.0.0')
  })

  it('the terminal on a newer version than worfy\'s copy links the changelog of Claude Code; the same or an older one does not', async () => {
    const newer = await check().row('terminal')
    expect(newer?.actions).toContainEqual({ id: 'open-link', label: 'Changelog', url: CLAUDE_CODE_CHANGELOG_URL })
    versions.terminal = found('2.1.322')
    expect((await check().row('terminal'))?.actions.some((each) => each.id === 'open-link')).toBe(false)
    versions.terminal = found('2.1.300')
    expect((await check().row('terminal'))?.actions.some((each) => each.id === 'open-link')).toBe(false)
    expect((await check().row('worfy'))?.actions.some((each) => each.id === 'open-link')).toBe(false)
  })

  it('no claude in the terminal: no terminal row (the row "Claude Code in the terminal" says so); one it cannot start is "could not run"', async () => {
    versions.terminal = { kind: 'missing' }
    expect(await check().row('terminal')).toBeNull()
    expect((await check().rows()).map((each) => each.id)).toEqual(['harness-claude'])
    runSet.mockClear()
    versions.terminal = { kind: 'unusable', reason: 'claude.cmd of npm: only a claude.exe is started', version: '2.1.330' }
    const row = await check().row('terminal')
    expect(row).toMatchObject({ status: 'unknown', detail: '2.1.330 (terminal) · the checks could not run: claude.cmd of npm: only a claude.exe is started' })
    expect(runSet).not.toHaveBeenCalled()
  })

  it('without the Harness copy of this build nothing runs and the row says why', async () => {
    harnessVersion = undefined
    const row = await check().row('worfy')
    expect(row).toMatchObject({ status: 'unknown', detail: '2.1.322 (worfy) · the checks could not run: this build has no Harness copy' })
    expect(runSet).not.toHaveBeenCalled()
  })

  it('a set that throws is "could not run" and is not kept', async () => {
    runSet.mockRejectedValueOnce(new Error('spawn EBADF'))
    const row = await check().row('worfy')
    expect(row).toMatchObject({ status: 'unknown', detail: '2.1.322 (worfy) · the checks could not run: spawn EBADF' })
    expect((await check().row('worfy'))?.status).toBe('ok')
    expect(runSet).toHaveBeenCalledTimes(2)
  })
})

describe('Health: Harness on Claude Code — the runs', () => {
  it('the set runs every case of ticket 08 with the login shell\'s PATH, so the hooks find node and git, and keeps the plugin warnings of system/init', async () => {
    let seen: { cases: readonly ContractCase[]; options: ContractSetOptions } | undefined
    const run = vi.fn((cases: readonly ContractCase[], options: ContractSetOptions): Promise<CaseOutcome[]> => {
      seen = { cases, options }
      const init = { type: 'system', subtype: 'init', plugin_warnings: [{ plugin: 'worfy', type: 'engine-range-exempt', message: 'requires claude-code >=9.0.0' }] }
      return Promise.resolve(
        cases.map((each) => {
          // Folders of the case's own, as the runner makes them: the cases' own prepare (git init, a gate stub) runs too.
          const root = mkdtempSync(join(data, `${each.id}-`))
          const context = { cwd: join(root, 'cwd'), home: join(root, 'home'), harnessHome: join(root, 'home', 'harness'), scratch: join(root, 'scratch'), pluginDir: options.pluginDir }
          for (const dir of [context.cwd, context.harnessHome, context.scratch]) mkdirSync(dir, { recursive: true })
          expect(each.prepare?.(context)).toMatchObject({ PATH: '/login/bin:/usr/bin' })
          try {
            each.check({ ...context, lines: [init], init, requests: [], toolResult: () => undefined, exitCode: 0, stderr: '' })
          } catch {
            // The cases' own checks read a plugin folder this test does not have; the warnings are kept before them.
          }
          return { id: each.id, title: each.title, status: 'passed' as const }
        }),
      )
    })
    const setRun = contractSetRun(() => Promise.resolve({ PATH: '/login/bin:/usr/bin', HOME: '/home/someone' }), run)
    const result = await setRun('/opt/claude', '/opt/harness', 'terminal')
    expect(seen?.cases.map((each) => each.id)).toEqual(CONTRACT_CASES.map((each) => each.id))
    expect(seen?.options).toMatchObject({ binary: '/opt/claude', pluginDir: '/opt/harness' })
    expect(result.outcomes.every((each) => each.status === 'passed')).toBe(true)
    expect(result.warnings).toEqual(['worfy engine-range-exempt: requires claude-code >=9.0.0'])
  })

  it('the fake set of the e2e runs (WORFY_HARNESS_CONTRACT) answers per copy and starts no process', async () => {
    const run = fakeSetRun('worfy=passed,terminal=failed:guard-reset-hard')
    expect((await run('/x', '/h', 'worfy')).outcomes.every((each) => each.status === 'passed')).toBe(true)
    const terminal = await run('/x', '/h', 'terminal')
    expect(terminal.outcomes.find((each) => each.id === 'guard-reset-hard')).toMatchObject({ status: 'failed' })
    expect(terminal.outcomes.filter((each) => each.status !== 'passed')).toHaveLength(1)
    expect((await fakeSetRun('terminal=not-run:plugin-loaded')('/x', '/h', 'terminal')).outcomes[0]).toMatchObject({ id: 'plugin-loaded', status: 'not-run' })
    // A copy the setting does not name passes.
    expect((await fakeSetRun('terminal=failed:plugin-loaded')('/x', '/h', 'worfy')).outcomes.every((each) => each.status === 'passed')).toBe(true)
  })

  it('the terminal\'s claude is the first executable on the PATH of the login shell, with its --version; none is no row', async () => {
    const empty = join(data, 'empty')
    const bin = join(data, 'bin')
    mkdirSync(empty)
    mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\n')
    chmodSync(join(bin, 'claude'), 0o755)
    const asked: string[] = []
    const run = (file: string, args: readonly string[]) => {
      asked.push([file, ...args].join(' '))
      return Promise.resolve({ code: 0, stdout: '2.1.330 (Claude Code)\n', stderr: '', missing: false })
    }
    const path = ['relative/bin', empty, bin].join(process.platform === 'win32' ? ';' : ':')
    expect(await terminalClaude({ PATH: path }, { platform: 'darwin', run })).toEqual({ kind: 'found', binary: join(bin, 'claude'), version: '2.1.330' })
    expect(asked).toEqual([`${join(bin, 'claude')} --version`])
    expect(await terminalClaude({ PATH: empty }, { platform: 'darwin', run })).toEqual({ kind: 'missing' })
  })

  it('on Windows a claude.exe is started; npm\'s claude.cmd, which needs cmd.exe, is named with its version and not started', async () => {
    const run = () => Promise.resolve({ code: 0, stdout: '2.1.330 (Claude Code)', stderr: '', missing: false })
    const exe = await terminalClaude({ Path: 'C:\\Tools\\claude', PATHEXT: '.EXE;.CMD' }, { platform: 'win32', run, exists: (file) => file === 'C:\\Tools\\claude\\claude.exe' })
    expect(exe).toEqual({ kind: 'found', binary: 'C:\\Tools\\claude\\claude.exe', version: '2.1.330' })
    const cmd = await terminalClaude({ Path: 'C:\\npm', PATHEXT: '.EXE;.CMD' }, { platform: 'win32', run, exists: (file) => file === 'C:\\npm\\claude.cmd' })
    expect(cmd).toMatchObject({ kind: 'unusable', version: '2.1.330' })
    expect(await terminalClaude({ Path: 'C:\\npm' }, { platform: 'win32', run, exists: () => false })).toEqual({ kind: 'missing' })
  })
})
