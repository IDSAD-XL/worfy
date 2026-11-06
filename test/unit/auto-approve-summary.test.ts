// The morning summary of Auto-approval (worfy-auto-approve ticket 08): the decisions of a Run read from its
// Journal's `auto-approval` lines (src/shared/flight-recorder/from-journal.ts), their counters by mode
// (src/shared/autopilot/auto-approval-summary.ts) — the block «Auto-approval» of Run history counts them —
// and the one line the Orchestrator's chat gets at the end of a Run: none without a decision, its own words
// for Shadow and for On.
import { describe, expect, it } from 'vitest'
import { autoApprovalChatLine, autoApprovalCounts, isShadowDecision } from '../../src/shared/autopilot/auto-approval-summary'
import { journalFacts, type JournalFacts } from '../../src/shared/flight-recorder/from-journal'
import { runViewSchema, type RunView } from '../../src/shared/ipc/runs'

const RUN = '2026-11-05T22-00-00-000Z-a1b2c3'
const T = (hhmm: string): string => `2026-11-05T${hhmm}:00.000Z`

/** One Journal line of the Run, Epic `e`. */
const line = (hhmm: string, kind: string, fields: Record<string, unknown> = {}): string => JSON.stringify({ at: T(hhmm), run: RUN, project: 'repo-1a2b3c4d', epic: 'e', kind, ...fields })

/** An `auto-approval` line as the run writes it (src/main/autopilot/run.ts, autoApprovalLine). */
const decision = (hhmm: string, mode: string, outcome: string, fields: Record<string, unknown> = {}): string =>
  line(hhmm, 'auto-approval', { session: 's-1', vendor: 'claude', mode, outcome, rule: 'files-inside-roots', tool: 'Bash', targets: ['~/repo/.claude/worktrees/01/build'], command: 'rm -rf ~/repo/.claude/worktrees/01/build', ...fields })

function read(...lines: string[]): JournalFacts {
  const facts = journalFacts({ run: RUN, lines })
  if (facts === null) throw new Error('no facts')
  return facts
}

const started = line('22:00', 'run-started', { by: 'button', autoApproval: 'on' })
const stopped = line('23:00', 'run-stopped', { reason: 'tickets-done' })

