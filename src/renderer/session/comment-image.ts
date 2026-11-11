import { IMAGE_LIMIT_BYTES, type AttachmentSource } from '../../shared/agent/attachments'
import { base64Of } from './attach-files'
import { scaledSize } from './quote-comments'

// An image of a quote comment (worfy-polish ticket 102, owner's answer 3): its long side is scaled
// down to IMAGE_EDGE px before it goes to main to be checked (agent.attach), so a Retina screenshot
// costs the agent's context what the model would scale it to anyway. A scaled image is written as
// WebP, which keeps transparency and is a type the Messages API takes; an image that needs no scaling
// and fits the size limit keeps its own bytes.

/** The WebP quality of a scaled image. */
const QUALITY = 0.86

/** The image's name, or `image.png` for a pasted one with none. */
const nameOf = (file: File): string => (file.name === '' ? 'image.png' : file.name)

/** `shot.png` scaled becomes `shot.webp`. */
const webpName = (name: string): string => `${name.replace(/\.[^./\\]+$/, '')}.webp`

/** Reads an image file as an attachment source for main, scaled down when it is larger than IMAGE_EDGE. */
export async function readCommentImage(file: File): Promise<AttachmentSource> {
  const name = nameOf(file)
  const bitmap = await createImageBitmap(file)
  try {
    const size = scaledSize(bitmap.width, bitmap.height)
    if (!size.scaled && file.size <= IMAGE_LIMIT_BYTES) return { kind: 'pasted', name, data: await base64Of(file) }
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error(`${name} could not be scaled`)
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const url = canvas.toDataURL('image/webp', QUALITY)
    return { kind: 'pasted', name: webpName(name), data: url.slice(url.indexOf(',') + 1) }
  } finally {
    bitmap.close()
  }
}
