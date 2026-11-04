// The Evidence of a Ticket: the lines under each item of its "done" section that say what proves the item and
// where it was checked, and the state each item reads as (verified, not verified with the reason, failed). worfy
// only reads them (ADR-0002): `ticket evidence` of the Harness writes them.
//
//   - [x] Unit test of the chat command
//     - evidence: test-run pass · `pnpm test test/unit/chat.test.ts` exit 0 · mac dev · 3f2a1b9c
//     - evidence: review pass · PR #1190 · - - · 3f2a1b9c
//   - [ ] (manual) The canvas on the PC
//     - needs: windows stable
//     - evidence: screenshot pass · `../evidence/16-canvas.webp` · windows installed · bacbbcef · scrub: 2026-11-04
//
// This is the second copy of the rules of harness/lib/evidence.cjs (spec of the worfy-evidence Epic, "Model"); the
// two are held together by test/contract/evidence-rules-agree.test.ts on the Harness's shared fixtures
// (harness/bin/tests/fixtures/evidence/). A change of a rule goes into both. Pure: no Node, no DOM.
import { accepted, DEFAULT_DOC_HEADINGS, escapeRegExp, OLD_DOC_HEADINGS, sectionHeadings, type DocHeadings } from './doc-headings'
import type { EvidenceItem, EvidenceLine, EvidenceNeeds } from './types'

export const KINDS = ['commit', 'test-run', 'ci-check', 'gate', 'review', 'screenshot', 'video', 'owner-check'] as const
export const VERDICTS = ['pass', 'fail'] as const
export const PLATFORMS = ['mac', 'windows', 'linux', 'ci'] as const
export const COPIES = ['stable', 'installed', 'dev', 'ci'] as const
/** The kinds that name no machine and no copy of the app: their platform and copy are always `-`. */
const NO_MACHINE: readonly string[] = ['commit', 'review']
/** The kinds that check the app itself: their copy is named. */
const COPY_REQUIRED: readonly string[] = ['screenshot', 'video', 'owner-check']
/** The kinds that prove a manual item: something a person has seen. A test run of an agent does not. */
const MANUAL_PROOF: readonly string[] = ['owner-check', 'screenshot', 'video']
const SEP = ' · '
const SHA = /^[0-9a-f]{7,40}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/
const CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+(.*)$/
const EVIDENCE = /^\s*[-*+]\s+evidence:(.*)$/
const NEEDS = /^\s*[-*+]\s+needs:(.*)$/
const HEADING = /^#{1,6}\s/
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/

/** The fields of an Evidence line before it is placed in a Ticket. */
export type EvidenceFields = Omit<EvidenceLine, 'line'>
/** The fields as a line gives them, before the rules: the verdict may be any word. */
type RawFields = Omit<EvidenceFields, 'verdict'> & { verdict: string }

const has = (list: readonly string[], value: string): boolean => list.includes(value)

/** Why `fields` is not an Evidence line; null when it is one. */
export function evidenceProblem(f: RawFields): string | null {
  if (!has(KINDS, f.kind)) return `kind is one of ${KINDS.join(', ')}, got "${f.kind}"`
  if (!has(VERDICTS, f.verdict)) return `verdict is pass or fail, got "${f.verdict}"`
  if (!f.ref.trim()) return 'ref is empty: a command with its exit code, PR #N, a URL or a path'
  // " · " splits the fields; a "·" next to a space at either end would merge with the separator.
  if (/\s·|·\s/.test(f.ref)) return `ref must not contain "${SEP}" — it splits the fields`
  if (/[\r\n]/.test(f.ref)) return 'ref must be one line'
  if (f.ref !== f.ref.trim()) return 'ref must not start or end with a space'
  if (has(NO_MACHINE, f.kind)) {
    if (f.platform !== '-' || f.copy !== '-') return `${f.kind} names no platform and no copy: "- -", got "${f.platform} ${f.copy}"`
  } else {
    if (!has(PLATFORMS, f.platform)) return `platform is one of ${PLATFORMS.join(', ')} ("-" only for ${NO_MACHINE.join(' and ')}), got "${f.platform}"`
    if (f.copy !== '-' && !has(COPIES, f.copy)) return `copy is one of ${COPIES.join(', ')} or "-", got "${f.copy}"`
    if (has(COPY_REQUIRED, f.kind) && f.copy === '-') return `${f.kind} names the copy of the app it checked: ${COPIES.join(', ')}`
  }
  if (!SHA.test(f.sha)) return `sha is 7 to 40 hex digits, got "${f.sha}"`
  if (f.scrub !== null && !DATE.test(f.scrub)) return `scrub is a date YYYY-MM-DD, got "${f.scrub}"`
  return null
}

