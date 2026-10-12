// The watch of a Project's Cards on Windows (worfy-windows ticket 20): CardStore over the model of
// a Windows disk (test/unit/windows-disk.ts), with path.win32, on any system. A link to
// `\\evil\share\…` stands in place of the Cards folder, of a Card folder and of a file of a Card;
// the model marks every call Windows would answer by contacting the host.
import { posix, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardInfo } from '../../src/shared/ipc/cards'
import { CARD_LINK_DEPTH, CardStore, type CardFs } from '../../src/main/cards/store'
import { FILE, FOLDER, linkTo, windowsDisk, type DiskEntry, type WindowsDisk } from './windows-disk'

const PROJECT = 'demo-0a1b2c3d'
const DATA = 'C:\\data\\demo'
const CARDS = `${DATA}\\cards`
const EVIL = '\\\\evil\\share'

const TWO_CARDS: Record<string, DiskEntry> = {
  [`${CARDS}\\c1\\index.html`]: FILE,
  [`${CARDS}\\c1\\js\\app.js`]: FILE,
  [`${CARDS}\\c2\\index.html`]: FILE,
}

const stores: CardStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
})

/** The calls of a Card that follow links, answered by the model and written down with the rest. */
function cardFs(disk: WindowsDisk): CardFs {
  return {
    isDirectory: (path) => disk.fs.isFolder(path),
    readTitle: async (file) => {
      disk.calls.push(`open ${file}`)
      await disk.fs.realpath(file)
      return 'a title'
    },
  }
}

function makeStore(disk: WindowsDisk): { store: CardStore; seen: CardInfo[] } {
  const store = new CardStore({ dataDirOf: () => DATA, projectIds: () => [PROJECT], delayMs: 0, paths: win32, links: disk.links, fs: cardFs(disk), watchFs: disk.fs })
  stores.push(store)
  const seen: CardInfo[] = []
  store.onChange((info) => seen.push(info))
  return { store, seen }
}

/** The calls that name a path through the link, other than lstat and readlink of the link itself. */
const through = (disk: WindowsDisk, link: string): string[] =>
  disk.calls.filter((call) => {
    const path = call.replace(/^\S+ /, '').replace(/ \(recursive\)$/, '').toLowerCase()
    if (path === link.toLowerCase()) return !/^(lstat|readlink) /.test(call)
    return path.startsWith(`${link.toLowerCase()}\\`)
  })

const watching = (disk: WindowsDisk, what: string[]): Promise<void> => vi.waitFor(() => expect(disk.open()).toEqual(what), { timeout: 2000, interval: 5 })
const changed = (seen: CardInfo[], cardId: string): Promise<void> => vi.waitFor(() => expect(seen.map((info) => info.cardId)).toContain(cardId), { timeout: 2000, interval: 5 })

