// The rules of Evidence lines exist twice: in the Harness (harness/lib/evidence.cjs, used by `ticket evidence` and
// the warning of `ticket done`) and in worfy (src/shared/workflow/evidence.ts, read into the workflow model for the
// Ticket card and its matrix). A Ticket must read the same in both: the same items, the same Evidence lines, the
// same states and reasons. Both copies read the shared fixtures of the Harness here and must give the same answer,
// as the two copies of the Pipeline rules do (test/contract/pipeline-rules-agree.test.ts).
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COPIES, evidenceItems, KINDS, parseEvidenceLine, PLATFORMS, VERDICTS } from '../../src/shared/workflow/evidence'

interface HarnessItem {
  index: number
  text: string
  checked: boolean
  manual: boolean
  needs: { platform: string; copy: string | null } | null
  evidence: { kind: string; verdict: string; ref: string; platform: string; copy: string; sha: string; scrub: string | null; line: number }[]
  errors: string[]
  line: number
}

interface HarnessEvidenceRules {
  KINDS: string[]
  VERDICTS: string[]
  PLATFORMS: string[]
  COPIES: string[]
  parseEvidenceLine: (text: string) => { fields: Record<string, unknown> } | { error: string }
  parseDoneSection: (markdown: string, headings?: { doneSection?: string; manualMark?: string }) => HarnessItem[]
  itemState: (item: HarnessItem) => { state: string; reason?: string }
}

const harness = createRequire(join(process.cwd(), 'package.json'))('./harness/lib/evidence.cjs') as HarnessEvidenceRules

const FIXTURES = join(process.cwd(), 'harness', 'bin', 'tests', 'fixtures', 'evidence')

interface GrammarCase {
  text: string
  fields?: Record<string, unknown>
  error?: boolean
}

const grammar = (JSON.parse(readFileSync(join(FIXTURES, 'grammar.json'), 'utf8')) as { cases: GrammarCase[] }).cases

/** Every fixture Ticket of the Harness: `<language>/<file>.md`. */
const tickets = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((folder) =>
    readdirSync(join(FIXTURES, folder.name))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `${folder.name}/${name}`),
  )
  .sort()

/** The Harness's reading of a Ticket, in the shape of worfy's items. */
function harnessItems(markdown: string): unknown[] {
  return harness.parseDoneSection(markdown).map((item) => {
    const state = harness.itemState(item)
    return {
      index: item.index,
      text: item.text,
      checked: item.checked,
      manual: item.manual,
      needs: item.needs,
      evidence: item.evidence,
      errors: item.errors,
      line: item.line,
      state: state.state,
      reason: state.reason ?? null,
    }
  })
}

describe('the Evidence rules of the Harness and of worfy agree', () => {
  it('have the same catalogues of kinds, verdicts, platforms and copies', () => {
    expect([...KINDS]).toEqual(harness.KINDS)
    expect([...VERDICTS]).toEqual(harness.VERDICTS)
    expect([...PLATFORMS]).toEqual(harness.PLATFORMS)
    expect([...COPIES]).toEqual(harness.COPIES)
  })

  it('both know the kind video, and give a manual item without a proof the same reason', () => {
    expect(KINDS).toContain('video')
    expect(harness.KINDS).toContain('video')
    const markdown = ['## Done when', '', '- [ ] (manual) The card moves.', '  - evidence: test-run pass · `pnpm test` exit 0 · mac dev · abcdef1', ''].join('\n')
    const reason = 'manual item needs owner-check, screenshot or video'
    expect(evidenceItems(markdown).map((item) => item.reason)).toEqual([reason])
    expect(harnessItems(markdown)).toMatchObject([{ reason }])
  })

  it('the shared fixtures are there: the grammar cases and Tickets in both languages', () => {
    expect(grammar.length).toBeGreaterThanOrEqual(20)
    expect(tickets.some((name) => name.startsWith('en/'))).toBe(true)
    expect(tickets.some((name) => name.startsWith('ru/'))).toBe(true)
  })

  it.each(grammar.map((one) => [one.text, one] as const))('read the Evidence line "%s" the same way', (text, one) => {
    const ours = parseEvidenceLine(text)
    const theirs = harness.parseEvidenceLine(text)
    expect(ours).toEqual(theirs)
    // The fixture's own answer, so both copies cannot agree on a wrong one.
    if (one.error) expect(ours).toHaveProperty('error')
    else expect(ours).toEqual({ fields: one.fields })
  })

  it.each(tickets)('read the items, Evidence lines, states and reasons of the fixture Ticket %s the same way', (name) => {
    const markdown = readFileSync(join(FIXTURES, name), 'utf8')
    const ours = evidenceItems(markdown)
    expect(ours).toEqual(harnessItems(markdown))
    expect(ours.length).toBeGreaterThan(0)
  })

  it('give the same answer for the same Ticket with Windows line ends', () => {
    for (const name of tickets) {
      const markdown = readFileSync(join(FIXTURES, name), 'utf8').replace(/\n/g, '\r\n')
      expect(evidenceItems(markdown), name).toEqual(harnessItems(markdown))
    }
  })
})
