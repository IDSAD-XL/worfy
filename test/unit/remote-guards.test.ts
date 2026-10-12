// The places that read the links before they call through a path (worfy-windows ticket 20): the
// trash (cardOnDisk, placeOf), the canvas MCP server (cardsFolderAway, cardIdTaken), the folder
// picker (browseFolder) — and the walk for callers that cannot wait (walkLinksSync). Over the model
// of a Windows disk (test/unit/windows-disk.ts) with path.win32, on any system: the model marks
// every call Windows would answer by contacting the host of a share.
import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cardOnDisk, placeOf } from '../../src/main/layout/trash'
import { cardIdTaken, cardsFolderAway } from '../../src/main/mcp/canvas-server'
import { browseFolder, type BrowseFs } from '../../src/main/projects/browse'
import { leadsToRemoteSync, walkLinks, walkLinksSync } from '../../src/main/remote-links'
import { FILE, FOLDER, linkTo, windowsDisk, type DiskEntry, type WindowsDisk } from './windows-disk'

const DATA = 'C:\\data\\demo'
const CARDS = `${DATA}\\cards`
const EVIL = '\\\\evil\\share'

/** The calls that name a path through the link, other than lstat and readlink of the link itself. */
const through = (disk: WindowsDisk, link: string): string[] =>
  disk.calls.filter((call) => {
    const path = call.replace(/^\S+ /, '').replace(/ \(recursive\)$/, '').toLowerCase()
    if (path === link.toLowerCase()) return !/^(lstat|readlink) /.test(call)
    return path.startsWith(`${link.toLowerCase()}\\`)
  })

describe('walkLinksSync', () => {
  const DISK: Record<string, DiskEntry> = {
    'C:\\p\\repo\\docs\\plain.md': FILE,
    'C:\\p\\repo\\docs\\away': linkTo(`${EVIL}\\x`),
    'C:\\p\\repo\\docs\\near': linkTo('..\\notes'),
    'C:\\p\\repo\\notes\\further': linkTo('C:\\p\\repo\\docs\\away'),
    'C:\\p\\repo\\notes\\a.md': FILE,
    'C:\\p\\repo\\ring': linkTo('C:\\p\\repo\\ring'),
    'C:\\p\\repo\\unread': linkTo('C:\\p\\repo\\notes'),
    'C:\\p\\repo\\denied\\x.md': FILE,
  }
  const CASES = [
    'C:\\p\\repo\\docs\\plain.md',
    'C:\\p\\repo\\docs\\away\\file.md',
    'C:\\p\\repo\\docs\\near\\a.md',
    'C:\\p\\repo\\docs\\near\\further\\deep.md',
    'C:\\p\\repo\\ring\\x',
    'C:\\p\\repo\\unread\\a.md',
    'C:\\p\\repo\\denied\\x.md',
    'C:\\p\\repo\\nothing\\here.md',
    `${EVIL}\\straight`,
    'D:\\elsewhere\\x',
  ]

  it('gives the verdict of walkLinks for the same path, with the same calls in the same order', async () => {
    const verdicts: string[] = []
    for (const path of CASES) {
      const [waited, atOnce, asked] = [windowsDisk(DISK), windowsDisk(DISK), windowsDisk(DISK)]
      for (const disk of [waited, atOnce, asked]) {
        disk.breakLink('C:\\p\\repo\\unread')
        disk.deny('C:\\p\\repo\\denied')
      }
      const verdict = await walkLinks(path, ['C:\\p\\repo'], { paths: win32, links: waited.links })
      expect(walkLinksSync(path, ['C:\\p\\repo'], { paths: win32, links: atOnce.linksSync }), path).toBe(verdict)
      expect(atOnce.calls, path).toEqual(waited.calls)
      expect(atOnce.contacts, path).toEqual([])
      expect(leadsToRemoteSync(path, ['C:\\p\\repo'], { paths: win32, links: asked.linksSync }), path).toBe(verdict !== 'local')
      verdicts.push(verdict)
    }
    expect(verdicts).toEqual(['local', 'remote', 'local', 'remote', 'unchecked', 'unchecked', 'unchecked', 'local', 'remote', 'local'])
  })

  it('under POSIX rules answers "local" and asks nothing', () => {
    const disk = windowsDisk(DISK)
    expect(walkLinksSync('/p/repo/docs/away/x', ['/p/repo'], { paths: posix, links: disk.linksSync })).toBe('local')
    expect(disk.calls).toEqual([])
  })

  it('given no links to read with, reads them with lstatSync of Node', () => {
    // A folder that is not there: the walk ends at the first name that is missing.
    expect(walkLinksSync('C:\\worfy-no-such-folder-20\\x\\y', ['C:\\worfy-no-such-folder-20'], { paths: win32 })).toBe('local')
  })
})

