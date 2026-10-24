// The image Node (src/renderer/canvas/nodes/ImageNode.tsx) and what makes it (canvas/image-drop.ts),
// worfy-canvas ticket 23: the card resizes freely and apart in width and height, the image is
// fitted inside it whole and centred (object-fit: contain) at any proportions; a new Node starts at
// the image's natural size, its longer side at most 480 px, never enlarged.
import { act, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_CASCADE_STEP, IMAGE_MAX_SIDE, IMAGE_MIN_SIDE, addImages, initialImageSize, type ImageDropDeps } from '../../src/renderer/canvas/image-drop'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'
import { CANVAS_IMAGE_LIMIT_BYTES, type CanvasImageResult } from '../../src/shared/ipc/canvas-images'
import type { IpcResult } from '../../src/shared/ipc/channels'
import type { LayoutOpInput } from '../../src/shared/layout/types'

const resizer = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('../../src/renderer/canvas/NodeResizeClamp', () => ({
  NodeResizeClamp: (props: Record<string, unknown>) => {
    resizer.props.push(props)
    return null
  },
}))
vi.mock('../../src/renderer/projects/useProjects', async (original) => ({
  ...(await original<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ projects: [{ id: 'demo-0a1b2c3d', name: 'demo', path: '/repo' }], activeId: 'demo-0a1b2c3d' }),
}))
vi.mock('../../src/renderer/canvas/nodes/image-url', () => ({
  canvasImageUrl: (projectId: string, file: string) => `test-image://${projectId}/${file}`,
}))

const { default: ImageNode } = await import('../../src/renderer/canvas/nodes/ImageNode')

const FILE = `${'a'.repeat(32)}.png`

function renderNode(w: number, h: number, data: Record<string, unknown> = { file: FILE, width: 400, height: 200, mime: 'image/png' }) {
  const sent: LayoutOpInput[] = []
  const ops: LayoutOps = {
    apply: (op) => {
      sent.push(op)
      return Promise.resolve()
    },
  }
  const props = { id: 'pic', data: { node: { id: 'pic', kind: 'image', x: 0, y: 0, w, h, data } }, selected: true, width: w, height: h } as unknown as CanvasNodeProps
  render(
    <ReactFlowProvider>
      <LayoutOpsContext.Provider value={ops}>
        <ImageNode {...props} />
      </LayoutOpsContext.Provider>
    </ReactFlowProvider>,
  )
  return { sent }
}

afterEach(() => {
  resizer.props.length = 0
})

