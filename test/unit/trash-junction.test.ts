// The trash and a link inside a Card (worfy-windows ticket 23). A junction is a link to a folder on
// NTFS. Under the Node of Electron 44 (24.21.0) fs.rmSync with `recursive` goes through one and
// empties the folder behind it; the files of a Card are written by agents, so a Card may hold one.
// The store is driven directly, over real folders: test/contract/trash.test.ts goes through the IPC
// wrapper, which on Windows refuses its macOS file URL.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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

function store(): TrashStore {
  const layout: TrashLayout = {
    get: () => ({ layout: { nodes } }) as ReturnType<TrashLayout['get']>,
    apply: (_projectId, op) => {
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
})
