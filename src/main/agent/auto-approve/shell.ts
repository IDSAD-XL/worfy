// What a shell command does, for the approval policy of unattended Sessions (worfy-auto-approve
// ticket 02; the Epic spec, how it works, item 2). `analyze` reads one Bash command as Claude Code
// would run it and lists its actions in order: each program with its words, the folder it runs in,
// and the paths it writes, deletes and reads. The policy (ticket 03) decides from that list.
//
// This is a security boundary, so the grammar is small and anything outside it is `judged: false`,
// never a guess: what is not parsed is not allowed. The command may be run by sh, bash or zsh
// (Claude Code runs the user's shell; on Windows, Git Bash), so a construct is inside the grammar
// only when all three read it the same way. Inside it:
//
// - simple commands joined by `&&`, `||`, `;`, `|` and newlines; `#` comments;
// - words of unquoted, single-quoted and double-quoted text, `\` escapes; a line continuation only
//   between words (inside a word, `$NA\<newline>ME` for one, the shells disagree);
// - `$NAME` and `${NAME}` with a value known from the environment or from an assignment earlier in the
//   same command; an unquoted value must hold no blank and no glob character (bash splits and globs
//   it, zsh does not);
// - assignments `NAME=value` on their own, and `NAME=$(mktemp -d)`: a new folder inside TMPDIR. The
//   name must be one the shell gives no meaning to (not PATH, PS4, GLOBIGNORE, zsh `path`, a
//   `BASH_`, `GIT_` or `LD_` name…) and not exported;
// - `~` and `~/…` at the start of a word, from HOME;
// - redirections `>`, `>>`, `>|`, `<`, each with an optional fd number, and `N>&M`;
// - glob `*` and `?` in the last component of a path. A glob that may expand into a word starting
//   with `-` is refused where the program would read it as an option (`git grep -e x *` with a file
//   named `-O…`); rm, rmdir and echo take no option that names a path, so their globs stay;
// - `cd <path>`, `exit` with no operand or one number, `set -e`, `-u`, `-o pipefail`, and `sh -c`,
//   `bash -c`, `zsh -c` (options `-e`, `-u` only) with one unglobbed script, which is read by the
//   same grammar with the same folder and environment.
//
// Outside it (each `judged: false` with a reason): command substitution other than the mktemp
// assignment, backquotes, arithmetic, `eval`, `source`, `.`, functions, `if` / `for` / `while` /
// `case` and the other reserved words, subshells and groups, here-docs and here-strings, process
// substitution, background `&`, `&>`, zsh built-ins such as `zmodload`, any other built-in that
// changes the shell (`chdir`, `set -x`), an unknown variable, IFS, OLDPWD, `~user`, special
// parameters (`$?`, `$1`, `$@`…), `${…}` forms other than `${NAME}`, zsh subscripts and modifiers
// (`$X[1]`, `$X:h`), zsh numeric globs (`<1-9>`), brace expansion, `[` globs, an assignment before a
// program (it changes the program's environment), `cd` or `exit` inside a pipeline, an `exit` that
// may go on (with a redirection or more operands), `/dev/tcp` and `/dev/udp`, `ln` and the
// link and backup options of cp and mv, `test -v` and `-R`, and git commands that start an editor or
// gpg (a commit without a message, `tag -s`, `rebase --continue`).
//
// The folder a command runs in is followed through `cd`: a command after `cd x;` may run in x or,
// when the cd failed, in the folder before it, and the action is listed once for each. Likewise a
// failed `X=$(mktemp -d)` leaves X empty.
//
// Paths are absolute — joined to the folder the action runs in — with variables substituted, but
// not resolved: `.` and `..` stay and nothing is passed through realpath (ticket 03 does that and
// refuses symlink components). A path ends in a glob pattern only when its last component held an
// unquoted `*` or `?`; a literal `*` or `?` in a path is outside the grammar, so in a path these two
// always mean a glob. On Windows (Git Bash) a path comes out as `C:\…` with `\` separators, whether it
// was written `C:\…`, `C:/…` or `/c/…`; the case of the letters is kept as written and ticket 03
// compares without it. `/dev/null` is not listed as a write.
//
// Known programs come from a table (PROGRAMS below). A program outside it writes UNKNOWN, which the
// policy never approves. Not seen here and so not covered: aliases and functions of the user's shell
// snapshot, which could give a known name another meaning, options set in it or in `~/.zshenv` (zsh
// EXTENDED_GLOB, CHASE_LINKS), and the repository's git config and hooks (an alias, a pager, a
// pre-commit hook run code). `why` is always a fixed text of this module, never a piece of the
// command.

/** One program the command runs, in order. */
export interface ShellAction {
  /** The program's name, as the first word after expansion. */
  program: string
  /** The words after the program, after expansion; a glob pattern stays as written. */
  args: string[]
  /** The folder the program runs in (for git: after `-C`). */
  cwd: string
  /** Paths the action creates or changes; UNKNOWN for a program outside the table. */
  writes: string[]
  /** Paths the action removes (including the source of `mv`). */
  deletes: string[]
  /** Paths the action reads that matter to the policy: files sent out, inputs of redirections. */
  reads: string[]
  /** Whether the program talks to the network (curl, wget, git fetch / pull / push). */
  network: boolean
  /** The index in `actions` of the program whose output is this one's input, through a pipe. */
  stdinFrom: number | null
  /** For git: what the subcommand does to branches and remotes, parsed here so the policy never reads `args`. */
  git?: GitFacts
}

/** What a git command does beyond the paths of its action. */
export interface GitFacts {
  /** The subcommand, after the global options; null for a bare `git`. */
  subcommand: string | null
  /** `git branch -d / -D / --delete`: the branches it deletes, and whether by force (-D, -f). */
  branchDelete?: { branches: string[]; force: boolean }
  /** `git push`: where to and what. */
  push?: GitPush
}

export interface GitPush {
  /** The remote as written (a name, a URL or a path); null for the upstream of the current branch. */
  remote: string | null
  /**
   * The folder git writes when the remote word names one on disk, as an absolute path; it is in
   * `writes` too. A bare word (`origin`, `sibdir`) gets one as well: git takes a configured remote of
   * that name first and a folder in the working folder otherwise, and the config is not seen here.
   * Null for a URL, an scp-like `host:path` and the upstream of the current branch.
   */
  localPath: string | null
  /** The refspecs as written (`main`, `HEAD:main`, `+x`, `:old`). */
  refspecs: string[]
  /** Whether it may overwrite history: -f, --force, --force-with-lease, --force-if-includes, --mirror, a `+` refspec. */
  force: boolean
  /** Whether it deletes remote refs: -d, --delete, --prune, --mirror, a refspec with an empty source (`:x`). */
  delete: boolean
  /** Whether it pushes refs it does not name: --all, --mirror, --tags, --follow-tags. */
  many: boolean
}

export type Analysis = { judged: true; actions: ShellAction[] } | { judged: false; why: string }

export interface AnalyzeContext {
  /** The folder the command starts in, absolute. */
  cwd: string
  /** The environment of the shell that runs the command. */
  env: Readonly<Record<string, string | undefined>>
  /** The platform of the machine; `win32` means Git Bash. */
  platform: NodeJS.Platform
}

/** What a program outside the table writes: anything. */
export const UNKNOWN = '<unknown>'
/** What git writes or reads: the repository that holds the action's `cwd` (ticket 03 finds its top). */
export const REPOSITORY = '<repository>'
/**
 * The last component of the folder `mktemp -d` creates inside TMPDIR: `<new-temp-folder-1>`,
 * `<new-temp-folder-2>`… in the order of the command. The folder does not exist yet when the policy
 * looks; `<` and `>` cannot be in a Windows file name.
 */
export function newTempFolderName(n: number): string {
  return `<new-temp-folder-${n}>`
}

/** Whether a path component is one that newTempFolderName gives. */
export function isNewTempFolder(component: string): boolean {
  return /^<new-temp-folder-[1-9][0-9]*>$/.test(component)
}

// How deep `sh -c` may nest, how many folder and variable states a command may branch into, and how
// many actions it may list.
const MAX_DEPTH = 3
const MAX_STATES = 8
const MAX_ACTIONS = 200

class NotJudged extends Error {
  constructor(readonly why: string) {
    super(why)
  }
}

function fail(why: string): never {
  throw new NotJudged(why)
}

/** The actions of `command`, or why it is outside the grammar. Pure: no file system, no process. */
export function analyze(command: string, context: AnalyzeContext): Analysis {
  try {
    const counter = { tempFolders: 0 }
    return { judged: true, actions: evaluate(command, context, 0, counter) }
  } catch (error) {
    if (error instanceof NotJudged) return { judged: false, why: error.why }
    throw error
  }
}

// --- Syntax ---------------------------------------------------------------------------------

type Part = { kind: 'text'; text: string; quoted: boolean } | { kind: 'var'; name: string; quoted: boolean } | { kind: 'mktemp' }

interface Word {
  parts: Part[]
}

type Redirect = { kind: 'file'; op: '>' | '>>' | '>|' | '<'; target: Word } | { kind: 'dup' }

interface Command {
  words: Word[]
  redirects: Redirect[]
}

type Connector = 'seq' | 'and' | 'or'

