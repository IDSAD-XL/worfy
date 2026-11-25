// The feature pages in the build (worfy-assistant ticket 17; spec, the section on the introduction and help): docs/features, English
// and Russian, go into the packaged app, where the Assistant's tools features_search and features_read read them.
// Nothing here builds anything: the settings of electron-builder.yml are checked against the folder main reads, and
// the pages the filter takes against the pages of the repository.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')
const builder = readFileSync(join(REPO, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n')

const electron = vi.hoisted(() => ({ app: { isPackaged: false, getAppPath: () => '/repo' } }))
vi.mock('electron', () => electron)

/** The entries of extraResources, each its from, to and filter, comments and blank lines left out. */
function extraResources(): { from: string; to: string; filter: string[] }[] {
  const lines = builder.split('\n')
  const start = lines.indexOf('extraResources:')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line))
  const entries: { from: string; to: string; filter: string[] }[] = []
  let inFilter = false
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const from = /^- from: (\S+)$/u.exec(trimmed)?.[1]
    if (from !== undefined) {
      entries.push({ from, to: '', filter: [] })
      inFilter = false
      continue
    }
    const entry = entries.at(-1)!
    const to = /^to: (\S+)$/u.exec(trimmed)?.[1]
    if (to !== undefined) entry.to = to
    else if (trimmed === 'filter:') inFilter = true
    else if (inFilter && trimmed.startsWith('- ')) entry.filter.push(trimmed.slice(2).replace(/^'(.*)'$/u, '$1'))
  }
  return entries
}

describe('the feature pages in the packaged build', () => {
  it('electron-builder.yml puts docs/features, its Markdown pages only, into the folder main reads', async () => {
    const { FEATURE_PAGES_RESOURCE } = await import('../../src/main/assistant/help/feature-pages')
    expect(extraResources()).toContainEqual({ from: 'docs/features', to: FEATURE_PAGES_RESOURCE, filter: ['**/*.md'] })
  })

  it('the filter takes the English pages and the Russian translation under ru/', () => {
    const english = readdirSync(join(REPO, 'docs', 'features')).filter((name) => name.endsWith('.md'))
    const russian = readdirSync(join(REPO, 'docs', 'features', 'ru')).filter((name) => name.endsWith('.md'))
    expect(english.length).toBeGreaterThan(10)
    // `**/*.md` reaches into ru/: every translation a page has goes into the build with it.
    expect(russian.filter((name) => !english.includes(name))).toEqual([])
    expect(russian.length).toBeGreaterThan(10)
  })

  it('main reads them from <resources>/features in the packaged app, and from docs/features of the checkout otherwise', async () => {
    const { featurePagesDir, FEATURE_PAGES_RESOURCE } = await import('../../src/main/assistant/help/feature-pages')
    electron.app.isPackaged = true
    const resourcesPath = process.resourcesPath
    Object.defineProperty(process, 'resourcesPath', { value: '/Applications/worfy.app/Contents/Resources', configurable: true })
    try {
      expect(featurePagesDir()).toBe(join('/Applications/worfy.app/Contents/Resources', FEATURE_PAGES_RESOURCE))
    } finally {
      Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
      electron.app.isPackaged = false
    }
    expect(featurePagesDir()).toBe(join('/repo', 'docs', 'features'))
  })

  it('reads every page of both languages from that folder', async () => {
    const { readFeaturePages } = await import('../../src/main/assistant/help/feature-pages')
    const files = await readFeaturePages(join(REPO, 'docs', 'features'))
    const canvas = files.filter((file) => file.name === 'canvas')
    expect(canvas.map((file) => file.language).sort()).toEqual(['en', 'ru'])
    expect(canvas.find((file) => file.language === 'ru')!.text).toMatch(/^# Canvas\n/u)
  })

  it('a search over the real pages finds the page of a feature, and nothing for what worfy does not do', async () => {
    const { readFeaturePages, searchFeaturePages } = await import('../../src/main/assistant/help/feature-pages')
    const files = await readFeaturePages(join(REPO, 'docs', 'features'))
    for (const language of ['en', 'ru'] as const) {
      const options = { language, version: null }
      expect(searchFeaturePages(files, 'Done shelf', 5, options)[0]).toMatchObject({ page: 'epic-frames', language })
      expect(searchFeaturePages(files, 'espresso descaling', 5, options)).toEqual([])
    }
  })
})
