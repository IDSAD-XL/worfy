import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { shell } from 'electron'
import { shellOpenExternal, shellOpenInEditor } from '../../shared/ipc/shell'
import { projectStore } from '../projects/store'
import { isInside, UNCHECKED, walkLinks, type LinkFs, type PathRules } from '../remote-links'
import { defineHandler, type HandlerModule } from './index'

/** The folders of the Project's git worktrees (the main one included); empty when git cannot say. */
function worktreeFolders(root: string): Promise<string[]> {
  return new Promise((done) => {
    execFile('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10_000 }, (error, stdout) => {
      if (error) return done([])
      done(
        stdout
          .split('\n')
          .filter((line) => line.startsWith('worktree '))
          .map((line) => line.slice('worktree '.length)),
      )
    })
  })
}

const realOrNull = (path: string): Promise<string | null> => realpath(path).catch(() => null)

export interface ResolveOptions {
  /** realpath, or null when there is no such file; replaced in tests. */
  real?: (path: string) => Promise<string | null>
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  /** lstat and readlink for the links on the way to the file (remote-links.ts); replaced in tests. */
  links?: LinkFs
}

/**
 * The real path of `path` when it lies inside the Project root or one of its worktrees; throws
 * otherwise. Symlinks are resolved on both sides, so `../` and a link that points out of the Project
 * are refused, and a file that does not exist is refused too. A UNC or device path on Windows
 * (`\\host\share\…`, `//host/…`, `\\?\…`, `\\.\…`) is first checked by its text alone, against the
 * folders as written and as real paths, and one outside is refused before any file system call on
 * it: realpath on it would make Windows contact that host and hand it the user's NTLM credentials
 * (review of worfy-windows ticket 08). A local path can lead there too, through a symlink in the
 * repository: the links on its way are read before realpath, and a path that leads to such a host is
 * refused the same way (worfy-windows ticket 18); a path whose links cannot be read to the end is
 * refused as one that could not be checked, not as one outside. A Project on a share is opened on that share as
 * before.
 */
export async function resolveProjectFile(root: string, path: string, worktrees: readonly string[], options: ResolveOptions = {}): Promise<string> {
  const real = options.real ?? realOrNull
  const paths = options.paths ?? nativePath
  const folders = [root, ...worktrees].map((folder) => paths.resolve(folder))
  const bases = (await Promise.all(folders.map(real))).filter((base): base is string => base !== null)
  const candidate = paths.resolve(root, path)
  // path.win32.resolve gives every UNC and device form a leading `\\`.
  const remote = paths.sep === '\\' && candidate.startsWith('\\\\')
  if (remote && ![...folders, ...bases].some((base) => isInside(base, candidate, paths))) throw new Error(`${path} is outside the Project and its worktrees`)
  const verdict = await walkLinks(candidate, [...folders, ...bases], { paths, links: options.links })
  if (verdict === 'remote') throw new Error(`${path} is outside the Project and its worktrees`)
  if (verdict === 'unchecked') throw new Error(`${path} ${UNCHECKED}`)
  const target = await real(candidate)
  if (target === null) throw new Error(`${path} does not exist`)
  if (!bases.some((base) => isInside(base, target, paths))) throw new Error(`${path} is outside the Project and its worktrees`)
  return target
}

// What a double click would run rather than open, by the system's name of it (worfy-polish ticket
// 35). shell.openPath does what a double click does; for these it is starting a program, so they
// are shown in the file manager instead. When in doubt a kind belongs here: showing a file costs a
// click, running one can cost the machine.
const LAUNCHED_DARWIN = [
  // Programs, scripts and installers: Terminal, Automator, Script Editor, Installer run them.
  ...['.app', '.command', '.terminal', '.tool', '.workflow', '.action', '.scpt', '.scptd', '.applescript', '.pkg', '.mpkg'],
  // Shell scripts, and the kinds an installed launcher runs (Python Launcher, Jar Launcher).
  ...['.sh', '.bash', '.zsh', '.csh', '.tcsh', '.ksh', '.fish', '.py', '.pyw', '.jar'],
  // Pointers to another file or address that is opened in turn, disk images, system add-ons.
  ...['.webloc', '.inetloc', '.fileloc', '.dmg', '.mobileconfig', '.prefpane', '.saver', '.kext', '.osax', '.shortcut'],
]

