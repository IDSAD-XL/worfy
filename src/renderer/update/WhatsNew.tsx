import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { failureReason } from '../../shared/ipc/channels'
import { UPDATE_REPO_PAGE, type WhatsNew as WhatsNewAnswer } from '../../shared/ipc/update'
import { invoke } from '../ipc'

// "What's new" (worfy-update ticket 10, spec item 6, R13): a popover under the version chip
// (src/renderer/update/UpdateChip.tsx), opened from its menu. Main answers `update.whatsNew` with
// the PRs merged between the copy that runs and the new version (src/main/update/whats-new.ts); the
// popover shows "What's new in worfy <version>", a line "<PR title> #<number>" for each, newest
// first, "…and more on GitHub" when the comparison was cut at 250 commits, and the chip's own first
// action ("Update worfy", or "Restart now" / "Restart when idle" once built). Texts: the draft texts
// of .scratch/worfy-update/spec.md.
//
// A title is GitHub's text, written by whoever opened the PR: React puts it in as text, never as
// markup. The number and "…and more" open github.com in the system's browser (`shell.openExternal`,
// which main accepts for https only); the window never navigates.
//
// It lies over the toasts (z-index 120), so it closes once the focus goes to anything else of the
// window — the Command palette's field on ⌘K (z-index 101) among them —, never under it. The window
// losing the focus (a PR opening in the browser) keeps it open.

/** The button of the popover: the chip's first menu item. Without `run` it is inactive (a build that runs). */
export interface WhatsNewAction {
  label: string
  run?: () => void
}

export interface WhatsNewProps {
  /** The new version, shown until main answers. */
  version: string
  /** How a version shows: numbered where its build number is known (ticket 14); without it, as it is. */
  label?: (version: string) => string
  /** The chip: the popover lies under it, and the focus goes back to it. */
  anchor: HTMLElement
  action: WhatsNewAction
  onClose: () => void
}

type Reading = { kind: 'reading' } | { kind: 'read'; answer: WhatsNewAnswer } | { kind: 'failed'; reason: string }

const popoverStyle: CSSProperties = {
  position: 'fixed',
  // Over the toasts (z-index 120, src/renderer/toast/toast.css): the sticky Update toast of the start
  // lies right under the chip, and a popover the user opened comes first.
  zIndex: 130,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  padding: 'var(--space-3)',
  gap: 'var(--space-2)',
  borderRadius: 'var(--radius-popover)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: 'var(--shadow-node)',
  fontSize: 'var(--text-13)',
  outline: 'none',
}

const linkStyle: CSSProperties = { color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }
const mutedStyle: CSSProperties = { margin: 0, color: 'var(--text-muted)' }

function openExternal(url: string): void {
  void invoke('shell.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('shell.openExternal failed:', result.error)
  })
}

/** A link to github.com that opens in the system's browser, never in this window. */
function GitHubLink({ url, children }: { url: string; children: string }) {
  return (
    <a
      href={url}
      style={linkStyle}
      onClick={(event: ReactMouseEvent) => {
        event.preventDefault()
        openExternal(url)
      }}
    >
      {children}
    </a>
  )
}

/** The popover; it asks main once, when it opens. Escape, a click elsewhere and the focus elsewhere close it. */
export default function WhatsNew({ version, label = (each) => each, anchor, action, onClose }: WhatsNewProps) {
  const popover = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const [reading, setReading] = useState<Reading>({ kind: 'reading' })
  // 4px under the chip, its left edge on the chip's, at most as wide and as high as the window leaves.
  const [place] = useState(() => {
    const box = anchor.getBoundingClientRect()
    const top = box.bottom + 4
    return { left: box.left, top, width: Math.max(240, Math.min(420, window.innerWidth - box.left - 8)), maxHeight: Math.max(160, window.innerHeight - top - 16) }
  })

  useEffect(() => {
    let open = true
    void invoke('update.whatsNew').then((result) => {
      if (!open) return
      setReading(result.ok ? { kind: 'read', answer: result.value } : { kind: 'failed', reason: failureReason('update.whatsNew', result.error) })
    })
    return () => {
      open = false
    }
  }, [])

  useEffect(() => {
    popover.current?.focus()
    const outside = (event: Event): void => {
      const target = event.target as Node
      if (!popover.current?.contains(target) && !anchor.contains(target)) close.current()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('focusin', outside)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('focusin', outside)
    }
  }, [anchor])

  const shown = label(reading.kind === 'read' ? reading.answer.version : version)
  let body
  if (reading.kind === 'reading') {
    body = (
      <p role="status" style={mutedStyle}>
        Reading the pull requests on GitHub…
      </p>
    )
  } else if (reading.kind === 'failed') {
    body = (
      <p role="alert" style={{ ...mutedStyle, overflowWrap: 'anywhere' }}>
        {reading.reason}
      </p>
    )
  } else if (reading.answer.items.length === 0) {
    body = (
      <p role="status" style={mutedStyle}>
        No pull requests between this copy and the new version.
      </p>
    )
  } else {
    body = (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {reading.answer.items.map((item, at) => (
          // By place: a cherry-picked squash merge repeats its (#N), and the list never changes once read.
          <li key={at} style={{ lineHeight: '18px', overflowWrap: 'anywhere' }}>
            {item.title}{' '}
            <GitHubLink url={`${UPDATE_REPO_PAGE}/pull/${item.number}`}>{`#${item.number}`}</GitHubLink>
          </li>
        ))}
      </ul>
    )
  }

  return createPortal(
    <div
      ref={popover}
      role="dialog"
      aria-label={`What's new in worfy ${shown}`}
      tabIndex={-1}
      style={{ ...popoverStyle, ...place }}
      data-testid="whats-new"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close.current()
          anchor.focus()
        }
      }}
    >
      <h2 style={{ margin: 0, fontSize: 'var(--text-13)', fontWeight: 600 }}>{`What's new in worfy ${shown}`}</h2>
      {body}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', paddingTop: 'var(--space-1)' }}>
        {reading.kind === 'read' && reading.answer.more ? <GitHubLink url={reading.answer.compareUrl}>…and more on GitHub</GitHubLink> : <span />}
        <button
          type="button"
          className="w-primary"
          aria-disabled={action.run === undefined ? 'true' : undefined}
          style={action.run === undefined ? { opacity: 0.5 } : undefined}
          onClick={() => {
            if (action.run === undefined) return
            close.current()
            anchor.focus()
            action.run()
          }}
        >
          {action.label}
        </button>
      </div>
    </div>,
    document.body,
  )
}