interface Step {
  connector: Connector
  pipeline: Command[]
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const NAME_START = /[A-Za-z_]/
const NAME_CHAR = /[A-Za-z0-9_]/
// Characters that end an unquoted word.
const WORD_END = new Set([' ', '\t', '\n', ';', '&', '|', '<', '>', '(', ')'])

class Parser {
  private i = 0

  constructor(private readonly src: string) {
    // A carriage return, a NUL or another control character reads differently between shells and
    // editors; a tab and a newline are the only ones the grammar takes.
    for (const c of src) {
      const code = c.charCodeAt(0)
      if ((code < 0x20 && c !== '\t' && c !== '\n') || code === 0x7f) fail('a control character in the command')
    }
  }

  private peek(offset = 0): string | undefined {
    return this.src[this.i + offset]
  }

  /** Skips blanks, line continuations and a comment; never a newline. */
  private skipBlanks(): void {
    for (;;) {
      const c = this.peek()
      if (c === ' ' || c === '\t') this.i++
      else if (c === '\\' && this.peek(1) === '\n') this.i += 2
      else if (c === '#') {
        while (this.peek() !== undefined && this.peek() !== '\n') this.i++
      } else return
    }
  }

  private skipBlanksAndNewlines(): void {
    for (;;) {
      this.skipBlanks()
      if (this.peek() !== '\n') return
      this.i++
    }
  }

  script(): Step[] {
    const steps: Step[] = []
    let connector: Connector = 'seq'
    for (;;) {
      this.skipBlanksAndNewlines()
      if (this.peek() === undefined) {
        if (connector !== 'seq') fail('a command ends with && or ||')
        return steps
      }
      steps.push({ connector, pipeline: this.pipeline() })
      this.skipBlanks()
      const c = this.peek()
      if (c === undefined) return steps
      if (c === '\n') {
        this.i++
        connector = 'seq'
      } else if (c === ';') {
        this.i++
        if (this.peek() === ';' || this.peek() === '&') fail('a case terminator')
        connector = 'seq'
      } else if (c === '&' && this.peek(1) === '&') {
        this.i += 2
        connector = 'and'
      } else if (c === '|' && this.peek(1) === '|') {
        this.i += 2
        connector = 'or'
      } else fail('a control operator outside the grammar')
    }
  }

  private pipeline(): Command[] {
    const commands = [this.command()]
    for (;;) {
      this.skipBlanks()
      if (this.peek() !== '|' || this.peek(1) === '|') return commands
      if (this.peek(1) === '&') fail('a |& pipe')
      this.i++
      this.skipBlanksAndNewlines()
      commands.push(this.command())
    }
  }

  private command(): Command {
    const words: Word[] = []
    const redirects: Redirect[] = []
    for (;;) {
      this.skipBlanks()
      const c = this.peek()
      if (c === undefined || c === '\n' || c === ';' || c === '|') break
      if (c === '&') {
        if (this.peek(1) === '&') break
        fail('a background & or an &> redirection')
      }
      if (c === '(' || c === ')') fail('a subshell, a function or a glob group')
      if (c === '<' || c === '>') {
        redirects.push(this.redirect())
        continue
      }
      const start = this.i
      const word = this.word()
      const next = this.peek()
      const raw = this.src.slice(start, this.i)
      if ((next === '<' || next === '>') && /^[0-9]+$/.test(raw)) {
        // dash takes one digit as an fd; bash and zsh take more.
        if (raw.length > 1) fail('an fd of more than one digit')
        redirects.push(this.redirect())
        continue
      }
      words.push(word)
    }
    if (words.length === 0 && redirects.length === 0) fail('a missing command')
    return { words, redirects }
  }

  private redirect(): Redirect {
    const c = this.peek()
    const n = this.peek(1)
    let op: '>' | '>>' | '>|' | '<'
    // zsh reads `<1-9>` and `<->` as a numeric glob, not a redirection.
    if (c === '<' && /^<[0-9]*-[0-9]*>/.test(this.src.slice(this.i))) fail('a zsh numeric glob')
    if (c === '<') {
      if (n === '<') fail('a here-doc or a here-string')
      if (n === '&' || n === '>') fail('a <& or <> redirection')
      if (n === '(') fail('a process substitution')
      op = '<'
      this.i++
    } else {
      if (n === '(') fail('a process substitution')
      if (n === '&') {
        this.i += 2
        const digit = this.peek()
        if (digit === undefined || !/[0-9]/.test(digit)) fail('a >& to a file')
        this.i++
        const end = this.peek()
        if (end !== undefined && !WORD_END.has(end)) fail('a >& to a file')
        return { kind: 'dup' }
      }
      if (n === '>') {
        if (this.peek(2) === '&' || this.peek(2) === '(' || this.peek(2) === '|') fail('a >>&, >>( or >>| redirection')
        op = '>>'
        this.i += 2
      } else if (n === '|') {
        op = '>|'
        this.i += 2
      } else {
        op = '>'
        this.i++
      }
    }
    this.skipBlanks()
    const t = this.peek()
    if (t === undefined || WORD_END.has(t)) fail('a redirection without a target')
    return { kind: 'file', op, target: this.word() }
  }

  private word(): Word {
    const parts: Part[] = []
    const text = (value: string, quoted: boolean): void => {
      const last = parts.at(-1)
      if (last !== undefined && last.kind === 'text' && last.quoted === quoted) last.text += value
      else parts.push({ kind: 'text', text: value, quoted })
    }
    let bracket = false
    const start = this.i
    for (;;) {
      const c = this.peek()
      if (c === undefined || WORD_END.has(c)) break
      if (c === '\\') {
        const n = this.peek(1)
        if (n === undefined) fail('a backslash at the end of the command')
        // The shell removes a line continuation before it reads names: `$H\<newline>OME` is $HOME.
        if (n === '\n') fail('a line continuation inside a word')
        this.i += 2
        text(n, true)
      } else if (c === "'") {
        const close = this.src.indexOf("'", this.i + 1)
        if (close < 0) fail('an unterminated quote')
        text(this.src.slice(this.i + 1, close), true)
        this.i = close + 1
      } else if (c === '"') {
        this.i++
        text('', true)
        for (;;) {
          const d = this.peek()
          if (d === undefined) fail('an unterminated quote')
          if (d === '"') {
            this.i++
            break
          }
          if (d === '\\') {
            const n = this.peek(1)
            if (n === undefined) fail('an unterminated quote')
            if (n === '\n') fail('a line continuation inside a word')
            else if (n === '$' || n === '`' || n === '"' || n === '\\') {
              text(n, true)
              this.i += 2
            } else {
              text('\\', true)
              this.i++
            }
          } else if (d === '$') parts.push(this.dollar(true))
          else if (d === '`') fail('a command substitution')
          else {
            text(d, true)
            this.i++
          }
        }
      } else if (c === '$') parts.push(this.dollar(false))
      else if (c === '`') fail('a command substitution')
      else if (c === '{' || c === '}') fail('a brace expansion or a group')
      else if (c === '!') fail('a ! negation or history expansion')
      else {
        if (c === '[') bracket = true
        if (c === '=' && this.i === start && this.peek(1) !== undefined && !WORD_END.has(this.peek(1) ?? ' ')) fail('a zsh = expansion')
        text(c, false)
        this.i++
      }
    }
    if (bracket && !(parts.length === 1 && parts[0]?.kind === 'text' && parts[0].text === '[' && !parts[0].quoted)) fail('a [ glob')
    return { parts }
  }

