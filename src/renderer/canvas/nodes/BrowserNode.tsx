import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { BrowserProfile } from '../../../shared/browser/profiles'
import type { BROWSER_KIND, BROWSER_SIZE, BrowserControlMode } from '../../../shared/browser/tools'
import { BrowserProfiles } from '../../browser/BrowserProfiles'
import { returnBrowserControl, takeOverBrowser, useBrowserControl } from '../../browser/control'
import { buttonOf, framePoint, keyText, modifiersOf, navigateBrowserFrames, sendBrowserInput, useBrowserFrames } from '../../browser/frames'
import { useBrowserLife, useBrowserPicture, wakeBrowser } from '../../browser/lives'
import { useBrowserProfiles } from '../../browser/profiles'
import { useInFocusTile, useSeeThroughTile } from '../../focus/focus-tile'
import { writeAction } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { useEdgeFocus } from '../edge-focus'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import {
  BROWSER_HEADER_HEIGHT,
  addressUrl,
  browserProfileChoice,
  browserUrl,
  type BrowserProfileChoice,
  browserPageElementId,
  dismissBrowserOpenRequest,
  navigateBrowserPage,
  openBarAddress,
  registerBrowserTileBody,
  stepBrowserPage,
  useBrowserHistory,
  useBrowserOpenRequest,
} from './browser-frame'
import { BrowserSidebar } from './BrowserSidebar'
import { BROWSER_FRAME_MIN, browserPageViewport } from './browser-viewport'
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
// The copy of the frame in a focus tile registers its body (registerBrowserTileBody, worfy-browser
// ticket 17), and the layer lays the page over that body while the tile is open; while this window
// draws the page, the frame makes its tile see-through (useSeeThroughTile, ../../focus/focus-tile.ts)
// and the body owns the page for a screen reader, which finds it under the Canvas otherwise.
// The frame has the neutral colours of a surface: no minimapColor, no kind-* role (ADR-0077 item 2).
// While a Session drives the Browser (worfy-browser ticket 04, ADR-0078 item 8) the frame has an
// accent border and «Claude is driving» in its header; a click or a key of the user on the frame
// takes the Browser over (on the page main sees it, src/main/browser/cdp.ts), and the header then
// offers «Return control to Claude» (the owner's decision 3).
// An Asleep Browser (worfy-browser ticket 05, ADR-0078 item 6) shows the picture of its page as it
// went to sleep, under «Asleep · Click to wake»; a click anywhere on it wakes the Browser. A Live one
// whose page has a beforeunload handler says «Unsaved changes» in its header (it does not sleep), and
// one the user opened while every other Live Browser was busy says «Over the Live limit».
// A Live Browser whose page another window draws, or the Machine of a Linked machine's Project
// (worfy-browser ticket 07, ADR-0078 items 9 and 16), shows the frames of that page in its body and
// sends it the user's click, scroll and keys; its address bar sends the page there through main.
// A read-only screen of a Linked machine (ADR-0078 item 14) shows the frame with the name of the
// Browser profile alone: no address bar, no buttons, no frames, no picture of an Asleep page.
// A selected frame is resized by its handles (worfy-browser ticket 18), and the button right of the
// address bar opens the settings sidebar (BrowserSidebar.tsx), whose first setting is the page
// viewport (`data.viewport`, browser-viewport.ts, ADR-0087): the page, its frames and its picture are
// then laid out at that size and fitted into the body.
// The kind and size of src/shared/browser/tools.ts. The registry (index.ts) needs them here as
// literals (fast refresh accepts no other constant exports); `satisfies` fails the typecheck the
// moment they differ from the shared ones.
export const kind = 'browser' satisfies typeof BROWSER_KIND
export const defaultWidth = 640 satisfies typeof BROWSER_SIZE.w
export const defaultHeight = 440 satisfies typeof BROWSER_SIZE.h
export const createLabel = 'New browser'

