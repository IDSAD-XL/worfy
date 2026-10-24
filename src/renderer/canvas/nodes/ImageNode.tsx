import { useState } from 'react'
import { imageNodeDataSchema } from '../../../shared/ipc/canvas-images'
import { activeProject, useProjects } from '../../projects/useProjects'
import { IMAGE_MIN_SIDE } from '../image-drop'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'
import { canvasImageUrl } from './image-url'
import './ImageNode.css'

// An image pasted or dropped on the Canvas (worfy-canvas ticket 23; ../overlays/ImageDrop.tsx).
// The card's width and height change freely and apart; the image inside never stretches: it is
// fitted into the card whole, centred (object-fit: contain), and the card's own background fills
// the rest. Its bytes are a file in the Project's data folder; the Layout keeps
// `data: { file, width, height, mime }` (src/shared/ipc/canvas-images.ts).
// IMAGE_NODE_KIND of src/shared/ipc/canvas-images.ts; a literal, as the registry's files have it.
export const kind = 'image'
export const defaultWidth = 240
export const defaultHeight = 180
export const minimapColor = 'var(--border-strong)'

/** Fitted whole and centred, at any size of the card: never stretched. */
const FIT = { width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' } as const

export default function ImageNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const projectId = activeProject(useProjects())?.id
  const image = imageNodeDataSchema.safeParse(data.node.data)
  const src = image.success && projectId !== undefined ? canvasImageUrl(projectId, image.data.file) : null
  // The file a failed load was for: a Node whose file changes tries again.
  const [failed, setFailed] = useState<string | null>(null)
  const shown = src !== null && failed !== src
  return (
    <div className="w-node-surface w-image" data-testid="image-node" data-node-id={id}>
      <NodeResizeClamp
        isVisible={selected}
        minWidth={IMAGE_MIN_SIDE}
        minHeight={IMAGE_MIN_SIDE}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      {shown ? (
        <img className="w-image__img" style={FIT} src={src} alt="Image" draggable={false} onError={() => setFailed(src)} />
      ) : (
        <div className="w-image__missing" role="img" aria-label="Image not found">
          Image not found
        </div>
      )}
    </div>
  )
}
