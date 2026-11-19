// The one way the Changes screen runs git (worfy-changes-view ticket 02; ADR-0110): reading only, next to an agent
// that commits in the same worktree at the same second. Nothing here may write the index, a ref, an object or a
// lock file of the repository:
//
// - GIT_OPTIONAL_LOCKS=0: no optional lock (`index.lock` of a refresh a reading command may take);
// - `diff.autoRefreshIndex=false`: a `git diff` against the work tree otherwise refreshes the stat data of the index
//   and writes `.git/index` back — GIT_OPTIONAL_LOCKS=0 does not stop that write (seen on git 2.50, ADR-0110);
// - `core.fsmonitor=false`: no file system monitor daemon is started for the read;
// - GIT_TERMINAL_PROMPT=0: git never waits for a password;
// - GIT_LITERAL_PATHSPECS=1: a path after `--` is a path, never a pattern or a `:(magic)` pathspec;
// - `core.quotePath=false` and `-z` where names are printed: a path with spaces or letters outside ASCII comes as it
//   is, on Windows too;
// - `--no-ext-diff`, `--no-textconv`, `--no-color` on every command that prints a patch: no program of the
//   repository's configuration runs, and the output is git's own.
//
// A command outside READ_COMMANDS, or a form of one the screen does not run (`hash-object -w`, `--output`,
// `worktree add`), is refused before any process starts. The variables that point git at another repository
// (GIT_DIR, GIT_INDEX_FILE…) are dropped, whatever the case of their names (Windows does not tell them apart).
//
// The output has a limit of its own (`maxBytes`): a list of files is read whole up to LIST_MAX_BYTES, a patch up to
// what its caller asks. Past the limit git is stopped and the answer says `truncated`.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/** What a run gave: the exit code (null when git did not start or was stopped), stdout as UTF-8, its size in bytes. */
export interface GitRead {
  code: number | null
  stdout: string
  /** Bytes of stdout git printed before it ended or was stopped. */
  bytes: number
  /** Stopped at `maxBytes`: stdout holds what came before. */
  truncated: boolean
  /** The first part of stderr, for the reason of a failure. */
  stderr: string
}

export interface GitReadOptions {
  /** The most bytes of stdout read; git is stopped past it. LIST_MAX_BYTES by default. */
  maxBytes?: number
  /** How long git may run; GIT_TIMEOUT_MS by default. */
  timeoutMs?: number
  /** What git reads on stdin (`check-attr --stdin`, `hash-object --stdin-paths`). */
  input?: string
}

/** Runs one reading git command in `cwd`; never throws. A refused command answers code null with the reason in stderr. */
export type ChangesGit = (cwd: string, args: readonly string[], options?: GitReadOptions) => Promise<GitRead>

/** A list of files is read whole: no 8 MB limit as the stages' runner has (src/main/workflow/stages.ts). */
export const LIST_MAX_BYTES = 256 * 1024 * 1024
export const GIT_TIMEOUT_MS = 60_000
const STDERR_MAX = 4096

/**
 * The commands the screen runs. `merge-base`, `diff` (with `--no-index` too), `log`, `show`, `ls-files --others
 * --exclude-standard`, `for-each-ref`, `cat-file -e`/`-s`, `hash-object` without `-w` — the spec's list; and three
 * more that only read: `check-attr` (the `linguist-generated` attribute), `rev-parse` and `worktree list` (where the
 * Ticket's worktree is and what HEAD is, as the workflow reader asks, src/main/workflow/reader.ts).
 */
export const READ_COMMANDS = ['merge-base', 'diff', 'log', 'show', 'ls-files', 'for-each-ref', 'cat-file', 'hash-object', 'check-attr', 'rev-parse', 'worktree'] as const

/** The only forms of the commands that have several and of which some write or start a program: the arguments after the command name. */
export const EXACT_FORMS: Readonly<Record<string, readonly string[]>> = {
  'ls-files': ['--others', '--exclude-standard', '-z'],
  // `--no-filters`: no clean filter of the repository's configuration runs (ADR-0110, item 2).
  'hash-object': ['--no-filters', '--stdin-paths'],
  worktree: ['list', '--porcelain'],
}

/** The commands that print a patch: they get PATCH_FLAGS right after their name. */
const PATCH_COMMANDS: ReadonlySet<string> = new Set(['diff', 'log', 'show'])
export const PATCH_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color'] as const

