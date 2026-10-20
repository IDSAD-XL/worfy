// The manual checks of a Ticket: the items of its "done" section (`tickets.done_section` of the
// Profile, `## Done when` by default) that a person ticks off, marked `(<mark>)` right after the
// checkbox (`tickets.manual_mark`, `manual` by default). worfy only reads them (ADR-0002): an item is
// ticked by editing the Ticket file, never from worfy.
import { accepted, DEFAULT_DOC_HEADINGS, escapeRegExp, OLD_DOC_HEADINGS, sectionHeadings, type DocHeadings } from './doc-headings'
import type { ManualCheck } from './types'

const FENCE = /^\s*(```|~~~)/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

/** `(<mark>)`, or `(<mark>, <who or when>)`: "(manual, owner)", "(manual, after the merge)". */
function manualItem(marks: readonly string[]): RegExp {
  return new RegExp(`^\\s*(?:[-*+]|\\d+[.)])\\s+\\[([ xX])\\]\\s+\\((?:${marks.map(escapeRegExp).join('|')})(?:,\\s*([^)]*))?\\)(.*)$`, 'u')
}

/**
 * The `(<mark>)` items of the "done" section, in file order. An item's continuation lines (up to a
 * blank line, the next list item or a heading) are joined to its text with one space. The note of
 * `(<mark>, <note>)` stays at the start of the text as `(<note>)`.
 * Other sections, items where the mark is not the first word and code fences are not read.
 */
export function manualChecks(markdown: string, headings: Pick<DocHeadings, 'doneSection' | 'manualMark'> = DEFAULT_DOC_HEADINGS): ManualCheck[] {
  const done = sectionHeadings(accepted(headings.doneSection, OLD_DOC_HEADINGS.doneSection))
  const manualItemOf = manualItem(accepted(headings.manualMark, OLD_DOC_HEADINGS.manualMark))
  const checks: ManualCheck[] = []
  let inFence = false
  let inSection = false
  let current: { parts: string[]; checked: boolean } | null = null
  const close = (): void => {
    if (current !== null) checks.push({ text: current.parts.filter((part) => part !== '').join(' '), checked: current.checked })
    current = null
  }
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (FENCE.test(line)) {
      close()
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s/.test(line)) {
      close()
      inSection = done.at(line) ?? inSection
      continue
    }
    if (!inSection) continue
    if (LIST_ITEM.test(line)) {
      close()
      const manual = manualItemOf.exec(line)
      if (manual) {
        const note = manual[2]?.trim()
        current = { parts: [note ? `(${note}) ${manual[3]!.trim()}` : manual[3]!.trim()], checked: manual[1] !== ' ' }
      }
      continue
    }
    if (line.trim() === '') close()
    else if (current !== null) current.parts.push(line.trim())
  }
  close()
  return checks
}
