// The Markdown of a Code story file read into the shapes of schema.ts (worfy-code-stories ticket 08): the story of a
// PR, `<Tickets root>/<epic>/stories/NN-<slug>.md`, and the story of an Epic, `<Tickets root>/<epic>/story.md`. The
// grammar is the Harness's, harness/bin/TICKETS.md, section "Code story", and its shared cases are
// harness/bin/tests/fixtures/code-story/: harness/bin/story-check reads the same files by the same rules.
//
// - The title is the first line, `# Code story — …`; the header the first non-empty line after it, `Key: value` fields
//   split by ` · `. A committed story names no commit; `Commit: <full sha>` is the header of a story kept outside git
//   (TICKETS.md, "Story anchor"). Both shapes are read; with `committed` a `Commit:` field is an error.
// - The body is split at the `##` headings (and `###` in an Epic story) outside fenced code blocks.
// - A field is a list item `- <label>: <value>`; its value goes on over the indented lines after it, joined by a space.
//   The labels, the frame titles and "not recorded" follow `Language:` (labels.json): `ru` the Russian words, any other
//   language the English ones.
// - The prose of a frame step is its lines as written, without its fragments and without its Requirement field.
//
// A file that does not fit gives the reason — the step and what is wrong with it, as story-check names them — and
// never an empty or partial story. Nothing here limits the size of a story.
import {
  storyFileSchema,
  storyLabels,
  STORY_FRAMES,
  type StoryChapter,
  type StoryFile,
  type StoryFragment,
  type StoryFrame,
  type StoryHandoff,
  type StoryLabels,
  type StoryLanguage,
  type StoryQuestion,
  type StoryStep,
} from './schema'

export type StoryParse = { ok: true; story: StoryFile } | { ok: false; reason: string }

const TITLE_PREFIX = 'Code story — '
const HEADER_KEYS = ['Kind', 'Epic', 'Ticket', 'PR', 'Language', 'Commit'] as const
const CODE_LINE = /^Code: `([^`]*)`(.*)$/u
const RANGE = /^(.+):(\d+)-(\d+)$/u
const KEY_LINES = /^ · key lines: (\d+(?:, *\d+)*)$/u
const FIELD = /^- ([^:]+): ?(.*)$/u
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u
const CHAPTER = /^PR (?:#(\d+)|-) · (\d{2}) — (.+)$/u
const STEP = /^(\d+)\. (.+)$/u
const HANDOFF = /^(\d{2}) (?:→|->) (\d{2})$/u
const DONE = / · done: (.*)$/u
const QUESTION = /^(\d+)\. (.*)$/u
const SUB_FIELD = /^\s+- ([^:]+): ?(.*)$/u

/** A problem of the file: where (the step, the section, the header) and what. */
class StoryFormatError extends Error {}

const fail = (where: string, what: string): never => {
  throw new StoryFormatError(`${where}: ${what}`)
}

function closesFence(line: string, open: string): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/u.exec(line)
  return match !== null && match[1]![0] === open[0] && match[1]!.length >= open.length
}

/** A `##` or `###` section: its heading's text and the lines under it, up to the next heading of a split level. */
interface Section {
  level: 2 | 3
  title: string
  lines: string[]
}

/** Splits `lines` at the headings of `levels` outside fenced blocks; the lines before the first heading are `lead`. */
function sections(lines: readonly string[], levels: readonly (2 | 3)[]): { lead: string[]; sections: Section[] } {
  const lead: string[] = []
  const found: Section[] = []
  let fence: string | null = null
  for (const line of lines) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null
    } else {
      const open = FENCE.exec(line)
      const heading = /^(#{2,3}) (.+?)\s*$/u.exec(line)
      if (open) fence = open[1]!
      else if (heading && levels.includes(heading[1]!.length as 2 | 3)) {
        found.push({ level: heading[1]!.length as 2 | 3, title: heading[2]!, lines: [] })
        continue
      }
    }
    ;(found.at(-1)?.lines ?? lead).push(line)
  }
  return { lead, sections: found }
}

/** What a body holds: its fragments, its fields (label → value), its `Ready:` line and the rest, the prose. */
interface Content {
  fragments: StoryFragment[]
  fields: Map<string, string>
  ready: string | null
  prose: string[]
}

/**
 * Reads the body of a step or a section. `fieldLabels` are the labels taken as fields; any other list item stays in
 * the prose, as it was written. Fenced blocks of the prose are kept whole: a line in them is never a field.
 */
