// resolveDocPath, readDoc and readDocs of src/main/docs/watch.ts and a link that leads to a share
// (worfy-windows ticket 19). On Windows realpath, readdir and a read through a symlink to
// `\\host\share\…` make the system contact that host with the user's credentials; HANDOFF.md and
// the ADRs are read when a Project is opened, with no click at all. The path rules are path.win32
// and the file system is replaced, so every case but the last runs on any machine.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeTestTree } from '../remove'

/** What Node itself was asked through node:fs/promises. */
const asked = vi.hoisted(() => ({ lstat: [] as string[], realpath: [] as string[], readdir: [] as string[], stat: [] as string[], readFile: [] as string[] }))

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  const watched =
    <Name extends keyof typeof asked>(name: Name) =>
    (...args: unknown[]): unknown => {
      asked[name].push(String(args[0]))
      return (actual[name] as (...all: unknown[]) => unknown)(...args)
    }
  return { ...actual, lstat: watched('lstat'), realpath: watched('realpath'), readdir: watched('readdir'), stat: watched('stat'), readFile: watched('readFile') }
})

const { readDoc, readDocs, resolveDocPath } = await import('../../src/main/docs/watch')

afterEach(() => {
  for (const list of Object.values(asked)) list.length = 0
})

const ROOT = 'C:\\p\\repo'
const HANDOFF = '# HANDOFF\n'
const adr = (title: string): string => `# ${title}\n\nСтатус: принят.\n`

interface Tree {
  /** The files and their text, by full path. */
  files?: Record<string, string>
  /** A link and its target as written. */
  links?: Record<string, string>
  /** What realpath answers for a path that is not itself; any other path is its own real path. */
  reals?: Record<string, string>
  /** Paths lstat is refused for (EACCES). */
  denied?: readonly string[]
  /** Links whose target cannot be read: readlink fails. */
  unreadable?: readonly string[]
}

/**
 * A file system under the given rules: `fs` is what watch.ts asks for the documents, `links` what
 * the walk reads. Every call is recorded; a path through a link is answered as the real system
 * would only after following it, so a test sees such a call in `calls`.
 */
function fakeSystem(tree: Tree, rules: typeof win32 = win32) {
  const calls: string[] = []
  const key = (path: string): string => (rules === win32 ? path.toLowerCase() : path)
  const files = new Map(Object.entries(tree.files ?? {}).map(([path, text]) => [key(path), text]))
  const links = new Map(Object.entries(tree.links ?? {}).map(([path, target]) => [key(path), target]))
  const reals = new Map(Object.entries(tree.reals ?? {}).map(([path, real]) => [key(path), real]))
  const missing = (path: string): Error => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  const isFolder = (path: string): boolean => [...files.keys()].some((file) => file.startsWith(`${key(path)}${rules.sep}`))
  const real = (path: string): string => {
    const hit = [...reals.entries()].find(([from]) => key(path) === from || key(path).startsWith(`${from}${rules.sep}`))
    return hit === undefined ? path : `${hit[1]}${path.slice(hit[0].length)}`
  }
  return {
    calls,
    options: {
      paths: rules,
      fs: {
        realpath: async (path: string): Promise<string> => {
          calls.push(`realpath ${path}`)
          const answer = real(path)
          if (!files.has(key(answer)) && !isFolder(answer)) throw missing(path)
          return answer
        },
        readdir: async (dir: string): Promise<string[]> => {
          calls.push(`readdir ${dir}`)
          const inside = [...files.keys()].filter((file) => file.startsWith(`${key(real(dir))}${rules.sep}`)).map((file) => file.slice(key(real(dir)).length + 1))
          if (inside.length === 0) throw missing(dir)
          return [...new Set(inside.map((rest) => rest.split(rules.sep)[0]!))]
        },
        stat: async (path: string): Promise<{ isFile: () => boolean; size: number }> => {
          calls.push(`stat ${path}`)
          const text = files.get(key(path))
          if (text === undefined && !isFolder(path)) throw missing(path)
          return { isFile: () => text !== undefined, size: text === undefined ? 0 : Buffer.byteLength(text) }
        },
        readFile: async (path: string): Promise<string> => {
          calls.push(`readFile ${path}`)
          const text = files.get(key(path))
          if (text === undefined) throw missing(path)
          return text
        },
      },
      links: {
        isLink: async (path: string): Promise<boolean | null> => {
          calls.push(`lstat ${path}`)
          if ((tree.denied ?? []).some((each) => key(each) === key(path))) throw Object.assign(new Error(`EACCES: ${path}`), { code: 'EACCES' })
          return links.has(key(path)) || (tree.unreadable ?? []).some((each) => key(each) === key(path))
        },
        readlink: async (path: string): Promise<string> => {
          calls.push(`readlink ${path}`)
          const target = links.get(key(path))
          if (target === undefined) throw Object.assign(new Error(`EINVAL: ${path}`), { code: 'EINVAL' })
          return target
        },
      },
    },
  }
}