  private dollar(quoted: boolean): Part {
    const n = this.peek(1)
    if (n === '{') {
      const close = this.src.indexOf('}', this.i + 2)
      const name = close < 0 ? '' : this.src.slice(this.i + 2, close)
      if (!NAME.test(name)) fail('a parameter expansion other than ${NAME}')
      this.i = close + 1
      return { kind: 'var', name, quoted }
    }
    if (n !== undefined && NAME_START.test(n)) {
      const start = this.i + 1
      this.i = start
      while (this.peek() !== undefined && NAME_CHAR.test(this.peek() ?? '')) this.i++
      // zsh reads `$X[1]` as a subscript and `$X:h` as a modifier, even inside double quotes.
      if (this.peek() === '[' || this.peek() === ':') fail('a zsh subscript or modifier')
      return { kind: 'var', name: this.src.slice(start, this.i), quoted }
    }
    if (n === '(') {
      if (this.peek(2) === '(') fail('an arithmetic expansion')
      const close = this.src.indexOf(')', this.i + 2)
      if (close < 0) fail('a command substitution')
      const inner = this.src.slice(this.i + 2, close)
      if (!/^[ \t]*mktemp[ \t]+-d[ \t]*$/.test(inner)) fail('a command substitution')
      this.i = close + 1
      return { kind: 'mktemp' }
    }
    return fail('a special parameter, $\'…\' or a lone $')
  }
}

// --- Expansion ------------------------------------------------------------------------------

interface State {
  cwd: string
  /** Variables assigned by the command so far; the rest come from the environment. */
  assigned: ReadonlyMap<string, string>
  ok: boolean
}

/** A word after expansion. */
interface Expanded {
  value: string
  /** The index of the first unquoted `*` or `?`, or -1. */
  globAt: number
  /** A `*` or `?` that is not a glob: quoted, or from a variable. */
  literalGlob: boolean
  /** An unquoted `^`, `#` or `~` inside the word: a pattern for zsh with EXTENDED_GLOB. */
  extendedGlob: boolean
  /** A glob at the very start (`*x`, `?`, zsh `^x`): it may expand to a file name that begins with `-`. */
  leadingGlob: boolean
}

interface Scope {
  context: AnalyzeContext
  win: boolean
  depth: number
  counter: { tempFolders: number }
  actions: ShellAction[]
}

function variable(name: string, state: State, scope: Scope): string {
  if (name === 'IFS') fail('a reference to IFS')
  if (name === 'OLDPWD') fail('a reference to OLDPWD')
  if (name === 'PWD') {
    // The shell holds PWD with `.` and `..` folded; the folder here keeps them for ticket 03.
    if (/(^|[\\/])\.\.?([\\/]|$)/.test(state.cwd) || /[\\/]{2}/.test(state.cwd.slice(1))) fail('a $PWD after a cd with . or ..')
    return shellForm(state.cwd, scope.win)
  }
  const assigned = state.assigned.get(name)
  if (assigned !== undefined) return assigned
  const value = scope.context.env[name]
  if (value === undefined) fail('an unknown variable')
  // Git Bash turns these from the Windows form into its own when it starts (the MSYS runtime
  // converts HOME, TMPDIR, TMP and TEMP): `~` is `/c/Users/…` there, not `C:\Users\…`.
  if (scope.win && WINDOWS_CONVERTED.has(name) && /^[A-Za-z]:[\\/]/.test(value)) return shellForm(windowsAbsolute(value) ?? value, true)
  return value
}

const WINDOWS_CONVERTED = new Set(['HOME', 'TMPDIR', 'TMP', 'TEMP'])

/**
 * The word `word` after expansion. `field`: an argument, where an unquoted empty word disappears and
 * an unquoted value must not split or glob; else the value of an assignment, which does neither.
 * Undefined when the word disappears.
 */
function expand(word: Word, state: State, scope: Scope, field: boolean): Expanded | undefined {
  let value = ''
  let globAt = -1
  let literalGlob = false
  let extendedGlob = false
  let leadingCaret = false
  let quotedAny = false
  word.parts.forEach((part, index) => {
    if (part.kind === 'mktemp') fail('a command substitution')
    if (part.kind === 'var') {
      const v = variable(part.name, state, scope)
      if (part.quoted) quotedAny = true
      else if (field && /[ \t\n*?[]/.test(v)) fail('an unquoted variable whose value splits or globs')
      if (/[*?]/.test(v)) literalGlob = true
      value += v
      return
    }
    if (part.quoted) {
      quotedAny = true
      if (/[*?]/.test(part.text)) literalGlob = true
      value += part.text
      return
    }
    let text = part.text
    if (index === 0 && text.startsWith('~')) {
      const slash = text.indexOf('/')
      const prefix = slash < 0 ? text : text.slice(0, slash)
      if (prefix !== '~') fail('a ~user or ~+ expansion')
      if (slash < 0 && word.parts.length > 1) fail('a ~ before quoted text')
      const home = variable('HOME', state, scope)
      if (/[*?]/.test(home)) literalGlob = true
      value += home
      text = text.slice(1)
    }
    for (let k = 0; k < text.length; k++) {
      const c = text[k] ?? ''
      if (c === '*' || c === '?') {
        if (globAt < 0) globAt = value.length
      } else if (c === '~') {
        const before = k > 0 ? text[k - 1] : undefined
        // bash expands `~` after `=` or `:` in an argument that looks like an assignment; sh and zsh do not.
        if (field && (before === '=' || before === ':')) fail('a ~ after = or :')
        if (!field && before === ':') fail('a ~ after :')
        extendedGlob = true
      } else if (c === '^' || c === '#') {
        extendedGlob = true
        if (c === '^' && value.length === 0) leadingCaret = true
      }
      value += c
    }
  })
  if (field && !quotedAny && value === '') return undefined
  return { value, globAt: field ? globAt : -1, literalGlob, extendedGlob, leadingGlob: field && (globAt === 0 || leadingCaret) }
}

// --- Paths ----------------------------------------------------------------------------------

/** `C:\x` from `C:\x`, `C:/x` or `/c/x`; undefined for a relative path. Fails on forms outside a drive. */
function windowsAbsolute(path: string): string | undefined {
  if (/^[\\/]{2}/.test(path)) fail('a UNC path')
  const drive = /^([A-Za-z]):(.*)$/s.exec(path)
  if (drive !== null) {
    const rest = drive[2] ?? ''
    if (!/^[\\/]/.test(rest)) fail('a drive-relative path')
    return `${(drive[1] ?? '').toUpperCase()}:${rest.replaceAll('/', '\\')}`
  }
  const msys = /^\/([A-Za-z])(\/.*)?$/s.exec(path)
  if (msys !== null) return `${(msys[1] ?? '').toUpperCase()}:${(msys[2] ?? '\\').replaceAll('/', '\\')}`
  if (path.startsWith('/') || path.startsWith('\\')) fail('a Git Bash path outside a drive')
  return undefined
}

/** `path` joined to the folder `cwd`, in the platform's form; not resolved. */
function join(cwd: string, path: string, win: boolean): string {
  if (win) {
    const absolute = windowsAbsolute(path)
    if (absolute !== undefined) return absolute
    return `${cwd}${cwd.endsWith('\\') ? '' : '\\'}${path.replaceAll('/', '\\')}`
  }
  if (path.startsWith('/')) return path
  return `${cwd}${cwd.endsWith('/') ? '' : '/'}${path}`
}

/** The folder `cwd` as the shell spells it: `/c/x` for `C:\x` in Git Bash. */
function shellForm(cwd: string, win: boolean): string {
  if (!win) return cwd
  return `/${cwd[0]?.toLowerCase() ?? ''}${cwd.slice(2).replaceAll('\\', '/')}`
}

function startFolder(context: AnalyzeContext, win: boolean): string {
  if (win) return windowsAbsolute(context.cwd) ?? fail('a working folder that is not absolute')
  if (!context.cwd.startsWith('/')) fail('a working folder that is not absolute')
  return context.cwd
}

/** The path a word names, from the folder `cwd`. Fails on a path the policy could misread. */
function pathOf(word: Expanded, cwd: string, scope: Scope): string {
  if (word.value === '') fail('an empty path')
  if (word.extendedGlob) fail('a zsh extended glob character in a path')
  if (word.literalGlob) fail('a literal * or ? in a path')
  if (word.globAt >= 0) {
    const rest = word.value.slice(word.globAt)
    if (rest.includes('/') || (scope.win && word.value.includes('\\'))) fail('a glob before the last component of a path')
  }
  return join(cwd, word.value, scope.win)
}

/** A path for a target that a glob must not widen: a destination, a folder to enter. */
function exactPathOf(word: Expanded, cwd: string, scope: Scope): string {
  if (word.globAt >= 0) fail('a glob in a path that must name one file')
  return pathOf(word, cwd, scope)
}

// --- Programs -------------------------------------------------------------------------------

interface Effects {
  writes: string[]
  deletes: string[]
  reads: string[]
  network: boolean
  /** The folder the program works in, when it differs from the shell's (git -C). */
  cwd?: string
  git?: GitFacts
}

const none = (): Effects => ({ writes: [], deletes: [], reads: [], network: false })

interface OptionSpec {
  /** Short options without a value. */
  flags?: string
  /** Short options with a value, attached or in the next word. */
  values?: string
  /** Long options: without a value, with one after `=` or in the next word, or with one only after `=`. */
  long?: Record<string, 'flag' | 'value' | 'optional'>
  /** Whether options may follow operands (curl, wget, git); else an option after an operand fails, as BSD and GNU tools disagree on it. */
  anywhere?: boolean
}

interface Option {
  name: string
  value: Expanded | undefined
}

/** The word from index `from` on: the value of an option written `--name=value` or `-xvalue`. */
function slice(word: Expanded, from: number): Expanded {
  if (word.globAt >= 0 && word.globAt < from) fail('a glob in an option')
  const globAt = word.globAt < 0 ? -1 : word.globAt - from
  return { ...word, value: word.value.slice(from), globAt, leadingGlob: globAt === 0 }
}

function options(args: Expanded[], spec: OptionSpec): { options: Option[]; operands: Expanded[] } {
  const found: Option[] = []
  const operands: Expanded[] = []
  let ended = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as Expanded
    const v = arg.value
    if (ended || v === '-' || !v.startsWith('-')) {
      operands.push(arg)
      continue
    }
    if (operands.length > 0 && spec.anywhere !== true) fail('an option after an operand')
    if (arg.globAt >= 0) fail('a glob in an option')
    if (v === '--') {
      ended = true
      continue
    }
    if (v.startsWith('--')) {
      const eq = v.indexOf('=')
      const name = eq < 0 ? v.slice(2) : v.slice(2, eq)
      const kind = spec.long !== undefined && Object.hasOwn(spec.long, name) ? spec.long[name] : undefined
      if (kind === undefined) fail('an option the table does not know')
      if (kind === 'flag') {
        if (eq >= 0) fail('an option the table does not know')
        found.push({ name, value: undefined })
      } else if (eq >= 0) found.push({ name, value: slice(arg, eq + 1) })
      else if (kind === 'optional') found.push({ name, value: undefined })
      else {
        const next = args[++i]
        if (next === undefined) fail('an option without its value')
        found.push({ name, value: next })
      }
      continue
    }
    for (let k = 1; k < v.length; k++) {
      const ch = v[k] ?? ''
      if (spec.flags?.includes(ch) === true) {
        found.push({ name: ch, value: undefined })
        continue
      }
      if (spec.values?.includes(ch) !== true) fail('an option the table does not know')
      if (k + 1 < v.length) found.push({ name: ch, value: slice(arg, k + 1) })
      else {
        const next = args[++i]
        if (next === undefined) fail('an option without its value')
        found.push({ name: ch, value: next })
      }
      break
    }
  }
  return { options: found, operands }
}

const flagsOf = (letters: string, ...long: string[]): OptionSpec => ({ flags: letters, long: Object.fromEntries(long.map((name) => [name, 'flag' as const])) })

const RM = flagsOf('dfiIPRrvWx', 'force', 'recursive', 'dir', 'verbose', 'interactive', 'one-file-system', 'no-preserve-root', 'preserve-root')
const RMDIR = flagsOf('v', 'verbose', 'ignore-fail-on-non-empty')
// No -b: a backup `<destination>~` is a write beside the destination. cp has no -l / -s (links): see `ln`.
const MV = flagsOf('fhinuvTZ', 'force', 'interactive', 'no-clobber', 'update', 'verbose', 'no-target-directory', 'strip-trailing-slashes')
const CP = flagsOf('acdfHiLnNPpRrTuvXxZ', 'archive', 'force', 'interactive', 'no-clobber', 'recursive', 'verbose', 'dereference', 'no-dereference', 'parents', 'update', 'one-file-system', 'no-target-directory', 'strip-trailing-slashes', 'remove-destination')
const MKDIR: OptionSpec = { flags: 'pv', values: 'm', long: { parents: 'flag', verbose: 'flag', mode: 'value' } }
const TOUCH: OptionSpec = { flags: 'acfhm', values: 'rtdA', long: { 'no-create': 'flag', 'no-dereference': 'flag', reference: 'value', date: 'value', time: 'value' } }
const TEE = flagsOf('aip', 'append', 'ignore-interrupts')

function paths(words: Expanded[], cwd: string, scope: Scope): string[] {
  return words.map((word) => pathOf(word, cwd, scope))
}

/** mv, cp: sources and one destination, the last operand. */
function sourcesAndDestination(operands: Expanded[], cwd: string, scope: Scope): { sources: string[]; destination: string } {
  if (operands.length < 2) fail('a missing destination')
  const destination = operands.at(-1) as Expanded
  return { sources: paths(operands.slice(0, -1), cwd, scope), destination: exactPathOf(destination, cwd, scope) }
}

const CURL_FLAGS = 'sSfLviIkgGNq012346Zj#'
const CURL_LONG: Record<string, 'flag' | 'value'> = Object.fromEntries([
  ...['silent', 'show-error', 'fail', 'fail-with-body', 'fail-early', 'location', 'location-trusted', 'verbose', 'include', 'head', 'insecure', 'globoff', 'get', 'no-buffer', 'compressed', 'http1.1', 'http2', 'http2-prior-knowledge', 'progress-bar', 'create-dirs', 'no-progress-meter', 'retry-all-errors', 'parallel', 'ipv4', 'ipv6', 'no-keepalive', 'tcp-nodelay', 'ssl-no-revoke'].map((name) => [name, 'flag']),
  ...['output', 'dump-header', 'cookie-jar', 'trace', 'trace-ascii', 'stderr', 'libcurl', 'etag-save', 'upload-file', 'cacert', 'cert', 'key', 'capath', 'etag-compare', 'data', 'data-binary', 'data-ascii', 'json', 'data-urlencode', 'header', 'write-out', 'cookie', 'request', 'user-agent', 'referer', 'user', 'max-time', 'connect-timeout', 'retry', 'retry-delay', 'retry-max-time', 'proxy', 'url', 'range', 'continue-at', 'limit-rate', 'resolve', 'connect-to', 'max-redirs', 'oauth2-bearer', 'data-raw', 'proxy-user', 'speed-limit', 'speed-time', 'max-filesize', 'expect100-timeout'].map((name) => [name, 'value']),
])
const CURL_SHORT_LONG: Record<string, string> = { o: 'output', D: 'dump-header', c: 'cookie-jar', T: 'upload-file', E: 'cert', d: 'data', H: 'header', w: 'write-out', b: 'cookie', X: 'request', A: 'user-agent', e: 'referer', u: 'user', m: 'max-time', x: 'proxy', r: 'range', C: 'continue-at', Y: 'speed-limit', y: 'speed-time', U: 'proxy-user', F: 'form' }

function curl(args: Expanded[], cwd: string, scope: Scope): Effects {
  const parsed = options(args, { flags: CURL_FLAGS, values: Object.keys(CURL_SHORT_LONG).join(''), long: { ...CURL_LONG, form: 'value' }, anywhere: true })
  const effects: Effects = { ...none(), network: true }
  const file = (value: Expanded, from = 0): string | undefined => {
    const rest = slice(value, from)
    return rest.value === '-' ? undefined : pathOf(rest, cwd, scope)
  }
  for (const option of parsed.options) {
    const name = CURL_SHORT_LONG[option.name] ?? option.name
    const value = option.value
    if (value === undefined) continue
    switch (name) {
      case 'output':
        if (value.value.includes('#')) fail('a curl output named from a URL glob')
        pushDefined(effects.writes, file(value))
        break
      case 'dump-header':
      case 'cookie-jar':
      case 'trace':
      case 'trace-ascii':
      case 'stderr':
      case 'libcurl':
      case 'etag-save':
        pushDefined(effects.writes, file(value))
        break
      case 'upload-file':
        if (value.value !== '.') pushDefined(effects.reads, file(value))
        break
      case 'cacert':
      case 'cert':
      case 'key':
      case 'capath':
      case 'etag-compare':
        pushDefined(effects.reads, file(value))
        break
      case 'data':
      case 'data-binary':
      case 'data-ascii':
      case 'json':
      case 'header':
        if (value.value.startsWith('@')) pushDefined(effects.reads, file(value, 1))
        break
      case 'write-out':
        if (value.value.includes('%output')) fail('a curl --write-out that writes a file')
        if (value.value.startsWith('@')) pushDefined(effects.reads, file(value, 1))
        break
      case 'data-urlencode': {
        const eq = value.value.indexOf('=')
        const at = value.value.indexOf('@')
        if (at >= 0 && (eq < 0 || at < eq)) pushDefined(effects.reads, file(value, at + 1))
        break
      }
      case 'cookie':
        if (!value.value.includes('=')) pushDefined(effects.reads, file(value))
        break
      case 'form':
        if (/[@<]/.test(value.value)) fail('a curl --form that sends a file')
        break
      default:
        break
    }
  }
  return effects
}

const WGET_LONG: Record<string, 'flag' | 'value'> = Object.fromEntries([
  ...['quiet', 'verbose', 'no-verbose', 'continue', 'timestamping', 'server-response', 'spider', 'no-check-certificate', 'no-clobber', 'no-parent', 'recursive', 'mirror', 'convert-links', 'page-requisites', 'https-only', 'show-progress', 'content-disposition', 'no-directories', 'no-host-directories', 'force-directories', 'adjust-extension', 'span-hosts', 'inet4-only', 'inet6-only'].map((name) => [name, 'flag']),
  ...['output-document', 'output-file', 'append-output', 'directory-prefix', 'input-file', 'post-file', 'body-file', 'post-data', 'body-data', 'method', 'header', 'user-agent', 'timeout', 'tries', 'wait', 'limit-rate', 'level', 'max-redirect', 'progress', 'quota'].map((name) => [name, 'value']),
])
const WGET_SHORT_LONG: Record<string, string> = { O: 'output-document', o: 'output-file', a: 'append-output', P: 'directory-prefix', i: 'input-file', T: 'timeout', t: 'tries', U: 'user-agent', w: 'wait', l: 'level', Q: 'quota', n: 'no' }

function wget(args: Expanded[], cwd: string, scope: Scope): Effects {
  const parsed = options(args, { flags: 'qvcNSrmkpxEKH46', values: Object.keys(WGET_SHORT_LONG).join(''), long: WGET_LONG, anywhere: true })
  const effects: Effects = { ...none(), network: true }
  let output = false
  let spider = false
  for (const option of parsed.options) {
    const name = WGET_SHORT_LONG[option.name] ?? option.name
    const value = option.value
    if (name === 'spider') spider = true
    if (value === undefined) continue
    switch (name) {
      case 'no':
        // -nv, -nc, -nd, -nH, -np
        if (!['v', 'c', 'd', 'H', 'p'].includes(value.value)) fail('an option the table does not know')
        break
      case 'output-document':
        output = true
        if (value.value !== '-') effects.writes.push(exactPathOf(value, cwd, scope))
        break
      case 'directory-prefix':
        output = true
        effects.writes.push(exactPathOf(value, cwd, scope))
        break
      case 'output-file':
      case 'append-output':
        effects.writes.push(exactPathOf(value, cwd, scope))
        break
      case 'input-file':
      case 'post-file':
      case 'body-file':
        if (value.value !== '-') effects.reads.push(exactPathOf(value, cwd, scope))
        break
      default:
        break
    }
  }
  if (!output && !spider) fail('a wget whose file is named by the server')
  return effects
}

// Git: global options before the subcommand. -c and the options that move the repository can name
// programs or another repository, so they are outside the grammar, as are the GIT_ variables that
// do the same from the environment.
const GIT_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_EXEC_PATH']
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'merge-base', 'describe', 'blame', 'shortlog', 'rev-list', 'name-rev', 'for-each-ref', 'show-ref', 'grep', 'check-ignore'])
// Options of the read subcommands that write a file or run a program: --output, --ext-diff,
// --textconv, grep's -O / --open-files-in-pager. Git takes any unambiguous prefix of a long option,
// so a prefix of these is refused too. Every word is checked, after `--` too: which options take a
// value is not known here, so a `--` may be the value of one (`git grep -e -- -Oprogram`).
const GIT_READ_DENIED = ['output', 'ext-diff', 'textconv', 'open-files-in-pager']
// A read subcommand reads the files its words name, not only the repository: `git diff /dev/null x`
// and `--no-index` print any file, `git blame --contents=x` reads x. Which word is a revision and
// which a path is not known here, so every word that is no option, and every `--name=value` value,
// is listed in `reads`; one that may leave the repository (absolute, `..`) is refused.
const GIT_READ_OUTSIDE = ['no-index']
// git config reads these besides the repository's own file; --global, --system, --file and --blob
// name only another file, so they are refused.
const GIT_CONFIG_OUTSIDE = ['global', 'system', 'file', 'blob']

