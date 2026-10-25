// Attachments of a user message (src/main/agent/attachments.ts, ticket 20): the limits, the image
// types, the copy of a file from outside the Project into worfy's data folder, and the user
// message built from the text and the attachments.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attach, recheck, userContent, type AttachTarget } from '../../src/main/agent/attachments'
import { FILE_COPY_LIMIT_BYTES, IMAGE_LIMIT_BYTES, attachmentLines, base64Length, baseName, fileExtension, messageText, shownFile, typedText, type Attachment } from '../../src/shared/agent/attachments'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const GIF = Buffer.from('GIF89a', 'latin1')
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')])
const TIFF = Buffer.from([0x49, 0x49, 0x2a, 0x00])

/** A file of `size` bytes that starts with `head`. */
const sized = (head: Buffer, size: number): Buffer => Buffer.concat([head, Buffer.alloc(size - head.length, 7)])

let scratch: string
let project: string
let outside: string
let target: AttachTarget

/** Every path under `dir`, relative, sorted. */
const tree = (dir: string): string[] => (existsSync(dir) ? (readdirSync(dir, { recursive: true }) as string[]).sort() : [])
/**
 * git in the Project, with auto maintenance off. `git commit` otherwise starts
 * `git maintenance run --auto --detach`; with the git of the CI runner (2.55) the detached child
 * keeps .git/objects/maintenance.lock after commit returns, so a listing of the Project taken right
 * after the commit could hold the lock and the next one not.
 */
const git = (...args: string[]) => execFileSync('git', ['-C', project, '-c', 'maintenance.auto=false', ...args], { encoding: 'utf8' })

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-attachments-')))
  project = join(scratch, 'project')
  outside = join(scratch, 'outside')
  await mkdir(project)
  await mkdir(outside)
  target = { projectRoot: project, cwd: project, attachmentsDir: join(scratch, 'data', 'alpha', 'attachments') }
})

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const MB = 1024 * 1024

describe('attach: limits', () => {
  it('limits an image so that its base64 data stays within the 5 MB the Messages API takes', () => {
    expect(IMAGE_LIMIT_BYTES).toBe(3.75 * MB)
    expect(base64Length(IMAGE_LIMIT_BYTES)).toBe(5 * MB)
    expect(base64Length(IMAGE_LIMIT_BYTES + 1)).toBeGreaterThan(5 * MB)
  })

  it('refuses an image larger than 3.75 MB, with a message, and copies nothing', async () => {
    const path = join(outside, 'big.png')
    await writeFile(path, sized(PNG, IMAGE_LIMIT_BYTES + 1))
    const result = await attach({ kind: 'path', path }, target)
    expect(result).toEqual({ ok: false, name: 'big.png', error: 'big.png is too large: images go up to 3.75 MB' })
    expect(existsSync(target.attachmentsDir)).toBe(false)
  })

  it('refuses a 4 MB image: its base64 data is over 5 MB', async () => {
    const path = join(outside, 'four.png')
    await writeFile(path, sized(PNG, 4 * MB))
    expect(await attach({ kind: 'path', path }, target)).toMatchObject({ ok: false, name: 'four.png' })
  })

  it('takes an image of exactly 3.75 MB', async () => {
    const path = join(outside, 'edge.png')
    await writeFile(path, sized(PNG, IMAGE_LIMIT_BYTES))
    const result = await attach({ kind: 'path', path }, target)
    expect(result.ok && result.attachment.kind).toBe('image')
  })

  it('refuses a pasted image larger than 3.75 MB', async () => {
    const data = sized(PNG, IMAGE_LIMIT_BYTES + 1).toString('base64')
    expect(await attach({ kind: 'pasted', name: 'image.png', data }, target)).toEqual({ ok: false, name: 'image.png', error: 'image.png is too large: images go up to 3.75 MB' })
  })

  it('refuses a file from outside the Project larger than the copy limit, and copies nothing', async () => {
    const path = join(outside, 'huge.log')
    await writeFile(path, Buffer.alloc(FILE_COPY_LIMIT_BYTES + 1, 1))
    const result = await attach({ kind: 'path', path }, target)
    expect(result).toEqual({ ok: false, name: 'huge.log', error: 'huge.log is too large: files from outside the Project go up to 20 MB' })
    expect(existsSync(target.attachmentsDir)).toBe(false)
  })

  it('takes a file inside the Project at any size: it goes by its path, nothing is read or copied', async () => {
    const path = join(project, 'huge.log')
    await writeFile(path, Buffer.alloc(FILE_COPY_LIMIT_BYTES + 1, 1))
    expect(await attach({ kind: 'path', path }, target)).toEqual({ ok: true, attachment: { kind: 'file', name: 'huge.log', path, size: FILE_COPY_LIMIT_BYTES + 1, copied: false } })
    expect(existsSync(target.attachmentsDir)).toBe(false)
  })

  it('refuses a dropped file larger than the copy limit', async () => {
    const data = Buffer.alloc(FILE_COPY_LIMIT_BYTES + 1, 1).toString('base64')
    expect(await attach({ kind: 'dropped', name: 'huge.bin', data }, target)).toMatchObject({ ok: false, name: 'huge.bin' })
    expect(existsSync(target.attachmentsDir)).toBe(false)
  })
})

