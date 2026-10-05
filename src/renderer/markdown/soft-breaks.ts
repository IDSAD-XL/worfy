// A remark plugin that keeps the author's line breaks: a newline inside a paragraph becomes a line
// break instead of a space. Chat text is written that way (a status block is four lines with no
// blank line between them); GitHub-flavoured markdown alone would join them into one line.
// Code, inline code and HTML keep their text untouched: only `text` nodes are split.

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

function split(node: MdNode): void {
  if (!node.children) return
  const children: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('\n')) {
      child.value.split(/\r?\n/).forEach((line, index) => {
        if (index > 0) children.push({ type: 'break' })
        if (line !== '') children.push({ type: 'text', value: line })
      })
    } else {
      split(child)
      children.push(child)
    }
  }
  node.children = children
}

/** remark plugin: newlines in text become line breaks. */
export function remarkSoftBreaks() {
  return (tree: MdNode): void => {
    split(tree)
  }
}
