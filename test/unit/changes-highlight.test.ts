// The syntax colours of the diff (worfy-changes-view ticket 10, ADR-0113; src/renderer/changes/highlight.ts): the
// language of a file by its extension or its name, the tokens of a hunk with the colours of both GitHub themes, each
// side of a hunk read on its own (so a comment of several lines is coloured on every line), and plain text where the
// file's language is unknown, a line is too long or a hunk too big. The text of the tokens of a line is always the
// line's text: the colours never change what is copied, quoted or sent.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_HUNK_LINES, MAX_LINE_LENGTH, highlightHunk, languageOf, peekHunkTokens, requestHunkTokens, type HunkTokens, type LineTokens } from '../../src/renderer/changes/highlight'
import type { DiffHunk, DiffLine } from '../../src/shared/changes/types'

const line = (kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine => ({ kind, text, oldLine, newLine, crlf: false, noNewline: false })

function hunkOf(lines: DiffLine[]): DiffHunk {
  return { header: '@@ -1 +1 @@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, section: '', lines }
}

const textOf = (tokens: LineTokens | null | undefined): string | null => (tokens == null ? null : tokens.map((token) => token.text).join(''))

/** The token whose text is `text` on line `index` of a side. */
function tokenOf(tokens: HunkTokens, side: 'old' | 'new', index: number, text: string) {
  return tokens[side][index]?.find((token) => token.text === text)
}

describe('languageOf', () => {
  it('by the extension, in any case of letters, and by the name of a file without one', () => {
    expect(languageOf('src/renderer/changes/DiffPane.tsx')).toBe('tsx')
    expect(languageOf('src/main/index.ts')).toBe('typescript')
    expect(languageOf('scripts/check.mjs')).toBe('javascript')
    expect(languageOf('package.json')).toBe('json')
    expect(languageOf('docs/features/changes.md')).toBe('markdown')
    expect(languageOf('README.MD')).toBe('markdown')
    expect(languageOf('tools/build.py')).toBe('python')
    expect(languageOf('.github/workflows/ci.yml')).toBe('yaml')
    expect(languageOf('docker/Dockerfile')).toBe('dockerfile')
    expect(languageOf('Makefile')).toBe('make')
    expect(languageOf('home/.zshrc')).toBe('shellscript')
  })

  it('an unknown extension, a dotfile of no known name and a file of no extension: no language', () => {
    expect(languageOf('assets/model.xyz')).toBeNull()
    expect(languageOf('.env')).toBeNull()
    expect(languageOf('LICENSE')).toBeNull()
    // A name of the language map is not a key of an object's own: «constructor» is no extension.
    expect(languageOf('weird.constructor')).toBeNull()
  })
})

describe('highlightHunk', () => {
  it('a line of TypeScript: the keyword has the colours of both GitHub themes, and the text of the tokens is the line', async () => {
    const hunk = hunkOf([line('add', 'const total = sum(items)', null, 1)])
    const tokens = await highlightHunk('src/cart.ts', hunk)
    expect(tokens).not.toBeNull()
    expect(textOf(tokens!.new[0])).toBe('const total = sum(items)')
    const keyword = tokenOf(tokens!, 'new', 0, 'const')
    // github-light-default and github-dark-default: the keyword red of github.com.
    expect(keyword?.light).toBe('#CF222E')
    expect(keyword?.dark).toBe('#FF7B72')
    // A plain name is not a keyword: another colour.
    const name = tokens!.new[0]!.find((token) => token.text.includes('total'))
    expect(name?.light).not.toBe(keyword?.light)
  })

  it('an unknown language: no tokens, the hunk stays plain text', async () => {
    const hunk = hunkOf([line('add', 'const total = 1', null, 1)])
    expect(await highlightHunk('notes/total.xyz', hunk)).toBeNull()
  })

  it('a comment of several lines inside a hunk is coloured as a comment on each of its lines', async () => {
    const hunk = hunkOf([line('add', '/* the total', null, 1), line('add', '   const is not a keyword here', null, 2), line('add', '*/', null, 3), line('add', 'const x = 1', null, 4)])
    const tokens = (await highlightHunk('src/a.ts', hunk))!
    const comment = tokens.new[0]![0]!.light
    expect(tokens.new[1]!.every((token) => token.light === comment)).toBe(true)
    expect(tokens.new[2]!.every((token) => token.light === comment)).toBe(true)
    expect(tokenOf(tokens, 'new', 3, 'const')?.light).not.toBe(comment)
  })

  it('each side of a hunk is read on its own: a comment opened on the deleted side does not colour the added lines', async () => {
    // Read as one text, «/*» of the deleted line would make the added lines after it a comment.
    const hunk = hunkOf([line('del', 'let rate = 1 /* old', 1, null), line('add', 'const rate = 2', null, 1), line('context', 'export { rate }', 2, 2)])
    const tokens = (await highlightHunk('src/a.ts', hunk))!
    const comment = tokens.old[0]!.find((token) => token.text.includes('/*'))!.light
    expect(tokenOf(tokens, 'new', 1, 'const')?.light).not.toBe(comment)
    // The deleted line is on the old side only, the added one on the new side only; the context line on both.
    expect(tokens.new[0]).toBeNull()
    expect(tokens.old[1]).toBeNull()
    expect(textOf(tokens.old[2])).toBe('export { rate }')
    expect(textOf(tokens.new[2])).toBe('export { rate }')
    // On the old side the context line comes after the open comment: it is coloured as the comment goes on.
    expect(tokens.old[2]!.every((token) => token.light === comment)).toBe(true)
  })

  it('a line longer than the limit is plain text, and the lines after it are still coloured', async () => {
    const long = `const s = '${'x'.repeat(MAX_LINE_LENGTH)}'`
    const hunk = hunkOf([line('add', long, null, 1), line('add', 'const y = 2', null, 2)])
    const tokens = (await highlightHunk('src/a.ts', hunk))!
    expect(tokens.new[0]).toBeNull()
    expect(tokenOf(tokens, 'new', 1, 'const')?.light).toBe('#CF222E')
  })

  it('a hunk of more lines than the limit is plain text', async () => {
    const lines = Array.from({ length: MAX_HUNK_LINES + 1 }, (_, index) => line('add', `const v${index} = ${index}`, null, index + 1))
    expect(await highlightHunk('src/big.ts', hunkOf(lines))).toBeNull()
    expect(await highlightHunk('src/big.ts', hunkOf(lines.slice(0, MAX_HUNK_LINES)))).not.toBeNull()
  })

  it('the text of the tokens of every line is the line, tabs and spaces at its end too', async () => {
    const texts = ['\tif (a) {  ', '\t\treturn "a\\tb"', '\t}', '', '   ']
    const hunk = hunkOf(texts.map((text, index) => line('add', text, null, index + 1)))
    const tokens = (await highlightHunk('src/a.ts', hunk))!
    expect(tokens.new.map((each) => textOf(each) ?? '')).toEqual(texts)
  })

  it('JSON and Markdown are coloured too', async () => {
    const json = (await highlightHunk('package.json', hunkOf([line('add', '  "name": "worfy",', null, 1)])))!
    expect(new Set(json.new[0]!.map((token) => token.light)).size).toBeGreaterThan(1)
    const markdown = (await highlightHunk('docs/a.md', hunkOf([line('add', '# Changes', null, 1)])))!
    expect(markdown.new[0]!.some((token) => token.light !== null)).toBe(true)
  })

  it('a hunk asked for again is answered from the cache, at once, by its language and text', async () => {
    const hunk = hunkOf([line('add', 'const cached = true', null, 1)])
    expect(peekHunkTokens('src/c.ts', hunk)).toBeUndefined()
    const first = await highlightHunk('src/c.ts', hunk)
    expect(peekHunkTokens('src/c.ts', hunk)).toBe(first)
    // Another hunk object with the same lines, in another file of the language: the same tokens.
    expect(peekHunkTokens('src/d.mts', hunkOf([line('add', 'const cached = true', null, 1)]))).toBe(first)
    // An unknown language is known at once: plain text.
    expect(peekHunkTokens('a.xyz', hunk)).toBeNull()
  })
})

describe('requestHunkTokens', () => {
  it('answers a request; a request cancelled before its turn is never answered', async () => {
    const answered: string[] = []
    const kept = hunkOf([line('add', 'const kept = 1', null, 1)])
    const dropped = hunkOf([line('add', 'const dropped = 1', null, 1)])
    const done = new Promise<void>((resolve) => {
      requestHunkTokens('src/k.ts', kept, (tokens) => {
        answered.push(textOf(tokens?.new[0]) ?? 'plain')
        resolve()
      })
    })
    const cancel = requestHunkTokens('src/k.ts', dropped, () => answered.push('dropped'))
    cancel()
    await done
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(answered).toEqual(['const kept = 1'])
  })
})

describe('the window starts without Shiki', () => {
  it('highlight.ts imports Shiki only with import(): no grammar, theme or engine is in the start of the renderer', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/renderer/changes/highlight.ts'), 'utf8')
    const staticImports = source.split('\n').filter((each) => /^import\s(?!type\s).*@shikijs\//.test(each))
    expect(staticImports).toEqual([])
    expect(source).toMatch(/import\('@shikijs\/core'\)/)
  })
})