/** Whether a path a git word names may lie outside the repository: absolute, or with a `..` component. */
function leavesRepository(value: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(value) || value.split(/[\\/]/).includes('..')
}
// Subcommands that change the repository and nothing outside it, with the options that read a file
// or run a program (an editor, a merge strategy, a command per commit, a template) denied, short
// ones in any cluster and long ones by any prefix.
const GIT_LOCAL = new Set(['add', 'commit', 'checkout', 'switch', 'restore', 'reset', 'stash', 'merge', 'rebase', 'cherry-pick', 'revert', 'tag', 'rm', 'mv', 'fetch', 'pull'])
const GIT_LOCAL_DENIED_SHORT = 'FtxsSeipX'
const GIT_LOCAL_DENIED_LONG = ['file', 'pathspec-from-file', 'template', 'exec', 'strategy', 'strategy-option', 'gpg-sign', 'edit', 'reedit-message', 'interactive', 'patch', 'upload-pack', 'receive-pack', 'config', 'recurse-submodules', 'ext-diff', 'output']
const GIT_PUSH: OptionSpec = {
  flags: 'fdunqv',
  values: 'o',
  long: Object.fromEntries([
    ...['force', 'force-if-includes', 'no-force-with-lease', 'delete', 'set-upstream', 'tags', 'follow-tags', 'all', 'mirror', 'prune', 'dry-run', 'quiet', 'verbose', 'porcelain', 'no-verify', 'verify', 'atomic', 'progress', 'no-progress'].map((name) => [name, 'flag' as const]),
    ['push-option', 'value' as const],
    ['force-with-lease', 'optional' as const],
  ]),
  anywhere: true,
}

