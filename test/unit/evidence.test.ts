// The Evidence of a Ticket as worfy reads it (src/shared/workflow/evidence.ts): the state of an item by every rule
// of the worfy-evidence spec ("Model", "State of an item"), the summary "n of m", and what the reader skips. The
// agreement with the Harness's copy of the rules is test/contract/evidence-rules-agree.test.ts.
import { describe, expect, it } from 'vitest'
import { evidenceItems, evidenceSummary } from '../../src/shared/workflow/evidence'

const SHA = 'abcdef1'
const line = (kind: string, verdict: string, where: string, extra = ''): string => {
  const ref = kind === 'review' ? 'PR #12' : kind === 'screenshot' ? '`../evidence/05-a.webp`' : '`pnpm test` exit 0'
  return `  - evidence: ${kind} ${verdict} · ${ref} · ${where} · ${SHA}${extra}`
}

/** A Ticket with one item of the done section and the lines under it. */
const ticket = (item: string, ...under: string[]): string => ['# 05 — A ticket', '', 'Status: open', '', '## Done when', '', `- [ ] ${item}`, ...under, ''].join('\n')

const stateOf = (markdown: string): { state: string; reason: string | null } => {
  const items = evidenceItems(markdown)
  expect(items).toHaveLength(1)
  return { state: items[0]!.state, reason: items[0]!.reason }
}

describe('evidence: the state of an item', () => {
  it.each([
    ['no Evidence line', ticket('An item.'), 'not-verified', 'no evidence'],
    ['a passing test run', ticket('An item.', line('test-run', 'pass', 'mac dev')), 'verified', null],
    ['the last line fails', ticket('An item.', line('test-run', 'pass', 'mac dev'), line('test-run', 'fail', 'mac dev')), 'failed', null],
    ['a fail followed by a pass is not failed', ticket('An item.', line('test-run', 'fail', 'mac dev'), line('test-run', 'pass', 'mac dev')), 'verified', null],
    ['a failing review as the last line', ticket('An item.', line('test-run', 'pass', 'mac dev'), line('review', 'fail', '- -')), 'failed', null],
    ['review only', ticket('An item.', line('review', 'pass', '- -')), 'not-verified', 'review only'],
    ['a commit proves an item that is not manual', ticket('An item.', line('commit', 'pass', '- -')), 'verified', null],
    ['needs met by platform', ticket('An item.', '  - needs: windows', line('test-run', 'pass', 'windows dev')), 'verified', null],
    ['needs met by platform and copy', ticket('An item.', '  - needs: windows stable', line('test-run', 'pass', 'windows stable')), 'verified', null],
    ['needs another platform', ticket('An item.', '  - needs: windows', line('test-run', 'pass', 'mac dev')), 'not-verified', 'needs windows, got mac dev'],
    [
      'needs another copy (the case of worfy-windows 16)',
      ticket('(manual) The canvas on the PC.', '  - needs: windows stable', line('screenshot', 'pass', 'windows installed', ' · scrub: 2026-11-04')),
      'not-verified',
      'needs windows stable, got windows installed',
    ],
    ['one of several proofs meets needs', ticket('An item.', '  - needs: linux', line('test-run', 'pass', 'mac dev'), line('test-run', 'pass', 'linux -')), 'verified', null],
    ['a manual item with a test run only', ticket('(manual) The owner looks.', line('test-run', 'pass', 'mac dev')), 'not-verified', 'manual item needs owner-check or screenshot'],
    ['a manual item with a review only', ticket('(manual) The owner looks.', line('review', 'pass', '- -')), 'not-verified', 'review only'],
    ['a manual item the owner checked', ticket('(manual, owner) The owner looks.', '  - evidence: owner-check pass · 2026-11-04 owner said ok · mac stable · abcdef1'), 'verified', null],
    ['a manual item with a screenshot', ticket('(manual) The owner looks.', line('screenshot', 'pass', 'mac stable', ' · scrub: 2026-11-04')), 'verified', null],
    ['an unreadable line beside a pass', ticket('An item.', line('test-run', 'pass', 'mac dev'), '  - evidence: test-run VERIFIED · x · mac dev · abcdef1'), 'not-verified', 'unreadable evidence line'],
    ['an unreadable needs line', ticket('An item.', '  - needs: bsd', line('test-run', 'pass', 'mac dev')), 'not-verified', 'unreadable evidence line'],
    ['an unreadable line does not hide a fail', ticket('An item.', '  - evidence: nonsense', line('test-run', 'fail', 'mac dev')), 'failed', null],
  ])('%s', (_name, markdown, state, reason) => {
    expect(stateOf(markdown)).toEqual({ state, reason })
  })
})

