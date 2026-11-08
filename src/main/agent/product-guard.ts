// What a Product Session may do with its tools (worfy-product-session ticket 02; the Epic spec, how it
// works, the limits, and the owner's answers Q3, Q5, Q6). A Product Session is the Product owner's
// advisor: it changes no code, takes no Tickets and never touches git. The PreToolUse hook of its Claude
// Code (src/main/vendors/claude/options.ts, toolUseHooks) asks productToolDecision about each tool call
// and refuses the call when the answer is a refusal; the agent reads the reason.
//
// - Edit, MultiEdit, Write and NotebookEdit may write only below the Product Session folder of the
//   Project (src/shared/product/paths.ts, ADR-0101): `docs/product/` in Full mode, `<Workflow
//   folder>/product/` in Silent mode. The target is judged by both its written and its real form: the
//   written path, `..` folded, lies below the folder's written path in the same case, and the real path
//   (the nearest existing folder resolved by the system, every link and junction followed) lies below
//   the folder's real path. A link that leads out, a `..` after a missing folder, a path in another case
//   (macOS and Windows disks ignore case, a Linux one does not) and, on Windows, a name the system
//   rewrites (`x.`, `x:stream`, `PRODUC~1`) are refused.
// - Bash (and PowerShell, Claude Code's shell tool on Windows) is refused the known commands that write
//   to the repository or to Tickets: the Ticket CLI (`bin/ticket`), `git add|commit|push|merge|rebase|
//   reset`, `gh pr create|merge`, `pnpm` and `npm`. The command is read as the shell reads it: words
//   in quotes are one word (`grep "pnpm"` searches, `git -C "a b" commit` commits), a backslash-newline
//   joins lines, and `$(…)`, backticks, `bash -c` and `eval` are read as commands too. This is not a
//   sandbox (spec, risk 2): a command that writes another way goes through, and the Product Session
//   rules (ticket 10) name the limit in words.
// - Every other tool is allowed.
//
// The guard fails closed: input it cannot read, a folder it cannot resolve, or an error of its own is
// a refusal, never an allowance.
import { normalizePath, nodeFileSystem, type FileSystem } from './auto-approve/roots'

export type ProductToolDecision = { allow: true } | { allow: false; reason: string }

/** Where a Product Session's tool call is judged. */
export interface ProductGuardPlace {
  /** The Product Session folder of the Project (productFolder); null when it could not be found, and then every write is refused. */
  productDir: string | null
  /** The folder a relative path is read against: the shell's folder of the call, else the Session's cwd; null when unknown. */
  cwd: string | null
}

/** The tools that write a file, and the field of their input that names it. */
const FILE_TOOLS: Readonly<Record<string, string>> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

