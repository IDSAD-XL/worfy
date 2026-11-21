// The syntax colours of the diff (worfy-changes-view ticket 10, ADR-0113): the tokens of a hunk with the colours of the
// GitHub themes, light and dark at once, read by Shiki with its JavaScript regular-expression engine (no WebAssembly:
// the renderer's Content-Security-Policy has no 'wasm-unsafe-eval'). One highlighter for the window; Shiki, its themes
// and each grammar come with `import()` on the first hunk that needs them, so the window starts without any of them.
//
// Each side of a hunk is read on its own — the old side (context and deleted lines), the new side (context and added
// lines) — so a comment or a string of several lines inside a hunk is coloured on every one of its lines. A hunk that
// starts inside such a comment is read as if it did not: the cost of not reading the whole file.
//
// A side is read in steps of about CHUNK_CHARS characters, each in a task of its own, the state of the grammar carried
// from one step to the next: no hunk holds the window up for longer than one step (ADR-0113, point 6).
//
// Plain text, as before the colours: a file of no known language, a line longer than MAX_LINE_LENGTH, a side of more
// than MAX_SIDE_CHARS characters, a hunk of more than MAX_HUNK_LINES lines, a grammar that failed to load, and a line
// whose tokens would not spell its text. The text of the tokens of a line is always the line's own text: the colours
// change nothing that is copied, quoted or sent.
import type { GrammarState, HighlighterCore, LanguageRegistration } from '@shikijs/core'
import type { DiffHunk } from '../../shared/changes/types'

/**
 * A line longer than this many characters is plain text and is never handed to Shiki: the time of a line grows faster
 * than its length (a string literal of 800 characters took 240 ms, one of 400 took 10 ms; ADR-0113).
 */
export const MAX_LINE_LENGTH = 400
/** A hunk of more lines than this is plain text. */
export const MAX_HUNK_LINES = 2000
/** A side of a hunk (its old or its new lines) of more characters than this is plain text: the total work of a hunk. */
export const MAX_SIDE_CHARS = 100_000
/** One step of the read of a side: whole lines, about this many characters (a step of 2 000 characters took ≈ 35 ms). */
export const CHUNK_CHARS = 2_000
/** The cache of tokens holds hunks of at most this many characters in all. */
export const CACHE_CHARS = 1_000_000

/** A piece of a line in one colour: its text and its colour in the light and in the dark theme. */
export interface Token {
  text: string
  light: string | null
  dark: string | null
  bold: boolean
  italic: boolean
}

/** The tokens of one line of a side. */
export type LineTokens = readonly Token[]

/**
 * The tokens of a hunk, by the index of a line in `hunk.lines`, for each side: null where the line is not on that side
 * (an added line on the old side, a deleted one on the new) or is plain text.
 */
export interface HunkTokens {
  old: readonly (LineTokens | null)[]
  new: readonly (LineTokens | null)[]
}

type Grammar = () => Promise<{ default: LanguageRegistration[] }>

// The grammars a diff may need, each its own chunk of the build: a static map, so the bundler sees every `import()`.
const GRAMMARS = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  dart: () => import('@shikijs/langs/dart'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  less: () => import('@shikijs/langs/less'),
  lua: () => import('@shikijs/langs/lua'),
  make: () => import('@shikijs/langs/make'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  svelte: () => import('@shikijs/langs/svelte'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
} satisfies Record<string, Grammar>

/** A language the diff colours. */
export type Language = keyof typeof GRAMMARS

const BY_EXTENSION: Readonly<Record<string, Language>> = {
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dart: 'dart',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  graphql: 'graphql',
  gql: 'graphql',
  html: 'html',
  htm: 'html',
  ini: 'ini',
  cfg: 'ini',
  java: 'java',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  mk: 'make',
  md: 'markdown',
  markdown: 'markdown',
  php: 'php',
  ps1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  toml: 'toml',
  tsx: 'tsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  vue: 'vue',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
}

const BY_NAME: Readonly<Record<string, Language>> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'make',
  gnumakefile: 'make',
  gemfile: 'ruby',
  rakefile: 'ruby',
  '.bashrc': 'shellscript',
  '.bash_profile': 'shellscript',
  '.profile': 'shellscript',
  '.zshrc': 'shellscript',
  '.zprofile': 'shellscript',
  '.zshenv': 'shellscript',
  '.editorconfig': 'ini',
  '.gitconfig': 'ini',
  '.npmrc': 'ini',
}

const own = <T>(map: Readonly<Record<string, T>>, key: string): T | null => (Object.hasOwn(map, key) ? map[key]! : null)

/** The language of a file by its name (Dockerfile, Makefile, .zshrc) or its extension; null — plain text. */
export function languageOf(path: string): Language | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const named = own(BY_NAME, name)
  if (named !== null) return named
  if (name.startsWith('dockerfile.')) return 'dockerfile'
  const dot = name.lastIndexOf('.')
  // A dotfile of no known name (.env, .gitignore) has no extension.
  if (dot <= 0) return null
  return own(BY_EXTENSION, name.slice(dot + 1))
}