function content(lines: readonly string[], fieldLabels: readonly string[], where: string): Content {
  const fragments: StoryFragment[] = []
  const fields = new Map<string, string>()
  const prose: string[] = []
  let ready: string | null = null
  let k = 0
  while (k < lines.length) {
    const line = lines[k]!
    const code = CODE_LINE.exec(line)
    if (code) {
      k = fragment(lines, k, code, where, fragments)
      continue
    }
    const open = FENCE.exec(line)
    if (open) {
      prose.push(line)
      k += 1
      while (k < lines.length && !closesFence(lines[k]!, open[1]!)) prose.push(lines[k++]!)
      if (k < lines.length) prose.push(lines[k++]!)
      continue
    }
    const item = FIELD.exec(line)
    if (item && fieldLabels.includes(item[1]!)) {
      let value = item[2]!
      let next = k + 1
      // A value goes on over the indented lines after it.
      while (next < lines.length && /^\s+\S/u.test(lines[next]!) && !FENCE.test(lines[next]!)) value += ` ${lines[next++]!.trim()}`
      if (fields.has(item[1]!)) fail(where, `the field "${item[1]!}" twice`)
      fields.set(item[1]!, value.trim())
      k = next
      continue
    }
    if (ready === null && line.startsWith('Ready: ')) ready = line.slice('Ready: '.length)
    else prose.push(line)
    k += 1
  }
  return { fragments, fields, ready, prose }
}

/** One fragment from the `Code:` line at `k`; answers the index after its block. */
function fragment(lines: readonly string[], k: number, code: RegExpExecArray, where: string, into: StoryFragment[]): number {
  const range = RANGE.exec(code[1]!)
  if (!range) return fail(where, `fragment "${code[1]!}" is not <path>:<from>-<to>`)
  const keys = KEY_LINES.exec(code[2]!)
  if (!keys) return fail(where, `fragment ${code[1]!}: the line does not end in " · key lines: <n>, <n>"`)
  let at = k + 1
  while (at < lines.length && lines[at]!.trim() === '') at += 1
  const open = at < lines.length ? /^(`{3,})[^`]*$/u.exec(lines[at]!) : null
  if (!open) return fail(where, `fragment ${code[1]!}: no fenced code block after the Code: line`)
  const block: string[] = []
  let end = at + 1
  while (end < lines.length && !closesFence(lines[end]!, open[1]!)) block.push(lines[end++]!)
  if (end >= lines.length) fail(where, `fragment ${code[1]!}: the code block is not closed`)
  into.push({
    path: range[1]!,
    startLine: Number(range[2]),
    endLine: Number(range[3]),
    keyLines: keys[1]!.split(',').map((n) => Number(n.trim())),
    code: block.join('\n'),
  })
  return end + 1
}

/**
 * The prose lines as one text: the lines as written, without the empty ones at either end, and one empty line where a
 * fragment taken out of the prose left several.
 */
function text(lines: readonly string[]): string {
  let from = 0
  let to = lines.length
  while (from < to && lines[from]!.trim() === '') from += 1
  while (to > from && lines[to - 1]!.trim() === '') to -= 1
  return lines
    .slice(from, to)
    .filter((line, index, all) => line.trim() !== '' || index === 0 || all[index - 1]!.trim() !== '')
    .join('\n')
}

const CODE_FIELDS = ['whatItDoes', 'whyHere', 'withoutIt', 'requirement', 'risks'] as const

/** The frame whose title is `title` in the story's words, or null for a code step. */
const frameOf = (title: string, labels: StoryLabels): StoryFrame | null => STORY_FRAMES.find((frame) => labels[frame] === title) ?? null