describe('attach: images', () => {
  it.each([
    ['a.png', PNG, 'image/png'],
    ['a.jpg', JPEG, 'image/jpeg'],
    ['a.gif', GIF, 'image/gif'],
    ['a.webp', WEBP, 'image/webp'],
    // The bytes decide, not the name: the Messages API refuses a block whose type is wrong.
    ['photo.png', JPEG, 'image/jpeg'],
  ])('%s becomes an image block of type %#', async (name, head, mediaType) => {
    const bytes = sized(head, 64)
    const path = join(outside, name)
    await writeFile(path, bytes)
    expect(await attach({ kind: 'path', path }, target)).toEqual({ ok: true, attachment: { kind: 'image', name, mediaType, size: 64, data: bytes.toString('base64') } })
    expect(existsSync(target.attachmentsDir)).toBe(false)
  })

  it('takes a pasted PNG as an image block', async () => {
    const bytes = sized(PNG, 32)
    expect(await attach({ kind: 'pasted', name: 'image.png', data: bytes.toString('base64') }, target)).toEqual({
      ok: true,
      attachment: { kind: 'image', name: 'image.png', mediaType: 'image/png', size: 32, data: bytes.toString('base64') },
    })
  })

  it('refuses a pasted image of an unsupported type', async () => {
    const data = sized(TIFF, 32).toString('base64')
    expect(await attach({ kind: 'pasted', name: 'image.tiff', data }, target)).toEqual({ ok: false, name: 'image.tiff', error: 'image.tiff is not a supported image: paste a PNG, JPEG, GIF or WebP' })
  })

  it('a TIFF file goes by its path like any other file', async () => {
    const path = join(project, 'scan.tiff')
    await writeFile(path, sized(TIFF, 32))
    expect(await attach({ kind: 'path', path }, target)).toMatchObject({ ok: true, attachment: { kind: 'file', path, copied: false } })
  })
})

