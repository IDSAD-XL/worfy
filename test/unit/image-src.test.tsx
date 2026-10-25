// The address an image Node loads (src/renderer/canvas/nodes/image-url.ts, worfy-canvas ticket 23):
// this Machine's store in its own window; in a window on a Linked machine the address names that
// Machine, and a Machine whose id gives no label gets no address at all — never this Machine's.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const window = vi.hoisted(() => ({ machine: null as string | null }))
vi.mock('../../src/renderer/ipc', () => ({ windowMachine: () => window.machine }))

const { imageSrc } = await import('../../src/renderer/canvas/nodes/image-url')
const { machineLabel } = await import('../../src/shared/cards/bridge')

const FILE = `${'a'.repeat(32)}.png`

beforeEach(() => {
  window.machine = null
})

describe('imageSrc', () => {
  it("this Machine's window: the Project's Canvas store without a machine label", () => {
    expect(imageSrc('alpha-0a1b2c3d', FILE)).toBe(`worfy-image://canvas.0a1b2c3d/${FILE}`)
  })

  it("a Linked machine's window: the address names that Machine", () => {
    window.machine = '01234567-89ab-cdef-0123-456789ABCDEF'
    const label = machineLabel('01234567-89ab-cdef-0123-456789ABCDEF')
    expect(label).toMatch(/^[0-9a-f]{32}$/)
    expect(imageSrc('alpha-0a1b2c3d', FILE)).toBe(`worfy-image://canvas.0a1b2c3d.${label}/${FILE}`)
  })

  it('no address for a Machine without a label, nor for a Project id without one', () => {
    window.machine = ''
    expect(machineLabel('')).toBeNull()
    expect(imageSrc('alpha-0a1b2c3d', FILE)).toBeNull()
    window.machine = null
    expect(imageSrc('alpha', FILE)).toBeNull()
  })
})