/** The text of an Evidence line after `- evidence:`: its fields, or why it does not read. */
export function parseEvidenceLine(text: string): { fields: EvidenceFields } | { error: string } {
  const parts = text.trim().split(SEP)
  if (parts.length < 4 || parts.length > 5)
    return { error: `expected "<kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <date>]", got ${parts.length} field(s)` }
  const head = parts[0]!.trim().split(/\s+/)
  const machine = parts[2]!.trim().split(/\s+/)
  if (head.length !== 2) return { error: `the first field is "<kind> <verdict>", got "${parts[0]!.trim()}"` }
  if (machine.length !== 2) return { error: `the third field is "<platform> <copy>", got "${parts[2]!.trim()}"` }
  let scrub: string | null = null
  if (parts.length === 5) {
    const match = /^scrub:\s*(\S+)$/.exec(parts[4]!.trim())
    if (!match) return { error: `the fifth field is "scrub: <YYYY-MM-DD>", got "${parts[4]!.trim()}"` }
    scrub = match[1]!
  }
  const fields: RawFields = { kind: head[0]!, verdict: head[1]!, ref: parts[1]!.trim(), platform: machine[0]!, copy: machine[1]!, sha: parts[3]!.trim(), scrub }
  const problem = evidenceProblem(fields)
  // The rules have checked the verdict: it is pass or fail.
  return problem === null ? { fields: fields as EvidenceFields } : { error: problem }
}

/** `- needs: <platform> [<copy>]`, the text after the colon: the requirement, or why it does not read. */
function parseNeeds(text: string): { needs: EvidenceNeeds } | { error: string } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 2) return { error: `expected "<platform> [<copy>]", got "${text.trim()}"` }
  if (!has(PLATFORMS, words[0]!)) return { error: `needs: platform is one of ${PLATFORMS.join(', ')}, got "${words[0]}"` }
  if (words[1] !== undefined && !has(COPIES, words[1])) return { error: `needs: copy is one of ${COPIES.join(', ')}, got "${words[1]}"` }
  return { needs: { platform: words[0]!, copy: words[1] ?? null } }
}

/**
 * The code lines of a file fed in order, the rule of harness/lib/code-fence.cjs: a block opens with a line of
 * indentation and three or more ` or ~, and closes only with a line of the same character, at least as long,
 * followed by nothing but spaces and tabs. True for a fence line and for a line inside a block.
 */
function codeLines(): (line: string) => boolean {
  let open = ''
  return (line) => {
    const fence = FENCE.exec(line)
    if (open !== '') {
      if (fence && fence[1]![0] === open[0] && fence[1]!.length >= open.length && /^[ \t]*$/.test(fence[2]!)) open = ''
      return true
    }
    if (fence) {
      open = fence[1]!
      return true
    }
    return false
  }
}

/** An item as it is read, before its state. */
type ReadItem = Omit<EvidenceItem, 'state' | 'reason'>

/**
 * The state of an item and, when it is not verified, why:
 *   failed       — the last Evidence line of the item says fail;
 *   verified     — not failed, no unreadable line, and a pass line of a proving kind (any but review; for a manual
 *                  item only owner-check, screenshot and video) that matches `needs` by platform (and copy, if named);
 *   not-verified — the rest: "no evidence", "review only", "unreadable evidence line",
 *                  "manual item needs owner-check, screenshot or video", "needs <p> <c>, got <p> <c>".
 */