/** A step under the heading `<n>. <title>`: a frame step by its fixed title, otherwise a code step. */
function step(title: string, lines: readonly string[], labels: StoryLabels, where: string): StoryStep {
  const frame = frameOf(title, labels)
  if (frame !== null) {
    const body = content(lines, frame === 'wrong' ? [labels.requirement] : [], where)
    const requirement = frame === 'wrong' ? (body.fields.get(labels.requirement) ?? fail(where, `no field "${labels.requirement}"`)) : null
    const prose = text(body.prose)
    if (prose === '') fail(where, 'a frame step without text')
    return { kind: 'frame', frame, text: prose, requirement, fragments: body.fragments }
  }
  const body = content(
    lines,
    CODE_FIELDS.map((field) => labels[field]),
    where,
  )
  if (body.fragments.length !== 1) {
    fail(where, body.fragments.length === 0 ? 'a code step has no fragment (Code: `<path>:<from>-<to>` · key lines: …)' : `a code step has ${String(body.fragments.length)} fragments; it has exactly one`)
  }
  const field = (name: (typeof CODE_FIELDS)[number]): string => {
    const value = body.fields.get(labels[name])
    if (value === undefined) return fail(where, `no field "${labels[name]}"`)
    if (value === '') return fail(where, `the field "${labels[name]}" is empty`)
    return value
  }
  return {
    kind: 'code',
    title,
    fragment: body.fragments[0]!,
    whatItDoes: field('whatItDoes'),
    whyHere: field('whyHere'),
    withoutIt: field('withoutIt'),
    requirement: field('requirement'),
    risks: field('risks'),
  }
}

/** The questions of "Check yourself": `<n>. <question>`, each with the items `Answer:` and `Lines:`. */
function questions(lines: readonly string[], labels: StoryLabels, where: string): StoryQuestion[] {
  const found: { question: string; fields: Map<string, string>; last: string | null }[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    const question = QUESTION.exec(line)
    if (question) {
      found.push({ question: question[2]!.trim(), fields: new Map(), last: null })
      continue
    }
    const current = found.at(-1) ?? fail(where, `"${line.trim()}" stands before the first question`)
    const item = SUB_FIELD.exec(line)
    if (item) {
      current.fields.set(item[1]!, item[2]!.trim())
      current.last = item[1]!
    } else if (current.last !== null) current.fields.set(current.last, `${current.fields.get(current.last)!} ${line.trim()}`.trim())
    else current.question = `${current.question} ${line.trim()}`
  }
  return found.map((each, index) => {
    const at = `${where} ${String(index + 1)}`
    const answer = each.fields.get(labels.answer) ?? fail(at, `no item "${labels.answer}"`)
    const listed = each.fields.get(labels.lines) ?? fail(at, `no item "${labels.lines}"`)
    const quoted = [...listed.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!)
    const places = quoted.length > 0 ? quoted : listed.split(',').map((part) => part.trim()).filter(Boolean)
    return { question: each.question, answer, lines: places }
  })
}

/** The handoffs of "Seams between tickets": `- <NN> → <NN>: <what> · done: yes`, or `· done: no — <why>`. */
function seams(lines: readonly string[], where: string): { text: string; handoffs: StoryHandoff[] } {
  const handoffs: StoryHandoff[] = []
  const prose: string[] = []
  let k = 0
  while (k < lines.length) {
    const line = lines[k]!
    const item = FIELD.exec(line)
    const pair = item ? HANDOFF.exec(item[1]!) : null
    if (!item || !pair) {
      prose.push(line)
      k += 1
      continue
    }
    let value = item[2]!
    k += 1
    while (k < lines.length && /^\s+\S/u.test(lines[k]!)) value += ` ${lines[k++]!.trim()}`
    const label = `${pair[1]!} → ${pair[2]!}`
    const done = DONE.exec(value)
    if (!done) fail(where, `handoff ${label} has no "done:" field (· done: yes, or · done: no — <why>)`)
    const what = value.slice(0, done!.index).trim()
    if (what === '') fail(where, `handoff ${label} says nothing of what is handed over`)
    const verdict = done![1]!.trim()
    const dropped = /^no — (\S.*)$/u.exec(verdict)
    if (verdict !== 'yes' && !dropped) fail(where, `handoff ${label}: "done: ${verdict}" is not "done: yes" or "done: no — <why>"`)
    handoffs.push({ from: pair[1]!, to: pair[2]!, what, done: verdict === 'yes', why: dropped ? dropped[1]!.trim() : null })
  }
  return { text: text(prose), handoffs }
}

/** The header line: its fields by key. */
function header(line: string | undefined): Map<string, string> {
  if (line === undefined) return fail('header', 'no header line after the title')
  const fields = new Map<string, string>()
  for (const part of line.split(' · ')) {
    const match = /^([A-Za-z]+): (.*)$/u.exec(part)
    if (!match) fail('header', `"${part}" is not a "Key: value" field`)
    const key = match![1]!
    if (!(HEADER_KEYS as readonly string[]).includes(key)) fail('header', `unknown field "${key}"`)
    if (fields.has(key)) fail('header', `the field "${key}" twice`)
    fields.set(key, match![2]!.trim())
  }
  return fields
}

