// worfy's folder for the shell integration of zsh in Terminal Nodes, as VS Code does it
// (https://code.visualstudio.com/docs/terminal/shell-integration): the shell's ZDOTDIR points at a
// temporary folder of worfy, whose .zshenv, .zprofile, .zshrc and .zlogin read the user's files of
// the same name and then load worfy's integration script (src/main/terminal/zsh/). The user's
// files are never changed, and only shells worfy starts in Terminal Nodes get the folder.
//
// The folder is made once per run of worfy (mkdtemp, 0700), so a dev build and the Stable copy do
// not share it, and is removed when worfy exits. It lives in os.tmpdir(), not in worfy's data
// folder, because the socket of the Terminal AI goes in it too and the path of a Unix socket must
// fit zsh 5.9's zsocket: 103 bytes at most. When os.tmpdir() is too long for that, the folder goes
// to /tmp.
//
// macOS deletes files in $TMPDIR that nobody has opened for three days (dirhelper), and zsh reading
// a file does not count. So the scripts are written anew, with the folder if it is gone, every time
// a zsh Terminal starts; each is written to a temporary file and renamed, so a shell starting at
// the same moment never reads half a file.
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Env } from '../agent/env'
import { removeTree } from '../storage/remove'

/**
 * Every `*.zsh` of ./zsh/ and its subfolders, as text in main's bundle (zsh cannot read files
 * inside app.asar). Scripts of later features go to ./zsh/rc.d/ and come along by themselves.
 */
const SCRIPTS = import.meta.glob<string>('./zsh/**/*.zsh', { query: '?raw', import: 'default', eager: true })

/** The scripts that zsh reads from ZDOTDIR under its own names. */
const STARTUP_NAMES: Readonly<Record<string, string>> = {
  'zshenv.zsh': '.zshenv',
  'zprofile.zsh': '.zprofile',
  'zshrc.zsh': '.zshrc',
  'zlogin.zsh': '.zlogin',
}

/** The file of the Terminal AI's socket in the folder. */
export const SOCKET_FILE = 'assist.sock'
/** The longest socket path zsh 5.9's zsocket connects to: it copies at most 103 bytes. */
export const SOCKET_PATH_MAX = 103
/** mkdtemp adds six characters to this prefix. */
const DIR_PREFIX = 'worfy-'
/** Where the folder goes when os.tmpdir() is too long for the socket path. */
const SHORT_TMP = '/tmp'

export interface ScriptFile {
  /** The path in the folder, relative, with `/`. */
  path: string
  text: string
}

