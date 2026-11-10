import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
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
// relative path as a file of the Project in the default editor. A bare address in prose is a link
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
}: {
  href: string | undefined
  children: ReactNode
  projectId: string | undefined
  baseDir: string | undefined
  className?: string | undefined
}) {
  const target = classifyLink(href, baseDir)
  const file = useFileElsewhere()
  const [note, setNote] = useState<string | null>(null)
  if (target.kind === 'none') {
    return (
      <span className={className === undefined ? 'w-md__inert-link' : `w-md__inert-link ${className}`} title={href}>
        {children}
      </span>
    )
  }
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

export function Markdown({ text, projectId, baseDir, breaks = false, github }: MarkdownProps) {
  const githubRepo = github === undefined ? undefined : github.repo
  const plugins = useMemo<NonNullable<Options['remarkPlugins']>>(() => {
    const base = breaks ? PLUGINS_WITH_BREAKS : PLUGINS
    return githubRepo === undefined ? base : [...base, [remarkGithub, { repo: githubRepo }]]
  }, [breaks, githubRepo])
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, className }) => (
        <Link href={href} projectId={projectId} baseDir={baseDir} className={className}>
          {children}
        </Link>
      ),
      img: ({ alt, src }) => (
        <span className="w-md__image" title={typeof src === 'string' ? src : undefined}>
          {alt || 'image'}
        </span>
      ),
      ...(githubRepo === undefined
        ? {}
        : {
            pre: ({ node, children }) => {
              const code = node?.children[0]
              const classes = code?.type === 'element' ? code.properties.className : undefined
              if (Array.isArray(classes) && classes.includes('language-suggestion')) return <Suggestion text={textOf(code)} />
              return <pre>{children}</pre>
            },
          }),
    }),
    [projectId, baseDir, githubRepo],
  )
  return (
    <div className={githubRepo === undefined ? 'w-md' : 'w-md w-md--github'}>
      <ReactMarkdown remarkPlugins={plugins} components={components} urlTransform={keepWindowsPaths}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
