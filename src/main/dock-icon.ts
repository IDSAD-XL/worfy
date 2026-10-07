// The Dock icon and the About window of a dev run (ticket 31, worfy-week ticket 12). `pnpm dev`
// runs Electron.app from node_modules, whose bundle is Electron's: its icon, its name, its version.
// worfy sets its own Dock icon, build/icon.png (drawn by `pnpm icons`), through app.dock.setIcon,
// and gives the About window worfy's name and version from package.json through
// app.setAboutPanelOptions. The About window of a dev run still shows the Electron icon: on macOS
// setAboutPanelOptions takes no icon (`iconPath` is for Linux and Windows) and the panel takes the
// picture from the bundle, which setIcon does not change. Notifications of a dev run keep the
// Electron icon for the same reason. A packaged app gets its icon, name and version from the bundle
// (electron-builder's mac.icon and package.json), so this does nothing there.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app as electronApp } from 'electron'

export interface DockIconDeps {
  app: {
    isPackaged: boolean
    getAppPath(): string
    dock?: { setIcon(image: string): void } | undefined
    setAboutPanelOptions(options: { applicationName: string; applicationVersion: string; version: string }): void
  }
  platform: NodeJS.Platform
  warn: (message: string) => void
}

const defaults = (): DockIconDeps => ({
  app: electronApp,
  platform: process.platform,
  warn: (message) => console.warn(message),
})

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** worfy's name and version for the About window, from the package.json at the app path. */
function installAboutPanel({ app, warn }: DockIconDeps): void {
  let file = 'package.json'
  let name: unknown
  let version: unknown
  try {
    // In a dev run the app path is the repository root, where package.json lies.
    file = join(app.getAppPath(), 'package.json')
    ;({ name, version } = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown })
  } catch (error) {
    warn(`[worfy] could not read ${file} for the About window: ${message(error)}. It keeps Electron's name and version.`)
    return
  }
  if (typeof name !== 'string' || typeof version !== 'string') {
    warn(`[worfy] ${file} has no name or version for the About window. It keeps Electron's.`)
    return
  }
  try {
    // `version` is the build number macOS shows in parentheses; without it the panel shows Electron's.
    app.setAboutPanelOptions({ applicationName: name, applicationVersion: version, version })
  } catch (error) {
    warn(`[worfy] could not set the About window's name and version: ${message(error)}`)
  }
}

/** Sets the Dock icon and the About window of a dev run on macOS; a missing file or a failing call is a warning, never a failed start. */
export function installDevDockIcon(deps: DockIconDeps = defaults()): void {
  const { app, platform, warn } = deps
  if (platform !== 'darwin' || app.isPackaged) return
  installAboutPanel(deps)
  if (app.dock === undefined) return
  const icon = join(app.getAppPath(), 'build', 'icon.png')
  if (!existsSync(icon)) {
    warn(`[worfy] no Dock icon at ${icon}; run \`pnpm icons\`. The Dock keeps the Electron icon.`)
    return
  }
  try {
    app.dock.setIcon(icon)
  } catch (error) {
    warn(`[worfy] could not set the Dock icon from ${icon}: ${message(error)}`)
  }
}