/** The tools that run a shell command from the field `command`. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])

/** The git commands that change the repository (Q3, Q5: a Product Session never touches git). */
const GIT_WRITES: ReadonlySet<string> = new Set(['add', 'commit', 'push', 'merge', 'rebase', 'reset'])
/** The `gh pr` commands that open or merge a PR. */
const GH_PR_WRITES: ReadonlySet<string> = new Set(['create', 'merge'])
/** git options that take the next word as their value. */
const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])
/** gh options that take the next word as their value. */
const GH_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-R', '--repo', '--hostname'])
/** Words before the command itself: shell keywords and commands that run the next word. */
const LEADING_WORDS: ReadonlySet<string> = new Set([
  'sudo', 'env', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'timeout', 'xargs', 'npx', 'corepack',
  'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}',
])
/** Shells whose `-c` (PowerShell: `-Command`, cmd: `/c`) runs the next word as a command. */
const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd'])
/** Programs that run a script file named by their first word that is not an option. */
const INTERPRETERS: ReadonlySet<string> = new Set(['node', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell'])
/** How deep `bash -c`, `eval`, `$(…)` and backticks are followed; deeper is refused. */
const MAX_NESTING = 8

const FOLDER_REASON =
  'A Product Session writes files only below its Product Session folder'
const SHELL_REASON =
  'A Product Session changes no code, takes no Tickets and never touches git, so the command is refused. Read and check freely (git log, gh pr view, epic-status); name the change for the Orchestrator instead of making it.'

const refuse = (reason: string): ProductToolDecision => ({ allow: false, reason })
const ALLOW: ProductToolDecision = { allow: true }

/**
 * Whether a Product Session may make the tool call `tool` with `input`. Never throws: anything it cannot
 * judge is refused.
 */
export function productToolDecision(
  tool: string,
  input: unknown,
  place: ProductGuardPlace,
  platform: NodeJS.Platform,
  fsys: FileSystem = nodeFileSystem,
): ProductToolDecision {
  try {
    const field = Object.hasOwn(FILE_TOOLS, tool) ? FILE_TOOLS[tool] : undefined
    if (field !== undefined) return fileDecision(fieldOf(input, field), place, platform === 'win32', fsys)
    if (SHELL_TOOLS.has(tool)) return shellDecision(fieldOf(input, 'command'), tool === 'PowerShell' ? 'powershell' : 'bash')
    return ALLOW
  } catch (error) {
    return refuse(`The Product Session guard could not judge this ${tool} call, so it is refused: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function fieldOf(input: unknown, field: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[field] : undefined
}

// --- Files ----------------------------------------------------------------------------------

function fileDecision(path: unknown, place: ProductGuardPlace, win: boolean, fsys: FileSystem): ProductToolDecision {
  if (place.productDir === null) return refuse(`${FOLDER_REASON}, and the folder of this Project could not be found, so no file may be written.`)
  const below = `${FOLDER_REASON} ${place.productDir}`
  if (typeof path !== 'string' || path === '') return refuse(`${below}; this call names no file.`)
  const raw = absolute(path, place.cwd, win)
  const written = raw === null ? null : normalizePath(raw, win)
  const folder = normalizePath(place.productDir, win)
  if (raw === null || written === null || folder === null) return refuse(`${below}; ${path} is not a path it can place.`)
  if (win && rewrittenName(raw, [folder, place.cwd === null ? null : systemForm(place.cwd, win)])) return refuse(`${below}; ${path} has a name Windows rewrites before it opens it.`)
  // Written in another case, the path may be another folder on a disk that does not ignore case.
  if (!strictlyBelow(written, folder, win)) return refuse(`${below}; ${path} is not below it.`)
  const real = realForm(raw, win, fsys)
  const realFolder = realForm(folder, win, fsys)
  if (real === null || realFolder === null) return refuse(`${below}; where ${path} really leads cannot be told.`)
  if (!strictlyBelow(real, realFolder, win)) return refuse(`${below}; ${path} leads to ${real}, which is not below it.`)
  return ALLOW
}

/**
 * `path` absolute against `cwd`, in the system's own form — on Windows `\\` separators, `C:\\x` for `c:/x`
 * and Git Bash's `/c/x` — with `.` and `..` kept, so the system walks it as the tool would; null when it
 * cannot be (a UNC path, no `cwd` for a relative one).
 */
function absolute(path: string, cwd: string | null, win: boolean): string | null {
  const own = systemForm(path, win)
  if (own !== null) return own
  const base = cwd === null ? null : systemForm(cwd, win)
  if (base === null) return null
  return systemForm(`${base.replace(/[\\/]+$/, '')}${win ? '\\' : '/'}${path}`, win)
}

function systemForm(path: string, win: boolean): string | null {
  if (!win) return path.startsWith('/') ? path : null
  let text = path.replaceAll('/', '\\')
  if (text.startsWith('\\\\')) return null
  const msys = /^\\([A-Za-z])(\\.*)?$/s.exec(text)
  if (msys !== null) text = `${msys[1] ?? ''}:${msys[2] ?? '\\'}`
  const drive = /^([A-Za-z]):(\\.*)$/s.exec(text)
  return drive === null ? null : `${(drive[1] ?? '').toUpperCase()}:${drive[2] ?? '\\'}`
}

/**
 * Whether a name of `path` below the folder it starts with of `known` (the Product Session folder, the
 * cwd) is one Windows changes before it opens it: a stream (`x:y`), a trailing dot or space, an 8.3
 * short name (`PRODUC~1`). The names of `known` itself are left alone: a temporary folder of Windows is
 * often spelled `RUNNER~1`.
 */
function rewrittenName(path: string, known: ReadonlyArray<string | null>): boolean {
  const lead = known.filter((each): each is string => each !== null).map((each) => each.replace(/[\\/]+$/, '')).filter((each) => path.startsWith(`${each}\\`))
  const start = Math.max(0, ...lead.map((each) => each.length + 1))
  const names = path.slice(start === 0 ? 3 : start).split('\\')
  return names.some((name) => name !== '.' && name !== '..' && (name.includes(':') || /[. ]$/.test(name) || /~\d/.test(name)))
}

/** Whether the normalized `path` lies below the normalized `folder` (not the folder itself), case and all. */
function strictlyBelow(path: string, folder: string, win: boolean): boolean {
  const sep = win ? '\\' : '/'
  return path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)
}

/**
 * The real form of the absolute `path`, which may not exist yet: the nearest existing entry above it
 * resolved by the system (links and junctions followed, `..` taken as the system takes it), plus the
 * missing names. null when it cannot be told: an entry that cannot be read, a link that leads nowhere
 * (a write would follow it), a `..` after a missing folder.
 */
function realForm(path: string, win: boolean, fsys: FileSystem): string | null {
  const sep = win ? '\\' : '/'
  const missing: string[] = []
  let head = topOf(path, win)
  for (;;) {
    const kind = fsys.lstat(head)
    if (kind === 'error') return null
    if (kind !== null) {
      const real = fsys.realpath(head)
      if (real === null) return null
      return normalizePath([real.replace(/[\\/]+$/, ''), ...missing].join(sep), win)
    }
    const at = head.lastIndexOf(sep)
    if (at < 0) return null
    const name = head.slice(at + 1)
    if (name === '..') return null
    if (name !== '.' && name !== '') missing.unshift(name)
    const parent = topOf(head.slice(0, at), win)
    if (parent === head) return null
    head = parent
  }
}

/** `path` without trailing separators, but a root stays one: `/`, `C:\\` (`C:` alone is the drive's current folder). */
function topOf(path: string, win: boolean): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return '/'
  return win && /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed
}

// --- Shell commands -------------------------------------------------------------------------

/** How a command line is read: Bash's quoting (Git Bash on Windows too), or PowerShell's. */
export type Shell = 'bash' | 'powershell'

function shellDecision(command: unknown, shell: Shell): ProductToolDecision {
  if (typeof command !== 'string') return refuse(`${SHELL_REASON} (This call names no command.)`)
  const refused = refusedCommand(command, shell)
  return refused === null ? ALLOW : refuse(`\`${refused}\`: ${SHELL_REASON}`)
}

/** The program a word names: its last path component, in lower case, without a Windows or script extension. */
function programOf(word: string): string {
  const name = word.split(/[\\/]/).at(-1) ?? word
  return name.toLowerCase().replace(/\.(exe|cmd|bat|ps1|mjs|cjs|js|sh)$/, '')
}

/** Whether a word is the Ticket CLI of the Harness, in any form (`…/bin/ticket`, `bin\ticket.mjs`). */
const isTicketCli = (word: string): boolean => /(^|[\\/])bin[\\/]ticket(\.(mjs|cjs|js|cmd|ps1|sh))?$/i.test(word)

/** Thrown past MAX_NESTING: the command is refused. */
class TooDeep extends Error {}

/** The first known write command in `command`, as a short name; null when there is none. */
export function refusedCommand(command: string, shell: Shell = 'bash'): string | null {
  try {
    return refusedIn(command, shell, 0)
  } catch (error) {
    if (error instanceof TooDeep) return 'a command nested too deep to read'
    throw error
  }
}

function refusedIn(command: string, shell: Shell, depth: number): string | null {
  if (depth > MAX_NESTING) throw new TooDeep()
  const nested: string[] = []
  for (const words of simpleCommands(command, shell, nested)) {
    const refused = refusedSimple(words, shell, depth)
    if (refused !== null) return refused
  }
  for (const inner of nested) {
    const refused = refusedIn(inner, shell, depth + 1)
    if (refused !== null) return refused
  }
  return null
}

/** The refusal of one simple command (its words, quotes removed), or null. */
function refusedSimple(words: readonly string[], shell: Shell, depth: number): string | null {
  const at = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) && !word.startsWith('-') && !/^\d+[smhd]?$/.test(word) && !LEADING_WORDS.has(programOf(word)))
  if (at < 0) return null
  const program = programOf(words[at] ?? '')
  const args = words.slice(at + 1)
  // `…/bin/ticket`, `bin\\ticket.mjs` and the bare name on PATH all name the program `ticket`.
  if (program === 'ticket') return 'bin/ticket'
  if (program === 'pnpm' || program === 'npm') return program
  if (program === 'git') {
    const sub = subcommands(args, GIT_VALUE_OPTIONS, 1)[0]
    if (sub !== undefined && GIT_WRITES.has(sub)) return `git ${sub}`
  }
  if (program === 'gh') {
    const [group, sub] = subcommands(args, GH_VALUE_OPTIONS, 2)
    if (group === 'pr' && sub !== undefined && GH_PR_WRITES.has(sub)) return `gh pr ${sub}`
  }
  if (INTERPRETERS.has(program) && isTicketCli(args.find((arg) => !arg.startsWith('-')) ?? '')) return 'bin/ticket'
  if (program === 'eval' || program === 'invoke-expression' || program === 'iex') return refusedIn(args.join(' '), shell, depth + 1)
  if (SHELLS.has(program)) {
    const flag = args.findIndex((arg) => /^(-c|-command|\/c)$/i.test(arg))
    const script = flag < 0 ? undefined : args[flag + 1]
    if (script !== undefined) return refusedIn(script, program === 'pwsh' || program === 'powershell' ? 'powershell' : 'bash', depth + 1)
  }
  return null
}

/**
 * The simple commands of `text` as the shell splits them, each the list of its words with the quotes
 * removed: `;`, `&`, `|`, `(`, `)` and line ends outside quotes end a command; quotes and escapes join a
 * word (Bash: `\` escapes the next character and a backslash-newline is no break; PowerShell: the
 * backtick does, and `\` is a path separator). A `$(…)` (balanced) or backtick substitution is part of
 * the word it stands in, and its text goes into `nested`, to be read as commands of its own. Bash's
 * `$'…'` is read with its escapes. The body of a here-document is no command: it is skipped up to its
 * terminator line (only the substitutions of a body with an unquoted delimiter are read, as Bash runs
 * them). A quote left open runs to the end of the text.
 */
function simpleCommands(text: string, shell: Shell, nested: string[]): string[][] {
  const escape = shell === 'bash' ? '\\' : '`'
  const out: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  const endWord = (): void => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endCommand = (): void => {
    endWord()
    if (words.length > 0) out.push(words)
    words = []
  }
  /** The here-documents of the current line, whose bodies start after its line end. */
  const heredocs: HereDocument[] = []
  /** Reads `$(…)` whose `$` is at `i`; returns the index of its `)`. */
  const substitution = (i: number): number => {
    const end = closingParen(text, i + 2)
    nested.push(text.slice(i + 2, end))
    inWord = true
    return end
  }
  /** Reads a backtick substitution (Bash) whose first backtick is at `i`; returns the index of the second. */
  const backtick = (i: number): number => {
    const found = text.indexOf('`', i + 1)
    const end = found < 0 ? text.length : found
    nested.push(text.slice(i + 1, end))
    inWord = true
    return end
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ''
    if (c === escape) {
      // An escaped line end joins the lines; any other character is taken as it is.
      const next = text[i + 1]
      i++
      if (next === '\r' && text[i + 1] === '\n') i++
      else if (next !== undefined && next !== '\n') {
        word += next
        inWord = true
      }
    } else if (c === "'") {
      const found = text.indexOf("'", i + 1)
      const end = found < 0 ? text.length : found
      word += text.slice(i + 1, end)
      inWord = true
      i = end
    } else if (c === '"') {
      inWord = true
      for (i++; i < text.length && text[i] !== '"'; i++) {
        const d = text[i] ?? ''
        if (d === escape && i + 1 < text.length) {
          const next = text[++i] ?? ''
          // Bash keeps the backslash in double quotes before anything but $ ` " \ and a line end.
          if (shell === 'bash' && !'$`"\\\n'.includes(next)) word += d
          if (next !== '\n') word += next
        } else if (d === '$' && text[i + 1] === '(') i = substitution(i)
        else if (d === '`' && shell === 'bash') i = backtick(i)
        else word += d
      }
    } else if (c === '$' && text[i + 1] === '(') {
      // Part of the current word (`git -C $(…) commit`), read as commands of its own.
      i = substitution(i)
    } else if (c === '$' && text[i + 1] === "'" && shell === 'bash') {
      const quoted = ansiCQuoted(text, i + 2)
      word += quoted.value
      inWord = true
      i = quoted.end
    } else if (c === '`' && shell === 'bash') {
      i = backtick(i)
    } else if (c === '#' && !inWord) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
    } else if (c === '<' && text[i + 1] === '<' && text[i + 2] === '<') {
      // A here-string (`<<< word`), not a here-document: its word is an argument.
      endWord()
      i += 2
    } else if (c === '<' && text[i + 1] === '<' && shell === 'bash') {
      endWord()
      const here = hereDocument(text, i + 2)
      heredocs.push(here.doc)
      i = here.end
    } else if (c === '\n' && heredocs.length > 0) {
      endCommand()
      i = skipBodies(text, i + 1, heredocs.splice(0), nested) - 1
    } else if (';&|()\n\r'.includes(c)) {
      endCommand()
    } else if (' \t<>'.includes(c)) {
      endWord()
    } else {
      word += c
      inWord = true
    }
  }
  endCommand()
  return out
}