// The default PATHEXT of Windows; the PATHEXT of the running system is added at the check.
const LAUNCHED_WIN32 = [
  ...['.com', '.exe', '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msc'],
  // Shortcuts, PowerShell, installers, screen savers and the other kinds Explorer runs or follows.
  ...['.lnk', '.url', '.pif', '.scf', '.ps1', '.psm1', '.msi', '.msp', '.mst', '.scr', '.cpl', '.hta', '.reg', '.inf', '.jar'],
  ...['.application', '.appref-ms', '.appx', '.appxbundle', '.msix', '.msixbundle', '.appinstaller', '.settingcontent-ms'],
  ...['.library-ms', '.search-ms', '.diagcab', '.chm', '.gadget', '.iso', '.img', '.vhd', '.vhdx'],
]

const LAUNCHED_OTHER = ['.sh', '.bash', '.zsh', '.csh', '.ksh', '.fish', '.py', '.jar', '.desktop', '.appimage', '.run', '.deb', '.rpm', '.flatpakref', '.snap']

// A file with the execute bit is run by macOS (Terminal) when it has no extension the system opens
// as a document; these are the document kinds an execute bit left by a checkout does not change.
const DOCUMENT = new Set(
  ['.md', '.markdown', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
    .concat(['.css', '.html', '.htm', '.xml', '.csv', '.log', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']),
)

/** What the answer calls the file manager a file was shown in. */
export type FileManager = 'Finder' | 'Explorer' | 'the file manager'

export function fileManager(platform: string): FileManager {
  if (platform === 'darwin') return 'Finder'
  if (platform === 'win32') return 'Explorer'
  return 'the file manager'
}

export interface LaunchOptions {
  /** process.platform; any value in tests. */
  platform?: string
  /** PATHEXT of the system, for win32. */
  pathext?: string | undefined
  /** stat of the file; replaced in tests. */
  stat?: (path: string) => Promise<{ isDirectory(): boolean; mode: number }>
}

/**
 * Whether the system would run `target` (a real path, symlinks resolved) rather than open it: a
 * folder (an `.app` bundle is one), a name whose extension is a program kind of the platform, and
 * off Windows a file with an execute bit and no document extension. Throws when the file cannot be
 * read, so a file that cannot be checked is never handed over.
 */
export async function runsAsProgram(target: string, options: LaunchOptions = {}): Promise<boolean> {
  const platform = options.platform ?? process.platform
  const info = await (options.stat ?? stat)(target)
  if (info.isDirectory()) return true
  let name = nativePath.basename(target).toLowerCase()
  if (platform === 'win32') {
    // `a.txt:b.exe` names a stream of a file, and Windows drops a trailing dot or space of a name.
    if (name.includes(':')) return true
    name = name.replace(/[. ]+$/, '')
  }
  const extension = nativePath.extname(name)
  const launched =
    platform === 'darwin'
      ? LAUNCHED_DARWIN
      : platform === 'win32'
        ? [...LAUNCHED_WIN32, ...(options.pathext ?? process.env.PATHEXT ?? '').toLowerCase().split(';')]
        : LAUNCHED_OTHER
  if (extension !== '' && launched.includes(extension)) return true
  return platform !== 'win32' && (info.mode & 0o111) !== 0 && !DOCUMENT.has(extension)
}

/** The URL when it is an https:// address; throws otherwise. */
export function httpsUrl(url: string): string {
  if (!URL.canParse(url)) throw new Error(`${url} is not an address`)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`only https:// addresses are opened, not ${parsed.protocol}`)
  return parsed.href
}

export default [
  defineHandler(shellOpenInEditor, async ({ projectId, path }) => {
    const root = projectStore().get(projectId).path
    const target = await resolveProjectFile(root, path, await worktreeFolders(root))
    // A program is shown, never run: the window says why next to the link (Markdown.tsx).
    if (await runsAsProgram(target)) {
      shell.showItemInFolder(target)
      return { path: target, revealedIn: fileManager(process.platform) }
    }
    // openPath answers with an error message, or '' when the file was handed over.
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
    return { path: target }
  }),
  defineHandler(shellOpenExternal, async ({ url }) => {
    const href = httpsUrl(url)
    await shell.openExternal(href)
    return { url: href }
  }),
] satisfies HandlerModule