export function itemState(item: ReadItem): Pick<EvidenceItem, 'state' | 'reason'> {
  const lines = item.evidence
  if (lines.length && lines[lines.length - 1]!.verdict === 'fail') return { state: 'failed', reason: null }
  if (item.errors.length) return { state: 'not-verified', reason: 'unreadable evidence line' }
  if (!lines.length) return { state: 'not-verified', reason: 'no evidence' }
  const passed = lines.filter((line) => line.verdict === 'pass')
  const proofs = passed.filter((line) => line.kind !== 'review' && (!item.manual || has(MANUAL_PROOF, line.kind)))
  if (!proofs.length) {
    if (passed.length && passed.every((line) => line.kind === 'review')) return { state: 'not-verified', reason: 'review only' }
    if (item.manual) return { state: 'not-verified', reason: 'manual item needs owner-check, screenshot or video' }
    return { state: 'not-verified', reason: 'no evidence' }
  }
  if (item.needs) {
    const { platform, copy } = item.needs
    if (!proofs.some((line) => line.platform === platform && (copy === null || line.copy === copy))) {
      const got = proofs[proofs.length - 1]!
      return { state: 'not-verified', reason: `needs ${platform}${copy ? ` ${copy}` : ''}, got ${got.platform} ${got.copy}` }
    }
  }
  return { state: 'verified', reason: null }
}

/**
 * The checkbox items of the "done" section (the Profile's `tickets.done_section`, `## Done when` by default, and the
 * old Russian heading) in file order, each with its Evidence lines and its state. Every checkbox item of the
 * section, at any depth, is numbered from 1; an Evidence or needs line belongs to the nearest checkbox item above it.
 * An item's text is its text after the checkbox, with its continuation lines joined by one space. Lines in code
 * blocks are not read; a line that does not read goes into the item's `errors` as "line N: why".
 */
export function evidenceItems(markdown: string, headings: Pick<DocHeadings, 'doneSection' | 'manualMark'> = DEFAULT_DOC_HEADINGS): EvidenceItem[] {
  const pick = (value: string, fallback: string): string => value.trim() || fallback
  const done = sectionHeadings(accepted(pick(headings.doneSection, DEFAULT_DOC_HEADINGS.doneSection), OLD_DOC_HEADINGS.doneSection))
  const marks = accepted(pick(headings.manualMark, DEFAULT_DOC_HEADINGS.manualMark), OLD_DOC_HEADINGS.manualMark)
  const manual = new RegExp(`^\\((?:${marks.map(escapeRegExp).join('|')})(?:,[^)]*)?\\)`, 'u')
  const isCode = codeLines()
  const items: ReadItem[] = []
  let inSection = false
  let current: ReadItem | null = null // the item whose text continuation lines still join
  markdown
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const no = i + 1
      if (isCode(line)) {
        current = null
        return
      }
      if (HEADING.test(line)) {
        current = null
        inSection = done.at(line) ?? inSection
        return
      }
      if (!inSection) return
      const box = CHECKBOX.exec(line)
      if (box) {
        const text = box[3]!.trim()
        current = { index: items.length + 1, text, checked: box[2] !== ' ', manual: manual.test(text), needs: null, evidence: [], errors: [], line: no }
        items.push(current)
        return
      }
      const owner = items[items.length - 1]
      const evidence = EVIDENCE.exec(line)
      const needs = evidence ? null : NEEDS.exec(line)
      if ((evidence || needs) && owner) {
        current = null
        if (evidence) {
          const read = parseEvidenceLine(evidence[1]!)
          if ('error' in read) owner.errors.push(`line ${no}: ${read.error}`)
          else owner.evidence.push({ ...read.fields, line: no })
        } else {
          const read = parseNeeds(needs![1]!)
          if ('error' in read) owner.errors.push(`line ${no}: ${read.error}`)
          else if (owner.needs !== null) owner.errors.push(`line ${no}: a second needs line`)
          else owner.needs = read.needs
        }
        return
      }
      if (line.trim() === '' || LIST_ITEM.test(line)) {
        current = null
        return
      }
      if (current !== null) current.text += ` ${line.trim()}`
    })
  return items.map((item) => ({ ...item, ...itemState(item) }))
}

/** How many items are verified and failed, of all the items of the section (those without Evidence lines too). */
export function evidenceSummary(items: readonly Pick<EvidenceItem, 'state'>[]): { verified: number; total: number; failed: number } {
  return {
    verified: items.filter((item) => item.state === 'verified').length,
    total: items.length,
    failed: items.filter((item) => item.state === 'failed').length,
  }
}