describe('the trash and the files of a Card', () => {
  const card = (id: string) => ({ folder: `${CARDS}\\${id}`, data: `${DATA}\\card-data\\${id}.json` })
  const ask = (disk: WindowsDisk, id: string) => cardOnDisk(card(id), DATA, { paths: win32, links: disk.linksSync, fs: { there: disk.there, readText: disk.readText } })

  it('a plain Card: its folder and its data are there, and the title is read from its index.html', () => {
    const disk = windowsDisk({ [`${CARDS}\\c1\\index.html`]: FILE, [`${DATA}\\card-data\\c1.json`]: FILE })
    expect(ask(disk, 'c1')).toEqual({ folder: true, data: true, title: `the text of ${CARDS}\\c1\\index.html` })
    expect(ask(disk, 'gone')).toEqual({ folder: false, data: false, title: null })
    expect(disk.contacts).toEqual([])
  })

  it('a Card folder that is a link to a share is there — it goes to the trash as a link — and its title is not read', () => {
    const link = `${CARDS}\\c1`
    const disk = windowsDisk({ [link]: linkTo(`${EVIL}\\card`), [`${CARDS}\\c2\\index.html`]: FILE })
    expect(ask(disk, 'c1')).toEqual({ folder: true, data: false, title: null })
    expect(disk.contacts).toEqual([])
    expect(through(disk, link)).toEqual([])
    expect(disk.calls.some((call) => call.startsWith('open '))).toBe(false)
  })

  it('an index.html that is a link to a share: the Card is there, the title is not read', () => {
    const link = `${CARDS}\\c1\\index.html`
    const disk = windowsDisk({ [link]: linkTo(`${EVIL}\\index.html`), [`${CARDS}\\c1\\app.js`]: FILE })
    expect(ask(disk, 'c1')).toEqual({ folder: true, data: false, title: null })
    expect(disk.contacts).toEqual([])
    expect(through(disk, link)).toEqual([])
  })

  it('a Cards folder, or the folder of the data files, that is a link to a share: nothing below it is looked at', () => {
    const disk = windowsDisk({ [CARDS]: linkTo(`${EVIL}\\cards`), [`${DATA}\\card-data`]: linkTo(`${EVIL}\\data`), [`${DATA}\\layout.json`]: FILE })
    expect(ask(disk, 'c1')).toEqual({ folder: false, data: false, title: null })
    expect(placeOf(`${CARDS}\\c1`, DATA, { paths: win32, links: disk.linksSync, fs: { there: disk.there, readText: disk.readText } })).toBe('away')
    expect(disk.contacts).toEqual([])
    expect(through(disk, CARDS)).toEqual([])
    expect(through(disk, `${DATA}\\card-data`)).toEqual([])
  })

  it('a link that stays on the machine is followed for the title; one that cannot be read is not', () => {
    const disk = windowsDisk({ [`${CARDS}\\c1`]: linkTo('C:\\elsewhere\\card'), 'C:\\elsewhere\\card\\index.html': FILE, [`${CARDS}\\c2`]: linkTo('C:\\elsewhere\\card') })
    disk.breakLink(`${CARDS}\\c2`)
    expect(ask(disk, 'c1')).toEqual({ folder: true, data: false, title: 'the text of C:\\elsewhere\\card\\index.html' })
    expect(ask(disk, 'c2')).toEqual({ folder: true, data: false, title: null })
  })

  it('placeOf says whether the place a Card goes back to is free, taken — a link counts — or not to be looked at', () => {
    const disk = windowsDisk({ [`${CARDS}\\c1`]: linkTo(`${EVIL}\\card`), [`${CARDS}\\c2\\index.html`]: FILE })
    const place = (path: string) => placeOf(path, DATA, { paths: win32, links: disk.linksSync, fs: { there: disk.there, readText: disk.readText } })
    expect([place(`${CARDS}\\c1`), place(`${CARDS}\\c2`), place(`${CARDS}\\c3`)]).toEqual(['taken', 'taken', 'free'])
    expect(disk.contacts).toEqual([])
  })

  it('a data folder on a share of its own — worfy told to keep its data there — is looked at as a folder of a disk is', () => {
    const data = '\\\\nas\\worfy\\demo'
    const disk = windowsDisk({ [`${data}\\cards\\c1\\index.html`]: FILE, [`${data}\\card-data\\c1.json`]: FILE })
    const fs = { there: disk.there, readText: disk.readText }
    expect(cardOnDisk({ folder: `${data}\\cards\\c1`, data: `${data}\\card-data\\c1.json` }, data, { paths: win32, links: disk.linksSync, fs })).toEqual({
      folder: true,
      data: true,
      title: `the text of ${data}\\cards\\c1\\index.html`,
    })
    expect(placeOf(`${data}\\cards\\c2`, data, { paths: win32, links: disk.linksSync, fs })).toBe('free')
    expect(disk.contacts).toEqual([])
  })

  it('under POSIX rules no link is read: the look and the read are as before', () => {
    const disk = windowsDisk({})
    const seen: string[] = []
    const fs = { there: (path: string) => (seen.push(`there ${path}`), true), readText: (path: string) => (seen.push(`read ${path}`), '<title>T</title>') }
    expect(cardOnDisk({ folder: '/data/demo/cards/c1', data: '/data/demo/card-data/c1.json' }, '/data/demo', { paths: posix, links: disk.linksSync, fs })).toEqual({ folder: true, data: true, title: 'T' })
    expect(disk.calls).toEqual([])
    expect(seen).toEqual(['there /data/demo/cards/c1', 'there /data/demo/card-data/c1.json', 'read /data/demo/cards/c1/index.html'])
  })
})