describe('the decisions of a Run in its Journal', () => {
  it('lists every auto-approval line in file order — rule, tool, targets, the command as the Journal keeps it — and counts On and Shadow apart', () => {
    const facts = read(
      started,
      decision('22:01', 'on', 'allow', { agent: 'agent-impl-01' }),
      decision('22:02', 'on', 'allow'),
      decision('22:03', 'on', 'allow'),
      decision('22:04', 'on', 'deny', { rule: 'not-judged', command: 'GH_TOKEN=*** gh pr list' }),
      decision('22:05', 'on', 'park', { rule: 'outside-roots', targets: ['/opt/x'] }),
      decision('22:06', 'on', 'park-answered', { rule: 'outside-roots', targets: ['/opt/x'] }),
      decision('22:07', 'on', 'hard-deny', { rule: 'hard:ssh', targets: ['~/.ssh/demo-key'] }),
      decision('22:08', 'on', 'park-expired', { rule: 'outside-roots', targets: ['/opt/y'] }),
      decision('22:10', 'shadow', 'would-allow', { tool: 'Write', command: undefined }),
      decision('22:11', 'shadow', 'would-deny', { rule: 'not-judged' }),
      decision('22:12', 'shadow', 'would-park', { rule: 'outside-roots' }),
      decision('22:13', 'shadow', 'hard-deny', { rule: 'hard:ssh' }),
      stopped,
    )
    expect(facts.autoApproval.map((each) => [each.at, each.mode, each.outcome, each.rule])).toEqual([
      [T('22:01'), 'on', 'allow', 'files-inside-roots'],
      [T('22:02'), 'on', 'allow', 'files-inside-roots'],
      [T('22:03'), 'on', 'allow', 'files-inside-roots'],
      [T('22:04'), 'on', 'deny', 'not-judged'],
      [T('22:05'), 'on', 'park', 'outside-roots'],
      [T('22:06'), 'on', 'park-answered', 'outside-roots'],
      [T('22:07'), 'on', 'hard-deny', 'hard:ssh'],
      [T('22:08'), 'on', 'park-expired', 'outside-roots'],
      [T('22:10'), 'shadow', 'would-allow', 'files-inside-roots'],
      [T('22:11'), 'shadow', 'would-deny', 'not-judged'],
      [T('22:12'), 'shadow', 'would-park', 'outside-roots'],
      [T('22:13'), 'shadow', 'hard-deny', 'hard:ssh'],
    ])
    expect(facts.autoApproval[0]).toEqual({ at: T('22:01'), mode: 'on', outcome: 'allow', rule: 'files-inside-roots', tool: 'Bash', targets: ['~/repo/.claude/worktrees/01/build'], command: 'rm -rf ~/repo/.claude/worktrees/01/build', agent: 'agent-impl-01' })
    // The command stays as the Journal masked it: the reader never unmasks or re-reads it.
    expect(facts.autoApproval[3]?.command).toBe('GH_TOKEN=*** gh pr list')
    // A line without a command (a Write) has none.
    expect(facts.autoApproval[8]).not.toHaveProperty('command')
    expect(facts.autoApproval[8]?.tool).toBe('Write')

    // The end of a park (answered, expired) is in the list, not a decision of its own.
    expect(autoApprovalCounts(facts.autoApproval)).toEqual({
      on: { allow: 3, deny: 1, park: 1, 'hard-deny': 1 },
      shadow: { 'would-allow': 1, 'would-deny': 1, 'would-park': 1, 'hard-deny': 1 },
    })
    expect(facts.autoApproval.filter(isShadowDecision)).toHaveLength(4)
  })

  it('takes the lines after run-stopped too: the Session stays under the Run\'s policy while its tasks end', () => {
    const facts = read(started, decision('22:01', 'on', 'allow'), stopped, decision('23:05', 'on', 'deny', { rule: 'not-judged' }))
    expect(facts.autoApproval.map((each) => each.outcome)).toEqual(['allow', 'deny'])
  })

  it('leaves out an auto-approval line of another shape: an unknown outcome or mode, no rule, targets that are not texts', () => {
    const facts = read(
      started,
      decision('22:01', 'on', 'approve'),
      decision('22:02', 'off', 'allow'),
      decision('22:03', 'on', 'allow', { rule: '' }),
      decision('22:04', 'on', 'allow', { targets: [1] }),
      decision('22:05', 'on', 'allow', { command: 7 }),
      decision('22:06', 'on', 'deny'),
    )
    expect(facts.autoApproval.map((each) => each.at)).toEqual([T('22:06')])
    // Each is a line left out, as the footnote of Run history counts them.
    expect(facts.skipped).toBe(5)
    expect(read(started, decision('22:01', 'on', 'allow', { targets: [1] })).skipped).toBe(1)
  })

  it('a Run without a decision has none: no counters, so no block in Run history', () => {
    const facts = read(started, line('22:05', 'refused-dialog', { session: 's-1', what: 'permission_request' }), stopped)
    expect(facts.autoApproval).toEqual([])
    expect(autoApprovalCounts(facts.autoApproval)).toEqual({ on: null, shadow: null })
    // Only the end of a park: no decision either.
    expect(autoApprovalCounts(read(started, decision('22:01', 'on', 'park-expired')).autoApproval)).toEqual({ on: null, shadow: null })
  })

  it('reaches a window as Run history gets it — a Linked machine too — through the schema of the view, which keeps every field', () => {
    const decisions = read(started, decision('22:01', 'on', 'allow', { agent: 'agent-impl-01' }), decision('22:02', 'shadow', 'would-deny', { command: undefined })).autoApproval
    const view = {
      projectId: 'repo-1a2b3c4d',
      run: RUN,
      epic: 'e',
      timeline: { runId: RUN, live: false, now: 2, spans: [], blocks: [], orchestratorMarks: [] },
      summary: { topStages: [], waits: [], work: [], workNote: 'summed; parallel', runDuration: 0 },
      github: { state: 'unused', reason: 'test' },
      repoUrl: null,
      profileReason: null,
      skippedLines: 0,
      error: null,
      autoApproval: { decisions, shadowSoFar: 9 },
    } satisfies RunView
    expect(runViewSchema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view)
  })
})

describe('the line in the Orchestrator\'s chat at the end of a Run', () => {
  const judged = (mode: 'on' | 'shadow', ...outcomes: string[]) => outcomes.map((outcome) => ({ mode, outcome }) as Parameters<typeof autoApprovalChatLine>[0][number])

  it('is none without a decision', () => {
    expect(autoApprovalChatLine([])).toBeNull()
    expect(autoApprovalChatLine(judged('on', 'park-answered', 'park-expired'))).toBeNull()
  })

  it('On: what was allowed, denied and parked', () => {
    expect(autoApprovalChatLine(judged('on', 'allow', 'allow', 'allow', 'deny', 'park', 'park-answered'))).toBe('Auto-approval: allowed 3, denied 1, parked 1')
    expect(autoApprovalChatLine(judged('on', 'allow', 'allow', 'allow', 'deny'))).toBe('Auto-approval: allowed 3, denied 1, parked 0')
    // A hard deny is named only when there was one.
    expect(autoApprovalChatLine(judged('on', 'allow', 'hard-deny'))).toBe('Auto-approval: allowed 1, denied 0, parked 0, hard-denied 1')
  })

  it('Shadow: what the policy would have done', () => {
    expect(autoApprovalChatLine(judged('shadow', 'would-allow', 'would-allow', 'would-deny'))).toBe('Shadow: would allow 2, would deny 1, would park 0')
    expect(autoApprovalChatLine(judged('shadow', 'would-park', 'hard-deny'))).toBe('Shadow: would allow 0, would deny 0, would park 1, hard-denied 1')
  })

  it('a Run whose mode was switched names both, On first', () => {
    expect(autoApprovalChatLine([...judged('shadow', 'would-allow'), ...judged('on', 'allow')])).toBe('Auto-approval: allowed 1, denied 0, parked 0 · Shadow: would allow 1, would deny 0, would park 0')
  })
})
