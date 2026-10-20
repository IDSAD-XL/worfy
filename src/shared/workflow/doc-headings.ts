// The headings and marks of a Project's workflow documents that worfy parses. The Project's Profile
// names them (`tickets.trail_section`, `tickets.done_section`, `tickets.manual_mark`,
// `docs.adr_status_label`; harness/profiles/README.md), so documents in any language are read; a
// Profile without them reads as the English defaults below.

export interface DocHeadings {
  /** The heading of a Ticket's section that lists its files, such as `## Where in code`. */
  trailSection: string
  /** The heading of a Ticket's section of the items that say it is done, such as `## Done when`. */
  doneSection: string
  /** The word in parentheses after the checkbox of a manual item of that section: `(manual)`. */
  manualMark: string
  /** The label before the colon of an ADR's status line: `Status: accepted.` */
  adrStatusLabel: string
}

export const DEFAULT_DOC_HEADINGS: Readonly<DocHeadings> = Object.freeze({
  trailSection: '## Where in code',
  doneSection: '## Done when',
  manualMark: 'manual',
  adrStatusLabel: 'Status',
})

// shortcut: accepts the old Russian token, remove after the next release (worfy-neutral 08)
// Until a Profile with documents in Russian names its own values, these are read as well as the
// Profile's, so an installed app keeps finding the sections of such a Project.
export const OLD_DOC_HEADINGS: Readonly<DocHeadings> = Object.freeze({
  trailSection: '## Где в коде',
  doneSection: '## Готово, когда',
  manualMark: 'вручную',
  adrStatusLabel: 'Статус',
})

/** The Profile's values over the defaults; a value that is missing or blank is the default's. */
export function docHeadings(given: Partial<DocHeadings> = {}): DocHeadings {
  const pick = (key: keyof DocHeadings): string => {
    const value = given[key]?.trim()
    return value ? value : DEFAULT_DOC_HEADINGS[key]
  }
  return { trailSection: pick('trailSection'), doneSection: pick('doneSection'), manualMark: pick('manualMark'), adrStatusLabel: pick('adrStatusLabel') }
}

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The values to look for: the given one and, while the old ones are read, the old one. */
export function accepted(value: string, old: string): string[] {
  return value === old ? [value] : [value, old]
}

/**
 * A section heading as a test of a line: `## Where in code` matches `##   Where in code  `. The
 * level is the number of `#` the value starts with; a value without any is a second-level heading.
 */
export interface HeadingMatch {
  level: number
  test: (line: string) => boolean
}

export function headingMatch(values: readonly string[]): HeadingMatch {
  const parsed = values.map((value) => {
    const match = /^(#{1,6})[ \t]+(.*?)[ \t]*$/u.exec(value.trim())
    return match ? { level: match[1]!.length, text: match[2]! } : { level: 2, text: value.trim() }
  })
  const level = Math.max(...parsed.map((each) => each.level))
  const patterns = parsed.map((each) => new RegExp(`^#{${each.level}}\\s+${escapeRegExp(each.text)}\\s*$`, 'u'))
  return { level, test: (line) => patterns.some((pattern) => pattern.test(line)) }
}
