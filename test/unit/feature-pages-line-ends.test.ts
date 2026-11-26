// The feature pages with Windows line ends (worfy-assistant ticket 17): a Windows checkout, and so a Windows build,
// holds docs/features with CRLF. The pages are read with their line ends made \n once, so the headings, the sections,
// the search and the text the Assistant reads are the same as on macOS.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/repo' } }))

const EN = ['# Epic frames', '', '## Epic frame', '', 'A frame holds the Tickets of an Epic.', '', '## Done shelf', '', 'The Done shelf keeps the Tickets that are done.', '']
const RU = ['# Epic frames', '', '## Epic frame', '', 'Рамка держит Ticket-ы Epic-а.', '', '## Done shelf', '', 'Полка готового хранит сделанные Ticket-ы.', '']

let dir: string | null = null
afterEach(() => {
  if (dir !== null) removeTestTree(dir)
  dir = null
})

/** A folder of pages as a Windows checkout holds it: CRLF in English, a lone CR in Russian. */
function windowsPages(): string {
  dir = mkdtempSync(join(tmpdir(), 'worfy-feature-pages-'))
  mkdirSync(join(dir, 'ru'))
  writeFileSync(join(dir, 'epic-frames.md'), EN.join('\r\n'))
  writeFileSync(join(dir, 'ru', 'epic-frames.md'), RU.join('\r'))
  return dir
}

describe('feature pages with CRLF line ends', () => {
  it('are read with \\n only', async () => {
    const { readFeaturePages } = await import('../../src/main/assistant/help/feature-pages')
    const files = await readFeaturePages(windowsPages())
    expect(files.map((file) => [file.language, file.text])).toEqual([
      ['en', EN.join('\n')],
      ['ru', RU.join('\n')],
    ])
  })

  it('a search finds the section, and a section is read whole, in both languages', async () => {
    const { readFeaturePages, readFeaturePage, searchFeaturePages } = await import('../../src/main/assistant/help/feature-pages')
    const files = await readFeaturePages(windowsPages())
    for (const [language, query] of [
      ['en', 'Done shelf'],
      ['ru', 'полка готового'],
    ] as const) {
      const options = { language, version: null }
      expect(searchFeaturePages(files, query, 5, options)).toEqual([expect.objectContaining({ page: 'epic-frames', language, title: 'Epic frames', sections: ['Done shelf'] })])
      const read = readFeaturePage(files, 'epic-frames', 'Done shelf', options)
      expect(read.sections).toEqual(['Epic frame', 'Done shelf'])
      expect(read.text).toBe((language === 'en' ? EN : RU).slice(6).join('\n'))
      expect(read.text).not.toMatch(/\r/u)
    }
  })
})
