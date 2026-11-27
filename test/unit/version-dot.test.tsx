import { describe, expect, it } from 'vitest'
import type { CodexHarness, HarnessState, HarnessStatus } from '../../src/shared/ipc/harness'
import { updateSnapshotSchema, type UpdateSnapshot } from '../../src/shared/ipc/update'
import { versionDot } from '../../src/renderer/shell/footer/version-dot'

// worfy-layout ticket 03 (the spec's Seam 1): the dot of the version chip in the footer.
// Red — the Harness needs the user (unavailable, Install, Retry, Move old Harness…); amber — an update waits
// (worfy's own Update with a dot, Update Harness with the accent, the Codex line's button or "approve hooks");
// none otherwise, "Replace Harness" and a dev run without `canInstall` included.

const SHA = 'b'.repeat(40)
const NEW = '0.5.0+bbbbbbb'

const snapshot = (fields: Partial<UpdateSnapshot> = {}): UpdateSnapshot => ({ ...updateSnapshotSchema.parse({ enabled: true, checking: false }), ...fields })
const available = (quiet = false): UpdateSnapshot['available'] => ({ sha: SHA, version: NEW, quiet })

const status = (state: HarnessState, canInstall = true, codex?: CodexHarness): HarnessStatus => ({
  state,
  bundledVersion: '0.2.0+bbbbbbb',
  canInstall,
  pluginDir: '/Users/someone/.claude/worfy-harness/plugin',
  dependencies: [],
  ...(codex === undefined ? {} : { codex }),
})
const installed = (codex?: CodexHarness, canInstall = true) => status({ kind: 'installed', version: '0.2.0+bbbbbbb', enabled: true }, canInstall, codex)
const codex = (state: CodexHarness['state'], hooksToApprove = false): CodexHarness => ({ state, agentsDir: '/Users/someone/.codex/agents', hooksToApprove, skippedAgents: [] })