/** A here-document of Bash (`<<WORD`, `<<-WORD`, `<<'WORD'`, `<<"WORD"`). */
interface HereDocument {
  delimiter: string
  /** `<<-`: leading tabs of the body's lines, the terminator's too, are dropped. */
  tabs: boolean
  /** A quoted delimiter: the body is taken as it is; else `$(…)` and backticks in it run. */
  quoted: boolean
}

/** Reads the delimiter of a here-document whose `<<` ends just before `from`; `end` is its last character. */
function hereDocument(text: string, from: number): { doc: HereDocument; end: number } {
  let i = from
  const tabs = text[i] === '-'
  if (tabs) i++
  while (text[i] === ' ' || text[i] === '\t') i++
  let delimiter = ''
  let quoted = false
  for (; i < text.length && !' \t\n\r;&|()<>'.includes(text[i] ?? ''); i++) {
    const c = text[i] ?? ''
    if (c === "'" || c === '"') {
      const found = text.indexOf(c, i + 1)
      const end = found < 0 ? text.length : found
      delimiter += text.slice(i + 1, end)
      quoted = true
      i = end
    } else if (c === '\\') {
      delimiter += text[++i] ?? ''
      quoted = true
    } else delimiter += c
  }
  return { doc: { delimiter, tabs, quoted }, end: i - 1 }
}

