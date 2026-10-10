import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { invoke } from '../ipc'
import { useFileElsewhere } from '../machines/useFileElsewhere'
import { classifyLink, isWindowsPathLink } from './links'
import { remarkSoftBreaks } from './soft-breaks'
import './markdown.css'

// The one markdown renderer of the app: the Session transcript (ticket 33), HANDOFF and ADRs
// (ticket 12). react-markdown with remark-gfm (tables, task lists, strikethrough, autolinks).
//
// Raw HTML is never executed: without rehype-raw, react-markdown turns every HTML node into
// plain text, so `<script>` or `<img onerror>` written by an agent is shown, not run. Markdown
// images are not loaded either: they would fetch from wherever the text points; the alt text is
// shown instead. Links open outside the window (links.ts): https:// in the browser, a relative
// path as a file of the Project in the default editor. Fonts and colours come from the theme
// tokens (markdown.css). In a window on a Linked machine a file link shows "File is on <Machine>"
// instead (machines/useFileElsewhere.ts), and an https:// link opens on this Machine.

export interface MarkdownProps {
  text: string
  /** The Project whose files relative links point at; without one they open nothing. */
  projectId?: string | undefined
  /** Directory of the document relative to the Project root; relative links resolve against it. */
  baseDir?: string | undefined
  /** Keep single newlines as line breaks, as chat text means them (soft-breaks.ts). */
  breaks?: boolean
}

/**
 * react-markdown's own sanitising of a link or image address, except for an absolute Windows path
 * (`C:\…`, worfy-windows ticket 08), which it would blank as an unknown `c:` scheme. classifyLink
 * decides what such a path opens.
 */
const keepWindowsPaths = (url: string): string => (isWindowsPathLink(url) ? url : defaultUrlTransform(url))

/** The hint "File is on <Machine>" next to a file link in a window on a Linked machine. */
const hintStyle: CSSProperties = { marginLeft: 6, fontSize: 'var(--text-11)', color: 'var(--text-muted)' }

function open(href: string | undefined, projectId: string | undefined, baseDir: string | undefined): void {
  const target = classifyLink(href, baseDir)
  // An https:// address opens on the Machine where it was clicked: `shell.openExternal` is `local`,
  // so a window on a Linked machine calls its own main (worfy-link ticket 12).
  if (target.kind === 'external') {
    void invoke('shell.openExternal', { url: target.url }).then((result) => {
      if (!result.ok) console.error('shell.openExternal failed:', result.error)
    })
  } else if (target.kind === 'file' && projectId !== undefined) {
    void invoke('shell.openInEditor', { projectId, path: target.path }).then((result) => {
      if (!result.ok) console.error('shell.openInEditor failed:', result.error)
    })
  }
}

function Link({ href, children, projectId, baseDir }: { href: string | undefined; children: ReactNode; projectId: string | undefined; baseDir: string | undefined }) {
  const target = classifyLink(href, baseDir)
  const file = useFileElsewhere({ style: hintStyle })
  if (target.kind === 'none') {
    return (
      <span className="w-md__inert-link" title={href}>
        {children}
      </span>
    )
  }
  const onClick = (event: MouseEvent) => {
    // The window itself never navigates: the link always leaves through main.
    event.preventDefault()
    // A Project file lies on the window's Linked machine: the hint instead of its editor.
    if (target.kind === 'file' && projectId !== undefined && file.elsewhere) file.show()
    else open(href, projectId, baseDir)
  }
  return (
    <>
      <a href={href} title={target.kind === 'external' ? target.url : target.path} onClick={onClick}>
        {children}
      </a>
      {file.hint}
    </>
  )
}

export function Markdown({ text, projectId, baseDir, breaks = false }: MarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <Link href={href} projectId={projectId} baseDir={baseDir}>
          {children}
        </Link>
      ),
      img: ({ alt, src }) => (
        <span className="w-md__image" title={typeof src === 'string' ? src : undefined}>
          {alt || 'image'}
        </span>
      ),
    }),
    [projectId, baseDir],
  )
  return (
    <div className="w-md">
      <ReactMarkdown remarkPlugins={breaks ? [remarkGfm, remarkSoftBreaks] : [remarkGfm]} components={components} urlTransform={keepWindowsPaths}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
