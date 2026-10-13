// The trash and a volume mounted in a Card folder (worfy-windows ticket 44). put() moves a Card
// folder with one rename, which takes a mount point along (measured on macOS). Three days later
// purge() removes the entry — and fs.rmSync, which removeTree was off Windows, removed every file
// of the volume and threw; that error ended purge, and the entries after it stayed for good.
//
// Now removeTree refuses such an entry with nothing removed, and purge leaves it, names it, and
// goes on. The store runs over the model of test/unit/remove-tree-model.ts: no test mounts a volume.
import { describe, expect, it } from 'vitest'
import { TrashStore, type TrashFs, type TrashLayout } from '../../src/main/layout/trash'
import { removeTree } from '../../src/main/storage/remove'
import { TRASH_KEEP_MS } from '../../src/shared/ipc/trash'
import { model, type Entry, type Model } from './remove-tree-model'

const PROJECT = 'demo-0a1b2c3d'
const TRASH = '/data/p/trash'
const NOW = Date.UTC(2026, 9, 13, 12)
const OLD = NOW - TRASH_KEEP_MS - 60_000
/** Three entries past their three days, the one in the middle with the volume, and one made a second ago. */
const [FIRST, MOUNTED, LAST, FRESH] = [`${OLD}-aaaaaaaa`, `${OLD + 1}-bbbbbbbb`, `${OLD + 2}-cccccccc`, `${NOW - 1000}-dddddddd`]

const PLAIN_CARD: Record<string, Entry> = { card: { kind: 'folder' }, 'card/index.html': { kind: 'file' } }
const CARD_IS_THE_MOUNT_POINT: Record<string, Entry> = {
  card: { kind: 'volume' },
  'card/keep.txt': { kind: 'file' },
  'card/deep': { kind: 'folder' },
  'card/deep/more.txt': { kind: 'file' },
}
const CARD_HOLDS_THE_MOUNT_POINT: Record<string, Entry> = {
  card: { kind: 'folder' },
  'card/index.html': { kind: 'file' },
  'card/vol': { kind: 'volume' },
  'card/vol/keep.txt': { kind: 'file' },
  'card/vol/deep': { kind: 'folder' },
  'card/vol/deep/more.txt': { kind: 'file' },
}

const entry = (label: string, card: Record<string, Entry>): Record<string, Entry> => ({
  [`${TRASH}/${label}`]: { kind: 'folder' },
  [`${TRASH}/${label}/entry.json`]: { kind: 'file' },
  ...Object.fromEntries(Object.entries(card).map(([name, each]) => [`${TRASH}/${label}/${name}`, each])),
})
const trashWith = (card: Record<string, Entry>): Record<string, Entry> => ({
  '/data': { kind: 'folder' },
  '/data/p': { kind: 'folder' },
  [TRASH]: { kind: 'folder' },
  // Not entries: the trash reads and deletes only folders named as its labels are.
  [`${TRASH}/notes.txt`]: { kind: 'file' },
  [`${TRASH}/not-an-entry`]: { kind: 'folder' },
  [`${TRASH}/not-an-entry/mine.txt`]: { kind: 'file' },
  ...entry(FIRST, PLAIN_CARD),
  ...entry(MOUNTED, card),
  ...entry(LAST, PLAIN_CARD),
  ...entry(FRESH, PLAIN_CARD),
})

const posixed = (path: string): string => path.replace(/\\/g, '/')
const layout: TrashLayout = {
  get: () => {
    throw new Error('purge does not read the Layout')
  },
  apply: () => {
    throw new Error('purge does not change the Layout')
  },
}
/** A store whose trash is the model: the listing and the removal are those of the application, over the model. */
function storeOver(m: Model, platform: NodeJS.Platform, remove?: TrashFs['removeTree']): TrashStore {
  const fs: TrashFs = {
    folders: (dir) => m.fs.readdirSync(dir).filter((name) => m.fs.lstatSync(`${posixed(dir)}/${name}`).isDirectory()),
    removeTree: remove ?? ((path) => removeTree(path, { fs: m.fs, platform, wait: m.wait })),
  }
  return new TrashStore({
    dataDirOf: () => '/data/p',
    cardPaths: () => {
      throw new Error('purge does not ask where a Card is')
    },
    layout,
    now: () => NOW,
    fs,
  })
}
const under = (m: Model, label: string): string[] => m.names().filter((name) => name.startsWith(`${TRASH}/${label}`))