/**
 * Skips the bodies of `docs`, one after another, from `from` (the start of the line after their
 * command); returns the index of the line end after the last terminator, or the text's end. The text of
 * each `$(…)` and backtick substitution of a body with an unquoted delimiter goes into `nested`: Bash
 * runs those.
 */
function skipBodies(text: string, from: number, docs: readonly HereDocument[], nested: string[]): number {
  let at = from
  for (const doc of docs) {
    for (;;) {
      if (at >= text.length) return text.length
      const found = text.indexOf('\n', at)
      const lineEnd = found < 0 ? text.length : found
      const line = text.slice(at, lineEnd).replace(/\r$/, '')
      const next = lineEnd + 1
      if ((doc.tabs ? line.replace(/^\t+/, '') : line) === doc.delimiter) {
        at = next
        break
      }
      if (!doc.quoted) substitutionsIn(line, nested)
      at = next
    }
  }
  return Math.min(at - 1, text.length)
}

/** Puts the text of each `$(…)` and backtick substitution of `line` into `nested`. */
function substitutionsIn(line: string, nested: string[]): void {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '$' && line[i + 1] === '(') {
      const end = closingParen(line, i + 2)
      nested.push(line.slice(i + 2, end))
      i = end
    } else if (line[i] === '`') {
      const found = line.indexOf('`', i + 1)
      const end = found < 0 ? line.length : found
      nested.push(line.slice(i + 1, end))
      i = end
    }
  }
}

