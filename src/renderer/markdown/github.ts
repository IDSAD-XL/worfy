// The GitHub-specific part of rendering a comment of a pull request (worfy-polish ticket 104), a remark plugin that
// Markdown.tsx runs only with its opt-in prop `github`: agent text elsewhere renders as before.
//
// - `@login` and `@org/team` become links to the person's or the team's page on github.com, styled as a mention.
// - `#123` becomes a link to that issue or PR of the PR's own repository, `owner/name#123` to that repository's;
//   github.com/<repo>/issues/<N> redirects to the PR when N is one.
// - An image becomes a link to its address with the alt text: nothing is fetched from the renderer. An image inside
//   a link stays an image node, which Markdown.tsx shows as its alt text (a link inside a link is not valid HTML).
// - An HTML comment `<!-- … -->` is dropped, as GitHub hides it; any other raw HTML stays text (Markdown.tsx).
//
// Text in code, in a link and in raw HTML is never touched, so an address or a code sample keeps its `#1` and `@x`.

interface MdNode {
  type: string
  value?: string
  url?: string
  alt?: string | null
  children?: MdNode[]
  data?: { hProperties?: Record<string, unknown> }
}

export interface GithubOptions {
  /** The PR's repository, `owner/name`; null when it is not known, and then a bare `#123` stays text. */
  repo: string | null
}

const REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/
/** Children of these are left as they are: code, links, and what is not prose. */
const UNTOUCHED = new Set(['link', 'linkReference', 'inlineCode', 'code', 'html', 'definition', 'image', 'imageReference'])

/**
 * A reference or a mention at a word's start: not after a letter, a digit, `_`, `@`, `/`, `#`, `.` or `-`, so an
 * e-mail address, a path or `a#1` is not one. Groups: 1 a repository of `owner/name#N`, 2 the number, 3 a login,
 * 4 a team after the login.
 */
const TOKEN = /(?<![\w@/#.-])(?:([A-Za-z0-9][\w.-]*\/[\w.-]+)?#([1-9]\d{0,9})(?![\w-])|@([A-Za-z0-9](?:-?[A-Za-z0-9]){0,38})(?:\/([A-Za-z0-9][\w-]*))?(?![\w-]))/g

const HTML_COMMENT = /^\s*<!--[\s\S]*?-->\s*$/

function link(url: string, text: string, className: string): MdNode {
  return { type: 'link', url, children: [{ type: 'text', value: text }], data: { hProperties: { className: [className] } } }
}

/** The text split into its text and its references and mentions as links. */
function tokens(value: string, repo: string | null): MdNode[] {
  const out: MdNode[] = []
  let at = 0
  for (const match of value.matchAll(TOKEN)) {
    const [whole, refRepo, number, login, team] = match
    let node: MdNode | null = null
    if (number !== undefined) {
      const target = refRepo ?? repo
      if (target !== null && REPO.test(target)) node = link(`https://github.com/${target}/issues/${number}`, whole, 'w-md__ref')
    } else if (login !== undefined) {
      const url = team === undefined ? `https://github.com/${login}` : `https://github.com/orgs/${login}/teams/${team}`
      node = link(url, whole, 'w-md__mention')
    }
    if (node === null) continue
    if (match.index > at) out.push({ type: 'text', value: value.slice(at, match.index) })
    out.push(node)
    at = match.index + whole.length
  }
  if (at === 0) return [{ type: 'text', value }]
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) })
  return out
}

function walk(node: MdNode, repo: string | null): void {
  if (!node.children) return
  const children: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') children.push(...tokens(child.value, repo))
    else if (child.type === 'html' && typeof child.value === 'string' && HTML_COMMENT.test(child.value)) continue
    else if (child.type === 'image' && typeof child.url === 'string') children.push(link(child.url, child.alt || 'image', 'w-md__image-link'))
    else {
      if (!UNTOUCHED.has(child.type)) walk(child, repo)
      children.push(child)
    }
  }
  node.children = children
}

/** remark plugin: mentions, issue references, images as links and hidden HTML comments, as GitHub shows a comment. */
export function remarkGithub(options: GithubOptions) {
  return (tree: MdNode): void => {
    walk(tree, options.repo)
  }
}

/** The text of a hast node and its children: the lines of a suggestion block. */
export function textOf(node: { type?: string; value?: unknown; children?: unknown[] } | undefined): string {
  if (node === undefined) return ''
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  return (node.children ?? []).map((child) => textOf(child as Parameters<typeof textOf>[0])).join('')
}