const THEMES = { light: 'github-light-default', dark: 'github-dark-default' } as const

let highlighter: Promise<HighlighterCore> | null = null
const grammars = new Map<Language, Promise<boolean>>()

/** The one highlighter of the window, made on the first hunk that needs it; Shiki and both themes come with it. */
function theHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import('@shikijs/core'), import('@shikijs/engine-javascript')])
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-light-default'), import('@shikijs/themes/github-dark-default')],
      langs: [],
      // Forgiving: a pattern of a grammar the engine cannot translate matches nothing instead of failing the grammar.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  })()
  return highlighter
}

/** The highlighter with the language's grammar loaded, or null when Shiki or the grammar failed to load (said once). */
async function withGrammar(language: Language): Promise<HighlighterCore | null> {
  let loaded = grammars.get(language)
  if (loaded === undefined) {
    loaded = theHighlighter()
      .then((core) => core.loadLanguage(GRAMMARS[language]()))
      .then(
        () => true,
        (error: unknown) => {
          console.error(`[changes] the grammar of ${language} did not load; its files stay plain text`, error)
          return false
        },
      )
    grammars.set(language, loaded)
  }
  return (await loaded) ? theHighlighter() : null
}

type ShikiToken = { content: string; htmlStyle?: Record<string, string> }

function tokenOf(token: ShikiToken): Token {
  const style = token.htmlStyle ?? {}
  return {
    text: token.content,
    light: style['--shiki-light'] ?? null,
    dark: style['--shiki-dark'] ?? null,
    bold: style['--shiki-light-font-weight'] === 'bold',
    italic: style['--shiki-light-font-style'] === 'italic',
  }
}

/** A task of the event loop of its own: what the window has to do (a scroll, a key) goes first. */
const nextTask = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

/** Whether the read is still wanted: false once its request is cancelled. */
type Alive = () => boolean

/**
 * The tokens of the lines of one side, read in steps of about CHUNK_CHARS characters, a task each, the state of the
 * grammar carried across; a long line is read as empty and stays plain. Null when the read was cancelled.
 */
async function sideTokens(core: HighlighterCore, language: Language, texts: readonly string[], alive: Alive): Promise<(LineTokens | null)[] | null> {
  const parsed = texts.map((text) => (text.length > MAX_LINE_LENGTH ? '' : text))
  const shiki: ShikiToken[][] = []
  let state: GrammarState | undefined
  for (let start = 0; start < parsed.length; ) {
    let end = start + 1
    let size = parsed[start]!.length
    while (end < parsed.length && size + parsed[end]!.length + 1 <= CHUNK_CHARS) size += parsed[end++]!.length + 1
    if (start > 0) {
      await nextTask()
      if (!alive()) return null
    }
    const step = core.codeToTokens(parsed.slice(start, end).join('\n'), { lang: language, themes: THEMES, defaultColor: false, grammarState: state })
    for (let index = 0; index < end - start; index += 1) shiki.push(step.tokens[index] ?? [])
    state = step.grammarState
    start = end
  }
  return texts.map((text, index) => {
    if (text.length > MAX_LINE_LENGTH) return null
    const line = shiki[index]!.map(tokenOf)
    // Tokens that would not spell the line's text are not drawn: the text is what the user copies and quotes.
    return line.map((token) => token.text).join('') === text ? line : null
  })
}

/** The indexes in `hunk.lines` of the lines of a side: the old side has no added line, the new side no deleted one. */
const sideOf = (hunk: DiffHunk, side: 'old' | 'new'): number[] => hunk.lines.flatMap((line, index) => (line.kind === (side === 'old' ? 'add' : 'del') ? [] : [index]))

/** Whether a side of the hunk has more characters than MAX_SIDE_CHARS. */
const tooBig = (hunk: DiffHunk): boolean =>
  (['old', 'new'] as const).some((side) => {
    let size = 0
    for (const index of sideOf(hunk, side)) size += hunk.lines[index]!.text.length
    return size > MAX_SIDE_CHARS
  })

