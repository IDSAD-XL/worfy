// The syntax colours of the diff (worfy-changes-view ticket 10, ADR-0113; src/renderer/changes/highlight.ts): the
// language of a file by its extension or its name, the tokens of a hunk with the colours of both GitHub themes, each
// side of a hunk read on its own (so a comment of several lines is coloured on every line), and plain text where the
// file's language is unknown, a line is too long or a hunk too big. The text of the tokens of a line is always the
// line's text: the colours never change what is copied, quoted or sent. A side is read in steps of CHUNK_CHARS, one
// task each, so no hunk holds the window up; a side of more than MAX_SIDE_CHARS characters is plain text, and the cache
// holds at most CACHE_CHARS characters of hunks (round 2 of the review).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CACHE_CHARS, CHUNK_CHARS, MAX_HUNK_LINES, MAX_LINE_LENGTH, MAX_SIDE_CHARS, cachedCharacters, highlightHunk, languageOf, peekHunkTokens, requestHunkTokens, type HunkTokens, type LineTokens } from '../../src/renderer/changes/highlight'
import type { DiffHunk, DiffLine } from '../../src/shared/changes/types'
import { ms } from '../time-scale'

// Every text highlight.ts hands to Shiki, as Shiki gets it; `onParse` runs before each parse.
const shiki = vi.hoisted(() => ({ parsed: [] as string[], onParse: null as ((code: string) => void) | null }))
vi.mock('@shikijs/core', async (original) => {
  const real = await original<typeof import('@shikijs/core')>()
  return {
    ...real,
    createHighlighterCore: async (...args: Parameters<typeof real.createHighlighterCore>) => {
      const core = await real.createHighlighterCore(...args)
      const codeToTokens = core.codeToTokens.bind(core)
      core.codeToTokens = ((code: string, options: Parameters<typeof codeToTokens>[1]) => {
        shiki.parsed.push(code)
        shiki.onParse?.(code)
        return codeToTokens(code, options)
      }) as typeof core.codeToTokens
      return core
    },
  }
})

afterEach(() => {
  shiki.parsed = []
  shiki.onParse = null
})

