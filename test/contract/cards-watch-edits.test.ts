// A real edit of a Card over real folders, on every system. The Windows watch of the Cards drops an
// event that is a "change" naming a Card folder itself (a Card folder's own times change with no file
// edited, and the Card would start again), so no real edit may arrive as that event alone. The watch
// of the Cards on macOS and Linux is chokidar and drops nothing of the kind: its cases below show the
// edit arrives there, and the cases of fs.watch show what the system says.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmdirSync, rmSync, utimesSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CardInfo } from '../../src/shared/ipc/cards'
import { CardStore } from '../../src/main/cards/store'
import { removeTree } from '../../src/main/storage/remove'
import { until } from './counted-fs'

const PROJECT = 'demo-0a1b2c3d'

let dir: string
let cards: string
const stores: CardStore[] = []
const watchers: FSWatcher[] = []

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-cards-edits-')))
  cards = join(dir, 'data', PROJECT, 'cards')
  for (const id of ['c1', 'c2']) {
    mkdirSync(join(cards, id, 'js'), { recursive: true })
    writeFileSync(join(cards, id, 'index.html'), `<!doctype html><title>${id}</title>`)
    writeFileSync(join(cards, id, 'js', 'app.js'), '// app')
  }
  mkdirSync(join(cards, 'e1'))
})

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close()
  await Promise.all(stores.splice(0).map((store) => store.close()))
  removeTree(dir)
})

const EDITS: [string, () => void][] = [
  ['a file written again', () => writeFileSync(join(cards, 'c1', 'index.html'), '<!doctype html><title>new</title>')],
  ['a file in a folder of the Card written again', () => writeFileSync(join(cards, 'c1', 'js', 'app.js'), '// new')],
  [
    'a file replaced by a rename over it',
    () => {
      writeFileSync(join(cards, 'c1', 'next'), '<!doctype html><title>next</title>')
      renameSync(join(cards, 'c1', 'next'), join(cards, 'c1', 'index.html'))
    },
  ],
  ['a file added', () => writeFileSync(join(cards, 'c1', 'added.txt'), 'added')],
  ['a file deleted', () => rmSync(join(cards, 'c1', 'js', 'app.js'))],
  ['a file renamed', () => renameSync(join(cards, 'c1', 'js', 'app.js'), join(cards, 'c1', 'js', 'moved.js'))],
]

const shows = (seen: CardInfo[], cardId: string, exists: boolean): boolean => seen.some((info) => info.cardId === cardId && info.exists === exists)

/** What is done to a Card folder itself, the folder the event must then name, and what the store then says. */
const FOLDER_EDITS: [string, () => void, string, (seen: CardInfo[]) => boolean][] = [
  ['the folder of a Card made', () => mkdirSync(join(cards, 'c3')), 'c3', (seen) => shows(seen, 'c3', true)],
  ['the empty folder of a Card removed', () => rmdirSync(join(cards, 'e1')), 'e1', (seen) => shows(seen, 'e1', false)],
  ['the folder of a Card renamed', () => renameSync(join(cards, 'c1'), join(cards, 'c9')), 'c9', (seen) => shows(seen, 'c1', false) && shows(seen, 'c9', true)],
]

/** Writes to the other Card until `heard` says so: a watch starts a moment after it is asked for. */
async function watchIsUp(heard: () => boolean): Promise<void> {
  let round = 0
  let last = 0
  await until('the watch to report a write to the other Card', () => {
    if (performance.now() - last > 200) {
      writeFileSync(join(cards, 'c2', 'index.html'), `<!doctype html><title>${round++}</title>`)
      last = performance.now()
    }
    return heard()
  })
}

