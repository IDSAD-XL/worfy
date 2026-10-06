// The Dock icon of a dev run (ticket 31). `pnpm dev` runs Electron.app from node_modules, whose
// bundle icon is Electron's; worfy sets its own, build/icon.png (drawn by `pnpm icons`), through
// app.dock.setIcon. The "About worfy" window shows the same picture, since macOS takes it from the
// app icon. A packaged app gets its icon from the bundle (electron-builder's mac.icon), so this
// does nothing there. Notifications of a dev run keep the Electron icon: setIcon does not change
// the bundle that shows them.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app as electronApp } from 'electron'

export interface DockIconDeps {
  app: { isPackaged: boolean; getAppPath(): string; dock?: { setIcon(image: string): void } | undefined }
  platform: NodeJS.Platform
  warn: (message: string) => void
}

const defaults = (): DockIconDeps => ({
  app: electronApp,
  platform: process.platform,
  warn: (message) => console.warn(message),
})

/** Sets the Dock icon of a dev run on macOS; a missing file or a failing call is a warning, never a failed start. */
export function installDevDockIcon(deps: DockIconDeps = defaults()): void {
  const { app, platform, warn } = deps
  if (platform !== 'darwin' || app.isPackaged || app.dock === undefined) return
  // In a dev run the app path is the repository root, where package.json lies.
  const icon = join(app.getAppPath(), 'build', 'icon.png')
  if (!existsSync(icon)) {
    warn(`[worfy] no Dock icon at ${icon}; run \`pnpm icons\`. The Dock keeps the Electron icon.`)
    return
  }
  try {
    app.dock.setIcon(icon)
  } catch (error) {
    warn(`[worfy] could not set the Dock icon from ${icon}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