/** A long hunk takes several seconds to colour on a loaded machine. */
const LONG = ms(60_000)

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

  it('a line longer than the limit is never handed to Shiki', async () => {
    const long = `const never = '${'y'.repeat(MAX_LINE_LENGTH)}'`
    await highlightHunk('src/never.ts', hunkOf([line('add', 'const before = 1', null, 1), line('add', long, null, 2)]))
    expect(shiki.parsed.length).toBeGreaterThan(0)
    expect(shiki.parsed.some((code) => code.includes('never'))).toBe(false)
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

describe('the cost of a hunk', () => {
  /** `count` added lines of `width` characters each, of valid TypeScript. */
  const added = (count: number, width: number, tag = 'v') =>
    Array.from({ length: count }, (_, index) => {
      const head = `const ${tag}${index} = '`
      return line('add', `${head}${'z'.repeat(Math.max(0, width - head.length - 1))}'`, null, index + 1)
    })

  it('a side of more characters than the limit is plain text, even within the limits of a line and of a hunk', async () => {
    const hunk = hunkOf(added(MAX_HUNK_LINES - 1, MAX_LINE_LENGTH - 1))
    expect(peekHunkTokens('src/wide.ts', hunk)).toBeNull()
    expect(await highlightHunk('src/wide.ts', hunk)).toBeNull()
    expect(shiki.parsed).toEqual([])
  })

  it(
    'a side just under the limit is coloured to its last line, read in steps of at most CHUNK_CHARS characters',
    async () => {
      const width = 80
      const lines = added(Math.floor(MAX_SIDE_CHARS / width), width, 'w')
      expect(lines.reduce((sum, each) => sum + each.text.length, 0)).toBeLessThanOrEqual(MAX_SIDE_CHARS)
      const tokens = (await highlightHunk('src/under.ts', hunkOf(lines)))!
      expect(tokens).not.toBeNull()
      const last = tokens.new[lines.length - 1]!
      expect(last.find((token) => token.text === 'const')?.light).toBe('#CF222E')
      expect(shiki.parsed.length).toBeGreaterThan(1)
      expect(Math.max(...shiki.parsed.map((code) => code.length))).toBeLessThanOrEqual(CHUNK_CHARS + width)
    },
    LONG,
  )

  it('a comment that crosses the border of two steps is coloured as a comment past it', async () => {
    const inside = Array.from({ length: Math.ceil((CHUNK_CHARS * 2) / 40) }, (_, index) => line('add', ` * line ${index} of the comment, const not a keyword`, null, index + 2))
    const lines = [line('add', '/**', null, 1), ...inside, line('add', ' */', null, inside.length + 2), line('add', 'const after = 1', null, inside.length + 3)]
    const tokens = (await highlightHunk('src/border.ts', hunkOf(lines)))!
    expect(shiki.parsed.length).toBeGreaterThan(1)
    const comment = tokens.new[0]![0]!.light
    expect(tokens.new[inside.length]!.every((token) => token.light === comment)).toBe(true)
    expect(tokens.new[lines.length - 1]!.find((token) => token.text === 'const')?.light).toBe('#CF222E')
  })

  it('the window gets a task between two steps of a hunk: a timer set in the first step runs before the second', async () => {
    const hunk = hunkOf(added(Math.ceil((CHUNK_CHARS * 3) / 60), 60, 't'))
    let stepsWhenTheTimerRan: number | null = null
    let steps = 0
    shiki.onParse = (code) => {
      if (!code.includes('const t')) return
      steps += 1
      if (steps === 1) setTimeout(() => (stepsWhenTheTimerRan = steps), 0)
    }
    await highlightHunk('src/tasks.ts', hunk)
    expect(steps).toBeGreaterThan(1)
    expect(stepsWhenTheTimerRan).toBe(1)
  })

  it('a request cancelled while its hunk is read stops at the next step and keeps nothing', async () => {
    const hunk = hunkOf(added(Math.ceil((CHUNK_CHARS * 4) / 60), 60, 'c'))
    let cancel: () => void = () => undefined
    let steps = 0
    shiki.onParse = (code) => {
      if (!code.includes('const c0 ')) return
      steps += 1
      cancel()
    }
    const answered: unknown[] = []
    cancel = requestHunkTokens('src/cancelled.ts', hunk, (tokens) => answered.push(tokens))
    await vi.waitFor(() => expect(steps).toBe(1), { timeout: LONG })
    // The next request runs only after the cancelled one stopped.
    await new Promise<void>((done) => requestHunkTokens('src/after.ts', hunkOf([line('add', 'const after = 1', null, 1)]), () => done()))
    expect(steps).toBe(1)
    expect(shiki.parsed.filter((code) => code.includes('const c')).length).toBe(1)
    expect(answered).toEqual([])
    expect(peekHunkTokens('src/cancelled.ts', hunk)).toBeUndefined()
  })

  it(
    'the cache holds at most CACHE_CHARS characters of hunks: the oldest go first',
    async () => {
      // Diff files: the cheapest grammar to read, so the cache fills fast.
      const big = (index: number) => hunkOf(Array.from({ length: 1_000 }, (_, at) => line('add', `#${index} ${at} ${'q'.repeat(80)}`, null, at + 1)))
      const first = big(0)
      await highlightHunk('notes/0.diff', first)
      for (let index = 1; index * 85_000 <= CACHE_CHARS + 200_000; index += 1) {
        await highlightHunk(`notes/${index}.diff`, big(index))
        expect(cachedCharacters()).toBeLessThanOrEqual(CACHE_CHARS)
      }
      expect(peekHunkTokens('notes/0.diff', first)).toBeUndefined()
      expect(cachedCharacters()).toBeGreaterThan(CACHE_CHARS / 2)
    },
    LONG,
  )
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
    // Not read at all: its tokens are not in the cache.
    expect(peekHunkTokens('src/k.ts', dropped)).toBeUndefined()
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