/** The files of the folder: the startup files under zsh's names, every other script under its own path. */
export function scriptFiles(): ScriptFile[] {
  return Object.entries(SCRIPTS)
    .map(([key, text]) => {
      const path = key.replace(/^\.\/zsh\//, '')
      return { path: STARTUP_NAMES[path] ?? path, text }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** True when the program a Terminal runs is zsh, by the file that is started (not by SHELL). */
export function isZsh(file: string): boolean {
  return /^zsh(-\d+(\.\d+)*)?$/.test(basename(file))
}

/** The path of the Terminal AI's socket in the folder `dir`. */
export function socketPath(dir: string): string {
  return join(dir, SOCKET_FILE)
}

/** A new nonce for one shell: the shell's sequences carry it, programs run in the shell do not know it. */
export function newNonce(): string {
  return randomBytes(16).toString('hex')
}

/** A shell's way to main for Terminal AI: the socket to connect to and the shell's own token for it. */
export interface AssistAdmission {
  socket: string
  token: string
}

/**
 * Who lets the shells with the integration reach main for Terminal AI
 * (src/main/terminal-ai/shell-link.ts). `key` is the Terminal's key in the registry, `dir` worfy's
 * folder, where the socket goes; the token is given back when the shell is gone.
 */
export interface AssistDoor {
  admit(key: string, dir: string): Promise<AssistAdmission>
  revoke(token: string): void
}

/**
 * The environment of a zsh with the integration: ZDOTDIR is worfy's folder; the user's own ZDOTDIR,
 * when their environment has one, and the nonce go in WORFY_USER_ZDOTDIR and WORFY_SHELL_NONCE,
 * which the script takes out of the environment before anything else runs. Without
 * WORFY_USER_ZDOTDIR the script reads the user's files from HOME and leaves ZDOTDIR unset while
 * they run, as zsh without worfy would. With an admission the socket of Terminal AI and the
 * shell's token go the same way, in WORFY_ASSIST_SOCKET and WORFY_ASSIST_TOKEN.
 */
export function integrationEnv(env: Readonly<Env>, dir: string, nonce: string, assist: AssistAdmission | null = null): Env {
  const out: Env = { ...env, ZDOTDIR: dir, WORFY_SHELL_NONCE: nonce }
  delete out.WORFY_USER_ZDOTDIR
  delete out.WORFY_ASSIST_SOCKET
  delete out.WORFY_ASSIST_TOKEN
  if (env.ZDOTDIR !== undefined && env.ZDOTDIR !== '') out.WORFY_USER_ZDOTDIR = env.ZDOTDIR
  if (assist !== null) {
    out.WORFY_ASSIST_SOCKET = assist.socket
    out.WORFY_ASSIST_TOKEN = assist.token
  }
  return out
}

/** The folder where worfy's folder is made: os.tmpdir(), or /tmp when the socket path would not fit. */
export function tempBase(base: string): string {
  const longest = join(base, `${DIR_PREFIX}XXXXXX`, SOCKET_FILE)
  return Buffer.byteLength(longest) <= SOCKET_PATH_MAX ? base : SHORT_TMP
}

/**
 * True when `dir` is a folder of this user that nobody else may open (not a link someone put there).
 * On Windows a folder has neither an owner id nor mode bits to read — every folder shows 0o666
 * there — so a folder that is not a link is taken: the temporary folder of a user is the user's by
 * its access list. Read by the bits, no folder passed, and every prepare() made a new one.
 */
async function ownFolder(dir: string): Promise<boolean> {
  try {
    const stat = await lstat(dir)
    if (!stat.isDirectory()) return false
    if (process.platform === 'win32') return true
    const uid = process.getuid?.()
    return (uid === undefined || stat.uid === uid) && (stat.mode & 0o077) === 0
  } catch {
    return false
  }
}

/** How often and how long apart a rename is tried on Windows when the file it replaces is busy. */
export const RENAME_TRIES = 10
export const RENAME_RETRY_MS = 20
/** What Windows answers while another process — an antivirus, the indexer, a second writer — holds the file for a moment. */
const RENAME_BUSY = ['EPERM', 'EACCES', 'EBUSY']

/**
 * Moves a file over another. On Windows the move is refused while anything has the replaced file
 * open, which passes in a moment; it is tried again a few times there. Elsewhere it is one call.
 */
async function renameOver(from: string, to: string): Promise<void> {
  for (let left = RENAME_TRIES; ; left--) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const busy = RENAME_BUSY.includes((error as NodeJS.ErrnoException).code ?? '')
      if (process.platform !== 'win32' || !busy || left <= 1) throw error
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS))
    }
  }
}

async function writeAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporary, text, { mode: 0o600 })
  await renameOver(temporary, path)
}

export interface ShellIntegrationOptions {
  /** Where temporary folders go; os.tmpdir() by default. */
  tmpdir?: () => string
}

/** worfy's ZDOTDIR folder of one run of worfy. */
export class ShellIntegration {
  private dir: string | null = null
  private making: Promise<string> | null = null

  constructor(private readonly options: ShellIntegrationOptions = {}) {}

  /** The folder, once made; null before the first zsh Terminal. */
  get path(): string | null {
    return this.dir
  }

  /** Makes the folder if it is not there and writes every script anew; answers the folder. */
  async prepare(): Promise<string> {
    const dir = await this.folder()
    await Promise.all(scriptFiles().map((file) => writeAtomically(join(dir, ...file.path.split('/')), file.text)))
    return dir
  }

  /** Removes the folder; for worfy's exit, so it is synchronous. */
  disposeSync(): void {
    const dir = this.dir
    this.dir = null
    this.making = null
    if (dir !== null) removeTree(dir)
  }

  private async folder(): Promise<string> {
    // Two Terminals starting at once make one folder.
    this.making ??= this.make()
    let dir = await this.making
    if (!(await ownFolder(dir))) {
      // Gone (dirhelper): made again under the same name; a folder of that name that is not ours
      // (another user's, a link) is not used: a new one is made instead.
      try {
        await mkdir(dir, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      if (!(await ownFolder(dir))) {
        this.making = this.make()
        dir = await this.making
      }
    }
    return dir
  }

  private async make(): Promise<string> {
    const base = tempBase((this.options.tmpdir ?? tmpdir)())
    await mkdir(base, { recursive: true })
    const dir = await mkdtemp(join(base, DIR_PREFIX))
    this.dir = dir
    return dir
  }
}
