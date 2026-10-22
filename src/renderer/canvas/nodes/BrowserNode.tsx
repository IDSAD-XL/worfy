import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BrowserProfile } from '../../../shared/browser/profiles'
import type { BrowserControlMode } from '../../../shared/browser/tools'
import { BrowserProfiles } from '../../browser/BrowserProfiles'
import { returnBrowserControl, takeOverBrowser, useBrowserControl } from '../../browser/control'
import { useBrowserProfiles } from '../../browser/profiles'
import { writeAction } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { useLayoutOps } from '../useLayout'
import {
  BROWSER_HEADER_HEIGHT,
  addressUrl,
  browserProfileChoice,
  browserUrl,
  type BrowserProfileChoice,
  dismissBrowserOpenRequest,
  navigateBrowserPage,
  openBarAddress,
  stepBrowserPage,
  useBrowserHistory,
  useBrowserOpenRequest,
} from './browser-frame'
import type { CanvasNodeProps } from './index'
import './BrowserNode.css'

// A Browser Node (ADR-0078): a frame with a header that holds the name of its Browser profile, the
// back, forward and reload buttons and the address bar, and the Open bar under it while the page
// asks to open an address. The profile's name opens the window «Browser profiles…» (worfy-browser
// ticket 03, the owner's decision 1). A Browser whose profile is not settled — deleted, or a new
// Browser while the Project has several — shows an empty frame with «Choose a profile»
// (browserProfileChoice in browser-frame.ts). The page itself is
// not drawn here but by the Browser layer (../overlays/BrowserLayer.tsx), under the frame's body,
// at browserPageRect() of the frame. The body is transparent and lets the mouse through, so the
// page shows and takes the mouse through it, and any Node or menu over the frame covers the page.
// The frame has the neutral colours of a surface: no minimapColor, no kind-* role (ADR-0077 item 2).
// While a Session drives the Browser (worfy-browser ticket 04, ADR-0078 item 8) the frame has an
// accent border and «Claude is driving» in its header; a click or a key of the user on the frame
// takes the Browser over (on the page main sees it, src/main/browser/cdp.ts), and the header then
// offers «Return control to Claude» (the owner's decision 3).
// The same kind as BROWSER_KIND of browser-frame.ts: a literal here, as fast refresh wants.
export const kind = 'browser'
export const defaultWidth = 640
export const defaultHeight = 440
export const createLabel = 'New browser'

/**
 * The address bar: it shows the address the Node keeps in `data.url` and, on Enter, sends the page
 * to the typed address and keeps it there. The address goes into the Node's data as a `patchData`
 * that is not a step of ⌘Z (history.ts): typing an address is not a gesture over the Node. A new
 * Browser has no address and shows an empty page.
 */