describe('versionDot', () => {
  it('red: the Harness could not be read ("Harness unavailable")', () => {
    expect(versionDot(snapshot(), undefined, false, 'claude is missing')).toEqual({ tone: 'red', reason: 'Harness unavailable' })
  })

  it('red: a Harness not installed while this run may install it', () => {
    expect(versionDot(snapshot(), status({ kind: 'not-installed' }), false, undefined)).toEqual({ tone: 'red', reason: 'Harness needs Install' })
  })

  it('red: a broken Harness, with Retry', () => {
    expect(versionDot(snapshot(), status({ kind: 'error', step: 'install', reason: 'exited with 1' }), false, undefined)).toEqual({ tone: 'red', reason: 'Harness needs Retry' })
  })

  it('amber: a Harness disabled in Claude Code, Enable offered (worfy-polish ticket 167); none in a dev run without canInstall', () => {
    const disabled: HarnessState = { kind: 'installed', version: '0.2.0+bbbbbbb', enabled: false }
    expect(versionDot(snapshot(), status(disabled), false, undefined)).toEqual({ tone: 'amber', reason: 'Harness needs Enable' })
    expect(versionDot(snapshot(), status(disabled, false), false, undefined)).toBeNull()
  })

  it('red: an old Harness to move, "Move old Harness…" offered', () => {
    expect(versionDot(snapshot(), installed(), true, undefined)).toEqual({ tone: 'red', reason: 'old Harness to move' })
  })

  it('red wins over amber: a Harness to install and an Update of worfy at once', () => {
    expect(versionDot(snapshot({ available: available() }), status({ kind: 'not-installed' }), false, undefined)?.tone).toBe('red')
  })

  it('amber: an Available update of worfy, as the chip had its dot', () => {
    expect(versionDot(snapshot({ available: available() }), installed(), false, undefined)).toEqual({ tone: 'amber', reason: `worfy ${NEW} is available` })
  })

  it('amber: a build that runs, is ready or failed', () => {
    for (const phase of ['building', 'ready', 'failed'] as const) {
      expect(versionDot(snapshot({ available: available(), build: { phase, sha: SHA, version: NEW } }), installed(), false, undefined)?.tone).toBe('amber')
    }
  })

  it('no dot: a quiet Available update (the commit rolled back from), Update off, or no snapshot yet', () => {
    expect(versionDot(snapshot({ available: available(true) }), installed(), false, undefined)).toBeNull()
    expect(versionDot(updateSnapshotSchema.parse({ enabled: false, checking: false }), installed(), false, undefined)).toBeNull()
    expect(versionDot(null, installed(), false, undefined)).toBeNull()
  })

  it('amber: an outdated Harness of an older semver, "Update Harness" with the accent', () => {
    const outdated = status({ kind: 'outdated', from: '0.1.0+aaaaaaa', to: '0.2.0+bbbbbbb', sameVersion: false })
    expect(versionDot(snapshot(), outdated, false, undefined)).toEqual({ tone: 'amber', reason: 'Harness needs Update Harness' })
  })

  it('amber: the same semver behind this copy (harnessBehind of the snapshot)', () => {
    const same = status({ kind: 'outdated', from: '0.2.0+aaaaaaa', to: '0.2.0+bbbbbbb', sameVersion: true })
    expect(versionDot(snapshot({ harnessBehind: { from: '0.2.0+aaaaaaa', to: '0.2.0+bbbbbbb' } }), same, false, undefined)).toEqual({ tone: 'amber', reason: 'Harness needs Update Harness' })
  })

  it('no dot: "Replace Harness" — the same semver from another commit main could not order', () => {
    const same = status({ kind: 'outdated', from: '0.2.0+aaaaaaa', to: '0.2.0+bbbbbbb', sameVersion: true })
    expect(versionDot(snapshot(), same, false, undefined)).toBeNull()
    // A snapshot about another installed version is stale: still Replace, still no dot.
    expect(versionDot(snapshot({ harnessBehind: { from: '0.2.0+ccccccc', to: '0.2.0+bbbbbbb' } }), same, false, undefined)).toBeNull()
  })

  it('amber: the Codex line has a button (Install in Codex, Update Harness in Codex, Retry)', () => {
    expect(versionDot(snapshot(), installed(codex({ kind: 'not-installed' })), false, undefined)).toEqual({ tone: 'amber', reason: 'Codex needs Install in Codex' })
    expect(versionDot(snapshot(), installed(codex({ kind: 'outdated', from: '0.1.0', to: '0.2.0' })), false, undefined)).toEqual({ tone: 'amber', reason: 'Codex needs Update Harness in Codex' })
    expect(versionDot(snapshot(), installed(codex({ kind: 'error', step: 'plugin add', reason: 'exited with 1' })), false, undefined)?.tone).toBe('amber')
  })

  it('amber: "Codex: approve hooks"', () => {
    expect(versionDot(snapshot(), installed(codex({ kind: 'installed', version: '0.2.0' }, true)), false, undefined)).toEqual({ tone: 'amber', reason: 'Codex: approve hooks' })
  })

  it('no dot: a Harness and a Codex part with nothing to do', () => {
    expect(versionDot(snapshot(), installed(codex({ kind: 'installed', version: '0.2.0' })), false, undefined)).toBeNull()
    expect(versionDot(snapshot(), undefined, false, undefined)).toBeNull()
  })

  it('no dot in a dev run without canInstall: no Install, Retry, Update Harness or Codex button to press', () => {
    const states: HarnessState[] = [{ kind: 'not-installed' }, { kind: 'error', step: 'install', reason: 'exited with 1' }, { kind: 'outdated', from: '0.1.0+aaaaaaa', to: '0.2.0+bbbbbbb', sameVersion: false }]
    for (const state of states) expect(versionDot(snapshot(), status(state, false), false, undefined)).toBeNull()
    expect(versionDot(snapshot(), installed(codex({ kind: 'not-installed' }), false), false, undefined)).toBeNull()
  })
})