describe('a real edit of a Card', () => {
  describe.each(EDITS)('%s', (_name, edit) => {
    it('fs.watch says more of it than a change naming the Card folder alone', async () => {
      const events: string[] = []
      watchers.push(watch(cards, { recursive: true }, (event, name) => events.push(`${event} ${String(name).replaceAll('\\', '/')}`)))
      await watchIsUp(() => events.some((line) => line.includes('c2/index.html')))
      events.length = 0
      edit()
      const told = (): boolean => events.some((line) => line.includes('c1/'))
      await until('an event that names something inside the Card', told).catch((error: unknown) => {
        // On the system where this fails the drop in the watch of the Cards must stay on Windows only.
        throw new Error(`${String(error)}; the events were ${JSON.stringify(events)}`)
      })
    })

    it('reaches the listeners of the store of Cards', async () => {
      const store = new CardStore({ dataDirOf: () => join(dir, 'data', PROJECT), projectIds: () => [PROJECT], delayMs: 30 })
      stores.push(store)
      const seen: CardInfo[] = []
      store.onChange((info) => seen.push(info))
      await store.info(PROJECT, 'c1')
      await store.info(PROJECT, 'c2')
      await watchIsUp(() => seen.some((info) => info.cardId === 'c2'))
      const before = (await store.info(PROJECT, 'c1')).revision
      edit()
      await until('a report of the Card', () => seen.some((info) => info.cardId === 'c1' && info.revision > before))
    })
  })

  describe.each(FOLDER_EDITS)('%s', (_name, edit, named, reported) => {
    it('fs.watch says so by a rename of that folder', async () => {
      const events: string[] = []
      watchers.push(watch(cards, { recursive: true }, (event, name) => events.push(`${event} ${String(name).replaceAll('\\', '/')}`)))
      await watchIsUp(() => events.some((line) => line.includes('c2/index.html')))
      events.length = 0
      edit()
      await until(`a rename of ${named}`, () => events.includes(`rename ${named}`)).catch((error: unknown) => {
        // On the system where this fails the drop in the watch of the Cards must stay on Windows only.
        throw new Error(`${String(error)}; the events were ${JSON.stringify(events)}`)
      })
    })

    it('reaches the listeners of the store of Cards', async () => {
      const store = new CardStore({ dataDirOf: () => join(dir, 'data', PROJECT), projectIds: () => [PROJECT], delayMs: 30 })
      stores.push(store)
      const seen: CardInfo[] = []
      store.onChange((info) => seen.push(info))
      await store.info(PROJECT, 'c2')
      await watchIsUp(() => seen.some((info) => info.cardId === 'c2'))
      edit()
      await until('a report of the Card folder', () => reported(seen))
    })
  })

  // No case of this file can fail on macOS by the drop itself: the store goes through chokidar there.
  // This guard is here for scripts/ci-scope.mjs: on a pull request the job macos-tests runs only the
  // files that hold one, and the cases above must be seen on macOS before a merge.
  it.runIf(process.platform === 'darwin')('runs in macos-tests on a pull request', () => {
    expect(process.platform).toBe('darwin')
  })

  it.runIf(process.platform === 'win32')('the time of a Card folder alone reads no Card again, and an edit after it does', async () => {
    const events: string[] = []
    watchers.push(watch(cards, { recursive: true }, (event, name) => events.push(`${event} ${String(name)}`)))
    const store = new CardStore({ dataDirOf: () => join(dir, 'data', PROJECT), projectIds: () => [PROJECT], delayMs: 30 })
    stores.push(store)
    const seen: CardInfo[] = []
    store.onChange((info) => seen.push(info))
    await store.info(PROJECT, 'c1')
    await store.info(PROJECT, 'c2')
    await watchIsUp(() => seen.some((info) => info.cardId === 'c2'))
    // The folder `js` written a moment before the watch may be told at its start, and that is still
    // a report of c1: it comes before the report of the other Card, so the count starts here.
    const before = (await store.info(PROJECT, 'c1')).revision
    seen.length = 0
    events.length = 0
    utimesSync(join(cards, 'c1'), new Date(), new Date(Date.now() - 60_000))
    await until('Windows to report the folder', () => events.includes('change c1'))
    // Windows tells a watch in order, and the same delay holds both: by the report of this later
    // write, a report of the folder would have raised the revision of its Card.
    await watchIsUp(() => seen.some((info) => info.cardId === 'c2'))
    expect((await store.info(PROJECT, 'c1')).revision).toBe(before)
    writeFileSync(join(cards, 'c1', 'index.html'), '<!doctype html><title>new</title>')
    await until('a report of the Card', () => seen.some((info) => info.cardId === 'c1' && info.revision === before + 1))
  })
})
