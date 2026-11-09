// «Product Session may also write here» in a Project's settings (worfy-polish ticket 82,
// src/main/projects/settings.ts): «Always allow in <folder>» adds a folder once, a Save that does not
// send the list keeps it, a Save that sends it (a removal in Project settings) replaces it, and a list
// a later worfy or a hand edit spoiled reads as none.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addProductWriteFolder, readProjectSettings, settingsPath, writeProjectSettings } from '../../src/main/projects/settings'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import { removeTestTree } from '../remove'

describe("the Project's list of folders a Product Session may also write in", () => {
  let dir: string
  const templates = defaultProjectSettings('none').actionTemplates

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'worfy-product-write-folders-'))
  })
  afterEach(() => removeTestTree(dir))

  it('is absent until «Always allow» adds a folder, which is then saved once, after the others', () => {
    writeProjectSettings(dir, { actionTemplates: templates, defaultVendor: 'codex' }, 'none')
    expect(readProjectSettings(dir, 'none').productWriteFolders).toBeUndefined()
    addProductWriteFolder(dir, '/repo/context/strong', 'none')
    addProductWriteFolder(dir, '/repo/context/weak', 'none')
    expect(addProductWriteFolder(dir, '/repo/context/strong', 'none').productWriteFolders).toEqual(['/repo/context/strong', '/repo/context/weak'])
    // Every other setting stays.
    expect(readProjectSettings(dir, 'none')).toMatchObject({ defaultVendor: 'codex', actionTemplates: templates })
    expect(JSON.parse(readFileSync(settingsPath(dir), 'utf8'))).toMatchObject({ productWriteFolders: ['/repo/context/strong', '/repo/context/weak'] })
  })

  it('stays as saved through a Save without it, and is replaced by a Save with it (a removal in Project settings)', () => {
    addProductWriteFolder(dir, '/repo/a', 'none')
    addProductWriteFolder(dir, '/repo/b', 'none')
    expect(writeProjectSettings(dir, { actionTemplates: templates }, 'none').productWriteFolders).toEqual(['/repo/a', '/repo/b'])
    expect(writeProjectSettings(dir, { actionTemplates: templates, productWriteFolders: ['/repo/b'] }, 'none').productWriteFolders).toEqual(['/repo/b'])
    expect(writeProjectSettings(dir, { actionTemplates: templates, productWriteFolders: [] }, 'none').productWriteFolders).toEqual([])
  })

  it('reads a list it cannot read as none, and keeps the rest of the file', () => {
    writeFileSync(settingsPath(dir), JSON.stringify({ actionTemplates: templates, defaultVendor: 'claude', productWriteFolders: 'everywhere' }))
    const read = readProjectSettings(dir, 'none')
    expect(read.productWriteFolders).toBeUndefined()
    expect(read.defaultVendor).toBe('claude')
    expect(() => writeProjectSettings(dir, { actionTemplates: templates, productWriteFolders: [''] }, 'none')).toThrow()
  })
})