async function tokenize(core: HighlighterCore, language: Language, hunk: DiffHunk, alive: Alive): Promise<HunkTokens | null> {
  const result: { old: (LineTokens | null)[]; new: (LineTokens | null)[] } = { old: hunk.lines.map(() => null), new: hunk.lines.map(() => null) }
  for (const side of ['old', 'new'] as const) {
    const at = sideOf(hunk, side)
    if (at.length === 0) continue
    const tokens = await sideTokens(
      core,
      language,
      at.map((index) => hunk.lines[index]!.text),
      alive,
    )
    if (tokens === null) return null
    at.forEach((index, position) => {
      result[side][index] = tokens[position] ?? null
    })
  }
  return result
}

// The tokens of hunks read, by language and the hunk's lines: a hunk drawn again (scrolled back to, read again by
// Refresh) is answered at once. The oldest go first while the hunks kept have more than CACHE_CHARS characters.
const cache = new Map<string, { tokens: HunkTokens | null; chars: number }>()
let held = 0

const cacheKey = (language: Language, hunk: DiffHunk): string => `${language}\u0000${hunk.lines.map((line) => `${line.kind[0]}${line.text}`).join('\n')}`

function remember(key: string, hunk: DiffHunk, tokens: HunkTokens | null): void {
  const chars = hunk.lines.reduce((sum, line) => sum + line.text.length, 0)
  const before = cache.get(key)
  if (before !== undefined) held -= before.chars
  cache.delete(key)
  cache.set(key, { tokens, chars })
  held += chars
  while (held > CACHE_CHARS && cache.size > 0) {
    const [oldest, entry] = cache.entries().next().value!
    cache.delete(oldest)
    held -= entry.chars
  }
}

/** The characters of the hunks the cache holds now (for tests). */
export const cachedCharacters = (): number => held

/** The tokens of a hunk if known now: null — plain text (no language, too big); undefined — not read yet. */
export function peekHunkTokens(path: string, hunk: DiffHunk): HunkTokens | null | undefined {
  const language = languageOf(path)
  if (language === null || hunk.lines.length > MAX_HUNK_LINES || tooBig(hunk)) return null
  return cache.get(cacheKey(language, hunk))?.tokens
}

/** What a read gives: the tokens, null for plain text, or `cancelled` when its request was cancelled before the end. */
type Read = HunkTokens | null | 'cancelled'

async function readHunk(path: string, hunk: DiffHunk, alive: Alive): Promise<Read> {
  const known = peekHunkTokens(path, hunk)
  if (known !== undefined) return known
  const language = languageOf(path)!
  const core = await withGrammar(language)
  const key = cacheKey(language, hunk)
  // Another request may have read the same hunk while the grammar loaded.
  const cached = cache.get(key)
  if (cached !== undefined) return cached.tokens
  if (!alive()) return 'cancelled'
  let tokens: HunkTokens | null = null
  if (core !== null) {
    try {
      tokens = await tokenize(core, language, hunk, alive)
      // A read stopped by its cancel keeps nothing: the hunk is read whole when it is drawn again.
      if (tokens === null && !alive()) return 'cancelled'
    } catch (error) {
      console.error(`[changes] the ${language} hunk of ${path} could not be coloured; it stays plain text`, error)
    }
  }
  remember(key, hunk, tokens)
  return tokens
}

/** The tokens of a hunk of the file at `path`; null — the hunk stays plain text. */
export async function highlightHunk(path: string, hunk: DiffHunk): Promise<HunkTokens | null> {
  const read = await readHunk(path, hunk, () => true)
  return read === 'cancelled' ? null : read
}

interface Job {
  path: string
  hunk: DiffHunk
  done: (tokens: HunkTokens | null) => void
  cancelled: boolean
}

// The hunks asked for, read one per task of the event loop: a screen of new hunks never holds a scroll or a key up for
// longer than one hunk takes.
const queue: Job[] = []
let running = false

function next(): void {
  const job = queue.shift()
  if (job === undefined) {
    running = false
    return
  }
  if (job.cancelled) {
    next()
    return
  }
  void readHunk(job.path, job.hunk, () => !job.cancelled).then((read) => {
    if (read !== 'cancelled' && !job.cancelled) job.done(read)
    setTimeout(next, 0)
  })
}

/**
 * Asks for the tokens of a hunk; `done` gets them in a task of its own, after the hunks asked for before it. The
 * function returned cancels the request: a hunk the window no longer draws is not read.
 */
export function requestHunkTokens(path: string, hunk: DiffHunk, done: (tokens: HunkTokens | null) => void): () => void {
  const job: Job = { path, hunk, done, cancelled: false }
  queue.push(job)
  if (!running) {
    running = true
    setTimeout(next, 0)
  }
  return () => {
    job.cancelled = true
  }
}