describe('attach: files', () => {
  it('copies a file from outside the Project into the attachments folder; the Project stays untouched', async () => {
    git('init', '-q')
    await writeFile(join(project, 'README.md'), 'hi\n')
    git('add', '.')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
    const before = tree(project)
    const path = join(outside, 'notes.txt')
    await writeFile(path, 'notes')

    const result = await attach({ kind: 'path', path }, target)
    if (!result.ok || result.attachment.kind !== 'file') throw new Error(`not attached: ${JSON.stringify(result)}`)
    const copy = result.attachment.path
    expect(result.attachment).toMatchObject({ name: 'notes.txt', size: 5, copied: true })
    expect(copy.startsWith(target.attachmentsDir + sep)).toBe(true)
    expect(copy.endsWith(sep + 'notes.txt')).toBe(true)
    expect(await readFile(copy, 'utf8')).toBe('notes')
    expect(await readFile(path, 'utf8')).toBe('notes')
    expect(tree(project)).toEqual(before)
    expect(git('status', '--porcelain')).toBe('')
  })

  it('two files of one name get two copies', async () => {
    await mkdir(join(outside, 'b'))
    await writeFile(join(outside, 'x.txt'), 'one')
    await writeFile(join(outside, 'b', 'x.txt'), 'two')
    const first = await attach({ kind: 'path', path: join(outside, 'x.txt') }, target)
    const second = await attach({ kind: 'path', path: join(outside, 'b', 'x.txt') }, target)
    if (!first.ok || !second.ok || first.attachment.kind !== 'file' || second.attachment.kind !== 'file') throw new Error('not attached')
    expect(first.attachment.path).not.toBe(second.attachment.path)
    expect(await readFile(first.attachment.path, 'utf8')).toBe('one')
    expect(await readFile(second.attachment.path, 'utf8')).toBe('two')
  })

  it('a file in the Session cwd outside the Project root goes by its path', async () => {
    const worktree = join(scratch, 'worktree')
    await mkdir(worktree)
    await writeFile(join(worktree, 'a.ts'), 'x')
    expect(await attach({ kind: 'path', path: join(worktree, 'a.ts') }, { ...target, cwd: worktree })).toMatchObject({ ok: true, attachment: { copied: false } })
  })

  it('a link inside the Project to a file outside it is copied', async () => {
    await writeFile(join(outside, 'secret.txt'), 's')
    await symlink(join(outside, 'secret.txt'), join(project, 'link.txt'))
    expect(await attach({ kind: 'path', path: join(project, 'link.txt') }, target)).toMatchObject({ ok: true, attachment: { copied: true } })
  })

  it('without a Project, every file is copied', async () => {
    await writeFile(join(project, 'a.txt'), 'a')
    expect(await attach({ kind: 'path', path: join(project, 'a.txt') }, { ...target, projectRoot: null, cwd: outside })).toMatchObject({ ok: true, attachment: { copied: true } })
  })

  it('writes a dropped file into the attachments folder', async () => {
    const result = await attach({ kind: 'dropped', name: 'log.txt', data: Buffer.from('dropped').toString('base64') }, target)
    if (!result.ok || result.attachment.kind !== 'file') throw new Error('not attached')
    expect(result.attachment).toMatchObject({ name: 'log.txt', size: 7, copied: true })
    expect(result.attachment.path.startsWith(target.attachmentsDir + sep)).toBe(true)
    expect(await readFile(result.attachment.path, 'utf8')).toBe('dropped')
  })

  it('a dropped image becomes an image block, nothing is written', async () => {
    const bytes = sized(GIF, 16)
    expect(await attach({ kind: 'dropped', name: 'a.gif', data: bytes.toString('base64') }, target)).toMatchObject({ ok: true, attachment: { kind: 'image', mediaType: 'image/gif' } })
    expect(existsSync(target.attachmentsDir)).toBe(false)
  })

  it('a dropped name cannot leave the attachments folder', async () => {
    const result = await attach({ kind: 'dropped', name: '../../escape.txt', data: Buffer.from('x').toString('base64') }, target)
    if (!result.ok || result.attachment.kind !== 'file') throw new Error('not attached')
    expect(result.attachment.path.startsWith(target.attachmentsDir + sep)).toBe(true)
    expect(result.attachment.name).toBe('escape.txt')
    expect(existsSync(join(scratch, 'data', 'escape.txt'))).toBe(false)
  })

  it.each([
    ['a missing file', (dir: string) => join(dir, 'missing.txt'), 'missing.txt was not found'],
    ['a folder', (dir: string) => dir, 'outside is not a file'],
  ])('refuses %s', async (_label, pathOf, error) => {
    const result = await attach({ kind: 'path', path: pathOf(outside) }, target)
    expect(result).toMatchObject({ ok: false, error })
  })
})

