import { VIDEO_EXTENSIONS } from '../../../shared/workflow/evidence'

// Which Evidence lines of the matrix get a preview, and the file below the Tickets root each names
// (worfy-evidence ticket 12; the preview itself is EvidencePreview.tsx).

/** The image extensions a screenshot line shows as a thumbnail: those main serves. */
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp)$/i

/**
 * The path below the Tickets root that a ref names, `<epic>/evidence/…`: the ref resolved against the Ticket
 * file's folder `<epic>/issues/`. Null for a ref that leaves the Tickets root, is absolute or has a `\`, or lands
 * outside an `evidence/` folder of an epic: main would not serve it.
 */
export function evidencePathOf(epic: string, ref: string): string | null {
  if (ref.startsWith('/') || ref.includes('\\') || ref.includes(':')) return null
  const parts = [epic, 'issues']
  for (const part of ref.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.pop() === undefined) return null
  }
  return parts.length >= 3 && parts[1] === 'evidence' ? parts.join('/') : null
}

/** What an Evidence line can show in the matrix: a thumbnail of a screenshot, a clip, or nothing. */
export type PreviewKind = 'screenshot' | 'video'

/** The preview a line of `kind` with file `path` gets: by the kind and the file's extension; null for none. */
export function previewKindOf(kind: string, path: string): PreviewKind | null {
  const lower = path.toLowerCase()
  if (kind === 'screenshot' && IMAGE_FILE.test(lower)) return 'screenshot'
  if (kind === 'video' && VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'video'
  return null
}
