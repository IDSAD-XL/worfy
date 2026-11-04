import type { MouseEvent, ReactNode } from 'react'
import { evidenceSummary } from '../../../shared/workflow/evidence'
import type { EvidenceItem, EvidenceLine, Ticket } from '../../../shared/workflow/types'
import { invoke } from '../../ipc'
import { useFileElsewhere } from '../../machines/useFileElsewhere'
import { classifyLink } from '../../markdown/links'
import { StatusChip, type Status } from '../../theme/primitives'
import { showRevealed } from '../../toast/revealed'
import { useWorkflow } from '../../workflow/useWorkflow'
import { linkFolderOf, type TicketText } from './ticket-text'
import '../badges/evidence.css'

// The Evidence matrix of a focused Ticket (worfy-evidence ticket 06), above its text (TicketBody.tsx) in a tile
// of focus mode: the title «Evidence · n of m verified», a row per checkbox item of the done section — its
// number, the start of its text and its state, «Verified», «Not verified: <reason>» or «Failed» — and under
// it the item's Evidence lines: kind and verdict, platform and copy, the short SHA, the ref. The states come
// with the Ticket from main (shared/workflow/evidence.ts).
//
// The links open the source itself, through main: the SHA `<repoUrl>/commit/<sha>`, `PR #N` `<repoUrl>/pull/<N>`,
// an https:// URL as it is — all with `shell.openExternal`; without the repository's page (`repoUrl` null)
// the SHA and the PR are text. A path in backticks (a screenshot, a text file) resolves from the Ticket file's
// folder and opens in the system's default program with `shell.openInEditor`; on a Linked machine it shows
// "File is on <Machine>" instead, as the Ticket's own links do. worfy checks no link against its source: it
// does not ask whether a CI run is green (spec of the Epic, decided without the owner, item 6). A Ticket
// without checkbox items has no matrix.

/** What the ref of an Evidence line opens. */
type RefTarget = { kind: 'external'; url: string; label: string } | { kind: 'file'; path: string; label: string } | { kind: 'text'; label: string }

