// The worfy-image:// protocol (worfy-ui ticket 28): how the window shows an image worfy keeps in its
// own data folder (ADR-0005), without base64 over IPC and without data: URLs, which the window's
// CSP keeps closed. main serves it (src/main/images/protocol.ts); this file is the address both
// sides build.
//
// The address is worfy-image://<store>[.<machine label>]/<file name>. The store names a folder of
// worfy's data with a fixed pattern of file names; main serves only those names, only from that
// folder:
// - `attachments` — the copies of the images sent in messages, `<data root>/attachments/images/`,
//   named `<sha256>.<ext>` (src/main/agent/attachments.ts).
// The machine label, as in worfy-card:// (machineLabel, src/shared/cards/bridge.ts), names the
// Linked machine whose data folder holds the image: a window on a Linked machine shows that
// Machine's Sessions, and their copies are there. Without it the image is this Machine's. main
// serves this Machine's images only: one of a Linked machine is a 404 for now, and the window shows
// its chip; reading it through the link is worfy-canvas ticket 24.
// - `canvas.<project label>` — the images on a Project's Canvas (worfy-canvas ticket 23),
//   `<Project data folder>/images/`, named `<32 hex>.<ext>` (src/main/layout/images.ts). The project
//   label is the hash that ends the Project's id, as in worfy-card:// (projectIdHash,
//   src/main/projects/store.ts): the rest of an id may hold what a host cannot carry. A URL spells this
//   store `canvas-<project label>` (imageHost; worfy-evidence ticket 12): the window (Chromium) reads a
//   host whose last part is all digits as an IPv4 address and refuses the URL, and a project label of 8
//   hex digits is all digits for about 2 % of Projects (`canvas.00000006` is not a URL there). The
//   store's name stays `canvas.<project label>` everywhere else — in main, and over the link to a Linked
//   machine, whose worfy may be older — and parseImageHost reads both spellings.
// - `evidence-<project label>` — the Evidence files of a Project's Tickets (worfy-evidence ticket 12):
//   screenshots and clips in `<epic>/evidence/` of its Tickets root (the Workflow folder's in Silent
//   mode), up to 8 MB. Its file name is a path below the Tickets root in one segment
//   (`<epic>%2Fevidence%2F<file>`); main serves only `<epic>/evidence/…` there, clips too, and only
//   to this Machine's window (src/main/images/stores.ts). A `-`, not a `.`, before the label: the window
//   (Chromium) reads a host whose last part is all digits as an IPv4 address and refuses the URL, and a
//   project label of 8 hex digits is all digits now and then (`evidence.00000006`).
// A new store is a new store name and a new entry of the store locator in src/main/index.ts.
import { imageFileName, type ImageMediaType } from './agent/attachments'
import { MACHINE_LABEL_PATTERN } from './cards/bridge'

export const IMAGE_SCHEME = 'worfy-image'

/** The store of the images sent in messages. */
export const ATTACHMENT_IMAGES_STORE = 'attachments'

/** What the host of a worfy-image:// address names: a store, on this Machine (machineLabel null) or on a Linked machine. */
export interface ImageHost {
  store: string
  machineLabel: string | null
}

/** The store name of a Project's Canvas images, `canvas.<project label>`, and its spelling in a URL host, `canvas-<project label>`. */
const CANVAS_STORE_NAME = /^canvas\.([0-9a-f]{8})$/
const CANVAS_STORE_HOST = /^canvas-([0-9a-f]{8})$/

/**
 * The host of `store`: the store itself on this Machine, `<store>.<machine label>` on a Linked machine.
 * `canvas.<project label>` is spelled `canvas-<project label>`, so a project label is never the last part of
 * the host (the top of this file).
 */
export function imageHost({ store, machineLabel }: ImageHost): string {
  const spelled = store.replace(CANVAS_STORE_NAME, 'canvas-$1')
  return machineLabel === null ? spelled : `${spelled}.${machineLabel}`
}

