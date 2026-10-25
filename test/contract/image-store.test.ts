// storeImages (src/main/agent/attachments.ts, worfy-ui ticket 28) when the rename into place fails:
// a copy another writer has just put there is kept and nothing is reported (Windows refuses to
// rename over such a file); without a copy the failure is reported once, and no temporary file
// is left. The rename is replaced; every other file call is the real one, on a temporary folder.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { imageRef, storeImages } from '../../src/main/agent/attachments'
import type { Attachment } from '../../src/shared/agent/attachments'
import { removeTestTree } from '../remove'

const fs = vi.hoisted(() => ({ rename: null as null | ((from: string, to: string) => Promise<void>), uuid: null as string | null }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real, rename: (from: string, to: string) => (fs.rename ?? real.rename)(from, to) }
})

vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>()
  return { ...real, randomUUID: () => fs.uuid ?? real.randomUUID() }
})

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)])
const image: Attachment = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: PNG.length, data: PNG.toString('base64') }
const refused = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })

let dir: string

beforeEach(() => {
  dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'worfy-image-store-'))), 'images')
})

afterEach(async () => {
  fs.rename = null
  fs.uuid = null
  await removeTestTree(join(dir, '..'))
})

describe('storeImages when the rename into place fails', () => {
  it('keeps the copy another writer has just put there, and reports nothing', async () => {
    const path = join(dir, `${imageRef(PNG.toString('base64'))}.png`)
    fs.rename = async () => {
      writeFileSync(path, PNG)
      throw refused()
    }
    const report = vi.fn()
    await storeImages([image], dir, report)
    expect(report).not.toHaveBeenCalled()
    expect(readFileSync(path)).toEqual(PNG)
    expect(readdirSync(dir)).toEqual([`${imageRef(PNG.toString('base64'))}.png`])
  })

  it('reports the failure once when there is no copy, and leaves no temporary file', async () => {
    fs.rename = async () => {
      throw refused()
    }
    const report = vi.fn()
    await storeImages([image], dir, report)
    expect(report).toHaveBeenCalledOnce()
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('storeImages and what is already at its paths', () => {
  const copyName = () => `${imageRef(PNG.toString('base64'))}.png`

  it('a folder where the copy goes is no copy: the failure to put one there is reported', async () => {
    mkdirSync(join(dir, copyName()), { recursive: true })
    const report = vi.fn()
    await storeImages([image], dir, report)
    expect(report).toHaveBeenCalledOnce()
  })

  it('never writes through a link planted at the temporary path: the file it points to stays as it was', async () => {
    fs.uuid = '00000000-0000-4000-8000-000000000000'
    mkdirSync(dir, { recursive: true })
    const outside = join(dir, '..', 'outside.txt')
    writeFileSync(outside, 'not yours')
    symlinkSync(outside, join(dir, `${copyName()}.${fs.uuid}.tmp`))
    const report = vi.fn()
    await storeImages([image], dir, report)
    expect(readFileSync(outside, 'utf8')).toBe('not yours')
    expect(report).toHaveBeenCalledOnce()
  })
})
