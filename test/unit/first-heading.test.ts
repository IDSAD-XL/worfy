// firstHeading, worfy's reader of the H1, keeps the rule of the Ticket title in the Harness's epic-status
// (harness/bin/TICKETS.md, "Header"; worfy-harness ticket 71): the first "# " line on any line outside
// ``` and ~~~ fences. Both readers are tested on the same files, harness/bin/tests/fixtures/ticket-title,
// which harness/bin/tests/epic-status.test.sh writes into its fixture with CRLF line ends.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { firstHeading } from '../../src/main/workflow/reader'

const SHARED = join(__dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'ticket-title')
/** The title of each shared case; epic-status.test.sh expects the same ones. */
const TITLES: Record<string, string> = {
  '07-header-first.md': '07 — Header first',
  '08-fence-first.md': '08 — After the fences',
  '09-bom.md': '09 — Byte order mark',
  '10-a0-byte.md': '10 — Voilà',
  '11-tab-separator.md': '11 — Tab after the hash',
  '12-empty-heading.md': '12 — After empty headings',
  '13-nested-fence.md': '13 — After a nested fence',
  '14-tilde-in-backticks.md': '14 — After a tilde line in a backtick block',
  '15-info-string.md': '15 — After a fence closed by a bare line',
  '16-longer-close.md': '16 — After a longer closing fence',
}

describe('firstHeading: the shared cases of the Ticket title', () => {
  it('lists every shared case, so a new one is not read by one reader only', () => {
    expect(readdirSync(SHARED).sort()).toEqual(Object.keys(TITLES).sort())
  })

  for (const [file, title] of Object.entries(TITLES)) {
    it(`${file}: the same title with LF and with CRLF line ends`, () => {
      const lf = readFileSync(join(SHARED, file), 'utf8')
      expect(firstHeading(lf)).toBe(title)
      expect(firstHeading(lf.replace(/\n/gu, '\r\n'))).toBe(title)
    })
  }
})

describe('firstHeading: the rest of the rule', () => {
  it('gives null without an H1, and takes no "##" line for one', () => {
    expect(firstHeading('No heading\n\n## Only a section\n')).toBeNull()
    expect(firstHeading('')).toBeNull()
  })

  it('takes no H1 inside an unclosed fence', () => {
    expect(firstHeading('```\n# inside\n')).toBeNull()
  })
})
