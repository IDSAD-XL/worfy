// What went with a sent message, under its text in the transcript (worfy-ui ticket 28): an image
// as a thumbnail, at most 160 px on its longer side, that opens at full size over the window (Escape,
// a click or Close shut it); a document as a chip with an icon of its type, its format and its
// name. No path is shown anywhere. The image comes from main's copy of it by worfy-image://
// (src/shared/images.ts); an image with no copy — none was made, or it is gone — shows as a chip
// with its name instead of a broken picture.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IMAGE_EXTENSIONS, type MessageAttachment } from '../../shared/agent/attachments'
import { attachmentImageUrl } from '../../shared/images'
import { documentKind, formatLabel, formatSize, type DocumentKind } from './attachment-format'

const DOCUMENT_PATHS: Readonly<Record<DocumentKind, string>> = {
  pdf: 'M4 1.75h5L12.5 5.25v9H4zM9 1.75v3.5h3.5M6 9.5h4.5M6 11.75h3',
  text: 'M4 1.75h5L12.5 5.25v9H4zM9 1.75v3.5h3.5M6 7.75h4.5M6 10h4.5M6 12.25h3',
  code: 'M4 1.75h5L12.5 5.25v9H4zM9 1.75v3.5h3.5M7 8.5L5.75 10 7 11.5M9.5 8.5l1.25 1.5-1.25 1.5',
  sheet: 'M3 2.5h10v11H3zM3 6h10M3 9.5h10M7 2.5v11',
  archive: 'M2.75 4.5h10.5v9H2.75zM2 2.5h12v2H2zM8 6.5v1M8 9v1M8 11.5v1',
  other: 'M4 1.75h5L12.5 5.25v9H4zM9 1.75v3.5h3.5',
}

function DocumentIcon({ kind }: { kind: DocumentKind }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={kind}>
      <path d={DOCUMENT_PATHS[kind]} />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon="image">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2.5 11.5l3.5-3.5 3 3 2-2 2.5 2.5" />
    </svg>
  )
}

type ImageAttachment = Extract<MessageAttachment, { kind: 'image' }>
type FileAttachment = Extract<MessageAttachment, { kind: 'file' }>

function DocumentChip({ file }: { file: FileAttachment }) {
  const kind = documentKind(file.ext)
  return (
    <span className="w-msg-file" data-testid="message-file" data-doc-kind={kind} title={file.name}>
      <span className="w-msg-file__icon">
        <DocumentIcon kind={kind} />
      </span>
      <span className="w-msg-file__format w-mono">{formatLabel(file.ext)}</span>
      <span className="w-msg-file__name">{file.name}</span>
      {file.size !== undefined ? <span className="w-msg-file__size w-mono">{formatSize(file.size)}</span> : null}
    </span>
  )
}

/** An image with no copy to show: a chip with its name. */
function ImageChip({ image }: { image: ImageAttachment }) {
  return (
    <span className="w-msg-file" data-testid="message-image-chip" data-doc-kind="image" title={image.name}>
      <span className="w-msg-file__icon">
        <ImageIcon />
      </span>
      <span className="w-msg-file__format w-mono">{IMAGE_EXTENSIONS[image.mediaType].toUpperCase()}</span>
      <span className="w-msg-file__name">{image.name}</span>
    </span>
  )
}

/** The image at full size over the window; Escape, a click on it or Close shut it, and the focus goes back. */
function ImageOverlay({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    // Escape here closes the picture, not the turn (MessageInput) nor focus mode.
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
  return createPortal(
    <div ref={dialog} className="w-image-overlay" role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} data-testid="image-overlay" onKeyDown={onKeyDown} onClick={onClose}>
      <img className="w-image-overlay__image" src={src} alt={name} data-testid="image-overlay-image" />
      <button type="button" className="w-image-overlay__close" aria-label="Close" data-testid="image-overlay-close" onClick={onClose}>
        ×
      </button>
    </div>,
    document.body,
  )
}

function ImagePreview({ image }: { image: ImageAttachment }) {
  const [broken, setBroken] = useState(false)
  const [open, setOpen] = useState(false)
  const src = image.ref === null ? null : attachmentImageUrl(image.ref, image.mediaType)
  if (src === null || broken) return <ImageChip image={image} />
  return (
    <>
      <button type="button" className="w-msg-image" aria-label={`Open ${image.name}`} title={image.name} data-testid="message-image" onClick={() => setOpen(true)}>
        <img src={src} alt={image.name} onError={() => setBroken(true)} />
      </button>
      {open ? <ImageOverlay src={src} name={image.name} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** The attachments of a sent message; nothing when it has none. */
export function MessageAttachments({ attachments }: { attachments: readonly MessageAttachment[] }) {
  if (attachments.length === 0) return null
  return (
    <ul className="w-msg-attachments" aria-label="Attachments" data-testid="message-attachments">
      {attachments.map((each, at) => (
        // Keyed by the image's copy too: another image in this place is tried afresh.
        <li key={`${at}:${each.kind === 'image' ? (each.ref ?? '') : ''}:${each.name}`} className="w-msg-attachments__item">
          {each.kind === 'image' ? <ImagePreview image={each} /> : <DocumentChip file={each} />}
        </li>
      ))}
    </ul>
  )
}