/**
 * The address bar: it shows the address the Node keeps in `data.url` and, on Enter, sends the page
 * to the typed address and keeps it there. The address goes into the Node's data as a `patchData`
 * that is not a step of ⌘Z (history.ts): typing an address is not a gesture over the Node. A new
 * Browser has no address and shows an empty page.
 */
function AddressBar({ id, url, noProfile, framesOf }: { id: string; url: string | null; noProfile: boolean; framesOf: string | null }) {
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
    // The page is drawn elsewhere: main sends it there (`framesOf` — its Project).
    if (framesOf !== null) navigateBrowserFrames(framesOf, id, next)
    else navigateBrowserPage(id, next)
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

/**
 * The body of an Asleep Browser: the picture main kept of its page, drawn on a canvas (the window's
 * policy loads no image from a data address), and «Asleep · Click to wake» over it. A click wakes
 * the Browser; its page is drawn again once main says it is Live.
 */
function Asleep({ projectId, id, picture }: { projectId: string; id: string; picture: number | null }) {
  const bytes = useBrowserPicture(projectId, id, picture)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (bytes === null || target === null || typeof createImageBitmap !== 'function') return
    let current = true
    void createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' })).then(
      (bitmap) => {
        if (!current) return bitmap.close()
        target.width = bitmap.width
        target.height = bitmap.height
        target.getContext('2d')?.drawImage(bitmap, 0, 0)
        bitmap.close()
      },
      (error: unknown) => console.warn(`Browser ${id}: its picture could not be drawn`, error),
    )
    return () => {
      current = false
    }
  }, [bytes, id])
  return (
    <button type="button" className="w-browser-frame__asleep nodrag" data-testid="browser-asleep" aria-label="Asleep. Click to wake" onClick={() => wakeBrowser(projectId, id)}>
      {bytes !== null ? <canvas ref={canvas} className="w-browser-frame__picture" data-testid="browser-picture" aria-hidden="true" /> : null}
      <span className="w-browser-frame__asleep-label">
        <strong>Asleep</strong> · Click to wake
      </span>
    </button>
  )
}

/**
 * The body of a Live Browser whose page is drawn elsewhere: the last frame of the page, and the
 * user's input on it for the page — a press, a drag, a release and a scroll of the mouse in the
 * page's CSS pixels, and every key while it has the focus (a click gives it). The keys stop here:
 * the Canvas's own shortcuts do not see them.
 */