function deniedLong(name: string, denied: string[]): boolean {
  return denied.some((full) => full.startsWith(name) || name.startsWith(full))
}

const GIT_BRANCH_LIST = ['-a', '-r', '-l', '-v', '-vv', '--all', '--remotes', '--list', '--show-current', '--no-color']
const GIT_BRANCH_DELETE: OptionSpec = { flags: 'dDfr', long: { delete: 'flag', force: 'flag', remotes: 'flag' }, anywhere: true }
// The long options of git branch judged beside a listing (GIT_BRANCH_LIST, read above), exactly as
// written: git takes any unambiguous prefix (`--del` is --delete, `--mov` is --move), so any other
// long option is refused.
const GIT_BRANCH_LONG = new Set(['--delete', '--force', '--remotes'])

/** The name of a long option word (`--name` or `--name=value`), or undefined for any other word and for `--`. */
function longName(value: string): string | undefined {
  if (!value.startsWith('--') || value === '--') return undefined
  return value.slice(2).split('=')[0] ?? ''
}

// What may start an editor or gpg in the local subcommands, beyond GIT_LOCAL_DENIED_*: a commit
// without a message of its own, `commit -c`, an annotated tag without one, a signed tag, an
// interactive rebase through pull, and `--continue`, which commits. What starts one is looked for in
// every word, by any prefix of a long option; what says a message is given counts only exactly and
// only before the first `--`, so an option or a `--` that is the value of another (`commit -m -- -e`,
// `tag -m -- --sign`) is never taken for the end of the options.
function gitLaunches(sub: string, rest: Expanded[]): boolean {
  const all = rest.map((arg) => arg.value)
  const end = all.indexOf('--')
  const before = end < 0 ? all : all.slice(0, end)
  // Any short word that holds the letter, a value glued to it too (`-mcool` holds c): a launch.
  const short = (words: string[], letter: string): boolean => words.some((v) => /^-[A-Za-z]/.test(v) && !v.startsWith('--') && v.includes(letter))
  // A message only as -m or -C itself, after flags that take no value (`-am`), never inside a value (`-unormal`).
  const given = (letter: string): boolean => before.some((v) => new RegExp(`^-[afnoqv]*${letter}`).test(v))
  const exact = (name: string): boolean => before.some((v) => v === `--${name}` || v.startsWith(`--${name}=`))
  const long = (names: string[]): boolean => all.some((v) => {
    const name = longName(v)
    return name !== undefined && deniedLong(name, names)
  })
  if (long(['continue'])) return true
  const message = given('m') || exact('message')
  if (sub === 'commit') return short(all, 'c') || !(message || given('C') || exact('reuse-message') || exact('no-edit'))
  if (sub === 'tag') return short(all, 'u') || long(['local-user', 'sign']) || ((short(all, 'a') || long(['annotate'])) && !message)
  if (sub === 'pull') return all.some((v) => longName(v) !== undefined && deniedLong(longName(v) ?? '', ['rebase']) && /=i/.test(v))
  return false
}

/**
 * The folder a git remote word may name on this disk: a path (`../other`, `/abs`, `..\\other`,
 * `C:\\x`), a `file://` URL, or a bare word, which git reads as a folder when no remote of that name
 * is configured. Undefined for a URL and an scp-like `host:path`.
 */
function localRemote(remote: string): string | undefined {
  if (remote.startsWith('file://')) return remote.slice('file://'.length)
  if (/^[A-Za-z]:[\\/]/.test(remote)) return remote
  if (remote.includes(':')) return undefined
  return remote
}

