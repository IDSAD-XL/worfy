// The watch of a Project's Cards on Windows, over real folders and real links (worfy-windows
// ticket 20). A symlink to a share nobody answers for stands in place of a Card folder, of a file
// of a Card and of the Cards folder itself; every call of node:fs is counted (counted-fs.ts).
// Making a symlink on Windows needs Developer Mode: without it those cases are skipped.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CardInfo } from '../../src/shared/ipc/cards'
import { CardStore } from '../../src/main/cards/store'
import { removeTree } from '../../src/main/storage/remove'
import { canLink, countFsCalls, SHARE, through, until } from './counted-fs'

const WINDOWS = process.platform === 'win32'
const LINKS = canLink()
const PROJECT = 'demo-0a1b2c3d'

let dir: string
let cards: string
const stores: CardStore[] = []

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-cards-links-')))
  cards = join(dir, 'data', PROJECT, 'cards')
  mkdirSync(join(dir, 'data', PROJECT), { recursive: true })
})

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
  // removeTree takes a link away as a link: nothing here is followed.
  removeTree(dir)
})

function writeCard(id: string, title: string): void {
  mkdirSync(join(cards, id, 'js'), { recursive: true })
  writeFileSync(join(cards, id, 'index.html'), `<!doctype html><title>${title}</title>`)
  writeFileSync(join(cards, id, 'js', 'app.js'), '// app')
}

function makeStore(): { store: CardStore; seen: CardInfo[] } {
  const store = new CardStore({ dataDirOf: () => join(dir, 'data', PROJECT), projectIds: () => [PROJECT], delayMs: 30 })
  stores.push(store)
  const seen: CardInfo[] = []
  store.onChange((info) => seen.push(info))
  return { store, seen }
}

/** Writes the file until the watch reports its Card: the watch starts a moment after the first info(). */
async function reported(seen: CardInfo[], cardId: string, write: (round: number) => void): Promise<CardInfo> {
  let round = 0
  let last = 0
  await until(`a change of Card ${cardId}`, () => {
    if (performance.now() - last > 200) {
      write(round++)
      last = performance.now()
    }
    return seen.some((info) => info.cardId === cardId)
  })
  return seen.filter((info) => info.cardId === cardId).at(-1)!
}

describe.runIf(WINDOWS)('the watch of the Cards of a Project on Windows', () => {
  it('reports a change of a file of a Card, also deep inside it, and a Cards folder made after the first question', async () => {
    const { store, seen } = makeStore()
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: false })
    writeCard('c1', 'Clock')
    const first = await reported(seen, 'c1', (round) => writeFileSync(join(cards, 'c1', 'index.html'), `<title>Clock v${round}</title>`))
    expect(first).toMatchObject({ exists: true })
    expect(first.title).toMatch(/^Clock v\d+$/)

    seen.length = 0
    mkdirSync(join(cards, 'c1', 'js', 'vendor', 'deep'), { recursive: true })
    await reported(seen, 'c1', (round) => writeFileSync(join(cards, 'c1', 'js', 'vendor', 'deep', 'lib.js'), `// ${round}`))
  })

  it('a junction to a folder of this machine in place of a Card folder: a file written behind it is reported for that Card', async () => {
    const behind = join(dir, 'elsewhere', 'card')
    mkdirSync(behind, { recursive: true })
    writeFileSync(join(behind, 'index.html'), '<title>Linked</title>')
    writeCard('c1', 'Clock')
    symlinkSync(behind, join(cards, 'linked'), 'junction')
    const { store, seen } = makeStore()
    expect(await store.info(PROJECT, 'linked')).toMatchObject({ exists: true, title: 'Linked' })
    // Written by the real path: the watch of the Cards folder says nothing of it.
    const info = await reported(seen, 'linked', (round) => writeFileSync(join(behind, 'index.html'), `<title>Linked v${round}</title>`))
    expect(info.title).toMatch(/^Linked v\d+$/)
  })

  it.runIf(LINKS)('a symlink to an unreachable share in place of a Card folder and of a file of a Card: no call of Node names a path through either, and the Card next to them is watched', async () => {
    writeCard('c1', 'Clock')
    const links = [join(cards, 'away'), join(cards, 'c1', 'remote.json'), join(cards, 'c1', 'js', 'remote.js')]
    symlinkSync(`${SHARE}\\card`, links[0]!, 'dir')
    symlinkSync(`${SHARE}\\data.json`, links[1]!, 'file')
    symlinkSync(`${SHARE}\\lib.js`, links[2]!, 'file')
    const counted = countFsCalls()
    try {
      const { store, seen } = makeStore()
      const at = performance.now()
      expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: true, title: 'Clock' })
      expect(await store.info(PROJECT, 'away')).toMatchObject({ exists: false, title: null })
      // A call through such a link takes more than a second to fail.
      expect(performance.now() - at).toBeLessThan(1000)
      await reported(seen, 'c1', (round) => writeFileSync(join(cards, 'c1', 'index.html'), `<title>Clock v${round}</title>`))
      for (const link of links) expect(through(counted.calls, link), link).toEqual([])
      // Each link was looked at, as a link.
      const lower = counted.calls.map((call) => call.toLowerCase())
      for (const link of links) expect(lower, link).toContain(`readlink ${link.toLowerCase()}`)
    } finally {
      counted.restore()
    }
  }, 30_000)

  it.runIf(LINKS)('a Cards folder that is itself a symlink to an unreachable share: the Card is not there, nothing is watched, and no call names a path through the link', async () => {
    symlinkSync(`${SHARE}\\cards`, cards, 'dir')
    const counted = countFsCalls()
    try {
      const { store } = makeStore()
      expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: false, title: null })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(through(counted.calls, cards)).toEqual([])
      expect(counted.calls.filter((call) => call.startsWith('watch '))).toEqual([])
    } finally {
      counted.restore()
    }
  }, 30_000)

  it.skipIf(LINKS)('the cases with a symlink to a share are skipped: this user may not make a symlink (Developer Mode is off)', () => {
    expect(LINKS).toBe(false)
  })
})