describe('the watch of the Cards of a Project, by the rules of Windows', () => {
  it('watches the Cards folder with one handle, makes no folder, and reports a change of a file of a Card by the id of the Card', async () => {
    const disk = windowsDisk(TWO_CARDS)
    const { store, seen } = makeStore(disk)
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: true, title: 'a title', revision: 0 })
    await watching(disk, [`${CARDS} (recursive)`])

    disk.put(`${CARDS}\\c1\\js\\deep\\more.js`, FILE)
    await changed(seen, 'c1')
    expect(seen.at(-1)).toMatchObject({ cardId: 'c1', revision: 1 })
    // A name in the Cards folder that is no Card id is nobody's change.
    disk.put(`${CARDS}\\Not_A_Card\\x.html`, FILE)
    disk.put(`${CARDS}\\c2\\index.html`, FILE)
    await changed(seen, 'c2')
    expect(new Set(seen.map((info) => info.cardId))).toEqual(new Set(['c1', 'c2']))
    expect(disk.contacts).toEqual([])
  })

  it('waits for a Cards folder that is not there yet, and watches it when the first Card is written', async () => {
    const disk = windowsDisk({ [`${DATA}\\layout.json`]: FILE })
    const { store, seen } = makeStore(disk)
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: false })
    await watching(disk, [DATA])
    disk.put(`${CARDS}\\c1\\index.html`, FILE)
    await watching(disk, [`${CARDS} (recursive)`])
    disk.put(`${CARDS}\\c1\\index.html`, FILE)
    await changed(seen, 'c1')
  })

  it('a Cards folder that is a link to a share is not watched, and no Card is there: nothing is asked through it', async () => {
    const disk = windowsDisk({ [`${DATA}\\layout.json`]: FILE, [CARDS]: linkTo(`${EVIL}\\cards`) })
    const { store } = makeStore(disk)
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: false, title: null })
    await vi.waitFor(() => expect(disk.calls.filter((call) => call === `readlink ${CARDS}`).length).toBeGreaterThanOrEqual(2), { timeout: 2000, interval: 5 })
    expect(disk.open()).toEqual([])
    expect(disk.contacts).toEqual([])
    expect(through(disk, CARDS)).toEqual([])
    expect(store.watchedProjects()).toEqual([PROJECT])
  })

  it.each([
    ['a Card folder', `${CARDS}\\away`],
    ['the index.html of a Card', `${CARDS}\\c2\\index.html`],
    ['a folder inside a Card', `${CARDS}\\c1\\assets`],
    ['a file in a folder inside a Card', `${CARDS}\\c1\\js\\lib.js`],
  ])('a link to a share in place of %s: no call names a path through it, and the other Cards are watched', async (_what, link) => {
    const disk = windowsDisk({ ...TWO_CARDS, [link]: linkTo(`${EVIL}\\x`) })
    const { store, seen } = makeStore(disk)
    await store.info(PROJECT, 'c1')
    await store.info(PROJECT, 'c2')
    await store.info(PROJECT, 'away')
    await watching(disk, [`${CARDS} (recursive)`])
    await vi.waitFor(() => expect(disk.calls).toContain(`readlink ${link}`), { timeout: 2000, interval: 5 })

    disk.put(`${CARDS}\\c1\\js\\app.js`, FILE)
    await changed(seen, 'c1')
    expect(disk.open()).toEqual([`${CARDS} (recursive)`])
    expect(disk.contacts).toEqual([])
    expect(through(disk, link)).toEqual([])
  })

  it('a Card folder that is a link to a folder of this machine, and a file of a Card that is a link to a file: a change behind each is reported for its Card', async () => {
    const card = `${CARDS}\\linked`
    const file = `${CARDS}\\c1\\data.json`
    const disk = windowsDisk({ ...TWO_CARDS, [card]: linkTo('C:\\elsewhere\\card'), 'C:\\elsewhere\\card\\index.html': FILE, [file]: linkTo('C:\\elsewhere\\data.json'), 'C:\\elsewhere\\data.json': FILE })
    const { store, seen } = makeStore(disk)
    await store.info(PROJECT, 'c1')
    await watching(disk, [`${CARDS} (recursive)`, 'C:\\elsewhere\\data.json', 'C:\\elsewhere\\card (recursive)'])

    disk.put('C:\\elsewhere\\card\\index.html', FILE)
    await changed(seen, 'linked')
    disk.put('C:\\elsewhere\\data.json', FILE)
    await changed(seen, 'c1')
    expect(disk.contacts).toEqual([])
  })

  it(`looks for links down to the folders right inside a Card (${CARD_LINK_DEPTH} below its id), no deeper`, async () => {
    const disk = windowsDisk({ ...TWO_CARDS, [`${CARDS}\\c1\\js\\vendor`]: FOLDER, [`${CARDS}\\c1\\js\\vendor\\deep`]: linkTo('C:\\elsewhere\\deep'), 'C:\\elsewhere\\deep\\x.js': FILE })
    const { store } = makeStore(disk)
    await store.info(PROJECT, 'c1')
    await watching(disk, [`${CARDS} (recursive)`])
    await vi.waitFor(() => expect(disk.calls).toContain(`readdir ${CARDS}\\c1\\js`), { timeout: 2000, interval: 5 })
    expect(disk.calls).not.toContain(`readdir ${CARDS}\\c1\\js\\vendor`)
    expect(disk.calls).not.toContain(`readlink ${CARDS}\\c1\\js\\vendor\\deep`)
    expect(CARD_LINK_DEPTH).toBe(2)
  })

  it('stops the watch of a Project on close', async () => {
    const disk = windowsDisk(TWO_CARDS)
    const { store } = makeStore(disk)
    await store.info(PROJECT, 'c1')
    await watching(disk, [`${CARDS} (recursive)`])
    await store.close()
    expect(disk.open()).toEqual([])
  })
})

describe('CardStore.info and the order of its refusals', () => {
  it('an id that is not a Card id is refused as such, also for a Project that is not in the list', async () => {
    const store = new CardStore({
      dataDirOf: (id) => {
        throw new Error(`No Project ${id}`)
      },
      projectIds: () => [],
      watch: false,
      paths: posix,
    })
    stores.push(store)
    await expect(store.info('nobody-ffffffff', '../c1')).rejects.toThrow('../c1 is not a valid Card id')
    await expect(store.info('nobody-ffffffff', 'c1')).rejects.toThrow('No Project nobody-ffffffff')
  })
})
