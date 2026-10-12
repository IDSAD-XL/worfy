// The trash, the canvas MCP server and the folder picker on Windows, over real folders and a real
// symlink to a share nobody answers for (worfy-windows ticket 20). Every call of node:fs is counted
// (counted-fs.ts): none may name a path through the link. Making a symlink on Windows needs
// Developer Mode: without it the cases are skipped, with the reason.
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TRASH_KEEP_MS } from '../../src/shared/ipc/trash'
import type { LayoutNode } from '../../src/shared/layout/types'
import { TrashStore, type TrashLayout } from '../../src/main/layout/trash'
import { cardIdTaken, cardsFolderAway } from '../../src/main/mcp/canvas-server'
import { browseFolder } from '../../src/main/projects/browse'
import { removeTree } from '../../src/main/storage/remove'
import { canLink, countFsCalls, SHARE, through } from './counted-fs'

const WINDOWS = process.platform === 'win32'
const LINKS = canLink()
const PROJECT = 'demo-0a1b2c3d'

let dir: string
let dataDir: string
let nodes: LayoutNode[]
let now: number

const cardDir = (cardId: string) => join(dataDir, 'cards', cardId)

function trash(): TrashStore {
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
const cardNode = (id: string): LayoutNode => ({ id, kind: 'card', x: 0, y: 0, w: 360, h: 280, data: {} }) as unknown as LayoutNode

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-guards-links-')))
  dataDir = join(dir, 'data')
  mkdirSync(join(dataDir, 'cards'), { recursive: true })
  nodes = []
  now = new Date('2026-10-05T12:00:00Z').getTime()
})

afterEach(() => {
  // removeTree takes a link away as a link: nothing here is followed.
  removeTree(dir)
})