describe('the image inside the card', () => {
  for (const [w, h] of [
    [1000, 50],
    [50, 1000],
    [400, 200],
  ] as const) {
    it(`is fitted whole and centred in a ${w} × ${h} card, never stretched`, () => {
      renderNode(w, h)
      const image = screen.getByRole('img', { name: 'Image' }) as HTMLImageElement
      expect(image.style.objectFit).toBe('contain')
      expect(image.style.objectPosition).toBe('center')
      expect(image.style.width).toBe('100%')
      expect(image.style.height).toBe('100%')
      expect(image.getAttribute('src')).toBe(`test-image://demo-0a1b2c3d/${FILE}`)
      // A press drags the Node, not the picture.
      expect(image.draggable).toBe(false)
    })
  }

  it('resizes width and height apart, down to its smallest size', async () => {
    const { sent } = renderNode(400, 200)
    const props = resizer.props.at(-1)!
    expect(props.keepAspectRatio).toBeFalsy()
    expect(props).toMatchObject({ isVisible: true, minWidth: IMAGE_MIN_SIDE, minHeight: IMAGE_MIN_SIDE })
    expect(IMAGE_MIN_SIDE).toBe(48)
    const onResizeEnd = props.onResizeEnd as (event: unknown, params: { x: number; y: number; width: number; height: number }) => void
    await act(async () => onResizeEnd({}, { x: 10, y: 20, width: 1000, height: 50 }))
    expect(sent).toEqual([{ op: 'resize', id: 'pic', x: 10, y: 20, w: 1000, h: 50 }])
  })

  it('shows "Image not found" when the file does not load, and for data that names no image file', () => {
    renderNode(200, 100)
    act(() => {
      screen.getByRole('img', { name: 'Image' }).dispatchEvent(new Event('error'))
    })
    expect(screen.getByRole('img', { name: 'Image not found' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Image' })).toBeNull()
  })

  it('shows "Image not found" for data that is not an image file of the store', () => {
    renderNode(200, 100, { file: '../../etc/passwd', width: 1, height: 1, mime: 'image/png' })
    expect(screen.getByRole('img', { name: 'Image not found' })).toBeTruthy()
  })
})

describe('the size a new image Node starts at', () => {
  it('a big image is scaled down to 480 px on its longer side, keeping its proportions', () => {
    expect(IMAGE_MAX_SIDE).toBe(480)
    expect(initialImageSize(4000, 1000)).toEqual({ w: 480, h: 120 })
    expect(initialImageSize(1000, 4000)).toEqual({ w: 120, h: 480 })
    expect(initialImageSize(1920, 1080)).toEqual({ w: 480, h: 270 })
    expect(initialImageSize(481, 481)).toEqual({ w: 480, h: 480 })
  })

  it('a small image keeps its natural size: it is never enlarged', () => {
    expect(initialImageSize(300, 200)).toEqual({ w: 300, h: 200 })
    expect(initialImageSize(480, 100)).toEqual({ w: 480, h: 100 })
  })

  it('no side is below the smallest size', () => {
    expect(initialImageSize(5000, 3)).toEqual({ w: 480, h: 48 })
    expect(initialImageSize(10, 10)).toEqual({ w: 48, h: 48 })
  })
})

describe('addImages: pasted and dropped files become image Nodes', () => {
  const stored = (n: number, width = 400, height = 200): IpcResult<CanvasImageResult> => ({
    ok: true,
    value: { ok: true, image: { file: `${String(n).repeat(32)}.png`, width, height, mime: 'image/png' } },
  })

  function deps(answers: IpcResult<CanvasImageResult>[]) {
    const sent: { op: LayoutOpInput; group: unknown }[] = []
    const refused: string[] = []
    const read = vi.fn((file: File) => Promise.resolve(`data-of-${file.name}`))
    const store = vi.fn<ImageDropDeps['store']>(() => Promise.resolve(answers.shift()!))
    const value: ImageDropDeps = {
      projectId: 'demo-0a1b2c3d',
      ops: {
        apply: (op, group) => {
          sent.push({ op, group })
          return Promise.resolve()
        },
      },
      store,
      refuse: (message) => refused.push(message),
      read,
    }
    return { value, sent, refused, read, store }
  }

  const file = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'image/png' })

  it('each file is a Node centred on the point, the next ones cascading right and down, in one undo step', async () => {
    const d = deps([stored(1), stored(2, 1000, 4000)])
    expect(await addImages([file('a.png'), file('b.png')], { x: 500, y: 300 }, d.value)).toBe(2)
    expect(d.store.mock.calls.map(([input]) => input)).toEqual([
      { projectId: 'demo-0a1b2c3d', name: 'a.png', data: 'data-of-a.png' },
      { projectId: 'demo-0a1b2c3d', name: 'b.png', data: 'data-of-b.png' },
    ])
    expect(d.sent.map(({ op }) => op)).toEqual([
      { op: 'create', node: { kind: 'image', x: 300, y: 200, w: 400, h: 200, data: { file: `${'1'.repeat(32)}.png`, width: 400, height: 200, mime: 'image/png' } } },
      {
        op: 'create',
        node: { kind: 'image', x: 500 - 60 + IMAGE_CASCADE_STEP, y: 300 - 240 + IMAGE_CASCADE_STEP, w: 120, h: 480, data: { file: `${'2'.repeat(32)}.png`, width: 1000, height: 4000, mime: 'image/png' } },
      },
    ])
    expect(d.sent[0]!.group).toBeDefined()
    expect(d.sent[1]!.group).toBe(d.sent[0]!.group)
    expect(d.refused).toEqual([])
  })

  it('a file over 20 MB is refused before it is read; the other files still go on, without a gap in the cascade', async () => {
    const d = deps([stored(3)])
    const huge = { name: 'huge.png', size: CANVAS_IMAGE_LIMIT_BYTES + 1, type: 'image/png' } as File
    expect(await addImages([huge, file('ok.png')], { x: 0, y: 0 }, d.value)).toBe(1)
    expect(d.refused).toEqual(['huge.png is too large: images on the canvas go up to 20 MB'])
    expect(d.read).toHaveBeenCalledTimes(1)
    expect(d.sent[0]!.op).toMatchObject({ node: { x: -200, y: -100 } })
  })

  it("main's refusal is shown and makes no Node; so is a failed call", async () => {
    const d = deps([
      { ok: true, value: { ok: false, error: 'logo.svg is an SVG image, which the canvas does not take: use a PNG, JPEG, GIF or WebP' } },
      { ok: false, error: 'main is gone' },
    ])
    expect(await addImages([file('logo.svg'), file('x.png')], { x: 0, y: 0 }, d.value)).toBe(0)
    expect(d.sent).toEqual([])
    expect(d.refused).toEqual(['logo.svg is an SVG image, which the canvas does not take: use a PNG, JPEG, GIF or WebP', 'x.png could not be added: main is gone'])
  })

  it('a pasted image without a name is called "Pasted image"; a file that cannot be read is refused', async () => {
    const d = deps([stored(4)])
    d.read.mockImplementationOnce(() => Promise.reject(new Error('broken.png could not be read')))
    expect(await addImages([file('broken.png'), file('')], { x: 0, y: 0 }, d.value)).toBe(1)
    expect(d.refused).toEqual(['broken.png could not be read'])
    expect(d.store.mock.calls[0]![0].name).toBe('Pasted image')
  })
})
