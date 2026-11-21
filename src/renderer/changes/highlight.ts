// The syntax colours of the diff (worfy-changes-view ticket 10, ADR-0113): the tokens of a hunk with the colours of the
// GitHub themes, light and dark at once, read by Shiki with its JavaScript regular-expression engine (no WebAssembly:
// the renderer's Content-Security-Policy has no 'wasm-unsafe-eval'). One highlighter for the window; Shiki, its themes
// and each grammar come with `import()` on the first hunk that needs them, so the window starts without any of them.
//
// Each side of a hunk is read on its own — the old side (context and deleted lines), the new side (context and added
// lines) — so a comment or a string of several lines inside a hunk is coloured on every one of its lines. A hunk that
// starts inside such a comment is read as if it did not: the cost of not reading the whole file.
//
// Plain text, as before the colours: a file of no known language, a line longer than MAX_LINE_LENGTH, a hunk of more
// than MAX_HUNK_LINES lines, a grammar that failed to load, and a line whose tokens would not spell its text. The text
// of the tokens of a line is always the line's own text: the colours change nothing that is copied, quoted or sent.
import type { HighlighterCore, LanguageRegistration } from '@shikijs/core'
import type { DiffHunk } from '../../shared/changes/types'

/** A line longer than this many characters is plain text: a minified file would hold the window up. */
export const MAX_LINE_LENGTH = 1000
/** A hunk of more lines than this is plain text. */
export const MAX_HUNK_LINES = 2000

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

/** The tokens of the lines of one side, read as one text; a long line is read as empty and stays plain. */
function sideTokens(core: HighlighterCore, language: Language, texts: readonly string[]): (LineTokens | null)[] {
  const code = texts.map((text) => (text.length > MAX_LINE_LENGTH ? '' : text)).join('\n')
  const { tokens } = core.codeToTokens(code, { lang: language, themes: THEMES, defaultColor: false })
  return texts.map((text, index) => {
    if (text.length > MAX_LINE_LENGTH) return null
    const line = (tokens[index] ?? []).map(tokenOf)
    // Tokens that would not spell the line's text are not drawn: the text is what the user copies and quotes.
    return line.map((token) => token.text).join('') === text ? line : null
  })
}

function tokenize(core: HighlighterCore, language: Language, hunk: DiffHunk): HunkTokens {
  const result: { old: (LineTokens | null)[]; new: (LineTokens | null)[] } = { old: hunk.lines.map(() => null), new: hunk.lines.map(() => null) }
  for (const side of ['old', 'new'] as const) {
    const at = hunk.lines.flatMap((line, index) => (line.kind === (side === 'old' ? 'add' : 'del') ? [] : [index]))
    if (at.length === 0) continue
    const tokens = sideTokens(
      core,
      language,
      at.map((index) => hunk.lines[index]!.text),
    )
    at.forEach((index, position) => {
      result[side][index] = tokens[position] ?? null
    })
  }
  return result
}

// The tokens of hunks read, by language and the hunk's lines: a hunk drawn again (scrolled back to, read again by
// Refresh) is answered at once. The oldest go first past CACHE_SIZE.
const CACHE_SIZE = 600
const cache = new Map<string, HunkTokens | null>()

const cacheKey = (language: Language, hunk: DiffHunk): string => `${language}\u0000${hunk.lines.map((line) => `${line.kind[0]}${line.text}`).join('\n')}`

function remember(key: string, tokens: HunkTokens | null): void {
  cache.set(key, tokens)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
}

/** The tokens of a hunk if known now: null — plain text (no language, too big); undefined — not read yet. */
export function peekHunkTokens(path: string, hunk: DiffHunk): HunkTokens | null | undefined {
  const language = languageOf(path)
  if (language === null || hunk.lines.length > MAX_HUNK_LINES) return null
  return cache.get(cacheKey(language, hunk))
}

/** The tokens of a hunk of the file at `path`; null — the hunk stays plain text. */
export async function highlightHunk(path: string, hunk: DiffHunk): Promise<HunkTokens | null> {
  const known = peekHunkTokens(path, hunk)
  if (known !== undefined) return known
  const language = languageOf(path)!
  const core = await withGrammar(language)
  const key = cacheKey(language, hunk)
  // Another request may have read the same hunk while the grammar loaded.
  if (cache.has(key)) return cache.get(key)!
  let tokens: HunkTokens | null = null
  if (core !== null) {
    try {
      tokens = tokenize(core, language, hunk)
    } catch (error) {
      console.error(`[changes] the ${language} hunk of ${path} could not be coloured; it stays plain text`, error)
    }
  }
  remember(key, tokens)
  return tokens
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
  void highlightHunk(job.path, job.hunk).then((tokens) => {
    if (!job.cancelled) job.done(tokens)
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