/** Reads Bash's `$'…'` whose text starts at `from`: its value, a character named by its code decoded (other escapes, `\n` or `\'`, stay as written; an escaped quote does not end it), and the index of its closing quote. */
function ansiCQuoted(text: string, from: number): { value: string; end: number } {
  let value = ''
  let i = from
  for (; i < text.length && text[i] !== "'"; i++) {
    const c = text[i] ?? ''
    if (c !== '\\' || i + 1 >= text.length) {
      value += c
      continue
    }
    const next = text[++i] ?? ''
    // \xHH, \uHHHH, \UHHHHHHHH and octal \NNN name a character by its code.
    const code = /^(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|[0-7]{1,3})/.exec(text.slice(i, i + 9))?.[0]
    if (code !== undefined) {
      const point = /^[0-7]/.test(code) ? parseInt(code, 8) : parseInt(code.slice(1), 16)
      value += point <= 0x10ffff ? String.fromCodePoint(point) : ''
      i += code.length - 1
    } else value += `\\${next}`
  }
  return { value, end: i }
}

/** The index of the `)` that closes a `$(` whose text starts at `from`, quotes skipped; the text's end when there is none. */
function closingParen(text: string, from: number): number {
  let depth = 1
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === "'" || c === '"') {
      const end = text.indexOf(c, i + 1)
      if (end < 0) return text.length
      i = end
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return text.length
}

/** The first `count` words of `args` that are not options, skipping the value of an option in `valued`. */
function subcommands(args: readonly string[], valued: ReadonlySet<string>, count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length && out.length < count; i++) {
    const word = args[i] ?? ''
    if (valued.has(word)) i++
    else if (!word.startsWith('-')) out.push(word.toLowerCase())
  }
  return out
}
