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
// A new store (the images on the Canvas, worfy-canvas ticket 23: `<Project data folder>/images/`)
// is a new store name, for example `canvas.<project label>` with the project label of worfy-card://
// (src/main/cards/protocol.ts), and a new entry of the store locator in src/main/index.ts.
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

/** The host of `store`: the store itself on this Machine, `<store>.<machine label>` on a Linked machine. */
export const imageHost = ({ store, machineLabel }: ImageHost): string => (machineLabel === null ? store : `${store}.${machineLabel}`)

/** Splits a host: a last part that is a machine label names the Linked machine, the rest is the store. */
export function parseImageHost(host: string): ImageHost {
  const at = host.lastIndexOf('.')
  const last = host.slice(at + 1)
  return at > 0 && MACHINE_LABEL_PATTERN.test(last) ? { store: host.slice(0, at), machineLabel: last } : { store: host, machineLabel: null }
}

/** The address of the copy of a sent image; `machineLabel` names the Linked machine that keeps it, null for this one. */
export const attachmentImageUrl = (ref: string, mediaType: ImageMediaType, machineLabel: string | null): string =>
  `${IMAGE_SCHEME}://${imageHost({ store: ATTACHMENT_IMAGES_STORE, machineLabel })}/${imageFileName(ref, mediaType)}`
