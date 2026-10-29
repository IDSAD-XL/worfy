import { useState } from 'react'
import { imageNodeDataSchema } from '../../../shared/ipc/canvas-images'
import type { ImageStatus } from '../../../shared/ipc/images'
import { activeProject, useProjects } from '../../projects/useProjects'
import { IMAGE_MIN_SIDE } from '../image-drop'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'
import { imageFailure, imageSrc, imagesOfLinkedMachine } from './image-url'
import './ImageNode.css'

// An image pasted or dropped on the Canvas (worfy-canvas ticket 23; ../overlays/ImageDrop.tsx).
// The card's width and height change freely and apart; the image inside never stretches: it is
// fitted into the card whole, centred (object-fit: contain), and the card's own background fills
// the rest. Its bytes are a file in the Project's data folder; the Layout keeps
// `data: { file, width, height, mime }` (src/shared/ipc/canvas-images.ts).
//
// On the Canvas of a Linked machine (worfy-canvas ticket 24) the image comes from that Machine over
// the link and is only shown: no resize handles, and the selection's Delete leaves it alone
// (deletableNodes, ../history.ts). An image that does not load says why, as main tells it
// (images.status): not there, too large, or the Linked machine did not answer.
// IMAGE_NODE_KIND of src/shared/ipc/canvas-images.ts; a literal, as the registry's files have it.
export const kind = 'image'
export const defaultWidth = 240
export const defaultHeight = 180
export const minimapColor = 'var(--border-strong)'

/** The text of the plate shown instead of an image that did not load, by what main says of it. */
const IMAGE_FAILURE_TEXT: Readonly<Record<ImageStatus, string>> = {
  ok: 'Image not available',
  missing: 'Image not available',
  'too-large': 'Image too large',
  unreachable: 'Image not available: the Linked machine is not reachable',
}

/** Fitted whole and centred, at any size of the card: never stretched. */
const FIT = { width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' } as const

export default function ImageNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const projectId = activeProject(useProjects())?.id
  const image = imageNodeDataSchema.safeParse(data.node.data)
  const src = image.success && projectId !== undefined ? imageSrc(projectId, image.data.file) : null
  // The address a failed load was for, and why it failed once main has told: a Node whose file changes tries again.
  const [failed, setFailed] = useState<{ src: string; status: ImageStatus } | null>(null)
  const shown = src !== null && failed?.src !== src
  const failure = IMAGE_FAILURE_TEXT[src !== null && failed?.src === src ? failed.status : 'missing']
  const onError = (address: string) => {
    setFailed({ src: address, status: 'missing' })
    void imageFailure(address).then((status) => setFailed((current) => (current?.src === address ? { src: address, status } : current)))
  }
  return (
    <div className="w-node-surface w-image" data-testid="image-node" data-node-id={id}>
      {imagesOfLinkedMachine() ? null : (
        <NodeResizeClamp
          isVisible={selected}
          minWidth={IMAGE_MIN_SIDE}
          minHeight={IMAGE_MIN_SIDE}
          onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
        />
      )}
      {shown ? (
        <img className="w-image__img" style={FIT} src={src} alt="Image" draggable={false} onError={() => onError(src)} />
      ) : (
        <div className="w-image__missing" role="img" aria-label={failure}>
          {failure}
        </div>
      )}
    </div>
  )
}
