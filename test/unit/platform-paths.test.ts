// An absolute path as worfy accepts it on any platform (worfy-windows ticket 08): POSIX `/…`,
// Windows `C:\…` or `C:/…` and UNC `\\server\share\…`. Shared by main and renderer, so no node:path.
import { describe, expect, it } from 'vitest'
import { absolutePathSchema, isAbsolutePath, isWindowsAbsolutePath, sameProjectRoot } from '../../src/shared/paths'

const ABSOLUTE = ['/a', '/', 'C:\\a', 'C:/a', 'c:\\a', 'C:\\', 'Z:/x y/з', '\\\\server\\share\\a', '\\\\server\\share', '//server/share/a']
const NOT_ABSOLUTE = ['a/b', 'a\\b', 'C:a', 'C:', '', '\\a', '\\\\server', '\\\\', 'CC:\\a', '1:\\a', '.\\a', '..\\a', '~/a']

describe('isAbsolutePath', () => {
  it.each(ABSOLUTE)('%s is absolute', (path) => {
    expect(isAbsolutePath(path)).toBe(true)
  })

  it.each(NOT_ABSOLUTE)('%s is not absolute', (path) => {
    expect(isAbsolutePath(path)).toBe(false)
  })

  it('refuses a path with a NUL', () => {
    expect(isAbsolutePath('/a\0b')).toBe(false)
    expect(isAbsolutePath('C:\\a\0')).toBe(false)
  })
})

describe('isWindowsAbsolutePath', () => {
  it('takes a drive root or UNC, and not a POSIX root, a drive-relative or a current-drive root path', () => {
    for (const path of ['C:\\a', 'C:/a', 'c:\\', '\\\\server\\share', '//server/share/a']) expect(isWindowsAbsolutePath(path), path).toBe(true)
    for (const path of ['/a', '\\a', 'C:a', 'a\\b', '', '\\\\server', 'C:\\a\0']) expect(isWindowsAbsolutePath(path), path).toBe(false)
  })
})

describe('absolutePathSchema', () => {
  it('accepts and refuses the same paths', () => {
    for (const path of ABSOLUTE) expect(absolutePathSchema.safeParse(path).success).toBe(true)
    for (const path of [...NOT_ABSOLUTE, '/a\0b']) expect(absolutePathSchema.safeParse(path).success).toBe(false)
    expect(absolutePathSchema.safeParse(42).success).toBe(false)
  })
})

// worfy-windows ticket 49: on Windows the Project list keeps git's `C:/…` and a note from the
// registry under ~/.claude carries path.resolve's `C:\…`; both name one Project root.
describe('sameProjectRoot', () => {
  const SAME: [string, string][] = [
    ['C:/a/b', 'C:\\a\\b'],
    ['c:/a', 'C:/a'],
    ['C:/a/', 'C:/a'],
    ['C:\\a\\', 'C:/a'],
    ['C:/Users/Alexey/worfy', 'c:\\Users\\Alexey\\worfy\\'],
    ['C:/', 'C:\\'],
    ['\\\\server\\share\\a', '//server/share/a'],
    ['/a/b', '/a/b'],
  ]
  const DIFFERENT: [string, string][] = [
    ['/a/b', '/a/B'],
    ['C:/a/b', 'C:/a/bc'],
    ['C:/a/b', 'C:/a/B'],
    ['C:/a', 'D:/a'],
    ['C:/a', 'C:/'],
    // POSIX paths are compared as they are: `\` is a character of a file name there.
    ['/a/b', '/a\\b'],
    ['/a/b/', '/a/b'],
    ['/C:/a', 'C:/a'],
    ['a/b', 'a\\b'],
  ]

  it.each(SAME)('%s and %s are one root', (a, b) => {
    expect(sameProjectRoot(a, b)).toBe(true)
    expect(sameProjectRoot(b, a)).toBe(true)
  })

  it.each(DIFFERENT)('%s and %s are different roots', (a, b) => {
    expect(sameProjectRoot(a, b)).toBe(false)
    expect(sameProjectRoot(b, a)).toBe(false)
  })
})
