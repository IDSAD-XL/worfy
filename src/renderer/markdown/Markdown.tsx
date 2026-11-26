import { createContext, useContext, useMemo, useState, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { invoke } from '../ipc'
import { useFileElsewhere } from '../machines/useFileElsewhere'
import { revealedNote } from '../toast/revealed'
import { remarkAutolinkEdges } from './autolink-edges'
import { remarkGithub, textOf, type GithubOptions } from './github'
import { classifyLink, isWindowsPathLink } from './links'
import { remarkSoftBreaks } from '../../shared/markdown/soft-breaks'
import './markdown.css'

// The one markdown renderer of the app: the Session transcript (ticket 33), HANDOFF and ADRs
// (ticket 12). react-markdown with remark-gfm (tables, task lists, strikethrough, autolinks).
//
// Raw HTML is never executed: without rehype-raw, react-markdown turns every HTML node into
// plain text, so `<script>` or `<img onerror>` written by an agent is shown, not run. Markdown
// images are not loaded either: they would fetch from wherever the text points; the alt text is
// shown instead. Links open outside the window (links.ts): http:// and https:// in the browser, a
// relative path as a file of the Project in the default editor; without a Project a file link is inert
// text. With the opt-in prop `showLinkHost` an http(s):// link whose text is not its own address shows its
// host beside it (worfy-polish ticket 162). A bare address in prose is a link
// too (remark-gfm), with a closing quote after it left outside (autolink-edges.ts). Fonts and
// colours come from the theme tokens (markdown.css); a link stands out in the link / accent colour
// (worfy-polish ticket 101). In a window on a Linked machine a file link shows "File is on <Machine>"
// instead (machines/useFileElsewhere.ts), and an http(s):// link opens on this Machine. A link to a
// file that is not a document (`.command`, `.term`, `.app`, `.exe`…) is not opened unasked: main asks
// "Open", "Show in Finder" or "Cancel", and when it was shown the reason appears next to the link
// (toast/revealed.ts, worfy-polish ticket 35).
//
// With the opt-in prop `github` it reads a comment of a pull request as GitHub shows it (worfy-polish ticket 104):
// `@login` mentions, `#123` references, a ```suggestion block as a suggested change, an image as a link to it, and
// headings sized for a comment (github.ts, markdown.css `.w-md--github`). Without the prop nothing of that applies.
//
// With the opt-in prop `story` a ```story block is the code of a Code story fragment, with line numbers and key
// lines (StoryCode; the Story view, stories/StoryView.tsx, writes such blocks). The view may mark lines as selected
// (`storySelected`) and put something after a line (`storyAside`): a question about lines and its answers, worfy-code-stories
// ticket 12.

export interface MarkdownProps {
  text: string
  /** The Project whose files relative links point at; without one they open nothing. */
  projectId?: string | undefined
  /** Directory of the document relative to the Project root; relative links resolve against it. */
  baseDir?: string | undefined
  /** Keep single newlines as line breaks, as chat text means them (soft-breaks.ts). */
  breaks?: boolean
  /** Read the text as a GitHub comment of a PR in this repository (github.ts); off by default. */
  github?: GithubOptions | undefined
  /** Draw a ```story block as the code of a Code story fragment (StoryCode below); off by default. */
  story?: boolean
  /** The lines of a ```story block marked as selected, by their numbers; none when absent. */
  storySelected?: { from: number; to: number } | null | undefined
  /** What a ```story block shows after its line `line` (a question and its answers); nothing when it answers null. */
  storyAside?: ((line: number) => ReactNode) | undefined
  /**
   * Show the host of an http(s):// link beside it, muted, when the link's text is not its own address — «Approve
   * (evil.example)» — so text quoted from outside cannot name one address and open another (linkHost below). Off by
   * default; the Assistant's messages turn it on (worfy-polish ticket 162).
   */
  showLinkHost?: boolean
}

/** The host to show beside a link to `url` whose text is `text`; null when the text already names that address or host. */
export function linkHost(text: string, url: string): string | null {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  const shown = text.trim()
  if (shown === url || shown === target.href) return null
  // A text that reads as an address of the same host — with its scheme or without, as an autolinked `www.…` — names it.
  if (/^\S+$/u.test(shown)) {
    for (const candidate of [shown, `https://${shown}`]) {
      try {
        const named = new URL(candidate)
        if ((named.protocol === 'http:' || named.protocol === 'https:') && named.host === target.host) return null
      } catch {
        // not an address in this reading
      }
    }
  }
  return target.host
}

/** remark plugins: autolink-edges runs last, on the links remark-gfm made. */
const PLUGINS = [remarkGfm, remarkAutolinkEdges]
const PLUGINS_WITH_BREAKS = [remarkGfm, remarkSoftBreaks, remarkAutolinkEdges]

/**
 * react-markdown's own sanitising of a link or image address, except for an absolute Windows path
 * (`C:\…`, worfy-windows ticket 08), which it would blank as an unknown `c:` scheme. classifyLink
 * decides what such a path opens.
 */
const keepWindowsPaths = (url: string): string => (isWindowsPathLink(url) ? url : defaultUrlTransform(url))

function open(href: string | undefined, projectId: string | undefined, baseDir: string | undefined, note: (text: string) => void): void {
  const target = classifyLink(href, baseDir)
  // An http(s):// address opens on the Machine where it was clicked: `shell.openExternal` is `local`,
  // so a window on a Linked machine calls its own main (worfy-link ticket 12).
  if (target.kind === 'external') {
    void invoke('shell.openExternal', { url: target.url }).then((result) => {
      if (!result.ok) console.error('shell.openExternal failed:', result.error)
    })
  } else if (target.kind === 'file' && projectId !== undefined) {
    void invoke('shell.openInEditor', { projectId, path: target.path }).then((result) => {
      if (!result.ok) console.error('shell.openInEditor failed:', result.error)
      else if (result.value.revealedIn !== undefined) note(revealedNote(result.value.revealedIn))
    })
  }
}

function Link({
  href,
  children,
  projectId,
  baseDir,
  className,
  text,
  showHost,
}: {
  href: string | undefined
  children: ReactNode
  projectId: string | undefined
  baseDir: string | undefined
  className?: string | undefined
  /** The link's visible text, for showHost. */
  text: string
  showHost: boolean
}) {
  const target = classifyLink(href, baseDir)
  const file = useFileElsewhere()
  const [note, setNote] = useState<string | null>(null)
  // A file link without a Project opens nothing, so it does not look like a link either (review of worfy-polish ticket 162).
  if (target.kind === 'none' || (target.kind === 'file' && projectId === undefined)) {
    return (
      <span className={className === undefined ? 'w-md__inert-link' : `w-md__inert-link ${className}`} title={href}>
        {children}
      </span>
    )
  }
  const host = showHost && target.kind === 'external' ? linkHost(text, target.url) : null
  const onClick = (event: MouseEvent) => {
    // The window itself never navigates: the link always leaves through main.
    event.preventDefault()
    // A Project file lies on the window's Linked machine: the toast instead of its editor.
    if (target.kind === 'file' && projectId !== undefined && file.elsewhere) file.show()
    else open(href, projectId, baseDir, setNote)
  }
  return (
    <>
      <a href={href} className={className} title={target.kind === 'external' ? target.url : target.path} onClick={onClick}>
        {children}
      </a>
      {host !== null && <span className="w-md__link-host">({host})</span>}
      {note !== null && (
        <span className="w-md__link-note" role="status">
          {note}
        </span>
      )}
    </>
  )
}

/**
 * A ```suggestion block of a review comment: the lines the reviewer proposes, as added lines of a diff under the
 * label "Suggested change". The lines it replaces are not in the comment, so they are not shown. An empty block
 * proposes to delete the lines.
 */
function Suggestion({ text }: { text: string }) {
  const lines = text.replace(/\n$/, '').split('\n')
  const removes = text.trim() === ''
  return (
    <div className="w-md__suggestion" data-testid="md-suggestion">
      <div className="w-md__suggestion-label">Suggested change</div>
      {removes ? (
        <div className="w-md__suggestion-empty">Delete the lines</div>
      ) : (
        <pre className="w-md__suggestion-code">
          <code>
            {lines.map((line, at) => (
              <span key={at} className="w-md__suggestion-line">
                {line === '' ? '\u200b' : line}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  )
}

/** The first line and the key lines of a ```story block, from its info string: `story from=<n> key=<n>,<n>`. */
function storyMeta(meta: string): { from: number; keys: ReadonlySet<number> } {
  const from = /(?:^|\s)from=(\d+)(?:\s|$)/.exec(meta)
  const keys = /(?:^|\s)key=([\d,]+)(?:\s|$)/.exec(meta)
  return {
    from: from === null ? 1 : Math.max(1, Number(from[1])),
    keys: new Set((keys?.[1] ?? '').split(',').filter((part) => part !== '').map(Number)),
  }
}

/**
 * A ```story block of a Code story (Epic worfy-code-stories, ticket 09): the lines of a fragment, each with its
 * number in the file — counted on from `from=` — and the key lines (`key=`) highlighted: a bold number and a bar at
 * the left edge, so the mark is not a colour alone. No syntax colouring: worfy has no highlighting library, and the
 * first version does not need one (spec of the Epic).
 */
/** The selected lines and the asides of the ```story blocks of one Markdown: a context, so the block is not made anew when they change. */
const StoryLines = createContext<{ selected: { from: number; to: number } | null | undefined; aside: ((line: number) => ReactNode) | undefined }>({ selected: null, aside: undefined })

function StoryCode({ text, meta }: { text: string; meta: string }) {
  const { selected, aside } = useContext(StoryLines)
  const { from, keys } = storyMeta(meta)
  const lines = text.replace(/\n$/, '').split('\n')
  // The lines go in runs: a line with something after it ends its run, so the aside stands between two <pre> blocks.
  const runs: { lines: ReactNode[]; after: ReactNode; last: number }[] = [{ lines: [], after: null, last: from }]
  lines.forEach((line, at) => {
    const number = from + at
    const key = keys.has(number)
    const chosen = selected !== null && selected !== undefined && number >= selected.from && number <= selected.to
    runs.at(-1)!.lines.push(
      <span
        key={at}
        className={key ? 'w-md__story-line w-md__story-line--key' : 'w-md__story-line'}
        data-line={number}
        data-key={key ? 'true' : undefined}
        data-selected={chosen ? 'true' : undefined}
      >
        <span className="w-md__story-number" aria-hidden="true">
          {number}
        </span>
        <span className="w-md__story-text">{line === '' ? '​' : line}</span>
      </span>,
    )
    const after = aside?.(number) ?? null
    if (after !== null && after !== false && !(Array.isArray(after) && after.length === 0)) {
      runs.at(-1)!.after = after
      runs.at(-1)!.last = number
      if (at < lines.length - 1) runs.push({ lines: [], after: null, last: number + 1 })
    }
  })
  if (runs.length === 1 && runs[0]!.after === null) {
    return (
      <pre className="w-md__story-code" data-testid="md-story-code">
        <code>{runs[0]!.lines}</code>
      </pre>
    )
  }
  return (
    <div className="w-md__story-runs" data-testid="md-story-code">
      {runs.map((run) => (
        <div key={run.last} className="w-md__story-run">
          <pre className="w-md__story-code">
            <code>{run.lines}</code>
          </pre>
          {run.after === null ? null : <div className="w-md__story-aside">{run.after}</div>}
        </div>
      ))}
    </div>
  )
}

// The checkbox of a task list item ("- [x] tests") is named by the item's own text, without its nested
// lists: a form control needs a name (axe, rule label), and the text beside it is not a <label>.
const TaskItemText = createContext<string | undefined>(undefined)

type HastChild = { type?: string; tagName?: string; value?: unknown; children?: unknown[] }

/** The words of a list item, its nested lists left out. */
function itemText(node: HastChild | undefined): string {
  const own = (node?.children ?? []).filter((child) => {
    const tag = (child as HastChild).tagName
    return tag !== 'ul' && tag !== 'ol'
  })
  return own
    .map((child) => textOf(child as HastChild))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function TaskCheckbox({ node, ...rest }: InputHTMLAttributes<HTMLInputElement> & { node?: unknown }) {
  void node // react-markdown's syntax node: not an attribute of the element.
  const name = useContext(TaskItemText)
  return <input {...rest} aria-label={rest.type === 'checkbox' && name !== undefined && name !== '' ? name : rest['aria-label']} />
}

export function Markdown({ text, projectId, baseDir, breaks = false, github, story = false, storySelected, storyAside, showLinkHost = false }: MarkdownProps) {
  const githubRepo = github === undefined ? undefined : github.repo
  const storyLines = useMemo(() => ({ selected: storySelected, aside: storyAside }), [storySelected, storyAside])
  const plugins = useMemo<NonNullable<Options['remarkPlugins']>>(() => {
    const base = breaks ? PLUGINS_WITH_BREAKS : PLUGINS
    return githubRepo === undefined ? base : [...base, [remarkGithub, { repo: githubRepo }]]
  }, [breaks, githubRepo])
  const components = useMemo<Components>(
    () => ({
      a: ({ node, href, children, className }) => (
        <Link href={href} projectId={projectId} baseDir={baseDir} className={className} text={textOf(node as HastChild | undefined)} showHost={showLinkHost}>
          {children}
        </Link>
      ),
      li: ({ node, children, ...rest }) =>
        typeof rest.className === 'string' && rest.className.split(' ').includes('task-list-item') ? (
          <li {...rest}>
            <TaskItemText.Provider value={itemText(node as HastChild | undefined)}>{children}</TaskItemText.Provider>
          </li>
        ) : (
          <li {...rest}>{children}</li>
        ),
      input: TaskCheckbox,
      img: ({ alt, src }) => (
        <span className="w-md__image" title={typeof src === 'string' ? src : undefined}>
          {alt || 'image'}
        </span>
      ),
      ...(githubRepo === undefined && !story
        ? {}
        : {
            pre: ({ node, children }) => {
              const code = node?.children[0]
              const classes = code?.type === 'element' ? code.properties.className : undefined
              const language = (name: string) => Array.isArray(classes) && classes.includes(`language-${name}`)
              if (githubRepo !== undefined && language('suggestion')) return <Suggestion text={textOf(code)} />
              if (story && language('story')) {
                // The info string after the language: remark keeps it as the code element's `data.meta`.
                const meta = code?.type === 'element' ? (code.data as { meta?: unknown } | undefined)?.meta : undefined
                return <StoryCode text={textOf(code)} meta={typeof meta === 'string' ? meta : ''} />
              }
              return <pre>{children}</pre>
            },
          }),
    }),
    [projectId, baseDir, githubRepo, story, showLinkHost],
  )
  return (
    <div className={githubRepo === undefined ? 'w-md' : 'w-md w-md--github'}>
      <StoryLines.Provider value={storyLines}>
        <ReactMarkdown remarkPlugins={plugins} components={components} urlTransform={keepWindowsPaths}>
          {text}
        </ReactMarkdown>
      </StoryLines.Provider>
    </div>
  )
}