describe.each(['darwin', 'linux'] as const)('purge on %s and an entry with a volume mounted in its Card folder (worfy-windows ticket 44)', (platform) => {
  it.each([
    ['the Card folder is the mount point itself', CARD_IS_THE_MOUNT_POINT, 'card'],
    ['the mount point lies inside the Card folder', CARD_HOLDS_THE_MOUNT_POINT, 'card/vol'],
  ])('%s: the entry is left whole with the files of the volume, it is named with the reason, and the other old entries are deleted', (_what, card, mountPoint) => {
    const tree = trashWith(card)
    const m = model(tree)
    const { removed, refused } = storeOver(m, platform).purge(PROJECT)
    expect(removed).toEqual([FIRST, LAST])
    expect(refused.map((each) => each.label)).toEqual([MOUNTED])
    const error = refused[0]!.error as NodeJS.ErrnoException
    expect(error.code).toBe('EXDEV')
    expect(posixed(error.path ?? '')).toBe(`${TRASH}/${MOUNTED}/${mountPoint}`)
    expect(posixed(error.message)).toContain(`${TRASH}/${MOUNTED}/${mountPoint} is on another volume than the folder it lies in`)
    // Nothing of the entry is gone — not the files of the volume, not entry.json: it can still be restored.
    expect(under(m, MOUNTED)).toEqual(Object.keys(entry(MOUNTED, card)).sort())
    expect(under(m, FIRST)).toEqual([])
    expect(under(m, LAST)).toEqual([])
    // The entry made a second ago is not asked about, and what is no entry is not touched.
    expect(under(m, FRESH)).toEqual(Object.keys(entry(FRESH, PLAIN_CARD)).sort())
    expect(m.names()).toContain(`${TRASH}/notes.txt`)
    expect(m.names()).toContain(`${TRASH}/not-an-entry/mine.txt`)
    expect(m.calls.filter((call) => call.startsWith('rmSync '))).toEqual([`rmSync ${TRASH}/${FIRST} recursive force`, `rmSync ${TRASH}/${LAST} recursive force`])
    // Nothing behind the mount point was asked about, let alone removed.
    expect(m.calls.filter((call) => call.includes(`${TRASH}/${MOUNTED}/${mountPoint}/`))).toEqual([])

    // The next start of the application finds the entry again, and says so again.
    const again = storeOver(m, platform).purge(PROJECT)
    expect(again.removed).toEqual([])
    expect(again.refused.map((each) => each.label)).toEqual([MOUNTED])
    expect(under(m, MOUNTED)).toEqual(Object.keys(entry(MOUNTED, card)).sort())
  })
})

describe('purge and an entry that cannot be removed', () => {
  it('whatever the removal of an entry throws, the entry is named with it and the entries after it are still deleted', () => {
    const m = model(trashWith(PLAIN_CARD))
    const asked: string[] = []
    const held = Object.assign(new Error('EBUSY: a file of the entry is held'), { code: 'EBUSY' })
    const store = storeOver(m, 'darwin', (path) => {
      asked.push(posixed(path))
      if (posixed(path) === `${TRASH}/${MOUNTED}`) throw held
      removeTree(path, { fs: m.fs, platform: 'darwin', wait: m.wait })
    })
    expect(store.purge(PROJECT)).toEqual({ removed: [FIRST, LAST], refused: [{ label: MOUNTED, error: held }] })
    expect(asked).toEqual([`${TRASH}/${FIRST}`, `${TRASH}/${MOUNTED}`, `${TRASH}/${LAST}`])
    expect(under(m, LAST)).toEqual([])
  })

  it('a trash folder that is not there has nothing to delete and nothing to name', () => {
    const m = model({ '/data': { kind: 'folder' }, '/data/p': { kind: 'folder' } })
    const fs: TrashFs = {
      folders: (dir) => {
        throw Object.assign(new Error(`ENOENT: ${dir}`), { code: 'ENOENT' })
      },
      removeTree: () => {
        throw new Error('nothing to remove')
      },
    }
    const store = new TrashStore({ dataDirOf: () => '/data/p', cardPaths: () => ({ folder: '', data: '' }), layout, now: () => NOW, fs })
    expect(store.purge(PROJECT)).toEqual({ removed: [], refused: [] })
    expect(m.calls).toEqual([])
  })
})
