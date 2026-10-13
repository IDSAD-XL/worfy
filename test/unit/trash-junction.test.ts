// The trash and a link inside a Card (worfy-windows ticket 23). A junction is a link to a folder on
// NTFS. Under the Node of Electron 44 (24.21.0) fs.rmSync with `recursive` goes through one and
// empties the folder behind it; the files of a Card are written by agents, so a Card may hold one.
// The store is driven directly, over real folders: test/contract/trash.test.ts goes through the IPC
// wrapper, which on Windows refuses its macOS file URL.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TrashStore, type TrashLayout } from '../../src/main/layout/trash'
import { TRASH_KEEP_MS } from '../../src/shared/ipc/trash'
import type { LayoutNode } from '../../src/shared/layout/types'
import { removeTestTree } from '../remove'

const PROJECT = 'demo-0a1b2c3d'
const WINDOWS = process.platform === 'win32'

let scratch: string
let dataDir: string
let nodes: LayoutNode[]
let now: number
/** The links a test made: removed as links before the scratch folder goes. */
let links: string[]

const cardDir = (cardId: string) => join(dataDir, 'cards', cardId)
const trashDir = () => join(dataDir, 'trash')

/** A store over the scratch folder. `refuse.remove` is what the Layout throws when a Node is taken off it. */
function store(refuse: { remove?: Error } = {}): TrashStore {
  const layout: TrashLayout = {
    get: () => ({ layout: { nodes } }) as ReturnType<TrashLayout['get']>,
    apply: (_projectId, op) => {
      if (op.op === 'remove' && refuse.remove !== undefined) throw refuse.remove
      if (op.op === 'remove') nodes = nodes.filter((node) => node.id !== op.id)
      else nodes = [...nodes, op.node]
      return { layout: { nodes } } as ReturnType<TrashLayout['get']>
    },
  }
  return new TrashStore({
    dataDirOf: () => dataDir,
    cardPaths: (_projectId, cardId) => ({ folder: cardDir(cardId), data: join(dataDir, 'card-data', `${cardId}.json`) }),
    layout,
    now: () => now,
  })
}

/** A Card with a file, and inside it a link to a folder outside the data of worfy that holds a file. */
function cardWithLinkOut(cardId: string): { outside: string; link: string } {
  mkdirSync(cardDir(cardId), { recursive: true })
  writeFileSync(join(cardDir(cardId), 'index.html'), `<title>Card ${cardId}</title>`)
  nodes.push({ id: cardId, kind: 'card', x: 0, y: 0, w: 360, h: 280, data: {} } as unknown as LayoutNode)
  const outside = join(scratch, `outside-${cardId}`)
  mkdirSync(outside)
  writeFileSync(join(outside, 'notes.txt'), 'keep me')
  const link = join(cardDir(cardId), 'linked')
  // A junction on Windows; elsewhere a symlink to the folder.
  symlinkSync(outside, link, WINDOWS ? 'junction' : 'dir')
  links.push(link)
  return { outside, link }
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-trash-junction-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
  nodes = []
  links = []
  now = new Date('2026-10-05T12:00:00Z').getTime()
})

afterEach(() => {
  // Links first, as links. (From the time this folder went with rmSync; removeTestTree takes a link as a link too.)
  for (const entry of existsSync(trashDir()) ? readdirSync(trashDir()) : []) links.push(join(trashDir(), entry, 'card', 'linked'))
  for (const link of links) {
    try {
      rmdirSync(link)
    } catch {
      try {
        unlinkSync(link)
      } catch {
        // Gone with its Card, as it should be.
      }
    }
  }
  removeTestTree(scratch)
})

