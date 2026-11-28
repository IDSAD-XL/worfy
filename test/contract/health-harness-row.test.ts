// The Health check row `harness` checked again without a full run (worfy-polish 172): after an Install, Update or
// Replace of the app's installer (onHarnessInstalled) and on the focus of a window, at most once per 5 minutes, so a
// Replace made in a terminal is caught too. The row reads only the installer's local state and the Update state as it
// was last read: no network. Its item in the attention core closes by the path every `ok` row takes (healthAttention).
import { describe, expect, it } from 'vitest'
import { AttentionCore } from '../../src/main/assistant/core/attention-core'
import { healthAttention } from '../../src/main/assistant/core/sources'
import type { AttentionFile } from '../../src/main/assistant/core/store'
import { harnessCheck } from '../../src/main/first-run/checks'
import { followHarnessRow } from '../../src/main/first-run/harness-row'
import { HealthReports, RECHECK_ON_FOCUS_MS } from '../../src/main/first-run/health-reports'
import type { Check } from '../../src/shared/ipc/first-run'
import type { HarnessState, HarnessStatus } from '../../src/shared/ipc/harness'

const BUILD = '1.2.0+abc1234'
const status = (state: HarnessState): HarnessStatus => ({ state, bundledVersion: BUILD, canInstall: true, pluginDir: '/nowhere/plugin', dependencies: [] }) as unknown as HarnessStatus
const SAME_SEMVER = status({ kind: 'outdated', from: '1.2.0+fffffff', to: BUILD, sameVersion: true })
const INSTALLED = status({ kind: 'installed', version: BUILD, enabled: true })
const machineRow = (id: Check['id'], status: Check['status']): Check => ({ id, group: 'Command-line tools', title: id, status, severity: 'critical', detail: '', hint: '', command: null, actions: [] })

/** The report with its `harness` row as the start left it, the attention core that follows it, and the installer's state the test sets. */
async function setup(first: HarnessStatus = SAME_SEMVER) {
  let now = 1_000_000
  let current: HarnessStatus | Error = first
  let reads = 0
  const deps = {
    harness: () => {
      reads += 1
      return current instanceof Error ? Promise.reject(current) : Promise.resolve(current)
    },
  }
  const health = new HealthReports(() => now)
  const files = new Map<string | null, AttentionFile>()
  const core = new AttentionCore({ now: () => now, store: { read: (scope) => files.get(scope), write: (scope, file) => void files.set(scope, file) }, settings: () => ({ timeZone: 'UTC' }), projects: () => [] })
  health.subscribe((report) => healthAttention(core, report))
  let installed: ((status: HarnessStatus) => void) | undefined
  const stop = followHarnessRow(health, deps, (listener) => {
    installed = listener
    return () => (installed = undefined)
  })
  health.setChecks({ checks: [machineRow('git', 'ok'), await harnessCheck(deps)], checkedAt: new Date(now).toISOString() })
  reads = 0
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    health,
    stop,
    row: () => health.current()?.checks.find((check) => check.id === 'harness'),
    item: () => core.items(null).find((each) => each.subject.id === 'harness')?.state,
    install: async (next: HarnessStatus) => {
      current = next
      installed?.(next)
      await settle()
    },
    set: (next: HarnessStatus | Error) => void (current = next),
    tick: (ms: number) => void (now += ms),
    reads: () => reads,
    settle,
  }
}

describe('the Harness row after an install (onHarnessInstalled)', () => {
  it('a status that matches this build: the row is ok and its item closes', async () => {
    const s = await setup()
    expect([s.row()?.status, s.item()]).toEqual(['warn', 'new'])
    await s.install(INSTALLED)
    expect([s.row()?.status, s.item()]).toEqual(['ok', 'closed'])
    s.stop()
  })

  it('a status still outdated: the row stays out of ok and the item stays open', async () => {
    const s = await setup()
    await s.install(status({ kind: 'outdated', from: '1.1.0+0000000', to: BUILD, sameVersion: false }))
    expect(s.row()?.status).toBe('fail')
    expect(s.item()).toBe('new')
    s.stop()
  })

  it('stopped: an install no longer checks the row again', async () => {
    const s = await setup()
    s.stop()
    await s.install(INSTALLED)
    expect([s.row()?.status, s.item()]).toEqual(['warn', 'new'])
  })
})

describe('the Harness row on the focus of a window', () => {
  it('a Replace in a terminal: the focus after 5 minutes reads the installer again, and the item closes', async () => {
    const s = await setup()
    s.set(INSTALLED)
    s.tick(RECHECK_ON_FOCUS_MS + 1)
    await s.health.focus()
    expect([s.row()?.status, s.item()]).toEqual(['ok', 'closed'])
    s.stop()
  })

  it('is checked again at most once per 5 minutes', async () => {
    const s = await setup()
    await s.health.focus()
    expect(s.reads()).toBe(0)
    s.tick(RECHECK_ON_FOCUS_MS + 1)
    await s.health.focus()
    expect(s.reads()).toBe(1)
    s.tick(60_000)
    await s.health.focus()
    expect(s.reads()).toBe(1)
    s.tick(RECHECK_ON_FOCUS_MS)
    await s.health.focus()
    expect(s.reads()).toBe(2)
    s.stop()
  })

  it('a status that does not read: the row is not ok and the item stays open', async () => {
    const s = await setup()
    s.set(new Error('claude plugin list did not answer'))
    s.tick(RECHECK_ON_FOCUS_MS + 1)
    await s.health.focus()
    expect(s.row()?.status).not.toBe('ok')
    expect(s.item()).toBe('new')
    s.stop()
  })
})
