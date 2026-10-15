// The manual checks of a Ticket: the items of its "Готово, когда" section that a person ticks off,
// marked `(вручную)` right after the checkbox. worfy only reads them (ADR-0002): an item is ticked
// by editing the Ticket file, never from worfy.
import type { ManualCheck } from './types'

const DONE_HEADING = /^##\s+Готово, когда\s*$/u
const FENCE = /^\s*(```|~~~)/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/
// `(вручную)`, or `(вручную, <who or when>)`: "(вручную, владелец)", "(вручную, после влития)".
const MANUAL_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+\(вручную(?:,\s*([^)]*))?\)(.*)$/u

/**
 * The `(вручную)` items of the "Готово, когда" section, in file order. An item's continuation lines
 * (up to a blank line, the next list item or a heading) are joined to its text with one space. The
 * note of `(вручную, <note>)` stays at the start of the text as `(<note>)`.
 * Other sections, items where `(вручную)` is not the first word and code fences are not read.
 */
export function manualChecks(markdown: string): ManualCheck[] {
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
      if (/^#{1,2}\s/.test(line)) inSection = DONE_HEADING.test(line)
      continue
    }
    if (!inSection) continue
    if (LIST_ITEM.test(line)) {
      close()
      const manual = MANUAL_ITEM.exec(line)
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