const PLAIN = {
  'C:\\p\\repo\\HANDOFF.md': HANDOFF,
  'C:\\p\\repo\\docs\\adr\\0001-first.md': adr('Первый'),
  'C:\\p\\repo\\docs\\adr\\0002-second.md': adr('Второй'),
}

describe('resolveDocPath and a link that leads to a share (Windows rules)', () => {
  // The first test of the ticket: on main realpath went to the path as it came from the renderer.
  it('refuses a UNC or device path by its text: Node is asked nothing at all, realpath included', async () => {
    // On Windows the root is a real folder, so that a missing root is not what refuses the path.
    const root = process.platform === 'win32' ? realpathSync(tmpdir()) : ROOT
    for (const path of ['\\\\worfy-no-such-host\\share\\HANDOFF.md', '//worfy-no-such-host/share/x', '\\\\?\\UNC\\worfy-no-such-host\\share\\HANDOFF.md', '\\\\.\\pipe\\x']) {
      await expect(resolveDocPath(root, path, { paths: win32 }), path).rejects.toThrow(/is outside the Project$/)
    }
    expect(asked).toEqual({ lstat: [], realpath: [], readdir: [], stat: [], readFile: [] })
  })

  it('refuses such a path before the replaced file system is asked anything either', async () => {
    const system = fakeSystem({ files: PLAIN })
    // The last one: a server spelled like the disk of the Project, which path.win32.relative reads as that disk.
    for (const path of ['\\\\evil\\share\\HANDOFF.md', '//evil/share/x', '\\\\?\\C:\\elsewhere\\HANDOFF.md', '\\\\C:\\p\\repo\\HANDOFF.md']) {
      await expect(resolveDocPath(ROOT, path, system.options), path).rejects.toThrow(/is outside the Project$/)
    }
    expect(system.calls).toEqual([])
  })

  it.each([
    ['HANDOFF.md itself', 'HANDOFF.md', { 'C:\\p\\repo\\HANDOFF.md': '\\\\evil\\share\\HANDOFF.md' }, 'C:\\p\\repo\\HANDOFF.md'],
    ['the docs folder', 'docs/adr/0001-first.md', { 'C:\\p\\repo\\docs': '\\\\evil\\share\\docs' }, 'C:\\p\\repo\\docs'],
    ['the folder of the ADRs', 'docs/adr/0001-first.md', { 'C:\\p\\repo\\docs\\adr': '//evil/share/adr' }, 'C:\\p\\repo\\docs\\adr'],
    ['an ADR file', 'docs/adr/0001-first.md', { 'C:\\p\\repo\\docs\\adr\\0001-first.md': '\\??\\GLOBALROOT\\Device\\Mup\\evil\\share\\a.md' }, 'C:\\p\\repo\\docs\\adr\\0001-first.md'],
    ['a local link whose target is a link to a share', 'HANDOFF.md', { 'C:\\p\\repo\\HANDOFF.md': 'C:\\p\\repo\\hop.md', 'C:\\p\\repo\\hop.md': '\\\\evil\\share\\HANDOFF.md' }, 'C:\\p\\repo\\hop.md'],
  ])('refuses a document when %s is a link to a share: realpath is asked about the root alone, and nothing after that readlink', async (_case, path, links, link) => {
    const system = fakeSystem({ files: PLAIN, links })
    await expect(resolveDocPath(ROOT, path, system.options)).rejects.toThrow(/is outside the Project$/)
    expect(system.calls.filter((call) => !call.startsWith('lstat') && !call.startsWith('readlink'))).toEqual(['realpath C:\\p\\repo'])
    expect(system.calls.at(-1)).toBe(`readlink ${link}`)
    expect(system.calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it('resolves HANDOFF.md and an ADR as before, and a link that stays inside the Project', async () => {
    const system = fakeSystem({ files: PLAIN, links: { 'C:\\p\\repo\\docs\\adr\\0003-alias.md': '0001-first.md' }, reals: { 'C:\\p\\repo\\docs\\adr\\0003-alias.md': 'C:\\p\\repo\\docs\\adr\\0001-first.md' } })
    expect(await resolveDocPath(ROOT, 'HANDOFF.md', system.options)).toEqual({ real: 'C:\\p\\repo\\HANDOFF.md', rel: 'HANDOFF.md' })
    expect(await resolveDocPath(ROOT, 'docs/adr/0002-second.md', system.options)).toEqual({ real: 'C:\\p\\repo\\docs\\adr\\0002-second.md', rel: 'docs/adr/0002-second.md' })
    expect(await resolveDocPath(ROOT, 'docs\\adr\\0003-alias.md', system.options)).toEqual({ real: 'C:\\p\\repo\\docs\\adr\\0001-first.md', rel: 'docs/adr/0001-first.md' })
    await expect(resolveDocPath(ROOT, '..\\other\\HANDOFF.md', system.options)).rejects.toThrow(/is outside the Project$/)
    await expect(resolveDocPath(ROOT, 'docs/adr/0009-none.md', system.options)).rejects.toThrow(/does not exist$/)
    await expect(resolveDocPath(ROOT, 'docs/adr/notes.md', fakeSystem({ files: { ...PLAIN, 'C:\\p\\repo\\docs\\adr\\notes.md': 'x' } }).options)).rejects.toThrow(/only HANDOFF.md and docs\/adr/)
  })

  it('reads the documents of a Project that is itself on a share, and of one reached through a link to its own share', async () => {
    const onShare = fakeSystem({ files: { '\\\\nas\\team\\repo\\HANDOFF.md': HANDOFF, '\\\\nas\\team\\repo\\docs\\adr\\0001-first.md': adr('Первый') } })
    expect(await resolveDocPath('\\\\nas\\team\\repo', 'HANDOFF.md', onShare.options)).toEqual({ real: '\\\\nas\\team\\repo\\HANDOFF.md', rel: 'HANDOFF.md' })
    expect((await readDoc('\\\\nas\\team\\repo', 'docs/adr/0001-first.md', onShare.options)).text).toBe(adr('Первый'))
    // Another folder of the same share is not the Project's.
    await expect(resolveDocPath('\\\\nas\\team\\repo', '\\\\nas\\team\\other\\HANDOFF.md', onShare.options)).rejects.toThrow(/is outside the Project$/)

    const linked = fakeSystem({ files: { '\\\\nas\\team\\repo\\HANDOFF.md': HANDOFF }, links: { 'C:\\p\\repo': '\\\\nas\\team\\repo' }, reals: { 'C:\\p\\repo': '\\\\nas\\team\\repo' } })
    expect(await resolveDocPath(ROOT, 'HANDOFF.md', linked.options)).toEqual({ real: '\\\\nas\\team\\repo\\HANDOFF.md', rel: 'HANDOFF.md' })

    // A Project folder on a share that is itself a link to another folder of that share: the folder
    // as written and its real path are both the Project's own.
    const aliased = fakeSystem({ files: { '\\\\nas\\team\\real\\HANDOFF.md': HANDOFF }, links: { '\\\\nas\\team\\repo': '\\\\nas\\team\\real' }, reals: { '\\\\nas\\team\\repo': '\\\\nas\\team\\real' } })
    expect(await resolveDocPath('\\\\nas\\team\\repo', 'HANDOFF.md', aliased.options)).toEqual({ real: '\\\\nas\\team\\real\\HANDOFF.md', rel: 'HANDOFF.md' })
  })

  it('says that a document could not be checked, not that it is outside, when a folder on the way cannot be looked at', async () => {
    const system = fakeSystem({ files: PLAIN, denied: ['C:\\p\\repo\\docs'] })
    const refused = resolveDocPath(ROOT, 'docs/adr/0001-first.md', system.options)
    // The whole wording, as every caller gives it (review round 2 of PR #233, mutant N27).
    await expect(refused).rejects.toThrow(/^docs\/adr\/0001-first\.md cannot be checked: a link on the way to it cannot be read, or the links do not end$/)
    expect(system.calls).toEqual(['realpath C:\\p\\repo', 'lstat C:\\p\\repo', 'lstat C:\\p\\repo\\docs'])
  })

  it('given no links to read with, reads them with lstat of Node', async () => {
    const system = fakeSystem({ files: { 'C:\\worfy-no-such-folder-19\\repo\\HANDOFF.md': HANDOFF } })
    const root = 'C:\\worfy-no-such-folder-19\\repo'
    // A folder that is on no machine: the walk ends at its first segment, which is not there.
    expect(await resolveDocPath(root, 'HANDOFF.md', { paths: win32, fs: system.options.fs })).toEqual({ real: `${root}\\HANDOFF.md`, rel: 'HANDOFF.md' })
    expect(asked.lstat).toEqual([root])
    expect(asked.realpath).toEqual([])
  })

  it('under POSIX rules reads no link and asks realpath as before', async () => {
    const system = fakeSystem({ files: { '/p/repo/HANDOFF.md': HANDOFF }, links: { '/p/repo/HANDOFF.md': '//evil/share/HANDOFF.md' } }, posix as typeof win32)
    expect(await resolveDocPath('/p/repo', 'HANDOFF.md', system.options)).toEqual({ real: '/p/repo/HANDOFF.md', rel: 'HANDOFF.md' })
    expect(system.calls).toEqual(['realpath /p/repo', 'realpath /p/repo/HANDOFF.md'])
  })
})

describe('readDocs and a link that leads to a share (Windows rules)', () => {
  const paths = (docs: Awaited<ReturnType<typeof readDocs>>): string[] => docs.adrs.map((each) => each.path)

  it('lists HANDOFF.md and the ADRs of a Project with no such link, as before', async () => {
    const system = fakeSystem({ files: PLAIN })
    const docs = await readDocs(ROOT, system.options)
    expect(docs.handoff?.path).toBe('HANDOFF.md')
    expect(paths(docs)).toEqual(['docs/adr/0001-first.md', 'docs/adr/0002-second.md'])
    expect(docs.adrs[0]).toMatchObject({ number: '0001', title: 'Первый', status: 'принят' })
    expect(system.calls).toContain('readdir C:\\p\\repo\\docs\\adr')
  })

  it('leaves out HANDOFF.md that is a link to a share, without reading it, and still lists the ADRs', async () => {
    const system = fakeSystem({ files: PLAIN, links: { 'C:\\p\\repo\\HANDOFF.md': '\\\\evil\\share\\HANDOFF.md' } })
    const docs = await readDocs(ROOT, system.options)
    expect(docs.handoff).toBeNull()
    expect(paths(docs)).toEqual(['docs/adr/0001-first.md', 'docs/adr/0002-second.md'])
    expect(system.calls.filter((call) => /^(realpath|stat|readFile) C:\\p\\repo\\HANDOFF\.md$/.test(call))).toEqual([])
  })

  it.each([
    ['the folder of the ADRs', { 'C:\\p\\repo\\docs\\adr': '\\\\evil\\share\\adr' }],
    ['the docs folder', { 'C:\\p\\repo\\docs': '\\\\evil\\share\\docs' }],
  ])('lists no ADR when %s is a link to a share, and never lists that folder', async (_case, links) => {
    const system = fakeSystem({ files: PLAIN, links })
    const docs = await readDocs(ROOT, system.options)
    expect(docs.handoff?.path).toBe('HANDOFF.md')
    expect(docs.adrs).toEqual([])
    expect(system.calls.filter((call) => call.startsWith('readdir'))).toEqual([])
    expect(system.calls.some((call) => call.includes('evil'))).toBe(false)
  })

  // Review round 1 of PR #233: a way that cannot be checked is not a way that is clear. The folder
  // of the ADRs is listed when a Project is opened, with no click.
  const chainToShare = (start: string, count: number): Record<string, string> => {
    const hop = (index: number): string => (index === 0 ? start : `C:\\p\\repo\\hop${index}`)
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [hop(index), index === count - 1 ? '\\\\evil\\share\\adr' : hop(index + 1)]))
  }
  it.each<[string, Tree]>([
    ['the docs folder cannot be looked at', { denied: ['C:\\p\\repo\\docs'] }],
    ['the folder of the ADRs cannot be looked at', { denied: ['C:\\p\\repo\\docs\\adr'] }],
    ['the folder of the ADRs is a link that cannot be read', { unreadable: ['C:\\p\\repo\\docs\\adr'] }],
    ['the docs folder is a link in a circle of links', { links: { 'C:\\p\\repo\\docs': 'C:\\p\\repo\\round', 'C:\\p\\repo\\round': 'C:\\p\\repo\\docs' } }],
    ['the folder of the ADRs is the first of 41 links, the last of them to a share', { links: chainToShare('C:\\p\\repo\\docs\\adr', 41) }],
  ])('lists no ADR and never lists the folder when %s; HANDOFF.md is read as before', async (_case, tree) => {
    const system = fakeSystem({ files: PLAIN, ...tree })
    const docs = await readDocs(ROOT, system.options)
    expect(docs.handoff?.path).toBe('HANDOFF.md')
    expect(docs.adrs).toEqual([])
    expect(system.calls.filter((call) => call.startsWith('readdir'))).toEqual([])
    expect(system.calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it('lists the ADRs of a Project on a share whose folder there is a link to another folder of that share', async () => {
    const files = { '\\\\nas\\team\\real\\HANDOFF.md': HANDOFF, '\\\\nas\\team\\real\\docs\\adr\\0001-first.md': adr('Первый') }
    const system = fakeSystem({ files, links: { '\\\\nas\\team\\repo': '\\\\nas\\team\\real' }, reals: { '\\\\nas\\team\\repo': '\\\\nas\\team\\real' } })
    const docs = await readDocs('\\\\nas\\team\\repo', system.options)
    expect(docs.handoff?.path).toBe('HANDOFF.md')
    expect(paths(docs)).toEqual(['docs/adr/0001-first.md'])
  })

  it('leaves out one ADR that is a link to a share, without reading it, and lists the others', async () => {
    const system = fakeSystem({ files: PLAIN, links: { 'C:\\p\\repo\\docs\\adr\\0001-first.md': '\\\\evil\\share\\0001-first.md' } })
    const docs = await readDocs(ROOT, system.options)
    expect(paths(docs)).toEqual(['docs/adr/0002-second.md'])
    expect(system.calls.filter((call) => /^(realpath|stat|readFile) .*0001-first\.md$/.test(call))).toEqual([])
    expect(system.calls).toContain('readFile C:\\p\\repo\\docs\\adr\\0002-second.md')
  })

  it('lists the documents of a Project on a share, the folder of its ADRs included', async () => {
    const system = fakeSystem({ files: { '\\\\nas\\team\\repo\\HANDOFF.md': HANDOFF, '\\\\nas\\team\\repo\\docs\\adr\\0001-first.md': adr('Первый') } })
    const docs = await readDocs('\\\\nas\\team\\repo', system.options)
    expect(docs.handoff?.path).toBe('HANDOFF.md')
    expect(paths(docs)).toEqual(['docs/adr/0001-first.md'])
  })

  it('lists the ADRs of a Project reached through a link to its own share', async () => {
    const files = { '\\\\nas\\team\\repo\\HANDOFF.md': HANDOFF, '\\\\nas\\team\\repo\\docs\\adr\\0001-first.md': adr('Первый') }
    const system = fakeSystem({ files, links: { 'C:\\p\\repo': '\\\\nas\\team\\repo' }, reals: { 'C:\\p\\repo': '\\\\nas\\team\\repo' } })
    const docs = await readDocs(ROOT, system.options)
    expect(docs.handoff?.path).toBe('HANDOFF.md')
    expect(paths(docs)).toEqual(['docs/adr/0001-first.md'])
  })

  it('given no links to read with, reads them with lstat of Node: for HANDOFF.md, for the folder of the ADRs and for each ADR', async () => {
    const root = 'C:\\worfy-no-such-folder-19\\repo'
    const system = fakeSystem({ files: { [`${root}\\HANDOFF.md`]: HANDOFF, [`${root}\\docs\\adr\\0001-first.md`]: adr('Первый') } })
    // A folder that is on no machine: each walk ends at its first segment, which is not there.
    const docs = await readDocs(root, { paths: win32, fs: system.options.fs })
    expect(paths(docs)).toEqual(['docs/adr/0001-first.md'])
    expect(asked.lstat).toEqual([root, root, root])
  })

  it('answers with no document for a Project folder that is not there, as before', async () => {
    const system = fakeSystem({ files: {} })
    expect(await readDocs(ROOT, system.options)).toEqual({ handoff: null, adrs: [] })
    // Once for HANDOFF.md and once for the folder of the ADRs; nothing is asked after that.
    expect(system.calls).toEqual(['realpath C:\\p\\repo', 'realpath C:\\p\\repo'])
  })

  it('under POSIX rules reads no link: the folder is listed and the files are read as before', async () => {
    const system = fakeSystem({ files: { '/p/repo/HANDOFF.md': HANDOFF, '/p/repo/docs/adr/0001-first.md': adr('Первый') }, links: { '/p/repo/docs/adr': '//evil/share/adr' } }, posix as typeof win32)
    const docs = await readDocs('/p/repo', system.options)
    expect(docs.handoff?.path).toBe('HANDOFF.md')
    expect(paths(docs)).toEqual(['docs/adr/0001-first.md'])
    expect(system.calls.filter((call) => call.startsWith('lstat') || call.startsWith('readlink'))).toEqual([])
    // The same calls as before this check was there, in the same order: none is added off Windows.
    expect(system.calls).toEqual([
      'realpath /p/repo',
      'realpath /p/repo/HANDOFF.md',
      'stat /p/repo/HANDOFF.md',
      'readFile /p/repo/HANDOFF.md',
      'readdir /p/repo/docs/adr',
      'realpath /p/repo',
      'realpath /p/repo/docs/adr/0001-first.md',
      'stat /p/repo/docs/adr/0001-first.md',
      'readFile /p/repo/docs/adr/0001-first.md',
    ])
  })
})

// Real links, as a checked-out repository would have them. Only Windows makes a share of `\\host\…`.
describe.runIf(process.platform === 'win32')('the documents of a Project with real links to a share (Windows)', () => {
  let scratch: string | undefined

  afterEach(() => {
    if (scratch !== undefined) removeTestTree(scratch)
    scratch = undefined
  })

  it('reads none of them through the link: realpath, readdir, stat and readFile of Node are asked about no such path', async (context) => {
    // The spelling readDocs reaches: an 8.3 or subst TEMP (the runner's C:\Users\RUNNER~1) comes back long.
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-docs-links-')))
    const byFile = join(scratch, 'by-file')
    const byFolder = join(scratch, 'by-folder')
    mkdirSync(join(byFile, 'docs', 'adr'), { recursive: true })
    mkdirSync(join(byFolder, 'docs'), { recursive: true })
    writeFileSync(join(byFile, 'docs', 'adr', '0001-real.md'), adr('Настоящий'))
    writeFileSync(join(byFolder, 'HANDOFF.md'), HANDOFF)
    try {
      symlinkSync('\\\\worfy-no-such-host\\share\\HANDOFF.md', join(byFile, 'HANDOFF.md'), 'file')
      symlinkSync('\\\\worfy-no-such-host\\share\\0002-far.md', join(byFile, 'docs', 'adr', '0002-far.md'), 'file')
      symlinkSync('\\\\worfy-no-such-host\\share\\adr', join(byFolder, 'docs', 'adr'), 'dir')
    } catch (error) {
      // A user without Developer Mode may not create symlinks.
      context.skip(`this user cannot create a symlink: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const list of Object.values(asked)) list.length = 0

    await expect(readDoc(byFile, 'HANDOFF.md')).rejects.toThrow(/is outside the Project$/)
    await expect(readDoc(byFile, 'docs/adr/0002-far.md')).rejects.toThrow(/is outside the Project$/)
    const first = await readDocs(byFile)
    expect(first.handoff).toBeNull()
    expect(first.adrs.map((each) => each.path)).toEqual(['docs/adr/0001-real.md'])
    const second = await readDocs(byFolder)
    expect(second.handoff?.path).toBe('HANDOFF.md')
    expect(second.adrs).toEqual([])

    const real = join(byFile, 'docs', 'adr', '0001-real.md')
    expect(new Set(asked.realpath)).toEqual(new Set([byFile, byFolder, real, join(byFolder, 'HANDOFF.md')]))
    expect(asked.readdir).toEqual([join(byFile, 'docs', 'adr')])
    expect(new Set(asked.stat)).toEqual(new Set([real, join(byFolder, 'HANDOFF.md')]))
    expect(new Set(asked.readFile)).toEqual(new Set([real, join(byFolder, 'HANDOFF.md')]))
  })
})