describe('recheck: what the renderer hands back with a message', () => {
  const imageOf = (bytes: Buffer): Attachment => ({ kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 1, data: bytes.toString('base64') })

  it('takes an image whose bytes are of its type, with the size and name main sees', async () => {
    const bytes = sized(PNG, 40)
    expect(await recheck({ ...imageOf(bytes), name: '../../shot.png' }, target)).toStrictEqual({ kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 40, data: bytes.toString('base64') })
  })

  it.each([
    ['bytes that are no image', imageOf(Buffer.from('hello world'))],
    ['bytes of another image type', { ...imageOf(sized(JPEG, 40)), mediaType: 'image/png' as const }],
    ['data that is not the base64 main writes', { ...imageOf(sized(PNG, 40)), data: `${sized(PNG, 40).toString('base64')}A` }],
    ['an image over the limit', imageOf(sized(PNG, IMAGE_LIMIT_BYTES + 1))],
  ])('refuses an image with %s', async (_label, attachment) => {
    await expect(recheck(attachment, target)).rejects.toThrow(/shot\.png/)
  })

  it('takes a copy attach() made, and a file inside the Project, with the size on disk', async () => {
    const copied = await attach({ kind: 'dropped', name: 'notes.txt', data: Buffer.from('notes').toString('base64') }, target)
    if (!copied.ok) throw new Error(copied.error)
    expect(await recheck({ ...copied.attachment, size: 999 }, target)).toStrictEqual({ ...copied.attachment, size: 5 })
    await writeFile(join(project, 'a.ts'), 'abc')
    const inside: Attachment = { kind: 'file', name: 'a.ts', path: join(project, 'a.ts'), size: 1, copied: false }
    expect(await recheck(inside, target)).toStrictEqual({ ...inside, size: 3 })
  })

  it.each([
    ['a file outside the Project said to be inside it', false],
    ['a file outside the attachments folder said to be a copy', true],
  ])('refuses %s', async (_label, copied) => {
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await mkdir(target.attachmentsDir, { recursive: true })
    await expect(recheck({ kind: 'file', name: 'secret.txt', path: join(outside, 'secret.txt'), size: 6, copied }, target)).rejects.toThrow(/secret\.txt cannot be sent/)
  })

  it('refuses a file that is gone, and a folder', async () => {
    await expect(recheck({ kind: 'file', name: 'gone.txt', path: join(project, 'gone.txt'), size: 1, copied: false }, target)).rejects.toThrow(/was not found/)
    await mkdir(join(project, 'dir'))
    await expect(recheck({ kind: 'file', name: 'dir', path: join(project, 'dir'), size: 1, copied: false }, target)).rejects.toThrow(/is not a file/)
  })

  it('a link inside the Project to a file outside it is not inside the Project', async () => {
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(project, 'link.txt'))
    await expect(recheck({ kind: 'file', name: 'link.txt', path: join(project, 'link.txt'), size: 6, copied: false }, target)).rejects.toThrow(/outside the Project/)
  })
})