/** `-c` settings of every run (see the top of the file). */
export const READ_CONFIG = ['-c', 'core.quotePath=false', '-c', 'diff.autoRefreshIndex=false', '-c', 'core.fsmonitor=false'] as const

/** The environment of every run on top of main's own. */
export const READ_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' } as const

/** Variables that would point git at another repository, index or configuration than `cwd`'s. */
export const LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CONFIG_PARAMETERS'] as const

const sameArgs = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((arg, index) => arg === b[index])

/** Why `args` are refused, or null when they only read. Only the part before `--` is options; paths after it are not looked at. */
export function refusal(args: readonly string[]): string | null {
  const [command, ...rest] = args
  if (command === undefined || !(READ_COMMANDS as readonly string[]).includes(command)) return `git ${command ?? ''} is not a reading command of Changes`
  const end = rest.indexOf('--')
  const options = end === -1 ? rest : rest.slice(0, end)
  if (options.some((arg) => arg.startsWith('--output') || arg === '-o')) return `git ${command} with --output writes a file`
  const exact = EXACT_FORMS[command]
  if (exact !== undefined) return sameArgs(rest, exact) ? null : `git ${command} is run only as git ${command} ${exact.join(' ')}${command === 'hash-object' ? ' (never -w)' : ''}`
  if (command === 'cat-file') return rest.length === 2 && (rest[0] === '-e' || rest[0] === '-s') && !rest[1]!.startsWith('-') ? null : 'git cat-file is run only as cat-file -e <object> or cat-file -s <object>'
  return null
}

/** The full command line of a run: READ_CONFIG, the command, PATCH_FLAGS for a patch command, the rest. */
export function readArgs(args: readonly string[]): string[] {
  const [command, ...rest] = args
  return [...READ_CONFIG, command!, ...(PATCH_COMMANDS.has(command!) ? PATCH_FLAGS : []), ...rest]
}

/** main's environment without the location variables, with READ_ENV. */
export function readEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const own = Object.fromEntries(Object.entries(env).filter(([name]) => !(LOCATION_VARS as readonly string[]).includes(name.toUpperCase())))
  return { ...own, ...READ_ENV }
}

/** How the runner starts git: child_process.spawn; tests hand in their own to see what would start. */
export type SpawnGit = (command: string, args: string[], options: SpawnOptions) => ChildProcess

/** The runner over the real git (`gitBinary`, `git` on PATH by default). */
export function changesGitRunner(gitBinary = 'git', start: SpawnGit = spawn): ChangesGit {
  return (cwd, args, options = {}) =>
    new Promise((resolve) => {
      const refused = refusal(args)
      if (refused !== null) {
        resolve({ code: null, stdout: '', bytes: 0, truncated: false, stderr: refused })
        return
      }
      const maxBytes = options.maxBytes ?? LIST_MAX_BYTES
      const chunks: Buffer[] = []
      let bytes = 0
      let truncated = false
      let stderr = ''
      let settled = false
      const child = start(gitBinary, readArgs(args), {
        cwd,
        env: readEnv(),
        stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const finish = (code: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), bytes, truncated, stderr })
      }
      const timer = setTimeout(() => {
        stderr ||= `git ${args[0] ?? ''} did not finish in ${options.timeoutMs ?? GIT_TIMEOUT_MS} ms`
        child.kill()
      }, options.timeoutMs ?? GIT_TIMEOUT_MS)
      child.stdout?.on('data', (chunk: Buffer) => {
        if (truncated) return
        const room = maxBytes - bytes
        if (chunk.length > room) {
          chunks.push(chunk.subarray(0, Math.max(room, 0)))
          bytes = maxBytes
          truncated = true
          child.kill()
          return
        }
        chunks.push(chunk)
        bytes += chunk.length
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < STDERR_MAX) stderr += chunk.slice(0, STDERR_MAX - stderr.length)
      })
      child.on('error', (error) => {
        stderr ||= error.message
        finish(null)
      })
      child.on('close', (code) => finish(truncated ? null : code))
      if (options.input !== undefined && child.stdin) {
        child.stdin.on('error', () => undefined)
        child.stdin.end(options.input)
      }
    })
}

/** The app's runner. */
export const changesGit: ChangesGit = changesGitRunner()
