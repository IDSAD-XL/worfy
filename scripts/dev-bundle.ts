// The app bundle `pnpm dev` runs on macOS. macOS takes the name and the icon of a notification, of
// the Dock tile and of the About window from the bundle of the process, and the Electron.app of
// node_modules is Electron's: com.github.Electron, "Electron", electron.icns. So a dev run gets a
// copy of that bundle in node_modules/.cache/worfy-dev/worfy.app, with worfy's name, its own bundle
// id and build/icon.icns (drawn by `pnpm icons`), and electron.vite.config.ts points electron-vite at
// its executable through ELECTRON_EXEC_PATH. The copy is a clone (APFS), so it costs no disk space,
// and it is made again only when Electron's Info.plist or the icon changes.
//
// The bundle id is not dev.worfy.app, the stable copy's: macOS would take the two for one app, and
// a click on a notification or `open -b` could start the wrong one. A new id asks once whether
// worfy may send notifications. The executable keeps Electron's name: app.isPackaged is false only
// while it is called Electron, and the dev paths (src/main/storage/paths.ts) follow from that.
//
// Off macOS, and when the copy cannot be made, a dev run starts Electron as it is: a failure here
// is a warning, never a failed `pnpm dev`.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeTree } from '../src/main/storage/remove'

/** What the dev bundle's Info.plist says. */
export interface DevBundleValues {
  name: string
  id: string
  iconFile: string
}

export const DEV_BUNDLE: DevBundleValues = Object.freeze({ name: 'worfy', id: 'dev.worfy.dev', iconFile: 'worfy.icns' })

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Electron's Info.plist (XML) with worfy's name, bundle id and icon file. A key that is there gets
 * the new string; a key that is not is added at the end of the top-level dict. Every other line
 * stays as it was.
 */
export function patchInfoPlist(xml: string, values: DevBundleValues): string {
  const wanted: [string, string][] = [
    ['CFBundleName', values.name],
    ['CFBundleDisplayName', values.name],
    ['CFBundleIdentifier', values.id],
    ['CFBundleIconFile', values.iconFile],
  ]
  let patched = xml
  for (const [key, value] of wanted) {
    const entry = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`)
    if (entry.test(patched)) {
      // A function, so a `$` in the value is not read as a replacement pattern.
      patched = patched.replace(entry, (_match, open: string, close: string) => `${open}${escapeXml(value)}${close}`)
      continue
    }
    // The top-level dict closes last in a plist.
    const end = patched.lastIndexOf('</dict>')
    if (end < 0) throw new Error(`the Info.plist has no dict to add ${key} to`)
    patched = `${patched.slice(0, end)}\t<key>${key}</key>\n\t<string>${escapeXml(value)}</string>\n${patched.slice(end)}`
  }
  return patched
}

export interface DevBundleDeps {
  platform: NodeJS.Platform
  /** The repository: node_modules/electron, build/icon.icns and node_modules/.cache lie there. */
  repo: string
  /** Copies a bundle to a path that does not exist yet. */
  copyApp: (from: string, to: string) => void
  /** Tells Launch Services about the bundle, so Notification Center and the Dock read its icon. */
  register: (app: string) => void
  warn: (message: string) => void
}

const defaults = (): DevBundleDeps => ({
  platform: process.platform,
  // import.meta.url, not import.meta.dirname: electron-vite bundles its config and puts back only
  // __dirname, __filename and import.meta.url of each file it takes in.
  repo: dirname(dirname(fileURLToPath(import.meta.url))),
  // -c clones each file (clonefile(2)) and falls back to a plain copy off APFS; -R copies links as links.
  copyApp: (from, to) => execFileSync('cp', ['-cR', from, to], { stdio: 'pipe' }),
  register: (app) => execFileSync(LSREGISTER, ['-f', app], { stdio: 'pipe' }),
  warn: (message) => console.warn(message),
})

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The executable of the dev bundle, made or made again when needed; null off macOS or when the
 * bundle cannot be made, and then a dev run starts Electron.app as it is.
 */
export function devBundleExecutable(given: Partial<DevBundleDeps> = {}): string | null {
  const { platform, repo, copyApp, register, warn } = { ...defaults(), ...given }
  if (platform !== 'darwin') return null
  const source = join(repo, 'node_modules', 'electron', 'dist', 'Electron.app')
  const cache = join(repo, 'node_modules', '.cache', 'worfy-dev')
  const app = join(cache, 'worfy.app')
  const executable = join(app, 'Contents', 'MacOS', 'Electron')
  try {
    const plist = patchInfoPlist(readFileSync(join(source, 'Contents', 'Info.plist'), 'utf8'), DEV_BUNDLE)
    const icon = readFileSync(join(repo, 'build', 'icon.icns'))
    const plistAt = join(app, 'Contents', 'Info.plist')
    const iconAt = join(app, 'Contents', 'Resources', DEV_BUNDLE.iconFile)
    // A new Electron has another CFBundleVersion, so its Info.plist differs too.
    if (existsSync(executable) && existsSync(plistAt) && existsSync(iconAt) && readFileSync(plistAt, 'utf8') === plist && readFileSync(iconAt).equals(icon)) {
      return executable
    }
    // Made next to its place and moved in whole: an interrupted run never leaves half a bundle there.
    // shortcut: a dev run still running from the bundle loses it when another `pnpm dev` remakes it
    // (a new Electron or icon), when two dev runs of different Electron versions overlap, keep one bundle per version.
    const staging = join(cache, 'worfy.app.making')
    mkdirSync(cache, { recursive: true })
    removeTree(staging)
    copyApp(source, staging)
    writeFileSync(join(staging, 'Contents', 'Info.plist'), plist)
    writeFileSync(join(staging, 'Contents', 'Resources', DEV_BUNDLE.iconFile), icon)
    removeTree(app)
    renameSync(staging, app)
    try {
      register(app)
    } catch (error) {
      warn(`[worfy] Launch Services did not take the dev bundle ${app}: ${message(error)}. Its notifications may show another icon until it is registered.`)
    }
    return executable
  } catch (error) {
    warn(`[worfy] could not make the dev bundle at ${app}: ${message(error)}. This dev run starts Electron.app, whose notifications show Electron's name and icon.`)
    return null
  }
}

/**
 * Points electron-vite at the dev bundle for `pnpm dev` (electron.vite.config.ts, command `serve`).
 * An ELECTRON_EXEC_PATH that is set already is left as it is.
 */
export function useDevBundle(env: NodeJS.ProcessEnv = process.env, deps: Partial<DevBundleDeps> = {}): void {
  if (env.ELECTRON_EXEC_PATH !== undefined && env.ELECTRON_EXEC_PATH !== '') return
  const executable = devBundleExecutable(deps)
  if (executable !== null) env.ELECTRON_EXEC_PATH = executable
}
