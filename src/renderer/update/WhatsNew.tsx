import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import { UPDATE_REPO_PAGE, type WhatsNew as WhatsNewAnswer } from '../../shared/ipc/update'
import { invoke } from '../ipc'
import { Popover } from '../theme/kit/Popover'

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
// The popover is the kit's (theme/kit/Popover.tsx, worfy-ui-kit ticket 10), placed against the chip and
// opened by the chip's menu, on the topmost layer of the scale with the chip's menu: over the toasts, so the
// sticky Update toast of the start under the chip does not cover it. The focus goes in when it opens and
// back to the chip when it closes; Esc, a press elsewhere and the focus going to anything else of the window
// — the Command palette's field on ⌘K among them — close it. The window losing the focus (a PR opening
// in the browser) keeps it open.

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
  display: 'flex',
  flexDirection: 'column',
  padding: 'var(--space-3)',
  gap: 'var(--space-2)',
  boxShadow: 'var(--shadow-node)',
  fontSize: 'var(--text-13)',
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
  const [reading, setReading] = useState<Reading>({ kind: 'reading' })
  /** The chip, for the focus to go back to: a popover opened by a menu item has no trigger of its own. */
  const chip = useRef<HTMLElement | null>(anchor)
  useEffect(() => {
    chip.current = anchor
  }, [anchor])
  // As wide as the window leaves right of the chip, 240 to 420 px; as high as it leaves under it.
  const [size] = useState(() => {
    const box = anchor.getBoundingClientRect()
    return { width: Math.max(240, Math.min(420, window.innerWidth - box.left - 8)), maxHeight: Math.max(160, window.innerHeight - box.bottom - 20) }
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

  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      anchor={anchor}
      label={`What's new in worfy ${shown}`}
      testId="whats-new"
      align="start"
      layer="top"
      // The popover itself takes the focus, not its button: Enter right after opening updates nothing.
      initialFocus="popup"
      finalFocus={chip}
      // A PR opened in the browser takes the focus from the window: the popover stays for the next one.
      onDismiss={(reason) => reason !== 'blur'}
      popupProps={{ style: { ...popoverStyle, ...size } }}
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
            onClose()
            anchor.focus()
            action.run()
          }}
        >
          {action.label}
        </button>
      </div>
    </Popover>
  )
}