describe('the canvas MCP server and the id of a new Card', () => {
  const options = (disk: WindowsDisk) => ({ paths: win32, links: disk.linksSync, there: disk.there })

  it('an id is taken when something lies at its path in the Cards folder: a folder, a file, or a link — which is not followed', () => {
    const link = `${CARDS}\\card-away`
    const disk = windowsDisk({ [`${CARDS}\\card-1\\index.html`]: FILE, [`${CARDS}\\card-file`]: FILE, [link]: linkTo(`${EVIL}\\card`) })
    expect(['card-1', 'card-file', 'card-away', 'card-free'].map((id) => cardIdTaken(CARDS, id, options(disk)))).toEqual([true, true, true, false])
    expect(cardsFolderAway(CARDS, options(disk))).toBe(false)
    expect(disk.contacts).toEqual([])
    expect(through(disk, link)).toEqual([])
  })

  it('a Cards folder that is a link to a share, or cannot be checked, must not be asked about: no id is looked for on the disk', () => {
    const disk = windowsDisk({ [CARDS]: linkTo(`${EVIL}\\cards`), [`${DATA}\\layout.json`]: FILE })
    expect(cardsFolderAway(CARDS, options(disk))).toBe(true)
    expect(cardIdTaken(CARDS, 'card-1', options(disk))).toBe(false)
    expect(disk.contacts).toEqual([])
    expect(through(disk, CARDS)).toEqual([])

    const unread = windowsDisk({ [CARDS]: linkTo('C:\\elsewhere\\cards'), 'C:\\elsewhere\\cards\\card-1': FOLDER })
    unread.breakLink(CARDS)
    expect(cardsFolderAway(CARDS, options(unread))).toBe(true)
    expect(cardIdTaken(CARDS, 'card-1', options(unread))).toBe(false)
  })

  it('a Cards folder that is a link to a folder of this machine is asked as before, and so is one on a share of its own', () => {
    const disk = windowsDisk({ [CARDS]: linkTo('C:\\elsewhere\\cards'), 'C:\\elsewhere\\cards\\card-1': FOLDER })
    expect(cardsFolderAway(CARDS, options(disk))).toBe(false)
    expect(cardIdTaken(CARDS, 'card-1', options(disk))).toBe(true)
    const shared = '\\\\nas\\data\\demo\\cards'
    const own = windowsDisk({ [`${shared}\\card-1\\index.html`]: FILE })
    expect(cardsFolderAway(shared, options(own))).toBe(false)
    expect(cardIdTaken(shared, 'card-1', options(own))).toBe(true)
  })
})

