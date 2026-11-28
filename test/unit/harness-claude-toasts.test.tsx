import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Check, FirstRunReport } from '../../src/shared/ipc/first-run'
import { createHarnessClaudeToasts, HARNESS_CLAUDE_TOAST_KEY } from '../../src/renderer/shell/harness-claude-toasts'
import { pressToastAction, resetToasts, toasts } from '../../src/renderer/toast/toasts'

// worfy-harness-guarantees ticket 09: a failed row "Harness on Claude Code" of Health is a toast with "Open Health",
// as a Harness out of date is; once per failed answer per window load, gone when no such row fails.

const row = (id: Check['id'], status: Check['status'], detail: string): Check => ({
  id,
  group: 'Harness',
  title: 'Harness on Claude Code',
  status,
  severity: 'non-critical',
  detail,
  hint: '',
  command: null,
  actions: [],
})
const report = (...checks: Check[]): FirstRunReport => ({ checkedAt: '2026-11-28T10:00:00.000Z', checks })
const shown = () => toasts.getState().toasts.filter((each) => each.key === HARNESS_CLAUDE_TOAST_KEY)

const FAILED = '2.1.330 (terminal) · guard-reset-hard: the guard did not refuse: the edit was wiped'

beforeEach(() => resetToasts())

describe('the toast of a failed row "Harness on Claude Code"', () => {
  it('a failed row is a toast that names the version, the copy and the case, with "Open Health"', () => {
    const openHealth = vi.fn()
    const follow = createHarnessClaudeToasts(openHealth)
    follow(report(row('harness-claude', 'ok', '2.1.322 (worfy) · 6 of 6 checks · Nov 28, 10:00'), row('harness-claude-terminal', 'fail', FAILED)))
    expect(shown()).toHaveLength(1)
    expect(shown()[0]).toMatchObject({ kind: 'action', text: `The Harness failed a check on Claude Code ${FAILED}` })
    expect(shown()[0]?.actions?.map((each) => each.label)).toEqual(['Open Health'])
    pressToastAction(shown()[0]!.id, 0)
    expect(openHealth).toHaveBeenCalledTimes(1)
  })

  it('the same failure is told once; a new one is told again; none failing closes it', () => {
    const follow = createHarnessClaudeToasts(() => undefined)
    follow(report(row('harness-claude-terminal', 'fail', FAILED)))
    resetToasts()
    follow(report(row('harness-claude-terminal', 'fail', FAILED)))
    expect(shown()).toHaveLength(0)
    follow(report(row('harness-claude-terminal', 'fail', '2.1.331 (terminal) · stop-holds-on-red: no turn after Stop')))
    expect(shown()[0]?.text).toContain('2.1.331 (terminal)')
    follow(report(row('harness-claude-terminal', 'ok', '2.1.331 (terminal) · 6 of 6 checks · Nov 28, 10:00')))
    expect(shown()).toHaveLength(0)
  })

  it('a row that could not run the checks, a warning and other rows bring no toast', () => {
    const follow = createHarnessClaudeToasts(() => undefined)
    follow(
      report(
        row('harness-claude', 'unknown', '2.1.322 (worfy) · the checks could not run: plugin-loaded: could not start'),
        row('harness-claude-terminal', 'warn', '2.1.330 (terminal) · 6 of 6 checks · 1 plugin warning'),
        row('harness', 'fail', 'not installed'),
      ),
    )
    expect(shown()).toHaveLength(0)
  })
})
