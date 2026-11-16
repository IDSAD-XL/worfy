// How the read guard of a single request (src/main/vendors/claude/read-guard.ts) compares paths, on the
// rules of either system whatever machine runs the test: the file system is stood in by a realpath that
// knows a few links, so the Windows rules (case, drive letters, `\\?\`, `/`) are checked on a Mac too.
// The guard against a real file system, links included, is test/contract/one-shot-read-guard.test.ts.
import { describe, expect, it } from 'vitest'
import { readScope } from '../../src/main/vendors/claude/read-guard'

/** A file system where every path exists and `links` maps a path to its target. */
const linking =
  (links: Record<string, string> = {}) =>
  (path: string): string =>
    links[path] ?? path

describe('readScope on Windows', () => {
  const scope = readScope('C:\\Data\\worfy\\terminal-ai', ['C:\\Repos\\Shop'], { platform: 'win32', realpath: linking(), home: 'C:\\Profile' })
  const read = (file_path: string): string | null => scope.check('Read', { file_path })

  it('ignores case and accepts / as a separator', () => {
    expect(read('c:\\repos\\shop\\src\\cart.ts')).toBeNull()
    expect(read('C:/Repos/Shop/src/cart.ts')).toBeNull()
    expect(read('C:\\REPOS\\SHOP')).toBeNull()
  })

  it('reads through the \\\\?\\ prefix', () => {
    expect(read('\\\\?\\C:\\Repos\\Shop\\src\\cart.ts')).toBeNull()
    expect(read('\\\\?\\C:\\Profile\\.ssh\\id_ed25519')).not.toBeNull()
  })

  it('compares on a separator boundary and across drives', () => {
    expect(read('C:\\Repos\\Shop-other\\a.ts')).not.toBeNull()
    expect(read('D:\\Repos\\Shop\\a.ts')).not.toBeNull()
    expect(read('C:\\Repos\\Shop\\..\\Other\\a.ts')).not.toBeNull()
  })

  it('refuses a drive-relative path and resolves ~ and a relative path', () => {
    expect(read('C:secret.txt')).not.toBeNull()
    expect(read('~\\.ssh\\id_ed25519')).not.toBeNull()
    expect(read('..\\..\\..\\Repos\\Shop\\a.ts')).toBeNull()
    expect(read('notes.txt')).toBeNull()
  })

  it('checks the part of a Glob pattern before its first wildcard', () => {
    expect(scope.check('Glob', { pattern: 'C:\\Profile\\**\\*' })).not.toBeNull()
    expect(scope.check('Glob', { pattern: 'c:/repos/shop/**/*.ts' })).toBeNull()
    expect(scope.check('Glob', { pattern: '..\\..\\**', path: 'C:\\Repos\\Shop' })).not.toBeNull()
  })
})

describe('readScope on a POSIX system', () => {
  const links = { '/repo/linked': '/etc', '/data/run': '/private/data/run' }
  const scope = readScope('/data/run', ['/repo'], { platform: 'darwin', realpath: linking(links), home: '/profile' })

  it('allows the cwd and the folders by the names the file system gives them', () => {
    expect(scope.check('Read', { file_path: '/private/data/run/x.txt' })).toBeNull()
    expect(scope.check('Read', { file_path: '/repo/src/a.ts' })).toBeNull()
  })

  it('refuses a sibling folder with the same beginning, a link out and a climb out', () => {
    expect(scope.check('Read', { file_path: '/repo-other/a.ts' })).not.toBeNull()
    expect(scope.check('Read', { file_path: '/repo/linked/passwd' })).not.toBeNull()
    expect(scope.check('Read', { file_path: '/repo/../etc/passwd' })).not.toBeNull()
  })

  it('refuses a path that is not text, and leaves tools it does not guard to the name check', () => {
    expect(scope.check('Read', { file_path: 42 })).not.toBeNull()
    expect(scope.check('StructuredOutput', { file_path: '/etc/passwd' })).toBeNull()
  })

  it('names the folders in its refusal', () => {
    expect(scope.check('Grep', { pattern: 'x', path: '/etc' })).toBe('/etc is outside the folders this request may read: /data/run, /repo. Read only files under them.')
  })
})
