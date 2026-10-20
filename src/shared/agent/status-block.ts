// The status block of an orchestrator answer: four lines that close a turn of work
// (harness/hooks/rules/orchestrator.md, "Phase 3"):
//
//   — Stage: <stage>
//   — Now: <what is true right now>
//   — Next: <the single next step>
//   — Waiting: <what the agent needs from the user>
//
// The labels are fixed English tokens whatever language the values are in. The Orchestrator Node
// shows the last such block of the last answer, as written.

export interface StatusBlock {
  /** The four lines as written, without their indentation and trailing spaces, joined by \n. */
  text: string
  stage: string
  now: string
  next: string
  waiting: string
}

// shortcut: accepts the old Russian token, remove after the next release (worfy-neutral 08)
const LABEL_SETS = [
  ['Stage', 'Now', 'Next', 'Waiting'],
  ['Этап', 'Сейчас', 'Дальше', 'Жду'],
] as const

const BLOCK_SIZE = 4

// An em dash, an en dash or a hyphen, then a label and a colon; spaces around each are tolerated.
const LINE = new RegExp(
  `^[ \\t]*([—–-][ \\t]*(${LABEL_SETS.flat().join('|')})[ \\t]*:[ \\t]*(.*?))[ \\t]*$`,
  'u',
)

interface BlockLine {
  /** Index of the label set the line's label belongs to. */
  set: number
  /** Index of the label within its set. */
  label: number
  line: string
  value: string
}

function parseLine(line: string): BlockLine | null {
  const match = LINE.exec(line)
  if (!match) return null
  const [, written = '', label = '', value = ''] = match
  const set = LABEL_SETS.findIndex((labels) => (labels as readonly string[]).includes(label))
  return { set, label: (LABEL_SETS[set] as readonly string[]).indexOf(label), line: written, value }
}

/**
 * Finds the last status block in an assistant's text: the four lines in order, each on its own
 * line, with nothing but blank lines between them, all four labels from one set. Returns null when
 * there is none.
 */
export function findStatusBlock(text: string): StatusBlock | null {
  let found: BlockLine[] | null = null
  let current: BlockLine[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const parsed = parseLine(line)
    if (parsed === null) {
      current = []
      continue
    }
    if (parsed.label === current.length && (current.length === 0 || parsed.set === current[0]?.set)) {
      current.push(parsed)
    } else {
      // A line out of order, or with a label of the other set, ends the block being read; a stage
      // line starts a new one.
      current = parsed.label === 0 ? [parsed] : []
    }
    if (current.length === BLOCK_SIZE) {
      found = current
      current = []
    }
  }
  if (found === null) return null
  const [stage, now, next, waiting] = found as [BlockLine, BlockLine, BlockLine, BlockLine]
  return {
    text: found.map((line) => line.line).join('\n'),
    stage: stage.value,
    now: now.value,
    next: next.value,
    waiting: waiting.value,
  }
}