function git(args: Expanded[], cwd: string, scope: Scope): Effects {
  if (GIT_ENV.some((name) => scope.context.env[name] !== undefined)) fail('a GIT_ variable that moves the repository')
  let folder = cwd
  let i = 0
  for (; i < args.length; i++) {
    const v = (args[i] as Expanded).value
    if (v === '-C') {
      const path = args[++i]
      if (path === undefined || path.value === '') fail('an option without its value')
      folder = exactPathOf(path, folder, scope)
    } else if (v === '--no-pager' || v === '-P' || v === '--no-optional-locks') continue
    else if (v.startsWith('-')) {
      if (v === '--version' || v === '--help') return { ...none(), cwd: folder, git: { subcommand: null } }
      fail('a git option that names programs or another repository')
    } else break
  }
  const sub = args[i]?.value
  const rest = args.slice(i + 1)
  const facts: GitFacts = { subcommand: sub ?? null }
  const base = (): Effects => ({ ...none(), cwd: folder, git: facts })
  const repository = (effects: Partial<Effects> = {}): Effects => ({ ...base(), writes: [REPOSITORY], ...effects })
  if (sub === undefined) return base()
  if (GIT_READ.has(sub)) {
    const reads = [REPOSITORY]
    const read = (word: Expanded): void => {
      if (leavesRepository(word.value)) fail('a git read outside the repository')
      // A revision such as HEAD~3 or main^ holds a zsh extended glob character; in one component it can
      // only match files of this folder, so it is listed as written.
      if (word.extendedGlob && word.globAt < 0 && !/[\\/]/.test(word.value)) reads.push(join(folder, word.value, scope.win))
      else reads.push(pathOf(word, folder, scope))
    }
    for (const arg of rest) {
      const v = arg.value
      if (v === '--' || v === '-') continue
      const name = longName(v)
      if (name !== undefined) {
        if (deniedLong(name, GIT_READ_DENIED)) fail('a git option that writes a file or runs a program')
        if (deniedLong(name, GIT_READ_OUTSIDE)) fail('a git read outside the repository')
        const eq = v.indexOf('=')
        if (eq >= 0 && eq + 1 < v.length) read(slice(arg, eq + 1))
      } else if (v.startsWith('-')) {
        if (sub === 'grep' && /^-[^-]*O/.test(v)) fail('a git option that writes a file or runs a program')
        // A value glued to a short option (`-O<orderfile>`) may name a file.
        if (/[\\/~.]/.test(v)) fail('a git option whose value may name a file')
      } else read(arg)
    }
    return { ...base(), reads }
  }
  if (sub === 'config') {
    if (rest.some((arg) => {
      const name = longName(arg.value)
      return (name !== undefined && deniedLong(name, GIT_CONFIG_OUTSIDE)) || /^-[A-Za-z]*f/.test(arg.value)
    })) fail('a git config outside the repository')
    const reading = rest.length > 0 && rest.every((arg) => ['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin', '--local', '--global', '--worktree', '--null', '-z', '--name-only'].includes(arg.value) || !arg.value.startsWith('-')) && rest.some((arg) => ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(arg.value))
    // A setting can name a program git runs later (core.fsmonitor, core.pager, an alias).
    if (!reading) return { ...base(), writes: [UNKNOWN] }
    // Without --local or --worktree git also reads the user's own config files.
    if (rest.some((arg) => arg.value === '--local' || arg.value === '--worktree')) return { ...base(), reads: [REPOSITORY] }
    const home = scope.context.env['HOME']
    if (home === undefined || home === '') fail('a git config read without HOME')
    const user = join(folder, home, scope.win)
    const sep = scope.win ? '\\' : '/'
    const xdg = scope.context.env['XDG_CONFIG_HOME']
    const config = xdg === undefined || xdg === '' ? `${user}${sep}.config` : join(folder, xdg, scope.win)
    return { ...base(), reads: [REPOSITORY, `${user}${sep}.gitconfig`, `${config}${sep}git${sep}config`] }
  }
  if (sub === 'branch') {
    if (rest.every((arg) => GIT_BRANCH_LIST.includes(arg.value))) return { ...base(), reads: [REPOSITORY] }
    const values = rest.map((arg) => arg.value)
    if (values.some((v) => /^-[A-Za-z]*[mMcC]/.test(v) || /^--(move|copy)$/.test(v))) fail('a git branch rename or copy')
    if (values.some((v) => longName(v) !== undefined && !GIT_BRANCH_LONG.has(v))) fail('an option the table does not know')
    if (values.some((v) => /^-[A-Za-z]*[dD]/.test(v) || v === '--delete')) {
      const parsed = options(rest, GIT_BRANCH_DELETE)
      const force = parsed.options.some((option) => option.name === 'D' || option.name === 'f' || option.name === 'force')
      facts.branchDelete = { branches: parsed.operands.map((word) => word.value), force }
    }
    return repository()
  }
  if (sub === 'clean') {
    const parsed = options(rest, { flags: 'fdxXnq', values: 'e', long: { force: 'flag', 'dry-run': 'flag', quiet: 'flag', exclude: 'value' }, anywhere: true })
    for (const spec of parsed.operands) {
      // Git matches a pathspec with its own globs and magic (`:/` is the top of the repository).
      if (/[*?[]/.test(spec.value) || spec.value.startsWith(':')) fail('a git pathspec with a glob or magic')
    }
    return { ...base(), deletes: parsed.operands.length === 0 ? [folder] : paths(parsed.operands, folder, scope) }
  }
  if (sub === 'worktree') {
    const action = rest[0]?.value
    const more = rest.slice(1)
    if (action === 'list') return { ...base(), reads: [REPOSITORY] }
    if (action === 'prune' || action === 'lock' || action === 'unlock' || action === 'repair') return repository()
    if (action === 'remove') {
      const parsed = options(more, { flags: 'f', long: { force: 'flag' } })
      if (parsed.operands.length !== 1) fail('a git worktree remove without one path')
      return repository({ deletes: [exactPathOf(parsed.operands[0] as Expanded, folder, scope)] })
    }
    if (action === 'add') {
      const parsed = options(more, { flags: 'fdq', values: 'bB', long: { force: 'flag', detach: 'flag', 'no-checkout': 'flag', checkout: 'flag', lock: 'flag', quiet: 'flag', track: 'flag', 'no-track': 'flag', 'guess-remote': 'flag', orphan: 'flag' }, anywhere: true })
      const path = parsed.operands[0]
      if (path === undefined || parsed.operands.length > 2) fail('a git worktree add without a path')
      return repository({ writes: [REPOSITORY, exactPathOf(path, folder, scope)] })
    }
    if (action === 'move') {
      const parsed = options(more, { flags: 'f', long: { force: 'flag' } })
      if (parsed.operands.length !== 2) fail('a git worktree move without two paths')
      return repository({ deletes: [exactPathOf(parsed.operands[0] as Expanded, folder, scope)], writes: [REPOSITORY, exactPathOf(parsed.operands[1] as Expanded, folder, scope)] })
    }
    return { ...base(), writes: [UNKNOWN] }
  }
  if (sub === 'push') {
    const parsed = options(rest, GIT_PUSH)
    const named = new Set(parsed.options.map((option) => option.name))
    const remoteWord = parsed.operands[0]
    const refspecs = parsed.operands.slice(1).map((word) => word.value)
    const local = remoteWord === undefined ? undefined : localRemote(remoteWord.value)
    const localPath = local === undefined || remoteWord === undefined ? null : exactPathOf({ ...remoteWord, value: local }, folder, scope)
    facts.push = {
      remote: remoteWord?.value ?? null,
      localPath,
      refspecs,
      force: ['f', 'force', 'force-with-lease', 'force-if-includes', 'mirror'].some((name) => named.has(name)) || refspecs.some((spec) => spec.startsWith('+')),
      delete: ['d', 'delete', 'prune', 'mirror'].some((name) => named.has(name)) || refspecs.some((spec) => spec.startsWith(':')),
      many: ['all', 'mirror', 'tags', 'follow-tags'].some((name) => named.has(name)),
    }
    return repository({ network: true, writes: localPath === null ? [REPOSITORY] : [REPOSITORY, localPath] })
  }
  if (GIT_LOCAL.has(sub)) {
    // Every word, after `--` too, as for the read subcommands.
    for (const arg of rest) {
      const v = arg.value
      const name = longName(v)
      if (v === '--') continue
      if (name !== undefined) {
        if (deniedLong(name, GIT_LOCAL_DENIED_LONG)) fail('a git option that reads a file or runs a program')
      } else if (v.startsWith('-') && [...v.slice(1)].some((ch) => GIT_LOCAL_DENIED_SHORT.includes(ch))) fail('a git option that reads a file or runs a program')
    }
    if (gitLaunches(sub, rest)) fail('a git command that starts an editor or gpg')
    return repository({ network: sub === 'fetch' || sub === 'pull' })
  }
  // Another subcommand, or an alias, which may run any program.
  return { ...base(), writes: [UNKNOWN] }
}

/** cat, ls, head, tail, wc: short options only; operands are read. */
function reader(program: string, args: Expanded[], cwd: string, scope: Scope): Effects {
  const values = program === 'head' || program === 'tail' ? 'nc' : ''
  const flags = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%'].filter((ch) => !values.includes(ch)).join('')
  const parsed = options(args, { flags, values })
  const operands = parsed.operands.filter((word) => word.value !== '-')
  if (program === 'ls' && operands.length === 0) return { ...none(), reads: [cwd] }
  return { ...none(), reads: paths(operands, cwd, scope) }
}

function mktemp(args: Expanded[], state: State, scope: Scope): string {
  if (args.length !== 1 || args[0]?.value !== '-d') fail('a mktemp other than mktemp -d')
  return newTempFolder(state, scope)
}

/** The folder `mktemp -d` creates, as the shell would hold it. */
function newTempFolder(state: State, scope: Scope): string {
  const tmp = scope.context.env['TMPDIR']
  if (tmp === undefined || tmp === '') fail('mktemp without TMPDIR')
  const base = scope.win ? shellForm(windowsAbsolute(tmp) ?? fail('a TMPDIR that is not absolute'), true) : tmp.startsWith('/') ? tmp : fail('a TMPDIR that is not absolute')
  scope.counter.tempFolders++
  return `${base}${base.endsWith('/') ? '' : '/'}${newTempFolderName(scope.counter.tempFolders)}`
}

const pushDefined = (list: string[], value: string | undefined): void => {
  if (value !== undefined) list.push(value)
}

function table(program: string, args: Expanded[], state: State, scope: Scope): Effects {
  const cwd = state.cwd
  switch (program) {
    case 'echo':
    case 'true':
    case 'false':
    case ':':
    case 'pwd':
      return none()
    case 'test':
    case '[':
      // bash evaluates the subscript of `test -v 'a[$(…)]'`; -R is the same for a nameref.
      if (args.some((word) => word.value === '-v' || word.value === '-R')) fail('a test -v or -R')
      return none()
    case 'printf':
      if (args[0]?.value.startsWith('-v') === true) fail('a printf -v assignment')
      return none()
    case 'cat':
    case 'ls':
    case 'head':
    case 'tail':
    case 'wc':
      return reader(program, args, cwd, scope)
    case 'rm':
      return { ...none(), deletes: paths(options(args, RM).operands, cwd, scope) }
    case 'rmdir':
      return { ...none(), deletes: paths(options(args, RMDIR).operands, cwd, scope) }
    case 'mv': {
      const { sources, destination } = sourcesAndDestination(options(args, MV).operands, cwd, scope)
      return { ...none(), deletes: sources, writes: [destination] }
    }
    case 'cp': {
      const { sources, destination } = sourcesAndDestination(options(args, CP).operands, cwd, scope)
      return { ...none(), reads: sources, writes: [destination] }
    }
    case 'ln':
      // A link makes a later path of the same command lead elsewhere (`ln ~/.zshrc z; echo x >> z`), and
      // a hard link shares the file it names: neither fits writes and reads.
      return fail('a link')
    case 'mkdir':
      return { ...none(), writes: paths(options(args, MKDIR).operands, cwd, scope) }
    case 'touch': {
      const parsed = options(args, TOUCH)
      const reads = parsed.options.filter((option) => option.name === 'r' || option.name === 'reference').map((option) => exactPathOf(option.value as Expanded, cwd, scope))
      return { ...none(), reads, writes: paths(parsed.operands, cwd, scope) }
    }
    case 'tee': {
      const operands = options(args, TEE).operands
      if (operands.some((word) => word.value === '-')) fail('a tee to -')
      return { ...none(), writes: paths(operands, cwd, scope) }
    }
    case 'mktemp':
      return { ...none(), writes: [join(cwd, mktemp(args, state, scope), scope.win)] }
    case 'git':
      return git(args, cwd, scope)
    case 'curl':
      return curl(args, cwd, scope)
    case 'wget':
      return wget(args, cwd, scope)
    default:
      return { ...none(), writes: [UNKNOWN] }
  }
}

// Built-ins that change the shell itself or run code the grammar cannot see.
const BUILTINS = new Set([
  'eval', 'source', '.', 'exec', 'builtin', 'command', 'alias', 'unalias', 'set', 'shopt', 'setopt', 'unsetopt', 'emulate', 'export', 'readonly', 'local', 'declare', 'typeset', 'integer', 'float', 'unset', 'trap', 'read', 'mapfile', 'readarray', 'let', 'getopts', 'pushd', 'popd', 'dirs', 'zmodload', 'autoload', 'enable', 'disable', 'hash', 'rehash', 'unhash', 'fc', 'history', 'r', 'return', 'break', 'continue', 'shift', 'wait', 'jobs', 'fg', 'bg', 'disown', 'functions', 'unfunction', 'noglob', 'nocorrect', '-', 'ulimit', 'umask', 'limit', 'unlimit', 'bindkey', 'zle', 'zstyle', 'zparseopts', 'zpty', 'zsocket', 'ztcp', 'sched', 'vared', 'compdef', 'compinit', 'zcompile', 'caller', 'complete', 'compgen', 'compopt', 'suspend', 'logout', 'times', 'ttyctl', 'pushln', 'chdir',
])
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until', 'do', 'done', 'in', 'function', 'select', 'time', 'coproc', 'repeat', 'foreach', 'end', '!', '{', '}', '[[', ']]'])
const SHELLS = new Set(['sh', 'bash', 'zsh'])
// The programs of the table, which read their options from their words.
const TABLE = new Set(['echo', 'true', 'false', ':', 'pwd', 'test', '[', 'printf', 'cat', 'ls', 'head', 'tail', 'wc', 'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'tee', 'mktemp', 'git', 'curl', 'wget'])
// Programs for which an option a file name could become changes nothing listed: rm and rmdir take no
// option with a path, echo only prints.
const GLOB_OPTION_HARMLESS = new Set(['rm', 'rmdir', 'echo'])
// Programs that do not take `--` as the end of their options.
const NO_END_OF_OPTIONS = new Set(['test', '[', 'curl'])

/**
 * Whether the word at `n` is a `--` that ends the options: not one of NO_END_OF_OPTIONS, and not
 * right after an option word, whose value it may be (`git push -o -- *`).
 */
function endsOptions(program: string, args: Expanded[], n: number): boolean {
  const word = args[n] as Expanded
  if (word.value !== '--' || word.globAt >= 0 || NO_END_OF_OPTIONS.has(program)) return false
  const before = args[n - 1]
  return before === undefined || !before.value.startsWith('-')
}

/**
 * Refuses a glob that may expand into an option (a file named `-Oprogram` turns `git grep -e x *`
 * into a run of a program; `--target-directory=…` moves cp's writes): before `--`, a word of a table
 * program that starts with a glob. printf reads options only before its format.
 */
function refuseGlobOptions(program: string, args: Expanded[]): void {
  if (!TABLE.has(program) || GLOB_OPTION_HARMLESS.has(program)) return
  let ended = false
  args.forEach((word, n) => {
    if (ended) return
    if (endsOptions(program, args, n)) ended = true
    else if (word.leadingGlob && !(program === 'printf' && n > 0)) fail('a glob that may expand into an option')
  })
}
// Names a shell gives a meaning to (bash, sh, zsh, including zsh's lower-case ones tied to an upper-case
// twin: `path` is PATH, `cdpath` is CDPATH). An assignment to one changes later commands — where
// programs come from, what cd and ~ mean, how words split, what a trace line runs (PS4) — so only a
// name outside this list and outside SPECIAL_PREFIX may be assigned.
const SPECIAL = new Set([
  'IFS', 'PATH', 'CDPATH', 'HOME', 'PWD', 'OLDPWD', 'TMPDIR', 'TMPPREFIX', 'TMPSUFFIX', 'ENV', 'SHELL', 'SHELLOPTS', 'SHLVL', 'POSIXLY_CORRECT', 'GLOBIGNORE', 'GLOBSORT', 'EXECIGNORE', 'FIGNORE', 'FCEDIT', 'EDITOR', 'VISUAL', 'PAGER',
  'MAIL', 'MAILCHECK', 'MAILPATH', 'MANPATH', 'MODULE_PATH', 'FPATH', 'NULLCMD', 'READNULLCMD', 'STTY', 'TMOUT', 'TIMEFORMAT', 'TIMEFMT', 'REPORTTIME', 'REPORTMEMORY', 'KEYTIMEOUT', 'WORDCHARS', 'WATCH', 'WATCHFMT', 'LOGCHECK', 'SAVEHIST', 'LISTMAX', 'DIRSTACKSIZE', 'CORRECT_IGNORE', 'CORRECT_IGNORE_FILE', 'SPROMPT', 'RPROMPT', 'RPROMPT2', 'RPS1', 'RPS2', 'POSTEDIT', 'PSVAR', 'ZDOTDIR', 'ZBEEP', 'KEYBOARD_HACK', 'TERM', 'TERMINFO', 'TERMINFO_DIRS', 'LANG', 'LINES', 'COLUMNS', 'BAUD', 'CHILD_MAX', 'FUNCNEST', 'HOSTFILE', 'INPUTRC', 'IGNOREEOF', 'EMACS', 'INSIDE_EMACS', 'auto_resume', 'histchars', 'HISTCHARS',
  'OPTIND', 'OPTARG', 'OPTERR', 'REPLY', 'LINENO', 'RANDOM', 'SRANDOM', 'SECONDS', 'EPOCHSECONDS', 'EPOCHREALTIME', 'PPID', 'UID', 'EUID', 'GID', 'EGID', 'GROUPS', 'HOSTNAME', 'HOSTTYPE', 'MACHTYPE', 'OSTYPE', 'CPUTYPE', 'VENDOR', 'HOST', 'LOGNAME', 'USERNAME', 'TTY', 'TTYIDLE', 'ERRNO', 'ARGV0', 'PIPESTATUS', 'FUNCNAME', 'DIRSTACK', 'COPROC', 'MAPFILE', 'MATCH', 'MBEGIN', 'MEND', 'CURSOR', 'BUFFER', 'LBUFFER', 'RBUFFER', 'MARK', 'CONTEXT', 'KEYS', 'NUMERIC', 'WIDGET', 'LASTWIDGET', 'PREBUFFER', 'PREDISPLAY', 'POSTDISPLAY', 'BUFFERLINES', 'HISTNO',
  'path', 'cdpath', 'fpath', 'manpath', 'module_path', 'mailpath', 'fignore', 'psvar', 'prompt', 'watch', 'argv', 'status', 'pipestatus', 'signals', 'match', 'mbegin', 'mend', 'reply', 'options', 'parameters', 'commands', 'functions', 'aliases', 'galiases', 'saliases', 'builtins', 'history', 'historywords', 'jobdirs', 'jobstates', 'jobtexts', 'modules', 'nameddirs', 'userdirs', 'usergroups', 'reswords', 'dirstack', 'funcstack', 'funcfiletrace', 'funcsourcetrace', 'functrace', 'widgets', 'keymaps', 'mapfile', 'errnos', 'sysparams', 'termcap', 'terminfo', 'patchars', 'epochtime', 'langinfo', 'killring', 'region_highlight', 'zsh_eval_context', 'zsh_scheduled_events', '_',
])
const SPECIAL_PREFIX = /^(BASH|ZSH|zsh_|ZLE|zle_|HIST|PS[0-9]|PROMPT|COMP|READLINE|LC_|GIT_|LD_|DYLD_|dis_|ZFTP|zftp_|ztcp|ISEARCH|YANK|TRY_BLOCK)/

// --- Evaluation -----------------------------------------------------------------------------

function evaluate(script: string, context: AnalyzeContext, depth: number, counter: { tempFolders: number }): ShellAction[] {
  if (context.env['IFS'] !== undefined) fail('IFS in the environment')
  const win = context.platform === 'win32'
  const scope: Scope = { context, win, depth, counter, actions: [] }
  const steps = new Parser(script).script()
  let states: State[] = [{ cwd: startFolder(context, win), assigned: new Map(), ok: true }]
  for (const step of steps) {
    // After `;` or a newline the next command runs whatever the last one returned.
    if (step.connector === 'seq') states = unique(states.map((state) => ({ ...state, ok: true })))
    const next: State[] = []
    for (const state of states) {
      const runs = step.connector === 'seq' || (step.connector === 'and') === state.ok
      if (runs) next.push(...pipeline(step.pipeline, state, scope))
      else next.push(state)
    }
    states = unique(next)
    if (states.length > MAX_STATES) fail('too many folders the command may run in')
  }
  return scope.actions
}

function unique(states: State[]): State[] {
  const seen = new Map<string, State>()
  for (const state of states) seen.set(JSON.stringify([state.cwd, state.ok, [...state.assigned]]), state)
  return [...seen.values()]
}

function pipeline(commands: Command[], state: State, scope: Scope): State[] {
  if (commands.length === 1) return command(commands[0] as Command, state, scope, null, false).states
  let previous: number | null = null
  for (const each of commands) previous = command(each, state, scope, previous, true).index
  return [{ ...state, ok: true }, { ...state, ok: false }]
}

function isAssignment(word: Word): boolean {
  const first = word.parts[0]
  if (first?.kind !== 'text' || first.quoted) return false
  const eq = first.text.indexOf('=')
  return eq > 0 && NAME.test(first.text.slice(0, eq))
}

function emit(scope: Scope, action: ShellAction): number {
  if (scope.actions.length >= MAX_ACTIONS) fail('too many actions')
  scope.actions.push(action)
  return scope.actions.length - 1
}

function assign(words: Word[], state: State, scope: Scope): State[] {
  let states: State[] = [state]
  for (const word of words) {
    const first = word.parts[0] as { kind: 'text'; text: string; quoted: boolean }
    const eq = first.text.indexOf('=')
    const name = first.text.slice(0, eq)
    if (scope.context.env[name] !== undefined) fail('an assignment to an exported variable')
    if (SPECIAL.has(name) || SPECIAL_PREFIX.test(name)) fail('an assignment to a variable the shell gives a meaning to')
    // zsh expands `=cmd` at the start of an assignment's value too.
    if (first.text[eq + 1] === '=') fail('a zsh = expansion')
    const valueWord: Word = { parts: [{ ...first, text: first.text.slice(eq + 1) }, ...word.parts.slice(1)] }
    const meaningful = valueWord.parts.filter((part) => !(part.kind === 'text' && part.text === ''))
    const substitution = meaningful.length === 1 && meaningful[0]?.kind === 'mktemp'
    const next: State[] = []
    for (const each of states) {
      if (substitution) {
        const folder = newTempFolder(each, scope)
        emit(scope, { program: 'mktemp', args: ['-d'], cwd: each.cwd, writes: [join(each.cwd, folder, scope.win)], deletes: [], reads: [], network: false, stdinFrom: null })
        next.push({ ...each, assigned: new Map([...each.assigned, [name, folder]]), ok: true })
        // A failed mktemp leaves the variable empty.
        next.push({ ...each, assigned: new Map([...each.assigned, [name, '']]), ok: false })
      } else {
        const value = expand(valueWord, each, scope, false)?.value ?? ''
        next.push({ ...each, assigned: new Map([...each.assigned, [name, value]]), ok: true })
      }
    }
    states = next
  }
  return states
}

// `set -e`, `-u` and `-o pipefail` (and their `+` forms) only stop a script earlier: the actions listed
// without them still cover every run. Any other `set` changes the shell; `-x` among them, as each
// trace line expands PS4, which may hold a command substitution.
function isHarmlessSet(program: string, args: Expanded[]): boolean {
  if (program !== 'set' || args.length === 0) return false
  for (let n = 0; n < args.length; n++) {
    const v = (args[n] as Expanded).value
    if (/^[-+][eu]+$/.test(v)) continue
    if ((v === '-o' || v === '+o') && ['errexit', 'nounset', 'pipefail'].includes(args[n + 1]?.value ?? '')) {
      n++
      continue
    }
    return false
  }
  return true
}

function command(cmd: Command, state: State, scope: Scope, stdinFrom: number | null, inPipeline: boolean): { states: State[]; index: number | null } {
  const assignments: Word[] = []
  let k = 0
  while (k < cmd.words.length && isAssignment(cmd.words[k] as Word)) assignments.push(cmd.words[k++] as Word)
  if (k === cmd.words.length) {
    if (cmd.redirects.length > 0) fail('a redirection without a program')
    if (inPipeline) fail('an assignment inside a pipeline')
    return { states: assign(assignments, state, scope), index: null }
  }
  if (assignments.length > 0) fail('an assignment before a program')
  // `X+=1` appends in bash and zsh and is a program named `X+=1` in dash.
  const lead = cmd.words[0]?.parts[0]
  if (lead?.kind === 'text' && !lead.quoted && /^[A-Za-z_][A-Za-z0-9_]*\+=/.test(lead.text)) fail('an += assignment')
  const words = cmd.words.map((word) => expand(word, state, scope, true)).filter((word): word is Expanded => word !== undefined)
  const head = words[0]
  if (head === undefined) fail('a command without a program after expansion')
  if (head.globAt >= 0 || head.extendedGlob || head.literalGlob) fail('a glob in the program name')
  const program = head.value
  const args = words.slice(1)
  if (RESERVED.has(program)) fail('a reserved word: if, for, while, case, a function or a group')
  if (BUILTINS.has(program) && !isHarmlessSet(program, args)) fail('a shell built-in that changes the shell or runs code')

  const writes: string[] = []
  const reads: string[] = []
  for (const redirect of cmd.redirects) {
    if (redirect.kind === 'dup') continue
    const target = expand(redirect.target, state, scope, true)
    if (target === undefined) fail('an empty path')
    if (target.value === '/dev/null') continue
    // bash opens a connection for /dev/tcp/<host>/<port> and /dev/udp/…
    if (/^\/dev\/(tcp|udp)\//.test(target.value)) fail('a /dev/tcp or /dev/udp redirection')
    const path = exactPathOf(target, state.cwd, scope)
    if (redirect.op === '<') reads.push(path)
    else writes.push(path)
  }
  const action = (effects: Effects): ShellAction => ({
    program,
    args: args.map((word) => word.value),
    cwd: effects.cwd ?? state.cwd,
    writes: [...effects.writes, ...writes],
    deletes: effects.deletes,
    reads: [...effects.reads, ...reads],
    network: effects.network,
    stdinFrom,
    ...(effects.git === undefined ? {} : { git: effects.git }),
  })
  const both = [{ ...state, ok: true }, { ...state, ok: false }]

  if (program === 'set') return { states: both, index: emit(scope, action(none())) }
  if (program === 'cd') {
    if (inPipeline) fail('a cd inside a pipeline')
    if (args.length > 1) fail('a cd with more than one operand')
    const target = args[0]
    if (target !== undefined && (target.value === '' || target.value.startsWith('-'))) fail('a cd option or cd -')
    const cdpath = scope.context.env['CDPATH']
    if (target !== undefined && cdpath !== undefined && cdpath !== '' && !/^(\/|\.\.?(\/|$))/.test(target.value)) fail('a relative cd with CDPATH set')
    const to = target === undefined ? join(state.cwd, variable('HOME', state, scope), scope.win) : exactPathOf(target, state.cwd, scope)
    const index = emit(scope, action(none()))
    return { states: [{ ...state, cwd: to, ok: true }, { ...state, ok: false }], index }
  }
  if (program === 'exit') {
    if (inPipeline) fail('an exit inside a pipeline')
    // An exit whose redirection fails, or with more than one operand or one that is no number,
    // does not exit: bash and zsh go on with the next command.
    if (cmd.redirects.length > 0 || args.length > 1 || (args[0] !== undefined && !/^[0-9]+$/.test(args[0].value))) fail('an exit that may not exit')
    const index = emit(scope, action(none()))
    return { states: [], index }
  }
  if (SHELLS.has(program)) {
    const at = args.findIndex((word) => !/^-[eu]+$/.test(word.value))
    const flag = at < 0 ? undefined : args[at]?.value
    if (flag !== undefined && /^-[eu]*c$/.test(flag)) {
      const script = args[at + 1]
      if (script === undefined || args.length !== at + 2) fail('a shell -c without exactly one script')
      // The outer shell globs the script word before the inner one reads it: a file name becomes code.
      if (script.globAt >= 0 || script.extendedGlob) fail('a glob in a shell -c script')
      if (scope.depth + 1 > MAX_DEPTH) fail('shells nested too deep')
      if (program === 'bash' && scope.context.env['BASH_ENV'] !== undefined) fail('a bash -c with BASH_ENV set')
      const index = emit(scope, action(none()))
      let inner: ShellAction[]
      try {
        inner = evaluate(script.value, { ...scope.context, cwd: state.cwd }, scope.depth + 1, scope.counter)
      } catch (error) {
        if (error instanceof NotJudged) fail(`inner script: ${error.why}`)
        throw error
      }
      const base = scope.actions.length
      for (const each of inner) emit(scope, { ...each, stdinFrom: each.stdinFrom === null ? null : each.stdinFrom + base })
      return { states: both, index }
    }
    // Any other -c form (bash -l -c, bash -o xtrace -c) runs a script with options the grammar
    // does not model: refuse it rather than call it a script file.
    if (args.some((word) => /^[-+][A-Za-z]*c/.test(word.value))) fail('a shell option other than -e, -u before -c')
    // A shell reading a script file or its input runs code the grammar cannot see.
  }
  refuseGlobOptions(program, args)
  const index = emit(scope, action(table(program, args, state, scope)))
  return { states: both, index }
}
