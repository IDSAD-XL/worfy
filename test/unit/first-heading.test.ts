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
  it('skips a byte order mark at the start, as epic-status does (its case 09-bom.md)', () => {
    expect(firstHeading('﻿# 09 — Byte order mark\r\n\r\nStatus: open\r\n')).toBe('09 — Byte order mark')
  })

  it('drops trailing spaces and tabs, and takes no "##", "#word" or empty "# " line for the H1', () => {
    expect(firstHeading('# Epic title \t\n')).toBe('Epic title')
    expect(firstHeading('## Section\n#word\n#  \n\n#\tTabbed title\n# Second\n')).toBe('Tabbed title')
    expect(firstHeading('No heading\n\n## Only a section\n')).toBeNull()
    expect(firstHeading('')).toBeNull()
  })

  it('takes no H1 inside an unclosed fence', () => {
    expect(firstHeading('```\n# inside\n')).toBeNull()
  })
})