/**
 * Splits a host: a last part that is a machine label names the Linked machine, the rest is the store. The
 * store comes back by its name: `canvas-<project label>` and the older `canvas.<project label>` are both the
 * store `canvas.<project label>`.
 */
export function parseImageHost(host: string): ImageHost {
  const at = host.lastIndexOf('.')
  const last = host.slice(at + 1)
  const split = at > 0 && MACHINE_LABEL_PATTERN.test(last) ? { store: host.slice(0, at), machineLabel: last } : { store: host, machineLabel: null }
  return { ...split, store: split.store.replace(CANVAS_STORE_HOST, 'canvas.$1') }
}

/** The address of the copy of a sent image; `machineLabel` names the Linked machine that keeps it, null for this one. */
export const attachmentImageUrl = (ref: string, mediaType: ImageMediaType, machineLabel: string | null): string =>
  `${IMAGE_SCHEME}://${imageHost({ store: ATTACHMENT_IMAGES_STORE, machineLabel })}/${imageFileName(ref, mediaType)}`

/** The first part of the store name of a Project's Canvas images: `canvas.<project label>`. */
export const CANVAS_IMAGES_STORE = 'canvas'

/**
 * The project label of a Project id: the 8 hex digits that end it (projectIdHash of
 * src/main/projects/store.ts, which the renderer cannot import); null for an id without them.
 */
export const projectLabelOf = (projectId: string): string | null => /-([0-9a-f]{8})$/.exec(projectId)?.[1] ?? null

/** The store name of a Project's Canvas images; null for a Project id without a project label. */
export function canvasImagesStore(projectId: string): string | null {
  const label = projectLabelOf(projectId)
  return label === null ? null : `${CANVAS_IMAGES_STORE}.${label}`
}

/**
 * The address of an image on a Project's Canvas; `machineLabel` names the Linked machine whose
 * Project it is, null for this Machine. Null for a Project id without a project label.
 */
export function canvasImageUrl(projectId: string, file: string, machineLabel: string | null): string | null {
  const store = canvasImagesStore(projectId)
  return store === null ? null : `${IMAGE_SCHEME}://${imageHost({ store, machineLabel })}/${encodeURIComponent(file)}`
}

/** The first part of the store name of a Project's Evidence files: `evidence-<project label>`. */
export const EVIDENCE_IMAGES_STORE = 'evidence'

/** The largest Evidence file served: the limit of a clip in the privacy check (harness/bin/evidence-check, Qv2 of the Epic). */
export const EVIDENCE_FILE_LIMIT_BYTES = 8 * 1024 * 1024

/** One part of a path: not empty, not `.` or `..`, no separator, no `:` (a drive or a stream on Windows), no NUL. */
const PART = String.raw`(?!\.{1,2}(?:/|$))[^/\\:\0]+`

/** The names of the Evidence store: `<epic>/evidence/<file>`, or a file in a folder below it, relative to the Tickets root. */
export const EVIDENCE_FILE_PATTERN = new RegExp(`^${PART}/evidence/(?:${PART}/)*${PART}$`)

/** The store name of a Project's Evidence files; null for a Project id without a project label. */
export function evidenceImagesStore(projectId: string): string | null {
  const label = projectLabelOf(projectId)
  return label === null ? null : `${EVIDENCE_IMAGES_STORE}-${label}`
}

/**
 * The address of an Evidence file, `relPath` relative to the Project's Tickets root with `/` between
 * its parts (`<epic>/evidence/<file>`), in one segment; `machineLabel` names the Linked machine whose
 * Project it is, null for this Machine. Null for a Project id without a project label.
 */
export function evidenceFileUrl(projectId: string, relPath: string, machineLabel: string | null): string | null {
  const store = evidenceImagesStore(projectId)
  return store === null ? null : `${IMAGE_SCHEME}://${imageHost({ store, machineLabel })}/${encodeURIComponent(relPath)}`
}
