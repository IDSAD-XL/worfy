// The status block of an orchestrator answer: four lines that close a turn of work in the user's
// own workflow (~/.claude/CLAUDE.md, "Phase 3"):
//
//   — Этап: <stage>
//   — Сейчас: <what is true right now>
//   — Дальше: <the single next step>
//   — Жду: <what the agent needs from the user>
//
// The Orchestrator Node shows the last such block of the last answer, as written.

export interface StatusBlock {
  /** The four lines as written, without their indentation and trailing spaces, joined by \n. */
  text: string
  stage: string
  now: string
  next: string
  waiting: string
}

const LABELS = ['Этап', 'Сейчас', 'Дальше', 'Жду'] as const

// An em dash, an en dash or a hyphen, then a label and a colon; spaces around each are tolerated.
const LINE = /^[ \t]*([—–-][ \t]*(Этап|Сейчас|Дальше|Жду)[ \t]*:[ \t]*(.*?))[ \t]*$/u

interface BlockLine {
  /** Index of the label in LABELS. */
  label: number
  line: string
  value: string
}

function parseLine(line: string): BlockLine | null {
  const match = LINE.exec(line)
  if (!match) return null
  const [, written = '', label = '', value = ''] = match
  return { label: LABELS.indexOf(label as (typeof LABELS)[number]), line: written, value }
}

/**
 * Finds the last status block in an assistant's text: the four lines in order, each on its own
 * line, with nothing but blank lines between them. Returns null when there is none.
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
    if (parsed.label === current.length) {
      current.push(parsed)
    } else {
      // A line out of order ends the block being read; a stage line starts a new one.
      current = parsed.label === 0 ? [parsed] : []
    }
    if (current.length === LABELS.length) {
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