function AddressBar({ id, url, noProfile }: { id: string; url: string | null; noProfile: boolean }) {
  const ops = useLayoutOps()
  // On a read-only screen (worfy-link ticket 25) the address is shown and cannot be changed. Nor
  // while the Browser has no profile: there is no page to send, and an address kept in the Node
  // would settle its profile by the rule for old Browsers (browserProfileChoice).
  const screenReadOnly = useReadOnly()
  const readOnly = screenReadOnly ?? (noProfile ? 'Choose a profile first' : null)
  /** What is being typed, while the bar has the focus; null otherwise. */
  const [draft, setDraft] = useState<string | null>(null)
  /** The address sent last and the Node's address then: shown until the Node's address changes. */
  const [sent, setSent] = useState<{ address: string; over: string | null } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const shown = sent !== null && sent.over === url ? sent.address : url

  const go = (input: HTMLInputElement) => {
    const next = addressUrl(draft ?? '')
    if (next === null) {
      setInvalid(true)
      return
    }
    setSent({ address: next, over: url })
    setDraft(null)
    input.blur()
    navigateBrowserPage(id, next)
    if (next !== url) void ops.apply({ op: 'patchData', id, data: { url: next } })
  }

  return (
    <input
      className="w-browser-frame__address w-mono nodrag"
      data-testid="browser-address"
      aria-label="Address"
      aria-invalid={invalid}
      placeholder={noProfile ? 'Choose a profile first' : 'Enter an address'}
      spellCheck={false}
      autoComplete="off"
      value={draft ?? shown ?? ''}
      readOnly={readOnly !== null}
      title={readOnly ?? undefined}
      onFocus={(event) => {
        if (readOnly !== null) return
        setDraft(event.currentTarget.value)
        event.currentTarget.select()
      }}
      onChange={(event) => {
        setInvalid(false)
        setDraft(event.currentTarget.value)
      }}
      onBlur={() => {
        setDraft(null)
        setInvalid(false)
      }}
      onKeyDown={(event) => {
        if (readOnly !== null) return
        if (event.key === 'Enter') {
          event.preventDefault()
          go(event.currentTarget)
        } else if (event.key === 'Escape') {
          // Esc leaves the bar as it was and does nothing else (the Esc of an active Node, of Focus mode).
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/** The paths of the buttons' icons, in a 16 × 16 box. */
const NAV_ICONS = {
  back: 'M10 3.5L5.5 8l4.5 4.5',
  forward: 'M6 3.5L10.5 8 6 12.5',
  reload: 'M13 8a5 5 0 1 1-1.46-3.54M13 2.5v3h-3',
} as const

/**
 * Back, forward and reload of the page, left of the address bar (worfy-browser ticket 10). Back
 * and forward are inactive when the page has nowhere to go that way; all three are inactive while
 * this window has no ready page for the Browser.
 */
function NavButtons({ id }: { id: string }) {
  const history = useBrowserHistory(id)
  const buttons = [
    { step: 'back', label: 'Back', enabled: history?.canGoBack === true },
    { step: 'forward', label: 'Forward', enabled: history?.canGoForward === true },
    { step: 'reload', label: 'Reload', enabled: history !== undefined },
  ] as const
  return (
    <span className="w-browser-frame__nav">
      {buttons.map(({ step, label, enabled }) => (
        <button
          key={step}
          type="button"
          className="w-browser-frame__nav-button nodrag"
          data-testid={`browser-${step}`}
          aria-label={label}
          title={label}
          disabled={!enabled}
          onClick={() => stepBrowserPage(id, step)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={NAV_ICONS[step]} />
          </svg>
        </button>
      ))}
    </span>
  )
}

/**
 * The Open bar (worfy-browser ticket 11), over the top of the page, right under the header: the
 * page asked to open an address main did not open by itself — a window.open or target="_blank"
 * link from a frame of another origin or without a referrer (src/main/window.ts). The scheme and
 * the host of the address are always shown whole, wrapping when they do not fit on one line; only
 * the rest of a long address is cut in the middle (openBarAddress, worfy-browser ticket 12). In a
 * narrow frame the address moves to a line of its own under the label (BrowserNode.css). "Open" sends the page there the way the address bar
 * does, and the click is the user's gesture the request lacked; the close button leaves the page
 * where it is. A new request replaces the bar's address; a navigation of the page takes the bar
 * away (../overlays/BrowserLayer.tsx).
 */
function OpenBar({ id, url }: { id: string; url: string | null }) {
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const request = useBrowserOpenRequest(id)
  if (request === undefined) return null
  const { site, head, tail } = openBarAddress(request)

  const open = () => {
    dismissBrowserOpenRequest(id)
    navigateBrowserPage(id, request)
    // On a read-only screen the page goes there as by a link, and the Node keeps its address.
    if (readOnly === null && request !== url) void ops.apply({ op: 'patchData', id, data: { url: request } })
  }

  return (
    <div className="w-browser-frame__open-bar nodrag" data-testid="browser-open-bar" role="status">
      <span className="w-browser-frame__open-label">The page wants to open</span>
      <span className="w-browser-frame__open-url w-mono" data-testid="browser-open-url" title={request}>
        <span className="w-browser-frame__open-url-site" data-testid="browser-open-site">
          {site}
        </span>
        <span className="w-browser-frame__open-url-head" data-testid="browser-open-path-head">
          {head}
        </span>
        <span className="w-browser-frame__open-url-tail" data-testid="browser-open-path-tail">
          {tail}
        </span>
      </span>
      <button type="button" className="w-browser-frame__open-button nodrag" data-testid="browser-open" onClick={open}>
        Open
      </button>
      <button
        type="button"
        className="w-browser-frame__nav-button nodrag"
        data-testid="browser-open-close"
        aria-label="Close"
        title="Close"
        onClick={() => dismissBrowserOpenRequest(id)}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  )
}

/**
 * Who drives the Browser, at the right end of its header (worfy-browser ticket 04): «Claude is
 * driving» while a Session does, and after the user took it over the button «Return control to
 * Claude», which a read-only screen shows inactive. In the header it covers no part of the page.
 */
function DriveBadge({ projectId, id, mode }: { projectId: string; id: string; mode: BrowserControlMode }) {
  const readOnly = useReadOnly()
  if (mode === 'claude') {
    return (
      <span className="w-browser-frame__drive w-browser-frame__drive--claude" data-testid="browser-claude-drives" role="status" title="Click or type in this Browser to take over">
        <span className="w-browser-frame__drive-dot" aria-hidden="true" />
        Claude is driving
      </span>
    )
  }
  return (
    <span className="w-browser-frame__drive" data-testid="browser-taken-over" role="status">
      <button type="button" className="w-browser-frame__open-button nodrag" data-testid="browser-return-control" {...writeAction(readOnly, () => returnBrowserControl(projectId, id))}>
        Return control to Claude
      </button>
    </span>
  )
}

/** «Browser profiles…»: the window over the Canvas, opened from a frame; `selected` — the profile shown first. */
function useProfilesWindow(): { open: (selected: string | null) => void; window: ReactNode } {
  const project = activeProject(useProjects())
  const [opened, setOpened] = useState<{ selected: string | null } | null>(null)
  return {
    open: (selected) => setOpened({ selected }),
    window:
      opened !== null && project !== undefined ? <BrowserProfiles project={{ id: project.id, name: project.name }} selected={opened.selected} onClose={() => setOpened(null)} /> : null,
  }
}

/**
 * The frame of a Browser whose profile is not settled: the button «Choose a profile» and its list —
 * the Project's profiles, and «Browser profiles…» to make or manage one. The choice goes into the
 * Node's data, as the address does; the Browser layer then opens the page on that profile.
 */
function ChooseProfile({ id, choice, profiles, manage }: { id: string; choice: BrowserProfileChoice & { kind: 'choose' }; profiles: readonly BrowserProfile[]; manage: () => void }) {
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])
  const why = {
    deleted: 'The Browser profile of this Browser was deleted.',
    several: 'This Browser has no Browser profile yet.',
    none: 'This Project has no Browser profile yet.',
  }[choice.reason]
  return (
    <div ref={root} className="w-browser-frame__choose nodrag" data-testid="browser-choose-profile">
      <span className="w-browser-frame__choose-why">{why}</span>
      <button type="button" className="w-browser-frame__open-button" data-testid="browser-choose-profile-button" aria-expanded={open} {...writeAction(readOnly, () => setOpen(!open))}>
        Choose a profile
      </button>
      {open ? (
        <div role="menu" aria-label="Browser profiles" className="w-browser-frame__choose-menu">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="menuitem"
              className="w-row"
              onClick={() => {
                setOpen(false)
                void ops.apply({ op: 'patchData', id, data: { profile: profile.id } })
              }}
            >
              {profile.name}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="w-row"
            onClick={() => {
              setOpen(false)
              manage()
            }}
          >
            Browser profiles…
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function BrowserNode({ id, data }: CanvasNodeProps) {
  const url = browserUrl(data.node)
  const projectId = activeProject(useProjects())?.id
  const profiles = useBrowserProfiles(projectId)
  const choice = browserProfileChoice(data.node.data, profiles)
  const profile = choice.kind === 'use' ? profiles?.find((each) => each.id === choice.id) : undefined
  const profilesWindow = useProfilesWindow()
  const control = useBrowserControl(projectId, id)
  // A press or a key anywhere on the frame — its header, its bars — while a Session drives it.
  const takeOver = () => {
    if (control === 'claude' && projectId !== undefined) takeOverBrowser(projectId, id)
  }
  return (
    <div
      className={`w-node-surface w-browser-frame${control === 'claude' ? ' w-browser-frame--driven' : ''}`}
      data-testid="browser-frame"
      data-node-id={id}
      data-profile={choice.kind === 'use' ? choice.id : undefined}
      data-control={control ?? undefined}
      onPointerDownCapture={takeOver}
      onKeyDownCapture={takeOver}
    >
      <div className="w-browser-frame__header" style={{ height: BROWSER_HEADER_HEIGHT }}>
        {profile !== undefined ? (
          <button
            type="button"
            className="w-browser-frame__title w-browser-frame__profile nodrag"
            data-testid="browser-profile-name"
            title="Browser profiles…"
            onClick={() => profilesWindow.open(profile.id)}
          >
            {profile.name}
          </button>
        ) : (
          <span className="w-browser-frame__title">Browser</span>
        )}
        <NavButtons id={id} />
        <AddressBar id={id} url={url} noProfile={choice.kind !== 'use'} />
        {control !== null && projectId !== undefined && choice.kind !== 'choose' ? <DriveBadge projectId={projectId} id={id} mode={control} /> : null}
      </div>
      <div className="w-browser-frame__body" data-testid="browser-frame-body">
        {choice.kind === 'choose' ? <ChooseProfile id={id} choice={choice} profiles={profiles ?? []} manage={() => profilesWindow.open(null)} /> : <OpenBar id={id} url={url} />}
      </div>
      {profilesWindow.window}
    </div>
  )
}