describe('evidence: what is read', () => {
  it('reads the fields of an Evidence line and its line in the file', () => {
    const [item] = evidenceItems(ticket('An item.', line('screenshot', 'pass', 'windows installed', ' · scrub: 2026-11-04')))
    expect(item).toMatchObject({ index: 1, text: 'An item.', checked: false, manual: false, needs: null, errors: [], line: 7 })
    expect(item!.evidence).toEqual([{ kind: 'screenshot', verdict: 'pass', ref: '`../evidence/05-a.webp`', platform: 'windows', copy: 'installed', sha: SHA, scrub: '2026-11-04', line: 8 }])
  })

  it('says why a line does not read, with its line number', () => {
    const [item] = evidenceItems(ticket('An item.', '  - evidence: test-run pass · `x` exit 0 · mac dev', '  - needs: windows', '  - needs: mac'))
    expect(item!.errors).toEqual([
      'line 8: expected "<kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <date>]", got 3 field(s)',
      'line 10: a second needs line',
    ])
    expect(item!.needs).toEqual({ platform: 'windows', copy: null })
  })

  it('skips the lines of a code fence: an item and an Evidence line inside one are not read', () => {
    const markdown = ticket('An item.', line('test-run', 'pass', 'mac dev'), '', '```text', '- [ ] Not an item.', line('test-run', 'fail', 'mac dev'), '```', '', '~~~', '  - evidence: nonsense', '~~~')
    const items = evidenceItems(markdown)
    expect(items.map((item) => [item.text, item.state, item.errors])).toEqual([['An item.', 'verified', []]])
  })

  it('a fence line that does not close the block keeps the lines after it code', () => {
    const markdown = ticket('An item.', '````', '```', '- [ ] Still code.', '````', '- [ ] After the block.')
    expect(evidenceItems(markdown).map((item) => item.text)).toEqual(['An item.', 'After the block.'])
  })

  it('numbers every checkbox item of the section at any depth; a line belongs to the nearest item above it', () => {
    const markdown = ticket('Parent item.', '  - [x] Child item.', '    - evidence: test-run pass · `t` exit 0 · linux - · abcdef1', '- [ ] Last item.')
    const items = evidenceItems(markdown)
    expect(items.map((item) => [item.index, item.text, item.checked, item.state])).toEqual([
      [1, 'Parent item.', false, 'not-verified'],
      [2, 'Child item.', true, 'verified'],
      [3, 'Last item.', false, 'not-verified'],
    ])
  })

  it('joins continuation lines to the text, but not the lines after an Evidence line', () => {
    const markdown = ticket('An item, its text goes on', '      on a continuation line.', line('test-run', 'pass', 'mac dev'), '      not text of the item.')
    expect(evidenceItems(markdown)[0]!.text).toBe('An item, its text goes on on a continuation line.')
  })

  it('reads only the done section: other sections, and the old Russian heading as well as the given one', () => {
    const markdown = ['## What we do', '', '- [ ] Not an item.', '', '## Готово, когда', '', '- [ ] (вручную) Old heading.', '', '## Result', '', '- [ ] Not an item either.'].join('\n')
    expect(evidenceItems(markdown).map((item) => [item.text, item.manual])).toEqual([['(вручную) Old heading.', true]])
    const named = ['## Fertig, wenn', '', '- [ ] (von Hand) Ein Punkt.'].join('\n')
    expect(evidenceItems(named, { doneSection: '## Fertig, wenn', manualMark: 'von Hand' }).map((item) => [item.text, item.manual])).toEqual([['(von Hand) Ein Punkt.', true]])
    expect(evidenceItems(named)).toEqual([])
  })

  it('a Ticket without the section has no items', () => {
    expect(evidenceItems('# 05 — A ticket\n\nStatus: open\n')).toEqual([])
  })
})

describe('evidenceSummary', () => {
  it('counts verified and failed items of all items, those without Evidence lines too', () => {
    const markdown = [
      '## Done when',
      '',
      '- [x] Verified.',
      line('test-run', 'pass', 'mac dev'),
      '- [x] Failed.',
      line('test-run', 'fail', 'mac dev'),
      '- [ ] No lines.',
      '- [ ] Review only.',
      line('review', 'pass', '- -'),
    ].join('\n')
    expect(evidenceSummary(evidenceItems(markdown))).toEqual({ verified: 1, total: 4, failed: 1 })
    expect(evidenceSummary([])).toEqual({ verified: 0, total: 0, failed: 0 })
  })
})