function Frames({ projectId, id }: { projectId: string; id: string }) {
  const frame = useBrowserFrames(projectId, id, true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pressed = useRef<'left' | 'middle' | 'right' | null>(null)
  useEffect(() => {
    const target = canvas.current
    if (frame === null || target === null || typeof createImageBitmap !== 'function') return
    let current = true
    void createImageBitmap(new Blob([frame.bytes as BlobPart], { type: 'image/jpeg' })).then(
      (bitmap) => {
        if (!current) return bitmap.close()
        target.width = bitmap.width
        target.height = bitmap.height
        target.getContext('2d')?.drawImage(bitmap, 0, 0)
        bitmap.close()
      },
      (error: unknown) => console.warn(`Browser ${id}: a frame could not be drawn`, error),
    )
    return () => {
      current = false
    }
  }, [frame, id])
  /** Where `event` is on the page, in its CSS pixels, and whether on its picture (framePoint); null before the first frame. */
  const at = (event: { clientX: number; clientY: number }): { x: number; y: number; inside: boolean } | null => {
    const target = canvas.current
    if (frame === null || target === null) return null
    const box = target.getBoundingClientRect()
    return framePoint(event.clientX - box.left, event.clientY - box.top, box, frame)
  }
  // The scroll is the page's, not the Canvas's: a passive React listener could not stop the Canvas's zoom.
  useEffect(() => {
    const target = canvas.current
    if (target === null) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const point = at(event)
      if (point?.inside === true) sendBrowserInput(projectId, id, { kind: 'wheel', x: point.x, y: point.y, deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifiersOf(event) })
    }
    target.addEventListener('wheel', onWheel, { passive: false })
    return () => target.removeEventListener('wheel', onWheel)
  })
  /**
   * Sends a press, a drag or a release; true when sent. With `onPicture` — a press, or a release
   * that no press here began — one beside the picture, on the empty part of the body, is none.
   */
  const mouse = (type: 'mousePressed' | 'mouseReleased' | 'mouseMoved', event: ReactPointerEvent<HTMLCanvasElement>, button: 'none' | 'left' | 'middle' | 'right', onPicture: boolean): boolean => {
    const point = at(event)
    if (point === null || (onPicture && !point.inside)) return false
    sendBrowserInput(projectId, id, { kind: 'mouse', type, x: point.x, y: point.y, button, clickCount: type === 'mouseMoved' ? 0 : Math.min(3, Math.max(1, event.detail)), modifiers: modifiersOf(event) })
    return true
  }
  const key = (type: 'keyDown' | 'keyUp', event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const text = type === 'keyDown' ? keyText(event) : undefined
    sendBrowserInput(projectId, id, { kind: 'key', type, key: event.key, code: event.code, ...(text === undefined ? {} : { text }), keyCode: event.keyCode, modifiers: modifiersOf(event) })
  }
  return (
    <canvas
      ref={canvas}
      className="w-browser-frame__frames nodrag nowheel nopan"
      data-testid="browser-frames"
      data-frame={frame === null ? 'none' : 'shown'}
      tabIndex={0}
      aria-label="The page of this Browser, shown from the window that runs it"
      onPointerDown={(event) => {
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        const button = buttonOf(event.button)
        pressed.current = mouse('mousePressed', event, button, true) ? button : null
      }}
      onPointerMove={(event) => {
        // A drag only: a move without a button would send every hover over the network.
        if (pressed.current !== null) mouse('mouseMoved', event, pressed.current, false)
      }}
      onPointerUp={(event) => {
        const held = pressed.current
        pressed.current = null
        mouse('mouseReleased', event, held ?? buttonOf(event.button), held === null)
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => key('keyDown', event)}
      onKeyUp={(event) => key('keyUp', event)}
    />
  )
}

/** The marks of a Live Browser that main keeps awake or lets beyond the limit, in its header. */
function LifeMarks({ unsaved, overLimit }: { unsaved: boolean; overLimit: boolean }) {
  return (
    <>
      {unsaved ? (
        <span className="w-browser-frame__mark" data-testid="browser-unsaved" role="status" title="The page asks before it is left, so this Browser does not sleep">
          Unsaved changes
        </span>
      ) : null}
      {overLimit ? (
        <span className="w-browser-frame__mark" data-testid="browser-over-limit" role="status" title="The other Live Browsers are busy, so this one is Live beyond the limit of Settings → Browser">
          Over the Live limit
        </span>
      ) : null}
    </>
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

/** The button right of the address bar that opens and closes the frame's settings sidebar (BrowserSidebar.tsx). */
function SidebarButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="w-browser-frame__nav-button nodrag"
      data-testid="browser-settings"
      aria-label="Browser settings"
      title="Browser settings"
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(event) => {
        // Esc on the button of an open sidebar closes it, not the Esc of an active Node or of Focus mode.
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M10 3v10" />
      </svg>
    </button>
  )
}

export default function BrowserNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const url = browserUrl(data.node)
  const viewport = browserPageViewport(data.node.data)
  const [sidebar, setSidebar] = useState(false)
  const projectId = activeProject(useProjects())?.id
  const profiles = useBrowserProfiles(projectId)
  const choice = browserProfileChoice(data.node.data, profiles)
  const profile = choice.kind === 'use' ? profiles?.find((each) => each.id === choice.id) : undefined
  const profilesWindow = useProfilesWindow()
  const control = useBrowserControl(projectId, id)
  const life = useBrowserLife(projectId, id)
  const readOnly = useReadOnly()
  const asleep = life !== undefined && !life.live && choice.kind === 'use' && projectId !== undefined
  // Live, and drawn by another window or another Machine: its body shows the frames of the page.
  const frames = life?.live === true && !life.here && choice.kind === 'use' && projectId !== undefined && readOnly === null
  // In the lit Family of a hovered or selected Node — its Session's, its Ticket's (family.ts,
  // worfy-browser ticket 06): a Browser has no line of its own to draw, so its frame is marked.
  const inFamily = useEdgeFocus((state) => state.family !== null && state.family.has(id))
  // A press or a key anywhere on the frame — its header, its bars — while a Session drives it. A
  // read-only Linked machine takes nothing over: it is a write the Machine of the Project refuses.
  const takeOver = () => {
    if (readOnly === null && control === 'claude' && projectId !== undefined) takeOverBrowser(projectId, id)
  }
  // In a focus tile the page is laid over this copy's body (worfy-browser ticket 17).
  const pageHere = life?.live === true && life.here && choice.kind === 'use' && projectId !== undefined && readOnly === null
  useSeeThroughTile(pageHere)
  const inTile = useInFocusTile()
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = body.current
    if (!inTile || element === null) return undefined
    return registerBrowserTileBody(id, element)
  }, [id, inTile])
  return (
    <div
      className={`w-node-surface w-browser-frame${control === 'claude' ? ' w-browser-frame--driven' : ''}`}
      data-testid="browser-frame"
      data-node-id={id}
      data-profile={choice.kind === 'use' ? choice.id : undefined}
      data-control={control ?? undefined}
      data-life={life === undefined ? undefined : life.live ? 'live' : 'asleep'}
      data-page={life?.live === true ? (life.here ? 'here' : 'frames') : undefined}
      data-family={inFamily ? 'lit' : undefined}
      onPointerDownCapture={takeOver}
      onKeyDownCapture={takeOver}
    >
      {/* Resized like a Note or a Terminal (worfy-browser ticket 18): the page follows the body, unless
          the Browser has a viewport of its own, which is then scaled into it (ADR-0087). */}
      <NodeResizeClamp
        isVisible={selected}
        minWidth={BROWSER_FRAME_MIN.w}
        minHeight={BROWSER_FRAME_MIN.h}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
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
        {readOnly !== null ? null : (
          <>
            <NavButtons id={id} />
            <AddressBar id={id} url={url} noProfile={choice.kind !== 'use'} framesOf={frames ? projectId : null} />
            <SidebarButton open={sidebar} onToggle={() => setSidebar(!sidebar)} />
            {life?.live === true ? <LifeMarks unsaved={life.unsaved} overLimit={life.overLimit} /> : null}
            {control !== null && projectId !== undefined && choice.kind !== 'choose' ? <DriveBadge projectId={projectId} id={id} mode={control} /> : null}
          </>
        )}
      </div>
      <div
        ref={body}
        className="w-browser-frame__body"
        data-testid="browser-frame-body"
        aria-owns={inTile && pageHere ? browserPageElementId(id) : undefined}
      >
        {readOnly !== null ? null : choice.kind === 'choose' ? (
          <ChooseProfile id={id} choice={choice} profiles={profiles ?? []} manage={() => profilesWindow.open(null)} />
        ) : asleep ? (
          <Asleep projectId={projectId} id={id} picture={life.picture} />
        ) : frames ? (
          <Frames projectId={projectId} id={id} />
        ) : (
          <OpenBar id={id} url={url} />
        )}
        {sidebar && readOnly === null ? <BrowserSidebar id={id} viewport={viewport} onClose={() => setSidebar(false)} /> : null}
      </div>
      {profilesWindow.window}
    </div>
  )
}
