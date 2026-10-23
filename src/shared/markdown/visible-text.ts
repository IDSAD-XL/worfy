// The text a markdown message shows on screen: what find in a Session's transcript (worfy-ui
// ticket 26) counts in Claude's answers, so «N of M» counts what is painted. `[docs](https://…)`
// shows «docs», `**foo** bar` shows «foo bar».
//
// The pipeline is the one react-markdown runs for the transcript (src/renderer/markdown/Markdown.tsx:
// remark-parse, remark-gfm, the soft breaks, remark-rehype with HTML kept), and the text is joined the
// way the page joins its text nodes: no separator between elements, the «\n» kept between blocks,
// HTML as its text (react-markdown shows it, never runs it), no blank text inside a table (React
// drops it there), an image as its alt text or «image» (Markdown.tsx draws it so). React itself is
// not used: main imports this too. test/unit/session-find.test.tsx compares it with the page.
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { remarkSoftBreaks } from './soft-breaks'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkSoftBreaks).use(remarkRehype, { allowDangerousHtml: true })

/** Elements whose blank text React leaves out (hast-util-to-jsx-runtime). */
const TABLE = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr'])
const BLANK = /^[ \t\n\f\r]*$/

function walk(node: HastNode, out: string[]): void {
  if (node.type === 'text' || node.type === 'raw') {
    out.push(node.value ?? '')
    return
  }
  if (node.type !== 'root' && node.type !== 'element') return
  if (node.tagName === 'img') {
    const alt = node.properties?.['alt']
    out.push(typeof alt === 'string' && alt !== '' ? alt : 'image')
    return
  }
  const table = node.tagName !== undefined && TABLE.has(node.tagName)
  for (const child of node.children ?? []) {
    if (table && (child.type === 'text' || child.type === 'raw') && BLANK.test(child.value ?? '')) continue
    walk(child, out)
  }
}

/** Texts kept, the last ones used: a transcript asks for the same answers on each keystroke. */
const CACHED = 4096
const cache = new Map<string, string>()

/** The text `markdown` shows in the transcript (Markdown with `breaks`). */
export function markdownText(markdown: string): string {
  const known = cache.get(markdown)
  if (known !== undefined) {
    // Used again: it goes to the end, away from the next eviction.
    cache.delete(markdown)
    cache.set(markdown, known)
    return known
  }
  const out: string[] = []
  walk(processor.runSync(processor.parse(markdown)) as HastNode, out)
  const text = out.join('')
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value as string)
  cache.set(markdown, text)
  return text
}

/**
 * False when `markdown` cannot show `needle` (lower case): the letters of what is shown are the
 * letters of the source, in order, less the markup. An entity (`&#65;`), an image (its «image») and
 * a footnote (its number and «Footnotes») show letters the source may not have: always true then.
 */
export function mayShow(markdown: string, needle: string): boolean {
  if (markdown.includes('&') || markdown.includes('![') || markdown.includes('[^')) return true
  const source = markdown.toLowerCase()
  let at = 0
  for (const char of needle) {
    // Spaces are passed over: lenient here costs one parse, never a missed match.
    if (char === ' ' || char === '\t') continue
    at = source.indexOf(char, at)
    if (at === -1) return false
    at += char.length
  }
  return true
}