const PR = /^PR #(\d+)$/
const URL_REF = /^https?:\/\/\S+$/
/** A path in backticks: one word, with a folder or an extension, so `pnpm` alone stays a command. */
const PATH_REF = /^`([^`\s]+)`$/

const page = (repoUrl: string): string => repoUrl.replace(/\/+$/, '')

/**
 * The target of a ref: `PR #N` on the repository's page, an https:// address as it is, a path in backticks
 * relative to `baseDir` (the Ticket file's folder, relative to the Project root, as classifyLink takes it);
 * anything else — a command with its exit code, an http:// address, a path before the file is read — is text.
 */
function refTarget(ref: string, repoUrl: string | null, baseDir: string | undefined): RefTarget {
  const pr = PR.exec(ref)
  if (pr) return repoUrl === null ? { kind: 'text', label: ref } : { kind: 'external', url: `${page(repoUrl)}/pull/${pr[1]}`, label: ref }
  if (URL_REF.test(ref)) {
    const link = classifyLink(ref)
    return link.kind === 'external' ? { kind: 'external', url: link.url, label: ref } : { kind: 'text', label: ref }
  }
  const path = PATH_REF.exec(ref)?.[1]
  if (path !== undefined && /[./\\]/.test(path)) {
    const link = baseDir === undefined ? null : classifyLink(path, baseDir)
    return link?.kind === 'file' ? { kind: 'file', path: link.path, label: path } : { kind: 'text', label: path }
  }
  return { kind: 'text', label: ref }
}

/** The commit page of `sha`; null without the repository's page. */
const commitUrl = (repoUrl: string | null, sha: string): string | null => (repoUrl === null ? null : `${page(repoUrl)}/commit/${sha}`)

const STATE: Record<EvidenceItem['state'], Status> = { verified: 'ready', 'not-verified': 'working', failed: 'blocked' }

function stateLabel(item: Pick<EvidenceItem, 'state' | 'reason'>): string {
  switch (item.state) {
    case 'verified':
      return 'Verified'
    case 'failed':
      return 'Failed'
    case 'not-verified':
      return item.reason ? `Not verified: ${item.reason}` : 'Not verified'
  }
}

/** `<platform> <copy>` of a line; the platform alone without a copy; null for neither (a commit, a review). */
function machineOf(line: Pick<EvidenceLine, 'platform' | 'copy'>): string | null {
  if (line.platform === '-') return null
  return line.copy === '-' ? line.platform : `${line.platform} ${line.copy}`
}

function Link({ href, title, onOpen, testId, children }: { href: string; title: string; onOpen: () => void; testId: string; children: ReactNode }) {
  const onClick = (event: MouseEvent) => {
    // The window itself never navigates: the link always leaves through main.
    event.preventDefault()
    onOpen()
  }
  return (
    <a href={href} title={title} onClick={onClick} data-testid={testId}>
      {children}
    </a>
  )
}

export interface EvidenceMatrixProps {
  projectId: string
  items: readonly EvidenceItem[]
  /** The page of the Project's repository (`https://github.com/<owner>/<repo>`); null without one. */
  repoUrl: string | null
  /** The Ticket file's folder relative to the Project root; undefined until the file is read. */
  baseDir: string | undefined
}

export function EvidenceMatrix({ projectId, items, repoUrl, baseDir }: EvidenceMatrixProps) {
  const file = useFileElsewhere()
  if (!items.length) return null
  const { verified, total } = evidenceSummary(items)

  const openExternal = (url: string) => {
    void invoke('shell.openExternal', { url }).then((result) => {
      if (!result.ok) console.error('shell.openExternal failed:', result.error)
    })
  }
  const openFile = (path: string) => {
    // In a window on a Linked machine the file lies there: the toast instead of its program.
    if (file.elsewhere) {
      file.show()
      return
    }
    void invoke('shell.openInEditor', { projectId, path }).then((result) => {
      if (!result.ok) console.error('shell.openInEditor failed:', result.error)
      else if (result.value.revealedIn !== undefined) showRevealed(result.value.revealedIn)
    })
  }

  const sha = (line: EvidenceLine) => {
    const short = line.sha.slice(0, 7)
    const url = commitUrl(repoUrl, line.sha)
    return url === null ? (
      <span title={line.sha}>{short}</span>
    ) : (
      <Link href={url} title={url} onOpen={() => openExternal(url)} testId="evidence-sha">
        {short}
      </Link>
    )
  }
  const ref = (line: EvidenceLine) => {
    const target = refTarget(line.ref, repoUrl, baseDir)
    switch (target.kind) {
      case 'external':
        return (
          <Link href={target.url} title={target.url} onOpen={() => openExternal(target.url)} testId="evidence-ref">
            {target.label}
          </Link>
        )
      case 'file':
        return (
          <Link href={target.path} title={target.path} onOpen={() => openFile(target.path)} testId="evidence-ref">
            {target.label}
          </Link>
        )
      case 'text':
        return <span>{target.label}</span>
    }
  }

  return (
    <section className="w-evidence" data-testid="evidence-matrix" aria-label="Evidence">
      <h3 className="w-evidence__title">
        Evidence · {verified} of {total} verified
      </h3>
      <ol className="w-evidence__items">
        {items.map((item) => (
            <li key={item.index} className="w-evidence__item" data-testid="evidence-item" data-index={item.index} data-state={item.state}>
              <div className="w-evidence__head">
                <span className="w-mono w-evidence__num">{item.index}</span>
                <span className="w-evidence__text" title={item.text}>
                  {item.text}
                </span>
                <span className="w-evidence__state" data-testid="evidence-state">
                  <StatusChip status={STATE[item.state]} label={stateLabel(item)} />
                </span>
              </div>
              {item.evidence.length || item.errors.length ? (
                <ul className="w-evidence__lines">
                  {item.evidence.map((line) => (
                    <li key={line.line} className="w-mono w-evidence__line" data-testid="evidence-line">
                      {line.kind} {line.verdict}
                      {machineOf(line) === null ? null : ` · ${machineOf(line)}`}
                      {' · '}
                      {sha(line)}
                      {' · '}
                      {ref(line)}
                      {line.scrub === null ? null : ` · scrub: ${line.scrub}`}
                    </li>
                  ))}
                  {item.errors.map((error) => (
                    <li key={error} className="w-mono w-evidence__line w-evidence__error">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
        ))}
      </ol>
    </section>
  )
}

/** The matrix of a focused Ticket: its items, the repository's page from the workflow model, the folder of its file. */
export function TicketEvidence({ projectId, root, ticket, read }: { projectId: string; root: string; ticket: Ticket; read: TicketText }) {
  const { model } = useWorkflow(root)
  return <EvidenceMatrix projectId={projectId} items={ticket.evidence ?? []} repoUrl={model?.repoUrl ?? null} baseDir={linkFolderOf(read)} />
}