describe('the trash and a link inside a Card', () => {
  it('purge deletes an old entry with the link in its Card, and the folder the link leads to keeps its file', () => {
    const { outside } = cardWithLinkOut('old')
    const trash = store()
    const entry = trash.put(PROJECT, 'old')
    expect(readdirSync(join(trashDir(), entry.label, 'card')).sort()).toEqual(['index.html', 'linked'])
    now += TRASH_KEEP_MS + 1000
    expect(trash.purge(PROJECT)).toEqual([entry.label])
    expect(existsSync(join(trashDir(), entry.label))).toBe(false)
    expect(readdirSync(outside)).toEqual(['notes.txt'])
    expect(readFileSync(join(outside, 'notes.txt'), 'utf8')).toBe('keep me')
  })

  it('restore puts the Card back with its link and deletes the entry; the folder behind the link is as it was', () => {
    const { outside, link } = cardWithLinkOut('back')
    const trash = store()
    const entry = trash.put(PROJECT, 'back')
    expect(existsSync(cardDir('back'))).toBe(false)
    trash.restore(PROJECT, entry.label)
    expect(readdirSync(trashDir())).toEqual([])
    expect(readdirSync(link)).toEqual(['notes.txt'])
    expect(readdirSync(outside)).toEqual(['notes.txt'])
  })

  // worfy-windows ticket 20: the place is looked at with lstat, so a link there is something.
  it('restore refuses while something lies at the place of the Card again: a folder, or a link — wherever it leads — and the entry stays', () => {
    mkdirSync(cardDir('again'), { recursive: true })
    writeFileSync(join(cardDir('again'), 'index.html'), '<title>Again</title>')
    nodes.push({ id: 'again', kind: 'card', x: 0, y: 0, w: 360, h: 280, data: {} } as unknown as LayoutNode)
    const trash = store()
    const entry = trash.put(PROJECT, 'again')
    expect(entry.title).toBe('Again')
    expect(existsSync(cardDir('again'))).toBe(false)

    mkdirSync(cardDir('again'))
    expect(() => trash.restore(PROJECT, entry.label)).toThrow('A Card with id again exists again; delete it before restoring')
    rmdirSync(cardDir('again'))

    // A link that leads nowhere: a look that followed it would say the place is free.
    symlinkSync(join(scratch, 'no-such-folder'), cardDir('again'), WINDOWS ? 'junction' : 'dir')
    links.push(cardDir('again'))
    expect(() => trash.restore(PROJECT, entry.label)).toThrow('A Card with id again exists again; delete it before restoring')
    expect(readdirSync(trashDir())).toEqual([entry.label])
    if (WINDOWS) rmdirSync(cardDir('again'))
    else unlinkSync(cardDir('again'))

    expect(trash.restore(PROJECT, entry.label)).toMatchObject({ title: 'Again' })
    expect(readFileSync(join(cardDir('again'), 'index.html'), 'utf8')).toBe('<title>Again</title>')
  })
})

