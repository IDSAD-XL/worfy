import { useState, type MouseEvent } from 'react'
import { EVIDENCE_FILE_LIMIT_BYTES, evidenceFileUrl } from '../../../shared/images'
import type { ImageStatus } from '../../../shared/ipc/images'
import { contactSheetOf } from '../../../shared/workflow/evidence'
import { ImageOverlay } from '../../session/MessageAttachments'
import type { PreviewKind } from './evidence-files'
import { imageFailure } from './image-url'

// The screenshot and the clip of an Evidence line in the matrix of a focused Ticket (worfy-evidence ticket 12;
// EvidenceMatrix.tsx draws it under the line). A `screenshot` line's file shows as a thumbnail that opens over the
// window (ImageOverlay, the one of a message's image); a `video` line's clip plays in place, muted, with its
// controls, and «Contact sheet» opens the sheet next to it (`<clip>.sheet.png`) over the window. The overlay has
// «Open in default app», which opens the file with `shell.openInEditor` as the ref's own link does.
//
// The bytes come from main by worfy-image://evidence-<project label>/<epic>%2Fevidence%2F<file>
// (src/shared/images.ts): the path below the Project's Tickets root, which the ref, relative to the Ticket file's
// folder `<epic>/issues/`, names. main serves only `<epic>/evidence/…` there, up to 8 MB. A file that does not load
// says why — «File not found», «File over 8 MB», or «File cannot be shown» for one main serves but the window does
// not draw, as images.status tells — next to a link to open it in the system's program; so does a picture that does
// not load over the window (a missing contact sheet): the overlay closes, and the reason shows next to the preview. A
// window on a Linked machine draws no preview: the matrix shows «File is on <Machine>» for
// the ref, as before.

const FAILURE: Readonly<Record<ImageStatus, string>> = {
  // Served, but the window could not draw it: not an image or a clip it decodes.
  ok: 'File cannot be shown',
  missing: 'File not found',
  unreachable: 'File not found',
  'too-large': `File over ${EVIDENCE_FILE_LIMIT_BYTES / 1024 / 1024} MB`,
}

export interface EvidencePreviewProps {
  projectId: string
  kind: PreviewKind
  /** The file below the Tickets root, `<epic>/evidence/…` (evidencePathOf). */
  evidencePath: string
  /** The file relative to the Project root, as `shell.openInEditor` takes it (the ref's link). */
  path: string
  /** The name shown: the ref as written. */
  label: string
  /** Opens a file, relative to the Project root, in the system's default program. */
  onOpen: (path: string) => void
}

/** What is open over the window: the screenshot, or the clip's contact sheet. */
type Overlay = { src: string; name: string; path: string } | null

export function EvidencePreview({ projectId, kind, evidencePath, path, label, onOpen }: EvidencePreviewProps) {
  const [failure, setFailure] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  /** Why the picture over the window did not load, and the file it was: shown next to the preview once it closed. */
  const [overlayFailure, setOverlayFailure] = useState<{ reason: string; path: string } | null>(null)
  const src = evidenceFileUrl(projectId, evidencePath, null)
  if (src === null) return null

  const failed = () => {
    void imageFailure(src).then((status) => setFailure(FAILURE[status]))
  }
  const openDefault = (file: string) => (event: MouseEvent) => {
    // The window itself never navigates: the file opens through main.
    event.preventDefault()
    onOpen(file)
  }

  if (failure !== null) {
    return (
      <div className="w-evidence__preview w-evidence__preview--failed" data-testid="evidence-preview-failed">
        <span data-testid="evidence-preview-reason">{failure}</span>
        {' · '}
        <a href={path} onClick={openDefault(path)} data-testid="evidence-open-default">
          Open in default app
        </a>
      </div>
    )
  }

  const sheetPath = contactSheetOf(path)
  return (
    <div className="w-evidence__preview" data-testid="evidence-preview" data-kind={kind}>
      {kind === 'screenshot' ? (
        <button type="button" className="w-evidence__thumb" aria-label={`Open ${label}`} title={label} data-testid="evidence-thumb" onClick={() => setOverlay({ src, name: label, path })}>
          <img src={src} alt={label} onError={failed} />
        </button>
      ) : (
        <>
          <video className="w-evidence__video" src={src} controls muted preload="metadata" aria-label={label} data-testid="evidence-video" onError={failed} />
          <a
            href={sheetPath}
            className="w-evidence__sheet"
            data-testid="evidence-sheet"
            onClick={(event) => {
              event.preventDefault()
              const sheet = evidenceFileUrl(projectId, contactSheetOf(evidencePath), null)
              if (sheet !== null) setOverlay({ src: sheet, name: `Contact sheet of ${label}`, path: sheetPath })
            }}
          >
            Contact sheet
          </a>
        </>
      )}
      {overlayFailure === null ? null : (
        <span className="w-evidence__overlay-failed" data-testid="evidence-overlay-failed">
          <span data-testid="evidence-overlay-reason">{overlayFailure.reason}</span>
          {' · '}
          <a href={overlayFailure.path} onClick={openDefault(overlayFailure.path)} data-testid="evidence-open-default">
            Open in default app
          </a>
        </span>
      )}
      {overlay === null ? null : (
        <ImageOverlay
          src={overlay.src}
          name={overlay.name}
          onClose={() => setOverlay(null)}
          onError={() => {
            const shown = overlay
            setOverlay(null)
            void imageFailure(shown.src).then((status) => setOverlayFailure({ reason: FAILURE[status], path: shown.path }))
          }}
          actions={
            <button type="button" className="w-evidence-overlay__open" data-testid="evidence-open-default" onClick={openDefault(overlay.path)}>
              Open in default app
            </button>
          }
        />
      )}
    </div>
  )
}
