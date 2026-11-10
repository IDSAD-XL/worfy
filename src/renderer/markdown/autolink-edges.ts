// A remark plugin, run after remark-gfm, that puts the right end on a bare address (worfy-polish
// ticket 101). remark-gfm turns `https://…` and `www.…` in prose into links (autolink literal) and
// already leaves a trailing `.`, `,`, `!`… and an unmatched `)` outside, but it counts a closing
// guillemet or curly quote as part of the address: in Russian text «https://github.com/a/b» links to
// `https://github.com/a/b%C2%BB`, a page that does not exist. This plugin moves such a closing mark
// off the end of the link, together with the punctuation it hid (`.»`), into the text after it.
// A guillemet stays when the address also holds its opening one (`https://x.y/«a»`). Only a link
// whose text is its own address is touched: a link written as `[text](url)` or `<url>` keeps the
// address its author wrote. Code is never reached: an address in code is not a link to begin with.

interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
}

/** Marks that close a quote or a sentence and are never the last character of an address someone meant. */
const CLOSING = new Set(['»', '”', '’', '›', '…'])
/** Punctuation remark-gfm leaves outside on its own, here only once a closing mark is off. */
const TRAILING = new Set(['.', ',', ':', ';', '!', '?', '"', "'"])
const OPENING_OF: Record<string, string> = { '»': '«', '›': '‹', '”': '“', '’': '‘' }

/** The length of the address without the closing marks and punctuation at its end. */
function keptLength(text: string): number {
  let end = text.length
  let closed = false
  while (end > 0) {
    const last = text.charAt(end - 1)
    const opening = OPENING_OF[last]
    if (CLOSING.has(last) && (opening === undefined || !text.slice(0, end).includes(opening))) closed = true
    else if (!(closed && TRAILING.has(last))) break
    end -= 1
  }
  return end
}

/** The address a bare-address link shows, when its text is that address (`www.` gets `http://`). */
function bareAddress(link: MdNode): string | null {
  const only = link.children?.length === 1 ? link.children[0] : undefined
  if (only?.type !== 'text' || typeof only.value !== 'string' || typeof link.url !== 'string') return null
  if (link.url === only.value) return only.value
  if (only.value.startsWith('www.') && link.url === `http://${only.value}`) return only.value
  return null
}

function trim(node: MdNode, source: string): void {
  if (!node.children) return
  const children: MdNode[] = []
  for (const child of node.children) {
    const shown = child.type === 'link' ? bareAddress(child) : null
    const end = shown === null || !written(child, shown, source) ? -1 : keptLength(shown)
    if (shown === null || end <= 0 || end === shown.length) {
      trim(child, source)
      children.push(child)
      continue
    }
    const kept = shown.slice(0, end)
    const url = child.url === shown ? kept : `http://${kept}`
    children.push({ ...child, url, children: [{ type: 'text', value: kept }] }, { type: 'text', value: shown.slice(end) })
  }
  node.children = merged(children)
}

/** Whether the link was written as a bare address, not as `<url>`: its source does not start with `<`. */
function written(link: MdNode, shown: string, source: string): boolean {
  const start = (link as { position?: { start?: { offset?: number } } }).position?.start?.offset
  if (typeof start !== 'number') return true
  return source.charAt(start) !== '<' && source.startsWith(shown, start)
}

/** Joins neighbouring text nodes, so the moved marks read as one run with the text after them. */
function merged(children: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  for (const child of children) {
    const previous = out[out.length - 1]
    if (previous?.type === 'text' && child.type === 'text') out[out.length - 1] = { ...previous, value: `${previous.value ?? ''}${child.value ?? ''}` }
    else out.push(child)
  }
  return out
}

/** remark plugin: the closing quote after a bare address is not part of the link. */
export function remarkAutolinkEdges() {
  return (tree: MdNode, file: { value?: unknown }): void => {
    trim(tree, typeof file.value === 'string' ? file.value : '')
  }
}