describe('the user message', () => {
  const image: Attachment = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 3, data: 'AAAA' }
  const file = (path: string): Attachment => ({ kind: 'file', name: path.split('/').at(-1) ?? path, path, size: 1, copied: false })

  it('is the text alone when nothing is attached', () => {
    expect(userContent('hello', [])).toBe('hello')
  })

  it('ends with the paths of the attached files', () => {
    expect(userContent('look', [file('/p/a.ts'), file('/d/b.log')])).toBe('look\n\nAttached files: /p/a.ts, /d/b.log')
    expect(userContent('', [file('/p/a.ts')])).toBe('Attached files: /p/a.ts')
  })

  it('carries images as image blocks before the text, and names them at its end', () => {
    expect(userContent('what is this?', [image, file('/p/a.ts')])).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'what is this?\n\nAttached files: /p/a.ts\n\nAttached images: shot.png' },
    ])
  })

  it('an image alone goes with the line that names it', () => {
    expect(userContent('  ', [image])).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'Attached images: shot.png' },
    ])
  })

  it('the text names the images, not their bytes', () => {
    expect(messageText('what is this?', [image, file('/p/a.ts')])).toBe('what is this?\n\nAttached files: /p/a.ts\n\nAttached images: shot.png')
    expect(messageText('what is this?', [image])).toBe('what is this?\n\nAttached images: shot.png')
    expect(messageText('what is this?', [image])).not.toContain('AAAA')
  })

  it('the typed text of a transcript line leaves out the lines naming the attachments', () => {
    expect(typedText(messageText('what is this?', [image, file('/p/a.ts')]))).toBe('what is this?')
    expect(typedText(messageText('', [image]))).toBe('')
    expect(typedText('one\n\ntwo')).toBe('one\n\ntwo')
    expect(typedText('Attached files: mine\n\nand more')).toBe('Attached files: mine\n\nand more')
  })
})

describe('the attachment lines read back (worfy-ui ticket 28)', () => {
  const image: Attachment = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 3, data: 'AAAA' }
  const file = (path: string): Attachment => ({ kind: 'file', name: path.split('/').at(-1) ?? path, path, size: 1, copied: false })

  it('splits what messageText wrote into the typed text, the paths and the image names', () => {
    expect(attachmentLines(messageText('look\n\nhere', [image, file('/p/a.ts'), file('/d/b c.log'), { ...image, name: 'two.gif' }]))).toEqual({
      typed: 'look\n\nhere',
      files: ['/p/a.ts', '/d/b c.log'],
      images: ['shot.png', 'two.gif'],
    })
    expect(attachmentLines(messageText('', [file('/p/a.ts')]))).toEqual({ typed: '', files: ['/p/a.ts'], images: [] })
    expect(attachmentLines('plain')).toEqual({ typed: 'plain', files: [], images: [] })
  })

  it('takes the lines only at the end and in the order messageText writes them', () => {
    // Images before files is not what messageText writes: the files line stays text.
    expect(attachmentLines('x\n\nAttached images: a.png\n\nAttached files: /p/a')).toEqual({ typed: 'x\n\nAttached images: a.png', files: ['/p/a'], images: [] })
    expect(attachmentLines('Attached files: /p/a\n\nmy own words')).toEqual({ typed: 'Attached files: /p/a\n\nmy own words', files: [], images: [] })
    // A line with nothing after its colon is the user's own.
    expect(attachmentLines('x\n\nAttached files: ')).toEqual({ typed: 'x\n\nAttached files: ', files: [], images: [] })
    expect(attachmentLines('x\n\nAttached images: ')).toEqual({ typed: 'x\n\nAttached images: ', files: [], images: [] })
  })

  it('names a file by the last segment of its path, on either platform, with its extension', () => {
    expect(baseName('/Users/a/report.final.PDF')).toBe('report.final.PDF')
    expect(baseName('C:\\Users\\a\\notes.md')).toBe('notes.md')
    expect(fileExtension('report.final.PDF')).toBe('pdf')
    expect(fileExtension('Makefile')).toBe('')
    expect(fileExtension('.env')).toBe('')
    expect(fileExtension('trailing.')).toBe('')
    expect(shownFile('a.ts', 3)).toEqual({ kind: 'file', name: 'a.ts', ext: 'ts', size: 3 })
    expect(shownFile('a.ts')).toEqual({ kind: 'file', name: 'a.ts', ext: 'ts' })
  })
})