describe.runIf(WINDOWS && LINKS)('a symlink to an unreachable share, on Windows', () => {
  it('in place of a Card folder: the Card goes to the trash as the link it is, with no title; it comes back as a link; purge takes the link away — and no call names a path through it', () => {
    const link = cardDir('away')
    symlinkSync(`${SHARE}\\card`, link, 'dir')
    nodes.push(cardNode('away'))
    const counted = countFsCalls()
    try {
      const store = trash()
      const entry = store.put(PROJECT, 'away')
      expect(entry).toMatchObject({ title: null, hasFiles: true })
      const moved = join(dataDir, 'trash', entry.label, 'card')
      expect(lstatSync(moved).isSymbolicLink()).toBe(true)
      expect(readlinkSync(moved)).toBe(`${SHARE}\\card`)
      expect(readdirSync(join(dataDir, 'cards'))).toEqual([])

      store.restore(PROJECT, entry.label)
      expect(lstatSync(link).isSymbolicLink()).toBe(true)
      expect(readdirSync(join(dataDir, 'trash'))).toEqual([])

      const again = store.put(PROJECT, 'away')
      now += TRASH_KEEP_MS + 1000
      expect(store.purge(PROJECT)).toEqual([again.label])
      expect(readdirSync(join(dataDir, 'trash'))).toEqual([])

      for (const path of [link, moved, join(dataDir, 'trash', again.label, 'card')]) expect(through(counted.calls, path), path).toEqual([])
    } finally {
      counted.restore()
    }
  })

  it('in place of the index.html of a Card: the Card goes to the trash with its files and no title, and the file is not opened', () => {
    mkdirSync(cardDir('c1'))
    writeFileSync(join(cardDir('c1'), 'app.js'), '// app')
    const link = join(cardDir('c1'), 'index.html')
    symlinkSync(`${SHARE}\\index.html`, link, 'file')
    nodes.push(cardNode('c1'))
    const counted = countFsCalls()
    try {
      const entry = trash().put(PROJECT, 'c1')
      expect(entry).toMatchObject({ title: null, hasFiles: true })
      expect(through(counted.calls, link)).toEqual([])
      expect(readdirSync(join(dataDir, 'trash', entry.label, 'card')).sort()).toEqual(['app.js', 'index.html'])
    } finally {
      counted.restore()
    }
  })

  it('in place of the Cards folder: the Node goes to the trash alone, a Card is not put back there, and the canvas server asks nothing about an id', () => {
    removeTree(join(dataDir, 'cards'))
    const link = join(dataDir, 'cards')
    symlinkSync(`${SHARE}\\cards`, link, 'dir')
    nodes.push(cardNode('c1'))
    const counted = countFsCalls()
    try {
      const store = trash()
      const entry = store.put(PROJECT, 'c1')
      expect(entry).toMatchObject({ title: null, hasFiles: false })
      expect(cardsFolderAway(link)).toBe(true)
      expect(cardIdTaken(link, 'card-1')).toBe(false)
      expect(through(counted.calls, link)).toEqual([])
    } finally {
      counted.restore()
    }
  })

  it('in place of the Cards folder after a Card went to the trash: the Card is not put back there, the entry stays, and no call names a path through the link', () => {
    mkdirSync(cardDir('c1'))
    writeFileSync(join(cardDir('c1'), 'index.html'), '<title>Clock</title>')
    nodes.push(cardNode('c1'))
    const store = trash()
    const entry = store.put(PROJECT, 'c1')
    expect(entry).toMatchObject({ title: 'Clock', hasFiles: true })
    removeTree(join(dataDir, 'cards'))
    const link = join(dataDir, 'cards')
    symlinkSync(`${SHARE}\\cards`, link, 'dir')
    const counted = countFsCalls()
    try {
      expect(() => store.restore(PROJECT, entry.label)).toThrow('The folder of Card c1 leads off this machine, or cannot be checked; the Card is not put back')
      expect(through(counted.calls, link)).toEqual([])
      expect(readdirSync(join(dataDir, 'trash', entry.label)).sort()).toEqual(['card', 'entry.json'])
    } finally {
      counted.restore()
    }
  })

  it('at the path of a Card id in the Cards folder: the id is taken, and the link is not followed', () => {
    const link = cardDir('card-away')
    symlinkSync(`${SHARE}\\card`, link, 'dir')
    mkdirSync(cardDir('card-1'))
    const counted = countFsCalls()
    try {
      expect(['card-away', 'card-1', 'card-free'].map((id) => cardIdTaken(join(dataDir, 'cards'), id))).toEqual([true, true, false])
      expect(through(counted.calls, link)).toEqual([])
    } finally {
      counted.restore()
    }
  })

  it('among the folders of the folder picker: the link is not in the list, a junction to a folder of this machine is, and no call names a path through the link', async () => {
    const work = join(dir, 'work')
    mkdirSync(join(work, 'repo', '.git'), { recursive: true })
    mkdirSync(join(dir, 'elsewhere', 'clone', '.git'), { recursive: true })
    symlinkSync(join(dir, 'elsewhere', 'clone'), join(work, 'linked'), 'junction')
    const link = join(work, 'assets')
    symlinkSync(`${SHARE}\\assets`, link, 'dir')
    const counted = countFsCalls()
    try {
      const at = performance.now()
      const answer = await browseFolder(work)
      // A call through such a link takes more than a second to fail.
      expect(performance.now() - at).toBeLessThan(1000)
      expect(answer.ok && answer.folders.map((folder) => [folder.name, folder.gitRepo])).toEqual([
        ['linked', true],
        ['repo', true],
      ])
      expect(through(counted.calls, link)).toEqual([])
    } finally {
      counted.restore()
    }
  })
})

describe.runIf(WINDOWS)('a junction to a folder of this machine, on Windows', () => {
  it('in place of a Card folder: the title is read through it, and the Card goes to the trash as the link it is', () => {
    const behind = join(dir, 'elsewhere', 'card')
    mkdirSync(behind, { recursive: true })
    writeFileSync(join(behind, 'index.html'), '<title>Behind the junction</title>')
    symlinkSync(behind, cardDir('linked'), 'junction')
    nodes.push(cardNode('linked'))
    const entry = trash().put(PROJECT, 'linked')
    expect(entry).toMatchObject({ title: 'Behind the junction', hasFiles: true })
    expect(lstatSync(join(dataDir, 'trash', entry.label, 'card')).isSymbolicLink()).toBe(true)
    expect(readdirSync(behind)).toEqual(['index.html'])
  })

  it.skipIf(LINKS)('the cases with a symlink to a share are skipped: this user may not make a symlink (Developer Mode is off)', () => {
    expect(LINKS).toBe(false)
  })
})
