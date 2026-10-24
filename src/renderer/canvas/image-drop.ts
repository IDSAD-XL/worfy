// Images pasted or dropped on the Canvas (worfy-canvas ticket 23) become `image` Nodes. The
// renderer reads the bytes; main checks them, stores the file and answers with its name, natural
// size and type (`canvasImage.add`, src/main/layout/images.ts). The Node is then created through
// the Canvas's LayoutOps, so ⌘Z takes it away again. No React here: overlays/ImageDrop.tsx listens
// to the window and calls addImages().
import { CANVAS_IMAGE_LIMIT_BYTES, canvasImageTooLarge, IMAGE_NODE_KIND, type CanvasImageResult } from '../../shared/ipc/canvas-images'
import type { IpcResult } from '../../shared/ipc/channels'
import { base64Of } from '../session/attach-files'
import { grouped } from './history'
import type { LayoutOps } from './layout-ops'

/** The longest side of a new image Node: a bigger image starts scaled down to it. */
export const IMAGE_MAX_SIDE = 480
/** The smallest side of an image Node, so it can still be found and taken. */
export const IMAGE_MIN_SIDE = 48
/** How far right and down each next image of one paste or drop lands, so none covers another. */
export const IMAGE_CASCADE_STEP = 32

/**
 * The size a new image Node starts at: the image's natural size, scaled down so that its longer
 * side is at most IMAGE_MAX_SIDE, never scaled up; each side at least IMAGE_MIN_SIDE.
 */
export function initialImageSize(width: number, height: number): { w: number; h: number } {
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height))
  return { w: Math.max(IMAGE_MIN_SIDE, Math.round(width * scale)), h: Math.max(IMAGE_MIN_SIDE, Math.round(height * scale)) }
}

/** The name a file is called by in a message; a pasted image may have none. */
const nameOf = (file: File): string => (file.name === '' ? 'Pasted image' : file.name)

/** What addImages() uses; the app's own, or fakes in a test. */
export interface ImageDropDeps {
  projectId: string
  ops: LayoutOps
  store: (input: { projectId: string; name: string; data: string }) => Promise<IpcResult<CanvasImageResult>>
  /** Shows why an image was refused. */
  refuse: (message: string) => void
  /** The bytes of a file in base64; base64Of of attach-files.ts by default. */
  read?: (file: File) => Promise<string>
}

/**
 * Turns the files into image Nodes, the first centred on `at` (a point of the plane), each next one
 * IMAGE_CASCADE_STEP further right and down; all of them one step of the undo history. A file over
 * the limit is refused before it is read; main refuses what is not a png, jpeg, gif or webp. Each
 * refusal is shown, and the other files still go on. Resolves with the number of Nodes made.
 */
export async function addImages(files: readonly File[], at: { x: number; y: number }, deps: ImageDropDeps): Promise<number> {
  const read = deps.read ?? base64Of
  return grouped(async (group) => {
    let made = 0
    for (const file of files) {
      const name = nameOf(file)
      if (file.size > CANVAS_IMAGE_LIMIT_BYTES) {
        deps.refuse(canvasImageTooLarge(name))
        continue
      }
      let data: string
      try {
        data = await read(file)
      } catch (reason) {
        deps.refuse(reason instanceof Error ? reason.message : String(reason))
        continue
      }
      const answer = await deps.store({ projectId: deps.projectId, name, data })
      if (!answer.ok) {
        deps.refuse(`${name} could not be added: ${answer.error}`)
        continue
      }
      if (!answer.value.ok) {
        deps.refuse(answer.value.error)
        continue
      }
      const { image } = answer.value
      const { w, h } = initialImageSize(image.width, image.height)
      const shift = made * IMAGE_CASCADE_STEP
      await deps.ops.apply({ op: 'create', node: { kind: IMAGE_NODE_KIND, x: Math.round(at.x - w / 2 + shift), y: Math.round(at.y - h / 2 + shift), w, h, data: { ...image } } }, group)
      made += 1
    }
    return made
  })
}