// worfy-windows ticket 20, review of PR #274: the Card folder itself is a link (a junction on
// Windows). The trash moves the link and never what it leads to: purge deletes what is in the
// trash, so a folder moved there from behind a link would be the user's own files, deleted.
describe('the trash and a Card folder that is itself a link', () => {
  const FILES = { 'index.html': '<title>Linked</title>', 'a.txt': 'first', 'b.txt': 'second' }
  const isLink = (path: string): boolean => lstatSync(path).isSymbolicLink()
  const gone = (path: string): boolean => {
    try {
      lstatSync(path)
      return false
    } catch {
      return true
    }
  }

  /** A Card whose folder is a link to `target`; the link is removed as a link after the test, wherever it lies then. */
  function cardThatIsLink(cardId: string, target: string): void {
    mkdirSync(join(dataDir, 'cards'), { recursive: true })
    symlinkSync(target, cardDir(cardId), WINDOWS ? 'junction' : 'dir')
    links.push(cardDir(cardId))
    nodes.push({ id: cardId, kind: 'card', x: 0, y: 0, w: 360, h: 280, data: {} } as unknown as LayoutNode)
  }
  const inTrash = (label: string): string => {
    const place = join(trashDir(), label, 'card')
    links.push(place)
    return place
  }

  it('put moves the link, restore puts it back, and purge deletes it from the trash: the three files behind it stay where they are', () => {
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    for (const [name, text] of Object.entries(FILES)) writeFileSync(join(outside, name), text)
    const untouched = (): void => {
      expect(readdirSync(outside).sort()).toEqual(Object.keys(FILES).sort())
      for (const [name, text] of Object.entries(FILES)) expect(readFileSync(join(outside, name), 'utf8')).toBe(text)
    }
    cardThatIsLink('linked', outside)
    const target = readlinkSync(cardDir('linked'))
    const trash = store()

    const first = trash.put(PROJECT, 'linked')
    expect(first).toMatchObject({ hasFiles: true, title: 'Linked' })
    expect(gone(cardDir('linked'))).toBe(true)
    expect(isLink(inTrash(first.label))).toBe(true)
    expect(readlinkSync(inTrash(first.label))).toBe(target)
    untouched()

    trash.restore(PROJECT, first.label)
    expect(readdirSync(trashDir())).toEqual([])
    expect(isLink(cardDir('linked'))).toBe(true)
    expect(readlinkSync(cardDir('linked'))).toBe(target)
    untouched()

    const second = trash.put(PROJECT, 'linked')
    expect(isLink(inTrash(second.label))).toBe(true)
    now += TRASH_KEEP_MS + 1000
    expect(trash.purge(PROJECT)).toEqual([second.label])
    expect(readdirSync(trashDir())).toEqual([])
    expect(gone(cardDir('linked'))).toBe(true)
    untouched()
  })

  it('a link that leads nowhere is moved all the same, and put back', () => {
    cardThatIsLink('nowhere', join(scratch, 'no-such-folder'))
    const target = readlinkSync(cardDir('nowhere'))
    const trash = store()
    const entry = trash.put(PROJECT, 'nowhere')
    expect(entry).toMatchObject({ hasFiles: true, title: null })
    expect(gone(cardDir('nowhere'))).toBe(true)
    expect(isLink(inTrash(entry.label))).toBe(true)

    trash.restore(PROJECT, entry.label)
    expect(readdirSync(trashDir())).toEqual([])
    expect(isLink(cardDir('nowhere'))).toBe(true)
    expect(readlinkSync(cardDir('nowhere'))).toBe(target)
  })

  it('restore refuses while a link that leads nowhere lies at the place of the data file of the Card; the entry stays, and nothing is put back', () => {
    mkdirSync(cardDir('data'), { recursive: true })
    writeFileSync(join(cardDir('data'), 'index.html'), '<title>Data</title>')
    const dataFile = join(dataDir, 'card-data', 'data.json')
    mkdirSync(join(dataDir, 'card-data'))
    writeFileSync(dataFile, '{"n":1}')
    nodes.push({ id: 'data', kind: 'card', x: 0, y: 0, w: 360, h: 280, data: {} } as unknown as LayoutNode)
    const trash = store()
    const entry = trash.put(PROJECT, 'data')
    expect(gone(dataFile)).toBe(true)

    symlinkSync(join(scratch, 'no-such-file'), dataFile, WINDOWS ? 'junction' : 'file')
    links.push(dataFile)
    expect(() => trash.restore(PROJECT, entry.label)).toThrow('A Card with id data exists again; delete it before restoring')
    expect(readdirSync(trashDir())).toEqual([entry.label])
    expect(gone(cardDir('data'))).toBe(true)
    expect(isLink(dataFile)).toBe(true)
    expect(nodes).toEqual([])
  })

  // worfy-windows ticket 28: the removal of an entry that was being made had no test.
  it('when the Node cannot be taken off the Layout, put throws that error; the Card is back with its link and its data, and no entry stays in the trash', () => {
    const { outside, link } = cardWithLinkOut('half')
    const dataFile = join(dataDir, 'card-data', 'half.json')
    mkdirSync(join(dataDir, 'card-data'))
    writeFileSync(dataFile, '{"n":1}')
    const refuse: { remove?: Error } = { remove: new Error('the Layout could not be saved') }
    const trash = store(refuse)
    expect(() => trash.put(PROJECT, 'half')).toThrow('the Layout could not be saved')
    // Everything that moved is back where it was.
    expect(readdirSync(cardDir('half')).sort()).toEqual(['index.html', 'linked'])
    expect(readdirSync(link)).toEqual(['notes.txt'])
    expect(readFileSync(dataFile, 'utf8')).toBe('{"n":1}')
    expect(nodes.map((node) => node.id)).toEqual(['half'])
    // The folder of the entry is gone with the entry.json written into it: the trash lists nothing.
    expect(readdirSync(trashDir())).toEqual([])
    expect(trash.list(PROJECT)).toEqual([])
    expect(readdirSync(outside)).toEqual(['notes.txt'])
    // The next try goes through.
    delete refuse.remove
    const entry = trash.put(PROJECT, 'half')
    expect(readdirSync(trashDir())).toEqual([entry.label])
    expect(existsSync(cardDir('half'))).toBe(false)
  })
})