function prStory(title: string, fields: Map<string, string>, body: Section[], language: StoryLanguage, labels: StoryLabels, committed: boolean): StoryFile {
  const pr = fields.get('PR') ?? fail('header', 'no PR: field (#<N>, or - while the PR is not open)')
  if (!/^(#\d+|-)$/u.test(pr)) fail('header', `PR: "${pr}" is not #<N> or -`)
  const epic = fields.get('Epic') ?? null
  const ticket = fields.get('Ticket') ?? null
  if (ticket !== null && !/^\d{2}$/u.test(ticket)) fail('header', `Ticket: "${ticket}" is not two digits`)
  if ((epic === null) !== (ticket === null)) fail('header', 'Epic: and Ticket: go together: both for the PR of a ticket, neither for another PR')
  const commit = fields.get('Commit') ?? null
  if (commit !== null && committed) fail('header', 'a committed story names no commit (Commit:): its anchor is the commit that added it (TICKETS.md, Story anchor)')
  if (commit !== null && !/^[0-9a-f]{40}$/u.test(commit)) fail('header', `Commit: "${commit}" is not a full commit sha`)
  // The title after `<epic> <NN>: ` or `PR #<N>: `; the whole rest when it has neither.
  const lead = epic !== null && ticket !== null ? `${epic} ${ticket}: ` : null
  const name = lead !== null && title.startsWith(lead) ? title.slice(lead.length) : (/^PR #(?:\d+|-): (.+)$/u.exec(title)?.[1] ?? title)

  const steps: StoryStep[] = []
  let checkYourself: StoryQuestion[] = []
  let asked = false
  for (const section of body) {
    const numbered = STEP.exec(section.title)
    if (numbered) steps.push(step(numbered[2]!, section.lines, labels, `step ${numbered[1]!}`))
    else if (section.title === labels.checkYourself) {
      if (asked) fail(section.title, `a second "${labels.checkYourself}" section`)
      asked = true
      checkYourself = questions(section.lines, labels, labels.checkYourself)
    } else fail(`"${section.title}"`, `not a step ("## <n>. <title>") nor the section "${labels.checkYourself}"`)
  }
  if (steps.length === 0) fail('body', 'no steps')
  return {
    kind: 'pr',
    header: { title: name.trim(), epic, ticket, pr: pr === '-' ? null : Number(pr.slice(1)), language, commit },
    steps,
    checkYourself,
  }
}

function epicStory(fields: Map<string, string>, body: Section[], language: StoryLanguage, labels: StoryLabels): StoryFile {
  const epic = fields.get('Epic') ?? fail('header', 'no Epic: field')
  if (fields.has('Ticket')) fail('header', 'an epic story has no Ticket: field')
  if (fields.has('PR')) fail('header', 'an epic story has no PR: field')
  if (fields.has('Commit')) fail('header', 'an epic story names no Commit: each chapter is read against the story\'s anchor')

  let start: { text: string; requirement: string } | null = null
  const chapters: StoryChapter[] = []
  let seamsStep: { text: string; handoffs: StoryHandoff[] } | null = null
  let summary: string | null = null
  let check: string | null = null
  let checkYourself: StoryQuestion[] = []
  let chapter: StoryChapter | null = null
  for (const section of body) {
    const numbered = STEP.exec(section.title)
    if (section.level === 3) {
      if (chapter === null || !numbered) fail(`"${section.title}"`, chapter === null ? 'a "###" step stands only inside a chapter "## PR #<N> · <NN> — <title>"' : 'a "###" heading of a chapter is a step "### <n>. <title>"')
      if (!chapter!.ready) fail(`PR - · ${chapter!.ticket}`, 'a chapter that is not ready has no steps')
      chapter!.steps.push(step(numbered![2]!, section.lines, labels, `step ${numbered![1]!}`))
      continue
    }
    chapter = null
    const head = CHAPTER.exec(section.title)
    if (head) {
      const where = head[1] ? `PR #${head[1]}` : `PR - · ${head[2]!}`
      const own = content(section.lines, [], where)
      if (own.fragments.length > 0) fail(where, 'a fragment stands in a step of the chapter, not under its heading')
      const notReady = own.ready === null ? null : (/^no — (\S.*)$/u.exec(own.ready) ?? fail(where, 'the line is not "Ready: no — <why>"'))
      if (head[1] === undefined && notReady === null) fail(where, 'a chapter with "PR -" needs "Ready: no — <why>"')
      chapter = { ready: notReady === null, pr: head[1] ? Number(head[1]) : null, ticket: head[2]!, title: head[3]!.trim(), head: null, steps: [], why: notReady === null ? null : notReady[1]!.trim() }
      chapters.push(chapter)
      continue
    }
    if (numbered) {
      if (numbered[2] !== labels.seams) fail(`step ${numbered[1]!}`, `a "##" step of an epic story is "${labels.seams}"; the other steps are "###" inside a chapter`)
      seamsStep = seams(section.lines, `step ${numbered[1]!}`)
    } else if (section.title === labels.start) {
      const own = content(section.lines, [labels.requirement], labels.start)
      start = { text: text(own.prose), requirement: own.fields.get(labels.requirement) ?? fail(labels.start, `no field "${labels.requirement}"`) }
    } else if (section.title === labels.summary) summary = text(section.lines)
    else if (section.title === labels.check) check = text(section.lines)
    else if (section.title === labels.checkYourself) checkYourself = questions(section.lines, labels, labels.checkYourself)
    else fail(`"${section.title}"`, 'not a section of an epic story')
  }
  for (const each of chapters) if (each.ready && each.steps.length === 0) fail(`PR #${String(each.pr)}`, 'a chapter with no steps needs "Ready: no — <why>"')
  return {
    kind: 'epic',
    header: { epic, language },
    start: start ?? fail('body', `no section "${labels.start}"`),
    chapters: chapters.length > 0 ? chapters : fail('body', 'no section "## PR #<N> · <NN> — <title>"'),
    seams: seamsStep ?? fail('body', `no section "## <n>. ${labels.seams}"`),
    summary: summary ?? fail('body', `no section "${labels.summary}"`),
    check: check ?? fail('body', `no section "${labels.check}"`),
    checkYourself,
  }
}

export interface ParseOptions {
  /**
   * The file is committed with its change — in git or in the Workflow folder — so a `Commit:` field is an error, as
   * story-check says (TICKETS.md, "Header"). Without it both header shapes are read.
   */
  committed?: boolean
}

/** The story the Markdown `markdown` holds, or the reason it does not fit the format. */
export function parseStory(markdown: string, options: ParseOptions = {}): StoryParse {
  try {
    const lines = markdown
      .replace(/^\uFEFF/u, '')
      .split('\n')
      .map((line) => line.replace(/\r$/u, ''))
    let k = 0
    while (k < lines.length && lines[k]!.trim() === '') k += 1
    const title = lines[k] ?? ''
    if (!title.startsWith(`# ${TITLE_PREFIX}`)) fail('title', `the first line is not the title "# ${TITLE_PREFIX}…"`)
    k += 1
    while (k < lines.length && lines[k]!.trim() === '') k += 1
    const fields = header(lines[k])
    const kind = fields.get('Kind')
    if (kind !== 'pr' && kind !== 'epic') fail('header', `Kind: must be pr or epic, not "${kind ?? ''}"`)
    const code = fields.get('Language') ?? fail('header', 'no Language: field')
    // A story in `ru` uses the Russian words, any other language the English ones (TICKETS.md, "Labels").
    const language: StoryLanguage = code === 'ru' ? 'ru' : 'en'
    const labels = storyLabels(language)
    const { lead, sections: body } = sections(lines.slice(k + 1), kind === 'epic' ? [2, 3] : [2])
    if (lead.some((line) => line.trim() !== '')) fail('header', 'text between the header and the first section')
    const story = kind === 'pr' ? prStory(title.slice(2 + TITLE_PREFIX.length), fields, body, language, labels, options.committed === true) : epicStory(fields, body, language, labels)
    // The rules a line scan does not see — a key line outside its fragment, a Requirement that is no link.
    const checked = storyFileSchema.safeParse(story)
    if (!checked.success) {
      const issues = checked.error.issues.slice(0, 5).map((issue) => `${issue.path.length > 0 ? issue.path.map(String).join('.') : 'the story'}: ${issue.message}`)
      return { ok: false, reason: issues.join('; ') }
    }
    return { ok: true, story: checked.data }
  } catch (error) {
    if (error instanceof StoryFormatError) return { ok: false, reason: error.message }
    throw error
  }
}
