import { execFile } from 'node:child_process'
import { open, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { BrowserWindow, dialog, shell, type Dialog } from 'electron'
import { shellOpenExternal, shellOpenInEditor, type RevealPlatform } from '../../shared/ipc/shell'
import { projectStore } from '../projects/store'
import { isInside, UNCHECKED, walkLinks, type LinkFs, type PathRules } from '../remote-links'
import { projectLayouts, type ProjectLayout } from '../workflow/folder'
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

/**
 * The places of the Project's workflow outside its root: in Silent mode the Ticket files lie in the
 * Workflow folder, and the Tickets root may lie elsewhere still. `tickets.read` reads a Ticket from
 * there (src/main/ipc/tickets.ts), so "Open in editor" and the links of its body open from there
 * too. None for a layout that could not be read: where the workflow lives is unknown then.
 */
export function workflowPlaces(layout: ProjectLayout | null): string[] {
  return layout === null || layout.failed ? [] : [layout.workflowFolder, layout.ticketsRoot]
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

// The files a link hands to the system to open without asking (worfy-polish ticket 35). shell.openPath does
// what a double click does, and for a program, a script, an installer or a pointer to one that is
// running it. No list of such kinds is ever complete (a Terminal `.term` file runs its command), so
// the check is the other way round: a regular file whose extension is one of these documents is
// opened at once, and for anything else main asks first (askToOpen). Each kind opens in a viewer or an editor:
// text and markdown, data formats, TypeScript and CSS as text, images, PDF. Not here, on any system:
// `.html`, `.htm`, `.svg` and `.xml` open in a browser, where a page can send itself on to the
// handler of a URL scheme (`ms-msdt:`, `search-ms:`, `x-apple…:`), so they lead to programs too;
// `.csv` opens in a spreadsheet, which may evaluate formulas.
const DOCUMENTS_EVERYWHERE = ['.md', '.markdown', '.txt', '.log', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ts', '.tsx', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']

// JavaScript sources open in an editor on macOS and Linux; on Windows Script Host runs `.js` and
// `.jse`, and `.mjs` and `.cjs` have no editor by default, so there they are shown.
const DOCUMENTS_POSIX = ['.js', '.mjs', '.cjs', '.jsx']

/** The documents a link opens on `platform`, lower case. */
export function documentKinds(platform: string): readonly string[] {
  return platform === 'win32' ? DOCUMENTS_EVERYWHERE : [...DOCUMENTS_EVERYWHERE, ...DOCUMENTS_POSIX]
}

/** Which file manager a file is shown in, by the system's name of it. */
export function revealPlatform(platform: string): RevealPlatform {
  return platform === 'darwin' || platform === 'win32' ? platform : 'other'
}

export interface DocumentOptions {
  /** process.platform; any value in tests. */
  platform?: string
  /** stat of the file; replaced in tests. */
  stat?: (path: string) => Promise<{ isFile(): boolean }>
  /** The first bytes of the file (at most `length`); replaced in tests. */
  head?: (path: string, length: number) => Promise<Buffer>
}

/** The first `length` bytes of a file, fewer when it is shorter. */
async function headOf(path: string, length: number): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

// A Finder alias is a regular file whose data is bookmark data, and its name may end in `.md`. macOS
// opens what it points at — the alias `x.md` of a `.command` opens in Terminal and runs it (checked
// with NSWorkspace.urlForApplication on 2026-10-24) — and a zip keeps the extended attributes that
// make the file an alias. Bookmark data starts with these bytes.
const BOOKMARK_MAGIC = Buffer.from('book\0\0\0\0mark', 'latin1')

/**
 * Whether `target` (a real path, symlinks resolved) is a document a link may open: a regular file
 * whose extension, in any letter case, is one of documentKinds. A folder (an `.app` bundle is one),
 * a name without an extension or with any other, and on Windows a name with `:` (a stream of a file)
 * are not, and on macOS neither is a Finder alias, whatever its name. The execute bit is not looked
 * at: the system types a file with an extension by the extension, which is why a document copied
 * from a FAT or SMB volume, every bit set, still opens in its editor. Throws when the file cannot be
 * read, so a file that cannot be checked is never opened.
 */
export async function isDocument(target: string, options: DocumentOptions = {}): Promise<boolean> {
  const platform = options.platform ?? process.platform
  const info = await (options.stat ?? stat)(target)
  if (!info.isFile()) return false
  const name = nativePath.basename(target).toLowerCase()
  if (platform === 'win32' && name.includes(':')) return false
  if (!documentKinds(platform).includes(nativePath.extname(name))) return false
  // shortcut: an alias made before Mac OS X 10.6 keeps its record in the resource fork, not as
  // bookmark data, and is not seen here, redo when such an alias turns up in a Project.
  if (platform === 'darwin' && (await (options.head ?? headOf)(target, BOOKMARK_MAGIC.length)).equals(BOOKMARK_MAGIC)) return false
  return true
}

/**
 * The bidirectional controls (U+202A–U+202E, U+2066–U+2069) and the direction marks (U+200E, U+200F,
 * U+061C): in a name they reorder what is shown, and `setup<U+202E>dm.command` reads as `setupdm…`
 * ending in `.md`. The question about a file shows its name without them.
 */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g

/** A file name as the question about it shows it: without bidirectional controls. */
export const shownName = (name: string): string => name.replace(BIDI_CONTROLS, '')

/** What the user chose for a file that is not a document. */
export type OpenChoice = 'open' | 'show' | 'cancel'

/** The buttons of askToOpen, in order: Cancel first, the default and the answer to Escape. */
export function openButtons(platform: string): readonly [string, string, string] {
  const show = platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in Explorer' : 'Show in folder'
  return ['Cancel', show, 'Open']
}

/**
 * The question for a file that is not a document (owner's decision on PR #692: convenience over
 * security, the third option): a message box on the window that asked, on the Machine of that window.
 * "Open" hands the file to the system as a double click would, "Show in Finder" shows it selected,
 * "Cancel" does nothing. Cancel is the default button and the answer to Escape, so Return never runs
 * a program; a closed box is Cancel too.
 */
export async function askToOpen(owner: BrowserWindow | null, target: string, platform: string, box: Pick<Dialog, 'showMessageBox'> = dialog): Promise<OpenChoice> {
  const name = shownName(nativePath.basename(target))
  const options = {
    type: 'warning' as const,
    buttons: [...openButtons(platform)],
    defaultId: 0,
    cancelId: 0,
    title: `Open ${name}?`,
    message: `Open ${name}?`,
    detail: 'This file may run a program. worfy opens documents directly; this one is not a document.',
    noLink: true,
  }
  const { response } = owner ? await box.showMessageBox(owner, options) : await box.showMessageBox(options)
  return response === 2 ? 'open' : response === 1 ? 'show' : 'cancel'
}

/** The URL when it is an https:// address; throws otherwise. */
export function httpsUrl(url: string): string {
  if (!URL.canParse(url)) throw new Error(`${url} is not an address`)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`only https:// addresses are opened, not ${parsed.protocol}`)
  return parsed.href
}

export default [
  defineHandler(shellOpenInEditor, async ({ projectId, path }, { event }) => {
    const root = projectStore().get(projectId).path
    const [worktrees, layout] = await Promise.all([worktreeFolders(root), projectLayouts().get(root).catch(() => null)])
    const target = await resolveProjectFile(root, path, [...worktrees, ...workflowPlaces(layout)])
    // A document opens at once; for anything else the user decides in a box of main, never the
    // window: the renderer is not trusted. `desktop`: a Linked machine never reaches this handler.
    if (!(await isDocument(target))) {
      const choice = await askToOpen(BrowserWindow.fromWebContents(event.sender), target, process.platform)
      if (choice === 'cancel') return { path: target, outcome: 'cancelled' as const }
      if (choice === 'show') {
        shell.showItemInFolder(target)
        return { path: target, outcome: 'revealed' as const, revealedIn: revealPlatform(process.platform) }
      }
    }
    // openPath answers with an error message, or '' when the file was handed over.
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
    return { path: target, outcome: 'opened' as const }
  }),
  defineHandler(shellOpenExternal, async ({ url }) => {
    const href = httpsUrl(url)
    await shell.openExternal(href)
    return { url: href }
  }),
] satisfies HandlerModule