describe('the folder picker', () => {
  /** The calls of a browse over the model: readdir, stat and lstat, counted with the rest. */
  const browseFs = (disk: WindowsDisk): BrowseFs => ({
    list: async (folder) => (await disk.fs.list(folder)).map((entry) => ({ name: entry.name, kind: entry.kind === 'file' ? 'other' : entry.kind })),
    isFolder: (path) => disk.fs.isFolder(path),
    there: async (path) => disk.there(path),
  })
  const browse = (disk: WindowsDisk, folder: string) => browseFolder(folder, { path: win32, links: disk.links, fs: browseFs(disk) })

  it('lists the folders, a link to a folder of this machine among them, and says which hold a .git', async () => {
    const disk = windowsDisk({
      'C:\\work\\repo\\.git\\HEAD': FILE,
      'C:\\work\\plain\\notes.txt': FILE,
      'C:\\work\\readme.txt': FILE,
      'C:\\work\\linked': linkTo('C:\\elsewhere\\clone'),
      'C:\\elsewhere\\clone\\.git': FILE,
      'C:\\work\\to-a-file': linkTo('C:\\work\\readme.txt'),
      'C:\\work\\nowhere': linkTo('C:\\gone'),
    })
    const answer = await browse(disk, 'C:\\work')
    expect(answer.ok && answer.folders.map((folder) => [folder.name, folder.gitRepo])).toEqual([
      ['linked', true],
      ['plain', false],
      ['repo', true],
    ])
    expect(disk.contacts).toEqual([])
  })

  it('a link to a share among the folders is not in the list, and nothing is asked through it — no stat of it, no lstat of a .git in it', async () => {
    const link = 'C:\\work\\repo\\assets'
    const disk = windowsDisk({ 'C:\\work\\repo\\src\\main.ts': FILE, [link]: linkTo(`${EVIL}\\assets`) })
    const answer = await browse(disk, 'C:\\work\\repo')
    expect(answer.ok && answer.folders.map((folder) => folder.name)).toEqual(['src'])
    expect(disk.contacts).toEqual([])
    expect(through(disk, link)).toEqual([])
    expect(disk.calls).toContain(`readlink ${link}`)
  })

  it('a link that cannot be read is not in the list either; a chain of links that ends on a share neither', async () => {
    const disk = windowsDisk({ 'C:\\work\\src\\x': FILE, 'C:\\work\\unread': linkTo('C:\\work\\src'), 'C:\\work\\first': linkTo('C:\\work\\second'), 'C:\\work\\second': linkTo(`${EVIL}\\deep`) })
    disk.breakLink('C:\\work\\unread')
    const answer = await browse(disk, 'C:\\work')
    expect(answer.ok && answer.folders.map((folder) => folder.name)).toEqual(['src'])
    expect(disk.contacts).toEqual([])
  })

  it('in a folder on a share the user walked into, a link that stays on that share is listed', async () => {
    const share = '\\\\nas\\work'
    const disk = windowsDisk({ [`${share}\\repo\\.git\\HEAD`]: FILE, [`${share}\\alias`]: linkTo(`${share}\\repo`), [`${share}\\other`]: linkTo(`${EVIL}\\x`) })
    const answer = await browse(disk, share)
    expect(answer.ok && answer.folders.map((folder) => [folder.name, folder.gitRepo])).toEqual([
      ['alias', true],
      ['repo', true],
    ])
  })

  it('under POSIX rules reads no link: every link is asked about with stat, as before', async () => {
    const disk = windowsDisk({})
    const asked: string[] = []
    const fs: BrowseFs = {
      list: async () => [
        { name: 'linked', kind: 'link' },
        { name: 'plain', kind: 'folder' },
        { name: 'file.txt', kind: 'other' },
      ],
      isFolder: async (path) => (asked.push(`stat ${path}`), true),
      there: async (path) => (asked.push(`lstat ${path}`), path.includes('plain')),
    }
    const answer = await browseFolder('/home/dev', { path: posix, links: disk.links, fs })
    expect(answer.ok && answer.folders.map((folder) => [folder.name, folder.gitRepo])).toEqual([
      ['linked', false],
      ['plain', true],
    ])
    expect(disk.calls).toEqual([])
    expect(asked.sort()).toEqual(['lstat /home/dev/linked/.git', 'lstat /home/dev/plain/.git', 'stat /home/dev/linked'])
  })
})
